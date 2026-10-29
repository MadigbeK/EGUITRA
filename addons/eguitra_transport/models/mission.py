"""Ordre de mission (OM) d'une opération : il ordonne au chauffeur et au convoyeur d'effectuer la mission avec
le tracteur et la remorque désignés, selon un plan de voyage (étapes : lieu, ville, pays, sens aller ou
retour, motif d'escale), pour une période (départ et retour prévus), et prie les autorités de faciliter la
mission (mention réglable).

L'équipage, les engins et la période sont ceux de l'opération (une seule saisie) ; l'ordre de mission garde
son numéro, sa date, son plan de voyage et sa mention. Le plan se pré-remplit depuis la route : départ,
étapes types de la route (aller, puis retour), destination, retour à la base. L'ordre de mission se crée
de lui-même à la première impression ou à la première modification du plan.

Le plan de voyage est un document administratif ; le plan de trajet d'HSSEQ (horaires, pauses, conduite de
nuit) reste distinct, sans dépendance entre les deux modules.
"""

from odoo import api, fields, models
from odoo.exceptions import UserError

DIRECTIONS = [("out", "Aller"), ("back", "Retour")]


class EguitraTransportRouteStep(models.Model):
    _name = "eguitra.transport.route.step"
    _description = "Étape type d'une route"
    _order = "route_id, direction desc, sequence, id"

    route_id = fields.Many2one("eguitra.transport.route", "Route", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="route_id.company_id", store=True, index=True)
    sequence = fields.Integer(default=10)
    place = fields.Char("Lieu", required=True)
    city = fields.Char("Ville")
    country = fields.Char("Pays", default="Guinée")
    direction = fields.Selection(DIRECTIONS, "Sens", default="out", required=True)
    stop_reason = fields.Char("Motif d'escale")


class EguitraTransportRoute(models.Model):
    _inherit = "eguitra.transport.route"

    step_ids = fields.One2many("eguitra.transport.route.step", "route_id", "Étapes types")
    origin_country = fields.Char("Pays de départ", default="Guinée")
    destination_country = fields.Char("Pays d'arrivée", default="Guinée")

    def _plan_steps(self):
        """Plan de voyage type : départ, étapes de l'aller, destination, étapes du retour, retour à la base."""
        self.ensure_one()
        steps = []
        if self.origin:
            steps.append({"place": self.origin, "city": self.origin, "country": self.origin_country or "",
                          "direction": "out", "stop_reason": "Départ et chargement"})
        steps += [{"place": s.place, "city": s.city or "", "country": s.country or "", "direction": "out",
                   "stop_reason": s.stop_reason or ""} for s in self.step_ids.filtered(lambda s: s.direction == "out")]
        if self.destination:
            steps.append({"place": self.destination, "city": self.destination, "country": self.destination_country or "",
                          "direction": "out", "stop_reason": "Livraison et déchargement"})
        steps += [{"place": s.place, "city": s.city or "", "country": s.country or "", "direction": "back",
                   "stop_reason": s.stop_reason or ""} for s in self.step_ids.filtered(lambda s: s.direction == "back")]
        if self.origin:
            steps.append({"place": self.origin, "city": self.origin, "country": self.origin_country or "",
                          "direction": "back", "stop_reason": "Retour à la base"})
        return steps


class EguitraTransportMission(models.Model):
    _name = "eguitra.transport.mission"
    _description = "Ordre de mission"
    _order = "date desc, id desc"
    _check_company_auto = True

    name = fields.Char("Numéro", default="/", copy=False, readonly=True, index=True)
    rotation_id = fields.Many2one("eguitra.transport.rotation", "Opération", required=True, ondelete="cascade",
                                  index=True, check_company=True)
    company_id = fields.Many2one(related="rotation_id.company_id", store=True, index=True)
    date = fields.Date("Date", required=True, default=fields.Date.context_today)
    step_ids = fields.One2many("eguitra.transport.mission.step", "mission_id", "Plan de voyage")
    authorities_note = fields.Text("Mention aux autorités", help="Vide : mention réglée pour la société.")
    note = fields.Text("Observations")

    _rotation_unique = models.Constraint("unique(rotation_id)", "L'opération a déjà son ordre de mission.")

    @api.model_create_multi
    def create(self, vals_list):
        missions = super().create(vals_list)
        for mission in missions:
            mission.name = mission.company_id._transport_next_number("mission", mission.date)
            if not mission.step_ids and mission.rotation_id.route_id:
                mission.step_ids = [(0, 0, dict(step, sequence=(i + 1) * 10))
                                    for i, step in enumerate(mission.rotation_id.route_id._plan_steps())]
            mission.rotation_id._ensure_number()
        return missions

    def _authorities_note(self):
        self.ensure_one()
        return self.authorities_note or self.company_id.transport_authorities_note or ""


class EguitraTransportMissionStep(models.Model):
    _name = "eguitra.transport.mission.step"
    _description = "Étape du plan de voyage"
    _order = "mission_id, sequence, id"

    mission_id = fields.Many2one("eguitra.transport.mission", "Ordre de mission", required=True, ondelete="cascade",
                                 index=True)
    company_id = fields.Many2one(related="mission_id.company_id", store=True, index=True)
    sequence = fields.Integer(default=10)
    place = fields.Char("Lieu", required=True)
    city = fields.Char("Ville")
    country = fields.Char("Pays")
    direction = fields.Selection(DIRECTIONS, "Sens", default="out", required=True)
    stop_reason = fields.Char("Motif d'escale")


class EguitraTransportRotation(models.Model):
    _inherit = "eguitra.transport.rotation"

    mission_ids = fields.One2many("eguitra.transport.mission", "rotation_id", "Ordre de mission")

    def _mission(self):
        self.ensure_one()
        return self.mission_ids[:1]

    def _ensure_mission(self):
        """Ordre de mission de l'opération, créé au besoin avec le plan de voyage de la route."""
        self.ensure_one()
        mission = self._mission()
        if not mission:
            if self.state == "cancelled":
                raise UserError(f"Rotation {self._label()} annulée : pas d'ordre de mission.")
            mission = self.env["eguitra.transport.mission"].sudo().create({"rotation_id": self.id})
        return mission

    def _mission_steps(self):
        """Étapes du plan de voyage : celles de l'ordre de mission, sinon celles que la route proposerait."""
        self.ensure_one()
        mission = self._mission()
        if mission:
            return [{"place": s.place, "city": s.city or "", "country": s.country or "", "direction": s.direction,
                     "stop_reason": s.stop_reason or ""} for s in mission.step_ids]
        return self.route_id._plan_steps() if self.route_id else []

    def _mission_missing(self):
        """Ce qui manque pour imprimer l'ordre de mission."""
        self.ensure_one()
        missing = []
        if not self.driver_id:
            missing.append("le chauffeur")
        if not self.tractor_id:
            missing.append("le tracteur (n° de parc et immatriculation)")
        if not self.trailer_id and self.vehicle_id.trailer_id:
            missing.append("la remorque")
        if not self.date_planned_departure:
            missing.append("la date de départ prévue (ETD)")
        steps = self._mission_steps()
        if len(steps) < 2:
            missing.append("le plan de voyage (départ et destination de la route, ou étapes saisies)")
        return missing
