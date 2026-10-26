"""API du verrou de départ (contrat §9) : évaluation d'une rotation (sans changer son état), départs du
jour, paramétrage des motifs par type de véhicule et par site, rotations du jour du compte (NIMOVA
Terrain). Le départ lui-même est l'action de Transport (POST /transport/rotations/<id>/depart), qui appelle
la même évaluation dans sa transaction."""

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, read_json, require

from ..models.common import VEHICLE_KINDS, HsseqError
from ..models.lock import CURRENT_LOT
from .common import (
    CONFIG,
    companies,
    date_value,
    driver_ref,
    forbidden,
    get,
    hsseq_route,
    ids_list,
    is_hsseq,
    my_driver,
    my_sites,
    rotation_ref,
    scope_level,
    site_allowed,
    site_ref,
    vehicle_ref,
)

EVALUATE = ("admin", "direction", "hsseq", "exploitation", "conducteur")
DEPARTURES = ("admin", "direction", "hsseq", "exploitation")
REASONS_READ = ("admin", "direction", "hsseq", "exploitation", "auditeur")
MY_ROTATIONS = ("admin", "hsseq", "exploitation", "conducteur")


def rotation_allowed(rotation):
    """Le conducteur n'évalue que ses rotations, le chef de parc celles de ses sites."""
    scope = scope_level()
    if scope == "all":
        return True
    if scope == "site":
        return site_allowed(rotation.sudo().vehicle_id.site_id)
    driver = my_driver()
    return bool(driver and rotation.sudo().driver_id == driver)


def reason_setting_row(reason):
    return {"code": reason.code, "label": reason.name, "source": reason.source, "resolution": reason.resolution or None,
            "vehicle_kinds": reason._vehicle_kinds(), "waivable": reason.waivable, "lot": reason.lot,
            "active": reason.enabled, "disabled_sites": [site_ref(s) for s in reason.disabled_site_ids]}


def departures(comps, day, sites=None, vehicle_kind=None, blocked_only=False):
    """Départs du jour : rotations à charger ce jour-là, pas encore parties, avec leur évaluation."""
    domain = [("company_id", "in", comps.ids), ("state", "=", "draft"), ("date_loading", "=", day)]
    if sites:
        domain.append(("vehicle_id.site_id", "in", sites.ids))
    if vehicle_kind and "vehicle_kind" in request.env["eguitra.transport.vehicle"]._fields:
        domain.append(("vehicle_id.vehicle_kind", "=", vehicle_kind))
    detail = is_hsseq()
    items = []
    for rot in request.env["eguitra.transport.rotation"].sudo().search(domain, order="date_loading, id"):
        evaluation = rot._hsseq_evaluate(detail=detail)
        items.append({"rotation": rotation_ref(rot), "vehicle": vehicle_ref(rot.vehicle_id),
                      "driver": driver_ref(rot.driver_id), "site": site_ref(rot.vehicle_id.site_id),
                      "evaluation": evaluation, "pending_checks_only": evaluation["pending_checks_only"]})
    allowed = sum(1 for i in items if i["evaluation"]["allowed"])
    return {"date": day, "total": len(items), "allowed": allowed, "blocked": len(items) - allowed,
            "items": [i for i in items if not i["evaluation"]["allowed"]] if blocked_only else items}


