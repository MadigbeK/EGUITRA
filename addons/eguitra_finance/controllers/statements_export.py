"""Exports des états (offre, chapitre 3.3 : « exports CSV et XLSX de tous les journaux et états ») :
bilan, compte de résultat (mois, exercice, % du chiffre d'affaires, exercice précédent), tableau des
flux, balance (classe, soldes d'ouverture, mouvements, soldes débiteur et créditeur), flux mensuels
de trésorerie (calcul du tableau de bord, avec le contrôle de chaque mois) et grand livre (activité,
solde progressif, totaux par compte). Un onglet par état, en-tête société, exercice, date d'arrêté et
date d'export.

kind=modele_syscohada : les trois états au modèle du système normal que remplit l'expert-comptable du
client (etats_modele.py), exercice de la date d'arrêté et colonne N-1.
"""

from datetime import timedelta

from odoo import http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route

from ..models.finance_metrics import ACC_CODE, CARRIED_LINES
from ..models.report_registry import ACC_NAME
from ..models.syscohada import OPENING_JOURNAL, WORKING_CAPITAL_LABEL
from . import etats_modele
from .common import FIN_READ, companies, parse_date, today
from .exporting import XLSX_MIME, export_meta, table_response

MODEL_KIND = "modele_syscohada"
KINDS = ("bilan", "resultat", "flux", "balance", "flux_mensuels", "grand_livre", MODEL_KIND)
ALL = ("bilan", "resultat", "flux", "balance", "flux_mensuels")
MAX_LEDGER_DAYS = 400
# Contrôle de chaque mois des flux mensuels (libellés de l'écran Activités et budget).
CASH_STATUS = {"a_venir": "À venir", "sous_seuil": "Sous le seuil", "cash_net_negatif": "Cash net négatif",
               "conforme": "Conforme"}


def _gnf(amount):
    return f"{amount:,.0f} GNF".replace(",", " ")


def income_with_month(scope, start, end):
    """Compte de résultat de la période, avec les colonnes « Mois » (mois de la date d'arrêté) et
    « % du CA » (montant / chiffre d'affaires XB de la période)."""
    syscohada = request.env["eguitra.syscohada"].sudo()
    current = syscohada.income_statement(scope, start, end)
    month = syscohada.income_statement(scope, max(start, end.replace(day=1)), end)
    by_code = {line["code"]: line["amount"] for line in month["lines"]}
    revenue = current["totals"].get("XB") or 0.0
    for line in current["lines"]:
        line["month"] = by_code.get(line["code"], 0.0)
        line["pct_revenue"] = round(line["amount"] / revenue * 100, 2) if revenue else None
    return current


def _fy_start(day):
    return request.env["eguitra.finance.metrics"].fiscal_year_bounds(request.env.company, day)[0]


def _previous_results(scope, before):
    """Résultat des exercices précédents (avant `before`), au compte d'affectation du résultat de chaque
    société : [(code, libellé, solde)] (finance_metrics.previous_results)."""
    return request.env["eguitra.finance.metrics"].sudo().previous_results(scope, before)


def _bounds(kw):
    end = parse_date(kw, "date_to") or parse_date(kw, "date") or today()
    company = request.env.company
    fy_start, fy_end = request.env["eguitra.finance.metrics"].fiscal_year_bounds(company, end)
    start = parse_date(kw, "date_from", fy_start)
    if start > end:
        raise ApiError(400, "invalid_parameter", "La période est inversée.")
    return start, end, fy_start, fy_end


def _with_previous(meta, text, previous):
    """En-tête d'un état : période de la colonne N-1 et son origine, avant la date d'export."""
    origin = {"import": " (états importés de l'exercice précédent)",
              "mixed": " (plateforme et états importés de l'exercice précédent)"}.get(previous["source"], "")
    return meta[:-1] + [("N-1", text + origin)] + meta[-1:]


