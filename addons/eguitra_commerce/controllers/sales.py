"""Offres commerciales et commandes des clients : saisie, envoi, acceptation, refus, versions, impression,
facturation (totale, par acomptes, par quantités exécutées), offre de travaux vers le chantier."""

from odoo import Command, fields, http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require
from odoo.addons.eguitra_finance.controllers.common import as_float, as_int, check_mandatory_analytic, parse_date, today

from ..models.documents import document_filename, send_document
from ..models.sale_order import QUIET, STATUS
from .common import (
    SALES_INVOICE,
    SALES_READ,
    SALES_WRITE,
    check_company,
    company,
    line_row,
    order_line_of,
    partner_of,
    ref,
    sale_line_commands,
    text,
    user_ref,
)

STATUS_LABELS = dict(STATUS)
VIEWS = {
    "open": [("eguitra_status", "in", ("draft", "sent"))],
    "orders": [("eguitra_status", "=", "accepted")],
    "closed": [("eguitra_status", "in", ("refused", "expired", "cancelled", "replaced"))],
}
OFFER_REPORT = "eguitra_commerce.action_report_offer"


def _order(order_id):
    order = request.env["sale.order"].sudo().browse(order_id).exists()
    return check_company(order, "Offre")


def _invoice_ref(move):
    move = move.sudo()
    kind = "advance" if move.invoice_line_ids.filtered(lambda l: l.is_downpayment and l.quantity > 0) else "invoice"
    return {"id": move.id, "name": move.name if move.name and move.name != "/" else None, "state": move.state,
            "move_type": move.move_type, "date": move.invoice_date or move.date, "kind": kind,
            "amount_untaxed": move.amount_untaxed, "amount_total": move.amount_total,
            "payment_state": move.payment_state}


def offer_row(order, detail=False):
    today_ = today()
    status = order.eguitra_status
    open_ = order.state in ("draft", "sent")
    btp = order._eguitra_is_btp()
    data = {
        "id": order.id, "name": order.name, "version": order.eguitra_version,
        "root": ref(order.eguitra_root_id), "status": status, "status_label": STATUS_LABELS.get(status, status),
        "partner": ref(order.partner_id), "date": order.eguitra_offer_date, "validity_date": order.validity_date,
        "validity_days": order._eguitra_validity_days(),
        "expires_in": (order.validity_date - today_).days if open_ and order.validity_date else None,
        "object": order.eguitra_object or None, "currency": order.currency_id.name,
        "amount_untaxed": order.amount_untaxed, "amount_tax": order.amount_tax, "amount_total": order.amount_total,
        "sent_at": order.eguitra_sent_at, "sent_by": user_ref(order.eguitra_sent_by),
        "emailed_to": order.eguitra_emailed_to or None, "reminded_at": order.eguitra_reminded_at,
        "accepted_at": order.eguitra_accepted_at, "accepted_by": user_ref(order.eguitra_accepted_by),
        "closed_at": order.eguitra_closed_at, "closed_by": user_ref(order.eguitra_closed_by),
        "refusal_reason": order.eguitra_refusal_reason or None,
        "chantier_mode": order.eguitra_chantier_mode, "chantier": ref(order.eguitra_chantier_id),
        "advance_rate": order.eguitra_advance_rate, "retention_rate": order.eguitra_retention_rate,
        "invoice_mode": order.eguitra_invoice_mode, "company": ref(order.company_id),
        "created_by": user_ref(order.create_uid),
        "invoicing": order._eguitra_amounts() if order.state == "sale" else None,
        "can": {
            "edit": order.state == "draft", "send": open_, "accept": open_, "refuse": open_,
            "cancel": open_ or order.state == "sale", "version": order.state != "sale",
            "remind": order.state == "sent", "invoice": order.state == "sale" and not btp,
            "advance": order.state == "sale" and bool(order.eguitra_chantier_id) and bool(order.eguitra_advance_rate)
            and not order.eguitra_chantier_id.eguitra_advance_invoice_id,
        },
    }
    if detail:
        data.update({
            "conditions": order.eguitra_conditions or None,
            "payment_term": ref(order.payment_term_id),
            "lines": [line_row(line, "sale") for line in order.order_line.sorted(lambda l: (l.sequence, l.id))],
            "versions": [{"id": v.id, "name": v.name, "version": v.eguitra_version, "status": v.eguitra_status,
                          "status_label": STATUS_LABELS.get(v.eguitra_status)} for v in order._eguitra_versions()],
            "invoices": [_invoice_ref(m) for m in order.invoice_ids.sorted("id")],
        })
        chantier = order.eguitra_chantier_id
        if chantier:
            advance = chantier.eguitra_advance_invoice_id
            data["chantier_detail"] = {
                "id": chantier.id, "name": chantier.name, "contract_amount": chantier.contract_amount,
                "invoiced_amount": chantier.invoiced_amount, "progress_pct": chantier.progress_pct,
                "retention_rate": chantier.retention_rate, "advance_rate": chantier.eguitra_advance_rate,
                "advance_amount": chantier.eguitra_advance_amount,
                "advance_invoice": _invoice_ref(advance) if advance else None,
                "advance_deducted": chantier.eguitra_advance_deducted,
                "advance_remaining": chantier.eguitra_advance_remaining,
            }
            if advance:
                data["invoices"].append(_invoice_ref(advance))
            data["invoices"] += [_invoice_ref(s.invoice_id) for s in chantier.situation_ids.sorted("number")
                                 if s.invoice_id]
    return data


