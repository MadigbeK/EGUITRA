"""Réglages du service client, propres à chaque société : heures ouvrées, délais par priorité, escalade,
clôture automatique, accusé de réception, satisfaction, adresse de la boîte de courriel, modèle WhatsApp ;
catégories (délais propres, activité, équipe), équipes et réponses types."""

from odoo import api, fields, models
from odoo.exceptions import UserError

from .. import delais
from .common import ACTIVITIES, KINDS, clean_email, clean_line, clean_text

# Délais par défaut, en heures ouvrées : (première réponse, résolution).
DEFAULT_DELAYS = {"urgent": (1, 8), "high": (4, 16), "normal": (8, 40), "low": (16, 80)}
MAX_DELAY = 2000

# Catégories préchargées (décision du gérant du 29 octobre 2026) : code -> (libellé, activité, sociétés,
# nature de la réclamation HSSEQ correspondante, proposée aux clients).
DEFAULT_CATEGORIES = [
    ("livraison", "Livraison", "transport", ("groupe",), "other"),
    ("retard", "Retard", "transport", ("groupe",), "delay"),
    ("produit", "Manquant ou qualité du produit transporté", "transport", ("groupe",), "shortage"),
    ("facturation", "Facturation", "facturation", ("groupe", "cabinet"), False),
    ("location", "Location", "location", ("groupe",), False),
    ("travaux", "Travaux", "btp", ("groupe",), False),
    ("loyer", "Loyer et entretien", "immobilier", ("groupe",), False),
    ("cabinet", "Cabinet et dossier", "cabinet", ("cabinet",), False),
    ("autre", "Autre", "autre", ("groupe", "cabinet"), False),
]

# Réponses types préchargées : (nom, texte). Variables : {client}, {numero}, {objet}, {agent}, {societe}.
DEFAULT_TEMPLATES = [
    ("Accusé de réception",
     "Bonjour {client},\n\nNous avons bien reçu votre demande « {objet} », enregistrée sous le numéro {numero}. "
     "Nous revenons vers vous rapidement.\n\n{agent}, service client de {societe}"),
    ("Demande de précisions",
     "Bonjour {client},\n\nPour traiter votre demande {numero}, pouvez-vous nous préciser : …\n\n"
     "Merci d'avance,\n{agent}, service client de {societe}"),
    ("Réponse apportée",
     "Bonjour {client},\n\nVotre demande {numero} est traitée : …\n\nN'hésitez pas à nous répondre si besoin.\n\n"
     "{agent}, service client de {societe}"),
]


