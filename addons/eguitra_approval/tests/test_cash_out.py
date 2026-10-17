from dateutil.relativedelta import relativedelta

from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestCashOut(FinanceDataMixin, ApiCase):
    """Décaissements de trésorerie (courrier du responsable financier, attente 10) : sorties de caisse
    et de banque saisies, imputation directe d'une ligne de relevé, échéance d'emprunt et virement
    interne passent par le circuit au-delà du seuil (100 M GNF, direction), sans contournement."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("tresorier.co", "finance")
        cls.dg = cls._create_user("dg.co", "direction")
        Rule = cls.env["eguitra.approval.rule"]
        if not Rule.search_count([("company_id", "=", cls.company.id), ("document", "=", "cash_out")]):
            Rule.create({"name": "Décaissements", "document": "cash_out", "min_amount": 100_000_000,
                         "approver_profile": "direction", "company_id": cls.company.id})

    def setUp(self):
        super().setUp()
        self.token = self.open_session("tresorier.co", app="finance")["access_token"]

    def _request(self, move):
        return self.env["eguitra.approval.request"].search(
            [("res_model", "=", "account.move"), ("res_id", "=", move.id), ("state", "!=", "cancelled")],
            order="id desc", limit=1)

    def test_sortie_de_banque_saisie(self):
        status, small = self.call("POST", f"/finance/treasury/{self.bank.id}/lines", {
            "label": "Frais de mission", "amount": -5_000_000, "counterpart_account_id": self.acc_purchase.id,
        }, token=self.token)
        self.assertEqual(status, 200, small)
        self.assertTrue(small["posted"], "Sous le seuil : comptabilisée aussitôt")
        status, big = self.call("POST", f"/finance/treasury/{self.bank.id}/lines", {
            "label": "Acompte fournisseur de pneus", "amount": -150_000_000, "counterpart_account_id": self.acc_purchase.id,
        }, token=self.token)
        self.assertEqual(status, 200, big)
        self.assertFalse(big["posted"], "Au-delà du seuil : en attente d'approbation")
        self.assertEqual(big["approval"]["pending_with"], "Direction générale")
        self.env.invalidate_all()
        move = self.env["account.move"].browse(big["move_id"])
        self.assertEqual(move.state, "draft")
        self._request(move).with_user(self.dg).action_approve()
        self.assertEqual(move.state, "posted", "Comptabilisée à l'approbation")

    def test_echeance_d_emprunt_et_virement(self):
        loan = self.env["eguitra.loan"].create({
            "name": "Emprunt camions", "partner_id": self.supplier.id, "principal": 1_200_000_000,
            "annual_rate": 0, "start_date": self.today - relativedelta(months=1), "duration_months": 6,
            "first_due_date": self.today, "principal_account_id": self.acc_loan.id,
            "interest_account_id": self.acc_interest.id, "journal_id": self.bank.id,
        })
        loan.compute_schedule()
        loan.action_activate()
        line = loan.line_ids[0]
        line.action_pay()
        self.assertFalse(line.paid, "Échéance de 200 M : réglée à l'approbation du décaissement")
        self.assertEqual(line.move_id.state, "draft")
        self._request(line.move_id).with_user(self.dg).action_approve()
        self.assertTrue(line.paid)

        status, body = self.call("POST", "/finance/transfers", {
            "from_journal_id": self.bank.id, "to_journal_id": self.cash.id, "amount": 120_000_000,
        }, token=self.token)
        self.assertEqual((status, body["status"]), (200, "submitted"), body)
        self.env.invalidate_all()
        out_move, in_move = (self.env["account.move"].browse(m["id"]) for m in body["moves"])
        self.assertEqual((out_move.state, in_move.state), ("draft", "draft"))
        self._request(out_move).with_user(self.dg).action_approve()
        self.assertEqual((out_move.state, in_move.state), ("posted", "posted"), "L'entrée suit la sortie approuvée")
