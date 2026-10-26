"""Registre des risques (spécification §3, §7) : dangers pour la sécurité ou la santé, aspects
environnementaux et menaces de sûreté, par profil de véhicule ou par activité, et par site.

Chaque risque porte son danger et l'événement redouté, sa gravité et sa probabilité brutes (sans mesure)
et résiduelles (avec les mesures en place), notées de 1 à 5 : criticités et niveaux sur la même grille que
les événements (seuils des paramètres de la société). Les mesures de maîtrise sont classées selon la
hiérarchie des contrôles (élimination, substitution, ingénierie, mesure administrative, équipement de
protection) ; les actions du plan d'actions s'y rattachent (origine « risque »).

Le risque a un propriétaire et une date de revue : une revue échue relance chaque semaine le propriétaire
et le Responsable HSSEQ. Cycle : à évaluer, en vigueur, archivé (motif écrit), réactivé par hsseq.
"""

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .common import (
    CONTROL_LEVELS,
    HSSEQ_GROUP,
    LEVELS,
    MEASURE_STATUSES,
    RISK_NATURES,
    RISK_STATUSES,
    VEHICLE_KINDS,
    HsseqError,
    today,
    users_in_group,
)

NOTES = ("raw_severity", "raw_probability", "residual_severity", "residual_probability")
REMINDER_DAYS = 7


