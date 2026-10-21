"""Retenues à la source : taxes négatives du noyau rangées dans un groupe distinct de la TVA.

Les natures et les taux ne sont pas fixés par la plateforme : ils s'arrêtent avec l'expert-comptable
et se créent à l'écran (Fiscalité > Retenues). Une retenue opérée sur un fournisseur (taxe d'achat)
réduit le montant payé au fournisseur et crédite le compte de l'État 447x ; une retenue subie sur
une vente (taxe de vente) réduit l'encaissement attendu du client et constate une créance sur
l'État. Le groupe de taxes porte la nature fiscale (TVA, retenue, autre) : la déclaration de TVA ne
lit que les groupes de TVA, une retenue n'y est jamais comptée.
"""

from odoo import Command, api, fields, models
from odoo.exceptions import UserError

WITHHOLDING_GROUP = "Retenues à la source"
TAX_KINDS = [("vat", "TVA"), ("withholding", "Retenue à la source"), ("other", "Autre taxe")]
# Comptes de TVA du SYSCOHADA : 443 (TVA facturée), 445 (TVA récupérable).
VAT_PREFIXES = ("443", "445")


class AccountTaxGroup(models.Model):
    _inherit = "account.tax.group"

    eguitra_kind = fields.Selection(TAX_KINDS, "Nature fiscale", help="TVA, retenue à la source ou autre taxe.")


class AccountTax(models.Model):
    _inherit = "account.tax"

    eguitra_withholding_nature = fields.Char(
        "Nature de la retenue", help="Nature arrêtée avec l'expert-comptable (prestations, loyers…).")
    eguitra_kind = fields.Selection(related="tax_group_id.eguitra_kind")

    @api.model
    def _eguitra_withholding_group(self, company):
        Group = self.env["account.tax.group"].sudo()
        group = Group.search([("company_id", "=", company.id), ("eguitra_kind", "=", "withholding")], limit=1)
        return group or Group.create({
            "name": WITHHOLDING_GROUP, "company_id": company.id, "eguitra_kind": "withholding", "sequence": 90,
            "country_id": company.account_fiscal_country_id.id or False,
        })

    @api.model
    def eguitra_classify_groups(self, companies=None):
        """Nature fiscale des groupes de taxes qui n'en ont pas : TVA si une de leurs taxes mouvemente
        un compte 443 ou 445, ou si le groupe s'intitule TVA ; autre sinon (idempotent)."""
        Group = self.env["account.tax.group"].sudo().with_context(active_test=False)
        domain = [("eguitra_kind", "=", False)]
        if companies:
            domain.append(("company_id", "in", companies.ids))
        for group in Group.search(domain):
            if self._eguitra_group_is_vat(group):
                group.eguitra_kind = "vat"
            else:
                group.eguitra_kind = "other"

    @api.model
    def _eguitra_group_is_vat(self, group):
        self.env.flush_all()
        self.env.cr.execute(
            """SELECT 1 FROM account_tax t
                 JOIN account_tax_repartition_line r ON r.tax_id = t.id
                 JOIN account_account aa ON aa.id = r.account_id
                WHERE t.tax_group_id = %s
                  AND (aa.code_store->>(t.company_id::text) LIKE '443%%' OR aa.code_store->>(t.company_id::text) LIKE '445%%')
                LIMIT 1""",
            (group.id,),
        )
        return bool(self.env.cr.fetchone()) or "tva" in (group.name or "").lower()

    @api.model
    def eguitra_vat_group_ids(self, companies):
        """Groupes de taxes de TVA des sociétés : nature « TVA », ou groupe non encore classé qui en a
        les comptes (groupe créé après l'installation)."""
        groups = self.env["account.tax.group"].sudo().with_context(active_test=False).search(
            [("company_id", "in", companies.ids), ("eguitra_kind", "in", ("vat", False))])
        return [g.id for g in groups if g.eguitra_kind == "vat" or self._eguitra_group_is_vat(g)]

    @api.model
    def eguitra_withholding_tax_ids(self, companies):
        return self.with_context(active_test=False).sudo().search(
            [("company_id", "in", companies.ids), ("tax_group_id.eguitra_kind", "=", "withholding")]).ids

    @api.model
    def eguitra_create_withholding(self, company, name, rate, account, nature, use="purchase"):
        """Retenue à la source : taxe de pourcentage négatif, dans le groupe des retenues, imputée au
        compte de l'État choisi (447x pour une retenue opérée)."""
        if use not in ("purchase", "sale"):
            raise UserError("Une retenue s'applique aux achats (retenue opérée) ou aux ventes (retenue subie).")
        if not 0 < rate < 100:
            raise UserError("Le taux de la retenue doit être compris entre 0 et 100 %.")
        if company not in account.company_ids:
            raise UserError("Le compte de la retenue appartient à une autre société.")
        if not (account.code or "").startswith("44"):
            raise UserError("Le compte d'une retenue est un compte de l'État (classe 44, en principe 447x).")
        if self.with_context(active_test=False).search_count([("company_id", "=", company.id), ("name", "=", name),
                                                              ("type_tax_use", "=", use)]):
            raise UserError(f"Une taxe « {name} » existe déjà dans cette société.")
        lines = [
            Command.create({"repartition_type": "base", "factor_percent": 100}),
            Command.create({"repartition_type": "tax", "factor_percent": 100, "account_id": account.id}),
        ]
        return self.create({
            "name": name,
            "amount_type": "percent",
            "amount": -abs(rate),
            "type_tax_use": use,
            "company_id": company.id,
            "tax_group_id": self._eguitra_withholding_group(company).id,
            "eguitra_withholding_nature": nature or False,
            "invoice_repartition_line_ids": [Command.clear()] + [Command.create(dict(v[2], document_type="invoice")) for v in lines],
            "refund_repartition_line_ids": [Command.clear()] + [Command.create(dict(v[2], document_type="refund")) for v in lines],
        })


class ResPartner(models.Model):
    _inherit = "res.partner"

    # Fiche commune aux deux sociétés : les retenues de chaque société s'y côtoient ; la saisie ne
    # retient que celles de la société de travail.
    eguitra_withholding_tax_ids = fields.Many2many(
        "account.tax", "eguitra_partner_withholding_rel", "partner_id", "tax_id", "Retenues à la source par défaut",
        domain=[("tax_group_id.eguitra_kind", "=", "withholding")],
        help="Appliquées d'office aux lignes de facture de ce tiers ; modifiables ligne par ligne.",
    )

    def _eguitra_default_withholdings(self, company, use):
        self.ensure_one()
        partner = self.commercial_partner_id or self
        return partner.eguitra_withholding_tax_ids.filtered(
            lambda t: t.company_id == company and t.type_tax_use == use and t.active
        )
