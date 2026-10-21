from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from .pilotage_common import PilotageMixin


@tagged("post_install", "-at_install")
class TestDette(PilotageMixin, TransactionCase):
    """Dette : encours comptable et échéanciers, échéances réglées depuis le relevé bancaire."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_pilotage_data()

    def test_dette_encours_comptable_et_controle(self):
        loan = self.loan(principal=1_200_000_000, rate=12)
        self.entry(self.bank, [(self.bank.default_account_id, 1_200_000_000, 0, None),
                               (self.acc_loan, 0, 1_200_000_000, self.supplier)], self.today - relativedelta(months=1))
        position = self.metrics.debt_position(self.company, self.today)
        self.assertAlmostEqual(position["accounting_outstanding"], 1_200_000_000)
        self.assertAlmostEqual(position["schedule_gap"], 0, msg="Déblocage comptabilisé : pas d'écart")
        self.assertAlmostEqual(position["net_debt"], 1_200_000_000 - self.metrics.cash(self.company, self.today))
        self.assertAlmostEqual(position["gearing"], position["accounting_outstanding"] / position["equity"], 4)
        self.assertAlmostEqual(position["debt_to_ebe"], 1_200_000_000 / position["ebe_12m"], 4)
        self.assertGreater(position["service_fy"], 0)
        loan.line_ids[0].action_pay()
        position = self.metrics.debt_position(self.company, self.today)
        self.assertAlmostEqual(position["schedule_gap"], 0, msg="Échéance réglée : comptabilité et échéancier baissent ensemble")

        self.entry(self.bank, [(self.bank.default_account_id, 50_000_000, 0, None), (self.acc_loan, 0, 50_000_000, None)])
        close = self.env["eguitra.period.close"]._get(self.company, self.today)
        checks = {c["code"]: c for c in close._run_controls()}
        self.assertEqual(checks["debt_schedule"]["status"], "warning", "Dette comptable sans échéancier")

    def test_echeance_reglee_depuis_le_releve(self):
        loan = self.loan(principal=120_000_000, rate=12)
        first, second = loan.line_ids[0], loan.line_ids[1]
        bank = self.bank.default_account_id

        def bank_balance():
            return self.metrics._sum_balance(self.company, [bank.code], None, self.today + timedelta(days=60))

        start = bank_balance()
        st_line = self.env["account.bank.statement.line"].create({
            "journal_id": self.bank.id, "date": self.today, "payment_ref": f"PRLV ECHEANCE {loan.name}",
            "amount": -first.total,
        })
        candidates = self.env["eguitra.loan.line"]._statement_candidates(st_line)
        self.assertEqual((candidates[0]["kind"], candidates[0]["id"]), ("loan_line", first.id),
                         "L'échéance citée et au bon montant vient en tête")
        self.assertFalse(candidates[0]["already_paid"])
        move = first.action_settle_from_statement(st_line)
        self.assertTrue(st_line.is_reconciled, "La ligne de relevé est rapprochée")
        self.assertTrue(first.paid)
        self.assertEqual(first.statement_line_id, st_line)
        self.assertEqual(move.state, "posted")
        self.assertAlmostEqual(sum(move.line_ids.filtered(lambda l: l.account_id == self.acc_loan).mapped("debit")),
                               first.principal)
        self.assertAlmostEqual(bank_balance(), start - first.total, msg="Une seule sortie de banque")

        # Échéance réglée directement en banque, puis retrouvée au relevé : le règlement direct est extourné.
        second.action_pay()
        st_line2 = self.env["account.bank.statement.line"].create({
            "journal_id": self.bank.id, "date": second.due_date, "payment_ref": "PRELEVEMENT BANQUE",
            "amount": -second.total,
        })
        close = self.env["eguitra.period.close"]._get(self.company, second.due_date)
        checks = {c["code"]: c for c in close._run_controls()}
        self.assertEqual(checks["loan_bank_statement"]["status"], "warning", "Risque de double sortie signalé")
        candidate = next(c for c in self.env["eguitra.loan.line"]._statement_candidates(st_line2) if c["id"] == second.id)
        self.assertTrue(candidate["already_paid"])
        second.action_settle_from_statement(st_line2)
        self.assertTrue(st_line2.is_reconciled)
        self.assertAlmostEqual(bank_balance(), start - first.total - second.total,
                               msg="La sortie de la deuxième échéance n'est comptée qu'une fois")
        proposed = {c["id"] for c in self.env["eguitra.loan.line"]._statement_candidates(st_line2)}
        self.assertFalse(proposed & set((first | second).ids), "Une échéance rapprochée n'est plus proposée")

    def test_reglement_refuse_si_montant_different(self):
        loan = self.loan()
        st_line = self.env["account.bank.statement.line"].create({
            "journal_id": self.bank.id, "date": self.today, "payment_ref": "PRLV", "amount": -(loan.line_ids[0].total + 5_000),
        })
        with self.assertRaises(UserError):
            loan.line_ids[0].action_settle_from_statement(st_line)
        self.assertFalse(loan.line_ids[0].paid)
        self.assertFalse(st_line.is_reconciled)
