from datetime import timedelta

from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_api.tests.profils import RefusParProfil

from .common import FinanceDataMixin

FIN_WRITE = ("admin", "finance")


@tagged("post_install", "-at_install")
class TestAssetsGardeFous(RefusParProfil, FinanceDataMixin, ApiCase):
    """Immobilisations : dotations jusqu'à aujourd'hui et erreurs rendues, bien en service ou sorti
    jamais remis en service, saisies mal formées refusées en 400, biens sortis hors des totaux."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("comptable.immo", "finance")

        def account(prefix):
            return cls.env["account.account"].search(
                [("code", "=like", prefix + "%"), ("company_ids", "in", cls.company.ids)], limit=1, order="code")

        cls.journal = cls.env["account.journal"].search(
            [("company_id", "=", cls.company.id), ("type", "=", "general")], limit=1)
        cls.profile = cls.env["account.asset.profile"].create({
            "name": "Matériel de transport, 5 ans", "account_asset_id": account("2451").id,
            "account_depreciation_id": account("2845").id, "account_expense_depreciation_id": account("6813").id,
            "journal_id": cls.journal.id, "method": "linear", "method_number": 5, "method_period": "month",
            "company_id": cls.company.id,
        })

    def setUp(self):
        super().setUp()
        self.token = self.open_session("comptable.immo")["access_token"]

    def _asset(self, name, value):
        """Bien mis en service le premier du mois : aucune dotation antérieure à comptabiliser avant une sortie."""
        status, asset = self.call("POST", "/finance/assets", {
            "name": name, "profile_id": self.profile.id, "purchase_value": value,
            "date_start": self.today.replace(day=1).isoformat(), "confirm": True,
        }, token=self.token)
        self.assertEqual(status, 200, asset)
        return asset

    def test_dotations_jusqu_a_aujourd_hui(self):
        self._asset("Citerne DEMO 40 000 L", 600_000_000)
        status, body = self.call("POST", "/finance/assets/depreciate",
                                 {"date": (self.today + timedelta(days=40)).isoformat()}, token=self.token)
        self.assertEqual(status, 422, "Les dotations à venir ne se passent pas aujourd'hui")
        status, body = self.call("POST", "/finance/assets/depreciate", {"date": self.today.isoformat()}, token=self.token)
        self.assertEqual(status, 200, body)
        self.assertIsInstance(body["entries"], int, "Nombre réel d'écritures, et non la taille d'un couple")

    def test_bien_en_service_ou_sorti_jamais_remis_en_service(self):
        asset = self._asset("Camion DEMO", 300_000_000)
        status, body = self.call("POST", f"/finance/assets/{asset['id']}/confirm", token=self.token)
        self.assertEqual(status, 422, "Déjà en service")
        status, body = self.call("POST", f"/finance/assets/{asset['id']}/dispose",
                                 {"date": self.today.isoformat(), "note": "Mise au rebut"}, token=self.token)
        self.assertEqual((status, body.get("state")), (200, "removed"), body)
        status, body = self.call("POST", f"/finance/assets/{asset['id']}/confirm", token=self.token)
        self.assertEqual(status, 422, "Un bien sorti ne revient pas à l'actif (seconde sortie impossible)")
        self.assertEqual(self.env["account.asset"].browse(asset["id"]).state, "removed")

    def test_bien_sorti_hors_des_totaux(self):
        kept = self._asset("Citerne DEMO gardée", 600_000_000)
        gone = self._asset("Citerne DEMO cédée", 400_000_000)
        status, body = self.call("POST", f"/finance/assets/{gone['id']}/dispose",
                                 {"date": self.today.isoformat(), "note": "Mise au rebut"}, token=self.token)
        self.assertEqual(status, 200, body)
        status, listing = self.call("GET", "/finance/assets", token=self.token)
        self.assertEqual(status, 200, listing)
        self.assertIn(gone["id"], [a["id"] for a in listing["items"]], "Le bien sorti reste listé")
        held = sum(a["purchase_value"] for a in listing["items"] if a["state"] != "removed")
        self.assertIn(kept["id"], [a["id"] for a in listing["items"] if a["state"] != "removed"])
        self.assertEqual(listing["totals"]["purchase_value"], held, "Valeur brute des seuls biens encore à l'actif")
        self.assertLess(listing["totals"]["purchase_value"], sum(a["purchase_value"] for a in listing["items"]))

    def test_saisies_mal_formees_refusees(self):
        status, _b = self.call("POST", "/finance/assets", {"name": "X", "profile_id": "abc", "purchase_value": 1},
                               token=self.token)
        self.assertEqual(status, 400, "Catégorie illisible : 400, et non une erreur interne")
        status, _b = self.call("POST", "/finance/assets/profiles", {
            "name": "Mobilier", "account_asset_id": self.profile.account_asset_id.id,
            "account_depreciation_id": self.profile.account_depreciation_id.id,
            "account_expense_depreciation_id": self.profile.account_expense_depreciation_id.id,
            "journal_id": "journal", "method_number": 5,
        }, token=self.token)
        self.assertEqual(status, 400)
        asset = self._asset("Groupe électrogène DEMO", 60_000_000)
        status, _b = self.call("PATCH", f"/finance/assets/{asset['id']}", {"activity_id": "transport"}, token=self.token)
        self.assertEqual(status, 400)

    def test_ecritures_refusees_hors_finance(self):
        asset = self.env["account.asset"].create({
            "name": "Citerne DEMO en brouillon", "profile_id": self.profile.id, "purchase_value": 100_000_000,
            "date_start": self.today, "company_id": self.company.id,
        })
        self.assertRefuseHors(FIN_WRITE, "POST", "/finance/assets/depreciate", {"date": self.today.isoformat()})
        self.assertRefuseHors(FIN_WRITE, "POST", f"/finance/assets/{asset.id}/confirm")
        self.assertRefuseHors(FIN_WRITE, "POST", f"/finance/assets/{asset.id}/dispose", {"date": self.today.isoformat()})
        asset.invalidate_recordset()
        self.assertEqual(asset.state, "draft")
