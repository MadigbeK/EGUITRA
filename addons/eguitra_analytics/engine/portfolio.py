"""Méthodes propres au portefeuille du cabinet (MB AxisPro), sans dépendance au noyau.

- Probabilité de bancabilité : fonction logistique du score Bankability, calée sur trois points
  (50 → 0,2 ; 65 → 0,5 ; 80 → 0,8), nulle en présence d'un knock-out confirmé.
- Séjours dans les gates, reconstitués depuis le journal des passages (« Passage de G1 à G2. »,
  « Passage forcé de G1 à G2 (HOLD) : motif ») : un passage clôt le séjour dans le gate d'origine, le
  dernier séjour reste ouvert à la date d'arrêté.
- Durée médiane de séjour par l'estimateur de Kaplan-Meier : les dossiers encore dans le gate sont des
  observations censurées (leur séjour durera au moins leur âge), ce qui corrige le biais d'une médiane
  calculée sur les seuls passages achevés (les dossiers lents n'y figurent pas encore).
- Quantiles par interpolation linéaire (méthode « inclusive », celle des tableurs).
- Accord entre la recommandation de la méthode et la décision du comité : matrice, taux d'accord,
  kappa de Cohen (accord au-delà du hasard), décisions plus favorables ou plus sévères que la méthode.
- Concentration : indice de Herfindahl-Hirschman (somme des carrés des parts, de 1/n à 1).
- Calendrier : clés de mois (AAAA-MM) et de semaines (lundi, AAAA-MM-JJ).
"""

import math
import re
from datetime import timedelta

LOGISTIC_MIDPOINT = 65.0
LOGISTIC_SLOPE = math.log(4) / 15

# Recommandation de la méthode ramenée à l'échelle des décisions du comité.
RECOMMENDATION_DECISION = {
    "bankable": "go", "apd_ready": "go", "go": "go", "conditional": "conditional", "hold": "hold", "no_go": "no_go",
}
# Échelle des décisions, de la plus sévère à la plus favorable.
DECISION_ORDER = {"no_go": 0, "hold": 1, "conditional": 2, "go": 3}

GATE_NOTE = re.compile(r"^Passage (?P<forced>forcé )?de (?P<src>.+?) à (?P<dst>.+?)(?: \(|\.?\s*$)", re.S)


def bankability_probability(score, knockout=False):
    """Probabilité qu'un dossier devienne bancable : 1 / (1 + e^(-k (score - 65))), k = ln 4 / 15."""
    if knockout:
        return 0.0
    return 1.0 / (1.0 + math.exp(-LOGISTIC_SLOPE * ((score or 0.0) - LOGISTIC_MIDPOINT)))


def quantile(values, q):
    """Quantile q (0 à 1) par interpolation linéaire entre les deux rangs encadrants ; None sans valeur."""
    data = sorted(float(v) for v in values if v is not None)
    if not data:
        return None
    position = (len(data) - 1) * q
    low, high = math.floor(position), math.ceil(position)
    return data[low] + (data[high] - data[low]) * (position - low)


def median(values):
    return quantile(values, 0.5)


def mean(values):
    data = [float(v) for v in values if v is not None]
    return sum(data) / len(data) if data else None


def parse_gate_note(note):
    """(gate d'origine, gate d'arrivée, passage forcé) d'une note de passage du journal, sinon None."""
    match = GATE_NOTE.match((note or "").strip())
    if not match:
        return None
    return match.group("src").strip(), match.group("dst").strip(), bool(match.group("forced"))


def sojourns(opening, passages, first_gate, until):
    """Séjours d'un dossier dans ses gates jusqu'à la date d'arrêté.

    opening : date d'ouverture du dossier (entrée dans le premier gate) ; passages : [(date, origine,
    arrivée, forcé)] triés par date ; first_gate : code du premier gate ; until : date d'arrêté. Chaque
    séjour : {gate, start, end, days, forced, open} ; le dernier est ouvert, son âge court jusqu'à until.
    """
    rows, start, gate = [], opening, first_gate
    for day, src, dst, forced in passages:
        if day > until:
            break
        rows.append({"gate": src or gate, "start": start, "end": day, "days": max((day - start).days, 0),
                     "forced": bool(forced), "open": False})
        start, gate = day, dst
    rows.append({"gate": gate, "start": start, "end": None, "days": max((until - start).days, 0),
                 "forced": False, "open": True})
    return rows


