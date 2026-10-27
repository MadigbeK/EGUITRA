"""Comparaison des devis fournisseurs d'un engagement de dépense, avec choix motivé.

L'engagement de dépense reste la demande approuvée (eguitra_approval). On y joint autant de devis que de
fournisseurs consultés (fournisseur, montant hors taxes, délai, pièce) ; le devis retenu l'est avec un
motif, et l'engagement en prend le fournisseur et le montant. Règle « trois devis au-delà d'un seuil »,
réglable par société (Finance > Administration > Achats et ventes ; aucun seuil par défaut, règle
désactivée) : un engagement de plus de ce montant ne se soumet qu'avec trois devis de fournisseurs
différents et le devis retenu.
"""

from odoo import api, fields, models
from odoo.exceptions import UserError

from odoo.addons.eguitra_finance.formats import number


class EguitraCommerceSupplierQuote(models.Model):
    _name = "eguitra.commerce.supplier.quote"
    _description = "Devis fournisseur d'un engagement"
    _order = "commitment_id, amount, id"

    commitment_id = fields.Many2one("eguitra.commitment", "Engagement", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="commitment_id.company_id", store=True, index=True)
    currency_id = fields.Many2one(related="commitment_id.currency_id")
    partner_id = fields.Many2one("res.partner", "Fournisseur", required=True)
    reference = fields.Char("Référence du devis")
    date = fields.Date("Date du devis", default=fields.Date.context_today)
    amount = fields.Monetary("Montant HT", required=True)
    delay_days = fields.Integer("Délai (jours)")
    note = fields.Text("Observations")
    attachment_id = fields.Many2one("ir.attachment", "Devis", copy=False)
    selected = fields.Boolean("Retenu", readonly=True, copy=False)
    selection_reason = fields.Text("Motif du choix", readonly=True, copy=False)
    selected_by = fields.Many2one("res.users", "Choisi par", readonly=True, copy=False)
    selected_at = fields.Datetime("Choisi le", readonly=True, copy=False)

    @api.model_create_multi
    def create(self, vals_list):
        quotes = super().create(vals_list)
        quotes.commitment_id._eguitra_check_quotes_editable()
        for quote in quotes:
            if quote.amount <= 0:
                raise UserError("Le montant d'un devis est positif.")
        return quotes

    def write(self, vals):
        if set(vals) - {"attachment_id", "selected", "selection_reason", "selected_by", "selected_at"}:
            self.commitment_id._eguitra_check_quotes_editable()
        return super().write(vals)

    def unlink(self):
        self.commitment_id._eguitra_check_quotes_editable()
        return super().unlink()

    def action_select(self, reason):
        """Devis retenu, motif à l'appui : l'engagement en prend le fournisseur et le montant."""
        self.ensure_one()
        if not (reason or "").strip():
            raise UserError("Motivez le choix du devis retenu (prix, délai, qualité, références…).")
        commitment = self.commitment_id
        commitment._eguitra_check_quotes_editable()
        commitment.eguitra_quote_ids.filtered("selected").write(
            {"selected": False, "selection_reason": False, "selected_by": False, "selected_at": False})
        self.write({"selected": True, "selection_reason": reason.strip(), "selected_by": self.env.user.id,
                    "selected_at": fields.Datetime.now()})
        commitment.write({"partner_id": self.partner_id.id, "amount": self.amount})
        return True


class EguitraCommitment(models.Model):
    _inherit = "eguitra.commitment"

    eguitra_quote_ids = fields.One2many("eguitra.commerce.supplier.quote", "commitment_id", "Devis fournisseurs")
    eguitra_purchase_order_ids = fields.One2many("purchase.order", "eguitra_commitment_id", "Bons de commande")

    def _eguitra_check_quotes_editable(self):
        for commitment in self:
            if commitment.state not in ("draft", "rejected"):
                raise UserError(f"L'engagement {commitment.name} est soumis ou approuvé : ses devis ne changent plus.")

    def _eguitra_quotes_required(self):
        """Nombre de devis exigés (trois au-delà du seuil de la société), 0 sinon."""
        self.ensure_one()
        threshold = self.company_id.eguitra_three_quotes_threshold
        return 3 if threshold and self.company_id.currency_id.compare_amounts(self.amount, threshold) > 0 else 0

    def _eguitra_check_quotes(self):
        for commitment in self:
            quotes = commitment.eguitra_quote_ids
            selected = quotes.filtered("selected")
            required = commitment._eguitra_quotes_required()
            suppliers = len(quotes.partner_id.commercial_partner_id)
            if required and suppliers < required:
                raise UserError(
                    f"Un engagement de plus de {number(commitment.company_id.eguitra_three_quotes_threshold)} "
                    f"{commitment.currency_id.name} HT se soumet avec {required} devis de fournisseurs différents au "
                    f"moins ({suppliers} joint{'s' if suppliers > 1 else ''}).")
            if (required or quotes) and not selected:
                raise UserError("Choisissez le devis retenu, motif à l'appui, avant de soumettre l'engagement.")
            if selected and (selected.partner_id.commercial_partner_id != commitment.partner_id.commercial_partner_id
                             or commitment.currency_id.compare_amounts(selected.amount, commitment.amount) != 0):
                raise UserError("L'engagement reprend le fournisseur et le montant du devis retenu : choisissez-le de "
                                "nouveau après une modification.")

    def action_submit(self):
        self._eguitra_check_quotes()
        return super().action_submit()
