"""Catalogue des articles et des prestations de la société de travail, et ses référentiels de saisie
(unités, taxes, activités, catégories de dépense). Import d'un fichier CSV (ou XLSX) au modèle fourni."""

import csv
import io

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json
from odoo.addons.eguitra_api.files import workbook_rows
from odoo.addons.eguitra_finance.controllers.common import account_ref, as_float, as_int, require_free_accounts
from odoo.addons.eguitra_finance.controllers.exporting import table_response
from odoo.addons.eguitra_finance.models.analytic import ACTIVITY_PLAN

from .common import CATALOGUE_READ, CATALOGUE_WRITE, company, finance_user, purchase_restricted, ref, text

MAX_IMPORT = 5 * 1024 * 1024
KINDS = {"service": "service", "prestation": "service", "article": "consu", "fourniture": "consu"}
# Colonnes du modèle d'import : clé, libellé de l'en-tête, exemple.
COLUMNS = [
    ("name", "Nom", "Location de camion-benne (jour)"),
    ("kind", "Type (prestation ou article)", "prestation"),
    ("code", "Référence", "LOC-BENNE"),
    ("uom", "Unité", "Jours"),
    ("list_price", "Prix de vente HT", "1500000"),
    ("standard_price", "Prix d'achat HT", ""),
    ("income_account", "Compte de produit", "706100"),
    ("expense_account", "Compte de charge", ""),
    ("sale_tax", "TVA de vente (%)", "18"),
    ("purchase_tax", "TVA d'achat (%)", ""),
    ("activity", "Activité", "BTP"),
    ("sale_ok", "Vendu (oui ou non)", "oui"),
    ("purchase_ok", "Acheté (oui ou non)", "non"),
]
HEADER_KEYS = {label.lower(): key for key, label, _example in COLUMNS} | {key: key for key, _l, _e in COLUMNS}
# Unités des modèles de facture du client, créées au besoin (sans conversion : une unité de compte).
CLIENT_UNITS = ("ml", "ens.", "fft")


def _item(product_id):
    product = request.env["product.product"].sudo().browse(product_id).exists()
    template = product.product_tmpl_id
    if not product or not template.eguitra_catalogue or template.company_id != company():
        raise ApiError(404, "not_found", "Article introuvable dans le catalogue de la société.")
    return product


def item_row(product):
    template = product.product_tmpl_id
    comp = template.company_id
    accounts = template.with_company(comp)
    row = {
        "id": product.id, "template_id": template.id, "name": template.name, "code": template.default_code or None,
        "kind": template._eguitra_kind(), "uom": {"id": template.uom_id.id, "name": template.uom_id.name},
        "list_price": template.list_price, "standard_price": template.standard_price,
        "sale_ok": template.sale_ok, "purchase_ok": template.purchase_ok, "active": template.active,
        "sale_taxes": [{"id": t.id, "name": t.name, "amount": t.amount}
                       for t in template.taxes_id.filtered(lambda t: t.company_id == comp)],
        "purchase_taxes": [{"id": t.id, "name": t.name, "amount": t.amount}
                           for t in template.supplier_taxes_id.filtered(lambda t: t.company_id == comp)],
        "activity": ref(template.eguitra_activity_id),
    }
    if not purchase_restricted():
        row["income_account"] = account_ref(accounts.property_account_income_id)
        row["expense_account"] = account_ref(accounts.property_account_expense_id)
    return row


def _account(value, comp, label):
    if not value:
        return request.env["account.account"]
    Account = request.env["account.account"].sudo()
    if isinstance(value, str):
        # Import : le compte se désigne par son numéro (« 706100 »).
        account = Account.search([("code", "=", value.strip()), ("company_ids", "in", comp.ids)], limit=1)
    else:
        account = Account.browse(as_int(value, label)).exists()
    if not account or comp not in account.company_ids:
        raise ApiError(422, "business_rule", f"{label} absent du plan de comptes de la société.")
    return account


