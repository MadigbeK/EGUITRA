"""Administration des utilisateurs : profils, sociétés, mots de passe, double authentification."""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_base.models.res_users import PROFILE_GROUPS

from .framework import ApiError, api_route, int_arg, read_json, require, sudo_env

ADMIN = ("admin",)


def _user_row(user):
    data = user._eguitra_public()
    data.update({"active": user.active, "last_login": user.login_date})
    return data


def _technical_user_ids(env):
    """Comptes techniques du noyau, jamais gérés depuis les applications."""
    return [env.ref("base.user_root").id, env.ref("base.user_admin").id, env.ref("base.public_user").id]


def _scope_domain(env):
    """Utilisateurs gérables : hors comptes techniques, dans les sociétés de l'administrateur."""
    return [
        ("id", "not in", _technical_user_ids(env)),
        ("company_ids", "in", request.env.user.company_ids.ids),
    ]


class EguitraAdminController(http.Controller):
    def _get_user(self, user_id):
        env = sudo_env()
        user = env["res.users"].with_context(active_test=False).search(
            [("id", "=", user_id)] + _scope_domain(env), limit=1
        )
        if not user or set(user.company_ids.ids) - set(request.env.user.company_ids.ids):
            raise ApiError(404, "not_found", "Utilisateur introuvable.")
        return user

    def _apply(self, user, data):
        values = {}
        for field in ("name", "email"):
            if field in data:
                values[field] = data[field]
        if "active" in data:
            values["active"] = bool(data["active"])
        if "company_ids" in data:
            allowed = request.env.user.company_ids.ids
            company_ids = [int(c) for c in data["company_ids"]]
            if not company_ids or set(company_ids) - set(allowed):
                raise ApiError(422, "business_rule", "Sociétés invalides.")
            values["company_ids"] = [(6, 0, company_ids)]
            values["company_id"] = int(data.get("company_id") or company_ids[0])
        if values:
            user.write(values)
        if "profiles" in data:
            try:
                user._eguitra_set_profiles(list(data["profiles"]))
            except ValueError as e:
                raise ApiError(422, "business_rule", str(e)) from e

    @api_route("/admin/profiles", methods=("GET",), profiles=ADMIN)
    def profiles(self, **_kw):
        env = sudo_env()
        return [
            {"code": code, "name": env.ref(xmlid).name, "description": env.ref(xmlid).comment}
            for code, xmlid in PROFILE_GROUPS.items()
        ]

    @api_route("/admin/users", methods=("GET",), profiles=ADMIN)
    def list_users(self, **kw):
        env = sudo_env()
        domain = _scope_domain(env)
        if kw.get("search"):
            domain += ["|", ("name", "ilike", kw["search"]), ("login", "ilike", kw["search"])]
        users = env["res.users"].with_context(active_test=False).search(
            domain, limit=int_arg(kw, "limit", 200, 1, 500), offset=int_arg(kw, "offset", 0, 0), order="name"
        )
        return [_user_row(u) for u in users]

    @api_route("/admin/users", methods=("POST",), profiles=ADMIN)
    def create_user(self, **_kw):
        data = read_json()
        name, login, password, profiles = require(data, "name", "login", "password", "profiles")
        env = sudo_env()
        login = str(login).strip().lower()
        if env["res.users"].with_context(active_test=False).search_count([("login", "=", login)]):
            raise ApiError(409, "conflict", "Cet identifiant existe déjà.")
        user = env["res.users"].with_context(no_reset_password=True).create({
            "name": name,
            "login": login,
            "email": data.get("email") or False,
            "password": password,
            "eguitra_password_temporary": True,
        })
        self._apply(user, {k: v for k, v in data.items() if k in ("company_ids", "company_id", "profiles")})
        return _user_row(user)

    @api_route("/admin/users/<int:user_id>", methods=("GET",), profiles=ADMIN)
    def get_user(self, user_id, **_kw):
        return _user_row(self._get_user(user_id))

    @api_route("/admin/users/<int:user_id>", methods=("PATCH",), profiles=ADMIN)
    def update_user(self, user_id, **_kw):
        user = self._get_user(user_id)
        data = read_json()
        if user == request.env.user and ("active" in data or "profiles" in data):
            raise ApiError(422, "business_rule", "Vous ne pouvez pas modifier vos propres profils ni vous désactiver.")
        self._apply(user, data)
        if data.get("active") is False:
            sudo_env()["eguitra.api.token"]._revoke_user(user)
        return _user_row(user)

    @api_route("/admin/users/<int:user_id>/password", methods=("POST",), profiles=ADMIN)
    def reset_password(self, user_id, **_kw):
        user = self._get_user(user_id)
        (password,) = require(read_json(), "password")
        user.write({"password": password, "eguitra_password_temporary": True})
        sudo_env()["eguitra.api.token"]._revoke_user(user)
        return {"status": "ok"}

    @api_route("/admin/users/<int:user_id>/reset-mfa", methods=("POST",), profiles=ADMIN)
    def reset_mfa(self, user_id, **_kw):
        user = self._get_user(user_id)
        user.totp_secret = False
        sudo_env()["eguitra.api.token"]._revoke_user(user)
        return {"status": "ok"}

    @api_route("/admin/access-log", methods=("GET",), profiles=ADMIN)
    def access_log(self, **kw):
        domain = []
        if kw.get("user_id"):
            domain.append(("user_id", "=", int_arg(kw, "user_id")))
        if kw.get("status_min"):
            domain.append(("status", ">=", int_arg(kw, "status_min")))
        logs = sudo_env()["eguitra.api.access.log"].search(
            domain, limit=int_arg(kw, "limit", 200, 1, 1000), offset=int_arg(kw, "offset", 0, 0)
        )
        return [
            {"date": log.date, "user": log.user_id.name or None, "method": log.method, "path": log.path,
             "status": log.status, "duration_ms": log.duration_ms, "ip": log.ip, "app": log.app}
            for log in logs
        ]
