"""Indicateurs du cockpit HSSEQ (spécification §10, contrat §4), calculés depuis les données d'origine :
événements et contrôles d'HSSEQ, rotations et kilomètres de Transport, heures travaillées et absences pour
accident du travail de RH (au mois et par société, sans maille site : le taux de fréquence et le taux de
gravité ne se filtrent pas par site). Au lot 3 : carburant et émissions, écarts de livraison des citernes et
des bennes (Transport), déversements, poussières, réclamations, contaminations et déchets, violations de la
télématique, exercices d'urgence.

Chaque mois est décomposé en composantes brutes par société (nombres, kilomètres, heures…) ; un indicateur
est un rapport de sommes sur sa fenêtre (le mois, ou douze mois glissants). Un mois est figé le 5 du mois
suivant : ses composantes sont enregistrées (eguitra.hsseq.indicator.snapshot) et servent ensuite au
cockpit sans filtre, au lieu d'un nouveau calcul.
"""

from datetime import date, datetime, time, timedelta

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models

from .common import (
    ACCIDENT_TYPES,
    EVENT_TYPES,
    STANDARDS,
    VIOLATION_TYPES,
    WASTE_KINDS,
    WEAK_SIGNAL_TYPES,
    indicator_status,
    tipper_tonnages,
    vehicle_kind,
)
from .settings import CO2_PER_LITER

MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre",
             "novembre", "décembre"]
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
     "kg de CO₂ par km (facteur d'émission des paramètres, 2,68 kg par litre de gazole par défaut)", False, True),
    ("tanker_shortage", "Écarts de livraison des citernes", "per_mille", "down", "Transport",
     "Volume manquant ÷ volume livré", False, True),
    ("tipper_variance", "Écarts de tonnage des bennes", "per_mille", "down", "Transport (pesées et livraisons)",
     "Écart de tonnage ÷ tonnage chargé", False, True),
    # Lot 2.
    ("audits_completion", "Audits réalisés contre planifiés", "pct", "up", "Audits",
     "Audits réalisés ÷ audits planifiés du mois (audits annulés exclus)", False, True),
    ("immobilizations", "Immobilisations de véhicules (V09)", "count", "down", "Événements, verrou de départ",
     "Immobilisations posées dans le mois par un événement en cours d'enquête", False, True),
    # Lot 3.
    ("spills", "Déversements", "count", "down", "Environnement (déversements)",
     "Déversements survenus dans le mois", False, True),
    ("dust_exceedances", "Dépassements du seuil de poussières", "count", "down", "Environnement (poussières sur site)",
     "Mesures de poussières au-dessus de leur seuil", False, True),
    ("complaints", "Réclamations clients", "count", "down", "Qualité (réclamations clients)",
     "Réclamations reçues dans le mois", False, True),
    ("complaints_on_time", "Réclamations traitées dans le délai", "pct", "up", "Qualité (réclamations clients)",
     "Réclamations répondues dans le délai ÷ réclamations dont le délai de réponse est échu", False, True),
    ("telematics_violations", "Violations de conduite par 100 voyages", "per_100_trips", "down",
     "Télématique (import des violations), Transport",
     "Violations (excès de vitesse, freinage brusque, conduite de nuit, temps de conduite) × 100 ÷ départs",
     False, True),
    ("drills_completion", "Exercices d'urgence réalisés contre planifiés", "pct", "up", "Documents et urgences",
     "Exercices réalisés ÷ exercices planifiés du mois (exercices annulés exclus)", False, True),
]
# Famille d'un indicateur pour le comité des donneurs d'ordre : proactif (moyens et démarches), réactif
# (résultats constatés).
FAMILY = {"frequency_rate": "reactive", "severity_rate": "reactive", "road_accidents_per_mkm": "reactive",
          "reporting_ratio": "proactive", "check_completion": "proactive", "check_compliance": "proactive",
          "breath_test_completion": "proactive", "breath_test_positives": "reactive", "waivers": "reactive",
          "actions_on_time": "proactive", "actions_effectiveness": "proactive", "qualifications_valid": "proactive",
          "fuel_consumption": "reactive", "co2_emissions": "reactive", "tanker_shortage": "reactive",
          "tipper_variance": "reactive", "audits_completion": "proactive", "immobilizations": "reactive",
          "spills": "reactive", "dust_exceedances": "reactive", "complaints": "reactive",
          "complaints_on_time": "proactive", "telematics_violations": "reactive", "drills_completion": "proactive"}
