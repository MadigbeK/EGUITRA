"""API du registre des risques (spécification §3, §7) : liste et fiche, matrice 5 × 5 (brute et résiduelle),
mesures de maîtrise, cycle (à évaluer, en vigueur, archivé), revue, registre en Excel.

Gestion par hsseq ; le propriétaire d'un risque le met à jour, ajoute ses mesures et en fait la revue.
Lecture : administration, direction, hsseq ; chef de parc et auditeur pour les risques de leurs sites,
fermée par défaut (aucun sans site rattaché ; un risque sans site n'est lu que des profils de lecture
complète) ; tout compte interne pour les risques dont il est propriétaire."""

from collections import Counter

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, read_json, require
from odoo.addons.eguitra_finance.controllers.exporting import export_meta, table_response

from ..models.common import (
    CONTROL_LEVELS,
    LEVELS,
    MEASURE_STATUSES,
    RISK_NATURES,
    RISK_STATUSES,
    VEHICLE_KINDS,
    matrix_cells,
)
from .actions import action_line
from .common import (
    COCKPIT,
    HSSEQ,
    attachments_rows,
    companies,
    date_value,
    forbidden,
    get,
    history,
    hsseq_route,
    in_scope,
    int_or_none,
    internal_only,
    is_hsseq,
    page,
    page_args,
    reads_all,
    scope_domain,
    site_ref,
    text,
    user_ref,
)

SORTS = {"residual_criticality": "residual_criticality", "raw_criticality": "raw_criticality",
         "review_date": "review_date", "reference": "reference", "status": "status"}
TRANSITIONS = ("activate", "review", "archive", "reactivate")
TEXT_FIELDS = {"activity": 200, "hazard": 4000, "feared_event": 4000}
NOTE_FIELDS = ("raw_severity", "raw_probability", "residual_severity", "residual_probability")


def today():
    return fields.Date.context_today(request.env.user)


def is_owner(risk):
    return risk.sudo().owner_id == request.env.user


def can_read(risk):
    """Lecture complète, propriétaire, ou risque d'un site du compte (portée fermée par défaut : un risque
    sans site n'est lu que par les profils de lecture complète et son propriétaire)."""
    return reads_all() or is_owner(risk) or in_scope(risk.site_id)


def read_domain(kw):
    domain = [("company_id", "in", companies(kw).ids)]
    if reads_all():
        return domain
    return domain + ["|", ("owner_id", "=", request.env.uid)] + scope_domain()


def user_transitions(risk):
    hsseq, owner = is_hsseq(), is_owner(risk)
    return [t for t in risk._transitions() if hsseq or (t == "review" and owner)]


def rights(risk):
    transitions = user_transitions(risk)
    return {"can_edit": (is_hsseq() or is_owner(risk)) and risk.status != "archived",
            "can_close": "archive" in transitions, "can_approve": "review" in transitions}


def scores(risk, prefix):
    return {"severity": risk[f"{prefix}_severity"], "probability": risk[f"{prefix}_probability"],
            "criticality": risk[f"{prefix}_criticality"], "level": risk[f"{prefix}_level"] or None}


def risk_line(risk):
    risk = risk.sudo()
    return {
        "id": risk.id, "reference": risk.reference, "nature": risk.nature, "vehicle_kind": risk.vehicle_kind or None,
        "activity": risk.activity or None, "site": site_ref(risk.site_id), "hazard": risk.hazard,
        "feared_event": risk.feared_event, "raw": scores(risk, "raw"), "residual": scores(risk, "residual"),
        "owner": user_ref(risk.owner_id), "review_date": risk.review_date, "review_overdue": risk._review_overdue(),
        "status": risk.status, "measures_count": len(risk.measure_ids),
        "open_actions": len(risk.action_ids.filtered(lambda a: a.status not in ("closed", "cancelled"))),
    }


def measure_row(measure):
    measure = measure.sudo()
    return {"id": measure.id, "control_level": measure.control_level, "description": measure.description,
            "status": measure.status, "sequence": measure.sequence,
            "action": {"id": measure.action_id.id, "reference": measure.action_id.reference} if measure.action_id else None}


def risk_detail(risk):
    risk = risk.sudo()
    row = risk_line(risk)
    row.update({
        "company": {"id": risk.company_id.id, "name": risk.company_id.name},
        "measures": [measure_row(m) for m in risk.measure_ids],
        "actions": [action_line(a) for a in risk.action_ids],
        "last_review_at": risk.last_review_at or None, "last_reviewed_by": user_ref(risk.last_reviewed_by),
        "review_comment": risk.review_comment or None, "archive_reason": risk.archive_reason or None,
        "created_at": risk.create_date, "created_by": user_ref(risk.create_uid),
        "attachments": attachments_rows("risk", risk),
        "history": history("risk", risk),
        "transitions": user_transitions(risk),
        "rights": rights(risk),
    })
    return row


