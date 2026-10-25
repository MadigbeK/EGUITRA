"""Indicateurs du cockpit HSSEQ (spécification §10, contrat §4), calculés depuis les données d'origine :
événements et contrôles d'HSSEQ, rotations et kilomètres de Transport, heures travaillées et absences pour
accident du travail de RH (au mois et par société, sans maille site : le taux de fréquence et le taux de
gravité ne se filtrent pas par site).

Chaque mois est décomposé en composantes brutes par société (nombres, kilomètres, heures…) ; un indicateur
est un rapport de sommes sur sa fenêtre (le mois, ou douze mois glissants). Un mois est figé le 5 du mois
suivant : ses composantes sont enregistrées (eguitra.hsseq.indicator.snapshot) et servent ensuite au
cockpit sans filtre, au lieu d'un nouveau calcul.
"""

from datetime import date, datetime, time, timedelta

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models

from .common import ACCIDENT_TYPES, WEAK_SIGNAL_TYPES, vehicle_kind

MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
             "novembre", "décembre"]
CO2_PER_LITER = 2.68  # kg de CO₂ par litre de gazole
FREEZE_DAY = 5

# code, libellé, unité, sens, source, formule, douze mois glissants, filtrable par site
INDICATORS = [
    ("frequency_rate", "Taux de fréquence", "rate", "down", "Événements, RH",
     "Accidents du travail avec arrêt × 1 000 000 ÷ heures travaillées, 12 mois glissants", True, False),
    ("severity_rate", "Taux de gravité", "rate", "down", "Événements, RH",
     "Jours perdus × 1 000 ÷ heures travaillées, 12 mois glissants", True, False),
    ("road_accidents_per_mkm", "Accidents de la route par million de km", "rate", "down", "Événements, Transport",
     "Accidents de la route × 1 000 000 ÷ km parcourus, 12 mois glissants", True, True),
    ("reporting_ratio", "Taux de déclaration", "ratio", "up", "Événements",
     "(Presque-accidents + situations dangereuses) ÷ accidents, 12 mois glissants", True, True),
    ("check_completion", "Réalisation des contrôles avant départ", "pct", "up", "NIMOVA Terrain, Transport",
     "Départs contrôlés ÷ départs", False, True),
    ("check_compliance", "Conformité des contrôles", "pct", "up", "NIMOVA Terrain",
     "Contrôles sans point critique non conforme ÷ contrôles réalisés", False, True),
    ("breath_test_completion", "Alcootests réalisés", "pct", "up", "NIMOVA Terrain",
     "Départs avec un alcootest réalisé ÷ départs", False, True),
    ("breath_test_positives", "Alcootests positifs", "count", "down", "NIMOVA Terrain",
     "Nombre d'alcootests positifs, sans nom", False, True),
    ("waivers", "Dérogations au verrou", "count", "down", "Verrou de départ",
     "Dérogations activées, par site et par motif", False, True),
    ("actions_on_time", "Actions dans les délais", "pct", "up", "Actions",
     "Actions réalisées à l'échéance ÷ actions échues", False, True),
    ("actions_effectiveness", "Efficacité des actions", "pct", "up", "Actions",
     "Actions efficaces à J+90 ÷ actions vérifiées", False, True),
    ("qualifications_valid", "Habilitations à jour", "pct", "up", "Habilitations RH",
     "Conducteurs actifs sans habilitation expirée ni absente ÷ conducteurs actifs", False, True),
    ("fuel_consumption", "Consommation", "l_100km", "down", "Transport",
     "Litres aux 100 km (rotations dont le carburant est saisi)", False, True),
    ("co2_emissions", "Émissions de CO₂", "kg_co2_km", "down", "Transport",
     "kg de CO₂ par km (2,68 kg par litre de gazole)", False, True),
    ("tanker_shortage", "Écarts de livraison des citernes", "per_mille", "down", "Transport",
     "Volume manquant ÷ volume livré", False, True),
    ("tipper_variance", "Écarts de tonnage des bennes", "per_mille", "down", "Transport",
     "Écart de tonnage ÷ tonnage chargé", False, True),
]
NOTES = {
    "frequency_rate": "12 mois glissants ; heures de RH par société, sans filtre de site.",
    "severity_rate": "12 mois glissants ; heures de RH par société, sans filtre de site.",
    "qualifications_valid": "Situation du jour ; les mois passés figés gardent la leur.",
    "tipper_variance": "Sans objet au lot 1 : une seule pesée par rotation, pas de tonnage livré.",
}
COMPONENTS = ("at_accidents", "lost_days", "hours", "road_accidents", "accidents", "weak_signals", "km", "fuel_liters",
              "fuel_km", "departures", "departures_checked", "departures_tested", "checks", "checks_ok",
              "breath_positives", "waivers", "actions_due", "actions_on_time", "actions_verified", "actions_effective",
              "tanker_shortage", "tanker_delivered")


