"""Revue de direction HSSEQ (spécification §3, §8, §12 lot 3 ; ISO 45001, 14001 et 9001, chapitre 9.3).

La revue se tient entièrement à partir du module (critère de recette du lot 3) :
- préparée par hsseq ou la direction : période, date, participants, ordre du jour ; ses éléments d'entrée
  sont générés par le noyau depuis le module (indicateurs du cockpit sur les mois de la période, événements
  marquants, état des actions, audits et constats, exigences non conformes, risques, maturité ISO,
  environnement et qualité, urgences, documents, télématique, suite de la revue précédente) et régénérés à
  la demande tant qu'elle est préparée ;
- tenue : participants et date, éléments d'entrée figés à cette date, compte rendu, décisions et leurs
  actions (origine « revue ») ;
- close : compte rendu, conclusions et au moins une décision ; rouverte par le seul Responsable HSSEQ, avec
  un motif. Compte rendu en PDF rendu par le noyau.
"""

from collections import Counter
from datetime import datetime, time, timedelta

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .cockpit import FAMILY, INDICATORS, WATCH_RATIO, month_label, month_start
from .common import (
    ACTION_STATUSES,
    DECISION_TOPICS,
    EVENT_TYPES,
    FINDING_CLASSES,
    LEVELS,
    REQUIREMENT_STATUSES,
    REVIEW_STATES,
    VIOLATION_TYPES,
    HsseqError,
    indicator_status,
    today,
)

MAX_MONTHS = 24
LIST_LIMIT = 20
OPEN_ACTION = ("todo", "in_progress", "to_verify")


def review_months(start, end):
    """Premiers jours des mois couverts par la période."""
    months, current = [], month_start(start)
    while current <= end:
        months.append(current)
        current += relativedelta(months=1)
    return months


