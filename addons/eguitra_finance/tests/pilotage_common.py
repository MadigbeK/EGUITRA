from dateutil.relativedelta import relativedelta

from .common import FinanceDataMixin


class PilotageMixin(FinanceDataMixin):
    """Jeu de données du pilotage : une facture de 1 000 M HT, une facture d'achat de 200 M HT, et
    des outils pour passer des écritures et créer un emprunt en cours."""

    @classmethod
    def setup_pilotage_data(cls):
        cls.setup_finance_data()
        cls.metrics = cls.env["eguitra.finance.metrics"]
        cls.fy_start = cls.metrics.fiscal_year_bounds(cls.company, cls.today)[0]
        cls.invoice = cls.make_invoice("out_invoice", 1_000_000_000)
        cls.bill = cls.make_invoice("in_invoice", 200_000_000)

    def entry(self, journal, lines, day=None):
        move = self.env["account.move"].create({
            "move_type": "entry", "journal_id": journal.id, "date": day or self.today,
            "line_ids": [(0, 0, {"name": "Test", "account_id": acc.id, "debit": debit, "credit": credit,
                                 "partner_id": partner.id if partner else False})
                         for acc, debit, credit, partner in lines],
        })
        move.action_post()
        return move

    def account(self, prefix):
        return self.env["account.account"].search(
            [("code", "=like", prefix + "%"), ("company_ids", "in", self.company.ids)], limit=1, order="code")

    def loan(self, principal=120_000_000, rate=0, first_due=None, **values):
        loan = self.env["eguitra.loan"].create(dict({
            "name": "Emprunt BICIGUI camions", "partner_id": self.supplier.id, "principal": principal,
            "annual_rate": rate, "start_date": self.today - relativedelta(months=1), "duration_months": 12,
            "first_due_date": first_due or self.today, "principal_account_id": self.acc_loan.id,
            "interest_account_id": self.acc_interest.id, "journal_id": self.bank.id,
        }, **values))
        loan.compute_schedule()
        loan.action_activate()
        return loan
