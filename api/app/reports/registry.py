"""Registre déclaratif des rapports financiers — lecture directe de la base Odoo.

Le client ne fournit jamais de SQL : il choisit une clé de rapport, des colonnes
(validées contre le whitelist), une période (paramètres liés) et des filtres
prédéfinis. L'engine (engine.py) compose un SELECT paramétré.

Deux modes :
- "list"  : lignes détaillées
- "group" : agrégat (une Column sans `agg` est une dimension, avec `agg` une mesure)

Tables Odoo 18 utilisées : account_move, account_move_line, account_account,
account_journal, res_partner. Les libellés traduisibles sont des jsonb.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Column:
    key: str
    label: str
    expr: str
    type: str = "text"             # text | int | number | money | percent | date
    agg: str | None = None         # sum | avg | count | min | max (mode group)
    default: bool = True
    align: str = "left"


@dataclass(frozen=True)
class Filter:
    key: str
    label: str
    sql: str                       # ex: "am.state = :f_etat"
    type: str = "select"           # select | text
    options: tuple = ()


@dataclass(frozen=True)
class Preset:
    key: str
    label: str
    description: str
    report: str
    period: str = "month"
    columns: tuple = ()
    filters: tuple = ()
    sort: str | None = None
    sort_dir: str = "desc"


@dataclass(frozen=True)
class Report:
    key: str
    label: str
    group: str
    description: str
    mode: str
    base: str
    date_field: str | None
    columns: list[Column]
    default_order: str
    default_order_dir: str = "desc"
    base_where: str = ""
    filters: list[Filter] = field(default_factory=list)


# ════════════════════════════════════════════════════════════════════════════
# Helpers SQL
# ════════════════════════════════════════════════════════════════════════════

# Odoo 18 : le code de compte est stocké par société dans un jsonb `code_store`.
_ACC_CODE = "COALESCE((SELECT v FROM jsonb_each_text(aa.code_store) AS t(k, v) ORDER BY k LIMIT 1), '')"
_ACC_NAME = "COALESCE(aa.name->>'fr_FR', aa.name->>'en_US', '')"
_JRN_NAME = "COALESCE(aj.name->>'fr_FR', aj.name->>'en_US', aj.code)"

_LINES_BASE = (
    "FROM account_move_line aml "
    "JOIN account_move am ON am.id = aml.move_id "
    "JOIN account_account aa ON aa.id = aml.account_id "
    "JOIN account_journal aj ON aj.id = aml.journal_id "
    "LEFT JOIN res_partner p ON p.id = aml.partner_id"
)
_MOVES_BASE = (
    "FROM account_move am "
    "JOIN account_journal aj ON aj.id = am.journal_id "
    "LEFT JOIN res_partner p ON p.id = am.partner_id"
)

_PAY_STATE = Filter(
    key="paiement", label="État de paiement",
    sql="am.payment_state = :f_paiement", options=(
        ("not_paid", "Non payée"), ("partial", "Partielle"),
        ("paid", "Payée"), ("reversed", "Extournée"),
    ),
)
_JOURNAL_TYPE = Filter(
    key="journal", label="Type de journal",
    sql="aj.type = :f_journal", options=(
        ("sale", "Ventes"), ("purchase", "Achats"), ("bank", "Banque"),
        ("cash", "Caisse"), ("general", "Opérations diverses"),
    ),
)
_ACCOUNT_PREFIX = Filter(
    key="compte", label="Compte commence par",
    sql=f"{_ACC_CODE} LIKE :f_compte || '%'", type="text",
)


REPORTS: dict[str, Report] = {}


def _reg(r: Report) -> None:
    REPORTS[r.key] = r


# ─── COMPTABILITÉ GÉNÉRALE ───────────────────────────────────────────────────

_reg(Report(
    key="grand_livre", label="Grand livre", group="Comptabilité",
    description="Toutes les écritures comptabilisées, ligne par ligne.",
    mode="list", base=_LINES_BASE, date_field="aml.date",
    base_where="am.state = 'posted' AND aml.display_type IN ('product','tax','payment_term','rounding','cogs')",
    default_order="date", filters=[_JOURNAL_TYPE, _ACCOUNT_PREFIX],
    columns=[
        Column("date", "Date", "aml.date", "date"),
        Column("piece", "Pièce", "am.name", "text"),
        Column("journal", "Journal", "aj.code", "text"),
        Column("compte", "Compte", _ACC_CODE, "text"),
        Column("libelle_compte", "Libellé du compte", _ACC_NAME, "text", default=False),
        Column("tiers", "Tiers", "COALESCE(p.name,'')", "text"),
        Column("libelle", "Libellé", "COALESCE(aml.name,'')", "text"),
        Column("debit", "Débit", "aml.debit", "money", agg="sum", align="right"),
        Column("credit", "Crédit", "aml.credit", "money", agg="sum", align="right"),
        Column("solde", "Solde", "aml.balance", "money", agg="sum", align="right", default=False),
    ],
))

_reg(Report(
    key="balance", label="Balance générale", group="Comptabilité",
    description="Totaux débit, crédit et solde par compte sur la période.",
    mode="group", base=_LINES_BASE, date_field="aml.date",
    base_where="am.state = 'posted' AND aml.display_type IN ('product','tax','payment_term','rounding','cogs')",
    default_order="compte", default_order_dir="asc", filters=[_ACCOUNT_PREFIX],
    columns=[
        Column("compte", "Compte", _ACC_CODE, "text"),
        Column("libelle", "Libellé", _ACC_NAME, "text"),
        Column("debit", "Débit", "aml.debit", "money", agg="sum", align="right"),
        Column("credit", "Crédit", "aml.credit", "money", agg="sum", align="right"),
        Column("solde", "Solde", "aml.balance", "money", agg="sum", align="right"),
    ],
))

_reg(Report(
    key="journaux", label="Totaux par journal", group="Comptabilité",
    description="Débit et crédit totaux par journal sur la période.",
    mode="group", base=_LINES_BASE, date_field="aml.date",
    base_where="am.state = 'posted'", default_order="journal", default_order_dir="asc",
    columns=[
        Column("journal", "Journal", "aj.code", "text"),
        Column("libelle", "Libellé", _JRN_NAME, "text"),
        Column("nb", "Écritures", "am.id", "int", agg="count", align="right"),
        Column("debit", "Débit", "aml.debit", "money", agg="sum", align="right"),
        Column("credit", "Crédit", "aml.credit", "money", agg="sum", align="right"),
    ],
))

# ─── VENTES ET ACHATS ────────────────────────────────────────────────────────

_reg(Report(
    key="ventes", label="Factures de vente", group="Ventes",
    description="Factures et avoirs clients comptabilisés.",
    mode="list", base=_MOVES_BASE, date_field="am.invoice_date",
    base_where="am.state = 'posted' AND am.move_type IN ('out_invoice','out_refund')",
    default_order="date", filters=[_PAY_STATE],
    columns=[
        Column("date", "Date", "am.invoice_date", "date"),
        Column("numero", "Numéro", "am.name", "text"),
        Column("client", "Client", "COALESCE(p.name,'')", "text"),
        Column("echeance", "Échéance", "am.invoice_date_due", "date", default=False),
        Column("ht", "Montant HT", "am.amount_untaxed_signed", "money", agg="sum", align="right"),
        Column("ttc", "Montant TTC", "am.amount_total_signed", "money", agg="sum", align="right"),
        Column("reste", "Reste dû", "am.amount_residual_signed", "money", agg="sum", align="right"),
        Column("paiement", "Paiement", "am.payment_state", "text"),
    ],
))

_reg(Report(
    key="achats", label="Factures d'achat", group="Achats",
    description="Factures et avoirs fournisseurs comptabilisés.",
    mode="list", base=_MOVES_BASE, date_field="am.invoice_date",
    base_where="am.state = 'posted' AND am.move_type IN ('in_invoice','in_refund')",
    default_order="date", filters=[_PAY_STATE],
    columns=[
        Column("date", "Date", "am.invoice_date", "date"),
        Column("numero", "Numéro", "am.name", "text"),
        Column("reference", "Réf. fournisseur", "COALESCE(am.ref,'')", "text", default=False),
        Column("fournisseur", "Fournisseur", "COALESCE(p.name,'')", "text"),
        Column("echeance", "Échéance", "am.invoice_date_due", "date", default=False),
        Column("ht", "Montant HT", "-am.amount_untaxed_signed", "money", agg="sum", align="right"),
        Column("ttc", "Montant TTC", "-am.amount_total_signed", "money", agg="sum", align="right"),
        Column("reste", "Reste dû", "-am.amount_residual_signed", "money", agg="sum", align="right"),
        Column("paiement", "Paiement", "am.payment_state", "text"),
    ],
))

_reg(Report(
    key="encours_clients", label="Encours clients", group="Ventes",
    description="Reste dû par client sur les factures non soldées.",
    mode="group", base=_MOVES_BASE, date_field=None,
    base_where="am.state = 'posted' AND am.move_type = 'out_invoice' AND am.payment_state IN ('not_paid','partial')",
    default_order="reste",
    columns=[
        Column("client", "Client", "COALESCE(p.name,'')", "text"),
        Column("nb", "Factures", "am.id", "int", agg="count", align="right"),
        Column("reste", "Reste dû", "am.amount_residual_signed", "money", agg="sum", align="right"),
        Column("retard_max", "Retard max (j)", "GREATEST(0, CURRENT_DATE - am.invoice_date_due)", "int", agg="max", align="right"),
    ],
))

_reg(Report(
    key="encours_fournisseurs", label="Encours fournisseurs", group="Achats",
    description="Reste à payer par fournisseur sur les factures non soldées.",
    mode="group", base=_MOVES_BASE, date_field=None,
    base_where="am.state = 'posted' AND am.move_type = 'in_invoice' AND am.payment_state IN ('not_paid','partial')",
    default_order="reste",
    columns=[
        Column("fournisseur", "Fournisseur", "COALESCE(p.name,'')", "text"),
        Column("nb", "Factures", "am.id", "int", agg="count", align="right"),
        Column("reste", "Reste à payer", "-am.amount_residual_signed", "money", agg="sum", align="right"),
    ],
))

# ─── TRÉSORERIE ──────────────────────────────────────────────────────────────

_reg(Report(
    key="tresorerie", label="Mouvements de trésorerie", group="Trésorerie",
    description="Écritures sur les comptes de banque et de caisse.",
    mode="list", base=_LINES_BASE, date_field="aml.date",
    base_where="am.state = 'posted' AND aa.account_type = 'asset_cash'",
    default_order="date",
    columns=[
        Column("date", "Date", "aml.date", "date"),
        Column("compte", "Compte", _ACC_CODE, "text"),
        Column("journal", "Journal", _JRN_NAME, "text"),
        Column("tiers", "Tiers", "COALESCE(p.name,'')", "text"),
        Column("libelle", "Libellé", "COALESCE(aml.name,'')", "text"),
        Column("entree", "Entrée", "aml.debit", "money", agg="sum", align="right"),
        Column("sortie", "Sortie", "aml.credit", "money", agg="sum", align="right"),
    ],
))

_reg(Report(
    key="position_tresorerie", label="Position de trésorerie", group="Trésorerie",
    description="Solde de chaque compte de banque et de caisse.",
    mode="group", base=_LINES_BASE, date_field=None,
    base_where="am.state = 'posted' AND aa.account_type = 'asset_cash'",
    default_order="solde",
    columns=[
        Column("compte", "Compte", _ACC_CODE, "text"),
        Column("libelle", "Libellé", _ACC_NAME, "text"),
        Column("solde", "Solde", "aml.balance", "money", agg="sum", align="right"),
    ],
))


PRESETS: list[Preset] = [
    Preset("balance_mois", "Balance du mois", "Balance générale de la période en cours.", "balance", period="month"),
    Preset("gl_banque", "Grand livre banques du mois", "Mouvements des journaux de banque.", "grand_livre", period="month", filters=(("journal", "bank"),)),
    Preset("ventes_annee", "Ventes de l'exercice", "Factures clients depuis le 1er janvier.", "ventes", period="year"),
    Preset("impayes", "Factures clients impayées", "Encours par client, tous exercices.", "encours_clients", period="all"),
]


def list_catalog() -> dict:
    """Catalogue exposé au frontend (rapports + colonnes + presets)."""
    groups: dict[str, list] = {}
    for r in REPORTS.values():
        groups.setdefault(r.group, []).append({
            "key": r.key, "label": r.label, "group": r.group,
            "description": r.description, "mode": r.mode,
            "has_date": r.date_field is not None,
            "columns": [
                {"key": c.key, "label": c.label, "type": c.type,
                 "default": c.default, "align": c.align, "agg": c.agg}
                for c in r.columns
            ],
            "filters": [
                {"key": f.key, "label": f.label, "type": f.type,
                 "options": [{"value": v, "label": lb} for v, lb in f.options]}
                for f in r.filters
            ],
            "default_order": r.default_order,
            "default_order_dir": r.default_order_dir,
        })
    return {
        "groups": [{"name": g, "reports": rs} for g, rs in groups.items()],
        "presets": [
            {"key": p.key, "label": p.label, "description": p.description,
             "report": p.report, "period": p.period, "columns": list(p.columns),
             "filters": [{"key": k, "value": v} for k, v in p.filters],
             "sort": p.sort, "sort_dir": p.sort_dir}
            for p in PRESETS
        ],
    }
