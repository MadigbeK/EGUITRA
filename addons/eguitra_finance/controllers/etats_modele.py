"""États au modèle du client (système normal OHADA) : classeur de trois feuilles nommées comme dans le modèle
que remplit son expert-comptable, mêmes colonnes dans le même ordre, totaux en gras, valeurs et jamais de
formules (ni liens vers un autre classeur).

- « Bilan » : actif (REF, ACTIF, Note, brut, amortissements et dépréciations, net de l'exercice N, net N-1)
  puis passif (REF, PASSIF, Note, net N, net N-1) ;
- « Compte de Résultat » : REF, LIBELLÉS, signe, NOTE, net N, net N-1 ;
- « Tableau des  Flux de trésorerie » (double espace du modèle) : REF, LIBELLÉS, lettre, exercice N, N-1,
  avec la variation du BF, et le contrôle de ZH par la trésorerie du bilan.

En-tête : désignation de l'entité, numéro d'identification (NIF de la société), exercice clos le, durée en
mois ; titres « BILAN AU … », « COMPTE DE RÉSULTAT AU … ». Les défauts du classeur du client ne sont pas
repris (marge commerciale et valeur ajoutée N-1, liens vers « COMPTE DE RESULTAT 2022 », années écrites en
dur, CB ajouté aux capitaux propres) : chaque montant vient du calcul de la plateforme.
"""

import io

from dateutil.relativedelta import relativedelta

from odoo.http import request

from odoo.addons.eguitra_api.files import XLSX_OPTIONS, xlsx_row

from ..models.syscohada import TFT_ROWS, WORKING_CAPITAL_LABEL

SHEET_BILAN = "Bilan"
SHEET_RESULTAT = "Compte de Résultat"
SHEET_FLUX = "Tableau des  Flux de trésorerie"
SHEETS = (SHEET_BILAN, SHEET_RESULTAT, SHEET_FLUX)

MONTHS = ("janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
          "novembre", "décembre")

# Libellés du modèle (présentation officielle du système normal) ; rubriques et totaux en capitales.
MODEL_LABELS = {
    "AD": "IMMOBILISATIONS INCORPORELLES", "AI": "IMMOBILISATIONS CORPORELLES",
    "AP": "AVANCES ET ACOMPTES VERSÉS SUR IMMOBILISATIONS", "AQ": "IMMOBILISATIONS FINANCIÈRES",
    "AZ": "TOTAL ACTIF IMMOBILISÉ", "BA": "ACTIF CIRCULANT HAO", "BB": "STOCKS ET ENCOURS",
    "BG": "CRÉANCES ET EMPLOIS ASSIMILÉS", "BH": "Fournisseurs, avances versées", "BK": "TOTAL ACTIF CIRCULANT",
    "BT": "TOTAL TRÉSORERIE-ACTIF", "BU": "Écart de conversion-Actif", "BZ": "TOTAL GÉNÉRAL",
    "CB": "Apporteurs, capital non appelé (-)", "CH": "Report à nouveau (+ ou -)",
    "CJ": "Résultat net de l'exercice (bénéfice + ou perte -)",
    "CP": "TOTAL CAPITAUX PROPRES ET RESSOURCES ASSIMILÉES", "DB": "Dettes de location-acquisition",
    "DD": "TOTAL DETTES FINANCIÈRES ET RESSOURCES ASSIMILÉES", "DF": "TOTAL RESSOURCES STABLES",
    "DP": "TOTAL PASSIF CIRCULANT", "DR": "Banques, établissements financiers et crédits de trésorerie",
    "DT": "TOTAL TRÉSORERIE-PASSIF", "DV": "Écart de conversion-Passif", "DZ": "TOTAL GÉNÉRAL",
    "TA": "Ventes de marchandises A", "XA": "MARGE COMMERCIALE (somme TA à RB)",
    "TB": "Ventes de produits fabriqués B", "TC": "Travaux, services vendus C", "TD": "Produits accessoires D",
    "XB": "CHIFFRE D'AFFAIRES (A + B + C + D)", "XC": "VALEUR AJOUTÉE (XB + RA + RB) + (somme TE à RJ)",
    "XD": "EXCÉDENT BRUT D'EXPLOITATION (XC + RK)", "XE": "RÉSULTAT D'EXPLOITATION (XD + TJ + RL)",
    "XF": "RÉSULTAT FINANCIER (somme TK à RN)", "XG": "RÉSULTAT DES ACTIVITÉS ORDINAIRES (XE + XF)",
    "XH": "RÉSULTAT HORS ACTIVITÉS ORDINAIRES (somme TN à RP)", "XI": "RÉSULTAT NET (XG + XH + RQ + RS)",
    "ZG": "VARIATION DE LA TRÉSORERIE NETTE DE LA PÉRIODE (B + C + F)",
}
# Intertitres du tableau des flux, placés avant la ligne indiquée.
FLOW_SECTIONS = {
    "FA": "Flux de trésorerie provenant des activités opérationnelles",
    "FF": "Flux de trésorerie provenant des activités d'investissement",
    "FK": "Flux de trésorerie provenant du financement par les capitaux propres",
    "FO": "Trésorerie provenant du financement par les capitaux étrangers",
}
TREASURY_CHECK = "Contrôle : trésorerie actif N - trésorerie passif N"


