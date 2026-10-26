"""Rapports financiers : catalogue, exécution, export CSV et XLSX."""

import json

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json

from ..models.report_registry import MAX_EXPORT, MAX_LIMIT, REPORTS, list_catalog
from .common import FIN_READ, companies, parse_date, today

PERIODS = ("today", "month", "last_month", "quarter", "year", "12m", "all")


def _period(token, day):
    from dateutil.relativedelta import relativedelta

    if token in (None, "", "all"):
        return None, None
    if token == "today":
        return day, day
    if token == "month":
        return day.replace(day=1), day
    if token == "last_month":
        first = day.replace(day=1)
        return first - relativedelta(months=1), first - relativedelta(days=1)
    if token == "quarter":
        return day.replace(month=3 * ((day.month - 1) // 3) + 1, day=1), day
    if token == "year":
        return day.replace(month=1, day=1), day
    if token == "12m":
        return day - relativedelta(years=1), day
    raise ApiError(400, "invalid_parameter", "Période inconnue.")


def _query(kw):
    """Paramètres d'un export demandé en GET (lien de téléchargement du client commun, avec l'application et
    la société de l'écran) : mêmes clés que le corps JSON ; filters en JSON, columns séparées par des virgules."""
    data = {k: kw[k] for k in ("report", "format", "date_from", "date_to", "period", "scope", "sort", "sort_dir")
            if kw.get(k) not in (None, "")}
    if kw.get("filters"):
        try:
            filters = json.loads(kw["filters"])
        except ValueError as e:
            raise ApiError(400, "invalid_parameter", "Filtres invalides.") from e
        if not isinstance(filters, dict):
            raise ApiError(400, "invalid_parameter", "Filtres invalides.")
        data["filters"] = filters
    if kw.get("columns"):
        data["columns"] = [c for c in kw["columns"].split(",") if c]
    return data


def _count(value, name, default):
    """Nombre de lignes ou rang demandé : un entier, sinon refus (400) au lieu d'un message technique."""
    if value in (None, ""):
        return default
    try:
        return max(0, int(value))
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"Paramètre {name} invalide.") from e


def _run(data, limit=None, max_limit=MAX_LIMIT):
    key = data.get("report")
    if key not in REPORTS:
        raise ApiError(404, "not_found", "Rapport inconnu.")
    if data.get("date_from") or data.get("date_to"):
        start, end = parse_date(data, "date_from"), parse_date(data, "date_to")
    else:
        start, end = _period(data.get("period", "month"), today())
    try:
        return request.env["eguitra.report.engine"].run(
            key,
            companies(data),
            date_from=start,
            date_to=end,
            columns=data.get("columns"),
            filters=data.get("filters") or {},
            sort=data.get("sort"),
            sort_dir=data.get("sort_dir", "desc"),
            limit=limit or _count(data.get("limit"), "limit", 200) or 200,
            offset=_count(data.get("offset"), "offset", 0),
            max_limit=max_limit,
        )
    except ValueError as e:
        raise ApiError(400, "invalid_parameter", str(e)) from e


class EguitraFinanceReports(http.Controller):
    @api_route("/finance/reports/catalog", profiles=FIN_READ)
    def catalog(self, **_kw):
        return {"groups": list_catalog(), "periods": PERIODS}

    @api_route("/finance/reports/run", methods=("POST",), profiles=FIN_READ)
    def run(self, **_kw):
        return _run(read_json())

    @api_route("/finance/reports/export", methods=("GET", "POST"), profiles=FIN_READ)
    def export(self, **kw):
        """Export CSV ou XLSX d'un rapport : en GET (paramètres dans l'adresse, téléchargement du client
        commun) ou en POST (corps JSON)."""
        data = read_json() if request.httprequest.method == "POST" else _query(kw)
        result = _run(data, limit=MAX_EXPORT, max_limit=MAX_EXPORT)
        engine = request.env["eguitra.report.engine"]
        stamp = today().isoformat()
        if data.get("format") == "xlsx":
            content = engine.to_xlsx(result, result["label"])
            mime, ext = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
        else:
            content = engine.to_csv(result)
            mime, ext = "text/csv; charset=utf-8", "csv"
        return request.make_response(content, headers=[
            ("Content-Type", mime),
            ("Content-Disposition", f'attachment; filename="{result["report"]}_{stamp}.{ext}"'),
            ("Cache-Control", "no-store"),
        ])
