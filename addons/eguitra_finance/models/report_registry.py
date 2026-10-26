"""Registre déclaratif des rapports financiers et moteur d'exécution.

L'utilisateur ne fournit jamais de SQL : il choisit une clé de rapport, des colonnes (liste
blanche du rapport), une période et des filtres prédéfinis, tous passés en paramètres liés.
Le seul SQL vient de ce registre. Chaque requête est restreinte aux sociétés autorisées.

Deux modes : « list » (lignes détaillées) et « group » (une colonne sans agrégat est une
dimension, une colonne avec agrégat une mesure).
"""

import csv
import io
from dataclasses import dataclass, field
from datetime import date

from odoo import api, models

from odoo.addons.eguitra_api.files import XLSX_OPTIONS, csv_text

ACC_CODE = "COALESCE(aa.code_store->>(aml.company_id::text), '')"
ACC_NAME = "COALESCE(aa.name->>'fr_FR', aa.name->>'en_US', '')"
JRN_NAME = "COALESCE(aj.name->>'fr_FR', aj.name->>'en_US', aj.code)"
PARTNER = "COALESCE(p.name, '')"

LINES_BASE = (
    "FROM account_move_line aml "
    "JOIN account_move am ON am.id = aml.move_id "
    "JOIN account_account aa ON aa.id = aml.account_id "
    "JOIN account_journal aj ON aj.id = aml.journal_id "
    "LEFT JOIN res_partner p ON p.id = aml.partner_id"
)
MOVES_BASE = (
    "FROM account_move am "
    "JOIN account_journal aj ON aj.id = am.journal_id "
    "LEFT JOIN res_partner p ON p.id = am.partner_id"
)
POSTED_LINES = "am.state = 'posted' AND aml.display_type NOT IN ('line_section', 'line_note')"
# Activité analytique de la ligne (axe « Activité » de sa répartition), nom traduit ou non.
ACTIVITY = (
    "COALESCE((SELECT string_agg(DISTINCT COALESCE(to_jsonb(aaa.name)->>'fr_FR', to_jsonb(aaa.name)->>'en_US', "
    "to_jsonb(aaa.name)#>>'{}'), ', ') "
    "FROM jsonb_object_keys(COALESCE(aml.analytic_distribution, '{}'::jsonb)) AS dk(key) "
    "JOIN account_analytic_account aaa ON aaa.id::text = ANY(string_to_array(dk.key, ',')) "
    "WHERE aaa.plan_id IN (SELECT res_id FROM ir_model_data WHERE model = 'account.analytic.plan' "
    "AND module = 'eguitra_base' AND name = 'analytic_plan_activite')), '')"
)
MAX_LIMIT = 5000
# Exports (CSV, XLSX) : bien au-delà de l'écran ; au-delà encore, le fichier le signale (TRUNCATED).
MAX_EXPORT = 100000
TRUNCATED = "Export limité aux {shown} premières lignes sur {total} : affinez la période ou les filtres."


@dataclass(frozen=True)
class Column:
    key: str
    label: str
    expr: str
    type: str = "text"  # text | int | number | money | percent | date
    agg: str | None = None  # sum | count | max | min | avg
    default: bool = True
    align: str = "left"


@dataclass(frozen=True)
class Filter:
    key: str
    label: str
    sql: str  # ex. "aj.type = %(f_journal)s"
    type: str = "select"  # select | text | partner
    options: tuple = ()
    cast: type = str


@dataclass(frozen=True)
class Report:
    key: str
    label: str
    group: str
    description: str
    mode: str
    base: str
    company_field: str
    date_field: str | None
    columns: list
    default_order: str
    default_order_dir: str = "desc"
    base_where: str = ""
    filters: list = field(default_factory=list)


def labelled(expr, labels):
    """Expression SQL qui écrit une valeur codée en clair (« not_paid » : « Non payée ») à l'écran comme dans
    les exports ; les libellés viennent du registre, jamais de la saisie."""
    cases = " ".join(f"WHEN '{code}' THEN '{label.replace(chr(39), chr(39) * 2)}'" for code, label in labels)
    return f"(CASE {expr} {cases} ELSE {expr} END)"


