from datetime import timedelta

from odoo import api, fields, models

WINDOW_MINUTES = 15
# Un identifiant se bloque d'abord pour l'adresse d'où viennent les échecs : un tiers qui connaît
# l'identifiant ne peut plus en interdire l'accès à son titulaire en quelques essais. Le seuil
# toutes adresses confondues freine une attaque répartie ; la double authentification fait le reste.
MAX_FAILURES_PER_LOGIN_IP = 5
MAX_FAILURES_PER_LOGIN = 50
MAX_FAILURES_PER_IP = 50  # un bureau entier sort souvent par une seule adresse


class EguitraApiLoginAttempt(models.Model):
    _name = "eguitra.api.login.attempt"
    _description = "Tentative de connexion à l'API"
    _order = "id desc"
    _log_access = False

    date = fields.Datetime(required=True, default=fields.Datetime.now, index=True)
    login = fields.Char(index=True)
    ip = fields.Char(index=True)
    success = fields.Boolean()
    kind = fields.Selection(
        [("password", "Mot de passe"), ("mfa", "Code de double authentification")],
        default="password",
        required=True,
    )

    @api.model
    def _is_blocked(self, login, ip):
        """Bloqué 15 minutes après 5 échecs (mot de passe ou code) sur l'identifiant depuis une même
        adresse, 50 sur l'identifiant toutes adresses confondues, ou 50 depuis l'adresse."""
        since = fields.Datetime.now() - timedelta(minutes=WINDOW_MINUTES)
        Attempt = self.sudo()
        base = [("success", "=", False), ("date", ">=", since)]
        if login:
            same_ip = base + [("login", "=", login), ("ip", "=", ip or False)]
            if Attempt.search_count(same_ip) >= MAX_FAILURES_PER_LOGIN_IP:
                return True
            if Attempt.search_count(base + [("login", "=", login)]) >= MAX_FAILURES_PER_LOGIN:
                return True
        return bool(ip) and Attempt.search_count(base + [("ip", "=", ip)]) >= MAX_FAILURES_PER_IP

    @api.model
    def _cron_purge(self):
        limit = fields.Datetime.now() - timedelta(days=90)
        self.sudo().search([("date", "<", limit)]).unlink()
