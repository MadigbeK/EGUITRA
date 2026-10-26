"""Plan de trajet d'une rotation (motif V08 du verrou, spécification §4) : itinéraire, départ et arrivée
prévus, arrêts, pauses et repos prévus, conduite de nuit déclarée. Pas de télématique au lot 2 : le plan
est évalué sur ce qu'il prévoit.

V08 s'ouvre quand la rotation n'a pas de plan validé, quand le plan prévoit de la conduite de nuit sur une
route où la circulation de nuit est interdite (route marquée par HSSEQ, plage de nuit des paramètres), ou
quand la conduite prévue dépasse, sur une journée, le maximum des paramètres. Un compte exploitation valide
le plan, qui doit être conforme ; modifié ensuite, il revient « à valider ».
"""

from datetime import datetime, time, timedelta

from odoo import api, fields, models

from .common import JOURNEY_STATUSES, STOP_KINDS, HsseqError

PLAN_FIELDS = ("itinerary", "planned_departure", "planned_arrival", "night_driving")


def hours_label(value):
    whole = int(value)
    minutes = round((value - whole) * 60)
    return f"{whole} h {minutes:02d}" if minutes else f"{whole} h"


class EguitraTransportRoute(models.Model):
    _inherit = "eguitra.transport.route"

    hsseq_night_forbidden = fields.Boolean(
        "Circulation de nuit interdite",
        help="HSSEQ : un plan de trajet qui prévoit de rouler de nuit sur cette route ouvre le motif V08.")


