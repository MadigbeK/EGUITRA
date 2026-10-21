"""Engagements dans le suivi budgétaire : pour chaque ligne de charges ou d'investissement, le reste à
engager des engagements approuvés dont le compte relève de la ligne (et, si la ligne en porte, de son
activité ou de son centre de coût), et le disponible = budget de l'année - réalisé - engagé."""

from odoo import api, models


class EguitraBudgetLine(models.Model):
    _inherit = "eguitra.budget.line"

    @api.model
    def execution(self, budget, month, axis=None):
        result = super().execution(budget, month, axis=axis)
        company = budget.company_id or self.env.company
        commitments = self.env["eguitra.commitment"].sudo().search([
            ("company_id", "=", company.id), ("state", "=", "approved"),
            ("date", ">=", budget.date_from), ("date", "<=", budget.date_to),
        ])
        lines = {line.id: line for line in budget.eguitra_line_ids}
        total = 0.0
        for row in result["lines"]:
            line = lines.get(row["id"])
            committed = 0.0
            if line and line.nature in ("expense", "capex") and line.prefixes():
                scope = set(line._scope())
                for c in commitments:
                    code = c.account_id.code or ""
                    if not code.startswith(tuple(line.prefixes())):
                        continue
                    if scope and not scope & {int(k) for key in (c.analytic_distribution or {}) for k in key.split(",")}:
                        continue
                    committed += max(0.0, c.remaining)
            row["committed"] = committed
            row["available"] = (row.get("annual") or 0.0) - row["actual"] - committed if line and line.nature != "income" else None
            total += committed
        result["summary"]["committed"] = total
        return result