def date_fr(day):
    """« 1er janvier 2026 », « 31 décembre 2026 »."""
    return f"{'1er' if day.day == 1 else day.day} {MONTHS[day.month - 1]} {day.year}"


def _day_month(day):
    return date_fr(day).rsplit(" ", 1)[0]


def model_data(scope, date_to):
    """Montants des trois états, exercice de la date jusqu'à elle, et colonne N-1 (syscohada.py)."""
    syscohada = request.env["eguitra.syscohada"].sudo()
    metrics = request.env["eguitra.finance.metrics"].sudo()
    fy_start, fy_end = metrics.fiscal_year_bounds(scope[:1], date_to)
    income = syscohada.add_previous_income(syscohada.income_statement(scope, fy_start, date_to), scope, fy_start, date_to)
    return {
        "entity": ", ".join(scope.mapped("name")),
        "vat": ", ".join(c.vat for c in scope if c.vat),
        "fy_start": fy_start, "fy_end": fy_end, "date_to": date_to,
        "months": (fy_end.year - fy_start.year) * 12 + fy_end.month - fy_start.month + 1,
        "sheet": syscohada.balance_sheet_compared(scope, date_to),
        "income": income,
        "flows": syscohada.cash_flow_compared(scope, fy_start, date_to),
    }


def workbook(data):
    import xlsxwriter

    out = io.BytesIO()
    book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
    f = _formats(book)
    _bilan(book.add_worksheet(SHEET_BILAN), f, data)
    _resultat(book.add_worksheet(SHEET_RESULTAT), f, data)
    _flux(book.add_worksheet(SHEET_FLUX), f, data)
    book.close()
    return out.getvalue()


def _formats(book):
    def fmt(**kw):
        return book.add_format(dict({"font_size": 10, "valign": "vcenter"}, **kw))

    money = "#,##0;-#,##0"
    return {
        "title": fmt(bold=True, font_size=12),
        "bold": fmt(bold=True),
        "plain": fmt(),
        "head": fmt(bold=True, border=1, align="center", text_wrap=True, bg_color="#EEF0F6"),
        "code": fmt(border=1, align="center"), "code_total": fmt(border=1, align="center", bold=True),
        "label": fmt(border=1, text_wrap=True), "label_total": fmt(border=1, bold=True, text_wrap=True),
        "label_detail": fmt(border=1, indent=1, text_wrap=True),
        "section": fmt(border=1, bold=True, italic=True),
        "center": fmt(border=1, align="center"), "center_total": fmt(border=1, align="center", bold=True),
        "money": fmt(border=1, num_format=money), "money_total": fmt(border=1, num_format=money, bold=True),
    }


