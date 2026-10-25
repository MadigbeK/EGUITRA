from datetime import date, timedelta

from odoo.exceptions import ValidationError
from odoo.tests import tagged

from ..nombres import pluriel
from .common import TransportCase


@tagged("post_install", "-at_install")
class TestFlotteSecurite(TransportCase):
    """Préparation du module HSSEQ : profil des ensembles, documents à échéance, charge utile, pesée et
    motifs qui s'opposent au départ d'une rotation."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._create_user("direction", "direction")

    def _documents(self, vehicle, **expiry):
        today = date.today()
        vehicle.document_ids = [(0, 0, {"kind": kind, "date_expiry": today + timedelta(days=days)})
                                for kind, days in expiry.items()]

    def test_documents_exiges_selon_le_profil(self):
        codes = {i["code"] for i in self.truck._document_issues()}
        self.assertEqual(codes, {"document_missing:insurance", "document_missing:technical_inspection",
                                 "document_missing:calibration", "document_missing:tightness"}, "Citerne sans documents")
        self._documents(self.truck, insurance=200, technical_inspection=10, calibration=-1, tightness=90)
        issues = {i["code"]: i for i in self.truck._document_issues()}
        self.assertEqual(set(issues), {"document_expiring:technical_inspection", "document_expired:calibration"})
        self.assertEqual(issues["document_expired:calibration"]["severity"], "block")
        self.assertEqual(issues["document_expiring:technical_inspection"]["severity"], "warn")
        self.truck.vehicle_kind = "tipper"
        self.assertEqual({i["code"] for i in self.truck._document_issues()}, {"document_expiring:technical_inspection"},
                         "Une benne n'a ni barémage ni certificat d'étanchéité")
        with self.assertRaises(ValidationError):
            self.env["eguitra.transport.vehicle.document"].create({
                "vehicle_id": self.truck.id, "kind": "other", "date_issue": date.today(),
                "date_expiry": date.today() - timedelta(days=1)})
        controls = {c["code"]: c for c in self.env["eguitra.transport.analysis"].controls(self.company)}
        self.assertFalse(controls["vehicle_documents"]["ok"])

    def test_pesee_et_motifs_de_depart(self):
        self.truck.write({"vehicle_kind": "tipper", "payload_tons": 30})
        self._documents(self.truck, insurance=200, technical_inspection=200)
        rot = self._rotation(weigh_ticket="P-118", weight_gross=48.5, weight_tare=16)
        self.assertEqual((rot.weight_net, rot.over_payload), (32.5, True))
        self.assertEqual([b["code"] for b in rot._departure_blockers()], ["over_payload"])
        rot.weight_gross = 44
        self.assertFalse(rot._departure_blockers(), "Poids net de 28 t pour 30 t de charge utile, documents à jour")
        with self.assertRaises(ValidationError):
            rot.weight_tare = 50

    def test_api_documents_et_profils(self):
        token = self.open_session("ibrahima")["access_token"]
        expiry = str(date.today() + timedelta(days=365))
        status, body = self.call("PATCH", f"/transport/vehicles/{self.truck.id}", {
            "vehicle_kind": "tanker", "payload_tons": 32,
            "documents": [{"kind": "insurance", "reference": "AS-77", "issuer": "Assureur", "date_expiry": expiry},
                          {"kind": "technical_inspection", "date_expiry": expiry}]}, token)
        self.assertEqual(status, 200, body)
        status, vehicles = self.call("GET", "/transport/vehicles", token=token)
        row = next(v for v in vehicles if v["id"] == self.truck.id)
        self.assertEqual((row["payload_tons"], len(row["documents"])), (32, 2))
        self.assertEqual({i["code"] for i in row["document_issues"]},
                         {"document_missing:calibration", "document_missing:tightness"})
        status, body = self.call("PATCH", f"/transport/vehicles/{self.truck.id}", {"documents": [{"kind": "lune", "date_expiry": expiry}]}, token)
        self.assertEqual(status, 400, body)
        status, body = self.call("PATCH", f"/transport/vehicles/{self.truck.id}", {"documents": [{"kind": "insurance"}]}, token)
        self.assertEqual(status, 400, body)
        # Ticket de pesée saisi avec la rotation, motifs de départ lus avec elle.
        status, rot = self.call("POST", "/transport/rotations", {
            "vehicle_id": self.truck.id, "partner_id": self.customer.id, "route_id": self.route.id, "product": "gasoil",
            "volume_loaded": 40, "weigh_ticket": "P-9", "weight_gross": 40, "weight_tare": 15}, token)
        self.assertEqual((status, rot["weigh_ticket"], rot["weight_net"]), (200, "P-9", 25), rot)
        self.assertEqual({b["code"] for b in rot["departure_blockers"]}, {"document_missing:calibration", "document_missing:tightness"})
        # La direction lit la flotte, sans la modifier.
        reader = self.open_session("direction")["access_token"]
        status, _b = self.call("GET", "/transport/vehicles", token=reader)
        self.assertEqual(status, 200)
        status, _b = self.call("PATCH", f"/transport/vehicles/{self.truck.id}", {"payload_tons": 10}, reader)
        self.assertEqual(status, 403)

    def test_pluriels_des_messages(self):
        self.assertEqual((pluriel(1, "rotation"), pluriel(3, "rotation"), pluriel(0, "ensemble")),
                         ("1 rotation", "3 rotations", "0 ensemble"))
