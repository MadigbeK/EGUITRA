"""WhatsApp entrant et sortant du service client (API Cloud de Meta).

Réception (controllers/public.py, notification relayée par /api/whatsapp/webhook de l'application web) : la
signature est contrôlée avant toute lecture, puis chaque message est traité ici, sans appel réseau : un
identifiant déjà vu est ignoré (Meta renvoie une notification non acquittée) ; un message d'un numéro connu se
rattache au dossier ouvert de ce client, sinon il ouvre un dossier ; une réponse « 1 » à « 5 » à une demande
de satisfaction est enregistrée comme note. Les médias et les envois automatiques (accusé, remerciement) partent
ensuite par la tâche planifiée (_cron_run, déclenchée aussitôt), qui seule appelle Meta.
"""

import base64
import logging
from datetime import UTC, datetime, timedelta

from odoo import api, fields, models

from odoo.addons.eguitra_api.files import checked_name, detect_type

from .. import whatsapp as wa
from .common import clean_line

_logger = logging.getLogger(__name__)

PARTNER_SCAN = 5000
MAX_JOBS = 20
MAX_ATTEMPTS = 3
OGG = "audio/ogg"


def _detect(content):
    """Format reconnu au contenu : ceux des pièces de la plateforme, plus les messages vocaux (Ogg)."""
    if content.startswith(b"OggS"):
        return OGG
    return detect_type(content)


class EguitraScMediaJob(models.Model):
    _name = "eguitra.sc.media.job"
    _description = "Média WhatsApp à télécharger (file technique)"
    _order = "id"

    message_id = fields.Many2one("eguitra.sc.message", "Message", required=True, index=True, ondelete="cascade")
    company_id = fields.Many2one(related="message_id.company_id", store=True)
    media_id = fields.Char("Identifiant du média", required=True)
    mime_type = fields.Char("Type annoncé")
    filename = fields.Char("Nom annoncé")
    state = fields.Selection([("pending", "À télécharger"), ("done", "Téléchargé"), ("refused", "Refusé"),
                              ("failed", "Échec")], required=True, default="pending", index=True)
    attempts = fields.Integer("Essais")
    error = fields.Char("Motif")


