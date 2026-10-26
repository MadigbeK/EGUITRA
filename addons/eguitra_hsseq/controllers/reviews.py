"""API de la revue de direction (spécification §3, §8, §12 lot 3) : préparation (période, date, participants,
éléments d'entrée générés par le noyau), tenue, décisions et leurs actions (origine « revue »), clôture,
compte rendu en PDF rendu par le noyau.

Droits : la direction et hsseq préparent, tiennent et closent la revue et y enregistrent les décisions ; la
réouverture d'une revue close revient au seul Responsable HSSEQ, avec un motif. Lecture : administration,
direction, hsseq et auditeur (lecture seule, ses sociétés, utile aux audits ISO) ; revue de société, sans
bornage par site, que le chef de parc ne lit pas."""

import copy

from odoo import fields, http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, read_json, require

from ..models.cockpit import period_label
from ..models.common import (
    ACTION_STATUSES,
    AUDIT_STANDARDS,
    CONTROL_LEVELS,
    DECISION_TOPICS,
    EVENT_TYPES,
    FINDING_CLASSES,
    INDICATOR_STATUSES,
    LEVELS,
    REQUIREMENT_SOURCES,
    REQUIREMENT_STATUSES,
    REVIEW_STATES,
    SCENARIOS,
    VIOLATION_TYPES,
)
from ..models.report import UNIT_LABELS
from ..models.review import review_months
from .actions import action_line
from .common import (
    attachments_rows,
    companies,
    company_ref,
    date_value,
    forbidden,
    get,
    history,
    hsseq_route,
    ids_list,
    int_or_none,
    is_auditor,
    is_hsseq,
    number,
    page,
    page_args,
    profiles,
    text,
    user_ref,
)
from .reports import fmt_value

REVIEW_READ = ("admin", "direction", "hsseq", "auditeur")
REVIEW_WRITE = ("direction", "hsseq")
TRANSITIONS = ("refresh", "hold", "close", "reopen")
SORTS = {"planned_date": "planned_date", "reference": "reference", "state": "state"}


def today():
    return fields.Date.context_today(request.env.user)


def writer():
    return bool(profiles() & set(REVIEW_WRITE))


def review_rights(review):
    transitions = [t for t in review._transitions() if writer() and (t != "reopen" or is_hsseq())]
    return transitions, {"can_edit": writer() and review.state != "closed", "can_close": "close" in transitions,
                         "can_approve": "hold" in transitions}


def is_driver(user):
    return bool(user) and "conducteur" in user.sudo()._eguitra_profiles()


def person(user):
    """Compte cité par une revue : l'auditeur lit les noms du personnel interne (participants,
    responsables), jamais celui d'un conducteur."""
    if not user:
        return None
    if is_auditor() and is_driver(user):
        return {"id": user.id, "name": None}
    return user_ref(user)


def review_action(action):
    line = action_line(action)
    if is_auditor() and is_driver(action.sudo().owner_id):
        line["owner"] = {"id": action.owner_id.id, "name": None}
    return line


def auditor_inputs(inputs):
    """Éléments d'entrée lus par l'auditeur : sans les indicateurs d'alcootest, sans nom de conducteur."""
    if not inputs or not is_auditor():
        return inputs
    inputs = copy.deepcopy(inputs)
    inputs["indicators"] = [i for i in inputs.get("indicators") or [] if not i["code"].startswith("breath_test")]
    items = [(item, "owner") for section, key in (("actions", "overdue_items"), ("risks", "high_residual"))
             for item in (inputs.get(section) or {}).get(key) or []]
    ids = {item.get("owner_id") for item, _k in items if item.get("owner_id")}
    drivers = {u.id for u in request.env["res.users"].sudo().browse(list(ids)).exists() if is_driver(u)}
    for item, key in items:
        if item.get("owner_id") in drivers:
            item[key] = None
    return inputs


def review_inputs(review):
    """Éléments d'entrée servis : ceux du jour pour une revue préparée (calculés à la volée, sans écriture),
    figés à la tenue ensuite ; bornés pour l'auditeur."""
    review = review.sudo()
    inputs = review._compute_inputs() if review.state == "prepared" or not review.inputs else review.inputs
    return auditor_inputs(inputs)


