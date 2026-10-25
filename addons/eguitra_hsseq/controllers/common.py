"""Briques communes de l'API HSSEQ (contrat : docs/design/hsseq-contrat.md de la session design).

Les fiches HSSEQ sont lues et écrites en sudo, après le contrôle explicite du profil, de la société, du
site (chef de parc rattaché à des sites) et de la propriété (conducteur, déclarant, responsable d'une
action), comme le libre-service RH : l'identité du compte est conservée (create_uid, journal, piste
d'audit). Le résultat d'un alcootest n'est servi qu'au profil hsseq.
"""

import functools
from datetime import datetime

from odoo import fields
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route

from ..models.common import READ_ALL, HsseqError

# Profils des routes (codes de PROFILE_GROUPS).
APP = ("admin", "direction", "hsseq", "exploitation", "conducteur", "rh")
MANAGERS = ("admin", "direction", "hsseq")
COCKPIT = ("admin", "direction", "hsseq", "exploitation")
DEADLINES = ("admin", "direction", "hsseq", "exploitation", "rh")
CONFIG = ("admin", "hsseq")
FIELD = ("hsseq", "exploitation", "conducteur")
HSSEQ = ("hsseq",)
LOG = ("direction", "hsseq")
MAX_LIMIT = 500


def hsseq_route(route, methods=("GET",), profiles=None):
    """Route de l'API dont les refus métier portent leur code précis (HsseqError -> error)."""

    def decorator(func):
        @functools.wraps(func)
        def inner(self, **kw):
            try:
                return func(self, **kw)
            except HsseqError as e:
                extra = {"fields": e.fields} if e.fields else {}
                raise ApiError(e.status, e.code, e.args[0], **extra) from e

        return api_route(route, methods=methods, profiles=profiles)(inner)

    return decorator


# ─── Compte connecté ──────────────────────────────────────────────────────


def profiles():
    return set(request.env.user._eguitra_profiles())


def is_hsseq():
    return "hsseq" in profiles()


def reads_all():
    """Lecture de toute fiche des sociétés du compte (administration, direction, hsseq)."""
    return bool(profiles() & READ_ALL)


def is_yard():
    """Chef de parc : profil exploitation sans profil de lecture intégrale."""
    return "exploitation" in profiles() and not reads_all()


def scope_level():
    """Portée du compte, accordée par privilège positif : « all » (administration, direction, hsseq),
    « site » (chef de parc, borné à ses sites), « self » pour tout autre compte (conducteur, ou compte d'un
    autre profil métier) : ses propres saisies et rotations seulement."""
    user_profiles = profiles()
    if user_profiles & READ_ALL:
        return "all"
    if "exploitation" in user_profiles:
        return "site"
    return "self"


def is_self_only():
    return scope_level() == "self"


def my_sites():
    """Sites du chef de parc (vide : aucun bornage)."""
    return request.env.user._hsseq_site_ids()


def my_driver():
    return request.env.user._hsseq_driver()


def internal_only():
    if request.env.user.share:
        raise ApiError(403, "forbidden", "Accès réservé aux comptes internes.")


def forbidden(message="Opération non autorisée pour votre profil."):
    return ApiError(403, "forbidden", message)


def companies(kw=None):
    """Sociétés de travail : toutes celles du compte, ou celle du filtre company_id."""
    allowed = request.env.companies
    wanted = (kw or {}).get("company_id")
    if wanted in (None, "", "all"):
        return allowed
    try:
        wanted = int(wanted)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", "Société invalide.") from e
    if wanted not in allowed.ids:
        raise ApiError(403, "forbidden", "Société non autorisée.")
    return allowed.browse(wanted)


def site_allowed(site):
    """Un chef de parc rattaché à des sites ne lit que leurs objets (un objet sans site reste visible)."""
    if not is_yard():
        return True
    sites = my_sites()
    return not sites or not site or site in sites


