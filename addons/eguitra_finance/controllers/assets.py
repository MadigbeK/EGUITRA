"""Immobilisations et amortissements (module account_asset_management)."""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require

from .common import FIN_READ, FIN_WRITE, as_float, parse_date, today


def _asset(asset_id):
    asset = request.env["account.asset"].browse(asset_id).exists()
    if not asset:
        raise ApiError(404, "not_found", "Immobilisation introuvable.")
    return asset


def _row(asset, board=False):
    data = {
        "id": asset.id,
        "name": asset.name,
        "code": asset.code or None,
        "profile": {"id": asset.profile_id.id, "name": asset.profile_id.name},
        "purchase_value": asset.purchase_value,
        "salvage_value": asset.salvage_value,
        "depreciated": asset.value_depreciated,
        "residual": asset.value_residual,
        "date_start": asset.date_start,
        "method": asset.method,
        "method_number": asset.method_number,
        "method_period": asset.method_period,
        "state": asset.state,
        "partner": asset.partner_id.name or None,
    }
    if board:
        data["board"] = [
            {"id": l.id, "date": l.line_date, "type": l.type, "amount": l.amount,
             "depreciated": l.depreciated_value, "remaining": l.remaining_value, "posted": l.move_check}
            for l in asset.depreciation_line_ids.sorted("line_date")
        ]
    return data


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

    @api_route("/finance/assets/profiles", profiles=FIN_READ)
    def profiles(self, **_kw):
        profiles = request.env["account.asset.profile"].search([("company_id", "=", request.env.company.id)])
        return [
            {"id": p.id, "name": p.name, "method": p.method, "method_number": p.method_number,
             "method_period": p.method_period, "account_asset": p.account_asset_id.code,
             "account_depreciation": p.account_depreciation_id.code,
             "account_expense": p.account_expense_depreciation_id.code}
            for p in profiles
        ]

    @api_route("/finance/assets/profiles", methods=("POST",), profiles=("admin", "finance"))
    def create_profile(self, **_kw):
        data = read_json()
        name, asset_acc, dep_acc, exp_acc, journal_id, number = require(
            data, "name", "account_asset_id", "account_depreciation_id", "account_expense_depreciation_id",
            "journal_id", "method_number",
        )
        profile = request.env["account.asset.profile"].create({
            "name": name,
            "account_asset_id": int(asset_acc),
            "account_depreciation_id": int(dep_acc),
            "account_expense_depreciation_id": int(exp_acc),
            "journal_id": int(journal_id),
            "method": data.get("method", "linear"),
            "method_number": int(number),
            "method_period": data.get("method_period", "year"),
            "company_id": request.env.company.id,
        })
        return {"id": profile.id, "name": profile.name}

    @api_route("/finance/assets", methods=("POST",), profiles=FIN_WRITE)
    def create_asset(self, **_kw):
        data = read_json()
        name, profile_id, value = require(data, "name", "profile_id", "purchase_value")
        values = {
            "name": name,
            "profile_id": int(profile_id),
            "purchase_value": as_float(value, "purchase_value"),
            "date_start": parse_date(data, "date_start", today()),
            "company_id": request.env.company.id,
        }
        if data.get("code"):
            values["code"] = data["code"]
        if data.get("partner_id"):
            values["partner_id"] = int(data["partner_id"])
        if data.get("salvage_value"):
            values["salvage_value"] = as_float(data["salvage_value"], "salvage_value")
        asset = request.env["account.asset"].create(values)
        asset.compute_depreciation_board()
        if data.get("confirm"):
            asset.validate()
        return _row(asset, board=True)

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
