"""Fiscalité guinéenne (TVA), exports d'audit et passerelle IFRS."""

import csv
import io

from dateutil.relativedelta import relativedelta

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg
from odoo.addons.eguitra_api.files import XLSX_OPTIONS, csv_text

from ..models.report_registry import ACC_CODE, ACC_NAME, JRN_NAME
from .common import FIN_READ, companies, parse_date, today

# Correspondance indicative SYSCOHADA -> IFRS, à valider avec l'expert-comptable.
IFRS_MAP = [
    ("Immobilisations incorporelles (IAS 38)", "actif", ["AD"]),
    ("Immobilisations corporelles (IAS 16)", "actif", ["AI", "AP"]),
    ("Actifs financiers non courants (IFRS 9)", "actif", ["AQ"]),
    ("Stocks (IAS 2)", "actif", ["BB"]),
    ("Clients et autres débiteurs", "actif", ["BA", "BH", "BI", "BJ", "BU"]),
    ("Trésorerie et équivalents (IAS 7)", "actif", ["BQ", "BR", "BS"]),
    ("Capitaux propres", "passif", ["CP"]),
    ("Emprunts et dettes financières (IFRS 9)", "passif", ["DA"]),
    ("Dettes locatives (IFRS 16)", "passif", ["DB"]),
    ("Provisions (IAS 37)", "passif", ["DC", "DN"]),
    ("Fournisseurs et autres créditeurs", "passif", ["DH", "DI", "DJ", "DK", "DM", "DV"]),
    ("Concours bancaires courants", "passif", ["DQ", "DR"]),
    ("Produits des activités ordinaires (IFRS 15)", "resultat", ["XB"]),
    ("Autres produits opérationnels", "resultat", ["TE", "TF", "TG", "TH", "TI"]),
    ("Achats et variations de stocks", "resultat_charge", ["RA", "RB", "RC", "RD", "RE", "RF"]),
    ("Charges externes", "resultat_charge", ["RG", "RH", "RJ"]),
    ("Impôts et taxes", "resultat_charge", ["RI"]),
    ("Charges de personnel (IAS 19)", "resultat_charge", ["RK"]),
    ("Dotations nettes aux amortissements et provisions", "resultat_net", ["RL", "TJ"]),
    ("Résultat financier", "resultat", ["XF"]),
    ("Résultat HAO (éléments non courants)", "resultat", ["XH"]),
    ("Impôt sur le résultat (IAS 12)", "resultat_charge", ["RS", "RQ"]),
    ("Résultat net de la période", "resultat", ["XI"]),
]


