"""Classeur Excel d'une section d'analyse : la réponse de la route JSON, mise en tableaux lisibles.

Onglet « Synthèse » (société, période, fiabilité, indicateurs), onglet « Constats », puis un onglet par
bloc de la section : liste d'objets -> tableau ; séries mensuelles -> mois en lignes, séries en
colonnes ; objet -> valeurs simples, puis ses listes en sous-tableaux. Construction générique : une
section qui gagne un bloc l'exporte sans autre code. Les textes sont écrits comme textes (jamais comme
formules), les montants et pourcentages comme nombres formatés, les dates comme dates.
"""

import io
from datetime import date, datetime

from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError
from odoo.addons.eguitra_api.files import XLSX_OPTIONS

from .libelles import bloc, colonne

ENVELOPE = ("entity", "company", "period", "generated_at", "quality", "insights", "kpis")
MAX_ROWS = 5000

SEVERITIES = {"critical": "Critique", "high": "Élevée", "medium": "Moyenne", "info": "Information", "positive": "Positif"}


def _label(key):
    return colonne(key)


def _scalar(value):
    return value is None or isinstance(value, (str, int, float, bool, date, datetime))


def _flatten(value):
    """Valeur écrivable dans une cellule : liste de scalaires jointe, objet résumé, booléen en Oui/Non."""
    if isinstance(value, bool):
        return "Oui" if value else "Non"
    if isinstance(value, (list, tuple)):
        if all(_scalar(v) for v in value):
            return ", ".join("" if v is None else str(v) for v in value)
        return f"{len(value)} élément(s)"
    if isinstance(value, dict):
        return " ; ".join(f"{_label(k)} : {_flatten(v)}" for k, v in value.items() if _scalar(v))
    return value


def _number_format(key):
    key = str(key)
    if key in ("probability", "confidence", "gini", "mad", "r2", "share", "x", "y") or key.endswith("_ratio"):
        return "decimal"
    if key.endswith(("_pct", "_rate")):
        return "pct"
    if key in ("n", "count", "rotations", "hours", "days") or key.endswith(("_days", "_count", "_n")):
        return "int"
    return "amount"


class _Writer:
    def __init__(self, book):
        self.book = book
        self.formats = {
            "title": book.add_format({"bold": True, "font_size": 15, "font_color": "#11221D"}),
            "subtitle": book.add_format({"italic": True, "font_color": "#5B6B66"}),
            "section": book.add_format({"bold": True, "font_size": 12, "font_color": "#4C3AA8"}),
            "head": book.add_format({"bold": True, "bg_color": "#11221D", "font_color": "#FFFFFF", "text_wrap": True,
                                     "valign": "top", "border": 1, "border_color": "#2B3A35"}),
            "text": book.add_format({"text_wrap": False, "valign": "top"}),
            "wrap": book.add_format({"text_wrap": True, "valign": "top"}),
            "amount": book.add_format({"num_format": "#,##0;-#,##0", "valign": "top"}),
            "pct": book.add_format({"num_format": "0.0", "valign": "top"}),
            "int": book.add_format({"num_format": "0", "valign": "top"}),
            "decimal": book.add_format({"num_format": "0.00", "valign": "top"}),
            "date": book.add_format({"num_format": "dd/mm/yyyy", "valign": "top"}),
        }
        self.names = set()

    def sheet(self, name):
        base = (str(name).replace("/", "-").replace("\\", "-").replace("?", "").replace("*", "")
                .replace("[", "(").replace("]", ")").replace(":", " "))[:31] or "Feuille"
        candidate, i = base, 2
        while candidate.lower() in self.names:
            suffix = f" ({i})"
            candidate, i = base[:31 - len(suffix)] + suffix, i + 1
        self.names.add(candidate.lower())
        sheet = self.book.add_worksheet(candidate)
        sheet.widths = {}
        return sheet

    def cell(self, sheet, row, col, value, key=None, wrap=False):
        value = _flatten(value)
        if value is None or value == "":
            return
        if isinstance(value, datetime):
            sheet.write_datetime(row, col, value.replace(tzinfo=None), self.formats["date"])
            width = 11
        elif isinstance(value, date):
            sheet.write_datetime(row, col, datetime(value.year, value.month, value.day), self.formats["date"])
            width = 11
        elif isinstance(value, (int, float)):
            kind = _number_format(key) if key else "amount"
            if kind == "amount" and isinstance(value, float) and abs(value) < 100 and value != int(value):
                kind = "decimal"
            sheet.write_number(row, col, value, self.formats[kind])
            width = min(18, len(f"{value:,.0f}") + 3)
        else:
            text = str(value)
            # Une date ISO (AAAA-MM-JJ) reste une date dans le classeur.
            if len(text) == 10 and text[4] == "-" and text[7] == "-" and text.replace("-", "").isdigit():
                try:
                    return self.cell(sheet, row, col, date.fromisoformat(text), key)
                except ValueError:
                    pass
            sheet.write_string(row, col, text, self.formats["wrap" if wrap or len(text) > 60 else "text"])
            width = min(60, max(len(line) for line in text.splitlines() or [""]) + 2)
        sheet.widths[col] = max(sheet.widths.get(col, 8), width)

    def header(self, sheet, row, keys, labels=None):
        for col, key in enumerate(keys):
            text = (labels or {}).get(key) or _label(key)
            sheet.write_string(row, col, text, self.formats["head"])
            sheet.widths[col] = max(sheet.widths.get(col, 8), min(40, len(text) + 2))

    def table(self, sheet, row, rows, title=None):
        """Liste d'objets à partir de la ligne `row` ; renvoie la ligne suivante."""
        rows = [r for r in rows if isinstance(r, dict)][:MAX_ROWS]
        if not rows:
            return row
        if title:
            sheet.write_string(row, 0, title, self.formats["section"])
            row += 1
        keys = []
        for r in rows:
            for k, v in r.items():
                if k not in keys and (_scalar(v) or (isinstance(v, list) and all(_scalar(x) for x in v))
                                      or isinstance(v, dict)):
                    keys.append(k)
        self.header(sheet, row, keys)
        first = row
        for r in rows:
            row += 1
            for col, key in enumerate(keys):
                self.cell(sheet, row, col, r.get(key), key)
        if not title:
            sheet.freeze_panes(first + 1, 0)
        sheet.autofilter(first, 0, row, max(0, len(keys) - 1))
        return row + 2

    def finish(self, sheet):
        for col, width in sheet.widths.items():
            sheet.set_column(col, col, width)


