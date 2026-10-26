import csv
import io
from datetime import date, timedelta
from unittest.mock import patch

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import tagged
from odoo.tools import mute_logger

from .common import TransportCase


@tagged("post_install", "-at_install")
class TestSaisiesAudit(TransportCase):
    """Audit du 25 octobre : saisies mal formées en 400 et messages lisibles (M2, M3), synchronisation et
    valeurs négatives (M12), export (M12, I-T7), documents d'ensemble archivés (M15)."""

    def test_identifiants_mal_formes_et_references_inconnues(self):
        token = self.open_session("ibrahima")["access_token"]
        base = {"partner_id": self.customer.id, "route_id": self.route.id, "product": "gasoil", "volume_loaded": 40}
        status, body = self.call("POST", "/transport/rotations", dict(base, vehicle_id="ER-01"), token=token)
        self.assertEqual(status, 400, body)
        self.assertIn("Ensemble routier", body["message"])
        status, body = self.call("POST", "/transport/rotations", dict(base, vehicle_id=999_999_999), token=token)
        self.assertEqual((status, body["message"]), (422, "Ensemble routier inconnu."), body)
        status, body = self.call("POST", "/transport/rotations", dict(base, vehicle_id=self.truck.id, route_id=999_999_999),
                                 token=token)
        self.assertEqual((status, body["message"]), (422, "Route inconnue."), body)
        status, body = self.call("POST", "/transport/rotations/validate", {"ids": ["toutes"]}, token=token)
        self.assertEqual(status, 400, body)
        status, body = self.call("PATCH", f"/transport/routes/{self.route.id}", {"distance_km": "loin"}, token=token)
        self.assertEqual(status, 400, body)
        status, body = self.call("PATCH", f"/transport/vehicles/{self.truck.id}", {"year": "récent"}, token=token)
        self.assertEqual(status, 400, body)

    def test_valeurs_negatives_refusees(self):
        token = self.open_session("ibrahima")["access_token"]
        status, body = self.call("POST", "/transport/rotations", {
            "vehicle_id": self.truck.id, "partner_id": self.customer.id, "route_id": self.route.id,
            "product": "gasoil", "volume_loaded": 40, "toll_cost": -500_000}, token=token)
        self.assertEqual(status, 422, body)
        self.assertIn("péages", body["message"])
        with self.assertRaises(ValidationError):
            self._rotation(volume_delivered=-1)
        rot = self._rotation()
        with self.assertRaises(ValidationError):
            rot.fuel_liters = -10
        # La reprise des données anciennes n'y est pas soumise.
        Rotation = self.env["eguitra.transport.rotation"].with_context(eguitra_transport_reprise=True)
        self.assertEqual(Rotation.create({"vehicle_id": self.truck.id, "partner_id": self.customer.id,
                                          "route_id": self.route.id, "product": "gasoil", "volume_loaded": 40,
                                          "other_costs": -1_000}).other_costs, -1_000)

    def test_synchronisation_tarif_et_double_envoi(self):
        token = self.open_session("ibrahima", app="mobile")["access_token"]
        item = {"vehicle_id": self.truck.id, "partner_id": self.customer.id, "route_id": self.route.id,
                "product": "gasoil", "volume_loaded": 40, "date_loading": str(date.today())}
        status, body = self.call("POST", "/transport/sync", {"rotations": [
            dict(item, client_uuid="tarif-du-telephone", rate=1)]}, token=token)
        self.assertEqual(body["results"][0]["status"], "created", body)
        rot = self.env["eguitra.transport.rotation"].browse(body["results"][0]["id"])
        self.assertEqual(rot.rate, 1_200_000, "Le tarif vient de la route, jamais du téléphone")
        # Deux envois simultanés : le second ne voit pas encore la saisie du premier, la contrainte d'unicité
        # répond ; la saisie est déjà enregistrée, pas invalide.
        self._rotation(client_uuid="double-envoi")
        self.env.flush_all()
        Model = self.registry["eguitra.transport.rotation"]
        search = Model.search

        def unseen(records, domain, *args, **kwargs):
            if list(domain) == [("client_uuid", "=", "double-envoi")]:
                return records.browse()
            return search(records, domain, *args, **kwargs)

        with patch.object(Model, "search", unseen), mute_logger("odoo.sql_db"):
            status, body = self.call("POST", "/transport/sync", {"rotations": [dict(item, client_uuid="double-envoi")]},
                                     token=token)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["results"][0]["status"], "exists", body)

    def _csv(self, login):
        token = self.open_session(login)["access_token"]
        headers = {"Authorization": f"Bearer {token}", "X-Eguitra-App": "finance"}
        response = self.url_open("/api/v1/transport/exports/rotations?format=csv", headers=headers, timeout=60)
        self.assertEqual(response.status_code, 200, response.text[:300])
        return list(csv.reader(io.StringIO(response.content.decode("utf-8-sig")), delimiter=";"))

    def test_export_total_sans_annulees_et_facture_lisible_du_parc(self):
        self._rotation(volume_loaded=40, volume_delivered=40)
        self._rotation(volume_loaded=30, volume_delivered=30).action_cancel()
        invoiced = self._rotation(volume_loaded=20, volume_delivered=20)
        invoiced.action_validate()
        invoiced.action_invoice()
        self.env.flush_all()
        rows = self._csv("ibrahima")  # profil exploitation : sans accès aux pièces comptables
        header = rows[0]
        total = next(r for r in rows if r and r[0] == "TOTAL")
        loaded = float(total[header.index("Volume chargé (m³)")].replace(" ", "").replace(" ", "").replace(",", "."))
        self.assertEqual(loaded, 60, "La rotation annulée reste listée, hors total")
        self.assertEqual(sum(1 for r in rows[1:] if r and r[0] != "TOTAL"), 3)

    def test_documents_archives_et_jamais_supprimes_par_le_parc(self):
        expiry = str(date.today() + timedelta(days=365))
        token = self.open_session("ibrahima")["access_token"]
        status, body = self.call("PATCH", f"/transport/vehicles/{self.truck.id}", {"documents": [
            {"kind": "insurance", "reference": "AS-1", "expiry_date": expiry},
            {"kind": "inspection", "reference": "VT-1", "expiry_date": expiry}]}, token)
        self.assertEqual(status, 200, body)
        inspection = self.truck.document_ids.filtered(lambda d: d.kind == "inspection")
        insurance = self.truck.document_ids.filtered(lambda d: d.kind == "insurance")
        status, body = self.call("PATCH", f"/transport/vehicles/{self.truck.id}", {"documents": [
            {"id": insurance.id, "kind": "insurance", "reference": "AS-1", "expiry_date": expiry}]}, token)
        self.assertEqual(status, 200, body)
        self.assertEqual(self.truck.document_ids, insurance)
        self.assertTrue(inspection.exists(), "Document retiré de la fiche : archivé, gardé à l'historique")
        self.assertFalse(inspection.active)
        status, vehicles = self.call("GET", "/transport/vehicles", token=token)
        row = next(v for v in vehicles if v["id"] == self.truck.id)
        self.assertEqual([d["id"] for d in row["documents"]], [insurance.id], "La fiche ne montre plus le document archivé")
        self.assertNotIn("inspection", self.truck.with_context(active_test=False)._latest_documents(),
                         "Les contrôles, qui lisent la flotte archivée comprise, ignorent le document archivé")
        agent = self.env["res.users"].search([("login", "=", "ibrahima")])
        with self.assertRaises(AccessError):
            insurance.with_user(agent).unlink()
