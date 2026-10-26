"""Administration des utilisateurs : profils, droits complémentaires, sociétés, mots de passe, double
authentification."""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_base.models.res_users import PROFILE_GROUPS

from ..organisation import PROFILE_ENTITY
from .auth import _password_shared, _refuse_if_password_shared
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

# Modèles sans société propre, qui relèvent de celle de leur parent (champ du parent) : éléments fixes
# du salaire (dossier salarié), saisies d'un bulletin (bulletin de paie), tarifs d'une route. Sans ce
# rattachement, leur piste d'audit passait pour partagée : un administrateur d'une seule société y
# lisait les salaires et les tarifs de l'autre. Un nouveau modèle enfant suivi par l'audit s'inscrit ici.
PARENT_COMPANY = {
    "eguitra.rh.employee.line": "employee_id",
    "eguitra.rh.payslip.input": "payslip_id",
    "eguitra.transport.tariff": "route_id",
}


def _parent_field(env, model):
    """Champ du parent d'un modèle enfant de PARENT_COMPANY, s'il existe dans cette base."""
    field = PARENT_COMPANY.get(model)
    return field if field and model in env and field in env[model]._fields else None


def _owner(record):
    """Sociétés dont relève un enregistrement : la société elle-même pour sa fiche, toutes les sociétés
    d'un compte utilisateur (comme _scope_domain), sa société, celles d'un compte du plan comptable
    (account.account n'a pas de company_id mais company_ids), ou celle de son parent (PARENT_COMPANY)."""
    if record._name == "res.company":
        return record
    if record._name == "res.users":
        return record.company_ids
    parent = _parent_field(record.env, record._name)
    if parent:
        return _owner(record[parent])
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
        if model != "res.company" and "company_id" not in fields and not multi and not _parent_field(env, model):
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
        # Après les profils : un droit accordé d'office avec un profil (saisie libre des comptes) peut
        # être retiré dans le même enregistrement.
        if "rights" in data:
            try:
                user._eguitra_set_rights(data["rights"] or {})
            except ValueError as e:
                raise ApiError(422, "business_rule", str(e)) from e
        try:
            user._eguitra_check_companies()
        except ValueError as e:
            raise ApiError(422, "business_rule", str(e)) from e

    @api_route("/admin/profiles", methods=("GET",), profiles=ADMIN)
    def profiles(self, **_kw):
        env = sudo_env()
        return [
            {"code": code, "name": env.ref(xmlid).name, "description": env.ref(xmlid).comment,
             "entity": PROFILE_ENTITY.get(code)}
            for code, xmlid in PROFILE_GROUPS.items()
        ]

    @api_route("/admin/rights", methods=("GET",), profiles=ADMIN)
    def rights(self, **_kw):
        """Droits complémentaires aux profils (déclarés par les modules, voir res.users._eguitra_right_groups)."""
        env = sudo_env()
        return [
            {"code": code, "name": env.ref(xmlid).name, "description": env.ref(xmlid).comment or None}
            for code, xmlid in env["res.users"]._eguitra_right_groups().items()
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
            "eguitra_password_temporary": not _password_shared(env),
        })
        self._apply(user, {k: v for k, v in data.items() if k in ("company_ids", "company_id", "profiles", "rights")})
        return _user_row(user)

    @api_route("/admin/users/<int:user_id>", methods=("GET",), profiles=ADMIN)
    def get_user(self, user_id, **_kw):
        return _user_row(self._get_user(user_id))

    @api_route("/admin/users/<int:user_id>", methods=("PATCH",), profiles=ADMIN)
    def update_user(self, user_id, **_kw):
        user = self._get_user(user_id)
        data = read_json()
        if user == request.env.user and ("active" in data or "profiles" in data or "rights" in data):
            raise ApiError(422, "business_rule", "Vous ne pouvez pas modifier vos propres profils ou droits ni vous "
                                                 "désactiver.")
        self._apply(user, data)
        if data.get("active") is False:
            sudo_env()["eguitra.api.token"]._revoke_user(user)
        return _user_row(user)

    @api_route("/admin/users/<int:user_id>/password", methods=("POST",), profiles=ADMIN)
    def reset_password(self, user_id, **_kw):
        user = self._get_user(user_id)
        (password,) = require(read_json(), "password")
        _refuse_if_password_shared(sudo_env())
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
