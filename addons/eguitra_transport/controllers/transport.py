"""API Transport : flotte, routes et tarifs, rotations, facturation, rentabilité, synchronisation mobile."""

import base64
import io
import logging
from contextlib import contextmanager

from odoo import fields, http
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require
from odoo.addons.eguitra_api.files import ACCEPTED, XLSX_OPTIONS, checked_name, detect_type, xlsx_row
from odoo.addons.eguitra_finance.controllers.common import as_float, companies, move_summary, parse_date, today

from ..blocking import RotationBlocked
from ..models.fleet_safety import DOCUMENT_KINDS, VEHICLE_KINDS
from ..models.official_rate import DEPOTS, gap_pct, slug
from ..models.ownership import OWNERSHIPS, PERIODICITIES
from ..models.rotation import COSTS, ENTRY_COSTS
from ..models.settings import OWNER_COST_BASES, SHORTAGE_RULES
from ..models.standard import ROUTE_STANDARDS
from ..models.tax import TAX_BASES, TAX_NATURES

_logger = logging.getLogger(__name__)

READ = ("admin", "direction", "finance", "exploitation")
WRITE = ("admin", "finance", "exploitation")
SETTINGS = ("admin", "finance")
MAX_SYNC = 200
MAX_DOCUMENT = 15 * 1024 * 1024

ROTATION_FIELDS = (
    "date_loading", "date_delivery", "date_return", "delivery_note", "volume_loaded", "volume_delivered", "rate", "note",
    "temperature_loaded", "temperature_delivered", "density_15", "vcf_loaded", "vcf_delivered",
    "fuel_liters", "distance_km", "weigh_ticket", "weight_gross", "weight_tare",
    # « specific_taxes » (saisies de l'application mobile, reprise) vaut forfait hors barème.
    *[c for c, _l in COSTS], "specific_taxes_manual",
)
# Conditions de manquant et barème des taxes d'une rotation : réservés à la finance.
FINANCE_ROTATION_FIELDS = ("shortage_tolerance", "shortage_unit_price", "shortage_rule", "tax_rules",
                           "volume_correction")
REF_FIELDS = {"vehicle_id": "eguitra.transport.vehicle", "driver_id": "eguitra.transport.driver",
              "partner_id": "res.partner", "route_id": "eguitra.transport.route"}
# Mesures saisies au parc (application Rotations), hors montants ; températures et masse volumique
# seulement si les manquants se calculent à 15 °C.
MEASURES = [("fuel_liters", "Carburant (litres)")]
MEASURES_15 = [("temperature_loaded", "Température au chargement (°C)"),
               ("temperature_delivered", "Température à la livraison (°C)"),
               ("density_15", "Masse volumique à 15 °C (kg/m³)")]
VEHICLE_STATES = ("service", "maintenance", "off", "sold")
# Tri de la liste des rotations (paramètre sort, « -clé » pour l'ordre décroissant) : colonnes de
# l'écran et champ du modèle. Le volume est le volume facturable (livré, à défaut chargé), la marge
# et son taux ceux qu'affiche la ligne (estimés tant qu'aucun frais n'est saisi).
ROTATION_SORTS = {
    "name": "name", "date_loading": "date_loading", "vehicle": "vehicle_id", "client": "partner_id",
    "route": "route_id", "volume": "billed_volume", "shortage": "shortage", "revenue": "revenue",
    "margin": "margin_or_estimate", "margin_rate": "margin_or_estimate_rate", "state": "state",
}


def _ref(record):
    return {"id": record.id, "name": record.display_name} if record else None


def _move_ref(move):
    return {"id": move.id, "name": move.name if move.name and move.name != "/" else None, "state": move.state} if move else None


def _rotation_row(rot, detail=False, official=None):
    """Ligne de rotation ; detail : avec les motifs qui s'opposent au départ (fiche, pas la liste)."""
    return {
        "id": rot.id, "name": rot.name if rot.name != "/" else None, "state": rot.state, "source": rot.source,
        "date_loading": rot.date_loading, "date_delivery": rot.date_delivery, "date_return": rot.date_return,
        "distance_km": rot.distance_km, "fuel_liters": rot.fuel_liters, "duration_days": rot.duration_days,
        "revenue_per_km": rot.revenue_per_km, "cost_per_km": rot.cost_per_km, "cost_per_liter": rot.cost_per_liter,
        "fuel_per_100km": rot.fuel_per_100km or None,
        "vehicle": _ref(rot.vehicle_id), "driver": _ref(rot.driver_id), "client": _ref(rot.partner_id),
        "route": _ref(rot.route_id), "product": rot.product, "product_id": rot.product_id.id,
        "product_label": rot.product_id.name, "delivery_note": rot.delivery_note or None,
        "volume_loaded": rot.volume_loaded, "volume_delivered": rot.volume_delivered,
        "capacity_liters": rot.vehicle_id.capacity_liters, "over_capacity": rot.over_capacity,
        "volume_correction": rot.volume_correction, "temperature_loaded": rot.temperature_loaded or None,
        "temperature_delivered": rot.temperature_delivered or None, "density_15": rot.density_15 or None,
        "vcf_loaded": rot.vcf_loaded, "vcf_delivered": rot.vcf_delivered,
        "volume_loaded_15": rot.volume_loaded_15, "volume_delivered_15": rot.volume_delivered_15,
        "shortage": rot.shortage, "shortage_tolerance": rot.shortage_tolerance,
        "shortage_tolerated": rot.shortage_tolerated, "shortage_excess": rot.shortage_excess,
        "shortage_unit_price": rot.shortage_unit_price, "shortage_value": rot.shortage_value,
        "shortage_rule": rot.shortage_rule, "shortage_deduction": rot.shortage_deduction,
        "shortage_claim": rot.shortage_claim, "shortage_net_cost": rot.shortage_net_cost,
        # Pièces lues en sudo : le parc n'a pas accès aux écritures, il en voit le numéro.
        "shortage_claim_move": _move_ref(rot.sudo().shortage_claim_move_id),
        "rate": rot.rate, "revenue": rot.revenue, "billed_amount": rot.billed_amount,
        "costs": {c: rot[c] for c, _l in COSTS},
        "tax_rules": rot.tax_rules, "specific_taxes_manual": rot.specific_taxes_manual,
        "taxes_rebilled": rot.taxes_rebilled,
        "tax_lines": [{"id": t.id, "name": t.name, "nature": t.nature, "base": t.base, "base_amount": t.base_amount,
                       "rate": t.rate, "amount": t.amount, "rebillable": t.rebillable} for t in rot.tax_line_ids],
        "total_cost": rot.total_cost, "margin": rot.margin, "margin_rate": rot.margin_rate,
        "std_fuel_liters": rot.std_fuel_liters, "std_fuel_price": rot.std_fuel_price, "std_cost": rot.std_cost,
        "estimated_margin": rot.estimated_margin,
        # Sans montant (volume ou tarif manquant), un taux n'a pas de sens : None.
        "weigh_ticket": rot.weigh_ticket or None, "weight_gross": rot.weight_gross or None,
        "weight_tare": rot.weight_tare or None, "weight_net": rot.weight_net or None, "over_payload": rot.over_payload,
        "vehicle_kind": rot.vehicle_id.vehicle_kind or None,
        "departure_blockers": rot._departure_blockers() if detail and rot.state == "draft" else None,
        "departed_at": rot.departed_at or None, "departed_by": _ref(rot.departed_by),
        "estimated_margin_rate": rot.estimated_margin_rate if rot.revenue else None,
        "margin_estimated": rot.margin_estimated,
        **_rotation_official(rot, official),
        "note": rot.note or None, "invoice": _move_ref(rot.sudo().invoice_id),
        "client_uuid": rot.client_uuid or None,
        # Saisie par le compte connecté : il ne la valide pas lui-même (validation par un autre compte).
        "created_by": rot.create_uid.name or None, "self_entered": rot.create_uid == rot.env.user,
    }


