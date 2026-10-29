"""API de la chaîne documentaire d'une opération de transport : ordres de transport, opérations (tracteur et
remorque, convoyeur, dates prévues), ordre de mission, budgets de voyage (approbation, décaissement, bons
carburant, justification, clôture, écarts), lettre de voiture et réception, documents prêts ou incomplets,
PDF, réglages.

Droits par profil (règle du projet) :
- exploitation (responsable des opérations) : ordres de transport, opérations, ordres de mission, budgets
  (saisie, soumission), lettres de voiture et réceptions ;
- finance : décaissement des avances, justification et clôture, rapprochement des bons carburant ;
- direction : lecture, et approbation des budgets au-delà des seuils (corbeille « À valider ») ;
- administration : tout, dont les réglages des documents ; rubriques et comptes avec la finance.
"""

import base64

from odoo import fields, http
from odoo.exceptions import UserError
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require
from odoo.addons.eguitra_api.files import ACCEPTED, checked_name, detect_type
from odoo.addons.eguitra_finance.controllers.common import as_float, parse_date

from ..models.budget import COST_FIELDS, KINDS, PREFILLS, TRIP_STATES, UNITS
from ..models.documents_setup import DOCUMENT_SEQUENCES
from ..models.equipment import UNIT_KINDS
from ..models.mission import DIRECTIONS
from ..models.order import ORDER_STATES, QUANTITY_UOMS
from ..models.waybill import WEIGHT_UOMS
from .transport import _get, _int, _partner, _ref, _rotation_row, _rotation_values

READ = ("admin", "direction", "finance", "exploitation")
OPS = ("admin", "exploitation")
CASH = ("admin", "finance")
VOUCHER_CANCEL = ("admin", "exploitation", "finance")
RUBRICS = ("admin", "finance")
ADMIN = ("admin",)
MAX_FILE = 15 * 1024 * 1024
PDF_REPORTS = {
    "mission": "eguitra_transport.action_report_operation_mission",
    "budget": "eguitra_transport.action_report_operation_budget",
    "waybill": "eguitra_transport.action_report_operation_waybill",
}
ORDER_TEXT = ("goods_description", "packaging", "origin", "destination", "destination_country", "consignee",
              "billing_address", "client_ref", "note", "client_signatory", "attached_documents")
ORDER_FLAGS = ("service_transport", "with_loading", "with_unloading", "with_storage", "extra_insurance")
ORDER_NUMBERS = ("quantity", "weight_gross", "weight_net", "goods_value")
WAYBILL_TEXT = ("bill_of_lading", "client_ref", "shipper", "loading_place", "consignee", "destination", "forwarder",
                "delivery_agent", "loader_clerk", "note")
RECEPTION_TEXT = ("receiver_name", "damage_cause")
RECEPTION_TIMES = ("vehicle_arrival_at", "unloading_at", "vehicle_departure_at")


def _profiles():
    return set(request.env.user._eguitra_profiles())


def _datetime(data, key):
    """Date et heure saisies à l'écran (« 2026-10-22T08:30 », heure de Conakry, UTC+0) ; vide : False."""
    value = data.get(key)
    if not value:
        return False
    text = str(value).replace("T", " ").rstrip("Z")
    try:
        return fields.Datetime.to_datetime(text if len(text) > 10 else f"{text} 00:00:00")
    except ValueError as e:
        raise ApiError(400, "invalid_parameter", f"{key} : date et heure illisibles.") from e


def _choice(data, key, choices, label):
    value = data.get(key)
    if value not in dict(choices):
        raise ApiError(400, "invalid_parameter", f"{label} inconnu.")
    return value


def _file(field="file"):
    upload = request.httprequest.files.get(field)
    if not upload:
        raise ApiError(400, "missing_fields", "Fichier manquant.", fields=[field])
    content = upload.read(MAX_FILE + 1)
    if len(content) > MAX_FILE:
        raise ApiError(413, "too_large", "Fichier trop volumineux (15 Mo maximum).")
    mimetype = detect_type(content)
    if not mimetype:
        raise ApiError(415, "unsupported_type", f"Pièce jointe au format {ACCEPTED}.")
    return upload, content, mimetype


def _attachment(record, upload, content, mimetype, default):
    return request.env["ir.attachment"].sudo().create({
        "name": checked_name(upload.filename, mimetype, default), "datas": base64.b64encode(content),
        "res_model": record._name, "res_id": record.id, "mimetype": mimetype,
    })


def _download(attachment):
    if not attachment:
        raise ApiError(404, "not_found", "Pièce jointe introuvable.")
    return request.make_response(base64.b64decode(attachment.datas), headers=[
        ("Content-Type", attachment.mimetype or "application/octet-stream"),
        ("Content-Disposition", content_disposition(attachment.name)), ("Cache-Control", "no-store"),
    ])


def _pdf(report, records, filename):
    pdf, _kind = request.env["ir.actions.report"].sudo()._render_qweb_pdf(report, records.ids)
    return request.make_response(pdf, headers=[
        ("Content-Type", "application/pdf"), ("Content-Disposition", content_disposition(filename)),
        ("Cache-Control", "no-store"),
    ])


def _unit_ref(unit):
    return {"id": unit.id, "name": unit.display_name, "fleet_number": unit.fleet_number,
            "plate": unit.plate or None} if unit else None


def _attachment_ref(attachment):
    attachment = attachment.sudo()
    return {"id": attachment.id, "name": attachment.name} if attachment else None


# ─── Ordres de transport ──────────────────────────────────────────────────


def _order_row(order, detail=False):
    row = {
        "id": order.id, "name": order.name if order.name != "/" else None, "state": order.state,
        "state_label": dict(ORDER_STATES)[order.state], "date": order.date, "client": _ref(order.partner_id),
        "product": _ref(order.product_id), "goods_description": order.goods_description or None,
        "quantity": order.quantity, "quantity_uom": order.quantity_uom, "quantity_label": order._quantity_label() or None,
        "origin": order.origin or order.route_id.origin or None,
        "destination": order.destination or order.route_id.destination or None,
        "route": _ref(order.route_id), "client_ref": order.client_ref or None,
        "operations": order.rotation_count, "delivered": order.delivered_count, "invoiced": order.invoiced_count,
        "signed": bool(order.sudo().signed_attachment_id),
    }
    if detail:
        row.update({
            **{k: order[k] or None for k in ORDER_TEXT}, **{k: order[k] for k in ORDER_FLAGS},
            **{k: order[k] for k in ORDER_NUMBERS},
            "consignee_effective": order._consignee(), "billing_address_effective": order._billing_address(),
            "signed_attachment": _attachment_ref(order.signed_attachment_id),
            "validated_by": _ref(order.validated_by), "validated_at": order.validated_at or None,
            "cancel_reason": order.cancel_reason or None,
            "missing": order._missing(), "document": order._document_status(),
            "rotations": [_operation_brief(r) for r in order.rotation_ids.sorted(
                lambda r: (r.date_planned_departure or r.date_loading, r.id))],
        })
    return row


