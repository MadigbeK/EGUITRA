"""Tableaux de bord des ventes et des achats de la société de travail, exportables en XLSX (tous les tableaux)
et en CSV (un tableau, sheet=n), comme les autres écrans de Finance.

Ventes : offres en cours (et celles qui expirent bientôt), taux de transformation de la période (offres
décidées : acceptées, refusées ou expirées, dernière version seulement), commandes à facturer, acomptes à
déduire. Achats : commandes à recevoir, réceptions à facturer, écarts de rapprochement, engagements non
soldés, bons en approbation.
"""

from datetime import date

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import api_route, int_arg
from odoo.addons.eguitra_finance.controllers.common import parse_date, today
from odoo.addons.eguitra_finance.controllers.exporting import export_meta, table_response

from .common import PURCHASE_DASH, SALES_READ, company
from .purchases import STATUS_LABELS as PO_LABELS
from .sales import STATUS_LABELS as OFFER_LABELS

EPSILON = 1e-6


def _net(line):
    return line.price_unit * (1 - (line.discount or 0.0) / 100)


def sales_dashboard(comp, date_from, date_to):
    Order = request.env["sale.order"].sudo()
    today_ = today()
    reminder = comp.eguitra_offer_reminder_days or 0
    open_offers = Order.search([("company_id", "=", comp.id), ("state", "in", ("draft", "sent"))],
                               order="validity_date, id")
    offers = [{
        "id": o.id, "name": o.name, "partner": o.partner_id.name, "object": o.eguitra_object or "",
        "date": o.eguitra_offer_date, "validity_date": o.validity_date, "status": OFFER_LABELS.get(o.eguitra_status),
        "expires_in": (o.validity_date - today_).days if o.validity_date else None,
        "amount_untaxed": o.amount_untaxed,
    } for o in open_offers]
    decided = Order.search([
        ("company_id", "=", comp.id), ("eguitra_status", "in", ("accepted", "refused", "expired")),
        ("eguitra_offer_date", ">=", date_from), ("eguitra_offer_date", "<=", date_to),
    ])
    accepted = decided.filtered(lambda o: o.eguitra_status == "accepted")
    orders, advances = [], []
    for order in Order.search([("company_id", "=", comp.id), ("state", "=", "sale")], order="id desc"):
        amounts = order._eguitra_amounts()
        row = {"id": order.id, "name": order.name, "partner": order.partner_id.name,
               "object": order.eguitra_object or "", "chantier": order.eguitra_chantier_id.name or "",
               **{k: amounts[k] for k in ("ordered", "invoiced", "advances", "advances_deducted", "to_deduct",
                                          "to_invoice")}}
        if amounts["to_invoice"] > 0.5:
            orders.append(row)
        if amounts["to_deduct"] > 0.5:
            advances.append(row)
    count_decided = len(decided)
    amount_decided = sum(decided.mapped("amount_untaxed"))
    return {
        "period": {"date_from": date_from, "date_to": date_to},
        "kpis": {
            "open_count": len(offers), "open_amount": sum(o["amount_untaxed"] for o in offers),
            "expiring_count": sum(1 for o in offers if o["expires_in"] is not None and 0 <= o["expires_in"] <= reminder),
            "expired_pending": sum(1 for o in offers if o["expires_in"] is not None and o["expires_in"] < 0),
            "decided_count": count_decided, "accepted_count": len(accepted),
            "conversion_rate": len(accepted) / count_decided * 100 if count_decided else None,
            "conversion_amount_rate": sum(accepted.mapped("amount_untaxed")) / amount_decided * 100
            if amount_decided else None,
            "accepted_amount": sum(accepted.mapped("amount_untaxed")),
            "to_invoice_count": len(orders), "to_invoice_amount": sum(o["to_invoice"] for o in orders),
            "to_deduct_amount": sum(o["to_deduct"] for o in advances),
        },
        "reminder_days": reminder, "offers": offers, "orders": orders, "advances": advances,
    }


