from datetime import datetime, time, timedelta

from odoo import fields
from odoo.tests import tagged

from odoo.addons.eguitra_transport.blocking import RotationBlocked

from .common import HsseqCase


@tagged("post_install", "-at_install")
class TestLockLot2(HsseqCase):
    """Motifs V06 à V09 du verrou (spécification §4) : chacun, sa levée et sa dérogation ; activation par
    type de véhicule et par site ; V01 et V03 restent non dérogeables."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for code in ("v06", "v07", "v08", "v09"):
            cls.env.ref(f"eguitra_hsseq.reason_{code}").enabled = True
        cls.tipper = cls.env["eguitra.transport.vehicle"].create({
            "name": "EB-01", "tractor_plate": "RC-5555-B", "vehicle_kind": "tipper", "payload_tonnes": 30,
            "site_id": cls.site.id, "driver_id": cls.driver.id})
        cls.auditor = cls._create_user("awa.auditrice", "auditeur")
        cls.auditor.write({"hsseq_audit_until": cls.day + timedelta(days=10),
                           "hsseq_audit_site_ids": [(6, 0, cls.site.ids)]})

    def _ready(self, rot, journey=True):
        """Rotation contrôlée, alcootest négatif et, sauf demande, plan de trajet validé conforme."""
        self.check(rot, template=self.tipper_template if rot.vehicle_id == self.tipper else None)
        self.breath(rot)
        if journey:
            start = datetime.combine(rot.date_loading, time(7, 0))
            self.env["eguitra.hsseq.journey"].create({
                "rotation_id": rot.id, "planned_departure": start, "planned_arrival": start + timedelta(hours=8),
                "stop_ids": [(0, 0, {"kind": "break", "planned_at": start + timedelta(hours=4),
                                     "duration_minutes": 45})]}).action_validate()
        return rot

    def _waive(self, rot, code):
        status, waiver = self.api("ibrahima", "POST", "/hsseq/waivers",
                                  {"rotation_id": rot.id, "reason_code": code, "justification": f"Dérogation {code}"})
        self.assertEqual((status, waiver["status"]), (200, "pending_hsseq"), waiver)
        status, active = self.api("kadi.hsseq", "POST", f"/hsseq/waivers/{waiver['id']}/approve")
        self.assertEqual((status, active["status"]), (200, "active"), active)
        return active

    def test_v06_bareme_et_etancheite_des_citernes(self):
        rot = self._ready(self._rotation())
        self.assertEqual(self.codes(rot), [])
        calibration = self.truck.document_ids.filtered(lambda d: d.kind == "calibration")
        calibration.expiry_date = self.day - timedelta(days=1)
        [v06] = rot._hsseq_evaluate()["reasons"]
        self.assertEqual((v06["code"], v06["waivable"]), ("V06", True))
        self.assertIn("barémage", v06["detail"])
        self._waive(rot, "V06")
        self.assertTrue(rot._hsseq_evaluate()["allowed"], "Dérogation V06 : départ autorisé")
        tightness = self.truck.document_ids.filtered(lambda d: d.kind == "tightness")
        tightness.unlink()
        fresh = self._ready(self._rotation())
        calibration.expiry_date = self.day + timedelta(days=100)
        evaluation = fresh._hsseq_evaluate()
        self.assertEqual(([r["code"] for r in evaluation["reasons"]], [w["code"] for w in evaluation["warnings"]]),
                         ([], ["V06"]), "Absent avant la date de mise en service des documents : avertissement")
        self.settings.documents_required_from = self.day
        self.assertEqual(self.codes(fresh), ["V06"], "Même date de mise en service que V05")
        tipper_rot = self._ready(self._rotation(vehicle_id=self.tipper.id))
        self.assertNotIn("V06", self.codes(tipper_rot), "Benne : pas de barémage")

    def test_v07_charge_pesee_et_nouvelle_pesee(self):
        rot = self._ready(self._rotation(vehicle_id=self.tipper.id))
        rot.write({"weigh_ticket": "TP-1", "weight_gross": 50.0, "weight_tare": 15.0})
        [v07] = [r for r in rot._hsseq_evaluate()["reasons"] if r["code"] == "V07"]
        self.assertIn("délester de 5.00 t", v07["detail"])
        with self.assertRaises(RotationBlocked):
            rot.with_user(self.parc).action_depart()
        path = f"/hsseq/rotations/{rot.id}/reweigh"
        payload = {"weigh_ticket": "TP-2", "weight_gross": 44.0, "weight_tare": 15.0, "comment": "Délestage de 6 t"}
        for login in ("kadi.hsseq", "dg.hsseq", "admin.hsseq", "sekou.parc", "awa.auditrice"):
            status, _b = self.api(login, "POST", path, payload)
            self.assertEqual(status, 403, f"{login} ne refait pas la pesée")
        status, _b = self.driver_api("POST", path, payload)
        self.assertEqual(status, 403)
        status, body = self.api("ibrahima", "POST", path, dict(payload, weight_tare=60.0))
        self.assertEqual((status, body["error"]), (400, "invalid_parameter"))
        status, body = self.api("ibrahima", "POST", path, payload)
        self.assertEqual((status, body["overload_tonnes"], body["weigh_ticket"]), (200, 0.0, "TP-2"), body)
        self.assertNotIn("V07", [r["code"] for r in body["lock"]["reasons"]], "Nouvelle pesée : V07 levé")
        journal = self.env["eguitra.hsseq.journal"].search([("model", "=", "rotation"), ("res_id", "=", rot.id),
                                                            ("action", "=", "reweigh")])
        self.assertIn("TP-1", journal.old_value, "L'ancienne pesée reste au journal")
        heavy = self._ready(self._rotation(vehicle_id=self.tipper.id))
        heavy.write({"weight_gross": 48.0, "weight_tare": 15.0})
        self._waive(heavy, "V07")
        self.assertTrue(heavy._hsseq_evaluate()["allowed"], "Dérogation V07")
        heavy.with_user(self.parc).action_depart()
        status, body = self.api("ibrahima", "POST", f"/hsseq/rotations/{heavy.id}/reweigh", payload)
        self.assertEqual((status, body["error"]), (422, "invalid_transition"), "Rotation partie : plus de pesée")
        tanker = self._ready(self._rotation())
        tanker.write({"weight_gross": 60.0, "weight_tare": 15.0})
        self.assertNotIn("V07", self.codes(tanker), "Citerne : V07 ne s'applique pas")

    def test_v08_plan_de_trajet(self):
        rot = self._ready(self._rotation(), journey=False)
        [v08] = rot._hsseq_evaluate()["reasons"]
        self.assertEqual((v08["code"], v08["waivable"]), ("V08", True))
        self.assertIn("Aucun plan", v08["detail"])
        path = f"/hsseq/rotations/{rot.id}/journey"
        start = datetime.combine(rot.date_loading, time(7, 0))
        plan = {"itinerary": "RN1 par Kindia et Mamou", "planned_departure": fields.Datetime.to_string(start),
                "planned_arrival": fields.Datetime.to_string(start + timedelta(hours=8)), "night_driving": False,
                "stops": [{"kind": "break", "place": "Kindia", "planned_at": fields.Datetime.to_string(
                    start + timedelta(hours=4)), "duration_minutes": 45}]}
        for login in ("kadi.hsseq", "dg.hsseq", "admin.hsseq", "sekou.parc", "awa.auditrice"):
            for method, sub in (("PUT", ""), ("POST", "/validate")):
                status, _b = self.api(login, method, path + sub, plan)
                self.assertEqual(status, 403, f"{login} {method} {sub}")
        status, _b = self.driver_api("PUT", path, plan)
        self.assertEqual(status, 403)
        status, body = self.api("ibrahima", "PUT", path, plan)
        self.assertEqual((status, body["journey"]["status"], body["transitions"]), (200, "draft", ["validate"]), body)
        self.assertEqual(body["journey"]["driving_hours_by_day"][0]["hours"], 7.25, "Pause déduite")
        self.assertIn("à valider", rot._hsseq_evaluate()["reasons"][0]["detail"])
        status, body = self.api("ibrahima", "POST", f"{path}/validate")
        self.assertEqual((status, body["journey"]["status"]), (200, "validated"), body)
        self.assertEqual(self.codes(rot), [], "Plan validé : V08 levé")
        status, read = self.driver_api("GET", path)
        self.assertEqual((status, read["journey"]["status"]), (200, "validated"), "Le conducteur lit son plan")
        status, read = self.api("awa.auditrice", "GET", path)
        self.assertEqual(status, 200)
        # Route interdite de nuit : un départ de nuit n'est pas validable ; le marquage après coup rouvre V08.
        for login in ("ibrahima", "awa.auditrice"):
            status, _b = self.api(login, "PATCH", f"/hsseq/routes/{self.route.id}", {"night_driving_forbidden": True})
            self.assertEqual(status, 403, f"{login} ne marque pas une route")
        status, route = self.api("kadi.hsseq", "PATCH", f"/hsseq/routes/{self.route.id}", {"night_driving_forbidden": True})
        self.assertEqual((status, route["night_driving_forbidden"]), (200, True))
        night = dict(plan, planned_departure=fields.Datetime.to_string(start - timedelta(hours=3)),
                     planned_arrival=fields.Datetime.to_string(start + timedelta(hours=5)), stops=[])
        status, body = self.api("ibrahima", "PUT", path, night)
        self.assertEqual((status, body["journey"]["status"], body["journey"]["drives_at_night"]), (200, "draft", True),
                         "Modifié après validation : à valider de nouveau")
        status, body = self.api("ibrahima", "POST", f"{path}/validate")
        self.assertEqual((status, body["error"], body["fields"]), (422, "journey_not_compliant", ["night_forbidden"]), body)
        self.assertIn("interdite de nuit", rot._hsseq_evaluate()["reasons"][0]["detail"])
        # Conduite prévue au-delà du maximum journalier (9 h par défaut).
        long_day = dict(plan, planned_arrival=fields.Datetime.to_string(start + timedelta(hours=11)), stops=[])
        status, body = self.api("ibrahima", "PUT", path, long_day)
        status, body = self.api("ibrahima", "POST", f"{path}/validate")
        self.assertEqual((status, body["fields"]), (422, ["driving_time"]), body)
        rested = dict(long_day, stops=[{"kind": "rest", "planned_at": fields.Datetime.to_string(start + timedelta(hours=5)),
                                        "duration_minutes": 150}])
        self.api("ibrahima", "PUT", path, rested)
        status, body = self.api("ibrahima", "POST", f"{path}/validate")
        self.assertEqual((status, body["journey"]["status"]), (200, "validated"), "Repos prévu : 8 h 30 de conduite")
        self.settings.max_driving_hours = 8
        self.assertEqual(self.codes(rot), ["V08"], "Maximum abaissé : le plan validé rouvre V08")
        self._waive(rot, "V08")
        self.assertTrue(rot._hsseq_evaluate()["allowed"], "Dérogation V08")

    def test_v09_immobilisation_par_un_evenement(self):
        rot = self._ready(self._rotation())
        event = self.event(event_type="road_accident", vehicle_id=self.truck.id)
        event.action_classify({"potential_severity": 5, "probability": 4})
        status, detail = self.api("kadi.hsseq", "GET", f"/hsseq/events/{event.id}")
        self.assertTrue(detail["immobilization_proposed"], "Criticité élevée : immobilisation proposée")
        self.assertIn("immobilize", detail["transitions"])
        path = f"/hsseq/events/{event.id}/immobilize"
        for login in ("ibrahima", "dg.hsseq", "admin.hsseq", "awa.auditrice"):
            status, _b = self.api(login, "POST", path, {"reason": "Enquête"})
            self.assertEqual(status, 403, f"{login} n'immobilise pas")
        low = self.event(vehicle_id=self.truck.id)
        low.action_classify({"potential_severity": 1, "probability": 2})
        status, body = self.api("kadi.hsseq", "POST", f"/hsseq/events/{low.id}/immobilize", {"reason": "x"})
        self.assertEqual((status, body["error"]), (422, "invalid_transition"), "Criticité élevée seulement")
        status, immobilization = self.api("kadi.hsseq", "POST", path, {"reason": "Expertise du système de freinage"})
        self.assertEqual((status, immobilization["status"]), (200, "active"), immobilization)
        self.assertTrue(self.truck.hsseq_immobilized)
        self.assertEqual((self.truck.hsseq_immobilization_event_id, event.vehicle_immobilized), (event, True))
        [v09] = rot._hsseq_evaluate()["reasons"]
        self.assertEqual((v09["code"], v09["waivable"]), ("V09", True))
        self.assertIn(event.reference, v09["detail"])
        status, body = self.api("kadi.hsseq", "POST", path, {"reason": "Encore"})
        self.assertEqual((status, body["error"]), (422, "invalid_transition"), "Déjà immobilisé")
        status, listing = self.api("awa.auditrice", "GET", "/hsseq/immobilizations?status=active")
        self.assertEqual((status, listing["counts"]["active"]), (200, 1), listing)
        release = f"/hsseq/vehicles/{self.truck.id}/release"
        for login in ("ibrahima", "dg.hsseq", "awa.auditrice"):
            status, _b = self.api(login, "POST", release, {"reason": "Réparé"})
            self.assertEqual(status, 403, f"{login} ne lève pas l'immobilisation")
        status, body = self.api("kadi.hsseq", "POST", release, {})
        self.assertEqual((status, body["error"]), (422, "reason_required"))
        status, lifted = self.api("kadi.hsseq", "POST", release, {"reason": "Expertise faite, freins remplacés"})
        self.assertEqual((status, lifted["status"], lifted["lift_reason"]), (200, "lifted", "Expertise faite, freins remplacés"))
        self.assertFalse(self.truck.hsseq_immobilized)
        self.assertEqual(self.codes(rot), [], "Levée : V09 tombe")
        # Dérogation : V09 est dérogeable.
        self.api("kadi.hsseq", "POST", path, {"reason": "Nouvelle expertise"})
        self._waive(rot, "V09")
        self.assertTrue(rot._hsseq_evaluate()["allowed"])

    def test_activation_par_type_et_par_site(self):
        rot = self._ready(self._rotation(), journey=False)
        self.assertEqual(self.codes(rot), ["V08"])
        status, body = self.api("kadi.hsseq", "PATCH", "/hsseq/lock/reasons",
                                {"code": "V08", "disabled_sites": [self.site.id]})
        self.assertEqual(status, 200, body)
        self.assertEqual(self.codes(rot), [], "V08 désactivé pour le site")
        self.api("kadi.hsseq", "PATCH", "/hsseq/lock/reasons", {"code": "V08", "disabled_sites": [],
                                                                "vehicle_kinds": ["tipper"]})
        self.assertEqual(self.codes(rot), [], "V08 réservé aux bennes : la citerne n'est plus concernée")
        for code in ("V01", "V03"):
            status, body = self.api("ibrahima", "POST", "/hsseq/waivers",
                                    {"rotation_id": self._rotation().id, "reason_code": code, "justification": "x"})
            self.assertEqual((status, body["error"]), (422, "not_waivable"), "V01 et V03 jamais dérogeables")
