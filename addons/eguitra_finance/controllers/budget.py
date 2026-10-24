"""Budget : lignes budgétaires (nature, préfixes de comptes, douze mois, affectation analytique) et
leur exécution ; lignes mensuelles par compte (mis_builder_budget), conservées pour mémoire."""

import csv
import io
import unicodedata

from dateutil.relativedelta import relativedelta

from odoo import http
from odoo.exceptions import UserError, ValidationError
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require
from odoo.addons.eguitra_api.files import XLSX, XLSX_OPTIONS, workbook_rows, xlsx_row

from ..models.analytic import ACTIVITY_PLAN, COST_CENTER_PLAN
from ..models.budget import MONTH_FIELDS, NATURES
from ..models.finance_metrics import ACC_CODE
from .common import FIN_READ, FIN_WRITE, as_float, today
from .treasury import _number

MONTH_NAMES = ("janv", "fev", "mars", "avr", "mai", "juin", "juil", "aout", "sept", "oct", "nov", "dec")
MAX_IMPORT = 5 * 1024 * 1024
IMPORT_HEADERS = ["nature", "ligne", "comptes", "residuel", "activite", "centre_cout"] + list(MONTH_NAMES)


def _budget(budget_id, write=False):
    budget = request.env["mis.budget.by.account"].browse(budget_id).exists()
    company = request.env.company
    if not budget or (budget.company_id and budget.company_id not in request.env.user.company_ids):
        raise ApiError(404, "not_found", "Budget introuvable.")
    if write and budget.company_id and budget.company_id != company:
        raise ApiError(422, "business_rule", "Ce budget appartient à l'autre société : choisissez-la comme société de travail.")
    return budget


def _budget_line(line_id):
    line = request.env["eguitra.budget.line"].browse(line_id).exists()
    if not line:
        raise ApiError(404, "not_found", "Ligne budgétaire introuvable.")
    _budget(line.budget_id.id, write=True)
    return line


def _plain(text):
    """Texte comparable : minuscules, sans accents ni espaces superflus."""
    text = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode()
    return " ".join(text.lower().replace("_", " ").split())


def _month_of(header):
    h = _plain(header).replace("mois", "").strip().lstrip("m").strip()
    if h.isdigit() and 1 <= int(h) <= 12:
        return int(h)
    h = _plain(header)
    for index, name in enumerate(MONTH_NAMES, start=1):
        if h.startswith(name[:4] if name.startswith("jui") else name[:3]):
            return index
    return None


def _nature_of(value):
    v = _plain(value)
    if v.startswith(("prod", "rec", "income", "vente")):
        return "income"
    if v.startswith(("charg", "dep", "expense")):
        return "expense"
    if v.startswith(("inv", "capex", "immo")):
        return "capex"
    return None


def _analytic(value, xmlid, company):
    """Compte d'activité ou de centre de coût désigné par son nom ou son code."""
    if value in (None, ""):
        return request.env["account.analytic.account"]
    plan = request.env.ref(xmlid)
    text = str(int(value)) if isinstance(value, float) and value.is_integer() else str(value).strip()
    return request.env["account.analytic.account"].search([
        ("plan_id", "child_of", plan.id), ("company_id", "in", [False, company.id]),
        "|", ("name", "=ilike", text), ("code", "=ilike", text),
    ], limit=1)