class EguitraScSettings(models.Model):
    _name = "eguitra.sc.settings"
    _description = "Réglages du service client"

    company_id = fields.Many2one("res.company", "Société", required=True, index=True, ondelete="cascade")
    work_start = fields.Float("Ouverture", default=8.0, help="Heure décimale (8,5 : 8 h 30), du lundi au vendredi.")
    work_end = fields.Float("Fermeture", default=17.0)
    first_urgent = fields.Float("Première réponse, urgente (h)", default=DEFAULT_DELAYS["urgent"][0])
    first_high = fields.Float("Première réponse, haute (h)", default=DEFAULT_DELAYS["high"][0])
    first_normal = fields.Float("Première réponse, normale (h)", default=DEFAULT_DELAYS["normal"][0])
    first_low = fields.Float("Première réponse, basse (h)", default=DEFAULT_DELAYS["low"][0])
    resolution_urgent = fields.Float("Résolution, urgente (h)", default=DEFAULT_DELAYS["urgent"][1])
    resolution_high = fields.Float("Résolution, haute (h)", default=DEFAULT_DELAYS["high"][1])
    resolution_normal = fields.Float("Résolution, normale (h)", default=DEFAULT_DELAYS["normal"][1])
    resolution_low = fields.Float("Résolution, basse (h)", default=DEFAULT_DELAYS["low"][1])
    escalation_hours = fields.Float("Escalade à la direction après (h)", default=4.0,
                                    help="Heures ouvrées de dépassement après lesquelles la direction est prévenue "
                                         "(le responsable l'est dès le dépassement).")
    auto_close_days = fields.Integer("Clôture d'un dossier résolu après (jours)", default=7,
                                     help="Sans réponse du client ; 0 : jamais d'office.")
    ack_enabled = fields.Boolean("Accusé de réception automatique", default=True,
                                 help="Courriel, WhatsApp et espace client : le numéro du dossier est envoyé au client.")
    satisfaction_enabled = fields.Boolean("Demande de satisfaction à la résolution", default=True)
    mail_address = fields.Char("Adresse du service client",
                               help="Boîte relevée par la plateforme et expéditrice des réponses, par exemple "
                                    "service.client@eguitragroup.com.")
    wa_template = fields.Char("Modèle WhatsApp approuvé",
                              help="Nom du modèle approuvé par Meta, envoyé hors de la fenêtre de 24 heures, avec "
                                   "deux paramètres : le nom du client et le numéro du dossier.")
    wa_template_lang = fields.Char("Langue du modèle", default="fr")

    _company_unique = models.Constraint("unique(company_id)", "Une seule fiche de réglages par société.")

    @api.model
    def _get(self, company):
        """Réglages de la société, créés au besoin."""
        settings = self.sudo().search([("company_id", "=", company.id)], limit=1)
        return settings or self.sudo().create({"company_id": company.id})

    def _hours(self):
        self.ensure_one()
        return self.work_start, self.work_end

    def _priority_hours(self, priority):
        self.ensure_one()
        return self[f"first_{priority}"], self[f"resolution_{priority}"]

    def _values(self, data):
        """Champs modifiables depuis l'écran des réglages (administration), contrôlés."""
        vals = {}
        start = data.get("work_start", self.work_start)
        end = data.get("work_end", self.work_end)
        if "work_start" in data or "work_end" in data:
            try:
                vals["work_start"], vals["work_end"] = delais.check_hours(start, end)
            except ValueError as e:
                raise UserError(str(e)) from e
        for key in ("first_urgent", "first_high", "first_normal", "first_low", "resolution_urgent",
                    "resolution_high", "resolution_normal", "resolution_low", "escalation_hours"):
            if key in data:
                try:
                    value = float(data[key])
                except (TypeError, ValueError) as e:
                    raise UserError("Délai illisible : un nombre d'heures ouvrées.") from e
                if not 0 < value <= MAX_DELAY:
                    raise UserError(f"Un délai va de quelques minutes à {MAX_DELAY} heures ouvrées.")
                vals[key] = value
        for priority in ("urgent", "high", "normal", "low"):
            first = vals.get(f"first_{priority}", self[f"first_{priority}"])
            resolution = vals.get(f"resolution_{priority}", self[f"resolution_{priority}"])
            if first > resolution:
                raise UserError("Le délai de première réponse ne dépasse pas celui de la résolution.")
        if "auto_close_days" in data:
            try:
                days = int(data["auto_close_days"])
            except (TypeError, ValueError) as e:
                raise UserError("Nombre de jours illisible.") from e
            if not 0 <= days <= 90:
                raise UserError("Clôture d'office : de 0 (jamais) à 90 jours.")
            vals["auto_close_days"] = days
        for key in ("ack_enabled", "satisfaction_enabled"):
            if key in data:
                vals[key] = bool(data[key])
        if "mail_address" in data:
            vals["mail_address"] = clean_email(data.get("mail_address"))
        if "wa_template" in data:
            name = clean_line(data.get("wa_template"), 512)
            if name and not all(c.isalnum() or c == "_" for c in name):
                raise UserError("Nom du modèle WhatsApp : lettres minuscules, chiffres et « _ », comme chez Meta.")
            vals["wa_template"] = name.lower() or False
        if "wa_template_lang" in data:
            lang = clean_line(data.get("wa_template_lang"), 10) or "fr"
            if not all(c.isalnum() or c == "_" for c in lang):
                raise UserError("Langue du modèle : code de Meta, par exemple fr ou fr_FR.")
            vals["wa_template_lang"] = lang
        return vals

    def _row(self):
        self.ensure_one()
        s = self.sudo()
        return {
            "company_id": s.company_id.id, "work_start": s.work_start, "work_end": s.work_end,
            "delays": {p: {"first": s[f"first_{p}"], "resolution": s[f"resolution_{p}"]}
                       for p in ("urgent", "high", "normal", "low")},
            "escalation_hours": s.escalation_hours, "auto_close_days": s.auto_close_days,
            "ack_enabled": s.ack_enabled, "satisfaction_enabled": s.satisfaction_enabled,
            "mail_address": s.mail_address or None, "wa_template": s.wa_template or None,
            "wa_template_lang": s.wa_template_lang or "fr",
        }


