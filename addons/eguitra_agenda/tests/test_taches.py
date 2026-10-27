from datetime import timedelta

from odoo.tests import tagged

from .common import AgendaCase


@tagged("post_install", "-at_install")
class TestTachesPlanifiees(AgendaCase):
    """Tâches planifiées : rappels (application et courriel, plusieurs délais, rappels par défaut), récapitulatif
    du matin, expiration des rendez-vous non confirmés ; rejouées, elles n'envoient rien deux fois."""

    def test_rappels_idempotents(self):
        self.mail_server()
        ev = self.create(self.alice, "Comité de crédit", hour=10, attendees=[{"user_id": self.bruno.id}],
                         alarms=[{"minutes": 30, "channel": "app"}, {"minutes": 1440, "channel": "email"}])["event"]
        Event = self.env["eguitra.agenda.event"]
        Notification = self.env["eguitra.agenda.notification"].sudo()
        Mail = self.env["mail.mail"].sudo()
        start = self.at(0, 10)
        self.assertEqual(Event._cron_reminders(now=start - timedelta(hours=25)), 0, "Trop tôt")
        last = Mail.search([], order="id desc", limit=1).id or 0
        self.assertEqual(Event._cron_reminders(now=start - timedelta(hours=23)), 2, "La veille, par courriel, à chacun")
        self.assertEqual(Mail.search_count([("id", ">", last), ("subject", "like", "Rappel")]), 2)
        self.assertEqual(Event._cron_reminders(now=start - timedelta(hours=22)), 0, "Jamais deux fois")
        self.assertEqual(Event._cron_reminders(now=start - timedelta(minutes=20)), 2, "Une demi-heure avant, dans l'application")
        self.assertEqual(Notification.search_count([("kind", "=", "reminder"), ("event_id", "=", ev["id"])]), 2)
        self.assertEqual(Event._cron_reminders(now=start - timedelta(minutes=10)), 0)
        self.assertEqual(Event._cron_reminders(now=start + timedelta(minutes=30)), 0, "Événement commencé : plus rien")
        # Un participant qui refuse ne reçoit plus de rappel.
        ev2 = self.create(self.alice, "Second comité", day=1, hour=10, attendees=[{"user_id": self.bruno.id}],
                          alarms=[{"minutes": 15, "channel": "app"}])["event"]
        self.ok("POST", f"/agenda/events/{ev2['id']}/respond", self.bruno, {"state": "declined"})
        self.assertEqual(Event._cron_reminders(now=self.at(1, 9, 50)), 1, "L'organisatrice seule")

    def test_rappels_par_defaut_et_series(self):
        self.ok("PATCH", "/agenda/preferences", self.alice, {"default_alarms": [{"minutes": 10, "channel": "app"}]})
        self.create(self.alice, "Point quotidien", hour=8, recurrence={"freq": "daily", "end": "count", "count": 3})
        Event = self.env["eguitra.agenda.event"]
        self.assertEqual(Event._cron_reminders(now=self.at(1, 7, 55)), 1, "Chaque occurrence a son rappel")
        self.assertEqual(Event._cron_reminders(now=self.at(1, 7, 56)), 0)
        self.assertEqual(Event._cron_reminders(now=self.at(2, 7, 51)), 1)
        Log = self.env["eguitra.agenda.reminder.log"].sudo()
        self.assertEqual(Log.search_count([("user_id", "=", self.alice.id)]), 2)

    def test_recapitulatif_du_matin(self):
        self.env["ir.mail_server"].sudo().search([]).unlink()
        self.ok("PATCH", "/agenda/preferences", self.alice, {"digest": True, "digest_hour": 7})
        self.create(self.alice, "Banque", day=0, hour=10)
        self.create(self.bruno, "Invitée", day=0, hour=15, attendees=[{"user_id": self.alice.id}])
        self.create(self.alice, "Demain", day=1, hour=9)
        Event = self.env["eguitra.agenda.event"]
        Notification = self.env["eguitra.agenda.notification"].sudo()
        self.assertEqual(Event._cron_digest(now=self.at(0, 6)), 0, "Avant l'heure choisie")
        self.assertEqual(Event._cron_digest(now=self.at(0, 7, 5)), 1)
        digest = Notification.search([("user_id", "=", self.alice.id), ("kind", "=", "digest")])
        self.assertEqual(len(digest), 1, "Sans serveur de courrier : dans l'application")
        self.assertIn("10:00 : Banque", digest.body)
        self.assertIn("15:00 : Invitée", digest.body)
        self.assertNotIn("Demain", digest.body)
        self.assertEqual(Event._cron_digest(now=self.at(0, 8)), 0, "Une fois par jour")
        self.assertEqual(Event._cron_digest(now=self.at(1, 7, 30)), 1, "Le lendemain")

    def test_taches_declarees(self):
        for xmlid in ("cron_reminders", "cron_digest", "cron_booking_expire", "cron_purge_notifications"):
            cron = self.env.ref(f"eguitra_agenda.{xmlid}")
            self.assertTrue(cron.active, xmlid)
        self.assertEqual(self.env["eguitra.agenda.notification"]._cron_purge(), 0)
