"""Catégories de dépense : la table qui pilote l'imputation comptable des achats (offre, chapitre 3.3 ;
prototype de la direction). Le comptable choisit une catégorie, la plateforme en déduit le compte de
charge ou d'immobilisation, la TVA et le compte de tiers :

- compte de tiers fournisseur (ou vide) : pièce d'achat ordinaire ;
- compte de tiers d'une autre nature (personnel 42, organismes sociaux 43, État 44…) : la dépense
  devient une opération diverse (charge au débit, ce compte au crédit), sans TVA ;
- catégorie d'investissement (CAPEX) : la ligne porte une catégorie d'immobilisation et l'immobilisation
  est créée à la validation de la pièce.
"""

from odoo import api, fields, models
from odoo.exceptions import ValidationError

NATURES = [
    ("opex_transport", "Charges d'exploitation du transport"),
    ("opex_metier", "Charges d'exploitation des autres métiers"),
    ("personnel", "Personnel"),
    ("frais_generaux", "Frais généraux"),
    ("impots", "Impôts et taxes"),
    ("financier", "Charges financières"),
    ("capex", "Investissement (CAPEX)"),
]

# Catégories usuelles proposées à la demande de la finance (bouton de l'écran), créées seulement si
# un compte du plan de la société commence par l'un des préfixes : (libellé, nature, préfixes du
# compte de charge, préfixe du compte de tiers, TVA déductible).
DEFAULT_CATEGORIES = [
    ("Carburant et lubrifiants", "opex_transport", ("6053", "6042", "605"), None, True),
    ("Entretien et réparation des véhicules", "opex_transport", ("6242", "624"), None, True),
    ("Pièces de rechange et pneumatiques", "opex_transport", ("6044", "604"), None, True),
    ("Assurances", "frais_generaux", ("625",), None, False),
    ("Loyers et charges locatives", "frais_generaux", ("622",), None, True),
    ("Eau et électricité", "frais_generaux", ("6052", "6051", "605"), None, True),
    ("Fournitures de bureau", "frais_generaux", ("6055", "6047"), None, True),
    ("Télécommunications", "frais_generaux", ("628",), None, True),
    ("Honoraires", "frais_generaux", ("6324", "632"), None, True),
    ("Frais bancaires", "financier", ("631",), None, False),
    ("Salaires", "personnel", ("6611", "661"), "422", False),
    ("Charges sociales", "personnel", ("664",), "431", False),
    ("Impôts et taxes", "impots", ("64",), "447", False),
]


class EguitraExpenseCategory(models.Model):
    _name = "eguitra.expense.category"
    _description = "Catégorie de dépense"
    _order = "company_id, sequence, name"

    company_id = fields.Many2one("res.company", "Société", required=True, default=lambda self: self.env.company, index=True)
    sequence = fields.Integer(default=10)
    name = fields.Char("Catégorie", required=True)
    nature = fields.Selection(NATURES, required=True, default="frais_generaux")
    account_id = fields.Many2one("account.account", "Compte de charge ou d'immobilisation", required=True)
    partner_account_id = fields.Many2one(
        "account.account", "Compte de tiers",
        help="Vide : compte fournisseur du tiers. Un compte d'une autre nature (42, 43, 44…) fait de la dépense "
             "une opération diverse.",
    )
    tax_mode = fields.Selection([("deductible", "TVA déductible"), ("none", "Sans TVA")], "TVA", required=True,
                                default="deductible")
    tax_id = fields.Many2one("account.tax", "Taxe", help="Vide : taxe d'achat par défaut de la société.")
    asset_profile_id = fields.Many2one("account.asset.profile", "Catégorie d'immobilisation")
    active = fields.Boolean(default=True)

    _name_company_unique = models.Constraint("unique(company_id, name)", "Une catégorie de ce nom existe déjà.")

    def _code(self, account):
        return account.with_company(self.company_id).code or ""

    def is_entry(self):
        """Compte de tiers d'une autre nature que fournisseur : la dépense se passe en opération diverse."""
        self.ensure_one()
        return bool(self.partner_account_id) and self.partner_account_id.account_type != "liability_payable"

    @api.constrains("account_id", "partner_account_id", "tax_mode", "tax_id", "nature", "asset_profile_id", "company_id")
    def _check_category(self):
        for category in self:
            company = category.company_id
            for account in (category.account_id, category.partner_account_id):
                if account and company not in account.company_ids:
                    raise ValidationError(f"« {category.name} » : compte absent du plan de comptes de la société.")
            code = category._code(category.account_id)
            if category.nature == "capex":
                if not code.startswith("2"):
                    raise ValidationError(f"« {category.name} » : un investissement s'impute sur un compte de la classe 2.")
                if not category.asset_profile_id:
                    raise ValidationError(f"« {category.name} » : choisissez la catégorie d'immobilisation.")
                if category.asset_profile_id.company_id and category.asset_profile_id.company_id != company:
                    raise ValidationError(f"« {category.name} » : catégorie d'immobilisation d'une autre société.")
            elif not code.startswith("6"):
                raise ValidationError(f"« {category.name} » : une dépense s'impute sur un compte de la classe 6.")
            if category.tax_id and (category.tax_id.company_id != company or category.tax_id.type_tax_use != "purchase"):
                raise ValidationError(f"« {category.name} » : choisissez une taxe d'achat de la société.")
            if category.is_entry():
                if category.tax_mode != "none":
                    raise ValidationError(f"« {category.name} » : une dépense passée en opération diverse (compte "
                                          f"{category._code(category.partner_account_id)}) est sans TVA.")
                if category.nature == "capex":
                    raise ValidationError(f"« {category.name} » : un investissement se facture par un fournisseur.")

    def taxes(self, default_tax):
        """Taxes de la ligne : aucune, celle de la catégorie ou la taxe d'achat par défaut."""
        self.ensure_one()
        if self.tax_mode == "none":
            return self.env["account.tax"]
        return self.tax_id or default_tax

    @api.model
    def create_defaults(self, company):
        """Catégories usuelles pour la société (celles dont les comptes existent), sans doublon."""
        Account = self.env["account.account"]
        existing = set(self.with_context(active_test=False).search([("company_id", "=", company.id)]).mapped("name"))
        created = self.browse()

        def find(prefixes):
            for prefix in prefixes:
                account = Account.search([("code", "=like", prefix + "%"), ("company_ids", "in", company.ids)],
                                         order="code", limit=1)
                if account:
                    return account
            return Account

        for sequence, (name, nature, prefixes, partner_prefix, deductible) in enumerate(DEFAULT_CATEGORIES, start=1):
            if name in existing:
                continue
            account = find(prefixes)
            partner_account = find((partner_prefix,)) if partner_prefix else Account
            if not account or (partner_prefix and not partner_account):
                continue
            created |= self.create({
                "company_id": company.id, "sequence": sequence * 10, "name": name, "nature": nature,
                "account_id": account.id, "partner_account_id": partner_account.id or False,
                "tax_mode": "deductible" if deductible and not partner_prefix else "none",
            })
        return created


class AccountMoveLine(models.Model):
    _inherit = "account.move.line"

    eguitra_expense_category_id = fields.Many2one("eguitra.expense.category", "Catégorie de dépense",
                                                  index="btree_not_null", copy=True)
