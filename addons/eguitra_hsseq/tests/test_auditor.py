from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .common import HsseqCase

BRAKES = "Freins et ralentisseur, essai statique"


@tagged("post_install", "-at_install")
class TestAuditor(HsseqCase):
    """Profil auditeur (spécification §8) : NIMOVA · HSSEQ en lecture seule, bornée à ses sites et à sa date
    de fin d'accès ; jamais les alcootests ni les noms des personnes en cause."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.auditor = cls._create_user("awa.auditrice", "auditeur")
        cls.auditor.write({"hsseq_audit_until": cls.day + timedelta(days=10),
                           "hsseq_audit_site_ids": [(6, 0, cls.site.ids)]})

    def test_perimetre_par_les_parametres(self):
        status, rows = self.api("admin.hsseq", "GET", "/hsseq/auditors")
        self.assertEqual(status, 200, rows)
        [row] = [r for r in rows if r["id"] == self.auditor.id]
        self.assertEqual((row["expired"], [s["id"] for s in row["sites"]]), (False, [self.site.id]))
        until = str(self.day + timedelta(days=30))
        status, row = self.api("kadi.hsseq", "PATCH", f"/hsseq/auditors/{self.auditor.id}",
                               {"access_until": until, "site_ids": [self.site.id, self.site2.id]})
        self.assertEqual((status, row["access_until"], len(row["sites"])), (200, until, 2), row)
        for login in ("ibrahima", "dg.hsseq", "awa.auditrice"):
            status, _b = self.api(login, "PATCH", f"/hsseq/auditors/{self.auditor.id}", {"access_until": until})
            self.assertEqual(status, 403, f"{login} ne fixe pas le périmètre d'un auditeur")
        status, _b = self.api("kadi.hsseq", "PATCH", f"/hsseq/auditors/{self.parc.id}", {"access_until": until})
        self.assertEqual(status, 404, "Compte qui n'est pas auditeur")

    def test_lecture_seule_bornee_a_ses_sites(self):
        rot = self._rotation()
        check = self.check(rot, failing=(BRAKES,))
        test = self.breath(rot)
        mine = self.event(person_ids=[(0, 0, {"kind": "driver", "driver_id": self.driver.id, "role": "victim"})])
        other = self.event(vehicle_id=False, site_id=self.site2.id, title="Chute au quai de Boffa")
        nowhere = self.event(vehicle_id=False, reported_by=self.hsseq.id, title="Glissade au siège")
        self.assertEqual(self.auditor._eguitra_apps(), ["hsseq"], "L'auditeur n'ouvre que NIMOVA · HSSEQ")
        status, events = self.api("awa.auditrice", "GET", "/hsseq/events")
        self.assertEqual(status, 200, events)
        ids = [e["id"] for e in events["items"]]
        self.assertIn(mine.id, ids)
        self.assertNotIn(other.id, ids, "Événement d'un site hors de son périmètre")
        self.assertNotIn(nowhere.id, ids, "Événement sans site : hors du périmètre de l'auditeur")
        status, yard = self.api("ibrahima", "GET", "/hsseq/events")
        self.assertNotIn(nowhere.id, [e["id"] for e in yard["items"]], "Chef de parc aussi : fermé par défaut")
        status, full = self.api("dg.hsseq", "GET", "/hsseq/events")
        self.assertIn(nowhere.id, [e["id"] for e in full["items"]], "Profils de lecture complète : tout")
        status, _b = self.api("awa.auditrice", "GET", f"/hsseq/events/{other.id}")
        self.assertEqual(status, 404)
        status, detail = self.api("awa.auditrice", "GET", f"/hsseq/events/{mine.id}")
        self.assertEqual(status, 200, detail)
        self.assertIsNone(detail["reported_by"], "Pas le nom du déclarant")
        self.assertEqual([(p["name"], p["person_id"], p["role"]) for p in detail["people"]], [(None, None, "victim")],
                         "Personnes en cause sans nom")
        status, checks = self.api("awa.auditrice", "GET", "/hsseq/checks")
        self.assertEqual(status, 200, checks)
        [line] = [c for c in checks["items"] if c["id"] == check.id]
        self.assertIsNone(line["author"])
        self.assertIsNone(line["driver"]["name"])
        status, cockpit = self.api("awa.auditrice", "GET", "/hsseq/cockpit")
        self.assertEqual((status, cockpit["blocked_departures"]["items"]), (200, []), cockpit)
        status, refs = self.api("awa.auditrice", "GET", "/hsseq/referentials")
        self.assertEqual((status, refs["drivers"], refs["employees"]), (200, [], []), "Aucune liste nominative")
        for path in ("/hsseq/breath-tests", f"/hsseq/breath-tests/{test.id}", "/hsseq/lock/departures", "/hsseq/log",
                     "/hsseq/deadlines", f"/hsseq/events/{mine.id}/report.pdf", "/hsseq/events/export.xlsx",
                     "/hsseq/auditors", "/hsseq/me/rotations"):
            status, _b = self.api("awa.auditrice", "GET", path)
            self.assertEqual(status, 403, f"Auditeur : {path} refusé")
        now = fields.Datetime.to_string(fields.Datetime.now())
        writes = [
            ("POST", "/hsseq/events", {"client_uuid": "aud-1", "type": "hazard", "title": "x", "description": "x",
                                       "occurred_at": now}),
            ("PATCH", f"/hsseq/events/{mine.id}", {"location": "Quai"}),
            ("POST", "/hsseq/checks", {"template_id": self.tanker_template.id, "rotation_id": rot.id, "answers": []}),
            ("POST", f"/hsseq/checks/{check.id}/lift", {"nonconformity_id": check.nonconformity_ids.id}),
            ("POST", "/hsseq/lock/evaluate", {"rotation_id": rot.id}),
            ("POST", "/hsseq/waivers", {"rotation_id": rot.id, "reason_code": "V02", "justification": "x"}),
            ("PATCH", "/hsseq/settings", {"check_window_hours": 6}),
            ("POST", "/hsseq/notifications/1/read", {}),
        ]
        for method, path, payload in writes:
            status, body = self.api("awa.auditrice", method, path, payload)
            self.assertEqual(status, 403, f"Auditeur en écriture : {method} {path} {body}")
        status, _b = self.upload("awa.auditrice", model="event", id=mine.id)
        self.assertEqual(status, 403, "Auditeur : aucune pièce déposée")

    def test_acces_refuse_apres_la_date_de_fin(self):
        status, _b = self.api("awa.auditrice", "GET", "/hsseq/events")
        self.assertEqual(status, 200)
        self.auditor.hsseq_audit_until = self.day - timedelta(days=1)
        for path in ("/hsseq/events", "/hsseq/cockpit", "/hsseq/referentials", "/hsseq/checks"):
            status, body = self.api("awa.auditrice", "GET", path)
            self.assertEqual((status, body["error"]), (403, "forbidden"), f"Après la date de fin : {path}")
        self.assertNotIn("hsseq", self.auditor._eguitra_apps(), "Plus de connexion à NIMOVA · HSSEQ")
        self.auditor.hsseq_audit_until = False
        status, _b = self.api("awa.auditrice", "GET", "/hsseq/events")
        self.assertEqual(status, 403, "Sans date de fin : aucun accès")
        self.auditor.write({"hsseq_audit_until": self.day + timedelta(days=5), "hsseq_audit_site_ids": [(5, 0, 0)]})
        status, _b = self.api("awa.auditrice", "GET", "/hsseq/events")
        self.assertEqual(status, 403, "Sans site audité : aucun accès (fermé par défaut)")
        both = self._create_user("double.audit", "auditeur", "hsseq")
        self.assertIn("hsseq", both._eguitra_apps(), "Un autre profil garde l'application")
