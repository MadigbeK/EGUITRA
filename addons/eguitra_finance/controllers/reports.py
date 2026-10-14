"""Rapports financiers : catalogue, exécution, export CSV et XLSX."""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json

from ..models.report_registry import REPORTS, list_catalog
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


def _run(data, limit=None):
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
            limit=limit or data.get("limit", 200),
            offset=data.get("offset", 0),
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

    @api_route("/finance/reports/export", methods=("POST",), profiles=FIN_READ)
    def export(self, **_kw):
        data = read_json()
        result = _run(data, limit=5000)
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