def iso(value):
    """Date ou horodatage enregistrable dans les éléments d'entrée (JSON)."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds") + "Z"
    return value.isoformat()


class EguitraHsseqReview(models.Model):
    _name = "eguitra.hsseq.review"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Revue de direction HSSEQ"
    _order = "planned_date desc, id desc"
    _check_company_auto = True
    _journal_key = "review"
    _journal_fields = ("title", "period_start", "period_end", "planned_date", "held_on", "participant_ids",
                       "external_participants", "agenda", "minutes", "conclusion", "state")

    reference = fields.Char("Référence", default="/", copy=False, readonly=True, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    title = fields.Char("Revue", required=True)
    period_start = fields.Date("Période du", required=True)
    period_end = fields.Date("Période au", required=True)
    planned_date = fields.Date("Prévue le", required=True, index=True)
    held_on = fields.Date("Tenue le", readonly=True)
    participant_ids = fields.Many2many("res.users", "eguitra_hsseq_review_user_rel", "review_id", "user_id",
                                       "Participants")
    external_participants = fields.Text("Autres participants", help="Noms et fonctions des participants sans compte.")
    agenda = fields.Text("Ordre du jour")
    inputs = fields.Json("Éléments d'entrée", readonly=True)
    inputs_generated_at = fields.Datetime("Éléments d'entrée générés le", readonly=True)
    minutes = fields.Text("Compte rendu des échanges")
    conclusion = fields.Text("Conclusions de la direction",
                             help="Adéquation, pertinence et efficacité du système de management.")
    state = fields.Selection(REVIEW_STATES, "État", required=True, default="prepared", index=True)
    closed_at = fields.Datetime("Close le", readonly=True)
    closed_by = fields.Many2one("res.users", "Close par", readonly=True)
    reopen_reason = fields.Text("Motif de la dernière réouverture", readonly=True)
    decision_ids = fields.One2many("eguitra.hsseq.review.decision", "review_id", "Décisions")
    action_ids = fields.One2many("eguitra.hsseq.action", "review_id", "Actions")

    @api.constrains("period_start", "period_end")
    def _check_period(self):
        for review in self:
            if review.period_end < review.period_start:
                raise ValidationError("La période de la revue se termine après son début.")
            if len(review_months(review.period_start, review.period_end)) > MAX_MONTHS:
                raise ValidationError(f"Période d'une revue : {MAX_MONTHS} mois au plus.")

    @api.model_create_multi
    def create(self, vals_list):
        reviews = super().create(vals_list)
        for review in reviews:
            review.reference = self.env["ir.sequence"].sudo().next_by_code("eguitra.hsseq.review") or "/"
            review._generate_inputs()
        return reviews

    # ─── Cycle ────────────────────────────────────────────────────────────

    def _transitions(self):
        self.ensure_one()
        return {"prepared": ["refresh", "hold"], "held": ["close"], "closed": ["reopen"]}[self.state]

    def _require(self, transition):
        if transition not in self._transitions():
            raise HsseqError("invalid_transition", f"Transition « {transition} » impossible depuis l'état "
                                                   f"« {dict(REVIEW_STATES)[self.state]} ».")

    def action_refresh(self):
        self.ensure_one()
        self._require("refresh")
        self._generate_inputs()
        self._journal("refresh")
        return True

    def action_hold(self, held_on=None):
        """Revue tenue : participants désignés, date passée ou du jour ; les éléments d'entrée sont générés une
        dernière fois puis figés."""
        self.ensure_one()
        self._require("hold")
        day = held_on or today(self.env)
        if day > today(self.env):
            raise HsseqError("invalid_parameter", "Une revue se déclare tenue à une date passée ou du jour.",
                             fields=["held_on"], status=400)
        if not self.participant_ids and not (self.external_participants or "").strip():
            raise HsseqError("participants_required", "Désignez les participants de la revue avant de la tenir.",
                             fields=["participant_ids"])
        self._generate_inputs()
        self.write({"state": "held", "held_on": day})
        self._journal("hold")
        return True

    def action_close(self):
        """Clôture : compte rendu, conclusions et au moins une décision."""
        self.ensure_one()
        self._require("close")
        missing = [k for k in ("minutes", "conclusion") if not (self[k] or "").strip()]
        if missing:
            raise HsseqError("minutes_required", "Rédigez le compte rendu et les conclusions avant de clore la revue.",
                             fields=missing)
        if not self.decision_ids:
            raise HsseqError("decisions_missing", "Une revue de direction se clôt avec au moins une décision.",
                             fields=["decisions"])
        self.write({"state": "closed", "closed_at": fields.Datetime.now(), "closed_by": self.env.uid})
        self._journal("close")
        return True

    def action_reopen(self, reason):
        self.ensure_one()
        self._require("reopen")
        if not (reason or "").strip():
            raise HsseqError("reason_required", "Le motif de la réouverture est obligatoire.", fields=["reason"])
        self.write({"state": "held", "closed_at": False, "closed_by": False, "reopen_reason": reason.strip()})
        self._journal("reopen", note=reason.strip())
        return True

    # ─── Éléments d'entrée ────────────────────────────────────────────────

    def _previous(self):
        self.ensure_one()
        return self.sudo().search([("company_id", "=", self.company_id.id), ("id", "!=", self.id),
                                   ("state", "in", ("held", "closed")), ("planned_date", "<=", self.planned_date)],
                                  order="planned_date desc, id desc", limit=1)

    def _generate_inputs(self):
        """Éléments d'entrée de la revue, calculés depuis le module sur la période (mois entiers pour les
        indicateurs du cockpit) et dans l'état du jour pour les registres (actions, exigences, risques)."""
        for review in self:
            review.sudo().write({"inputs": review._compute_inputs(), "inputs_generated_at": fields.Datetime.now()})
        return True

    def _compute_inputs(self):
        self.ensure_one()
        env = self.env
        company = self.company_id
        start, end = self.period_start, self.period_end
        start_dt, end_dt = datetime.combine(start, time.min), datetime.combine(end, time.max)
        day = today(env)
        base = [("company_id", "=", company.id)]
        months = review_months(start, end)
        Cockpit = env["eguitra.hsseq.cockpit"]
        comps, _frozen = Cockpit._components(company, months)
        total = Cockpit._sum(comps, company, months)
        if month_start(day) in months:
            total["drivers"], total["drivers_valid"] = Cockpit._qualifications(company)
        settings = env["eguitra.hsseq.settings"]._get(company)
        indicators = []
        values = {}
        for code, label, unit, direction, source, formula, _rolling, _scoped in INDICATORS:
            value = Cockpit._value(code, total)
            target = settings._target(code)
            values[code] = value
            indicators.append({"code": code, "label": label, "unit": unit, "direction": direction, "value": value,
                               "target": target, "family": FAMILY.get(code, "reactive"), "source": source,
                               "formula": formula,
                               "status": indicator_status(value, target, direction, watch_ratio=WATCH_RATIO)})
        return {
            "period": {"from": iso(start), "to": iso(end), "months": [m.strftime("%Y-%m") for m in months],
                       "label": f"{month_label(months[0])} à {month_label(months[-1])}" if len(months) > 1
                       else month_label(months[0])},
            "generated_on": iso(day),
            "indicators": indicators,
            "events": self._input_events(base, start_dt, end_dt),
            "actions": self._input_actions(base, start_dt, end_dt, day, values),
            "audits": self._input_audits(base, start, end),
            "requirements": self._input_requirements(base),
            "risks": self._input_risks(base, day),
            "iso_maturity": Cockpit._iso_maturity(env["eguitra.hsseq.requirement"].sudo().search(base)),
            "environment": self._input_environment(base, total, values),
            "emergency": self._input_emergency(base, start, end),
            "documents": self._input_documents(base, start_dt, end_dt),
            "telematics": {"violations": int(total["violations"]), "per_100_trips": values["telematics_violations"],
                           "by_type": {code: int(total[f"violations_{code}"]) for code, _l in VIOLATION_TYPES}},
            "previous_review": self._input_previous(),
        }

    def _input_events(self, base, start_dt, end_dt):
        events = self.env["eguitra.hsseq.event"].sudo().search(
            base + [("occurred_at", ">=", start_dt), ("occurred_at", "<=", end_dt)])
        notable = events.filtered(lambda e: e.level in ("significant", "high")).sorted(
            lambda e: (-(e.criticality or 0), e.occurred_at))
        by_type = Counter(events.mapped("event_type"))
        by_level = Counter(e.level for e in events if e.level)
        return {
            "total": len(events), "open": len(events.filtered(lambda e: e.status != "closed")),
            "unclassified": len(events.filtered(lambda e: not e.level)),
            "by_type": {code: by_type.get(code, 0) for code, _l in EVENT_TYPES},
            "by_level": {code: by_level.get(code, 0) for code, _l in LEVELS},
            "notable": [{"id": e.id, "reference": e.reference, "title": e.title, "event_type": e.event_type,
                         "level": e.level, "criticality": e.criticality, "occurred_at": iso(e.occurred_at),
                         "status": e.status, "site": e.site_id.name or None} for e in notable[:LIST_LIMIT]],
            "notable_count": len(notable),
        }

    def _input_actions(self, base, start_dt, end_dt, day, values):
        Action = self.env["eguitra.hsseq.action"].sudo()
        open_actions = Action.search(base + [("status", "in", OPEN_ACTION)])
        overdue = open_actions.filtered(lambda a: a._days_overdue(day) > 0).sorted(lambda a: (a.due_date, a.id))
        by_status = Counter(open_actions.mapped("status"))
        return {
            "open_by_status": {code: by_status.get(code, 0) for code, _l in ACTION_STATUSES if code in OPEN_ACTION},
            "overdue": len(overdue),
            "created": Action.search_count(base + [("create_date", ">=", start_dt), ("create_date", "<=", end_dt)]),
            "closed": Action.search_count(base + [("closed_at", ">=", start_dt), ("closed_at", "<=", end_dt)]),
            "on_time_rate": values.get("actions_on_time"), "effectiveness_rate": values.get("actions_effectiveness"),
            "overdue_items": [{"id": a.id, "reference": a.reference, "description": a.description[:300],
                               "origin": a.origin, "owner": a.owner_id.name, "due_date": iso(a.due_date),
                               "days_overdue": a._days_overdue(day)} for a in overdue[:LIST_LIMIT]],
        }

    def _input_audits(self, base, start, end):
        env = self.env
        audits = env["eguitra.hsseq.audit"].sudo().search(
            base + [("status", "!=", "cancelled"), ("planned_date", ">=", start), ("planned_date", "<=", end)],
            order="planned_date, id")
        done = audits.filtered(lambda a: a.status in ("done", "closed"))
        findings = env["eguitra.hsseq.finding"].sudo().search(base + [("status", "=", "open")])
        by_class = Counter(findings.mapped("classification"))
        significant = findings.filtered(lambda f: f.classification in ("major", "minor")).sorted(
            lambda f: (f.classification != "major", f.id))
        return {
            "planned": len(audits), "done": len(done),
            "rate": round(len(done) * 100 / len(audits), 1) if audits else None,
            "items": [{"id": a.id, "reference": a.reference, "title": a.title, "standard": a.standard,
                       "status": a.status, "planned_date": iso(a.planned_date), "actual_date": iso(a.actual_date),
                       "findings": {code: len(a.finding_ids.filtered(lambda f, c=code: f.classification == c))
                                    for code, _l in FINDING_CLASSES}} for a in audits[:LIST_LIMIT]],
            "open_findings_by_class": {code: by_class.get(code, 0) for code, _l in FINDING_CLASSES},
            "open_findings": [{"id": f.id, "reference": f.reference, "classification": f.classification,
                               "description": f.description[:300], "audit": f.audit_id.reference}
                              for f in significant[:LIST_LIMIT]],
        }

    def _input_requirements(self, base):
        requirements = self.env["eguitra.hsseq.requirement"].sudo().search(base)
        by_status = Counter(requirements.mapped("status"))
        gaps = requirements.filtered(lambda r: r.status in ("non_compliant", "partial")).sorted(
            lambda r: (r.status != "non_compliant", r.reference))
        return {
            "by_status": {code: by_status.get(code, 0) for code, _l in REQUIREMENT_STATUSES},
            "non_compliant": [{"id": r.id, "reference": r.reference, "title": r.title, "source": r.source,
                               "source_reference": r.source_reference, "status": r.status} for r in gaps[:LIST_LIMIT]],
        }

    def _input_risks(self, base, day):
        risks = self.env["eguitra.hsseq.risk"].sudo().search(base + [("status", "=", "active")])
        by_level = Counter(risks.mapped("residual_level"))
        high = risks.filtered(lambda r: r.residual_level in ("high", "significant")).sorted(
            lambda r: (-r.residual_criticality, r.id))
        return {
            "active": len(risks),
            "by_residual_level": {code: by_level.get(code, 0) for code, _l in LEVELS},
            "reviews_overdue": len(risks.filtered(lambda r: r._review_overdue(day))),
            "high_residual": [{"id": r.id, "reference": r.reference, "feared_event": r.feared_event[:300],
                               "residual_criticality": r.residual_criticality, "residual_level": r.residual_level,
                               "owner": r.owner_id.name} for r in high[:LIST_LIMIT]],
        }

    def _input_environment(self, base, total, values):
        env = self.env
        return {
            "spills": int(total["spills"]), "spill_liters": round(total["spill_liters"], 1),
            "spill_recovered_liters": round(total["spill_recovered_liters"], 1),
            "contaminations": int(total["contaminations"]), "dust_measurements": int(total["dust_measurements"]),
            "dust_exceedances": int(total["dust_exceedances"]), "wastes_collected": int(total["wastes_collected"]),
            "wastes_stored_now": env["eguitra.hsseq.waste"].sudo().search_count(base + [("status", "=", "stored")]),
            "fuel_consumption": values.get("fuel_consumption"), "co2_emissions": values.get("co2_emissions"),
            "co2_kg": round(total["co2_kg"], 1), "tanker_shortage": values.get("tanker_shortage"),
            "tipper_variance": values.get("tipper_variance"),
            "complaints": {"received": int(total["complaints"]), "on_time_rate": values.get("complaints_on_time"),
                           "open_now": env["eguitra.hsseq.complaint"].sudo().search_count(
                               base + [("status", "!=", "closed")])},
        }

    def _input_emergency(self, base, start, end):
        env = self.env
        plans = env["eguitra.hsseq.emergency.plan"].sudo().search(base)
        drills = env["eguitra.hsseq.drill"].sudo().search(
            base + [("status", "!=", "cancelled"), ("planned_date", ">=", start), ("planned_date", "<=", end)])
        since = end - timedelta(days=365)
        stale = plans.filtered(lambda p: not p.drill_ids.filtered(
            lambda d: d.status == "done" and d.performed_date and since <= d.performed_date <= end))
        return {
            "plans_active": len(plans), "drills_planned": len(drills),
            "drills_done": len(drills.filtered(lambda d: d.status == "done")),
            "plans_without_recent_drill": [{"id": p.id, "reference": p.reference, "title": p.title,
                                            "site": p.site_id.name, "scenario": p.scenario} for p in stale[:LIST_LIMIT]],
        }

    def _input_documents(self, base, start_dt, end_dt):
        env = self.env
        return {
            "procedures_published": env["eguitra.hsseq.procedure"].sudo().search_count(
                base + [("status", "=", "published")]),
            "read_rate": env["eguitra.hsseq.report.template"]._procedures_read_rate(self.company_id),
            "bulletins_published": env["eguitra.hsseq.bulletin"].sudo().search_count(
                base + [("status", "!=", "draft"), ("published_at", ">=", start_dt), ("published_at", "<=", end_dt)]),
        }

    def _input_previous(self):
        previous = self._previous()
        if not previous:
            return None
        return {"id": previous.id, "reference": previous.reference, "held_on": iso(previous.held_on),
                "decisions": [{"id": d.id, "topic": d.topic, "description": d.description[:300],
                               "action": {"id": d.action_id.id, "reference": d.action_id.reference,
                                          "status": d.action_id.status, "due_date": iso(d.action_id.due_date)}
                               if d.action_id else None} for d in previous.decision_ids]}