def _monthly(block):
    return isinstance(block, dict) and isinstance(block.get("months"), list) and isinstance(block.get("series"), list)


def _write_block(w, key, block):
    sheet = w.sheet(bloc(key))
    row = 0
    if _monthly(block):
        months = block["months"]
        series = [s for s in block["series"] if isinstance(s, dict)]
        w.header(sheet, row, ["month"] + [str(i) for i in range(len(series))],
                 labels={"month": "Mois", **{str(i): s.get("label") or _label(s.get("key")) for i, s in enumerate(series)}})
        for i, month in enumerate(months):
            w.cell(sheet, i + 1, 0, month)
            for j, s in enumerate(series):
                values = s.get("values") or []
                if i < len(values):
                    w.cell(sheet, i + 1, j + 1, values[i], s.get("unit") == "pct" and "x_pct" or s.get("key"))
        sheet.freeze_panes(1, 1)
        row = len(months) + 3
        rest = {k: v for k, v in block.items() if k not in ("months", "series")}
        if rest:
            _write_object(w, sheet, row, rest)
    elif isinstance(block, list):
        if block and all(_scalar(v) for v in block):
            w.header(sheet, 0, ["value"])
            for i, v in enumerate(block[:MAX_ROWS], start=1):
                w.cell(sheet, i, 0, v)
        else:
            w.table(sheet, 0, block)
    elif isinstance(block, dict):
        _write_object(w, sheet, 0, block)
    else:
        w.header(sheet, 0, ["value"])
        w.cell(sheet, 1, 0, block, key)
    w.finish(sheet)


def _write_object(w, sheet, row, block, depth=0):
    """Objet : d'abord ses valeurs simples (clé, valeur), puis ses listes et sous-objets."""
    # Axes d'une matrice (mois, semaines) : déjà portés par chaque cellule de la liste « cells ».
    axes = ("months", "weeks", "dates", "consultants") if "cells" in block else ()
    simple = [(k, v) for k, v in block.items() if k not in axes
              and (_scalar(v) or (isinstance(v, list) and all(_scalar(x) for x in v)))]
    if simple:
        w.header(sheet, row, ["indicator", "value"], labels={"indicator": "Indicateur", "value": "Valeur"})
        for k, v in simple:
            row += 1
            w.cell(sheet, row, 0, _label(k))
            w.cell(sheet, row, 1, v, k)
        row += 2
    for k, v in block.items():
        if isinstance(v, list) and v and not all(_scalar(x) for x in v):
            row = w.table(sheet, row, v, title=_label(k))
        elif isinstance(v, dict) and v:
            if _monthly(v):
                months, series = v["months"], [s for s in v["series"] if isinstance(s, dict)]
                rows = [dict({"month": m}, **{(s.get("label") or s.get("key") or str(j)):
                                              (s.get("values") or [None] * len(months))[i]
                                              if i < len(s.get("values") or []) else None
                                              for j, s in enumerate(series)}) for i, m in enumerate(months)]
                row = w.table(sheet, row, rows, title=_label(k))
            elif depth < 2:
                sheet.write_string(row, 0, _label(k), w.formats["section"])
                row = _write_object(w, sheet, row + 1, v, depth + 1)
    return row


