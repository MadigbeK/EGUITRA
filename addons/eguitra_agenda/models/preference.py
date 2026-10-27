"""Réglages de l'agenda de chaque compte : heures de travail, fuseau, rappels par défaut, temps tampon,
récapitulatif du matin, absence du bureau, disponibilités visibles des collègues, sources métier."""

from datetime import timedelta

from psycopg2 import IntegrityError

from odoo import api, fields, models
from odoo.exceptions import UserError

from .. import moteur
from .common import check_alarms, clean_text, parse_datetime

DEFAULT_ALARMS = [{"minutes": 15, "channel": "app"}]


class AgendaPreference(models.Model):
    _name = "eguitra.agenda.preference"
    _description = "Réglages de l'agenda d'un compte"

    user_id = fields.Many2one("res.users", "Compte", required=True, index=True, ondelete="cascade")
    tz = fields.Char("Fuseau", default=moteur.DEFAULT_TZ)
    work_hours = fields.Json("Heures de travail")
    default_alarms = fields.Json("Rappels par défaut")
    buffer_minutes = fields.Integer("Temps tampon", default=0, help="Minutes libres gardées autour des réunions "
                                                                     "proposées par « Trouver un créneau ».")
    digest = fields.Boolean("Récapitulatif du matin par courriel")
    digest_hour = fields.Integer("Heure du récapitulatif", default=7)
    last_digest_date = fields.Date("Dernier récapitulatif")
    freebusy_visible = fields.Boolean("Disponibilités visibles des collègues", default=True)
    ooo_active = fields.Boolean("Absent du bureau")
    ooo_start = fields.Datetime("Absent du")
    ooo_stop = fields.Datetime("Absent jusqu'au")
    ooo_message = fields.Text("Message d'absence")
    ooo_auto_decline = fields.Boolean("Refuser les invitations pendant l'absence")
    sources = fields.Json("Sources métier affichées", help="Codes des sources ; vide : celles proposées par défaut.")

    _user_unique = models.Constraint("unique(user_id)", "Un seul réglage d'agenda par compte.")

    @api.model
    def _for(self, user):
        """Réglages du compte ; sans réglage enregistré, les valeurs par défaut (rien n'est écrit : une
        lecture des disponibilités d'un collègue ne crée rien)."""
        pref = self.sudo().search([("user_id", "=", user.id)], limit=1)
        # Un enregistrement en mémoire ne reçoit pas les valeurs par défaut des champs : elles sont données ici.
        return pref or self.sudo().new({"user_id": user.id, "tz": user.sudo().tz or moteur.DEFAULT_TZ,
                                        "freebusy_visible": True, "digest_hour": 7, "buffer_minutes": 0})

    @api.model
    def _get_or_create(self, user):
        pref = self.sudo().search([("user_id", "=", user.id)], limit=1)
        if pref:
            return pref
        try:
            with self.env.cr.savepoint():
                return self.sudo().create({"user_id": user.id, "tz": user.sudo().tz or moteur.DEFAULT_TZ})
        except IntegrityError as e:
            raise UserError("Vos réglages viennent d'être créés par un autre onglet : réessayez.") from e

    def _tz(self):
        self.ensure_one()
        return self.tz if moteur.known_zone(self.tz) else moteur.DEFAULT_TZ

    def _work(self):
        self.ensure_one()
        return self.work_hours if isinstance(self.work_hours, dict) else dict(moteur.DEFAULT_WORK_HOURS)

    def _alarms(self):
        self.ensure_one()
        return self.default_alarms if isinstance(self.default_alarms, list) else list(DEFAULT_ALARMS)

    def _ooo_window(self):
        """Absence du bureau en cours ou annoncée : (début, fin) UTC, ou None."""
        self.ensure_one()
        if not self.ooo_active or not self.ooo_stop or self.ooo_stop <= fields.Datetime.now():
            return None
        return (self.ooo_start or fields.Datetime.now(), self.ooo_stop)

    def _ooo_overlaps(self, start, stop):
        window = self._ooo_window()
        return bool(window and window[0] < stop and window[1] > start)

    def _row(self):
        self.ensure_one()
        window = self._ooo_window()
        return {
            "tz": self._tz(),
            "work_hours": {day: [[moteur.hhmm(a), moteur.hhmm(b)] for a, b in ranges]
                           for day, ranges in self._work().items()},
            "default_alarms": self._alarms(),
            "buffer_minutes": self.buffer_minutes,
            "digest": self.digest,
            "digest_hour": self.digest_hour,
            "freebusy_visible": self.freebusy_visible,
            "ooo": {"active": bool(self.ooo_active), "start": self.ooo_start or None, "stop": self.ooo_stop or None,
                    "message": self.ooo_message or None, "auto_decline": self.ooo_auto_decline,
                    "current": bool(window and window[0] <= fields.Datetime.now())},
            "sources": self.sources if isinstance(self.sources, list) else None,
        }

    def update_from(self, data):
        """Réglages saisis par le compte lui-même."""
        self.ensure_one()
        vals = {}
        if "tz" in data:
            if not moteur.known_zone(data.get("tz")):
                raise UserError("Fuseau horaire inconnu.")
            vals["tz"] = data["tz"]
        if "work_hours" in data:
            try:
                vals["work_hours"] = moteur.check_work_hours(data["work_hours"] or {})
            except moteur.RuleError as e:
                raise UserError(str(e)) from e
        if "default_alarms" in data:
            vals["default_alarms"] = check_alarms(data["default_alarms"] or [])
        if "buffer_minutes" in data:
            try:
                vals["buffer_minutes"] = max(0, min(int(data["buffer_minutes"] or 0), 120))
            except (TypeError, ValueError) as e:
                raise UserError("Temps tampon invalide.") from e
        if "digest" in data:
            vals["digest"] = bool(data["digest"])
        if "digest_hour" in data:
            try:
                hour = int(data["digest_hour"])
            except (TypeError, ValueError) as e:
                raise UserError("Heure du récapitulatif invalide.") from e
            if not 5 <= hour <= 10:
                raise UserError("Le récapitulatif part entre 5 h et 10 h du matin.")
            vals["digest_hour"] = hour
        if "freebusy_visible" in data:
            vals["freebusy_visible"] = bool(data["freebusy_visible"])
        if "sources" in data:
            codes = data["sources"]
            if codes is not None and (not isinstance(codes, list) or not all(isinstance(c, str) for c in codes)):
                raise UserError("Sources métier illisibles.")
            known = self.env["eguitra.agenda.source"]._catalog_codes()
            vals["sources"] = [c for c in dict.fromkeys(codes) if c in known] if codes is not None else False
        if "ooo" in data:
            vals.update(self._ooo_values(data["ooo"] or {}))
        if vals:
            self.write(vals)
        return self

    def _ooo_values(self, ooo):
        if not ooo.get("active"):
            return {"ooo_active": False}
        start = parse_datetime(ooo["start"], "début de l'absence") if ooo.get("start") else fields.Datetime.now()
        stop = parse_datetime(ooo.get("stop"), "fin de l'absence")
        if stop <= start:
            raise UserError("L'absence finit après son début.")
        if stop > start + timedelta(days=366):
            raise UserError("Une absence du bureau dure un an au plus.")
        return {"ooo_active": True, "ooo_start": start, "ooo_stop": stop,
                "ooo_message": clean_text(ooo.get("message"), 1000) or False,
                "ooo_auto_decline": bool(ooo.get("auto_decline"))}
