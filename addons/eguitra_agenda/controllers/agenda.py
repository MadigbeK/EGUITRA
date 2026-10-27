"""Agenda : routes /agenda/... (contrat : apps/web/lib/agenda.ts).

Ouvertes aux profils internes de l'agenda (common.AGENDA_PROFILES) : ni le porteur de projet, ni le
conducteur, ni l'auditeur, ni un compte sans profil (403 partout). Tout s'exécute sous l'identité du
compte : chaque lecture passe par le niveau d'accès du compte à l'agenda (propriétaire, délégué, partage,
ressource) et par la visibilité de l'événement ; chaque écriture, par les méthodes des modèles, qui
contrôlent avant d'écrire. L'administration n'a pas d'accès propre aux agendas des autres : elle gère les
ressources, les délégations posées pour un dirigeant et le retrait d'un compte désactivé.

Le compteur de l'en-tête (/agenda/notifications/unread) est relu toutes les 30 secondes, comme celui de
la discussion : hors du journal des accès, sauf refus ou erreur.
"""

from datetime import datetime, time, timedelta

from odoo import fields, http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.admin import _scope_domain
from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require, sudo_env
from odoo.addons.eguitra_api.files import ACCEPTED, detect_type

from .. import moteur
from ..models.booking import booking_open, platform_settings
from ..models.calendar import LEVEL_LABELS
from ..models.common import (
    AGENDA_PROFILES,
    MAX_FILE,
    MAX_FILES,
    RESOURCE_TYPES,
    SHARE_LEVELS,
    agenda_allowed,
    agenda_groups,
    check_agenda_user,
    clean_line,
    is_admin,
    mail_server_ready,
    parse_date,
    parse_datetime,
    shares_company,
)

AGENDA = AGENDA_PROFILES
ADMIN = ("admin",)
POSE = ("admin", "direction")
MAX_SLOT_DAYS = 31
MAX_PLANNING_DAYS = 14


def _cal():
    return request.env["eguitra.agenda.calendar"]


def _ev():
    return request.env["eguitra.agenda.event"]


def _me():
    return request.env.user


def _user_ref(user):
    return {"id": user.id, "name": user.name} if user else None


def _ids(value, field):
    """Liste d'identifiants : tableau JSON ou « 1,2,3 » dans l'adresse."""
    if value in (None, ""):
        return []
    items = value.split(",") if isinstance(value, str) else value
    if not isinstance(items, list):
        raise ApiError(400, "invalid_parameter", f"Paramètre {field} invalide.")
    try:
        return [int(v) for v in items if str(v).strip()]
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"Paramètre {field} invalide.") from e


def _moment(kw, key, label):
    value = kw.get(key)
    if not value:
        raise ApiError(400, "missing_fields", f"Paramètre {label} manquant.", fields=[key])
    if len(str(value)) == 10:
        return datetime.combine(parse_date(value, label), time.min)
    return parse_datetime(value, label)


def _calendar_row(cal, level, me):
    cal = cal.sudo()
    row = {"id": cal.id, "name": cal.name, "color": cal.color, "kind": cal.kind, "level": level,
           "level_label": LEVEL_LABELS[level], "owner": _user_ref(cal.owner_id), "mine": cal.owner_id == me,
           "can_write": level in ("owner", "manage", "write")}
    if cal.kind == "resource":
        row.update(resource_type=cal.resource_type, resource_label=dict(RESOURCE_TYPES).get(cal.resource_type),
                   capacity=cal.capacity, location=cal.location or None, description=cal.description or None,
                   company=cal.company_id.name or None,
                   open_hours={d: [[moteur.hhmm(a), moteur.hhmm(b)] for a, b in r] for d, r in (cal.open_hours or {}).items()}
                   if cal.open_hours else None)
    if level == "manage":
        d = cal._delegation_for(me)
        row["delegation"] = {"see_private": d.see_private, "receive_invitations": d.receive_invitations}
    if level == "owner" and cal.kind != "resource":
        row["shares"] = [{"id": s.id, "user": _user_ref(s.user_id), "level": s.level,
                          "level_label": dict(SHARE_LEVELS)[s.level]} for s in cal.share_ids]
    return row


def _delegation_row(d):
    d = d.sudo()
    return {"id": d.id, "owner": _user_ref(d.owner_id), "delegate": _user_ref(d.delegate_id),
            "receive_invitations": d.receive_invitations, "see_private": d.see_private,
            "granted_by": _user_ref(d.granted_by_id), "reason": d.reason or None, "since": d.create_date}


def _result(ev, conflicts, warnings, mail, me, occurrence=None):
    return {"event": ev._detail(me, occurrence) if ev.exists() else None, "conflicts": conflicts,
            "warnings": warnings, "mail": mail or {"sent": 0, "mail_server": mail_server_ready(request.env)}}


