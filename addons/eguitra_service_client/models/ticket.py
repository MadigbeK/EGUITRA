"""Dossier du service client : une demande, une réclamation ou une information d'un client, numérotée par
société (SC/EG/AAAA/NNNN, SC/MBAX/AAAA/NNNN), avec son fil d'échanges, ses échéances, son escalade et la
satisfaction du client.

Droits (security/sc_rules.xml) : les agents et l'administration traitent les dossiers de leurs sociétés,
la direction les lit tous, les métiers ne lisent et ne traitent que ceux qui leur sont assignés (à eux ou à
leur équipe). Le client de l'espace client n'a aucun droit sur ce modèle : l'API de l'espace client lit pour
lui, bornée à son tiers (controllers/client.py). Chaque création et modification passe par la piste d'audit.
"""

import secrets
from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError

from odoo.addons.eguitra_api.models.api_token import hash_token

from .. import delais
from .. import whatsapp as wa
from .common import (
    CHANNEL_LABELS,
    CHANNELS,
    CLIENT_STATES,
    DIRECTION_GROUP,
    KIND_LABELS,
    KINDS,
    LINK_MODELS,
    METIER_TRANSITIONS,
    OPEN_STATES,
    PRIORITIES,
    PRIORITY_LABELS,
    SEQUENCE_CODE,
    STATE_LABELS,
    STATES,
    TRANSITIONS,
    clean_email,
    clean_line,
    clean_text,
    first_name,
    is_agent,
    public_url,
    users_with_group,
)

SATISFACTION_DAYS = 30
SATISFACTION_WA_DAYS = 14
# Champs que la plateforme tient seule : personne ne les écrit depuis l'écran.
LOCKED_FIELDS = {
    "name", "company_id", "date_open", "date_first_response", "date_resolved", "date_closed",
    "date_first_response_due", "date_resolution_due", "escalated_first", "escalated_resolution", "merged_into_id",
    "satisfaction_token_hash", "satisfaction_expires", "paused_hours", "waiting_since", "wa_last_inbound",
    "client_user_id", "message_ids",
}


def _holidays(env, company, start, end):
    """Jours fériés (module RH s'il est installé) : communs aux deux sociétés ou propres à la société."""
    if "eguitra.rh.holiday" not in env or not start or not end:
        return frozenset()
    Holiday = env["eguitra.rh.holiday"].sudo()
    domain = [("date", ">=", start), ("date", "<=", end)]
    if "company_id" in Holiday._fields:
        domain.append(("company_id", "in", [False, company.id]))
    return frozenset(Holiday.search(domain).mapped("date"))