def _header(sheet, f, data, row, title=None, title_col=1):
    """Désignation de l'entité, numéro d'identification, exercice clos le, durée ; titre éventuel."""
    xlsx_row(sheet, row, [f"Désignation entité : {data['entity']}"], f["bold"])
    xlsx_row(sheet, row, [f"Exercice clos le {data['fy_end']:%d-%m-%Y}"], f["bold"], col=4)
    xlsx_row(sheet, row + 1, [f"Numéro d'identification : {data['vat'] or 'non renseigné'}"], f["bold"])
    xlsx_row(sheet, row + 1, [f"Durée (en mois) : {data['months']}"], f["bold"], col=4)
    if title:
        xlsx_row(sheet, row + 2, [title], f["title"], col=title_col)
        return row + 4
    return row + 3


def _amount(sheet, r, c, value, total, f):
    sheet.write_number(r, c, round(float(value or 0.0), 2), f["money_total" if total else "money"])


def _line(sheet, f, r, code, label, total, cells, detail=False, extra=()):
    """Ligne d'un état : REF, libellé, colonnes texte (note, signe, lettre), puis les montants."""
    xlsx_row(sheet, r, [code], f["code_total" if total else "code"])
    xlsx_row(sheet, r, [label], f["label_total" if total else "label_detail" if detail else "label"], col=1)
    for offset, text in enumerate(extra):
        xlsx_row(sheet, r, [text or ""], f["center_total" if total else "center"], col=2 + offset)
    for offset, value in enumerate(cells):
        if value is None:
            sheet.write_blank(r, 2 + len(extra) + offset, None, f["money"])
        else:
            _amount(sheet, r, 2 + len(extra) + offset, value, total, f)


def _bilan(sheet, f, data):
    day, previous = data["date_to"], data["sheet"]["previous"]["date_to"]
    title = f"BILAN AU {date_fr(day).upper()}"
    xlsx_row(sheet, 0, ["Bilan du système normal OHADA"], f["title"])
    xlsx_row(sheet, 1, ["BILAN ACTIF"], f["title"])
    r = _header(sheet, f, data, 2, title)
    xlsx_row(sheet, r, ["REF", "ACTIF", "Note"], f["head"])
    sheet.merge_range(r, 3, r, 5, f"EXERCICE AU {day:%d/%m/%Y}", f["head"])
    xlsx_row(sheet, r, [f"EXERCICE AU {previous:%d/%m/%Y}"], f["head"], col=6)
    xlsx_row(sheet, r + 1, ["", "", "", "BRUT", "AMORT. ET DÉPRÉC.", "NET", "NET"], f["head"])
    r += 2
    for line in data["sheet"]["actif"]:
        _line(sheet, f, r, line["code"], MODEL_LABELS.get(line["code"], line["label"]), line["total"],
              [line["gross"], line["depreciation"], line["amount"], line["previous"]],
              detail=line["detail"], extra=[line["note"]])
        r += 1
    r += 2
    xlsx_row(sheet, r, ["BILAN PASSIF"], f["title"])
    r = _header(sheet, f, data, r + 1, title)
    xlsx_row(sheet, r, ["REF", "PASSIF", "Note", f"EXERCICE AU {day:%d/%m/%Y}", f"EXERCICE AU {previous:%d/%m/%Y}"],
             f["head"])
    xlsx_row(sheet, r + 1, ["", "", "", "NET", "NET"], f["head"])
    r += 2
    for line in data["sheet"]["passif"]:
        _line(sheet, f, r, line["code"], MODEL_LABELS.get(line["code"], line["label"]), line["total"],
              [line["amount"], line["previous"]], extra=[line["note"]])
        r += 1
    difference = data["sheet"]["difference"]
    if abs(difference) >= 0.5 or abs(data["sheet"]["previous"]["difference"]) >= 0.5:
        r += 1
        xlsx_row(sheet, r, ["Écart total actif - total passif (à analyser)"], f["bold"], col=1)
        _amount(sheet, r, 3, difference, True, f)
        _amount(sheet, r, 4, data["sheet"]["previous"]["difference"], True, f)
    sheet.set_column(0, 0, 6)
    sheet.set_column(1, 1, 52)
    sheet.set_column(2, 2, 7)
    sheet.set_column(3, 6, 18)