def get(model, record_id, label="Fiche"):
    """Fiche d'une des sociétés du compte, en sudo (404 sinon, sans révéler son existence)."""
    try:
        record_id = int(record_id)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", "Identifiant invalide.") from e
    record = request.env[model].sudo().browse(record_id).exists()
    if not record or ("company_id" in record._fields and record.company_id
                      and record.company_id not in request.env.companies):
        raise ApiError(404, "not_found", f"{label} introuvable.")
    return record


# ─── Lecture des paramètres ───────────────────────────────────────────────


def int_or_none(data, key):
    value = data.get(key)
    if value in (None, "", 0, "0", False):
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"Identifiant invalide : {key}.", fields=[key]) from e


def ids_list(data, key):
    value = data.get(key) or []
    if isinstance(value, str):
        value = [v for v in value.split(",") if v.strip()]
    try:
        return [int(v) for v in value]
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"Liste d'identifiants invalide : {key}.", fields=[key]) from e


def text(data, key, limit=2000):
    value = data.get(key)
    if value in (None, ""):
        return False
    return str(value).strip()[:limit] or False


def number(data, key, default=0.0):
    value = data.get(key)
    if value in (None, ""):
        return default
    try:
        return float(value)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"Nombre invalide : {key}.", fields=[key]) from e


def date_value(data, key):
    value = data.get(key)
    if value in (None, ""):
        return False
    try:
        return fields.Date.to_date(str(value)[:10])
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"Date invalide : {key}.", fields=[key]) from e


def datetime_value(data, key):
    """Horodatage ISO 8601 (UTC, « Z » ou décalage accepté), rendu sans fuseau comme le noyau les stocke."""
    value = data.get(key)
    if value in (None, ""):
        return False
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as e:
        raise ApiError(400, "invalid_parameter", f"Horodatage invalide : {key}.", fields=[key]) from e
    if parsed.tzinfo:
        parsed = (parsed - parsed.utcoffset()).replace(tzinfo=None)
    return parsed.replace(microsecond=0)


def reported_at(data):
    """Heure de saisie sur l'appareil : jamais dans le futur (au-delà de cinq minutes de décalage d'horloge)."""
    value = datetime_value(data, "reported_at") or fields.Datetime.now()
    now = fields.Datetime.now()
    if (value - now).total_seconds() > 300:
        raise ApiError(400, "invalid_parameter", "Heure de saisie dans le futur.", fields=["reported_at"])
    return value


def gps(data):
    """Position à plat, aux noms des modèles : latitude, longitude, gps_accuracy (mètres)."""
    if not any(data.get(k) not in (None, "") for k in ("latitude", "longitude")):
        return {}
    lat, lon = number(data, "latitude", None), number(data, "longitude", None)
    if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ApiError(400, "invalid_parameter", "Position invalide.", fields=["latitude", "longitude"])
    return {"latitude": lat, "longitude": lon, "gps_accuracy": max(number(data, "gps_accuracy", 0.0), 0.0)}


def gps_fields(record):
    located = bool(record.latitude or record.longitude)
    return {"latitude": record.latitude if located else None, "longitude": record.longitude if located else None,
            "gps_accuracy": (record.gps_accuracy or None) if located else None}


def page_args(kw, default_sort, sorts):
    """offset, limit (50 par défaut, 500 au plus) et ordre (« clé » ou « -clé »)."""
    try:
        offset = max(int(kw.get("offset") or 0), 0)
        limit = min(max(int(kw.get("limit") or 50), 1), MAX_LIMIT)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", "Pagination invalide.") from e
    sort = kw.get("sort") or default_sort
    key, desc = (sort[1:], True) if sort.startswith("-") else (sort, False)
    if key not in sorts:
        raise ApiError(400, "invalid_parameter", "Tri inconnu.", fields=["sort"])
    return offset, limit, f"{sorts[key]} {'desc' if desc else 'asc'}, id desc"


def page(items, total, offset, limit, counts=None):
    return {"items": items, "total_count": total, "offset": offset, "limit": limit, "counts": counts or {}}


