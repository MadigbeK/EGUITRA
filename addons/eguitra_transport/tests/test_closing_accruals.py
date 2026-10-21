from dateutil.relativedelta import relativedelta

from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestClosingAccruals(FinanceDataMixin, TransactionCase):
    """Clôture : rotations livrées et non facturées en factures à établir, extournées le mois suivant."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        env = cls.env
        cls.truck = env["eguitra.transport.vehicle"].create({"name": "ER-DEMO", "tractor_plate": "RC-0000-A",
                                                            "capacity_liters": 40000})
        cls.route = env["eguitra.transport.route"].create({"name": "Conakry - Kankan", "distance_km": 640,
                                                          "default_rate": 1_000_000})
        cls.month = cls.today.replace(day=1) - relativedelta(months=1)
        cls.end = cls.month + relativedelta(months=1, days=-1)

    def _rotation(self, loading, delivery):
        rot = self.env["eguitra.transport.rotation"].create({
            "vehicle_id": self.truck.id, "partner_id": self.customer.id, "route_id": self.route.id, "product": "gasoil",
            "volume_loaded": 40, "volume_delivered": 40, "date_loading": loading, "date_delivery": delivery,
        })
        rot.action_validate()
        return rot

    def _balance(self, prefix, day):
        return self.env["eguitra.finance.metrics"]._sum_balance(self.company, [prefix], None, day)

    def test_factures_a_etablir(self):
        delivered = self._rotation(self.month + relativedelta(days=2), self.month + relativedelta(days=3))
        self._rotation(self.end, self.end + relativedelta(days=1))  # livrée le mois suivant : hors du mois
        close = self.env["eguitra.period.close"]._get(self.company, self.month)
        preview = {g["kind"]: g for g in close._closing_preview()}
        self.assertAlmostEqual(preview["accrual"]["amount"], delivered.revenue, 2)

        close.action_close()
        accrual = close.generated_move_ids.filtered(lambda m: m.eguitra_close_kind == "accrual")
        self.assertEqual(accrual.ref, f"FAE-{self.month:%m/%Y}")
        self.assertEqual(accrual.date, self.end)
        income = accrual.line_ids.filtered(lambda line: line.credit)
        self.assertAlmostEqual(sum(income.mapped("credit")), delivered.revenue, 2, msg="Chiffre d'affaires hors taxes")
        self.assertTrue(income.account_id.code.startswith("706"))
        self.assertIn(str(self.truck.analytic_account_id.id), ",".join(income.analytic_distribution or {}),
                      "Analytique de la rotation (ensemble routier)")
        self.assertAlmostEqual(self._balance("418", self.end), delivered.revenue, 2)
        reversal = close.generated_move_ids.filtered(lambda m: m.eguitra_close_kind == "accrual_reversal")
        self.assertEqual(reversal.date, self.end + relativedelta(days=1), "Extourne le premier jour du mois suivant")
        self.assertAlmostEqual(self._balance("418", self.end + relativedelta(days=1)), 0, 2)

    def test_rotation_facturee_le_mois_suivant(self):
        rot = self._rotation(self.month + relativedelta(days=5), self.month + relativedelta(days=6))
        invoice = rot.action_invoice()
        invoice.invoice_date = self.end + relativedelta(days=2)
        targets = self.env["eguitra.period.close"]._close_accrual_targets(self.company, self.end)
        self.assertIn(f"rotation:{rot.id}", targets, "Facture en brouillon : prestation encore à établir")
        invoice.action_post()
        targets = self.env["eguitra.period.close"]._close_accrual_targets(self.company, self.end)
        self.assertIn(f"rotation:{rot.id}", targets, "Facturée après la fin du mois : à établir pour ce mois")
        rot2 = self._rotation(self.month + relativedelta(days=7), self.month + relativedelta(days=8))
        invoice2 = rot2.action_invoice()
        invoice2.invoice_date = self.end
        invoice2.action_post()
        targets = self.env["eguitra.period.close"]._close_accrual_targets(self.company, self.end)
        self.assertNotIn(f"rotation:{rot2.id}", targets, "Facturée dans le mois : rien à établir")
