import io

from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestFinanceApi(FinanceDataMixin, ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("fatou", "finance")
        cls._create_user("ibrahima", "exploitation")

    def setUp(self):
        super().setUp()
        self.token = self.open_session("fatou")["access_token"]

    def test_profil_exploitation_sans_tableau_de_bord(self):
        token = self.open_session("ibrahima")["access_token"]
        status, _b = self.call("GET", "/finance/dashboard", token=token)
        self.assertEqual(status, 403)

    def test_facture_de_vente_complete(self):
        status, move = self.call("POST", "/finance/moves", {
            "move_type": "out_invoice",
            "partner_id": self.customer.id,
            "lines": [{"name": "Transport gasoil Conakry - Kankan", "quantity": 2, "price_unit": 150_000_000,
                       "account_id": self.acc_services.id}],
        }, token=self.token)
        self.assertEqual(status, 200, move)
        self.assertEqual(move["state"], "draft")
        self.assertEqual(move["amount_untaxed"], 300_000_000)
        self.assertEqual(move["amount_total"], 354_000_000, "TVA 18 % appliquée par défaut")

        status, posted = self.call("POST", f"/finance/moves/{move['id']}/post", token=self.token)
        self.assertEqual(status, 200, posted)
        self.assertEqual(posted["state"], "posted")
        self.assertTrue(posted["name"])

        status, paid = self.call("POST", f"/finance/moves/{move['id']}/payments", {
            "journal_id": self.bank.id, "amount": 154_000_000,
        }, token=self.token)
        self.assertEqual(status, 200, paid)
        self.assertEqual(paid["payment_state"], "partial")
        self.assertEqual(paid["amount_residual"], 200_000_000)

        status, listing = self.call("GET", "/finance/moves?type=out_invoice", token=self.token)
        self.assertEqual(status, 200)
        self.assertIn(move["id"], [m["id"] for m in listing["items"]])

        status, dashboard = self.call("GET", "/finance/dashboard", token=self.token)
        self.assertEqual(status, 200, dashboard)
        self.assertEqual(dashboard["revenue_month"], 300_000_000)
        self.assertEqual(dashboard["receivables"]["total"], 200_000_000)

    def test_od_desequilibree_refusee(self):
        status, body = self.call("POST", "/finance/moves", {
            "move_type": "entry", "journal_id": self.bank.id,
            "lines": [
                {"account_id": self.acc_purchase.id, "debit": 100},
                {"account_id": self.bank.default_account_id.id, "credit": 90},
            ],
        }, token=self.token)
        self.assertEqual(status, 422)
        self.assertIn("déséquilibrée", body["message"])

    def test_virement_interne_par_585(self):
        status, body = self.call("POST", "/finance/transfers", {
            "from_journal_id": self.bank.id, "to_journal_id": self.cash.id, "amount": 25_000_000,
        }, token=self.token)
        self.assertEqual(status, 200, body)
        self.assertEqual(len(body["moves"]), 2)
        transit = self.env["eguitra.finance.metrics"]._sum_balance(self.company, ["585"], None, self.today)
        self.assertEqual(transit, 0.0, "Le compte de passage est soldé après les deux écritures")
        status, position = self.call("GET", "/finance/treasury", token=self.token)
        balances = {a["journal_id"]: a["balance"] for a in position["accounts"]}
        self.assertEqual(balances[self.cash.id], 25_000_000)

    def test_caisse_et_rapprochement(self):
        invoice = self.make_invoice("out_invoice", 100_000_000)
        status, line = self.call("POST", f"/finance/treasury/{self.bank.id}/lines", {
            "label": f"VIR TOTAL {invoice.name}", "amount": 118_000_000, "partner_id": self.customer.id,
        }, token=self.token)
        self.assertEqual(status, 200, line)
        self.assertFalse(line["reconciled"])

        status, candidates = self.call("GET", f"/finance/treasury/lines/{line['id']}/candidates", token=self.token)
        self.assertEqual(status, 200)
        self.assertEqual(candidates[0]["move_id"], invoice.id, "La facture citée et au bon montant vient en tête")

        status, done = self.call("POST", f"/finance/treasury/lines/{line['id']}/reconcile",
                                 {"move_line_ids": [candidates[0]["id"]]}, token=self.token)
        self.assertEqual(status, 200, done)
        self.assertTrue(done["reconciled"])
        self.assertEqual(invoice.payment_state, "paid")

        status, fee = self.call("POST", f"/finance/treasury/{self.cash.id}/lines", {
            "label": "Frais de mission", "amount": -1_500_000, "counterpart_account_id": self.acc_purchase.id,
        }, token=self.token)
        self.assertEqual(status, 200, fee)
        self.assertTrue(fee["reconciled"], "Une opération imputée directement est soldée")

    def test_import_releve_csv(self):
        content = (
            "Date;Libellé;Débit;Crédit\n"
            "02/10/2026;VIREMENT RECU TOTAL;;118 000 000\n"
            "03/10/2026;FRAIS DE TENUE DE COMPTE;25 000,00;\n"
        ).encode()
        response = self.url_open(
            f"/api/v1/finance/treasury/{self.bank.id}/import",
            files={"file": ("releve.csv", io.BytesIO(content), "text/csv")},
            headers={"Authorization": f"Bearer {self.token}"},
            method="POST",
            timeout=60,
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["created"], 2)
        response = self.url_open(
            f"/api/v1/finance/treasury/{self.bank.id}/import",
            files={"file": ("releve.csv", io.BytesIO(content), "text/csv")},
            headers={"Authorization": f"Bearer {self.token}"},
            method="POST",
            timeout=60,
        )
        self.assertEqual(response.json()["skipped_duplicates"], 2, "Un relevé importé deux fois n'est pas dupliqué")

    def test_rapports_et_export(self):
        self.make_invoice("out_invoice", 70_000_000)
        status, catalog = self.call("GET", "/finance/reports/catalog", token=self.token)
        self.assertEqual(status, 200)
        keys = {r["key"] for g in catalog["groups"] for r in g["reports"]}
        self.assertTrue({"grand_livre", "balance", "ventes", "tva"} <= keys)
        status, result = self.call("POST", "/finance/reports/run", {"report": "ventes", "period": "month"}, token=self.token)
        self.assertEqual(status, 200, result)
        self.assertEqual(result["totals"]["ht"], 70_000_000)
        response = self.url_open("/api/v1/finance/reports/export", json={"report": "balance", "format": "xlsx"},
                                 headers={"Authorization": f"Bearer {self.token}"}, method="POST", timeout=60)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"PK"))

    def test_etats_et_tva(self):
        self.make_invoice("out_invoice", 100_000_000)
        self.make_invoice("in_invoice", 40_000_000)
        status, vat = self.call("GET", f"/finance/fiscal/vat?year={self.today.year}&month={self.today.month}",
                                token=self.token)
        self.assertEqual(status, 200, vat)
        self.assertEqual(vat["vat_collected"], 18_000_000)
        self.assertEqual(vat["vat_deductible"], 7_200_000)
        self.assertEqual(vat["vat_due"], 10_800_000)
        status, sheet = self.call("GET", "/finance/statements/balance-sheet", token=self.token)
        self.assertEqual(status, 200)
        self.assertEqual(sheet["difference"], 0)
        status, ifrs = self.call("GET", "/finance/ifrs", token=self.token)
        self.assertEqual(status, 200)
        self.assertTrue(ifrs["lines"])

    def test_cloture_par_api(self):
        status, registry = self.call("GET", f"/finance/closing?year={self.today.year}", token=self.token)
        self.assertEqual(status, 200)
        self.assertEqual(len(registry["months"]), 12)
        status, check = self.call("POST", "/finance/closing/check",
                                  {"period": self.today.replace(day=1).isoformat()}, token=self.token)
        self.assertEqual(status, 200, check)
        self.assertIn("checks", check)

    def test_budget(self):
        status, budget = self.call("POST", "/finance/budgets", {"name": "Budget 2026", "year": self.today.year},
                                   token=self.token)
        self.assertEqual(status, 200, budget)
        status, _b = self.call("POST", f"/finance/budgets/{budget['id']}/lines", {
            "account_id": self.acc_purchase.id, "month": self.today.month, "amount": 100_000_000,
        }, token=self.token)
        self.assertEqual(status, 200)
        self.make_invoice("in_invoice", 150_000_000)
        status, compare = self.call("GET", f"/finance/budgets/{budget['id']}/compare?month={self.today.month}",
                                    token=self.token)
        self.assertEqual(status, 200, compare)
        line = next(l for l in compare["lines"] if l["account_id"] == self.acc_purchase.id)
        self.assertEqual(line["budget"], 100_000_000)
        self.assertEqual(line["actual"], 150_000_000)
        self.assertTrue(line["alert"], "Dépassement de 50 % au-delà du seuil de 10 %")