def km_median(observations):
    """Médiane de Kaplan-Meier. observations : [(durée, achevé)] ; achevé False = séjour en cours,
    censuré à son âge. Renvoie la plus petite durée où la survie passe sous 50 %, None si elle n'y passe
    pas (plus de la moitié des séjours durent plus longtemps que tout passage observé)."""
    survival = 1.0
    for t in sorted({d for d, done in observations if done}):
        at_risk = sum(1 for d, _done in observations if d >= t)
        events = sum(1 for d, done in observations if done and d == t)
        survival *= 1 - events / at_risk
        if survival <= 0.5:
            return float(t)
    return None


def agreement(pairs):
    """Accord méthode / comité. pairs : [(recommandation de la méthode, décision du comité)].

    Les recommandations « à compléter » et les décisions ajournées sont écartées du calcul. Renvoie n,
    le taux d'accord (%), le kappa de Cohen sur l'échelle GO / CONDITIONAL GO / HOLD / NO-GO, le nombre
    de décisions plus favorables (lenient) et plus sévères (strict) que la méthode."""
    kept = [(RECOMMENDATION_DECISION[r], d) for r, d in pairs if r in RECOMMENDATION_DECISION and d in DECISION_ORDER]
    n = len(kept)
    if not n:
        return {"n": 0, "agreed": 0, "agreement_pct": None, "kappa": None, "lenient": 0, "strict": 0}
    agreed = sum(1 for m, d in kept if m == d)
    observed = agreed / n
    expected = sum((sum(1 for m, _d in kept if m == c) / n) * (sum(1 for _m, d in kept if d == c) / n)
                   for c in DECISION_ORDER)
    kappa = (observed - expected) / (1 - expected) if expected < 1 else None
    return {
        "n": n, "agreed": agreed, "agreement_pct": observed * 100, "kappa": kappa,
        "lenient": sum(1 for m, d in kept if DECISION_ORDER[d] > DECISION_ORDER[m]),
        "strict": sum(1 for m, d in kept if DECISION_ORDER[d] < DECISION_ORDER[m]),
    }


def hhi(values):
    """Indice de Herfindahl-Hirschman des montants (parts au carré, de 1/n à 1) ; None si total nul."""
    total = sum(v for v in values if v and v > 0)
    if not total:
        return None
    return sum((v / total) ** 2 for v in values if v and v > 0)


def month_key(day):
    return f"{day.year:04d}-{day.month:02d}"


def month_keys(start, end):
    """Mois de start à end inclus (AAAA-MM)."""
    keys, year, month = [], start.year, start.month
    while (year, month) <= (end.year, end.month):
        keys.append(f"{year:04d}-{month:02d}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return keys


def months_back(end, count):
    """Les `count` mois se terminant par celui de end (AAAA-MM)."""
    year, month = end.year, end.month - (count - 1)
    while month < 1:
        year, month = year - 1, month + 12
    return month_keys(end.replace(year=year, month=month, day=1), end)


def next_months(end, count):
    """Les `count` mois suivant celui de end (AAAA-MM)."""
    keys, year, month = [], end.year, end.month
    for _i in range(count):
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
        keys.append(f"{year:04d}-{month:02d}")
    return keys


def week_start(day):
    return day - timedelta(days=day.weekday())


def week_keys(start, end, limit=None):
    """Semaines (lundi, AAAA-MM-JJ) de start à end ; les `limit` dernières au plus."""
    keys, current = [], week_start(start)
    while current <= end:
        keys.append(current.isoformat())
        current += timedelta(days=7)
    return keys[-limit:] if limit else keys
