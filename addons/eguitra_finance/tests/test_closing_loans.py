from dateutil.relativedelta import relativedelta

from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestClosingAndLoans(FinanceDataMixin, TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.month = (cls.today.replace(day=1) - relativedelta(months=1))

    def test_echeancier_annuites_constantes(self):
        loan = self.env["eguitra.loan"].create({
            "name": "Emprunt BICIGUI camions", "partner_id": self.supplier.id, "principal": 1_200_000_000,
            "annual_rate": 12, "start_date": self.month, "duration_months": 12, "periodicity": "monthly",
            "principal_account_id": self.acc_loan.id, "interest_account_id": self.acc_interest.id,
            "journal_id": self.bank.id,
        })
        loan.compute_schedule()
        self.assertEqual(len(loan.line_ids), 12)
        self.assertAlmostEqual(sum(loan.line_ids.mapped("principal")), 1_200_000_000, delta=1)
        totals = loan.line_ids[:-1].mapped("total")
        self.assertLess(max(totals) - min(totals), 2, "Échéances constantes, à l'arrondi près")
        self.assertEqual(loan.line_ids[0].interest, 12_000_000, "1 % par mois sur 1 200 M")

        loan.action_activate()
        first = loan.line_ids[0]
        first.action_pay()
        if not first.paid:
            # Échéance au-delà du seuil des décaissements : réglée à l'approbation (eguitra_approval).
            first.move_id.with_context(eguitra_approval_granted=True).sudo().action_post()
        self.assertTrue(first.paid)
        self.assertEqual(first.move_id.state, "posted")
        summary = self.env["eguitra.loan"].debt_summary(self.company, self.today)
        self.assertAlmostEqual(summary["outstanding"], 1_200_000_000 - first.principal, delta=1)
        with self.assertRaises(UserError):
            first.action_pay()

    def test_differe_d_amortissement(self):
        loan = self.env["eguitra.loan"].create({
            "name": "Crédit-bail citerne", "kind": "lease", "partner_id": self.supplier.id, "principal": 600_000_000,
            "annual_rate": 10, "start_date": self.month, "duration_months": 24, "grace_months": 6,
            "periodicity": "quarterly", "method": "linear",
        })
        loan.compute_schedule()
        self.assertEqual(len(loan.line_ids), 8)
        self.assertEqual(loan.line_ids[:2].mapped("principal"), [0.0, 0.0], "Intérêts seuls pendant le différé")
        self.assertAlmostEqual(sum(loan.line_ids.mapped("principal")), 600_000_000, delta=1)

    def test_cloture_bloquee_puis_acceptee(self):
        draft = self.make_invoice("out_invoice", 50_000_000, day=self.month, post=False)
        close = self.env["eguitra.period.close"]._get(self.company, self.month)
        checks = {c["code"]: c for c in close.action_check()}
        self.assertEqual(checks["draft_moves"]["status"], "blocking")
        with self.assertRaises(UserError):
            close.action_close()

        draft.with_context(eguitra_approval_granted=True).action_post()
        close.action_close()
        self.assertEqual(close.state, "closed")
        self.assertEqual(self.company.fiscalyear_lock_date, self.month + relativedelta(months=1, days=-1))
        self.assertTrue(draft.inalterable_hash, "Les écritures du mois clôturé sont chaînées")
        late = self.make_invoice("out_invoice", 10_000_000, day=self.month)
        self.assertGreater(late.date, self.company.fiscalyear_lock_date,
                           "Une pièce datée dans un mois clôturé est comptabilisée sur la période ouverte")

        with self.assertRaises(UserError):
            close.action_reopen("")
        close.action_reopen("Facture de transport oubliée")
        self.assertEqual(close.state, "open")
        self.assertFalse(self.company.fiscalyear_lock_date)
        self.assertEqual(close.event_ids.mapped("action"), ["reopen", "close"])

    def test_cloture_dans_l_ordre(self):
        older = self.month - relativedelta(months=1)
        self.make_invoice("out_invoice", 30_000_000, day=older)
        close = self.env["eguitra.period.close"]._get(self.company, self.month)
        checks = {c["code"]: c for c in close.action_check()}
        self.assertEqual(checks["previous_closed"]["status"], "blocking")
