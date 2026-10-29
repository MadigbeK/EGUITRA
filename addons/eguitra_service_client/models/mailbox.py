"""Courriel entrant du service client : relève IMAP d'une boîte par société, puis traitement de chaque message.

Choix : la plateforme relève elle-même la boîte (IMAP sur TLS, tâche toutes les 5 minutes) plutôt que le serveur
entrant du noyau (fetchmail) : les identifiants restent dans l'environnement du serveur (jamais en base en clair,
où fetchmail les garde), aucun message ne passe par le fil de discussion du noyau (qui enverrait des courriels
portant des liens vers le noyau) et la protection contre les boucles, le contrôle des pièces jointes et le
rattachement aux dossiers sont les nôtres, testés sans réseau.

Configuration (infra/.env.example) : SC_IMAP_HOST, SC_IMAP_PORT (993), SC_IMAP_GROUPE_USER et _PASSWORD,
SC_IMAP_CABINET_USER et _PASSWORD (une boîte par société ; SC_IMAP_<SOCIÉTÉ>_HOST pour un autre serveur). Sans
identifiants, la relève est inactive et les réglages le disent.

Traitement d'un message (_process) :
1. idempotence : un identifiant de message déjà vu n'est pas traité deux fois ;
2. refus des envois automatiques (rebonds, réponses automatiques et d'absence, envois en nombre, nos propres
   messages revenus) et des expéditeurs trop bavards (20 messages par heure) : journal seul, aucun accusé ;
3. rattachement : en réponse à un message du dossier (en-têtes In-Reply-To et References), ou par la référence
   [SC/…] de l'objet quand l'expéditeur est le contact du dossier ; sinon un nouveau dossier ;
4. expéditeur reconnu s'il est un contact de la société et que le serveur de réception ne signale pas d'échec
   d'authentification ; sinon le dossier est marqué « expéditeur non vérifié » ;
5. pièces jointes bornées en nombre, en taille et en format (PDF, images, Word, Excel), reconnu au contenu.
"""

import base64
import hashlib
import imaplib
import logging
import os
import ssl

from odoo import api, fields, models

from odoo.addons.eguitra_api.files import checked_name, detect_type

from .. import courriel
from .common import CHANNEL_LABELS, OPEN_STATES, clean_line

_logger = logging.getLogger(__name__)

MAX_PER_RUN = 50
MAX_RAW = 25 * 1024 * 1024
MAX_PER_SENDER_HOUR = 20
ENTITIES = ("groupe", "cabinet")


def imap_config(entity, environ=None):
    """Boîte de la société dans l'environnement du serveur ; None si elle n'est pas configurée."""
    env = environ if environ is not None else os.environ
    prefix = f"SC_IMAP_{(entity or '').upper()}_"
    user, password = (env.get(prefix + "USER") or "").strip(), env.get(prefix + "PASSWORD") or ""
    host = (env.get(prefix + "HOST") or env.get("SC_IMAP_HOST") or "").strip()
    if entity not in ENTITIES or not (user and password and host):
        return None
    try:
        port = int(env.get(prefix + "PORT") or env.get("SC_IMAP_PORT") or 993)
    except ValueError:
        port = 993
    return {"host": host, "port": port, "user": user, "password": password}


