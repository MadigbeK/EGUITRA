"""Agendas, partages, délégations et catégories.

Un agenda appartient à un compte (agenda personnel, créé d'office, ou agenda d'équipe ou de projet) ou
est une ressource (salle, véhicule de service, équipement), gérée par l'administration et réservable
par tous les comptes de l'agenda.

Niveaux d'accès d'un compte à un agenda (common.LEVELS) :
- owner : son propriétaire ;
- manage : un délégué du propriétaire (l'assistante) : crée, modifie, supprime, répond en son nom ; les
  événements privés restent « Occupé » sauf droit explicite (see_private) ;
- write, read, freebusy : un partage (modification, lecture des détails, disponibilités seulement) ;
- book : une ressource (occupations seules, réservation sans conflit possible) ;
- none.

Confidentialité. Les comptes n'ont que la lecture de ces modèles (security/ir.model.access.csv) et les
règles d'enregistrement (security/agenda_rules.xml) sont globales : l'administration ne lit pas l'agenda
d'un autre compte. Toute écriture passe par les méthodes ci-dessous, qui contrôlent sous l'identité du
compte avant d'écrire en sudo.
"""

from psycopg2 import IntegrityError

from odoo import api, fields, models
from odoo.exceptions import AccessError, MissingError, UserError

from .. import moteur
from .common import (
    COLORS,
    KINDS,
    LEVELS,
    RANK,
    RESOURCE_TYPES,
    SHARE_LEVELS,
    agenda_allowed,
    check_agenda_user,
    clean_color,
    clean_line,
    clean_text,
    is_admin,
    is_direction,
    shares_company,
)

MAX_DELEGATES = 5
MAX_CALENDARS = 20


