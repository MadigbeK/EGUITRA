"""API Transport : ensembles gérés pour des propriétaires (règles de répartition, relevés), prix du
carburant des coûts standard."""

from odoo import http
from odoo.exceptions import UserError, ValidationError
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require
from odoo.addons.eguitra_finance.controllers.common import as_float, parse_date, today
from odoo.addons.eguitra_finance.controllers.exporting import export_meta, table_response

from ..models.ownership import OWNERSHIPS
from ..models.settings import OWNER_COST_BASES
from ..nombres import fixe, fmt_money, fmt_rate, fmt_volume
from .transport import ACCOUNTING, READ, SETTINGS, _get, _move_ref, _partner, _ref

STATES = {"draft": "Établi", "posted": "Pièces préparées"}
KINDS = {"charge": "Charge de l'ensemble", "commission": "Commission", "owner": "Part du propriétaire"}


def _money(value, currency="GNF"):
    return fmt_money(value, currency)


def _day(value):
    return value.strftime("%d/%m/%Y") if value else "–"


def _rule_row(rule):
    return {"id": rule.id, "vehicle": _ref(rule.vehicle_id), "ownership": rule.ownership or None,
            "partner": _ref(rule.partner_id), "rate": rule.rate, "date_from": rule.date_from or None,
            "date_to": rule.date_to or None, "note": rule.note or None, "active": rule.active,
            "is_company": rule.partner_id == rule.company_id.partner_id}


def _rule_values(data):
    values = {}
    if "vehicle_id" in data:
        vehicle = request.env["eguitra.transport.vehicle"]
        if data["vehicle_id"]:
            vehicle = _get("eguitra.transport.vehicle", int(data["vehicle_id"]), "Ensemble routier")
        values["vehicle_id"] = vehicle.id or False
    if "ownership" in data:
        if data["ownership"] and data["ownership"] not in dict(OWNERSHIPS):
            raise ApiError(400, "invalid_parameter", "Catégorie d'ensembles inconnue.")
        values["ownership"] = data["ownership"] or False
    if "partner_id" in data:
        values["partner_id"] = _partner(data["partner_id"], "Bénéficiaire").id
    if "rate" in data:
        values["rate"] = as_float(data["rate"] or 0, "rate")
    for key in ("date_from", "date_to"):
        if key in data:
            values[key] = parse_date(data, key) or False
    if "note" in data:
        values["note"] = data["note"] or False
    if "active" in data:
        values["active"] = bool(data["active"])
    return values


def _statement_row(st, detail=False):
    row = {
        "id": st.id, "name": st.name, "vehicle": _ref(st.vehicle_id), "ownership": st.ownership,
        "owner": _ref(st.owner_id), "date_from": st.date_from, "date_to": st.date_to, "state": st.state,
        "basis": st.basis, "basis_label": dict(OWNER_COST_BASES).get(st.basis), "computed_at": st.computed_at,
        "rotation_count": st.rotation_count,
        "volume": st.volume, "revenue": st.revenue, "taxes_rebilled": st.taxes_rebilled,
        "rotation_costs": st.rotation_costs, "shortage_cost": st.shortage_cost, "vehicle_charges": st.vehicle_charges,
        "declared_costs": st.declared_costs, "booked_costs": st.booked_costs, "costs": st.costs, "margin": st.margin,
        "commissions": st.commissions, "owner_amount": st.owner_amount, "operator_amount": st.operator_amount,
        "moves": [_move_ref(m) for m in st.sudo().move_ids],
    }
    if detail:
        row["lines"] = [{"id": line.id, "kind": line.kind, "name": line.name, "partner": _ref(line.partner_id),
                         "rate": line.rate or None, "base": line.base or None, "monthly": line.monthly or None,
                         "months": line.months or None, "amount": line.amount, "move": _move_ref(line.sudo().move_id)}
                        for line in st.line_ids]
        row["rotations"] = [{"id": r.id, "name": r.name, "date_loading": r.date_loading, "route": _ref(r.route_id),
                             "client": _ref(r.partner_id), "volume": r.volume_delivered or r.volume_loaded,
                             "revenue": r.revenue, "total_cost": r.total_cost, "state": r.state}
                            for r in st.rotation_ids.sorted("date_loading")]
    return row


