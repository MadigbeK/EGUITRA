import io
import re
import zipfile
from datetime import date

from odoo import Command


class FinanceDataMixin:
    """Jeu de données comptable minimal : un client, un fournisseur, une banque, une caisse."""

    def assertMilliersGroupes(self, content):
        """Classeur Excel : montants au format « #,##0 », qu'Excel écrit avec le séparateur du poste
        (« 1 234 568 » en français) ; « # ##0 » n'est qu'une espace littérale (« 1234 568 »)."""
        self.assertTrue(content.startswith(b"PK"))
        with zipfile.ZipFile(io.BytesIO(content)) as book:
            styles = book.read("xl/styles.xml").decode()
        codes = re.findall(r'formatCode="([^"]*)"', styles)
        self.assertIn("#,##0", codes, "Montants aux milliers groupés")
        self.assertFalse([code for code in codes if "# ##" in code], codes)

    @classmethod
    def setup_finance_data(cls):
        env = cls.env
        cls.company = env.ref("base.main_company")
        cls.env = env(context=dict(env.context, allowed_company_ids=[cls.company.id]))
        env = cls.env

        def account(code):
            return env["account.account"].search([("code", "=", code), ("company_ids", "in", cls.company.ids)], limit=1)

        cls.acc_services = account("706100")
        cls.acc_purchase = account("605200")
        cls.acc_loan = account("162000")
        cls.acc_interest = account("671200")
        cls.tax_sale = env["account.tax"].search([("company_id", "=", cls.company.id), ("type_tax_use", "=", "sale"),
                                                  ("amount", "=", 18)], limit=1)
        cls.tax_purchase = env["account.tax"].search([("company_id", "=", cls.company.id),
                                                      ("type_tax_use", "=", "purchase"), ("amount", "=", 18)], limit=1)
        cls.bank = env["account.journal"].search([("company_id", "=", cls.company.id), ("type", "=", "bank")], limit=1)
        cls.cash = env["account.journal"].create({"name": "Caisse principale", "type": "cash", "code": "CAI1",
                                                  "company_id": cls.company.id})
        cls.customer = env["res.partner"].create({"name": "TOTALENERGIES MARKETING GUINEE", "customer_rank": 1})
        cls.supplier = env["res.partner"].create({"name": "STATION SHELL KALOUM", "supplier_rank": 1})
        cls.today = date.today()

    @classmethod
    def make_invoice(cls, move_type="out_invoice", amount=1_000_000_000, day=None, post=True, partner=None, due=None):
        """Facture de test. Sans condition de paiement, le noyau fixe l'échéance au jour de la saisie :
        `due` la fixe explicitement (facture ancienne échue, par exemple)."""
        sale = move_type.startswith("out_")
        move = cls.env["account.move"].create({
            "move_type": move_type,
            "partner_id": (partner or (cls.customer if sale else cls.supplier)).id,
            "invoice_date": day or cls.today,
            **({"invoice_date_due": due} if due else {}),
            "invoice_line_ids": [Command.create({
                "name": "Transport Conakry - Siguiri" if sale else "Électricité",
                "quantity": 1,
                "price_unit": amount,
                "account_id": (cls.acc_services if sale else cls.acc_purchase).id,
                "tax_ids": [Command.set((cls.tax_sale if sale else cls.tax_purchase).ids)],
            })],
        })
        if post:
            # Les tests de la finance ne portent pas sur le circuit d'approbation.
            move.with_context(eguitra_approval_granted=True).action_post()
        return move
