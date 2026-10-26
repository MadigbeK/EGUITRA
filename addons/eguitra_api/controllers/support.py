"""Espace partagé de suivi des demandes (« Mes demandes », menu du compte) : routes /support/...
(contrat : apps/web/lib/support-types.ts).

- Tout compte interne, avec ou sans profil (un salarié en libre-service compris), dépose ses demandes,
  les suit, les commente, clôt une demande résolue ou la rouvre. La direction lit aussi celles de ses
  sociétés ; l'administration (E-VOLUTION XP) les lit toutes.
- Seul le profil Administration fait avancer une demande (prise en charge, réponse, gravité, type,
  résolution, refus, qualification et crédit d'une évolution) et lit la synthèse.
- Un compte du portail (porteur de projet) est refusé partout : il s'adresse à son consultant.
Les règles d'accès et les contrôles du modèle (models/support.py) s'appliquent sous l'identité du compte.
"""

from odoo import fields, http
from odoo.http import request

from ..models.support import ADMIN_GROUP
from ..suivi import FINAL_STATES, KINDS, PLATFORM_APP, QUALIFICATIONS, SEVERITIES, STATES, app_codes
from .framework import ApiError, api_route, int_arg, read_json, require

ADMIN = ("admin",)
# Tout compte connecté : _interne() écarte ensuite les comptes du portail. Pas de liste de profils ici,
# pour qu'un compte interne sans profil (salarié en libre-service) ait aussi ses demandes.
INTERNES = None

KIND_CODES = [code for code, _label in KINDS]
SEVERITY_CODES = [code for code, _label in SEVERITIES]
STATE_CODES = [code for code, _label in STATES]
QUALIFICATION_CODES = [code for code, _label in QUALIFICATIONS]
MANAGED = ("state", "kind", "severity", "app", "response", "qualification", "credit_days", "planned_date")

TITLE_MAX = 200
TEXT_MAX = 20000


def _interne():
    if request.env.user.share:
        raise ApiError(403, "forbidden", "Espace réservé aux comptes internes : un porteur de projet s'adresse à son "
                                         "consultant du cabinet.")


def _admin():
    return request.env.user.has_group(ADMIN_GROUP)


def _code(value, codes, label):
    if value not in codes:
        raise ApiError(400, "invalid_parameter", f"{label} inconnu : {value}.")
    return value


def _line(value, size):
    text = " ".join(str(value).split())
    if not text:
        raise ApiError(400, "missing_fields", "Champs obligatoires manquants.", fields=["title"])
    return text[:size]


def _text(value, field):
    text = str(value or "").strip()
    if not text:
        raise ApiError(400, "missing_fields", "Champs obligatoires manquants.", fields=[field])
    if len(text) > TEXT_MAX:
        raise ApiError(422, "business_rule", f"Texte trop long : {TEXT_MAX} caractères au plus.")
    return text


def _days(value):
    if value in (None, ""):
        return 0.0
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ApiError(400, "invalid_parameter", "Jours de crédit : nombre attendu.")
    return round(float(value), 2)


def _date(value):
    if value in (None, ""):
        return False
    try:
        return fields.Date.to_date(str(value))
    except ValueError as e:
        raise ApiError(400, "invalid_parameter", "Date invalide (AAAA-MM-JJ).") from e


def _company(value):
    """Société de la demande : celle du travail en cours, ou une autre des sociétés du compte."""
    if value in (None, ""):
        return request.env.company.id
    allowed = request.env.user.sudo().company_ids.ids
    try:
        company_id = int(value)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_company", "Société invalide.") from e
    if company_id not in allowed:
        raise ApiError(403, "company_forbidden", "Société non autorisée.")
    return company_id


def _get(request_id):
    """Demande visible du compte (règles d'accès) ; sinon 404, sans révéler qu'elle existe."""
    demande = request.env["eguitra.support.request"].search([("id", "=", request_id)])
    if not demande:
        raise ApiError(404, "not_found", "Demande introuvable.")
    return demande


