from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestChartOfAccounts(FinanceDataMixin, ApiCase):
    """Plan de comptes tenu par la finance, imputation obligatoire par compte, contrôle de vigilance."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("fatou", "finance")
        cls._create_user("dg", "direction")

    def setUp(self):
        super().setUp()
        self.token = self.open_session("fatou")["access_token"]

    def test_nouveau_compte_sous_une_racine(self):
        prefix = self.acc_purchase.code[:4]
        status, account = self.call("POST", "/finance/accounts", {"code": prefix + "77", "name": "Électricité du parc"},
                                    token=self.token)
        self.assertEqual(status, 200, account)
        self.assertEqual(account["type"], "expense", "Nature reprise du compte voisin")
        self.assertFalse(account["reconcile"])
        status, client = self.call("POST", "/finance/accounts", {"code": "411777", "name": "Clients export"}, token=self.token)
        self.assertEqual(status, 200, client)
        self.assertEqual((client["type"], client["reconcile"]), ("asset_receivable", True))
        status, body = self.call("POST", "/finance/accounts", {"code": "411777", "name": "Doublon"}, token=self.token)
        self.assertEqual(status, 409)
        status, body = self.call("POST", "/finance/accounts", {"code": "0123", "name": "Sans racine"}, token=self.token)
        self.assertEqual(status, 422)
        status, body = self.call("POST", "/finance/accounts", {"code": "6a", "name": "Code invalide"}, token=self.token)
        self.assertEqual(status, 400)
        token = self.open_session("dg")["access_token"]
        status, _b = self.call("POST", "/finance/accounts", {"code": prefix + "78", "name": "Refusé"}, token=token)
        self.assertEqual(status, 403, "La direction consulte le plan, la finance le tient")

        status, body = self.call("PATCH", f"/finance/accounts/{account['id']}", {"analytic_required": True}, token=self.token)
        self.assertEqual((status, body["analytic_required"]), (200, True))
        status, requirements = self.call("GET", "/finance/analytic-requirements", token=self.token)
        self.assertIn(prefix + "77", [r["prefix"] for r in requirements])
        status, body = self.call("PATCH", f"/finance/accounts/{account['id']}", {"active": False}, token=self.token)
        self.assertEqual((status, body["active"]), (200, False))
        status, listing = self.call("GET", f"/finance/accounts?prefix={prefix}&all=1", token=self.token)
        self.assertIn(account["id"], [a["id"] for a in listing if not a["active"]])

    def test_compte_mouvemente_non_desactivable(self):
        self.make_invoice("out_invoice", 1_000_000)
        status, body = self.call("PATCH", f"/finance/accounts/{self.acc_services.id}", {"active": False}, token=self.token)
        self.assertEqual(status, 422, "Un compte non soldé reste actif")
        status, body = self.call("PATCH", f"/finance/accounts/{self.bank.default_account_id.id}", {"active": False},
                                 token=self.token)
        self.assertEqual(status, 422, "Compte d'un journal")

    def test_vigilance_centre_de_cout_et_activite(self):
        Analytic = self.env["account.analytic.account"]
        plan_activity = self.env.ref("eguitra_base.analytic_plan_activite")
        plan_center = self.env.ref("eguitra_base.analytic_plan_centre_cout")
        transport = Analytic.create({"name": "Transport (vigilance)", "plan_id": plan_activity.id, "company_id": self.company.id})
        btp = Analytic.create({"name": "BTP (vigilance)", "plan_id": plan_activity.id, "company_id": self.company.id})
        center = Analytic.create({"name": "Atelier (vigilance)", "plan_id": plan_center.id, "company_id": self.company.id,
                                  "eguitra_activity_id": transport.id})
        bill = self.make_invoice("in_invoice", 3_000_000, post=False)
        bill.invoice_line_ids.analytic_distribution = {str(center.id): 100, str(btp.id): 100}
        bill.with_context(eguitra_approval_granted=True).action_post()
        close = self.env["eguitra.period.close"]._get(self.company, self.today.replace(day=1))
        checks = {c["code"]: c for c in close._run_controls()}
        self.assertEqual(checks["analytic_consistency"]["status"], "warning")
        self.assertEqual(checks["analytic_consistency"]["count"], 1)
        self.assertIn("Atelier (vigilance)", checks["analytic_consistency"]["detail"])