def statement_context(st):
    """Valeurs du relevé PDF, mises en forme pour l'impression."""
    money = st.currency_id.name
    m = lambda v: _money(v, money)  # noqa: E731
    managed = st.ownership == "managed"
    owner = st.owner_id.display_name
    account = [("Chiffre d'affaires du transport", m(st.revenue), False)]
    if st.taxes_rebilled:
        account.append(("Taxes refacturées aux clients", m(st.taxes_rebilled), False))
    if st.basis == "booked":
        account.append(("Charges comptabilisées sur l'ensemble", m(-st.booked_costs), False))
    else:
        account += [("Frais des rotations", m(-st.rotation_costs), False),
                    ("Manquants à charge", m(-st.shortage_cost), False),
                    ("Charges mensuelles de l'ensemble", m(-st.vehicle_charges), False)]
    account.append(("Marge de l'ensemble", m(st.margin), True))
    shares = [(line.partner_id.display_name, f"{fmt_rate(line.rate)} du chiffre d'affaires brut", m(line.amount))
              for line in st.line_ids if line.kind == "commission"]
    shares.append((owner, "Résiduel de la marge", m(st.owner_amount)))
    if managed:
        label = f"Part de {owner}"
        note = ("Montant dû au propriétaire." if st.owner_amount >= 0 else
                "Charges non couvertes par l'activité de la période, à la charge du propriétaire.")
    else:
        label = "Résultat de la société sur l'ensemble"
        note = "Ensemble propre : le résiduel revient à la société."
    return {
        "vehicle": st.vehicle_id.display_name, "period": f"du {_day(st.date_from)} au {_day(st.date_to)}",
        "computed_at": _day(st.computed_at),
        "header": [("Ensemble", st.vehicle_id.display_name),
                   ("Immatriculations", " / ".join(p for p in (st.vehicle_id.tractor_plate, st.vehicle_id.trailer_plate) if p) or "–"),
                   ("Propriétaire", owner), ("Exploitant", st.company_id.name),
                   ("Rotations", str(st.rotation_count)), ("Volume livré", fmt_volume(st.volume))],
        "account": account,
        "basis_note": (f"Base des charges : {dict(OWNER_COST_BASES).get(st.basis, '–').lower()}. "
                       f"Charges déclarées {m(st.declared_costs)}, "
                       f"charges comptabilisées {m(st.booked_costs)}."),
        "charges": [(line.name, m(line.monthly), fixe(line.months, 2), m(line.amount))
                    for line in st.line_ids if line.kind == "charge"],
        "shares": shares, "result_label": label, "result": m(st.owner_amount), "result_negative": st.owner_amount < 0,
        "result_note": note,
        "rotations": [(r.name, _day(r.date_loading), r.route_id.display_name, r.partner_id.display_name,
                       fmt_volume(r.volume_delivered or r.volume_loaded, unit=False),
                       m(r.revenue), m(r.total_cost)) for r in st.rotation_ids.sorted("date_loading")],
    }


def _period(data):
    start, end = parse_date(data, "date_from"), parse_date(data, "date_to")
    if not start or not end or start > end:
        raise ApiError(400, "invalid_parameter", "Période attendue : date_from et date_to.")
    return start, end