def terrain_source():
    return "terrain" if request.httprequest.headers.get("X-Eguitra-App") == "terrain" else "web"


# ─── Références ───────────────────────────────────────────────────────────


def ref(record):
    record = record.sudo()
    return {"id": record.id, "name": record.display_name} if record else None


def user_ref(user):
    return {"id": user.id, "name": user.sudo().name} if user else None


def site_ref(site):
    return {"id": site.id, "name": site.sudo().name} if site else None


def vehicle_ref(vehicle):
    vehicle = vehicle.sudo()
    if not vehicle:
        return None
    return {"id": vehicle.id, "name": vehicle.name,
            "vehicle_kind": vehicle.vehicle_kind if "vehicle_kind" in vehicle._fields else "tanker",
            "plate": vehicle.tractor_plate or None}


def rotation_ref(rotation):
    rotation = rotation.sudo()
    if not rotation:
        return None
    return {"id": rotation.id, "name": rotation.name if rotation.name != "/" else None,
            "date_loading": rotation.date_loading, "route_name": rotation.route_id.name or None,
            "state": rotation.state}


def driver_ref(driver):
    return {"id": driver.id, "name": driver.sudo().name} if driver else None


def company_ref(company):
    return {"id": company.id, "name": company.name} if company else None


def attachments_rows(object_key, records, role=None):
    return [a._row() for a in request.env["eguitra.hsseq.attachment"]._for(object_key, records, role=role)]


def history(object_key, record, limit=200):
    entries = request.env["eguitra.hsseq.journal"].sudo().search(
        [("model", "=", object_key), ("res_id", "=", record.id)], limit=limit)
    return [journal_row(e) for e in entries]


def journal_row(entry):
    return {"id": entry.id, "model": entry.model, "res_id": entry.res_id, "at": entry.at, "by": user_ref(entry.user_id),
            "action": entry.action, "field": entry.field or None, "old_value": entry.old_value or None,
            "new_value": entry.new_value or None, "note": entry.note or None}


def existing_by_uuid(model, client_uuid):
    """Saisie déjà reçue (idempotence) : renvoyée telle quelle à son auteur ; à un autre compte, refusée."""
    if not client_uuid:
        return None
    record = request.env[model].sudo().with_context(active_test=False).search([("client_uuid", "=", client_uuid)],
                                                                              limit=1)
    if not record:
        return None
    author = record.reported_by if "reported_by" in record._fields else \
        record.author_id if "author_id" in record._fields else record.create_uid
    if author != request.env.user:
        raise ApiError(409, "conflict", "Identifiant de saisie déjà utilisé par un autre compte.", fields=["client_uuid"])
    return record


def client_uuid(data):
    value = data.get("client_uuid")
    return str(value).strip()[:64] if value not in (None, "") else False


def claim_attachments(ids, object_key, record, role=None):
    """Pièces citées par une fiche (attachment_ids) : déposées par le compte et pas encore rattachées, ou
    déjà rattachées à cette même fiche. Pièce d'un autre déposant : 403 ; déjà rattachée à une autre fiche :
    409."""
    if not ids:
        return request.env["eguitra.hsseq.attachment"]
    attachments = request.env["eguitra.hsseq.attachment"].sudo().browse(ids).exists()
    if len(attachments) != len(set(ids)):
        raise ApiError(404, "not_found", "Pièce jointe introuvable.", fields=["attachment_ids"])
    for attachment in attachments:
        if attachment.object == object_key and attachment.res_id == record.id:
            continue
        if attachment.object:
            raise ApiError(409, "conflict", f"La pièce « {attachment.name} » est déjà rattachée à une autre fiche.",
                           fields=["attachment_ids"])
        if attachment.author_id != request.env.user:
            raise forbidden("Une pièce déposée par un autre compte ne se cite pas.")
    attachments._link(object_key, record, role)
    return attachments
