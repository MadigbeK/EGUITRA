"""Rotation de transport : source unique de la facturation, des coûts déclarés et de la marge.

Une rotation est saisie une seule fois, au bureau ou au parc depuis l'application mobile (y compris
hors réseau : la saisie porte un identifiant généré sur le téléphone, la synchronisation est
idempotente). Validée, elle alimente la facture du client (une ligne par rotation, imputée sur
l'activité transport, l'ensemble routier et la route) et la rentabilité par véhicule et par route.

Les frais saisis sur la rotation (carburant, péages, frais du chauffeur…) sont des coûts déclarés :
ils servent à la marge par rotation et ne passent pas en comptabilité, où la dépense entre par ses
pièces réelles (factures d'achat, caisse, missions) imputées sur les axes ensemble routier et route.
La rentabilité met les deux en regard (coûts déclarés, coûts comptabilisés, écart).

Volumes : le manquant (chargé - livré, sur volumes ambiants ou ramenés à 15 °C) se partage entre
le manquant toléré (tolérance en % du volume chargé : tarif, client ou société) et le manquant
excédentaire, valorisé au prix du m³ du produit (ou du tarif). Selon la règle du client ou de la
société, l'excédent est déduit de la facture du client et/ou porté en créance sur le chauffeur.
"""

from odoo import Command, api, fields, models
from odoo.exceptions import UserError
from odoo.tools import float_compare, float_round

from odoo.addons.eguitra_finance.models.syscohada import OPENING_JOURNAL

from .product import volume_correction_factor
from .settings import CLAIMED, DEDUCTED, SHORTAGE_RULES

COSTS = [
    ("fuel_cost", "Carburant"),
    ("toll_cost", "Péages"),
    ("driver_fees", "Frais du chauffeur"),
    ("maintenance_cost", "Entretien et réparations"),
    ("specific_taxes", "Taxes spécifiques"),
    ("other_costs", "Autres frais"),
]


