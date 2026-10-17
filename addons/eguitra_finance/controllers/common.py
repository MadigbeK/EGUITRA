"""Outils communs aux routes de l'API Finance."""

from datetime import date

from odoo import fields
from odoo.exceptions import ValidationError
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError

from ..models.analytic import ACTIVITY_PLAN, account_shares, distribution_ids, plan_key

FIN_READ = ("admin", "direction", "finance")
FIN_WRITE = ("admin", "finance")


def companies(kw):
    """Sociétés couvertes : la société de travail, ou tout le groupe si scope=group."""
    env = request.env
    if kw.get("scope") == "group":
        return env.user.company_ids.sorted("id")
    return env.company


def parse_date(kw, name, default=None):
    value = kw.get(name)
    if value in (None, ""):
        return default
    try:
        return fields.Date.to_date(value)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"Date invalide : {name}.") from e


def today():
    return fields.Date.context_today(request.env.user)


def as_float(value, name):
    try:
        return float(value)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"Nombre invalide : {name}.") from e


def ref(record):
    return {"id": record.id, "name": record.display_name} if record else None


def account_ref(account):
    if not account:
        return None
    return {"id": account.id, "code": account.code, "name": account.name}


# ─── Imputation analytique ────────────────────────────────────────────────


def distribution(value, company=None):
    """Répartition analytique reçue d'une application, {"<id>[,<id>]": pourcentage} : comptes
    existants et actifs, de la société (ou communs aux deux), chaque axe à 100 % au plus."""
    if not value:
        return {}
    if not isinstance(value, dict):
        raise ApiError(400, "invalid_parameter", "Répartition analytique invalide.")
    company = company or request.env.company
    # Lecture de contrôle (société, axe, état) : un compte de l'autre société se refuse par un message
    # métier, non par une erreur d'accès.
    Analytic = request.env["account.analytic.account"].sudo().with_context(active_test=False)
    result, by_plan = {}, {}
    for key, pct in value.items():
        parts = [p.strip() for p in str(key).split(",") if p.strip()]
        if not parts or not all(p.isdigit() for p in parts):
            raise ApiError(400, "invalid_parameter", "Répartition analytique invalide.")
        ids = sorted({int(p) for p in parts})
        accounts = Analytic.browse(ids).exists()
        if len(accounts) != len(ids):
            raise ApiError(422, "business_rule", "Compte analytique inconnu.")
        if accounts.filtered(lambda a: a.company_id and a.company_id != company):
            raise ApiError(422, "business_rule", "Compte analytique d'une autre société.")
        archived = accounts.filtered(lambda a: not a.active)
        if archived:
            raise ApiError(422, "business_rule", f"Compte analytique archivé : {archived[0].name}.")
        share = as_float(pct, "analytic_distribution")
        if not 0 < share <= 100:
            raise ApiError(422, "business_rule", "Une part analytique est comprise entre 0 et 100 %.")
        for plan in accounts.root_plan_id:
            by_plan[plan] = by_plan.get(plan, 0.0) + share
        key = ",".join(str(i) for i in ids)
        result[key] = result.get(key, 0.0) + share
    over = [plan.name for plan, total in by_plan.items() if total > 100.001]
    if over:
        raise ApiError(422, "business_rule", "Répartition supérieure à 100 % sur l'axe " + ", ".join(over) + ".")
    return result


def with_rules(dist, account, partner, company=None):
    """Complète la répartition saisie par les imputations automatiques (modèles de répartition du
    noyau : préfixe de compte, tiers, société), pour les seuls axes que la saisie laisse vides."""
    company = company or request.env.company
    given = request.env["account.analytic.account"].with_context(active_test=False).browse(
        distribution_ids(dist)).exists()
    commercial = partner.commercial_partner_id if partner else None
    vals = {
        "account_prefix": (account.with_company(company).code or "") if account else "",
        "partner_id": commercial.id if commercial else False,
        "partner_category_id": list(commercial.category_id.ids) if commercial else [],
        "company_id": company.id,
        "related_root_plan_ids": given.root_plan_id,
    }
    rules = request.env["account.analytic.distribution.model"]._get_distribution(vals) or {}
    merged = dict(dist or {})
    for key, pct in rules.items():
        if key != "__update__":
            merged.setdefault(key, pct)
    return merged


def activity_income_account(dist, company=None):
    """Compte de produit de l'activité dominante de la répartition (offre, chapitre 3.3 : la
    contrepartie se déduit de la saisie)."""
    company = company or request.env.company
    Account = request.env["account.account"]
    activity_plan = request.env.ref(ACTIVITY_PLAN, raise_if_not_found=False)
    shares = account_shares(dist)
    activities = request.env["account.analytic.account"].browse(list(shares)).exists().filtered(
        lambda a: a.plan_id == activity_plan and a.eguitra_income_account_id)
    if not activities:
        return Account
    income = max(activities, key=lambda a: shares[a.id]).eguitra_income_account_id
    return income if company in income.company_ids else Account


