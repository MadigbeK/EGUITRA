"""Produits transportés : liste paramétrable par la finance, à la place de la liste figée du code.

Le code du produit (« gasoil », « essence »…) reste l'identifiant échangé avec l'application mobile
Rotations : une saisie gardée sur le téléphone avant la mise à jour part avec son code et reste
acceptée. Les produits livrés avec le module sont communs aux sociétés ; une société peut créer
les siens.

Chaque produit porte sa masse volumique à 15 °C (correction des volumes) et son prix au m³, qui
valorise les manquants au-delà de la tolérance.
"""

import math

from odoo import api, fields, models
from odoo.exceptions import ValidationError

DEFAULT_CODE = "gasoil"


def volume_correction_factor(density_15, temperature):
    """Coefficient de correction d'un volume ambiant en volume à 15 °C (VCF).

    Tables de mesure du pétrole ASTM D1250 / ISO 91-1, table 54B (produits raffinés) : coefficient
    de dilatation α15 = K0 / ρ15² + K1 / ρ15 selon la famille déduite de la masse volumique ρ15
    (kg/m³), puis VCF = exp(-α15 · Δt · (1 + 0,8 · α15 · Δt)) avec Δt = t - 15 °C. Arrondi à
    5 décimales comme sur les bons des dépôts. Sans masse volumique ou sans température : 1.
    """
    if not density_15 or density_15 <= 0 or temperature in (None, False):
        return 1.0
    rho = float(density_15)
    if rho < 770.5:  # essences
        alpha = 346.4228 / rho**2 + 0.4388 / rho
    elif rho < 787.5:  # zone de transition
        alpha = -0.00336312 + 2680.3206 / rho**2
    elif rho < 838.5:  # carburéacteurs, pétrole lampant
        alpha = 594.5418 / rho**2
    else:  # gasoils et fuels
        alpha = 186.9696 / rho**2 + 0.4862 / rho
    delta = float(temperature) - 15.0
    return round(math.exp(-alpha * delta * (1 + 0.8 * alpha * delta)), 5)


class EguitraTransportProduct(models.Model):
    _name = "eguitra.transport.product"
    _description = "Produit transporté"
    _order = "sequence, name, id"

    name = fields.Char("Produit", required=True)
    code = fields.Char("Code", required=True, help="Identifiant court, échangé avec l'application Rotations (gasoil, essence…).")
    company_id = fields.Many2one("res.company", "Société", index=True, help="Vide : produit commun aux sociétés.")
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    density_15 = fields.Float(
        "Masse volumique à 15 °C (kg/m³)", digits=(6, 1),
        help="Valeur usuelle du produit, remplacée sur la rotation par celle du bon de chargement. "
             "Vide : pas de correction des volumes à 15 °C.",
    )
    currency_id = fields.Many2one("res.currency", "Devise", required=True,
                                  default=lambda self: self.env.company.currency_id)
    shortage_price = fields.Monetary(
        "Prix de valorisation du manquant (par m³)",
        help="Valeur d'un m³ manquant au-delà de la tolérance (déduction du client, créance sur le "
             "chauffeur). Un tarif client peut fixer son propre prix.",
    )

    @api.constrains("density_15")
    def _check_density(self):
        for product in self:
            if product.density_15 and not 600 <= product.density_15 <= 1100:
                raise ValidationError("Masse volumique à 15 °C attendue en kg/m³, entre 600 et 1 100 (gasoil : 820 à 845).")

    @api.constrains("code", "company_id")
    def _check_code(self):
        for product in self:
            if not product.code or product.code != product.code.strip().lower() or " " in product.code:
                raise ValidationError("Code produit : minuscules, sans espace (par exemple « gasoil »).")
            twins = self.sudo().with_context(active_test=False).search_count([
                ("id", "!=", product.id), ("code", "=", product.code), ("company_id", "=", product.company_id.id),
            ])
            if twins:
                raise ValidationError(f"Le code produit « {product.code} » existe déjà.")

    @api.model
    def _by_code(self, code, company=None):
        """Produit d'un code pour une société (par défaut la société courante) : le sien avant le
        produit commun ; vide s'il est inconnu."""
        if not code:
            return self.browse()
        company = company or self.env.company
        products = self.search([("code", "=", str(code).strip().lower()), ("company_id", "in", [False, company.id])])
        return (products.filtered("company_id") or products)[:1]

    @api.model
    def _default_product(self):
        return self._by_code(DEFAULT_CODE) or self.search([("company_id", "in", [False, self.env.company.id])], limit=1)

    @api.model
    def _resolve_vals(self, vals, empty_means_all=False, company=None):
        """Accepte l'ancien code produit (« product ») à la place de product_id : API, reprise, scripts.

        empty_means_all : un code vide vaut « tous les produits » (tarif) ; sinon il est ignoré et
        le produit par défaut s'applique (rotation)."""
        if "product" not in vals:
            return vals
        vals = dict(vals)
        code = vals.pop("product")
        if code and not vals.get("product_id"):
            product = self._by_code(code, company)
            if not product:
                raise ValidationError(f"Produit « {code} » inconnu.")
            vals["product_id"] = product.id
        elif not code and empty_means_all:
            vals.setdefault("product_id", False)
        return vals
