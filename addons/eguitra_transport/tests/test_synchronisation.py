from odoo.tests import tagged

from .common import TransportCase


@tagged("post_install", "-at_install")
class TestSynchronisationCorrection(TransportCase):
    """Saisie de Rotations corrigée sur le téléphone après un premier envoi (réponse perdue, envoi en
    cours pendant la correction) : le brouillon de son auteur est mis à jour, jamais une rotation que le
    bureau a traitée ou retouchée (audit de l'application web du 25/10/2026, constat C2)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._create_user("mariama", "exploitation")
        cls._create_user("dg.sync", "direction")
        cls._create_user("achats.sync", "achats")
        cls.other_customer = cls.env["res.partner"].create({"name": "Client sans tarif négocié", "customer_rank": 1})

    def _send(self, token, uuid, correction=False, **values):
        item = {"client_uuid": uuid, "vehicle_id": self.truck.id, "partner_id": self.customer.id,
                "route_id": self.route.id, "product": "gasoil", "volume_loaded": 40,
                "date_loading": self.today.isoformat()}
        item.update(values)
        if correction:
            item["correction"] = True
        status, body = self.call("POST", "/transport/sync", {"rotations": [item]}, token=token)
        self.assertEqual(status, 200, body)
        return body["results"][0]

    def _rotation_of(self, uuid):
        rot = self.env["eguitra.transport.rotation"].search([("client_uuid", "=", uuid)])
        rot.invalidate_recordset()
        return rot

    def test_correction_du_brouillon_par_son_auteur(self):
        token = self.open_session("ibrahima", app="mobile")["access_token"]
        first = self._send(token, "correction-01", volume_delivered=39.8, delivery_note="BL-1")
        self.assertEqual(first["status"], "created", first)
        again = self._send(token, "correction-01", volume_delivered=10)
        self.assertEqual((again["status"], again["state"]), ("exists", "draft"), again)
        self.assertEqual(self._rotation_of("correction-01").volume_delivered, 39.8,
                         "Un simple renvoi (réponse perdue) n'écrase pas la saisie reçue")
        fixed = self._send(token, "correction-01", correction=True, volume_delivered=39.5, delivery_note="BL-2")
        self.assertEqual(fixed["status"], "updated", fixed)
        rot = self._rotation_of("correction-01")
        self.assertEqual(len(rot), 1, "La correction ne crée pas de seconde rotation")
        self.assertEqual((rot.volume_delivered, rot.delivery_note, rot.state, rot.source), (39.5, "BL-2", "draft", "mobile"))
        self.assertEqual(rot.id, first["id"])

    def test_correction_du_client_reprend_le_tarif(self):
        token = self.open_session("ibrahima", app="mobile")["access_token"]
        self._send(token, "tarif-01")
        self.assertEqual(self._rotation_of("tarif-01").rate, 1_200_000, "Tarif négocié du client")
        fixed = self._send(token, "tarif-01", correction=True, partner_id=self.other_customer.id)
        self.assertEqual(fixed["status"], "updated", fixed)
        rot = self._rotation_of("tarif-01")
        self.assertEqual(rot.partner_id, self.other_customer)
        self.assertEqual(rot.rate, 1_000_000, "Client sans tarif négocié : tarif de la route, comme à la création")

    def test_correction_refusee_apres_validation(self):
        agent = self.open_session("ibrahima", app="mobile")["access_token"]
        first = self._send(agent, "validee-01")
        office = self.open_session("fatou")["access_token"]
        status, body = self.call("POST", f"/transport/rotations/{first['id']}/validate", {}, token=office)
        self.assertEqual(status, 200, body)
        late = self._send(agent, "validee-01", correction=True, volume_loaded=35)
        self.assertEqual((late["status"], late["state"]), ("exists", "done"), late)
        self.assertIn("au bureau", late["message"])
        self.assertEqual(self._rotation_of("validee-01").volume_loaded, 40, "Une rotation validée ne bouge pas")

    def test_correction_refusee_apres_modification_au_bureau(self):
        agent = self.open_session("ibrahima", app="mobile")["access_token"]
        first = self._send(agent, "bureau-01")
        office = self.open_session("fatou")["access_token"]
        status, body = self.call("PATCH", f"/transport/rotations/{first['id']}", {"volume_delivered": 39.9}, token=office)
        self.assertEqual(status, 200, body)
        late = self._send(agent, "bureau-01", correction=True, volume_delivered=38)
        self.assertEqual((late["status"], late["state"]), ("exists", "draft"), late)
        self.assertEqual(self._rotation_of("bureau-01").volume_delivered, 39.9, "La correction du bureau est gardée")

    def test_correction_par_un_autre_compte_refusee(self):
        agent = self.open_session("ibrahima", app="mobile")["access_token"]
        self._send(agent, "auteur-01")
        other = self.open_session("mariama", app="mobile")["access_token"]
        late = self._send(other, "auteur-01", correction=True, volume_loaded=20)
        self.assertEqual(late["status"], "exists", late)
        self.assertEqual(self._rotation_of("auteur-01").volume_loaded, 40, "Seul l'auteur corrige sa saisie")

    def test_correction_illisible_rejetee_sans_toucher_au_brouillon(self):
        token = self.open_session("ibrahima", app="mobile")["access_token"]
        self._send(token, "illisible-01")
        bad = self._send(token, "illisible-01", correction=True, route_id=999_999_999)
        self.assertEqual(bad["status"], "error", bad)
        rot = self._rotation_of("illisible-01")
        self.assertEqual((rot.route_id, rot.volume_loaded), (self.route, 40))

    def test_synchronisation_refusee_aux_profils_sans_saisie(self):
        """Direction et achats lisent ou achètent, ne saisissent pas de rotation : refus du profil."""
        for login in ("dg.sync", "achats.sync"):
            token = self.open_session(login)["access_token"]
            item = {"client_uuid": f"refus-{login}", "vehicle_id": self.truck.id, "partner_id": self.customer.id,
                    "route_id": self.route.id, "product": "gasoil", "volume_loaded": 40}
            status, body = self.call("POST", "/transport/sync", {"rotations": [item]}, token=token)
            self.assertEqual((status, body.get("error")), (403, "forbidden"), body)
            status, body = self.call("POST", "/transport/sync", {"rotations": [dict(item, correction=True)]}, token=token)
            self.assertEqual((status, body.get("error")), (403, "forbidden"), body)
        self.assertFalse(self.env["eguitra.transport.rotation"].search([("client_uuid", "like", "refus-")]))
