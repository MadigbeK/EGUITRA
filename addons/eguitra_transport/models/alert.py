from datetime import timedelta

from odoo import api, models


class EguitraAlertThreshold(models.Model):
    _inherit = "eguitra.alert.threshold"

    @api.model
    def _company_alerts(self, company, today):
        """Marge transport sous le seuil du dossier, sur les 30 derniers jours."""
        alerts = super()._company_alerts(company, today)
        t = self._thresholds(company).get("transport_margin_min")
        if t and t.value:
            rows = self.env["eguitra.transport.rotation"].profitability(company, today - timedelta(days=30), today, "vehicle")
            weak = [r for r in rows if r["margin_rate"] is not None and r["margin_rate"] < t.value]
            if weak:
                names = ", ".join(r["label"] for r in weak[:5])
                alerts.append(self._alert(
                    t, "Marge transport sous le seuil",
                    f"{len(weak)} ensemble(s) sous {t.value:.0f} % de marge sur 30 jours : {names}.",
                    None, "/finance/transport",
                ))
        return alerts
