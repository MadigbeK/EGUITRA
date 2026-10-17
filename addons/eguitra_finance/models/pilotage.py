"""Pilotage financier de la direction : besoin en fonds de roulement et délais, flux mensuels de
trésorerie et prévision, dette, budget, transport, questions du dirigeant, lecture rédigée du
rapport mensuel.

Complète eguitra.finance.metrics par héritage : le tableau de bord et le rapport mensuel de gestion
reçoivent ici leurs indicateurs supplémentaires. Les formules suivent le prototype de la direction
(EGUITRA Finance, moteur comptable), corrigées de ses approximations : la concentration est
rapportée au chiffre d'affaires de la même période, la dette est comparée à l'EBE des douze
derniers mois (et non à un EBE annualisé par un coefficient fixe).
"""

import itertools
from datetime import date, timedelta

from dateutil.relativedelta import relativedelta

from odoo import api, models

from .finance_metrics import ACC_CODE, month_bounds
from .syscohada import OPENING_JOURNAL

MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
             "novembre", "décembre"]

# Perte attendue sur créances (IFRS 9, approche simplifiée) : taux par tranche d'ancienneté, tant
# qu'aucune matrice propre à la société n'est paramétrée (expected_credit_loss se surcharge).
ECL_RATES = {"non_echu": 0.01, "1_30": 0.03, "31_60": 0.10, "61_90": 0.25, "plus_90": 0.50}

# Au-delà de ce retard, une créance est tenue pour douteuse : la prévision de trésorerie ne la compte pas.
DOUBTFUL_DAYS = 90

# Tableaux de bord calculés pendant un appel du rapport mensuel (le contexte porte le numéro d'appel).
_DASHBOARD_CALLS = itertools.count(1)
_DASHBOARD_CACHE = {}


def month_label(day):
    return f"{MONTHS_FR[day.month - 1]} {day.year}"


def _pct(part, whole):
    return part / whole * 100 if whole else None


def _num(value, digits=1):
    """12,5 (nombre à la française)."""
    return f"{value:,.{digits}f}".replace(",", " ").replace(".", ",")


def _money(value):
    """Montant court : 1,25 Md GNF, 384 M GNF, 12 500 GNF."""
    a = abs(value)
    if a >= 1e9:
        return f"{_num(value / 1e9, 2)} Md GNF"
    if a >= 1e6:
        return f"{_num(value / 1e6, 0)} M GNF"
    return f"{_num(value, 0)} GNF"


def _de(word):
    """« de mars », « d'octobre »."""
    return f"d'{word}" if word[:1] in "aeiouyéèâ" else f"de {word}"


def _evolution(current, previous):
    """« en hausse de 12,3 % » ; « en baisse de 4,0 % » ; « stable » ; sans base, None."""
    if not previous:
        return None
    rate = (current - previous) / abs(previous) * 100
    if abs(rate) < 0.05:
        return "stable"
    return f"en {'hausse' if rate > 0 else 'baisse'} de {_num(abs(rate))} %"