def _header_values(data, creating):
    """Champs de l'en-tête d'une offre ; contrôle des dates, de la validité et de l'offre de travaux."""
    comp = company()
    values = {}
    if creating or "partner_id" in data:
        (partner_id,) = require(data, "partner_id")
        values["partner_id"] = partner_of(partner_id, "Client").id
    for key, field, size in (("object", "eguitra_object", 250), ("conditions", "eguitra_conditions", 4000)):
        if key in data:
            values[field] = text(data[key], size)
    if creating or "date" in data:
        values["eguitra_offer_date"] = parse_date(data, "date", today())
    if "validity_days" in data and data["validity_days"] not in (None, ""):
        days = as_int(data["validity_days"], "validity_days")
        if not 0 < days <= 365:
            raise ApiError(422, "business_rule", "La validité de l'offre est comprise entre 1 et 365 jours.")
        start = values.get("eguitra_offer_date") or today()
        values["validity_date"] = fields.Date.add(start, days=days)
    elif data.get("validity_date"):
        values["validity_date"] = parse_date(data, "validity_date")
    elif creating:
        values["validity_date"] = fields.Date.add(values["eguitra_offer_date"], days=comp.quotation_validity_days or 15)
    if values.get("validity_date") and values["validity_date"] < (values.get("eguitra_offer_date") or today()):
        raise ApiError(422, "business_rule", "La fin de validité précède la date de l'offre.")
    if "payment_term_id" in data:
        term = request.env["account.payment.term"].sudo().browse(as_int(data["payment_term_id"], "payment_term_id")).exists() \
            if data["payment_term_id"] else request.env["account.payment.term"]
        if term and term.company_id and term.company_id != comp:
            raise ApiError(422, "business_rule", "Condition de règlement d'une autre société.")
        values["payment_term_id"] = term.id or False
    if "chantier_mode" in data:
        values["eguitra_chantier_mode"] = bool(data["chantier_mode"])
    if values.get("eguitra_chantier_mode") and comp.eguitra_entity != "groupe":
        raise ApiError(422, "business_rule", "Les offres de travaux (chantiers) ne concernent qu'EGUITRA GROUP SARLU.")
    for key, field in (("advance_rate", "eguitra_advance_rate"), ("retention_rate", "eguitra_retention_rate")):
        if key in data:
            rate = as_float(data[key] or 0, key)
            if not 0 <= rate <= 100:
                raise ApiError(422, "business_rule", "Un taux est un pourcentage, de 0 à 100.")
            values[field] = rate
    if "chantier_id" in data:
        chantier = request.env["eguitra.chantier"].sudo().browse(as_int(data["chantier_id"], "chantier_id")).exists() \
            if data["chantier_id"] else request.env["eguitra.chantier"]
        if chantier and chantier.company_id != comp:
            raise ApiError(422, "business_rule", "Chantier d'une autre société.")
        values["eguitra_chantier_id"] = chantier.id or False
        if chantier:
            values["eguitra_chantier_mode"] = True
    return values