def _tax(value, use, comp):
    """Taxe désignée par son identifiant (saisie) ou son taux (import) ; vide : aucune."""
    Tax = request.env["account.tax"].sudo()
    if value in (None, "", []):
        return Tax
    if isinstance(value, list):
        ids = {as_int(v, "tax_ids") for v in value}
        taxes = Tax.browse(list(ids)).exists()
        if len(taxes) != len(ids):
            raise ApiError(422, "business_rule", "Taxe inconnue.")
    else:
        rate = as_float(str(value).replace(",", ".").replace("%", "").strip(), "taxe")
        taxes = Tax.search([("company_id", "=", comp.id), ("type_tax_use", "=", use), ("amount", "=", rate),
                            ("amount_type", "=", "percent")], limit=1)
        if not taxes:
            raise ApiError(422, "business_rule", f"Aucune taxe {'de vente' if use == 'sale' else 'd’achat'} de {rate:g} %.")
    if any(t.company_id != comp or t.type_tax_use != use for t in taxes):
        raise ApiError(422, "business_rule", "Taxe d'une autre société ou d'un autre usage.")
    return taxes


def _uom(value):
    Uom = request.env["uom.uom"].sudo()
    if not value:
        return request.env.ref("uom.product_uom_unit")
    if isinstance(value, int) or (isinstance(value, str) and value.isdigit()):
        uom = Uom.browse(int(value)).exists()
    else:
        name = str(value).strip()
        uom = Uom.search([("name", "=ilike", name)], limit=1)
        if not uom and name in CLIENT_UNITS:
            uom = Uom.create({"name": name, "relative_factor": 1.0})
    if not uom:
        raise ApiError(422, "business_rule", f"Unité inconnue : {value}.")
    return uom


def _activity(value, comp):
    if not value:
        return request.env["account.analytic.account"]
    plan = request.env.ref(ACTIVITY_PLAN)
    Analytic = request.env["account.analytic.account"].sudo()
    if isinstance(value, int) or (isinstance(value, str) and value.isdigit()):
        activity = Analytic.browse(int(value)).exists()
    else:
        activity = Analytic.search([("name", "=ilike", str(value).strip()), ("plan_id", "=", plan.id),
                                    ("company_id", "in", [False, comp.id])], limit=1)
    if not activity or activity.root_plan_id != plan or (activity.company_id and activity.company_id != comp):
        raise ApiError(422, "business_rule", f"Activité inconnue dans la société : {value}.")
    return activity


def _bool(value, default):
    if value in (None, ""):
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "oui", "o", "yes", "vrai", "true", "x")


def _values(data, comp, creating):
    """Valeurs d'un article ; les comptes se choisissent avec le droit « Saisie libre des comptes »."""
    values = {}
    if creating or "name" in data:
        name = text(data.get("name"), 200)
        if not name:
            raise ApiError(400, "missing_fields", "Le nom de l'article est obligatoire.", fields=["name"])
        values["name"] = name
    if creating or "kind" in data:
        kind = KINDS.get(str(data.get("kind") or "service").strip().lower())
        if not kind:
            raise ApiError(422, "business_rule", "Type d'article : prestation ou article.")
        values["type"] = kind
    if "code" in data:
        values["default_code"] = text(data["code"], 60)
    if creating or "uom" in data or "uom_id" in data:
        values["uom_id"] = _uom(data.get("uom_id") or data.get("uom")).id
    for key in ("list_price", "standard_price"):
        if key in data and data[key] not in (None, ""):
            amount = as_float(str(data[key]).replace(" ", "").replace(",", "."), key)
            if amount < 0:
                raise ApiError(422, "business_rule", "Un prix n'est pas négatif.")
            values[key] = amount
    for key in ("sale_ok", "purchase_ok"):
        if creating or key in data:
            values[key] = _bool(data.get(key), key == "sale_ok" or bool(data.get("standard_price")))
    if "sale_tax_ids" in data or "sale_tax" in data or creating:
        taxes = _tax(data.get("sale_tax_ids", data.get("sale_tax")), "sale", comp) if (
            "sale_tax_ids" in data or "sale_tax" in data) else comp.account_sale_tax_id
        values["taxes_id"] = [(6, 0, taxes.ids)]
    if "purchase_tax_ids" in data or "purchase_tax" in data or creating:
        taxes = _tax(data.get("purchase_tax_ids", data.get("purchase_tax")), "purchase", comp) if (
            "purchase_tax_ids" in data or "purchase_tax" in data) else comp.account_purchase_tax_id
        values["supplier_taxes_id"] = [(6, 0, taxes.ids)]
    if "activity_id" in data or "activity" in data:
        values["eguitra_activity_id"] = _activity(data.get("activity_id") or data.get("activity"), comp).id or False
    accounts = {}
    for key, field, label in (("income_account", "property_account_income_id", "Compte de produit"),
                              ("expense_account", "property_account_expense_id", "Compte de charge")):
        for source in (f"{key}_id", key):
            if source in data:
                account = _account(data[source], comp, label)
                if account:
                    require_free_accounts(f"{label} de l'article")
                accounts[field] = account.id or False
    return values, accounts


