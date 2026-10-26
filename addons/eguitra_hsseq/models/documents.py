"""Documents et urgences (spécification §3, §9.4, lot 3).

- Procédures versionnées : référence, titre, versions datées (date d'effet, pièce jointe, résumé des
  changements), public visé par profils et par sites. Publier une version la met en vigueur (la précédente
  est remplacée) et demande sa lecture aux comptes visés : accusé de lecture par version, taux de lecture,
  relance des comptes qui ne l'ont pas lue (à la demande et à l'intervalle des paramètres).
- Alertes flash et retours d'expérience diffusés aux conducteurs, toujours anonymisés (§9.4) : à la
  diffusion, le noyau refuse un texte qui cite un nom de personne (conducteurs, salariés, comptes, personnes
  de l'événement d'origine) ou une immatriculation (ou le code d'un ensemble). Accusé de lecture comme une
  procédure ; ni pièce jointe ni événement d'origine servis aux lecteurs.
- Plans d'intervention d'urgence par site et par scénario (déversement, incendie, accident de la route,
  intrusion…) : conduite à tenir, moyens, contacts ; exercices planifiés puis réalisés avec leur bilan et
  leurs actions (origine « exercice »).
- Annuaire de crise : fonction, nom, téléphones, ordre d'appel, site (vide : tous les sites).

Public visé : un compte est visé s'il porte l'un des profils du document, est ouvert à sa société et se
rapporte à l'un de ses sites (un document sans site vaut pour tous les sites ; un profil de lecture complète
se rapporte à tous les sites ; un chef de parc à ses sites ; un conducteur au site de son ensemble ; un
auditeur à son périmètre).
"""

import re
import unicodedata

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .common import (
    AUDIENCE_PROFILES,
    BULLETIN_KINDS,
    BULLETIN_STATUSES,
    DOMAINS,
    DRILL_STATUSES,
    PROCEDURE_STATUSES,
    SCENARIOS,
    VERSION_STATUSES,
    HsseqError,
    today,
)

# Forme d'une immatriculation écrite d'un bloc ou avec des tirets (« RC-1234-A », « RC1234A ») ; les plaques
# écrites avec des espaces sont reconnues quand elles sont celles d'un ensemble enregistré.
PLATE_SHAPE = re.compile(r"\b[A-Z]{1,3}-?\d{3,4}-?[A-Z]{1,3}\b")
BULLETIN_TEXT_FIELDS = ("title", "body", "key_messages")


def plain(value):
    """Texte comparable : sans accents, en minuscules, mots séparés par une espace."""
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def name_forms(name):
    """Formes d'un nom à rechercher : complet, inversé, premier et dernier mots dans les deux ordres (sans
    les précisions entre parenthèses) ; aucune pour un nom d'un seul mot, trop commun pour être cherché seul."""
    parts = plain(re.sub(r"\(.*?\)", " ", name or "")).split()
    if len(parts) < 2:
        return set()
    return {" ".join(parts), " ".join(reversed(parts)), f"{parts[0]} {parts[-1]}", f"{parts[-1]} {parts[0]}"}


def compact_windows(tokens, size=4):
    """Suites d'un à `size` mots consécutifs, accolées (« rc 1234 a » donne « rc1234a »)."""
    return {"".join(tokens[i:i + n]) for i in range(len(tokens)) for n in range(1, size + 1) if i + n <= len(tokens)}


def require_reason(reason, what):
    if not (reason or "").strip():
        raise HsseqError("reason_required", f"Le motif {what} est obligatoire.", fields=["reason"])
    return reason.strip()


