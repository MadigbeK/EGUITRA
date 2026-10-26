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

    eguitra_cash_out = fields.Boolean(
        "Décaissement soumis au circuit", copy=False, readonly=True,
        help="Décaissement de caisse ou de banque retenu par le circuit d'approbation (nature cash_out).",
    )
    eguitra_paired_move_id = fields.Many2one(
        "account.move", "Pièce liée", copy=False, readonly=True,
        help="Entrée d'un virement interne, comptabilisée à l'approbation de la sortie.",
    )
    eguitra_commitment_id = fields.Many2one(
        "eguitra.commitment", "Engagement", index=True, copy=False,
        help="Engagement de dépense approuvé que la pièce d'achat consomme : dans la limite du reste à "
             "engager (plus la tolérance), la pièce ne repasse pas par le circuit d'approbation.",
    )

    def _eguitra_is_cash_out(self):
        """Décaissement de trésorerie : écriture qui crédite un compte de banque ou de caisse, saisie dans
        les applications (contexte eguitra_cash_out_check) ou déjà retenue par le circuit."""
        self.ensure_one()
        if self.eguitra_cash_out:
            return True
        if not self.env.context.get("eguitra_cash_out_check") or self.move_type != "entry":
            return False
        return any(line.credit > 0 and line.account_id.account_type == "asset_cash" for line in self.line_ids)

    def _eguitra_approval_document(self):
        self.ensure_one()
        if self._eguitra_is_cash_out():
            return "cash_out"
        if self.move_type in ("in_invoice", "in_refund"):
            return "in_invoice"
        # Seules les OD saisies dans les applications (marque stockée) entrent dans le circuit ; les
        # écritures produites par le noyau (dotations, relevés, règlements, extournes) n'y entrent pas.
        if self.move_type == "entry" and self.eguitra_manual_entry:
            return "entry"
        return None

    def _eguitra_approval_amount(self):
        self.ensure_one()
        if self._eguitra_approval_document() == "cash_out":
            return sum(line.credit for line in self.line_ids if line.account_id.account_type == "asset_cash")
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
        if not approval_granted(self.env) and self.env.context.get("eguitra_cash_out_check"):
            # Décaissement au-delà du seuil : la pièce reste en brouillon, la demande part au circuit ;
            # elle sera comptabilisée à la dernière approbation. Les autres pièces suivent leur cours.
            held = self.filtered(lambda m: m.state == "draft" and m._eguitra_is_cash_out()
                                 and m._eguitra_required_rules() and not m._eguitra_is_approved())
            for move in held:
                move.sudo().eguitra_cash_out = True
                pending = move._eguitra_last_request()
                if not (pending.state == "pending" and pending._matches(move)):
                    self.env["eguitra.approval.request"]._open(
                        move, "cash_out", move._eguitra_required_rules(), move._eguitra_approval_amount(),
                        move.partner_id)
            rest = self - held
            if not rest:
                return False
            self = rest  # noqa: PLW0642 - suite du traitement sur les pièces non retenues
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

    def _eguitra_payments_awaiting(self):
        """Règlements de la pièce retenus par le circuit (paiement en brouillon, demande en attente) : tant
        qu'ils ne sont pas tranchés, « Régler » est masqué et un second règlement refusé, sans quoi deux
        demandes approuvées paieraient deux fois le fournisseur."""
        self.ensure_one()
        rows = super()._eguitra_payments_awaiting()
        payments = self.sudo().matched_payment_ids.filtered(lambda p: p.state == "draft")
        if not payments:
            return rows
        requests = self.env["eguitra.approval.request"].sudo().search([
            ("res_model", "=", "account.payment"), ("res_id", "in", payments.ids), ("state", "=", "pending"),
        ], order="id")
        labels = dict(requests._fields["pending_profile"].selection)
        for request in requests:
            payment = payments.filtered(lambda p, rid=request.res_id: p.id == rid)
            step = request.current_step_id
            rows.append({
                "id": payment.id,
                "amount": payment.amount,
                "currency": payment.currency_id.name,
                "date": payment.date,
                "journal": {"id": payment.journal_id.id, "name": payment.journal_id.display_name},
                "request_id": request.id,
                "level": step.sequence if step else None,
                "pending_with": labels.get(step.profile) if step else None,
            })
        return rows
