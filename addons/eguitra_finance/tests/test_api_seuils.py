from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_api.tests.profils import RefusParProfil

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestSeuilsApi(RefusParProfil, FinanceDataMixin, ApiCase):
    """Seuils d'alerte (Administration > Seuils et taux) : une valeur absente ou illisible est refusée au lieu
    d'être lue 0, ce qui éteindrait la règle en silence ; modification réservée à l'administration."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("hawa.seuils", "admin")

    def _seuil(self, token, code="cash_min"):
        status, thresholds = self.call("GET", "/finance/thresholds", token=token)
        self.assertEqual(status, 200, thresholds)
        return next(t for t in thresholds if t["code"] == code)

    def test_valeur_illisible_refusee(self):
        token = self.open_session("hawa.seuils")["access_token"]
        seuil = self._seuil(token)
        path = f"/finance/thresholds/{seuil['id']}"
        status, body = self.call("PATCH", path, {"value": 500_000_000}, token=token)
        self.assertEqual(status, 200, body)
        self.assertEqual(self._seuil(token)["value"], 500_000_000)
        for illisible in (None, "", "500 000 000", "abc"):
            with self.subTest(valeur=illisible):
                status, body = self.call("PATCH", path, {"value": illisible}, token=token)
                self.assertEqual(status, 400, body)
        self.assertEqual(self._seuil(token)["value"], 500_000_000, "Un envoi refusé ne touche pas au seuil")
        status, body = self.call("PATCH", path, {"value": 0}, token=token)
        self.assertEqual(status, 200, body)
        self.assertEqual(self._seuil(token)["value"], 0, "0 reste la façon voulue d'éteindre la règle")

    def test_modification_reservee_a_l_administration(self):
        token = self.open_session("hawa.seuils")["access_token"]
        seuil = self._seuil(token)
        self.assertRefuseHors(("admin",), "PATCH", f"/finance/thresholds/{seuil['id']}", {"value": 1, "active": False})
        apres = self._seuil(token)
        self.assertEqual((apres["value"], apres["active"]), (seuil["value"], seuil["active"]), "Rien n'a changé")
