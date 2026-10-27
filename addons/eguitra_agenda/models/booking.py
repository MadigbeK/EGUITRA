"""Prise de rendez-vous en ligne (à la manière de Calendly), désactivée par défaut.

Un compte publie un type de rendez-vous (durée, plages, délai minimal, horizon, questions) ; un lien
public permet à une personne extérieure de choisir un créneau libre de son agenda. Sans captcha
possible, la plateforme se protège ainsi :
- interrupteur général (paramètre eguitra_agenda.booking_enabled, à 0 par défaut) et adresse publique
  du site (eguitra_agenda.public_url, en https) posés par l'administration ; serveur de courrier exigé ;
- limite de débit par adresse IP (lecture des créneaux, demandes, confirmations) et par adresse
  électronique, plafond de demandes par type et par jour ;
- liste de domaines autorisés par type (adresses de ses clients ou partenaires) ;
- confirmation par courriel : la demande ne devient un rendez-vous qu'après le clic sur le lien reçu
  (jeton haché en base, valable 30 minutes) ; d'ici là, le créneau est retenu ;
- verrou par agenda pendant la réservation : deux demandes simultanées ne prennent pas le même créneau ;
- rien n'est lu de l'agenda au-delà des créneaux libres (ni titres, ni participants).
"""

import re
import secrets
from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import AccessError, MissingError, UserError

from odoo.addons.eguitra_api.models.api_token import hash_token

from .. import moteur
from .common import (
    agenda_allowed,
    check_agenda_user,
    clean_email,
    clean_line,
    clean_text,
    clean_url,
    fmt_when,
    mail_server_ready,
    parse_datetime,
    send_mail,
)

BOOKING_LOCK = 4243
PENDING_MINUTES = 30
MAX_QUESTIONS = 5
STATES = [("pending", "À confirmer"), ("confirmed", "Confirmé"), ("cancelled", "Annulé"), ("expired", "Expiré")]
# Limites par adresse IP : (nombre, minutes).
LIMITS = {"view": (120, 10), "book": (5, 60), "confirm": (20, 60)}
PER_EMAIL_PER_DAY = 3
PER_TYPE_PER_DAY = 50


class BookingRefused(UserError):
    """Refus d'une demande publique, avec son code (limite atteinte : 429)."""

    def __init__(self, message, status=422, code="business_rule"):
        super().__init__(message)
        self.status = status
        self.code = code


def platform_settings(env):
    params = env["ir.config_parameter"].sudo()
    return {"enabled": params.get_param("eguitra_agenda.booking_enabled", "0") == "1",
            "public_url": (params.get_param("eguitra_agenda.public_url") or "").rstrip("/") or None}


def booking_open(env):
    settings = platform_settings(env)
    return settings["enabled"] and bool(settings["public_url"]) and mail_server_ready(env)


