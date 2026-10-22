"""Paie du mois : bulletins des salariés présents dans le mois, contrôles, validation, écriture de paie.

Cycle : en préparation (bulletins recalculables, éléments variables saisis) -> validée (bulletins
figés, imprimables, avances décomptées) -> comptabilisée (pièce en brouillon dans le journal des
salaires, que la finance relit et comptabilise). Une paie se rouvre tant que la pièce n'est pas
comptabilisée par la finance.

Quatre yeux : la RH prépare la paie, la direction (ou l'administration, qui l'implique) la valide,
jamais un compte qui l'a préparée, retenu dans « Préparée par » : création, recalcul, bulletins,
lignes et éléments variables, mais aussi, tant qu'elle est en préparation, les données qui y entrent
(dossier du salarié, éléments fixes, avances et prêts : models/employee.py et advance.py).
"""

from collections import defaultdict

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError

from ..engine import Item, amount_in_words, compute
from .employee import CATEGORIES, CONTRACTS, month_bounds

MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
          "novembre", "décembre"]
STATES = [("draft", "En préparation"), ("validated", "Validée"), ("accounted", "Comptabilisée")]
VARIATION_ALERT = 20.0
# Profils qui valident la paie (l'administration implique la direction) ; jamais la RH.
VALIDATORS = ("admin", "direction")
# Statut, validation et préparateurs : écrits par les seules actions de la paie (calcul, validation,
# réouverture, comptabilisation), jamais directement, même en sudo.
WORKFLOW_FIELDS = frozenset({"state", "validated_by", "validated_at", "prepared_by_ids"})
WORKFLOW_MESSAGE = ("Le statut, la validation et les préparateurs d'une paie ne changent que par ses actions : "
                    "calcul, validation, réouverture, comptabilisation.")
WORKFLOW_KEY = "eguitra_rh_payroll_workflow"
# Drapeau de contexte de confiance : un objet Python, qu'aucun appel distant (contexte en JSON) ne peut
# reproduire. Posé par trusted() dans les seules actions de la paie, le suivi du solde des avances et la
# migration 19.0.1.0.1.
_TRUSTED = object()


def trusted(records):
    """Les mêmes enregistrements, pour une écriture qui vient des actions de la paie."""
    return records.with_context(**{WORKFLOW_KEY: _TRUSTED})


def is_trusted(env):
    return env.context.get(WORKFLOW_KEY) is _TRUSTED


def month_label(month):
    return f"{MONTHS[month.month - 1]} {month.year}"


