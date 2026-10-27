"""Lien d'abonnement iCalendar personnel (Outlook, Google Agenda, téléphone) : en lecture seule, borné à
l'agenda personnel de son compte (ses événements et les invitations qu'il n'a pas refusées).

Le lien porte un jeton long (64 caractères tirés au hasard) ; seule son empreinte (SHA-256) est gardée en
base, comme pour les sessions de l'API : une fuite de la base ne donne pas le lien. Il se révoque à tout
moment (un nouveau lien remplace l'ancien) et cesse de servir dès que le compte n'a plus d'agenda (compte
désactivé, profil retiré). Les événements privés y sont « Occupé » si l'option est choisie (par défaut) ;
ni participants ni organisateur n'y figurent.
"""

import secrets
from datetime import timedelta

from odoo import api, fields, models

from odoo.addons.eguitra_api.models.api_token import hash_token

from .. import moteur
from .common import agenda_allowed, check_agenda_user

FEED_PAST_DAYS = 90
FEED_FUTURE_DAYS = 400


class AgendaSubscription(models.Model):
    _name = "eguitra.agenda.subscription"
    _description = "Lien d'abonnement à un agenda"

    user_id = fields.Many2one("res.users", "Compte", required=True, index=True, ondelete="cascade")
    token_hash = fields.Char("Empreinte du jeton", required=True, index=True, copy=False)
    hint = fields.Char("Fin du jeton", help="Quatre derniers caractères, pour reconnaître le lien.")
    mask_private = fields.Boolean("Événements privés en « Occupé »", default=True)
    last_used_at = fields.Datetime("Dernière lecture")

    _user_unique = models.Constraint("unique(user_id)", "Un seul lien d'abonnement par compte.")
    _hash_unique = models.Constraint("unique(token_hash)", "Jeton déjà attribué.")

    @api.model
    def issue(self, mask_private=True):
        """Nouveau lien du compte (l'ancien cesse de servir) ; le jeton n'est rendu qu'une fois."""
        check_agenda_user(self.env)
        me = self.env.user
        self.sudo().search([("user_id", "=", me.id)]).unlink()
        raw = secrets.token_urlsafe(48)
        record = self.sudo().create({"user_id": me.id, "token_hash": hash_token(raw), "hint": raw[-4:],
                                     "mask_private": bool(mask_private)})
        return record, raw

    @api.model
    def revoke_mine(self):
        check_agenda_user(self.env)
        found = self.sudo().search([("user_id", "=", self.env.uid)])
        found.unlink()
        return bool(found)

    @api.model
    def _find(self, raw):
        raw = (raw or "").strip()
        if raw.endswith(".ics"):
            raw = raw[:-4]
        if not 40 <= len(raw) <= 120 or not all(c.isalnum() or c in "-_" for c in raw):
            return self.browse()
        record = self.sudo().search([("token_hash", "=", hash_token(raw))], limit=1)
        if not record or not agenda_allowed(record.user_id):
            return self.browse()
        return record

    def _row(self):
        self.ensure_one()
        return {"active": True, "hint": self.hint, "created": self.create_date, "last_used": self.last_used_at or None,
                "mask_private": self.mask_private}

    def feed(self, now=None):
        """Fichier iCalendar de l'agenda personnel du compte (90 jours passés, 400 jours à venir)."""
        self.ensure_one()
        sub = self.sudo()
        user = sub.user_id
        now = now or fields.Datetime.now()
        if not sub.last_used_at or sub.last_used_at < now - timedelta(hours=1):
            sub.last_used_at = now
        Event = self.env["eguitra.agenda.event"].sudo()
        layer = self.env["eguitra.agenda.calendar"]._ensure_personal(user)
        a, b = now - timedelta(days=FEED_PAST_DAYS), now + timedelta(days=FEED_FUTURE_DAYS)
        records = Event._layer_records(layer, a, b)
        rows = []
        for ev in records:
            mask = sub.mask_private and ev.privacy == "private"
            if ev.series_id:
                if ev.series_id in records:
                    continue  # exportée avec sa série
                rows.append(dict(_strip(ev._ics_row(mask=mask)), uid=f"{ev.id}@nimova", recurrence_id=None))
            elif ev.rrule:
                exceptions = Event.search([("series_id", "=", ev.id)])
                shown = exceptions & records
                master = _strip(ev._ics_row(mask=mask))
                master["rrule"] = ev.rrule
                # Occurrences supprimées, et celles que le compte a refusées ou d'où il a été retiré.
                master["exdates"] = (exceptions - shown).mapped("recurrence_date")
                rows.append(master)
                for x in shown.filtered(lambda x: not x.cancelled):
                    rows.append(_strip(x._ics_row(mask=sub.mask_private and x.privacy == "private")))
            else:
                rows.append(_strip(ev._ics_row(mask=mask)))
        return moteur.ics_calendar(rows, name=f"NIMOVA · Agenda de {user.name}",
                                   tz=self.env["eguitra.agenda.preference"]._for(user)._tz())


def _strip(row):
    """Ni participants ni organisateur dans un abonnement : il quitte la plateforme."""
    row = dict(row)
    row.pop("attendees", None)
    row.pop("organizer", None)
    return row