class EguitraFinanceStatementsExport(http.Controller):
    @api_route("/finance/statements/export", profiles=FIN_READ)
    def export(self, **kw):
        """kind=all (classeur des cinq états), ou un état : bilan, resultat, flux, balance,
        flux_mensuels, grand_livre ; format=xlsx (défaut) ou csv (un seul état). kind=modele_syscohada :
        bilan, compte de résultat et tableau des flux au modèle du système normal (XLSX seulement)."""
        kind = kw.get("kind") or "all"
        fmt = kw.get("format") or "xlsx"
        if kind != "all" and kind not in KINDS:
            raise ApiError(400, "invalid_parameter", f"État inconnu : {kind}.")
        if fmt == "csv" and kind in ("all", MODEL_KIND):
            raise ApiError(400, "invalid_parameter", "L'export CSV porte sur un seul état (paramètre kind) ; les états "
                                                     "au modèle sont un classeur XLSX.")
        scope = companies(kw)
        start, end, fy_start, fy_end = _bounds(kw)
        if kind == MODEL_KIND:
            content = etats_modele.workbook(etats_modele.model_data(scope, end))
            return request.make_response(content, headers=[
                ("Content-Type", XLSX_MIME), ("Cache-Control", "no-store"),
                ("Content-Disposition", content_disposition(f"etats_syscohada_{end:%Y%m%d}.xlsx")),
            ])
        meta = export_meta(scope, [
            ("Exercice", f"{fy_start:%d/%m/%Y} au {fy_end:%d/%m/%Y}"),
            ("Période", f"{start:%d/%m/%Y} au {end:%d/%m/%Y}"),
            ("Arrêté au", end),
        ])
        builders = {
            "bilan": self._balance_sheet, "resultat": self._income, "flux": self._cash_flow,
            "balance": self._trial_balance, "flux_mensuels": self._monthly_cash, "grand_livre": self._ledger,
        }
        sheets = [builders[k](scope, start, end, meta) for k in (ALL if kind == "all" else (kind,))]
        name = f"etats_{kind}_{end:%Y%m%d}"
        return table_response(name, sheets, fmt, 0)

    # ─── États ────────────────────────────────────────────────────────────

    def _balance_sheet(self, scope, start, end, meta):
        """Actif (brut, amortissements et dépréciations, net) et passif (net) ; N-1 : bilan à la clôture de
        l'exercice précédent, ou états importés pour le premier exercice."""
        sheet = request.env["eguitra.syscohada"].sudo().balance_sheet_compared(scope, end)
        rows, styles = [["", "ACTIF", None, None, None, None, None]], ["header"]
        for side, label in (("actif", None), ("passif", "PASSIF")):
            if label:
                rows.append(["", label, None, None, None, None, None])
                styles.append("header")
            for line in sheet[side]:
                gross = (line["gross"], line["depreciation"]) if side == "actif" else (None, None)
                rows.append([line["code"], line["label"], line["note"], *gross, line["amount"], line["previous"]])
                styles.append("total" if line["total"] else None)
        if sheet["difference"]:
            rows.append(["", "Écart actif - passif", None, None, None, sheet["difference"], None])
            styles.append("total")
        previous = sheet["previous"]["date_to"]
        return {"title": "Bilan", "meta": _with_previous(meta, f"au {previous:%d/%m/%Y}", sheet["previous"]),
                "columns": [("Réf.", "text"), ("Rubrique", "text"), ("Note", "text"), ("Brut", "money"),
                            ("Amort. et dépréc.", "money"), ("Montant net", "money"), ("N-1", "money")],
                "rows": rows, "styles": styles, "totals": None}

    def _income(self, scope, start, end, meta):
        current = income_with_month(scope, start, end)
        request.env["eguitra.syscohada"].sudo().add_previous_income(current, scope, start, end)
        # Le signe (+ / -) n'est porté que par l'export au modèle : en CSV, « + » et « - » seraient précédés de
        # l'apostrophe qui neutralise les formules.
        rows = [[line["code"], line["label"], line["note"], line["month"], line["amount"], line["pct_revenue"],
                 line["previous"]] for line in current["lines"]]
        styles = ["total" if line["total"] else None for line in current["lines"]]
        previous = current["previous"]
        return {"title": "Compte de résultat",
                "meta": _with_previous(meta, f"du {previous['date_from']:%d/%m/%Y} au {previous['date_to']:%d/%m/%Y}",
                                       previous),
                "columns": [("Réf.", "text"), ("Rubrique", "text"), ("Note", "text"), (f"Mois ({end:%m/%Y})", "money"),
                            ("Exercice", "money"), ("% du CA", "percent"), ("N-1", "money")],
                "rows": rows, "styles": styles, "totals": None}

    def _cash_flow(self, scope, start, end, meta):
        flows = request.env["eguitra.syscohada"].sudo().cash_flow_compared(scope, start, end)
        previous = flows["previous"]
        rows, styles = [], []
        for line in flows["lines"]:
            if line["code"] == "ZB":
                rows.append(["", WORKING_CAPITAL_LABEL, None, flows["bf"], previous["bf"]])
                styles.append(None)
            rows.append([line["code"], line["label"], line["letter"], line["amount"], line["previous"]])
            styles.append("total" if line["total"] else None)
        rows.append(["", "Contrôle : trésorerie actif - trésorerie passif du bilan", None, flows["treasury_end"],
                     previous["treasury_end"]])
        styles.append("total")
        if flows["difference"] or previous["difference"]:
            rows.append(["", "Écart avec la trésorerie du bilan (à analyser)", None, flows["difference"],
                         previous["difference"]])
            styles.append("total")
        return {"title": "Tableau des flux",
                "meta": _with_previous(meta, f"du {previous['date_from']:%d/%m/%Y} au {previous['date_to']:%d/%m/%Y}",
                                       previous),
                "columns": [("Réf.", "text"), ("Rubrique", "text"), ("Lettre", "text"), ("Montant", "money"),
                            ("N-1", "money")],
                "rows": rows, "styles": styles, "totals": None}

    def _trial_balance(self, scope, start, end, meta):
        """Balance : soldes d'ouverture (antérieurs à la période, et à-nouveaux de la période),
        mouvements de la période, soldes débiteur et créditeur ; sous-total par classe. Les comptes de
        gestion (classes 6 à 8) repartent de zéro au début de l'exercice : le résultat des exercices
        précédents figure à l'ouverture du compte d'affectation du résultat, comme dans le noyau, et la
        balance reste équilibrée d'un exercice à l'autre."""
        fy_start = _fy_start(end)
        request.env.flush_all()
        request.env.cr.execute(
            f"""SELECT {ACC_CODE} AS code, MAX({ACC_NAME}) AS name,
                       COALESCE(SUM(CASE WHEN aml.date < %(start)s OR aj.code = %(an)s THEN aml.balance END), 0),
                       COALESCE(SUM(CASE WHEN aml.date >= %(start)s AND aj.code != %(an)s THEN aml.debit END), 0),
                       COALESCE(SUM(CASE WHEN aml.date >= %(start)s AND aj.code != %(an)s THEN aml.credit END), 0)
                  FROM account_move_line aml
                  JOIN account_account aa ON aa.id = aml.account_id
                  JOIN account_journal aj ON aj.id = aml.journal_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s) AND aml.date <= %(end)s
                   AND (aml.date >= %(fy_start)s OR {CARRIED_LINES})
              GROUP BY 1""",
            {"companies": list(scope.ids), "start": start, "end": end, "an": OPENING_JOURNAL, "fy_start": fy_start},
        )
        accounts = {code: [name, float(opening), float(debit), float(credit)]
                    for code, name, opening, debit, credit in request.env.cr.fetchall() if code}
        for code, name, balance in _previous_results(scope, fy_start):
            accounts.setdefault(code, [name, 0.0, 0.0, 0.0])[1] += balance
        rows, styles = [], []
        totals = [0.0] * 6
        klass, sub = None, [0.0] * 6
        for code in sorted(accounts):
            name, opening, debit, credit = accounts[code]
            closing = opening + debit - credit
            values = [max(opening, 0.0), max(-opening, 0.0), debit, credit, max(closing, 0.0), max(-closing, 0.0)]
            if not any(values):
                continue
            if klass is not None and code[0] != klass:
                rows.append([klass, f"Total classe {klass}", "", *sub])
                styles.append("total")
                sub = [0.0] * 6
            klass = code[0]
            rows.append([klass, code, name, *values])
            styles.append(None)
            sub = [a + b for a, b in zip(sub, values)]
            totals = [a + b for a, b in zip(totals, values)]
        if klass is not None:
            rows.append([klass, f"Total classe {klass}", "", *sub])
            styles.append("total")
        return {"title": "Balance", "meta": meta,
                "columns": [("Classe", "text"), ("Compte", "text"), ("Libellé", "text"), ("Ouverture débit", "money"),
                            ("Ouverture crédit", "money"), ("Mouvements débit", "money"), ("Mouvements crédit", "money"),
                            ("Solde débiteur", "money"), ("Solde créditeur", "money")],
                "rows": rows, "styles": styles, "totals": ["", "TOTAL", "", *totals]}

    def _monthly_cash(self, scope, start, end, meta):
        rows = self._monthly_cash_rows(scope, start, end)
        threshold = request.env["eguitra.finance.metrics"].sudo()._cash_threshold(scope)
        # Seuil du contrôle « sous le seuil », propre à cet onglet (avant la date d'export).
        meta = meta[:-1] + [("Seuil de sécurité", _gnf(threshold) if threshold else "non fixé (contrôle éteint)")] + meta[-1:]
        return {"title": "Flux mensuels", "meta": meta,
                "columns": [("Mois", "text"), ("Trésorerie d'ouverture", "money"), ("Encaissements", "money"),
                            ("Décaissements", "money"), ("Cash net", "money"), ("Trésorerie de fin de mois", "money"),
                            ("CA HT du mois", "money"), ("Contrôle", "text")],
                "rows": [[r["month"], r["opening"], r["receipts"], r["disbursements"], r["net"], r["closing"], r["revenue"],
                          CASH_STATUS.get(r["status"], r["status"])] for r in rows],
                "totals": ["Période", rows[0]["opening"] if rows else 0.0, sum(r["receipts"] for r in rows),
                           sum(r["disbursements"] for r in rows), sum(r["net"] for r in rows),
                           rows[-1]["closing"] if rows else 0.0, sum(r["revenue"] for r in rows), None]}

    def _monthly_cash_rows(self, scope, start, end):
        """Flux mensuels de trésorerie : le calcul du tableau de bord (eguitra.finance.metrics.monthly_cash),
        écritures arrêtées à la date d'arrêté, du mois de début de la période au mois de cette date (mois
        entiers ; une période sur deux exercices les parcourt l'un après l'autre). Ouverture de chaque
        mois = solde de fin du mois précédent ; contrôle du mois : à venir, sous le seuil de sécurité,
        cash net négatif, conforme."""
        metrics = request.env["eguitra.finance.metrics"].sudo()
        # Dates d'arrêté de chaque exercice couvert, du plus ancien au plus récent.
        stops, day = [], end
        while True:
            stops.insert(0, day)
            fy_start = metrics.fiscal_year_bounds(scope[:1], day)[0]
            if fy_start <= start:
                break
            day = fy_start - timedelta(days=1)
        first = f"{start:%Y-%m}"
        rows = []
        for stop in stops:
            data = metrics.monthly_cash(scope, stop, through=stop)
            balance = data["opening"]
            for month in data["months"]:
                opening, balance = balance, balance + month["net"]
                if first <= month["month"] <= f"{stop:%Y-%m}":
                    rows.append({"month": month["month"], "opening": opening, "receipts": month["receipts"],
                                 "disbursements": month["payments"], "net": month["net"], "closing": balance,
                                 "revenue": month["revenue"], "status": month["status"]})
        return rows

    def _ledger(self, scope, start, end, meta):
        """Grand livre : par compte, report à nouveau, lignes (activité, solde progressif) et total."""
        if (end - start).days > MAX_LEDGER_DAYS:
            raise ApiError(422, "business_rule", "Grand livre limité à un exercice.")
        request.env.flush_all()
        cr = request.env.cr
        fy_start = _fy_start(end)
        params = {"companies": list(scope.ids), "start": start, "end": end, "fy_start": fy_start}
        # Report à nouveau : comptes de bilan depuis l'origine, comptes de gestion depuis le début de
        # l'exercice ; le résultat des exercices précédents s'ajoute à celui du compte d'affectation du
        # résultat (noyau), dont le solde progressif reste ainsi juste après l'OD d'affectation.
        cr.execute(
            f"""SELECT {ACC_CODE}, COALESCE(SUM(aml.balance), 0) FROM account_move_line aml
                  JOIN account_account aa ON aa.id = aml.account_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s) AND aml.date < %(start)s
                   AND ({CARRIED_LINES} OR aml.date >= %(fy_start)s)
              GROUP BY 1""",
            params,
        )
        openings = {code: float(b) for code, b in cr.fetchall() if code}
        for code, _name, balance in _previous_results(scope, min(start, fy_start)):
            openings[code] = openings.get(code, 0.0) + balance
        cr.execute(
            f"""SELECT {ACC_CODE}, {ACC_NAME}, aml.date, aj.code, am.name, COALESCE(p.name, ''), COALESCE(aml.name, ''),
                       aml.analytic_distribution, aml.debit, aml.credit
                  FROM account_move_line aml
                  JOIN account_move am ON am.id = aml.move_id
                  JOIN account_account aa ON aa.id = aml.account_id
                  JOIN account_journal aj ON aj.id = aml.journal_id
             LEFT JOIN res_partner p ON p.id = aml.partner_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s)
                   AND aml.date BETWEEN %(start)s AND %(end)s
              ORDER BY 1, aml.date, am.name, aml.id""",
            params,
        )
        data = cr.fetchall()
        activities = self._activity_names({key for row in data for key in (row[7] or {})})
        rows, styles = [], []
        total_debit = total_credit = 0.0
        current, running, sub_debit, sub_credit = None, 0.0, 0.0, 0.0

        def close_account():
            rows.append([current, "", None, "", "", "", f"Total {current}", "", sub_debit, sub_credit, running])
            styles.append("total")

        for code, name, day, journal, move, partner, label, distribution, debit, credit in data:
            if code != current:
                if current is not None:
                    close_account()
                current, sub_debit, sub_credit = code, 0.0, 0.0
                running = openings.pop(code, 0.0)
                rows.append([code, name, None, "", "", "", "Report à nouveau", "", None, None, running])
                styles.append("header")
            debit, credit = float(debit), float(credit)
            running += debit - credit
            sub_debit += debit
            sub_credit += credit
            total_debit += debit
            total_credit += credit
            activity = ", ".join(sorted({activities[k] for k in (distribution or {}) if k in activities}))
            rows.append([code, name, day, journal, move, partner, label, activity, debit, credit, running])
            styles.append(None)
        if current is not None:
            close_account()
        return {"title": "Grand livre", "meta": meta,
                "columns": [("Compte", "text"), ("Libellé du compte", "text"), ("Date", "date"), ("Journal", "text"),
                            ("Pièce", "text"), ("Tiers", "text"), ("Libellé", "text"), ("Activité", "text"),
                            ("Débit", "money"), ("Crédit", "money"), ("Solde progressif", "money")],
                "rows": rows, "styles": styles,
                "totals": ["TOTAL", "", None, "", "", "", "", "", total_debit, total_credit, total_debit - total_credit]}

    def _activity_names(self, keys):
        """Nom de l'activité de chaque clé de répartition analytique (« 12 » ou « 12,15 »)."""
        plan = request.env.ref("eguitra_base.analytic_plan_activite", raise_if_not_found=False)
        ids = {int(i) for key in keys for i in str(key).split(",") if i.isdigit()}
        accounts = request.env["account.analytic.account"].sudo().browse(list(ids)).exists()
        names = {a.id: a.name for a in accounts if plan and a.plan_id == plan}
        result = {}
        for key in keys:
            found = [names[int(i)] for i in str(key).split(",") if i.isdigit() and int(i) in names]
            if found:
                result[key] = ", ".join(found)
        return result
