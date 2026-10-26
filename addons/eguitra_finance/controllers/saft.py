"""Export SAF-T (Standard Audit File for Tax, OCDE, version 2.0) d'une société sur une période.

En-tête : pays GN, société avec NIF et RCCM, devise GNF, période. Fichiers de référence : comptes
avec leurs vrais soldes d'ouverture (antérieurs à la période, plus à-nouveaux du journal AN) et de
clôture ; clients et fournisseurs avec leur compte réel ; table des taxes réelle (TVA, retenues à
la source, autres). Écritures : une transaction par pièce validée (hors à-nouveaux, déjà dans les
soldes d'ouverture), date de saisie réelle, lignes au débit ou au crédit, informations de taxe.
Le fichier est écrit par lots de pièces dans un fichier temporaire puis transmis en flux : la
mémoire du serveur ne dépend pas du volume de l'exercice. Une période déséquilibrée est signalée
dans le fichier (commentaire en tête) et dans l'en-tête HTTP X-Eguitra-Warning.
"""

import re
import tempfile
from xml.sax.saxutils import escape

from werkzeug.wsgi import wrap_file

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route

from ..models.finance_metrics import ACC_CODE, CARRIED_LINES
from ..models.report_registry import ACC_NAME
from ..models.syscohada import OPENING_JOURNAL
from .common import FIN_READ, parse_date, today

BATCH = 500
INVALID_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
NAMESPACE = "urn:OECD:StandardAuditFile-Tax:2.00"
TAX_TYPES = {"vat": ("TVA", "Taxe sur la valeur ajoutée"), "withholding": ("RAS", "Retenues à la source"),
             "other": ("AUTRE", "Autres taxes")}


def _text(value, limit=None):
    text = INVALID_XML.sub("", "" if value is None else str(value))
    return escape(text[:limit] if limit else text)


def _amount(value):
    return f"{float(value or 0):.2f}"


class _Writer:
    def __init__(self, stream):
        self.stream = stream

    def raw(self, text):
        self.stream.write(text.encode("utf-8"))

    def el(self, tag, value, limit=None):
        if value not in (None, ""):
            self.raw(f"<{tag}>{_text(value, limit)}</{tag}>")

    def balance(self, prefix, amount):
        """Solde débiteur ou créditeur (un seul des deux éléments, positif)."""
        if amount >= 0:
            self.raw(f"<{prefix}DebitBalance>{_amount(amount)}</{prefix}DebitBalance>")
        else:
            self.raw(f"<{prefix}CreditBalance>{_amount(-amount)}</{prefix}CreditBalance>")


