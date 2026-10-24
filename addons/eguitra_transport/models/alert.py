from datetime import timedelta

from odoo import api, fields, models

from ..nombres import fmt_money, fmt_volume


class EguitraAlertThreshold(models.Model):
    _inherit = "eguitra.alert.threshold"

    code = fields.Selection(
        selection_add=[("transport_shortage_excess", "Manquants hors tolérance sur 30 jours, au-delà de (m³)")],
        ondelete={"transport_shortage_excess": "cascade"},
    )

    @api.model
    def ensure_defaults(self, company):
        super().ensure_defaults(company)
        self._ensure_transport_defaults(company)

    @api.model
    def _ensure_transport_defaults(self, companies=None):
        """Seuil des manquants hors tolérance : toute quantité au-delà de la tolérance est signalée
        (seuil 0 m³), comme le compte de passage. Un seuil archivé (alerte coupée) n'est pas recréé."""
        Threshold = self.sudo().with_context(active_test=False)
        for company in companies or self.env["res.company"].sudo().search([]):
            if not Threshold.search_count([("company_id", "=", company.id), ("code", "=", "transport_shortage_excess")]):
                Threshold.create({"company_id": company.id, "code": "transport_shortage_excess", "value": 0,
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
                    None, "/transport/rentabilite",
                ))
        t = thresholds.get("transport_shortage_excess")
        if t:
            rows = [r for r in Rotation.profitability(company, today - timedelta(days=30), today, "driver")
                    if r["shortage_excess"] > 0]
            excess = sum(r["shortage_excess"] for r in rows)
            if rows and excess > (t.value or 0.0):
                count = sum(r["excess_rotations"] for r in rows)
                value = sum(r["shortage_value"] for r in rows)
                worst = ", ".join(f"{r['label']} ({fmt_volume(r['shortage_excess'])})"
                                  for r in sorted(rows, key=lambda r: -r["shortage_excess"])[:3])
                valued = f", valorisés {fmt_money(value)}" if value else ", non valorisés (prix du produit à saisir)"
                alerts.append(self._alert(
                    t, "Manquants au-delà de la tolérance",
                    f"{count} rotation(s), {fmt_volume(excess)} hors tolérance sur 30 jours{valued}. Chauffeurs : {worst}.",
                    excess, "/transport/manquants",
                ))
        return alerts


class EguitraPeriodClose(models.Model):
    _inherit = "eguitra.period.close"

    def _run_controls(self):
        """Contrôles permanents de la flotte (vigilance, non bloquants) pour une société du transport."""
        checks = super()._run_controls()
        company = self.company_id
        if company.eguitra_entity != "groupe" and not self.env["eguitra.transport.vehicle"].sudo().search_count(
                [("company_id", "=", company.id)], limit=1):
            return checks
        for control in self.env["eguitra.transport.analysis"].sudo().controls(company):
            detail = "; ".join(control["items"][:6])
            if control["count"] > 6:
                detail += f" (et {control['count'] - 6} autre(s))"
            checks.append(self._check(f"transport_{control['code']}", control["label"], control["ok"], False,
                                      f"{detail}. {control['hint']}", control["count"]))
        return checks
