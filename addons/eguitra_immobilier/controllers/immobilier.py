"""API Immobilier : biens, baux, loyers, quittances, relances, patrimoine."""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require
from odoo.addons.eguitra_finance.controllers.common import as_float, companies, move_summary, parse_date, today

from ..models.property import KINDS

READ = ("admin", "direction", "finance", "immobilier")
WRITE = ("admin", "finance", "immobilier")


def _get(model, record_id, label):
    record = request.env[model].browse(record_id).exists()
    if not record:
        raise ApiError(404, "not_found", f"{label} introuvable.")
    return record


def _lease_row(l):
    return {
        "id": l.id, "name": l.name, "property": {"id": l.property_id.id, "name": l.property_id.name},
        "tenant": {"id": l.partner_id.id, "name": l.partner_id.name}, "date_start": l.date_start, "date_end": l.date_end,
        "rent": l.rent, "charges": l.charges, "periodicity": l.periodicity, "vat": l.vat,
        "deposit_amount": l.deposit_amount, "state": l.state, "next_invoice_date": l.next_invoice_date,
    }


def _property_row(p):
    active = p.lease_ids.filtered(lambda l: l.state == "active")[:1]
    return {
        "id": p.id, "name": p.name, "kind": p.kind, "address": p.address or None, "city": p.city or None,
        "area_m2": p.area_m2, "acquisition_date": p.acquisition_date, "acquisition_value": p.acquisition_value,
        "current_value": p.current_value, "valuation_date": p.valuation_date, "occupied": p.occupied,
        "lease": _lease_row(active) if active else None, "active": p.active,
    }


class EguitraImmobilier(http.Controller):
    @api_route("/immobilier/summary", profiles=READ)
    def summary(self, **kw):
        return request.env["eguitra.lease"].summary(companies(kw), today())

    @api_route("/immobilier/properties", profiles=READ)
    def properties(self, **_kw):
        return {"items": [_property_row(p) for p in request.env["eguitra.property"].search([])],
                "kinds": [{"code": k, "label": v} for k, v in KINDS]}

    def _property_values(self, data):
        values = {k: data[k] or False for k in ("name", "address", "city", "note") if k in data}
        if data.get("kind") in dict(KINDS):
            values["kind"] = data["kind"]
        for key in ("area_m2", "acquisition_value", "current_value"):
            if key in data:
                values[key] = as_float(data[key] or 0, key)
        for key in ("acquisition_date", "valuation_date"):
            if key in data:
                values[key] = parse_date(data, key)
        if "active" in data:
            values["active"] = bool(data["active"])
        return values

    @api_route("/immobilier/properties", methods=("POST",), profiles=WRITE)
    def create_property(self, **_kw):
        data = read_json()
        require(data, "name")
        return _property_row(request.env["eguitra.property"].create(self._property_values(data)))

    @api_route("/immobilier/properties/<int:property_id>", methods=("PATCH",), profiles=WRITE)
    def update_property(self, property_id, **_kw):
        prop = _get("eguitra.property", property_id, "Bien")
        prop.write(self._property_values(read_json()))
        return _property_row(prop)

    @api_route("/immobilier/leases", profiles=READ)
    def leases(self, **kw):
        domain = [("state", "in", kw["state"].split(","))] if kw.get("state") else []
        return [_lease_row(l) for l in request.env["eguitra.lease"].search(domain)]

    @api_route("/immobilier/leases", methods=("POST",), profiles=WRITE)
    def create_lease(self, **_kw):
        data = read_json()
        name, property_id, partner_id, start, rent = require(data, "name", "property_id", "partner_id", "date_start", "rent")
        values = {
            "name": name, "property_id": int(property_id), "partner_id": int(partner_id),
            "date_start": parse_date(data, "date_start"), "date_end": parse_date(data, "date_end"),
            "rent": as_float(rent, "rent"), "charges": as_float(data.get("charges") or 0, "charges"),
            "deposit_amount": as_float(data.get("deposit_amount") or 0, "deposit_amount"),
            "vat": bool(data.get("vat")),
        }
        if data.get("periodicity") in ("monthly", "quarterly", "yearly"):
            values["periodicity"] = data["periodicity"]
        lease = request.env["eguitra.lease"].create(values)
        if data.get("activate"):
            lease.action_activate()
        return _lease_row(lease)

    @api_route("/immobilier/leases/<int:lease_id>/activate", methods=("POST",), profiles=WRITE)
    def activate(self, lease_id, **_kw):
        lease = _get("eguitra.lease", lease_id, "Bail")
        lease.action_activate()
        return _lease_row(lease)

    @api_route("/immobilier/leases/<int:lease_id>/terminate", methods=("POST",), profiles=WRITE)
    def terminate(self, lease_id, **_kw):
        lease = _get("eguitra.lease", lease_id, "Bail")
        lease.action_terminate(parse_date(read_json(), "date"))
        return _lease_row(lease)

    @api_route("/immobilier/rents/generate", methods=("POST",), profiles=("admin", "finance", "immobilier"))
    def generate(self, **kw):
        invoices = request.env["eguitra.lease"].generate_rents(companies(kw), parse_date(read_json(), "until", today()))
        return {"invoices": [move_summary(m) for m in invoices]}

    @api_route("/immobilier/rents", profiles=READ)
    def rents(self, **kw):
        leases = request.env["eguitra.lease"].search([("contract_id", "!=", False)])
        moves = request.env["account.move.line"].sudo().search(
            [("contract_line_id.contract_id", "in", leases.contract_id.ids)]
        ).move_id.filtered(lambda m: m.state != "cancel").sorted(lambda m: m.invoice_date or m.date, reverse=True)
        return [move_summary(m) for m in moves[:500]]

    @api_route("/immobilier/unpaid", profiles=READ)
    def unpaid(self, **kw):
        moves = request.env["eguitra.lease"].unpaid_rents(companies(kw), today())
        return [dict(move_summary(m), late_days=(today() - m.invoice_date_due).days) for m in moves]

    @api_route("/immobilier/receipts/<int:move_id>", profiles=READ)
    def receipt(self, move_id, **_kw):
        """Données de la quittance de loyer, imprimée par l'application ; seulement pour un loyer réglé."""
        move = _get("account.move", move_id, "Facture")
        if move.payment_state not in ("paid", "in_payment"):
            raise ApiError(422, "business_rule", "La quittance n'est délivrée que pour un loyer entièrement réglé.")
        lines = move.invoice_line_ids
        lease = request.env["eguitra.lease"].search([("contract_id", "in", lines.contract_line_id.contract_id.ids)], limit=1)
        return {
            "number": move.name, "date": move.invoice_date, "company": move.company_id.name,
            "company_address": ", ".join(filter(None, [move.company_id.street, move.company_id.city])) or None,
            "tenant": move.partner_id.name, "property": lease.property_id.name if lease else None,
            "property_address": lease.property_id.address if lease else None,
            "lines": [{"name": l.name, "amount": l.price_total} for l in lines],
            "amount_total": move.amount_total, "payments": move.invoice_payments_widget or None,
        }
