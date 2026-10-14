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
    """Comptes techniques du noyau (dont le modèle des comptes du portail), jamais gérés depuis les applications."""
    ids = [env.ref("base.user_root").id, env.ref("base.user_admin").id, env.ref("base.public_user").id]
    template = env.ref("base.template_portal_user_id", raise_if_not_found=False)
    if template:
        ids.append(template.id)
    param = env["ir.config_parameter"].sudo().get_param("base.template_portal_user_id") or ""
    if param.isdigit():
        ids.append(int(param))
    return ids


def _scope_domain(env):
    """Utilisateurs gérables : hors comptes techniques, dans les sociétés de l'administrateur et dans
    elles seules (un compte ouvert aussi à une autre société relève d'un administrateur des deux)."""
    domain = [
        ("id", "not in", _technical_user_ids(env)),
        ("company_ids", "in", request.env.user.company_ids.ids),
    ]
    others = env["res.company"].search([]) - request.env.user.company_ids
    if others:
        domain.append(("company_ids", "not in", others.ids))
    return domain


def _scoped_user_ids(env):
    return env["res.users"].with_context(active_test=False).search(_scope_domain(env)).ids


def _all_companies(env):
    """L'administrateur a-t-il accès à toutes les sociétés de la plateforme ?"""
    return not (env["res.company"].search([]) - request.env.user.company_ids)


AUDIT_SCAN_MAX = 5000  # entrées examinées au plus par appel (pagination après filtrage)


def _owner(record):
    """Sociétés dont relève un enregistrement : la société elle-même pour sa fiche, toutes les sociétés
    d'un compte utilisateur (comme _scope_domain), sa société, ou celles d'un compte du plan comptable
    (account.account n'a pas de company_id mais company_ids)."""
    if record._name == "res.company":
        return record
    if record._name == "res.users":
        return record.company_ids
    if "company_id" in record._fields:
        return record.company_id
    return record.company_ids


def _owner_visible(record_name, owner, allowed):
    """Un compte utilisateur ne relève que d'un administrateur de toutes ses sociétés ; un autre
    enregistrement, d'un administrateur de l'une d'elles (compte du plan partagé)."""
    if not owner:
        return True
    return owner <= allowed if record_name == "res.users" else bool(owner & allowed)


def _audit_visible(env, logs, user_ids):
    """Entrées de la piste d'audit visibles par l'administrateur : enregistrements de ses sociétés
    ou sans société ; enregistrement supprimé depuis : selon l'auteur de l'action."""
    allowed = request.env.user.company_ids
    company_of = {}
    for model in set(logs.mapped("model_id.model")):
        if model not in env:
            continue
        fields = env[model]._fields
        multi = "company_ids" in fields and fields["company_ids"].comodel_name == "res.company"
        if model != "res.company" and "company_id" not in fields and not multi:
            continue
        ids = logs.filtered(lambda log, m=model: log.model_id.model == m).mapped("res_id")
        records = env[model].with_context(active_test=False).browse(ids).exists()
        company_of[model] = {record.id: _owner(record) for record in records}
    visible = []
    for log in logs:
        companies = company_of.get(log.model_id.model)
        if companies is None:
            visible.append(log)  # modèle sans société : donnée partagée
        elif log.res_id in companies:
            if _owner_visible(log.model_id.model, companies[log.res_id], allowed):
                visible.append(log)
        elif log.user_id.id in user_ids:
            visible.append(log)
    return visible


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
        """Journal des accès des utilisateurs gérés par l'administrateur ; les accès anonymes
        (connexions refusées, jetons invalides) seulement pour un administrateur de toutes les sociétés."""
        env = sudo_env()
        domain = [("user_id", "in", _scoped_user_ids(env))]
        if _all_companies(env):
            domain = ["|", ("user_id", "=", False)] + domain
        if kw.get("user_id"):
            domain.append(("user_id", "=", int_arg(kw, "user_id")))
        if kw.get("status_min"):
            domain.append(("status", ">=", int_arg(kw, "status_min")))
        logs = env["eguitra.api.access.log"].search(
            domain, limit=int_arg(kw, "limit", 200, 1, 1000), offset=int_arg(kw, "offset", 0, 0)
        )
        return [
            {"date": log.date, "user": log.user_id.name or None, "method": log.method, "path": log.path,
             "status": log.status, "duration_ms": log.duration_ms, "ip": log.ip, "app": log.app}
            for log in logs
        ]

    @api_route("/admin/audit", methods=("GET",), profiles=ADMIN)
    def audit(self, **kw):
        """Piste d'audit : création, modification, suppression, avec valeurs avant et après."""
        domain = []
        if kw.get("model"):
            domain.append(("model_id.model", "=", kw["model"]))
        if kw.get("user_id"):
            domain.append(("user_id", "=", int_arg(kw, "user_id")))
        if kw.get("res_id"):
            domain.append(("res_id", "=", int_arg(kw, "res_id")))
        env = sudo_env()
        user_ids = set(_scoped_user_ids(env))
        limit, offset = int_arg(kw, "limit", 100, 1, 500), int_arg(kw, "offset", 0, 0)
        logs, skipped, scanned = [], 0, 0
        while len(logs) < limit and scanned < AUDIT_SCAN_MAX:
            batch = env["auditlog.log"].search(domain, limit=500, offset=scanned, order="id desc")
            if not batch:
                break
            scanned += len(batch)
            for log in _audit_visible(env, batch, user_ids):
                if skipped < offset:
                    skipped += 1
                elif len(logs) < limit:
                    logs.append(log)
        return [
            {
                "id": log.id,
                "date": log.create_date,
                "user": log.user_id.name or None,
                "model": log.model_id.name,
                "model_code": log.model_id.model,
                "res_id": log.res_id,
                "record": log.name or None,
                "method": log.method,
                "lines": [
                    {"field": line.field_description or line.field_id.field_description, "old": line.old_value_text,
                     "new": line.new_value_text}
                    for line in log.line_ids
                ],
            }
            for log in logs
        ]