class EguitraFinanceFiscal(http.Controller):
    @api_route("/finance/fiscal/vat", profiles=FIN_READ)
    def vat(self, **kw):
        """Déclaration mensuelle de TVA préparée à partir des écritures : collectée, déductible, solde."""
        year = int_arg(kw, "year", today().year)
        month = int_arg(kw, "month", today().month, 1, 12)
        start = today().replace(year=year, month=month, day=1)
        end = start + relativedelta(months=1, days=-1)
        request.env.flush_all()
        cr = request.env.cr
        cr.execute(
            """SELECT tax.id, COALESCE(tax.name->>'fr_FR', tax.name->>'en_US'), tax.type_tax_use, tax.amount,
                      COALESCE(SUM(aml.balance), 0)
                 FROM account_move_line aml
                 JOIN account_tax tax ON tax.id = aml.tax_line_id
                WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%s) AND aml.date BETWEEN %s AND %s
             GROUP BY 1, 2, 3, 4 ORDER BY 3 DESC, 2""",
            (list(companies(kw).ids), start, end),
        )
        taxes = []
        collected = deductible = 0.0
        for tax_id, name, use, rate, balance in cr.fetchall():
            amount = -float(balance) if use == "sale" else float(balance)
            taxes.append({"tax_id": tax_id, "name": name, "use": use, "rate": float(rate), "amount": amount})
            if use == "sale":
                collected += amount
            else:
                deductible += amount
        cr.execute(
            """SELECT tax.type_tax_use, COALESCE(SUM(aml.balance), 0)
                 FROM account_move_line aml
                 JOIN account_move_line_account_tax_rel rel ON rel.account_move_line_id = aml.id
                 JOIN account_tax tax ON tax.id = rel.account_tax_id
                WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%s) AND aml.date BETWEEN %s AND %s
             GROUP BY 1""",
            (list(companies(kw).ids), start, end),
        )
        bases = {use: float(b) for use, b in cr.fetchall()}
        balance = collected - deductible
        return {
            "period": {"from": start, "to": end},
            "taxes": taxes,
            "base_sales": -bases.get("sale", 0.0),
            "base_purchases": bases.get("purchase", 0.0),
            "vat_collected": collected,
            "vat_deductible": deductible,
            "vat_due": max(balance, 0.0),
            "vat_credit": max(-balance, 0.0),
            "note": "Montants préparés à partir des écritures ; le modèle de déclaration est validé avec l'expert-comptable.",
        }

    @api_route("/finance/exports/entries", profiles=FIN_READ)
    def export_entries(self, **kw):
        """Export d'audit de toutes les écritures validées de la période (CSV ou XLSX)."""
        end = parse_date(kw, "date_to", today())
        start = parse_date(kw, "date_from", end.replace(month=1, day=1))
        if (end - start).days > 400:
            raise ApiError(422, "business_rule", "Période limitée à un exercice.")
        request.env.flush_all()
        cr = request.env.cr
        cr.execute(
            f"""SELECT aj.code, {JRN_NAME}, am.name, aml.date, {ACC_CODE}, {ACC_NAME},
                       COALESCE(p.name, ''), COALESCE(aml.name, ''), COALESCE(am.ref, ''), aml.debit, aml.credit,
                       COALESCE(aml.matching_number, ''), aml.amount_currency, cur.name, am.create_date, am.write_date
                  FROM account_move_line aml
                  JOIN account_move am ON am.id = aml.move_id
                  JOIN account_account aa ON aa.id = aml.account_id
                  JOIN account_journal aj ON aj.id = aml.journal_id
                  JOIN res_currency cur ON cur.id = aml.currency_id
             LEFT JOIN res_partner p ON p.id = aml.partner_id
                 WHERE am.state = 'posted' AND aml.company_id = ANY(%s) AND aml.date BETWEEN %s AND %s
              ORDER BY aml.date, am.name, aml.id""",
            (list(companies(kw).ids), start, end),
        )
        headers = ["Code journal", "Journal", "Pièce", "Date", "Compte", "Libellé du compte", "Tiers", "Libellé",
                   "Référence", "Débit", "Crédit", "Lettrage", "Montant devise", "Devise", "Saisie le", "Modifiée le"]
        rows = cr.fetchall()
        name = f"ecritures_{start:%Y%m%d}_{end:%Y%m%d}"
        if kw.get("format") == "xlsx":
            import xlsxwriter

            out = io.BytesIO()
            book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
            sheet = book.add_worksheet("Écritures")
            bold = book.add_format({"bold": True})
            money = book.add_format({"num_format": "# ##0"})
            day = book.add_format({"num_format": "dd/mm/yyyy"})
            sheet.write_row(0, 0, headers, bold)
            for r, row in enumerate(rows, start=1):
                for c, value in enumerate(row):
                    if c == 3:
                        sheet.write_datetime(r, c, value, day)
                    elif c in (9, 10, 12):
                        sheet.write_number(r, c, float(value or 0), money)
                    else:
                        sheet.write_string(r, c, "" if value is None else str(value))
            book.close()
            content, mime, ext = out.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
        else:
            buf = io.StringIO()
            buf.write("﻿")
            writer = csv.writer(buf, delimiter=";")
            writer.writerow(headers)
            for row in rows:
                writer.writerow([
                    csv_text(row[0]), csv_text(row[1]), csv_text(row[2]), row[3].strftime("%d/%m/%Y"), csv_text(row[4]),
                    csv_text(row[5]), csv_text(row[6]), csv_text(row[7]), csv_text(row[8]),
                    f"{row[9]:.0f}", f"{row[10]:.0f}", csv_text(row[11]), f"{row[12]:.2f}", row[13], row[14], row[15],
                ])
            content, mime, ext = buf.getvalue().encode("utf-8"), "text/csv; charset=utf-8", "csv"
        return request.make_response(content, headers=[
            ("Content-Type", mime), ("Content-Disposition", f'attachment; filename="{name}.{ext}"'),
        ])

    @api_route("/finance/ifrs", profiles=FIN_READ)
    def ifrs(self, **kw):
        """Passerelle IFRS : agrégats SYSCOHADA regroupés selon les postes IFRS usuels."""
        end = parse_date(kw, "date", today())
        start = end.replace(month=1, day=1)
        syscohada = request.env["eguitra.syscohada"].sudo()
        sheet = syscohada.balance_sheet(companies(kw), end)
        result = syscohada.income_statement(companies(kw), start, end)
        values = {line["code"]: line["amount"] for line in sheet["actif"] + sheet["passif"] + result["lines"]}
        lines = []
        for label, kind, codes in IFRS_MAP:
            if kind == "resultat_net":
                amount = values.get("RL", 0.0) - values.get("TJ", 0.0)
            else:
                amount = sum(values.get(c, 0.0) for c in codes)
            lines.append({"label": label, "section": kind.split("_")[0], "amount": amount, "syscohada": codes})
        return {"date": end, "lines": lines, "note": "Correspondance indicative, à valider avec l'expert-comptable."}
