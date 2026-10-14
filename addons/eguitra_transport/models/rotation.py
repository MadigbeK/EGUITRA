"""Rotation de transport : source unique de la facturation, des coûts analytiques et de la marge.

Une rotation est saisie une seule fois, au bureau ou au parc depuis l'application mobile (y compris
hors réseau : la saisie porte un identifiant généré sur le téléphone, la synchronisation est
idempotente). Validée, elle alimente la facture du client (une ligne par rotation, imputée sur
l'activité transport, l'ensemble routier et la route) et la rentabilité par véhicule et par route.
Les frais de la rotation sont imputés en analytique ; leur comptabilisation générale suit les
pièces réelles (carburant, péages, missions), pour ne pas compter deux fois la même dépense.
"""

from odoo import Command, api, fields, models
from odoo.exceptions import UserError

from .fleet import PRODUCTS

COSTS = [
    ("fuel_cost", "Carburant"),
    ("toll_cost", "Péages"),
    ("driver_fees", "Frais du chauffeur"),
    ("maintenance_cost", "Entretien et réparations"),
    ("specific_taxes", "Taxes spécifiques"),
    ("other_costs", "Autres frais"),
]


class EguitraTransportRotation(models.Model):
    _name = "eguitra.transport.rotation"
    _description = "Rotation de transport"
    _order = "date_loading desc, id desc"
    # Ensemble, chauffeur, client et route appartiennent à la société de la rotation.
    _check_company_auto = True

    name = fields.Char("Numéro", default="/", copy=False, readonly=True, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    client_uuid = fields.Char("Identifiant de saisie", copy=False, index=True,
                              help="Généré par l'application mobile : une saisie synchronisée deux fois n'est créée qu'une fois.")
    source = fields.Selection([("office", "Bureau"), ("mobile", "Application mobile")], default="office")
    state = fields.Selection(
        [("draft", "Saisie"), ("done", "Validée"), ("invoiced", "Facturée"), ("cancelled", "Annulée")],
        default="draft", required=True, index=True,
    )
    date_loading = fields.Date("Chargement", required=True, default=fields.Date.context_today)
    date_delivery = fields.Date("Livraison")
    vehicle_id = fields.Many2one("eguitra.transport.vehicle", "Ensemble routier", required=True, check_company=True)
    driver_id = fields.Many2one("eguitra.transport.driver", "Chauffeur", check_company=True)
    partner_id = fields.Many2one("res.partner", "Client", required=True, check_company=True)
    route_id = fields.Many2one("eguitra.transport.route", "Route", required=True, check_company=True)
    product = fields.Selection(PRODUCTS, "Produit", required=True, default="gasoil")
    delivery_note = fields.Char("Bon de livraison")
    volume_loaded = fields.Float("Volume chargé (m³)", digits=(12, 3))
    volume_delivered = fields.Float("Volume livré (m³)", digits=(12, 3))
    shortage = fields.Float("Manquant (m³)", digits=(12, 3), compute="_compute_amounts", store=True)
    rate = fields.Monetary("Tarif par m³")
    revenue = fields.Monetary("Montant facturable", compute="_compute_amounts", store=True)
    fuel_cost = fields.Monetary("Carburant")
    toll_cost = fields.Monetary("Péages")
    driver_fees = fields.Monetary("Frais du chauffeur")
    maintenance_cost = fields.Monetary("Entretien et réparations")
    specific_taxes = fields.Monetary("Taxes spécifiques")
    other_costs = fields.Monetary("Autres frais")
    total_cost = fields.Monetary("Coût total", compute="_compute_amounts", store=True)
    margin = fields.Monetary("Marge", compute="_compute_amounts", store=True)
    margin_rate = fields.Float("Taux de marge (%)", compute="_compute_amounts", store=True)
    note = fields.Text("Observations")
    invoice_id = fields.Many2one("account.move", "Facture", readonly=True, copy=False)

    _client_uuid_unique = models.Constraint("unique(client_uuid)", "Cette saisie a déjà été synchronisée.")

    @api.depends("volume_loaded", "volume_delivered", "rate", *[c for c, _l in COSTS])
    def _compute_amounts(self):
        for rot in self:
            billed = rot.volume_delivered or rot.volume_loaded
            rot.shortage = max(0.0, (rot.volume_loaded or 0.0) - (rot.volume_delivered or 0.0)) if rot.volume_delivered else 0.0
            rot.revenue = billed * (rot.rate or 0.0)
            rot.total_cost = sum(rot[c] or 0.0 for c, _l in COSTS)
            rot.margin = rot.revenue - rot.total_cost
            rot.margin_rate = (rot.margin / rot.revenue * 100) if rot.revenue else 0.0

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("route_id") and vals.get("partner_id") and not vals.get("rate"):
                route = self.env["eguitra.transport.route"].browse(vals["route_id"])
                partner = self.env["res.partner"].browse(vals["partner_id"])
                vals["rate"] = route._rate_for(partner, vals.get("product", "gasoil"))
            if vals.get("vehicle_id") and not vals.get("driver_id"):
                vals["driver_id"] = self.env["eguitra.transport.vehicle"].browse(vals["vehicle_id"]).driver_id.id or False
        return super().create(vals_list)

    def write(self, vals):
        locked = self.filtered(lambda r: r.state == "invoiced")
        if locked and set(vals) - {"note", "state", "invoice_id"}:
            raise UserError("Une rotation facturée ne se modifie plus ; établissez un avoir si nécessaire.")
        return super().write(vals)

    def action_validate(self):
        for rot in self:
            if rot.state != "draft":
                continue
            if not (rot.volume_loaded or rot.volume_delivered):
                raise UserError(f"Rotation {rot.name or ''} : volume chargé ou livré requis.")
            if not rot.rate:
                raise UserError(f"Rotation {rot.name or ''} : tarif manquant pour cette route et ce client.")
            if rot.name == "/":
                rot.name = self.env["ir.sequence"].next_by_code("eguitra.transport.rotation") or "/"
            rot.state = "done"
        return True

    def action_cancel(self):
        if self.filtered(lambda r: r.state == "invoiced"):
            raise UserError("Une rotation facturée ne peut pas être annulée.")
        self.write({"state": "cancelled"})
        return True

    def action_reset(self):
        self.filtered(lambda r: r.state in ("done", "cancelled")).write({"state": "draft"})
        return True

    @api.model
    def _activity_account(self, company):
        plan = self.env.ref("eguitra_base.analytic_plan_activite")
        Analytic = self.env["account.analytic.account"].sudo()
        account = Analytic.search([("plan_id", "=", plan.id), ("name", "=", "Transport pétrolier"),
                                   ("company_id", "in", [False, company.id])], limit=1)
        return account or Analytic.create({"name": "Transport pétrolier", "plan_id": plan.id, "company_id": company.id})

    def _invoice_line_vals(self, account):
        self.ensure_one()
        billed = self.volume_delivered or self.volume_loaded
        product = dict(PRODUCTS).get(self.product, self.product)
        label = f"Transport {product.lower()} {self.route_id.name}, {billed:,.3f} m³".replace(",", " ")
        if self.delivery_note:
            label += f", BL {self.delivery_note}"
        label += f" ({self.name}, {self.vehicle_id.name}, {self.date_loading:%d/%m/%Y})"
        distribution = {
            str(self._activity_account(self.company_id).id): 100,
            str(self.vehicle_id.analytic_account_id.id): 100,
            str(self.route_id.analytic_account_id.id): 100,
        }
        return {
            "name": label,
            "quantity": billed,
            "price_unit": self.rate,
            "account_id": account.id,
            "analytic_distribution": distribution,
        }

    def action_invoice(self):
        """Une facture par client, une ligne par rotation validée."""
        rotations = self.filtered(lambda r: r.state == "done")
        if not rotations:
            raise UserError("Sélectionnez des rotations validées et non encore facturées.")
        invoices = self.env["account.move"]
        for company in rotations.company_id:
            account = self.env["account.account"].search(
                [("code", "=like", "7061%"), ("company_ids", "in", company.ids)], limit=1
            ) or self.env["account.account"].search([("code", "=like", "706%"), ("company_ids", "in", company.ids)], limit=1)
            tax = company.account_sale_tax_id
            for partner in rotations.filtered(lambda r: r.company_id == company).partner_id:
                group = rotations.filtered(lambda r: r.company_id == company and r.partner_id == partner)
                lines = []
                for rot in group.sorted("date_loading"):
                    vals = rot._invoice_line_vals(account)
                    if tax:
                        vals["tax_ids"] = [Command.set(tax.ids)]
                    lines.append(Command.create(vals))
                invoice = self.env["account.move"].with_company(company).create({
                    "move_type": "out_invoice",
                    "partner_id": partner.id,
                    "invoice_date": fields.Date.context_today(self),
                    "invoice_origin": ", ".join(group.mapped("name")),
                    "invoice_line_ids": lines,
                })
                group.write({"state": "invoiced", "invoice_id": invoice.id})
                invoices |= invoice
        return invoices

    @api.model
    def profitability(self, companies, date_from, date_to, group_by="vehicle"):
        """Rentabilité agrégée par ensemble routier, route, chauffeur, client ou mois."""
        fields_map = {"vehicle": "vehicle_id", "route": "route_id", "driver": "driver_id", "client": "partner_id",
                      "month": "date_loading:month"}
        groupby = fields_map.get(group_by, "vehicle_id")
        domain = [("company_id", "in", companies.ids), ("state", "in", ("done", "invoiced")),
                  ("date_loading", ">=", date_from), ("date_loading", "<=", date_to)]
        groups = self.sudo()._read_group(
            domain, [groupby],
            ["__count", "volume_delivered:sum", "volume_loaded:sum", "revenue:sum", "total_cost:sum", "margin:sum",
             "shortage:sum", *[f"{c}:sum" for c, _l in COSTS]],
        )
        rows = []
        for key, count, delivered, loaded, revenue, cost, margin, shortage, *costs in groups:
            if group_by == "month":
                label = key.strftime("%Y-%m") if key else "?"
                key_id = label
            else:
                label = key.display_name if key else "Non renseigné"
                key_id = key.id if key else None
            rows.append({
                "key": key_id, "label": label, "rotations": count, "volume": delivered or loaded,
                "revenue": revenue, "cost": cost, "margin": margin, "shortage": shortage,
                "margin_rate": (margin / revenue * 100) if revenue else None,
                "costs": {c: v for (c, _l), v in zip(COSTS, costs)},
            })
        return sorted(rows, key=lambda r: r["label"] if group_by == "month" else -(r["revenue"] or 0))
