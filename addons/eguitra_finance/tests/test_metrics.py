from odoo.tests import TransactionCase, tagged

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestMetrics(FinanceDataMixin, TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.invoice = cls.make_invoice("out_invoice", 1_000_000_000)
        cls.bill = cls.make_invoice("in_invoice", 200_000_000)

    def test_tableau_de_bord(self):
        metrics = self.env["eguitra.finance.metrics"]
        data = metrics.dashboard(self.company, self.today)
        self.assertEqual(data["revenue_fy"], 1_000_000_000)
        self.assertEqual(data["revenue_month"], 1_000_000_000)
        self.assertEqual(data["receivables"]["total"], 1_180_000_000, "Encours TTC")
        self.assertEqual(data["payables"]["total"], 236_000_000)
        self.assertEqual(data["net_result_fy"], 800_000_000, "Résultat : 1 000 M de services moins 200 M de charges")
        self.assertEqual(data["revenue_by_month"][-1]["amount"], 1_000_000_000)
        self.assertEqual(len(data["revenue_by_month"]), 12)

    def test_compte_de_resultat_syscohada(self):
        statement = self.env["eguitra.syscohada"].income_statement(
            self.company, self.today.replace(month=1, day=1), self.today
        )
        totals = statement["totals"]
        self.assertEqual(totals["XB"], 1_000_000_000, "Chiffre d'affaires = services vendus (TC)")
        self.assertEqual(totals["XC"], 800_000_000, "Valeur ajoutée : électricité en autres achats (RE)")
        self.assertEqual(totals["XI"], 800_000_000)
        self.assertFalse(statement["unmapped_accounts"])

    def test_bilan_equilibre(self):
        sheet = self.env["eguitra.syscohada"].balance_sheet(self.company, self.today)
        self.assertEqual(sheet["difference"], 0, "Le bilan doit être équilibré")
        actif = {line["code"]: line["amount"] for line in sheet["actif"]}
        passif = {line["code"]: line["amount"] for line in sheet["passif"]}
        self.assertEqual(actif["BI"], 1_180_000_000, "Créance client TTC")
        self.assertEqual(passif["DJ"], 236_000_000, "Dette fournisseur TTC")
        self.assertEqual(passif["CJ"], 800_000_000, "Résultat de l'exercice au passif")

    def test_rapport_balance(self):
        result = self.env["eguitra.report.engine"].run(
            "balance", self.company, self.today.replace(month=1, day=1), self.today
        )
        self.assertAlmostEqual(result["totals"]["debit"], result["totals"]["credit"])
        codes = {row["compte"] for row in result["rows"]}
        self.assertIn("706100", codes)
        csv_bytes = self.env["eguitra.report.engine"].to_csv(result)
        self.assertTrue(csv_bytes.startswith("﻿".encode()))
        self.assertTrue(self.env["eguitra.report.engine"].to_xlsx(result, "Balance").startswith(b"PK"))

    def test_rapport_filtre_invalide(self):
        with self.assertRaises(ValueError):
            self.env["eguitra.report.engine"].run("ventes", self.company, filters={"paiement": "'; DROP TABLE x;--"})

    def test_alerte_compte_de_passage(self):
        transit = self.company.transfer_account_id
        move = self.env["account.move"].create({
            "move_type": "entry", "journal_id": self.bank.id, "date": self.today,
            "line_ids": [
                (0, 0, {"name": "Virement", "account_id": transit.id, "debit": 5_000_000}),
                (0, 0, {"name": "Virement", "account_id": self.bank.default_account_id.id, "credit": 5_000_000}),
            ],
        })
        move.action_post()
        alerts = self.env["eguitra.alert.threshold"].active_alerts(self.company, self.today)
        self.assertIn("transit_account", [a["code"] for a in alerts])
        self.assertEqual(alerts[0]["severity"], "blocking", "Les alertes bloquantes viennent en tête")
