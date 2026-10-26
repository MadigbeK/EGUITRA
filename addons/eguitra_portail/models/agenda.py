"""Agenda du portail : événements et formations du cabinet (inscriptions, liste d'attente) et
rendez-vous entre un porteur et son consultant (demande, confirmation, compte rendu)."""

from datetime import timedelta

import psycopg2

from odoo import api, fields, models
from odoo.exceptions import UserError

# Heure des notifications et des rappels : celle de Conakry, quel que soit le réglage du compte qui
# déclenche l'envoi (la tâche planifiée n'a pas de fuseau).
TZ = "Africa/Conakry"

EVENT_KINDS = [
    ("atelier", "Atelier"),
    ("formation", "Formation"),
    ("webinaire", "Webinaire"),
    ("permanence", "Permanence du cabinet"),
    ("rencontre", "Rencontre avec des financeurs"),
    ("pitch", "Session de pitch"),
]
EVENT_STATES = [("draft", "Brouillon"), ("published", "Publié"), ("cancelled", "Annulé")]
REGISTRATION_STATES = [
    ("registered", "Inscrit"),
    ("waitlist", "Liste d'attente"),
    ("cancelled", "Désinscrit"),
    ("attended", "Présent"),
    ("absent", "Absent"),
]
SEATED = ("registered", "attended", "absent")
# Inscriptions encore en cours (place ou attente) : prévenues d'un changement de l'événement.
PENDING = ("registered", "waitlist")
# Ce qu'un inscrit doit savoir : l'horaire, le lieu et le lien de connexion.
CHANGE_FIELDS = ("start", "end", "location", "online_url")
AUDIENCE_FIELDS = ("audience", "dossier_ids", "gate_codes", "sector_keywords")
MEETING_MODES = [
    ("office", "Au cabinet"),
    ("video", "Visioconférence"),
    ("phone", "Téléphone"),
    ("site", "Sur le site du projet"),
]
MEETING_STATES = [
    ("requested", "Demandé"),
    ("confirmed", "Confirmé"),
    ("declined", "Décliné"),
    ("cancelled", "Annulé"),
    ("done", "Tenu"),
]


def _check_url(url):
    if url and not url.startswith("https://"):
        raise UserError("L'adresse en ligne doit commencer par https://.")


def local_time(record, value):
    """Date et heure du noyau (UTC) à l'heure du compte, Conakry à défaut."""
    tz = record.env.context.get("tz") or TZ
    return fields.Datetime.context_timestamp(record.with_context(tz=tz), value)


def _minute(value):
    """Comparaison à la minute : l'écran renvoie les dates sans les secondes."""
    return value.replace(second=0, microsecond=0) if value else value


