"""Réceptions (service fait) des bons de commande : quantités reçues ou prestation constatée, par qui, quand,
avec le bon de livraison du fournisseur en pièce jointe. Numérotées par société (REC/EG/2026/0001).

La quantité reçue de chaque ligne de commande est la somme de ses réceptions enregistrées : c'est elle que
la pièce d'achat du fournisseur ne doit pas dépasser (rapprochement, account_move.py). Une réception se
corrige en l'annulant (motif obligatoire), tant que ses quantités ne sont pas déjà facturées.
"""

from odoo import api, fields, models
from odoo.exceptions import UserError

EPSILON = 1e-6


class EguitraCommerceReceipt(models.Model):
    _name = "eguitra.commerce.receipt"
    _description = "Réception (service fait)"
    _order = "date desc, id desc"

    name = fields.Char("Référence", default="/", readonly=True, copy=False, index=True)
    purchase_order_id = fields.Many2one("purchase.order", "Bon de commande", required=True, ondelete="restrict",
                                        index=True)
    company_id = fields.Many2one(related="purchase_order_id.company_id", store=True, index=True)
    partner_id = fields.Many2one(related="purchase_order_id.partner_id", store=True, string="Fournisseur")
    date = fields.Date("Date de réception", required=True, default=fields.Date.context_today)
    received_by = fields.Many2one("res.users", "Constatée par", required=True, default=lambda self: self.env.user)
    note = fields.Text("Observations")
    attachment_id = fields.Many2one("ir.attachment", "Bon de livraison", copy=False)
    state = fields.Selection([("done", "Enregistrée"), ("cancelled", "Annulée")], default="done", required=True,
                             index=True)
    cancel_reason = fields.Text("Motif de l'annulation", readonly=True)
    cancelled_by = fields.Many2one("res.users", "Annulée par", readonly=True)
    cancelled_at = fields.Datetime("Annulée le", readonly=True)
    line_ids = fields.One2many("eguitra.commerce.receipt.line", "receipt_id", "Lignes")

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("name", "/") == "/":
                order = self.env["purchase.order"].browse(vals["purchase_order_id"])
                sequence = order.company_id._eguitra_commerce_sequence("eguitra.commerce.receipt")
                vals["name"] = sequence.with_company(order.company_id).next_by_id()
        return super().create(vals_list)

    def unlink(self):
        if self.filtered(lambda r: r.state == "done"):
            raise UserError("Une réception enregistrée ne se supprime pas : annulez-la, motif à l'appui.")
        return super().unlink()

    def action_cancel(self, reason):
        if not (reason or "").strip():
            raise UserError("Indiquez le motif de l'annulation de la réception.")
        for receipt in self:
            if receipt.state != "done":
                raise UserError(f"La réception {receipt.name} est déjà annulée.")
            for line in receipt.line_ids:
                pol = line.purchase_line_id
                if pol.qty_received - line.quantity < pol.qty_invoiced - EPSILON:
                    raise UserError(f"« {pol.name} » : la quantité reçue deviendrait inférieure à la quantité déjà "
                                    "facturée par le fournisseur. Corrigez d'abord la pièce d'achat.")
        self.write({"state": "cancelled", "cancel_reason": reason.strip(), "cancelled_by": self.env.user.id,
                    "cancelled_at": fields.Datetime.now()})
        self.line_ids.purchase_line_id._eguitra_sync_received()
        return True


class EguitraCommerceReceiptLine(models.Model):
    _name = "eguitra.commerce.receipt.line"
    _description = "Ligne de réception"
    _order = "receipt_id, id"

    receipt_id = fields.Many2one("eguitra.commerce.receipt", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="receipt_id.company_id", store=True)
    purchase_line_id = fields.Many2one("purchase.order.line", "Ligne de commande", required=True, ondelete="restrict",
                                       index=True)
    product_uom_id = fields.Many2one(related="purchase_line_id.product_uom_id", string="Unité")
    quantity = fields.Float("Quantité reçue", required=True, digits="Product Unit")

    @api.constrains("purchase_line_id", "receipt_id")
    def _check_order(self):
        for line in self:
            if line.purchase_line_id.order_id != line.receipt_id.purchase_order_id:
                raise UserError("Une réception ne porte que des lignes de son bon de commande.")
