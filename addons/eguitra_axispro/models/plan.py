"""Modèle financier du projet : hypothèses saisies par le cabinet et analyse par le moteur
(`engine.py`). Un modèle par dossier ; ses indicateurs alimentent la synthèse, les suggestions
d'évaluation des critères adossés à un indicateur et l'instantané des revues de comité."""

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .. import engine

PLAN_PARAMS = tuple(engine.DEFAULT_PARAMS)
LINE_KINDS = [
    ("capex", "Investissement"),
    ("revenue", "Produit"),
    ("variable", "Coût variable"),
    ("fixed", "Charge fixe"),
    ("funding", "Financement"),
]
FIXED_CATEGORIES = [
    ("external", "Services extérieurs"),
    ("personnel", "Charges de personnel"),
    ("duties", "Impôts et taxes"),
    ("other", "Autres charges"),
]
FUNDING_TYPES = [("equity", "Apport des promoteurs"), ("loan", "Emprunt"), ("grant", "Subvention")]
REPAYMENTS = [("annuity", "Annuités constantes"), ("linear", "Amortissement constant")]
LINE_FIELDS = ("kind", "name", "sequence", "amount", "quantity", "unit", "price", "unit_cost", "ramp", "growth",
               "price_growth", "rate", "year", "life", "grace", "category", "funding_type", "repayment")


class AxisproPlan(models.Model):
    _name = "axispro.plan"
    _description = "Modèle financier d'un projet"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True)
    first_year = fields.Integer("Première année d'exploitation")
    horizon = fields.Integer("Horizon (années)", default=7)
    discount_rate = fields.Float("Taux d'actualisation (%)", default=12.0)
    tax_rate = fields.Float("Impôt sur les sociétés (%)", default=25.0)
    min_tax_rate = fields.Float("Impôt minimum (% du chiffre d'affaires)", default=0.0)
    tax_holiday = fields.Integer("Années d'exonération", default=0)
    loss_carry_years = fields.Integer("Report des déficits (exercices, 0 = sans limite)", default=0)
    receivable_days = fields.Float("Crédit clients (jours)", default=30.0)
    inventory_days = fields.Float("Stocks (jours de coûts variables)", default=30.0)
    payable_days = fields.Float("Crédit fournisseurs (jours)", default=30.0)
    dscr_target = fields.Float("DSCR exigé", default=1.3)
    equity_target = fields.Float("Apport minimal exigé (%)", default=20.0)
    residual_value = fields.Boolean("Valeur résiduelle en fin d'horizon", default=True)
    notes = fields.Text("Hypothèses et sources")
    line_ids = fields.One2many("axispro.plan.line", "plan_id", "Hypothèses")

    _dossier_unique = models.Constraint("unique(dossier_id)", "Un seul modèle financier par dossier.")

    @api.constrains("horizon", "discount_rate", "tax_rate", "min_tax_rate", "dscr_target", "equity_target")
    def _check_params(self):
        for plan in self:
            if not 1 <= plan.horizon <= engine.MAX_HORIZON:
                raise ValidationError(f"L'horizon va de 1 à {engine.MAX_HORIZON} ans.")
            if not 0 <= plan.discount_rate <= 100 or not 0 <= plan.tax_rate <= 100 or not 0 <= plan.min_tax_rate <= 100:
                raise ValidationError("Les taux s'expriment en pourcentage, de 0 à 100.")
            if plan.dscr_target < 0 or not 0 <= plan.equity_target <= 100:
                raise ValidationError("Exigences de DSCR ou d'apport invalides.")

    def _inputs(self):
        self.ensure_one()
        params = {key: self[key] for key in PLAN_PARAMS}
        lines = [{key: line[key] for key in LINE_FIELDS} for line in self.line_ids]
        first_year = self.first_year or (self.dossier_id.date_start.year if self.dossier_id.date_start else None)
        return params, lines, first_year

    def analysis(self, factors=None):
        params, lines, first_year = self._inputs()
        return engine.analyse(params, lines, factors, first_year=first_year)

    def stress(self):
        params, lines, first_year = self._inputs()
        return engine.stress(params, lines, first_year=first_year)


class AxisproPlanLine(models.Model):
    _name = "axispro.plan.line"
    _description = "Hypothèse du modèle financier"
    _order = "plan_id, kind, sequence, id"

    plan_id = fields.Many2one("axispro.plan", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="plan_id.company_id", store=True)
    kind = fields.Selection(LINE_KINDS, "Nature", required=True)
    sequence = fields.Integer(default=10)
    name = fields.Char("Libellé", required=True)
    amount = fields.Float("Montant", help="Investissement : coût. Charge fixe : montant annuel. Financement : montant.")
    quantity = fields.Float("Volume annuel à pleine capacité")
    unit = fields.Char("Unité")
    price = fields.Float("Prix unitaire de vente")
    unit_cost = fields.Float("Coût variable unitaire")
    ramp = fields.Char("Montée en régime (% par année)", help="Exemple : 60;80;100")
    growth = fields.Float("Croissance annuelle (%)", help="Volumes d'un produit, montant d'une charge fixe.")
    price_growth = fields.Float("Évolution annuelle des prix (%)")
    rate = fields.Float("Taux (%)", help="Coût variable : % du chiffre d'affaires. Emprunt : taux d'intérêt annuel.")
    year = fields.Integer("Année", help="Investissement et financement : année du décaissement (0 = avant "
                                         "exploitation). Produit et charge : première année.")
    life = fields.Integer("Durée (années)", help="Amortissement, durée de l'emprunt ou reprise de la subvention.")
    grace = fields.Integer("Différé d'amortissement (années)")
    category = fields.Selection(FIXED_CATEGORIES, "Rubrique")
    funding_type = fields.Selection(FUNDING_TYPES, "Ressource")
    repayment = fields.Selection(REPAYMENTS, "Remboursement", default="annuity")

    @api.constrains("kind", "amount", "quantity", "price", "unit_cost", "rate", "year", "life", "grace", "funding_type")
    def _check_line(self):
        for line in self:
            if min(line.amount, line.quantity, line.price, line.unit_cost, line.rate) < 0 or line.year < 0:
                raise ValidationError(f"« {line.name} » : montants, volumes, taux et années sont positifs.")
            if line.kind == "variable" and line.rate > 100:
                raise ValidationError(f"« {line.name} » : un coût variable dépasse 100 % du chiffre d'affaires.")
            if line.kind == "funding" and not line.funding_type:
                raise ValidationError(f"« {line.name} » : précisez la ressource (apport, emprunt ou subvention).")
            if line.kind == "funding" and line.funding_type == "loan":
                if line.life < 1 or line.grace < 0 or line.grace >= line.life:
                    raise ValidationError(f"« {line.name} » : durée d'au moins un an et différé inférieur à la durée.")
                if line.rate > 100:
                    raise ValidationError(f"« {line.name} » : taux d'intérêt invalide.")
