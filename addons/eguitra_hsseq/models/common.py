"""Valeurs communes de NIMOVA · HSSEQ (contrat d'API : docs/design/hsseq-contrat.md de la session design).

Clés et valeurs en anglais snake_case, libellés français. Les erreurs métier portent un code précis
(HsseqError.code), rendu tel quel dans le champ « error » de l'API.
"""

from datetime import datetime, time

from odoo import fields
from odoo.exceptions import UserError

VEHICLE_KINDS = [("tanker", "Citerne"), ("tipper", "Benne")]

EVENT_TYPES = [
    ("work_accident", "Accident du travail"),
    ("road_accident", "Accident de la route"),
    ("near_miss", "Presque-accident"),
    ("hazard", "Situation dangereuse"),
    ("spill", "Déversement"),
    ("fire", "Incendie"),
    ("security_breach", "Atteinte à la sûreté"),
    ("product_quality", "Incident de qualité du produit"),
    ("property_damage", "Dégât matériel"),
]
DOMAINS = [("safety", "Sécurité"), ("health", "Santé"), ("security", "Sûreté"), ("environment", "Environnement"),
           ("quality", "Qualité")]
# Domaine déduit du type quand la déclaration ne le précise pas.
TYPE_DOMAIN = {"work_accident": "safety", "road_accident": "safety", "near_miss": "safety", "hazard": "safety",
               "spill": "environment", "fire": "safety", "security_breach": "security", "product_quality": "quality",
               "property_damage": "safety"}
# Accidents (dénominateur du taux de déclaration) et signaux faibles (numérateur).
ACCIDENT_TYPES = ("work_accident", "road_accident")
WEAK_SIGNAL_TYPES = ("near_miss", "hazard")

EVENT_STATUSES = [("reported", "Déclaré"), ("classified", "Classé"), ("investigation", "Enquête"),
                  ("actions", "Actions"), ("closed", "Clôturé")]
LEVELS = [("low", "Faible"), ("moderate", "Modérée"), ("significant", "Significative"), ("high", "Élevée")]
METHODS = [("simple_analysis", "Analyse simple"), ("five_whys", "5 Pourquoi"), ("cause_tree", "Arbre des causes")]
LEVEL_METHOD = {"low": "simple_analysis", "moderate": "simple_analysis", "significant": "five_whys",
                "high": "cause_tree"}
PERSON_KINDS = [("driver", "Conducteur"), ("employee", "Salarié"), ("third_party", "Tiers")]
PERSON_ROLES = [("victim", "Victime"), ("driver", "Conducteur"), ("witness", "Témoin"), ("perpetrator", "Auteur"),
                ("third_party", "Tiers")]
COST_KINDS = [("claim", "Sinistre"), ("deductible", "Franchise"), ("downtime", "Immobilisation"),
              ("product_loss", "Perte de produit"), ("repair", "Réparation"), ("other", "Autre coût")]
FACTORS_5M = ("environment", "equipment", "method", "manpower", "material")
TREE_FACT_KINDS = ("unusual_fact", "permanent_fact")

ACTION_STATUSES = [("todo", "À faire"), ("in_progress", "En cours"), ("to_verify", "À vérifier"),
                   ("closed", "Close"), ("cancelled", "Annulée")]
ACTION_ORIGINS = [("event", "Événement"), ("audit", "Audit"), ("check", "Contrôle"), ("risk", "Risque"),
                  ("review", "Revue de direction")]
CONTROL_LEVELS = [("elimination", "Élimination"), ("substitution", "Substitution"), ("engineering", "Ingénierie"),
                  ("administrative", "Mesure administrative"), ("ppe", "Équipement de protection")]
REMINDER_KINDS = [("d_minus_7", "Échéance dans 7 jours"), ("d0", "Échéance du jour"), ("weekly", "Retard"),
                  ("escalation", "Escalade au Directeur général")]

