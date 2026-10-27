"""Notifications de l'agenda dans l'application, journal des actions sur un agenda, rappels envoyés.

Notifications : le même mécanisme que la discussion interne (relecture discrète d'un compteur par l'en-tête,
toutes les 30 secondes, hors journal des accès) ; chacune est lue par son seul destinataire. Elles restent
hors de la piste d'audit (eguitra_base, AUDIT_EXCLUDED_MODELS) : elles recopient les titres des
événements, que l'administration ne lit pas.

Journal : chaque création, modification, suppression, réponse, partage ou délégation sur un agenda, avec
son auteur et, quand un délégué agit, le compte pour lequel il agit (« par X pour le compte de Y ») ; lu
par le propriétaire et ses délégués. Il ne recopie pas le contenu des événements.
"""

from datetime import timedelta

from odoo import api, fields, models

NOTIFICATION_KINDS = [
    ("invitation", "Invitation"), ("update", "Événement modifié"), ("cancel", "Événement annulé"),
    ("response", "Réponse à une invitation"), ("proposal", "Autre horaire proposé"), ("reminder", "Rappel"),
    ("share", "Partage"), ("delegation", "Délégation"), ("ooo", "Absence du bureau"),
    ("organizer_inactive", "Organisateur désactivé"), ("booking", "Prise de rendez-vous"), ("digest", "Votre journée"),
]
JOURNAL_ACTIONS = [
    ("event_create", "Événement créé"), ("event_update", "Événement modifié"), ("event_delete", "Événement supprimé"),
    ("event_respond", "Réponse à une invitation"), ("calendar_create", "Agenda créé"),
    ("calendar_delete", "Agenda supprimé"), ("share_add", "Partage accordé"), ("share_update", "Partage modifié"),
    ("share_remove", "Partage retiré"), ("delegation_add", "Délégation accordée"),
    ("delegation_update", "Délégation modifiée"), ("delegation_remove", "Délégation retirée"),
    ("resource_create", "Ressource créée"), ("resource_update", "Ressource modifiée"),
    ("resource_archive", "Ressource retirée"), ("import", "Fichier importé"), ("account_disabled", "Compte désactivé"),
]


class AgendaNotification(models.Model):
    _name = "eguitra.agenda.notification"
    _description = "Notification de l'agenda"
    _order = "id desc"

    user_id = fields.Many2one("res.users", "Destinataire", required=True, index=True, ondelete="cascade")
    kind = fields.Selection(NOTIFICATION_KINDS, "Nature", required=True)
    title = fields.Char("Titre", required=True)
    body = fields.Text("Message")
    event_id = fields.Many2one("eguitra.agenda.event", "Événement", index=True, ondelete="set null")
    occurrence = fields.Datetime("Occurrence")
    actor_id = fields.Many2one("res.users", "Auteur", ondelete="set null")
    on_behalf_id = fields.Many2one("res.users", "Pour le compte de", ondelete="set null")
    read_at = fields.Datetime("Lue le", index=True)

    @api.model
    def _push(self, users, kind, title, body, event=None, occurrence=None, on_behalf=None):
        """Notifie chaque destinataire (comptes internes actifs), jamais l'auteur lui-même. Contexte
        agenda_system : notification d'une tâche planifiée (rappel, récapitulatif), sans auteur."""
        system = bool(self.env.context.get("agenda_system"))
        users = users.sudo().filtered(lambda u: u.active and not u.share and (system or u != self.env.user))
        if not users:
            return self.browse()
        rows = [{"user_id": u.id, "kind": kind, "title": (title or "")[:250], "body": body or False,
                 "event_id": event.id if event else False, "occurrence": occurrence or False,
                 "actor_id": False if system else self.env.uid,
                 "on_behalf_id": on_behalf.id if on_behalf else False} for u in users]
        return self.sudo().create(rows)

    def _row(self):
        self.ensure_one()
        n = self.sudo()
        return {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body or None, "date": n.create_date,
                "read": bool(n.read_at), "event_id": n.event_id.id or None, "occurrence": n.occurrence or None,
                "actor": n.actor_id.name or None, "on_behalf": n.on_behalf_id.name or None}

    @api.model
    def _cron_purge(self):
        """Notifications lues de plus de 90 jours, et toutes celles de plus d'un an."""
        now = fields.Datetime.now()
        old = self.sudo().search(["|", "&", ("read_at", "!=", False), ("read_at", "<", now - timedelta(days=90)),
                                  ("create_date", "<", now - timedelta(days=365))])
        old.unlink()
        return len(old)


class AgendaJournal(models.Model):
    _name = "eguitra.agenda.journal"
    _description = "Journal d'un agenda"
    _order = "id desc"

    calendar_id = fields.Many2one("eguitra.agenda.calendar", "Agenda", index=True, ondelete="cascade")
    event_id = fields.Many2one("eguitra.agenda.event", "Événement", index=True, ondelete="set null")
    user_id = fields.Many2one("res.users", "Par", index=True, ondelete="set null")
    on_behalf_id = fields.Many2one("res.users", "Pour le compte de", ondelete="set null")
    action = fields.Selection(JOURNAL_ACTIONS, "Action", required=True)
    note = fields.Char("Précision")

    @api.model
    def _log(self, calendar, action, event=None, on_behalf=None, note=None):
        return self.sudo().create({
            "calendar_id": calendar.id if calendar else False, "event_id": event.id if event else False,
            "user_id": self.env.uid, "on_behalf_id": on_behalf.id if on_behalf else False, "action": action,
            "note": (note or "")[:250] or False,
        })

    def _row(self):
        self.ensure_one()
        j = self.sudo()
        return {"id": j.id, "date": j.create_date, "action": j.action, "label": dict(JOURNAL_ACTIONS).get(j.action),
                "by": j.user_id.name or None, "on_behalf": j.on_behalf_id.name or None, "note": j.note or None,
                "event_id": j.event_id.id or None, "calendar_id": j.calendar_id.id or None}


class AgendaReminderLog(models.Model):
    """Rappel déjà envoyé (événement, occurrence, destinataire, délai, canal) : la tâche planifiée peut
    passer deux fois, ou rattraper un passage manqué, sans rien envoyer deux fois."""

    _name = "eguitra.agenda.reminder.log"
    _description = "Rappel d'agenda envoyé"

    event_id = fields.Many2one("eguitra.agenda.event", required=True, index=True, ondelete="cascade")
    occurrence = fields.Datetime(required=True)
    user_id = fields.Many2one("res.users", required=True, index=True, ondelete="cascade")
    minutes = fields.Integer(required=True)
    channel = fields.Char(required=True)

    _sent_unique = models.Constraint("unique(event_id, occurrence, user_id, minutes, channel)",
                                     "Ce rappel est déjà envoyé.")

    @api.model
    def _cron_purge(self):
        old = self.sudo().search([("occurrence", "<", fields.Datetime.now() - timedelta(days=30))])
        old.unlink()
        return len(old)
