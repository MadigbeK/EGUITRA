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
                  ("review", "Revue de direction"), ("complaint", "Réclamation client"),
                  ("drill", "Exercice d'urgence")]
CONTROL_LEVELS = [("elimination", "Élimination"), ("substitution", "Substitution"), ("engineering", "Ingénierie"),
                  ("administrative", "Mesure administrative"), ("ppe", "Équipement de protection")]
REMINDER_KINDS = [("d_minus_7", "Échéance dans 7 jours"), ("d0", "Échéance du jour"), ("weekly", "Retard"),
                  ("escalation", "Escalade au Directeur général")]

CHECK_KINDS = [("pre_departure", "Contrôle avant départ"), ("unloading", "Dépotage"), ("mine_site", "Site minier")]
ANSWERS = [("ok", "Conforme"), ("not_ok", "Non conforme"), ("na", "Sans objet"),
           ("not_evaluated", "Non évalué (point ajouté à la grille après la saisie)")]
# Réponses que le client envoie : « non évalué » n'est posé que par le noyau.
CLIENT_ANSWERS = ("ok", "not_ok", "na")
CHECK_RESULTS = [("compliant", "Conforme"), ("non_compliant", "Non conforme (réserves)"),
                 ("blocking", "Non conforme bloquant"),
                 ("incomplete", "Incomplet : points bloquants à évaluer par un contrôle complémentaire")]
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
    "risk": "eguitra.hsseq.risk",
    "audit": "eguitra.hsseq.audit",
    "finding": "eguitra.hsseq.finding",
    "requirement": "eguitra.hsseq.requirement",
    "journey": "eguitra.hsseq.journey",
    "immobilization": "eguitra.hsseq.immobilization",
    "rotation": "eguitra.transport.rotation",
    "report": "eguitra.hsseq.report.month",
    # Lot 3.
    "spill": "eguitra.hsseq.spill",
    "waste": "eguitra.hsseq.waste",
    "dust": "eguitra.hsseq.dust",
    "contamination": "eguitra.hsseq.contamination",
    "complaint": "eguitra.hsseq.complaint",
    "procedure": "eguitra.hsseq.procedure",
    "procedure_version": "eguitra.hsseq.procedure.version",
    "bulletin": "eguitra.hsseq.bulletin",
    "emergency_plan": "eguitra.hsseq.emergency.plan",
    "drill": "eguitra.hsseq.drill",
    "crisis_contact": "eguitra.hsseq.crisis.contact",
    "violation": "eguitra.hsseq.telematics.violation",
    "telematics_import": "eguitra.hsseq.telematics.import",
}
# Les alertes flash et retours d'expérience n'ont pas de pièce jointe : une photo échapperait au contrôle
# d'anonymisation (§9.4).
ATTACHMENT_OBJECTS = ("event", "action", "check", "nonconformity", "waiver", "risk", "audit", "finding", "requirement",
                      "spill", "waste", "contamination", "complaint", "procedure_version", "emergency_plan", "drill")

# ─── Lot 2 ────────────────────────────────────────────────────────────────

# Registre des risques (§3, §7).
RISK_NATURES = [("safety_hazard", "Danger pour la sécurité"), ("health_hazard", "Danger pour la santé"),
                ("environmental_aspect", "Aspect environnemental"), ("security_threat", "Menace de sûreté")]
RISK_STATUSES = [("draft", "À évaluer"), ("active", "En vigueur"), ("archived", "Archivé")]
MEASURE_STATUSES = [("planned", "Prévue"), ("in_place", "En place"), ("to_review", "À revoir")]

# Habilitations (statuts de RH, en anglais pour l'API) et aptitude en statut seul.
QUALIFICATION_STATUSES = {"valide": "valid", "a_renouveler": "to_renew", "expiree": "expired", "absente": "missing"}
FITNESS_STATUSES = {"apte": "fit", "apte_reserve": "review", "inapte": "unfit", "echue": "unfit", "inconnu": "review"}

# Plan de trajet (V08).
JOURNEY_STATUSES = [("draft", "À valider"), ("validated", "Validé")]
STOP_KINDS = [("stop", "Arrêt"), ("break", "Pause"), ("rest", "Repos")]