def fmt_m3(value):
    """12,345 m³ : volume à la française, trois décimales."""
    return f"{value:,.3f}".replace(",", " ").replace(".", ",") + " m³"


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
    product_id = fields.Many2one(
        "eguitra.transport.product", "Produit", required=True, check_company=True, ondelete="restrict", index=True,
        default=lambda self: self.env["eguitra.transport.product"]._default_product(),
    )
    # Code du produit, échangé avec l'application mobile et les fichiers de reprise.
    product = fields.Char("Code produit", compute="_compute_product_code")
    delivery_note = fields.Char("Bon de livraison")

    # ─── Volumes ──────────────────────────────────────────────────────────
    volume_loaded = fields.Float("Volume chargé (m³)", digits=(12, 3))
    volume_delivered = fields.Float("Volume livré (m³)", digits=(12, 3))
    volume_correction = fields.Boolean(
        "Manquant sur volumes à 15 °C", default=lambda self: self.env.company.transport_volume_correction,
        help="Le manquant se calcule sur les volumes ramenés à 15 °C ; la facturation reste sur le volume livré.",
    )
    temperature_loaded = fields.Float("Température au chargement (°C)", digits=(5, 1), help="0 : non relevée.")
    temperature_delivered = fields.Float("Température à la livraison (°C)", digits=(5, 1), help="0 : non relevée.")
    density_15 = fields.Float(
        "Masse volumique à 15 °C (kg/m³)", digits=(6, 1), compute="_compute_density", store=True, readonly=False,
        help="Celle du bon de chargement ; à défaut, la valeur usuelle du produit.",
    )
    vcf_loaded = fields.Float(
        "Coefficient de correction au chargement", digits=(6, 5), compute="_compute_vcf", store=True, readonly=False,
        help="Calculé (table 54B) à partir de la température et de la masse volumique, ou repris du bon du dépôt.",
    )
    vcf_delivered = fields.Float(
        "Coefficient de correction à la livraison", digits=(6, 5), compute="_compute_vcf", store=True, readonly=False,
    )
    volume_loaded_15 = fields.Float("Volume chargé à 15 °C (m³)", digits=(12, 3), compute="_compute_amounts", store=True)
    volume_delivered_15 = fields.Float("Volume livré à 15 °C (m³)", digits=(12, 3), compute="_compute_amounts", store=True)
    over_capacity = fields.Boolean("Au-delà de la capacité de la citerne", compute="_compute_over_capacity")

    # ─── Manquants ────────────────────────────────────────────────────────
    shortage = fields.Float("Manquant (m³)", digits=(12, 3), compute="_compute_amounts", store=True)
    shortage_tolerance = fields.Float(
        "Tolérance de manquant (%)", digits=(5, 3), compute="_compute_shortage_terms", store=True, readonly=False,
        help="En % du volume chargé : tarif du client, sinon conditions du client, sinon valeur de la société.",
    )
    shortage_rule = fields.Selection(
        SHORTAGE_RULES, "Traitement du manquant excédentaire", compute="_compute_shortage_terms", store=True,
        readonly=False,
    )
    shortage_unit_price = fields.Monetary(
        "Prix du m³ manquant", compute="_compute_shortage_terms", store=True, readonly=False,
        help="Prix du tarif du client, sinon du produit ; figé sur la rotation.",
    )
    shortage_tolerated = fields.Float("Manquant toléré (m³)", digits=(12, 3), compute="_compute_amounts", store=True)
    shortage_excess = fields.Float("Manquant excédentaire (m³)", digits=(12, 3), compute="_compute_amounts", store=True)
    shortage_value = fields.Monetary("Valeur du manquant excédentaire", compute="_compute_amounts", store=True)
    shortage_deduction = fields.Monetary("Déduction sur la facture du client", compute="_compute_amounts", store=True)
    shortage_claim = fields.Monetary("Créance sur le chauffeur", compute="_compute_amounts", store=True)
    shortage_net_cost = fields.Monetary(
        "Coût net du manquant", compute="_compute_amounts", store=True,
        help="Valeur du manquant excédentaire supportée par la société (déduite par le client ou réclamée par "
             "lui hors facture), moins la créance sur le chauffeur. Nul en « constat seulement ».",
    )
    shortage_claim_move_id = fields.Many2one("account.move", "Pièce de la créance sur le chauffeur", readonly=True,
                                             copy=False)

    # ─── Montants ─────────────────────────────────────────────────────────
    rate = fields.Monetary("Tarif par m³")
    revenue = fields.Monetary("Montant facturable", compute="_compute_amounts", store=True,
                              help="Prix du transport : volume livré (à défaut chargé) × tarif.")
    billed_amount = fields.Monetary("Montant facturé (HT)", compute="_compute_amounts", store=True,
                                    help="Prix du transport, moins la déduction du manquant.")
    fuel_cost = fields.Monetary("Carburant")
    toll_cost = fields.Monetary("Péages")
    driver_fees = fields.Monetary("Frais du chauffeur")
    maintenance_cost = fields.Monetary("Entretien et réparations")
    specific_taxes = fields.Monetary("Taxes spécifiques")
    other_costs = fields.Monetary("Autres frais")
    total_cost = fields.Monetary("Coût total", compute="_compute_amounts", store=True)
    margin = fields.Monetary("Marge", compute="_compute_amounts", store=True,
                             help="Montant facturable - coût net du manquant - coûts déclarés.")
    margin_rate = fields.Float("Taux de marge (%)", compute="_compute_amounts", store=True)
    note = fields.Text("Observations")
    invoice_id = fields.Many2one("account.move", "Facture", readonly=True, copy=False)

    _client_uuid_unique = models.Constraint("unique(client_uuid)", "Cette saisie a déjà été synchronisée.")

    # ─── Calculs ──────────────────────────────────────────────────────────

    @api.depends("product_id")
    def _compute_density(self):
        for rot in self:
            rot.density_15 = rot.product_id.density_15

    @api.depends("temperature_loaded", "temperature_delivered", "density_15")
    def _compute_vcf(self):
        for rot in self:
            rot.vcf_loaded = volume_correction_factor(rot.density_15, rot.temperature_loaded or None)
            rot.vcf_delivered = volume_correction_factor(rot.density_15, rot.temperature_delivered or None)

    # Seuls les champs de la rotation déclenchent le calcul : un changement ultérieur des conditions
    # du client ou du prix du produit ne réécrit pas les rotations passées.
    @api.depends("partner_id", "route_id", "product_id", "company_id")
    def _compute_shortage_terms(self):
        Tariff = self.env["eguitra.transport.tariff"]
        for rot in self:
            company = rot.company_id or self.env.company
            client = rot.partner_id.commercial_partner_id
            tariff = rot.route_id._tariff_for(rot.partner_id, rot.product_id) if rot.route_id else Tariff
            if tariff.tolerance_custom:
                rot.shortage_tolerance = tariff.shortage_tolerance
            elif client.transport_tolerance_custom:
                rot.shortage_tolerance = client.transport_shortage_tolerance
            else:
                rot.shortage_tolerance = company.transport_shortage_tolerance
            rot.shortage_rule = client.transport_shortage_rule or company.transport_shortage_rule or "none"
            rot.shortage_unit_price = tariff.shortage_price or rot.product_id.shortage_price

    @api.depends("volume_loaded", "volume_delivered", "volume_correction", "vcf_loaded", "vcf_delivered", "rate",
                 "shortage_tolerance", "shortage_rule", "shortage_unit_price", *[c for c, _l in COSTS])
    def _compute_amounts(self):
        for rot in self:
            currency = rot.currency_id or self.env.company.currency_id
            loaded, delivered = rot.volume_loaded or 0.0, rot.volume_delivered or 0.0
            rot.volume_loaded_15 = float_round(loaded * (rot.vcf_loaded or 1.0), precision_digits=3)
            rot.volume_delivered_15 = float_round(delivered * (rot.vcf_delivered or 1.0), precision_digits=3)
            if rot.volume_correction:
                base_loaded, base_delivered = rot.volume_loaded_15, rot.volume_delivered_15
            else:
                base_loaded, base_delivered = loaded, delivered
            # Sans volume livré, la livraison n'est pas encore faite : pas de manquant.
            shortage = float_round(max(0.0, base_loaded - base_delivered), precision_digits=3) if delivered else 0.0
            allowance = float_round(base_loaded * (rot.shortage_tolerance or 0.0) / 100, precision_digits=3)
            rot.shortage = shortage
            rot.shortage_tolerated = min(shortage, allowance)
            rot.shortage_excess = float_round(shortage - rot.shortage_tolerated, precision_digits=3)
            value = currency.round(rot.shortage_excess * (rot.shortage_unit_price or 0.0))
            rot.shortage_value = value
            rot.shortage_deduction = value if rot.shortage_rule in DEDUCTED else 0.0
            rot.shortage_claim = value if rot.shortage_rule in CLAIMED else 0.0
            borne = value if rot.shortage_rule in (*DEDUCTED, *CLAIMED) else 0.0
            rot.shortage_net_cost = borne - rot.shortage_claim

            billed = delivered or loaded
            rot.revenue = billed * (rot.rate or 0.0)
            rot.billed_amount = rot.revenue - rot.shortage_deduction
            rot.total_cost = sum(rot[c] or 0.0 for c, _l in COSTS)
            rot.margin = rot.revenue - rot.shortage_net_cost - rot.total_cost
            rot.margin_rate = (rot.margin / rot.revenue * 100) if rot.revenue else 0.0

    @api.depends("volume_loaded", "vehicle_id.capacity_liters")
    def _compute_over_capacity(self):
        for rot in self:
            capacity = rot.vehicle_id.capacity_liters
            rot.over_capacity = bool(capacity) and float_compare(
                (rot.volume_loaded or 0.0) * 1000, capacity, precision_digits=0) > 0

    @api.depends("product_id.code")
    def _compute_product_code(self):
        for rot in self:
            rot.product = rot.product_id.code or False

    def _label(self):
        """Désignation d'une rotation dans les messages : numéro, sinon bon de livraison et date."""
        self.ensure_one()
        if self.name and self.name != "/":
            return self.name
        bl = f", BL {self.delivery_note}" if self.delivery_note else ""
        return f"du {self.date_loading:%d/%m/%Y} ({self.vehicle_id.name}{bl})"

    # ─── Cycle de vie ─────────────────────────────────────────────────────

    @api.model_create_multi
    def create(self, vals_list):
        Product = self.env["eguitra.transport.product"]
        vals_list = [Product._resolve_vals(vals) for vals in vals_list]
        for vals in vals_list:
            if vals.get("route_id") and vals.get("partner_id") and not vals.get("rate"):
                route = self.env["eguitra.transport.route"].browse(vals["route_id"])
                partner = self.env["res.partner"].browse(vals["partner_id"])
                product = Product.browse(vals["product_id"]) if vals.get("product_id") else Product._default_product()
                vals["rate"] = route._rate_for(partner, product)
            if vals.get("vehicle_id") and not vals.get("driver_id"):
                vals["driver_id"] = self.env["eguitra.transport.vehicle"].browse(vals["vehicle_id"]).driver_id.id or False
        return super().create(vals_list)

    def write(self, vals):
        vals = self.env["eguitra.transport.product"]._resolve_vals(vals)
        locked = self.filtered(lambda r: r.state == "invoiced")
        if locked and set(vals) - {"note", "state", "invoice_id", "shortage_claim_move_id"}:
            raise UserError("Une rotation facturée ne se modifie plus ; établissez un avoir si nécessaire.")
        return super().write(vals)

    def action_validate(self):
        for rot in self:
            if rot.state != "draft":
                continue
            if not (rot.volume_loaded or rot.volume_delivered):
                raise UserError(f"Rotation {rot._label()} : volume chargé ou livré requis.")
            if not rot.rate:
                raise UserError(f"Rotation {rot._label()} : tarif manquant pour cette route et ce client.")
            if rot.over_capacity:
                raise UserError(
                    f"Rotation {rot._label()} : volume chargé de {fmt_m3(rot.volume_loaded)} supérieur à la capacité "
                    f"de la citerne {rot.vehicle_id.name} ({fmt_m3(rot.vehicle_id.capacity_liters / 1000)}). "
                    "Corrigez le volume ou la capacité de l'ensemble."
                )
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

    # ─── Facturation ──────────────────────────────────────────────────────

    @api.model
    def _activity_account(self, company):
        plan = self.env.ref("eguitra_base.analytic_plan_activite")
        Analytic = self.env["account.analytic.account"].sudo()
        account = Analytic.search([("plan_id", "=", plan.id), ("name", "=", "Transport pétrolier"),
                                   ("company_id", "in", [False, company.id])], limit=1)
        return account or Analytic.create({"name": "Transport pétrolier", "plan_id": plan.id, "company_id": company.id})

    def _analytic_distribution(self):
        """Activité transport, ensemble routier et route : chaque axe reçoit la totalité du montant."""
        self.ensure_one()
        return {
            str(self._activity_account(self.company_id).id): 100,
            str(self.vehicle_id.analytic_account_id.id): 100,
            str(self.route_id.analytic_account_id.id): 100,
        }

    def _invoice_line_vals(self, account):
        self.ensure_one()
        billed = self.volume_delivered or self.volume_loaded
        label = f"Transport {self.product_id.name.lower()} {self.route_id.name}, {fmt_m3(billed)}"
        if self.delivery_note:
            label += f", BL {self.delivery_note}"
        label += f" ({self.name}, {self.vehicle_id.name}, {self.date_loading:%d/%m/%Y})"
        return {
            "name": label,
            "quantity": billed,
            "price_unit": self.rate,
            "account_id": account.id,
            "analytic_distribution": self._analytic_distribution(),
        }

    def _shortage_line_vals(self):
        """Ligne de déduction du manquant excédentaire (montant négatif, sans TVA)."""
        self.ensure_one()
        if not self.shortage_deduction:
            return None
        tolerance = f"{self.shortage_tolerance:g}".replace(".", ",")
        price = f"{self.shortage_unit_price:,.0f}".replace(",", " ")
        bl = f", BL {self.delivery_note}" if self.delivery_note else ""
        # Quantité 1 et montant exact : la précision des quantités de facture ne tronque pas le m³.
        return {
            "name": (f"Manquant au-delà de la tolérance de {tolerance} % : {fmt_m3(self.shortage_excess)} "
                     f"à {price} {self.currency_id.name} le m³ ({self.name}{bl})"),
            "quantity": 1,
            "price_unit": -self.shortage_deduction,
            "account_id": self.company_id._transport_shortage_account().id,
            "analytic_distribution": self._analytic_distribution(),
            "tax_ids": [Command.clear()],
        }

    def _create_shortage_claims(self):
        """Créance sur le chauffeur (opération diverse en brouillon, validée par la finance) : débit du
        compte du chauffeur, crédit du compte des manquants imputé sur l'ensemble et la route. Un
        chauffeur sans fiche tiers ne reçoit pas de pièce : les contrôles du transport le signalent."""
        Move = self.env["account.move"]
        for rot in self.filtered(lambda r: r.shortage_claim and not r.shortage_claim_move_id and r.driver_id.partner_id):
            company = rot.company_id
            journal = self.env["account.journal"].search(
                [("company_id", "=", company.id), ("type", "=", "general"), ("code", "!=", OPENING_JOURNAL)],
                order="sequence, id", limit=1,
            )
            if not journal:
                raise UserError("Journal des opérations diverses introuvable pour la créance sur le chauffeur.")
            label = f"Manquant {fmt_m3(rot.shortage_excess)}, rotation {rot.name}, {rot.driver_id.name}"
            move = Move.with_company(company).create({
                "move_type": "entry",
                "journal_id": journal.id,
                "date": fields.Date.context_today(self),
                "ref": f"Manquant {rot.name}",
                "line_ids": [
                    Command.create({"name": label, "account_id": company._transport_claim_account().id,
                                    "partner_id": rot.driver_id.partner_id.id, "debit": rot.shortage_claim}),
                    Command.create({"name": label, "account_id": company._transport_shortage_account().id,
                                    "credit": rot.shortage_claim, "analytic_distribution": rot._analytic_distribution()}),
                ],
            })
            rot.shortage_claim_move_id = move

    def action_invoice(self):
        """Une facture par client, une ligne par rotation validée, la déduction du manquant
        excédentaire en dessous ; créances sur les chauffeurs en opérations diverses."""
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
                    shortage = rot._shortage_line_vals()
                    if shortage:
                        lines.append(Command.create(shortage))
                invoice = self.env["account.move"].with_company(company).create({
                    "move_type": "out_invoice",
                    "partner_id": partner.id,
                    "invoice_date": fields.Date.context_today(self),
                    "invoice_origin": ", ".join(group.mapped("name")),
                    "invoice_line_ids": lines,
                })
                group._create_shortage_claims()
                group.write({"state": "invoiced", "invoice_id": invoice.id})
                invoices |= invoice
        return invoices

    # ─── Rentabilité ──────────────────────────────────────────────────────

    @api.model
    def profitability(self, companies, date_from, date_to, group_by="vehicle"):
        """Rentabilité et manquants agrégés par ensemble routier, route, chauffeur, client ou mois."""
        fields_map = {"vehicle": "vehicle_id", "route": "route_id", "driver": "driver_id", "client": "partner_id",
                      "month": "date_loading:month"}
        groupby = fields_map.get(group_by, "vehicle_id")
        domain = [("company_id", "in", companies.ids), ("state", "in", ("done", "invoiced")),
                  ("date_loading", ">=", date_from), ("date_loading", "<=", date_to)]
        Rotation = self.sudo()
        sums = ["volume_delivered", "volume_loaded", "revenue", "billed_amount", "total_cost", "margin", "shortage",
                "shortage_excess", "shortage_value", "shortage_deduction", "shortage_claim", "shortage_net_cost"]
        groups = Rotation._read_group(
            domain, [groupby], ["__count", *[f"{f}:sum" for f in sums], *[f"{c}:sum" for c, _l in COSTS]],
        )
        excess_counts = dict(Rotation._read_group(domain + [("shortage_excess", ">", 0)], [groupby], ["__count"]))
        rows = []
        for key, count, *values in groups:
            totals = dict(zip(sums, values[:len(sums)]))
            costs = values[len(sums):]
            if group_by == "month":
                label = key.strftime("%Y-%m") if key else "?"
                key_id = label
            else:
                label = key.display_name if key else "Non renseigné"
                key_id = key.id if key else None
            revenue, margin, loaded = totals["revenue"], totals["margin"], totals["volume_loaded"]
            rows.append({
                "key": key_id, "label": label, "rotations": count,
                "volume": totals["volume_delivered"] or loaded, "volume_loaded": loaded,
                "revenue": revenue, "billed_amount": totals["billed_amount"], "cost": totals["total_cost"],
                "margin": margin, "margin_rate": (margin / revenue * 100) if revenue else None,
                "shortage": totals["shortage"], "shortage_excess": totals["shortage_excess"],
                "shortage_tolerated": totals["shortage"] - totals["shortage_excess"],
                "shortage_rate": (totals["shortage"] / loaded * 100) if loaded else None,
                "shortage_value": totals["shortage_value"], "shortage_deduction": totals["shortage_deduction"],
                "shortage_claim": totals["shortage_claim"], "shortage_net_cost": totals["shortage_net_cost"],
                "excess_rotations": excess_counts.get(key, 0),
                "costs": {c: v for (c, _l), v in zip(COSTS, costs)},
            })
        return sorted(rows, key=lambda r: r["label"] if group_by == "month" else -(r["revenue"] or 0))
