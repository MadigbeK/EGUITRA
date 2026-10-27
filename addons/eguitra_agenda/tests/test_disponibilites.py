from datetime import date

from odoo.tests import tagged

from .common import AgendaCase, z


@tagged("post_install", "-at_install")
class TestDisponibilites(AgendaCase):
    """Disponibilités (occupations seules), recherche d'un créneau commun (heures de travail, fuseau, temps
    tampon, absences, ressources, facultatifs), absence du bureau (refus d'office, indication aux invitants),
    planning d'équipe, congés de la RH."""

    def find(self, user, payload):
        return self.ok("POST", "/agenda/find-slots", user, payload)

    def test_disponibilites_sans_detail(self):
        self.create(self.bruno, "Entretien annuel de Moussa", hour=10, privacy="public")
        self.create(self.bruno, "Provisoire", hour=14, show_as="tentative")
        self.create(self.bruno, "Libre", hour=16, show_as="free")
        body = self.ok("POST", "/agenda/freebusy", self.alice, {"user_ids": [self.bruno.id], "start": z(self.at(0, 0)),
                                                                "end": z(self.at(1, 0))})
        person = body["people"][0]
        self.assertTrue(person["visible"])
        self.assertEqual([(b["start"], b["kind"]) for b in person["busy"]],
                         [(z(self.at(0, 10)), "busy"), (z(self.at(0, 14)), "tentative")], "Un « libre » n'occupe pas")
        self.assertNotIn("title", person["busy"][0], "Jamais un titre")
        self.assertEqual(person["work_hours"]["0"], [["08:00", "17:00"]])
        # Disponibilités fermées aux collègues : rien, sauf partage.
        self.ok("PATCH", "/agenda/preferences", self.bruno, {"freebusy_visible": False})
        person = self.ok("POST", "/agenda/freebusy", self.alice, {"user_ids": [self.bruno.id], "start": z(self.at(0, 0)),
                                                                  "end": z(self.at(1, 0))})["people"][0]
        self.assertEqual((person["visible"], person["busy"]), (False, []))
        self.ok("POST", f"/agenda/calendars/{self.personal(self.bruno).id}/shares", self.bruno,
                {"user_id": self.alice.id, "level": "freebusy"})
        person = self.ok("POST", "/agenda/freebusy", self.alice, {"user_ids": [self.bruno.id], "start": z(self.at(0, 0)),
                                                                  "end": z(self.at(1, 0))})["people"][0]
        self.assertTrue(person["visible"], "Le partage des disponibilités les ouvre")
        if self.cabinet:
            body = self.ok("POST", "/agenda/freebusy", self.alice, {"user_ids": [self.consultant.id],
                                                                    "start": z(self.at(0, 0)), "end": z(self.at(1, 0))})
            self.assertEqual(body["people"], [], "Un compte d'une autre société n'est pas lu")

    def test_trouver_un_creneau(self):
        # Alice : 8 h - 10 h ; Bruno : 10 h 30 - 11 h ; Carla (facultative) : tout l'après-midi.
        self.create(self.alice, "Clôture", hour=8, minutes=120)
        self.create(self.bruno, "Parc", hour=10, minutes=30)
        self.ok("POST", "/agenda/events", self.carla, {"name": "Formation", "start": z(self.at(0, 13)),
                                                       "stop": z(self.at(0, 17))})
        body = self.find(self.alice, {"user_ids": [self.bruno.id], "optional_user_ids": [self.carla.id], "duration": 60,
                                      "start": z(self.at(0, 0)), "end": z(self.at(1, 0)), "buffer": 0})
        # Classement : d'abord les créneaux où la facultative est libre (11 h et 12 h), puis l'après-midi.
        self.assertEqual([s["start"] for s in body["slots"][:2]], [z(self.at(0, 11)), z(self.at(0, 12))])
        self.assertTrue(all(s["label"] == "Tous disponibles" and s["optional_free"] == [self.carla.id]
                            for s in body["slots"][:2]))
        later = body["slots"][2:]
        self.assertEqual([s["start"] for s in later], [z(self.at(0, h)) for h in (13, 14, 15, 16)])
        self.assertTrue(all(s["missing"] == [self.carla.name] for s in later), "L'après-midi, sans Carla")
        self.assertFalse([s for s in body["slots"] if s["start"] < z(self.at(0, 8)) or s["stop"] > z(self.at(0, 17))],
                         "Dans les heures de travail")
        # Temps tampon : 30 minutes autour des engagements de chacun.
        padded = self.find(self.alice, {"user_ids": [self.bruno.id], "duration": 60, "start": z(self.at(0, 0)),
                                        "end": z(self.at(1, 0)), "buffer": 30})
        self.assertNotIn(z(self.at(0, 11)), [s["start"] for s in padded["slots"]])
        self.assertEqual(padded["buffer"], 30)
        # Heures de travail de chacun : Bruno ne travaille que le matin.
        self.ok("PATCH", "/agenda/preferences", self.bruno, {"work_hours": {str(d): [["07:00", "12:00"]] for d in range(5)}})
        morning = self.find(self.alice, {"user_ids": [self.bruno.id], "duration": 60, "start": z(self.at(0, 0)),
                                         "end": z(self.at(1, 0)), "buffer": 0})
        self.assertTrue(all(s["stop"] <= z(self.at(0, 12)) for s in morning["slots"]))
        status, _b = self.call("POST", "/agenda/find-slots", {"duration": 60, "start": z(self.at(0, 0)),
                                                              "end": z(self.at(40, 0))}, token=self.token(self.alice))
        self.assertEqual(status, 422, "Trente et un jours au plus")

    def test_creneau_avec_une_ressource_et_un_fuseau(self):
        salle = self.ok("POST", "/agenda/resources", self.admin, {"name": "Salle B", "resource_type": "room"})
        self.ok("POST", "/agenda/events", self.carla, {"name": "Occupe la salle", "start": z(self.at(0, 8)),
                                                       "stop": z(self.at(0, 12)), "resource_ids": [salle["id"]]})
        body = self.find(self.alice, {"resource_ids": [salle["id"]], "duration": 60, "start": z(self.at(0, 0)),
                                      "end": z(self.at(1, 0)), "buffer": 0})
        self.assertEqual(body["slots"][0]["start"], z(self.at(0, 12)), "La salle est prise le matin")
        # Bruno à Paris (UTC+1 en hiver) : 8 h à Paris = 7 h à Conakry ; il finit à 16 h, heure de Conakry.
        self.ok("PATCH", "/agenda/preferences", self.bruno, {"tz": "Europe/Paris"})
        body = self.find(self.alice, {"user_ids": [self.bruno.id], "duration": 60, "start": z(self.at(0, 0)),
                                      "end": z(self.at(1, 0)), "buffer": 0, "limit": 30})
        self.assertTrue(all(s["stop"] <= z(self.at(0, 16)) for s in body["slots"]))
        status, _b = self.call("PATCH", "/agenda/preferences", {"tz": "Mars/Olympus"}, token=self.token(self.bruno))
        self.assertEqual(status, 422)

    def test_absence_du_bureau(self):
        self.ok("PATCH", "/agenda/preferences", self.bruno, {"ooo": {
            "active": True, "start": z(self.at(0, 0)), "stop": z(self.at(5, 0)), "auto_decline": True,
            "message": "En mission à Boké, de retour lundi."}})
        body = self.create(self.alice, "Revue des rotations", day=1, attendees=[{"user_id": self.bruno.id}])
        line = next(a for a in body["event"]["attendees"] if a["user_id"] == self.bruno.id)
        self.assertEqual((line["state"], line["auto_declined"], line["comment"]),
                         ("declined", True, "En mission à Boké, de retour lundi."))
        self.assertIn("refusée d'office", body["warnings"][0]["message"])
        self.assertTrue(self.env["eguitra.agenda.notification"].sudo().search([("user_id", "=", self.alice.id),
                                                                              ("kind", "=", "ooo")]),
                        "L'organisatrice est prévenue")
        self.assertFalse(self.env["eguitra.agenda.notification"].sudo().search(
            [("user_id", "=", self.bruno.id), ("kind", "=", "invitation")]), "Pas d'invitation pendant l'absence")
        person = self.ok("POST", "/agenda/freebusy", self.alice, {"user_ids": [self.bruno.id], "start": z(self.at(0, 0)),
                                                                  "end": z(self.at(7, 0))})["people"][0]
        self.assertEqual(person["ooo"]["message"], "En mission à Boké, de retour lundi.", "Indication aux invitants")
        self.assertIn("oof", [b["kind"] for b in person["busy"]])
        slots = self.find(self.alice, {"user_ids": [self.bruno.id], "duration": 60, "start": z(self.at(0, 0)),
                                       "end": z(self.at(8, 0)), "buffer": 0})["slots"]
        self.assertTrue(slots and all(s["start"] >= z(self.at(7, 8)) for s in slots),
                        "Rien pendant l'absence : le lundi suivant, dès 8 h")
        # Sans refus d'office : invité quand même, avec l'indication.
        self.ok("PATCH", "/agenda/preferences", self.bruno, {"ooo": {
            "active": True, "start": z(self.at(0, 0)), "stop": z(self.at(5, 0)), "auto_decline": False}})
        body = self.create(self.alice, "Second point", day=2, attendees=[{"user_id": self.bruno.id}])
        self.assertEqual(next(a for a in body["event"]["attendees"] if a["user_id"] == self.bruno.id)["state"], "needs_action")
        self.assertIn("absent du bureau", body["warnings"][0]["message"])
        status, _b = self.call("PATCH", "/agenda/preferences", {"ooo": {"active": True, "start": z(self.at(5, 0)),
                                                                        "stop": z(self.at(4, 0))}},
                               token=self.token(self.bruno))
        self.assertEqual(status, 422)
        prefs = self.ok("PATCH", "/agenda/preferences", self.bruno, {"ooo": {"active": False}})
        self.assertFalse(prefs["ooo"]["active"])

    def test_planning_d_equipe(self):
        self.ok("POST", f"/agenda/calendars/{self.personal(self.bruno).id}/shares", self.bruno,
                {"user_id": self.alice.id, "level": "read"})
        self.create(self.bruno, "Tournée Kamsar", hour=9)
        self.create(self.carla, "Banque", hour=10)
        salle = self.ok("POST", "/agenda/resources", self.admin, {"name": "Salle C", "resource_type": "room"})
        self.ok("POST", "/agenda/events", self.carla, {"name": "Réunion budgétaire", "start": z(self.at(0, 14)),
                                                       "stop": z(self.at(0, 15)), "resource_ids": [salle["id"]]})
        body = self.ok("GET", f"/agenda/planning?start={z(self.at(0, 0))}&end={z(self.at(1, 0))}"
                              f"&user_ids={self.bruno.id},{self.carla.id}&resource_ids={salle['id']}", self.alice)
        rows = {r["name"]: r for r in body["rows"]}
        self.assertEqual([b["title"] for b in rows[self.bruno.name]["busy"]], ["Tournée Kamsar"],
                         "Agenda partagé en lecture : le titre")
        self.assertEqual([b["title"] for b in rows[self.carla.name]["busy"]], ["Occupé", "Occupé"],
                         "Sans partage : « Occupé » seulement")
        self.assertEqual([b["title"] for b in rows["Salle C"]["busy"]], [f"Réservé par {self.carla.name}"])
        status, _b = self.call("GET", f"/agenda/planning?start={z(self.at(0, 0))}&end={z(self.at(20, 0))}",
                               token=self.token(self.alice))
        self.assertEqual(status, 422, "Quatorze jours au plus")

    def test_conges_de_la_rh(self):
        if "eguitra.rh.leave" not in self.env:
            self.skipTest("Module RH absent de la base de test")
        employee = self.env["eguitra.rh.employee"].create({"name": "Bruno Exploitation", "hire_date": date(2024, 1, 1),
                                                           "base_salary": 3_000_000, "user_id": self.bruno.id})
        leave_type = self.env["eguitra.rh.leave.type"].search([("code", "=", "MAL")], limit=1)
        leave = self.env["eguitra.rh.leave"].create({"employee_id": employee.id, "type_id": leave_type.id,
                                                     "date_from": self.at(1, 0).date(), "date_to": self.at(2, 0).date()})
        leave.action_approve(force=True)
        person = self.ok("POST", "/agenda/freebusy", self.alice, {"user_ids": [self.bruno.id], "start": z(self.at(0, 0)),
                                                                  "end": z(self.at(5, 0))})["people"][0]
        self.assertEqual([(b["start"], b["stop"], b["kind"]) for b in person["busy"]],
                         [(z(self.at(1, 0)), z(self.at(3, 0)), "absence")], "Le congé approuvé, sans son motif")
        slots = self.find(self.alice, {"user_ids": [self.bruno.id], "duration": 60, "start": z(self.at(1, 0)),
                                       "end": z(self.at(3, 0)), "buffer": 0})["slots"]
        self.assertEqual(slots, [], "Personne n'est proposé pendant un congé")