def _unread_counts():
    me = _me()
    unread = request.env["eguitra.agenda.notification"].sudo().search_count(
        [("user_id", "=", me.id), ("read_at", "=", False)])
    pending = request.env["eguitra.agenda.attendee"].sudo().search_count([
        ("user_id", "=", me.id), ("state", "=", "needs_action"), ("event_id.cancelled", "=", False),
        "|", ("event_id.stop", ">", fields.Datetime.now()), ("event_id.rrule", "!=", False)])
    return {"unread": unread, "invitations": pending}


def _admin_settings():
    settings = platform_settings(request.env)
    return dict(settings, mail_server=mail_server_ready(request.env), open=booking_open(request.env))


def _uploads():
    uploads = [u for u in request.httprequest.files.getlist("file") if u and u.filename]
    if len(uploads) > MAX_FILES:
        raise ApiError(422, "business_rule", f"{MAX_FILES} pièces jointes au plus par événement.")
    files = []
    for upload in uploads:
        content = upload.read(MAX_FILE + 1)
        if len(content) > MAX_FILE:
            raise ApiError(413, "too_large", f"{upload.filename} : fichier trop volumineux (20 Mo au plus).")
        if not detect_type(content):
            raise ApiError(415, "unsupported_type", f"{upload.filename} : format refusé. Formats acceptés : {ACCEPTED}.")
        files.append((upload.filename, content))
    return files


