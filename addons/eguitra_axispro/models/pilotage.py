"""Pilotage d'un dossier en mode expert : registre des risques, plan d'actions du porteur et du
cabinet, recherche de financements auprès des banques et investisseurs."""

import re
from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

RISK_CATEGORIES = [
    ("market", "Marché et commercial"),
    ("technical", "Technique et exploitation"),
    ("financial", "Financier"),
    ("legal", "Juridique et réglementaire"),
    ("esg", "Environnemental et social"),
    ("governance", "Gouvernance et promoteur"),
    ("country", "Pays et change"),
    ("other", "Autre"),
]
RISK_LEVELS = (("critical", 15), ("high", 10), ("moderate", 5), ("low", 0))
ACTION_STATES = [
    ("todo", "À faire"),
    ("in_progress", "En cours"),
    ("submitted", "Déclarée réalisée par le porteur"),
    ("done", "Réalisée"),
    ("cancelled", "Abandonnée"),
]
ACTION_OPEN = ("todo", "in_progress", "submitted")
INSTRUMENTS = [
    ("bank_loan", "Prêt bancaire"),
    ("leasing", "Crédit-bail"),
    ("equity", "Prise de participation"),
    ("quasi_equity", "Quasi-fonds propres"),
    ("grant", "Subvention"),
    ("guarantee", "Garantie"),
    ("microfinance", "Microfinance"),
    ("other", "Autre"),
]
FUNDING_STATES = [
    ("identified", "Identifié"),
    ("submitted", "Dossier déposé"),
    ("review", "En instruction"),
    ("agreed", "Accord de principe"),
    ("signed", "Convention signée"),
    ("disbursed", "Décaissé"),
    ("rejected", "Refusé"),
    ("withdrawn", "Abandonné"),
]
FUNDING_OPEN = ("identified", "submitted", "review", "agreed")
FUNDING_WON = ("signed", "disbursed")
ACTION_DELAY_DAYS = 30
# Titre d'une action tirée d'un écart sans document à produire : le porteur ne lit jamais l'intitulé
# d'un critère de la grille.
NEUTRAL_ACTION = "Pièce ou information à fournir : votre consultant vous la précise"
CONDITION_BULLET = re.compile(r"^\s*(?:[-•*·–]|\d{1,2}[.)])\s*")


def risk_level(score):
    return next(level for level, floor in RISK_LEVELS if score >= floor)


class AxisproRisk(models.Model):
    _name = "axispro.risk"
    _description = "Risque d'un projet"
    _order = "dossier_id, score desc, id"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True)
    name = fields.Char("Risque", required=True)
    category = fields.Selection(RISK_CATEGORIES, "Catégorie", required=True, default="market")
    description = fields.Text("Description et causes")
    probability = fields.Integer("Probabilité (1 à 5)", required=True, default=3)
    impact = fields.Integer("Impact (1 à 5)", required=True, default=3)
    score = fields.Integer("Criticité", compute="_compute_scores", store=True)
    mitigation = fields.Text("Mesures d'atténuation")
    residual_probability = fields.Integer("Probabilité résiduelle")
    residual_impact = fields.Integer("Impact résiduel")
    residual_score = fields.Integer("Criticité résiduelle", compute="_compute_scores", store=True)
    owner = fields.Selection([("porteur", "Porteur"), ("cabinet", "Cabinet"), ("tiers", "Tiers")], "Responsable",
                             default="porteur", required=True)
    state = fields.Selection([("open", "Ouvert"), ("mitigating", "En traitement"), ("closed", "Maîtrisé")],
                             default="open", required=True)

    @api.depends("probability", "impact", "residual_probability", "residual_impact")
    def _compute_scores(self):
        for risk in self:
            risk.score = risk.probability * risk.impact
            risk.residual_score = (risk.residual_probability * risk.residual_impact
                                   if risk.residual_probability and risk.residual_impact else 0)

    @api.constrains("probability", "impact", "residual_probability", "residual_impact")
    def _check_scale(self):
        for risk in self:
            if not (1 <= risk.probability <= 5 and 1 <= risk.impact <= 5):
                raise ValidationError("Probabilité et impact se notent de 1 à 5.")
            if any(v and not 1 <= v <= 5 for v in (risk.residual_probability, risk.residual_impact)):
                raise ValidationError("Probabilité et impact résiduels se notent de 1 à 5.")

    def action_plan(self):
        """Action de traitement du risque, confiée à son responsable (le cabinet pour un tiers)."""
        self.ensure_one()
        if not self.mitigation:
            raise UserError("Décrivez d'abord les mesures d'atténuation.")
        action = self.env["axispro.action"].create({
            "dossier_id": self.dossier_id.id, "name": f"Atténuer le risque : {self.name}", "description": self.mitigation,
            "source": "risk", "risk_id": self.id, "assignee": "porteur" if self.owner == "porteur" else "cabinet",
            "due_date": fields.Date.context_today(self) + timedelta(days=ACTION_DELAY_DAYS),
            "portal_visible": self.owner == "porteur",
        })
        if self.state == "open":
            self.state = "mitigating"
        return action


