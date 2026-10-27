"""Offre de travaux et chantier : avance de démarrage facturée, puis déduite au prorata des situations.

L'offre acceptée fixe le montant du marché (hors taxes de l'offre) et le taux de l'avance de démarrage.
L'avance se facture une fois (« Avance de démarrage 30 % du marché »), sur le compte 4191 « Clients,
avances et acomptes reçus », TVA comprise. Chaque situation facturée ensuite en déduit une part au
prorata de ses travaux (avance × travaux de la période / marché), sur une ligne négative du même compte
et de la même TVA, jusqu'à épuisement : la situation qui porte le cumul au montant du marché déduit le
reste. Le net à payer de la situation baisse d'autant ; la retenue de garantie reste calculée sur les
travaux de la période, comme avant (eguitra_chantier, inchangé hors deux points d'extension).

Une situation annulée par un avoir annule aussi sa déduction (l'avoir extourne toute la facture) : son
cumul redevient facturable, et la déduction se refait à la facturation suivante.
"""

from odoo import Command, api, fields, models
from odoo.exceptions import UserError
from odoo.tools import float_round

from odoo.addons.eguitra_finance.formats import number


class EguitraChantier(models.Model):
    _inherit = "eguitra.chantier"

    eguitra_sale_order_id = fields.Many2one("sale.order", "Offre acceptée", readonly=True, copy=False,
                                            index="btree_not_null")
    eguitra_advance_rate = fields.Float("Avance de démarrage (%)", copy=False)
    eguitra_advance_amount = fields.Monetary("Avance de démarrage (HT)", compute="_compute_eguitra_advance",
                                             store=True)
    eguitra_advance_invoice_id = fields.Many2one("account.move", "Facture de l'avance", readonly=True, copy=False)
    eguitra_advance_deducted = fields.Monetary("Avance déduite (HT)", compute="_compute_eguitra_deducted")
    eguitra_advance_remaining = fields.Monetary("Avance à déduire (HT)", compute="_compute_eguitra_deducted")

    @api.depends("eguitra_advance_rate", "contract_amount", "eguitra_advance_invoice_id",
                 "eguitra_advance_invoice_id.state")
    def _compute_eguitra_advance(self):
        for chantier in self:
            invoice = chantier.eguitra_advance_invoice_id.sudo()
            if invoice and invoice.state != "cancel":
                # Facturée : le montant est celui de la facture, qu'un avenant ne change plus.
                chantier.eguitra_advance_amount = sum(
                    invoice.invoice_line_ids.filtered(lambda l: l.eguitra_advance_kind == "advance").mapped("price_subtotal"))
            else:
                chantier.eguitra_advance_amount = float_round(
                    (chantier.contract_amount or 0.0) * (chantier.eguitra_advance_rate or 0.0) / 100, precision_digits=0)

    @api.depends("situation_ids.state", "situation_ids.invoice_id", "eguitra_advance_amount",
                 "eguitra_advance_invoice_id.state")
    def _compute_eguitra_deducted(self):
        for chantier in self:
            done = chantier.situation_ids.filtered(lambda s: s.state == "invoiced")
            deducted = sum(done.mapped(lambda s: s._eguitra_advance_deduction_of_invoice()))
            chantier.eguitra_advance_deducted = deducted
            billed = chantier.eguitra_advance_invoice_id.sudo().state == "posted"
            chantier.eguitra_advance_remaining = max(chantier.eguitra_advance_amount - deducted, 0.0) if billed else 0.0

    def action_eguitra_invoice_advance(self, post=True):
        """Facture de l'avance de démarrage (une fois par chantier), au taux de l'offre acceptée."""
        Move = self.env["account.move"]
        invoices = Move
        for chantier in self:
            if chantier.eguitra_advance_invoice_id and chantier.eguitra_advance_invoice_id.state != "cancel":
                raise UserError(f"L'avance de démarrage du chantier {chantier.name} est déjà facturée "
                                f"({chantier.eguitra_advance_invoice_id.name or 'brouillon'}).")
            if chantier.situation_ids.filtered(lambda s: s.state == "invoiced"):
                raise UserError("L'avance de démarrage se facture avant la première situation.")
            if not chantier.eguitra_advance_rate or not chantier.contract_amount:
                raise UserError("Indiquez le taux de l'avance de démarrage et le montant du marché.")
            company = chantier.company_id
            account = company._eguitra_advance_account()
            amount = float_round(chantier.contract_amount * chantier.eguitra_advance_rate / 100, precision_digits=0)
            rate = number(chantier.eguitra_advance_rate, 2).rstrip("0").rstrip(",")
            line = {"name": f"Avance de démarrage {rate} % du marché - {chantier.name}", "quantity": 1,
                    "price_unit": amount, "account_id": account.id, "eguitra_advance_kind": "advance"}
            if company.account_sale_tax_id:
                line["tax_ids"] = [Command.set(company.account_sale_tax_id.ids)]
            order = chantier.eguitra_sale_order_id
            invoice = Move.sudo().with_company(company).create({
                "move_type": "out_invoice", "partner_id": chantier.partner_id.id, "company_id": company.id,
                "invoice_date": fields.Date.context_today(self), "ref": order.name if order else False,
                "invoice_origin": order.name if order else chantier.name,
                "eguitra_object": (order.eguitra_object if order else False) or f"Avance de démarrage - {chantier.name}",
                "invoice_line_ids": [Command.create(line)],
            })
            if post:
                invoice.action_post()
            chantier.sudo().eguitra_advance_invoice_id = invoice
            invoices |= invoice
        return invoices


