from odoo.tests import TransactionCase, tagged

from .pilotage_common import PilotageMixin


@tagged("post_install", "-at_install")
class TestRepriseReference(PilotageMixin, TransactionCase):
    """Validation de la reprise : valeurs attendues du classeur face aux valeurs recalculées."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_pilotage_data()  # vente de 1 000 M HT, achat de 200 M HT, TVA 18 %

    def test_validation_n_sur_total(self):
        Ref = self.env["eguitra.reprise.reference"]
        self.assertFalse(Ref.validation(self.company)["loaded"])
        Ref.load(self.company, self.today, {
            "revenue": 1_000_000_000, "operating_expenses": 200_000_000, "ebitda": 800_000_000,
            "sales_ttc": 1_180_000_000, "purchases_ttc": 236_000_000, "receivables": 1_180_000_000,
            "payables": 236_000_000, "net_result": 0,
        }, source="Classeur de test")
        result = Ref.validation(self.company)
        rows = {r["code"]: r for r in result["rows"]}
        for code in ("revenue", "operating_expenses", "ebitda", "sales_ttc", "purchases_ttc", "receivables", "payables"):
            self.assertTrue(rows[code]["ok"], (code, rows[code]))
        self.assertFalse(rows["net_result"]["ok"], "Écart signalé")
        self.assertAlmostEqual(rows["net_result"]["gap"], 800_000_000)
        self.assertEqual((result["conform"], result["total"]), (7, 8))
        with self.assertRaises(ValueError):
            Ref.load(self.company, self.today, {"inconnu": 1})
