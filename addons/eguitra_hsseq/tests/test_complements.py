from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import tagged

from odoo.addons.eguitra_transport.blocking import RotationBlocked

from .common import HsseqCase

BRAKES = "Freins et ralentisseur, essai statique"


@tagged("post_install", "-at_install")
class TestComplements(HsseqCase):
    """Compléments du lot 1 demandés par les écrans : matrice des événements du cockpit, rotations d'un
    véhicule à une date, salariés des référentiels, validations attendues des actions, photos manquantes
    sur la liste des contrôles."""

    def test_matrice_des_evenements_du_cockpit(self):
        self.env["eguitra.hsseq.event"].search([]).unlink()
        first = self.event(potential_severity=4, probability=3)
        self.event(potential_severity=4, probability=3)
        self.event(potential_severity=5, probability=5)
        self.event()  # pas encore classé
        self.event(potential_severity=1, probability=1, occurred_at=fields.Datetime.now() - timedelta(days=400))
        month = first.occurred_at.strftime("%Y-%m")
        status, cockpit = self.api("kadi.hsseq", "GET", f"/hsseq/cockpit?month={month}")
        self.assertEqual(status, 200, cockpit)
        matrix = cockpit["events"]["matrix"]
        self.assertEqual(len(matrix), 25, "Une case par gravité potentielle et probabilité")
        cells = {(c["severity"], c["probability"]): c for c in matrix}
        self.assertEqual((cells[(4, 3)]["count"], cells[(4, 3)]["criticality"], cells[(4, 3)]["level"],
                          cells[(4, 3)]["potential_severity"]), (2, 12, "significant", 4))
        self.assertEqual((cells[(5, 5)]["count"], cells[(5, 5)]["level"]), (1, "high"))
        self.assertEqual(cells[(1, 1)]["count"], 0, "Événement hors de la période")
        self.assertEqual(cockpit["events"]["matrix_unclassified"], 1, "Non classé : hors matrice, compté à part")
        status, yearly = self.api("kadi.hsseq", "GET", f"/hsseq/cockpit?month={month}&period=12m")
        self.assertEqual(sum(c["count"] for c in yearly["events"]["matrix"]), 3, "Douze mois : plus de 400 jours exclus")
        status, other = self.api("sekou.parc", "GET", f"/hsseq/cockpit?month={month}")
        self.assertEqual((status, sum(c["count"] for c in other["events"]["matrix"])), (200, 0),
                         "Chef de parc d'un autre site : les événements de Matoto n'y sont pas")

    def test_rotations_a_une_date(self):
        """GET /hsseq/rotations?vehicle_id=&date= : tous états, pour rattacher un événement à une rotation
        même partie ou terminée ; conducteur : les siennes ; hors lecture complète, ses sites (fermé par
        défaut)."""
        today = self.day
        current = self._rotation()
        earlier = self._rotation(date_loading=today - timedelta(days=3))
        earlier.write({"date_delivery": today - timedelta(days=2), "date_return": today - timedelta(days=1)})
        query = f"/hsseq/rotations?vehicle_id={self.truck.id}"
        status, body = self.api("ibrahima", "GET", query)
        self.assertEqual((status, [r["id"] for r in body["items"]]), (200, [current.id]), body)
        self.assertEqual(set(body["items"][0]) >= {"id", "name", "date_loading", "state", "vehicle", "driver", "site",
                                                    "departed_at"}, True)
        self.check(earlier)
        self.breath(earlier)
        earlier.with_user(self.parc).action_depart()
        earlier.action_validate()
        status, body = self.api("ibrahima", "GET", f"{query}&date={today - timedelta(days=2)}")
        self.assertEqual([(r["id"], r["state"]) for r in body["items"]], [(earlier.id, "done")],
                         "Rotation terminée : servie, en route ce jour-là entre chargement et retour")
        status, body = self.api("dg.hsseq", "GET", "/hsseq/rotations")
        self.assertIn(current.id, [r["id"] for r in body["items"]], "La direction déclare aussi")
        status, mine = self.driver_api("GET", query)
        self.assertEqual((status, [r["id"] for r in mine["items"]]), (200, [current.id]), "Le conducteur : ses rotations")
        current.driver_id = False
        status, mine = self.driver_api("GET", query)
        self.assertEqual((status, mine["items"]), (200, []), "Rotation d'un autre conducteur : pas servie au conducteur")
        self._create_user("moussa.parc", "exploitation")
        for login in ("sekou.parc", "moussa.parc"):
            status, body = self.api(login, "GET", query)
            self.assertEqual((status, body["items"]), (200, []), f"{login} : ensemble hors de ses sites")
        for login in ("rh.hsseq", "fatou"):
            status, _b = self.api(login, "GET", query)
            self.assertEqual(status, 403, f"{login} ne déclare pas d'événement")

    def test_salaries_dans_les_referentiels(self):
        for login in ("kadi.hsseq", "ibrahima", "dg.hsseq", "admin.hsseq"):
            status, refs = self.api(login, "GET", "/hsseq/referentials")
            self.assertEqual(status, 200, refs)
            [row] = [e for e in refs["employees"] if e["id"] == self.employee.id]
            self.assertEqual(set(row), {"id", "name", "company", "site", "site_id"}, "Aucune autre donnée du dossier RH")
            self.assertEqual((row["name"], row["site_id"], row["company"]["id"]),
                             (self.employee.name, self.site.id, self.company.id))
        status, refs = self.api("rh.hsseq", "GET", "/hsseq/referentials")
        self.assertEqual((status, refs["employees"]), (200, []), "La RH ne déclare pas d'événement")
        status, refs = self.driver_api("GET", "/hsseq/referentials")
        self.assertEqual((status, refs["employees"]), (200, []), "Le conducteur ne reçoit pas la liste des salariés")

    def test_notes_du_declarant_et_personnes(self):
        status, event = self.driver_api("POST", "/hsseq/events", {
            "client_uuid": "decl-1", "type": "near_miss", "title": "Piéton surpris au recul",
            "description": "Recul sans guide au dépôt.", "occurred_at": "2026-10-20T06:40:00Z",
            "actual_severity": 1, "potential_severity": 4, "probability": 3,
            "people": [{"kind": "driver", "id": 999999, "person_id": self.driver.id, "role": "driver"}]})
        self.assertEqual(status, 200, event)
        self.assertEqual(event["declared"], {"actual_severity": 1, "potential_severity": 4, "probability": 3,
                                             "criticality": 12}, "Notes du déclarant gardées à part")
        self.assertEqual((event["potential_severity"], event["criticality"]), (None, None), "Pas encore classé")
        self.assertEqual(event["people"][0]["person_id"], self.driver.id, "person_id lu avant id")
        status, _b = self.driver_api("PATCH", f"/hsseq/events/{event['id']}", {"potential_severity": 2})
        self.assertEqual(status, 403, "Notes : en lecture seule après la déclaration")
        status, classified = self.api("kadi.hsseq", "POST", f"/hsseq/events/{event['id']}/classify",
                                      {"potential_severity": 3, "probability": 2})
        self.assertEqual((status, classified["criticality"], classified["declared"]["criticality"]), (200, 6, 12))
        status, body = self.driver_api("POST", "/hsseq/events", {
            "client_uuid": "decl-2", "type": "hazard", "title": "x", "description": "x",
            "occurred_at": "2026-10-20T06:40:00Z", "probability": 6})
        self.assertEqual((status, body["error"]), (400, "invalid_parameter"))

    def test_regle_du_depart(self):
        """Départ, verrou en service : chef de parc sur un ensemble de ses sites, administration sans borne
        de site ; jamais la finance ni la direction ; le verrou s'applique à tous. Verrou hors service : le
        seul contrôle de profil de Transport."""
        Users = self.env["res.users"]
        rot = self._rotation()
        self.check(rot)
        self.breath(rot)
        nobody = self._create_user("moussa.parc", "exploitation")
        for user in (Users.search([("login", "=", "fatou")]), self.dg, self.parc2, nobody, self.hsseq):
            with self.assertRaises(AccessError, msg=user.login):
                rot.with_user(user).action_depart()
        blocked = self._rotation()
        with self.assertRaises(RotationBlocked, msg="L'administration ne contourne aucun motif"):
            blocked.with_user(self.admin).action_depart()
        self.assertFalse(self.admin._hsseq_site_ids(), "Administration rattachée à aucun site")
        rot.with_user(self.admin).action_depart()
        self.assertEqual((rot.state, rot.departed_by), ("en_route", self.admin))
        # Verrou en service, ensemble sans site : l'administration seule.
        loose = self.env["eguitra.transport.vehicle"].create({"name": "ER-99", "tractor_plate": "RC-9999-Z",
                                                              "driver_id": self.driver.id})
        orphan = self._rotation(vehicle_id=loose.id)
        self.check(orphan)
        self.breath(orphan)
        with self.assertRaises(AccessError, msg="Ensemble sans site : pas le chef de parc"):
            orphan.with_user(self.parc).action_depart()
        orphan.with_user(self.admin).action_depart()
        self.assertEqual(orphan.state, "en_route", "Ensemble sans site : l'administration le fait partir")
        status, body = self.api("fatou", "POST", f"/transport/rotations/{self._rotation().id}/depart")
        self.assertEqual(status, 403, body)
        # Verrou hors service : seul le contrôle de profil (comme le test de Transport, ibrahima sans site).
        self.settings.lock_start_date = False
        for user in (self.parc2, nobody):
            free = self._rotation()
            free.with_user(user).action_depart()
            self.assertEqual(free.state, "en_route", f"{user.login} : hors site, verrou hors service")
        free = self._rotation(vehicle_id=loose.id)
        free.with_user(nobody).action_depart()
        self.assertEqual(free.state, "en_route", "Ensemble sans site, verrou hors service : chef de parc")
        for user in (Users.search([("login", "=", "fatou")]), self.dg):
            with self.assertRaises(AccessError, msg=f"{user.login} : jamais, verrou hors service"):
                self._rotation().with_user(user).action_depart()

    def test_complements_des_listes(self):
        rot = self._rotation()
        check = self.check(rot, failing=(BRAKES,))
        self.breath(rot)
        status, listing = self.api("kadi.hsseq", "GET", "/hsseq/checks")
        [line] = [c for c in listing["items"] if c["id"] == check.id]
        self.assertEqual(line["open_blocking"], 1, "Non-conformités bloquantes ouvertes sur la ligne")
        status, detail = self.api("kadi.hsseq", "GET", f"/hsseq/checks/{check.id}")
        self.assertFalse(detail["rights"]["can_edit"], "Pas de correction d'un contrôle saisi")
        status, ncs = self.api("kadi.hsseq", "GET", "/hsseq/checks/nonconformities?vehicle_kind=tipper")
        self.assertEqual(ncs["total_count"], 0)
        status, ncs = self.api("kadi.hsseq", "GET", "/hsseq/checks/nonconformities?vehicle_kind=tanker")
        self.assertEqual(ncs["total_count"], 1)
        status, tests = self.api("kadi.hsseq", "GET", "/hsseq/breath-tests?vehicle_kind=tipper")
        self.assertEqual((status, tests["total_count"]), (200, 0), tests)
        status, tests = self.api("kadi.hsseq", "GET", "/hsseq/breath-tests?vehicle_kind=tanker")
        self.assertEqual(tests["total_count"], 1)
        event = self.event()
        action = self.env["eguitra.hsseq.action"].create({
            "origin": "event", "event_id": event.id, "description": "Former au balisage", "owner_id": self.parc.id,
            "due_date": self.day + timedelta(days=10)})
        status, listing = self.api("kadi.hsseq", "GET", "/hsseq/actions")
        [row] = [a for a in listing["items"] if a["id"] == action.id]
        self.assertIsNone(row["effective"], "Pas encore vérifiée")
        action.write({"verified_at": fields.Datetime.now(), "effective": False})
        status, listing = self.api("kadi.hsseq", "GET", "/hsseq/actions")
        [row] = [a for a in listing["items"] if a["id"] == action.id]
        self.assertIs(row["effective"], False, "Non efficace, sur la ligne")

    def test_validation_attendue_des_actions(self):
        self.settings.costly_action_threshold = 50_000_000
        event = self.event()
        Action = self.env["eguitra.hsseq.action"]
        costly = Action.create({"origin": "event", "event_id": event.id, "description": "Remplacer les freins",
                                "owner_id": self.parc.id, "due_date": self.day + timedelta(days=20),
                                "estimated_cost": 80_000_000})
        cheap = Action.create({"origin": "event", "event_id": event.id, "description": "Afficher la consigne",
                               "owner_id": self.parc.id, "due_date": self.day + timedelta(days=20),
                               "estimated_cost": 1_000_000})
        status, listing = self.api("dg.hsseq", "GET", "/hsseq/actions")
        self.assertEqual(status, 200, listing)
        lines = {a["id"]: a for a in listing["items"]}
        self.assertEqual((lines[costly.id]["approval_pending"], lines[cheap.id]["approval_pending"]), (True, False))
        self.assertEqual(listing["counts"]["approval_pending"], 1)
        status, pending = self.api("dg.hsseq", "GET", "/hsseq/actions?approval_pending=1")
        self.assertEqual([a["id"] for a in pending["items"]], [costly.id])
        costly.with_user(self.dg).action_approve()
        status, listing = self.api("dg.hsseq", "GET", "/hsseq/actions?approval_pending=1")
        self.assertEqual((listing["total_count"], listing["counts"]["approval_pending"]), (0, 0), "Validée : plus attendue")

    def test_photos_manquantes_sur_la_liste_des_controles(self):
        rot = self._rotation()
        check = self.check(rot, failing=(BRAKES,))
        status, listing = self.api("ibrahima", "GET", "/hsseq/checks")
        self.assertEqual(status, 200, listing)
        [line] = [c for c in listing["items"] if c["id"] == check.id]
        self.assertTrue(line["photos_missing"], "Non-conformité sans photo : signalée sur la ligne")
        self.assertIsNone(line["complement_of"])