def _suivie(demande):
    """L'auteur et l'administration commentent, clôturent et rouvrent ; la direction lit seulement."""
    if demande.author_id != request.env.user and not _admin():
        raise ApiError(403, "forbidden", "Seuls l'auteur de la demande et l'administration de la plateforme la "
                                         "commentent et la font avancer.")


def _user_ref(user):
    return {"id": user.id, "name": user.name} if user else None


def _row(demande, now, holidays):
    sudo = demande.sudo()
    delays = demande._delays(now, holidays)
    return {
        "id": demande.id,
        "name": demande.name,
        "kind": demande.kind,
        "severity": demande.severity,
        "app": demande.app,
        "title": demande.title,
        "state": demande.state,
        "author": _user_ref(sudo.author_id),
        "mine": demande.author_id == request.env.user,
        "company": {"id": sudo.company_id.id, "name": sudo.company_id.name,
                    "entity": sudo.company_id.eguitra_entity or None},
        "date_submitted": demande.date_submitted,
        "date_taken": demande.date_taken or None,
        "date_resolved": demande.date_resolved or None,
        "date_closed": demande.date_closed or None,
        "qualification": demande.qualification or None,
        "credit_days": demande.credit_days or 0.0,
        "comment_count": len(sudo.comment_ids.filtered(lambda c: not c.event)),
        "take_over": delays["take_over"],
        "resolution": delays["resolution"],
    }


def _detail(demande):
    demande.invalidate_recordset()
    now = fields.Datetime.now()
    sudo = demande.sudo()
    me = request.env.user
    admin = _admin()
    follows = demande.author_id == me or admin
    final = demande.state in FINAL_STATES
    data = _row(demande, now, demande._holidays_for(demande, now))
    data.update({
        "description": demande.description,
        "response": demande.response or None,
        "planned_date": demande.planned_date or None,
        "credit_date": demande.credit_date or None,
        "taken_by": _user_ref(sudo.taken_by_id),
        "comments": [
            {"id": c.id, "author": _user_ref(c.author_id), "date": c.date, "body": c.body, "event": c.event,
             "mine": c.author_id == me}
            for c in sudo.comment_ids
        ],
        "can": {
            "comment": follows and not final,
            "close": follows and demande.state == "resolved",
            "reopen": follows and demande.state == "resolved",
            "manage": admin and not final,
        },
        "credit": demande._credit_of_quarter(demande.credit_date or fields.Date.context_today(demande))
        if demande.kind == "evolution" else None,
    })
    return data


def _managed_values(data):
    unknown = set(data) - set(MANAGED)
    if unknown:
        raise ApiError(400, "invalid_parameter", f"Champs non modifiables : {', '.join(sorted(unknown))}.")
    vals = {}
    if "state" in data:
        vals["state"] = _code(data["state"], STATE_CODES, "État")
    if "kind" in data:
        vals["kind"] = _code(data["kind"], KIND_CODES, "Type")
    if "severity" in data:
        vals["severity"] = _code(data["severity"], SEVERITY_CODES, "Gravité")
    if "app" in data:
        vals["app"] = _code(data["app"], app_codes(), "Application")
    if "response" in data:
        response = str(data["response"] or "").strip()
        if len(response) > TEXT_MAX:
            raise ApiError(422, "business_rule", f"Texte trop long : {TEXT_MAX} caractères au plus.")
        vals["response"] = response or False
    if "qualification" in data:
        vals["qualification"] = _code(data["qualification"], QUALIFICATION_CODES, "Qualification") \
            if data["qualification"] else False
    if "credit_days" in data:
        vals["credit_days"] = _days(data["credit_days"])
    if "planned_date" in data:
        vals["planned_date"] = _date(data["planned_date"])
    return vals


