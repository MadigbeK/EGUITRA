"""Plan d'actions (spécification §3, §9.2) : registre unique des actions correctives et préventives, quelle
que soit leur origine (événement, contrôle, audit, risque, revue de direction).

- Statuts : à faire, en cours, à vérifier, close, annulée.
- Démarrage d'une action coûteuse (coût estimé au seuil des paramètres, 50 000 000 GNF par défaut) après
  la validation de la direction seulement.
- Clôture avec au moins une preuve jointe ; une action issue d'un événement de criticité 8 ou plus passe
  « à vérifier » et son efficacité se vérifie à J+90 avant la clôture définitive ; inefficace, elle
  retourne « en cours » avec une nouvelle échéance.
- Relances du responsable à J-7, J0 puis chaque semaine de retard ; escalade au Directeur général après
  30 jours de retard (tâche planifiée quotidienne).
"""

from datetime import timedelta

from odoo import api, fields, models

from .common import (
    ACTION_ORIGINS,
    ACTION_STATUSES,
    CONTROL_LEVELS,
    HSSEQ_GROUP,
    REMINDER_KINDS,
    HsseqError,
    users_in_group,
)


class EguitraHsseqAction(models.Model):
    _name = "eguitra.hsseq.action"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Action HSSEQ"
    _order = "due_date, id"
    _check_company_auto = True
    _journal_key = "action"
    _journal_fields = ("description", "control_level", "owner_id", "due_date", "expected_evidence", "estimated_cost",
                       "status", "approved_at", "verification_date", "effective", "verification_comment")

    reference = fields.Char("Référence", default="/", copy=False, readonly=True, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    origin = fields.Selection(ACTION_ORIGINS, "Origine", required=True, default="event")
    origin_id = fields.Integer("Identifiant de l'origine")
    event_id = fields.Many2one("eguitra.hsseq.event", "Événement d'origine", check_company=True, index=True,
                               ondelete="restrict")
    check_id = fields.Many2one("eguitra.hsseq.check", "Contrôle d'origine", check_company=True, index=True,
                               ondelete="restrict")
    risk_id = fields.Many2one("eguitra.hsseq.risk", "Risque d'origine", check_company=True, index=True,
                              ondelete="restrict")
    finding_id = fields.Many2one("eguitra.hsseq.finding", "Constat d'audit d'origine", index=True,
                                 ondelete="restrict")
    description = fields.Text("Action", required=True)
    control_level = fields.Selection(CONTROL_LEVELS, "Niveau de maîtrise")
    owner_id = fields.Many2one("res.users", "Responsable", required=True, index=True)
    due_date = fields.Date("Échéance", required=True, index=True)
    expected_evidence = fields.Text("Preuve attendue")
    estimated_cost = fields.Monetary("Coût estimé")
    approved_at = fields.Datetime("Validée par la direction le", readonly=True)
    approved_by = fields.Many2one("res.users", "Validée par", readonly=True)
    approved_cost = fields.Monetary("Coût validé", readonly=True)
    status = fields.Selection(ACTION_STATUSES, "Statut", required=True, default="todo", index=True)
    started_at = fields.Datetime("Démarrée le", readonly=True)
    done_at = fields.Datetime("Réalisée le", readonly=True)
    verification_date = fields.Date("Vérification d'efficacité le", readonly=True)
    verified_at = fields.Datetime("Vérifiée le", readonly=True)
    verified_by = fields.Many2one("res.users", "Vérifiée par", readonly=True)
    effective = fields.Boolean("Efficace", readonly=True)
    verification_comment = fields.Text("Commentaire de vérification", readonly=True)
    closed_at = fields.Datetime("Close le", readonly=True)
    cancel_reason = fields.Text("Motif d'annulation", readonly=True)
    reopen_reason = fields.Text("Motif de la dernière réouverture", readonly=True)
    site_id = fields.Many2one("eguitra.hsseq.site", "Site", compute="_compute_site", store=True, index=True)
    reminder_ids = fields.One2many("eguitra.hsseq.action.reminder", "action_id", "Relances")

    @api.depends("event_id.site_id", "check_id.site_id", "risk_id.site_id", "finding_id.site_id")
    def _compute_site(self):
        for action in self:
            action.site_id = (action.event_id.site_id or action.check_id.site_id or action.risk_id.site_id
                              or action.finding_id.site_id)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("origin") == "event" and vals.get("origin_id") and not vals.get("event_id"):
                vals["event_id"] = vals["origin_id"]
            if vals.get("origin") == "check" and vals.get("origin_id") and not vals.get("check_id"):
                vals["check_id"] = vals["origin_id"]
            if vals.get("origin") == "risk" and vals.get("origin_id") and not vals.get("risk_id"):
                vals["risk_id"] = vals["origin_id"]
            if vals.get("origin") == "audit" and vals.get("origin_id") and not vals.get("finding_id"):
                vals["finding_id"] = vals["origin_id"]
        actions = super().create(vals_list)
        for action in actions:
            action.reference = self.env["ir.sequence"].sudo().next_by_code("eguitra.hsseq.action") or "/"
        return actions

    # ─── Règles ───────────────────────────────────────────────────────────

    def _settings(self):
        self.ensure_one()
        return self.env["eguitra.hsseq.settings"]._get(self.company_id)

    def _origin_criticality(self):
        self.ensure_one()
        return self.sudo().event_id.criticality or 0

    def _verification_required(self):
        """Vérification d'efficacité à J+90 : action issue d'un objet de criticité 8 ou plus (§9.2)."""
        self.ensure_one()
        return self._origin_criticality() >= self._settings().verification_min_criticality

    def _approval_required(self):
        """Action coûteuse (coût estimé au seuil des paramètres) pas encore validée par la direction."""
        self.ensure_one()
        return self._is_costly() and not self.approved_at

    def _approval_pending(self):
        """Validation de la direction attendue : action coûteuse non validée, ni close ni annulée."""
        self.ensure_one()
        return self._approval_required() and self.status not in ("closed", "cancelled")

    def write(self, vals):
        """Un changement du coût estimé annule la validation de la direction ; une action coûteuse déjà
        démarrée revient « à faire » jusqu'à sa nouvelle validation."""
        changed = self.browse()
        if "estimated_cost" in vals:
            changed = self.filtered(lambda a: a.estimated_cost != (vals["estimated_cost"] or 0.0))
        result = super().write(vals)
        if changed:
            super(EguitraHsseqAction, changed).write({"approved_at": False, "approved_by": False, "approved_cost": 0.0})
            restart = changed.filtered(lambda a: a.status == "in_progress" and a._is_costly())
            if restart:
                super(EguitraHsseqAction, restart).write({"status": "todo", "started_at": False})
                restart._journal("approval_reset", note="Coût estimé modifié : nouvelle validation de la direction.")
        return result

    def _is_costly(self):
        self.ensure_one()
        threshold = self._settings().costly_action_threshold
        return bool(threshold and self.estimated_cost >= threshold)

    def _days_overdue(self, day=None):
        self.ensure_one()
        day = day or fields.Date.context_today(self)
        if self.status in ("todo", "in_progress") and self.due_date and self.due_date < day:
            return (day - self.due_date).days
        return 0

    def _evidence(self):
        return self.env["eguitra.hsseq.attachment"]._for("action", self)

    def _transitions(self):
        self.ensure_one()
        return {
            "todo": ["start", "cancel"] + (["approve"] if self._approval_required() else []),
            "in_progress": ["close", "cancel"],
            "to_verify": ["verify", "cancel"],
            "closed": ["reopen"],
            "cancelled": ["reopen"],
        }[self.status]

    def _require(self, transition):
        if transition not in self._transitions():
            raise HsseqError("invalid_transition", f"Transition « {transition} » impossible depuis le statut "
                                                   f"« {dict(ACTION_STATUSES)[self.status]} ».")

    def action_start(self):
        self.ensure_one()
        self._require("start")
        if self._approval_required():
            raise HsseqError("approval_required", "Action coûteuse : la direction la valide avant son démarrage.")
        self.write({"status": "in_progress", "started_at": fields.Datetime.now()})
        self._journal("start")
        return True

    def action_close(self):
        """Réalisation : preuve jointe obligatoire ; à vérifier à J+90 si l'origine est de criticité 8 ou plus."""
        self.ensure_one()
        self._require("close")
        if not self._evidence():
            raise HsseqError("proof_required", "Joignez au moins une preuve de réalisation avant de clore l'action.")
        now = fields.Datetime.now()
        if self._verification_required():
            days = self._settings().verification_days
            self.write({"status": "to_verify", "done_at": now,
                        "verification_date": fields.Date.context_today(self) + timedelta(days=days)})
        else:
            self.write({"status": "closed", "done_at": now, "closed_at": now})
        self._journal("close")
        return True

    def action_verify(self, effective, comment=None, new_due_date=None):
        self.ensure_one()
        self._require("verify")
        if self.verification_date and fields.Date.context_today(self) < self.verification_date:
            raise HsseqError("verification_too_early",
                             f"Vérification d'efficacité à partir du {self.verification_date:%d/%m/%Y}.")
        now = fields.Datetime.now()
        values = {"verified_at": now, "verified_by": self.env.uid, "effective": bool(effective),
                  "verification_comment": comment or False}
        if effective:
            values.update(status="closed", closed_at=now)
        else:
            if not new_due_date:
                raise HsseqError("missing_fields", "Action inefficace : fixez une nouvelle échéance.",
                                 fields=["new_due_date"], status=400)
            values.update(status="in_progress", due_date=new_due_date, done_at=False, verification_date=False)
        self.write(values)
        self._journal("verify", note="efficace" if effective else "inefficace")
        return True

    def action_approve(self):
        self.ensure_one()
        self._require("approve")
        self.write({"approved_at": fields.Datetime.now(), "approved_by": self.env.uid,
                    "approved_cost": self.estimated_cost})
        self._journal("approve")
        return True

    def action_cancel(self, reason):
        self.ensure_one()
        self._require("cancel")
        if not (reason or "").strip():
            raise HsseqError("reason_required", "Le motif de l'annulation est obligatoire.", fields=["reason"])
        self.write({"status": "cancelled", "cancel_reason": reason.strip()})
        self._journal("cancel", note=reason.strip())
        return True

    def action_reopen(self, reason):
        self.ensure_one()
        self._require("reopen")
        if not (reason or "").strip():
            raise HsseqError("reason_required", "Le motif de la réouverture est obligatoire.", fields=["reason"])
        self.write({"status": "in_progress", "closed_at": False, "reopen_reason": reason.strip()})
        self._journal("reopen", note=reason.strip())
        return True

    # ─── Relances (§9.2) ──────────────────────────────────────────────────

    def _reminder_kind(self, day):
        """Relance due ce jour : J-7, J0, chaque semaine de retard ; escalade une fois, après 30 jours."""
        self.ensure_one()
        if self.status not in ("todo", "in_progress") or not self.due_date:
            return None
        delta = (self.due_date - day).days
        if delta == 7:
            return "d_minus_7"
        if delta == 0:
            return "d0"
        if delta < 0:
            late = -delta
            if late >= self._settings().escalation_days and not self.reminder_ids.filtered(
                    lambda r: r.kind == "escalation"):
                return "escalation"
            if late % 7 == 0:
                return "weekly"
        return None

    @api.model
    def _cron_reminders(self):
        day = fields.Date.context_today(self)
        Notification = self.env["eguitra.hsseq.notification"]
        actions = self.sudo().search([("status", "in", ("todo", "in_progress")), ("due_date", "<=", day + timedelta(days=7))])
        for action in actions:
            kind = action._reminder_kind(day)
            if not kind or action.reminder_ids.filtered(lambda r, k=kind: r.kind == k and r.date == day):
                continue
            users = action.owner_id
            if kind == "escalation":
                users |= action._settings()._directors() | users_in_group(self.env, HSSEQ_GROUP, action.company_id)
            subject = {"d_minus_7": "Action à réaliser dans 7 jours", "d0": "Action à réaliser aujourd'hui",
                       "weekly": f"Action en retard de {action._days_overdue(day)} jours",
                       "escalation": f"Escalade : action en retard de {action._days_overdue(day)} jours"}[kind]
            body = f"{action.reference} : {action.description}\nÉchéance : {action.due_date:%d/%m/%Y}" \
                   f"\nResponsable : {action.owner_id.name}"
            Notification._notify(users, f"action_{kind}", subject, body, action, "action")
            self.env["eguitra.hsseq.action.reminder"].sudo().create({
                "action_id": action.id, "kind": kind, "date": day,
                "recipient_ids": [fields.Command.set(users.ids)]})
        return True


class EguitraHsseqActionReminder(models.Model):
    _name = "eguitra.hsseq.action.reminder"
    _description = "Relance d'une action HSSEQ"
    _order = "date, id"

    action_id = fields.Many2one("eguitra.hsseq.action", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="action_id.company_id", store=True)
    kind = fields.Selection(REMINDER_KINDS, "Relance", required=True)
    date = fields.Date("Le", required=True)
    recipient_ids = fields.Many2many("res.users", string="Destinataires")
