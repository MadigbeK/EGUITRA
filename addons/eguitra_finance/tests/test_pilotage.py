from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo.tests import TransactionCase, tagged

from .pilotage_common import PilotageMixin


@tagged("post_install", "-at_install")
class TestPilotage(PilotageMixin, TransactionCase):
    """Pilotage de la direction : BFR et délais, balance âgée, flux mensuels et prévision de trésorerie,
    tableau de bord et questions du dirigeant, lecture du rapport mensuel."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_pilotage_data()

    def test_besoin_en_fonds_de_roulement(self):
        wc = self.metrics.working_capital(self.company, self.fy_start, self.today)
        days = (self.today - self.fy_start).days + 1
        self.assertEqual(wc["days"], days)
        self.assertAlmostEqual(wc["receivables"], 1_180_000_000)
        self.assertAlmostEqual(wc["sales_ttc"], 1_180_000_000, msg="Ventes TTC facturées")
        self.assertAlmostEqual(wc["purchases_ttc"], 236_000_000, msg="Achats TTC facturés")
        self.assertAlmostEqual(wc["dso"], days, 2, "Rien n'est encaissé : DSO = jours de la période")
        self.assertAlmostEqual(wc["dpo"], days, 2)
        self.assertAlmostEqual(wc["dio"], 0, 2, "Sans stock, DIO nul")
        self.assertAlmostEqual(wc["cycle"], 0, 2, "Cycle = DSO + DIO - DPO")
        self.assertAlmostEqual(wc["bfr"], 1_180_000_000 - 236_000_000, msg="BFR = créances + stocks - dettes")
        self.assertEqual(wc["overdue_share_pct"], 0)
        self.assertEqual(wc["concentration"]["partner"], self.customer.name)
        self.assertAlmostEqual(wc["concentration"]["pct"], 100, 2, "Un seul client sur la période")
        sheet = self.env["eguitra.syscohada"].balance_sheet(self.company, self.today)
        actif = {line["code"]: line["amount"] for line in sheet["actif"]}
        passif = {line["code"]: line["amount"] for line in sheet["passif"]}
        self.assertAlmostEqual(wc["bfr_syscohada"], actif["BK"] - passif["DP"], 2)
        self.assertEqual(wc["receivables_aging_count"]["non_echu"], 1, "Nombre de pièces par tranche")

    def test_balance_agee_et_statut_des_tiers(self):
        late = self.make_invoice("in_invoice", 50_000_000, day=self.today - timedelta(days=100),
                                 due=self.today - timedelta(days=100))
        rows = {r["partner_id"]: r for r in self.metrics.partner_aging(self.company, "liability_payable", self.today)}
        supplier = rows[self.supplier.id]
        self.assertAlmostEqual(supplier["total"], 236_000_000 + late.amount_total)
        self.assertAlmostEqual(supplier["overdue"], late.amount_total)
        self.assertGreaterEqual(supplier["max_late_days"], 100)
        self.assertEqual(supplier["status"], "contentieux", "Plus de 90 jours de retard")
        self.assertEqual(supplier["documents"], 2)
        customers = {r["partner_id"]: r for r in self.metrics.partner_aging(self.company, "asset_receivable", self.today)}
        self.assertEqual(customers[self.customer.id]["status"], "a_jour")

    def test_flux_mensuels_de_tresorerie(self):
        bank, cash = self.bank.default_account_id, self.cash.default_account_id
        opening = self.env["account.journal"].create({"name": "À-nouveaux", "code": "AN", "type": "general",
                                                      "company_id": self.company.id})
        self.entry(opening, [(bank, 50_000_000, 0, None), (self.account("1013"), 0, 50_000_000, None)], self.fy_start)
        receivable = self.customer.property_account_receivable_id
        self.entry(self.bank, [(bank, 400_000_000, 0, None), (receivable, 0, 400_000_000, self.customer)])
        self.entry(self.bank, [(self.account("24"), 30_000_000, 0, None), (bank, 0, 30_000_000, None)])
        transit = self.company.transfer_account_id
        self.entry(self.bank, [(transit, 25_000_000, 0, None), (bank, 0, 25_000_000, None)])
        self.entry(self.cash, [(cash, 25_000_000, 0, None), (transit, 0, 25_000_000, None)])

        data = self.metrics.monthly_cash(self.company, self.today, threshold=500_000_000)
        self.assertAlmostEqual(data["opening"], 50_000_000, msg="Ouverture : à-nouveaux de l'exercice")
        month = next(m for m in data["months"] if m["current"])
        self.assertAlmostEqual(month["receipts"], 400_000_000)
        self.assertAlmostEqual(month["payments"], 30_000_000, msg="Les virements internes (585) sont exclus")
        self.assertAlmostEqual(month["net"], 370_000_000)
        self.assertAlmostEqual(month["end"], 420_000_000)
        self.assertAlmostEqual(month["revenue"], 1_000_000_000, msg="Chiffre d'affaires HT du mois")
        self.assertEqual(month["status"], "sous_seuil", "Solde de 420 M sous le seuil de 500 M")
        self.assertEqual(len(data["months"]), 12)
        later = [m for m in data["months"] if m["month"] > month["month"]]
        self.assertTrue(all(m["status"] == "a_venir" and m["end"] is None for m in later))
        self.assertEqual(data["summary"]["low_point"]["end"], 420_000_000)
        self.assertAlmostEqual(self.metrics._treasury_balance(self.company, self.today), month["end"],
                               msg="Le tableau rejoint le solde des banques et caisses")

    def test_prevision_de_tresorerie(self):
        self.make_invoice("out_invoice", 100_000_000, day=self.today - timedelta(days=120), due=self.today - timedelta(days=120))
        loan = self.loan()
        forecast = self.metrics.cash_forecast(self.company, self.today)
        current = forecast["month_end"]
        self.assertAlmostEqual(current["start"], 0)
        self.assertAlmostEqual(current["receivables"], 1_180_000_000, msg="Créances échues d'ici la fin du mois")
        self.assertAlmostEqual(current["doubtful_excluded"], 118_000_000, msg="Créance de plus de 90 jours écartée")
        self.assertAlmostEqual(current["payables"], 236_000_000)
        self.assertAlmostEqual(current["loans"], loan.line_ids[0].total, msg="Échéance d'emprunt du mois")
        self.assertAlmostEqual(current["end"], 1_180_000_000 - 236_000_000 - loan.line_ids[0].total)
        self.assertEqual(len(forecast["months"]), 3)
        self.assertAlmostEqual(forecast["months"][0]["loans"], loan.line_ids[1].total)
        self.assertAlmostEqual(forecast["months"][0]["start"], current["end"])

    def test_tableau_de_bord_et_questions(self):
        self.env["mis.budget.by.account"].search([]).write({"state": "cancelled"})
        dash = self.metrics.dashboard(self.company, self.today)
        self.assertAlmostEqual(dash["margins"]["net_pct"], 80, 2, "Marge nette = XI / XB")
        self.assertAlmostEqual(dash["margins"]["ebe_pct"], 80, 2)
        self.assertTrue(dash["ledger"]["balanced"], "Total des débits égal au total des crédits")
        self.assertEqual(dash["thresholds"]["dscr_min"], 1.2)
        self.assertLessEqual(len(dash["decisions"]), 6)
        questions = {q["key"]: q for q in dash["questions"]}
        self.assertEqual(len(dash["questions"]), 11, "Les onze questions du dirigeant")
        self.assertTrue(all(q["verdict"] in ("green", "orange", "red", "grey") for q in dash["questions"]))
        self.assertEqual(questions["result"]["verdict"], "green")
        self.assertEqual(questions["dscr"]["verdict"], "grey", "Pas de dette")
        self.assertEqual(questions["budget"]["verdict"], "grey", "Pas de budget")
        self.assertEqual(questions["publishable"]["verdict"], "orange", "Aucun mois scellé")
        self.assertAlmostEqual(dash["expected_credit_loss"]["total"], 1_180_000_000 * 0.01, 0)
        self.assertEqual(len(dash["cash_monthly"]["months"]), 12)
        self.assertIn("month_end", dash["cash_forecast"])

    def test_questions_avec_un_seuil_a_zero(self):
        """Un seuil laissé à 0 éteint sa règle : la question ne juge plus (grey, « seuil non fixé ») au lieu de
        se comparer à une valeur codée (20 % de part échue, DSCR de 1,2)."""
        self.env["mis.budget.by.account"].search([]).write({"state": "cancelled"})
        # Douze échéances sur les douze derniers mois : service de 720 M pour un EBE de 800 M (DSCR 1,11).
        self.loan(principal=720_000_000, start_date=self.today - relativedelta(months=12),
                  first_due=self.today - relativedelta(months=11))
        Threshold = self.env["eguitra.alert.threshold"]
        Threshold.ensure_defaults(self.company)
        thresholds = Threshold.search([("company_id", "=", self.company.id)])
        thresholds.filtered(lambda t: t.code == "dscr_min").write({"value": 1.2})
        thresholds.filtered(lambda t: t.code == "receivable_overdue_share_pct").write({"value": 20})
        thresholds.filtered(lambda t: t.code == "dso_target_days").write({"value": 60})
        thresholds.filtered(lambda t: t.code == "cash_min").write({"value": 0})

        questions = {q["key"]: q for q in self.metrics.dashboard(self.company, self.today)["questions"]}
        self.assertAlmostEqual(self.metrics.dscr(self.company, self.today)["dscr"], 800 / 720, 2)
        self.assertEqual(questions["dscr"]["verdict"], "orange", "DSCR de 1,11 sous le minimum fixé à 1,2")
        self.assertEqual(questions["receivables"]["verdict"], "green", "Aucune créance échue, seuil de 20 %")
        self.assertNotEqual(questions["dso"]["verdict"], "grey", "Délai jugé contre la cible de 60 jours")
        self.assertFalse(questions["dscr"]["threshold_unset"])
        self.assertEqual((questions["cash"]["verdict"], questions["cash"]["threshold_unset"]), ("grey", True),
                         "Trésorerie nulle, seuil de sécurité laissé à 0 : pas de verdict")
        self.assertFalse(questions["transport"]["threshold_unset"], "Sans rotation : sans objet, non « seuil non fixé »")

        thresholds.filtered(lambda t: t.code in ("dscr_min", "receivable_overdue_share_pct", "dso_target_days")).write(
            {"value": 0})
        questions = {q["key"]: q for q in self.metrics.dashboard(self.company, self.today)["questions"]}
        for key in ("dscr", "receivables", "dso"):
            self.assertEqual((questions[key]["verdict"], questions[key]["threshold_unset"]), ("grey", True),
                             f"{key} : seuil à 0, pas de comparaison à une valeur codée")
        self.assertIn("seuil non fixé", questions["dscr"]["reading"])
        self.assertIn("seuil non fixé", questions["receivables"]["reading"])
        self.assertIn("non fixée", questions["dso"]["reading"])
        report = self.metrics.management_report(self.company, self.today)
        self.assertTrue(any("minimum : seuil non fixé" in p for p in report["reading"]),
                        "Lecture du rapport mensuel : DSCR sans minimum codé")

    def test_rapport_mensuel_enrichi(self):
        report = self.metrics.management_report(self.company, self.today)
        self.assertTrue(report["reading"], "Lecture de la période rédigée")
        self.assertIn("chiffre d'affaires", report["reading"][0])
        self.assertIn("Le résultat net du mois", report["reading"][1])
        self.assertIn("previous_month", report["income"][0])
        for key in ("receipts_month", "payments_month", "cash_net_month", "debt_service_fy", "dso", "bfr",
                    "payables_overdue"):
            self.assertIn(key, report["kpis"])
        self.assertEqual(len(report["cash_monthly"]["months"]), 12)
        self.assertAlmostEqual(report["kpis"]["bfr"], 1_180_000_000 - 236_000_000)
