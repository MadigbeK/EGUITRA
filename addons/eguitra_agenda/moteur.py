"""Moteur de l'agenda, sans dépendance au noyau : fuseaux, règles de récurrence (RRULE, RFC 5545),
occurrences d'une série, intervalles occupés, recherche de créneaux libres et format iCalendar.

Conventions :
- les instants sont des datetime naïfs en UTC, comme les champs Datetime du noyau ;
- une règle de récurrence est un texte « FREQ=…;… » (sans « RRULE: ») dont l'éventuelle borne UNTIL
  est écrite à l'heure locale de la série, sans « Z » : la série se déroule à l'heure murale de son
  fuseau (un rendez-vous de 9 h reste à 9 h), puis chaque occurrence est ramenée en UTC. Conakry vit
  à UTC+0 toute l'année, sans heure d'été ; le moteur ne le suppose pas pour autant ;
- les heures de travail sont un dictionnaire jour (0 = lundi) -> plages [[minute de début, minute de
  fin]], à l'heure locale de la personne.

Ce fichier n'importe rien du noyau : il se lit et se teste seul (tests/test_moteur.py).
"""

import re
from datetime import UTC, date, datetime, time, timedelta

from dateutil import rrule as du

DEFAULT_TZ = "Africa/Conakry"
DAYS = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")
DAY_LABELS = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche")
FREQS = {"daily": du.DAILY, "weekly": du.WEEKLY, "monthly": du.MONTHLY, "yearly": du.YEARLY}
FREQ_NAMES = {"DAILY": "daily", "WEEKLY": "weekly", "MONTHLY": "monthly", "YEARLY": "yearly"}
MONTH_LABELS = ("janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
                "novembre", "décembre")
RANK_LABELS = {1: "1er", 2: "2e", 3: "3e", 4: "4e", -1: "dernier"}

MAX_COUNT = 730
MAX_INTERVAL = 99
MAX_YEARS = 10
# Bornes de sécurité d'une expansion : une règle valide n'en approche jamais. Au-delà de vingt ans après
# son début, une série n'est plus calculée.
MAX_EXPANSION = 5000
MAX_HORIZON_DAYS = 366 * 20
# Heures de travail par défaut : du lundi au vendredi, de 8 h 00 à 17 h 00.
DEFAULT_WORK_HOURS = {str(d): [[8 * 60, 17 * 60]] for d in range(5)}


class RuleError(ValueError):
    """Règle de récurrence, heures de travail ou fichier iCalendar refusés (message en français)."""


# ─── Fuseaux ─────────────────────────────────────────────────────────────


def _zone(name):
    """Fuseau par son nom : base du système (zoneinfo), à défaut celle que livre dateutil ; None si inconnu."""
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(name)
    except Exception:  # noqa: BLE001 - nom inconnu ou base des fuseaux du système absente
        from dateutil import tz as dutz

        return dutz.gettz(name)


def zone(name):
    """Fuseau horaire par son nom ; Conakry, puis UTC (le même décalage), si le nom est inconnu."""
    return _zone(name or DEFAULT_TZ) or _zone(DEFAULT_TZ) or UTC


def known_zone(name):
    """Le nom désigne-t-il un fuseau connu ?"""
    return bool(name) and _zone(name) is not None


def to_local(value, tz):
    """Instant UTC naïf -> heure murale naïve du fuseau."""
    if value is None:
        return None
    return value.replace(tzinfo=UTC).astimezone(zone(tz)).replace(tzinfo=None)


def to_utc(value, tz):
    """Heure murale naïve du fuseau -> instant UTC naïf."""
    if value is None:
        return None
    return value.replace(tzinfo=zone(tz)).astimezone(UTC).replace(tzinfo=None)


def local_midnight_utc(day, tz):
    """Minuit du jour (date) à l'heure du fuseau, en UTC naïf."""
    return to_utc(datetime.combine(day, time.min), tz)


