"""Briques communes de l'API HSSEQ (contrat : docs/design/hsseq-contrat.md de la session design).

Les fiches HSSEQ sont lues et écrites en sudo, après le contrôle explicite du profil, de la société, du
site (chef de parc ou auditeur rattaché à des sites) et de la propriété (conducteur, déclarant,
responsable d'une action), comme le libre-service RH : l'identité du compte est conservée (create_uid,
journal, piste d'audit). Le résultat d'un alcootest n'est servi qu'au profil hsseq.

Profil auditeur : lecture seule (toute route d'écriture refusée), bornée à ses sites, fermée par défaut
(sans site audité, toute route est refusée ; un objet sans site lui reste invisible), et à sa date de fin
d'accès (au-delà, ou sans date, toute route est refusée en 403) ; jamais les alcootests, et les noms des
personnes en cause retirés (personal_data_hidden).

Portée par site « fermée par défaut », sur toutes les routes (site_allowed, yard_domain, site_scope) : un
compte sans profil de lecture complète (chef de parc, auditeur) ne lit que les objets de ses sites, et
aucun s'il n'a pas de site rattaché ; un objet sans site n'est lu que par les profils de lecture complète
(et par son déclarant, son auteur ou son responsable).
"""

import functools
from datetime import datetime

from odoo import fields
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route

from ..models.common import READ_ALL, HsseqError, today

# Profils des routes (codes de PROFILE_GROUPS).
APP = ("admin", "direction", "hsseq", "exploitation", "conducteur", "rh", "auditeur")
MANAGERS = ("admin", "direction", "hsseq")
COCKPIT = ("admin", "direction", "hsseq", "exploitation")
COCKPIT_READ = COCKPIT + ("auditeur",)
DEADLINES = ("admin", "direction", "hsseq", "exploitation", "rh")
CONFIG = ("admin", "hsseq")
FIELD = ("hsseq", "exploitation", "conducteur")
HSSEQ = ("hsseq",)
LOG = ("direction", "hsseq")
# Lecture de l'auditeur (lecture seule, bornée à ses sites et à sa date de fin d'accès).
AUDITOR = ("auditeur",)
MAX_LIMIT = 500


def auditor_guard():
    """Compte auditeur : refusé (403) au-delà de sa date de fin d'accès, ou sans date ; en lecture seule."""
    if "auditeur" not in profiles():
        return
    user = request.env.user.sudo()
    until = user.hsseq_audit_until
    if not until or today(request.env) > until:
        raise ApiError(403, "forbidden", "Accès d'auditeur échu ou sans date de fin : demandez sa prolongation au "
                                         "Responsable HSSEQ." if until else
                                         "Accès d'auditeur sans date de fin : le Responsable HSSEQ la fixe d'abord.")
    if "exploitation" not in profiles() and not user.hsseq_audit_site_ids and not reads_all():
        raise ApiError(403, "forbidden", "Périmètre d'audit sans site : le Responsable HSSEQ le définit d'abord.")
    if request.httprequest.method not in ("GET", "HEAD"):
        raise ApiError(403, "forbidden", "Profil auditeur : lecture seule.")


def hsseq_route(route, methods=("GET",), profiles=None):
    """Route de l'API dont les refus métier portent leur code précis (HsseqError -> error) ; le compte
    auditeur y est borné (auditor_guard)."""

    def decorator(func):
        @functools.wraps(func)
        def inner(self, **kw):
            try:
                auditor_guard()
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


def is_auditor():
    return "auditeur" in profiles()


def is_yard():
    """Lecture bornée aux sites du compte : chef de parc (profil exploitation) ou auditeur, sans profil de
    lecture intégrale."""
    return bool(profiles() & {"exploitation", "auditeur"}) and not reads_all()


def personal_data_hidden():
    """Les noms des personnes (conducteurs, victimes, témoins, déclarants) ne sont pas servis à l'auditeur."""
    return is_auditor() and not reads_all()


def scope_level():
    """Portée du compte, accordée par privilège positif : « all » (administration, direction, hsseq),
    « site » (chef de parc ou auditeur, borné à ses sites), « self » pour tout autre compte (conducteur, ou
    compte d'un autre profil métier) : ses propres saisies et rotations seulement."""
    user_profiles = profiles()
    if user_profiles & READ_ALL:
        return "all"
    if user_profiles & {"exploitation", "auditeur"}:
        return "site"
    return "self"


def is_self_only():
    return scope_level() == "self"


def my_sites():
    """Sites du chef de parc, sinon ceux de l'auditeur (vide : aucun bornage)."""
    user = request.env.user
    if is_auditor() and "exploitation" not in profiles():
        return user.sudo().hsseq_audit_site_ids
    return user._hsseq_site_ids()


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
    """Un compte borné par site (chef de parc, auditeur) ne lit que les objets de ses sites, fermé par
    défaut : aucun sans site rattaché, ni un objet sans site."""
    if not is_yard():
        return True
    return bool(site) and site in my_sites()


def yard_domain(field="site_id"):
    """Domaine de site d'un compte borné par site (is_yard), selon site_allowed (liste vide : rien)."""
    return [(field, "in", my_sites().ids)]


def site_scope(full=READ_ALL):
    """Portée « fermée par défaut » : None pour un profil de lecture complète (full) ; sinon les sites du
    compte (chef de parc, auditeur), vide s'il n'en a pas."""
    if profiles() & set(full):
        return None
    return my_sites()


def in_scope(site, full=READ_ALL):
    """L'objet de ce site est-il dans la portée fermée par défaut ? (sans site : profils complets seuls)"""
    scope = site_scope(full)
    return scope is None or bool(site and site in scope)


def scope_domain(field="site_id", full=READ_ALL):
    """Domaine de la portée fermée par défaut ([] : tout ; liste vide de sites : rien)."""
    scope = site_scope(full)
    return [] if scope is None else [(field, "in", scope.ids)]


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
    if not driver:
        return None
    return {"id": driver.id, "name": None if personal_data_hidden() else driver.sudo().name}


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