class PortailEvent(models.Model):
    _name = "portail.event"
    _inherit = ["portail.audience.mixin"]
    _description = "Événement ou formation du cabinet"
    _order = "start desc, id desc"

    name = fields.Char("Intitulé", required=True)
    kind = fields.Selection(EVENT_KINDS, "Format", default="atelier", required=True)
    description = fields.Text("Programme")
    speaker = fields.Char("Intervenants")
    start = fields.Datetime("Début", required=True)
    end = fields.Datetime("Fin", required=True)
    location = fields.Char("Lieu")
    online_url = fields.Char("Lien de connexion", help="Communiqué aux seuls inscrits.")
    capacity = fields.Integer("Places", help="0 : sans limite.")
    registration_deadline = fields.Datetime("Inscriptions jusqu'au")
    state = fields.Selection(EVENT_STATES, default="draft", required=True)
    registration_ids = fields.One2many("portail.event.registration", "event_id", "Inscriptions")
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)

    @api.constrains("start", "end", "capacity", "online_url")
    def _check_event(self):
        for event in self:
            if event.end <= event.start:
                raise UserError("La fin doit suivre le début.")
            if event.capacity < 0:
                raise UserError("Le nombre de places ne peut être négatif.")
            _check_url(event.online_url)

    def seats_taken(self):
        self.ensure_one()
        return len(self.registration_ids.filtered(lambda r: r.state in SEATED))

    def seats_left(self):
        self.ensure_one()
        return None if not self.capacity else max(0, self.capacity - self.seats_taken())

    def registration_open(self):
        self.ensure_one()
        now = fields.Datetime.now()
        return self.state == "published" and self.start > now and (
            not self.registration_deadline or self.registration_deadline >= now)

    def _lock_seats(self):
        """Verrou de ligne sur l'événement (SELECT … FOR UPDATE) : les inscriptions, désinscriptions et
        promotions d'un même événement passent l'une après l'autre, et la jauge n'est jamais dépassée
        par deux inscriptions simultanées. La ligne est aussi réécrite (sans rien changer) : le noyau lit
        la base telle qu'au début de la transaction (lecture répétable), et la seconde inscription, qui
        aurait compté les places sans voir la première, échoue au lieu de passer ; le porteur réessaie."""
        if not self.ids:
            return
        ids = tuple(self.ids)
        try:
            self.env.cr.execute("SELECT id FROM portail_event WHERE id IN %s FOR UPDATE", (ids,))
            self.env.cr.execute("UPDATE portail_event SET write_date = write_date WHERE id IN %s", (ids,))
        except psycopg2.errors.SerializationFailure as e:
            raise UserError("Plusieurs inscriptions arrivent en même temps sur cet événement : "
                            "réessayez dans un instant.") from e

    def _waiting(self):
        """Liste d'attente dans l'ordre d'attente : la date « en attente depuis », puis l'inscription."""
        self.ensure_one()
        return self.registration_ids.filtered(lambda r: r.state == "waitlist").sorted(
            lambda r: (r.waitlist_since or r.create_date, r.id))

    def _promote_waitlist(self):
        """Donne les places libres à la liste d'attente, dans l'ordre d'attente, et prévient chaque
        porteur promu. Sans limite de places, toute la liste passe. Jamais sur un événement annulé,
        en brouillon ou déjà commencé. Appelée quand une place se libère ou que la capacité augmente."""
        now = fields.Datetime.now()
        for event in self:
            if event.state != "published" or event.start <= now:
                continue
            event._lock_seats()
            waiting = event._waiting()
            if event.capacity:
                waiting = waiting[:event.seats_left()]
            if not waiting:
                continue
            waiting.write({"state": "registered", "waitlist_since": False})
            event.env["portail.notification"].sudo().notify(
                waiting.user_id, "event", f"Place confirmée : {event.name}",
                "Une place s'est libérée : votre inscription est confirmée.", "/portail/evenements")

    def register(self, user, dossier=None, note=None):
        """Inscription du porteur. L'événement complet, il rejoint la fin de la liste d'attente : un
        nouvel inscrit ne passe jamais devant ceux qui attendent (les places libres leur reviennent
        d'abord). Un porteur qui se réinscrit après s'être désinscrit reprend en fin de liste."""
        self.ensure_one()
        if not self.registration_open():
            raise UserError("Les inscriptions à cet événement sont closes.")
        self._lock_seats()
        Registration = self.env["portail.event.registration"].sudo()
        registration = Registration.search([("event_id", "=", self.id), ("user_id", "=", user.id)], limit=1)
        if registration and registration.state in SEATED + ("waitlist",):
            return registration
        self._promote_waitlist()
        full = bool(self.capacity) and self.seats_left() == 0
        values = {"state": "waitlist" if full else "registered", "note": (note or "")[:1000] or False,
                  "dossier_id": dossier.id if dossier else False,
                  "waitlist_since": fields.Datetime.now() if full else False}
        if registration:
            registration.write(values)
        else:
            registration = Registration.create(dict(values, event_id=self.id, user_id=user.id))
        return registration

    def _summary(self):
        """« Atelier le 12/11/2026 à 09 h 00 » : la ligne de l'annonce de l'événement."""
        self.ensure_one()
        return f"{dict(EVENT_KINDS)[self.kind]} le {local_time(self, self.start):%d/%m/%Y à %H h %M}"

    def action_publish(self):
        self.write({"state": "published"})
        for event in self:
            event.env["portail.notification"].sudo().notify(
                event._audience_users(), "event", event.name, event._summary(), "/portail/evenements")

    def action_cancel(self):
        self.write({"state": "cancelled"})
        for event in self:
            users = event.registration_ids.filtered(lambda r: r.state in PENDING).user_id
            event.env["portail.notification"].sudo().notify(
                users, "event", f"Annulé : {event.name}", "Le cabinet a annulé cet événement.", "/portail/evenements")

    def write(self, vals):
        """Événement publié : un changement d'horaire, de lieu ou de lien prévient les inscrits (et la
        liste d'attente) ; un public élargi reçoit l'annonce de l'événement ; une capacité augmentée
        donne ses places à la liste d'attente. L'écran renvoie tous les champs : seul ce qui change
        vraiment compte."""
        watched = bool(set(vals) & set(CHANGE_FIELDS))
        audience = bool(set(vals) & set(AUDIENCE_FIELDS))
        before = {}
        if watched or audience:
            for event in self.filtered(lambda e: e.state == "published"):
                before[event.id] = dict({f: event[f] for f in CHANGE_FIELDS},
                                        users=event._audience_users() if audience else None)
        result = super().write(vals)
        if "capacity" in vals:
            self._promote_waitlist()
        for event in self.filtered(lambda e: e.id in before and e.state == "published"):
            event._announce_changes(before[event.id])
        return result

    def _announce_changes(self, before):
        self.ensure_one()
        Notification = self.env["portail.notification"].sudo()
        changes = []
        if _minute(before["start"]) != _minute(self.start) or _minute(before["end"]) != _minute(self.end):
            debut, fin = local_time(self, self.start), local_time(self, self.end)
            if debut.date() == fin.date():
                changes.append(f"Nouvel horaire : le {debut:%d/%m/%Y}, de {debut:%H h %M} à {fin:%H h %M}.")
            else:
                changes.append(f"Nouvel horaire : du {debut:%d/%m/%Y à %H h %M} au {fin:%d/%m/%Y à %H h %M}.")
        if (before["location"] or False) != (self.location or False):
            changes.append(f"Nouveau lieu : {self.location}." if self.location else "Le lieu a été retiré.")
        if (before["online_url"] or False) != (self.online_url or False):
            changes.append("Le lien de connexion a changé : retrouvez-le sur votre portail." if self.online_url
                           else "L'événement n'a plus de lien de connexion.")
        pending = self.registration_ids.filtered(lambda r: r.state in PENDING).user_id
        if changes:
            Notification.notify(pending, "event", f"Changement : {self.name}", " ".join(changes), "/portail/evenements")
        if before["users"] is not None:
            newcomers = self._audience_users() - before["users"] - self.registration_ids.user_id
            Notification.notify(newcomers, "event", self.name, self._summary(), "/portail/evenements")