class EguitraChantierSituation(models.Model):
    _inherit = "eguitra.chantier.situation"

    def _eguitra_advance_deduction_of_invoice(self):
        """Déduction de l'avance portée par la facture de la situation (positive)."""
        self.ensure_one()
        lines = self.invoice_id.sudo().invoice_line_ids.filtered(lambda l: l.eguitra_advance_kind == "deduction")
        return -sum(lines.mapped("price_subtotal"))

    def _invoiced_period(self):
        # Travaux de la période : le hors taxes de la facture, déduction de l'avance remise.
        return super()._invoiced_period() + self._eguitra_advance_deduction_of_invoice()

    def _eguitra_advance_deduction(self, period):
        """Part de l'avance à déduire des travaux de la période : au prorata, la dernière situation du marché
        déduisant le reste, jamais plus que le reste."""
        self.ensure_one()
        chantier = self.chantier_id
        chantier.invalidate_recordset(["eguitra_advance_deducted", "eguitra_advance_remaining"])
        remaining = chantier.eguitra_advance_remaining
        if remaining <= 0.5 or not chantier.contract_amount:
            return 0.0
        if self.cumulative_amount >= chantier.contract_amount - 0.5:
            return remaining
        share = float_round(chantier.eguitra_advance_amount * period / chantier.contract_amount, precision_digits=0)
        return min(share, remaining)

    def _invoice_extra_lines(self, period, company):
        lines = super()._invoice_extra_lines(period, company)
        deduction = self._eguitra_advance_deduction(period)
        if deduction:
            line = {"name": f"Déduction de l'avance de démarrage - situation n° {self.number}", "quantity": 1,
                    "price_unit": -deduction, "account_id": company._eguitra_advance_account().id,
                    "eguitra_advance_kind": "deduction"}
            if company.account_sale_tax_id:
                line["tax_ids"] = [Command.set(company.account_sale_tax_id.ids)]
            lines.append(line)
        return lines


class AccountMoveLine(models.Model):
    _inherit = "account.move.line"

    eguitra_advance_kind = fields.Selection(
        [("advance", "Avance de démarrage"), ("deduction", "Déduction de l'avance")], "Avance du chantier",
        copy=False, readonly=True)