class EguitraHsseqAudience(models.AbstractModel):
    """Public visé d'un document diffusé (procédure, alerte, retour d'expérience) : profils et sites (champ
    site_ids déclaré par chaque modèle, sur sa propre table de relation)."""

    _name = "eguitra.hsseq.audience"
    _description = "Public visé d'un document HSSEQ"

    audience_profiles = fields.Json("Profils visés", default=lambda self: ["conducteur"],
                                    help="Codes de profil : conducteur, exploitation, hsseq, direction, rh, admin.")

    @api.constrains("audience_profiles")
    def _check_audience(self):
        for record in self:
            codes = record.audience_profiles
            if not isinstance(codes, list) or not codes or set(codes) - set(AUDIENCE_PROFILES):
                raise ValidationError("Public visé : au moins un profil parmi " + ", ".join(AUDIENCE_PROFILES) + ".")

    def _applies_to_sites(self, sites):
        """Le document se rapporte-t-il à ces sites (None : tous les sites) ? Sans site visé : tous les sites."""
        self.ensure_one()
        if sites is None or not self.site_ids:
            return True
        return bool(self.site_ids & sites)

    def _applies_to(self, user, entry=None):
        """Le compte est-il visé par le document ? entry : (profils, sites) du compte, déjà calculés."""
        self.ensure_one()
        user = user.sudo()
        if user.share or not user.active or self.company_id not in user.company_ids:
            return False
        user_profiles, sites = entry or (set(user._eguitra_profiles()), None)
        if not user_profiles & set(self.audience_profiles or []):
            return False
        return self._applies_to_sites(sites if entry else user._hsseq_audience_sites())

    @api.model
    def _audience_index(self, companies):
        """Comptes internes actifs des sociétés, avec leurs profils et leurs sites, calculés une fois pour
        évaluer le public de plusieurs documents."""
        users = self.env["res.users"].sudo().search([("share", "=", False), ("company_ids", "in", companies.ids)])
        return [(user, set(user._eguitra_profiles()), user._hsseq_audience_sites()) for user in users]

    def _audience_users(self, index=None):
        """Comptes visés par le document (index : celui de _audience_index, recalculé à défaut)."""
        self.ensure_one()
        index = self._audience_index(self.company_id) if index is None else index
        wanted = set(self.audience_profiles or [])
        ids = [user.id for user, user_profiles, sites in index
               if self.company_id in user.company_ids and user_profiles & wanted and self._applies_to_sites(sites)]
        return self.env["res.users"].sudo().browse(ids)


class EguitraHsseqProcedure(models.Model):
    _name = "eguitra.hsseq.procedure"
    _inherit = ["eguitra.hsseq.journaled", "eguitra.hsseq.audience"]
    _description = "Procédure HSSEQ"
    _order = "code, id"
    _check_company_auto = True
    _journal_key = "procedure"
    _journal_fields = ("code", "title", "domain", "description", "audience_profiles", "site_ids", "owner_id",
                       "status", "current_version_id")

    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    code = fields.Char("Référence", required=True, index=True, help="Par exemple PR-HSE-001.")
    title = fields.Char("Titre", required=True)
    domain = fields.Selection(DOMAINS, "Domaine")
    description = fields.Text("Objet et domaine d'application")
    site_ids = fields.Many2many("eguitra.hsseq.site", "eguitra_hsseq_procedure_site_rel", "procedure_id", "site_id",
                                "Sites visés", check_company=True, help="Vide : tous les sites.")
    owner_id = fields.Many2one("res.users", "Responsable du document", default=lambda self: self.env.uid)
    status = fields.Selection(PROCEDURE_STATUSES, "État", required=True, default="draft", index=True)
    version_ids = fields.One2many("eguitra.hsseq.procedure.version", "procedure_id", "Versions")
    current_version_id = fields.Many2one("eguitra.hsseq.procedure.version", "Version en vigueur", readonly=True)
    archive_reason = fields.Text("Motif de l'archivage", readonly=True)

    _code_company_unique = models.Constraint("unique(code, company_id)",
                                             "Cette référence de procédure existe déjà dans la société.")

    def _draft_version(self):
        self.ensure_one()
        return self.version_ids.filtered(lambda v: v.status == "draft")[:1]

    def _transitions(self):
        self.ensure_one()
        return {"draft": ["archive"], "published": ["remind", "archive"], "archived": ["reactivate"]}[self.status]

    def _require(self, transition):
        if transition not in self._transitions():
            raise HsseqError("invalid_transition", f"Transition « {transition} » impossible depuis l'état "
                                                   f"« {dict(PROCEDURE_STATUSES)[self.status]} ».")

    def action_archive_procedure(self, reason):
        self.ensure_one()
        self._require("archive")
        reason = require_reason(reason, "de l'archivage")
        self.write({"status": "archived", "archive_reason": reason})
        self._journal("archive", note=reason)
        return True

    def action_reactivate(self, reason):
        self.ensure_one()
        self._require("reactivate")
        reason = require_reason(reason, "de la réactivation")
        self.write({"status": "published" if self.current_version_id else "draft", "archive_reason": False})
        self._journal("reactivate", note=reason)
        return True


