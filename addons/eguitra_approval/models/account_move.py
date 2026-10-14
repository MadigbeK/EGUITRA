from odoo import models
from odoo.exceptions import UserError


class AccountMove(models.Model):
    _inherit = "account.move"

    def _eguitra_approval_document(self):
        self.ensure_one()
        if self.move_type in ("in_invoice", "in_refund"):
            return "in_invoice"
        # Seules les OD saisies dans les applications entrent dans le circuit ; les écritures produites
        # par le noyau (dotations, relevés, règlements, extournes) n'y entrent jamais.
        if self.move_type == "entry" and self.env.context.get("eguitra_manual_entry") and self.journal_id.type == "general":
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
        codes = [code for code in self.line_ids.account_id.mapped("code") if code]
        return self.env["eguitra.approval.rule"]._applicable(
            document, self.company_id, self._eguitra_approval_amount(), codes
        )

    def _eguitra_last_request(self):
        self.ensure_one()
        return self.env["eguitra.approval.request"].sudo().search(
            [("res_model", "=", "account.move"), ("res_id", "=", self.id), ("state", "!=", "cancelled")],
            order="id desc", limit=1,
        )

    def _eguitra_is_approved(self):
        request = self._eguitra_last_request()
        return bool(request) and request.state == "approved" and abs(request.amount - self._eguitra_approval_amount()) < 0.5

    def action_post(self):
        if not self.env.context.get("eguitra_approval_granted"):
            for move in self:
                if move._eguitra_required_rules() and not move._eguitra_is_approved():
                    raise UserError(
                        f"La pièce {move.display_name} doit être approuvée avant d'être validée : "
                        "soumettez-la au circuit d'approbation."
                    )
        return super().action_post()

    def _eguitra_post_or_submit(self):
        for move in self:
            rules = move._eguitra_required_rules()
            if not rules or move._eguitra_is_approved():
                move.with_context(eguitra_approval_granted=True).action_post()
                continue
            pending = move._eguitra_last_request()
            if pending.state == "pending" and abs(pending.amount - move._eguitra_approval_amount()) < 0.5:
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
