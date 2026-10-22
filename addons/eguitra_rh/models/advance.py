"""Avances sur salaire et prêts au personnel, remboursés par retenues mensuelles sur la paie.

Le versement de l'avance ou du prêt est enregistré par la finance (débit du compte 421 au nom du
salarié) ; la paie en retient chaque mois la mensualité, jusqu'à épuisement du reste dû.

Quatre yeux : créer, modifier ou annuler une avance inscrit son auteur parmi les préparateurs des paies
en préparation concernées ; seul le suivi du solde par la paie (validation, réouverture) ne le fait pas.
"""

from odoo import api, fields, models
from odoo.exceptions import UserError

from .payroll import is_trusted, trusted


class EguitraRhAdvance(models.Model):
    _name = "eguitra.rh.advance"
    _description = "Avance ou prêt au personnel"
    _order = "date desc, id desc"
    _check_company_auto = True

    employee_id = fields.Many2one("eguitra.rh.employee", "Salarié", required=True, index=True, check_company=True)
    company_id = fields.Many2one(related="employee_id.company_id", store=True, index=True)
    kind = fields.Selection([("avance", "Avance sur salaire"), ("pret", "Prêt")], required=True, default="avance")
    date = fields.Date("Accordé le", required=True, default=fields.Date.context_today)
    amount = fields.Float("Montant", required=True)
    installment = fields.Float("Mensualité", required=True)
    first_month = fields.Date("Première retenue (mois)", required=True)
    state = fields.Selection([("open", "En cours"), ("done", "Soldé"), ("cancelled", "Annulé")], default="open",
                             required=True)
    note = fields.Char("Motif")

    @api.constrains("amount", "installment")
    def _check_amounts(self):
        for adv in self:
            if adv.amount <= 0 or adv.installment <= 0:
                raise UserError("Montant et mensualité doivent être positifs.")
            if adv.installment > adv.amount:
                raise UserError("La mensualité dépasse le montant.")

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records._draft_payrolls()._mark_prepared()
        return records

    def write(self, vals):
        if is_trusted(self.env):
            return super().write(vals)
        payrolls = self._draft_payrolls()
        result = super().write(vals)
        (payrolls | self._draft_payrolls())._mark_prepared()
        return result

    def unlink(self):
        self._draft_payrolls()._mark_prepared()
        return super().unlink()

    def _draft_payrolls(self):
        """Paies en préparation de la société à partir du premier mois de retenue."""
        Payroll = self.env["eguitra.rh.payroll"].sudo()
        result = Payroll
        for adv in self.sudo():
            result |= Payroll.search([("company_id", "=", adv.company_id.id), ("state", "=", "draft"),
                                      ("month", ">=", adv.first_month.replace(day=1))])
        return result

    def _reimbursed(self, exclude_payslip=None):
        """Retenues des bulletins validés (et du bulletin en préparation, sauf celui à exclure)."""
        self.ensure_one()
        inputs = self.env["eguitra.rh.payslip.input"].sudo().search([("advance_id", "=", self.id)])
        if exclude_payslip:
            inputs = inputs.filtered(lambda i: i.payslip_id != exclude_payslip)
        validated = inputs.filtered(lambda i: i.payslip_id.payroll_id.state != "draft")
        return sum(validated.mapped("amount"))

    def _remaining(self, exclude_payslip=None):
        self.ensure_one()
        return max(self.amount - self._reimbursed(exclude_payslip), 0.0)

    def _due_for(self, payslip):
        """Retenue du mois du bulletin : la mensualité, bornée au reste dû."""
        self.ensure_one()
        if self.state != "open" or self.first_month > payslip.month:
            return 0.0
        return min(self.installment, self._remaining(exclude_payslip=payslip))

    def _update_state(self):
        """Solde suivi par la paie (validation, réouverture) : écriture de confiance, qui n'inscrit personne
        parmi les préparateurs."""
        for adv in trusted(self.filtered(lambda a: a.state in ("open", "done"))):
            adv.write({"state": "done" if adv._remaining() <= 0 else "open"})

    def action_cancel(self):
        for adv in self:
            if adv._reimbursed():
                raise UserError("Des retenues ont déjà été faites sur la paie : l'avance ne peut plus être annulée.")
            adv.state = "cancelled"