class EguitraScMailGateway(models.AbstractModel):
    _name = "eguitra.sc.mail.gateway"
    _description = "Courriel entrant du service client"

    # ─── Relève ──────────────────────────────────────────────────────────

    @api.model
    def _status(self, company):
        """État de la relève pour l'écran des réglages : active, ou pourquoi elle ne l'est pas."""
        settings = self.env["eguitra.sc.settings"]._get(company)
        cfg = imap_config(company.eguitra_entity)
        if not settings.mail_address:
            return {"active": False, "message": "Adresse du service client non réglée : la relève du courriel est "
                                                "inactive."}
        if not cfg:
            return {"active": False, "message": "Relève du courriel inactive : les identifiants de la boîte ne sont "
                                                "pas posés sur le serveur (variables SC_IMAP_…, à demander à "
                                                "E-VOLUTION XP)."}
        return {"active": True, "message": f"Boîte {settings.mail_address} relevée toutes les 5 minutes."}

    @api.model
    def _connect(self, cfg):
        """Connexion IMAP sur TLS (certificat vérifié). Remplacée dans les tests."""
        client = imaplib.IMAP4_SSL(cfg["host"], cfg["port"], ssl_context=ssl.create_default_context(), timeout=30)
        client.login(cfg["user"], cfg["password"])
        return client

    @api.model
    def _cron_fetch(self):
        """Relève des boîtes configurées : messages non lus, 50 par passage, marqués lus une fois traités."""
        done = 0
        for company in self.env["res.company"].sudo().search([]):
            cfg = imap_config(company.eguitra_entity)
            if not cfg or not self.env["eguitra.sc.settings"]._get(company).mail_address:
                continue
            try:
                done += self._fetch_company(company, cfg)
            except Exception:  # serveur injoignable, identifiants refusés : la tâche suivante réessaie
                _logger.exception("Service client : relève de la boîte de %s impossible", company.name)
        return done

    @api.model
    def _fetch_company(self, company, cfg):
        client = self._connect(cfg)
        count = 0
        try:
            client.select("INBOX")
            status, data = client.uid("search", None, "UNSEEN")
            if status != "OK":
                return 0
            for uid in (data[0] or b"").split()[:MAX_PER_RUN]:
                status, sized = client.uid("fetch", uid, "(RFC822.SIZE)")
                size = 0
                if status == "OK" and sized and sized[0]:
                    head = sized[0] if isinstance(sized[0], bytes) else sized[0][0]
                    try:
                        size = int(head.split(b"RFC822.SIZE")[1].strip(b" ()").split()[0])
                    except (IndexError, ValueError):
                        size = 0
                if size > MAX_RAW:
                    _logger.warning("Service client : message de %s octets écarté (boîte de %s)", size, company.name)
                    client.uid("store", uid, "+FLAGS", "(\\Seen)")
                    continue
                status, parts = client.uid("fetch", uid, "(BODY.PEEK[])")
                if status != "OK" or not parts or not isinstance(parts[0], tuple):
                    continue
                raw = parts[0][1]
                try:
                    with self.env.cr.savepoint():
                        self._process(company, raw)
                except Exception:
                    _logger.exception("Service client : message illisible (boîte de %s)", company.name)
                client.uid("store", uid, "+FLAGS", "(\\Seen)")
                # Un message traité et marqué lu reste traité si la tâche s'interrompt ensuite (hors des tests,
                # qui gardent leur transaction).
                if not self.env.registry.in_test_mode():
                    self.env.cr.commit()
                count += 1
        finally:
            try:
                client.logout()
            except Exception:  # connexion déjà fermée
                pass
        return count

    # ─── Traitement d'un message ─────────────────────────────────────────

    @api.model
    def _own_addresses(self):
        return [s.mail_address for s in self.env["eguitra.sc.settings"].sudo().search([]) if s.mail_address]

    @api.model
    def _process(self, company, raw):
        """Un courriel reçu par la boîte de la société -> dossier ouvert, message rattaché, ou refus journalisé.
        Rend (issue, dossier)."""
        Inbound = self.env["eguitra.sc.inbound"]
        data = courriel.parse(raw, own_addresses=self._own_addresses())
        sender = data["sender"]
        external = data["message_id"] or f"<sans-identifiant-{hashlib.sha256(raw).hexdigest()[:32]}@nimova>"
        if Inbound._seen("email", external):
            return "duplicate", None
        if data["loop"]:
            Inbound._log("email", external, company, sender, "rejected", data["loop"])
            return "rejected", None
        if Inbound._recent_from("email", sender) >= MAX_PER_SENDER_HOUR:
            Inbound._log("email", external, company, sender, "rejected", "Trop de messages de cet expéditeur en une "
                                                                          "heure.")
            return "rejected", None

        partner, contact = self._match_sender(company, sender)
        verified = bool(partner) and data["auth"] != "fail"
        ticket = self._thread_of(company, data, sender)
        body = data["body"] or "(message sans texte)"
        if ticket:
            ticket = ticket._final()
        if ticket and ticket.state == "closed":
            previous = ticket
            ticket = None
        else:
            previous = None
        if ticket:
            same = sender and (sender == ticket.contact_email or (
                ticket.partner_id and partner and partner == ticket.partner_id.commercial_partner_id))
            attachments = self._attachments(ticket, data)
            ticket.client_message(body, "email", author_name=data["sender_name"] or sender,
                                  attachments=attachments, unverified=not (same and verified),
                                  external={"email_message_id": data["message_id"] or False})
            if not (same and verified):
                ticket._event(f"Message reçu de {sender} : expéditeur différent du contact du dossier ou non vérifié.")
            Inbound._log("email", external, company, sender, "attached", ticket=ticket)
            return "attached", ticket

        values = {
            "company_id": company.id, "channel": "email", "subject": clean_line(data["subject"], 200) or "Sans objet",
            "description": body, "contact_email": sender or False,
            "contact_name": clean_line(data["sender_name"] or (contact.name if contact else ""), 120) or sender,
            "partner_id": partner.id if partner and verified else False, "sender_unverified": not verified,
            "previous_id": previous.id if previous else False,
        }
        if data["date"] and data["date"] <= fields.Datetime.now():
            values["date_open"] = data["date"]
        ticket = self.env["eguitra.sc.ticket"].sudo().create(values)
        attachments = self._attachments(ticket, data)
        ticket.client_message(body, "email", author_name=values["contact_name"], attachments=attachments,
                              unverified=not verified, external={"email_message_id": data["message_id"] or False},
                              notify=False)
        ticket._event("Dossier ouvert par courriel" + (f", suite du dossier clos {previous.name}" if previous else "")
                      + ("." if verified else " : expéditeur non vérifié (aucun contact de la société à cette adresse, "
                                              "ou authentification en échec)."))
        if data["refused"]:
            ticket._event("Pièces jointes écartées : " + ", ".join(f"{n} ({why})" for n, why in data["refused"]) + ".")
        ticket._acknowledge()
        ticket._notify_new()
        Inbound._log("email", external, company, sender, "ticket", ticket=ticket)
        return "ticket", ticket

    @api.model
    def _match_sender(self, company, email):
        """Contact de la société à cette adresse : (tiers, contact) ; (vide, vide) si aucun, ou s'il est ambigu
        (plusieurs entreprises différentes)."""
        Partner = self.env["res.partner"].sudo()
        if not email:
            return Partner, Partner
        found = Partner.search([("email", "=ilike", email), ("company_id", "in", [False, company.id])], limit=20)
        commercial = found.commercial_partner_id
        if len(commercial) != 1:
            return Partner, Partner
        return commercial, found[:1]

    @api.model
    def _thread_of(self, company, data, sender):
        """Dossier dont le courriel est la suite : identifiant de message connu, sinon référence de l'objet avec
        un expéditeur qui est le contact du dossier."""
        Message = self.env["eguitra.sc.message"].sudo()
        ids = [i for i in data["in_reply_to"] + data["references"] if i]
        if ids:
            known = Message.search([("email_message_id", "in", ids), ("company_id", "=", company.id)],
                                   order="id desc", limit=1)
            if known:
                return known.ticket_id
        if data["reference"]:
            ticket = self.env["eguitra.sc.ticket"].sudo().search(
                [("name", "=", data["reference"]), ("company_id", "=", company.id)], limit=1)
            if ticket:
                partner, _contact = self._match_sender(company, sender)
                if sender and (sender == ticket.contact_email or (
                        partner and ticket.partner_id and partner == ticket.partner_id.commercial_partner_id)):
                    return ticket
        return None

    @api.model
    def _attachments(self, ticket, data):
        """Pièces jointes acceptées (format reconnu au contenu) ; les autres sont citées dans le fil."""
        ids, refused = [], []
        for name, _announced, content in data["attachments"]:
            mimetype = detect_type(content)
            if not mimetype:
                refused.append(clean_line(name, 80))
                continue
            attachment = self.env["ir.attachment"].sudo().create({
                "name": checked_name(name, mimetype), "datas": base64.b64encode(content), "mimetype": mimetype,
                "res_model": "eguitra.sc.ticket", "res_id": ticket.id,
            })
            ids.append(attachment.id)
        if refused:
            ticket._event("Pièces jointes refusées (format non accepté : PDF, JPEG, PNG, Word ou Excel) : "
                          + ", ".join(refused) + ".")
        return ids