class EguitraScCategory(models.Model):
    _name = "eguitra.sc.category"
    _description = "Catégorie de demande du service client"
    _order = "sequence, name, id"
    _check_company_auto = True

    name = fields.Char("Catégorie", required=True)
    code = fields.Char("Code", help="Code des catégories préchargées.")
    company_id = fields.Many2one("res.company", "Société", required=True, index=True,
                                 default=lambda self: self.env.company)
    sequence = fields.Integer(default=10)
    activity = fields.Selection(ACTIVITIES, "Activité", required=True, default="autre")
    kind = fields.Selection(KINDS, "Type proposé")
    first_hours = fields.Float("Première réponse (h)", help="0 : délai de la priorité seul.")
    resolution_hours = fields.Float("Résolution (h)", help="0 : délai de la priorité seul.")
    team_id = fields.Many2one("eguitra.sc.team", "Équipe par défaut", check_company=True, ondelete="set null")
    hsseq_nature = fields.Char("Nature de la réclamation HSSEQ",
                               help="Code de la nature (manquant, qualité, retard…) : la réclamation peut alors "
                                    "créer ou rejoindre celle d'HSSEQ.")
    portal = fields.Boolean("Proposée dans l'espace client", default=True)
    active = fields.Boolean(default=True)

    def _row(self):
        self.ensure_one()
        c = self.sudo()
        return {"id": c.id, "name": c.name, "code": c.code or None, "activity": c.activity, "kind": c.kind or None,
                "first_hours": c.first_hours or None, "resolution_hours": c.resolution_hours or None,
                "team": {"id": c.team_id.id, "name": c.team_id.name} if c.team_id else None,
                "hsseq_nature": c.hsseq_nature or None, "portal": c.portal, "active": c.active,
                "sequence": c.sequence}

    @api.model
    def _values(self, data, company, partial=False):
        vals = {}
        if not partial or "name" in data:
            vals["name"] = clean_line(data.get("name"), 80)
            if not vals["name"]:
                raise UserError("Donnez un nom à la catégorie.")
        if "activity" in data:
            if data["activity"] not in dict(ACTIVITIES):
                raise UserError("Activité inconnue.")
            vals["activity"] = data["activity"]
        if "kind" in data:
            if data["kind"] and data["kind"] not in dict(KINDS):
                raise UserError("Type inconnu.")
            vals["kind"] = data["kind"] or False
        for key in ("first_hours", "resolution_hours"):
            if key in data:
                try:
                    value = float(data[key] or 0)
                except (TypeError, ValueError) as e:
                    raise UserError("Délai illisible.") from e
                if not 0 <= value <= MAX_DELAY:
                    raise UserError(f"Un délai va de 0 (aucun) à {MAX_DELAY} heures ouvrées.")
                vals[key] = value
        if "team_id" in data:
            team = self.env["eguitra.sc.team"].sudo().browse(int(data["team_id"] or 0)).exists()
            if data["team_id"] and (not team or team.company_id != company):
                raise UserError("Équipe inconnue dans la société.")
            vals["team_id"] = team.id or False
        if "hsseq_nature" in data:
            vals["hsseq_nature"] = clean_line(data.get("hsseq_nature"), 30) or False
        for key in ("portal", "active"):
            if key in data:
                vals[key] = bool(data[key])
        if "sequence" in data:
            try:
                vals["sequence"] = int(data["sequence"])
            except (TypeError, ValueError) as e:
                raise UserError("Ordre illisible.") from e
        return vals


class EguitraScTeam(models.Model):
    _name = "eguitra.sc.team"
    _description = "Équipe du service client"
    _order = "name, id"

    name = fields.Char("Équipe", required=True)
    company_id = fields.Many2one("res.company", "Société", required=True, index=True,
                                 default=lambda self: self.env.company)
    leader_id = fields.Many2one("res.users", "Responsable de l'équipe", ondelete="set null")
    member_ids = fields.Many2many("res.users", "eguitra_sc_team_user_rel", "team_id", "user_id", "Membres")
    active = fields.Boolean(default=True)

    def _row(self):
        self.ensure_one()
        t = self.sudo()
        return {"id": t.id, "name": t.name, "active": t.active,
                "leader": {"id": t.leader_id.id, "name": t.leader_id.name} if t.leader_id else None,
                "members": [{"id": u.id, "name": u.name} for u in t.member_ids]}


