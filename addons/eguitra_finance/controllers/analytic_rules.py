"""Imputations automatiques et imputation obligatoire (offre, chapitre 3.3 : « l'imputation analytique
est déduite automatiquement »).

- Règles d'imputation : modèles de répartition du noyau (account.analytic.distribution.model), par
  préfixe de compte et par tiers, dans la société de travail. Une règle ne renseigne que les axes que
  la saisie laisse vides ; plusieurs règles portant sur des axes différents se cumulent.
- Imputation obligatoire : règles d'applicabilité d'un axe (account.analytic.applicability) sur un
  préfixe de compte ; une pièce ne se valide plus sans répartition à 100 % sur cet axe.
"""

import re

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json

from ..models.analytic import PLANS, plan_key
from .common import FIN_READ, FIN_WRITE, analytic_labels, describe_distribution, distribution, ref, with_rules
from .moves import account_of_company

PREFIXES = re.compile(r"^\d+(\s*[,;]\s*\d+)*$")
# Une règle d'imputation obligatoire couvre les factures, les pièces d'achat et les opérations diverses.
DOMAINS = ("invoice", "bill", "general")


def _prefixes(value):
    """Préfixes de comptes « 60, 61 » : chiffres séparés par des virgules ou des points-virgules."""
    text = str(value or "").strip()
    if not text:
        return False
    if not PREFIXES.match(text):
        raise ApiError(400, "invalid_parameter", "Préfixes de comptes : des chiffres séparés par des virgules (« 60, 61 »).")
    return ", ".join(p.strip() for p in re.split(r"[,;]", text))


def _rule(rule_id):
    rule = request.env["account.analytic.distribution.model"].browse(rule_id).exists()
    company = request.env.company
    if not rule or (rule.company_id and rule.company_id != company):
        raise ApiError(404, "not_found", "Règle introuvable dans la société de travail.")
    if not rule.company_id and "admin" not in request.env.user._eguitra_profiles():
        raise ApiError(403, "forbidden", "Règle commune aux deux sociétés : réservée à l'administration.")
    return rule


def _rule_row(rule, labels):
    shares = describe_distribution(rule.analytic_distribution, labels)
    return {
        "id": rule.id,
        "sequence": rule.sequence,
        "account_prefix": rule.account_prefix or None,
        "partner": ref(rule.partner_id),
        "company": ref(rule.company_id),
        "distribution": shares,
        "analytic_distribution": rule.analytic_distribution or {},
        "axes": sorted({s["plan"] for s in shares}),
    }


def _rule_values(data, creating):
    values = {}
    if "account_prefix" in data:
        values["account_prefix"] = _prefixes(data.get("account_prefix"))
    if "partner_id" in data:
        partner = request.env["res.partner"]
        if data.get("partner_id"):
            partner = partner.browse(int(data["partner_id"])).exists()
            if not partner:
                raise ApiError(404, "not_found", "Tiers introuvable.")
        values["partner_id"] = partner.id or False
    if "sequence" in data:
        values["sequence"] = int_arg(data, "sequence", 10, 0, 1000)
    if "analytic_distribution" in data or creating:
        dist = distribution(data.get("analytic_distribution"))
        if not dist:
            raise ApiError(400, "missing_fields", "Indiquez au moins un compte analytique.", fields=["analytic_distribution"])
        values["analytic_distribution"] = dist
    return values


