from datetime import timedelta

from odoo import Command

from .common import FinanceDataMixin

# Exercice précédent : 1 000 M de services et 200 M de charges ; exercice en cours : 300 M de services.
PREVIOUS = 800_000_000
CURRENT = 300_000_000
# Affectation décidée par l'assemblée : réserve légale, autres réserves, report à nouveau, dividendes.
ALLOCATION = (("111", "Réserve légale", "equity", 80_000_000),
              ("118", "Autres réserves", "equity", 120_000_000),
              ("121", "Report à nouveau créditeur", "equity", 100_000_000),
              ("465", "Associés, dividendes à payer", "liability_current", 500_000_000))


class TwoYearsMixin(FinanceDataMixin):
    """Écritures sur l'exercice précédent et sur l'exercice en cours, compte d'affectation du résultat."""

    @classmethod
    def setup_two_years(cls):
        cls.setup_finance_data()
        metrics = cls.env["eguitra.finance.metrics"]
        cls.fy_start, cls.fy_end = metrics.fiscal_year_bounds(cls.company, cls.today)
        cls.previous_end = cls.fy_start - timedelta(days=1)
        cls.previous_start = metrics.fiscal_year_bounds(cls.company, cls.previous_end)[0]
        cls.make_invoice("out_invoice", 1_000_000_000, day=cls.previous_start + timedelta(days=40))
        cls.make_invoice("in_invoice", 200_000_000, day=cls.previous_start + timedelta(days=45))
        cls.make_invoice("out_invoice", CURRENT, day=cls.fy_start)
        cls.unaffected = metrics.unaffected_account(cls.company) or cls.env["account.account"].create({
            "code": "999999", "name": "Affectation du résultat", "account_type": "equity_unaffected",
            "company_ids": [(6, 0, cls.company.ids)],
        })

    @classmethod
    def plan_account(cls, prefix, name, account_type):
        """Compte du plan de la société commençant par prefix ; créé s'il manque au plan d'essai."""
        Account = cls.env["account.account"]
        account = Account.search([("code", "=like", prefix + "%"), ("company_ids", "in", cls.company.ids)],
                                 order="code", limit=1)
        return account or Account.create({"code": prefix.ljust(6, "0"), "name": name, "account_type": account_type,
                                          "company_ids": [(6, 0, cls.company.ids)]})

    @classmethod
    def post_allocation(cls, day):
        """OD d'affectation du résultat antérieur, comptabilisée à la date de l'assemblée."""
        journal = cls.env["account.journal"].search(
            [("company_id", "=", cls.company.id), ("type", "=", "general"), ("code", "!=", "AN")],
            order="sequence, id", limit=1)
        label = "Affectation du résultat"
        lines = [Command.create({"name": label, "account_id": cls.unaffected.id,
                                 "debit": sum(amount for *_rest, amount in ALLOCATION)})]
        lines += [Command.create({"name": label, "account_id": cls.plan_account(prefix, name, kind).id, "credit": amount})
                  for prefix, name, kind, amount in ALLOCATION]
        move = cls.env["account.move"].create({"move_type": "entry", "journal_id": journal.id, "date": day,
                                               "ref": label, "line_ids": lines})
        move.with_context(eguitra_approval_granted=True).action_post()
        return move