class AxisproAction(models.Model):
    _name = "axispro.action"
    _description = "Action du plan d'accompagnement"
    _order = "dossier_id, due_date, id"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True)
    name = fields.Char("Action", required=True)
    description = fields.Text("Détail attendu")
    source = fields.Selection(
        [("gap", "Écart de la grille"), ("committee", "Condition du comité"), ("risk", "Traitement d'un risque"),
         ("manual", "Saisie libre")], default="manual", required=True,
    )
    criterion_id = fields.Many2one("axispro.criterion", "Critère", ondelete="set null")
    review_id = fields.Many2one("axispro.review", "Revue de comité", ondelete="set null")
    risk_id = fields.Many2one("axispro.risk", "Risque", ondelete="set null")
    assignee = fields.Selection([("porteur", "Porteur"), ("cabinet", "Cabinet")], "Confiée à", default="porteur",
                                required=True)
    user_id = fields.Many2one("res.users", "Suivi par", default=lambda self: self.env.user)
    due_date = fields.Date("Échéance")
    state = fields.Selection(ACTION_STATES, default="todo", required=True)
    portal_visible = fields.Boolean("Visible du porteur", default=True)
    porteur_comment = fields.Text("Compte rendu du porteur")
    done_date = fields.Date("Réalisée le", readonly=True)
    done_by = fields.Many2one("res.users", "Validée par", readonly=True)

    def write(self, vals):
        if vals.get("state") == "done":
            vals = dict(vals, done_date=fields.Date.context_today(self), done_by=self.env.user.id)
        elif vals.get("state") in ACTION_OPEN:
            vals = dict(vals, done_date=False, done_by=False)
        return super().write(vals)

    def is_overdue(self, today=None):
        self.ensure_one()
        today = today or fields.Date.context_today(self)
        return bool(self.state in ACTION_OPEN and self.state != "submitted" and self.due_date and self.due_date < today)

    @api.model
    def from_gaps(self, dossier, limit=5):
        """Actions du porteur tirées des écarts prioritaires, sans doublon d'une action encore ouverte.
        Le porteur lit le titre de l'action (portail, notification) : jamais l'intitulé du critère de la
        grille ni son aide d'évaluation, seulement le document à produire (livrable saisi sur le critère,
        livrable du critère ou de son domaine), à défaut un titre neutre. Le cabinet garde le lien au
        critère (criterion_id)."""
        open_criteria = dossier.action_ids.filtered(lambda a: a.state in ACTION_OPEN).criterion_id
        due = fields.Date.context_today(self) + timedelta(days=ACTION_DELAY_DAYS)
        evaluations = {e.criterion_id.id: e for e in dossier.evaluation_ids}
        values = []
        for gap in dossier.gaps(limit):
            if gap["criterion_id"] in open_criteria.ids:
                continue
            criterion = self.env["axispro.criterion"].browse(gap["criterion_id"])
            evaluation = evaluations.get(criterion.id)
            todo = ((evaluation and evaluation.deliverable) or criterion.deliverable or criterion.domain_id.deliverable
                    or NEUTRAL_ACTION)
            values.append({
                "dossier_id": dossier.id, "name": " ".join(todo.split())[:200], "description": False,
                "source": "gap", "criterion_id": criterion.id, "assignee": "porteur", "due_date": due,
            })
        return self.create(values)

    @api.model
    def from_conditions(self, review):
        """Une action par condition posée par le comité (une condition par ligne)."""
        if not review.conditions or review.decision in ("no_go", "postponed"):
            return self.browse()
        due = (review.date or fields.Date.context_today(self)) + timedelta(days=ACTION_DELAY_DAYS)
        values = []
        for raw in review.conditions.splitlines():
            text = CONDITION_BULLET.sub("", raw).strip()  # puce ou numéro « 1. », « 2) »
            if len(text) >= 3:
                values.append({
                    "dossier_id": review.dossier_id.id, "name": text[:250], "description": text, "source": "committee",
                    "review_id": review.id, "assignee": "porteur", "due_date": due,
                })
        return self.create(values)