def _line_values(data):
    """Champs d'une ligne budgétaire reçus de l'écran (montants mensuels : months, liste de 12)."""
    values = {}
    if "nature" in data:
        if data["nature"] not in dict(NATURES):
            raise ApiError(400, "invalid_parameter", "Nature inconnue (income, expense, capex).")
        values["nature"] = data["nature"]
    if "name" in data:
        name = str(data.get("name") or "").strip()
        if not name:
            raise ApiError(400, "missing_fields", "Libellé de la ligne requis.", fields=["name"])
        values["name"] = name[:120]
    if "account_prefixes" in data:
        values["account_prefixes"] = ", ".join(p.strip() for p in str(data.get("account_prefixes") or "").replace(";", ",").split(",") if p.strip()) or False
    if "residual" in data:
        values["residual"] = bool(data["residual"])
    # Axe et société du compte analytique : contrôlés par la ligne budgétaire elle-même (contrainte).
    for key in ("activity_id", "cost_center_id"):
        if key in data:
            record = request.env["account.analytic.account"].browse(int(data[key])).exists() if data[key] else None
            if data[key] and not record:
                raise ApiError(404, "not_found", "Compte analytique introuvable.")
            values[key] = record.id if record else False
    if "months" in data:
        months = data["months"]
        if not isinstance(months, list) or len(months) != 12:
            raise ApiError(400, "invalid_parameter", "Douze montants mensuels attendus.")
        for field, amount in zip(MONTH_FIELDS, months, strict=True):
            values[field] = as_float(amount or 0, "months")
    if "sequence" in data:
        values["sequence"] = int_arg(data, "sequence", 10, 0, 10000)
    return values


def _line_row(line):
    return {
        "id": line.id, "sequence": line.sequence, "nature": line.nature, "name": line.name,
        "account_prefixes": line.account_prefixes or None, "residual": line.residual,
        "activity": {"id": line.activity_id.id, "name": line.activity_id.name} if line.activity_id else None,
        "cost_center": {"id": line.cost_center_id.id, "name": line.cost_center_id.name} if line.cost_center_id else None,
        "months": [line[f] for f in MONTH_FIELDS], "annual": line.amount_total,
    }


def _rows_of(name, content):
    if name.lower().endswith((".xlsx", ".xlsm")):
        return workbook_rows(content)
    text = content.decode("utf-8-sig", errors="replace")
    dialect = csv.Sniffer().sniff(text[:4096], delimiters=";,\t") if text else csv.excel
    return list(csv.reader(io.StringIO(text), dialect))


