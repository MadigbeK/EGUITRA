"""Règlements fournisseurs soumis à approbation au-delà des seuils.

L'assistant de règlement crée le paiement ; s'il relève d'un circuit, il reste en brouillon et une
demande est ouverte. À la dernière approbation, le paiement est comptabilisé puis lettré avec les
pièces d'achat qu'il règle.
"""

from odoo import models
from odoo.exceptions import UserError

from .account_move import approval_granted, fingerprint


class AccountPayment(models.Model):
    _inherit = "account.payment"

    def _eguitra_required_rules(self):
        """Tout règlement sortant passe par le circuit « payment_out » au-delà du seuil : règlement d'un
        fournisseur comme remboursement d'un client (avoir remboursé), décision du gérant du 26/10/2026."""
        self.ensure_one()
        if self.payment_type != "outbound":
            return self.env["eguitra.approval.rule"]
        return self.env["eguitra.approval.rule"]._applicable("payment_out", self.company_id, abs(self.amount_company_currency_signed or self.amount))

    def _eguitra_fingerprint(self):
        """Bénéficiaire, son compte bancaire, montant, devise, journal et compte de contrepartie."""
        self.ensure_one()
        return fingerprint([self.payment_type, self.partner_type, self.partner_id.id, self.partner_bank_id.id,
                            round(self.amount, 2), self.currency_id.id, self.journal_id.id,
                            self.destination_account_id.id])

    def _eguitra_is_approved(self):
        request = self.env["eguitra.approval.request"].sudo().search(
            [("res_model", "=", "account.payment"), ("res_id", "=", self.id), ("state", "!=", "cancelled")],
            order="id desc", limit=1,
        )
        return bool(request) and request.state == "approved" and request._matches(self)

    def action_post(self):
        if not approval_granted(self.env):
            for payment in self:
                if payment._eguitra_required_rules() and not payment._eguitra_is_approved():
                    raise UserError(f"Le règlement {payment.display_name} doit être approuvé avant d'être comptabilisé.")
        return super().action_post()

    def _eguitra_post_approved(self):
        for payment in self:
            payment.with_context(eguitra_approval_granted=True).action_post()
            bills = self.env["account.move"].sudo().search([("matched_payment_ids", "in", payment.id)])
            if not payment.move_id:
                continue
            # Compte du tiers : fournisseur réglé, ou client remboursé de son avoir.
            payable = payment.move_id.line_ids.filtered(
                lambda l: l.account_id.account_type in ("liability_payable", "asset_receivable") and not l.reconciled
            )
            open_lines = bills.line_ids.filtered(
                lambda l: l.account_id in payable.account_id and not l.reconciled and l.parent_state == "posted"
            )
            if payable and open_lines:
                (payable + open_lines).reconcile()

    def _eguitra_cancel_requests(self):
        """Demandes en cours d'un règlement supprimé ou annulé : annulées (voir account.move)."""
        if self:
            self.env["eguitra.approval.request"].sudo().search([
                ("res_model", "=", self._name), ("res_id", "in", self.ids), ("state", "=", "pending"),
            ]).write({"state": "cancelled"})

    def unlink(self):
        self._eguitra_cancel_requests()
        return super().unlink()

    def action_cancel(self):
        result = super().action_cancel()
        self.filtered(lambda p: p.state == "canceled")._eguitra_cancel_requests()
        return result


class AccountPaymentRegister(models.TransientModel):
    _inherit = "account.payment.register"

    def _post_payments(self, to_process, edit_mode=False):
        to_post = []
        for vals in to_process:
            payment = vals["payment"]
            rules = payment._eguitra_required_rules()
            if rules and not payment._eguitra_is_approved():
                self.env["eguitra.approval.request"]._open(
                    payment, "payment_out", rules, abs(payment.amount_company_currency_signed or payment.amount),
                    payment.partner_id,
                )
            else:
                to_post.append(vals)
        return super()._post_payments(to_post, edit_mode=edit_mode)