class EguitraHsseqLock(http.Controller):
    @hsseq_route("/hsseq/lock/evaluate", methods=("POST",), profiles=EVALUATE)
    def evaluate(self, **_kw):
        """Évaluation du verrou pour une rotation, journalisée ; l'état de la rotation ne change pas (les
        saisies de terrain faites sans rotation, dans leur fenêtre, lui sont rattachées)."""
        data = read_json()
        require(data, "rotation_id")
        rotation = get("eguitra.transport.rotation", data["rotation_id"], "Rotation")
        if not rotation_allowed(rotation):
            raise ApiError(404, "not_found", "Rotation introuvable.")
        return rotation._hsseq_evaluate(detail=is_hsseq(), log=True, attach=True)

    @hsseq_route("/hsseq/lock/departures", profiles=DEPARTURES)
    def lock_departures(self, **kw):
        day = date_value(kw, "date") or fields.Date.context_today(request.env.user)
        sites = None
        if kw.get("site_id"):
            site = get("eguitra.hsseq.site", kw["site_id"], "Site")
            if not site_allowed(site):
                raise forbidden("Site non autorisé.")
            sites = site
        elif scope_level() == "site":
            sites = my_sites()
            if not sites:
                # Portée fermée par défaut : sans site rattaché, aucun départ.
                return {"date": day, "total": 0, "allowed": 0, "blocked": 0, "items": []}
        return departures(companies(kw), day, sites, kw.get("vehicle_kind"),
                          str(kw.get("blocked", "")) in ("1", "true"))

    @hsseq_route("/hsseq/lock/reasons", profiles=REASONS_READ)
    def reasons(self, **_kw):
        Reason = request.env["eguitra.hsseq.lock.reason"].sudo()
        return [reason_setting_row(r) for r in Reason.search([])]

    @hsseq_route("/hsseq/lock/reasons", methods=("PATCH",), profiles=CONFIG)
    def update_reasons(self, **_kw):
        """Activation d'un motif ({code, active?, vehicle_kinds?, disabled_sites?}) ; un motif du lot 2 ne
        s'active pas, V01 et V03 restent non dérogeables."""
        data = read_json()
        require(data, "code")
        reason = request.env["eguitra.hsseq.lock.reason"].sudo().search([("code", "=", data["code"])], limit=1)
        if not reason:
            raise ApiError(404, "not_found", "Motif inconnu.")
        values = {}
        if "active" in data:
            if data["active"] and reason.lot > CURRENT_LOT:
                raise HsseqError("not_in_lot_1", f"Le motif {reason.code} relève du lot {reason.lot} : il n'est pas "
                                                 "encore évalué.", fields=["active"])
            values["enabled"] = bool(data["active"])
        if "vehicle_kinds" in data:
            kinds = data["vehicle_kinds"] or []
            if not isinstance(kinds, list) or set(kinds) - set(dict(VEHICLE_KINDS)):
                raise ApiError(400, "invalid_parameter", "Types de véhicule : tanker, tipper.", fields=["vehicle_kinds"])
            values.update(tanker="tanker" in kinds, tipper="tipper" in kinds)
        if "disabled_sites" in data:
            ids = ids_list({"ids": [s["id"] if isinstance(s, dict) else s for s in data["disabled_sites"] or []]}, "ids")
            sites = request.env["eguitra.hsseq.site"].sudo().browse(ids).exists()
            if sites.filtered(lambda s: s.company_id not in request.env.companies):
                raise forbidden("Site d'une société non autorisée.")
            values["disabled_site_ids"] = [(6, 0, sites.ids)]
        if "waivable" in data and bool(data["waivable"]) != reason.waivable:
            raise ApiError(422, "business_rule", "Le caractère dérogeable d'un motif ne se modifie pas.",
                           fields=["waivable"])
        reason.write(values)
        request.env["eguitra.hsseq.journal"]._log("lock_reason", reason, "write", note=", ".join(
            f"{key} : {'oui' if value is True else 'non' if value is False else value}" for key, value in values.items()))
        return reason_setting_row(reason)

    @hsseq_route("/hsseq/me/rotations", profiles=MY_ROTATIONS)
    def my_rotations(self, **kw):
        """Rotations du jour (saisies ou en route) : celles du conducteur du compte ; pour un chef de parc,
        celles de ses sites ; pour hsseq et l'administration, toutes."""
        day = date_value(kw, "date") or fields.Date.context_today(request.env.user)
        domain = [("company_id", "in", companies(kw).ids), ("state", "in", ("draft", "en_route")),
                  ("date_loading", "=", day)]
        scope = scope_level()
        if scope == "self":
            driver = my_driver()
            domain.append(("driver_id", "=", driver.id if driver else 0))
        elif scope == "site":
            domain.append(("vehicle_id.site_id", "in", my_sites().ids))
        detail = is_hsseq()
        rows = []
        for rot in request.env["eguitra.transport.rotation"].sudo().search(domain, order="date_loading, id"):
            evaluation = rot._hsseq_evaluate(detail=detail) if rot.state == "draft" else None
            rows.append({
                "id": rot.id, "name": rot.name if rot.name != "/" else None, "date_loading": rot.date_loading,
                "state": rot.state, "vehicle": vehicle_ref(rot.vehicle_id), "site": site_ref(rot.vehicle_id.site_id),
                "driver": driver_ref(rot.driver_id), "route_name": rot.route_id.name or None,
                "lock": {"allowed": evaluation["allowed"], "pending_checks_only": evaluation["pending_checks_only"],
                         "reasons": evaluation["reasons"], "warnings": evaluation["warnings"],
                         "lock_active": evaluation["lock_active"]} if evaluation else None,
            })
        return {"date": day, "items": rows}
