"""Flotte : ensembles routiers (tracteur et citerne), chauffeurs, routes tarifées."""

from odoo import api, fields, models
from odoo.exceptions import ValidationError


def _analytic(env, plan_xmlid, name, company):
    plan = env.ref(plan_xmlid)
    account = env["account.analytic.account"].sudo().search(
        [("plan_id", "=", plan.id), ("name", "=", name), ("company_id", "in", [False, company.id])], limit=1
    )
    return account or env["account.analytic.account"].sudo().create(
        {"name": name, "plan_id": plan.id, "company_id": company.id}
    )


class EguitraTransportVehicle(models.Model):
    _name = "eguitra.transport.vehicle"
    _description = "Ensemble routier"
    _order = "name"

    name = fields.Char("Code", required=True, help="Code interne de l'ensemble, par exemple ER-01.")
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    tractor_plate = fields.Char("Immatriculation du tracteur")
    trailer_plate = fields.Char("Immatriculation de la citerne")
    brand = fields.Char("Marque et modèle")
    capacity_liters = fields.Integer("Capacité (litres)")
    driver_id = fields.Many2one("eguitra.transport.driver", "Chauffeur habituel")
    state = fields.Selection(
        [("service", "En service"), ("maintenance", "En maintenance"), ("off", "Hors service"), ("sold", "Cédé")],
        default="service", required=True,
    )
    year = fields.Integer("Année de fabrication")
    date_service = fields.Date("Mise en service")
    asset_id = fields.Many2one("account.asset", "Immobilisation", check_company=True,
                               help="Fiche d'immobilisation du tracteur et de la citerne : ses dotations entrent dans "
                                    "les charges de structure du transport.")
    analytic_account_id = fields.Many2one("account.analytic.account", "Compte analytique", readonly=True)
    active = fields.Boolean(default=True)

    _name_company_unique = models.Constraint("unique(name, company_id)", "Ce code d'ensemble existe déjà.")

    @api.constrains("year")
    def _check_year(self):
        for vehicle in self:
            if vehicle.year and not 1950 <= vehicle.year <= fields.Date.today().year + 1:
                raise ValidationError("Année de fabrication invraisemblable.")

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        for record in records:
            record.analytic_account_id = _analytic(
                self.env, "eguitra_base.analytic_plan_vehicule", record.name, record.company_id
            )
        return records


class EguitraTransportDriver(models.Model):
    _name = "eguitra.transport.driver"
    _description = "Chauffeur"
    _order = "name"

    name = fields.Char("Nom", required=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    phone = fields.Char("Téléphone")
    license_number = fields.Char("Permis")
    license_expiry = fields.Date("Validité du permis")
    partner_id = fields.Many2one("res.partner", "Fiche tiers", help="Pour le règlement des frais de mission.")
    active = fields.Boolean(default=True)


class EguitraTransportRoute(models.Model):
    _name = "eguitra.transport.route"
    _description = "Route tarifée"
    _order = "name"

    name = fields.Char("Route", required=True, help="Par exemple Conakry - Siguiri.")
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    origin = fields.Char("Départ")
    destination = fields.Char("Arrivée")
    distance_km = fields.Integer("Distance (km)", help="Aller simple.")
    distance_return_km = fields.Integer("Distance aller-retour (km)",
                                        help="Kilométrage d'une rotation complète ; vide : deux fois l'aller.")
    duration_days = fields.Float("Durée standard (jours)", digits=(5, 1),
                                 help="Durée habituelle d'une rotation, départ et retour au dépôt.")
    default_rate = fields.Monetary("Tarif par m³", currency_field="currency_id")
    currency_id = fields.Many2one(related="company_id.currency_id")
    tariff_ids = fields.One2many("eguitra.transport.tariff", "route_id", "Tarifs par client")
    analytic_account_id = fields.Many2one("account.analytic.account", "Compte analytique", readonly=True)
    active = fields.Boolean(default=True)

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        for record in records:
            record.analytic_account_id = _analytic(
                self.env, "eguitra_base.analytic_plan_route", record.name, record.company_id
            )
        return records

    def _round_trip_km(self):
        self.ensure_one()
        return self.distance_return_km or 2 * (self.distance_km or 0)

    def _round_trip_inconsistent(self, threshold=0.15):
        """Aller-retour saisi qui s'écarte de plus de 15 % du double de l'aller."""
        self.ensure_one()
        if not (self.distance_km and self.distance_return_km):
            return False
        expected = 2 * self.distance_km
        return abs(self.distance_return_km - expected) > threshold * expected

    def _tariff_for(self, partner, product):
        """Tarif négocié du client pour le produit, sinon pour tous les produits ; vide à défaut."""
        self.ensure_one()
        tariffs = self.tariff_ids.filtered(lambda t: t.partner_id == partner)
        return tariffs.filtered(lambda t: t.product_id == product)[:1] or tariffs.filtered(lambda t: not t.product_id)[:1]

    def _rate_for(self, partner, product):
        """Tarif au m³ : tarif du client pour le produit, sinon du client, sinon tarif de la route."""
        tariff = self._tariff_for(partner, product)
        return tariff.rate if tariff else self.default_rate


class EguitraTransportTariff(models.Model):
    _name = "eguitra.transport.tariff"
    _description = "Tarif de transport par client"

    route_id = fields.Many2one("eguitra.transport.route", required=True, ondelete="cascade", index=True)
    partner_id = fields.Many2one("res.partner", "Client", required=True)
    product_id = fields.Many2one("eguitra.transport.product", "Produit", ondelete="restrict",
                                 help="Vide : tous les produits.")
    product = fields.Char("Code produit", compute="_compute_product_code")
    rate = fields.Monetary("Tarif par m³", currency_field="currency_id", required=True)
    currency_id = fields.Many2one(related="route_id.currency_id")
    tolerance_custom = fields.Boolean("Tolérance de manquant propre au tarif")
    shortage_tolerance = fields.Float("Tolérance de manquant (%)", digits=(5, 3))
    shortage_price = fields.Monetary(
        "Prix de valorisation du manquant (par m³)", currency_field="currency_id",
        help="Prix contractuel du m³ manquant pour ce client ; vide : prix du produit.",
    )

    @api.depends("product_id.code")
    def _compute_product_code(self):
        for tariff in self:
            tariff.product = tariff.product_id.code or False

    @api.model_create_multi
    def create(self, vals_list):
        Product = self.env["eguitra.transport.product"]
        return super().create([Product._resolve_vals(vals, empty_means_all=True) for vals in vals_list])

    def write(self, vals):
        return super().write(self.env["eguitra.transport.product"]._resolve_vals(vals, empty_means_all=True))
