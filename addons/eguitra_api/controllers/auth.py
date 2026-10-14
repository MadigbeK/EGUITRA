"""Connexion, double authentification, renouvellement et fin de session."""

import base64
import os
from urllib.parse import quote

from odoo import fields, http
from odoo.exceptions import AccessDenied
from odoo.http import request

from ..models.api_token import REUSE_GRACE_SECONDS
from .framework import ApiError, api_route, client_ip, json_response, read_json, require, sudo_env

MAX_MFA_ATTEMPTS = 5
APPS = ("finance", "axispro", "portail", "mobile")


def _mfa_required(env):
    return env["ir.config_parameter"].sudo().get_param("eguitra_api.mfa_required", "1") != "0"


def _record_attempt(env, login, success, kind="password"):
    env["eguitra.api.login.attempt"].create(
        {"login": login, "ip": client_ip(), "success": success, "kind": kind}
    )


def _check_not_blocked(env, login):
    if env["eguitra.api.login.attempt"]._is_blocked(login, client_ip()):
        raise ApiError(429, "too_many_attempts", "Trop de tentatives. Réessayez dans 15 minutes.")


def _refusal(status, code, message):
    """Réponse d'échec renvoyée sans annuler la transaction : la trace de l'échec est conservée."""
    return json_response({"error": code, "message": message}, status)


def _totp_code(code):
    code = str(code).replace(" ", "")
    if not (code.isdigit() and len(code) == 6):
        raise ApiError(400, "invalid_code", "Le code comporte 6 chiffres.")
    return int(code)


def _user_agent():
    return request.httprequest.headers.get("User-Agent", "")


def _session_payload(env, user, app, family=None, started=None):
    tokens = env["eguitra.api.token"]._issue_session(
        user, app, family=family, ip=client_ip(), user_agent=_user_agent(), started=started
    )
    return {"status": "ok", **tokens, "user": user.with_env(env)._eguitra_public()}


