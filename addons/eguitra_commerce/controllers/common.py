"""Outils communs des routes des achats et des ventes (/commerce/…).

Profils (règle du projet) :
- ventes (offres, commandes des clients) : finance et direction, l'administration en consultation (elle porte
  les profils finance et direction) ; la facturation, par la finance seule (elle crée les factures) ;
- achats (bons de commande, réceptions) : le profil Achats avec ses bornes actuelles (catégorie de dépense,
  taxes d'achat, jamais le choix du compte), l'exploitation, le BTP et l'immobilier pour leurs demandes (ils
  ne voient que les bons qu'ils ont saisis ou ceux de leurs engagements), la finance, la direction ; la pièce
  d'achat, par ceux qui la saisissent aujourd'hui (administration, finance, Achats) ;
- paramètres et catalogue : administration et finance (le catalogue se lit aussi depuis les achats).

Les commandes du noyau (sale.order, purchase.order) sont manipulées avec les droits du noyau (sudo), après le
contrôle du profil par la route et celui de la société ici : l'identité de l'utilisateur est gardée (auteur
des fiches, piste d'audit), et l'installation des modules sale et purchase ne change pas les droits des
profils existants dans le noyau (aucun groupe du noyau ajouté aux profils).
"""

from odoo import Command
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError
from odoo.addons.eguitra_finance.controllers.common import (
    account_ref,
    activity_income_account,
    as_float,
    as_int,
    distribution,
    with_rules,
)
from odoo.addons.eguitra_finance.controllers.moves import category_of, chosen_account

SALES_READ = ("admin", "direction", "finance")
SALES_WRITE = ("admin", "direction", "finance")
SALES_INVOICE = ("admin", "finance")
SETTINGS = ("admin", "finance")
CATALOGUE_WRITE = ("admin", "finance")
PURCHASE_FULL = ("admin", "direction", "finance", "achats")
PURCHASE_ALL = PURCHASE_FULL + ("exploitation", "chantiers", "immobilier")
PURCHASE_BILL = ("admin", "finance", "achats")
PURCHASE_DASH = PURCHASE_FULL
CATALOGUE_READ = PURCHASE_ALL
# Comparaison des devis fournisseurs : sur les engagements, mêmes profils que leurs routes (eguitra_approval).
QUOTES = ("admin", "direction", "finance", "exploitation", "chantiers", "immobilier", "cabinet", "achats")
DISPLAY = ("line_section", "line_note")
MAX_TEXT = 500


def ref(record):
    return {"id": record.id, "name": record.display_name} if record else None


def user_ref(user):
    return {"id": user.id, "name": user.name} if user else None


def profiles():
    return set(request.env.user._eguitra_profiles())


def purchase_restricted():
    """Compte qui n'atteint les achats que par un profil métier (exploitation, BTP, immobilier) : il ne voit que
    ses demandes."""
    return not profiles() & set(PURCHASE_FULL)


def finance_user():
    """Profils qui choisissent les taxes au-delà des taxes d'achat (administration, finance, direction)."""
    return bool(profiles() & {"admin", "direction", "finance"})


def company():
    return request.env.company


def text(value, size=MAX_TEXT):
    return str(value or "").strip()[:size] or False


def check_company(record, label):
    """Fiche de la société de travail (les comptabilités sont séparées) ; 404 sinon."""
    if not record or record.company_id != request.env.company:
        raise ApiError(404, "not_found", f"{label} introuvable dans la société de travail.")
    return record


def partner_of(value, label="Tiers"):
    partner = request.env["res.partner"].sudo().browse(as_int(value, "partner_id")).exists() if value else None
    if not partner or (partner.company_id and partner.company_id != request.env.company):
        raise ApiError(422, "business_rule", f"{label} inconnu dans la société.")
    return partner


def uom_of(value, default):
    if not value:
        return default
    uom = request.env["uom.uom"].sudo().browse(as_int(value, "uom_id")).exists()
    if not uom:
        raise ApiError(422, "business_rule", "Unité inconnue.")
    return uom


def taxes_of(value, use, comp):
    """Taxes saisies : de la société et de l'usage (vente ou achat)."""
    if not isinstance(value, list):
        raise ApiError(400, "invalid_parameter", "Taxes invalides.")
    ids = {as_int(t, "tax_ids") for t in value}
    taxes = request.env["account.tax"].sudo().browse(list(ids)).exists()
    if len(taxes) != len(ids) or any(t.company_id != comp or t.type_tax_use != use for t in taxes):
        raise ApiError(422, "business_rule", "Taxe inconnue, d'une autre société ou d'un autre usage "
                                             f"({'vente' if use == 'sale' else 'achat'}).")
    return taxes


