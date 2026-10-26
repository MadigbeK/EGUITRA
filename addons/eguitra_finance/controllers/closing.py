"""Clôtures mensuelles, contrôles d'intégrité, registre des clôtures, sceau et PV de clôture ; clôture de
l'exercice (état des douze mois, affectation du résultat, verrouillage définitif : models/year_close.py)."""

from dateutil.relativedelta import relativedelta

from odoo import http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require

from .common import FIN_READ, FIN_WRITE, as_float, move_summary, parse_date, require_free_accounts, today

# Profils de la réouverture d'un mois et du verrouillage définitif d'un exercice.
CLOSING_AUTHORITY = ("admin", "direction")
# Événements d'un mois au registre ; le verrouillage de l'exercice se lit dans l'état de l'exercice.
MONTH_ACTIONS = ("close", "reopen")


def _period(data):
    day = parse_date(data, "period")
    if not day:
        raise ApiError(400, "missing_fields", "Mois requis (AAAA-MM-01).", fields=["period"])
    return day.replace(day=1)


def _year(value):
    try:
        year = int(value)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "missing_fields", "Exercice requis (année AAAA).", fields=["year"]) from e
    if not 2000 <= year <= 2100:
        raise ApiError(400, "invalid_parameter", "Exercice invalide.")
    return year


def _allocation_lines(data):
    """Lignes de l'OD d'affectation reçues de l'écran : compte, montant, libellé et tiers facultatifs."""
    lines = data.get("lines")
    if not isinstance(lines, list) or not lines:
        raise ApiError(400, "missing_fields", "Au moins une ligne d'affectation est requise.", fields=["lines"])
    parsed = []
    for i, line in enumerate(lines, start=1):
        if not isinstance(line, dict) or not line.get("account_id"):
            raise ApiError(400, "missing_fields", f"Ligne {i} : compte requis.")
        parsed.append({
            "account_id": int_arg(line, "account_id"),
            "amount": as_float(line.get("amount"), "amount"),
            "name": str(line.get("name") or "").strip()[:500],
            "partner_id": int_arg(line, "partner_id"),
        })
    return parsed


