"""Libre-service (« Mon espace ») : chaque salarié lié à un compte NIMOVA voit son dossier, son solde,
ses absences et ses bulletins validés, demande une absence, et tranche celles de ses collaborateurs
directs. Lecture en sudo, strictement bornée au dossier du compte connecté. Comptes internes seulement :
un compte du portail (porteur de projet) est refusé."""

from datetime import timedelta

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require

from ..engine import fmt_days
from .common import MANAGERS, date_value, int_or_false, internal_only, leave_row, leave_type_row, ref, today
from .paie import payslip_detail


def my_employee(required=True):
    """Dossier salarié du compte : celui de la société de travail, sinon le premier en cours."""
    employees = request.env.user._eguitra_employees()
    employee = employees.filtered(lambda e: e.company_id == request.env.company)[:1] or employees[:1]
    if required and not employee:
        raise ApiError(404, "not_found", "Aucun dossier salarié n'est lié à votre compte : voyez le service RH.")
    return employee


class EguitraRhMe(http.Controller):
    @api_route("/rh/me", profiles=None)
    def me(self, **_kw):
        internal_only()
        env = request.env
        user = env.user
        emp = my_employee(required=False)
        manages = bool(set(user._eguitra_profiles()) & MANAGERS)
        types = env["eguitra.rh.leave.type"].sudo().search([])
        if not emp:
            return {"employee": None, "balance": None, "leaves": [], "payslips": [], "team_pending": [],
                    "team_upcoming": [], "leave_types": [leave_type_row(t) for t in types], "manages_rh": manages}
        day = today()
        Leave = env["eguitra.rh.leave"].sudo()
        team = env["eguitra.rh.employee"].sudo().search([("manager_id", "=", emp.id)])
        slips = env["eguitra.rh.payslip"].sudo().search([("employee_id", "=", emp.id), ("payroll_id.state", "!=", "draft")],
                                                         limit=36)
        return {
            "employee": {
                "id": emp.id, "name": emp.name, "matricule": emp.matricule, "job_title": emp.job_title or None,
                "department": ref(emp.department_id), "manager": ref(emp.manager_id), "company": emp.company_id.name,
                "hire_date": emp.hire_date, "seniority_years": emp._seniority(day), "contract_type": emp.contract_type,
                "phone": emp.phone or None, "email": emp.email or None,
            },
            "balance": emp._leave_balance(day),
            "leaves": [leave_row(leave) for leave in Leave.search([("employee_id", "=", emp.id)], limit=50)],
            "payslips": [{"id": s.id, "month": s.month, "net": s.net} for s in slips],
            "leave_types": [leave_type_row(t) for t in types],
            "team_pending": [leave_row(leave) for leave in Leave.search(
                [("employee_id", "in", team.ids), ("state", "=", "submitted")], order="date_from")],
            "team_upcoming": [leave_row(leave) for leave in Leave.search(
                [("employee_id", "in", team.ids), ("state", "=", "approved"), ("date_to", ">=", day),
                 ("date_from", "<=", day + timedelta(days=14))], order="date_from")],
            "manages_rh": manages,
        }

    @api_route("/rh/me/leaves", methods=("POST",), profiles=None)
    def request_leave(self, **_kw):
        internal_only()
        emp = my_employee()
        data = read_json()
        require(data, "type_id", "date_from", "date_to")
        leave_type = request.env["eguitra.rh.leave.type"].sudo().browse(int_or_false(data, "type_id")).exists()
        if not leave_type or not leave_type.active:
            raise ApiError(422, "business_rule", "Type d'absence inconnu.")
        leave = request.env["eguitra.rh.leave"].sudo().create({
            "employee_id": emp.id, "type_id": leave_type.id, "date_from": date_value(data, "date_from"),
            "date_to": date_value(data, "date_to"), "half_day": bool(data.get("half_day")),
            "note": (data.get("note") or "").strip()[:1000] or False, "requested_by": request.env.user.id,
        })
        if leave_type.deducts_balance:
            balance = emp._leave_balance(leave.date_from)
            if balance["balance"] - balance["pending"] < 0:
                raise ApiError(422, "insufficient_balance",
                               f"Solde insuffisant : {fmt_days(balance['balance'])} jour(s) acquis, dont "
                               f"{fmt_days(balance['pending'] - leave.days)} déjà demandé(s).")
        return leave_row(leave)

    @api_route("/rh/me/leaves/<int:leave_id>/cancel", methods=("POST",), profiles=None)
    def cancel_my_leave(self, leave_id, **_kw):
        internal_only()
        emp = my_employee()
        leave = request.env["eguitra.rh.leave"].sudo().browse(leave_id).exists()
        if not leave or leave.employee_id != emp:
            raise ApiError(404, "not_found", "Absence introuvable.")
        if leave.state == "approved" and leave.date_from <= today():
            raise ApiError(422, "business_rule", "Une absence commencée ne s'annule que par le service RH.")
        leave.action_cancel()
        return leave_row(leave)

    @api_route("/rh/me/payslips/<int:payslip_id>", profiles=None)
    def my_payslip(self, payslip_id, **_kw):
        internal_only()
        employees = request.env.user._eguitra_employees()
        slip = request.env["eguitra.rh.payslip"].sudo().browse(payslip_id).exists()
        if not slip or slip.employee_id not in employees or slip.payroll_id.state == "draft":
            raise ApiError(404, "not_found", "Bulletin introuvable.")
        return payslip_detail(slip)