class EguitraFinancePilotage(models.AbstractModel):
    _inherit = "eguitra.finance.metrics"

    # ─── Briques ──────────────────────────────────────────────────────────

    def _invoiced_ttc(self, companies, kind, date_from, date_to):
        """Ventes (kind='sale') ou achats ('purchase') facturés TTC sur la période, avoirs déduits."""
        types = ("out_invoice", "out_refund") if kind == "sale" else ("in_invoice", "in_refund")
        self.env.flush_all()
        self.env.cr.execute(
            """SELECT COALESCE(SUM(CASE WHEN am.move_type = %(main)s THEN ABS(am.amount_total_signed)
                                        ELSE -ABS(am.amount_total_signed) END), 0)
                 FROM account_move am
                WHERE am.state = 'posted' AND am.company_id = ANY(%(companies)s) AND am.move_type = ANY(%(types)s)
                  AND am.date BETWEEN %(date_from)s AND %(date_to)s""",
            {"main": types[0], "types": list(types), "companies": list(companies.ids),
             "date_from": date_from, "date_to": date_to},
        )
        return float(self.env.cr.fetchone()[0])

    def _top_client(self, companies, date_from, date_to):
        """Premier client de la période : (tiers, chiffre d'affaires HT)."""
        self.env.flush_all()
        self.env.cr.execute(
            f"""SELECT aml.partner_id, -SUM(aml.balance)
                  FROM account_move_line aml
                  JOIN account_account aa ON aa.id = aml.account_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s)
                   AND aml.date BETWEEN %(date_from)s AND %(date_to)s AND aml.partner_id IS NOT NULL
                   AND {ACC_CODE} LIKE '70%%'
              GROUP BY 1 ORDER BY 2 DESC LIMIT 1""",
            {"companies": list(companies.ids), "date_from": date_from, "date_to": date_to},
        )
        row = self.env.cr.fetchone()
        if not row or float(row[1]) <= 0:
            return self.env["res.partner"], 0.0
        return self.env["res.partner"].sudo().browse(row[0]), float(row[1])

    def _treasury_accounts(self, companies):
        journals = self.env["account.journal"].sudo().search(
            [("type", "in", ("bank", "cash")), ("company_id", "in", companies.ids)]
        )
        return journals.default_account_id

    def _treasury_balance(self, companies, day):
        """Solde des comptes des journaux de banque et de caisse à une date."""
        accounts = self._treasury_accounts(companies)
        if not accounts:
            return 0.0
        self.env.flush_all()
        self.env.cr.execute(
            """SELECT COALESCE(SUM(aml.balance), 0) FROM account_move_line aml
                WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%s) AND aml.account_id = ANY(%s)
                  AND aml.date <= %s""",
            (list(companies.ids), accounts.ids, day),
        )
        return float(self.env.cr.fetchone()[0])

    def _monthly_amounts(self, companies, date_from, date_to, prefixes):
        """Solde (débit - crédit) par mois AAAA-MM des comptes des préfixes."""
        self.env.flush_all()
        self.env.cr.execute(
            f"""SELECT to_char(date_trunc('month', aml.date), 'YYYY-MM'), COALESCE(SUM(aml.balance), 0)
                  FROM account_move_line aml
                  JOIN account_account aa ON aa.id = aml.account_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s)
                   AND aml.date BETWEEN %(date_from)s AND %(date_to)s AND {ACC_CODE} LIKE ANY(%(patterns)s)
              GROUP BY 1""",
            {"companies": list(companies.ids), "date_from": date_from, "date_to": date_to,
             "patterns": [p + "%" for p in prefixes]},
        )
        return {month: float(amount) for month, amount in self.env.cr.fetchall()}

    def ledger_totals(self, companies, date_from, date_to):
        """Total des débits et des crédits des écritures validées de la période."""
        self.env.flush_all()
        self.env.cr.execute(
            """SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0) FROM account_move_line
                WHERE parent_state = 'posted' AND company_id = ANY(%s) AND date BETWEEN %s AND %s""",
            (list(companies.ids), date_from, date_to),
        )
        debit, credit = (float(v) for v in self.env.cr.fetchone())
        return {"date_from": date_from, "date_to": date_to, "debit": debit, "credit": credit,
                "difference": round(debit - credit, 2), "balanced": abs(debit - credit) < 0.5}

    @api.model
    def threshold_values(self, companies):
        """Seuils utiles aux écrans : ceux de la première société ; la trésorerie minimale du groupe
        est la somme de celles des sociétés. Un seuil désactivé ou laissé à 0 vaut None."""
        Threshold = self.env["eguitra.alert.threshold"]
        main = Threshold._thresholds(companies[:1])

        def value(code):
            t = main.get(code)
            return t.value if t and t.value else None

        cash_min = sum((Threshold._thresholds(c).get("cash_min") or Threshold).value or 0.0 for c in companies)
        budget = main.get("budget_overrun_pct")
        return {
            "cash_min": cash_min or None,
            "dscr_min": value("dscr_min"),
            "dso_target_days": value("dso_target_days"),
            "receivable_overdue_share_pct": value("receivable_overdue_share_pct"),
            "client_concentration_pct": value("client_concentration_pct"),
            "transport_margin_min": value("transport_margin_min"),
            "budget_overrun_pct": budget.value if budget else 10.0,
        }

    # ─── Besoin en fonds de roulement ─────────────────────────────────────

    @api.model
    def working_capital(self, companies, date_from, date_to):
        """Besoin en fonds de roulement et délais sur la période (formules du prototype) :
        jours = fin - début + 1 ; DSO = créances clients / ventes TTC x jours ; DPO = dettes
        fournisseurs / achats TTC x jours ; DIO = stocks / achats TTC x jours ; cycle = DSO + DIO -
        DPO ; BFR = créances + stocks - dettes fournisseurs ; part échue = échu / créances ;
        concentration = chiffre d'affaires HT du premier client / chiffre d'affaires HT de la période.
        En second indicateur : DSO sur douze mois glissants et BFR SYSCOHADA (actif circulant BK -
        passif circulant DP)."""
        days = (date_to - date_from).days + 1
        rec = self.open_items(companies, "asset_receivable", date_to)
        pay = self.open_items(companies, "liability_payable", date_to)
        stocks = self._sum_balance(companies, ["3"], None, date_to)
        sales = self._invoiced_ttc(companies, "sale", date_from, date_to)
        purchases = self._invoiced_ttc(companies, "purchase", date_from, date_to)
        start_12m = date_to - relativedelta(years=1) + timedelta(days=1)
        sales_12m = self._invoiced_ttc(companies, "sale", start_12m, date_to)
        dso = rec["total"] / sales * days if sales > 0 else None
        dpo = pay["total"] / purchases * days if purchases > 0 else None
        dio = stocks / purchases * days if purchases > 0 else None
        cycle = dso + (dio or 0.0) - (dpo or 0.0) if dso is not None else None
        sheet = self.env["eguitra.syscohada"].balance_sheet(companies, date_to)
        actif = {line["code"]: line["amount"] for line in sheet["actif"]}
        passif = {line["code"]: line["amount"] for line in sheet["passif"]}
        revenue = self.revenue(companies, date_from, date_to)
        partner, top = self._top_client(companies, date_from, date_to)
        return {
            "date_from": date_from,
            "date_to": date_to,
            "days": days,
            "receivables": rec["total"],
            "receivables_overdue": rec["overdue"],
            "overdue_share_pct": _pct(rec["overdue"], rec["total"]) if rec["total"] > 0 else None,
            "receivables_doubtful": rec["aging"]["plus_90"],
            "payables": pay["total"],
            "payables_overdue": pay["overdue"],
            "stocks": stocks,
            "sales_ttc": sales,
            "purchases_ttc": purchases,
            "daily_sales_ttc": sales / days if sales > 0 else None,
            "dso": dso,
            "dso_12m": rec["total"] / sales_12m * ((date_to - start_12m).days + 1) if sales_12m > 0 else None,
            "dpo": dpo,
            "dio": dio,
            "cycle": cycle,
            "bfr": rec["total"] + stocks - pay["total"],
            "bfr_syscohada": actif.get("BK", 0.0) - passif.get("DP", 0.0),
            "balance_sheet_difference": sheet["difference"],
            "revenue": revenue,
            "concentration": {
                "partner": partner.name or None,
                "amount": top,
                "pct": _pct(top, revenue) if revenue > 0 else None,
            },
            "receivables_aging": rec["aging"],
            "receivables_aging_count": rec["aging_count"],
            "payables_aging": pay["aging"],
            "payables_aging_count": pay["aging_count"],
        }

    @api.model
    def partner_aging(self, companies, account_type, day):
        """Encours par tiers : pièces, encours, dont échu, retard maximal et statut (contentieux
        au-delà de 90 jours de retard, retard au-delà de 0, sinon à jour)."""
        self.env.flush_all()
        self.env.cr.execute(
            """SELECT aml.partner_id, COUNT(DISTINCT aml.move_id), COALESCE(SUM(aml.amount_residual), 0),
                      COALESCE(SUM(CASE WHEN aml.date_maturity < %(day)s THEN aml.amount_residual END), 0),
                      COALESCE(MAX(CASE WHEN aml.date_maturity < %(day)s THEN %(day)s - aml.date_maturity END), 0)
                 FROM account_move_line aml
                 JOIN account_account aa ON aa.id = aml.account_id
                WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s)
                  AND aa.account_type = %(account_type)s AND NOT aml.reconciled AND aml.date <= %(day)s
             GROUP BY 1""",
            {"day": day, "companies": list(companies.ids), "account_type": account_type},
        )
        sign = -1 if account_type == "liability_payable" else 1
        rows = [r for r in self.env.cr.fetchall() if abs(float(r[2])) > 0.5]
        partners = {p.id: p for p in self.env["res.partner"].sudo().browse([r[0] for r in rows if r[0]])}
        result = []
        for partner_id, count, total, overdue, late in rows:
            partner = partners.get(partner_id)
            late = int(late or 0)
            result.append({
                "partner_id": partner_id,
                "name": partner.name if partner else "Sans tiers",
                "ref": (partner.ref or None) if partner else None,
                "documents": int(count),
                "total": sign * float(total),
                "overdue": sign * float(overdue),
                "max_late_days": late,
                "status": "contentieux" if late > 90 else "retard" if late > 0 else "a_jour",
            })
        return sorted(result, key=lambda r: -r["total"])

    # ─── Trésorerie mensuelle et prévision ────────────────────────────────

    def _cash_threshold(self, companies):
        return self.threshold_values(companies)["cash_min"] or 0.0

    @api.model
    def monthly_cash(self, companies, today, year=None, threshold=None):
        """Flux mensuels de trésorerie de l'exercice, sur les comptes des journaux de banque et de
        caisse : ouverture = solde à la veille de l'exercice + à-nouveaux de l'exercice ;
        encaissements = débits du mois, décaissements = crédits du mois, hors à-nouveaux et hors
        virements internes (pièces portant le compte de passage 585) ; cash net ; solde de fin de
        mois ; chiffre d'affaires HT du mois. Contrôle de chaque mois : à venir, sous le seuil, cash
        net négatif ou conforme."""
        main = companies[:1]
        fy_start, fy_end = self.fiscal_year_bounds(main, date(year, 12, 31) if year else today)
        if threshold is None:
            threshold = self._cash_threshold(companies)
        accounts = self._treasury_accounts(companies)
        opening, flows = 0.0, {}
        if accounts:
            self.env.flush_all()
            params = {"companies": list(companies.ids), "accounts": accounts.ids, "start": fy_start, "end": fy_end,
                      "journal": OPENING_JOURNAL}
            self.env.cr.execute(
                """SELECT COALESCE(SUM(aml.balance), 0)
                     FROM account_move_line aml
                     JOIN account_journal aj ON aj.id = aml.journal_id
                    WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s)
                      AND aml.account_id = ANY(%(accounts)s)
                      AND (aml.date < %(start)s OR (aml.date <= %(end)s AND aj.code = %(journal)s))""",
                params,
            )
            opening = float(self.env.cr.fetchone()[0])
            self.env.cr.execute(
                f"""SELECT to_char(date_trunc('month', aml.date), 'YYYY-MM'),
                           COALESCE(SUM(aml.debit), 0), COALESCE(SUM(aml.credit), 0)
                      FROM account_move_line aml
                      JOIN account_journal aj ON aj.id = aml.journal_id
                     WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s)
                       AND aml.account_id = ANY(%(accounts)s) AND aml.date BETWEEN %(start)s AND %(end)s
                       AND aj.code != %(journal)s
                       AND NOT EXISTS (
                           SELECT 1 FROM account_move_line t JOIN account_account ta ON ta.id = t.account_id
                            WHERE t.move_id = aml.move_id AND {ACC_CODE.replace('aml.', 't.').replace('aa.', 'ta.')} LIKE '585%%')
                  GROUP BY 1""",
                params,
            )
            flows = {month: (float(debit), float(credit)) for month, debit, credit in self.env.cr.fetchall()}
        revenue = {k: -v for k, v in self._monthly_amounts(companies, fy_start, fy_end, ["70"]).items()}
        current = today.strftime("%Y-%m")
        months, balance = [], opening
        month = fy_start.replace(day=1)
        while month <= fy_end:
            key = month.strftime("%Y-%m")
            receipts, payments = flows.get(key, (0.0, 0.0))
            active = bool(receipts or payments or revenue.get(key))
            future = key > current and not active
            balance += receipts - payments
            net = receipts - payments
            if future:
                status = "a_venir"
            elif threshold and balance < threshold:
                status = "sous_seuil"
            elif net < 0:
                status = "cash_net_negatif"
            else:
                status = "conforme"
            months.append({
                "month": key, "label": month_label(month), "revenue": revenue.get(key, 0.0), "receipts": receipts,
                "payments": payments, "net": net, "end": None if future else balance, "status": status,
                "current": key == current, "active": active,
            })
            month += relativedelta(months=1)
        past = [m for m in months if m["status"] != "a_venir"]
        active = [m for m in past if m["active"]]
        low = min(active, key=lambda m: m["end"]) if active else None
        paying = [m for m in active if m["payments"]]
        return {
            "fiscal_year": {"start": fy_start, "end": fy_end},
            "opening": opening,
            "threshold": threshold or None,
            "months": months,
            "summary": {
                "receipts": sum(m["receipts"] for m in months),
                "payments": sum(m["payments"] for m in months),
                "net": sum(m["net"] for m in months),
                "end": past[-1]["end"] if past else opening,
                "low_point": {"month": low["month"], "label": low["label"], "end": low["end"]} if low else None,
                "negative_months": sum(1 for m in active if m["net"] < 0),
                "active_months": len(active),
                "below_threshold_months": sum(1 for m in past if m["status"] == "sous_seuil"),
                "average_payments": sum(m["payments"] for m in paying) / len(paying) if paying else 0.0,
            },
        }

    @api.model
    def cash_forecast(self, companies, today, months=3):
        """Trésorerie prévisionnelle des banques et caisses : trésorerie actuelle, plus les créances
        clients échues ou à échoir d'ici la fin du mois (hors créances échues depuis plus de 90 jours,
        tenues pour douteuses et indiquées à part), moins les dettes fournisseurs et les échéances
        d'emprunt non réglées de la période ; puis mois par mois sur les trois mois suivants, selon
        les dates d'échéance."""
        m_start, m_end = month_bounds(today)
        horizon = month_bounds(m_start + relativedelta(months=months))[1]
        start = self._treasury_balance(companies, today)
        doubtful_limit = today - timedelta(days=DOUBTFUL_DAYS)
        self.env.flush_all()
        self.env.cr.execute(
            """SELECT aa.account_type, aml.date_maturity, COALESCE(SUM(aml.amount_residual), 0)
                 FROM account_move_line aml
                 JOIN account_account aa ON aa.id = aml.account_id
                WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s)
                  AND aa.account_type IN ('asset_receivable', 'liability_payable') AND NOT aml.reconciled
                  AND aml.date <= %(today)s AND (aml.date_maturity IS NULL OR aml.date_maturity <= %(horizon)s)
             GROUP BY 1, 2""",
            {"companies": list(companies.ids), "today": today, "horizon": horizon},
        )

        def bucket(day):
            return "M0" if not day or day <= m_end else day.strftime("%Y-%m")

        inflows, outflows, loans, doubtful = {}, {}, {}, 0.0
        for account_type, maturity, residual in self.env.cr.fetchall():
            residual = float(residual)
            if account_type == "asset_receivable":
                if maturity and maturity < doubtful_limit:
                    doubtful += residual
                    continue
                inflows[bucket(maturity)] = inflows.get(bucket(maturity), 0.0) + residual
            else:
                outflows[bucket(maturity)] = outflows.get(bucket(maturity), 0.0) - residual
        for line in self.env["eguitra.loan.line"].sudo().search([
            ("loan_id.company_id", "in", companies.ids), ("loan_id.state", "=", "active"), ("paid", "=", False),
            ("due_date", "<=", horizon),
        ]):
            loans[bucket(line.due_date)] = loans.get(bucket(line.due_date), 0.0) + line.total

        def step(key, label, opening, **extra):
            r, p, lo = inflows.get(key, 0.0), outflows.get(key, 0.0), loans.get(key, 0.0)
            return dict({"label": label, "start": opening, "receivables": r, "payables": p, "loans": lo,
                         "net": r - p - lo, "end": opening + r - p - lo}, **extra)

        month_end = step("M0", month_label(m_start), start, date=m_end, month=m_start.strftime("%Y-%m"),
                         doubtful_excluded=doubtful)
        rows, previous = [], month_end["end"]
        for i in range(1, months + 1):
            first = m_start + relativedelta(months=i)
            row = step(first.strftime("%Y-%m"), month_label(first), previous, month=first.strftime("%Y-%m"),
                       date=month_bounds(first)[1])
            rows.append(row)
            previous = row["end"]
        return {"as_of": today, "start": start, "month_end": month_end, "months": rows,
                "threshold": self._cash_threshold(companies) or None}

    # ─── Dette ────────────────────────────────────────────────────────────

    @api.model
    def dscr(self, companies, today):
        """DSCR : excédent brut d'exploitation des douze derniers mois / service de la dette de la
        même période (à défaut, des douze prochains mois pour un financement récent)."""
        ebe = self.env["eguitra.syscohada"].income_statement(
            companies, today - relativedelta(years=1) + timedelta(days=1), today
        )["totals"].get("XD", 0.0)
        debt = self.env["eguitra.loan"].debt_summary(companies, today)
        service = debt["service_last_12m"] or debt["service_next_12m"]
        return {"dscr": ebe / service if service else None, "ebe_12m": ebe, "service_12m": service}

    @api.model
    def debt_position(self, companies, day):
        """Dette financière vue par la comptabilité et par les échéanciers : encours comptable (soldes
        des comptes 16 et 17), écart avec le capital restant dû des échéanciers (déblocage ou
        règlement non comptabilisé, financement non saisi), dette nette de la trésorerie, gearing
        (encours / capitaux propres), dette / EBE des douze derniers mois, service de la dette de
        l'exercice."""
        summary = self.env["eguitra.loan"].debt_summary(companies, day)
        accounting = -self._sum_balance(companies, ["16", "17"], None, day)
        sheet = self.env["eguitra.syscohada"].balance_sheet(companies, day)
        equity = next((line["amount"] for line in sheet["passif"] if line["code"] == "CP"), 0.0)
        ratios = self.dscr(companies, day)
        fy_start, fy_end = self.fiscal_year_bounds(companies[:1], day)
        fy_lines = self.env["eguitra.loan.line"].sudo().search([
            ("loan_id.company_id", "in", companies.ids), ("loan_id.state", "in", ("active", "closed")),
            ("due_date", ">=", fy_start), ("due_date", "<=", fy_end),
        ])
        ebe = ratios["ebe_12m"]
        return dict(
            summary,
            accounting_outstanding=accounting,
            schedule_gap=round(accounting - summary["outstanding"], 2),
            net_debt=accounting - self.cash(companies, day),
            equity=equity,
            gearing=accounting / equity if equity > 0 else None,
            ebe_12m=ebe,
            debt_to_ebe=accounting / ebe if ebe > 0 else None,
            service_fy=sum(fy_lines.mapped("total")),
            service_fy_paid=sum(fy_lines.filtered("paid").mapped("total")),
            service_fy_interest=sum(fy_lines.mapped("interest")),
            dscr=ratios["dscr"],
        )

    # ─── Budget ───────────────────────────────────────────────────────────

    @api.model
    def budget_status(self, companies, day, threshold=None):
        """Réalisé contre budget cumulé, du début du budget à la fin du mois de day, compte par compte
        (budgets par compte de mis_builder_budget, écran Activités et budget) : produits et charges,
        lignes hors de la tolérance (charges au-dessus, produits en dessous). None sans budget."""
        if "mis.budget.by.account" not in self.env:
            return None
        Budget = self.env["mis.budget.by.account"].sudo()
        budgets = Budget
        for company in companies:
            budgets |= Budget.search([
                ("company_id", "=", company.id), ("state", "!=", "cancelled"),
                ("date_from", "<=", day), ("date_to", ">=", day),
            ], order="date_from desc, id desc", limit=1)
        if not budgets:
            return None
        if threshold is None:
            threshold = self.threshold_values(companies)["budget_overrun_pct"]
        _m_start, m_end = month_bounds(day)
        rows = {}
        self.env.flush_all()
        for budget in budgets:
            planned = {}
            for item in budget.item_ids.filtered(lambda i, b=budget: b.date_from <= i.date_from <= m_end):
                planned[item.account_id.id] = planned.get(item.account_id.id, 0.0) + item.balance
            if not planned:
                continue
            self.env.cr.execute(
                """SELECT aml.account_id, COALESCE(SUM(aml.balance), 0) FROM account_move_line aml
                    WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aml.date BETWEEN %s AND %s
                      AND aml.account_id = ANY(%s)
                 GROUP BY 1""",
                (budget.company_id.id, budget.date_from, m_end, list(planned)),
            )
            actual = dict(self.env.cr.fetchall())
            accounts = self.env["account.account"].sudo().with_company(budget.company_id).browse(list(planned))
            for account in accounts:
                code = account.code or ""
                row = rows.setdefault(code, {"code": code, "name": account.name, "budget": 0.0, "actual": 0.0,
                                             "kind": "produit" if code.startswith("7") else "charge"})
                sign = -1 if code.startswith("7") else 1
                row["budget"] += sign * planned[account.id]
                row["actual"] += sign * float(actual.get(account.id, 0.0))
        lines = []
        for row in sorted(rows.values(), key=lambda r: r["code"]):
            gap = row["actual"] - row["budget"]
            rate = gap / row["budget"] * 100 if row["budget"] else None
            overrun = rate is not None and (rate > threshold if row["kind"] == "charge" else rate < -threshold)
            lines.append(dict(row, gap=gap, gap_pct=rate, overrun=overrun))

        def total(kind):
            selected = [line for line in lines if line["kind"] == kind]
            b, a = sum(line["budget"] for line in selected), sum(line["actual"] for line in selected)
            return {"budget": b, "actual": a, "gap": a - b, "gap_pct": (a - b) / b * 100 if b else None}

        return {
            "budgets": budgets.mapped("name"),
            "through": m_end,
            "threshold_pct": threshold,
            "revenue": total("produit"),
            "expenses": total("charge"),
            "lines": lines,
            "overruns": sorted([line for line in lines if line["overrun"]], key=lambda r: -abs(r["gap"])),
        }

    # ─── Transport ────────────────────────────────────────────────────────

    def _transport_vehicle_results(self, companies, date_from, date_to):
        """Point d'extension du module transport : résultat de chaque ensemble routier après charges
        de structure, liste de {key, label, km, revenue, margin, structure, net_result}. None tant que
        le calcul n'existe pas : les écrans s'en tiennent alors à la marge directe. Les lignes de
        profitability() portant km et net_result sont reprises d'office."""
        return None

    @api.model
    def transport_kpis(self, companies, date_from, date_to, unbilled_before=None):
        """Transport sur la période : rotations, volume, kilomètres (si calculés), chiffre d'affaires
        et marge directe, part du chiffre d'affaires, résultat par ensemble routier (après structure
        si le module transport le calcule, sinon marge directe) ; rotations validées non facturées,
        toutes dates confondues (validées au plus tard unbilled_before si fourni). None sans module."""
        if "eguitra.transport.rotation" not in self.env:
            return None
        Rotation = self.env["eguitra.transport.rotation"].sudo()
        rows = Rotation.profitability(companies, date_from, date_to, "vehicle")
        revenue = sum(r["revenue"] or 0.0 for r in rows)
        margin = sum(r["margin"] or 0.0 for r in rows)
        kms = [r["km"] for r in rows if r.get("km") is not None]
        results = self._transport_vehicle_results(companies, date_from, date_to)
        if results is None and rows and all(r.get("net_result") is not None for r in rows):
            results = rows
        basis = "net" if results is not None else "margin"
        vehicles = [
            {"key": r.get("key"), "label": r.get("label"), "km": r.get("km"), "revenue": r.get("revenue") or 0.0,
             "margin": r.get("margin") or 0.0, "structure": r.get("structure"),
             "result": (r.get("net_result") if basis == "net" else r.get("margin")) or 0.0}
            for r in (results if results is not None else rows)
        ]
        vehicles.sort(key=lambda v: -v["result"])
        deficit = [v for v in vehicles if v["result"] < 0]
        pending = Rotation.search([("company_id", "in", companies.ids), ("state", "=", "done")], order="date_loading")
        if unbilled_before:
            pending = pending.filtered(lambda r: (r.date_delivery or r.date_loading) <= unbilled_before)
        total_revenue = self.revenue(companies, date_from, date_to)
        return {
            "date_from": date_from,
            "date_to": date_to,
            "rotations": sum(r["rotations"] or 0 for r in rows),
            "volume": sum(r["volume"] or 0.0 for r in rows),
            "km": sum(kms) if kms else None,
            "revenue": revenue,
            "margin": margin,
            "margin_rate": _pct(margin, revenue) if revenue else None,
            "share_of_revenue_pct": _pct(revenue, total_revenue) if total_revenue > 0 else None,
            "vehicles": {"basis": basis, "count": len(vehicles), "items": vehicles, "deficit": deficit,
                         "loss": sum(v["result"] for v in deficit)},
            "unbilled": {
                "count": len(pending),
                "amount": sum(pending.mapped("revenue")),
                "oldest": (pending[:1].date_delivery or pending[:1].date_loading) if pending else None,
                "items": [{"id": r.id, "name": r.name, "date": r.date_delivery or r.date_loading,
                           "partner": r.partner_id.name, "revenue": r.revenue} for r in pending],
            },
        }

    # ─── Pertes attendues ─────────────────────────────────────────────────

    @api.model
    def expected_credit_loss(self, companies, day, aging=None):
        """Perte attendue sur les créances clients (IFRS 9, matrice par ancienneté). Se surcharge
        quand la matrice devient paramétrable par société."""
        aging = aging or self.open_items(companies, "asset_receivable", day)["aging"]
        by_bucket = {k: max(0.0, aging.get(k, 0.0)) * rate for k, rate in ECL_RATES.items()}
        total = sum(by_bucket.values())
        exposure = sum(max(0.0, v) for v in aging.values())
        return {"total": total, "rate_pct": _pct(total, exposure) if exposure else None, "by_bucket": by_bucket,
                "rates": ECL_RATES}

    # ─── Tableau de bord ──────────────────────────────────────────────────

    @api.model
    def dashboard(self, companies, today=None):
        # Le rapport mensuel lit le tableau de bord deux fois : une fois suffit.
        cache = _DASHBOARD_CACHE.get(self.env.context.get("eguitra_dashboard_cache"))
        key = (tuple(companies.ids), today)
        if cache is not None and key in cache:
            return cache[key]
        data = super().dashboard(companies, today)
        if cache is not None:
            cache[key] = data
        day = data["as_of"]
        fy_start = data["fiscal_year"]["start"]
        totals = data["income_totals"]
        thresholds = self.threshold_values(companies)
        revenue = totals.get("XB", 0.0)
        transport = self.transport_kpis(companies, fy_start, day)
        if transport:
            transport = dict(transport, unbilled=dict(transport["unbilled"], items=transport["unbilled"]["items"][:10]))
        data["debt"].update(self.debt_position(companies, day))
        data.update({
            "thresholds": thresholds,
            "margins": {
                "revenue": revenue,
                "ebe_pct": _pct(totals.get("XD", 0.0), revenue) if revenue else None,
                "net_pct": _pct(totals.get("XI", 0.0), revenue) if revenue else None,
            },
            "working_capital": self.working_capital(companies, fy_start, day),
            "cash_monthly": self.monthly_cash(companies, day, threshold=thresholds["cash_min"] or 0.0),
            "cash_forecast": self.cash_forecast(companies, day),
            "budget": self.budget_status(companies, day, threshold=thresholds["budget_overrun_pct"]),
            "transport": transport,
            "ledger": self.ledger_totals(companies, fy_start, day),
            "expected_credit_loss": self.expected_credit_loss(companies, day, data["receivables"]["aging"]),
            "lock_date": max((d for d in companies.mapped("fiscalyear_lock_date") if d), default=None),
        })
        data["decisions"] = [a for a in data["alerts"] if a.get("status", "alert") == "alert"][:6]
        data["questions"] = self.questions(companies, data)
        return data

    @api.model
    def questions(self, companies, d):
        """Les onze questions du dirigeant : réponse, verdict (green, orange, red, grey) et lecture."""
        th = d["thresholds"]
        wc = d["working_capital"]
        totals = d["income_totals"]
        result, xd, xb = totals.get("XI", 0.0), totals.get("XD", 0.0), totals.get("XB", 0.0)
        out = []

        def q(key, question, answer, verdict, reading):
            out.append({"key": key, "question": question, "answer": answer, "verdict": verdict, "reading": reading})

        # 1. Résultat
        net_pct = _pct(result, xb) if xb else None
        absorbed = (xd - result) / xd * 100 if xd > 0 else None
        reading = f"Marge nette de {_num(net_pct)} %." if net_pct is not None else "Aucun chiffre d'affaires sur l'exercice."
        if xd > 0 and xb:
            reading += (f" L'EBE représente {_num(xd / xb * 100)} % du chiffre d'affaires ; dotations, charges "
                        f"financières et impôts en absorbent {_num(absorbed)} %.")
        elif xb:
            reading += " L'EBE est négatif : l'exploitation ne couvre pas ses charges courantes."
        q("result", "Combien l'entreprise a-t-elle gagné depuis le début de l'exercice ?", _money(result),
          "red" if result <= 0 else "green" if (net_pct or 0) >= 5 else "orange", reading)

        # 2. Après pertes attendues
        ecl = d["expected_credit_loss"]["total"]
        after = result - ecl
        q("result_ifrs", "Ce résultat tient-il après dépréciation des créances (IFRS 9) ?", _money(after),
          "red" if after <= 0 else "orange" if result > 0 and ecl > result * 0.25 else "green",
          f"Perte attendue sur les créances clients de {_money(ecl)} (matrice par ancienneté) : le résultat "
          f"{'reste positif' if after > 0 else 'devient négatif'}.")

        # 3. Trésorerie
        cash = d["cash"]
        monthly = d["cash_monthly"]["summary"]
        forecast = d["cash_forecast"]["month_end"]
        floor = th["cash_min"]
        avg = monthly["average_payments"]
        reading = (f"Seuil de sécurité fixé à {_money(floor)}. " if floor
                   else "Seuil de sécurité non fixé (Administration > Seuils et taux). ")
        if avg:
            reading += (f"Décaissements moyens de {_money(avg)} par mois : la trésorerie en couvre "
                        f"{_num(max(cash, 0.0) / avg)} mois. ")
        reading += f"Prévue fin {forecast['label']} : {_money(forecast['end'])}."
        verdict = ("red" if cash < 0 or (floor and cash < floor)
                   else "orange" if not floor or (floor and forecast["end"] < floor) else "green")
        q("cash", "Ai-je de quoi payer le mois prochain ?", _money(cash), verdict, reading)

        # 4. Créances
        rec = d["receivables"]
        share = wc["overdue_share_pct"]
        limit = th["receivable_overdue_share_pct"] or 20.0
        q("receivables", "Combien mes clients me doivent-ils ?", _money(rec["total"]),
          "grey" if share is None else "red" if share > limit else "orange" if share > limit / 2 else "green",
          (f"{_num(share)} % sont échues, soit {_money(rec['overdue'])}, dont {_money(rec['aging']['plus_90'])} "
           "depuis plus de 90 jours. C'est le premier gisement de trésorerie disponible.")
          if share is not None else "Aucune créance client en cours.")

        # 5. DSO
        dso = wc["dso"]
        target = th["dso_target_days"]
        reading = f"Cible : {_num(target, 0)} jours. " if target else "Cible de recouvrement non fixée. "
        if wc["daily_sales_ttc"]:
            reading += f"Chaque jour de retard immobilise environ {_money(wc['daily_sales_ttc'])}."
        q("dso", "À quelle vitesse suis-je payé ?", "–" if dso is None else f"{_num(dso, 0)} jours",
          "grey" if dso is None else "orange" if not target else
          "green" if dso <= target else "orange" if dso <= target + 15 else "red", reading)

        # 6. DSCR
        dscr = d["dscr"]
        minimum = th["dscr_min"] or 1.2
        debt = d["debt"]
        q("dscr", "Puis-je honorer mes échéances bancaires ?", "–" if dscr is None else _num(dscr, 2),
          "grey" if dscr is None else "red" if dscr < 1 else "orange" if dscr < minimum else "green",
          (f"L'EBE des douze derniers mois couvre {_num(dscr, 2)} fois le service de la dette. Minimum "
           f"{'fixé' if th['dscr_min'] else 'bancaire usuel'} : {_num(minimum, 2)}."
           + (f" Prochaine échéance le {debt['next_due_date']:%d/%m/%Y} : {_money(debt['next_due_amount'])}."
              if debt.get("next_due_date") else ""))
          if dscr is not None else "Aucun service de dette sur douze mois.")

        # 7 et 8. Transport
        tr = d.get("transport")
        if not tr or not tr["rotations"]:
            q("transport", "Mon métier principal est-il rentable ?", "–", "grey", "Aucune rotation validée sur l'exercice.")
            q("vehicles", "Quels camions me coûtent de l'argent ?", "–", "grey", "Aucune rotation validée sur l'exercice.")
        else:
            rate, seuil = tr["margin_rate"], th["transport_margin_min"]
            v = tr["vehicles"]
            after = (f" {len(v['deficit'])} camion(s) sur {v['count']} déficitaire(s) une fois la structure absorbée."
                     if v["basis"] == "net" else " Résultat après charges de structure non encore calculé.")
            q("transport", "Mon métier principal est-il rentable ?", "–" if rate is None else f"{_num(rate)} %",
              "grey" if rate is None else "red" if rate < 0 else "orange" if seuil and rate < seuil else "green",
              f"Marge directe du transport sur {tr['rotations']} rotation(s)"
              + (f", {_num(tr['share_of_revenue_pct'])} % du chiffre d'affaires" if tr["share_of_revenue_pct"] else "")
              + (f", seuil {_num(seuil, 0)} %." if seuil else ".") + after)
            names = ", ".join(x["label"] for x in v["deficit"][:6])
            q("vehicles", "Quels camions me coûtent de l'argent ?", f"{len(v['deficit'])} sur {v['count']}",
              "red" if v["deficit"] else "green",
              (f"{names} : perte cumulée de {_money(-v['loss'])}"
               + (" après charges de structure." if v["basis"] == "net" else " en marge directe (structure non répartie)."))
              if v["deficit"] else ("Toute la flotte couvre ses charges de structure." if v["basis"] == "net"
                                    else "Tous les camions dégagent une marge directe positive."))

        # 9. Budget
        budget = d.get("budget")
        if not budget:
            q("budget", "Suis-je dans mon budget ?", "–", "grey", "Aucun budget saisi pour l'exercice (Activités et budget).")
        else:
            over = [line for line in budget["overruns"] if line["kind"] == "charge"]
            exp = budget["expenses"]
            q("budget", "Suis-je dans mon budget ?", f"{len(over)} ligne(s) en dépassement",
              "green" if not over else "red" if (exp["gap_pct"] or 0) > budget["threshold_pct"] else "orange",
              f"Charges réalisées {_money(exp['actual'])} pour un budget cumulé de {_money(exp['budget'])} à fin "
              f"{month_label(budget['through'])} ; tolérance de {_num(budget['threshold_pct'], 0)} % au-dessus du budget.")

        # 10. Chiffre d'affaires en attente
        if not tr:
            q("unbilled", "Ai-je du chiffre d'affaires qui dort ?", "–", "grey", "Pas d'activité de transport dans cette société.")
        else:
            un = tr["unbilled"]
            old = un["oldest"] and (d["as_of"] - un["oldest"]).days > 30
            q("unbilled", "Ai-je du chiffre d'affaires qui dort ?", f"{un['count']} rotation(s)",
              "green" if not un["count"] else "red" if old else "orange",
              (f"Prestations livrées non facturées : {_money(un['amount'])}. Le produit est acquis : facturez pour le "
               "transformer en créance, puis en trésorerie.") if un["count"]
              else "Toutes les rotations réalisées sont facturées.")

        # 11. Diffusion des comptes
        severe = [a for a in d["alerts"] if a.get("status", "alert") == "alert" and a["severity"] in ("blocking", "critical")]
        ledger = d["ledger"]
        balanced_sheet = abs(wc["balance_sheet_difference"]) < 1
        lock = d["lock_date"]
        q("publishable", "Mes comptes sont-ils diffusables ?",
          f"{len(severe)} alerte(s) critique(s)" if severe else "Aucun blocage",
          "red" if severe or not ledger["balanced"] or not balanced_sheet else "orange" if not lock else "green",
          f"Balance {'équilibrée' if ledger['balanced'] else 'déséquilibrée'}, bilan "
          f"{'équilibré' if balanced_sheet else 'déséquilibré'}, écritures "
          + (f"scellées jusqu'au {lock:%d/%m/%Y}." if lock else "non scellées (aucun mois clôturé)."))
        return out

    # ─── Rapport mensuel de gestion ───────────────────────────────────────

    @api.model
    def management_report(self, companies, day):
        token = next(_DASHBOARD_CALLS)
        _DASHBOARD_CACHE[token] = {}
        metrics = self.with_context(eguitra_dashboard_cache=token)
        m_start, m_end = month_bounds(day)
        try:
            report = super(EguitraFinancePilotage, metrics).management_report(companies, day)
            dash = metrics.dashboard(companies, m_end)
        finally:
            _DASHBOARD_CACHE.pop(token, None)
        syscohada = self.env["eguitra.syscohada"]
        pm_start, pm_end = month_bounds(m_start - timedelta(days=1))
        previous = syscohada.income_statement(companies, pm_start, pm_end)["totals"]
        for line in report["income"]:
            line["previous_month"] = previous.get(line["code"], 0.0)
        cash_month = next((m for m in dash["cash_monthly"]["months"] if m["month"] == m_start.strftime("%Y-%m")), None)
        transport = self.transport_kpis(companies, m_start, m_end)
        if transport:
            transport = dict(transport, unbilled=dict(transport["unbilled"], items=transport["unbilled"]["items"][:10]))
        wc = dash["working_capital"]
        report["kpis"].update({
            "receipts_month": cash_month["receipts"] if cash_month else 0.0,
            "payments_month": cash_month["payments"] if cash_month else 0.0,
            "cash_net_month": cash_month["net"] if cash_month else 0.0,
            "debt_service_fy": dash["debt"]["service_fy"],
            "dso": wc["dso"],
            "bfr": wc["bfr"],
            "payables_overdue": dash["payables"]["overdue"],
            "dscr_min": dash["thresholds"]["dscr_min"],
            "dso_target_days": dash["thresholds"]["dso_target_days"],
        })
        report.update({
            "thresholds": dash["thresholds"],
            "debt": dash["debt"],
            "working_capital": wc,
            "cash_monthly": dash["cash_monthly"],
            "cash_forecast": dash["cash_forecast"] if m_start <= date.today() <= m_end else None,
            "transport_summary": transport,
            "alerts": dash["alerts"],
            "questions": dash["questions"],
        })
        report["reading"] = self._reading(report, dash, previous)
        return report

    def _reading(self, report, dash, previous):
        """Lecture de la période, rédigée : le mois comparé au mois précédent et au même mois de
        l'an dernier, le cumul comparé à l'an dernier, puis trésorerie, tiers, dette, transport, alertes."""
        income = {line["code"]: line for line in report["income"]}
        month = month_label(report["period"]["start"])
        k = report["kpis"]
        paragraphs = []

        ca = income["XB"]
        parts = [f"Le chiffre d'affaires {_de(month)} s'établit à {_money(ca['month'])}"]
        vs_prev, vs_ly = _evolution(ca["month"], previous.get("XB", 0.0)), _evolution(ca["month"], ca["month_last_year"])
        if vs_prev:
            parts.append(f"{vs_prev} sur le mois précédent ({_money(previous.get('XB', 0.0))})")
        if vs_ly:
            parts.append(f"{vs_ly} sur le même mois de l'an dernier ({_money(ca['month_last_year'])})")
        text = ", ".join(parts) + "."
        ytd = _evolution(ca["ytd"], ca["ytd_last_year"])
        text += f" En cumul, l'activité atteint {_money(ca['ytd'])}" + (f", {ytd} sur l'an dernier." if ytd else ".")
        paragraphs.append(text)

        xi = income["XI"]
        net_pct = _pct(xi["ytd"], ca["ytd"]) if ca["ytd"] else None
        text = f"Le résultat net du mois ressort à {_money(xi['month'])} (mois précédent : {_money(previous.get('XI', 0.0))}"
        text += f" ; même mois N-1 : {_money(xi['month_last_year'])})." if xi["month_last_year"] else ")."
        text += f" Le résultat cumulé s'établit à {_money(xi['ytd'])}"
        if net_pct is not None:
            text += f", soit une marge nette de {_num(net_pct)} %"
            ebe = income["XD"]["ytd"]
            text += f" pour un EBE de {_num(ebe / ca['ytd'] * 100)} % du chiffre d'affaires."
        else:
            text += "."
        paragraphs.append(text)

        floor = dash["thresholds"]["cash_min"]
        text = (f"La trésorerie atteint {_money(k['cash'])} en fin de période"
                + (f" pour un seuil de sécurité de {_money(floor)}" if floor else "") + ". "
                f"Le mois dégage un cash net de {_money(k['cash_net_month'])} (encaissements {_money(k['receipts_month'])}, "
                f"décaissements {_money(k['payments_month'])}).")
        low = dash["cash_monthly"]["summary"]["low_point"]
        if low:
            text += f" Point bas de l'exercice fin {low['label']} : {_money(low['end'])}."
        if report.get("cash_forecast"):
            text += f" Prévision de fin de mois : {_money(report['cash_forecast']['month_end']['end'])}."
        paragraphs.append(text)

        wc = report["working_capital"]
        target = dash["thresholds"]["dso_target_days"]
        text = f"Les créances clients atteignent {_money(wc['receivables'])}"
        if wc["overdue_share_pct"] is not None:
            text += f", dont {_num(wc['overdue_share_pct'])} % échues"
        if wc["dso"] is not None:
            text += f" ; le délai moyen de recouvrement de {_num(wc['dso'], 0)} jours"
            if target:
                text += f" {'dépasse' if wc['dso'] > target else 'respecte'} la cible de {_num(target, 0)} jours"
        text += (f". Dettes fournisseurs échues : {_money(k['payables_overdue'])} ; besoin en fonds de roulement : "
                 f"{_money(wc['bfr'])}.")
        paragraphs.append(text)

        debt = report["debt"]
        if debt.get("accounting_outstanding") or debt.get("outstanding"):
            text = (f"La dette financière s'élève à {_money(debt['accounting_outstanding'])} en comptabilité ; le service "
                    f"de la dette de l'exercice atteint {_money(debt['service_fy'])}")
            if k["dscr"] is not None:
                minimum = dash["thresholds"]["dscr_min"] or 1.2
                text += (f", couvert {_num(k['dscr'], 2)} fois par l'EBE des douze derniers mois "
                         f"({'au-dessus' if k['dscr'] >= minimum else 'en dessous'} du minimum de {_num(minimum, 2)})")
            paragraphs.append(text + ".")

        tr = report.get("transport_summary")
        if tr and tr["rotations"]:
            text = f"Le transport compte {tr['rotations']} rotation(s) dans le mois"
            if tr["share_of_revenue_pct"] is not None:
                text += f", {_num(tr['share_of_revenue_pct'])} % du chiffre d'affaires"
            if tr["margin_rate"] is not None:
                text += f", avec une marge directe de {_num(tr['margin_rate'])} %"
            text += "."
            v = tr["vehicles"]
            if v["basis"] == "net":
                text += f" {len(v['deficit'])} camion(s) sur {v['count']} restent déficitaires une fois la structure absorbée."
            if tr["unbilled"]["count"]:
                text += f" {tr['unbilled']['count']} rotation(s) validée(s) attendent leur facture."
            paragraphs.append(text)

        alerts = [a for a in report["alerts"] if a.get("status", "alert") == "alert"]
        severe = [a for a in alerts if a["severity"] in ("blocking", "critical")]
        paragraphs.append(
            f"Le système signale {len(alerts)} alerte(s) active(s), dont {len(severe)} critique(s) ou bloquante(s)."
            if alerts else "Aucune alerte active : tous les seuils fixés sont respectés."
        )
        return paragraphs
