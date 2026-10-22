"""Briques communes de l'API RH : profils, accès aux enregistrements, sérialisation (contrat :
apps/web/lib/rh-types.ts)."""

from odoo import fields
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError

READ = ("admin", "direction", "rh")
WRITE = ("admin", "rh")
MANAGERS = {"admin", "direction", "rh"}


def today():
    return fields.Date.context_today(request.env.user)


def scope(kw=None):
    """Sociétés gérées : toutes celles du compte (gestion RH commune aux deux sociétés, comme la
    finance), ou celle du filtre company_id."""
    companies = request.env.companies
    wanted = (kw or {}).get("company_id")
    if wanted not in (None, "", "all"):
        try:
            wanted = int(wanted)
        except (TypeError, ValueError) as e:
            raise ApiError(400, "invalid_parameter", "Société invalide.") from e
        if wanted not in companies.ids:
            raise ApiError(403, "company_forbidden", "Société non autorisée.")
        return companies.browse(wanted)
    return companies


def company_ref(company):
    return {"id": company.id, "name": company.name, "entity": company.eguitra_entity or None} if company else None


def get(model, record_id, label):
    """Enregistrement d'une des sociétés du compte (sinon 404, sans révéler son existence)."""
    probe = request.env[model].sudo().browse(record_id).exists()
    if not probe or ("company_id" in probe._fields and probe.company_id and probe.company_id not in request.env.companies):
        raise ApiError(404, "not_found", f"{label} introuvable.")
    return request.env[model].browse(probe.id)


def ref(record):
    return {"id": record.id, "name": record.display_name} if record else None


def emp_ref(emp):
    return {"id": emp.id, "name": emp.name, "matricule": emp.matricule} if emp else None


def can_write():
    return bool(set(WRITE) & set(request.env.user._eguitra_profiles()))


def text(data, key):
    """Texte libre nettoyé (une ligne), None si vide."""
    value = data.get(key)
    if value in (None, ""):
        return False
    return " ".join(str(value).split())[:500] or False


def number(data, key, default=0.0):
    value = data.get(key)
    if value in (None, ""):
        return default
    try:
        return float(value)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"Nombre invalide : {key}.") from e


def date_value(data, key):
    value = data.get(key)
    if value in (None, ""):
        return False
    try:
        return fields.Date.to_date(value)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"Date invalide : {key}.") from e


def int_or_false(data, key):
    value = data.get(key)
    if value in (None, "", 0):
        return False
    try:
        return int(value)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"Identifiant invalide : {key}.") from e


def rubric_row(r):
    return {"id": r.id, "code": r.code, "name": r.name, "kind": r.kind, "input": r.input,
            "overtime_rate": r.overtime_rate, "cnss": r.cnss, "taxable": r.taxable,
            "exempt_allowance": r.exempt_allowance, "account_code": r.account_code or "", "system": r.system,
            "active": r.active}


def leave_type_row(t):
    return {"id": t.id, "code": t.code, "name": t.name, "paid": t.paid, "deducts_balance": t.deducts_balance,
            "needs_document": t.needs_document, "max_days": t.max_days, "active": t.active}


def department_row(d):
    # Effectif dans les sociétés du compte seulement (un département commun compte aussi l'autre société).
    headcount = request.env["eguitra.rh.employee"].search_count([
        ("department_id", "=", d.id), ("company_id", "in", request.env.companies.ids),
        "|", ("exit_date", "=", False), ("exit_date", ">=", today())])
    return {"id": d.id, "name": d.name, "company": company_ref(d.company_id), "manager": ref(d.manager_id),
            "headcount": headcount, "active": d.active}


def can_decide(leave, user=None):
    """RH, direction ou administration de la société, ou responsable hiérarchique du salarié ; jamais sa
    propre demande, sauf pour la direction et l'administration."""
    user = user or request.env.user
    profiles = set(user._eguitra_profiles())
    own = leave.employee_id.user_id == user
    if own and not profiles & {"admin", "direction"}:
        return False
    if profiles & MANAGERS and leave.company_id in user.company_ids:
        return True
    return bool(leave.employee_id.manager_id.user_id) and leave.employee_id.manager_id.user_id == user


def leave_row(leave):
    leave = leave.sudo()
    return {
        "id": leave.id, "name": leave.name, "employee": emp_ref(leave.employee_id),
        "type": {"id": leave.type_id.id, "name": leave.type_id.name, "code": leave.type_id.code,
                 "paid": leave.type_id.paid, "deducts_balance": leave.type_id.deducts_balance},
        "date_from": leave.date_from, "date_to": leave.date_to, "half_day": leave.half_day, "days": leave.days,
        "state": leave.state, "note": leave.note or None, "refusal_reason": leave.refusal_reason or None,
        "requested_by": leave.requested_by.name or None, "approver": leave.approver_id.name or None,
        "decided_at": leave.decided_at or None, "has_document": bool(leave.attachment_id),
        "can_decide": leave.state == "submitted" and can_decide(leave),
    }


