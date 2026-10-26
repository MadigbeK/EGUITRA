"""Routes du porteur gardées de l'ancien portail : liste imprimable des pièces, dépôt d'une pièce,
téléchargement d'une pièce visible du porteur, compte rendu d'une action. Les écrans du portail
(apps/web/app/portail) les appellent encore ; le reste du portail du porteur (espace, tableau de bord,
projet, pièces attendues, fil des messages, rendez-vous…) est servi par eguitra_portail
(controllers/porteur.py). Les anciennes routes /portail/dossiers, /portail/dossiers/<id>, la liste
des pièces et la messagerie (GET et POST /portail/dossiers/<id>/messages), qu'aucun écran n'appelait
plus, sont retirées : elles doublaient /espace, /tableau, /pieces et /fil, et la vue du dossier
montrait au porteur l'intitulé des critères de la grille de ses cinq premiers écarts.

Le porteur n'accède qu'aux dossiers dont il est utilisateur du portail (contrôle explicite ici) ; il
ne voit ni le détail du scoring interne, ni les notes internes.
"""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require

from .common import document_row, download, store_upload
from .rapports import pieces_pdf

PORTEUR = ("porteur",)


def _own(dossier_id):
    dossier = request.env["axispro.dossier"].sudo().browse(dossier_id).exists()
    if not dossier or request.env.user not in dossier.portal_user_ids:
        raise ApiError(404, "not_found", "Dossier introuvable.")
    return dossier


def _open(dossier):
    """Un dossier clos se consulte, mais ne reçoit plus de pièce (même contrôle que le portail des
    porteurs, eguitra_portail, pour les messages)."""
    if dossier.state == "closed":
        raise ApiError(422, "business_rule", "Ce dossier est clos.")


def _task_row(action):
    return {"id": action.id, "name": action.name, "description": action.description or None,
            "due_date": action.due_date, "state": action.state, "porteur_comment": action.porteur_comment or None,
            "overdue": action.is_overdue()}


class EguitraPortal(http.Controller):
    @api_route("/portail/dossiers/<int:dossier_id>/pieces.pdf", profiles=PORTEUR)
    def pieces(self, dossier_id, **_kw):
        """Liste imprimable des pièces attendues du porteur et des compléments demandés."""
        return pieces_pdf(_own(dossier_id))

    @api_route("/portail/dossiers/<int:dossier_id>/documents", methods=("POST",), profiles=PORTEUR)
    def upload(self, dossier_id, **_kw):
        dossier = _own(dossier_id)
        _open(dossier)
        form = request.httprequest.form
        return document_row(store_upload(dossier, form.get("document_type_id"), form.get("name"), quota=True),
                            portal=True)

    @api_route("/portail/documents/<int:document_id>/download", profiles=PORTEUR)
    def download_document(self, document_id, **_kw):
        doc = request.env["axispro.document"].sudo().browse(document_id).exists()
        if not doc or not doc.portal_visible:
            raise ApiError(404, "not_found", "Pièce introuvable.")
        _own(doc.dossier_id.id)
        return download(doc)

    @api_route("/portail/actions/<int:action_id>/report", methods=("POST",), profiles=PORTEUR)
    def report_action(self, action_id, **_kw):
        """Le porteur déclare une action réalisée ; le cabinet la valide ensuite."""
        action = request.env["axispro.action"].sudo().browse(action_id).exists()
        if not action or not action.portal_visible or action.assignee != "porteur":
            raise ApiError(404, "not_found", "Action introuvable.")
        dossier = _own(action.dossier_id.id)
        if dossier.state == "closed" or action.state not in ("todo", "in_progress", "submitted"):
            raise ApiError(422, "business_rule", "Cette action n'attend plus de compte rendu.")
        (comment,) = require(read_json(), "comment")
        action.write({"state": "submitted", "porteur_comment": str(comment)[:5000]})
        return _task_row(action)