def section_workbook(payload, section_label, question=None):
    """Classeur (octets) d'une réponse de section (enveloppe et blocs)."""
    import xlsxwriter

    out = io.BytesIO()
    book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
    w = _Writer(book)
    company = (payload.get("company") or {}).get("name") or ""
    period = payload.get("period") or {}

    sheet = w.sheet("Synthèse")
    sheet.write_string(0, 0, f"{company} · {section_label}", w.formats["title"])
    if question:
        sheet.write_string(1, 0, question, w.formats["subtitle"])
    infos = [
        ("Période", period.get("label")), ("Du", period.get("date_from")), ("Au", period.get("date_to")),
        ("Calculé le", payload.get("generated_at")),
        ("Fiabilité des données (sur 100)", (payload.get("quality") or {}).get("score")),
    ]
    # Valeurs simples de la section (disponibilité des données, par exemple) : dans la synthèse.
    infos += [(bloc(k), v) for k, v in payload.items() if k not in ENVELOPE and _scalar(v)]
    row = 3
    for label, value in infos:
        if value not in (None, ""):
            sheet.write_string(row, 0, label, w.formats["text"])
            w.cell(sheet, row, 1, value, "score" if "Fiabilité" in label else None)
            row += 1
    notes = (payload.get("quality") or {}).get("notes") or []
    if notes:
        row += 1
        sheet.write_string(row, 0, "Réserves sur les données", w.formats["section"])
        for note in notes:
            row += 1
            w.cell(sheet, row, 0, note, wrap=True)
    kpis = payload.get("kpis")
    if isinstance(kpis, list) and kpis:
        row += 2
        rows = [{"label": k.get("label"), "value": k.get("value"), "unit": k.get("unit"), "previous": k.get("previous"),
                 "target": k.get("target"), "delta_pct": k.get("delta_pct"), "status": k.get("status"),
                 "definition": k.get("definition")} for k in kpis if isinstance(k, dict)]
        row = w.table(sheet, row, rows, title="Indicateurs")
    sheet.set_column(0, 0, 34)
    w.finish(sheet)
    sheet.set_column(0, 0, max(34, sheet.widths.get(0, 0)))

    insights = payload.get("insights") or []
    if insights:
        sheet = w.sheet("Constats")
        rows = []
        for i in insights:
            metric = i.get("metric") or {}
            rows.append({
                "severity": SEVERITIES.get(i.get("severity"), i.get("severity")), "domain": i.get("domain"),
                "title": i.get("title"), "narrative": i.get("narrative"), "metric": metric.get("label"),
                "metric_value": metric.get("value"), "metric_unit": metric.get("unit"),
                "reference": metric.get("reference"), "impact_gnf": i.get("impact_gnf"),
                "confidence_pct": round(100 * i["confidence"], 0) if i.get("confidence") is not None else None,
                "action": i.get("action"), "method": i.get("method"), "link": i.get("link"),
            })
        labels = {"metric": "Mesure", "metric_value": "Valeur", "metric_unit": "Unité", "reference": "Référence",
                  "impact_gnf": "Impact (GNF)", "confidence_pct": "Confiance (%)", "narrative": "Constat",
                  "method": "Méthode", "domain": "Domaine"}
        keys = list(rows[0])
        w.header(sheet, 0, keys, labels)
        for r, values in enumerate(rows, start=1):
            for c, key in enumerate(keys):
                w.cell(sheet, r, c, values[key], key, wrap=key in ("narrative", "action", "method"))
        sheet.freeze_panes(1, 0)
        sheet.autofilter(0, 0, len(rows), len(keys) - 1)
        w.finish(sheet)
        for c, key in enumerate(keys):
            if key in ("narrative", "action", "method"):
                sheet.set_column(c, c, 60)

    for key, block in payload.items():
        if key in ENVELOPE or block in (None, [], {}) or _scalar(block):
            continue
        _write_block(w, key, block)
    book.close()
    return out.getvalue()


def export_section(entity, section, sections, compute, kw):
    """Réponse fichier d'une section : contrôle du nom et du profil, calcul par `compute(section, kw)`
    (la route JSON), classeur nommé analyse_<société>_<section>_<arrêté>.xlsx."""
    meta = {key: (label, question, profiles) for key, label, question, _icon, profiles in sections}
    if section not in meta:
        raise ApiError(404, "not_found", "Section d'analyse inconnue.")
    label, question, profiles = meta[section]
    if not set(profiles) & set(request.env.user._eguitra_profiles()):
        raise ApiError(403, "forbidden", "Accès non autorisé pour votre profil.")
    payload = compute(section, kw)
    date_to = (payload.get("period") or {}).get("date_to")
    name = f"analyse_{entity}_{section}_{date_to.isoformat() if hasattr(date_to, 'isoformat') else date_to or ''}.xlsx"
    return request.make_response(section_workbook(payload, label, question), headers=[
        ("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        ("Content-Disposition", content_disposition(name)),
    ])