# Marge « sous surveillance » du cockpit : jusqu'à 85 % de la cible (sens up), ou cible ÷ 0,85 (sens down).
WATCH_RATIO = 0.85
NOTES = {
    "frequency_rate": "12 mois glissants ; heures de RH par société, sans filtre de site.",
    "severity_rate": "12 mois glissants ; heures de RH par société, sans filtre de site.",
    "qualifications_valid": "Situation du jour ; les mois passés figés gardent la leur.",
    "co2_emissions": "Facteur d'émission par litre des paramètres de chaque société.",
    "tipper_variance": "Tonnage chargé : poids net du ticket de pesée (à défaut, quantité chargée) ; tonnage livré : "
                       "quantité livrée de la rotation, base de la facturation à la tonne.",
    "dust_exceedances": "Mesure de site : le filtre de profil de véhicule ne s'y applique pas.",
    "telematics_violations": "Violations importées (CSV ou Excel) en attendant l'interface du fournisseur.",
    "drills_completion": "Exercice de site : le filtre de profil de véhicule ne s'y applique pas.",
}
COMPONENTS = ("at_accidents", "lost_days", "hours", "road_accidents", "accidents", "weak_signals", "km", "fuel_liters",
              "fuel_km", "departures", "departures_checked", "departures_tested", "checks", "checks_ok",
              "breath_positives", "waivers", "actions_due", "actions_on_time", "actions_verified", "actions_effective",
              "tanker_shortage", "tanker_delivered", "audits_planned", "audits_done", "immobilizations",
              # Lot 3.
              "co2_kg", "tipper_loaded", "tipper_variance", "spills", "spill_liters", "spill_recovered_liters",
              "dust_measurements", "dust_exceedances", "complaints", "complaints_due", "complaints_on_time",
              "contaminations", "wastes", "wastes_collected", "violations", "drills_planned", "drills_done") + tuple(
    f"type_{code}" for code, _label in EVENT_TYPES) + tuple(
    f"violations_{code}" for code, _label in VIOLATION_TYPES) + tuple(
    f"waste_{code}_{unit}" for code, _label in WASTE_KINDS for unit in ("l", "kg", "t", "unit"))


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
            row[f"type_{event.event_type}"] += 1
        # Audits planifiés dans le mois (annulés exclus) et ceux qui sont réalisés.
        domain = [("company_id", "in", cids), ("status", "!=", "cancelled"), ("planned_date", ">=", start),
                  ("planned_date", "<=", end)] + ([("site_id", "in", sites.ids)] if sites else [])
        for audit in env["eguitra.hsseq.audit"].sudo().search(domain):
            row = bucket(audit.company_id.id, audit.planned_date)
            if row is not None:
                row["audits_planned"] += 1
                row["audits_done"] += audit.status in ("done", "closed")
        # Immobilisations de véhicules (V09) posées dans le mois.
        domain = [("company_id", "in", cids), ("since", ">=", start_dt), ("since", "<=", end_dt)] + \
            self._vehicle_domain("vehicle_id", sites, kind)
        for immobilization in env["eguitra.hsseq.immobilization"].sudo().search(domain):
            row = bucket(immobilization.company_id.id, immobilization.since)
            if row is not None:
                row["immobilizations"] += 1
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
        factors = env["eguitra.hsseq.environment"]._factors(companies)
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
                row["co2_kg"] += rot.fuel_liters * factors.get(rot.company_id.id, CO2_PER_LITER)
            if vehicle_kind(rot.vehicle_id) == "tanker":
                row["tanker_shortage"] += rot.shortage or 0.0
                row["tanker_delivered"] += rot.volume_delivered or 0.0
            else:
                loaded, delivered = tipper_tonnages(rot)
                if delivered:
                    row["tipper_loaded"] += loaded
                    row["tipper_variance"] += abs(loaded - delivered)
        # Contrôles avant départ (un contrôle complémentaire compte dans son contrôle d'origine).
        domain = [("company_id", "in", cids), ("kind", "=", "pre_departure"), ("complement_of_id", "=", False),
                  ("reported_at", ">=", start_dt), ("reported_at", "<=", end_dt)] + self._vehicle_domain(
                      "vehicle_id", sites, kind)
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
        self._live_lot3(res, cids, start, end, day, sites, kind, bucket)
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
    def _live_lot3(self, res, cids, start, end, day, sites, kind, bucket):
        """Composantes du lot 3 : déversements, poussières, réclamations, contaminations, déchets, violations
        de la télématique, exercices d'urgence. Une mesure de poussières, un déchet et un exercice relèvent
        d'un site : le filtre de profil de véhicule ne s'y applique pas."""
        env = self.env
        start_dt, end_dt = datetime.combine(start, time.min), datetime.combine(end, time.max)
        site_domain = [("site_id", "in", sites.ids)] if sites else []
        kind_domain = self._vehicle_domain("vehicle_id", None, kind)
        base = [("company_id", "in", cids)]
        for spill in env["eguitra.hsseq.spill"].sudo().search(
                base + [("occurred_at", ">=", start_dt), ("occurred_at", "<=", end_dt)] + site_domain + kind_domain):
            row = bucket(spill.company_id.id, spill.occurred_at)
            if row is not None:
                row["spills"] += 1
                row["spill_liters"] += spill.volume_liters
                row["spill_recovered_liters"] += spill.recovered_liters
        for measure in env["eguitra.hsseq.dust"].sudo().search(
                base + [("measured_on", ">=", start), ("measured_on", "<=", end)] + site_domain):
            row = bucket(measure.company_id.id, measure.measured_on)
            if row is not None:
                row["dust_measurements"] += 1
                row["dust_exceedances"] += measure.exceeded
        Complaint = env["eguitra.hsseq.complaint"].sudo()
        for complaint in Complaint.search(base + [("received_on", ">=", start), ("received_on", "<=", end)]
                                          + site_domain + kind_domain):
            row = bucket(complaint.company_id.id, complaint.received_on)
            if row is not None:
                row["complaints"] += 1
        # Réclamations dont le délai de réponse est échu (au plus hier) et celles répondues à temps.
        for complaint in Complaint.search(base + [("response_due", ">=", start),
                                                  ("response_due", "<=", min(end, day - timedelta(days=1)))]
                                          + site_domain + kind_domain):
            row = bucket(complaint.company_id.id, complaint.response_due)
            if row is not None:
                row["complaints_due"] += 1
                row["complaints_on_time"] += complaint.on_time
        for contamination in env["eguitra.hsseq.contamination"].sudo().search(
                base + [("detected_on", ">=", start), ("detected_on", "<=", end)] + site_domain + kind_domain):
            row = bucket(contamination.company_id.id, contamination.detected_on)
            if row is not None:
                row["contaminations"] += 1
        Waste = env["eguitra.hsseq.waste"].sudo()
        for waste in Waste.search(base + [("produced_on", ">=", start), ("produced_on", "<=", end)] + site_domain):
            row = bucket(waste.company_id.id, waste.produced_on)
            if row is not None:
                row["wastes"] += 1
                row[f"waste_{waste.waste_kind}_{waste.unit}"] += waste.quantity
        for waste in Waste.search(base + [("pickup_date", ">=", start), ("pickup_date", "<=", end),
                                          ("status", "=", "collected")] + site_domain):
            row = bucket(waste.company_id.id, waste.pickup_date)
            if row is not None:
                row["wastes_collected"] += 1
        for violation in env["eguitra.hsseq.telematics.violation"].sudo().search(
                base + [("occurred_at", ">=", start_dt), ("occurred_at", "<=", end_dt)] + site_domain + kind_domain):
            row = bucket(violation.company_id.id, violation.occurred_at)
            if row is not None:
                row["violations"] += 1
                row[f"violations_{violation.violation_type}"] += 1
        for drill in env["eguitra.hsseq.drill"].sudo().search(
                base + [("status", "!=", "cancelled"), ("planned_date", ">=", start), ("planned_date", "<=", end)]
                + site_domain):
            row = bucket(drill.company_id.id, drill.planned_date)
            if row is not None:
                row["drills_planned"] += 1
                row["drills_done"] += drill.status == "done"
        return res

    @api.model
    def _iso_maturity(self, requirements):
        """Maturité par norme : exigences évaluées, conformes (1) ou partiellement conformes (0,5) ; None sans
        exigence rattachée à une norme."""
        maturity = []
        for code, label in STANDARDS:
            subset = requirements.filtered(lambda r, c=code: r.standard == c)
            if not subset:
                continue
            evaluated = subset.filtered(lambda r: r.status != "not_evaluated")
            score = sum(1 if r.status == "compliant" else 0.5 if r.status == "partial" else 0 for r in evaluated)
            maturity.append({"standard": code, "label": label, "requirements": len(subset), "evaluated": len(evaluated),
                             "score": round(score * 100 / len(evaluated), 1) if evaluated else None})
        return maturity or None

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
        obligations = self.env["eguitra.hsseq.qualification.rule"]._obligations()
        valid = [e for e in drivers if not e._hsseq_blocking(day, e._hsseq_vehicle_kind(), obligations)]
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
        factors = self.env["eguitra.hsseq.environment"]._factors(companies) if frozen else {}
        for key, snap in frozen.items():
            stored = snap.components or {}
            res[key] = dict(empty(), **stored)
            # Mois figé avant le lot 3 : émissions déduites du carburant, au facteur de la société.
            if "co2_kg" not in stored:
                res[key]["co2_kg"] = (stored.get("fuel_liters") or 0.0) * factors.get(key[0], CO2_PER_LITER)
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
            return r(t["co2_kg"], t["fuel_km"])
        if code == "tanker_shortage":
            return None if kind == "tipper" else r(t["tanker_shortage"], t["tanker_delivered"], 1000)
        if code == "tipper_variance":
            return None if kind == "tanker" else r(t["tipper_variance"], t["tipper_loaded"], 1000)
        if code == "audits_completion":
            return r(t["audits_done"], t["audits_planned"], 100, 1)
        if code in ("immobilizations", "spills", "dust_exceedances", "complaints"):
            return int(t[code])
        if code == "complaints_on_time":
            return r(t["complaints_on_time"], t["complaints_due"], 100, 1)
        if code == "telematics_violations":
            return r(t["violations"], t["departures"], 100)
        if code == "drills_completion":
            return r(t["drills_done"], t["drills_planned"], 100, 1)
        return None

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
            target = settings._target(code)
            for p in last12:
                window = months_back(p, 12) if rolling else [p]
                point = self._value(code, self._sum(comps, companies, window), kind)
                series.append({"month": p.strftime("%Y-%m"), "value": point, "target": target,
                               "status": indicator_status(point, target, direction, watch_ratio=WATCH_RATIO)})
            window = last12 if (rolling or period == "12m") else [month]
            if code == "qualifications_valid":
                window = [month]
            total = self._sum(comps, companies, window)
            value = self._value(code, total, kind)
            met = None if value is None or target is None else (value <= target if direction == "down" else value >= target)
            status = indicator_status(value, target, direction, watch_ratio=WATCH_RATIO)
            # Cible tenue sur la période mais manquée le dernier mois de la série : sous surveillance.
            if status == "met" and period == "12m" and series[-1]["status"] == "missed":
                status = "watch"
            breakdown = None
            if code == "waivers":
                breakdown = [{"site": key.split("|")[0], "reason_code": key.split("|")[1], "count": count}
                             for key, count in sorted(total["waiver_rows"].items())]
            indicators.append({
                "code": code, "label": label, "value": value, "target": target, "unit": unit, "direction": direction,
                "met": met, "status": status, "family": FAMILY.get(code, "reactive"), "source": source,
                "formula": formula, "series": series, "breakdown": breakdown, "site_scoped": site_scoped,
                "note": NOTES.get(code),
            })
        rh_total = self._sum(comps, companies, last12)
        month_frozen = bool(companies) and all((c.id, month) in frozen for c in companies)
        window = last12 if period == "12m" else [month]
        waiver_rows = self._sum(comps, companies, window)["waiver_rows"]
        by_reason = {code: 0 for code in ("V02", "V04", "V05", "V06", "V07", "V08", "V09")}
        for key, count in waiver_rows.items():
            code = key.split("|")[1]
            by_reason[code] = by_reason.get(code, 0) + count
        return {
            "indicators": indicators,
            "waivers_by_reason": by_reason,
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
