"""API du plan d'actions (contrat §6) : registre unique des actions correctives et préventives.

Lecture : administration, direction et hsseq ; chef de parc pour les actions de ses sites et les siennes ;
tout compte interne pour les actions dont il est responsable (maintenance, qualité…). Création et
vérification d'efficacité par hsseq ; mise à jour, démarrage et clôture par le responsable ou hsseq ;
validation d'une action coûteuse par la direction."""

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, read_json, require
from odoo.addons.eguitra_finance.controllers.exporting import export_meta, table_response

from ..models.common import ACTION_ORIGINS, ACTION_STATUSES, CONTROL_LEVELS, OBJECT_MODELS
from .common import (
    HSSEQ,
    attachments_rows,
    companies,
    date_value,
    forbidden,
    get,
    history,
    hsseq_route,
    int_or_none,
    internal_only,
    is_hsseq,
    is_yard,
    number,
    page,
    page_args,
    profiles,
    reads_all,
    site_allowed,
    site_ref,
    text,
    user_ref,
    yard_domain,
)

SORTS = {"due_date": "due_date", "reference": "reference", "status": "status", "created_at": "create_date"}
# Origine d'une action -> (fiche de l'API, champ de l'action) ; une revue de direction n'a pas de fiche.
# Origine « audit » : l'action répond à un constat de l'audit (origin_id : le constat).
ORIGIN_SOURCES = {"event": ("event", "event_id"), "check": ("check", "check_id"), "risk": ("risk", "risk_id"),
                  "audit": ("finding", "finding_id")}
CLOSED_SOURCES = {"event": ("closed",), "risk": ("archived",)}
TRANSITIONS = ("start", "close", "verify", "approve", "cancel", "reopen")


def today():
    return fields.Date.context_today(request.env.user)


def is_owner(action):
    return action.sudo().owner_id == request.env.user


def can_read(action):
    if reads_all() or is_owner(action):
        return True
    if is_yard():
        return site_allowed(action.site_id)
    return False


def read_domain(kw):
    """Actions visibles du compte, dans ses sociétés."""
    domain = [("company_id", "in", companies(kw).ids)]
    if reads_all():
        return domain
    own = [("owner_id", "=", request.env.uid)]
    if is_yard():
        return domain + ["|"] + own + yard_domain()
    return domain + own


def user_transitions(action):
    """Transitions que le compte peut lancer maintenant sur l'action."""
    allowed = action._transitions()
    owner, hsseq, direction = is_owner(action), is_hsseq(), "direction" in profiles()
    result = []
    for transition in allowed:
        if transition in ("start", "close") and (owner or hsseq):
            result.append(transition)
        elif transition in ("cancel", "reopen") and hsseq:
            result.append(transition)
        elif transition == "verify" and hsseq and (not action.verification_date or action.verification_date <= today()):
            result.append(transition)
        elif transition == "approve" and direction:
            result.append(transition)
    return result


def rights(action):
    transitions = user_transitions(action)
    return {"can_edit": (is_owner(action) or is_hsseq()) and action.status not in ("closed", "cancelled"),
            "can_close": "close" in transitions,
            "can_approve": "verify" in transitions or "approve" in transitions}


def action_line(action):
    action = action.sudo()
    day = today()
    origin_label = None
    if action.event_id:
        origin_label = f"{action.event_id.reference} {action.event_id.title}"
    elif action.check_id:
        origin_label = action.check_id.reference
    elif action.risk_id:
        origin_label = f"{action.risk_id.reference} {action.risk_id.feared_event[:120]}"
    elif action.finding_id:
        origin_label = f"{action.finding_id.reference} {action.finding_id.description[:120]}"
    return {
        "id": action.id, "reference": action.reference, "description": action.description, "origin": action.origin,
        "origin_id": action.origin_id or action.event_id.id or action.check_id.id or action.risk_id.id
        or action.finding_id.id or None,
        "origin_label": origin_label,
        "event": {"id": action.event_id.id, "reference": action.event_id.reference} if action.event_id else None,
        "control_level": action.control_level or None, "owner": user_ref(action.owner_id), "due_date": action.due_date,
        "status": action.status, "overdue": action._days_overdue(day) > 0, "days_overdue": action._days_overdue(day),
        "verification_required": action._verification_required(), "verification_date": action.verification_date or None,
        "site": site_ref(action.site_id), "estimated_cost": action.estimated_cost or 0,
        "approval_required": action._approval_required(),
        # Résultat de la vérification d'efficacité (nul tant qu'elle n'est pas faite).
        "effective": action.effective if action.verified_at else None,
        # Validation de la direction attendue : action coûteuse ni validée, ni close, ni annulée.
        "approval_pending": action._approval_pending(),
    }