class AgendaCalendar(models.Model):
    _name = "eguitra.agenda.calendar"
    _description = "Agenda"
    _order = "kind, sequence, name, id"

    name = fields.Char("Nom", required=True)
    color = fields.Char("Couleur", default=COLORS[0])
    kind = fields.Selection(KINDS, "Sorte", required=True, default="personal")
    owner_id = fields.Many2one("res.users", "Propriétaire", index=True, ondelete="cascade")
    personal_key = fields.Char("Agenda personnel de", index=True, copy=False,
                               help="Identifiant du propriétaire : un seul agenda personnel par compte.")
    active = fields.Boolean(default=True)
    sequence = fields.Integer(default=10)
    share_ids = fields.One2many("eguitra.agenda.share", "calendar_id", "Partages")
    # Ressources.
    resource_type = fields.Selection(RESOURCE_TYPES, "Nature de la ressource")
    capacity = fields.Integer("Capacité", help="Places d'une salle ou d'un véhicule ; 0 : sans limite.")
    location = fields.Char("Emplacement")
    description = fields.Text("Description")
    company_id = fields.Many2one("res.company", "Société", index=True,
                                 help="Ressource d'une seule société ; vide : commune aux deux.")
    open_hours = fields.Json("Heures d'ouverture", help="Ressource : plages réservables ; vide : à toute heure.")

    _personal_unique = models.Constraint("unique(personal_key)", "Un seul agenda personnel par compte.")

    # ─── Accès ───────────────────────────────────────────────────────────

    def _delegation_for(self, user):
        """Délégation du propriétaire à ce compte (vide sinon)."""
        self.ensure_one()
        owner = self.sudo().owner_id
        if not owner or self.kind == "resource":
            return self.env["eguitra.agenda.delegation"]
        return self.env["eguitra.agenda.delegation"].sudo().search(
            [("owner_id", "=", owner.id), ("delegate_id", "=", user.id)], limit=1)

    def _level_of(self, user):
        """Niveau d'accès du compte à cet agenda (common.LEVELS)."""
        self.ensure_one()
        cal = self.sudo()
        if not cal.active or not agenda_allowed(user):
            return "none"
        if cal.kind == "resource":
            if cal.company_id and cal.company_id not in user.sudo().company_ids:
                return "none"
            return "book"
        if cal.owner_id == user:
            return "owner"
        if not cal.owner_id.active:
            return "none"
        if cal._delegation_for(user):
            return "manage"
        share = cal.share_ids.filtered(lambda s: s.user_id == user)[:1]
        return share.level if share else "none"

    def _check_level(self, user, minimum, action="consulter cet agenda"):
        self.ensure_one()
        level = self._level_of(user)
        if RANK[level] < RANK[minimum] or (minimum == "write" and level == "book"):
            raise AccessError(f"Vous n'avez pas le droit de {action}.")
        return level

    def _can_write_events(self, user):
        """Créer, modifier et supprimer des événements dans cet agenda (propriétaire, délégué, modification ;
        une ressource se réserve depuis un événement, jamais directement)."""
        self.ensure_one()
        return self._level_of(user) in ("owner", "manage", "write")

    @api.model
    def _get_for_user(self, calendar_id, minimum="freebusy"):
        """Agenda que le compte atteint au moins à ce niveau ; sinon introuvable, sans dire s'il existe."""
        check_agenda_user(self.env)
        try:
            calendar_id = int(calendar_id)
        except (TypeError, ValueError) as e:
            raise MissingError("Agenda introuvable.") from e
        cal = self.sudo().browse(calendar_id).exists()
        if not cal or RANK[cal._level_of(self.env.user)] < RANK[minimum]:
            raise MissingError("Agenda introuvable.")
        return cal

    # ─── Agenda personnel et agendas visibles ────────────────────────────

    @api.model
    def _personal_of(self, user):
        """Agenda personnel existant du compte (vide s'il n'a jamais ouvert l'agenda)."""
        return self.sudo().search([("personal_key", "=", str(user.id))], limit=1)

    @api.model
    def _ensure_personal(self, user):
        """Agenda personnel du compte, créé la première fois."""
        user = user.sudo()
        cal = self.sudo().with_context(active_test=False).search([("personal_key", "=", str(user.id))], limit=1)
        if cal:
            if not cal.active:
                cal.active = True
            return cal
        try:
            with self.env.cr.savepoint():
                return self.sudo().create({
                    "name": user.name, "kind": "personal", "owner_id": user.id, "personal_key": str(user.id),
                    "color": COLORS[user.id % len(COLORS)],
                })
        except IntegrityError as e:
            raise UserError("L'agenda vient d'être créé par un autre onglet : rechargez la page.") from e

    @api.model
    def _visible(self, user):
        """Agendas du panneau latéral : les miens, ceux des comptes qui m'ont délégué, ceux partagés avec
        moi, les ressources. Rend [(agenda, niveau)]."""
        Calendar = self.sudo()
        mine = Calendar.search([("owner_id", "=", user.id), ("kind", "!=", "resource")])
        owners = self.env["eguitra.agenda.delegation"].sudo().search([("delegate_id", "=", user.id)]).owner_id
        delegated = Calendar.search([("owner_id", "in", owners.filtered("active").ids), ("kind", "!=", "resource")])
        shared = self.env["eguitra.agenda.share"].sudo().search([("user_id", "=", user.id)]).calendar_id
        resources = Calendar.search([("kind", "=", "resource")])
        out, seen = [], set()
        for cal in mine | delegated | shared | resources:
            if cal.id in seen:
                continue
            seen.add(cal.id)
            level = cal._level_of(user)
            if level != "none":
                out.append((cal, level))
        return out

    # ─── Agendas d'équipe ────────────────────────────────────────────────

    @api.model
    def create_team(self, name, color=None):
        check_agenda_user(self.env)
        me = self.env.user
        name = clean_line(name, 80)
        if not name:
            raise UserError("Donnez un nom à l'agenda.")
        if self.sudo().search_count([("owner_id", "=", me.id), ("kind", "=", "team")]) >= MAX_CALENDARS:
            raise UserError(f"{MAX_CALENDARS} agendas d'équipe au plus par compte.")
        cal = self.sudo().create({"name": name, "kind": "team", "owner_id": me.id, "color": clean_color(color)})
        self.env["eguitra.agenda.journal"]._log(cal, "calendar_create")
        return cal

    def update_calendar(self, values):
        """Nom et couleur : le propriétaire (un délégué pour l'agenda de son mandant)."""
        self.ensure_one()
        self._check_level(self.env.user, "manage", "modifier cet agenda")
        cal = self.sudo()
        vals = {}
        if "name" in values:
            vals["name"] = clean_line(values["name"], 80)
            if not vals["name"]:
                raise UserError("Donnez un nom à l'agenda.")
        if "color" in values:
            vals["color"] = clean_color(values["color"])
        if vals:
            cal.write(vals)
        return cal

    def remove_team(self):
        """Suppression d'un agenda d'équipe par son propriétaire, avec ses événements."""
        self.ensure_one()
        cal = self.sudo()
        if cal.kind != "team":
            raise UserError("Seul un agenda d'équipe ou de projet se supprime : l'agenda personnel reste.")
        if cal.owner_id != self.env.user:
            raise AccessError("Seul le propriétaire supprime cet agenda.")
        events = self.env["eguitra.agenda.event"].sudo().search([("calendar_id", "=", cal.id)])
        events.filtered(lambda e: not e.series_id)._notify_cancelled_all()
        events.unlink()
        cal.share_ids.unlink()
        self.env["eguitra.agenda.journal"]._log(cal, "calendar_delete", note=cal.name)
        cal.active = False
        return True

    # ─── Partages ────────────────────────────────────────────────────────

    def share_with(self, user_id, level):
        """Le propriétaire partage son agenda (disponibilités, lecture, modification) avec un collègue."""
        self.ensure_one()
        cal = self.sudo()
        me = self.env.user
        if cal.kind == "resource":
            raise UserError("Une ressource ne se partage pas : tous les comptes la voient et la réservent.")
        if cal.owner_id != me:
            raise AccessError("Seul le propriétaire partage son agenda.")
        if level not in dict(SHARE_LEVELS):
            raise UserError("Niveau de partage : disponibilités, lecture des détails ou modification.")
        other = self._colleague(user_id)
        Share = self.env["eguitra.agenda.share"].sudo()
        share = Share.search([("calendar_id", "=", cal.id), ("user_id", "=", other.id)], limit=1)
        if share:
            if share.level != level:
                share.write({"level": level, "granted_by_id": me.id})
                self.env["eguitra.agenda.journal"]._log(cal, "share_update", note=f"{other.name} : {dict(SHARE_LEVELS)[level]}")
        else:
            share = Share.create({"calendar_id": cal.id, "user_id": other.id, "level": level, "granted_by_id": me.id})
            self.env["eguitra.agenda.journal"]._log(cal, "share_add", note=f"{other.name} : {dict(SHARE_LEVELS)[level]}")
        self.env["eguitra.agenda.notification"]._push(
            other, "share", f"{me.name} partage son agenda « {cal.name} » avec vous",
            f"Niveau : {dict(SHARE_LEVELS)[level].lower()}. Cochez-le dans le panneau de l'agenda pour l'afficher.")
        return share

    @api.model
    def _colleague(self, user_id):
        """Compte admis à l'agenda qui partage au moins une société avec le compte courant."""
        me = self.env.user
        try:
            user_id = int(user_id)
        except (TypeError, ValueError) as e:
            raise UserError("Compte inconnu.") from e
        user = self.env["res.users"].sudo().browse(user_id).exists()
        if not user or user == me or not agenda_allowed(user):
            raise UserError("Ce compte n'a pas d'agenda : seuls les comptes internes actifs ont un agenda.")
        if not shares_company(me, user):
            raise AccessError(f"Vous ne partagez aucune société avec {user.name}.")
        return user

    # ─── Ressources (administration) ─────────────────────────────────────

    @api.model
    def _check_admin(self):
        if not is_admin(self.env.user):
            raise AccessError("Seule l'administration gère les ressources (salles, véhicules, équipements).")

    @api.model
    def _resource_values(self, values, partial=False):
        vals = {}
        if not partial or "name" in values:
            vals["name"] = clean_line(values.get("name"), 80)
            if not vals["name"]:
                raise UserError("Donnez un nom à la ressource.")
        if not partial or "resource_type" in values:
            if values.get("resource_type", "room") not in dict(RESOURCE_TYPES):
                raise UserError("Nature de ressource inconnue.")
            vals["resource_type"] = values.get("resource_type") or "room"
        if "capacity" in values:
            try:
                vals["capacity"] = max(0, min(int(values.get("capacity") or 0), 10000))
            except (TypeError, ValueError) as e:
                raise UserError("Capacité invalide.") from e
        if "location" in values:
            vals["location"] = clean_line(values.get("location"), 120) or False
        if "description" in values:
            vals["description"] = clean_text(values.get("description"), 1000) or False
        if "color" in values or not partial:
            vals["color"] = clean_color(values.get("color"), "#4b5563")
        if "company_id" in values:
            company_id = values.get("company_id")
            if company_id:
                company = self.env["res.company"].sudo().browse(int(company_id)).exists()
                if not company or company not in self.env.user.company_ids:
                    raise UserError("Société inconnue.")
                vals["company_id"] = company.id
            else:
                vals["company_id"] = False
        if "open_hours" in values:
            vals["open_hours"] = moteur.check_work_hours(values["open_hours"]) if values.get("open_hours") else False
        return vals

    @api.model
    def create_resource(self, values):
        self._check_admin()
        vals = self._resource_values(values)
        cal = self.sudo().create(dict(vals, kind="resource", owner_id=False))
        self.env["eguitra.agenda.journal"]._log(cal, "resource_create", note=cal.name)
        return cal

    def update_resource(self, values):
        self.ensure_one()
        self._check_admin()
        cal = self.sudo()
        if cal.kind != "resource":
            raise MissingError("Ressource introuvable.")
        cal.write(self._resource_values(values, partial=True))
        self.env["eguitra.agenda.journal"]._log(cal, "resource_update", note=cal.name)
        return cal

    def archive_resource(self):
        """Ressource retirée : elle n'est plus réservable ; ses réservations passées restent."""
        self.ensure_one()
        self._check_admin()
        cal = self.sudo()
        if cal.kind != "resource":
            raise MissingError("Ressource introuvable.")
        cal.active = False
        self.env["eguitra.agenda.journal"]._log(cal, "resource_archive", note=cal.name)
        return cal

    def _hours_for_slots(self):
        """Heures réservables d'une ressource (None : à toute heure)."""
        self.ensure_one()
        return self.sudo().open_hours or None

    # ─── Compte désactivé ────────────────────────────────────────────────

    @api.model
    def _on_users_deactivated(self, users):
        """Un compte désactivé perd ses partages et ses délégations (reçus comme accordés), son lien
        d'abonnement et ses rendez-vous en ligne ; les participants de ses événements à venir dont il est
        l'organisateur en sont prévenus. Sans rien lire du contenu des agendas ; rejouable sans effet.
        Rend les nombres retirés et prévenus."""
        users = users.sudo().with_context(active_test=False).filtered(lambda u: not u.active)
        if not users:
            return {"shares": 0, "delegations": 0, "events": 0}
        env = self.env
        shares = env["eguitra.agenda.share"].sudo().search(
            ["|", ("user_id", "in", users.ids), ("calendar_id.owner_id", "in", users.ids)])
        delegations = env["eguitra.agenda.delegation"].sudo().search(
            ["|", ("owner_id", "in", users.ids), ("delegate_id", "in", users.ids)])
        Journal = env["eguitra.agenda.journal"]
        for share in shares:
            Journal._log(share.calendar_id, "share_remove", note=f"{share.user_id.name} (compte désactivé)")
        for d in delegations:
            personal = self._ensure_personal(d.owner_id)
            Journal._log(personal, "delegation_remove", note=f"{d.delegate_id.name} (compte désactivé)")
        n_shares, n_delegations = len(shares), len(delegations)
        shares.unlink()
        delegations.unlink()
        env["eguitra.agenda.subscription"].sudo().search([("user_id", "in", users.ids)]).unlink()
        env["eguitra.agenda.booking.type"].sudo().search([("owner_id", "in", users.ids)]).write({"active": False})
        now = fields.Datetime.now()
        Event = env["eguitra.agenda.event"].sudo()
        events = Event.search([
            ("organizer_id", "in", users.ids), ("series_id", "=", False), ("organizer_inactive", "=", False),
            "|", "&", ("rrule", "=", False), ("stop", ">", now),
            "&", ("rrule", "!=", False), "|", ("recurrence_end", "=", False), ("recurrence_end", ">", now)])
        Notification = env["eguitra.agenda.notification"]
        for ev in events:
            people = ev.attendee_ids.filtered(lambda a: a.state != "declined" and a.user_id and a.user_id.active).user_id
            when = ev._when_text()
            Notification._push(people, "organizer_inactive", f"Organisateur désactivé : {ev.name}",
                               f"{ev.organizer_id.name} n'a plus de compte actif. L'événement ({when}) reste dans votre "
                               "agenda : voyez avec les autres participants s'il est maintenu.", event=ev)
            Journal._log(ev.calendar_id, "account_disabled", event=ev, note=ev.organizer_id.name)
        (events | Event.search([("series_id", "in", events.ids)])).write({"organizer_inactive": True})
        return {"shares": n_shares, "delegations": n_delegations, "events": len(events)}


