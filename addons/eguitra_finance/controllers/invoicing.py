"""Paramètres des factures imprimées (Finance > Administration > Factures et journaux).

Journaux de vente : signataire et modes de règlement du bas de la facture, dernier numéro de l'ancien
système (la première facture comptabilisée prend le suivant), aperçu du prochain numéro. Journaux de
banque : banque, numéro de compte, IBAN, SWIFT et « afficher sur les factures » (tous les comptes marqués
sont listés dans les conditions de règlement). Lecture : profils de la finance ; modification :
administration seule, comme la création des comptes de trésorerie.
"""

from odoo import http
from odoo.exceptions import ValidationError
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json
from odoo.addons.eguitra_base.models.account_journal import DEFAULT_PAYMENT_METHODS, DEFAULT_SIGNATORY

from .common import FIN_READ, today
from .moves import PURCHASE_READ

ADMIN = ("admin",)
SALE_KEYS = {"signatory", "payment_methods", "legacy_last_number"}
BANK_KEYS = {"bank_name", "account_number", "iban", "swift", "show_on_invoices"}


def _text(value, size):
    return str(value or "").strip()[:size]


def _journal(journal_id, kinds=("sale", "bank")):
    journal = request.env["account.journal"].browse(journal_id).exists()
    if not journal or journal.company_id != request.env.company or journal.type not in kinds:
        raise ApiError(404, "not_found", "Journal introuvable dans la société de travail.")
    return journal


def _next_number(journal):
    """Prochain numéro du journal (lu en sudo : la direction consulte sans droit de créer une pièce)."""
    try:
        return journal.sudo()._eguitra_next_number(today())
    except (ValidationError, ValueError, KeyError):
        return None


def _sale_row(journal):
    numbered = journal._eguitra_numbered_invoice()
    return {
        "id": journal.id, "name": journal.name, "code": journal.code,
        "signatory": journal.eguitra_signatory or DEFAULT_SIGNATORY,
        "payment_methods": journal.eguitra_payment_methods or DEFAULT_PAYMENT_METHODS,
        "legacy_last_number": journal.eguitra_legacy_last_number or None,
        # Le journal numérote déjà ses factures : le dernier numéro de l'ancien système ne s'applique plus.
        "last_number": numbered.name or None,
        "next_number": _next_number(journal),
    }


def _bank_row(journal):
    # Coordonnées bancaires de la société, lues pour la direction aussi (lecture seule de la comptabilité).
    journal = journal.sudo()
    return {
        "id": journal.id, "name": journal.name, "code": journal.code,
        "currency": (journal.currency_id or journal.company_id.currency_id).name,
        "bank_name": journal.bank_id.name or None,
        "account_number": journal.bank_acc_number or None,
        "iban": journal.bank_account_id.eguitra_iban or None,
        "swift": journal.bank_id.bic or None,
        "show_on_invoices": journal.eguitra_show_on_invoices,
    }


def _refusal_error(refusal):
    return ApiError(422, "business_rule", refusal["message"], suggestion=refusal["suggestion"],
                    next_number=refusal["next"])


def _sale_values(journal, data):
    values = {}
    if "signatory" in data:
        values["eguitra_signatory"] = _text(data["signatory"], 120) or DEFAULT_SIGNATORY
    if "payment_methods" in data:
        values["eguitra_payment_methods"] = _text(data["payment_methods"], 200) or DEFAULT_PAYMENT_METHODS
    if "legacy_last_number" in data:
        number = _text(data["legacy_last_number"], 40)
        if number:
            refusal = journal._eguitra_legacy_refusal(number, today())
            if refusal:
                raise _refusal_error(refusal)
        values["eguitra_legacy_last_number"] = number or False
    return values


def _bank(name, swift):
    """Banque du référentiel du noyau (res.bank), retrouvée par son nom et son code SWIFT, sinon créée."""
    Bank = request.env["res.bank"]
    bank = Bank.search([("name", "=ilike", name), ("bic", "=", swift or False)], limit=1)
    return bank or Bank.create({"name": name, "bic": swift or False})


