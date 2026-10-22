from odoo import fields, models


class ResUsers(models.Model):
    _inherit = "res.users"

    def _eguitra_apps(self):
        """Un compte interne lié à un dossier salarié en cours ouvre l'espace RH, réduit à « Mon espace »."""
        apps = super()._eguitra_apps()
        if "rh" not in apps and not self.share and self._eguitra_employees():
            apps.append("rh")
        return apps

    def _eguitra_employees(self):
        """Dossiers salariés en cours liés au compte (un par société au plus)."""
        self.ensure_one()
        today = fields.Date.context_today(self)
        return self.env["eguitra.rh.employee"].sudo().search([
            ("user_id", "=", self.id), ("hire_date", "<=", today),
            "|", ("exit_date", "=", False), ("exit_date", ">=", today),
        ])
