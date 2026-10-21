from xml.etree import ElementTree

from odoo import Command
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin

NS = {"s": "urn:OECD:StandardAuditFile-Tax:2.00"}


@tagged("post_install", "-at_install")
class TestSaft(FinanceDataMixin, ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("auditeur.fin", "finance")
        cls.customer.vat = "DEMO-NIF-CLIENT"

    def test_fichier_saft(self):
        token = self.open_session("auditeur.fin")["access_token"]
        invoice = self.make_invoice("out_invoice", 100_000_000)
        bill = self.make_invoice("in_invoice", 30_000_000)
        opening = self.today.replace(month=1, day=1)
        an = self.env["account.journal"].search([("company_id", "=", self.company.id), ("code", "=", "AN")], limit=1)
        an = an or self.env["account.journal"].create({"name": "À-nouveaux", "code": "AN", "type": "general",
                                                       "company_id": self.company.id})
        capital = self.env["account.account"].search([("code", "=like", "101%"), ("company_ids", "in", self.company.ids)],
                                                     limit=1)
        self.env["account.move"].create({
            "move_type": "entry", "journal_id": an.id, "date": opening, "ref": "Ouverture DEMO",
            "line_ids": [Command.create({"name": "Banque", "account_id": self.bank.default_account_id.id, "debit": 75_000_000}),
                         Command.create({"name": "Capital", "account_id": capital.id, "credit": 75_000_000})],
        }).action_post()

        response = self.url_open(f"/api/v1/finance/exports/saft?date_from={opening.isoformat()}&date_to={self.today.isoformat()}",
                                 headers={"Authorization": f"Bearer {token}"}, timeout=120)
        self.assertEqual(response.status_code, 200, response.text[:500])
        self.assertNotIn("X-Eguitra-Warning", response.headers, "Période équilibrée")
        root = ElementTree.fromstring(response.content)
        self.assertEqual(root.find("s:Header/s:AuditFileCountry", NS).text, "GN")
        self.assertEqual(root.find("s:Header/s:DefaultCurrencyCode", NS).text, self.company.currency_id.name)
        entries = root.find("s:GeneralLedgerEntries", NS)
        self.assertEqual(int(entries.find("s:NumberOfEntries", NS).text), 2, "Les à-nouveaux restent dans les soldes d'ouverture")
        self.assertEqual(entries.find("s:TotalDebit", NS).text, entries.find("s:TotalCredit", NS).text)
        names = {t.find("s:TransactionID", NS).text for t in entries.iter(f"{{{NS['s']}}}Transaction")}
        self.assertEqual(names, {invoice.name, bill.name})
        bank = next(a for a in root.iter(f"{{{NS['s']}}}Account")
                    if a.find("s:AccountID", NS).text == self.bank.default_account_id.code)
        self.assertEqual(float(bank.find("s:OpeningDebitBalance", NS).text), 75_000_000, "Vrai solde d'ouverture")
        customer = next(c for c in root.iter(f"{{{NS['s']}}}Customer")
                        if c.find("s:CustomerID", NS).text == str(self.customer.id))
        self.assertEqual(customer.find("s:TaxRegistration/s:TaxRegistrationNumber", NS).text, "DEMO-NIF-CLIENT")
        self.assertTrue(customer.find("s:AccountID", NS).text.startswith("41"), "Compte client réel")
        types = {e.find("s:TaxType", NS).text for e in root.iter(f"{{{NS['s']}}}TaxTableEntry")}
        self.assertIn("TVA", types)

        status, body = self.call("GET", "/finance/exports/saft?scope=group", token=token)
        self.assertEqual(status, 422, "Une seule société par fichier")
