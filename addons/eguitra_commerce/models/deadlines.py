"""Échéances des achats et des ventes, que l'agenda (eguitra_agenda) pourra lire comme ses autres sources :
expiration des offres envoyées, livraisons attendues des bons de commande approuvés. Calculées à la lecture,
bornées à la société de travail et aux profils qui ouvrent les écrans correspondants ; aucune dépendance à
l'agenda.
"""

from odoo import api, models

SALES = {"admin", "direction", "finance"}
PURCHASES = {"admin", "direction", "finance", "achats", "exploitation", "chantiers", "immobilier"}
MAX_ITEMS = 300


class EguitraCommerceDeadline(models.AbstractModel):
    _name = "eguitra.commerce.deadline"
    _description = "Échéances des achats et des ventes"

    @api.model
    def deadlines(self, user, company, date_from, date_to):
        """[{date, kind, title, detail, res_model, res_id}] entre les deux dates (incluses)."""
        profiles = set(user._eguitra_profiles())
        items = []
        if profiles & SALES:
            offers = self.env["sale.order"].sudo().search([
                ("company_id", "=", company.id), ("state", "in", ("draft", "sent")),
                ("validity_date", ">=", date_from), ("validity_date", "<=", date_to),
            ], order="validity_date", limit=MAX_ITEMS)
            items += [{"date": o.validity_date, "kind": "offer_expiry", "title": f"Fin de validité de l'offre {o.name}",
                       "detail": f"{o.partner_id.name} · {o.eguitra_object or ''}".strip(" ·"),
                       "res_model": "sale.order", "res_id": o.id} for o in offers]
        if profiles & PURCHASES:
            domain = [("company_id", "=", company.id), ("state", "=", "purchase"),
                      ("eguitra_status", "in", ("approved", "sent", "partial")),
                      ("date_planned", ">=", f"{date_from} 00:00:00"), ("date_planned", "<=", f"{date_to} 23:59:59")]
            if not profiles & {"admin", "direction", "finance", "achats"}:
                domain += ["|", ("create_uid", "=", user.id), ("eguitra_commitment_id.requested_by", "=", user.id)]
            orders = self.env["purchase.order"].sudo().search(domain, order="date_planned", limit=MAX_ITEMS)
            items += [{"date": o.date_planned.date(), "kind": "delivery",
                       "title": f"Livraison attendue : {o.name}", "detail": o.partner_id.name,
                       "res_model": "purchase.order", "res_id": o.id} for o in orders]
        return sorted(items, key=lambda i: (i["date"], i["title"]))
