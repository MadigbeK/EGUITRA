"""Clôtures mensuelles, contrôles d'intégrité et registre des clôtures."""

from dateutil.relativedelta import relativedelta

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require

from .common import FIN_READ, FIN_WRITE, parse_date, today


def _period(data):
    day = parse_date(data, "period")
    if not day:
        raise ApiError(400, "missing_fields", "Mois requis (AAAA-MM-01).", fields=["period"])
    return day.replace(day=1)


def _row(close):
    return {
        "id": close.id,
        "period": close.period,
        "state": close.state,
        "closed_by": close.closed_by.name or None,
        "closed_at": close.closed_at,
        "last_check": close.last_check or None,
        "events": [
            {"action": e.action, "user": e.user_id.name, "date": e.date, "reason": e.reason or None}
            for e in close.event_ids
        ],
    }


class EguitraFinanceClosing(http.Controller):
    @api_route("/finance/closing", profiles=FIN_READ)
    def registry(self, **kw):
        year = int_arg(kw, "year", today().year)
        company = request.env.company
        Close = request.env["eguitra.period.close"]
        existing = {c.period: c for c in Close.search([("company_id", "=", company.id),
                                                       ("period", ">=", f"{year}-01-01"),
                                                       ("period", "<=", f"{year}-12-01")])}
        months = []
        for m in range(1, 13):
            first = today().replace(year=year, month=m, day=1)
            record = existing.get(first)
            months.append(_row(record) if record else {"id": None, "period": first, "state": "open", "events": []})
        return {"company": company.name, "year": year, "lock_date": company.fiscalyear_lock_date,
                "hard_lock_date": company.hard_lock_date, "months": months}

    @api_route("/finance/closing/check", methods=("POST",), profiles=FIN_READ)
    def check(self, **_kw):
        close = request.env["eguitra.period.close"]._get(request.env.company, _period(read_json()))
        checks = close.action_check()
        return {"period": close.period, "checks": checks,
                "can_close": close.state == "open" and not any(c["status"] == "blocking" for c in checks)}

    @api_route("/finance/closing/close", methods=("POST",), profiles=FIN_WRITE)
    def close(self, **_kw):
        close = request.env["eguitra.period.close"]._get(request.env.company, _period(read_json()))
        close.action_close()
        return _row(close)

    @api_route("/finance/closing/reopen", methods=("POST",), profiles=("admin", "direction"))
    def reopen(self, **_kw):
        data = read_json()
        (reason,) = require(data, "reason")
        close = request.env["eguitra.period.close"]._get(request.env.company, _period(data))
        close.action_reopen(reason)
        return _row(close)

    @api_route("/finance/integrity", profiles=FIN_READ)
    def integrity(self, **_kw):
        """Contrôles permanents sur le mois écoulé et vérification des empreintes de chaînage."""
        day = today()
        close = request.env["eguitra.period.close"]._get(request.env.company, day.replace(day=1) - relativedelta(months=1))
        checks = close._run_controls()
        hashes = []
        journals = request.env["account.journal"].sudo().search([
            ("company_id", "=", request.env.company.id), ("restrict_mode_hash_table", "=", True),
        ])
        for journal in journals:
            moves = request.env["account.move"].sudo().search(
                [("journal_id", "=", journal.id), ("inalterable_hash", "!=", False)], order="secure_sequence_number"
            )
            hashes.append({"journal": journal.name, "secured_moves": len(moves),
                           "last_secured": moves[-1:].date if moves else None})
        return {"period": close.period, "checks": checks, "hash_chains": hashes}
