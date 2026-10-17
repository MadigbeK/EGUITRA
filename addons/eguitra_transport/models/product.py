"""Produits transportés : liste paramétrable par la finance, à la place de la liste figée du code.

Le code du produit (« gasoil », « essence »…) reste l'identifiant échangé avec l'application mobile
Rotations : une saisie gardée sur le téléphone avant la mise à jour part avec son code et reste
acceptée. Les produits livrés avec le module sont communs aux sociétés ; une société peut créer
les siens.
"""

from odoo import api, fields, models
from odoo.exceptions import ValidationError

DEFAULT_CODE = "gasoil"


class EguitraTransportProduct(models.Model):
    _name = "eguitra.transport.product"
    _description = "Produit transporté"
    _order = "sequence, name, id"

    name = fields.Char("Produit", required=True)
    code = fields.Char("Code", required=True, help="Identifiant court, échangé avec l'application Rotations (gasoil, essence…).")
    company_id = fields.Many2one("res.company", "Société", index=True, help="Vide : produit commun aux sociétés.")
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)

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
    def _by_code(self, code):
        """Produit d'un code, celui de la société avant le produit commun ; vide s'il est inconnu."""
        if not code:
            return self.browse()
        return self.search([("code", "=", str(code).strip().lower())], order="company_id, sequence, id", limit=1)

    @api.model
    def _default_product(self):
        return self._by_code(DEFAULT_CODE) or self.search([], limit=1)

    @api.model
    def _resolve_vals(self, vals, empty_means_all=False):
        """Accepte l'ancien code produit (« product ») à la place de product_id : API, reprise, scripts.

        empty_means_all : un code vide vaut « tous les produits » (tarif) ; sinon il est ignoré et
        le produit par défaut s'applique (rotation)."""
        if "product" not in vals:
            return vals
        vals = dict(vals)
        code = vals.pop("product")
        if code and not vals.get("product_id"):
            product = self._by_code(code)
            if not product:
                raise ValidationError(f"Produit « {code} » inconnu.")
            vals["product_id"] = product.id
        elif not code and empty_means_all:
            vals.setdefault("product_id", False)
        return vals
