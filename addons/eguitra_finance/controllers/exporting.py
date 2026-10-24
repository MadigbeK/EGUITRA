"""Exports en tableur des déclarations et des états : un onglet par tableau, en-tête (société,
période, date d'export), textes toujours écrits comme du texte (jamais une formule).

Un tableau (« sheet ») est un dict : title, meta [(libellé, valeur)], columns [(libellé, type)],
rows [[valeurs]], totals [valeurs] ou None, et facultativement styles (liste parallèle à rows :
None, "total" ou "header" pour les lignes de regroupement). Types : text, money, number, percent,
int, days (délai à une décimale), date. Milliers groupés par « #,##0 » : Excel l'écrit avec le
séparateur du poste (« 1 234 568 » en français), alors que « # ##0 » n'est qu'une espace littérale
(« 1234 568 »).
"""

import csv
import io
from datetime import date, datetime

from odoo import fields
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError
from odoo.addons.eguitra_api.files import XLSX_OPTIONS, csv_text, xlsx_row

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def export_meta(companies, items=()):
    """En-tête commun : société(s), puis les éléments fournis [(libellé, valeur)], puis la date d'export."""
    meta = [("Société", ", ".join(companies.mapped("name")))]
    vats = [c.vat for c in companies if c.vat]
    if vats:
        meta.append(("NIF", ", ".join(vats)))
    meta.extend(items)
    meta.append(("Exporté le", fields.Datetime.context_timestamp(request.env.user, fields.Datetime.now())
                 .strftime("%d/%m/%Y %H:%M")))
    return meta


def _csv_value(value, kind):
    if value is None or value == "":
        return ""
    if kind in ("money", "int"):
        return f"{float(value):.0f}"
    if kind in ("number", "percent"):
        return f"{float(value):.2f}".replace(".", ",")
    if kind == "days":
        return f"{float(value):.1f}".replace(".", ",")
    if isinstance(value, (date, datetime)):
        return value.strftime("%d/%m/%Y")
    return csv_text(value)


def table_response(name, sheets, fmt="xlsx", csv_sheet=0):
    """Réponse de téléchargement : classeur XLSX (tous les tableaux) ou CSV (un tableau)."""
    if fmt == "csv":
        if not 0 <= csv_sheet < len(sheets):
            raise ApiError(400, "invalid_parameter", "Tableau inconnu pour l'export CSV.")
        sheet = sheets[csv_sheet]
        kinds = [kind for _label, kind in sheet["columns"]]
        buf = io.StringIO()
        buf.write("﻿")  # Excel reconnaît l'UTF-8
        writer = csv.writer(buf, delimiter=";")
        writer.writerow([csv_text(label) for label, _kind in sheet["columns"]])
        for row in sheet["rows"] + ([sheet["totals"]] if sheet.get("totals") else []):
            writer.writerow([_csv_value(v, kinds[i] if i < len(kinds) else "text") for i, v in enumerate(row)])
        content, mime, ext = buf.getvalue().encode("utf-8"), "text/csv; charset=utf-8", "csv"
    else:
        content, mime, ext = workbook(sheets), XLSX_MIME, "xlsx"
    return request.make_response(content, headers=[
        ("Content-Type", mime), ("Content-Disposition", f'attachment; filename="{name}.{ext}"'),
        ("Cache-Control", "no-store"),
    ])