def _operation_brief(rot):
    docs = rot._transport_documents()
    return {
        "id": rot.id, "name": rot._label(), "state": rot.state, "date_loading": rot.date_loading,
        "vehicle": _ref(rot.vehicle_id), "tractor": _unit_ref(rot.tractor_id), "trailer": _unit_ref(rot.trailer_id),
        "driver": _ref(rot.driver_id), "co_driver": _ref(rot.co_driver_id), "route": _ref(rot.route_id),
        "date_planned_departure": rot.date_planned_departure or None,
        "date_planned_arrival": rot.date_planned_arrival or None,
        "date_planned_return": rot.date_planned_return or None,
        "volume_planned": rot.volume_planned, "volume_loaded": rot.volume_loaded,
        "volume_delivered": rot.volume_delivered, "trip_state": rot.trip_state,
        "documents_ready": sum(1 for d in docs if d["ready"]), "documents": [
            {"code": d["code"], "label": d["label"], "ready": d["ready"]} for d in docs],
    }


def _order_values(data, order=None):
    values = {}
    if "partner_id" in data:
        values["partner_id"] = _partner(data["partner_id"], "Client").id
    if "date" in data:
        values["date"] = parse_date(data, "date")
    for key in ORDER_TEXT:
        if key in data:
            values[key] = str(data[key] or "").strip() or False
    for key in ORDER_FLAGS:
        if key in data:
            values[key] = bool(data[key])
    for key in ORDER_NUMBERS:
        if key in data:
            values[key] = as_float(data[key] or 0, key)
    if "quantity_uom" in data:
        values["quantity_uom"] = _choice(data, "quantity_uom", QUANTITY_UOMS, "Unité")
    if "product_id" in data:
        product = request.env["eguitra.transport.product"]
        if data["product_id"]:
            product = product.browse(_int(data["product_id"], "Produit")).exists()
            if not product:
                raise ApiError(422, "business_rule", "Produit inconnu.")
        values["product_id"] = product.id or False
    if "route_id" in data:
        route = request.env["eguitra.transport.route"]
        if data["route_id"]:
            route = route.browse(_int(data["route_id"], "Route")).exists()
            if not route:
                raise ApiError(422, "business_rule", "Route inconnue.")
        values["route_id"] = route.id or False
    return values


# ─── Budgets ──────────────────────────────────────────────────────────────


def _budget_row(budget, detail=False):
    rot = budget.rotation_id
    row = {
        "id": budget.id, "name": budget.name, "kind": budget.kind, "number": budget.number, "label": budget._label(),
        "reason": budget.reason or None, "state": budget.state, "date": budget.date,
        "date_start": budget.date_start or None, "date_end": budget.date_end or None, "days": budget.days,
        "amount_nature": budget.amount_nature, "amount_cash": budget.amount_cash, "amount_total": budget.amount_total,
        "rotation": {"id": rot.id, "name": rot._label(), "vehicle": _ref(rot.vehicle_id), "driver": _ref(rot.driver_id),
                     "route": _ref(rot.route_id), "client": _ref(rot.partner_id), "order": _ref(rot.order_id),
                     "state": rot.state, "trip_state": rot.trip_state},
        "disbursed": bool(budget.disbursement_line_id), "disbursed_at": budget.disbursed_at or None,
        "disbursed_by": _ref(budget.disbursed_by),
        "submitted_by": _ref(budget.submitted_by), "self_submitted": budget.submitted_by == request.env.user,
        "vouchers": len(budget.voucher_ids.filtered(lambda v: v.state != "cancelled")),
    }
    if detail:
        row.update({
            "note": budget.note or None, "cancel_reason": budget.cancel_reason or None,
            "lines": [{"id": line.id, "rubric": _ref(line.rubric_id), "kind": line.kind,
                       "description": line.description or None, "quantity": line.quantity, "unit": line.unit,
                       "price_unit": line.price_unit, "amount": line.amount, "reference": line.reference or None,
                       "partner": _ref(line.partner_id)} for line in budget.line_ids],
            "approval": budget._eguitra_approval_info(),
            "missing": budget._missing_for_submit() if budget.state in ("draft", "rejected") else [],
            "voucher_list": [_voucher_row(v) for v in budget.voucher_ids],
            "disbursement": {"id": budget.sudo().disbursement_line_id.id,
                             "journal": budget.sudo().disbursement_line_id.journal_id.name}
            if budget.disbursement_line_id else None,
        })
    return row


def _budget_lines(data):
    """Lignes renvoyées en entier (budget en brouillon ou refusé)."""
    lines = data.get("lines")
    if not isinstance(lines, list):
        raise ApiError(400, "invalid_parameter", "Liste de lignes attendue.")
    Rubric = request.env["eguitra.transport.budget.rubric"]
    commands = [(5, 0, 0)]
    for i, line in enumerate(lines):
        if not isinstance(line, dict):
            raise ApiError(400, "invalid_parameter", "Ligne attendue sous forme d'objet.")
        rubric = Rubric.browse(_int(line.get("rubric_id"), "Rubrique")).exists()
        if not rubric or rubric.company_id != request.env.company:
            raise ApiError(422, "business_rule", "Rubrique inconnue dans la société de travail.")
        kind = line.get("kind") or rubric.kind
        if kind not in dict(KINDS):
            raise ApiError(400, "invalid_parameter", "Nature de ligne inconnue (en nature ou en espèces).")
        unit = line.get("unit") or rubric.unit
        if unit not in dict(UNITS):
            raise ApiError(400, "invalid_parameter", "Unité inconnue.")
        values = {"sequence": (i + 1) * 10, "rubric_id": rubric.id, "kind": kind, "unit": unit,
                  "description": str(line.get("description") or "").strip() or False,
                  "quantity": as_float(line.get("quantity", 1) or 0, "quantity"),
                  "price_unit": as_float(line.get("price_unit") or 0, "price_unit"),
                  "reference": str(line.get("reference") or "").strip() or False, "partner_id": False}
        if line.get("partner_id"):
            values["partner_id"] = _partner(line["partner_id"], "Station").id
        commands.append((0, 0, values))
    return commands


def _voucher_row(voucher):
    return {
        "id": voucher.id, "name": voucher.name, "state": voucher.state, "date": voucher.date,
        "station": _ref(voucher.partner_id), "driver": _ref(voucher.driver_id), "description": voucher.description or None,
        "quantity": voucher.quantity, "price_unit": voucher.price_unit, "amount": voucher.amount,
        "actual_amount": voucher._actual(), "budget": {"id": voucher.budget_id.id, "name": voucher.budget_id.name},
        "rotation": {"id": voucher.rotation_id.id, "name": voucher.rotation_id._label(),
                     "vehicle": _ref(voucher.rotation_id.vehicle_id)},
        "invoice": {"id": voucher.sudo().invoice_id.id, "name": voucher.sudo().invoice_id.name or None,
                    "ref": voucher.sudo().invoice_id.ref or None} if voucher.invoice_id else None,
        "reconciled_at": voucher.reconciled_at or None, "reconciled_by": _ref(voucher.reconciled_by),
    }