def get_risk(risk_id):
    risk = get("eguitra.hsseq.risk", risk_id, "Risque")
    if not can_read(risk):
        raise ApiError(404, "not_found", "Risque introuvable.")
    return risk


def note(data, key):
    value = int_or_none(data, key)
    if value is None or not 1 <= value <= 5:
        raise ApiError(400, "invalid_parameter", "Gravités et probabilités se notent de 1 à 5.", fields=[key])
    return value


def risk_values(data, risk=None):
    """Champs d'un risque (création ou mise à jour) ; propriétaire réservé à hsseq."""
    values = {}
    if "nature" in data:
        if data["nature"] not in dict(RISK_NATURES):
            raise ApiError(400, "invalid_parameter", "Nature de risque inconnue.", fields=["nature"])
        values["nature"] = data["nature"]
    if "vehicle_kind" in data:
        if data["vehicle_kind"] and data["vehicle_kind"] not in dict(VEHICLE_KINDS):
            raise ApiError(400, "invalid_parameter", "Profil de véhicule : tanker ou tipper.", fields=["vehicle_kind"])
        values["vehicle_kind"] = data["vehicle_kind"] or False
    for key, limit in TEXT_FIELDS.items():
        if key in data:
            values[key] = text(data, key, limit)
            if key != "activity" and not values[key]:
                raise ApiError(400, "missing_fields", "Danger et événement redouté sont à décrire.", fields=[key])
    for key in NOTE_FIELDS:
        if key in data:
            values[key] = note(data, key)
    if "site_id" in data:
        site = get("eguitra.hsseq.site", data["site_id"], "Site") if data["site_id"] else None
        values["site_id"] = site.id if site else False
    if "review_date" in data:
        values["review_date"] = date_value(data, "review_date")
        if not values["review_date"]:
            raise ApiError(400, "missing_fields", "Date de revue manquante.", fields=["review_date"])
    if "owner_id" in data:
        owner = request.env["res.users"].sudo().browse(int_or_none(data, "owner_id") or 0).exists()
        company = risk.company_id if risk else request.env.company
        if not owner or owner.share or company not in owner.company_ids:
            raise ApiError(422, "business_rule", "Propriétaire : un compte interne de la société.", fields=["owner_id"])
        values["owner_id"] = owner.id
    return values


def measure_values(data, partial=False):
    values = {}
    if not partial or "control_level" in data:
        if data.get("control_level") not in dict(CONTROL_LEVELS):
            raise ApiError(400, "invalid_parameter", "Niveau de maîtrise : elimination, substitution, engineering, "
                                                     "administrative ou ppe.", fields=["control_level"])
        values["control_level"] = data["control_level"]
    if not partial or "description" in data:
        values["description"] = text(data, "description", 2000)
        if not values["description"]:
            raise ApiError(400, "missing_fields", "Description de la mesure manquante.", fields=["description"])
    if "status" in data:
        if data["status"] not in dict(MEASURE_STATUSES):
            raise ApiError(400, "invalid_parameter", "État : planned, in_place ou to_review.", fields=["status"])
        values["status"] = data["status"]
    if "sequence" in data:
        values["sequence"] = int_or_none(data, "sequence") or 10
    if "action_id" in data:
        action = get("eguitra.hsseq.action", data["action_id"], "Action") if data["action_id"] else None
        values["action_id"] = action.id if action else False
    return values


def list_domain(kw, with_status=True):
    """Domaine de la liste (et de ses compteurs, sans le filtre d'état : with_status=False)."""
    domain = read_domain(kw)
    if with_status:
        domain.append(("status", "in", kw["status"].split(",")) if kw.get("status") else ("status", "!=", "archived"))
    # Case de la matrice : gravité et probabilité brutes ou résiduelles.
    for key in NOTE_FIELDS:
        if kw.get(key):
            domain.append((key, "=", note(kw, key)))
    for key in ("nature", "vehicle_kind"):
        if kw.get(key):
            domain.append((key, "in", kw[key].split(",")))
    if kw.get("site_id"):
        domain.append(("site_id", "=", int_or_none(kw, "site_id")))
    if kw.get("owner_id"):
        domain.append(("owner_id", "=", int_or_none(kw, "owner_id")))
    if str(kw.get("mine", "")) in ("1", "true"):
        domain.append(("owner_id", "=", request.env.uid))
    if kw.get("level"):
        domain.append(("residual_level", "in", kw["level"].split(",")))
    if kw.get("raw_level"):
        domain.append(("raw_level", "in", kw["raw_level"].split(",")))
    if str(kw.get("review_overdue", "")) in ("1", "true"):
        domain += [("status", "=", "active"), ("review_date", "<", today())]
    if kw.get("search"):
        q = kw["search"]
        domain += ["|", "|", "|", ("reference", "ilike", q), ("hazard", "ilike", q), ("feared_event", "ilike", q),
                   ("activity", "ilike", q)]
    return domain