class AgendaShare(models.Model):
    _name = "eguitra.agenda.share"
    _description = "Partage d'un agenda"
    _order = "calendar_id, id"

    calendar_id = fields.Many2one("eguitra.agenda.calendar", "Agenda", required=True, index=True, ondelete="cascade")
    user_id = fields.Many2one("res.users", "Partagé avec", required=True, index=True, ondelete="cascade")
    level = fields.Selection(SHARE_LEVELS, "Niveau", required=True, default="freebusy")
    granted_by_id = fields.Many2one("res.users", "Accordé par", ondelete="set null")
    # Compte qui lit les détails par ce partage (lecture ou modification) : sert aux règles d'enregistrement.
    read_user_id = fields.Many2one("res.users", compute="_compute_read_user", store=True, index=True)

    _share_unique = models.Constraint("unique(calendar_id, user_id)", "Cet agenda est déjà partagé avec ce compte.")

    @api.depends("user_id", "level")
    def _compute_read_user(self):
        for share in self:
            share.read_user_id = share.user_id if share.level in ("read", "write") else False

    def update_level(self, level):
        self.ensure_one()
        share = self.sudo()
        return share.calendar_id.with_env(self.env).share_with(share.user_id.id, level)

    def revoke(self):
        """Retrait d'un partage : par le propriétaire de l'agenda, ou par le compte qui le reçoit."""
        self.ensure_one()
        share = self.sudo()
        me = self.env.user
        if me not in (share.calendar_id.owner_id, share.user_id):
            raise AccessError("Seul le propriétaire de l'agenda (ou le compte qui reçoit le partage) le retire.")
        cal, user = share.calendar_id, share.user_id
        share.unlink()
        self.env["eguitra.agenda.journal"]._log(cal, "share_remove", note=user.name)
        if me != user:
            self.env["eguitra.agenda.notification"]._push(
                user, "share", f"{me.name} ne partage plus son agenda « {cal.name} » avec vous", "")
        return True


