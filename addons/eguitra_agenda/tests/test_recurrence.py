from odoo.tests import tagged

from .common import AgendaCase, z


def occ(value):
    return value.isoformat(timespec="seconds")


@tagged("post_install", "-at_install")
class TestRecurrence(AgendaCase):
    """Séries : occurrences calculées à la lecture, modification de cette occurrence, de celle-ci et des
    suivantes, de toute la série (exceptions décalées avec elle), suppressions, réponses par occurrence,
    règles mensuelles par rang, premier jour aligné sur la règle."""

    WEEKLY_MO_WE = {"freq": "weekly", "days": ["MO", "WE"], "end": "count", "count": 6}

    def series(self, user=None, title="Point hebdomadaire", recurrence=None, **extra):
        return self.create(user or self.alice, title, recurrence=recurrence or self.WEEKLY_MO_WE, **extra)["event"]

    def rows(self, user=None, days=21, calendars=None):
        user = user or self.alice
        return self.events(user, calendars or [self.personal(user)], days=days)

    def test_occurrences_et_libelle(self):
        ev = self.series()
        self.assertEqual(ev["recurrence"]["label"], "Chaque semaine le lundi et mercredi, 6 fois")
        self.assertEqual(ev["recurrence"]["spec"]["days"], ["MO", "WE"])
        rows = self.rows()
        self.assertEqual([r["start"] for r in rows],
                         [z(self.at(d, 9)) for d in (0, 2, 7, 9, 14, 16)])
        self.assertTrue(all(r["recurring"] and r["series_id"] == ev["id"] for r in rows))
        self.assertEqual(rows[2]["key"], f"{ev['id']}:{occ(self.at(7, 9))}")
        master = self.env["eguitra.agenda.event"].sudo().browse(ev["id"])
        self.assertEqual(master.recurrence_end, self.at(16, 10), "Fin de la dernière occurrence")
        self.assertEqual(self.env["eguitra.agenda.event"].sudo().search_count([("series_id", "=", ev["id"])]), 0,
                         "Aucune occurrence enregistrée : elles se calculent")
        detail = self.ok("GET", f"/agenda/events/{ev['id']}?occurrence={occ(self.at(9, 9))}", self.alice)
        self.assertEqual((detail["start"], detail["occurrence"]), (z(self.at(9, 9)), occ(self.at(9, 9))))
        status, _b = self.call("GET", f"/agenda/events/{ev['id']}?occurrence={occ(self.at(8, 9))}", token=self.token(self.alice))
        self.assertEqual(status, 404, "Pas d'occurrence un mardi")

    def test_regles_invalides_et_premier_jour_aligne(self):
        status, body = self.call("POST", "/agenda/events", {
            "name": "X", "start": z(self.at(0, 9)), "stop": z(self.at(0, 10)),
            "recurrence": {"freq": "weekly", "interval": 0}}, token=self.token(self.alice))
        self.assertEqual(status, 422, body)
        status, body = self.call("POST", "/agenda/events", {
            "name": "X", "start": z(self.at(0, 9)), "stop": z(self.at(0, 10)),
            "recurrence": {"freq": "hourly"}}, token=self.token(self.alice))
        self.assertEqual(status, 422, body)
        # Créé un lundi, « le 2e mardi de chaque mois » commence au premier 2e mardi qui suit.
        ev = self.series(title="Comité mensuel", recurrence={"freq": "monthly", "monthly": "rank", "rank": 2,
                                                             "rank_day": "TU", "end": "count", "count": 3})
        rows = self.events(self.alice, [self.personal(self.alice)], days=120)
        starts = [r["start"] for r in self.by_title(rows, "Comité mensuel")]
        self.assertEqual(len(starts), 3)
        from datetime import datetime

        days = [datetime.fromisoformat(s.rstrip("Z")) for s in starts]
        self.assertTrue(all(d.weekday() == 1 and 8 <= d.day <= 14 and d.hour == 9 for d in days), starts)
        self.assertEqual(ev["start"], starts[0], "Le premier jour de la série est une occurrence")
        self.assertIn("le 2e mardi", ev["recurrence"]["label"])

    def test_modifier_cette_occurrence_puis_toute_la_serie(self):
        ev = self.series()
        body = self.ok("PATCH", f"/agenda/events/{ev['id']}", self.alice, {
            "name": "Point décalé", "start": z(self.at(7, 11)), "stop": z(self.at(7, 12)), "scope": "this",
            "occurrence": occ(self.at(7, 9))})
        exception = body["event"]
        self.assertTrue(exception["exception"])
        self.assertNotEqual(exception["id"], ev["id"])
        rows = self.rows()
        self.assertEqual(len(rows), 6, "Toujours six occurrences")
        moved = next(r for r in rows if r["title"] == "Point décalé")
        self.assertEqual((moved["start"], moved["key"]), (z(self.at(7, 11)), f"{ev['id']}:{occ(self.at(7, 9))}"),
                         "L'exception remplace l'occurrence d'origine, sous la même clé")
        self.assertFalse([r for r in rows if r["start"] == z(self.at(7, 9))])

        # Toute la série : le titre change partout, l'heure se décale d'une heure, l'exception suit.
        self.ok("PATCH", f"/agenda/events/{ev['id']}", self.alice, {
            "name": "Point hebdo", "start": z(self.at(2, 10)), "stop": z(self.at(2, 11)), "scope": "all",
            "occurrence": occ(self.at(2, 9))})
        rows = self.rows()
        self.assertEqual(len(rows), 6)
        self.assertEqual({r["title"] for r in rows}, {"Point hebdo"}, "Titre de toute la série, exception comprise")
        regular = [r["start"] for r in rows if not r["exception"]]
        self.assertEqual(regular, [z(self.at(d, 10)) for d in (0, 2, 9, 14, 16)])
        moved = next(r for r in rows if r["exception"])
        self.assertEqual((moved["start"], moved["key"]), (z(self.at(7, 11)), f"{ev['id']}:{occ(self.at(7, 10))}"),
                         "L'exception garde son horaire et suit la série")

    def test_celle_ci_et_les_suivantes(self):
        ev = self.series(recurrence={"freq": "weekly", "days": ["MO"], "end": "count", "count": 6})
        self.ok("PATCH", f"/agenda/events/{ev['id']}", self.alice, {
            "name": "Exception 21", "scope": "this", "occurrence": occ(self.at(21, 9))})
        body = self.ok("PATCH", f"/agenda/events/{ev['id']}", self.alice, {
            "name": "Nouvelle formule", "start": z(self.at(14, 14)), "stop": z(self.at(14, 15)), "scope": "following",
            "occurrence": occ(self.at(14, 9))})
        new = body["event"]
        self.assertNotEqual(new["id"], ev["id"], "Une nouvelle série reprend à l'occurrence choisie")
        rows = self.rows(days=42)
        self.assertEqual([(r["title"], r["start"]) for r in rows], [
            ("Point hebdomadaire", z(self.at(0, 9))), ("Point hebdomadaire", z(self.at(7, 9))),
            ("Nouvelle formule", z(self.at(14, 14))), ("Nouvelle formule", z(self.at(21, 14))),
            ("Nouvelle formule", z(self.at(28, 14))), ("Nouvelle formule", z(self.at(35, 14))),
        ], "Les six occurrences, coupées en deux séries ; l'exception de la seconde partie est retirée")
        Event = self.env["eguitra.agenda.event"].sudo()
        self.assertEqual(Event.browse(ev["id"]).rrule, "FREQ=WEEKLY;BYDAY=MO;COUNT=2")
        self.assertEqual(Event.browse(new["id"]).rrule, "FREQ=WEEKLY;BYDAY=MO;COUNT=4")
        self.assertEqual(new["recurrence"]["label"], "Chaque semaine le lundi, 4 fois")

    def test_suppressions(self):
        ev = self.series(recurrence={"freq": "weekly", "days": ["MO"], "end": "never"})
        status, body = self.call("DELETE", f"/agenda/events/{ev['id']}?scope=this", token=self.token(self.alice))
        self.assertEqual(status, 422, "Une occurrence se précise")
        self.ok("DELETE", f"/agenda/events/{ev['id']}?scope=this&occurrence={occ(self.at(7, 9))}", self.alice)
        rows = self.rows(days=35)
        self.assertEqual([r["start"] for r in rows], [z(self.at(d, 9)) for d in (0, 14, 21, 28)])
        self.ok("DELETE", f"/agenda/events/{ev['id']}?scope=following&occurrence={occ(self.at(21, 9))}", self.alice)
        rows = self.rows(days=70)
        self.assertEqual([r["start"] for r in rows], [z(self.at(d, 9)) for d in (0, 14)], "Série sans fin arrêtée")
        self.assertTrue(self.env["eguitra.agenda.event"].sudo().browse(ev["id"]).recurrence_end)
        self.ok("DELETE", f"/agenda/events/{ev['id']}?scope=all", self.alice)
        self.assertFalse(self.rows(days=70))
        self.assertFalse(self.env["eguitra.agenda.event"].sudo().search([("series_id", "=", ev["id"])]),
                         "Exceptions supprimées avec la série")

    def test_reponse_a_une_occurrence(self):
        ev = self.series(attendees=[{"user_id": self.bruno.id}])
        self.assertEqual(len(self.rows(self.bruno)), 6, "L'invité voit la série dans son agenda")
        self.ok("POST", f"/agenda/events/{ev['id']}/respond", self.bruno,
                {"state": "declined", "scope": "this", "occurrence": occ(self.at(7, 9)), "comment": "En mission"})
        self.assertEqual([r["start"] for r in self.rows(self.bruno)], [z(self.at(d, 9)) for d in (0, 2, 9, 14, 16)],
                         "L'occurrence refusée quitte son agenda")
        self.assertEqual(len(self.rows(self.alice)), 6, "L'organisatrice garde ses six occurrences")
        detail = self.ok("GET", f"/agenda/events/{ev['id']}?occurrence={occ(self.at(9, 9))}", self.bruno)
        self.assertEqual(detail["my_response"], "needs_action", "Les autres occurrences restent sans réponse")
        self.ok("POST", f"/agenda/events/{ev['id']}/respond", self.bruno, {"state": "accepted", "scope": "all"})
        rows = self.rows(self.bruno)
        self.assertEqual(len(rows), 6, "Accepter toute la série vaut aussi pour l'occurrence refusée")
        self.assertEqual({r["my_response"] for r in rows}, {"accepted"})

    def test_toute_la_serie_deplacee_d_un_jour(self):
        ev = self.series(recurrence={"freq": "weekly", "days": ["MO"], "end": "count", "count": 3})
        self.ok("PATCH", f"/agenda/events/{ev['id']}", self.alice, {
            "start": z(self.at(8, 9)), "stop": z(self.at(8, 10)), "scope": "all", "occurrence": occ(self.at(7, 9))})
        self.assertEqual([r["start"] for r in self.rows()], [z(self.at(d, 9)) for d in (1, 8, 15)],
                         "Les lundis deviennent des mardis")
        monthly = self.series(title="Mensuel", recurrence={"freq": "monthly", "monthly": "date", "end": "count",
                                                            "count": 2})
        status, body = self.call("PATCH", f"/agenda/events/{monthly['id']}", {
            "start": z(self.at(1, 9)), "stop": z(self.at(1, 10)), "scope": "all"}, token=self.token(self.alice))
        self.assertEqual(status, 422, "Une règle mensuelle se ressaisit pour changer de jour")
        body = self.ok("PATCH", f"/agenda/events/{monthly['id']}", self.alice, {
            "start": z(self.at(1, 9)), "stop": z(self.at(1, 10)), "scope": "all",
            "recurrence": {"freq": "monthly", "monthly": "date", "end": "count", "count": 2}})
        self.assertEqual(body["event"]["start"], z(self.at(1, 9)))
        # Retirer la récurrence : la série redevient un événement simple.
        body = self.ok("PATCH", f"/agenda/events/{monthly['id']}", self.alice, {"recurrence": None, "scope": "all"})
        self.assertIsNone(body["event"]["recurrence"])
