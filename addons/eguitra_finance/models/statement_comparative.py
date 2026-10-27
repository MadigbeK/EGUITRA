"""Comparatifs du premier exercice : états de l'exercice précédent importés dans le modèle du système normal.

En 2026, premier exercice tenu dans la plateforme, la colonne N-1 des états serait vide : les à-nouveaux
sont datés du 1er janvier 2026 et le compte de résultat 2025 n'est pas dans la plateforme. L'expert-comptable
remet les états de 2025 dans le modèle qu'il remplit (classeur « Bilan », « Compte de Résultat », « Tableau
des flux de trésorerie ») ; ils sont importés ici, par société et date de clôture, et servent de colonne N-1
tant que l'exercice précédent n'a pas d'écritures dans la plateforme (syscohada.py, _previous_plan).

Lecture du classeur : dans chaque feuille, la ligne d'en-tête « REF » ; les colonnes se reconnaissent à leurs
intitulés (exercice N ou N-1, ou l'année ; brut, amortissements et dépréciations, net), jamais à leur position ;
chaque ligne se lit par son code REF. Trois écarts au modèle officiel sont ramenés à la présentation de la
plateforme, et signalés : AI qui comprend AP, CB (capital non appelé) porté en positif, lignes « (-) » du
tableau des flux portées en positif et soustraites par les formules du classeur. Les contrôles (équilibre du
bilan, résultat, totaux, trésorerie, report à nouveau) sont affichés sans bloquer l'import.
"""

import re
import unicodedata
from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import UserError

from odoo.addons.eguitra_api.files import workbook_sheets

from .syscohada import (
    BILAN_ACTIF,
    BILAN_ACTIF_ORDER,
    BILAN_ACTIF_TOTALS,
    BILAN_PASSIF,
    BILAN_PASSIF_ORDER,
    BILAN_PASSIF_TOTALS,
    CR_LINES,
    CR_ORDER,
    CR_TOTALS,
    TFT_OUTFLOWS,
    TFT_ROWS,
    TFT_TOTALS,
)

TOLERANCE = 1.0  # GNF : arrondis du classeur
STATEMENTS = [("actif", "Bilan actif"), ("passif", "Bilan passif"), ("resultat", "Compte de résultat"),
              ("flux", "Tableau des flux de trésorerie")]
CODES = {
    "actif": BILAN_ACTIF_ORDER,
    "passif": BILAN_PASSIF_ORDER,
    "resultat": CR_ORDER,
    "flux": [code for code, _label, _total in TFT_ROWS],
}
STATEMENT_OF = {code: statement for statement, codes in CODES.items() for code in codes}
LABELS = ({line[0]: line[1] for line in BILAN_ACTIF + BILAN_PASSIF + CR_LINES}
          | {code: label for code, label, _f in BILAN_ACTIF_TOTALS + BILAN_PASSIF_TOTALS + CR_TOTALS}
          | {code: label for code, label, _total in TFT_ROWS})
FORMULAS = {
    "actif": [(code, formula) for code, _label, formula in BILAN_ACTIF_TOTALS],
    "passif": [(code, formula) for code, _label, formula in BILAN_PASSIF_TOTALS],
    "resultat": [(code, formula) for code, _label, formula in CR_TOTALS],
    "flux": TFT_TOTALS,
}
# Blocs du tableau des flux dont les lignes « (-) » peuvent être portées en positif (formules du modèle du
# client : ZB = FA - FB - FC - FD + FE, ZC = -FF - FG - FH + FI + FJ, ZD = FK + FL - FM - FN, ZE = FO + FP - FQ).
FLOW_BLOCKS = [(total, [c for c, _s in formula]) for total, formula in TFT_TOTALS if total in ("ZB", "ZC", "ZD", "ZE")]
ORDER = {code: i for i, code in enumerate(c for codes in CODES.values() for c in codes)}
AMOUNT_KEYS = ("gross", "depreciation", "amount")
MAX_HEADER_ROWS = 4
CODE_PATTERN = re.compile(r"^[A-Z]{2}$")


