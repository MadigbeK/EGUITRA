from datetime import timedelta

from odoo import api, fields, models


class EguitraAlertThreshold(models.Model):
    _inherit = "eguitra.alert.threshold"

    @api.model
    def _company_alerts(self, company, today):
        alerts = super()._company_alerts(company, today)
        t = self._thresholds(company).get("approval_delay_days")
        if t and t.value:
            limit = fields.Datetime.now() - timedelta(days=t.value)
            late = self.env["eguitra.approval.request"].sudo().search_count([
                ("company_id", "=", company.id), ("state", "=", "pending"), ("requested_at", "<", limit),
            ])
            if late:
                demandes = "1 demande" if late == 1 else f"{late} demandes"
                jours = "1 jour" if int(t.value) == 1 else f"{int(t.value)} jours"
                alerts.append(self._alert(
                    t, "Validations en retard", f"{demandes} en attente depuis plus de {jours}.",
                    None, "/finance/approbations",
                ))
        return alerts


class EguitraPeriodClose(models.Model):
    _inherit = "eguitra.period.close"

    def _run_controls(self):
        checks = super()._run_controls()
        _start, end = self._bounds()
        pending = self.env["eguitra.approval.request"].sudo().search([
            ("company_id", "=", self.company_id.id), ("state", "=", "pending"),
        ])
        in_period = pending.filtered(
            lambda r: r.res_model == "account.move" and (r._record().date or end) <= end
        )
        checks.append(self._check(
            "pending_approvals", "Aucune pièce en attente de validation sur la période", not in_period, False,
            f"{len(in_period)} {'pièce' if len(in_period) <= 1 else 'pièces'} en attente de validation.", len(in_period),
        ))
        return checks
