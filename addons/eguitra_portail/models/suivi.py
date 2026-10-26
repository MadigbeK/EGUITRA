"""Suivi des échanges : notifications du portail, messages lus, avis des porteurs sur l'accompagnement."""

import logging
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from odoo import api, fields, models
from odoo.exceptions import UserError

from .agenda import TZ

_logger = logging.getLogger(__name__)

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
    reminder_key = fields.Char("Rappel", index=True, help="Objet et date rappelés (« meeting:12:2026-11-04 09:00 ») : "
                                                           "un même rappel n'est jamais envoyé deux fois.")

    @api.model
    def notify(self, users, kind, title, body="", link=None, dossier=None, reminder_key=None):
        """Une notification par destinataire actif (l'auteur de l'événement n'est pas notifié)."""
        users = users.filtered(lambda u: u.active and u != self.env.user)
        if not users:
            return self.browse()
        return self.sudo().create([{
            "user_id": u.id, "kind": kind, "title": (title or "")[:200], "body": (body or "")[:300] or False,
            "link": link or False, "dossier_id": dossier.id if dossier else False, "reminder_key": reminder_key or False,
        } for u in users])

    @api.model
    def _cron_purge(self):
        limit = fields.Datetime.now() - timedelta(days=NOTIFICATION_RETENTION_DAYS)
        self.sudo().search([("read_at", "!=", False), ("read_at", "<", limit)]).unlink()

    @api.model
    def _remind(self, users, key, kind, title, body, link, dossier=None):
        """Rappel mémorisé : envoyé une fois par destinataire pour un même objet et une même date."""
        done = self.sudo().search([("reminder_key", "=", key), ("user_id", "in", users.ids)]).user_id
        return self.notify(users - done, kind, title, body, link, dossier=dossier, reminder_key=key)

    @api.model
    def _cron_reminders(self, now=None):
        """Rappels du matin, au calendrier de Conakry : rendez-vous confirmés et événements de demain,
        actions à rendre dans deux jours. Chaque rappel envoyé est mémorisé (reminder_key) : la tâche
        relancée le même jour n'envoie rien deux fois ; passée en retard (ou sautée la veille), elle
        rattrape ce qui n'a pas été annoncé (rendez-vous et événements encore à venir aujourd'hui,
        actions à rendre demain), en le disant (« aujourd'hui », « demain »). Un objet en erreur
        n'empêche pas les rappels des autres. now : instant de référence (UTC), pour les essais."""
        tz = ZoneInfo(TZ)
        now = now or fields.Datetime.now()

        def local(value):
            return value.replace(tzinfo=UTC).astimezone(tz)

        def jour(value):
            return "aujourd'hui" if local(value).date() == today else "demain"

        today = local(now).date()
        # Fin de demain à Conakry (minuit du surlendemain), en UTC comme les dates du noyau.
        horizon = datetime.combine(today + timedelta(days=2), time.min, tzinfo=tz).astimezone(UTC).replace(
            tzinfo=None)

        for meeting in self.env["portail.meeting"].sudo().search(
                [("state", "=", "confirmed"), ("start", ">=", now), ("start", "<", horizon)]):
            self._isolated(meeting, lambda m: self._remind(
                m.dossier_id.portal_user_ids, f"meeting:{m.id}:{m.start:%Y-%m-%d %H:%M}", "meeting",
                f"Rappel : rendez-vous {jour(m.start)} à {local(m.start):%H h %M}", m.subject,
                "/portail/rendez-vous", dossier=m.dossier_id))
        for event in self.env["portail.event"].sudo().search(
                [("state", "=", "published"), ("start", ">=", now), ("start", "<", horizon)]):
            self._isolated(event, lambda e: self._remind(
                e.registration_ids.filtered(lambda r: r.state == "registered").user_id,
                f"event:{e.id}:{e.start:%Y-%m-%d %H:%M}", "event",
                f"Rappel : {e.name} {jour(e.start)} à {local(e.start):%H h %M}", e.location or "En ligne",
                "/portail/evenements"))
        for action in self.env["axispro.action"].sudo().search(
                [("due_date", ">", today), ("due_date", "<=", today + timedelta(days=2)), ("assignee", "=", "porteur"),
                 ("portal_visible", "=", True), ("state", "in", ("todo", "in_progress"))]):
            delay = "demain" if action.due_date == today + timedelta(days=1) else "dans deux jours"
            self._isolated(action, lambda a: self._remind(
                a.dossier_id.portal_user_ids, f"action:{a.id}:{a.due_date}", "action", f"Échéance {delay} : {a.name}",
                f"À rendre le {a.due_date:%d/%m/%Y}.", f"/portail/actions?dossier={a.dossier_id.id}",
                dossier=a.dossier_id))

    @api.model
    def _isolated(self, record, send):
        try:
            with self.env.cr.savepoint():
                send(record)
        except Exception:
            _logger.exception("Rappel du portail impossible pour %s", record)


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