def purchases_dashboard(comp):
    Order = request.env["purchase.order"].sudo()
    today_ = today()
    to_receive, to_bill = [], []
    for order in Order.search([("company_id", "=", comp.id), ("state", "=", "purchase")], order="date_planned, id"):
        lines = order._eguitra_product_lines()
        pending = [l for l in lines if l.qty_received < l.product_qty - EPSILON]
        if pending:
            planned = order.date_planned.date() if order.date_planned else None
            to_receive.append({
                "id": order.id, "name": order.name, "partner": order.partner_id.name, "object": order.eguitra_object or "",
                "date_planned": planned, "late": bool(planned and planned < today_),
                "status": PO_LABELS.get(order.eguitra_status), "amount_untaxed": order.amount_untaxed,
                "remaining_untaxed": sum((l.product_qty - l.qty_received) * _net(l) for l in pending),
            })
        unbilled = sum(max(l.qty_received - l.qty_invoiced, 0.0) * _net(l) for l in lines)
        if unbilled > 0.5:
            to_bill.append({"id": order.id, "name": order.name, "partner": order.partner_id.name,
                            "object": order.eguitra_object or "", "amount": unbilled})
    gaps = []
    bills = request.env["account.move"].sudo().search([
        ("company_id", "=", comp.id), ("move_type", "=", "in_invoice"), ("eguitra_purchase_order_id", "!=", False),
        ("state", "=", "draft"),
    ], order="id desc")
    for bill in bills:
        match = bill._eguitra_match()
        if not match["ok"]:
            approval = bill._eguitra_approval_info()
            gaps.append({"id": bill.id, "name": bill.ref or bill.name or "", "partner": bill.partner_id.name,
                         "order": bill.eguitra_purchase_order_id.name, "amount_untaxed": bill.amount_untaxed,
                         "issues": " ".join(match["issues"]),
                         "approval": (approval or {}).get("pending_with") or ""})
    commitments = []
    for commitment in request.env["eguitra.commitment"].sudo().search(
            [("company_id", "=", comp.id), ("state", "=", "approved")], order="date, id"):
        if commitment.remaining > 0.5:
            ordered = sum(commitment.eguitra_purchase_order_ids.filtered(lambda o: o.state != "cancel").mapped("amount_untaxed"))
            commitments.append({"id": commitment.id, "name": commitment.name, "partner": commitment.partner_id.name,
                                "object": commitment.object, "date": commitment.date, "amount": commitment.amount,
                                "ordered": ordered, "consumed": commitment.consumed, "remaining": commitment.remaining})
    in_approval = Order.search_count([("company_id", "=", comp.id), ("state", "=", "to approve")])
    return {
        "kpis": {
            "to_receive_count": len(to_receive), "to_receive_amount": sum(r["remaining_untaxed"] for r in to_receive),
            "late_count": sum(1 for r in to_receive if r["late"]),
            "to_bill_count": len(to_bill), "to_bill_amount": sum(r["amount"] for r in to_bill),
            "gaps_count": len(gaps), "commitments_count": len(commitments),
            "commitments_remaining": sum(c["remaining"] for c in commitments), "in_approval": in_approval,
        },
        "to_receive": to_receive, "to_bill": to_bill, "gaps": gaps, "commitments": commitments,
    }


def _sales_sheets(comp, data):
    meta = export_meta(comp, [("Période", f"{data['period']['date_from']:%d/%m/%Y} au {data['period']['date_to']:%d/%m/%Y}")])
    k = data["kpis"]
    return [
        {"title": "Synthèse", "meta": meta, "columns": [("Indicateur", "text"), ("Valeur", "number")], "rows": [
            ["Offres en cours", k["open_count"]], ["Montant des offres en cours (HT)", k["open_amount"]],
            ["Offres qui expirent bientôt", k["expiring_count"]], ["Offres décidées sur la période", k["decided_count"]],
            ["Offres acceptées", k["accepted_count"]], ["Taux de transformation (%)", k["conversion_rate"]],
            ["Taux de transformation en montant (%)", k["conversion_amount_rate"]],
            ["Commandes à facturer", k["to_invoice_count"]], ["Reste à facturer (HT)", k["to_invoice_amount"]],
            ["Acomptes à déduire (HT)", k["to_deduct_amount"]],
        ]},
        {"title": "Offres en cours", "meta": meta,
         "columns": [("Offre", "text"), ("Client", "text"), ("Objet", "text"), ("Date", "date"), ("Validité", "date"),
                     ("État", "text"), ("Jours restants", "int"), ("Montant HT", "money")],
         "rows": [[o["name"], o["partner"], o["object"], o["date"], o["validity_date"], o["status"], o["expires_in"],
                   o["amount_untaxed"]] for o in data["offers"]],
         "totals": ["Total", "", "", None, None, "", None, sum(o["amount_untaxed"] for o in data["offers"])]},
        {"title": "Commandes à facturer", "meta": meta,
         "columns": [("Commande", "text"), ("Client", "text"), ("Objet", "text"), ("Chantier", "text"),
                     ("Commandé HT", "money"), ("Facturé HT", "money"), ("Reste à facturer HT", "money")],
         "rows": [[o["name"], o["partner"], o["object"], o["chantier"], o["ordered"], o["invoiced"], o["to_invoice"]]
                  for o in data["orders"]],
         "totals": ["Total", "", "", "", sum(o["ordered"] for o in data["orders"]),
                    sum(o["invoiced"] for o in data["orders"]), sum(o["to_invoice"] for o in data["orders"])]},
        {"title": "Acomptes à déduire", "meta": meta,
         "columns": [("Commande", "text"), ("Client", "text"), ("Acomptes facturés HT", "money"),
                     ("Déjà déduits HT", "money"), ("À déduire HT", "money")],
         "rows": [[o["name"], o["partner"], o["advances"], o["advances_deducted"], o["to_deduct"]] for o in data["advances"]],
         "totals": ["Total", "", sum(o["advances"] for o in data["advances"]),
                    sum(o["advances_deducted"] for o in data["advances"]), sum(o["to_deduct"] for o in data["advances"])]},
    ]


