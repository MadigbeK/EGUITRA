"""API de la paie : paies du mois, bulletins, éléments variables, export, simulateur."""

import io

from odoo import http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require
from odoo.addons.eguitra_api.files import XLSX_OPTIONS, xlsx_row

from ..engine import Item, base_for_net, compute
from ..models.employee import CONTRACTS, PAYMENT_METHODS, month_bounds
from ..models.payroll import month_label, of_month
from .common import (
    READ,
    WRITE,
    can_write,
    date_value,
    get,
    int_or_false,
    number,
    payslip_row,
    refuse_own,
    scope,
    text,
)
from .rh import _payroll_row

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def can_validate(payroll):
    """Quatre yeux : la direction (ou l'administration) valide une paie en préparation qu'elle n'a ni
    créée, ni recalculée, ni complétée ; la RH ne valide jamais."""
    return payroll.state == "draft" and payroll._can_validate(request.env.user)


def payroll_detail(payroll):
    return dict(
        _payroll_row(payroll),
        payslips=[payslip_row(s) for s in payroll.payslip_ids.sorted(lambda s: s.employee_id.name)],
        by_activity=[{"name": g["name"], "gross": g["gross"], "employer_cost": g["employer_cost"]}
                     for g in payroll._by("activity")],
        by_department=payroll._by("department"),
        validated_by=payroll.validated_by.name or None, validated_at=payroll.validated_at or None,
        prepared_by=payroll._preparers().mapped("name"),
        can_write=can_write(), can_validate=can_validate(payroll),
    )


def payslip_detail(slip):
    """Bulletin complet (lecture en sudo : l'appelant a vérifié le droit de le voir)."""
    slip = slip.sudo()
    emp = slip.employee_id
    company = slip.company_id
    settings = request.env["eguitra.rh.settings"]._get(company)
    start, end = month_bounds(slip.month)
    address = ", ".join(filter(None, [company.street, company.street2, company.city])) or None
    return dict(
        payslip_row(slip),
        company={"name": company.name, "address": address, "nif": company.vat or None,
                 "rccm": getattr(company, "company_registry", None) or None,
                 "cnss_employer": settings.cnss_employer_number or None},
        employee_detail={
            "name": emp.name, "matricule": emp.matricule, "job_title": slip.job_title or None,
            "category": dict(slip._fields["category"].selection).get(slip.category) if slip.category else None,
            "contract": slip.contract_type or "",
            "hire_date": emp.hire_date, "seniority_years": emp._seniority(end), "cnss_number": emp.cnss_number or None,
            "payment_method": emp.payment_method,
            "bank_account": emp.bank_account or emp.mobile_money or None,
        },
        period={"date_from": start, "date_to": end, "label": month_label(slip.month)},
        base_salary=slip.base_salary, cnss_base=slip.cnss_base, taxable_base=slip.taxable_base, rts_base=slip.rts_base,
        cnss_employer=slip.cnss_employer, vf=slip.vf, training_tax=slip.training_tax,
        lines=[{"code": line.code, "name": line.name, "kind": line.kind, "base": line.base or None,
                "rate": line.rate or None, "quantity": line.quantity or None, "amount": line.amount}
               for line in slip.line_ids],
        inputs=[{"id": i.id, "rubric": {"id": i.rubric_id.id, "name": i.rubric_id.name, "code": i.rubric_id.code,
                                        "input": i.rubric_id.input, "kind": i.rubric_id.kind},
                 "amount": i.amount, "quantity": i.quantity, "note": i.note or None, "source": i.source}
                for i in slip.input_ids],
        leave_balance=slip.leave_balance, ytd=slip._ytd(), net_in_words=slip._net_in_words(),
    )