CHECK_KINDS = [("pre_departure", "Contrôle avant départ"), ("unloading", "Dépotage"), ("mine_site", "Site minier")]
ANSWERS = [("ok", "Conforme"), ("not_ok", "Non conforme"), ("na", "Sans objet")]
CHECK_RESULTS = [("compliant", "Conforme"), ("non_compliant", "Non conforme (réserves)"),
                 ("blocking", "Non conforme bloquant")]
NONCONFORMITY_STATUSES = [("open", "Ouverte"), ("lifted", "Levée")]

BREATH_STATUSES = [("compliant", "Conforme"), ("non_compliant", "Non conforme"), ("not_done", "Non réalisé")]
BREATH_RESULTS = [("negative", "Négatif"), ("positive", "Positif")]

WAIVER_STATUSES = [("pending_hsseq", "Attente du Responsable HSSEQ"), ("active", "Active"), ("expired", "Expirée"),
                   ("refused", "Refusée"), ("cancelled", "Annulée")]

ATTACHMENT_ROLES = [("photo", "Photo du constat"), ("lift", "Photo de la correction"), ("evidence", "Preuve"),
                    ("signature", "Signature"), ("document", "Document")]
# Fiche d'une pièce jointe ou d'une entrée du journal (clé de l'API -> modèle du noyau).
OBJECT_MODELS = {
    "event": "eguitra.hsseq.event",
    "action": "eguitra.hsseq.action",
    "check": "eguitra.hsseq.check",
    "nonconformity": "eguitra.hsseq.nonconformity",
    "waiver": "eguitra.hsseq.waiver",
    "breath_test": "eguitra.hsseq.breath.test",
}
ATTACHMENT_OBJECTS = ("event", "action", "check", "nonconformity", "waiver")
NOTIFICATION_CHANNELS = [("app", "Dans l'application"), ("email", "Courriel")]

# Profils (codes de PROFILE_GROUPS) qui lisent toute fiche HSSEQ de leurs sociétés.
READ_ALL = frozenset({"admin", "direction", "hsseq"})
HSSEQ_GROUP = "eguitra_base.group_profile_hsseq"
DIRECTION_GROUP = "eguitra_base.group_profile_direction"
ADMIN_GROUP = "eguitra_base.group_profile_admin"
EXPLOITATION_GROUP = "eguitra_base.group_profile_exploitation"


class HsseqError(UserError):
    """Règle métier d'HSSEQ refusée : code précis de l'API (« proof_required », « four_eyes »…), statut HTTP
    (422 par défaut) et champs en cause."""

    def __init__(self, code, message, fields=None, status=422):
        super().__init__(message)
        self.code = code
        self.fields = fields
        self.status = status


def vehicle_kind(vehicle):
    """Profil de l'ensemble (citerne par défaut, comme dans Transport)."""
    return (vehicle.sudo().vehicle_kind if vehicle and "vehicle_kind" in vehicle._fields else False) or "tanker"


def day_start(day):
    """Horodatage (UTC, comme le fuseau d'Africa/Conakry) du début d'un jour, pour les « depuis » d'un motif."""
    return datetime.combine(day, time.min) if day else None


def day_end(day):
    return datetime.combine(day, time(23, 59, 59)) if day else None


def today(env):
    return fields.Date.context_today(env.user)


def employee_of_driver(env, driver):
    """Salarié RH en cours lié au chauffeur de Transport (employee.driver_id), vide sinon."""
    if not driver:
        return env["eguitra.rh.employee"]
    day = today(env)
    return env["eguitra.rh.employee"].sudo().search([
        ("driver_id", "=", driver.id), ("hire_date", "<=", day),
        "|", ("exit_date", "=", False), ("exit_date", ">=", day)], limit=1)


def users_in_group(env, xmlid, companies):
    """Comptes internes actifs d'un groupe de profil (directement ou par implication), ouverts à l'une des
    sociétés."""
    users = env["res.users"].sudo().search([("share", "=", False), ("company_ids", "in", companies.ids)])
    return users.filtered(lambda u: u.has_group(xmlid))