def catalogue_item(value, usage, comp):
    """Article du catalogue de la société, vendable ou achetable ; à défaut, l'article hors catalogue."""
    Template = request.env["product.template"].sudo()
    if not value:
        return Template._eguitra_generic_product(comp, usage), False
    product = request.env["product.product"].sudo().browse(as_int(value, "product_id")).exists()
    template = product.product_tmpl_id
    if not product or not template.eguitra_catalogue or template.company_id != comp or not template.active:
        raise ApiError(422, "business_rule", "Article inconnu dans le catalogue de la société.")
    if (usage == "sale" and not template.sale_ok) or (usage == "purchase" and not template.purchase_ok):
        raise ApiError(422, "business_rule", f"« {template.name} » ne se {'vend' if usage == 'sale' else 'achète'} pas.")
    return product, True


def quantity_of(line, i, key="quantity"):
    qty = as_float(line.get(key, 1), key)
    if qty <= 0:
        raise ApiError(422, "business_rule", f"Ligne {i} : la quantité est positive.")
    return qty


def discount_of(value, i):
    discount = as_float(value or 0, "discount")
    if not 0 <= discount <= 100:
        raise ApiError(422, "business_rule", f"Ligne {i} : la remise est un pourcentage, de 0 à 100.")
    return discount


def lines_payload(data):
    lines = data.get("lines")
    if not isinstance(lines, list) or not any(isinstance(l, dict) and l.get("display_type") not in DISPLAY for l in lines):
        raise ApiError(400, "missing_fields", "Au moins une ligne chiffrée est requise.", fields=["lines"])
    return lines


def sale_line_commands(data, comp):
    """Lignes d'une offre : rubriques et notes, lignes d'un article du catalogue ou libres (article hors
    catalogue), quantité, unité, prix, remise (celle de la ligne, à défaut la remise générale), taxes de vente,
    activité analytique (celle de l'article à défaut), compte (droit « Saisie libre des comptes »)."""
    commands = []
    global_discount = data.get("discount")
    for i, line in enumerate(lines_payload(data), start=1):
        sequence = i * 10
        if not isinstance(line, dict) or not str(line.get("name") or "").strip():
            raise ApiError(400, "missing_fields", f"Ligne {i} : libellé requis.")
        if line.get("display_type") in DISPLAY:
            commands.append(Command.create({"display_type": line["display_type"], "name": text(line["name"]),
                                            "sequence": sequence}))
            continue
        if line.get("display_type") not in (None, "", "product"):
            raise ApiError(400, "invalid_parameter", f"Ligne {i} : type de ligne inconnu.")
        product, listed = catalogue_item(line.get("product_id"), "sale", comp)
        template = product.product_tmpl_id
        price = as_float(line["price_unit"], "price_unit") if line.get("price_unit") not in (None, "") else (
            template.list_price if listed else 0.0)
        if price < 0:
            raise ApiError(422, "business_rule", f"Ligne {i} : le prix n'est pas négatif (une remise se saisit en %).")
        dist = distribution(line.get("analytic_distribution"), comp)
        if not dist and template.eguitra_activity_id:
            dist = {str(template.eguitra_activity_id.id): 100.0}
        values = {
            "sequence": sequence, "product_id": product.id, "name": text(line["name"]),
            "product_uom_qty": quantity_of(line, i), "price_unit": price,
            "product_uom_id": uom_of(line.get("uom_id"), template.uom_id).id,
            "discount": discount_of(line.get("discount", global_discount), i),
        }
        if "tax_ids" in line:
            taxes = taxes_of(line["tax_ids"], "sale", comp)
        elif listed:
            taxes = template.taxes_id.filtered(lambda t, c=comp: t.company_id == c)
        else:
            taxes = comp.account_sale_tax_id
        values["tax_ids"] = [Command.set(taxes.ids)]
        account = chosen_account(line.get("account_id"), comp, f"Ligne {i} : compte")
        if not account and not listed:
            account = activity_income_account(dist, comp)
        if account:
            values["eguitra_account_id"] = account.id
        dist = with_rules(dist, account or None, None, comp) if (dist or account) else dist
        if dist:
            values["analytic_distribution"] = dist
        commands.append(Command.create(values))
    return commands


