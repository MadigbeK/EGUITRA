"""Événements de l'agenda, leurs participants et leurs séries.

Une série est un événement maître qui porte une règle de récurrence (moteur.py) ; ses occurrences se
calculent à la lecture, sans être enregistrées, comme dans les grands agendas : une série sans fin ne
coûte rien. Une occurrence modifiée ou supprimée devient une exception (series_id, recurrence_date :
début d'origine de l'occurrence remplacée ; cancelled : supprimée). Modifier « cette occurrence » crée
ou modifie l'exception ; « celle-ci et les suivantes » coupe la série en deux ; « toute la série »
modifie le maître (et décale les exceptions avec lui).

Vue d'un événement par un compte (_view) : full (détails), title (titre seul : événement confidentiel lu
par un partage), busy (« Occupé » : événement privé, partage des disponibilités, ressource), None. Le
participant, l'organisateur et le propriétaire de l'agenda voient tout ; le délégué voit tout sauf les
événements privés, à moins d'en avoir reçu le droit. L'administration n'a aucun droit propre.

Ressources : réservées sans conflit possible (verrou par ressource pendant la transaction) ; un refus
dit le créneau libre le plus proche. Conflits des personnes : signalés, jamais bloquants.
"""

import base64
import uuid
from collections import namedtuple
from datetime import timedelta

from odoo import Command, api, fields, models
from odoo.exceptions import AccessError, MissingError, UserError

from odoo.addons.eguitra_api.avatars import avatar_versions
from odoo.addons.eguitra_api.files import ACCEPTED, checked_name, detect_type

from .. import moteur
from .common import (
    ATTENDEE_STATES,
    MAX_ATTENDEES,
    MAX_FILE,
    MAX_FILES,
    MAX_LOCATION,
    MAX_TEXT,
    MAX_TITLE,
    PRIVACY,
    SCOPES,
    SHOW_AS,
    agenda_allowed,
    alarm_label,
    check_agenda_user,
    check_alarms,
    clean_email,
    clean_line,
    clean_text,
    clean_url,
    fmt_when,
    mail_server_ready,
    object_ref,
    parse_date,
    parse_datetime,
    readable_object,
    send_mail,
    shares_company,
)

Occ = namedtuple("Occ", "event start stop key occurrence")

MAX_RANGE_DAYS = 400
MAX_DURATION_DAYS = 366
CONFLICT_OCCURRENCES = 104
TIME_FIELDS = ("start", "stop", "allday")
NOTIFY_FIELDS = ("start", "stop", "allday", "location", "video_url", "rrule")
SERIES_FIELDS = ("name", "location", "video_url", "description", "allday", "tz", "privacy", "show_as", "calendar_id",
                 "organizer_id", "res_model", "res_id", "alarms", "ical_uid")
RESOURCE_LOCK = 4242
REFUSED_IMPORT = ("Ce fichier met à jour un événement de l'agenda que vous ne pouvez pas modifier (privé ou confidentiel) : "
                  "import refusé.")


def iso(value):
    return value.strftime("%Y-%m-%dT%H:%M:%S") if value else None


def _users_of(attendees):
    return attendees.filtered("user_id").user_id


