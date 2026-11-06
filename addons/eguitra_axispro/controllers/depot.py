"""Lien de dépôt du promoteur (référence V2.0, AJ-02, T-20).

Côté cabinet : créer, lister et retirer les liens d'un dossier (évaluateur). Côté public, sans session : le serveur web
relaie /depot/<jeton> (apps/web) ; le noyau n'est jamais exposé. La réponse publique ne dit que le projet et ce que le
promoteur a déposé par ce lien : jamais un score, une note ni une autre pièce du dossier (section 3).
"""

import re

from odoo import SUPERUSER_ID, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json

from ..models.depot import DEFAULT_DAYS, MAX_DAYS, MAX_LINK_FILES
from .common import PIECE_FORMATS, piece_categories, store_piece
from .sc01 import WRITE, _record, _sc01_dossier

TOKEN = re.compile(r"[A-Za-z0-9_-]{30,100}")
# Le navigateur envoie les fichiers un à un ; ce plafond borne un appel écrit à la main.
MAX_BATCH_FILES = 10


def _link_row(link):
    return {
        "id": link.id, "created_at": link.create_date, "created_by": link.create_uid.name,
        "expires_at": link.expires_at, "revoked_at": link.revoked_at or None, "valid": link.is_valid(),
        "pieces": len(link.document_ids),
    }


def _links(dossier):
    links = request.env["axispro.deposit.link"].search([("dossier_id", "=", dossier.id)])
    return {"links": [_link_row(x) for x in links], "default_days": DEFAULT_DAYS, "max_days": MAX_DAYS}


def _open_link(token):
    """Lien valable, sous un environnement système borné à la société du dossier. Le jeton fait office de droit : il
    n'ouvre que les deux routes publiques ci-dessous."""
    request.update_env(user=SUPERUSER_ID)
    link = request.env["axispro.deposit.link"].find(token) if TOKEN.fullmatch(token or "") else None
    if not link:
        raise ApiError(404, "not_found", "Ce lien de dépôt n'existe pas : vérifiez l'adresse reçue.")
    if not link.is_valid():
        raise ApiError(410, "link_expired", "Ce lien de dépôt n'est plus valable : demandez-en un nouveau à votre "
                                            f"contact chez {link.company_id.name}.")
    request.update_env(context=dict(request.env.context, allowed_company_ids=link.company_id.ids))
    return link.with_env(request.env)


def _deposited(link):
    return [{"name": d.original_name or d.name, "category": d.category_letter or None, "date": d.uploaded_at}
            for d in link.document_ids.sorted("id", reverse=True)]


class EguitraAxisproDepot(http.Controller):
    # ─── Cabinet ──────────────────────────────────────────────────────────

    @api_route("/axispro/dossiers/<int:dossier_id>/deposit-links", profiles=WRITE)
    def links(self, dossier_id, **_kw):
        return _links(_sc01_dossier(dossier_id))

    @api_route("/axispro/dossiers/<int:dossier_id>/deposit-links", methods=("POST",), profiles=WRITE)
    def create_link(self, dossier_id, **_kw):
        """Nouveau lien : {days}, 14 jours par défaut. `token` n'est rendu qu'ici."""
        dossier = _sc01_dossier(dossier_id)
        dossier._check_open()
        days = read_json().get("days", DEFAULT_DAYS)
        if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= MAX_DAYS:
            raise ApiError(400, "invalid_parameter", f"Durée du lien : de 1 à {MAX_DAYS} jours.", fields=["days"])
        link, token = request.env["axispro.deposit.link"].issue(dossier, days)
        return dict(_link_row(link), token=token)

    @api_route("/axispro/deposit-links/<int:link_id>", methods=("DELETE",), profiles=WRITE)
    def revoke_link(self, link_id, **_kw):
        _record("axispro.deposit.link", link_id, "Lien de dépôt").revoke()
        return {"status": "ok"}

    # ─── Public ───────────────────────────────────────────────────────────

    @api_route("/depot/<string:token>", auth=False)
    def public_page(self, token, **_kw):
        link = _open_link(token)
        dossier = link.dossier_id
        policy = dossier.policy_id
        return {
            "project": dossier.name, "reference": dossier.reference, "company": link.company_id.name,
            "expires_at": link.expires_at, "formats": PIECE_FORMATS, "max_file_mb": policy.max_file_mb or 20,
            "categories": [{"letter": c["letter"], "name": c["name"]} for c in piece_categories(policy)],
            "deposited": _deposited(link),
        }

    @api_route("/depot/<string:token>", methods=("POST",), auth=False)
    def public_deposit(self, token, **_kw):
        """Dépôt du promoteur : format et taille contrôlés comme pour l'équipe (RG-06-02), état « À vérifier » (RG-06-04),
        origine « Portail », inscrit au journal du dossier. Le rattachement à un critère reste à l'évaluateur."""
        link = _open_link(token)
        dossier = link.dossier_id
        uploads = request.httprequest.files.getlist("file")
        if not uploads:
            raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
        if len(uploads) > MAX_BATCH_FILES or len(link.document_ids) + len(uploads) > MAX_LINK_FILES:
            raise ApiError(422, "quota_exceeded", f"Ce lien reçoit {MAX_LINK_FILES} fichiers au plus : demandez-en un "
                                                  "nouveau à votre contact.")
        letter = (request.httprequest.form.get("category") or "").strip().upper()
        if letter and letter not in {c["letter"] for c in piece_categories(dossier.policy_id)}:
            raise ApiError(400, "invalid_parameter", "Catégorie inconnue.", fields=["category"])
        deposited = request.env["axispro.document"]
        refused = []
        for upload in uploads:
            try:
                deposited |= store_piece(dossier, upload, letter=letter or None, quota=True, source="portal",
                                         deposit_link=link)
            except ApiError as refusal:
                if refusal.status not in (413, 415):
                    raise
                refused.append(refusal)
        if not deposited:
            raise refused[0]
        dossier.log("document", note=f"Dépôt du promoteur par son lien : {', '.join(deposited.mapped('name'))}.")
        return {"deposited": _deposited(link), "errors": [{"file": r.message.split(" : ")[0], "message": r.message}
                                                          for r in refused]}
