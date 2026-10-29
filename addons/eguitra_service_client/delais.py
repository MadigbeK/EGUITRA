"""Calendrier ouvré du service client, sans dépendance au noyau : du lundi au vendredi, entre une heure
d'ouverture et une heure de fermeture réglables par société (8 h à 17 h par défaut), jours fériés exclus
(ceux du module RH quand il est installé).

Conakry vit à l'heure UTC toute l'année : les dates du noyau, naïves et en UTC, y sont déjà à l'heure
locale. Les heures d'ouverture et de fermeture sont des heures décimales (8.5 : 8 h 30).
"""

from datetime import datetime, time, timedelta

MAX_DAYS = 3660  # garde-fou : dix ans de calendrier au plus pour une échéance


def _clock(hours):
    """Heure décimale -> time (8.5 -> 08:30) ; 24 donne la fin de journée."""
    hours = max(0.0, min(float(hours), 24.0))
    if hours >= 24:
        return time(23, 59, 59)
    minutes = int(round(hours * 60))
    return time(minutes // 60, minutes % 60)


def check_hours(start, end):
    """Heures d'ouverture valides : 0 <= ouverture < fermeture <= 24 ; sinon ValueError (message français)."""
    try:
        start, end = float(start), float(end)
    except (TypeError, ValueError) as e:
        raise ValueError("Heures d'ouverture illisibles.") from e
    if not (0 <= start < end <= 24):
        raise ValueError("L'heure d'ouverture précède l'heure de fermeture, entre 0 h et 24 h.")
    if end - start < 1:
        raise ValueError("Une journée ouvrée dure au moins une heure.")
    return start, end


def is_working_day(day, holidays=frozenset()):
    return day.weekday() < 5 and day not in holidays


def business_hours(start, end, open_at=8.0, close_at=17.0, holidays=frozenset()):
    """Heures ouvrées entre deux instants (datetime naïfs) ; 0 si end <= start."""
    if not start or not end or end <= start:
        return 0.0
    opening, closing = _clock(open_at), _clock(close_at)
    total = 0.0
    day = start.date()
    last = end.date()
    while day <= last:
        if is_working_day(day, holidays):
            low = max(start, datetime.combine(day, opening))
            high = min(end, datetime.combine(day, closing))
            if high > low:
                total += (high - low).total_seconds() / 3600
        day += timedelta(days=1)
    return round(total, 2)


def add_business_hours(start, hours, open_at=8.0, close_at=17.0, holidays=frozenset()):
    """Instant atteint après `hours` heures ouvrées depuis `start`. Un dossier reçu hors des heures (la nuit,
    le samedi) commence à courir à l'ouverture suivante ; une échéance qui tombe pile à la fermeture y reste."""
    if hours is None:
        return None
    remaining = max(float(hours), 0.0)
    opening, closing = _clock(open_at), _clock(close_at)
    moment = start
    for _ in range(MAX_DAYS):
        day = moment.date()
        if not is_working_day(day, holidays):
            moment = datetime.combine(day + timedelta(days=1), opening)
            continue
        day_open, day_close = datetime.combine(day, opening), datetime.combine(day, closing)
        if moment < day_open:
            moment = day_open
        if moment >= day_close:
            moment = datetime.combine(day + timedelta(days=1), opening)
            continue
        available = (day_close - moment).total_seconds() / 3600
        if remaining <= available + 1e-9:
            return (moment + timedelta(hours=remaining)).replace(microsecond=0)
        remaining -= available
        moment = datetime.combine(day + timedelta(days=1), opening)
    raise ValueError("Échéance hors du calendrier : délai trop long.")


def target_hours(priority_hours, category_hours):
    """Délai retenu : le plus court du délai de la priorité et de celui de la catégorie (0 ou vide : sans
    délai propre)."""
    values = [float(h) for h in (priority_hours, category_hours) if h and float(h) > 0]
    return min(values) if values else None
