"""19.0.1.2.0 : liste d'attente dans l'ordre d'attente et rappels du matin mémorisés.

- Les inscriptions déjà en liste d'attente prennent pour date « en attente depuis » celle de leur
  inscription : leur ordre ne change pas (l'ancien code promouvait dans l'ordre des inscriptions).
- Les rappels déjà envoyés pour des rendez-vous, des événements et des actions encore à venir sont
  mémorisés (reminder_key) : la tâche du lendemain, qui rattrape désormais ce qu'un rappel n'a pas
  annoncé, ne les renvoie pas. Seuls les rappels des trois derniers jours sont relus, à leur texte
  exact (celui de 19.0.1.1.0, heure de Conakry).

Passage unique : sans effet si on le rejoue (seuls les champs encore vides sont remplis)."""

from datetime import UTC, timedelta
from zoneinfo import ZoneInfo

from odoo import SUPERUSER_ID, api, fields

TZ = ZoneInfo("Africa/Conakry")


def _local(value):
    return value.replace(tzinfo=UTC).astimezone(TZ)


def migrate(cr, version):
    cr.execute("""
        UPDATE portail_event_registration
           SET waitlist_since = create_date
         WHERE state = 'waitlist' AND waitlist_since IS NULL
    """)
    env = api.Environment(cr, SUPERUSER_ID, {})
    Notification = env["portail.notification"]
    now = fields.Datetime.now()
    recent = [("reminder_key", "=", False), ("create_date", ">=", now - timedelta(days=3))]

    def remember(domain, key):
        Notification.search(recent + domain).write({"reminder_key": key})

    for meeting in env["portail.meeting"].search(
            [("state", "=", "confirmed"), ("start", ">=", now), ("start", "<", now + timedelta(days=3))]):
        remember([("kind", "=", "meeting"), ("dossier_id", "=", meeting.dossier_id.id),
                  ("title", "=", f"Rappel : rendez-vous demain à {_local(meeting.start):%H h %M}"[:200]),
                  ("body", "=", (meeting.subject or "")[:300])],
                 f"meeting:{meeting.id}:{meeting.start:%Y-%m-%d %H:%M}")
    for event in env["portail.event"].search(
            [("state", "=", "published"), ("start", ">=", now), ("start", "<", now + timedelta(days=3))]):
        remember([("kind", "=", "event"),
                  ("title", "=", f"Rappel : {event.name} demain à {_local(event.start):%H h %M}"[:200])],
                 f"event:{event.id}:{event.start:%Y-%m-%d %H:%M}")
    today = _local(now).date()
    for action in env["axispro.action"].search(
            [("due_date", ">=", today), ("due_date", "<=", today + timedelta(days=2)), ("assignee", "=", "porteur")]):
        remember([("kind", "=", "action"), ("dossier_id", "=", action.dossier_id.id),
                  ("title", "=", f"Échéance dans deux jours : {action.name}"[:200]),
                  ("body", "=", f"À rendre le {action.due_date:%d/%m/%Y}.")],
                 f"action:{action.id}:{action.due_date}")
