"""API Transport : flotte, routes et tarifs, rotations, facturation, rentabilité, synchronisation mobile."""

import logging

from odoo import fields, http
from odoo.exceptions import UserError, ValidationError
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require
from odoo.addons.eguitra_finance.controllers.common import as_float, companies, move_summary, parse_date, today

from ..models.fleet import PRODUCTS
from ..models.rotation import COSTS

_logger = logging.getLogger(__name__)

READ = ("admin", "direction", "finance", "exploitation")
WRITE = ("admin", "finance", "exploitation")
MAX_SYNC = 200

ROTATION_FIELDS = (
    "date_loading", "date_delivery", "delivery_note", "volume_loaded", "volume_delivered", "rate", "note", "product",
    *[c for c, _l in COSTS],
)
REF_FIELDS = {"vehicle_id": "eguitra.transport.vehicle", "driver_id": "eguitra.transport.driver",
              "partner_id": "res.partner", "route_id": "eguitra.transport.route"}


def _ref(record):
    return {"id": record.id, "name": record.display_name} if record else None


def _rotation_row(rot):
    return {
        "id": rot.id, "name": rot.name if rot.name != "/" else None, "state": rot.state, "source": rot.source,
        "date_loading": rot.date_loading, "date_delivery": rot.date_delivery,
        "vehicle": _ref(rot.vehicle_id), "driver": _ref(rot.driver_id), "client": _ref(rot.partner_id),
        "route": _ref(rot.route_id), "product": rot.product, "delivery_note": rot.delivery_note or None,
        "volume_loaded": rot.volume_loaded, "volume_delivered": rot.volume_delivered, "shortage": rot.shortage,
        "rate": rot.rate, "revenue": rot.revenue, "costs": {c: rot[c] for c, _l in COSTS},
        "total_cost": rot.total_cost, "margin": rot.margin, "margin_rate": rot.margin_rate,
        "note": rot.note or None, "invoice": {"id": rot.invoice_id.id, "name": rot.invoice_id.name} if rot.invoice_id else None,
        "client_uuid": rot.client_uuid or None,
    }


def _rotation_values(data):
    values = {}
    for key in ROTATION_FIELDS:
        if key not in data:
            continue
        value = data[key]
        if key.startswith("date"):
            values[key] = parse_date(data, key)
        elif key in ("delivery_note", "note"):
            values[key] = value or False
        elif key == "product":
            if value not in dict(PRODUCTS):
                raise ApiError(400, "invalid_parameter", "Produit inconnu.")
            values[key] = value
        else:
            values[key] = as_float(value or 0, key)
    for key, model in REF_FIELDS.items():
        if data.get(key):
            record = request.env[model].browse(int(data[key])).exists()
            if not record:
                raise ApiError(422, "business_rule", f"Référence inconnue : {key}.")
            values[key] = record.id
    return values


def _get(model, record_id, label):
    record = request.env[model].browse(record_id).exists()
    if not record:
        raise ApiError(404, "not_found", f"{label} introuvable.")
    return record


