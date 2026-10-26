from dateutil.relativedelta import relativedelta

from odoo.exceptions import UserError, ValidationError
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin
from .pilotage_common import PilotageMixin


@tagged("post_install", "-at_install")
class TestDetteReglements(PilotageMixin, TransactionCase):
    """Règlement des échéances d'emprunt : un seul règlement à la fois (circuit des décaissements),
    règlement défait (remis en brouillon, extourné, rapprochement défait), capital restant dû à la date,
    conditions du financement."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_pilotage_data()

    def _statement_line(self, amount, ref="PRLV ECHEANCE"):
        return self.env["account.bank.statement.line"].create({
            "journal_id": self.bank.id, "date": self.today, "payment_ref": ref, "amount": amount,
        })

    def _skip_without_approval(self):
        if "eguitra.approval.request" not in self.env:
            self.skipTest("Circuit des décaissements : module eguitra_approval non installé")

    def test_reglement_en_attente_puis_releve(self):
        """Échéance au-delà du seuil des décaissements : le règlement attend l'approbation, un second
        « Régler » est refusé, et la ligne du relevé qui la règle annule le règlement en attente."""
        self._skip_without_approval()
        loan = self.loan(principal=1_200_000_000, duration_months=1, first_due=self.today)
        line = loan.line_ids
        line.action_pay()
        self.assertFalse(line.paid, "Au-delà de 100 M, le règlement attend la direction")
        self.assertEqual(line.settlement_state(), "pending")
        held = line.move_id
        with self.assertRaises(UserError):
            line.action_pay()
        self.assertEqual(line.move_id, held, "Le second règlement n'a rien créé")
        st_line = self._statement_line(-line.total, f"PRLV ECHEANCE {loan.name}")
        line.action_settle_from_statement(st_line)
        self.assertTrue(line.paid)
        self.assertEqual(line.statement_line_id, st_line)
        self.assertEqual(held.state, "cancel", "Le règlement direct en attente est annulé : une seule sortie")
        requests = self.env["eguitra.approval.request"].search(
            [("res_model", "=", "account.move"), ("res_id", "=", held.id)])
        self.assertEqual(set(requests.mapped("state")), {"cancelled"}, "Sa demande quitte la corbeille")
        self.assertEqual(loan.state, "closed")

    def test_reglement_refuse_puis_nouveau(self):
        self._skip_without_approval()
        loan = self.loan(principal=1_200_000_000, duration_months=1, first_due=self.today)
        line = loan.line_ids
        line.action_pay()
        refused = line.move_id
        line._approval_request().write({"state": "rejected"})
        self.assertEqual(line.settlement_state(), "rejected")
        line.action_pay()
        self.assertEqual(refused.state, "cancel", "Le règlement refusé est annulé")
        self.assertNotEqual(line.move_id, refused)
        self.assertEqual(line.settlement_state(), "pending", "Le nouveau règlement repart au circuit")

    def test_reglement_defait_l_echeance_redevient_due(self):
        loan = self.loan(principal=60_000_000, duration_months=1, first_due=self.today)
        line = loan.line_ids
        line.action_pay()
        self.assertTrue(line.paid)
        self.assertEqual(loan.state, "closed", "Dernière échéance réglée : financement soldé")
        move = line.move_id
        move.button_draft()
        self.assertFalse(line.paid, "Règlement remis en brouillon : l'échéance redevient due")
        self.assertEqual(loan.state, "active", "Le financement soldé repasse en cours")
        move.action_post()
        self.assertTrue(line.paid, "Revalidé, il la règle de nouveau")
        self.assertEqual(loan.state, "closed")
        move._reverse_moves([{"date": self.today, "ref": "Extourne du règlement"}]).action_post()
        self.assertFalse(line.paid, "Extourné : l'échéance redevient due")
        self.assertEqual((loan.state, line.settlement_state()), ("active", "due"))
        line.action_pay()
        self.assertTrue(line.paid, "Elle se règle de nouveau")

    def test_rapprochement_defait(self):
        """Rapprochement défait (à confirmer en 19 : action_undo_reconciliation du noyau) : l'écriture
        d'échéance est annulée, l'échéance redevient due, le financement repasse en cours."""
        loan = self.loan(principal=60_000_000, duration_months=1, first_due=self.today)
        line = loan.line_ids
        st_line = self._statement_line(-line.total, f"PRLV ECHEANCE {loan.name}")
        move = line.action_settle_from_statement(st_line)
        self.assertEqual(loan.state, "closed")
        st_line.action_undo_reconciliation()
        self.assertFalse(line.paid)
        self.assertFalse(line.statement_line_id)
        self.assertEqual(move.state, "cancel", "La dette et les intérêts reviennent")
        self.assertEqual(loan.state, "active")
        self.assertTrue(self.env["eguitra.loan.line"]._statement_candidates(st_line), "L'échéance se rapproche de nouveau")

    def test_capital_restant_du_a_la_date(self):
        """Contrôle de clôture d'un mois passé : une échéance réglée après la fin du mois compte encore."""
        loan = self.loan(principal=120_000_000, first_due=self.today - relativedelta(months=2))
        first = loan.line_ids[0]
        first.action_pay(self.today)
        past = self.today - relativedelta(months=1)
        Loan = self.env["eguitra.loan"]
        self.assertAlmostEqual(Loan.debt_summary(self.company, past)["outstanding"], 120_000_000,
                               msg="Le mois dernier, l'échéance n'était pas encore réglée")
        self.assertAlmostEqual(loan.outstanding_at(past), 120_000_000)
        self.assertAlmostEqual(Loan.debt_summary(self.company, self.today)["outstanding"], 120_000_000 - first.principal)

    def test_conditions_et_financement_solde(self):
        with self.assertRaises(ValidationError):
            self.loan(rate=150)
        with self.assertRaises(ValidationError):
            self.loan(grace_months=12)
        loan = self.loan(principal=60_000_000, duration_months=1, first_due=self.today)
        loan.line_ids.action_pay()
        self.assertEqual(loan.state, "closed")
        with self.assertRaises(UserError):
            loan.action_activate()
        self.assertEqual(loan.state, "closed", "Un financement soldé ne se remet pas en service")


@tagged("post_install", "-at_install")
class TestDetteReglementsApi(FinanceDataMixin, ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("tresoriere", "finance")

    def test_double_reglement_refuse(self):
        if "eguitra.approval.request" not in self.env:
            self.skipTest("Circuit des décaissements : module eguitra_approval non installé")
        loan = self.env["eguitra.loan"].create({
            "name": "Emprunt citernes", "partner_id": self.supplier.id, "principal": 1_200_000_000,
            "start_date": self.today - relativedelta(months=1), "duration_months": 1, "first_due_date": self.today,
            "principal_account_id": self.acc_loan.id, "interest_account_id": self.acc_interest.id,
            "journal_id": self.bank.id,
        })
        loan.compute_schedule()
        loan.action_activate()
        token = self.open_session("tresoriere")["access_token"]
        path = f"/finance/loans/lines/{loan.line_ids.id}/pay"
        status, body = self.call("POST", path, {}, token=token)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["schedule"][0]["settlement"], "pending", "L'écran dit que le règlement attend l'approbation")
        status, body = self.call("POST", path, {}, token=token)
        self.assertEqual(status, 422, "Second règlement refusé pendant l'approbation")