def purchase_line_commands(data, comp, commitment=None, planned=None):
    """Lignes d'un bon de commande : article du catalogue (son compte de charge et ses taxes d'achat), ou ligne
    libre par catégorie de dépense (son compte et sa TVA), ou ligne de l'engagement (son compte et son
    analytique) ; jamais le choix du compte sans le droit de saisie libre, taxes d'achat de la société."""
    commands = []
    for i, line in enumerate(lines_payload(data), start=1):
        sequence = i * 10
        if not isinstance(line, dict) or not str(line.get("name") or "").strip():
            raise ApiError(400, "missing_fields", f"Ligne {i} : libellé requis.")
        if line.get("display_type") in DISPLAY:
            commands.append(Command.create({"display_type": line["display_type"], "name": text(line["name"]),
                                            "sequence": sequence}))
            continue
        if line.get("display_type") not in (None, "", "product"):
            raise ApiError(400, "invalid_parameter", f"Ligne {i} : type de ligne inconnu.")
        product, listed = catalogue_item(line.get("product_id"), "purchase", comp)
        template = product.product_tmpl_id
        category = category_of(line.get("category_id"), comp).sudo()
        if category and category.is_entry():
            raise ApiError(422, "business_rule", f"Ligne {i} : la catégorie « {category.name} » se passe en opération "
                                                 "diverse (personnel, organismes sociaux, État), jamais par un bon de commande.")
        account = category.account_id
        if not account and line.get("account_id"):
            account = chosen_account(line["account_id"], comp, f"Ligne {i} : compte")
        if not account and not listed and commitment and commitment.account_id:
            account = commitment.sudo().account_id
        if not (account or listed):
            raise ApiError(422, "business_rule", f"Ligne {i} : choisissez un article du catalogue ou la catégorie de "
                                                 "dépense, dont la ligne prend le compte.")
        price = as_float(line["price_unit"], "price_unit") if line.get("price_unit") not in (None, "") else (
            template.standard_price if listed else 0.0)
        if price < 0:
            raise ApiError(422, "business_rule", f"Ligne {i} : le prix n'est pas négatif.")
        default_tax = comp.account_purchase_tax_id
        if "tax_ids" in line:
            taxes = taxes_of(line["tax_ids"], "purchase", comp)
        elif category:
            taxes = category.taxes(default_tax)
        elif listed:
            taxes = template.supplier_taxes_id.filtered(lambda t, c=comp: t.company_id == c)
        else:
            taxes = default_tax
        dist = distribution(line.get("analytic_distribution"), comp)
        if not dist and commitment and commitment.analytic_distribution:
            dist = dict(commitment.sudo().analytic_distribution)
        if not dist and template.eguitra_activity_id:
            dist = {str(template.eguitra_activity_id.id): 100.0}
        dist = with_rules(dist, account or None, None, comp) if (dist or account) else dist
        values = {
            "sequence": sequence, "product_id": product.id, "name": text(line["name"]),
            "product_qty": quantity_of(line, i), "price_unit": price,
            "product_uom_id": uom_of(line.get("uom_id"), template.uom_id).id,
            "discount": discount_of(line.get("discount"), i), "tax_ids": [Command.set(taxes.ids)],
            "date_planned": planned,
        }
        if category:
            values["eguitra_expense_category_id"] = category.id
        if account:
            values["eguitra_account_id"] = account.id
        if dist:
            values["analytic_distribution"] = dist
        commands.append(Command.create(values))
    return commands


def order_line_of(order, value):
    """Ligne de la commande désignée par l'écran (jamais une ligne d'une autre commande)."""
    line_id = as_int(value, "id")
    return order.order_line.filtered(lambda l: l.id == line_id)


def line_row(line, kind):
    """Ligne d'une offre ou d'un bon de commande."""
    qty = line.product_uom_qty if kind == "sale" else line.product_qty
    row = {
        "id": line.id, "display_type": line.display_type or "product", "name": line.name, "sequence": line.sequence,
        "product": ({"id": line.product_id.id, "name": line.product_id.display_name,
                     "catalogue": bool(line.product_id.product_tmpl_id.eguitra_catalogue)}
                    if line.product_id and not line.display_type else None),
        "quantity": qty, "uom": {"id": line.product_uom_id.id, "name": line.product_uom_id.name} if line.product_uom_id else None,
        "price_unit": line.price_unit, "discount": line.discount,
        "taxes": [{"id": t.id, "name": t.name, "amount": t.amount} for t in line.tax_ids],
        "price_subtotal": line.price_subtotal, "price_total": line.price_total,
        "analytic_distribution": line.analytic_distribution or {},
        "account": account_ref(line.eguitra_account_id),
        "qty_invoiced": line.qty_invoiced,
    }
    if kind == "sale":
        row.update({"qty_delivered": line.qty_delivered, "qty_to_invoice": line.qty_to_invoice,
                    "is_downpayment": line.is_downpayment})
    else:
        row.update({"qty_received": line.qty_received, "qty_to_bill": max(line.qty_received - line.qty_invoiced, 0.0),
                    "category": ref(line.eguitra_expense_category_id)})
    return row

