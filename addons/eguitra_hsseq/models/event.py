"""Événements HSSEQ (spécification §3, §7, §9.1) : déclaration (web ou NIMOVA Terrain, hors ligne
possible), classement et criticité, enquête (analyse simple, 5 Pourquoi, arbre des causes, 5M), plan
d'actions, clôture. Cycle : déclaré, classé, enquête, actions, clôturé ; une fiche close ne se rouvre que
par le profil hsseq, avec un motif.

Criticité retenue = gravité potentielle × probabilité (notes de 1 à 5) ; niveau et délais d'enquête selon
les paramètres de la société (eguitra.hsseq.settings). Effets du classement : échéance d'enquête,
notification du Directeur général (élevée) ou du Responsable HSSEQ et du responsable métier
(significative). L'immobilisation du véhicule (V09) viendra au lot 2.
"""

from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .common import (
    COST_KINDS,
    DOMAINS,
    EVENT_STATUSES,
    EVENT_TYPES,
    HSSEQ_GROUP,
    LEVEL_METHOD,
    LEVELS,
    METHODS,
    PERSON_KINDS,
    PERSON_ROLES,
    TYPE_DOMAIN,
    HsseqError,
    users_in_group,
)

LEVEL_LABELS = dict(LEVELS)


class EguitraHsseqEvent(models.Model):
    _name = "eguitra.hsseq.event"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Événement HSSEQ"
    _order = "occurred_at desc, id desc"
    _check_company_auto = True
    _journal_key = "event"
    _journal_fields = ("title", "event_type", "domain", "status", "occurred_at", "location", "description",
                       "site_id", "rotation_id", "vehicle_id", "actual_severity", "potential_severity", "probability",
                       "lost_time", "days_lost", "leave_id", "investigation_method", "immediate_causes", "root_cause",
                       "conclusion", "client_notified_at")

    reference = fields.Char("Référence", default="/", copy=False, readonly=True, index=True)
    title = fields.Char("Titre", required=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    event_type = fields.Selection(EVENT_TYPES, "Type", required=True, index=True)
    domain = fields.Selection(DOMAINS, "Domaine", required=True)
    status = fields.Selection(EVENT_STATUSES, "Statut", required=True, default="reported", index=True)
    occurred_at = fields.Datetime("Survenu le", required=True, index=True)
    location = fields.Char("Lieu")
    latitude = fields.Float("Latitude", digits=(10, 6))
    longitude = fields.Float("Longitude", digits=(10, 6))
    gps_accuracy = fields.Float("Précision de la position (m)", digits=(8, 1))
    description = fields.Text("Description", required=True)

    # Saisie : heure de saisie sur l'appareil distincte de la réception par le noyau (§11).
    source = fields.Selection([("web", "Web"), ("terrain", "NIMOVA Terrain")], "Saisi depuis", default="web")
    client_uuid = fields.Char("Identifiant de saisie", copy=False, index=True)
    reported_at = fields.Datetime("Saisi le", required=True, default=fields.Datetime.now)
    synced_at = fields.Datetime("Reçu le", required=True, default=fields.Datetime.now, readonly=True)
    offline = fields.Boolean("Saisi hors ligne")
    reported_by = fields.Many2one("res.users", "Déclaré par", required=True, default=lambda self: self.env.uid,
                                  index=True)

    site_id = fields.Many2one("eguitra.hsseq.site", "Site", check_company=True, index=True)
    rotation_id = fields.Many2one("eguitra.transport.rotation", "Rotation", check_company=True, index=True)
    vehicle_id = fields.Many2one("eguitra.transport.vehicle", "Ensemble routier", check_company=True, index=True)
    person_ids = fields.One2many("eguitra.hsseq.event.person", "event_id", "Personnes en cause")
    lost_time = fields.Boolean("Arrêt de travail")
    days_lost = fields.Integer("Jours perdus")
    leave_id = fields.Many2one("eguitra.rh.leave", "Arrêt RH", ondelete="set null",
                               help="Absence pour accident du travail enregistrée par la RH.")
    vehicle_immobilized = fields.Boolean("Véhicule immobilisé", help="Motif V09, lot 2.")

    # ─── Notes du déclarant, gardées à part du classement ─────────────────
    declared_actual_severity = fields.Integer("Gravité réelle déclarée (1 à 5)", readonly=True)
    declared_potential_severity = fields.Integer("Gravité potentielle déclarée (1 à 5)", readonly=True)
    declared_probability = fields.Integer("Probabilité déclarée (1 à 5)", readonly=True)

    # ─── Classement (§9.1) ────────────────────────────────────────────────
    actual_severity = fields.Integer("Gravité réelle (1 à 5)")
    potential_severity = fields.Integer("Gravité potentielle (1 à 5)")
    probability = fields.Integer("Probabilité (1 à 5)")
    criticality = fields.Integer("Criticité", compute="_compute_criticality", store=True, index=True)
    level = fields.Selection(LEVELS, "Niveau", compute="_compute_criticality", store=True, index=True)
    classified_at = fields.Datetime("Classé le", readonly=True)
    classified_by = fields.Many2one("res.users", "Classé par", readonly=True)
    investigation_due = fields.Datetime("Échéance de l'enquête", index=True)
    client_notice_due = fields.Datetime("Information du donneur d'ordre avant le")
    client_notified_at = fields.Datetime("Donneur d'ordre informé le")

    # ─── Enquête ──────────────────────────────────────────────────────────
    investigation_method = fields.Selection(METHODS, "Méthode d'enquête")
    investigation_team_ids = fields.Many2many("res.users", "eguitra_hsseq_event_team_rel", "event_id", "user_id",
                                              "Équipe d'enquête")
    immediate_causes = fields.Text("Causes immédiates")
    whys = fields.Json("5 Pourquoi")
    cause_tree = fields.Json("Arbre des causes", help="Faits : id, label, parent_id, kind (unusual_fact, permanent_fact).")
    factor_environment = fields.Text("Milieu")
    factor_equipment = fields.Text("Matériel")
    factor_method = fields.Text("Méthode")
    factor_manpower = fields.Text("Main-d'œuvre")
    factor_material = fields.Text("Matière")
    root_cause = fields.Text("Cause racine")
    conclusion = fields.Text("Conclusion")
    investigation_started_at = fields.Datetime("Enquête ouverte le", readonly=True)
    investigation_closed_at = fields.Datetime("Enquête conclue le", readonly=True)

    # ─── Suite ────────────────────────────────────────────────────────────
    action_ids = fields.One2many("eguitra.hsseq.action", "event_id", "Actions")
    cost_ids = fields.One2many("eguitra.hsseq.event.cost", "event_id", "Coûts")
    total_cost = fields.Monetary("Coût total", compute="_compute_total_cost", store=True)
    closed_at = fields.Datetime("Clôturé le", readonly=True)
    closed_by = fields.Many2one("res.users", "Clôturé par", readonly=True)
    reopen_reason = fields.Text("Motif de la dernière réouverture", readonly=True)

    _client_uuid_unique = models.Constraint("unique(client_uuid)", "Cette déclaration a déjà été reçue.")

    @api.constrains("actual_severity", "potential_severity", "probability", "declared_actual_severity",
                    "declared_potential_severity", "declared_probability")
    def _check_notes(self):
        for event in self:
            for name in ("actual_severity", "potential_severity", "probability", "declared_actual_severity",
                         "declared_potential_severity", "declared_probability"):
                if event[name] and not 1 <= event[name] <= 5:
                    raise ValidationError("Gravités et probabilité se notent de 1 à 5.")

    @api.depends("potential_severity", "probability", "company_id")
    def _compute_criticality(self):
        for event in self:
            event.criticality = (event.potential_severity or 0) * (event.probability or 0)
            event.level = self.env["eguitra.hsseq.settings"]._level_of(event.company_id, event.criticality)

    @api.depends("cost_ids.amount")
    def _compute_total_cost(self):
        for event in self:
            event.total_cost = sum(event.cost_ids.mapped("amount"))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("event_type") and not vals.get("domain"):
                vals["domain"] = TYPE_DOMAIN.get(vals["event_type"], "safety")
            if vals.get("vehicle_id") and not vals.get("site_id"):
                vals["site_id"] = self.env["eguitra.transport.vehicle"].sudo().browse(vals["vehicle_id"]).site_id.id
        events = super().create(vals_list)
        for event in events:
            event.reference = self.env["ir.sequence"].sudo().next_by_code("eguitra.hsseq.event") or "/"
            event._notify_reported()
        return events

    # ─── Règles ───────────────────────────────────────────────────────────

    def _settings(self):
        self.ensure_one()
        return self.env["eguitra.hsseq.settings"]._get(self.company_id)

    def _open_actions(self):
        self.ensure_one()
        return self.action_ids.filtered(lambda a: a.status not in ("closed", "cancelled"))

    def _investigation_overdue(self, now=None):
        self.ensure_one()
        now = now or fields.Datetime.now()
        return bool(self.status in ("classified", "investigation") and self.investigation_due
                    and self.investigation_due < now)

    def _transitions(self):
        """Transitions permises depuis le statut, à charge pour l'appelant de vérifier le profil (hsseq)."""
        self.ensure_one()
        return {
            "reported": ["classify"],
            "classified": ["investigate"] + (["close"] if self.level == "low" and not self.action_ids else []),
            "investigation": ["plan"],
            "actions": ["close"],
            "closed": ["reopen"],
        }[self.status]

    def _require(self, transition):
        if transition not in self._transitions():
            raise HsseqError("invalid_transition", f"Transition « {transition} » impossible depuis le statut "
                                                   f"« {dict(EVENT_STATUSES)[self.status]} ».")

    def action_classify(self, values):
        """Classement : notes, type et domaine éventuels ; criticité, niveau, échéances et notifications."""
        self.ensure_one()
        self._require("classify")
        missing = [k for k in ("potential_severity", "probability") if not (values.get(k) or self[k])]
        if missing:
            raise HsseqError("missing_fields", "Gravité potentielle et probabilité sont à noter pour classer.",
                             fields=missing, status=400)
        now = fields.Datetime.now()
        self.write(dict(values, status="classified", classified_at=now, classified_by=self.env.uid))
        settings = self._settings()
        delay = settings._investigation_delay(self.level)
        base = self.reported_at or self.synced_at or now
        self.write({
            "investigation_due": base + delay if delay else False,
            "client_notice_due": base + timedelta(hours=settings.client_notice_hours) if self.level == "high" else False,
        })
        self._journal("classify", note=f"Criticité {self.criticality}, niveau {LEVEL_LABELS.get(self.level, '-')}")
        self._notify_level()
        return True

    def action_investigate(self, method=None, team=None):
        self.ensure_one()
        self._require("investigate")
        values = {"status": "investigation", "investigation_started_at": fields.Datetime.now(),
                  "investigation_method": method or self.investigation_method or LEVEL_METHOD.get(self.level or "low")}
        if team is not None:
            values["investigation_team_ids"] = [fields.Command.set(team.ids)]
        self.write(values)
        self._journal("investigate")
        return True

    def action_plan(self):
        self.ensure_one()
        self._require("plan")
        if not (self.root_cause or "").strip():
            raise HsseqError("root_cause_missing", "Renseignez la cause racine avant de passer aux actions.",
                             fields=["root_cause"])
        self.write({"status": "actions", "investigation_closed_at": fields.Datetime.now()})
        self._journal("plan")
        return True

    def action_close(self):
        self.ensure_one()
        self._require("close")
        open_actions = self._open_actions()
        if open_actions:
            raise HsseqError("actions_open", f"{len(open_actions)} action(s) ni close(s) ni annulée(s) : "
                                             f"{', '.join(open_actions.mapped('reference'))}.")
        self.write({"status": "closed", "closed_at": fields.Datetime.now(), "closed_by": self.env.uid})
        self._journal("close")
        return True

    def action_reopen(self, reason):
        self.ensure_one()
        self._require("reopen")
        if not (reason or "").strip():
            raise HsseqError("reason_required", "Le motif de la réouverture est obligatoire.", fields=["reason"])
        if self.action_ids:
            status = "actions"
        elif self.investigation_started_at:
            status = "investigation"
        else:
            status = "classified"
        self.write({"status": status, "closed_at": False, "closed_by": False, "reopen_reason": reason.strip()})
        self._journal("reopen", note=reason.strip())
        return True

    # ─── Notifications (§9.1) ─────────────────────────────────────────────

    def _hsseq_managers(self):
        return users_in_group(self.env, HSSEQ_GROUP, self.company_id)

    def _summary(self):
        when = fields.Datetime.context_timestamp(self, self.occurred_at).strftime("%d/%m/%Y %H:%M")
        parts = [f"{self.reference} : {self.title}", f"{dict(EVENT_TYPES)[self.event_type]}, le {when}"]
        if self.location:
            parts.append(f"Lieu : {self.location}")
        if self.vehicle_id:
            parts.append(f"Ensemble : {self.vehicle_id.sudo().name}")
        return "\n".join(parts)

    def _notify_reported(self):
        """Toute déclaration prévient le Responsable HSSEQ (contrat §5)."""
        Notification = self.env["eguitra.hsseq.notification"]
        for event in self:
            Notification._notify(event._hsseq_managers(), "reported", f"Événement déclaré : {event.title}",
                                 event._summary(), event, "event")

    def _notify_level(self):
        """Élevée : notification immédiate du Directeur général (et du Responsable HSSEQ) ; significative :
        Responsable HSSEQ et responsable métier (chefs de parc du site de l'événement)."""
        Notification = self.env["eguitra.hsseq.notification"]
        for event in self:
            body = f"{event._summary()}\nCriticité {event.criticality} ({LEVEL_LABELS.get(event.level, '')})."
            if event.level == "high":
                users = event._settings()._directors() | event._hsseq_managers()
                Notification._notify(users, "high", f"Criticité élevée : {event.title}",
                                     body + "\nEnquête approfondie (arbre des causes) sous 72 h ; information du "
                                            "donneur d'ordre sous 24 h.", event, "event")
            elif event.level == "significant":
                users = event._hsseq_managers() | event.site_id.sudo().manager_ids
                Notification._notify(users, "significant", f"Criticité significative : {event.title}",
                                     body + "\nEnquête 5 Pourquoi sous 7 jours.", event, "event")


class EguitraHsseqEventPerson(models.Model):
    _name = "eguitra.hsseq.event.person"
    _description = "Personne en cause dans un événement HSSEQ"
    _order = "id"

    event_id = fields.Many2one("eguitra.hsseq.event", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="event_id.company_id", store=True, index=True)
    kind = fields.Selection(PERSON_KINDS, "Personne", required=True)
    driver_id = fields.Many2one("eguitra.transport.driver", "Chauffeur", ondelete="restrict")
    employee_id = fields.Many2one("eguitra.rh.employee", "Salarié", ondelete="restrict")
    name = fields.Char("Nom", help="Tiers : son nom ; sinon celui du chauffeur ou du salarié.")
    role = fields.Selection(PERSON_ROLES, "Rôle", required=True, default="victim")
    days_off = fields.Integer("Jours d'arrêt")

    def _display(self):
        self.ensure_one()
        person = self.sudo()
        return person.driver_id.name or person.employee_id.name or person.name or ""


class EguitraHsseqEventCost(models.Model):
    _name = "eguitra.hsseq.event.cost"
    _description = "Coût d'un événement HSSEQ"
    _order = "date, id"

    event_id = fields.Many2one("eguitra.hsseq.event", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="event_id.company_id", store=True, index=True)
    currency_id = fields.Many2one(related="event_id.currency_id")
    kind = fields.Selection(COST_KINDS, "Nature", required=True)
    label = fields.Char("Libellé")
    amount = fields.Monetary("Montant", required=True)
    date = fields.Date("Date", default=fields.Date.context_today)
    finance_move_id = fields.Many2one("account.move", "Pièce comptable", ondelete="set null")
