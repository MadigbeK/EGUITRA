"""Suivi des échanges : notifications du portail, messages lus, avis des porteurs sur l'accompagnement."""

from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import UserError

NOTIFICATION_KINDS = [
    ("message", "Message"),
    ("document", "Pièce"),
    ("action", "Action"),
    ("gate", "Étape"),
    ("decision", "Décision"),
    ("meeting", "Rendez-vous"),
    ("announcement", "Communication"),
    ("event", "Événement"),
    ("funding", "Financement"),
    ("resource", "Ressource"),
]
FEEDBACK_TOPICS = [
    ("global", "Accompagnement"),
    ("consultant", "Consultant"),
    ("portail", "Portail"),
    ("event", "Événement"),
]
NOTIFICATION_RETENTION_DAYS = 180


class PortailNotification(models.Model):
    _name = "portail.notification"
    _description = "Notification du portail"
    _order = "create_date desc, id desc"

    user_id = fields.Many2one("res.users", required=True, ondelete="cascade", index=True)
    dossier_id = fields.Many2one("axispro.dossier", ondelete="cascade", index=True)
    kind = fields.Selection(NOTIFICATION_KINDS, required=True)
    title = fields.Char(required=True)
    body = fields.Char()
    link = fields.Char()
    read_at = fields.Datetime(index=True)

    @api.model
    def notify(self, users, kind, title, body="", link=None, dossier=None):
        """Une notification par destinataire actif (l'auteur de l'événement n'est pas notifié)."""
        users = users.filtered(lambda u: u.active and u != self.env.user)
        if not users:
            return self.browse()
        return self.sudo().create([{
            "user_id": u.id, "kind": kind, "title": (title or "")[:200], "body": (body or "")[:300] or False,
            "link": link or False, "dossier_id": dossier.id if dossier else False,
        } for u in users])

    @api.model
    def _cron_purge(self):
        limit = fields.Datetime.now() - timedelta(days=NOTIFICATION_RETENTION_DAYS)
        self.sudo().search([("read_at", "!=", False), ("read_at", "<", limit)]).unlink()

    @api.model
    def _cron_reminders(self):
        """Rappels du matin : rendez-vous et événements du lendemain, actions à rendre dans deux jours."""
        now = fields.Datetime.now()
        tomorrow, after = now + timedelta(hours=12), now + timedelta(hours=36)
        for meeting in self.env["portail.meeting"].sudo().search(
                [("state", "=", "confirmed"), ("start", ">=", tomorrow), ("start", "<", after)]):
            when = fields.Datetime.context_timestamp(meeting, meeting.start)
            self.notify(meeting.dossier_id.portal_user_ids, "meeting", f"Rappel : rendez-vous demain à {when:%H h %M}",
                        meeting.subject, "/portail/rendez-vous", dossier=meeting.dossier_id)
        for event in self.env["portail.event"].sudo().search(
                [("state", "=", "published"), ("start", ">=", tomorrow), ("start", "<", after)]):
            when = fields.Datetime.context_timestamp(event, event.start)
            users = event.registration_ids.filtered(lambda r: r.state == "registered").user_id
            self.notify(users, "event", f"Rappel : {event.name} demain à {when:%H h %M}",
                        event.location or "En ligne", "/portail/evenements")
        due = fields.Date.context_today(self) + timedelta(days=2)
        for action in self.env["axispro.action"].sudo().search(
                [("due_date", "=", due), ("assignee", "=", "porteur"), ("portal_visible", "=", True),
                 ("state", "in", ("todo", "in_progress"))]):
            self.notify(action.dossier_id.portal_user_ids, "action", f"Échéance dans deux jours : {action.name}",
                        f"À rendre le {action.due_date:%d/%m/%Y}.", f"/portail/actions?dossier={action.dossier_id.id}",
                        dossier=action.dossier_id)


class PortailReadMarker(models.Model):
    """Dernier message lu d'un dossier par un utilisateur (porteur ou cabinet) : messages non lus."""

    _name = "portail.read.marker"
    _description = "Messages lus d'un dossier"

    user_id = fields.Many2one("res.users", required=True, ondelete="cascade", index=True)
    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True)
    message_id = fields.Integer("Dernier message lu")

    _unique = models.Constraint("unique(user_id, dossier_id)", "Un repère par utilisateur et par dossier.")

    @api.model
    def mark(self, user, dossier, message_id):
        marker = self.sudo().search([("user_id", "=", user.id), ("dossier_id", "=", dossier.id)], limit=1)
        if not marker:
            self.sudo().create({"user_id": user.id, "dossier_id": dossier.id, "message_id": message_id})
        elif message_id > marker.message_id:
            marker.message_id = message_id

    @api.model
    def unread(self, user, dossiers, internal=False):
        """Messages non lus par dossier : ceux des autres, après le repère de l'utilisateur."""
        if not dossiers:
            return {}
        markers = {m.dossier_id.id: m.message_id for m in self.sudo().search(
            [("user_id", "=", user.id), ("dossier_id", "in", dossiers.ids)])}
        domain = [("dossier_id", "in", dossiers.ids), ("author_id", "!=", user.id)]
        if not internal:
            domain.append(("internal", "=", False))
        counts = dict.fromkeys(dossiers.ids, 0)
        for message in self.env["axispro.message"].sudo().search_read(domain, ["dossier_id"]):
            dossier_id = message["dossier_id"][0]
            if message["id"] > markers.get(dossier_id, 0):
                counts[dossier_id] += 1
        return counts


class PortailFeedback(models.Model):
    _name = "portail.feedback"
    _description = "Avis d'un porteur sur l'accompagnement"
    _order = "create_date desc, id desc"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True)
    user_id = fields.Many2one("res.users", required=True, default=lambda self: self.env.user, ondelete="cascade")
    topic = fields.Selection(FEEDBACK_TOPICS, "Sujet", default="global", required=True)
    event_id = fields.Many2one("portail.event", "Événement", ondelete="set null")
    score = fields.Integer("Note (1 à 5)", required=True)
    recommend = fields.Integer("Recommandation (0 à 10)", default=-1, help="-1 : non donnée.")
    comment = fields.Text("Commentaire")

    @api.constrains("score", "recommend")
    def _check_scores(self):
        for feedback in self:
            if not 1 <= feedback.score <= 5:
                raise UserError("Note comprise entre 1 et 5.")
            if not -1 <= feedback.recommend <= 10:
                raise UserError("Recommandation comprise entre 0 et 10.")