PAYMENT_LABELS = (
    ("not_paid", "Non payée"), ("partial", "Partielle"), ("in_payment", "En paiement"), ("paid", "Payée"),
    ("reversed", "Extournée"), ("invoicing_legacy", "Historique"), ("blocked", "Bloquée"),
)
TAX_USE_LABELS = (("sale", "Collectée"), ("purchase", "Déductible"), ("none", "Autre"))

PAY_STATE = Filter("paiement", "État de paiement", "am.payment_state = %(f_paiement)s", options=(
    ("not_paid", "Non payée"), ("partial", "Partielle"), ("paid", "Payée"), ("in_payment", "En paiement"),
    ("reversed", "Extournée"),
))
JOURNAL_TYPE = Filter("journal", "Type de journal", "aj.type = %(f_journal)s", options=(
    ("sale", "Ventes"), ("purchase", "Achats"), ("bank", "Banque"), ("cash", "Caisse"), ("general", "Opérations diverses"),
))
ACCOUNT_PREFIX = Filter("compte", "Compte commençant par", f"{ACC_CODE} LIKE %(f_compte)s || '%%'", type="text")
PARTNER_FILTER = Filter("tiers", "Tiers", "aml.partner_id = %(f_tiers)s", type="partner", cast=int)
MOVE_PARTNER = Filter("tiers", "Tiers", "am.partner_id = %(f_tiers)s", type="partner", cast=int)

REPORTS: dict = {}


def _reg(report):
    REPORTS[report.key] = report


