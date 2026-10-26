"""Paramètres d'HSSEQ par société, modifiables sans développement (spécification §11) : mise en service du
verrou de départ, dates à partir desquelles une habilitation, un dossier salarié ou un document du
véhicule absent bloque le départ, seuils de criticité, délais d'enquête, vérification d'efficacité,
seuil d'une action coûteuse, destinataire des notifications de la direction, cibles du cockpit ; au lot 3,
facteur d'émission du carburant, délai de réponse aux réclamations clients, relance des lectures."""

from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .common import DIRECTION_GROUP, users_in_group

# Cibles proposées par le contrat d'API (§4) ; « targets » les remplace indicateur par indicateur.
DEFAULT_TARGETS = {
    "frequency_rate": 5.0, "severity_rate": 0.2, "road_accidents_per_mkm": 1.5, "reporting_ratio": 10.0,
    "check_completion": 100.0, "check_compliance": 95.0, "breath_test_completion": 100.0,
    "breath_test_positives": 0.0, "waivers": 2.0, "actions_on_time": 90.0, "actions_effectiveness": 80.0,
    "qualifications_valid": 100.0, "fuel_consumption": 44.0, "co2_emissions": 1.18, "tanker_shortage": 1.5,
    "tipper_variance": 5.0, "audits_completion": 100.0, "immobilizations": 0.0,
    # Lot 3.
    "spills": 0.0, "dust_exceedances": 0.0, "complaints": 0.0, "complaints_on_time": 100.0,
    "telematics_violations": 5.0, "drills_completion": 100.0,
}
CO2_PER_LITER = 2.68  # kg de CO₂ par litre de gazole, facteur proposé


