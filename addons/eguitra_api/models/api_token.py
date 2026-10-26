import hashlib
import secrets
import uuid
from datetime import timedelta

from odoo import api, fields, models

# Délai pendant lequel un jeton de renouvellement déjà remplacé est encore accepté : plusieurs
# appels parallèles d'un même écran renouvellent la session en même temps.
REUSE_GRACE_SECONDS = 30

# Durées de vie en secondes, surchargeables par paramètre système eguitra_api.ttl_<type>[_<app>].
DEFAULT_TTL = {
    "access": 15 * 60,
    "refresh": 12 * 3600,
    "refresh_mobile": 30 * 24 * 3600,  # saisie au parc, souvent sans réseau
    # Durée totale d'une session, renouvellements compris : au-delà, nouvelle connexion.
    "session": 7 * 24 * 3600,
    "session_mobile": 90 * 24 * 3600,
    "mfa": 5 * 60,
    "mfa_setup": 10 * 60,
}


def hash_token(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


class EguitraApiToken(models.Model):
    _name = "eguitra.api.token"
    _description = "Jeton d'accès à l'API"
    _order = "id desc"

    user_id = fields.Many2one("res.users", required=True, ondelete="cascade", index=True)
    kind = fields.Selection(
        [
            ("access", "Accès"),
            ("refresh", "Renouvellement"),
            ("mfa", "Double authentification"),
            ("mfa_setup", "Activation de la double authentification"),
        ],
        required=True,
    )
    token_hash = fields.Char(required=True, index=True)
    family = fields.Char(index=True, help="Lignée de jetons issue d'une même connexion.")
    family_started_at = fields.Datetime(help="Connexion à l'origine de la lignée : borne la durée totale de la session.")
    app = fields.Char()
    payload = fields.Char(help="Donnée liée au jeton, par exemple le secret en cours d'activation.")
    expires_at = fields.Datetime(required=True, index=True)
    revoked = fields.Boolean(index=True)
    revoke_reason = fields.Selection(
        [("rotation", "Remplacé par le suivant"), ("logout", "Fin de session"), ("reuse", "Réutilisation suspecte"),
         ("security", "Mesure de sécurité")],
        help="Seul un jeton remplacé par rotation bénéficie du délai de grâce.",
    )
    attempts = fields.Integer()
    ip = fields.Char()
    user_agent = fields.Char()
    last_used_at = fields.Datetime()
    rotated_at = fields.Datetime(help="Date de remplacement d'un jeton de renouvellement par le suivant.")
    mfa_passed = fields.Boolean(
        "Second facteur passé",
        help="La connexion à l'origine de la lignée a passé la double authentification. Une lignée ouverte "
             "pendant sa suspension (paramètre eguitra_api.mfa_required à 0) ne la porte pas : elle est "
             "refusée dès que la double authentification est de nouveau exigée.",
    )

    _token_hash_unique = models.Constraint("unique(token_hash)", "Jeton déjà existant.")

    @api.model
    def _ttl(self, kind, app=None):
        params = self.env["ir.config_parameter"].sudo()
        key = f"{kind}_{app}" if app and f"{kind}_{app}" in DEFAULT_TTL else kind
        value = params.get_param(f"eguitra_api.ttl_{key}")
        return int(value) if value else DEFAULT_TTL[key]

    @api.model
    def _ttl_for(self, user, kind, app=None):
        """Les longues durées de Rotations (saisie hors réseau) sont réservées au profil exploitation seul :
        un compte doté d'autres droits, administrateur compris, garde les durées ordinaires."""
        if app == "mobile" and set(user._eguitra_profiles()) - {"exploitation"}:
            app = None
        return self._ttl(kind, app)

    @api.model
    def _issue(self, user, kind, app=None, family=None, payload=None, ip=None, user_agent=None, started=None,
               mfa_passed=False):
        """Crée un jeton et renvoie (valeur en clair, enregistrement). Seule l'empreinte est stockée."""
        raw = secrets.token_urlsafe(32)
        ttl = self._ttl_for(user, kind, app)
        now = fields.Datetime.now()
        record = self.sudo().create(
            {
                "user_id": user.id,
                "kind": kind,
                "token_hash": hash_token(raw),
                "family": family,
                "family_started_at": started or now,
                "app": app,
                "payload": payload,
                "expires_at": now + timedelta(seconds=ttl),
                "ip": ip,
                "user_agent": (user_agent or "")[:250] or False,
                "mfa_passed": bool(mfa_passed),
            }
        )
        return raw, record

    @api.model
    def _find(self, raw, kind):
        """Jeton du type demandé correspondant à la valeur, révoqué ou non (vide si inconnu)."""
        if not raw or not isinstance(raw, str):
            return self.browse()
        return self.sudo().search([("token_hash", "=", hash_token(raw)), ("kind", "=", kind)], limit=1)

    def _is_valid(self):
        self.ensure_one()
        return (
            not self.revoked
            and self.expires_at > fields.Datetime.now()
            and self.user_id.active
        )

    def _session_started(self):
        self.ensure_one()
        return self.family_started_at or self.create_date

    def _session_expired(self):
        """La session a-t-elle dépassé sa durée totale (7 jours, 90 pour Rotations), renouvellements compris ?"""
        self.ensure_one()
        limit = timedelta(seconds=self._ttl_for(self.user_id, "session", self.app))
        return fields.Datetime.now() - self._session_started() > limit

    @api.model
    def _issue_session(self, user, app, family=None, ip=None, user_agent=None, started=None, mfa_passed=False):
        """Jetons d'accès et de renouvellement d'une lignée ; mfa_passed : la connexion a passé le code."""
        family = family or uuid.uuid4().hex
        started = started or fields.Datetime.now()
        access, access_rec = self._issue(user, "access", app, family, ip=ip, user_agent=user_agent, started=started,
                                         mfa_passed=mfa_passed)
        refresh, refresh_rec = self._issue(user, "refresh", app, family, ip=ip, user_agent=user_agent, started=started,
                                           mfa_passed=mfa_passed)
        now = fields.Datetime.now()
        return {
            "access_token": access,
            "access_expires_in": int((access_rec.expires_at - now).total_seconds()),
            "refresh_token": refresh,
            "refresh_expires_in": int((refresh_rec.expires_at - now).total_seconds()),
        }

    def _revoke_family(self, reason="security"):
        """Révoque toute la lignée, y compris les jetons déjà remplacés : plus aucun délai de grâce."""
        families = [f for f in self.mapped("family") if f]
        tokens = self.sudo().search([("family", "in", families)]) if families else self.browse()
        (tokens | self).sudo().write({"revoked": True, "revoke_reason": reason})

    @api.model
    def _revoke_user(self, user, reason="security"):
        self.sudo().search([("user_id", "=", user.id), "|", ("revoked", "=", False), ("revoke_reason", "=", "rotation")]).write(
            {"revoked": True, "revoke_reason": reason}
        )

    @api.model
    def _cron_purge(self):
        limit = fields.Datetime.now() - timedelta(days=30)
        self.sudo().search([("expires_at", "<", limit)]).unlink()