class EguitraRhPaie(http.Controller):
    @api_route("/rh/payrolls", profiles=READ)
    def payrolls(self, **kw):
        payrolls = request.env["eguitra.rh.payroll"].search([("company_id", "in", scope(kw).ids)])
        return [_payroll_row(p) for p in payrolls]

    @api_route("/rh/payrolls", methods=("POST",), profiles=WRITE)
    def create_payroll(self, **_kw):
        """Paie du mois. Avec company_id : celle de cette société. Sans : celle de chaque société qui a du
        personnel ce mois-là et pas encore de paie (une paie, une déclaration et une écriture par société)."""
        data = read_json()
        require(data, "month")
        month = date_value(data, "month").replace(day=1)
        Payroll = request.env["eguitra.rh.payroll"]
        if data.get("company_id"):
            payroll = Payroll.prepare(scope({"company_id": data["company_id"]}), month)
            return dict(payroll_detail(payroll), created=[payroll.id])
        start, end = month_bounds(month)
        companies = request.env.companies.sorted(lambda c: c != request.env.company)
        created = Payroll
        for company in companies:
            exists = Payroll.search_count([("company_id", "=", company.id), ("month", "=", month)])
            staff = request.env["eguitra.rh.employee"]._active_in(company, start, end)
            if not exists and staff:
                created |= Payroll.prepare(company, month)
        if not created:
            raise ApiError(422, "business_rule", f"La paie {of_month(month)} est déjà préparée pour chaque "
                                                 "société qui a du personnel ce mois-là.")
        return dict(payroll_detail(created[0]), created=created.ids)

    @api_route("/rh/payrolls/<int:payroll_id>", profiles=READ)
    def payroll(self, payroll_id, **_kw):
        return payroll_detail(get("eguitra.rh.payroll", payroll_id, "Paie"))

    def _action(self, payroll_id, method):
        payroll = get("eguitra.rh.payroll", payroll_id, "Paie")
        getattr(payroll, method)()
        return payroll_detail(payroll)

    @api_route("/rh/payrolls/<int:payroll_id>/compute", methods=("POST",), profiles=WRITE)
    def compute_payroll(self, payroll_id, **_kw):
        return self._action(payroll_id, "action_compute")

    @api_route("/rh/payrolls/<int:payroll_id>/validate", methods=("POST",), profiles=READ)
    def validate_payroll(self, payroll_id, **_kw):
        """Seules la direction et l'administration valident, et jamais un compte qui a préparé la paie
        (contrôles du modèle). La route reste ouverte à la RH pour qu'elle reçoive le refus explicite
        (« La paie est validée par la direction. ») plutôt que le refus générique du profil. Valider est
        le seul droit d'écriture de la direction sur la RH."""
        payroll = get("eguitra.rh.payroll", payroll_id, "Paie")
        payroll.action_validate()
        return payroll_detail(payroll)

    @api_route("/rh/payrolls/<int:payroll_id>/reopen", methods=("POST",), profiles=WRITE)
    def reopen_payroll(self, payroll_id, **_kw):
        return self._action(payroll_id, "action_reopen")

    @api_route("/rh/payrolls/<int:payroll_id>/account", methods=("POST",), profiles=WRITE)
    def account_payroll(self, payroll_id, **_kw):
        return self._action(payroll_id, "action_account")

    @api_route("/rh/payslips/<int:payslip_id>", profiles=READ)
    def payslip(self, payslip_id, **_kw):
        return payslip_detail(get("eguitra.rh.payslip", payslip_id, "Bulletin"))

    @api_route("/rh/payslips/<int:payslip_id>/inputs", methods=("POST",), profiles=WRITE)
    def add_input(self, payslip_id, **_kw):
        slip = get("eguitra.rh.payslip", payslip_id, "Bulletin")
        refuse_own(slip.employee_id)
        slip.payroll_id._check_draft()
        data = read_json()
        require(data, "rubric_id")
        rubric = request.env["eguitra.rh.rubric"].browse(int_or_false(data, "rubric_id")).exists()
        if not rubric or rubric.system:
            raise ApiError(422, "business_rule", "Rubrique inconnue ou produite par le calcul de la paie.")
        amount, quantity = number(data, "amount"), number(data, "quantity")
        if rubric.input == "hours" and quantity <= 0:
            raise ApiError(422, "business_rule", "Indiquez le nombre d'heures.")
        if rubric.input == "amount" and amount <= 0:
            raise ApiError(422, "business_rule", "Indiquez un montant positif.")
        request.env["eguitra.rh.payslip.input"].create({
            "payslip_id": slip.id, "rubric_id": rubric.id, "amount": amount, "quantity": quantity,
            "note": text(data, "note"), "source": "manual",
        })
        slip._compute_slip()
        return payslip_detail(slip)

    @api_route("/rh/payslips/<int:payslip_id>/inputs/<int:input_id>", methods=("DELETE",), profiles=WRITE)
    def delete_input(self, payslip_id, input_id, **_kw):
        slip = get("eguitra.rh.payslip", payslip_id, "Bulletin")
        refuse_own(slip.employee_id)
        slip.payroll_id._check_draft()
        record = slip.input_ids.filtered(lambda i: i.id == input_id)
        if not record:
            raise ApiError(404, "not_found", "Élément introuvable.")
        if record.source != "manual":
            raise ApiError(422, "business_rule", "Cet élément est produit par le calcul : modifiez sa source "
                                                 "(avance, rotations, absences) plutôt que le bulletin.")
        record.unlink()
        slip._compute_slip()
        return payslip_detail(slip)

    # ─── Export ──────────────────────────────────────────────────────────

    @api_route("/rh/payrolls/<int:payroll_id>/export.xlsx", profiles=READ)
    def export(self, payroll_id, **_kw):
        import xlsxwriter

        payroll = get("eguitra.rh.payroll", payroll_id, "Paie")
        settings = request.env["eguitra.rh.settings"]._get(payroll.company_id)
        slips = payroll.payslip_ids.sorted(lambda s: s.employee_id.name)
        out = io.BytesIO()
        book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
        head = book.add_format({"bold": True, "bg_color": "#11221D", "font_color": "#FFFFFF"})
        bold = book.add_format({"bold": True})
        money = book.add_format({"num_format": "#,##0"})
        title = f"{payroll.name}, {payroll.company_id.name}"
        methods = dict(PAYMENT_METHODS)

        def sheet(name, columns, rows, totals=None, widths=None):
            ws = book.add_worksheet(name)
            ws.write_string(0, 0, title, bold)
            xlsx_row(ws, 2, columns, head)
            r = 3
            for row in rows:
                xlsx_row(ws, r, row, money)
                r += 1
            if totals:
                xlsx_row(ws, r, totals, bold)
            ws.set_column(0, 0, 12)
            ws.set_column(1, 1, 32)
            ws.set_column(2, len(columns), 15)
            for col, width in (widths or {}).items():
                ws.set_column(col, col, width)

        keys = ("gross", "cnss_employee", "rts", "deductions", "net", "cnss_employer", "vf", "training_tax",
                "employer_cost")
        sheet("Livre de paie",
              ["Matricule", "Salarié", "Poste", "Jours payés", "Brut", "CNSS salariale", "RTS", "Autres retenues",
               "Net à payer", "CNSS patronale", "VF", settings.training_tax_label or "Taxe de formation",
               "Coût employeur"],
              [[s.employee_id.matricule, s.employee_id.name, s.job_title or "", s.worked_days,
                *[getattr(s, k) for k in keys]] for s in slips],
              ["", "Total", "", "", *[sum(slips.mapped(k)) for k in keys]], {2: 26})
        sheet("Virements",
              ["Matricule", "Salarié", "Mode de paiement", "Banque", "Compte ou numéro", "Net à payer"],
              [[s.employee_id.matricule, s.employee_id.name, methods.get(s.employee_id.payment_method, ""),
                s.employee_id.bank_name or "", s.employee_id.bank_account or s.employee_id.mobile_money or "", s.net]
               for s in slips],
              ["", "Total", "", "", "", sum(slips.mapped("net"))], {3: 20, 4: 30})
        cnss_slips = slips.filtered("cnss_base")
        sheet("CNSS",
              ["Matricule", "Salarié", "Numéro CNSS", "Brut", "Assiette", "Part salariale", "Part patronale", "Total"],
              [[s.employee_id.matricule, s.employee_id.name, s.employee_id.cnss_number or "", s.gross, s.cnss_base,
                s.cnss_employee, s.cnss_employer, s.cnss_employee + s.cnss_employer] for s in cnss_slips],
              ["", "Total", "", sum(cnss_slips.mapped("gross")), sum(cnss_slips.mapped("cnss_base")),
               sum(cnss_slips.mapped("cnss_employee")), sum(cnss_slips.mapped("cnss_employer")),
               sum(cnss_slips.mapped("cnss_employee")) + sum(cnss_slips.mapped("cnss_employer"))], {2: 18})
        sheet("Impôts sur salaires",
              ["Matricule", "Salarié", "Brut imposable", "Base de la RTS", "RTS", "VF",
               settings.training_tax_label or "Taxe de formation"],
              [[s.employee_id.matricule, s.employee_id.name, s.taxable_base, s.rts_base, s.rts, s.vf, s.training_tax]
               for s in slips],
              ["", "Total", sum(slips.mapped("taxable_base")), sum(slips.mapped("rts_base")), sum(slips.mapped("rts")),
               sum(slips.mapped("vf")), sum(slips.mapped("training_tax"))])
        book.close()
        filename = f"paie_{payroll.month:%Y_%m}_{payroll.company_id.name}.xlsx".replace(" ", "_")
        return request.make_response(out.getvalue(), headers=[
            ("Content-Type", XLSX), ("Content-Disposition", content_disposition(filename))])

    # ─── Simulateur ──────────────────────────────────────────────────────

    @api_route("/rh/simulate", methods=("POST",), profiles=READ)
    def simulate(self, **_kw):
        data = read_json()
        settings = request.env["eguitra.rh.settings"]._get(request.env.company)
        params = settings.params()
        contract = data.get("contract_type") or "cdi"
        if contract not in dict(CONTRACTS):
            raise ApiError(400, "invalid_parameter", "Type de contrat inconnu.")
        Rubric = request.env["eguitra.rh.rubric"]
        base_rubric = request.env.ref("eguitra_rh.rubric_base")
        fixed = []
        for line in data.get("fixed_lines") or []:
            rubric = Rubric.browse(int_or_false(line, "rubric_id")).exists()
            if not rubric or rubric.system:
                raise ApiError(422, "business_rule", "Rubrique inconnue ou réservée au calcul de la paie.")
            fixed.append((rubric, number(line, "amount"), number(line, "quantity")))

        def build(base):
            hourly = base / params.monthly_hours if params.monthly_hours else 0.0
            gains = [_sim_item(base_rubric, base, base=base)]
            deductions = []
            for rubric, amount, quantity in fixed:
                if rubric.input == "hours":
                    value = quantity * hourly * (1 + (rubric.overtime_rate or 0.0) / 100.0)
                    item = _sim_item(rubric, value, base=round(hourly), rate=rubric.overtime_rate, quantity=quantity)
                else:
                    item = _sim_item(rubric, amount)
                (gains if rubric.kind == "gain" else deductions).append(item)
            return gains, deductions

        if data.get("net_target") not in (None, ""):
            target = number(data, "net_target")
            if target <= 0:
                raise ApiError(422, "business_rule", "Le net cible est positif.")
            base = base_for_net(params, target, build, contract)
        else:
            base = number(data, "base_salary")
            if base <= 0:
                raise ApiError(422, "business_rule", "Le salaire de base est positif.")
        gains, deductions = build(base)
        result = compute(params, gains, deductions, contract)
        return {
            "base_salary": base, "gross": result["gross"], "cnss_base": result["cnss_base"],
            "cnss_employee": result["cnss_employee"], "cnss_employer": result["cnss_employer"],
            "taxable_base": result["taxable_base"], "rts_base": result["rts_base"], "rts": result["rts"],
            "vf": result["vf"], "training_tax": result["training_tax"], "net": result["net"],
            "employer_cost": result["employer_cost"], "marginal_rate": result["marginal_rate"],
            "lines": result["lines"],
        }


def _sim_item(rubric, amount, base=None, rate=None, quantity=None):
    return Item(code=rubric.code, name=rubric.name, kind=rubric.kind, amount=amount, cnss=rubric.cnss,
                taxable=rubric.taxable, exempt=rubric.exempt_allowance, account_code=rubric.account_code or "",
                base=base, rate=rate, quantity=quantity)

