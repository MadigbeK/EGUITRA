"""Bons de commande fournisseur, réceptions (service fait), pièce d'achat rattachée et rapprochement à trois
voies, comparaison des devis fournisseurs des engagements."""

import base64

from odoo import Command, fields, http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require
from odoo.addons.eguitra_api.files import ACCEPTED, checked_name, detect_type
from odoo.addons.eguitra_finance.controllers.common import as_float, as_int, check_mandatory_analytic, parse_date, today

from ..models.documents import document_filename, send_document
from ..models.purchase_order import STATUS
from .common import (
    PURCHASE_ALL,
    PURCHASE_BILL,
    PURCHASE_FULL,
    QUOTES,
    check_company,
    company,
    line_row,
    order_line_of,
    partner_of,
    purchase_line_commands,
    purchase_restricted,
    ref,
    text,
    user_ref,
)

STATUS_LABELS = dict(STATUS)
VIEWS = {
    "draft": [("eguitra_status", "in", ("draft", "rejected"))],
    "approval": [("eguitra_status", "=", "to_approve")],
    "open": [("eguitra_status", "in", ("approved", "sent", "partial"))],
    "to_bill": [("state", "=", "purchase"), ("eguitra_status", "in", ("partial", "received"))],
    "done": [("eguitra_status", "in", ("invoiced", "cancelled"))],
}
PO_REPORT = "eguitra_commerce.action_report_purchase_order"
MAX_FILE = 15 * 1024 * 1024


def _own_domain():
    """Profil métier seul : ses bons de commande (saisis par lui) et ceux de ses engagements."""
    user = request.env.user
    return ["|", ("create_uid", "=", user.id), ("eguitra_commitment_id.requested_by", "=", user.id)]


def _po(order_id):
    order = check_company(request.env["purchase.order"].sudo().browse(order_id).exists(), "Bon de commande")
    if purchase_restricted() and request.env.user not in (order.create_uid | order.eguitra_commitment_id.requested_by):
        raise ApiError(404, "not_found", "Bon de commande introuvable parmi vos demandes.")
    return order


def _commitment(commitment_id):
    commitment = request.env["eguitra.commitment"].browse(commitment_id).exists()
    return check_company(commitment, "Engagement")


def _receipt(receipt_id):
    receipt = request.env["eguitra.commerce.receipt"].sudo().browse(receipt_id).exists()
    check_company(receipt, "Réception")
    _po(receipt.purchase_order_id.id)
    return receipt


def _upload():
    upload = request.httprequest.files.get("file")
    if not upload:
        raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
    content = upload.read(MAX_FILE + 1)
    if len(content) > MAX_FILE:
        raise ApiError(413, "too_large", "Fichier trop volumineux (15 Mo maximum).")
    mimetype = detect_type(content)
    if not mimetype:
        raise ApiError(415, "unsupported_type", f"Formats acceptés : {ACCEPTED}.")
    return upload.filename, content, mimetype


def _download(attachment, default):
    attachment = attachment.sudo()
    if not attachment:
        raise ApiError(404, "not_found", "Aucune pièce jointe.")
    return request.make_response(attachment.raw or b"", headers=[
        ("Content-Type", attachment.mimetype or "application/octet-stream"),
        ("Content-Disposition", content_disposition(attachment.name or default)),
        ("X-Content-Type-Options", "nosniff"),
    ])


def receipt_row(receipt):
    return {
        "id": receipt.id, "name": receipt.name, "date": receipt.date, "state": receipt.state,
        "received_by": user_ref(receipt.received_by), "note": receipt.note or None,
        "attachment": {"id": receipt.attachment_id.id, "name": receipt.attachment_id.name} if receipt.attachment_id else None,
        "cancel_reason": receipt.cancel_reason or None, "cancelled_by": user_ref(receipt.cancelled_by),
        "lines": [{"id": l.id, "order_line_id": l.purchase_line_id.id, "name": l.purchase_line_id.name,
                   "quantity": l.quantity, "uom": l.product_uom_id.name or None} for l in receipt.line_ids],
    }


def bill_row(move):
    move = move.sudo()
    match = move._eguitra_match() if move.move_type == "in_invoice" and move.state != "cancel" else None
    return {"id": move.id, "name": move.name if move.name and move.name != "/" else None, "ref": move.ref or None,
            "state": move.state, "date": move.invoice_date or move.date, "amount_untaxed": move.amount_untaxed,
            "amount_total": move.amount_total, "approval": move._eguitra_approval_info(),
            "match": match}


