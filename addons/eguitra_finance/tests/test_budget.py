import io

from odoo import Command
from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin


def _account(env, company, prefix):
    return env["account.account"].search([("code", "=like", prefix + "%"), ("company_ids", "in", company.ids)],
                                         order="code", limit=1)


@tagged("post_install", "-at_install")
class TestBudgetLines(FinanceDataMixin, TransactionCase):
    """Lignes budgétaires : réalisé par préfixe, affectation analytique, solde résiduel, statuts."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        env = cls.env
        plan_activity = env.ref("eguitra_base.analytic_plan_activite")
        plan_center = env.ref("eguitra_base.analytic_plan_centre_cout")
        Analytic = env["account.analytic.account"]
        cls.transport = Analytic.create({"name": "Transport (budget)", "plan_id": plan_activity.id, "company_id": cls.company.id})
        cls.btp = Analytic.create({"name": "BTP (budget)", "plan_id": plan_activity.id, "company_id": cls.company.id})
        cls.center = Analytic.create({"name": "Parc (budget)", "plan_id": plan_center.id, "company_id": cls.company.id,
                                      "eguitra_activity_id": cls.transport.id})
        cls.budget = env["mis.budget.by.account"].create({
            "name": "Budget test", "date_from": cls.today.replace(month=1, day=1),
            "date_to": cls.today.replace(month=12, day=31), "company_id": cls.company.id,
        })
        month = f"amount_{cls.today.month:02d}"
        Line = env["eguitra.budget.line"]
        cls.income = Line.create({"budget_id": cls.budget.id, "nature": "income", "name": "Prestations de transport",
                                  "account_prefixes": "706", "activity_id": cls.transport.id, month: 100_000_000})
        cls.energy = Line.create({"budget_id": cls.budget.id, "nature": "expense", "name": "Énergie",
                                  "account_prefixes": "6052", month: 10_000_000})
        cls.other = Line.create({"budget_id": cls.budget.id, "nature": "expense", "name": "Autres charges",
                                 "residual": True, month: 1_000_000})
        cls.capex = Line.create({"budget_id": cls.budget.id, "nature": "capex", "name": "Matériel de transport",
                                 "account_prefixes": "24", month: 50_000_000})

        def invoice(move_type, amount, dist=None, account=None):
            move = cls.make_invoice(move_type, amount, post=False)
            line = move.invoice_line_ids
            if account:
                line.account_id = account
            if dist:
                line.analytic_distribution = dist
            move.with_context(eguitra_approval_granted=True).action_post()
            return move

        invoice("out_invoice", 120_000_000, {str(cls.transport.id): 100})
        invoice("out_invoice", 30_000_000, {str(cls.btp.id): 100})
        invoice("in_invoice", 15_000_000)
        invoice("in_invoice", 2_000_000, account=_account(env, cls.company, "624"))
        equipment = _account(env, cls.company, "24")
        opening = env["account.journal"].create({"name": "À-nouveaux", "code": "AN", "type": "general",
                                                 "company_id": cls.company.id})
        for journal, amount in ((cls.bank, 40_000_000), (opening, 900_000_000)):
            env["account.move"].create({
                "move_type": "entry", "journal_id": journal.id, "date": cls.today,
                "line_ids": [Command.create({"name": "Camion", "account_id": equipment.id, "debit": amount}),
                             Command.create({"name": "Camion", "account_id": cls.bank.default_account_id.id,
                                             "credit": amount})],
            }).action_post()

    def test_realise_et_statuts(self):
        data = self.env["eguitra.budget.line"].execution(self.budget, self.today.month)
        rows = {r["id"]: r for r in data["lines"]}
        self.assertEqual(rows[self.income.id]["actual"], 120_000_000, "Seule la part de l'activité Transport compte")
        self.assertEqual(rows[self.income.id]["status"], "conforme")
        self.assertEqual(rows[self.energy.id]["actual"], 15_000_000)
        self.assertEqual(rows[self.energy.id]["status"], "depassement", "+50 % au-delà du seuil de 10 %")
        self.assertEqual(rows[self.other.id]["actual"], 2_000_000, "Charges non couvertes par les autres lignes")
        self.assertEqual(rows[self.capex.id]["actual"], 40_000_000, "Investissements hors à-nouveaux")
        self.assertEqual(rows[self.capex.id]["status"], "conforme")
        summary = data["summary"]
        self.assertEqual(summary["income_budget"], 100_000_000)
        self.assertEqual((summary["overrun_lines"], summary["expense_lines"]), (2, 2))
        overruns = self.env["eguitra.budget.line"].overruns(self.company, self.today)
        self.assertEqual({r["id"] for r in overruns}, {self.energy.id, self.other.id})

    def test_comparaison_par_axe(self):
        data = self.env["eguitra.budget.line"].execution(self.budget, self.today.month, axis="activite")
        groups = {g["analytic_account_id"]: g for g in data["by_axis"]}
        self.assertEqual(groups[self.transport.id]["income_actual"], 120_000_000)
        self.assertEqual(groups[None]["expense_budget"], 11_000_000, "Lignes sans activité : non affectées")

    def test_sous_realisation_des_produits(self):
        self.budget.eguitra_underrun_pct = 5
        month = f"amount_{self.today.month:02d}"
        self.income[month] = 200_000_000
        row = next(r for r in self.env["eguitra.budget.line"].execution(self.budget, self.today.month)["lines"]
                   if r["id"] == self.income.id)
        self.assertEqual(row["status"], "sous_realisation", "120 M réalisés pour 200 M budgétés")

    def test_lignes_incoherentes_refusees(self):
        Line = self.env["eguitra.budget.line"]
        with self.assertRaises(ValidationError):
            Line.create({"budget_id": self.budget.id, "nature": "income", "name": "Mauvais", "account_prefixes": "60"})
        with self.assertRaises(ValidationError):
            Line.create({"budget_id": self.budget.id, "nature": "expense", "name": "Sans comptes"})
        with self.assertRaises(ValidationError):
            Line.create({"budget_id": self.budget.id, "nature": "expense", "name": "Second résiduel", "residual": True})
        with self.assertRaises(ValidationError):
            Line.create({"budget_id": self.budget.id, "nature": "expense", "name": "Axe", "account_prefixes": "61",
                         "activity_id": self.center.id})


@tagged("post_install", "-at_install")
class TestBudgetApi(FinanceDataMixin, ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("fatou", "finance")
        plan = cls.env.ref("eguitra_base.analytic_plan_activite")
        cls.activity = cls.env["account.analytic.account"].create(
            {"name": "Immobilier (budget)", "code": "IMMO", "plan_id": plan.id, "company_id": cls.company.id})

    def setUp(self):
        super().setUp()
        self.token = self.open_session("fatou")["access_token"]
        status, self.budget = self.call("POST", "/finance/budgets", {"name": "Budget API", "year": self.today.year},
                                        token=self.token)
        self.assertEqual(status, 200, self.budget)

    def _import(self, text, **form):
        response = self.url_open(f"/api/v1/finance/budgets/{self.budget['id']}/import", data=form,
                                 files={"file": ("budget.csv", io.BytesIO(text.encode()), "text/csv")},
                                 headers={"Authorization": f"Bearer {self.token}"}, method="POST", timeout=60)
        return response.status_code, response.json()

    def test_saisie_et_execution(self):
        months = [0] * 12
        months[self.today.month - 1] = 100_000_000
        status, line = self.call("POST", f"/finance/budgets/{self.budget['id']}/budget-lines", {
            "nature": "expense", "name": "Achats", "account_prefixes": "60; 61", "months": months,
        }, token=self.token)
        self.assertEqual(status, 200, line)
        self.assertEqual(line["account_prefixes"], "60, 61")
        self.make_invoice("in_invoice", 150_000_000)
        status, data = self.call("GET", f"/finance/budgets/{self.budget['id']}/execution?month={self.today.month}",
                                 token=self.token)
        self.assertEqual(status, 200, data)
        row = data["lines"][0]
        self.assertEqual((row["budget"], row["actual"], row["status"]), (100_000_000, 150_000_000, "depassement"))
        status, body = self.call("POST", f"/finance/budgets/{self.budget['id']}/budget-lines", {
            "nature": "income", "name": "Ventes", "account_prefixes": "60"}, token=self.token)
        self.assertEqual(status, 422, "Un produit se budgète sur la classe 7")
        status, _b = self.call("DELETE", f"/finance/budget-lines/{line['id']}", token=self.token)
        self.assertEqual(status, 200)

    def test_import_et_export(self):
        header = "nature;ligne;comptes;residuel;activite;centre_cout;janv;fevr;mars;avr;mai;juin;juil;aout;sept;oct;nov;dec\n"
        status, body = self._import(header + "Produits;Loyers;706;;Inconnue;;1;1;1;1;1;1;1;1;1;1;1;1\n")
        self.assertEqual(status, 422, body)
        self.assertIn("Inconnue", body["errors"][0])
        text = (header + "Produits;Loyers;706;;IMMO;;10 000 000;10 000 000;;;;;;;;;;\n"
                "Charges;Autres charges;;oui;;;500 000;500 000;;;;;;;;;;\n")
        status, body = self._import(text)
        self.assertEqual(status, 200, body)
        self.assertEqual((body["created"], body["updated"]), (2, 0))
        status, body = self._import(text)
        self.assertEqual((body["created"], body["updated"]), (0, 2), "Réimport : lignes mises à jour, pas doublées")
        status, lines = self.call("GET", f"/finance/budgets/{self.budget['id']}/budget-lines", token=self.token)
        loyers = next(l for l in lines["lines"] if l["name"] == "Loyers")
        self.assertEqual(loyers["activity"]["id"], self.activity.id)
        self.assertEqual(loyers["annual"], 20_000_000)
        response = self.url_open(f"/api/v1/finance/budgets/{self.budget['id']}/export",
                                 headers={"Authorization": f"Bearer {self.token}"}, timeout=60)
        self.assertEqual(response.status_code, 200)
        self.assertMilliersGroupes(response.content)
