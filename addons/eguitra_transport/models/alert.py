from datetime import timedelta

from odoo import api, fields, models

from .rotation import fmt_m3


class EguitraAlertThreshold(models.Model):
    _inherit = "eguitra.alert.threshold"

    code = fields.Selection(
        selection_add=[("transport_shortage_excess", "Manquants hors tolérance sur 30 jours, au-delà de (m³)")],
        ondelete={"transport_shortage_excess": "cascade"},
    )

    @api.model
    def ensure_defaults(self, company):
        super().ensure_defaults(company)
        # Toute quantité au-delà de la tolérance est signalée (seuil 0 m³), comme le compte de passage.
        if "transport_shortage_excess" not in self._thresholds(company):
            self.sudo().create({"company_id": company.id, "code": "transport_shortage_excess", "value": 0,
                                "severity": "warning"})

    @api.model
    def _company_alerts(self, company, today):
        """Marge transport sous le seuil du dossier et manquants hors tolérance, sur les 30 derniers jours."""
        alerts = super()._company_alerts(company, today)
        thresholds = self._thresholds(company)
        Rotation = self.env["eguitra.transport.rotation"]
        t = thresholds.get("transport_margin_min")
        if t and t.value:
            rows = Rotation.profitability(company, today - timedelta(days=30), today, "vehicle")
            weak = [r for r in rows if r["margin_rate"] is not None and r["margin_rate"] < t.value]
            if weak:
                names = ", ".join(r["label"] for r in weak[:5])
                alerts.append(self._alert(
                    t, "Marge transport sous le seuil",
                    f"{len(weak)} ensemble(s) sous {t.value:.0f} % de marge sur 30 jours : {names}.",
                    None, "/finance/transport",
                ))
        t = thresholds.get("transport_shortage_excess")
        if t:
            rows = [r for r in Rotation.profitability(company, today - timedelta(days=30), today, "driver")
                    if r["shortage_excess"] > 0]
            excess = sum(r["shortage_excess"] for r in rows)
            if rows and excess > (t.value or 0.0):
                count = sum(r["excess_rotations"] for r in rows)
                value = sum(r["shortage_value"] for r in rows)
                worst = ", ".join(f"{r['label']} ({fmt_m3(r['shortage_excess'])})"
                                  for r in sorted(rows, key=lambda r: -r["shortage_excess"])[:3])
                valued = f", valorisés {value:,.0f} GNF".replace(",", " ") if value else ", non valorisés (prix du produit à saisir)"
                alerts.append(self._alert(
                    t, "Manquants au-delà de la tolérance",
                    f"{count} rotation(s), {fmt_m3(excess)} hors tolérance sur 30 jours{valued}. Chauffeurs : {worst}.",
                    excess, "/finance/transport",
                ))
        return alerts
