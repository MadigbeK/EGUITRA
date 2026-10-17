from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .common import TransportCase


@tagged("post_install", "-at_install")
class TestProduits(TransportCase):
    """Produits transportés : modèle paramétrable, codes de l'ancienne liste toujours acceptés."""

    def test_code_produit_accepte(self):
        rot = self._rotation(product="essence")
        self.assertEqual(rot.product_id, self.essence)
        self.assertEqual(rot.product, "essence", "Le code reste lisible (application mobile, reprise)")
        defaut = self.env["eguitra.transport.rotation"].create({
            "vehicle_id": self.truck.id, "partner_id": self.customer.id, "route_id": self.route.id, "volume_loaded": 30,
        })
        self.assertEqual(defaut.product_id, self.gasoil, "Sans produit : gasoil, comme avant")
        with self.assertRaises(ValidationError):
            self._rotation(product="kerosene-inconnu")

    def test_tarif_par_produit(self):
        tariff = self.route.tariff_ids
        self.assertEqual(tariff.product_id, self.gasoil, "Le tarif créé avec le code « gasoil » vise le produit")
        self.assertEqual(self._rotation(product="gasoil").rate, 1_200_000, "Tarif négocié du gasoil")
        self.assertEqual(self._rotation(product="essence").rate, 1_000_000, "Essence : tarif de la route")
        self.route.write({"tariff_ids": [(0, 0, {"partner_id": self.customer.id, "product": False, "rate": 1_100_000})]})
        self.assertEqual(self._rotation(product="essence").rate, 1_100_000, "Tarif du client tous produits")

    def test_produit_de_la_societe_prioritaire(self):
        Product = self.env["eguitra.transport.product"]
        propre = Product.create({"name": "Gasoil de la société", "code": "gasoil", "company_id": self.company.id})
        self.assertEqual(Product._by_code("gasoil"), propre)
        with self.assertRaises(ValidationError):
            Product.create({"name": "Doublon", "code": "gasoil", "company_id": self.company.id})
        with self.assertRaises(ValidationError):
            Product.create({"name": "Code invalide", "code": "Gasoil Premium"})

    def test_api_produits_et_referentiels(self):
        token = self.open_session("fatou")["access_token"]
        status, body = self.call("POST", "/transport/products", {"name": "Bitume", "code": "bitume"}, token=token)
        self.assertEqual(status, 200, body)
        self.assertFalse(body["shared"], "Un produit créé à l'écran appartient à la société de travail")
        status, refused = self.call("PATCH", f"/transport/products/{body['id']}", {"code": "bitume-2"}, token=token)
        self.assertEqual(status, 422, refused)
        status, _b = self.call("PATCH", f"/transport/products/{body['id']}", {"name": "Bitume routier"}, token=token)
        self.assertEqual(status, 200)

        agent = self.open_session("ibrahima", app="mobile")["access_token"]
        status, _b = self.call("POST", "/transport/products", {"name": "Autre", "code": "x"}, token=agent)
        self.assertEqual(status, 403, "Le parc ne crée pas de produit")
        status, refs = self.call("GET", "/transport/referentials", token=agent)
        self.assertEqual(status, 200, refs)
        codes = {p["code"]: p for p in refs["products"]}
        self.assertIn("bitume", codes)
        self.assertEqual(set(codes["gasoil"]), {"id", "code", "label"})

        # Saisie gardée sur le téléphone avant la mise à jour : produit transmis par son code.
        status, body = self.call("POST", "/transport/sync", {"rotations": [
            {"client_uuid": "produit-jet-01", "vehicle_id": self.truck.id, "partner_id": self.customer.id,
             "route_id": self.route.id, "product": "jet", "volume_loaded": 30},
            {"client_uuid": "produit-inconnu-01", "vehicle_id": self.truck.id, "partner_id": self.customer.id,
             "route_id": self.route.id, "product": "inconnu", "volume_loaded": 30},
        ]}, token=agent)
        self.assertEqual(status, 200, body)
        self.assertEqual([r["status"] for r in body["results"]], ["created", "error"], body)
        rot = self.env["eguitra.transport.rotation"].browse(body["results"][0]["id"])
        self.assertEqual(rot.product_id, self.env.ref("eguitra_transport.product_jet"))
        status, row = self.call("GET", f"/transport/rotations/{rot.id}", token=agent)
        self.assertEqual((row["product"], row["product_label"]), ("jet", "Jet A1"))
