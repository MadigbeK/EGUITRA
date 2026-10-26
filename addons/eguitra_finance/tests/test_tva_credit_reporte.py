import json
from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo import Command
from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestTvaCreditReporte(FinanceDataMixin, TransactionCase):
    """Déclaration de TVA : le crédit du mois précédent est déduit, sur sa propre ligne, comme le fait la
    liquidation de la clôture ; une déclaration déposée verrouille les taxes de son mois."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.month = cls.today.replace(day=1)
        cls.end = cls.month + relativedelta(months=1, days=-1)
        cls.previous = cls.month - relativedelta(months=1)
        cls.TaxReturn = cls.env["eguitra.tax.return"]
        cls.journal = cls.env["account.journal"].search(
            [("company_id", "=", cls.company.id), ("type", "=", "general"), ("code", "!=", "AN")], limit=1)

    def _account(self, prefix):
        return self.env["account.account"].search(
            [("code", "=like", prefix + "%"), ("company_ids", "in", self.company.ids)], limit=1, order="code")

    def _credit_carried(self, amount):
        """Crédit de TVA laissé par le mois précédent : au 4449 (crédit à reporter), sinon au 445 (la
        liquidation l'y laisse quand le plan n'a pas de 4449)."""
        carry = self._account("4449") or self._account("445")
        move = self.env["account.move"].create({
            "move_type": "entry", "journal_id": self.journal.id, "date": self.previous + timedelta(days=5),
            "line_ids": [Command.create({"name": "Crédit de TVA reporté", "account_id": carry.id, "debit": amount}),
                         Command.create({"name": "Crédit de TVA reporté", "account_id": self.acc_loan.id, "credit": amount})],
        })
        move.action_post()

    def _declaration(self, start=None):
        start = start or self.month
        return self.env["eguitra.fiscal"].vat_declaration(self.company, start, start + relativedelta(months=1, days=-1))

    def _prepare(self, start):
        record = self.TaxReturn._get(self.company, start, "vat")
        record.eguitra_prepare(json.loads(json.dumps(self._declaration(start), default=str)))
        return record

    def test_credit_reporte_deduit(self):
        self._credit_carried(4_000_000)
        self.make_invoice("out_invoice", 100_000_000)  # TVA collectée : 18 M
        self.make_invoice("in_invoice", 50_000_000)  # TVA déductible : 9 M
        data = self._declaration()
        self.assertAlmostEqual(data["vat_collected"], 18_000_000)
        self.assertAlmostEqual(data["vat_deductible"], 9_000_000)
        self.assertAlmostEqual(data["vat_credit_prior"], 4_000_000, msg="Crédit du mois précédent sur sa ligne")
        self.assertAlmostEqual(data["vat_due"], 5_000_000, msg="18 - 9 - 4 : comme la liquidation de la clôture")
        self.assertAlmostEqual(data["vat_credit"], 0)
        record = self._prepare(self.month)
        self.assertAlmostEqual(record.amount_credit_prior, 4_000_000)
        self.assertAlmostEqual(record.amount_due, 5_000_000, msg="Montant figé dans la déclaration")

    def test_credit_superieur_a_la_tva_due(self):
        self._credit_carried(12_000_000)
        self.make_invoice("out_invoice", 100_000_000)
        self.make_invoice("in_invoice", 50_000_000)
        data = self._declaration()
        self.assertAlmostEqual(data["vat_due"], 0)
        self.assertAlmostEqual(data["vat_credit"], 3_000_000, msg="9 + 12 - 18 : crédit à reporter")

    def test_depot_verrouille_les_taxes_du_mois(self):
        """Déposée, la déclaration pose la date de verrouillage fiscal à la fin de son mois (à confirmer en
        19 : refus du noyau de remettre en brouillon une pièce taxée de la période verrouillée)."""
        bill = self.make_invoice("in_invoice", 10_000_000, day=self.previous + timedelta(days=9))
        previous_end = self.month - timedelta(days=1)
        record = self._prepare(self.previous)
        record.eguitra_file(self.today, "QUITTANCE-DEMO-001")
        self.assertEqual(self.company.tax_lock_date, previous_end)
        with self.assertRaises(UserError):
            bill.button_draft()
        older = self._prepare(self.previous - relativedelta(months=1))
        older.eguitra_file(self.today, "QUITTANCE-DEMO-000")
        self.assertEqual(self.company.tax_lock_date, previous_end, "La date de verrouillage ne recule jamais")
