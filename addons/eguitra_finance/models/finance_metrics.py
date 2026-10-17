"""Indicateurs financiers calculés à la volée sur les écritures comptabilisées.

Toutes les requêtes portent sur les écritures validées (parent_state = 'posted') des sociétés
demandées ; les montants sont en devise de la société (GNF). Les sociétés sont toujours
fournies par l'appelant, filtrées sur celles auxquelles l'utilisateur a accès.
"""

from datetime import date, timedelta

from dateutil.relativedelta import relativedelta

from odoo import api, models

ACC_CODE = "COALESCE(aa.code_store->>(aml.company_id::text), '')"


def month_bounds(day):
    first = day.replace(day=1)
    return first, first + relativedelta(months=1, days=-1)


class EguitraFinanceMetrics(models.AbstractModel):
    _name = "eguitra.finance.metrics"
    _description = "Indicateurs financiers EGUITRA"

    # ─── Briques SQL ──────────────────────────────────────────────────────

    def _sum_balance(self, companies, prefixes, date_from=None, date_to=None):
        """Somme des soldes (débit - crédit) des comptes dont le code commence par un des préfixes."""
        self.env.flush_all()  # les requêtes SQL doivent voir les écritures en attente
        where = ["aml.parent_state = 'posted'", "aml.company_id = ANY(%(companies)s)", f"{ACC_CODE} LIKE ANY(%(patterns)s)"]
        params = {"companies": list(companies.ids), "patterns": [p + "%" for p in prefixes]}
        if date_from:
            where.append("aml.date >= %(date_from)s")
            params["date_from"] = date_from
        if date_to:
            where.append("aml.date <= %(date_to)s")
            params["date_to"] = date_to
        self.env.cr.execute(
            f"""SELECT COALESCE(SUM(aml.balance), 0)
                  FROM account_move_line aml
                  JOIN account_account aa ON aa.id = aml.account_id
                 WHERE {' AND '.join(where)}""",
            params,
        )
        return float(self.env.cr.fetchone()[0])

    def account_balances(self, companies, date_to, date_from=None, exclude_partner_ids=None):
        """Solde par code de compte (toutes sociétés confondues), à une date ou sur une période ;
        exclude_partner_ids écarte les lignes de ces tiers (éliminations intra-groupe)."""
        self.env.flush_all()  # les requêtes SQL doivent voir les écritures en attente
        where = ["aml.parent_state = 'posted'", "aml.company_id = ANY(%(companies)s)", "aml.date <= %(date_to)s"]
        params = {"companies": list(companies.ids), "date_to": date_to}
        if date_from:
            where.append("aml.date >= %(date_from)s")
            params["date_from"] = date_from
        if exclude_partner_ids:
            # Les comptes de trésorerie restent : un règlement entre sociétés du groupe déplace la
            # trésorerie de l'une à l'autre, le total du groupe n'en change pas.
            where.append("(aml.partner_id IS NULL OR aml.partner_id <> ALL(%(excluded)s) "
                         "OR aa.account_type = 'asset_cash')")
            params["excluded"] = list(exclude_partner_ids)
        self.env.cr.execute(
            f"""SELECT {ACC_CODE} AS code, SUM(aml.balance)
                  FROM account_move_line aml
                  JOIN account_account aa ON aa.id = aml.account_id
                 WHERE {' AND '.join(where)}
              GROUP BY 1""",
            params,
        )
        return {code: float(balance) for code, balance in self.env.cr.fetchall() if code}

    def fiscal_year_bounds(self, company, day):
        """Exercice comptable contenant la date (clôture au 31 décembre par défaut)."""
        last_month = int(company.fiscalyear_last_month or 12)
        last_day = int(company.fiscalyear_last_day or 31)
        end = date(day.year, last_month, 1) + relativedelta(day=last_day)
        if day > end:
            end = end + relativedelta(years=1)
        start = end - relativedelta(years=1) + timedelta(days=1)
        return start, end

    # ─── Indicateurs ──────────────────────────────────────────────────────

    def revenue(self, companies, date_from, date_to):
        """Chiffre d'affaires SYSCOHADA (comptes 70), hors taxes."""
        return -self._sum_balance(companies, ["70"], date_from, date_to)

    def net_result(self, companies, date_from, date_to):
        """Résultat net : produits moins charges des classes 6, 7 et 8."""
        return -self._sum_balance(companies, ["6", "7", "8"], date_from, date_to)

    def purchases(self, companies, date_from, date_to):
        return self._sum_balance(companies, ["60", "61", "62", "63"], date_from, date_to)

    def cash(self, companies, date_to):
        """Trésorerie nette : soldes de la classe 5 (banques, caisses, crédits de trésorerie)."""
        return self._sum_balance(companies, ["5"], None, date_to)

    def cash_by_journal(self, companies, date_to):
        journals = self.env["account.journal"].sudo().search(
            [("type", "in", ("bank", "cash")), ("company_id", "in", companies.ids)], order="company_id, sequence, id"
        )
        if not journals:
            return []
        self.env.flush_all()
        self.env.cr.execute(
            """SELECT aml.account_id, COALESCE(SUM(aml.balance), 0), COALESCE(SUM(aml.amount_currency), 0)
                 FROM account_move_line aml
                WHERE aml.parent_state = 'posted' AND aml.date <= %s AND aml.account_id = ANY(%s)
             GROUP BY aml.account_id""",
            (date_to, journals.default_account_id.ids),
        )
        by_account = {acc: (float(bal), float(cur)) for acc, bal, cur in self.env.cr.fetchall()}
        rows = []
        for journal in journals:
            balance, in_currency = by_account.get(journal.default_account_id.id, (0.0, 0.0))
            foreign = journal.currency_id and journal.currency_id != journal.company_id.currency_id
            rows.append({
                "journal_id": journal.id,
                "name": journal.name,
                "type": journal.type,
                "company": journal.company_id.name,
                "currency": (journal.currency_id or journal.company_id.currency_id).name,
                "balance": balance,
                "balance_currency": in_currency if foreign else balance,
            })
        return rows

    def open_items(self, companies, account_type, today):
        """Encours non lettrés (clients ou fournisseurs) des pièces datées au plus tard ce jour :
        échu, ancienneté par tranche, nombre de pièces par tranche. Les restes à payer sont ceux du
        jour du calcul (un règlement postérieur à la date d'arrêté est déjà déduit)."""
        self.env.flush_all()  # les requêtes SQL doivent voir les écritures en attente
        buckets = {
            "non_echu": "aml.date_maturity >= %(today)s OR aml.date_maturity IS NULL",
            "1_30": "%(today)s - aml.date_maturity BETWEEN 1 AND 30",
            "31_60": "%(today)s - aml.date_maturity BETWEEN 31 AND 60",
            "61_90": "%(today)s - aml.date_maturity BETWEEN 61 AND 90",
            "plus_90": "%(today)s - aml.date_maturity > 90",
        }
        amounts = ", ".join(f"COALESCE(SUM(CASE WHEN {cond} THEN aml.amount_residual END), 0)" for cond in buckets.values())
        counts = ", ".join(f"COUNT(DISTINCT CASE WHEN {cond} THEN aml.move_id END)" for cond in buckets.values())
        self.env.cr.execute(
            f"""SELECT COALESCE(SUM(aml.amount_residual), 0),
                       COALESCE(SUM(CASE WHEN aml.date_maturity < %(today)s THEN aml.amount_residual END), 0),
                       COUNT(DISTINCT aml.move_id),
                       COUNT(DISTINCT CASE WHEN aml.date_maturity < %(today)s THEN aml.move_id END),
                       {amounts}, {counts}
                  FROM account_move_line aml
                  JOIN account_account aa ON aa.id = aml.account_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s)
                   AND aa.account_type = %(account_type)s AND NOT aml.reconciled AND aml.date <= %(today)s""",
            {"today": today, "companies": list(companies.ids), "account_type": account_type},
        )
        row = self.env.cr.fetchone()
        total, overdue, count, overdue_count = float(row[0]), float(row[1]), int(row[2]), int(row[3])
        values = [float(v) for v in row[4:4 + len(buckets)]]
        numbers = [int(v) for v in row[4 + len(buckets):]]
        sign = -1 if account_type == "liability_payable" else 1
        return {
            "total": sign * total,
            "overdue": sign * overdue,
            "documents": count,
            "overdue_documents": overdue_count,
            "aging": {key: sign * value for key, value in zip(buckets, values)},
            "aging_count": dict(zip(buckets, numbers)),
        }

    def monthly_series(self, companies, months, today, prefixes, sign=-1):
        """Montant par mois sur les N derniers mois (mois courant inclus)."""
        self.env.flush_all()  # les requêtes SQL doivent voir les écritures en attente
        start = (today.replace(day=1) - relativedelta(months=months - 1))
        self.env.cr.execute(
            f"""SELECT to_char(date_trunc('month', aml.date), 'YYYY-MM'), COALESCE(SUM(aml.balance), 0)
                  FROM account_move_line aml
                  JOIN account_account aa ON aa.id = aml.account_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = ANY(%(companies)s)
                   AND aml.date >= %(start)s AND aml.date <= %(today)s
                   AND {ACC_CODE} LIKE ANY(%(patterns)s)
              GROUP BY 1""",
            {"companies": list(companies.ids), "start": start, "today": today, "patterns": [p + "%" for p in prefixes]},
        )
        found = {month: float(amount) for month, amount in self.env.cr.fetchall()}
        series = []
        for i in range(months):
            key = (start + relativedelta(months=i)).strftime("%Y-%m")
            series.append({"month": key, "amount": sign * found.get(key, 0.0)})
        return series

    def by_analytic_plan(self, companies, plan, date_from, date_to):
        """Produits, charges et marge par compte analytique d'un axe."""
        self.env.flush_all()  # les requêtes SQL doivent voir les écritures en attente
        column = plan._column_name()
        self.env.cr.execute(
            f"""SELECT aal.{column},
                       COALESCE(SUM(CASE WHEN {ACC_CODE.replace('aml.', 'aal.')} LIKE '7%%' THEN aal.amount END), 0),
                       COALESCE(SUM(CASE WHEN {ACC_CODE.replace('aml.', 'aal.')} LIKE '6%%' THEN -aal.amount END), 0)
                  FROM account_analytic_line aal
                  JOIN account_account aa ON aa.id = aal.general_account_id
                 WHERE aal.company_id = ANY(%(companies)s) AND aal.date BETWEEN %(date_from)s AND %(date_to)s
                   AND aal.{column} IS NOT NULL
              GROUP BY 1""",
            {"companies": list(companies.ids), "date_from": date_from, "date_to": date_to},
        )
        rows = self.env.cr.fetchall()
        accounts = self.env["account.analytic.account"].sudo().browse([r[0] for r in rows])
        names = {a.id: a.name for a in accounts}
        result = []
        for account_id, income, expense in rows:
            income, expense = float(income), float(expense)
            result.append({
                "analytic_account_id": account_id,
                "name": names.get(account_id, "?"),
                "income": income,
                "expense": expense,
                "margin": income - expense,
                "margin_rate": (income - expense) / income * 100 if income else None,
            })
        return sorted(result, key=lambda r: -r["income"])

    # ─── Tableau de bord du dirigeant ─────────────────────────────────────

    @api.model
    def dashboard(self, companies, today=None):
        today = today or date.today()
        main = companies[:1]
        fy_start, fy_end = self.fiscal_year_bounds(main, today)
        m_start, m_end = month_bounds(today)
        pm_start, pm_end = month_bounds(m_start - timedelta(days=1))
        receivables = self.open_items(companies, "asset_receivable", today)
        payables = self.open_items(companies, "liability_payable", today)
        activity_plan = self.env.ref("eguitra_base.analytic_plan_activite", raise_if_not_found=False)
        statement = self.env["eguitra.syscohada"].income_statement(companies, fy_start, today)
        debt = self.env["eguitra.loan"].debt_summary(companies, today)
        ebe_12m = self.env["eguitra.syscohada"].income_statement(
            companies, today - relativedelta(years=1) + timedelta(days=1), today
        )["totals"].get("XD", 0.0)
        # DSCR : excédent brut d'exploitation des 12 derniers mois / service de la dette de la
        # même période (à défaut, des 12 prochains mois pour un financement récent).
        service_12m = debt["service_last_12m"] or debt["service_next_12m"]
        return {
            "companies": [{"id": c.id, "name": c.name} for c in companies],
            "as_of": today,
            "fiscal_year": {"start": fy_start, "end": fy_end},
            "revenue_fy": self.revenue(companies, fy_start, today),
            "revenue_month": self.revenue(companies, m_start, today),
            "revenue_prev_month": self.revenue(companies, pm_start, pm_end),
            "net_result_fy": statement["totals"].get("XI", 0.0),
            "ebe_fy": statement["totals"].get("XD", 0.0),
            "income_totals": statement["totals"],
            "purchases_fy": self.purchases(companies, fy_start, today),
            "cash": self.cash(companies, today),
            "cash_by_journal": self.cash_by_journal(companies, today),
            "receivables": receivables,
            "payables": payables,
            "revenue_by_month": self.monthly_series(companies, 12, today, ["70"]),
            "result_by_month": self.monthly_series(companies, 12, today, ["6", "7", "8"]),
            "by_activity": self.by_analytic_plan(companies, activity_plan, fy_start, today) if activity_plan else [],
            "debt": debt,
            "dscr": (ebe_12m / service_12m) if service_12m else None,
            "alerts": self.env["eguitra.alert.threshold"].active_alerts(companies, today),
        }

    # ─── Rapport mensuel de gestion ───────────────────────────────────────

    def management_report(self, companies, day):
        """Rapport mensuel de gestion du mois contenant day : indicateurs, résultat du mois et
        cumulé (comparé à l'an dernier), activités, trésorerie, flux, transport, alertes."""
        m_start, m_end = month_bounds(day)
        dash = self.dashboard(companies, m_end)
        fy_start = dash["fiscal_year"]["start"]
        syscohada = self.env["eguitra.syscohada"]
        keys = ("XB", "XC", "XD", "XE", "XF", "XH", "XI")
        labels = {"XB": "Chiffre d'affaires", "XC": "Valeur ajoutée", "XD": "Excédent brut d'exploitation",
                  "XE": "Résultat d'exploitation", "XF": "Résultat financier", "XH": "Résultat HAO",
                  "XI": "Résultat net"}
        month = syscohada.income_statement(companies, m_start, m_end)["totals"]
        month_ly = syscohada.income_statement(companies, m_start - relativedelta(years=1),
                                              m_end - relativedelta(years=1))["totals"]
        ytd = syscohada.income_statement(companies, fy_start, m_end)["totals"]
        ytd_ly = syscohada.income_statement(companies, fy_start - relativedelta(years=1),
                                            m_end - relativedelta(years=1))["totals"]
        flows = {line["code"]: line["amount"] for line in syscohada.cash_flow(companies, fy_start, m_end)["lines"]}
        transport = []
        if "eguitra.transport.rotation" in self.env:
            transport = self.env["eguitra.transport.rotation"].profitability(companies, m_start, m_end, "vehicle")
        return {
            "month": m_start.strftime("%Y-%m"),
            "period": {"start": m_start, "end": m_end, "fiscal_year_start": fy_start},
            "companies": dash["companies"],
            "kpis": {
                "revenue_month": dash["revenue_month"], "revenue_prev_month": dash["revenue_prev_month"],
                "revenue_fy": dash["revenue_fy"], "net_result_fy": dash["net_result_fy"], "ebe_fy": dash["ebe_fy"],
                "cash": dash["cash"], "receivables": dash["receivables"]["total"],
                "receivables_overdue": dash["receivables"].get("overdue", 0.0), "payables": dash["payables"]["total"],
                "dscr": dash["dscr"],
            },
            "income": [{"code": k, "label": labels[k], "month": month.get(k, 0.0), "month_last_year": month_ly.get(k, 0.0),
                        "ytd": ytd.get(k, 0.0), "ytd_last_year": ytd_ly.get(k, 0.0)} for k in keys],
            "by_activity": dash["by_activity"],
            "cash_by_journal": dash["cash_by_journal"],
            "cash_flow": {k: flows.get(k, 0.0) for k in ("ZA", "ZB", "ZC", "ZF", "ZG", "ZH")},
            "transport": transport,
            "debt": dash["debt"],
            "alerts": dash["alerts"],
        }
