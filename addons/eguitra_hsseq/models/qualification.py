"""Habilitations reliées à RH (spécification §3, §9.3) : matrice des compétences par conducteur, lue dans RH
(eguitra.rh.qualification, statuts seulement, aptitude en statut seul, jamais de détail médical), et
alertes à J-30 et J-7 des habilitations, des aptitudes et des documents des véhicules qui arrivent à
expiration. Le jour de l'expiration, le verrou de départ prend le relais (V04, V05, V06).

Une alerte n'est envoyée qu'une fois par échéance et par seuil (eguitra.hsseq.expiry.alert) ; une
habilitation renouvelée (nouvelle date) a ses propres alertes. Destinataires : le Responsable HSSEQ, le
chef de parc du site du conducteur ou du véhicule et, pour les personnes, la RH. L'écriture des
habilitations reste dans RH.

Habilitations exigées selon le profil du véhicule (eguitra.hsseq.qualification.rule) : pour chaque type
d'habilitation de RH, exigée des conducteurs de citerne, de benne ou des deux (par exemple le transport de
matières dangereuses pour les seules citernes, l'accès au site minier pour les seules bennes). Sans règle,
le type suit « obligatoire pour les conducteurs » de RH, pour les deux profils. Le motif V04 retient le
profil de l'ensemble de la rotation ; la matrice, le cockpit, les échéances et les alertes celui de
l'ensemble dont le conducteur est le chauffeur habituel (sans ensemble : l'un ou l'autre profil).
"""

from odoo import api, fields, models

from .common import (
    FITNESS_STATUSES,
    HSSEQ_GROUP,
    QUALIFICATION_STATUSES,
    RH_GROUP,
    today,
    users_in_group,
    vehicle_kind,
)
from .lock import DOCUMENT_LABELS

STAGES = [("d30", "J-30"), ("d7", "J-7")]
ALERT_KINDS = [("qualification", "Habilitation"), ("fitness", "Aptitude médicale"),
               ("vehicle_document", "Document du véhicule")]
VEHICLE_ALERT_DAYS, VEHICLE_URGENT_DAYS = 30, 7
DOCUMENT_REASON = {"insurance": "V05", "inspection": "V05", "calibration": "V06", "tightness": "V06"}
# Gravité d'un statut d'habilitation, pour le statut d'ensemble d'un conducteur.
STATUS_RANK = {"expired": 3, "missing": 2, "to_renew": 1, "valid": 0}


def driver_sites(vehicles):
    """Site de chaque chauffeur : celui de l'ensemble dont il est le chauffeur habituel."""
    return {v.driver_id.id: v.site_id for v in vehicles if v.driver_id and v.site_id}


def driver_kinds(vehicles):
    """Profil (citerne ou benne) de chaque chauffeur : celui de l'ensemble dont il est le chauffeur habituel."""
    return {v.driver_id.id: vehicle_kind(v) for v in vehicles if v.driver_id}


class EguitraHsseqQualificationRule(models.Model):
    _name = "eguitra.hsseq.qualification.rule"
    _description = "Habilitation exigée selon le profil du véhicule"
    _rec_name = "type_id"
    _order = "type_id"

    type_id = fields.Many2one("eguitra.rh.qualification.type", "Habilitation", required=True, index=True,
                              ondelete="cascade")
    tanker = fields.Boolean("Exigée des conducteurs de citerne")
    tipper = fields.Boolean("Exigée des conducteurs de benne")

    _type_unique = models.Constraint("unique(type_id)", "Cette habilitation a déjà sa règle.")

    @api.model
    def _obligations(self):
        """{code d'un type actif : {tanker, tipper, rule}} : la règle d'HSSEQ, à défaut « obligatoire pour
        les conducteurs » de RH pour les deux profils (rule : une règle d'HSSEQ existe)."""
        rules = {r.type_id.id: r for r in self.sudo().search([])}
        obligations = {}
        for qual_type in self.env["eguitra.rh.qualification.type"].sudo().search([]):
            rule = rules.get(qual_type.id)
            obligations[qual_type.code] = {
                "tanker": rule.tanker if rule else qual_type.mandatory_for_drivers,
                "tipper": rule.tipper if rule else qual_type.mandatory_for_drivers, "rule": bool(rule)}
        return obligations

    @api.model
    def _required_codes(self, kind=None, obligations=None):
        """Codes des habilitations exigées pour un profil de véhicule (None : l'un ou l'autre)."""
        obligations = self._obligations() if obligations is None else obligations
        return {code for code, flags in obligations.items()
                if (flags[kind] if kind in ("tanker", "tipper") else flags["tanker"] or flags["tipper"])}