class EguitraHsseqRisk(models.Model):
    _name = "eguitra.hsseq.risk"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Risque HSSEQ"
    _order = "residual_criticality desc, raw_criticality desc, id"
    _check_company_auto = True
    _journal_key = "risk"
    _journal_fields = ("nature", "vehicle_kind", "activity", "site_id", "hazard", "feared_event", "raw_severity",
                       "raw_probability", "residual_severity", "residual_probability", "owner_id", "review_date",
                       "status")

    reference = fields.Char("Référence", default="/", copy=False, readonly=True, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    nature = fields.Selection(RISK_NATURES, "Nature", required=True, default="safety_hazard", index=True)
    vehicle_kind = fields.Selection(VEHICLE_KINDS, "Profil de véhicule", help="Vide : tous les profils.")
    activity = fields.Char("Activité", help="Chargement au dépôt, circulation sur site minier, dépotage…")
    site_id = fields.Many2one("eguitra.hsseq.site", "Site", check_company=True, index=True,
                              help="Vide : risque commun, lu par les profils de lecture complète et son "
                                   "propriétaire (portée fermée par défaut).")
    hazard = fields.Text("Danger", required=True)
    feared_event = fields.Text("Événement redouté", required=True)
    raw_severity = fields.Integer("Gravité brute (1 à 5)", required=True, default=1)
    raw_probability = fields.Integer("Probabilité brute (1 à 5)", required=True, default=1)
    residual_severity = fields.Integer("Gravité résiduelle (1 à 5)", required=True, default=1)
    residual_probability = fields.Integer("Probabilité résiduelle (1 à 5)", required=True, default=1)
    raw_criticality = fields.Integer("Criticité brute", compute="_compute_criticality", store=True, index=True)
    raw_level = fields.Selection(LEVELS, "Niveau brut", compute="_compute_criticality", store=True, index=True)
    residual_criticality = fields.Integer("Criticité résiduelle", compute="_compute_criticality", store=True,
                                          index=True)
    residual_level = fields.Selection(LEVELS, "Niveau résiduel", compute="_compute_criticality", store=True,
                                      index=True)
    owner_id = fields.Many2one("res.users", "Propriétaire", required=True, index=True)
    review_date = fields.Date("Prochaine revue le", required=True, index=True)
    last_review_at = fields.Datetime("Dernière revue le", readonly=True)
    last_reviewed_by = fields.Many2one("res.users", "Dernière revue par", readonly=True)
    review_comment = fields.Text("Commentaire de la dernière revue", readonly=True)
    review_reminded_on = fields.Date("Dernière relance de la revue", readonly=True)
    status = fields.Selection(RISK_STATUSES, "État", required=True, default="draft", index=True)
    archive_reason = fields.Text("Motif de l'archivage", readonly=True)
    measure_ids = fields.One2many("eguitra.hsseq.risk.measure", "risk_id", "Mesures de maîtrise")
    action_ids = fields.One2many("eguitra.hsseq.action", "risk_id", "Actions")

    @api.constrains(*NOTES)
    def _check_notes(self):
        for risk in self:
            if any(not 1 <= risk[name] <= 5 for name in NOTES):
                raise ValidationError("Gravités et probabilités d'un risque se notent de 1 à 5.")

    @api.depends(*NOTES, "company_id")
    def _compute_criticality(self):
        Settings = self.env["eguitra.hsseq.settings"]
        for risk in self:
            risk.raw_criticality = risk.raw_severity * risk.raw_probability
            risk.residual_criticality = risk.residual_severity * risk.residual_probability
            risk.raw_level = Settings._level_of(risk.company_id, risk.raw_criticality)
            risk.residual_level = Settings._level_of(risk.company_id, risk.residual_criticality)

    @api.model_create_multi
    def create(self, vals_list):
        Settings = self.env["eguitra.hsseq.settings"]
        for vals in vals_list:
            if not vals.get("review_date"):
                company = self.env["res.company"].browse(vals.get("company_id")) or self.env.company
                vals["review_date"] = today(self.env) + relativedelta(months=Settings._get(company).risk_review_months or 12)
        risks = super().create(vals_list)
        for risk in risks:
            risk.reference = self.env["ir.sequence"].sudo().next_by_code("eguitra.hsseq.risk") or "/"
        risks._check_residual()
        return risks

    def write(self, vals):
        result = super().write(vals)
        if set(vals) & set(NOTES):
            self._check_residual()
        return result

    def _check_residual(self):
        """Les mesures réduisent le risque : gravité et probabilité résiduelles jamais au-dessus des brutes."""
        for risk in self:
            if risk.residual_severity > risk.raw_severity or risk.residual_probability > risk.raw_probability:
                raise HsseqError("residual_above_raw", "Gravité et probabilité résiduelles ne dépassent pas les "
                                                       "brutes.", fields=["residual_severity", "residual_probability"])

    # ─── Cycle ────────────────────────────────────────────────────────────

    def _review_overdue(self, day=None):
        self.ensure_one()
        return self.status == "active" and bool(self.review_date) and self.review_date < (day or today(self.env))

    def _transitions(self):
        self.ensure_one()
        return {"draft": ["activate", "archive"], "active": ["review", "archive"], "archived": ["reactivate"]}[
            self.status]

    def _require(self, transition):
        if transition not in self._transitions():
            labels = dict(RISK_STATUSES)
            raise HsseqError("invalid_transition", f"Transition « {transition} » impossible depuis l'état "
                                                   f"« {labels[self.status]} ».")

    def action_activate(self):
        self.ensure_one()
        self._require("activate")
        self.write({"status": "active"})
        self._journal("activate")
        return True

    def action_review(self, comment=None, next_date=None):
        """Revue du risque : date et auteur, commentaire, prochaine revue (à défaut, dans le délai des
        paramètres)."""
        self.ensure_one()
        self._require("review")
        day = today(self.env)
        months = self.env["eguitra.hsseq.settings"]._get(self.company_id).risk_review_months or 12
        next_date = next_date or day + relativedelta(months=months)
        if next_date <= day:
            raise HsseqError("invalid_parameter", "La prochaine revue est postérieure à aujourd'hui.",
                             fields=["next_review_date"])
        self.write({"last_review_at": fields.Datetime.now(), "last_reviewed_by": self.env.uid,
                    "review_comment": (comment or "").strip() or False, "review_date": next_date,
                    "review_reminded_on": False})
        self._journal("review", note=(comment or "").strip() or None)
        return True

    def action_archive_risk(self, reason):
        self.ensure_one()
        self._require("archive")
        if not (reason or "").strip():
            raise HsseqError("reason_required", "Le motif de l'archivage est obligatoire.", fields=["reason"])
        self.write({"status": "archived", "archive_reason": reason.strip()})
        self._journal("archive", note=reason.strip())
        return True

    def action_reactivate(self, reason):
        self.ensure_one()
        self._require("reactivate")
        if not (reason or "").strip():
            raise HsseqError("reason_required", "Le motif de la réactivation est obligatoire.", fields=["reason"])
        self.write({"status": "active", "archive_reason": False})
        self._journal("reactivate", note=reason.strip())
        return True

    # ─── Relance des revues échues ────────────────────────────────────────

    @api.model
    def _cron_review_reminders(self):
        """Chaque jour : une revue échue relance le propriétaire et le Responsable HSSEQ, une fois par
        semaine tant qu'elle n'est pas faite."""
        day = today(self.env)
        Notification = self.env["eguitra.hsseq.notification"]
        overdue = self.sudo().search([("status", "=", "active"), ("review_date", "<", day)])
        for risk in overdue:
            if risk.review_reminded_on and (day - risk.review_reminded_on).days < REMINDER_DAYS:
                continue
            users = risk.owner_id | users_in_group(self.env, HSSEQ_GROUP, risk.company_id)
            Notification._notify(users, "risk_review_overdue", f"Revue de risque échue : {risk.reference}",
                                 f"{risk.reference} : {risk.feared_event}\nRevue prévue le "
                                 f"{risk.review_date:%d/%m/%Y}, propriétaire {risk.owner_id.name}.", risk, "risk")
            risk.review_reminded_on = day
        return True


class EguitraHsseqRiskMeasure(models.Model):
    _name = "eguitra.hsseq.risk.measure"
    _description = "Mesure de maîtrise d'un risque HSSEQ"
    _order = "risk_id, sequence, id"

    risk_id = fields.Many2one("eguitra.hsseq.risk", "Risque", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="risk_id.company_id", store=True, index=True)
    control_level = fields.Selection(CONTROL_LEVELS, "Niveau de maîtrise", required=True)
    description = fields.Text("Mesure", required=True)
    status = fields.Selection(MEASURE_STATUSES, "État", required=True, default="planned")
    sequence = fields.Integer("Ordre", default=10)
    action_id = fields.Many2one("eguitra.hsseq.action", "Action de mise en place", ondelete="set null")

    def _journal_risk(self, action, note=None):
        for measure in self:
            measure.risk_id._journal(action, note=note or f"{dict(CONTROL_LEVELS)[measure.control_level]} : "
                                                           f"{measure.description[:200]}")
