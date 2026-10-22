"""API RH : tableau de bord, salariés et documents, référentiels, paramètres, absences, avances.
Spécification : docs/projet/rh/specification.md, chapitre 4."""

import base64
import re
from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo import Command, http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require
from odoo.addons.eguitra_api.files import ACCEPTED, checked_name, detect_type

from ..models.employee import CATEGORIES, CONTRACTS, DOCUMENT_KINDS, EXIT_REASONS, MARITAL, PAYMENT_METHODS
from ..models.leave import InsufficientBalance
from ..models.payroll import month_label
from .common import (
    OWN_LEAVE,
    READ,
    WRITE,
    advance_row,
    can_decide,
    can_write,
    company_ref,
    date_value,
    department_row,
    document_row,
    emp_ref,
    employee_detail,
    employee_row,
    get,
    int_or_false,
    internal_only,
    leave_row,
    leave_type_row,
    number,
    own_leave,
    ref,
    refuse_own,
    rubric_row,
    scope,
    text,
    today,
)

MAX_FILE = 20 * 1024 * 1024
EMPLOYEE_TEXT = ("job_title", "birth_place", "nationality", "id_number", "cnss_number", "phone", "email", "address",
                 "emergency_contact", "emergency_phone", "bank_name", "bank_account", "mobile_money")
SELECTIONS = {"gender": ("homme", "femme"), "marital_status": dict(MARITAL), "category": dict(CATEGORIES),
              "contract_type": dict(CONTRACTS), "payment_method": dict(PAYMENT_METHODS)}


def options(pairs):
    return [{"code": code, "label": label} for code, label in pairs]


def _check_reference(key, record_id, company):
    """Chaque identifiant écrit dans un dossier salarié est cohérent avec son employeur (mêmes listes que
    /rh/meta) : département commun ou de l'employeur, responsable d'une des sociétés du compte (la
    gestion RH est commune), chauffeur et activité de l'employeur (ou activité commune), compte
    interne ouvert à l'employeur."""
    env = request.env
    if key == "department_id":
        record = env["eguitra.rh.department"].sudo().browse(record_id).exists()
        valid = record and record.company_id in (company, env["res.company"])
    elif key == "manager_id":
        record = env["eguitra.rh.employee"].sudo().browse(record_id).exists()
        valid = record and record.company_id in env.companies
    elif key == "driver_id":
        record = env["eguitra.transport.driver"].sudo().browse(record_id).exists()
        valid = record and record.company_id == company
    elif key == "activity_id":
        record = env["account.analytic.account"].sudo().browse(record_id).exists()
        valid = (record and record.plan_id == env.ref("eguitra_base.analytic_plan_activite")
                 and record.company_id in (company, env["res.company"]))
    else:
        record = env["res.users"].sudo().browse(record_id).exists()
        valid = record and not record.share and company in record.company_ids
    if not valid:
        raise ApiError(422, "business_rule", f"Référence invalide pour cette société : {key}.")


def approve(leave, force=False):
    try:
        leave.sudo().action_approve(force=force)
    except InsufficientBalance as e:
        raise ApiError(422, "insufficient_balance", str(e.args[0])) from e


