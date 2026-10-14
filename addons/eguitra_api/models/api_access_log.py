from datetime import timedelta

from odoo import api, fields, models

RETENTION_DAYS = 365  # journaux d'accès conservés 12 mois (offre, chapitre 5.3)


class EguitraApiAccessLog(models.Model):
    _name = "eguitra.api.access.log"
    _description = "Journal des accès à l'API"
    _order = "id desc"
    _log_access = False

    date = fields.Datetime(required=True, default=fields.Datetime.now, index=True)
    user_id = fields.Many2one("res.users", ondelete="set null", index=True)
    method = fields.Char()
    path = fields.Char()
    status = fields.Integer(index=True)
    duration_ms = fields.Integer()
    ip = fields.Char()
    app = fields.Char()

    @api.model
    def _cron_purge(self):
        limit = fields.Datetime.now() - timedelta(days=RETENTION_DAYS)
        self.sudo().search([("date", "<", limit)]).unlink()
