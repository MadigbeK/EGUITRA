"""Tableau de bord du dirigeant, alertes, états SYSCOHADA et pilotage par axe analytique."""

from dateutil.relativedelta import relativedelta

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require

from ..models.alert import (
    ALERT_CODES,
    DOMAINS,
    SEVERITY_ORDER,
    THRESHOLD_UNITS,
    TRANSPORT_CODES,
    UNITS,
    ZERO_DISABLES,
)
from ..models.analytic import ACTIVITY_PLAN, MANAGED_AXES, PLANS, axes_for, plan_key
from .common import FIN_READ, FIN_WRITE, account_ref, companies, parse_date, ref, today
from .statements_export import income_with_month

# Profils qui choisissent un compte analytique à la saisie (chantiers, immobilier, parc).
ANALYTIC_PICKERS = FIN_READ + ("exploitation", "chantiers", "immobilier")
# Le profil Achats impute ses pièces sur les axes de la société (sélecteur par axe), sans autre lecture.
AXES_PICKERS = ANALYTIC_PICKERS + ("achats",)


def _analytic_row(account, company):
    return {
        "id": account.id,
        "name": account.name,
        "code": account.code or None,
        "plan": account.plan_id.name,
        "axis": plan_key(request.env, account.root_plan_id),
        "active": account.active,
        "company": ref(account.company_id),
        "activity": ref(account.eguitra_activity_id),
        "income_account": account_ref(account.eguitra_income_account_id.with_company(company)),
    }


def _managed_account(account_id):
    """Compte d'un axe tenu par la finance (activité, centre de coût), dans la société de travail."""
    company = request.env.company
    account = request.env["account.analytic.account"].sudo().with_context(active_test=False).browse(account_id).exists()
    if not account or (account.company_id and account.company_id != company):
        raise ApiError(404, "not_found", "Compte analytique introuvable dans la société de travail.")
    account = account.sudo(False)
    if plan_key(request.env, account.root_plan_id) not in MANAGED_AXES:
        raise ApiError(422, "business_rule", "Cet axe est tenu par son module (chantier, ensemble routier, route, bien "
                                             "ou dossier) : modifiez la fiche d'origine.")
    return account


def _analytic_values(data, plan, company, current=None):
    """Champs modifiables d'un compte d'activité ou de centre de coût."""
    Analytic = request.env["account.analytic.account"].with_context(active_test=False)
    values = {}
    if "name" in data:
        name = (data.get("name") or "").strip()
        if not name:
            raise ApiError(400, "missing_fields", "Libellé requis.", fields=["name"])
        duplicate = Analytic.search_count([("plan_id", "=", plan.id), ("name", "=ilike", name),
                                           ("company_id", "in", [False, company.id]),
                                           ("id", "!=", current.id if current else 0)])
        if duplicate:
            raise ApiError(409, "conflict", f"« {name} » existe déjà sur l'axe {plan.name}.")
        values["name"] = name[:120]
    if "code" in data:
        values["code"] = (str(data.get("code") or "").strip().upper()[:20]) or False
    if "active" in data:
        values["active"] = bool(data["active"])
    activity_plan = request.env.ref(ACTIVITY_PLAN)
    if "income_account_id" in data:
        if plan != activity_plan and data["income_account_id"]:
            raise ApiError(422, "business_rule", "Seule une activité porte un compte de produit.")
        income = request.env["account.account"]
        if data["income_account_id"]:
            income = income.browse(int(data["income_account_id"])).exists()
            if not income or company not in income.company_ids or not (income.code or "").startswith("7"):
                raise ApiError(422, "business_rule", "Choisissez un compte de produit (classe 7) de la société.")
        values["eguitra_income_account_id"] = income.id or False
    if "activity_id" in data:
        if plan == activity_plan and data["activity_id"]:
            raise ApiError(422, "business_rule", "Une activité ne se rattache pas à une autre activité.")
        parent = Analytic
        if data["activity_id"]:
            parent = Analytic.browse(int(data["activity_id"])).exists()
            if not parent or parent.plan_id != activity_plan or (parent.company_id and parent.company_id != company):
                raise ApiError(422, "business_rule", "Activité de rattachement inconnue dans la société.")
        values["eguitra_activity_id"] = parent.id or False
    return values


