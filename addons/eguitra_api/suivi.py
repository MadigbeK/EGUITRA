"""Espace partagé de suivi des demandes : règles de l'offre OTF-EGUITRA-2026-37 (chapitres 6.4, 7.2 et
7.4) et de la procédure de support (docs/projet/procedure-de-support.md), sans dépendance au noyau.

- Types, gravités et états d'une demande ; applications concernées (celles de organisation.APPS et la
  plateforme elle-même).
- Délais engagés en heures ouvrées : du lundi au vendredi, de 8 h à 18 h (heure de Conakry), jours
  fériés exclus. Conakry vit à l'heure UTC toute l'année (pas d'heure d'été) : les dates du noyau,
  en UTC, y sont déjà à l'heure locale.
- Crédit d'évolutions : 6 jours par trimestre civil, cumulables dans le trimestre, non reportables ;
  une évolution incluse est estimée à 2 jours-homme au plus.
"""

from datetime import date, datetime, time, timedelta

from .organisation import APPS

KINDS = [
    ("anomalie", "Anomalie"),
    ("recette", "Remarque de recette"),
    ("evolution", "Demande d'évolution"),
    ("question", "Question"),
]
SEVERITIES = [("bloquante", "Bloquante"), ("majeure", "Majeure"), ("mineure", "Mineure")]
STATES = [
    ("submitted", "Déposée"),
    ("taken", "Prise en charge"),
    ("in_progress", "En cours"),
    ("resolved", "Résolue"),
    ("closed", "Close"),
    ("refused", "Refusée"),
]
QUALIFICATIONS = [("incluse", "Incluse dans le crédit du trimestre"), ("facturable", "Facturable sur devis")]
KIND_LABELS = dict(KINDS)
SEVERITY_LABELS = dict(SEVERITIES)
STATE_LABELS = dict(STATES)
QUALIFICATION_LABELS = dict(QUALIFICATIONS)

OPEN_STATES = ("submitted", "taken", "in_progress")
FINAL_STATES = ("closed", "refused")

# Seule l'administration (E-VOLUTION XP) fait avancer une demande ; son auteur la clôt quand elle est
# résolue, ou la rouvre. Une demande close ou refusée ne bouge plus.
ADMIN_TRANSITIONS = {
    "submitted": ("taken", "in_progress", "resolved", "refused"),
    "taken": ("in_progress", "resolved", "refused"),
    "in_progress": ("resolved", "refused"),
    "resolved": ("in_progress", "closed"),
}
AUTHOR_TRANSITIONS = {"resolved": ("closed", "in_progress")}

PLATFORM_APP = "plateforme"
APP_LABELS = {
    "finance": "NIMOVA · Finance",
    "transport": "NIMOVA · Transport",
    "axispro": "NIMOVA · MB AxisPro Consulting",
    "portail": "Portail des porteurs de projets",
    "mobile": "NIMOVA · Rotations",
    "analyse": "NIMOVA · Analyse",
    "rh": "NIMOVA · RH",
    PLATFORM_APP: "Plateforme (connexion, compte, autre)",
}


def app_codes():
    """Applications qu'une demande peut concerner : une application nouvelle (organisation.APPS) y
    entre d'elle-même."""
    return [*APPS, PLATFORM_APP]


def app_selection():
    return [(code, APP_LABELS.get(code, code)) for code in app_codes()]


# Délais engagés (offre, chapitre 7.2), en heures ouvrées. Mineure : résolution à la prochaine
# livraison planifiée, sans délai fixe. Une évolution est qualifiée par écrit sous 2 jours ouvrés
# (chapitre 7.4) : c'est son délai de prise en charge.
HOURS_PER_DAY = 10
OPENING, CLOSING = time(8), time(18)
TAKE_OVER_HOURS = {"bloquante": 2, "majeure": 4, "mineure": HOURS_PER_DAY}
RESOLUTION_HOURS = {"bloquante": 8, "majeure": 2 * HOURS_PER_DAY, "mineure": None}
QUALIFICATION_HOURS = 2 * HOURS_PER_DAY
# Procédure de support, 4 : sans réponse de l'auteur sous 5 jours ouvrés, une demande résolue est close.
AUTO_CLOSE_HOURS = 5 * HOURS_PER_DAY

# Crédit d'évolutions (chapitres 7.3 et 7.4).
CREDIT_PER_QUARTER = 6.0
MAX_INCLUDED_DAYS = 2.0
EPSILON = 1e-6


def business_hours(start, end, holidays=frozenset()):
    """Heures ouvrées entre deux instants (datetime naïfs, en UTC donc à l'heure de Conakry)."""
    if not start or not end or end <= start:
        return 0.0
    total = 0.0
    day = start.date()
    while day <= end.date():
        if day.weekday() < 5 and day not in holidays:
            low = max(start, datetime.combine(day, OPENING))
            high = min(end, datetime.combine(day, CLOSING))
            if high > low:
                total += (high - low).total_seconds() / 3600
        day += timedelta(days=1)
    return round(total, 2)


def take_over_target(kind, severity):
    """Délai de prise en charge engagé, en heures ouvrées."""
    return QUALIFICATION_HOURS if kind == "evolution" else TAKE_OVER_HOURS.get(severity, HOURS_PER_DAY)


def resolution_target(kind, severity):
    """Délai de résolution ou de contournement engagé, en heures ouvrées (None : sans délai fixe)."""
    return None if kind == "evolution" else RESOLUTION_HOURS.get(severity)


def quarter_bounds(day):
    """Premier et dernier jour du trimestre civil d'une date."""
    first_month = 3 * ((day.month - 1) // 3) + 1
    start = date(day.year, first_month, 1)
    following = date(day.year + 1, 1, 1) if first_month == 10 else date(day.year, first_month + 3, 1)
    return start, following - timedelta(days=1)


def quarter_label(day):
    """« T4 2026 »."""
    return f"T{(day.month - 1) // 3 + 1} {day.year}"


def fmt_days(value):
    """Jours à la française : « 0,5 jour », « 1,5 jour », « 2 jours », « 6 jours »."""
    value = round(float(value or 0), 2)
    text = f"{value:.2f}".rstrip("0").rstrip(".").replace(".", ",")
    return f"{text} {'jours' if value >= 2 else 'jour'}"