def _rotation_official(rot, cache=None):
    """Tarif officiel à la date de chargement et écart du tarif de la rotation ; cache : par route et date."""
    if cache is None:
        line, gap = rot._official_gap()
    else:
        key = (rot.route_id.id, rot.date_loading)
        if key not in cache:
            cache[key] = rot._official_gap()[0]
        line = cache[key]
        gap = gap_pct(rot.rate, line)
    return {"official_rate": _official_ref(line), "official_rate_gap": _gap(gap)}


@contextmanager
def _blockers(action):
    """Départ ou validation refusés : 422 avec la liste des motifs ouverts, pour l'écran et l'application."""
    try:
        yield
    except RotationBlocked as e:
        error = "departure_blocked" if action == "depart" else "validation_blocked"
        raise ApiError(422, error, str(e.args[0]), blockers=e.blockers) from e


def _rotation_order(sort):
    """Ordre de la liste : « date_loading », « -margin »… ; plus récentes d'abord sans paramètre."""
    if not sort:
        return "date_loading desc, id desc"
    key, desc = (sort[1:], True) if sort.startswith("-") else (sort, False)
    if key not in ROTATION_SORTS:
        raise ApiError(400, "invalid_parameter", "Tri inconnu.")
    direction = "desc" if desc else "asc"
    # Départage stable d'une page à l'autre : date de chargement puis identifiant.
    tail = f"id {direction}" if key == "date_loading" else "date_loading desc, id desc"
    return f"{ROTATION_SORTS[key]} {direction}, {tail}"


def _margin_min():
    """Marge minimale de la règle d'alerte (Seuils et taux) ; None : seuil à 0, la marge n'est pas jugée."""
    return request.env["eguitra.finance.metrics"].sudo().threshold_values(request.env.company)["transport_margin_min"]


def _product(data):
    """Produit d'une saisie : product_id, ou le code (« gasoil ») des saisies de l'application mobile."""
    Product = request.env["eguitra.transport.product"]
    if data.get("product_id"):
        try:
            product = Product.browse(int(data["product_id"])).exists()
        except (TypeError, ValueError) as e:
            raise ApiError(400, "invalid_parameter", "Produit inconnu.") from e
    else:
        product = Product._by_code(data.get("product"))
    if not product:
        raise ApiError(400, "invalid_parameter", "Produit inconnu.")
    return product


def _is_finance():
    return bool(set(SETTINGS) & set(request.env.user._eguitra_profiles()))


# Données comptables (produits et charges du grand livre, coûts comptabilisés, comptes) : réservées
# aux profils qui lisent la comptabilité ; le parc voit la rentabilité opérationnelle.
ACCOUNTING = ("admin", "direction", "finance")
ACCOUNTING_ROW_KEYS = ("booked_cost", "cost_gap", "booked_result")
ACCOUNTING_INDICATORS = ("income_total", "revenue_share", "booked_cost", "cost_gap", "structure_booked",
                         "structure_booked_per_km")


def _sees_accounts():
    return bool(set(ACCOUNTING) & set(request.env.user._eguitra_profiles()))


def _operational(report):
    """Rapport de rentabilité sans ses données comptables, pour le parc."""
    for row in report["rows"]:
        for key in ACCOUNTING_ROW_KEYS:
            row[key] = None
    for key in ACCOUNTING_INDICATORS:
        report["indicators"][key] = None
    report["structure"] = {k: v for k, v in report["structure"].items()
                           if k not in ("companies", "structure_booked", "per_km_booked")}
    report["structure"]["companies"] = []
    return report


def _rotation_values(data):
    values = {}
    if data.get("product") or data.get("product_id"):
        values["product_id"] = _product(data).id
    for key in ROTATION_FIELDS:
        if key not in data:
            continue
        value = data[key]
        if key.startswith("date"):
            values[key] = parse_date(data, key)
        elif key in ("delivery_note", "note", "weigh_ticket"):
            values[key] = value or False
        else:
            values[key] = as_float(value or 0, key)
    wanted = [k for k in FINANCE_ROTATION_FIELDS if k in data]
    if wanted and not _is_finance():
        raise ApiError(403, "forbidden", "Les conditions de manquant d'une rotation relèvent de la finance.")
    for key in wanted:
        if key == "shortage_rule":
            if data[key] not in dict(SHORTAGE_RULES):
                raise ApiError(400, "invalid_parameter", "Traitement du manquant inconnu.")
            values[key] = data[key]
        elif key in ("tax_rules", "volume_correction"):
            values[key] = bool(data[key])
        else:
            values[key] = as_float(data[key] or 0, key)
    for key, model in REF_FIELDS.items():
        if data.get(key):
            record = request.env[model].browse(int(data[key])).exists()
            if not record:
                raise ApiError(422, "business_rule", f"Référence inconnue : {key}.")
            values[key] = record.id
    return values


def _tolerance(value, name):
    """Tolérance de manquant : None (valeur héritée) ou un pourcentage entre 0 et 100."""
    if value in (None, ""):
        return None
    value = as_float(value, name)
    if not 0 <= value <= 100:
        raise ApiError(400, "invalid_parameter", "Tolérance de manquant attendue entre 0 et 100 %.")
    return value


def _tariff_terms(data):
    values = {}
    if "shortage_tolerance" in data:
        tolerance = _tolerance(data["shortage_tolerance"], "shortage_tolerance")
        values.update(tolerance_custom=tolerance is not None, shortage_tolerance=tolerance or 0.0)
    if "shortage_price" in data:
        values["shortage_price"] = as_float(data["shortage_price"] or 0, "shortage_price")
    return values


def _tariff_row(t):
    return {"id": t.id, "partner": _ref(t.partner_id), "product": t.product or None, "product_id": t.product_id.id or None,
            "rate": t.rate, "shortage_tolerance": t.shortage_tolerance if t.tolerance_custom else None,
            "shortage_price": t.shortage_price or None, "official_gap": _gap(t._official_gap()[1])}


def _document_row(doc):
    attachment = doc.sudo().attachment_id
    return {"id": doc.id, "kind": doc.kind, "kind_label": dict(DOCUMENT_KINDS)[doc.kind],
            "reference": doc.reference or None, "issuer": doc.issuer or None, "date_start": doc.date_start or None,
            "expiry_date": doc.expiry_date, "state": doc._state(), "note": doc.note or None,
            "attachment": {"id": attachment.id, "name": attachment.name} if attachment else None}


def _official_ref(line):
    """Ligne du barème officiel : tarif en GNF par litre et son équivalent par m³ (tarifs des routes)."""
    if not line:
        return None
    scale = line.scale_id
    return {"id": line.id, "depot": line.depot, "depot_label": dict(DEPOTS)[line.depot], "sequence": line.sequence,
            "destination": line.destination, "prefecture": line.prefecture or None, "rate": line.rate,
            "rate_per_m3": line._rate_per_m3(), "distance_km": line.distance_km or None,
            "scale": {"id": scale.id, "name": scale.name, "date_from": scale.date_from}}


