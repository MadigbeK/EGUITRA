"""Plan de comptes tenu par la finance (prototype de la direction : « tout compte utilisé ailleurs doit
exister ici ») : création d'un compte sous une racine existante, nature déduite du compte voisin,
désactivation plutôt que suppression, imputation analytique obligatoire."""

import re

from odoo import Command, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require

from ..models.analytic import ACTIVITY_PLAN
from .analytic_rules import set_requirement
from .common import FIN_WRITE
from .moves import mandatory_prefixes

CODE = re.compile(r"^\d{4,12}$")
# Natures imposées par la classe SYSCOHADA, quel que soit le compte voisin.
CLASS_RULES = (
    ("40", "liability_payable", True),
    ("41", "asset_receivable", True),
    ("52", "asset_cash", False),  # banques
    ("57", "asset_cash", False),  # caisses
)
LETTERED_PREFIXES = ("585",)  # compte de passage des virements internes : lettrable


def _row(account, company):
    account = account.with_company(company)
    return {"id": account.id, "code": account.code, "name": account.name, "type": account.account_type,
            "reconcile": account.reconcile, "active": account.active,
            "analytic_required": bool(account.code) and account.code.startswith(mandatory_prefixes(company))}


def _account(account_id, company):
    account = request.env["account.account"].with_context(active_test=False).browse(account_id).exists()
    if not account or company not in account.company_ids:
        raise ApiError(404, "not_found", "Compte introuvable dans le plan de la société de travail.")
    return account


def _sibling(code, company):
    """Compte existant de même racine (au moins trois chiffres communs), le plus proche."""
    Account = request.env["account.account"].with_context(active_test=False)
    for size in range(len(code) - 1, 2, -1):
        sibling = Account.search([("code", "=like", code[:size] + "%"), ("company_ids", "in", company.ids)],
                                 order="code", limit=1)
        if sibling:
            return sibling
    return Account


class EguitraFinanceChart(http.Controller):
    @api_route("/finance/accounts", methods=("POST",), profiles=FIN_WRITE)
    def create_account(self, **_kw):
        """Nouveau compte : code sous une racine existante du plan SYSCOHADA, nature et lettrage repris du
        compte voisin (fournisseurs 40 et clients 41 toujours lettrables)."""
        data = read_json()
        code, name = require(data, "code", "name")
        code = re.sub(r"\s", "", str(code))
        if not CODE.match(code):
            raise ApiError(400, "invalid_parameter", "Le code d'un compte comporte de 4 à 12 chiffres.")
        company = request.env.company
        Account = request.env["account.account"].with_context(active_test=False).with_company(company)
        if Account.search_count([("code", "=", code), ("company_ids", "in", company.ids)]):
            raise ApiError(409, "conflict", f"Le compte {code} existe déjà dans le plan de la société.")
        sibling = _sibling(code, company)
        if not sibling:
            raise ApiError(422, "business_rule", f"Le compte {code} doit se rattacher à une racine existante du plan "
                                                 f"(comptes {code[:3]}…).")
        account_type, reconcile = sibling.account_type, sibling.reconcile
        for prefix, forced_type, forced_reconcile in CLASS_RULES:
            if code.startswith(prefix):
                account_type, reconcile = forced_type, forced_reconcile
        if code.startswith(LETTERED_PREFIXES):
            reconcile = True
        if "reconcile" in data and account_type not in ("asset_receivable", "liability_payable"):
            reconcile = bool(data["reconcile"])
        account = Account.create({
            "code": code, "name": str(name).strip()[:200], "account_type": account_type, "reconcile": reconcile,
            "company_ids": [Command.set(company.ids)],
        })
        if data.get("analytic_required"):
            set_requirement(request.env.ref(ACTIVITY_PLAN), code, company)
        return dict(_row(account, company), sibling={"code": sibling.with_company(company).code, "name": sibling.name})

    @api_route("/finance/accounts/<int:account_id>", methods=("PATCH",), profiles=FIN_WRITE)
    def update_account(self, account_id, **_kw):
        """Renommer, désactiver (jamais supprimer un compte mouvementé) ou réactiver un compte ; rendre
        l'axe Activité obligatoire sur ce compte."""
        company = request.env.company
        account = _account(account_id, company).with_company(company)
        data = read_json()
        values = {}
        if data.get("name"):
            values["name"] = str(data["name"]).strip()[:200]
        if "active" in data and not data["active"] and account.active:
            if request.env["account.journal"].search_count([("default_account_id", "=", account.id)]):
                raise ApiError(422, "business_rule", "Compte d'un journal de banque, de caisse ou de vente : il reste actif.")
            [(balance,)] = request.env["account.move.line"]._read_group(
                [("account_id", "=", account.id), ("company_id", "=", company.id), ("parent_state", "=", "posted")],
                aggregates=["balance:sum"])
            if abs(balance or 0.0) >= 0.5:
                raise ApiError(422, "business_rule", f"Le compte {account.code} n'est pas soldé : soldez-le avant de le désactiver.")
            values["active"] = False
        elif data.get("active") and not account.active:
            values["active"] = True
        if "reconcile" in data and account.account_type not in ("asset_receivable", "liability_payable"):
            values["reconcile"] = bool(data["reconcile"])
        if values:
            account.write(values)
        if "analytic_required" in data:
            set_requirement(request.env.ref(ACTIVITY_PLAN), account.code, company, bool(data["analytic_required"]))
        return _row(account, company)
