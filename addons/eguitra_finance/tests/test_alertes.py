from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo.tests import TransactionCase, tagged

from .pilotage_common import PilotageMixin


@tagged("post_install", "-at_install")
class TestAlertes(PilotageMixin, TransactionCase):
    """Alertes de gestion : gravités, actions, règles conformes, seuils à 0, dépassement budgétaire."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_pilotage_data()

    def test_alertes_de_gestion(self):
        Threshold = self.env["eguitra.alert.threshold"]
        Threshold.ensure_defaults(self.company)
        thresholds = Threshold._thresholds(self.company)
        self.assertEqual(thresholds["dscr_min"].value, 1.2, "DSCR minimum du prototype")
        self.assertEqual(thresholds["dso_target_days"].value, 60)
        self.assertEqual(thresholds["dscr_min"].severity, "critical")
        thresholds["cash_min"].value = 5_000_000_000
        self.make_invoice("in_invoice", 10_000_000, day=self.today - timedelta(days=10), due=self.today - timedelta(days=10))

        alerts = Threshold.active_alerts(self.company, self.today)
        by_key = {a["key"]: a for a in alerts}
        cash = by_key["cash_min"]
        self.assertEqual((cash["severity"], cash["domain"], cash["unit"]), ("critical", "Trésorerie", "gnf"))
        self.assertTrue(cash["action"], "Action recommandée")
        self.assertIn("cash_min.forecast", by_key, "Trésorerie prévue sous le seuil")
        self.assertIn("payable_overdue_amount", by_key, "Dettes fournisseurs échues")
        self.assertIn("client_concentration_pct", by_key, "Un seul client : 100 % du chiffre d'affaires")
        self.assertIn("settings.zero", by_key, "Seuil laissé à 0 signalé en vigilance")
        self.assertIn("Encours clients échu maximal", by_key["settings.zero"]["message"])
        order = {"blocking": 0, "critical": 1, "warning": 2, "info": 3}
        severities = [order[a["severity"]] for a in alerts]
        self.assertEqual(severities, sorted(severities), "Les plus graves d'abord")

        everything = Threshold.active_alerts(self.company, self.today, include_ok=True)
        statuses = {a["key"]: a["status"] for a in everything}
        self.assertEqual(statuses["net_result_negative"], "ok", "Règle conforme listée")
        self.assertEqual(statuses["dscr_min"], "na", "Sans dette : sans objet")
        self.assertEqual(statuses["transit_account"], "ok")

        thresholds["receivable_overdue_amount"].active = False
        keys = {a["key"]: a for a in Threshold.active_alerts(self.company, self.today)}
        self.assertNotIn("Encours clients échu maximal", keys.get("settings.zero", {}).get("message", ""),
                         "Un seuil désactivé n'est plus signalé")
        Threshold.ensure_defaults(self.company)  # un seuil désactivé n'est pas recréé

    def test_alerte_budget_depasse(self):
        Budget = self.env["mis.budget.by.account"]
        Budget.search([]).write({"state": "cancelled"})  # budgets éventuels des données de démonstration
        budget = Budget.create({"name": "Budget de l'exercice", "date_from": self.fy_start,
                                "date_to": self.fy_start + relativedelta(years=1, days=-1), "company_id": self.company.id})
        start = self.today.replace(day=1)
        self.env["mis.budget.by.account.item"].create({
            "budget_id": budget.id, "account_id": self.acc_purchase.id, "date_from": start,
            "date_to": start + relativedelta(months=1, days=-1), "debit": 100_000_000, "credit": 0,
            "company_id": self.company.id, "name": "Électricité",
        })
        status = self.metrics.budget_status(self.company, self.today, threshold=10)
        self.assertAlmostEqual(status["expenses"]["budget"], 100_000_000)
        self.assertAlmostEqual(status["expenses"]["actual"], 200_000_000)
        self.assertEqual([o["code"] for o in status["overruns"]], [self.acc_purchase.code])
        alerts = {a["key"]: a for a in self.env["eguitra.alert.threshold"].active_alerts(self.company, self.today)}
        self.assertIn("budget_overrun_pct", alerts, "Dépassement budgétaire dans les alertes de la société")
        dash = self.metrics.dashboard(self.company, self.today)
        self.assertAlmostEqual(dash["budget"]["expenses"]["actual"], 200_000_000, msg="Tuile réalisé contre budget")
