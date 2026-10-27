import io
from unittest.mock import patch

from odoo.tests import tagged

from ..models import common
from .common import AgendaCase, z

PDF = b"%PDF-1.4\n% ordre du jour\n%%EOF\n"
EXE = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00"


@tagged("post_install", "-at_install")
class TestEvenements(AgendaCase):
    """Événements simples : saisie, journée entière et plusieurs jours, contrôles, catégories, invitations
    (application, courriel avec iCalendar, délégués), réponses et proposition d'horaire, conflits signalés,
    pièces jointes, export iCalendar, recherche, compteur de l'en-tête."""

    def test_agenda_personnel_cree_et_session(self):
        me = self.ok("GET", "/agenda/me", self.alice)
        personal = self.personal(self.alice)
        self.assertEqual(me["personal_calendar_id"], personal.id)
        mine = next(c for c in me["calendars"] if c["id"] == personal.id)
        self.assertEqual((mine["kind"], mine["level"], mine["can_write"]), ("personal", "owner", True))
        self.assertEqual(me["preferences"]["work_hours"]["0"], [["08:00", "17:00"]], "Défaut : 8 h 00 à 17 h 00")
        self.assertNotIn("5", me["preferences"]["work_hours"], "Ni samedi ni dimanche par défaut")
        self.assertEqual(me["preferences"]["tz"], "Africa/Conakry")
        self.assertIn("Réunion", [c["name"] for c in me["categories"]], "Catégories communes")
        self.assertFalse(me["booking"]["open"], "Prise de rendez-vous fermée par défaut")
        self.assertIn("agenda", self.alice._eguitra_apps())
        self.assertEqual(self.env["eguitra.agenda.calendar"].sudo().search_count(
            [("owner_id", "=", self.alice.id), ("kind", "=", "personal")]), 1, "Un seul agenda personnel")

    def test_creation_lecture_et_controles(self):
        cat = self.env.ref("eguitra_agenda.category_client")
        body = self.create(self.alice, "Revue du budget", hour=10, minutes=90, location="Salle A",
                           description="Ordre du jour : budget 2027", video_url="https://meet.exemple.org/budget",
                           privacy="public", show_as="busy", category_ids=[cat.id],
                           alarms=[{"minutes": 30, "channel": "app"}, {"minutes": 1440, "channel": "email"}])
        ev = body["event"]
        self.assertEqual((ev["title"], ev["location"], ev["video_url"], ev["start"], ev["stop"]),
                         ("Revue du budget", "Salle A", "https://meet.exemple.org/budget", z(self.at(0, 10)),
                          z(self.at(0, 11, 30))))
        self.assertEqual([c["name"] for c in ev["categories"]], ["Rendez-vous client"])
        self.assertEqual(ev["alarms_label"], "1 jour avant, 30 minutes avant")
        self.assertEqual((ev["created_by"], ev["created_on_behalf"]), (self.alice.name, None))
        rows = self.events(self.alice, [self.personal(self.alice)])
        self.assertEqual([r["title"] for r in rows], ["Revue du budget"])
        self.assertTrue(rows[0]["can_edit"])

        for bad, message in (
            ({"name": "", "start": z(self.at(0, 9)), "stop": z(self.at(0, 10))}, "titre"),
            ({"name": "Inversé", "start": z(self.at(0, 10)), "stop": z(self.at(0, 9))}, "fin"),
            ({"name": "Lien", "start": z(self.at(0, 9)), "stop": z(self.at(0, 10)), "video_url": "http://x.org"}, "https"),
            ({"name": "Statut", "start": z(self.at(0, 9)), "stop": z(self.at(0, 10)), "show_as": "away"}, "statut"),
            ({"name": "Rappels", "start": z(self.at(0, 9)), "stop": z(self.at(0, 10)),
              "alarms": [{"minutes": 60000, "channel": "app"}]}, "rappel"),
        ):
            status, err = self.call("POST", "/agenda/events", bad, token=self.token(self.alice))
            self.assertEqual(status, 422, f"{message} : {err}")

        status, body = self.call("PATCH", f"/agenda/events/{ev['id']}", {"name": "Revue du budget 2027",
                                                                          "location": "Salle B"},
                                 token=self.token(self.alice))
        self.assertEqual((status, body["event"]["title"], body["event"]["location"]),
                         (200, "Revue du budget 2027", "Salle B"), body)
        status, body = self.call("DELETE", f"/agenda/events/{ev['id']}", token=self.token(self.alice))
        self.assertEqual(status, 200, body)
        self.assertFalse(self.events(self.alice, [self.personal(self.alice)]))

    def test_journee_entiere_et_plusieurs_jours(self):
        body = self.create(self.alice, "Séminaire de direction", allday=True,
                           start_date=self.at(1, 0).date().isoformat(), end_date=self.at(3, 0).date().isoformat())
        ev = body["event"]
        self.assertTrue(ev["allday"])
        self.assertEqual((ev["start_date"], ev["end_date"]), (self.at(1, 0).date().isoformat(), self.at(3, 0).date().isoformat()))
        self.assertEqual((ev["start"], ev["stop"]), (z(self.at(1, 0)), z(self.at(4, 0))), "Minuit à minuit, à Conakry")
        rows = self.events(self.alice, [self.personal(self.alice)], day=2, days=1)
        self.assertEqual([r["title"] for r in rows], ["Séminaire de direction"], "Visible chacun des trois jours")
        timed = self.create(self.alice, "Mission à Kamsar", day=4, hour=15, minutes=3 * 24 * 60)["event"]
        self.assertEqual(timed["stop"], z(self.at(7, 15)), "Plusieurs jours, avec ses heures")

    def test_invitations_notifications_courriels_et_reponses(self):
        self.mail_server()
        Notification = self.env["eguitra.agenda.notification"].sudo()
        Mail = self.env["mail.mail"].sudo()
        last = Mail.search([], order="id desc", limit=1).id or 0
        body = self.create(self.alice, "Comité de trésorerie", hour=11, attendees=[
            {"user_id": self.bruno.id}, {"user_id": self.carla.id, "required": False},
            {"email": "conseil@cabinet-externe.gn", "name": "Conseil externe"},
        ])
        ev = body["event"]
        self.assertEqual(body["mail"]["sent"], 3, "Deux internes et un externe")
        mails = Mail.search([("id", ">", last)])
        self.assertEqual(len(mails), 3)
        self.assertTrue(all(m.attachment_ids.filtered(lambda a: a.mimetype == "text/calendar") for m in mails),
                        "Fichier iCalendar joint")
        ics = mails.filtered(lambda m: m.email_to == "conseil@cabinet-externe.gn").attachment_ids.raw.decode()
        ics = ics.replace("\r\n ", "")
        self.assertIn("METHOD:REQUEST", ics)
        self.assertIn("ATTENDEE;CN=Conseil externe;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:"
                      "mailto:conseil@cabinet-externe.gn", ics)
        self.assertIn(f"ORGANIZER;CN={self.alice.name}:mailto:alice@eguitra.test", ics)
        self.assertEqual(Notification.search_count([("user_id", "=", self.bruno.id), ("kind", "=", "invitation")]), 1)
        self.assertEqual(Notification.search_count([("user_id", "=", self.alice.id)]), 0, "L'auteur n'est pas notifié")
        unread = self.ok("GET", "/agenda/notifications/unread", self.bruno)
        self.assertEqual((unread["unread"], unread["invitations"]), (1, 1))
        attendees = {a["name"]: a for a in ev["attendees"]}
        self.assertEqual((attendees[self.carla.name]["required"], attendees["Conseil externe"]["kind"]), (False, "email"))

        # L'invité voit l'invitation dans son agenda, et y répond avec un commentaire.
        rows = self.events(self.bruno, [self.personal(self.bruno)])
        self.assertEqual([(r["title"], r["my_response"]) for r in rows], [("Comité de trésorerie", "needs_action")])
        status, detail = self.call("POST", f"/agenda/events/{ev['id']}/respond",
                                   {"state": "tentative", "comment": "Je confirme demain."}, token=self.token(self.bruno))
        self.assertEqual(status, 200, detail)
        mine = next(a for a in detail["attendees"] if a["me"])
        self.assertEqual((mine["state"], mine["comment"]), ("tentative", "Je confirme demain."))
        self.assertTrue(Notification.search([("user_id", "=", self.alice.id), ("kind", "=", "response")]),
                        "L'organisateur est prévenu")
        status, body = self.call("POST", f"/agenda/events/{ev['id']}/respond", {"state": "maybe"}, token=self.token(self.bruno))
        self.assertEqual(status, 422)
        status, body = self.call("POST", f"/agenda/events/{ev['id']}/respond", {"state": "accepted"},
                                 token=self.token(self.dana))
        self.assertEqual(status, 404, "Qui n'est pas invité ne répond pas (ni ne voit l'événement)")
        # Proposition d'un autre horaire, retenue par l'organisatrice.
        status, detail = self.call("POST", f"/agenda/events/{ev['id']}/propose",
                                   {"start": z(self.at(0, 15)), "stop": z(self.at(0, 16)), "comment": "Plutôt l'après-midi"},
                                   token=self.token(self.carla))
        self.assertEqual(status, 200, detail)
        proposal = next(a for a in detail["attendees"] if a["me"])["proposal"]
        self.assertEqual(proposal["start"], z(self.at(0, 15)))
        line = self.env["eguitra.agenda.attendee"].sudo().search([("event_id", "=", ev["id"]), ("user_id", "=", self.carla.id)])
        status, body = self.call("POST", f"/agenda/events/{ev['id']}/proposals/{line.id}/accept", token=self.token(self.bruno))
        self.assertEqual(status, 403, "Seul l'organisateur retient un horaire")
        body = self.ok("POST", f"/agenda/events/{ev['id']}/proposals/{line.id}/accept", self.alice)
        self.assertEqual((body["event"]["start"], body["event"]["stop"]), (z(self.at(0, 15)), z(self.at(0, 16))))
        self.assertTrue(all(a["state"] == "needs_action" for a in body["event"]["attendees"] if a["kind"] == "user"),
                        "Horaire changé : les réponses sont à renouveler")
        self.assertTrue(Notification.search([("user_id", "=", self.bruno.id), ("kind", "=", "update")]))
        # Réponse d'un externe, notée par l'organisatrice.
        external = next(a for a in body["event"]["attendees"] if a["kind"] == "email")
        detail = self.ok("POST", f"/agenda/events/{ev['id']}/attendees/{external['id']}/response", self.alice,
                         {"state": "accepted"})
        self.assertEqual(next(a for a in detail["attendees"] if a["kind"] == "email")["state"], "accepted")
        # Annulation : les participants sont prévenus (courriel d'annulation iCalendar).
        last = Mail.search([], order="id desc", limit=1).id
        body = self.ok("DELETE", f"/agenda/events/{ev['id']}", self.alice)
        self.assertEqual(body["mail"]["sent"], 3, "Les deux internes et l'externe")
        cancels = Mail.search([("id", ">", last)])
        self.assertEqual(len(cancels), 3)
        self.assertTrue(all("METHOD:CANCEL" in m.attachment_ids.raw.decode() for m in cancels))
        self.assertTrue(Notification.search([("user_id", "=", self.bruno.id), ("kind", "=", "cancel")]))

    def test_sans_serveur_de_courrier_rien_ne_part(self):
        self.env["ir.mail_server"].sudo().search([]).unlink()
        before = self.env["mail.mail"].sudo().search_count([])
        body = self.create(self.alice, "Point rapide", attendees=[{"user_id": self.bruno.id},
                                                                  {"email": "ext@exemple.gn"}])
        self.assertEqual(body["mail"], {"sent": 0, "mail_server": False})
        self.assertEqual(self.env["mail.mail"].sudo().search_count([]), before, "Aucun courriel sans serveur paramétré")
        self.assertTrue(self.env["eguitra.agenda.notification"].sudo().search([("user_id", "=", self.bruno.id)]),
                        "L'invitation reste dans l'application")

    def test_participants_refuses(self):
        for item in ({"user_id": self.sans_profil.id}, {"user_id": self.conducteur.id}, {"email": "pas une adresse"}):
            status, body = self.call("POST", "/agenda/events", {"name": "X", "start": z(self.at(0, 9)),
                                                                "stop": z(self.at(0, 10)), "attendees": [item]},
                                     token=self.token(self.alice))
            self.assertEqual(status, 422, f"{item} : {body}")
        if self.cabinet:
            status, body = self.call("POST", "/agenda/events", {"name": "X", "start": z(self.at(0, 9)),
                                                                "stop": z(self.at(0, 10)),
                                                                "attendees": [{"user_id": self.consultant.id}]},
                                     token=self.token(self.alice))
            self.assertEqual(status, 403, "Aucune société partagée avec le consultant")
        # Une adresse d'un compte interne devient ce compte.
        body = self.create(self.alice, "Par adresse", attendees=[{"email": "BRUNO@eguitra.test"}])
        self.assertEqual([a["user_id"] for a in body["event"]["attendees"]], [self.bruno.id])

    def test_conflits_signales_sans_bloquer(self):
        self.create(self.bruno, "Tournée du parc", hour=9, minutes=120)
        body = self.create(self.alice, "Point exploitation", hour=10, attendees=[{"user_id": self.bruno.id}])
        self.assertEqual([c["user_id"] for c in body["conflicts"]], [self.bruno.id])
        self.assertIn("occupé", body["conflicts"][0]["message"])
        self.assertTrue(body["event"]["id"], "Conflit signalé, événement créé quand même")

    def test_pieces_jointes_et_export_ics(self):
        ev = self.create(self.alice, "Comité d'audit", attendees=[{"user_id": self.bruno.id}])["event"]
        response = self.url_open(f"/api/v1/agenda/events/{ev['id']}/attachments", data={},
                                 files=[("file", ("ordre.exe", io.BytesIO(PDF), "application/octet-stream"))],
                                 method="POST", headers={"Authorization": f"Bearer {self.token(self.alice)}",
                                                         "X-Eguitra-App": "test"})
        self.assertEqual(response.status_code, 200, response.text)
        piece = response.json()["attachments"][0]
        self.assertEqual((piece["name"], piece["mimetype"]), ("ordre.pdf", "application/pdf"))
        response = self.url_open(f"/api/v1/agenda/events/{ev['id']}/attachments", data={},
                                 files=[("file", ("virus.pdf", io.BytesIO(EXE), "application/octet-stream"))],
                                 method="POST", headers={"Authorization": f"Bearer {self.token(self.alice)}",
                                                         "X-Eguitra-App": "test"})
        self.assertEqual(response.status_code, 415)
        response = self.url_open(f"/api/v1/agenda/events/{ev['id']}/attachments/{piece['id']}",
                                 headers={"Authorization": f"Bearer {self.token(self.bruno)}", "X-Eguitra-App": "test"})
        self.assertEqual((response.status_code, response.content), (200, PDF), "Le participant lit la pièce")
        status, _b = self.call("GET", f"/agenda/events/{ev['id']}/attachments/{piece['id']}", token=self.token(self.carla))
        self.assertEqual(status, 404)
        response = self.url_open(f"/api/v1/agenda/events/{ev['id']}/ics",
                                 headers={"Authorization": f"Bearer {self.token(self.bruno)}", "X-Eguitra-App": "test"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/calendar", response.headers["Content-Type"])
        text = response.content.decode().replace("\r\n ", "")
        self.assertIn("SUMMARY:Comité d'audit", text)
        self.assertIn(f"DTSTART:{self.at(0, 9):%Y%m%dT%H%M%SZ}", text)
        status, _b = self.call("GET", f"/agenda/events/{ev['id']}/ics", token=self.token(self.carla))
        self.assertEqual(status, 404, "Pas d'export pour qui ne lit pas l'événement")

    def test_import_ics_sans_doublon(self):
        content = "\r\n".join([
            "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:import-1@ext",
            f"DTSTART:{self.at(2, 8):%Y%m%dT%H%M%SZ}", f"DTEND:{self.at(2, 9):%Y%m%dT%H%M%SZ}",
            "SUMMARY:Rendez-vous banque", "RRULE:FREQ=WEEKLY;COUNT=3",
            "ATTENDEE;CN=Banquier:mailto:banquier@banque.gn", "END:VEVENT", "END:VCALENDAR",
        ]).encode()
        cal = self.personal(self.alice)
        for expected in ({"created": 1, "updated": 0}, {"created": 0, "updated": 1}):
            response = self.url_open("/api/v1/agenda/import", data={"calendar_id": str(cal.id)},
                                     files=[("file", ("agenda.ics", io.BytesIO(content), "text/calendar"))], method="POST",
                                     headers={"Authorization": f"Bearer {self.token(self.alice)}", "X-Eguitra-App": "test"})
            self.assertEqual(response.status_code, 200, response.text)
            result = response.json()
            self.assertEqual((result["created"], result["updated"]), (expected["created"], expected["updated"]))
        rows = self.events(self.alice, [cal], days=21)
        self.assertEqual(len(self.by_title(rows, "Rendez-vous banque")), 3, "Série importée, une seule fois")
        imported = self.env["eguitra.agenda.event"].sudo().search([("ics_uid", "=", "import-1@ext")])
        self.assertFalse(imported.attendee_ids, "L'import n'invite personne")
        response = self.url_open("/api/v1/agenda/import", data={"calendar_id": str(self.personal(self.bruno).id)},
                                 files=[("file", ("agenda.ics", io.BytesIO(content), "text/calendar"))], method="POST",
                                 headers={"Authorization": f"Bearer {self.token(self.alice)}", "X-Eguitra-App": "test"})
        self.assertEqual(response.status_code, 404, "Pas d'import dans l'agenda d'un autre")

    def test_recherche(self):
        self.create(self.alice, "Négociation avec Total", day=3, location="Kaloum")
        self.create(self.alice, "Autre sujet", day=4, description="Rien à voir")
        self.create(self.carla, "Total confidentiel", day=3)
        rows = self.ok("GET", "/agenda/search?q=total", self.alice)
        self.assertEqual([r["title"] for r in rows], ["Négociation avec Total"], "Ses événements seulement")
        self.assertEqual(self.ok("GET", "/agenda/search?q=kaloum", self.alice)[0]["title"], "Négociation avec Total")

    def test_fiche_liee(self):
        demande = self.env["eguitra.support.request"].with_user(self.alice).create({
            "kind": "question", "severity": "mineure", "app": "finance", "title": "Lettrage",
            "description": "Question de lettrage",
        })
        with patch.dict(common.OBJECT_MODELS, {"eguitra.support.request": ("Demande", "/compte/demandes/{id}")}):
            ev = self.create(self.alice, "Point sur la demande", res_model="eguitra.support.request",
                             res_id=demande.id)["event"]
            self.assertEqual((ev["link"]["type"], ev["link"]["readable"]), ("Demande", True))
            status, body = self.call("POST", "/agenda/events", {"name": "Lien volé", "start": z(self.at(0, 9)),
                                                                "stop": z(self.at(0, 10)),
                                                                "res_model": "eguitra.support.request",
                                                                "res_id": demande.id}, token=self.token(self.carla))
            self.assertEqual(status, 422, "Une fiche qu'on ne lit pas ne se lie pas")

    def test_categories_personnelles(self):
        cat = self.ok("POST", "/agenda/categories", self.alice, {"name": "Banques", "color": "#12956a"})
        self.assertTrue(cat["mine"])
        status, _b = self.call("POST", "/agenda/categories", {"name": "Couleur", "color": "rouge"}, token=self.token(self.alice))
        self.assertEqual(status, 422)
        status, _b = self.call("DELETE", f"/agenda/categories/{cat['id']}", token=self.token(self.carla))
        self.assertEqual(status, 403, "On ne supprime que ses catégories")
        common_cat = self.env.ref("eguitra_agenda.category_meeting")
        status, _b = self.call("DELETE", f"/agenda/categories/{common_cat.id}", token=self.token(self.alice))
        self.assertEqual(status, 403, "Les catégories communes restent")
        ev = self.create(self.carla, "Avec catégorie d'autrui", category_ids=[cat["id"], common_cat.id])["event"]
        self.assertEqual([c["name"] for c in ev["categories"]], ["Réunion"], "Pas la catégorie d'un autre compte")
        self.ok("DELETE", f"/agenda/categories/{cat['id']}", self.alice)

    def test_notifications_lues(self):
        self.create(self.alice, "Invitation 1", attendees=[{"user_id": self.bruno.id}])
        self.create(self.alice, "Invitation 2", day=1, attendees=[{"user_id": self.bruno.id}])
        rows = self.ok("GET", "/agenda/notifications", self.bruno)
        self.assertEqual(len(rows), 2)
        counts = self.ok("POST", "/agenda/notifications/read", self.bruno, {"ids": [rows[0]["id"]]})
        self.assertEqual(counts["unread"], 1)
        counts = self.ok("POST", "/agenda/notifications/read", self.bruno, {})
        self.assertEqual(counts["unread"], 0)
        self.assertEqual(self.ok("GET", "/agenda/notifications", self.alice), [], "Chacun ses notifications")
        Log = self.env["eguitra.api.access.log"].sudo()
        before = Log.search_count([("user_id", "=", self.bruno.id), ("path", "like", "/agenda/notifications/unread")])
        self.ok("GET", "/agenda/notifications/unread", self.bruno)
        self.env.invalidate_all()
        self.assertEqual(Log.search_count([("user_id", "=", self.bruno.id),
                                           ("path", "like", "/agenda/notifications/unread")]), before,
                         "La relecture du compteur n'entre pas au journal des accès")
