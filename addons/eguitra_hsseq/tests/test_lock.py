import json
from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import tagged

from odoo.addons.eguitra_transport.blocking import RotationBlocked

from ..models.common import HsseqError
from .common import HsseqCase

BRAKES = "Freins et ralentisseur, essai statique"
LIGHTS = "Éclairage et feux de détresse"


@tagged("post_install", "-at_install")
class TestLock(HsseqCase):
    """Contrôles avant départ, verrou V01 à V05, dérogations, rattachement des saisies sans rotation et
    crochets de Transport (départ en route, validation)."""

    def test_grilles_initiales(self):
        for template, kind in ((self.tanker_template, "tanker"), (self.tipper_template, "tipper")):
            items = template._items()
            self.assertEqual(template.vehicle_kind, kind)
            self.assertEqual(len(items.filtered("blocking")), 8, "Huit points critiques par type (§5)")
            self.assertEqual(len(items.filtered(lambda i: not i.blocking)), 5, "Cinq points communs non bloquants")
            self.assertEqual(items.filtered("linked_to").label, "Alcootest du conducteur négatif")
        status, templates = self.driver_api("GET", "/hsseq/checks/templates?vehicle_kind=tanker")
        self.assertEqual(status, 200, templates)
        [grid] = [t for t in templates if t["id"] == self.tanker_template.id]
        version = grid["version"]
        self.assertTrue(grid["updated_at"])
        status, body = self.api("kadi.hsseq", "PATCH", f"/hsseq/checks/templates/{grid['id']}", {
            "items": [dict(i, label=i["label"] + " ") if i["label"] == LIGHTS else i for i in grid["items"]]
            + [{"label": "Gilet haute visibilité porté", "blocking": False, "sequence": 200}]})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["version"], version + 1, "Une modification, une version")

    def test_controle_et_v02_d_une_rotation_a_l_autre(self):
        rot = self._rotation()
        status, body = self.api("ibrahima", "POST", "/hsseq/checks", {
            "client_uuid": "ctl-1", "template_id": self.tanker_template.id, "rotation_id": rot.id,
            "answers": self.answers(self.tanker_template)[:3]})
        self.assertEqual((status, body["error"]), (422, "incomplete_answers"), body)
        status, body = self.api("ibrahima", "POST", "/hsseq/checks", {
            "client_uuid": "ctl-1", "template_id": self.tipper_template.id, "rotation_id": rot.id,
            "answers": self.answers(self.tipper_template)})
        self.assertEqual((status, body["error"]), (422, "vehicle_kind_mismatch"), body)
        payload = {"client_uuid": "ctl-1", "template_id": self.tanker_template.id, "rotation_id": rot.id,
                   "reported_at": fields.Datetime.to_string(fields.Datetime.now()), "offline": True, "duration_s": 190,
                   "latitude": 9.53, "longitude": -13.68, "gps_accuracy": 12,
                   "answers": self.answers(self.tanker_template, failing=(BRAKES, LIGHTS))}
        status, check = self.api("ibrahima", "POST", "/hsseq/checks", payload)
        self.assertEqual(status, 200, check)
        self.assertEqual((check["result"], check["photos_missing"], len(check["nonconformities"])), ("blocking", True, 2),
                         "Accepté sans ses photos, signalées ensuite")
        self.assertFalse(check["rights"]["can_approve"], "Pas de contre-visa au lot 1")
        status, again = self.api("ibrahima", "POST", "/hsseq/checks", payload)
        self.assertEqual((status, again["id"]), (200, check["id"]), "Renvoi idempotent")
        brakes = next(nc for nc in check["nonconformities"] if nc["item"]["label"] == BRAKES)
        status, photo = self.upload("ibrahima", model="nonconformity", id=brakes["id"])
        self.assertEqual(status, 200, photo)
        self.assertIn("V02", self.codes(rot), "Point critique non conforme")
        # D'une rotation à l'autre : la non-conformité suit l'ensemble.
        other = self._rotation()
        self.check(other)
        self.assertIn("V02", self.codes(other))
        status, body = self.api("ibrahima", "POST", f"/hsseq/checks/{check['id']}/lift",
                                {"nonconformity_id": brakes["id"], "comment": "Garnitures remplacées"})
        self.assertEqual((status, body["error"]), (422, "photo_missing"), "Levée sans photo de la correction")
        status, fix = self.upload("ibrahima", name="correction.png")
        status, lifted = self.api("ibrahima", "POST", f"/hsseq/checks/{check['id']}/lift", {
            "nonconformity_id": brakes["id"], "comment": "Garnitures remplacées", "attachment_ids": [fix["id"]]})
        self.assertEqual(status, 200, lifted)
        row = next(nc for nc in lifted["nonconformities"] if nc["id"] == brakes["id"])
        self.assertEqual((row["status"], row["lift_photos"][0]["id"]), ("lifted", fix["id"]))
        self.assertNotIn("V02", self.codes(other), "Levée : V02 tombe pour toutes les rotations de l'ensemble")

    def test_verrou_v01_a_v05(self):
        rot = self._rotation()
        evaluation = rot._hsseq_evaluate()
        self.assertTrue(evaluation["lock_active"])
        self.assertEqual([r["code"] for r in evaluation["reasons"]], ["V01", "V03"])
        self.assertTrue(evaluation["pending_checks_only"], "Contrôle et alcootest à faire : « À contrôler »")
        self.assertTrue(all(r["severity"] == "block" for r in evaluation["reasons"]))
        self.assertFalse(evaluation["allowed"])
        self.check(rot)
        self.assertEqual(self.codes(rot), ["V03"])
        self.breath(rot, "not_done")
        [v03] = rot._hsseq_evaluate()["reasons"]
        self.assertTrue(v03["pending"], "Alcootest non réalisé : à faire")
        self.breath(rot)
        self.assertEqual(rot._hsseq_evaluate()["reasons"], [], "Contrôle et alcootest négatif : départ autorisé")
        # V04 : habilitation obligatoire expirée (RH).
        qual = self.employee.qualification_ids.filtered(lambda q: q.type_id.code == "MATIERES_DANGEREUSES")
        qual.expiry_date = self.day - timedelta(days=2)
        [v04] = rot._hsseq_evaluate()["reasons"]
        self.assertEqual((v04["code"], v04["pending"], v04["waivable"]), ("V04", False, True))
        qual.unlink()
        evaluation = rot._hsseq_evaluate()
        self.assertEqual((evaluation["reasons"], [w["code"] for w in evaluation["warnings"]]), ([], ["V04"]),
                         "Habilitation absente avant la date de mise en service : avertissement")
        self.settings.qualifications_required_from = self.day - timedelta(days=1)
        self.assertEqual(self.codes(rot), ["V04"], "Après la date : l'absence bloque comme l'expiration")
        self.settings.qualifications_required_from = False
        # V05 : assurance expirée (Transport).
        insurance = self.truck.document_ids.filtered(lambda d: d.kind == "insurance")
        insurance.expiry_date = self.day - timedelta(days=1)
        self.assertEqual(self.codes(rot), ["V05"])
        insurance.unlink()
        self.assertEqual(self.codes(rot), [], "Assurance absente avant la date de mise en service : avertissement")
        self.settings.documents_required_from = self.day
        self.assertEqual(self.codes(rot), ["V05"])
        self.settings.documents_required_from = False
        # Paramétrage : un motif désactivé pour le site ne s'évalue plus.
        self.env.ref("eguitra_hsseq.reason_v01").disabled_site_ids = self.site
        fresh = self._rotation()
        self.breath(fresh)
        self.assertEqual(self.codes(fresh), [])

    def test_v03_positif_retire_le_conducteur(self):
        rot = self._rotation()
        self.check(rot)
        test = self.breath(rot, "positive")
        self.assertTrue(test.driver_removed)
        self.assertFalse(rot.driver_id, "Positif : conducteur retiré de la rotation")
        [v03] = rot._hsseq_evaluate()["reasons"]
        self.assertEqual((v03["code"], v03["pending"], v03["waivable"]), ("V03", False, False),
                         "Positif : un échec, pas une saisie à faire ; jamais dérogeable")
        rot.driver_id = self.driver
        self.breath(rot)
        self.assertEqual(self.codes(rot), ["V03"], "Le même conducteur reste exclu de la rotation")
        self.assertIsNone(rot._hsseq_evaluate(detail=False)["reasons"][0]["detail"], "Détail de V03 hors hsseq : nul")

    def test_depart_et_validation_par_transport(self):
        rot = self._rotation()
        with self.assertRaises(RotationBlocked) as refus:
            rot.with_user(self.parc).action_depart()
        self.assertEqual({b["code"] for b in refus.exception.blockers if b["severity"] == "block"}, {"V01", "V03"})
        self.assertEqual(set(refus.exception.blockers[0]), {"code", "label", "source", "since", "waivable", "severity"})
        with self.assertRaises(RotationBlocked):
            rot.action_validate()
        self.check(rot)
        self.breath(rot)
        with self.assertRaises(AccessError):
            rot.with_user(self.hsseq).action_depart()
        with self.assertRaises(AccessError):
            rot.with_user(self.parc2).action_depart()
        rot.with_user(self.parc).action_depart()
        self.assertEqual(rot.state, "en_route")
        rot.action_validate()
        self.assertEqual(rot.state, "done", "Passée par « en route » : la validation est permise")
        status, body = self.api("ibrahima", "POST", f"/transport/rotations/{self._rotation().id}/depart")
        self.assertEqual((status, body["error"]), (422, "departure_blocked"), body)
        self.assertTrue(body["blockers"])

    def test_validation_exige_le_depart(self):
        rot = self._rotation()
        with self.assertRaises(RotationBlocked) as refus:
            rot.action_validate()
        self.assertIn("H01", [b["code"] for b in refus.exception.blockers])
        old = self._rotation(date_loading=self.day - timedelta(days=60))
        old.action_validate()
        self.assertEqual(old.state, "done", "Avant la mise en service du verrou : Transport comme avant")
        self.settings.lock_start_date = False
        free = self._rotation()
        self.assertFalse(free._hsseq_lock_active())
        self.assertEqual([b["code"] for b in free._departure_blockers()], [], "Verrou pas en service : rien ne bloque")

    def test_derogations(self):
        rot = self._rotation()
        self.check(rot, failing=(BRAKES,))
        self.breath(rot)
        status, body = self.api("ibrahima", "POST", "/hsseq/waivers",
                                {"rotation_id": rot.id, "reason_code": "V01", "justification": "Contrôle fait sur papier"})
        self.assertEqual((status, body["error"]), (422, "not_waivable"))
        status, body = self.api("ibrahima", "POST", "/hsseq/waivers",
                                {"rotation_id": rot.id, "reason_code": "V03", "justification": "Appareil en panne"})
        self.assertEqual((status, body["error"]), (422, "not_waivable"))
        status, body = self.api("ibrahima", "POST", "/hsseq/waivers",
                                {"rotation_id": rot.id, "reason_code": "V05", "justification": "Assurance en cours"})
        self.assertEqual((status, body["error"]), (422, "reason_not_open"))
        status, body = self.api("ibrahima", "POST", "/hsseq/waivers", {"rotation_id": rot.id, "reason_code": "V02"})
        self.assertEqual((status, body["error"]), (422, "reason_required"), "Justification écrite obligatoire")
        status, waiver = self.api("ibrahima", "POST", "/hsseq/waivers", {
            "rotation_id": rot.id, "reason_code": "V02", "justification": "Réparation de fortune validée par le garage"})
        self.assertEqual((status, waiver["status"]), (200, "pending_hsseq"), waiver)
        self.assertEqual([a["level"] for a in waiver["approvals"]], [1], "La demande vaut première validation")
        status, body = self.api("ibrahima", "POST", "/hsseq/waivers", {
            "rotation_id": rot.id, "reason_code": "V02", "justification": "Deuxième demande"})
        self.assertEqual(status, 409, "Une demande en cours pour ce motif")
        status, body = self.api("kadi.hsseq", "POST", "/hsseq/waivers", {
            "rotation_id": rot.id, "reason_code": "V02", "justification": "Le responsable HSSEQ ne demande pas"})
        self.assertEqual(status, 403)
        self.assertFalse(rot._hsseq_evaluate()["allowed"], "En attente de la seconde validation")
        status, active = self.api("kadi.hsseq", "POST", f"/hsseq/waivers/{waiver['id']}/approve")
        self.assertEqual((status, active["status"]), (200, "active"), active)
        self.assertEqual([a["by"]["id"] for a in active["approvals"]], [self.parc.id, self.hsseq.id],
                         "Deux validations, deux personnes distinctes")
        self.assertTrue(active["management_notified_at"], "Directeur général prévenu")
        evaluation = rot._hsseq_evaluate()
        self.assertTrue(evaluation["allowed"])
        self.assertEqual(evaluation["reasons"][0]["waiver_id"], waiver["id"])
        rot.with_user(self.parc).action_depart()
        self.assertEqual([w["code"] for w in json.loads(rot.departure_log)["waived"]], ["V02"], "Dérogation tracée au départ")
        rot.action_validate()
        self.assertEqual(self.env["eguitra.hsseq.waiver"].browse(waiver["id"]).status, "expired",
                         "Expire à la fin de la rotation")

    def test_quatre_yeux_meme_avec_deux_profils(self):
        """Un compte exploitation et hsseq demande : il ne donne pas lui-même la seconde validation."""
        both = self._create_user("double.casquette", "exploitation", "hsseq")
        self.site.manager_ids = [(4, both.id)]
        rot = self._rotation()
        self.check(rot, failing=(BRAKES,))
        waiver = self.env["eguitra.hsseq.waiver"].with_user(both)._hsseq_request(rot, "V02", "Réparation provisoire")
        with self.assertRaises(HsseqError) as refus:
            waiver.with_user(both).action_approve()
        self.assertEqual(refus.exception.code, "four_eyes")
        status, body = self.api("double.casquette", "POST", f"/hsseq/waivers/{waiver.id}/approve")
        self.assertEqual((status, body["error"]), (422, "four_eyes"), body)
        status, body = self.api("double.casquette", "POST", f"/hsseq/waivers/{waiver.id}/refuse", {"reason": "Non"})
        self.assertEqual((status, body["error"]), (422, "four_eyes"), body)
        waiver.with_user(self.hsseq2).action_approve()
        self.assertEqual(waiver.status, "active")

    def test_rattachement_des_saisies_sans_rotation(self):
        """Contrôle et alcootest saisis avant l'affectation : rattachés dans leur fenêtre, une seule fois."""
        early = self.check(rotation=None, reported_at=fields.Datetime.now() - timedelta(hours=13))
        test_old = self.breath(rotation=None, reported_at=fields.Datetime.now() - timedelta(hours=5))
        rot = self._rotation()
        self.assertEqual(self.codes(rot), ["V01", "V03"], "Hors de la fenêtre (12 h, 4 h) : rien n'est rattaché")
        recent = self.check(rotation=None)
        test = self.breath(rotation=None)
        self.assertEqual(self.codes(rot), [], "Dans la fenêtre : la saisie compte pour la rotation")
        status, evaluation = self.api("ibrahima", "POST", "/hsseq/lock/evaluate", {"rotation_id": rot.id})
        self.assertEqual((status, evaluation["allowed"]), (200, True), evaluation)
        self.assertEqual((recent.rotation_id, test.rotation_id), (rot, rot), "Rattachés à l'évaluation demandée")
        self.assertFalse(early.rotation_id or test_old.rotation_id)
        journal = self.env["eguitra.hsseq.journal"].search([("model", "=", "check"), ("res_id", "=", recent.id),
                                                            ("action", "=", "attach")])
        self.assertTrue(journal, "Rattachement tracé au journal")
        second = self._rotation()
        self.assertEqual(self.codes(second), ["V01", "V03"], "Pas de double rattachement")

    def test_api_evaluation_et_departs(self):
        rot = self._rotation()
        status, evaluation = self.driver_api("POST", "/hsseq/lock/evaluate", {"rotation_id": rot.id})
        self.assertEqual(status, 200, evaluation)
        self.assertEqual({"rotation_id", "allowed", "reasons", "active_waiver", "checked_at"} - set(evaluation), set())
        v03 = next(r for r in evaluation["reasons"] if r["code"] == "V03")
        self.assertIsNone(v03["detail"], "Détail de V03 nul hors du profil hsseq")
        self.assertEqual(rot.state, "draft", "L'évaluation ne change pas l'état")
        self.assertTrue(self.env["eguitra.hsseq.lock.log"].search_count([("rotation_id", "=", rot.id)]),
                        "Chaque évaluation est journalisée")
        status, departures = self.api("ibrahima", "GET", "/hsseq/lock/departures")
        self.assertEqual(status, 200, departures)
        item = next(i for i in departures["items"] if i["rotation"]["id"] == rot.id)
        self.assertTrue(item["pending_checks_only"])
        status, mine = self.driver_api("GET", "/hsseq/me/rotations")
        self.assertEqual((status, [r["id"] for r in mine["items"]]), (200, [rot.id]), mine)
        self.assertEqual(set(mine["items"][0]["lock"]) >= {"allowed", "pending_checks_only", "reasons"}, True)
        status, _b = self.api("dg.hsseq", "GET", "/hsseq/me/rotations")
        self.assertEqual(status, 403, "Rotations du jour : refusées à la direction")
        status, reasons = self.api("kadi.hsseq", "GET", "/hsseq/lock/reasons")
        self.assertEqual([r["code"] for r in reasons], [f"V0{i}" for i in range(1, 10)])
        status, body = self.api("kadi.hsseq", "PATCH", "/hsseq/lock/reasons", {"code": "V07", "active": True})
        self.assertEqual((status, body["error"]), (422, "not_in_lot_1"))
        status, body = self.api("admin.hsseq", "PATCH", "/hsseq/lock/reasons",
                                {"code": "V02", "vehicle_kinds": ["tanker"], "disabled_sites": [self.site2.id]})
        self.assertEqual((status, body["vehicle_kinds"], body["disabled_sites"][0]["id"]), (200, ["tanker"], self.site2.id))
