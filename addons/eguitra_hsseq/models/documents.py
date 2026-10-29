"""Documents et urgences (spécification §3, §9.4, lot 3), référentiel documentaire HSE (29/10).

- Référentiel documentaire HSE (modèle eguitra.hsseq.procedure, nom historique gardé) : politique,
  procédure, instruction de travail ou mode opératoire, consigne, formulaire ou modèle ; référence proposée
  par type (POL-HSE-001, PR-HSE-001, IT-HSE-001, CS-HSE-001, FO-HSE-001) ; hiérarchie : une procédure met en
  œuvre une politique, une instruction de travail sa procédure, une consigne ou un formulaire une procédure
  ou une instruction de travail.
- Versions datées (date d'effet, pièce jointe ou texte, résumé des changements) : brouillon, soumise à
  l'approbation, en vigueur, remplacée. Une politique (texte de l'engagement de la direction, objectifs
  chiffrés reliés aux indicateurs du cockpit) n'entre en vigueur qu'approuvée par la direction (profil
  Direction hors administration), jamais par son rédacteur ni par la personne qui l'a soumise (quatre yeux) ;
  les autres types, par le Responsable HSSEQ (une seconde personne si les réglages l'exigent). La mise en
  vigueur remplace la version précédente et demande la lecture aux comptes visés (profils et sites) :
  accusé de lecture par version, taux de lecture, relance des comptes qui ne l'ont pas lue.
- Revue périodique : prochaine revue fixée à la mise en vigueur (périodicité des réglages par type, annuelle
  pour une politique, réglable par document), alerte avant l'échéance au Responsable HSSEQ, au responsable
  du document et, pour une politique, à la direction, puis chaque semaine de retard ; revue tracée
  (reconduit sans changement, ou nouvelle version à rédiger), qui peut tirer une action du plan d'actions.
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
from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .cockpit import INDICATORS, WATCH_RATIO, month_start, months_back
from .common import (
    ADMIN_GROUP,
    AUDIENCE_PROFILES,
    BULLETIN_KINDS,
    BULLETIN_STATUSES,
    DIRECTION_GROUP,
    DOC_PARENT_TYPES,
    DOC_REVIEW_OUTCOMES,
    DOC_TYPE_PREFIX,
    DOC_TYPES,
    DOMAINS,
    DRILL_STATUSES,
    HSSEQ_GROUP,
    PROCEDURE_STATUSES,
    SCENARIOS,
    VERSION_STATUSES,
    HsseqError,
    indicator_status,
    today,
    users_in_group,
)

# Indicateurs du cockpit auxquels un objectif de politique peut se relier : code -> (libellé, unité, sens).
INDICATOR_INFO = {code: (label, unit, direction) for code, label, unit, direction, *_rest in INDICATORS}
INDICATOR_CHOICES = [(code, label) for code, (label, _u, _d) in INDICATOR_INFO.items()]
# Relance d'une revue de document en retard : chaque semaine tant qu'elle n'est pas faite.
REVIEW_REMINDER_DAYS = 7
# Champs du contenu d'une version : qui les modifie compte parmi ses rédacteurs (quatre yeux).
CONTENT_FIELDS = ("version", "effective_date", "change_summary", "body", "objective_ids")
PARENT_RULE = ("Une procédure se rattache à une politique ; une instruction de travail, à une procédure ; une "
               "consigne ou un formulaire, à une procédure ou à une instruction de travail ; une politique, à "
               "aucun document.")


def doc_label(doc_type):
    return dict(DOC_TYPES).get(doc_type, "Document")

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
    """Document HSE du référentiel : politique, procédure, instruction de travail ou mode opératoire, consigne,
    formulaire ou modèle (nom technique historique « procedure », gardé pour l'API et NIMOVA Terrain)."""

    _name = "eguitra.hsseq.procedure"
    _inherit = ["eguitra.hsseq.journaled", "eguitra.hsseq.audience"]
    _description = "Document HSE (politique, procédure, instruction, consigne, formulaire)"
    _order = "code, id"
    _check_company_auto = True
    _journal_key = "procedure"
    _journal_fields = ("doc_type", "code", "title", "domain", "description", "parent_id", "audience_profiles",
                       "site_ids", "owner_id", "status", "current_version_id", "review_months", "next_review_date")

    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    doc_type = fields.Selection(DOC_TYPES, "Type", required=True, default="procedure", index=True)
    code = fields.Char("Référence", required=True, index=True,
                       help="Proposée selon le type : POL-HSE-001, PR-HSE-001, IT-HSE-001, CS-HSE-001, FO-HSE-001.")
    title = fields.Char("Titre", required=True)
    domain = fields.Selection(DOMAINS, "Domaine")
    description = fields.Text("Objet et domaine d'application")
    parent_id = fields.Many2one("eguitra.hsseq.procedure", "Document de rattachement", index=True,
                                ondelete="restrict", check_company=True,
                                help="Politique mise en œuvre par une procédure ; procédure d'une instruction de "
                                     "travail ; procédure ou instruction d'une consigne ou d'un formulaire.")
    child_ids = fields.One2many("eguitra.hsseq.procedure", "parent_id", "Documents rattachés")
    site_ids = fields.Many2many("eguitra.hsseq.site", "eguitra_hsseq_procedure_site_rel", "procedure_id", "site_id",
                                "Sites visés", check_company=True, help="Vide : tous les sites.")
    owner_id = fields.Many2one("res.users", "Responsable du document", default=lambda self: self.env.uid)
    status = fields.Selection(PROCEDURE_STATUSES, "État", required=True, default="draft", index=True)
    version_ids = fields.One2many("eguitra.hsseq.procedure.version", "procedure_id", "Versions")
    current_version_id = fields.Many2one("eguitra.hsseq.procedure.version", "Version en vigueur", readonly=True)
    archive_reason = fields.Text("Motif de l'archivage", readonly=True)
    # Revue périodique.
    review_months = fields.Integer("Revue tous les (mois)", default=0,
                                   help="0 : la périodicité des réglages pour ce type de document.")
    next_review_date = fields.Date("Prochaine revue le", index=True)
    last_review_date = fields.Date("Dernière revue le", readonly=True)
    review_reminded_on = fields.Date("Dernière alerte de revue", readonly=True)
    review_ids = fields.One2many("eguitra.hsseq.document.review", "document_id", "Revues")

    _code_company_unique = models.Constraint("unique(code, company_id)",
                                             "Cette référence de document existe déjà dans la société.")

    @api.model_create_multi
    def create(self, vals_list):
        """Référence proposée selon le type quand elle n'est pas saisie (suite propre à chaque société)."""
        taken = {}
        for vals in vals_list:
            if not (vals.get("code") or "").strip():
                company = self.env["res.company"].browse(vals.get("company_id") or self.env.company.id)
                doc_type = vals.get("doc_type") or "procedure"
                key = (company.id, doc_type)
                vals["code"] = self._next_code(company, doc_type, taken.get(key, ()))
                taken.setdefault(key, []).append(vals["code"])
        return super().create(vals_list)

    def write(self, vals):
        """Le type ne change plus une fois une version mise en vigueur : il décide de qui l'approuve. Une
        nouvelle date de revue rouvre ses alertes."""
        if "doc_type" in vals and self.filtered(
                lambda d: d.doc_type != vals["doc_type"]
                and d.version_ids.filtered(lambda v: v.status in ("published", "superseded"))):
            raise HsseqError("invalid_transition", "Type d'un document déjà mis en vigueur : il ne change plus "
                                                   "(créez un nouveau document).", fields=["doc_type"])
        if "next_review_date" in vals and "review_reminded_on" not in vals:
            vals = dict(vals, review_reminded_on=False)
        return super().write(vals)

    @api.model
    def _next_code(self, company, doc_type, taken=()):
        """Référence suivante du type dans la société : préfixe du type et numéro sur trois chiffres, après le
        plus grand déjà pris (références saisies à la main comprises)."""
        prefix = DOC_TYPE_PREFIX.get(doc_type, DOC_TYPE_PREFIX["procedure"])
        codes = self.sudo().search([("company_id", "=", company.id), ("code", "=like", f"{prefix}%")]).mapped("code")
        numbers = [int(c[len(prefix):]) for c in [*codes, *taken] if c[len(prefix):].isdigit()]
        return f"{prefix}{(max(numbers) + 1) if numbers else 1:03d}"

    @api.constrains("parent_id", "doc_type", "company_id")
    def _check_parent(self):
        """Hiérarchie : une procédure se rattache à une politique, une instruction de travail à une procédure,
        une consigne ou un formulaire à une procédure ou à une instruction ; une politique à aucun document."""
        for doc in self:
            parent = doc.parent_id
            if parent:
                if parent == doc or parent.company_id != doc.company_id:
                    raise HsseqError("invalid_parent", "Document de rattachement invalide.", fields=["parent_id"])
                if parent.doc_type not in DOC_PARENT_TYPES[doc.doc_type]:
                    raise HsseqError("invalid_parent", f"Rattachement refusé ({doc_label(doc.doc_type).lower()} sous "
                                                       f"{doc_label(parent.doc_type).lower()}). {PARENT_RULE}",
                                     fields=["parent_id"])
            wrong = doc.child_ids.filtered(lambda c, d=doc: d.doc_type not in DOC_PARENT_TYPES[c.doc_type])
            if wrong:
                raise HsseqError("invalid_parent", f"Les documents rattachés ({', '.join(wrong.mapped('code'))}) ne "
                                                   f"peuvent pas dépendre d'un document de ce type : {PARENT_RULE}",
                                 fields=["doc_type"])

    # ─── Cycle ────────────────────────────────────────────────────────────

    def _draft_version(self):
        """Version en préparation : en brouillon ou soumise à l'approbation (une seule à la fois)."""
        self.ensure_one()
        return self.version_ids.filtered(lambda v: v.status in ("draft", "submitted"))[:1]

    def _transitions(self):
        self.ensure_one()
        return {"draft": ["archive"], "published": ["remind", "review", "archive"],
                "archived": ["reactivate"]}[self.status]

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

    # ─── Approbation ──────────────────────────────────────────────────────

    def _approver_profile(self):
        """Profil qui approuve les versions : la direction pour une politique, hsseq pour les autres types."""
        self.ensure_one()
        return "direction" if self.doc_type == "policy" else "hsseq"

    def _approvers(self, exclude=None):
        """Comptes à prévenir d'une version à approuver : la direction de la société (hors administration)
        pour une politique, les Responsables HSSEQ pour les autres, sans les comptes exclus."""
        self.ensure_one()
        if self.doc_type == "policy":
            users = users_in_group(self.env, DIRECTION_GROUP, self.company_id).filtered(
                lambda u: not u.has_group(ADMIN_GROUP))
        else:
            users = users_in_group(self.env, HSSEQ_GROUP, self.company_id)
        return users - (exclude or self.env["res.users"])

    def _can_approve(self, user=None):
        """Le compte porte-t-il le profil qui approuve ce document (sans regarder les quatre yeux) ?"""
        self.ensure_one()
        user = (user or self.env.user).sudo()
        if self.company_id not in user.company_ids:
            return False
        if self.doc_type == "policy":
            # L'administration porte la direction : seule, elle n'approuve pas une politique.
            return user.has_group(DIRECTION_GROUP) and not user.has_group(ADMIN_GROUP)
        return user.has_group(HSSEQ_GROUP)

    # ─── Revue périodique ─────────────────────────────────────────────────

    def _settings(self):
        self.ensure_one()
        return self.env["eguitra.hsseq.settings"]._get(self.company_id)

    def _review_period(self):
        """Périodicité de revue en mois : celle du document, à défaut celle des réglages pour son type."""
        self.ensure_one()
        return self.review_months or self._settings()._review_months(self.doc_type)

    def _review_state(self, day=None):
        """État de la revue d'un document en vigueur : overdue (échue), due (dans le délai d'alerte),
        scheduled (à venir) ; None hors vigueur ou sans date."""
        self.ensure_one()
        if self.status != "published" or not self.next_review_date:
            return None
        day = day or today(self.env)
        if self.next_review_date < day:
            return "overdue"
        if (self.next_review_date - day).days <= self._settings().document_review_alert_days:
            return "due"
        return "scheduled"

    def _review_in_progress(self):
        """Dernière revue « nouvelle version à rédiger » dont la version n'est pas encore en vigueur : le retard
        ne se relance plus, la nouvelle version est en préparation."""
        self.ensure_one()
        last = self.review_ids.sorted(lambda r: (r.reviewed_on, r.id), reverse=True)[:1]
        return bool(last and last.outcome == "revised" and last.new_version_id.status in ("draft", "submitted"))

    def _review_recipients(self):
        """Prévenus d'une revue à faire : les Responsables HSSEQ, le responsable du document et, pour une
        politique, la direction de la société (hors administration)."""
        self.ensure_one()
        users = users_in_group(self.env, HSSEQ_GROUP, self.company_id) | self.owner_id
        if self.doc_type == "policy":
            users |= self._settings()._directors()
        return users

    def _next_version_label(self):
        """Numéro de la version suivante : le plus grand numéro entier plus un, à défaut le rang suivant."""
        self.ensure_one()
        labels = set(self.version_ids.mapped("version"))
        numbers = [int(v) for v in labels if v.isdigit()]
        candidate = (max(numbers) + 1) if numbers else len(labels) + 1
        while str(candidate) in labels:
            candidate += 1
        return str(candidate)

    def action_review(self, outcome, comment, reviewed_on=None, next_review_date=None, version_label=None):
        """Revue périodique d'un document en vigueur, tracée : reconduit sans changement (prochaine revue à la
        périodicité, ou à la date donnée) ou nouvelle version à rédiger (brouillon repris de la version en
        vigueur, la prochaine revue se fixant à sa mise en vigueur). Renvoie la revue."""
        self.ensure_one()
        self._require("review")
        day = today(self.env)
        if outcome not in dict(DOC_REVIEW_OUTCOMES):
            raise HsseqError("invalid_parameter", "Conclusion de la revue : renewed ou revised.", fields=["outcome"],
                             status=400)
        comment = (comment or "").strip()
        if not comment:
            raise HsseqError("missing_fields", "Notez les constats et la conclusion de la revue.", fields=["comment"],
                             status=400)
        reviewed_on = reviewed_on or day
        if reviewed_on > day:
            raise HsseqError("invalid_parameter", "Une revue se note à une date passée ou du jour.",
                             fields=["reviewed_on"], status=400)
        values = {"document_id": self.id, "version_id": self.current_version_id.id, "reviewed_on": reviewed_on,
                  "reviewer_id": self.env.uid, "outcome": outcome, "comment": comment}
        if outcome == "renewed":
            following = next_review_date or reviewed_on + relativedelta(months=self._review_period())
            if following <= day:
                raise HsseqError("invalid_parameter", "La prochaine revue est postérieure à aujourd'hui.",
                                 fields=["next_review_date"], status=400)
            values["next_review_date"] = following
            self.write({"next_review_date": following, "last_review_date": reviewed_on, "review_reminded_on": False})
        else:
            pending = self._draft_version()
            if not pending:
                label = (version_label or "").strip() or self._next_version_label()
                if label in self.version_ids.mapped("version"):
                    raise HsseqError("conflict", f"La version {label} de ce document existe déjà.", fields=["version"],
                                     status=409)
                pending = self.env["eguitra.hsseq.procedure.version"].sudo().create({
                    "procedure_id": self.id, "version": label, "effective_date": day,
                    "change_summary": f"Revue du {reviewed_on:%d/%m/%Y} : {comment}"[:4000]})
                pending._copy_content(self.current_version_id)
            values["new_version_id"] = pending.id
            self.write({"last_review_date": reviewed_on, "review_reminded_on": False})
        review = self.env["eguitra.hsseq.document.review"].sudo().create(values)
        self._journal("review", note=f"{dict(DOC_REVIEW_OUTCOMES)[outcome]} : {comment[:300]}")
        return review

    @api.model
    def _cron_review_alerts(self):
        """Chaque jour : revue d'un document en vigueur à faire dans le délai d'alerte des réglages (une fois),
        puis en retard (chaque semaine, sauf nouvelle version déjà en préparation)."""
        day = today(self.env)
        Notification = self.env["eguitra.hsseq.notification"]
        for doc in self.sudo().search([("status", "=", "published"), ("next_review_date", "!=", False)]):
            due = doc.next_review_date
            alert_days = doc._settings().document_review_alert_days
            reminded = doc.review_reminded_on
            label = doc_label(doc.doc_type)
            if due < day:
                if doc._review_in_progress() or (reminded and reminded >= due
                                                 and (day - reminded).days < REVIEW_REMINDER_DAYS):
                    continue
                kind, subject = "document_review_overdue", f"Revue en retard : {doc.code}"
                body = (f"{label} {doc.code} : {doc.title}\nRevue prévue le {due:%d/%m/%Y}, en retard de "
                        f"{(day - due).days} jours. Notez la revue : reconduit sans changement, ou nouvelle version.")
            elif (due - day).days <= alert_days:
                if reminded and reminded >= due - timedelta(days=alert_days):
                    continue
                kind, subject = "document_review_due", f"Revue à faire avant le {due:%d/%m/%Y} : {doc.code}"
                body = (f"{label} {doc.code} : {doc.title}\nRevue prévue le {due:%d/%m/%Y} (dans "
                        f"{(due - day).days} jours). Responsable du document : {doc.owner_id.name or 'aucun'}.")
            else:
                continue
            Notification._notify(doc._review_recipients(), kind, subject, body, doc, "procedure")
            doc.review_reminded_on = day
        return True

    # ─── Objectifs reliés au cockpit ──────────────────────────────────────

    @api.model
    def _indicator_values(self, company, codes, sites=None):
        """Valeur des indicateurs du cockpit sur les douze derniers mois, mois en cours compris (situation du
        jour pour les habilitations) : {code: valeur}. sites : la portée du lecteur, comme au cockpit (None :
        toute la société, pour un profil de lecture complète)."""
        codes = {c for c in codes if c in INDICATOR_INFO}
        if not codes:
            return {}
        Cockpit = self.env["eguitra.hsseq.cockpit"]
        months = months_back(month_start(today(self.env)), 12)
        comps, _frozen = Cockpit._components(company, months, sites or None)
        total = Cockpit._sum(comps, company, months)
        if "qualifications_valid" in codes:
            total["drivers"], total["drivers_valid"] = Cockpit._qualifications(company, sites or None)
        return {code: Cockpit._value(code, total) for code in codes}


class EguitraHsseqProcedureVersion(models.Model):
    _name = "eguitra.hsseq.procedure.version"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Version d'un document HSE"
    _order = "procedure_id, id desc"
    _journal_key = "procedure_version"
    _journal_fields = ("version", "effective_date", "change_summary", "body", "status")

    procedure_id = fields.Many2one("eguitra.hsseq.procedure", "Document", required=True, ondelete="cascade",
                                   index=True)
    company_id = fields.Many2one(related="procedure_id.company_id", store=True, index=True)
    version = fields.Char("Version", required=True)
    effective_date = fields.Date("Date d'effet", required=True)
    change_summary = fields.Text("Changements apportés")
    body = fields.Text("Texte", help="Politique : l'engagement de la direction ; consigne : la consigne elle-même. "
                                     "Les autres documents se lisent dans leur pièce jointe.")
    objective_ids = fields.One2many("eguitra.hsseq.policy.objective", "version_id", "Objectifs")
    status = fields.Selection(VERSION_STATUSES, "État", required=True, default="draft", index=True)
    submitted_at = fields.Datetime("Soumise le", readonly=True)
    submitted_by = fields.Many2one("res.users", "Soumise par", readonly=True)
    approved_at = fields.Datetime("Approuvée le", readonly=True)
    approved_by = fields.Many2one("res.users", "Approuvée par", readonly=True)
    # Quatre yeux : tout compte qui a modifié le contenu (texte, objectifs, numéro, date, changements, pièce
    # jointe) compte parmi les rédacteurs et n'approuve pas la version.
    edited_by = fields.Many2many("res.users", "eguitra_hsseq_procedure_version_editor_rel", "version_id", "user_id",
                                 "Modifiée par", readonly=True)
    reject_reason = fields.Text("Motif du dernier refus", readonly=True)
    published_at = fields.Datetime("Publiée le", readonly=True)
    published_by = fields.Many2one("res.users", "Publiée par", readonly=True)
    superseded_at = fields.Datetime("Remplacée le", readonly=True)
    reminded_on = fields.Date("Dernière relance des lectures", readonly=True)
    acknowledgment_ids = fields.One2many("eguitra.hsseq.acknowledgment", "version_id", "Accusés de lecture")

    _version_unique = models.Constraint("unique(procedure_id, version)", "Cette version du document existe déjà.")

    @api.model_create_multi
    def create(self, vals_list):
        uid = self.env.uid
        return super().create([dict(vals, edited_by=[(4, uid)]) for vals in vals_list])

    def write(self, vals):
        """Une modification du contenu inscrit son auteur parmi les rédacteurs de la version (quatre yeux)."""
        if set(vals) & set(CONTENT_FIELDS):
            vals = dict(vals, edited_by=[(4, self.env.uid)])
        return super().write(vals)

    def _mark_edited(self):
        """Contenu modifié hors des champs de la version (objectif, pièce jointe) : son auteur est inscrit
        parmi les rédacteurs."""
        if self:
            self.sudo().write({"edited_by": [(4, self.env.uid)]})

    def _document(self):
        return self.env["eguitra.hsseq.attachment"]._for("procedure_version", self)

    def _copy_content(self, source, body=True, objectives=True):
        """Reprend le texte et les objectifs d'une autre version (nouvelle version d'une politique)."""
        self.ensure_one()
        if not source:
            return
        if body:
            self.write({"body": source.body or False})
        if objectives:
            self.env["eguitra.hsseq.policy.objective"].sudo().create([
                {"version_id": self.id, "sequence": o.sequence, "label": o.label, "indicator_code": o.indicator_code,
                 "target": o.target} for o in source.objective_ids])

    def _content_error(self):
        """Contenu manquant pour soumettre la version (HsseqError), ou None : le texte de l'engagement pour une
        politique ; pour les autres types, le document joint (ou, pour une consigne courte, son texte)."""
        self.ensure_one()
        if self.procedure_id.doc_type == "policy":
            if not (self.body or "").strip():
                return HsseqError("text_missing", "Rédigez le texte de l'engagement de la direction avant de soumettre "
                                                  "la politique.", fields=["body"])
            return None
        if not self._document() and not (self.body or "").strip():
            return HsseqError("document_missing", "Joignez le document de la version avant de la publier.",
                              fields=["attachment_ids"])
        return None

    def _authors(self):
        """Rédacteurs (création et chaque modification du contenu) et auteur de la soumission : jamais
        l'approbateur d'une politique (quatre yeux)."""
        self.ensure_one()
        return (self.create_uid | self.submitted_by | self.edited_by).filtered(lambda u: u.id)

    def _check_approver(self, four_eyes=True):
        """Profil de l'approbateur (refus 403) et quatre yeux (refus 422) : la direction, ni rédacteur ni auteur
        de la soumission, pour une politique ; un Responsable HSSEQ pour les autres types (autre que le
        rédacteur si les réglages l'exigent)."""
        self.ensure_one()
        procedure = self.procedure_id
        user = self.env.user
        if not procedure._can_approve(user):
            raise HsseqError("forbidden", "Une politique est approuvée par la direction générale (profil Direction, "
                                          "hors administration)." if procedure.doc_type == "policy" else
                                          "Ce document est approuvé par le Responsable HSSEQ.", status=403)
        if not four_eyes:
            return
        if user in self._authors() and (procedure.doc_type == "policy" or procedure._settings().document_four_eyes):
            raise HsseqError("four_eyes", "Quatre yeux : la version est approuvée par une autre personne que ses "
                                          "rédacteurs (création ou modification du contenu) et que celle qui l'a "
                                          "soumise.")

    def action_submit(self, notify=True):
        """Soumission à l'approbation : contenu complet (texte d'une politique, document des autres types) ;
        les approbateurs sont prévenus."""
        self.ensure_one()
        procedure = self.procedure_id
        if self.status != "draft":
            raise HsseqError("invalid_transition", "Seule une version en brouillon se soumet à l'approbation.")
        if procedure.status == "archived":
            raise HsseqError("invalid_transition", "Document archivé : réactivez-le avant de publier une version.")
        error = self._content_error()
        if error:
            raise error
        self.write({"status": "submitted", "submitted_at": fields.Datetime.now(), "submitted_by": self.env.uid,
                    "reject_reason": False})
        self._journal("submit")
        procedure._journal("submit", note=f"Version {self.version}")
        if notify:
            label = doc_label(procedure.doc_type)
            self.env["eguitra.hsseq.notification"]._notify(
                procedure._approvers(exclude=self.env.user), "document_submitted",
                f"{label} à approuver : {procedure.code}",
                f"{procedure.code} : {procedure.title}\nVersion {self.version}, soumise par {self.env.user.name}. "
                f"Relisez-la, puis approuvez-la ou refusez-la avec un motif.", procedure, "procedure")
        return True

    def action_withdraw(self):
        """Retrait d'une version soumise, rendue à la rédaction (le Responsable HSSEQ la corrige)."""
        self.ensure_one()
        if self.status != "submitted":
            raise HsseqError("invalid_transition", "Seule une version soumise se retire de l'approbation.")
        self.write({"status": "draft", "submitted_at": False, "submitted_by": False})
        self._journal("withdraw")
        self.procedure_id._journal("withdraw", note=f"Version {self.version}")
        return True

    def action_reject(self, reason):
        """Refus motivé de l'approbateur : la version retourne en brouillon, son rédacteur est prévenu."""
        self.ensure_one()
        if self.status != "submitted":
            raise HsseqError("invalid_transition", "Seule une version soumise se refuse.")
        self._check_approver(four_eyes=False)
        reason = require_reason(reason, "du refus")
        submitter = self.submitted_by
        self.write({"status": "draft", "reject_reason": reason, "submitted_at": False, "submitted_by": False})
        self._journal("reject", note=reason)
        procedure = self.procedure_id
        procedure._journal("reject", note=f"Version {self.version} : {reason}")
        self.env["eguitra.hsseq.notification"]._notify(
            submitter | self.create_uid, "document_rejected", f"Version refusée : {procedure.code}",
            f"{procedure.code} : {procedure.title}\nVersion {self.version} refusée par {self.env.user.name} : {reason}",
            procedure, "procedure")
        return True

    def action_approve(self):
        """Approbation (direction pour une politique, quatre yeux) : date et nom de l'approbateur, imprimés sur
        le document à afficher ; la version entre en vigueur."""
        self.ensure_one()
        if self.status != "submitted":
            raise HsseqError("invalid_transition", "Seule une version soumise s'approuve.")
        self._check_approver()
        self.write({"approved_at": fields.Datetime.now(), "approved_by": self.env.uid})
        self._journal("approve")
        self.procedure_id._journal("approve", note=f"Version {self.version}, approuvée par {self.env.user.name}")
        return self._put_in_force()

    def action_publish(self):
        """Mise en vigueur directe par le Responsable HSSEQ (soumission et approbation d'un même geste), pour
        tout document sauf une politique, qui attend l'approbation de la direction."""
        self.ensure_one()
        procedure = self.procedure_id
        if procedure.doc_type == "policy":
            raise HsseqError("direction_approval_required", "Une politique entre en vigueur après l'approbation de "
                                                            "la direction : soumettez-la.")
        if self.status not in ("draft", "submitted"):
            raise HsseqError("invalid_transition", "Seule une version en brouillon se publie.")
        if self.status == "draft":
            self.action_submit(notify=False)
        return self.action_approve()

    def _put_in_force(self):
        """Mise en vigueur : la version précédente est remplacée, la prochaine revue fixée à la périodicité du
        document, les comptes visés sont prévenus et invités à accuser lecture."""
        self.ensure_one()
        procedure = self.procedure_id
        if procedure.status == "archived":
            raise HsseqError("invalid_transition", "Document archivé : réactivez-le avant de publier une version.")
        now = fields.Datetime.now()
        procedure.version_ids.filtered(lambda v: v.status == "published").write(
            {"status": "superseded", "superseded_at": now})
        self.write({"status": "published", "published_at": now, "published_by": self.env.uid})
        procedure.write({"status": "published", "current_version_id": self.id, "review_reminded_on": False,
                         "next_review_date": today(self.env) + relativedelta(months=procedure._review_period())})
        self._journal("publish")
        label = doc_label(procedure.doc_type)
        self.env["eguitra.hsseq.notification"]._notify(
            procedure._audience_users(), "procedure_published", f"{label} à lire : {procedure.code}",
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
                users, "read_reminder", f"Rappel : {doc_label(procedure.doc_type).lower()} à lire, {procedure.code}",
                f"{procedure.code} : {procedure.title}\nVersion {self.version}, publiée le "
                f"{self.published_at:%d/%m/%Y}. Lisez-la et accusez lecture.", procedure, "procedure")
        self.write({"reminded_on": today(self.env)})
        return users

    def _objectives(self, values=None):
        """Objectifs de la version, avec, pour ceux reliés au cockpit, la valeur des douze derniers mois et son
        état au regard de la cible (values : valeurs déjà calculées, sinon calculées ici)."""
        self.ensure_one()
        if values is None:
            values = self.env["eguitra.hsseq.procedure"]._indicator_values(
                self.company_id, self.objective_ids.mapped("indicator_code"))
        rows = []
        for o in self.objective_ids:
            info = INDICATOR_INFO.get(o.indicator_code)
            value = values.get(o.indicator_code) if info else None
            rows.append({"id": o.id, "label": o.label, "indicator_code": o.indicator_code or None,
                         "indicator_label": info[0] if info else None, "unit": info[1] if info else None,
                         "direction": info[2] if info else None, "target": o.target if info else None,
                         "value": value,
                         "status": indicator_status(value, o.target, info[2], watch_ratio=WATCH_RATIO) if info else None})
        return rows


class EguitraHsseqPolicyObjective(models.Model):
    _name = "eguitra.hsseq.policy.objective"
    _description = "Objectif chiffré d'une politique HSE"
    _order = "version_id, sequence, id"

    version_id = fields.Many2one("eguitra.hsseq.procedure.version", "Version", required=True, ondelete="cascade",
                                 index=True)
    company_id = fields.Many2one(related="version_id.company_id", store=True, index=True)
    sequence = fields.Integer("Ordre", default=10)
    label = fields.Char("Objectif", required=True, help="Par exemple « Zéro accident du travail avec arrêt ».")
    indicator_code = fields.Selection(INDICATOR_CHOICES, "Indicateur du cockpit",
                                      help="Facultatif : l'objectif se lit alors avec la valeur de l'indicateur sur "
                                           "les douze derniers mois.")
    target = fields.Float("Cible", digits=(16, 2), help="Cible de l'indicateur relié, dans son unité.")

    @api.model_create_multi
    def create(self, vals_list):
        objectives = super().create(vals_list)
        objectives.version_id._mark_edited()
        return objectives

    def write(self, vals):
        result = super().write(vals)
        self.version_id._mark_edited()
        return result

    def unlink(self):
        versions = self.version_id
        result = super().unlink()
        versions.exists()._mark_edited()
        return result


class EguitraHsseqDocumentReview(models.Model):
    _name = "eguitra.hsseq.document.review"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Revue périodique d'un document HSE"
    _order = "reviewed_on desc, id desc"
    _journal_key = "document_review"
    _journal_fields = ("outcome", "comment", "next_review_date")

    document_id = fields.Many2one("eguitra.hsseq.procedure", "Document", required=True, ondelete="cascade",
                                  index=True)
    company_id = fields.Many2one(related="document_id.company_id", store=True, index=True)
    version_id = fields.Many2one("eguitra.hsseq.procedure.version", "Version revue", ondelete="set null")
    reviewed_on = fields.Date("Revue le", required=True, index=True)
    reviewer_id = fields.Many2one("res.users", "Revue par", required=True, default=lambda self: self.env.uid)
    outcome = fields.Selection(DOC_REVIEW_OUTCOMES, "Conclusion", required=True)
    comment = fields.Text("Constats et conclusion", required=True)
    next_review_date = fields.Date("Prochaine revue fixée au", readonly=True)
    new_version_id = fields.Many2one("eguitra.hsseq.procedure.version", "Nouvelle version", ondelete="set null")
    action_ids = fields.One2many("eguitra.hsseq.action", "document_review_id", "Actions")

    def _create_action(self, values):
        """Action du plan d'actions (origine « document HSE ») tirée de la revue."""
        self.ensure_one()
        document = self.document_id
        action = self.env["eguitra.hsseq.action"].sudo().create(dict(
            values, origin="document", origin_id=document.id, document_id=document.id, document_review_id=self.id,
            company_id=document.company_id.id))
        document._journal("review_action", note=f"{action.reference} : {action.description[:200]}")
        return action


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
