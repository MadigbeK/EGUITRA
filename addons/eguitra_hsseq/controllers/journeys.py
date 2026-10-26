"""API des motifs V07, V08 et V09 du verrou (spécification §4) : plan de trajet d'une rotation et sa
validation par l'exploitation (V08), routes interdites de nuit, nouvelle pesée après délestage (V07),
immobilisation d'un véhicule par un événement et sa levée (V09).

Écritures du chef de parc (plan, validation, pesée) : rotation pas encore partie, ensemble d'un de ses
sites (portée fermée par défaut). Immobilisation et levée : profil hsseq seul, levée avec motif."""

from datetime import timedelta

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, read_json, require

from ..models.common import STOP_KINDS, fr_number
from .common import (
    CONFIG,
    HSSEQ,
    companies,
    datetime_value,
    driver_ref,
    forbidden,
    get,
    history,
    hsseq_route,
    in_scope,
    int_or_none,
    is_hsseq,
    my_driver,
    number,
    page,
    page_args,
    reads_all,
    rotation_ref,
    scope_domain,
    site_ref,
    text,
    user_ref,
    vehicle_ref,
)

JOURNEY_READ = ("admin", "direction", "hsseq", "exploitation", "conducteur", "auditeur")
YARD = ("exploitation",)
ROUTES_READ = ("admin", "direction", "hsseq", "exploitation", "auditeur")
IMMOBILIZATION_READ = ("admin", "direction", "hsseq", "exploitation", "auditeur")


def can_read_rotation(rotation):
    """Lecture complète, rotation d'un site du compte (fermé par défaut), ou rotation du conducteur."""
    rotation = rotation.sudo()
    if reads_all() or in_scope(rotation.vehicle_id.site_id):
        return True
    driver = my_driver()
    return bool(driver and rotation.driver_id == driver)


def yard_rotation(rotation_id):
    """Rotation qu'un chef de parc modifie : de ses sites (fermé par défaut), pas encore partie."""
    rotation = get("eguitra.transport.rotation", rotation_id, "Rotation")
    if not in_scope(rotation.sudo().vehicle_id.site_id, full=()):
        raise forbidden("Rotation d'un ensemble hors de vos sites.")
    if rotation.state != "draft":
        raise ApiError(422, "invalid_transition", "Rotation déjà partie : le plan et la pesée ne se modifient plus.")
    return rotation


def journey_row(rotation):
    rotation = rotation.sudo()
    journey = rotation._hsseq_journey()
    settings = request.env["eguitra.hsseq.settings"]._get(rotation.company_id)
    yard = "exploitation" in request.env.user._eguitra_profiles() and in_scope(rotation.vehicle_id.site_id, full=())
    editable = yard and rotation.state == "draft"
    row = {
        "rotation": rotation_ref(rotation), "vehicle": vehicle_ref(rotation.vehicle_id),
        "driver": driver_ref(rotation.driver_id), "site": site_ref(rotation.vehicle_id.site_id),
        "route": {"id": rotation.route_id.id, "name": rotation.route_id.name,
                  "origin": rotation.route_id.origin or None, "destination": rotation.route_id.destination or None,
                  "distance_km": rotation.route_id.distance_km or None,
                  "duration_days": rotation.route_id.duration_days or None,
                  "night_driving_forbidden": rotation.route_id.hsseq_night_forbidden} if rotation.route_id else None,
        "rules": {"night_start_hour": settings.night_start_hour, "night_end_hour": settings.night_end_hour,
                  "max_driving_hours": settings.max_driving_hours},
        "journey": None,
        "transitions": [],
        "rights": {"can_edit": editable, "can_close": False, "can_approve": False},
    }
    if journey:
        issues = journey._issues(settings)
        row["journey"] = {
            "id": journey.id, "itinerary": journey.itinerary or None, "planned_departure": journey.planned_departure,
            "planned_arrival": journey.planned_arrival, "night_driving": journey.night_driving,
            "drives_at_night": journey._drives_at_night(settings),
            "driving_hours_by_day": [{"date": d, "hours": round(h, 2)} for d, h in sorted(journey._driving_by_day().items())],
            "stops": [{"id": s.id, "kind": s.kind, "place": s.place or None, "planned_at": s.planned_at,
                       "duration_minutes": s.duration_minutes} for s in journey.stop_ids],
            "status": journey.status, "validated_by": user_ref(journey.validated_by),
            "validated_at": journey.validated_at or None, "issues": issues,
            "history": history("journey", journey),
        }
        validate = editable and journey.status != "validated" and not issues
        row["transitions"] = ["validate"] if validate else []
        row["rights"]["can_approve"] = validate
    return row


