"""Données RH dont NIMOVA · HSSEQ a besoin (spécification de la Direction générale, octobre 2026) :
habilitations des salariés (conducteurs surtout), aptitude médicale en statut seul, équipements de
protection individuelle remis, heures réellement travaillées et absences pour accident du travail.

Ces données vivent ici ; HSSEQ n'en lit que des statuts, côté serveur, par les méthodes « _hsseq_ »
ci-dessous (jamais un justificatif, jamais un détail médical : l'aptitude n'est qu'« apte » ou
« inapte » avec sa date de validité). Le verrou de départ V04 d'HSSEQ s'appuie sur
_hsseq_driver_status : habilitation obligatoire pour les conducteurs expirée ou absente, aptitude
« inapte » ou échue.
"""

from datetime import date, timedelta

from odoo import api, fields, models
from odoo.exceptions import UserError

from .employee import month_bounds

STATES = [("valide", "Valide"), ("a_renouveler", "À renouveler"), ("expiree", "Expirée"), ("absente", "Absente")]
FITNESS = [("apte", "Apte"), ("inapte", "Inapte")]
PPE_ITEMS = [("casque", "Casque"), ("chaussures", "Chaussures de sécurité"), ("gants", "Gants"),
             ("gilet", "Gilet haute visibilité"), ("lunettes", "Lunettes de protection"),
             ("combinaison", "Combinaison"), ("masque", "Masque respiratoire"), ("bouchons", "Protection auditive"),
             ("harnais", "Harnais"), ("autre", "Autre équipement")]


def state_on(expiry, day, alert_days):
    """Statut d'une échéance au jour donné : expirée le lendemain de sa date, à renouveler dans le délai."""
    if not expiry:
        return "valide"
    if expiry < day:
        return "expiree"
    if (expiry - day).days <= alert_days:
        return "a_renouveler"
    return "valide"


class EguitraRhQualificationType(models.Model):
    _name = "eguitra.rh.qualification.type"
    _description = "Type d'habilitation"
    _order = "sequence, name"

    code = fields.Char("Code", required=True)
    name = fields.Char("Habilitation", required=True)
    validity_months = fields.Integer("Durée de validité (mois)", help="0 : sans échéance. Propose l'expiration à la saisie.")
    mandatory_for_drivers = fields.Boolean("Obligatoire pour les conducteurs",
                                           help="Absente, expirée : le conducteur ne peut pas partir (verrou V04 d'HSSEQ).")
    needs_document = fields.Boolean("Justificatif exigé", default=True)
    sequence = fields.Integer(default=50)
    active = fields.Boolean(default=True)

    _code_unique = models.Constraint("unique(code)", "Ce code d'habilitation existe déjà.")


class EguitraRhQualification(models.Model):
    _name = "eguitra.rh.qualification"
    _description = "Habilitation d'un salarié"
    _order = "expiry_date, id"
    _check_company_auto = True

    employee_id = fields.Many2one("eguitra.rh.employee", "Salarié", required=True, index=True, ondelete="cascade",
                                  check_company=True)
    company_id = fields.Many2one(related="employee_id.company_id", store=True, index=True)
    type_id = fields.Many2one("eguitra.rh.qualification.type", "Habilitation", required=True, index=True)
    obtained_date = fields.Date("Obtenue le")
    expiry_date = fields.Date("Expire le", index=True)
    reference = fields.Char("Numéro ou référence")
    issuer = fields.Char("Délivrée par")
    attachment_id = fields.Many2one("ir.attachment", "Justificatif", ondelete="set null")
    note = fields.Char("Observation")

    @api.constrains("obtained_date", "expiry_date")
    def _check_dates(self):
        for qual in self:
            if qual.obtained_date and qual.expiry_date and qual.expiry_date < qual.obtained_date:
                raise UserError("L'expiration précède l'obtention.")

    def _state(self, day=None):
        self.ensure_one()
        day = day or fields.Date.context_today(self)
        settings = self.env["eguitra.rh.settings"]._get(self.employee_id.company_id)
        return state_on(self.expiry_date, day, settings.qualification_alert_days)


class EguitraRhPpeIssue(models.Model):
    _name = "eguitra.rh.ppe.issue"
    _description = "Équipement de protection individuelle remis"
    _order = "date desc, id desc"
    _check_company_auto = True

    employee_id = fields.Many2one("eguitra.rh.employee", "Salarié", required=True, index=True, ondelete="cascade",
                                  check_company=True)
    company_id = fields.Many2one(related="employee_id.company_id", store=True, index=True)
    item = fields.Selection(PPE_ITEMS, "Équipement", required=True)
    description = fields.Char("Précision (modèle, norme)")
    size = fields.Char("Taille")
    quantity = fields.Integer("Quantité", default=1)
    date = fields.Date("Remis le", required=True, default=fields.Date.context_today)
    renewal_date = fields.Date("À renouveler le")
    acknowledged = fields.Boolean("Remise signée par le salarié")
    note = fields.Char("Observation")

    @api.constrains("quantity")
    def _check_quantity(self):
        if any(p.quantity <= 0 for p in self):
            raise UserError("La quantité remise est positive.")