def decision_row(decision):
    decision = decision.sudo()
    return {"id": decision.id, "sequence": decision.sequence, "topic": decision.topic,
            "description": decision.description, "owner": person(decision.owner_id),
            "due_date": decision.due_date or None, "action": review_action(decision.action_id) if decision.action_id
            else None}


def review_line(review):
    review = review.sudo()
    open_actions = review.action_ids.filtered(lambda a: a.status not in ("closed", "cancelled"))
    return {"id": review.id, "reference": review.reference, "title": review.title,
            "company": company_ref(review.company_id),
            "period": {"from": review.period_start, "to": review.period_end}, "planned_date": review.planned_date,
            "held_on": review.held_on or None, "state": review.state, "decisions_count": len(review.decision_ids),
            "actions_count": len(review.action_ids), "open_actions": len(open_actions),
            "participants_count": len(review.participant_ids)}


def review_detail(review):
    review = review.sudo()
    transitions, rights = review_rights(review)
    row = review_line(review)
    row.update({
        "participants": [person(u) for u in review.participant_ids],
        "external_participants": review.external_participants or None, "agenda": review.agenda or None,
        "inputs": auditor_inputs(review.inputs) or None, "inputs_generated_at": review.inputs_generated_at or None,
        "minutes": review.minutes or None, "conclusion": review.conclusion or None,
        "decisions": [decision_row(d) for d in review.decision_ids],
        "actions": [review_action(a) for a in review.action_ids],
        "closed_at": review.closed_at or None, "closed_by": user_ref(review.closed_by),
        "reopen_reason": review.reopen_reason or None, "attachments": attachments_rows("review", review),
        "history": history("review", review), "transitions": transitions, "rights": rights,
    })
    return row


def get_review(review_id):
    return get("eguitra.hsseq.review", review_id, "Revue de direction")


def review_values(data, review=None):
    values = {}
    for key in ("period_start", "period_end", "planned_date"):
        if key in data:
            values[key] = date_value(data, key)
            if not values[key]:
                raise ApiError(400, "missing_fields", "Période et date de la revue sont obligatoires.", fields=[key])
    start = values.get("period_start", review.period_start if review else None)
    end = values.get("period_end", review.period_end if review else None)
    if start and end:
        if end < start:
            raise ApiError(400, "invalid_parameter", "La fin de la période précède son début.", fields=["period_end"])
        if len(review_months(start, end)) > 24:
            raise ApiError(400, "invalid_parameter", "Période d'une revue : 24 mois au plus.", fields=["period_end"])
    for key, limit in (("title", 300), ("external_participants", 2000), ("agenda", 4000), ("minutes", 20000),
                       ("conclusion", 8000)):
        if key in data:
            values[key] = text(data, key, limit)
    if "title" in values and not values["title"]:
        raise ApiError(400, "missing_fields", "Intitulé de la revue manquant.", fields=["title"])
    if "participant_ids" in data:
        users = request.env["res.users"].sudo().browse(ids_list(data, "participant_ids")).exists()
        if users.filtered(lambda u: u.share):
            raise ApiError(422, "business_rule", "Participants : des comptes internes.", fields=["participant_ids"])
        values["participant_ids"] = [(6, 0, users.ids)]
    return values


def action_values(data, review, decision=None):
    """Action d'origine « revue » : responsable (compte interne de la société), échéance, preuve attendue."""
    owner = request.env["res.users"].sudo().browse(int_or_none(data, "owner_id") or 0).exists() or (
        decision.owner_id if decision else request.env["res.users"])
    if not owner or owner.share or review.company_id not in owner.company_ids:
        raise ApiError(422, "business_rule", "Responsable de l'action : un compte interne de la société.",
                       fields=["owner_id"])
    due = date_value(data, "due_date") or (decision.due_date if decision else False)
    if not due:
        raise ApiError(400, "missing_fields", "Échéance de l'action manquante.", fields=["due_date"])
    values = {"owner_id": owner.id, "due_date": due}
    if data.get("description"):
        values["description"] = text(data, "description", 4000)
    if "expected_evidence" in data:
        values["expected_evidence"] = text(data, "expected_evidence", 2000)
    if data.get("control_level"):
        if data["control_level"] not in dict(CONTROL_LEVELS):
            raise ApiError(400, "invalid_parameter", "Niveau de maîtrise inconnu.", fields=["control_level"])
        values["control_level"] = data["control_level"]
    if "estimated_cost" in data:
        values["estimated_cost"] = max(number(data, "estimated_cost"), 0.0)
    return values


