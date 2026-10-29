"""Documents d'une opération : prêts ou incomplets (ce qui manque), numérotation par société, impression d'un clic en un
seul PDF, budget de voyage imprimé (évolution des budgets, détail en nature et en espèces, total en lettres)."""

from odoo.tests import tagged

from .documents_common import DocumentsCase


@tagged("post_install", "-at_install")
class TestDocumentsOperation(DocumentsCase):
    def _approve(self, budget):
        budget.action_submit()
        if budget.state == "submitted":
            budget._eguitra_last_request().with_user(self.env["res.users"].search([("login", "=", "fatou")])
                                                     ).action_approve()

    def test_documents_prets_ou_incomplets(self):
        rot = self._operation(date_planned_arrival=False)
        docs = {d["code"]: d for d in rot._transport_documents()}
        self.assertEqual(list(docs), ["order", "mission", "budget", "waybill"])
        self.assertFalse(docs["order"]["ready"])
        self.assertIn("ordre de transport", docs["order"]["missing"][0])
        self.assertTrue(docs["mission"]["ready"], docs["mission"])
        self.assertFalse(docs["budget"]["ready"])
        self.assertIn("budget initial", docs["budget"]["missing"][0])
        self.assertFalse(docs["waybill"]["ready"])
        # Les informations complétées, les documents apparaissent d'eux-mêmes.
        self.customer.street = "Kaloum, Conakry"
        order = self._order()
        rot.write({"order_id": order.id, "date_planned_arrival": self.today})
        rot._new_budget()
        docs = {d["code"]: d for d in rot._transport_documents()}
        self.assertTrue(all(d["ready"] for d in docs.values()), docs)
        self.assertTrue(docs["budget"]["warnings"], "Budget non approuvé : signalé, le PDF le dit")
        self.assertTrue(docs["order"]["warnings"], "Ordre en brouillon : à faire signer puis valider")
        status, body = self._api("mariam", "GET", f"/transport/rotations/{rot.id}/documents")
        self.assertEqual((status, [d["ready"] for d in body["documents"]]), (200, [True] * 4), body)

    def test_un_pdf_pour_tous_les_documents(self):
        self.customer.street = "Kaloum, Conakry"
        order = self._order()
        rot = self._operation(order, volume_loaded=40)
        budget = rot._new_budget()
        self._approve(budget)
        additive = rot._new_budget("additive", "Éclatement de pneu")
        additive.write({"line_ids": [(0, 0, {"rubric_id": self.env["eguitra.transport.budget.rubric"]._by_prefill(
            self.company, "other").id, "kind": "cash", "unit": "fixed", "quantity": 1, "price_unit": 200_000,
            "reference": "Pneu avant gauche"})]})
        status, _body = self._api("ibrahima", "GET", f"/transport/rotations/{rot.id}/documents.pdf")
        self.assertEqual(status, 200)
        self.assertTrue(rot._mission() and rot._waybill(), "Imprimés : ordre de mission et lettre numérotés")
        page = self._html("eguitra_transport.action_report_operation_documents", rot)
        for title in ("ORDRE DE TRANSPORT", "ORDRE DE MISSION", "BUDGET DE VOYAGE", "LETTRE DE VOITURE"):
            self.assertIn(title, page)
        self.assertEqual(page.count("BUDGET DE VOYAGE"), 2, "Une page par budget : initial et additif")
        budget_page = self._html("eguitra_transport.action_report_operation_budget", rot)
        for expected in ("Évolution des budgets de l'opération", budget.name, additive.name, "Initial",
                         "Additif 1 : Éclatement de pneu", "En nature", "En espèces", "Total en nature",
                         "Pneu avant gauche", "9 732 000", "Total budgétisé", "9 932 000",
                         "Arrêté le présent budget à la somme de :",
                         "Neuf millions sept cent trente-deux mille francs guinéens",
                         "Responsable des opérations", "BROUILLON : budget non approuvé"):
            self.assertIn(expected, budget_page)
        # Document incomplet : refusé avec ce qui manque.
        bare = self._operation(date_planned_departure=False)
        status, body = self._api("ibrahima", "GET", f"/transport/rotations/{bare.id}/documents/mission.pdf")
        self.assertEqual(status, 422, body)
        self.assertIn("ETD", " ".join(body["missing"]))
        status, body = self._api("ibrahima", "GET", f"/transport/rotations/{bare.id}/documents/inconnu.pdf")
        self.assertEqual(status, 404, body)

    def test_operation_complete(self):
        self.customer.street = "Kaloum, Conakry"
        rot = self._operation(self._order(), volume_loaded=40)
        status, body = self._api("ibrahima", "GET", f"/transport/rotations/{rot.id}/operation")
        self.assertEqual(status, 200, body)
        for key in ("rotation", "order", "documents", "mission", "budgets", "trip", "waybill", "can"):
            self.assertIn(key, body)
        self.assertEqual(body["rotation"]["trailer"]["plate"], "RC-2002-C")
        self.assertEqual(body["rotation"]["co_driver"]["id"], self.co_driver.id)
        self.assertTrue(body["can"]["ops"])
        self.assertFalse(body["can"]["cash"])

    def test_reglages_des_documents(self):
        status, body = self._api("mariam", "GET", "/transport/documents/settings")
        self.assertEqual((status, body["free_days"], body["prefixes"]["waybill"]), (200, 2, "LV"), body)
        self.assertEqual(len(body["instructions"]), 6)
        self.assertIsNone(body["advance_account"], "La direction ne lit pas les comptes")
        self._create_user("admin.docs", "admin")
        status, body = self._api("admin.docs", "PATCH", "/transport/documents/settings", {
            "free_days": 3, "prefixes": {"waybill": "LVT"}, "instructions": ["Consigne démo"],
            "authorities_note": "Mention démo."})
        self.assertEqual(status, 200, body)
        self.assertEqual((body["free_days"], body["prefixes"]["waybill"], len(body["instructions"])), (3, "LVT", 1))
        status, body = self._api("admin.docs", "PATCH", "/transport/documents/settings", {"prefixes": {"order": "o t"}})
        self.assertEqual(status, 400, body)
        rubrics = self._api("fatou", "GET", "/transport/documents/settings")[1]["rubrics"]
        rubrics[0]["name"] = "Carburant (démo)"
        status, body = self._api("fatou", "PUT", "/transport/budget-rubrics", {"rubrics": rubrics[:-1]})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["rubrics"][0]["name"], "Carburant (démo)")
        self.assertFalse(body["rubrics"][-1]["active"], "Rubrique retirée : archivée")
        status, body = self._api("fatou", "PATCH", "/transport/documents/accounts", {"complement_tolerance": 50_000})
        self.assertEqual((status, body["complement_tolerance"]), (200, 50_000), body)
