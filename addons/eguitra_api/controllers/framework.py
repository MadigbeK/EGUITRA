"""Cadre commun des routes de l'API : authentification par jeton, erreurs, JSON, journal d'accès.

Chaque route est déclarée avec @api_route. La requête est exécutée sous l'identité de
l'utilisateur du jeton : les droits et les règles d'accès du noyau s'appliquent. En cas
d'erreur, la transaction est annulée avant la réponse, et l'appel est journalisé dans un
curseur séparé pour que la trace survive à l'annulation.
"""

import functools
import json
import logging
import time
from datetime import date, datetime
from decimal import Decimal

from odoo import SUPERUSER_ID, api, http
from odoo.exceptions import AccessDenied, AccessError, MissingError, UserError, ValidationError
from odoo.http import request

from ..organisation import APPS, module_entity, wrong_company_message

_logger = logging.getLogger(__name__)

API_PREFIX = "/api/v1"
COMPANY_HEADER = "X-Eguitra-Company"
APP_HEADER = "X-Eguitra-App"
# Seules routes ouvertes tant que le mot de passe provisoire (remis par l'administrateur) n'est pas changé.
TEMPORARY_PASSWORD_ROUTES = ("/auth/me", "/auth/password", "/auth/logout")


class ApiError(Exception):
    def __init__(self, status, code, message=None, **extra):
        super().__init__(message or code)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra


def _json_default(value):
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds") + "Z"
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (set, frozenset, tuple)):
        return list(value)
    if hasattr(value, "_name") and hasattr(value, "ids"):  # enregistrements du noyau
        return value.ids
    raise TypeError(f"Valeur non sérialisable : {type(value)!r}")


def json_response(payload, status=200):
    body = json.dumps(payload, default=_json_default, ensure_ascii=False)
    return request.make_response(
        body,
        headers=[
            ("Content-Type", "application/json; charset=utf-8"),
            ("Cache-Control", "no-store"),
        ],
        status=status,
    )


def read_json():
    raw = request.httprequest.get_data(cache=True)
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError as e:
        raise ApiError(400, "invalid_json", "Le corps de la requête n'est pas un JSON valide.") from e
    if not isinstance(data, dict):
        raise ApiError(400, "invalid_json", "Le corps de la requête doit être un objet JSON.")
    return data


def require(data, *keys):
    missing = [k for k in keys if data.get(k) in (None, "")]
    if missing:
        raise ApiError(400, "missing_fields", "Champs obligatoires manquants.", fields=missing)
    return [data[k] for k in keys]


def client_ip():
    return request.httprequest.remote_addr


def sudo_env():
    return api.Environment(request.env.cr, SUPERUSER_ID, dict(request.env.context))


def int_arg(kwargs, name, default=None, minimum=None, maximum=None):
    value = kwargs.get(name)
    if value in (None, ""):
        return default
    try:
        value = int(value)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"Paramètre {name} invalide.") from e
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def _bearer_token():
    header = request.httprequest.headers.get("Authorization", "")
    if header[:7].lower() == "bearer ":
        return header[7:].strip()
    return None


def _authenticate():
    raw = _bearer_token()
    token = sudo_env()["eguitra.api.token"]._find(raw, "access")
    if not token or not token._is_valid():
        raise ApiError(401, "unauthenticated", "Session expirée ou invalide.")
    # Pas d'écriture sur le jeton ici : les appels parallèles d'un même écran se bloqueraient.
    user = token.user_id
    request.update_env(user=user.id)
    request.update_context(lang=user.lang or "fr_FR", tz=user.tz or "Africa/Conakry")
    _set_companies(request.env.user)
    return request.env.user, token


