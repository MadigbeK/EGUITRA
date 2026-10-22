"""Agenda du portail : événements et formations du cabinet (inscriptions, liste d'attente) et
rendez-vous entre un porteur et son consultant (demande, confirmation, compte rendu)."""

from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import UserError

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

    def register(self, user, dossier=None, note=None):
        """Inscription du porteur ; liste d'attente quand l'événement est complet."""
        self.ensure_one()
        if not self.registration_open():
            raise UserError("Les inscriptions à cet événement sont closes.")
        Registration = self.env["portail.event.registration"].sudo()
        registration = Registration.search([("event_id", "=", self.id), ("user_id", "=", user.id)], limit=1)
        state = "waitlist" if self.capacity and self.seats_left() == 0 else "registered"
        if registration and registration.state in SEATED + ("waitlist",):
            return registration
        values = {"state": state, "note": (note or "")[:1000] or False, "dossier_id": dossier.id if dossier else False}
        if registration:
            registration.write(values)
        else:
            registration = Registration.create(dict(values, event_id=self.id, user_id=user.id))
        return registration

    def action_publish(self):
        self.write({"state": "published"})
        for event in self:
            event.env["portail.notification"].sudo().notify(
                event._audience_users(), "event", event.name,
                f"{dict(EVENT_KINDS)[event.kind]} le {fields.Datetime.context_timestamp(event, event.start):%d/%m/%Y à %H h %M}",
                "/portail/evenements",
            )

    def action_cancel(self):
        self.write({"state": "cancelled"})
        for event in self:
            users = event.registration_ids.filtered(lambda r: r.state in ("registered", "waitlist")).user_id
            event.env["portail.notification"].sudo().notify(
                users, "event", f"Annulé : {event.name}", "Le cabinet a annulé cet événement.", "/portail/evenements")


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

    _unique = models.Constraint("unique(event_id, user_id)", "Une inscription par porteur et par événement.")

    def cancel(self):
        """Désinscription ; la première personne en liste d'attente prend la place libérée."""
        for registration in self:
            freed = registration.state == "registered"
            registration.state = "cancelled"
            event = registration.event_id
            if freed and event.capacity:
                waiting = event.registration_ids.filtered(lambda r: r.state == "waitlist").sorted("id")[:1]
                if waiting:
                    waiting.state = "registered"
                    self.env["portail.notification"].sudo().notify(
                        waiting.user_id, "event", f"Place confirmée : {event.name}",
                        "Une place s'est libérée : votre inscription est confirmée.", "/portail/evenements")


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
        self.ensure_one()
        if self.state not in ("requested", "confirmed"):
            raise UserError("Ce rendez-vous ne peut plus être confirmé.")
        if not start:
            raise UserError("Indiquez la date du rendez-vous.")
        self.write(dict(values, start=start, state="confirmed"))
        when = fields.Datetime.context_timestamp(self, self.start)
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
