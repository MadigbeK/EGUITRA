"""Tableau de bord du dirigeant, alertes, états SYSCOHADA et pilotage par axe analytique."""

from dateutil.relativedelta import relativedelta

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route

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