class EguitraScTicketMail(models.Model):
    _inherit = "eguitra.sc.ticket"

    def _notify_new(self):
        """Nouveau dossier venu du client : l'équipe de la catégorie, à défaut les agents de la société."""
        for ticket in self.sudo():
            recipients = ticket.team_id.member_ids or ticket.category_id.team_id.member_ids or ticket._agents()
            for user in recipients:
                self.env["eguitra.sc.notification"]._push(
                    user, ticket, "new_ticket", f"Nouveau dossier {ticket.name} ({CHANNEL_LABELS[ticket.channel]})",
                    clean_line(ticket.subject, 160))

    @api.model
    def _open_for(self, company, partner=None, phone=None, email=None):
        """Dossier ouvert le plus récent d'un client (tiers, numéro ou adresse) dans la société."""
        domain = [("company_id", "=", company.id), ("state", "in", OPEN_STATES), ("merged_into_id", "=", False)]
        alternatives = []
        if partner:
            alternatives.append([("partner_id", "child_of", partner.commercial_partner_id.id)])
        if phone:
            alternatives.append([("contact_phone_norm", "=", phone)])
        if email:
            alternatives.append([("contact_email", "=", email)])
        if not alternatives:
            return self.browse()
        clause = alternatives[0]
        for other in alternatives[1:]:
            clause = ["|"] + clause + other
        return self.sudo().search(domain + clause, order="date_open desc, id desc", limit=1)