class EguitraSupportController(http.Controller):
    @api_route("/support/requests", methods=("GET",), profiles=INTERNES)
    def list_requests(self, **kw):
        """Demandes visibles du compte. Filtres : state (codes séparés par des virgules), kind, mine=1 (les
        siennes seulement), q (numéro ou titre)."""
        _interne()
        domain = []
        if kw.get("state"):
            domain.append(("state", "in", [_code(s, STATE_CODES, "État") for s in kw["state"].split(",") if s]))
        if kw.get("kind"):
            domain.append(("kind", "=", _code(kw["kind"], KIND_CODES, "Type")))
        if kw.get("mine") in ("1", "true"):
            domain.append(("author_id", "=", request.env.uid))
        if kw.get("q"):
            domain += ["|", ("name", "ilike", kw["q"]), ("title", "ilike", kw["q"])]
        Request = request.env["eguitra.support.request"]
        demandes = Request.search(domain, limit=int_arg(kw, "limit", 200, 1, 500), offset=int_arg(kw, "offset", 0, 0))
        now = fields.Datetime.now()
        holidays = Request._holidays_for(demandes, now)
        return [_row(d, now, holidays) for d in demandes]

    @api_route("/support/requests", methods=("POST",), profiles=INTERNES)
    def create_request(self, **_kw):
        """Dépôt : la réponse porte le numéro de la demande (accusé de dépôt)."""
        _interne()
        data = read_json()
        kind, title, description = require(data, "kind", "title", "description")
        demande = request.env["eguitra.support.request"].create({
            "kind": _code(kind, KIND_CODES, "Type"),
            "severity": _code(data.get("severity") or "mineure", SEVERITY_CODES, "Gravité"),
            "app": _code(data.get("app") or PLATFORM_APP, app_codes(), "Application"),
            "title": _line(title, TITLE_MAX),
            "description": _text(description, "description"),
            "company_id": _company(data.get("company_id")),
        })
        return _detail(demande)

    @api_route("/support/requests/<int:request_id>", methods=("GET",), profiles=INTERNES)
    def get_request(self, request_id, **_kw):
        _interne()
        return _detail(_get(request_id))

    @api_route("/support/requests/<int:request_id>/comments", methods=("POST",), profiles=INTERNES)
    def comment(self, request_id, **_kw):
        _interne()
        demande = _get(request_id)
        _suivie(demande)
        (body,) = require(read_json(), "body")
        request.env["eguitra.support.comment"].create({"request_id": demande.id, "body": _text(body, "body")})
        return _detail(demande)

    @api_route("/support/requests/<int:request_id>/close", methods=("POST",), profiles=INTERNES)
    def close(self, request_id, **_kw):
        """L'auteur confirme la résolution : la demande est close."""
        _interne()
        demande = _get(request_id)
        _suivie(demande)
        if demande.state != "resolved":
            raise ApiError(422, "business_rule", "Seule une demande résolue se clôt.")
        demande.write({"state": "closed"})
        return _detail(demande)

    @api_route("/support/requests/<int:request_id>/reopen", methods=("POST",), profiles=INTERNES)
    def reopen(self, request_id, **_kw):
        """Le problème persiste : la demande résolue repart en traitement, avec le motif dans le fil."""
        _interne()
        demande = _get(request_id)
        _suivie(demande)
        (body,) = require(read_json(), "body")
        if demande.state != "resolved":
            raise ApiError(422, "business_rule", "Seule une demande résolue se rouvre.")
        request.env["eguitra.support.comment"].create({"request_id": demande.id, "body": _text(body, "body")})
        demande.write({"state": "in_progress"})
        return _detail(demande)

    @api_route("/support/requests/<int:request_id>", methods=("PATCH",), profiles=ADMIN)
    def update_request(self, request_id, **_kw):
        """Administration : prise en charge, réponse, gravité, type, application, état, qualification,
        crédit et date de livraison proposée d'une évolution."""
        demande = _get(request_id)
        vals = _managed_values(read_json())
        if vals:
            demande.write(vals)
        return _detail(demande)

    @api_route("/support/summary", methods=("GET",), profiles=ADMIN)
    def summary(self, **_kw):
        """Synthèse de l'administration : demandes par état et par type, délais de prise en charge,
        retards, crédit d'évolutions consommé et restant par trimestre."""
        return request.env["eguitra.support.request"]._summary()
