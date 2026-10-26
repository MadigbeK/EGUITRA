"""Échéances d'emprunt au rapprochement bancaire : une sortie de banque peut régler une échéance
(eguitra.loan.line), proposée parmi les candidats et rapprochée par les points d'extension de
models/treasury.py. Importé après treasury.py, pour que ces méthodes complètent les siennes.

Une opération d'un type à part d'emprunt (déblocage, capital ou intérêts hors échéancier) garde le
financement qu'elle mouvemente (eguitra_loan_id) : les déblocages cumulés et les remboursements
anticipés se contrôlent ainsi contre le montant emprunté et le capital restant dû."""

from odoo import fields, models
from odoo.exceptions import UserError


class AccountBankStatementLine(models.Model):
    _inherit = "account.bank.statement.line"

    eguitra_loan_id = fields.Many2one(
        "eguitra.loan", "Financement", index="btree_not_null", copy=False,
        help="Financement mouvementé par un type d'opération à part d'emprunt (déblocage, capital ou intérêts "
             "hors échéancier) ; la contrepartie est son compte de dette ou de charges financières.",
    )

    def _eguitra_collect_candidates(self):
        return super()._eguitra_collect_candidates() + self.env["eguitra.loan.line"]._statement_candidates(self)

    def _eguitra_reconcile(self, data):
        if data.get("loan_line_id"):
            self.ensure_one()
            if self.is_reconciled:
                raise UserError("Cette opération est déjà rapprochée.")
            loan_line = self.env["eguitra.loan.line"].browse(int(data["loan_line_id"])).exists()
            if not loan_line or loan_line.company_id != self.company_id:
                raise UserError("Échéance introuvable.")
            loan_line.action_settle_from_statement(self)
            return self
        return super()._eguitra_reconcile(data)

    def action_undo_reconciliation(self):
        """Rapprochement défait d'une sortie qui réglait une échéance d'emprunt : l'écriture d'échéance
        passée au compte du prêteur est annulée (la dette et les intérêts reviennent), l'échéance redevient
        due et le financement soldé repasse en cours (AccountMove.button_draft, models/loan.py)."""
        loan_lines = self.env["eguitra.loan.line"].sudo().search([("statement_line_id", "in", self.ids)])
        result = super().action_undo_reconciliation()
        for loan_line in loan_lines:
            move = loan_line.move_id
            if move.state == "posted":
                move.button_draft()
                move.button_cancel()
            loan_line._reopen()
        return result

    def _eguitra_impute_extra_values(self):
        values = super()._eguitra_impute_extra_values()
        values["eguitra_loan_id"] = self.eguitra_loan_id.id or False
        return values
