from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestFreeAccounts(FinanceDataMixin, ApiCase):
    """Droit « Saisie libre des comptes » : accordé d'office aux profils finance, direction et
    administration ; sans lui, la ligne prend le compte de sa catégorie de dépense, du type d'opération
    ou de l'activité, et l'opération diverse est refusée (403)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.libre = cls._create_user("compta.libre", "finance")
        cls.guide = cls._create_user("compta.guidee", "finance")
        cls.guide._eguitra_set_rights({"free_accounts": False})
        cls._create_user("admin.droits", "admin")
        cls.category = cls.env["eguitra.expense.category"].create({
            "name": "Fournitures (droits)", "nature": "frais_generaux", "account_id": cls.acc_purchase.id,
            "company_id": cls.company.id,
        })
        cls.kind = cls.env["eguitra.treasury.operation.type"].create({
            "name": "Petites dépenses (droits)", "direction": "out", "account_id": cls.acc_purchase.id,
            "company_id": cls.company.id,
        })
        cls.general = cls.env["account.journal"].search(
            [("company_id", "=", cls.company.id), ("type", "=", "general"), ("code", "!=", "AN")], limit=1)

    def _token(self, login):
        return self.open_session(login)["access_token"]

    def _purchase(self, token, **line):
        return self.call("POST", "/finance/moves", {
            "move_type": "in_invoice", "partner_id": self.supplier.id,
            "lines": [dict({"name": "Ramettes de papier", "price_unit": 2_000_000}, **line)]}, token=token)

    def _entry(self, token):
        return self.call("POST", "/finance/moves", {
            "move_type": "entry", "journal_id": self.general.id, "ref": "Régularisation", "lines": [
                {"account_id": self.acc_purchase.id, "debit": 1_000_000, "name": "Charge"},
                {"account_id": self.supplier.property_account_payable_id.id, "credit": 1_000_000, "name": "Dette",
                 "partner_id": self.supplier.id},
            ]}, token=token)

    def test_droit_accorde_d_office_et_expose(self):
        self.assertEqual(self.libre._eguitra_rights(), {"free_accounts": True}, "Accordé avec le profil finance")
        self.assertEqual(self.guide._eguitra_rights(), {"free_accounts": False})
        status, me = self.call("GET", "/auth/me", token=self._token("compta.guidee"))
        self.assertEqual((status, me["rights"]), (200, {"free_accounts": False}), "Transmis à la session")

        token = self._token("admin.droits")
        status, rights = self.call("GET", "/admin/rights", token=token)
        self.assertEqual(status, 200, rights)
        self.assertEqual([r["code"] for r in rights], ["free_accounts"])
        self.assertEqual(rights[0]["name"], "Saisie libre des comptes")
        status, user = self.call("POST", "/admin/users", {
            "name": "Comptable Stagiaire", "login": "compta.stagiaire", "password": "Provisoire-2026",
            "profiles": ["finance"]}, token=token)
        self.assertEqual(status, 200, user)
        self.assertTrue(user["rights"]["free_accounts"], "Accordé d'office à la création")
        status, user = self.call("PATCH", f"/admin/users/{user['id']}", {"rights": {"free_accounts": False}}, token=token)
        self.assertEqual((status, user["rights"]["free_accounts"]), (200, False), "Retiré par l'administration")
        status, other = self.call("POST", "/admin/users", {
            "name": "Aide Comptable", "login": "aide.comptable", "password": "Provisoire-2026", "profiles": ["finance"],
            "rights": {"free_accounts": False}}, token=token)
        self.assertEqual((status, other["rights"]["free_accounts"]), (200, False), "Ou refusé dès la création")
        status, body = self.call("PATCH", f"/admin/users/{other['id']}", {"rights": {"inconnu": True}}, token=token)
        self.assertEqual(status, 422, body)
        status, parc = self.call("POST", "/admin/users", {
            "name": "Agent Parc", "login": "agent.parc.droits", "password": "Provisoire-2026",
            "profiles": ["exploitation"]}, token=token)
        self.assertEqual((status, parc["rights"]["free_accounts"]), (200, False), "Profil sans saisie comptable")

        self.env["res.users"]._eguitra_grant_free_accounts()
        self.assertTrue(self.guide._eguitra_rights()["free_accounts"],
                        "Installation et migration : accordé à tous les comptes finance, direction et administration")

    def test_saisie_guidee_sans_le_droit(self):
        token = self._token("compta.guidee")
        status, body = self._purchase(token, account_id=self.acc_services.id)
        self.assertEqual((status, body["error"]), (403, "forbidden"), body)
        self.assertIn("Saisie libre des comptes", body["message"])
        status, body = self._purchase(token)
        self.assertEqual(status, 422, "Une ligne d'achat se saisit par catégorie de dépense")
        status, move = self._purchase(token, category_id=self.category.id)
        self.assertEqual(status, 200, move)
        self.assertEqual(move["lines"][0]["account"]["id"], self.acc_purchase.id, "Compte de la catégorie")
        status, move = self._purchase(token, category_id=self.category.id, account_id=self.acc_purchase.id)
        self.assertEqual(status, 200, "Le compte de la catégorie, même renvoyé, n'est pas un choix libre")

        status, body = self.call("POST", "/finance/moves", {
            "move_type": "out_invoice", "partner_id": self.customer.id,
            "lines": [{"name": "Transport", "price_unit": 1_000_000, "account_id": self.acc_services.id}]}, token=token)
        self.assertEqual(status, 403, body)
        status, sale = self.call("POST", "/finance/moves", {
            "move_type": "out_invoice", "partner_id": self.customer.id,
            "lines": [{"name": "Transport", "price_unit": 1_000_000}]}, token=token)
        self.assertEqual(status, 200, "Compte de produit de l'activité ou du journal")
        self.assertTrue(sale["lines"][0]["account"]["code"].startswith("7"), sale["lines"])

        status, body = self._entry(token)
        self.assertEqual((status, body["error"]), (403, "forbidden"), "Opération diverse refusée sans le droit")
        self.assertIn("Opération diverse", body["message"])

        path = f"/finance/treasury/{self.cash.id}/lines"
        status, body = self.call("POST", path, {"label": "Taxi", "amount": -50_000,
                                                "counterpart_account_id": self.acc_services.id}, token=token)
        self.assertEqual(status, 403, body)
        status, line = self.call("POST", path, {"label": "Taxi", "amount": 50_000, "operation_type_id": self.kind.id,
                                                "counterpart_account_id": self.acc_purchase.id}, token=token)
        self.assertEqual(status, 200, line)
        self.assertEqual([c["code"] for c in line["counterpart"]], [self.acc_purchase.code], "Compte du type")
        status, line = self.call("POST", path, {"label": "Course de taxi", "amount": -80_000}, token=token)
        self.assertEqual((status, line["reconciled"]), (200, False), "À rapprocher : aucun compte choisi")
        reconcile = f"/finance/treasury/lines/{line['id']}/reconcile"
        status, body = self.call("POST", reconcile, {"account_id": self.acc_services.id}, token=token)
        self.assertEqual(status, 403, body)
        status, done = self.call("POST", reconcile, {"operation_type_id": self.kind.id}, token=token)
        self.assertEqual(status, 200, done)
        self.assertTrue(done["reconciled"])
        self.assertEqual([c["code"] for c in done["counterpart"]], [self.acc_purchase.code], "Imputée selon le type")

        status, body = self.call("POST", "/finance/expense-categories", {
            "name": "Catégorie libre", "nature": "frais_generaux", "account_id": self.acc_purchase.id}, token=token)
        self.assertEqual(status, 403, "Les comptes des catégories relèvent du même droit")
        status, body = self.call("PATCH", f"/finance/expense-categories/{self.category.id}", {
            "name": "Fournitures de bureau", "account_id": self.acc_purchase.id}, token=token)
        self.assertEqual(status, 200, "Compte inchangé : la catégorie se renomme")

    def test_saisie_libre_avec_le_droit(self):
        token = self._token("compta.libre")
        status, move = self._purchase(token, account_id=self.acc_purchase.id)
        self.assertEqual(status, 200, move)
        self.assertEqual(move["lines"][0]["account"]["id"], self.acc_purchase.id)
        status, entry = self._entry(token)
        self.assertEqual(status, 200, entry)
        status, line = self.call("POST", f"/finance/treasury/{self.cash.id}/lines", {
            "label": "Fournitures", "amount": -60_000, "counterpart_account_id": self.acc_purchase.id}, token=token)
        self.assertEqual((status, line["reconciled"]), (200, True), line)
