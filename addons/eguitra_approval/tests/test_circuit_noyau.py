from odoo import Command
from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestCircuitNoyau(FinanceDataMixin, ApiCase):
    """Circuit d'approbation (audit du noyau) : OD qui décaisse et dépense convertie en OD soumises au
    circuit (C1), entrée d'un virement liée à sa sortie (C1), auteur écarté de la décision (I-A1), tout
    règlement sortant soumis (I-A2), demandes annulées avec leur pièce (I-A3), seuils « de plus de »
    stricts (M4), circuit d'une société créée après l'installation (M13)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.saisie = cls._create_user("saisie.cn", "finance")
        cls.soumission = cls._create_user("soumission.cn", "finance")
        cls.controle = cls._create_user("controle.cn", "finance")
        cls.dg = cls._create_user("dg.cn", "direction")
        Rule = cls.env["eguitra.approval.rule"]
        for document, minimum in (("cash_out", 100_000_000), ("payment_out", 100_000_000)):
            if not Rule.search_count([("company_id", "=", cls.company.id), ("document", "=", document)]):
                Rule.create({"name": document, "document": document, "min_amount": minimum,
                             "approver_profile": "direction", "company_id": cls.company.id})
        cls.general = cls.env["account.journal"].search(
            [("company_id", "=", cls.company.id), ("type", "=", "general"), ("code", "!=", "AN")], limit=1)

    def setUp(self):
        super().setUp()
        self.token = self.open_session("saisie.cn")["access_token"]

    def _request(self, record):
        return self.env["eguitra.approval.request"].search(
            [("res_model", "=", record._name), ("res_id", "=", record.id), ("state", "!=", "cancelled")],
            order="id desc", limit=1)

    def _bill(self, amount, user, taxes=True):
        return self.env["account.move"].with_user(user).create({
            "move_type": "in_invoice", "partner_id": self.supplier.id, "invoice_date": self.today,
            "invoice_line_ids": [Command.create({
                "name": "Pneus", "quantity": 1, "price_unit": amount, "account_id": self.acc_purchase.id,
                "tax_ids": [Command.set(self.tax_purchase.ids if taxes else [])],
            })],
        })

    def test_od_qui_decaisse_soumise_au_circuit(self):
        status, od = self.call("POST", "/finance/moves", {
            "move_type": "entry", "journal_id": self.general.id, "ref": "Règlement direct", "post": True,
            "lines": [
                {"account_id": self.supplier.property_account_payable_id.id, "debit": 150_000_000, "name": "Fournisseur",
                 "partner_id": self.supplier.id},
                {"account_id": self.bank.default_account_id.id, "credit": 150_000_000, "name": "Banque"},
            ]}, token=self.token)
        self.assertEqual(status, 200, od)
        self.assertEqual(od["state"], "draft", "Une OD qui sort 150 M de la banque attend la direction")
        self.assertEqual(od["approval"]["pending_with"], "Direction générale")
        move = self.env["account.move"].browse(od["id"])
        with self.assertRaises(UserError):
            move.with_user(self.saisie).action_post()
        self._request(move).with_user(self.dg).action_approve("Accord")
        self.assertEqual(move.state, "posted")

    def test_depense_convertie_en_od_soumise_au_circuit(self):
        category = self.env["eguitra.expense.category"].create({
            "name": "Salaires (circuit)", "nature": "personnel", "account_id": self.acc_purchase.id,
            "partner_account_id": self.env["account.account"].search(
                [("code", "=like", "422%"), ("company_ids", "in", self.company.ids)], limit=1).id,
            "tax_mode": "none", "company_id": self.company.id,
        })
        status, move = self.call("POST", "/finance/moves", {
            "move_type": "in_invoice", "partner_id": self.supplier.id, "post": True,
            "lines": [{"name": "Salaires d'octobre", "price_unit": 60_000_000, "category_id": category.id}],
        }, token=self.token)
        self.assertEqual(status, 200, move)
        self.assertEqual((move["move_type"], move["state"]), ("entry", "draft"), "Contrôle de la finance d'abord")
        record = self.env["account.move"].browse(move["id"])
        request = self._request(record)
        self.assertEqual(request.step_ids.mapped("profile"), ["finance", "direction"], "Plus de 50 M : la direction aussi")
        request.with_user(self.controle).action_approve()
        request.with_user(self.dg).action_approve()
        self.assertEqual(record.state, "posted")

    def test_entree_du_virement_liee_a_sa_sortie(self):
        status, body = self.call("POST", "/finance/transfers", {
            "from_journal_id": self.bank.id, "to_journal_id": self.cash.id, "amount": 120_000_000,
        }, token=self.token)
        self.assertEqual((status, body["status"]), (200, "submitted"), body)
        self.env.invalidate_all()
        out_move, in_move = (self.env["account.move"].browse(m["id"]) for m in body["moves"])
        with self.assertRaises(UserError):
            in_move.with_user(self.saisie).action_post()
        status, refus = self.call("POST", f"/finance/moves/{in_move.id}/post", token=self.token)
        self.assertEqual(status, 422, "L'entrée ne se valide pas avant l'approbation de la sortie")
        status, refus = self.call("PATCH", f"/finance/moves/{in_move.id}", {"ref": "Modifiée"}, token=self.token)
        self.assertEqual(status, 422, "Écriture produite par le noyau : non modifiable")
        in_move.line_ids.filtered(lambda line: line.debit).with_context(check_move_validity=False).write(
            {"debit": 130_000_000})
        with self.assertRaises(UserError):
            self._request(out_move).with_user(self.dg).action_approve()  # l'entrée a changé depuis la soumission

    def test_auteur_ecarte_de_la_decision(self):
        bill = self._bill(10_000_000, self.saisie)
        bill.with_user(self.soumission)._eguitra_post_or_submit()
        request = self._request(bill)
        self.assertFalse(request._can_decide(self.saisie), "L'auteur de la pièce ne la tranche pas")
        with self.assertRaisesRegex(AccessError, "saisie"):
            request.with_user(self.saisie).action_approve()
        request.with_user(self.controle).action_approve()
        self.assertEqual(bill.state, "posted")

    def test_remboursement_client_soumis(self):
        refund = self.make_invoice("out_refund", 150_000_000)
        status, body = self.call("POST", f"/finance/moves/{refund.id}/payments", {"journal_id": self.bank.id},
                                 token=self.token)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["payment_status"], "submitted", "Un remboursement de 177 M attend la direction")
        payment = self.env["account.payment"].browse(body["payments_awaiting_approval"][0]["id"])
        self._request(payment).with_user(self.dg).action_approve()
        self.env.invalidate_all()
        self.assertIn(refund.payment_state, ("paid", "in_payment"), "Lettré avec l'avoir à l'approbation")

    def test_demande_annulee_avec_sa_piece(self):
        bill = self._bill(10_000_000, self.saisie)
        bill.with_user(self.saisie)._eguitra_post_or_submit()
        request = self._request(bill)
        self.assertEqual(request.state, "pending")
        self.env.flush_all()
        status, body = self.call("DELETE", f"/finance/moves/{bill.id}", token=self.token)
        self.assertEqual(status, 200, body)
        self.env.invalidate_all()
        self.assertEqual(request.state, "cancelled", "Pièce supprimée : la demande sort de la corbeille")

        bill = self._bill(10_000_000, self.saisie)
        bill.with_user(self.saisie)._eguitra_post_or_submit()
        request = self._request(bill)
        self.env.flush_all()
        status, body = self.call("POST", f"/finance/moves/{bill.id}/cancel", token=self.token)
        self.assertEqual(status, 200, body)
        self.env.invalidate_all()
        self.assertEqual(request.state, "cancelled", "Pièce annulée : la demande aussi")

    def test_seuil_strictement_superieur(self):
        bill = self._bill(50_000_000, self.saisie, taxes=False)
        bill.with_user(self.saisie)._eguitra_post_or_submit()
        self.assertEqual(self._request(bill).step_ids.mapped("profile"), ["finance"],
                         "Exactement 50 M : pas « de plus de 50 M »")
        bill = self._bill(50_000_001, self.saisie, taxes=False)
        bill.with_user(self.saisie)._eguitra_post_or_submit()
        self.assertEqual(self._request(bill).step_ids.mapped("profile"), ["finance", "direction"])

    def test_societe_creee_apres_l_installation(self):
        company = self.env["res.company"].create({"name": "Société créée plus tard"})
        rules = self.env["eguitra.approval.rule"].search([("company_id", "=", company.id)])
        self.assertTrue({"in_invoice", "payment_out", "cash_out", "commitment"} <= set(rules.mapped("document")),
                        "Circuit par défaut posé à la création")

    def test_virement_refuse_hors_finance(self):
        token = self.open_session("dg.cn")["access_token"]
        status, body = self.call("POST", "/finance/transfers", {
            "from_journal_id": self.bank.id, "to_journal_id": self.cash.id, "amount": 1_000_000}, token=token)
        self.assertEqual((status, body.get("error")), (403, "forbidden"), body)
