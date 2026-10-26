"""Environnement et qualité (spécification §3, §10, lot 3).

- Déversements : volume, produit, lieu, récupération et coût ; lien possible avec un événement du domaine
  environnement (la déclaration reste celle d'Événements). Clos par hsseq une fois la récupération décrite.
- Registre des déchets (huiles usagées, pneus, filtres, autres) : quantité et unité, date, enlèvement par un
  prestataire ; l'enlèvement ne s'enregistre qu'avec le numéro et la pièce du bordereau.
- Poussières sur site : mesures saisies (site, date, valeur, unité, seuil) ; dépassement calculé.
- Contaminations de produit : saisies (nature, volume, mesures), reliées si besoin à une rotation et à un
  événement du domaine qualité.
- Réclamations clients : client, rotation, nature, gravité, réponse et délai (paramètres de la société),
  actions d'origine « réclamation » ; close quand ses actions le sont.
- Consommation et émissions, écarts de livraison : calculés depuis les rotations de Transport (lues, jamais
  ressaisies), par véhicule, site, mois ou rotation.

Les manquants des citernes sont ceux de Transport (volume chargé moins livré, à 15 °C quand la rotation
corrige ses volumes). Une benne est facturée à la tonne : son tonnage chargé est le poids net du ticket de
pesée (à défaut, la quantité chargée), son tonnage livré la quantité livrée, et l'écart retenu leur différence
en valeur absolue (common.tipper_tonnages).
"""

from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .cockpit import month_label, month_start
from .common import (
    COMPLAINT_NATURES,
    COMPLAINT_SEVERITIES,
    COMPLAINT_STATUSES,
    CONTAMINATION_KINDS,
    CONTAMINATION_STATUSES,
    DOMAINS,
    DUST_UNITS,
    SPILL_STATUSES,
    WASTE_DEFAULT_UNIT,
    WASTE_KINDS,
    WASTE_STATUSES,
    WASTE_UNITS,
    HsseqError,
    departed_states,
    tipper_tonnages,
    today,
    vehicle_kind,
)
from .settings import CO2_PER_LITER

OPEN_ACTION = ("todo", "in_progress", "to_verify")
# Regroupements des analyses calculées depuis Transport.
ANALYSIS_GROUPS = ("vehicle", "site", "month", "rotation")


def link_defaults(env, vals):
    """Rattachements par défaut d'une fiche : l'ensemble de sa rotation, puis le site de l'ensemble."""
    if vals.get("rotation_id") and not vals.get("vehicle_id"):
        vals["vehicle_id"] = env["eguitra.transport.rotation"].sudo().browse(vals["rotation_id"]).vehicle_id.id or False
    if vals.get("vehicle_id") and not vals.get("site_id"):
        vals["site_id"] = env["eguitra.transport.vehicle"].sudo().browse(vals["vehicle_id"]).site_id.id or False
    return vals


def check_event_domain(records, domain_code):
    """Un événement lié est du domaine attendu (environnement pour un déversement, qualité pour une
    contamination)."""
    label = dict(DOMAINS)[domain_code].lower()
    for record in records:
        event = record.sudo().event_id
        if event and event.domain != domain_code:
            raise HsseqError("event_domain_mismatch", f"L'événement {event.reference} n'est pas du domaine "
                                                      f"{label} : il ne se rattache pas à cette fiche.",
                             fields=["event_id"])


def require_reason(reason, what):
    if not (reason or "").strip():
        raise HsseqError("reason_required", f"Le motif {what} est obligatoire.", fields=["reason"])
    return reason.strip()