# Audits et conformité (§3, §7).
AUDIT_STANDARDS = [("iso_45001", "ISO 45001"), ("iso_14001", "ISO 14001"), ("iso_9001", "ISO 9001"),
                   ("client", "Audit client ou donneur d'ordre"), ("internal", "Audit interne")]
AUDIT_STATUSES = [("planned", "Planifié"), ("done", "Réalisé"), ("closed", "Clos"), ("cancelled", "Annulé")]
AUDITOR_KINDS = [("internal", "Auditeur interne"), ("external", "Auditeur externe")]
FINDING_CLASSES = [("major", "Écart majeur"), ("minor", "Écart mineur"), ("observation", "Observation")]
FINDING_STATUSES = [("open", "Ouvert"), ("closed", "Soldé")]
REQUIREMENT_SOURCES = [("law", "Loi ou règlement"), ("standard", "Norme"), ("client_contract", "Contrat client")]
REQUIREMENT_STATUSES = [("compliant", "Conforme"), ("partial", "Partiellement conforme"),
                        ("non_compliant", "Non conforme"), ("not_evaluated", "Non évalué")]
STANDARDS = [("iso_45001", "ISO 45001"), ("iso_14001", "ISO 14001"), ("iso_9001", "ISO 9001"), ("other", "Autre")]

# Rapport mensuel au format d'un donneur d'ordre.
REPORT_NATURES = [("proactive", "Proactif"), ("reactive", "Réactif")]
REPORT_MODES = [("computed", "Calculé par NIMOVA"), ("manual", "Saisi")]
AGGREGATIONS = [("sum", "Somme des mois"), ("average", "Moyenne des mois"), ("last", "Dernier mois renseigné")]
REPORT_STATES = [("draft", "Brouillon"), ("validated", "Validé")]
# État d'un indicateur (cockpit, comité, rapport mensuel) et famille du classement des donneurs d'ordre.
INDICATOR_STATUSES = [("met", "Conforme"), ("watch", "Sous surveillance"), ("missed", "Non conforme"),
                      ("no_data", "Pas de donnée")]
INDICATOR_FAMILIES = [("proactive", "Proactif"), ("reactive", "Réactif")]
NOTIFICATION_CHANNELS = [("app", "Dans l'application"), ("email", "Courriel")]

# ─── Lot 3 ────────────────────────────────────────────────────────────────

# Environnement et qualité (§3).
SPILL_STATUSES = [("open", "En cours de traitement"), ("closed", "Clos")]
WASTE_KINDS = [("used_oil", "Huiles usagées"), ("tyres", "Pneus"), ("filters", "Filtres"), ("other", "Autres déchets")]
WASTE_UNITS = [("l", "Litres"), ("kg", "Kilogrammes"), ("t", "Tonnes"), ("unit", "Pièces")]
# Unité proposée pour chaque nature de déchet.
WASTE_DEFAULT_UNIT = {"used_oil": "l", "tyres": "unit", "filters": "unit", "other": "kg"}
WASTE_STATUSES = [("stored", "Entreposé"), ("collected", "Enlevé")]
DUST_UNITS = [("mg_m3", "mg/m³"), ("ug_m3", "µg/m³")]
CONTAMINATION_KINDS = [("water", "Présence d'eau"), ("mixing", "Mélange de produits"),
                       ("impurities", "Impuretés ou sédiments"), ("off_spec", "Produit hors spécification"),
                       ("other", "Autre contamination")]
CONTAMINATION_STATUSES = [("open", "Ouverte"), ("closed", "Close")]
COMPLAINT_NATURES = [("shortage", "Manquant à la livraison"), ("quality", "Qualité du produit"),
                     ("delay", "Retard de livraison"), ("damage", "Dommage"),
                     ("behaviour", "Comportement du conducteur"), ("documents", "Documents de livraison"),
                     ("other", "Autre motif")]
COMPLAINT_SEVERITIES = [("minor", "Mineure"), ("major", "Majeure"), ("critical", "Critique")]
COMPLAINT_STATUSES = [("received", "Reçue"), ("answered", "Répondue"), ("closed", "Close")]

