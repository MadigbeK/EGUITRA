"""Facture des rotations au modèle « Facture transport carburant » : lignes reliées à leur rotation, tableau du
transport (N° de BL, N° de bon, camion, départ, destination, litres, péréquation au litre, total HT), lignes
simples sous le tableau ; N° de bon de la rotation dans l'API et refus par profil."""

import html
import re

from odoo import Command
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.profils import RefusParProfil

from ..controllers.transport import WRITE
from .common import TransportCase


@tagged("post_install", "-at_install")
class TestFactureTransport(RefusParProfil, TransportCase):
    def _text(self, invoice):
        content, _type = self.env["ir.actions.report"]._render_qweb_html("account.account_invoices", invoice.ids)
        text = re.sub(r"<[^>]+>", " ", content.decode() if isinstance(content, bytes) else str(content))
        return re.sub(r"[ \t\r\n]+", " ", html.unescape(text))

    def test_tableau_du_transport(self):
        rot = self._rotation(volume_delivered=39.875, delivery_note="BL-DEMO-41", loading_voucher="BE-DEMO-7")
        rot.action_validate()
        invoice = rot.action_invoice()
        line = invoice.invoice_line_ids.filtered("eguitra_rotation_id")
        self.assertEqual(line.eguitra_rotation_id, rot, "Ligne reliée à sa rotation")
        self.assertEqual(line.price_subtotal, 39.875 * 1_200_000)
        # Ligne simple ajoutée par la finance : sous le tableau, désignation et montant.
        invoice.write({"invoice_line_ids": [Command.create({
            "name": "Frais de dossier", "quantity": 1, "price_unit": 150_000, "account_id": self.acc_services.id,
            "tax_ids": [Command.clear()]})]})
        page = self._text(invoice)
        for expected in (
            "N° de BL", "N° de bon", "N° camion", "Départ", "Destination", "Volume (litres)",
            "Péréquation selon distance (GNF/L)", "Montant HT (GNF)",
            # Ligne de la rotation : 39,875 m³ = 39 875 litres (sans arrondi), 1 200 000 GNF le m³ = 1 200 le litre.
            "1 BL-DEMO-41 BE-DEMO-7 RC-1234-A Conakry Siguiri 39 875 1 200 47 850 000",
            "Autres éléments facturés", "Frais de dossier 150 000",
            "Arrêtée la présente facture à la somme de :",
        ):
            self.assertIn(expected, page)
        self.assertNotIn("Transport gasoil", page, "Le libellé de la ligne de rotation cède la place au tableau")
        self.assertLess(page.index("BL-DEMO-41"), page.index("Frais de dossier"), "Lignes simples sous le tableau")

    def test_numero_de_bon_de_la_rotation(self):
        agent = self.open_session("ibrahima")["access_token"]
        status, rot = self.call("POST", "/transport/rotations", {
            "vehicle_id": self.truck.id, "partner_id": self.customer.id, "route_id": self.route.id,
            "product": "gasoil", "volume_loaded": 40, "date_loading": self.today.isoformat(),
            "loading_voucher": "BE-DEMO-1",
        }, token=agent)
        self.assertEqual((status, rot.get("loading_voucher")), (200, "BE-DEMO-1"), rot)
        status, body = self.call("PATCH", f"/transport/rotations/{rot['id']}", {"loading_voucher": "BE-DEMO-2"},
                                 token=agent)
        self.assertEqual((status, body.get("loading_voucher")), (200, "BE-DEMO-2"), body)
        self.assertRefuseHors(WRITE, "PATCH", f"/transport/rotations/{rot['id']}", {"loading_voucher": "Refusé"})
        self.env.invalidate_all()
        self.assertEqual(self.env["eguitra.transport.rotation"].browse(rot["id"]).loading_voucher, "BE-DEMO-2")
