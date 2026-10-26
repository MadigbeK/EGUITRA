"""API Immobilier : biens, baux, loyers, quittances, relances, patrimoine.

Les factures de loyer sont lues avec les droits du noyau (les profils immobilier et direction n'ont pas
accès aux écritures, comme le parc dans le transport), toujours à partir d'un bail que le compte voit.
"""

import math

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require
from odoo.addons.eguitra_finance.controllers.common import as_float, companies, move_summary, parse_date, today

from ..models.property import KINDS

READ = ("admin", "direction", "finance", "immobilier")
WRITE = ("admin", "finance", "immobilier")
PERIODICITIES = ("monthly", "quarterly", "yearly")


def _get(model, record_id, label):
    record = request.env[model].browse(record_id).exists()
    if not record:
        raise ApiError(404, "not_found", f"{label} introuvable.")
    return record


def _amount(data, key):
    """Montant saisi : un nombre fini (« NaN » ou l'infini refusés), 0 si vide."""
    value = as_float(data.get(key) or 0, key)
    if not math.isfinite(value):
        raise ApiError(400, "invalid_parameter", f"Nombre invalide : {key}.")
    return value


def _lease_row(l):
    invoiced_until = l._invoiced_until() if l.contract_id else None
    return {
        "id": l.id, "name": l.name, "property": {"id": l.property_id.id, "name": l.property_id.name},
        "tenant": {"id": l.partner_id.id, "name": l.partner_id.name}, "date_start": l.date_start, "date_end": l.date_end,
        "rent_start": l.rent_start, "rent": l.rent, "charges": l.charges, "periodicity": l.periodicity, "vat": l.vat,
        "deposit_amount": l.deposit_amount, "state": l.state, "next_invoice_date": l.next_invoice_date,
        # Fin de la dernière période facturée : au-delà de la fin du bail, la part en trop s'annule par un avoir.
        "invoiced_until": invoiced_until,
        "rent_error": l.rent_error or None, "rent_error_at": l.rent_error_at,
    }


def _property_row(p):
    active = p.lease_ids.filtered(lambda l: l.state == "active")[:1]
    return {
        "id": p.id, "name": p.name, "kind": p.kind, "address": p.address or None, "city": p.city or None,
        "area_m2": p.area_m2, "acquisition_date": p.acquisition_date, "acquisition_value": p.acquisition_value,
        "current_value": p.current_value, "valuation_date": p.valuation_date, "occupied": p.occupied,
        "lease": _lease_row(active) if active else None, "active": p.active,
        "pending_leases": len(p.lease_ids.filtered(lambda l: l.state == "draft")),
    }


