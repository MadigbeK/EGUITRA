from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestPartnerSheet(FinanceDataMixin, ApiCase):
    """Fiche tiers enrichie : code, secteur, contact, RCCM, conditions de paiement, non-assujettissement."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("fatou", "finance")

    def setUp(self):
        super().setUp()
        self.token = self.open_session("fatou")["access_token"]

    def test_fiche_et_conditions_de_paiement(self):
        status, body = self.call("PATCH", f"/finance/partners/{self.customer.id}", {
            "ref": "CLI-0001", "sector": "Mines", "contact": "Directeur logistique", "rccm": "GN.TCC.2026.B.00042",
            "payment_term": {"days": 30, "end_of_month": False},
            "supplier_payment_term": {"days": 15, "end_of_month": True},
        }, token=self.token)
        self.assertEqual(status, 200, body)
        status, detail = self.call("GET", f"/finance/partners/{self.customer.id}", token=self.token)
        self.assertEqual((detail["ref"], detail["sector"], detail["contact"]), ("CLI-0001", "Mines", "Directeur logistique"))
        self.assertEqual(detail["rccm"], "GN.TCC.2026.B.00042")
        self.assertEqual((detail["payment_term"]["days"], detail["payment_term"]["end_of_month"]), (30, False))
        self.assertEqual((detail["supplier_payment_term"]["days"], detail["supplier_payment_term"]["end_of_month"]), (15, True))
        status, _b = self.call("PATCH", f"/finance/partners/{self.supplier.id}", {"payment_term": {"days": 30}},
                               token=self.token)
        self.assertEqual(self.supplier.property_payment_term_id, self.customer.property_payment_term_id,
                         "Une condition identique est réutilisée, pas recréée")
        status, listing = self.call("GET", "/finance/partners?search=CLI-0001", token=self.token)
        self.assertEqual([p["id"] for p in listing["items"]], [self.customer.id], "Recherche par code")
        status, body = self.call("PATCH", f"/finance/partners/{self.customer.id}", {"payment_term": {"days": 900}},
                                 token=self.token)
        self.assertEqual(status, 422)

    def test_client_non_assujetti(self):
        status, body = self.call("PATCH", f"/finance/partners/{self.customer.id}", {"vat_exempt": True}, token=self.token)
        self.assertEqual((status, body["vat_exempt"]), (200, True))
        status, move = self.call("POST", "/finance/moves", {
            "move_type": "out_invoice", "partner_id": self.customer.id,
            "lines": [{"name": "Transport exonéré", "price_unit": 10_000_000, "account_id": self.acc_services.id,
                       "tax_ids": [self.tax_sale.id]}],
        }, token=self.token)
        self.assertEqual(status, 200, move)
        self.assertEqual(move["amount_tax"], 0, "Client non assujetti : facture en exonération")
        invoice = self.make_invoice("out_invoice", 5_000_000, post=False)
        self.assertEqual(invoice.amount_tax, 0, "Exonération appliquée aux factures créées par les modules")
        bill = self.make_invoice("in_invoice", 5_000_000, post=False)
        self.assertEqual(bill.amount_tax, 900_000, "Les achats ne sont pas concernés")
