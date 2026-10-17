"""Dette et financement : emprunts, crédits-bails, échéanciers, règlements, DSCR."""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require

from .common import FIN_READ, FIN_WRITE, as_float, companies, parse_date, today

FIELDS = ("name", "purpose", "kind", "periodicity", "method")


def _loan(loan_id):
    loan = request.env["eguitra.loan"].browse(loan_id).exists()
    if not loan:
        raise ApiError(404, "not_found", "Financement introuvable.")
    return loan


def _row(loan, lines=False):
    data = {
        "id": loan.id,
        "name": loan.name,
        "kind": loan.kind,
        "lender": {"id": loan.partner_id.id, "name": loan.partner_id.name},
        "purpose": loan.purpose or None,
        "principal": loan.principal,
        "annual_rate": loan.annual_rate,
        "start_date": loan.start_date,
        "duration_months": loan.duration_months,
        "grace_months": loan.grace_months,
        "periodicity": loan.periodicity,
        "method": loan.method,
        "state": loan.state,
        "outstanding": loan.outstanding,
        "principal_account": loan.principal_account_id.code or None,
        "interest_account": loan.interest_account_id.code or None,
        "journal": loan.journal_id.name or None,
    }
    if lines:
        data["schedule"] = [
            {"id": l.id, "sequence": l.sequence, "due_date": l.due_date, "principal": l.principal,
             "interest": l.interest, "total": l.total, "remaining": l.remaining, "paid": l.paid,
             "move_id": l.move_id.id or None, "statement_line_id": l.statement_line_id.id or None}
            for l in loan.line_ids
        ]
    return data


class EguitraFinanceLoans(http.Controller):
    @api_route("/finance/loans", profiles=FIN_READ)
    def list_loans(self, **kw):
        loans = request.env["eguitra.loan"].search([("company_id", "in", companies(kw).ids)])
        # Échéanciers et comptabilité : encours comptable, écart, dette nette, gearing, dette / EBE.
        summary = request.env["eguitra.finance.metrics"].sudo().debt_position(companies(kw), today())
        return {"items": [_row(l) for l in loans], "summary": summary}

    @api_route("/finance/loans/<int:loan_id>", profiles=FIN_READ)
    def get_loan(self, loan_id, **_kw):
        return _row(_loan(loan_id), lines=True)

    @api_route("/finance/loans", methods=("POST",), profiles=FIN_WRITE)
    def create_loan(self, **_kw):
        data = read_json()
        name, partner_id, principal, start, duration = require(
            data, "name", "partner_id", "principal", "start_date", "duration_months"
        )
        values = {k: data[k] for k in FIELDS if data.get(k)}
        values.update({
            "partner_id": int(partner_id),
            "principal": as_float(principal, "principal"),
            "annual_rate": as_float(data.get("annual_rate", 0), "annual_rate"),
            "start_date": parse_date(data, "start_date"),
            "duration_months": int(duration),
            "grace_months": int(data.get("grace_months") or 0),
            "company_id": request.env.company.id,
        })
        if data.get("first_due_date"):
            values["first_due_date"] = parse_date(data, "first_due_date")
        for key in ("principal_account_id", "interest_account_id", "journal_id"):
            if data.get(key):
                values[key] = int(data[key])
        loan = request.env["eguitra.loan"].create(values)
        loan.compute_schedule()
        if data.get("activate"):
            loan.action_activate()
        return _row(loan, lines=True)

    @api_route("/finance/loans/<int:loan_id>", methods=("PATCH",), profiles=FIN_WRITE)
    def update_loan(self, loan_id, **_kw):
        """Référence et objet d'un financement (l'échéancier ne se modifie qu'en brouillon)."""
        loan = _loan(loan_id)
        data = read_json()
        values = {k: (data[k] or False) for k in ("name", "purpose") if k in data}
        if "name" in values and not values["name"]:
            raise ApiError(400, "missing_fields", "La référence est obligatoire.", fields=["name"])
        loan.write(values)
        return _row(loan, lines=True)

    @api_route("/finance/loans/<int:loan_id>/activate", methods=("POST",), profiles=FIN_WRITE)
    def activate(self, loan_id, **_kw):
        loan = _loan(loan_id)
        loan.action_activate()
        return _row(loan, lines=True)

    @api_route("/finance/loans/lines/<int:line_id>/pay", methods=("POST",), profiles=FIN_WRITE)
    def pay(self, line_id, **_kw):
        line = request.env["eguitra.loan.line"].browse(line_id).exists()
        if not line:
            raise ApiError(404, "not_found", "Échéance introuvable.")
        line.action_pay(parse_date(read_json(), "date"))
        return _row(line.loan_id, lines=True)