class EguitraRhPayroll(models.Model):
    _name = "eguitra.rh.payroll"
    _description = "Paie du mois"
    _order = "month desc, id desc"

    name = fields.Char("Paie", compute="_compute_name", store=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    month = fields.Date("Mois", required=True, index=True)
    state = fields.Selection(STATES, default="draft", required=True, index=True)
    payslip_ids = fields.One2many("eguitra.rh.payslip", "payroll_id", "Bulletins")
    move_id = fields.Many2one("account.move", "Écriture de paie", readonly=True, copy=False)
    validated_by = fields.Many2one("res.users", "Validée par", readonly=True)
    validated_at = fields.Datetime("Validée le", readonly=True)
    prepared_by_ids = fields.Many2many(
        "res.users", "eguitra_rh_payroll_preparer_rel", "payroll_id", "user_id", "Préparée par", readonly=True,
        copy=False, help="Comptes qui ont créé ou recalculé la paie, saisi ses éléments variables, ou modifié "
                         "pendant sa préparation des données qui y entrent : aucun d'eux ne la valide.")

    _month_unique = models.Constraint("unique(company_id, month)", "La paie de ce mois existe déjà.")

    @api.depends("month")
    def _compute_name(self):
        for payroll in self:
            payroll.name = f"Paie de {month_label(payroll.month)}" if payroll.month else "Paie"

    @api.model_create_multi
    def create(self, vals_list):
        if not is_trusted(self.env):
            for vals in vals_list:
                if WORKFLOW_FIELDS & set(vals) - {"state"} or vals.get("state", "draft") != "draft":
                    raise AccessError(WORKFLOW_MESSAGE)
        return super().create(vals_list)

    def write(self, vals):
        if WORKFLOW_FIELDS & set(vals) and not is_trusted(self.env):
            raise AccessError(WORKFLOW_MESSAGE)
        return super().write(vals)

    @api.model
    def prepare(self, company, month):
        month = month.replace(day=1)
        if self.search_count([("company_id", "=", company.id), ("month", "=", month)]):
            raise UserError(f"La paie de {month_label(month)} existe déjà.")
        payroll = self.create({"company_id": company.id, "month": month})
        payroll.action_compute()
        return payroll

    def _check_draft(self):
        for payroll in self:
            if payroll.state != "draft":
                raise UserError(f"{payroll.name} est validée : rouvrez-la pour la modifier.")

    def _mark_prepared(self):
        """Retient le compte qui prépare la paie (création, recalcul, éléments variables). Sous sudo,
        env.user reste le compte connecté."""
        user = self.env.user
        todo = self.sudo().filtered(lambda p: user not in p._preparers())
        if todo:
            trusted(todo).write({"prepared_by_ids": [fields.Command.link(user.id)]})

    def _on_preparation_change(self):
        """Bulletin, ligne ou élément variable créé, modifié ou supprimé, y compris directement dans l'ORM :
        paie en préparation seulement, et le compte est retenu dans « Préparée par »."""
        self._check_draft()
        self._mark_prepared()

    def _preparers(self):
        """« Préparée par » au complet. Lu sans le filtre des comptes actifs : l'ORM masque sinon les comptes
        archivés, dont le compte système, alors qu'ils sont bien enregistrés."""
        self.ensure_one()
        return self.sudo().with_context(active_test=False).prepared_by_ids

    def _prepared_by(self, user):
        self.ensure_one()
        return user == self.create_uid or user in self._preparers()

    def action_compute(self):
        """Ajoute les salariés présents dans le mois, retire ceux qui n'y sont plus, recalcule tout."""
        self._check_draft()
        self._mark_prepared()
        Payslip = self.env["eguitra.rh.payslip"]
        for payroll in self:
            start, end = month_bounds(payroll.month)
            employees = self.env["eguitra.rh.employee"]._active_in(payroll.company_id, start, end)
            payroll.payslip_ids.filtered(lambda s: s.employee_id not in employees).unlink()
            present = payroll.payslip_ids.employee_id
            for emp in employees - present:
                Payslip.create({"payroll_id": payroll.id, "employee_id": emp.id})
            payroll.payslip_ids._compute_slip()
            # Salarié sans aucun jour ouvrable dans le mois (entrée le dernier dimanche, par exemple).
            payroll.payslip_ids.filtered(lambda s: not s.presence_days).unlink()

    def _can_validate(self, user):
        self.ensure_one()
        return bool(set(VALIDATORS) & set(user._eguitra_profiles())) and not self.sudo()._prepared_by(user)

    def action_validate(self):
        """Validation par la direction (ou l'administration), jamais par un compte qui a préparé la paie.
        La direction n'a que la lecture sur la paie : après ces contrôles, les écritures se font en sudo,
        sous l'identité du compte (validated_by)."""
        self._check_draft()
        user = self.env.user
        for payroll in self:
            if not set(VALIDATORS) & set(user._eguitra_profiles()):
                raise AccessError("La paie est validée par la direction.")
            if payroll.sudo()._prepared_by(user):
                raise AccessError("La paie doit être validée par une autre personne que celle qui l'a préparée "
                                  "(création, calcul ou éléments variables).")
            if not payroll.payslip_ids:
                raise UserError("Aucun bulletin : aucun salarié n'est sous contrat ce mois-là.")
            blocking = [f"{s.employee_id.name} : {a['message']}" for s in payroll.payslip_ids
                        for a in s._anomalies() if a["severity"] == "danger"]
            if blocking:
                raise UserError("Paie non validée : " + " ; ".join(blocking))
            trusted(payroll.sudo()).write({"state": "validated", "validated_by": user.id,
                                           "validated_at": fields.Datetime.now()})
            payroll.sudo()._advances()._update_state()

    def action_reopen(self):
        for payroll in self:
            if payroll.state == "draft":
                continue
            move = payroll.move_id.sudo()
            if move.exists() and move.state == "posted":
                raise UserError("L'écriture de paie est comptabilisée : la finance doit d'abord la remettre en "
                                "brouillon ou l'annuler.")
            if move.exists():
                move.unlink()
            trusted(payroll).write({"state": "draft", "move_id": False, "validated_by": False, "validated_at": False})
            payroll._advances()._update_state()

    def _advances(self):
        return self.payslip_ids.input_ids.advance_id

    # ─── Totaux et répartitions ──────────────────────────────────────────

    def _totals(self):
        self.ensure_one()
        slips = self.payslip_ids
        keys = ("gross", "cnss_employee", "cnss_employer", "rts", "vf", "training_tax", "deductions", "net",
                "employer_cost")
        totals = {k: sum(slips.mapped(k)) for k in keys}
        totals["headcount"] = len(slips)
        return totals

    def _by(self, key):
        self.ensure_one()
        groups = defaultdict(lambda: {"headcount": 0, "gross": 0.0, "employer_cost": 0.0})
        for slip in self.payslip_ids:
            record = slip.activity_id if key == "activity" else slip.department_id
            name = record.name if record else ("Sans activité" if key == "activity" else "Sans département")
            groups[name]["headcount"] += 1
            groups[name]["gross"] += slip.gross
            groups[name]["employer_cost"] += slip.employer_cost
        return [dict(v, name=k) for k, v in sorted(groups.items(), key=lambda kv: -kv[1]["employer_cost"])]

    # ─── Écriture de paie ────────────────────────────────────────────────

    def action_account(self):
        for payroll in self:
            if payroll.state != "validated":
                raise UserError("Seule une paie validée et non comptabilisée peut être comptabilisée.")
            move = payroll._create_move()
            trusted(payroll).write({"move_id": move.id, "state": "accounted"})

    def _create_move(self):
        """Pièce en brouillon : charges par activité, organismes, retenues et nets au nom des salariés."""
        self.ensure_one()
        settings = self.env["eguitra.rh.settings"]._get(self.company_id)
        _start, end = month_bounds(self.month)
        acc = {key: settings._account(settings[field]) for key, field in (
            ("social", "account_social_charges"), ("vf", "account_payroll_taxes"), ("tf", "account_training_tax"),
            ("cnss", "account_cnss"), ("rts", "account_rts"), ("taxes", "account_payroll_taxes_payable"),
            ("net", "account_net_payable"), ("advances", "account_advances"))}
        cache = {}

        def account(code, default):
            code = code or settings[default]
            if code not in cache:
                cache[code] = settings._account(code)
            return cache[code]

        amounts = defaultdict(float)  # (compte, axe, tiers, libellé) -> débit (positif) ou crédit (négatif)
        label = f"Paie de {month_label(self.month)}"
        for slip in self.payslip_ids:
            axis = slip.activity_id.id or 0
            partner = slip.employee_id.partner_id.id or 0
            for line in slip.line_ids:
                if line.kind == "gain":
                    target = account(line.account_code, "account_salary")
                    amounts[(target.id, axis, 0, f"{label} : {target.name}")] += line.amount
                elif line.kind == "deduction" and line.code == "CNSS":
                    amounts[(acc["cnss"].id, 0, 0, f"{label} : CNSS")] -= line.amount
                elif line.kind == "deduction" and line.code == "RTS":
                    amounts[(acc["rts"].id, 0, 0, f"{label} : RTS")] -= line.amount
                elif line.kind == "deduction":
                    target = account(line.account_code, "account_advances")
                    amounts[(target.id, 0, partner, f"{line.name}, {slip.employee_id.name}")] -= line.amount
                elif line.code == "CNSS_PAT":
                    amounts[(acc["social"].id, axis, 0, f"{label} : charges sociales")] += line.amount
                    amounts[(acc["cnss"].id, 0, 0, f"{label} : CNSS")] -= line.amount
                elif line.code == "VF":
                    amounts[(acc["vf"].id, axis, 0, f"{label} : versement forfaitaire")] += line.amount
                    amounts[(acc["taxes"].id, 0, 0, f"{label} : taxes sur salaires")] -= line.amount
                elif line.code == "TF":
                    amounts[(acc["tf"].id, axis, 0, f"{label} : {settings.training_tax_label or 'taxe de formation'}")] += line.amount
                    amounts[(acc["taxes"].id, 0, 0, f"{label} : taxes sur salaires")] -= line.amount
            if slip.net:
                amounts[(acc["net"].id, 0, partner, f"Net à payer, {slip.employee_id.name}")] -= slip.net
        if round(sum(amounts.values()), 2):
            raise UserError("Écriture de paie déséquilibrée : signalez-le au support.")
        lines = []
        for (account_id, axis, partner, name), value in amounts.items():
            if not round(value, 2):
                continue
            lines.append(fields.Command.create({
                "account_id": account_id, "name": name, "partner_id": partner or False,
                "debit": value if value > 0 else 0.0, "credit": -value if value < 0 else 0.0,
                **({"analytic_distribution": {str(axis): 100}} if axis else {}),
            }))
        return self.env["account.move"].sudo().with_company(self.company_id).create({
            "move_type": "entry", "journal_id": settings._journal().id, "date": end, "ref": f"Paie {self.month:%Y-%m}",
            "company_id": self.company_id.id, "line_ids": lines,
        })


class EguitraRhPayslip(models.Model):
    _name = "eguitra.rh.payslip"
    _description = "Bulletin de paie"
    _order = "month desc, employee_id"

    payroll_id = fields.Many2one("eguitra.rh.payroll", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="payroll_id.company_id", store=True, index=True)
    # Mois copié de la paie à la création (un champ relié restait vide quand un compte RH créait la paie).
    month = fields.Date(required=True, index=True, readonly=True)
    state = fields.Selection(related="payroll_id.state")
    employee_id = fields.Many2one("eguitra.rh.employee", "Salarié", required=True, index=True, ondelete="restrict")
    line_ids = fields.One2many("eguitra.rh.payslip.line", "payslip_id", "Lignes")
    input_ids = fields.One2many("eguitra.rh.payslip.input", "payslip_id", "Éléments variables")

    # Instantané du dossier au calcul (figé avec la paie).
    job_title = fields.Char("Poste")
    department_id = fields.Many2one("eguitra.rh.department", "Département")
    activity_id = fields.Many2one("account.analytic.account", "Activité")
    category = fields.Selection(CATEGORIES, "Catégorie")
    contract_type = fields.Selection(CONTRACTS, "Contrat")
    base_salary = fields.Float("Salaire de base")

    month_days = fields.Float("Jours ouvrables du mois")
    presence_days = fields.Float("Jours sous contrat")
    unpaid_days = fields.Float("Absences non rémunérées")
    worked_days = fields.Float("Jours payés")
    gross = fields.Float("Brut")
    cnss_base = fields.Float("Assiette CNSS")
    cnss_employee = fields.Float("CNSS salariale")
    cnss_employer = fields.Float("CNSS patronale")
    taxable_base = fields.Float("Brut imposable")
    rts_base = fields.Float("Base de la RTS")
    rts = fields.Float("RTS")
    vf = fields.Float("Versement forfaitaire")
    training_tax = fields.Float("Taxe de formation")
    deductions = fields.Float("Autres retenues")
    net = fields.Float("Net à payer")
    employer_cost = fields.Float("Coût employeur")
    leave_balance = fields.Float("Solde de congés")

    _unique = models.Constraint("unique(payroll_id, employee_id)", "Un seul bulletin par salarié et par mois.")

    @api.model_create_multi
    def create(self, vals_list):
        Payroll = self.env["eguitra.rh.payroll"]
        for vals in vals_list:
            if not vals.get("month") and vals.get("payroll_id"):
                vals["month"] = Payroll.browse(vals["payroll_id"]).month
        records = super().create(vals_list)
        records.payroll_id._on_preparation_change()
        return records

    def write(self, vals):
        self.payroll_id._on_preparation_change()
        return super().write(vals)

    def unlink(self):
        self.payroll_id._on_preparation_change()
        return super().unlink()

    def _rubric(self, xmlid):
        return self.env.ref(f"eguitra_rh.{xmlid}")

    def _compute_slip(self):
        Holiday = self.env["eguitra.rh.holiday"]
        Leave = self.env["eguitra.rh.leave"].sudo()
        for slip in self:
            if slip.payroll_id.state != "draft":
                raise UserError("Bulletin d'une paie validée : rouvrez la paie pour le recalculer.")
            emp = slip.employee_id
            company = slip.company_id
            settings = self.env["eguitra.rh.settings"]._get(company)
            params = settings.params()
            start, end = month_bounds(slip.month)
            first = max(emp.hire_date, start)
            last = min(emp.exit_date, end) if emp.exit_date else end
            month_days = Holiday._working_days(company, start, end)
            presence = Holiday._working_days(company, first, last) if first <= last else 0
            unpaid = 0.0
            for leave in Leave.search([("employee_id", "=", emp.id), ("state", "=", "approved"),
                                       ("type_id.paid", "=", False), ("date_from", "<=", last),
                                       ("date_to", ">=", first)]):
                days = Holiday._working_days(company, max(leave.date_from, first), min(leave.date_to, last))
                unpaid += 0.5 if leave.half_day and days else days
            unpaid = min(unpaid, presence)
            ratio_presence = presence / month_days if month_days else 0.0
            ratio_paid = (presence - unpaid) / month_days if month_days else 0.0

            slip._auto_inputs(settings, start, end)

            base = emp.base_salary
            hourly = base / params.monthly_hours if params.monthly_hours else 0.0
            gains, deductions = [], []
            base_rubric = self._rubric("rubric_base")
            gains.append(_item(base_rubric, base * ratio_presence, base=base, quantity=presence))
            if unpaid:
                gains.append(_item(self._rubric("rubric_absence"), -base * unpaid / month_days, base=base,
                                   quantity=unpaid))
            for line in emp.line_ids:
                rubric = line.rubric_id
                if rubric.input == "hours":
                    amount = line.quantity * hourly * (1 + (rubric.overtime_rate or 0.0) / 100.0)
                    item = _item(rubric, amount, base=round(hourly), rate=rubric.overtime_rate, quantity=line.quantity)
                elif rubric.kind == "gain":
                    item = _item(rubric, line.amount * ratio_paid, base=line.amount)
                else:
                    item = _item(rubric, line.amount)
                (gains if rubric.kind == "gain" else deductions).append(item)
            for inp in slip.input_ids:
                rubric = inp.rubric_id
                if rubric.input == "hours":
                    amount = inp.quantity * hourly * (1 + (rubric.overtime_rate or 0.0) / 100.0)
                    inp.amount = amount
                    item = _item(rubric, amount, base=round(hourly), rate=rubric.overtime_rate, quantity=inp.quantity,
                                 name=inp.note and f"{rubric.name} ({inp.note})")
                else:
                    item = _item(rubric, inp.amount, quantity=inp.quantity or None,
                                 name=inp.note and f"{rubric.name} ({inp.note})")
                (gains if rubric.kind == "gain" else deductions).append(item)

            result = compute(params, gains, deductions, emp.contract_type, ratio_presence)
            slip.line_ids.unlink()
            slip.write({
                "job_title": emp.job_title, "department_id": emp.department_id.id,
                "activity_id": emp.activity_account_id.id, "category": emp.category,
                "contract_type": emp.contract_type, "base_salary": base,
                "month_days": month_days, "presence_days": presence, "unpaid_days": unpaid,
                "worked_days": presence - unpaid,
                "gross": result["gross"], "cnss_base": result["cnss_base"], "cnss_employee": result["cnss_employee"],
                "cnss_employer": result["cnss_employer"], "taxable_base": result["taxable_base"],
                "rts_base": result["rts_base"], "rts": result["rts"], "vf": result["vf"],
                "training_tax": result["training_tax"], "deductions": result["deductions"], "net": result["net"],
                "employer_cost": result["employer_cost"],
                "leave_balance": emp._leave_balance(end)["balance"],
                "line_ids": [fields.Command.create(dict({k: (0 if v is None else v) for k, v in line.items()},
                                                        sequence=index, account_code=_account_of(line, gains + deductions)))
                             for index, line in enumerate(result["lines"])],
            })

    def _auto_inputs(self, settings, start, end):
        """Éléments variables produits par le moteur : primes de rotation, échéances d'avances et de prêts."""
        self.ensure_one()
        self.input_ids.filtered(lambda i: i.source != "manual").unlink()
        emp = self.employee_id
        Input = self.env["eguitra.rh.payslip.input"]
        if settings.rotation_bonus and emp.driver_id and "eguitra.transport.rotation" in self.env:
            count = self.env["eguitra.transport.rotation"].sudo().search_count([
                ("driver_id", "=", emp.driver_id.id), ("state", "in", ("done", "invoiced")),
                ("date_loading", ">=", start), ("date_loading", "<=", end),
            ])
            if count:
                Input.create({"payslip_id": self.id, "rubric_id": self._rubric("rubric_rotation").id, "source": "rotation",
                              "quantity": count, "amount": count * settings.rotation_bonus,
                              "note": f"{count} rotation(s) validée(s)"})
        advances = self.env["eguitra.rh.advance"].sudo().search([("employee_id", "=", emp.id), ("state", "=", "open")])
        for adv in advances:
            due = adv._due_for(self)
            if due > 0:
                rubric = self._rubric("rubric_pret" if adv.kind == "pret" else "rubric_avance")
                Input.create({"payslip_id": self.id, "rubric_id": rubric.id, "source": "advance", "advance_id": adv.id,
                              "amount": due, "note": adv.note or False})

    def _previous(self):
        self.ensure_one()
        return self.search([("employee_id", "=", self.employee_id.id), ("month", "<", self.month),
                            ("payroll_id.state", "!=", "draft")], order="month desc", limit=1)

    def _net_variation(self):
        self.ensure_one()
        previous = self._previous()
        if not previous or not previous.net:
            return None
        return round((self.net - previous.net) / previous.net * 100.0, 1)

    def _anomalies(self):
        """Contrôles du bulletin. danger : bloque la validation de la paie."""
        self.ensure_one()
        emp = self.employee_id
        settings = self.env["eguitra.rh.settings"]._get(self.company_id)
        found = []
        if self.net < 0:
            found.append(("net_negative", "danger", "Net à payer négatif : réduisez les retenues."))
        full_month = self.presence_days and self.presence_days == self.month_days and not self.unpaid_days
        if full_month and self.contract_type in ("cdi", "cdd") and self.gross < settings.smig:
            found.append(("below_smig", "warn", "Brut inférieur au SMIG."))
        if self.cnss_base and not emp.cnss_number:
            found.append(("cnss_number", "warn", "Numéro CNSS manquant (déclaration CNSS)."))
        if emp.payment_method == "virement" and not emp.bank_account:
            found.append(("bank_account", "warn", "Compte bancaire manquant pour le virement."))
        if emp.payment_method == "mobile" and not emp.mobile_money:
            found.append(("mobile_money", "warn", "Numéro mobile money manquant."))
        if not self.activity_id:
            found.append(("activity", "warn", "Activité d'imputation manquante : la charge sera comptabilisée sans axe."))
        if not self.base_salary:
            found.append(("base_salary", "warn", "Salaire de base nul."))
        variation = self._net_variation()
        if variation is not None and abs(variation) > VARIATION_ALERT:
            found.append(("variation", "info", f"Net en écart de {variation:+.0f} % avec le mois précédent."))
        return [{"code": c, "severity": s, "message": m} for c, s, m in found]

    def _ytd(self):
        """Cumuls de l'année civile : bulletins validés des mois précédents et ce bulletin."""
        self.ensure_one()
        earlier = self.search([("employee_id", "=", self.employee_id.id), ("month", ">=", self.month.replace(month=1)),
                               ("month", "<", self.month), ("payroll_id.state", "!=", "draft")])
        slips = earlier | self
        return {k: sum(slips.mapped(k)) for k in ("gross", "cnss_employee", "rts", "net")}

    def _net_in_words(self):
        self.ensure_one()
        return amount_in_words(self.net)


def _item(rubric, amount, base=None, rate=None, quantity=None, name=None):
    return Item(code=rubric.code, name=name or rubric.name, kind=rubric.kind, amount=amount, cnss=rubric.cnss,
                taxable=rubric.taxable, exempt=rubric.exempt_allowance, account_code=rubric.account_code or "",
                base=base, rate=rate, quantity=quantity)


def _account_of(line, items):
    for item in items:
        if item.code == line["code"]:
            return item.account_code
    return ""


class EguitraRhPayslipLine(models.Model):
    _name = "eguitra.rh.payslip.line"
    _description = "Ligne de bulletin"
    _order = "sequence, id"

    payslip_id = fields.Many2one("eguitra.rh.payslip", required=True, ondelete="cascade", index=True)
    sequence = fields.Integer()
    code = fields.Char()
    name = fields.Char()
    kind = fields.Selection([("gain", "Gain"), ("deduction", "Retenue"), ("employer", "Charge patronale"),
                             ("info", "Information")])
    base = fields.Float()
    rate = fields.Float()
    quantity = fields.Float()
    amount = fields.Float()
    account_code = fields.Char()

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records.payslip_id.payroll_id._on_preparation_change()
        return records

    def write(self, vals):
        self.payslip_id.payroll_id._on_preparation_change()
        return super().write(vals)

    def unlink(self):
        self.payslip_id.payroll_id._on_preparation_change()
        return super().unlink()


class EguitraRhPayslipInput(models.Model):
    _name = "eguitra.rh.payslip.input"
    _description = "Élément variable du bulletin"
    _order = "id"

    payslip_id = fields.Many2one("eguitra.rh.payslip", required=True, ondelete="cascade", index=True)
    rubric_id = fields.Many2one("eguitra.rh.rubric", "Rubrique", required=True)
    amount = fields.Float("Montant")
    quantity = fields.Float("Quantité")
    note = fields.Char("Motif")
    source = fields.Selection([("manual", "Saisie"), ("fixed", "Élément fixe"), ("leave", "Absence"),
                               ("advance", "Avance ou prêt"), ("rotation", "Rotations")], default="manual", required=True)
    advance_id = fields.Many2one("eguitra.rh.advance", "Avance", ondelete="set null", index=True)

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records.payslip_id.payroll_id._on_preparation_change()
        return records

    def write(self, vals):
        self.payslip_id.payroll_id._on_preparation_change()
        return super().write(vals)

    def unlink(self):
        self.payslip_id.payroll_id._on_preparation_change()
        return super().unlink()
