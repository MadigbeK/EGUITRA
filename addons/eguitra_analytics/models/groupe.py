"""Analyses d'EGUITRA GROUP SARLU (spécification, chapitre 5).

Une méthode publique par section (synthese, rentabilite, tresorerie, clients, transport, depenses,
previsions, fiabilite), chacune (company, period) -> blocs de la section, constats classés (insights,
voir engine/insights.py) et fiabilité des données (quality). La période est celle de
controllers/common.parse_period.

Principes communs :
- écritures comptabilisées de la seule société demandée (parent_state = 'posted', company_id) ; montants
  en GNF hors taxes pour les produits et les charges, toutes taxes comprises pour les créances, les dettes
  et les délais ;
- mêmes définitions que la finance : chiffre d'affaires = XB, EBE = XD, résultat d'exploitation = XE,
  résultat net = XI des états SYSCOHADA (eguitra.syscohada) ; DSO = créances clients / ventes TTC × jours,
  DPO et DIO sur les achats TTC (working_capital) ; marge transport = marge directe des rotations validées
  (profitability) ; structure et résultat net par ensemble routier = eguitra.transport.analysis ; DSCR =
  EBE des douze derniers mois / service de la dette des douze derniers mois (à défaut, des douze prochains) ;
  activités = axe analytique Activité (by_analytic_plan) ;
- soldes à une date passée lus sur les écritures (historiquement exacts) ; restes dus des pièces
  ouvertes lus au jour du calcul, comme la balance âgée de la finance ;
- requêtes SQL agrégées pour les volumes (lignes d'écriture et analytiques, lettrages), ORM pour les
  référentiels ; lecture seule : rien n'est écrit en comptabilité.
"""

import logging
import math
import random
import re
from datetime import date, timedelta

from dateutil.relativedelta import relativedelta

from odoo import api, models

from odoo.addons.eguitra_finance.formats import days
from odoo.addons.eguitra_finance.models.analytic import ACTIVITY_PLAN, account_shares
from odoo.addons.eguitra_finance.models.finance_metrics import ACC_CODE
from odoo.addons.eguitra_finance.models.pilotage import DOUBTFUL_DAYS
from odoo.addons.eguitra_finance.models.syscohada import CR_LINES, CR_TOTALS, OPENING_JOURNAL, _compute, _totals

from ..engine import benford, forecast, stats
from ..engine.insights import gnf, insight, pct, rank

_logger = logging.getLogger(__name__)

AAL_CODE = ACC_CODE.replace("aml.", "aal.")
MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
             "novembre", "décembre"]
SECTIONS = ("synthese", "rentabilite", "tresorerie", "clients", "transport", "depenses", "previsions", "fiabilite")

# Prévision de trésorerie : 13 semaines, 1 000 tirages à graine fixe, 300 000 tirages × pièces au plus
# (au-delà, le nombre de tirages baisse, 200 au minimum : temps de réponse maîtrisé).
WEEKS = 13
DRAWS = 1000
SEED = 7
MAX_SIMULATED = 300_000
# Retards (jours après l'échéance) supposés sans aucun historique de règlement.
DEFAULT_DELAYS = (0, 7, 15, 30)
# Historique propre au client à partir de trois factures réglées, sinon celui de tous les clients.
MIN_HISTORY = 3
LATE_BINS = ((None, 0, "À l'échéance ou avant"), (1, 15, "1 à 15 jours"), (16, 30, "16 à 30 jours"),
             (31, 60, "31 à 60 jours"), (61, 90, "61 à 90 jours"), (91, None, "Plus de 90 jours"))
# Rubriques de charges (deux premiers chiffres) des lignes sans catégorie de dépense.
RUBRICS = {"60": "Achats et fournitures", "61": "Transports", "62": "Services extérieurs",
           "63": "Autres services extérieurs", "64": "Impôts et taxes", "65": "Autres charges",
           "66": "Charges de personnel", "67": "Frais financiers", "68": "Dotations aux amortissements",
           "69": "Dotations aux provisions"}
OPEX_PREFIXES = ("60", "61", "62", "63", "64", "65", "66")
SEGMENTS = {"strategiques": "Stratégiques", "a_securiser": "À sécuriser", "a_developper": "À développer",
            "a_surveiller": "À surveiller"}
# Liens des constats vers un onglet : l'écran lit ?onglet= et l'ouvre (Analyse > Rentabilité, Finance >
# Activités et budget).
COST_STRUCTURE_LINK = "/analyse/rentabilite?onglet=structure"
BUDGET_LINK = "/finance/pilotage?onglet=budget"
GOOD_PAYER = 60
HEALTH_WEIGHTS = {"liquidite": 25, "rentabilite": 25, "solvabilite": 20, "recouvrement": 15, "exploitation": 15}
CHECK_WEIGHTS = {"analytic": 15, "bank_reconciled": 15, "attachments": 10, "late_entries": 10, "old_drafts": 10,
                 "suspense": 10, "partners_vat": 5, "unbilled_rotations": 10, "tiers_without_partner": 5,
                 "unmapped_accounts": 5, "rotations_fuel": 5}
QUALITY_CHECKS = {
    "synthese": tuple(CHECK_WEIGHTS),
    "rentabilite": ("analytic", "unmapped_accounts", "old_drafts"),
    "tresorerie": ("bank_reconciled", "suspense", "old_drafts"),
    "clients": ("tiers_without_partner", "partners_vat", "bank_reconciled"),
    "transport": ("rotations_fuel", "unbilled_rotations", "analytic"),
    "depenses": ("attachments", "analytic", "late_entries"),
    "previsions": ("unmapped_accounts", "late_entries", "old_drafts"),
    "fiabilite": tuple(CHECK_WEIGHTS),
}


# ─── Outils ───────────────────────────────────────────────────────────────


def _num(value, digits=0):
    """1 234,5 : nombre à la française."""
    if value is None:
        return "–"
    return f"{value:,.{digits}f}".replace(",", " ").replace(".", ",")


def _days(value):
    """Délai à une décimale, même règle que l'écran (eguitra_finance.formats.days) : « 56,5 jours »."""
    return days(value)


def _pct_of(part, whole):
    return part / whole * 100.0 if part is not None and whole else None


def _key(day):
    return day.strftime("%Y-%m")


def _month_end(day):
    return day.replace(day=1) + relativedelta(months=1, days=-1)


def _month_list(last_day, count):
    """Premiers jours des `count` mois qui finissent par celui de last_day."""
    first = last_day.replace(day=1) - relativedelta(months=count - 1)
    return [first + relativedelta(months=i) for i in range(count)]


def _months_between(start, end):
    months, month = [], start.replace(day=1)
    while month <= end:
        months.append(month)
        month += relativedelta(months=1)
    return months


def _month_label(day):
    return f"{MONTHS_FR[day.month - 1]} {day.year}"


def _statement(balances):
    """Rubriques et totaux SYSCOHADA du compte de résultat à partir de soldes par compte."""
    values, _used = _compute(balances, CR_LINES, lambda code: -1 if code.startswith("T") else 1)
    return _totals(values, CR_TOTALS)


def _status(value, previous, target, inverse):
    """good : cible (à défaut N-1) atteinte ; warn : à moins de 10 % ; bad : au-delà ; neutral sans repère."""
    if value is None:
        return "neutral"
    reference = target if target is not None else previous
    if reference is None:
        return "neutral"
    gap = (value - reference) * (-1 if inverse else 1)
    if gap >= 0:
        return "good"
    return "warn" if -gap <= 0.10 * (abs(reference) or 1.0) else "bad"


def _kpi(key, label, value, unit, *, previous=None, target=None, trend=None, definition="", inverse=False,
         status=None):
    return {
        "key": key, "label": label, "value": value, "unit": unit, "previous": previous, "target": target,
        "delta_pct": stats.pct_change(value, previous), "trend": trend or [],
        "status": status or _status(value, previous, target, inverse), "definition": definition, "inverse": inverse,
    }


def _metric(label, value, unit, reference=None, reference_label=None):
    return {"label": label, "value": value, "unit": unit, "reference": reference, "reference_label": reference_label}


def _step(key, label, value):
    return {"key": key, "label": label, "value": value, "kind": "plus" if value >= 0 else "minus"}


def _anomaly_scores(values):
    """Scores robustes ; si la MAD est nulle (majorité de valeurs identiques), score modifié sur l'écart
    absolu moyen (x - médiane) / (1,253314 × écart absolu moyen), recommandé par Iglewicz et Hoaglin."""
    scores = stats.robust_z(values)
    if values and stats.mad(values) == 0:
        center = stats.median(values)
        spread = stats.mean([abs(v - center) for v in values])
        scores = [(v - center) / (1.253314 * spread) if spread else 0.0 for v in values]
    return scores


def _confidence(n, full=24, floor=0.4, ceiling=0.95):
    """Confiance croissante avec le nombre d'observations (plancher et plafond)."""
    return max(floor, min(ceiling, floor + (ceiling - floor) * n / full))


def _normalize_ref(ref):
    return re.sub(r"[^0-9a-z]", "", (ref or "").lower())


class _Ctx:
    """Contexte d'un calcul : société, période, et mémoire des requêtes partagées entre les sections (la
    synthèse appelle toutes les sections sans refaire leurs requêtes communes)."""

    def __init__(self, company, period):
        self.company = company
        self.period = period
        self.date_from = period["date_from"]
        self.date_to = period["date_to"]
        self.prev_from = period["previous"]["date_from"]
        self.prev_to = period["previous"]["date_to"]
        self.days = (self.date_to - self.date_from).days + 1
        self.month_complete = self.date_to == _month_end(self.date_to)
        self.memo = {}
        self.notes = []

    def get(self, key, compute):
        if key not in self.memo:
            self.memo[key] = compute()
        return self.memo[key]


