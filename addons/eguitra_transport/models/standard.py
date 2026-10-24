"""Coûts standard des routes et marge estimée des rotations.

Chaque route porte ses forfaits de référence pour une rotation complète (aller et retour) : litres
de carburant, prime de route du chauffeur, péages, autres frais (chargement). Le prix du litre vient
des prix du carburant de la société (prix applicable à la date de chargement). Le coût standard
d'une rotation se calcule à la saisie et se met à jour tant qu'elle n'est pas validée ; la
validation le fige : un nouveau prix du carburant ou un nouveau forfait ne réécrit pas les rotations
passées (l'ancien logiciel recalculait tout l'historique au prix du jour).

Marge estimée = montant facturable + taxes refacturées - coût net des manquants - coût standard :
le gain affiché à la saisie, avant les frais réels. La rentabilité met en regard coûts standard,
frais déclarés et pièces comptabilisées.
"""

from odoo import api, fields, models

# Champs d'une rotation dont dépend son coût standard.
STANDARD_TRIGGERS = {"route_id", "date_loading", "company_id"}
ROUTE_STANDARDS = ("std_fuel_liters", "std_driver_bonus", "std_tolls", "std_other_costs")


class EguitraTransportFuelPrice(models.Model):
    _name = "eguitra.transport.fuel.price"
    _description = "Prix du carburant de la flotte"
    _order = "date_from desc"

    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    date_from = fields.Date("Applicable à partir du", required=True)
    price = fields.Monetary("Prix du litre", required=True)
    note = fields.Char("Source", help="Par exemple : structure des prix d'octobre 2026, prix négocié du fournisseur.")

    _date_company_unique = models.Constraint("unique(company_id, date_from)", "Un prix existe déjà à cette date.")

    @api.model
    def _price_at(self, company, day):
        """Prix du litre applicable à une date ; 0 sans prix enregistré."""
        price = self.sudo().search([("company_id", "=", company.id), ("date_from", "<=", day or fields.Date.today())],
                                   order="date_from desc", limit=1)
        return price.price

    def _refresh_drafts(self, companies):
        self.env["eguitra.transport.rotation"].search(
            [("company_id", "in", companies.ids), ("state", "=", "draft")])._set_standard()

    @api.model_create_multi
    def create(self, vals_list):
        prices = super().create(vals_list)
        self._refresh_drafts(prices.company_id)
        return prices

    def write(self, vals):
        result = super().write(vals)
        self._refresh_drafts(self.company_id)
        return result

    def unlink(self):
        companies = self.company_id
        result = super().unlink()
        self._refresh_drafts(companies)
        return result


class EguitraTransportRoute(models.Model):
    _inherit = "eguitra.transport.route"

    std_fuel_liters = fields.Float("Carburant de référence (L)", digits=(10, 1),
                                   help="Litres pour une rotation complète, aller et retour.")
    std_driver_bonus = fields.Monetary("Prime de route du chauffeur", currency_field="currency_id")
    std_tolls = fields.Monetary("Péages", currency_field="currency_id")
    std_other_costs = fields.Monetary("Autres frais de route", currency_field="currency_id",
                                      help="Frais de chargement, laissez-passer et autres forfaits par rotation.")

    def _fuel_per_km(self):
        """Litres de référence par km parcouru (aller et retour) ; None sans litres ou sans distance."""
        self.ensure_one()
        km = self._round_trip_km()
        return self.std_fuel_liters / km if km and self.std_fuel_liters else None

    def write(self, vals):
        result = super().write(vals)
        if set(ROUTE_STANDARDS) & set(vals):
            self.env["eguitra.transport.rotation"].search(
                [("route_id", "in", self.ids), ("state", "=", "draft")])._set_standard()
        return result