class EguitraHsseqExpiryAlert(models.Model):
    _name = "eguitra.hsseq.expiry.alert"
    _description = "Alerte d'expiration HSSEQ (habilitation, aptitude, document du véhicule)"
    _order = "sent_at desc, id desc"

    company_id = fields.Many2one("res.company", required=True, index=True, ondelete="cascade")
    kind = fields.Selection(ALERT_KINDS, "Échéance", required=True)
    key = fields.Char("Échéance suivie", required=True, index=True,
                      help="employee:<salarié>:<type> ou vehicle:<ensemble>:<document>.")
    subject = fields.Char("Personne ou ensemble", required=True)
    label = fields.Char("Habilitation ou document", required=True)
    expiry_date = fields.Date("Expire le", required=True)
    stage = fields.Selection(STAGES, "Seuil", required=True)
    reason_code = fields.Char("Motif du verrou à l'expiration")
    site_id = fields.Many2one("eguitra.hsseq.site", "Site", index=True)
    sent_at = fields.Datetime("Envoyée le", required=True, default=fields.Datetime.now)
    recipient_ids = fields.Many2many("res.users", "eguitra_hsseq_expiry_alert_user_rel", "alert_id", "user_id",
                                     "Destinataires")

    _alert_unique = models.Constraint("unique(key, expiry_date, stage)", "Alerte déjà envoyée pour cette échéance.")

    @api.model
    def _stage(self, days_left, alert_days, urgent_days):
        if days_left < 0 or days_left > alert_days:
            return None
        return "d7" if days_left <= urgent_days else "d30"

    @api.model
    def _send(self, company, kind, key, subject, label, expiry, stage, users, site=None, reason=None):
        """Alerte d'un seuil, une seule fois par échéance (False si déjà envoyée)."""
        if self.sudo().search_count([("key", "=", key), ("expiry_date", "=", expiry), ("stage", "=", stage)]):
            return False
        days = (expiry - today(self.env)).days
        alert = self.sudo().create({
            "company_id": company.id, "kind": kind, "key": key, "subject": subject, "label": label,
            "expiry_date": expiry, "stage": stage, "site_id": site.id if site else False, "reason_code": reason,
            "recipient_ids": [(6, 0, users.ids)]})
        when = f"le {expiry:%d/%m/%Y}" + (f", dans {days} jour{'s' if days > 1 else ''}" if days else ", aujourd'hui")
        consequence = f"\nÀ l'expiration, le départ est refusé (motif {reason})." if reason else ""
        self.env["eguitra.hsseq.notification"]._notify(
            users, f"expiry_{stage}", f"{label} à renouveler : {subject} ({dict(STAGES)[stage]})",
            f"{label} de {subject} expire {when}.{consequence}", alert, "expiry_alert")
        return alert

    @api.model
    def _cron_alerts(self):
        """Chaque jour : alertes J-30 et J-7 des habilitations et aptitudes (RH) et des documents des
        véhicules (Transport), sans doublon d'une alerte déjà envoyée."""
        day = today(self.env)
        Employee = self.env["eguitra.rh.employee"].sudo()
        Rule = self.env["eguitra.hsseq.qualification.rule"]
        obligations = Rule._obligations()
        sent = self.browse()
        for company in self.env["res.company"].sudo().search([]):
            hsseq = users_in_group(self.env, HSSEQ_GROUP, company)
            rh = users_in_group(self.env, RH_GROUP, company)
            vehicles = self.env["eguitra.transport.vehicle"].sudo().search([("company_id", "=", company.id)])
            on_site, kinds = driver_sites(vehicles), driver_kinds(vehicles)
            rh_settings = self.env["eguitra.rh.settings"]._get(company)
            alert_days = rh_settings.qualification_alert_days or 30
            urgent_days = rh_settings.qualification_urgent_days or 7
            for row in Employee._hsseq_expiring(company, alert_days, day):
                stage = self._stage(row["days_left"], alert_days, urgent_days)
                if not stage:
                    continue
                employee = Employee.browse(row["employee_id"])
                site = on_site.get(row["driver_id"])
                required = Rule._required_codes(kinds.get(row["driver_id"]), obligations)
                reason = "V04" if row["driver_id"] and (row["kind"] == "fitness" or row["code"] in required) else None
                users = hsseq | rh | (site.manager_ids if site else hsseq.browse())
                sent |= self._send(company, row["kind"], f"employee:{employee.id}:{row['code']}", employee.name,
                                   row["name"], row["expiry"], stage, users, site, reason) or self.browse()
            for vehicle in vehicles:
                for kind, doc in vehicle._latest_documents().items():
                    if kind not in vehicle._required_kinds():
                        continue
                    stage = self._stage((doc.expiry_date - day).days, VEHICLE_ALERT_DAYS, VEHICLE_URGENT_DAYS)
                    if not stage:
                        continue
                    users = hsseq | vehicle.site_id.manager_ids
                    sent |= self._send(company, "vehicle_document", f"vehicle:{vehicle.id}:{kind}", vehicle.name,
                                       DOCUMENT_LABELS.get(kind, kind).capitalize(), doc.expiry_date, stage, users,
                                       vehicle.site_id, DOCUMENT_REASON.get(kind)) or self.browse()
        return sent