def journey_values(data):
    values = {"itinerary": text(data, "itinerary", 4000), "night_driving": bool(data.get("night_driving"))}
    for key in ("planned_departure", "planned_arrival"):
        values[key] = datetime_value(data, key)
        if not values[key]:
            raise ApiError(400, "missing_fields", "Départ et arrivée prévus sont obligatoires.", fields=[key])
    if values["planned_arrival"] <= values["planned_departure"]:
        raise ApiError(400, "invalid_parameter", "L'arrivée prévue suit le départ prévu.", fields=["planned_arrival"])
    stops = []
    for stop in data.get("stops") or []:
        if not isinstance(stop, dict) or stop.get("kind", "break") not in dict(STOP_KINDS):
            raise ApiError(400, "invalid_parameter", "Arrêt : kind stop, break ou rest.", fields=["stops"])
        planned = datetime_value(stop, "planned_at")
        minutes = int(number(stop, "duration_minutes", 0))
        if not planned or minutes <= 0:
            raise ApiError(400, "invalid_parameter", "Arrêt : heure prévue et durée positive.", fields=["stops"])
        if planned < values["planned_departure"] or planned + timedelta(minutes=minutes) > values["planned_arrival"]:
            raise ApiError(400, "invalid_parameter", "Un arrêt se tient entre le départ et l'arrivée prévus.",
                           fields=["stops"])
        stops.append((0, 0, {"kind": stop.get("kind") or "break", "place": text(stop, "place", 200),
                             "planned_at": planned, "duration_minutes": minutes}))
    values["stop_ids"] = [(5, 0, 0)] + stops
    return values


def immobilization_row(imm):
    imm = imm.sudo()
    return {"id": imm.id, "vehicle": vehicle_ref(imm.vehicle_id), "site": site_ref(imm.site_id),
            "event": {"id": imm.event_id.id, "reference": imm.event_id.reference, "title": imm.event_id.title,
                      "level": imm.event_id.level or None},
            "since": imm.since, "reason": imm.reason or None, "imposed_by": user_ref(imm.imposed_by),
            "status": imm.status, "lifted_at": imm.lifted_at or None, "lifted_by": user_ref(imm.lifted_by),
            "lift_reason": imm.lift_reason or None,
            "transitions": ["release"] if is_hsseq() and imm.status == "active" else [],
            "rights": {"can_edit": False, "can_close": is_hsseq() and imm.status == "active", "can_approve": False}}