def _gap(pct):
    """Écart au barème officiel, signalé au-delà de la tolérance de la société ; None sans comparaison."""
    if pct is None:
        return None
    return {"pct": pct, "flagged": abs(pct) > request.env.company.transport_official_rate_tolerance}


def _settings_payload():
    company = request.env.company
    finance = _is_finance()
    # Les comptes ne sont lus que pour la finance (le parc n'a pas accès au plan de comptes).
    accounts = company.sudo() if finance else None
    return {
        "shortage_tolerance": company.transport_shortage_tolerance,
        "shortage_rule": company.transport_shortage_rule,
        "volume_correction": company.transport_volume_correction,
        "shortage_account": _account_ref(accounts.transport_shortage_account_id) if accounts else None,
        "claim_account": _account_ref(accounts.transport_claim_account_id) if accounts else None,
        "owner_cost_basis": company.transport_owner_cost_basis,
        "owner_cost_bases": [{"code": k, "label": v} for k, v in OWNER_COST_BASES],
        "owner_account": _account_ref(accounts.transport_owner_account_id) if accounts else None,
        "owner_income_account": _account_ref(accounts.transport_owner_income_account_id) if accounts else None,
        "commission_account": _account_ref(accounts.transport_commission_account_id) if accounts else None,
        "official_rate_tolerance": company.transport_official_rate_tolerance,
        "activity": _activity_ref(company.sudo().transport_activity_id),
        "activities": [_activity_ref(a) for a in _activities(company)] if finance else [],
        "rules": [{"code": k, "label": v} for k, v in SHORTAGE_RULES],
        "can_edit": finance,
        # Relevés des propriétaires, règles de répartition : profils qui lisent la comptabilité.
        "sees_accounts": _sees_accounts(),
    }


def _activities(company):
    plan = request.env.ref("eguitra_base.analytic_plan_activite")
    return request.env["account.analytic.account"].sudo().search(
        [("plan_id", "=", plan.id), ("company_id", "in", [False, company.id])], order="code, name")


def _activity_ref(account):
    return {"id": account.id, "code": account.code or None, "name": account.name} if account else None


def _account_ref(account):
    return {"id": account.id, "code": account.code, "name": account.name} if account else None


def _client_row(partner):
    return {"id": partner.id, "name": partner.name,
            "shortage_tolerance": partner.transport_shortage_tolerance if partner.transport_tolerance_custom else None,
            "shortage_rule": partner.transport_shortage_rule or None}


def _tax_row(t):
    accounts = t.sudo() if _sees_accounts() else t.browse()
    return {
        "id": t.id, "name": t.name, "nature": t.nature, "base": t.base, "rate": t.rate,
        "products": [_ref(p) for p in t.product_ids], "routes": [_ref(r) for r in t.route_ids],
        "account": _account_ref(accounts.account_id), "income_account": _account_ref(accounts.income_account_id),
        "rebillable": t.rebillable, "rebill_vat": t.rebill_vat, "date_from": t.date_from or None,
        "date_to": t.date_to or None, "sequence": t.sequence, "active": t.active,
    }


def _charge_row(charge):
    return {"id": charge.id, "name": charge.name, "amount": charge.amount, "periodicity": charge.periodicity,
            "monthly": charge._monthly(), "date_from": charge.date_from or None, "date_to": charge.date_to or None}


def _product_row(product):
    return {"id": product.id, "code": product.code, "name": product.name, "sequence": product.sequence,
            "shared": not product.company_id, "active": product.active, "density_15": product.density_15 or None,
            "shortage_price": product.shortage_price}


def _get(model, record_id, label):
    record = request.env[model].browse(record_id).exists()
    if not record:
        raise ApiError(404, "not_found", f"{label} introuvable.")
    return record


def _partner(value, label):
    """Tiers désigné par la saisie : lisible par l'utilisateur, commun ou de la société de travail."""
    try:
        partner = request.env["res.partner"].browse(int(value)).exists()
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"{label} inconnu.") from e
    # Société lue en sudo : un tiers d'une autre société n'est pas lisible, le refus doit rester un 422.
    company = partner.sudo().company_id
    if not partner or (company and company != request.env.company):
        raise ApiError(422, "business_rule", f"{label} inconnu dans la société de travail.")
    try:
        partner.check_access("read")
    except AccessError as e:
        raise ApiError(422, "business_rule", f"{label} inconnu dans la société de travail.") from e
    return partner