class EguitraRh(http.Controller):
    # ─── Tableau de bord ─────────────────────────────────────────────────

    @api_route("/rh/summary", profiles=READ)
    def summary(self, **kw):
        env = request.env
        companies = scope(kw)
        day = today()
        settings = env["eguitra.rh.settings"]._get(env.company if env.company in companies else companies[0])
        Employee = env["eguitra.rh.employee"]
        everyone = Employee.with_context(active_test=False).search([("company_id", "in", companies.ids)])
        current = everyone.filtered(lambda e: e.active and e._state(day) in ("essai", "actif"))
        year_start = day.replace(month=1, day=1)
        hires = everyone.filtered(lambda e: e.hire_date >= year_start and e.hire_date <= day)
        exits = everyone.filtered(lambda e: e.exit_date and year_start <= e.exit_date <= day)
        last_year = day - relativedelta(years=1)
        exits_12 = everyone.filtered(lambda e: e.exit_date and last_year <= e.exit_date <= day)
        headcount = len(current)
        Leave = env["eguitra.rh.leave"]

        # Taux d'absence sur 30 jours, hors congés payés : jours d'absence / jours ouvrables attendus.
        since = day - timedelta(days=30)
        Holiday = env["eguitra.rh.holiday"]
        expected = sum(Holiday._working_days(c, since, day) * len(current.filtered(lambda e, c=c: e.company_id == c))
                       for c in companies)
        absences = Leave.search([("company_id", "in", companies.ids), ("state", "=", "approved"),
                                 ("type_id.deducts_balance", "=", False), ("date_from", "<=", day),
                                 ("date_to", ">=", since)])
        absent_days = sum(Holiday._working_days(leave.company_id, max(leave.date_from, since), min(leave.date_to, day))
                          for leave in absences)

        today_leaves = Leave.search([("company_id", "in", companies.ids), ("state", "=", "approved"),
                                     ("date_from", "<=", day), ("date_to", ">=", day)])
        upcoming = Leave.search([("company_id", "in", companies.ids), ("state", "in", ("approved", "submitted")),
                                 ("date_from", ">", day), ("date_from", "<=", day + timedelta(days=14))],
                                order="date_from")

        def split(key, labels):
            counts = {}
            for emp in current:
                code = emp[key] or "none"
                counts[code] = counts.get(code, 0) + 1
            return [{"code": code, "label": labels.get(code, "Non renseignée"), "headcount": n}
                    for code, n in sorted(counts.items(), key=lambda kv: -kv[1])]

        departments = {}
        for emp in current:
            name = emp.department_id.name or "Sans département"
            departments[name] = departments.get(name, 0) + 1
        Payroll = env["eguitra.rh.payroll"]
        trend = {}
        for payroll in Payroll.search([("company_id", "in", companies.ids), ("state", "!=", "draft")],
                                      order="month desc", limit=12 * len(companies)):
            totals = payroll._totals()
            month = trend.setdefault(payroll.month, {"month": payroll.month, "gross": 0, "net": 0, "employer_cost": 0,
                                                     "headcount": 0})
            for key in ("gross", "net", "employer_cost", "headcount"):
                month[key] += totals[key]
        current_payrolls = [Payroll.search([("company_id", "=", c.id)], order="month desc", limit=1) for c in companies]
        ages = [a for a in (e._age(day) for e in current) if a is not None]
        known_gender = current.filtered("gender")
        return {
            "companies": [company_ref(c) for c in companies],
            "by_company": [{"company": company_ref(c),
                            "headcount": len(current.filtered(lambda e, c=c: e.company_id == c)),
                            "monthly_payroll_estimate": round(sum(e._monthly_gross() for e in current
                                                                  if e.company_id == c))}
                           for c in companies],
            "headcount": headcount,
            "headcount_trial": len(current.filtered(lambda e: e._state(day) == "essai")),
            "hires_year": len(hires), "exits_year": len(exits),
            "turnover_rate": round(len(exits_12) / headcount * 100, 1) if headcount else None,
            "average_seniority": round(sum(e._seniority(day) for e in current) / headcount, 1) if headcount else None,
            "average_age": round(sum(ages) / len(ages), 1) if ages else None,
            "women_share": round(len(known_gender.filtered(lambda e: e.gender == "femme")) / len(known_gender) * 100, 1)
            if known_gender else None,
            "monthly_payroll_estimate": round(sum(e._monthly_gross() for e in current)),
            "absent_today": [{"employee": ref(leave.employee_id), "type": leave.type_id.name, "date_to": leave.date_to}
                             for leave in today_leaves],
            "pending_leaves": Leave.search_count([("company_id", "in", companies.ids), ("state", "=", "submitted")]),
            "absenteeism_rate": round(absent_days / expected * 100, 1) if expected else None,
            "by_department": [{"name": k, "headcount": v} for k, v in sorted(departments.items(), key=lambda kv: -kv[1])],
            "by_contract": split("contract_type", dict(CONTRACTS)),
            "by_category": split("category", dict(CATEGORIES)),
            "payroll_trend": [trend[m] for m in sorted(trend)][-12:],
            "upcoming_leaves": [leave_row(leave) for leave in upcoming],
            "alerts": self._alerts(companies, settings, current, day),
            "current_payrolls": [_payroll_row(p) for p in current_payrolls if p],
        }

    def _alerts(self, companies, settings, current, day):
        alerts = []

        def add(kind, severity, date, emp, message, href):
            alerts.append({"kind": kind, "severity": severity, "date": date, "employee": ref(emp), "message": message,
                           "href": href})

        for emp in current:
            href = f"/rh/salaries/{emp.id}"
            if emp.trial_end and day <= emp.trial_end <= day + timedelta(days=settings.trial_alert_days):
                add("trial_end", "warn", emp.trial_end, emp, f"Fin de la période d'essai de {emp.name} : confirmer "
                    "l'embauche ou y mettre fin.", href)
            if emp.contract_end and emp.contract_end <= day + timedelta(days=settings.contract_alert_days):
                late = emp.contract_end < day
                add("contract_end", "danger" if late else "warn", emp.contract_end, emp,
                    f"{'Contrat échu' if late else 'Fin de contrat'} de {emp.name} : renouveler, embaucher ou "
                    "enregistrer la sortie.", href)
            for doc in emp.document_ids.filtered("expiry_date"):
                if doc.expiry_date < day:
                    add("document", "danger", doc.expiry_date, emp, f"{doc.name} de {emp.name} expiré.", href)
                elif doc.expiry_date <= day + timedelta(days=settings.document_alert_days):
                    add("document", "warn", doc.expiry_date, emp, f"{doc.name} de {emp.name} à renouveler.", href)
            balance = emp._leave_balance(day)["balance"]
            if balance > settings.leave_days_per_month * 18:
                add("leave_balance", "info", None, emp, f"{emp.name} cumule {balance:g} jours de congés : planifier "
                    "des congés.", "/rh/conges")
            issues = emp._issues()
            if issues:
                add("missing_data", "info", None, emp, f"Dossier de {emp.name} à compléter : {', '.join(issues).lower()}.",
                    href)
            if emp.birth_date:
                birthday = emp.birth_date.replace(year=day.year) if not (emp.birth_date.month == 2 and emp.birth_date.day == 29) \
                    else emp.birth_date.replace(year=day.year, day=28)
                if day <= birthday <= day + timedelta(days=7):
                    add("birthday", "info", birthday, emp, f"Anniversaire de {emp.name}.", href)
            if emp.hire_date.year < day.year:
                anniversary = emp.hire_date.replace(year=day.year) if not (emp.hire_date.month == 2 and emp.hire_date.day == 29) \
                    else emp.hire_date.replace(year=day.year, day=28)
                if day <= anniversary <= day + timedelta(days=7):
                    years = day.year - emp.hire_date.year
                    add("anniversary", "info", anniversary, emp, f"{emp.name} fête ses {years} an(s) dans l'entreprise.",
                        href)
        previous = (day.replace(day=1) - relativedelta(months=1))
        Payroll = request.env["eguitra.rh.payroll"]
        for company in companies:
            last = Payroll.search([("company_id", "=", company.id), ("month", "=", previous)], limit=1)
            if current.filtered(lambda e, c=company: e.company_id == c) and (not last or last.state == "draft"):
                add("payroll", "warn", None, None, f"La paie de {month_label(previous)} de {company.name} n'est pas "
                    "validée.", f"/rh/paie/{last.id}" if last else "/rh/paie")
        order = {"danger": 0, "warn": 1, "info": 2}
        alerts.sort(key=lambda a: (order[a["severity"]], str(a["date"] or "9999")))
        return alerts

    # ─── Référentiels ────────────────────────────────────────────────────

    @api_route("/rh/meta", profiles=READ)
    def meta(self, **_kw):
        env = request.env
        companies = env.companies
        Employee = env["eguitra.rh.employee"]
        day = today()
        actives = Employee.search([("company_id", "in", companies.ids), "|", ("exit_date", "=", False),
                                   ("exit_date", ">=", day)])
        users = env["res.users"].sudo().search([("share", "=", False), ("company_ids", "in", companies.ids)],
                                               order="name")
        drivers = env["eguitra.transport.driver"].sudo().search([("company_id", "in", companies.ids)], order="name")
        plan = env.ref("eguitra_base.analytic_plan_activite")
        activities = env["account.analytic.account"].sudo().search(
            [("plan_id", "=", plan.id), ("company_id", "in", [False] + companies.ids)], order="name")
        return {
            "companies": [company_ref(c) for c in companies],
            "work_company_id": env.company.id,
            "departments": [department_row(d) for d in env["eguitra.rh.department"].with_context(active_test=False).search(
                ["|", ("company_id", "=", False), ("company_id", "in", companies.ids)])],
            "rubrics": [rubric_row(r) for r in env["eguitra.rh.rubric"].with_context(active_test=False).search([])],
            "leave_types": [leave_type_row(t) for t in env["eguitra.rh.leave.type"].with_context(active_test=False).search([])],
            "categories": options(CATEGORIES), "contract_types": options(CONTRACTS),
            "marital_statuses": options(MARITAL), "payment_methods": options(PAYMENT_METHODS),
            "exit_reasons": options(EXIT_REASONS), "document_kinds": options(DOCUMENT_KINDS),
            "employees": [dict(emp_ref(e), company_id=e.company_id.id) for e in actives],
            "users": [{"id": u.id, "name": u.name, "login": u.login,
                       "company_ids": [c for c in u.company_ids.ids if c in companies.ids]} for u in users],
            "drivers": [{"id": d.id, "name": d.name, "company_id": d.company_id.id} for d in drivers],
            "activities": [{"id": a.id, "name": a.name, "company_id": a.company_id.id or None} for a in activities],
            "can_write": can_write(),
        }

    # ─── Salariés ────────────────────────────────────────────────────────

    @api_route("/rh/employees", profiles=READ)
    def employees(self, **kw):
        domain = [("company_id", "in", scope(kw).ids)]
        day = today()
        state = kw.get("state") or "active"
        if state == "active":
            domain += ["|", ("exit_date", "=", False), ("exit_date", ">=", day)]
        elif state == "sorti":
            domain += [("exit_date", "<", day)]
        if kw.get("department_id"):
            domain.append(("department_id", "=", int_arg(kw, "department_id")))
        if kw.get("q"):
            q = str(kw["q"]).strip()
            domain += ["|", "|", "|", ("name", "ilike", q), ("matricule", "ilike", q), ("job_title", "ilike", q),
                       ("phone", "ilike", q)]
        return [employee_row(e, day) for e in request.env["eguitra.rh.employee"].search(domain)]

    def _employee_values(self, data, company, creating=False):
        values = {k: text(data, k) for k in EMPLOYEE_TEXT if k in data}
        if "name" in data:
            if not text(data, "name"):
                raise ApiError(400, "missing_fields", "Nom obligatoire.", fields=["name"])
            values["name"] = text(data, "name")
        if "note" in data:
            values["note"] = (data.get("note") or "").strip() or False
        for key, allowed in SELECTIONS.items():
            if key in data:
                value = data.get(key) or False
                if value and value not in allowed:
                    raise ApiError(400, "invalid_parameter", f"Valeur inconnue : {key}.")
                values[key] = value
        for key in ("hire_date", "contract_end", "trial_end", "birth_date", "leave_initial_date"):
            if key in data:
                values[key] = date_value(data, key)
        for key in ("base_salary", "leave_initial"):
            if key in data:
                values[key] = number(data, key)
        if "children" in data:
            values["children"] = int(number(data, "children"))
        for key, field in (("department_id", "department_id"), ("manager_id", "manager_id"), ("user_id", "user_id"),
                           ("driver_id", "driver_id"), ("activity_id", "activity_account_id")):
            if key in data:
                values[field] = int_or_false(data, key)
                if values[field]:
                    _check_reference(key, values[field], company)
        if values.get("user_id") == request.env.uid:
            # Quatre yeux : un dossier lié à son propre compte serait un dossier qu'on se gère soi-même.
            raise ApiError(403, "forbidden", "Vous ne pouvez pas lier un dossier salarié à votre propre compte : un "
                                             "autre membre du service RH s'en charge.")
        if "fixed_lines" in data:
            lines = []
            for line in data.get("fixed_lines") or []:
                rubric = request.env["eguitra.rh.rubric"].browse(int_or_false(line, "rubric_id")).exists()
                if not rubric or rubric.system:
                    raise ApiError(422, "business_rule", "Rubrique inconnue ou réservée au calcul de la paie.")
                lines.append(Command.create({"rubric_id": rubric.id, "amount": number(line, "amount"),
                                             "quantity": number(line, "quantity")}))
            values["line_ids"] = ([] if creating else [Command.clear()]) + lines
        return values

    @api_route("/rh/employees", methods=("POST",), profiles=WRITE)
    def create_employee(self, **_kw):
        data = read_json()
        require(data, "name", "hire_date")
        company = scope({"company_id": data.get("company_id")}) if data.get("company_id") else request.env.company
        values = self._employee_values(data, company, creating=True)
        values["company_id"] = company.id
        emp = request.env["eguitra.rh.employee"].create(values)
        return employee_detail(emp)

    @api_route("/rh/employees/<int:employee_id>", profiles=READ)
    def employee(self, employee_id, **_kw):
        return employee_detail(get("eguitra.rh.employee", employee_id, "Salarié"))

    @api_route("/rh/employees/<int:employee_id>", methods=("PATCH",), profiles=WRITE)
    def update_employee(self, employee_id, **_kw):
        emp = get("eguitra.rh.employee", employee_id, "Salarié")
        refuse_own(emp)
        data = read_json()
        emp.with_context(salary_reason=text(data, "salary_reason")).write(self._employee_values(data, emp.company_id))
        return employee_detail(emp)

    @api_route("/rh/employees/<int:employee_id>/exit", methods=("POST",), profiles=WRITE)
    def exit_employee(self, employee_id, **_kw):
        emp = get("eguitra.rh.employee", employee_id, "Salarié")
        refuse_own(emp)
        data = read_json()
        require(data, "exit_date")
        reason = data.get("exit_reason") or "autre"
        if reason not in dict(EXIT_REASONS):
            raise ApiError(400, "invalid_parameter", "Motif de sortie inconnu.")
        emp.action_exit(date_value(data, "exit_date"), reason)
        return employee_detail(emp)

    @api_route("/rh/employees/<int:employee_id>/documents", methods=("POST",), profiles=WRITE)
    def add_document(self, employee_id, **_kw):
        emp = get("eguitra.rh.employee", employee_id, "Salarié")
        refuse_own(emp)
        form = request.httprequest.form
        kind = form.get("kind") or "autre"
        if kind not in dict(DOCUMENT_KINDS):
            raise ApiError(400, "invalid_parameter", "Nature de document inconnue.")
        name = " ".join(re.sub(r"[\x00-\x1f\x7f]", " ", form.get("name") or "").split())[:200] or dict(DOCUMENT_KINDS)[kind]
        values = {"employee_id": emp.id, "kind": kind, "name": name, "expiry_date": date_value(form, "expiry_date")}
        upload = request.httprequest.files.get("file")
        if upload and upload.filename:
            content = upload.read(MAX_FILE + 1)
            if len(content) > MAX_FILE:
                raise ApiError(413, "too_large", "Fichier trop volumineux (20 Mo maximum).")
            mimetype = detect_type(content)
            if not mimetype:
                raise ApiError(415, "unsupported_type", f"Formats acceptés : {ACCEPTED}.")
            values["attachment_id"] = request.env["ir.attachment"].sudo().create({
                "name": checked_name(upload.filename, mimetype), "datas": base64.b64encode(content),
                "mimetype": mimetype, "res_model": "eguitra.rh.employee", "res_id": emp.id,
            }).id
        return document_row(request.env["eguitra.rh.document"].create(values))

    @api_route("/rh/documents/<int:document_id>/file", profiles=READ)
    def document_file(self, document_id, **_kw):
        doc = get("eguitra.rh.document", document_id, "Document")
        att = doc.attachment_id.sudo()
        if not att:
            raise ApiError(404, "not_found", "Aucun fichier pour ce document.")
        return request.make_response(att.raw or b"", headers=[
            ("Content-Type", att.mimetype or "application/octet-stream"),
            ("Content-Disposition", content_disposition(att.name or "document")),
            ("X-Content-Type-Options", "nosniff"),
        ])

    @api_route("/rh/documents/<int:document_id>", methods=("DELETE",), profiles=WRITE)
    def delete_document(self, document_id, **_kw):
        doc = get("eguitra.rh.document", document_id, "Document")
        refuse_own(doc.employee_id)
        attachment = doc.attachment_id.sudo()
        doc.unlink()
        attachment.unlink()
        return {"status": "ok"}

    # ─── Départements, rubriques, types d'absence ────────────────────────

    def _department_values(self, data):
        values = {}
        if "name" in data:
            values["name"] = text(data, "name")
        if "company_id" in data:
            values["company_id"] = scope({"company_id": data["company_id"]}).id if data.get("company_id") else False
        if "manager_id" in data:
            values["manager_id"] = int_or_false(data, "manager_id")
            if values["manager_id"]:
                _check_reference("manager_id", values["manager_id"], request.env.company)
        if "active" in data:
            values["active"] = bool(data["active"])
        return values

    def _check_shared_department(self, dept=None, values=None):
        """Un département commun (sans société) ne se crée et ne se modifie que par un compte ouvert à
        toutes les sociétés : il peut contenir des salariés de chacune."""
        shared = (dept is not None and not dept.company_id) or (values is not None and values.get("company_id") is False)
        if shared:
            everyone = request.env["res.company"].sudo().search([])
            if everyone - request.env.companies:
                raise ApiError(403, "forbidden", "Un département commun aux deux sociétés ne se gère que par un compte "
                                                 "ouvert aux deux sociétés.")

    @api_route("/rh/departments", methods=("POST",), profiles=WRITE)
    def create_department(self, **_kw):
        data = read_json()
        require(data, "name")
        values = self._department_values(data)
        values.setdefault("company_id", False)
        self._check_shared_department(values=values)
        return department_row(request.env["eguitra.rh.department"].create(values))

    @api_route("/rh/departments/<int:department_id>", methods=("PATCH",), profiles=WRITE)
    def update_department(self, department_id, **_kw):
        dept = get("eguitra.rh.department", department_id, "Département")
        values = self._department_values(read_json())
        self._check_shared_department(dept, values if "company_id" in values else None)
        dept.write(values)
        return department_row(dept)

    def _rubric_values(self, data):
        values = {k: text(data, k) for k in ("code", "name", "account_code") if k in data}
        if values.get("code"):
            values["code"] = values["code"].upper().replace(" ", "_")[:20]
        for key, allowed in (("kind", ("gain", "deduction")), ("input", ("amount", "hours"))):
            if key in data:
                if data[key] not in allowed:
                    raise ApiError(400, "invalid_parameter", f"Valeur inconnue : {key}.")
                values[key] = data[key]
        for key in ("cnss", "taxable", "exempt_allowance", "active"):
            if key in data:
                values[key] = bool(data[key])
        if "overtime_rate" in data:
            values["overtime_rate"] = number(data, "overtime_rate")
        return values

    @api_route("/rh/rubrics", methods=("POST",), profiles=WRITE)
    def create_rubric(self, **_kw):
        data = read_json()
        require(data, "code", "name")
        return rubric_row(request.env["eguitra.rh.rubric"].create(self._rubric_values(data)))

    @api_route("/rh/rubrics/<int:rubric_id>", methods=("PATCH",), profiles=WRITE)
    def update_rubric(self, rubric_id, **_kw):
        rubric = request.env["eguitra.rh.rubric"].with_context(active_test=False).browse(rubric_id).exists()
        if not rubric:
            raise ApiError(404, "not_found", "Rubrique introuvable.")
        values = self._rubric_values(read_json())
        if rubric.system:
            # Le code et la nature d'une rubrique du moteur ne changent pas : le calcul s'y réfère.
            values = {k: v for k, v in values.items() if k in ("name", "account_code", "cnss", "taxable")}
        rubric.write(values)
        return rubric_row(rubric)

    def _leave_type_values(self, data):
        values = {k: text(data, k) for k in ("code", "name") if k in data}
        for key in ("paid", "deducts_balance", "needs_document", "active"):
            if key in data:
                values[key] = bool(data[key])
        if "max_days" in data:
            values["max_days"] = number(data, "max_days")
        return values

    @api_route("/rh/leave-types", methods=("POST",), profiles=WRITE)
    def create_leave_type(self, **_kw):
        data = read_json()
        require(data, "code", "name")
        return leave_type_row(request.env["eguitra.rh.leave.type"].create(self._leave_type_values(data)))

    @api_route("/rh/leave-types/<int:type_id>", methods=("PATCH",), profiles=WRITE)
    def update_leave_type(self, type_id, **_kw):
        leave_type = request.env["eguitra.rh.leave.type"].with_context(active_test=False).browse(type_id).exists()
        if not leave_type:
            raise ApiError(404, "not_found", "Type d'absence introuvable.")
        leave_type.write(self._leave_type_values(read_json()))
        return leave_type_row(leave_type)

    # ─── Paramètres et jours fériés ──────────────────────────────────────

    @api_route("/rh/settings", profiles=READ)
    def settings(self, **kw):
        company = scope(kw) if kw.get("company_id") else request.env.company
        return _settings_row(request.env["eguitra.rh.settings"]._get(company))

    @api_route("/rh/settings", methods=("PATCH",), profiles=WRITE)
    def update_settings(self, **kw):
        """Taux, barème, congés, heures, alertes et comptes : communs aux deux sociétés (écrits pour
        chacune). Numéro d'employeur CNSS, taxe de formation et journal : propres à la société visée."""
        data = read_json()
        wanted = kw.get("company_id") or data.get("company_id")
        company = scope({"company_id": wanted}) if wanted else request.env.company
        Settings = request.env["eguitra.rh.settings"]
        settings = Settings._get(company)
        values, own = {}, {}
        for key in ("cnss_employee_rate", "cnss_employer_rate", "cnss_ceiling", "smig", "allowance_exempt_cap",
                    "vf_rate", "training_tax_rate", "leave_days_per_month", "monthly_hours", "rotation_bonus"):
            if key in data:
                target = own if key == "training_tax_rate" else values
                target[key] = number(data, key)
                if target[key] < 0:
                    raise ApiError(422, "business_rule", "Les taux et montants des paramètres sont positifs.")
        for key in ("trial_alert_days", "contract_alert_days", "document_alert_days"):
            if key in data:
                values[key] = int(number(data, key))
        for key in ("training_tax_label", "cnss_employer_number"):
            if key in data:
                own[key] = text(data, key)
        for key, field in (("salary", "account_salary"), ("social_charges", "account_social_charges"),
                           ("payroll_taxes", "account_payroll_taxes"), ("training_tax", "account_training_tax"),
                           ("cnss", "account_cnss"), ("rts", "account_rts"),
                           ("payroll_taxes_payable", "account_payroll_taxes_payable"),
                           ("net_payable", "account_net_payable"), ("advances", "account_advances")):
            if key in (data.get("accounts") or {}):
                values[field] = text(data["accounts"], key)
        if "rts_brackets" in data:
            brackets = sorted((number(b, "from"), number(b, "rate")) for b in data.get("rts_brackets") or [])
            if not brackets or brackets[0][0] != 0:
                raise ApiError(422, "business_rule", "Le barème de la RTS commence à 0.")
            if len({b[0] for b in brackets}) != len(brackets):
                raise ApiError(422, "business_rule", "Deux tranches du barème ont le même seuil.")
            values["bracket_ids"] = [Command.clear()] + [Command.create({"threshold": t, "rate": r}) for t, r in brackets]
        if values:
            for other in request.env.companies:
                record = Settings._get(other).sudo()
                # Le barème est recréé pour chaque société (une tranche n'appartient qu'à une fiche).
                record.write(values)
        settings.sudo().write(own)
        if "journal_id" in data:
            journal = request.env["account.journal"].sudo().browse(int_or_false(data, "journal_id")).exists()
            settings.sudo().journal_id = journal.id if journal and journal.company_id == company else False
        return _settings_row(settings)

    @api_route("/rh/holidays", profiles=None)
    def holidays(self, **kw):
        internal_only()
        year = int_arg(kw, "year", today().year, 2000, 2100)
        holidays = request.env["eguitra.rh.holiday"].sudo().search([
            ("date", ">=", f"{year}-01-01"), ("date", "<=", f"{year}-12-31"),
            ("company_id", "in", [False] + request.env.companies.ids)])
        return [{"id": h.id, "date": h.date, "name": h.name} for h in holidays]

    @api_route("/rh/holidays", methods=("POST",), profiles=WRITE)
    def create_holiday(self, **_kw):
        data = read_json()
        require(data, "date", "name")
        holiday = request.env["eguitra.rh.holiday"].create({"date": date_value(data, "date"), "name": text(data, "name")})
        return {"id": holiday.id, "date": holiday.date, "name": holiday.name}

    @api_route("/rh/holidays/<int:holiday_id>", methods=("DELETE",), profiles=WRITE)
    def delete_holiday(self, holiday_id, **_kw):
        holiday = request.env["eguitra.rh.holiday"].browse(holiday_id).exists()
        if not holiday:
            raise ApiError(404, "not_found", "Jour férié introuvable.")
        holiday.unlink()
        return {"status": "ok"}

    # ─── Absences ────────────────────────────────────────────────────────

    @api_route("/rh/leaves/days", profiles=None)
    def leave_days(self, **kw):
        internal_only()
        date_from = date_value(kw, "date_from")
        date_to = date_value(kw, "date_to")
        if not date_from or not date_to:
            raise ApiError(400, "missing_fields", "Dates obligatoires.", fields=["date_from", "date_to"])
        days = request.env["eguitra.rh.holiday"]._working_days(request.env.company, date_from, date_to)
        half = str(kw.get("half_day")).lower() in ("1", "true")
        return {"days": 0.5 if half and days and date_from == date_to else days}

    @api_route("/rh/leaves", profiles=READ)
    def leaves(self, **kw):
        domain = [("company_id", "in", scope(kw).ids)]
        if kw.get("state"):
            domain.append(("state", "in", str(kw["state"]).split(",")))
        if kw.get("employee_id"):
            domain.append(("employee_id", "=", int_arg(kw, "employee_id")))
        if kw.get("date_from"):
            domain.append(("date_to", ">=", date_value(kw, "date_from")))
        if kw.get("date_to"):
            domain.append(("date_from", "<=", date_value(kw, "date_to")))
        return [leave_row(leave) for leave in request.env["eguitra.rh.leave"].search(domain, limit=1000)]

    @api_route("/rh/leaves", methods=("POST",), profiles=WRITE)
    def create_leave(self, **_kw):
        data = read_json()
        require(data, "employee_id", "type_id", "date_from", "date_to")
        emp = get("eguitra.rh.employee", int_or_false(data, "employee_id"), "Salarié")
        leave = request.env["eguitra.rh.leave"].create({
            "employee_id": emp.id, "type_id": int_or_false(data, "type_id"), "date_from": date_value(data, "date_from"),
            "date_to": date_value(data, "date_to"), "half_day": bool(data.get("half_day")),
            "note": (data.get("note") or "").strip() or False,
        })
        if data.get("approve"):
            # Même contrôle que les décisions : personne n'approuve sa propre absence (l'erreur annule la
            # création de la demande).
            if not can_decide(leave):
                raise ApiError(403, "forbidden", OWN_LEAVE if own_leave(leave)
                               else "Cette absence relève d'un autre responsable.")
            approve(leave, force=bool(data.get("force")))
        return leave_row(leave)

    def _decidable(self, leave_id):
        internal_only()
        leave = request.env["eguitra.rh.leave"].sudo().browse(leave_id).exists()
        if leave and own_leave(leave):
            raise ApiError(403, "forbidden", OWN_LEAVE)
        if not leave or not can_decide(leave):
            raise ApiError(404, "not_found", "Demande introuvable ou hors de votre périmètre.")
        return leave

    @api_route("/rh/leaves/<int:leave_id>/approve", methods=("POST",), profiles=None)
    def approve_leave(self, leave_id, **_kw):
        leave = self._decidable(leave_id)
        # Seule la RH (ou l'administration) passe outre un solde insuffisant.
        force = bool(read_json().get("force")) and can_write()
        approve(leave, force=force)
        return leave_row(leave)

    @api_route("/rh/leaves/<int:leave_id>/refuse", methods=("POST",), profiles=None)
    def refuse_leave(self, leave_id, **_kw):
        leave = self._decidable(leave_id)
        leave.action_refuse(text(read_json(), "reason"))
        return leave_row(leave)

    @api_route("/rh/leaves/<int:leave_id>/cancel", methods=("POST",), profiles=None)
    def cancel_leave(self, leave_id, **_kw):
        internal_only()
        leave = request.env["eguitra.rh.leave"].sudo().browse(leave_id).exists()
        own = leave and own_leave(leave)
        # Sur sa propre absence, la RH suit la règle du salarié (quatre yeux).
        manager = leave and not own and can_write() and leave.company_id in request.env.user.company_ids
        if not leave or not (own or manager):
            raise ApiError(404, "not_found", "Absence introuvable.")
        if own and not manager and leave.state == "approved" and leave.date_from <= today():
            raise ApiError(422, "business_rule", "Une absence commencée ne s'annule que par le service RH.")
        leave.action_cancel()
        return leave_row(leave)

    @api_route("/rh/leaves/balances", profiles=READ)
    def balances(self, **kw):
        day = today()
        employees = request.env["eguitra.rh.employee"].search([
            ("company_id", "in", scope(kw).ids), ("hire_date", "<=", day),
            "|", ("exit_date", "=", False), ("exit_date", ">=", day)])
        return [{"employee": dict(emp_ref(e), company_id=e.company_id.id), "department": ref(e.department_id),
                 "balance": e._leave_balance(day)}
                for e in employees]

    # ─── Avances et prêts ────────────────────────────────────────────────

    @api_route("/rh/advances", profiles=READ)
    def advances(self, **kw):
        domain = [("company_id", "in", scope(kw).ids)]
        if kw.get("state"):
            domain.append(("state", "in", str(kw["state"]).split(",")))
        return [advance_row(a) for a in request.env["eguitra.rh.advance"].search(domain)]

    @api_route("/rh/advances", methods=("POST",), profiles=WRITE)
    def create_advance(self, **_kw):
        data = read_json()
        require(data, "employee_id", "amount", "installment", "first_month")
        emp = get("eguitra.rh.employee", int_or_false(data, "employee_id"), "Salarié")
        refuse_own(emp)
        kind = data.get("kind") or "avance"
        if kind not in ("avance", "pret"):
            raise ApiError(400, "invalid_parameter", "Nature inconnue.")
        first = date_value(data, "first_month").replace(day=1)
        advance = request.env["eguitra.rh.advance"].create({
            "employee_id": emp.id, "kind": kind, "date": date_value(data, "date") or today(),
            "amount": number(data, "amount"), "installment": number(data, "installment"), "first_month": first,
            "note": text(data, "note"),
        })
        return advance_row(advance)

    @api_route("/rh/advances/<int:advance_id>/cancel", methods=("POST",), profiles=WRITE)
    def cancel_advance(self, advance_id, **_kw):
        advance = get("eguitra.rh.advance", advance_id, "Avance")
        refuse_own(advance.employee_id)
        advance.action_cancel()
        return advance_row(advance)