class EguitraHsseqJourneys(http.Controller):
    # ─── Plan de trajet (V08) ─────────────────────────────────────────────

    @hsseq_route("/hsseq/rotations/<int:rotation_id>/journey", profiles=JOURNEY_READ)
    def journey(self, rotation_id, **_kw):
        rotation = get("eguitra.transport.rotation", rotation_id, "Rotation")
        if not can_read_rotation(rotation):
            raise ApiError(404, "not_found", "Rotation introuvable.")
        return journey_row(rotation)

    @hsseq_route("/hsseq/rotations/<int:rotation_id>/journey", methods=("PUT",), profiles=YARD)
    def save_journey(self, rotation_id, **_kw):
        """Plan de trajet de la rotation (créé ou remplacé) ; un plan validé qu'on modifie revient à valider."""
        rotation = yard_rotation(rotation_id)
        data = read_json()
        require(data, "planned_departure", "planned_arrival")
        values = journey_values(data)
        journey = rotation._hsseq_journey()
        Journey = request.env["eguitra.hsseq.journey"].sudo()
        if journey:
            if not journey._same_plan(values):
                journey.write(values)
        else:
            Journey.create(dict(values, rotation_id=rotation.id))
        return journey_row(rotation)

    @hsseq_route("/hsseq/rotations/<int:rotation_id>/journey/validate", methods=("POST",), profiles=YARD)
    def validate_journey(self, rotation_id, **_kw):
        """Validation du plan par l'exploitation (levée de V08), refusée s'il n'est pas conforme."""
        rotation = yard_rotation(rotation_id)
        journey = rotation._hsseq_journey()
        if not journey:
            raise ApiError(422, "invalid_transition", "Aucun plan de trajet à valider pour cette rotation.")
        journey.action_validate()
        return journey_row(rotation)

    # ─── Routes interdites de nuit ────────────────────────────────────────

    @hsseq_route("/hsseq/routes", profiles=ROUTES_READ)
    def routes(self, **kw):
        Route = request.env["eguitra.transport.route"].sudo()
        return [{"id": r.id, "name": r.name, "origin": r.origin or None, "destination": r.destination or None,
                 "distance_km": r.distance_km or None, "night_driving_forbidden": r.hsseq_night_forbidden}
                for r in Route.search([("company_id", "in", companies(kw).ids)], order="name")]

    @hsseq_route("/hsseq/routes/<int:route_id>", methods=("PATCH",), profiles=CONFIG)
    def update_route(self, route_id, **_kw):
        route = get("eguitra.transport.route", route_id, "Route")
        data = read_json()
        if not isinstance(data.get("night_driving_forbidden"), bool):
            raise ApiError(400, "invalid_parameter", "night_driving_forbidden : true ou false.",
                           fields=["night_driving_forbidden"])
        old = route.hsseq_night_forbidden
        route.sudo().hsseq_night_forbidden = data["night_driving_forbidden"]
        request.env["eguitra.hsseq.journal"]._log("route", route, "write", field="hsseq_night_forbidden",
                                                  old="oui" if old else "non",
                                                  new="oui" if route.hsseq_night_forbidden else "non")
        return {"id": route.id, "name": route.name, "night_driving_forbidden": route.hsseq_night_forbidden}

    # ─── Nouvelle pesée (V07) ─────────────────────────────────────────────

    @hsseq_route("/hsseq/rotations/<int:rotation_id>/reweigh", methods=("POST",), profiles=YARD)
    def reweigh(self, rotation_id, **_kw):
        """Nouvelle pesée après délestage : le ticket de pesée de la rotation est remplacé (l'ancien reste au
        journal) ; V07 tombe quand le poids net ne dépasse plus la charge utile."""
        rotation = yard_rotation(rotation_id)
        data = read_json()
        require(data, "weight_gross", "weight_tare")
        gross, tare = number(data, "weight_gross"), number(data, "weight_tare")
        if gross <= 0 or tare <= 0 or tare > gross:
            raise ApiError(400, "invalid_parameter", "Poids brut et poids à vide positifs, le second au plus égal au "
                                                     "premier.", fields=["weight_gross", "weight_tare"])
        rot = rotation.sudo()
        before = f"{rot.weigh_ticket or '-'} : {fr_number(rot.weight_gross, 3)} t brut, {fr_number(rot.weight_tare, 3)} t à vide"
        rot.write({"weigh_ticket": text(data, "weigh_ticket", 64) or rot.weigh_ticket, "weight_gross": gross,
                   "weight_tare": tare})
        after = f"{rot.weigh_ticket or '-'} : {fr_number(rot.weight_gross, 3)} t brut, {fr_number(rot.weight_tare, 3)} t à vide"
        request.env["eguitra.hsseq.journal"]._log("rotation", rot, "reweigh", field="weigh_ticket", old=before,
                                                  new=after, note=text(data, "comment", 1000) or None)
        return {"rotation": rotation_ref(rot), "weigh_ticket": rot.weigh_ticket or None, "weight_gross": rot.weight_gross,
                "weight_tare": rot.weight_tare, "weight_net": rot.weight_net,
                "payload_tonnes": rot.vehicle_id.payload_tonnes or None, "overload_tonnes": rot._overload(),
                "lock": rot._hsseq_evaluate(detail=is_hsseq())}

    # ─── Immobilisations (V09) ────────────────────────────────────────────

    @hsseq_route("/hsseq/immobilizations", profiles=IMMOBILIZATION_READ)
    def immobilizations(self, **kw):
        domain = [("company_id", "in", companies(kw).ids)] + scope_domain()
        if kw.get("status"):
            domain.append(("status", "in", kw["status"].split(",")))
        for key in ("vehicle_id", "event_id"):
            if kw.get(key):
                domain.append((key, "=", int_or_none(kw, key)))
        offset, limit, order = page_args(kw, "-since", {"since": "since"})
        Imm = request.env["eguitra.hsseq.immobilization"].sudo()
        rows = Imm.search(domain, offset=offset, limit=limit, order=order)
        return page([immobilization_row(i) for i in rows], Imm.search_count(domain), offset, limit,
                    {"active": Imm.search_count(domain + [("status", "=", "active")])})

    @hsseq_route("/hsseq/events/<int:event_id>/immobilize", methods=("POST",), profiles=HSSEQ)
    def immobilize(self, event_id, **_kw):
        """Immobilisation du véhicule d'un événement de criticité élevée (V09)."""
        event = get("eguitra.hsseq.event", event_id, "Événement")
        data = read_json()
        return immobilization_row(event.action_immobilize(text(data, "reason", 2000)))

    @hsseq_route("/hsseq/vehicles/<int:vehicle_id>/release", methods=("POST",), profiles=HSSEQ)
    def release(self, vehicle_id, **_kw):
        """Levée de l'immobilisation d'un véhicule, motif écrit obligatoire."""
        vehicle = get("eguitra.transport.vehicle", vehicle_id, "Ensemble")
        immobilization = vehicle.sudo().hsseq_immobilization_id
        if not immobilization:
            raise ApiError(422, "invalid_transition", f"{vehicle.name} n'est pas immobilisé.")
        immobilization.action_lift(read_json().get("reason"))
        return immobilization_row(immobilization)