class AgendaDelegation(models.Model):
    """Délégation de la gestion d'un agenda (l'assistante) : le délégué crée, modifie et supprime les
    événements de son mandant, et répond en son nom ; chaque action porte « par X pour le compte de Y »
    et entre dans le journal de l'agenda et dans la piste d'audit. Elle se retire à tout moment ; la
    direction ou l'administration en pose une pour un dirigeant (profil direction)."""

    _name = "eguitra.agenda.delegation"
    _description = "Délégation de la gestion d'un agenda"
    _order = "owner_id, id"

    owner_id = fields.Many2one("res.users", "Mandant", required=True, index=True, ondelete="cascade")
    delegate_id = fields.Many2one("res.users", "Délégué", required=True, index=True, ondelete="cascade")
    receive_invitations = fields.Boolean("Reçoit aussi les invitations", default=True)
    see_private = fields.Boolean("Voit les événements privés")
    granted_by_id = fields.Many2one("res.users", "Posée par", ondelete="set null", index=True)
    reason = fields.Char("Motif", help="Délégation posée par la direction ou l'administration pour un dirigeant.")
    # Délégué qui voit les événements privés : sert aux règles d'enregistrement.
    private_user_id = fields.Many2one("res.users", compute="_compute_private_user", store=True, index=True)

    _delegation_unique = models.Constraint("unique(owner_id, delegate_id)", "Ce compte est déjà délégué.")

    @api.depends("delegate_id", "see_private")
    def _compute_private_user(self):
        for delegation in self:
            delegation.private_user_id = delegation.delegate_id if delegation.see_private else False

    @api.model
    def _may_pose_for_others(self, user=None):
        user = user or self.env.user
        return is_admin(user) or is_direction(user)

    @api.model
    def grant(self, delegate_id, receive_invitations=True, see_private=False, owner_id=None, reason=None):
        """Délégation posée par le mandant lui-même, ou par la direction ou l'administration pour un
        dirigeant (jamais à soi-même : nul ne se donne l'agenda d'un autre)."""
        check_agenda_user(self.env)
        me = self.env.user
        Calendar = self.env["eguitra.agenda.calendar"]
        owner = me
        if owner_id and int(owner_id) != me.id:
            if not self._may_pose_for_others():
                raise AccessError("Seules la direction et l'administration posent une délégation pour un autre compte.")
            owner = self.env["res.users"].sudo().browse(int(owner_id)).exists()
            if not owner or not agenda_allowed(owner):
                raise UserError("Ce compte n'a pas d'agenda.")
            if not owner.has_group("eguitra_base.group_profile_direction"):
                raise UserError("La direction ou l'administration ne pose une délégation que pour un dirigeant "
                                "(profil direction) ; un autre compte délègue lui-même son agenda.")
            if not shares_company(me, owner):
                raise AccessError(f"Vous ne partagez aucune société avec {owner.name}.")
        delegate = self.env["res.users"].sudo().browse(int(delegate_id or 0)).exists()
        if not delegate or not agenda_allowed(delegate):
            raise UserError("Ce compte n'a pas d'agenda : seuls les comptes internes actifs reçoivent une délégation.")
        if delegate == owner:
            raise UserError("Un compte ne se délègue pas son propre agenda.")
        if delegate == me and owner != me:
            raise AccessError("Vous ne pouvez pas vous déléguer l'agenda d'un autre compte : une autre personne de la "
                              "direction ou de l'administration doit la poser.")
        if not shares_company(owner, delegate):
            raise AccessError(f"{delegate.name} et {owner.name} ne partagent aucune société.")
        existing = self.sudo().search([("owner_id", "=", owner.id), ("delegate_id", "=", delegate.id)], limit=1)
        if existing:
            raise UserError(f"{delegate.name} gère déjà cet agenda : modifiez ses options.")
        if self.sudo().search_count([("owner_id", "=", owner.id)]) >= MAX_DELEGATES:
            raise UserError(f"{MAX_DELEGATES} délégués au plus par agenda.")
        delegation = self.sudo().create({
            "owner_id": owner.id, "delegate_id": delegate.id, "receive_invitations": bool(receive_invitations),
            "see_private": bool(see_private), "granted_by_id": me.id,
            "reason": clean_line(reason, 200) or False,
        })
        personal = Calendar._ensure_personal(owner)
        by = "" if owner == me else f", posée par {me.name}"
        self.env["eguitra.agenda.journal"]._log(personal, "delegation_add", note=f"{delegate.name}{by}")
        Notification = self.env["eguitra.agenda.notification"]
        Notification._push(delegate, "delegation", f"Vous gérez désormais l'agenda de {owner.name}",
                           delegation._options_label())
        if owner != me:
            Notification._push(owner, "delegation", f"{me.name} a confié la gestion de votre agenda à {delegate.name}",
                               (delegation.reason or "") + ("\n" if delegation.reason else "") + delegation._options_label()
                               + "\nVous pouvez la retirer à tout moment dans les réglages de l'agenda.")
        return delegation

    def _options_label(self):
        self.ensure_one()
        parts = ["reçoit aussi les invitations" if self.receive_invitations else "ne reçoit pas les invitations",
                 "voit les événements privés" if self.see_private else "ne voit pas les événements privés"]
        return "Options : " + ", ".join(parts) + "."

    def _check_manager(self, action):
        """Le mandant, ou la direction et l'administration pour un dirigeant ; le délégué renonce seul."""
        self.ensure_one()
        me = self.env.user
        d = self.sudo()
        if me == d.owner_id:
            return
        if self._may_pose_for_others() and d.owner_id.has_group("eguitra_base.group_profile_direction") \
                and me != d.delegate_id and shares_company(me, d.owner_id):
            return
        raise AccessError(f"Seul le mandant (ou la direction et l'administration pour un dirigeant) {action}.")

    def update_options(self, values):
        self.ensure_one()
        self._check_manager("modifie cette délégation")
        d = self.sudo()
        vals = {k: bool(values[k]) for k in ("receive_invitations", "see_private") if k in values}
        if vals:
            d.write(vals)
            personal = self.env["eguitra.agenda.calendar"]._ensure_personal(d.owner_id)
            self.env["eguitra.agenda.journal"]._log(personal, "delegation_update", note=f"{d.delegate_id.name} : "
                                                    + d._options_label())
            self.env["eguitra.agenda.notification"]._push(
                d.delegate_id, "delegation", f"Délégation de l'agenda de {d.owner_id.name} modifiée", d._options_label())
        return d

    def revoke(self):
        """Retrait à tout moment : par le mandant, par le délégué qui y renonce, ou par la direction et
        l'administration pour un dirigeant."""
        self.ensure_one()
        d = self.sudo()
        me = self.env.user
        if me != d.delegate_id:
            self._check_manager("retire cette délégation")
        owner, delegate = d.owner_id, d.delegate_id
        d.unlink()
        personal = self.env["eguitra.agenda.calendar"]._ensure_personal(owner)
        self.env["eguitra.agenda.journal"]._log(personal, "delegation_remove",
                                                note=delegate.name + (" (renonciation)" if me == delegate else ""))
        Notification = self.env["eguitra.agenda.notification"]
        if me != delegate:
            Notification._push(delegate, "delegation", f"Vous ne gérez plus l'agenda de {owner.name}", "")
        if me != owner:
            Notification._push(owner, "delegation", f"{delegate.name} ne gère plus votre agenda",
                               "Retrait par " + me.name + ".")
        return True