class AxisproFunding(models.Model):
    _name = "axispro.funding"
    _description = "Recherche de financement"
    _order = "dossier_id, id"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    funder_id = fields.Many2one("res.partner", "Financeur", required=True)
    instrument = fields.Selection(INSTRUMENTS, "Instrument", required=True, default="bank_loan")
    amount_requested = fields.Monetary("Montant sollicité")
    amount_granted = fields.Monetary("Montant accordé")
    rate = fields.Float("Taux (%)")
    duration_months = fields.Integer("Durée (mois)")
    state = fields.Selection(FUNDING_STATES, default="identified", required=True)
    state_date = fields.Date("Étape atteinte le", default=fields.Date.context_today)
    date_submitted = fields.Date("Déposé le")
    date_decision = fields.Date("Décision le")
    next_step = fields.Char("Prochaine étape")
    next_date = fields.Date("Relance prévue")
    conditions = fields.Text("Conditions et garanties demandées")

    @api.constrains("amount_requested", "amount_granted", "rate", "duration_months")
    def _check_amounts(self):
        for funding in self:
            if min(funding.amount_requested, funding.amount_granted, funding.rate, funding.duration_months) < 0:
                raise ValidationError("Montants, taux et durée sont positifs.")

    def write(self, vals):
        if "state" in vals:
            today = fields.Date.context_today(self)
            vals = dict(vals, state_date=today)
            if vals["state"] == "submitted" and "date_submitted" not in vals:
                vals.setdefault("date_submitted", today)
            if vals["state"] in FUNDING_WON + ("rejected",) and "date_decision" not in vals:
                vals["date_decision"] = today
        return super().write(vals)


class AxisproDossierPilotage(models.Model):
    _inherit = "axispro.dossier"

    plan_ids = fields.One2many("axispro.plan", "dossier_id", "Modèle financier")
    risk_ids = fields.One2many("axispro.risk", "dossier_id", "Risques")
    action_ids = fields.One2many("axispro.action", "dossier_id", "Plan d'actions")
    funding_ids = fields.One2many("axispro.funding", "dossier_id", "Financements recherchés")

    def financial_indicators(self):
        """Indicateurs du modèle financier ; None tant qu'aucune hypothèse n'est saisie."""
        self.ensure_one()
        plan = self.plan_ids[:1]
        if not plan or not plan.line_ids:
            return None
        return plan.analysis()["indicators"]

    def risk_summary(self):
        self.ensure_one()
        live = self.risk_ids.filtered(lambda r: r.state != "closed")
        levels = dict.fromkeys((level for level, _f in RISK_LEVELS), 0)
        for risk in live:
            levels[risk_level(risk.score)] += 1
        return {"open": len(live), "levels": levels, "top": max(live.mapped("score") or [0])}

    def action_summary(self):
        self.ensure_one()
        today = fields.Date.context_today(self)
        live = self.action_ids.filtered(lambda a: a.state in ACTION_OPEN)
        return {
            "open": len(live),
            "overdue": len(live.filtered(lambda a: a.is_overdue(today))),
            "submitted": len(live.filtered(lambda a: a.state == "submitted")),
            "done": len(self.action_ids.filtered(lambda a: a.state == "done")),
        }
