"""Tableau de bord du dirigeant, alertes, états SYSCOHADA et pilotage par axe analytique."""

from dateutil.relativedelta import relativedelta

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json

from .common import FIN_READ, companies, parse_date, today

PLANS = {
    "activite": "eguitra_base.analytic_plan_activite",
    "centre_cout": "eguitra_base.analytic_plan_centre_cout",
    "chantier": "eguitra_base.analytic_plan_chantier",
    "vehicule": "eguitra_base.analytic_plan_vehicule",
    "route": "eguitra_base.analytic_plan_route",
    "bien": "eguitra_base.analytic_plan_bien",
    "dossier": "eguitra_base.analytic_plan_dossier",
}


class EguitraFinanceDashboard(http.Controller):
    @api_route("/finance/dashboard", profiles=FIN_READ)
    def dashboard(self, **kw):
        day = parse_date(kw, "date", today())
        return request.env["eguitra.finance.metrics"].sudo().dashboard(companies(kw), day)

    @api_route("/finance/alerts", profiles=FIN_READ)
    def alerts(self, **kw):
        return request.env["eguitra.alert.threshold"].sudo().active_alerts(companies(kw), today())

    @api_route("/finance/statements/income", profiles=FIN_READ)
    def income_statement(self, **kw):
        end = parse_date(kw, "date_to", today())
        start = parse_date(kw, "date_from", end.replace(month=1, day=1))
        current = request.env["eguitra.syscohada"].sudo().income_statement(companies(kw), start, end)
        if kw.get("compare") == "previous_year":
            previous = request.env["eguitra.syscohada"].sudo().income_statement(
                companies(kw), start - relativedelta(years=1), end - relativedelta(years=1)
            )
            amounts = {line["code"]: line["amount"] for line in previous["lines"]}
            for line in current["lines"]:
                line["previous"] = amounts.get(line["code"], 0.0)
        return current

    @api_route("/finance/management-report", profiles=FIN_READ)
    def management_report(self, **kw):
        """Rapport mensuel de gestion ; month=AAAA-MM (mois en cours par défaut)."""
        day = today()
        if kw.get("month"):
            try:
                year, month = (int(x) for x in kw["month"].split("-"))
                day = day.replace(year=year, month=month, day=1)
            except ValueError as e:
                raise ApiError(400, "invalid_parameter", "Mois invalide (AAAA-MM).") from e
        return request.env["eguitra.finance.metrics"].sudo().management_report(companies(kw), day)

    @api_route("/finance/statements/cash-flow", profiles=FIN_READ)
    def cash_flow(self, **kw):
        end = parse_date(kw, "date_to", today())
        start = parse_date(kw, "date_from", end.replace(month=1, day=1))
        if start > end:
            raise ApiError(400, "invalid_parameter", "La période est inversée.")
        return request.env["eguitra.syscohada"].sudo().cash_flow(companies(kw), start, end)

    @api_route("/finance/statements/balance-sheet", profiles=FIN_READ)
    def balance_sheet(self, **kw):
        end = parse_date(kw, "date", today())
        return request.env["eguitra.syscohada"].sudo().balance_sheet(companies(kw), end)

    @api_route("/finance/analytics", profiles=FIN_READ)
    def analytics(self, **kw):
        plan_xmlid = PLANS.get(kw.get("plan", "activite"))
        if not plan_xmlid:
            raise ApiError(400, "invalid_parameter", "Axe analytique inconnu.")
        end = parse_date(kw, "date_to", today())
        start = parse_date(kw, "date_from", end.replace(month=1, day=1))
        plan = request.env.ref(plan_xmlid).sudo()
        rows = request.env["eguitra.finance.metrics"].sudo().by_analytic_plan(companies(kw), plan, start, end)
        return {"plan": plan.name, "date_from": start, "date_to": end, "rows": rows}

    @api_route("/finance/analytic-accounts", profiles=FIN_READ + ("exploitation", "chantiers", "immobilier"))
    def analytic_accounts(self, **kw):
        domain = [("company_id", "in", [False] + request.env.company.ids)]
        if kw.get("plan") in PLANS:
            domain.append(("plan_id", "=", request.env.ref(PLANS[kw["plan"]]).id))
        accounts = request.env["account.analytic.account"].search(domain, order="plan_id, code, name")
        return [
            {"id": a.id, "name": a.name, "code": a.code or None, "plan": a.plan_id.name, "active": a.active}
            for a in accounts
        ]


class EguitraFinanceThresholds(http.Controller):
    @api_route("/finance/thresholds", profiles=FIN_READ)
    def thresholds(self, **_kw):
        Threshold = request.env["eguitra.alert.threshold"]
        Threshold.sudo().ensure_defaults(request.env.company)
        labels = dict(Threshold._fields["code"].selection)
        return [
            {"id": t.id, "code": t.code, "label": labels.get(t.code, t.code), "value": t.value,
             "severity": t.severity, "active": t.active}
            for t in Threshold.with_context(active_test=False).search([("company_id", "=", request.env.company.id)])
        ]

    @api_route("/finance/thresholds/<int:threshold_id>", methods=("PATCH",), profiles=("admin",))
    def update_threshold(self, threshold_id, **_kw):
        threshold = request.env["eguitra.alert.threshold"].with_context(active_test=False).browse(threshold_id).exists()
        if not threshold or threshold.company_id != request.env.company:
            raise ApiError(404, "not_found", "Seuil introuvable.")
        data = read_json()
        values = {}
        if "value" in data:
            values["value"] = float(data["value"] or 0)
        if data.get("severity") in ("info", "warning", "blocking"):
            values["severity"] = data["severity"]
        if "active" in data:
            values["active"] = bool(data["active"])
        threshold.write(values)
        return {"status": "ok"}
