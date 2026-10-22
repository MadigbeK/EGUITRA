"""Dossier du salarié : identité, contrat, rémunération (salaire de base et éléments fixes),
documents et leurs échéances, historique du salaire, solde de congés calculé au jour le jour.

Chaque salarié a une fiche tiers (créée avec lui) : son net à payer est porté au compte 422 à son nom,
ce qui permet à la finance de lettrer le virement de chacun.
"""

from datetime import date

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import UserError

CATEGORIES = [("cadre", "Cadre"), ("maitrise", "Agent de maîtrise"), ("employe", "Employé"), ("ouvrier", "Ouvrier")]
CONTRACTS = [("cdi", "CDI"), ("cdd", "CDD"), ("stage", "Stage"), ("apprentissage", "Apprentissage")]
MARITAL = [("celibataire", "Célibataire"), ("marie", "Marié(e)"), ("divorce", "Divorcé(e)"), ("veuf", "Veuf (veuve)")]
PAYMENT_METHODS = [("virement", "Virement bancaire"), ("especes", "Espèces"), ("mobile", "Mobile money")]
EXIT_REASONS = [("demission", "Démission"), ("licenciement", "Licenciement"), ("fin_contrat", "Fin de contrat"),
                ("rupture_conventionnelle", "Rupture d'un commun accord"), ("retraite", "Départ à la retraite"),
                ("deces", "Décès"), ("autre", "Autre motif")]
DOCUMENT_KINDS = [("cni", "Carte d'identité"), ("passeport", "Passeport"), ("contrat", "Contrat de travail"),
                  ("avenant", "Avenant"), ("diplome", "Diplôme"), ("visite_medicale", "Visite médicale"),
                  ("permis", "Permis de conduire"), ("titre_sejour", "Titre de séjour"), ("autre", "Autre document")]
STATES = [("a_venir", "À venir"), ("essai", "Période d'essai"), ("actif", "Actif"), ("sorti", "Sorti")]
# Données du dossier qui entrent dans la paie. Les modifier (comme créer un salarié ou toucher à ses
# éléments fixes) inscrit le compte parmi les préparateurs des paies en préparation concernées : il ne
# pourra pas les valider (quatre yeux).
PAYROLL_FIELDS = frozenset({"base_salary", "line_ids", "payment_method", "bank_name", "bank_account", "mobile_money",
                            "user_id", "hire_date", "exit_date", "company_id", "contract_type", "driver_id"})


def full_months(start, end):
    """Mois entiers écoulés entre deux dates (un mois de service commencé le 15 est acquis le 15 suivant)."""
    if not start or not end or end < start:
        return 0
    delta = relativedelta(end, start)
    return delta.years * 12 + delta.months