class EguitraFinanceBudget(http.Controller):
    @api_route("/finance/budgets", profiles=FIN_READ)
    def list_budgets(self, **_kw):
        budgets = request.env["mis.budget.by.account"].search(
            [("company_id", "in", [False, request.env.company.id])], order="date_from desc"
        )
        return [{"id": b.id, "name": b.name, "date_from": b.date_from, "date_to": b.date_to, "state": b.state,
                 "lines": len(b.item_ids), "budget_lines": len(b.eguitra_line_ids),
                 "underrun_pct": b.eguitra_underrun_pct} for b in budgets]

    @api_route("/finance/budgets/<int:budget_id>", methods=("PATCH",), profiles=FIN_WRITE)
    def update_budget(self, budget_id, **_kw):
        """Nom du budget et sous-réalisation tolérée des produits (%)."""
        budget = _budget(budget_id, write=True)
        data = read_json()
        values = {}
        if data.get("name"):
            values["name"] = str(data["name"]).strip()[:120]
        if "underrun_pct" in data:
            values["eguitra_underrun_pct"] = max(0.0, as_float(data["underrun_pct"], "underrun_pct"))
        budget.write(values)
        return {"id": budget.id, "name": budget.name, "underrun_pct": budget.eguitra_underrun_pct}

    # ─── Lignes budgétaires ───────────────────────────────────────────────

    @api_route("/finance/budgets/<int:budget_id>/budget-lines", profiles=FIN_READ)
    def budget_lines(self, budget_id, **_kw):
        budget = _budget(budget_id)
        return {"budget": {"id": budget.id, "name": budget.name, "year": budget.date_from.year},
                "lines": [_line_row(line) for line in budget.eguitra_line_ids]}

    @api_route("/finance/budgets/<int:budget_id>/budget-lines", methods=("POST",), profiles=FIN_WRITE)
    def create_budget_line(self, budget_id, **_kw):
        budget = _budget(budget_id, write=True)
        data = read_json()
        require(data, "nature", "name")
        values = _line_values(data)
        values["budget_id"] = budget.id
        return _line_row(request.env["eguitra.budget.line"].create(values))

    @api_route("/finance/budget-lines/<int:line_id>", methods=("PATCH",), profiles=FIN_WRITE)
    def update_budget_line(self, line_id, **_kw):
        line = _budget_line(line_id)
        line.write(_line_values(read_json()))
        return _line_row(line)

    @api_route("/finance/budget-lines/<int:line_id>", methods=("DELETE",), profiles=FIN_WRITE)
    def delete_budget_line(self, line_id, **_kw):
        _budget_line(line_id).unlink()
        return {"status": "ok"}

    @api_route("/finance/budgets/<int:budget_id>/execution", profiles=FIN_READ)
    def execution(self, budget_id, **kw):
        """Budget cumulé et réalisé à fin de mois (month=1..12), par ligne budgétaire, avec les statuts et
        la synthèse ; axis=activite ou centre_cout pour la comparaison par axe analytique."""
        budget = _budget(budget_id)
        month = int_arg(kw, "month", today().month if today().year == budget.date_from.year else 12, 1, 12)
        axis = kw.get("axis") if kw.get("axis") in ("activite", "centre_cout") else None
        return request.env["eguitra.budget.line"].execution(budget, month, axis)

    @api_route("/finance/budgets/<int:budget_id>/import", methods=("POST",), profiles=FIN_WRITE)
    def import_budget(self, budget_id, **_kw):
        """Import des lignes budgétaires depuis un classeur XLSX ou CSV : nature, ligne, comptes,
        residuel, activite, centre_cout, puis un montant par mois (janv à dec, ou 1 à 12). Une ligne de
        même nature, libellé et affectation est mise à jour ; replace=1 remplace toutes les lignes. Rien
        n'est enregistré si une ligne est en erreur."""
        budget = _budget(budget_id, write=True)
        upload = request.httprequest.files.get("file")
        if not upload:
            raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
        content = upload.read(MAX_IMPORT + 1)
        if len(content) > MAX_IMPORT:
            raise ApiError(413, "too_large", "Fichier trop volumineux (5 Mo maximum).")
        rows = [r for r in _rows_of(upload.filename or "budget.csv", content) if any(c not in (None, "") for c in r)]
        if not rows:
            raise ApiError(422, "business_rule", "Fichier vide.")
        headers = [_plain(h) for h in rows[0]]
        index = {}
        for i, header in enumerate(headers):
            key = {"nature": "nature", "ligne": "name", "ligne budgetaire": "name", "libelle": "name",
                   "comptes": "prefixes", "compte": "prefixes", "prefixes": "prefixes", "residuel": "residual",
                   "solde residuel": "residual", "activite": "activity", "centre cout": "cost_center",
                   "centre de cout": "cost_center"}.get(header)
            month = None if key else _month_of(header)
            if key:
                index.setdefault(key, i)
            elif month:
                index.setdefault(month, i)
        missing = [label for key, label in (("nature", "nature"), ("name", "ligne")) if key not in index]
        if missing or not any(m in index for m in range(1, 13)):
            raise ApiError(422, "business_rule", "Colonnes attendues : nature, ligne, comptes, residuel, activite, "
                                                 "centre_cout, puis un montant par mois (janv à dec).")
        company = budget.company_id or request.env.company

        def cell(row, key):
            i = index.get(key)
            return row[i] if i is not None and i < len(row) else None

        errors, parsed = [], []
        for number, row in enumerate(rows[1:], start=2):
            nature = _nature_of(cell(row, "nature"))
            name = str(cell(row, "name") or "").strip()
            if not nature or not name:
                errors.append(f"Ligne {number} : nature (produits, charges, investissements) et libellé requis.")
                continue
            values = {"nature": nature, "name": name[:120],
                      "account_prefixes": str(cell(row, "prefixes") or "").replace(";", ",").strip() or False,
                      "residual": _plain(cell(row, "residual")) in ("oui", "o", "x", "1", "vrai", "yes")}
            for key, field, xmlid, label in (("activity", "activity_id", ACTIVITY_PLAN, "activité"),
                                             ("cost_center", "cost_center_id", COST_CENTER_PLAN, "centre de coût")):
                value = cell(row, key)
                record = _analytic(value, xmlid, company) if value not in (None, "") else None
                if value not in (None, "") and not record:
                    errors.append(f"Ligne {number} : {label} « {value} » inconnu(e) dans la société.")
                values[field] = record.id if record else False
            try:
                for month in range(1, 13):
                    values[MONTH_FIELDS[month - 1]] = _number(cell(row, month))
            except ValueError:
                errors.append(f"Ligne {number} : montant illisible.")
                continue
            parsed.append((number, values))
        if errors:
            raise ApiError(422, "business_rule", f"{len(errors)} anomalie(s) : rien n'est enregistré.", errors=errors[:50])
        Line = request.env["eguitra.budget.line"]
        if request.httprequest.form.get("replace") == "1":
            budget.eguitra_line_ids.unlink()
        created = updated = 0
        for number, values in parsed:
            existing = Line.search([("budget_id", "=", budget.id), ("nature", "=", values["nature"]),
                                    ("name", "=ilike", values["name"]), ("activity_id", "=", values["activity_id"]),
                                    ("cost_center_id", "=", values["cost_center_id"])], limit=1)
            try:
                with request.env.cr.savepoint():
                    if existing:
                        existing.write(values)
                        updated += 1
                    else:
                        Line.create(dict(values, budget_id=budget.id, sequence=number * 10))
                        created += 1
            except (UserError, ValidationError) as e:  # contrainte d'une ligne : rattachée à sa ligne du fichier
                errors.append(f"Ligne {number} : {e.args[0] if e.args else e}")
        if errors:
            raise ApiError(422, "business_rule", f"{len(errors)} anomalie(s) : rien n'est enregistré.", errors=errors[:50])
        return {"created": created, "updated": updated, "lines": len(budget.eguitra_line_ids)}

    @api_route("/finance/budgets/<int:budget_id>/export", profiles=FIN_READ)
    def export_budget(self, budget_id, **_kw):
        """Lignes budgétaires au format de l'import (sert aussi de modèle à remplir)."""
        import xlsxwriter

        budget = _budget(budget_id)
        out = io.BytesIO()
        book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
        sheet = book.add_worksheet("Budget")
        head = book.add_format({"bold": True, "bg_color": "#10133A", "font_color": "#FFFFFF"})
        money = book.add_format({"num_format": "#,##0"})
        xlsx_row(sheet, 0, IMPORT_HEADERS, head)
        labels = dict(NATURES)
        for r, line in enumerate(budget.eguitra_line_ids, start=1):
            xlsx_row(sheet, r, [labels[line.nature], line.name, line.account_prefixes or "", "oui" if line.residual else "",
                                line.activity_id.name or "", line.cost_center_id.name or ""])
            for m, field in enumerate(MONTH_FIELDS):
                sheet.write_number(r, 6 + m, line[field], money)
        sheet.freeze_panes(1, 2)
        sheet.set_column(0, 0, 16)
        sheet.set_column(1, 1, 34)
        sheet.set_column(2, 5, 18)
        sheet.set_column(6, 17, 14)
        book.close()
        name = f"budget_{budget.date_from.year}_{(budget.name or 'budget').replace(' ', '_')}.xlsx"
        return request.make_response(out.getvalue(), headers=[
            ("Content-Type", XLSX), ("Content-Disposition", content_disposition(name)), ("Cache-Control", "no-store"),
        ])

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
        budget = _budget(budget_id, write=True)
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