class EguitraAnalyticsGroupe(models.AbstractModel):
    _name = "eguitra.analytics.groupe"
    _description = "Analyses du groupe"

    # ─── Sections (API) ───────────────────────────────────────────────────

    @api.model
    def synthese(self, company, period):
        """5.1 Cockpit du dirigeant : indicateurs clés, santé, cascade du résultat, 24 mois, activités et
        les dix meilleurs constats de toutes les sections."""
        return self._run("synthese", company, period)

    @api.model
    def rentabilite(self, company, period):
        """5.2 D'où vient la marge : activités, pont d'EBE, structure de coûts, budget, chantiers et biens."""
        return self._run("rentabilite", company, period)

    @api.model
    def tresorerie(self, company, period):
        """5.3 Liquidité et prévision à 13 semaines."""
        return self._run("tresorerie", company, period)

    @api.model
    def clients(self, company, period):
        """5.4 Valeur et risque du portefeuille clients."""
        return self._run("clients", company, period)

    @api.model
    def transport(self, company, period):
        """5.5 Rentabilité de la flotte et des routes."""
        return self._run("transport", company, period)

    @api.model
    def depenses(self, company, period):
        """5.6 Dépenses, fournisseurs et contrôles."""
        return self._run("depenses", company, period)

    @api.model
    def previsions(self, company, period):
        """5.7 Atterrissage de l'exercice."""
        return self._run("previsions", company, period)

    @api.model
    def fiabilite(self, company, period):
        """5.8 Fiabilité des données."""
        return self._run("fiabilite", company, period)

    def _run(self, name, company, period):
        self.env.flush_all()
        ctx = _Ctx(self.env["res.company"].browse(company.id), period)
        blocks, items = getattr(self, f"_section_{name}")(ctx)
        result = dict(blocks)
        result["insights"] = rank(items, limit=10 if name == "synthese" else 6)
        result["quality"] = self._quality(ctx, name)
        return result

    # ─── Requêtes communes ────────────────────────────────────────────────

    def _rows(self, sql, params):
        self.env.cr.execute(sql, params)
        return self.env.cr.fetchall()

    def _metrics(self):
        return self.env["eguitra.finance.metrics"]

    def _names(self, model, ids):
        ids = [i for i in ids if i]
        return {r.id: r.display_name for r in self.env[model].with_context(active_test=False).browse(ids).exists()}

    def _thresholds(self, ctx):
        return ctx.get("thresholds", lambda: self._metrics().threshold_values(ctx.company))

    def _pl(self, ctx, start, end):
        """Compte de résultat SYSCOHADA de la période : rubriques et totaux {code: montant}."""
        def load():
            data = self.env["eguitra.syscohada"].income_statement(ctx.company, start, end)
            values = {line["code"]: line["amount"] for line in data["lines"]}
            values["_unmapped"] = len(data["unmapped_accounts"])
            return values
        return ctx.get(("pl", start, end), load)

    def _monthly_pl(self, ctx, count=24):
        """Compte de résultat de chacun des `count` mois finissant à la date d'arrêté (le dernier mois
        jusqu'à cette date), en une requête : {AAAA-MM: {rubrique: montant}}."""
        def load():
            months = _month_list(ctx.date_to, count)
            rows = self._rows(
                f"""SELECT to_char(date_trunc('month', aml.date), 'YYYY-MM'), {ACC_CODE}, SUM(aml.balance)
                      FROM account_move_line aml
                      JOIN account_account aa ON aa.id = aml.account_id
                     WHERE aml.parent_state = 'posted' AND aml.company_id = %(company)s
                       AND aml.date BETWEEN %(start)s AND %(end)s AND {ACC_CODE} ~ '^[678]'
                  GROUP BY 1, 2""",
                {"company": ctx.company.id, "start": months[0], "end": ctx.date_to},
            )
            balances = {}
            for month, code, amount in rows:
                if code:
                    balances.setdefault(month, {})[code] = float(amount)
            return {_key(m): _statement(balances.get(_key(m), {})) for m in months}
        return ctx.get(("monthly_pl", count), load)

    def _cash_months(self, ctx, count=24):
        """Trésorerie nette (classe 5) à chaque fin de mois ; le dernier mois, à la date d'arrêté."""
        def load():
            months = _month_list(ctx.date_to, count)
            [(opening,)] = self._rows(
                f"""SELECT COALESCE(SUM(aml.balance), 0) FROM account_move_line aml
                      JOIN account_account aa ON aa.id = aml.account_id
                     WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aml.date < %s
                       AND {ACC_CODE} LIKE '5%%'""",
                (ctx.company.id, months[0]),
            )
            moves = dict(self._rows(
                f"""SELECT to_char(date_trunc('month', aml.date), 'YYYY-MM'), SUM(aml.balance)
                      FROM account_move_line aml
                      JOIN account_account aa ON aa.id = aml.account_id
                     WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aml.date BETWEEN %s AND %s
                       AND {ACC_CODE} LIKE '5%%'
                  GROUP BY 1""",
                (ctx.company.id, months[0], ctx.date_to),
            ))
            balance, result = float(opening), {}
            for month in months:
                balance += float(moves.get(_key(month), 0.0))
                result[_key(month)] = balance
            return result
        return ctx.get(("cash_months", count), load)

    def _balances_at(self, ctx, day):
        """Créances clients, dettes fournisseurs (positives) et stocks à une date, soldes comptables."""
        def load():
            rows = self._rows(
                f"""SELECT CASE WHEN aa.account_type = 'asset_receivable' THEN 'rec'
                                WHEN aa.account_type = 'liability_payable' THEN 'pay' ELSE 'stock' END,
                           COALESCE(SUM(aml.balance), 0)
                      FROM account_move_line aml
                      JOIN account_account aa ON aa.id = aml.account_id
                     WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aml.date <= %s
                       AND (aa.account_type IN ('asset_receivable', 'liability_payable') OR {ACC_CODE} LIKE '3%%')
                  GROUP BY 1""",
                (ctx.company.id, day),
            )
            values = {bucket: float(amount) for bucket, amount in rows}
            return {"receivables": values.get("rec", 0.0), "payables": -values.get("pay", 0.0),
                    "stocks": values.get("stock", 0.0)}
        return ctx.get(("balances", day), load)

    def _wc(self, ctx, start, end):
        """Besoin en fonds de roulement et délais d'une période (définitions de working_capital), sur les
        soldes comptables à la date de fin : exacts pour une date passée, égaux à la balance âgée au jour."""
        def load():
            balances = self._balances_at(ctx, end)
            metrics = self._metrics()
            sales = metrics._invoiced_ttc(ctx.company, "sale", start, end)
            purchases = metrics._invoiced_ttc(ctx.company, "purchase", start, end)
            days = (end - start).days + 1
            rec, pay, stock = balances["receivables"], balances["payables"], balances["stocks"]
            dso = rec / sales * days if sales > 0 else None
            dpo = pay / purchases * days if purchases > 0 else None
            dio = stock / purchases * days if purchases > 0 else None
            bfr = rec + stock - pay
            return {"receivables": rec, "payables": pay, "stocks": stock, "sales_ttc": sales,
                    "purchases_ttc": purchases, "days": days, "dso": dso, "dpo": dpo, "dio": dio,
                    "cycle": dso + (dio or 0.0) - (dpo or 0.0) if dso is not None else None, "bfr": bfr,
                    "bfr_days": bfr / sales * days if sales > 0 else None}
        return ctx.get(("wc", start, end), load)

    def _position_months(self, ctx, count=12):
        """Cycle d'exploitation de chaque fin de mois : créances, dettes, stocks (soldes comptables) et délais
        sur les ventes et achats TTC des trois mois glissants qui finissent ce mois (90 jours environ)."""
        def load():
            months = _month_list(ctx.date_to, count)
            rows = self._rows(
                f"""SELECT CASE WHEN aml.date < %(start)s THEN '' ELSE to_char(date_trunc('month', aml.date), 'YYYY-MM') END,
                           CASE WHEN aa.account_type = 'asset_receivable' THEN 'rec'
                                WHEN aa.account_type = 'liability_payable' THEN 'pay' ELSE 'stock' END,
                           COALESCE(SUM(aml.balance), 0)
                      FROM account_move_line aml
                      JOIN account_account aa ON aa.id = aml.account_id
                     WHERE aml.parent_state = 'posted' AND aml.company_id = %(company)s AND aml.date <= %(end)s
                       AND (aa.account_type IN ('asset_receivable', 'liability_payable') OR {ACC_CODE} LIKE '3%%')
                  GROUP BY 1, 2""",
                {"company": ctx.company.id, "start": months[0], "end": ctx.date_to},
            )
            running = {"rec": 0.0, "pay": 0.0, "stock": 0.0}
            by_month = {}
            for month, bucket, amount in rows:
                if not month:
                    running[bucket] += float(amount)
                else:
                    by_month.setdefault(month, {})[bucket] = float(amount)
            docs = self._rows(
                """SELECT to_char(date_trunc('month', am.date), 'YYYY-MM'),
                          COALESCE(SUM(CASE am.move_type WHEN 'out_invoice' THEN ABS(am.amount_total_signed)
                                                         WHEN 'out_refund' THEN -ABS(am.amount_total_signed) ELSE 0 END), 0),
                          COALESCE(SUM(CASE am.move_type WHEN 'in_invoice' THEN ABS(am.amount_total_signed)
                                                         WHEN 'in_refund' THEN -ABS(am.amount_total_signed) ELSE 0 END), 0)
                     FROM account_move am
                    WHERE am.state = 'posted' AND am.company_id = %(company)s
                      AND am.move_type IN ('out_invoice', 'out_refund', 'in_invoice', 'in_refund')
                      AND am.date BETWEEN %(start)s AND %(end)s
                 GROUP BY 1""",
                {"company": ctx.company.id, "start": months[0] - relativedelta(months=2), "end": ctx.date_to},
            )
            sales = {m: float(s) for m, s, _p in docs}
            purchases = {m: float(p) for m, _s, p in docs}
            result = []
            for month in months:
                for bucket, amount in by_month.get(_key(month), {}).items():
                    running[bucket] += amount
                end = min(_month_end(month), ctx.date_to)
                window = [month - relativedelta(months=i) for i in (2, 1, 0)]
                days = (end - window[0]).days + 1
                s = sum(sales.get(_key(w), 0.0) for w in window)
                p = sum(purchases.get(_key(w), 0.0) for w in window)
                rec, pay, stock = running["rec"], -running["pay"], running["stock"]
                dso = rec / s * days if s > 0 else None
                dpo = pay / p * days if p > 0 else None
                dio = stock / p * days if p > 0 else None
                result.append({
                    "month": _key(month), "end": end, "receivables": rec, "payables": pay, "stocks": stock,
                    "sales_ttc": s, "purchases_ttc": p, "days": days, "dso": dso, "dpo": dpo, "dio": dio,
                    "cycle": dso + (dio or 0.0) - (dpo or 0.0) if dso is not None else None,
                    "bfr": rec + stock - pay, "bfr_days": (rec + stock - pay) / s * days if s > 0 else None,
                })
            return result
        return ctx.get(("positions", count), load)

    def _open_items(self, ctx, account_type):
        """Pièces ouvertes à la date d'arrêté (restes dus au jour du calcul, comme la balance âgée) : par
        pièce, tiers (société mère du contact), échéance et reste dû positif (à encaisser d'un client, à
        payer à un fournisseur). Les avances et règlements non lettrés d'un tiers s'imputent sur ses pièces
        les plus anciennes ; le reliquat est rendu dans `unapplied`."""
        def load():
            sign = 1.0 if account_type == "asset_receivable" else -1.0
            rows = self._rows(
                """SELECT COALESCE(rp.commercial_partner_id, aml.partner_id), aml.move_id, am.name, aml.date,
                          COALESCE(aml.date_maturity, aml.date), aml.amount_residual
                     FROM account_move_line aml
                     JOIN account_account aa ON aa.id = aml.account_id
                     JOIN account_move am ON am.id = aml.move_id
                LEFT JOIN res_partner rp ON rp.id = aml.partner_id
                    WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aa.account_type = %s
                      AND NOT aml.reconciled AND aml.date <= %s AND aml.amount_residual != 0""",
                (ctx.company.id, account_type, ctx.date_to),
            )
            by_partner = {}
            for partner, move, name, day, due, residual in rows:
                by_partner.setdefault(partner, []).append(
                    {"partner": partner, "move": move, "name": name, "date": day, "due": due,
                     "amount": sign * float(residual)})
            items, unapplied = [], {}
            for partner, lines in by_partner.items():
                available = -sum(line["amount"] for line in lines if line["amount"] < 0)
                for line in sorted((x for x in lines if x["amount"] > 0), key=lambda x: (x["due"], x["move"])):
                    used = min(available, line["amount"])
                    available -= used
                    line["amount"] -= used
                    if line["amount"] > 0.5:
                        items.append(line)
                if available > 0.5:
                    unapplied[partner] = available
            return {"items": items, "unapplied": unapplied}
        return ctx.get(("open", account_type), load)

    def _payment_history(self, ctx):
        """Règlements des factures clients par banque ou caisse sur les 24 mois précédant la date d'arrêté
        (lettrages) : par facture, date de règlement moyenne pondérée par les montants réglés, retard (jours
        après l'échéance, négatif si payé en avance) et délai (jours après la date de la facture). Les avoirs
        et les retenues de garantie, qui soldent une facture sans encaissement, n'en font pas partie."""
        def load():
            rows = self._rows(
                """SELECT COALESCE(rp.commercial_partner_id, inv.partner_id), inv.move_id, inv.date,
                          COALESCE(inv.date_maturity, inv.date), pay.date, apr.amount
                     FROM account_partial_reconcile apr
                     JOIN account_move_line inv ON inv.id = apr.debit_move_id
                     JOIN account_move_line pay ON pay.id = apr.credit_move_id
                     JOIN account_account aa ON aa.id = inv.account_id
                     JOIN account_move im ON im.id = inv.move_id
                     JOIN account_journal pj ON pj.id = pay.journal_id
                LEFT JOIN res_partner rp ON rp.id = inv.partner_id
                    WHERE inv.company_id = %(company)s AND inv.parent_state = 'posted' AND pay.parent_state = 'posted'
                      AND aa.account_type = 'asset_receivable' AND im.move_type = 'out_invoice'
                      AND pj.type IN ('bank', 'cash') AND pay.date > %(start)s AND pay.date <= %(end)s""",
                {"company": ctx.company.id, "start": ctx.date_to - relativedelta(months=24), "end": ctx.date_to},
            )
            invoices = {}
            for partner, move, day, due, paid, amount in rows:
                record = invoices.setdefault(move, {"partner": partner, "move": move, "date": day, "due": due,
                                                    "amount": 0.0, "weighted": 0.0})
                record["amount"] += float(amount)
                record["weighted"] += float(amount) * paid.toordinal()
            history = []
            for record in invoices.values():
                if record["amount"] <= 0:
                    continue
                paid = record["weighted"] / record["amount"]
                record.update(paid=date.fromordinal(round(paid)), paid_ordinal=paid,
                              days_late=paid - record["due"].toordinal(), days_to_pay=paid - record["date"].toordinal())
                history.append(record)
            return sorted(history, key=lambda r: r["paid_ordinal"])
        return ctx.get("history", load)

    def _client_revenue(self, ctx, start, end):
        """Chiffre d'affaires (comptes 70) par client, société mère des contacts ; clé None : ventes sans tiers."""
        def load():
            rows = self._rows(
                f"""SELECT COALESCE(rp.commercial_partner_id, aml.partner_id), -SUM(aml.balance)
                      FROM account_move_line aml
                      JOIN account_account aa ON aa.id = aml.account_id
                 LEFT JOIN res_partner rp ON rp.id = aml.partner_id
                     WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aml.date BETWEEN %s AND %s
                       AND {ACC_CODE} LIKE '70%%'
                  GROUP BY 1""",
                (ctx.company.id, start, end),
            )
            return {partner: float(amount) for partner, amount in rows}
        return ctx.get(("client_revenue", start, end), load)

    def _activities(self, ctx):
        """Axe Activité : comptes de la société (ou communs), colonne analytique, activité du transport."""
        def load():
            plan = self.env.ref(ACTIVITY_PLAN, raise_if_not_found=False)
            if not plan:
                return None
            accounts = self.env["account.analytic.account"].with_context(active_test=False).search(
                [("plan_id", "child_of", plan.id), ("company_id", "in", [False, ctx.company.id])])
            transport = ctx.company.transport_activity_id if "transport_activity_id" in ctx.company._fields else None
            if not transport:
                transport = accounts.filtered(lambda a: a.name == "Transport pétrolier")[:1]
            return {"plan": plan, "column": plan._column_name(), "ids": set(accounts.ids),
                    "names": {a.id: a.name for a in accounts}, "transport": transport.id if transport else None}
        return ctx.get("activities", load)

    def _activity_rows(self, ctx, start, end):
        """Produits (classe 7), charges (classe 6) et marge par activité (by_analytic_plan) ; dict par compte."""
        def load():
            acts = self._activities(ctx)
            if not acts:
                return {}
            rows = self._metrics().by_analytic_plan(ctx.company, acts["plan"], start, end)
            return {r["analytic_account_id"]: r for r in rows}
        return ctx.get(("activity_rows", start, end), load)

    def _transport(self, ctx):
        """Rentabilité complète du transport sur la période (eguitra.transport.analysis.report) et indicateurs
        de la finance (transport_kpis) ; None si la société n'a jamais validé de rotation."""
        def load():
            if "eguitra.transport.rotation" not in self.env:
                return None
            Rotation = self.env["eguitra.transport.rotation"]
            if not Rotation.search_count([("company_id", "=", ctx.company.id), ("state", "in", ("done", "invoiced"))],
                                         limit=1):
                return None
            report = self.env["eguitra.transport.analysis"].report(ctx.company, ctx.date_from, ctx.date_to, "vehicle")
            kpis = self._metrics().transport_kpis(ctx.company, ctx.date_from, ctx.date_to)
            return {"report": report, "kpis": kpis}
        return ctx.get("transport", load)

    def _transport_margin(self, ctx, start, end):
        """Marge directe du transport (%) : marge des rotations validées / montant facturable."""
        def load():
            if "eguitra.transport.rotation" not in self.env:
                return None
            rows = self.env["eguitra.transport.rotation"].profitability(ctx.company, start, end, "vehicle")
            revenue = sum(r["revenue"] or 0.0 for r in rows)
            return sum(r["margin"] or 0.0 for r in rows) / revenue * 100 if revenue else None
        return ctx.get(("transport_margin", start, end), load)

    def _rotations(self, ctx, start, end):
        """Rotations validées ou facturées chargées dans l'intervalle, en dictionnaires (référentiels en paires
        (id, nom), False si absent)."""
        def ref(record):
            return (record.id, record.display_name) if record else False

        def load():
            rotations = self.env["eguitra.transport.rotation"].search(
                [("company_id", "=", ctx.company.id), ("state", "in", ("done", "invoiced")),
                 ("date_loading", ">=", start), ("date_loading", "<=", end)], order="date_loading, id")
            numbers = ("volume_loaded", "volume_delivered", "revenue", "margin", "distance_km", "fuel_liters", "fuel_cost",
                       "duration_days", "total_cost", "shortage_net_cost", "taxes_rebilled", "shortage", "shortage_excess",
                       "shortage_value")
            return [dict({field: r[field] or 0.0 for field in numbers}, id=r.id, name=r.name, date_loading=r.date_loading,
                         vehicle_id=ref(r.vehicle_id), route_id=ref(r.route_id), driver_id=ref(r.driver_id),
                         partner_id=ref(r.partner_id), product_id=ref(r.product_id)) for r in rotations]
        return ctx.get(("rotations", start, end), load)

    def _budget(self, ctx):
        """Budget de l'exercice couvrant la date d'arrêté et ses lignes budgétaires (Activités et budget)."""
        def load():
            if "mis.budget.by.account" not in self.env:
                return None
            budget = self.env["mis.budget.by.account"].search([
                ("company_id", "=", ctx.company.id), ("state", "!=", "cancelled"),
                ("date_from", "<=", ctx.date_to), ("date_to", ">=", ctx.date_to),
            ], order="date_from desc, id desc", limit=1)
            if not budget:
                return None
            lines = budget.eguitra_line_ids if "eguitra_line_ids" in budget._fields else self.env["eguitra.budget.line"]
            return {"record": budget, "lines": lines}
        return ctx.get("budget", load)

    @staticmethod
    def _line_scope(line, scope):
        """Ligne budgétaire retenue pour un agrégat : revenue (produits des comptes 70), ebe (produits
        d'exploitation moins charges des comptes 60 à 66, solde résiduel compris)."""
        prefixes = line.prefixes()
        if line.nature == "income":
            if scope == "revenue":
                return 1 if prefixes and all(p.startswith("70") for p in prefixes) else 0
            return 1 if prefixes and all(p.startswith(("70", "71", "72", "73", "75", "781")) for p in prefixes) else 0
        if line.nature == "expense" and scope == "ebe":
            return -1 if line.residual or (prefixes and all(p.startswith(OPEX_PREFIXES) for p in prefixes)) else 0
        return 0

    def _budget_amount(self, ctx, scope, start, end):
        """Budget d'un agrégat sur une période : montants mensuels des lignes, mois entamés au prorata des
        jours ; None sans budget à lignes."""
        budget = self._budget(ctx)
        if not budget or not budget["lines"]:
            return None
        record = budget["record"]
        total, found = 0.0, False
        for month in _months_between(start, end):
            if month < record.date_from.replace(day=1) or month > record.date_to:
                continue
            first, last = max(month, start), min(_month_end(month), end)
            share = ((last - first).days + 1) / ((_month_end(month) - month).days + 1)
            for line in budget["lines"]:
                sign = self._line_scope(line, scope)
                if sign:
                    found = True
                    total += sign * (line[f"amount_{month.month:02d}"] or 0.0) * share
        return total if found else None

    # ─── 5.1 Synthèse ─────────────────────────────────────────────────────

    def _section_synthese(self, ctx):
        c = ctx.company
        metrics = self._metrics()
        th = self._thresholds(ctx)
        pl, prev = self._pl(ctx, ctx.date_from, ctx.date_to), self._pl(ctx, ctx.prev_from, ctx.prev_to)
        monthly = self._monthly_pl(ctx, 24)
        keys24 = list(monthly)
        last12 = keys24[-12:]
        cash_months = self._cash_months(ctx, 24)
        positions = self._position_months(ctx, 12)
        wc, wc_prev = self._wc(ctx, ctx.date_from, ctx.date_to), self._wc(ctx, ctx.prev_from, ctx.prev_to)
        xb, xd, xi = pl["XB"], pl["XD"], pl["XI"]
        cash = cash_months[keys24[-1]]
        cash_prev = metrics.cash(c, ctx.prev_to)
        dscr = metrics.dscr(c, ctx.date_to)["dscr"]
        dscr_prev = metrics.dscr(c, ctx.prev_to)["dscr"]
        transport_margin = self._transport_margin(ctx, ctx.date_from, ctx.date_to)
        transport_prev = self._transport_margin(ctx, ctx.prev_from, ctx.prev_to)
        transport_trend = []
        if transport_margin is not None or transport_prev is not None:
            start12 = _month_list(ctx.date_to, 12)[0]
            by_month = {r["key"]: r["margin_rate"] for r in
                        self.env["eguitra.transport.rotation"].profitability(c, start12, ctx.date_to, "month")}
            transport_trend = [by_month.get(k) for k in last12]
        kpis = [
            _kpi("revenue", "Chiffre d'affaires", xb, "gnf", previous=prev["XB"],
                 target=self._budget_amount(ctx, "revenue", ctx.date_from, ctx.date_to),
                 trend=[monthly[k]["XB"] for k in last12],
                 definition="Ventes de marchandises, de produits et de services hors taxes (rubrique XB des états "
                            "SYSCOHADA) ; cible : budget des lignes de produits 70 sur la période."),
            _kpi("ebe", "Excédent brut d'exploitation", xd, "gnf", previous=prev["XD"],
                 target=self._budget_amount(ctx, "ebe", ctx.date_from, ctx.date_to),
                 trend=[monthly[k]["XD"] for k in last12], status="bad" if xd < 0 else None,
                 definition="Valeur ajoutée moins charges de personnel (rubrique XD) : ce que l'exploitation dégage "
                            "avant amortissements, frais financiers et impôt."),
            _kpi("ebe_margin", "Taux d'EBE", _pct_of(xd, xb), "pct", previous=_pct_of(prev["XD"], prev["XB"]),
                 trend=[_pct_of(monthly[k]["XD"], monthly[k]["XB"]) for k in last12],
                 definition="EBE / chiffre d'affaires."),
            _kpi("net_result", "Résultat net", xi, "gnf", previous=prev["XI"], trend=[monthly[k]["XI"] for k in last12],
                 status="bad" if xi < 0 else None,
                 definition="Produits moins charges de toutes natures (rubrique XI), après impôt sur le résultat."),
            _kpi("cash", "Trésorerie nette", cash, "gnf", previous=cash_prev, target=th["cash_min"],
                 trend=[cash_months[k] for k in last12], status="bad" if cash < 0 else None,
                 definition="Soldes de la classe 5 (banques, caisses, moins crédits de trésorerie) à la date "
                            "d'arrêté ; cible : trésorerie minimale fixée par la direction."),
            _kpi("bfr_days", "BFR en jours de chiffre d'affaires", wc["bfr_days"], "days", previous=wc_prev["bfr_days"],
                 trend=[p["bfr_days"] for p in positions], inverse=True,
                 definition="(Créances clients + stocks - dettes fournisseurs) / ventes TTC de la période × jours ; "
                            "tendance sur les ventes des trois mois glissants."),
            _kpi("dso", "Délai moyen de recouvrement (DSO)", wc["dso"], "days", previous=wc_prev["dso"],
                 target=th["dso_target_days"], trend=[p["dso"] for p in positions], inverse=True,
                 definition="Créances clients TTC / ventes TTC de la période × nombre de jours ; cible fixée par la "
                            "direction."),
            _kpi("transport_margin", "Marge transport", transport_margin, "pct", previous=transport_prev,
                 target=th["transport_margin_min"], trend=transport_trend,
                 definition="Marge directe des rotations validées / montant facturable (prix du transport) ; cible : "
                            "marge transport minimale."),
            _kpi("dscr", "Couverture du service de la dette (DSCR)", dscr, "ratio", previous=dscr_prev,
                 target=th["dscr_min"], trend=self._dscr_trend(ctx, monthly),
                 definition="EBE des douze derniers mois / service de la dette (capital et intérêts) des douze "
                            "derniers mois, à défaut des douze prochains."),
        ]
        health = self._health(ctx, pl, wc, th, cash, transport_margin)
        waterfall = self._waterfall(pl)
        blocks = {
            "kpis": kpis,
            "health": health,
            "waterfall": waterfall,
            "monthly": {"months": keys24, "series": [
                {"key": "revenue", "label": "Chiffre d'affaires", "unit": "gnf", "values": [monthly[k]["XB"] for k in keys24]},
                {"key": "ebe", "label": "Excédent brut d'exploitation", "unit": "gnf",
                 "values": [monthly[k]["XD"] for k in keys24]},
                {"key": "cash", "label": "Trésorerie fin de mois", "unit": "gnf", "values": [cash_months[k] for k in keys24]},
            ]},
            "activities": self._activity_table(ctx),
        }
        items = self._health_insights(health)
        for name in SECTIONS[1:]:
            try:
                with self.env.cr.savepoint():
                    _blocks, found = getattr(self, f"_section_{name}")(ctx)
                items += found
            except Exception:
                _logger.exception("Analyse du groupe : section %s indisponible pour la synthèse", name)
                ctx.notes.append(f"Section « {name} » indisponible : ses constats ne figurent pas dans la synthèse.")
        return blocks, items

    def _dscr_trend(self, ctx, monthly):
        """DSCR à chaque fin des douze derniers mois : EBE des douze mois glissants / service de la dette des
        douze mois écoulés (à défaut, des douze suivants)."""
        lines = self.env["eguitra.loan.line"].search([
            ("loan_id.company_id", "=", ctx.company.id), ("loan_id.state", "in", ("active", "closed"))])
        if not lines:
            return [None] * 12
        dues = [(line.due_date, line.total) for line in lines]
        keys = list(monthly)
        trend = []
        for i in range(len(keys) - 12, len(keys)):
            end = min(_month_end(date.fromisoformat(keys[i] + "-01")), ctx.date_to)
            ebe = sum(monthly[k]["XD"] for k in keys[max(0, i - 11):i + 1])
            last = sum(t for d, t in dues if end - relativedelta(years=1) < d <= end)
            service = last or sum(t for d, t in dues if end < d <= end + relativedelta(years=1))
            trend.append(ebe / service if service else None)
        return trend

    def _disbursements(self, ctx, months=6):
        """Décaissements moyens mensuels des banques et caisses sur les six derniers mois (mois mouvementés),
        hors à-nouveaux et virements internes (compte 585) : la définition des flux mensuels de la finance."""
        def load():
            accounts = self._metrics()._treasury_accounts(ctx.company)
            if not accounts:
                return None
            rows = self._rows(
                """SELECT to_char(date_trunc('month', aml.date), 'YYYY-MM'), COALESCE(SUM(aml.credit), 0)
                     FROM account_move_line aml
                     JOIN account_journal aj ON aj.id = aml.journal_id
                    WHERE aml.parent_state = 'posted' AND aml.company_id = %(company)s
                      AND aml.account_id = ANY(%(accounts)s) AND aml.date BETWEEN %(start)s AND %(end)s
                      AND aj.code != %(journal)s
                      AND NOT EXISTS (
                          SELECT 1 FROM account_move_line t JOIN account_account ta ON ta.id = t.account_id
                           WHERE t.move_id = aml.move_id
                             AND COALESCE(ta.code_store->>(t.company_id::text), '') LIKE '585%%')
                 GROUP BY 1""",
                {"company": ctx.company.id, "accounts": accounts.ids, "journal": OPENING_JOURNAL,
                 "start": ctx.date_to - relativedelta(months=months) + timedelta(days=1), "end": ctx.date_to},
            )
            paid = [float(v) for _m, v in rows if float(v) > 0]
            return sum(paid) / len(paid) if paid else None
        return ctx.get("disbursements", load)

    def _health(self, ctx, pl, wc, th, cash, transport_margin):
        """Score de santé 0-100 : moyenne pondérée de cinq axes, chacun noté entre deux bornes documentées
        (interpolation linéaire, stats.linear_score) ; un axe sans donnée est écarté et les poids des autres
        sont rapportés à 100."""
        burn = self._disbursements(ctx)
        coverage = cash / burn if burn else None
        ebe_rate = _pct_of(pl["XD"], pl["XB"])
        debt = self._metrics().debt_position(ctx.company, ctx.date_to)
        net_debt, ebe12 = debt["net_debt"], debt["ebe_12m"]
        if net_debt <= 0:
            leverage, leverage_score = 0.0, 100.0
        elif ebe12 > 0:
            leverage = net_debt / ebe12
            leverage_score = stats.linear_score(leverage, 4, 1)
        else:
            leverage, leverage_score = None, 0.0
        target = th["dso_target_days"] or 60.0
        dso = wc["dso"]
        if transport_margin is not None:
            floor = th["transport_margin_min"] or 30.0
            exploitation = {
                "score": stats.linear_score(transport_margin, 0, floor), "label": "Exploitation", "value": transport_margin,
                "unit": "pct", "comment": f"Marge directe du transport de {pct(transport_margin)} (0 % = 0, "
                                          f"{_num(floor)} % et plus = 100).",
            }
        else:
            operating = _pct_of(pl["XE"], pl["XB"])
            exploitation = {
                "score": stats.linear_score(operating, 0, 15), "label": "Exploitation", "value": operating, "unit": "pct",
                "comment": f"Marge d'exploitation de {pct(operating)} (0 % = 0, 15 % et plus = 100).",
            }
        axes = {
            "liquidite": {
                "score": stats.linear_score(coverage, 0, 3), "label": "Liquidité", "value": coverage, "unit": "ratio",
                "comment": (f"La trésorerie couvre {_num(coverage, 1)} mois de décaissements moyens ({gnf(burn)} par "
                            "mois) ; 0 mois = 0, 3 mois et plus = 100.") if coverage is not None
                else "Aucun décaissement de banque ou de caisse sur six mois.",
            },
            "rentabilite": {
                "score": stats.linear_score(ebe_rate, 0, 25), "label": "Rentabilité", "value": ebe_rate, "unit": "pct",
                "comment": f"Taux d'EBE de {pct(ebe_rate)} (0 % = 0, 25 % et plus = 100).",
            },
            "solvabilite": {
                "score": leverage_score, "label": "Solvabilité", "value": leverage, "unit": "ratio",
                "comment": ("Pas de dette financière nette." if net_debt <= 0 else
                            f"Dette financière nette de {gnf(net_debt)}, soit {_num(leverage, 1)} année(s) d'EBE "
                            "(4 ans et plus = 0, 1 an et moins = 100)." if leverage is not None else
                            f"Dette financière nette de {gnf(net_debt)} pour un EBE nul ou négatif sur douze mois."),
            },
            "recouvrement": {
                "score": stats.linear_score(dso, 2 * target, target), "label": "Recouvrement", "value": dso,
                "unit": "days",
                "comment": (f"DSO de {_days(dso)} pour une cible de {_days(target)} (cible et moins = 100, double de la "
                            "cible = 0).") if dso is not None else "Aucune vente TTC sur la période.",
            },
            "exploitation": exploitation,
        }
        weighted = [(HEALTH_WEIGHTS[k], a["score"]) for k, a in axes.items() if a["score"] is not None]
        for key, axis in axes.items():
            axis["weight"] = HEALTH_WEIGHTS[key]
            if axis["score"] is not None:
                axis["score"] = round(axis["score"])
        score = round(sum(w * s for w, s in weighted) / sum(w for w, _s in weighted)) if weighted else None
        return {"score": score, "axes": axes,
                "method": "Moyenne pondérée : liquidité 25 %, rentabilité 25 %, solvabilité 20 %, recouvrement 15 %, "
                          "exploitation 15 % ; chaque ratio noté entre deux bornes documentées."}

    def _health_insights(self, health):
        if health["score"] is None:
            return []
        weak = sorted((a for a in health["axes"].values() if a["score"] is not None), key=lambda a: a["score"])
        names = ", ".join(a["label"].lower() for a in weak[:2])
        metric = _metric("Score de santé", health["score"], "score", 75, "Repère de solidité")
        if health["score"] < 50:
            return [insight("synthese.sante_fragile", "synthese", "high", "La santé financière est fragile",
                            f"Score de santé de {health['score']} sur 100 ; axes les plus faibles : {names}. "
                            + " ".join(a["comment"] for a in weak[:2]),
                            metric=metric, confidence=0.75, method=health["method"],
                            action="Traiter en priorité les deux axes les plus faibles (plan de trésorerie et de "
                                   "recouvrement, revue de la structure de coûts).", link="/analyse")]
        if health["score"] >= 75:
            return [insight("synthese.sante_solide", "synthese", "positive", "La santé financière est solide",
                            f"Score de santé de {health['score']} sur 100 ; point de vigilance : {weak[0]['label'].lower()} "
                            f"({weak[0]['score']} sur 100).", metric=metric, confidence=0.75, method=health["method"],
                            link="/analyse")]
        return []

    @staticmethod
    def _waterfall(pl):
        """Du chiffre d'affaires au résultat net : chaque étape porte sa contribution signée (négative pour
        une charge) ; les totaux sont les rubriques XB, XD et XI, et la somme des étapes les relie exactement."""
        xb, xd, xi = pl["XB"], pl["XD"], pl["XI"]
        purchases = -(pl["RA"] + pl["RB"] + pl["RC"] + pl["RD"] + pl["RE"] + pl["RF"])
        external = -(pl["RG"] + pl["RH"])
        taxes = -pl["RI"]
        personnel = -pl["RK"]
        others = xd - (xb + purchases + external + taxes + personnel)
        depreciation = pl["XE"] - xd
        financial = pl["XF"]
        tax = -pl["RS"]
        exceptional = xi - pl["XE"] - financial - tax
        return [
            {"key": "revenue", "label": "Chiffre d'affaires", "value": xb, "kind": "total"},
            _step("purchases", "Achats consommés", purchases),
            _step("external", "Transports et services extérieurs", external),
            _step("taxes", "Impôts et taxes", taxes),
            _step("personnel", "Charges de personnel", personnel),
            _step("other", "Autres produits et charges d'exploitation", others),
            {"key": "ebe", "label": "Excédent brut d'exploitation", "value": xd, "kind": "total"},
            _step("depreciation", "Dotations nettes des reprises", depreciation),
            _step("financial", "Résultat financier", financial),
            _step("exceptional", "Hors activités ordinaires et participation", exceptional),
            _step("tax", "Impôt sur le résultat", tax),
            {"key": "net_result", "label": "Résultat net", "value": xi, "kind": "total"},
        ]

    def _activity_table(self, ctx):
        """Par activité : produits (classe 7), marge, part des produits, variation sur N-1 ; plus la ligne
        « Non affecté » (produits et charges sans activité analytique)."""
        current = self._activity_rows(ctx, ctx.date_from, ctx.date_to)
        previous = self._activity_rows(ctx, ctx.prev_from, ctx.prev_to)
        metrics = self._metrics()
        income = -metrics._sum_balance(ctx.company, ["7"], ctx.date_from, ctx.date_to)
        expense = metrics._sum_balance(ctx.company, ["6"], ctx.date_from, ctx.date_to)
        rows = []
        for account_id, row in current.items():
            before = previous.get(account_id)
            # Sans aucune charge imputée, la « marge » vaudrait le chiffre d'affaires (100 %) : elle n'est
            # pas mesurable tant que les achats ne portent pas l'activité.
            costed = abs(row["expense"]) > 0.5 or abs(row["income"]) <= 0.5
            rows.append({
                "id": account_id, "name": row["name"], "revenue": row["income"], "expense": row["expense"],
                "margin": row["margin"] if costed else None, "margin_rate": row["margin_rate"] if costed else None,
                "costs_imputed": costed, "share_pct": _pct_of(row["income"], income),
                "revenue_previous": before["income"] if before else 0.0,
                "growth_pct": stats.pct_change(row["income"], before["income"] if before else None),
            })
        assigned_income = sum(r["income"] for r in current.values())
        assigned_expense = sum(r["expense"] for r in current.values())
        rest_income, rest_expense = income - assigned_income, expense - assigned_expense
        if abs(rest_income) > 0.5 or abs(rest_expense) > 0.5:
            rows.append({"id": None, "name": "Non affecté", "revenue": rest_income, "expense": rest_expense,
                         "margin": rest_income - rest_expense, "margin_rate": _pct_of(rest_income - rest_expense, rest_income),
                         "share_pct": _pct_of(rest_income, income), "revenue_previous": None, "growth_pct": None})
        return sorted(rows, key=lambda r: (r["id"] is None, -(r["revenue"] or 0.0)))

    # ─── 5.2 Rentabilité ──────────────────────────────────────────────────

    def _section_rentabilite(self, ctx):
        bridge, effects = self._ebe_bridge(ctx)
        cost = self._cost_structure(ctx)
        budget = self._budget_variance(ctx)
        chantiers = self._chantiers(ctx)
        immobilier = self._immobilier(ctx)
        blocks = {
            "by_activity": self._activity_series(ctx),
            "bridge": bridge,
            "transport_effects": effects,
            "cost_structure": cost,
            "budget_variance": budget,
            "metiers": {"chantiers": chantiers, "immobilier": immobilier},
        }
        items = []
        items += self._bridge_insights(ctx, bridge)
        items += self._activity_insights(ctx)
        items += self._cost_insights(cost)
        items += self._budget_insights(budget)
        items += self._chantier_insights(chantiers)
        items += self._immobilier_insights(immobilier)
        return blocks, items

    def _activity_series(self, ctx):
        """Produits (classe 7) et marge mensuels des douze derniers mois par activité (lignes analytiques)."""
        months = _month_list(ctx.date_to, 12)
        keys = [_key(m) for m in months]
        acts = self._activities(ctx)
        if not acts:
            return {"months": keys, "series": [], "totals": []}
        column = acts["column"]
        rows = self._rows(
            f"""SELECT to_char(date_trunc('month', aal.date), 'YYYY-MM'), aal.{column},
                       COALESCE(SUM(CASE WHEN {AAL_CODE} LIKE '7%%' THEN aal.amount END), 0),
                       COALESCE(SUM(CASE WHEN {AAL_CODE} LIKE '6%%' THEN -aal.amount END), 0)
                  FROM account_analytic_line aal
                  JOIN account_account aa ON aa.id = aal.general_account_id
                 WHERE aal.company_id = %(company)s AND aal.date BETWEEN %(start)s AND %(end)s
                   AND aal.{column} IS NOT NULL
              GROUP BY 1, 2""",
            {"company": ctx.company.id, "start": months[0], "end": ctx.date_to},
        )
        data = {}
        for month, account_id, income, expense in rows:
            entry = data.setdefault(account_id, {"income": dict.fromkeys(keys, 0.0), "margin": dict.fromkeys(keys, 0.0)})
            entry["income"][month] = float(income)
            entry["margin"][month] = float(income) - float(expense)
        names = self._names("account.analytic.account", list(data))
        totals = sorted(({"activity_id": a, "name": names.get(a, "?"), "revenue": sum(d["income"].values()),
                          "margin": sum(d["margin"].values()),
                          "margin_rate": _pct_of(sum(d["margin"].values()), sum(d["income"].values()))}
                         for a, d in data.items()), key=lambda r: -r["revenue"])
        series = []
        for total in totals:
            entry = data[total["activity_id"]]
            series.append({"key": f"revenue.{total['activity_id']}", "label": f"{total['name']} : produits",
                           "unit": "gnf", "activity_id": total["activity_id"], "measure": "revenue",
                           "values": [entry["income"][k] for k in keys]})
            series.append({"key": f"margin.{total['activity_id']}", "label": f"{total['name']} : marge", "unit": "gnf",
                           "activity_id": total["activity_id"], "measure": "margin",
                           "values": [entry["margin"][k] for k in keys]})
        return {"months": keys, "series": series, "totals": totals}

    def _transport_effects(self, ctx):
        """Variation du chiffre d'affaires des rotations entre N-1 et N décomposée en trois effets :
        volume = Δ m³ × tarif moyen N-1 ; prix = Σ par route présente les deux années (Δ tarif moyen de la
        route × m³ N de la route) ; mix = reste (déplacement des volumes entre routes de tarifs différents,
        routes nouvelles ou abandonnées)."""
        if "eguitra.transport.rotation" not in self.env:
            return None
        Rotation = self.env["eguitra.transport.rotation"]
        current = {r["key"]: r for r in Rotation.profitability(ctx.company, ctx.date_from, ctx.date_to, "route")}
        previous = {r["key"]: r for r in Rotation.profitability(ctx.company, ctx.prev_from, ctx.prev_to, "route")}
        if not current and not previous:
            return None
        v1, r1 = sum(r["volume"] or 0.0 for r in current.values()), sum(r["revenue"] or 0.0 for r in current.values())
        v0, r0 = sum(r["volume"] or 0.0 for r in previous.values()), sum(r["revenue"] or 0.0 for r in previous.values())
        p0 = r0 / v0 if v0 else 0.0
        volume = (v1 - v0) * p0
        price = 0.0
        for key, row in current.items():
            old = previous.get(key)
            if old and row["volume"] and old["volume"]:
                price += (row["revenue"] / row["volume"] - old["revenue"] / old["volume"]) * row["volume"]
        delta = r1 - r0
        return {
            "volume": volume, "price": price, "mix": delta - volume - price, "revenue_delta": delta,
            "volume_m3": v1, "volume_m3_previous": v0, "rate": r1 / v1 if v1 else None, "rate_previous": p0 or None,
            "margin_delta": sum(r["margin"] or 0.0 for r in current.values()) - sum(r["margin"] or 0.0 for r in previous.values()),
        }

    def _ebe_bridge(self, ctx):
        """Pont d'EBE N-1 → N : variation de la marge analytique de chaque activité ; celle du transport
        décomposée en effets volume, prix, mix (chiffre d'affaires des rotations) et coûts ; le reste (charges
        et produits sans activité, éléments analytiques hors EBE : dotations, frais financiers) ferme le pont."""
        pl, prev = self._pl(ctx, ctx.date_from, ctx.date_to), self._pl(ctx, ctx.prev_from, ctx.prev_to)
        current = self._activity_rows(ctx, ctx.date_from, ctx.date_to)
        previous = self._activity_rows(ctx, ctx.prev_from, ctx.prev_to)
        acts = self._activities(ctx) or {}
        transport_id = acts.get("transport")
        effects = self._transport_effects(ctx)
        steps = [{"key": "ebe_previous", "label": "EBE N-1", "value": prev["XD"], "kind": "total"}]

        def margin(rows, account_id):
            row = rows.get(account_id)
            return row["margin"] if row else 0.0

        explained = 0.0
        transport_done = False
        ids = sorted(set(current) | set(previous),
                     key=lambda a: -abs(margin(current, a) - margin(previous, a)))
        for account_id in ids:
            delta = margin(current, account_id) - margin(previous, account_id)
            if account_id == transport_id and effects:
                transport_done = True
                steps += self._transport_steps(effects, delta)
            else:
                name = (current.get(account_id) or previous.get(account_id))["name"]
                steps.append(_step(f"activity.{account_id}", name, delta))
            explained += delta
        if effects and not transport_done and (effects["revenue_delta"] or effects["margin_delta"]):
            steps += self._transport_steps(effects, effects["margin_delta"])
            explained += effects["margin_delta"]
        steps.append(_step("other", "Hors activités et éléments hors EBE", (pl["XD"] - prev["XD"]) - explained))
        steps.append({"key": "ebe", "label": "EBE N", "value": pl["XD"], "kind": "total"})
        return steps, effects

    @staticmethod
    def _transport_steps(effects, margin_delta):
        return [
            _step("transport.volume", "Transport : effet volume", effects["volume"]),
            _step("transport.price", "Transport : effet prix", effects["price"]),
            _step("transport.mix", "Transport : effet mix des routes", effects["mix"]),
            _step("transport.costs", "Transport : coûts et autres écarts", margin_delta - effects["revenue_delta"]),
        ]

    def _cost_structure(self, ctx):
        """Charges d'exploitation mensuelles (CA - résultat d'exploitation : achats, services, personnel,
        dotations, nets des autres produits) régressées sur le CA mensuel, mois complets des 24 derniers mois
        ayant du CA (moindres carrés ; mois dont le résidu a un score robuste au-delà de 3,5 écartés une fois
        si six mois au moins restent). Charges fixes = ordonnée, part variable = pente ; point mort mensuel =
        fixes / (1 - part variable) ; marge de sécurité = (CA moyen des 12 derniers mois retenus - point mort) /
        CA moyen ; levier opérationnel = marge sur coûts variables / résultat d'exploitation au CA moyen."""
        monthly = self._monthly_pl(ctx, 24)
        keys = list(monthly) if ctx.month_complete else list(monthly)[:-1]
        points = [{"month": k, "revenue": monthly[k]["XB"], "charges": monthly[k]["XB"] - monthly[k]["XE"],
                   "excluded": False} for k in keys if monthly[k]["XB"] > 0]
        empty = {"fixed_monthly": None, "variable_rate": None, "r2": None, "n": len(points), "breakeven_monthly": None,
                 "safety_margin_pct": None, "operating_leverage": None, "average_revenue": None, "points": points,
                 "line": [], "reliable": False,
                 "method": "Régression des charges d'exploitation mensuelles sur le chiffre d'affaires mensuel."}
        if len(points) < 4:
            return empty
        fit = stats.linear_regression([p["revenue"] for p in points], [p["charges"] for p in points])
        if fit["slope"] is None:
            return empty
        residuals = [p["charges"] - fit["intercept"] - fit["slope"] * p["revenue"] for p in points]
        scores = _anomaly_scores(residuals)
        kept = [p for p, z in zip(points, scores) if abs(z or 0.0) <= stats.OUTLIER_Z]
        if len(kept) < len(points) and len(kept) >= 6:
            refit = stats.linear_regression([p["revenue"] for p in kept], [p["charges"] for p in kept])
            if refit["slope"] is not None:
                fit = refit
                for p, z in zip(points, scores):
                    p["excluded"] = abs(z or 0.0) > stats.OUTLIER_Z
            else:
                kept = points
        else:
            kept = points
        fixed, slope = fit["intercept"], fit["slope"]
        interpretable = slope is not None and fixed is not None and 0 <= slope < 1 and fixed > 0
        recent = [p["revenue"] for p in kept][-12:]
        average = stats.mean(recent)
        breakeven = fixed / (1 - slope) if interpretable else None
        contribution = average * (1 - slope) if interpretable else None
        xs = [p["revenue"] for p in kept]
        return {
            "fixed_monthly": fixed, "variable_rate": slope * 100 if slope is not None else None, "r2": fit["r2"],
            "n": len(kept), "breakeven_monthly": breakeven,
            "safety_margin_pct": (average - breakeven) / average * 100 if breakeven is not None and average else None,
            "operating_leverage": contribution / (contribution - fixed) if interpretable and contribution - fixed > 0 else None,
            "average_revenue": average, "points": points,
            "line": [{"x": min(xs), "y": fixed + slope * min(xs)}, {"x": max(xs), "y": fixed + slope * max(xs)}],
            "reliable": interpretable and (fit["r2"] or 0) >= 0.5 and len(kept) >= 6,
            "method": empty["method"] + " Moindres carrés, mois aberrants écartés (score robuste des résidus > 3,5).",
        }

    def _budget_variance(self, ctx):
        """Lignes budgétaires : réalisé et budget cumulés à la date d'arrêté (mois entamé au prorata), écart,
        projection de fin d'exercice au rythme des mois complets (réalisé + moyenne mensuelle × mois restants)
        et probabilité de dépassement (charges, investissements) ou de sous-réalisation (produits) : loi normale
        d'écart-type = écart-type des réalisations mensuelles × √(mois restants), trois mois complets au moins."""
        budget = self._budget(ctx)
        if not budget:
            return {"available": False, "budget": None, "lines": []}
        record, lines = budget["record"], budget["lines"]
        if not lines:
            status = self._metrics().budget_status(ctx.company, ctx.date_to) or {"lines": []}
            return {"available": True, "budget": {"id": record.id, "name": record.name}, "by_account": True, "lines": [
                {"id": None, "name": f"{r['code']} {r['name']}", "nature": "income" if r["kind"] == "produit" else "expense",
                 "budget_to_date": r["budget"], "actual_to_date": r["actual"], "gap": r["gap"], "gap_pct": r["gap_pct"],
                 "annual_budget": None, "projection": None, "projected_gap": None, "risk_probability_pct": None,
                 "risk": None, "status": "depassement" if r["overrun"] else "conforme"} for r in status["lines"]]}
        Line = self.env["eguitra.budget.line"]
        start = record.date_from.replace(day=1)
        months = [m for m in _months_between(start, min(ctx.date_to, record.date_to))]
        monthly = []
        for month in months:
            end = min(_month_end(month), ctx.date_to)
            monthly.append(lines._compute_actuals(Line._actual_rows(ctx.company, month, end)))
        complete = len(months) if ctx.month_complete else max(0, len(months) - 1)
        current_share = 0.0 if ctx.month_complete or not months else \
            ctx.date_to.day / ((_month_end(ctx.date_to) - ctx.date_to.replace(day=1)).days + 1)
        elapsed = complete + current_share
        remaining = max(0.0, 12.0 - elapsed)
        rows = []
        for line in lines:
            actuals = [m.get(line.id, 0.0) for m in monthly]
            done = actuals[:complete]
            to_date = sum(actuals)
            planned = 0.0
            for i, month in enumerate(months):
                share = current_share if (i == len(months) - 1 and not ctx.month_complete) else 1.0
                planned += (line[f"amount_{month.month:02d}"] or 0.0) * share
            rate = stats.mean(done) if done else (to_date / elapsed if elapsed else None)
            projection = to_date + (rate or 0.0) * remaining
            annual = line.amount_total
            sigma = stats.stdev(done) if len(done) >= 3 else None
            spread = sigma * math.sqrt(remaining) if sigma else None
            if line.nature == "income":
                risk = "sous-réalisation"
                probability = (stats.norm_cdf((annual - projection) / spread) if spread
                               else 1.0 if projection < annual else 0.0)
            else:
                risk = "dépassement"
                probability = (1 - stats.norm_cdf((annual - projection) / spread) if spread
                               else 1.0 if projection > annual else 0.0)
            gap = to_date - planned
            rows.append({
                "id": line.id, "name": line.name, "nature": line.nature, "prefixes": line.account_prefixes or None,
                "budget_to_date": planned, "actual_to_date": to_date, "gap": gap, "gap_pct": _pct_of(gap, planned),
                "annual_budget": annual, "projection": projection, "projected_gap": projection - annual,
                "monthly_actuals": actuals, "risk": risk,
                "risk_probability_pct": probability * 100 if annual else None,
            })
        return {"available": True, "budget": {"id": record.id, "name": record.name}, "by_account": False,
                "months_elapsed": elapsed, "lines": sorted(rows, key=lambda r: -(r["risk_probability_pct"] or 0.0))}

    def _chantiers(self, ctx):
        """Par chantier, à la date d'arrêté : avancement (dernière situation datée), travaux facturés, coûts
        (charges imputées sur l'axe du chantier), marge ; valeur acquise = avancement × montant du marché
        (valeur de vente, faute de budget de coûts par chantier) ; CPI = valeur acquise / coûts ; coût à
        terminaison EAC = marché / CPI ; marge à terminaison = marché - EAC."""
        if "eguitra.chantier" not in self.env:
            return []
        chantiers = self.env["eguitra.chantier"].search([("company_id", "=", ctx.company.id)])
        plan = self.env.ref("eguitra_base.analytic_plan_chantier", raise_if_not_found=False)
        if not chantiers or not plan:
            return []
        column = plan._column_name()
        costs = dict(self._rows(
            f"""SELECT aal.{column}, COALESCE(SUM(-aal.amount), 0) FROM account_analytic_line aal
                  JOIN account_account aa ON aa.id = aal.general_account_id
                 WHERE aal.company_id = %s AND aal.date <= %s AND aal.{column} = ANY(%s) AND {AAL_CODE} LIKE '6%%'
              GROUP BY 1""",
            (ctx.company.id, ctx.date_to, chantiers.analytic_account_id.ids),
        ))
        rows = []
        for chantier in chantiers:
            situations = chantier.situation_ids.filtered(lambda s: s.state != "cancelled" and s.date <= ctx.date_to)
            invoiced = sum(situations.filtered(lambda s: s.state == "invoiced").mapped("amount_period"))
            last = situations.sorted("number")[-1:]
            contract = chantier.contract_amount or 0.0
            progress = last.cumulative_amount / contract * 100 if last and contract else 0.0
            cost = float(costs.get(chantier.analytic_account_id.id, 0.0))
            if not invoiced and not cost and not situations:
                continue
            earned = progress / 100 * contract
            cpi = earned / cost if cost > 0 and earned else None
            eac = contract / cpi if cpi else None
            rows.append({
                "id": chantier.id, "name": chantier.name, "code": chantier.code or None, "client": chantier.partner_id.name,
                "state": chantier.state, "contract_amount": contract, "progress_pct": progress, "invoiced": invoiced,
                "costs": cost, "margin": invoiced - cost, "margin_pct": _pct_of(invoiced - cost, invoiced),
                "earned_value": earned, "cpi": cpi, "eac": eac,
                "margin_at_completion": contract - eac if eac is not None else None,
                "margin_at_completion_pct": _pct_of(contract - eac, contract) if eac is not None else None,
                "retention_outstanding": chantier.retention_total - chantier.retention_released,
            })
        return sorted(rows, key=lambda r: (r["cpi"] is None, r["cpi"] or 0.0))

    def _immobilier(self, ctx):
        """Par bien : occupation sur la période (jours couverts par un bail / jours de la période), loyer
        annuel du bail en cours, valeur (actuelle, à défaut d'acquisition), rendement brut = loyer annuel /
        valeur, loyers impayés échus, produits et charges de la période (axe Bien immobilier)."""
        if "eguitra.property" not in self.env:
            return {"properties": [], "summary": None}
        props = self.env["eguitra.property"].search([("company_id", "=", ctx.company.id)])
        if not props:
            return {"properties": [], "summary": None}
        plan = self.env.ref("eguitra_base.analytic_plan_bien", raise_if_not_found=False)
        flows = {}
        if plan:
            column = plan._column_name()
            for account_id, income, expense in self._rows(
                f"""SELECT aal.{column},
                           COALESCE(SUM(CASE WHEN {AAL_CODE} LIKE '7%%' THEN aal.amount END), 0),
                           COALESCE(SUM(CASE WHEN {AAL_CODE} LIKE '6%%' THEN -aal.amount END), 0)
                      FROM account_analytic_line aal JOIN account_account aa ON aa.id = aal.general_account_id
                     WHERE aal.company_id = %s AND aal.date BETWEEN %s AND %s AND aal.{column} = ANY(%s)
                  GROUP BY 1""",
                (ctx.company.id, ctx.date_from, ctx.date_to, props.analytic_account_id.ids),
            ):
                flows[account_id] = (float(income), float(expense))
        Lease = self.env["eguitra.lease"]
        contract_property = {lease.contract_id.id: lease.property_id.id
                             for lease in Lease.search([("company_id", "=", ctx.company.id), ("contract_id", "!=", False)])}
        unpaid = {}
        for move in Lease.unpaid_rents(ctx.company, ctx.date_to):
            prop = next((contract_property.get(c) for c in move.invoice_line_ids.contract_line_id.contract_id.ids
                         if contract_property.get(c)), None)
            if prop:
                amount, count = unpaid.get(prop, (0.0, 0))
                unpaid[prop] = (amount + move.amount_residual, count + 1)
        factor = {"monthly": 12, "quarterly": 4, "yearly": 1}
        rows = []
        for prop in props:
            covered = 0
            for lease in prop.lease_ids.filtered(lambda l: l.state in ("active", "terminated")):
                first = max(lease.date_start, ctx.date_from)
                last = min(lease.date_end or ctx.date_to, ctx.date_to)
                covered += max(0, (last - first).days + 1)
            active = prop.lease_ids.filtered(lambda l: l.state == "active")[:1]
            rent = (active.rent + (active.charges or 0.0)) * factor[active.periodicity] if active else 0.0
            value = prop.current_value or prop.acquisition_value or 0.0
            income, expense = flows.get(prop.analytic_account_id.id, (0.0, 0.0))
            amount, count = unpaid.get(prop.id, (0.0, 0))
            rows.append({
                "id": prop.id, "name": prop.name, "kind": prop.kind, "occupied": bool(active),
                "occupancy_pct": min(100.0, covered / ctx.days * 100), "annual_rent": rent, "value": value,
                "gross_yield_pct": _pct_of(rent, value), "unpaid_amount": amount, "unpaid_count": count,
                "revenue": income, "costs": expense, "net": income - expense,
                "lease_end": active.date_end if active else None,
            })
        values = sum(r["value"] for r in rows)
        rent = sum(r["annual_rent"] for r in rows)
        summary = {
            "properties": len(rows), "occupied": sum(1 for r in rows if r["occupied"]),
            "occupancy_pct": stats.mean([r["occupancy_pct"] for r in rows]), "annual_rent": rent,
            "portfolio_value": values, "gross_yield_pct": _pct_of(rent, values),
            "unpaid_amount": sum(r["unpaid_amount"] for r in rows), "unpaid_count": sum(r["unpaid_count"] for r in rows),
            "revenue": sum(r["revenue"] for r in rows), "costs": sum(r["costs"] for r in rows),
        }
        return {"properties": sorted(rows, key=lambda r: -r["annual_rent"]), "summary": summary}

    def _bridge_insights(self, ctx, bridge):
        start, end = bridge[0]["value"], bridge[-1]["value"]
        change = stats.pct_change(end, start)
        moves = [s for s in bridge if s["kind"] != "total" and s["key"] != "other"]
        if change is None or abs(change) < 5 or not moves:
            return []
        method = ("Pont d'EBE : variation de la marge analytique de chaque activité ; transport décomposé en effets "
                  "volume (Δ m³ × tarif N-1), prix (Δ tarif par route × m³ N) et mix.")
        metric = _metric("EBE", end, "gnf", start, "EBE N-1")
        if end < start:
            worst = min(moves, key=lambda s: s["value"])
            return [insight(
                "rentabilite.ebe_recul", "rentabilite", "high" if change <= -20 else "medium",
                f"L'EBE recule de {pct(abs(change))} sur un an",
                f"L'excédent brut d'exploitation passe de {gnf(start)} sur la même période de l'an dernier à {gnf(end)}. "
                f"Premier facteur de recul : « {worst['label']} » ({gnf(worst['value'])}).",
                metric=metric, impact_gnf=start - end, confidence=0.8, method=method,
                evidence={"type": "bars", "data": {"steps": bridge}},
                action=f"Analyser « {worst['label']} » : prix, volumes ou coûts, et décider d'une mesure chiffrée.",
                link="/analyse/rentabilite")]
        best = max(moves, key=lambda s: s["value"])
        return [insight(
            "rentabilite.ebe_progression", "rentabilite", "positive", f"L'EBE progresse de {pct(change)} sur un an",
            f"L'excédent brut d'exploitation passe de {gnf(start)} sur la même période de l'an dernier à {gnf(end)} ; "
            f"premier moteur : « {best['label']} » ({gnf(best['value'])}).", metric=metric, impact_gnf=end - start, confidence=0.8, method=method,
            evidence={"type": "bars", "data": {"steps": bridge}}, link="/analyse/rentabilite")]

    def _activity_insights(self, ctx):
        items = []
        for account_id, row in self._activity_rows(ctx, ctx.date_from, ctx.date_to).items():
            if row["income"] > 0 and row["margin"] < 0:
                items.append(insight(
                    f"rentabilite.activite_deficitaire.{account_id}", "rentabilite", "high",
                    f"L'activité « {row['name']} » perd de l'argent",
                    f"Sur la période, l'activité dégage {gnf(row['income'])} de produits pour {gnf(row['expense'])} de "
                    f"charges imputées, soit une marge de {pct(row['margin_rate'])}.",
                    metric=_metric("Marge", row["margin_rate"], "pct", 0, "Équilibre"), impact_gnf=-row["margin"],
                    confidence=0.7, method="Produits (classe 7) et charges (classe 6) imputés sur l'axe Activité.",
                    action="Vérifier l'imputation des charges, puis revoir les prix ou le périmètre de l'activité.",
                    link=f"/analyse/rentabilite?activite={account_id}"))
        return items

    def _cost_insights(self, cost):
        if not cost["reliable"] or cost["safety_margin_pct"] is None:
            return []
        margin = cost["safety_margin_pct"]
        method = cost["method"]
        metric = _metric("Marge de sécurité", margin, "pct", 20, "Repère de prudence")
        narrative = (f"Charges fixes estimées à {gnf(cost['fixed_monthly'])} par mois, part variable de "
                     f"{pct(cost['variable_rate'])} du chiffre d'affaires (R² {_num(cost['r2'], 2)}, {cost['n']} mois) : "
                     f"le point mort est à {gnf(cost['breakeven_monthly'])} de chiffre d'affaires mensuel pour un "
                     f"chiffre d'affaires moyen de {gnf(cost['average_revenue'])}.")
        if margin < 20:
            return [insight(
                "rentabilite.point_mort_proche", "rentabilite", "high" if margin < 10 else "medium",
                "Le chiffre d'affaires est proche du point mort",
                narrative + f" Une baisse de {pct(max(margin, 0))} du chiffre d'affaires suffit à annuler le résultat "
                            "d'exploitation.", metric=metric,
                impact_gnf=max(0.0, cost["breakeven_monthly"] * 1.2 - cost["average_revenue"]) * 12,
                confidence=min(0.9, cost["r2"]), method=method,
                evidence={"type": "scatter", "data": {"points": cost["points"], "line": cost["line"]}},
                action="Réduire les charges fixes ou relever les prix ; chaque GNF de charges fixes en moins abaisse le "
                       f"point mort de {_num(1 / (1 - cost['variable_rate'] / 100), 2)} GNF.",
                link=COST_STRUCTURE_LINK)]
        if margin >= 30:
            return [insight(
                "rentabilite.point_mort_eloigne", "rentabilite", "positive", "Le point mort est loin",
                narrative + f" La marge de sécurité atteint {pct(margin)}.", metric=metric,
                confidence=min(0.9, cost["r2"]), method=method,
                evidence={"type": "scatter", "data": {"points": cost["points"], "line": cost["line"]}},
                link=COST_STRUCTURE_LINK)]
        return []

    def _budget_insights(self, budget):
        items = []
        for row in budget.get("lines", []):
            probability = row.get("risk_probability_pct")
            if probability is None or probability < 70 or not row["annual_budget"]:
                continue
            gap = abs(row["projected_gap"])
            items.append(insight(
                f"rentabilite.budget.{row['id']}", "rentabilite", "high" if probability >= 90 else "medium",
                f"« {row['name']} » : {row['risk']} probable en fin d'exercice",
                f"Réalisé de {gnf(row['actual_to_date'])} pour un budget cumulé de {gnf(row['budget_to_date'])} ; au "
                f"rythme actuel, l'exercice finirait à {gnf(row['projection'])} pour un budget annuel de "
                f"{gnf(row['annual_budget'])} (probabilité de {row['risk']} : {pct(probability, 0)}).",
                metric=_metric("Probabilité", probability, "pct", 50, "Une chance sur deux"), impact_gnf=gap,
                confidence=0.65, method="Projection au rythme des mois complets, dispersion des réalisations mensuelles "
                                        "(loi normale).",
                evidence={"type": "series", "data": {"monthly_actuals": row["monthly_actuals"]}},
                action="Arrêter avec le responsable de la ligne une mesure de correction ou réviser l'enveloppe.",
                link=BUDGET_LINK))
        return items

    def _chantier_insights(self, chantiers):
        items = []
        for row in chantiers:
            if row["cpi"] is None or row["cpi"] >= 1:
                continue
            loss = -(row["margin_at_completion"] or 0.0)
            items.append(insight(
                f"rentabilite.chantier_cpi.{row['id']}", "rentabilite", "critical" if row["cpi"] < 0.9 else "high",
                f"Le chantier « {row['name']} » finira en perte au rythme actuel",
                f"Avancement de {pct(row['progress_pct'], 0)} pour {gnf(row['costs'])} de coûts engagés : chaque GNF dépensé "
                f"produit {_num(row['cpi'], 2)} GNF de travaux (CPI). Au même rendement, le chantier coûterait "
                f"{gnf(row['eac'])} pour un marché de {gnf(row['contract_amount'])}.",
                metric=_metric("CPI", row["cpi"], "ratio", 1, "Équilibre"), impact_gnf=loss, confidence=0.7,
                method="Valeur acquise = avancement × marché ; CPI = valeur acquise / coûts ; EAC = marché / CPI.",
                action="Revoir le métré et les coûts du chantier, négocier un avenant pour les travaux supplémentaires.",
                link="/finance/chantiers"))
        return items

    def _immobilier_insights(self, immobilier):
        items = []
        summary = immobilier.get("summary")
        if not summary:
            return items
        if summary["unpaid_amount"] > 0.5:
            items.append(insight(
                "rentabilite.loyers_impayes", "rentabilite", "medium", "Des loyers échus restent impayés",
                f"{summary['unpaid_count']} quittance(s) échue(s) non réglée(s), {gnf(summary['unpaid_amount'])} au total.",
                metric=_metric("Impayés", summary["unpaid_amount"], "gnf"), impact_gnf=summary["unpaid_amount"],
                confidence=0.9, method="Factures de loyer comptabilisées, échues et non réglées.",
                action="Relancer les locataires et appliquer les clauses du bail (dépôt de garantie, résiliation).",
                link="/finance/immobilier"))
        vacant = [p for p in immobilier["properties"] if not p["occupied"] and p["value"]]
        if vacant:
            yield_pct = summary["gross_yield_pct"] or 0.0
            lost = sum(p["value"] for p in vacant) * yield_pct / 100
            items.append(insight(
                "rentabilite.biens_vacants", "rentabilite", "medium", f"{len(vacant)} bien(s) sans locataire",
                "Biens vacants : " + ", ".join(p["name"] for p in vacant[:5]) + "."
                + (f" Au rendement moyen du parc ({pct(yield_pct)}), le manque à gagner approche {gnf(lost)} par an."
                   if lost else ""),
                metric=_metric("Occupation", summary["occupancy_pct"], "pct", 100, "Parc loué"), impact_gnf=lost or None,
                confidence=0.6, method="Biens sans bail en cours ; manque à gagner au rendement brut moyen du parc.",
                action="Remettre les biens en location (prix, travaux, mandat) ou arbitrer leur cession.",
                link="/finance/immobilier"))
        return items

    # ─── 5.3 Trésorerie ───────────────────────────────────────────────────

    def _section_tresorerie(self, ctx):
        position = self._cash_position(ctx)
        sim = self._cash_simulation(ctx)
        positions = self._position_months(ctx, 12)
        cycle = {"months": [p["month"] for p in positions], "series": [
            {"key": "dso", "label": "Délai clients (DSO)", "unit": "days", "values": [p["dso"] for p in positions]},
            {"key": "dpo", "label": "Délai fournisseurs (DPO)", "unit": "days", "values": [p["dpo"] for p in positions]},
            {"key": "dio", "label": "Rotation des stocks (DIO)", "unit": "days", "values": [p["dio"] for p in positions]},
            {"key": "cycle", "label": "Cycle de conversion", "unit": "days", "values": [p["cycle"] for p in positions]},
            {"key": "bfr", "label": "Besoin en fonds de roulement", "unit": "gnf", "values": [p["bfr"] for p in positions]},
        ], "definition": "Soldes comptables de fin de mois rapportés aux ventes et achats TTC des trois mois glissants."}
        blocks = {"position": position, "forecast": sim["forecast"], "runway": sim["runway"], "cycle": cycle,
                  "collections": sim["collections"]}
        return blocks, self._treasury_insights(ctx, position, sim, positions)

    def _cash_position(self, ctx):
        """Trésorerie par compte de banque et de caisse (contre-valeur GNF et solde en devise) et par devise."""
        rows = self._metrics().cash_by_journal(ctx.company, ctx.date_to)
        total = sum(r["balance"] for r in rows)
        currencies = {}
        for r in rows:
            entry = currencies.setdefault(r["currency"], {"currency": r["currency"], "balance_currency": 0.0, "balance": 0.0})
            entry["balance_currency"] += r["balance_currency"]
            entry["balance"] += r["balance"]
        for entry in currencies.values():
            entry["share_pct"] = _pct_of(entry["balance"], total) if total > 0 else None
        return {
            "accounts": [dict(r, share_pct=_pct_of(r["balance"], total) if total > 0 else None) for r in rows],
            "by_currency": sorted(currencies.values(), key=lambda e: -e["balance"]),
            "total": total, "net_cash": self._metrics().cash(ctx.company, ctx.date_to),
        }

    def _cash_simulation(self, ctx):
        """Prévision de trésorerie des banques et caisses sur 13 semaines à partir du lendemain de la date
        d'arrêté.

        Encaissements : chaque créance ouverte (après imputation des avances du client) est encaissée à son
        échéance plus un retard tiré, à chaque tirage, parmi les retards observés du client (trois factures
        réglées au moins sur 24 mois), à défaut parmi ceux de tous les clients, à défaut parmi 0, 7, 15 et 30
        jours ; seuls les retards supérieurs au retard déjà constaté sont retenus (la facture n'est pas encore
        payée) ; sans tel retard dans l'historique, l'encaissement tombe entre la 2e et la 8e semaine. Les
        créances échues depuis plus de 90 jours sont tenues pour douteuses et écartées (comme cash_forecast).
        Décaissements : dettes fournisseurs à échéance (échues : première semaine), échéances d'emprunt non
        réglées, charges récurrentes à chaque fin de mois (personnel 66 et loyers 622 : moyenne des six
        derniers mois complets), salaires dus (422 : première semaine), dettes fiscales et sociales nettes
        (43, 44) le 15 du mois suivant. Bandes p10, p50, p90 : quantiles des soldes simulés (Monte-Carlo,
        1 000 tirages à graine fixe)."""
        def load():
            c, day = ctx.company, ctx.date_to
            metrics = self._metrics()
            th = self._thresholds(ctx)
            start_balance = metrics._treasury_balance(c, day)
            first = day + timedelta(days=1)
            weeks = [(first + timedelta(days=7 * i), first + timedelta(days=7 * i + 6)) for i in range(WEEKS)]
            horizon = weeks[-1][1]

            def week_of(d):
                if d <= day:
                    return 0
                i = (d - first).days // 7
                return i if i < WEEKS else None

            detail = {key: [0.0] * WEEKS for key in ("payables", "loans", "recurring", "taxes")}
            payables = self._open_items(ctx, "liability_payable")
            for item in payables["items"]:
                w = week_of(item["due"])
                if w is not None:
                    detail["payables"][w] += item["amount"]
            for line in self.env["eguitra.loan.line"].search([
                ("loan_id.company_id", "=", c.id), ("loan_id.state", "=", "active"), ("paid", "=", False),
                ("due_date", "<=", horizon),
            ]):
                detail["loans"][week_of(line.due_date)] += line.total
            previous_end = day.replace(day=1) - timedelta(days=1)
            base_months = _month_list(previous_end, 6)
            recurring = 0.0
            for prefix in ("66", "622"):
                amounts = metrics._monthly_amounts(c, base_months[0], previous_end, [prefix])
                values = [v for v in amounts.values() if v > 0]
                recurring += sum(values) / len(values) if values else 0.0
            month = day.replace(day=1)
            while month <= horizon:
                end = _month_end(month)
                if day < end <= horizon:
                    detail["recurring"][week_of(end)] += recurring
                month += relativedelta(months=1)
            wages = -metrics._sum_balance(c, ["422"], None, day)
            if wages > 0.5:
                detail["taxes"][0] += wages
            fiscal = -metrics._sum_balance(c, ["43", "44"], None, day)
            due15 = (day.replace(day=1) + relativedelta(months=1)).replace(day=15)
            if fiscal > 0.5 and week_of(due15) is not None:
                detail["taxes"][week_of(due15)] += fiscal
            outflows = [sum(detail[k][w] for k in detail) for w in range(WEEKS)]

            history = self._payment_history(ctx)
            pools = {}
            for record in history:
                pools.setdefault(record["partner"], []).append(record["days_late"])
            global_pool = [r["days_late"] for r in history]
            receivables = self._open_items(ctx, "asset_receivable")
            simulated, doubtful = [], {}
            for item in receivables["items"]:
                late = (day - item["due"]).days
                if late > DOUBTFUL_DAYS:
                    doubtful[item["partner"]] = doubtful.get(item["partner"], 0.0) + item["amount"]
                    continue
                own = pools.get(item["partner"]) or []
                pool = own if len(own) >= MIN_HISTORY else global_pool if len(global_pool) >= MIN_HISTORY \
                    else list(DEFAULT_DELAYS)
                weeks_drawn = [week_of(item["due"] + timedelta(days=round(d))) for d in pool if d > late]
                if not weeks_drawn:
                    weeks_drawn = [week_of(day + timedelta(days=d)) for d in range(8, 57)]
                simulated.append((item, weeks_drawn))
            draws = DRAWS if len(simulated) * DRAWS <= MAX_SIMULATED else max(200, MAX_SIMULATED // len(simulated))
            rng = random.Random(SEED)
            paths = [[0.0] * WEEKS for _ in range(draws)]
            by_client = {}
            for item, weeks_drawn in simulated:
                acc = by_client.setdefault(item["partner"], [0.0] * (WEEKS + 1))
                amount = item["amount"]
                for k in range(draws):
                    w = rng.choice(weeks_drawn)
                    if w is None:
                        acc[WEEKS] += amount
                    else:
                        paths[k][w] += amount
                        acc[w] += amount
            balances = [[0.0] * draws for _ in range(WEEKS)]
            for k in range(draws):
                running = start_balance
                for w in range(WEEKS):
                    running += paths[k][w] - outflows[w]
                    balances[w][k] = running
            rows = []
            for w, (begin, end) in enumerate(weeks):
                inflow = sum(paths[k][w] for k in range(draws)) / draws
                rows.append({
                    "week": w + 1, "start": begin, "end": end, "inflows": inflow, "outflows": outflows[w],
                    "net": inflow - outflows[w], "balance_p10": stats.quantile(balances[w], 0.1),
                    "balance_p50": stats.quantile(balances[w], 0.5), "balance_p90": stats.quantile(balances[w], 0.9),
                })
            threshold = th["cash_min"] or 0.0

            def first_below(key):
                return next((r["week"] for r in rows if r[key] < threshold), None)

            low = min(rows, key=lambda r: r["balance_p50"])
            low10 = min(rows, key=lambda r: r["balance_p10"])
            runway = {
                "threshold": threshold, "threshold_source": "cash_min" if th["cash_min"] else "zero",
                "weeks_p50": first_below("balance_p50"), "weeks_p10": first_below("balance_p10"),
                "covered": first_below("balance_p10") is None, "start_balance": start_balance, "horizon_end": horizon,
                "low_point": {"week": low["week"], "start": low["start"], "balance_p50": low["balance_p50"],
                              "balance_p10": low10["balance_p10"], "week_p10": low10["week"]},
            }
            open_by_client, overdue_by_client = {}, {}
            for item in receivables["items"]:
                open_by_client[item["partner"]] = open_by_client.get(item["partner"], 0.0) + item["amount"]
                if item["due"] < day:
                    overdue_by_client[item["partner"]] = overdue_by_client.get(item["partner"], 0.0) + item["amount"]
            names = self._names("res.partner", list(open_by_client))
            collections = []
            for partner, amount in open_by_client.items():
                acc = [v / draws for v in by_client.get(partner, [0.0] * (WEEKS + 1))]
                own = pools.get(partner) or []
                collections.append({
                    "id": partner, "name": names.get(partner, "Sans tiers"), "open": amount,
                    "overdue": overdue_by_client.get(partner, 0.0), "doubtful": doubtful.get(partner, 0.0),
                    "avg_days_late": stats.mean(own), "sd_days_late": stats.stdev(own), "history_n": len(own),
                    "history_source": "client" if len(own) >= MIN_HISTORY else "global" if len(global_pool) >= MIN_HISTORY
                    else "default",
                    "expected_by_week": acc[:WEEKS], "expected_total": sum(acc[:WEEKS]), "beyond_horizon": acc[WEEKS],
                })
            collections.sort(key=lambda r: -r["open"])
            return {
                "forecast": {
                    "start_balance": start_balance, "weeks": rows, "draws": draws, "seed": SEED,
                    "doubtful_excluded": sum(doubtful.values()),
                    "beyond_horizon": sum(r["beyond_horizon"] for r in collections),
                    "receivables_simulated": sum(item["amount"] for item, _w in simulated),
                    "unapplied_receipts": sum(receivables["unapplied"].values()),
                    "outflows_detail": detail, "recurring_monthly": recurring,
                    "payables_overdue": sum(i["amount"] for i in payables["items"] if i["due"] <= day),
                    "method": "Monte-Carlo sur les retards de paiement observés par client (24 mois), décaissements "
                              "à échéance ; bandes p10-p90 des soldes simulés.",
                },
                "runway": runway,
                "collections": collections[:30],
            }
        return ctx.get("cash_simulation", load)

    def _treasury_insights(self, ctx, position, sim, positions):
        items = []
        runway, fc = sim["runway"], sim["forecast"]
        threshold = runway["threshold"]
        floor_label = "le seuil de trésorerie minimale" if runway["threshold_source"] == "cash_min" else "zéro"
        method = fc["method"]
        evidence = {"type": "series", "data": {"weeks": [
            {"week": r["week"], "p10": r["balance_p10"], "p50": r["balance_p50"], "p90": r["balance_p90"]}
            for r in fc["weeks"]]}}
        late_clients = sorted((c for c in sim["collections"] if c["overdue"] > 0), key=lambda c: -c["overdue"])[:3]
        levers = ", ".join(f"{c['name']} ({gnf(c['overdue'])})" for c in late_clients)
        action = ("Accélérer le recouvrement des créances échues" + (f" : {levers}" if levers else "")
                  + " ; étaler les décaissements non prioritaires de la période.")
        if runway["weeks_p50"]:
            week = fc["weeks"][runway["weeks_p50"] - 1]
            items.append(insight(
                "tresorerie.seuil_franchi", "tresorerie", "critical",
                f"La trésorerie passe sous {floor_label} dans {runway['weeks_p50']} semaine(s)",
                f"Dans le scénario central, le solde des banques et caisses tombe à {gnf(week['balance_p50'])} la semaine "
                f"du {week['start']:%d/%m/%Y} ; point bas de {gnf(runway['low_point']['balance_p50'])}.",
                metric=_metric("Solde au point bas", runway["low_point"]["balance_p50"], "gnf", threshold, "Seuil"),
                impact_gnf=max(0.0, threshold - runway["low_point"]["balance_p50"]), confidence=0.8, method=method,
                evidence=evidence, action=action, link="/analyse/tresorerie"))
        elif runway["weeks_p10"]:
            week = fc["weeks"][runway["weeks_p10"] - 1]
            items.append(insight(
                "tresorerie.risque_seuil", "tresorerie", "high",
                f"Une chance sur dix de passer sous {floor_label} d'ici {runway['weeks_p10']} semaine(s)",
                f"Le scénario central reste au-dessus du seuil, mais si les clients paient comme dans leurs pires délais "
                f"observés, le solde tombe à {gnf(week['balance_p10'])} la semaine du {week['start']:%d/%m/%Y}.",
                metric=_metric("Solde p10 au point bas", runway["low_point"]["balance_p10"], "gnf", threshold, "Seuil"),
                impact_gnf=max(0.0, threshold - runway["low_point"]["balance_p10"]), confidence=0.7, method=method,
                evidence=evidence, action=action, link="/analyse/tresorerie"))
        else:
            items.append(insight(
                "tresorerie.couverte", "tresorerie", "positive", "La trésorerie est couverte sur 13 semaines",
                f"Même dans le scénario prudent (p10), le solde reste au-dessus de {floor_label} jusqu'au "
                f"{runway['horizon_end']:%d/%m/%Y} ; point bas p10 de {gnf(runway['low_point']['balance_p10'])}.",
                metric=_metric("Solde p10 au point bas", runway["low_point"]["balance_p10"], "gnf", threshold, "Seuil"),
                confidence=0.75, method=method, evidence=evidence, link="/analyse/tresorerie"))
        if fc["doubtful_excluded"] > 0.5:
            names = ", ".join(c["name"] for c in sorted(sim["collections"], key=lambda c: -c["doubtful"])
                              if c["doubtful"] > 0.5)
            items.append(insight(
                "tresorerie.creances_douteuses", "tresorerie", "high",
                f"{gnf(fc['doubtful_excluded'])} de créances échues depuis plus de 90 jours",
                f"Ces créances ({names}) ne sont plus comptées dans la prévision : leur encaissement est incertain.",
                metric=_metric("Créances douteuses", fc["doubtful_excluded"], "gnf"), impact_gnf=fc["doubtful_excluded"],
                confidence=0.9, method="Créances dont l'échéance date de plus de 90 jours (règle de la prévision de la finance).",
                action="Mise en demeure, plan d'apurement ou procédure de recouvrement ; provisionner le risque.",
                link="/finance/relances"))
        if fc["payables_overdue"] > 0.5:
            items.append(insight(
                "tresorerie.fournisseurs_echus", "tresorerie", "medium",
                f"{gnf(fc['payables_overdue'])} de dettes fournisseurs échues",
                "Les factures fournisseurs échues sont comptées en première semaine de la prévision ; leur retard expose "
                "à des pénalités et à la suspension des approvisionnements (carburant, pièces).",
                metric=_metric("Dettes échues", fc["payables_overdue"], "gnf"), impact_gnf=fc["payables_overdue"],
                confidence=0.85, method="Dettes fournisseurs ouvertes dont l'échéance est passée.",
                action="Établir un calendrier de règlement avec les fournisseurs stratégiques (carburant, maintenance).",
                link="/finance/tiers"))
        dso = [(i, p["dso"]) for i, p in enumerate(positions) if p["dso"] is not None]
        if len(dso) >= 6:
            fit = stats.linear_regression([i for i, _v in dso], [v for _i, v in dso])
            if fit["slope"] is not None and fit["slope"] > 2 and (fit["t"] or 0) > 2:
                daily = (positions[-1]["sales_ttc"] or 0.0) / (positions[-1]["days"] or 1)
                items.append(insight(
                    "tresorerie.dso_degradation", "tresorerie", "medium",
                    f"Le délai de recouvrement s'allonge de {_days(fit['slope'])} par mois",
                    f"Sur les {len(dso)} derniers mois, le DSO passe de {_days(dso[0][1])} à {_days(dso[-1][1])} (tendance "
                    f"significative, R² {_num(fit['r2'], 2)}) ; chaque jour de délai immobilise environ {gnf(daily)}.",
                    metric=_metric("DSO", dso[-1][1], "days", self._thresholds(ctx)["dso_target_days"], "Cible"),
                    impact_gnf=fit["slope"] * 6 * daily, confidence=min(0.9, fit["r2"] or 0.5),
                    method="Régression linéaire du DSO mensuel (soldes de fin de mois, ventes TTC des trois mois glissants).",
                    evidence={"type": "series", "data": {"months": [positions[i]["month"] for i, _v in dso],
                                                         "values": [v for _i, v in dso]}},
                    action="Relance systématique à l'échéance et conditions de paiement revues pour les clients en retard.",
                    link="/analyse/clients"))
        if fc["unapplied_receipts"] > 0.5:
            items.append(insight(
                "tresorerie.reglements_non_lettres", "tresorerie", "info",
                f"{gnf(fc['unapplied_receipts'])} de règlements clients non lettrés",
                "Des encaissements ou avoirs ne sont rattachés à aucune facture : la prévision les impute sur les plus "
                "anciennes factures du client, mais la balance âgée reste faussée tant qu'ils ne sont pas lettrés.",
                metric=_metric("Non lettré", fc["unapplied_receipts"], "gnf"), confidence=0.9,
                method="Restes dus créditeurs des comptes clients.",
                action="Lettrer les règlements avec leurs factures (Trésorerie, Rapprocher).",
                link="/finance/tresorerie/rapprochement"))
        foreign = [e for e in position["by_currency"] if e["currency"] != ctx.company.currency_id.name and e["balance"] > 0]
        share = _pct_of(sum(e["balance"] for e in foreign), position["total"]) if position["total"] > 0 else None
        if share and share >= 30:
            items.append(insight(
                "tresorerie.devises", "tresorerie", "info", f"{pct(share, 0)} de la trésorerie est en devises",
                "Comptes concernés : " + ", ".join(f"{e['currency']} ({gnf(e['balance'])})" for e in foreign) + ".",
                metric=_metric("Part en devises", share, "pct"), confidence=0.9,
                method="Contre-valeur en GNF des comptes en devise.",
                action="Adosser les avoirs en devises aux échéances en devises (achats, emprunts) pour limiter le risque de change.",
                link="/finance/tresorerie"))
        return items

    # ─── 5.4 Clients ──────────────────────────────────────────────────────

    def _section_clients(self, ctx):
        revenue = self._client_revenue(ctx, ctx.date_from, ctx.date_to)
        previous = self._client_revenue(ctx, ctx.prev_from, ctx.prev_to)
        ranked = sorted(((p, v) for p, v in revenue.items() if p and v > 0), key=lambda pv: -pv[1])
        values = [v for _p, v in ranked]
        total = sum(values)
        lorenz = stats.lorenz(values, max_points=101)
        pareto = stats.pareto_count(values)
        open_items = self._open_items(ctx, "asset_receivable")
        history = self._payment_history(ctx)
        partners = {p for p, _v in ranked} | {i["partner"] for i in open_items["items"] if i["partner"]}
        names = self._names("res.partner", list(partners) + [p for p, v in previous.items() if p and v > 0])
        concentration = {
            "lorenz": lorenz["points"], "gini": lorenz["gini"], "hhi": stats.hhi(values),
            "top_share": {
                "first": _pct_of(values[0], total) if values else None,
                "first_id": ranked[0][0] if ranked else None, "first_name": names.get(ranked[0][0]) if ranked else None,
                "top5": _pct_of(sum(values[:5]), total) if values else None,
            },
            "pareto_count": pareto, "clients": len(values), "revenue": total,
            "unassigned_revenue": revenue.get(None, 0.0),
            "method": "Chiffre d'affaires (comptes 70) par client de la période : courbe de Lorenz et Gini, indice de "
                      "Herfindahl-Hirschman (parts en %), nombre de clients qui font 80 % du chiffre d'affaires.",
        }
        segments = self._client_segments(ctx, ranked, previous, open_items, history, names, pareto, total)
        blocks = {
            "concentration": concentration,
            "segments": segments,
            "behaviour": self._client_behaviour(ctx, ranked, history, names),
            "trends": self._client_trends(ctx, [p for p, _v in ranked[:10]], names),
        }
        return blocks, self._client_insights(ctx, concentration, segments, ranked, previous, names)

    @staticmethod
    def _payment_score(avg_late, open_amount, overdue, slope):
        """Note de paiement 0-100 : retard moyen (0 jour = 100, 60 jours et plus = 0 ; poids 60 %), part
        échue de l'encours (poids 25 %), tendance du retard (stable ou en baisse = 100, +4 jours par mois et
        plus = 0 ; poids 15 %) ; composantes manquantes écartées."""
        parts = []
        if avg_late is not None:
            parts.append((0.60, stats.linear_score(avg_late, 60, 0)))
        if open_amount > 0.5:
            parts.append((0.25, 100.0 * (1 - min(1.0, max(0.0, overdue) / open_amount))))
        if slope is not None:
            parts.append((0.15, stats.linear_score(slope, 4, 0)))
        if not parts:
            return None
        return round(sum(w * s for w, s in parts) / sum(w for w, _s in parts))

    @staticmethod
    def _late_trend(records):
        """Tendance du retard de paiement : régression du retard (jours) sur la date de règlement (mois)."""
        if len(records) < 4:
            return {"slope_days_per_month": None, "r2": None, "t": None, "n": len(records),
                    "label": "Historique insuffisant"}
        fit = stats.linear_regression([r["paid_ordinal"] / 30.4375 for r in records], [r["days_late"] for r in records])
        slope, t = fit["slope"], fit["t"]
        # Ajustement exact (t non défini) : tendance nette si R² est quasi égal à 1.
        significant = (t is not None and abs(t) > 2) or (t is None and (fit["r2"] or 0) > 0.99)
        if slope is not None and slope > 1 and significant:
            label = "Se dégrade"
        elif slope is not None and slope < -1 and significant:
            label = "S'améliore"
        else:
            label = "Stable"
        return {"slope_days_per_month": slope, "r2": fit["r2"], "t": t, "n": len(records), "label": label}

    def _client_segments(self, ctx, ranked, previous, open_items, history, names, pareto, total):
        """Matrice valeur × comportement : valeur forte = client parmi ceux qui font 80 % du chiffre
        d'affaires ; bon payeur = note de paiement d'au moins 60 (sans historique ni encours : réputé bon
        payeur). Perte attendue (IFRS 9) = encours par tranche d'ancienneté × taux de la matrice de la société."""
        day = ctx.date_to
        rates = self._metrics().expected_credit_loss(ctx.company, day)["rates"]
        by_partner = {}
        for record in history:
            by_partner.setdefault(record["partner"], []).append(record)
        aging, opened, overdue = {}, {}, {}
        for item in open_items["items"]:
            late = (day - item["due"]).days
            bucket = "non_echu" if late <= 0 else "1_30" if late <= 30 else "31_60" if late <= 60 \
                else "61_90" if late <= 90 else "plus_90"
            partner = item["partner"]
            aging.setdefault(partner, dict.fromkeys(rates, 0.0))[bucket] += item["amount"]
            opened[partner] = opened.get(partner, 0.0) + item["amount"]
            if late > 0:
                overdue[partner] = overdue.get(partner, 0.0) + item["amount"]
        revenue = dict(ranked)
        top = {p for p, _v in ranked[:pareto]}
        margins = {}
        if self._transport(ctx):
            margins = {r["key"]: r for r in self.env["eguitra.transport.rotation"].profitability(
                ctx.company, ctx.date_from, ctx.date_to, "client")}
        rows = []
        for partner in set(revenue) | set(opened):
            if not partner:
                continue
            records = by_partner.get(partner, [])
            weights = [r["amount"] for r in records]
            avg_late = stats.weighted_mean([r["days_late"] for r in records], weights) if records else None
            trend = self._late_trend(records)
            open_amount = opened.get(partner, 0.0)
            score = self._payment_score(avg_late, open_amount, overdue.get(partner, 0.0), trend["slope_days_per_month"])
            good = score is None or score >= GOOD_PAYER
            high = partner in top
            segment = ("strategiques" if good else "a_securiser") if high else ("a_developper" if good else "a_surveiller")
            ecl = sum(max(0.0, amount) * rates[b] for b, amount in aging.get(partner, {}).items())
            margin = margins.get(partner)
            rows.append({
                "id": partner, "name": names.get(partner, "?"), "revenue": revenue.get(partner, 0.0),
                "share_pct": _pct_of(revenue.get(partner, 0.0), total),
                "revenue_previous": previous.get(partner, 0.0),
                "growth_pct": stats.pct_change(revenue.get(partner, 0.0), previous.get(partner) or None),
                "margin": margin["margin"] if margin else None, "margin_rate": margin["margin_rate"] if margin else None,
                "avg_days_late": avg_late,
                "avg_days_to_pay": stats.weighted_mean([r["days_to_pay"] for r in records], weights) if records else None,
                "payment_score": score, "open": open_amount, "overdue": overdue.get(partner, 0.0), "ecl": ecl,
                "segment": segment, "segment_label": SEGMENTS[segment], "history_n": len(records),
                "trend": trend["label"],
            })
        rows.sort(key=lambda r: -(r["revenue"] or 0.0))
        quadrants = [{"key": key, "label": label, "count": sum(1 for r in rows if r["segment"] == key),
                      "revenue": sum(r["revenue"] for r in rows if r["segment"] == key),
                      "open": sum(r["open"] for r in rows if r["segment"] == key)} for key, label in SEGMENTS.items()]
        # Seuil de valeur : chiffre d'affaires du plus petit des clients qui font 80 % du total ; l'écran y
        # trace la frontière des quadrants, qui rejoint ainsi la segmentation.
        value_threshold = ranked[pareto - 1][1] if 0 < pareto <= len(ranked) else None
        return {"clients": rows, "quadrants": quadrants, "good_payer_score": GOOD_PAYER, "value_threshold": value_threshold,
                "method": "Valeur : clients qui font 80 % du chiffre d'affaires ; comportement : note de paiement "
                          "(retard moyen pondéré par les montants, part échue, tendance) ; sans historique ni "
                          "encours, réputé bon payeur."}

    def _client_behaviour(self, ctx, ranked, history, names):
        """Distribution des retards de paiement (factures réglées sur 24 mois) et tendance, pour les quinze
        premiers clients par chiffre d'affaires ayant un historique."""
        by_partner = {}
        for record in history:
            by_partner.setdefault(record["partner"], []).append(record)
        order = [p for p, _v in ranked if p in by_partner] + [p for p in by_partner if p and p not in dict(ranked)]
        rows = []
        for partner in order[:15]:
            records = by_partner[partner]
            lates = [r["days_late"] for r in records]
            bins = []
            for low, high, label in LATE_BINS:
                selected = [r for r in records if (low is None or r["days_late"] >= low - 0.5)
                            and (high is None or r["days_late"] < high + 0.5)]
                bins.append({"label": label, "count": len(selected), "amount": sum(r["amount"] for r in selected)})
            rows.append({"id": partner, "name": names.get(partner) or self._names("res.partner", [partner]).get(partner, "?"),
                         "n": len(records), "mean": stats.mean(lates), "median": stats.median(lates),
                         "p90": stats.quantile(lates, 0.9), "histogram": bins, "trend": self._late_trend(records)})
        return rows

    def _client_trends(self, ctx, partner_ids, names):
        """Chiffre d'affaires mensuel des dix premiers clients sur douze mois (petits multiples)."""
        months = _month_list(ctx.date_to, 12)
        keys = [_key(m) for m in months]
        if not partner_ids:
            return {"months": keys, "series": []}
        rows = self._rows(
            f"""SELECT to_char(date_trunc('month', aml.date), 'YYYY-MM'), COALESCE(rp.commercial_partner_id, aml.partner_id),
                       -SUM(aml.balance)
                  FROM account_move_line aml
                  JOIN account_account aa ON aa.id = aml.account_id
             LEFT JOIN res_partner rp ON rp.id = aml.partner_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aml.date BETWEEN %s AND %s
                   AND {ACC_CODE} LIKE '70%%' AND COALESCE(rp.commercial_partner_id, aml.partner_id) = ANY(%s)
              GROUP BY 1, 2""",
            (ctx.company.id, months[0], ctx.date_to, list(partner_ids)),
        )
        data = {}
        for month, partner, amount in rows:
            data.setdefault(partner, {})[month] = float(amount)
        return {"months": keys, "series": [
            {"key": f"client.{p}", "label": names.get(p, "?"), "unit": "gnf", "client_id": p,
             "values": [data.get(p, {}).get(k, 0.0) for k in keys]} for p in partner_ids]}

    def _client_insights(self, ctx, concentration, segments, ranked, previous, names):
        items = []
        hhi, top = concentration["hhi"], concentration["top_share"]
        limit = self._thresholds(ctx)["client_concentration_pct"]
        method = concentration["method"]
        if hhi is not None and ranked:
            first = top["first"]
            over_limit = bool(limit and first and first > limit)
            severity = "high" if hhi > 2500 or over_limit else "medium" if hhi > 1500 else None
            evidence = {"type": "bars", "data": {"clients": [{"name": names.get(p, "?"), "revenue": v}
                                                             for p, v in ranked[:10]]}}
            if severity:
                items.append(insight(
                    "clients.concentration", "clients", severity,
                    f"Le chiffre d'affaires dépend de {concentration['pareto_count']} client(s)",
                    f"{top['first_name']} pèse {pct(first)} du chiffre d'affaires de la période, les cinq premiers "
                    f"{pct(top['top5'])} ; indice HHI de {_num(hhi)} ("
                    + ("très concentré" if hhi > 2500 else "modérément concentré") + ")."
                    + (f" Le seuil de concentration fixé par la direction ({pct(limit, 0)}) est dépassé." if over_limit else ""),
                    metric=_metric("Part du premier client", first, "pct", limit, "Seuil de concentration"),
                    impact_gnf=ranked[0][1], confidence=0.9, method=method, evidence=evidence,
                    action="Sécuriser le premier client (contrat cadre, garanties de paiement) et développer de nouveaux "
                           "donneurs d'ordre pour ramener sa part sous le seuil.",
                    link="/analyse/clients"))
            elif hhi < 1500 and len(ranked) >= 5:
                items.append(insight(
                    "clients.diversifie", "clients", "positive", "Le portefeuille clients est diversifié",
                    f"Indice HHI de {_num(hhi)} ; le premier client pèse {pct(first)} du chiffre d'affaires.",
                    metric=_metric("HHI", hhi, "count", 1500, "Seuil de concentration modérée"), confidence=0.85,
                    method=method, evidence=evidence, link="/analyse/clients"))
        rows = segments["clients"]
        exposed = [r for r in rows if r["segment"] == "a_securiser" and r["open"] > 0.5]
        if exposed:
            amount = sum(r["open"] for r in exposed)
            items.append(insight(
                "clients.a_securiser", "clients", "high", f"{len(exposed)} client(s) majeur(s) paient mal",
                "Clients qui font l'essentiel du chiffre d'affaires mais paient en retard : "
                + ", ".join(f"{r['name']} (note {r['payment_score']}, retard moyen {_days(r['avg_days_late'])})"
                            for r in exposed[:3]) + f" ; encours de {gnf(amount)}.",
                metric=_metric("Encours exposé", amount, "gnf"), impact_gnf=amount, confidence=0.75,
                method=segments["method"],
                action="Conditionner les nouvelles livraisons à un échéancier signé, demander une garantie bancaire ou "
                       "un paiement d'avance.", link="/analyse/clients"))
        for row in rows:
            # Seul un client effectivement en retard (retard moyen positif) « paie de plus en plus tard ».
            if (row["trend"] == "Se dégrade" and row["segment"] in ("strategiques", "a_securiser") and row["open"] > 0.5
                    and (row["avg_days_late"] or 0) > 0):
                items.append(insight(
                    f"clients.retard_degradation.{row['id']}", "clients", "medium",
                    f"{row['name']} paie de plus en plus tard",
                    f"Le retard de paiement de ce client augmente nettement (tendance significative sur {row['history_n']} "
                    f"factures réglées) ; retard moyen de {_days(row['avg_days_late'])}, encours de {gnf(row['open'])}.",
                    metric=_metric("Retard moyen", row["avg_days_late"], "days", 0, "À l'échéance"),
                    impact_gnf=row["open"], confidence=0.7,
                    method="Régression du retard de paiement (jours) sur la date de règlement.",
                    action="Rencontrer le client avant que le retard ne s'installe : échéancier et relance anticipée.",
                    link=f"/analyse/clients?client={row['id']}"))
        ecl = sum(r["ecl"] for r in rows)
        receivables = sum(r["open"] for r in rows)
        result = self._pl(ctx, ctx.date_from, ctx.date_to)["XI"]
        if ecl > 0.5 and (ecl > 0.05 * receivables or (result > 0 and ecl > 0.10 * result)):
            items.append(insight(
                "clients.perte_attendue", "clients", "medium", f"Perte attendue sur créances de {gnf(ecl)}",
                f"Sur {gnf(receivables)} de créances ouvertes, la matrice d'ancienneté (IFRS 9) prévoit une perte de "
                f"{gnf(ecl)}" + (f", soit {pct(_pct_of(ecl, result))} du résultat net de la période." if result > 0 else "."),
                metric=_metric("Perte attendue", ecl, "gnf"), impact_gnf=ecl, confidence=0.7,
                method="Encours par tranche d'ancienneté × taux de perte de la matrice de la société.",
                action="Recouvrer en priorité les tranches les plus anciennes ; provisionner à la clôture.",
                link="/finance/relances"))
        for row in rows[:10]:
            before = row["revenue_previous"]
            if before and before > 0.05 * (concentration["revenue"] or 0) and (row["growth_pct"] or 0) <= -25:
                items.append(insight(
                    f"clients.recul.{row['id']}", "clients", "medium", f"Le chiffre d'affaires avec {row['name']} recule",
                    f"{gnf(row['revenue'])} sur la période contre {gnf(before)} un an plus tôt ({pct(row['growth_pct'])}).",
                    metric=_metric("Variation", row["growth_pct"], "pct", 0, "N-1"), impact_gnf=before - row["revenue"],
                    confidence=0.75, method="Chiffre d'affaires (comptes 70) du client, période comparée à N-1.",
                    action="Comprendre la baisse (prix, service, concurrence) avec le client et fixer un objectif de reprise.",
                    link=f"/analyse/clients?client={row['id']}"))
        good = [r for r in rows if r["payment_score"] is not None and r["payment_score"] >= 80 and r["revenue"]]
        share = _pct_of(sum(r["revenue"] for r in good), concentration["revenue"])
        if share and share >= 60:
            items.append(insight(
                "clients.bons_payeurs", "clients", "positive", f"{pct(share, 0)} du chiffre d'affaires vient de bons payeurs",
                f"{len(good)} client(s) ont une note de paiement d'au moins 80 sur 100.",
                metric=_metric("Part des bons payeurs", share, "pct"), confidence=0.7, method=segments["method"],
                link="/analyse/clients"))
        return items

    # ─── 5.5 Transport ────────────────────────────────────────────────────

    def _section_transport(self, ctx):
        tr = self._transport(ctx)
        empty = {"available": False, "heatmap": {"routes": [], "months": [], "cells": []}, "trucks": [],
                 "fuel_anomalies": [], "pricing": [], "shortages": {"drivers": [], "routes": [], "products": []},
                 "scatter": [], "indicators": None}
        if not tr:
            return empty, []
        report = tr["report"]
        th = self._thresholds(ctx)
        history_start = min(ctx.date_from, ctx.date_to - relativedelta(months=12) + timedelta(days=1))
        history = self._rotations(ctx, history_start, ctx.date_to)
        period = [r for r in history if r["date_loading"] >= ctx.date_from]
        capacities = {v.id: (v.capacity_liters or 0) / 1000 for v in self.env["eguitra.transport.vehicle"].with_context(
            active_test=False).search([("company_id", "=", ctx.company.id)])}
        per_km = report["structure"]["per_km"] or 0.0
        trucks = self._trucks(ctx, report, period)
        pricing = self._pricing(period, capacities, per_km, th["transport_margin_min"])
        anomalies = self._fuel_anomalies(ctx, history)
        blocks = {
            "available": True,
            "indicators": report["indicators"],
            "heatmap": self._route_heatmap(ctx, history),
            "trucks": trucks,
            "fuel_anomalies": anomalies,
            "pricing": pricing,
            "shortages": self._shortages(period),
            "scatter": [{
                "id": r["id"], "name": r["name"], "date": r["date_loading"], "km": r["distance_km"], "margin": r["margin"],
                "margin_rate": _pct_of(r["margin"], r["revenue"]), "volume": r["volume_delivered"] or r["volume_loaded"],
                "revenue": r["revenue"], "route": r["route_id"][1] if r["route_id"] else None,
                "truck": r["vehicle_id"][1] if r["vehicle_id"] else None,
            } for r in period[-1000:]],
        }
        items = self._transport_insights(ctx, tr, trucks, pricing, anomalies, blocks["shortages"])
        return blocks, items

    def _route_heatmap(self, ctx, history):
        """Routes × mois (douze mois au moins) : marge directe en % du montant facturable, nombre de rotations."""
        months = [_key(m) for m in _months_between(min(ctx.date_from, _month_list(ctx.date_to, 12)[0]), ctx.date_to)]
        cells, routes = {}, {}
        for r in history:
            if not r["route_id"]:
                continue
            route_id = r["route_id"][0]
            routes[route_id] = r["route_id"][1]
            cell = cells.setdefault((route_id, _key(r["date_loading"])), {"rotations": 0, "revenue": 0.0, "margin": 0.0})
            cell["rotations"] += 1
            cell["revenue"] += r["revenue"] or 0.0
            cell["margin"] += r["margin"] or 0.0
        return {
            "routes": [{"id": i, "name": n} for i, n in sorted(routes.items(), key=lambda x: x[1])],
            "months": months,
            "cells": [{"route_id": route_id, "month": month, "margin_pct": _pct_of(c["margin"], c["revenue"]),
                       "rotations": c["rotations"], "revenue": c["revenue"], "margin": c["margin"]}
                      for (route_id, month), c in sorted(cells.items()) if month in months],
        }

    def _trucks(self, ctx, report, period):
        """Par ensemble routier (rentabilité complète de eguitra.transport.analysis) : jours d'activité = somme
        des durées des rotations, taux d'utilisation = jours d'activité / jours de la période, rang par
        résultat net après structure."""
        days = {}
        for r in period:
            if r["vehicle_id"]:
                days[r["vehicle_id"][0]] = days.get(r["vehicle_id"][0], 0.0) + (r["duration_days"] or 0.0)
        rows = []
        for row in report["rows"]:
            active = days.get(row["key"], 0.0)
            rows.append({
                "id": row["key"], "name": row["label"], "rotations": row["rotations"], "km": row["km"],
                "volume": row["volume"], "revenue": row["revenue"], "direct_costs": row["declared_cost"],
                "margin": row["margin"], "margin_rate": row["margin_rate"], "revenue_per_km": row["revenue_per_km"],
                "cost_per_km": row["cost_per_km"], "fuel_per_100km": row["fuel_per_100km"], "days_active": active,
                "utilization_pct": min(100.0, active / ctx.days * 100), "structure": row["structure"],
                "net_result": row["net_result"], "booked_cost": row.get("booked_cost"),
            })
        rows.sort(key=lambda r: -(r["net_result"] or 0.0))
        for rank_, row in enumerate(rows, start=1):
            row["rank"] = rank_
        return rows

    def _fuel_anomalies(self, ctx, history):
        """Consommation anormale : L/100 km de chaque rotation de la période comparés (score robuste) aux
        rotations de la même route sur douze mois (cinq au moins, sinon toute la flotte) et à l'historique de
        l'ensemble (cinq rotations au moins) ; anomalie au-delà de 3,5. Litres en excès = (valeur - médiane de
        référence) × km / 100, valorisés au prix du litre de la rotation."""
        fueled = [r for r in history if (r["fuel_liters"] or 0) > 0 and (r["distance_km"] or 0) > 0]
        if len(fueled) < 5:
            return []
        for r in fueled:
            r["_l100"] = r["fuel_liters"] / r["distance_km"] * 100

        def scores(group):
            values = [r["_l100"] for r in group]
            return {r["id"]: z for r, z in zip(group, _anomaly_scores(values))}, stats.median(values)

        fleet_scores, fleet_median = scores(fueled)
        by_route, by_vehicle = {}, {}
        for r in fueled:
            by_route.setdefault(r["route_id"] and r["route_id"][0], []).append(r)
            by_vehicle.setdefault(r["vehicle_id"] and r["vehicle_id"][0], []).append(r)
        route_scores = {k: scores(g) for k, g in by_route.items() if len(g) >= 5}
        vehicle_scores = {k: scores(g) for k, g in by_vehicle.items() if len(g) >= 5}
        result = []
        for r in fueled:
            if r["date_loading"] < ctx.date_from:
                continue
            route_key = r["route_id"] and r["route_id"][0]
            vehicle_key = r["vehicle_id"] and r["vehicle_id"][0]
            candidates = []
            if route_key in route_scores:
                candidates.append(("route", route_scores[route_key][0][r["id"]], route_scores[route_key][1]))
            else:
                candidates.append(("flotte", fleet_scores[r["id"]], fleet_median))
            if vehicle_key in vehicle_scores:
                candidates.append(("historique", vehicle_scores[vehicle_key][0][r["id"]], vehicle_scores[vehicle_key][1]))
            basis, score, expected = max(candidates, key=lambda c: abs(c[1] or 0.0))
            if abs(score or 0.0) <= stats.OUTLIER_Z:
                continue
            excess = max(0.0, r["_l100"] - expected) * r["distance_km"] / 100
            price = r["fuel_cost"] / r["fuel_liters"] if r["fuel_cost"] and r["fuel_liters"] else 0.0
            result.append({
                "rotation": r["name"], "rotation_id": r["id"], "date": r["date_loading"],
                "truck": r["vehicle_id"][1] if r["vehicle_id"] else None,
                "route": r["route_id"][1] if r["route_id"] else None, "value": r["_l100"], "expected": expected,
                "score": score, "basis": basis, "excess_liters": excess, "excess_cost": excess * price,
            })
        return sorted(result, key=lambda a: -abs(a["score"]))

    def _pricing(self, period, capacities, per_km, target_margin):
        """Par route : tarif moyen pratiqué (montant facturable / m³ facturés) ; coût complet d'une rotation =
        coûts déclarés nets des taxes refacturées + structure au km × km ; point mort = coût complet / m³ moyen
        d'une rotation ; coût au m³ à pleine charge = coût complet / capacité moyenne des citernes ; tarif cible
        = point mort / (1 - marge cible)."""
        routes = {}
        for r in period:
            if not r["route_id"]:
                continue
            entry = routes.setdefault(r["route_id"][0], {"id": r["route_id"][0], "name": r["route_id"][1], "rotations": 0,
                                                          "volume": 0.0, "revenue": 0.0, "cost": 0.0, "km": 0.0,
                                                          "capacity": 0.0, "margin": 0.0})
            entry["rotations"] += 1
            entry["volume"] += r["volume_delivered"] or r["volume_loaded"] or 0.0
            entry["revenue"] += r["revenue"] or 0.0
            entry["cost"] += (r["total_cost"] or 0.0) + (r["shortage_net_cost"] or 0.0) - (r["taxes_rebilled"] or 0.0)
            entry["km"] += r["distance_km"] or 0.0
            entry["capacity"] += capacities.get(r["vehicle_id"][0], 0.0) if r["vehicle_id"] else 0.0
            entry["margin"] += r["margin"] or 0.0
        rows = []
        target = (target_margin or 0.0) / 100
        for e in routes.values():
            n = e["rotations"]
            full_cost = (e["cost"] + per_km * e["km"]) / n
            load = e["volume"] / n if n else 0.0
            capacity = e["capacity"] / n if n else 0.0
            rate = e["revenue"] / e["volume"] if e["volume"] else None
            breakeven = full_cost / load if load else None
            target_rate = breakeven / (1 - target) if breakeven is not None and target < 1 else None
            net = e["margin"] - per_km * e["km"]
            if rate is None or breakeven is None:
                advice = "Volumes non renseignés : tarif non analysable."
            elif rate < breakeven:
                advice = (f"Sous le point mort : relever le tarif d'au moins {_num(breakeven - rate)} GNF/m³ "
                          f"(cible {_num(target_rate)} GNF/m³) ou mieux charger les citernes "
                          f"(taux de chargement {pct(_pct_of(load, capacity), 0)}).")
            elif target_rate and rate < target_rate:
                advice = f"Sous la marge cible : relever le tarif de {_num(target_rate - rate)} GNF/m³."
            else:
                advice = "Tarif au-dessus de la cible."
            rows.append({
                "id": e["id"], "name": e["name"], "rotations": n, "volume": e["volume"], "revenue": e["revenue"],
                "avg_rate": rate, "full_cost_per_rotation": full_cost, "avg_load": load,
                "load_factor_pct": _pct_of(load, capacity), "full_cost_per_m3_full_load": full_cost / capacity if capacity else None,
                "breakeven_rate": breakeven, "target_margin_pct": target_margin, "target_rate": target_rate,
                "gap": rate - target_rate if rate is not None and target_rate is not None else None,
                "gap_pct": _pct_of(rate - target_rate, target_rate) if rate is not None and target_rate else None,
                "margin": e["margin"], "margin_rate": _pct_of(e["margin"], e["revenue"]), "structure": per_km * e["km"],
                "net_result": net, "recommendation": advice,
            })
        return sorted(rows, key=lambda r: (r["gap_pct"] is None, r["gap_pct"] or 0.0))

    @staticmethod
    def _shortages(period):
        """Manquants par chauffeur, route et produit : volume manquant, part du chargé, part hors tolérance
        (manquant excédentaire / manquant), valeur et coût net (définitions des rotations)."""
        def group(field):
            rows = {}
            for r in period:
                key = r[field][0] if r[field] else None
                entry = rows.setdefault(key, {"id": key, "name": r[field][1] if r[field] else "Non renseigné",
                                              "rotations": 0, "loaded": 0.0, "shortage": 0.0, "excess": 0.0,
                                              "value": 0.0, "net_cost": 0.0, "excess_rotations": 0})
                entry["rotations"] += 1
                entry["loaded"] += r["volume_loaded"] or 0.0
                entry["shortage"] += r["shortage"] or 0.0
                entry["excess"] += r["shortage_excess"] or 0.0
                entry["value"] += r["shortage_value"] or 0.0
                entry["net_cost"] += r["shortage_net_cost"] or 0.0
                entry["excess_rotations"] += 1 if (r["shortage_excess"] or 0) > 0 else 0
            result = []
            for entry in rows.values():
                entry["rate_pct"] = _pct_of(entry["shortage"], entry["loaded"])
                entry["out_of_tolerance_pct"] = _pct_of(entry["excess"], entry["shortage"])
                result.append(entry)
            return sorted(result, key=lambda e: -e["value"])
        return {"drivers": group("driver_id"), "routes": group("route_id"), "products": group("product_id")}

    def _transport_insights(self, ctx, tr, trucks, pricing, anomalies, shortages):
        items = []
        th = self._thresholds(ctx)
        target = th["transport_margin_min"]
        for row in pricing:
            if row["margin"] < 0 or row["net_result"] < 0:
                direct = row["margin"] < 0
                items.append(insight(
                    f"transport.route_marge_negative.{row['id']}", "transport", "critical" if direct else "high",
                    f"La route {row['name']} perd de l'argent",
                    f"Sur la période, {row['rotations']} rotation(s) ont dégagé une marge directe de "
                    f"{pct(row['margin_rate'])}" + ("" if direct else
                                                    f", ramenée à {gnf(row['net_result'])} après charges de structure")
                    + f". Tarif moyen de {_num(row['avg_rate'])} GNF/m³ pour un point mort de {_num(row['breakeven_rate'])} "
                      "GNF/m³.",
                    metric=_metric("Marge", row["margin_rate"], "pct", target, "Seuil"),
                    impact_gnf=-(row["margin"] if direct else row["net_result"]), confidence=_confidence(row["rotations"], 12),
                    method="Marge directe par route (rotations validées), structure au km de la rentabilité du transport, "
                           "point mort = coût complet d'une rotation / m³ moyen.",
                    evidence={"type": "table", "data": {"route": row}}, action=row["recommendation"],
                    link=f"/analyse/transport?route={row['id']}"))
            elif row["target_rate"] and row["avg_rate"] is not None and row["avg_rate"] < row["target_rate"]:
                items.append(insight(
                    f"transport.route_sous_cible.{row['id']}", "transport", "medium",
                    f"La route {row['name']} est sous la marge cible",
                    f"Tarif moyen de {_num(row['avg_rate'])} GNF/m³ pour un tarif cible de {_num(row['target_rate'])} "
                    f"GNF/m³ (marge de {pct(target, 0)} sur le coût complet) ; marge directe de {pct(row['margin_rate'])}.",
                    metric=_metric("Tarif moyen", row["avg_rate"], "gnf", row["target_rate"], "Tarif cible"),
                    impact_gnf=(row["target_rate"] - row["avg_rate"]) * row["volume"],
                    confidence=_confidence(row["rotations"], 12), method="Tarif cible = point mort / (1 - marge cible).",
                    action=row["recommendation"], link=f"/analyse/transport?route={row['id']}"))
        for row in trucks:
            if row["rotations"] and row["net_result"] < 0:
                items.append(insight(
                    f"transport.ensemble_deficitaire.{row['id']}", "transport", "high",
                    f"L'ensemble {row['name']} est déficitaire après structure",
                    f"{row['rotations']} rotation(s), {_num(row['km'])} km, marge directe de {gnf(row['margin'])} mais "
                    f"résultat net de {gnf(row['net_result'])} une fois sa part de structure absorbée ; taux "
                    f"d'utilisation de {pct(row['utilization_pct'], 0)}.",
                    metric=_metric("Résultat net", row["net_result"], "gnf", 0, "Équilibre"), impact_gnf=-row["net_result"],
                    confidence=_confidence(row["rotations"], 12),
                    method="Rentabilité complète du transport : marge directe - structure au km × km.",
                    action="Réaffecter l'ensemble sur des routes rentables, revoir son tarif ou étudier sa cession.",
                    link=f"/analyse/transport?ensemble={row['id']}"))
            elif row["rotations"] and row["utilization_pct"] < 40 and row["structure"]:
                items.append(insight(
                    f"transport.sous_utilisation.{row['id']}", "transport", "medium",
                    f"L'ensemble {row['name']} roule peu",
                    f"{_num(row['days_active'])} jours en rotation sur {ctx.days} ({pct(row['utilization_pct'], 0)}) : "
                    f"ses charges de structure ({gnf(row['structure'])}) pèsent sur peu de kilomètres.",
                    metric=_metric("Utilisation", row["utilization_pct"], "pct", 60, "Repère"),
                    impact_gnf=row["structure"], confidence=0.6,
                    method="Jours d'activité (durée des rotations) / jours de la période.",
                    action="Planifier davantage de rotations sur cet ensemble ou réduire la flotte.",
                    link=f"/analyse/transport?ensemble={row['id']}"))
        over = [a for a in anomalies if a["score"] > 0]
        if over:
            cost = sum(a["excess_cost"] for a in over)
            liters = sum(a["excess_liters"] for a in over)
            worst = over[0]
            items.append(insight(
                "transport.consommation_anormale", "transport", "high",
                f"{len(over)} rotation(s) à consommation anormale",
                f"{_num(liters)} litres au-delà de la consommation habituelle, soit {gnf(cost)}. Écart le plus net : "
                f"rotation {worst['rotation']} ({worst['truck']}, {worst['route']}) à {_num(worst['value'], 1)} L/100 km "
                f"pour {_num(worst['expected'], 1)} attendus.",
                metric=_metric("Litres en excès", liters, "liters"), impact_gnf=cost, confidence=0.75,
                method="Score robuste de la consommation (L/100 km) face à la même route et à l'historique de l'ensemble ; "
                       "anomalie au-delà de 3,5.",
                evidence={"type": "table", "data": {"rotations": over[:10]}},
                action="Contrôler les bons de carburant et le kilométrage de ces rotations, puis l'état mécanique des "
                       "ensembles concernés.", link="/analyse/transport#consommation"))
        drivers = [d for d in shortages["drivers"] if d["value"] > 0.5 and d["id"]]
        if drivers:
            value = sum(d["value"] for d in drivers)
            items.append(insight(
                "transport.manquants", "transport", "medium", f"Manquants hors tolérance : {gnf(value)}",
                "Chauffeurs concernés : " + ", ".join(f"{d['name']} ({_num(d['excess'], 3)} m³, {gnf(d['value'])})"
                                                      for d in drivers[:3]) + ".",
                metric=_metric("Valeur des manquants", value, "gnf"), impact_gnf=value, confidence=0.85,
                method="Manquant excédentaire (au-delà de la tolérance) valorisé au prix du m³ de la rotation.",
                action="Appliquer la règle de reprise sur les chauffeurs et vérifier les jaugeages au chargement.",
                link="/transport/manquants"))
        unbilled = (tr["kpis"] or {}).get("unbilled") or {}
        late = [u for u in unbilled.get("items", []) if u["date"] and u["date"] <= ctx.date_to - timedelta(days=30)]
        if late:
            amount = sum(u["revenue"] for u in late)
            items.append(insight(
                "transport.non_facture", "transport", "high", f"{len(late)} rotation(s) livrée(s) non facturée(s)",
                f"{gnf(amount)} de prestations validées depuis plus de 30 jours attendent leur facture.",
                metric=_metric("Non facturé", amount, "gnf"), impact_gnf=amount, confidence=0.95,
                method="Rotations validées non facturées, livrées depuis plus de 30 jours.",
                action="Facturer ces rotations : le produit est acquis, la créance et l'encaissement attendent.",
                link="/transport/rotations"))
        best = max((r for r in pricing if r["revenue"] and r["margin_rate"] is not None), key=lambda r: r["margin_rate"],
                   default=None)
        if best and best["margin_rate"] > 0 and (not target or best["margin_rate"] >= target):
            items.append(insight(
                f"transport.meilleure_route.{best['id']}", "transport", "positive",
                f"La route {best['name']} est la plus rentable",
                f"Marge directe de {pct(best['margin_rate'])} sur {best['rotations']} rotation(s), tarif moyen de "
                f"{_num(best['avg_rate'])} GNF/m³.", metric=_metric("Marge", best["margin_rate"], "pct", target, "Seuil"),
                confidence=_confidence(best["rotations"], 12), method="Marge directe par route.",
                link=f"/analyse/transport?route={best['id']}"))
        return items

    # ─── 5.6 Dépenses ─────────────────────────────────────────────────────

    def _expense_lines(self, ctx, start, end):
        """Lignes de charges (classe 6) comptabilisées : pièce, tiers (société mère), catégorie de dépense,
        compte, répartition analytique, montant."""
        def load():
            return self._rows(
                f"""SELECT aml.id, aml.move_id, am.name, am.move_type, aml.date,
                           COALESCE(rp.commercial_partner_id, aml.partner_id), aml.eguitra_expense_category_id,
                           {ACC_CODE}, aml.analytic_distribution, aml.balance, aml.name
                      FROM account_move_line aml
                      JOIN account_account aa ON aa.id = aml.account_id
                      JOIN account_move am ON am.id = aml.move_id
                 LEFT JOIN res_partner rp ON rp.id = aml.partner_id
                     WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aml.date BETWEEN %s AND %s
                       AND {ACC_CODE} LIKE '6%%' AND aml.balance != 0""",
                (ctx.company.id, start, end),
            )
        return ctx.get(("expenses", start, end), load)

    def _category_labels(self, ids):
        return {c.id: c.name for c in self.env["eguitra.expense.category"].with_context(active_test=False).browse(
            [i for i in ids if i]).exists()}

    @staticmethod
    def _category_key(category_id, code):
        return f"cat.{category_id}" if category_id else f"acc.{(code or '6')[:2]}"

    def _section_depenses(self, ctx):
        history_start = min(ctx.date_from, ctx.date_to - relativedelta(months=12) + timedelta(days=1))
        lines = self._expense_lines(ctx, history_start, ctx.date_to)
        period = [row for row in lines if row[4] >= ctx.date_from]
        labels = self._category_labels({row[6] for row in lines})

        def label(key):
            kind, ref = key.split(".", 1)
            return labels.get(int(ref), "?") if kind == "cat" else RUBRICS.get(ref, f"Comptes {ref}")

        cube = self._expense_cube(ctx, period, label)
        suppliers = self._suppliers(ctx, period, label)
        amounts = [abs(float(v)) for (v,) in self._rows(
            """SELECT am.amount_untaxed_signed FROM account_move am
                WHERE am.state = 'posted' AND am.company_id = %s AND am.move_type = 'in_invoice'
                  AND am.date BETWEEN %s AND %s""", (ctx.company.id, ctx.date_from, ctx.date_to))]
        amounts += [float(row[9]) for row in period if row[3] == "entry" and float(row[9]) > 0]
        first = benford.first_digits(amounts)
        second = benford.first_two_digits(amounts)
        blocks = {
            "cube": cube,
            "suppliers": suppliers,
            "benford": dict(first, first_two={k: second[k] for k in ("n", "digits", "mad", "conformity",
                                                                       "conformity_label", "suspicious", "warning")},
                            population="Factures fournisseurs (montant hors taxes) et charges des opérations diverses, "
                                       "de banque et de caisse de la période, d'au moins 1 000 GNF."),
            "duplicates": self._duplicates(ctx),
            "outliers": self._expense_outliers(ctx, lines, label),
        }
        return blocks, self._expense_insights(ctx, blocks)

    def _expense_cube(self, ctx, period, label):
        """Dépenses de la période par catégorie (catégorie de dépense, à défaut rubrique du compte) × activité
        (part de la répartition analytique sur l'axe Activité, le reste en « Non affecté ») × mois."""
        acts = self._activities(ctx) or {"ids": set(), "names": {}}
        months = [_key(m) for m in _months_between(ctx.date_from, ctx.date_to)]
        cells, categories, activities = {}, {}, {}
        for row in period:
            key = self._category_key(row[6], row[7])
            amount = float(row[9])
            month = _key(row[4])
            shares = {a: s for a, s in account_shares(row[8]).items() if a in acts["ids"]}
            assigned = 0.0
            parts = []
            for account_id, share in shares.items():
                part = amount * min(100.0, share) / 100
                parts.append((account_id, part))
                assigned += part
            if abs(amount - assigned) > 0.005:
                parts.append((None, amount - assigned))
            for account_id, part in parts:
                cell = (key, account_id, month)
                cells[cell] = cells.get(cell, 0.0) + part
                categories[key] = categories.get(key, 0.0) + part
                activities[account_id] = activities.get(account_id, 0.0) + part
        return {
            "months": months,
            "categories": sorted(({"key": k, "label": label(k), "total": v} for k, v in categories.items()),
                                 key=lambda c: -c["total"]),
            "activities": sorted(({"id": a, "name": acts["names"].get(a, "Non affecté") if a else "Non affecté",
                                   "total": v} for a, v in activities.items()), key=lambda a: -a["total"]),
            "cells": [{"category": k, "activity": a, "month": m, "amount": v} for (k, a, m), v in sorted(
                cells.items(), key=lambda kv: (kv[0][0], kv[0][1] or 0, kv[0][2]))],
            "total": sum(categories.values()),
        }

    def _suppliers(self, ctx, period, label):
        """Concentration des fournisseurs (charges de la période par tiers : Pareto, HHI) et dérive des
        dépenses par catégorie : montant moyen mensuel de la période face aux mêmes mois de N-1, pente de la
        régression des montants mensuels sur douze mois."""
        spend = {}
        for row in period:
            if row[5]:
                spend[row[5]] = spend.get(row[5], 0.0) + float(row[9])
        ranked = sorted(((p, v) for p, v in spend.items() if v > 0), key=lambda pv: -pv[1])
        total = sum(v for _p, v in ranked)
        names = self._names("res.partner", [p for p, _v in ranked[:30]])
        cumulative, pareto = 0.0, []
        for partner, amount in ranked[:30]:
            cumulative += amount
            pareto.append({"id": partner, "name": names.get(partner, "?"), "amount": amount,
                           "share_pct": _pct_of(amount, total), "cumulative_pct": _pct_of(cumulative, total)})
        months = _months_between(ctx.date_from, ctx.date_to)
        previous = {}
        for category_id, prefix, amount in self._rows(
            f"""SELECT aml.eguitra_expense_category_id, LEFT({ACC_CODE}, 2), COALESCE(SUM(aml.balance), 0)
                  FROM account_move_line aml JOIN account_account aa ON aa.id = aml.account_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aml.date BETWEEN %s AND %s
                   AND {ACC_CODE} LIKE '6%%'
              GROUP BY 1, 2""",
            (ctx.company.id, ctx.prev_from, ctx.prev_to),
        ):
            key = self._category_key(category_id, prefix)
            previous[key] = previous.get(key, 0.0) + float(amount)
        current, monthly = {}, {}
        twelve = [_key(m) for m in _month_list(ctx.date_to, 12)]
        for row in self._expense_lines(ctx, min(ctx.date_from, ctx.date_to - relativedelta(months=12) + timedelta(days=1)),
                                       ctx.date_to):
            key = self._category_key(row[6], row[7])
            if row[4] >= ctx.date_from:
                current[key] = current.get(key, 0.0) + float(row[9])
            month = _key(row[4])
            if month in twelve:
                monthly.setdefault(key, dict.fromkeys(twelve, 0.0))[month] += float(row[9])
        drift = []
        for key, amount in current.items():
            avg, avg_prev = amount / len(months), previous.get(key, 0.0) / len(months)
            series = [monthly.get(key, {}).get(m, 0.0) for m in twelve]
            fit = stats.linear_regression(list(range(12)), series)
            mean = stats.mean(series)
            drift.append({
                "category": key, "label": label(key), "monthly_avg": avg, "monthly_avg_previous": avg_prev,
                "drift_pct": stats.pct_change(avg, avg_prev or None),
                "slope_pct_per_month": _pct_of(fit["slope"], mean) if fit["slope"] is not None and mean else None,
                "r2": fit["r2"], "monthly": series,
            })
        drift.sort(key=lambda d: -(d["monthly_avg"] or 0.0))
        values = [v for _p, v in ranked]
        return {
            "pareto": pareto, "pareto_count": stats.pareto_count(values), "hhi": stats.hhi(values), "suppliers": len(values),
            "total": total, "top_share": _pct_of(values[0], total) if values else None, "drift": drift, "months": twelve,
        }

    def _duplicates(self, ctx):
        """Factures fournisseurs suspectes de doublon (au moins une dans la période, l'autre jusqu'à 30 jours
        avant) : même fournisseur et même référence (score 100), ou même fournisseur, montant TTC à 1 % près
        et dates à moins de 30 jours (score de 40 à 100 : 30 points pour l'égalité des montants, 30 pour la
        proximité des dates) ; un montant que le fournisseur facture au moins trois fois, à un mois d'écart,
        relève d'une facturation récurrente (score ramené à 45)."""
        rows = self._rows(
            """SELECT am.id, am.name, am.ref, COALESCE(am.invoice_date, am.date), am.commercial_partner_id,
                      ABS(am.amount_total_signed)
                 FROM account_move am
                WHERE am.state = 'posted' AND am.company_id = %s AND am.move_type = 'in_invoice'
                  AND COALESCE(am.invoice_date, am.date) BETWEEN %s AND %s""",
            (ctx.company.id, ctx.date_from - timedelta(days=30), ctx.date_to),
        )
        by_partner = {}
        for move_id, name, ref, day, partner, amount in rows:
            by_partner.setdefault(partner, []).append(
                {"id": move_id, "name": name, "ref": ref or None, "date": day, "amount": float(amount)})
        names = self._names("res.partner", list(by_partner))
        pairs = []
        for partner, bills in by_partner.items():
            bills.sort(key=lambda b: (b["date"], b["id"]))
            found = {}
            by_ref = {}
            for bill in bills:
                if _normalize_ref(bill["ref"]):
                    by_ref.setdefault(_normalize_ref(bill["ref"]), []).append(bill)
            for group in by_ref.values():
                for i, a in enumerate(group):
                    for b in group[i + 1:]:
                        found[(a["id"], b["id"])] = [100.0, ["même référence fournisseur"], a, b]
            repeats = {}
            for bill in bills:
                repeats[round(bill["amount"])] = repeats.get(round(bill["amount"]), 0) + 1
            for i, a in enumerate(bills):
                for b in bills[i + 1:]:
                    days = (b["date"] - a["date"]).days
                    if days > 30:
                        break
                    relative = abs(a["amount"] - b["amount"]) / (max(a["amount"], b["amount"]) or 1.0)
                    if relative <= 0.01:
                        score = 40 + 30 * (1 - relative / 0.01) + 30 * (1 - days / 30)
                        reasons = ["montant identique" if relative < 1e-9 else "montant à moins de 1 %",
                                   f"{days} jour(s) d'écart"]
                        # Même montant facturé chaque mois (loyer, contrat de carburant) : récurrence probable.
                        if days >= 25 and repeats.get(round(a["amount"]), 0) >= 3:
                            score = min(score, 45.0)
                            reasons.append("facturation mensuelle récurrente probable")
                        entry = found.setdefault((a["id"], b["id"]), [0.0, [], a, b])
                        entry[0] = max(entry[0], score)
                        entry[1] += reasons
            for score, reasons, a, b in found.values():
                if a["date"] < ctx.date_from and b["date"] < ctx.date_from:
                    continue
                pairs.append({"partner": names.get(partner, "?"), "partner_id": partner, "a": a, "b": b,
                              "score": round(score), "reasons": reasons, "amount_at_risk": min(a["amount"], b["amount"])})
        return sorted(pairs, key=lambda p: (-p["score"], -p["amount_at_risk"]))[:50]

    def _expense_outliers(self, ctx, lines, label):
        """Montants inhabituels : score robuste du logarithme du montant de chaque ligne de la période face
        aux lignes de la même catégorie sur douze mois (huit lignes au moins) ; au-delà de 3,5. Le logarithme
        neutralise l'asymétrie des montants de dépenses (loi log-normale)."""
        groups = {}
        for row in lines:
            if float(row[9]) > 0:
                groups.setdefault(self._category_key(row[6], row[7]), []).append(row)
        names = self._names("res.partner", list({row[5] for row in lines if row[5]}))
        result = []
        for key, rows in groups.items():
            if len(rows) < 8:
                continue
            logs = [math.log10(float(r[9])) for r in rows]
            median = 10 ** stats.median(logs)
            for row, z in zip(rows, _anomaly_scores(logs)):
                if row[4] >= ctx.date_from and (z or 0.0) > stats.OUTLIER_Z:
                    result.append({"line_id": row[0], "move_id": row[1], "move": row[2], "date": row[4],
                                   "partner": names.get(row[5]), "category": key, "category_label": label(key),
                                   "label": row[10], "amount": float(row[9]), "median": median, "score": z})
        return sorted(result, key=lambda r: -r["score"])[:30]

    def _expense_insights(self, ctx, blocks):
        items = []
        duplicates = [d for d in blocks["duplicates"] if d["score"] >= 80]
        if duplicates:
            amount = sum(d["amount_at_risk"] for d in duplicates)
            top = duplicates[0]
            items.append(insight(
                "depenses.doublons", "depenses", "high", f"{len(duplicates)} facture(s) fournisseur suspecte(s) de doublon",
                f"{gnf(amount)} en jeu. Exemple : {top['a']['name']} et {top['b']['name']} de {top['partner']} "
                f"({', '.join(top['reasons'])}).", metric=_metric("Montant en jeu", amount, "gnf"), impact_gnf=amount,
                confidence=0.8, method="Même fournisseur et même référence, ou montant à 1 % près à moins de 30 jours.",
                evidence={"type": "table", "data": {"pairs": duplicates[:10]}},
                action="Vérifier ces factures avant tout règlement ; annuler par avoir celles qui font double emploi.",
                link="/analyse/depenses#doublons"))
        test = blocks["benford"]
        if test["n"] >= 100 and test["conformity"] in ("marginal", "nonconformity"):
            digits = ", ".join(str(d) for d in test["suspicious"]) or "aucun en particulier"
            items.append(insight(
                "depenses.benford", "depenses", "medium" if test["conformity"] == "nonconformity" else "info",
                "La distribution des montants s'écarte de la loi de Benford",
                f"Sur {test['n']} montants, l'écart absolu moyen atteint {_num(test['mad'], 4)} ({test['conformity_label'].lower()}) ;"
                f" premiers chiffres en excès : {digits}.",
                metric=_metric("MAD", test["mad"], "ratio", 0.012, "Limite acceptable"),
                confidence=_confidence(test["n"], 1000, 0.5, 0.9),
                method="Test du premier chiffre (Nigrini) : MAD et seuils 0,006 / 0,012 / 0,015, z par chiffre.",
                evidence={"type": "bars", "data": {"digits": test["digits"]}},
                action="Contrôler par sondage les pièces dont le montant commence par les chiffres en excès (seuils "
                       "d'approbation contournés, montants arrondis, fractionnement).", link="/analyse/depenses#benford"))
        elif test["n"] >= 100 and test["conformity"] == "close" and not duplicates:
            items.append(insight(
                "depenses.benford_conforme", "depenses", "positive", "Les montants de dépenses paraissent naturels",
                f"Sur {test['n']} montants, la distribution des premiers chiffres suit la loi de Benford (MAD de "
                f"{_num(test['mad'], 4)}) et aucun doublon probable n'est détecté.",
                metric=_metric("MAD", test["mad"], "ratio", 0.006, "Conformité proche"), confidence=0.7,
                method="Test du premier chiffre (Nigrini).", link="/analyse/depenses#benford"))
        outliers = blocks["outliers"]
        if outliers:
            excess = sum(o["amount"] - o["median"] for o in outliers)
            items.append(insight(
                "depenses.montants_inhabituels", "depenses", "medium", f"{len(outliers)} dépense(s) d'un montant inhabituel",
                "La plus nette : " + f"{outliers[0]['move']} ({outliers[0]['category_label']}), {gnf(outliers[0]['amount'])} "
                f"pour un montant habituel de {gnf(outliers[0]['median'])}.",
                metric=_metric("Écart cumulé", excess, "gnf"), impact_gnf=excess, confidence=0.6,
                method="Score robuste du logarithme des montants par catégorie (12 mois), au-delà de 3,5.",
                evidence={"type": "table", "data": {"lines": outliers[:10]}},
                action="Faire justifier ces dépenses par leur service (bon de commande, contrat, pièce).",
                link="/analyse/depenses#inhabituels"))
        suppliers = blocks["suppliers"]
        if suppliers["top_share"] and suppliers["top_share"] >= 40 and suppliers["suppliers"] >= 3:
            first = suppliers["pareto"][0]
            items.append(insight(
                "depenses.dependance_fournisseur", "depenses", "medium",
                f"{first['name']} concentre {pct(first['share_pct'], 0)} des dépenses",
                f"{gnf(first['amount'])} sur {gnf(suppliers['total'])} de charges de la période attribuées à des tiers.",
                metric=_metric("Part du premier fournisseur", first["share_pct"], "pct", 40, "Repère"),
                impact_gnf=first["amount"], confidence=0.8, method="Charges de la période par fournisseur (Pareto).",
                action="Mettre ce fournisseur en concurrence ou négocier un contrat cadre (prix, délais, pénalités).",
                link="/analyse/depenses"))
        for row in suppliers["drift"]:
            if row["drift_pct"] is not None and row["drift_pct"] >= 15 and row["monthly_avg_previous"] > 0 \
                    and row["monthly_avg"] >= 0.05 * (blocks["cube"]["total"] or 1) / max(1, len(blocks["cube"]["months"])):
                extra = (row["monthly_avg"] - row["monthly_avg_previous"]) * len(blocks["cube"]["months"])
                items.append(insight(
                    f"depenses.derive.{row['category']}", "depenses", "medium",
                    f"« {row['label']} » augmente de {pct(row['drift_pct'], 0)} sur un an",
                    f"{gnf(row['monthly_avg'])} par mois en moyenne contre {gnf(row['monthly_avg_previous'])} sur les mêmes "
                    "mois de l'an dernier.", metric=_metric("Variation", row["drift_pct"], "pct", 0, "N-1"),
                    impact_gnf=extra, confidence=0.7,
                    method="Montant moyen mensuel de la catégorie, période comparée aux mêmes mois de N-1.",
                    evidence={"type": "series", "data": {"months": suppliers["months"], "values": row["monthly"]}},
                    action="Identifier la cause (prix unitaires, volumes, nouvelles dépenses) avec le responsable du poste.",
                    link="/analyse/depenses"))
        return items

    # ─── 5.7 Prévisions ───────────────────────────────────────────────────

    def _section_previsions(self, ctx):
        metrics = self._metrics()
        fy_start, fy_end = metrics.fiscal_year_bounds(ctx.company, ctx.date_to)
        monthly = self._monthly_pl(ctx, 36)
        keys = list(monthly)
        last_complete = len(keys) if ctx.month_complete else len(keys) - 1
        history_keys = keys[:last_complete]
        first_active = next((i for i, k in enumerate(history_keys)
                             if monthly[k]["XB"] or monthly[k]["XD"]), len(history_keys))
        history_keys = history_keys[first_active:]
        # Mois prévus : du premier mois non complet (celui de la date d'arrêté s'il est entamé) à la fin de
        # l'exercice ; la série prévue prolonge ainsi exactement l'historique des mois complets.
        first_forecast = ctx.date_to.replace(day=1) + relativedelta(months=1 if ctx.month_complete else 0)
        remaining = [_key(m) for m in _months_between(first_forecast, fy_end)]
        current_key = None if ctx.month_complete else keys[-1]
        prev_fy = self._pl(ctx, fy_start - relativedelta(years=1), fy_start - timedelta(days=1))
        results, landing = {}, {"fiscal_year": {"date_from": fy_start, "date_to": fy_end},
                                "months_remaining": len(remaining)}
        for code, key, label, nonnegative in (("XB", "revenue", "Chiffre d'affaires", True),
                                              ("XD", "ebe", "Excédent brut d'exploitation", False)):
            values = [monthly[k][code] for k in history_keys]
            fc = forecast.forecast_series(values, len(remaining))
            # Sans historique (société nouvelle), aucune prévision : zéro et bornes absentes.
            points = list(fc["forecast"]) or [0.0] * len(remaining)
            lows = fc["low"] or [None] * len(remaining)
            highs = fc["high"] or [None] * len(remaining)
            if current_key and current_key in remaining:
                i = remaining.index(current_key)
                actual = monthly[current_key][code]
                if nonnegative and actual > points[i]:
                    points[i] = actual
            rows = [{"month": k, "actual": monthly[k][code], "forecast": None, "low": None, "high": None}
                    for k in history_keys[-24:]]
            for i, k in enumerate(remaining):
                rows.append({"month": k, "actual": monthly[k][code] if k == current_key else None,
                             "forecast": points[i], "low": lows[i], "high": highs[i]})
            fy_actual_keys = [k for k in history_keys if k >= _key(fy_start)]
            actual = sum(monthly[k][code] for k in fy_actual_keys)
            budget = self._budget_amount(ctx, key, fy_start, fy_end)
            spread = forecast.total_distribution([actual], points, fc["residuals"], nonnegative=nonnegative)
            results[key] = {"label": label, "series": rows, "method": fc["method"], "mape": fc["mape"],
                            "params": fc["params"], "history_months": len(values), "cusum": forecast.cusum(values)}
            landing[key] = {
                "actual_to_date": actual, "forecast_remaining": sum(points), "estimate": actual + sum(points),
                "low": spread["p10"], "high": spread["p90"], "budget": budget,
                "probability_pct": (forecast.probability_reach([actual], points, budget, fc["residuals"],
                                                               nonnegative=nonnegative) * 100
                                    if budget is not None else None),
                "previous_year": prev_fy[code], "vs_previous_pct": stats.pct_change(actual + sum(points), prev_fy[code]),
            }
        blocks = {
            "revenue": results["revenue"], "ebe": results["ebe"], "landing": landing,
            "sensitivities": None, "sensitivity_base": None,
            "method": "Holt-Winters additif (24 mois et plus), sinon Holt amorti, sinon naïf ; paramètres par grille sur les "
                      "erreurs à un pas ; intervalles à 80 % ; probabilité d'atteindre le budget par Monte-Carlo "
                      "(1 000 tirages des erreurs observées).",
        }
        blocks["sensitivities"], blocks["sensitivity_base"] = self._sensitivities(ctx)
        return blocks, self._forecast_insights(ctx, results, landing)

    def _sensitivities(self, ctx):
        """Effet sur l'EBE annuel d'une hausse de 1 %, sur les douze derniers mois. Les leviers du transport
        portent sur le seul chiffre d'affaires des rotations, pas sur celui du groupe (BTP, immobilier,
        négoce) : tarif = 1 % du chiffre d'affaires du transport (le prix passe entier dans l'EBE) ; volume
        = 1 % de sa marge sur coûts variables (part variable des coûts déclarés des rotations, à défaut celle
        de la structure de coûts) ; sans rotation, ces deux leviers valent None. Carburant = -1 % du
        carburant des rotations ; masse salariale = -1 % des charges de personnel (66), toutes activités."""
        monthly = self._monthly_pl(ctx, 24)
        last12 = list(monthly)[-12:]
        revenue = sum(monthly[k]["XB"] for k in last12)
        ebe = sum(monthly[k]["XD"] for k in last12)
        payroll = sum(monthly[k]["RK"] for k in last12)
        fuel, transport_revenue, transport_costs = 0.0, 0.0, 0.0
        if self._transport(ctx):
            start = _month_list(ctx.date_to, 12)[0]
            for r in self._rotations(ctx, start, ctx.date_to):
                fuel += r["fuel_cost"] or 0.0
                transport_revenue += r["revenue"] or 0.0
                transport_costs += (r["total_cost"] or 0.0) + (r["shortage_net_cost"] or 0.0)
        variable, source = None, None
        if transport_revenue > 0:
            if transport_costs > 0:
                variable, source = min(1.0, transport_costs / transport_revenue), "coûts déclarés du transport"
            else:
                cost = self._cost_structure(ctx)
                if cost["reliable"]:
                    variable, source = cost["variable_rate"] / 100, "structure de coûts"
        sensitivities = {
            "tariff": transport_revenue * 0.01 if transport_revenue > 0 else None,
            "volume": transport_revenue * (1 - variable) * 0.01 if variable is not None else None,
            "fuel": -fuel * 0.01,
            "payroll": -payroll * 0.01,
        }
        base = {"revenue_12m": revenue, "transport_revenue_12m": transport_revenue, "ebe_12m": ebe, "fuel_12m": fuel,
                "payroll_12m": payroll, "variable_rate_pct": variable * 100 if variable is not None else None,
                "variable_source": source, "unit": "GNF d'EBE annuel pour une hausse de 1 %"}
        return sensitivities, base

    def _forecast_insights(self, ctx, results, landing):
        items = []
        revenue, ebe = landing["revenue"], landing["ebe"]
        method = ("Prévision mensuelle par lissage exponentiel (Holt-Winters, Holt ou naïf selon l'historique), "
                  "probabilité par Monte-Carlo sur les erreurs observées.")
        evidence = {"type": "series", "data": {"series": results["revenue"]["series"]}}
        confidence = _confidence(results["revenue"]["history_months"], 36, 0.4, 0.85)
        probability = revenue["probability_pct"]
        if probability is not None and revenue["budget"]:
            gap = revenue["budget"] - revenue["estimate"]
            if probability < 30:
                items.append(insight(
                    "previsions.budget_hors_atteinte", "previsions", "high",
                    "Le budget de chiffre d'affaires est hors d'atteinte",
                    f"Atterrissage estimé à {gnf(revenue['estimate'])} (fourchette {gnf(revenue['low'])} à "
                    f"{gnf(revenue['high'])}) pour un budget de {gnf(revenue['budget'])} : probabilité de l'atteindre de "
                    f"{pct(probability, 0)}.", metric=_metric("Probabilité", probability, "pct", 50, "Une chance sur deux"),
                    impact_gnf=max(0.0, gap), confidence=confidence, method=method, evidence=evidence,
                    action=f"Trouver {gnf(max(0.0, gap))} de chiffre d'affaires supplémentaire d'ici la fin de l'exercice "
                           "ou réviser le budget et les charges qui en dépendent.", link="/analyse/previsions"))
            elif probability < 60:
                items.append(insight(
                    "previsions.budget_incertain", "previsions", "medium", "L'atteinte du budget reste incertaine",
                    f"Atterrissage estimé à {gnf(revenue['estimate'])} pour un budget de {gnf(revenue['budget'])} "
                    f"(probabilité de {pct(probability, 0)}).", metric=_metric("Probabilité", probability, "pct", 50),
                    impact_gnf=abs(gap), confidence=confidence, method=method, evidence=evidence,
                    action="Suivre l'écart chaque mois et préparer un plan d'action commercial.",
                    link="/analyse/previsions"))
            elif probability >= 80:
                items.append(insight(
                    "previsions.budget_atteignable", "previsions", "positive", "Le budget de chiffre d'affaires sera atteint",
                    f"Atterrissage estimé à {gnf(revenue['estimate'])} pour un budget de {gnf(revenue['budget'])} "
                    f"(probabilité de {pct(probability, 0)}).", metric=_metric("Probabilité", probability, "pct", 50),
                    confidence=confidence, method=method, evidence=evidence, link="/analyse/previsions"))
        if ebe["estimate"] < 0 and results["ebe"]["history_months"] >= 3:
            items.append(insight(
                "previsions.ebe_negatif", "previsions", "critical", "L'exercice finirait avec un EBE négatif",
                f"EBE estimé de l'exercice : {gnf(ebe['estimate'])} (fourchette {gnf(ebe['low'])} à {gnf(ebe['high'])}).",
                metric=_metric("EBE estimé", ebe["estimate"], "gnf", 0, "Équilibre"), impact_gnf=-ebe["estimate"],
                confidence=confidence, method=method,
                action="Plan de redressement : tarifs, charges fixes, activités déficitaires.", link="/analyse/rentabilite"))
        change = revenue["vs_previous_pct"]
        if change is not None and change <= -5 and revenue["previous_year"] > 0:
            items.append(insight(
                "previsions.recul_annuel", "previsions", "medium",
                f"Le chiffre d'affaires de l'exercice reculerait de {pct(abs(change))}",
                f"Atterrissage estimé à {gnf(revenue['estimate'])} contre {gnf(revenue['previous_year'])} l'exercice précédent.",
                metric=_metric("Variation", change, "pct", 0, "Exercice précédent"),
                impact_gnf=revenue["previous_year"] - revenue["estimate"], confidence=confidence, method=method,
                evidence=evidence, action="Identifier les clients et les routes en recul (sections Clients et Transport).",
                link="/analyse/clients"))
        rupture = results["revenue"]["cusum"]
        history = results["revenue"]["series"]
        if rupture["change"] and rupture["index"] is not None:
            actual_rows = [r for r in history if r["actual"] is not None and r["forecast"] is None]
            offset = results["revenue"]["history_months"] - len(actual_rows)
            index = rupture["index"] - offset
            if 0 <= index < len(actual_rows) and rupture["index"] >= results["revenue"]["history_months"] - 12:
                month = actual_rows[index]["month"]
                down = rupture["direction"] == "down"
                items.append(insight(
                    f"previsions.rupture.{month}", "previsions", "medium" if down else "positive",
                    f"Rupture de niveau du chiffre d'affaires depuis {_month_label(date.fromisoformat(month + '-01'))}",
                    f"Le chiffre d'affaires mensuel passe d'une moyenne de {gnf(rupture['mean_before'])} à "
                    f"{gnf(rupture['mean_after'])} : changement durable, pas une fluctuation.",
                    metric=_metric("Moyenne mensuelle", rupture["mean_after"], "gnf", rupture["mean_before"], "Avant"),
                    impact_gnf=abs((rupture["mean_after"] or 0) - (rupture["mean_before"] or 0)) * 12, confidence=0.7,
                    method="CUSUM tabulaire (k = 0,5 σ, h = 4 σ) sur la première moitié de l'historique.",
                    evidence=evidence,
                    action=("Expliquer la rupture (client perdu, route arrêtée, prix) et l'intégrer au budget."
                            if down else "Consolider la hausse : capacité de la flotte et besoin en fonds de roulement."),
                    link="/analyse/previsions"))
        mape = results["revenue"]["mape"]
        if mape is not None and mape > 30:
            items.append(insight(
                "previsions.fiabilite", "previsions", "info", "Prévision peu précise",
                f"Les prévisions à un mois se sont trompées de {pct(mape, 0)} en moyenne sur la fin de l'historique : "
                "l'atterrissage est à lire comme un ordre de grandeur.",
                metric=_metric("MAPE", mape, "pct", 15, "Bonne précision"), confidence=0.9,
                method="Erreur absolue moyenne en % des prévisions à un pas, dernier tiers de la série.",
                link="/analyse/previsions"))
        return items

    # ─── 5.8 Fiabilité ────────────────────────────────────────────────────

    def _section_fiabilite(self, ctx):
        checks = self._checks(ctx)
        score = self._checks_score(checks)
        items = []
        for check in checks:
            if check["status"] in ("bad", "warn"):
                items.append(insight(
                    f"fiabilite.{check['key']}", "fiabilite",
                    "high" if check["status"] == "bad" and CHECK_WEIGHTS.get(check["key"], 0) >= 10 else
                    "medium" if check["status"] == "bad" else "info",
                    check["label"] + " : à corriger", check["detail"] or check["label"],
                    metric=_metric(check["label"], check["value"], check["unit"], check["target"], "Cible"),
                    impact_gnf=check.get("amount"), confidence=0.95, method=check["definition"],
                    action=check["action"], link=check["link"]))
        if score is not None and score >= 90:
            items.append(insight(
                "fiabilite.solide", "fiabilite", "positive", "Les données sont fiables",
                f"Score de fiabilité de {score} sur 100 : les analyses reposent sur une comptabilité à jour.",
                metric=_metric("Score", score, "score", 90, "Repère"), confidence=0.9,
                method="Moyenne pondérée des contrôles.", link="/analyse/fiabilite"))
        return {"score": score, "checks": checks}, items

    @staticmethod
    def _checks_score(checks):
        weighted = [(CHECK_WEIGHTS.get(c["key"], 5), c["score"]) for c in checks if c["score"] is not None]
        return round(sum(w * s for w, s in weighted) / sum(w for w, _s in weighted)) if weighted else None

    def _checks(self, ctx, keys=None):
        """Contrôles de fiabilité (tous, ou ceux de `keys`), chacun {key, label, value, unit, target, status,
        score, detail, link, definition, action} ; une valeur None (sans objet) ne compte pas dans le score."""
        result = []
        for key in keys or CHECK_WEIGHTS:
            check = ctx.get(("check", key), lambda k=key: getattr(self, f"_check_{k}")(ctx))
            if check:
                result.append(check)
        return result

    @staticmethod
    def _check(key, label, value, unit, target, score, detail, link, definition, action, **extra):
        status = "neutral" if score is None else "good" if score >= 90 else "warn" if score >= 60 else "bad"
        return dict({"key": key, "label": label, "value": value, "unit": unit, "target": target, "status": status,
                     "score": round(score) if score is not None else None, "detail": detail if status != "good" else None,
                     "link": link, "definition": definition, "action": action}, **extra)

    def _check_analytic(self, ctx):
        acts = self._activities(ctx)
        rows = self._rows(
            f"""SELECT aml.analytic_distribution, COUNT(*), COALESCE(SUM(ABS(aml.balance)), 0)
                  FROM account_move_line aml JOIN account_account aa ON aa.id = aml.account_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aml.date BETWEEN %s AND %s
                   AND {ACC_CODE} ~ '^[67]'
              GROUP BY 1""",
            (ctx.company.id, ctx.date_from, ctx.date_to),
        )
        ids = acts["ids"] if acts else set()
        total = sum(float(r[2]) for r in rows)
        covered = sum(float(r[2]) for r in rows if ids & set(account_shares(r[0])))
        missing_count = sum(int(r[1]) for r in rows if not ids & set(account_shares(r[0])))
        value = _pct_of(covered, total)
        return self._check(
            "analytic", "Imputation analytique", value, "pct", 95.0,
            stats.linear_score(value, 50, 95) if value is not None else None,
            f"{missing_count} ligne(s) de charges ou de produits sans activité ({gnf(total - covered)}).", "/finance/ecritures",
            "Part (en montant) des lignes de charges et de produits de la période imputées sur l'axe Activité.",
            "Compléter l'imputation des pièces (activité) : sans elle, la rentabilité par activité est faussée.",
            count=missing_count, amount=total - covered)

    def _check_bank_reconciled(self, ctx):
        Line = self.env["account.bank.statement.line"]
        domain = [("company_id", "=", ctx.company.id), ("date", "<=", ctx.date_to)]
        total = Line.search_count(domain)
        if not total:
            return self._check("bank_reconciled", "Relevés rapprochés", None, "pct", 100.0, None, None,
                               "/finance/tresorerie/rapprochement", "Part des lignes de relevé rapprochées.", None)
        pending = Line.search(domain + [("is_reconciled", "=", False)])
        value = (total - len(pending)) / total * 100
        oldest = min(pending.mapped("date")) if pending else None
        return self._check(
            "bank_reconciled", "Relevés rapprochés", value, "pct", 100.0, stats.linear_score(value, 80, 100),
            f"{len(pending)} ligne(s) de relevé à rapprocher" + (f", la plus ancienne du {oldest:%d/%m/%Y}." if oldest else "."),
            "/finance/tresorerie/rapprochement", "Part des lignes de relevé bancaire rapprochées à la date d'arrêté.",
            "Rapprocher les lignes de relevé : la trésorerie et les encaissements clients en dépendent.",
            count=len(pending), amount=sum(abs(a) for a in pending.mapped("amount")))

    def _check_attachments(self, ctx):
        bills = self._rows(
            """SELECT am.id, EXISTS (SELECT 1 FROM ir_attachment ia WHERE ia.res_model = 'account.move'
                                                                  AND ia.res_id = am.id)
                 FROM account_move am
                WHERE am.state = 'posted' AND am.company_id = %s AND am.move_type IN ('in_invoice', 'in_refund')
                  AND am.date BETWEEN %s AND %s""",
            (ctx.company.id, ctx.date_from, ctx.date_to),
        )
        if not bills:
            return self._check("attachments", "Pièces justificatives", None, "pct", 100.0, None, None, "/finance/achats",
                               "Part des factures fournisseurs portant un justificatif.", None)
        missing = sum(1 for _i, ok in bills if not ok)
        value = (len(bills) - missing) / len(bills) * 100
        return self._check(
            "attachments", "Pièces justificatives", value, "pct", 100.0, stats.linear_score(value, 50, 100),
            f"{missing} facture(s) fournisseur sans justificatif joint.", "/finance/achats",
            "Part des factures et avoirs fournisseurs de la période portant au moins une pièce jointe.",
            "Joindre la facture numérisée à chaque pièce d'achat (contrôle fiscal, audit).", count=missing)

    def _check_late_entries(self, ctx):
        [(go_live,)] = self._rows("SELECT MIN(create_date)::date FROM account_move WHERE company_id = %s",
                                  (ctx.company.id,))
        if not go_live:
            return self._check("late_entries", "Saisie dans les délais", None, "pct", 5.0, None, None, "/finance/ecritures",
                               "Part des pièces saisies plus de 30 jours après leur date.", None)
        rows = self._rows(
            """SELECT (am.create_date::date - am.date) FROM account_move am
                 JOIN account_journal aj ON aj.id = am.journal_id
                WHERE am.state = 'posted' AND am.company_id = %s AND am.date BETWEEN %s AND %s
                  AND am.date >= %s AND aj.code != %s""",
            (ctx.company.id, ctx.date_from, ctx.date_to, go_live, OPENING_JOURNAL),
        )
        delays = [int(d) for (d,) in rows if d is not None]
        if not delays:
            return self._check("late_entries", "Saisie dans les délais", None, "pct", 5.0, None, None, "/finance/ecritures",
                               "Part des pièces saisies plus de 30 jours après leur date.", None)
        late = sum(1 for d in delays if d > 30)
        value = late / len(delays) * 100
        return self._check(
            "late_entries", "Saisie dans les délais", value, "pct", 5.0, stats.linear_score(value, 30, 5),
            f"{late} pièce(s) saisie(s) plus de 30 jours après leur date (délai médian {_days(stats.median(delays))}).",
            "/finance/ecritures",
            "Part des pièces de la période saisies plus de 30 jours après leur date (pièces datées après la mise en service).",
            "Saisir les pièces au fil de l'eau : une comptabilité en retard rend les analyses et la trésorerie fausses.",
            count=late, median_days=stats.median(delays))

    def _check_old_drafts(self, ctx):
        Move = self.env["account.move"]
        domain = [("company_id", "=", ctx.company.id), ("state", "=", "draft"),
                  ("date", "<", ctx.date_to - timedelta(days=30))]
        count = Move.search_count(domain)
        return self._check(
            "old_drafts", "Pièces en brouillon anciennes", count, "count", 0, stats.linear_score(count, 10, 0),
            f"{count} pièce(s) en brouillon datée(s) de plus de 30 jours.", "/finance/ecritures",
            "Pièces non comptabilisées dont la date a plus de 30 jours : absentes des états et des analyses.",
            "Valider ou supprimer ces brouillons.", count=count)

    def _check_suspense(self, ctx):
        company = ctx.company
        accounts = self.env["account.account"]
        if "account_journal_suspense_account_id" in company._fields:
            accounts |= company.account_journal_suspense_account_id
        journals = self.env["account.journal"].search([("company_id", "=", company.id), ("type", "in", ("bank", "cash"))])
        if "suspense_account_id" in journals._fields:
            accounts |= journals.suspense_account_id
        rows = self._rows(
            f"""SELECT {ACC_CODE}, COALESCE(SUM(aml.balance), 0)
                  FROM account_move_line aml JOIN account_account aa ON aa.id = aml.account_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aml.date <= %s
                   AND (aml.account_id = ANY(%s) OR {ACC_CODE} LIKE '471%%' OR {ACC_CODE} LIKE '585%%')
              GROUP BY 1""",
            (company.id, ctx.date_to, accounts.ids or [0]),
        )
        open_accounts = [(code, float(b)) for code, b in rows if abs(float(b)) > 0.5]
        amount = sum(abs(b) for _c, b in open_accounts)
        return self._check(
            "suspense", "Comptes d'attente soldés", amount, "gnf", 0, 100.0 if not open_accounts else 30.0,
            "Comptes non soldés : " + ", ".join(f"{c} ({gnf(b)})" for c, b in open_accounts[:5]) + ".",
            "/finance/tresorerie/rapprochement",
            "Soldes des comptes d'attente (attente bancaire des journaux, 471) et de virements internes (585).",
            "Imputer les opérations en attente sur leur compte définitif.", count=len(open_accounts), amount=amount)

    def _check_partners_vat(self, ctx):
        rows = self._rows(
            """SELECT DISTINCT am.commercial_partner_id FROM account_move am
                WHERE am.state = 'posted' AND am.company_id = %s AND am.commercial_partner_id IS NOT NULL
                  AND am.move_type IN ('out_invoice', 'out_refund', 'in_invoice', 'in_refund')
                  AND am.date BETWEEN %s AND %s""",
            (ctx.company.id, ctx.date_from, ctx.date_to),
        )
        partners = self.env["res.partner"].with_context(active_test=False).browse([r[0] for r in rows]).exists()
        if not partners:
            return self._check("partners_vat", "Tiers identifiés (NIF)", None, "pct", 100.0, None, None, "/finance/tiers",
                               "Part des tiers facturés portant un NIF.", None)
        missing = partners.filtered(lambda p: not p.vat)
        value = (len(partners) - len(missing)) / len(partners) * 100
        return self._check(
            "partners_vat", "Tiers identifiés (NIF)", value, "pct", 100.0, stats.linear_score(value, 50, 100),
            f"{len(missing)} tiers facturé(s) sans NIF : " + ", ".join(missing[:5].mapped("name")) + ".", "/finance/tiers",
            "Part des clients et fournisseurs facturés sur la période dont la fiche porte un NIF.",
            "Compléter le NIF des tiers (déclarations fiscales, retenues à la source).", count=len(missing))

    def _check_unbilled_rotations(self, ctx):
        if "eguitra.transport.rotation" not in self.env:
            return None
        rotations = self.env["eguitra.transport.rotation"].search([
            ("company_id", "=", ctx.company.id), ("state", "=", "done")])
        if not rotations and not self._transport(ctx):
            return None
        limit = ctx.date_to - timedelta(days=30)
        late = rotations.filtered(lambda r: (r.date_delivery or r.date_loading) <= limit)
        amount = sum(late.mapped("revenue"))
        return self._check(
            "unbilled_rotations", "Rotations facturées", len(late), "count", 0, stats.linear_score(len(late), 10, 0),
            f"{len(late)} rotation(s) validée(s) non facturée(s) depuis plus de 30 jours ({gnf(amount)}).",
            "/transport/rotations", "Rotations validées, livrées depuis plus de 30 jours et non facturées.",
            "Facturer les rotations livrées.", count=len(late), amount=amount)

    def _check_tiers_without_partner(self, ctx):
        [(count, amount)] = self._rows(
            """SELECT COUNT(*), COALESCE(SUM(ABS(aml.balance)), 0) FROM account_move_line aml
                 JOIN account_account aa ON aa.id = aml.account_id
                WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aml.date BETWEEN %s AND %s
                  AND aa.account_type IN ('asset_receivable', 'liability_payable') AND aml.partner_id IS NULL""",
            (ctx.company.id, ctx.date_from, ctx.date_to),
        )
        return self._check(
            "tiers_without_partner", "Lignes de tiers rattachées", int(count), "count", 0,
            stats.linear_score(int(count), 20, 0),
            f"{count} ligne(s) de compte client ou fournisseur sans tiers ({gnf(float(amount))}).", "/finance/ecritures",
            "Lignes des comptes clients et fournisseurs de la période sans tiers : absentes des balances âgées.",
            "Renseigner le tiers de ces lignes.", count=int(count), amount=float(amount))

    def _check_unmapped_accounts(self, ctx):
        unmapped = self._pl(ctx, ctx.date_from, ctx.date_to)["_unmapped"]
        sheet = self.env["eguitra.syscohada"].balance_sheet(ctx.company, ctx.date_to)
        count = unmapped + len(sheet["unmapped_accounts"])
        return self._check(
            "unmapped_accounts", "Comptes classés dans les états", count, "count", 0, stats.linear_score(count, 10, 0),
            f"{count} compte(s) mouvementé(s) hors des rubriques SYSCOHADA.", "/finance/etats",
            "Comptes mouvementés qu'aucune rubrique du bilan ou du compte de résultat ne reprend.",
            "Faire valider le classement de ces comptes par l'expert-comptable.", count=count)

    def _check_rotations_fuel(self, ctx):
        if not self._transport(ctx):
            return None
        period = self._rotations(ctx, ctx.date_from, ctx.date_to)
        if not period:
            return None
        with_fuel = sum(1 for r in period if (r["fuel_liters"] or 0) > 0)
        value = with_fuel / len(period) * 100
        return self._check(
            "rotations_fuel", "Litres de carburant saisis", value, "pct", 90.0, stats.linear_score(value, 30, 90),
            f"{len(period) - with_fuel} rotation(s) sans litres de carburant : consommation non contrôlable.",
            "/transport/rotations", "Part des rotations de la période dont les litres de carburant sont saisis.",
            "Saisir les litres (bon de carburant) sur chaque rotation, au bureau ou dans l'application Rotations.",
            count=len(period) - with_fuel)

    # ─── Fiabilité de chaque section ──────────────────────────────────────

    def _quality(self, ctx, name):
        checks = self._checks(ctx, QUALITY_CHECKS[name])
        if name in ("synthese", "fiabilite"):
            score = self._checks_score(checks)
        else:
            scores = [c["score"] for c in checks if c["score"] is not None]
            score = round(sum(scores) / len(scores)) if scores else None
        notes = [c["detail"] for c in sorted(checks, key=lambda c: c["score"] if c["score"] is not None else 101)
                 if c["status"] in ("bad", "warn") and c["detail"]]
        if name in ("tresorerie", "clients"):
            history = self._payment_history(ctx)
            notes.append(f"Délais de paiement appris sur {len(history)} facture(s) réglée(s) en 24 mois.")
        return {"score": score, "notes": (notes + ctx.notes)[:6]}
