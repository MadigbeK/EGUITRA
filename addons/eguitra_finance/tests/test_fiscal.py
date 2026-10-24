import io

from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin

PDF = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"


@tagged("post_install", "-at_install")
class TestFiscalApi(FinanceDataMixin, ApiCase):
    """Retenues à la source configurables, déclaration de TVA limitée à la TVA, déclaration des
    retenues, exports, historique des déclarations."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("mariama", "finance")
        cls._create_user("dg.fiscal", "direction")
        cls.supplier.vat = "DEMO-NIF-001"
        account = cls.env["account.account"].search(
            [("code", "=like", "447%"), ("company_ids", "in", cls.company.ids)], limit=1, order="code")
        cls.acc_withholding = account or cls.env["account.account"].create({
            "code": "447900", "name": "État, retenues à la source (test)", "account_type": "liability_current",
            "company_ids": [(6, 0, cls.company.ids)],
        })

    def setUp(self):
        super().setUp()
        self.token = self.open_session("mariama")["access_token"]

    def _withholding(self, rate=5, name="Retenue DEMO sur prestations"):
        status, tax = self.call("POST", "/finance/fiscal/withholding-taxes", {
            "name": name, "rate": rate, "account_id": self.acc_withholding.id, "nature": "Prestations de services (DEMO)",
        }, token=self.token)
        self.assertEqual(status, 200, tax)
        return tax

    def _bill(self, lines):
        status, move = self.call("POST", "/finance/moves", {
            "move_type": "in_invoice", "partner_id": self.supplier.id, "invoice_date": self.today.isoformat(),
            "lines": lines,
        }, token=self.token)
        self.assertEqual(status, 200, move)
        return self.env["account.move"].browse(move["id"])

    def test_retenue_creee_hors_tva(self):
        tax = self._withholding()
        record = self.env["account.tax"].browse(tax["id"])
        self.assertEqual(record.amount, -5, "Taxe du noyau à taux négatif")
        self.assertEqual(record.tax_group_id.eguitra_kind, "withholding")
        self.assertNotIn(record.tax_group_id.id, self.env["account.tax"].eguitra_vat_group_ids(self.company),
                         "Groupe distinct de la TVA")
        self.assertIn(self.tax_purchase.tax_group_id.id, self.env["account.tax"].eguitra_vat_group_ids(self.company))
        status, body = self.call("POST", "/finance/fiscal/withholding-taxes", {
            "name": "Retenue sur un mauvais compte", "rate": 5, "account_id": self.acc_purchase.id,
        }, token=self.token)
        self.assertEqual(status, 422, "Compte de l'État exigé")
        status, _b = self.call("POST", "/finance/fiscal/withholding-taxes", {
            "name": "Interdit", "rate": 5, "account_id": self.acc_withholding.id,
        }, token=self.open_session("dg.fiscal")["access_token"])
        self.assertEqual(status, 403, "Paramétrage réservé à la finance et à l'administration")

    def test_retenue_par_defaut_du_tiers_et_par_ligne(self):
        tax = self._withholding()
        status, body = self.call("PUT", f"/finance/fiscal/withholding-partners/{self.supplier.id}",
                                 {"tax_ids": [tax["id"]]}, token=self.token)
        self.assertEqual(status, 200, body)
        status, taxes = self.call("GET", f"/finance/taxes?use=purchase&partner_id={self.supplier.id}", token=self.token)
        self.assertTrue(next(t for t in taxes if t["id"] == tax["id"])["partner_default"])

        bill = self._bill([{"name": "Maintenance DEMO", "price_unit": 100_000_000, "account_id": self.acc_purchase.id}])
        line = bill.invoice_line_ids
        self.assertEqual(set(line.tax_ids.ids), {self.company.account_purchase_tax_id.id, tax["id"]},
                         "TVA par défaut et retenue du tiers")
        self.assertAlmostEqual(bill.amount_total, 113_000_000, delta=1, msg="100 + 18 % de TVA - 5 % de retenue")

        bill2 = self._bill([{"name": "Pièces DEMO", "price_unit": 50_000_000, "account_id": self.acc_purchase.id,
                             "withholding_tax_ids": []}])
        self.assertNotIn(tax["id"], bill2.invoice_line_ids.tax_ids.ids, "Retenue retirée sur la ligne")
        status, body = self.call("POST", "/finance/moves", {
            "move_type": "out_invoice", "partner_id": self.customer.id,
            "lines": [{"name": "Transport", "price_unit": 1_000, "withholding_tax_ids": [tax["id"]]}],
        }, token=self.token)
        self.assertEqual(status, 422, "Une retenue d'achat ne s'applique pas à une vente")

    def test_declarations_tva_et_retenues(self):
        tax = self._withholding()
        bill = self._bill([{"name": "Maintenance DEMO", "price_unit": 100_000_000, "account_id": self.acc_purchase.id,
                            "withholding_tax_ids": [tax["id"]]}])
        bill.with_context(eguitra_approval_granted=True).action_post()
        self.make_invoice("out_invoice", 200_000_000)
        period = f"year={self.today.year}&month={self.today.month}"

        status, vat = self.call("GET", f"/finance/fiscal/vat?{period}", token=self.token)
        self.assertEqual(status, 200, vat)
        self.assertEqual(vat["vat_deductible"], 18_000_000, "La retenue n'est jamais comptée en TVA déductible")
        self.assertEqual(vat["base_purchases"], 100_000_000)
        self.assertEqual(vat["vat_collected"], 36_000_000)
        self.assertEqual(vat["vat_due"], 18_000_000)
        self.assertFalse([t for t in vat["taxes"] if t["tax_id"] == tax["id"]])

        status, wht = self.call("GET", f"/finance/fiscal/withholding?{period}", token=self.token)
        self.assertEqual(status, 200, wht)
        self.assertEqual(wht["total_operated"], 5_000_000)
        self.assertEqual(wht["base_total"], 100_000_000)
        row = wht["by_partner"][0]
        self.assertEqual((row["partner_id"], row["vat_number"], row["rate"]), (self.supplier.id, "DEMO-NIF-001", 5))
        self.assertEqual(wht["by_nature"][0]["nature"], "Prestations de services (DEMO)")

        headers = {"Authorization": f"Bearer {self.token}"}
        for path in ("/finance/fiscal/vat/export", "/finance/fiscal/withholding/export"):
            response = self.url_open(f"/api/v1{path}?{period}&format=xlsx", headers=headers, timeout=60)
            self.assertEqual(response.status_code, 200, response.text[:300])
            self.assertMilliersGroupes(response.content)
        response = self.url_open(f"/api/v1/finance/fiscal/withholding/export?{period}&format=csv", headers=headers,
                                 timeout=60)
        text = response.content.decode("utf-8-sig")
        self.assertIn("DEMO-NIF-001", text, "Annexe avec le NIF du tiers")
        self.assertIn(bill.name, text)
        response = self.url_open(f"/api/v1/finance/fiscal/vat/export?{period}&format=csv&part=declaration",
                                 headers=headers, timeout=60)
        self.assertIn("TVA à payer", response.content.decode("utf-8-sig"))

    def test_historique_des_declarations(self):
        self.make_invoice("out_invoice", 100_000_000)
        month = self.today.replace(day=1).isoformat()
        status, record = self.call("POST", "/finance/fiscal/returns", {"kind": "vat", "period": month}, token=self.token)
        self.assertEqual(status, 200, record)
        self.assertEqual((record["state"], record["amount_due"]), ("prepared", 18_000_000))
        status, again = self.call("POST", "/finance/fiscal/returns", {"kind": "vat", "period": month}, token=self.token)
        self.assertEqual(again["id"], record["id"], "Une déclaration par mois et par nature, recalculée")

        status, body = self.call("POST", f"/finance/fiscal/returns/{record['id']}/pay", {"reference": "Q-1"},
                                 token=self.token)
        self.assertEqual(status, 422, "Payée seulement après dépôt")
        status, body = self.call("POST", f"/finance/fiscal/returns/{record['id']}/file", {}, token=self.token)
        self.assertEqual(status, 422, "Référence de dépôt obligatoire")
        status, filed = self.call("POST", f"/finance/fiscal/returns/{record['id']}/file",
                                  {"reference": "DEMO-DEPOT-0001"}, token=self.token)
        self.assertEqual((status, filed["state"]), (200, "filed"))
        status, body = self.call("POST", "/finance/fiscal/returns", {"kind": "vat", "period": month}, token=self.token)
        self.assertEqual(status, 422, "Une déclaration déposée est figée")

        response = self.url_open(
            f"/api/v1/finance/fiscal/returns/{record['id']}/attachment",
            files={"file": ("accuse.pdf", io.BytesIO(PDF), "application/pdf")},
            headers={"Authorization": f"Bearer {self.token}"}, method="POST", timeout=60,
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["attachment"]["name"], "accuse.pdf")
        response = self.url_open(f"/api/v1/finance/fiscal/returns/{record['id']}/attachment",
                                 headers={"Authorization": f"Bearer {self.token}"}, timeout=60)
        self.assertEqual(response.content, PDF)

        status, paid = self.call("POST", f"/finance/fiscal/returns/{record['id']}/pay", {"reference": "DEMO-QUITTANCE"},
                                 token=self.token)
        self.assertEqual((status, paid["state"]), (200, "paid"))
        status, history = self.call("GET", f"/finance/fiscal/returns?year={self.today.year}",
                                    token=self.open_session("dg.fiscal")["access_token"])
        self.assertEqual(status, 200, history)
        self.assertEqual([r["id"] for r in history], [record["id"]], "La direction consulte l'historique")

        # Cloisonnement : l'autre société ne voit pas cette déclaration.
        cabinet = self.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        if cabinet:
            other = self.env["eguitra.tax.return"].with_user(
                self._create_user("compta.cabinet", "finance", company_id=cabinet.id, company_ids=[(6, 0, cabinet.ids)])
            ).with_context(allowed_company_ids=cabinet.ids)
            self.assertFalse(other.search([("id", "=", record["id"])]))