def _update_bank(journal, data):
    if "account_number" in data:
        number = _text(data["account_number"], 64)
        if number and journal.bank_account_id:
            journal.bank_account_id.acc_number = number
        elif number:
            journal.set_bank_account(number)
        else:
            journal.write({"bank_account_id": False, "eguitra_show_on_invoices": False})
    account = journal.bank_account_id
    if not account and ({"bank_name", "iban", "swift"} & {k for k in data if data[k]} or data.get("show_on_invoices")):
        raise ApiError(422, "business_rule", "Indiquez d'abord le numéro du compte : la banque, l'IBAN, le SWIFT et "
                                             "l'affichage sur les factures s'y rattachent.")
    if "bank_name" in data or "swift" in data:
        name = _text(data["bank_name"], 120) if "bank_name" in data else (journal.bank_id.name or "")
        swift = (_text(data["swift"], 11) if "swift" in data else (journal.bank_id.bic or "")).replace(" ", "").upper()
        account.bank_id = _bank(name or journal.name, swift) if (name or swift) else False
    if "iban" in data:
        account.eguitra_iban = _text(data["iban"], 42).replace(" ", "").upper() or False
    if "show_on_invoices" in data:
        journal.eguitra_show_on_invoices = bool(data["show_on_invoices"])


class EguitraFinanceInvoicing(http.Controller):
    @api_route("/finance/invoicing/settings", profiles=FIN_READ)
    def settings(self, **_kw):
        Journal = request.env["account.journal"]
        company = request.env.company
        return {
            "sales": [_sale_row(j) for j in Journal.search([("company_id", "=", company.id), ("type", "=", "sale")],
                                                            order="sequence, id")],
            "banks": [_bank_row(j) for j in Journal.search([("company_id", "=", company.id), ("type", "=", "bank")],
                                                           order="sequence, id")],
        }

    @api_route("/finance/invoicing/journals/<int:journal_id>", methods=("PATCH",), profiles=ADMIN)
    def update_journal(self, journal_id, **_kw):
        journal = _journal(journal_id)
        data = read_json()
        allowed = SALE_KEYS if journal.type == "sale" else BANK_KEYS
        foreign = sorted(((SALE_KEYS | BANK_KEYS) & set(data)) - allowed)
        if foreign:
            kind = "de vente" if journal.type == "sale" else "de banque"
            raise ApiError(422, "business_rule", f"Réglage sans objet pour un journal {kind} : {', '.join(foreign)}.")
        if journal.type == "sale":
            journal.write(_sale_values(journal, data))
            return _sale_row(journal)
        _update_bank(journal, data)
        return _bank_row(journal)

    @api_route("/finance/invoicing/journals/<int:journal_id>/numbering", profiles=ADMIN)
    def numbering(self, journal_id, **kw):
        """Aperçu du numéro de la prochaine facture : avec last, celui que donnerait ce dernier numéro de
        l'ancien système (422 et format continu le plus proche quand le noyau ne saurait pas le continuer)."""
        journal = _journal(journal_id, ("sale",))
        last = _text(kw.get("last"), 40)
        if not last:
            return {"next_number": _next_number(journal)}
        refusal = journal._eguitra_legacy_refusal(last, today())
        if refusal:
            raise _refusal_error(refusal)
        numbered = journal._eguitra_numbered_invoice()
        if numbered:
            raise ApiError(422, "business_rule", f"Le journal numérote déjà ses factures (dernière : {numbered.name}) : "
                                                 "le dernier numéro de l'ancien système ne s'y applique plus.")
        format_string, values = journal._eguitra_legacy_format(last, today())
        return {"next_number": format_string.format(**dict(values, seq=values["seq"] + 1))}

    @api_route("/finance/uoms", profiles=PURCHASE_READ)
    def uoms(self, **_kw):
        """Unités des lignes de facture (m³, m², heure…) : imprimées quand une ligne n'est pas en « Unité »."""
        return [{"id": u.id, "name": u.name} for u in request.env["uom.uom"].search([], order="name")]