class EguitraAgendaController(http.Controller):
    # ─── Session de l'agenda ─────────────────────────────────────────────

    @api_route("/agenda/me", profiles=AGENDA)
    def me(self, **_kw):
        """Tout ce que l'écran affiche au démarrage : réglages, agendas visibles, catégories, sources,
        délégations, abonnement, droits."""
        check_agenda_user(request.env)
        me = _me()
        Cal = _cal()
        personal = Cal._ensure_personal(me)
        pref = request.env["eguitra.agenda.preference"]._for(me)
        Delegation = request.env["eguitra.agenda.delegation"].sudo()
        sub = request.env["eguitra.agenda.subscription"].sudo().search([("user_id", "=", me.id)], limit=1)
        Sources = request.env["eguitra.agenda.source"]
        chosen = {row[0] for row in Sources.chosen(me)}
        return {
            "user": {"id": me.id, "name": me.name, "email": me.email or None},
            "personal_calendar_id": personal.id,
            "preferences": pref._row(),
            "calendars": [_calendar_row(c, level, me) for c, level in Cal._visible(me)],
            "categories": [{"id": c.id, "name": c.name, "color": c.color, "mine": c.owner_id == me}
                           for c in request.env["eguitra.agenda.category"]._for(me)],
            "sources": [{"code": code, "label": label, "color": color, "default": default, "shown": code in chosen}
                        for code, label, color, default in Sources.available(me)],
            "delegations_given": [_delegation_row(d) for d in Delegation.search([("owner_id", "=", me.id)])],
            "delegations_received": [_delegation_row(d) for d in Delegation.search([("delegate_id", "=", me.id)])],
            "subscription": sub._row() if sub else {"active": False},
            "booking": {"open": booking_open(request.env)},
            "mail_server": mail_server_ready(request.env),
            "rights": {"admin": is_admin(me), "pose_delegation": bool(set(me._eguitra_profiles()) & set(POSE))},
            "unread": request.env["eguitra.agenda.notification"].sudo().search_count(
                [("user_id", "=", me.id), ("read_at", "=", False)]),
        }

    @api_route("/agenda/preferences", methods=("PATCH",), profiles=AGENDA)
    def preferences(self, **_kw):
        check_agenda_user(request.env)
        pref = request.env["eguitra.agenda.preference"]._get_or_create(_me())
        return pref.update_from(read_json())._row()

    @api_route("/agenda/users", profiles=AGENDA)
    def users(self, **kw):
        """Collègues qui ont un agenda et partagent au moins une société avec soi."""
        check_agenda_user(request.env)
        me = _me().sudo()
        query = clean_line(kw.get("q"), 80)
        domain = [("share", "=", False), ("id", "!=", me.id), ("company_ids", "in", me.company_ids.ids),
                  ("group_ids", "in", agenda_groups(request.env))]
        if query:
            domain += ["|", ("name", "ilike", query), ("login", "ilike", query)]
        limit = int_arg(kw, "limit", 20, 1, 100)
        users = request.env["res.users"].sudo().search(domain, limit=limit * 2, order="name, id")
        return [{"id": u.id, "name": u.name, "email": u.email or None} for u in users.filtered(agenda_allowed)[:limit]]

    @api_route("/agenda/contacts", profiles=AGENDA)
    def contacts(self, **kw):
        """Contacts du carnet (avec une adresse électronique), lus sous l'identité du compte."""
        check_agenda_user(request.env)
        query = clean_line(kw.get("q"), 80)
        if len(query) < 2:
            return []
        Partner = request.env["res.partner"].with_context(active_test=True)
        partners = Partner.search([("email", "!=", False), ("user_ids", "=", False), "|", ("name", "ilike", query),
                                   ("email", "ilike", query)], limit=20, order="name")
        return [{"id": p.id, "name": p.name, "email": p.email} for p in partners]

    # ─── Agendas, partages, catégories ───────────────────────────────────

    @api_route("/agenda/calendars", methods=("POST",), profiles=AGENDA)
    def create_calendar(self, **_kw):
        data = read_json()
        (name,) = require(data, "name")
        cal = _cal().create_team(name, data.get("color"))
        return _calendar_row(cal, "owner", _me())

    @api_route("/agenda/calendars/<int:calendar_id>", methods=("PATCH",), profiles=AGENDA)
    def update_calendar(self, calendar_id, **_kw):
        cal = _cal()._get_for_user(calendar_id)
        cal.with_env(request.env).update_calendar(read_json())
        return _calendar_row(cal, cal._level_of(_me()), _me())

    @api_route("/agenda/calendars/<int:calendar_id>", methods=("DELETE",), profiles=AGENDA)
    def delete_calendar(self, calendar_id, **_kw):
        _cal()._get_for_user(calendar_id).with_env(request.env).remove_team()
        return {"deleted": True}

    @api_route("/agenda/calendars/<int:calendar_id>/shares", methods=("POST",), profiles=AGENDA)
    def share(self, calendar_id, **_kw):
        data = read_json()
        user_id, level = require(data, "user_id", "level")
        cal = _cal()._get_for_user(calendar_id)
        cal.with_env(request.env).share_with(user_id, level)
        return _calendar_row(cal, cal._level_of(_me()), _me())

    def _share(self, share_id):
        check_agenda_user(request.env)
        share = request.env["eguitra.agenda.share"].sudo().browse(share_id).exists()
        if not share or _me() not in (share.calendar_id.owner_id, share.user_id):
            raise ApiError(404, "not_found", "Partage introuvable.")
        return share

    @api_route("/agenda/shares/<int:share_id>", methods=("PATCH",), profiles=AGENDA)
    def update_share(self, share_id, **_kw):
        (level,) = require(read_json(), "level")
        share = self._share(share_id)
        share.with_env(request.env).update_level(level)
        cal = share.calendar_id
        return _calendar_row(cal, cal._level_of(_me()), _me())

    @api_route("/agenda/shares/<int:share_id>", methods=("DELETE",), profiles=AGENDA)
    def delete_share(self, share_id, **_kw):
        self._share(share_id).with_env(request.env).revoke()
        return {"deleted": True}

    @api_route("/agenda/categories", methods=("POST",), profiles=AGENDA)
    def create_category(self, **_kw):
        data = read_json()
        (name,) = require(data, "name")
        cat = request.env["eguitra.agenda.category"].create_mine(name, data.get("color"))
        return {"id": cat.id, "name": cat.name, "color": cat.color, "mine": True}

    @api_route("/agenda/categories/<int:category_id>", methods=("DELETE",), profiles=AGENDA)
    def delete_category(self, category_id, **_kw):
        check_agenda_user(request.env)
        cat = request.env["eguitra.agenda.category"].sudo().browse(category_id).exists()
        if not cat:
            raise ApiError(404, "not_found", "Catégorie introuvable.")
        cat.with_env(request.env).remove_mine()
        return {"deleted": True}

    # ─── Ressources ──────────────────────────────────────────────────────

    @api_route("/agenda/resources", profiles=AGENDA)
    def resources(self, **kw):
        check_agenda_user(request.env)
        me = _me()
        Cal = _cal().sudo().with_context(active_test=not (kw.get("all") and is_admin(me)))
        rows = []
        for res in Cal.search([("kind", "=", "resource")], order="resource_type, name"):
            level = res._level_of(me) if res.active else "none"
            if level == "none" and not is_admin(me):
                continue
            row = _calendar_row(res, level if level != "none" else "book", me)
            row["active"] = res.active
            rows.append(row)
        return rows

    @api_route("/agenda/resources", methods=("POST",), profiles=ADMIN)
    def create_resource(self, **_kw):
        res = _cal().create_resource(read_json())
        return _calendar_row(res, "book", _me())

    def _resource(self, resource_id):
        res = _cal().sudo().with_context(active_test=False).browse(resource_id).exists()
        if not res or res.kind != "resource":
            raise ApiError(404, "not_found", "Ressource introuvable.")
        return res

    @api_route("/agenda/resources/<int:resource_id>", methods=("PATCH",), profiles=ADMIN)
    def update_resource(self, resource_id, **_kw):
        res = self._resource(resource_id).with_env(request.env).update_resource(read_json())
        return _calendar_row(res, "book", _me())

    @api_route("/agenda/resources/<int:resource_id>", methods=("DELETE",), profiles=ADMIN)
    def archive_resource(self, resource_id, **_kw):
        self._resource(resource_id).with_env(request.env).archive_resource()
        return {"archived": True}

    # ─── Événements ──────────────────────────────────────────────────────

    @api_route("/agenda/events", profiles=AGENDA)
    def events(self, **kw):
        """Occurrences des agendas cochés entre start et end (UTC) ; un agenda que le compte n'atteint pas
        est ignoré, sans dire s'il existe."""
        check_agenda_user(request.env)
        me = _me()
        a, b = _moment(kw, "start", "début"), _moment(kw, "end", "fin")
        Cal = _cal()
        wanted = _ids(kw.get("calendars"), "calendars") or [Cal._ensure_personal(me).id]
        calendars = Cal.sudo().browse(wanted).exists().filtered(lambda c: c._level_of(me) != "none")
        rows = [_ev()._occ_row(occ, me, layer, view) for occ, layer, view in _ev().occurrences_for(calendars, a, b)]
        return {"events": rows, "calendars": calendars.ids}

    @api_route("/agenda/events/<int:event_id>", profiles=AGENDA)
    def event(self, event_id, **kw):
        ev = _ev()._get_for_user(event_id)
        return ev._detail(_me(), kw.get("occurrence") or None)

    @api_route("/agenda/events", methods=("POST",), profiles=AGENDA)
    def create_event(self, **_kw):
        data = read_json()
        ev, conflicts, warnings, mail = _ev().create_event(data)
        return _result(ev, conflicts, warnings, mail, _me())

    @api_route("/agenda/events/<int:event_id>", methods=("PATCH",), profiles=AGENDA)
    def update_event(self, event_id, **_kw):
        data = read_json()
        ev = _ev()._get_for_user(event_id)
        scope, occurrence = data.pop("scope", "all"), data.pop("occurrence", None)
        target, conflicts, warnings, mail = ev.with_env(request.env).update_event(data, scope, occurrence)
        return _result(target, conflicts, warnings, mail, _me())

    @api_route("/agenda/events/<int:event_id>", methods=("DELETE",), profiles=AGENDA)
    def delete_event(self, event_id, **kw):
        ev = _ev()._get_for_user(event_id)
        mail = ev.with_env(request.env).delete_event(kw.get("scope") or "all", kw.get("occurrence") or None)
        return {"deleted": True, "mail": mail}

    @api_route("/agenda/events/<int:event_id>/respond", methods=("POST",), profiles=AGENDA)
    def respond(self, event_id, **_kw):
        data = read_json()
        (state,) = require(data, "state")
        ev = _ev()._get_for_user(event_id)
        target = ev.with_env(request.env).respond(state, data.get("comment"), data.get("scope") or "all",
                                                  data.get("occurrence"), data.get("for_user_id"))
        return target._detail(_me())

    @api_route("/agenda/events/<int:event_id>/propose", methods=("POST",), profiles=AGENDA)
    def propose(self, event_id, **_kw):
        data = read_json()
        start, stop = require(data, "start", "stop")
        ev = _ev()._get_for_user(event_id)
        target = ev.with_env(request.env).propose(start, stop, data.get("comment"), data.get("occurrence"),
                                                  data.get("for_user_id"))
        return target._detail(_me())

    @api_route("/agenda/events/<int:event_id>/proposals/<int:attendee_id>/accept", methods=("POST",), profiles=AGENDA)
    def accept_proposal(self, event_id, attendee_id, **_kw):
        ev = _ev()._get_for_user(event_id, "full")
        target, conflicts, warnings, mail = ev.with_env(request.env).accept_proposal(attendee_id)
        return _result(target, conflicts, warnings, mail, _me())

    @api_route("/agenda/events/<int:event_id>/attendees/<int:attendee_id>/response", methods=("POST",), profiles=AGENDA)
    def external_response(self, event_id, attendee_id, **_kw):
        (state,) = require(read_json(), "state")
        ev = _ev()._get_for_user(event_id, "full")
        return ev.with_env(request.env).set_external_response(attendee_id, state)._detail(_me())

    @api_route("/agenda/events/<int:event_id>/attachments", methods=("POST",), profiles=AGENDA)
    def add_attachments(self, event_id, **_kw):
        ev = _ev()._get_for_user(event_id, "full")
        files = _uploads()
        if not files:
            raise ApiError(400, "missing_fields", "Joignez au moins un fichier.", fields=["file"])
        ev.with_env(request.env).add_attachments(files)
        return ev._detail(_me())

    @api_route("/agenda/events/<int:event_id>/attachments/<int:attachment_id>", profiles=AGENDA)
    def download(self, event_id, attachment_id, **_kw):
        ev = _ev()._get_for_user(event_id, "full")
        attachment = ev.sudo().attachment_ids.filtered(lambda a: a.id == attachment_id)
        if not attachment:
            raise ApiError(404, "not_found", "Pièce jointe introuvable.")
        return request.make_response(attachment.raw or b"", headers=[
            ("Content-Type", attachment.mimetype or "application/octet-stream"),
            ("Content-Disposition", content_disposition(attachment.name or "piece")),
            ("X-Content-Type-Options", "nosniff"),
        ])

    @api_route("/agenda/events/<int:event_id>/attachments/<int:attachment_id>", methods=("DELETE",), profiles=AGENDA)
    def remove_attachment(self, event_id, attachment_id, **_kw):
        ev = _ev()._get_for_user(event_id, "full")
        ev.with_env(request.env).remove_attachment(attachment_id)
        return ev._detail(_me())

    @api_route("/agenda/events/<int:event_id>/ics", profiles=AGENDA)
    def export_ics(self, event_id, **kw):
        """Fichier iCalendar d'un événement (ou de toute sa série) que le compte lit en détail."""
        ev = _ev()._get_for_user(event_id, "full")
        occurrence = parse_datetime(kw["occurrence"], "occurrence") if kw.get("occurrence") else None
        if occurrence and not ev._is_occurrence(occurrence):
            raise ApiError(404, "not_found", "Occurrence introuvable.")
        text = ev._ics("PUBLISH", occurrence=occurrence)
        name = "".join(c if c.isalnum() else "-" for c in (ev.name or "evenement"))[:60].strip("-") or "evenement"
        return request.make_response(text.encode("utf-8"), headers=[
            ("Content-Type", "text/calendar; charset=utf-8"),
            ("Content-Disposition", content_disposition(f"{name}.ics")),
        ])

    @api_route("/agenda/import", methods=("POST",), profiles=AGENDA)
    def import_ics(self, **_kw):
        form = request.httprequest.form
        (calendar_id,) = require(form, "calendar_id")
        upload = request.httprequest.files.get("file")
        if not upload or not upload.filename:
            raise ApiError(400, "missing_fields", "Joignez le fichier .ics.", fields=["file"])
        content = upload.read(moteur.MAX_ICS_BYTES + 1)
        if len(content) > moteur.MAX_ICS_BYTES:
            raise ApiError(413, "too_large", "Fichier trop volumineux : 5 Mo au plus.")
        cal = _cal()._get_for_user(calendar_id)
        return _ev().import_ics(cal, content)

    @api_route("/agenda/search", profiles=AGENDA)
    def search(self, **kw):
        return _ev().search_events(kw.get("q") or "", int_arg(kw, "limit", 50, 1, 100))

    # ─── Disponibilités ──────────────────────────────────────────────────

    def _people(self, ids):
        me = _me()
        users = request.env["res.users"].sudo().browse(dict.fromkeys(ids)).exists()
        return users.filtered(lambda u: u == me or (agenda_allowed(u) and shares_company(me, u)))

    def _resources(self, ids):
        me = _me()
        return _cal().sudo().browse(dict.fromkeys(ids)).exists().filtered(
            lambda r: r.kind == "resource" and r._level_of(me) == "book")

    def _person_row(self, user, a, b):
        me = _me()
        Event = _ev()
        pref = request.env["eguitra.agenda.preference"]._for(user)
        visible = Event._freebusy_visible_to(user, me)
        row = {"id": user.id, "name": user.name, "visible": visible, "tz": pref._tz(),
               "work_hours": {d: [[moteur.hhmm(x), moteur.hhmm(y)] for x, y in r] for d, r in pref._work().items()},
               "busy": [], "ooo": None}
        if not visible:
            return row
        row["busy"] = [{"start": s, "stop": e, "kind": k} for s, e, k, _ev in Event._busy_of(user, a, b)]
        window = pref._ooo_window()
        if window and window[0] < b and window[1] > a:
            row["ooo"] = {"start": window[0], "stop": window[1], "message": pref.ooo_message or None,
                          "auto_decline": pref.ooo_auto_decline}
        return row

    def _resource_busy(self, res, a, b):
        Event = _ev().sudo()
        records = Event.search([("resource_ids", "in", res.ids)] + Event._range_domain(a, b))
        return [(o.start, o.stop, o.event) for o in records._expand(a, b)]

    @api_route("/agenda/freebusy", methods=("POST",), profiles=AGENDA)
    def freebusy(self, **_kw):
        """Disponibilités de collègues et de ressources (occupations seules, jamais un titre)."""
        check_agenda_user(request.env)
        data = read_json()
        a, b = _moment(data, "start", "début"), _moment(data, "end", "fin")
        if b <= a or (b - a).days > 62:
            raise ApiError(422, "business_rule", "Période de 62 jours au plus.")
        people = [self._person_row(u, a, b) for u in self._people(_ids(data.get("user_ids"), "user_ids"))]
        resources = [{"id": r.id, "name": r.name, "capacity": r.capacity,
                      "busy": [{"start": s, "stop": e, "kind": "busy"} for s, e, _x in self._resource_busy(r, a, b)]}
                     for r in self._resources(_ids(data.get("resource_ids"), "resource_ids"))]
        return {"people": people, "resources": resources}

    @api_route("/agenda/find-slots", methods=("POST",), profiles=AGENDA)
    def find_slots(self, **_kw):
        """Créneaux communs, classés : heures de travail et fuseau de chacun, absences, temps tampon ; les
        participants obligatoires et les ressources doivent être libres, les facultatifs départagent."""
        check_agenda_user(request.env)
        me = _me()
        data = read_json()
        a, b = _moment(data, "start", "début"), _moment(data, "end", "fin")
        if b <= a or (b - a).days > MAX_SLOT_DAYS:
            raise ApiError(422, "business_rule", f"Cherchez sur {MAX_SLOT_DAYS} jours au plus.")
        duration = int_arg(data, "duration", 60, 5, 24 * 60)
        Pref = request.env["eguitra.agenda.preference"]
        buffer = int_arg(data, "buffer", Pref._for(me).buffer_minutes, 0, 120)
        organizer = self._people([int(data.get("organizer_id") or me.id)])[:1] or me
        required_ids = [organizer.id] + _ids(data.get("user_ids"), "user_ids")
        optional_ids = [i for i in _ids(data.get("optional_user_ids"), "optional_user_ids") if i not in required_ids]
        Event = _ev()
        unknown = []
        margin = timedelta(minutes=buffer + 1)

        def person(user):
            if not Event._freebusy_visible_to(user, me):
                unknown.append(user.id)
                return None
            pref = Pref._for(user)
            busy = [(s, e) for s, e, _k, _x in Event._busy_of(user, a - margin, b + margin)]
            return {"key": user.id, "busy": busy, "work": pref._work(), "tz": pref._tz()}

        required = [p for p in (person(u) for u in self._people(required_ids)) if p]
        optional = [p for p in (person(u) for u in self._people(optional_ids)) if p]
        for res in self._resources(_ids(data.get("resource_ids"), "resource_ids")):
            required.append({"key": f"resource:{res.id}", "busy": [(s, e) for s, e, _x in self._resource_busy(res, a, b)],
                             "work": res._hours_for_slots(), "tz": Pref._for(me)._tz()})
        slots = moteur.find_slots(a, b, timedelta(minutes=duration), required, optional, step=15, buffer=buffer,
                                  limit=int_arg(data, "limit", 10, 1, 30), now=fields.Datetime.now())
        names = {u.id: u.name for u in self._people(optional_ids)}
        out = []
        for slot in slots:
            free = [k for k in slot["optional_free"]]
            missing = [names[i] for i in optional_ids if i in names and i not in free and i not in unknown]
            label = ("Tous disponibles" if not missing else
                     f"{len(optional) - len(missing)} facultatif{'s' if len(optional) - len(missing) > 1 else ''} sur {len(optional)}")
            out.append({"start": slot["start"], "stop": slot["stop"], "optional_free": free, "missing": missing,
                        "label": label})
        return {"slots": out, "unknown": unknown, "buffer": buffer, "duration": duration}

    @api_route("/agenda/planning", profiles=AGENDA)
    def planning(self, **kw):
        """Planning d'équipe : une ligne par personne ou ressource, en lecture seule ; titres pour qui lit
        l'agenda en détail, « Occupé » sinon."""
        check_agenda_user(request.env)
        me = _me()
        a, b = _moment(kw, "start", "début"), _moment(kw, "end", "fin")
        if b <= a or (b - a).days > MAX_PLANNING_DAYS:
            raise ApiError(422, "business_rule", f"Planning de {MAX_PLANNING_DAYS} jours au plus.")
        Cal = _cal()
        rows = []
        labels = {"oof": "Absent du bureau", "absence": "Congé", "tentative": "Provisoire", "busy": "Occupé"}
        for user in self._people(_ids(kw.get("user_ids"), "user_ids") or [me.id]):
            row = self._person_row(user, a, b)
            row["kind"] = "person"
            layer = Cal._personal_of(user)
            if row["visible"]:
                blocks = []
                for s, e, k, ev in _ev()._busy_of(user, a, b):
                    view = ev._view(me, layer) if ev else None
                    title = ev.name if view in ("full", "title") else labels.get(k, "Occupé")
                    blocks.append({"start": s, "stop": e, "kind": k, "title": title,
                                   "event_id": ev.id if view == "full" else None})
                row["busy"] = blocks
            rows.append(row)
        for res in self._resources(_ids(kw.get("resource_ids"), "resource_ids")):
            blocks = []
            for s, e, ev in self._resource_busy(res, a, b):
                title = f"Réservé par {ev.organizer_id.name}" if ev.privacy == "public" and ev.organizer_id else "Réservé"
                view = ev._view(me, res)
                blocks.append({"start": s, "stop": e, "kind": "busy", "title": ev.name if view == "full" else title,
                               "event_id": ev.id if view == "full" else None})
            rows.append({"id": res.id, "kind": "resource", "name": res.name, "visible": True, "busy": blocks,
                         "capacity": res.capacity, "work_hours": None, "ooo": None})
        return {"rows": rows}

    # ─── Sources métier ──────────────────────────────────────────────────

    @api_route("/agenda/sources", profiles=AGENDA)
    def sources(self, **kw):
        check_agenda_user(request.env)
        first = parse_date(kw.get("start"), "début")
        last = parse_date(kw.get("end"), "fin")
        codes = [c for c in (kw.get("codes") or "").split(",") if c] or None
        return {"items": request.env["eguitra.agenda.source"].items(_me(), first, last, codes)}

    # ─── Notifications et journal ────────────────────────────────────────

    @api_route("/agenda/notifications/unread", profiles=AGENDA, journal=False)
    def unread(self, **_kw):
        """Compteur de l'en-tête (relu toutes les 30 secondes) : notifications non lues et invitations sans
        réponse à venir."""
        check_agenda_user(request.env)
        return _unread_counts()

    @api_route("/agenda/notifications", profiles=AGENDA)
    def notifications(self, **kw):
        check_agenda_user(request.env)
        found = request.env["eguitra.agenda.notification"].sudo().search(
            [("user_id", "=", _me().id)], limit=int_arg(kw, "limit", 50, 1, 200))
        return [n._row() for n in found]

    @api_route("/agenda/notifications/read", methods=("POST",), profiles=AGENDA, journal=False)
    def mark_read(self, **_kw):
        check_agenda_user(request.env)
        data = read_json()
        domain = [("user_id", "=", _me().id), ("read_at", "=", False)]
        if data.get("ids"):
            domain.append(("id", "in", _ids(data["ids"], "ids")))
        request.env["eguitra.agenda.notification"].sudo().search(domain).write({"read_at": fields.Datetime.now()})
        return _unread_counts()

    @api_route("/agenda/journal", profiles=AGENDA)
    def journal(self, **kw):
        """Journal d'un agenda (le sien, ou celui de son mandant) : qui a fait quoi, pour le compte de qui."""
        me = _me()
        Cal = _cal()
        cal = Cal._get_for_user(kw["calendar_id"], "manage") if kw.get("calendar_id") else Cal._ensure_personal(me)
        entries = request.env["eguitra.agenda.journal"].sudo().search([("calendar_id", "=", cal.id)],
                                                                      limit=int_arg(kw, "limit", 100, 1, 500))
        return [j._row() for j in entries]

    # ─── Délégations ─────────────────────────────────────────────────────

    @api_route("/agenda/delegations", methods=("POST",), profiles=AGENDA)
    def create_delegation(self, **_kw):
        data = read_json()
        (delegate_id,) = require(data, "delegate_id")
        d = request.env["eguitra.agenda.delegation"].grant(
            delegate_id, data.get("receive_invitations", True) is not False, bool(data.get("see_private")),
            data.get("owner_id"), data.get("reason"))
        return _delegation_row(d)

    def _delegation(self, delegation_id):
        check_agenda_user(request.env)
        d = request.env["eguitra.agenda.delegation"].sudo().browse(delegation_id).exists()
        me = _me()
        if not d or (me not in (d.owner_id, d.delegate_id) and not (
                set(me._eguitra_profiles()) & set(POSE) and d.owner_id.has_group("eguitra_base.group_profile_direction")
                and shares_company(me, d.owner_id))):
            raise ApiError(404, "not_found", "Délégation introuvable.")
        return d

    @api_route("/agenda/delegations/<int:delegation_id>", methods=("PATCH",), profiles=AGENDA)
    def update_delegation(self, delegation_id, **_kw):
        d = self._delegation(delegation_id).with_env(request.env).update_options(read_json())
        return _delegation_row(d)

    @api_route("/agenda/delegations/<int:delegation_id>", methods=("DELETE",), profiles=AGENDA)
    def delete_delegation(self, delegation_id, **_kw):
        self._delegation(delegation_id).with_env(request.env).revoke()
        return {"deleted": True}

    @api_route("/agenda/admin/executives", profiles=POSE)
    def executives(self, **_kw):
        """Dirigeants (profil direction) des sociétés du compte et leurs délégations, sans rien de leurs
        agendas : la direction et l'administration y posent ou retirent une délégation."""
        check_agenda_user(request.env)
        me = _me()
        group = request.env.ref("eguitra_base.group_profile_direction")
        users = request.env["res.users"].sudo().search([("group_ids", "in", group.ids), ("share", "=", False),
                                                        ("company_ids", "in", me.company_ids.ids)], order="name")
        Delegation = request.env["eguitra.agenda.delegation"].sudo()
        return [{"id": u.id, "name": u.name, "delegations": [_delegation_row(d) for d in Delegation.search(
            [("owner_id", "=", u.id)])]} for u in users.filtered(agenda_allowed)]

    # ─── Abonnement ──────────────────────────────────────────────────────

    @api_route("/agenda/subscription", profiles=AGENDA)
    def subscription(self, **_kw):
        check_agenda_user(request.env)
        sub = request.env["eguitra.agenda.subscription"].sudo().search([("user_id", "=", _me().id)], limit=1)
        return sub._row() if sub else {"active": False}

    @api_route("/agenda/subscription", methods=("POST",), profiles=AGENDA)
    def create_subscription(self, **_kw):
        """Nouveau lien (l'ancien cesse de servir) : le jeton n'est rendu qu'une fois, dans path."""
        data = read_json()
        sub, raw = request.env["eguitra.agenda.subscription"].issue(data.get("mask_private", True) is not False)
        return dict(sub._row(), path=f"/ical/{raw}.ics")

    @api_route("/agenda/subscription", methods=("DELETE",), profiles=AGENDA)
    def delete_subscription(self, **_kw):
        return {"revoked": request.env["eguitra.agenda.subscription"].revoke_mine()}

    # ─── Prise de rendez-vous ────────────────────────────────────────────

    @api_route("/agenda/booking-types", profiles=AGENDA)
    def booking_types(self, **_kw):
        check_agenda_user(request.env)
        Type = request.env["eguitra.agenda.booking.type"].sudo().with_context(active_test=False)
        return {"open": booking_open(request.env),
                "types": [t._row() for t in Type.search([("owner_id", "=", _me().id)])]}

    @api_route("/agenda/booking-types", methods=("POST",), profiles=AGENDA)
    def create_booking_type(self, **_kw):
        return request.env["eguitra.agenda.booking.type"].create_mine(read_json())._row()

    def _booking_type(self, type_id):
        check_agenda_user(request.env)
        bt = request.env["eguitra.agenda.booking.type"].sudo().with_context(active_test=False).browse(type_id).exists()
        if not bt or bt.owner_id != _me():
            raise ApiError(404, "not_found", "Type de rendez-vous introuvable.")
        return bt

    @api_route("/agenda/booking-types/<int:type_id>", methods=("PATCH",), profiles=AGENDA)
    def update_booking_type(self, type_id, **_kw):
        return self._booking_type(type_id).with_env(request.env).update_mine(read_json())._row()

    @api_route("/agenda/booking-types/<int:type_id>", methods=("DELETE",), profiles=AGENDA)
    def delete_booking_type(self, type_id, **_kw):
        self._booking_type(type_id).with_env(request.env).remove_mine()
        return {"deleted": True}

    @api_route("/agenda/bookings", profiles=AGENDA)
    def bookings(self, **_kw):
        check_agenda_user(request.env)
        found = request.env["eguitra.agenda.booking"].sudo().search(
            [("type_id.owner_id", "=", _me().id), ("state", "in", ("pending", "confirmed"))], limit=100)
        return [b._row() for b in found]

    # ─── Administration ──────────────────────────────────────────────────

    @api_route("/agenda/admin/users/<int:user_id>/remove", methods=("POST",), profiles=ADMIN)
    def remove_archived_user(self, user_id, **_kw):
        """Retire un compte désactivé des partages et délégations, et prévient les participants de ses
        événements à venir ; rend des nombres, sans rien lire des agendas."""
        env = sudo_env()
        user = env["res.users"].with_context(active_test=False).search([("id", "=", user_id)] + _scope_domain(env),
                                                                       limit=1)
        if not user or set(user.company_ids.ids) - set(_me().company_ids.ids):
            raise ApiError(404, "not_found", "Utilisateur introuvable.")
        if user.active:
            raise ApiError(422, "business_rule", "Seul un compte désactivé se retire de l'agenda : désactivez-le d'abord.")
        return _cal()._on_users_deactivated(user)

    @api_route("/agenda/admin/settings", profiles=ADMIN)
    def admin_settings(self, **_kw):
        return _admin_settings()

    @api_route("/agenda/admin/settings", methods=("PATCH",), profiles=ADMIN)
    def update_admin_settings(self, **_kw):
        """Interrupteur de la prise de rendez-vous en ligne et adresse publique du site (https)."""
        data = read_json()
        params = request.env["ir.config_parameter"].sudo()
        if "public_url" in data:
            url = (data.get("public_url") or "").strip().rstrip("/")
            if url and (not url.startswith("https://") or " " in url or len(url) > 200 or url.count("/") > 2):
                raise ApiError(422, "business_rule", "Adresse publique : https://domaine, sans chemin.")
            params.set_param("eguitra_agenda.public_url", url or False)
        if "enabled" in data:
            if data["enabled"] and not platform_settings(request.env)["public_url"]:
                raise ApiError(422, "business_rule", "Indiquez d'abord l'adresse publique du site.")
            params.set_param("eguitra_agenda.booking_enabled", "1" if data["enabled"] else "0")
        return _admin_settings()