class EguitraRhEmployee(models.Model):
    _name = "eguitra.rh.employee"
    _description = "Salarié"
    _order = "name"
    _check_company_auto = True

    name = fields.Char("Nom et prénoms", required=True)
    matricule = fields.Char("Matricule", readonly=True, copy=False, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    active = fields.Boolean(default=True)

    gender = fields.Selection([("homme", "Homme"), ("femme", "Femme")], "Sexe")
    birth_date = fields.Date("Date de naissance")
    birth_place = fields.Char("Lieu de naissance")
    nationality = fields.Char("Nationalité", default="Guinéenne")
    id_number = fields.Char("Pièce d'identité")
    cnss_number = fields.Char("Numéro CNSS")
    marital_status = fields.Selection(MARITAL, "Situation familiale")
    children = fields.Integer("Enfants à charge")
    phone = fields.Char("Téléphone")
    email = fields.Char("Courriel")
    address = fields.Char("Adresse")
    emergency_contact = fields.Char("Personne à prévenir")
    emergency_phone = fields.Char("Téléphone de la personne à prévenir")

    job_title = fields.Char("Poste")
    # Gestion RH commune aux deux sociétés : département commun ou de l'employeur, responsable de
    # l'une ou l'autre société (contrôlés par _check_links).
    department_id = fields.Many2one("eguitra.rh.department", "Département")
    manager_id = fields.Many2one("eguitra.rh.employee", "Responsable hiérarchique")
    category = fields.Selection(CATEGORIES, "Catégorie")
    activity_account_id = fields.Many2one(
        "account.analytic.account", "Activité",
        help="Axe d'activité où la masse salariale du salarié est imputée (transport, BTP, immobilier, conseil…).")
    contract_type = fields.Selection(CONTRACTS, "Contrat", required=True, default="cdi")
    hire_date = fields.Date("Date d'embauche", required=True)
    contract_end = fields.Date("Fin du contrat")
    trial_end = fields.Date("Fin de la période d'essai")
    exit_date = fields.Date("Date de sortie")
    exit_reason = fields.Selection(EXIT_REASONS, "Motif de sortie")

    base_salary = fields.Monetary("Salaire de base mensuel")
    line_ids = fields.One2many("eguitra.rh.employee.line", "employee_id", "Éléments fixes")
    payment_method = fields.Selection(PAYMENT_METHODS, "Mode de paiement", required=True, default="virement")
    bank_name = fields.Char("Banque")
    bank_account = fields.Char("Compte bancaire")
    mobile_money = fields.Char("Numéro mobile money")

    user_id = fields.Many2one("res.users", "Compte NIMOVA", help="Ouvre « Mon espace » au salarié.", index=True)
    driver_id = fields.Many2one("eguitra.transport.driver", "Chauffeur", check_company=True)
    partner_id = fields.Many2one("res.partner", "Fiche tiers", readonly=True, copy=False)

    leave_initial = fields.Float("Solde de congés de reprise")
    leave_initial_date = fields.Date("Date du solde de reprise")
    document_ids = fields.One2many("eguitra.rh.document", "employee_id", "Documents")
    salary_change_ids = fields.One2many("eguitra.rh.salary.change", "employee_id", "Historique du salaire")
    leave_ids = fields.One2many("eguitra.rh.leave", "employee_id", "Absences")
    note = fields.Text("Observations")

    _matricule_unique = models.Constraint("unique(company_id, matricule)", "Ce matricule existe déjà.")

    @api.constrains("hire_date", "contract_end", "trial_end", "exit_date", "contract_type")
    def _check_dates(self):
        for emp in self:
            if emp.contract_end and emp.contract_end < emp.hire_date:
                raise UserError("La fin du contrat précède l'embauche.")
            if emp.trial_end and emp.trial_end < emp.hire_date:
                raise UserError("La fin de la période d'essai précède l'embauche.")
            if emp.exit_date and emp.exit_date < emp.hire_date:
                raise UserError("La date de sortie précède l'embauche.")
            if emp.contract_type == "cdd" and not emp.contract_end:
                raise UserError("Un CDD a une date de fin.")

    @api.constrains("department_id", "activity_account_id", "company_id")
    def _check_links(self):
        for emp in self:
            if emp.department_id.company_id and emp.department_id.company_id != emp.company_id:
                raise UserError(f"Le département {emp.department_id.name} appartient à une autre société.")
            if emp.activity_account_id.company_id and emp.activity_account_id.company_id != emp.company_id:
                raise UserError(f"L'activité {emp.activity_account_id.name} appartient à une autre société.")

    @api.constrains("user_id")
    def _check_user(self):
        for emp in self.filtered("user_id"):
            if emp.user_id.share:
                raise UserError("Un compte du portail ne peut pas être lié à un salarié.")
            others = self.sudo().with_context(active_test=False).search_count(
                [("user_id", "=", emp.user_id.id), ("id", "!=", emp.id), ("company_id", "=", emp.company_id.id)])
            if others:
                raise UserError(f"Le compte {emp.user_id.login} est déjà lié à un autre salarié.")

    @api.constrains("manager_id")
    def _check_manager(self):
        for emp in self:
            boss, seen = emp.manager_id, set()
            while boss and boss.id not in seen:
                if boss == emp:
                    raise UserError("Un salarié ne peut pas être son propre responsable, même indirectement.")
                seen.add(boss.id)
                boss = boss.manager_id

    # ─── Création, matricule, fiche tiers, historique du salaire ─────────

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        Partner = self.env["res.partner"].sudo()
        for emp in records:
            if not emp.matricule:
                emp.matricule = emp._next_matricule()
            emp.partner_id = Partner.create({
                "name": emp.name, "company_id": emp.company_id.id, "phone": emp.phone or False,
                "email": emp.email or False, "comment": f"Salarié {emp.matricule}",
            })
            if emp.base_salary:
                self.env["eguitra.rh.salary.change"].sudo().create({
                    "employee_id": emp.id, "date": emp.hire_date, "old_salary": 0, "new_salary": emp.base_salary,
                    "reason": "Embauche",
                })
        records._draft_payrolls()._mark_prepared()
        return records

    def write(self, vals):
        reason = self.env.context.get("salary_reason")
        changes = []
        if "base_salary" in vals:
            for emp in self:
                if emp.base_salary != vals["base_salary"]:
                    changes.append((emp, emp.base_salary))
        # Paies concernées avant et après la modification (dates du contrat, société).
        payrolls = self._draft_payrolls() if PAYROLL_FIELDS & set(vals) else None
        result = super().write(vals)
        if payrolls is not None:
            (payrolls | self._draft_payrolls())._mark_prepared()
        for emp, old in changes:
            self.env["eguitra.rh.salary.change"].sudo().create({
                "employee_id": emp.id, "date": fields.Date.context_today(self), "old_salary": old,
                "new_salary": emp.base_salary, "reason": reason or False,
            })
        sync = {k: vals[k] for k in ("name", "phone", "email") if k in vals}
        if sync:
            self.partner_id.sudo().write({k: v or False for k, v in sync.items()})
        return result

    def _draft_payrolls(self):
        """Paies en préparation de la société du salarié dont le mois recoupe son contrat."""
        Payroll = self.env["eguitra.rh.payroll"].sudo()
        result = Payroll
        for company in self.sudo().company_id:
            payrolls = Payroll.search([("company_id", "=", company.id), ("state", "=", "draft")])
            for emp in self.sudo().filtered(lambda e, c=company: e.company_id == c):
                for payroll in payrolls:
                    start, end = month_bounds(payroll.month)
                    if emp.hire_date <= end and (not emp.exit_date or emp.exit_date >= start):
                        result |= payroll
        return result

    def _next_matricule(self):
        """EG-0001 pour EGUITRA GROUP, AX-0001 pour MB AxisPro, numéros propres à chaque société."""
        self.ensure_one()
        prefix = {"groupe": "EG", "cabinet": "AX"}.get(self.company_id.eguitra_entity) or "SAL"
        existing = self.sudo().with_context(active_test=False).search(
            [("company_id", "=", self.company_id.id), ("matricule", "=like", prefix + "-%")]).mapped("matricule")
        numbers = [int(m.split("-")[-1]) for m in existing if m.split("-")[-1].isdigit()]
        return f"{prefix}-{(max(numbers) if numbers else 0) + 1:04d}"

    # ─── État, ancienneté, âge ───────────────────────────────────────────

    def _state(self, today=None):
        self.ensure_one()
        today = today or fields.Date.context_today(self)
        if self.exit_date and self.exit_date < today:
            return "sorti"
        if self.hire_date > today:
            return "a_venir"
        if self.trial_end and self.trial_end >= today:
            return "essai"
        return "actif"

    def _seniority(self, today=None):
        self.ensure_one()
        today = today or fields.Date.context_today(self)
        end = min(today, self.exit_date) if self.exit_date else today
        return round(full_months(self.hire_date, end) / 12.0, 1)

    def _age(self, today=None):
        self.ensure_one()
        if not self.birth_date:
            return None
        today = today or fields.Date.context_today(self)
        return relativedelta(today, self.birth_date).years

    def _monthly_gross(self):
        """Salaire de base et éléments fixes en montant (les heures fixes au taux horaire majoré)."""
        self.ensure_one()
        params = self.env["eguitra.rh.settings"]._get(self.company_id).params()
        total = self.base_salary
        for line in self.line_ids.filtered(lambda l: l.rubric_id.kind == "gain"):
            total += line._amount(self.base_salary, params)
        return total

    def _issues(self):
        """Points à compléter, en clair."""
        self.ensure_one()
        issues = []
        if not self.cnss_number and self.contract_type not in ("stage", "apprentissage"):
            issues.append("Numéro CNSS manquant")
        if self.payment_method == "virement" and not self.bank_account:
            issues.append("Compte bancaire manquant")
        if self.payment_method == "mobile" and not self.mobile_money:
            issues.append("Numéro mobile money manquant")
        if not self.activity_account_id:
            issues.append("Activité d'imputation manquante")
        if not self.base_salary:
            issues.append("Salaire de base non renseigné")
        if not self.id_number:
            issues.append("Pièce d'identité manquante")
        return issues

    # ─── Congés ──────────────────────────────────────────────────────────

    def _leave_balance(self, on_date=None):
        """Solde de congés : reprise + acquis au fil des mois de service - jours approuvés."""
        self.ensure_one()
        on_date = on_date or fields.Date.context_today(self)
        settings = self.env["eguitra.rh.settings"]._get(self.company_id)
        start = self.leave_initial_date or self.hire_date
        end = min(on_date, self.exit_date) if self.exit_date else on_date
        acquired = full_months(start, end) * settings.leave_days_per_month
        leaves = self.env["eguitra.rh.leave"].sudo().search([
            ("employee_id", "=", self.id), ("type_id.deducts_balance", "=", True), ("date_from", ">=", start),
            ("state", "in", ("submitted", "approved")),
        ])
        taken = sum(leaves.filtered(lambda l: l.state == "approved").mapped("days"))
        pending = sum(leaves.filtered(lambda l: l.state == "submitted").mapped("days"))
        initial = self.leave_initial or 0.0
        return {
            "initial": initial, "initial_date": self.leave_initial_date or None, "acquired": round(acquired, 2),
            "taken": taken, "pending": pending, "balance": round(initial + acquired - taken, 2),
        }

    def _absent_on(self, day):
        self.ensure_one()
        return bool(self.env["eguitra.rh.leave"].sudo().search_count([
            ("employee_id", "=", self.id), ("state", "=", "approved"), ("date_from", "<=", day), ("date_to", ">=", day)]))

    # ─── Sortie ──────────────────────────────────────────────────────────

    def action_exit(self, exit_date, reason):
        """Sortie du salarié. Son compte NIMOVA reste ouvert à ses autres applications ; « Mon espace »
        se ferme avec la sortie (res.users._eguitra_apps)."""
        if not exit_date:
            raise UserError("Date de sortie obligatoire.")
        self.write({"exit_date": exit_date, "exit_reason": reason or "autre"})

    @api.model
    def _active_in(self, company, date_from, date_to):
        """Salariés sous contrat pendant au moins un jour de la période."""
        return self.search([("company_id", "=", company.id), ("hire_date", "<=", date_to),
                            "|", ("exit_date", "=", False), ("exit_date", ">=", date_from)])


class EguitraRhEmployeeLine(models.Model):
    _name = "eguitra.rh.employee.line"
    _description = "Élément fixe du salaire"
    _order = "id"

    employee_id = fields.Many2one("eguitra.rh.employee", required=True, ondelete="cascade", index=True)
    rubric_id = fields.Many2one("eguitra.rh.rubric", "Rubrique", required=True, domain=[("system", "=", False)])
    amount = fields.Float("Montant mensuel")
    quantity = fields.Float("Heures par mois")

    # Élément fixe créé, modifié ou supprimé : son auteur prépare les paies en préparation concernées.
    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records.employee_id._draft_payrolls()._mark_prepared()
        return records

    def write(self, vals):
        payrolls = self.employee_id._draft_payrolls()
        result = super().write(vals)
        (payrolls | self.employee_id._draft_payrolls())._mark_prepared()
        return result

    def unlink(self):
        self.employee_id._draft_payrolls()._mark_prepared()
        return super().unlink()

    def _amount(self, base_salary, params):
        self.ensure_one()
        if self.rubric_id.input == "hours":
            hourly = base_salary / params.monthly_hours if params.monthly_hours else 0.0
            return self.quantity * hourly * (1 + (self.rubric_id.overtime_rate or 0.0) / 100.0)
        return self.amount


class EguitraRhDocument(models.Model):
    _name = "eguitra.rh.document"
    _description = "Document du salarié"
    _order = "expiry_date, id"

    employee_id = fields.Many2one("eguitra.rh.employee", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="employee_id.company_id", store=True)
    kind = fields.Selection(DOCUMENT_KINDS, "Nature", required=True, default="autre")
    name = fields.Char("Libellé", required=True)
    expiry_date = fields.Date("Expire le")
    attachment_id = fields.Many2one("ir.attachment", "Fichier", ondelete="set null")


class EguitraRhSalaryChange(models.Model):
    _name = "eguitra.rh.salary.change"
    _description = "Changement du salaire de base"
    _order = "date desc, id desc"

    employee_id = fields.Many2one("eguitra.rh.employee", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="employee_id.company_id", store=True)
    date = fields.Date("Date", required=True)
    old_salary = fields.Float("Ancien salaire")
    new_salary = fields.Float("Nouveau salaire")
    reason = fields.Char("Motif")


def month_bounds(month):
    start = month.replace(day=1)
    return start, start + relativedelta(months=1, days=-1)


def first_of_month(value):
    if isinstance(value, str):
        value = fields.Date.to_date(value)
    return date(value.year, value.month, 1)