class EguitraTransportOwners(http.Controller):
    # ─── Règles de répartition ────────────────────────────────────────────

    @api_route("/transport/share-rules", profiles=ACCOUNTING)
    def share_rules(self, **_kw):
        Rule = request.env["eguitra.transport.share.rule"].with_context(active_test=False)
        return [_rule_row(r) for r in Rule.search([])]

    @api_route("/transport/share-rules", methods=("POST",), profiles=SETTINGS)
    def create_share_rule(self, **_kw):
        data = read_json()
        require(data, "partner_id", "rate")
        try:
            rule = request.env["eguitra.transport.share.rule"].create(_rule_values(data))
        except ValidationError as e:
            raise ApiError(422, "business_rule", e.args[0]) from e
        return _rule_row(rule)

    @api_route("/transport/share-rules/<int:rule_id>", methods=("PATCH",), profiles=SETTINGS)
    def update_share_rule(self, rule_id, **_kw):
        rule = request.env["eguitra.transport.share.rule"].with_context(active_test=False).browse(rule_id).exists()
        if not rule:
            raise ApiError(404, "not_found", "Règle introuvable.")
        try:
            rule.write(_rule_values(read_json()))
        except ValidationError as e:
            raise ApiError(422, "business_rule", e.args[0]) from e
        return _rule_row(rule)

    @api_route("/transport/share-rules/<int:rule_id>", methods=("DELETE",), profiles=SETTINGS)
    def delete_share_rule(self, rule_id, **_kw):
        rule = request.env["eguitra.transport.share.rule"].with_context(active_test=False).browse(rule_id).exists()
        if not rule:
            raise ApiError(404, "not_found", "Règle introuvable.")
        rule.unlink()
        return {"status": "ok"}

    # ─── Prix du carburant ────────────────────────────────────────────────

    @api_route("/transport/fuel-prices", profiles=READ)
    def fuel_prices(self, **_kw):
        Price = request.env["eguitra.transport.fuel.price"]
        return {"current": Price._price_at(request.env.company, today()),
                "items": [{"id": p.id, "date_from": p.date_from, "price": p.price, "note": p.note or None}
                          for p in Price.search([])]}

    @api_route("/transport/fuel-prices", methods=("POST",), profiles=SETTINGS)
    def create_fuel_price(self, **_kw):
        data = read_json()
        require(data, "date_from", "price")
        price = as_float(data["price"], "price")
        if price <= 0:
            raise ApiError(400, "invalid_parameter", "Prix du litre attendu.")
        Price = request.env["eguitra.transport.fuel.price"]
        day = parse_date(data, "date_from")
        existing = Price.search([("date_from", "=", day)])
        if existing:
            existing.write({"price": price, "note": data.get("note") or existing.note})
        else:
            Price.create({"date_from": day, "price": price, "note": data.get("note") or False})
        return self.fuel_prices()

    @api_route("/transport/fuel-prices/<int:price_id>", methods=("DELETE",), profiles=SETTINGS)
    def delete_fuel_price(self, price_id, **_kw):
        _get("eguitra.transport.fuel.price", price_id, "Prix du carburant").unlink()
        return self.fuel_prices()

    # ─── Relevés des propriétaires ────────────────────────────────────────

    @api_route("/transport/owner-statements", profiles=ACCOUNTING)
    def owner_statements(self, **kw):
        end = parse_date(kw, "date_to", today())
        start = parse_date(kw, "date_from", end.replace(day=1))
        Statement = request.env["eguitra.transport.owner.statement"]
        statements = Statement.search([("date_from", ">=", start), ("date_to", "<=", end)])
        eligible = Statement._vehicles_with_statement(request.env.company)
        return {
            "items": [_statement_row(st) for st in statements],
            "vehicles": [{"id": v.id, "name": v.name, "ownership": v.ownership, "owner": _ref(v._owner())}
                         for v in eligible],
            "totals": {k: sum(st[k] for st in statements)
                       for k in ("revenue", "costs", "margin", "commissions", "owner_amount", "operator_amount")},
        }

    @api_route("/transport/owner-statements", methods=("POST",), profiles=SETTINGS)
    def establish_statements(self, **_kw):
        """Relevés de la période : de l'ensemble demandé, sinon de tous les ensembles qui en appellent un."""
        data = read_json()
        start, end = _period(data)
        Statement = request.env["eguitra.transport.owner.statement"]
        if data.get("vehicle_id"):
            vehicles = _get("eguitra.transport.vehicle", int(data["vehicle_id"]), "Ensemble routier")
        else:
            vehicles = Statement._vehicles_with_statement(request.env.company)
        if not vehicles:
            raise ApiError(422, "business_rule", "Aucun ensemble géré ni aucune règle de répartition : rien à établir.")
        try:
            statements = Statement._establish(vehicles, start, end)
        except UserError as e:
            raise ApiError(422, "business_rule", e.args[0]) from e
        return {"items": [_statement_row(st) for st in statements]}

    @api_route("/transport/owner-statements/<int:statement_id>", profiles=ACCOUNTING)
    def owner_statement(self, statement_id, **_kw):
        return _statement_row(_get("eguitra.transport.owner.statement", statement_id, "Relevé"), detail=True)

    @api_route("/transport/owner-statements/<int:statement_id>/<string:action>", methods=("POST",), profiles=SETTINGS)
    def statement_action(self, statement_id, action, **_kw):
        st = _get("eguitra.transport.owner.statement", statement_id, "Relevé")
        methods = {"refresh": st._compute_statement, "prepare": st.action_prepare_moves, "reset": st.action_reset}
        if action not in methods:
            raise ApiError(404, "not_found", "Action inconnue.")
        try:
            methods[action]()
        except UserError as e:
            raise ApiError(422, "business_rule", e.args[0]) from e
        return _statement_row(st, detail=True)

    @api_route("/transport/owner-statements/<int:statement_id>/releve.pdf", profiles=ACCOUNTING)
    def statement_pdf(self, statement_id, **_kw):
        st = _get("eguitra.transport.owner.statement", statement_id, "Relevé")
        pdf, _type = request.env["ir.actions.report"].sudo()._render_qweb_pdf(
            "eguitra_transport.action_report_owner_statement", st.ids, data={"statement": statement_context(st)})
        return request.make_response(pdf, headers=[
            ("Content-Type", "application/pdf"),
            ("Content-Disposition", content_disposition(f"releve_{st.vehicle_id.name}_{st.date_from:%Y%m%d}_{st.date_to:%Y%m%d}.pdf")),
        ])

    @api_route("/transport/owner-statements/<int:statement_id>/releve.xlsx", profiles=ACCOUNTING)
    def statement_xlsx(self, statement_id, **_kw):
        st = _get("eguitra.transport.owner.statement", statement_id, "Relevé")
        meta = export_meta(st.company_id, [("Ensemble", st.vehicle_id.display_name),
                                           ("Propriétaire", st.owner_id.display_name),
                                           ("Période", f"{_day(st.date_from)} au {_day(st.date_to)}"),
                                           ("Base des charges", dict(OWNER_COST_BASES).get(st.basis, "")),
                                           ("État", STATES.get(st.state, st.state))])
        summary = [["Chiffre d'affaires du transport", st.revenue], ["Taxes refacturées", st.taxes_rebilled],
                   ["Frais des rotations", -st.rotation_costs], ["Manquants à charge", -st.shortage_cost],
                   ["Charges mensuelles de l'ensemble", -st.vehicle_charges],
                   ["Charges déclarées", -st.declared_costs], ["Charges comptabilisées", -st.booked_costs],
                   ["Charges retenues", -st.costs], ["Marge de l'ensemble", st.margin], ["Commissions", -st.commissions],
                   ["Part du propriétaire", st.owner_amount], ["Part de la société", st.operator_amount]]
        sheets = [
            {"title": "Relevé", "meta": meta, "columns": [("Poste", "text"), ("Montant", "money")], "rows": summary},
            {"title": "Répartition", "meta": meta,
             "columns": [("Nature", "text"), ("Libellé", "text"), ("Taux (%)", "number"), ("Base", "money"),
                         ("Mensuel", "money"), ("Mois", "number"), ("Montant", "money"), ("Pièce", "text")],
             "rows": [[KINDS[line.kind], line.name, line.rate or None, line.base or None, line.monthly or None,
                       line.months or None, line.amount, line.sudo().move_id.name or ""] for line in st.line_ids]},
            {"title": "Rotations", "meta": meta,
             "columns": [("Rotation", "text"), ("Chargement", "date"), ("Route", "text"), ("Client", "text"),
                         ("Volume livré (m³)", "number"), ("Montant", "money"), ("Frais déclarés", "money"),
                         ("Marge", "money")],
             "rows": [[r.name, r.date_loading, r.route_id.display_name, r.partner_id.display_name,
                       r.volume_delivered or r.volume_loaded, r.revenue, r.total_cost, r.margin]
                      for r in st.rotation_ids.sorted("date_loading")]},
        ]
        return table_response(f"releve_{st.vehicle_id.name}_{st.date_from:%Y%m%d}_{st.date_to:%Y%m%d}", sheets)
