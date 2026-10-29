"""Lettre de voiture : ce qui manque, colis tirés de l'opération, réception qui fixe le volume livré et le manquant
(une seule saisie), rotation validée remise en saisie, immobilisation au-delà de la franchise et ligne de la facture,
PDF « LETTRE DE VOITURE »."""

from datetime import datetime, timedelta

from odoo.exceptions import UserError
from odoo.tests import tagged

from .documents_common import DocumentsCase


@tagged("post_install", "-at_install")
class TestLettreVoiture(DocumentsCase):
    def test_ce_qui_manque_et_colis(self):
        rot = self._operation(date_planned_arrival=False, volume_planned=0)
        missing = " ".join(rot._waybill_missing())
        self.assertIn("ETA", missing)
        self.assertIn("colis", missing)
        rot.write({"date_planned_arrival": self.today, "volume_loaded": 39.5})
        self.assertEqual(rot._waybill_missing(), [])
        package = rot._default_packages()[0]
        self.assertEqual((package["nature"], package["gross"], package["uom"]), (self.gasoil.name, 39500, "L"))

    def test_reception_fixe_le_volume_livre_et_le_manquant(self):
        rot = self._operation(volume_loaded=40)
        status, body = self._api("ousmane", "POST", f"/transport/rotations/{rot.id}/waybill/reception", {
            "receiver_name": "Réceptionnaire démo", "vehicle_arrival_at": f"{self.today}T08:00",
            "unloading_at": f"{self.today}T10:00", "received_qty": 39700, "damaged_qty": 100,
            "damage_cause": "Joint de vanne démo", "receiver_visa": True})
        self.assertEqual(status, 200, body)
        self.assertEqual((rot.volume_delivered, rot.date_delivery), (39.7, self.today), "Une seule saisie")
        self.assertAlmostEqual(rot.shortage, 0.3, places=3)
        waybill = rot._waybill()
        self.assertEqual(waybill.shortage_qty, 200, "Manquant : chargé - reçu conforme - avarie")
        self.assertTrue(waybill.name.startswith("LV/"))
        # Rotation validée dont la réception change : remise en saisie (validation par un autre compte).
        rot.action_validate()
        rot._record_reception({"received_qty": 39800})
        self.assertEqual((rot.state, rot.volume_delivered), ("draft", 39.8))
        rot.action_validate()
        rot.action_invoice()
        with self.assertRaises(UserError):
            rot._record_reception({"received_qty": 39000})

    def test_immobilisation_au_dela_de_la_franchise(self):
        self.customer.write({"transport_demurrage_billable": True, "transport_demurrage_rate": 500_000})
        rot = self._operation(volume_loaded=40)
        arrival = datetime.combine(self.today, datetime.min.time()) + timedelta(hours=8)
        rot._record_reception({"vehicle_arrival_at": arrival, "vehicle_departure_at": arrival + timedelta(days=4, hours=2),
                               "received_qty": 40000})
        waybill = rot._waybill()
        # 4 jours et 2 heures : 5 jours commencés, dont 3 au-delà de la franchise de 2 jours.
        self.assertEqual((waybill.immobilized_days, waybill.free_days, waybill.billable_days), (5, 2, 3))
        self.assertEqual(waybill.demurrage_amount, 1_500_000)
        rot.action_validate()
        invoice = rot.action_invoice()
        line = invoice.invoice_line_ids.filtered(lambda l: "Immobilisation" in (l.name or ""))
        self.assertEqual((len(line), line.price_unit), (1, 1_500_000))
        self.assertIn("3 jours au-delà de la franchise de 2 jours", line.name)
        self.assertIn("Immobilisation du camion", self._html_invoice(invoice))

    def test_franchise_du_client_et_immobilisation_non_facturee(self):
        self.customer.write({"transport_demurrage_free_days": 4, "transport_demurrage_rate": 500_000})
        rot = self._operation(volume_loaded=40)
        arrival = datetime.combine(self.today, datetime.min.time())
        rot._record_reception({"vehicle_arrival_at": arrival, "vehicle_departure_at": arrival + timedelta(days=5),
                               "received_qty": 40000})
        waybill = rot._waybill()
        self.assertEqual((waybill.free_days, waybill.billable_days), (4, 1))
        self.assertEqual(waybill.demurrage_amount, 0, "Client sans immobilisation facturée : constat seulement")
        rot.action_validate()
        self.assertFalse(rot.action_invoice().invoice_line_ids.filtered(lambda l: "Immobilisation" in (l.name or "")))

    def test_pdf_lettre_de_voiture(self):
        order = self._order(consignee="Destinataire démo")
        rot = self._operation(order, volume_loaded=40, delivery_note="BL-DEMO-5")
        status, body = self._api("ibrahima", "PUT", f"/transport/rotations/{rot.id}/waybill", {
            "bill_of_lading": "CN-DEMO-1", "forwarder": "Transitaire démo", "delivery_agent": "Agent démo",
            "loader_clerk": "Commis démo", "packages": [{"nature": "Gasoil", "description": "Produit démo",
                                                         "weight_gross": 40000, "weight_net": 39800,
                                                         "packaging": "Vrac liquide", "count": 1}]})
        self.assertEqual(status, 200, body)
        self.company.transport_waybill_note = "Mention démo de la lettre."
        page = self._html("eguitra_transport.action_report_operation_waybill", rot)
        for expected in ("LETTRE DE VOITURE", rot._waybill().name, rot.name, "RC-2002-A", "RC-2002-C", self.driver.name,
                         self.co_driver.name, order.name, "BL-DEMO-5", "CN-DEMO-1", "CMD-DEMO-1", "Produit démo",
                         "40 000", "39 800", "Destinataire démo", "Siguiri", "Transitaire démo", "Agent démo",
                         "Commis démo", "RÉCEPTION", "Visa du réceptionnaire",
                         "Franchise d'immobilisation des camions : 2 jours.", "Mention démo de la lettre.",
                         "CONSIGNES AU CHAUFFEUR", "Port de la ceinture de sécurité obligatoire."):
            self.assertIn(expected, page)
        self.assertNotIn("GuineaSoft", page)

    def _html_invoice(self, invoice):
        return self._html("account.account_invoices", invoice)
