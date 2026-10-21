import importlib.util
import os
from datetime import date

from odoo.exceptions import UserError
from odoo.modules.module import get_module_path
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_finance.controllers.assets import _years
from odoo.addons.eguitra_finance.models.account_asset import TAKEOVER_GAP_PARAM

from .common import FinanceDataMixin

VALUE = 1_200_000_000  # sur 10 ans : 10 000 000 par mois
MONTHLY = 10_000_000


@tagged("post_install", "-at_install")
class TestTakeoverConventions(FinanceDataMixin, TransactionCase):
    """Reprise d'un bien déjà en service selon les trois conventions d'amortissement soumises à
    l'expert-comptable : écart de reprise rattrapé sur la première dotation de l'exercice
    (plateforme), reporté sur la dernière dotation du plan (fin de plan), ou plan en mois entiers de
    l'ancien système (prototype, permanence des méthodes)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()

        def account(prefix):
            return cls.env["account.account"].search(
                [("code", "=like", prefix + "%"), ("company_ids", "in", cls.company.ids)], limit=1, order="code")

        journal = cls.env["account.journal"].search([("company_id", "=", cls.company.id), ("type", "=", "general")],
                                                    limit=1)
        cls.profile = cls.env["account.asset.profile"].create({
            "name": "Matériel de transport DEMO, 10 ans", "account_asset_id": account("2451").id,
            "account_depreciation_id": account("2845").id, "account_expense_depreciation_id": account("6813").id,
            "journal_id": journal.id, "method": "linear", "method_number": 10, "method_time": "year",
            "method_period": "month", "prorata": True, "company_id": cls.company.id,
        })
        cls.opening = date(cls.today.year, 1, 1)
        # Acquis un 15 juin, trois exercices plus tôt : l'ancien système amortit en mois entiers à compter
        # de juillet, soit 30 mois au 31 décembre dernier.
        cls.acquired = date(cls.today.year - 3, 6, 15)
        cls.accumulated = 30 * MONTHLY

    def _asset(self, name, **values):
        asset = self.env["account.asset"].create(dict({
            "name": name, "profile_id": self.profile.id, "purchase_value": VALUE, "date_start": self.acquired,
            "company_id": self.company.id,
        }, **values))
        asset.compute_depreciation_board()
        return asset

    @staticmethod
    def _board(asset):
        """Lignes de reprise et dotations à venir, dans l'ordre des dates."""
        lines = asset.depreciation_line_ids.filtered(lambda line: line.type == "depreciate").sorted("line_date")
        return lines.filtered("init_entry"), lines.filtered(lambda line: not line.init_entry and not line.move_check)

    def test_ecart_rattrape_sur_la_premiere_dotation(self):
        asset = self._asset("Citerne DEMO, première dotation")
        theoretical = sum(asset.depreciation_line_ids.filtered(
            lambda line: line.type == "depreciate" and line.line_date < self.opening).mapped("amount"))
        result = asset.eguitra_takeover(self.opening, self.accumulated, "first")
        taken, upcoming = self._board(asset)
        self.assertEqual(asset.eguitra_takeover_gap, "first")
        self.assertAlmostEqual(sum(taken.mapped("amount")), self.accumulated, delta=1, msg="Cumul repris")
        self.assertAlmostEqual(result["difference"], self.accumulated - theoretical, delta=1)
        self.assertLess(result["difference"], 0, "Prorata au jour : le plan théorique dépasse les mois entiers")
        self.assertEqual(upcoming[0].line_date, date(self.opening.year, 1, 31))
        self.assertAlmostEqual(upcoming[0].amount, MONTHLY - result["difference"], delta=1,
                               msg="Rattrapage de l'écart sur la première dotation de l'exercice")
        self.assertAlmostEqual(result["first_depreciation"], upcoming[0].amount, delta=1)
        self.assertAlmostEqual(self.accumulated + sum(upcoming.mapped("amount")), VALUE, delta=1)

    def test_ecart_reporte_sur_la_derniere_dotation(self):
        witness = self._asset("Citerne DEMO, témoin première dotation")
        witness.eguitra_takeover(self.opening, self.accumulated, "first")
        _taken, witness_lines = self._board(witness)
        asset = self._asset("Citerne DEMO, fin de plan")
        result = asset.eguitra_takeover(self.opening, self.accumulated, "last")
        taken, upcoming = self._board(asset)
        self.assertEqual(asset.eguitra_takeover_gap, "last")
        self.assertAlmostEqual(sum(taken.mapped("amount")), self.accumulated, delta=1, msg="Cumul repris")
        self.assertAlmostEqual(upcoming[0].amount, MONTHLY, delta=1, msg="Première dotation selon le plan théorique")
        self.assertEqual(upcoming[-1].line_date, witness_lines[-1].line_date)
        self.assertAlmostEqual(upcoming[-1].amount, witness_lines[-1].amount - result["difference"], delta=1,
                               msg="Écart de reprise porté sur la dernière dotation du plan")
        self.assertAlmostEqual(result["last_depreciation"], upcoming[-1].amount, delta=1)
        self.assertAlmostEqual(self.accumulated + sum(upcoming.mapped("amount")), VALUE, delta=1)

        # La règle tient au recalcul du plan, avant comme après la comptabilisation d'une dotation.
        asset.validate()
        asset.compute_depreciation_board()
        self.assertAlmostEqual(self._board(asset)[1][0].amount, MONTHLY, delta=1)
        asset._compute_entries(date(self.opening.year, 1, 31))
        posted = asset.depreciation_line_ids.filtered("move_check")
        self.assertEqual(len(posted), 1)
        self.assertAlmostEqual(posted.amount, MONTHLY, delta=1, msg="Dotation de janvier sans rattrapage")
        asset.compute_depreciation_board()
        _taken, upcoming = self._board(asset)
        self.assertAlmostEqual(upcoming[0].amount, MONTHLY, delta=1)
        self.assertAlmostEqual(upcoming[-1].amount, witness_lines[-1].amount - result["difference"], delta=1)

    def test_regle_par_parametre_systeme(self):
        self.env["ir.config_parameter"].sudo().set_param(TAKEOVER_GAP_PARAM, "last")
        asset = self._asset("Citerne DEMO, règle du paramètre")
        asset.eguitra_takeover(self.opening, self.accumulated)
        self.assertEqual(asset.eguitra_takeover_gap, "last")
        other = self._asset("Citerne DEMO, règle inconnue")
        with self.assertRaises(UserError):
            other.eguitra_takeover(self.opening, self.accumulated, "milieu")

    def test_mois_entiers_de_l_ancien_systeme(self):
        values = self.env["account.asset"].eguitra_whole_months_plan(self.acquired, 10)
        self.assertEqual(values["date_start"], date(self.acquired.year, 7, 1), "1er du mois qui suit l'acquisition")
        asset = self._asset("Citerne DEMO, mois entiers", **values)
        lines = asset.depreciation_line_ids.filtered(lambda line: line.type == "depreciate").sorted("line_date")
        self.assertEqual(len(lines), 120)
        self.assertEqual(set(lines.mapped("amount")), {MONTHLY}, "120 dotations mensuelles égales")
        self.assertEqual(lines[0].line_date, date(self.acquired.year, 7, 31))
        self.assertEqual(lines[-1].line_date, date(self.acquired.year + 10, 6, 30))
        result = asset.eguitra_takeover(self.opening, self.accumulated)
        self.assertEqual(result["difference"], 0, "Cumul repris égal au plan théorique : aucun rattrapage")
        taken, upcoming = self._board(asset)
        self.assertEqual(len(taken), 30)
        self.assertEqual(set(upcoming.mapped("amount")), {MONTHLY})
        self.assertEqual(asset.eguitra_months_total, 120)
        self.assertEqual(_years(asset), 10, "Durée affichée en années")
        self.assertIn(f"{self.acquired:%d/%m/%Y}", asset.note, "Date d'acquisition gardée sur la fiche")
        self.assertEqual(self.profile.method_time, "year", "La catégorie garde sa durée en années")

    def test_mois_entiers_bien_acquis_dans_l_exercice(self):
        acquired = date(self.opening.year, 3, 5)
        asset = self._asset("Citerne DEMO acquise dans l'exercice",
                            **self.env["account.asset"].eguitra_whole_months_plan(acquired, 10))
        lines = asset.depreciation_line_ids.filtered(lambda line: line.type == "depreciate").sorted("line_date")
        self.assertEqual(lines[0].line_date, date(self.opening.year, 4, 30), "Rien sur le mois d'acquisition")
        self.assertEqual(lines[0].amount, MONTHLY, "Mois entier, sans prorata")

    def test_migration_regle_des_biens_deja_repris(self):
        """La migration 19.0.1.6.0 inscrit la règle « first » sur les biens repris avant elle."""
        asset = self._asset("Citerne DEMO reprise avant la migration")
        asset.eguitra_takeover(self.opening, self.accumulated, "first")
        asset.eguitra_takeover_gap = False
        path = os.path.join(get_module_path("eguitra_finance"), "migrations", "19.0.1.6.0", "post-migrate.py")
        spec = importlib.util.spec_from_file_location("eguitra_finance_migration_19_0_1_6_0", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        migration.migrate(self.env.cr, "19.0.1.5.0")
        asset.invalidate_recordset()
        self.assertEqual(asset.eguitra_takeover_gap, "first")
