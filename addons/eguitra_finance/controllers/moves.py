"""Pièces comptables : factures de vente, pièces d'achat, avoirs, OD guidées, règlements, pièces jointes.

Les comptes de contrepartie, la TVA et l'échéance sont déduits par le noyau à la saisie
(offre, chapitre 3.3) ; l'appelant ne fournit que les lignes métier.
"""

import base64
import math

from odoo import Command, fields, http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require
from odoo.addons.eguitra_api.files import ACCEPTED, checked_name, detect_type

from ..models.analytic import ACTIVITY_PLAN
from .common import (
    ACHATS,
    FIN_READ,
    FIN_WRITE,
    PURCHASE_TYPES,
    PURCHASES_ONLY,
    achats_only,
    activity_income_account,
    as_float,
    check_mandatory_analytic,
    distribution,
    free_accounts,
    move_detail,
    move_summary,
    parse_date,
    require_free_accounts,
    require_purchase,
    today,
    with_rules,
    without_settlement,
)
from .withholding import invoice_partner, line_withholdings, with_withholdings

MOVE_TYPES = {
    "out_invoice": "Facture client",
    "out_refund": "Avoir client",
    "in_invoice": "Pièce d'achat",
    "in_refund": "Avoir fournisseur",
    "entry": "Opération diverse",
}
MAX_ATTACHMENT = 15 * 1024 * 1024
# Routes ouvertes au profil Achats, bornées aux pièces d'achat et aux avoirs fournisseurs (common.achats_only).
PURCHASE_READ = FIN_READ + ACHATS
PURCHASE_WRITE = FIN_WRITE + ACHATS


def _move(move_id, full=None):
    """Pièce de la société de l'utilisateur. full : profils qui ouvrent la route en entier ; à défaut
    d'en porter un, le profil Achats n'atteint que les pièces d'achat et les avoirs fournisseurs (403)."""
    move = request.env["account.move"].browse(move_id).exists()
    if not move or move.company_id not in request.env.user.company_ids:
        raise ApiError(404, "not_found", "Pièce introuvable.")
    if full:
        require_purchase(move.move_type, full)
    return move


def _detail(move):
    """Fiche de la pièce ; au profil Achats seul, sans reste dû ni règlements (common.without_settlement)."""
    data = move_detail(move)
    return without_settlement(data) if achats_only(FIN_READ) else data


def _purchase_taxes(value, company):
    """Taxes d'une ligne saisie par le profil Achats : taxes d'achat de la société seulement."""
    try:
        ids = {int(t) for t in value or []}
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", "Taxe invalide.") from e
    taxes = request.env["account.tax"].browse(list(ids)).exists()
    if len(taxes) != len(ids) or any(t.company_id != company or t.type_tax_use != "purchase" for t in taxes):
        raise ApiError(422, "business_rule", "Taxe inconnue, d'une autre société ou qui n'est pas une taxe d'achat.")
    return taxes


def _partner(value):
    partner = request.env["res.partner"].browse(int(value)).exists() if value else request.env["res.partner"]
    if value and not partner:
        raise ApiError(404, "not_found", "Tiers introuvable.")
    return partner


def account_of_company(value, company, label="Compte"):
    """Compte général du plan de la société (jamais celui de l'autre société)."""
    if not value:
        return request.env["account.account"]
    # Contrôle en lecture seule : un compte de l'autre société se refuse par un message métier.
    account = request.env["account.account"].sudo().browse(int(value)).exists()
    if not account or company not in account.company_ids:
        raise ApiError(422, "business_rule", f"{label} absent du plan de comptes de la société.")
    return account.sudo(False)


def chosen_account(value, company, label="Compte", allowed=None):
    """Compte choisi à la saisie (account_of_company), réservé au droit « Saisie libre des comptes »,
    sauf s'il est celui que la saisie déduit déjà (allowed : compte de la catégorie, du type d'opération,
    ou compte actuel d'un référentiel modifié)."""
    account = account_of_company(value, company, label)
    if account and not (allowed and account.id == allowed.id):
        require_free_accounts(f"{label} choisi à la saisie")
    return account


def mandatory_prefixes(company):
    """Préfixes de comptes sur lesquels l'axe Activité est obligatoire dans la société."""
    plan = request.env.ref(ACTIVITY_PLAN, raise_if_not_found=False)
    if not plan:
        return ()
    records = request.env["account.analytic.applicability"].search([
        ("analytic_plan_id", "=", plan.id), ("applicability", "=", "mandatory"),
        ("company_id", "in", [False, company.id]), ("account_prefix", "!=", False),
    ])
    return tuple({p.strip() for r in records for p in r.account_prefix.replace(";", ",").split(",") if p.strip()})