def risk_matrix(risks, settings):
    """Matrices 5 × 5 des risques : comptes par case de la criticité brute et de la résiduelle."""
    raw = Counter((r.raw_severity, r.raw_probability) for r in risks)
    residual = Counter((r.residual_severity, r.residual_probability) for r in risks)
    return {"raw": matrix_cells(raw, settings._level), "residual": matrix_cells(residual, settings._level),
            "total": len(risks)}


class EguitraHsseqRisks(http.Controller):
    @hsseq_route("/hsseq/risks", profiles=None)
    def risks(self, **kw):
        internal_only()
        domain = list_domain(kw)
        offset, limit, order = page_args(kw, "-residual_criticality", SORTS)
        Risk = request.env["eguitra.hsseq.risk"].sudo()
        rows = Risk.search(domain, offset=offset, limit=limit, order=order)
        everything = Risk.search(domain)
        counts = {
            "by_status": {code: Risk.search_count(list_domain(kw, with_status=False) + [("status", "=", code)])
                          for code, _l in RISK_STATUSES},
            "by_raw_level": {code: len(everything.filtered(lambda r, c=code: r.raw_level == c)) for code, _l in LEVELS},
            "by_residual_level": {code: len(everything.filtered(lambda r, c=code: r.residual_level == c))
                                  for code, _l in LEVELS},
            "review_overdue": len(everything.filtered(lambda r: r._review_overdue())),
        }
        return page([risk_line(r) for r in rows], len(everything), offset, limit, counts)

    @hsseq_route("/hsseq/risks/matrix", profiles=None)
    def matrix(self, **kw):
        internal_only()
        risks = request.env["eguitra.hsseq.risk"].sudo().search(list_domain(kw))
        settings = request.env["eguitra.hsseq.settings"]._get(companies(kw)[:1] or request.env.company)
        return risk_matrix(risks, settings)

    @hsseq_route("/hsseq/risks/<int:risk_id>", profiles=None)
    def risk(self, risk_id, **_kw):
        internal_only()
        return risk_detail(get_risk(risk_id))

    @hsseq_route("/hsseq/risks", methods=("POST",), profiles=HSSEQ)
    def create_risk(self, **_kw):
        data = read_json()
        require(data, "nature", "hazard", "feared_event", "owner_id", "raw_severity", "raw_probability")
        company = companies(data)[:1] if data.get("company_id") else request.env.company
        values = risk_values(data)
        # Sans mesure encore évaluée : le résiduel part du brut.
        for kind in ("severity", "probability"):
            values.setdefault(f"residual_{kind}", values[f"raw_{kind}"])
        risk = request.env["eguitra.hsseq.risk"].sudo().create(dict(values, company_id=company.id))
        for measure in data.get("measures") or []:
            if not isinstance(measure, dict):
                raise ApiError(400, "invalid_parameter", "Mesure invalide.", fields=["measures"])
            request.env["eguitra.hsseq.risk.measure"].sudo().create(dict(measure_values(measure), risk_id=risk.id))
        return risk_detail(risk)

    @hsseq_route("/hsseq/risks/<int:risk_id>", methods=("PATCH",), profiles=None)
    def update_risk(self, risk_id, **_kw):
        internal_only()
        risk = get_risk(risk_id)
        if not rights(risk)["can_edit"]:
            raise forbidden("Seuls le propriétaire du risque et le Responsable HSSEQ le mettent à jour, tant qu'il "
                            "n'est pas archivé.")
        data = read_json()
        if "owner_id" in data and not is_hsseq():
            raise forbidden("Le propriétaire d'un risque est désigné par le Responsable HSSEQ.")
        risk.write(risk_values(data, risk))
        return risk_detail(risk)

    @hsseq_route("/hsseq/risks/<int:risk_id>/<string:transition>", methods=("POST",), profiles=None)
    def transition(self, risk_id, transition, **_kw):
        internal_only()
        if transition not in TRANSITIONS:
            raise ApiError(404, "not_found", "Transition inconnue.")
        risk = get_risk(risk_id)
        data = read_json()
        if transition not in user_transitions(risk):
            if transition in risk._transitions():
                raise forbidden("Transition réservée au Responsable HSSEQ (la revue : aussi au propriétaire).")
            risk._require(transition)
        if transition == "activate":
            risk.action_activate()
        elif transition == "review":
            risk.action_review(text(data, "comment", 2000), date_value(data, "next_review_date"))
        elif transition == "archive":
            risk.action_archive_risk(data.get("reason"))
        else:
            risk.action_reactivate(data.get("reason"))
        return risk_detail(risk)

    # ─── Mesures de maîtrise ──────────────────────────────────────────────

    def _editable(self, risk_id):
        risk = get_risk(risk_id)
        if not rights(risk)["can_edit"]:
            raise forbidden("Mesures d'un risque : son propriétaire ou le Responsable HSSEQ, tant qu'il n'est pas "
                            "archivé.")
        return risk

    def _measure(self, risk, measure_id):
        measure = risk.sudo().measure_ids.filtered(lambda m: m.id == measure_id)
        if not measure:
            raise ApiError(404, "not_found", "Mesure introuvable sur ce risque.")
        return measure

    @hsseq_route("/hsseq/risks/<int:risk_id>/measures", methods=("POST",), profiles=None)
    def create_measure(self, risk_id, **_kw):
        internal_only()
        risk = self._editable(risk_id)
        measure = request.env["eguitra.hsseq.risk.measure"].sudo().create(
            dict(measure_values(read_json()), risk_id=risk.id))
        measure._journal_risk("measure_added")
        return risk_detail(risk)

    @hsseq_route("/hsseq/risks/<int:risk_id>/measures/<int:measure_id>", methods=("PATCH",), profiles=None)
    def update_measure(self, risk_id, measure_id, **_kw):
        internal_only()
        risk = self._editable(risk_id)
        measure = self._measure(risk, measure_id)
        measure.write(measure_values(read_json(), partial=True))
        measure._journal_risk("measure_updated")
        return risk_detail(risk)

    @hsseq_route("/hsseq/risks/<int:risk_id>/measures/<int:measure_id>", methods=("DELETE",), profiles=None)
    def delete_measure(self, risk_id, measure_id, **_kw):
        internal_only()
        risk = self._editable(risk_id)
        measure = self._measure(risk, measure_id)
        measure._journal_risk("measure_removed")
        measure.unlink()
        return risk_detail(risk)

    # ─── Registre ─────────────────────────────────────────────────────────

    @hsseq_route("/hsseq/risks/export.xlsx", profiles=COCKPIT)
    def export(self, **kw):
        Risk = request.env["eguitra.hsseq.risk"].sudo()
        rows = Risk.search(list_domain(kw), order="residual_criticality desc, raw_criticality desc, id", limit=10000)
        natures, levels, statuses = dict(RISK_NATURES), dict(LEVELS), dict(RISK_STATUSES)
        kinds, controls = dict(VEHICLE_KINDS), dict(CONTROL_LEVELS)
        sheet = {
            "title": "Registre des risques HSSEQ", "meta": export_meta(companies(kw)),
            "columns": [("Référence", "text"), ("Nature", "text"), ("Profil", "text"), ("Activité", "text"),
                        ("Site", "text"), ("Danger", "text"), ("Événement redouté", "text"), ("G brute", "int"),
                        ("P brute", "int"), ("Criticité brute", "int"), ("Niveau brut", "text"), ("G résiduelle", "int"),
                        ("P résiduelle", "int"), ("Criticité résiduelle", "int"), ("Niveau résiduel", "text"),
                        ("Mesures", "text"), ("Propriétaire", "text"), ("Prochaine revue", "date"), ("État", "text")],
            "rows": [[r.reference, natures.get(r.nature), kinds.get(r.vehicle_kind, "Tous"), r.activity or "",
                      r.site_id.name or "Tous", r.hazard, r.feared_event, r.raw_severity, r.raw_probability,
                      r.raw_criticality, levels.get(r.raw_level, ""), r.residual_severity, r.residual_probability,
                      r.residual_criticality, levels.get(r.residual_level, ""),
                      " ; ".join(f"{controls[m.control_level]} : {m.description}" for m in r.measure_ids),
                      r.owner_id.name, r.review_date, statuses.get(r.status)] for r in rows],
            "totals": None,
        }
        return table_response(f"registre_risques_hsseq_{fields.Date.context_today(request.env.user):%Y%m%d}", [sheet])