def _settings_row(s):
    return {
        "company": company_ref(s.company_id),
        "cnss_employee_rate": s.cnss_employee_rate, "cnss_employer_rate": s.cnss_employer_rate,
        "cnss_ceiling": s.cnss_ceiling, "smig": s.smig, "allowance_exempt_cap": s.allowance_exempt_cap,
        "rts_brackets": [{"from": b.threshold, "rate": b.rate} for b in s.bracket_ids],
        "vf_rate": s.vf_rate, "training_tax_rate": s.training_tax_rate,
        "training_tax_label": s.training_tax_label or "", "leave_days_per_month": s.leave_days_per_month,
        "monthly_hours": s.monthly_hours, "rotation_bonus": s.rotation_bonus, "trial_alert_days": s.trial_alert_days,
        "contract_alert_days": s.contract_alert_days, "document_alert_days": s.document_alert_days,
        "cnss_employer_number": s.cnss_employer_number or None,
        "accounts": {"salary": s.account_salary or "", "social_charges": s.account_social_charges or "",
                     "payroll_taxes": s.account_payroll_taxes or "", "training_tax": s.account_training_tax or "",
                     "cnss": s.account_cnss or "", "rts": s.account_rts or "",
                     "payroll_taxes_payable": s.account_payroll_taxes_payable or "",
                     "net_payable": s.account_net_payable or "", "advances": s.account_advances or ""},
        "journal": ref(s.journal_id.sudo()),
    }


def _payroll_row(p):
    move = p.move_id.sudo()
    slips = p.payslip_ids
    return {
        "id": p.id, "name": p.name, "company": company_ref(p.company_id), "month": p.month, "state": p.state, "totals": p._totals(),
        "anomalies": sum(len(s._anomalies()) for s in slips),
        "move": {"id": move.id, "name": move.name, "state": move.state} if move.exists() else None,
    }