class EguitraHsseqProcedureVersion(models.Model):
    _name = "eguitra.hsseq.procedure.version"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Version d'une procédure HSSEQ"
    _order = "procedure_id, id desc"
    _journal_key = "procedure_version"
    _journal_fields = ("version", "effective_date", "change_summary", "status")

    procedure_id = fields.Many2one("eguitra.hsseq.procedure", "Procédure", required=True, ondelete="cascade",
                                   index=True)
    company_id = fields.Many2one(related="procedure_id.company_id", store=True, index=True)
    version = fields.Char("Version", required=True)
    effective_date = fields.Date("Date d'effet", required=True)
    change_summary = fields.Text("Changements apportés")
    status = fields.Selection(VERSION_STATUSES, "État", required=True, default="draft", index=True)
    published_at = fields.Datetime("Publiée le", readonly=True)
    published_by = fields.Many2one("res.users", "Publiée par", readonly=True)
    superseded_at = fields.Datetime("Remplacée le", readonly=True)
    reminded_on = fields.Date("Dernière relance des lectures", readonly=True)
    acknowledgment_ids = fields.One2many("eguitra.hsseq.acknowledgment", "version_id", "Accusés de lecture")

    _version_unique = models.Constraint("unique(procedure_id, version)", "Cette version de la procédure existe déjà.")

    def _document(self):
        return self.env["eguitra.hsseq.attachment"]._for("procedure_version", self)

    def action_publish(self):
        """Mise en vigueur : document joint, la version précédente est remplacée, les comptes visés sont
        prévenus et invités à accuser lecture."""
        self.ensure_one()
        procedure = self.procedure_id
        if self.status != "draft":
            raise HsseqError("invalid_transition", "Seule une version en brouillon se publie.")
        if procedure.status == "archived":
            raise HsseqError("invalid_transition", "Procédure archivée : réactivez-la avant de publier une version.")
        if not self._document():
            raise HsseqError("document_missing", "Joignez le document de la version avant de la publier.",
                             fields=["attachment_ids"])
        now = fields.Datetime.now()
        procedure.version_ids.filtered(lambda v: v.status == "published").write(
            {"status": "superseded", "superseded_at": now})
        self.write({"status": "published", "published_at": now, "published_by": self.env.uid})
        procedure.write({"status": "published", "current_version_id": self.id})
        self._journal("publish")
        self.env["eguitra.hsseq.notification"]._notify(
            procedure._audience_users(), "procedure_published", f"Procédure à lire : {procedure.code}",
            f"{procedure.code} : {procedure.title}\nVersion {self.version}, en vigueur le "
            f"{self.effective_date:%d/%m/%Y}.\nLisez-la et accusez lecture.", procedure, "procedure")
        return True

    def _targets(self, index=None):
        self.ensure_one()
        return self.procedure_id._audience_users(index)

    def _unread_users(self, targets=None):
        self.ensure_one()
        targets = self._targets() if targets is None else targets
        return targets - self.acknowledgment_ids.user_id

    def _read_stats(self, targets=None):
        self.ensure_one()
        targets = self._targets() if targets is None else targets
        read = self.acknowledgment_ids.filtered(lambda a: a.user_id in targets)
        return {"targets": len(targets), "read": len(read),
                "rate": round(len(read) * 100 / len(targets), 1) if targets else None}

    def _remind(self, users=None):
        """Relance des comptes visés qui n'ont pas lu la version en vigueur."""
        self.ensure_one()
        users = self._unread_users() if users is None else users
        procedure = self.procedure_id
        if users:
            self.env["eguitra.hsseq.notification"]._notify(
                users, "read_reminder", f"Rappel : procédure à lire, {procedure.code}",
                f"{procedure.code} : {procedure.title}\nVersion {self.version}, publiée le "
                f"{self.published_at:%d/%m/%Y}. Lisez-la et accusez lecture.", procedure, "procedure")
        self.write({"reminded_on": today(self.env)})
        return users