def action_detail(action):
    action = action.sudo()
    line = action_line(action)
    line.update({
        "expected_evidence": action.expected_evidence or None,
        "evidence": attachments_rows("action", action),
        "management_approval": {"required": action._is_costly(), "approved_at": action.approved_at or None,
                                "approved_by": user_ref(action.approved_by), "approved_cost": action.approved_cost or None},
        "created_at": action.create_date, "created_by": user_ref(action.create_uid),
        "started_at": action.started_at or None, "done_at": action.done_at or None,
        "verified_at": action.verified_at or None, "verified_by": user_ref(action.verified_by),
        "effective": action.effective if action.verified_at else None,
        "verification_comment": action.verification_comment or None, "closed_at": action.closed_at or None,
        "cancel_reason": action.cancel_reason or None, "reopen_reason": action.reopen_reason or None,
        "reminders": [{"kind": r.kind, "date": r.date, "recipients": [user_ref(u) for u in r.recipient_ids]}
                      for r in action.reminder_ids],
        "history": history("action", action),
        "transitions": user_transitions(action),
        "rights": rights(action),
    })
    return line


def get_action(action_id):
    action = get("eguitra.hsseq.action", action_id, "Action")
    if not can_read(action):
        raise ApiError(404, "not_found", "Action introuvable.")
    return action


def approval_pending_domain(comps):
    """Actions coûteuses (au seuil des paramètres de leur société) en attente de la validation de la direction."""
    Settings = request.env["eguitra.hsseq.settings"]
    branches = []
    for company in comps:
        threshold = Settings._get(company).costly_action_threshold
        if threshold:
            branches.append(["&", ("company_id", "=", company.id), ("estimated_cost", ">=", threshold)])
    if not branches:
        return [("id", "=", 0)]
    costly = ["|"] * (len(branches) - 1) + [term for branch in branches for term in branch]
    return [("approved_at", "=", False), ("status", "not in", ("closed", "cancelled"))] + costly


def list_domain(kw):
    domain = read_domain(kw)
    if kw.get("status"):
        domain.append(("status", "in", kw["status"].split(",")))
    if kw.get("origin"):
        domain.append(("origin", "=", kw["origin"]))
    if kw.get("owner_id"):
        domain.append(("owner_id", "=", int_or_none(kw, "owner_id")))
    if str(kw.get("mine", "")) in ("1", "true"):
        domain.append(("owner_id", "=", request.env.uid))
    if str(kw.get("overdue", "")) in ("1", "true"):
        domain += [("status", "in", ("todo", "in_progress")), ("due_date", "<", today())]
    if kw.get("site_id"):
        domain.append(("site_id", "=", int_or_none(kw, "site_id")))
    if kw.get("due_before"):
        domain.append(("due_date", "<=", date_value(kw, "due_before")))
    if kw.get("event_id"):
        domain.append(("event_id", "=", int_or_none(kw, "event_id")))
    if str(kw.get("approval_pending", "")) in ("1", "true"):
        domain += approval_pending_domain(companies(kw))
    if kw.get("search"):
        domain += ["|", ("reference", "ilike", kw["search"]), ("description", "ilike", kw["search"])]
    return domain