class EguitraRhEmployee(models.Model):
    _inherit = "eguitra.rh.employee"

    def _hsseq_vehicle_kind(self):
        """Profil de l'ensemble dont le conducteur est le chauffeur habituel (None : aucun ensemble)."""
        self.ensure_one()
        driver = self.sudo().driver_id
        if not driver:
            return None
        vehicle = self.env["eguitra.transport.vehicle"].sudo().search([("driver_id", "=", driver.id)], limit=1)
        return vehicle_kind(vehicle) if vehicle else None

    def _hsseq_obligations(self, day, kind=None, obligations=None):
        """Habilitations exigées du conducteur pour un profil de véhicule (None : l'un ou l'autre) et leur
        état RH : [{code, name, state (valide, a_renouveler, expiree, absente), expiry}]."""
        self.ensure_one()
        required = self.env["eguitra.hsseq.qualification.rule"]._required_codes(kind, obligations)
        rows = {r["code"]: r for r in self.sudo()._qualification_rows(day)}
        result = []
        for qual_type in self.env["eguitra.rh.qualification.type"].sudo().search([("code", "in", list(required))]):
            row = rows.get(qual_type.code)
            result.append({"code": qual_type.code, "name": qual_type.name, "state": row["state"] if row else "absente",
                           "expiry": row["expiry"] if row else None})
        return result

    def _hsseq_blocking(self, day, kind=None, obligations=None):
        """Conducteur hors d'état de partir (sans les dates de mise en service du verrou) : aptitude inapte
        ou échue, habilitation exigée expirée ou absente."""
        self.ensure_one()
        return self.sudo()._fitness_state(day) in ("inapte", "echue") or any(
            row["state"] in ("expiree", "absente") for row in self._hsseq_obligations(day, kind, obligations))

    def _hsseq_ppe(self, day):
        """EPI remis au salarié (RH, eguitra.rh.ppe.issue) : la dernière remise de chaque équipement."""
        self.ensure_one()
        labels = dict(self.env["eguitra.rh.ppe.issue"]._fields["item"].selection)
        latest = {}
        for issue in self.sudo().ppe_issue_ids.sorted(lambda p: (p.date, p.id), reverse=True):
            latest.setdefault(issue.item, issue)
        return [{"item": item, "label": labels.get(item, item), "quantity": issue.quantity, "issued_on": issue.date,
                 "renewal_date": issue.renewal_date or None,
                 "to_renew": bool(issue.renewal_date and issue.renewal_date <= day), "acknowledged": issue.acknowledged}
                for item, issue in sorted(latest.items(), key=lambda kv: labels.get(kv[0], kv[0]))]

    def _hsseq_matrix_row(self, types, day, kind="auto", obligations=None):
        """Ligne de la matrice des compétences d'un conducteur : statut de chaque type d'habilitation de
        types (valid, to_renew, expired, missing), dates d'obtention et d'expiration, exigence selon le profil
        de son ensemble (kind ; « auto » : son ensemble habituel), aptitude en statut seul, EPI remis ; statut
        d'ensemble et blocage du verrou (V04) établis sur tous les types exigés."""
        self.ensure_one()
        employee = self.sudo()
        kind = employee._hsseq_vehicle_kind() if kind == "auto" else kind
        Rule = self.env["eguitra.hsseq.qualification.rule"]
        obligations = Rule._obligations() if obligations is None else obligations
        required = Rule._required_codes(kind, obligations)
        rows = {r["code"]: r for r in employee._qualification_rows(day)}
        Qualification = self.env["eguitra.rh.qualification"].sudo()
        every = self.env["eguitra.rh.qualification.type"].sudo().search([]) | types
        cells = []
        for qual_type in every:
            row = rows.get(qual_type.code)
            qual = Qualification.browse(row["qualification_id"]) if row and row["qualification_id"] else Qualification
            status = QUALIFICATION_STATUSES[row["state"]] if row else "missing"
            flags = obligations.get(qual_type.code, {"tanker": False, "tipper": False})
            cells.append({"code": qual_type.code, "name": qual_type.name, "mandatory": qual_type.code in required,
                          "required_for": {"tanker": flags["tanker"], "tipper": flags["tipper"]}, "status": status, "obtained_on": qual.obtained_date or None,
                          "expires_on": qual.expiry_date or None,
                          "days_left": (qual.expiry_date - day).days if qual.expiry_date else None})
        mandatory = [c for c in cells if c["mandatory"]]
        overall = max((c["status"] for c in mandatory), key=lambda status: STATUS_RANK[status]) if mandatory else "valid"
        # Même règle que le motif V04 : exigée expirée, aptitude inapte ou échue ; exigée absente à partir de
        # la date de mise en service des paramètres (avant : avertissement).
        settings = self.env["eguitra.hsseq.settings"]._get(employee.company_id)
        blocking = bool(employee.driver_id) and (
            employee._fitness_state(day) in ("inapte", "echue")
            or any(c["status"] == "expired" for c in mandatory)
            or (settings._required_from("qualifications_required_from", day)
                and any(c["status"] == "missing" for c in mandatory)))
        shown = set(types.mapped("code"))
        return {"employee": {"id": employee.id, "name": employee.name}, "status": overall,
                "fitness": FITNESS_STATUSES.get(employee._fitness_state(day), "review"), "vehicle_kind": kind,
                "blocking": blocking, "qualifications": [c for c in cells if c["code"] in shown],
                "ppe": employee._hsseq_ppe(day)}