class EguitraTransport(http.Controller):
    # ─── Référentiels ─────────────────────────────────────────────────────

    @api_route("/transport/referentials", profiles=READ)
    def referentials(self, **_kw):
        """Tout ce que l'application mobile garde en cache pour saisir hors réseau."""
        env = request.env
        vehicles = env["eguitra.transport.vehicle"].search([("state", "in", ("service", "maintenance"))])
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
                          "driver_id": v.driver_id.id or None, "state": v.state, "vehicle_kind": v.vehicle_kind,
                          "payload_tonnes": v.payload_tonnes or None} for v in vehicles],
            "drivers": [{"id": d.id, "name": d.name, "phone": d.phone} for d in env["eguitra.transport.driver"].search([])],
            "routes": [{"id": r.id, "name": r.name, "distance_km": r.distance_km, "default_rate": r.default_rate,
                        "tariffs": [{"partner_id": t.partner_id.id, "product": t.product or None, "rate": t.rate} for t in r.tariff_ids],
                        **{k: r[k] for k in ROUTE_STANDARDS}}
                       for r in routes],
            # Prix du litre en vigueur : coût standard estimé à la saisie (le noyau le recalcule).
            "fuel_price": env["eguitra.transport.fuel.price"]._price_at(env.company, today()),
            "clients": [{"id": c.id, "name": c.name} for c in clients],
            # Le code reste la clé des saisies du téléphone (y compris celles gardées hors réseau).
            "products": [{"id": p.id, "code": p.code, "label": p.name}
                         for p in env["eguitra.transport.product"].search([])],
            "costs": [{"code": k, "label": v} for k, v in ENTRY_COSTS],
            # Mesures facultatives du parc ; températures et masse volumique si les manquants se
            # calculent à 15 °C. Une version antérieure de l'application ignore cette liste.
            "volume_correction": env.company.transport_volume_correction,
            "measures": [{"code": k, "label": v}
                         for k, v in MEASURES + (MEASURES_15 if env.company.transport_volume_correction else [])],
        }

    @api_route("/transport/vehicles", profiles=READ)
    def vehicles(self, **_kw):
        return [
            {"id": v.id, "name": v.name, "tractor_plate": v.tractor_plate or None, "trailer_plate": v.trailer_plate or None,
             "brand": v.brand or None, "capacity_liters": v.capacity_liters, "driver": _ref(v.driver_id), "state": v.state,
             "year": v.year or None, "date_service": v.date_service or None,
             # L'immobilisation se lit pour tous (le parc voit si l'ensemble est rattaché), se choisit par la finance.
             "asset": _ref(v.sudo().asset_id), "active": v.active,
             "ownership": v.ownership, "owner": _ref(v.owner_id), "charges": [_charge_row(c) for c in v.charge_ids],
             "monthly_charges": sum(c._monthly() for c in v.charge_ids),
             "vehicle_kind": v.vehicle_kind, "payload_tonnes": v.payload_tonnes or None,
             "documents": [_document_row(d) for d in v.document_ids], "document_issues": v._document_issues()}
            for v in request.env["eguitra.transport.vehicle"].with_context(active_test=False).search([])
        ]

    def _vehicle_values(self, data):
        values = {k: data[k] or False for k in ("name", "tractor_plate", "trailer_plate", "brand") if k in data}
        if "capacity_liters" in data:
            values["capacity_liters"] = int(data["capacity_liters"] or 0)
        if "year" in data:
            values["year"] = int(data["year"] or 0)
        if "date_service" in data:
            values["date_service"] = parse_date(data, "date_service") or False
        if data.get("state") in VEHICLE_STATES:
            values["state"] = data["state"]
        if "driver_id" in data:
            values["driver_id"] = int(data["driver_id"]) if data["driver_id"] else False
        if "asset_id" in data:
            if not _is_finance():
                raise ApiError(403, "forbidden", "Le rattachement à une immobilisation relève de la finance.")
            asset = request.env["account.asset"]
            if data["asset_id"]:
                asset = asset.browse(int(data["asset_id"])).exists()
                if not asset or asset.company_id != request.env.company:
                    raise ApiError(422, "business_rule", "Immobilisation inconnue dans la société de travail.")
            values["asset_id"] = asset.id or False
        if "active" in data:
            values["active"] = bool(data["active"])
        if "vehicle_kind" in data:
            if data["vehicle_kind"] not in dict(VEHICLE_KINDS):
                raise ApiError(400, "invalid_parameter", "Profil d'ensemble inconnu.")
            values["vehicle_kind"] = data["vehicle_kind"]
        if "payload_tonnes" in data:
            values["payload_tonnes"] = as_float(data["payload_tonnes"] or 0, "payload_tonnes")
        if {"ownership", "owner_id", "charges"} & set(data) and not _is_finance():
            raise ApiError(403, "forbidden", "Propriété et charges d'un ensemble relèvent de la finance.")
        if "ownership" in data:
            if data["ownership"] not in dict(OWNERSHIPS):
                raise ApiError(400, "invalid_parameter", "Propriété inconnue.")
            values["ownership"] = data["ownership"]
        if "owner_id" in data:
            values["owner_id"] = _partner(data["owner_id"], "Propriétaire").id if data["owner_id"] else False
        if "charges" in data:
            # Les charges sont renvoyées en entier, comme les tarifs d'une route.
            commands = [(5, 0, 0)]
            for c in data["charges"] or []:
                if not c.get("name"):
                    raise ApiError(400, "invalid_parameter", "Libellé de charge manquant.")
                if c.get("periodicity", "month") not in dict(PERIODICITIES):
                    raise ApiError(400, "invalid_parameter", "Périodicité inconnue.")
                commands.append((0, 0, {
                    "name": c["name"], "amount": as_float(c.get("amount") or 0, "amount"),
                    "periodicity": c.get("periodicity", "month"),
                    "date_from": parse_date(c, "date_from") or False, "date_to": parse_date(c, "date_to") or False,
                }))
            values["charge_ids"] = commands
        return values

    @staticmethod
    def _document_commands(vehicle, documents):
        """Documents renvoyés en entier : un document cité par son id est mis à jour, un nouveau est créé,
        un document absent de la liste est retiré. Un renouvellement s'ajoute : l'ancien reste à l'historique."""
        if not isinstance(documents or [], list):
            raise ApiError(400, "invalid_parameter", "Liste de documents attendue.")
        commands, seen = [], set()
        for d in documents or []:
            if not isinstance(d, dict):
                raise ApiError(400, "invalid_parameter", "Document attendu sous forme d'objet.")
            if d.get("kind") not in dict(DOCUMENT_KINDS):
                raise ApiError(400, "invalid_parameter", "Nature de document inconnue.")
            expiry = parse_date(d, "expiry_date")
            if not expiry:
                raise ApiError(400, "invalid_parameter", "Date d'expiration du document manquante.")
            line = {"kind": d["kind"], "reference": d.get("reference") or False, "issuer": d.get("issuer") or False,
                    "date_start": parse_date(d, "date_start") or False, "expiry_date": expiry,
                    "note": d.get("note") or False}
            if d.get("id"):
                try:
                    wanted = int(d["id"])
                except (TypeError, ValueError) as e:
                    raise ApiError(400, "invalid_parameter", "Identifiant de document invalide.") from e
                doc = vehicle.document_ids.filtered(lambda x, i=wanted: x.id == i)
                if not doc:
                    raise ApiError(422, "business_rule", "Document inconnu pour cet ensemble.")
                seen.add(doc.id)
                commands.append((1, doc.id, line))
            else:
                commands.append((0, 0, line))
        return commands + [(2, doc.id) for doc in vehicle.document_ids if doc.id not in seen]

    @api_route("/transport/vehicles", methods=("POST",), profiles=WRITE)
    def create_vehicle(self, **_kw):
        data = read_json()
        require(data, "name")
        vehicle = request.env["eguitra.transport.vehicle"].create(self._vehicle_values(data))
        if "documents" in data:
            vehicle.write({"document_ids": self._document_commands(vehicle, data["documents"])})
        return {"id": vehicle.id, "name": vehicle.name}

    @api_route("/transport/vehicles/<int:vehicle_id>", methods=("PATCH",), profiles=WRITE)
    def update_vehicle(self, vehicle_id, **_kw):
        vehicle = _get("eguitra.transport.vehicle", vehicle_id, "Ensemble routier")
        data = read_json()
        vehicle.write(self._vehicle_values(data))
        if "documents" in data:
            vehicle.write({"document_ids": self._document_commands(vehicle, data["documents"])})
        return {"status": "ok"}

    @api_route("/transport/vehicles/<int:vehicle_id>/documents/<int:document_id>/file", methods=("POST",),
               profiles=WRITE)
    def upload_document_file(self, vehicle_id, document_id, **_kw):
        """Pièce jointe d'un document (attestation, procès-verbal) : format reconnu au contenu, 15 Mo au plus."""
        doc = self._vehicle_document(vehicle_id, document_id)
        upload = request.httprequest.files.get("file")
        if not upload:
            raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
        content = upload.read(MAX_DOCUMENT + 1)
        if len(content) > MAX_DOCUMENT:
            raise ApiError(413, "too_large", "Fichier trop volumineux (15 Mo maximum).")
        mimetype = detect_type(content)
        if not mimetype:
            raise ApiError(415, "unsupported_type", f"Pièce jointe au format {ACCEPTED}.")
        previous = doc.sudo().attachment_id
        doc.attachment_id = request.env["ir.attachment"].create({
            "name": checked_name(upload.filename, mimetype, "document"), "datas": base64.b64encode(content),
            "res_model": doc._name, "res_id": doc.id, "mimetype": mimetype,
        })
        previous.unlink()  # la pièce remplacée ne reste pas rattachée au document
        return _document_row(doc)

    @api_route("/transport/vehicles/<int:vehicle_id>/documents/<int:document_id>/file", profiles=READ)
    def download_document_file(self, vehicle_id, document_id, **_kw):
        attachment = self._vehicle_document(vehicle_id, document_id).sudo().attachment_id
        if not attachment:
            raise ApiError(404, "not_found", "Pièce jointe introuvable.")
        return request.make_response(base64.b64decode(attachment.datas), headers=[
            ("Content-Type", attachment.mimetype or "application/octet-stream"),
            ("Content-Disposition", content_disposition(attachment.name)), ("Cache-Control", "no-store"),
        ])

    @staticmethod
    def _vehicle_document(vehicle_id, document_id):
        vehicle = _get("eguitra.transport.vehicle", vehicle_id, "Ensemble routier")
        doc = vehicle.document_ids.filtered(lambda d: d.id == document_id)
        if not doc:
            raise ApiError(404, "not_found", "Document introuvable.")
        return doc

    @api_route("/transport/drivers", profiles=READ)
    def drivers(self, **_kw):
        return [
            {"id": d.id, "name": d.name, "phone": d.phone or None, "license_number": d.license_number or None,
             "license_expiry": d.license_expiry, "partner": _ref(d.partner_id), "active": d.active}
            for d in request.env["eguitra.transport.driver"].with_context(active_test=False).search([])
        ]

    def _driver_values(self, data):
        values = {k: data[k] or False for k in ("name", "phone", "license_number") if k in data}
        if "license_expiry" in data:
            values["license_expiry"] = parse_date(data, "license_expiry")
        if "partner_id" in data:
            # Fiche tiers du chauffeur : frais de mission, créance des manquants.
            partner = request.env["res.partner"]
            if data["partner_id"]:
                partner = partner.browse(int(data["partner_id"])).exists()
                if not partner:
                    raise ApiError(422, "business_rule", "Tiers inconnu.")
            values["partner_id"] = partner.id or False
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
             "distance_km": r.distance_km, "distance_return_km": r.distance_return_km or None,
             "round_trip_km": r._round_trip_km(), "round_trip_inconsistent": r._round_trip_inconsistent(),
             "duration_days": r.duration_days or None, "default_rate": r.default_rate, "active": r.active,
             "tariffs": [_tariff_row(t) for t in r.tariff_ids],
             **{k: r[k] for k in ROUTE_STANDARDS}, "fuel_per_km": r._fuel_per_km(),
             **self._route_official(r)}
            for r in request.env["eguitra.transport.route"].with_context(active_test=False).search([])
        ]

    @staticmethod
    def _route_official(route):
        """Tarif officiel de la route (barème en vigueur), écart du tarif par défaut, et, sans rattachement,
        la destination du barème que suggère le nom de la route."""
        line = route._official_at(today())
        return {"official_rate_id": route.official_rate_id.id or None, "official_rate": _official_ref(line),
                "default_rate_gap": _gap(gap_pct(route.default_rate, line)),
                "official_suggestion": None if route.official_rate_id else _official_ref(route._suggest_official_rate())}

    @api_route("/transport/official-rates", profiles=READ)
    def official_rates(self, **kw):
        """Barème officiel en vigueur (ou celui de scale_id) : destinations par dépôt, filtre depot et q."""
        Scale = request.env["eguitra.transport.official.scale"]
        scales = Scale.search([])
        scale = Scale.browse(int_arg(kw, "scale_id")).exists() if kw.get("scale_id") else Scale._in_force(today())
        if kw.get("scale_id") and not scale:
            raise ApiError(404, "not_found", "Barème introuvable.")
        lines = scale.rate_ids
        if kw.get("depot"):
            if kw["depot"] not in dict(DEPOTS):
                raise ApiError(400, "invalid_parameter", "Dépôt inconnu.")
            lines = lines.filtered(lambda r: r.depot == kw["depot"])
        if kw.get("q"):
            wanted = slug(kw["q"])
            lines = lines.filtered(lambda r: wanted in slug(r.destination) or wanted in slug(r.prefecture))
        return {
            "scale": {"id": scale.id, "name": scale.name, "authority": scale.authority or None,
                      "date_signed": scale.date_signed or None, "date_from": scale.date_from, "note": scale.note or None,
                      "rate_count": scale.rate_count} if scale else None,
            "scales": [{"id": s.id, "name": s.name, "date_from": s.date_from} for s in scales],
            "depots": [{"code": k, "label": v, "count": len(scale.rate_ids.filtered(lambda r, k=k: r.depot == k))}
                       for k, v in DEPOTS],
            "items": [_official_ref(line) for line in lines],
            "tolerance": request.env.company.transport_official_rate_tolerance,
        }

    def _route_values(self, data, route=None):
        values = {k: data[k] or False for k in ("name", "origin", "destination") if k in data}
        for key in ("distance_km", "distance_return_km"):
            if key in data:
                values[key] = int(data[key] or 0)
        if "duration_days" in data:
            values["duration_days"] = as_float(data["duration_days"] or 0, "duration_days")
        if "default_rate" in data:
            values["default_rate"] = as_float(data["default_rate"] or 0, "default_rate")
        for key in ROUTE_STANDARDS:
            if key in data:
                values[key] = as_float(data[key] or 0, key)
        if "active" in data:
            values["active"] = bool(data["active"])
        if "official_rate_id" in data:
            line = request.env["eguitra.transport.official.rate"]
            if data["official_rate_id"]:
                try:
                    line = line.browse(int(data["official_rate_id"])).exists()
                except (TypeError, ValueError) as e:
                    raise ApiError(400, "invalid_parameter", "Destination du barème inconnue.") from e
                if not line:
                    raise ApiError(422, "business_rule", "Destination du barème inconnue.")
            values["official_rate_id"] = line.id or False
        if "tariffs" in data:
            # Les tarifs sont renvoyés en entier. Le tarif du même client et du même produit est mis à jour
            # (il garde ses conditions de manquant, fixées par la finance), un nouveau est créé ; retirer un
            # tarif de la liste le supprime, ce que seule la finance peut faire.
            kept = {(t.partner_id.id, t.product_id.id): t for t in (route.tariff_ids if route else [])}
            finance = _is_finance()
            commands, seen, couples = [], set(), set()
            for t in data["tariffs"] or []:
                product = _product(t).id if (t.get("product") or t.get("product_id")) else False
                line = {"partner_id": int(t["partner_id"]), "product_id": product,
                        "rate": as_float(t.get("rate", 0), "rate")}
                if (line["partner_id"], product) in couples:
                    raise ApiError(400, "invalid_parameter",
                                   "Un seul tarif par client et par produit sur une route : le nouveau remplace l'ancien.")
                couples.add((line["partner_id"], product))
                if finance:
                    line.update(_tariff_terms(t))
                previous = kept.get((line["partner_id"], product))
                if previous and previous.id not in seen:
                    seen.add(previous.id)
                    commands.append((1, previous.id, line))
                else:
                    commands.append((0, 0, line))
            removed = [t for t in kept.values() if t.id not in seen]
            if removed and not finance:
                raise ApiError(403, "forbidden", "La suppression d'un tarif client relève de la finance.")
            values["tariff_ids"] = commands + [(2, t.id) for t in removed]
        return values

    @api_route("/transport/routes", methods=("POST",), profiles=WRITE)
    def create_route(self, **_kw):
        data = read_json()
        require(data, "name")
        route = request.env["eguitra.transport.route"].create(self._route_values(data))
        return {"id": route.id, "name": route.name}

    @api_route("/transport/routes/<int:route_id>", methods=("PATCH",), profiles=WRITE)
    def update_route(self, route_id, **_kw):
        route = _get("eguitra.transport.route", route_id, "Route")
        route.write(self._route_values(read_json(), route))
        return {"status": "ok"}

    @api_route("/transport/tariffs/<int:tariff_id>", methods=("PATCH",), profiles=SETTINGS)
    def update_tariff(self, tariff_id, **_kw):
        """Conditions de manquant d'un tarif client (tolérance, prix du m³), fixées par la finance."""
        tariff = _get("eguitra.transport.tariff", tariff_id, "Tarif")
        tariff.write(_tariff_terms(read_json()))
        return _tariff_row(tariff)

    # ─── Produits transportés ─────────────────────────────────────────────

    @api_route("/transport/products", profiles=READ)
    def products(self, **_kw):
        Product = request.env["eguitra.transport.product"].with_context(active_test=False)
        return [_product_row(p) for p in Product.search([])]

    def _product_values(self, data):
        values = {}
        if "name" in data:
            values["name"] = str(data["name"] or "").strip() or False
        if "code" in data:
            values["code"] = str(data["code"] or "").strip().lower() or False
        if "sequence" in data:
            values["sequence"] = int(data["sequence"] or 0)
        if "active" in data:
            values["active"] = bool(data["active"])
        for key in ("density_15", "shortage_price"):
            if key in data:
                values[key] = as_float(data[key] or 0, key)
        return values

    @api_route("/transport/products", methods=("POST",), profiles=SETTINGS)
    def create_product(self, **_kw):
        data = read_json()
        require(data, "name", "code")
        # Un produit créé à l'écran appartient à la société de travail.
        values = dict(self._product_values(data), company_id=request.env.company.id)
        return _product_row(request.env["eguitra.transport.product"].create(values))

    @api_route("/transport/products/<int:product_id>", methods=("PATCH",), profiles=SETTINGS)
    def update_product(self, product_id, **_kw):
        product = _get("eguitra.transport.product", product_id, "Produit")
        values = self._product_values(read_json())
        if "code" in values and values["code"] != product.code:
            # Le code est la clé des saisies gardées sur les téléphones et des fichiers de reprise.
            raise ApiError(422, "business_rule", "Le code d'un produit ne change pas : créez un autre produit.")
        product.write(values)
        return _product_row(product)

    # ─── Paramètres : manquants ───────────────────────────────────────────

    @api_route("/transport/settings", profiles=READ)
    def settings(self, **_kw):
        return _settings_payload()

    @api_route("/transport/settings", methods=("PATCH",), profiles=SETTINGS)
    def update_settings(self, **_kw):
        data = read_json()
        company = request.env.company
        values = {}
        if "shortage_tolerance" in data:
            values["transport_shortage_tolerance"] = _tolerance(data["shortage_tolerance"], "shortage_tolerance") or 0.0
        if "shortage_rule" in data:
            if data["shortage_rule"] not in dict(SHORTAGE_RULES):
                raise ApiError(400, "invalid_parameter", "Traitement du manquant inconnu.")
            values["transport_shortage_rule"] = data["shortage_rule"]
        if "volume_correction" in data:
            values["transport_volume_correction"] = bool(data["volume_correction"])
        if "official_rate_tolerance" in data:
            tolerance = as_float(data["official_rate_tolerance"] or 0, "official_rate_tolerance")
            if not 0 <= tolerance <= 100:
                raise ApiError(400, "invalid_parameter", "Écart toléré au barème attendu entre 0 et 100 %.")
            values["transport_official_rate_tolerance"] = tolerance
        if "owner_cost_basis" in data:
            if data["owner_cost_basis"] not in dict(OWNER_COST_BASES):
                raise ApiError(400, "invalid_parameter", "Base des charges des relevés inconnue.")
            values["transport_owner_cost_basis"] = data["owner_cost_basis"]
        for key, field in (("shortage_account_id", "transport_shortage_account_id"),
                           ("claim_account_id", "transport_claim_account_id"),
                           ("owner_account_id", "transport_owner_account_id"),
                           ("owner_income_account_id", "transport_owner_income_account_id"),
                           ("commission_account_id", "transport_commission_account_id")):
            if key in data:
                account = request.env["account.account"]
                if data[key]:
                    account = account.browse(int(data[key])).exists()
                    if not account or company not in account.company_ids:
                        raise ApiError(422, "business_rule", "Compte inconnu dans la société de travail.")
                values[field] = account.id or False
        if "activity_id" in data:
            activity = request.env["account.analytic.account"]
            if data["activity_id"]:
                try:
                    activity = activity.sudo().browse(int(data["activity_id"])).exists()
                except (TypeError, ValueError) as e:
                    raise ApiError(400, "invalid_parameter", "Activité inconnue.") from e
                if activity not in _activities(company):
                    raise ApiError(422, "business_rule", "Activité inconnue dans la société de travail.")
            values["transport_activity_id"] = activity.id or False
        # La fiche société n'est modifiable que par l'administration du noyau : écriture limitée
        # à ces paramètres, pour la société de travail.
        company.sudo().write(values)
        return _settings_payload()

    @api_route("/transport/clients", profiles=READ)
    def clients(self, **_kw):
        """Clients du transport et leurs conditions de manquant (tolérance, traitement)."""
        env = request.env
        clients = env["eguitra.transport.tariff"].search([]).partner_id
        for (partner,) in env["eguitra.transport.rotation"]._read_group([], ["partner_id"]):
            clients |= partner
        return [_client_row(c) for c in clients.commercial_partner_id.sorted("name")]

    @api_route("/transport/clients/<int:partner_id>", methods=("PATCH",), profiles=SETTINGS)
    def update_client(self, partner_id, **_kw):
        partner = _get("res.partner", partner_id, "Client")
        data = read_json()
        values = {}
        if "shortage_tolerance" in data:
            tolerance = _tolerance(data["shortage_tolerance"], "shortage_tolerance")
            values.update(transport_tolerance_custom=tolerance is not None, transport_shortage_tolerance=tolerance or 0.0)
        if "shortage_rule" in data:
            if data["shortage_rule"] and data["shortage_rule"] not in dict(SHORTAGE_RULES):
                raise ApiError(400, "invalid_parameter", "Traitement du manquant inconnu.")
            values["transport_shortage_rule"] = data["shortage_rule"] or False
        partner.write(values)
        return _client_row(partner)

    # ─── Taxes spécifiques ────────────────────────────────────────────────

    @api_route("/transport/taxes", profiles=READ)
    def taxes(self, **_kw):
        Tax = request.env["eguitra.transport.tax"].with_context(active_test=False)
        return {"taxes": [_tax_row(t) for t in Tax.search([])],
                "natures": [{"code": k, "label": v} for k, v in TAX_NATURES],
                "bases": [{"code": k, "label": v} for k, v in TAX_BASES]}

    def _tax_values(self, data):
        values = {}
        if "name" in data:
            values["name"] = str(data["name"] or "").strip() or False
        for key, choices in (("nature", TAX_NATURES), ("base", TAX_BASES)):
            if key in data:
                if data[key] not in dict(choices):
                    raise ApiError(400, "invalid_parameter", f"Valeur inconnue : {key}.")
                values[key] = data[key]
        if "rate" in data:
            values["rate"] = as_float(data["rate"] or 0, "rate")
        for key in ("rebillable", "rebill_vat", "active"):
            if key in data:
                values[key] = bool(data[key])
        for key in ("date_from", "date_to"):
            if key in data:
                values[key] = parse_date(data, key) or False
        if "sequence" in data:
            values["sequence"] = int(data["sequence"] or 0)
        for key, model in (("product_ids", "eguitra.transport.product"), ("route_ids", "eguitra.transport.route")):
            if key in data:
                ids = [int(i) for i in data[key] or []]
                records = request.env[model].browse(ids).exists()
                if len(records) != len(set(ids)):
                    raise ApiError(422, "business_rule", f"Référence inconnue : {key}.")
                values[key] = [(6, 0, records.ids)]
        for key in ("account_id", "income_account_id"):
            if key in data:
                account = request.env["account.account"]
                if data[key]:
                    account = account.browse(int(data[key])).exists()
                    if not account or request.env.company not in account.company_ids:
                        raise ApiError(422, "business_rule", "Compte inconnu dans la société de travail.")
                values[key] = account.id or False
        return values

    @api_route("/transport/taxes", methods=("POST",), profiles=SETTINGS)
    def create_tax(self, **_kw):
        data = read_json()
        require(data, "name", "nature", "base", "rate")
        return _tax_row(request.env["eguitra.transport.tax"].create(self._tax_values(data)))

    @api_route("/transport/taxes/<int:tax_id>", methods=("PATCH",), profiles=SETTINGS)
    def update_tax(self, tax_id, **_kw):
        tax = _get("eguitra.transport.tax", tax_id, "Taxe")
        tax.write(self._tax_values(read_json()))
        return _tax_row(tax)

    def _statement_period(self, kw):
        end = parse_date(kw, "date_to", today())
        start = parse_date(kw, "date_from", end.replace(month=1, day=1))
        if start > end:
            raise ApiError(400, "invalid_parameter", "Période invalide.")
        return start, end

    @api_route("/transport/taxes/statement", profiles=READ)
    def tax_statement(self, **kw):
        """État mensuel des taxes spécifiques par nature."""
        start, end = self._statement_period(kw)
        result = request.env["eguitra.transport.rotation.tax"].statement(companies(kw), start, end)
        if not _sees_accounts():
            result["booked"] = []
        return dict(result, date_from=start, date_to=end)

    @api_route("/transport/taxes/statement.xlsx", profiles=READ)
    def tax_statement_xlsx(self, **kw):
        import xlsxwriter

        start, end = self._statement_period(kw)
        scope = companies(kw)
        data = request.env["eguitra.transport.rotation.tax"].statement(scope, start, end)
        if not _sees_accounts():
            data["booked"] = []
        out = io.BytesIO()
        book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
        head = book.add_format({"bold": True, "bg_color": "#11221D", "font_color": "#FFFFFF"})
        bold = book.add_format({"bold": True})
        money = book.add_format({"num_format": "#,##0"})
        months = data["months"]

        sheet = book.add_worksheet("État mensuel")
        sheet.write_string(0, 0, "Taxes spécifiques du transport", bold)
        xlsx_row(sheet, 1, [", ".join(scope.mapped("name")), f"Du {start:%d/%m/%Y} au {end:%d/%m/%Y}",
                            f"Édité le {today():%d/%m/%Y}"])
        xlsx_row(sheet, 3, ["Nature", *months, "Total", "dont refacturé", "Lignes"], head)
        r = 4
        for row in data["natures"]:
            xlsx_row(sheet, r, [row["label"], *[row["months"][m] for m in months], row["total"], row["rebillable"],
                                row["lines"]], money)
            r += 1
        totals = data["totals"]
        xlsx_row(sheet, r, ["Total", *[totals["months"][m] for m in months], totals["total"], totals["rebillable"], None],
                 bold)
        if data["booked"]:
            r += 2
            sheet.write_string(r, 0, "Comptabilisé sur les comptes du barème (pièces validées)", bold)
            r += 1
            xlsx_row(sheet, r, ["Compte", *months, "Total"], head)
            for item in data["booked"]:
                r += 1
                account = item["account"]
                xlsx_row(sheet, r, [f"{account['code']} {account['name']}", *[item["months"][m] for m in months],
                                    item["total"]], money)
        sheet.set_column(0, 0, 42)
        sheet.set_column(1, len(months) + 3, 14)

        detail = book.add_worksheet("Détail")
        xlsx_row(detail, 0, ["Date", "Rotation", "Ensemble", "Route", "Client", "Produit", "Nature", "Taxe", "Base",
                             "Assiette", "Taux", "Montant", "Refacturée"], head)
        natures, bases = dict(TAX_NATURES), dict(TAX_BASES)
        domain = [("company_id", "in", scope.ids), ("rotation_id.state", "in", ("done", "invoiced")),
                  ("date", ">=", start), ("date", "<=", end)]
        r = 0
        for line in request.env["eguitra.transport.rotation.tax"].search(domain, order="date, rotation_id, id"):
            rot = line.rotation_id
            r += 1
            xlsx_row(detail, r, [line.date.isoformat(), rot.name, rot.vehicle_id.name, rot.route_id.name,
                                 rot.partner_id.name, rot.product_id.name, natures.get(line.nature, ""), line.name,
                                 bases.get(line.base, ""), line.base_amount, line.rate, line.amount,
                                 "oui" if line.rebillable else ""])
        manual = request.env["eguitra.transport.rotation"].search(
            [("company_id", "in", scope.ids), ("state", "in", ("done", "invoiced")), ("date_loading", ">=", start),
             ("date_loading", "<=", end), ("specific_taxes_manual", "!=", 0)], order="date_loading, id")
        for rot in manual:
            r += 1
            xlsx_row(detail, r, [rot.date_loading.isoformat(), rot.name, rot.vehicle_id.name, rot.route_id.name,
                                 rot.partner_id.name, rot.product_id.name, "Forfait hors barème", "Montant saisi", "", None,
                                 None, rot.specific_taxes_manual, ""])
        detail.set_column(0, 12, 16)
        book.close()
        return request.make_response(out.getvalue(), headers=[
            ("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            ("Content-Disposition", f'attachment; filename="taxes_transport_{start:%Y%m}_{end:%Y%m}.xlsx"'),
        ])

    # ─── Rotations ────────────────────────────────────────────────────────

    @api_route("/transport/rotations", profiles=READ)
    def rotations(self, **kw):
        domain = []
        if kw.get("state"):
            domain.append(("state", "in", kw["state"].split(",")))
        for key in ("vehicle_id", "partner_id", "route_id", "driver_id"):
            if kw.get(key):
                domain.append((key, "=", int_arg(kw, key)))
        if kw.get("shortage") == "excess":
            domain.append(("shortage_excess", ">", 0))
        start, end = parse_date(kw, "date_from"), parse_date(kw, "date_to")
        if start:
            domain.append(("date_loading", ">=", start))
        if end:
            domain.append(("date_loading", "<=", end))
        Rotation = request.env["eguitra.transport.rotation"]
        limit, offset = int_arg(kw, "limit", 100, 1, 1000), int_arg(kw, "offset", 0, 0)
        rots = Rotation.search(domain, limit=limit, offset=offset, order=_rotation_order(kw.get("sort")))
        [(revenue, margin, volume)] = Rotation._read_group(domain, aggregates=["revenue:sum", "margin:sum", "volume_delivered:sum"])
        official = {}  # tarif officiel par route et date de chargement, lu une fois pour la page
        return {"items": [_rotation_row(r, official=official) for r in rots], "total_count": Rotation.search_count(domain),
                "offset": offset, "limit": limit,
                "totals": {"revenue": revenue or 0.0, "margin": margin or 0.0, "volume": volume or 0.0},
                # Marge minimale de la règle d'alerte, pour juger le taux de chaque ligne (comme /transport/summary).
                "margin_min": _margin_min()}

    @api_route("/transport/rotations/<int:rotation_id>", profiles=READ)
    def rotation(self, rotation_id, **_kw):
        return _rotation_row(_get("eguitra.transport.rotation", rotation_id, "Rotation"), detail=True)

    @api_route("/transport/rotations", methods=("POST",), profiles=WRITE)
    def create_rotation(self, **_kw):
        data = read_json()
        require(data, "vehicle_id", "partner_id", "route_id")
        rot = request.env["eguitra.transport.rotation"].create(_rotation_values(data))
        if data.get("validate"):
            with _blockers("validate"):
                rot.action_validate()
        return _rotation_row(rot, detail=True)

    @api_route("/transport/rotations/<int:rotation_id>", methods=("PATCH",), profiles=WRITE)
    def update_rotation(self, rotation_id, **_kw):
        rot = _get("eguitra.transport.rotation", rotation_id, "Rotation")
        if rot.state not in ("draft", "en_route", "done"):
            raise ApiError(422, "business_rule", "Seule une rotation saisie ou validée se modifie.")
        rot.write(_rotation_values(read_json()))
        return _rotation_row(rot)

    @api_route("/transport/rotations/<int:rotation_id>/<string:action>", methods=("POST",), profiles=WRITE)
    def rotation_action(self, rotation_id, action, **_kw):
        rot = _get("eguitra.transport.rotation", rotation_id, "Rotation")
        handlers = {"validate": rot.action_validate, "cancel": rot.action_cancel, "reset": rot.action_reset,
                    "depart": rot.action_depart}
        if action not in handlers:
            raise ApiError(404, "not_found", "Action inconnue.")
        with _blockers(action):
            handlers[action]()
        return _rotation_row(rot, detail=True)

    @api_route("/transport/rotations/validate", methods=("POST",), profiles=WRITE)
    def validate_many(self, **_kw):
        ids = [int(i) for i in read_json().get("ids") or []]
        rots = request.env["eguitra.transport.rotation"].browse(ids).exists()
        with _blockers("validate"):
            rots.action_validate()
        return [_rotation_row(r) for r in rots]

    @api_route("/transport/invoice", methods=("POST",), profiles=("admin", "finance"))
    def invoice(self, **_kw):
        ids = [int(i) for i in read_json().get("rotation_ids") or []]
        rots = request.env["eguitra.transport.rotation"].browse(ids).exists()
        invoices = rots.action_invoice()
        claims = rots.shortage_claim_move_id
        unclaimed = rots.filtered(lambda r: r.shortage_claim and not r.shortage_claim_move_id)
        return {"invoices": [move_summary(m) for m in invoices], "claims": [move_summary(m) for m in claims],
                # Manquant à porter sur un chauffeur sans fiche tiers : à régulariser à la main.
                "unclaimed": [{"rotation": r.name, "driver": _ref(r.driver_id), "amount": r.shortage_claim}
                              for r in unclaimed]}

    @api_route("/transport/profitability", profiles=READ)
    def profitability(self, **kw):
        """Rentabilité : coûts déclarés et comptabilisés, km, structure, résultat net, indicateurs, contrôles."""
        end = parse_date(kw, "date_to", today())
        start = parse_date(kw, "date_from", end.replace(month=1, day=1))
        if start > end:
            raise ApiError(400, "invalid_parameter", "Période attendue : date_from avant date_to.")
        group = kw.get("group", "vehicle")
        if group not in ("vehicle", "route", "driver", "client", "month"):
            raise ApiError(400, "invalid_parameter", "Regroupement inconnu.")
        report = request.env["eguitra.transport.analysis"].report(companies(kw), start, end, group)
        return report if _sees_accounts() else _operational(report)

    @api_route("/transport/controls", profiles=READ)
    def controls(self, **kw):
        return request.env["eguitra.transport.analysis"].controls(companies(kw))

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
        [(excess_count, excess, excess_value)] = Rotation._read_group(
            domain + [("shortage_excess", ">", 0)], aggregates=["__count", "shortage_excess:sum", "shortage_value:sum"]
        )
        margin_min = _margin_min()
        return {
            "date_from": start, "date_to": end, "rotations": count, "volume": volume or 0.0, "revenue": revenue or 0.0,
            "cost": cost or 0.0, "margin": margin or 0.0, "margin_rate": (margin / revenue * 100) if revenue else None,
            "margin_min": margin_min,
            "to_invoice": {"count": to_invoice_count, "amount": to_invoice or 0.0},
            "shortage_excess": {"count": excess_count, "volume": excess or 0.0, "value": excess_value or 0.0},
            "drafts": Rotation.search_count([("state", "=", "draft")]),
            "en_route": Rotation.search_count([("state", "=", "en_route")]),
            "fleet": {s: request.env["eguitra.transport.vehicle"].search_count([("state", "=", s)])
                      for s in VEHICLE_STATES},
        }

    # ─── Synchronisation de l'application mobile ──────────────────────────

    @api_route("/transport/sync", methods=("POST",), profiles=WRITE)
    def sync(self, **_kw):
        """Rotations saisies hors réseau : chaque saisie porte un identifiant unique (idempotence).

        Une saisie déjà reçue répond « exists », sauf si le téléphone la renvoie corrigée (« correction » :
        l'agent l'a modifiée après un premier envoi dont la réponse s'est perdue, ou pendant un envoi) : le
        brouillon est alors mis à jour (« updated ») s'il est encore en saisie, saisi par ce compte et pas
        retouché au bureau depuis ; sinon il reste tel quel et le bureau le corrige depuis sa fiche."""
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
                results.append(self._sync_existing(existing, item, uuid))
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

    def _sync_existing(self, rot, item, uuid):
        """Réponse à une saisie déjà reçue (voir sync) : « exists », ou correction du brouillon de son auteur."""
        exists = {"client_uuid": uuid, "status": "exists", "id": rot.id, "state": rot.state}
        if not item.get("correction"):
            return exists
        user = request.env.user
        # Retouchée au bureau (dernière écriture d'un autre compte), validée, facturée ou annulée, ou saisie
        # par un autre compte : la correction du téléphone n'écrase rien.
        if rot.state != "draft" or rot.create_uid != user or rot.write_uid != user:
            return dict(exists, message="Déjà reçue au bureau, qui l'a traitée ou modifiée : la correction n'y est "
                                        "pas portée. Faites corriger la rotation au bureau, depuis sa fiche.")
        if any(not item.get(k) for k in ("vehicle_id", "partner_id", "route_id")):
            return {"client_uuid": uuid, "status": "error", "message": "Ensemble, client et route sont obligatoires."}
        try:
            with request.env.cr.savepoint():
                before = (rot.partner_id, rot.route_id, rot.product_id, rot.vehicle_id)
                rot.write(_rotation_values(item))
                # Comme à la création : tarif du client et de la route, chauffeur habituel de l'ensemble.
                if (rot.partner_id, rot.route_id, rot.product_id) != before[:3]:
                    rot.rate = rot.route_id._rate_for(rot.partner_id, rot.product_id)
                if rot.vehicle_id != before[3] and not item.get("driver_id"):
                    rot.driver_id = rot.vehicle_id.driver_id
        except (ApiError, UserError, ValidationError) as e:
            message = e.message if isinstance(e, ApiError) else str(e.args[0])
            return {"client_uuid": uuid, "status": "error", "message": message}
        except Exception:  # noqa: BLE001 - une correction défectueuse ne bloque pas les autres saisies
            _logger.exception("Synchronisation mobile : correction de la saisie %s rejetée", uuid)
            return {"client_uuid": uuid, "status": "error", "message": "Correction invalide."}
        return {"client_uuid": uuid, "status": "updated", "id": rot.id}