def decision_values(data, partial=False, review=None):
    values = {}
    if not partial or "topic" in data:
        topic = data.get("topic") or "improvement"
        if topic not in dict(DECISION_TOPICS):
            raise ApiError(400, "invalid_parameter", "Nature de décision inconnue.", fields=["topic"])
        values["topic"] = topic
    if not partial or "description" in data:
        values["description"] = text(data, "description", 4000)
        if not values["description"]:
            raise ApiError(400, "missing_fields", "Décision à rédiger.", fields=["description"])
    if "owner_id" in data:
        owner = request.env["res.users"].sudo().browse(int_or_none(data, "owner_id") or 0).exists()
        if owner and (owner.share or (review and review.company_id not in owner.company_ids)):
            raise ApiError(422, "business_rule", "Responsable : un compte interne de la société.", fields=["owner_id"])
        values["owner_id"] = owner.id or False
    if "due_date" in data:
        values["due_date"] = date_value(data, "due_date")
    if "sequence" in data:
        values["sequence"] = int_or_none(data, "sequence") or 10
    return values


# ─── Compte rendu en PDF ──────────────────────────────────────────────────


def fmt(value, unit=None):
    return fmt_value(value, UNIT_LABELS.get(unit, unit)) or "-"


def pdf_context(review, inputs=None, user=None, auditor=False):
    """Compte rendu de la revue, mis en forme ; le gabarit ne fait que le disposer. inputs : éléments d'entrée
    servis (ceux du jour pour une revue préparée) ; auditor : sans nom de conducteur."""
    review = review.sudo()
    user = user or request.env.user
    inputs = (review.inputs if inputs is None else inputs) or {}

    def name(account):
        return "-" if not account else "conducteur" if auditor and is_driver(account) else account.name
    statuses, levels = dict(INDICATOR_STATUSES), dict(LEVELS)
    events = inputs.get("events") or {}
    actions = inputs.get("actions") or {}
    audits = inputs.get("audits") or {}
    risks = inputs.get("risks") or {}
    env_inputs = inputs.get("environment") or {}
    emergency = inputs.get("emergency") or {}
    documents = inputs.get("documents") or {}
    telematics = inputs.get("telematics") or {}
    previous = inputs.get("previous_review")
    complaints = env_inputs.get("complaints") or {}
    status_labels = dict(ACTION_STATUSES)
    return {
        "reference": review.reference, "title": review.title, "company": review.company_id.name,
        "period": (inputs.get("period") or {}).get("label") or period_label(review.period_start, review.period_end),
        "planned_date": review.planned_date.strftime("%d/%m/%Y"),
        "held_on": review.held_on.strftime("%d/%m/%Y") if review.held_on else "-",
        "state": dict(REVIEW_STATES)[review.state],
        "printed_at": fields.Datetime.context_timestamp(user, fields.Datetime.now()).strftime("%d/%m/%Y %H:%M"),
        "generated_at": fields.Datetime.context_timestamp(user, review.inputs_generated_at).strftime(
            "%d/%m/%Y %H:%M") if review.inputs_generated_at and review.state != "prepared" else
        f"{fields.Datetime.context_timestamp(user, fields.Datetime.now()):%d/%m/%Y %H:%M} (revue préparée)",
        "participants": ", ".join(name(u) for u in review.participant_ids) or "-",
        "external_participants": review.external_participants or "",
        "agenda": review.agenda or "",
        "indicators": [(i["label"], fmt(i["value"], i["unit"]), fmt(i["target"], i["unit"]),
                        statuses.get(i["status"], ""), i["status"], i["source"]) for i in inputs.get("indicators") or []],
        "events_summary": [("Événements de la période", events.get("total", 0)),
                           ("Encore ouverts", events.get("open", 0)),
                           ("Non encore classés", events.get("unclassified", 0))]
        + [(f"Criticité {levels[code].lower()}", events.get("by_level", {}).get(code, 0)) for code, _l in LEVELS],
        "events_by_type": [(label, events.get("by_type", {}).get(code, 0)) for code, label in EVENT_TYPES
                           if events.get("by_type", {}).get(code)],
        "notable": [(e["reference"], e["title"], levels.get(e["level"], ""), e["criticality"] or "",
                     (e["occurred_at"] or "")[:10]) for e in events.get("notable") or []],
        "actions_summary": [
            ("À faire", actions.get("open_by_status", {}).get("todo", 0)),
            ("En cours", actions.get("open_by_status", {}).get("in_progress", 0)),
            ("À vérifier (efficacité)", actions.get("open_by_status", {}).get("to_verify", 0)),
            ("En retard", actions.get("overdue", 0)),
            ("Créées sur la période", actions.get("created", 0)), ("Closes sur la période", actions.get("closed", 0)),
            ("Réalisées dans les délais", fmt(actions.get("on_time_rate"), "pct")),
            ("Efficaces à la vérification", fmt(actions.get("effectiveness_rate"), "pct"))],
        "overdue": [(a["reference"], a["description"], a["owner"], a["due_date"], a["days_overdue"])
                    for a in actions.get("overdue_items") or []],
        "audits_summary": f"{audits.get('done', 0)} audit(s) réalisé(s) sur {audits.get('planned', 0)} planifié(s)"
                          + (f" ({fmt(audits.get('rate'), 'pct')})" if audits.get("rate") is not None else ""),
        "audits": [(a["reference"], a["title"], dict(AUDIT_STANDARDS).get(a["standard"], ""), a["status"],
                    " / ".join(str(a["findings"].get(c, 0)) for c, _l in FINDING_CLASSES))
                   for a in audits.get("items") or []],
        "findings_by_class": [(label, (audits.get("open_findings_by_class") or {}).get(code, 0))
                              for code, label in FINDING_CLASSES],
        "findings": [(f["reference"], dict(FINDING_CLASSES).get(f["classification"], ""), f["description"])
                     for f in audits.get("open_findings") or []],
        "requirements": [(r["reference"], r["title"], dict(REQUIREMENT_SOURCES).get(r["source"], ""),
                          dict(REQUIREMENT_STATUSES).get(r["status"], ""))
                         for r in (inputs.get("requirements") or {}).get("non_compliant") or []],
        "risks_summary": [("Risques en vigueur", risks.get("active", 0)),
                          ("Revues de risques échues", risks.get("reviews_overdue", 0))]
        + [(f"Niveau résiduel {levels[code].lower()}", risks.get("by_residual_level", {}).get(code, 0))
           for code, _l in LEVELS],
        "risks": [(r["reference"], r["feared_event"], r["residual_criticality"], levels.get(r["residual_level"], ""),
                   r["owner"]) for r in risks.get("high_residual") or []],
        "maturity": [(m["label"], m["requirements"], m["evaluated"], fmt(m["score"], "pct"))
                     for m in inputs.get("iso_maturity") or []],
        "environment": [
            ("Déversements", f"{env_inputs.get('spills', 0)} ({fmt(env_inputs.get('spill_liters'), 'litres')} "
                             f"déversés, {fmt(env_inputs.get('spill_recovered_liters'), 'litres')} récupérés)"),
            ("Contaminations de produit", env_inputs.get("contaminations", 0)),
            ("Mesures de poussières (dépassements)",
             f"{env_inputs.get('dust_measurements', 0)} ({env_inputs.get('dust_exceedances', 0)})"),
            ("Enlèvements de déchets avec bordereau", env_inputs.get("wastes_collected", 0)),
            ("Déchets en attente d'enlèvement", env_inputs.get("wastes_stored_now", 0)),
            ("Consommation", fmt(env_inputs.get("fuel_consumption"), "l_100km")),
            ("Émissions de CO₂", f"{fmt(env_inputs.get('co2_emissions'), 'kg_co2_km')} "
                                 f"({fmt(env_inputs.get('co2_kg'), 'kg')} au total)"),
            ("Écarts de livraison des citernes", fmt(env_inputs.get("tanker_shortage"), "per_mille")),
            ("Écarts de tonnage des bennes", fmt(env_inputs.get("tipper_variance"), "per_mille")),
            ("Réclamations clients reçues", complaints.get("received", 0)),
            ("Réclamations traitées dans le délai", fmt(complaints.get("on_time_rate"), "pct")),
            ("Réclamations encore ouvertes", complaints.get("open_now", 0))],
        "emergency": [("Plans d'intervention en vigueur", emergency.get("plans_active", 0)),
                      ("Exercices réalisés sur planifiés",
                       f"{emergency.get('drills_done', 0)} / {emergency.get('drills_planned', 0)}")],
        "stale_plans": [(p["reference"], p["title"], p["site"], dict(SCENARIOS).get(p["scenario"], ""))
                        for p in emergency.get("plans_without_recent_drill") or []],
        "documents": [("Procédures en vigueur", documents.get("procedures_published", 0)),
                      ("Taux de lecture des procédures", fmt(documents.get("read_rate"), "pct")),
                      ("Alertes et retours d'expérience diffusés", documents.get("bulletins_published", 0))],
        "telematics": [("Violations de conduite", telematics.get("violations", 0)),
                       ("Par 100 voyages", fmt(telematics.get("per_100_trips")))]
        + [(label, (telematics.get("by_type") or {}).get(code, 0)) for code, label in VIOLATION_TYPES],
        "previous": {"reference": previous["reference"], "held_on": previous.get("held_on") or "-",
                     "decisions": [(d["description"], d["action"]["reference"] if d["action"] else "-",
                                    status_labels.get(d["action"]["status"], "") if d["action"] else "Sans action")
                                   for d in previous.get("decisions") or []]} if previous else None,
        "minutes": review.minutes or "",
        "decisions": [(dict(DECISION_TOPICS)[d.topic], d.description, name(d.owner_id),
                       d.due_date.strftime("%d/%m/%Y") if d.due_date else "-", d.action_id.reference or "-",
                       status_labels.get(d.action_id.status, "") if d.action_id else "")
                      for d in review.decision_ids],
        "conclusion": review.conclusion or "",
    }


