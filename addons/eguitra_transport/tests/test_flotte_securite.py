import json
from datetime import date, timedelta
from unittest.mock import patch

from odoo.exceptions import ValidationError
from odoo.tests import tagged

from ..blocking import RotationBlocked, motif
from ..nombres import pluriel
from .common import TransportCase


@tagged("post_install", "-at_install")
class TestFlotteSecurite(TransportCase):
    """Données et crochets du Transport pour le module HSSEQ : profil, documents à échéance, pesée, départ
    en route et validation."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._create_user("direction", "direction")

    def _documents(self, vehicle, **expiry):
        today = date.today()
        vehicle.document_ids = [(0, 0, {"kind": kind, "expiry_date": today + timedelta(days=days)})
                                for kind, days in expiry.items()]

    def test_documents_et_aides(self):
        today = date.today()
        self.assertEqual(self.truck._missing_documents(), ["insurance", "inspection", "calibration", "tightness"])
        self._documents(self.truck, insurance=200, inspection=10, calibration=-1, tightness=90)
        self.assertFalse(self.truck._missing_documents())
        self.assertEqual(self.truck._expired_documents(today).mapped("kind"), ["calibration"])
        self.assertEqual(self.truck._expired_documents(today + timedelta(days=20), kinds=["insurance", "inspection"])
                         .mapped("kind"), ["inspection"])
        # Historique : un renouvellement s'ajoute, le plus récent fait foi.
        self._documents(self.truck, calibration=365)
        self.assertFalse(self.truck._expired_documents(today))
        self.assertEqual(len(self.truck.document_ids.filtered(lambda d: d.kind == "calibration")), 2)
        issues = {i["code"]: i for i in self.truck._document_issues()}
        self.assertEqual(issues["document_expiring:inspection"]["severity"], "warn")
        insurance = self.truck.document_ids.filtered(lambda d: d.kind == "insurance")
        self.assertTrue(insurance.display_name.startswith("Assurance de ER-01 jusqu'au"), insurance.display_name)
        self.truck.vehicle_kind = "tipper"
        self.assertEqual(self.truck._missing_documents(kinds=["calibration"]), [])
        self.assertEqual(self.truck._required_kinds(), ("insurance", "inspection"))
        with self.assertRaises(ValidationError):
            self.env["eguitra.transport.vehicle.document"].create({
                "vehicle_id": self.truck.id, "kind": "insurance", "date_start": today, "expiry_date": today - timedelta(days=1)})
        controls = {c["code"]: c for c in self.env["eguitra.transport.analysis"].controls(self.company)}
        self.assertFalse(controls["vehicle_documents"]["ok"], "Visite technique à renouveler")

    def test_pesee_et_surcharge(self):
        self.truck.write({"vehicle_kind": "tipper", "payload_tonnes": 30})
        rot = self._rotation(weigh_ticket="P-118", weight_gross=48.5, weight_tare=16)
        self.assertEqual((rot.weight_net, rot._overload(), rot.over_payload), (32.5, 2.5, True))
        rot.weight_gross = 44
        self.assertEqual((rot._overload(), rot.over_payload), (0.0, False))
        with self.assertRaises(ValidationError):
            rot.weight_tare = 50
        with self.assertRaises(ValidationError):
            self.truck.payload_tonnes = -1

    def test_depart_en_route_et_validation(self):
        rot = self._rotation()
        self.assertFalse(rot._departure_blockers(), "Le Transport ne code pas les motifs HSSEQ (documents, charge)")
        self.truck.state = "maintenance"
        [blocker] = rot._departure_blockers()
        self.assertEqual((blocker["code"], blocker["severity"], blocker["waivable"], blocker["source"]),
                         ("T01", "block", False, "transport"))
        self.assertEqual(set(blocker), {"code", "label", "source", "since", "waivable", "severity"})
        with self.assertRaises(RotationBlocked) as refus:
            rot.action_depart()
        self.assertEqual(refus.exception.blockers[0]["code"], "T01")
        self.assertEqual(rot.state, "draft")
        self.truck.state = "service"
        rot.action_depart()
        self.assertEqual((rot.state, rot.departed_by), ("en_route", self.env.user))
        self.assertTrue(rot.departed_at)
        self.assertFalse(rot.departure_log, "Ni avertissement ni dérogation")
        rot.action_validate()
        self.assertEqual(rot.state, "done", "Une rotation en route se valide")
        self.assertTrue(rot.departed_at, "La trace du départ reste")
        # Retour en saisie d'une rotation partie : le départ est à redonner.
        other = self._rotation()
        other.action_depart()
        other.action_reset()
        self.assertEqual((other.state, other.departed_at), ("draft", False))

    def test_crochets_du_module_hsseq(self):
        """Ce que fera le module HSSEQ en surchargeant les crochets : vigilance notée au départ, dérogation
        tracée, validation refusée."""
        Rotation = type(self.env["eguitra.transport.rotation"])
        rot = self._rotation()
        warn = motif("V05", "Assurance à renouveler", "hsseq", severity="warn")
        waived = motif("V08", "Plan de trajet absent", "hsseq", waivable=True)
        with patch.object(Rotation, "_departure_blockers", lambda self: [warn]), \
                patch.object(Rotation, "_departure_waived", lambda self: [waived]):
            rot.action_depart()
        log = json.loads(rot.departure_log)
        self.assertEqual(([w["code"] for w in log["warnings"]], [w["code"] for w in log["waived"]]), (["V05"], ["V08"]))
        with patch.object(Rotation, "_validation_blockers", lambda self: [motif("H01", "Départ non enregistré", "hsseq")]):
            with self.assertRaises(RotationBlocked):
                rot.action_validate()
        self.assertEqual(rot.state, "en_route")

    def test_api_documents_depart_et_profils(self):
        token = self.open_session("ibrahima")["access_token"]
        expiry = str(date.today() + timedelta(days=365))
        status, body = self.call("PATCH", f"/transport/vehicles/{self.truck.id}", {
            "vehicle_kind": "tanker", "payload_tonnes": 32,
            "documents": [{"kind": "insurance", "reference": "AS-77", "issuer": "Assureur", "expiry_date": expiry},
                          {"kind": "inspection", "expiry_date": expiry}]}, token)
        self.assertEqual(status, 200, body)
        status, vehicles = self.call("GET", "/transport/vehicles", token=token)
        row = next(v for v in vehicles if v["id"] == self.truck.id)
        self.assertEqual((row["payload_tonnes"], len(row["documents"])), (32, 2))
        self.assertEqual({i["code"] for i in row["document_issues"]},
                         {"document_missing:calibration", "document_missing:tightness"})
        # Mise à jour par identifiant : le document garde son id (et sa pièce jointe), l'absent est retiré.
        insurance = next(d for d in row["documents"] if d["kind"] == "insurance")
        status, body = self.call("PATCH", f"/transport/vehicles/{self.truck.id}", {
            "documents": [{"id": insurance["id"], "kind": "insurance", "reference": "AS-78", "expiry_date": expiry}]}, token)
        self.assertEqual(status, 200, body)
        self.assertEqual(self.truck.document_ids.mapped("reference"), ["AS-78"])
        self.assertEqual(self.truck.document_ids.id, insurance["id"])
        status, body = self.call("PATCH", f"/transport/vehicles/{self.truck.id}", {"documents": [{"kind": "lune", "expiry_date": expiry}]}, token)
        self.assertEqual(status, 400, body)
        status, body = self.call("PATCH", f"/transport/vehicles/{self.truck.id}", {"documents": [{"kind": "insurance"}]}, token)
        self.assertEqual(status, 400, body)
        status, body = self.call("PATCH", f"/transport/vehicles/{self.truck.id}", {"documents": ["insurance"]}, token)
        self.assertEqual(status, 400, body)
        status, body = self.call("PATCH", f"/transport/vehicles/{self.truck.id}", {"documents": [
            {"id": "x", "kind": "insurance", "expiry_date": expiry}]}, token)
        self.assertEqual(status, 400, body)
        # Ticket de pesée saisi avec la rotation ; départ refusé par le serveur avec ses motifs.
        status, rot = self.call("POST", "/transport/rotations", {
            "vehicle_id": self.truck.id, "partner_id": self.customer.id, "route_id": self.route.id, "product": "gasoil",
            "volume_loaded": 40, "weigh_ticket": "P-9", "weight_gross": 40, "weight_tare": 15}, token)
        self.assertEqual((status, rot["weigh_ticket"], rot["weight_net"]), (200, "P-9", 25), rot)
        self.truck.state = "off"
        status, body = self.call("POST", f"/transport/rotations/{rot['id']}/depart", None, token)
        self.assertEqual((status, body["error"], body["blockers"][0]["code"]), (422, "departure_blocked", "T01"), body)
        self.truck.state = "service"
        status, body = self.call("POST", f"/transport/rotations/{rot['id']}/depart", None, token)
        self.assertEqual((status, body["state"]), (200, "en_route"), body)
        status, listed = self.call("GET", "/transport/rotations?state=draft,en_route", token=token)
        self.assertIsNone(listed["items"][0]["departure_blockers"], "Motifs de départ lus dans la fiche, pas la liste")
        agent = self.env["res.users"].search([("login", "=", "ibrahima")])
        self.assertEqual(body["departed_by"]["id"], agent.id, "Trace : le compte qui a donné le départ")
        status, listed = self.call("GET", "/transport/rotations?state=en_route", token=token)
        self.assertEqual([r["id"] for r in listed["items"]], [rot["id"]])
        # La direction lit la flotte et les rotations, sans rien modifier ni faire partir.
        reader = self.open_session("direction")["access_token"]
        status, _b = self.call("GET", "/transport/vehicles", token=reader)
        self.assertEqual(status, 200)
        status, _b = self.call("PATCH", f"/transport/vehicles/{self.truck.id}", {"payload_tonnes": 10}, reader)
        self.assertEqual(status, 403)
        status, _b = self.call("POST", f"/transport/rotations/{rot['id']}/depart", None, reader)
        self.assertEqual(status, 403)

    def test_pluriels_des_messages(self):
        self.assertEqual((pluriel(1, "rotation"), pluriel(3, "rotation"), pluriel(0, "ensemble")),
                         ("1 rotation", "3 rotations", "0 ensemble"))