def month_start(day):
    return day.replace(day=1)


def month_end(day):
    return month_start(day) + relativedelta(months=1) - timedelta(days=1)


def months_back(month, count):
    """Les `count` mois finissant à `month` (premiers jours), du plus ancien au plus récent."""
    return [month - relativedelta(months=i) for i in range(count - 1, -1, -1)]


def empty():
    return dict.fromkeys(COMPONENTS, 0.0) | {"basis": "paid", "waiver_rows": {}, "drivers": None, "drivers_valid": None}


class EguitraHsseqIndicatorSnapshot(models.Model):
    _name = "eguitra.hsseq.indicator.snapshot"
    _description = "Indicateurs HSSEQ figés d'un mois"
    _order = "month desc, company_id"

    company_id = fields.Many2one("res.company", required=True, index=True, ondelete="cascade")
    month = fields.Date("Mois", required=True, index=True)
    components = fields.Json("Composantes")
    frozen_on = fields.Date("Figé le", required=True, default=fields.Date.context_today)

    _company_month_unique = models.Constraint("unique(company_id, month)", "Ce mois est déjà figé pour la société.")


class EguitraHsseqCockpit(models.AbstractModel):
    _name = "eguitra.hsseq.cockpit"
    _description = "Cockpit HSSEQ"

    # ─── Composantes mensuelles ───────────────────────────────────────────

    @api.model
    def _vehicle_domain(self, field, sites, kind):
        domain = []
        if sites:
            domain.append((f"{field}.site_id", "in", sites.ids))
        if kind and "vehicle_kind" in self.env["eguitra.transport.vehicle"]._fields:
            domain.append((f"{field}.vehicle_kind", "=", kind))
        return domain

    @api.model
    def _live(self, companies, months, sites=None, kind=None):
        """Composantes {(société, mois): {...}} des mois donnés, recalculées depuis les données d'origine."""
        env = self.env
        res = {(c.id, m): empty() for c in companies for m in months}
        start, end = months[0], month_end(months[-1])
        start_dt, end_dt = datetime.combine(start, time.min), datetime.combine(end, time.max)
        sites = sites or env["eguitra.hsseq.site"]

        def bucket(company_id, day):
            if not day:
                return None
            day = day.date() if isinstance(day, datetime) else day
            return res.get((company_id, month_start(day)))

        cids = companies.ids
        # Événements.
        domain = [("company_id", "in", cids), ("occurred_at", ">=", start_dt), ("occurred_at", "<=", end_dt)]
        if sites:
            domain.append(("site_id", "in", sites.ids))
        if kind:
            domain += self._vehicle_domain("vehicle_id", None, kind)
        for event in env["eguitra.hsseq.event"].sudo().search(domain):
            row = bucket(event.company_id.id, event.occurred_at)
            if row is None:
                continue
            row["road_accidents"] += event.event_type == "road_accident"
            row["accidents"] += event.event_type in ACCIDENT_TYPES
            row["weak_signals"] += event.event_type in WEAK_SIGNAL_TYPES
        # Départs (rotations parties, validées ou facturées) et kilomètres.
        Rotation = env["eguitra.transport.rotation"].sudo()
        states = [s for s in ("en_route", "done", "invoiced") if s in dict(Rotation._fields["state"].selection)]
        domain = [("company_id", "in", cids), ("state", "in", states), ("date_loading", ">=", start),
                  ("date_loading", "<=", end)] + self._vehicle_domain("vehicle_id", sites, kind)
        rotations = Rotation.search(domain)
        checked = set(env["eguitra.hsseq.check"].sudo().search(
            [("rotation_id", "in", rotations.ids), ("kind", "=", "pre_departure")]).rotation_id.ids)
        tested = set(env["eguitra.hsseq.breath.test"].sudo().search(
            [("rotation_id", "in", rotations.ids), ("status", "!=", "not_done")]).rotation_id.ids)
        for rot in rotations:
            row = bucket(rot.company_id.id, rot.date_loading)
            if row is None:
                continue
            row["departures"] += 1
            row["departures_checked"] += rot.id in checked
            row["departures_tested"] += rot.id in tested
            row["km"] += rot.distance_km or 0.0
            if rot.fuel_liters:
                row["fuel_liters"] += rot.fuel_liters
                row["fuel_km"] += rot.distance_km or 0.0
            if vehicle_kind(rot.vehicle_id) == "tanker":
                row["tanker_shortage"] += rot.shortage or 0.0
                row["tanker_delivered"] += rot.volume_delivered or 0.0
        # Contrôles avant départ.
        domain = [("company_id", "in", cids), ("kind", "=", "pre_departure"), ("reported_at", ">=", start_dt),
                  ("reported_at", "<=", end_dt)] + self._vehicle_domain("vehicle_id", sites, kind)
        for check in env["eguitra.hsseq.check"].sudo().search(domain):
            row = bucket(check.company_id.id, check.reported_at)
            if row is not None:
                row["checks"] += 1
                row["checks_ok"] += check.result != "blocking"
        # Alcootests positifs, sans nom.
        domain = [("company_id", "in", cids), ("status", "=", "non_compliant"), ("test_date", ">=", start),
                  ("test_date", "<=", end)] + self._vehicle_domain("rotation_id.vehicle_id", sites, kind)
        for test in env["eguitra.hsseq.breath.test"].sudo().search(domain):
            row = bucket(test.company_id.id, test.test_date)
            if row is not None:
                row["breath_positives"] += 1
        # Dérogations activées, par site et par motif.
        domain = [("company_id", "in", cids), ("status", "in", ("active", "expired")), ("approved_at", ">=", start_dt),
                  ("approved_at", "<=", end_dt)] + self._vehicle_domain("vehicle_id", sites, kind)
        for waiver in env["eguitra.hsseq.waiver"].sudo().search(domain):
            row = bucket(waiver.company_id.id, waiver.approved_at)
            if row is not None:
                row["waivers"] += 1
                key = f"{waiver.site_id.name or 'Sans site'}|{waiver.reason_code}"
                row["waiver_rows"][key] = row["waiver_rows"].get(key, 0) + 1
        # Actions échues et vérifiées.
        Action = env["eguitra.hsseq.action"].sudo()
        day = fields.Date.context_today(self)
        site_domain = [("site_id", "in", sites.ids)] if sites else []
        for action in Action.search([("company_id", "in", cids), ("status", "!=", "cancelled"), ("due_date", ">=", start),
                                     ("due_date", "<=", min(end, day - timedelta(days=1)))] + site_domain):
            row = bucket(action.company_id.id, action.due_date)
            if row is not None:
                row["actions_due"] += 1
                row["actions_on_time"] += bool(action.done_at and action.done_at.date() <= action.due_date)
        for action in Action.search([("company_id", "in", cids), ("verified_at", ">=", start_dt),
                                     ("verified_at", "<=", end_dt)] + site_domain):
            row = bucket(action.company_id.id, action.verified_at)
            if row is not None:
                row["actions_verified"] += 1
                row["actions_effective"] += action.effective
        # RH : heures travaillées et accidents du travail, par société.
        Employee = env["eguitra.rh.employee"].sudo()
        for company in companies:
            worked = Employee._hsseq_worked_hours(company, start, end)
            for entry in worked["months"]:
                row = res.get((company.id, month_start(entry["month"])))
                if row is not None:
                    row["hours"] += entry["hours"]
                    if entry["basis"] != "paid":
                        row["basis"] = "presence"
            for leave in Employee._hsseq_work_accidents(company, start, end):
                row = bucket(company.id, leave["date_from"])
                if row is not None:
                    row["at_accidents"] += 1
                for m in months:
                    a, b = max(leave["date_from"], m), min(leave["date_to"], month_end(m))
                    if a <= b and (company.id, m) in res:
                        res[(company.id, m)]["lost_days"] += (b - a).days + 1
        return res

    @api.model
    def _qualifications(self, companies, sites=None):
        """Conducteurs actifs (salariés RH liés à un chauffeur) et ceux dont les habilitations sont à jour."""
        Employee = self.env["eguitra.rh.employee"].sudo()
        day = fields.Date.context_today(self)
        drivers = Employee.search([("company_id", "in", companies.ids), ("driver_id", "!=", False),
                                   ("hire_date", "<=", day), "|", ("exit_date", "=", False), ("exit_date", ">=", day)])
        if sites:
            on_site = self.env["eguitra.transport.vehicle"].sudo().search([("site_id", "in", sites.ids)]).driver_id
            drivers = drivers.filtered(lambda e: e.driver_id in on_site)
        valid = [e for e in drivers if not Employee._hsseq_driver_status(e.driver_id, day)["blocking"]]
        return len(drivers), len(valid)

    @api.model
    def _components(self, companies, months, sites=None, kind=None):
        """Composantes des mois : figées (sans filtre) quand elles existent, recalculées sinon."""
        frozen = {}
        if not sites and not kind:
            for snap in self.env["eguitra.hsseq.indicator.snapshot"].sudo().search(
                    [("company_id", "in", companies.ids), ("month", "in", months)]):
                frozen[(snap.company_id.id, snap.month)] = snap
        live_months = [m for m in months if any((c.id, m) not in frozen for c in companies)]
        res = self._live(companies, live_months, sites, kind) if live_months else {}
        for key, snap in frozen.items():
            res[key] = dict(empty(), **(snap.components or {}))
        return res, frozen

    # ─── Indicateurs ──────────────────────────────────────────────────────

    @api.model
    def _sum(self, comps, companies, window):
        total = empty()
        for m in window:
            for c in companies:
                row = comps.get((c.id, m))
                if not row:
                    continue
                for key in COMPONENTS:
                    total[key] += row.get(key) or 0.0
                if row.get("basis") == "presence":
                    total["basis"] = "presence"
                for key, count in (row.get("waiver_rows") or {}).items():
                    total["waiver_rows"][key] = total["waiver_rows"].get(key, 0) + count
                if row.get("drivers") is not None:
                    total["drivers"] = (total["drivers"] or 0) + row["drivers"]
                    total["drivers_valid"] = (total["drivers_valid"] or 0) + row["drivers_valid"]
        return total

    @staticmethod
    def _ratio(num, den, factor=1.0, digits=2):
        return round(num * factor / den, digits) if den else None

    @api.model
    def _value(self, code, t, kind=None):
        r = self._ratio
        if code == "frequency_rate":
            return r(t["at_accidents"], t["hours"], 1_000_000)
        if code == "severity_rate":
            return r(t["lost_days"], t["hours"], 1000)
        if code == "road_accidents_per_mkm":
            return r(t["road_accidents"], t["km"], 1_000_000)
        if code == "reporting_ratio":
            return r(t["weak_signals"], t["accidents"])
        if code == "check_completion":
            return r(t["departures_checked"], t["departures"], 100, 1)
        if code == "check_compliance":
            return r(t["checks_ok"], t["checks"], 100, 1)
        if code == "breath_test_completion":
            return r(t["departures_tested"], t["departures"], 100, 1)
        if code == "breath_test_positives":
            return int(t["breath_positives"])
        if code == "waivers":
            return int(t["waivers"])
        if code == "actions_on_time":
            return r(t["actions_on_time"], t["actions_due"], 100, 1)
        if code == "actions_effectiveness":
            return r(t["actions_effective"], t["actions_verified"], 100, 1)
        if code == "qualifications_valid":
            return r(t["drivers_valid"], t["drivers"], 100, 1) if t["drivers"] is not None else None
        if code == "fuel_consumption":
            return r(t["fuel_liters"], t["fuel_km"], 100, 1)
        if code == "co2_emissions":
            return r(t["fuel_liters"] * CO2_PER_LITER, t["fuel_km"])
        if code == "tanker_shortage":
            return None if kind == "tipper" else r(t["tanker_shortage"], t["tanker_delivered"], 1000)
        return None  # tipper_variance : sans objet au lot 1

    @api.model
    def _compute(self, companies, month, period="month", sites=None, kind=None):
        """Indicateurs du mois demandé (ou des douze mois qui s'y terminent), séries de douze mois."""
        sites = sites or self.env["eguitra.hsseq.site"]
        day = fields.Date.context_today(self)
        all_months = months_back(month, 23)
        comps, frozen = self._components(companies, all_months, sites, kind)
        current = month_start(day)
        # Situation des habilitations : celle du jour pour le mois en cours.
        if month == current:
            drivers, valid = self._qualifications(companies, sites)
            for c in companies:
                comps.setdefault((c.id, month), empty())
            first = companies[:1]
            comps[(first.id, month)]["drivers"] = drivers
            comps[(first.id, month)]["drivers_valid"] = valid
        settings = self.env["eguitra.hsseq.settings"]._get(companies[:1] or self.env.company)
        last12 = months_back(month, 12)
        indicators = []
        for code, label, unit, direction, source, formula, rolling, site_scoped in INDICATORS:
            series = []
            for p in last12:
                window = months_back(p, 12) if rolling else [p]
                series.append({"month": p.strftime("%Y-%m"),
                               "value": self._value(code, self._sum(comps, companies, window), kind)})
            window = last12 if (rolling or period == "12m") else [month]
            if code == "qualifications_valid":
                window = [month]
            total = self._sum(comps, companies, window)
            value = self._value(code, total, kind)
            target = settings._target(code)
            met = None if value is None or target is None else (value <= target if direction == "down" else value >= target)
            breakdown = None
            if code == "waivers":
                breakdown = [{"site": key.split("|")[0], "reason_code": key.split("|")[1], "count": count}
                             for key, count in sorted(total["waiver_rows"].items())]
            indicators.append({
                "code": code, "label": label, "value": value, "target": target, "unit": unit, "direction": direction,
                "met": met, "source": source, "formula": formula, "series": series, "breakdown": breakdown,
                "site_scoped": site_scoped, "note": NOTES.get(code),
            })
        rh_total = self._sum(comps, companies, last12)
        month_frozen = bool(companies) and all((c.id, month) in frozen for c in companies)
        return {
            "indicators": indicators,
            "hours_basis": rh_total["basis"],
            "frozen": month_frozen,
            "frozen_on": min(frozen[(c.id, month)].frozen_on for c in companies) if month_frozen else None,
        }

    # ─── Mois figés ───────────────────────────────────────────────────────

    @api.model
    def _freeze(self, company, month):
        Snapshot = self.env["eguitra.hsseq.indicator.snapshot"].sudo()
        if Snapshot.search_count([("company_id", "=", company.id), ("month", "=", month)]):
            return False
        comps = self._live(company, [month])[(company.id, month)]
        comps["drivers"], comps["drivers_valid"] = self._qualifications(company)
        return Snapshot.create({"company_id": company.id, "month": month, "components": comps})

    @api.model
    def _cron_freeze(self):
        """Le 5 du mois (et les jours suivants, si la tâche n'a pas tourné) : fige le mois précédent."""
        day = fields.Date.context_today(self)
        if day.day < FREEZE_DAY:
            return True
        previous = month_start(day) - relativedelta(months=1)
        for company in self.env["res.company"].sudo().search([]):
            self._freeze(company, previous)
        return True


def parse_month(value, default):
    """« AAAA-MM » -> premier jour du mois."""
    if not value:
        return month_start(default)
    year, month = str(value).split("-")[:2]
    return date(int(year), int(month), 1)


def month_label(month):
    return f"{MONTHS_FR[month.month - 1]} {month.year}"
