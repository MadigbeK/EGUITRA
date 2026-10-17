"""Engagements de dépense : une dépense est approuvée avant d'être commandée (attente 10 du courrier
du responsable financier, « workflow d'approbation pour les engagements et paiements »).

Un engagement (fournisseur, objet, compte, répartition analytique, montant hors taxes, devis joint)
passe par le même moteur que les pièces (nature « commitment », mêmes règles par montant). Approuvé,
il est engagé : les pièces d'achat qui s'y rattachent le consomment et, tant qu'elles ne dépassent pas
le reste à engager (avec une tolérance), ne refont pas le circuit. Le comparatif budgétaire et l'état
des engagements non soldés en tiennent compte.
"""

from odoo import api, fields, models
from odoo.exceptions import UserError

from .account_move import fingerprint

STATES = [
    ("draft", "Brouillon"),
    ("submitted", "En approbation"),
    ("approved", "Engagé"),
    ("rejected", "Refusé"),
    ("done", "Soldé"),
    ("cancelled", "Annulé"),
]
TOLERANCE_PARAM = "eguitra_approval.commitment_tolerance_pct"
DEFAULT_TOLERANCE = 5.0


class EguitraCommitment(models.Model):
    _name = "eguitra.commitment"
    _inherit = ["analytic.mixin"]
    _description = "Engagement de dépense"
    _order = "id desc"

    name = fields.Char("Référence", default="/", readonly=True, copy=False, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    partner_id = fields.Many2one("res.partner", "Fournisseur", required=True, index=True)
    object = fields.Char("Objet de la dépense", required=True)
    account_id = fields.Many2one("account.account", "Compte de charge ou d'immobilisation")
    amount = fields.Monetary("Montant engagé (HT)", required=True)
    date = fields.Date("Date de la demande", default=fields.Date.context_today, required=True)
    date_expected = fields.Date("Livraison ou exécution prévue")
    note = fields.Text("Justification")
    quote_id = fields.Many2one("ir.attachment", "Devis", copy=False)
    state = fields.Selection(STATES, default="draft", required=True, index=True, copy=False)
    requested_by = fields.Many2one("res.users", default=lambda self: self.env.user, readonly=True)
    move_ids = fields.One2many("account.move", "eguitra_commitment_id", "Pièces d'achat rattachées")
    consumed = fields.Monetary("Consommé (HT)", compute="_compute_consumed")
    remaining = fields.Monetary("Reste à engager (HT)", compute="_compute_consumed")

    @api.depends("amount", "move_ids.state", "move_ids.amount_untaxed_signed")
    def _compute_consumed(self):
        for c in self:
            posted = c.move_ids.filtered(lambda m: m.state == "posted")
            c.consumed = sum(-m.amount_untaxed_signed for m in posted)
            c.remaining = c.amount - c.consumed

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("name", "/") == "/":
                vals["name"] = self.env["ir.sequence"].next_by_code("eguitra.commitment") or "/"
        return super().create(vals_list)

    def write(self, vals):
        locked = set(vals) & {"partner_id", "amount", "account_id", "analytic_distribution", "object", "company_id"}
        if locked and self.filtered(lambda c: c.state not in ("draft", "rejected")):
            raise UserError("Un engagement soumis ou approuvé ne se modifie plus : annulez-le et créez-en un autre.")
        return super().write(vals)

    def unlink(self):
        if self.filtered(lambda c: c.state not in ("draft", "cancelled")):
            raise UserError("Seul un engagement en brouillon ou annulé se supprime.")
        return super().unlink()

    # ─── Circuit d'approbation ────────────────────────────────────────────

    def _eguitra_fingerprint(self):
        self.ensure_one()
        return fingerprint(["commitment", self.partner_id.id, self.account_id.id, round(self.amount, 2),
                            self.currency_id.id, self.analytic_distribution or {}, self.object])

    def _eguitra_required_rules(self):
        self.ensure_one()
        codes = [self.account_id.code] if self.account_id.code else []
        return self.env["eguitra.approval.rule"]._applicable("commitment", self.company_id, self.amount, codes)

    def _eguitra_last_request(self):
        self.ensure_one()
        return self.env["eguitra.approval.request"].sudo().search(
            [("res_model", "=", self._name), ("res_id", "=", self.id), ("state", "!=", "cancelled")],
            order="id desc", limit=1,
        )

    def action_submit(self):
        """Soumission : circuit d'approbation, ou engagement immédiat si aucune règle ne s'applique."""
        for c in self:
            if c.state not in ("draft", "rejected"):
                raise UserError(f"L'engagement {c.name} a déjà été soumis.")
            if c.amount <= 0:
                raise UserError("Le montant engagé doit être positif.")
            rules = c._eguitra_required_rules()
            if not rules:
                c.state = "approved"
                continue
            self.env["eguitra.approval.request"]._open(c, "commitment", rules, c.amount, c.partner_id)
            c.state = "submitted"
        return True

    def _eguitra_on_approved(self):
        self.filtered(lambda c: c.state == "submitted").sudo().write({"state": "approved"})

    def _eguitra_on_rejected(self):
        self.filtered(lambda c: c.state == "submitted").sudo().write({"state": "rejected"})

    def action_close(self):
        """Soldé : plus aucune pièce ne s'y rattache (reste abandonné ou entièrement consommé)."""
        for c in self:
            if c.state != "approved":
                raise UserError(f"Seul un engagement en cours se solde ({c.name}).")
            c.state = "done"
        return True

    def action_cancel(self):
        for c in self:
            if c.move_ids.filtered(lambda m: m.state == "posted"):
                raise UserError(f"L'engagement {c.name} est déjà consommé par des pièces : soldez-le.")
            request = c._eguitra_last_request()
            if request.state == "pending":
                request.sudo().state = "cancelled"
            c.state = "cancelled"
        return True

    # ─── Consommation par les pièces d'achat ──────────────────────────────

    @api.model
    def tolerance_pct(self):
        value = self.env["ir.config_parameter"].sudo().get_param(TOLERANCE_PARAM)
        try:
            return float(value) if value not in (None, "", False) else DEFAULT_TOLERANCE
        except ValueError:
            return DEFAULT_TOLERANCE

    def covers(self, move):
        """La pièce d'achat reste-t-elle dans l'engagement approuvé (même fournisseur, même société,
        montant hors taxes dans le reste à engager augmenté de la tolérance) ?"""
        self.ensure_one()
        if self.state != "approved" or move.partner_id.commercial_partner_id != self.partner_id.commercial_partner_id:
            return False
        if move.company_id != self.company_id:
            return False
        already = sum(-m.amount_untaxed_signed for m in self.move_ids.filtered(lambda m: m.state == "posted" and m != move))
        allowed = self.amount * (1 + self.tolerance_pct() / 100)
        return already + abs(move.amount_untaxed_signed) <= allowed + 0.5
