from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import AgendaCase, z


@tagged("post_install", "-at_install")
class TestPartage(AgendaCase):
    """Partage d'un agenda à trois niveaux (disponibilités, lecture, modification) ; événements privés
    « Occupé » pour tous, confidentiels réduits au titre ; l'administration ne lit rien ; règles
    d'enregistrement du noyau, pas seulement les routes ; agenda d'équipe."""

    def setUp(self):
        super().setUp()
        self.cal = self.personal(self.alice)
        self.public = self.create(self.alice, "Revue des encours", hour=9, location="Salle A",
                                  description="Liste des clients en retard")["event"]
        self.private = self.create(self.alice, "Rendez-vous médical", hour=11, privacy="private")["event"]
        self.confidential = self.create(self.alice, "Comité des rémunérations", hour=14, privacy="confidential",
                                        location="Bureau du DG")["event"]

    def share(self, user, level):
        return self.ok("POST", f"/agenda/calendars/{self.cal.id}/shares", self.alice, {"user_id": user.id, "level": level})

    def seen(self, user):
        return {r["key"]: r for r in self.events(user, [self.cal])}

    def test_sans_partage_rien(self):
        self.assertEqual(self.events(self.carla, [self.cal]), [], "Un agenda non partagé est ignoré, sans erreur")
        status, _b = self.call("GET", f"/agenda/events/{self.public['id']}", token=self.token(self.carla))
        self.assertEqual(status, 404)
        status, _b = self.call("GET", f"/agenda/events/{self.public['id']}", token=self.token(self.admin))
        self.assertEqual(status, 404, "L'administration ne lit pas l'agenda d'un autre")
        self.assertEqual(self.events(self.admin, [self.cal]), [])
        status, _b = self.call("PATCH", f"/agenda/events/{self.public['id']}", {"name": "Intrusion"},
                               token=self.token(self.carla))
        self.assertEqual(status, 404)

    def test_disponibilites_seulement(self):
        self.share(self.carla, "freebusy")
        rows = self.seen(self.carla)
        self.assertEqual(len(rows), 3)
        self.assertEqual({r["title"] for r in rows.values()}, {"Occupé"})
        self.assertTrue(all(r["masked"] and r["location"] is None and r["organizer"] is None for r in rows.values()))
        detail = self.ok("GET", f"/agenda/events/{self.public['id']}", self.carla)
        self.assertEqual((detail["title"], detail["description"], detail["attendees"]), ("Occupé", None, []))
        status, _b = self.call("GET", f"/agenda/events/{self.public['id']}/ics", token=self.token(self.carla))
        self.assertEqual(status, 404, "Pas d'export du détail")
        status, _b = self.call("POST", "/agenda/events", {"calendar_id": self.cal.id, "name": "Ajout", "start": z(self.at(1, 9)),
                                                          "stop": z(self.at(1, 10))}, token=self.token(self.carla))
        self.assertEqual(status, 403, "Pas d'écriture")

    def test_lecture_des_details(self):
        self.share(self.carla, "read")
        rows = {r["title"]: r for r in self.seen(self.carla).values()}
        self.assertEqual(set(rows), {"Revue des encours", "Occupé", "Comité des rémunérations"})
        self.assertEqual((rows["Revue des encours"]["location"], rows["Revue des encours"]["view"]), ("Salle A", "full"))
        self.assertEqual(rows["Occupé"]["view"], "busy", "Un événement privé reste « Occupé »")
        conf = rows["Comité des rémunérations"]
        self.assertEqual((conf["view"], conf["location"]), ("title", None), "Confidentiel : le titre seul")
        detail = self.ok("GET", f"/agenda/events/{self.confidential['id']}", self.carla)
        self.assertEqual((detail["title"], detail["description"], detail["location"]), ("Comité des rémunérations", None, None))
        self.assertFalse(rows["Revue des encours"]["can_edit"])
        status, _b = self.call("PATCH", f"/agenda/events/{self.public['id']}", {"name": "Modifié"},
                               token=self.token(self.carla))
        self.assertEqual(status, 403)

    def test_modification(self):
        self.share(self.carla, "write")
        body = self.ok("POST", "/agenda/events", self.carla, {"calendar_id": self.cal.id, "name": "Ajouté par Carla",
                                                              "start": z(self.at(1, 9)), "stop": z(self.at(1, 10))})
        ev = body["event"]
        self.assertEqual((ev["organizer"]["id"], ev["created_by"], ev["created_on_behalf"]),
                         (self.alice.id, self.carla.name, self.alice.name), "Dans l'agenda d'Alice, pour son compte")
        self.ok("PATCH", f"/agenda/events/{self.public['id']}", self.carla, {"location": "Salle B"})
        for event in (self.private, self.confidential):
            status, _b = self.call("PATCH", f"/agenda/events/{event['id']}", {"name": "Modifié"},
                                   token=self.token(self.carla))
            self.assertIn(status, (403, 404), "Ni privé ni confidentiel")
        status, _b = self.call("DELETE", f"/agenda/events/{self.private['id']}", token=self.token(self.carla))
        self.assertIn(status, (403, 404))

    def test_retrait_et_niveaux(self):
        cal_row = self.share(self.bruno, "read")
        share = next(s for s in cal_row["shares"] if s["user"]["id"] == self.bruno.id)
        self.assertEqual(share["level_label"], "Lecture des détails")
        self.assertTrue(self.env["eguitra.agenda.notification"].sudo().search([("user_id", "=", self.bruno.id),
                                                                              ("kind", "=", "share")]))
        me = self.ok("GET", "/agenda/me", self.bruno)
        self.assertIn(self.cal.id, [c["id"] for c in me["calendars"] if c["level"] == "read"])
        self.ok("PATCH", f"/agenda/shares/{share['id']}", self.alice, {"level": "freebusy"})
        self.assertEqual({r["title"] for r in self.seen(self.bruno).values()}, {"Occupé"})
        status, _b = self.call("PATCH", f"/agenda/shares/{share['id']}", {"level": "write"}, token=self.token(self.bruno))
        self.assertEqual(status, 403, "Seul le propriétaire change le niveau")
        status, _b = self.call("DELETE", f"/agenda/shares/{share['id']}", token=self.token(self.carla))
        self.assertEqual(status, 404)
        self.ok("DELETE", f"/agenda/shares/{share['id']}", self.bruno)
        self.assertEqual(self.events(self.bruno, [self.cal]), [], "Le partage retiré ferme l'agenda")
        status, _b = self.call("POST", f"/agenda/calendars/{self.cal.id}/shares", {"user_id": self.bruno.id,
                                                                                  "level": "owner"},
                               token=self.token(self.alice))
        self.assertEqual(status, 422)
        status, _b = self.call("POST", f"/agenda/calendars/{self.cal.id}/shares", {"user_id": self.carla.id,
                                                                                  "level": "read"},
                               token=self.token(self.bruno))
        self.assertEqual(status, 404, "On ne partage pas l'agenda d'un autre")
        if self.cabinet:
            status, _b = self.call("POST", f"/agenda/calendars/{self.cal.id}/shares",
                                   {"user_id": self.consultant.id, "level": "read"}, token=self.token(self.alice))
            self.assertEqual(status, 403, "Aucune société partagée")

    def test_regles_d_enregistrement_du_noyau(self):
        """Les règles valent pour tout accès au noyau, administration et administrateur du noyau compris."""
        self.share(self.carla, "read")
        self.share(self.bruno, "freebusy")
        self.env.invalidate_all()
        Event = self.env["eguitra.agenda.event"]
        ids = [self.public["id"], self.private["id"], self.confidential["id"]]
        for user in (self.admin, self.env.ref("base.user_admin"), self.bruno, self.dana):
            self.assertFalse(Event.with_user(user).search([("id", "in", ids)]), user.login)
            with self.assertRaises(AccessError):
                Event.with_user(user).browse(self.public["id"]).read(["name"])
        visible = Event.with_user(self.carla).search([("id", "in", ids)])
        self.assertEqual(set(visible.ids), {self.public["id"], self.confidential["id"]},
                         "Lecture : pas l'événement privé, même par le noyau")
        self.assertEqual(set(Event.with_user(self.alice).search([("id", "in", ids)]).ids), set(ids))
        Calendar = self.env["eguitra.agenda.calendar"]
        self.assertFalse(Calendar.with_user(self.admin).search([("id", "=", self.cal.id)]))
        self.assertTrue(Calendar.with_user(self.bruno).search([("id", "=", self.cal.id)]))
        with self.assertRaises(AccessError):
            Event.with_user(self.alice).browse(self.public["id"]).write({"name": "Écriture directe"})

    def test_agenda_d_equipe(self):
        team = self.ok("POST", "/agenda/calendars", self.alice, {"name": "Clôture annuelle", "color": "#12956a"})
        self.assertEqual((team["kind"], team["level"]), ("team", "owner"))
        self.ok("POST", f"/agenda/calendars/{team['id']}/shares", self.alice, {"user_id": self.carla.id, "level": "write"})
        ev = self.ok("POST", "/agenda/events", self.carla, {"calendar_id": team["id"], "name": "Inventaire de caisse",
                                                            "start": z(self.at(2, 9)), "stop": z(self.at(2, 12))})["event"]
        self.assertEqual(ev["organizer"]["id"], self.carla.id, "Agenda d'équipe : l'auteur organise")
        self.assertEqual([r["title"] for r in self.events(self.alice, [team["id"]])], ["Inventaire de caisse"])
        busy = self.ok("POST", "/agenda/freebusy", self.alice, {"user_ids": [self.carla.id], "start": z(self.at(2, 0)),
                                                                "end": z(self.at(3, 0))})
        self.assertEqual(len(busy["people"][0]["busy"]), 1, "L'organisatrice est occupée")
        self.ok("PATCH", f"/agenda/calendars/{team['id']}", self.alice, {"name": "Clôture 2026"})
        status, _b = self.call("DELETE", f"/agenda/calendars/{team['id']}", token=self.token(self.carla))
        self.assertEqual(status, 403, "Seul le propriétaire supprime l'agenda d'équipe")
        status, _b = self.call("DELETE", f"/agenda/calendars/{self.cal.id}", token=self.token(self.alice))
        self.assertEqual(status, 422, "L'agenda personnel reste")
        self.ok("DELETE", f"/agenda/calendars/{team['id']}", self.alice)
        self.assertEqual(self.events(self.carla, [team["id"]]), [])
