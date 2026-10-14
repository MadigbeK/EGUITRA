"""Seuils d'alerte paramétrables et alertes actives du tableau de bord du dirigeant."""

from datetime import timedelta

from odoo import api, fields, models

ALERT_CODES = [
    ("cash_min", "Trésorerie minimale (GNF)"),
    ("receivable_overdue_days", "Créances échues depuis plus de (jours)"),
    ("receivable_overdue_amount", "Encours clients échu maximal (GNF)"),
    ("close_delay_days", "Clôture mensuelle en retard de plus de (jours)"),
    ("transit_account", "Compte de passage 585 non soldé"),
    ("transport_margin_min", "Marge transport minimale (%)"),
    ("budget_overrun_pct", "Dépassement budgétaire toléré (%)"),
    ("approval_delay_days", "Validation en attente depuis plus de (jours)"),
]


class EguitraAlertThreshold(models.Model):
    _name = "eguitra.alert.threshold"
    _description = "Seuil d'alerte"
    _order = "company_id, code"

    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    code = fields.Selection(ALERT_CODES, required=True)
    value = fields.Float(help="Valeur du seuil ; 0 désactive les seuils de montant.")
    severity = fields.Selection(
        [("info", "Information"), ("warning", "Attention"), ("blocking", "Bloquante")],
        default="warning",
        required=True,
        help="Une alerte bloquante interdit la clôture mensuelle.",
    )
    active = fields.Boolean(default=True)

    _code_company_unique = models.Constraint("unique(company_id, code)", "Un seul seuil par code et par société.")

    @api.model
    def _thresholds(self, company):
        records = self.sudo().search([("company_id", "=", company.id)])
        return {r.code: r for r in records}

    def _alert(self, threshold, title, message, value=None, link=None, company=None):
        return {
            "code": threshold.code,
            "severity": threshold.severity,
            "title": title,
            "message": message,
            "value": value,
            "threshold": threshold.value,
            "link": link,
            "company": (company or threshold.company_id).name,
        }

    @api.model
    def _company_alerts(self, company, today):
        """Alertes d'une société ; les modules métier complètent cette liste par héritage."""
        self.env.flush_all()
        metrics = self.env["eguitra.finance.metrics"]
        thresholds = self._thresholds(company)
        alerts = []

        t = thresholds.get("cash_min")
        if t and t.value:
            cash = metrics.cash(company, today)
            if cash < t.value:
                alerts.append(self._alert(t, "Trésorerie sous le seuil",
                                          "La trésorerie nette est inférieure au seuil fixé.", cash, "/finance/tresorerie"))

        t = thresholds.get("receivable_overdue_days")
        if t and t.value:
            limit = today - timedelta(days=int(t.value))
            self.env.cr.execute(
                """SELECT COALESCE(SUM(aml.amount_residual), 0), COUNT(DISTINCT aml.move_id)
                     FROM account_move_line aml JOIN account_account aa ON aa.id = aml.account_id
                    WHERE aml.parent_state = 'posted' AND aml.company_id = %s AND aa.account_type = 'asset_receivable'
                      AND NOT aml.reconciled AND aml.date_maturity < %s""",
                (company.id, limit),
            )
            amount, count = self.env.cr.fetchone()
            if count:
                alerts.append(self._alert(
                    t, "Créances anciennes",
                    f"{count} facture(s) échue(s) depuis plus de {int(t.value)} jours.", float(amount), "/finance/tiers",
                ))

        t = thresholds.get("receivable_overdue_amount")
        if t and t.value:
            overdue = metrics.open_items(company, "asset_receivable", today)["overdue"]
            if overdue > t.value:
                alerts.append(self._alert(t, "Encours échu élevé",
                                          "L'encours clients échu dépasse le seuil fixé.", overdue, "/finance/tiers"))

        t = thresholds.get("transit_account")
        if t:
            balance = metrics._sum_balance(company, ["585"], None, today)
            if abs(balance) > 0.5:
                alerts.append(self._alert(t, "Compte de passage non soldé",
                                          "Un virement interne n'a pas été réceptionné (compte 585).", balance,
                                          "/finance/tresorerie"))

        t = thresholds.get("close_delay_days")
        if t and t.value:
            last_month_end = today.replace(day=1) - timedelta(days=1)
            closed = self.env["eguitra.period.close"].sudo().search_count([
                ("company_id", "=", company.id), ("period", "=", last_month_end.replace(day=1)), ("state", "=", "closed"),
            ])
            has_entries = self.env["account.move"].sudo().search_count([
                ("company_id", "=", company.id), ("state", "=", "posted"), ("date", "<=", last_month_end),
            ], limit=1)
            if has_entries and not closed and (today - last_month_end).days > t.value:
                alerts.append(self._alert(t, "Clôture en retard",
                                          f"Le mois de {last_month_end:%m/%Y} n'est pas clôturé.", None, "/finance/clotures"))
        return alerts

    @api.model
    def active_alerts(self, companies, today):
        alerts = []
        for company in companies:
            alerts += self._company_alerts(company, today)
        order = {"blocking": 0, "warning": 1, "info": 2}
        return sorted(alerts, key=lambda a: order.get(a["severity"], 3))

    @api.model
    def ensure_defaults_all(self):
        for company in self.env["res.company"].sudo().search([]):
            self.ensure_defaults(company)

    @api.model
    def ensure_defaults(self, company):
        """Seuils par défaut d'une société, à ajuster par l'administration."""
        defaults = {
            "cash_min": (0, "warning"),
            "receivable_overdue_days": (60, "warning"),
            "receivable_overdue_amount": (0, "warning"),
            "close_delay_days": (10, "warning"),
            "transit_account": (0, "blocking"),
            "transport_margin_min": (15, "warning"),
            "budget_overrun_pct": (10, "warning"),
            "approval_delay_days": (3, "info"),
        }
        existing = self._thresholds(company)
        for code, (value, severity) in defaults.items():
            if code not in existing:
                self.sudo().create({"company_id": company.id, "code": code, "value": value, "severity": severity})