class EguitraCommerceSales(http.Controller):
    @api_route("/commerce/offers", profiles=SALES_READ)
    def offers(self, **kw):
        """Offres et commandes de la société de travail. view : open, orders, closed ; status : liste d'états."""
        domain = [("company_id", "=", company().id)]
        domain += VIEWS.get(kw.get("view"), [])
        if kw.get("status"):
            domain.append(("eguitra_status", "in", kw["status"].split(",")))
        if kw.get("partner_id"):
            domain.append(("partner_id", "=", int_arg(kw, "partner_id")))
        if kw.get("search"):
            s = kw["search"]
            domain += ["|", "|", ("name", "ilike", s), ("eguitra_object", "ilike", s), ("partner_id.name", "ilike", s)]
        Order = request.env["sale.order"].sudo()
        limit, offset = int_arg(kw, "limit", 100, 1, 500), int_arg(kw, "offset", 0, 0)
        orders = Order.search(domain, limit=limit, offset=offset, order="id desc")
        return {"items": [offer_row(o) for o in orders], "total": Order.search_count(domain), "limit": limit,
                "offset": offset, "validity_days": company().quotation_validity_days}

    @api_route("/commerce/offers/<int:order_id>", profiles=SALES_READ)
    def offer(self, order_id, **_kw):
        return offer_row(_order(order_id), detail=True)

    @api_route("/commerce/offers", methods=("POST",), profiles=SALES_WRITE)
    def create_offer(self, **_kw):
        data = read_json()
        comp = company()
        values = _header_values(data, creating=True)
        values.update({"company_id": comp.id, "order_line": sale_line_commands(data, comp),
                       "user_id": request.env.user.id})
        order = request.env["sale.order"].sudo().with_company(comp)._eguitra_quiet().create(values)
        return offer_row(order, detail=True)

    @api_route("/commerce/offers/<int:order_id>", methods=("PATCH",), profiles=SALES_WRITE)
    def update_offer(self, order_id, **_kw):
        """Modification d'une offre en brouillon ; une offre envoyée se modifie par une nouvelle version."""
        order = _order(order_id)
        if order.state != "draft":
            raise ApiError(422, "business_rule", "Seule une offre en brouillon se modifie : créez une nouvelle version "
                                                 "d'une offre envoyée.")
        data = read_json()
        values = _header_values(data, creating=False)
        if "lines" in data:
            values["order_line"] = [Command.clear()] + sale_line_commands(data, order.company_id)
        order._eguitra_quiet().write(values)
        return offer_row(order, detail=True)

    @api_route("/commerce/offers/<int:order_id>/<string:action>", methods=("POST",), profiles=SALES_WRITE)
    def act(self, order_id, action, **_kw):
        order = _order(order_id)
        data = read_json()
        if action == "send":
            email_to = None
            if data.get("email"):
                email_to = text(data.get("email_to") or order.partner_id.email, 240)
                send_document(order, OFFER_REPORT, document_filename(order, "Offre"), email_to,
                              f"{order.company_id.name} : offre {order.name}", f"Offre {order.name}", [
                                  "Madame, Monsieur,",
                                  f"Veuillez trouver ci-joint notre offre {order.name}"
                                  + (f" ({order.eguitra_object})" if order.eguitra_object else "") + ".",
                                  f"Elle est valable jusqu'au {order.validity_date:%d/%m/%Y}." if order.validity_date else "",
                                  "Nous restons à votre disposition pour toute précision.",
                              ])
            order.action_eguitra_mark_sent(emailed_to=email_to)
        elif action == "remind":
            if order.state != "sent":
                raise ApiError(422, "business_rule", "Seule une offre envoyée se relance.")
            email_to = text(data.get("email_to") or order.partner_id.email, 240)
            send_document(order, OFFER_REPORT, document_filename(order, "Offre"), email_to,
                          f"{order.company_id.name} : relance de l'offre {order.name}", f"Offre {order.name}", [
                              "Madame, Monsieur,",
                              f"Nous revenons vers vous au sujet de notre offre {order.name}"
                              + (f" ({order.eguitra_object})" if order.eguitra_object else "") + ", jointe à nouveau.",
                              f"Elle reste valable jusqu'au {order.validity_date:%d/%m/%Y}." if order.validity_date else "",
                              "Nous restons à votre disposition pour en convenir.",
                          ])
            order._eguitra_quiet().write({"eguitra_reminded_at": fields.Datetime.now()})
        elif action == "accept":
            order.action_eguitra_accept()
        elif action == "refuse":
            order.action_eguitra_refuse(data.get("reason"))
        elif action == "cancel":
            order.action_eguitra_cancel()
        elif action == "version":
            return offer_row(order.action_eguitra_new_version(), detail=True)
        else:
            raise ApiError(404, "not_found", "Action inconnue.")
        return offer_row(order, detail=True)

    @api_route("/commerce/offers/<int:order_id>/pdf", profiles=SALES_READ)
    def offer_pdf(self, order_id, **_kw):
        order = _order(order_id)
        pdf, _kind = request.env["ir.actions.report"].sudo()._render_qweb_pdf(OFFER_REPORT, order.ids)
        return request.make_response(pdf, headers=[
            ("Content-Type", "application/pdf"),
            ("Content-Disposition", content_disposition(document_filename(order, "Offre"))),
        ])

    # ─── Commandes ────────────────────────────────────────────────────────

    @api_route("/commerce/orders/<int:order_id>/delivered", methods=("PATCH",), profiles=SALES_WRITE)
    def delivered(self, order_id, **_kw):
        """Quantités exécutées des lignes de la commande (prestations) : {"lines": [{"id", "qty_delivered"}]}."""
        order = _order(order_id)
        if order.state != "sale" or order._eguitra_is_btp():
            raise ApiError(422, "business_rule", "Les quantités exécutées se saisissent sur une commande hors chantier.")
        rows = read_json().get("lines")
        if not isinstance(rows, list) or not rows:
            raise ApiError(400, "missing_fields", "Indiquez les quantités exécutées.", fields=["lines"])
        for row in rows:
            line = order_line_of(order, row.get("id"))
            if not line or line.display_type or line.is_downpayment:
                raise ApiError(422, "business_rule", "Ligne étrangère à la commande.")
            qty = as_float(row.get("qty_delivered"), "qty_delivered")
            if qty < line.qty_invoiced - 1e-6:
                raise ApiError(422, "business_rule", f"« {line.name} » : la quantité exécutée ne descend pas sous la "
                                                     "quantité déjà facturée.")
            if qty > line.product_uom_qty + 1e-6:
                raise ApiError(422, "business_rule", f"« {line.name} » : la quantité exécutée dépasse la quantité "
                                                     "commandée (avenant : nouvelle offre).")
            line.with_context(**QUIET).qty_delivered = qty
        return offer_row(order, detail=True)

    @api_route("/commerce/orders/<int:order_id>/invoice", methods=("POST",), profiles=SALES_INVOICE)
    def invoice(self, order_id, **_kw):
        """Facture de la commande, en brouillon (sauf post=true) : method total, delivered, percentage ou fixed,
        value (pourcentage ou montant TTC de l'acompte), label (« Avance de démarrage 50 % »), deduct."""
        order = _order(order_id)
        data = read_json()
        (method,) = require(data, "method")
        deduct = data.get("deduct")
        moves = order.eguitra_create_invoice(method, value=data.get("value"), label=data.get("label"),
                                             deduct=None if deduct is None else bool(deduct))
        if data.get("post"):
            # Validation sous l'identité de la finance, avec le contrôle de l'imputation obligatoire des ventes.
            moves = moves.sudo(False)
            check_mandatory_analytic(moves.line_ids)
            moves._eguitra_post_or_submit()
        return dict(offer_row(order, detail=True), created=[_invoice_ref(m) for m in moves])

    @api_route("/commerce/orders/<int:order_id>/advance", methods=("POST",), profiles=SALES_INVOICE)
    def advance(self, order_id, **_kw):
        """Avance de démarrage d'une offre de travaux, facturée sur le chantier (une fois)."""
        order = _order(order_id)
        if order.state != "sale" or not order.eguitra_chantier_id:
            raise ApiError(422, "business_rule", "L'avance de démarrage se facture sur une offre de travaux acceptée.")
        data = read_json()
        invoices = order.eguitra_chantier_id.action_eguitra_invoice_advance(post=data.get("post", True) is not False)
        return dict(offer_row(order, detail=True), created=[_invoice_ref(m) for m in invoices])

    @api_route("/commerce/sales/payment-terms", profiles=SALES_READ)
    def payment_terms(self, **_kw):
        terms = request.env["account.payment.term"].sudo().search(
            [("company_id", "in", [False, company().id])], order="sequence, id")
        return [{"id": t.id, "name": t.name} for t in terms]
