"""Référentiels RH : paramètres de paie par société, barème de la RTS, rubriques de paie, départements,
jours fériés et types d'absence.

Valeurs par défaut : docs/projet/rh/specification.md, chapitre 2 (à valider par l'expert-comptable).
"""

from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import UserError

from ..engine import Params

DEFAULT_BRACKETS = [(0, 0.0), (1_000_000, 5.0), (3_000_000, 8.0), (5_000_000, 10.0), (10_000_000, 15.0),
                    (20_000_000, 20.0)]

# Comptes par défaut (plan SYSCOHADA) : code exact, sinon racine (voir _account).
ACCOUNT_FIELDS = {
    "salary": "account_salary",
    "social_charges": "account_social_charges",
    "payroll_taxes": "account_payroll_taxes",
    "training_tax": "account_training_tax",
    "cnss": "account_cnss",
    "rts": "account_rts",
    "payroll_taxes_payable": "account_payroll_taxes_payable",
    "net_payable": "account_net_payable",
    "advances": "account_advances",
}


class EguitraRhSettings(models.Model):
    _name = "eguitra.rh.settings"
    _description = "Paramètres de paie"
    _rec_name = "company_id"

    company_id = fields.Many2one("res.company", required=True, index=True, ondelete="cascade")
    cnss_employee_rate = fields.Float("CNSS salariale (%)", default=5.0)
    cnss_employer_rate = fields.Float("CNSS patronale (%)", default=18.0)
    cnss_ceiling = fields.Float("Plafond mensuel de la CNSS", default=2_500_000)
    smig = fields.Float("SMIG mensuel", default=550_000)
    allowance_exempt_cap = fields.Float("Plafond d'exonération des indemnités forfaitaires (% du brut)", default=25.0)
    bracket_ids = fields.One2many("eguitra.rh.tax.bracket", "settings_id", "Barème de la RTS")
    vf_rate = fields.Float("Versement forfaitaire (%)", default=6.0)
    training_tax_rate = fields.Float("Taxe de formation (%)", default=2.0)
    training_tax_label = fields.Char("Libellé de la taxe de formation", default="Taxe d'apprentissage")
    leave_days_per_month = fields.Float("Congés acquis par mois (jours ouvrables)", default=2.5)
    monthly_hours = fields.Float("Heures mensuelles", default=173.33)
    rotation_bonus = fields.Float("Prime par rotation validée (chauffeurs)", default=0.0)
    trial_alert_days = fields.Integer("Alerte de fin d'essai (jours)", default=15)
    contract_alert_days = fields.Integer("Alerte de fin de contrat (jours)", default=30)
    document_alert_days = fields.Integer("Alerte d'expiration des documents (jours)", default=30)
    cnss_employer_number = fields.Char("Numéro d'employeur CNSS")
    account_salary = fields.Char("Salaires", default="6611")
    account_social_charges = fields.Char("Charges sociales", default="6641")
    account_payroll_taxes = fields.Char("Taxes sur salaires (VF)", default="6413")
    account_training_tax = fields.Char("Taxe de formation", default="6414")
    account_cnss = fields.Char("Sécurité sociale (CNSS)", default="431")
    account_rts = fields.Char("Impôts retenus sur salaires (RTS)", default="4472")
    account_payroll_taxes_payable = fields.Char("État, taxes sur salaires à payer", default="4478")
    account_net_payable = fields.Char("Rémunérations dues", default="422")
    account_advances = fields.Char("Avances et acomptes au personnel", default="4211")
    journal_id = fields.Many2one("account.journal", "Journal des salaires", check_company=True)

    _company_unique = models.Constraint("unique(company_id)", "Une seule fiche de paramètres par société.")

    @api.model
    def _get(self, company):
        settings = self.sudo().search([("company_id", "=", company.id)], limit=1)
        if not settings:
            settings = self.sudo().create({
                "company_id": company.id,
                "bracket_ids": [fields.Command.create({"threshold": t, "rate": r}) for t, r in DEFAULT_BRACKETS],
            })
        return settings

    def params(self):
        self.ensure_one()
        brackets = [(b.threshold, b.rate) for b in self.bracket_ids] or DEFAULT_BRACKETS
        return Params(
            cnss_employee_rate=self.cnss_employee_rate, cnss_employer_rate=self.cnss_employer_rate,
            cnss_ceiling=self.cnss_ceiling, smig=self.smig, allowance_exempt_cap=self.allowance_exempt_cap,
            brackets=brackets, vf_rate=self.vf_rate, training_tax_rate=self.training_tax_rate,
            monthly_hours=self.monthly_hours or 173.33,
        )

    def _account(self, code):
        """Compte de la société : code exact, sinon premier compte de cette racine."""
        self.ensure_one()
        Account = self.env["account.account"].sudo().with_company(self.company_id)
        domain = [("company_ids", "in", self.company_id.ids)]
        code = (code or "").strip()
        account = Account.search(domain + [("code", "=", code)], limit=1) if code else Account
        if not account and code:
            account = Account.search(domain + [("code", "=like", code + "%")], order="code", limit=1)
        if not account:
            raise UserError(f"Compte {code or '(vide)'} introuvable dans le plan comptable de "
                            f"{self.company_id.name} : corrigez les comptes des paramètres RH.")
        return account

    def _journal(self):
        """Journal des salaires (code SAL), créé au besoin."""
        self.ensure_one()
        if self.journal_id:
            return self.journal_id
        Journal = self.env["account.journal"].sudo()
        journal = Journal.search([("company_id", "=", self.company_id.id), ("code", "=", "SAL")], limit=1)
        if not journal:
            journal = Journal.create({"name": "Salaires", "code": "SAL", "type": "general",
                                      "company_id": self.company_id.id})
        self.sudo().journal_id = journal
        return journal


