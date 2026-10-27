from datetime import timedelta

from odoo.tests import tagged

from .common import AgendaCase, z


@tagged("post_install", "-at_install")
class TestRessources(AgendaCase):
    """Ressources (salles, véhicules, équipements) : gérées par l'administration, réservées par tous, sans
    conflit possible (refus clair avec le créneau libre le plus proche), capacité, séries."""

    def setUp(self):
        super().setUp()
        self.salle = self.ok("POST", "/agenda/resources", self.admin, {
            "name": "Salle du conseil", "resource_type": "room", "capacity": 3, "location": "Siège, 2e étage"})

    def book(self, user, title, day=0, hour=9, minutes=60, **extra):
        start = self.at(day, hour)
        return self.call("POST", "/agenda/events", dict({
            "name": title, "start": z(start), "stop": z(start + timedelta(minutes=minutes)),
            "resource_ids": [self.salle["id"]]}, **extra), token=self.token(user))

    def test_reservation_sans_conflit_possible(self):
        status, body = self.book(self.alice, "Comité de crédit", hour=10, minutes=60)
        self.assertEqual(status, 200, body)
        self.assertEqual([r["name"] for r in body["event"]["resource_ids"]], ["Salle du conseil"])
        status, body = self.book(self.bruno, "Réunion du parc", hour=10, minutes=30)
        self.assertEqual(status, 422, body)
        self.assertIn("Salle du conseil est déjà réservée", body["message"])
        self.assertIn("Créneau libre le plus proche", body["message"])
        self.assertIn("09:30 - 10:00", body["message"], "La demi-heure libre juste avant, plus proche que 11 h 00")
        status, body = self.book(self.bruno, "Réunion du parc", hour=10, minutes=90)
        self.assertEqual(status, 422, body)
        self.assertIn("11:00 - 12:30", body["message"], "Une heure et demie : rien avant, le premier créneau après")
        self.assertFalse(self.env["eguitra.agenda.event"].sudo().search([("name", "=", "Réunion du parc")]),
                         "Rien n'est enregistré")
        status, body = self.book(self.bruno, "Réunion du parc", hour=11, minutes=30)
        self.assertEqual(status, 200, body)
        # Une modification qui ferait chevaucher est refusée aussi.
        status, body = self.call("PATCH", f"/agenda/events/{body['event']['id']}",
                                 {"start": z(self.at(0, 10, 30)), "stop": z(self.at(0, 11, 30))}, token=self.token(self.bruno))
        self.assertEqual(status, 422, body)

    def test_occupations_visibles_de_tous_sans_detail(self):
        self.book(self.alice, "Négociation salariale", hour=14, privacy="private")
        self.book(self.alice, "Comité de crédit", hour=9)
        rows = self.events(self.bruno, [self.salle["id"]])
        self.assertEqual(sorted(r["title"] for r in rows), ["Réservé", f"Réservé par {self.alice.name}"],
                         "Une réservation privée ne dit pas qui")
        self.assertTrue(all(r["masked"] for r in rows))
        me = self.ok("GET", "/agenda/me", self.bruno)
        row = next(c for c in me["calendars"] if c["id"] == self.salle["id"])
        self.assertEqual((row["level"], row["capacity"], row["resource_label"]), ("book", 3, "Salle de réunion"))
        status, _b = self.call("POST", "/agenda/events", {"calendar_id": self.salle["id"], "name": "Direct",
                                                          "start": z(self.at(1, 9)), "stop": z(self.at(1, 10))},
                               token=self.token(self.bruno))
        self.assertEqual(status, 403, "Une ressource se réserve depuis un événement, pas en y écrivant")

    def test_capacite_et_series(self):
        status, body = self.book(self.alice, "Grande réunion", attendees=[
            {"user_id": self.bruno.id}, {"user_id": self.carla.id}, {"user_id": self.dana.id}])
        self.assertEqual(status, 422, body)
        self.assertIn("accueille 3 personnes", body["message"])
        status, body = self.book(self.alice, "Point hebdomadaire", day=0, hour=8,
                                 recurrence={"freq": "weekly", "days": ["MO"], "end": "count", "count": 4})
        self.assertEqual(status, 200, body)
        status, body = self.book(self.bruno, "Formation", day=14, hour=8)
        self.assertEqual(status, 422, "La troisième occurrence de la série occupe la salle")
        status, body = self.book(self.bruno, "Formation", day=15, hour=8)
        self.assertEqual(status, 200, body)

    def test_gestion_par_l_administration(self):
        status, _b = self.call("POST", "/agenda/resources", {"name": "Toyota Hilux", "resource_type": "vehicle"},
                               token=self.token(self.alice))
        self.assertEqual(status, 403, "Seule l'administration crée une ressource")
        vehicule = self.ok("POST", "/agenda/resources", self.admin, {
            "name": "Toyota Hilux RC-1234", "resource_type": "vehicle", "capacity": 5,
            "open_hours": {"0": [["07:00", "19:00"]]}})
        self.assertEqual(vehicule["open_hours"], {"0": [["07:00", "19:00"]]})
        status, _b = self.call("PATCH", f"/agenda/resources/{vehicule['id']}", {"capacity": 4}, token=self.token(self.dana))
        self.assertEqual(status, 403)
        self.ok("PATCH", f"/agenda/resources/{vehicule['id']}", self.admin, {"capacity": 4})
        status, _b = self.call("POST", "/agenda/resources", {"name": "X", "resource_type": "boat"}, token=self.token(self.admin))
        self.assertEqual(status, 422)
        self.ok("DELETE", f"/agenda/resources/{vehicule['id']}", self.admin)
        status, body = self.call("POST", "/agenda/events", {
            "name": "Mission", "start": z(self.at(1, 9)), "stop": z(self.at(1, 10)), "resource_ids": [vehicule["id"]]},
            token=self.token(self.alice))
        self.assertEqual(status, 422, "Une ressource retirée ne se réserve plus")
        names = [r["name"] for r in self.ok("GET", "/agenda/resources", self.alice)]
        self.assertEqual(names, ["Salle du conseil"])
        names = [r["name"] for r in self.ok("GET", "/agenda/resources?all=1", self.admin)]
        self.assertIn("Toyota Hilux RC-1234", names, "L'administration voit aussi les ressources retirées")
        # L'administration gère la salle sans lire les réservations.
        self.book(self.alice, "Comité de crédit", hour=9)
        self.assertEqual({r["title"] for r in self.events(self.admin, [self.salle["id"]])}, {f"Réservé par {self.alice.name}"})