def _purchase_sheets(comp, data):
    meta = export_meta(comp)
    k = data["kpis"]
    return [
        {"title": "Synthèse", "meta": meta, "columns": [("Indicateur", "text"), ("Valeur", "number")], "rows": [
            ["Commandes à recevoir", k["to_receive_count"]], ["Reste à recevoir (HT)", k["to_receive_amount"]],
            ["Dont en retard", k["late_count"]], ["Réceptions à facturer", k["to_bill_count"]],
            ["Reçu non facturé (HT)", k["to_bill_amount"]], ["Écarts de rapprochement", k["gaps_count"]],
            ["Engagements non soldés", k["commitments_count"]], ["Reste à engager (HT)", k["commitments_remaining"]],
            ["Bons de commande en approbation", k["in_approval"]],
        ]},
        {"title": "Commandes à recevoir", "meta": meta,
         "columns": [("Bon de commande", "text"), ("Fournisseur", "text"), ("Objet", "text"),
                     ("Livraison prévue", "date"), ("En retard", "text"), ("État", "text"), ("Montant HT", "money"),
                     ("Reste à recevoir HT", "money")],
         "rows": [[r["name"], r["partner"], r["object"], r["date_planned"], "oui" if r["late"] else "non", r["status"],
                   r["amount_untaxed"], r["remaining_untaxed"]] for r in data["to_receive"]]},
        {"title": "Réceptions à facturer", "meta": meta,
         "columns": [("Bon de commande", "text"), ("Fournisseur", "text"), ("Objet", "text"), ("Reçu non facturé HT", "money")],
         "rows": [[r["name"], r["partner"], r["object"], r["amount"]] for r in data["to_bill"]],
         "totals": ["Total", "", "", sum(r["amount"] for r in data["to_bill"])]},
        {"title": "Écarts de rapprochement", "meta": meta,
         "columns": [("Pièce", "text"), ("Fournisseur", "text"), ("Bon de commande", "text"), ("Montant HT", "money"),
                     ("Écarts", "text"), ("En validation", "text")],
         "rows": [[g["name"], g["partner"], g["order"], g["amount_untaxed"], g["issues"], g["approval"]]
                  for g in data["gaps"]]},
        {"title": "Engagements non soldés", "meta": meta,
         "columns": [("Engagement", "text"), ("Fournisseur", "text"), ("Objet", "text"), ("Date", "date"),
                     ("Engagé HT", "money"), ("Commandé HT", "money"), ("Consommé HT", "money"), ("Reste HT", "money")],
         "rows": [[c["name"], c["partner"], c["object"], c["date"], c["amount"], c["ordered"], c["consumed"], c["remaining"]]
                  for c in data["commitments"]],
         "totals": ["Total", "", "", None, sum(c["amount"] for c in data["commitments"]),
                    sum(c["ordered"] for c in data["commitments"]), sum(c["consumed"] for c in data["commitments"]),
                    sum(c["remaining"] for c in data["commitments"])]},
    ]


class EguitraCommerceDashboards(http.Controller):
    @api_route("/commerce/sales/dashboard", profiles=SALES_READ)
    def sales(self, **kw):
        """Tableau de bord des ventes ; date_from et date_to bornent le taux de transformation (date des offres,
        par défaut l'année en cours) ; format=xlsx ou csv (sheet=n) pour l'export."""
        comp = company()
        end = parse_date(kw, "date_to", today())
        start = parse_date(kw, "date_from", date(end.year, 1, 1))
        data = sales_dashboard(comp, start, end)
        if kw.get("format") in ("xlsx", "csv"):
            return table_response(f"ventes-{fields.Date.to_string(end)}", _sales_sheets(comp, data), kw["format"],
                                  int_arg(kw, "sheet", 0, 0))
        return data

    @api_route("/commerce/purchases/dashboard", profiles=PURCHASE_DASH)
    def purchases(self, **kw):
        comp = company()
        data = purchases_dashboard(comp)
        if kw.get("format") in ("xlsx", "csv"):
            return table_response(f"achats-{fields.Date.to_string(today())}", _purchase_sheets(comp, data), kw["format"],
                                  int_arg(kw, "sheet", 0, 0))
        return data

    @api_route("/commerce/deadlines", profiles=SALES_READ + ("achats", "exploitation", "chantiers", "immobilier"))
    def deadlines(self, **kw):
        """Échéances des achats et des ventes (expiration des offres, livraisons attendues) entre deux dates ;
        lisibles par l'agenda le jour où il les proposera."""
        start = parse_date(kw, "date_from", today())
        end = parse_date(kw, "date_to", fields.Date.add(start, days=31))
        items = request.env["eguitra.commerce.deadline"].deadlines(request.env.user, company(), start, min(
            end, fields.Date.add(start, days=92)))
        return {"items": items}
