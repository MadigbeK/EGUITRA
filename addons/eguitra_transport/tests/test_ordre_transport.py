"""Ordre de transport : numérotation par société et par année, ce qui manque, états (brouillon, validé, exécuté,
clôturé, annulé) qui suivent les opérations, opération créée depuis l'ordre, PDF « ORDRE DE TRANSPORT »."""

from odoo import fields
from odoo.exceptions import UserError, ValidationError
from odoo.tests import tagged

from .documents_common import DocumentsCase

APPROVED = {"eguitra_approval_granted": True}


@tagged("post_install", "-at_install")
class TestOrdreTransport(DocumentsCase):
    def test_numero_par_societe_et_par_annee(self):
        first, second = self._order(), self._order()
        year = fields.Date.context_today(first).year
        self.assertRegex(first.name, rf"^OT/{year}/\d{{4}}$")
        self.assertEqual(int(second.name[-4:]), int(first.name[-4:]) + 1, "Compteur suivi dans la société")
        self.company._transport_set_prefix("order", "AF")
        self.assertTrue(self._order().name.startswith(f"AF/{year}/"), "Préfixe réglable")
        self.assertEqual(self.company._transport_prefixes()["order"], "AF")
        with self.assertRaises(UserError):
            self.company._transport_set_prefix("order", "ot 2026!")

    def test_ce_qui_manque_et_validation(self):
        order = self.env["eguitra.transport.order"].create({"partner_id": self.customer.id, "packaging": False})
        missing = " ".join(order._missing())
        for expected in ("marchandise", "quantité", "conditionnement", "origine", "destination"):
            self.assertIn(expected, missing)
        with self.assertRaises(UserError):
            order.action_validate()
        order.write({"product_id": self.gasoil.id, "quantity": 40000, "packaging": "Vrac liquide",
                     "route_id": self.route.id, "origin": "Conakry", "destination": "Siguiri"})
        self.customer.street = "Kaloum, Conakry"
        self.assertEqual(order._missing(), [])
        order.action_validate()
        self.assertEqual(order.state, "validated")
        self.assertEqual(order.validated_by, self.env.user)
        with self.assertRaises(ValidationError):
            order.write({"weight_gross": 10, "weight_net": 20})

    def test_etats_suivent_les_operations(self):
        order = self._order(origin="Conakry", destination="Siguiri")
        self.customer.street = "Kaloum, Conakry"
        order.action_validate()
        first, second = self._operation(order), self._operation(order)
        self.assertNotEqual(first.name, "/", "Une opération de l'ordre est numérotée tout de suite")
        self.assertEqual((first.partner_id, first.route_id, first.product_id),
                         (self.customer, self.route, self.gasoil), "Client, route et produit de l'ordre")
        self.assertEqual(order.state, "validated")
        # Livrée : validée, ou réception enregistrée.
        first.write({"volume_loaded": 40, "volume_delivered": 39.9})
        first.sudo().action_validate()
        self.assertEqual(order.state, "validated", "Une opération reste à livrer")
        second.write({"volume_loaded": 40, "volume_delivered": 40, "date_delivery": self.today})
        self.assertEqual(order.state, "executed", "Toutes les opérations livrées")
        second.sudo().action_validate()
        invoice = (first | second).action_invoice()
        self.assertEqual(order.state, "closed", "Toutes les opérations facturées")
        with self.assertRaises(UserError):
            order.write({"quantity": 1})
        invoice.button_cancel()
        self.assertEqual(order.state, "executed", "Facture défaite : l'ordre revient à exécuté")
        third = self._operation(order)
        self.assertEqual(order.state, "validated", "Nouvelle opération à livrer")
        third.action_cancel()
        self.assertEqual(order.state, "executed")

    def test_annulation_et_retour_au_brouillon(self):
        order = self._order(origin="Conakry", destination="Siguiri")
        self.customer.street = "Kaloum, Conakry"
        order.action_validate()
        draft = self._operation(order)
        order.action_reset()
        self.assertEqual(order.state, "draft")
        order.action_validate()
        departed = self._operation(order, volume_loaded=40)
        departed.action_depart()
        with self.assertRaises(UserError):
            order.action_cancel("Client désisté")
        with self.assertRaises(UserError):
            order.action_reset()
        departed.action_reset()
        order.action_cancel("Client désisté")
        self.assertEqual((order.state, draft.state, departed.state), ("cancelled", "cancelled", "cancelled"))
        with self.assertRaises(UserError):
            self._operation(order)

    def test_client_de_l_operation_et_de_l_ordre(self):
        order = self._order()
        other = self.env["res.partner"].create({"name": "Autre client démo", "customer_rank": 1})
        with self.assertRaises(ValidationError):
            self._operation(order, partner_id=other.id)

    def test_rattachement_a_un_ordre_controle(self):
        """Revue de sécurité du 29/10 : rattacher ou détacher une opération après coup suit les règles de la
        création (ordre ouvert, même client, même société) et ne touche jamais une rotation validée ou facturée."""
        self.customer.street = "Kaloum, Conakry"
        order = self._order(origin="Conakry", destination="Siguiri")
        order.action_validate()
        free = self._operation(volume_loaded=40, volume_delivered=40)
        free.write({"order_id": order.id})
        self.assertEqual(free.order_id, order, "Rotation en saisie rattachée à un ordre ouvert")
        free.write({"order_id": False})
        self.assertFalse(free.order_id, "et détachée tant qu'elle n'est pas validée")
        # Ordre annulé ou clôturé : refusé.
        cancelled = self._order()
        cancelled.action_cancel("Essai")
        with self.assertRaises(UserError):
            free.write({"order_id": cancelled.id})
        # Ordre d'un autre client : refusé.
        other = self.env["res.partner"].create({"name": "Autre client démo", "customer_rank": 1, "street": "Matoto"})
        foreign = self._order(partner_id=other.id)
        with self.assertRaises(UserError):
            free.write({"order_id": foreign.id})
        # Rotation validée : ni rattachée ni détachée, au noyau comme par l'écran (sans remise en saisie).
        free.action_validate()
        with self.assertRaises(UserError):
            free.write({"order_id": order.id})
        status, body = self._api("ibrahima", "PATCH", f"/transport/rotations/{free.id}", {"order_id": order.id})
        self.assertEqual(status, 422, body)
        self.assertEqual((free.state, free.order_id.id), ("done", False), "Ni remise en saisie ni rattachement")
        linked = self._operation(order, volume_loaded=40, volume_delivered=40)
        linked.action_validate()
        status, body = self._api("ibrahima", "PATCH", f"/transport/rotations/{linked.id}", {"order_id": None})
        self.assertEqual(status, 422, body)
        self.assertEqual(linked.order_id, order)
        # Ordre d'une autre société : refusé.
        other_company = self.env["res.company"].create({"name": "Société démo sans le parc"})
        elsewhere = self.env["eguitra.transport.order"].sudo().with_company(other_company).create({
            "partner_id": self.customer.id, "company_id": other_company.id})
        draft = self._operation(volume_loaded=40)
        with self.assertRaises(UserError):
            draft.sudo().write({"order_id": elsewhere.id})

    def test_api_ordre_et_operation(self):
        status, body = self._api("ibrahima", "POST", "/transport/orders", {
            "partner_id": self.customer.id, "product_id": self.gasoil.id, "quantity": 80000, "quantity_uom": "l",
            "route_id": self.route.id, "client_ref": "CMD-DEMO-9", "with_loading": True,
            "billing_address": "Petit marché, Conakry"})
        self.assertEqual(status, 200, body)
        self.assertEqual((body["origin"], body["destination"]), ("Conakry", "Siguiri"), "Origine et destination de la route")
        order_id = body["id"]
        status, body = self._api("ibrahima", "POST", f"/transport/orders/{order_id}/validate")
        self.assertEqual((status, body.get("state")), (200, "validated"), body)
        status, op = self._api("ibrahima", "POST", f"/transport/orders/{order_id}/operations", {
            "vehicle_id": self.tanker.id, "co_driver_id": self.co_driver.id,
            "date_planned_departure": str(self.today), "date_planned_arrival": str(self.today)})
        self.assertEqual(status, 200, op)
        rot = self.env["eguitra.transport.rotation"].browse(op["rotation"]["id"])
        self.assertEqual(rot.volume_planned, 40, "Reste de l'ordre dans la limite de la capacité (40 m³)")
        self.assertEqual((rot.tractor_id, rot.trailer_id), (self.tanker.tractor_id, self.tanker.trailer_id))
        self.assertEqual(rot.date_loading, self.today)
        status, op2 = self._api("ibrahima", "POST", f"/transport/orders/{order_id}/operations",
                                {"vehicle_id": self.truck.id})
        self.assertEqual(status, 200, op2)
        self.assertEqual(self.env["eguitra.transport.rotation"].browse(op2["rotation"]["id"]).volume_planned, 40)
        status, detail = self._api("mariam", "GET", f"/transport/orders/{order_id}")
        self.assertEqual((status, len(detail["rotations"])), (200, 2), detail)
        self.assertTrue(detail["document"]["ready"], detail["document"])

    def test_pdf_ordre_de_transport(self):
        order = self._order(origin="Conakry", destination="Siguiri", consignee="Dépôt démo de Siguiri",
                            client_signatory="Le directeur démo", billing_address="Kaloum, Conakry",
                            goods_value=500_000_000, extra_insurance=True)
        self.company.transport_order_signatory_name = "Signataire démo"
        page = self._html("eguitra_transport.action_report_transport_order", order)
        for expected in ("ORDRE DE TRANSPORT", order.name, "BROUILLON", self.customer.name,
                         f"{self.customer.name} demande et autorise {self.company.name}",
                         "Vrac liquide", "40 000 litres", "Conakry", "Siguiri", "Dépôt démo de Siguiri",
                         "Kaloum, Conakry", "CMD-DEMO-1", "500 000 000 GNF", "Pour le client", "Le directeur démo",
                         f"Pour {self.company.name}", "La Direction générale", "Signataire démo"):
            self.assertIn(expected, page)
        self.assertNotIn("GuineaSoft", page)
        self.customer.street = "Kaloum, Conakry"
        order.action_validate()
        self.assertNotIn("BROUILLON", self._html("eguitra_transport.action_report_transport_order", order))
        status, _body = self._api("mariam", "GET", f"/transport/orders/{order.id}/pdf")
        self.assertEqual(status, 200)
        incomplete = self.env["eguitra.transport.order"].create({"partner_id": self.customer.id})
        status, body = self._api("mariam", "GET", f"/transport/orders/{incomplete.id}/pdf")
        self.assertEqual(status, 422, body)
        self.assertTrue(body["missing"])
