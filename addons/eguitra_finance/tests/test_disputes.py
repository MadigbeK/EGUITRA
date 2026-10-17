from datetime import timedelta

from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestInvoiceDisputes(FinanceDataMixin, ApiCase):
    """Litige, contrat et devise d'une facture ; une facture en litige n'est pas relancée."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("fatou", "finance")

    def setUp(self):
        super().setUp()
        self.token = self.open_session("fatou")["access_token"]

    def test_litige_exclu_des_relances(self):
        late = self.make_invoice("out_invoice", 20_000_000, day=self.today - timedelta(days=45))
        late.invoice_date_due = self.today - timedelta(days=45)
        status, body = self.call("POST", f"/finance/moves/{late.id}/dispute", {"dispute": True}, token=self.token)
        self.assertEqual(status, 422, "Le motif est obligatoire")
        status, body = self.call("POST", f"/finance/moves/{late.id}/dispute",
                                 {"dispute": True, "reason": "Quantités livrées contestées"}, token=self.token)
        self.assertEqual(status, 200, body)
        self.assertTrue(body["dispute"])
        self.assertEqual(body["dispute_reason"], "Quantités livrées contestées")
        reminders = self.env["eguitra.reminder"].generate(self.company, self.today)
        self.assertFalse(reminders.filtered(lambda r: late in r.invoice_ids), "Pas de relance d'une facture en litige")
        status, listing = self.call("GET", "/finance/moves?type=out_invoice&dispute=1", token=self.token)
        self.assertEqual([m["id"] for m in listing["items"]], [late.id])
        status, body = self.call("POST", f"/finance/moves/{late.id}/dispute", {"dispute": False}, token=self.token)
        self.assertFalse(body["dispute"])
        self.assertIsNone(body["dispute_reason"])
        reminders = self.env["eguitra.reminder"].generate(self.company, self.today)
        self.assertTrue(reminders.filtered(lambda r: late in r.invoice_ids), "Litige levé : la relance reprend")

    def test_facture_en_devise_avec_contrat_et_litige(self):
        usd = self.env.ref("base.USD")
        usd.active = True
        status, move = self.call("POST", "/finance/moves", {
            "move_type": "out_invoice", "partner_id": self.customer.id, "currency_id": usd.id,
            "contract_ref": "CT-2026-014", "dispute": True, "dispute_reason": "Tarif contesté",
            "lines": [{"name": "Transport de minerai", "price_unit": 12_000, "account_id": self.acc_services.id}],
        }, token=self.token)
        self.assertEqual(status, 200, move)
        self.assertEqual(move["currency"], "USD")
        self.assertEqual(move["contract_ref"], "CT-2026-014")
        self.assertTrue(move["dispute"])
        status, body = self.call("POST", f"/finance/moves/{self.make_invoice('out_invoice', 1_000).id}/dispute",
                                 {"dispute": True, "reason": "x"}, token=self.token)
        self.assertEqual(status, 200)
        entry = self.env["account.move"].create({
            "move_type": "entry", "journal_id": self.bank.id,
            "line_ids": [(0, 0, {"name": "OD", "account_id": self.acc_purchase.id, "debit": 10}),
                         (0, 0, {"name": "OD", "account_id": self.bank.default_account_id.id, "credit": 10})],
        })
        status, body = self.call("POST", f"/finance/moves/{entry.id}/dispute", {"dispute": True, "reason": "x"},
                                 token=self.token)
        self.assertEqual(status, 422, "Une opération diverse n'est pas mise en litige")