def _save(template, values, accounts, comp):
    if values:
        template.write(values)
    if accounts:
        template.with_company(comp).write(accounts)
    # Facturation des fournisseurs sur les quantités reçues (rapprochement), des clients selon la commande.
    template.write({"purchase_method": "receive", "invoice_policy": "order"})


class EguitraCommerceCatalogue(http.Controller):
    @api_route("/commerce/catalogue", profiles=CATALOGUE_READ)
    def catalogue(self, **kw):
        """Articles du catalogue de la société de travail ; usage=sale ou purchase, search, inactive=1."""
        domain = [("eguitra_catalogue", "=", True), ("company_id", "=", company().id)]
        if kw.get("usage") == "sale":
            domain.append(("sale_ok", "=", True))
        elif kw.get("usage") == "purchase":
            domain.append(("purchase_ok", "=", True))
        if kw.get("search"):
            domain += ["|", ("name", "ilike", kw["search"]), ("default_code", "ilike", kw["search"])]
        Product = request.env["product.product"].sudo().with_context(active_test=kw.get("inactive") != "1")
        products = Product.search(domain, limit=int_arg(kw, "limit", 500, 1, 2000), order="name")
        return [item_row(p) for p in products]

    @api_route("/commerce/catalogue", methods=("POST",), profiles=CATALOGUE_WRITE)
    def create_item(self, **_kw):
        data = read_json()
        comp = company()
        values, accounts = _values(data, comp, creating=True)
        template = request.env["product.template"].sudo().with_company(comp).create(
            dict(values, company_id=comp.id, eguitra_catalogue=True))
        _save(template, {}, accounts, comp)
        return item_row(template.product_variant_id)

    @api_route("/commerce/catalogue/<int:product_id>", methods=("PATCH",), profiles=CATALOGUE_WRITE)
    def update_item(self, product_id, **_kw):
        product = _item(product_id)
        data = read_json()
        comp = company()
        values, accounts = _values(data, comp, creating=False)
        if "active" in data:
            values["active"] = bool(data["active"])
        _save(product.product_tmpl_id, values, accounts, comp)
        return item_row(product)

    @api_route("/commerce/catalogue/import-template", profiles=CATALOGUE_WRITE)
    def import_template(self, **kw):
        sheet = {"title": "Catalogue", "meta": [], "columns": [(label, "text") for _k, label, _e in COLUMNS],
                 "rows": [[example for _k, _l, example in COLUMNS]]}
        return table_response("modele-catalogue", [sheet], "csv" if kw.get("format") == "csv" else "xlsx")

    @api_route("/commerce/catalogue/import", methods=("POST",), profiles=CATALOGUE_WRITE)
    def import_items(self, **_kw):
        """Import du catalogue (CSV séparé par « ; », « , » ou tabulation, ou XLSX), au modèle fourni : un article
        par ligne ; un article de même nom (ou de même référence) est mis à jour. Tout ou rien : la première
        erreur annule l'import et donne sa ligne."""
        upload = request.httprequest.files.get("file")
        if not upload:
            raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
        content = upload.read(MAX_IMPORT + 1)
        if len(content) > MAX_IMPORT:
            raise ApiError(413, "too_large", "Fichier trop volumineux (5 Mo maximum).")
        if (upload.filename or "").lower().endswith(".xlsx"):
            rows = workbook_rows(content)
        else:
            text_ = content.decode("utf-8-sig", errors="replace")
            try:
                delimiter = csv.Sniffer().sniff(text_[:4096], delimiters=";,\t").delimiter
            except csv.Error:
                delimiter = ";"  # séparateur des tableurs en français
            rows = list(csv.reader(io.StringIO(text_), delimiter=delimiter))
        rows = [[str(c or "").strip() for c in row] for row in rows if any(str(c or "").strip() for c in row)]
        if len(rows) < 2:
            raise ApiError(422, "business_rule", "Le fichier ne contient aucun article sous la ligne d'en-tête.")
        keys = [HEADER_KEYS.get(cell.lower()) for cell in rows[0]]
        if "name" not in keys:
            raise ApiError(422, "business_rule", "Colonne « Nom » introuvable : partez du modèle de fichier.")
        comp = company()
        Template = request.env["product.template"].sudo().with_context(active_test=False)
        created = updated = 0
        for number, row in enumerate(rows[1:], start=2):
            data = {key: row[i] for i, key in enumerate(keys) if key and i < len(row) and row[i] != ""}
            if not data.get("name"):
                raise ApiError(422, "business_rule", f"Ligne {number} : nom manquant.")
            try:
                existing = Template.search([("eguitra_catalogue", "=", True), ("company_id", "=", comp.id),
                                            "|", ("name", "=", data["name"]),
                                            ("default_code", "=", data.get("code") or "\x00")], limit=1)
                values, accounts = _values(data, comp, creating=not existing)
                if existing:
                    _save(existing, values, accounts, comp)
                    updated += 1
                else:
                    template = Template.with_company(comp).create(dict(values, company_id=comp.id, eguitra_catalogue=True))
                    _save(template, {}, accounts, comp)
                    created += 1
            except ApiError as e:
                raise ApiError(e.status, e.code, f"Ligne {number} : {e.message}") from e
        return {"created": created, "updated": updated, "total": created + updated}

    @api_route("/commerce/referentials", profiles=CATALOGUE_READ)
    def referentials(self, **_kw):
        """Référentiels des écrans : unités, taxes de vente et d'achat, activités, catégories de dépense."""
        comp = company()
        env = request.env
        plan = env.ref(ACTIVITY_PLAN, raise_if_not_found=False)
        activities = env["account.analytic.account"].sudo().search(
            [("plan_id", "=", plan.id), ("company_id", "in", [False, comp.id])], order="name") if plan else []
        taxes = env["account.tax"].sudo().search([("company_id", "=", comp.id), ("active", "=", True)],
                                                 order="sequence, id")
        categories = env["eguitra.expense.category"].sudo().search([("company_id", "=", comp.id)], order="sequence, name")
        restricted = purchase_restricted()
        return {
            "uoms": [{"id": u.id, "name": u.name} for u in env["uom.uom"].sudo().search([], order="name")],
            "sale_taxes": [] if restricted else [{"id": t.id, "name": t.name, "amount": t.amount}
                                                 for t in taxes if t.type_tax_use == "sale"],
            "purchase_taxes": [{"id": t.id, "name": t.name, "amount": t.amount}
                               for t in taxes if t.type_tax_use == "purchase"],
            "default_sale_tax": ref(comp.account_sale_tax_id), "default_purchase_tax": ref(comp.account_purchase_tax_id),
            "activities": [{"id": a.id, "name": a.name} for a in activities],
            "categories": [{"id": c.id, "name": c.name, "account": None if restricted else account_ref(c.account_id),
                            "tax_mode": c.tax_mode, "entry": c.is_entry()} for c in categories],
            "entity": comp.eguitra_entity, "validity_days": comp.quotation_validity_days,
            "free_accounts": not restricted and finance_user(),
        }