class EguitraScTicket(models.Model):
    _name = "eguitra.sc.ticket"
    _description = "Dossier du service client"
    _order = "date_open desc, id desc"
    _check_company_auto = True

    name = fields.Char("Numéro", required=True, readonly=True, copy=False, index=True, default="/")
    company_id = fields.Many2one("res.company", "Société", required=True, index=True, readonly=True,
                                 default=lambda self: self.env.company)
    partner_id = fields.Many2one("res.partner", "Client", index=True, check_company=True, ondelete="restrict",
                                 help="Tiers de la société ; vide pour un contact qui n'est pas encore client.")
    contact_name = fields.Char("Contact")
    contact_email = fields.Char("Courriel du contact", index=True)
    contact_phone = fields.Char("Téléphone du contact")
    contact_phone_norm = fields.Char("Numéro international", compute="_compute_phone_norm", store=True, index=True)
    channel = fields.Selection(CHANNELS, "Canal d'arrivée", required=True, default="phone", index=True)
    category_id = fields.Many2one("eguitra.sc.category", "Catégorie", check_company=True, index=True,
                                  ondelete="restrict")
    kind = fields.Selection(KINDS, "Type", required=True, default="request", index=True)
    priority = fields.Selection(PRIORITIES, "Priorité", required=True, default="normal", index=True)
    subject = fields.Char("Objet", required=True)
    description = fields.Text("Description")
    state = fields.Selection(STATES, "État", required=True, default="new", index=True)
    user_id = fields.Many2one("res.users", "Responsable", index=True, ondelete="set null")
    team_id = fields.Many2one("eguitra.sc.team", "Équipe", check_company=True, index=True, ondelete="set null")
    link_model = fields.Char("Fiche liée (modèle)")
    link_id = fields.Integer("Fiche liée (identifiant)")
    sender_unverified = fields.Boolean("Expéditeur non vérifié", index=True,
                                       help="Adresse ou numéro qui ne correspond à aucun contact de la société.")
    date_open = fields.Datetime("Ouvert le", required=True, readonly=True, default=fields.Datetime.now, index=True)
    date_first_response_due = fields.Datetime("Première réponse avant le", readonly=True, index=True)
    date_resolution_due = fields.Datetime("Résolution avant le", readonly=True, index=True)
    date_first_response = fields.Datetime("Première réponse le", readonly=True)
    date_resolved = fields.Datetime("Résolu le", readonly=True, index=True)
    date_closed = fields.Datetime("Clos le", readonly=True)
    date_last_client = fields.Datetime("Dernier message du client", readonly=True)
    waiting_since = fields.Datetime("En attente du client depuis", readonly=True)
    paused_hours = fields.Float("Heures en attente du client", readonly=True,
                                help="Heures ouvrées passées à attendre le client : elles reportent la résolution.")
    escalated_first = fields.Integer("Escalade de la première réponse", readonly=True,
                                     help="0 : aucune ; 1 : responsable prévenu ; 2 : direction prévenue.")
    escalated_resolution = fields.Integer("Escalade de la résolution", readonly=True)
    satisfaction_score = fields.Integer("Satisfaction (1 à 5)", readonly=True)
    satisfaction_comment = fields.Text("Commentaire du client", readonly=True)
    satisfaction_date = fields.Datetime("Note donnée le", readonly=True)
    satisfaction_channel = fields.Selection(CHANNELS, "Note recueillie par", readonly=True)
    satisfaction_requested = fields.Boolean("Satisfaction demandée", readonly=True)
    satisfaction_token_hash = fields.Char("Empreinte du lien de satisfaction", readonly=True, copy=False, index=True)
    satisfaction_expires = fields.Datetime("Lien de satisfaction valable jusqu'au", readonly=True)
    wa_last_inbound = fields.Datetime("Dernier message WhatsApp du client", readonly=True)
    merged_into_id = fields.Many2one("eguitra.sc.ticket", "Fusionné dans", readonly=True, index=True,
                                     ondelete="set null")
    previous_id = fields.Many2one("eguitra.sc.ticket", "Suite du dossier", readonly=True, ondelete="set null")
    client_user_id = fields.Many2one("res.users", "Déposé par (espace client)", readonly=True, ondelete="set null")
    hsseq_complaint_id = fields.Integer("Réclamation HSSEQ (identifiant)", readonly=True)
    hsseq_reference = fields.Char("Réclamation HSSEQ", readonly=True)
    message_ids = fields.One2many("eguitra.sc.message", "ticket_id", "Fil du dossier")

    @api.depends("contact_phone")
    def _compute_phone_norm(self):
        for ticket in self:
            ticket.contact_phone_norm = wa.normalize_phone(ticket.contact_phone) or False

    # ─── Création ────────────────────────────────────────────────────────

    @api.model_create_multi
    def create(self, vals_list):
        vals_list = [dict(vals) for vals in vals_list]
        for vals in vals_list:
            if not self.env.su and set(vals) & LOCKED_FIELDS - {"company_id"}:
                raise AccessError("Numéro, dates, échéances et escalade d'un dossier sont tenus par la plateforme.")
            company = self.env["res.company"].browse(vals.get("company_id") or self.env.company.id)
            vals["company_id"] = company.id
            if vals.get("name", "/") == "/":
                vals["name"] = self.env["ir.sequence"].sudo().with_company(company).next_by_code(SEQUENCE_CODE) or "/"
            if vals.get("contact_email"):
                vals["contact_email"] = clean_email(vals["contact_email"])
            if vals.get("user_id") and vals.get("state", "new") == "new":
                vals["state"] = "assigned"
        tickets = super().create(vals_list)
        for ticket in tickets:
            ticket._check_links()
            ticket.sudo()._compute_deadlines()
        return tickets

    def write(self, vals):
        if not self.env.su and set(vals) & LOCKED_FIELDS:
            raise AccessError("Numéro, dates, échéances et escalade d'un dossier sont tenus par la plateforme.")
        if vals.get("contact_email"):
            vals = dict(vals, contact_email=clean_email(vals["contact_email"]))
        result = super().write(vals)
        if {"priority", "category_id"} & set(vals):
            for ticket in self:
                ticket.sudo()._compute_deadlines()
        if {"partner_id", "link_model", "link_id"} & set(vals):
            for ticket in self:
                ticket._check_links()
        return result

    def _check_links(self):
        """Fiche liée de la société du dossier et, s'il a un client, de ce client."""
        self.ensure_one()
        ticket = self.sudo()
        if not ticket.link_model:
            return
        record = ticket._linked_record()
        if not record:
            raise UserError("Fiche liée introuvable (module absent ou fiche supprimée).")
        if "company_id" in record._fields and record.company_id and record.company_id != ticket.company_id:
            raise UserError("La fiche liée est celle d'une autre société.")
        partner_field = LINK_MODELS[ticket.link_model][1]
        if partner_field and ticket.partner_id and record[partner_field] and \
                record[partner_field].commercial_partner_id != ticket.partner_id.commercial_partner_id:
            raise UserError(f"Cette fiche ({record.display_name}) est celle d'un autre client.")

    def _linked_record(self):
        self.ensure_one()
        model = self.sudo().link_model
        if not model or model not in LINK_MODELS or model not in self.env or not self.link_id:
            return None
        record = self.env[model].sudo().browse(self.link_id).exists()
        return record or None

    # ─── Échéances ───────────────────────────────────────────────────────

    def _settings(self):
        return self.env["eguitra.sc.settings"]._get(self.company_id)

    def _calendar(self, start, end):
        settings = self._settings()
        holidays = _holidays(self.env, self.company_id, (start or fields.Datetime.now()).date(),
                             ((end or fields.Datetime.now()) + timedelta(days=400)).date())
        return settings.work_start, settings.work_end, holidays

    def _targets(self):
        """Délais retenus (heures ouvrées) : le plus court de la priorité et de la catégorie."""
        self.ensure_one()
        first, resolution = self._settings()._priority_hours(self.priority)
        category = self.category_id
        return (delais.target_hours(first, category.first_hours if category else 0),
                delais.target_hours(resolution, category.resolution_hours if category else 0))

    def _compute_deadlines(self):
        """Échéances de première réponse et de résolution depuis l'ouverture ; la résolution recule des heures
        passées à attendre le client. Une échéance qui change remet son escalade à zéro."""
        for ticket in self:
            first, resolution = ticket._targets()
            open_at, close_at, holidays = ticket._calendar(ticket.date_open, ticket.date_open)
            first_due = delais.add_business_hours(ticket.date_open, first, open_at, close_at, holidays) if first else False
            resolution_due = (delais.add_business_hours(ticket.date_open, resolution + (ticket.paused_hours or 0),
                                                        open_at, close_at, holidays) if resolution else False)
            vals = {}
            if first_due != ticket.date_first_response_due:
                vals.update(date_first_response_due=first_due, escalated_first=0)
            if resolution_due != ticket.date_resolution_due:
                vals.update(date_resolution_due=resolution_due, escalated_resolution=0)
            if vals:
                ticket.sudo().write(vals)

    def _late(self, now=None):
        """Retard en cours : « first » (première réponse), « resolution », ou None. Un dossier en attente du
        client n'est pas en retard de résolution (l'horloge est arrêtée)."""
        self.ensure_one()
        now = now or fields.Datetime.now()
        if self.state not in OPEN_STATES:
            return None
        if not self.date_first_response and self.date_first_response_due and now > self.date_first_response_due:
            return "first"
        if self.state != "waiting" and self.date_resolution_due and now > self.date_resolution_due:
            return "resolution"
        return None

    # ─── États ───────────────────────────────────────────────────────────

    def _can_manage(self, user=None):
        user = user or self.env.user
        return is_agent(user)

    def _check_assignee(self, user):
        """Responsable : un compte interne actif, ouvert à la société du dossier, qui ouvre le service client."""
        self.ensure_one()
        if not user:
            return
        user = user.sudo()
        if user.share or not user.active or self.company_id not in user.company_ids:
            raise UserError(f"{user.name} n'est pas un compte interne actif de {self.company_id.name}.")
        if "service-client" not in user._eguitra_apps():
            raise UserError(f"{user.name} n'ouvre pas le service client (profil sans accès aux dossiers).")

    def assign(self, user=None, team=None, by=None):
        """Responsable et équipe ; un nouveau dossier passe à « Assigné ». Le responsable est prévenu."""
        self.ensure_one()
        ticket = self.sudo()
        vals = {}
        if user is not None:
            self._check_assignee(user)
            vals["user_id"] = user.id if user else False
        if team is not None:
            if team and team.company_id != ticket.company_id:
                raise UserError("Équipe d'une autre société.")
            vals["team_id"] = team.id if team else False
        if not vals:
            return self
        before = ticket.user_id
        ticket.write(vals)
        if ticket.state == "new" and ticket.user_id:
            ticket.write({"state": "assigned"})
        parts = []
        if "user_id" in vals:
            parts.append(f"Responsable : {ticket.user_id.name}" if ticket.user_id else "Responsable retiré")
        if "team_id" in vals:
            parts.append(f"équipe : {ticket.team_id.name}" if ticket.team_id else "équipe retirée")
        ticket._event(" ; ".join(parts) + ".")
        if ticket.user_id and ticket.user_id != before and ticket.user_id != (by or self.env.user):
            self.env["eguitra.sc.notification"]._push(
                ticket.user_id, ticket, "assigned", f"Dossier {ticket.name} : il vous est confié", ticket.subject)
        return self

    def set_state(self, new, reason=None):
        """Passage d'état décidé par un agent (ou par le métier responsable du dossier, pour le traiter)."""
        self.ensure_one()
        ticket = self.sudo()
        if new not in STATE_LABELS:
            raise UserError("État inconnu.")
        if new == ticket.state:
            return self
        allowed = (TRANSITIONS if self._can_manage() else METIER_TRANSITIONS).get(ticket.state, ())
        if new not in allowed:
            raise UserError(f"Le dossier {ticket.name} ne passe pas de « {STATE_LABELS[ticket.state]} » à "
                            f"« {STATE_LABELS[new]} ».")
        if ticket.merged_into_id:
            raise UserError(f"Dossier fusionné dans {ticket.merged_into_id.name} : traitez ce dernier.")
        ticket._apply_state(new, reason=reason)
        return self

    def _apply_state(self, new, reason=None, auto=None):
        """Effets d'un passage d'état : dates, horloge arrêtée pendant l'attente du client, demande de
        satisfaction à la résolution, événement dans le fil."""
        self.ensure_one()
        now = fields.Datetime.now()
        old = self.state
        vals = {"state": new}
        if old == "waiting" and self.waiting_since:
            open_at, close_at, holidays = self._calendar(self.waiting_since, now)
            vals["paused_hours"] = (self.paused_hours or 0) + delais.business_hours(
                self.waiting_since, now, open_at, close_at, holidays)
            vals["waiting_since"] = False
        if new == "waiting":
            vals["waiting_since"] = now
        if new == "resolved":
            vals["date_resolved"] = now
        if new == "closed":
            vals["date_closed"] = now
            if not self.date_resolved:
                vals["date_resolved"] = now
        if new == "reopened":
            vals.update(date_resolved=False, date_closed=False)
        self.write(vals)
        if "paused_hours" in vals:
            self._compute_deadlines()
        text = auto or f"État : {STATE_LABELS[old]} → {STATE_LABELS[new]}."
        if reason:
            text += f" Motif : {clean_line(reason, 300)}"
        self._event(text)
        if new == "resolved":
            self._request_satisfaction()
        if new == "reopened":
            self.write({"satisfaction_requested": False, "satisfaction_token_hash": False})

    # ─── Fil d'échanges ──────────────────────────────────────────────────

    def _event(self, text):
        self.ensure_one()
        return self.env["eguitra.sc.message"].sudo().create({
            "ticket_id": self.id, "kind": "event", "direction": "none", "body": text, "channel": "internal",
        })

    def post_note(self, body, attachments=None):
        """Note interne : jamais visible du client, jamais envoyée."""
        self.ensure_one()
        body = clean_text(body, 10000, "La note")
        if not body and not attachments:
            raise UserError("Écrivez la note.")
        return self.env["eguitra.sc.message"].sudo().create({
            "ticket_id": self.id, "kind": "note", "direction": "none", "channel": "internal",
            "author_id": self.env.uid, "body": body, "attachment_ids": [(6, 0, (attachments or []))],
        })

    def reply(self, body, channel=None, attachments=None, template=None):
        """Réponse au client, envoyée par le canal du dossier (ou celui choisi) ; la première compte comme
        première réponse et fait passer le dossier « En cours »."""
        self.ensure_one()
        ticket = self.sudo()
        if ticket.merged_into_id:
            raise UserError(f"Dossier fusionné dans {ticket.merged_into_id.name} : répondez sur ce dernier.")
        if ticket.state == "closed":
            raise UserError("Dossier clos : rouvrez-le avant de répondre.")
        body = clean_text(body, 4000 if (channel or ticket.channel) == "whatsapp" else 10000, "La réponse")
        if not body:
            raise UserError("Écrivez la réponse au client.")
        channel = channel or ticket.channel
        if channel not in CHANNEL_LABELS:
            raise UserError("Canal d'envoi inconnu.")
        message = self.env["eguitra.sc.message"].sudo().create({
            "ticket_id": ticket.id, "kind": "public", "direction": "out", "channel": channel,
            "author_id": self.env.uid, "body": body, "attachment_ids": [(6, 0, (attachments or []))],
            "template_id": template.id if template else False,
        })
        message._deliver()
        if not ticket.date_first_response and message.delivery_state not in ("failed", "not_sent"):
            ticket.write({"date_first_response": fields.Datetime.now()})
        if ticket.state in ("new", "assigned", "reopened"):
            ticket._apply_state("in_progress", auto="Réponse envoyée au client : dossier en cours.")
        return message

    def client_message(self, body, channel, author_name=None, user=None, attachments=None, unverified=False,
                       external=None, notify=True, reopen=True):
        """Message du client (espace client, courriel, WhatsApp) : il relance un dossier en attente et rouvre un
        dossier résolu. Le responsable est prévenu (sauf pour le premier message d'un dossier, annoncé comme
        nouveau dossier)."""
        self.ensure_one()
        ticket = self.sudo()
        vals = {"ticket_id": ticket.id, "kind": "public", "direction": "in", "channel": channel,
                "author_id": user.id if user else False,
                "author_name": clean_line(author_name or (user.name if user else "") or ticket.contact_name, 120),
                "body": clean_text(body, 20000, "Le message"), "attachment_ids": [(6, 0, (attachments or []))],
                "unverified": unverified}
        vals.update(external or {})
        message = self.env["eguitra.sc.message"].sudo().create(vals)
        now = fields.Datetime.now()
        ticket.write({"date_last_client": now})
        if ticket.state == "waiting":
            ticket._apply_state("in_progress", auto="Le client a répondu : dossier de nouveau en cours.")
        elif ticket.state == "resolved" and reopen:
            ticket._apply_state("reopened", auto="Le client a répondu au dossier résolu : dossier rouvert.")
        recipients = (ticket.user_id or ticket.team_id.member_ids or ticket._agents()) if notify else []
        for recipient in recipients:
            self.env["eguitra.sc.notification"]._push(
                recipient, ticket, "client_message", f"Dossier {ticket.name} : message du client",
                clean_line(body, 160))
        return message

    # ─── Accusé de réception et satisfaction ─────────────────────────────

    def _acknowledge(self):
        """Accusé de réception du dossier par son canal (courriel, WhatsApp, espace client), si les réglages le
        demandent ; il ne compte pas comme première réponse."""
        self.ensure_one()
        ticket = self.sudo()
        if not ticket._settings().ack_enabled or ticket.channel not in ("email", "whatsapp", "portal"):
            return None
        # Courriel d'un expéditeur non vérifié (adresse peut-être forgée) : aucune réponse automatique qui porterait
        # le numéro ou l'objet du dossier vers une adresse que rien ne garantit.
        if ticket.channel == "email" and ticket.sender_unverified:
            return None
        due = ticket.date_first_response_due
        when = f" Nous vous répondons au plus tard le {due:%d/%m/%Y à %H:%M}." if due else ""
        body = (f"Bonjour {ticket.contact_name or ''},\n\nNous avons bien reçu votre demande « {ticket.subject} », "
                f"enregistrée sous le numéro {ticket.name}.{when}\n\nService client de {ticket.company_id.name}")
        message = self.env["eguitra.sc.message"].sudo().create({
            "ticket_id": ticket.id, "kind": "public", "direction": "out", "channel": ticket.channel,
            "body": body.replace("Bonjour ,", "Bonjour,"), "auto": True,
        })
        message._deliver()
        return message

    def _request_satisfaction(self):
        """Demande de satisfaction à la résolution, par le canal du dossier : lien (courriel), réponse par un
        chiffre (WhatsApp), formulaire (espace client) ; au téléphone, l'agent la recueille lui-même."""
        self.ensure_one()
        ticket = self.sudo()
        if not ticket._settings().satisfaction_enabled or ticket.satisfaction_score or ticket.merged_into_id:
            return
        channel = ticket.channel
        if channel == "email" and ticket.sender_unverified:
            ticket._event("Satisfaction : pas de demande automatique à un expéditeur non vérifié ; recueillez-la par "
                          "téléphone au besoin.")
            return
        if channel == "email":
            url = public_url(self.env)
            if not (url and ticket.contact_email):
                ticket._event("Satisfaction : demande non envoyée par courriel (adresse publique du site ou du "
                              "contact absente) ; recueillez-la par téléphone au besoin.")
                return
            raw = secrets.token_urlsafe(32)
            ticket.write({"satisfaction_token_hash": hash_token(raw), "satisfaction_requested": True,
                          "satisfaction_expires": fields.Datetime.now() + timedelta(days=SATISFACTION_DAYS)})
            body = (f"Votre demande {ticket.name} (« {ticket.subject} ») est résolue.\n\nComment jugez-vous notre "
                    f"réponse ? Donnez une note de 1 à 5 en ouvrant ce lien : {url}/satisfaction/{raw}\n\n"
                    f"Vous pouvez aussi répondre à ce courriel si le problème persiste.")
        elif channel == "whatsapp":
            ticket.write({"satisfaction_requested": True})
            body = (f"Votre demande {ticket.name} est résolue. Comment jugez-vous notre réponse ? Répondez par un "
                    "chiffre de 1 (pas satisfait) à 5 (très satisfait), suivi d'un commentaire si vous le souhaitez.")
        elif channel == "portal":
            ticket.write({"satisfaction_requested": True})
            body = (f"Votre demande {ticket.name} est résolue. Donnez-nous votre avis (note de 1 à 5) dans votre "
                    "espace client.")
        else:
            ticket.write({"satisfaction_requested": True})
            ticket._event("Satisfaction : à recueillir auprès du client (téléphone, visite ou courrier), puis à "
                          "noter sur le dossier.")
            return
        message = self.env["eguitra.sc.message"].sudo().create({
            "ticket_id": ticket.id, "kind": "public", "direction": "out", "channel": channel, "body": body,
            "auto": True,
        })
        message._deliver(queue=True)

    def record_satisfaction(self, score, comment=None, channel=None):
        """Note du client (1 à 5) et commentaire, une fois par dossier ; une note basse prévient le responsable."""
        self.ensure_one()
        ticket = self.sudo()
        try:
            score = int(score)
        except (TypeError, ValueError) as e:
            raise UserError("La note va de 1 à 5.") from e
        if not 1 <= score <= 5:
            raise UserError("La note va de 1 à 5.")
        if ticket.state not in ("resolved", "closed"):
            raise UserError("La satisfaction se note quand le dossier est résolu.")
        if ticket.satisfaction_score:
            raise UserError("La satisfaction de ce dossier est déjà notée.")
        comment = clean_text(comment, 2000, "Le commentaire") or False
        ticket.write({"satisfaction_score": score, "satisfaction_comment": comment,
                      "satisfaction_date": fields.Datetime.now(), "satisfaction_channel": channel or ticket.channel,
                      "satisfaction_token_hash": False, "satisfaction_requested": False})
        ticket._event(f"Satisfaction du client : {score}/5" + (f" ; « {clean_line(comment, 300)} »" if comment else "")
                      + ".")
        if score <= 2:
            for recipient in ticket.user_id or ticket._agents():
                self.env["eguitra.sc.notification"]._push(
                    recipient, ticket, "satisfaction_low", f"Dossier {ticket.name} : satisfaction {score}/5",
                    clean_line(comment or ticket.subject, 160))
        return self

    @api.model
    def _by_satisfaction_token(self, raw):
        raw = (raw or "").strip()
        if not 20 <= len(raw) <= 100:
            return self.browse()
        ticket = self.sudo().search([("satisfaction_token_hash", "=", hash_token(raw))], limit=1)
        if not ticket or (ticket.satisfaction_expires and ticket.satisfaction_expires < fields.Datetime.now()):
            return self.browse()
        return ticket

    # ─── Fusion ──────────────────────────────────────────────────────────

    def merge_into(self, target):
        """Fusion d'un dossier en double dans un autre de la même société et du même client : le fil passe au
        dossier gardé, celui-ci est clos, marqué « fusionné » ; les réponses reçues ensuite vont au dossier gardé."""
        self.ensure_one()
        source, target = self.sudo(), target.sudo()
        if source == target:
            raise UserError("Choisissez un autre dossier.")
        if target.company_id != source.company_id:
            raise UserError("Les deux dossiers ne sont pas de la même société.")
        if source.merged_into_id or target.merged_into_id:
            raise UserError("Un dossier déjà fusionné ne se fusionne plus.")
        if target.state == "closed":
            raise UserError(f"Le dossier {target.name} est clos : rouvrez-le ou fusionnez dans l'autre sens.")
        if source.partner_id and target.partner_id and \
                source.partner_id.commercial_partner_id != target.partner_id.commercial_partner_id:
            raise UserError("Les deux dossiers sont ceux de clients différents : ils ne se fusionnent pas.")
        source.message_ids.write({"ticket_id": target.id})
        vals = {}
        if not target.partner_id and source.partner_id:
            vals["partner_id"] = source.partner_id.id
        for field in ("contact_name", "contact_email", "contact_phone"):
            if not target[field] and source[field]:
                vals[field] = source[field]
        if not target.link_model and source.link_model:
            vals.update(link_model=source.link_model, link_id=source.link_id)
        if source.wa_last_inbound and (not target.wa_last_inbound or source.wa_last_inbound > target.wa_last_inbound):
            vals["wa_last_inbound"] = source.wa_last_inbound
        order = [code for code, _label in PRIORITIES]
        if order.index(source.priority) > order.index(target.priority):
            vals["priority"] = source.priority
        if vals:
            target.write(vals)
        now = fields.Datetime.now()
        source.write({"merged_into_id": target.id, "state": "closed", "date_closed": now,
                      "date_resolved": source.date_resolved or now})
        target._event(f"Dossier {source.name} fusionné dans celui-ci : son fil y est repris.")
        source._event(f"Dossier fusionné dans {target.name}.")
        return target

    def _final(self):
        """Dossier qui reçoit vraiment les messages (le dossier gardé d'une fusion)."""
        self.ensure_one()
        ticket = self.sudo()
        seen = set()
        while ticket.merged_into_id and ticket.id not in seen:
            seen.add(ticket.id)
            ticket = ticket.merged_into_id
        return ticket

    # ─── Destinataires ───────────────────────────────────────────────────

    def _agents(self):
        """Agents du service client de la société (comptes internes actifs)."""
        self.ensure_one()
        return users_with_group(self.env, "eguitra_base.group_profile_service_client", self.company_id)

    def _direction(self):
        """Direction de la société (hors administration technique, qui porte aussi ce profil)."""
        self.ensure_one()
        return users_with_group(self.env, DIRECTION_GROUP, self.company_id).filtered(
            lambda u: not u.has_group("eguitra_base.group_profile_admin"))

    def _client_users(self):
        """Comptes de l'espace client qui suivent le tiers du dossier dans sa société."""
        self.ensure_one()
        ticket = self.sudo()
        if not ticket.partner_id:
            return self.env["res.users"]
        return self.env["res.users"].sudo().search([
            ("eguitra_sc_partner_ids", "in", ticket.partner_id.commercial_partner_id.ids),
            ("company_ids", "in", ticket.company_id.ids), ("share", "=", True),
        ])

    # ─── Tâches planifiées ───────────────────────────────────────────────

    @api.model
    def _cron_escalate(self):
        """Escalade des dossiers en retard : le responsable (à défaut l'équipe, à défaut les agents) dès le
        dépassement, la direction au-delà du délai d'escalade. Une seule fois par niveau et par échéance."""
        now = fields.Datetime.now()
        tickets = self.sudo().search([("state", "in", OPEN_STATES), ("merged_into_id", "=", False), "|",
                                      ("date_first_response_due", "<", now), ("date_resolution_due", "<", now)])
        done = self.browse()
        for ticket in tickets:
            late = ticket._late(now)
            if not late:
                continue
            due = ticket.date_first_response_due if late == "first" else ticket.date_resolution_due
            field = "escalated_first" if late == "first" else "escalated_resolution"
            settings = ticket._settings()
            open_at, close_at, holidays = ticket._calendar(due, now)
            over = delais.business_hours(due, now, open_at, close_at, holidays)
            level = 2 if over >= (settings.escalation_hours or 0) else 1
            if level <= ticket[field]:
                continue
            what = "première réponse" if late == "first" else "résolution"
            responsible = ticket.user_id or ticket.team_id.leader_id or ticket.team_id.member_ids or ticket._agents()
            title = f"Dossier {ticket.name} en retard ({what})"
            body = f"{ticket.subject} : échéance du {due:%d/%m/%Y %H:%M} dépassée."
            recipients = responsible
            if level == 2:
                recipients |= ticket._direction()
                title = f"Escalade à la direction : dossier {ticket.name} en retard ({what})"
            for recipient in recipients:
                self.env["eguitra.sc.notification"]._push(recipient, ticket, "escalation", title, body, mail=True)
            ticket.write({field: level})
            ticket._event(f"Escalade : {what} en retard ; "
                          + ("responsable prévenu." if level == 1 else "direction prévenue."))
            done |= ticket
        return done

    @api.model
    def _cron_auto_close(self):
        """Dossiers résolus sans réponse du client depuis le délai de la société : clos d'office."""
        now = fields.Datetime.now()
        closed = self.browse()
        for ticket in self.sudo().search([("state", "=", "resolved"), ("date_resolved", "!=", False)]):
            days = ticket._settings().auto_close_days
            if days and ticket.date_resolved <= now - timedelta(days=days):
                ticket._apply_state("closed", auto=f"Dossier clos d'office : aucune réponse du client sous {days} jours.")
                closed |= ticket
        return closed

    # ─── Lectures ────────────────────────────────────────────────────────

    def _link_ref(self, for_client=False):
        self.ensure_one()
        t = self.sudo()
        if not t.link_model or t.link_model not in LINK_MODELS:
            return None
        nature, _partner, href, _domain = LINK_MODELS[t.link_model]
        record = t._linked_record()
        label = record.display_name if record else None
        if for_client:
            return {"type": nature, "label": label} if record else None
        return {"model": t.link_model, "id": t.link_id, "type": nature, "label": label,
                "href": href.format(id=t.link_id) if record else None, "exists": bool(record)}

    def _delay_row(self, now):
        late = self._late(now)
        return {"first_response_due": self.date_first_response_due or None,
                "resolution_due": self.date_resolution_due or None,
                "first_response": self.date_first_response or None, "resolved": self.date_resolved or None,
                "late": late, "escalation": max(self.escalated_first, self.escalated_resolution)}

    def _row(self, now=None):
        """Ligne de liste (agents, direction, métiers)."""
        self.ensure_one()
        t = self.sudo()
        now = now or fields.Datetime.now()
        return {
            "id": t.id, "name": t.name, "subject": t.subject, "state": t.state, "state_label": STATE_LABELS[t.state],
            "kind": t.kind, "kind_label": KIND_LABELS[t.kind], "priority": t.priority,
            "priority_label": PRIORITY_LABELS[t.priority], "channel": t.channel, "channel_label": CHANNEL_LABELS[t.channel],
            "category": {"id": t.category_id.id, "name": t.category_id.name} if t.category_id else None,
            "partner": {"id": t.partner_id.id, "name": t.partner_id.name} if t.partner_id else None,
            "contact": {"name": t.contact_name or None, "email": t.contact_email or None,
                        "phone": t.contact_phone or None},
            "user": {"id": t.user_id.id, "name": t.user_id.name} if t.user_id else None,
            "team": {"id": t.team_id.id, "name": t.team_id.name} if t.team_id else None,
            "date_open": t.date_open, "sender_unverified": t.sender_unverified,
            "merged_into": {"id": t.merged_into_id.id, "name": t.merged_into_id.name} if t.merged_into_id else None,
            "satisfaction": t.satisfaction_score or None, "company": {"id": t.company_id.id, "name": t.company_id.name},
            **t._delay_row(now),
        }

    def _detail(self, user=None):
        """Fiche complète d'un dossier, pour un compte interne : fil entier (notes comprises), droits du compte."""
        self.ensure_one()
        user = user or self.env.user
        t = self.sudo()
        row = t._row()
        manage = is_agent(user)
        assigned = user == t.user_id or user in t.team_id.member_ids
        writable = manage or assigned
        hsseq = None
        if t.hsseq_complaint_id and "eguitra.hsseq.complaint" in self.env:
            complaint = self.env["eguitra.hsseq.complaint"].sudo().browse(t.hsseq_complaint_id).exists()
            hsseq = {"id": t.hsseq_complaint_id, "reference": t.hsseq_reference,
                     "status": complaint.status if complaint else None,
                     "href": f"/hsseq/environnement?reclamation={t.hsseq_complaint_id}"}
        transitions = (TRANSITIONS if manage else METIER_TRANSITIONS).get(t.state, ()) if writable else ()
        row.update({
            "description": t.description or "", "link": t._link_ref(),
            "previous": {"id": t.previous_id.id, "name": t.previous_id.name} if t.previous_id else None,
            "satisfaction": {"score": t.satisfaction_score or None, "comment": t.satisfaction_comment or None,
                             "date": t.satisfaction_date or None, "channel": t.satisfaction_channel or None,
                             "requested": t.satisfaction_requested},
            "hsseq": hsseq, "hsseq_available": "eguitra.hsseq.complaint" in self.env,
            "hsseq_suggested": bool(t.category_id.hsseq_nature) and t.kind == "complaint",
            "client_accounts": [{"id": u.id, "name": u.name, "login": u.login} for u in t._client_users()],
            "wa_window_open": t._wa_window_open(),
            "messages": [m._row(internal=True) for m in t.message_ids.sorted(lambda m: (m.date, m.id))],
            "can": {"manage": manage and not t.merged_into_id, "reply": writable and t.state != "closed"
                    and not t.merged_into_id, "note": writable, "transitions": [
                        {"state": s, "label": STATE_LABELS[s]} for s in transitions] if not t.merged_into_id else []},
        })
        return row

    def _wa_window_open(self, now=None):
        self.ensure_one()
        last = self.sudo().wa_last_inbound
        return bool(last) and (now or fields.Datetime.now()) - last < timedelta(hours=wa.WINDOW_HOURS)

    def _client_row(self):
        """Ce que lit le client : jamais les notes, le responsable au-delà de son prénom, ni les échéances."""
        self.ensure_one()
        t = self.sudo()
        return {
            "id": t.id, "name": t.name, "subject": t.subject, "state": t.state, "state_label": CLIENT_STATES[t.state],
            "kind_label": KIND_LABELS[t.kind], "category": t.category_id.name or None,
            "company": {"id": t.company_id.id, "name": t.company_id.name}, "date_open": t.date_open,
            "last_update": max(t.message_ids.filtered(lambda m: m.kind == "public").mapped("date") or [t.date_open]),
            "merged_into": t.merged_into_id.name or None,
        }

    def _client_detail(self):
        self.ensure_one()
        t = self.sudo()
        row = t._client_row()
        row.update({
            "description": t.description or "",
            "handled_by": first_name(t.user_id) or f"Service client de {t.company_id.name}",
            "link": t._link_ref(for_client=True),
            "messages": [m._row(internal=False) for m in t.message_ids.filtered(lambda m: m.kind == "public")
                         .sorted(lambda m: (m.date, m.id))],
            "satisfaction": {"score": t.satisfaction_score or None, "comment": t.satisfaction_comment or None,
                             "can_rate": t.state in ("resolved", "closed") and not t.satisfaction_score
                             and not t.merged_into_id},
            "can": {"reply": t.state != "closed" and not t.merged_into_id,
                    "confirm": t.state == "resolved" and not t.merged_into_id},
        })
        return row
