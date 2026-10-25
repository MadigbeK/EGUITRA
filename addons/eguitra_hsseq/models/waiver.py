"""Dérogations au verrou de départ (spécification §4.1) : une rotation, un motif, une justification écrite.
Seul un chef de parc (profil exploitation) la demande, et sa demande vaut première validation ; la seconde
est donnée par un compte hsseq, forcément une autre personne (quatre yeux). V01 et V03 ne sont jamais
dérogeables. Elle expire à la fin de la rotation (validée, facturée ou annulée) ou à sa fin prévue ;
journalisée, notifiée au Directeur général à l'activation, comptée dans les indicateurs."""

from datetime import timedelta
from math import ceil

from odoo import api, fields, models

from .common import HSSEQ_GROUP, WAIVER_STATUSES, HsseqError, day_end, users_in_group

NOT_WAIVABLE = ("V01", "V03")
ROTATION_ENDED = ("done", "invoiced", "cancelled")


class EguitraHsseqWaiver(models.Model):
    _name = "eguitra.hsseq.waiver"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Dérogation au verrou de départ"
    _order = "requested_at desc, id desc"
    _check_company_auto = True
    _journal_key = "waiver"
    _journal_fields = ("status", "justification", "refusal_reason")

    reference = fields.Char("Référence", default="/", copy=False, readonly=True, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    rotation_id = fields.Many2one("eguitra.transport.rotation", "Rotation", required=True, check_company=True,
                                  index=True, ondelete="cascade")
    vehicle_id = fields.Many2one("eguitra.transport.vehicle", "Ensemble routier", index=True)
    site_id = fields.Many2one("eguitra.hsseq.site", "Site", index=True)
    reason_code = fields.Char("Motif dérogé", required=True, index=True)
    justification = fields.Text("Justification", required=True)
    requested_by = fields.Many2one("res.users", "Demandée par", required=True, default=lambda self: self.env.uid)
    requested_at = fields.Datetime("Demandée le", required=True, default=fields.Datetime.now)
    approved_by = fields.Many2one("res.users", "Seconde validation par", readonly=True)
    approved_at = fields.Datetime("Seconde validation le", readonly=True, index=True)
    status = fields.Selection(WAIVER_STATUSES, "Statut", required=True, default="pending_hsseq", index=True)
    expires = fields.Datetime("Expire le", readonly=True, help="Fin prévue de la rotation.")
    expired_at = fields.Datetime("Expirée le", readonly=True)
    refusal_reason = fields.Text("Motif du refus", readonly=True)
    decided_by = fields.Many2one("res.users", "Refusée ou annulée par", readonly=True)
    management_notified_at = fields.Datetime("Direction prévenue le", readonly=True)

    @api.model_create_multi
    def create(self, vals_list):
        waivers = super().create(vals_list)
        for waiver in waivers:
            waiver.reference = self.env["ir.sequence"].sudo().next_by_code("eguitra.hsseq.waiver") or "/"
        return waivers

    def _approvals(self):
        """Validations dans l'ordre : la demande du chef de parc (niveau 1), puis celle du Responsable HSSEQ."""
        self.ensure_one()
        rows = [{"level": 1, "role": "yard_manager", "by": self.requested_by, "at": self.requested_at}]
        if self.approved_by:
            rows.append({"level": 2, "role": "hsseq_manager", "by": self.approved_by, "at": self.approved_at})
        return rows

    def _transitions(self):
        self.ensure_one()
        return {"pending_hsseq": ["approve", "refuse", "cancel"], "active": ["cancel"]}.get(self.status, [])

    def _require(self, transition):
        if transition not in self._transitions():
            raise HsseqError("invalid_transition", f"Transition « {transition} » impossible depuis le statut "
                                                   f"« {dict(WAIVER_STATUSES)[self.status]} ».")

    @api.model
    def _planned_end(self, rotation):
        """Fin prévue de la rotation : son retour au dépôt, sinon son chargement plus la durée de sa route."""
        rotation = rotation.sudo()
        day = rotation.date_return or rotation.date_loading + timedelta(
            days=max(1, ceil(rotation.route_id.duration_days or 1)))
        return day_end(day)

    @api.model
    def _hsseq_request(self, rotation, reason_code, justification):
        """Demande d'un chef de parc (après contrôle de son profil et de son site par l'appelant)."""
        if reason_code in NOT_WAIVABLE:
            raise HsseqError("not_waivable", f"Le motif {reason_code} n'est jamais dérogeable.", fields=["reason_code"])
        if not (justification or "").strip():
            raise HsseqError("reason_required", "La justification écrite est obligatoire.", fields=["justification"])
        if rotation.state != "draft":
            raise HsseqError("invalid_transition", "Seule une rotation pas encore partie reçoit une dérogation.")
        open_codes = {r["code"] for r in rotation._hsseq_reasons(apply_waivers=False)["reasons"]}
        if reason_code not in open_codes:
            raise HsseqError("reason_not_open", f"Le motif {reason_code} n'est pas ouvert pour cette rotation.",
                             fields=["reason_code"])
        existing = self.sudo().search([("rotation_id", "=", rotation.id), ("reason_code", "=", reason_code),
                                       ("status", "in", ("pending_hsseq", "active"))], limit=1)
        if existing:
            raise HsseqError("conflict", f"Dérogation {existing.reference} déjà en cours pour ce motif.", status=409)
        rotation = rotation.sudo()
        waiver = self.sudo().create({
            "company_id": rotation.company_id.id, "rotation_id": rotation.id, "vehicle_id": rotation.vehicle_id.id,
            "site_id": rotation.vehicle_id.site_id.id or False, "reason_code": reason_code,
            "justification": justification.strip(), "requested_by": self.env.uid,
        })
        self.env["eguitra.hsseq.notification"]._notify(
            users_in_group(self.env, HSSEQ_GROUP, rotation.company_id) - self.env.user, "waiver_requested",
            f"Dérogation à valider : {reason_code}, rotation {rotation.name}",
            f"{waiver.reference} demandée par {self.env.user.name} :\n{waiver.justification}", waiver, "waiver")
        return waiver

    def _check_four_eyes(self):
        """Quatre yeux, dans le noyau quel que soit le chemin : ni le demandeur (sa demande vaut première
        validation), ni un compte qui a déjà validé ne tranche la seconde validation."""
        self.ensure_one()
        deciders = {a["by"].id for a in self._approvals()}
        if self.env.uid in deciders:
            raise HsseqError("four_eyes", "La seconde validation revient à une autre personne que le demandeur.")

    def action_approve(self):
        """Seconde validation, par une autre personne que le demandeur."""
        self.ensure_one()
        self._require("approve")
        self._check_four_eyes()
        if self.rotation_id.state in ROTATION_ENDED:
            raise HsseqError("invalid_transition", "La rotation est terminée : la dérogation n'a plus d'objet.")
        now = fields.Datetime.now()
        self.write({"status": "active", "approved_by": self.env.uid, "approved_at": now,
                    "expires": self._planned_end(self.rotation_id)})
        self._journal("approve")
        rotation = self.rotation_id.sudo()
        self.env["eguitra.hsseq.notification"]._notify(
            self.env["eguitra.hsseq.settings"]._get(self.company_id)._directors(), "waiver_active",
            f"Dérogation au verrou : {self.reason_code}, rotation {rotation.name}",
            f"{self.reference}, ensemble {rotation.vehicle_id.name}, demandée par {self.requested_by.name}, "
            f"validée par {self.env.user.name}.\nJustification : {self.justification}", self, "waiver")
        self.management_notified_at = now
        return True

    def action_refuse(self, reason):
        self.ensure_one()
        self._require("refuse")
        self._check_four_eyes()
        if not (reason or "").strip():
            raise HsseqError("reason_required", "Le motif du refus est obligatoire.", fields=["reason"])
        self.write({"status": "refused", "refusal_reason": reason.strip(), "decided_by": self.env.uid})
        self._journal("refuse", note=reason.strip())
        return True

    def action_cancel(self):
        self.ensure_one()
        self._require("cancel")
        self.write({"status": "cancelled", "decided_by": self.env.uid})
        self._journal("cancel")
        return True

    def _expire(self):
        """Fin de la rotation ou de sa durée prévue : la dérogation ne vaut plus."""
        active = self.filtered(lambda w: w.status in ("active", "pending_hsseq"))
        if active:
            active.sudo().write({"status": "expired", "expired_at": fields.Datetime.now()})
            active._journal("expire")

    def _refresh(self):
        """Expire les dérogations dont la rotation est terminée ou dont la fin prévue est passée."""
        now = fields.Datetime.now()
        self.filtered(lambda w: w.status in ("active", "pending_hsseq") and (
            w.rotation_id.sudo().state in ROTATION_ENDED or (w.expires and w.expires < now)))._expire()
        return self

    @api.model
    def _cron_expire(self):
        self.sudo().search([("status", "in", ("active", "pending_hsseq"))])._refresh()
        return True
