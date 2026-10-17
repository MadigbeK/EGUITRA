import hashlib
import json

from odoo import fields, models
from odoo.exceptions import UserError


def approval_granted(env):
    """Contournement réservé au moteur lui-même : contexte posé ET mode superutilisateur,
    qu'un appel RPC d'utilisateur ne peut pas obtenir."""
    return env.su and env.context.get("eguitra_approval_granted")


def fingerprint(data):
    """Empreinte stable de ce que l'approbateur a vu (voir eguitra.approval.request.fingerprint)."""
    return hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()


class AccountMove(models.Model):
    _inherit = "account.move"

    eguitra_commitment_id = fields.Many2one(
        "eguitra.commitment", "Engagement", index=True, copy=False,
        help="Engagement de dépense approuvé que la pièce d'achat consomme : dans la limite du reste à "
             "engager (plus la tolérance), la pièce ne repasse pas par le circuit d'approbation.",
    )

    def _eguitra_approval_document(self):
        self.ensure_one()
        if self.move_type in ("in_invoice", "in_refund"):
            return "in_invoice"
        # Seules les OD saisies dans les applications (marque stockée) entrent dans le circuit ; les
        # écritures produites par le noyau (dotations, relevés, règlements, extournes) n'y entrent pas.
        if self.move_type == "entry" and self.eguitra_manual_entry:
            return "entry"
        return None

    def _eguitra_approval_amount(self):
        self.ensure_one()
        if self.move_type == "entry":
            return sum(self.line_ids.mapped("debit"))
        return abs(self.amount_total_signed)

    def _eguitra_required_rules(self):
        self.ensure_one()
        document = self._eguitra_approval_document()
        if not document:
            return self.env["eguitra.approval.rule"]
        if document == "in_invoice" and self.move_type == "in_invoice" and self.eguitra_commitment_id                 and self.eguitra_commitment_id.covers(self):
            return self.env["eguitra.approval.rule"]
        codes = [code for code in self.line_ids.account_id.mapped("code") if code]
        return self.env["eguitra.approval.rule"]._applicable(
            document, self.company_id, self._eguitra_approval_amount(), codes
        )

    def _eguitra_fingerprint(self):
        """Nature, tiers, compte bancaire du tiers, devise, journal et lignes (comptes, montants, taxes,
        analytique) : la remise en brouillon puis la modification d'une pièce approuvée la font changer."""
        self.ensure_one()
        lines = sorted(
            [line.account_id.id, line.partner_id.id, round(line.debit, 2), round(line.credit, 2),
             round(line.amount_currency, 2), sorted(line.tax_ids.ids),
             json.dumps(line.analytic_distribution or {}, sort_keys=True)]
            for line in self.line_ids
        )
        return fingerprint([self.move_type, self.partner_id.id, self.partner_bank_id.id, self.currency_id.id,
                            self.journal_id.id, lines])

    def _eguitra_last_request(self):
        self.ensure_one()
        return self.env["eguitra.approval.request"].sudo().search(
            [("res_model", "=", "account.move"), ("res_id", "=", self.id), ("state", "!=", "cancelled")],
            order="id desc", limit=1,
        )

    def _eguitra_is_approved(self):
        request = self._eguitra_last_request()
        return bool(request) and request.state == "approved" and request._matches(self)

    def action_post(self):
        if not approval_granted(self.env):
            for move in self:
                if move._eguitra_required_rules() and not move._eguitra_is_approved():
                    raise UserError(
                        f"La pièce {move.display_name} doit être approuvée avant d'être validée : "
                        "soumettez-la au circuit d'approbation."
                    )
                payment = move.origin_payment_id
                if payment and payment._eguitra_required_rules() and not payment._eguitra_is_approved():
                    raise UserError(f"Le règlement {payment.display_name} doit être approuvé avant d'être comptabilisé.")
        return super().action_post()

    def _eguitra_post_or_submit(self):
        for move in self:
            rules = move._eguitra_required_rules()
            if not rules or move._eguitra_is_approved():
                move.action_post()
                continue
            pending = move._eguitra_last_request()
            if pending.state == "pending" and pending._matches(move):
                continue
            self.env["eguitra.approval.request"]._open(
                move, move._eguitra_approval_document(), rules, move._eguitra_approval_amount(), move.partner_id
            )
        return True

    def _eguitra_approval_info(self):
        self.ensure_one()
        request = self._eguitra_last_request()
        if not request:
            return None
        step = request.current_step_id
        labels = dict(request._fields["pending_profile"].selection)
        return {
            "request_id": request.id,
            "state": request.state,
            "level": step.sequence if step else None,
            "pending_with": labels.get(step.profile) if step and request.state == "pending" else None,
        }
