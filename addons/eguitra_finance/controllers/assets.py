"""Immobilisations et amortissements (module account_asset_management) : registre, catégories,
plans d'amortissement à dotations mensuelles, reprise des biens déjà en service, sorties d'actif."""

import csv
import io

from dateutil.relativedelta import relativedelta

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require
from odoo.addons.eguitra_api.files import XLSX_OPTIONS, csv_text, xlsx_row

from ..models.account_asset import PERIOD_LABELS
from .common import FIN_READ, FIN_WRITE, as_float, parse_date, today

PERIODS = ("month", "quarter", "year")
STATES = {"draft": "Brouillon", "open": "En service", "close": "Totalement amorti", "removed": "Sorti de l'actif"}


def _asset(asset_id):
    asset = request.env["account.asset"].browse(asset_id).exists()
    if not asset:
        raise ApiError(404, "not_found", "Immobilisation introuvable.")
    return asset


def _activity(asset):
    """Activité analytique du bien (axe Activité de sa répartition)."""
    plan = request.env.ref("eguitra_base.analytic_plan_activite", raise_if_not_found=False)
    ids = [int(i) for key in (asset.analytic_distribution or {}) for i in str(key).split(",") if i]
    accounts = request.env["account.analytic.account"].sudo().browse(ids).exists()
    account = accounts.filtered(lambda a: plan and a.plan_id == plan)[:1]
    return {"id": account.id, "name": account.name} if account else None


def _row(asset, board=False):
    data = {
        "id": asset.id,
        "name": asset.name,
        "code": asset.code or None,
        "profile": {"id": asset.profile_id.id, "name": asset.profile_id.name},
        "account_asset": asset.profile_id.account_asset_id.code,
        "purchase_value": asset.purchase_value,
        "salvage_value": asset.salvage_value,
        "depreciated": asset.value_depreciated,
        "residual": asset.value_residual,
        "date_start": asset.date_start,
        "method": asset.method,
        "method_number": asset.method_number,
        "method_period": asset.method_period,
        "prorata": asset.prorata,
        "non_depreciable": asset.eguitra_non_depreciable,
        "months_depreciated": asset.eguitra_months_depreciated,
        "months_total": asset.eguitra_months_total,
        "state": asset.state,
        "partner": asset.partner_id.name or None,
        "activity": _activity(asset),
        "location": asset.eguitra_location or None,
        "custodian": asset.eguitra_custodian or None,
        "takeover_date": asset.eguitra_takeover_date or None,
        "takeover_amount": asset.eguitra_takeover_amount if asset.eguitra_takeover_date else None,
    }
    if board:
        data["board"] = [
            {"id": line.id, "date": line.line_date, "type": line.type, "amount": line.amount,
             "depreciated": line.depreciated_value, "remaining": line.remaining_value, "posted": line.move_check,
             "takeover": line.init_entry}
            for line in asset.depreciation_line_ids.sorted("line_date")
        ]
    return data


def _opening_date(data):
    """Date d'ouverture de la reprise : début de l'exercice en cours, sauf date fournie."""
    company = request.env.company
    default = request.env["eguitra.finance.metrics"].fiscal_year_bounds(company, today())[0]
    return parse_date(data, "opening_date", default)


def _analytic_values(data):
    values = {}
    if "activity_id" in data:
        activity_id = data.get("activity_id")
        if activity_id:
            account = request.env["account.analytic.account"].browse(int(activity_id)).exists()
            if not account:
                raise ApiError(422, "business_rule", "Activité analytique inconnue.")
            values["analytic_distribution"] = {str(account.id): 100}
        else:
            values["analytic_distribution"] = False
    for key, field in (("location", "eguitra_location"), ("custodian", "eguitra_custodian")):
        if key in data:
            values[field] = (str(data[key] or "").strip()[:200]) or False
    return values