class EguitraTransportRotation(models.Model):
    _inherit = "eguitra.transport.rotation"

    std_fuel_liters = fields.Float("Carburant de référence (L)", digits=(10, 1), readonly=True, copy=False)
    std_fuel_price = fields.Monetary("Prix du litre de référence", readonly=True, copy=False)
    std_cost = fields.Monetary("Coût standard", readonly=True, copy=False,
                               help="Forfaits de la route au prix du carburant de la date de chargement ; "
                                    "figé à la validation.")
    estimated_margin = fields.Monetary("Marge estimée", compute="_compute_estimated_margin", store=True,
                                       help="Montant facturable et taxes refacturées, moins le coût net des "
                                            "manquants et le coût standard.")

    estimated_margin_rate = fields.Float("Taux de marge estimé (%)", compute="_compute_margin_or_estimate", store=True)
    # Marge que la liste des rotations affiche et trie : l'estimation tant qu'aucun frais n'est saisi
    # (et qu'un coût standard existe), la marge des frais déclarés ensuite.
    margin_estimated = fields.Boolean("Marge estimée (aucun frais saisi)", compute="_compute_margin_or_estimate",
                                      store=True)
    margin_or_estimate = fields.Monetary("Marge (déclarée ou estimée)", compute="_compute_margin_or_estimate",
                                         store=True)
    margin_or_estimate_rate = fields.Float("Taux de marge (déclaré ou estimé, %)",
                                           compute="_compute_margin_or_estimate", store=True)
    billed_volume = fields.Float("Volume facturable (m³)", digits=(12, 3), compute="_compute_billed_volume",
                                 store=True, help="Volume livré, à défaut le volume chargé.")

    @api.depends("revenue", "taxes_rebilled", "shortage_net_cost", "std_cost")
    def _compute_estimated_margin(self):
        for rot in self:
            rot.estimated_margin = rot.revenue + rot.taxes_rebilled - rot.shortage_net_cost - rot.std_cost

    @api.depends("estimated_margin", "margin", "margin_rate", "revenue", "total_cost", "std_cost")
    def _compute_margin_or_estimate(self):
        for rot in self:
            rot.estimated_margin_rate = (rot.estimated_margin / rot.revenue * 100) if rot.revenue else 0.0
            rot.margin_estimated = not rot.total_cost and bool(rot.std_cost)
            rot.margin_or_estimate = rot.estimated_margin if rot.margin_estimated else rot.margin
            rot.margin_or_estimate_rate = rot.estimated_margin_rate if rot.margin_estimated else rot.margin_rate

    @api.depends("volume_loaded", "volume_delivered")
    def _compute_billed_volume(self):
        for rot in self:
            rot.billed_volume = rot.volume_delivered or rot.volume_loaded or 0.0

    def _standard_vals(self):
        self.ensure_one()
        route, company = self.route_id, self.company_id or self.env.company
        currency = company.currency_id
        liters = route.std_fuel_liters or 0.0
        price = self.env["eguitra.transport.fuel.price"]._price_at(company, self.date_loading) if liters else 0.0
        other = (route.std_driver_bonus or 0.0) + (route.std_tolls or 0.0) + (route.std_other_costs or 0.0)
        return {"std_fuel_liters": liters, "std_fuel_price": price, "std_cost": currency.round(liters * price + other)}

    def _set_standard(self):
        """Coût standard des rotations encore saisies (une rotation validée garde le sien)."""
        for rot in self.filtered(lambda r: r.state == "draft"):
            values = rot._standard_vals()
            if any(rot[k] != v for k, v in values.items()):
                rot.write(values)

    @api.model_create_multi
    def create(self, vals_list):
        rotations = super().create(vals_list)
        rotations._set_standard()
        return rotations

    def write(self, vals):
        result = super().write(vals)
        if STANDARD_TRIGGERS & set(vals):
            self._set_standard()
        return result

    def action_validate(self):
        # Dernier calcul avant le gel : prix et forfaits en vigueur au moment de la validation.
        self._set_standard()
        return super().action_validate()