def _paid_on(move):
    """Date du règlement qui solde le loyer (dernier lettrage de la créance), à défaut sa date."""
    receivable = move.line_ids.filtered(lambda line: line.account_id.account_type == "asset_receivable")
    dates = [p.credit_move_id.date for p in receivable.matched_credit_ids if p.credit_move_id.date]
    return max(dates) if dates else move.invoice_date


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
        if "name" in values and not values["name"]:
            raise ApiError(400, "missing_fields", "La désignation du bien est obligatoire.", fields=["name"])
        if data.get("kind") in dict(KINDS):
            values["kind"] = data["kind"]
        for key in ("area_m2", "acquisition_value", "current_value"):
            if key in data:
                values[key] = _amount(data, key)
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
        """Baux, résiliés compris (historique d'un bien avec property_id), les plus récents d'abord."""
        domain = [("state", "in", kw["state"].split(","))] if kw.get("state") else []
        if kw.get("property_id"):
            domain.append(("property_id", "=", int_arg(kw, "property_id")))
        return [_lease_row(l) for l in request.env["eguitra.lease"].search(domain)]

    def _lease_values(self, data):
        """Champs d'un bail reçus de l'écran (création, ou correction d'un bail en attente)."""
        values = {}
        if "name" in data:
            name = str(data.get("name") or "").strip()
            if not name:
                raise ApiError(400, "missing_fields", "La référence du bail est obligatoire.", fields=["name"])
            values["name"] = name
        if "partner_id" in data:
            if not data["partner_id"]:
                raise ApiError(400, "missing_fields", "Le locataire est obligatoire.", fields=["partner_id"])
            values["partner_id"] = int(data["partner_id"])
        if "date_start" in data:
            start = parse_date(data, "date_start")
            if not start:
                raise ApiError(400, "missing_fields", "La prise d'effet est obligatoire.", fields=["date_start"])
            values["date_start"] = start
        for key in ("date_end", "rent_start"):
            if key in data:
                values[key] = parse_date(data, key) or False
        for key in ("rent", "charges", "deposit_amount"):
            if key in data:
                values[key] = _amount(data, key)
        if "vat" in data:
            values["vat"] = bool(data["vat"])
        if "periodicity" in data:
            if data["periodicity"] not in PERIODICITIES:
                raise ApiError(400, "invalid_parameter", "Périodicité inconnue (mensuelle, trimestrielle, annuelle).")
            values["periodicity"] = data["periodicity"]
        return values

    @api_route("/immobilier/leases", methods=("POST",), profiles=WRITE)
    def create_lease(self, **_kw):
        """Bail signé : activé aussitôt (activate), ou enregistré en attente (brouillon), par exemple quand le
        bien est encore loué jusqu'à la fin du bail en cours ; il s'active ensuite."""
        data = read_json()
        _name, property_id, _partner, _start, _rent = require(data, "name", "property_id", "partner_id", "date_start", "rent")
        values = self._lease_values(data)
        values["property_id"] = _get("eguitra.property", int(property_id), "Bien").id
        lease = request.env["eguitra.lease"].create(values)
        if data.get("activate"):
            lease.action_activate()
        return _lease_row(lease)

    @api_route("/immobilier/leases/<int:lease_id>", methods=("PATCH",), profiles=WRITE)
    def update_lease(self, lease_id, **_kw):
        """Correction d'un bail en attente. Un bail en cours ou résilié ne se modifie plus : sa fin passe par
        « Fin de bail »."""
        lease = _get("eguitra.lease", lease_id, "Bail")
        if lease.state != "draft":
            raise ApiError(422, "business_rule", "Seul un bail en attente se corrige ; un bail en cours prend fin par "
                                                 "« Fin de bail ».")
        lease.write(self._lease_values(read_json()))
        return _lease_row(lease)

    @api_route("/immobilier/leases/<int:lease_id>/activate", methods=("POST",), profiles=WRITE)
    def activate(self, lease_id, **_kw):
        lease = _get("eguitra.lease", lease_id, "Bail")
        if lease.state != "draft":
            raise ApiError(422, "business_rule", "Ce bail n'est pas en attente.")
        lease.action_activate()
        return _lease_row(lease)

    @api_route("/immobilier/leases/<int:lease_id>/terminate", methods=("POST",), profiles=WRITE)
    def terminate(self, lease_id, **_kw):
        """Fin du bail : passée ou du jour, loyers dus émis puis bail résilié ; future, bail quittancé jusqu'à
        sa fin puis résilié par la tâche de nuit."""
        lease = _get("eguitra.lease", lease_id, "Bail")
        lease.action_terminate(parse_date(read_json(), "date"))
        return _lease_row(lease)

    @api_route("/immobilier/rents/generate", methods=("POST",), profiles=WRITE)
    def generate(self, **kw):
        """Loyers échus jusqu'à aujourd'hui au plus, bail par bail ; les échecs sont rendus un par bail."""
        errors = []
        invoices = request.env["eguitra.lease"].generate_rents(
            companies(kw), parse_date(read_json(), "until", today()), errors=errors)
        return {"invoices": [move_summary(m) for m in invoices], "errors": errors}

    @api_route("/immobilier/rents", profiles=READ)
    def rents(self, **kw):
        leases = request.env["eguitra.lease"].search([("contract_id", "!=", False)])
        moves = request.env["account.move.line"].sudo().search(
            [("contract_line_id.contract_id", "in", leases.contract_id.ids)]
        ).move_id.filtered(lambda m: m.state != "cancel").sorted(lambda m: m.invoice_date or m.date, reverse=True)
        return [move_summary(m) for m in moves[:500]]

    @api_route("/immobilier/unpaid", profiles=READ)
    def unpaid(self, **kw):
        Lease = request.env["eguitra.lease"]
        moves = Lease.unpaid_rents(companies(kw), today())
        return [dict(move_summary(m), late_days=(today() - m.invoice_date_due).days, net_residual=Lease._net_residual(m))
                for m in moves]

    @api_route("/immobilier/receipts/<int:move_id>", profiles=READ)
    def receipt(self, move_id, **_kw):
        """Quittance d'un loyer entièrement réglé, datée de son règlement. La facture est lue avec les droits du
        noyau, une fois vérifié qu'elle est un loyer d'un bail que le compte voit (société de travail)."""
        move = request.env["account.move"].sudo().browse(move_id).exists()
        contracts = move.invoice_line_ids.contract_line_id.contract_id if move else None
        lease = request.env["eguitra.lease"].search([("contract_id", "in", contracts.ids)], limit=1) if contracts else None
        if not move or not lease or move.move_type != "out_invoice":
            raise ApiError(404, "not_found", "Quittance introuvable : ce n'est pas un loyer d'un bail de la société.")
        if move.payment_state not in ("paid", "in_payment"):
            raise ApiError(422, "business_rule", "La quittance n'est délivrée que pour un loyer entièrement réglé.")
        lines = move.invoice_line_ids
        return {
            "number": move.name, "date": _paid_on(move), "invoice_date": move.invoice_date,
            "company": move.company_id.name,
            "company_address": ", ".join(filter(None, [move.company_id.street, move.company_id.city])) or None,
            "tenant": move.partner_id.name, "property": lease.property_id.name,
            "property_address": lease.property_id.address or None,
            "lines": [{"name": l.name, "amount": l.price_total} for l in lines],
            "amount_total": move.amount_total, "currency": move.currency_id.name,
            "payments": move.invoice_payments_widget or None,
        }
