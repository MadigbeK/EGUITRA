"""Catégories de dépense de la société de travail (voir models/expense_category.py)."""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require

from ..models.expense_category import NATURES
from .common import FIN_READ, FIN_WRITE, account_ref, ref
from .moves import account_of_company


def category_row(category):
    company = category.company_id
    return {
        "id": category.id,
        "sequence": category.sequence,
        "name": category.name,
        "nature": category.nature,
        "nature_label": dict(NATURES)[category.nature],
        "account": account_ref(category.account_id.with_company(company)),
        "partner_account": account_ref(category.partner_account_id.with_company(company)),
        "tax_mode": category.tax_mode,
        "tax": {"id": category.tax_id.id, "name": category.tax_id.name, "amount": category.tax_id.amount} if category.tax_id else None,
        "asset_profile": ref(category.asset_profile_id),
        "active": category.active,
        "entry": category.is_entry(),
    }


def _values(data, company):
    values = {}
    if "name" in data:
        name = str(data.get("name") or "").strip()
        if not name:
            raise ApiError(400, "missing_fields", "Libellé requis.", fields=["name"])
        values["name"] = name[:120]
    if "nature" in data:
        if data["nature"] not in dict(NATURES):
            raise ApiError(400, "invalid_parameter", "Nature de dépense inconnue.")
        values["nature"] = data["nature"]
    if "account_id" in data:
        values["account_id"] = account_of_company(data["account_id"], company, "Compte de charge").id or False
    if "partner_account_id" in data:
        values["partner_account_id"] = account_of_company(data["partner_account_id"], company, "Compte de tiers").id or False
    if "tax_mode" in data:
        if data["tax_mode"] not in ("deductible", "none"):
            raise ApiError(400, "invalid_parameter", "TVA : deductible ou none.")
        values["tax_mode"] = data["tax_mode"]
    if "tax_id" in data:
        values["tax_id"] = int(data["tax_id"]) if data["tax_id"] else False
    if "asset_profile_id" in data:
        values["asset_profile_id"] = int(data["asset_profile_id"]) if data["asset_profile_id"] else False
    if "active" in data:
        values["active"] = bool(data["active"])
    if "sequence" in data:
        values["sequence"] = int_arg(data, "sequence", 10, 0, 10000)
    return values


class EguitraFinanceExpenseCategories(http.Controller):
    @api_route("/finance/expense-categories", profiles=FIN_READ)
    def categories(self, **kw):
        Category = request.env["eguitra.expense.category"].with_context(active_test=kw.get("all") != "1")
        return [category_row(c) for c in Category.search([("company_id", "=", request.env.company.id)])]

    @api_route("/finance/expense-categories", methods=("POST",), profiles=FIN_WRITE)
    def create_category(self, **_kw):
        data = read_json()
        require(data, "name", "nature")
        company = request.env.company
        Category = request.env["eguitra.expense.category"].with_context(active_test=False)
        if Category.search_count([("company_id", "=", company.id), ("name", "=ilike", str(data["name"]).strip())]):
            raise ApiError(409, "conflict", f"La catégorie « {data['name']} » existe déjà.")
        values = _values(data, company)
        values["company_id"] = company.id
        if not values.get("account_id") and values.get("nature") == "capex" and values.get("asset_profile_id"):
            # Investissement : le compte d'immobilisation de la catégorie d'immobilisation.
            profile = request.env["account.asset.profile"].browse(values["asset_profile_id"]).exists()
            values["account_id"] = profile.account_asset_id.id
        if not values.get("account_id"):
            raise ApiError(400, "missing_fields", "Compte de charge ou d'immobilisation requis.", fields=["account_id"])
        return category_row(Category.create(values))

    @api_route("/finance/expense-categories/<int:category_id>", methods=("PATCH",), profiles=FIN_WRITE)
    def update_category(self, category_id, **_kw):
        category = request.env["eguitra.expense.category"].with_context(active_test=False).browse(category_id).exists()
        company = request.env.company
        if not category or category.company_id != company:
            raise ApiError(404, "not_found", "Catégorie introuvable dans la société de travail.")
        category.write(_values(read_json(), company))
        return category_row(category)

    @api_route("/finance/expense-categories/defaults", methods=("POST",), profiles=FIN_WRITE)
    def create_defaults(self, **_kw):
        """Catégories usuelles (charges courantes du plan SYSCOHADA), à revoir avec l'expert-comptable."""
        created = request.env["eguitra.expense.category"].create_defaults(request.env.company)
        return {"created": len(created), "items": [category_row(c) for c in created]}
