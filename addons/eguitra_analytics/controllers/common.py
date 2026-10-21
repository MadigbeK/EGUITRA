"""Paramètres communs des routes d'analyse : période et enveloppe des réponses (spécification,
chapitre 3)."""

from datetime import UTC, date, datetime

from dateutil.relativedelta import relativedelta

from odoo import fields
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError

GROUPE_READ = ("admin", "direction", "finance")
CABINET_READ = ("admin", "direction", "cabinet")
CABINET_ACTIVITY = ("admin", "direction", "cabinet", "finance")
PERIODS = {"ytd": "Exercice", "12m": "12 derniers mois", "q": "Trimestre", "m": "Mois", "custom": "Période"}


def _date(kw, name, default=None):
    value = kw.get(name)
    if value in (None, ""):
        return default
    try:
        return fields.Date.to_date(value)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"{name} : date attendue (AAAA-MM-JJ).") from e


def parse_period(kw, company=None):
    """Période demandée : {code, date_from, date_to, label, previous{date_from, date_to}}.

    ytd : début de l'exercice de la société jusqu'à date_to ; 12m : 12 mois glissants ; q et m :
    trimestre et mois de date_to ; custom : date_from imposée. La période précédente est la même
    période un an plus tôt (comparaison N-1)."""
    company = company or request.env.company
    date_to = _date(kw, "date_to", fields.Date.context_today(request.env.user))
    code = kw.get("period") or "ytd"
    if code not in PERIODS:
        raise ApiError(400, "invalid_parameter", "period : ytd, 12m, q, m ou custom.")
    if code == "ytd":
        date_from = request.env["eguitra.finance.metrics"].fiscal_year_bounds(company, date_to)[0]
    elif code == "12m":
        date_from = date_to - relativedelta(months=12) + relativedelta(days=1)
    elif code == "q":
        date_from = date(date_to.year, 3 * ((date_to.month - 1) // 3) + 1, 1)
    elif code == "m":
        date_from = date_to.replace(day=1)
    else:
        date_from = _date(kw, "date_from")
        if not date_from or date_from > date_to:
            raise ApiError(400, "invalid_parameter", "date_from (antérieure à date_to) obligatoire.")
    label = f"{PERIODS[code]} au {date_to:%d/%m/%Y}" if code != "custom" else \
        f"Du {date_from:%d/%m/%Y} au {date_to:%d/%m/%Y}"
    if code == "ytd":
        label = f"Exercice {date_from.year} au {date_to:%d/%m/%Y}"
    return {
        "code": code, "date_from": date_from, "date_to": date_to, "label": label,
        "previous": {"date_from": date_from - relativedelta(years=1), "date_to": date_to - relativedelta(years=1)},
    }


def envelope(entity, period, quality=None, insights=None, **blocks):
    """Réponse d'une section : société, période, horodatage, fiabilité, constats et blocs."""
    company = request.env.company
    result = {
        "entity": entity,
        "company": {"id": company.id, "name": company.name, "currency": company.currency_id.name},
        "period": period,
        "generated_at": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "quality": quality or {"score": None, "notes": []},
        "insights": insights or [],
    }
    result.update(blocks)
    return result