_reg(Report(
    "grand_livre", "Grand livre", "Comptabilité", "Toutes les écritures comptabilisées, ligne par ligne.",
    "list", LINES_BASE, "aml.company_id", "aml.date",
    base_where=POSTED_LINES, default_order="date", default_order_dir="asc",
    filters=[JOURNAL_TYPE, ACCOUNT_PREFIX, PARTNER_FILTER],
    columns=[
        Column("date", "Date", "aml.date", "date"),
        Column("piece", "Pièce", "am.name"),
        Column("journal", "Journal", "aj.code"),
        Column("compte", "Compte", ACC_CODE),
        Column("libelle_compte", "Libellé du compte", ACC_NAME, default=False),
        Column("tiers", "Tiers", PARTNER),
        Column("libelle", "Libellé", "COALESCE(aml.name, '')"),
        Column("activite", "Activité", ACTIVITY),
        Column("debit", "Débit", "aml.debit", "money", "sum", align="right"),
        Column("credit", "Crédit", "aml.credit", "money", "sum", align="right"),
        Column("solde", "Solde", "aml.balance", "money", "sum", default=False, align="right"),
        Column("lettrage", "Lettrage", "COALESCE(aml.matching_number, '')", default=False),
    ],
))
_reg(Report(
    "balance", "Balance générale", "Comptabilité",
    "Débit, crédit, soldes débiteur et créditeur par compte sur la période, par classe.",
    "group", LINES_BASE, "aml.company_id", "aml.date",
    base_where=POSTED_LINES, default_order="compte", default_order_dir="asc", filters=[ACCOUNT_PREFIX],
    columns=[
        Column("classe", "Classe", f"LEFT({ACC_CODE}, 1)"),
        Column("compte", "Compte", ACC_CODE),
        Column("libelle", "Libellé", ACC_NAME),
        Column("debit", "Débit", "aml.debit", "money", "sum", align="right"),
        Column("credit", "Crédit", "aml.credit", "money", "sum", align="right"),
        Column("solde_debiteur", "Solde débiteur", "aml.balance", "money", "debit_balance", align="right"),
        Column("solde_crediteur", "Solde créditeur", "aml.balance", "money", "credit_balance", align="right"),
        Column("solde", "Solde", "aml.balance", "money", "sum", default=False, align="right"),
    ],
))
_reg(Report(
    "balance_tiers", "Balance des tiers", "Comptabilité", "Soldes clients et fournisseurs par tiers.",
    "group", LINES_BASE, "aml.company_id", "aml.date",
    base_where=POSTED_LINES + " AND aa.account_type IN ('asset_receivable', 'liability_payable')",
    default_order="solde", filters=[ACCOUNT_PREFIX],
    columns=[
        Column("tiers", "Tiers", PARTNER),
        Column("compte", "Compte", ACC_CODE),
        Column("debit", "Débit", "aml.debit", "money", "sum", align="right"),
        Column("credit", "Crédit", "aml.credit", "money", "sum", align="right"),
        Column("solde", "Solde", "aml.balance", "money", "sum", align="right"),
    ],
))
_reg(Report(
    "journaux", "Totaux par journal", "Comptabilité", "Débit et crédit par journal sur la période.",
    "group", LINES_BASE, "aml.company_id", "aml.date",
    base_where=POSTED_LINES, default_order="journal", default_order_dir="asc",
    columns=[
        Column("journal", "Journal", "aj.code"),
        Column("libelle", "Libellé", JRN_NAME),
        Column("lignes", "Lignes", "aml.id", "int", "count", align="right"),
        Column("debit", "Débit", "aml.debit", "money", "sum", align="right"),
        Column("credit", "Crédit", "aml.credit", "money", "sum", align="right"),
    ],
))
_reg(Report(
    "ventes", "Factures de vente", "Ventes", "Factures et avoirs clients comptabilisés.",
    "list", MOVES_BASE, "am.company_id", "am.invoice_date",
    base_where="am.state = 'posted' AND am.move_type IN ('out_invoice', 'out_refund')",
    default_order="date", filters=[PAY_STATE, MOVE_PARTNER],
    columns=[
        Column("date", "Date", "am.invoice_date", "date"),
        Column("numero", "Numéro", "am.name"),
        Column("client", "Client", PARTNER),
        Column("echeance", "Échéance", "am.invoice_date_due", "date", default=False),
        Column("ht", "Montant HT", "am.amount_untaxed_signed", "money", "sum", align="right"),
        Column("ttc", "Montant TTC", "am.amount_total_signed", "money", "sum", align="right"),
        Column("reste", "Reste dû", "am.amount_residual_signed", "money", "sum", align="right"),
        Column("paiement", "Paiement", labelled("am.payment_state", PAYMENT_LABELS)),
    ],
))
_reg(Report(
    "ventes_par_client", "Chiffre d'affaires par client", "Ventes", "Chiffre d'affaires (comptes 70) par client.",
    "group", LINES_BASE, "aml.company_id", "aml.date",
    base_where=POSTED_LINES + f" AND {ACC_CODE} LIKE '70%%'", default_order="ca",
    columns=[
        Column("client", "Client", PARTNER),
        Column("factures", "Pièces", "DISTINCT am.id", "int", "count", align="right"),
        Column("ca", "Chiffre d'affaires HT", "-aml.balance", "money", "sum", align="right"),
    ],
))
_reg(Report(
    "achats", "Pièces d'achat", "Achats", "Factures et avoirs fournisseurs comptabilisés.",
    "list", MOVES_BASE, "am.company_id", "am.invoice_date",
    base_where="am.state = 'posted' AND am.move_type IN ('in_invoice', 'in_refund')",
    default_order="date", filters=[PAY_STATE, MOVE_PARTNER],
    columns=[
        Column("date", "Date", "am.invoice_date", "date"),
        Column("numero", "Numéro", "am.name"),
        Column("reference", "Réf. fournisseur", "COALESCE(am.ref, '')", default=False),
        Column("fournisseur", "Fournisseur", PARTNER),
        Column("echeance", "Échéance", "am.invoice_date_due", "date", default=False),
        Column("ht", "Montant HT", "-am.amount_untaxed_signed", "money", "sum", align="right"),
        Column("ttc", "Montant TTC", "-am.amount_total_signed", "money", "sum", align="right"),
        Column("reste", "Reste à payer", "-am.amount_residual_signed", "money", "sum", align="right"),
        Column("paiement", "Paiement", labelled("am.payment_state", PAYMENT_LABELS)),
    ],
))
_reg(Report(
    "charges_par_compte", "Charges par compte", "Achats", "Charges (classe 6) par compte sur la période.",
    "group", LINES_BASE, "aml.company_id", "aml.date",
    base_where=POSTED_LINES + f" AND {ACC_CODE} LIKE '6%%'", default_order="montant", filters=[ACCOUNT_PREFIX],
    columns=[
        Column("compte", "Compte", ACC_CODE),
        Column("libelle", "Libellé", ACC_NAME),
        Column("montant", "Montant", "aml.balance", "money", "sum", align="right"),
    ],
))
_reg(Report(
    "encours_clients", "Encours clients", "Ventes", "Reste dû par client sur les factures non soldées.",
    "group", LINES_BASE, "aml.company_id", None,
    base_where=POSTED_LINES + " AND aa.account_type = 'asset_receivable' AND NOT aml.reconciled",
    default_order="reste",
    columns=[
        Column("client", "Client", PARTNER),
        Column("pieces", "Pièces", "DISTINCT am.id", "int", "count", align="right"),
        Column("reste", "Reste dû", "aml.amount_residual", "money", "sum", align="right"),
        Column("echu", "Dont échu", "CASE WHEN aml.date_maturity < CURRENT_DATE THEN aml.amount_residual ELSE 0 END",
               "money", "sum", align="right"),
        Column("retard_max", "Retard max (j)", "GREATEST(0, CURRENT_DATE - aml.date_maturity)", "int", "max",
               align="right"),
    ],
))
_reg(Report(
    "encours_fournisseurs", "Encours fournisseurs", "Achats", "Reste à payer par fournisseur.",
    "group", LINES_BASE, "aml.company_id", None,
    base_where=POSTED_LINES + " AND aa.account_type = 'liability_payable' AND NOT aml.reconciled",
    default_order="reste",
    columns=[
        Column("fournisseur", "Fournisseur", PARTNER),
        Column("pieces", "Pièces", "DISTINCT am.id", "int", "count", align="right"),
        Column("reste", "Reste à payer", "-aml.amount_residual", "money", "sum", align="right"),
        Column("echu", "Dont échu", "CASE WHEN aml.date_maturity < CURRENT_DATE THEN -aml.amount_residual ELSE 0 END",
               "money", "sum", align="right"),
    ],
))
_reg(Report(
    "tresorerie", "Mouvements de trésorerie", "Trésorerie", "Écritures des comptes de banque et de caisse.",
    "list", LINES_BASE, "aml.company_id", "aml.date",
    base_where=POSTED_LINES + " AND aa.account_type = 'asset_cash'", default_order="date",
    filters=[PARTNER_FILTER],
    columns=[
        Column("date", "Date", "aml.date", "date"),
        Column("journal", "Journal", JRN_NAME),
        Column("piece", "Pièce", "am.name"),
        Column("tiers", "Tiers", PARTNER),
        Column("libelle", "Libellé", "COALESCE(aml.name, '')"),
        Column("entree", "Entrée", "aml.debit", "money", "sum", align="right"),
        Column("sortie", "Sortie", "aml.credit", "money", "sum", align="right"),
    ],
))
_reg(Report(
    "tva", "TVA par taxe", "Fiscalité", "Montants de taxe comptabilisés, par taxe.",
    "group", LINES_BASE + " JOIN account_tax tax ON tax.id = aml.tax_line_id", "aml.company_id", "aml.date",
    base_where=POSTED_LINES, default_order="taxe", default_order_dir="asc",
    filters=[Filter("usage", "Type", "tax.type_tax_use = %(f_usage)s", options=(("sale", "Collectée"), ("purchase", "Déductible")))],
    columns=[
        Column("taxe", "Taxe", "COALESCE(tax.name->>'fr_FR', tax.name->>'en_US')"),
        Column("usage", "Type", labelled("tax.type_tax_use", TAX_USE_LABELS)),
        Column("compte", "Compte", ACC_CODE),
        Column("montant", "Montant de taxe", "-aml.balance", "money", "sum", align="right"),
    ],
))