def store_attachment(move, upload):
    """Justificatif d'une pièce (ou d'une opération de trésorerie, par sa pièce) : format reconnu au
    contenu, 15 Mo au plus."""
    if not upload:
        raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
    content = upload.read(MAX_ATTACHMENT + 1)
    if len(content) > MAX_ATTACHMENT:
        raise ApiError(413, "too_large", "Fichier trop volumineux (15 Mo maximum).")
    mimetype = detect_type(content)
    if not mimetype:
        raise ApiError(415, "unsupported_type", f"Justificatif au format {ACCEPTED}.")
    attachment = request.env["ir.attachment"].create({
        "name": checked_name(upload.filename, mimetype, "piece-jointe"),
        "datas": base64.b64encode(content),
        "res_model": "account.move",
        "res_id": move.id,
        "mimetype": mimetype,
    })
    return {"id": attachment.id, "name": attachment.name, "mimetype": attachment.mimetype, "size": attachment.file_size}


def _default_journal(data, sale, company):
    if data.get("journal_id"):
        journal = request.env["account.journal"].browse(int(data["journal_id"])).exists()
        if not journal or journal.company_id != company:
            raise ApiError(422, "business_rule", "Journal inconnu dans la société.")
        if not sale and journal.type != "purchase" and achats_only(FIN_WRITE):
            raise ApiError(422, "business_rule", "Choisissez un journal d'achat.")
        return journal
    return request.env["account.journal"].search(
        [("company_id", "=", company.id), ("type", "=", "sale" if sale else "purchase")], limit=1)


def _invoice_lines(data, move_type, partner=None):
    """Lignes d'une facture ou d'une pièce d'achat. Compte : celui saisi (droit « Saisie libre des
    comptes »), sinon le compte de la catégorie de dépense (achats) ou du produit, sinon le compte de
    produit de l'activité (ventes), sinon le compte par défaut du journal ; sans ce droit, une ligne
    d'achat se saisit par catégorie (ou produit). TVA : celle saisie, sinon celle de la catégorie, sinon
    la taxe par défaut. Analytique : la répartition saisie, complétée par les imputations automatiques
    pour les axes laissés vides. Profil Achats : taxes d'achat de la société seulement, compte jamais
    choisi (free_accounts)."""
    lines = data.get("lines") or []
    if not isinstance(lines, list) or not lines:
        raise ApiError(400, "missing_fields", "Au moins une ligne est requise.", fields=["lines"])
    company = request.env.company
    sale = move_type.startswith("out_")
    purchases_only = achats_only(FIN_WRITE)
    default_tax = company.account_sale_tax_id if sale else company.account_purchase_tax_id
    journal = _default_journal(data, sale, company)
    partner = partner or invoice_partner(data)
    commands = []
    for i, line in enumerate(lines, start=1):
        if not isinstance(line, dict) or not line.get("name"):
            raise ApiError(400, "missing_fields", f"Ligne {i} : libellé requis.")
        values = {
            "name": str(line["name"])[:500],
            "quantity": as_float(line.get("quantity", 1), "quantity"),
            "price_unit": as_float(line.get("price_unit", 0), "price_unit"),
        }
        dist = distribution(line.get("analytic_distribution"), company)
        category = category_of(line.get("category_id"), company) if not sale else request.env["eguitra.expense.category"]
        account = chosen_account(line.get("account_id"), company, f"Ligne {i} : compte", allowed=category.account_id)
        if not sale and not (category or account or line.get("product_id")) and not free_accounts():
            raise ApiError(422, "business_rule", f"Ligne {i} : choisissez la catégorie de dépense, dont la ligne prend "
                                                 "le compte.")
        if category:
            values["eguitra_expense_category_id"] = category.id
            account = account or category.account_id
            if category.asset_profile_id:
                values["asset_profile_id"] = category.asset_profile_id.id
        if line.get("product_id"):
            values["product_id"] = int(line["product_id"])
        elif not account:
            if sale:
                account = activity_income_account(dist, company)
            account = account or journal.default_account_id
        if account:
            values["account_id"] = account.id
        if "tax_ids" in line:
            if purchases_only:
                values["tax_ids"] = [Command.set(_purchase_taxes(line["tax_ids"], company).ids)]
            else:
                values["tax_ids"] = [Command.set([int(t) for t in line["tax_ids"] or []])]
        elif category:
            values["tax_ids"] = [Command.set(category.taxes(default_tax).ids)]
        elif data.get("apply_default_tax", True) and default_tax:
            values["tax_ids"] = [Command.set(default_tax.ids)]
        with_withholdings(values, line_withholdings(line, partner, move_type))
        dist = with_rules(dist, account, partner, company) if (account or dist) else dist
        if dist:
            values["analytic_distribution"] = dist
        commands.append(Command.create(values))
    return commands