class PortailEventRegistration(models.Model):
    _name = "portail.event.registration"
    _description = "Inscription d'un porteur à un événement"
    _order = "create_date, id"

    event_id = fields.Many2one("portail.event", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="event_id.company_id", store=True)
    user_id = fields.Many2one("res.users", "Porteur", required=True, ondelete="cascade", index=True)
    dossier_id = fields.Many2one("axispro.dossier", "Dossier", ondelete="set null")
    state = fields.Selection(REGISTRATION_STATES, default="registered", required=True)
    note = fields.Text("Question ou attente du porteur")
    waitlist_since = fields.Datetime("En attente depuis", help="Rang dans la liste d'attente : le plus ancien passe "
                                                               "le premier.")

    _unique = models.Constraint("unique(event_id, user_id)", "Une inscription par porteur et par événement.")

    def cancel(self):
        """Désinscription ; une place libérée revient à la liste d'attente, dans l'ordre d'attente."""
        freed = self.env["portail.event"]
        for registration in self:
            event = registration.event_id
            event._lock_seats()
            if registration.state in SEATED:
                freed |= event
            registration.write({"state": "cancelled", "waitlist_since": False})
        freed._promote_waitlist()

    def give_seat(self):
        """Place donnée par le cabinet à une personne en attente, au-delà de la limite au besoin."""
        self.write({"state": "registered", "waitlist_since": False})