class EguitraHsseqSettings(models.Model):
    _name = "eguitra.hsseq.settings"
    _description = "Paramètres HSSEQ"
    _rec_name = "company_id"

    company_id = fields.Many2one("res.company", required=True, index=True, ondelete="cascade")
    currency_id = fields.Many2one(related="company_id.currency_id")

    # ─── Mise en service ──────────────────────────────────────────────────
    lock_start_date = fields.Date(
        "Verrou de départ en service à partir du",
        help="Rotations chargées à partir de cette date : départ soumis au verrou, validation seulement après le "
             "passage « en route ». Vide : le verrou n'est pas encore en service (Transport comme avant).")
    qualifications_required_from = fields.Date(
        "Habilitations exigées à partir du",
        help="Avant cette date (ou sans date), une habilitation obligatoire absente est un avertissement ; "
             "ensuite elle bloque le départ (V04), comme une habilitation expirée.")
    employee_file_required_from = fields.Date(
        "Dossier salarié du conducteur exigé à partir du",
        help="Avant cette date (ou sans date), un chauffeur sans dossier salarié RH est un avertissement ; "
             "ensuite il bloque le départ (V04).")
    documents_required_from = fields.Date(
        "Documents du véhicule exigés à partir du",
        help="Avant cette date (ou sans date), une assurance ou une visite technique absente est un "
             "avertissement ; ensuite elle bloque le départ (V05), comme un document expiré.")

    # ─── Saisies de terrain sans rotation ─────────────────────────────────
    check_window_hours = fields.Integer(
        "Contrôle sans rotation rattaché dans les (heures)", default=12,
        help="Un contrôle avant départ saisi sans rotation est rattaché, au départ, à la rotation de son ensemble "
             "s'il a été saisi dans ce délai.")
    breath_test_window_hours = fields.Integer(
        "Alcootest sans rotation rattaché dans les (heures)", default=4,
        help="Un alcootest saisi sans rotation est rattaché, au départ, à la rotation de son conducteur s'il a été "
             "saisi dans ce délai.")

    # ─── Criticité et enquêtes (§9.1) ─────────────────────────────────────
    level_moderate_min = fields.Integer("Criticité modérée à partir de", default=4)
    level_significant_min = fields.Integer("Criticité significative à partir de", default=8)
    level_high_min = fields.Integer("Criticité élevée à partir de", default=15)
    investigation_hours_high = fields.Integer("Délai d'enquête, criticité élevée (heures)", default=72)
    investigation_days_significant = fields.Integer("Délai d'enquête, criticité significative (jours)", default=7)
    investigation_days_moderate = fields.Integer("Délai d'analyse, criticité modérée (jours)", default=15)
    client_notice_hours = fields.Integer("Information du donneur d'ordre, criticité élevée (heures)", default=24)

    # ─── Actions (§9.2) ───────────────────────────────────────────────────
    verification_min_criticality = fields.Integer("Vérification d'efficacité à partir de la criticité", default=8)
    verification_days = fields.Integer("Vérification d'efficacité après la réalisation (jours)", default=90)
    escalation_days = fields.Integer("Escalade au Directeur général après un retard de (jours)", default=30)
    costly_action_threshold = fields.Monetary("Action coûteuse à partir de", currency_field="currency_id",
                                              default=50_000_000,
                                              help="Coût estimé à partir duquel la direction valide l'action "
                                                   "avant son démarrage.")
    director_user_id = fields.Many2one(
        "res.users", "Directeur général (notifications)",
        help="Destinataire des notifications de criticité élevée, de dérogation et d'escalade. Vide : les comptes "
             "du profil Direction générale de la société.")

    # ─── Plan de trajet (V08) ─────────────────────────────────────────────
    night_start_hour = fields.Float("Nuit à partir de (heure)", default=19.0,
                                    help="Plage de nuit des routes interdites de nuit (heure de Conakry).")
    night_end_hour = fields.Float("Nuit jusqu'à (heure)", default=6.0)
    max_driving_hours = fields.Float("Conduite prévue au plus par jour (heures)", default=9.0,
                                     help="Au-delà, sur une journée, le plan de trajet ouvre le motif V08.")

    # ─── Registre des risques (§3) ────────────────────────────────────────
    risk_review_months = fields.Integer("Revue d'un risque tous les (mois)", default=12,
                                        help="Prochaine revue proposée à la création et après chaque revue.")

    # ─── Environnement et qualité (lot 3) ─────────────────────────────────
    co2_factor = fields.Float("Facteur d'émission (kg de CO₂ par litre)", default=CO2_PER_LITER, digits=(6, 3),
                              help="Émissions calculées depuis le carburant des rotations ; 2,68 kg par litre de "
                                   "gazole par défaut.")
    complaint_response_days = fields.Integer("Réponse à une réclamation client sous (jours)", default=15)

    # ─── Documents et urgences (lot 3) ────────────────────────────────────
    read_reminder_days = fields.Integer(
        "Relance des lectures non faites tous les (jours)", default=7,
        help="Procédure en vigueur ou alerte diffusée : les comptes visés qui ne l'ont pas lue sont relancés à "
             "cet intervalle.")

    # ─── Cockpit (§10) ────────────────────────────────────────────────────
    targets = fields.Json("Cibles des indicateurs", help="Code de l'indicateur -> cible ; à défaut, la cible proposée.")

    _company_unique = models.Constraint("unique(company_id)", "Les paramètres HSSEQ de cette société existent déjà.")

    @api.constrains("night_start_hour", "night_end_hour", "max_driving_hours")
    def _check_journey(self):
        for s in self:
            if not (0 <= s.night_start_hour < 24 and 0 <= s.night_end_hour < 24) or s.max_driving_hours < 0:
                raise ValidationError("Heures de nuit entre 0 et 24, durée de conduite positive.")

    @api.constrains("co2_factor", "complaint_response_days", "read_reminder_days")
    def _check_lot3(self):
        for s in self:
            if s.co2_factor <= 0 or s.complaint_response_days < 1 or s.read_reminder_days < 1:
                raise ValidationError("Facteur d'émission positif ; délai de réponse et intervalle de relance d'au "
                                      "moins un jour.")

    @api.constrains("level_moderate_min", "level_significant_min", "level_high_min")
    def _check_levels(self):
        for s in self:
            if not 1 < s.level_moderate_min < s.level_significant_min < s.level_high_min <= 25:
                raise ValidationError("Seuils de criticité attendus croissants, entre 2 et 25.")

    @api.model
    def _get(self, company=None):
        company = company or self.env.company
        settings = self.sudo().search([("company_id", "=", company.id)], limit=1)
        return settings or self.sudo().create({"company_id": company.id})

    @api.model
    def _level_of(self, company, criticality):
        """Niveau d'une criticité selon les seuils de la société (seuils par défaut sans paramètres), sans
        créer les paramètres : appelé par un calcul stocké."""
        settings = self.sudo().search([("company_id", "=", company.id)], limit=1) if company else self.browse()
        return (settings or self.sudo().new({}))._level(criticality)

    def _level(self, criticality):
        """Niveau d'une criticité (gravité potentielle × probabilité), False sans notes."""
        self.ensure_one()
        if not criticality:
            return False
        if criticality >= self.level_high_min:
            return "high"
        if criticality >= self.level_significant_min:
            return "significant"
        if criticality >= self.level_moderate_min:
            return "moderate"
        return "low"

    def _investigation_delay(self, level):
        """Délai d'enquête du niveau (timedelta), None pour une criticité faible."""
        self.ensure_one()
        return {"high": timedelta(hours=self.investigation_hours_high),
                "significant": timedelta(days=self.investigation_days_significant),
                "moderate": timedelta(days=self.investigation_days_moderate)}.get(level)

    def _thresholds(self):
        """Seuils servis aux écrans (criticality_thresholds des référentiels)."""
        self.ensure_one()
        return [
            {"level": "low", "min": 1, "max": self.level_moderate_min - 1, "investigation_days": None,
             "investigation_hours": None, "method": None},
            {"level": "moderate", "min": self.level_moderate_min, "max": self.level_significant_min - 1,
             "investigation_days": self.investigation_days_moderate, "investigation_hours": None,
             "method": "simple_analysis"},
            {"level": "significant", "min": self.level_significant_min, "max": self.level_high_min - 1,
             "investigation_days": self.investigation_days_significant, "investigation_hours": None,
             "method": "five_whys"},
            {"level": "high", "min": self.level_high_min, "max": 25,
             "investigation_days": round(self.investigation_hours_high / 24, 1),
             "investigation_hours": self.investigation_hours_high, "method": "cause_tree"},
        ]

    def _target(self, code):
        self.ensure_one()
        targets = self.targets or {}
        return targets.get(code, DEFAULT_TARGETS.get(code))

    def _required_from(self, field_name, day):
        """La date de mise en service du paramètre est-elle atteinte au jour donné ?"""
        self.ensure_one()
        start = self[field_name]
        return bool(start and day >= start)

    def _directors(self):
        """Directeur général paramétré, sinon les comptes du profil Direction générale de la société qui ne
        sont pas administrateurs (le profil Administration comprend la direction)."""
        self.ensure_one()
        if self.director_user_id and self.director_user_id.active:
            return self.director_user_id
        users = users_in_group(self.env, DIRECTION_GROUP, self.company_id)
        own = users.filtered(lambda u: not u.has_group("eguitra_base.group_profile_admin"))
        return own or users