class EguitraFinanceSaft(http.Controller):
    @api_route("/finance/exports/saft", profiles=FIN_READ)
    def saft(self, **kw):
        if kw.get("scope") == "group":
            raise ApiError(422, "business_rule", "Le fichier SAF-T porte sur une seule société.")
        company = request.env.company.sudo()
        end = parse_date(kw, "date_to", today())
        fy_start = request.env["eguitra.finance.metrics"].fiscal_year_bounds(company, end)[0]
        start = parse_date(kw, "date_from", fy_start)
        # Une période dans un seul exercice : les comptes de gestion repartent de zéro à son début, et chaque
        # compte vérifie ouverture + écritures = clôture.
        if start > end or start < fy_start:
            raise ApiError(400, "invalid_parameter",
                           f"Période limitée à un exercice : du {fy_start:%d/%m/%Y} au {end:%d/%m/%Y} au plus.")
        request.env.flush_all()
        cr = request.env.cr
        params = {"company": company.id, "start": start, "end": end, "an": OPENING_JOURNAL, "fy_start": fy_start}

        cr.execute(
            """SELECT COUNT(DISTINCT aml.move_id), COALESCE(SUM(aml.debit), 0), COALESCE(SUM(aml.credit), 0)
                 FROM account_move_line aml JOIN account_journal aj ON aj.id = aml.journal_id
                WHERE aml.company_id = %(company)s AND aml.parent_state = 'posted'
                  AND aml.date BETWEEN %(start)s AND %(end)s AND aj.code != %(an)s""",
            params,
        )
        count, total_debit, total_credit = cr.fetchone()
        warning = None
        if abs(float(total_debit) - float(total_credit)) > 0.01:
            warning = (f"Période déséquilibrée : débit {_amount(total_debit)}, crédit {_amount(total_credit)}, "
                       f"écart {_amount(float(total_debit) - float(total_credit))}.")

        stream = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024)
        w = _Writer(stream)
        w.raw('<?xml version="1.0" encoding="UTF-8"?>\n')
        if warning:
            w.raw(f"<!-- Attention : {_text(warning)} -->\n")
        w.raw(f'<AuditFile xmlns="{NAMESPACE}">')
        self._header(w, company, start, end)
        w.raw("<MasterFiles>")
        self._accounts(w, cr, params)
        self._partners(w, cr, params, "asset_receivable", "Customers", "Customer", "CustomerID")
        self._partners(w, cr, params, "liability_payable", "Suppliers", "Supplier", "SupplierID")
        tax_kinds = self._taxes(w, company)
        w.raw("</MasterFiles>")
        w.raw("<GeneralLedgerEntries>")
        w.el("NumberOfEntries", count)
        w.el("TotalDebit", _amount(total_debit))
        w.el("TotalCredit", _amount(total_credit))
        self._entries(w, cr, params, tax_kinds)
        w.raw("</GeneralLedgerEntries></AuditFile>\n")

        size = stream.tell()
        stream.seek(0)
        headers = [
            ("Content-Type", "application/xml; charset=utf-8"),
            ("Content-Disposition", f'attachment; filename="SAF-T_GN_{start:%Y%m%d}_{end:%Y%m%d}.xml"'),
            ("Content-Length", str(size)),
            ("Cache-Control", "no-store"),
        ]
        if warning:
            headers.append(("X-Eguitra-Warning", warning.encode("ascii", "replace").decode()))
        response = request.make_response(wrap_file(request.httprequest.environ, stream), headers=headers)
        response.direct_passthrough = True
        return response

    # ─── En-tête et fichiers de référence ────────────────────────────────

    def _header(self, w, company, start, end):
        version = request.env["ir.module.module"].sudo().search([("name", "=", "eguitra_finance")], limit=1)
        w.raw("<Header>")
        w.el("AuditFileVersion", "2.00")
        w.el("AuditFileCountry", "GN")
        w.el("AuditFileDateCreated", fields.Date.to_string(today()))
        w.el("SoftwareCompanyName", "E-VOLUTION XP")
        w.el("SoftwareID", "EGUITRA Finance")
        w.el("SoftwareVersion", version.latest_version or "19.0")
        w.raw("<Company>")
        w.el("RegistrationNumber", company.company_registry or "")
        w.el("Name", company.name, 70)
        w.raw("<Address>")
        w.el("StreetName", company.street or "", 70)
        w.el("City", company.city or "", 35)
        w.el("Country", company.country_id.code or "GN")
        w.raw("</Address>")
        w.raw("<TaxRegistration>")
        w.el("TaxRegistrationNumber", company.vat or "")
        w.el("TaxType", "TVA")
        w.raw("</TaxRegistration>")
        w.raw("</Company>")
        w.el("DefaultCurrencyCode", company.currency_id.name or "GNF")
        w.raw("<SelectionCriteria>")
        w.el("SelectionStartDate", fields.Date.to_string(start))
        w.el("SelectionEndDate", fields.Date.to_string(end))
        w.raw("</SelectionCriteria>")
        w.el("HeaderComment", "Soldes d'ouverture : écritures antérieures et à-nouveaux (journal AN) de la période.")
        w.el("TaxAccountingBasis", "A")
        w.raw("</Header>")

    def _accounts(self, w, cr, params):
        """Comptes, soldes d'ouverture et de clôture. Les comptes de gestion (classes 6 à 8) repartent de
        zéro au début de l'exercice ; le résultat des exercices précédents est porté, comme dans le noyau,
        au compte d'affectation du résultat (ouverture et clôture)."""
        cr.execute(
            f"""SELECT {ACC_CODE}, MAX({ACC_NAME}),
                       COALESCE(SUM(CASE WHEN aml.date < %(start)s OR aj.code = %(an)s THEN aml.balance END), 0),
                       COALESCE(SUM(aml.balance), 0)
                  FROM account_move_line aml
                  JOIN account_account aa ON aa.id = aml.account_id
                  JOIN account_journal aj ON aj.id = aml.journal_id
                 WHERE aml.company_id = %(company)s AND aml.parent_state = 'posted' AND aml.date <= %(end)s
                   AND (aml.date >= %(fy_start)s OR {CARRIED_LINES})
              GROUP BY 1""",
            params,
        )
        accounts = {code: [name, float(opening), float(closing)] for code, name, opening, closing in cr.fetchall() if code}
        company = request.env["res.company"].sudo().browse(params["company"])
        for code, name, balance in request.env["eguitra.finance.metrics"].sudo().previous_results(company, params["fy_start"]):
            row = accounts.setdefault(code, [name, 0.0, 0.0])
            row[1] += balance
            row[2] += balance
        w.raw("<GeneralLedgerAccounts>")
        for code in sorted(accounts):
            name, opening, closing = accounts[code]
            w.raw("<Account>")
            w.el("AccountID", code)
            w.el("AccountDescription", name, 255)
            w.el("StandardAccountID", code[:4])
            w.el("AccountType", "GL")
            w.balance("Opening", float(opening))
            w.balance("Closing", float(closing))
            w.raw("</Account>")
        w.raw("</GeneralLedgerAccounts>")

    def _partners(self, w, cr, params, account_type, group, tag, key):
        cr.execute(
            f"""SELECT aml.partner_id, MAX({ACC_CODE}),
                       COALESCE(SUM(CASE WHEN aml.date < %(start)s OR aj.code = %(an)s THEN aml.balance END), 0),
                       COALESCE(SUM(aml.balance), 0)
                  FROM account_move_line aml
                  JOIN account_account aa ON aa.id = aml.account_id
                  JOIN account_journal aj ON aj.id = aml.journal_id
                 WHERE aml.company_id = %(company)s AND aml.parent_state = 'posted' AND aml.date <= %(end)s
                   AND aa.account_type = %(type)s AND aml.partner_id IS NOT NULL
              GROUP BY 1 ORDER BY 1""",
            dict(params, type=account_type),
        )
        rows = cr.fetchall()
        partners = {p.id: p for p in request.env["res.partner"].sudo().with_context(active_test=False).browse(
            [r[0] for r in rows])}
        w.raw(f"<{group}>")
        for partner_id, account, opening, closing in rows:
            partner = partners.get(partner_id)
            w.raw(f"<{tag}>")
            w.el(key, partner_id)
            w.el("AccountID", account)
            w.el("Name", partner.name if partner else "", 70)
            if partner and partner.vat:
                w.raw("<TaxRegistration>")
                w.el("TaxRegistrationNumber", partner.vat)
                w.raw("</TaxRegistration>")
            w.balance("Opening", float(opening))
            w.balance("Closing", float(closing))
            w.raw(f"</{tag}>")
        w.raw(f"</{group}>")

    def _taxes(self, w, company):
        taxes = request.env["account.tax"].sudo().with_context(active_test=False).search(
            [("company_id", "=", company.id)], order="type_tax_use, sequence, id")
        vat_groups = set(request.env["account.tax"].sudo().eguitra_vat_group_ids(company))
        by_kind = {}
        for tax in taxes:
            kind = "vat" if tax.tax_group_id.id in vat_groups else tax.tax_group_id.eguitra_kind or "other"
            by_kind.setdefault(kind if kind in TAX_TYPES else "other", []).append(tax)
        w.raw("<TaxTable>")
        for kind, items in by_kind.items():
            tax_type, description = TAX_TYPES[kind]
            w.raw("<TaxTableEntry>")
            w.el("TaxType", tax_type)
            w.el("Description", description)
            for tax in items:
                w.raw("<TaxCodeDetails>")
                w.el("TaxCode", tax.id)
                w.el("Description", f"{tax.name} ({'ventes' if tax.type_tax_use == 'sale' else 'achats'})", 255)
                w.el("TaxPercentage", f"{tax.amount:.2f}")
                w.el("Country", "GN")
                w.raw("</TaxCodeDetails>")
            w.raw("</TaxTableEntry>")
        w.raw("</TaxTable>")
        return {tax.id: ("vat" if tax.tax_group_id.id in vat_groups else tax.tax_group_id.eguitra_kind or "other")
                for tax in taxes}

    # ─── Écritures ────────────────────────────────────────────────────────

    def _entries(self, w, cr, params, tax_kinds):
        cr.execute(
            """SELECT am.id FROM account_move am JOIN account_journal aj ON aj.id = am.journal_id
                WHERE am.company_id = %(company)s AND am.state = 'posted' AND am.date BETWEEN %(start)s AND %(end)s
                  AND aj.code != %(an)s
             ORDER BY aj.code, am.date, am.name, am.id""",
            params,
        )
        move_ids = [r[0] for r in cr.fetchall()]
        company_currency = request.env.company.currency_id.id
        current_journal = None
        for i in range(0, len(move_ids), BATCH):
            batch = move_ids[i:i + BATCH]
            cr.execute(
                """SELECT am.id, aj.id, aj.code, COALESCE(aj.name->>'fr_FR', aj.name->>'en_US', aj.code), aj.type, am.name,
                          am.date, COALESCE(am.ref, ''), am.create_date, COALESCE(u.login, ''), am.move_type,
                          am.commercial_partner_id
                     FROM account_move am
                     JOIN account_journal aj ON aj.id = am.journal_id
                LEFT JOIN res_users u ON u.id = am.create_uid
                    WHERE am.id = ANY(%s)""",
                (batch,),
            )
            moves = {r[0]: r for r in cr.fetchall()}
            cr.execute(
                f"""SELECT aml.move_id, aml.id, {ACC_CODE}, aa.account_type, aml.partner_id, COALESCE(aml.name, ''),
                           aml.debit, aml.credit, aml.currency_id, cur.name, aml.amount_currency, aml.tax_line_id,
                           tax.amount, aml.balance
                      FROM account_move_line aml
                      JOIN account_account aa ON aa.id = aml.account_id
                      JOIN res_currency cur ON cur.id = aml.currency_id
                 LEFT JOIN account_tax tax ON tax.id = aml.tax_line_id
                     WHERE aml.move_id = ANY(%(ids)s)
                  ORDER BY aml.move_id, aml.id""",
                {"ids": batch},
            )
            lines = {}
            for row in cr.fetchall():
                lines.setdefault(row[0], []).append(row)
            for move_id in batch:
                move = moves[move_id]
                _id, journal_id, journal_code, journal_name, journal_type, name, day, ref, created, login, move_type, partner = move
                if journal_id != current_journal:
                    if current_journal is not None:
                        w.raw("</Journal>")
                    current_journal = journal_id
                    w.raw("<Journal>")
                    w.el("JournalID", journal_code)
                    w.el("Description", journal_name)
                    w.el("Type", journal_type)
                w.raw("<Transaction>")
                w.el("TransactionID", name or move_id)
                w.el("Period", day.month)
                w.el("PeriodYear", day.year)
                w.el("TransactionDate", fields.Date.to_string(day))
                w.el("SourceID", login)
                w.el("Description", ref or name, 255)
                w.el("SystemEntryDate", fields.Datetime.to_string(created).replace(" ", "T") if created else None)
                w.el("GLPostingDate", fields.Date.to_string(day))
                if partner and move_type.startswith("out_"):
                    w.el("CustomerID", partner)
                elif partner and move_type.startswith("in_"):
                    w.el("SupplierID", partner)
                for (_m, line_id, code, account_type, line_partner, label, debit, credit, currency_id, currency,
                     amount_currency, tax_id, tax_rate, balance) in lines.get(move_id, []):
                    w.raw("<TransactionLine>")
                    w.el("RecordID", line_id)
                    w.el("AccountID", code)
                    if line_partner and account_type == "asset_receivable":
                        w.el("CustomerID", line_partner)
                    elif line_partner and account_type == "liability_payable":
                        w.el("SupplierID", line_partner)
                    w.el("Description", label or name, 255)
                    side = "DebitAmount" if float(debit) >= float(credit) and float(debit) else "CreditAmount"
                    amount = float(debit) if side == "DebitAmount" else float(credit)
                    w.raw(f"<{side}><Amount>{_amount(amount)}</Amount>")
                    if currency_id != company_currency and amount_currency:
                        w.el("CurrencyCode", currency)
                        w.el("CurrencyAmount", _amount(abs(float(amount_currency))))
                    w.raw(f"</{side}>")
                    if tax_id:
                        tax_type = TAX_TYPES.get(tax_kinds.get(tax_id, "other"), TAX_TYPES["other"])[0]
                        w.raw("<TaxInformation>")
                        w.el("TaxType", tax_type)
                        w.el("TaxCode", tax_id)
                        w.el("TaxPercentage", f"{float(tax_rate or 0):.2f}")
                        w.raw(f"<TaxAmount><Amount>{_amount(abs(float(balance)))}</Amount></TaxAmount>")
                        w.raw("</TaxInformation>")
                    w.raw("</TransactionLine>")
                w.raw("</Transaction>")
        if current_journal is not None:
            w.raw("</Journal>")