class EguitraScWhatsApp(models.AbstractModel):
    _name = "eguitra.sc.whatsapp"
    _description = "WhatsApp du service client"

    @api.model
    def _status(self, company):
        st = wa.status()
        cfg = wa.config(company.eguitra_entity)
        if cfg:
            settings = self.env["eguitra.sc.settings"]._get(company)
            message = "Canal WhatsApp actif." + ("" if settings.wa_template else " Aucun modèle approuvé n'est réglé : "
                                                 "hors de la fenêtre de 24 heures, un agent ne peut pas écrire au client.")
            return {"active": True, "message": message, "template": bool(settings.wa_template)}
        missing = [label for key, label in (("access_token", "jeton d'accès"), ("app_secret", "secret de "
                                            "l'application"), ("verify_token", "jeton de vérification")) if not st[key]]
        if not st["numbers"].get(company.eguitra_entity or ""):
            missing.append("identifiant du numéro de la société")
        return {"active": False, "template": False,
                "message": "Canal WhatsApp inactif : " + ", ".join(missing) + " absent(s) du serveur (variables "
                           "WHATSAPP_…, à poser par E-VOLUTION XP une fois le compte Meta Business vérifié)."}

    @api.model
    def _trigger(self):
        cron = self.env.ref("eguitra_service_client.cron_whatsapp", raise_if_not_found=False)
        if cron:
            cron.sudo()._trigger()

    # ─── Réception ───────────────────────────────────────────────────────

    @api.model
    def _receive(self, payload):
        """Notification déjà authentifiée (signature contrôlée) : messages et statuts d'envoi."""
        parsed = wa.parse_notification(payload)
        results = []
        for message in parsed["messages"]:
            results.append(self._receive_message(message))
        for status in parsed["statuses"]:
            self._receive_status(status)
        if any(r[0] in ("ticket", "attached") for r in results):
            self._trigger()
        return results

    @api.model
    def _company_of(self, phone_id):
        entity = wa.entity_of_phone_id(phone_id)
        if not entity:
            return self.env["res.company"]
        return self.env["res.company"].sudo().search([("eguitra_entity", "=", entity)], limit=1)

    @api.model
    def _receive_message(self, data):
        Inbound = self.env["eguitra.sc.inbound"]
        Ticket = self.env["eguitra.sc.ticket"].sudo()
        external = data["id"]
        if Inbound._seen("whatsapp", external):
            return "duplicate", None
        company = self._company_of(data["phone_id"])
        number = wa.normalize_phone(data["from"])
        if not company:
            Inbound._log("whatsapp", external, None, number, "rejected", "Numéro de la plateforme inconnu.")
            return "rejected", None
        if not number:
            Inbound._log("whatsapp", external, company, data["from"], "rejected", "Numéro de l'expéditeur illisible.")
            return "rejected", None
        when = datetime.fromtimestamp(data["timestamp"], tz=UTC).replace(tzinfo=None) \
            if data["timestamp"] else fields.Datetime.now()
        when = min(when, fields.Datetime.now())
        text = data["text"] or ("(pièce jointe)" if data["media"] else f"(message de type {data['type']})")

        # Réponse à une demande de satisfaction : une note, pas un nouveau message.
        rating = wa.rating_of(data["text"])
        if rating:
            rated = Ticket.search([
                ("company_id", "=", company.id), ("contact_phone_norm", "=", number), ("satisfaction_requested", "=", True),
                ("satisfaction_score", "=", 0), ("state", "in", ("resolved", "closed")), ("channel", "=", "whatsapp"),
                ("date_resolved", ">=", fields.Datetime.now() - timedelta(days=14)),
            ], order="date_resolved desc", limit=1)
            if rated:
                rated.write({"wa_last_inbound": when})
                rated.record_satisfaction(rating[0], rating[1], "whatsapp")
                rated.client_message(text, "whatsapp", author_name=data["name"], notify=False, reopen=False,
                                     external={"wa_message_id": external})
                thanks = self.env["eguitra.sc.message"].sudo().create({
                    "ticket_id": rated.id, "kind": "public", "direction": "out", "channel": "whatsapp", "auto": True,
                    "body": "Merci pour votre avis. Le service client reste à votre écoute.",
                })
                thanks._deliver(queue=True)
                Inbound._log("whatsapp", external, company, number, "rating", ticket=rated)
                return "rating", rated

        partner = self._match_number(company, number)
        ticket = Ticket._open_for(company, partner=partner, phone=number)
        if not ticket:
            # Un dossier résolu (pas encore clos) du même numéro se rouvre plutôt que d'en ouvrir un autre.
            ticket = Ticket.search([("company_id", "=", company.id), ("contact_phone_norm", "=", number),
                                    ("state", "=", "resolved"), ("merged_into_id", "=", False)],
                                   order="date_resolved desc", limit=1)
        if ticket:
            ticket = ticket._final()
            ticket.write({"wa_last_inbound": when})
            same = ticket.contact_phone_norm == number or (partner and ticket.partner_id
                                                           and ticket.partner_id.commercial_partner_id == partner)
            message = ticket.client_message(text, "whatsapp", author_name=data["name"], unverified=not same,
                                            external={"wa_message_id": external})
            self._queue_media(message, data)
            ticket._flush_waiting_window()
            Inbound._log("whatsapp", external, company, number, "attached", ticket=ticket)
            return "attached", ticket

        values = {
            "company_id": company.id, "channel": "whatsapp", "contact_phone": "+" + number,
            "contact_name": clean_line(data["name"], 120) or ("+" + number),
            "subject": clean_line(data["text"], 80) or "Message WhatsApp", "description": data["text"] or False,
            "partner_id": partner.id if partner else False, "sender_unverified": not partner, "date_open": when,
        }
        ticket = Ticket.create(values)
        ticket.write({"wa_last_inbound": when})
        message = ticket.client_message(text, "whatsapp", author_name=values["contact_name"], unverified=not partner,
                                        external={"wa_message_id": external}, notify=False)
        self._queue_media(message, data)
        ticket._event("Dossier ouvert par WhatsApp" + ("." if partner else " : numéro inconnu des contacts de la "
                                                                           "société (expéditeur non vérifié)."))
        ticket._acknowledge()
        ticket._notify_new()
        Inbound._log("whatsapp", external, company, number, "ticket", ticket=ticket)
        return "ticket", ticket

    @api.model
    def _receive_status(self, data):
        """Statut d'un message envoyé (remis, lu, échec) : reporté sur le message du fil."""
        message = self.env["eguitra.sc.message"].sudo().search([("wa_message_id", "=", data["id"])], limit=1)
        if not message:
            return
        order = {"sent": 1, "delivered": 2, "read": 3}
        current = {"sent": 1, "delivered": 2, "read": 3}.get(message.delivery_state, 0)
        if data["status"] == "failed":
            message.write({"delivery_state": "failed", "delivery_error": data["error"] or "Échec signalé par WhatsApp."})
        elif order.get(data["status"], 0) > current:
            message.write({"delivery_state": data["status"]})

    @api.model
    def _match_number(self, company, number):
        """Tiers du numéro : celui d'un dossier précédent du même numéro, sinon un contact de la société dont le
        téléphone, une fois normalisé, est ce numéro (un seul tiers ; ambigu : aucun)."""
        Ticket = self.env["eguitra.sc.ticket"].sudo()
        previous = Ticket.search([("company_id", "=", company.id), ("contact_phone_norm", "=", number),
                                  ("partner_id", "!=", False), ("sender_unverified", "=", False)],
                                 order="id desc", limit=1)
        if previous:
            return previous.partner_id.commercial_partner_id
        Partner = self.env["res.partner"].sudo()
        names = [f for f in ("phone", "mobile") if f in Partner._fields]
        found = Partner
        for name in names:
            rows = Partner.search_read([("company_id", "in", [False, company.id]), (name, "!=", False)],
                                       [name, "commercial_partner_id"], limit=PARTNER_SCAN)
            for row in rows:
                if wa.normalize_phone(row[name]) == number:
                    found |= Partner.browse(row["commercial_partner_id"][0] if row["commercial_partner_id"] else row["id"])
        return found if len(found) == 1 else Partner

    @api.model
    def _queue_media(self, message, data):
        if message and data.get("media"):
            self.env["eguitra.sc.media.job"].sudo().create({
                "message_id": message.id, "media_id": data["media"]["id"], "mime_type": data["media"]["mime_type"],
                "filename": data["media"]["filename"],
            })

    # ─── Tâche d'envoi et de téléchargement ──────────────────────────────

    @api.model
    def _cron_run(self):
        """Envois en file (accusés, demandes de satisfaction, remerciements) puis médias reçus, bornés par passage."""
        Message = self.env["eguitra.sc.message"].sudo()
        for message in Message.search([("delivery_state", "=", "queued"), ("channel", "=", "whatsapp")], limit=50):
            if message.ticket_id._wa_window_open():
                message._push_text()
            else:
                message._not_sent("Fenêtre de 24 heures fermée avant l'envoi.")
        Job = self.env["eguitra.sc.media.job"].sudo()
        for job in Job.search([("state", "=", "pending")], limit=MAX_JOBS):
            self._download(job)
        return True

    @api.model
    def _download(self, job):
        message = job.message_id
        cfg = wa.config(message.company_id.eguitra_entity)
        if not cfg:
            job.write({"state": "failed", "error": "Canal WhatsApp inactif."})
            return
        try:
            info = wa.media_info(cfg, job.media_id)
            _mime, content = wa.download_media(cfg, info)
        except wa.WhatsAppError as e:
            attempts = job.attempts + 1
            refused = isinstance(e, wa.MediaRefused)
            job.write({"attempts": attempts, "error": str(e)[:250],
                       "state": "refused" if refused else ("failed" if attempts >= MAX_ATTEMPTS else "pending")})
            if refused or attempts >= MAX_ATTEMPTS:
                message.ticket_id._event(f"Pièce reçue par WhatsApp non gardée : {e}")
            return
        mimetype = _detect(content)
        if not mimetype:
            job.write({"state": "refused", "error": "Format non accepté."})
            message.ticket_id._event("Pièce reçue par WhatsApp non gardée : format non accepté (PDF, JPEG, PNG, Word, "
                                     "Excel ou message vocal).")
            return
        name = job.filename or f"whatsapp-{job.id}"
        filename = checked_name(name, mimetype) if mimetype != OGG else (name.rsplit(".", 1)[0] + ".ogg")
        attachment = self.env["ir.attachment"].sudo().create({
            "name": filename, "datas": base64.b64encode(content), "mimetype": mimetype,
            "res_model": "eguitra.sc.ticket", "res_id": message.ticket_id.id,
        })
        message.write({"attachment_ids": [(4, attachment.id)]})
        job.write({"state": "done", "error": False})


class EguitraScTicketWhatsApp(models.Model):
    _inherit = "eguitra.sc.ticket"

    def _flush_waiting_window(self):
        """Le client vient d'écrire : les réponses gardées faute de fenêtre (modèle envoyé) partent maintenant."""
        Message = self.env["eguitra.sc.message"].sudo()
        for ticket in self.sudo():
            waiting = Message.search([("ticket_id", "=", ticket.id), ("delivery_state", "=", "waiting_window")])
            if waiting:
                waiting.write({"delivery_state": "queued", "delivery_error": False})
                self.env["eguitra.sc.whatsapp"]._trigger()