def po_row(order, detail=False):
    lines = order._eguitra_product_lines()
    ordered = sum(lines.mapped("price_subtotal"))
    received = sum(l.qty_received * l.price_unit * (1 - (l.discount or 0) / 100) for l in lines)
    billed = sum(l.qty_invoiced * l.price_unit * (1 - (l.discount or 0) / 100) for l in lines)
    status = order.eguitra_status
    approved = order.state == "purchase"
    data = {
        "id": order.id, "name": order.name, "status": status, "status_label": STATUS_LABELS.get(status, status),
        "partner": ref(order.partner_id), "object": order.eguitra_object or None, "partner_ref": order.partner_ref or None,
        "date": order.date_order.date() if order.date_order else None, "date_approve": order.date_approve,
        "date_planned": order.date_planned.date() if order.date_planned else None,
        "commitment": ({"id": order.eguitra_commitment_id.id, "name": order.eguitra_commitment_id.name,
                        "object": order.eguitra_commitment_id.object} if order.eguitra_commitment_id else None),
        "currency": order.currency_id.name, "amount_untaxed": order.amount_untaxed, "amount_tax": order.amount_tax,
        "amount_total": order.amount_total, "received_untaxed": received, "billed_untaxed": billed,
        "to_bill_untaxed": max(received - billed, 0.0), "ordered_untaxed": ordered,
        "received_pct": (sum(min(l.qty_received / l.product_qty, 1.0) for l in lines if l.product_qty) / len(lines) * 100)
        if lines else 0.0,
        "sent_at": order.eguitra_sent_at, "sent_by": user_ref(order.eguitra_sent_by),
        "emailed_to": order.eguitra_emailed_to or None, "created_by": user_ref(order.create_uid),
        "approval": order._eguitra_approval_info(), "company": ref(order.company_id),
        "can": {
            "edit": order.state == "draft", "submit": order.state == "draft", "send": approved,
            "receive": approved and any(l.qty_received < l.product_qty for l in lines),
            "bill": approved and any(l.qty_received > l.qty_invoiced for l in lines),
            "cancel": order.state != "cancel" and not order.eguitra_receipt_ids.filtered(lambda r: r.state == "done"),
        },
    }
    if detail:
        data.update({
            "conditions": order.eguitra_conditions or None,
            "lines": [line_row(l, "purchase") for l in order.order_line.sorted(lambda l: (l.sequence, l.id))],
            "receipts": [receipt_row(r) for r in order.eguitra_receipt_ids.sorted(lambda r: (r.date, r.id))],
            "bills": [bill_row(m) for m in (order.eguitra_bill_ids | order.invoice_ids).sorted("id")],
            "covered_by_commitment": order._eguitra_commitment_covers() if order.state == "draft" else None,
        })
    return data


def _header(data, creating, commitment=None):
    values = {}
    if creating or "partner_id" in data:
        partner_id = data.get("partner_id") or (commitment.partner_id.id if commitment else None)
        if not partner_id:
            raise ApiError(400, "missing_fields", "Le fournisseur est obligatoire.", fields=["partner_id"])
        values["partner_id"] = partner_of(partner_id, "Fournisseur").id
    for key, field, size in (("object", "eguitra_object", 250), ("conditions", "eguitra_conditions", 4000),
                             ("partner_ref", "partner_ref", 120)):
        if key in data:
            values[field] = text(data[key], size)
    if creating and "eguitra_object" not in values and commitment:
        values["eguitra_object"] = commitment.object
    return values


def _planned(data, commitment=None):
    day = parse_date(data, "date_planned") or (commitment.date_expected if commitment else None) or today()
    return fields.Datetime.to_datetime(f"{day} 12:00:00")