class EguitraHsseqReviewDecision(models.Model):
    _name = "eguitra.hsseq.review.decision"
    _description = "Décision d'une revue de direction HSSEQ"
    _order = "review_id, sequence, id"

    review_id = fields.Many2one("eguitra.hsseq.review", "Revue", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="review_id.company_id", store=True, index=True)
    sequence = fields.Integer("Ordre", default=10)
    topic = fields.Selection(DECISION_TOPICS, "Nature", required=True, default="improvement")
    description = fields.Text("Décision", required=True)
    owner_id = fields.Many2one("res.users", "Responsable")
    due_date = fields.Date("Échéance")
    action_id = fields.Many2one("eguitra.hsseq.action", "Action", ondelete="set null", index=True)

    def _create_action(self, values):
        """Action du plan d'actions (origine « revue ») qui met en œuvre la décision."""
        self.ensure_one()
        review = self.review_id
        action = self.env["eguitra.hsseq.action"].sudo().create(dict(
            values, origin="review", origin_id=review.id, review_id=review.id, company_id=review.company_id.id,
            description=values.get("description") or self.description))
        self.write({"action_id": action.id, "owner_id": self.owner_id.id or action.owner_id.id,
                    "due_date": self.due_date or action.due_date})
        review._journal("decision_action", note=f"{action.reference} : {self.description[:200]}")
        return action
