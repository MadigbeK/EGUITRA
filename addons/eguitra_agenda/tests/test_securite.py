import io
import time

from odoo.tests import tagged

from .common import AgendaCase, z


def occ(value):
    return value.isoformat(timespec="seconds")


@tagged("post_install", "-at_install")
class TestSecurite(AgendaCase):
    """Corrections de la revue de sécurité : une occurrence modifiable n'ouvre pas le reste de sa série ;
    l'import iCalendar suit les règles de la saisie et ne réécrit pas un événement qu'on ne peut modifier ;
    une règle de récurrence pathologique est refusée vite, sans calcul sans fin."""

    def ics(self, *events):
        lines = ["BEGIN:VCALENDAR", "VERSION:2.0"]
        for uid, start, stop, summary, extra in events:
            lines += ["BEGIN:VEVENT", f"UID:{uid}", f"DTSTART:{start:%Y%m%dT%H%M%SZ}", f"DTEND:{stop:%Y%m%dT%H%M%SZ}",
                      f"SUMMARY:{summary}", *extra, "END:VEVENT"]
        lines.append("END:VCALENDAR")
        return "\r\n".join(lines).encode()

    def import_file(self, user, calendar, content):
        response = self.url_open("/api/v1/agenda/import", data={"calendar_id": str(calendar.id)},
                                 files=[("file", ("agenda.ics", io.BytesIO(content), "text/calendar"))], method="POST",
                                 headers={"Authorization": f"Bearer {self.token(user)}", "X-Eguitra-App": "test"})
        return response.status_code, response.json()

    def test_une_occurrence_modifiable_n_ouvre_pas_la_serie(self):
        cal = self.personal(self.alice)
        series = self.create(self.alice, "Suivi médical", privacy="private",
                             recurrence={"freq": "weekly", "days": ["MO"], "end": "count", "count": 4})["event"]
        # Alice rend publique une seule occurrence ; Carla modifie l'agenda par un partage (événements publics).
        exception = self.ok("PATCH", f"/agenda/events/{series['id']}", self.alice, {
            "privacy": "public", "name": "Point d'équipe", "scope": "this", "occurrence": occ(self.at(7, 9))})["event"]
        self.ok("POST", f"/agenda/calendars/{cal.id}/shares", self.alice, {"user_id": self.carla.id, "level": "write"})
        self.ok("PATCH", f"/agenda/events/{exception['id']}", self.carla, {"location": "Salle B", "scope": "this"})
        for scope in ("all", "following"):
            status, body = self.call("PATCH", f"/agenda/events/{exception['id']}", {"name": "Détourné", "scope": scope},
                                     token=self.token(self.carla))
            self.assertEqual(status, 403, f"{scope} : {body}")
            status, body = self.call("DELETE", f"/agenda/events/{exception['id']}?scope={scope}",
                                     token=self.token(self.carla))
            self.assertEqual(status, 403, f"suppression {scope} : {body}")
        master = self.env["eguitra.agenda.event"].sudo().browse(series["id"])
        self.assertEqual((master.name, master.rrule, master.privacy),
                         ("Suivi médical", "FREQ=WEEKLY;BYDAY=MO;COUNT=4", "private"), "La série privée est intacte")
        self.assertEqual(len(self.events(self.alice, [cal], days=28)), 4)
        self.ok("DELETE", f"/agenda/events/{exception['id']}?scope=this", self.carla)
        self.assertEqual(len(self.events(self.alice, [cal], days=28)), 3, "Seule l'occurrence ouverte est supprimée")

    def test_delegue_sans_droit_au_prive(self):
        dana_cal = self.personal(self.dana)
        series = self.create(self.dana, "Comité de direction",
                             recurrence={"freq": "weekly", "days": ["TU"], "end": "count", "count": 3})["event"]
        self.ok("PATCH", f"/agenda/events/{series['id']}", self.dana, {
            "privacy": "private", "scope": "this", "occurrence": occ(self.at(8, 9))})
        self.ok("POST", "/agenda/delegations", self.dana, {"delegate_id": self.awa.id})
        status, body = self.call("PATCH", f"/agenda/events/{series['id']}", {"name": "Renommé", "scope": "all"},
                                 token=self.token(self.awa))
        self.assertEqual(status, 403, "Une occurrence privée ferme la série au délégué sans ce droit")
        status, body = self.call("DELETE", f"/agenda/events/{series['id']}?scope=all", token=self.token(self.awa))
        self.assertEqual(status, 403, body)
        self.ok("PATCH", f"/agenda/events/{series['id']}", self.awa, {
            "location": "Salle du conseil", "scope": "this", "occurrence": occ(self.at(1, 9))})
        self.assertEqual(len(self.events(self.dana, [dana_cal], days=21)), 3)

    def test_partage_en_modification_et_visibilite(self):
        cal = self.personal(self.alice)
        self.ok("POST", f"/agenda/calendars/{cal.id}/shares", self.alice, {"user_id": self.carla.id, "level": "write"})
        for privacy in ("private", "confidential"):
            status, body = self.call("POST", "/agenda/events", {
                "calendar_id": cal.id, "name": "Masqué", "privacy": privacy, "start": z(self.at(1, 9)),
                "stop": z(self.at(1, 10))}, token=self.token(self.carla))
            self.assertEqual(status, 403, f"{privacy} : {body}")
        ev = self.ok("POST", "/agenda/events", self.carla, {"calendar_id": cal.id, "name": "Public",
                                                            "start": z(self.at(1, 9)), "stop": z(self.at(1, 10))})["event"]
        status, body = self.call("PATCH", f"/agenda/events/{ev['id']}", {"privacy": "private"}, token=self.token(self.carla))
        self.assertEqual(status, 403, "Pas de quoi s'enfermer dehors ni masquer l'événement")

    def test_import_aux_regles_de_la_saisie(self):
        cal = self.personal(self.alice)
        status, body = self.import_file(self.alice, cal, self.ics(
            ("prive-1@ext", self.at(2, 9), self.at(2, 10), "Consultation", ["CLASS:PRIVATE"])))
        self.assertEqual((status, body.get("created")), (200, 1), body)
        self.ok("POST", f"/agenda/calendars/{cal.id}/shares", self.alice, {"user_id": self.carla.id, "level": "write"})
        # Un partage en modification ne réécrit pas l'événement privé de même identifiant…
        status, body = self.import_file(self.carla, cal, self.ics(
            ("prive-1@ext", self.at(3, 9), self.at(3, 10), "Remplacé", ["CLASS:PUBLIC"])))
        self.assertEqual(status, 403, body)
        imported = self.env["eguitra.agenda.event"].sudo().search([("ics_uid", "=", "prive-1@ext")])
        self.assertEqual((imported.name, imported.start), ("Consultation", self.at(2, 9)), "Intact")
        # … ni n'importe d'événement privé.
        status, body = self.import_file(self.carla, cal, self.ics(
            ("prive-2@ext", self.at(3, 9), self.at(3, 10), "Privé", ["CLASS:PRIVATE"])))
        self.assertEqual(status, 403, body)
        # Délégué sans le droit au privé : refusé de même.
        self.ok("POST", "/agenda/delegations", self.dana, {"delegate_id": self.awa.id})
        status, body = self.import_file(self.awa, self.personal(self.dana), self.ics(
            ("prive-3@ext", self.at(3, 9), self.at(3, 10), "Privé", ["CLASS:PRIVATE"])))
        self.assertEqual(status, 403, body)
        # Durée et récurrence : les règles de la saisie.
        status, body = self.import_file(self.alice, cal, self.ics(
            ("long@ext", self.at(0, 9), self.at(400, 9), "Trop long", [])))
        self.assertEqual(status, 422, body)
        status, body = self.import_file(self.alice, cal, self.ics(
            ("vide@ext", self.at(0, 9), self.at(0, 10), "Fin avant le début", ["RRULE:FREQ=DAILY;UNTIL=20200101T000000Z"])))
        self.assertEqual(status, 422, body)
        self.assertIn("aucune occurrence", body["message"])
        # Premier jour aligné sur la règle importée (un lundi pour « chaque mercredi »).
        status, body = self.import_file(self.alice, cal, self.ics(
            ("mercredi@ext", self.at(0, 9), self.at(0, 10), "Chaque mercredi", ["RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=2"])))
        self.assertEqual(status, 200, body)
        rows = self.by_title(self.events(self.alice, [cal], days=14), "Chaque mercredi")
        self.assertEqual([r["start"] for r in rows], [z(self.at(2, 9)), z(self.at(9, 9))])

    def test_regle_pathologique_refusee_vite(self):
        debut = time.monotonic()
        status, body = self.call("POST", "/agenda/events", {
            "name": "Le 31 février", "start": z(self.at(0, 9)), "stop": z(self.at(0, 10)),
            "recurrence": {"freq": "yearly", "monthly": "date", "month_day": 31, "month": 2}}, token=self.token(self.alice))
        self.assertEqual(status, 422, body)
        self.assertIn("aucune occurrence", body["message"])
        ev = self.create(self.alice, "Simple")["event"]
        status, body = self.call("PATCH", f"/agenda/events/{ev['id']}", {
            "recurrence": {"freq": "monthly", "monthly": "rank", "rank": 6, "rank_day": "MO"}}, token=self.token(self.alice))
        self.assertEqual(status, 422, body)
        status, body = self.call("GET", f"/agenda/events/{ev['id']}?occurrence=9000-01-01T09:00:00", token=self.token(self.alice))
        self.assertEqual(status, 200, "Une occurrence lointaine d'un événement simple : la fiche, sans calcul")
        status, body = self.import_file(self.alice, self.personal(self.alice), self.ics(
            ("fevrier@ext", self.at(0, 9), self.at(0, 10), "Impossible", ["RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=31"])))
        self.assertEqual(status, 200, body)
        self.assertIn("récurrence non prise en charge", body["warnings"][0], "Importé une fois, règle écartée")
        self.assertLess(time.monotonic() - debut, 15, "Refus rapides")

    def test_adresse_d_un_compte_sans_societe_commune_invitee_comme_exterieure(self):
        if not self.cabinet:
            self.skipTest("Société du cabinet absente")
        self.consultant.sudo().email = "consultant@cabinet.test"
        body = self.create(self.bruno, "Visite", attendees=[{"email": "Consultant@Cabinet.test"}])
        [line] = body["event"]["attendees"]
        self.assertEqual((line["kind"], line["user_id"]), ("email", None),
                         "Aucune société partagée : invité comme une adresse extérieure, sans rien révéler du compte")
        self.assertEqual(line["name"], "consultant@cabinet.test")
        self.assertFalse(self.env["eguitra.agenda.notification"].sudo().search_count(
            [("user_id", "=", self.consultant.id)]), "Le compte du cabinet n'est pas notifié")
        # Avec une société commune, l'adresse (en majuscules) devient le compte.
        body = self.create(self.bruno, "Point", attendees=[{"email": "ALICE@EGUITRA.TEST"}])
        self.assertEqual([a["user_id"] for a in body["event"]["attendees"]], [self.alice.id])

    def test_conflits_seulement_pour_les_disponibilites_lisibles(self):
        self.create(self.bruno, "Tournée du parc", hour=9, minutes=120)
        self.ok("PATCH", "/agenda/preferences", self.bruno, {"freebusy_visible": False})
        body = self.create(self.alice, "Point exploitation", hour=10, attendees=[{"user_id": self.bruno.id}])
        self.assertEqual(body["conflicts"], [], "Disponibilités fermées : aucune occupation révélée")
        self.ok("PATCH", "/agenda/preferences", self.bruno, {"freebusy_visible": True})
        body = self.create(self.alice, "Point exploitation 2", hour=10, attendees=[{"user_id": self.bruno.id}])
        self.assertEqual([c["user_id"] for c in body["conflicts"]], [self.bruno.id])

    def test_recherche_par_adresse_en_egalite_sans_motif(self):
        for motif in ("a_ice@eguitra.test", "%@eguitra.test", "alic%@eguitra.test"):
            body = self.create(self.bruno, f"Motif {motif}", attendees=[{"email": motif}])
            [line] = body["event"]["attendees"]
            self.assertEqual((line["kind"], line["user_id"]), ("email", None), f"{motif} ne désigne aucun compte")
        self.assertEqual(self.env["eguitra.agenda.event"]._internal_user_by_email("alice@eguitra.test"), self.alice)
