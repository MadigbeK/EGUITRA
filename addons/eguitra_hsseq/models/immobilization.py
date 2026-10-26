"""Immobilisation d'un véhicule par un événement en cours d'enquête (motif V09 du verrou, spécification §4,
§6, §9.1). Posée par le Responsable HSSEQ sur un événement de criticité élevée qui met en cause un
ensemble (proposée automatiquement au classement), levée par lui seul, avec un motif écrit. Le véhicule
porte son statut « immobilisé HSSEQ » (événement, depuis) : seule écriture d'HSSEQ dans Transport avec le
verrou."""

from odoo import api, fields, models

from .common import HSSEQ_GROUP, HsseqError, users_in_group

IMMOBILIZATION_STATUSES = [("active", "En cours"), ("lifted", "Levée")]


class EguitraHsseqImmobilization(models.Model):
    _name = "eguitra.hsseq.immobilization"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Immobilisation d'un véhicule par HSSEQ"
    _order = "since desc, id desc"
    _journal_key = "immobilization"
    _journal_fields = ("status", "lift_reason")

    vehicle_id = fields.Many2one("eguitra.transport.vehicle", "Ensemble routier", required=True, index=True,
                                 ondelete="cascade")
    company_id = fields.Many2one(related="vehicle_id.company_id", store=True, index=True)
    site_id = fields.Many2one(related="vehicle_id.site_id", store=True, index=True, string="Site")
    event_id = fields.Many2one("eguitra.hsseq.event", "Événement", required=True, index=True, ondelete="restrict")
    since = fields.Datetime("Immobilisé depuis", required=True, default=fields.Datetime.now, index=True)
    reason = fields.Text("Motif de l'immobilisation")
    imposed_by = fields.Many2one("res.users", "Immobilisé par", required=True, default=lambda self: self.env.uid)
    status = fields.Selection(IMMOBILIZATION_STATUSES, "Statut", required=True, default="active", index=True)
    lifted_at = fields.Datetime("Levée le", readonly=True)
    lifted_by = fields.Many2one("res.users", "Levée par", readonly=True)
    lift_reason = fields.Text("Motif de la levée", readonly=True)

    def action_lift(self, reason):
        """Levée par le Responsable HSSEQ, motif écrit obligatoire."""
        self.ensure_one()
        if self.status != "active":
            raise HsseqError("invalid_transition", "Cette immobilisation est déjà levée.")
        if not (reason or "").strip():
            raise HsseqError("reason_required", "Le motif de la levée est obligatoire.", fields=["reason"])
        self.write({"status": "lifted", "lifted_at": fields.Datetime.now(), "lifted_by": self.env.uid,
                    "lift_reason": reason.strip()})
        self._journal("lift", note=reason.strip())
        event = self.event_id.sudo()
        if not event.immobilization_ids.filtered(lambda i: i.status == "active"):
            event.vehicle_immobilized = False
        return True


class EguitraTransportVehicle(models.Model):
    _inherit = "eguitra.transport.vehicle"

    hsseq_immobilization_ids = fields.One2many("eguitra.hsseq.immobilization", "vehicle_id", "Immobilisations HSSEQ")
    hsseq_immobilization_id = fields.Many2one("eguitra.hsseq.immobilization", "Immobilisation HSSEQ en cours",
                                              compute="_compute_hsseq_immobilization", store=True)
    hsseq_immobilized = fields.Boolean("Immobilisé HSSEQ", compute="_compute_hsseq_immobilization", store=True,
                                       index=True, help="Immobilisé par un événement en cours d'enquête : motif V09.")
    hsseq_immobilized_since = fields.Datetime(related="hsseq_immobilization_id.since", string="Immobilisé depuis")
    hsseq_immobilization_event_id = fields.Many2one(related="hsseq_immobilization_id.event_id",
                                                    string="Événement de l'immobilisation")

    @api.depends("hsseq_immobilization_ids.status")
    def _compute_hsseq_immobilization(self):
        for vehicle in self:
            active = vehicle.hsseq_immobilization_ids.filtered(lambda i: i.status == "active").sorted("since")[:1]
            vehicle.hsseq_immobilization_id = active
            vehicle.hsseq_immobilized = bool(active)


class EguitraHsseqEvent(models.Model):
    _inherit = "eguitra.hsseq.event"

    immobilization_ids = fields.One2many("eguitra.hsseq.immobilization", "event_id", "Immobilisations")

    def _immobilization_proposed(self):
        """Immobilisation proposée : événement de criticité élevée, en cours, qui met en cause un ensemble
        pas encore immobilisé, et que l'événement n'a jamais immobilisé (après une levée, elle n'est plus
        proposée : le Responsable HSSEQ peut toujours immobiliser de nouveau)."""
        self.ensure_one()
        event = self.sudo()
        return bool(event.level == "high" and event.status != "closed" and event.vehicle_id
                    and not event.vehicle_id.hsseq_immobilized
                    and not event.immobilization_ids.filtered(lambda i: i.vehicle_id == event.vehicle_id))

    def action_immobilize(self, reason=None):
        """Immobilisation du véhicule de l'événement (V09), par le Responsable HSSEQ."""
        self.ensure_one()
        event = self.sudo()
        if event.level != "high":
            raise HsseqError("invalid_transition", "L'immobilisation du véhicule (V09) vaut pour un événement de "
                                                   "criticité élevée.")
        if event.status == "closed":
            raise HsseqError("invalid_transition", "Événement clôturé : il n'immobilise plus de véhicule.")
        if not event.vehicle_id:
            raise HsseqError("missing_fields", "L'événement ne met en cause aucun ensemble.", fields=["vehicle_id"],
                             status=400)
        if event.vehicle_id.hsseq_immobilized:
            raise HsseqError("invalid_transition", f"{event.vehicle_id.name} est déjà immobilisé.")
        immobilization = self.env["eguitra.hsseq.immobilization"].sudo().create({
            "vehicle_id": event.vehicle_id.id, "event_id": event.id, "reason": (reason or "").strip() or False,
            "imposed_by": self.env.uid})
        event.vehicle_immobilized = True
        event._journal("immobilize", note=f"{event.vehicle_id.name} immobilisé")
        users = event.vehicle_id.site_id.manager_ids | users_in_group(self.env, HSSEQ_GROUP, event.company_id)
        self.env["eguitra.hsseq.notification"]._notify(
            users, "immobilized", f"Véhicule immobilisé : {event.vehicle_id.name}",
            f"{event._summary()}\nAucun départ jusqu'à la levée par le Responsable HSSEQ (motif V09).", event, "event")
        return immobilization

    def _notify_level(self):
        """Criticité élevée : l'immobilisation du véhicule est proposée au Responsable HSSEQ (V09)."""
        result = super()._notify_level()
        for event in self.filtered(lambda e: e._immobilization_proposed()):
            event._journal("immobilization_proposed", note=f"Immobilisation de {event.vehicle_id.sudo().name} proposée")
        return result