class EguitraHsseqBulletin(models.Model):
    _name = "eguitra.hsseq.bulletin"
    _inherit = ["eguitra.hsseq.journaled", "eguitra.hsseq.audience"]
    _description = "Alerte flash ou retour d'expérience HSSEQ"
    _order = "published_at desc, id desc"
    _check_company_auto = True
    _journal_key = "bulletin"
    _journal_fields = ("kind", "title", "body", "key_messages", "event_id", "audience_profiles", "site_ids", "status")

    reference = fields.Char("Référence", default="/", copy=False, readonly=True, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    kind = fields.Selection(BULLETIN_KINDS, "Nature", required=True, default="flash_alert", index=True)
    title = fields.Char("Titre", required=True)
    body = fields.Text("Ce qui s'est passé", required=True)
    key_messages = fields.Text("Ce qu'il faut retenir")
    event_id = fields.Many2one("eguitra.hsseq.event", "Événement d'origine", check_company=True, index=True,
                               ondelete="set null", help="Jamais servi aux lecteurs de l'alerte.")
    audience_profiles = fields.Json(default=lambda self: ["conducteur", "exploitation"])
    site_ids = fields.Many2many("eguitra.hsseq.site", "eguitra_hsseq_bulletin_site_rel", "bulletin_id", "site_id",
                                "Sites visés", check_company=True, help="Vide : tous les sites.")
    status = fields.Selection(BULLETIN_STATUSES, "État", required=True, default="draft", index=True)
    published_at = fields.Datetime("Diffusé le", readonly=True, index=True)
    published_by = fields.Many2one("res.users", "Diffusé par", readonly=True)
    reminded_on = fields.Date("Dernière relance des lectures", readonly=True)
    archive_reason = fields.Text("Motif de l'archivage", readonly=True)
    acknowledgment_ids = fields.One2many("eguitra.hsseq.acknowledgment", "bulletin_id", "Accusés de lecture")

    @api.model_create_multi
    def create(self, vals_list):
        bulletins = super().create(vals_list)
        for bulletin in bulletins:
            bulletin.reference = self.env["ir.sequence"].sudo().next_by_code(
                f"eguitra.hsseq.bulletin.{bulletin.kind}") or "/"
        return bulletins

    # ─── Anonymisation (§9.4) ─────────────────────────────────────────────

    def _person_names(self):
        """Noms à ne jamais diffuser : conducteurs, salariés, comptes internes ; et, à part, les personnes de
        l'événement d'origine (déclarant, conducteur, personnes en cause), dont un seul mot suffit."""
        self.ensure_one()
        env = self.env
        Driver = env["eguitra.transport.driver"].sudo().with_context(active_test=False)
        Employee = env["eguitra.rh.employee"].sudo().with_context(active_test=False)
        Users = env["res.users"].sudo().with_context(active_test=False)
        everyone = set(Driver.search([]).mapped("name")) | set(Employee.search([]).mapped("name"))
        everyone |= set(Users.search([("share", "=", False)]).mapped("name"))
        linked = set()
        event = self.sudo().event_id
        if event:
            linked |= {p._display() for p in event.person_ids}
            linked |= {event.reported_by.name, event.rotation_id.driver_id.name}
        return {n for n in everyone if n}, {n for n in linked if n}

    def _anonymity_findings(self, values=None):
        """Noms de personnes et immatriculations (ou codes d'ensemble) relevés dans le titre, le texte et les
        messages clés : [{kind: person | plate, value, field}]."""
        self.ensure_one()
        values = values or {name: self[name] for name in BULLETIN_TEXT_FIELDS}
        vehicles = self.env["eguitra.transport.vehicle"].sudo().with_context(active_test=False).search([])
        plates = {}
        for vehicle in vehicles:
            for value in (vehicle.tractor_plate, vehicle.trailer_plate, vehicle.name):
                key = plain(value).replace(" ", "")
                if len(key) >= 4:
                    plates.setdefault(key, value)
        everyone, linked = self._person_names()
        findings = []

        def found(kind, value, field):
            if not any(f["kind"] == kind and f["value"] == value and f["field"] == field for f in findings):
                findings.append({"kind": kind, "value": value, "field": field})

        for field in BULLETIN_TEXT_FIELDS:
            raw = values.get(field) or ""
            if not raw:
                continue
            text = f" {plain(raw)} "
            windows = compact_windows(text.split())
            for key, value in plates.items():
                if key in windows:
                    found("plate", value, field)
            for match in PLATE_SHAPE.finditer(raw):
                found("plate", match.group(0), field)
            for name in everyone | linked:
                if any(f" {form} " in text for form in name_forms(name)):
                    found("person", name, field)
                elif name in linked and any(len(p) >= 4 and f" {p} " in text
                                            for p in plain(re.sub(r"\(.*?\)", " ", name)).split()):
                    found("person", name, field)
        return findings

    # ─── Cycle ────────────────────────────────────────────────────────────

    def _transitions(self):
        self.ensure_one()
        return {"draft": ["publish"], "published": ["remind", "archive"], "archived": []}[self.status]

    def _require(self, transition):
        if transition not in self._transitions():
            raise HsseqError("invalid_transition", f"Transition « {transition} » impossible depuis l'état "
                                                   f"« {dict(BULLETIN_STATUSES)[self.status]} ».")

    def action_publish(self):
        """Diffusion : refusée tant que le texte cite un nom de personne ou une immatriculation (§9.4) ; les
        comptes visés sont prévenus et invités à accuser lecture."""
        self.ensure_one()
        self._require("publish")
        findings = self._anonymity_findings()
        if findings:
            persons = sorted({f["value"] for f in findings if f["kind"] == "person"})
            plates = sorted({f["value"] for f in findings if f["kind"] == "plate"})
            parts = ([f"nom de personne : {', '.join(persons)}"] if persons else []) + \
                ([f"immatriculation ou code d'ensemble : {', '.join(plates)}"] if plates else [])
            raise HsseqError("not_anonymized", f"Diffusion refusée : une alerte ou un retour d'expérience est "
                                               f"anonymisé ({' ; '.join(parts)}).",
                             fields=sorted({f["field"] for f in findings}))
        self.write({"status": "published", "published_at": fields.Datetime.now(), "published_by": self.env.uid})
        self._journal("publish")
        label = dict(BULLETIN_KINDS)[self.kind]
        self.env["eguitra.hsseq.notification"]._notify(
            self._audience_users(), "bulletin_published", f"{label} : {self.title}",
            f"{self.reference} : {self.title}\nLisez-la et accusez lecture.", self, "bulletin")
        return True

    def action_archive_bulletin(self, reason):
        self.ensure_one()
        self._require("archive")
        reason = require_reason(reason, "de l'archivage")
        self.write({"status": "archived", "archive_reason": reason})
        self._journal("archive", note=reason)
        return True

    def _unread_users(self, targets=None):
        self.ensure_one()
        targets = self._audience_users() if targets is None else targets
        return targets - self.acknowledgment_ids.user_id

    def _read_stats(self, targets=None):
        self.ensure_one()
        targets = self._audience_users() if targets is None else targets
        read = self.acknowledgment_ids.filtered(lambda a: a.user_id in targets)
        return {"targets": len(targets), "read": len(read),
                "rate": round(len(read) * 100 / len(targets), 1) if targets else None}

    def _remind(self, users=None):
        self.ensure_one()
        users = self._unread_users() if users is None else users
        if users:
            self.env["eguitra.hsseq.notification"]._notify(
                users, "read_reminder", f"Rappel : {dict(BULLETIN_KINDS)[self.kind].lower()} à lire",
                f"{self.reference} : {self.title}\nLisez-la et accusez lecture.", self, "bulletin")
        self.write({"reminded_on": today(self.env)})
        return users


class EguitraHsseqAcknowledgment(models.Model):
    _name = "eguitra.hsseq.acknowledgment"
    _description = "Accusé de lecture HSSEQ"
    _order = "read_at desc, id desc"

    version_id = fields.Many2one("eguitra.hsseq.procedure.version", "Version de procédure", ondelete="cascade",
                                 index=True)
    bulletin_id = fields.Many2one("eguitra.hsseq.bulletin", "Alerte ou retour d'expérience", ondelete="cascade",
                                  index=True)
    user_id = fields.Many2one("res.users", "Lu par", required=True, index=True, ondelete="cascade")
    company_id = fields.Many2one("res.company", index=True)
    read_at = fields.Datetime("Lu le", required=True, help="Heure de lecture sur l'appareil.")
    received_at = fields.Datetime("Reçu le", required=True, default=fields.Datetime.now, readonly=True)
    source = fields.Selection([("web", "Web"), ("terrain", "NIMOVA Terrain")], "Lu depuis", default="web")

    _version_user_unique = models.Constraint("unique(version_id, user_id)",
                                             "La lecture de cette version est déjà enregistrée.")
    _bulletin_user_unique = models.Constraint("unique(bulletin_id, user_id)",
                                              "La lecture de cette alerte est déjà enregistrée.")

    @api.constrains("version_id", "bulletin_id")
    def _check_target(self):
        for ack in self:
            if bool(ack.version_id) == bool(ack.bulletin_id):
                raise ValidationError("Un accusé de lecture porte sur une version de procédure ou sur une alerte.")

    @api.model
    def _acknowledge(self, record, user, read_at=None, source="web"):
        """Accusé de lecture (idempotent) : (accusé, créé ?)."""
        field = "version_id" if record._name == "eguitra.hsseq.procedure.version" else "bulletin_id"
        existing = self.sudo().search([(field, "=", record.id), ("user_id", "=", user.id)], limit=1)
        if existing:
            return existing, False
        ack = self.sudo().create({field: record.id, "user_id": user.id, "company_id": record.company_id.id,
                                  "read_at": read_at or fields.Datetime.now(), "source": source})
        record._journal("acknowledge", note=user.sudo().name)
        return ack, True

    @api.model
    def _cron_reminders(self):
        """Chaque jour : relance des comptes visés qui n'ont pas lu une procédure en vigueur ou une alerte
        diffusée, à l'intervalle des paramètres de la société (7 jours par défaut)."""
        day = today(self.env)
        Settings = self.env["eguitra.hsseq.settings"]
        versions = self.env["eguitra.hsseq.procedure.version"].sudo().search(
            [("status", "=", "published"), ("procedure_id.status", "=", "published")])
        bulletins = self.env["eguitra.hsseq.bulletin"].sudo().search([("status", "=", "published")])
        for record in list(versions) + list(bulletins):
            interval = Settings._get(record.company_id).read_reminder_days or 7
            last = record.reminded_on or (record.published_at.date() if record.published_at else day)
            if (day - last).days < interval:
                continue
            unread = record._unread_users()
            if unread:
                record._remind(unread)
        return True


class EguitraHsseqEmergencyPlan(models.Model):
    _name = "eguitra.hsseq.emergency.plan"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Plan d'intervention d'urgence"
    _order = "site_id, scenario, id"
    _check_company_auto = True
    _journal_key = "emergency_plan"
    _journal_fields = ("site_id", "scenario", "title", "response", "resources", "contact_ids", "review_date", "active")

    reference = fields.Char("Référence", default="/", copy=False, readonly=True, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    site_id = fields.Many2one("eguitra.hsseq.site", "Site", required=True, check_company=True, index=True)
    scenario = fields.Selection(SCENARIOS, "Scénario", required=True, index=True)
    title = fields.Char("Plan", required=True)
    response = fields.Text("Conduite à tenir", required=True)
    resources = fields.Text("Moyens d'intervention")
    contact_ids = fields.Many2many("eguitra.hsseq.crisis.contact", "eguitra_hsseq_plan_contact_rel", "plan_id",
                                   "contact_id", "Contacts à appeler", check_company=True)
    review_date = fields.Date("Prochaine revue le")
    drill_ids = fields.One2many("eguitra.hsseq.drill", "plan_id", "Exercices")
    active = fields.Boolean(default=True)

    @api.constrains("site_id", "scenario", "active")
    def _check_unique(self):
        for plan in self.filtered("active"):
            if self.search_count([("id", "!=", plan.id), ("site_id", "=", plan.site_id.id),
                                  ("scenario", "=", plan.scenario), ("active", "=", True)]):
                raise ValidationError("Un plan d'intervention en vigueur existe déjà pour ce site et ce scénario.")

    @api.model_create_multi
    def create(self, vals_list):
        plans = super().create(vals_list)
        for plan in plans:
            plan.reference = self.env["ir.sequence"].sudo().next_by_code("eguitra.hsseq.emergency.plan") or "/"
        return plans


class EguitraHsseqDrill(models.Model):
    _name = "eguitra.hsseq.drill"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Exercice d'urgence"
    _order = "planned_date desc, id desc"
    _check_company_auto = True
    _journal_key = "drill"
    _journal_fields = ("planned_date", "performed_date", "status", "participants_count", "duration_minutes",
                       "debrief", "cancel_reason")

    reference = fields.Char("Référence", default="/", copy=False, readonly=True, index=True)
    plan_id = fields.Many2one("eguitra.hsseq.emergency.plan", "Plan d'intervention", required=True, index=True,
                              ondelete="restrict")
    company_id = fields.Many2one(related="plan_id.company_id", store=True, index=True)
    site_id = fields.Many2one(related="plan_id.site_id", store=True, index=True, string="Site")
    scenario = fields.Selection(related="plan_id.scenario", store=True, string="Scénario")
    planned_date = fields.Date("Prévu le", required=True, index=True)
    performed_date = fields.Date("Réalisé le", index=True)
    status = fields.Selection(DRILL_STATUSES, "État", required=True, default="planned", index=True)
    participants_count = fields.Integer("Participants")
    participant_ids = fields.Many2many("res.users", "eguitra_hsseq_drill_user_rel", "drill_id", "user_id",
                                       "Participants (comptes)")
    duration_minutes = fields.Integer("Durée (minutes)")
    debrief = fields.Text("Bilan")
    cancel_reason = fields.Text("Motif de l'annulation", readonly=True)
    reopen_reason = fields.Text("Motif de la dernière réouverture", readonly=True)
    action_ids = fields.One2many("eguitra.hsseq.action", "drill_id", "Actions")

    @api.model_create_multi
    def create(self, vals_list):
        drills = super().create(vals_list)
        for drill in drills:
            drill.reference = self.env["ir.sequence"].sudo().next_by_code("eguitra.hsseq.drill") or "/"
        return drills

    def _transitions(self):
        self.ensure_one()
        return {"planned": ["perform", "cancel"], "done": ["reopen"], "cancelled": []}[self.status]

    def _require(self, transition):
        if transition not in self._transitions():
            raise HsseqError("invalid_transition", f"Transition « {transition} » impossible depuis l'état "
                                                   f"« {dict(DRILL_STATUSES)[self.status]} ».")

    def action_perform(self, performed_date=None, debrief=None, participants_count=None):
        """Exercice réalisé : date passée ou du jour, bilan obligatoire."""
        self.ensure_one()
        self._require("perform")
        day = performed_date or today(self.env)
        if day > today(self.env):
            raise HsseqError("invalid_parameter", "Un exercice se déclare réalisé à une date passée ou du jour.",
                             fields=["performed_date"], status=400)
        debrief = (debrief or self.debrief or "").strip()
        if not debrief:
            raise HsseqError("debrief_required", "Le bilan de l'exercice est obligatoire.", fields=["debrief"])
        count = participants_count if participants_count is not None else self.participants_count
        if not count and not self.participant_ids:
            raise HsseqError("participants_required", "Indiquez les participants de l'exercice (nombre ou comptes).",
                             fields=["participants_count", "participant_ids"])
        values = {"status": "done", "performed_date": day, "debrief": debrief}
        if participants_count is not None:
            values["participants_count"] = max(int(participants_count), 0)
        self.write(values)
        self._journal("perform")
        return True

    def action_cancel(self, reason):
        self.ensure_one()
        self._require("cancel")
        reason = require_reason(reason, "de l'annulation")
        self.write({"status": "cancelled", "cancel_reason": reason})
        self._journal("cancel", note=reason)
        return True

    def action_reopen(self, reason):
        self.ensure_one()
        self._require("reopen")
        reason = require_reason(reason, "de la réouverture")
        self.write({"status": "planned", "reopen_reason": reason})
        self._journal("reopen", note=reason)
        return True


class EguitraHsseqCrisisContact(models.Model):
    _name = "eguitra.hsseq.crisis.contact"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Contact de l'annuaire de crise"
    _order = "call_order, id"
    _check_company_auto = True
    _journal_key = "crisis_contact"
    _journal_fields = ("site_id", "function", "name", "organization", "phone", "phone2", "email", "call_order",
                       "active")

    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    site_id = fields.Many2one("eguitra.hsseq.site", "Site", check_company=True, index=True,
                              help="Vide : tous les sites (numéros d'urgence publics, direction…).")
    function = fields.Char("Fonction", required=True)
    name = fields.Char("Nom", required=True)
    organization = fields.Char("Organisme", help="Entreprise, sapeurs-pompiers, gendarmerie, hôpital…")
    phone = fields.Char("Téléphone", required=True)
    phone2 = fields.Char("Second téléphone")
    email = fields.Char("Courriel")
    call_order = fields.Integer("Ordre d'appel", default=10)
    note = fields.Text("Précisions")
    active = fields.Boolean(default=True)
