from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestExpenseCategories(FinanceDataMixin, ApiCase):
    """Catégories de dépense : compte, TVA, opération diverse pour les comptes de tiers non fournisseurs,
    immobilisation créée à la validation pour un investissement."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("fatou", "finance")

        def account(prefix):
            return cls.env["account.account"].search(
                [("code", "=like", prefix + "%"), ("company_ids", "in", cls.company.ids)], limit=1, order="code")

        cls.account = staticmethod(account)
        journal = cls.env["account.journal"].search([("company_id", "=", cls.company.id), ("type", "=", "general")],
                                                    limit=1)
        cls.profile = cls.env["account.asset.profile"].create({
            "name": "Matériel de transport (catégories)", "account_asset_id": account("2451").id,
            "account_depreciation_id": account("2845").id, "account_expense_depreciation_id": account("6813").id,
            "journal_id": journal.id, "method": "linear", "method_number": 5, "method_period": "month",
            "company_id": cls.company.id,
        })

    def setUp(self):
        super().setUp()
        self.token = self.open_session("fatou")["access_token"]

    def _category(self, **values):
        return self.call("POST", "/finance/expense-categories", values, token=self.token)

    def _purchase(self, lines, **extra):
        return self.call("POST", "/finance/moves", dict({
            "move_type": "in_invoice", "partner_id": self.supplier.id, "lines": lines}, **extra), token=self.token)

    def test_categorie_pilote_compte_et_tva(self):
        status, fuel = self._category(name="Carburant", nature="opex_transport", account_id=self.acc_purchase.id)
        self.assertEqual(status, 200, fuel)
        self.assertFalse(fuel["entry"])
        status, body = self._category(name="carburant", nature="opex_transport", account_id=self.acc_purchase.id)
        self.assertEqual(status, 409)
        status, body = self._category(name="Ventes", nature="frais_generaux", account_id=self.acc_services.id)
        self.assertEqual(status, 422, "Une dépense s'impute en classe 6")
        status, move = self._purchase([{"name": "Gasoil du parc", "price_unit": 10_000_000, "category_id": fuel["id"]}])
        self.assertEqual(status, 200, move)
        line = move["lines"][0]
        self.assertEqual(line["account"]["id"], self.acc_purchase.id)
        self.assertEqual(line["category"]["id"], fuel["id"])
        self.assertEqual(move["amount_tax"], 1_800_000, "TVA déductible par défaut")
        status, no_vat = self._category(name="Assurance flotte", nature="frais_generaux",
                                        account_id=self.account("625").id, tax_mode="none")
        self.assertEqual(status, 200, no_vat)
        status, move = self._purchase([{"name": "Prime d'assurance", "price_unit": 4_000_000, "category_id": no_vat["id"]}])
        self.assertEqual(move["amount_tax"], 0, "Catégorie sans TVA")

    def test_categorie_hors_fournisseur_devient_od(self):
        status, salaries = self._category(name="Salaires du parc", nature="personnel", account_id=self.account("6611").id,
                                          partner_account_id=self.account("422").id, tax_mode="none")
        self.assertEqual(status, 200, salaries)
        self.assertTrue(salaries["entry"])
        status, body = self._category(name="Primes", nature="personnel", account_id=self.account("6611").id,
                                      partner_account_id=self.account("422").id)
        self.assertEqual(status, 422, "Une dépense passée en OD est sans TVA")
        status, move = self._purchase([{"name": "Salaires d'octobre", "price_unit": 25_000_000,
                                        "category_id": salaries["id"]}])
        self.assertEqual(status, 200, move)
        self.assertEqual((move["move_type"], move["converted_from"]), ("entry", "in_invoice"))
        credit = next(l for l in move["lines"] if l["credit"])
        self.assertTrue(credit["account"]["code"].startswith("422"))
        self.assertEqual(credit["credit"], 25_000_000)
        self.assertEqual(credit["partner"]["id"], self.supplier.id)
        status, fuel = self._category(name="Gasoil", nature="opex_transport", account_id=self.acc_purchase.id)
        status, body = self._purchase([
            {"name": "Salaires", "price_unit": 1_000_000, "category_id": salaries["id"]},
            {"name": "Gasoil", "price_unit": 1_000_000, "category_id": fuel["id"]},
        ])
        self.assertEqual(status, 422, "Une pièce ne mêle pas achat et opération diverse")
        self.assertIn("Séparez", body["message"])

    def test_investissement_cree_l_immobilisation(self):
        status, capex = self._category(name="Camions", nature="capex", asset_profile_id=self.profile.id)
        self.assertEqual(status, 200, capex)
        self.assertEqual(capex["account"]["id"], self.profile.account_asset_id.id, "Compte de la catégorie d'immobilisation")
        status, body = self._category(name="Sans profil", nature="capex", account_id=self.account("2451").id)
        self.assertEqual(status, 422)
        status, move = self._purchase([{"name": "Tracteur ER-09", "price_unit": 900_000_000, "category_id": capex["id"]}])
        self.assertEqual(status, 200, move)
        invoice = self.env["account.move"].browse(move["id"])
        invoice.with_context(eguitra_approval_granted=True).action_post()
        asset = self.env["account.asset"].search([("profile_id", "=", self.profile.id), ("name", "=", "Tracteur ER-09")])
        self.assertTrue(asset, "L'immobilisation naît de la pièce d'achat")

    def test_categories_usuelles(self):
        status, body = self.call("POST", "/finance/expense-categories/defaults", token=self.token)
        self.assertEqual(status, 200, body)
        names = {c["name"]: c for c in body["items"]}
        self.assertIn("Salaires", names)
        self.assertTrue(names["Salaires"]["entry"])
        status, again = self.call("POST", "/finance/expense-categories/defaults", token=self.token)
        self.assertEqual(again["created"], 0, "Pas de doublon")
        status, listing = self.call("GET", "/finance/expense-categories", token=self.token)
        self.assertGreaterEqual(len(listing), len(names))
