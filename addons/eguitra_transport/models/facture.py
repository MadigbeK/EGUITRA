"""Factures des rotations au modèle « Facture transport carburant » d'EGUITRA GROUP.

Chaque ligne de rotation d'une facture est reliée à sa rotation (eguitra_rotation_id) ; la facture
imprimée (eguitra_base, gabarit des sociétés) en fait le tableau du transport : N°, N° de BL, N° de bon,
camion, départ, destination, volume en litres, péréquation au litre, total HT
(report/facture_transport.xml). Les taxes refacturées et la déduction du manquant restent des lignes
simples sous ce tableau.
"""

from decimal import Decimal

from odoo import fields, models

from odoo.addons.eguitra_base.lettres import number, number_trim


class EguitraTransportRotation(models.Model):
    _inherit = "eguitra.transport.rotation"

    loading_voucher = fields.Char("N° de bon", copy=False,
                                  help="Bon de chargement ou d'enlèvement du dépôt : colonne « N° de bon » de la "
                                       "facture du client.")

    def _invoice_line_vals(self, account):
        return dict(super()._invoice_line_vals(account), eguitra_rotation_id=self.id)


class AccountMoveLine(models.Model):
    _inherit = "account.move.line"

    eguitra_rotation_id = fields.Many2one("eguitra.transport.rotation", "Rotation", readonly=True, copy=False,
                                          index="btree_not_null", ondelete="set null")


class AccountMove(models.Model):
    _inherit = "account.move"

    def _eguitra_report_lines(self):
        return super()._eguitra_report_lines().filtered(lambda l: not l.eguitra_rotation_id)

    def _eguitra_report_values(self, with_payments=False):
        values = super()._eguitra_report_values(with_payments)
        lines = self.invoice_line_ids.filtered("eguitra_rotation_id").sorted(lambda l: (l.sequence, l.id))
        if not lines:
            return values
        digits = self.currency_id.decimal_places
        rows = []
        for index, line in enumerate(lines, start=1):
            rot = line.eguitra_rotation_id
            vehicle, route = rot.vehicle_id, rot.route_id
            parts = [p.strip() for p in (route.name or "").split(" - ", 1)] + ["", ""]
            # Volume facturé (livré, à défaut chargé) en litres, sans arrondi ; tarif du m³ ramené au litre.
            liters = Decimal(str(rot.volume_delivered or rot.volume_loaded or 0)) * 1000
            rows.append({
                "number": index,
                "delivery_note": rot.delivery_note or "",
                "voucher": rot.loading_voucher or "",
                "truck": " / ".join(p for p in (vehicle.tractor_plate, vehicle.trailer_plate) if p) or vehicle.name,
                "origin": route.origin or parts[0],
                "destination": route.destination or parts[1],
                "liters": number_trim(liters),
                "rate": number_trim(Decimal(str(rot.rate or 0)) / 1000),
                "amount": number(line.price_subtotal, digits),
            })
        values.update(
            transport_rows=rows,
            transport_rate_label=f"Péréquation selon distance ({self.currency_id.name}/L)",
            # Taxes refacturées et déduction du manquant : désignation et montant, sous le tableau du transport.
            simple_rows=True,
        )
        return values