# Documents et urgences (§3, §9.4).
PROCEDURE_STATUSES = [("draft", "En rédaction"), ("published", "En vigueur"), ("archived", "Archivée")]
VERSION_STATUSES = [("draft", "Brouillon"), ("published", "En vigueur"), ("superseded", "Remplacée")]
BULLETIN_KINDS = [("flash_alert", "Alerte flash"), ("lesson", "Retour d'expérience")]
BULLETIN_STATUSES = [("draft", "Brouillon"), ("published", "Diffusé"), ("archived", "Archivé")]
# Profils qu'une procédure ou une alerte peut viser.
AUDIENCE_PROFILES = ("conducteur", "exploitation", "hsseq", "direction", "rh", "admin")
SCENARIOS = [("spill", "Déversement"), ("fire", "Incendie"), ("road_accident", "Accident de la route"),
             ("intrusion", "Intrusion"), ("medical", "Urgence médicale"), ("explosion", "Explosion"),
             ("other", "Autre scénario")]
DRILL_STATUSES = [("planned", "Planifié"), ("done", "Réalisé"), ("cancelled", "Annulé")]

# Télématique (OBC, GPS, IVMS) : import générique en attendant l'interface du fournisseur.
VIOLATION_TYPES = [("speeding", "Excès de vitesse"), ("harsh_braking", "Freinage brusque"),
                   ("night_driving", "Conduite de nuit"), ("driving_time", "Temps de conduite dépassé")]

# Profils (codes de PROFILE_GROUPS) qui lisent toute fiche HSSEQ de leurs sociétés.
READ_ALL = frozenset({"admin", "direction", "hsseq"})
HSSEQ_GROUP = "eguitra_base.group_profile_hsseq"
DIRECTION_GROUP = "eguitra_base.group_profile_direction"
ADMIN_GROUP = "eguitra_base.group_profile_admin"
EXPLOITATION_GROUP = "eguitra_base.group_profile_exploitation"
AUDITOR_GROUP = "eguitra_base.group_profile_auditeur"
RH_GROUP = "eguitra_base.group_profile_rh"


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


def departed_states(env):
    """États d'une rotation partie (en route, validée, facturée) que connaît Transport."""
    selection = dict(env["eguitra.transport.rotation"]._fields["state"].selection)
    return [s for s in ("en_route", "done", "invoiced") if s in selection]


def tipper_tonnages(rotation):
    """(tonnage chargé, tonnage livré) d'une rotation de benne, lus dans Transport, qui facture la benne à la
    tonne : poids net du ticket de pesée (à défaut, la quantité chargée de la rotation) et quantité livrée ;
    (0, 0) tant que la livraison n'est pas saisie."""
    rotation = rotation.sudo()
    weighed = rotation.weight_net if "weight_net" in rotation._fields else 0.0
    loaded = weighed or rotation.volume_loaded or 0.0
    delivered = rotation.volume_delivered or 0.0
    if not loaded or not delivered:
        return 0.0, 0.0
    return loaded, delivered


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


def indicator_status(value, target, direction, compliant_ratio=1.0, watch_ratio=0.85, threshold=None):
    """État d'un indicateur au regard de sa cible : met (conforme), watch (sous surveillance), missed (non
    conforme), no_data (pas de valeur ou pas de cible).

    Sens « up » : conforme à partir de cible × compliant_ratio, sous surveillance à partir de cible ×
    watch_ratio ; sens « down » : conforme jusqu'à cible ÷ compliant_ratio, sous surveillance jusqu'à cible ÷
    watch_ratio (une cible nulle n'a pas de marge). Un seuil d'alerte explicite (threshold) remplace la
    marge : entre la cible et le seuil, sous surveillance ; au-delà du seuil, non conforme."""
    if value is None or target is None:
        return "no_data"
    if direction == "up":
        if threshold is not None:
            return "met" if value >= target else "watch" if value >= threshold else "missed"
        if value >= target * compliant_ratio:
            return "met"
        return "watch" if value >= target * watch_ratio else "missed"
    if threshold is not None:
        return "met" if value <= target else "watch" if value < threshold else "missed"
    if value <= target / compliant_ratio:
        return "met"
    return "watch" if target > 0 and value <= target / watch_ratio else "missed"


def matrix_cells(counts, level_of):
    """Matrice de criticité 5 × 5 (gravité × probabilité, notes de 1 à 5) : chaque case avec sa criticité, son
    niveau et son nombre (counts : {(gravité, probabilité): nombre}), probabilité 5 en tête."""
    return [{"severity": s, "probability": p, "criticality": s * p, "level": level_of(s * p),
             "count": counts.get((s, p), 0)} for p in range(5, 0, -1) for s in range(1, 6)]