class AgendaEvent(models.Model):
    _name = "eguitra.agenda.event"
    _description = "Événement de l'agenda"
    _order = "start, id"

    calendar_id = fields.Many2one("eguitra.agenda.calendar", "Agenda", required=True, index=True, ondelete="cascade")
    organizer_id = fields.Many2one("res.users", "Organisateur", index=True, ondelete="set null")
    name = fields.Char("Titre", required=True)
    location = fields.Char("Lieu")
    video_url = fields.Char("Visioconférence")
    description = fields.Text("Description")
    allday = fields.Boolean("Journée entière")
    start = fields.Datetime("Début", required=True, index=True)
    stop = fields.Datetime("Fin", required=True, index=True)
    tz = fields.Char("Fuseau", default=moteur.DEFAULT_TZ)
    privacy = fields.Selection(PRIVACY, "Visibilité", required=True, default="public")
    show_as = fields.Selection(SHOW_AS, "Statut", required=True, default="busy")
    category_ids = fields.Many2many("eguitra.agenda.category", "eguitra_agenda_event_category_rel", "event_id",
                                    "category_id", "Catégories")
    attendee_ids = fields.One2many("eguitra.agenda.attendee", "event_id", "Participants")
    resource_ids = fields.Many2many("eguitra.agenda.calendar", "eguitra_agenda_event_resource_rel", "event_id",
                                    "resource_id", "Ressources", domain=[("kind", "=", "resource")])
    attachment_ids = fields.Many2many("ir.attachment", "eguitra_agenda_event_attachment_rel", "event_id",
                                      "attachment_id", "Pièces jointes")
    alarms = fields.Json("Rappels", help="[{minutes, channel}] ; vide : rappels par défaut de chaque participant.")
    # Séries.
    rrule = fields.Char("Récurrence", help="Règle RRULE normalisée (moteur.py) ; vide : événement simple.")
    recurrence_end = fields.Datetime("Fin de la série", index=True, help="Fin de la dernière occurrence ; vide : sans fin.")
    series_id = fields.Many2one("eguitra.agenda.event", "Série", index=True, ondelete="cascade")
    recurrence_date = fields.Datetime("Occurrence remplacée", index=True)
    cancelled = fields.Boolean("Occurrence supprimée", index=True)
    # Fiche de la plateforme dont l'événement vient.
    res_model = fields.Char("Modèle de la fiche", index=True)
    res_id = fields.Integer("Fiche", index=True)
    # iCalendar.
    ical_uid = fields.Char("Identifiant iCalendar", index=True, copy=False)
    ics_uid = fields.Char("Identifiant importé", index=True, copy=False)
    sequence = fields.Integer("Version", default=0)
    # Qui a agi, et pour le compte de qui (délégué).
    created_by_id = fields.Many2one("res.users", "Créé par", ondelete="set null")
    on_behalf_of_id = fields.Many2one("res.users", "Créé pour le compte de", ondelete="set null")
    last_actor_id = fields.Many2one("res.users", "Modifié par", ondelete="set null")
    last_on_behalf_id = fields.Many2one("res.users", "Modifié pour le compte de", ondelete="set null")
    organizer_inactive = fields.Boolean("Organisateur désactivé")

    _exception_unique = models.Constraint("unique(series_id, recurrence_date)", "Une seule exception par occurrence.")

    # ─── Outils ──────────────────────────────────────────────────────────

    def _tz(self):
        self.ensure_one()
        return self.tz if moteur.known_zone(self.tz) else moteur.DEFAULT_TZ

    def _master(self):
        self.ensure_one()
        return self.series_id or self

    def _series(self):
        """Le maître et toutes ses exceptions (ou l'événement simple)."""
        self.ensure_one()
        master = self.sudo()._master()
        return master | self.sudo().search([("series_id", "=", master.id)])

    def _local_dates(self, start, stop):
        """Premier et dernier jour (inclus) d'un événement sur la journée entière, à l'heure de son fuseau."""
        tz = self._tz()
        first = moteur.to_local(start, tz).date()
        last = moteur.to_local(stop, tz).date() - timedelta(days=1)
        return first, max(first, last)

    def _update_recurrence_end(self):
        for ev in self.filtered(lambda e: not e.series_id):
            if not ev.rrule:
                ev.recurrence_end = False
                continue
            last = moteur.last_occurrence(ev.start, ev.rrule, ev._tz())
            ev.recurrence_end = (last + (ev.stop - ev.start)) if last else False

    @api.model
    def _range_domain(self, a, b):
        """Événements simples, exceptions et séries qui peuvent toucher [a, b[."""
        return [("cancelled", "=", False), "|",
                "&", "&", ("rrule", "=", False), ("start", "<", b), ("stop", ">", a),
                "&", "&", ("rrule", "!=", False), ("start", "<", b),
                "|", ("recurrence_end", "=", False), ("recurrence_end", ">", a)]

    def _expand(self, a, b):
        """Occurrences (Occ) de ces enregistrements dans [a, b[ : les exceptions remplacent les occurrences
        qu'elles modifient ou suppriment."""
        events = self.sudo()
        masters = events.filtered(lambda e: e.rrule and not e.series_id)
        replaced = set()
        if masters:
            for x in self.sudo().search([("series_id", "in", masters.ids)]):
                replaced.add((x.series_id.id, x.recurrence_date))
        out = []
        for ev in events:
            if ev.cancelled:
                continue
            if ev.series_id:
                if ev.start < b and ev.stop > a:
                    out.append(Occ(ev, ev.start, ev.stop, f"{ev.series_id.id}:{iso(ev.recurrence_date)}", ev.recurrence_date))
            elif ev.rrule:
                duration = ev.stop - ev.start
                try:
                    starts = moteur.occurrences(ev.start, ev.stop, ev.rrule, ev._tz(), a, b)
                except moteur.RuleError:
                    starts = [ev.start] if ev.start < b and ev.stop > a else []
                for s in starts:
                    if (ev.id, s) not in replaced:
                        out.append(Occ(ev, s, s + duration, f"{ev.id}:{iso(s)}", s))
            elif ev.start < b and ev.stop > a:
                out.append(Occ(ev, ev.start, ev.stop, str(ev.id), None))
        out.sort(key=lambda o: (o.start, o.event.id))
        return out

    def _is_occurrence(self, when):
        self.ensure_one()
        master = self._master()
        if not master.rrule:
            return when == master.start
        try:
            return moteur.is_occurrence(master.start, master.rrule, master._tz(), when)
        except moteur.RuleError:
            return False

    def _first_occurrences(self, count=CONFLICT_OCCURRENCES):
        """Occurrences (début, fin) à contrôler : l'événement, ou les premières de la série (deux ans au plus)."""
        self.ensure_one()
        ev = self.sudo()
        if ev.series_id or not ev.rrule:
            return [(ev.start, ev.stop)]
        horizon = ev.start + timedelta(days=730)
        return [(o.start, o.stop) for o in ev._expand(ev.start, horizon)[:count]]

    # ─── Vue et droits ───────────────────────────────────────────────────

    def _view_via(self, viewer, layer):
        """Vue d'un compte qui atteint l'événement par cet agenda (le sien, un partage, une ressource)."""
        ev = self.sudo()
        level = layer._level_of(viewer)
        if level == "owner":
            return "full"
        if level == "manage":
            if ev.privacy == "private" and not layer._delegation_for(viewer).see_private:
                return "busy"
            return "full"
        if level in ("read", "write"):
            return {"public": "full", "confidential": "title", "private": "busy"}[ev.privacy]
        if level in ("freebusy", "book"):
            return "busy"
        return None

    def _view(self, viewer, layer=None):
        """Meilleure vue du compte : participant, organisateur, ou par un agenda qui montre l'événement (le
        sien, celui du calque ; sans calque, aussi l'agenda personnel de chaque participant qui ne l'a pas
        refusé et les ressources réservées)."""
        self.ensure_one()
        ev = self.sudo()
        if viewer == ev.organizer_id or viewer in ev.attendee_ids.user_id:
            return "full"
        order = {"full": 3, "title": 2, "busy": 1, None: 0}
        views = [ev._view_via(viewer, ev.calendar_id)]
        if layer:
            if layer != ev.calendar_id:
                views.append(ev._view_via(viewer, layer))
        else:
            guests = ev.attendee_ids.filtered(lambda a: a.user_id and a.state != "declined").user_id
            Calendar = self.env["eguitra.agenda.calendar"].sudo()
            others = Calendar.search([("personal_key", "in", [str(i) for i in guests.ids])]) if guests else Calendar
            for lay in (others | ev.resource_ids) - ev.calendar_id:
                views.append(ev._view_via(viewer, lay))
        return max(views, key=lambda v: order[v])

    def _can_edit(self, viewer):
        """Modifier ou supprimer : l'organisateur, le propriétaire de l'agenda, son délégué (pas un
        événement privé sans le droit de les voir), un partage en modification (événements publics)."""
        self.ensure_one()
        ev = self.sudo()
        cal = ev.calendar_id
        if not agenda_allowed(viewer):
            return False
        if viewer == ev.organizer_id or viewer == cal.owner_id:
            return True
        level = cal._level_of(viewer)
        if level == "manage":
            return not (ev.privacy == "private" and not cal._delegation_for(viewer).see_private)
        if level == "write":
            return ev.privacy == "public"
        return False

    def _check_series_rights(self, viewer, since=None):
        """Modifier ou supprimer toute la série (ou sa partie à partir de `since`) : le compte doit pouvoir
        modifier le maître et chacune des exceptions touchées. Une occurrence qu'il peut modifier (rendue
        publique dans une série privée, par exemple) ne lui ouvre jamais le reste de la série."""
        self.ensure_one()
        master = self.sudo()._master()
        domain = [("series_id", "=", master.id)]
        if since:
            domain.append(("recurrence_date", ">=", since))
        if any(not r._can_edit(viewer) for r in master | self.sudo().search(domain)):
            raise AccessError("Vous ne pouvez pas modifier toute cette série : la série ou certaines de ses occurrences "
                              "ne vous sont pas ouvertes. Modifiez cette occurrence seulement.")

    @api.model
    def _check_privacy(self, calendar, viewer, privacy):
        """Visibilité qu'un compte peut donner dans un agenda : un délégué sans le droit de voir les
        événements privés n'en crée ni n'en rend privé ; un partage en modification ne crée et ne garde que
        des événements publics (il ne modifie qu'eux)."""
        level = calendar._level_of(viewer)
        if level == "manage" and privacy == "private" and not calendar._delegation_for(viewer).see_private:
            raise AccessError("Sans le droit de voir les événements privés, vous ne créez pas d'événement privé pour "
                              f"{calendar.sudo().owner_id.name}.")
        if level == "write" and privacy and privacy != "public":
            raise AccessError("Un partage en modification n'ajoute que des événements publics.")

    @api.model
    def _get_for_user(self, event_id, need="busy"):
        """Événement que le compte voit au moins ainsi ; sinon introuvable, sans dire s'il existe."""
        check_agenda_user(self.env)
        try:
            event_id = int(event_id)
        except (TypeError, ValueError) as e:
            raise MissingError("Événement introuvable.") from e
        ev = self.sudo().browse(event_id).exists()
        order = {"full": 3, "title": 2, "busy": 1, None: 0}
        if not ev or order[ev._view(self.env.user)] < order[need]:
            raise MissingError("Événement introuvable.")
        return ev

    def _on_behalf(self, actor):
        """Compte pour lequel l'auteur agit : l'organisateur, quand ce n'est pas lui (délégué, partage)."""
        self.ensure_one()
        organizer = self.sudo().organizer_id
        return organizer if organizer and organizer != actor else self.env["res.users"]

    # ─── Couches d'agenda ────────────────────────────────────────────────

    @api.model
    def _layer_records(self, layer, a, b):
        """Enregistrements d'un agenda pour [a, b[ : ses événements ; pour un agenda personnel, aussi les
        invitations que son propriétaire n'a pas refusées ; pour une ressource, ses réservations."""
        Event = self.sudo()
        rng = self._range_domain(a, b)
        if layer.kind == "resource":
            return Event.search([("resource_ids", "in", layer.ids)] + rng)
        records = Event.search([("calendar_id", "=", layer.id)] + rng)
        if layer.kind == "personal" and layer.owner_id:
            invited = self.env["eguitra.agenda.attendee"].sudo().search(
                [("user_id", "=", layer.owner_id.id), ("state", "!=", "declined")]).event_id
            if invited:
                records |= Event.search([("id", "in", invited.ids)] + rng)
        return records

    @api.model
    def occurrences_for(self, calendars, a, b):
        """Occurrences visibles du compte dans ces agendas : [(Occ, agenda, vue)], sans doublon (une
        invitation qui paraît dans deux agendas cochés n'apparaît qu'une fois, dans le meilleur)."""
        check_agenda_user(self.env)
        me = self.env.user
        if b <= a or (b - a).days > MAX_RANGE_DAYS:
            raise UserError(f"Période de {MAX_RANGE_DAYS} jours au plus.")
        order = {"full": 3, "title": 2, "busy": 1, None: 0}
        best = {}
        for layer in calendars:
            if layer._level_of(me) == "none":
                continue
            for occ in self._layer_records(layer, a, b)._expand(a, b):
                view = occ.event._view(me, layer)
                if view is None:
                    continue
                known = best.get(occ.key)
                if not known or order[view] > order[known[2]]:
                    best[occ.key] = (occ, layer, view)
        return sorted(best.values(), key=lambda r: (r[0].start, r[0].event.id))

    # ─── Disponibilités ──────────────────────────────────────────────────

    @api.model
    def _busy_of(self, user, a, b, exclude=None):
        """Occupations d'un compte dans [a, b[ : [(début, fin, nature, événement ou None)] ; nature : busy,
        tentative, oof (absence du bureau) ou absence (congé approuvé de la RH)."""
        Event = self.sudo()
        rng = self._range_domain(a, b)
        attending = self.env["eguitra.agenda.attendee"].sudo().search(
            [("user_id", "=", user.id), ("state", "!=", "declined")])
        domain = ["|", ("organizer_id", "=", user.id), ("id", "in", attending.event_id.ids)] + rng
        records = Event.search(domain)
        if exclude:
            records -= exclude
        states = {(at.event_id.id): at.state for at in attending}
        out = []
        for occ in records._expand(a, b):
            ev = occ.event
            if ev.show_as == "free":
                continue
            kind = {"oof": "oof", "tentative": "tentative"}.get(ev.show_as, "busy")
            if kind == "busy" and states.get(ev.id) in ("tentative", "needs_action") and ev.organizer_id != user:
                kind = "tentative"
            out.append((occ.start, occ.stop, kind, ev))
        pref = self.env["eguitra.agenda.preference"]._for(user)
        window = pref._ooo_window()
        if window and window[0] < b and window[1] > a:
            out.append((max(window[0], a), min(window[1], b), "oof", None))
        out.extend((s, e, "absence", None) for s, e in self._leaves_of(user, a, b))
        out.sort(key=lambda x: x[0])
        return out

    @api.model
    def _leaves_of(self, user, a, b):
        """Congés approuvés du compte (RH, s'il est lié à un dossier salarié), en journées entières."""
        if "eguitra.rh.leave" not in self.env or not hasattr(user, "_eguitra_employees"):
            return []
        employees = user.sudo()._eguitra_employees()
        if not employees:
            return []
        tz = self.env["eguitra.agenda.preference"]._for(user)._tz()
        first = moteur.to_local(a, tz).date() - timedelta(days=1)
        last = moteur.to_local(b, tz).date() + timedelta(days=1)
        leaves = self.env["eguitra.rh.leave"].sudo().search([
            ("employee_id", "in", employees.ids), ("state", "=", "approved"),
            ("date_from", "<=", last), ("date_to", ">=", first)])
        out = []
        for leave in leaves:
            s = moteur.local_midnight_utc(leave.date_from, tz)
            e = moteur.local_midnight_utc(leave.date_to + timedelta(days=1), tz)
            if s < b and e > a:
                out.append((max(s, a), min(e, b)))
        return out

    @api.model
    def _freebusy_visible_to(self, user, viewer):
        """Les disponibilités du compte sont-elles lisibles de ce collègue ? Oui s'il les ouvre à ses
        collègues (réglage, par défaut), ou si son agenda est partagé ou délégué à ce collègue."""
        if user == viewer:
            return True
        if not agenda_allowed(user) or not shares_company(user, viewer):
            return False
        if self.env["eguitra.agenda.preference"]._for(user).freebusy_visible:
            return True
        personal = self.env["eguitra.agenda.calendar"]._personal_of(user)
        return bool(personal) and personal._level_of(viewer) != "none"

    # ─── Lecture ─────────────────────────────────────────────────────────

    def _occ_row(self, occ, viewer, layer, view):
        """Occurrence telle que le compte la voit dans un agenda."""
        ev = occ.event.sudo()
        master = ev._master()
        busy = view == "busy"
        resource = layer.kind == "resource"
        title = ev.name if not busy else ("Réservé" if resource else "Occupé")
        if busy and resource and ev.privacy == "public" and ev.organizer_id:
            title = f"Réservé par {ev.organizer_id.name}"
        mine = ev.attendee_ids.filtered(lambda a: a.user_id == viewer)[:1]
        row = {
            "key": occ.key, "id": ev.id, "series_id": master.id if master.rrule else None,
            "occurrence": iso(occ.occurrence) if occ.occurrence else None,
            "calendar_id": layer.id, "event_calendar_id": ev.calendar_id.id,
            "start": occ.start, "stop": occ.stop, "allday": ev.allday, "title": title, "view": view,
            "masked": view != "full", "privacy": ev.privacy if not busy else None, "show_as": ev.show_as,
            "recurring": bool(master.rrule), "exception": bool(ev.series_id),
        }
        if ev.allday:
            first, last = ev._local_dates(occ.start, occ.stop)
            row.update(start_date=first, end_date=last)
        if view in ("full", "title"):
            row.update(
                organizer={"id": ev.organizer_id.id, "name": ev.organizer_id.name} if ev.organizer_id else None,
                categories=[{"id": c.id, "name": c.name, "color": c.color} for c in ev.category_ids],
            )
        else:
            row.update(organizer=None, categories=[])
        if view == "full":
            row.update(
                location=ev.location or None, video_url=ev.video_url or None,
                attendees_count=len(ev.attendee_ids), my_response=mine.state if mine else None,
                can_edit=ev._can_edit(viewer), has_link=bool(ev.res_model and ev.res_id),
                resources=[r.name for r in ev.resource_ids],
            )
        else:
            row.update(location=None, video_url=None, attendees_count=None, my_response=None, can_edit=False,
                       has_link=False, resources=[])
        return row

    def _detail(self, viewer, occurrence=None):
        """Fiche d'un événement (ou d'une occurrence) vue par le compte."""
        self.ensure_one()
        ev = self.sudo()
        master = ev._master()
        view = ev._view(viewer)
        start, stop, occ = ev.start, ev.stop, ev.recurrence_date if ev.series_id else None
        if occurrence and master.rrule and not ev.series_id:
            occ = parse_datetime(occurrence, "occurrence")
            if not ev._is_occurrence(occ):
                raise MissingError("Occurrence introuvable.")
            start, stop = occ, occ + (ev.stop - ev.start)
        layer = ev.calendar_id
        key = f"{master.id}:{iso(occ)}" if occ else str(ev.id)
        row = self._occ_row(Occ(ev, start, stop, key, occ), viewer, layer, view)
        # Photos de l'organisateur et des participants internes, lues ensemble (une requête).
        people = ev.organizer_id | ev.attendee_ids.user_id if view == "full" else ev.organizer_id
        avatars = avatar_versions(people, viewer)
        if row.get("organizer"):
            row["organizer"]["avatar"] = avatars.get(ev.organizer_id.id)
        if view != "full":
            row.update(description=None, attendees=[], attachments=[], alarms=None, recurrence=None, link=None,
                       journal=[])
            return row
        tz = ev._tz()
        row.update(
            tz=tz, description=ev.description or None,
            attendees=[a._row(viewer, avatars) for a in ev.attendee_ids],
            resource_ids=[{"id": r.id, "name": r.name, "type": r.resource_type, "capacity": r.capacity}
                          for r in ev.resource_ids],
            attachments=[{"id": a.id, "name": a.name, "mimetype": a.mimetype, "size": a.file_size}
                         for a in ev.attachment_ids],
            alarms=ev.alarms if isinstance(ev.alarms, list) else None,
            alarms_label=", ".join(alarm_label(a["minutes"]) for a in ev.alarms) if isinstance(ev.alarms, list) else None,
            recurrence=({"rule": master.rrule, "spec": moteur.parse_rrule(master.rrule, moteur.to_local(master.start, tz)),
                         "label": moteur.rrule_label(master.rrule, moteur.to_local(master.start, tz))}
                        if master.rrule else None),
            link=object_ref(self.env, viewer, ev.res_model, ev.res_id),
            created_by=ev.created_by_id.name or None, created_on_behalf=ev.on_behalf_of_id.name or None,
            modified_by=ev.last_actor_id.name or None, modified_on_behalf=ev.last_on_behalf_id.name or None,
            modified_at=ev.write_date, organizer_inactive=ev.organizer_inactive,
            can_respond=bool(ev._attendee_for(viewer) or ev._delegated_attendees(viewer)),
            respond_for=[{"user_id": a.user_id.id, "name": a.user_id.name, "state": a.state}
                         for a in ev._delegated_attendees(viewer)],
        )
        return row

    def _attendee_for(self, user):
        self.ensure_one()
        return self.sudo().attendee_ids.filtered(lambda a: a.user_id == user)[:1]

    def _delegated_attendees(self, user):
        """Lignes des participants dont le compte est le délégué (il répond en leur nom)."""
        self.ensure_one()
        owners = self.env["eguitra.agenda.delegation"].sudo().search([("delegate_id", "=", user.id)]).owner_id
        return self.sudo().attendee_ids.filtered(lambda a: a.user_id and a.user_id in owners)

    # ─── Saisie ──────────────────────────────────────────────────────────

    @api.model
    def _parse(self, data, tz, partial, base=None):
        """Saisie de l'écran -> (valeurs, horaires, participants, ressources, récurrence).

        horaires : (début, fin, journée entière) ou None ; participants, ressources : listes ou None (non
        transmis) ; récurrence : dictionnaire de saisie, False (aucune), ou None (non transmise)."""
        vals = {}
        if not partial or "name" in data:
            vals["name"] = clean_line(data.get("name"), MAX_TITLE)
            if not vals["name"]:
                raise UserError("Donnez un titre à l'événement.")
        if "location" in data:
            vals["location"] = clean_line(data.get("location"), MAX_LOCATION) or False
        if "video_url" in data:
            vals["video_url"] = clean_url(data.get("video_url"))
        if "description" in data:
            vals["description"] = clean_text(data.get("description"), MAX_TEXT) or False
        if "privacy" in data:
            if data["privacy"] not in dict(PRIVACY):
                raise UserError("Visibilité : publique, privée ou confidentielle.")
            vals["privacy"] = data["privacy"]
        if "show_as" in data:
            if data["show_as"] not in dict(SHOW_AS):
                raise UserError("Statut : occupé, libre, provisoire ou absent du bureau.")
            vals["show_as"] = data["show_as"]
        if "alarms" in data:
            vals["alarms"] = check_alarms(data["alarms"])
            if vals["alarms"] is None:
                vals["alarms"] = False
        if "category_ids" in data:
            ids = [int(i) for i in (data.get("category_ids") or [])]
            cats = self.env["eguitra.agenda.category"]._for(self.env.user).filtered(lambda c: c.id in ids)
            vals["category_ids"] = [Command.set(cats.ids)]
        if "res_model" in data or "res_id" in data:
            model, res_id = data.get("res_model") or False, data.get("res_id") or False
            if model or res_id:
                if readable_object(self.env, self.env.user, model, res_id) is None:
                    raise UserError("Fiche liée introuvable, ou que vous ne lisez pas.")
                vals.update(res_model=model, res_id=int(res_id))
            else:
                vals.update(res_model=False, res_id=False)
        times = None
        if not partial or any(k in data for k in ("start", "stop", "allday", "start_date", "end_date")):
            allday = bool(data.get("allday", base.allday if base else False))
            if allday:
                first = parse_date(data.get("start_date") or (data.get("start") or "")[:10], "premier jour")
                last = parse_date(data.get("end_date") or data.get("start_date") or (data.get("start") or "")[:10],
                                  "dernier jour")
                if last < first:
                    raise UserError("Le dernier jour suit le premier.")
                start = moteur.local_midnight_utc(first, tz)
                stop = moteur.local_midnight_utc(last + timedelta(days=1), tz)
            else:
                start = parse_datetime(data.get("start"), "début")
                stop = parse_datetime(data.get("stop"), "fin")
                if stop <= start:
                    raise UserError("L'événement finit après son début.")
            if stop - start > timedelta(days=MAX_DURATION_DAYS):
                raise UserError("Un événement dure un an au plus.")
            times = (start, stop, allday)
        attendees = data.get("attendees") if "attendees" in data else None
        if attendees is not None and not isinstance(attendees, list):
            raise UserError("Participants illisibles.")
        resources = data.get("resource_ids") if "resource_ids" in data else None
        if resources is not None:
            try:
                resources = [int(r) for r in resources]
            except (TypeError, ValueError) as e:
                raise UserError("Ressources illisibles.") from e
        recurrence = data["recurrence"] if "recurrence" in data else None
        if recurrence is None and "recurrence" in data:
            recurrence = False
        return vals, times, attendees, resources, recurrence

    def _rule_from(self, spec, start, tz):
        if not spec:
            return False
        try:
            return moteur.build_rrule(spec, moteur.to_local(start, tz))
        except moteur.RuleError as e:
            raise UserError(str(e)) from e

    @api.model
    def _align_to_rule(self, start, stop, rule, tz):
        """Une série commence à sa première occurrence : un premier jour saisi hors de la règle (un lundi pour
        « le 2e mardi du mois ») glisse au premier jour qui la suit."""
        firsts = moteur.first_occurrences(start, rule, tz, 1)
        if not firsts:
            raise UserError("Cette récurrence ne donne aucune occurrence : vérifiez sa date de fin.")
        return firsts[0], firsts[0] + (stop - start)

    @api.model
    def _internal_user_by_email(self, email):
        """Compte interne actif dont l'adresse, mise en minuscules, est égale à celle saisie (déjà nettoyée et
        en minuscules) : comparaison en égalité, sans motif (« % » et « _ » n'y sont que des caractères).
        Une adresse portée par plusieurs comptes actifs est ambiguë : aucun compte (invité externe), pour
        qu'une adresse partagée ne fasse jamais entrer l'invitation dans l'agenda du mauvais compte."""
        Users = self.env["res.users"].sudo()
        Users.flush_model(["partner_id", "share", "active"])
        self.env["res.partner"].sudo().flush_model(["email"])
        self.env.cr.execute(
            "SELECT u.id FROM res_users u JOIN res_partner p ON p.id = u.partner_id "
            "WHERE lower(p.email) = %s AND u.share IS NOT TRUE AND u.active ORDER BY u.id LIMIT 2",
            (email,))
        rows = self.env.cr.fetchall()
        return Users.browse(rows[0][0]) if len(rows) == 1 else Users

    def _attendee_commands(self, items, organizer):
        """Participants saisis -> commandes de la liste, en gardant les réponses déjà reçues. Rend
        (commandes, comptes ajoutés, lignes externes ajoutées, lignes retirées)."""
        self.ensure_one()
        ev = self.sudo()
        if len(items) > MAX_ATTENDEES:
            raise UserError(f"{MAX_ATTENDEES} participants au plus.")
        existing = {a._identity(): a for a in ev.attendee_ids}
        wanted, commands = {}, []
        Users = self.env["res.users"].sudo()
        # Le carnet se lit sous l'identité du compte (règles des sociétés), jamais en sudo.
        me = self.env.user
        Partner = self.env["res.partner"].with_user(me).with_context(allowed_company_ids=me.sudo().company_ids.ids)
        for item in items:
            if not isinstance(item, dict):
                raise UserError("Participant illisible.")
            required = item.get("required", True) is not False
            if item.get("user_id"):
                user = Users.browse(int(item["user_id"])).exists()
                if not user or not agenda_allowed(user):
                    raise UserError("Un participant interne n'a pas d'agenda (compte inactif, sans profil ou porteur).")
                if user == organizer:
                    continue
                if not shares_company(self.env.user, user) and not shares_company(organizer, user):
                    raise AccessError(f"Vous ne partagez aucune société avec {user.name}.")
                key = ("user", user.id)
                vals = {"user_id": user.id, "name": user.name, "email": user.email or False, "required": required}
            elif item.get("partner_id"):
                partner = Partner.browse(int(item["partner_id"])).exists()
                try:
                    partner.check_access("read")
                except AccessError:
                    partner = Partner
                if not partner or not partner.email:
                    raise UserError("Ce contact du carnet n'a pas d'adresse électronique.")
                email = clean_email(partner.email)
                key = ("email", email)
                vals = {"partner_id": partner.id, "name": clean_line(partner.name, 120), "email": email,
                        "required": required}
            elif item.get("email"):
                email = clean_email(item["email"])
                internal = self._internal_user_by_email(email)
                # Un compte d'une société que ni l'invitant ni l'organisateur ne partagent est invité comme
                # une adresse extérieure : la réponse ne dit pas si l'adresse appartient à un compte interne.
                if internal and agenda_allowed(internal) and internal != organizer and (
                        shares_company(me, internal) or shares_company(organizer, internal)):
                    key = ("user", internal.id)
                    vals = {"user_id": internal.id, "name": internal.name, "email": internal.email, "required": required}
                else:
                    key = ("email", email)
                    vals = {"name": clean_line(item.get("name"), 120) or email, "email": email, "required": required}
            else:
                raise UserError("Participant sans compte, contact ni adresse électronique.")
            wanted[key] = vals
        added_users = self.env["res.users"]
        added_ext = []
        for key, vals in wanted.items():
            line = existing.get(key)
            if line:
                if line.required != vals["required"]:
                    commands.append(Command.update(line.id, {"required": vals["required"]}))
            else:
                commands.append(Command.create(vals))
                if key[0] == "user":
                    added_users |= Users.browse(key[1])
                else:
                    added_ext.append(vals)
        removed = ev.attendee_ids.filtered(lambda a: a._identity() not in wanted)
        commands += [Command.delete(a.id) for a in removed]
        return commands, added_users, added_ext, removed

    # ─── Ressources et conflits ──────────────────────────────────────────

    def _check_resources(self, resources=None):
        """Ressources de l'événement (ou de la série) : actives, réservables par le compte, à la bonne
        capacité, et libres. Verrou par ressource jusqu'à la fin de la transaction : deux réservations
        simultanées du même créneau ne passent pas toutes les deux."""
        self.ensure_one()
        ev = self.sudo()
        resources = (resources if resources is not None else ev.resource_ids).sorted("id")
        if not resources:
            return
        me = self.env.user
        for res in resources:
            if res.kind != "resource" or not res.active or res._level_of(me) == "none":
                raise UserError(f"Ressource indisponible : {res.name}.")
            people = 1 + len(ev.attendee_ids)
            if res.capacity and people > res.capacity:
                raise UserError(f"{res.name} accueille {res.capacity} personne{'s' if res.capacity > 1 else ''} ; "
                                f"l'événement en compte {people}. Choisissez une autre ressource.")
            self.env.cr.execute("SELECT pg_advisory_xact_lock(%s, %s)", (RESOURCE_LOCK, res.id))
        self.env.flush_all()
        series = ev._series()
        occurrences = ev._first_occurrences()
        if not occurrences:
            return
        a, b = occurrences[0][0], occurrences[-1][1]
        Event = self.sudo()
        for res in resources:
            others = Event.search([("resource_ids", "in", res.ids)] + self._range_domain(a, b)) - series
            busy = [(o.start, o.stop) for o in others._expand(a, b)]
            for s, e in occurrences:
                if moteur.overlaps(busy, s, e):
                    hours = res._hours_for_slots() or self.env["eguitra.agenda.preference"]._for(me)._work()
                    tz = ev._tz()
                    window = (s - timedelta(days=15), e + timedelta(days=15))
                    near_busy = [(o.start, o.stop) for o in others._expand(*window)]
                    free = moteur.nearest_free(near_busy, s, e - s, work=hours, tz=tz, now=fields.Datetime.now())
                    proposal = f" Créneau libre le plus proche : {fmt_when(free, free + (e - s), False, tz)}." if free else ""
                    raise UserError(f"{res.name} est déjà réservée {fmt_when(s, e, ev.allday, tz)}.{proposal}")

    def _people_conflicts(self, users):
        """Occupations des personnes qui chevauchent l'événement (signalées, non bloquantes). Seulement pour les
        personnes dont le compte connecté lit les disponibilités, comme par /agenda/freebusy : une occupation,
        une absence du bureau ou un congé n'est jamais révélé à qui ne le verrait pas."""
        self.ensure_one()
        viewer = self.env.user
        users = users.filtered(lambda u: self._freebusy_visible_to(u, viewer))
        ev = self.sudo()
        series = ev._series()
        occurrences = ev._first_occurrences(20)
        if not occurrences or not users:
            return []
        a, b = occurrences[0][0], occurrences[-1][1]
        tz = ev._tz()
        out = []
        for user in users:
            busy = [x for x in self._busy_of(user, a, b, exclude=series) if x[2] != "free"]
            for s, e in occurrences:
                clash = next((x for x in busy if x[0] < e and x[1] > s), None)
                if clash:
                    reason = {"oof": "absent du bureau", "absence": "en congé", "tentative": "provisoire"}.get(clash[2],
                                                                                                             "occupé")
                    out.append({"user_id": user.id, "name": user.name, "start": s, "stop": e, "reason": clash[2],
                                "message": f"{user.name} est {reason} {fmt_when(s, e, ev.allday, tz)}."})
                    break
        return out

    # ─── Création ────────────────────────────────────────────────────────

    @api.model
    def create_event(self, data):
        """Événement saisi par le compte dans un agenda qu'il gère (le sien, celui de son mandant, un
        partage en modification). Rend (événement, conflits, avertissements)."""
        check_agenda_user(self.env)
        me = self.env.user
        Calendar = self.env["eguitra.agenda.calendar"]
        cal = Calendar._get_for_user(data.get("calendar_id"), "freebusy") if data.get("calendar_id") \
            else Calendar._ensure_personal(me)
        level = cal._level_of(me)
        if level not in ("owner", "manage", "write"):
            raise AccessError("Vous ne pouvez pas ajouter d'événement dans cet agenda.")
        if cal.kind == "personal":
            organizer = cal.owner_id
        else:
            organizer = cal.owner_id if level == "manage" else me
        tz = self.env["eguitra.agenda.preference"]._for(organizer)._tz()
        if data.get("tz"):
            if not moteur.known_zone(data["tz"]):
                raise UserError("Fuseau horaire inconnu.")
            tz = data["tz"]
        vals, times, attendees, resources, recurrence = self._parse(data, tz, partial=False)
        start, stop, allday = times
        on_behalf = organizer if organizer != me else self.env["res.users"]
        self._check_privacy(cal, me, vals.get("privacy") or "public")
        resource_records = self._resource_records(resources or [])
        rule = self._rule_from(recurrence, start, tz)
        if rule:
            start, stop = self._align_to_rule(start, stop, rule, tz)
        ev = self.sudo().create(dict(vals, calendar_id=cal.id, organizer_id=organizer.id, start=start, stop=stop,
                                     allday=allday, tz=tz, ical_uid=f"{uuid.uuid4()}@nimova",
                                     rrule=rule, created_by_id=me.id,
                                     on_behalf_of_id=on_behalf.id or False, last_actor_id=me.id,
                                     last_on_behalf_id=on_behalf.id or False))
        ev._update_recurrence_end()
        added, ext = self.env["res.users"], []
        if attendees:
            commands, added, ext, _removed = ev._attendee_commands(attendees, organizer)
            ev.attendee_ids = commands
        if resource_records:
            ev.resource_ids = [Command.set(resource_records.ids)]
        ev._check_resources(resource_records)
        warnings = ev._apply_out_of_office(ev.attendee_ids.filtered(lambda a: a.user_id in added))
        conflicts = ev._people_conflicts(organizer | added)
        mail = ev._notify_invitation(added, ext)
        self.env["eguitra.agenda.journal"]._log(cal, "event_create", event=ev, on_behalf=on_behalf or None)
        return ev, conflicts, warnings, mail

    def _apply_out_of_office(self, lines):
        """Participants absents du bureau pendant l'événement : refus automatique (s'ils l'ont choisi, pour
        un événement simple), sinon simple indication ; l'organisateur est prévenu dans les deux cas."""
        self.ensure_one()
        ev = self.sudo()
        warnings = []
        occurrences = ev._first_occurrences(20)
        if not occurrences:
            return warnings
        tz = ev._tz()
        Notification = self.env["eguitra.agenda.notification"]
        for line in lines.filtered("user_id"):
            pref = self.env["eguitra.agenda.preference"]._for(line.user_id)
            window = pref._ooo_window()
            if not window or not any(window[0] < e and window[1] > s for s, e in occurrences):
                continue
            message = pref.ooo_message or ""
            until = fmt_when(window[0], window[1], False, tz)
            text = f"{line.user_id.name} est absent du bureau ({until})" + (f" : {message}" if message else ".")
            if pref.ooo_auto_decline and not ev.rrule:
                line.write({"state": "declined", "auto_declined": True, "comment": message or "Absent du bureau.",
                            "responded_at": fields.Datetime.now()})
                text += " L'invitation est refusée d'office."
            warnings.append({"user_id": line.user_id.id, "message": text})
            if ev.organizer_id:
                Notification._push(ev.organizer_id, "ooo", f"{line.user_id.name} est absent du bureau",
                                   f"{text}\nÉvénement : {ev.name}.", event=ev._master())
        return warnings

    # ─── Modification ────────────────────────────────────────────────────

    def update_event(self, data, scope="all", occurrence=None):
        """Modification d'un événement, d'une occurrence (« this »), de celle-ci et des suivantes
        (« following ») ou de toute la série (« all »). Rend (événement modifié, conflits, avertissements)."""
        self.ensure_one()
        me = self.env.user
        ev = self.sudo()
        if not ev._can_edit(me):
            raise AccessError("Vous ne pouvez pas modifier cet événement.")
        master = ev._master()
        tz = master._tz()
        if "tz" in data and data["tz"] and data["tz"] != tz:
            if not moteur.known_zone(data["tz"]):
                raise UserError("Fuseau horaire inconnu.")
            tz = data["tz"]
        vals, times, attendees, resources, recurrence = self._parse(data, tz, partial=True, base=ev)
        if "privacy" in vals:
            self._check_privacy(master.calendar_id, me, vals["privacy"])
        on_behalf = ev._on_behalf(me)
        if resources is not None:
            self._resource_records(resources)
        recurring = bool(master.rrule)
        if not recurring:
            result = ev._apply(vals, times, attendees, resources, recurrence, tz)
        else:
            scope = scope if scope in SCOPES else "all"
            occ = ev.recurrence_date if ev.series_id else (parse_datetime(occurrence, "occurrence") if occurrence else None)
            if scope in ("this", "following") and occ is None:
                raise UserError("Précisez l'occurrence à modifier.")
            if occ is not None and not ev.series_id and not master._is_occurrence(occ):
                raise MissingError("Occurrence introuvable.")
            if scope == "following" and occ is not None and occ <= master.start:
                scope = "all"
            if scope == "following":
                master._check_series_rights(me, since=occ)
            elif scope == "all":
                master._check_series_rights(me)
            if scope == "this":
                exception = ev if ev.series_id else master._exception_for(occ)
                result = exception._apply(vals, times, attendees, resources, None, tz)
            elif scope == "following":
                new = master._split(occ)
                result = new._apply(vals, times, attendees, resources, recurrence, tz, occ_start=new.start, series=True)
            else:
                occ_start = ev.start if ev.series_id else (occ or master.start)
                result = master._apply(vals, times, attendees, resources, recurrence, tz, occ_start=occ_start,
                                       series=True)
        target, conflicts, warnings, mail = result
        target.write({"last_actor_id": me.id, "last_on_behalf_id": on_behalf.id or False})
        self.env["eguitra.agenda.journal"]._log(target.calendar_id, "event_update", event=target._master(),
                                                on_behalf=on_behalf or None, note=_scope_note(scope if recurring else None))
        return target, conflicts, warnings, mail

    @api.model
    def _resource_records(self, ids):
        """Ressources demandées : existantes, actives, réservables par le compte ; sinon refus."""
        Calendar = self.env["eguitra.agenda.calendar"].sudo()
        records = Calendar.browse(list(dict.fromkeys(ids))).exists()
        if len(records) != len(set(ids)) or records.filtered(
                lambda r: r.kind != "resource" or not r.active or r._level_of(self.env.user) == "none"):
            raise UserError("Ressource inconnue ou indisponible.")
        return records

    def _exception_for(self, occ):
        """Exception d'une occurrence de la série, créée à l'image du maître."""
        self.ensure_one()
        master = self.sudo()
        found = self.sudo().search([("series_id", "=", master.id), ("recurrence_date", "=", occ)], limit=1)
        if found:
            if found.cancelled:
                raise MissingError("Cette occurrence est supprimée.")
            return found
        vals = {f: master[f].id if f in ("calendar_id", "organizer_id") else master[f] for f in SERIES_FIELDS}
        vals.update(series_id=master.id, recurrence_date=occ, start=occ, stop=occ + (master.stop - master.start),
                    rrule=False, sequence=master.sequence, created_by_id=master.created_by_id.id,
                    on_behalf_of_id=master.on_behalf_of_id.id,
                    category_ids=[Command.set(master.category_ids.ids)],
                    resource_ids=[Command.set(master.resource_ids.ids)],
                    attendee_ids=[Command.create(a._copy_values()) for a in master.attendee_ids])
        return self.sudo().create(vals)

    def _split(self, occ):
        """Coupe la série avant l'occurrence `occ` : le maître s'arrête juste avant, une nouvelle série
        reprend à `occ` avec ce qui reste de la règle. Les exceptions de la seconde partie sont retirées."""
        self.ensure_one()
        master = self.sudo()
        tz = master._tz()
        n_before = moteur.count_before(master.start, master.rrule, tz, occ)
        parts = moteur.rule_parts(master.rrule)
        if "COUNT" in parts:
            old_rule = moteur.with_count(master.rrule, max(n_before, 1))
            new_rule = moteur.with_count(master.rrule, max(int(parts["COUNT"]) - n_before, 1))
        else:
            old_rule = moteur.with_until(master.rrule, moteur.to_local(occ, tz) - timedelta(seconds=1))
            new_rule = master.rrule
        self.sudo().search([("series_id", "=", master.id), ("recurrence_date", ">=", occ)]).unlink()
        vals = {f: master[f].id if f in ("calendar_id", "organizer_id") else master[f] for f in SERIES_FIELDS}
        vals.update(start=occ, stop=occ + (master.stop - master.start), rrule=new_rule, ical_uid=f"{uuid.uuid4()}@nimova",
                    sequence=0, created_by_id=self.env.uid, on_behalf_of_id=master._on_behalf(self.env.user).id or False,
                    category_ids=[Command.set(master.category_ids.ids)],
                    resource_ids=[Command.set(master.resource_ids.ids)],
                    attendee_ids=[Command.create(a._copy_values()) for a in master.attendee_ids])
        new = self.sudo().create(vals)
        master.write({"rrule": old_rule, "sequence": master.sequence + 1})
        (master | new)._update_recurrence_end()
        return new

    def _apply(self, vals, times, attendees, resources, recurrence, tz, occ_start=None, series=False):
        """Applique la saisie à cet enregistrement (événement simple, exception ou maître). Pour un maître
        (series), les horaires saisis sont ceux de l'occurrence modifiée (occ_start) : la série se décale
        d'autant, ses exceptions aussi ; titre, lieu, participants et ressources valent pour toutes ses
        occurrences. Rend (enregistrement, conflits, avertissements, courriels)."""
        self.ensure_one()
        ev = self.sudo()
        before = {f: ev[f] for f in NOTIFY_FIELDS}
        old_tz = ev._tz()
        write = dict(vals)
        if tz != ev.tz:
            write["tz"] = tz
        exceptions = self.sudo().search([("series_id", "=", ev.id)]) if series else self.sudo().browse()
        delta = timedelta(0)
        if times:
            start, stop, allday = times
            if series and ev.rrule:
                reference = occ_start or ev.start
                local_delta = moteur.to_local(start, tz) - moteur.to_local(reference, old_tz)
                new_start = moteur.to_utc(moteur.to_local(ev.start, old_tz) + local_delta, tz)
                write.update(start=new_start, stop=new_start + (stop - start), allday=allday)
                delta = local_delta
                days = moteur.to_local(start, tz).date() - moteur.to_local(reference, old_tz).date()
                if days.days and recurrence is None:
                    write["rrule"] = _shift_days(ev.rrule, days.days)
            else:
                write.update(start=start, stop=stop, allday=allday)
        if recurrence is not None and not ev.series_id:
            write["rrule"] = self._rule_from(recurrence, write.get("start", ev.start), tz)
            if write["rrule"]:
                write["start"], write["stop"] = self._align_to_rule(write.get("start", ev.start),
                                                                    write.get("stop", ev.stop), write["rrule"], tz)
        elif write.get("rrule") and "start" in write:
            # Jours d'une règle hebdomadaire décalés avec la série : son début reste sur une occurrence.
            write["start"], write["stop"] = self._align_to_rule(write["start"], write["stop"], write["rrule"], tz)
        time_changed =any(k in write and write[k] != before.get(k) for k in ("start", "stop", "allday", "rrule"))
        if time_changed:
            write["sequence"] = ev.sequence + 1
        if write:
            ev.write(write)
        if series and exceptions:
            if not ev.rrule:
                # La série redevient un événement simple : ses occurrences modifiées ou supprimées disparaissent.
                exceptions.unlink()
                exceptions = self.sudo().browse()
            else:
                if delta:
                    # Les exceptions suivent la série ; dans l'ordre qui libère chaque place avant de la prendre
                    # (unicité de l'occurrence remplacée), une écriture à la fois.
                    for x in exceptions.sorted("recurrence_date", reverse=delta > timedelta(0)):
                        x.recurrence_date = moteur.to_utc(moteur.to_local(x.recurrence_date, old_tz) + delta, tz)
                        x.flush_recordset(["recurrence_date"])
                stale = exceptions.filtered(lambda x: not ev._is_occurrence(x.recurrence_date))
                stale.unlink()
                exceptions -= stale
                common = {k: v for k, v in vals.items() if k != "alarms"}
                if common:
                    exceptions.filtered(lambda x: not x.cancelled).write(common)
        if not ev.series_id:
            ev._update_recurrence_end()
        added, ext, removed = self.env["res.users"], [], self.env["eguitra.agenda.attendee"]
        removed_info = []
        if attendees is not None:
            commands, added, ext, removed = ev._attendee_commands(attendees, ev.organizer_id)
            removed_info = [(a.user_id, a.email, a.name) for a in removed]
            ev.attendee_ids = commands
            for x in exceptions.filtered(lambda x: not x.cancelled):
                x_commands, _a, _e, _r = x._attendee_commands(attendees, ev.organizer_id)
                x.attendee_ids = x_commands
        if resources is not None:
            resource_ids = self._resource_records(resources).ids
            ev.resource_ids = [Command.set(resource_ids)]
            if exceptions:
                exceptions.filtered(lambda x: not x.cancelled).write({"resource_ids": [Command.set(resource_ids)]})
        if time_changed:
            ev.attendee_ids.filtered(lambda a: a.state != "needs_action" and not a.auto_declined).write(
                {"state": "needs_action", "responded_at": False, "comment": False})
            ev.attendee_ids.write({"proposed_start": False, "proposed_stop": False, "proposal_comment": False})
        if time_changed or resources is not None or attendees is not None:
            ev._check_resources()
            for x in exceptions.filtered(lambda x: not x.cancelled and x.resource_ids):
                x._check_resources()
        warnings = ev._apply_out_of_office(ev.attendee_ids.filtered(lambda a: a.user_id in added or time_changed))
        if time_changed:
            people = ev.organizer_id | _users_of(ev.attendee_ids)
        else:
            people = (ev.organizer_id | added) if added else self.env["res.users"]
        conflicts = ev._people_conflicts(people)
        mail = ev._notify_invitation(added, ext)
        changed = [k for k in NOTIFY_FIELDS if ev[k] != before.get(k)]
        if changed:
            mail = _merge_mail(mail, ev._notify_update(exclude=added))
        if removed_info:
            mail = _merge_mail(mail, ev._notify_cancel_to(removed_info))
        return ev, conflicts, warnings, mail

    # ─── Suppression ─────────────────────────────────────────────────────

    def delete_event(self, scope="all", occurrence=None):
        """Suppression d'un événement, d'une occurrence, de celle-ci et des suivantes, ou de la série."""
        self.ensure_one()
        me = self.env.user
        ev = self.sudo()
        if not ev._can_edit(me):
            raise AccessError("Vous ne pouvez pas supprimer cet événement.")
        master = ev._master()
        on_behalf = ev._on_behalf(me)
        cal = master.calendar_id
        mail = None
        if not master.rrule:
            mail = ev._notify_cancel()
            ev.unlink()
        else:
            scope = scope if scope in SCOPES else "all"
            occ = ev.recurrence_date if ev.series_id else (parse_datetime(occurrence, "occurrence") if occurrence else None)
            if scope in ("this", "following") and occ is None:
                raise UserError("Précisez l'occurrence à supprimer.")
            if occ is not None and not ev.series_id and not master._is_occurrence(occ):
                raise MissingError("Occurrence introuvable.")
            if scope == "following" and occ <= master.start:
                scope = "all"
            if scope == "following":
                master._check_series_rights(me, since=occ)
            elif scope == "all":
                master._check_series_rights(me)
            if scope == "this":
                x = ev if ev.series_id else master._exception_for(occ)
                mail = x._notify_cancel(occurrence=occ)
                x.write({"cancelled": True})
            elif scope == "following":
                mail = master._notify_cancel(occurrence=occ, following=True)
                tz = master._tz()
                n_before = moteur.count_before(master.start, master.rrule, tz, occ)
                parts = moteur.rule_parts(master.rrule)
                rule = (moteur.with_count(master.rrule, max(n_before, 1)) if "COUNT" in parts
                        else moteur.with_until(master.rrule, moteur.to_local(occ, tz) - timedelta(seconds=1)))
                self.sudo().search([("series_id", "=", master.id), ("recurrence_date", ">=", occ)]).unlink()
                master.write({"rrule": rule, "sequence": master.sequence + 1})
                master._update_recurrence_end()
            else:
                mail = master._notify_cancel()
                master._series().unlink()
        self.env["eguitra.agenda.journal"]._log(cal, "event_delete", on_behalf=on_behalf or None,
                                                note=_scope_note(scope if master.exists() and master.rrule else None))
        return mail

    # ─── Réponses ────────────────────────────────────────────────────────

    def respond(self, state, comment=None, scope="all", occurrence=None, for_user=None):
        """Réponse d'un participant (ou de son délégué, en son nom) : accepter, refuser, provisoire."""
        self.ensure_one()
        me = self.env.user
        ev = self.sudo()
        if state not in ("accepted", "declined", "tentative"):
            raise UserError("Réponse : accepter, refuser ou provisoire.")
        who = self.env["res.users"].sudo().browse(int(for_user)).exists() if for_user else me
        if not who:
            raise UserError("Compte inconnu.")
        if who != me and not self.env["eguitra.agenda.delegation"].sudo().search_count(
                [("owner_id", "=", who.id), ("delegate_id", "=", me.id)]):
            raise AccessError(f"Vous ne répondez pas au nom de {who.name}.")
        master = ev._master()
        target = ev
        if master.rrule and not ev.series_id and scope == "this":
            occ = parse_datetime(occurrence, "occurrence") if occurrence else None
            if occ is None or not master._is_occurrence(occ):
                raise MissingError("Occurrence introuvable.")
            target = master._exception_for(occ)
        elif ev.series_id and scope == "all":
            target = master
        line = target.attendee_ids.filtered(lambda a: a.user_id == who)[:1]
        if not line:
            raise MissingError("Vous n'êtes pas invité à cet événement." if who == me else f"{who.name} n'est pas invité.")
        values = {"state": state, "comment": clean_text(comment, 500) or False, "responded_at": fields.Datetime.now(),
                  "responded_by_id": me.id if me != who else False, "auto_declined": False}
        line.write(values)
        if target == master and master.rrule:
            self.sudo().search([("series_id", "=", master.id), ("cancelled", "=", False)]).attendee_ids.filtered(
                lambda a: a.user_id == who).write(values)
        label = dict(ATTENDEE_STATES)[state].lower()
        by = f" (réponse de {me.name} pour son compte)" if me != who else ""
        if target.organizer_id:
            self.env["eguitra.agenda.notification"]._push(
                target.organizer_id, "response", f"{who.name} : {label} « {target.name} »",
                (f"Commentaire : {values['comment']}" if values["comment"] else "") + by, event=master,
                occurrence=target.recurrence_date or None, on_behalf=who if me != who else None)
        personal = self.env["eguitra.agenda.calendar"]._ensure_personal(who)
        self.env["eguitra.agenda.journal"]._log(personal, "event_respond", event=master,
                                                on_behalf=who if me != who else None, note=label)
        return target

    def propose(self, start, stop, comment=None, occurrence=None, for_user=None):
        """Un participant propose un autre horaire à l'organisateur."""
        self.ensure_one()
        me = self.env.user
        who = self.env["res.users"].sudo().browse(int(for_user)).exists() if for_user else me
        if who != me and not self.env["eguitra.agenda.delegation"].sudo().search_count(
                [("owner_id", "=", who.id), ("delegate_id", "=", me.id)]):
            raise AccessError(f"Vous ne proposez pas d'horaire au nom de {who.name}.")
        ev = self.sudo()
        master = ev._master()
        target = ev
        if master.rrule and not ev.series_id and occurrence:
            occ = parse_datetime(occurrence, "occurrence")
            if not master._is_occurrence(occ):
                raise MissingError("Occurrence introuvable.")
            target = master._exception_for(occ)
        line = target.attendee_ids.filtered(lambda a: a.user_id == who)[:1]
        if not line:
            raise MissingError("Vous n'êtes pas invité à cet événement.")
        start, stop = parse_datetime(start, "début proposé"), parse_datetime(stop, "fin proposée")
        if stop <= start:
            raise UserError("L'horaire proposé finit après son début.")
        line.write({"proposed_start": start, "proposed_stop": stop, "proposal_comment": clean_text(comment, 500) or False})
        if target.organizer_id:
            self.env["eguitra.agenda.notification"]._push(
                target.organizer_id, "proposal", f"{who.name} propose un autre horaire pour « {target.name} »",
                fmt_when(start, stop, False, target._tz()) + (f"\n{line.proposal_comment}" if line.proposal_comment else ""),
                event=master, occurrence=target.recurrence_date or None)
        return target

    def accept_proposal(self, attendee_id):
        """L'organisateur retient l'horaire proposé par un participant (l'événement ou l'occurrence bouge)."""
        self.ensure_one()
        ev = self.sudo()
        if not ev._can_edit(self.env.user):
            raise AccessError("Seul l'organisateur (ou qui gère son agenda) retient un horaire.")
        line = ev.attendee_ids.filtered(lambda a: a.id == int(attendee_id))[:1]
        if not line or not line.proposed_start:
            raise MissingError("Proposition introuvable.")
        data = {"start": line.proposed_start, "stop": line.proposed_stop, "allday": False}
        if ev.series_id:
            return ev.with_env(self.env).update_event(data, scope="this")
        if not ev.rrule:
            return ev.with_env(self.env).update_event(data)
        raise UserError("Une proposition se retient sur une occurrence : ouvrez l'occurrence concernée.")

    def set_external_response(self, attendee_id, state):
        """L'organisateur note la réponse d'un participant externe (reçue par courriel)."""
        self.ensure_one()
        ev = self.sudo()
        if not ev._can_edit(self.env.user):
            raise AccessError("Seul l'organisateur (ou qui gère son agenda) note une réponse.")
        if state not in dict(ATTENDEE_STATES):
            raise UserError("Réponse inconnue.")
        line = ev.attendee_ids.filtered(lambda a: a.id == int(attendee_id) and not a.user_id)[:1]
        if not line:
            raise MissingError("Participant externe introuvable.")
        line.write({"state": state, "responded_at": fields.Datetime.now(), "responded_by_id": self.env.uid})
        return ev

    # ─── Pièces jointes ──────────────────────────────────────────────────

    def add_attachments(self, files):
        self.ensure_one()
        ev = self.sudo()
        if not ev._can_edit(self.env.user):
            raise AccessError("Vous ne pouvez pas modifier cet événement.")
        if len(ev.attachment_ids) + len(files) > MAX_FILES:
            raise UserError(f"{MAX_FILES} pièces jointes au plus par événement.")
        created = self.env["ir.attachment"]
        for filename, content in files:
            if len(content) > MAX_FILE:
                raise UserError(f"{filename} : fichier trop volumineux (20 Mo au plus).")
            mimetype = detect_type(content)
            if not mimetype:
                raise UserError(f"{filename} : format refusé. Formats acceptés : {ACCEPTED}.")
            created |= self.env["ir.attachment"].sudo().create({
                "name": checked_name(filename, mimetype), "datas": base64.b64encode(content), "mimetype": mimetype,
                "res_model": self._name, "res_id": ev.id,
            })
        ev.attachment_ids = [Command.link(a.id) for a in created]
        ev.write({"last_actor_id": self.env.uid, "last_on_behalf_id": ev._on_behalf(self.env.user).id or False})
        return created

    def remove_attachment(self, attachment_id):
        self.ensure_one()
        ev = self.sudo()
        if not ev._can_edit(self.env.user):
            raise AccessError("Vous ne pouvez pas modifier cet événement.")
        attachment = ev.attachment_ids.filtered(lambda a: a.id == int(attachment_id))
        if not attachment:
            raise MissingError("Pièce jointe introuvable.")
        ev.attachment_ids = [Command.unlink(attachment.id)]
        attachment.unlink()
        return True

    # ─── Invitations et courriels ────────────────────────────────────────

    def _when_text(self, start=None, stop=None):
        self.ensure_one()
        return fmt_when(start or self.start, stop or self.stop, self.allday, self._tz())

    def _summary_lines(self):
        self.ensure_one()
        ev = self.sudo()
        master = ev._master()
        lines = [f"Quand : {ev._when_text()}"]
        if master.rrule:
            lines.append("Récurrence : " + moteur.rrule_label(master.rrule, moteur.to_local(master.start, master._tz())))
        if ev.location:
            lines.append(f"Lieu : {ev.location}")
        if ev.video_url:
            lines.append(f"Visioconférence : {ev.video_url}")
        if ev.resource_ids:
            lines.append("Ressources : " + ", ".join(ev.resource_ids.mapped("name")))
        if ev.organizer_id:
            lines.append(f"Organisateur : {ev.organizer_id.name}")
        return lines

    def _ics(self, method="REQUEST", status=None, occurrence=None, mask=False):
        """Fichier iCalendar de l'événement (ou de la série et de ses exceptions)."""
        self.ensure_one()
        ev = self.sudo()
        master = ev._master()
        if ev.series_id or occurrence or not master.rrule:
            rows = [ev._ics_row(occurrence=occurrence, mask=mask, status=status)]
        else:
            rows = master._ics_series(mask=mask, status=status)
        return moteur.ics_calendar(rows, method=method, tz=master._tz())

    def _ics_series(self, mask=False, status=None):
        self.ensure_one()
        master = self.sudo()
        exceptions = self.sudo().search([("series_id", "=", master.id)])
        row = master._ics_row(mask=mask, status=status)
        row["rrule"] = master.rrule
        row["exdates"] = exceptions.filtered("cancelled").mapped("recurrence_date")
        rows = [row]
        for x in exceptions.filtered(lambda x: not x.cancelled):
            rows.append(dict(x._ics_row(mask=mask, status=status), recurrence_id=x.recurrence_date, uid=master.ical_uid))
        return rows

    def _ics_row(self, occurrence=None, mask=False, status=None):
        self.ensure_one()
        ev = self.sudo()
        start, stop = ev.start, ev.stop
        if occurrence and not ev.series_id:
            start, stop = occurrence, occurrence + (ev.stop - ev.start)
        row = {
            "uid": ev.ical_uid or f"{ev.id}@nimova", "sequence": ev.sequence, "start": start, "stop": stop,
            "allday": ev.allday, "tz": ev._tz(), "show_as": ev.show_as, "status": status or "confirmed",
            "created": ev.create_date, "modified": ev.write_date,
        }
        if ev.allday:
            row["start_date"], row["end_date"] = ev._local_dates(start, stop)
        if occurrence and not ev.series_id:
            row["recurrence_id"] = occurrence
        elif ev.series_id:
            # Occurrence modifiée : même identifiant que sa série, repérée par son début d'origine.
            row.update(uid=ev.series_id.ical_uid or row["uid"], recurrence_id=ev.recurrence_date)
        if mask:
            row.update(summary="Occupé", privacy="private")
            return row
        row.update(summary=ev.name, location=ev.location or None, description=ev.description or None,
                   url=ev.video_url or None, privacy=ev.privacy,
                   organizer={"name": ev.organizer_id.name, "email": ev.organizer_id.email} if ev.organizer_id else None,
                   attendees=[{"name": a.name, "email": a.email, "state": a.state, "required": a.required}
                              for a in ev.attendee_ids if a.email])
        return row

    def _notify_invitation(self, users, externals):
        """Invitations : dans l'application (et aux délégués qui reçoivent les invitations) et par courriel,
        avec le fichier iCalendar, aux participants internes et externes."""
        self.ensure_one()
        ev = self.sudo()
        if not users and not externals:
            return None
        master = ev._master()
        Notification = self.env["eguitra.agenda.notification"]
        by = ev.organizer_id.name or self.env.user.name
        body = "\n".join(ev._summary_lines())
        sent = 0
        ics = ev._ics("REQUEST")
        for user in users:
            line = ev.attendee_ids.filtered(lambda a: a.user_id == user)[:1]
            if line.state == "declined" and line.auto_declined:
                continue
            Notification._push(user, "invitation", f"Invitation de {by} : {ev.name}", body, event=master,
                               occurrence=ev.recurrence_date or None)
            delegates = self.env["eguitra.agenda.delegation"].sudo().search(
                [("owner_id", "=", user.id), ("receive_invitations", "=", True)]).delegate_id
            Notification._push(delegates, "invitation", f"Invitation pour {user.name} : {ev.name}",
                               body + f"\nInvitation reçue par {user.name}, dont vous gérez l'agenda.", event=master,
                               on_behalf=user)
            if user.email and send_mail(self.env, user.email, f"Invitation : {ev.name}", f"Invitation de {by}",
                                        [ev.name, body], ics=ics, res=master):
                sent += 1
        for ext in externals:
            if send_mail(self.env, ext["email"], f"Invitation : {ev.name}", f"Invitation de {by}",
                         [f"Bonjour {ext.get('name') or ''},".replace(" ,", ","), f"{by} vous invite : {ev.name}.", body,
                          "Répondez depuis votre agenda (fichier joint) ou par retour de courriel."],
                         ics=ics, res=master):
                sent += 1
        return {"sent": sent, "mail_server": mail_server_ready(self.env)}

    def _notify_update(self, exclude=None):
        """Horaire, lieu ou récurrence modifiés : les participants qui n'ont pas refusé sont prévenus."""
        self.ensure_one()
        ev = self.sudo()
        master = ev._master()
        lines = ev.attendee_ids.filtered(lambda a: a.state != "declined" and (not a.user_id or a.user_id not in (exclude or [])))
        if not lines:
            return None
        body = "\n".join(ev._summary_lines())
        ics = ev._ics("REQUEST")
        sent = 0
        Notification = self.env["eguitra.agenda.notification"]
        for line in lines:
            if line.user_id:
                Notification._push(line.user_id, "update", f"Modifié : {ev.name}", body + "\nVotre réponse est à "
                                   "renouveler si l'horaire a changé.", event=master, occurrence=ev.recurrence_date or None)
            if line.email and send_mail(self.env, line.email, f"Modifié : {ev.name}", "Événement modifié",
                                        [ev.name, body], ics=ics, res=master):
                sent += 1
        return {"sent": sent, "mail_server": mail_server_ready(self.env)}

    def _notify_cancel(self, occurrence=None, following=False):
        """Annulation : participants prévenus dans l'application et par courriel (iCalendar CANCEL)."""
        self.ensure_one()
        ev = self.sudo()
        lines = ev.attendee_ids.filtered(lambda a: a.state != "declined")
        if not lines:
            return None
        return ev._notify_cancel_to([(a.user_id, a.email, a.name) for a in lines], occurrence, following)

    def _notify_cancel_to(self, people, occurrence=None, following=False):
        self.ensure_one()
        ev = self.sudo()
        master = ev._master()
        when = ev._when_text(occurrence, occurrence + (ev.stop - ev.start)) if occurrence else ev._when_text()
        what = (f"Annulé à partir du {moteur.to_local(occurrence, ev._tz()):%d/%m/%Y}" if following and occurrence
                else "Annulé")
        body = f"{what} : {ev.name}\nQuand : {when}"
        ics = moteur.ics_calendar([dict(ev._ics_row(occurrence=occurrence if not following else None),
                                        status="cancelled")], method="CANCEL", tz=ev._tz())
        sent = 0
        Notification = self.env["eguitra.agenda.notification"]
        for user, email, _name in people:
            if user:
                Notification._push(user, "cancel", f"{what} : {ev.name}", body, event=master if master.exists() else None)
            if email and send_mail(self.env, email, f"{what} : {ev.name}", what, [body], ics=ics, ics_name="annulation.ics"):
                sent += 1
        return {"sent": sent, "mail_server": mail_server_ready(self.env)}

    def _notify_cancelled_all(self):
        for ev in self:
            ev._notify_cancel()

    # ─── Rappels et récapitulatif (tâches planifiées) ────────────────────

    @api.model
    def _cron_reminders(self, now=None):
        """Rappels dus (application, courriel) : un rappel ne part qu'une fois, même si la tâche passe deux
        fois ou rattrape un passage manqué (journal eguitra.agenda.reminder.log). Rend le nombre envoyé."""
        now = (now or fields.Datetime.now()).replace(microsecond=0)
        horizon = now + timedelta(minutes=4 * 7 * 24 * 60 + 1)
        a = now - timedelta(minutes=10)
        events = self.sudo().search(self._range_domain(a, horizon))
        Pref = self.env["eguitra.agenda.preference"]
        Notification = self.env["eguitra.agenda.notification"]
        sent = 0
        for occ in events._expand(a, horizon):
            ev = occ.event
            users = (ev.organizer_id | ev.attendee_ids.filtered(lambda x: x.state != "declined").user_id)
            for user in users.filtered(agenda_allowed):
                alarms = ev.alarms if isinstance(ev.alarms, list) else Pref._for(user)._alarms()
                for alarm in alarms:
                    fire = occ.start - timedelta(minutes=alarm["minutes"])
                    if not (fire <= now < max(occ.start, fire + timedelta(minutes=10))):
                        continue
                    if not self._claim_reminder(ev, occ.start, user, alarm):
                        continue
                    title = f"Rappel : {ev.name}, {ev._when_text(occ.start, occ.stop)}"
                    body = "\n".join(ev._summary_lines()[1:])
                    mailed = alarm["channel"] == "email" and send_mail(
                        self.env, user.email, title, "Rappel", [ev.name, ev._when_text(occ.start, occ.stop), body])
                    if not mailed:
                        # Rappel dans l'application, ou par courriel sans serveur ni adresse : dans l'application.
                        Notification.with_context(agenda_system=True)._push(
                            user, "reminder", title, body, event=ev._master(), occurrence=occ.occurrence)
                    sent += 1
        return sent

    @api.model
    def _claim_reminder(self, event, occurrence, user, alarm):
        """Réserve l'envoi d'un rappel : vrai la première fois seulement (contrainte d'unicité)."""
        self.env["eguitra.agenda.reminder.log"].flush_model()
        self.env.cr.execute(
            """
            INSERT INTO eguitra_agenda_reminder_log (event_id, occurrence, user_id, minutes, channel, create_uid,
                                                     create_date, write_uid, write_date)
            VALUES (%s, %s, %s, %s, %s, %s, now() at time zone 'UTC', %s, now() at time zone 'UTC')
            ON CONFLICT (event_id, occurrence, user_id, minutes, channel) DO NOTHING
            RETURNING id
            """,
            (event.id, occurrence, user.id, alarm["minutes"], alarm["channel"], self.env.uid, self.env.uid),
        )
        return bool(self.env.cr.fetchone())

    @api.model
    def _day_occurrences(self, user, day, tz):
        """Occurrences de la journée locale `day` dans l'agenda personnel du compte (invitations comprises)."""
        a = moteur.local_midnight_utc(day, tz)
        b = moteur.local_midnight_utc(day + timedelta(days=1), tz)
        layer = self.env["eguitra.agenda.calendar"]._ensure_personal(user)
        return self._layer_records(layer, a, b)._expand(a, b)

    @api.model
    def _cron_digest(self, now=None):
        """Récapitulatif de la journée, le matin, à l'heure choisie par chacun (une fois par jour : la date
        du dernier envoi est retenue). Par courriel ; dans l'application sans serveur de courrier."""
        now = now or fields.Datetime.now()
        prefs = self.env["eguitra.agenda.preference"].sudo().search([("digest", "=", True)])
        done = 0
        for pref in prefs:
            user = pref.user_id
            if not agenda_allowed(user):
                continue
            tz = pref._tz()
            local = moteur.to_local(now, tz)
            if local.hour < (pref.digest_hour or 7) or pref.last_digest_date == local.date():
                continue
            occs = self._day_occurrences(user, local.date(), tz)
            lines = []
            for occ in occs:
                ev = occ.event
                hour = "Journée" if ev.allday else f"{moteur.to_local(occ.start, tz):%H:%M}"
                where = f" ({ev.location})" if ev.location else ""
                lines.append(f"{hour} : {ev.name}{where}")
            title = f"Votre journée du {local:%d/%m/%Y}"
            body = "\n".join(lines) if lines else "Aucun événement aujourd'hui."
            if not (user.email and send_mail(self.env, user.email, title, title, [body])):
                self.env["eguitra.agenda.notification"].with_context(agenda_system=True)._push(user, "digest", title, body)
            pref.last_digest_date = local.date()
            done += 1
        return done

    # ─── Import iCalendar ────────────────────────────────────────────────

    @api.model
    def import_ics(self, calendar, content):
        """Import d'un fichier iCalendar dans un agenda que le compte gère : événements créés ou mis à jour
        (même identifiant), sans inviter personne, aux mêmes règles qu'une saisie : visibilité permise au
        compte, durée, récurrence admise et qui donne une occurrence ; un événement déjà présent n'est mis à
        jour que si le compte peut le modifier, sinon l'import est refusé. Rend {created, updated, skipped,
        warnings}."""
        me = self.env.user
        if calendar._level_of(me) not in ("owner", "manage", "write"):
            raise AccessError("Vous ne pouvez pas importer dans cet agenda.")
        tz = self.env["eguitra.agenda.preference"]._for(calendar.owner_id or me)._tz()
        try:
            items = moteur.parse_ics(content, tz)
        except moteur.RuleError as e:
            raise UserError(str(e)) from e
        if len(items) > 500:
            raise UserError("500 événements au plus par import.")
        organizer = calendar.owner_id if calendar.kind == "personal" else me
        result = {"created": 0, "updated": 0, "skipped": 0, "warnings": []}
        masters = {}
        Event = self.sudo()
        for item in sorted(items, key=lambda i: i.get("recurrence_id") is not None):
            uid = (item.get("uid") or "")[:200] or None
            try:
                video = clean_url(item.get("url"))
            except UserError:
                video = False
            values = {
                "name": clean_line(item.get("summary"), MAX_TITLE) or "Sans titre",
                "location": clean_line(item.get("location"), MAX_LOCATION) or False,
                "description": clean_text((item.get("description") or "")[:MAX_TEXT], MAX_TEXT) or False,
                "video_url": video,
                "privacy": item.get("privacy") or "public", "show_as": item.get("show_as") or "busy",
                "allday": bool(item.get("allday")), "start": item["start"], "stop": item["stop"],
                "tz": item.get("tz") if moteur.known_zone(item.get("tz")) else tz,
            }
            if item.get("rrule_dropped"):
                result["warnings"].append(f"« {values['name']} » : récurrence non prise en charge, importé une fois.")
            self._check_privacy(calendar, me, values["privacy"])
            if values["stop"] - values["start"] > timedelta(days=MAX_DURATION_DAYS):
                raise UserError(f"« {values['name']} » dure plus d'un an : import refusé.")
            if item.get("recurrence_id"):
                master = masters.get(uid)
                if not master or not master._is_occurrence(item["recurrence_id"]):
                    result["skipped"] += 1
                    continue
                existing = Event.search([("series_id", "=", master.id), ("recurrence_date", "=", item["recurrence_id"])],
                                        limit=1)
                if existing:
                    if not existing._can_edit(me):
                        raise AccessError(REFUSED_IMPORT)
                    existing.write(dict(values, cancelled=False))
                else:
                    Event.create(dict(values, series_id=master.id, recurrence_date=item["recurrence_id"],
                                      calendar_id=calendar.id, organizer_id=organizer.id, ical_uid=master.ical_uid,
                                      created_by_id=me.id))
                continue
            values["rrule"] = item.get("rrule") or False
            if values["rrule"]:
                # Même règle qu'une saisie : la série commence à sa première occurrence, et en a au moins une.
                try:
                    values["start"], values["stop"] = self._align_to_rule(values["start"], values["stop"],
                                                                          values["rrule"], values["tz"])
                except UserError as e:
                    raise UserError(f"« {values['name']} » : {e.args[0]}") from e
            existing = Event.search([("calendar_id", "=", calendar.id), ("ics_uid", "=", uid), ("series_id", "=", False)],
                                    limit=1) if uid else Event.browse()
            if existing:
                if not existing._can_edit(me):
                    raise AccessError(REFUSED_IMPORT)
                existing.write(dict(values, last_actor_id=me.id))
                ev = existing
                result["updated"] += 1
            else:
                ev = Event.create(dict(values, calendar_id=calendar.id, organizer_id=organizer.id, ics_uid=uid,
                                       ical_uid=f"{uuid.uuid4()}@nimova", created_by_id=me.id,
                                       on_behalf_of_id=organizer.id if organizer != me else False))
                result["created"] += 1
            ev._update_recurrence_end()
            if ev.rrule:
                for ex in item.get("exdates") or []:
                    if ev._is_occurrence(ex) and not Event.search_count([("series_id", "=", ev.id),
                                                                          ("recurrence_date", "=", ex)]):
                        Event.create({"series_id": ev.id, "recurrence_date": ex, "cancelled": True, "name": ev.name,
                                      "calendar_id": calendar.id, "organizer_id": organizer.id, "start": ex,
                                      "stop": ex + (ev.stop - ev.start), "ical_uid": ev.ical_uid, "tz": ev.tz})
            if uid:
                masters[uid] = ev
        self.env["eguitra.agenda.journal"]._log(calendar, "import",
                                                note=f"{result['created']} créé(s), {result['updated']} mis à jour")
        return result

    # ─── Recherche ───────────────────────────────────────────────────────

    @api.model
    def search_events(self, query, limit=50):
        """Événements dont le titre, le lieu ou la description contiennent le texte, dans les agendas que le
        compte lit en détail (les siens, délégués, partagés en lecture) et ses invitations ; l'occurrence
        la plus proche d'aujourd'hui."""
        check_agenda_user(self.env)
        me = self.env.user
        query = clean_line(query, 80)
        if len(query) < 2:
            return []
        Calendar = self.env["eguitra.agenda.calendar"]
        readable = [cal for cal, level in Calendar._visible(me) if level in ("owner", "manage", "write", "read")]
        invited = self.env["eguitra.agenda.attendee"].sudo().search([("user_id", "=", me.id)]).event_id
        domain = ["&", ("cancelled", "=", False), "|", ("calendar_id", "in", [c.id for c in readable]),
                  ("id", "in", invited.ids), "|", "|", ("name", "ilike", query), ("location", "ilike", query),
                  ("description", "ilike", query)]
        now = fields.Datetime.now()
        rows = []
        for ev in self.sudo().search(domain, limit=200, order="start desc"):
            if ev._view(me) != "full":
                continue
            occ = Occ(ev, ev.start, ev.stop, str(ev.id), ev.recurrence_date if ev.series_id else None)
            if ev.rrule and not ev.series_id:
                upcoming = ev._expand(now, now + timedelta(days=MAX_RANGE_DAYS)) or ev._expand(ev.start, ev.start + timedelta(days=1))
                if upcoming:
                    occ = upcoming[0]
            rows.append(self._occ_row(occ, me, ev.calendar_id, "full"))
        rows.sort(key=lambda r: abs((r["start"] - now).total_seconds()))
        return rows[:limit]