class EguitraFinanceAssets(http.Controller):
    @api_route("/finance/assets", profiles=FIN_READ)
    def list_assets(self, **kw):
        domain = [("company_id", "=", request.env.company.id)]
        if kw.get("state"):
            domain.append(("state", "in", kw["state"].split(",")))
        assets = request.env["account.asset"].search(domain, order="date_start desc, id desc")
        rows = [_row(a) for a in assets]
        return {
            "items": rows,
            "totals": {
                "purchase_value": sum(r["purchase_value"] for r in rows),
                "depreciated": sum(r["depreciated"] for r in rows),
                "residual": sum(r["residual"] for r in rows),
            },
        }

    @api_route("/finance/assets/<int:asset_id>", profiles=FIN_READ)
    def get_asset(self, asset_id, **_kw):
        return _row(_asset(asset_id), board=True)

    @api_route("/finance/assets/<int:asset_id>", methods=("PATCH",), profiles=FIN_WRITE)
    def update_asset(self, asset_id, **_kw):
        """Activité analytique (ventilation des dotations à venir), localisation, responsable."""
        asset = _asset(asset_id)
        data = read_json()
        values = _analytic_values(data)
        if "name" in data and data["name"]:
            values["name"] = str(data["name"])[:200]
        asset.write(values)
        return _row(asset, board=True)

    @api_route("/finance/assets/profiles", profiles=FIN_READ)
    def profiles(self, **_kw):
        profiles = request.env["account.asset.profile"].search([("company_id", "=", request.env.company.id)])
        return [
            {"id": p.id, "name": p.name, "method": p.method, "method_number": p.method_number,
             "method_period": p.method_period, "period_label": PERIOD_LABELS.get(p.method_period, p.method_period),
             "prorata": p.prorata, "non_depreciable": p.eguitra_non_depreciable,
             "account_asset": p.account_asset_id.code, "account_depreciation": p.account_depreciation_id.code,
             "account_expense": p.account_expense_depreciation_id.code}
            for p in profiles
        ]

    @api_route("/finance/assets/profiles", methods=("POST",), profiles=("admin", "finance"))
    def create_profile(self, **_kw):
        """Catégorie d'immobilisation : comptes, durée en années, dotations mensuelles par défaut
        (prorata à partir de la mise en service, comme le veut le SYSCOHADA). Une catégorie non
        amortissable (terrains) n'a pas de plan."""
        data = read_json()
        non_depreciable = bool(data.get("non_depreciable"))
        name, asset_acc, dep_acc, exp_acc, journal_id = require(
            data, "name", "account_asset_id", "account_depreciation_id", "account_expense_depreciation_id", "journal_id",
        )
        period = data.get("method_period") or "month"
        if period not in PERIODS:
            raise ApiError(400, "invalid_parameter", "Périodicité des dotations inconnue (month, quarter ou year).")
        try:
            number = int(data.get("method_number") or (1 if non_depreciable else 0))
        except (TypeError, ValueError) as e:
            raise ApiError(400, "invalid_parameter", "Durée invalide.") from e
        if number < 1:
            raise ApiError(400, "missing_fields", "Durée d'amortissement requise (en années).", fields=["method_number"])
        profile = request.env["account.asset.profile"].create({
            "name": name,
            "account_asset_id": int(asset_acc),
            "account_depreciation_id": int(dep_acc),
            "account_expense_depreciation_id": int(exp_acc),
            "journal_id": int(journal_id),
            "method": data.get("method", "linear"),
            "method_number": number,
            "method_time": "year",
            "method_period": period,
            "prorata": data.get("prorata", True) is not False,
            "eguitra_non_depreciable": non_depreciable,
            "company_id": request.env.company.id,
        })
        return {"id": profile.id, "name": profile.name, "method_period": profile.method_period}

    @api_route("/finance/assets", methods=("POST",), profiles=FIN_WRITE)
    def create_asset(self, **_kw):
        """Nouvelle immobilisation. Mise en service avant la date d'ouverture (début de l'exercice) :
        reprise d'un bien déjà en service, avec le cumul des amortissements de l'ancien système à la
        veille (accumulated_depreciation) ; les dotations antérieures deviennent des lignes de reprise
        sans écriture."""
        data = read_json()
        name, profile_id, value = require(data, "name", "profile_id", "purchase_value")
        company = request.env.company
        profile = request.env["account.asset.profile"].browse(int(profile_id)).exists()
        if not profile or profile.company_id != company:
            raise ApiError(422, "business_rule", "Catégorie d'immobilisation inconnue dans cette société.")
        date_start = parse_date(data, "date_start", today())
        opening = _opening_date(data)
        accumulated = data.get("accumulated_depreciation")
        if date_start < opening and accumulated in (None, ""):
            raise ApiError(422, "business_rule",
                           f"Mise en service avant le {opening:%d/%m/%Y} : indiquez le cumul des amortissements au "
                           f"{opening - relativedelta(days=1):%d/%m/%Y} (reprise d'un bien déjà en service).",
                           fields=["accumulated_depreciation"])
        values = {
            "name": name,
            "profile_id": profile.id,
            "purchase_value": as_float(value, "purchase_value"),
            "date_start": date_start,
            "company_id": company.id,
        }
        if values["purchase_value"] <= 0:
            raise ApiError(422, "business_rule", "La valeur d'acquisition doit être positive.")
        if data.get("code"):
            values["code"] = str(data["code"])[:32]
        if data.get("partner_id"):
            values["partner_id"] = int(data["partner_id"])
        if data.get("salvage_value"):
            values["salvage_value"] = as_float(data["salvage_value"], "salvage_value")
        if data.get("method_number"):
            values["method_number"] = max(1, int(as_float(data["method_number"], "method_number")))
        if data.get("method_period"):
            if data["method_period"] not in PERIODS:
                raise ApiError(400, "invalid_parameter", "Périodicité des dotations inconnue (month, quarter ou year).")
            values["method_period"] = data["method_period"]
        values.update(_analytic_values(data))
        asset = request.env["account.asset"].create(values)
        asset.compute_depreciation_board()
        takeover = None
        if date_start < opening:
            takeover = asset.eguitra_takeover(opening, as_float(accumulated or 0, "accumulated_depreciation"))
        if data.get("confirm"):
            asset.validate()
        return dict(_row(asset, board=True), takeover_result=takeover)

    @api_route("/finance/assets/<int:asset_id>/confirm", methods=("POST",), profiles=FIN_WRITE)
    def confirm(self, asset_id, **_kw):
        asset = _asset(asset_id)
        asset.compute_depreciation_board()
        asset.validate()
        return _row(asset, board=True)

    @api_route("/finance/assets/<int:asset_id>/dispose", methods=("POST",), profiles=FIN_WRITE)
    def dispose(self, asset_id, **_kw):
        """Sortie de l'actif (mise au rebut ou cession), écritures SYSCOHADA 28/2x, 81x et, en cas
        de vente, 485x/82x."""
        asset = _asset(asset_id)
        data = read_json()
        partner = None
        if data.get("partner_id"):
            partner = request.env["res.partner"].browse(int(data["partner_id"])).exists()
            if not partner:
                raise ApiError(422, "business_rule", "Acquéreur inconnu.")
        sale = asset.eguitra_dispose(parse_date(data, "date", today()), as_float(data.get("sale_value") or 0, "sale_value"),
                                     partner, data.get("note"))
        return dict(_row(asset, board=True), sale_move={"id": sale.id, "name": sale.name} if sale else None)

    @api_route("/finance/assets/depreciate", methods=("POST",), profiles=FIN_WRITE)
    def depreciate(self, **_kw):
        """Comptabilise les dotations aux amortissements jusqu'à la date donnée."""
        end = parse_date(read_json(), "date", today())
        assets = request.env["account.asset"].search([
            ("company_id", "=", request.env.company.id), ("state", "=", "open"),
        ])
        created = assets._compute_entries(end, check_triggers=True)
        return {"status": "ok", "entries": len(created) if hasattr(created, "__len__") else None, "date": end}

    @api_route("/finance/assets/takeover-control", profiles=FIN_READ)
    def takeover_control(self, **kw):
        """Reprise : cumul du registre = solde d'ouverture des 28x, valeur brute = solde des 2x."""
        return request.env["account.asset"].eguitra_takeover_control(request.env.company, _opening_date(kw))

    @api_route("/finance/assets/export", profiles=FIN_READ)
    def export_register(self, **kw):
        """Registre des immobilisations : valeur, durée, mois amortis, cumul, VNC (CSV ou XLSX)."""
        company = request.env.company
        assets = request.env["account.asset"].search([("company_id", "=", company.id), ("state", "!=", "draft")],
                                                     order="code, name, id")
        headers = ["Code", "Désignation", "Catégorie", "Compte", "Mise en service", "Valeur brute", "Durée (ans)",
                   "Dotations", "Mois amortis", "Durée (mois)", "Amortissements cumulés", "Valeur nette comptable",
                   "État", "Activité", "Localisation", "Responsable", "Cumul repris", "Reprise au"]
        rows = []
        for asset in assets:
            activity = _activity(asset)
            rows.append([
                asset.code or "", asset.name, asset.profile_id.name, asset.profile_id.account_asset_id.code or "",
                asset.date_start, asset.purchase_value,
                0 if asset.eguitra_non_depreciable else asset.method_number,
                "non amortissable" if asset.eguitra_non_depreciable else PERIOD_LABELS.get(asset.method_period, ""),
                asset.eguitra_months_depreciated, asset.eguitra_months_total, asset.value_depreciated, asset.value_residual,
                STATES.get(asset.state, asset.state), activity["name"] if activity else "", asset.eguitra_location or "",
                asset.eguitra_custodian or "", asset.eguitra_takeover_amount if asset.eguitra_takeover_date else None,
                asset.eguitra_takeover_date or None,
            ])
        totals = ["TOTAL", "", "", "", None, sum(r[5] for r in rows), None, "", None, None, sum(r[10] for r in rows),
                  sum(r[11] for r in rows), "", "", "", "", None, None]
        stamp = today()
        name = f"registre_immobilisations_{stamp:%Y%m%d}"
        if kw.get("format") == "csv":
            buf = io.StringIO()
            buf.write("﻿")
            writer = csv.writer(buf, delimiter=";")
            writer.writerow(headers)
            for row in rows + [totals]:
                writer.writerow([
                    "" if v is None else v.strftime("%d/%m/%Y") if hasattr(v, "strftime")
                    else f"{v:.0f}" if isinstance(v, float) else v if isinstance(v, int) else csv_text(v)
                    for v in row
                ])
            content, mime, ext = buf.getvalue().encode("utf-8"), "text/csv; charset=utf-8", "csv"
        else:
            import xlsxwriter

            out = io.BytesIO()
            book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
            sheet = book.add_worksheet("Registre")
            bold = book.add_format({"bold": True})
            head = book.add_format({"bold": True, "bg_color": "#10133A", "font_color": "#FFFFFF", "border": 1})
            money = book.add_format({"num_format": "# ##0"})
            day = book.add_format({"num_format": "dd/mm/yyyy"})
            total = book.add_format({"bold": True, "num_format": "# ##0", "top": 2})
            xlsx_row(sheet, 0, ["Registre des immobilisations", company.name], bold)
            xlsx_row(sheet, 1, ["Exporté le", fields.Datetime.now().strftime("%d/%m/%Y %H:%M")])
            xlsx_row(sheet, 3, headers, head)
            for r, row in enumerate(rows + [totals], start=4):
                is_total = r == len(rows) + 4
                for c, value in enumerate(row):
                    if hasattr(value, "strftime"):
                        sheet.write_datetime(r, c, fields.Datetime.to_datetime(value), day)
                    elif isinstance(value, (int, float)):
                        sheet.write_number(r, c, value, total if is_total else money)
                    else:
                        xlsx_row(sheet, r, [value], bold if is_total else None, col=c)
            sheet.freeze_panes(4, 2)
            sheet.set_column(0, 0, 12)
            sheet.set_column(1, 2, 32)
            sheet.set_column(3, 17, 15)
            book.close()
            content, mime, ext = out.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
        return request.make_response(content, headers=[
            ("Content-Type", mime), ("Content-Disposition", f'attachment; filename="{name}.{ext}"'),
            ("Cache-Control", "no-store"),
        ])