def advance_row(adv):
    return {
        "id": adv.id, "employee": emp_ref(adv.employee_id), "kind": adv.kind, "date": adv.date, "amount": adv.amount,
        "installment": adv.installment, "first_month": adv.first_month, "reimbursed": adv._reimbursed(),
        "remaining": adv._remaining(), "state": adv.state, "note": adv.note or None,
    }


def employee_row(emp, day=None):
    day = day or today()
    return {
        "id": emp.id, "matricule": emp.matricule, "name": emp.name, "company": company_ref(emp.company_id),
        "job_title": emp.job_title or None,
        "department": ref(emp.department_id), "manager": ref(emp.manager_id), "category": emp.category or None,
        "contract_type": emp.contract_type, "hire_date": emp.hire_date, "contract_end": emp.contract_end or None,
        "trial_end": emp.trial_end or None, "exit_date": emp.exit_date or None, "state": emp._state(day),
        "base_salary": emp.base_salary, "monthly_gross": round(emp._monthly_gross()),
        "seniority_years": emp._seniority(day), "leave_balance": emp._leave_balance(day)["balance"],
        "phone": emp.phone or None, "email": emp.email or None, "absent_today": emp._absent_on(day),
        "issues": emp._issues(),
    }


def document_row(doc, day=None):
    day = day or today()
    settings = request.env["eguitra.rh.settings"]._get(doc.employee_id.company_id)
    expired = bool(doc.expiry_date and doc.expiry_date < day)
    soon = bool(doc.expiry_date and not expired and (doc.expiry_date - day).days <= settings.document_alert_days)
    return {"id": doc.id, "kind": doc.kind, "name": doc.name, "expiry_date": doc.expiry_date or None,
            "has_file": bool(doc.attachment_id), "expired": expired, "expires_soon": soon}


def payslip_row(slip):
    return {
        "id": slip.id, "month": slip.month, "employee": emp_ref(slip.employee_id), "department": ref(slip.department_id),
        "worked_days": slip.worked_days, "month_days": slip.month_days, "unpaid_days": slip.unpaid_days,
        "gross": slip.gross, "cnss_employee": slip.cnss_employee, "rts": slip.rts, "deductions": slip.deductions,
        "net": slip.net, "employer_cost": slip.employer_cost, "state": slip.state, "anomalies": slip._anomalies(),
        "net_variation": slip._net_variation(),
    }


def employee_detail(emp):
    day = today()
    driver = emp.sudo().driver_id
    activity = emp.sudo().activity_account_id
    leaves = request.env["eguitra.rh.leave"].search([("employee_id", "=", emp.id)], limit=100)
    payslips = request.env["eguitra.rh.payslip"].search([("employee_id", "=", emp.id)], limit=36)
    advances = request.env["eguitra.rh.advance"].search([("employee_id", "=", emp.id)])
    return dict(
        employee_row(emp, day),
        gender=emp.gender or None, birth_date=emp.birth_date or None, birth_place=emp.birth_place or None,
        nationality=emp.nationality or None, id_number=emp.id_number or None, cnss_number=emp.cnss_number or None,
        marital_status=emp.marital_status or None, children=emp.children, address=emp.address or None,
        emergency_contact=emp.emergency_contact or None, emergency_phone=emp.emergency_phone or None,
        activity={"id": activity.id, "name": activity.name} if activity else None,
        payment_method=emp.payment_method, bank_name=emp.bank_name or None, bank_account=emp.bank_account or None,
        mobile_money=emp.mobile_money or None,
        user={"id": emp.user_id.id, "name": emp.user_id.name, "login": emp.user_id.login} if emp.user_id else None,
        driver={"id": driver.id, "name": driver.name} if driver else None,
        leave_initial=emp.leave_initial, leave_initial_date=emp.leave_initial_date or None,
        exit_reason=emp.exit_reason or None, note=emp.note or None, age=emp._age(day),
        fixed_lines=[{"id": line.id, "rubric": {"id": line.rubric_id.id, "name": line.rubric_id.name,
                                                 "code": line.rubric_id.code, "input": line.rubric_id.input},
                      "amount": line.amount, "quantity": line.quantity} for line in emp.line_ids],
        documents=[document_row(d, day) for d in emp.document_ids],
        salary_history=[{"id": c.id, "date": c.date, "old_salary": c.old_salary, "new_salary": c.new_salary,
                         "reason": c.reason or None, "user": c.create_uid.name} for c in emp.salary_change_ids],
        balance=emp._leave_balance(day),
        leaves=[leave_row(leave) for leave in leaves],
        payslips=[payslip_row(s) for s in payslips],
        advances=[advance_row(a) for a in advances],
    )