def workbook(sheets):
    import xlsxwriter

    out = io.BytesIO()
    book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
    title = book.add_format({"bold": True, "font_size": 13})
    label = book.add_format({"bold": True, "font_color": "#555555"})
    head = book.add_format({"bold": True, "bg_color": "#10133A", "font_color": "#FFFFFF", "border": 1, "text_wrap": True})
    formats = {
        None: {"money": book.add_format({"num_format": "#,##0"}), "int": book.add_format({"num_format": "0"}),
               "number": book.add_format({"num_format": "#,##0.00"}), "percent": book.add_format({"num_format": "0.0"}),
               "days": book.add_format({"num_format": "#,##0.0"}),
               "date": book.add_format({"num_format": "dd/mm/yyyy"}), "text": None},
        "total": {"money": book.add_format({"bold": True, "num_format": "#,##0", "top": 2}),
                  "int": book.add_format({"bold": True, "num_format": "0", "top": 2}),
                  "number": book.add_format({"bold": True, "num_format": "#,##0.00", "top": 2}),
                  "percent": book.add_format({"bold": True, "num_format": "0.0", "top": 2}),
                  "days": book.add_format({"bold": True, "num_format": "#,##0.0", "top": 2}),
                  "date": book.add_format({"bold": True, "num_format": "dd/mm/yyyy", "top": 2}),
                  "text": book.add_format({"bold": True, "top": 2})},
        "header": {"money": book.add_format({"bold": True, "num_format": "#,##0", "bg_color": "#EEF0F6"}),
                   "int": book.add_format({"bold": True, "bg_color": "#EEF0F6"}),
                   "number": book.add_format({"bold": True, "num_format": "#,##0.00", "bg_color": "#EEF0F6"}),
                   "percent": book.add_format({"bold": True, "num_format": "0.0", "bg_color": "#EEF0F6"}),
                   "days": book.add_format({"bold": True, "num_format": "#,##0.0", "bg_color": "#EEF0F6"}),
                   "date": book.add_format({"bold": True, "num_format": "dd/mm/yyyy", "bg_color": "#EEF0F6"}),
                   "text": book.add_format({"bold": True, "bg_color": "#EEF0F6"})},
    }
    used = set()
    for sheet_data in sheets:
        name = sheet_data["title"][:31]
        for char in "[]:*?/\\":
            name = name.replace(char, " ")
        while name in used:
            name = name[:28] + f" {len(used)}"
        used.add(name)
        sheet = book.add_worksheet(name)
        xlsx_row(sheet, 0, [sheet_data["title"]], title)
        r = 1
        for meta_label, meta_value in sheet_data.get("meta") or []:
            xlsx_row(sheet, r, [meta_label], label)
            _cell(sheet, r, 1, meta_value, "date" if isinstance(meta_value, (date, datetime)) else "text", formats[None])
            r += 1
        r += 1
        columns = sheet_data["columns"]
        xlsx_row(sheet, r, [c for c, _k in columns], head)
        header_row = r
        styles = sheet_data.get("styles") or []
        rows = sheet_data["rows"]
        for i, row in enumerate(rows):
            r += 1
            style = styles[i] if i < len(styles) else None
            for c, value in enumerate(row):
                kind = columns[c][1] if c < len(columns) else "text"
                _cell(sheet, r, c, value, kind, formats[style])
        if sheet_data.get("totals"):
            r += 1
            for c, value in enumerate(sheet_data["totals"]):
                kind = columns[c][1] if c < len(columns) else "text"
                _cell(sheet, r, c, value, kind, formats["total"])
        sheet.freeze_panes(header_row + 1, 0)
        for c, (_c, kind) in enumerate(columns):
            sheet.set_column(c, c, 16 if kind in ("money", "date", "number") else 10 if kind in ("int", "percent", "days") else 30)
    book.close()
    return out.getvalue()


def _cell(sheet, r, c, value, kind, fmts):
    fmt = fmts.get(kind) if kind in fmts else fmts.get("text")
    if value is None or value == "":
        sheet.write_blank(r, c, None, fmts.get("text") or fmt)
    elif isinstance(value, bool):
        xlsx_row(sheet, r, ["oui" if value else "non"], fmts.get("text"), col=c)
    elif isinstance(value, (int, float)) and kind != "text":
        sheet.write_number(r, c, float(value), fmt)
    elif isinstance(value, (date, datetime)):
        sheet.write_datetime(r, c, value if isinstance(value, datetime) else datetime.combine(value, datetime.min.time()),
                             fmts.get("date"))
    else:
        xlsx_row(sheet, r, [str(value)], fmts.get("text"), col=c)
