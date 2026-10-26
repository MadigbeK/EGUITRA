from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo import Command
from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestIfrs(FinanceDataMixin, TransactionCase):
    """Pertes de crédit attendues (matrice par ancienneté) et passerelle IFRS chiffrée."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.Policy = cls.env["eguitra.ifrs.policy"]

    def _invoice(self, amount, due):
        move = self.env["account.move"].create({
            "move_type": "out_invoice", "partner_id": self.customer.id, "invoice_date": due - timedelta(days=15),
            "invoice_date_due": due,
            "invoice_line_ids": [Command.create({"name": "Transport", "quantity": 1, "price_unit": amount,
                                                 "account_id": self.acc_services.id, "tax_ids": [Command.set([])]})],
        })
        move.with_context(eguitra_approval_granted=True).action_post()
        return move

    def test_matrice_et_ajustement(self):
        self._invoice(100_000_000, self.today - timedelta(days=45))  # 31 à 60 jours : 10 %
        self._invoice(50_000_000, self.today + timedelta(days=10))  # non échu : 1 %
        data = self.Policy.expected_credit_loss(self.company, self.today)
        buckets = {b["bucket"]: b for b in data["buckets"]}
        self.assertEqual(buckets["31_60"]["ecl"], 10_000_000)
        self.assertEqual(buckets["not_due"]["ecl"], 500_000)
        self.assertEqual(data["ecl"], 10_500_000)
        self.assertEqual(data["adjustment"], 10_500_000, "Aucune dépréciation déjà passée")
        client = next(p for p in data["partners"] if p["partner_id"] == self.customer.id)
        self.assertEqual((client["exposure"], client["worst"]), (150_000_000, "31_60"))

        policy = self.Policy._get(self.company)
        policy.ecl_31_60 = 20
        self.assertEqual(self.Policy.expected_credit_loss(self.company, self.today)["ecl"], 20_500_000,
                         "Matrice paramétrable par société")

    def _opening_adjustment(self):
        """Ajustement non comptabilisé à la veille de l'exercice (une facture de test peut tomber dans
        l'exercice précédent quand les tests tournent en début d'année)."""
        fy_start = self.env["eguitra.finance.metrics"].fiscal_year_bounds(self.company, self.today)[0]
        return self.Policy.expected_credit_loss(self.company, fy_start - timedelta(days=1))["adjustment"]

    def test_passerelle_puis_comptabilisation(self):
        self._invoice(100_000_000, self.today - timedelta(days=100))  # plus de 90 jours : 50 %
        bridge = self.Policy.restatements(self.company, self.today)
        ifrs9 = next(line for line in bridge["restatements"] if line["standard"] == "IFRS 9")
        self.assertEqual(ifrs9["amount"], -(50_000_000 - self._opening_adjustment()),
                         "Par défaut, retraitement hors des livres")
        self.assertAlmostEqual(bridge["net_result_ifrs"], bridge["net_result_syscohada"] + bridge["total_restatements"], 2)
        self.assertFalse(next(line for line in bridge["restatements"] if line["standard"] == "IAS 12")["quantified"])

        move = self.Policy.post_expected_credit_loss(self.company, self.today)
        end = self.today.replace(day=1) + relativedelta(months=1, days=-1)
        self.assertEqual((move.ref, move.date), (f"ECL-{end:%m/%Y}", end))
        provision = move.line_ids.filtered(lambda line: line.account_id.code.startswith("491"))
        self.assertEqual(provision.credit, 50_000_000)
        self.assertTrue(move.line_ids.filtered(lambda line: line.account_id.code.startswith("659") and line.debit))
        with self.assertRaises(UserError):
            self.Policy.post_expected_credit_loss(self.company, self.today)
        bridge = self.Policy.restatements(self.company, end)
        ifrs9 = next(line for line in bridge["restatements"] if line["standard"] == "IFRS 9")
        self.assertEqual(ifrs9["amount"], self._opening_adjustment(), "Comptabilisée : plus de retraitement de l'exercice")

    def test_recalcul_apres_extourne(self):
        """L'extourne de la pièce ECL permet de la recalculer, comme le dit le refus."""
        self._invoice(100_000_000, self.today - timedelta(days=100))
        move = self.Policy.post_expected_credit_loss(self.company, self.today)
        move._reverse_moves([{"date": move.date, "ref": f"Extourne {move.ref}"}]).action_post()
        self.assertFalse(self.Policy.expected_credit_loss(self.company, self.today)["posted"])
        again = self.Policy.post_expected_credit_loss(self.company, self.today)
        self.assertNotEqual(again, move)
        self.assertEqual(again.line_ids.filtered(lambda line: line.account_id.code.startswith("491")).credit, 50_000_000)

    def test_passerelle_en_variation_de_l_exercice(self):
        """Une créance déjà ouverte à l'ouverture de l'exercice : seul le surcroît de perte attendue de
        l'exercice retraite son résultat, la part de l'ouverture relève des exercices antérieurs."""
        fy_start = self.env["eguitra.finance.metrics"].fiscal_year_bounds(self.company, self.today)[0]
        opening = fy_start - timedelta(days=1)
        self._invoice(100_000_000, fy_start - timedelta(days=10))  # 9 jours de retard à l'ouverture : 3 %
        at_opening = self.Policy.expected_credit_loss(self.company, opening)["adjustment"]
        self.assertEqual(at_opening, 3_000_000)
        at_day = self.Policy.expected_credit_loss(self.company, self.today)["adjustment"]
        bridge = self.Policy.restatements(self.company, self.today)
        ifrs9 = next(line for line in bridge["restatements"] if line["standard"] == "IFRS 9")
        self.assertEqual(ifrs9["amount"], -(at_day - at_opening), "Variation de l'exercice, pas le solde")

    def test_periode_close_refusee(self):
        self._invoice(10_000_000, self.today - timedelta(days=40))
        self.company.sudo().fiscalyear_lock_date = self.today.replace(day=1) + relativedelta(months=1, days=-1)
        with self.assertRaises(UserError):
            self.Policy.post_expected_credit_loss(self.company, self.today)

    def test_impot_differe(self):
        self._invoice(100_000_000, self.today - timedelta(days=100))
        self.Policy._get(self.company).deferred_tax_rate = 25
        bridge = self.Policy.restatements(self.company, self.today)
        ias12 = next(line for line in bridge["restatements"] if line["standard"] == "IAS 12")
        self.assertTrue(ias12["quantified"])
        quantified = sum(line["amount"] for line in bridge["restatements"]
                         if line["quantified"] and line["standard"] != "IAS 12")
        self.assertAlmostEqual(ias12["amount"], -quantified * 0.25, 2, "25 % du retraitement (-50 M en cours d'exercice)")
