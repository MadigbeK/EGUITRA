"""Immobilier : biens, baux, loyers par contrats récurrents, quittances, relances, patrimoine.

Un bail actif porte un contrat récurrent (module OCA contract) qui produit les factures de loyer
à chaque échéance ; ces factures sont validées automatiquement (quittancement) et imputées sur
l'axe du bien et l'activité immobilière. Le produit « Loyer » porte le compte 7073 « Loyers ».
"""

import logging

from dateutil.relativedelta import relativedelta

from odoo import Command, api, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

KINDS = [
    ("appartement", "Appartement"),
    ("villa", "Villa"),
    ("bureau", "Bureau"),
    ("magasin", "Magasin"),
    ("entrepot", "Entrepôt"),
    ("terrain", "Terrain"),
    ("immeuble", "Immeuble"),
]


class EguitraProperty(models.Model):
    _name = "eguitra.property"
    _description = "Bien immobilier"
    _order = "name"

    name = fields.Char("Bien", required=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    kind = fields.Selection(KINDS, "Nature", required=True, default="appartement")
    address = fields.Char("Adresse")
    city = fields.Char("Ville", default="Conakry")
    area_m2 = fields.Float("Surface (m²)")
    acquisition_date = fields.Date("Acquisition")
    acquisition_value = fields.Monetary("Valeur d'acquisition")
    current_value = fields.Monetary("Valeur actuelle")
    valuation_date = fields.Date("Date d'évaluation")
    analytic_account_id = fields.Many2one("account.analytic.account", "Compte analytique", readonly=True)
    lease_ids = fields.One2many("eguitra.lease", "property_id", "Baux")
    occupied = fields.Boolean("Loué", compute="_compute_occupied")
    active = fields.Boolean(default=True)
    note = fields.Text("Observations")

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        plan = self.env.ref("eguitra_base.analytic_plan_bien")
        for record in records:
            record.analytic_account_id = self.env["account.analytic.account"].sudo().create(
                {"name": record.name, "plan_id": plan.id, "company_id": record.company_id.id}
            )
        return records

    @api.depends("lease_ids.state")
    def _compute_occupied(self):
        for prop in self:
            prop.occupied = any(l.state == "active" for l in prop.lease_ids)


class EguitraLease(models.Model):
    _name = "eguitra.lease"
    _description = "Bail"
    _order = "date_start desc, id desc"

    name = fields.Char("Référence", required=True)
    property_id = fields.Many2one("eguitra.property", "Bien", required=True, index=True)
    company_id = fields.Many2one(related="property_id.company_id", store=True)
    currency_id = fields.Many2one(related="property_id.currency_id")
    partner_id = fields.Many2one("res.partner", "Locataire", required=True)
    date_start = fields.Date("Prise d'effet", required=True)
    date_end = fields.Date("Échéance du bail")
    rent = fields.Monetary("Loyer HT par période", required=True)
    charges = fields.Monetary("Charges par période")
    periodicity = fields.Selection([("monthly", "Mensuel"), ("quarterly", "Trimestriel"), ("yearly", "Annuel")],
                                   default="monthly", required=True)
    vat = fields.Boolean("Soumis à la TVA", help="Bail commercial ou professionnel soumis à la TVA.")
    deposit_amount = fields.Monetary("Dépôt de garantie")
    state = fields.Selection([("draft", "Brouillon"), ("active", "En cours"), ("terminated", "Résilié")],
                             default="draft", required=True)
    contract_id = fields.Many2one("contract.contract", "Contrat récurrent", readonly=True, copy=False)
    next_invoice_date = fields.Date(related="contract_id.recurring_next_date", string="Prochain loyer")

    @api.model
    def _rent_product(self, company, vat):
        """Produit « Loyer » (assujetti ou exonéré) imputé au compte 7073 de la société."""
        name = "Loyer (TVA)" if vat else "Loyer (exonéré)"
        Product = self.env["product.product"].sudo().with_company(company)
        product = Product.search([("name", "=", name), ("company_id", "in", [False, company.id])], limit=1)
        if not product:
            product = Product.create({"name": name, "type": "service", "sale_ok": True, "purchase_ok": False,
                                      "company_id": company.id})
        income = self.env["account.account"].sudo().search(
            [("code", "=like", "7073%"), ("company_ids", "in", company.ids)], limit=1
        )
        template = product.product_tmpl_id.with_company(company)
        values = {"taxes_id": [Command.set(company.account_sale_tax_id.ids if vat else [])]}
        if income:
            values["property_account_income_id"] = income.id
        template.write(values)
        return product

    @api.model
    def _activity_account(self, company):
        plan = self.env.ref("eguitra_base.analytic_plan_activite")
        Analytic = self.env["account.analytic.account"].sudo()
        account = Analytic.search([("plan_id", "=", plan.id), ("name", "=", "Immobilier"),
                                   ("company_id", "in", [False, company.id])], limit=1)
        return account or Analytic.create({"name": "Immobilier", "plan_id": plan.id, "company_id": company.id})

    def action_activate(self):
        for lease in self:
            if lease.state != "draft":
                continue
            if lease.property_id.lease_ids.filtered(lambda l: l.state == "active" and l != lease):
                raise UserError(f"Le bien {lease.property_id.name} a déjà un bail en cours.")
            company = lease.company_id
            journal = self.env["account.journal"].search([("company_id", "=", company.id), ("type", "=", "sale")], limit=1)
            product = self._rent_product(company, lease.vat)
            distribution = {str(lease.property_id.analytic_account_id.id): 100,
                            str(self._activity_account(company).id): 100}
            period = {"monthly": "mensuel", "quarterly": "trimestriel", "yearly": "annuel"}[lease.periodicity]
            # La récurrence est portée par chaque ligne, à partir de la prise d'effet du bail.
            recurrence = {
                "date_start": lease.date_start, "date_end": lease.date_end or False,
                "recurring_next_date": lease.date_start, "recurring_rule_type": lease.periodicity,
                "recurring_interval": 1, "recurring_invoicing_type": "pre-paid",
                "analytic_distribution": distribution, "quantity": 1, "product_id": product.id,
            }
            lines = [Command.create(dict(recurrence, name=f"Loyer {period} - {lease.property_id.name} - #START# au #END#",
                                         price_unit=lease.rent))]
            if lease.charges:
                lines.append(Command.create(dict(
                    recurrence, name=f"Charges locatives - {lease.property_id.name} - #START# au #END#",
                    price_unit=lease.charges,
                )))
            contract = self.env["contract.contract"].sudo().create({
                "name": f"Bail {lease.name} - {lease.property_id.name}",
                "partner_id": lease.partner_id.id,
                "contract_type": "sale",
                "company_id": company.id,
                "journal_id": journal.id,
                "line_recurrence": False,
                "recurring_rule_type": lease.periodicity,
                "recurring_interval": 1,
                "recurring_invoicing_type": "pre-paid",
                "date_start": lease.date_start,
                "date_end": lease.date_end or False,
                "contract_line_fixed_ids": lines,
            })
            lease.write({"state": "active", "contract_id": contract.id})
        return True

    def action_terminate(self, date=None):
        for lease in self:
            if lease.state != "active":
                raise UserError("Seul un bail en cours peut être résilié.")
            end = date or fields.Date.context_today(self)
            if lease.contract_id:
                lease.contract_id.sudo().write({"date_end": end})
            lease.write({"state": "terminated", "date_end": end})
        return True

    @api.model
    def generate_rents(self, companies, until=None):
        """Factures de loyer échues (rattrapage compris), validées aussitôt : c'est le quittancement."""
        until = until or fields.Date.context_today(self)
        leases = self.search([("state", "=", "active"), ("company_id", "in", companies.ids)])
        invoices = self.env["account.move"]
        for lease in leases:
            invoices |= lease._generate_rents(until)
        return invoices

    def _generate_rents(self, until):
        """Une facture par échéance passée, datée de l'échéance ; 36 au plus par passage."""
        self.ensure_one()
        contract = self.contract_id.sudo().with_company(self.company_id)
        invoices = self.env["account.move"]
        for _ in range(36):
            if not contract.recurring_next_date or contract.recurring_next_date > until:
                break
            created = contract._recurring_create_invoice()
            if not created:
                break  # bail échu ou sans ligne à facturer
            invoices |= created
        invoices.filtered(lambda m: m.state == "draft").action_post()
        return invoices

    @api.model
    def _disable_contract_cron(self):
        """Désactive la génération du module contract, remplacée par le quittancement (data/ir_cron.xml)."""
        cron = self.env.ref("contract.contract_cron_for_invoice", raise_if_not_found=False)
        if cron and cron.active:
            cron.sudo().active = False

    @api.model
    def _cron_generate_rents(self):
        """Quittancement de chaque nuit, toutes sociétés. Remplace la génération du module contract,
        qui laisserait des brouillons datés du jour, sans rattrapage. Un bail en erreur est journalisé
        sans bloquer les autres."""
        for lease in self.search([("state", "=", "active")]):
            try:
                with self.env.cr.savepoint():
                    lease._generate_rents(fields.Date.context_today(lease))
            except Exception:
                _logger.exception("Quittancement impossible pour le bail %s (id %s)", lease.name, lease.id)

    @api.model
    def unpaid_rents(self, companies, today=None):
        today = today or fields.Date.context_today(self)
        contracts = self.search([("company_id", "in", companies.ids), ("contract_id", "!=", False)]).contract_id
        lines = self.env["account.move.line"].sudo().search([
            ("contract_line_id.contract_id", "in", contracts.ids),
        ])
        moves = lines.move_id.filtered(
            lambda m: m.state == "posted" and m.payment_state in ("not_paid", "partial") and m.invoice_date_due
            and m.invoice_date_due < today
        )
        return moves.sorted("invoice_date_due")

    @api.model
    def summary(self, companies, today=None):
        today = today or fields.Date.context_today(self)
        props = self.env["eguitra.property"].search([("company_id", "in", companies.ids)])
        active = self.search([("state", "=", "active"), ("company_id", "in", companies.ids)])
        factor = {"monthly": 12, "quarterly": 4, "yearly": 1}
        annual_rent = sum((l.rent + (l.charges or 0)) * factor[l.periodicity] for l in active)
        value = sum(props.mapped("current_value")) or sum(props.mapped("acquisition_value"))
        unpaid = self.unpaid_rents(companies, today)
        expiring = active.filtered(lambda l: l.date_end and l.date_end <= today + relativedelta(months=3))
        return {
            "properties": len(props),
            "occupied": len(props.filtered("occupied")),
            "occupancy_rate": (len(props.filtered("occupied")) / len(props) * 100) if props else None,
            "annual_rent": annual_rent,
            "portfolio_value": value,
            "gross_yield": (annual_rent / value * 100) if value else None,
            "unpaid_count": len(unpaid),
            "unpaid_amount": sum(unpaid.mapped("amount_residual")),
            "leases_expiring_3m": len(expiring),
            "as_of": today,
        }