class EguitraCommercePurchases(http.Controller):
    # ─── Bons de commande ─────────────────────────────────────────────────

    @api_route("/commerce/purchase-orders", profiles=PURCHASE_ALL)
    def purchase_orders(self, **kw):
        domain = [("company_id", "=", company().id)] + VIEWS.get(kw.get("view"), [])
        if purchase_restricted():
            domain += _own_domain()
        if kw.get("status"):
            domain.append(("eguitra_status", "in", kw["status"].split(",")))
        if kw.get("commitment_id"):
            domain.append(("eguitra_commitment_id", "=", int_arg(kw, "commitment_id")))
        if kw.get("partner_id"):
            domain.append(("partner_id", "=", int_arg(kw, "partner_id")))
        if kw.get("search"):
            s = kw["search"]
            domain += ["|", "|", ("name", "ilike", s), ("eguitra_object", "ilike", s), ("partner_id.name", "ilike", s)]
        Order = request.env["purchase.order"].sudo()
        limit, offset = int_arg(kw, "limit", 100, 1, 500), int_arg(kw, "offset", 0, 0)
        orders = Order.search(domain, limit=limit, offset=offset, order="id desc")
        return {"items": [po_row(o) for o in orders], "total": Order.search_count(domain), "limit": limit,
                "offset": offset}

    @api_route("/commerce/purchase-orders/<int:order_id>", profiles=PURCHASE_ALL)
    def purchase_order(self, order_id, **_kw):
        return po_row(_po(order_id), detail=True)

    @api_route("/commerce/purchase-orders", methods=("POST",), profiles=PURCHASE_ALL)
    def create_purchase_order(self, **_kw):
        """Bon de commande direct, ou depuis un engagement approuvé (commitment_id : son fournisseur, son objet,
        et sans lignes, une ligne du reste à commander sur son compte et son analytique). submit=true le soumet."""
        data = read_json()
        comp = company()
        commitment = None
        if data.get("commitment_id"):
            commitment = _commitment(as_int(data["commitment_id"], "commitment_id"))
            if commitment.state != "approved":
                raise ApiError(422, "business_rule", "Seul un engagement approuvé donne un bon de commande.")
            if purchase_restricted() and commitment.requested_by != request.env.user:
                raise ApiError(403, "forbidden", "Vous ne commandez que sur vos propres engagements.")
        values = _header(data, creating=True, commitment=commitment)
        planned = _planned(data, commitment)
        if commitment and not data.get("lines"):
            others = commitment.sudo().eguitra_purchase_order_ids.filtered(lambda o: o.state != "cancel")
            rest = commitment.amount - sum(others.mapped("amount_untaxed"))
            if rest <= 0.5:
                raise ApiError(422, "business_rule", f"L'engagement {commitment.name} est déjà entièrement commandé.")
            data = dict(data, lines=[{"name": commitment.object, "quantity": 1, "price_unit": rest}])
        if commitment:
            values["eguitra_commitment_id"] = commitment.id
        values.update({"company_id": comp.id, "date_planned": planned,
                       "order_line": purchase_line_commands(data, comp, commitment=commitment, planned=planned)})
        order = request.env["purchase.order"].sudo().with_company(comp)._eguitra_quiet().create(values)
        if data.get("submit"):
            order.action_eguitra_submit()
        return po_row(order, detail=True)

    @api_route("/commerce/purchase-orders/<int:order_id>", methods=("PATCH",), profiles=PURCHASE_ALL)
    def update_purchase_order(self, order_id, **_kw):
        """Modification d'un bon de commande en brouillon (ou refusé), avant sa soumission."""
        order = _po(order_id)
        if order.state != "draft":
            raise ApiError(422, "business_rule", "Seul un bon de commande en brouillon ou refusé se modifie.")
        data = read_json()
        values = _header(data, creating=False)
        commitment = order.eguitra_commitment_id
        if "date_planned" in data:
            values["date_planned"] = _planned(data, commitment)
        if "lines" in data:
            planned = values.get("date_planned") or order.date_planned or _planned({}, commitment)
            values["order_line"] = [Command.clear()] + purchase_line_commands(data, order.company_id, commitment=commitment,
                                                                             planned=planned)
        order._eguitra_quiet().write(values)
        return po_row(order, detail=True)

    @api_route("/commerce/purchase-orders/<int:order_id>/<string:action>", methods=("POST",), profiles=PURCHASE_ALL)
    def act(self, order_id, action, **_kw):
        order = _po(order_id)
        data = read_json()
        if action == "submit":
            order.action_eguitra_submit()
        elif action == "send":
            email_to = None
            if data.get("email"):
                email_to = text(data.get("email_to") or order.partner_id.email, 240)
                if order.state != "purchase":
                    raise ApiError(422, "business_rule", "Seul un bon de commande approuvé s'envoie au fournisseur.")
                send_document(order, PO_REPORT, document_filename(order, "Bon de commande"), email_to,
                              f"{order.company_id.name} : bon de commande {order.name}", f"Bon de commande {order.name}", [
                                  "Madame, Monsieur,",
                                  f"Veuillez trouver ci-joint notre bon de commande {order.name}"
                                  + (f" ({order.eguitra_object})" if order.eguitra_object else "") + ".",
                                  "Merci d'en accuser réception et de rappeler son numéro sur votre bon de livraison "
                                  "et votre facture.",
                              ])
            order.action_eguitra_mark_sent(emailed_to=email_to)
        elif action == "cancel":
            order.action_eguitra_cancel()
        else:
            raise ApiError(404, "not_found", "Action inconnue.")
        return po_row(order, detail=True)

    @api_route("/commerce/purchase-orders/<int:order_id>/pdf", profiles=PURCHASE_ALL)
    def purchase_order_pdf(self, order_id, **_kw):
        order = _po(order_id)
        pdf, _kind = request.env["ir.actions.report"].sudo()._render_qweb_pdf(PO_REPORT, order.ids)
        return request.make_response(pdf, headers=[
            ("Content-Type", "application/pdf"),
            ("Content-Disposition", content_disposition(document_filename(order, "Bon de commande"))),
        ])

    # ─── Réceptions ───────────────────────────────────────────────────────

    @api_route("/commerce/purchase-orders/<int:order_id>/receipts", methods=("POST",), profiles=PURCHASE_ALL)
    def receive(self, order_id, **_kw):
        """Réception (service fait) : {"date", "note", "lines": [{"id": ligne de commande, "quantity"}]}."""
        order = _po(order_id)
        data = read_json()
        rows = data.get("lines")
        if not isinstance(rows, list) or not rows:
            raise ApiError(400, "missing_fields", "Indiquez les quantités reçues.", fields=["lines"])
        quantities = {}
        for row in rows:
            line = order_line_of(order, row.get("id"))
            if not line or line.display_type:
                raise ApiError(422, "business_rule", "Ligne étrangère au bon de commande.")
            quantities[line] = as_float(row.get("quantity", 0), "quantity")
        day = parse_date(data, "date", today())
        if day > today():
            raise ApiError(422, "business_rule", "Une réception se date au plus tard d'aujourd'hui.")
        receipt = order.eguitra_receive(quantities, date=day, note=text(data.get("note"), 2000),
                                        received_by=request.env.user)
        return dict(po_row(order, detail=True), receipt=receipt_row(receipt))

    @api_route("/commerce/receipts/<int:receipt_id>/attachment", methods=("POST",), profiles=PURCHASE_ALL)
    def receipt_attachment(self, receipt_id, **_kw):
        """Bon de livraison du fournisseur joint à la réception (format lu dans le contenu)."""
        receipt = _receipt(receipt_id)
        name, content, mimetype = _upload()
        attachment = request.env["ir.attachment"].sudo().create({
            "name": checked_name(name, mimetype, "bon-de-livraison"), "datas": base64.b64encode(content),
            "mimetype": mimetype, "res_model": receipt._name, "res_id": receipt.id,
        })
        receipt.attachment_id = attachment
        return receipt_row(receipt)

    @api_route("/commerce/receipts/<int:receipt_id>/attachment", profiles=PURCHASE_ALL)
    def receipt_attachment_download(self, receipt_id, **_kw):
        return _download(_receipt(receipt_id).attachment_id, "bon-de-livraison")

    @api_route("/commerce/receipts/<int:receipt_id>/cancel", methods=("POST",), profiles=PURCHASE_ALL)
    def receipt_cancel(self, receipt_id, **_kw):
        receipt = _receipt(receipt_id)
        (reason,) = require(read_json(), "reason")
        receipt.action_cancel(reason)
        return po_row(receipt.purchase_order_id, detail=True)

    # ─── Pièce d'achat et rapprochement ───────────────────────────────────

    @api_route("/commerce/purchase-orders/<int:order_id>/bill", methods=("POST",), profiles=PURCHASE_BILL)
    def bill(self, order_id, **_kw):
        """Pièce d'achat du fournisseur rattachée au bon de commande, en brouillon : référence de la facture du
        fournisseur, date, et par ligne la quantité et le prix facturés (à défaut, le reçu non facturé au prix
        commandé). submit=true la soumet aussitôt (validée si elle se rapproche de la commande)."""
        order = _po(order_id)
        data = read_json()
        quantities, prices = {}, {}
        for row in data.get("lines") or []:
            line = order_line_of(order, row.get("id"))
            if not line or line.display_type:
                raise ApiError(422, "business_rule", "Ligne étrangère au bon de commande.")
            if row.get("quantity") not in (None, ""):
                quantities[line] = as_float(row["quantity"], "quantity")
                if quantities[line] < 0:
                    raise ApiError(422, "business_rule", "Une quantité facturée n'est pas négative.")
            if row.get("price_unit") not in (None, ""):
                prices[line] = as_float(row["price_unit"], "price_unit")
                if prices[line] < 0:
                    raise ApiError(422, "business_rule", "Un prix facturé n'est pas négatif.")
        move = order.eguitra_create_bill(ref=text(data.get("ref"), 120), quantities=quantities, prices=prices,
                                         invoice_date=parse_date(data, "invoice_date", today()))
        if data.get("submit"):
            user_move = move.sudo(False)
            check_mandatory_analytic(user_move.line_ids)
            user_move._eguitra_post_or_submit()
        return dict(po_row(order, detail=True), bill=bill_row(move))

    @api_route("/commerce/bills/<int:move_id>/match", profiles=PURCHASE_FULL)
    def match(self, move_id, **_kw):
        """Rapprochement d'une pièce d'achat avec sa commande et ses réceptions."""
        move = request.env["account.move"].sudo().browse(move_id).exists()
        check_company(move, "Pièce")
        if move.move_type != "in_invoice" or not move.eguitra_purchase_order_id:
            raise ApiError(422, "business_rule", "Cette pièce n'est pas rattachée à un bon de commande.")
        return dict(bill_row(move), order=po_row(move.eguitra_purchase_order_id))

    # ─── Devis fournisseurs des engagements ───────────────────────────────

    def _purchasing(self, commitment):
        quotes = commitment.eguitra_quote_ids
        orders = commitment.sudo().eguitra_purchase_order_ids
        comp = commitment.company_id
        return {
            "commitment": {"id": commitment.id, "name": commitment.name, "state": commitment.state,
                           "amount": commitment.amount, "partner": ref(commitment.partner_id)},
            "quotes_required": commitment._eguitra_quotes_required(),
            "threshold": comp.eguitra_three_quotes_threshold or None,
            "editable": commitment.state in ("draft", "rejected"),
            "quotes": [{
                "id": q.id, "partner": ref(q.partner_id), "reference": q.reference or None, "date": q.date,
                "amount": q.amount, "delay_days": q.delay_days or None, "note": q.note or None,
                "attachment": {"id": q.attachment_id.id, "name": q.attachment_id.sudo().name} if q.attachment_id else None,
                "selected": q.selected, "selection_reason": q.selection_reason or None,
                "selected_by": user_ref(q.selected_by), "selected_at": q.selected_at,
            } for q in quotes],
            "purchase_orders": [po_row(o) for o in orders.sorted("id")],
            "can_order": commitment.state == "approved",
        }

    @api_route("/commerce/commitments/<int:commitment_id>/purchasing", profiles=QUOTES)
    def purchasing(self, commitment_id, **_kw):
        """Devis comparés et bons de commande d'un engagement."""
        return self._purchasing(_commitment(commitment_id))

    @api_route("/commerce/commitments/<int:commitment_id>/quotes", methods=("POST",), profiles=QUOTES)
    def add_quote(self, commitment_id, **_kw):
        commitment = _commitment(commitment_id)
        data = read_json()
        partner_id, amount = require(data, "partner_id", "amount")
        values = {
            "commitment_id": commitment.id, "partner_id": partner_of(partner_id, "Fournisseur").id,
            "amount": as_float(amount, "amount"), "reference": text(data.get("reference"), 120),
            "date": parse_date(data, "date", today()), "note": text(data.get("note"), 2000),
            "delay_days": as_int(data["delay_days"], "delay_days") if data.get("delay_days") not in (None, "") else 0,
        }
        request.env["eguitra.commerce.supplier.quote"].create(values)
        return self._purchasing(commitment)

    def _quote(self, quote_id):
        quote = request.env["eguitra.commerce.supplier.quote"].browse(quote_id).exists()
        check_company(quote, "Devis")
        return quote

    @api_route("/commerce/supplier-quotes/<int:quote_id>", methods=("DELETE",), profiles=QUOTES)
    def delete_quote(self, quote_id, **_kw):
        quote = self._quote(quote_id)
        commitment = quote.commitment_id
        quote.unlink()
        return self._purchasing(commitment)

    @api_route("/commerce/supplier-quotes/<int:quote_id>/select", methods=("POST",), profiles=QUOTES)
    def select_quote(self, quote_id, **_kw):
        quote = self._quote(quote_id)
        quote.action_select(read_json().get("reason"))
        return self._purchasing(quote.commitment_id)

    @api_route("/commerce/supplier-quotes/<int:quote_id>/file", methods=("POST",), profiles=QUOTES)
    def quote_file(self, quote_id, **_kw):
        quote = self._quote(quote_id)
        name, content, mimetype = _upload()
        attachment = request.env["ir.attachment"].sudo().create({
            "name": checked_name(name, mimetype, "devis"), "datas": base64.b64encode(content), "mimetype": mimetype,
            "res_model": quote._name, "res_id": quote.id,
        })
        quote.attachment_id = attachment
        return self._purchasing(quote.commitment_id)

    @api_route("/commerce/supplier-quotes/<int:quote_id>/file", profiles=QUOTES)
    def quote_file_download(self, quote_id, **_kw):
        return _download(self._quote(quote_id).attachment_id, "devis")