class EguitraFinanceAnalyticRules(http.Controller):
    # ─── Règles d'imputation automatique ──────────────────────────────────

    @api_route("/finance/analytic-rules", profiles=FIN_READ)
    def rules(self, **_kw):
        company = request.env.company
        rules = request.env["account.analytic.distribution.model"].search(
            [("company_id", "in", [False, company.id])], order="sequence, id")
        labels = analytic_labels(rules.mapped("analytic_distribution"))
        return [_rule_row(r, labels) for r in rules]

    @api_route("/finance/analytic-rules", methods=("POST",), profiles=FIN_WRITE)
    def create_rule(self, **_kw):
        data = read_json()
        values = _rule_values(data, creating=True)
        if not values.get("account_prefix") and not values.get("partner_id"):
            raise ApiError(400, "missing_fields", "Une règle porte sur un préfixe de compte, un tiers, ou les deux.",
                           fields=["account_prefix", "partner_id"])
        values["company_id"] = request.env.company.id
        rule = request.env["account.analytic.distribution.model"].create(values)
        return _rule_row(rule, analytic_labels([rule.analytic_distribution]))

    @api_route("/finance/analytic-rules/<int:rule_id>", methods=("PATCH",), profiles=FIN_WRITE)
    def update_rule(self, rule_id, **_kw):
        rule = _rule(rule_id)
        values = _rule_values(read_json(), creating=False)
        prefix = values.get("account_prefix", rule.account_prefix)
        partner = values.get("partner_id", rule.partner_id.id)
        if not prefix and not partner:
            raise ApiError(400, "missing_fields", "Une règle porte sur un préfixe de compte, un tiers, ou les deux.")
        rule.write(values)
        return _rule_row(rule, analytic_labels([rule.analytic_distribution]))

    @api_route("/finance/analytic-rules/<int:rule_id>", methods=("DELETE",), profiles=FIN_WRITE)
    def delete_rule(self, rule_id, **_kw):
        _rule(rule_id).unlink()
        return {"status": "ok"}

    @api_route("/finance/analytic-rules/simulate", profiles=FIN_READ)
    def simulate(self, **kw):
        """Répartition qu'appliqueraient les règles à une ligne (compte, tiers) saisie sans analytique."""
        company = request.env.company
        account = account_of_company(kw.get("account_id"), company)
        partner = request.env["res.partner"].browse(int_arg(kw, "partner_id", 0)).exists()
        dist = with_rules({}, account, partner, company)
        return {"analytic_distribution": dist, "distribution": describe_distribution(dist, analytic_labels([dist]))}

    # ─── Imputation obligatoire ───────────────────────────────────────────

    @api_route("/finance/analytic-requirements", profiles=FIN_READ)
    def requirements(self, **_kw):
        """Axes obligatoires par préfixe de compte, dans la société de travail."""
        company = request.env.company
        records = request.env["account.analytic.applicability"].search([
            ("applicability", "=", "mandatory"), ("company_id", "in", [False, company.id]),
            ("account_prefix", "!=", False),
        ], order="analytic_plan_id, account_prefix, id")
        groups = {}
        for record in records:
            key = (record.analytic_plan_id.id, record.account_prefix, record.company_id.id)
            group = groups.setdefault(key, {
                "id": record.id, "plan": record.analytic_plan_id.name,
                "axis": plan_key(request.env, record.analytic_plan_id), "prefix": record.account_prefix,
                "company": ref(record.company_id), "domains": [],
            })
            group["domains"].append(record.business_domain)
        return list(groups.values())

    @api_route("/finance/analytic-requirements", methods=("POST",), profiles=FIN_WRITE)
    def create_requirement(self, **_kw):
        """Rend un axe obligatoire sur un préfixe de compte (factures, pièces d'achat et OD)."""
        data = read_json()
        axis = data.get("plan")
        if axis not in PLANS:
            raise ApiError(400, "invalid_parameter", "Axe analytique inconnu.")
        prefix = _prefixes(data.get("prefix"))
        if not prefix:
            raise ApiError(400, "missing_fields", "Préfixe de compte requis.", fields=["prefix"])
        company = request.env.company
        plan = request.env.ref(PLANS[axis])
        Applicability = request.env["account.analytic.applicability"]
        for domain in DOMAINS:
            if not Applicability.search_count([("analytic_plan_id", "=", plan.id), ("account_prefix", "=", prefix),
                                               ("business_domain", "=", domain), ("company_id", "=", company.id)]):
                Applicability.create({"analytic_plan_id": plan.id, "account_prefix": prefix, "business_domain": domain,
                                      "applicability": "mandatory", "company_id": company.id})
        return {"status": "ok", "plan": plan.name, "prefix": prefix}

    @api_route("/finance/analytic-requirements/<int:record_id>", methods=("DELETE",), profiles=FIN_WRITE)
    def delete_requirement(self, record_id, **_kw):
        """Retire l'obligation (toutes natures de pièces) d'un axe sur un préfixe."""
        company = request.env.company
        Applicability = request.env["account.analytic.applicability"]
        record = Applicability.browse(record_id).exists()
        if not record or record.company_id != company or record.applicability != "mandatory":
            raise ApiError(404, "not_found", "Règle introuvable dans la société de travail.")
        Applicability.search([("analytic_plan_id", "=", record.analytic_plan_id.id),
                              ("account_prefix", "=", record.account_prefix), ("company_id", "=", company.id),
                              ("applicability", "=", "mandatory")]).unlink()
        return {"status": "ok"}