class EguitraTransport(http.Controller):
    # ─── Référentiels ─────────────────────────────────────────────────────

    @api_route("/transport/referentials", profiles=READ)
    def referentials(self, **_kw):
        """Tout ce que l'application mobile garde en cache pour saisir hors réseau."""
        env = request.env
        vehicles = env["eguitra.transport.vehicle"].search([("state", "!=", "off")])
        routes = env["eguitra.transport.route"].search([])
        # Clients du transport : ceux qui ont un tarif ou une rotation dans l'année ; à défaut
        # (démarrage), tous les clients. Les clients des autres activités n'encombrent pas la liste.
        since = fields.Date.subtract(today(), years=1)
        clients = (env["eguitra.transport.tariff"].search([]).partner_id
                   | env["eguitra.transport.rotation"].search([("date_loading", ">=", since)]).partner_id)
        clients = clients.sorted("name") if clients else env["res.partner"].search(
            [("customer_rank", ">", 0), ("parent_id", "=", False)], limit=500)
        return {
            "vehicles": [{"id": v.id, "name": v.name, "tractor_plate": v.tractor_plate, "capacity_liters": v.capacity_liters,
                          "driver_id": v.driver_id.id or None, "state": v.state} for v in vehicles],
            "drivers": [{"id": d.id, "name": d.name, "phone": d.phone} for d in env["eguitra.transport.driver"].search([])],
            "routes": [{"id": r.id, "name": r.name, "distance_km": r.distance_km, "default_rate": r.default_rate,
                        "tariffs": [{"partner_id": t.partner_id.id, "product": t.product or None, "rate": t.rate} for t in r.tariff_ids]}
                       for r in routes],
            "clients": [{"id": c.id, "name": c.name} for c in clients],
            "products": [{"code": k, "label": v} for k, v in PRODUCTS],
            "costs": [{"code": k, "label": v} for k, v in COSTS],
        }

    @api_route("/transport/vehicles", profiles=READ)
    def vehicles(self, **_kw):
        return [
            {"id": v.id, "name": v.name, "tractor_plate": v.tractor_plate or None, "trailer_plate": v.trailer_plate or None,
             "brand": v.brand or None, "capacity_liters": v.capacity_liters, "driver": _ref(v.driver_id), "state": v.state,
             "active": v.active}
            for v in request.env["eguitra.transport.vehicle"].with_context(active_test=False).search([])
        ]

    def _vehicle_values(self, data):
        values = {k: data[k] or False for k in ("name", "tractor_plate", "trailer_plate", "brand") if k in data}
        if "capacity_liters" in data:
            values["capacity_liters"] = int(data["capacity_liters"] or 0)
        if data.get("state") in ("service", "maintenance", "off"):
            values["state"] = data["state"]
        if "driver_id" in data:
            values["driver_id"] = int(data["driver_id"]) if data["driver_id"] else False
        if "active" in data:
            values["active"] = bool(data["active"])
        return values

    @api_route("/transport/vehicles", methods=("POST",), profiles=WRITE)
    def create_vehicle(self, **_kw):
        data = read_json()
        require(data, "name")
        vehicle = request.env["eguitra.transport.vehicle"].create(self._vehicle_values(data))
        return {"id": vehicle.id, "name": vehicle.name}

    @api_route("/transport/vehicles/<int:vehicle_id>", methods=("PATCH",), profiles=WRITE)
    def update_vehicle(self, vehicle_id, **_kw):
        vehicle = _get("eguitra.transport.vehicle", vehicle_id, "Ensemble routier")
        vehicle.write(self._vehicle_values(read_json()))
        return {"status": "ok"}

    @api_route("/transport/drivers", profiles=READ)
    def drivers(self, **_kw):
        return [
            {"id": d.id, "name": d.name, "phone": d.phone or None, "license_number": d.license_number or None,
             "license_expiry": d.license_expiry, "active": d.active}
            for d in request.env["eguitra.transport.driver"].with_context(active_test=False).search([])
        ]

    def _driver_values(self, data):
        values = {k: data[k] or False for k in ("name", "phone", "license_number") if k in data}
        if "license_expiry" in data:
            values["license_expiry"] = parse_date(data, "license_expiry")
        if "active" in data:
            values["active"] = bool(data["active"])
        return values

    @api_route("/transport/drivers", methods=("POST",), profiles=WRITE)
    def create_driver(self, **_kw):
        data = read_json()
        require(data, "name")
        driver = request.env["eguitra.transport.driver"].create(self._driver_values(data))
        return {"id": driver.id, "name": driver.name}

    @api_route("/transport/drivers/<int:driver_id>", methods=("PATCH",), profiles=WRITE)
    def update_driver(self, driver_id, **_kw):
        _get("eguitra.transport.driver", driver_id, "Chauffeur").write(self._driver_values(read_json()))
        return {"status": "ok"}

    @api_route("/transport/routes", profiles=READ)
    def routes(self, **_kw):
        return [
            {"id": r.id, "name": r.name, "origin": r.origin or None, "destination": r.destination or None,
             "distance_km": r.distance_km, "default_rate": r.default_rate, "active": r.active,
             "tariffs": [{"id": t.id, "partner": _ref(t.partner_id), "product": t.product or None, "rate": t.rate}
                         for t in r.tariff_ids]}
            for r in request.env["eguitra.transport.route"].with_context(active_test=False).search([])
        ]

    def _route_values(self, data):
        values = {k: data[k] or False for k in ("name", "origin", "destination") if k in data}
        if "distance_km" in data:
            values["distance_km"] = int(data["distance_km"] or 0)
        if "default_rate" in data:
            values["default_rate"] = as_float(data["default_rate"] or 0, "default_rate")
        if "active" in data:
            values["active"] = bool(data["active"])
        if "tariffs" in data:
            commands = [(5, 0, 0)]
            for t in data["tariffs"] or []:
                commands.append((0, 0, {"partner_id": int(t["partner_id"]), "product": t.get("product") or False,
                                        "rate": as_float(t.get("rate", 0), "rate")}))
            values["tariff_ids"] = commands
        return values

    @api_route("/transport/routes", methods=("POST",), profiles=WRITE)
    def create_route(self, **_kw):
        data = read_json()
        require(data, "name")
        route = request.env["eguitra.transport.route"].create(self._route_values(data))
        return {"id": route.id, "name": route.name}

    @api_route("/transport/routes/<int:route_id>", methods=("PATCH",), profiles=WRITE)
    def update_route(self, route_id, **_kw):
        _get("eguitra.transport.route", route_id, "Route").write(self._route_values(read_json()))
        return {"status": "ok"}

    # ─── Rotations ────────────────────────────────────────────────────────

    @api_route("/transport/rotations", profiles=READ)
    def rotations(self, **kw):
        domain = []
        if kw.get("state"):
            domain.append(("state", "in", kw["state"].split(",")))
        for key in ("vehicle_id", "partner_id", "route_id", "driver_id"):
            if kw.get(key):
                domain.append((key, "=", int_arg(kw, key)))
        start, end = parse_date(kw, "date_from"), parse_date(kw, "date_to")
        if start:
            domain.append(("date_loading", ">=", start))
        if end:
            domain.append(("date_loading", "<=", end))
        Rotation = request.env["eguitra.transport.rotation"]
        rots = Rotation.search(domain, limit=int_arg(kw, "limit", 100, 1, 1000), offset=int_arg(kw, "offset", 0, 0))
        [(revenue, margin, volume)] = Rotation._read_group(domain, aggregates=["revenue:sum", "margin:sum", "volume_delivered:sum"])
        return {"items": [_rotation_row(r) for r in rots], "total_count": Rotation.search_count(domain),
                "totals": {"revenue": revenue or 0.0, "margin": margin or 0.0, "volume": volume or 0.0}}

    @api_route("/transport/rotations/<int:rotation_id>", profiles=READ)
    def rotation(self, rotation_id, **_kw):
        return _rotation_row(_get("eguitra.transport.rotation", rotation_id, "Rotation"))

    @api_route("/transport/rotations", methods=("POST",), profiles=WRITE)
    def create_rotation(self, **_kw):
        data = read_json()
        require(data, "vehicle_id", "partner_id", "route_id")
        rot = request.env["eguitra.transport.rotation"].create(_rotation_values(data))
        if data.get("validate"):
            rot.action_validate()
        return _rotation_row(rot)

    @api_route("/transport/rotations/<int:rotation_id>", methods=("PATCH",), profiles=WRITE)
    def update_rotation(self, rotation_id, **_kw):
        rot = _get("eguitra.transport.rotation", rotation_id, "Rotation")
        if rot.state not in ("draft", "done"):
            raise ApiError(422, "business_rule", "Seule une rotation saisie ou validée se modifie.")
        rot.write(_rotation_values(read_json()))
        return _rotation_row(rot)

    @api_route("/transport/rotations/<int:rotation_id>/<string:action>", methods=("POST",), profiles=WRITE)
    def rotation_action(self, rotation_id, action, **_kw):
        rot = _get("eguitra.transport.rotation", rotation_id, "Rotation")
        handlers = {"validate": rot.action_validate, "cancel": rot.action_cancel, "reset": rot.action_reset}
        if action not in handlers:
            raise ApiError(404, "not_found", "Action inconnue.")
        handlers[action]()
        return _rotation_row(rot)

    @api_route("/transport/rotations/validate", methods=("POST",), profiles=WRITE)
    def validate_many(self, **_kw):
        ids = [int(i) for i in read_json().get("ids") or []]
        rots = request.env["eguitra.transport.rotation"].browse(ids).exists()
        rots.action_validate()
        return [_rotation_row(r) for r in rots]

    @api_route("/transport/invoice", methods=("POST",), profiles=("admin", "finance"))
    def invoice(self, **_kw):
        ids = [int(i) for i in read_json().get("rotation_ids") or []]
        rots = request.env["eguitra.transport.rotation"].browse(ids).exists()
        invoices = rots.action_invoice()
        return {"invoices": [move_summary(m) for m in invoices]}

    @api_route("/transport/profitability", profiles=READ)
    def profitability(self, **kw):
        end = parse_date(kw, "date_to", today())
        start = parse_date(kw, "date_from", end.replace(month=1, day=1))
        group = kw.get("group", "vehicle")
        rows = request.env["eguitra.transport.rotation"].profitability(companies(kw), start, end, group)
        return {"group": group, "date_from": start, "date_to": end, "rows": rows}

    @api_route("/transport/summary", profiles=READ)
    def summary(self, **kw):
        end = parse_date(kw, "date_to", today())
        start = parse_date(kw, "date_from", end.replace(day=1))
        Rotation = request.env["eguitra.transport.rotation"]
        domain = [("state", "in", ("done", "invoiced")), ("date_loading", ">=", start), ("date_loading", "<=", end)]
        [(count, volume, revenue, cost, margin)] = Rotation._read_group(
            domain, aggregates=["__count", "volume_delivered:sum", "revenue:sum", "total_cost:sum", "margin:sum"]
        )
        [(to_invoice_count, to_invoice)] = Rotation._read_group([("state", "=", "done")], aggregates=["__count", "revenue:sum"])
        return {
            "date_from": start, "date_to": end, "rotations": count, "volume": volume or 0.0, "revenue": revenue or 0.0,
            "cost": cost or 0.0, "margin": margin or 0.0, "margin_rate": (margin / revenue * 100) if revenue else None,
            "to_invoice": {"count": to_invoice_count, "amount": to_invoice or 0.0},
            "drafts": Rotation.search_count([("state", "=", "draft")]),
            "fleet": {s: request.env["eguitra.transport.vehicle"].search_count([("state", "=", s)])
                      for s in ("service", "maintenance", "off")},
        }

    # ─── Synchronisation de l'application mobile ──────────────────────────

    @api_route("/transport/sync", methods=("POST",), profiles=WRITE)
    def sync(self, **_kw):
        """Rotations saisies hors réseau : chaque saisie porte un identifiant unique (idempotence)."""
        items = read_json().get("rotations") or []
        if not isinstance(items, list) or len(items) > MAX_SYNC:
            raise ApiError(400, "invalid_parameter", f"Liste de rotations invalide ({MAX_SYNC} au plus par envoi).")
        Rotation = request.env["eguitra.transport.rotation"]
        results = []
        for item in items:
            if not isinstance(item, dict):
                results.append({"client_uuid": None, "status": "error", "message": "Saisie illisible."})
                continue
            uuid = str(item.get("client_uuid") or "")[:64]
            if not uuid:
                results.append({"client_uuid": None, "status": "error", "message": "Identifiant de saisie manquant."})
                continue
            # Recherche sous les droits de l'agent : une saisie d'une autre société n'est pas révélée.
            existing = Rotation.search([("client_uuid", "=", uuid)], limit=1)
            if existing:
                results.append({"client_uuid": uuid, "status": "exists", "id": existing.id})
                continue
            missing = [k for k in ("vehicle_id", "partner_id", "route_id") if not item.get(k)]
            if missing:
                results.append({"client_uuid": uuid, "status": "error",
                                "message": "Ensemble, client et route sont obligatoires."})
                continue
            try:
                with request.env.cr.savepoint():
                    values = _rotation_values(item)
                    values.update({"client_uuid": uuid, "source": "mobile"})
                    rot = Rotation.create(values)
                results.append({"client_uuid": uuid, "status": "created", "id": rot.id})
            except (ApiError, UserError, ValidationError) as e:
                message = e.message if isinstance(e, ApiError) else str(e.args[0])
                results.append({"client_uuid": uuid, "status": "error", "message": message})
            except Exception:  # noqa: BLE001 - une saisie défectueuse ne bloque pas les autres
                _logger.exception("Synchronisation mobile : saisie %s rejetée", uuid)
                results.append({"client_uuid": uuid, "status": "error", "message": "Saisie invalide."})
        return {"results": results}