class EguitraRhTaxBracket(models.Model):
    _name = "eguitra.rh.tax.bracket"
    _description = "Tranche du barème de la RTS"
    _order = "threshold"

    settings_id = fields.Many2one("eguitra.rh.settings", required=True, ondelete="cascade", index=True)
    threshold = fields.Float("À partir de (revenu mensuel)", required=True)
    rate = fields.Float("Taux (%)", required=True)


class EguitraRhRubric(models.Model):
    _name = "eguitra.rh.rubric"
    _description = "Rubrique de paie"
    _order = "sequence, code"

    code = fields.Char("Code", required=True)
    name = fields.Char("Libellé", required=True)
    kind = fields.Selection([("gain", "Gain"), ("deduction", "Retenue")], required=True, default="gain")
    input = fields.Selection([("amount", "Montant"), ("hours", "Heures")], required=True, default="amount")
    overtime_rate = fields.Float("Majoration des heures (%)")
    cnss = fields.Boolean("Soumise à la CNSS", default=True)
    taxable = fields.Boolean("Soumise à la RTS", default=True)
    exempt_allowance = fields.Boolean("Indemnité forfaitaire exonérée (plafond)")
    account_code = fields.Char("Compte", default="6611")
    system = fields.Boolean("Rubrique du moteur", readonly=True)
    sequence = fields.Integer(default=50)
    active = fields.Boolean(default=True)

    _code_unique = models.Constraint("unique(code)", "Ce code de rubrique existe déjà.")

    @api.constrains("kind", "cnss", "taxable", "exempt_allowance")
    def _check_flags(self):
        for rubric in self.filtered(lambda r: r.kind == "deduction"):
            if rubric.cnss or rubric.taxable or rubric.exempt_allowance:
                raise UserError("Une retenue n'est ni soumise à la CNSS ni à la RTS : ce sont des gains qui le sont.")


class EguitraRhDepartment(models.Model):
    _name = "eguitra.rh.department"
    _description = "Département"
    _order = "name"

    name = fields.Char("Département", required=True)
    company_id = fields.Many2one("res.company", "Société", index=True,
                                 help="Vide : département commun aux deux sociétés (gestion RH commune).")
    manager_id = fields.Many2one("eguitra.rh.employee", "Responsable")
    active = fields.Boolean(default=True)


class EguitraRhHoliday(models.Model):
    _name = "eguitra.rh.holiday"
    _description = "Jour férié"
    _order = "date"

    date = fields.Date("Date", required=True, index=True)
    name = fields.Char("Libellé", required=True)
    company_id = fields.Many2one("res.company", "Société", help="Vide : jour férié des deux sociétés.", index=True)

    @api.model
    def _dates(self, company, date_from, date_to):
        holidays = self.sudo().search([("date", ">=", date_from), ("date", "<=", date_to),
                                       ("company_id", "in", [False, company.id])])
        return set(holidays.mapped("date"))

    @api.model
    def _working_days(self, company, date_from, date_to):
        """Jours ouvrables du lundi au samedi, jours fériés exclus, bornes comprises."""
        if not date_from or not date_to or date_to < date_from:
            return 0
        off = self._dates(company, date_from, date_to)
        count = 0
        day = date_from
        while day <= date_to:
            if day.weekday() < 6 and day not in off:
                count += 1
            day += timedelta(days=1)
        return count


class EguitraRhLeaveType(models.Model):
    _name = "eguitra.rh.leave.type"
    _description = "Type d'absence"
    _order = "sequence, name"

    code = fields.Char("Code", required=True)
    name = fields.Char("Libellé", required=True)
    paid = fields.Boolean("Rémunérée", default=True)
    deducts_balance = fields.Boolean("Décomptée du solde de congés")
    needs_document = fields.Boolean("Justificatif demandé")
    max_days = fields.Float("Durée maximale par demande (jours ouvrables)")
    sequence = fields.Integer(default=50)
    active = fields.Boolean(default=True)

    _code_unique = models.Constraint("unique(code)", "Ce code de type d'absence existe déjà.")
