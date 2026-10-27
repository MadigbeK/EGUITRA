from odoo.tests import tagged

from .. import AUDITED_MODELS
from .common import AgendaCase


@tagged("post_install", "-at_install")
class TestCompteDesactive(AgendaCase):
    """Un compte désactivé perd ses partages et ses délégations ; les participants de ses événements à venir
    en sont prévenus ; l'administration rejoue le retrait sans lire aucun agenda. Piste d'audit en place."""

    def test_desactivation(self):
        bruno_cal = self.personal(self.bruno)
        self.ok("POST", f"/agenda/calendars/{bruno_cal.id}/shares", self.bruno, {"user_id": self.alice.id, "level": "read"})
        self.ok("POST", f"/agenda/calendars/{self.personal(self.alice).id}/shares", self.alice,
                {"user_id": self.bruno.id, "level": "write"})
        self.ok("POST", "/agenda/delegations", self.bruno, {"delegate_id": self.carla.id})
        self.ok("POST", "/agenda/subscription", self.bruno, {})
        ev = self.create(self.bruno, "Tournée de Kamsar", day=2, attendees=[{"user_id": self.alice.id},
                                                                             {"user_id": self.carla.id}])["event"]
        status, body = self.call("POST", f"/agenda/admin/users/{self.bruno.id}/remove", token=self.token(self.admin))
        self.assertEqual(status, 422, "Compte encore actif")

        self.bruno.sudo().write({"active": False})
        Share = self.env["eguitra.agenda.share"].sudo()
        self.assertFalse(Share.search(["|", ("user_id", "=", self.bruno.id), ("calendar_id.owner_id", "=", self.bruno.id)]),
                         "Partages reçus et accordés retirés")
        self.assertFalse(self.env["eguitra.agenda.delegation"].sudo().search(
            ["|", ("owner_id", "=", self.bruno.id), ("delegate_id", "=", self.bruno.id)]))
        self.assertFalse(self.env["eguitra.agenda.subscription"].sudo().search([("user_id", "=", self.bruno.id)]))
        Notification = self.env["eguitra.agenda.notification"].sudo()
        for user in (self.alice, self.carla):
            notice = Notification.search([("user_id", "=", user.id), ("kind", "=", "organizer_inactive")])
            self.assertEqual(len(notice), 1, user.login)
            self.assertIn("Tournée de Kamsar", notice.title)
        self.assertTrue(self.env["eguitra.agenda.event"].sudo().browse(ev["id"]).organizer_inactive)
        detail = self.ok("GET", f"/agenda/events/{ev['id']}", self.alice)
        self.assertTrue(detail["organizer_inactive"])
        self.assertEqual(self.events(self.alice, [bruno_cal]), [], "L'agenda du compte désactivé ne se lit plus")

        # Rejouée par l'administration : rien de plus à retirer, personne n'est prévenu deux fois.
        body = self.ok("POST", f"/agenda/admin/users/{self.bruno.id}/remove", self.admin)
        self.assertEqual(body, {"shares": 0, "delegations": 0, "events": 0})
        self.assertEqual(Notification.search_count([("kind", "=", "organizer_inactive")]), 2)
        status, _b = self.call("POST", f"/agenda/admin/users/{self.bruno.id}/remove", token=self.token(self.dana))
        self.assertEqual(status, 403)

    def test_piste_d_audit(self):
        Rule = self.env["auditlog.rule"].sudo()
        for model in AUDITED_MODELS:
            self.assertTrue(Rule.search_count([("model_id.model", "=", model), ("state", "=", "confirmed")]), model)
        for model in ("eguitra.agenda.notification", "eguitra.agenda.reminder.log", "eguitra.agenda.booking.attempt"):
            self.assertFalse(Rule.search_count([("model_id.model", "=", model)]), model)
        if "fields_to_exclude_ids" in Rule._fields:
            rule = Rule.search([("model_id.model", "=", "eguitra.agenda.event")])
            self.assertEqual(set(rule.fields_to_exclude_ids.mapped("name")), {"name", "location", "video_url", "description"},
                             "Le contenu des événements n'entre pas dans la piste d'audit")
