from datetime import timedelta

from odoo import api, fields, models

WINDOW_MINUTES = 15
MAX_FAILURES_PER_LOGIN = 5
MAX_FAILURES_PER_IP = 20


class EguitraApiLoginAttempt(models.Model):
    _name = "eguitra.api.login.attempt"
    _description = "Tentative de connexion à l'API"
    _order = "id desc"
    _log_access = False

    date = fields.Datetime(required=True, default=fields.Datetime.now, index=True)
    login = fields.Char(index=True)
    ip = fields.Char(index=True)
    success = fields.Boolean()

    @api.model
    def _is_blocked(self, login, ip):
        since = fields.Datetime.now() - timedelta(minutes=WINDOW_MINUTES)
        base = [("success", "=", False), ("date", ">=", since)]
        if login and self.sudo().search_count(base + [("login", "=", login)]) >= MAX_FAILURES_PER_LOGIN:
            return True
        return bool(ip) and self.sudo().search_count(base + [("ip", "=", ip)]) >= MAX_FAILURES_PER_IP

    @api.model
    def _cron_purge(self):
        limit = fields.Datetime.now() - timedelta(days=90)
        self.sudo().search([("date", "<", limit)]).unlink()
