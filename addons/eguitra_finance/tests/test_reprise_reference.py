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

    def test_ecritures_reprises_et_nombres(self):
        """Ventes et achats repris en écritures (pas en factures), comptes de personnel et d'État hors
        créances et dettes, achats d'une catégorie autre que fournisseur ; nombres sans tolérance."""
        Journal = self.env["account.journal"]
        sales = Journal.search([("company_id", "=", self.company.id), ("type", "=", "sale")], limit=1)
        purchases = Journal.search([("company_id", "=", self.company.id), ("type", "=", "purchase")], limit=1)
        various = Journal.search([("company_id", "=", self.company.id), ("type", "=", "general")], limit=1)
        receivable = self.customer.with_company(self.company).property_account_receivable_id
        payable = self.supplier.with_company(self.company).property_account_payable_id
        vat_out, vat_in = self.account("443"), self.account("445")
        staff, wages, cash = self.account("422"), self.account("661"), self.account("57")
        # Facture de l'ancien système reprise au journal des ventes : 100 M HT, 18 M de TVA.
        self.entry(sales, [(receivable, 118_000_000, 0, self.customer), (self.acc_services, 0, 100_000_000, None),
                           (vat_out, 0, 18_000_000, None)])
        # Pièce d'achat reprise au journal des achats contre un compte de personnel (salaires) : 50 M.
        self.entry(purchases, [(wages, 50_000_000, 0, None), (staff, 0, 50_000_000, None)])
        # Fournisseur repris : 20 M HT, 3,6 M de TVA.
        self.entry(purchases, [(self.acc_purchase, 20_000_000, 0, None), (vat_in, 3_600_000, 0, None),
                               (payable, 0, 23_600_000, self.supplier)])
        # Avance au personnel (compte typé créance par la localisation) : hors créances clients.
        self.entry(various, [(self.account("421"), 7_000_000, 0, None), (cash, 0, 7_000_000, None)])
        Ref = self.env["eguitra.reprise.reference"]
        Ref.load(self.company, self.today, {
            "sales_ttc": 1_298_000_000, "purchases_ttc": 309_600_000,
            "receivables": 1_298_000_000, "payables": 259_600_000, "rotations": 0,
        })
        rows = {r["code"]: r for r in Ref.validation(self.company)["rows"]}
        for code in ("sales_ttc", "purchases_ttc", "receivables", "payables"):
            self.assertTrue(rows[code]["ok"], (code, rows[code]))
        self.assertEqual(rows["rotations"]["tolerance"], 0, "Un nombre n'a pas de tolérance")
        self.assertEqual(rows["sales_ttc"]["tolerance"], 10)
