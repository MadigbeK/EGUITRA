"""Audits et conformité (spécification §3, §7) : programme d'audits (référentiels ISO 45001, ISO 14001,
ISO 9001, audit d'un client ou donneur d'ordre, audit interne), constats classés (écart majeur, écart
mineur, observation) et leurs actions (origine « audit »), registre des exigences légales, normatives et
contractuelles des donneurs d'ordre avec leur preuve et leur statut de conformité.

Cycle d'un audit : planifié, réalisé, clos (ou annulé, avec motif). Un audit ne se clôt pas tant qu'un
écart majeur n'a pas d'action. Un constat est soldé quand ses actions sont closes ou annulées (une
observation sans action l'est d'emblée). Indicateur « audits réalisés contre planifiés » au cockpit.
"""

from odoo import api, fields, models

from .common import (
    AUDIT_STANDARDS,
    AUDIT_STATUSES,
    AUDITOR_KINDS,
    FINDING_CLASSES,
    FINDING_STATUSES,
    REQUIREMENT_SOURCES,
    REQUIREMENT_STATUSES,
    STANDARDS,
    HsseqError,
    today,
)

OPEN_ACTION = ("todo", "in_progress", "to_verify")


class EguitraHsseqAudit(models.Model):
    _name = "eguitra.hsseq.audit"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Audit HSSEQ"
    _order = "planned_date desc, id desc"
    _check_company_auto = True
    _journal_key = "audit"
    _journal_fields = ("title", "standard", "scope", "site_id", "auditor_kind", "auditor_user_id", "auditor_name",
                       "planned_date", "actual_date", "status", "conclusion")

    reference = fields.Char("Référence", default="/", copy=False, readonly=True, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    title = fields.Char("Audit", required=True)
    standard = fields.Selection(AUDIT_STANDARDS, "Programme", required=True, index=True)
    partner_id = fields.Many2one("res.partner", "Client ou donneur d'ordre", help="Audit client ou donneur d'ordre.")
    scope = fields.Text("Périmètre")
    site_id = fields.Many2one("eguitra.hsseq.site", "Site", check_company=True, index=True)
    auditor_kind = fields.Selection(AUDITOR_KINDS, "Auditeur", required=True, default="internal")
    auditor_user_id = fields.Many2one("res.users", "Auditeur interne")
    auditor_name = fields.Char("Auditeur externe", help="Nom de l'auditeur et de son organisme.")
    planned_date = fields.Date("Prévu le", required=True, index=True)
    actual_date = fields.Date("Réalisé le", index=True)
    status = fields.Selection(AUDIT_STATUSES, "État", required=True, default="planned", index=True)
    conclusion = fields.Text("Conclusion")
    closed_at = fields.Datetime("Clos le", readonly=True)
    closed_by = fields.Many2one("res.users", "Clos par", readonly=True)
    cancel_reason = fields.Text("Motif de l'annulation", readonly=True)
    reopen_reason = fields.Text("Motif de la dernière réouverture", readonly=True)
    finding_ids = fields.One2many("eguitra.hsseq.finding", "audit_id", "Constats")

    @api.model_create_multi
    def create(self, vals_list):
        audits = super().create(vals_list)
        for audit in audits:
            audit.reference = self.env["ir.sequence"].sudo().next_by_code("eguitra.hsseq.audit") or "/"
        return audits

    def _transitions(self):
        self.ensure_one()
        return {"planned": ["perform", "cancel"], "done": ["close"], "closed": ["reopen"], "cancelled": []}[
            self.status]

    def _require(self, transition):
        if transition not in self._transitions():
            raise HsseqError("invalid_transition", f"Transition « {transition} » impossible depuis l'état "
                                                   f"« {dict(AUDIT_STATUSES)[self.status]} ».")

    def _majors_without_action(self):
        self.ensure_one()
        return self.finding_ids.filtered(lambda f: f.classification == "major" and not f.action_ids.filtered(
            lambda a: a.status != "cancelled"))

    def action_perform(self, actual_date=None):
        self.ensure_one()
        self._require("perform")
        day = actual_date or today(self.env)
        if day > today(self.env):
            raise HsseqError("invalid_parameter", "Un audit se déclare réalisé à une date passée ou du jour.",
                             fields=["actual_date"])
        self.write({"status": "done", "actual_date": day})
        self._journal("perform")
        return True

    def action_close(self):
        """Clôture : chaque écart majeur a au moins une action (ni annulée), sinon major_finding_without_action."""
        self.ensure_one()
        self._require("close")
        majors = self._majors_without_action()
        if majors:
            raise HsseqError("major_finding_without_action", f"Écart majeur sans action : "
                                                             f"{', '.join(majors.mapped('reference'))}.",
                             fields=majors.ids)
        self.write({"status": "closed", "closed_at": fields.Datetime.now(), "closed_by": self.env.uid})
        self._journal("close")
        return True

    def action_reopen(self, reason):
        self.ensure_one()
        self._require("reopen")
        if not (reason or "").strip():
            raise HsseqError("reason_required", "Le motif de la réouverture est obligatoire.", fields=["reason"])
        self.write({"status": "done", "closed_at": False, "closed_by": False, "reopen_reason": reason.strip()})
        self._journal("reopen", note=reason.strip())
        return True

    def action_cancel(self, reason):
        self.ensure_one()
        self._require("cancel")
        if not (reason or "").strip():
            raise HsseqError("reason_required", "Le motif de l'annulation est obligatoire.", fields=["reason"])
        self.write({"status": "cancelled", "cancel_reason": reason.strip()})
        self._journal("cancel", note=reason.strip())
        return True


class EguitraHsseqFinding(models.Model):
    _name = "eguitra.hsseq.finding"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Constat d'audit HSSEQ"
    _order = "audit_id, sequence, id"
    _journal_key = "finding"
    _journal_fields = ("classification", "description", "requirement_id", "status")

    audit_id = fields.Many2one("eguitra.hsseq.audit", "Audit", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="audit_id.company_id", store=True, index=True)
    site_id = fields.Many2one(related="audit_id.site_id", store=True, index=True, string="Site")
    reference = fields.Char("Référence", readonly=True, index=True)
    sequence = fields.Integer("Ordre", default=10)
    classification = fields.Selection(FINDING_CLASSES, "Classement", required=True, index=True)
    description = fields.Text("Constat", required=True)
    requirement_id = fields.Many2one("eguitra.hsseq.requirement", "Exigence liée", ondelete="set null", index=True)
    action_ids = fields.One2many("eguitra.hsseq.action", "finding_id", "Actions")
    status = fields.Selection(FINDING_STATUSES, "Statut", compute="_compute_status", store=True, index=True)

    @api.depends("classification", "action_ids.status")
    def _compute_status(self):
        for finding in self:
            actions = finding.action_ids.filtered(lambda a: a.status != "cancelled")
            if actions.filtered(lambda a: a.status in OPEN_ACTION):
                finding.status = "open"
            elif not actions and finding.classification != "observation":
                finding.status = "open"
            else:
                finding.status = "closed"

    @api.model_create_multi
    def create(self, vals_list):
        findings = super().create(vals_list)
        for finding in findings:
            rank = len(finding.audit_id.finding_ids.filtered(lambda f: f.id <= finding.id))
            finding.reference = f"{finding.audit_id.reference}-C{rank:02d}"
        return findings


class EguitraHsseqRequirement(models.Model):
    _name = "eguitra.hsseq.requirement"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Exigence légale, normative ou contractuelle"
    _order = "source, source_reference, id"
    _check_company_auto = True
    _journal_key = "requirement"
    _journal_fields = ("source", "standard", "partner_id", "source_reference", "title", "summary", "expected_evidence",
                       "status", "next_review_date")

    reference = fields.Char("Référence interne", default="/", copy=False, readonly=True, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    source = fields.Selection(REQUIREMENT_SOURCES, "Source", required=True, index=True)
    standard = fields.Selection(STANDARDS, "Référentiel", help="Pour la maturité par norme au cockpit.")
    partner_id = fields.Many2one("res.partner", "Client ou donneur d'ordre", help="Exigence d'un contrat client.")
    source_reference = fields.Char("Référence", required=True, help="Texte et article, clause de la norme ou du contrat.")
    title = fields.Char("Exigence", required=True)
    summary = fields.Text("Résumé")
    expected_evidence = fields.Text("Preuve attendue")
    status = fields.Selection(REQUIREMENT_STATUSES, "Statut", required=True, default="not_evaluated", index=True)
    last_review_at = fields.Datetime("Dernière revue le", readonly=True)
    last_reviewed_by = fields.Many2one("res.users", "Dernière revue par", readonly=True)
    review_comment = fields.Text("Commentaire de la dernière revue", readonly=True)
    next_review_date = fields.Date("Prochaine revue le", index=True)
    finding_ids = fields.One2many("eguitra.hsseq.finding", "requirement_id", "Constats liés")
    active = fields.Boolean(default=True)

    @api.model_create_multi
    def create(self, vals_list):
        requirements = super().create(vals_list)
        for requirement in requirements:
            requirement.reference = self.env["ir.sequence"].sudo().next_by_code("eguitra.hsseq.requirement") or "/"
        return requirements

    def action_review(self, status, comment=None, next_date=None):
        """Revue de conformité : statut, commentaire, prochaine revue."""
        self.ensure_one()
        if status not in dict(REQUIREMENT_STATUSES):
            raise HsseqError("invalid_parameter", "Statut : compliant, partial, non_compliant ou not_evaluated.",
                             fields=["status"], status=400)
        if next_date and next_date <= today(self.env):
            raise HsseqError("invalid_parameter", "La prochaine revue est postérieure à aujourd'hui.",
                             fields=["next_review_date"])
        self.write({"status": status, "last_review_at": fields.Datetime.now(), "last_reviewed_by": self.env.uid,
                    "review_comment": (comment or "").strip() or False, "next_review_date": next_date or False})
        self._journal("review", note=(comment or "").strip() or None)
        return True
