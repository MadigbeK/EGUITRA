from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestReglementPartiel(FinanceDataMixin, ApiCase):
    """Règlement d'une pièce (audit de l'application web, C1) : un règlement partiel dont le montant est
    absent, nul ou illisible est refusé, au lieu de régler tout le reste dû ; la route est réservée à la
    finance et à l'administration (FIN_WRITE)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("caissier.rp", "finance")
        cls._create_user("dg.rp", "direction")
        cls._create_user("acheteur.rp", "achats")
        cls._create_user("parc.rp", "exploitation")

    def setUp(self):
        super().setUp()
        self.token = self.open_session("caissier.rp")["access_token"]

    def _payer(self, move, payload, token=None):
        return self.call("POST", f"/finance/moves/{move.id}/payments", dict({"journal_id": self.bank.id}, **payload),
                         token=token or self.token)

    def test_montant_partiel_absent_nul_ou_illisible_refuse(self):
        invoice = self.make_invoice("out_invoice", 10_000_000)  # 11 800 000 GNF TTC
        for payload in ({"amount": None}, {"amount": ""}, {"amount": 0}, {"amount": -750_000},
                        {"amount": "750 000,00"}, {"amount": "nan"}, {"partial": True},
                        {"partial": True, "amount": None}):
            status, body = self._payer(invoice, payload)
            self.assertEqual((status, body.get("error")), (400, "invalid_parameter"), (payload, body))
        self.env.invalidate_all()
        self.assertEqual(invoice.payment_state, "not_paid", "Aucune saisie illisible ne règle la facture")
        self.assertFalse(self.env["account.payment"].search([("partner_id", "=", self.customer.id)]),
                         "Aucun règlement créé")

        status, body = self._payer(invoice, {"amount": 750_000, "partial": True})
        self.assertEqual(status, 200, body)
        self.assertEqual((body["payment_state"], body["amount_residual"]), ("partial", 11_050_000))

        status, body = self._payer(invoice, {})
        self.assertEqual(status, 200, body)
        self.assertIn(body["payment_state"], ("paid", "in_payment"), "Sans montant : tout le reste dû est réglé")

    def test_reglement_refuse_hors_finance(self):
        bill = self.make_invoice("in_invoice", 10_000_000)
        for login in ("dg.rp", "acheteur.rp", "parc.rp"):
            token = self.open_session(login)["access_token"]
            status, body = self._payer(bill, {"amount": 1_000_000, "partial": True}, token=token)
            self.assertEqual((status, body.get("error")), (403, "forbidden"), (login, body))
        self.env.invalidate_all()
        self.assertEqual(bill.payment_state, "not_paid")