def _expense_row(expense):
    return {"id": expense.id, "rubric": _ref(expense.rubric_id), "date": expense.date or None,
            "description": expense.description or None, "quantity": expense.quantity, "unit": expense.unit,
            "amount": expense.amount, "reference": expense.reference or None,
            "attachments": [_attachment_ref(a) for a in expense.sudo().attachment_ids]}


def _expense_values(data):
    values = {}
    if "rubric_id" in data:
        rubric = request.env["eguitra.transport.budget.rubric"].browse(_int(data["rubric_id"], "Rubrique")).exists()
        if not rubric or rubric.company_id != request.env.company:
            raise ApiError(422, "business_rule", "Rubrique inconnue dans la société de travail.")
        values["rubric_id"] = rubric.id
    if "date" in data:
        values["date"] = parse_date(data, "date") or False
    for key in ("description", "reference"):
        if key in data:
            values[key] = str(data[key] or "").strip() or False
    for key in ("quantity", "amount"):
        if key in data:
            values[key] = as_float(data[key] or 0, key)
    if "unit" in data:
        values["unit"] = _choice(data, "unit", UNITS, "Unité")
    return values


def _trip_payload(rot):
    return {
        "rotation": {"id": rot.id, "name": rot._label(), "state": rot.state, "driver": _ref(rot.driver_id),
                     "vehicle": _ref(rot.vehicle_id), "route": _ref(rot.route_id)},
        "summary": rot._trip_summary(), "variances": rot._trip_variances(),
        "budgets": [_budget_row(b) for b in rot._live_budgets()],
        "expenses": [_expense_row(e) for e in rot.expense_ids],
        "vouchers": [_voucher_row(v) for v in rot.voucher_ids],
        "journal": _ref(rot.company_id.sudo()._transport_budget_journal()),
    }


# ─── Lettre de voiture ────────────────────────────────────────────────────


def _waybill_payload(rot):
    waybill = rot._waybill()
    effective = {
        "shipper": waybill._shipper() if waybill else rot.partner_id.commercial_partner_id.name,
        "loading_place": waybill._loading_place() if waybill else (rot.route_id.origin or None),
        "consignee": waybill._consignee() if waybill else (
            rot.order_id._consignee() if rot.order_id else rot.partner_id.commercial_partner_id.name),
        "destination": waybill._destination() if waybill else (rot.route_id.destination or None),
        "client_ref": waybill._client_ref() if waybill else ((rot.order_id.client_ref if rot.order_id else None) or None),
        "packages": waybill._packages() if waybill else rot._default_packages(),
    }
    payload = {"exists": bool(waybill), "effective": effective, "missing": rot._waybill_missing(waybill),
               "rotation": {"id": rot.id, "name": rot._label(), "state": rot.state,
                            "volume_loaded": rot.volume_loaded, "volume_delivered": rot.volume_delivered,
                            "shortage": rot.shortage, "date_delivery": rot.date_delivery or None}}
    if waybill:
        payload.update({
            "id": waybill.id, "name": waybill.name, "date": waybill.date,
            **{k: waybill[k] or None for k in WAYBILL_TEXT}, "weight_uom": waybill.weight_uom,
            "loading_at": waybill.loading_at or None, "arrival_planned_at": waybill.arrival_planned_at or None,
            "packages": [{"id": p.id, "nature": p.nature, "description": p.description or None,
                          "weight_gross": p.weight_gross, "weight_net": p.weight_net, "packaging": p.packaging or None,
                          "wrapping": p.wrapping or None, "dimensions": p.dimensions or None, "count": p.count}
                         for p in waybill.package_ids],
            "reception": {
                "receiver_name": waybill.receiver_name or None,
                **{k: waybill[k] or None for k in RECEPTION_TIMES},
                "received_qty": waybill.received_qty, "damaged_qty": waybill.damaged_qty,
                "damage_cause": waybill.damage_cause or None, "shortage_qty": waybill.shortage_qty,
                "receiver_visa": waybill.receiver_visa,
                "attachment": _attachment_ref(waybill.reception_attachment_id),
                "received_by": _ref(waybill.received_by), "received_at": waybill.received_at or None,
                "free_days": waybill.free_days, "immobilized_days": waybill.immobilized_days,
                "billable_days": waybill.billable_days, "demurrage_billable": waybill.demurrage_billable,
                "demurrage_rate": waybill.demurrage_rate, "demurrage_amount": waybill.demurrage_amount,
            },
        })
    return payload


def _mission_payload(rot):
    mission = rot._mission()
    return {
        "exists": bool(mission), "id": mission.id or None, "name": mission.name if mission else None,
        "date": mission.date if mission else None,
        "steps": rot._mission_steps(), "from_route": not mission,
        "authorities_note": (mission.authorities_note if mission else None) or None,
        "authorities_default": rot.company_id.transport_authorities_note or None,
        "note": (mission.note if mission else None) or None, "missing": rot._mission_missing(),
    }


def _operation_payload(rot):
    order = rot.order_id
    return {
        "rotation": _rotation_row(rot, detail=True),
        "order": _order_row(order) if order else None,
        "documents": rot._transport_documents(),
        "mission": _mission_payload(rot),
        "budgets": [_budget_row(b) for b in rot._live_budgets()],
        "trip": rot._trip_summary(),
        "waybill": _waybill_payload(rot),
        "can": {"ops": bool(set(OPS) & _profiles()), "cash": bool(set(CASH) & _profiles())},
    }


# ─── Réglages ─────────────────────────────────────────────────────────────


def _rubric_row(rubric, accounts=True):
    account = rubric.sudo().account_id if accounts else rubric.browse()
    return {"id": rubric.id, "code": rubric.code, "name": rubric.name, "kind": rubric.kind, "unit": rubric.unit,
            "cost_field": rubric.cost_field, "prefill": rubric.prefill, "sequence": rubric.sequence,
            "active": rubric.active,
            "account": {"id": account.id, "code": account.code, "name": account.name} if account else None}


def _settings_payload():
    company = request.env.company
    sees = bool(set(RUBRICS) & _profiles())
    sudo = company.sudo()
    advance = sudo.transport_advance_account_id if sees else None
    return {
        "prefixes": company._transport_prefixes(),
        "documents": [{"code": code, "label": label, "default": prefix}
                      for code, (_c, prefix, label) in DOCUMENT_SEQUENCES.items()],
        "free_days": company.transport_demurrage_free_days,
        "authorities_note": company.transport_authorities_note or "",
        "waybill_note": company.transport_waybill_note or "",
        "order_signatory": company.transport_order_signatory or "",
        "order_signatory_name": company.transport_order_signatory_name or "",
        "operations_manager": company.transport_operations_manager or "",
        "fuel_station": _ref(sudo.transport_fuel_station_id),
        "instructions": [{"id": i.id, "name": i.name, "sequence": i.sequence}
                         for i in request.env["eguitra.transport.driver.instruction"].search(
                             [("company_id", "=", company.id)])],
        "advance_account": {"id": advance.id, "code": advance.code, "name": advance.name} if advance else None,
        "journal": _ref(sudo.transport_budget_journal_id),
        "journals": [_ref(j) for j in request.env["account.journal"].sudo().search(
            [("company_id", "=", company.id), ("type", "in", ("cash", "bank"))])] if sees else [],
        "rubrics": [_rubric_row(r, sees) for r in request.env["eguitra.transport.budget.rubric"].with_context(
            active_test=False).search([("company_id", "=", company.id)])],
        "kinds": [{"code": k, "label": v} for k, v in KINDS], "units": [{"code": k, "label": v} for k, v in UNITS],
        "cost_fields": [{"code": k, "label": v} for k, v in COST_FIELDS],
        "prefills": [{"code": k, "label": v} for k, v in PREFILLS],
        "can_edit": "admin" in _profiles(), "can_edit_rubrics": sees,
    }


