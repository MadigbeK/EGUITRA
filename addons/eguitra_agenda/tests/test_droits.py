from odoo.tests import tagged

from ..models.common import AGENDA_PROFILES
from .common import AgendaCase

# Toutes les routes de l'agenda ouvertes à une session (méthode, adresse) ; les identifiants n'importent pas :
# le profil est contrôlé avant toute lecture.
ROUTES = [
    ("GET", "/agenda/me"), ("PATCH", "/agenda/preferences"), ("GET", "/agenda/users?q=a"),
    ("GET", "/agenda/contacts?q=ab"), ("POST", "/agenda/calendars"), ("PATCH", "/agenda/calendars/1"),
    ("DELETE", "/agenda/calendars/1"), ("POST", "/agenda/calendars/1/shares"), ("PATCH", "/agenda/shares/1"),
    ("DELETE", "/agenda/shares/1"), ("POST", "/agenda/categories"), ("DELETE", "/agenda/categories/1"),
    ("GET", "/agenda/resources"), ("POST", "/agenda/resources"), ("PATCH", "/agenda/resources/1"),
    ("DELETE", "/agenda/resources/1"), ("GET", "/agenda/events?start=2026-11-02&end=2026-11-09"),
    ("GET", "/agenda/events/1"), ("POST", "/agenda/events"), ("PATCH", "/agenda/events/1"),
    ("DELETE", "/agenda/events/1"), ("POST", "/agenda/events/1/respond"), ("POST", "/agenda/events/1/propose"),
    ("POST", "/agenda/events/1/proposals/1/accept"), ("POST", "/agenda/events/1/attendees/1/response"),
    ("POST", "/agenda/events/1/attachments"), ("GET", "/agenda/events/1/attachments/1"),
    ("DELETE", "/agenda/events/1/attachments/1"), ("GET", "/agenda/events/1/ics"), ("POST", "/agenda/import"),
    ("GET", "/agenda/search?q=ab"), ("POST", "/agenda/freebusy"), ("POST", "/agenda/find-slots"),
    ("GET", "/agenda/planning?start=2026-11-02&end=2026-11-03"), ("GET", "/agenda/sources?start=2026-11-02&end=2026-11-03"),
    ("GET", "/agenda/notifications/unread"), ("GET", "/agenda/notifications"), ("POST", "/agenda/notifications/read"),
    ("GET", "/agenda/journal"), ("POST", "/agenda/delegations"), ("PATCH", "/agenda/delegations/1"),
    ("DELETE", "/agenda/delegations/1"), ("GET", "/agenda/admin/executives"), ("GET", "/agenda/subscription"),
    ("POST", "/agenda/subscription"), ("DELETE", "/agenda/subscription"), ("GET", "/agenda/booking-types"),
    ("POST", "/agenda/booking-types"), ("PATCH", "/agenda/booking-types/1"), ("DELETE", "/agenda/booking-types/1"),
    ("GET", "/agenda/bookings"), ("POST", "/agenda/admin/users/1/remove"), ("GET", "/agenda/admin/settings"),
    ("PATCH", "/agenda/admin/settings"),
]
ADMIN_ONLY = [
    ("POST", "/agenda/resources"), ("PATCH", "/agenda/resources/1"), ("DELETE", "/agenda/resources/1"),
    ("POST", "/agenda/admin/users/1/remove"), ("GET", "/agenda/admin/settings"), ("PATCH", "/agenda/admin/settings"),
]
POSE_ONLY = [("GET", "/agenda/admin/executives")]


@tagged("post_install", "-at_install")
class TestDroits(AgendaCase):
    """Refus par profil de chaque route : le porteur de projet, le conducteur, l'auditeur et le compte sans
    profil n'ont pas d'agenda (403 partout) ; les routes de l'administration et de la direction refusent les
    autres profils ; le modèle refuse aussi, quel que soit l'appelant."""

    def test_toutes_les_routes_refusees_hors_des_profils_de_l_agenda(self):
        refused = [self.conducteur, self.auditeur, self.sans_profil] + ([self.porteur] if self.cabinet else [])
        for user in refused:
            token = self.token(user)
            for method, path in ROUTES:
                with self.subTest(compte=user.login, route=f"{method} {path}"):
                    status, body = self.call(method, path, {} if method != "GET" else None, token=token)
                    self.assertEqual(status, 403, body)
        self.assertNotIn("agenda", self.conducteur._eguitra_apps())
        self.assertNotIn("agenda", self.sans_profil._eguitra_apps())
        status, body = self.call("POST", "/auth/login", {"login": self.sans_profil.login, "password": "Motdepasse-2026!",
                                                          "app": "agenda"})
        self.assertEqual(status, 403, body)

    def test_routes_de_l_administration(self):
        for user in (self.alice, self.dana, self.awa):
            for method, path in ADMIN_ONLY:
                with self.subTest(compte=user.login, route=f"{method} {path}"):
                    status, body = self.call(method, path, {} if method != "GET" else None, token=self.token(user))
                    self.assertEqual(status, 403, body)
        for user in (self.alice, self.awa, self.bruno):
            for method, path in POSE_ONLY:
                status, body = self.call(method, path, token=self.token(user))
                self.assertEqual(status, 403, body)
        self.assertEqual(self.call("GET", "/agenda/admin/executives", token=self.token(self.dana))[0], 200)
        self.assertEqual(self.call("GET", "/agenda/admin/settings", token=self.token(self.admin))[0], 200)

    def test_tous_les_profils_internes_ouvrent_l_agenda(self):
        cabinet = {"company_id": self.cabinet.id, "company_ids": [(6, 0, self.cabinet.ids)]} if self.cabinet else {}
        for profile in AGENDA_PROFILES:
            extra = cabinet if profile in ("cabinet", "associe") else {}
            profiles = ("cabinet", "associe") if profile == "associe" else (profile,)
            if profile in ("cabinet", "associe") and not self.cabinet:
                continue
            user = self._create_user(f"profil.{profile}.agenda", *profiles, **extra)
            with self.subTest(profil=profile):
                self.assertIn("agenda", user._eguitra_apps())
                self.assertEqual(self.call("GET", "/agenda/me", token=self.token(user))[0], 200)

    def test_le_modele_refuse_aussi(self):
        from odoo.exceptions import AccessError

        Event = self.env["eguitra.agenda.event"]
        with self.assertRaises(AccessError):
            Event.with_user(self.sans_profil).create_event({"name": "X", "start": "2026-11-02T09:00:00Z",
                                                           "stop": "2026-11-02T10:00:00Z"})
        with self.assertRaises(AccessError):
            self.env["eguitra.agenda.calendar"].with_user(self.conducteur).create_team("Équipe")
        with self.assertRaises(AccessError):
            self.env["eguitra.agenda.calendar"].with_user(self.alice).create_resource({"name": "Salle"})