class EguitraRhEmployee(models.Model):
    _inherit = "eguitra.rh.employee"

    # Aptitude médicale en statut seul : aucun détail médical n'est jamais enregistré ici.
    medical_fitness = fields.Selection(FITNESS, "Aptitude médicale")
    medical_fitness_date = fields.Date("Date de la visite d'aptitude")
    medical_fitness_until = fields.Date("Aptitude valable jusqu'au")
    qualification_ids = fields.One2many("eguitra.rh.qualification", "employee_id", "Habilitations")
    ppe_issue_ids = fields.One2many("eguitra.rh.ppe.issue", "employee_id", "EPI remis")

    def _fitness_state(self, day=None):
        """« apte », « inapte », « echue » (aptitude dépassée) ou « inconnu »."""
        self.ensure_one()
        day = day or fields.Date.context_today(self)
        if not self.medical_fitness:
            return "inconnu"
        if self.medical_fitness == "inapte":
            return "inapte"
        if self.medical_fitness_until and self.medical_fitness_until < day:
            return "echue"
        return "apte"

    def _qualification_rows(self, day=None):
        """Habilitations du salarié par type : la plus récente de chaque type, plus les types obligatoires
        absents (pour un conducteur)."""
        self.ensure_one()
        day = day or fields.Date.context_today(self)
        settings = self.env["eguitra.rh.settings"]._get(self.company_id)
        best = {}
        for qual in self.sudo().qualification_ids.sorted(lambda q: (q.expiry_date or date.max, q.id)):
            best[qual.type_id] = qual
        rows = []
        for qual_type, qual in best.items():
            rows.append({"code": qual_type.code, "name": qual_type.name, "mandatory": qual_type.mandatory_for_drivers,
                         "state": state_on(qual.expiry_date, day, settings.qualification_alert_days),
                         "expiry": qual.expiry_date or None, "qualification_id": qual.id})
        if self.driver_id:
            Type = self.env["eguitra.rh.qualification.type"].sudo()
            for qual_type in Type.search([("mandatory_for_drivers", "=", True)]) - self.env["eguitra.rh.qualification.type"].browse(
                    [t.id for t in best]):
                rows.append({"code": qual_type.code, "name": qual_type.name, "mandatory": True, "state": "absente",
                             "expiry": None, "qualification_id": None})
        return sorted(rows, key=lambda r: r["name"])

    # ─── Interface lue par NIMOVA · HSSEQ (statuts seulement) ────────────

    @api.model
    def _hsseq_driver_status(self, driver, on_date=None):
        """Statut RH d'un conducteur pour le verrou de départ (motif V04 d'HSSEQ)."""
        day = on_date or fields.Date.context_today(self)
        employee = self.sudo().search([("driver_id", "=", driver.id), ("hire_date", "<=", day),
                                       "|", ("exit_date", "=", False), ("exit_date", ">=", day)], limit=1)
        if not employee:
            return {"employee_id": None, "fitness": "inconnu", "fitness_until": None, "qualifications": [],
                    "blocking": True, "reasons": ["Aucun dossier salarié en cours n'est lié à ce chauffeur."]}
        fitness = employee._fitness_state(day)
        quals = employee._qualification_rows(day)
        reasons = []
        if fitness == "inapte":
            reasons.append("Aptitude médicale : inapte.")
        elif fitness == "echue":
            reasons.append("Aptitude médicale échue.")
        elif fitness == "inconnu":
            reasons.append("Aptitude médicale non renseignée.")
        for row in quals:
            if row["mandatory"] and row["state"] in ("expiree", "absente"):
                reasons.append(f"{row['name']} : {'expirée' if row['state'] == 'expiree' else 'absente'}.")
        return {
            "employee_id": employee.id,
            "fitness": "apte" if fitness == "apte" else ("inapte" if fitness == "inapte" else "inconnu"),
            "fitness_until": employee.medical_fitness_until or None,
            "qualifications": [{k: r[k] for k in ("code", "name", "mandatory", "state", "expiry")} for r in quals],
            "blocking": bool(reasons),
            "reasons": reasons,
        }

    @api.model
    def _hsseq_expiring(self, companies, horizon_days=30, on_date=None):
        """Habilitations et aptitudes qui expirent dans l'horizon (ou déjà expirées), pour les alertes J-30
        et J-7 d'HSSEQ et l'échéancier RH."""
        day = on_date or fields.Date.context_today(self)
        limit = day + timedelta(days=horizon_days)
        Employee = self.sudo()
        current = Employee.search([("company_id", "in", companies.ids), ("hire_date", "<=", day),
                                   "|", ("exit_date", "=", False), ("exit_date", ">=", day)])
        result = []
        quals = self.env["eguitra.rh.qualification"].sudo().search([
            ("employee_id", "in", current.ids), ("expiry_date", "!=", False), ("expiry_date", "<=", limit)])
        for qual in quals:
            newer = qual.employee_id.qualification_ids.filtered(
                lambda q, qual=qual: q.type_id == qual.type_id and q.id != qual.id
                and (not q.expiry_date or q.expiry_date > qual.expiry_date))
            if newer:
                continue  # remplacée par une habilitation plus récente
            result.append({"employee_id": qual.employee_id.id, "driver_id": qual.employee_id.driver_id.id or None,
                           "kind": "qualification", "code": qual.type_id.code, "name": qual.type_id.name,
                           "expiry": qual.expiry_date, "days_left": (qual.expiry_date - day).days})
        for emp in current.filtered(lambda e: e.medical_fitness == "apte" and e.medical_fitness_until
                                    and e.medical_fitness_until <= limit):
            result.append({"employee_id": emp.id, "driver_id": emp.driver_id.id or None, "kind": "fitness",
                           "code": "APTITUDE", "name": "Aptitude médicale", "expiry": emp.medical_fitness_until,
                           "days_left": (emp.medical_fitness_until - day).days})
        return sorted(result, key=lambda r: (r["expiry"], r["employee_id"]))

    @api.model
    def _hsseq_worked_hours(self, companies, date_from, date_to):
        """Heures réellement travaillées sur la période : mois de paie validée, jours payés au prorata de
        l'horaire mensuel plus heures supplémentaires saisies ; mois sans paie validée, estimation par la
        présence (jours ouvrables sous contrat, absences déduites)."""
        Payslip = self.env["eguitra.rh.payslip"].sudo()
        Holiday = self.env["eguitra.rh.holiday"]
        Leave = self.env["eguitra.rh.leave"].sudo()
        total = 0.0
        for company in companies:
            settings = self.env["eguitra.rh.settings"]._get(company)
            hours_month = settings.monthly_hours or 173.33
            month = date_from.replace(day=1)
            while month <= date_to:
                start, end = month_bounds(month)
                first, last = max(start, date_from), min(end, date_to)
                slips = Payslip.search([("company_id", "=", company.id), ("month", "=", month),
                                        ("payroll_id.state", "!=", "draft")])
                month_days = Holiday._working_days(company, start, end) or 1
                share = Holiday._working_days(company, first, last) / month_days
                if slips:
                    for slip in slips:
                        overtime = sum(i.quantity for i in slip.input_ids if i.rubric_id.input == "hours")
                        total += (slip.worked_days / (slip.month_days or month_days)) * hours_month * share + overtime * share
                else:
                    for emp in self.sudo()._active_in(company, first, last):
                        a, b = max(emp.hire_date, first), min(emp.exit_date or last, last)
                        days = Holiday._working_days(company, a, b)
                        for leave in Leave.search([("employee_id", "=", emp.id), ("state", "=", "approved"),
                                                   ("date_from", "<=", b), ("date_to", ">=", a)]):
                            days -= Holiday._working_days(company, max(leave.date_from, a), min(leave.date_to, b))
                        total += max(days, 0) / month_days * hours_month
                month = end + timedelta(days=1)
        return round(total, 1)

    @api.model
    def _hsseq_work_accidents(self, companies, date_from, date_to):
        """Absences approuvées pour accident du travail qui recoupent la période, jours perdus calendaires."""
        leaves = self.env["eguitra.rh.leave"].sudo().search([
            ("company_id", "in", companies.ids), ("state", "=", "approved"), ("type_id.work_accident", "=", True),
            ("date_from", "<=", date_to), ("date_to", ">=", date_from)], order="date_from")
        return [{"leave_id": leave.id, "employee_id": leave.employee_id.id, "date_from": leave.date_from,
                 "date_to": leave.date_to,
                 "lost_days": (min(leave.date_to, date_to) - max(leave.date_from, date_from)).days + 1}
                for leave in leaves]

    @api.model
    def _hsseq_indicators(self, companies, date_from, date_to):
        """Taux de fréquence et de gravité (accidents du travail avec arrêt, jours perdus, heures travaillées)."""
        hours = self._hsseq_worked_hours(companies, date_from, date_to)
        accidents = self._hsseq_work_accidents(companies, date_from, date_to)
        lost = sum(a["lost_days"] for a in accidents)
        return {"worked_hours": hours, "accidents": len(accidents), "lost_days": lost,
                "frequency_rate": round(len(accidents) * 1_000_000 / hours, 2) if hours else None,
                "severity_rate": round(lost * 1000 / hours, 2) if hours else None}


class EguitraRhSettings(models.Model):
    _inherit = "eguitra.rh.settings"

    qualification_alert_days = fields.Integer("Alerte d'expiration des habilitations (jours)", default=30)
    qualification_urgent_days = fields.Integer("Alerte urgente d'expiration des habilitations (jours)", default=7)


class EguitraRhLeaveType(models.Model):
    _inherit = "eguitra.rh.leave.type"

    work_accident = fields.Boolean("Accident du travail",
                                   help="Compté dans les taux de fréquence et de gravité d'HSSEQ (jours perdus calendaires).")