class EguitraHsseqSpill(models.Model):
    _name = "eguitra.hsseq.spill"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Déversement"
    _order = "occurred_at desc, id desc"
    _check_company_auto = True
    _journal_key = "spill"
    _journal_fields = ("occurred_at", "site_id", "location", "event_id", "rotation_id", "vehicle_id", "product_id",
                       "product_label", "volume_liters", "recovered_liters", "recovery", "cost", "status")

    reference = fields.Char("Référence", default="/", copy=False, readonly=True, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    occurred_at = fields.Datetime("Survenu le", required=True, index=True)
    site_id = fields.Many2one("eguitra.hsseq.site", "Site", check_company=True, index=True)
    location = fields.Char("Lieu")
    event_id = fields.Many2one("eguitra.hsseq.event", "Événement lié (environnement)", check_company=True, index=True,
                               ondelete="restrict")
    rotation_id = fields.Many2one("eguitra.transport.rotation", "Rotation", check_company=True, index=True)
    vehicle_id = fields.Many2one("eguitra.transport.vehicle", "Ensemble routier", check_company=True, index=True)
    product_id = fields.Many2one("eguitra.transport.product", "Produit", check_company=True, ondelete="restrict")
    product_label = fields.Char("Autre produit", help="Huile, liquide de refroidissement, eaux souillées…")
    volume_liters = fields.Float("Volume déversé (litres)", required=True, digits=(12, 1))
    recovered_liters = fields.Float("Volume récupéré (litres)", digits=(12, 1))
    recovery_rate = fields.Float("Part récupérée (%)", compute="_compute_recovery_rate", store=True, digits=(5, 1))
    recovery = fields.Text("Récupération et confinement")
    cost = fields.Monetary("Coût (dépollution, produit perdu)")
    status = fields.Selection(SPILL_STATUSES, "Statut", required=True, default="open", index=True)
    reported_by = fields.Many2one("res.users", "Déclaré par", required=True, default=lambda self: self.env.uid,
                                  index=True)
    closed_at = fields.Datetime("Clos le", readonly=True)
    closed_by = fields.Many2one("res.users", "Clos par", readonly=True)
    reopen_reason = fields.Text("Motif de la dernière réouverture", readonly=True)

    @api.depends("volume_liters", "recovered_liters")
    def _compute_recovery_rate(self):
        for spill in self:
            spill.recovery_rate = round(spill.recovered_liters * 100 / spill.volume_liters, 1) \
                if spill.volume_liters else 0.0

    @api.constrains("volume_liters", "recovered_liters")
    def _check_volumes(self):
        for spill in self:
            if spill.volume_liters <= 0 or not 0 <= spill.recovered_liters <= spill.volume_liters:
                raise ValidationError("Volume déversé positif ; volume récupéré entre zéro et le volume déversé.")

    @api.model_create_multi
    def create(self, vals_list):
        Event = self.env["eguitra.hsseq.event"].sudo()
        for vals in vals_list:
            event = Event.browse(vals.get("event_id") or 0).exists()
            if event:
                vals.setdefault("rotation_id", event.rotation_id.id or False)
                vals.setdefault("vehicle_id", event.vehicle_id.id or False)
                vals.setdefault("site_id", event.site_id.id or False)
                vals.setdefault("occurred_at", event.occurred_at)
            link_defaults(self.env, vals)
        spills = super().create(vals_list)
        check_event_domain(spills, "environment")
        for spill in spills:
            spill.reference = self.env["ir.sequence"].sudo().next_by_code("eguitra.hsseq.spill") or "/"
        return spills

    def write(self, vals):
        result = super().write(vals)
        if "event_id" in vals:
            check_event_domain(self, "environment")
        return result

    def _transitions(self):
        self.ensure_one()
        return {"open": ["close"], "closed": ["reopen"]}[self.status]

    def _require(self, transition):
        if transition not in self._transitions():
            raise HsseqError("invalid_transition", f"Transition « {transition} » impossible depuis le statut "
                                                   f"« {dict(SPILL_STATUSES)[self.status]} ».")

    def action_close(self):
        """Clôture par hsseq : la récupération et le confinement sont décrits."""
        self.ensure_one()
        self._require("close")
        if not (self.recovery or "").strip():
            raise HsseqError("recovery_required", "Décrivez la récupération et le confinement avant de clore le "
                                                  "déversement.", fields=["recovery"])
        self.write({"status": "closed", "closed_at": fields.Datetime.now(), "closed_by": self.env.uid})
        self._journal("close")
        return True

    def action_reopen(self, reason):
        self.ensure_one()
        self._require("reopen")
        reason = require_reason(reason, "de la réouverture")
        self.write({"status": "open", "closed_at": False, "closed_by": False, "reopen_reason": reason})
        self._journal("reopen", note=reason)
        return True


class EguitraHsseqWaste(models.Model):
    _name = "eguitra.hsseq.waste"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Déchet du registre HSSEQ"
    _order = "produced_on desc, id desc"
    _check_company_auto = True
    _journal_key = "waste"
    _journal_fields = ("site_id", "waste_kind", "description", "quantity", "unit", "produced_on", "status",
                       "pickup_date", "provider_id", "provider_name", "manifest_reference")

    reference = fields.Char("Référence", default="/", copy=False, readonly=True, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    site_id = fields.Many2one("eguitra.hsseq.site", "Site", check_company=True, index=True)
    waste_kind = fields.Selection(WASTE_KINDS, "Nature", required=True, index=True)
    description = fields.Char("Précision", help="Obligatoire pour un autre déchet.")
    quantity = fields.Float("Quantité", required=True, digits=(12, 2))
    unit = fields.Selection(WASTE_UNITS, "Unité", required=True)
    produced_on = fields.Date("Entreposé le", required=True, default=fields.Date.context_today, index=True)
    status = fields.Selection(WASTE_STATUSES, "Statut", required=True, default="stored", index=True)
    pickup_date = fields.Date("Enlevé le", index=True)
    provider_id = fields.Many2one("res.partner", "Prestataire", ondelete="restrict")
    provider_name = fields.Char("Prestataire (nom)", help="À défaut d'une fiche tiers.")
    manifest_reference = fields.Char("Numéro du bordereau")
    collected_by = fields.Many2one("res.users", "Enlèvement enregistré par", readonly=True)
    note = fields.Text("Observations")
    reopen_reason = fields.Text("Motif de la dernière réouverture", readonly=True)

    @api.constrains("quantity", "waste_kind", "description")
    def _check_quantity(self):
        for waste in self:
            if waste.quantity <= 0:
                raise ValidationError("Quantité de déchet positive.")
            if waste.waste_kind == "other" and not (waste.description or "").strip():
                raise ValidationError("Précisez la nature d'un autre déchet.")

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("waste_kind") and not vals.get("unit"):
                vals["unit"] = WASTE_DEFAULT_UNIT[vals["waste_kind"]]
        wastes = super().create(vals_list)
        for waste in wastes:
            waste.reference = self.env["ir.sequence"].sudo().next_by_code("eguitra.hsseq.waste") or "/"
        return wastes

    def _manifest(self):
        return self.env["eguitra.hsseq.attachment"]._for("waste", self, role="document")

    def _transitions(self):
        self.ensure_one()
        return {"stored": ["collect"], "collected": ["reopen"]}[self.status]

    def _require(self, transition):
        if transition not in self._transitions():
            raise HsseqError("invalid_transition", f"Transition « {transition} » impossible depuis le statut "
                                                   f"« {dict(WASTE_STATUSES)[self.status]} ».")

    def action_collect(self, pickup_date, manifest_reference, provider=None, provider_name=None):
        """Enlèvement par un prestataire : date (au plus aujourd'hui, pas avant l'entreposage), prestataire,
        numéro du bordereau et sa pièce jointe (preuve)."""
        self.ensure_one()
        self._require("collect")
        day = pickup_date or today(self.env)
        if day > today(self.env) or day < self.produced_on:
            raise HsseqError("invalid_parameter", "Date d'enlèvement entre l'entreposage et aujourd'hui.",
                             fields=["pickup_date"], status=400)
        manifest = (manifest_reference or self.manifest_reference or "").strip()
        has_provider = bool(provider or (provider_name or "").strip() or self.provider_id or self.provider_name)
        missing = ([] if manifest else ["manifest_reference"]) + ([] if has_provider else ["provider_id"])
        if missing:
            raise HsseqError("missing_fields", "Prestataire et numéro du bordereau sont obligatoires pour "
                                               "l'enlèvement.", fields=missing, status=400)
        if not self._manifest():
            raise HsseqError("proof_required", "Joignez le bordereau d'enlèvement avant de l'enregistrer.",
                             fields=["attachment_ids"])
        values = {"status": "collected", "pickup_date": day, "manifest_reference": manifest,
                  "collected_by": self.env.uid}
        if provider:
            values["provider_id"] = provider.id
        if (provider_name or "").strip():
            values["provider_name"] = provider_name.strip()
        self.write(values)
        self._journal("collect")
        return True

    def action_reopen(self, reason):
        self.ensure_one()
        self._require("reopen")
        reason = require_reason(reason, "de la réouverture")
        self.write({"status": "stored", "pickup_date": False, "collected_by": False, "reopen_reason": reason})
        self._journal("reopen", note=reason)
        return True


class EguitraHsseqDust(models.Model):
    _name = "eguitra.hsseq.dust"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Mesure de poussières sur site"
    _order = "measured_on desc, id desc"
    _check_company_auto = True
    _journal_key = "dust"
    _journal_fields = ("site_id", "measured_on", "point", "value", "unit", "threshold", "method")

    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    site_id = fields.Many2one("eguitra.hsseq.site", "Site", required=True, check_company=True, index=True)
    measured_on = fields.Date("Mesuré le", required=True, default=fields.Date.context_today, index=True)
    point = fields.Char("Point de mesure", help="Piste d'accès, aire de chargement, quai…")
    value = fields.Float("Valeur", required=True, digits=(12, 3))
    unit = fields.Selection(DUST_UNITS, "Unité", required=True, default="mg_m3")
    threshold = fields.Float("Seuil", required=True, digits=(12, 3), help="Dans l'unité de la mesure.")
    exceeded = fields.Boolean("Seuil dépassé", compute="_compute_exceeded", store=True, index=True)
    method = fields.Char("Appareil ou méthode")
    note = fields.Text("Observations")
    measured_by = fields.Many2one("res.users", "Saisie par", required=True, default=lambda self: self.env.uid)

    @api.depends("value", "threshold")
    def _compute_exceeded(self):
        for measure in self:
            measure.exceeded = measure.value > measure.threshold

    @api.constrains("value", "threshold")
    def _check_values(self):
        for measure in self:
            if measure.value < 0 or measure.threshold <= 0:
                raise ValidationError("Valeur positive ou nulle, seuil positif.")


class EguitraHsseqContamination(models.Model):
    _name = "eguitra.hsseq.contamination"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Contamination de produit"
    _order = "detected_on desc, id desc"
    _check_company_auto = True
    _journal_key = "contamination"
    _journal_fields = ("detected_on", "nature", "rotation_id", "vehicle_id", "site_id", "product_id", "volume_m3",
                       "description", "measures", "cost", "event_id", "status")

    reference = fields.Char("Référence", default="/", copy=False, readonly=True, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    detected_on = fields.Date("Constatée le", required=True, default=fields.Date.context_today, index=True)
    nature = fields.Selection(CONTAMINATION_KINDS, "Nature", required=True)
    rotation_id = fields.Many2one("eguitra.transport.rotation", "Rotation", check_company=True, index=True)
    vehicle_id = fields.Many2one("eguitra.transport.vehicle", "Ensemble routier", check_company=True, index=True)
    site_id = fields.Many2one("eguitra.hsseq.site", "Site", check_company=True, index=True)
    product_id = fields.Many2one("eguitra.transport.product", "Produit", check_company=True, ondelete="restrict")
    volume_m3 = fields.Float("Volume touché (m³)", digits=(12, 3))
    description = fields.Text("Constat", required=True)
    measures = fields.Text("Mesures prises")
    cost = fields.Monetary("Coût")
    event_id = fields.Many2one("eguitra.hsseq.event", "Événement lié (qualité)", check_company=True, index=True,
                               ondelete="restrict")
    status = fields.Selection(CONTAMINATION_STATUSES, "Statut", required=True, default="open", index=True)
    closed_at = fields.Datetime("Close le", readonly=True)
    closed_by = fields.Many2one("res.users", "Close par", readonly=True)
    reopen_reason = fields.Text("Motif de la dernière réouverture", readonly=True)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            link_defaults(self.env, vals)
            if vals.get("rotation_id") and not vals.get("product_id"):
                vals["product_id"] = self.env["eguitra.transport.rotation"].sudo().browse(
                    vals["rotation_id"]).product_id.id or False
        records = super().create(vals_list)
        check_event_domain(records, "quality")
        for record in records:
            record.reference = self.env["ir.sequence"].sudo().next_by_code("eguitra.hsseq.contamination") or "/"
        return records

    def write(self, vals):
        result = super().write(vals)
        if "event_id" in vals:
            check_event_domain(self, "quality")
        return result

    def _transitions(self):
        self.ensure_one()
        return {"open": ["close"], "closed": ["reopen"]}[self.status]

    def _require(self, transition):
        if transition not in self._transitions():
            raise HsseqError("invalid_transition", f"Transition « {transition} » impossible depuis le statut "
                                                   f"« {dict(CONTAMINATION_STATUSES)[self.status]} ».")

    def action_close(self):
        self.ensure_one()
        self._require("close")
        if not (self.measures or "").strip():
            raise HsseqError("measures_required", "Décrivez les mesures prises avant de clore la contamination.",
                             fields=["measures"])
        self.write({"status": "closed", "closed_at": fields.Datetime.now(), "closed_by": self.env.uid})
        self._journal("close")
        return True

    def action_reopen(self, reason):
        self.ensure_one()
        self._require("reopen")
        reason = require_reason(reason, "de la réouverture")
        self.write({"status": "open", "closed_at": False, "closed_by": False, "reopen_reason": reason})
        self._journal("reopen", note=reason)
        return True


class EguitraHsseqComplaint(models.Model):
    _name = "eguitra.hsseq.complaint"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Réclamation client"
    _order = "received_on desc, id desc"
    _check_company_auto = True
    _journal_key = "complaint"
    _journal_fields = ("partner_id", "rotation_id", "site_id", "received_on", "nature", "severity", "description",
                       "response", "responded_on", "response_due", "status")

    reference = fields.Char("Référence", default="/", copy=False, readonly=True, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    partner_id = fields.Many2one("res.partner", "Client", required=True, index=True)
    rotation_id = fields.Many2one("eguitra.transport.rotation", "Rotation", check_company=True, index=True)
    vehicle_id = fields.Many2one("eguitra.transport.vehicle", "Ensemble routier", check_company=True, index=True)
    site_id = fields.Many2one("eguitra.hsseq.site", "Site", check_company=True, index=True)
    received_on = fields.Date("Reçue le", required=True, default=fields.Date.context_today, index=True)
    nature = fields.Selection(COMPLAINT_NATURES, "Nature", required=True, index=True)
    severity = fields.Selection(COMPLAINT_SEVERITIES, "Gravité", required=True, default="minor", index=True)
    description = fields.Text("Réclamation", required=True)
    response_due = fields.Date("Réponse attendue avant le", compute="_compute_response_due", store=True,
                               readonly=False, index=True)
    response = fields.Text("Réponse au client")
    responded_on = fields.Date("Répondue le", index=True)
    responded_by = fields.Many2one("res.users", "Répondue par", readonly=True)
    response_days = fields.Integer("Délai de réponse (jours)", compute="_compute_delay", store=True)
    on_time = fields.Boolean("Répondue dans le délai", compute="_compute_delay", store=True)
    status = fields.Selection(COMPLAINT_STATUSES, "Statut", required=True, default="received", index=True)
    action_ids = fields.One2many("eguitra.hsseq.action", "complaint_id", "Actions")
    closed_at = fields.Datetime("Close le", readonly=True)
    closed_by = fields.Many2one("res.users", "Close par", readonly=True)
    reopen_reason = fields.Text("Motif de la dernière réouverture", readonly=True)

    @api.depends("received_on", "company_id")
    def _compute_response_due(self):
        Settings = self.env["eguitra.hsseq.settings"]
        for complaint in self:
            days = Settings._get(complaint.company_id or self.env.company).complaint_response_days or 15
            complaint.response_due = complaint.received_on + timedelta(days=days) if complaint.received_on else False

    @api.depends("received_on", "responded_on", "response_due")
    def _compute_delay(self):
        for complaint in self:
            done = complaint.responded_on
            complaint.response_days = (done - complaint.received_on).days if done and complaint.received_on else 0
            complaint.on_time = bool(done and complaint.response_due and done <= complaint.response_due)

    @api.model_create_multi
    def create(self, vals_list):
        Rotation = self.env["eguitra.transport.rotation"].sudo()
        for vals in vals_list:
            rotation = Rotation.browse(vals.get("rotation_id") or 0).exists()
            if rotation and not vals.get("partner_id"):
                vals["partner_id"] = rotation.partner_id.id
            link_defaults(self.env, vals)
        complaints = super().create(vals_list)
        complaints._check_rotation_partner()
        for complaint in complaints:
            complaint.reference = self.env["ir.sequence"].sudo().next_by_code("eguitra.hsseq.complaint") or "/"
        return complaints

    def write(self, vals):
        result = super().write(vals)
        if {"rotation_id", "partner_id"} & set(vals):
            self._check_rotation_partner()
        return result

    def _check_rotation_partner(self):
        for complaint in self:
            rotation = complaint.sudo().rotation_id
            if rotation and rotation.partner_id != complaint.partner_id:
                raise HsseqError("rotation_partner_mismatch", f"La rotation {rotation.name} est celle d'un autre "
                                                              "client.", fields=["rotation_id"])

    def _open_actions(self):
        self.ensure_one()
        return self.action_ids.filtered(lambda a: a.status in OPEN_ACTION)

    def _overdue(self, day=None):
        self.ensure_one()
        day = day or today(self.env)
        return self.status == "received" and bool(self.response_due) and self.response_due < day

    def _transitions(self):
        self.ensure_one()
        return {"received": ["answer"], "answered": ["answer", "close"], "closed": ["reopen"]}[self.status]

    def _require(self, transition):
        if transition not in self._transitions():
            raise HsseqError("invalid_transition", f"Transition « {transition} » impossible depuis le statut "
                                                   f"« {dict(COMPLAINT_STATUSES)[self.status]} ».")

    def action_answer(self, response, responded_on=None):
        """Réponse au client (texte obligatoire), datée au plus d'aujourd'hui et pas avant la réception ; une
        réponse déjà donnée peut être complétée."""
        self.ensure_one()
        self._require("answer")
        if not (response or "").strip():
            raise HsseqError("missing_fields", "La réponse au client est à rédiger.", fields=["response"], status=400)
        day = responded_on or today(self.env)
        if day > today(self.env) or day < self.received_on:
            raise HsseqError("invalid_parameter", "Date de réponse entre la réception et aujourd'hui.",
                             fields=["responded_on"], status=400)
        self.write({"status": "answered", "response": response.strip(), "responded_on": day,
                    "responded_by": self.env.uid})
        self._journal("answer")
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
        reason = require_reason(reason, "de la réouverture")
        self.write({"status": "answered", "closed_at": False, "closed_by": False, "reopen_reason": reason})
        self._journal("reopen", note=reason)
        return True


class EguitraHsseqEnvironment(models.AbstractModel):
    """Analyses calculées depuis les rotations parties de Transport (en route, validées, facturées), chargées
    dans la période : consommation et émissions, écarts de livraison des citernes et des bennes."""

    _name = "eguitra.hsseq.environment"
    _description = "Analyses d'environnement HSSEQ"

    @api.model
    def _rotations(self, companies, start, end, sites=None, kind=None):
        domain = [("company_id", "in", companies.ids), ("state", "in", departed_states(self.env)),
                  ("date_loading", ">=", start), ("date_loading", "<=", end)]
        if sites is not None:
            domain.append(("vehicle_id.site_id", "in", sites.ids))
        if kind:
            domain.append(("vehicle_id.vehicle_kind", "=", kind))
        return self.env["eguitra.transport.rotation"].sudo().search(domain, order="date_loading, id")

    @staticmethod
    def _key(rotation, group_by):
        if group_by == "site":
            site = rotation.vehicle_id.site_id
            return site.id or 0, site.name or "Sans site"
        if group_by == "month":
            return rotation.date_loading.strftime("%Y-%m"), month_label(month_start(rotation.date_loading))
        if group_by == "rotation":
            return rotation.id, rotation.name if rotation.name != "/" else f"Rotation {rotation.id}"
        return rotation.vehicle_id.id, rotation.vehicle_id.name

    @api.model
    def _factors(self, companies):
        Settings = self.env["eguitra.hsseq.settings"]
        return {c.id: Settings._get(c).co2_factor or CO2_PER_LITER for c in companies}

    @staticmethod
    def _consumption_row():
        return {"rotations": 0, "km": 0.0, "fuel_liters": 0.0, "fuel_km": 0.0, "co2_kg": 0.0}

    @staticmethod
    def _finish_consumption(row):
        fuel_km = row["fuel_km"]
        return dict(row, km=round(row["km"], 1), fuel_liters=round(row["fuel_liters"], 1),
                    fuel_km=round(fuel_km, 1), co2_kg=round(row["co2_kg"], 1),
                    l_100km=round(row["fuel_liters"] * 100 / fuel_km, 1) if fuel_km else None,
                    co2_kg_per_km=round(row["co2_kg"] / fuel_km, 2) if fuel_km else None)

    @api.model
    def _consumption(self, companies, start, end, sites=None, kind=None, group_by="vehicle"):
        """Litres aux 100 km et kg de CO₂ par km (facteur d'émission des paramètres de chaque société), sur
        les rotations dont le carburant est saisi ; kilomètres de toutes les rotations parties."""
        factors = self._factors(companies)
        groups, total = {}, self._consumption_row()
        for rot in self._rotations(companies, start, end, sites, kind):
            key = self._key(rot, group_by)
            for row in (groups.setdefault(key, self._consumption_row()), total):
                row["rotations"] += 1
                row["km"] += rot.distance_km or 0.0
                if rot.fuel_liters:
                    row["fuel_liters"] += rot.fuel_liters
                    row["fuel_km"] += rot.distance_km or 0.0
                    row["co2_kg"] += rot.fuel_liters * factors.get(rot.company_id.id, CO2_PER_LITER)
        items = [dict(self._finish_consumption(row), key=key[0], label=key[1]) for key, row in groups.items()]
        return {"group_by": group_by, "items": items, "totals": self._finish_consumption(total),
                "factors": [{"company_id": c.id, "company": c.name, "co2_factor": factors[c.id]} for c in companies]}

    @staticmethod
    def _delivery_rows():
        return ({"rotations": 0, "loaded_15": 0.0, "delivered_15": 0.0, "delivered": 0.0, "shortage": 0.0},
                {"rotations": 0, "loaded_t": 0.0, "delivered_t": 0.0, "variance_t": 0.0})

    @staticmethod
    def _finish_tanker(row):
        return dict({k: round(v, 3) if isinstance(v, float) else v for k, v in row.items()},
                    per_mille=round(row["shortage"] * 1000 / row["delivered"], 2) if row["delivered"] else None)

    @staticmethod
    def _finish_tipper(row):
        return dict({k: round(v, 3) if isinstance(v, float) else v for k, v in row.items()},
                    per_mille=round(row["variance_t"] * 1000 / row["loaded_t"], 2) if row["loaded_t"] else None)

    @api.model
    def _deliveries(self, companies, start, end, sites=None, kind=None, group_by="vehicle"):
        """Écarts de livraison des rotations livrées : citernes, volume manquant ÷ volume livré (‰) ; bennes,
        écart de tonnage ÷ tonnage chargé (‰)."""
        tanker, tipper = {}, {}
        total_tanker, total_tipper = self._delivery_rows()
        for rot in self._rotations(companies, start, end, sites, kind):
            key = self._key(rot, group_by)
            if vehicle_kind(rot.vehicle_id) == "tipper":
                loaded, delivered = tipper_tonnages(rot)
                if not delivered:
                    continue
                for row in (tipper.setdefault(key, self._delivery_rows()[1]), total_tipper):
                    row["rotations"] += 1
                    row["loaded_t"] += loaded
                    row["delivered_t"] += delivered
                    row["variance_t"] += abs(loaded - delivered)
            elif rot.volume_delivered:
                for row in (tanker.setdefault(key, self._delivery_rows()[0]), total_tanker):
                    row["rotations"] += 1
                    row["loaded_15"] += rot.volume_loaded_15 or 0.0
                    row["delivered_15"] += rot.volume_delivered_15 or 0.0
                    row["delivered"] += rot.volume_delivered or 0.0
                    row["shortage"] += rot.shortage or 0.0
        return {
            "group_by": group_by,
            "tanker": {"items": [dict(self._finish_tanker(r), key=k[0], label=k[1]) for k, r in tanker.items()],
                       "totals": self._finish_tanker(total_tanker)},
            "tipper": {"items": [dict(self._finish_tipper(r), key=k[0], label=k[1]) for k, r in tipper.items()],
                       "totals": self._finish_tipper(total_tipper)},
        }
