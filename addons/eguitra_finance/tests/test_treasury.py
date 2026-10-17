import io

from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@tagged("post_install", "-at_install")
class TestTreasuryOperations(FinanceDataMixin, ApiCase):
    """Opérations de trésorerie imputées sur les axes, modes de paiement, justificatifs, rapprochement."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("fatou", "finance")
        plan = cls.env.ref("eguitra_base.analytic_plan_activite")
        cls.activity = cls.env["account.analytic.account"].create(
            {"name": "Transport de personnel", "plan_id": plan.id, "company_id": cls.company.id})
        cls.mode = cls.env["eguitra.payment.mode"].search([("name", "=", "Espèces")], limit=1)

    def setUp(self):
        super().setUp()
        self.token = self.open_session("fatou")["access_token"]

    def _upload(self, path, content=PNG, name="recu.png"):
        response = self.url_open("/api/v1" + path, files={"file": (name, io.BytesIO(content), "image/png")},
                                 headers={"Authorization": f"Bearer {self.token}"}, method="POST", timeout=60)
        return response.status_code, response.json()

    def test_modes_de_paiement(self):
        status, modes = self.call("GET", "/finance/payment-modes", token=self.token)
        self.assertEqual(status, 200, modes)
        self.assertTrue({"Virement", "Chèque", "Espèces", "Mobile money"} <= {m["name"] for m in modes})
        status, created = self.call("POST", "/finance/payment-modes", {"name": "Orange Money"}, token=self.token)
        self.assertEqual(status, 200, created)
        status, body = self.call("POST", "/finance/payment-modes", {"name": "orange money"}, token=self.token)
        self.assertEqual(status, 409)
        status, body = self.call("PATCH", f"/finance/payment-modes/{created['id']}", {"active": False}, token=self.token)
        self.assertEqual((status, body["active"]), (200, False))

    def test_operation_imputee_sur_les_axes(self):
        status, line = self.call("POST", f"/finance/treasury/{self.cash.id}/lines", {
            "label": "Carburant du minibus", "amount": -1_500_000, "counterpart_account_id": self.acc_purchase.id,
            "analytic_distribution": {str(self.activity.id): 100}, "payment_mode_id": self.mode.id,
            "reference": "BON-0042",
        }, token=self.token)
        self.assertEqual(status, 200, line)
        self.assertTrue(line["reconciled"])
        self.assertEqual(line["payment_mode"]["name"], "Espèces")
        self.assertEqual(line["reference"], "BON-0042")
        self.assertEqual(line["counterpart"][0]["code"], self.acc_purchase.code)
        self.assertEqual(line["counterpart"][0]["analytic"][0]["id"], self.activity.id)

        status, body = self._upload(f"/finance/treasury/lines/{line['id']}/attachments")
        self.assertEqual(status, 200, body)
        status, listing = self.call("GET", f"/finance/treasury/{self.cash.id}/lines?state=all", token=self.token)
        row = next(r for r in listing["items"] if r["id"] == line["id"])
        self.assertEqual(row["attachments"], 1)

        status, body = self.call("POST", f"/finance/treasury/{self.cash.id}/lines", {
            "label": "Sans compte", "amount": -10_000, "analytic_distribution": {str(self.activity.id): 100},
        }, token=self.token)
        self.assertEqual(status, 422, "L'analytique accompagne un compte d'imputation")

    def test_imputation_directe_au_rapprochement(self):
        status, line = self.call("POST", f"/finance/treasury/{self.bank.id}/lines", {
            "label": "FRAIS TENUE DE COMPTE", "amount": -25_000, "payment_mode_id": self.mode.id,
        }, token=self.token)
        self.assertEqual(status, 200, line)
        self.assertFalse(line["reconciled"])
        status, _b = self._upload(f"/finance/treasury/lines/{line['id']}/attachments")
        self.assertEqual(status, 200)
        status, candidates = self.call("GET", f"/finance/treasury/lines/{line['id']}/candidates", token=self.token)
        self.assertEqual(status, 200, candidates)
        self.assertTrue(all(c["kind"] == "move_line" for c in candidates))

        status, done = self.call("POST", f"/finance/treasury/lines/{line['id']}/reconcile", {
            "account_id": self.acc_purchase.id, "analytic_distribution": {str(self.activity.id): 100},
        }, token=self.token)
        self.assertEqual(status, 200, done)
        self.assertTrue(done["reconciled"])
        self.assertEqual(done["attachments"], 1, "Le justificatif suit l'opération recréée")
        self.assertEqual(done["payment_mode"]["name"], "Espèces")
        self.assertEqual(done["counterpart"][0]["analytic"][0]["id"], self.activity.id)

        status, body = self.call("POST", f"/finance/treasury/lines/{done['id']}/reconcile",
                                 {"account_id": self.acc_purchase.id}, token=self.token)
        self.assertEqual(status, 422, "Déjà rapprochée")

    def test_reglement_avec_mode_de_paiement(self):
        invoice = self.make_invoice("out_invoice", 10_000_000)
        mode = self.env["eguitra.payment.mode"].search([("name", "=", "Virement")], limit=1)
        status, paid = self.call("POST", f"/finance/moves/{invoice.id}/payments", {
            "journal_id": self.bank.id, "payment_mode_id": mode.id}, token=self.token)
        self.assertEqual(status, 200, paid)
        payment = self.env["account.payment"].search([("partner_id", "=", self.customer.id)], order="id desc", limit=1)
        self.assertEqual(payment.eguitra_payment_mode_id, mode)