class EguitraAuthController(http.Controller):
    @api_route("/auth/login", methods=("POST",), auth=False)
    def login(self, **_kw):
        data = read_json()
        login, password, app = require(data, "login", "password", "app")
        login = str(login).strip().lower()
        if app not in APPS:
            raise ApiError(400, "invalid_app", "Application inconnue.")
        env = sudo_env()
        _check_not_blocked(env, login)

        credential = {"type": "password", "login": login, "password": str(password)}
        try:
            auth_info = env["res.users"]._login(credential, {"interactive": True})
        except AccessDenied:
            _record_attempt(env, login, False)
            return _refusal(401, "invalid_credentials", "Identifiant ou mot de passe incorrect.")
        _record_attempt(env, login, True)

        user = env["res.users"].browse(auth_info["uid"])
        if app not in user._eguitra_apps():
            raise ApiError(403, "app_forbidden", "Votre profil ne donne pas accès à cette application.")

        Token = env["eguitra.api.token"]
        if _mfa_required(env):
            if user.totp_enabled:
                raw, _rec = Token._issue(user, "mfa", app, ip=client_ip(), user_agent=_user_agent())
                return {"status": "mfa_required", "mfa_token": raw}
            secret = base64.b32encode(os.urandom(20)).decode()
            raw, _rec = Token._issue(user, "mfa_setup", app, payload=secret, ip=client_ip())
            issuer = "EGUITRA" if app != "axispro" else "AxisPro"
            uri = (
                f"otpauth://totp/{quote(issuer)}:{quote(user.login)}"
                f"?secret={secret}&issuer={quote(issuer)}&algorithm=SHA1&digits=6&period=30"
            )
            return {
                "status": "mfa_setup_required",
                "setup_token": raw,
                "secret": " ".join(secret[i:i + 4] for i in range(0, len(secret), 4)),
                "otpauth_uri": uri,
            }
        return _session_payload(env, user, app)

    def _consume(self, env, raw, kind):
        token = env["eguitra.api.token"]._find(raw, kind)
        if not token or not token._is_valid():
            raise ApiError(401, "invalid_token", "Étape expirée : reconnectez-vous.")
        if token.attempts >= MAX_MFA_ATTEMPTS:
            raise ApiError(401, "invalid_token", "Trop d'essais : reconnectez-vous.")
        # Les échecs de code comptent par utilisateur, tous jetons confondus.
        _check_not_blocked(env, token.user_id.login)
        return token

    def _wrong_code(self, env, token):
        token.attempts += 1
        _record_attempt(env, token.user_id.login, False, kind="mfa")
        return _refusal(401, "invalid_code", "Code incorrect.")

    @api_route("/auth/mfa", methods=("POST",), auth=False)
    def mfa(self, **_kw):
        data = read_json()
        raw, code = require(data, "mfa_token", "code")
        env = sudo_env()
        token = self._consume(env, raw, "mfa")
        user = token.user_id
        try:
            user.with_user(user)._check_credentials({"type": "totp", "token": _totp_code(code)}, {"interactive": True})
        except AccessDenied:
            return self._wrong_code(env, token)
        token.revoked = True
        return _session_payload(env, user, token.app)

    @api_route("/auth/mfa/setup", methods=("POST",), auth=False)
    def mfa_setup(self, **_kw):
        data = read_json()
        raw, code = require(data, "setup_token", "code")
        env = sudo_env()
        token = self._consume(env, raw, "mfa_setup")
        user = token.user_id
        if not user.with_user(user)._totp_try_setting(token.payload, _totp_code(code)):
            return self._wrong_code(env, token)
        token.write({"revoked": True, "payload": False})
        return _session_payload(env, user, token.app)

    @api_route("/auth/refresh", methods=("POST",), auth=False)
    def refresh(self, **_kw):
        data = read_json()
        (raw,) = require(data, "refresh_token")
        env = sudo_env()
        token = env["eguitra.api.token"]._find(raw, "refresh")
        if not token:
            raise ApiError(401, "invalid_token", "Session expirée.")
        now = fields.Datetime.now()
        if token.revoked:
            in_grace = (
                token.revoke_reason == "rotation"
                and token.rotated_at
                and (now - token.rotated_at).total_seconds() <= REUSE_GRACE_SECONDS
                and token.expires_at > now
            )
            if not in_grace:
                # Jeton révoqué (fin de session, sécurité) ou réutilisé hors délai : la lignée est révoquée.
                if token.revoke_reason in (False, "rotation"):
                    token._revoke_family("reuse")
                return _refusal(401, "token_reused", "Session révoquée par sécurité. Reconnectez-vous.")
        elif not token._is_valid():
            raise ApiError(401, "invalid_token", "Session expirée.")
        user = token.user_id
        if not user.active:
            raise ApiError(401, "invalid_token", "Session expirée.")
        if token.app not in user._eguitra_apps():
            token._revoke_family()
            return _refusal(403, "app_forbidden", "Votre profil ne donne plus accès à cette application.")
        if token._session_expired():
            token._revoke_family("logout")
            return _refusal(401, "session_expired", "Session expirée : reconnectez-vous.")
        if not token.revoked:
            token.write({"revoked": True, "revoke_reason": "rotation", "rotated_at": now})
        return _session_payload(env, user, token.app, family=token.family, started=token._session_started())

    @api_route("/auth/logout", methods=("POST",), auth=False)
    def logout(self, **_kw):
        """Fin de session : révoque la lignée du jeton d'accès ou du jeton de renouvellement présenté
        (le jeton d'accès, de 15 minutes, a souvent expiré quand l'utilisateur se déconnecte)."""
        env = sudo_env()
        Token = env["eguitra.api.token"]
        raw = request.httprequest.headers.get("Authorization", "")[7:].strip()
        tokens = Token._find(raw, "access") | Token._find(read_json().get("refresh_token"), "refresh")
        tokens._revoke_family("logout")
        return {"status": "ok"}

    @api_route("/auth/me", methods=("GET",))
    def me(self, **_kw):
        data = request.env.user._eguitra_public()
        data["company_id"] = request.env.company.id  # société de travail (en-tête X-Eguitra-Company)
        return data

    @api_route("/auth/password", methods=("POST",))
    def change_password(self, **_kw):
        data = read_json()
        old, new = require(data, "old_password", "new_password")
        user = request.env.user
        env = sudo_env()
        # L'ancien mot de passe compte comme une connexion : essais bornés, même avec un jeton volé.
        _check_not_blocked(env, user.login)
        try:
            user._check_credentials({"type": "password", "password": old}, {"interactive": True})
        except AccessDenied:
            _record_attempt(env, user.login, False)
            return _refusal(401, "invalid_credentials", "Mot de passe actuel incorrect.")
        if new == old:
            raise ApiError(422, "business_rule", "Le nouveau mot de passe doit être différent.")
        # Le contrôle de robustesse (auth_password_policy) s'applique à l'écriture.
        user.sudo().write({"password": new, "eguitra_password_temporary": False})
        sudo_env()["eguitra.api.token"]._revoke_user(user)
        return {"status": "ok", "message": "Mot de passe modifié. Reconnectez-vous."}


class EguitraHealthController(http.Controller):
    @api_route("/health", methods=("GET",), auth=False)
    def health(self, **_kw):
        request.env.cr.execute("SELECT 1")
        return {"status": "ok", "database": request.env.cr.dbname}
