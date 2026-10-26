from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestReglementEnAttente(FinanceDataMixin, ApiCase):
    """Règlement fournisseur retenu par le circuit (audit de l'application web, I-C3) : la fiche de la pièce
    l'annonce, « Régler » disparaît et un second règlement est refusé tant que la demande est ouverte, sans
    quoi deux demandes approuvées paieraient deux fois le fournisseur."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("tresorier.ra", "finance")
        cls.dg = cls._create_user("dg.ra", "direction")
        Rule = cls.env["eguitra.approval.rule"]
        if not Rule.search_count([("company_id", "=", cls.company.id), ("document", "=", "payment_out")]):
            Rule.create({"name": "Règlements", "document": "payment_out", "min_amount": 100_000_000,
                         "approver_profile": "direction", "company_id": cls.company.id})

    def setUp(self):
        super().setUp()
        self.token = self.open_session("tresorier.ra")["access_token"]

    def _regler(self, bill):
        return self.call("POST", f"/finance/moves/{bill.id}/payments", {"journal_id": self.bank.id}, token=self.token)

    def _demande(self, payment_id):
        return self.env["eguitra.approval.request"].search(
            [("res_model", "=", "account.payment"), ("res_id", "=", payment_id), ("state", "=", "pending")])

    def test_reglement_soumis_annonce_et_second_refuse(self):
        bill = self.make_invoice("in_invoice", 150_000_000)  # 177 000 000 TTC : au-delà du seuil des règlements
        status, body = self._regler(bill)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["payment_status"], "submitted", body)
        self.assertEqual(len(body["payments_awaiting_approval"]), 1, body)
        attente = body["payments_awaiting_approval"][0]
        self.assertEqual((attente["amount"], attente["pending_with"]), (177_000_000, "Direction générale"))
        self.assertFalse(body["can_pay"], "« Régler » masqué tant que la demande est ouverte")
        self.assertEqual(body["payment_state"], "not_paid")

        status, again = self._regler(bill)
        self.assertEqual((status, again.get("error")), (422, "business_rule"), again)
        self.assertIn("attend déjà une approbation", again["message"])
        self.assertEqual(self.env["account.payment"].search_count([("partner_id", "=", self.supplier.id)]), 1,
                         "Un seul règlement : pas de seconde demande")

        status, detail = self.call("GET", f"/finance/moves/{bill.id}", token=self.token)
        self.assertEqual((status, len(detail["payments_awaiting_approval"]), detail["can_pay"]), (200, 1, False), detail)

        self._demande(attente["id"]).with_user(self.dg).action_approve("Accord")
        self.env.flush_all()
        status, detail = self.call("GET", f"/finance/moves/{bill.id}", token=self.token)
        self.assertEqual((status, detail["payments_awaiting_approval"]), (200, []), detail)
        self.assertIn(detail["payment_state"], ("paid", "in_payment"), "Comptabilisé et lettré à l'approbation")
        self.assertFalse(detail["can_pay"])

    def test_demande_refusee_rouvre_le_reglement(self):
        bill = self.make_invoice("in_invoice", 150_000_000)
        status, body = self._regler(bill)
        self.assertEqual((status, body["payment_status"]), (200, "submitted"), body)
        self._demande(body["payments_awaiting_approval"][0]["id"]).with_user(self.dg).action_reject("RIB à vérifier")
        self.env.flush_all()
        status, detail = self.call("GET", f"/finance/moves/{bill.id}", token=self.token)
        self.assertEqual((status, detail["payments_awaiting_approval"]), (200, []), detail)
        self.assertTrue(detail["can_pay"], "Demande refusée : la pièce se règle de nouveau")

    def test_reglement_sous_le_seuil_comptabilise_aussitot(self):
        bill = self.make_invoice("in_invoice", 10_000_000)
        status, body = self._regler(bill)
        self.assertEqual(status, 200, body)
        self.assertEqual((body["payment_status"], body["payments_awaiting_approval"]), ("posted", []), body)
        self.assertIn(body["payment_state"], ("paid", "in_payment"))