def _set_companies(user):
    """Société courante. Une application qui ne sert qu'une société (AxisPro Suite et le portail :
    MB AxisPro Consulting ; Rotations : EGUITRA GROUP) y travaille toujours, même pour un compte
    ouvert aux deux sociétés. Sinon : en-tête X-Eguitra-Company si autorisée, à défaut la société
    de l'utilisateur."""
    allowed = user.company_ids.ids
    wanted = request.httprequest.headers.get(COMPANY_HEADER)
    current = user.company_id.id
    entity = APPS.get(request.httprequest.headers.get(APP_HEADER), {}).get("entity")
    if entity:
        scoped = user.company_ids.filtered(lambda c: c.eguitra_entity == entity)
        if not scoped:
            raise ApiError(403, "app_forbidden", "Votre compte n'est pas ouvert à la société de cette application.")
        if wanted and wanted.isdigit() and int(wanted) in scoped.ids:
            scoped = scoped.browse(int(wanted)) | scoped
        request.update_context(allowed_company_ids=scoped.ids)
        return
    if wanted:
        try:
            wanted = int(wanted)
        except ValueError as e:
            raise ApiError(400, "invalid_company", "Société invalide.") from e
        if wanted not in allowed:
            raise ApiError(403, "company_forbidden", "Société non autorisée.")
        current = wanted
    request.update_context(allowed_company_ids=[current] + [c for c in allowed if c != current])


def _log_access(user_id, status, started, app):
    try:
        with request.env.registry.cursor() as cr:
            env = api.Environment(cr, SUPERUSER_ID, {})
            env["eguitra.api.access.log"].create(
                {
                    "user_id": user_id,
                    "method": request.httprequest.method,
                    "path": request.httprequest.path[:250],
                    "status": status,
                    "duration_ms": int((time.monotonic() - started) * 1000),
                    "ip": client_ip(),
                    "app": app,
                }
            )
    except Exception:
        _logger.exception("Journal d'accès API : écriture impossible")


def _error(status, code, message=None, **extra):
    request.env.cr.rollback()
    payload = {"error": code}
    if message:
        payload["message"] = message
    payload.update(extra)
    return json_response(payload, status)


def api_route(route, methods=("GET",), profiles=None, auth=True):
    """Déclare une route de l'API.

    :param profiles: profils autorisés (codes de PROFILE_GROUPS) ; None = tout utilisateur connecté.
    :param auth: False pour les routes publiques (connexion, santé).
    Un module réservé à une société (organisation.MODULE_ENTITY) refuse de travailler dans l'autre.
    La fonction décorée reçoit les paramètres d'URL et renvoie un objet sérialisable en JSON,
    ou une réponse HTTP déjà construite (fichier).
    """

    entity = module_entity(route)

    def decorator(func):
        @functools.wraps(func)
        def wrapper(self, **kwargs):
            started = time.monotonic()
            app = (request.httprequest.headers.get(APP_HEADER) or "")[:20] or None
            user_id = None
            status = 500
            try:
                if auth:
                    user, _token = _authenticate()
                    user_id = user.id
                    if user.eguitra_password_temporary and route not in TEMPORARY_PASSWORD_ROUTES:
                        raise ApiError(403, "password_change_required",
                                       "Remplacez d'abord votre mot de passe provisoire.")
                    if profiles and not set(profiles) & set(user._eguitra_profiles()):
                        raise ApiError(403, "forbidden", "Accès non autorisé pour votre profil.")
                    if entity and request.env.company.eguitra_entity != entity:
                        raise ApiError(422, "wrong_company", wrong_company_message(entity))
                result = func(self, **kwargs)
                response = result if isinstance(result, http.Response) else json_response(result)
                status = response.status_code
                return response
            except ApiError as e:
                status = e.status
                return _error(e.status, e.code, e.message, **e.extra)
            except (AccessError, AccessDenied) as e:
                status = 403
                return _error(403, "forbidden", str(e.args[0]) if e.args else None)
            except MissingError as e:
                status = 404
                return _error(404, "not_found", str(e.args[0]) if e.args else None)
            except (UserError, ValidationError) as e:
                status = 422
                return _error(422, "business_rule", str(e.args[0]) if e.args else None)
            except Exception:
                _logger.exception("Erreur API sur %s", request.httprequest.path)
                status = 500
                return _error(500, "server_error", "Erreur interne. L'incident est journalisé.")
            finally:
                # Le contrôle de santé (conteneur, supervision : toutes les 30 s) n'est pas un accès.
                if route != "/health":
                    _log_access(user_id, status, started, app)

        return http.route(
            API_PREFIX + route,
            type="http",
            auth="none",
            methods=list(methods),
            csrf=False,
            save_session=False,
            # En 19.0, une route auth="none" est en lecture seule par défaut.
            readonly=False,
        )(wrapper)

    return decorator