def _resultat(sheet, f, data):
    day = data["date_to"]
    previous = data["income"]["previous"]["date_to"]
    xlsx_row(sheet, 0, ["Compte de résultat du système normal OHADA"], f["title"])
    r = _header(sheet, f, data, 1, f"COMPTE DE RÉSULTAT AU {date_fr(day).upper()}")
    xlsx_row(sheet, r, ["REF", "LIBELLÉS", "", "NOTE", f"EXERCICE AU {day:%d/%m/%Y}", f"EXERCICE AU {previous:%d/%m/%Y}"],
             f["head"])
    xlsx_row(sheet, r + 1, ["", "", "", "", "NET", "NET"], f["head"])
    r += 2
    for line in data["income"]["lines"]:
        _line(sheet, f, r, line["code"], MODEL_LABELS.get(line["code"], line["label"]), line["total"],
              [line["amount"], line["previous"]], extra=[line["sign"], line["note"]])
        r += 1
    sheet.set_column(0, 0, 6)
    sheet.set_column(1, 1, 58)
    sheet.set_column(2, 3, 7)
    sheet.set_column(4, 5, 18)


def _flux(sheet, f, data):
    flows, day = data["flows"], data["date_to"]
    previous = flows["previous"]
    interim = day != data["fy_end"]

    def heading(year, end):
        """« EXERCICE 2026 », ou « EXERCICE 2026 AU 27/10/2026 » pour une situation en cours d'exercice."""
        return f"EXERCICE {year}" + (f" AU {end:%d/%m/%Y}" if interim else "")

    labels = {code: label for code, label, _total in TFT_ROWS}
    labels.update({
        "ZA": f"Trésorerie nette au {_day_month(data['fy_start'])} (trésorerie actif N-1 - trésorerie passif N-1)",
        "ZG": MODEL_LABELS["ZG"],
        "ZH": f"Trésorerie nette au {_day_month(day)} (G + A) ; {TREASURY_CHECK.lower()}",
    })
    xlsx_row(sheet, 0, ["Tableau des flux de trésorerie du système normal OHADA"], f["title"])
    r = _header(sheet, f, data, 1, f"TABLEAU DES FLUX DE TRÉSORERIE AU {date_fr(day).upper()}")
    xlsx_row(sheet, r, ["REF", "LIBELLÉS", "", heading(data["fy_end"].year, day),
                        heading((data["fy_end"] - relativedelta(years=1)).year, previous["date_to"])], f["head"])
    r += 1
    for line in flows["lines"]:
        code = line["code"]
        if code in FLOW_SECTIONS:
            xlsx_row(sheet, r, ["", FLOW_SECTIONS[code], "", "", ""], f["section"])
            r += 1
        if code == "ZB":
            _line(sheet, f, r, "", WORKING_CAPITAL_LABEL, False, [flows["bf"], previous["bf"]], extra=[""])
            r += 1
        _line(sheet, f, r, code, labels[code], line["total"], [line["amount"], line["previous"]],
              extra=[line["letter"]])
        r += 1
    _line(sheet, f, r, "", TREASURY_CHECK, True, [flows["treasury_end"], previous["treasury_end"]], extra=[""])
    r += 1
    if abs(flows["difference"]) >= 0.5 or abs(previous["difference"]) >= 0.5:
        _line(sheet, f, r, "", "Écart : contrôle - trésorerie nette de fin (H), à analyser", True,
              [flows["difference"], previous["difference"]], extra=[""])
    sheet.set_column(0, 0, 6)
    sheet.set_column(1, 1, 70)
    sheet.set_column(2, 2, 6)
    sheet.set_column(3, 4, 20)