def list_catalog():
    groups = {}
    for report in REPORTS.values():
        groups.setdefault(report.group, []).append({
            "key": report.key,
            "label": report.label,
            "description": report.description,
            "mode": report.mode,
            "has_date": report.date_field is not None,
            "columns": [
                {"key": c.key, "label": c.label, "type": c.type, "default": c.default, "align": c.align, "agg": c.agg}
                for c in report.columns
            ],
            "filters": [
                {"key": f.key, "label": f.label, "type": f.type,
                 "options": [{"value": v, "label": lb} for v, lb in f.options]}
                for f in report.filters
            ],
            "default_order": report.default_order,
            "default_order_dir": report.default_order_dir,
        })
    return [{"name": g, "reports": rs} for g, rs in groups.items()]


def _agg(column):
    if column.agg == "count":
        return f"COUNT({column.expr})"
    # Solde débiteur ou créditeur d'un regroupement (compte) : max(0, D - C) ou max(0, C - D).
    if column.agg == "debit_balance":
        return f"GREATEST(SUM({column.expr}), 0)"
    if column.agg == "credit_balance":
        return f"GREATEST(-SUM({column.expr}), 0)"
    return f"{column.agg.upper()}({column.expr})"


class EguitraReportEngine(models.AbstractModel):
    _name = "eguitra.report.engine"
    _description = "Moteur de rapports EGUITRA"

    @api.model
    def run(self, key, companies, date_from=None, date_to=None, columns=None, filters=None, sort=None,
            sort_dir="desc", limit=200, offset=0, max_limit=MAX_LIMIT):
        report = REPORTS.get(key)
        if report is None:
            raise ValueError(f"Rapport inconnu : {key}")
        filters = filters or {}
        limit = max(1, min(int(limit or 200), max_limit))
        offset = max(0, int(offset or 0))
        by_key = {c.key: c for c in report.columns}
        selected = [by_key[k] for k in (columns or []) if k in by_key] or [c for c in report.columns if c.default]

        params = {"companies": list(companies.ids)}
        where = [f"{report.company_field} = ANY(%(companies)s)"]
        if report.base_where:
            where.append(report.base_where)
        if report.date_field and date_from:
            where.append(f"{report.date_field} >= %(date_from)s")
            params["date_from"] = date_from
        if report.date_field and date_to:
            where.append(f"{report.date_field} <= %(date_to)s")
            params["date_to"] = date_to
        for flt in report.filters:
            value = filters.get(flt.key)
            if value in (None, "", "all"):
                continue
            if flt.options and value not in {v for v, _l in flt.options}:
                raise ValueError(f"Valeur de filtre invalide : {flt.key}")
            try:
                params[f"f_{flt.key}"] = flt.cast(value)
            except (TypeError, ValueError) as e:
                raise ValueError(f"Valeur de filtre invalide : {flt.key}") from e
            where.append(flt.sql)
        where_sql = " AND ".join(where)

        if report.mode == "group":
            select = [f"{_agg(c)} AS {c.key}" if c.agg else f"{c.expr} AS {c.key}" for c in selected]
            dims = [c.expr for c in selected if not c.agg]
        else:
            select = [f"{c.expr} AS {c.key}" for c in selected]
            dims = []
        selected_keys = {c.key for c in selected}
        order_key = sort if sort in selected_keys else (
            report.default_order if report.default_order in selected_keys else selected[0].key
        )
        direction = sort_dir if sort in selected_keys else report.default_order_dir
        direction = "ASC" if str(direction).lower() == "asc" else "DESC"

        base_sql = f"SELECT {', '.join(select)} {report.base} WHERE {where_sql}"
        if dims:
            base_sql += f" GROUP BY {', '.join(dims)}"
        self.env.flush_all()
        cr = self.env.cr
        cr.execute(f'{base_sql} ORDER BY "{order_key}" {direction} NULLS LAST LIMIT %(limit)s OFFSET %(offset)s',
                   dict(params, limit=limit, offset=offset))
        names = [d[0] for d in cr.description]
        rows = [dict(zip(names, r)) for r in cr.fetchall()]

        totals = {}
        measures = [c for c in selected if c.agg in ("sum", "count")]
        if measures:
            cr.execute(f"SELECT {', '.join(f'{_agg(c)} AS {c.key}' for c in measures)} {report.base} WHERE {where_sql}", params)
            first = cr.fetchone()
            totals = {c.key: float(v or 0) for c, v in zip(measures, first)}
        # Soldes débiteurs et créditeurs : total des soldes de chaque regroupement, pas solde du total.
        balances = [c for c in selected if c.agg in ("debit_balance", "credit_balance")]
        if balances and dims:
            cr.execute(f"SELECT {', '.join(f'SUM({c.key})' for c in balances)} FROM ({base_sql}) t", params)
            first = cr.fetchone()
            totals.update({c.key: float(v or 0) for c, v in zip(balances, first)})
        if dims:
            cr.execute(f"SELECT COUNT(*) FROM (SELECT 1 {report.base} WHERE {where_sql} GROUP BY {', '.join(dims)}) t", params)
        else:
            cr.execute(f"SELECT COUNT(*) {report.base} WHERE {where_sql}", params)
        total_count = cr.fetchone()[0]
        return {
            "report": key,
            "label": report.label,
            "mode": report.mode,
            "columns": [{"key": c.key, "label": c.label, "type": c.type, "align": c.align, "agg": c.agg} for c in selected],
            "rows": rows,
            "totals": totals,
            "total_count": total_count,
            "limit": limit,
            "offset": offset,
            "has_next": offset + limit < total_count,
            "period": {"from": date_from, "to": date_to},
        }

    @api.model
    def to_csv(self, result):
        buf = io.StringIO()
        buf.write("﻿")  # Excel reconnaît l'UTF-8
        writer = csv.writer(buf, delimiter=";")
        cols = result["columns"]
        writer.writerow([c["label"] for c in cols])
        for row in result["rows"]:
            writer.writerow([_cell(row.get(c["key"]), c["type"]) for c in cols])
        if result["totals"]:
            writer.writerow(["TOTAL" if i == 0 else _cell(result["totals"].get(c["key"]), c["type"])
                             for i, c in enumerate(cols)])
        if result["has_next"]:
            writer.writerow([TRUNCATED.format(shown=len(result["rows"]), total=result["total_count"])])
        return buf.getvalue().encode("utf-8")

    @api.model
    def to_xlsx(self, result, title):
        import xlsxwriter

        out = io.BytesIO()
        book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
        sheet = book.add_worksheet(title[:31])
        bold = book.add_format({"bold": True, "bg_color": "#10133A", "font_color": "#FFFFFF", "border": 1})
        money = book.add_format({"num_format": "#,##0"})
        day = book.add_format({"num_format": "dd/mm/yyyy"})
        total = book.add_format({"bold": True, "num_format": "#,##0", "top": 2})
        cols = result["columns"]
        sheet.write_row(0, 0, [c["label"] for c in cols], bold)
        for r, row in enumerate(result["rows"], start=1):
            for c_idx, col in enumerate(cols):
                value = row.get(col["key"])
                if col["type"] in ("money", "number", "int") and value is not None:
                    sheet.write_number(r, c_idx, float(value), money)
                elif col["type"] == "date" and isinstance(value, date):
                    sheet.write_datetime(r, c_idx, value, day)
                else:
                    sheet.write_string(r, c_idx, "" if value is None else str(value))
        last = len(result["rows"]) + 1
        if result["totals"]:
            sheet.write(last, 0, "TOTAL", total)
            for c_idx, col in enumerate(cols):
                if col["key"] in result["totals"]:
                    sheet.write_number(last, c_idx, result["totals"][col["key"]], total)
            last += 1
        if result["has_next"]:
            sheet.write(last + 1, 0, TRUNCATED.format(shown=len(result["rows"]), total=result["total_count"]),
                        book.add_format({"bold": True, "font_color": "#B00020"}))
        sheet.freeze_panes(1, 0)
        for c_idx, col in enumerate(cols):
            sheet.set_column(c_idx, c_idx, 16 if col["type"] in ("money", "date") else 28)
        book.close()
        return out.getvalue()


def _cell(value, kind):
    if value is None:
        return ""
    if kind in ("money", "int"):
        return f"{float(value):.0f}"
    if kind in ("number", "percent"):
        return str(value)
    if kind == "date" and isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    return csv_text(value)
