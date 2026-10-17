"""Indicateurs du transport dans la validation de la reprise (eguitra_finance, reprise_reference.py) :
rotations validées ou facturées de la période, chiffre d'affaires et coûts directs, rotations non
facturées, volume livré en litres, kilomètres parcourus."""

from odoo import api, models


class EguitraRepriseReference(models.Model):
    _inherit = "eguitra.reprise.reference"

    @api.model
    def _measures(self, company, date_from, date_to):
        result = super()._measures(company, date_from, date_to)
        rotations = self.env["eguitra.transport.rotation"].sudo().search([
            ("company_id", "=", company.id), ("state", "in", ("done", "invoiced")),
            ("date_loading", ">=", date_from), ("date_loading", "<=", date_to),
        ])
        result.update({
            "transport_revenue": sum(rotations.mapped("revenue")),
            "transport_direct_costs": sum(rotations.mapped("total_cost")),
            "rotations": len(rotations),
            "rotations_unbilled": len(rotations.filtered(lambda r: r.state != "invoiced")),
            "volume_liters": sum(rotations.mapped("volume_delivered")) * 1000,
            "kilometers": sum(rotations.mapped("distance_km")),
        })
        return result
