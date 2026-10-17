"""Export des rotations avec leurs colonnes calculées (CSV ou XLSX)."""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import api_route
from odoo.addons.eguitra_finance.controllers.common import parse_date, today
from odoo.addons.eguitra_finance.controllers.exporting import export_meta, table_response

from ..models.rotation import COSTS
from .transport import READ

STATES = {"draft": "Saisie", "done": "Validée", "invoiced": "Facturée", "cancelled": "Annulée"}
# Kilométrage et ratios de la rotation (rentabilité au kilomètre), après les frais (COSTS, dont les
# pneumatiques). Champs du modèle : un nom erroné lève une erreur au lieu de faire disparaître la colonne.
RATIOS = [
    ("distance_km", "Distance (km)", "number"), ("fuel_liters", "Carburant (L)", "number"),
    ("duration_days", "Durée (j)", "number"), ("revenue_per_km", "CA / km", "money"),
    ("cost_per_km", "Coût / km", "money"), ("cost_per_liter", "Coût / litre", "money"),
    ("fuel_per_100km", "L / 100 km", "number"),
]


class EguitraTransportExports(http.Controller):
    @api_route("/transport/exports/rotations", profiles=READ)
    def export_rotations(self, **kw):
        end = parse_date(kw, "date_to", today())
        start = parse_date(kw, "date_from", end.replace(month=1, day=1))
        Rotation = request.env["eguitra.transport.rotation"]
        domain = [("company_id", "=", request.env.company.id), ("date_loading", ">=", start), ("date_loading", "<=", end)]
        if kw.get("state"):
            domain.append(("state", "in", kw["state"].split(",")))
        rotations = Rotation.search(domain, order="date_loading, id")
        columns = [("Numéro", "text"), ("État", "text"), ("Chargement", "date"), ("Livraison", "date"),
                   ("Ensemble", "text"), ("Chauffeur", "text"), ("Client", "text"), ("Route", "text"),
                   ("Produit", "text"), ("Bon de livraison", "text"), ("Volume chargé (m³)", "number"),
                   ("Volume livré (m³)", "number"), ("Manquant (m³)", "number"), ("Tarif / m³", "money"),
                   ("Montant facturable", "money"), *[(label, "money") for _f, label in COSTS],
                   ("Coût total", "money"), ("Marge", "money"), ("Taux de marge (%)", "percent"),
                   *[(label, kind) for _f, label, kind in RATIOS], ("Facture", "text")]
        rows = []
        for rot in rotations:
            rows.append([
                rot.name if rot.name != "/" else "", STATES.get(rot.state, rot.state), rot.date_loading, rot.date_delivery,
                rot.vehicle_id.name or "", rot.driver_id.name or "", rot.partner_id.name or "", rot.route_id.name or "",
                rot.product_id.name or rot.product or "", rot.delivery_note or "", rot.volume_loaded,
                rot.volume_delivered, rot.shortage, rot.rate, rot.revenue, *[rot[f] for f, _l in COSTS],
                rot.total_cost, rot.margin, rot.margin_rate, *[rot[f] for f, _l, _k in RATIOS],
                rot.invoice_id.name or "",
            ])
        # Totaux des seules colonnes additives (montants, volumes) ; pas des ratios (« / »).
        additive = {i for i, (label, kind) in enumerate(columns) if kind in ("money", "number") and "/" not in label}
        totals = ["TOTAL"] + [sum(r[i] or 0 for r in rows) if i in additive else None for i in range(1, len(columns))]
        sheet = {
            "title": "Rotations",
            "meta": export_meta(request.env.company, [("Période", f"{start:%d/%m/%Y} au {end:%d/%m/%Y}"),
                                                      ("Rotations", len(rows))]),
            "columns": columns, "rows": rows, "totals": totals,
        }
        return table_response(f"rotations_{start:%Y%m%d}_{end:%Y%m%d}", [sheet], kw.get("format", "xlsx"))
