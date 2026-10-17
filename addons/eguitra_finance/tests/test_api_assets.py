import importlib.util
import os
from datetime import date

from odoo import Command
from odoo.modules.module import get_module_path
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestAssetsApi(FinanceDataMixin, ApiCase):
    """Immobilisations par l'API : dotations mensuelles par défaut, reprise des biens en service,
    biens non amortissables, registre."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("kadiatou", "finance")

        def account(prefix):
            return cls.env["account.account"].search(
                [("code", "=like", prefix + "%"), ("company_ids", "in", cls.company.ids)], limit=1, order="code")

        cls.acc_asset, cls.acc_dep, cls.acc_exp = account("2451"), account("2845"), account("6813")
        cls.acc_capital = account("101")
        cls.journal = cls.env["account.journal"].search(
            [("company_id", "=", cls.company.id), ("type", "=", "general")], limit=1)
        cls.opening = date(cls.today.year, 1, 1)

    def setUp(self):
        super().setUp()
        self.token = self.open_session("kadiatou")["access_token"]

    def _profile(self, **extra):
        payload = {
            "name": "Matériel de transport, 5 ans", "account_asset_id": self.acc_asset.id,
            "account_depreciation_id": self.acc_dep.id, "account_expense_depreciation_id": self.acc_exp.id,
            "journal_id": self.journal.id, "method_number": 5,
        }
        payload.update(extra)
        status, body = self.call("POST", "/finance/assets/profiles", payload, token=self.token)
        self.assertEqual(status, 200, body)
        return self.env["account.asset.profile"].browse(body["id"])

    def test_dotations_mensuelles_par_defaut(self):
        """Une catégorie créée sans périodicité amortit par dotations mensuelles : 12 par an."""
        profile = self._profile()
        self.assertEqual(profile.method_period, "month")
        self.assertTrue(profile.prorata, "Prorata à partir de la mise en service")
        status, asset = self.call("POST", "/finance/assets", {
            "name": "Citerne DEMO 40 000 L", "profile_id": profile.id, "purchase_value": 600_000_000,
            "date_start": self.opening.isoformat(), "confirm": True,
        }, token=self.token)
        self.assertEqual(status, 200, asset)
        self.assertEqual(asset["method_period"], "month")
        year = [line for line in asset["board"]
                if line["type"] == "depreciate" and line["date"].startswith(str(self.opening.year))]
        self.assertEqual(len(year), 12, "Douze dotations la première année")
        self.assertAlmostEqual(sum(line["amount"] for line in year), 120_000_000, delta=1_000)
        self.assertEqual(asset["months_total"], 60)
        status, profiles = self.call("GET", "/finance/assets/profiles", token=self.token)
        self.assertEqual(next(p for p in profiles if p["id"] == profile.id)["period_label"], "mensuelles")

    def test_periodicite_choisie(self):
        profile = self._profile(name="Mobilier, 10 ans", method_number=10, method_period="year")
        self.assertEqual(profile.method_period, "year")
        status, body = self.call("POST", "/finance/assets/profiles", {
            "name": "Erreur", "account_asset_id": self.acc_asset.id, "account_depreciation_id": self.acc_dep.id,
            "account_expense_depreciation_id": self.acc_exp.id, "journal_id": self.journal.id, "method_number": 5,
            "method_period": "week",
        }, token=self.token)
        self.assertEqual(status, 400, body)

    def test_reprise_d_un_bien_en_service(self):
        profile = self._profile()
        start = date(self.today.year - 2, 7, 1)
        payload = {"name": "Tracteur DEMO repris", "code": "IMMO-DEMO-1", "profile_id": profile.id,
                   "purchase_value": 600_000_000, "date_start": start.isoformat(), "confirm": True,
                   "location": "Parc de Kaloum", "custodian": "Chef de parc"}
        status, body = self.call("POST", "/finance/assets", payload, token=self.token)
        self.assertEqual(status, 422, "Un bien déjà en service exige le cumul de ses amortissements")
        self.assertIn("cumul", body["message"])

        status, asset = self.call("POST", "/finance/assets", dict(payload, accumulated_depreciation=175_000_000),
                                  token=self.token)
        self.assertEqual(status, 200, asset)
        record = self.env["account.asset"].browse(asset["id"])
        takeover = record.depreciation_line_ids.filtered("init_entry")
        self.assertTrue(takeover)
        self.assertTrue(all(line.line_date < self.opening for line in takeover), "Reprise : lignes antérieures à l'ouverture")
        self.assertFalse(takeover.move_id, "Les lignes de reprise ne produisent aucune écriture")
        self.assertAlmostEqual(sum(takeover.mapped("amount")), 175_000_000, delta=1)
        self.assertAlmostEqual(record.value_depreciated, 175_000_000, delta=1)
        self.assertEqual(record.eguitra_takeover_date, self.opening)
        depreciations = record.depreciation_line_ids.filtered(lambda line: line.type == "depreciate")
        self.assertAlmostEqual(sum(depreciations.mapped("amount")), 600_000_000, delta=5,
                               msg="Cumul repris et plan restant couvrent la base amortissable")
        self.assertTrue(all(line.line_date >= self.opening for line in depreciations - takeover))
        self.assertEqual(asset["location"], "Parc de Kaloum")
        self.assertEqual(asset["months_depreciated"], 18, "Juillet de l'avant-dernière année à décembre dernier")

        # Seules les dotations de l'exercice ouvert sont comptabilisées.
        self.env["account.asset"]._eguitra_cron_depreciate()
        self.assertFalse(self.env["account.move.line"].search([("asset_id", "=", record.id), ("date", "<", self.opening)]))

        # Contrôle : cumul du registre face au solde d'ouverture du compte d'amortissement.
        path = f"/finance/assets/takeover-control?opening_date={self.opening.isoformat()}"
        status, control = self.call("GET", path, token=self.token)
        self.assertEqual(status, 200, control)
        row = next(r for r in control["rows"] if r["kind"] == "depreciation" and r["account"] == self.acc_dep.code)
        self.assertAlmostEqual(row["register"], 175_000_000, delta=1)
        self.assertFalse(row["ok"], "Sans à-nouveaux, l'écart est signalé")

        an = self.env["account.journal"].search([("company_id", "=", self.company.id), ("code", "=", "AN")], limit=1)
        an = an or self.env["account.journal"].create({"name": "À-nouveaux", "code": "AN", "type": "general",
                                                       "company_id": self.company.id})
        self.env["account.move"].create({
            "move_type": "entry", "journal_id": an.id, "date": self.opening, "ref": "Soldes d'ouverture DEMO",
            "line_ids": [
                Command.create({"name": "Tracteur", "account_id": self.acc_asset.id, "debit": 600_000_000}),
                Command.create({"name": "Amortissements", "account_id": self.acc_dep.id, "credit": 175_000_000}),
                Command.create({"name": "Capital", "account_id": self.acc_capital.id, "credit": 425_000_000}),
            ],
        }).action_post()
        status, control = self.call("GET", path, token=self.token)
        self.assertTrue(control["has_opening_entry"])
        for row in control["rows"]:
            if row["account"] in (self.acc_dep.code, self.acc_asset.code):
                self.assertTrue(row["ok"], row)

    def test_bien_totalement_amorti_a_la_reprise(self):
        profile = self._profile(name="Matériel informatique, 3 ans", method_number=3)
        status, asset = self.call("POST", "/finance/assets", {
            "name": "Serveur DEMO", "profile_id": profile.id, "purchase_value": 30_000_000,
            "date_start": date(self.today.year - 5, 1, 1).isoformat(), "accumulated_depreciation": 30_000_000,
            "confirm": True,
        }, token=self.token)
        self.assertEqual(status, 200, asset)
        self.assertEqual(asset["state"], "close")
        self.assertFalse([line for line in asset["board"] if line["type"] == "depreciate" and not line["takeover"]],
                         "Plus aucune dotation à venir")

    def test_terrain_non_amortissable_et_registre(self):
        profile = self._profile(name="Terrains", non_depreciable=True, method_number=None)
        activity = self.env["account.analytic.account"].search(
            [("plan_id", "=", self.env.ref("eguitra_base.analytic_plan_activite").id)], limit=1)
        status, asset = self.call("POST", "/finance/assets", {
            "name": "Terrain DEMO de Coyah", "profile_id": profile.id, "purchase_value": 900_000_000,
            "date_start": self.today.isoformat(), "confirm": True, "activity_id": activity.id or None,
        }, token=self.token)
        self.assertEqual(status, 200, asset)
        self.assertEqual(asset["state"], "open")
        self.assertTrue(asset["non_depreciable"])
        self.assertFalse([line for line in asset["board"] if line["type"] == "depreciate"], "Aucun plan")
        self.env["account.asset"]._eguitra_cron_depreciate()
        self.assertFalse(self.env["account.move.line"].search([("asset_id", "=", asset["id"])]))
        if activity:
            self.assertEqual(asset["activity"]["id"], activity.id)

        status, updated = self.call("PATCH", f"/finance/assets/{asset['id']}",
                                    {"location": "Coyah, km 36", "custodian": "Direction générale"}, token=self.token)
        self.assertEqual(status, 200, updated)
        self.assertEqual(updated["custodian"], "Direction générale")
        response = self.url_open("/api/v1/finance/assets/export?format=xlsx",
                                 headers={"Authorization": f"Bearer {self.token}"}, timeout=60)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"PK"))
        response = self.url_open("/api/v1/finance/assets/export?format=csv",
                                 headers={"Authorization": f"Bearer {self.token}"}, timeout=60)
        self.assertIn("Coyah, km 36", response.content.decode("utf-8-sig"))
        self.assertIn("Mois amortis", response.content.decode("utf-8-sig"))

    def test_migration_des_plans_annuels(self):
        """La migration 19.0.1.4.0 passe les catégories en mensuel et recalcule les plans sans dotation."""
        path = os.path.join(get_module_path("eguitra_finance"), "migrations", "19.0.1.4.0", "post-migrate.py")
        spec = importlib.util.spec_from_file_location("eguitra_finance_migration_19_0_1_4_0", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        profile = self.env["account.asset.profile"].create({
            "name": "Ancienne catégorie annuelle", "account_asset_id": self.acc_asset.id,
            "account_depreciation_id": self.acc_dep.id, "account_expense_depreciation_id": self.acc_exp.id,
            "journal_id": self.journal.id, "method": "linear", "method_number": 5, "method_period": "year",
            "method_time": "year", "prorata": False, "company_id": self.company.id,
        })
        asset = self.env["account.asset"].create({
            "name": "Groupe électrogène DEMO", "profile_id": profile.id, "purchase_value": 60_000_000,
            "date_start": self.opening, "company_id": self.company.id,
        })
        asset.compute_depreciation_board()
        self.assertEqual(asset.method_period, "year")
        migration._monthly_depreciation(self.env)
        self.assertEqual(profile.method_period, "month")
        self.assertTrue(profile.prorata)
        self.assertEqual(asset.method_period, "month")
        first_year = asset.depreciation_line_ids.filtered(
            lambda line: line.type == "depreciate" and line.line_date.year == self.opening.year)
        self.assertEqual(len(first_year), 12, "Plan recalculé : douze dotations par an")