def _partial_amount(value):
    """Montant d'un règlement partiel : nombre positif lisible, sinon refus (400). Un montant vide ou
    illisible (saisie « 750 000,00 » mal lue, envoyée nulle) ne doit jamais régler tout le reste dû."""
    if value in (None, "") or isinstance(value, bool):
        raise ApiError(400, "invalid_parameter", "Règlement partiel : indiquez le montant réglé.", fields=["amount"])
    amount = as_float(value, "amount")
    if not math.isfinite(amount) or amount <= 0:
        raise ApiError(400, "invalid_parameter", "Le montant du règlement doit être un nombre positif.",
                       fields=["amount"])
    return amount


def _commitment(value, move_type, partner):
    """Engagement de dépense approuvé du fournisseur, que la pièce d'achat consomme (eguitra_approval)."""
    if move_type != "in_invoice":
        raise ApiError(422, "business_rule", "Seule une pièce d'achat consomme un engagement.")
    commitment = request.env["eguitra.commitment"].browse(int(value)).exists()
    if not commitment or commitment.state != "approved" or commitment.company_id != request.env.company             or commitment.partner_id.commercial_partner_id != partner.commercial_partner_id:
        raise ApiError(422, "business_rule", "Engagement inconnu, non approuvé ou d'un autre fournisseur.")
    return commitment.id


def category_of(value, company):
    """Catégorie de dépense active de la société, désignée par la saisie."""
    Category = request.env["eguitra.expense.category"]
    if not value:
        return Category
    category = Category.sudo().browse(int(value)).exists()
    if not category or category.company_id != company or not category.active:
        raise ApiError(422, "business_rule", "Catégorie de dépense inconnue dans la société.")
    return category.sudo(False)


def _entry_categories(data, move_type, company):
    """Compte de tiers commun des catégories qui font d'une pièce d'achat une opération diverse
    (personnel, organismes sociaux, État) ; vide pour une pièce d'achat ordinaire."""
    if not move_type.startswith("in_"):
        return request.env["account.account"]
    lines = data.get("lines") or []
    categories = [category_of(line.get("category_id"), company) if isinstance(line, dict) else None for line in lines]
    entries = [c for c in categories if c and c.is_entry()]
    if not entries:
        return request.env["account.account"]
    accounts = {c.partner_account_id for c in entries}
    if len(entries) != len(lines) or len(accounts) > 1:
        raise ApiError(422, "business_rule", "Séparez la pièce : les catégories « " + ", ".join(sorted({c.name for c in entries}))
                       + " » se passent en opération diverse sur un même compte de tiers, sans autre ligne.")
    return entries[0].partner_account_id


def _purchase_as_entry(data, move_type, partner, partner_account, company):
    """Dépense d'une catégorie à compte de tiers non fournisseur (salaires, cotisations, impôts) :
    opération diverse, charge au débit et compte de tiers au crédit (sens inverse pour un avoir)."""
    journal = request.env["account.journal"].search(
        [("company_id", "=", company.id), ("type", "=", "general"), ("code", "!=", "AN")], limit=1)
    if not journal:
        raise ApiError(422, "business_rule", "Aucun journal d'opérations diverses dans la société.")
    refund = move_type == "in_refund"
    day = parse_date(data, "invoice_date", today())
    commands, total = [], 0.0
    for i, line in enumerate(data["lines"], start=1):
        if not line.get("name"):
            raise ApiError(400, "missing_fields", f"Ligne {i} : libellé requis.")
        category = category_of(line.get("category_id"), company)
        amount = as_float(line.get("quantity", 1), "quantity") * as_float(line.get("price_unit", 0), "price_unit")
        if amount <= 0:
            raise ApiError(422, "business_rule", "Chaque ligne doit avoir un montant positif.")
        account = (chosen_account(line.get("account_id"), company, "Compte", allowed=category.account_id)
                   or category.account_id)
        dist = with_rules(distribution(line.get("analytic_distribution"), company), account, partner, company)
        values = {"name": str(line["name"])[:500], "account_id": account.id, "eguitra_expense_category_id": category.id,
                  "debit": 0.0 if refund else amount, "credit": amount if refund else 0.0}
        if dist:
            values["analytic_distribution"] = dist
        commands.append(Command.create(values))
        total += amount
    label = data.get("ref") or data["lines"][0]["name"]
    counterpart = {"name": str(label)[:500], "account_id": partner_account.id, "partner_id": partner.id,
                   "debit": total if refund else 0.0, "credit": 0.0 if refund else total}
    if data.get("invoice_date_due"):
        counterpart["date_maturity"] = parse_date(data, "invoice_date_due")
    commands.append(Command.create(counterpart))
    values = {"move_type": "entry", "journal_id": journal.id, "date": day, "ref": str(label)[:200],
              "line_ids": commands, "eguitra_manual_entry": True, "company_id": company.id}
    if data.get("narration"):
        values["narration"] = str(data["narration"])
    return request.env["account.move"].create(values)


