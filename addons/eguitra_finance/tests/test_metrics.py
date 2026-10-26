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
        start = data["fiscal_year"]["start"]
        self.assertEqual(len(data["revenue_by_month"]), (self.today.year - start.year) * 12 + self.today.month - start.month + 1,
                         "Fenêtre commune avec les flux de trésorerie : du début de l'exercice au mois de l'arrêté")

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

    def test_fournisseur_debiteur_et_depreciations(self):
        """Avance versée sur le compte fournisseur (401 débiteur) en BH ; dépréciations 295, 490, 591 à 594 et
        provisions 599 dans leurs rubriques : bilan équilibré, aucun compte hors états."""
        env = self.env
        Account = env["account.account"]

        def account(prefix, kind):
            found = Account.search([("code", "=like", prefix + "%"), ("company_ids", "in", self.company.ids)],
                                   order="code", limit=1)
            return found or Account.create({"code": prefix.ljust(6, "0"), "name": f"Compte {prefix} (test)",
                                            "account_type": kind, "company_ids": [(6, 0, self.company.ids)]})

        payable = self.supplier.property_account_payable_id
        bank = self.bank.default_account_id
        lines = [(payable, 300_000_000, 0, self.supplier), (bank, 0, 300_000_000, None)]  # avance sur 401
        for prefix, kind, amount in (("490", "asset_current", 5_000_000), ("295", "asset_non_current", 2_000_000),
                                     ("591", "asset_current", 1_000_000), ("592", "asset_current", 1_000_000),
                                     ("599", "liability_current", 3_000_000)):
            lines += [(self.acc_purchase, amount, 0, None), (account(prefix, kind), 0, amount, None)]
        move = env["account.move"].create({
            "move_type": "entry", "journal_id": self.bank.id, "date": self.today,
            "line_ids": [(0, 0, {"name": "Test", "account_id": acc.id, "debit": debit, "credit": credit,
                                 "partner_id": partner.id if partner else False})
                         for acc, debit, credit, partner in lines],
        })
        move.action_post()
        sheet = self.env["eguitra.syscohada"].balance_sheet(self.company, self.today)
        self.assertEqual(sheet["unmapped_accounts"], {}, "Tous les comptes figurent dans le bilan")
        self.assertAlmostEqual(sheet["difference"], 0, 0, msg="Bilan équilibré")
        actif = {line["code"]: line["amount"] for line in sheet["actif"]}
        passif = {line["code"]: line["amount"] for line in sheet["passif"]}
        self.assertAlmostEqual(actif["BH"], 300_000_000 - 236_000_000 - 5_000_000, 0,
                               msg="401 débiteur en fournisseurs, avances versées, moins sa dépréciation")
        self.assertAlmostEqual(passif["DJ"], 0, 0, msg="Plus de dette fournisseur")
        self.assertAlmostEqual(passif["DN"], 3_000_000, 0, msg="599 en provisions pour risques à court terme")

    def test_rapport_balance(self):
        result = self.env["eguitra.report.engine"].run(
            "balance", self.company, self.today.replace(month=1, day=1), self.today
        )
        self.assertAlmostEqual(result["totals"]["debit"], result["totals"]["credit"])
        codes = {row["compte"] for row in result["rows"]}
        self.assertIn("706100", codes)
        csv_bytes = self.env["eguitra.report.engine"].to_csv(result)
        self.assertTrue(csv_bytes.startswith("﻿".encode()))
        self.assertMilliersGroupes(self.env["eguitra.report.engine"].to_xlsx(result, "Balance"))

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

    def test_tableau_des_flux(self):
        env = self.env
        start = self.today.replace(month=1, day=1)

        def account(prefix):
            return env["account.account"].search(
                [("code", "=like", prefix + "%"), ("company_ids", "in", self.company.ids)], limit=1, order="code")

        def entry(journal, lines, day=None):
            move = env["account.move"].create({
                "move_type": "entry", "journal_id": journal.id, "date": day or self.today,
                "line_ids": [(0, 0, {"name": "Test", "account_id": acc.id, "debit": debit, "credit": credit,
                                     "partner_id": partner.id if partner else False})
                             for acc, debit, credit, partner in lines],
            })
            move.action_post()
            return move

        bank = self.bank.default_account_id
        opening = env["account.journal"].create({"name": "À-nouveaux", "code": "AN", "type": "general",
                                                 "company_id": self.company.id})
        entry(opening, [(bank, 50_000_000, 0, None), (account("1013"), 0, 50_000_000, None)], start)
        receivable = self.customer.property_account_receivable_id
        entry(self.bank, [(bank, 400_000_000, 0, None), (receivable, 0, 400_000_000, self.customer)])
        entry(self.bank, [(account("24"), 30_000_000, 0, None), (bank, 0, 30_000_000, None)])
        entry(self.bank, [(bank, 100_000_000, 0, None), (self.acc_loan, 0, 100_000_000, None)])

        flow = env["eguitra.syscohada"].cash_flow(self.company, start, self.today)
        v = {line["code"]: line["amount"] for line in flow["lines"]}
        self.assertAlmostEqual(v["ZA"], 50_000_000, 2, "Les à-nouveaux forment la trésorerie d'ouverture")
        self.assertAlmostEqual(v["FK"], 0, 2, "L'apport repris en à-nouveaux n'est pas un flux de la période")
        self.assertAlmostEqual(v["FA"], 800_000_000, 2, "CAFG = résultat, sans dotation")
        self.assertAlmostEqual(v["ZB"], 400_000_000, 2, "Flux opérationnel = encaissement du client")
        self.assertAlmostEqual(v["FG"], -30_000_000, 2)
        self.assertAlmostEqual(v["FO"], 100_000_000, 2)
        self.assertAlmostEqual(v["ZH"], 520_000_000, 2)
        self.assertAlmostEqual(flow["difference"], 0, 2, "Le tableau rejoint la trésorerie du bilan")

    def test_flux_achat_d_immobilisation_non_paye(self):
        """Camion facturé et non payé : ni décaissement d'investissement, ni ressource d'exploitation ; réglé
        en partie, seule la part payée du camion passe en investissement. Cession non encaissée : aucun
        encaissement de cession."""
        env = self.env
        start = self.today.replace(month=1, day=1)
        Account = env["account.account"]

        def account(prefix, kind):
            found = Account.search([("code", "=like", prefix + "%"), ("company_ids", "in", self.company.ids)],
                                   order="code", limit=1)
            return found or Account.create({"code": prefix.ljust(6, "0"), "name": f"Compte {prefix} (test)",
                                            "account_type": kind, "company_ids": [(6, 0, self.company.ids)]})

        def flows():
            flow = env["eguitra.syscohada"].cash_flow(self.company, start, self.today)
            self.assertAlmostEqual(flow["difference"], 0, 0, msg="Le tableau rejoint la trésorerie du bilan")
            return {line["code"]: line["amount"] for line in flow["lines"]}

        bill = env["account.move"].create({
            "move_type": "in_invoice", "partner_id": self.supplier.id, "invoice_date": self.today,
            "invoice_line_ids": [(0, 0, {"name": "Camion citerne", "quantity": 1, "price_unit": 500_000_000,
                                         "account_id": account("245", "asset_fixed").id,
                                         "tax_ids": [(6, 0, self.tax_purchase.ids)]})],
        })
        bill.with_context(eguitra_approval_granted=True).action_post()
        v = flows()
        self.assertAlmostEqual(v["FG"], 0, 0, msg="Rien de décaissé pour le camion")
        self.assertAlmostEqual(v["ZC"], 0, 0)
        self.assertAlmostEqual(v["ZB"], 0, 0, msg="La dette du camion n'est pas une ressource d'exploitation")

        payable = bill.line_ids.filtered(lambda line: line.account_id.account_type == "liability_payable")
        payment = env["account.move"].create({
            "move_type": "entry", "journal_id": self.bank.id, "date": self.today,
            "line_ids": [(0, 0, {"name": "Règlement du camion", "account_id": payable.account_id.id,
                                 "partner_id": self.supplier.id, "debit": 236_000_000}),
                         (0, 0, {"name": "Règlement du camion", "account_id": self.bank.default_account_id.id,
                                 "credit": 236_000_000})],
        })
        payment.action_post()
        (payable | payment.line_ids.filtered(lambda line: line.account_id == payable.account_id)).reconcile()
        v = flows()
        self.assertAlmostEqual(v["FG"], -200_000_000, 0, msg="40 % du camion (hors TVA) payés")
        self.assertAlmostEqual(v["ZG"], -236_000_000, 0, msg="Sortie de banque")

        sale = env["account.move"].create({
            "move_type": "entry", "journal_id": self.bank.id, "date": self.today,
            "line_ids": [(0, 0, {"name": "Cession d'un véhicule", "account_id": account("485", "asset_current").id,
                                 "debit": 100_000_000}),
                         (0, 0, {"name": "Cession d'un véhicule", "account_id": account("822", "income_other").id,
                                 "credit": 100_000_000})],
        })
        sale.action_post()
        v = flows()
        self.assertAlmostEqual(v["FI"], 0, 0, msg="Cession non encaissée : aucun encaissement")
        self.assertAlmostEqual(v["FB"], 0, 0, msg="La créance de cession ne pèse pas sur l'exploitation")
        self.assertAlmostEqual(v["ZG"], -236_000_000, 0)

    def test_rapport_mensuel_de_gestion(self):
        report = self.env["eguitra.finance.metrics"].management_report(self.company, self.today)
        income = {line["code"]: line for line in report["income"]}
        self.assertEqual(income["XB"]["month"], 1_000_000_000)
        self.assertEqual(income["XI"]["ytd"], 800_000_000)
        self.assertEqual(income["XB"]["month_last_year"], 0)
        self.assertEqual(report["kpis"]["receivables"], 1_180_000_000)
        self.assertIn("ZG", report["cash_flow"])
