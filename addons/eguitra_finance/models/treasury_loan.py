"""Échéances d'emprunt au rapprochement bancaire : une sortie de banque peut régler une échéance
(eguitra.loan.line), proposée parmi les candidats et rapprochée par les points d'extension de
models/treasury.py. Importé après treasury.py, pour que ces méthodes complètent les siennes."""

from odoo import models
from odoo.exceptions import UserError


class AccountBankStatementLine(models.Model):
    _inherit = "account.bank.statement.line"

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