class EguitraHsseqJourney(models.Model):
    _name = "eguitra.hsseq.journey"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Plan de trajet d'une rotation"
    _order = "planned_departure desc, id desc"
    _journal_key = "journey"
    _journal_fields = PLAN_FIELDS + ("status",)

    rotation_id = fields.Many2one("eguitra.transport.rotation", "Rotation", required=True, ondelete="cascade",
                                  index=True)
    company_id = fields.Many2one(related="rotation_id.company_id", store=True, index=True)
    route_id = fields.Many2one(related="rotation_id.route_id", store=True, string="Route")
    itinerary = fields.Text("Itinéraire", help="Axes empruntés, points de passage, contournements.")
    planned_departure = fields.Datetime("Départ prévu", required=True)
    planned_arrival = fields.Datetime("Arrivée prévue", required=True)
    night_driving = fields.Boolean("Conduite de nuit prévue")
    stop_ids = fields.One2many("eguitra.hsseq.journey.stop", "journey_id", "Arrêts et pauses prévus")
    status = fields.Selection(JOURNEY_STATUSES, "État", required=True, default="draft", index=True)
    validated_by = fields.Many2one("res.users", "Validé par", readonly=True)
    validated_at = fields.Datetime("Validé le", readonly=True)

    _rotation_unique = models.Constraint("unique(rotation_id)", "La rotation a déjà son plan de trajet.")

    @api.constrains("planned_departure", "planned_arrival")
    def _check_times(self):
        for journey in self:
            if journey.planned_arrival <= journey.planned_departure:
                raise HsseqError("invalid_parameter", "L'arrivée prévue suit le départ prévu.",
                                 fields=["planned_arrival"], status=400)

    def write(self, vals):
        """Un plan validé qu'on modifie revient « à valider »."""
        replanned = set(vals) & set(PLAN_FIELDS + ("stop_ids",))
        changed = self.filtered(lambda j: j.status == "validated") if replanned else self.browse()
        result = super().write(vals)
        if changed and "status" not in vals:
            changed._invalidate_plan()
        return result

    def _invalidate_plan(self):
        for journey in self.filtered(lambda j: j.status == "validated"):
            super(EguitraHsseqJourney, journey).write({"status": "draft", "validated_by": False, "validated_at": False})
            journey._journal("invalidated", note="Plan modifié après sa validation : à valider de nouveau.")

    # ─── Conduite prévue ──────────────────────────────────────────────────

    def _driving_segments(self):
        """Intervalles de conduite prévus : du départ à l'arrivée, hors arrêts, pauses et repos."""
        self.ensure_one()
        segments = [(self.planned_departure, self.planned_arrival)]
        for stop in self.stop_ids.sorted("planned_at"):
            if not stop.planned_at or not stop.duration_minutes:
                continue
            a, b = stop.planned_at, stop.planned_at + timedelta(minutes=stop.duration_minutes)
            result = []
            for start, end in segments:
                if b <= start or a >= end:
                    result.append((start, end))
                    continue
                if start < a:
                    result.append((start, a))
                if b < end:
                    result.append((b, end))
            segments = result
        return segments

    def _driving_by_day(self):
        """Heures de conduite prévues par jour (heure de Conakry, UTC)."""
        days = {}
        for start, end in self._driving_segments():
            cursor = start
            while cursor < end:
                midnight = datetime.combine(cursor.date() + timedelta(days=1), time.min)
                stop = min(end, midnight)
                days[cursor.date()] = days.get(cursor.date(), 0.0) + (stop - cursor).total_seconds() / 3600
                cursor = stop
        return days

    def _night_overlap(self, settings):
        """La conduite prévue passe-t-elle par la plage de nuit des paramètres ?"""
        start_h, end_h = settings.night_start_hour, settings.night_end_hour
        for start, end in self._driving_segments():
            day = start.date() - timedelta(days=1)
            while day <= end.date():
                night_start = datetime.combine(day, time.min) + timedelta(hours=start_h)
                night_end = datetime.combine(day + timedelta(days=1 if end_h <= start_h else 0), time.min) \
                    + timedelta(hours=end_h)
                if start < night_end and end > night_start:
                    return True
                day += timedelta(days=1)
        return False

    def _drives_at_night(self, settings):
        self.ensure_one()
        return self.night_driving or self._night_overlap(settings)

    def _issues(self, settings=None):
        """Écarts du plan aux règles de V08 : conduite de nuit sur une route interdite de nuit, conduite
        prévue au-delà du maximum journalier."""
        self.ensure_one()
        settings = settings or self.env["eguitra.hsseq.settings"]._get(self.company_id)
        issues = []
        route = self.sudo().route_id
        if route.hsseq_night_forbidden and self._drives_at_night(settings):
            issues.append({"code": "night_forbidden", "label": f"Conduite de nuit prévue sur la route {route.name}, "
                                                               f"interdite de nuit ({hours_label(settings.night_start_hour)}"
                                                               f" à {hours_label(settings.night_end_hour)})."})
        limit = settings.max_driving_hours or 0
        if limit:
            for day, hours in sorted(self._driving_by_day().items()):
                if hours > limit + 1e-6:
                    issues.append({"code": "driving_time", "label": f"{hours_label(hours)} de conduite prévues le "
                                                                    f"{day:%d/%m/%Y}, au-delà de {hours_label(limit)}."})
        return issues

    def action_validate(self):
        """Validation par un compte exploitation : le plan doit être conforme (sinon journey_not_compliant)."""
        self.ensure_one()
        issues = self._issues()
        if issues:
            raise HsseqError("journey_not_compliant", " ".join(i["label"] for i in issues),
                             fields=[i["code"] for i in issues])
        if self.status == "validated":
            return True
        super().write({"status": "validated", "validated_by": self.env.uid, "validated_at": fields.Datetime.now()})
        self._journal("validate")
        return True


class EguitraHsseqJourneyStop(models.Model):
    _name = "eguitra.hsseq.journey.stop"
    _description = "Arrêt ou pause prévu d'un plan de trajet"
    _order = "journey_id, planned_at, id"

    journey_id = fields.Many2one("eguitra.hsseq.journey", "Plan de trajet", required=True, ondelete="cascade",
                                 index=True)
    company_id = fields.Many2one(related="journey_id.company_id", store=True, index=True)
    kind = fields.Selection(STOP_KINDS, "Nature", required=True, default="break")
    place = fields.Char("Lieu")
    planned_at = fields.Datetime("Prévu le", required=True)
    duration_minutes = fields.Integer("Durée (minutes)", required=True, default=30)

    @api.constrains("duration_minutes")
    def _check_duration(self):
        if any(s.duration_minutes <= 0 for s in self):
            raise HsseqError("invalid_parameter", "La durée d'un arrêt est positive.", fields=["stops"], status=400)


class EguitraTransportRotation(models.Model):
    _inherit = "eguitra.transport.rotation"

    hsseq_journey_ids = fields.One2many("eguitra.hsseq.journey", "rotation_id", "Plan de trajet")

    def _hsseq_journey(self):
        self.ensure_one()
        return self.sudo().hsseq_journey_ids[:1]
