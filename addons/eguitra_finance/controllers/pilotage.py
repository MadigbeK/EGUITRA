"""Pilotage financier : flux mensuels de trésorerie et prévision, besoin en fonds de roulement,
balance âgée par tiers, questions du dirigeant, en-tête de l'application (équilibre de l'exercice
et pastilles de la navigation)."""

from dateutil.relativedelta import relativedelta

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg

from .common import FIN_READ, companies, parse_date, today


class EguitraFinancePilotage(http.Controller):
    @api_route("/finance/cash/monthly", profiles=FIN_READ)
    def cash_monthly(self, **kw):
        """Flux mensuels de trésorerie de l'exercice (year=AAAA, exercice en cours par défaut) et,
        pour l'exercice en cours, prévision de fin de mois et des trois mois suivants."""
        day = today()
        year = int_arg(kw, "year", None, 2000, 2100)
        metrics = request.env["eguitra.finance.metrics"].sudo()
        comps = companies(kw)
        data = metrics.monthly_cash(comps, day, year=year)
        fy = data["fiscal_year"]
        data["forecast"] = metrics.cash_forecast(comps, day) if fy["start"] <= day <= fy["end"] else None
        data["companies"] = [{"id": c.id, "name": c.name} for c in comps]
        return data

    @api_route("/finance/working-capital", profiles=FIN_READ)
    def working_capital(self, **kw):
        """BFR, DSO, DPO, DIO, cycle, part échue, concentration ; période : début de l'exercice à la date."""
        metrics = request.env["eguitra.finance.metrics"].sudo()
        comps = companies(kw)
        end = parse_date(kw, "date_to", today())
        start = parse_date(kw, "date_from", metrics.fiscal_year_bounds(comps[:1], end)[0])
        if start > end:
            raise ApiError(400, "invalid_parameter", "La période est inversée.")
        return metrics.working_capital(comps, start, end)

    @api_route("/finance/partners/aging", profiles=FIN_READ)
    def partners_aging(self, **kw):
        """Balance âgée par tiers (kind=customer ou supplier) : encours, échu, retard maximal, statut,
        et ancienneté par tranche avec le nombre de pièces."""
        kind = kw.get("kind", "customer")
        if kind not in ("customer", "supplier"):
            raise ApiError(400, "invalid_parameter", "Nature de tiers inconnue (customer ou supplier).")
        account_type = "asset_receivable" if kind == "customer" else "liability_payable"
        metrics = request.env["eguitra.finance.metrics"].sudo()
        comps = companies(kw)
        day = parse_date(kw, "date", today())
        items = metrics.open_items(comps, account_type, day)
        return {"kind": kind, "as_of": day, "total": items["total"], "overdue": items["overdue"],
                "documents": items["documents"], "aging": items["aging"], "aging_count": items["aging_count"],
                "partners": metrics.partner_aging(comps, account_type, day)}

    @api_route("/finance/dashboard/questions", profiles=FIN_READ)
    def questions(self, **kw):
        """Les onze questions du dirigeant et ce qui demande une décision, arrêtés à la date."""
        data = request.env["eguitra.finance.metrics"].sudo().dashboard(companies(kw), parse_date(kw, "date", today()))
        return {"as_of": data["as_of"], "questions": data["questions"], "decisions": data["decisions"]}

    @api_route("/finance/shell", profiles=FIN_READ)
    def shell(self, **_kw):
        """En-tête de l'application pour la société de travail : total des débits et des crédits de
        l'exercice et leur équilibre ; pastilles de la navigation (alertes, validations qui attendent
        l'utilisateur, contrôles du mois écoulé en anomalie)."""
        env = request.env
        company = env.company
        day = today()
        metrics = env["eguitra.finance.metrics"].sudo()
        fy_start, fy_end = metrics.fiscal_year_bounds(company, day)
        ledger = metrics.ledger_totals(company, fy_start, day)
        alerts = env["eguitra.alert.threshold"].sudo().active_alerts(company, day)
        approvals = 0
        if "eguitra.approval.request" in env:
            user = env.user
            pending = env["eguitra.approval.request"].sudo().search([
                ("state", "=", "pending"), ("company_id", "in", user.company_ids.ids),
                ("pending_profile", "in", user._eguitra_profiles()), ("requested_by", "!=", user.id),
            ])
            # Même critère que la corbeille : sans les demandes dont le compte a déjà tranché une étape.
            approvals = len(pending.filtered(lambda r: r._can_decide(user)))
        close = env["eguitra.period.close"]._get(company, day.replace(day=1) - relativedelta(months=1))
        checks = [c for c in close._run_controls() if c["status"] != "ok"]
        return {
            "company": company.name,
            "fiscal_year": {"start": fy_start, "end": fy_end},
            "debit": ledger["debit"],
            "credit": ledger["credit"],
            "difference": ledger["difference"],
            "balanced": ledger["balanced"],
            "badges": {
                "alerts": len(alerts),
                "alerts_severe": sum(1 for a in alerts if a["severity"] in ("blocking", "critical")),
                "approvals": approvals,
                "controls": len(checks),
                "controls_blocking": sum(1 for c in checks if c["status"] == "blocking"),
            },
        }
