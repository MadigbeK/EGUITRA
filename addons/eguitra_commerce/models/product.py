"""Catalogue des articles et des prestations, propre à chaque société (articles du noyau rattachés à la
société) : nom, unité (m³, m², ml, ensemble, forfait, heure, jour…), prix de vente, compte de produit et de
charge, TVA de vente et d'achat, activité analytique. Sans stock : une prestation est un service, un article
une fourniture « consommable » du noyau, sans mouvement de stock.

Facturation des fournisseurs sur les quantités reçues (rapprochement à trois voies) ; facturation des
clients sur les quantités commandées ou exécutées, selon la commande (sale_order.py).

Un article « hors catalogue » par société porte les lignes libres (offre rédigée sans article, bon de
commande saisi par catégorie de dépense ou depuis un engagement) : la ligne garde alors son propre compte.
"""

from odoo import api, fields, models
from odoo.exceptions import ValidationError

KINDS = [("service", "Prestation"), ("article", "Article")]
GENERIC_SALE = "Prestation hors catalogue"
GENERIC_PURCHASE = "Achat hors catalogue"


class ProductTemplate(models.Model):
    _inherit = "product.template"

    eguitra_catalogue = fields.Boolean(
        "Article du catalogue", index=True, copy=False,
        help="Article ou prestation du catalogue des achats et des ventes (Finance).")
    eguitra_generic = fields.Selection(
        [("sale", "Ventes"), ("purchase", "Achats")], "Article hors catalogue", copy=False, index=True,
        help="Article technique qui porte les lignes libres des offres et des bons de commande.")
    eguitra_activity_id = fields.Many2one(
        "account.analytic.account", "Activité", index="btree_not_null",
        help="Activité analytique imputée d'office sur les lignes de l'article (marge par activité).")

    @api.constrains("eguitra_activity_id", "company_id")
    def _check_eguitra_activity(self):
        plan = self.env.ref("eguitra_base.analytic_plan_activite", raise_if_not_found=False)
        for template in self.filtered("eguitra_activity_id"):
            activity = template.eguitra_activity_id
            if plan and activity.root_plan_id != plan:
                raise ValidationError(f"« {template.name} » : choisissez une activité de l'axe Activité.")
            if template.company_id and activity.company_id and activity.company_id != template.company_id:
                raise ValidationError(f"« {template.name} » : activité d'une autre société.")

    def _eguitra_kind(self):
        self.ensure_one()
        return "service" if self.type == "service" else "article"

    @api.model
    def _eguitra_generic_product(self, company, usage):
        """Article hors catalogue de la société pour les ventes ou les achats (créé au besoin)."""
        Template = self.sudo().with_context(active_test=False)
        template = Template.search([("eguitra_generic", "=", usage), ("company_id", "=", company.id)], limit=1)
        if not template:
            template = Template.create({
                "name": GENERIC_SALE if usage == "sale" else GENERIC_PURCHASE,
                "type": "service", "company_id": company.id, "eguitra_generic": usage,
                "sale_ok": usage == "sale", "purchase_ok": usage == "purchase",
                "invoice_policy": "order", "purchase_method": "receive",
                "list_price": 0.0, "taxes_id": [(6, 0, [])], "supplier_taxes_id": [(6, 0, [])],
            })
        elif not template.active:
            template.active = True
        return template.product_variant_id
