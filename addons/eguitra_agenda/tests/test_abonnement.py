from odoo.tests import tagged

from odoo.addons.eguitra_api.models.api_token import hash_token

from .common import AgendaCase


@tagged("post_install", "-at_install")
class TestAbonnement(AgendaCase):
    """Lien d'abonnement iCalendar : jeton long rendu une fois, seule son empreinte en base, lecture seule de
    l'agenda personnel, événements privés « Occupé », sans participants ; révocable ; fermé à un compte
    désactivé."""

    def feed(self, path):
        response = self.url_open(f"/api/v1/agenda/feed/{path.split('/ical/')[1]}")
        return response.status_code, response.content.decode("utf-8", "replace").replace("\r\n ", "")

    def test_lien_d_abonnement(self):
        self.create(self.alice, "Comité de trésorerie", attendees=[{"user_id": self.bruno.id}])
        self.create(self.alice, "Rendez-vous médical", hour=14, privacy="private", location="Clinique")
        self.create(self.bruno, "Invitation acceptée", day=1, attendees=[{"user_id": self.alice.id}])
        self.create(self.carla, "Agenda de Carla", day=2)
        self.assertEqual(self.ok("GET", "/agenda/subscription", self.alice), {"active": False})
        sub = self.ok("POST", "/agenda/subscription", self.alice, {"mask_private": True})
        path = sub["path"]
        raw = path.split("/ical/")[1][:-4]
        self.assertGreaterEqual(len(raw), 60, "Jeton long")
        self.assertEqual(sub["hint"], raw[-4:])
        record = self.env["eguitra.agenda.subscription"].sudo().search([("user_id", "=", self.alice.id)])
        self.assertEqual(record.token_hash, hash_token(raw), "Seule l'empreinte est gardée")
        self.assertNotIn(raw, str(record.read()), "Le jeton lui-même n'est nulle part en base")
        self.assertNotIn("path", self.ok("GET", "/agenda/subscription", self.alice), "Rendu une seule fois")

        status, text = self.feed(path)
        self.assertEqual(status, 200)
        self.assertIn("BEGIN:VCALENDAR", text)
        self.assertIn("SUMMARY:Comité de trésorerie", text)
        self.assertIn("SUMMARY:Invitation acceptée", text, "Les invitations de l'agenda personnel")
        self.assertNotIn("Agenda de Carla", text, "Rien d'un autre agenda")
        self.assertNotIn("Rendez-vous médical", text)
        self.assertNotIn("Clinique", text)
        self.assertIn("SUMMARY:Occupé", text, "Événement privé en « Occupé »")
        self.assertNotIn("ATTENDEE", text, "Aucun participant dans un abonnement")
        self.assertNotIn("bruno@eguitra.test", text)

        # Sans masque : l'événement privé paraît (le lien reste secret).
        sub = self.ok("POST", "/agenda/subscription", self.alice, {"mask_private": False})
        status, old = self.feed(path)
        self.assertEqual(status, 404, "Un nouveau lien remplace l'ancien")
        status, text = self.feed(sub["path"])
        self.assertIn("Rendez-vous médical", text)
        # Révocation, puis compte désactivé.
        self.assertEqual(self.ok("DELETE", "/agenda/subscription", self.alice), {"revoked": True})
        self.assertEqual(self.feed(sub["path"])[0], 404)
        sub = self.ok("POST", "/agenda/subscription", self.bruno, {})
        self.assertEqual(self.feed(sub["path"])[0], 200)
        self.bruno.sudo().active = False
        self.assertEqual(self.feed(sub["path"])[0], 404, "Compte désactivé : le lien ne sert plus")
        for bad in ("court.ics", "x" * 70 + ".ics", "../../etc/passwd"):
            response = self.url_open(f"/api/v1/agenda/feed/{bad}")
            self.assertEqual(response.status_code, 404, bad)