class EguitraScTemplate(models.Model):
    _name = "eguitra.sc.template"
    _description = "Réponse type du service client"
    _order = "name, id"
    _check_company_auto = True

    name = fields.Char("Réponse type", required=True)
    body = fields.Text("Texte", required=True)
    company_id = fields.Many2one("res.company", "Société", required=True, index=True,
                                 default=lambda self: self.env.company)
    category_id = fields.Many2one("eguitra.sc.category", "Catégorie", check_company=True, ondelete="set null")
    active = fields.Boolean(default=True)

    def _row(self):
        self.ensure_one()
        t = self.sudo()
        return {"id": t.id, "name": t.name, "body": t.body, "active": t.active,
                "category": {"id": t.category_id.id, "name": t.category_id.name} if t.category_id else None}

    @api.model
    def _values(self, data, company, partial=False):
        vals = {}
        if not partial or "name" in data:
            vals["name"] = clean_line(data.get("name"), 80)
            if not vals["name"]:
                raise UserError("Donnez un nom à la réponse type.")
        if not partial or "body" in data:
            vals["body"] = clean_text(data.get("body"), 4000, "Le texte de la réponse type")
            if not vals["body"]:
                raise UserError("Écrivez le texte de la réponse type.")
        if "category_id" in data:
            category = self.env["eguitra.sc.category"].sudo().browse(int(data["category_id"] or 0)).exists()
            if data["category_id"] and (not category or category.company_id != company):
                raise UserError("Catégorie inconnue dans la société.")
            vals["category_id"] = category.id or False
        if "active" in data:
            vals["active"] = bool(data["active"])
        return vals

    def render(self, ticket, agent):
        """Texte de la réponse type pour un dossier : variables remplacées, inconnues laissées telles quelles."""
        self.ensure_one()
        t = ticket.sudo()
        values = {
            "client": t.contact_name or t.partner_id.name or "Madame, Monsieur", "numero": t.name,
            "objet": t.subject, "agent": (agent.name or "").split()[0] if agent else "", "societe": t.company_id.name,
        }
        text = self.sudo().body
        for key, value in values.items():
            text = text.replace("{" + key + "}", value or "")
        return text


class ResCompany(models.Model):
    _inherit = "res.company"

    def _eguitra_sc_setup(self):
        """Installation (et société ajoutée) : séquence propre (SC/EG/AAAA/NNNN, SC/MBAX/AAAA/NNNN, compteur
        annuel), réglages, équipe « Service client », catégories et réponses types préchargées."""
        from .common import SEQUENCE_CODE, tag_of

        Sequence = self.env["ir.sequence"].sudo()
        Category = self.env["eguitra.sc.category"].sudo()
        Template = self.env["eguitra.sc.template"].sudo()
        Team = self.env["eguitra.sc.team"].sudo()
        for company in self:
            if not Sequence.search_count([("code", "=", SEQUENCE_CODE), ("company_id", "=", company.id)]):
                Sequence.create({
                    "name": f"Dossiers du service client - {company.name}", "code": SEQUENCE_CODE,
                    "company_id": company.id, "prefix": f"SC/{tag_of(company)}/%(range_year)s/", "padding": 4,
                    "use_date_range": True, "implementation": "no_gap",
                })
            self.env["eguitra.sc.settings"]._get(company)
            if not Team.with_context(active_test=False).search_count([("company_id", "=", company.id)]):
                Team.create({"name": "Service client", "company_id": company.id})
            entity = company.eguitra_entity or "groupe"
            for sequence, (code, name, activity, entities, nature) in enumerate(DEFAULT_CATEGORIES, start=1):
                if entity not in entities:
                    continue
                if Category.with_context(active_test=False).search_count(
                        [("company_id", "=", company.id), ("code", "=", code)]):
                    continue
                Category.create({"name": name, "code": code, "company_id": company.id, "activity": activity,
                                 "sequence": sequence * 10, "hsseq_nature": nature or False,
                                 "kind": "complaint" if code in ("retard", "produit") else False})
            if not Template.with_context(active_test=False).search_count([("company_id", "=", company.id)]):
                for name, body in DEFAULT_TEMPLATES:
                    Template.create({"name": name, "body": body, "company_id": company.id})
        return True

    @api.model_create_multi
    def create(self, vals_list):
        companies = super().create(vals_list)
        companies._eguitra_sc_setup()
        return companies