def _plain(value):
    """Texte d'en-tête comparable : majuscules, sans accents, espaces simples."""
    text = str(value or "").replace("’", "'")  # apostrophe typographique du modèle (« Numéro d’identification »)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return " ".join(text.upper().split())


def _number(value):
    """Montant d'une cellule : nombre, texte « 1 234 567 », « (1 234) » ou « - » ; None si vide."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(" ", "").replace(" ", "").replace(" ", "")
    if text in ("", "-"):
        return None
    negative = text.startswith("(") and text.endswith(")")
    text = text.strip("()").replace(",", ".")
    try:
        number = float(text)
    except ValueError:
        return None
    return -number if negative else number


def _column_roles(block_rows, ref_col):
    """Rôle de chaque colonne d'un bloc d'après ses intitulés (ligne « REF » et lignes de sous-titres qui la
    suivent) : {colonne: (période, nature)}, période « N » ou « N-1 », nature gross, depreciation ou amount.
    Un intitulé fusionné (« EXERCICE AU 31/12/N » au-dessus de BRUT, AMORT et NET) vaut pour les colonnes
    voisines sans période ; à défaut de N et N-1, l'année la plus récente est l'exercice N."""
    width = max((len(row) for row in block_rows), default=0)
    texts = [_plain(" ".join(str(row[c]) for row in block_rows if c < len(row) and row[c] not in (None, "")))
             for c in range(width)]
    found = []
    for c, text in enumerate(texts):
        if c <= ref_col or not text or "NOTE" in text or "FORMULE" in text:
            found.append((None, None, None))
            continue
        if re.search(r"(?<![A-Z])N\s*-\s*1(?![0-9])", text):
            period = "N-1"
        elif re.search(r"(?<![A-Z])N(?![A-Z])", text):
            period = "N"
        else:
            period = None
        years = [int(y) for y in re.findall(r"(?<![0-9])((?:19|20)[0-9]{2})(?![0-9])", text)]
        kind = ("depreciation" if "AMORT" in text or "DEPREC" in text else "gross" if "BRUT" in text
                else "amount" if re.search(r"(?<![A-Z])NET(?![A-Z])", text) else None)
        found.append((period, max(years) if years else None, kind))
    # Période et année des colonnes sans intitulé d'exercice : celles de l'intitulé à leur gauche.
    last = (None, None)
    for c, (period, year, kind) in enumerate(found):
        if period or year:
            last = (period, year)
        elif kind:
            found[c] = (last[0], last[1], kind)
    years = sorted({year for _p, year, _k in found if year})
    roles = {}
    for c, (period, year, kind) in enumerate(found):
        if not period and year:
            period = "N" if year == years[-1] else "N-1"
        if not period:
            continue
        kind = kind or "amount"
        if (period, kind) not in roles.values():
            roles[c] = (period, kind)
    return roles, years


def _blocks(rows):
    """Blocs d'une feuille : (index de la ligne « REF », colonne REF), dans l'ordre de la feuille."""
    blocks = []
    for r, row in enumerate(rows):
        for c, value in enumerate(row):
            if _plain(value) == "REF":
                blocks.append((r, c))
                break
    return blocks


def _header_text(rows, prefix):
    """Valeur d'une ligne d'en-tête du modèle (« Désignation entité : … »), sans ce qui la suit dans la cellule."""
    for row in rows[:12]:
        for value in row:
            text = " ".join(str(value or "").split())
            if _plain(text).startswith(prefix):
                rest = text.split(":", 1)[1] if ":" in text else ""
                for stop in ("Exercice clos", "Durée", "Duree"):
                    rest = rest.split(stop)[0]
                return rest.strip() or None
    return None


def parse_workbook(content):
    """Lit un classeur au modèle du système normal : {"values": {code: {gross, depreciation, amount,
    previous}}, "years": [...], "entity": ..., "vat": ..., "notes": [...]} ; montants dans la présentation de
    la plateforme (conversions décrites dans les notes)."""
    sheets = workbook_sheets(content)
    values, notes, years, entity, vat = {}, [], set(), None, None
    for rows in sheets.values():
        entity = entity or _header_text(rows, "DESIGNATION ENTITE")
        vat = vat or _header_text(rows, "NUMERO D'IDENTIFICATION")
        blocks = _blocks(rows)
        for i, (start, ref_col) in enumerate(blocks):
            end = blocks[i + 1][0] if i + 1 < len(blocks) else len(rows)
            header = [rows[start]]
            for row in rows[start + 1:min(end, start + 1 + MAX_HEADER_ROWS)]:
                code = str(row[ref_col] or "").strip().upper() if ref_col < len(row) else ""
                if CODE_PATTERN.match(code) and code in STATEMENT_OF:
                    break
                header.append(row)
            roles, block_years = _column_roles(header, ref_col)
            years.update(block_years)
            if not roles:
                continue
            for row in rows[start + len(header):end]:
                code = str(row[ref_col] or "").strip().upper() if ref_col < len(row) else ""
                if not CODE_PATTERN.match(code) or code not in STATEMENT_OF:
                    continue
                if code in values:
                    notes.append(f"{code} figure deux fois dans le classeur : la première ligne est retenue.")
                    continue
                cells = {role: _number(row[c]) if c < len(row) else None for c, role in roles.items()}
                values[code] = _normalize(code, cells)
    missing = [code for code in ("BZ", "DZ", "XI") if code not in values]
    if missing:
        raise UserError("Classeur non reconnu : la colonne REF du modèle du système normal (bilan, compte de résultat, "
                        f"tableau des flux) est introuvable ou incomplète ({', '.join(missing)} absent).")
    for statement, codes in CODES.items():
        absent = [code for code in codes if code not in values]
        for code in absent:
            values[code] = {"gross": 0.0, "depreciation": 0.0, "amount": 0.0, "previous": None}
        if absent:
            notes.append(f"{dict(STATEMENTS)[statement]} : {', '.join(absent)} absent du classeur, compté pour zéro.")
    notes += _to_platform(values)
    return {"values": values, "years": sorted(years), "entity": entity, "vat": vat, "notes": notes}


def _normalize(code, cells):
    """Ligne lue : net, brut et amortissements de l'exercice N, net de l'exercice N-1 (None s'il manque)."""
    gross, depreciation, amount = (cells.get(("N", key)) for key in AMOUNT_KEYS)
    previous = cells.get(("N-1", "amount"))
    if STATEMENT_OF[code] == "actif":
        if amount is None:
            amount = (gross or 0.0) - (depreciation or 0.0)
        if gross is None:
            gross = amount + (depreciation or 0.0)
        if depreciation is None:
            depreciation = gross - amount
    else:
        amount = amount if amount is not None else (gross or 0.0)
        gross, depreciation = amount, 0.0
    return {"gross": gross, "depreciation": depreciation, "amount": amount, "previous": previous}


def _sum(values, formula, key):
    return sum((values[c][key] or 0.0) * s for c, s in formula)


def _to_platform(values):
    """Ramène les écarts connus du modèle du client à la présentation de la plateforme ; renvoie les notes."""
    notes = []
    # AI qui comprend AP (modèle du client : AI = AJ + … + AN + AP) : AP reste une rubrique propre.
    official = [(c, 1) for c in ("AJ", "AK", "AL", "AM", "AN")]
    for key in ("amount", "previous"):
        ai, ap = values["AI"][key], values["AP"][key]
        if ai is None or not ap:
            continue
        details = _sum(values, official, key)
        if abs(ai - details) > TOLERANCE and abs(ai - details - ap) <= TOLERANCE:
            keys = AMOUNT_KEYS if key == "amount" else ("previous",)
            for k in keys:
                values["AI"][k] -= values["AP"][k] or 0.0
            if key == "amount":
                notes.append("AI comprenait AP (avances et acomptes sur immobilisations), comme dans le modèle du client : "
                             "AP est retenu comme rubrique propre (présentation officielle, AZ = AD + AI + AP + AQ).")
    # Capital non appelé (CB, « (-) ») porté en positif : il se déduit des capitaux propres.
    for key in ("amount", "previous"):
        if (values["CB"][key] or 0.0) > TOLERANCE:
            values["CB"][key] = -values["CB"][key]
            if key == "amount":
                values["CB"]["gross"] = values["CB"]["amount"]
                notes.append("CB (apporteurs, capital non appelé) était porté en positif : il est retenu en déduction "
                             "des capitaux propres.")
    # Tableau des flux : lignes « (-) » portées en positif et soustraites par les formules du classeur.
    for key in ("amount", "previous"):
        for total, codes in FLOW_BLOCKS:
            declared = values[total][key]
            if declared is None:
                continue
            signed = sum(values[c][key] or 0.0 for c in codes)
            raw = sum(-(values[c][key] or 0.0) if c in TFT_OUTFLOWS else (values[c][key] or 0.0) for c in codes)
            if abs(declared - signed) > TOLERANCE and abs(declared - raw) <= TOLERANCE:
                for c in codes:
                    if c in TFT_OUTFLOWS and values[c][key]:
                        values[c][key] = -values[c][key]
                        if key == "amount":
                            values[c]["gross"] = values[c]["amount"]
                if key == "amount":
                    notes.append(f"{total} : les lignes « (-) » ({', '.join(c for c in codes if c in TFT_OUTFLOWS)}) étaient "
                                 "portées en positif et soustraites ; elles sont retenues en négatif (somme des lignes).")
    return notes


def _gap_item(code, field, expected, actual):
    return {"code": code, "label": LABELS.get(code, code), "field": field, "expected": expected, "actual": actual,
            "gap": round(actual - expected, 2)}


def controls(values, has_previous):
    """Contrôles d'un jeu d'états (exercice N du classeur) : liste de {code, label, ok, expected, actual, gap,
    detail, items}. ok = None : contrôle impossible (colonne N-1 absente)."""
    def net(code, key="amount"):
        return values.get(code, {}).get(key) or 0.0

    def check(code, label, expected, actual, detail=""):
        gap = None if expected is None or actual is None else round(actual - expected, 2)
        return {"code": code, "label": label, "ok": None if gap is None else abs(gap) <= TOLERANCE,
                "expected": expected, "actual": actual, "gap": gap, "detail": detail, "items": []}

    result = [
        check("bilan_equilibre", "Bilan équilibré : total actif (BZ) = total passif (DZ)", net("BZ"), net("DZ")),
        check("resultat", "Résultat du bilan (CJ) = résultat net du compte de résultat (XI)", net("XI"), net("CJ")),
    ]
    items = []
    for statement, formulas in FORMULAS.items():
        keys = AMOUNT_KEYS if statement == "actif" else ("amount",)
        for code, formula in formulas:
            for key in keys:
                expected = _sum(values, formula, key)
                if abs(net(code, key) - expected) > TOLERANCE:
                    items.append(_gap_item(code, key, expected, net(code, key)))
    result.append(dict(check("totaux", "Chaque total égal à la somme de ses postes", None, None,
                             "Totaux du classeur différents de la somme de leurs postes (actif : brut, amortissements "
                             "et net)."), ok=not items, items=items))
    items = [_gap_item(code, "amount", net(code, "gross") - net(code, "depreciation"), net(code))
             for code in BILAN_ACTIF_ORDER
             if abs(net(code) - (net(code, "gross") - net(code, "depreciation"))) > TOLERANCE]
    result.append(dict(check("net_actif", "Actif : net = brut - amortissements et dépréciations", None, None),
                       ok=not items, items=items))
    result.append(check("tresorerie_fin", "Trésorerie nette de fin (ZH) = trésorerie actif (BT) - trésorerie passif (DT)",
                        net("BT") - net("DT"), net("ZH")))
    if has_previous:
        def before(code):
            return values.get(code, {}).get("previous") or 0.0

        result.append(check("tresorerie_debut", "Trésorerie nette d'ouverture (ZA) = BT - DT de l'exercice précédent",
                            before("BT") - before("DT"), net("ZA")))
        dividends = abs(net("FN"))
        reserves = net("CF") + net("CG") - before("CF") - before("CG")
        expected = before("CH") + before("CJ") - dividends - reserves
        result.append(check(
            "report_a_nouveau", "Report à nouveau (CH) = report N-1 + résultat N-1 - distributions", expected, net("CH"),
            f"Distributions : dividendes versés (FN) {dividends:,.0f} GNF et dotation des réserves (CF + CG) "
            f"{reserves:,.0f} GNF.".replace(",", " ")))
    else:
        for code, label in (("tresorerie_debut", "Trésorerie nette d'ouverture (ZA) = BT - DT de l'exercice précédent"),
                            ("report_a_nouveau", "Report à nouveau (CH) = report N-1 + résultat N-1 - distributions")):
            item = check(code, label, None, None, "Colonne N-1 absente du classeur : contrôle impossible.")
            result.append(item)
    return result


class EguitraStatementComparative(models.Model):
    _name = "eguitra.statement.comparative"
    _description = "États de l'exercice précédent importés (comparatifs)"
    _order = "company_id, date_to desc"

    company_id = fields.Many2one("res.company", required=True, index=True, default=lambda self: self.env.company)
    date_to = fields.Date("Date de clôture", required=True)
    date_from = fields.Date("Début de l'exercice", required=True)
    source = fields.Char("Classeur importé")
    entity_name = fields.Char("Désignation entité (classeur)")
    entity_vat = fields.Char("Numéro d'identification (classeur)")
    has_previous = fields.Boolean("Colonne N-1 lue", help="Le classeur porte aussi les montants de son exercice N-1.")
    notes = fields.Text("Conversions à l'import")
    imported_by = fields.Many2one("res.users", "Importé par", readonly=True)
    imported_at = fields.Datetime("Importé le", readonly=True)
    line_ids = fields.One2many("eguitra.statement.comparative.line", "comparative_id", "Lignes")

    _company_date_unique = models.Constraint("unique(company_id, date_to)",
                                             "Un seul jeu de comparatifs par société et date de clôture.")

    def statement_values(self):
        """{"actif": {code: {gross, depreciation, amount}}, "passif" | "resultat" | "flux": {code: montant}}."""
        self.ensure_one()
        result = {statement: {} for statement, _label in STATEMENTS}
        for line in self.line_ids:
            if line.statement == "actif":
                result["actif"][line.code] = {"gross": line.gross, "depreciation": line.depreciation, "amount": line.amount}
            else:
                result[line.statement][line.code] = line.amount
        return result

    def _values_for_controls(self):
        return {line.code: {"gross": line.gross, "depreciation": line.depreciation, "amount": line.amount,
                            "previous": line.previous if self.has_previous else None} for line in self.line_ids}

    def controls(self):
        self.ensure_one()
        return controls(self._values_for_controls(), self.has_previous)

    def summary(self):
        """Fiche d'un import pour l'écran : en-tête, conversions, contrôles."""
        self.ensure_one()
        checks = self.controls()
        return {
            "id": self.id, "company": self.company_id.name, "date_from": self.date_from, "date_to": self.date_to,
            "source": self.source or None, "entity_name": self.entity_name or None, "entity_vat": self.entity_vat or None,
            "imported_by": self.imported_by.name or None, "imported_at": self.imported_at,
            "notes": [n for n in (self.notes or "").split("\n") if n], "checks": checks,
            "conform": sum(1 for c in checks if c["ok"]), "total": sum(1 for c in checks if c["ok"] is not None),
        }

    @api.model
    def import_workbook(self, company, date_to, content, filename=None, replace=False):
        """Importe (ou remplace, replace=True) les états de l'exercice clos le date_to. Refus : date qui n'est pas
        une clôture d'exercice, classeur d'un autre exercice ; import existant sans replace : ComparativeExists."""
        metrics = self.env["eguitra.finance.metrics"]
        date_from, fy_end = metrics.fiscal_year_bounds(company, date_to)
        if fy_end != date_to:
            raise UserError(f"Le {date_to:%d/%m/%Y} n'est pas une date de clôture d'exercice de {company.name}.")
        parsed = parse_workbook(content)
        if parsed["years"] and parsed["years"][-1] != date_to.year:
            raise UserError(f"Le classeur porte sur l'exercice {parsed['years'][-1]} et non {date_to.year} : "
                            "choisissez la date de clôture correspondante.")
        notes = list(parsed["notes"])
        if parsed["vat"] and company.vat and _plain(parsed["vat"]).replace(" ", "") != _plain(company.vat).replace(" ", ""):
            notes.append(f"Numéro d'identification du classeur ({parsed['vat']}) différent de celui de la société "
                         f"({company.vat}).")
        has_previous = any(row["previous"] is not None for row in parsed["values"].values())
        existing = self.search([("company_id", "=", company.id), ("date_to", "=", date_to)], limit=1)
        if existing and not replace:
            raise ComparativeExists(existing)
        lines = [(0, 0, {"statement": STATEMENT_OF[code], "code": code, "sequence": i,
                         "gross": row["gross"], "depreciation": row["depreciation"], "amount": row["amount"],
                         "previous": row["previous"] or 0.0})
                 for i, (code, row) in enumerate(sorted(parsed["values"].items(),
                                                        key=lambda item: ORDER[item[0]]))]
        values = {
            "company_id": company.id, "date_to": date_to, "date_from": date_from, "source": (filename or "")[:200] or False,
            "entity_name": (parsed["entity"] or "")[:200] or False, "entity_vat": (parsed["vat"] or "")[:60] or False,
            "has_previous": has_previous, "notes": "\n".join(notes) or False,
            "imported_by": self.env.user.id, "imported_at": fields.Datetime.now(),
        }
        if existing:
            existing.line_ids.unlink()
            existing.write(dict(values, line_ids=lines))
            return existing
        return self.create(dict(values, line_ids=lines))

    @api.model
    def opening_check(self, company, date_to):
        """Bilan d'ouverture : à-nouveaux (journal AN) de l'exercice qui suit la clôture date_to, face au bilan
        importé de cet exercice, poste par poste (net ; brut et amortissements pour l'actif)."""
        comparative = self.search([("company_id", "=", company.id), ("date_to", "=", date_to)], limit=1)
        if not comparative:
            return {"available": False, "date_to": date_to}
        imported = comparative.statement_values()
        opening = self.env["eguitra.syscohada"].sudo().opening_balance_sheet(company, date_to + timedelta(days=1))
        rows = []
        for side, keys in (("actif", AMOUNT_KEYS), ("passif", ("amount",))):
            for line in opening[side]:
                code = line["code"]
                reference = imported[side].get(code, {}) if side == "actif" else {"amount": imported[side].get(code, 0.0)}
                expected = {k: reference.get(k, 0.0) for k in keys}
                actual = {k: line[k] for k in keys}
                gaps = {k: round(actual[k] - expected[k], 2) for k in keys}
                rows.append({"side": side, "code": code, "label": line["label"], "total": line["total"],
                             "detail": line["detail"], "imported": expected, "opening": actual, "gaps": gaps,
                             "ok": all(abs(g) <= TOLERANCE for g in gaps.values())})
        return {"available": True, "comparative_id": comparative.id, "date_to": date_to, "opening_date": opening["date"],
                "accounts": opening["accounts"], "rows": rows, "gaps": sum(1 for r in rows if not r["ok"])}


class ComparativeExists(Exception):
    """Des comparatifs existent déjà pour cette société et cette date : remplacement à confirmer."""

    def __init__(self, record):
        super().__init__(record)
        self.record = record


class EguitraStatementComparativeLine(models.Model):
    _name = "eguitra.statement.comparative.line"
    _description = "Ligne des états importés de l'exercice précédent"
    _order = "comparative_id, sequence, id"

    comparative_id = fields.Many2one("eguitra.statement.comparative", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="comparative_id.company_id", store=True, index=True)
    sequence = fields.Integer()
    statement = fields.Selection(STATEMENTS, required=True)
    code = fields.Char("REF", required=True, size=2)
    gross = fields.Float("Brut")
    depreciation = fields.Float("Amortissements et dépréciations")
    amount = fields.Float("Net")
    previous = fields.Float("Net N-1 du classeur")