def fixed_offset(tz):
    """Décalage fixe du fuseau en minutes, ou None s'il change dans l'année (heure d'été)."""
    zinfo = zone(tz)
    year = datetime.now(UTC).year
    offsets = {zinfo.utcoffset(datetime(year, month, 15)) for month in range(1, 13)}
    if len(offsets) != 1:
        return None
    return int(offsets.pop().total_seconds() // 60)


# ─── Règles de récurrence ────────────────────────────────────────────────


def _parse_until(text):
    text = text.strip().upper()
    utc = text.endswith("Z")
    text = text.rstrip("Z")
    for fmt in ("%Y%m%dT%H%M%S", "%Y%m%d"):
        try:
            value = datetime.strptime(text, fmt)
            break
        except ValueError:
            continue
    else:
        raise RuleError("Date de fin de la récurrence illisible.")
    if fmt == "%Y%m%d":
        value = value.replace(hour=23, minute=59, second=59)
    return value, utc


def rule_parts(text):
    """Règle « FREQ=…;… » -> dictionnaire des parties en majuscules (sans contrôle)."""
    text = (text or "").strip()
    if text.upper().startswith("RRULE:"):
        text = text[6:]
    parts = {}
    for chunk in text.split(";"):
        if not chunk.strip():
            continue
        if "=" not in chunk:
            raise RuleError("Règle de récurrence illisible.")
        key, value = chunk.split("=", 1)
        parts[key.strip().upper()] = value.strip()
    return parts


def build_rrule(spec, start_local=None):
    """Règle normalisée à partir de la saisie de l'écran :

    freq : daily, weekly, monthly ou yearly ; interval : 1 à 99 ; days : jours (MO… SU) d'une
    récurrence hebdomadaire ; monthly : « date » (le 12 de chaque mois) ou « rank » (le 2e mardi) ;
    month_day, rank (1 à 4, -1 pour le dernier), rank_day ; end : never, count ou until ; count ;
    until (AAAA-MM-JJ, dernier jour inclus). start_local : début de la série (heure murale), pour les
    valeurs par défaut (jour de la semaine, quantième, rang).
    """
    if not isinstance(spec, dict):
        raise RuleError("Récurrence illisible.")
    freq = spec.get("freq")
    if freq not in FREQS:
        raise RuleError("Fréquence de récurrence inconnue : quotidienne, hebdomadaire, mensuelle ou annuelle.")
    try:
        interval = int(spec["interval"]) if spec.get("interval") not in (None, "") else 1
    except (TypeError, ValueError) as e:
        raise RuleError("Intervalle de récurrence invalide.") from e
    if not 1 <= interval <= MAX_INTERVAL:
        raise RuleError(f"L'intervalle de récurrence va de 1 à {MAX_INTERVAL}.")
    parts = [f"FREQ={freq.upper()}"]
    if interval > 1:
        parts.append(f"INTERVAL={interval}")
    if freq == "weekly":
        days = [d for d in DAYS if d in {str(x).upper() for x in (spec.get("days") or [])}]
        if not days:
            if start_local is None:
                raise RuleError("Choisissez au moins un jour de la semaine.")
            days = [DAYS[start_local.weekday()]]
        parts.append("BYDAY=" + ",".join(days))
    elif freq in ("monthly", "yearly"):
        mode = spec.get("monthly") or "date"
        if mode == "rank":
            try:
                rank = int(spec.get("rank") if spec.get("rank") not in (None, "") else _rank_of(start_local))
            except (TypeError, ValueError) as e:
                raise RuleError("Rang du jour invalide.") from e
            if rank not in RANK_LABELS:
                raise RuleError("Rang du jour : 1er, 2e, 3e, 4e ou dernier.")
            day = str(spec.get("rank_day") or (DAYS[start_local.weekday()] if start_local else "")).upper()
            if day not in DAYS:
                raise RuleError("Jour de la semaine du rang invalide.")
            parts.append(f"BYDAY={rank}{day}" if rank > 0 else f"BYDAY=-1{day}")
        elif mode == "date":
            raw = spec.get("month_day") if spec.get("month_day") not in (None, "") else (start_local.day if start_local else None)
            try:
                month_day = int(raw)
            except (TypeError, ValueError) as e:
                raise RuleError("Quantième du mois invalide.") from e
            if not 1 <= month_day <= 31:
                raise RuleError("Le quantième du mois va de 1 à 31.")
            parts.append(f"BYMONTHDAY={month_day}")
        else:
            raise RuleError("Récurrence mensuelle : par date ou par rang.")
        if freq == "yearly":
            raw = spec.get("month") if spec.get("month") not in (None, "") else (start_local.month if start_local else None)
            try:
                month = int(raw)
            except (TypeError, ValueError) as e:
                raise RuleError("Mois de la récurrence annuelle invalide.") from e
            if not 1 <= month <= 12:
                raise RuleError("Mois de la récurrence annuelle invalide.")
            parts.append(f"BYMONTH={month}")
    end = spec.get("end") or "never"
    if end == "count":
        try:
            count = int(spec.get("count"))
        except (TypeError, ValueError) as e:
            raise RuleError("Nombre d'occurrences invalide.") from e
        if not 1 <= count <= MAX_COUNT:
            raise RuleError(f"Le nombre d'occurrences va de 1 à {MAX_COUNT}.")
        parts.append(f"COUNT={count}")
    elif end == "until":
        until = spec.get("until")
        try:
            until_day = until if isinstance(until, date) else date.fromisoformat(str(until)[:10])
        except (TypeError, ValueError) as e:
            raise RuleError("Date de fin de la récurrence invalide.") from e
        if start_local and until_day < start_local.date():
            raise RuleError("La récurrence finit avant son premier jour.")
        if start_local and until_day > start_local.date() + timedelta(days=366 * MAX_YEARS):
            raise RuleError(f"Une récurrence s'étend sur {MAX_YEARS} ans au plus.")
        parts.append("UNTIL=" + until_day.strftime("%Y%m%d") + "T235959")
    elif end != "never":
        raise RuleError("Fin de récurrence : jamais, après un nombre d'occurrences ou à une date.")
    text = ";".join(parts)
    check_rrule(text)
    return text


def _rank_of(start_local):
    """Rang du jour de la semaine dans le mois (1 à 4, -1 au-delà) : « 2e mardi »."""
    if start_local is None:
        raise RuleError("Rang du jour manquant.")
    rank = (start_local.day - 1) // 7 + 1
    return rank if rank <= 4 else -1


def check_rrule(text):
    """Contrôle une règle normalisée : fréquences et parties connues, bornes de sécurité."""
    parts = rule_parts(text)
    allowed = {"FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "COUNT", "UNTIL", "WKST", "BYSETPOS"}
    unknown = set(parts) - allowed
    if unknown:
        raise RuleError("Règle de récurrence non prise en charge : " + ", ".join(sorted(unknown)) + ".")
    if parts.get("FREQ") not in FREQ_NAMES:
        raise RuleError("Fréquence de récurrence non prise en charge (quotidienne, hebdomadaire, mensuelle, annuelle).")
    if "COUNT" in parts and "UNTIL" in parts:
        raise RuleError("Une récurrence finit après un nombre d'occurrences ou à une date, pas les deux.")
    try:
        if "INTERVAL" in parts and not 1 <= int(parts["INTERVAL"]) <= MAX_INTERVAL:
            raise RuleError(f"L'intervalle de récurrence va de 1 à {MAX_INTERVAL}.")
        if "COUNT" in parts and not 1 <= int(parts["COUNT"]) <= MAX_COUNT:
            raise RuleError(f"Le nombre d'occurrences va de 1 à {MAX_COUNT}.")
    except ValueError as e:
        if isinstance(e, RuleError):
            raise
        raise RuleError("Règle de récurrence illisible.") from e
    if "UNTIL" in parts and parts["UNTIL"].upper().endswith("Z"):
        raise RuleError("Règle non normalisée : la date de fin s'écrit à l'heure locale.")
    _check_shape(parts)
    try:
        du.rrulestr(text, dtstart=datetime(2026, 1, 5, 9, 0))
    except (ValueError, TypeError) as e:
        raise RuleError("Règle de récurrence illisible.") from e
    return text


DAY_RE = re.compile(r"([+-]?[1-5])?(MO|TU|WE|TH|FR|SA|SU)")
MONTH_DAYS = (31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
UNSUPPORTED = "Récurrence non prise en charge : quotidienne, hebdomadaire sur certains jours, mensuelle ou annuelle par date ou par rang."


def _check_shape(parts):
    """Formes de règles admises, celles des grands agendas : quotidienne (éventuellement certains jours),
    hebdomadaire sur certains jours, mensuelle ou annuelle par date (le 12) ou par rang (le 2e mardi,
    le dernier vendredi). Chacune revient au moins une fois tous les quatre ans : le calcul des occurrences
    reste borné. Une règle qui ne tomberait jamais (le 31 février, un 6e lundi) est refusée ici, avant
    toute itération."""
    freq = parts["FREQ"]
    byday = [d for d in (parts.get("BYDAY") or "").split(",") if d]
    for d in byday:
        if not DAY_RE.fullmatch(d):
            raise RuleError(UNSUPPORTED)
    ranked = [d for d in byday if d[:-2]]
    try:
        months = [int(m) for m in parts["BYMONTH"].split(",")] if parts.get("BYMONTH") else []
        monthdays = [int(m) for m in parts["BYMONTHDAY"].split(",")] if parts.get("BYMONTHDAY") else []
        setpos = [int(p) for p in parts["BYSETPOS"].split(",")] if parts.get("BYSETPOS") else []
    except ValueError as e:
        raise RuleError("Règle de récurrence illisible.") from e
    if any(not 1 <= m <= 12 for m in months):
        raise RuleError("Mois de la récurrence invalide.")
    if freq in ("DAILY", "WEEKLY"):
        if ranked or months or monthdays or setpos:
            raise RuleError(UNSUPPORTED)
        return
    if len(monthdays) > 1 or len(setpos) > 1 or (monthdays and byday):
        raise RuleError(UNSUPPORTED)
    if ranked and (len(byday) > 1 or int(ranked[0][:-2]) not in (1, 2, 3, 4, -1)):
        raise RuleError("Rang du jour : 1er, 2e, 3e, 4e ou dernier.")
    if setpos and (not byday or ranked or setpos[0] not in (1, 2, 3, 4, -1)):
        raise RuleError("Rang du jour : 1er, 2e, 3e, 4e ou dernier.")
    if monthdays:
        day = monthdays[0]
        if not (1 <= day <= 31 or day == -1):
            raise RuleError("Le quantième du mois va de 1 à 31.")
        if months and day > 0 and all(day > MONTH_DAYS[m - 1] for m in months):
            raise RuleError("Cette récurrence ne donne aucune occurrence (le 31 février, par exemple).")


def parse_rrule(text, start_local=None):
    """Règle normalisée -> saisie de l'écran (l'inverse de build_rrule)."""
    parts = rule_parts(text)
    spec = {"freq": FREQ_NAMES.get(parts.get("FREQ"), "weekly"), "interval": int(parts.get("INTERVAL") or 1),
            "days": [], "monthly": "date", "month_day": None, "rank": None, "rank_day": None, "month": None,
            "end": "never", "count": None, "until": None}
    byday = [d for d in (parts.get("BYDAY") or "").split(",") if d]
    if spec["freq"] == "weekly":
        spec["days"] = [d[-2:] for d in byday] or ([DAYS[start_local.weekday()]] if start_local else [])
    elif spec["freq"] in ("monthly", "yearly"):
        ranked = next((d for d in byday if re.fullmatch(r"[+-]?\d[A-Z]{2}", d)), None)
        if ranked:
            spec["monthly"] = "rank"
            spec["rank"] = int(ranked[:-2])
            spec["rank_day"] = ranked[-2:]
        elif byday and parts.get("BYSETPOS"):
            spec["monthly"] = "rank"
            spec["rank"] = int(parts["BYSETPOS"])
            spec["rank_day"] = byday[0][-2:]
        else:
            spec["month_day"] = int(parts["BYMONTHDAY"]) if parts.get("BYMONTHDAY") else (start_local.day if start_local else None)
        if spec["freq"] == "yearly":
            spec["month"] = int(parts["BYMONTH"]) if parts.get("BYMONTH") else (start_local.month if start_local else None)
    if parts.get("COUNT"):
        spec["end"] = "count"
        spec["count"] = int(parts["COUNT"])
    elif parts.get("UNTIL"):
        spec["end"] = "until"
        spec["until"] = _parse_until(parts["UNTIL"])[0].date().isoformat()
    return spec


def rrule_label(text, start_local=None):
    """Règle en français : « Chaque semaine le lundi et le mercredi, 10 fois »."""
    try:
        spec = parse_rrule(text, start_local)
    except RuleError:
        return "Récurrence"
    n = spec["interval"]
    freq = spec["freq"]
    if freq == "daily":
        label = "Chaque jour" if n == 1 else f"Tous les {n} jours"
    elif freq == "weekly":
        days = [DAY_LABELS[DAYS.index(d)] for d in spec["days"] if d in DAYS]
        head = "Chaque semaine" if n == 1 else f"Toutes les {n} semaines"
        if days == list(DAY_LABELS[:5]):
            label = f"{head}, du lundi au vendredi"
        elif days:
            label = f"{head} le " + _join(days)
        else:
            label = head
    elif freq == "monthly":
        head = "Chaque mois" if n == 1 else f"Tous les {n} mois"
        label = f"{head}, {_monthly(spec)}"
    else:
        head = "Chaque année" if n == 1 else f"Tous les {n} ans"
        month = MONTH_LABELS[spec["month"] - 1] if spec.get("month") else ""
        if spec["monthly"] == "rank":
            label = f"{head}, {_monthly(spec)}" + (f" de {month}" if month else "")
        else:
            label = f"{head}, le {_day(spec['month_day'])}" + (f" {month}" if month else "")
    if spec["end"] == "count":
        label += f", {spec['count']} fois"
    elif spec["end"] == "until":
        label += ", jusqu'au " + date.fromisoformat(spec["until"]).strftime("%d/%m/%Y")
    return label


def _day(n):
    return "1er" if n == 1 else str(n)


def _monthly(spec):
    if spec["monthly"] == "rank":
        rank = RANK_LABELS.get(spec["rank"], f"{spec['rank']}e")
        day = DAY_LABELS[DAYS.index(spec["rank_day"])] if spec.get("rank_day") in DAYS else ""
        return f"le {rank} {day}".strip()
    return f"le {_day(spec['month_day'])}" if spec.get("month_day") else "à la même date"


def _join(words):
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " et " + words[-1]


def _rule(text, start_local):
    check_rrule(text)
    return du.rrulestr(text, dtstart=start_local, cache=False)


def _bounded(rule, start_local, high=None):
    """Occurrences (heure murale) de la règle, dans l'horizon de la série et au plus jusqu'à `high`, avec un
    garde d'itérations. Les formes admises (_check_shape) reviennent régulièrement : chaque pas de la boucle
    rend une occurrence, la boucle est bornée par la date comme par le nombre."""
    ceiling = start_local + timedelta(days=MAX_HORIZON_DAYS)
    high = min(high, ceiling) if high else ceiling
    for n, local in enumerate(rule.xafter(start_local, inc=True)):
        if local > high or n >= MAX_EXPANSION * 4:
            return
        yield local


def occurrences(start, stop, text, tz, range_start, range_end, limit=MAX_EXPANSION):
    """Débuts (UTC) des occurrences d'une série qui chevauchent [range_start, range_end[, dans l'horizon de
    la série (vingt ans après son début).

    start, stop : première occurrence (UTC) ; la durée de chaque occurrence est la sienne."""
    duration = stop - start
    start_local = to_local(start, tz)
    if range_start - duration > start + timedelta(days=MAX_HORIZON_DAYS):
        return []
    rule = _rule(text, start_local)
    low = to_local(range_start - duration, tz) - timedelta(days=1)
    high = to_local(range_end, tz) + timedelta(days=1)
    found = []
    for local in _bounded(rule, start_local, high):
        if local < low:
            continue
        utc = to_utc(local, tz)
        if utc < range_end and utc + duration > range_start:
            found.append(utc)
            if len(found) >= limit:
                break
    return found


def first_occurrences(start, text, tz, count):
    """Débuts (UTC) des `count` premières occurrences d'une série (dans son horizon)."""
    found = []
    for local in _bounded(_rule(text, to_local(start, tz)), to_local(start, tz)):
        found.append(to_utc(local, tz))
        if len(found) >= count:
            break
    return found


def is_occurrence(start, text, tz, when):
    """L'instant `when` (UTC) est-il le début d'une occurrence de la série ? Hors de l'horizon de la série
    (avant son début, vingt ans après), non, sans rien calculer."""
    if when < start or when > start + timedelta(days=MAX_HORIZON_DAYS):
        return False
    local = to_local(when, tz)
    for occurrence in _bounded(_rule(text, to_local(start, tz)), to_local(start, tz), local):
        if occurrence == local:
            return True
    return False


def count_before(start, text, tz, split):
    """Nombre d'occurrences qui commencent avant l'instant `split` (UTC)."""
    limit = to_local(split, tz)
    n = 0
    for local in _bounded(_rule(text, to_local(start, tz)), to_local(start, tz), limit):
        if local >= limit:
            break
        n += 1
    return n


def last_occurrence(start, text, tz):
    """Début (UTC) de la dernière occurrence d'une série finie ; None si elle est sans fin, ou si sa fin
    dépasse l'horizon calculé (traitée alors comme sans fin : jamais écartée d'une lecture à tort)."""
    parts = rule_parts(text)
    if "COUNT" not in parts and "UNTIL" not in parts:
        return None
    start_local = to_local(start, tz)
    ceiling = start_local + timedelta(days=MAX_HORIZON_DAYS)
    last = None
    for n, local in enumerate(_rule(text, start_local).xafter(start_local, inc=True)):
        if local > ceiling or n >= MAX_EXPANSION:
            return None
        last = local
    return to_utc(last, tz) if last else None


def with_until(text, until_local):
    """Même règle, terminée à l'heure murale `until_local` (COUNT retiré)."""
    parts = [p for p in text.split(";") if p and not p.upper().startswith(("COUNT=", "UNTIL="))]
    parts.append("UNTIL=" + until_local.strftime("%Y%m%dT%H%M%S"))
    return ";".join(parts)


def with_count(text, count):
    """Même règle, terminée après `count` occurrences (UNTIL retiré)."""
    parts = [p for p in text.split(";") if p and not p.upper().startswith(("COUNT=", "UNTIL="))]
    parts.append(f"COUNT={count}")
    return ";".join(parts)


def normalize_rrule(text, tz, dtstart_is_utc=False):
    """Règle reçue d'un fichier iCalendar -> règle normalisée (UNTIL à l'heure locale, sans « Z »)."""
    parts = rule_parts(text)
    out = []
    for key, value in parts.items():
        if key == "UNTIL":
            until, utc = _parse_until(value)
            if utc:
                until = to_local(until, tz)
            value = until.strftime("%Y%m%dT%H%M%S")
        elif key == "WKST":
            continue
        out.append(f"{key}={value}")
    text = ";".join(out)
    check_rrule(text)
    return text


# ─── Intervalles et heures de travail ────────────────────────────────────


def merge(intervals):
    """Intervalles [début, fin[ fusionnés et triés."""
    merged = []
    for start, end in sorted((s, e) for s, e in intervals if e > s):
        if merged and start <= merged[-1][1]:
            if end > merged[-1][1]:
                merged[-1][1] = end
        else:
            merged.append([start, end])
    return [(s, e) for s, e in merged]


def overlaps(intervals, start, end):
    """Un intervalle de la liste chevauche-t-il [start, end[ ?"""
    return any(s < end and e > start for s, e in intervals)


def check_work_hours(value):
    """Heures de travail saisies -> forme normalisée {"0": [[480, 1020]], …} (minutes, jour 0 = lundi)."""
    if not isinstance(value, dict):
        raise RuleError("Heures de travail illisibles.")
    out = {}
    for key, ranges in value.items():
        try:
            day = int(key)
        except (TypeError, ValueError) as e:
            raise RuleError("Jour des heures de travail invalide.") from e
        if not 0 <= day <= 6:
            raise RuleError("Jour des heures de travail invalide.")
        clean = []
        for item in ranges or []:
            try:
                start, end = (_minutes(x) for x in item)
            except (TypeError, ValueError) as e:
                raise RuleError("Plage horaire illisible : écrivez par exemple 08:00 à 17:00.") from e
            if not 0 <= start < end <= 24 * 60:
                raise RuleError("Une plage horaire finit après son début, dans la même journée.")
            clean.append([start, end])
        clean.sort()
        for a, b in zip(clean, clean[1:]):
            if b[0] < a[1]:
                raise RuleError("Les plages d'une même journée ne se chevauchent pas.")
        if len(clean) > 4:
            raise RuleError("Quatre plages par jour au plus.")
        if clean:
            out[str(day)] = clean
    return out


def _minutes(value):
    """« 08:30 », 510 -> 510 minutes."""
    if isinstance(value, int):
        return value
    text = str(value).strip()
    match = re.fullmatch(r"(\d{1,2})[:h ]?(\d{2})?", text)
    if not match:
        raise ValueError(text)
    hours, minutes = int(match.group(1)), int(match.group(2) or 0)
    if hours == 24 and minutes == 0:
        return 24 * 60
    if not (0 <= hours < 24 and 0 <= minutes < 60):
        raise ValueError(text)
    return hours * 60 + minutes


def hhmm(minutes):
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def within_work(work, tz, start, end):
    """[start, end[ (UTC) tient-il dans une plage de travail d'un même jour local ? work None : toujours."""
    if work is None:
        return True
    local_start, local_end = to_local(start, tz), to_local(end, tz)
    day = local_start.date()
    if local_end.date() != day and not (local_end.date() == day + timedelta(days=1) and local_end.time() == time.min):
        return False
    a = local_start.hour * 60 + local_start.minute
    b = 24 * 60 if local_end.date() != day else local_end.hour * 60 + local_end.minute
    return any(lo <= a and b <= hi for lo, hi in (work.get(str(day.weekday())) or []))


def work_intervals(work, tz, range_start, range_end):
    """Plages de travail (UTC) entre deux instants ; work None : tout l'intervalle."""
    if work is None:
        return [(range_start, range_end)]
    out = []
    day = to_local(range_start, tz).date()
    last = to_local(range_end, tz).date()
    while day <= last:
        for lo, hi in work.get(str(day.weekday())) or []:
            s = to_utc(datetime.combine(day, time.min) + timedelta(minutes=lo), tz)
            e = to_utc(datetime.combine(day, time.min) + timedelta(minutes=hi), tz)
            s, e = max(s, range_start), min(e, range_end)
            if e > s:
                out.append((s, e))
        day += timedelta(days=1)
    return out


# ─── Recherche de créneaux ───────────────────────────────────────────────


def _aligned(value, step):
    """Premier instant aligné sur le pas (en minutes) à partir de value."""
    base = value.replace(second=0, microsecond=0)
    if base < value:
        base += timedelta(minutes=1)
    extra = (base.hour * 60 + base.minute) % step
    return base + timedelta(minutes=(step - extra) % step)


def _free(person, start, end, buffer):
    pad = timedelta(minutes=buffer)
    return not overlaps(person.get("busy") or [], start - pad, end + pad) and within_work(
        person.get("work"), person.get("tz") or DEFAULT_TZ, start, end)


def find_slots(range_start, range_end, duration, required, optional=(), step=15, buffer=0, limit=10, now=None):
    """Créneaux communs, classés.

    required, optional : personnes ou ressources {"key", "busy": [(début, fin)], "work": heures ou None,
    "tz"} ; les obligatoires doivent toutes être libres, dans leurs heures de travail, avec le temps
    tampon (minutes) avant et après leurs autres engagements. Classement : le plus de facultatifs
    disponibles d'abord, puis le plus tôt. Rend [{"start", "stop", "optional_free": [clés], "score"}]."""
    if duration <= timedelta(0):
        raise RuleError("La durée d'un créneau est positive.")
    start = _aligned(max(range_start, now) if now else range_start, step)
    slots = []
    candidates = 0
    while start + duration <= range_end and candidates < 20000:
        candidates += 1
        end = start + duration
        if all(_free(p, start, end, buffer) for p in required):
            free_optional = [p["key"] for p in optional if _free(p, start, end, buffer)]
            slots.append({"start": start, "stop": end, "optional_free": free_optional,
                          "score": len(free_optional) * 1000 - int((start - range_start).total_seconds() // 3600)})
        start += timedelta(minutes=step)
    slots.sort(key=lambda s: (-len(s["optional_free"]), s["start"]))
    # Pas deux propositions qui se chevauchent : la première de chaque groupe, la mieux classée.
    chosen = []
    for slot in slots:
        if not any(slot["start"] < c["stop"] and slot["stop"] > c["start"] for c in chosen):
            chosen.append(slot)
        if len(chosen) >= limit:
            break
    return chosen


def nearest_free(busy, desired, duration, work=None, tz=DEFAULT_TZ, step=15, horizon_days=14, buffer=0, now=None):
    """Créneau libre le plus proche de `desired` (UTC), avant ou après, dans l'horizon ; None sinon."""
    person = {"busy": busy, "work": work, "tz": tz}
    floor = _aligned(now, step) if now else None
    base = desired.replace(second=0, microsecond=0)
    for n in range(0, horizon_days * 24 * 60 // step + 1):
        for sign in ((1,) if n == 0 else (1, -1)):
            start = base + timedelta(minutes=sign * n * step)
            if floor and start < floor:
                continue
            if _free(person, start, start + duration, buffer):
                return start
    return None


# ─── iCalendar (RFC 5545) ────────────────────────────────────────────────

PARTSTAT = {"accepted": "ACCEPTED", "declined": "DECLINED", "tentative": "TENTATIVE", "needs_action": "NEEDS-ACTION"}
PARTSTAT_IN = {v: k for k, v in PARTSTAT.items()}
CLASSES = {"public": "PUBLIC", "private": "PRIVATE", "confidential": "CONFIDENTIAL"}
CLASSES_IN = {v: k for k, v in CLASSES.items()}
BUSY = {"busy": "BUSY", "free": "FREE", "tentative": "TENTATIVE", "oof": "OOF"}
BUSY_IN = {v: k for k, v in BUSY.items()}
MAX_ICS_BYTES = 5 * 1024 * 1024
MAX_ICS_EVENTS = 2000


def ics_escape(value):
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def ics_unescape(value):
    out, i = [], 0
    while i < len(value):
        c = value[i]
        if c == "\\" and i + 1 < len(value):
            nxt = value[i + 1]
            out.append("\n" if nxt in "nN" else nxt)
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _param(value):
    """Valeur de paramètre (CN) : guillemets si elle contient « : ; , », sans guillemet ni retour."""
    text = " ".join(str(value or "").replace('"', "'").split())
    return f'"{text}"' if any(c in text for c in ":;,") else text


def fold(line):
    """Ligne pliée à 75 octets (RFC 5545, 3.1), sans couper un caractère UTF-8."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    chunks, current, size = [], "", 0
    limit = 75
    for char in line:
        width = len(char.encode("utf-8"))
        if size + width > limit:
            chunks.append(current)
            current, size, limit = char, width, 74
        else:
            current += char
            size += width
    chunks.append(current)
    return "\r\n ".join(chunks)


def _stamp(value):
    return value.strftime("%Y%m%dT%H%M%SZ")


def _vtimezone(tz):
    """Définition du fuseau (décalage fixe) ; None si le fuseau a une heure d'été (instants en UTC)."""
    offset = fixed_offset(tz)
    if offset is None:
        return None
    sign = "+" if offset >= 0 else "-"
    text = f"{sign}{abs(offset) // 60:02d}{abs(offset) % 60:02d}"
    return ["BEGIN:VTIMEZONE", f"TZID:{tz}", "BEGIN:STANDARD", "DTSTART:19700101T000000", f"TZOFFSETFROM:{text}",
            f"TZOFFSETTO:{text}", "END:STANDARD", "END:VTIMEZONE"]


def ics_calendar(events, name="NIMOVA · Agenda", method=None, tz=DEFAULT_TZ, now=None):
    """Fichier iCalendar d'une liste d'événements (dictionnaires) :

    uid, sequence, summary, location, description, url, start, stop (UTC), allday, start_date, end_date
    (dernier jour inclus), tz, rrule (normalisée), exdates (UTC), recurrence_id (UTC, occurrence
    remplacée), privacy, show_as, status (confirmed, cancelled), organizer {name, email}, attendees
    [{name, email, state, required}], created, modified.
    """
    now = now or datetime.now(UTC).replace(tzinfo=None)
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//E-VOLUTION XP//NIMOVA Agenda//FR", "CALSCALE:GREGORIAN",
             f"X-WR-CALNAME:{ics_escape(name)}", f"X-WR-TIMEZONE:{tz}"]
    if method:
        lines.append(f"METHOD:{method}")
    zones = {}
    body = []
    for ev in events:
        etz = ev.get("tz") or tz
        vtz = _vtimezone(etz) if ev.get("rrule") and not ev.get("allday") else None
        if vtz:
            zones[etz] = vtz
        body.extend(_vevent(ev, etz if vtz else None, now))
    for vtz in zones.values():
        lines.extend(vtz)
    lines.extend(body)
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold(line) for line in lines) + "\r\n"


def _when(prop, ev, value, local_tz, allday_day=None):
    if allday_day is not None:
        return f"{prop};VALUE=DATE:{allday_day.strftime('%Y%m%d')}"
    if local_tz:
        return f"{prop};TZID={local_tz}:{to_local(value, local_tz).strftime('%Y%m%dT%H%M%S')}"
    return f"{prop}:{_stamp(value)}"


def _vevent(ev, local_tz, now):
    lines = ["BEGIN:VEVENT", f"UID:{ev['uid']}", f"DTSTAMP:{_stamp(now)}", f"SEQUENCE:{int(ev.get('sequence') or 0)}"]
    if ev.get("allday"):
        start_day = ev["start_date"]
        end_day = ev["end_date"] + timedelta(days=1)
        lines.append(_when("DTSTART", ev, None, None, start_day))
        lines.append(_when("DTEND", ev, None, None, end_day))
    else:
        lines.append(_when("DTSTART", ev, ev["start"], local_tz))
        lines.append(_when("DTEND", ev, ev["stop"], local_tz))
    day_of = (lambda value: to_local(value, ev.get("tz") or DEFAULT_TZ).date()) if ev.get("allday") else (lambda _v: None)
    if ev.get("recurrence_id"):
        rid = ev["recurrence_id"]
        lines.append(_when("RECURRENCE-ID", ev, rid, local_tz, day_of(rid)))
    if ev.get("rrule"):
        rule = ev["rrule"]
        parts = rule_parts(rule)
        if "UNTIL" in parts:
            until, _utc = _parse_until(parts["UNTIL"])
            if ev.get("allday"):
                value = until.strftime("%Y%m%d")
            elif local_tz:
                value = _stamp(to_utc(until, local_tz))
            else:
                value = _stamp(to_utc(until, ev.get("tz") or DEFAULT_TZ))
            rule = ";".join(f"{k}={value if k == 'UNTIL' else v}" for k, v in parts.items())
        lines.append(f"RRULE:{rule}")
        for ex in ev.get("exdates") or []:
            lines.append(_when("EXDATE", ev, ex, local_tz, day_of(ex)))
    lines.append(f"SUMMARY:{ics_escape(ev.get('summary') or 'Occupé')}")
    if ev.get("location"):
        lines.append(f"LOCATION:{ics_escape(ev['location'])}")
    description = ev.get("description") or ""
    if ev.get("url"):
        description = (description + "\n\n" if description else "") + "Visioconférence : " + ev["url"]
        lines.append(f"URL:{ev['url']}")
    if description:
        lines.append(f"DESCRIPTION:{ics_escape(description)}")
    lines.append(f"CLASS:{CLASSES.get(ev.get('privacy') or 'public', 'PUBLIC')}")
    show_as = ev.get("show_as") or "busy"
    lines.append("TRANSP:" + ("TRANSPARENT" if show_as == "free" else "OPAQUE"))
    lines.append(f"X-MICROSOFT-CDO-BUSYSTATUS:{BUSY.get(show_as, 'BUSY')}")
    lines.append("STATUS:" + ("CANCELLED" if ev.get("status") == "cancelled" else
                              "TENTATIVE" if show_as == "tentative" else "CONFIRMED"))
    organizer = ev.get("organizer")
    if organizer and organizer.get("email"):
        lines.append(f"ORGANIZER;CN={_param(organizer.get('name'))}:mailto:{organizer['email']}")
    for att in ev.get("attendees") or []:
        if not att.get("email"):
            continue
        role = "REQ-PARTICIPANT" if att.get("required", True) else "OPT-PARTICIPANT"
        state = PARTSTAT.get(att.get("state") or "needs_action", "NEEDS-ACTION")
        rsvp = ";RSVP=TRUE" if state == "NEEDS-ACTION" else ""
        lines.append(f"ATTENDEE;CN={_param(att.get('name'))};ROLE={role};PARTSTAT={state}{rsvp}:mailto:{att['email']}")
    if ev.get("created"):
        lines.append(f"CREATED:{_stamp(ev['created'])}")
    if ev.get("modified"):
        lines.append(f"LAST-MODIFIED:{_stamp(ev['modified'])}")
    lines.append("END:VEVENT")
    return lines


def _unfold(text):
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = []
    for raw in text.split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        elif raw.strip():
            lines.append(raw)
    return lines


def _split_line(line):
    """« NOM;PARAM=x;…:valeur » -> (NOM, {PARAM: x}, valeur), guillemets des paramètres compris."""
    in_quotes = False
    for i, c in enumerate(line):
        if c == '"':
            in_quotes = not in_quotes
        elif c == ":" and not in_quotes:
            head, value = line[:i], line[i + 1:]
            break
    else:
        return None
    pieces, current, in_quotes = [], "", False
    for c in head:
        if c == '"':
            in_quotes = not in_quotes
            continue
        if c == ";" and not in_quotes:
            pieces.append(current)
            current = ""
        else:
            current += c
    pieces.append(current)
    params = {}
    for piece in pieces[1:]:
        if "=" in piece:
            k, v = piece.split("=", 1)
            params[k.upper()] = v
    return pieces[0].upper(), params, value


def _read_when(params, value, default_tz):
    """Valeur d'un DTSTART, DTEND, EXDATE ou RECURRENCE-ID -> (instant UTC ou date, journée entière)."""
    value = value.strip()
    if params.get("VALUE", "").upper() == "DATE" or re.fullmatch(r"\d{8}", value):
        return datetime.strptime(value[:8], "%Y%m%d").date(), True
    utc = value.endswith("Z")
    try:
        moment = datetime.strptime(value.rstrip("Z")[:15], "%Y%m%dT%H%M%S")
    except ValueError:
        moment = datetime.strptime(value.rstrip("Z")[:13], "%Y%m%dT%H%M")
    if utc:
        return moment, False
    return to_utc(moment, params.get("TZID") or default_tz), False


def _duration(text):
    match = re.fullmatch(r"([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", text.strip())
    if not match:
        raise RuleError("Durée illisible dans le fichier.")
    sign = -1 if match.group(1) == "-" else 1
    weeks, days, hours, minutes, seconds = (int(x or 0) for x in match.groups()[1:])
    return sign * timedelta(weeks=weeks, days=days, hours=hours, minutes=minutes, seconds=seconds)


def parse_ics(text, default_tz=DEFAULT_TZ):
    """Fichier iCalendar -> événements (dictionnaires au format d'ics_calendar). Les événements annulés,
    les tâches et les alarmes sont ignorés ; les fuseaux nommés (TZID) sont lus par leur nom."""
    if isinstance(text, bytes):
        if len(text) > MAX_ICS_BYTES:
            raise RuleError("Fichier trop volumineux : 5 Mo au plus.")
        text = text.decode("utf-8-sig", errors="replace")
    if "BEGIN:VCALENDAR" not in text.upper():
        raise RuleError("Ce fichier n'est pas un agenda au format iCalendar (.ics).")
    events, current, depth = [], None, []
    for line in _unfold(text):
        parsed = _split_line(line)
        if not parsed:
            continue
        name, params, value = parsed
        if name == "BEGIN":
            depth.append(value.upper())
            if value.upper() == "VEVENT" and depth.count("VEVENT") == 1:
                current = {"attendees": [], "exdates": [], "tz": params.get("TZID") or default_tz}
            continue
        if name == "END":
            if depth:
                closed = depth.pop()
                if closed == "VEVENT" and current is not None:
                    events.append(current)
                    current = None
                    if len(events) > MAX_ICS_EVENTS:
                        raise RuleError(f"Fichier trop long : {MAX_ICS_EVENTS} événements au plus.")
            continue
        if current is None or depth[-1:] != ["VEVENT"]:
            continue
        if name == "UID":
            current["uid"] = value.strip()[:200]
        elif name == "SUMMARY":
            current["summary"] = ics_unescape(value)
        elif name == "LOCATION":
            current["location"] = ics_unescape(value)
        elif name == "DESCRIPTION":
            current["description"] = ics_unescape(value)
        elif name == "URL":
            current["url"] = value.strip()
        elif name in ("X-GOOGLE-CONFERENCE", "X-MICROSOFT-SKYPETEAMSMEETINGURL"):
            current.setdefault("url", value.strip())
        elif name == "DTSTART":
            current["_start"], current["allday"] = _read_when(params, value, default_tz)
            if params.get("TZID"):
                current["tz"] = params["TZID"]
        elif name == "DTEND":
            current["_end"], _allday = _read_when(params, value, default_tz)
        elif name == "DURATION":
            current["_duration"] = _duration(value)
        elif name == "RRULE":
            current["_rrule"] = value
        elif name == "EXDATE":
            for item in value.split(","):
                when, _allday = _read_when(params, item, default_tz)
                current["exdates"].append(when)
        elif name == "RECURRENCE-ID":
            current["_recurrence_id"], _allday = _read_when(params, value, default_tz)
        elif name == "CLASS":
            current["privacy"] = CLASSES_IN.get(value.strip().upper(), "public")
        elif name == "TRANSP" and value.strip().upper() == "TRANSPARENT":
            current["show_as"] = "free"
        elif name == "X-MICROSOFT-CDO-BUSYSTATUS":
            current["show_as"] = BUSY_IN.get(value.strip().upper(), current.get("show_as") or "busy")
        elif name == "STATUS":
            current["status"] = value.strip().lower()
        elif name == "ATTENDEE":
            email = re.sub(r"^mailto:", "", value.strip(), flags=re.I)
            current["attendees"].append({
                "email": email[:254], "name": (params.get("CN") or "")[:120] or None,
                "state": PARTSTAT_IN.get((params.get("PARTSTAT") or "").upper(), "needs_action"),
                "required": (params.get("ROLE") or "REQ-PARTICIPANT").upper() != "OPT-PARTICIPANT",
            })
        elif name == "ORGANIZER":
            current["organizer"] = {"email": re.sub(r"^mailto:", "", value.strip(), flags=re.I)[:254],
                                    "name": (params.get("CN") or "")[:120] or None}
    return [ev for ev in (_finish(e, default_tz) for e in events) if ev]


def _finish(ev, default_tz):
    start = ev.pop("_start", None)
    if start is None or ev.get("status") == "cancelled":
        return None
    end = ev.pop("_end", None)
    duration = ev.pop("_duration", None)
    tz = ev.get("tz") or default_tz
    if ev.get("allday"):
        start_day = start if isinstance(start, date) and not isinstance(start, datetime) else start.date()
        if isinstance(end, date) and not isinstance(end, datetime):
            end_day = end - timedelta(days=1)
        elif duration:
            end_day = start_day + timedelta(days=max(duration.days, 1) - 1)
        else:
            end_day = start_day
        end_day = max(end_day, start_day)
        ev.update(start_date=start_day, end_date=end_day, start=local_midnight_utc(start_day, tz),
                  stop=local_midnight_utc(end_day + timedelta(days=1), tz))
    else:
        if isinstance(end, datetime):
            stop = end
        elif duration:
            stop = start + duration
        else:
            stop = start + timedelta(hours=1)
        if stop <= start:
            stop = start + timedelta(minutes=30)
        ev.update(start=start, stop=stop)
    ev["exdates"] = [x if isinstance(x, datetime) else local_midnight_utc(x, tz) for x in ev.get("exdates") or []]
    rid = ev.pop("_recurrence_id", None)
    if rid is not None:
        ev["recurrence_id"] = rid if isinstance(rid, datetime) else local_midnight_utc(rid, tz)
    raw = ev.pop("_rrule", None)
    if raw:
        try:
            ev["rrule"] = normalize_rrule(raw, tz)
        except RuleError:
            ev["rrule"] = None
            ev["rrule_dropped"] = True
    ev["summary"] = (ev.get("summary") or "Sans titre")[:200]
    return ev