class AgendaBookingType(models.Model):
    _name = "eguitra.agenda.booking.type"
    _description = "Type de rendez-vous en ligne"
    _order = "owner_id, id"

    owner_id = fields.Many2one("res.users", "Propriétaire", required=True, index=True, ondelete="cascade")
    name = fields.Char("Intitulé", required=True)
    description = fields.Text("Présentation")
    duration = fields.Integer("Durée (minutes)", default=30)
    location = fields.Char("Lieu")
    video_url = fields.Char("Visioconférence")
    slots = fields.Json("Plages proposées", help="Format des heures de travail ; vide : celles du propriétaire.")
    min_notice_hours = fields.Integer("Délai minimal (heures)", default=24)
    max_days = fields.Integer("Horizon (jours)", default=30)
    buffer_minutes = fields.Integer("Temps tampon (minutes)", default=0)
    questions = fields.Json("Questions")
    allowed_domains = fields.Char("Domaines autorisés", help="Adresses acceptées, séparées par des virgules ; vide : toutes.")
    key = fields.Char("Clé du lien public", required=True, index=True, copy=False)
    active = fields.Boolean("Publié", default=False)

    _key_unique = models.Constraint("unique(key)", "Clé déjà attribuée.")

    # ─── Gestion par le propriétaire ─────────────────────────────────────

    @api.model
    def _values(self, data, partial=False):
        vals = {}
        if not partial or "name" in data:
            vals["name"] = clean_line(data.get("name"), 80)
            if not vals["name"]:
                raise UserError("Donnez un intitulé au rendez-vous.")
        for key, low, high, label in (("duration", 10, 480, "La durée"), ("min_notice_hours", 0, 720, "Le délai minimal"),
                                      ("max_days", 1, 180, "L'horizon"), ("buffer_minutes", 0, 120, "Le temps tampon")):
            if key in data:
                try:
                    value = int(data[key])
                except (TypeError, ValueError) as e:
                    raise UserError(f"{label} est un nombre.") from e
                if not low <= value <= high:
                    raise UserError(f"{label} va de {low} à {high}.")
                vals[key] = value
        if "description" in data:
            vals["description"] = clean_text(data.get("description"), 1000) or False
        if "location" in data:
            vals["location"] = clean_line(data.get("location"), 200) or False
        if "video_url" in data:
            vals["video_url"] = clean_url(data.get("video_url"))
        if "slots" in data:
            try:
                vals["slots"] = moteur.check_work_hours(data["slots"]) if data.get("slots") else False
            except moteur.RuleError as e:
                raise UserError(str(e)) from e
        if "questions" in data:
            questions = [clean_line(q, 200) for q in (data.get("questions") or []) if clean_line(q, 200)]
            if len(questions) > MAX_QUESTIONS:
                raise UserError(f"{MAX_QUESTIONS} questions au plus.")
            vals["questions"] = questions
        if "allowed_domains" in data:
            domains = []
            for d in str(data.get("allowed_domains") or "").replace(";", ",").split(","):
                d = d.strip().lower().lstrip("@")
                if d:
                    if not re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", d):
                        raise UserError(f"Domaine invalide : {d}.")
                    domains.append(d)
            vals["allowed_domains"] = ", ".join(dict.fromkeys(domains)) or False
        return vals

    @api.model
    def create_mine(self, data):
        check_agenda_user(self.env)
        if self.sudo().search_count([("owner_id", "=", self.env.uid)]) >= 10:
            raise UserError("10 types de rendez-vous au plus par compte.")
        vals = self._values(data)
        return self.sudo().create(dict(vals, owner_id=self.env.uid, key=secrets.token_urlsafe(16), active=False))

    def _check_owner(self):
        self.ensure_one()
        if self.sudo().owner_id != self.env.user:
            raise AccessError("Seul son propriétaire gère ce type de rendez-vous.")

    def update_mine(self, data):
        self._check_owner()
        bt = self.sudo()
        vals = self._values(data, partial=True)
        if "active" in data:
            if data["active"] and not booking_open(self.env):
                raise UserError("La prise de rendez-vous en ligne n'est pas ouverte sur la plateforme : l'administration "
                                "l'active (avec l'adresse publique du site et le serveur de courrier).")
            vals["active"] = bool(data["active"])
        bt.write(vals)
        return bt

    def remove_mine(self):
        self._check_owner()
        self.sudo().unlink()
        return True

    def _row(self):
        self.ensure_one()
        bt = self.sudo()
        public_url = platform_settings(self.env)["public_url"]
        return {"id": bt.id, "name": bt.name, "description": bt.description or None, "duration": bt.duration,
                "location": bt.location or None, "video_url": bt.video_url or None,
                "slots": {d: [[moteur.hhmm(a), moteur.hhmm(b)] for a, b in r] for d, r in (bt.slots or {}).items()}
                if bt.slots else None,
                "min_notice_hours": bt.min_notice_hours, "max_days": bt.max_days, "buffer_minutes": bt.buffer_minutes,
                "questions": bt.questions or [], "allowed_domains": bt.allowed_domains or None, "active": bt.active,
                "link": f"{public_url}/rendez-vous/{bt.key}" if public_url else None, "key": bt.key}

    # ─── Créneaux ────────────────────────────────────────────────────────

    def _tz(self):
        return self.env["eguitra.agenda.preference"]._for(self.owner_id)._tz()

    def _free_slots(self, a, b, now=None):
        """Créneaux libres du propriétaire dans [a, b[ : ses plages (ou heures de travail), délai minimal,
        horizon, temps tampon, occupations de son agenda et demandes en attente de confirmation."""
        self.ensure_one()
        bt = self.sudo()
        now = now or fields.Datetime.now()
        owner = bt.owner_id
        floor = now + timedelta(hours=bt.min_notice_hours)
        ceiling = now + timedelta(days=bt.max_days)
        a, b = max(a, floor), min(b, ceiling)
        if b <= a:
            return []
        Event = self.env["eguitra.agenda.event"]
        busy = [(s, e) for s, e, _k, _ev in Event._busy_of(owner, a - timedelta(hours=4), b + timedelta(hours=4))]
        pending = self.env["eguitra.agenda.booking"].sudo().search([
            ("type_id.owner_id", "=", owner.id), ("state", "=", "pending"), ("expires_at", ">", now),
            ("start", "<", b), ("stop", ">", a)])
        busy += [(p.start, p.stop) for p in pending]
        pref = self.env["eguitra.agenda.preference"]._for(owner)
        person = {"key": "owner", "busy": busy, "work": bt.slots or pref._work(), "tz": pref._tz()}
        step = 15 if bt.duration <= 15 else 30
        return moteur.find_slots(a, b, timedelta(minutes=bt.duration), [person], step=step, buffer=bt.buffer_minutes,
                                 limit=500, now=floor)

    def _public_row(self):
        self.ensure_one()
        bt = self.sudo()
        return {"name": bt.name, "owner": bt.owner_id.name, "description": bt.description or None,
                "duration": bt.duration, "location": bt.location or None, "online": bool(bt.video_url),
                "questions": bt.questions or [], "tz": bt._tz(), "min_notice_hours": bt.min_notice_hours,
                "max_days": bt.max_days, "domains_restricted": bool(bt.allowed_domains)}

    @api.model
    def _public(self, key):
        """Type publié derrière une clé de lien public ; sinon introuvable (rien n'est dit de plus)."""
        if not booking_open(self.env) or not key or len(key) > 64:
            raise MissingError("Page introuvable.")
        bt = self.sudo().search([("key", "=", key), ("active", "=", True)], limit=1)
        if not bt or not agenda_allowed(bt.owner_id):
            raise MissingError("Page introuvable.")
        return bt

    def _check_email(self, email):
        self.ensure_one()
        email = clean_email(email)
        domains = [d.strip() for d in (self.sudo().allowed_domains or "").split(",") if d.strip()]
        if domains and email.rsplit("@", 1)[1] not in domains:
            raise BookingRefused("Cette prise de rendez-vous est réservée aux adresses électroniques de certaines "
                                 "organisations : utilisez votre adresse professionnelle.")
        return email


