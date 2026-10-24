from odoo.tests import tagged

from ..nombres import fmt_money, fmt_rate, fmt_volume
from .common import TransportCase


@tagged("post_install", "-at_install")
class TestListeRotations(TransportCase):
    """Liste des rotations de l'écran : tri et pagination par le noyau, marge minimale, marge estimée."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env["eguitra.alert.threshold"].ensure_defaults(cls.company)
        cls._create_user("mariam", "achats")
        # Coût standard de la route : 20 M de prime de route, sans carburant de référence.
        cls.route.write({"std_driver_bonus": 20_000_000})

    def _list(self, token, query=""):
        status, body = self.call("GET", f"/transport/rotations?state=draft{query}", token=token)
        self.assertEqual(status, 200, body)
        return body

    def test_tri_pagination_et_marge_minimale(self):
        # Frais saisis : marge déclarée de 36,76 M (39,8 m³ à 1,2 M, 11 M de frais).
        declared = self._rotation()
        # Aucun frais : marge estimée de 28 M sur le coût standard (marge des frais déclarés : 48 M).
        estimated = self._rotation(volume_loaded=40, volume_delivered=0, fuel_cost=0, toll_cost=0, driver_fees=0)
        # Frais au-delà du montant : marge négative.
        loss = self._rotation(volume_loaded=20, volume_delivered=20, fuel_cost=50_000_000)
        self.assertTrue(estimated.margin_estimated)
        self.assertFalse(declared.margin_estimated)
        self.assertEqual(estimated.margin_or_estimate, 48_000_000 - 20_000_000)
        self.assertEqual(declared.margin_or_estimate, declared.margin)
        self.assertEqual(estimated.billed_volume, 40)

        token = self.open_session("ibrahima")["access_token"]
        body = self._list(token, "&sort=margin&limit=2")
        self.assertEqual([r["id"] for r in body["items"]], [loss.id, estimated.id],
                         "Tri sur la marge affichée : l'estimation tant qu'aucun frais n'est saisi")
        self.assertEqual((body["total_count"], body["offset"], body["limit"]), (3, 0, 2))
        self.assertEqual(body["margin_min"], 30, "Seuil de la règle d'alerte, pour juger le taux de chaque ligne")
        row = next(r for r in body["items"] if r["id"] == estimated.id)
        self.assertTrue(row["margin_estimated"])
        self.assertAlmostEqual(row["estimated_margin_rate"], 28 / 48 * 100)
        body = self._list(token, "&sort=margin&limit=2&offset=2")
        self.assertEqual([r["id"] for r in body["items"]], [declared.id], "Page suivante")
        body = self._list(token, "&sort=-margin")
        self.assertEqual([r["id"] for r in body["items"]], [declared.id, estimated.id, loss.id])
        body = self._list(token, "&sort=volume")
        self.assertEqual([r["id"] for r in body["items"]], [loss.id, declared.id, estimated.id],
                         "Volume facturable : livré, à défaut chargé")
        body = self._list(token, "&sort=-margin_rate")
        self.assertEqual(body["items"][-1]["id"], loss.id)
        # Les totaux portent sur tout le filtre, pas sur la page.
        body = self._list(token, "&limit=1")
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["totals"]["revenue"], declared.revenue + estimated.revenue + loss.revenue)
        # Sans montant, le taux estimé n'a pas de sens.
        empty = self._rotation(volume_loaded=0, volume_delivered=0, fuel_cost=0, toll_cost=0, driver_fees=0)
        status, row = self.call("GET", f"/transport/rotations/{empty.id}", token=token)
        self.assertEqual((status, row["estimated_margin_rate"]), (200, None), row)

    def test_tri_inconnu_et_profils(self):
        token = self.open_session("ibrahima")["access_token"]
        status, body = self.call("GET", "/transport/rotations?sort=total_cost;drop", token=token)
        self.assertEqual((status, body.get("error")), (400, "invalid_parameter"), body)
        status, body = self.call("GET", "/transport/rotations?sort=-", token=token)
        self.assertEqual(status, 400, body)
        # Hors des profils du Transport, la liste est refusée.
        token = self.open_session("mariam")["access_token"]
        status, _body = self.call("GET", "/transport/rotations", token=token)
        self.assertEqual(status, 403)

    def test_ecriture_des_nombres(self):
        self.assertEqual(fmt_money(1_234_567.5), "1 234 568 GNF")
        self.assertEqual(fmt_money(-0.4), "0 GNF", "Jamais « -0 »")
        self.assertEqual(fmt_volume(1365.456), "1 365,46 m³")
        self.assertEqual(fmt_volume(0.125, unit=False), "0,13", "Arrondi demi vers le haut")
        self.assertEqual((fmt_rate(15), fmt_rate(2.5), fmt_rate(12.25)), ("15 %", "2,5 %", "12,25 %"))
