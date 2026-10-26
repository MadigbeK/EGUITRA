from datetime import timedelta

from odoo import Command
from odoo.tests import TransactionCase, tagged

from ..formats import accord, pluriel
from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestPilotageDefinitions(FinanceDataMixin, TransactionCase):
    """Indicateurs du pilotage : ventes et achats TTC lus sur les comptes de tiers des journaux de vente et
    d'achat (écritures reprises comprises), retards sur les seuls restes dus de même sens, budget aligné
    sur l'écran Budget, perte attendue nette de la dépréciation passée, tâches planifiées gardées."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.metrics = cls.env["eguitra.finance.metrics"]
        cls.month = cls.today.replace(day=1)

    def _account(self, prefix):
        return self.env["account.account"].search(
            [("code", "=like", prefix + "%"), ("company_ids", "in", self.company.ids)], limit=1, order="code")

    def _journal(self, kind):
        return self.env["account.journal"].search([("company_id", "=", self.company.id), ("type", "=", kind)], limit=1)

    def _entry(self, journal, lines, day=None):
        move = self.env["account.move"].create({
            "move_type": "entry", "journal_id": journal.id, "date": day or self.today,
            "line_ids": [Command.create({"name": "Reprise", "account_id": account.id, "debit": debit, "credit": credit,
                                         "partner_id": partner.id if partner else False})
                         for account, debit, credit, partner in lines],
        })
        move.action_post()
        return move

    def test_ventes_et_achats_repris_dans_les_delais(self):
        """Écritures de la reprise (pièces « entry » des journaux de vente et d'achat) : elles comptent dans
        les ventes et les achats TTC, donc dans le DSO, le DPO et le BFR en jours ; une OD sur un compte
        client hors journal de vente n'est pas une vente."""
        receivable = self.customer.property_account_receivable_id
        payable = self.supplier.property_account_payable_id
        self._entry(self._journal("sale"), [(receivable, 236_000_000, 0, self.customer),
                                            (self.acc_services, 0, 200_000_000, None),
                                            (self._account("443"), 0, 36_000_000, None)])
        self._entry(self._journal("purchase"), [(self.acc_purchase, 100_000_000, 0, None),
                                                (self._account("445"), 18_000_000, 0, None),
                                                (payable, 0, 118_000_000, self.supplier)])
        self._entry(self._journal("general"), [(receivable, 50_000_000, 0, self.customer),
                                               (self.acc_loan, 0, 50_000_000, None)])
        self.make_invoice("out_invoice", 100_000_000)  # 118 M TTC
        self.make_invoice("out_refund", 10_000_000)  # 11,8 M TTC en déduction
        sales = self.metrics._invoiced_ttc(self.company, "sale", self.month, self.today)
        purchases = self.metrics._invoiced_ttc(self.company, "purchase", self.month, self.today)
        self.assertAlmostEqual(sales, 236_000_000 + 118_000_000 - 11_800_000, places=0)
        self.assertAlmostEqual(purchases, 118_000_000, places=0)
        wc = self.metrics.working_capital(self.company, self.month, self.today)
        self.assertAlmostEqual(wc["sales_ttc"], sales, places=0)
        self.assertIsNotNone(wc["dso"])

    def test_avoir_non_impute_ni_retard_ni_contentieux(self):
        old = self.today - timedelta(days=120)
        self.make_invoice("out_refund", 10_000_000, day=old, due=old)
        row = next(r for r in self.metrics.partner_aging(self.company, "asset_receivable", self.today)
                   if r["partner_id"] == self.customer.id)
        self.assertAlmostEqual(row["total"], -11_800_000, msg="L'encours reste net des avoirs")
        self.assertEqual((row["overdue"], row["max_late_days"], row["status"]), (0, 0, "a_jour"),
                         "Un avoir non imputé ne met pas le client en contentieux")
        Threshold = self.env["eguitra.alert.threshold"]
        Threshold.ensure_defaults(self.company)
        keys = {a["key"] for a in Threshold.active_alerts(self.company, self.today)}
        self.assertNotIn("receivable_overdue_days", keys, "Ni une créance ancienne")
        self.make_invoice("out_invoice", 10_000_000, day=old, due=old)
        keys = {a["key"] for a in Threshold.active_alerts(self.company, self.today)}
        self.assertIn("receivable_overdue_days", keys, "Une facture échue de 120 jours l'est")

    def test_budget_du_tableau_de_bord_comme_l_ecran_budget(self):
        Budget = self.env["mis.budget.by.account"]
        Budget.search([]).write({"state": "cancelled"})  # budgets éventuels des données de démonstration
        fy_start, fy_end = self.metrics.fiscal_year_bounds(self.company, self.today)
        budget = Budget.create({"name": "Budget de l'exercice", "date_from": fy_start, "date_to": fy_end,
                                "company_id": self.company.id})
        month = f"amount_{self.today.month:02d}"
        Line = self.env["eguitra.budget.line"]
        unbudgeted = Line.create({"budget_id": budget.id, "nature": "expense", "name": "Achats", "account_prefixes": "60"})
        Line.create({"budget_id": budget.id, "nature": "capex", "name": "Camions", "account_prefixes": "24",
                     month: 300_000_000})
        self.make_invoice("in_invoice", 50_000_000)
        status = self.metrics.budget_status(self.company, self.today)
        self.assertAlmostEqual(status["expenses"]["budget"], 0, msg="Les investissements ne sont pas des charges")
        self.assertAlmostEqual(status["investments"]["budget"], 300_000_000)
        rows = {r["name"]: r for r in status["lines"]}
        self.assertEqual(rows["Camions"]["kind"], "investissement")
        self.assertEqual(rows["Achats"]["status"], "non_budgete")
        self.assertIn("Achats", [r["name"] for r in status["overruns"]],
                      "Charges non budgétées en alerte, comme à l'écran Budget")
        self.assertTrue(unbudgeted)

    def test_perte_attendue_nette_de_la_depreciation_passee(self):
        self.make_invoice("out_invoice", 100_000_000, day=self.today - timedelta(days=120),
                          due=self.today - timedelta(days=100))
        self._entry(self._journal("general"), [(self._account("659"), 10_000_000, 0, None),
                                               (self._account("491"), 0, 10_000_000, None)])
        loss = self.metrics.expected_credit_loss(self.company, self.today)
        self.assertAlmostEqual(loss["existing_impairment"], 10_000_000)
        self.assertAlmostEqual(loss["adjustment"], loss["total"] - 10_000_000,
                               msg="Le résultat porte déjà la dépréciation passée : seul l'écart reste à déduire")

    def test_textes_accordes_au_nombre(self):
        self.assertEqual(pluriel(1, "rotation"), "1 rotation")
        self.assertEqual(pluriel(3, "rotation"), "3 rotations")
        self.assertEqual(accord(0, "critique"), "critique")
        self.assertEqual(accord(2, "attend sa facture", "attendent leur facture"), "attendent leur facture")

    def test_taches_planifiees_gardees_a_la_mise_a_jour(self):
        records = self.env["ir.model.data"].search([
            ("module", "=", "eguitra_finance"), ("name", "in", ["cron_asset_depreciation", "cron_reminders"])])
        self.assertEqual(len(records), 2)
        self.assertTrue(all(records.mapped("noupdate")), "Une tâche suspendue ne repart pas au premier -u")