class EguitraHsseqActions(http.Controller):
    @hsseq_route("/hsseq/actions", profiles=None)
    def actions(self, **kw):
        internal_only()
        domain = list_domain(kw)
        offset, limit, order = page_args(kw, "due_date", SORTS)
        Action = request.env["eguitra.hsseq.action"].sudo()
        rows = Action.search(domain, offset=offset, limit=limit, order=order)
        by_status = {code: Action.search_count(domain + [("status", "=", code)]) for code, _l in ACTION_STATUSES}
        counts = {"by_status": by_status,
                  "overdue": Action.search_count(domain + [("status", "in", ("todo", "in_progress")),
                                                           ("due_date", "<", today())]),
                  "verifications_due": Action.search_count(domain + [("status", "=", "to_verify"),
                                                                     ("verification_date", "<=", today())]),
                  "approval_pending": Action.search_count(domain + approval_pending_domain(companies(kw)))}
        return page([action_line(a) for a in rows], Action.search_count(domain), offset, limit, counts)

    @hsseq_route("/hsseq/actions/<int:action_id>", profiles=None)
    def action(self, action_id, **_kw):
        internal_only()
        return action_detail(get_action(action_id))

    def _values(self, data, action=None):
        values = {}
        if "description" in data:
            values["description"] = text(data, "description", 4000)
            if not values["description"]:
                raise ApiError(400, "missing_fields", "Description de l'action manquante.", fields=["description"])
        if "control_level" in data:
            if data["control_level"] and data["control_level"] not in dict(CONTROL_LEVELS):
                raise ApiError(400, "invalid_parameter", "Niveau de maîtrise inconnu.", fields=["control_level"])
            values["control_level"] = data["control_level"] or False
        if "expected_evidence" in data:
            values["expected_evidence"] = text(data, "expected_evidence", 2000)
        if "estimated_cost" in data:
            values["estimated_cost"] = max(number(data, "estimated_cost"), 0.0)
        if "owner_id" in data:
            owner = request.env["res.users"].sudo().browse(int_or_none(data, "owner_id") or 0).exists()
            company = action.company_id if action else request.env.company
            if not owner or owner.share or company not in owner.company_ids:
                raise ApiError(422, "business_rule", "Responsable : un compte interne de la société.", fields=["owner_id"])
            values["owner_id"] = owner.id
        if "due_date" in data:
            values["due_date"] = date_value(data, "due_date")
            if not values["due_date"]:
                raise ApiError(400, "missing_fields", "Échéance manquante.", fields=["due_date"])
        return values

    @hsseq_route("/hsseq/actions", methods=("POST",), profiles=HSSEQ)
    def create_action(self, **_kw):
        data = read_json()
        require(data, "description", "owner_id", "due_date")
        origin = data.get("origin") or "event"
        if origin not in dict(ACTION_ORIGINS):
            raise ApiError(400, "invalid_parameter", "Origine inconnue.", fields=["origin"])
        values = self._values(data)
        values["origin"] = origin
        company = request.env.company
        origin_id = int_or_none(data, "origin_id")
        if origin in ORIGIN_SOURCES:
            if not origin_id:
                raise ApiError(400, "missing_fields", "Fiche d'origine manquante.", fields=["origin_id"])
            key, field = ORIGIN_SOURCES[origin]
            source = get(OBJECT_MODELS[key], origin_id, "Fiche d'origine")
            if origin in CLOSED_SOURCES and source.status in CLOSED_SOURCES[origin]:
                raise ApiError(422, "invalid_transition", "Fiche d'origine close ou archivée : rouvrez-la avant d'y "
                                                          "ajouter une action.")
            if origin == "audit" and source.audit_id.status not in ("planned", "done"):
                raise ApiError(422, "invalid_transition", "Audit clos ou annulé : rouvrez-le avant d'y ajouter une "
                                                          "action.")
            company = source.company_id
            values[field] = source.id
        values.update(origin_id=origin_id or 0, company_id=company.id)
        if company not in request.env.companies:
            raise forbidden("Société non autorisée.")
        action = request.env["eguitra.hsseq.action"].sudo().create(values)
        return action_detail(action)

    @hsseq_route("/hsseq/actions/<int:action_id>", methods=("PATCH",), profiles=None)
    def update_action(self, action_id, **_kw):
        internal_only()
        action = get_action(action_id)
        data = read_json()
        if not rights(action)["can_edit"]:
            raise forbidden("Seuls le responsable de l'action et le Responsable HSSEQ la mettent à jour, tant "
                            "qu'elle n'est ni close ni annulée.")
        if {"owner_id", "due_date", "estimated_cost"} & set(data) and not is_hsseq():
            raise forbidden("Responsable, échéance et coût estimé d'une action : réservés au Responsable HSSEQ.")
        action.write(self._values(data, action))
        return action_detail(action)

    @hsseq_route("/hsseq/actions/<int:action_id>/<string:transition>", methods=("POST",), profiles=None)
    def action_transition(self, action_id, transition, **_kw):
        internal_only()
        if transition not in TRANSITIONS:
            raise ApiError(404, "not_found", "Transition inconnue.")
        action = get_action(action_id)
        data = read_json()
        owner, hsseq = is_owner(action), is_hsseq()
        if transition in ("start", "close") and not (owner or hsseq):
            raise forbidden("Le responsable de l'action ou le Responsable HSSEQ la démarre et la clôt.")
        if transition in ("verify", "cancel", "reopen") and not hsseq:
            raise forbidden("Réservé au Responsable HSSEQ.")
        if transition == "approve" and "direction" not in profiles():
            raise forbidden("La validation d'une action coûteuse revient à la direction.")
        if transition == "start":
            action.action_start()
        elif transition == "close":
            action.action_close()
        elif transition == "verify":
            if "effective" not in data:
                raise ApiError(400, "missing_fields", "Efficace ou non ?", fields=["effective"])
            action.action_verify(bool(data["effective"]), text(data, "comment"), date_value(data, "new_due_date"))
        elif transition == "approve":
            action.action_approve()
        elif transition == "cancel":
            action.action_cancel(data.get("reason"))
        else:
            action.action_reopen(data.get("reason"))
        return action_detail(action)

    @hsseq_route("/hsseq/actions/export.xlsx", profiles=("admin", "direction", "hsseq", "exploitation"))
    def export(self, **kw):
        Action = request.env["eguitra.hsseq.action"].sudo()
        rows = Action.search(list_domain(kw), order="due_date, id", limit=10000)
        statuses, origins, levels = dict(ACTION_STATUSES), dict(ACTION_ORIGINS), dict(CONTROL_LEVELS)
        day = today()
        sheet = {
            "title": "Plan d'actions HSSEQ", "meta": export_meta(companies(kw)),
            "columns": [("Référence", "text"), ("Origine", "text"), ("Fiche d'origine", "text"), ("Action", "text"),
                        ("Niveau de maîtrise", "text"), ("Responsable", "text"), ("Échéance", "date"),
                        ("Statut", "text"), ("Jours de retard", "int"), ("Vérification d'efficacité", "date"),
                        ("Efficace", "text"), ("Coût estimé", "money"), ("Site", "text")],
            "rows": [[a.reference, origins.get(a.origin), (a.event_id.reference or a.check_id.reference or ""),
                      a.description, levels.get(a.control_level, ""), a.owner_id.name, a.due_date,
                      statuses.get(a.status), a._days_overdue(day), a.verification_date or None,
                      ("Oui" if a.effective else "Non") if a.verified_at else "", a.estimated_cost, a.site_id.name or ""]
                     for a in rows],
            "totals": None,
        }
        return table_response(f"plan_actions_hsseq_{day:%Y%m%d}", [sheet])


def overdue_lines(comps, sites=None, limit=8):
    """Actions en retard (cockpit), retard décroissant."""
    domain = [("company_id", "in", comps.ids), ("status", "in", ("todo", "in_progress")), ("due_date", "<", today())]
    if sites:
        domain.append(("site_id", "in", sites.ids))
    Action = request.env["eguitra.hsseq.action"].sudo()
    rows = Action.search(domain, order="due_date, id", limit=limit)
    return {"total": Action.search_count(domain), "items": [action_line(a) for a in rows]}