class PortailMeeting(models.Model):
    _name = "portail.meeting"
    _description = "Rendez-vous entre un porteur et le cabinet"
    _order = "start desc, id desc"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True)
    requested_by = fields.Many2one("res.users", "Demandé par", default=lambda self: self.env.user, required=True)
    consultant_id = fields.Many2one("res.users", "Consultant")
    subject = fields.Char("Objet", required=True)
    agenda = fields.Text("Points à aborder")
    mode = fields.Selection(MEETING_MODES, "Forme", default="office", required=True)
    slot_1 = fields.Datetime("Créneau proposé 1")
    slot_2 = fields.Datetime("Créneau proposé 2")
    slot_3 = fields.Datetime("Créneau proposé 3")
    start = fields.Datetime("Date retenue")
    duration = fields.Integer("Durée (min)", default=60)
    location = fields.Char("Lieu")
    online_url = fields.Char("Lien de connexion")
    state = fields.Selection(MEETING_STATES, default="requested", required=True)
    cabinet_note = fields.Text("Message du cabinet")
    minutes = fields.Text("Compte rendu partagé")
    cancelled_by = fields.Selection([("porteur", "Porteur"), ("cabinet", "Cabinet")], "Annulé par", readonly=True)

    @api.constrains("duration", "online_url")
    def _check_meeting(self):
        for meeting in self:
            if not 15 <= meeting.duration <= 480:
                raise UserError("Durée comprise entre 15 minutes et 8 heures.")
            _check_url(meeting.online_url)

    def end(self):
        self.ensure_one()
        return self.start + timedelta(minutes=self.duration) if self.start else None

    def _notify_porteur(self, title, body):
        for meeting in self:
            meeting.env["portail.notification"].sudo().notify(
                meeting.dossier_id.portal_user_ids, "meeting", title, body,
                "/portail/rendez-vous", dossier=meeting.dossier_id)

    def confirm(self, start, **values):
        """Confirmation (ou nouvelle date) : jamais à une date passée."""
        self.ensure_one()
        if self.state not in ("requested", "confirmed"):
            raise UserError("Ce rendez-vous ne peut plus être confirmé.")
        if not start:
            raise UserError("Indiquez la date du rendez-vous.")
        start = fields.Datetime.to_datetime(start)
        if start < fields.Datetime.now().replace(second=0, microsecond=0):
            raise UserError("Cette date est passée : choisissez une date à venir.")
        self.write(dict(values, start=start, state="confirmed"))
        when = local_time(self, self.start)
        self._notify_porteur(f"Rendez-vous confirmé : {self.subject}", f"Le {when:%d/%m/%Y à %H h %M}.")

    def decline(self, note):
        self.ensure_one()
        if self.state != "requested":
            raise UserError("Seule une demande en attente peut être déclinée.")
        self.write({"state": "declined", "cabinet_note": note or False})
        self._notify_porteur(f"Rendez-vous décliné : {self.subject}", note or "Votre consultant vous recontactera.")

    def cancel(self, note=None, by_porteur=False):
        self.ensure_one()
        if self.state not in ("requested", "confirmed"):
            raise UserError("Ce rendez-vous n'est plus à venir.")
        self.write({"state": "cancelled", "cabinet_note": note or self.cabinet_note,
                    "cancelled_by": "porteur" if by_porteur else "cabinet"})
        if by_porteur:
            target = self.consultant_id or self.dossier_id.consultant_id
            self.env["portail.notification"].sudo().notify(
                target, "meeting", f"Rendez-vous annulé par le porteur : {self.subject}", note or "",
                "/axispro/portail/rendez-vous", dossier=self.dossier_id)
        else:
            self._notify_porteur(f"Rendez-vous annulé : {self.subject}", note or "")

    def mark_done(self, minutes=None):
        self.ensure_one()
        if self.state != "confirmed":
            raise UserError("Seul un rendez-vous confirmé peut être tenu.")
        self.write({"state": "done", "minutes": minutes or self.minutes})
        if minutes:
            self._notify_porteur(f"Compte rendu disponible : {self.subject}", "Votre consultant a partagé le compte rendu.")

    def share_minutes(self, minutes):
        """Compte rendu rédigé ou repris après coup : le porteur est prévenu de ce qui change."""
        self.ensure_one()
        if self.state != "done":
            raise UserError("Le compte rendu se rédige une fois le rendez-vous tenu.")
        minutes = minutes or False
        if minutes == (self.minutes or False):
            return
        first = not self.minutes
        self.minutes = minutes
        if not minutes:
            return
        if first:
            self._notify_porteur(f"Compte rendu disponible : {self.subject}", "Votre consultant a partagé le compte rendu.")
        else:
            self._notify_porteur(f"Compte rendu mis à jour : {self.subject}", "Votre consultant a complété le compte rendu.")