def _shift_days(rule, days):
    """Série déplacée d'un nombre de jours : les jours d'une règle hebdomadaire suivent ; une règle
    mensuelle ou annuelle se ressaisit."""
    parts = moteur.rule_parts(rule)
    if parts.get("FREQ") == "DAILY":
        return rule
    if parts.get("FREQ") == "WEEKLY" and parts.get("BYDAY"):
        days_ = [moteur.DAYS[(moteur.DAYS.index(d[-2:]) + days) % 7] for d in parts["BYDAY"].split(",")]
        ordered = [d for d in moteur.DAYS if d in days_]
        return ";".join(f"{k}={','.join(ordered) if k == 'BYDAY' else v}" for k, v in parts.items())
    raise UserError("Pour déplacer toute la série à un autre jour, modifiez sa récurrence (jour du mois ou rang).")


def _scope_note(scope):
    return {"this": "cette occurrence", "following": "cette occurrence et les suivantes", "all": "toute la série"}.get(scope)


def _merge_mail(a, b):
    if not a:
        return b
    if not b:
        return a
    return {"sent": a["sent"] + b["sent"], "mail_server": a["mail_server"] or b["mail_server"]}


class AgendaAttendee(models.Model):
    _name = "eguitra.agenda.attendee"
    _description = "Participant d'un événement"
    _order = "required desc, id"

    event_id = fields.Many2one("eguitra.agenda.event", "Événement", required=True, index=True, ondelete="cascade")
    user_id = fields.Many2one("res.users", "Compte", index=True, ondelete="cascade")
    partner_id = fields.Many2one("res.partner", "Contact", ondelete="set null")
    name = fields.Char("Nom")
    email = fields.Char("Adresse électronique")
    required = fields.Boolean("Obligatoire", default=True)
    state = fields.Selection(ATTENDEE_STATES, "Réponse", required=True, default="needs_action", index=True)
    comment = fields.Text("Commentaire")
    responded_at = fields.Datetime("Répondu le")
    responded_by_id = fields.Many2one("res.users", "Réponse donnée par", ondelete="set null",
                                      help="Délégué qui a répondu au nom du participant.")
    auto_declined = fields.Boolean("Refusée d'office (absence du bureau)")
    proposed_start = fields.Datetime("Début proposé")
    proposed_stop = fields.Datetime("Fin proposée")
    proposal_comment = fields.Text("Commentaire de la proposition")

    _user_unique = models.Constraint("unique(event_id, user_id)", "Ce compte est déjà invité.")

    def _identity(self):
        self.ensure_one()
        return ("user", self.user_id.id) if self.user_id else ("email", (self.email or "").lower())

    def _copy_values(self):
        self.ensure_one()
        return {k: (self[k].id if k in ("user_id", "partner_id", "responded_by_id") else self[k])
                for k in ("user_id", "partner_id", "name", "email", "required", "state", "comment", "responded_at",
                          "responded_by_id", "auto_declined")}

    def _row(self, viewer, avatars=None):
        """Participant vu par le compte. avatars : versions des photos des comptes (avatars.avatar_versions) ;
        un contact ou une adresse n'en a pas."""
        self.ensure_one()
        a = self.sudo()
        return {
            "id": a.id, "kind": "user" if a.user_id else ("partner" if a.partner_id else "email"),
            "user_id": a.user_id.id or None, "partner_id": a.partner_id.id or None, "name": a.name or a.email,
            "avatar": (avatars or {}).get(a.user_id.id) if a.user_id else None,
            "email": a.email or None, "required": a.required, "state": a.state, "comment": a.comment or None,
            "responded_at": a.responded_at or None, "responded_by": a.responded_by_id.name or None,
            "auto_declined": a.auto_declined, "me": a.user_id == viewer,
            "proposal": {"start": a.proposed_start, "stop": a.proposed_stop, "comment": a.proposal_comment or None}
            if a.proposed_start else None,
        }
