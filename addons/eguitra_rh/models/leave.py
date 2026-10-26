"""Absences et congés : demande (du salarié ou de la RH), décision (RH, direction ou responsable
hiérarchique), décompte en jours ouvrables, solde de congés payés. Une absence non rémunérée approuvée
est retenue sur la paie du mois, au prorata des jours ouvrables.

Quatre yeux : toute écriture qui fait entrer une absence dans la paie ou l'en fait sortir (créer une
absence non rémunérée déjà approuvée, l'approuver, l'annuler, en changer les dates ou le type) inscrit
son auteur parmi les préparateurs des paies en préparation dont le mois la recoupe."""

from odoo import api, fields, models
from odoo.exceptions import UserError

from ..engine import jours


class InsufficientBalance(UserError):
    """Solde de congés insuffisant : la RH peut approuver quand même (force)."""


class EguitraRhLeave(models.Model):
    _name = "eguitra.rh.leave"
    _description = "Absence"
    _order = "date_from desc, id desc"
    _check_company_auto = True

    name = fields.Char("Libellé", compute="_compute_name", store=True)
    employee_id = fields.Many2one("eguitra.rh.employee", "Salarié", required=True, index=True, check_company=True)
    company_id = fields.Many2one(related="employee_id.company_id", store=True, index=True)
    type_id = fields.Many2one("eguitra.rh.leave.type", "Type", required=True)
    date_from = fields.Date("Du", required=True, index=True)
    date_to = fields.Date("Au", required=True, index=True)
    half_day = fields.Boolean("Demi-journée")
    days = fields.Float("Jours ouvrables", compute="_compute_days", store=True)
    state = fields.Selection([("submitted", "À valider"), ("approved", "Approuvée"), ("refused", "Refusée"),
                              ("cancelled", "Annulée")], default="submitted", required=True, index=True)
    note = fields.Text("Motif")
    refusal_reason = fields.Char("Motif du refus")
    requested_by = fields.Many2one("res.users", "Demandée par", default=lambda self: self.env.user)
    approver_id = fields.Many2one("res.users", "Décidée par", readonly=True)
    decided_at = fields.Datetime("Décidée le", readonly=True)
    attachment_id = fields.Many2one("ir.attachment", "Justificatif", ondelete="set null")

    @api.depends("type_id", "employee_id", "date_from", "date_to")
    def _compute_name(self):
        for leave in self:
            if leave.date_from and leave.date_to:
                leave.name = f"{leave.type_id.name or 'Absence'}, du {leave.date_from:%d/%m/%Y} au {leave.date_to:%d/%m/%Y}"
            else:
                leave.name = leave.type_id.name or "Absence"

    @api.depends("date_from", "date_to", "half_day", "employee_id")
    def _compute_days(self):
        Holiday = self.env["eguitra.rh.holiday"]
        for leave in self:
            company = leave.employee_id.company_id or self.env.company
            days = Holiday._working_days(company, leave.date_from, leave.date_to)
            leave.days = 0.5 if leave.half_day and days else days

    @api.constrains("date_from", "date_to", "half_day", "employee_id", "state", "type_id")
    def _check_leave(self):
        for leave in self:
            if leave.date_to < leave.date_from:
                raise UserError("La date de fin précède la date de début.")
            if leave.half_day and leave.date_from != leave.date_to:
                raise UserError("Une demi-journée porte sur un seul jour.")
            if leave.state in ("submitted", "approved"):
                if not leave.days:
                    raise UserError("Aucun jour ouvrable dans cette période (dimanches et jours fériés exclus).")
                if leave.type_id.max_days and leave.days > leave.type_id.max_days:
                    raise UserError(f"{leave.type_id.name} : {jours(leave.type_id.max_days)} ouvrables au plus par demande.")
                employee = leave.employee_id
                if leave.date_from < employee.hire_date or (employee.exit_date and leave.date_to > employee.exit_date):
                    raise UserError("L'absence sort de la période du contrat du salarié.")
                overlap = self.sudo().search_count([
                    ("id", "!=", leave.id), ("employee_id", "=", employee.id), ("state", "in", ("submitted", "approved")),
                    ("date_from", "<=", leave.date_to), ("date_to", ">=", leave.date_from),
                ])
                if overlap:
                    raise UserError(f"{employee.name} a déjà une absence demandée ou approuvée sur ces dates.")

    # ─── Paies concernées (quatre yeux) ──────────────────────────────────

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records._in_payroll()._draft_payrolls()._mark_stale()
        return records

    def write(self, vals):
        before = self._in_payroll()._draft_payrolls()
        result = super().write(vals)
        (before | self._in_payroll()._draft_payrolls())._mark_stale()
        return result

    def unlink(self):
        self._in_payroll()._draft_payrolls()._mark_stale()
        return super().unlink()

    def _in_payroll(self):
        """Absences retenues sur la paie : approuvées, d'un type non rémunéré."""
        return self.sudo().filtered(lambda leave: leave.state == "approved" and not leave.type_id.paid)

    def _draft_payrolls(self):
        """Paies en préparation de la société dont le mois recoupe l'absence."""
        Payroll = self.env["eguitra.rh.payroll"].sudo()
        result = Payroll
        for leave in self.sudo():
            result |= Payroll.search([("company_id", "=", leave.company_id.id), ("state", "=", "draft"),
                                      ("month", "<=", leave.date_to), ("month", ">=", leave.date_from.replace(day=1))])
        return result

    def _locked_month(self):
        """Paie validée d'un mois touché par l'absence (une absence non rémunérée y a été retenue)."""
        self.ensure_one()
        return self.env["eguitra.rh.payroll"].sudo().search([
            ("company_id", "=", self.company_id.id), ("state", "!=", "draft"),
            ("month", "<=", self.date_to), ("month", ">=", self.date_from.replace(day=1)),
        ], limit=1)

    def action_approve(self, force=False):
        for leave in self:
            if leave.state != "submitted":
                raise UserError("Seule une demande à valider peut être approuvée.")
            if leave.type_id.deducts_balance and not force:
                balance = leave.employee_id._leave_balance(leave.date_from)["balance"]
                if balance - leave.days < 0:
                    raise InsufficientBalance(
                        f"Solde de congés insuffisant : {jours(balance)} acquis pour {jours(leave.days)} "
                        f"{'demandés' if abs(leave.days) >= 2 else 'demandé'}.")
            if not leave.type_id.paid and leave._locked_month():
                raise UserError("La paie de ce mois est déjà validée : rouvrez-la avant d'approuver cette absence "
                                "non rémunérée.")
            leave.write({"state": "approved", "approver_id": self.env.user.id, "decided_at": fields.Datetime.now()})

    def action_refuse(self, reason=None):
        for leave in self:
            if leave.state != "submitted":
                raise UserError("Seule une demande à valider peut être refusée.")
            leave.write({"state": "refused", "refusal_reason": reason or False, "approver_id": self.env.user.id,
                         "decided_at": fields.Datetime.now()})

    def action_cancel(self):
        for leave in self:
            if leave.state not in ("submitted", "approved"):
                raise UserError("Cette absence est déjà refusée ou annulée.")
            if leave.state == "approved" and not leave.type_id.paid and leave._locked_month():
                raise UserError("La paie de ce mois est déjà validée : rouvrez-la avant d'annuler cette absence "
                                "non rémunérée.")
            leave.state = "cancelled"