class AgendaCategory(models.Model):
    _name = "eguitra.agenda.category"
    _description = "Catégorie d'événement"
    _order = "owner_id, sequence, name"

    name = fields.Char("Nom", required=True)
    color = fields.Char("Couleur", required=True, default=COLORS[0])
    owner_id = fields.Many2one("res.users", "Propriétaire", index=True, ondelete="cascade",
                               help="Vide : catégorie commune à tous les comptes.")
    sequence = fields.Integer(default=10)

    @api.model
    def _for(self, user):
        return self.sudo().search(["|", ("owner_id", "=", False), ("owner_id", "=", user.id)])

    @api.model
    def create_mine(self, name, color):
        check_agenda_user(self.env)
        name = clean_line(name, 40)
        if not name:
            raise UserError("Donnez un nom à la catégorie.")
        if self.sudo().search_count([("owner_id", "=", self.env.uid)]) >= 30:
            raise UserError("30 catégories personnelles au plus.")
        return self.sudo().create({"name": name, "color": clean_color(color), "owner_id": self.env.uid})

    def remove_mine(self):
        self.ensure_one()
        cat = self.sudo()
        if cat.owner_id != self.env.user:
            raise AccessError("Seules vos propres catégories se suppriment ; les catégories communes restent.")
        cat.unlink()
        return True


LEVEL_LABELS = {"owner": "Propriétaire", "manage": "Délégation", "write": "Modification", "read": "Lecture",
                "freebusy": "Disponibilités", "book": "Ressource", "none": "Aucun"}
assert set(LEVEL_LABELS) == set(LEVELS)
