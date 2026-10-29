"""Fil d'un dossier : messages du client et au client (envoyés par le canal du dossier), notes internes
(jamais visibles du client) et événements de suivi. Un message ne se modifie plus une fois écrit, sauf son
état d'envoi, tenu par la plateforme."""

import logging
import secrets

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError

from .. import courriel
from .. import whatsapp as wa
from .common import (
    CHANNELS,
    DELIVERY_STATES,
    DIRECTIONS,
    MANUAL_CHANNELS,
    MESSAGE_KINDS,
    first_name,
    mail_body,
    mail_server_ready,
    public_url,
)

_logger = logging.getLogger(__name__)

# Champs qu'écrit la plateforme après coup (envoi, statuts de WhatsApp, fusion des dossiers).
DELIVERY_FIELDS = {"delivery_state", "delivery_error", "email_message_id", "wa_message_id", "ticket_id",
                   "attachment_ids"}


class EguitraScMessage(models.Model):
    _name = "eguitra.sc.message"
    _description = "Message du fil d'un dossier du service client"
    _order = "date, id"

    ticket_id = fields.Many2one("eguitra.sc.ticket", "Dossier", required=True, index=True, ondelete="cascade")
    company_id = fields.Many2one(related="ticket_id.company_id", store=True, index=True)
    kind = fields.Selection(MESSAGE_KINDS, "Nature", required=True, default="public", index=True)
    direction = fields.Selection(DIRECTIONS, "Sens", required=True, default="none")
    channel = fields.Selection(CHANNELS + [("internal", "Interne")], "Canal", required=True, default="internal")
    date = fields.Datetime("Date", required=True, readonly=True, default=fields.Datetime.now, index=True)
    author_id = fields.Many2one("res.users", "Auteur", ondelete="set null")
    author_name = fields.Char("Nom de l'auteur", help="Client ou contact externe.")
    body = fields.Text("Texte")
    attachment_ids = fields.Many2many("ir.attachment", "eguitra_sc_message_attachment_rel", "message_id",
                                      "attachment_id", "Pièces jointes")
    auto = fields.Boolean("Message automatique", help="Accusé de réception, demande de satisfaction, remerciement.")
    unverified = fields.Boolean("Expéditeur non vérifié")
    template_id = fields.Many2one("eguitra.sc.template", "Réponse type", ondelete="set null")
    email_message_id = fields.Char("Identifiant du courriel", index=True, copy=False)
    wa_message_id = fields.Char("Identifiant WhatsApp", index=True, copy=False)
    delivery_state = fields.Selection(DELIVERY_STATES, "Envoi", required=True, default="none", index=True)
    delivery_error = fields.Char("Motif du non-envoi")

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.su:
            raise AccessError("Le fil d'un dossier s'écrit par ses actions (réponse, note, message du client).")
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.su or set(vals) - DELIVERY_FIELDS:
            raise AccessError("Un message du fil ne se modifie pas : seul son état d'envoi est tenu par la plateforme.")
        return super().write(vals)

    def unlink(self):
        if not self.env.su:
            raise AccessError("Un message du fil ne se supprime pas.")
        return super().unlink()

    # ─── Envoi ───────────────────────────────────────────────────────────

    def _deliver(self, queue=False):
        """Envoi d'un message au client par son canal. queue : WhatsApp par la tâche d'envoi (notification reçue,
        demande de satisfaction), le courriel partant toujours par la file du noyau."""
        self.ensure_one()
        message = self.sudo()
        if message.kind != "public" or message.direction != "out":
            return message
        if message.channel in MANUAL_CHANNELS:
            message.write({"delivery_state": "manual"})
        elif message.channel == "email":
            message._send_email()
        elif message.channel == "portal":
            message._notify_portal()
        elif message.channel == "whatsapp":
            message._send_whatsapp(queue=queue)
        return message

    def _not_sent(self, reason):
        self.write({"delivery_state": "not_sent", "delivery_error": reason[:250]})
        return self

    def _send_email(self):
        message = self.sudo()
        ticket = message.ticket_id
        settings = ticket._settings()
        if not ticket.contact_email:
            return message._not_sent("Pas d'adresse électronique pour ce contact.")
        if not mail_server_ready(self.env):
            return message._not_sent("Aucun serveur d'envoi de courriel n'est paramétré : réponse gardée dans le "
                                     "dossier, à communiquer par un autre canal.")
        sender = settings.mail_address or ticket.company_id.email or False
        domain = (sender or "nimova.local").split("@")[-1]
        message_id = f"<sc.{ticket.id}.{message.id}.{secrets.token_hex(8)}@{domain}>"
        previous = ticket.message_ids.filtered(lambda m: m.email_message_id and m.id != message.id)
        chain = [m.email_message_id for m in previous.sorted(lambda m: (m.date, m.id))][-10:]
        last_in = previous.filtered(lambda m: m.direction == "in").sorted(lambda m: (m.date, m.id))[-1:]
        headers = {courriel.OWN_HEADER: ticket.name}
        if last_in:
            headers["In-Reply-To"] = last_in.email_message_id
        if message.auto:
            headers["Auto-Submitted"] = "auto-replied"
            headers["X-Auto-Response-Suppress"] = "All"
        title = f"Votre demande {ticket.name}"
        values = {
            "subject": courriel.subject_with_reference(ticket.name, ticket.subject),
            "body_html": mail_body(ticket.company_id, title, [message.body]),
            "email_to": ticket.contact_email, "email_from": sender, "reply_to": sender,
            "message_id": message_id, "references": " ".join(chain) or False, "headers": repr(headers),
            "auto_delete": False,
        }
        if message.attachment_ids:
            values["attachment_ids"] = [(6, 0, message.attachment_ids.ids)]
        self.env["mail.mail"].sudo().create(values)
        message.write({"delivery_state": "sent", "email_message_id": message_id})
        return message

    def _notify_portal(self):
        """Espace client : le message s'y lit ; chaque compte du client en est averti par courriel (sans le texte)."""
        message = self.sudo()
        ticket = message.ticket_id
        users = ticket._client_users()
        if not users:
            return message._not_sent("Le client n'a pas de compte dans l'espace client : communiquez la réponse "
                                     "par un autre canal.")
        message.write({"delivery_state": "sent"})
        url = public_url(self.env)
        if mail_server_ready(self.env) and not message.auto:
            for user in users.filtered("email"):
                self.env["mail.mail"].sudo().create({
                    "subject": f"[{ticket.name}] Une réponse vous attend dans votre espace client",
                    "body_html": mail_body(ticket.company_id, f"Votre demande {ticket.name}", [
                        f"Bonjour {user.name},",
                        f"Une réponse du service client de {ticket.company_id.name} vous attend sur votre demande "
                        f"« {ticket.subject} ».",
                        f"Lisez-la dans votre espace client : {url}/espace-client/demandes/{ticket.id}" if url
                        else "Lisez-la dans votre espace client.",
                    ]),
                    "email_to": user.email, "email_from": ticket._settings().mail_address or ticket.company_id.email
                    or False, "auto_delete": True, "headers": repr({courriel.OWN_HEADER: ticket.name}),
                })
        return message

    def _send_whatsapp(self, queue=False):
        """WhatsApp : texte dans la fenêtre de 24 heures depuis le dernier message du client ; au-delà, modèle
        approuvé (le texte part dès que le client répond) ; sans modèle réglé, refus clair."""
        message = self.sudo()
        ticket = message.ticket_id
        cfg = wa.config(ticket.company_id.eguitra_entity)
        if not cfg:
            if message.auto:
                return message._not_sent("Canal WhatsApp inactif.")
            raise UserError("Le canal WhatsApp n'est pas configuré pour cette société : répondez par un autre canal.")
        if not ticket.contact_phone_norm:
            if message.auto:
                return message._not_sent("Numéro du contact absent.")
            raise UserError("Le dossier n'a pas de numéro de téléphone : répondez par un autre canal.")
        if ticket._wa_window_open():
            if queue:
                message.write({"delivery_state": "queued"})
                self.env["eguitra.sc.whatsapp"]._trigger()
                return message
            return message._push_text(cfg)
        if message.auto:
            return message._not_sent("Fenêtre de 24 heures fermée : message automatique non envoyé.")
        settings = ticket._settings()
        if not settings.wa_template:
            raise UserError("Plus de 24 heures depuis le dernier message WhatsApp du client : WhatsApp n'accepte plus "
                            "qu'un modèle de message approuvé, et aucun n'est réglé (Réglages du service client). "
                            "Répondez par un autre canal, ou attendez que le client écrive.")
        try:
            wamid = wa.send_template(cfg, ticket.contact_phone_norm, settings.wa_template,
                                     settings.wa_template_lang or "fr",
                                     [ticket.contact_name or ticket.partner_id.name or "Madame, Monsieur", ticket.name])
        except wa.WhatsAppError as e:
            message.write({"delivery_state": "failed", "delivery_error": str(e)[:250]})
            return message
        message.write({"delivery_state": "waiting_window",
                       "delivery_error": "Modèle envoyé : le message partira dès que le client répondra."})
        ticket._event(f"WhatsApp : modèle « {settings.wa_template} » envoyé hors de la fenêtre de 24 heures"
                      + (f" ({wamid})." if wamid else "."))
        return message

    def _push_text(self, cfg=None):
        message = self.sudo()
        ticket = message.ticket_id
        cfg = cfg or wa.config(ticket.company_id.eguitra_entity)
        if not cfg:
            return message._not_sent("Canal WhatsApp inactif.")
        try:
            wamid = wa.send_text(cfg, ticket.contact_phone_norm, message.body)
        except wa.WhatsAppError as e:
            message.write({"delivery_state": "failed", "delivery_error": str(e)[:250]})
            return message
        message.write({"delivery_state": "sent", "wa_message_id": wamid or False, "delivery_error": False})
        return message

    # ─── Lecture ─────────────────────────────────────────────────────────

    def _author(self, internal):
        m = self.sudo()
        if m.direction == "in":
            return m.author_name or m.ticket_id.contact_name or "Client"
        if m.kind == "event":
            return "Plateforme"
        if m.auto:
            return f"Service client de {m.ticket_id.company_id.name}"
        if internal:
            return m.author_id.name or "Service client"
        return first_name(m.author_id) or f"Service client de {m.ticket_id.company_id.name}"

    def _row(self, internal=True):
        """Ligne du fil. Pour le client (internal=False) : messages publics seulement (filtrés par l'appelant),
        auteur interne réduit à son prénom, sans l'état d'envoi détaillé ni le canal technique."""
        self.ensure_one()
        m = self.sudo()
        row = {
            "id": m.id, "date": m.date, "direction": m.direction, "author": m._author(internal), "body": m.body or "",
            "attachments": [{"id": a.id, "name": a.name, "size": a.file_size, "mimetype": a.mimetype}
                            for a in m.attachment_ids],
            "mine": m.direction == "in",
        }
        if internal:
            row.update({
                "kind": m.kind, "channel": m.channel, "auto": m.auto, "unverified": m.unverified,
                "delivery_state": m.delivery_state,
                "delivery_label": dict(DELIVERY_STATES).get(m.delivery_state), "delivery_error": m.delivery_error or None,
                "author_id": m.author_id.id or None,
            })
        return row
