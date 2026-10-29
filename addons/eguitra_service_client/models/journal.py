"""Notifications des agents, journal technique des messages reçus (idempotence, refus) et compteurs de débit des
pages publiques. Ces modèles sont écartés de la piste d'audit (eguitra_base, AUDIT_EXCLUDED_MODELS)."""

import logging
from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import UserError

from .common import mail_body, mail_server_ready, public_url

_logger = logging.getLogger(__name__)

NOTIFICATION_KINDS = [
    ("assigned", "Dossier confié"), ("client_message", "Message du client"), ("new_ticket", "Nouveau dossier"),
    ("escalation", "Retard"), ("satisfaction_low", "Satisfaction basse"),
]
INBOUND_OUTCOMES = [("ticket", "Dossier ouvert"), ("attached", "Rattaché à un dossier"), ("rating", "Satisfaction"),
                    ("rejected", "Refusé"), ("error", "Erreur")]
# Pages publiques (invitation, satisfaction) : (nombre, minutes) par adresse IP.
LIMITS = {"invitation": (10, 15), "satisfaction": (30, 60)}


class EguitraScNotification(models.Model):
    _name = "eguitra.sc.notification"
    _description = "Notification du service client"
    _order = "id desc"

    user_id = fields.Many2one("res.users", "Destinataire", required=True, index=True, ondelete="cascade")
    ticket_id = fields.Many2one("eguitra.sc.ticket", "Dossier", index=True, ondelete="cascade")
    company_id = fields.Many2one(related="ticket_id.company_id", store=True, index=True)
    kind = fields.Selection(NOTIFICATION_KINDS, "Nature", required=True)
    title = fields.Char("Titre", required=True)
    body = fields.Char("Détail")
    read = fields.Boolean("Lue", index=True)

    @api.model
    def _push(self, user, ticket, kind, title, body=None, mail=False):
        """Notification dans l'application ; par courriel aussi pour un retard, si un serveur est paramétré."""
        user = user.sudo()
        if not user or not user.active or user.share:
            return self.browse()
        note = self.sudo().create({"user_id": user.id, "ticket_id": ticket.id if ticket else False, "kind": kind,
                                   "title": title[:250], "body": (body or "")[:250] or False})
        if mail and user.email and mail_server_ready(self.env) and ticket:
            url = public_url(self.env)
            self.env["mail.mail"].sudo().create({
                "subject": title[:250], "email_to": user.email, "auto_delete": True,
                "email_from": ticket.sudo()._settings().mail_address or ticket.company_id.email or False,
                "body_html": mail_body(ticket.company_id, title, [
                    body or "", f"Ouvrir le dossier : {url}/service-client/dossiers/{ticket.id}" if url else ""],
                    footer=f"NIMOVA · Service client, {ticket.company_id.name}"),
            })
        return note

    def _row(self):
        self.ensure_one()
        n = self.sudo()
        return {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body or None, "read": n.read,
                "date": n.create_date, "ticket_id": n.ticket_id.id or None}

    @api.model
    def _cron_purge(self):
        """Notifications lues de plus de 90 jours, journal des messages reçus de plus de 180 jours, compteurs de
        débit de plus de deux jours."""
        now = fields.Datetime.now()
        self.sudo().search([("read", "=", True), ("create_date", "<", now - timedelta(days=90))]).unlink()
        self.env["eguitra.sc.inbound"].sudo().search([("create_date", "<", now - timedelta(days=180))]).unlink()
        self.env["eguitra.sc.public.attempt"].sudo().search([("create_date", "<", now - timedelta(days=2))]).unlink()
        self.env["eguitra.sc.invitation"].sudo().search(
            ["|", ("used_at", "!=", False), ("expires_at", "<", now - timedelta(days=30))]).write({"token_hash": False})
        return True


class EguitraScInbound(models.Model):
    """Message reçu (courriel ou WhatsApp) : un identifiant n'est traité qu'une fois, et chaque refus (boucle,
    rebond, expéditeur bloqué) laisse une trace lisible par l'administration."""

    _name = "eguitra.sc.inbound"
    _description = "Message reçu par le service client (journal technique)"
    _order = "id desc"

    channel = fields.Selection([("email", "Courriel"), ("whatsapp", "WhatsApp")], "Canal", required=True)
    external_id = fields.Char("Identifiant reçu", required=True, index=True)
    company_id = fields.Many2one("res.company", "Société", index=True, ondelete="cascade")
    sender = fields.Char("Expéditeur")
    outcome = fields.Selection(INBOUND_OUTCOMES, "Issue", required=True)
    reason = fields.Char("Motif")
    ticket_id = fields.Many2one("eguitra.sc.ticket", "Dossier", ondelete="set null")

    _external_unique = models.Constraint("unique(channel, external_id)", "Message déjà reçu.")

    @api.model
    def _seen(self, channel, external_id):
        return bool(external_id) and bool(self.sudo().search_count([("channel", "=", channel),
                                                                     ("external_id", "=", external_id)]))

    @api.model
    def _log(self, channel, external_id, company, sender, outcome, reason=None, ticket=None):
        if not external_id:
            return self.browse()
        return self.sudo().create({
            "channel": channel, "external_id": external_id[:250], "company_id": company.id if company else False,
            "sender": (sender or "")[:250] or False, "outcome": outcome, "reason": (reason or "")[:250] or False,
            "ticket_id": ticket.id if ticket else False,
        })

    @api.model
    def _recent_from(self, channel, sender, minutes=60):
        since = fields.Datetime.now() - timedelta(minutes=minutes)
        return self.sudo().search_count([("channel", "=", channel), ("sender", "=", sender),
                                         ("create_date", ">=", since)])


class EguitraScPublicAttempt(models.Model):
    """Compteur de débit des pages publiques du service client (purgé chaque nuit)."""

    _name = "eguitra.sc.public.attempt"
    _description = "Appel d'une page publique du service client (limite de débit)"

    ip = fields.Char("Adresse IP", required=True, index=True)
    kind = fields.Char("Nature", required=True, index=True)

    @api.model
    def _limit(self, ip, kind):
        """Refus au-delà de la limite (sans adresse connue, la limite vaut pour tous) ; l'appel compte même
        refusé ensuite (la route garde la transaction)."""
        count, minutes = LIMITS[kind]
        since = fields.Datetime.now() - timedelta(minutes=minutes)
        ip = (ip or "inconnue")[:45]
        if self.sudo().search_count([("ip", "=", ip), ("kind", "=", kind), ("create_date", ">=", since)]) >= count:
            raise RateLimited()
        self.sudo().create({"ip": ip, "kind": kind})


class RateLimited(UserError):
    def __init__(self, message="Trop de demandes depuis votre connexion : réessayez plus tard."):
        super().__init__(message)
