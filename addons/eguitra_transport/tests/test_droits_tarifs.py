from datetime import timedelta

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import tagged

from .common import TransportCase


@tagged("post_install", "-at_install")
class TestDroitsTarifs(TransportCase):
    """Audit du 25 octobre : le parc (exploitation) ne supprime ni tarif client ni ligne de taxe d'une
    rotation ; les tarifs ne se lisent que dans les sociétés autorisées."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.agent = cls.env["res.users"].search([("login", "=", "ibrahima")])

    def test_tarifs_suppression_reservee_a_la_finance(self):
        tariff = self.route.tariff_ids
        with self.assertRaises(AccessError):
            tariff.with_user(self.agent).unlink()
        token = self.open_session("ibrahima")["access_token"]
        # Le parc ajoute un tarif : celui qui existe garde son identifiant (et ses conditions de manquant).
        status, body = self.call("PATCH", f"/transport/routes/{self.route.id}", {"tariffs": [
            {"partner_id": self.customer.id, "product": "gasoil", "rate": 1_200_000},
            {"partner_id": self.customer.id, "product": "essence", "rate": 1_300_000}]}, token=token)
        self.assertEqual(status, 200, body)
        self.assertIn(tariff, self.route.tariff_ids)
        self.assertEqual(len(self.route.tariff_ids), 2)
        # Retirer un tarif de la liste le supprime : refusé au parc, permis à la finance.
        status, body = self.call("PATCH", f"/transport/routes/{self.route.id}", {"tariffs": [
            {"partner_id": self.customer.id, "product": "gasoil", "rate": 1_200_000}]}, token=token)
        self.assertEqual(status, 403, body)
        self.assertEqual(len(self.route.tariff_ids), 2)
        finance = self.open_session("fatou")["access_token"]
        status, body = self.call("PATCH", f"/transport/routes/{self.route.id}", {"tariffs": [
            {"partner_id": self.customer.id, "product": "gasoil", "rate": 1_200_000}]}, token=finance)
        self.assertEqual(status, 200, body)
        self.assertEqual(self.route.tariff_ids, tariff)

    def test_tarif_renegocie_remplace_l_ancien(self):
        """C6 : un nouveau tarif du même client et du même produit remplace l'ancien ; les rotations
        suivantes prennent le nouveau tarif."""
        tariff = self.route.tariff_ids
        token = self.open_session("ibrahima")["access_token"]
        status, body = self.call("PATCH", f"/transport/routes/{self.route.id}", {"tariffs": [
            {"partner_id": self.customer.id, "product": "gasoil", "rate": 1_200_000},
            {"partner_id": self.customer.id, "product": "gasoil", "rate": 1_350_000}]}, token=token)
        self.assertEqual(status, 400, "Deux tarifs du même couple dans la même demande")
        status, body = self.call("PATCH", f"/transport/routes/{self.route.id}", {"tariffs": [
            {"partner_id": self.customer.id, "product": "gasoil", "rate": 1_350_000}]}, token=token)
        self.assertEqual(status, 200, body)
        self.assertEqual((self.route.tariff_ids, tariff.rate), (tariff, 1_350_000))
        self.assertEqual(self._rotation().rate, 1_350_000, "La rotation suivante prend le tarif renégocié")
        with self.assertRaises(ValidationError):
            self.env["eguitra.transport.tariff"].create({"route_id": self.route.id, "partner_id": self.customer.id,
                                                         "product_id": tariff.product_id.id, "rate": 1_000_000})

    def test_tarifs_dates_selon_le_chargement(self):
        """I-T10 : un tarif renégocié commence à sa date ; une rotation chargée avant (même saisie au
        téléphone et synchronisée après) garde l'ancien tarif."""
        start = self.today + timedelta(days=10)
        token = self.open_session("ibrahima")["access_token"]
        status, body = self.call("PATCH", f"/transport/routes/{self.route.id}", {"tariffs": [
            {"partner_id": self.customer.id, "product": "gasoil", "rate": 1_200_000},
            {"partner_id": self.customer.id, "product": "gasoil", "rate": 1_300_000, "date_from": str(start)}]}, token=token)
        self.assertEqual(status, 200, body)
        self.assertEqual(len(self.route.tariff_ids), 2, "L'ancien tarif reste pour les chargements d'avant")
        self.assertEqual(self._rotation(date_loading=start - timedelta(days=1)).rate, 1_200_000)
        self.assertEqual(self._rotation(date_loading=start).rate, 1_300_000)
        status, sync = self.call("POST", "/transport/sync", {"rotations": [{
            "client_uuid": "tarif-date-01", "vehicle_id": self.truck.id, "partner_id": self.customer.id,
            "route_id": self.route.id, "product": "gasoil", "volume_loaded": 40,
            "date_loading": str(start - timedelta(days=2))}]}, token=token)
        self.assertEqual(sync["results"][0]["status"], "created", sync)
        rot = self.env["eguitra.transport.rotation"].browse(sync["results"][0]["id"])
        self.assertEqual(rot.rate, 1_200_000, "Tarif en vigueur au chargement, non à la synchronisation")
        status, routes = self.call("GET", "/transport/routes", token=token)
        row = next(r for r in routes if r["id"] == self.route.id)
        self.assertEqual(sorted(str(t["date_from"]) for t in row["tariffs"]), sorted(["None", str(start)]))

    def test_lignes_de_taxe_recalculees_par_le_systeme(self):
        self.env["eguitra.transport.tax"].create({"name": "Taxe de roulage", "nature": "road", "base": "delivered",
                                                  "rate": 5_000})
        rot = self._rotation()
        self.assertTrue(rot.tax_line_ids)
        with self.assertRaises(AccessError):
            rot.tax_line_ids.with_user(self.agent).unlink()
        # Le parc corrige le volume : les lignes de taxe sont recalculées sans qu'il ait à les supprimer.
        token = self.open_session("ibrahima")["access_token"]
        status, body = self.call("PATCH", f"/transport/rotations/{rot.id}", {"volume_delivered": 39}, token=token)
        self.assertEqual(status, 200, body)
        self.assertEqual(rot.tax_line_ids.amount, 39 * 5_000)

    def test_tarifs_limites_aux_societes_autorisees(self):
        other = self.env["res.company"].create({"name": "Société sans le parc"})
        route = self.env["eguitra.transport.route"].sudo().with_company(other).create({
            "name": "Kamsar - Boké", "company_id": other.id,
            "tariff_ids": [(0, 0, {"partner_id": self.customer.id, "rate": 90_000})]})
        Tariff = self.env["eguitra.transport.tariff"].with_user(self.agent)
        self.assertFalse(Tariff.search([("route_id", "=", route.id)]), "Tarif d'une autre société invisible au parc")
        self.assertTrue(Tariff.search([("route_id", "=", self.route.id)]))