# Refus d'une opération diverse sans le droit de saisie libre : où saisir à la place.
ENTRY_DETAIL = ("Saisissez une dépense par sa catégorie (Achats et dépenses) et une opération de banque ou de "
                "caisse par son type (Trésorerie)")


def _entry_lines(data):
    """Lignes d'une opération diverse, chacune sur un compte choisi : réservée au droit « Saisie libre
    des comptes » (refus 403 sans ce droit)."""
    require_free_accounts("Opération diverse", ENTRY_DETAIL)
    lines = data.get("lines") or []
    if len(lines) < 2:
        raise ApiError(400, "missing_fields", "Une opération diverse comporte au moins deux lignes.")
    company = request.env.company
    commands, debit, credit = [], 0.0, 0.0
    for i, line in enumerate(lines, start=1):
        if not line.get("account_id"):
            raise ApiError(400, "missing_fields", f"Ligne {i} : compte requis.")
        d, c = as_float(line.get("debit", 0), "debit"), as_float(line.get("credit", 0), "credit")
        if d < 0 or c < 0 or (d and c) or not (d or c):
            raise ApiError(422, "business_rule", f"Ligne {i} : saisir soit un débit, soit un crédit positif.")
        debit, credit = debit + d, credit + c
        account = account_of_company(line["account_id"], company, f"Ligne {i} : compte")
        partner = _partner(line.get("partner_id"))
        values = {"account_id": account.id, "name": line.get("name") or data.get("ref") or "/",
                  "debit": d, "credit": c}
        if partner:
            values["partner_id"] = partner.id
        dist = with_rules(distribution(line.get("analytic_distribution"), company), account, partner, company)
        if dist:
            values["analytic_distribution"] = dist
        commands.append(Command.create(values))
    if round(debit - credit, 2):
        raise ApiError(422, "business_rule", f"Pièce déséquilibrée : débit {debit:,.0f}, crédit {credit:,.0f}.".replace(",", " "))
    return commands


