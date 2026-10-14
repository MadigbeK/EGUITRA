"""Emprunts et crédits-bails : échéancier, comptabilisation des échéances, service de la dette."""


from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import UserError
from odoo.tools import float_round

PERIOD_MONTHS = {"monthly": 1, "quarterly": 3, "semiannual": 6, "annual": 12}


class EguitraLoan(models.Model):
    _name = "eguitra.loan"
    _description = "Emprunt ou crédit-bail"
    _inherit = ["mail.thread"]
    _order = "start_date desc, id desc"

    name = fields.Char("Référence", required=True, tracking=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    partner_id = fields.Many2one("res.partner", "Prêteur", required=True, tracking=True)
    kind = fields.Selection([("loan", "Emprunt"), ("lease", "Crédit-bail")], default="loan", required=True)
    principal = fields.Monetary("Montant emprunté", required=True, tracking=True)
    annual_rate = fields.Float("Taux annuel (%)", digits=(6, 4), tracking=True)
    start_date = fields.Date("Date de déblocage", required=True)
    first_due_date = fields.Date("Première échéance")
    duration_months = fields.Integer("Durée (mois)", required=True)
    grace_months = fields.Integer("Différé d'amortissement (mois)", help="Intérêts seuls pendant le différé.")
    periodicity = fields.Selection(
        [("monthly", "Mensuelle"), ("quarterly", "Trimestrielle"), ("semiannual", "Semestrielle"), ("annual", "Annuelle")],
        default="monthly",
        required=True,
    )
    method = fields.Selection(
        [("annuity", "Échéances constantes"), ("linear", "Amortissement constant du capital")],
        default="annuity",
        required=True,
    )
    principal_account_id = fields.Many2one("account.account", "Compte de dette", help="162, 166 ou 17x selon le financement.")
    interest_account_id = fields.Many2one("account.account", "Compte de charges financières", help="671 ou 672.")
    journal_id = fields.Many2one("account.journal", "Journal de règlement", domain=[("type", "in", ("bank", "cash"))])
    state = fields.Selection(
        [("draft", "Brouillon"), ("active", "En cours"), ("closed", "Soldé")], default="draft", tracking=True
    )
    line_ids = fields.One2many("eguitra.loan.line", "loan_id", "Échéancier")
    outstanding = fields.Monetary("Capital restant dû", compute="_compute_outstanding")

    @api.depends("line_ids.paid", "line_ids.principal")
    def _compute_outstanding(self):
        for loan in self:
            loan.outstanding = sum(loan.line_ids.filtered(lambda l: not l.paid).mapped("principal"))

    def _period_rate(self):
        self.ensure_one()
        return (self.annual_rate or 0.0) / 100.0 * PERIOD_MONTHS[self.periodicity] / 12.0

    def compute_schedule(self):
        """(Re)calcule l'échéancier d'un financement en brouillon."""
        for loan in self:
            if loan.state != "draft":
                raise UserError("L'échéancier d'un financement en cours ne peut plus être recalculé.")
            step = PERIOD_MONTHS[loan.periodicity]
            count = max(1, loan.duration_months // step)
            grace = min(count - 1, (loan.grace_months or 0) // step)
            rate = loan._period_rate()
            amortizing = count - grace
            remaining = loan.principal
            if loan.method == "annuity" and rate:
                annuity = loan.principal * rate / (1 - (1 + rate) ** -amortizing)
            else:
                annuity = None
            first = loan.first_due_date or (loan.start_date + relativedelta(months=step))
            lines = []
            for i in range(count):
                interest = float_round(remaining * rate, 0)
                if i < grace:
                    principal = 0.0
                elif i == count - 1:
                    principal = remaining
                elif annuity is not None:
                    principal = float_round(annuity - remaining * rate, 0)
                else:
                    principal = float_round(loan.principal / amortizing, 0)
                remaining -= principal
                lines.append((0, 0, {
                    "sequence": i + 1,
                    "due_date": first + relativedelta(months=step * i),
                    "principal": principal,
                    "interest": interest,
                    "remaining": max(0.0, remaining),
                }))
            loan.line_ids.unlink()
            loan.write({"line_ids": lines})
        return True

    def action_activate(self):
        for loan in self:
            if not loan.line_ids:
                loan.compute_schedule()
            if not (loan.principal_account_id and loan.interest_account_id and loan.journal_id):
                raise UserError("Renseignez le compte de dette, le compte de charges financières et le journal.")
            loan.state = "active"
        return True

    @api.model
    def debt_summary(self, companies, today):
        lines = self.env["eguitra.loan.line"].sudo().search([
            ("loan_id.company_id", "in", companies.ids), ("loan_id.state", "in", ("active", "closed")),
        ])
        unpaid = lines.filtered(lambda l: not l.paid)
        next_line = unpaid.filtered(lambda l: l.due_date >= today).sorted("due_date")[:1]
        year_ago, year_ahead = today - relativedelta(years=1), today + relativedelta(years=1)
        return {
            "loans": len(lines.mapped("loan_id")),
            "outstanding": sum(unpaid.mapped("principal")),
            "overdue": sum(unpaid.filtered(lambda l: l.due_date < today).mapped("total")),
            "next_due_date": next_line.due_date if next_line else None,
            "next_due_amount": next_line.total if next_line else 0.0,
            "service_last_12m": sum(lines.filtered(lambda l: year_ago < l.due_date <= today).mapped("total")),
            "service_next_12m": sum(lines.filtered(lambda l: today < l.due_date <= year_ahead).mapped("total")),
        }


class EguitraLoanLine(models.Model):
    _name = "eguitra.loan.line"
    _description = "Échéance de financement"
    _order = "loan_id, sequence"

    loan_id = fields.Many2one("eguitra.loan", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="loan_id.company_id", store=True)
    currency_id = fields.Many2one(related="loan_id.currency_id")
    sequence = fields.Integer()
    due_date = fields.Date("Échéance", required=True)
    principal = fields.Monetary("Capital")
    interest = fields.Monetary("Intérêts")
    total = fields.Monetary("Échéance", compute="_compute_total", store=True)
    remaining = fields.Monetary("Capital restant dû après échéance")
    paid = fields.Boolean("Réglée", readonly=True)
    move_id = fields.Many2one("account.move", "Écriture de règlement", readonly=True)

    @api.depends("principal", "interest")
    def _compute_total(self):
        for line in self:
            line.total = line.principal + line.interest

    def action_pay(self, date=None):
        """Comptabilise le règlement de l'échéance : dette et intérêts au débit, banque au crédit."""
        for line in self:
            loan = line.loan_id
            if line.paid:
                raise UserError("Cette échéance est déjà réglée.")
            if loan.state != "active":
                raise UserError("Le financement n'est pas en cours.")
            journal = loan.journal_id
            label = f"{loan.name} - échéance {line.sequence}"
            entries = []
            if line.principal:
                entries.append((0, 0, {"name": label, "account_id": loan.principal_account_id.id,
                                       "partner_id": loan.partner_id.id, "debit": line.principal}))
            if line.interest:
                entries.append((0, 0, {"name": f"{label} - intérêts", "account_id": loan.interest_account_id.id,
                                       "partner_id": loan.partner_id.id, "debit": line.interest}))
            entries.append((0, 0, {"name": label, "account_id": journal.default_account_id.id,
                                   "partner_id": loan.partner_id.id, "credit": line.total}))
            move = self.env["account.move"].create({
                "move_type": "entry",
                "journal_id": journal.id,
                "date": date or line.due_date,
                "ref": label,
                "company_id": loan.company_id.id,
                "line_ids": entries,
            })
            move.action_post()
            line.write({"paid": True, "move_id": move.id})
            if all(loan.line_ids.mapped("paid")):
                loan.state = "closed"
        return True