class EguitraFinanceDashboard(http.Controller):
    @api_route("/finance/dashboard", profiles=FIN_READ)
    def dashboard(self, **kw):
        day = parse_date(kw, "date", today())
        return request.env["eguitra.finance.metrics"].sudo().dashboard(companies(kw), day)

    @api_route("/finance/alerts", profiles=FIN_READ)
    def alerts(self, **kw):
        """Alertes actives ; all=1 ajoute les règles conformes et sans objet."""
        return request.env["eguitra.alert.threshold"].sudo().active_alerts(
            companies(kw), today(), include_ok=kw.get("all") in ("1", "true")
        )

    @api_route("/finance/statements/income", profiles=FIN_READ)
    def income_statement(self, **kw):
        end = parse_date(kw, "date_to", today())
        start = parse_date(kw, "date_from", end.replace(month=1, day=1))
        # Colonnes « Mois » (mois de la date d'arrêté) et « % du CA » en plus de l'exercice.
        current = income_with_month(companies(kw), start, end)
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

    @api_route("/finance/statements/consolidated", profiles=FIN_READ)
    def consolidated(self, **kw):
        """Vue consolidée du groupe : par société, éliminations intra-groupe, groupe (attente 2 du
        courrier du responsable financier)."""
        scope = request.env.user.company_ids.sorted("id")
        end = parse_date(kw, "date_to", today())
        start = parse_date(kw, "date_from", end.replace(month=1, day=1))
        return request.env["eguitra.syscohada"].sudo().consolidated(scope, start, end)

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

    @api_route("/finance/analytic-axes", profiles=AXES_PICKERS)
    def analytic_axes(self, **kw):
        """Axes proposés dans la société de travail, avec leurs comptes (actifs, sauf all=1) : la saisie
        affiche un sélecteur par axe ; activité et centre de coût sont tenus par la finance."""
        company = request.env.company
        Analytic = request.env["account.analytic.account"].with_context(active_test=kw.get("all") != "1")
        result = []
        for axis in axes_for(request.env, company):
            accounts = Analytic.search([("plan_id", "child_of", axis["plan"].id),
                                        ("company_id", "in", [False, company.id])], order="code, name")
            result.append({
                "key": axis["key"],
                "label": axis["plan"].name,
                "plan_id": axis["plan"].id,
                "managed": axis["managed"],
                "accounts": [
                    {"id": a.id, "name": a.name, "code": a.code or None, "active": a.active,
                     "activity_id": a.eguitra_activity_id.id or None,
                     "income_account_id": a.eguitra_income_account_id.id or None}
                    for a in accounts
                ],
            })
        return result

    @api_route("/finance/analytic-accounts", profiles=ANALYTIC_PICKERS)
    def analytic_accounts(self, **kw):
        company = request.env.company
        domain = [("company_id", "in", [False] + company.ids)]
        if kw.get("plan") in PLANS:
            domain.append(("plan_id", "child_of", request.env.ref(PLANS[kw["plan"]]).id))
        if kw.get("search"):
            domain += ["|", ("name", "ilike", kw["search"]), ("code", "ilike", kw["search"])]
        Analytic = request.env["account.analytic.account"].with_context(active_test=kw.get("active") != "all")
        accounts = Analytic.search(domain, order="plan_id, code, name", limit=int_arg(kw, "limit", 2000, 1, 5000))
        return [_analytic_row(a, company) for a in accounts]

    @api_route("/finance/analytic-accounts", methods=("POST",), profiles=FIN_WRITE)
    def create_analytic_account(self, **_kw):
        """Nouvelle activité ou nouveau centre de coût de la société de travail."""
        data = read_json()
        (axis,) = require(data, "plan")
        if axis not in MANAGED_AXES:
            raise ApiError(422, "business_rule", "Seuls l'activité et le centre de coût se créent ici ; les axes "
                                                 "métier naissent avec leur chantier, véhicule, route, bien ou dossier.")
        require(data, "name")
        company = request.env.company
        plan = request.env.ref(PLANS[axis])
        values = _analytic_values(data, plan, company)
        values.update({"plan_id": plan.id, "company_id": company.id})
        account = request.env["account.analytic.account"].create(values)
        return _analytic_row(account, company)

    @api_route("/finance/analytic-accounts/<int:account_id>", methods=("PATCH",), profiles=FIN_WRITE)
    def update_analytic_account(self, account_id, **_kw):
        """Renommer, recoder, archiver ou réactiver une activité ou un centre de coût ; compte de
        produit d'une activité, activité de rattachement d'un centre de coût."""
        account = _managed_account(account_id)
        company = request.env.company
        values = _analytic_values(read_json(), account.plan_id, company, current=account)
        if values:
            account.write(values)
        return _analytic_row(account, company)


class EguitraFinanceThresholds(http.Controller):
    @api_route("/finance/thresholds", profiles=FIN_READ)
    def thresholds(self, **_kw):
        Threshold = request.env["eguitra.alert.threshold"]
        Threshold.sudo().ensure_defaults(request.env.company)
        labels = dict(Threshold._fields["code"].selection)
        order = {code: i for i, (code, _label) in enumerate(ALERT_CODES)}
        transport = request.env.company.eguitra_entity != "cabinet"
        records = Threshold.with_context(active_test=False).search([("company_id", "=", request.env.company.id)])
        return [
            {"id": t.id, "code": t.code, "label": labels.get(t.code, t.code), "value": t.value,
             "severity": t.severity, "active": t.active, "domain": DOMAINS.get(t.code),
             "unit": THRESHOLD_UNITS.get(t.code, UNITS.get(t.code)),
             # 0 éteint la règle (seuil à renseigner) ; sinon 0 vaut « aucune tolérance ».
             "zero_disables": t.code in ZERO_DISABLES,
             "applicable": transport or t.code not in TRANSPORT_CODES}
            for t in records.sorted(lambda r: order.get(r.code, 99))
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
        if data.get("severity") in SEVERITY_ORDER:
            values["severity"] = data["severity"]
        if "active" in data:
            values["active"] = bool(data["active"])
        threshold.write(values)
        return {"status": "ok"}
