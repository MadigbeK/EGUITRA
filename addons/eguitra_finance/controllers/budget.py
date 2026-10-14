"""Budget : lignes mensuelles par compte (mis_builder_budget) et comparaison au réalisé."""

from dateutil.relativedelta import relativedelta

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require

from ..models.finance_metrics import ACC_CODE
from .common import FIN_READ, FIN_WRITE, as_float, today


def _budget(budget_id):
    budget = request.env["mis.budget.by.account"].browse(budget_id).exists()
    if not budget:
        raise ApiError(404, "not_found", "Budget introuvable.")
    return budget


class EguitraFinanceBudget(http.Controller):
    @api_route("/finance/budgets", profiles=FIN_READ)
    def list_budgets(self, **_kw):
        budgets = request.env["mis.budget.by.account"].search(
            [("company_id", "in", [False, request.env.company.id])], order="date_from desc"
        )
        return [{"id": b.id, "name": b.name, "date_from": b.date_from, "date_to": b.date_to, "state": b.state,
                 "lines": len(b.item_ids)} for b in budgets]

    @api_route("/finance/budgets", methods=("POST",), profiles=FIN_WRITE)
    def create_budget(self, **_kw):
        data = read_json()
        name, year = require(data, "name", "year")
        year = int(year)
        budget = request.env["mis.budget.by.account"].create({
            "name": name,
            "date_from": f"{year}-01-01",
            "date_to": f"{year}-12-31",
            "company_id": request.env.company.id,
        })
        return {"id": budget.id, "name": budget.name}

    @api_route("/finance/budgets/<int:budget_id>/lines", profiles=FIN_READ)
    def lines(self, budget_id, **_kw):
        budget = _budget(budget_id)
        rows = {}
        for item in budget.item_ids:
            key = item.account_id.id
            row = rows.setdefault(key, {"account_id": key, "code": item.account_id.code, "name": item.account_id.name,
                                        "months": {m: 0.0 for m in range(1, 13)}})
            sign = -1 if item.account_id.code.startswith("7") else 1
            row["months"][item.date_from.month] += sign * item.balance
        result = sorted(rows.values(), key=lambda r: r["code"])
        for row in result:
            row["total"] = sum(row["months"].values())
        return {"budget": {"id": budget.id, "name": budget.name, "year": budget.date_from.year}, "lines": result}

    @api_route("/finance/budgets/<int:budget_id>/lines", methods=("POST",), profiles=FIN_WRITE)
    def set_line(self, budget_id, **_kw):
        """Montant budgété d'un compte pour un mois (charges au débit, produits au crédit)."""
        budget = _budget(budget_id)
        data = read_json()
        account_id, month, amount = require(data, "account_id", "month", "amount")
        account = request.env["account.account"].browse(int(account_id)).exists()
        if not account:
            raise ApiError(404, "not_found", "Compte introuvable.")
        month = int(month)
        if not 1 <= month <= 12:
            raise ApiError(400, "invalid_parameter", "Mois invalide.")
        amount = as_float(amount, "amount")
        start = budget.date_from.replace(month=month, day=1)
        end = start + relativedelta(months=1, days=-1)
        Item = request.env["mis.budget.by.account.item"]
        item = Item.search([("budget_id", "=", budget.id), ("account_id", "=", account.id),
                            ("date_from", "=", start)], limit=1)
        income = account.code.startswith("7")
        values = {"debit": 0.0 if income else max(amount, 0.0), "credit": max(amount, 0.0) if income else 0.0}
        if item:
            item.write(values)
        else:
            Item.create(dict(values, budget_id=budget.id, account_id=account.id, date_from=start, date_to=end,
                             name=account.name, company_id=request.env.company.id))
        return {"status": "ok"}

    @api_route("/finance/budgets/<int:budget_id>/compare", profiles=FIN_READ)
    def compare(self, budget_id, **kw):
        """Budget et réalisé cumulés à fin de mois, par compte, avec l'écart et son taux."""
        budget = _budget(budget_id)
        month = int_arg(kw, "month", today().month if today().year == budget.date_from.year else 12, 1, 12)
        start = budget.date_from
        end = start.replace(month=month, day=1) + relativedelta(months=1, days=-1)
        planned = {}
        for item in budget.item_ids.filtered(lambda i: i.date_from <= end):
            planned[item.account_id.id] = planned.get(item.account_id.id, 0.0) + item.balance
        request.env.flush_all()
        cr = request.env.cr
        cr.execute(
            f"""SELECT aml.account_id, {ACC_CODE}, COALESCE(SUM(aml.balance), 0)
                  FROM account_move_line aml JOIN account_account aa ON aa.id = aml.account_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aml.date BETWEEN %s AND %s
                   AND {ACC_CODE} ~ '^[67]'
              GROUP BY 1, 2""",
            (request.env.company.id, start, end),
        )
        actual = {acc: (code, float(b)) for acc, code, b in cr.fetchall()}
        threshold = request.env["eguitra.alert.threshold"].sudo().search([
            ("company_id", "=", request.env.company.id), ("code", "=", "budget_overrun_pct"),
        ], limit=1).value or 10.0
        accounts = request.env["account.account"].browse(list(set(planned) | set(actual)))
        rows = []
        for account in accounts.sorted("code"):
            sign = -1 if account.code.startswith("7") else 1
            plan = sign * planned.get(account.id, 0.0)
            real = sign * actual.get(account.id, (None, 0.0))[1]
            gap = real - plan
            rate = (gap / plan * 100) if plan else None
            overrun = rate is not None and (rate > threshold if sign == 1 else rate < -threshold)
            rows.append({"account_id": account.id, "code": account.code, "name": account.name,
                         "kind": "produit" if sign == -1 else "charge", "budget": plan, "actual": real,
                         "gap": gap, "gap_pct": rate, "alert": overrun})
        return {"budget": budget.name, "through": end, "threshold_pct": threshold, "lines": rows}