def _row(close):
    return {
        "id": close.id,
        "period": close.period,
        "state": close.state,
        "closed_by": close.closed_by.name or None,
        "closed_at": close.closed_at,
        "last_check": close.last_check or None,
        "events": [
            {"action": e.action, "user": e.user_id.name, "date": e.date, "reason": e.reason or None,
             "seal": e.seal or None}
            for e in close.event_ids if e.action in MONTH_ACTIONS
        ],
        "seal": close.seal or None,
        "snapshot": close.snapshot or None,
        "generated": [
            {"id": m.id, "name": m.name, "ref": m.ref or None, "date": m.date, "kind": m.eguitra_close_kind,
             "amount": sum(m.line_ids.mapped("debit"))}
            for m in close.generated_move_ids.sorted("id")
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
                "generations": close._closing_preview() if close.state == "open" else [],
                "can_close": close.state == "open" and not any(c["status"] == "blocking" for c in checks)}

    @api_route("/finance/closing/close", methods=("POST",), profiles=FIN_WRITE)
    def close(self, **_kw):
        close = request.env["eguitra.period.close"]._get(request.env.company, _period(read_json()))
        close.action_close()
        return _row(close)

    @api_route("/finance/closing/reopen", methods=("POST",), profiles=CLOSING_AUTHORITY)
    def reopen(self, **_kw):
        data = read_json()
        (reason,) = require(data, "reason")
        close = request.env["eguitra.period.close"]._get(request.env.company, _period(data))
        close.action_reopen(reason)
        return _row(close)

    # ─── Clôture de l'exercice ────────────────────────────────────────────

    @api_route("/finance/closing/year", profiles=FIN_READ)
    def year_status(self, **kw):
        """État de l'exercice AAAA (year ; à défaut, l'exercice précédent) : douze mois, résultat,
        affectation, résultat antérieur restant à affecter, verrouillage définitif et ce qui lui manque."""
        company = request.env.company
        if kw.get("year") in (None, ""):
            start = request.env["eguitra.finance.metrics"].fiscal_year_bounds(company, today())[0]
            year = (start - relativedelta(days=1)).year
        else:
            year = _year(kw["year"])
        return request.env["eguitra.year.close"].status(company, year)

    @api_route("/finance/closing/year/allocation", methods=("POST",), profiles=FIN_WRITE)
    def year_allocation(self, **_kw):
        """OD d'affectation du résultat décidée par l'assemblée, créée en brouillon : elle suit ensuite le
        circuit de validation des OD (Journaux et OD, ou fiche de la pièce)."""
        require_free_accounts("OD d'affectation du résultat",
                              "Elle porte les comptes de réserves, de report à nouveau et de dividendes choisis")
        data = read_json()
        year = _year(data.get("year"))
        day = parse_date(data, "date")
        if not day:
            raise ApiError(400, "missing_fields", "Date de l'assemblée requise.", fields=["date"])
        Year = request.env["eguitra.year.close"]
        move = Year.create_allocation(request.env.company, year, day, _allocation_lines(data), data.get("note"))
        return dict(Year.status(request.env.company, year), created=move_summary(move))

    @api_route("/finance/closing/year/lock", methods=("POST",), profiles=CLOSING_AUTHORITY)
    def year_lock(self, **_kw):
        """Verrouillage définitif de l'exercice (irréversible) : les douze mois clôturés, aucune pièce en
        brouillon jusqu'au dernier jour de l'exercice."""
        year = _year(read_json().get("year"))
        return request.env["eguitra.year.close"].lock(request.env.company, year)

    @api_route("/finance/integrity", profiles=FIN_READ)
    def integrity(self, **_kw):
        """Contrôles permanents sur le mois écoulé et vérification des empreintes de chaînage : chaque
        écriture verrouillée est recalculée et comparée à son empreinte (calcul du noyau, que celui-ci
        réserve aux comptables : la direction voit les contrôles sans la vérification)."""
        day = today()
        close = request.env["eguitra.period.close"]._get(request.env.company, day.replace(day=1) - relativedelta(months=1))
        checks = close._run_controls()
        chains = None
        if request.env.user.has_group("account.group_account_user"):
            report = request.env.company._check_hash_integrity()
            chains = [{
                "journal": r["journal_name"], "status": r["status"], "message": r.get("msg_cover"),
                "first": r.get("first_move_name"), "last": r.get("last_move_name"), "last_date": r.get("last_move_date"),
            } for r in report["results"]]
        # Sceaux des mois clôturés depuis le début de l'exercice précédent, recalculés.
        sealed = request.env["eguitra.period.close"].search([
            ("company_id", "=", request.env.company.id), ("state", "=", "closed"), ("seal", "!=", False),
            ("period", ">=", day.replace(month=1, day=1) - relativedelta(years=1)),
        ], order="period")
        seals = [c.sudo().eguitra_verify_seal() for c in sealed]
        return {"period": close.period, "checks": checks, "hash_chains": chains, "seals": seals}

    @api_route("/finance/closing/pv", profiles=FIN_READ)
    def closing_pv(self, **kw):
        """PV de clôture du mois (PDF), avec le sceau de la période, à conserver hors du système."""
        close = request.env["eguitra.period.close"].search([
            ("company_id", "=", request.env.company.id), ("period", "=", _period(kw)), ("state", "=", "closed"),
        ], limit=1)
        if not close or not close.seal:
            raise ApiError(404, "not_found", "Aucune clôture scellée pour ce mois.")
        pdf, _type = request.env["ir.actions.report"].sudo()._render_qweb_pdf(
            "eguitra_finance.action_report_period_close", close.ids)
        return request.make_response(pdf, headers=[
            ("Content-Type", "application/pdf"),
            ("Content-Disposition", content_disposition(f"PV-cloture-{close.period:%Y-%m}.pdf")),
            ("Cache-Control", "no-store"),
        ])
