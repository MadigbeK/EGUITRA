"""Clôture mensuelle : rotations livrées et non facturées à la fin du mois, en factures à établir.

Une rotation livrée (à défaut de date de livraison, chargée) au plus tard le dernier jour du mois
relève du chiffre d'affaires du mois. Si elle est encore à facturer (validée), ou si sa facture
est datée du mois suivant, son montant hors taxes passe en factures à établir (4181 au débit,
7061 au crédit, avec l'analytique de la rotation), extournées le premier jour du mois suivant.
Les rotations reprises comme « facturées dans l'ancien système » n'ont pas de facture : elles
n'entrent jamais dans le calcul.
"""

from odoo import api, models


class EguitraPeriodClose(models.Model):
    _inherit = "eguitra.period.close"

    @api.model
    def _transport_unbilled(self, company, end):
        Rotation = self.env["eguitra.transport.rotation"].sudo()
        return Rotation.search([
            ("company_id", "=", company.id), ("revenue", "!=", 0),
            "|", ("date_delivery", "<=", end), "&", ("date_delivery", "=", False), ("date_loading", "<=", end),
            "|", ("state", "=", "done"),
            "&", "&", ("state", "=", "invoiced"), ("invoice_id", "!=", False),
            "|", ("invoice_id.state", "!=", "posted"), ("invoice_id.invoice_date", ">", end),
        ], order="date_loading, id")

    @api.model
    def _close_accrual_targets(self, company, end):
        targets = super()._close_accrual_targets(company, end)
        rotations = self._transport_unbilled(company, end)
        if not rotations:
            return targets
        Account = self.env["account.account"].sudo()
        income = Account.search([("code", "=like", "7061%"), ("company_ids", "in", company.ids)], limit=1) or \
            Account.search([("code", "=like", "706%"), ("company_ids", "in", company.ids)], limit=1)
        for rot in rotations:
            vals = rot._invoice_line_vals(income)
            targets[f"rotation:{rot.id}"] = {
                "amount": company.currency_id.round(rot.revenue),
                "partner_id": rot.partner_id.id,
                "account_id": income.id,
                "analytic_distribution": vals.get("analytic_distribution"),
                "label": f"FAE {rot.name} {rot.partner_id.name}, {rot.route_id.name}",
            }
        return targets