def _missing_axes(lines):
    """Axes obligatoires non renseignés à 100 %, et comptes concernés (message à l'utilisateur)."""
    Plan = request.env["account.analytic.plan"].sudo()
    Analytic = request.env["account.analytic.account"].sudo().with_context(active_test=False)
    names, codes = [], []
    for line in lines.filtered(lambda l: l.display_type == "product"):
        move = line.move_id
        domain = ("invoice" if move.is_sale_document(True) else "bill" if move.is_purchase_document(True)
                  else "general")
        plans = Plan.with_company(line.company_id).get_relevant_plans(
            company_id=line.company_id.id, product=line.product_id.id, account=line.account_id.id,
            business_domain=domain)
        by_root = {}
        for account_id, pct in account_shares(line.analytic_distribution).items():
            root = Analytic.browse(account_id).exists().root_plan_id
            by_root[root.id] = by_root.get(root.id, 0.0) + pct
        for plan in plans:
            if plan.get("applicability") == "mandatory" and abs(by_root.get(plan["id"], 0.0) - 100) > 0.01:
                if plan["name"] not in names:
                    names.append(plan["name"])
                if line.account_id.code and line.account_id.code not in codes:
                    codes.append(line.account_id.code)
    return names, codes


def check_mandatory_analytic(lines):
    """Imputation obligatoire (règles d'applicabilité des axes, écran Imputations automatiques) :
    contrôlée avant de valider ou de soumettre une pièce et à l'imputation d'une opération de
    trésorerie, avec un message qui nomme les axes manquants."""
    if not lines:
        return
    try:
        lines.with_context(validate_analytic=True)._validate_analytic_distribution()
    except ValidationError as e:
        try:
            names, codes = _missing_axes(lines)
        except Exception:  # message de repli : le contrôle du noyau a déjà tranché
            names, codes = [], []
        if names:
            detail = f"renseignez l'axe {', '.join(names)} à 100 %"
            if codes:
                detail += f" (comptes {', '.join(codes[:5])})"
        else:
            detail = "certaines lignes exigent une répartition analytique à 100 %"
        raise ApiError(422, "analytic_required", f"Imputation analytique obligatoire : {detail}.") from e


def analytic_labels(distributions):
    """Libellés des comptes analytiques de plusieurs répartitions, en une seule lecture."""
    ids = {i for dist in distributions for i in distribution_ids(dist)}
    accounts = request.env["account.analytic.account"].with_context(active_test=False).browse(list(ids)).exists()
    return {
        a.id: {"id": a.id, "name": a.name, "code": a.code or None, "plan": a.plan_id.name,
               "axis": plan_key(request.env, a.root_plan_id)}
        for a in accounts
    }


def describe_distribution(dist, labels):
    """Répartition lisible : compte analytique, axe et part."""
    rows = []
    for account_id, pct in account_shares(dist).items():
        label = labels.get(account_id)
        if label:
            rows.append(dict(label, percentage=pct))
    return rows


def move_summary(move):
    return {
        "id": move.id,
        "name": move.name if move.name and move.name != "/" else None,
        "move_type": move.move_type,
        "state": move.state,
        "partner": ref(move.partner_id),
        "journal": ref(move.journal_id),
        "date": move.date,
        "invoice_date": move.invoice_date,
        "invoice_date_due": move.invoice_date_due,
        "ref": move.ref or None,
        "currency": move.currency_id.name,
        "amount_untaxed": move.amount_untaxed,
        "amount_tax": move.amount_tax,
        "amount_total": move.amount_total,
        "amount_residual": move.amount_residual,
        "payment_state": move.payment_state,
        "company": ref(move.company_id),
        "approval": move._eguitra_approval_info(),
        "contract_ref": move.eguitra_contract_ref or None,
        "dispute": move.eguitra_dispute,
        "dispute_reason": move.eguitra_dispute_reason or None,
        "dispute_date": move.eguitra_dispute_date,
    }


def move_detail(move):
    data = move_summary(move)
    lines = move.invoice_line_ids if move.is_invoice(include_receipts=True) else move.line_ids
    labels = analytic_labels(lines.mapped("analytic_distribution"))
    data.update({
        "narration": move.narration or None,
        "lines": [
            {
                "id": line.id,
                "name": line.name,
                "account": account_ref(line.account_id),
                "partner": ref(line.partner_id),
                "quantity": line.quantity,
                "price_unit": line.price_unit,
                "taxes": [{"id": t.id, "name": t.name, "amount": t.amount} for t in line.tax_ids],
                "price_subtotal": line.price_subtotal,
                "price_total": line.price_total,
                "debit": line.debit,
                "credit": line.credit,
                "analytic_distribution": line.analytic_distribution or {},
                "analytic": describe_distribution(line.analytic_distribution, labels),
                "category": ref(line.eguitra_expense_category_id),
                "display_type": line.display_type,
            }
            for line in lines
        ],
        "attachments": [
            {"id": a.id, "name": a.name, "mimetype": a.mimetype, "size": a.file_size}
            for a in request.env["ir.attachment"].search([("res_model", "=", "account.move"), ("res_id", "=", move.id)])
        ],
        "payments": move.invoice_payments_widget or None,
        "can_post": move.state == "draft",
        "can_pay": move.state == "posted" and move.payment_state in ("not_paid", "partial") and move.is_invoice(),
    })
    return data


def iso(value):
    return value.isoformat() if isinstance(value, date) else value
