"""Données communes des tests des achats et des ventes : les deux sociétés, un catalogue fictif, des comptes
de chaque profil. Données fictives : aucun client, fournisseur ni montant réel."""

import html
import re
from datetime import timedelta

from odoo import Command, fields

from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin


class CommerceDataMixin(FinanceDataMixin):
    @classmethod
    def make_user(cls, login, *profiles, companies=None):
        companies = companies or cls.company
        user = cls.env["res.users"].with_context(no_reset_password=True).create({
            "name": login.title(), "login": login, "company_id": companies[:1].id,
            "company_ids": [(6, 0, companies.ids)],
        })
        user._eguitra_set_profiles(list(profiles))
        return user

    @classmethod
    def setup_commerce(cls):
        cls.setup_finance_data()
        env = cls.env
        cls.groupe = cls.company
        cls.cabinet = env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        (cls.groupe | cls.cabinet).sudo()._eguitra_commerce_setup()
        # Comme en production : émission des bons de commande réservée au service Achats chez EGUITRA GROUP
        # SARLU, ouverte chez MB AxisPro Consulting.
        cls.groupe.sudo().eguitra_po_issue_reserved = True
        cls.cabinet.sudo().eguitra_po_issue_reserved = False
        cls.year = fields.Date.context_today(env.user).year
        cls.unit = env.ref("uom.product_uom_unit")
        Uom = env["uom.uom"].sudo()
        cls.uom_m3 = Uom.search([("name", "=", "m³")], limit=1) or Uom.create({"name": "m³ (test)", "relative_factor": 1.0})
        Template = env["product.template"].sudo()
        cls.item_service = Template.with_company(cls.groupe).create({
            "name": "Assistance technique (test)", "type": "service", "company_id": cls.groupe.id,
            "eguitra_catalogue": True, "list_price": 500_000, "standard_price": 0.0,
            "taxes_id": [Command.set(cls.tax_sale.ids)], "supplier_taxes_id": [Command.set(cls.tax_purchase.ids)],
            "invoice_policy": "order", "purchase_method": "receive",
            "property_account_income_id": cls.acc_services.id, "property_account_expense_id": cls.acc_purchase.id,
        }).product_variant_id
        cls.item_supply = Template.with_company(cls.groupe).create({
            "name": "Gasoil au litre (test)", "type": "consu", "company_id": cls.groupe.id,
            "eguitra_catalogue": True, "list_price": 14_000, "standard_price": 12_000, "sale_ok": False,
            "taxes_id": [Command.set([])], "supplier_taxes_id": [Command.set(cls.tax_purchase.ids)],
            "invoice_policy": "order", "purchase_method": "receive",
            "property_account_expense_id": cls.acc_purchase.id,
        }).product_variant_id
        cls.generic_purchase = Template._eguitra_generic_product(cls.groupe, "purchase")
        cls.generic_sale = Template._eguitra_generic_product(cls.groupe, "sale")
        cls.planned = fields.Datetime.now() + timedelta(days=7)

    # ─── Offres ───────────────────────────────────────────────────────────

    @classmethod
    def sale_line(cls, name, qty, price, product=None, uom=None, discount=0.0, taxes=None):
        product = product or cls.generic_sale
        return Command.create({
            "product_id": product.id, "name": name, "product_uom_qty": qty, "price_unit": price,
            "product_uom_id": (uom or product.uom_id).id, "discount": discount,
            "tax_ids": [Command.set((cls.tax_sale if taxes is None else taxes).ids)],
        })

    def make_offer(self, lines=None, company=None, user=None, **values):
        company = company or self.groupe
        Order = self.env["sale.order"].with_user(user or self.env.user).sudo().with_company(company)
        return Order._eguitra_quiet().create(dict({
            "partner_id": self.customer.id, "company_id": company.id, "eguitra_object": "Travaux de démonstration",
            "order_line": lines or [self.sale_line("Prestation de démonstration", 1, 10_000_000)],
        }, **values))

    # ─── Bons de commande ─────────────────────────────────────────────────

    def po_line(self, name, qty, price, product=None, account=None, taxes=None):
        product = product or self.generic_purchase
        values = {
            "product_id": product.id, "name": name, "product_qty": qty, "price_unit": price,
            "product_uom_id": product.uom_id.id, "date_planned": self.planned,
            "tax_ids": [Command.set((self.tax_purchase if taxes is None else taxes).ids)],
        }
        if account or product == self.generic_purchase:
            values["eguitra_account_id"] = (account or self.acc_purchase).id
        return Command.create(values)

    def make_po(self, lines=None, user=None, company=None, partner=None, **values):
        company = company or self.groupe
        Order = self.env["purchase.order"].with_user(user or self.env.user).sudo().with_company(company)
        return Order._eguitra_quiet().create(dict({
            "partner_id": (partner or self.supplier).id, "company_id": company.id, "date_planned": self.planned,
            "eguitra_object": "Fournitures de démonstration",
            "order_line": lines or [self.po_line("Fournitures diverses (test)", 1, 1_000_000)],
        }, **values))

    def request_of(self, record):
        return self.env["eguitra.approval.request"].sudo().search(
            [("res_model", "=", record._name), ("res_id", "=", record.id), ("state", "!=", "cancelled")],
            order="id desc", limit=1)

    def html_of(self, report, record):
        """Texte rendu d'un document (gabarit QWeb), sans balises."""
        content, _kind = self.env["ir.actions.report"].sudo()._render_qweb_html(report, record.ids)
        text = re.sub(r"<[^>]+>", " ", content.decode("utf-8") if isinstance(content, bytes) else content)
        return re.sub(r"\s+", " ", html.unescape(text))