class EguitraFinanceMoves(http.Controller):
    # ─── Liste et détail ──────────────────────────────────────────────────

    @api_route("/finance/moves", profiles=PURCHASE_READ)
    def list_moves(self, **kw):
        types = [t for t in (kw.get("type") or "out_invoice,out_refund").split(",") if t in MOVE_TYPES]
        if achats_only(FIN_READ):
            # Profil Achats : liste bornée d'office aux pièces d'achat et aux avoirs fournisseurs ; une liste
            # qui ne demande que d'autres pièces (ventes, opérations diverses) est refusée.
            types = [t for t in types if t in PURCHASE_TYPES] if kw.get("type") else list(PURCHASE_TYPES)
            if not types:
                raise ApiError(403, "forbidden", PURCHASES_ONLY)
        domain = [("move_type", "in", types), ("company_id", "=", request.env.company.id)]
        if kw.get("state") in ("draft", "posted", "cancel"):
            domain.append(("state", "=", kw["state"]))
        if kw.get("payment_state"):
            domain.append(("payment_state", "in", kw["payment_state"].split(",")))
        if kw.get("partner_id"):
            domain.append(("partner_id", "=", int_arg(kw, "partner_id")))
        if kw.get("journal_id"):
            domain.append(("journal_id", "=", int_arg(kw, "journal_id")))
        start, end = parse_date(kw, "date_from"), parse_date(kw, "date_to")
        if start:
            domain.append(("date", ">=", start))
        if end:
            domain.append(("date", "<=", end))
        if kw.get("overdue") == "1":
            domain += [("invoice_date_due", "<", today()), ("payment_state", "in", ("not_paid", "partial")),
                       ("state", "=", "posted")]
        if kw.get("dispute") in ("0", "1"):
            domain.append(("eguitra_dispute", "=", kw["dispute"] == "1"))
        if kw.get("search"):
            s = kw["search"]
            domain += ["|", "|", ("name", "ilike", s), ("ref", "ilike", s), ("partner_id.name", "ilike", s)]
        Move = request.env["account.move"]
        limit = int_arg(kw, "limit", 50, 1, 500)
        offset = int_arg(kw, "offset", 0, 0)
        moves = Move.search(domain, limit=limit, offset=offset, order="date desc, id desc")
        [(total, residual)] = Move._read_group(domain, aggregates=["amount_total_signed:sum", "amount_residual_signed:sum"])
        items = [move_summary(m) for m in moves]
        totals = {"amount_total": abs(total or 0.0), "amount_residual": abs(residual or 0.0)}
        if achats_only(FIN_READ):
            items = [without_settlement(item) for item in items]
            totals["amount_residual"] = None
        return {
            "items": items,
            "total_count": Move.search_count(domain),
            "totals": totals,
            "limit": limit,
            "offset": offset,
        }

    @api_route("/finance/moves/<int:move_id>", profiles=PURCHASE_READ)
    def get_move(self, move_id, **_kw):
        return _detail(_move(move_id, FIN_READ))

    # ─── Saisie ───────────────────────────────────────────────────────────

    @api_route("/finance/moves", methods=("POST",), profiles=PURCHASE_WRITE)
    def create_move(self, **_kw):
        data = read_json()
        move_type = data.get("move_type")
        if move_type not in MOVE_TYPES:
            raise ApiError(400, "invalid_parameter", "Type de pièce inconnu.")
        require_purchase(move_type, FIN_WRITE)
        purchases_only = achats_only(FIN_WRITE)
        if purchases_only and data.get("dispute"):
            raise ApiError(403, "forbidden", "Profil Achats : le litige sur une pièce se déclare par la finance.")
        values = {"move_type": move_type, "company_id": request.env.company.id}
        if data.get("journal_id"):
            values["journal_id"] = int(data["journal_id"])
        if data.get("ref"):
            values["ref"] = str(data["ref"])[:200]
        if data.get("narration"):
            values["narration"] = str(data["narration"])
        if data.get("contract_ref"):
            values["eguitra_contract_ref"] = str(data["contract_ref"]).strip()[:120]
        if move_type == "entry":
            require_free_accounts("Opération diverse", ENTRY_DETAIL)
            if not data.get("journal_id"):
                raise ApiError(400, "missing_fields", "Journal requis.", fields=["journal_id"])
            values["date"] = parse_date(data, "date", today())
            values["line_ids"] = _entry_lines(data)
            values["eguitra_manual_entry"] = True
        else:
            (partner_id,) = require(data, "partner_id")
            partner = _partner(partner_id)
            partner_account = _entry_categories(data, move_type, request.env.company)
            if partner_account and purchases_only:
                # L'opération diverse produite (salaires, cotisations, impôts) sortirait du périmètre du profil.
                raise ApiError(403, "forbidden", "Profil Achats : les dépenses de personnel, de charges sociales et "
                                                 "d'impôts (opérations diverses) se saisissent par la finance.")
            if partner_account:
                move = _purchase_as_entry(data, move_type, partner, partner_account, request.env.company)
                if data.get("post"):
                    check_mandatory_analytic(move.line_ids)
                    move._eguitra_post_or_submit()
                return dict(move_detail(move), converted_from=move_type)
            values.update({
                "partner_id": partner.id,
                "invoice_date": parse_date(data, "invoice_date", today()),
                "invoice_line_ids": _invoice_lines(data, move_type, partner),
            })
            if data.get("invoice_date_due"):
                values["invoice_date_due"] = parse_date(data, "invoice_date_due")
            if data.get("currency_id"):
                currency = request.env["res.currency"].browse(int(data["currency_id"])).exists()
                if not currency or not currency.active:
                    raise ApiError(422, "business_rule", "Devise inconnue ou inactive.")
                values["currency_id"] = currency.id
            if data.get("commitment_id"):
                values["eguitra_commitment_id"] = _commitment(data["commitment_id"], move_type, partner)
        move = request.env["account.move"].create(values)
        if data.get("dispute") and move.move_type != "entry":
            move.eguitra_set_dispute(True, data.get("dispute_reason"))
        if data.get("post"):
            check_mandatory_analytic(move.line_ids)
            move._eguitra_post_or_submit()
        return _detail(move)

    @api_route("/finance/moves/<int:move_id>", methods=("PATCH",), profiles=PURCHASE_WRITE)
    def update_move(self, move_id, **_kw):
        move = _move(move_id, FIN_WRITE)
        if move.state != "draft":
            raise ApiError(422, "business_rule", "Seule une pièce en brouillon peut être modifiée.")
        data = read_json()
        values = {}
        for key in ("ref", "narration"):
            if key in data:
                values[key] = data[key] or False
        if "contract_ref" in data:
            values["eguitra_contract_ref"] = str(data["contract_ref"] or "").strip()[:120] or False
        if "partner_id" in data:
            values["partner_id"] = int(data["partner_id"])
        if "commitment_id" in data and move.move_type == "in_invoice":
            partner = _partner(values["partner_id"]) if values.get("partner_id") else move.partner_id
            values["eguitra_commitment_id"] = (_commitment(data["commitment_id"], move.move_type, partner)
                                               if data["commitment_id"] else False)
        for key in ("invoice_date", "invoice_date_due", "date"):
            if key in data:
                values[key] = parse_date(data, key)
        if "lines" in data:
            if move.move_type == "entry":
                values["line_ids"] = [Command.clear()] + _entry_lines(data)
            else:
                if _entry_categories(data, move.move_type, move.company_id):
                    raise ApiError(422, "business_rule", "Ces catégories font de la dépense une opération diverse : "
                                                         "supprimez ce brouillon et ressaisissez la pièce.")
                partner = _partner(values["partner_id"]) if values.get("partner_id") else move.partner_id
                values["invoice_line_ids"] = [Command.clear()] + _invoice_lines(
                    dict(data, journal_id=move.journal_id.id), move.move_type, partner)
        move.write(values)
        return _detail(move)

    @api_route("/finance/moves/<int:move_id>", methods=("DELETE",), profiles=PURCHASE_WRITE)
    def delete_move(self, move_id, **_kw):
        move = _move(move_id, FIN_WRITE)
        if move.state != "draft" or move.posted_before:
            raise ApiError(422, "business_rule", "Seul un brouillon jamais validé peut être supprimé ; sinon, annulez-le.")
        move.unlink()
        return {"status": "ok"}

    # ─── Cycle de vie ─────────────────────────────────────────────────────

    @api_route("/finance/moves/<int:move_id>/post", methods=("POST",), profiles=PURCHASE_WRITE)
    def post_move(self, move_id, **_kw):
        """Validation, ou soumission au circuit d'approbation quand une règle s'applique (eguitra_approval) :
        le profil Achats soumet ainsi ses pièces, le circuit décide de leur comptabilisation."""
        move = _move(move_id, FIN_WRITE)
        if move.state != "draft":
            raise ApiError(422, "business_rule", "La pièce n'est pas en brouillon.")
        check_mandatory_analytic(move.line_ids)
        move._eguitra_post_or_submit()
        return _detail(move)

    @api_route("/finance/moves/<int:move_id>/dispute", methods=("POST",), profiles=FIN_WRITE)
    def dispute(self, move_id, **_kw):
        """Déclare (dispute=true, motif obligatoire) ou lève (dispute=false) un litige sur une facture : le
        statut « Litige » prime et la facture sort des relances tant que le litige dure."""
        move = _move(move_id)
        data = read_json()
        if "dispute" not in data:
            raise ApiError(400, "missing_fields", "Indiquez dispute (true ou false).", fields=["dispute"])
        move.eguitra_set_dispute(bool(data["dispute"]), data.get("reason"))
        return move_detail(move)

    @api_route("/finance/moves/<int:move_id>/cancel", methods=("POST",), profiles=FIN_WRITE)
    def cancel_move(self, move_id, **_kw):
        move = _move(move_id)
        if move.state == "posted":
            move.button_draft()
        move.button_cancel()
        return move_detail(move)

    @api_route("/finance/moves/<int:move_id>/reset", methods=("POST",), profiles=FIN_WRITE)
    def reset_move(self, move_id, **_kw):
        move = _move(move_id)
        move.button_draft()
        return move_detail(move)

    @api_route("/finance/moves/<int:move_id>/reverse", methods=("POST",), profiles=FIN_WRITE)
    def reverse_move(self, move_id, **_kw):
        """Avoir ou extourne d'une pièce validée (seule correction possible après verrouillage)."""
        move = _move(move_id)
        data = read_json()
        if move.state != "posted":
            raise ApiError(422, "business_rule", "Seule une pièce validée peut être extournée.")
        reversal = move._reverse_moves(
            [{"date": parse_date(data, "date", today()), "ref": data.get("reason") or f"Extourne de {move.name}"}],
            cancel=bool(data.get("cancel")),
        )
        return move_detail(reversal)

    @api_route("/finance/moves/<int:move_id>/payments", methods=("POST",), profiles=FIN_WRITE)
    def register_payment(self, move_id, **_kw):
        """Règlement d'une pièce validée. Sans montant, tout le reste dû est réglé. Un règlement partiel
        (montant transmis, ou partial=true) exige un montant positif lisible : un montant absent, nul,
        négatif ou illisible est refusé (400), au lieu de régler tout le reste dû."""
        move = _move(move_id)
        data = read_json()
        (journal_id,) = require(data, "journal_id")
        if move.state != "posted" or move.payment_state not in ("not_paid", "partial"):
            raise ApiError(422, "business_rule", "Cette pièce n'attend pas de règlement.")
        values = {"journal_id": int(journal_id), "payment_date": parse_date(data, "date", today())}
        if "amount" in data or data.get("partial"):
            values["amount"] = _partial_amount(data.get("amount"))
        if data.get("memo"):
            values["communication"] = str(data["memo"])[:200]
        mode = request.env["eguitra.payment.mode"]
        if data.get("payment_mode_id"):
            mode = mode.sudo().browse(int(data["payment_mode_id"])).exists()
            if not mode or (mode.company_id and mode.company_id != move.company_id):
                raise ApiError(422, "business_rule", "Mode de paiement inconnu.")
            mode = mode.sudo(False)
        wizard = request.env["account.payment.register"].with_context(
            active_model="account.move", active_ids=move.ids
        ).create(values)
        payments = wizard._create_payments()
        if mode:
            payments.write({"eguitra_payment_mode_id": mode.id})
        return move_detail(move)

    @api_route("/finance/moves/<int:move_id>/pdf", profiles=PURCHASE_READ)
    def move_pdf(self, move_id, **_kw):
        move = _move(move_id, FIN_READ)
        if not move.is_invoice(include_receipts=True):
            raise ApiError(422, "business_rule", "Pas d'impression pour ce type de pièce.")
        pdf, _type = request.env["ir.actions.report"].sudo()._render_qweb_pdf("account.account_invoices", move.ids)
        name = (move.name or "brouillon").replace("/", "-")
        return request.make_response(pdf, headers=[
            ("Content-Type", "application/pdf"),
            ("Content-Disposition", content_disposition(f"{name}.pdf")),
        ])

    # ─── Pièces jointes ───────────────────────────────────────────────────

    @api_route("/finance/moves/<int:move_id>/attachments", methods=("POST",), profiles=PURCHASE_WRITE)
    def add_attachment(self, move_id, **_kw):
        return store_attachment(_move(move_id, FIN_WRITE), request.httprequest.files.get("file"))

    @api_route("/finance/attachments/<int:attachment_id>", profiles=PURCHASE_READ)
    def download_attachment(self, attachment_id, **_kw):
        attachment = request.env["ir.attachment"].browse(attachment_id).exists()
        if not attachment or attachment.res_model != "account.move":
            raise ApiError(404, "not_found", "Pièce jointe introuvable.")
        _move(attachment.res_id, FIN_READ)
        return request.make_response(attachment.raw or b"", headers=[
            ("Content-Type", attachment.mimetype or "application/octet-stream"),
            ("Content-Disposition", content_disposition(attachment.name or "piece-jointe")),
            ("X-Content-Type-Options", "nosniff"),
        ])

    # ─── Virement interne par le compte de passage 585 ─────────────────────

    @api_route("/finance/transfers", methods=("POST",), profiles=FIN_WRITE)
    def internal_transfer(self, **_kw):
        """Virement entre deux comptes de trésorerie : sortie vers 585, puis entrée depuis 585."""
        data = read_json()
        source_id, target_id, amount = require(data, "from_journal_id", "to_journal_id", "amount")
        Journal = request.env["account.journal"]
        source, target = Journal.browse(int(source_id)).exists(), Journal.browse(int(target_id)).exists()
        if not source or not target or source == target or {source.type, target.type} - {"bank", "cash"}:
            raise ApiError(422, "business_rule", "Choisissez deux journaux de banque ou de caisse différents.")
        amount = as_float(amount, "amount")
        if amount <= 0:
            raise ApiError(422, "business_rule", "Le montant doit être positif.")
        transit = source.company_id.transfer_account_id
        if not (transit and transit.code.startswith("585")):
            transit = request.env["account.account"].search([
                ("code", "=like", "585%"), ("company_ids", "in", source.company_id.ids),
            ], limit=1)
        if not transit:
            raise ApiError(422, "business_rule", "Compte de passage 585 introuvable dans le plan de comptes.")
        day = parse_date(data, "date", today())
        label = data.get("ref") or f"Virement {source.name} vers {target.name}"
        moves = request.env["account.move"]
        for journal, debit_account, credit_account in (
            (source, transit, source.default_account_id),
            (target, target.default_account_id, transit),
        ):
            moves |= moves.create({
                "move_type": "entry",
                "journal_id": journal.id,
                "date": day,
                "ref": label,
                "line_ids": [
                    Command.create({"name": label, "account_id": debit_account.id, "debit": amount}),
                    Command.create({"name": label, "account_id": credit_account.id, "credit": amount}),
                ],
            })
        out_move, in_move = moves
        # La sortie passe par le circuit des décaissements au-delà du seuil ; l'entrée la suit.
        out_move.with_context(eguitra_cash_out_check=True).action_post()
        if out_move.state == "posted":
            in_move.action_post()
        elif "eguitra_paired_move_id" in out_move._fields:
            out_move.sudo().eguitra_paired_move_id = in_move
        return {"status": "ok" if out_move.state == "posted" else "submitted",
                "moves": [move_summary(m) for m in moves]}

    # ─── Référentiels de saisie ───────────────────────────────────────────

    @api_route("/finance/accounts", profiles=FIN_READ)
    def accounts(self, **kw):
        """Plan de comptes de la société de travail ; all=1 ajoute les comptes désactivés."""
        domain = [("company_ids", "in", request.env.company.ids)]
        if kw.get("prefix"):
            domain.append(("code", "=like", kw["prefix"] + "%"))
        if kw.get("type"):
            domain.append(("account_type", "in", kw["type"].split(",")))
        if kw.get("search"):
            domain += ["|", ("code", "=like", kw["search"] + "%"), ("name", "ilike", kw["search"])]
        Account = request.env["account.account"].with_context(active_test=kw.get("all") != "1")
        accounts = Account.search(domain, limit=int_arg(kw, "limit", 100, 1, 3000), order="code")
        mandatory = mandatory_prefixes(request.env.company)
        return [{"id": a.id, "code": a.code, "name": a.name, "type": a.account_type, "reconcile": a.reconcile,
                 "active": a.active, "analytic_required": bool(a.code) and a.code.startswith(mandatory)}
                for a in accounts]

    @api_route("/finance/journals", profiles=PURCHASE_READ)
    def journals(self, **kw):
        domain = [("company_id", "=", request.env.company.id)]
        types = kw["type"].split(",") if kw.get("type") else None
        if achats_only(FIN_READ):
            # Profil Achats : journaux d'achat seuls (ni banque, ni caisse, ni ventes, ni opérations diverses).
            if types and "purchase" not in types:
                raise ApiError(403, "forbidden", "Profil Achats : journaux d'achat seulement.")
            types = ["purchase"]
        if types:
            domain.append(("type", "in", types))
        return [
            {"id": j.id, "name": j.name, "code": j.code, "type": j.type,
             "currency": (j.currency_id or j.company_id.currency_id).name,
             "default_account": {"id": j.default_account_id.id, "code": j.default_account_id.code} if j.default_account_id else None}
            for j in request.env["account.journal"].search(domain, order="sequence, id")
        ]

    @api_route("/finance/taxes", profiles=PURCHASE_READ)
    def taxes(self, **kw):
        domain = [("company_id", "=", request.env.company.id)]
        use = kw.get("use")
        if achats_only(FIN_READ):
            # Profil Achats : taxes d'achat seules (TVA déductible et retenues sur achats).
            if use and use != "purchase":
                raise ApiError(403, "forbidden", "Profil Achats : taxes d'achat seulement.")
            use = "purchase"
        if use in ("sale", "purchase"):
            domain.append(("type_tax_use", "=", use))
        # Nature fiscale (TVA ou retenue) ; avec partner_id, les retenues par défaut du tiers sont signalées.
        partner = invoice_partner(kw)
        defaults = set(partner.eguitra_withholding_tax_ids.ids) if partner else set()
        return [{"id": t.id, "name": t.name, "amount": t.amount, "use": t.type_tax_use, "price_include": t.price_include,
                 "kind": t.tax_group_id.eguitra_kind or None, "nature": t.eguitra_withholding_nature or None,
                 "partner_default": t.id in defaults}
                for t in request.env["account.tax"].search(domain, order="sequence, id")]

    @api_route("/finance/currencies", profiles=PURCHASE_READ)
    def currencies(self, **_kw):
        currencies = request.env["res.currency"].search([("active", "=", True)])
        return [{"id": c.id, "name": c.name, "symbol": c.symbol, "rate": c.rate, "inverse_rate": c.inverse_rate,
                 "date": c.date} for c in currencies]

    @api_route("/finance/currencies/rates", methods=("POST",), profiles=("admin", "finance"))
    def set_rate(self, **_kw):
        """Taux de change saisi : 1 unité de devise = N GNF."""
        data = read_json()
        currency_id, gnf_per_unit = require(data, "currency_id", "gnf_per_unit")
        value = as_float(gnf_per_unit, "gnf_per_unit")
        if value <= 0:
            raise ApiError(422, "business_rule", "Le taux doit être positif.")
        day = parse_date(data, "date", today())
        Rate = request.env["res.currency.rate"]
        existing = Rate.search([("currency_id", "=", int(currency_id)), ("name", "=", day),
                                ("company_id", "=", request.env.company.id)], limit=1)
        values = {"inverse_company_rate": value}
        if existing:
            existing.write(values)
        else:
            Rate.create(dict(values, currency_id=int(currency_id), name=day, company_id=request.env.company.id))
        return {"status": "ok", "date": fields.Date.to_string(day)}
