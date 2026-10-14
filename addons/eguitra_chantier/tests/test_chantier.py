from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestChantier(FinanceDataMixin, TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.chantier = cls.env["eguitra.chantier"].create({
            "name": "Route Kankan - Kouroussa, lot 2", "code": "CH-2026-01", "partner_id": cls.customer.id,
            "contract_amount": 2_000_000_000, "retention_rate": 5,
        })

    def _situation(self, cumulative):
        return self.env["eguitra.chantier.situation"].create({"chantier_id": self.chantier.id, "cumulative_amount": cumulative})

    def test_axe_analytique(self):
        self.assertEqual(self.chantier.analytic_account_id.plan_id, self.env.ref("eguitra_base.analytic_plan_chantier"))

    def test_situations_et_retenues(self):
        s1 = self._situation(500_000_000)
        s1.action_invoice()
        self.assertEqual(s1.amount_period, 500_000_000)
        self.assertEqual(s1.retention_amount, 25_000_000)
        self.assertEqual(s1.invoice_id.amount_total, 590_000_000, "Travaux de la période TTC")
        self.assertEqual(s1.invoice_id.amount_residual, 565_000_000, "Net à payer : TTC moins la retenue")
        self.assertEqual(self.chantier.state, "progress")

        s2 = self._situation(1_200_000_000)
        self.assertEqual(s2.number, 2)
        self.assertEqual(s2.previous_amount, 500_000_000)
        s2.action_invoice()
        self.assertEqual(s2.amount_period, 700_000_000)
        self.assertEqual(self.chantier.invoiced_amount, 1_200_000_000)
        self.assertEqual(self.chantier.retention_total, 60_000_000)
        self.assertAlmostEqual(self.chantier.progress_pct, 60.0)

        retention = self.env["eguitra.finance.metrics"]._sum_balance(self.company, ["4117"], None, self.today)
        self.assertEqual(retention, 60_000_000, "Les retenues sont portées en 4117")

        self.chantier.action_release_retention()
        self.assertEqual(self.chantier.retention_released, 60_000_000)
        retention = self.env["eguitra.finance.metrics"]._sum_balance(self.company, ["4117"], None, self.today)
        self.assertEqual(retention, 0)
        with self.assertRaises(UserError):
            self.chantier.action_release_retention()

    def test_cumul_superieur_au_marche(self):
        with self.assertRaises(UserError):
            self._situation(2_500_000_000).action_invoice()

    def test_cumul_decroissant_refuse(self):
        self._situation(500_000_000).action_invoice()
        with self.assertRaises(UserError):
            self._situation(400_000_000).action_invoice()
