from dateutil.relativedelta import relativedelta

from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestPilotageApi(FinanceDataMixin, ApiCase):
    """Routes du pilotage : trésorerie mensuelle, BFR, balance âgée, questions du dirigeant,
    alertes avec les règles conformes, en-tête de l'application, dette et rapprochement des échéances."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.make_invoice("out_invoice", 300_000_000)
        cls.make_invoice("in_invoice", 100_000_000)
        cls._create_user("mariama", "finance")
        cls._create_user("alpha", "exploitation")

    def setUp(self):
        super().setUp()
        self.token = self.open_session("mariama")["access_token"]

    def test_tresorerie_mensuelle_et_bfr(self):
        status, body = self.call("GET", "/finance/cash/monthly", token=self.token)
        self.assertEqual(status, 200, body)
        self.assertEqual(len(body["months"]), 12)
        self.assertIn("low_point", body["summary"])
        self.assertIsNotNone(body["forecast"], "Prévision pour l'exercice en cours")
        self.assertEqual(len(body["forecast"]["months"]), 3)
        status, body = self.call("GET", "/finance/cash/monthly?scope=group", token=self.token)
        self.assertEqual(status, 200, body)

        status, wc = self.call("GET", "/finance/working-capital", token=self.token)
        self.assertEqual(status, 200, wc)
        self.assertAlmostEqual(wc["receivables"], 354_000_000)
        self.assertAlmostEqual(wc["payables"], 118_000_000)
        self.assertAlmostEqual(wc["bfr"], 354_000_000 - 118_000_000)
        for key in ("dso", "dpo", "dio", "cycle", "overdue_share_pct", "concentration", "bfr_syscohada", "dso_12m"):
            self.assertIn(key, wc)

    def test_balance_agee_fournisseurs(self):
        status, body = self.call("GET", "/finance/partners/aging?kind=supplier", token=self.token)
        self.assertEqual(status, 200, body)
        self.assertAlmostEqual(body["total"], 118_000_000)
        self.assertEqual(body["aging_count"]["non_echu"], 1)
        row = next(p for p in body["partners"] if p["partner_id"] == self.supplier.id)
        self.assertEqual(row["status"], "a_jour")
        status, body = self.call("GET", "/finance/partners/aging?kind=autre", token=self.token)
        self.assertEqual(status, 400)

    def test_questions_alertes_et_en_tete(self):
        status, body = self.call("GET", "/finance/dashboard/questions", token=self.token)
        self.assertEqual(status, 200, body)
        self.assertEqual(len(body["questions"]), 11)
        status, dash = self.call("GET", f"/finance/dashboard?date={self.today.isoformat()}", token=self.token)
        self.assertEqual(status, 200, dash)
        for key in ("working_capital", "cash_monthly", "cash_forecast", "margins", "thresholds", "questions",
                    "decisions", "ledger", "expected_credit_loss"):
            self.assertIn(key, dash)

        status, alerts = self.call("GET", "/finance/alerts", token=self.token)
        self.assertEqual(status, 200, alerts)
        self.assertTrue(all(a["status"] == "alert" for a in alerts))
        status, rules = self.call("GET", "/finance/alerts?all=1", token=self.token)
        self.assertEqual(status, 200, rules)
        self.assertIn("ok", {r["status"] for r in rules}, "Les règles conformes sont listées")
        self.assertTrue(all({"domain", "unit", "severity", "key"} <= set(r) for r in rules))

        status, shell = self.call("GET", "/finance/shell", token=self.token)
        self.assertEqual(status, 200, shell)
        self.assertTrue(shell["balanced"], "Total des débits égal au total des crédits")
        self.assertAlmostEqual(shell["debit"], shell["credit"])
        self.assertEqual(set(shell["badges"]), {"alerts", "alerts_severe", "approvals", "controls", "controls_blocking"})
        token = self.open_session("alpha")["access_token"]
        status, _b = self.call("GET", "/finance/shell", token=token)
        self.assertEqual(status, 403, "Réservé à la finance et à la direction")

    def test_seuils_gravite_critique(self):
        self._create_user("kadiatou", "admin")
        token = self.open_session("kadiatou")["access_token"]
        status, thresholds = self.call("GET", "/finance/thresholds", token=token)
        self.assertEqual(status, 200, thresholds)
        dscr = next(t for t in thresholds if t["code"] == "dscr_min")
        self.assertEqual((dscr["value"], dscr["unit"], dscr["zero_disables"]), (1.2, "ratio", True))
        status, _b = self.call("PATCH", f"/finance/thresholds/{dscr['id']}", {"severity": "blocking"}, token=token)
        self.assertEqual(status, 200)
        status, _b = self.call("PATCH", f"/finance/thresholds/{dscr['id']}", {"severity": "critical"}, token=token)
        self.assertEqual(status, 200)
        self.env.invalidate_all()
        self.assertEqual(self.env["eguitra.alert.threshold"].browse(dscr["id"]).severity, "critical")

    def test_dette_et_echeance_rapprochee_du_releve(self):
        loan = self.env["eguitra.loan"].create({
            "name": "Emprunt ECOBANK citernes", "partner_id": self.supplier.id, "principal": 240_000_000,
            "annual_rate": 10, "start_date": self.today - relativedelta(months=1), "first_due_date": self.today,
            "duration_months": 24, "principal_account_id": self.acc_loan.id,
            "interest_account_id": self.acc_interest.id, "journal_id": self.bank.id,
        })
        loan.compute_schedule()
        loan.action_activate()
        self.env.flush_all()  # visible des requêtes HTTP
        status, body = self.call("PATCH", f"/finance/loans/{loan.id}", {"purpose": "Acquisition de deux citernes"},
                                 token=self.token)
        self.assertEqual((status, body.get("purpose")), (200, "Acquisition de deux citernes"), body)
        status, listing = self.call("GET", "/finance/loans", token=self.token)
        self.assertEqual(status, 200, listing)
        for key in ("accounting_outstanding", "schedule_gap", "net_debt", "gearing", "debt_to_ebe", "service_fy"):
            self.assertIn(key, listing["summary"])
        self.assertAlmostEqual(listing["summary"]["schedule_gap"], -240_000_000,
                               msg="Déblocage non comptabilisé : écart avec l'échéancier")

        self.env.invalidate_all()
        first = loan.line_ids[0]
        status, line = self.call("POST", f"/finance/treasury/{self.bank.id}/lines", {
            "label": f"PRELEVEMENT {loan.name}", "amount": -first.total,
        }, token=self.token)
        self.assertEqual(status, 200, line)
        status, candidates = self.call("GET", f"/finance/treasury/lines/{line['id']}/candidates", token=self.token)
        self.assertEqual(status, 200, candidates)
        loans = [c for c in candidates if c.get("kind") == "loan_line"]
        self.assertEqual(loans[0]["id"], first.id, "L'échéance est proposée au rapprochement")
        status, done = self.call("POST", f"/finance/treasury/lines/{line['id']}/reconcile",
                                 {"loan_line_id": first.id}, token=self.token)
        self.assertEqual(status, 200, done)
        self.assertTrue(done["reconciled"])
        self.env.invalidate_all()  # écritures faites par la requête HTTP
        self.assertTrue(first.paid)
        self.assertEqual(first.statement_line_id.id, line["id"])
        status, again = self.call("POST", f"/finance/treasury/lines/{line['id']}/reconcile",
                                  {"loan_line_id": loan.line_ids[1].id}, token=self.token)
        self.assertEqual(status, 422, again)