class EguitraTransportDocuments(http.Controller):
    # ─── Ordres de transport ──────────────────────────────────────────────

    @api_route("/transport/orders", profiles=READ)
    def orders(self, **kw):
        domain = []
        if kw.get("state"):
            domain.append(("state", "in", kw["state"].split(",")))
        if kw.get("partner_id"):
            domain.append(("partner_id", "=", int_arg(kw, "partner_id")))
        if kw.get("q"):
            domain += ["|", "|", ("name", "ilike", kw["q"]), ("client_ref", "ilike", kw["q"]),
                       ("partner_id.name", "ilike", kw["q"])]
        Order = request.env["eguitra.transport.order"]
        limit, offset = int_arg(kw, "limit", 100, 1, 500), int_arg(kw, "offset", 0, 0)
        return {"items": [_order_row(o) for o in Order.search(domain, limit=limit, offset=offset)],
                "total_count": Order.search_count(domain), "offset": offset, "limit": limit,
                "states": [{"code": k, "label": v} for k, v in ORDER_STATES]}

    @api_route("/transport/orders/<int:order_id>", profiles=READ)
    def order(self, order_id, **_kw):
        return _order_row(_get("eguitra.transport.order", order_id, "Ordre de transport"), detail=True)

    @api_route("/transport/orders", methods=("POST",), profiles=OPS)
    def create_order(self, **_kw):
        data = read_json()
        require(data, "partner_id")
        order = request.env["eguitra.transport.order"].create(_order_values(data))
        return _order_row(order, detail=True)

    @api_route("/transport/orders/<int:order_id>", methods=("PATCH",), profiles=OPS)
    def update_order(self, order_id, **_kw):
        order = _get("eguitra.transport.order", order_id, "Ordre de transport")
        order.write(_order_values(read_json(), order))
        return _order_row(order, detail=True)

    @api_route("/transport/orders/<int:order_id>/validate", methods=("POST",), profiles=OPS)
    def validate_order(self, order_id, **_kw):
        """Accord du client : l'ordre complet est validé (la pièce signée se joint avant ou après)."""
        order = _get("eguitra.transport.order", order_id, "Ordre de transport")
        order.action_validate()
        return _order_row(order, detail=True)

    @api_route("/transport/orders/<int:order_id>/reset", methods=("POST",), profiles=OPS)
    def reset_order(self, order_id, **_kw):
        order = _get("eguitra.transport.order", order_id, "Ordre de transport")
        order.action_reset()
        return _order_row(order, detail=True)

    @api_route("/transport/orders/<int:order_id>/cancel", methods=("POST",), profiles=OPS)
    def cancel_order(self, order_id, **_kw):
        order = _get("eguitra.transport.order", order_id, "Ordre de transport")
        (reason,) = require(read_json(), "reason")
        order.action_cancel(reason)
        return _order_row(order, detail=True)

    @api_route("/transport/orders/<int:order_id>/signed", methods=("POST",), profiles=OPS)
    def upload_signed(self, order_id, **_kw):
        """Ordre signé par le client (scan), 15 Mo au plus ; remplace le précédent."""
        order = _get("eguitra.transport.order", order_id, "Ordre de transport")
        if order.state == "cancelled":
            raise ApiError(422, "business_rule", "Ordre annulé.")
        upload, content, mimetype = _file()
        previous = order.sudo().signed_attachment_id
        order.signed_attachment_id = _attachment(order, upload, content, mimetype, "ordre-signe")
        previous.unlink()
        return _order_row(order, detail=True)

    @api_route("/transport/orders/<int:order_id>/signed", profiles=READ)
    def download_signed(self, order_id, **_kw):
        return _download(_get("eguitra.transport.order", order_id, "Ordre de transport").sudo().signed_attachment_id)

    @api_route("/transport/orders/<int:order_id>/pdf", profiles=READ)
    def order_pdf(self, order_id, **_kw):
        order = _get("eguitra.transport.order", order_id, "Ordre de transport")
        status = order._document_status()
        if not status["ready"]:
            raise ApiError(422, "document_incomplete", f"Ordre de transport incomplet : {', '.join(status['missing'])}.",
                           missing=status["missing"])
        return _pdf("eguitra_transport.action_report_transport_order", order,
                    f"Ordre de transport {order.name.replace('/', '-')}.pdf")

    @api_route("/transport/orders/<int:order_id>/operations", methods=("POST",), profiles=OPS)
    def create_operation(self, order_id, **_kw):
        """Opération (rotation) de l'ordre : ensemble, tracteur et remorque, équipage, route, dates prévues ; le
        client, le produit et la route viennent de l'ordre, le volume prévu de sa quantité."""
        order = _get("eguitra.transport.order", order_id, "Ordre de transport")
        data = read_json()
        require(data, "vehicle_id")
        values = _rotation_values(dict(data, partner_id=order.partner_id.id))
        values["order_id"] = order.id
        if not values.get("route_id"):
            if not order.route_id:
                raise ApiError(400, "missing_fields", "Route de l'opération manquante.", fields=["route_id"])
            values["route_id"] = order.route_id.id
        if "volume_planned" not in values and order._quantity_m3():
            # Reste de la quantité de l'ordre, dans la limite de la capacité de l'ensemble.
            planned = sum(order.rotation_ids.filtered(lambda r: r.state != "cancelled").mapped("volume_planned"))
            remaining = max(0.0, order._quantity_m3() - planned)
            capacity = request.env["eguitra.transport.vehicle"].browse(values["vehicle_id"]).capacity_liters / 1000
            values["volume_planned"] = min(remaining, capacity) if capacity else remaining
        if "date_planned_departure" in values and "date_loading" not in values:
            values["date_loading"] = values["date_planned_departure"]
        rot = request.env["eguitra.transport.rotation"].create(values)
        return _operation_payload(rot)

    # ─── Opération : panneau des documents et PDF ─────────────────────────

    @api_route("/transport/rotations/<int:rotation_id>/operation", profiles=READ)
    def operation(self, rotation_id, **_kw):
        return _operation_payload(_get("eguitra.transport.rotation", rotation_id, "Opération"))

    @api_route("/transport/rotations/<int:rotation_id>/documents", profiles=READ)
    def documents(self, rotation_id, **_kw):
        rot = _get("eguitra.transport.rotation", rotation_id, "Opération")
        return {"documents": rot._transport_documents(), "combined_pdf": f"/transport/rotations/{rot.id}/documents.pdf"}

    @api_route("/transport/rotations/<int:rotation_id>/documents/<string:code>.pdf", profiles=READ)
    def document_pdf(self, rotation_id, code, **_kw):
        rot = _get("eguitra.transport.rotation", rotation_id, "Opération")
        docs = {d["code"]: d for d in rot._transport_documents()}
        if code not in docs:
            raise ApiError(404, "not_found", "Document inconnu.")
        doc = docs[code]
        if not doc["ready"]:
            raise ApiError(422, "document_incomplete", f"{doc['label']} incomplet : {', '.join(doc['missing'])}.",
                           missing=doc["missing"])
        if code == "order":
            order = rot.order_id
            return _pdf("eguitra_transport.action_report_transport_order", order,
                        f"Ordre de transport {order.name.replace('/', '-')}.pdf")
        rot._materialize_documents([code])
        return _pdf(PDF_REPORTS[code], rot, f"{doc['label']} {rot._label().replace('/', '-')}.pdf")

    @api_route("/transport/rotations/<int:rotation_id>/documents.pdf", profiles=READ)
    def documents_pdf(self, rotation_id, **_kw):
        """Tous les documents prêts de l'opération, d'un clic, en un seul PDF."""
        rot = _get("eguitra.transport.rotation", rotation_id, "Opération")
        ready = rot._ready_documents()
        if not ready:
            raise ApiError(422, "document_incomplete", "Aucun document de l'opération n'est encore complet.")
        rot._materialize_documents(ready)
        return _pdf("eguitra_transport.action_report_operation_documents", rot,
                    f"Documents {rot._label().replace('/', '-')}.pdf")

    # ─── Ordre de mission ─────────────────────────────────────────────────

    @api_route("/transport/rotations/<int:rotation_id>/mission", profiles=READ)
    def mission(self, rotation_id, **_kw):
        return _mission_payload(_get("eguitra.transport.rotation", rotation_id, "Opération"))

    @api_route("/transport/rotations/<int:rotation_id>/mission", methods=("PUT",), profiles=OPS)
    def update_mission(self, rotation_id, **_kw):
        """Plan de voyage renvoyé en entier, mention aux autorités, observations ; reset : plan de la route."""
        rot = _get("eguitra.transport.rotation", rotation_id, "Opération")
        data = read_json()
        mission = rot._ensure_mission()
        values = {}
        if data.get("reset"):
            values["step_ids"] = [(5, 0, 0)] + [(0, 0, dict(step, sequence=(i + 1) * 10))
                                                for i, step in enumerate(rot.route_id._plan_steps())]
        elif "steps" in data:
            if not isinstance(data["steps"], list):
                raise ApiError(400, "invalid_parameter", "Liste d'étapes attendue.")
            commands = [(5, 0, 0)]
            for i, step in enumerate(data["steps"]):
                if not isinstance(step, dict) or not str(step.get("place") or "").strip():
                    raise ApiError(400, "invalid_parameter", "Chaque étape a un lieu.")
                commands.append((0, 0, {
                    "sequence": (i + 1) * 10, "place": str(step["place"]).strip(),
                    "city": str(step.get("city") or "").strip() or False,
                    "country": str(step.get("country") or "").strip() or False,
                    "direction": _choice(step, "direction", DIRECTIONS, "Sens") if step.get("direction") else "out",
                    "stop_reason": str(step.get("stop_reason") or "").strip() or False,
                }))
            values["step_ids"] = commands
        for key in ("authorities_note", "note"):
            if key in data:
                values[key] = str(data[key] or "").strip() or False
        if "date" in data:
            values["date"] = parse_date(data, "date") or mission.date
        mission.write(values)
        return _mission_payload(rot)

    # ─── Budgets de voyage ────────────────────────────────────────────────

    @api_route("/transport/budgets", profiles=READ)
    def budgets(self, **kw):
        """Listes de travail : à approuver, à décaisser, à justifier, écarts (opérations clôturées), tous."""
        view = kw.get("view", "all")
        Budget = request.env["eguitra.transport.budget"]
        Rotation = request.env["eguitra.transport.rotation"]
        limit = int_arg(kw, "limit", 200, 1, 500)
        if view == "to_approve":
            return {"view": view, "budgets": [_budget_row(b, detail=True) for b in Budget.search(
                [("state", "=", "submitted")], order="submitted_at", limit=limit)]}
        if view == "to_disburse":
            return {"view": view, "budgets": [_budget_row(b) for b in Budget.search(
                [("state", "=", "approved"), ("amount_cash", ">", 0), ("disbursement_line_id", "=", False)],
                order="approved_at", limit=limit)]}
        if view in ("to_justify", "variances"):
            states = ("to_justify",) if view == "to_justify" else ("closed",)
            rotations = Rotation.search([("trip_state", "in", states)], order="date_loading desc, id desc", limit=limit)
            return {"view": view, "rotations": [{
                "id": r.id, "name": r._label(), "vehicle": _ref(r.vehicle_id), "driver": _ref(r.driver_id),
                "route": _ref(r.route_id), "client": _ref(r.partner_id), "state": r.state, "trip_state": r.trip_state,
                "summary": r._trip_summary(), "variances": r._trip_variances(),
            } for r in rotations]}
        if view != "all":
            raise ApiError(400, "invalid_parameter", "Vue inconnue.")
        domain = []
        if kw.get("state"):
            domain.append(("state", "in", kw["state"].split(",")))
        return {"view": view, "budgets": [_budget_row(b) for b in Budget.search(domain, order="id desc", limit=limit)],
                "trip_states": [{"code": k, "label": v} for k, v in TRIP_STATES]}

    @api_route("/transport/budgets/<int:budget_id>", profiles=READ)
    def budget(self, budget_id, **_kw):
        return _budget_row(_get("eguitra.transport.budget", budget_id, "Budget de voyage"), detail=True)

    @api_route("/transport/rotations/<int:rotation_id>/budgets/new", methods=("POST",), profiles=OPS)
    def create_budget(self, rotation_id, **_kw):
        """Budget initial, pré-rempli depuis la route, ou additif motivé."""
        rot = _get("eguitra.transport.rotation", rotation_id, "Opération")
        data = read_json()
        kind = data.get("kind") or "initial"
        if kind not in ("initial", "additive"):
            raise ApiError(400, "invalid_parameter", "Type de budget inconnu.")
        if kind == "additive":
            require(data, "reason")
        budget = rot._new_budget(kind, str(data.get("reason") or "").strip() or None)
        return _budget_row(budget, detail=True)

    @api_route("/transport/budgets/<int:budget_id>", methods=("PATCH",), profiles=OPS)
    def update_budget(self, budget_id, **_kw):
        budget = _get("eguitra.transport.budget", budget_id, "Budget de voyage")
        data = read_json()
        values = {}
        for key in ("date_start", "date_end", "date"):
            if key in data:
                values[key] = parse_date(data, key) or False
        if "days" in data:
            values["days"] = as_float(data["days"] or 0, "days")
        for key in ("reason", "note"):
            if key in data:
                values[key] = str(data[key] or "").strip() or False
        if "lines" in data:
            values["line_ids"] = _budget_lines(data)
        budget.write(values)
        return _budget_row(budget, detail=True)

    @api_route("/transport/budgets/<int:budget_id>/prefill", methods=("POST",), profiles=OPS)
    def prefill_budget(self, budget_id, **_kw):
        budget = _get("eguitra.transport.budget", budget_id, "Budget de voyage")
        if budget.kind != "initial":
            raise ApiError(422, "business_rule", "Seul le budget initial se pré-remplit depuis la route.")
        budget._prefill()
        return _budget_row(budget, detail=True)

    @api_route("/transport/budgets/<int:budget_id>/submit", methods=("POST",), profiles=OPS)
    def submit_budget(self, budget_id, **_kw):
        """Soumission au circuit d'approbation (nature « Budgets de voyage ») ; sans règle, approuvé d'office."""
        budget = _get("eguitra.transport.budget", budget_id, "Budget de voyage")
        budget.action_submit()
        return _budget_row(budget, detail=True)

    @api_route("/transport/budgets/<int:budget_id>/cancel", methods=("POST",), profiles=OPS)
    def cancel_budget(self, budget_id, **_kw):
        budget = _get("eguitra.transport.budget", budget_id, "Budget de voyage")
        (reason,) = require(read_json(), "reason")
        budget.action_cancel(reason)
        return _budget_row(budget, detail=True)

    @api_route("/transport/budgets/<int:budget_id>/disburse", methods=("POST",), profiles=CASH)
    def disburse(self, budget_id, **_kw):
        """Avance en espèces remise au chauffeur, par la caisse choisie (à défaut celle des réglages)."""
        budget = _get("eguitra.transport.budget", budget_id, "Budget de voyage")
        data = read_json()
        journal = None
        if data.get("journal_id"):
            journal = request.env["account.journal"].browse(_int(data["journal_id"], "Caisse")).exists()
            if not journal:
                raise ApiError(422, "business_rule", "Caisse inconnue.")
        budget.action_disburse(journal, parse_date(data, "date"))
        return _budget_row(budget, detail=True)

    # ─── Justification et clôture ─────────────────────────────────────────

    @api_route("/transport/rotations/<int:rotation_id>/trip", profiles=READ)
    def trip(self, rotation_id, **_kw):
        return _trip_payload(_get("eguitra.transport.rotation", rotation_id, "Opération"))

    @api_route("/transport/rotations/<int:rotation_id>/trip/expenses", methods=("POST",), profiles=CASH)
    def create_expense(self, rotation_id, **_kw):
        rot = _get("eguitra.transport.rotation", rotation_id, "Opération")
        data = read_json()
        require(data, "rubric_id", "amount")
        if rot.trip_state not in ("to_justify", "to_disburse"):
            raise ApiError(422, "business_rule", "Aucun budget approuvé à justifier pour cette opération.")
        request.env["eguitra.transport.trip.expense"].create(dict(_expense_values(data), rotation_id=rot.id))
        return _trip_payload(rot)

    @api_route("/transport/trip-expenses/<int:expense_id>", methods=("PATCH",), profiles=CASH)
    def update_expense(self, expense_id, **_kw):
        expense = _get("eguitra.transport.trip.expense", expense_id, "Dépense")
        expense.write(_expense_values(read_json()))
        return _trip_payload(expense.rotation_id)

    @api_route("/transport/trip-expenses/<int:expense_id>", methods=("DELETE",), profiles=CASH)
    def delete_expense(self, expense_id, **_kw):
        expense = _get("eguitra.transport.trip.expense", expense_id, "Dépense")
        rot = expense.rotation_id
        expense.unlink()
        return _trip_payload(rot)

    @api_route("/transport/trip-expenses/<int:expense_id>/attachments", methods=("POST",), profiles=CASH)
    def add_expense_attachment(self, expense_id, **_kw):
        expense = _get("eguitra.transport.trip.expense", expense_id, "Dépense")
        expense._check_open()
        upload, content, mimetype = _file()
        attachment = _attachment(expense, upload, content, mimetype, "piece")
        expense.sudo().attachment_ids = [(4, attachment.id)]
        return _expense_row(expense)

    @api_route("/transport/trip-expenses/<int:expense_id>/attachments/<int:attachment_id>", profiles=READ)
    def download_expense_attachment(self, expense_id, attachment_id, **_kw):
        expense = _get("eguitra.transport.trip.expense", expense_id, "Dépense")
        return _download(expense.sudo().attachment_ids.filtered(lambda a: a.id == attachment_id))

    @api_route("/transport/rotations/<int:rotation_id>/trip/close", methods=("POST",), profiles=CASH)
    def close_trip(self, rotation_id, **_kw):
        """Clôture : reliquat ou complément par la caisse, dépenses en charges, coûts réels sur la rotation."""
        rot = _get("eguitra.transport.rotation", rotation_id, "Opération")
        data = read_json()
        journal = None
        if data.get("journal_id"):
            journal = request.env["account.journal"].browse(_int(data["journal_id"], "Caisse")).exists()
            if not journal:
                raise ApiError(422, "business_rule", "Caisse inconnue.")
        rot.action_trip_close(journal, parse_date(data, "date"))
        return _trip_payload(rot)

    # ─── Bons carburant ───────────────────────────────────────────────────

    @api_route("/transport/fuel-vouchers", profiles=READ)
    def vouchers(self, **kw):
        """Bons carburant, et par station le reste à rapprocher."""
        domain = []
        if kw.get("state"):
            domain.append(("state", "in", kw["state"].split(",")))
        if kw.get("partner_id"):
            domain.append(("partner_id", "=", int_arg(kw, "partner_id")))
        Voucher = request.env["eguitra.transport.fuel.voucher"]
        vouchers = Voucher.search(domain, limit=int_arg(kw, "limit", 300, 1, 1000))
        stations = {}
        for voucher in Voucher.search([("state", "=", "issued")]):
            row = stations.setdefault(voucher.partner_id.id, {"station": _ref(voucher.partner_id), "count": 0,
                                                              "amount": 0.0, "liters": 0.0})
            row["count"] += 1
            row["amount"] += voucher.amount
            row["liters"] += voucher.quantity
        return {"items": [_voucher_row(v) for v in vouchers],
                "stations": sorted(stations.values(), key=lambda r: -r["amount"])}

    @api_route("/transport/fuel-vouchers/invoices", profiles=CASH)
    def voucher_invoices(self, **kw):
        """Pièces d'achat d'une station, candidates au rapprochement des bons."""
        partner = _partner(kw.get("partner_id"), "Station")
        moves = request.env["account.move"].search([
            ("move_type", "=", "in_invoice"), ("partner_id", "child_of", partner.commercial_partner_id.id),
            ("state", "!=", "cancel"), ("company_id", "=", request.env.company.id)], order="invoice_date desc, id desc",
            limit=50)
        Voucher = request.env["eguitra.transport.fuel.voucher"]
        return [{"id": m.id, "name": m.name if m.name != "/" else None, "ref": m.ref or None, "state": m.state,
                 "date": m.invoice_date or m.date, "amount_untaxed": m.amount_untaxed,
                 "reconciliation": Voucher._reconciliation_gaps(m)} for m in moves]

    @api_route("/transport/fuel-vouchers/<int:voucher_id>/<string:action>", methods=("POST",),
               profiles=VOUCHER_CANCEL)
    def voucher_action(self, voucher_id, action, **_kw):
        voucher = _get("eguitra.transport.fuel.voucher", voucher_id, "Bon carburant")
        profiles = _profiles()
        if action in ("reconcile", "unreconcile") and not set(CASH) & profiles:
            raise ApiError(403, "forbidden", "Le rapprochement des bons carburant relève de la finance.")
        if action == "reconcile":
            data = read_json()
            (invoice_id,) = require(data, "invoice_id")
            invoice = request.env["account.move"].browse(_int(invoice_id, "Facture")).exists()
            if not invoice:
                raise ApiError(422, "business_rule", "Facture de la station inconnue.")
            amount = data.get("actual_amount")
            voucher.action_reconcile(invoice, as_float(amount, "actual_amount") if amount not in (None, "") else None)
            return dict(_voucher_row(voucher), reconciliation=voucher._reconciliation_gaps(invoice))
        if action == "unreconcile":
            voucher.action_unreconcile()
        elif action == "cancel":
            voucher.action_cancel()
        else:
            raise ApiError(404, "not_found", "Action inconnue.")
        return _voucher_row(voucher)

    # ─── Lettres de voiture et réceptions ─────────────────────────────────

    @api_route("/transport/waybills", profiles=READ)
    def waybills(self, **kw):
        """Lettres de voiture : à recevoir (opérations parties sans réception), reçues, immobilisations."""
        view = kw.get("view", "all")
        Waybill = request.env["eguitra.transport.waybill"]
        limit = int_arg(kw, "limit", 200, 1, 500)
        if view == "to_receive":
            rotations = request.env["eguitra.transport.rotation"].search(
                [("state", "in", ("draft", "en_route")), ("order_id", "!=", False)],
                order="date_planned_arrival, id", limit=limit)
            rotations = rotations.filtered(lambda r: not r._waybill().received_at)
        else:
            domain = {"received": [("received_at", "!=", False)], "demurrage": [("billable_days", ">", 0)],
                      "all": []}.get(view)
            if domain is None:
                raise ApiError(400, "invalid_parameter", "Vue inconnue.")
            rotations = Waybill.search(domain, limit=limit).rotation_id
        return {"view": view, "items": [dict(_waybill_payload(r), operation=_operation_brief(r)) for r in rotations]}

    @api_route("/transport/rotations/<int:rotation_id>/waybill", profiles=READ)
    def waybill(self, rotation_id, **_kw):
        return _waybill_payload(_get("eguitra.transport.rotation", rotation_id, "Opération"))

    @api_route("/transport/rotations/<int:rotation_id>/waybill", methods=("PUT",), profiles=OPS)
    def update_waybill(self, rotation_id, **_kw):
        """Lettre de voiture : ce qui lui est propre ou corrigé ; colis renvoyés en entier."""
        rot = _get("eguitra.transport.rotation", rotation_id, "Opération")
        data = read_json()
        waybill = rot._ensure_waybill()
        values = {}
        for key in WAYBILL_TEXT:
            if key in data:
                values[key] = str(data[key] or "").strip() or False
        for key in ("loading_at", "arrival_planned_at"):
            if key in data:
                values[key] = _datetime(data, key)
        if "weight_uom" in data:
            values["weight_uom"] = _choice(data, "weight_uom", WEIGHT_UOMS, "Unité des poids")
        if "packages" in data:
            if not isinstance(data["packages"], list):
                raise ApiError(400, "invalid_parameter", "Liste de colis attendue.")
            commands = [(5, 0, 0)]
            for i, package in enumerate(data["packages"]):
                if not isinstance(package, dict) or not str(package.get("nature") or "").strip():
                    raise ApiError(400, "invalid_parameter", "Chaque colis a une nature.")
                commands.append((0, 0, {
                    "sequence": (i + 1) * 10, "nature": str(package["nature"]).strip(),
                    **{k: str(package.get(k) or "").strip() or False
                       for k in ("description", "packaging", "wrapping", "dimensions")},
                    "weight_gross": as_float(package.get("weight_gross") or 0, "weight_gross"),
                    "weight_net": as_float(package.get("weight_net") or 0, "weight_net"),
                    "count": _int(package.get("count") or 0, "Nombre"),
                }))
            values["package_ids"] = commands
        waybill.write(values)
        return _waybill_payload(rot)

    @api_route("/transport/rotations/<int:rotation_id>/waybill/reception", methods=("POST",), profiles=OPS)
    def record_reception(self, rotation_id, **_kw):
        """Réception : elle fixe le volume livré et la date de livraison de l'opération (une seule saisie)."""
        rot = _get("eguitra.transport.rotation", rotation_id, "Opération")
        if rot.state == "cancelled":
            raise ApiError(422, "business_rule", "Opération annulée.")
        data = read_json()
        values = {}
        for key in RECEPTION_TEXT:
            if key in data:
                values[key] = str(data[key] or "").strip() or False
        for key in RECEPTION_TIMES:
            if key in data:
                values[key] = _datetime(data, key)
        for key in ("received_qty", "damaged_qty"):
            if key in data:
                values[key] = as_float(data[key] or 0, key)
        if "receiver_visa" in data:
            values["receiver_visa"] = bool(data["receiver_visa"])
        if "demurrage_billable" in data or "demurrage_rate" in data:
            if not set(RUBRICS) & _profiles():
                raise ApiError(403, "forbidden", "Le tarif d'immobilisation relève de la finance.")
            if "demurrage_billable" in data:
                values["demurrage_billable"] = bool(data["demurrage_billable"])
            if "demurrage_rate" in data:
                values["demurrage_rate"] = as_float(data["demurrage_rate"] or 0, "demurrage_rate")
        rot._record_reception(values)
        return dict(_waybill_payload(rot), operation=_rotation_row(rot))

    @api_route("/transport/rotations/<int:rotation_id>/waybill/visa", methods=("POST",), profiles=OPS)
    def upload_visa(self, rotation_id, **_kw):
        """Lettre de voiture visée par le réceptionnaire (scan)."""
        rot = _get("eguitra.transport.rotation", rotation_id, "Opération")
        waybill = rot._ensure_waybill()
        upload, content, mimetype = _file()
        previous = waybill.sudo().reception_attachment_id
        waybill.reception_attachment_id = _attachment(waybill, upload, content, mimetype, "lettre-de-voiture-visee")
        previous.unlink()
        return _waybill_payload(rot)

    @api_route("/transport/rotations/<int:rotation_id>/waybill/visa", profiles=READ)
    def download_visa(self, rotation_id, **_kw):
        rot = _get("eguitra.transport.rotation", rotation_id, "Opération")
        return _download(rot._waybill().sudo().reception_attachment_id)

    # ─── Tracteurs et remorques ───────────────────────────────────────────

    @api_route("/transport/units", profiles=READ)
    def units(self, **_kw):
        Unit = request.env["eguitra.transport.unit"].with_context(active_test=False)
        return [dict(_unit_ref(u), kind=u.kind, brand=u.brand or None, capacity_liters=u.capacity_liters,
                     note=u.note or None, active=u.active, vehicle=_ref(u._vehicle())) for u in Unit.search([])]

    def _unit_values(self, data):
        values = {}
        if "kind" in data:
            values["kind"] = _choice(data, "kind", UNIT_KINDS, "Type d'engin")
        for key in ("fleet_number", "plate", "brand", "note"):
            if key in data:
                values[key] = str(data[key] or "").strip() or False
        if "capacity_liters" in data:
            values["capacity_liters"] = _int(data["capacity_liters"] or 0, "Capacité")
        if "active" in data:
            values["active"] = bool(data["active"])
        return values

    @api_route("/transport/units", methods=("POST",), profiles=("admin", "finance", "exploitation"))
    def create_unit(self, **_kw):
        data = read_json()
        require(data, "kind", "fleet_number")
        unit = request.env["eguitra.transport.unit"].create(self._unit_values(data))
        return _unit_ref(unit)

    @api_route("/transport/units/<int:unit_id>", methods=("PATCH",), profiles=("admin", "finance", "exploitation"))
    def update_unit(self, unit_id, **_kw):
        unit = _get("eguitra.transport.unit", unit_id, "Engin")
        values = self._unit_values(read_json())
        if "kind" in values and values["kind"] != unit.kind:
            raise ApiError(422, "business_rule", "Un tracteur reste un tracteur, une remorque une remorque.")
        unit.write(values)
        return _unit_ref(unit)

    # ─── Réglages des documents ───────────────────────────────────────────

    @api_route("/transport/documents/settings", profiles=READ)
    def settings(self, **_kw):
        return _settings_payload()

    @api_route("/transport/documents/settings", methods=("PATCH",), profiles=ADMIN)
    def update_settings(self, **_kw):
        """Préfixes, franchise, mentions, signataires, station habituelle, consignes au chauffeur."""
        data = read_json()
        company = request.env.company
        values = {}
        if "free_days" in data:
            days = _int(data["free_days"] or 0, "Franchise")
            if not 0 <= days <= 60:
                raise ApiError(400, "invalid_parameter", "Franchise attendue entre 0 et 60 jours.")
            values["transport_demurrage_free_days"] = days
        for key, field in (("authorities_note", "transport_authorities_note"),
                           ("waybill_note", "transport_waybill_note"),
                           ("order_signatory", "transport_order_signatory"),
                           ("order_signatory_name", "transport_order_signatory_name"),
                           ("operations_manager", "transport_operations_manager")):
            if key in data:
                values[field] = str(data[key] or "").strip() or False
        if "fuel_station_id" in data:
            values["transport_fuel_station_id"] = _partner(data["fuel_station_id"], "Station").id \
                if data["fuel_station_id"] else False
        for document, prefix in (data.get("prefixes") or {}).items():
            try:
                company._transport_set_prefix(document, prefix)
            except UserError as e:
                raise ApiError(400, "invalid_parameter", str(e.args[0])) from e
        if "instructions" in data:
            if not isinstance(data["instructions"], list):
                raise ApiError(400, "invalid_parameter", "Liste de consignes attendue.")
            Instruction = request.env["eguitra.transport.driver.instruction"].sudo()
            Instruction.search([("company_id", "=", company.id)]).unlink()
            Instruction.create([{"company_id": company.id, "sequence": (i + 1) * 10, "name": str(text).strip()}
                                for i, text in enumerate(data["instructions"]) if str(text or "").strip()])
        # Fiche société modifiable par l'administration du noyau seulement : écriture limitée à ces réglages.
        company.sudo().write(values)
        return _settings_payload()

    @api_route("/transport/documents/accounts", methods=("PATCH",), profiles=RUBRICS)
    def update_accounts(self, **_kw):
        """Compte des avances de frais de route et caisse des budgets de voyage (finance et administration)."""
        data = read_json()
        company = request.env.company
        values = {}
        if "advance_account_id" in data:
            account = request.env["account.account"]
            if data["advance_account_id"]:
                account = account.browse(_int(data["advance_account_id"], "Compte")).exists()
                if not account or company not in account.company_ids:
                    raise ApiError(422, "business_rule", "Compte inconnu dans la société de travail.")
            values["transport_advance_account_id"] = account.id or False
        if "journal_id" in data:
            journal = request.env["account.journal"]
            if data["journal_id"]:
                journal = journal.browse(_int(data["journal_id"], "Caisse")).exists()
                if not journal or journal.company_id != company or journal.type not in ("cash", "bank"):
                    raise ApiError(422, "business_rule", "Caisse inconnue dans la société de travail.")
            values["transport_budget_journal_id"] = journal.id or False
        company.sudo().write(values)
        return _settings_payload()

    @api_route("/transport/budget-rubrics", methods=("PUT",), profiles=RUBRICS)
    def update_rubrics(self, **_kw):
        """Rubriques des budgets renvoyées en entier : une rubrique citée par son id est mise à jour, une nouvelle
        créée ; une rubrique absente est archivée (les budgets passés la gardent)."""
        data = read_json()
        rubrics = data.get("rubrics")
        if not isinstance(rubrics, list):
            raise ApiError(400, "invalid_parameter", "Liste de rubriques attendue.")
        company = request.env.company
        Rubric = request.env["eguitra.transport.budget.rubric"].with_context(active_test=False)
        existing = Rubric.search([("company_id", "=", company.id)])
        seen = set()
        for i, item in enumerate(rubrics):
            if not isinstance(item, dict):
                raise ApiError(400, "invalid_parameter", "Rubrique attendue sous forme d'objet.")
            require(item, "name", "code")
            values = {
                "sequence": (i + 1) * 10, "name": str(item["name"]).strip(), "code": str(item["code"]).strip().lower(),
                "kind": _choice(item, "kind", KINDS, "Nature") if item.get("kind") else "cash",
                "unit": _choice(item, "unit", UNITS, "Unité") if item.get("unit") else "fixed",
                "cost_field": _choice(item, "cost_field", COST_FIELDS, "Coût") if item.get("cost_field") else "other_costs",
                "prefill": _choice(item, "prefill", PREFILLS, "Pré-remplissage") if item.get("prefill") else "none",
                "active": bool(item.get("active", True)),
            }
            if "account_id" in item:
                account = request.env["account.account"]
                if item["account_id"]:
                    account = account.browse(_int(item["account_id"], "Compte")).exists()
                    if not account or company not in account.company_ids:
                        raise ApiError(422, "business_rule", "Compte inconnu dans la société de travail.")
                values["account_id"] = account.id or False
            if item.get("id"):
                wanted = _int(item["id"], "Rubrique")
                rubric = existing.filtered(lambda r, rid=wanted: r.id == rid)
                if not rubric:
                    raise ApiError(422, "business_rule", "Rubrique inconnue.")
                rubric.write(values)
                seen.add(rubric.id)
            else:
                seen.add(Rubric.create(dict(values, company_id=company.id)).id)
        existing.filtered(lambda r: r.id not in seen).write({"active": False})
        return _settings_payload()