class EguitraHsseqReviews(http.Controller):
    @hsseq_route("/hsseq/reviews", profiles=REVIEW_READ)
    def reviews(self, **kw):
        domain = [("company_id", "in", companies(kw).ids)]
        if kw.get("state"):
            domain.append(("state", "in", kw["state"].split(",")))
        year = int_or_none(kw, "year")
        if year:
            domain += [("planned_date", ">=", f"{year}-01-01"), ("planned_date", "<=", f"{year}-12-31")]
        offset, limit, order = page_args(kw, "-planned_date", SORTS)
        Review = request.env["eguitra.hsseq.review"].sudo()
        counts = {"by_state": {code: Review.search_count(domain + [("state", "=", code)]) for code, _l in REVIEW_STATES}}
        return page([review_line(r) for r in Review.search(domain, offset=offset, limit=limit, order=order)],
                    Review.search_count(domain), offset, limit, counts)

    @hsseq_route("/hsseq/reviews/<int:review_id>", profiles=REVIEW_READ)
    def review(self, review_id, **_kw):
        return review_detail(get_review(review_id))

    @hsseq_route("/hsseq/reviews", methods=("POST",), profiles=REVIEW_WRITE)
    def create_review(self, **_kw):
        """Revue préparée ({period_start, period_end, planned_date, title, participant_ids, external_participants,
        agenda}) ; ses éléments d'entrée sont générés aussitôt."""
        data = read_json()
        require(data, "period_start", "period_end", "planned_date")
        company = companies(data)[:1] if data.get("company_id") else request.env.company
        values = review_values(data)
        if not values.get("title"):
            values["title"] = f"Revue de direction HSSEQ, {period_label(values['period_start'], values['period_end'])}"
        review = request.env["eguitra.hsseq.review"].sudo().create(dict(values, company_id=company.id))
        return review_detail(review)

    @hsseq_route("/hsseq/reviews/<int:review_id>", methods=("PATCH",), profiles=REVIEW_WRITE)
    def update_review(self, review_id, **_kw):
        review = get_review(review_id)
        if review.state == "closed":
            raise ApiError(422, "invalid_transition", "Revue close : le Responsable HSSEQ la rouvre avant toute "
                                                      "modification.")
        data = read_json()
        values = review_values(data, review)
        if {"period_start", "period_end"} & set(values) and review.state != "prepared":
            raise ApiError(422, "invalid_transition", "Revue tenue : sa période ne change plus.")
        review.write(values)
        if {"period_start", "period_end", "planned_date"} & set(values) and review.state == "prepared":
            review._generate_inputs()
        return review_detail(review)

    @hsseq_route("/hsseq/reviews/<int:review_id>/<string:transition>", methods=("POST",), profiles=REVIEW_WRITE)
    def transition(self, review_id, transition, **_kw):
        if transition not in TRANSITIONS:
            raise ApiError(404, "not_found", "Transition inconnue.")
        review = get_review(review_id)
        data = read_json()
        if transition == "reopen" and not is_hsseq():
            raise forbidden("Une revue close n'est rouverte que par le Responsable HSSEQ.")
        if transition == "refresh":
            review.action_refresh()
        elif transition == "hold":
            if "participant_ids" in data or "external_participants" in data:
                review.write(review_values({k: data[k] for k in ("participant_ids", "external_participants")
                                            if k in data}, review))
            review.action_hold(date_value(data, "held_on"))
        elif transition == "close":
            review.action_close()
        else:
            review.action_reopen(data.get("reason"))
        return review_detail(review)

    # ─── Décisions ────────────────────────────────────────────────────────

    def _editable(self, review_id):
        review = get_review(review_id)
        if review.state == "closed":
            raise ApiError(422, "invalid_transition", "Revue close : plus de décision.")
        return review

    def _decision(self, review, decision_id):
        decision = review.sudo().decision_ids.filtered(lambda d: d.id == decision_id)
        if not decision:
            raise ApiError(404, "not_found", "Décision introuvable dans cette revue.")
        return decision

    @hsseq_route("/hsseq/reviews/<int:review_id>/decisions", methods=("POST",), profiles=REVIEW_WRITE)
    def create_decision(self, review_id, **_kw):
        """Décision ({topic, description, owner_id, due_date}) et, avec « action » ({owner_id, due_date,
        expected_evidence, control_level, estimated_cost}), l'action qui la met en œuvre."""
        review = self._editable(review_id)
        data = read_json()
        action_data = data.get("action")
        if action_data is not None and not isinstance(action_data, dict):
            raise ApiError(400, "invalid_parameter", "Action invalide.", fields=["action"])
        values = decision_values(data, review=review)
        decision = request.env["eguitra.hsseq.review.decision"].sudo().create(dict(values, review_id=review.id))
        if action_data is not None:
            decision._create_action(action_values(action_data, review, decision))
        review._journal("decision_added", note=decision.description[:300])
        return review_detail(review)

    @hsseq_route("/hsseq/reviews/<int:review_id>/decisions/<int:decision_id>", methods=("PATCH",),
                 profiles=REVIEW_WRITE)
    def update_decision(self, review_id, decision_id, **_kw):
        review = self._editable(review_id)
        decision = self._decision(review, decision_id)
        decision.write(decision_values(read_json(), partial=True, review=review))
        review._journal("decision_updated", note=decision.description[:300])
        return review_detail(review)

    @hsseq_route("/hsseq/reviews/<int:review_id>/decisions/<int:decision_id>", methods=("DELETE",),
                 profiles=REVIEW_WRITE)
    def delete_decision(self, review_id, decision_id, **_kw):
        review = self._editable(review_id)
        decision = self._decision(review, decision_id)
        if decision.action_id:
            raise ApiError(422, "invalid_transition", "Décision mise en œuvre par une action : elle se conserve.")
        review._journal("decision_removed", note=decision.description[:300])
        decision.unlink()
        return review_detail(review)

    @hsseq_route("/hsseq/reviews/<int:review_id>/decisions/<int:decision_id>/action", methods=("POST",),
                 profiles=REVIEW_WRITE)
    def decision_action(self, review_id, decision_id, **_kw):
        review = self._editable(review_id)
        decision = self._decision(review, decision_id)
        if decision.action_id:
            raise ApiError(422, "invalid_transition", "Cette décision a déjà son action.")
        decision._create_action(action_values(read_json(), review, decision))
        return review_detail(review)

    # ─── Compte rendu ─────────────────────────────────────────────────────

    @hsseq_route("/hsseq/reviews/<int:review_id>/report.pdf", profiles=REVIEW_READ)
    def pdf(self, review_id, **_kw):
        review = get_review(review_id)
        report = pdf_context(review, review_inputs(review), auditor=is_auditor())
        pdf, _type = request.env["ir.actions.report"].sudo()._render_qweb_pdf(
            "eguitra_hsseq.action_report_review", review.ids, data={"report": report})
        name = f"revue_direction_{review.reference}".replace("/", "-").replace(" ", "_")
        return request.make_response(pdf, headers=[("Content-Type", "application/pdf"),
                                                   ("Content-Disposition", content_disposition(f"{name}.pdf"))])
