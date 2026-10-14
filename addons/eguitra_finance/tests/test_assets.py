from datetime import date

from odoo.tests import TransactionCase, tagged

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestAssets(FinanceDataMixin, TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()

        def account(prefix):
            return cls.env["account.account"].search(
                [("code", "=like", prefix + "%"), ("company_ids", "in", cls.company.ids)], limit=1, order="code")

        journal = cls.env["account.journal"].search([("company_id", "=", cls.company.id), ("type", "=", "general")],
                                                    limit=1)
        cls.profile = cls.env["account.asset.profile"].create({
            "name": "Matériel de transport, 5 ans", "account_asset_id": account("2451").id,
            "account_depreciation_id": account("2845").id, "account_expense_depreciation_id": account("6813").id,
            "journal_id": journal.id, "method": "linear", "method_number": 5, "method_period": "month",
            "company_id": cls.company.id,
        })
        cls.year = date.today().year - 1
        # Acquisition payée par la banque (la fiche d'immobilisation ne passe pas l'écriture d'achat).
        acquisition = cls.env["account.move"].create({
            "move_type": "entry", "journal_id": cls.bank.id, "date": date(cls.year, 1, 1),
            "line_ids": [(0, 0, {"name": "Achat citerne", "account_id": account("2451").id, "debit": 600_000_000}),
                         (0, 0, {"name": "Achat citerne", "account_id": cls.bank.default_account_id.id,
                                 "credit": 600_000_000})],
        })
        acquisition.action_post()
        cls.asset = cls.env["account.asset"].create({
            "name": "Citerne DEMO", "profile_id": cls.profile.id, "purchase_value": 600_000_000,
            "date_start": date(cls.year, 1, 1), "company_id": cls.company.id,
        })
        cls.asset.compute_depreciation_board()
        cls.asset.validate()

    def test_dotations_automatiques(self):
        self.env["account.asset"]._eguitra_cron_depreciate()
        posted = self.asset.depreciation_line_ids.filtered(lambda l: l.type == "depreciate" and l.move_check)
        self.assertGreaterEqual(len(posted), 12, "Les dotations échues de l'an dernier sont comptabilisées")
        self.assertAlmostEqual(self.asset.value_depreciated, sum(posted.mapped("amount")), 2)

    def test_cession_syscohada(self):
        self.env["account.asset"]._eguitra_cron_depreciate()
        sale = self.asset.eguitra_dispose(date.today(), 450_000_000, self.customer, "Vente à un transporteur")
        self.assertEqual(self.asset.state, "removed")
        codes = {line.account_id.code[:3]: line for line in sale.line_ids}
        self.assertEqual(codes["485"].debit, 450_000_000, "Créance sur cession d'immobilisation corporelle")
        self.assertEqual(codes["822"].credit, 450_000_000, "Produit de cession (HAO)")
        removal = self.env["account.move.line"].search([("asset_id", "=", self.asset.id), ("account_id.code", "=like", "812%")])
        self.assertTrue(removal, "Valeur nette comptable portée en 812")
        sheet = self.env["eguitra.syscohada"].balance_sheet(self.company, date.today())
        actif = {line["code"]: line["amount"] for line in sheet["actif"]}
        self.assertAlmostEqual(actif["AI"], 0, 2, "L'immobilisation a quitté l'actif")
        self.assertEqual(sheet["difference"], 0)
