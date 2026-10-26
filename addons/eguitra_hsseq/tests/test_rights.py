from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import HsseqCase

BRAKES = "Freins et ralentisseur, essai statique"


@tagged("post_install", "-at_install")
class TestRights(HsseqCase):
    """Droits par profil (spécification §8, contrat §2) : refus de chaque route d'écriture hors profil,
    confidentialité des alcootests, conducteur borné à NIMOVA Terrain et à ses propres saisies, pièces
    jointes citées par leur seul déposant."""

    def _fixtures(self):
        rot = self._rotation()
        check = self.check(rot, failing=(BRAKES,))
        test = self.breath(rot)
        event = self.event()
        action = self.env["eguitra.hsseq.action"].create({
            "origin": "event", "event_id": event.id, "description": "Former les agents au balisage",
            "owner_id": self.parc.id, "due_date": self.day + timedelta(days=10)})
        waiver = self.env["eguitra.hsseq.waiver"].with_user(self.parc)._hsseq_request(rot, "V02", "Réparation provisoire")
        return rot, check, test, event, action, waiver

    def test_refus_par_profil_des_routes_d_ecriture(self):
        rot, check, _test, event, action, waiver = self._fixtures()
        nc = check.nonconformity_ids[:1]
        template = self.tanker_template
        now = fields.Datetime.to_string(fields.Datetime.now())
        declaration = {"client_uuid": "refus", "type": "hazard", "title": "Essai", "description": "Essai",
                       "occurred_at": now}
        routes = [
            # (méthode, chemin, corps, comptes refusés)
            ("POST", "/hsseq/events", declaration, ["fatou", "rh.hsseq"]),
            ("PATCH", f"/hsseq/events/{event.id}", {"location": "Quai"}, ["dg.hsseq", "admin.hsseq", "fatou"]),
            ("POST", f"/hsseq/events/{event.id}/classify", {"potential_severity": 2, "probability": 2},
             ["ibrahima", "dg.hsseq", "admin.hsseq"]),
            ("PUT", f"/hsseq/events/{event.id}/investigation", {"root_cause": "x"}, ["ibrahima", "dg.hsseq"]),
            ("POST", f"/hsseq/events/{event.id}/costs", {"kind": "repair", "amount": 1}, ["ibrahima", "dg.hsseq"]),
            ("POST", "/hsseq/actions", {"origin": "event", "origin_id": event.id, "description": "x",
                                        "owner_id": self.parc.id, "due_date": str(self.day)},
             ["ibrahima", "dg.hsseq", "admin.hsseq"]),
            ("PATCH", f"/hsseq/actions/{action.id}", {"description": "y"}, ["dg.hsseq", "admin.hsseq"]),
            ("POST", f"/hsseq/actions/{action.id}/cancel", {"reason": "x"}, ["ibrahima", "dg.hsseq"]),
            ("POST", f"/hsseq/actions/{action.id}/approve", {}, ["ibrahima", "kadi.hsseq"]),
            ("POST", "/hsseq/checks/templates", {"name": "Grille", "vehicle_kind": "tanker"}, ["ibrahima", "dg.hsseq"]),
            ("PATCH", f"/hsseq/checks/templates/{template.id}", {"name": "Grille"}, ["ibrahima", "dg.hsseq"]),
            ("POST", "/hsseq/checks", {"template_id": template.id, "rotation_id": rot.id, "answers": []},
             ["dg.hsseq", "admin.hsseq", "fatou"]),
            ("POST", f"/hsseq/checks/{check.id}/lift", {"nonconformity_id": nc.id}, ["dg.hsseq", "sekou.parc"]),
            ("POST", "/hsseq/breath-tests", {"rotation_id": rot.id, "performed": True, "result": "negative"},
             ["dg.hsseq", "admin.hsseq", "fatou"]),
            ("POST", "/hsseq/waivers", {"rotation_id": rot.id, "reason_code": "V02", "justification": "x"},
             ["kadi.hsseq", "dg.hsseq", "admin.hsseq", "sekou.parc"]),
            ("POST", f"/hsseq/waivers/{waiver.id}/approve", {}, ["ibrahima", "dg.hsseq", "admin.hsseq"]),
            ("POST", f"/hsseq/waivers/{waiver.id}/refuse", {"reason": "x"}, ["ibrahima", "dg.hsseq"]),
            ("POST", f"/hsseq/waivers/{waiver.id}/cancel", {}, ["dg.hsseq", "admin.hsseq"]),
            ("POST", "/hsseq/sites", {"name": "Dépôt", "code": "DEP"}, ["ibrahima", "dg.hsseq"]),
            ("PATCH", f"/hsseq/sites/{self.site.id}", {"name": "Parc"}, ["ibrahima", "dg.hsseq"]),
            ("PATCH", "/hsseq/lock/reasons", {"code": "V02", "active": False}, ["ibrahima", "dg.hsseq"]),
            ("PATCH", "/hsseq/settings", {"check_window_hours": 6}, ["ibrahima", "dg.hsseq"]),
            ("GET", "/hsseq/log", None, ["ibrahima"]),
            ("GET", "/hsseq/cockpit", None, ["rh.hsseq"]),
        ]
        for method, path, payload, logins in routes:
            for login in logins:
                status, body = self.api(login, method, path, payload)
                self.assertIn(status, (403, 404), f"{login} {method} {path} : {status} {body}")
        # Le conducteur, depuis NIMOVA Terrain, est refusé hors de son périmètre.
        for method, path, payload in [
            ("GET", "/hsseq/cockpit", None), ("GET", "/hsseq/actions", None), ("GET", "/hsseq/waivers", None),
            ("POST", f"/hsseq/events/{event.id}/classify", {"potential_severity": 2, "probability": 2}),
            ("POST", f"/hsseq/checks/{check.id}/lift", {"nonconformity_id": nc.id}),
            ("POST", "/hsseq/waivers", {"rotation_id": rot.id, "reason_code": "V02", "justification": "x"}),
            ("GET", "/hsseq/lock/departures", None), ("GET", "/hsseq/log", None),
            ("GET", "/transport/rotations", None),
        ]:
            status, body = self.driver_api(method, path, payload)
            if path == "/hsseq/actions":
                self.assertEqual((status, body["items"]), (200, []), "Aucune action dont il serait responsable")
                continue
            self.assertIn(status, (403, 404), f"conducteur {method} {path} : {status} {body}")

    def test_applications_du_conducteur(self):
        self.assertEqual(self.conducteur._eguitra_apps(), ["terrain"],
                         "NIMOVA Terrain seule, pas même « Mon espace » de la RH malgré son dossier salarié")
        status, body = self.call("POST", "/auth/login", {"login": "mamadou.conducteur", "password": "Motdepasse-2026!",
                                                         "app": "mobile"})
        self.assertEqual((status, body["error"]), (403, "app_forbidden"), "Aucune application web")
        self.assertIn("terrain", self.parc._eguitra_apps())
        self.assertIn("hsseq", self.parc._eguitra_apps())
        self.assertNotIn("terrain", self.dg._eguitra_apps())
        status, refs = self.driver_api("GET", "/hsseq/referentials")
        self.assertEqual(status, 200, refs)
        self.assertEqual((refs["me"]["driver_id"], refs["me"]["employee_id"]), (self.driver.id, self.employee.id))
        self.assertEqual([d["id"] for d in refs["drivers"]], [self.driver.id], "Le conducteur ne voit que lui-même")
        self.assertEqual((refs["check_window_hours"], refs["breath_test_window_hours"]), (12, 4))

    def test_confidentialite_des_alcootests(self):
        rot = self._rotation()
        status, created = self.driver_api("POST", "/hsseq/breath-tests", {
            "client_uuid": "alc-1", "rotation_id": rot.id, "performed": True, "result": "positive",
            "reading_mg_l": 0.42, "device": "Dräger 6820",
            "reported_at": (fields.Datetime.now() - timedelta(minutes=20)).isoformat() + "Z"})
        self.assertEqual(status, 200, created)
        self.assertEqual((created["access"], created["done"]), ("done", True))
        self.assertNotIn("status", created, "Le conducteur ne lit ni résultat ni conformité, même de sa saisie")
        self.assertNotIn("result", created)
        test_id = created["id"]
        status, again = self.driver_api("POST", "/hsseq/breath-tests", {
            "client_uuid": "alc-1", "rotation_id": rot.id, "performed": True, "result": "positive"})
        self.assertEqual((status, again["id"]), (200, test_id), "Idempotent")
        for login in ("ibrahima", "dg.hsseq", "admin.hsseq"):
            status, row = self.api(login, "GET", f"/hsseq/breath-tests/{test_id}")
            self.assertEqual((status, row["access"], row["status"]), (200, "status", "non_compliant"), login)
            for key in ("result", "reading_mg_l", "device", "performed_by", "reported_at"):
                self.assertNotIn(key, row, f"{login} ne lit pas {key}")
        reads = self.env["eguitra.hsseq.journal"].search_count([("model", "=", "breath_test"), ("res_id", "=", test_id),
                                                                ("action", "=", "read_detail")])
        status, detail = self.api("kadi.hsseq", "GET", f"/hsseq/breath-tests/{test_id}")
        self.assertEqual((status, detail["access"], detail["result"], detail["reading_mg_l"]),
                         (200, "detail", "positive", 0.42), detail)
        self.assertTrue(detail["driver_removed"])
        self.assertEqual(self.env["eguitra.hsseq.journal"].search_count([
            ("model", "=", "breath_test"), ("res_id", "=", test_id), ("action", "=", "read_detail")]), reads + 1,
            "Chaque lecture du détail est journalisée")
        status, listed = self.api("admin.hsseq", "GET", "/hsseq/breath-tests")
        self.assertTrue(all("result" not in r for r in listed["items"]), "L'administration ne lit jamais le détail")
        status, mine = self.driver_api("GET", "/hsseq/breath-tests")
        self.assertEqual((status, [r["access"] for r in mine["items"]]), (200, ["done"]))
        status, _b = self.driver_api("GET", "/hsseq/breath-tests?status=non_compliant")
        self.assertEqual(status, 403, "Filtrer par conformité révélerait le résultat")
        with self.assertRaises(AccessError):
            self.env["eguitra.hsseq.breath.test"].with_user(self.admin).browse(test_id).read(["result"])

    def test_conducteur_avec_un_autre_profil_reste_borne_a_lui_meme(self):
        """Privilège positif : un profil métier de plus (achats) n'élargit pas la portée du conducteur."""
        self.conducteur._eguitra_set_profiles(["conducteur", "achats"])
        other_driver = self.env["eguitra.transport.driver"].create({"name": "Lamine Barry"})
        other_truck = self.env["eguitra.transport.vehicle"].create({"name": "ER-02", "driver_id": other_driver.id,
                                                                     "capacity_liters": 40000})
        other = self._rotation(vehicle_id=other_truck.id)
        self.breath(other)
        token = self.open_session("mamadou.conducteur", app="terrain")["access_token"]
        headers = {"X-Eguitra-App": "terrain"}
        status, body = self.call("POST", "/hsseq/breath-tests", {"rotation_id": other.id, "performed": True,
                                                                 "result": "negative"}, token=token, headers=headers)
        self.assertEqual(status, 403, body)
        status, body = self.call("POST", "/hsseq/checks", {
            "template_id": self.tanker_template.id, "rotation_id": other.id,
            "answers": self.answers(self.tanker_template)}, token=token, headers=headers)
        self.assertEqual(status, 403, body)
        status, listed = self.call("GET", "/hsseq/breath-tests", token=token, headers=headers)
        self.assertEqual((status, listed["items"]), (200, []), "Les tests d'un autre conducteur restent invisibles")
        status, body = self.call("POST", "/hsseq/lock/evaluate", {"rotation_id": other.id}, token=token, headers=headers)
        self.assertEqual(status, 404)

    def test_portee_fermee_par_defaut_sur_les_routes_du_lot_1(self):
        """Chef de parc sans site rattaché : rien ; objet sans site : profils de lecture complète seulement
        (et son déclarant, son auteur ou son responsable)."""
        rot, check, test, event, action, waiver = self._fixtures()
        nobody = self._create_user("moussa.parc", "exploitation")
        for path, key in (("/hsseq/events", "items"), ("/hsseq/actions", "items"), ("/hsseq/checks", "items"),
                          ("/hsseq/checks/nonconformities", "items"), ("/hsseq/breath-tests", "items"),
                          ("/hsseq/waivers", "items"), ("/hsseq/lock/departures", "items"),
                          ("/hsseq/me/rotations", "items")):
            status, body = self.api("moussa.parc", "GET", path)
            self.assertEqual((status, body[key]), (200, []), f"Sans site rattaché : {path} vide")
        for path in (f"/hsseq/events/{event.id}", f"/hsseq/actions/{action.id}", f"/hsseq/checks/{check.id}",
                     f"/hsseq/breath-tests/{test.id}", f"/hsseq/waivers/{waiver.id}"):
            status, _b = self.api("moussa.parc", "GET", path)
            self.assertEqual(status, 404, f"Sans site rattaché : {path} introuvable")
        status, _b = self.api("moussa.parc", "POST", "/hsseq/lock/evaluate", {"rotation_id": rot.id})
        self.assertEqual(status, 404)
        status, _b = self.api("moussa.parc", "POST", "/hsseq/checks", {
            "template_id": self.tanker_template.id, "rotation_id": rot.id, "answers": self.answers(self.tanker_template)})
        self.assertEqual(status, 403, "Contrôle d'un ensemble hors de ses sites")
        # Objets sans site : invisibles du chef de parc d'un site, sauf ce qu'il a déclaré.
        loose = self.env["eguitra.transport.vehicle"].create({"name": "ER-99", "tractor_plate": "RC-9999-Z"})
        loose_check = self.check(vehicle=loose)
        foreign = self.event(vehicle_id=False, reported_by=self.hsseq.id, title="Glissade au siège")
        own = self.event(vehicle_id=False, title="Chute de plain-pied au parc")
        status, events = self.api("ibrahima", "GET", "/hsseq/events")
        ids = [e["id"] for e in events["items"]]
        self.assertNotIn(foreign.id, ids, "Événement sans site : profils de lecture complète")
        self.assertIn(own.id, ids, "Sa propre déclaration reste lisible")
        status, checks = self.api("ibrahima", "GET", "/hsseq/checks")
        self.assertNotIn(loose_check.id, [c["id"] for c in checks["items"]], "Ensemble sans site")
        status, _b = self.api("ibrahima", "GET", f"/hsseq/checks/{loose_check.id}")
        self.assertEqual(status, 404)
        status, events = self.api("dg.hsseq", "GET", "/hsseq/events")
        self.assertIn(foreign.id, [e["id"] for e in events["items"]], "Lecture complète : tout")
        self.assertTrue(nobody)

    def test_pieces_jointes_citees_par_leur_deposant(self):
        status, mine = self.upload("ibrahima")
        self.assertEqual((status, mine["model"]), (200, None), "Déposée avant sa fiche")
        status, theirs = self.upload("sekou.parc")
        payload = {"client_uuid": "evt-photo", "type": "hazard", "title": "Câble arraché",
                   "description": "Câble électrique au sol.", "occurred_at": fields.Datetime.to_string(fields.Datetime.now()),
                   "attachment_ids": [theirs["id"]]}
        status, body = self.api("ibrahima", "POST", "/hsseq/events", payload)
        self.assertEqual((status, body["error"]), (403, "forbidden"), "Pièce d'un autre déposant")
        payload["attachment_ids"] = [mine["id"]]
        status, event = self.api("ibrahima", "POST", "/hsseq/events", payload)
        self.assertEqual((status, [a["id"] for a in event["attachments"]]), (200, [mine["id"]]), event)
        status, body = self.api("ibrahima", "POST", "/hsseq/events", dict(payload, client_uuid="evt-photo-2"))
        self.assertEqual((status, body["error"]), (409, "conflict"), "Une pièce rattachée ne l'est pas à une autre fiche")
        status, body = self.upload("ibrahima", content=b"MZ\x90\x00", name="virus.png")
        self.assertEqual((status, body["error"]), (415, "unsupported_type"))
        status, body = self.upload("fatou")
        self.assertEqual(status, 403, "Dépôt réservé aux profils de l'application")
        orphan = self.env["eguitra.hsseq.attachment"].browse(theirs["id"])
        self.env.cr.execute("UPDATE eguitra_hsseq_attachment SET create_date = %s WHERE id = %s",
                            (fields.Datetime.now() - timedelta(days=8), orphan.id))
        self.env.invalidate_all()
        self.env["eguitra.hsseq.attachment"]._cron_purge_orphans()
        self.assertFalse(orphan.exists(), "Jamais citée : purgée après sept jours")
        self.assertTrue(self.env["eguitra.hsseq.attachment"].browse(mine["id"]).exists())