class AgendaBooking(models.Model):
    _name = "eguitra.agenda.booking"
    _description = "Rendez-vous pris en ligne"
    _order = "start desc, id desc"

    type_id = fields.Many2one("eguitra.agenda.booking.type", "Type", required=True, index=True, ondelete="cascade")
    start = fields.Datetime("Début", required=True, index=True)
    stop = fields.Datetime("Fin", required=True)
    name = fields.Char("Nom", required=True)
    email = fields.Char("Adresse électronique", required=True, index=True)
    answers = fields.Json("Réponses")
    ip = fields.Char("Adresse IP")
    state = fields.Selection(STATES, "État", required=True, default="pending", index=True)
    token_hash = fields.Char("Empreinte du lien de confirmation", index=True, copy=False)
    expires_at = fields.Datetime("À confirmer avant", index=True)
    confirmed_at = fields.Datetime("Confirmé le")
    event_id = fields.Many2one("eguitra.agenda.event", "Événement", ondelete="set null")

    @api.model
    def _limit(self, ip, kind):
        """Limite de débit par adresse IP (sans adresse connue : la limite vaut pour tous). Les routes
        publiques rendent leurs refus sans annuler la transaction (comme la connexion) : une demande refusée
        ensuite (créneau pris, adresse refusée, lien inconnu) compte quand même."""
        count, minutes = LIMITS[kind]
        since = fields.Datetime.now() - timedelta(minutes=minutes)
        Attempt = self.env["eguitra.agenda.booking.attempt"].sudo()
        domain = [("ip", "=", ip or "inconnue"), ("kind", "=", kind), ("create_date", ">=", since)]
        if Attempt.search_count(domain) >= count:
            raise BookingRefused("Trop de demandes depuis votre connexion : réessayez dans une heure.", 429, "rate_limited")
        Attempt.create({"ip": ip or "inconnue", "kind": kind})

    @api.model
    def request_booking(self, bt, data, ip):
        """Demande publique (débit déjà compté par la route) : contrôles, créneau retenu 30 minutes, courriel
        de confirmation."""
        bt = bt.sudo()
        email = bt._check_email(data.get("email"))
        name = clean_line(data.get("name"), 120)
        if len(name) < 2:
            raise BookingRefused("Indiquez votre nom.")
        answers = data.get("answers") or []
        if not isinstance(answers, list) or len(answers) > len(bt.questions or []):
            raise BookingRefused("Réponses illisibles.")
        answers = [clean_text(a, 500) for a in answers]
        start = parse_datetime(data.get("start"), "créneau")
        now = fields.Datetime.now()
        day = now.replace(hour=0, minute=0, second=0)
        if self.sudo().search_count([("email", "=", email), ("create_date", ">=", day),
                                     ("state", "in", ("pending", "confirmed"))]) >= PER_EMAIL_PER_DAY:
            raise BookingRefused("Vous avez déjà plusieurs demandes en cours aujourd'hui.", 429, "rate_limited")
        if self.sudo().search_count([("type_id", "=", bt.id), ("create_date", ">=", day)]) >= PER_TYPE_PER_DAY:
            raise BookingRefused("Les demandes de ce jour sont complètes : réessayez demain.", 429, "rate_limited")
        self.env.cr.execute("SELECT pg_advisory_xact_lock(%s, %s)", (BOOKING_LOCK, bt.owner_id.id))
        self.env.flush_all()
        stop = start + timedelta(minutes=bt.duration)
        slots = bt._free_slots(start - timedelta(minutes=1), stop + timedelta(minutes=1), now=now)
        if not any(s["start"] == start for s in slots):
            raise BookingRefused("Ce créneau n'est plus libre : choisissez-en un autre.", 409, "conflict")
        raw = secrets.token_urlsafe(32)
        booking = self.sudo().create({
            "type_id": bt.id, "start": start, "stop": stop, "name": name, "email": email, "answers": answers,
            "ip": (ip or "")[:45] or False, "token_hash": hash_token(raw), "expires_at": now + timedelta(minutes=PENDING_MINUTES),
        })
        public_url = platform_settings(self.env)["public_url"]
        tz = bt._tz()
        send_mail(self.env, email, f"Confirmez votre rendez-vous avec {bt.owner_id.name}", "Confirmez votre rendez-vous", [
            f"Bonjour {name},",
            f"Vous avez demandé un rendez-vous « {bt.name} » avec {bt.owner_id.name} : {fmt_when(start, stop, False, tz)}.",
            f"Pour le confirmer, ouvrez ce lien dans les {PENDING_MINUTES} minutes : {public_url}/rendez-vous/confirmer/{raw}",
            "Sans confirmation, le créneau est libéré. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
        ])
        return booking

    @api.model
    def confirm(self, raw, ip):
        """Clic sur le lien du courriel : le rendez-vous entre dans l'agenda du propriétaire."""
        self._limit(ip, "confirm")
        if not booking_open(self.env):
            raise MissingError("Page introuvable.")
        raw = (raw or "").strip()
        if not 20 <= len(raw) <= 100:
            raise MissingError("Lien de confirmation inconnu.")
        booking = self.sudo().search([("token_hash", "=", hash_token(raw))], limit=1)
        if not booking:
            raise MissingError("Lien de confirmation inconnu.")
        if booking.state == "confirmed":
            return booking
        now = fields.Datetime.now()
        if booking.state != "pending" or booking.expires_at < now:
            if booking.state == "pending":
                booking.state = "expired"
            raise BookingRefused("Ce lien a expiré : demandez un nouveau rendez-vous.", 410, "expired")
        bt = booking.type_id
        owner = bt.owner_id
        self.env.cr.execute("SELECT pg_advisory_xact_lock(%s, %s)", (BOOKING_LOCK, owner.id))
        self.env.flush_all()
        busy = [(s, e) for s, e, _k, _ev in self.env["eguitra.agenda.event"]._busy_of(owner, booking.start, booking.stop)]
        if moteur.overlaps(busy, booking.start, booking.stop):
            booking.state = "cancelled"
            raise BookingRefused("Ce créneau vient d'être pris : demandez un autre rendez-vous.", 409, "conflict")
        Calendar = self.env["eguitra.agenda.calendar"]
        personal = Calendar._ensure_personal(owner)
        questions = bt.questions or []
        answers = "\n".join(f"{q} : {a}" for q, a in zip(questions, booking.answers or []) if a)
        event = self.env["eguitra.agenda.event"].with_user(owner).sudo().create({
            "calendar_id": personal.id, "organizer_id": owner.id, "name": f"{bt.name} : {booking.name}",
            "start": booking.start, "stop": booking.stop, "tz": bt._tz(), "location": bt.location or False,
            "video_url": bt.video_url or False, "ical_uid": f"{secrets.token_hex(16)}@nimova",
            "description": f"Rendez-vous pris en ligne par {booking.name} ({booking.email}).\n{answers}".strip(),
            "attendee_ids": [(0, 0, {"name": booking.name, "email": booking.email, "state": "accepted"})],
        })
        event._update_recurrence_end()
        booking.write({"state": "confirmed", "confirmed_at": now, "event_id": event.id})
        self.env["eguitra.agenda.notification"].with_context(agenda_system=True)._push(
            owner, "booking", f"Rendez-vous pris en ligne : {booking.name}",
            f"{bt.name}, {fmt_when(booking.start, booking.stop, False, bt._tz())}.", event=event)
        event._notify_invitation(self.env["res.users"], [{"email": booking.email, "name": booking.name}])
        return booking

    @api.model
    def _cron_expire(self):
        """Demandes non confirmées à temps : le créneau est libéré ; compteurs de débit de plus d'un jour purgés."""
        now = fields.Datetime.now()
        late = self.sudo().search([("state", "=", "pending"), ("expires_at", "<", now)])
        late.write({"state": "expired", "token_hash": False})
        self.env["eguitra.agenda.booking.attempt"].sudo().search(
            [("create_date", "<", now - timedelta(days=1))]).unlink()
        return len(late)

    def _row(self):
        self.ensure_one()
        b = self.sudo()
        return {"id": b.id, "type": b.type_id.name, "start": b.start, "stop": b.stop, "name": b.name, "email": b.email,
                "state": b.state, "answers": b.answers or [], "event_id": b.event_id.id or None}


class AgendaBookingAttempt(models.Model):
    """Compteur de débit des pages publiques de prise de rendez-vous (purgé chaque nuit)."""

    _name = "eguitra.agenda.booking.attempt"
    _description = "Demande publique de rendez-vous (limite de débit)"

    ip = fields.Char("Adresse IP", required=True, index=True)
    kind = fields.Char("Nature", required=True, index=True)
