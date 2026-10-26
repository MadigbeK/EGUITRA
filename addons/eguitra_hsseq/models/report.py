"""Rapport mensuel HSSE au format d'un donneur d'ordre (spécification §11 exports, note de cadrage lot 2) :
un modèle paramétrable (nom, donneur d'ordre, indicateurs proactifs et réactifs, plan par mois), un mois
de rapport par société (valeurs calculées figées le 5 du mois suivant comme le cockpit, valeurs saisies,
commentaires, brouillon puis validé par hsseq), sorties Excel et PDF.

Aucun indicateur ni libellé d'un donneur d'ordre n'est chargé par le module : la configuration se saisit.
Seul le modèle « NIMOVA » (le rapport mensuel HSSEQ de la spécification) est créé par le module, à partir
des indicateurs du cockpit ; ses cibles par défaut sont celles des paramètres.

Un indicateur se calcule par une clé du catalogue (REPORT_KEYS : indicateurs du cockpit, nombres du mois,
situations de fin de mois) ou se saisit. Cumul de l'année (somme, moyenne ou dernier mois renseigné),
état au regard du plan cumulé : met (conforme), watch (sous surveillance), missed (non conforme), no_data.
"""

from datetime import date

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models

from .cockpit import FAMILY, FREEZE_DAY, INDICATORS, month_end, month_start, months_back, of_month
from .common import (
    AGGREGATIONS,
    EVENT_TYPES,
    REPORT_MODES,
    REPORT_NATURES,
    REPORT_STATES,
    VEHICLE_KINDS,
    HsseqError,
    indicator_status,
    today,
)

UNIT_LABELS = {"rate": "taux", "ratio": "ratio", "pct": "%", "count": "nbre", "per_mille": "‰", "l_100km": "L/100 km",
               "kg_co2_km": "kg CO₂/km", "per_100_trips": "pour 100 voyages"}
ROLLING = {code for code, *_rest, rolling, _scoped in INDICATORS if rolling} | {"qualifications_valid"}
COCKPIT_CODES = {row[0] for row in INDICATORS}


def _cockpit_keys():
    keys = {}
    for code, label, unit, direction, source, _formula, rolling, _scoped in INDICATORS:
        aggregation = "last" if code in ROLLING else "sum" if unit == "count" else "average"
        keys[code] = {"label": label + (" (12 mois glissants)" if rolling else ""), "unit": UNIT_LABELS[unit],
                      "aggregation": aggregation, "direction": direction, "source": source, "kind": "cockpit",
                      "family": FAMILY.get(code, "reactive")}
    return keys


# Catalogue des valeurs que NIMOVA calcule pour un mois : clé -> libellé, unité, cumul, sens, source.
REPORT_KEYS = _cockpit_keys()
REPORT_KEYS.update({
    "road_accidents": {"label": "Accidents de la route", "component": "road_accidents"},
    "work_accidents": {"label": "Accidents du travail avec arrêt", "component": "at_accidents", "source": "Événements, RH"},
    "lost_days": {"label": "Jours perdus (accidents du travail)", "component": "lost_days", "unit": "jours",
                  "source": "RH"},
    "weak_signals": {"label": "Presque-accidents et situations dangereuses déclarés", "component": "weak_signals",
                     "direction": "up", "family": "proactive"},
    "departures": {"label": "Départs", "component": "departures", "direction": "up", "source": "Transport",
                   "family": "proactive"},
    "checks": {"label": "Contrôles avant départ réalisés", "component": "checks", "direction": "up",
               "source": "NIMOVA Terrain", "family": "proactive"},
    "km": {"label": "Kilomètres parcourus", "component": "km", "unit": "km", "direction": "up", "source": "Transport"},
    "fuel_liters": {"label": "Carburant consommé", "component": "fuel_liters", "unit": "litres", "source": "Transport"},
    "audits_planned": {"label": "Audits planifiés", "component": "audits_planned", "direction": "up",
                       "source": "Audits", "family": "proactive"},
    "audits_done": {"label": "Audits réalisés", "component": "audits_done", "direction": "up", "source": "Audits",
                    "family": "proactive"},
    "risk_reviews_overdue": {"label": "Revues de risques échues (fin de mois)", "state": True,
                             "source": "Registre des risques", "aggregation": "last"},
    "risks_high_residual": {"label": "Risques de niveau résiduel élevé (fin de mois)", "state": True,
                            "source": "Registre des risques", "aggregation": "last"},
    "findings_open": {"label": "Constats d'audit ouverts (fin de mois)", "state": True, "source": "Audits",
                      "aggregation": "last"},
    "requirements_non_compliant": {"label": "Exigences non conformes (fin de mois)", "state": True,
                                   "source": "Registre des exigences", "aggregation": "last"},
    # Lot 3 : environnement et qualité, télématique, urgences.
    "co2_kg": {"label": "Émissions de CO₂ (kg)", "component": "co2_kg", "unit": "kg CO₂", "source": "Transport"},
    "tanker_shortage_m3": {"label": "Manquants des citernes (m³)", "component": "tanker_shortage", "unit": "m³",
                           "source": "Transport"},
    "tipper_variance_t": {"label": "Écarts de tonnage des bennes (t)", "component": "tipper_variance", "unit": "t",
                          "source": "Transport (pesées et livraisons)"},
    "spill_liters": {"label": "Volume déversé (litres)", "component": "spill_liters", "unit": "litres",
                     "source": "Environnement (déversements)"},
    "spill_recovered_liters": {"label": "Volume récupéré après déversement (litres)",
                               "component": "spill_recovered_liters", "unit": "litres", "direction": "up",
                               "source": "Environnement (déversements)"},
    "dust_measurements": {"label": "Mesures de poussières réalisées", "component": "dust_measurements",
                          "direction": "up", "source": "Environnement (poussières sur site)", "family": "proactive"},
    "contaminations": {"label": "Contaminations de produit", "component": "contaminations",
                       "source": "Qualité (contaminations)"},
    "wastes_collected": {"label": "Enlèvements de déchets avec bordereau", "component": "wastes_collected",
                         "direction": "up", "source": "Environnement (registre des déchets)", "family": "proactive"},
    "waste_used_oil_liters": {"label": "Huiles usagées entreposées (litres)", "component": "waste_used_oil_l",
                              "unit": "litres", "source": "Environnement (registre des déchets)"},
    "waste_tyres_units": {"label": "Pneus usagés entreposés (pièces)", "component": "waste_tyres_unit",
                          "source": "Environnement (registre des déchets)"},
    "waste_filters_units": {"label": "Filtres usagés entreposés (pièces)", "component": "waste_filters_unit",
                            "source": "Environnement (registre des déchets)"},
    "violations": {"label": "Violations de conduite (télématique)", "component": "violations",
                   "source": "Télématique (import des violations)"},
    "violations_speeding": {"label": "Violations : excès de vitesse", "component": "violations_speeding",
                            "source": "Télématique (import des violations)"},
    "violations_harsh_braking": {"label": "Violations : freinages brusques", "component": "violations_harsh_braking",
                                 "source": "Télématique (import des violations)"},
    "violations_night_driving": {"label": "Violations : conduite de nuit", "component": "violations_night_driving",
                                 "source": "Télématique (import des violations)"},
    "violations_driving_time": {"label": "Violations : temps de conduite dépassé",
                                "component": "violations_driving_time", "source": "Télématique (import des violations)"},
    "drills_done": {"label": "Exercices d'urgence réalisés", "component": "drills_done", "direction": "up",
                    "source": "Documents et urgences", "family": "proactive"},
    "procedures_read_rate": {"label": "Taux de lecture des procédures en vigueur (fin de mois)", "state": True,
                             "unit": "%", "direction": "up", "source": "Documents et urgences", "family": "proactive",
                             "aggregation": "last"},
    "complaints_open": {"label": "Réclamations clients ouvertes (fin de mois)", "state": True,
                        "source": "Qualité (réclamations clients)", "aggregation": "last"},
    "wastes_stored": {"label": "Déchets en attente d'enlèvement (fin de mois)", "state": True,
                      "source": "Environnement (registre des déchets)", "aggregation": "last"},
})
for _code, _label in EVENT_TYPES:
    REPORT_KEYS[f"events_{_code}"] = {"label": f"Événements déclarés : {_label.lower()}", "component": f"type_{_code}"}
for _key, _spec in REPORT_KEYS.items():
    _spec.setdefault("unit", "nbre")
    _spec.setdefault("aggregation", "sum")
    _spec.setdefault("direction", "down")
    _spec.setdefault("source", "Événements")
    _spec.setdefault("family", "reactive")
    _spec.setdefault("kind", "state" if _spec.get("state") else "component")


def month_key(month):
    return month.strftime("%Y-%m")


class EguitraHsseqReportTemplate(models.Model):
    _name = "eguitra.hsseq.report.template"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Modèle de rapport mensuel HSSE"
    _order = "name, id"
    _journal_key = "report_template"
    _journal_fields = ("name", "client_label", "partner_id", "company_id", "site_ids", "vehicle_kind", "start_month",
                       "compliant_ratio", "watch_ratio", "active")

    name = fields.Char("Modèle", required=True)
    code = fields.Char("Code", index=True, copy=False, help="NIMOVA : le rapport mensuel HSSEQ fourni par le module.")
    company_id = fields.Many2one("res.company", "Société", index=True, help="Vide : les deux sociétés.")
    partner_id = fields.Many2one("res.partner", "Donneur d'ordre")
    client_label = fields.Char("Donneur d'ordre (libellé du rapport)")
    # Périmètre des valeurs calculées : sites et profil de véhicule (vides : toute la société).
    site_ids = fields.Many2many("eguitra.hsseq.site", "eguitra_hsseq_report_template_site_rel", "template_id",
                                "site_id", "Sites du rapport", help="Vide : tous les sites de la société.")
    vehicle_kind = fields.Selection(VEHICLE_KINDS, "Profil de véhicule du rapport",
                                    help="Vide : citernes et bennes (le rapport d'un donneur d'ordre minier : bennes).")
    start_month = fields.Date("Premier mois du rapport", required=True,
                              default=lambda self: month_start(fields.Date.context_today(self)),
                              help="Les mois antérieurs ne sont pas listés.")
    compliant_ratio = fields.Float("Conforme à partir de (part de la cible)", default=0.95)
    watch_ratio = fields.Float("Sous surveillance à partir de (part de la cible)", default=0.85)
    indicator_ids = fields.One2many("eguitra.hsseq.report.indicator", "template_id", "Indicateurs",
                                    context={"active_test": False})
    active = fields.Boolean(default=True)

    _code_unique = models.Constraint("unique(code)", "Ce code de modèle existe déjà.")

    @api.constrains("compliant_ratio", "watch_ratio")
    def _check_ratios(self):
        for template in self:
            if not 0 < template.watch_ratio <= template.compliant_ratio <= 1.5:
                raise HsseqError("invalid_parameter", "Seuils du statut : 0 < sous surveillance ≤ conforme.",
                                 fields=["compliant_ratio", "watch_ratio"], status=400)

    def _indicators(self):
        self.ensure_one()
        return self.with_context(active_test=False).indicator_ids.filtered("active").sorted(
            lambda i: (i.nature != "proactive", i.sequence, i.id))

    @api.model
    def _ensure_nimova(self):
        """Modèle NIMOVA : un indicateur calculé par indicateur du cockpit, cibles des paramètres (créé une
        fois ; ses réglages sont ensuite ceux de hsseq)."""
        template = self.sudo().with_context(active_test=False).search([("code", "=", "NIMOVA")], limit=1)
        if template:
            return template
        template = self.sudo().create({"name": "Rapport mensuel HSSEQ NIMOVA", "code": "NIMOVA",
                                       "client_label": "Direction générale"})
        template._add_cockpit_indicators([code for code, *_rest in INDICATORS])
        return template

    def _add_cockpit_indicators(self, codes):
        """Ajoute au modèle les indicateurs du cockpit qu'il n'a pas encore (même retirés) : numéro P- ou R-
        suivi du rang de l'indicateur au cockpit."""
        self.ensure_one()
        known = set(self.with_context(active_test=False).indicator_ids.mapped("key"))
        ranks = {code: rank for rank, (code, *_rest) in enumerate(INDICATORS, 1)}
        rows = []
        for code in codes:
            if code in known or code not in ranks:
                continue
            spec, rank = REPORT_KEYS[code], ranks[code]
            rows.append({"template_id": self.id, "code": f"{'P' if spec['family'] == 'proactive' else 'R'}-{rank:02d}",
                         "label": spec["label"], "nature": spec["family"], "mode": "computed", "key": code,
                         "unit": spec["unit"], "direction": spec["direction"], "aggregation": spec["aggregation"],
                         "sequence": rank * 10})
        return self.env["eguitra.hsseq.report.indicator"].sudo().create(rows)


class EguitraHsseqReportIndicator(models.Model):
    _name = "eguitra.hsseq.report.indicator"
    _description = "Indicateur d'un modèle de rapport mensuel HSSE"
    _order = "template_id, sequence, id"

    template_id = fields.Many2one("eguitra.hsseq.report.template", "Modèle", required=True, ondelete="cascade",
                                  index=True)
    code = fields.Char("N°", required=True, help="Par exemple A1-12 ou B1-8.")
    label = fields.Char("Indicateur", required=True)
    nature = fields.Selection(REPORT_NATURES, "Nature", required=True, default="proactive")
    mode = fields.Selection(REPORT_MODES, "Mode de calcul", required=True, default="manual")
    key = fields.Selection([(k, v["label"]) for k, v in REPORT_KEYS.items()], "Valeur calculée")
    unit = fields.Char("Unité", default="nbre")
    direction = fields.Selection([("up", "Plus haut est mieux"), ("down", "Plus bas est mieux")], "Sens favorable",
                                 required=True, default="up")
    aggregation = fields.Selection(AGGREGATIONS, "Cumul de l'année", required=True, default="sum")
    targets = fields.Json("Cible par mois", help="Douze valeurs, de janvier à décembre (null : pas de cible).")
    alert_threshold = fields.Float("Seuil d'alerte", help="Facultatif : entre la cible et ce seuil, sous surveillance.")
    has_threshold = fields.Boolean("Seuil d'alerte défini")
    sequence = fields.Integer("Ordre", default=10)
    active = fields.Boolean(default=True)

    _code_unique = models.Constraint("unique(template_id, code)", "Ce numéro d'indicateur existe déjà dans le modèle.")

    @api.constrains("mode", "key")
    def _check_key(self):
        for indicator in self:
            if indicator.mode == "computed" and not indicator.key:
                raise HsseqError("invalid_parameter", f"{indicator.code} : un indicateur calculé désigne sa valeur.",
                                 fields=["key"], status=400)

    def _target(self, month, settings):
        """Cible du mois : celle du modèle, sinon, pour un indicateur du cockpit, la cible des paramètres."""
        self.ensure_one()
        targets = self.targets or []
        value = targets[month.month - 1] if len(targets) >= month.month else None
        if value is None and self.mode == "computed" and self.key in COCKPIT_CODES:
            value = settings._target(self.key)
        return value


class EguitraHsseqReportMonth(models.Model):
    _name = "eguitra.hsseq.report.month"
    _inherit = ["eguitra.hsseq.journaled"]
    _description = "Mois d'un rapport mensuel HSSE"
    _order = "month desc, id desc"
    _journal_key = "report"
    _journal_fields = ("state", "comment")

    template_id = fields.Many2one("eguitra.hsseq.report.template", "Modèle", required=True, ondelete="cascade",
                                  index=True)
    company_id = fields.Many2one("res.company", "Société", required=True, index=True)
    month = fields.Date("Mois", required=True, index=True)
    state = fields.Selection(REPORT_STATES, "État", required=True, default="draft", index=True)
    frozen_on = fields.Date("Valeurs calculées figées le", readonly=True)
    validated_at = fields.Datetime("Validé le", readonly=True)
    validated_by = fields.Many2one("res.users", "Validé par", readonly=True)
    reopen_reason = fields.Text("Motif de la dernière réouverture", readonly=True)
    comment = fields.Text("Commentaire du mois")
    value_ids = fields.One2many("eguitra.hsseq.report.value", "report_id", "Valeurs")

    _month_unique = models.Constraint("unique(template_id, company_id, month)", "Ce mois du rapport existe déjà.")

    @api.model
    def _get(self, template, company, month, create=True):
        record = self.sudo().search([("template_id", "=", template.id), ("company_id", "=", company.id),
                                     ("month", "=", month)], limit=1)
        if not record and create:
            record = self.sudo().create({"template_id": template.id, "company_id": company.id, "month": month})
        return record

    @staticmethod
    def _freeze_date(month):
        return month_start(month) + relativedelta(months=1, day=FREEZE_DAY)

    def _value(self, indicator):
        self.ensure_one()
        return self.value_ids.filtered(lambda v: v.indicator_id == indicator)[:1]

    def _freeze(self):
        """Valeurs calculées du mois enregistrées (le 5 du mois suivant, ou à la validation si plus tard)."""
        for report in self.filtered(lambda r: not r.frozen_on):
            template = report.template_id
            computed = template._computed_values(report.company_id, report.month, sites=template._scope_sites(),
                                                 kind=template.vehicle_kind or None)
            for indicator in report.template_id._indicators().filtered(lambda i: i.mode == "computed"):
                value = computed.get(indicator.key)
                row = report._value(indicator) or self.env["eguitra.hsseq.report.value"].sudo().create(
                    {"report_id": report.id, "indicator_id": indicator.id})
                row.write({"computed_value": value or 0.0, "computed_known": value is not None})
            report.write({"frozen_on": today(self.env)})
            report._journal("freeze")
        return True

    def action_validate(self):
        """Validation par hsseq : le mois est figé (à partir du 5 du mois suivant)."""
        self.ensure_one()
        if self.state == "validated":
            raise HsseqError("invalid_transition", "Ce mois du rapport est déjà validé.")
        if not self.frozen_on:
            if today(self.env) < self._freeze_date(self.month):
                raise HsseqError("month_not_frozen", f"Les valeurs {of_month(self.month)} se figent le "
                                                     f"{self._freeze_date(self.month):%d/%m/%Y} : validation à partir "
                                                     f"de cette date.")
            self._freeze()
        self.write({"state": "validated", "validated_at": fields.Datetime.now(), "validated_by": self.env.uid})
        self._journal("validate")
        return True

    def action_reopen(self, reason):
        self.ensure_one()
        if self.state != "validated":
            raise HsseqError("invalid_transition", "Seul un mois validé se rouvre.")
        if not (reason or "").strip():
            raise HsseqError("reason_required", "Le motif de la réouverture est obligatoire.", fields=["reason"])
        self.write({"state": "draft", "validated_at": False, "validated_by": False, "reopen_reason": reason.strip()})
        self._journal("reopen", note=reason.strip())
        return True

    @api.model
    def _cron_freeze(self):
        """Le 5 du mois (et après, si la tâche n'a pas tourné) : valeurs calculées du mois précédent figées
        pour chaque modèle actif et chaque société qu'il sert."""
        day = today(self.env)
        if day.day < FREEZE_DAY:
            return True
        previous = month_start(day) - relativedelta(months=1)
        companies = self.env["res.company"].sudo().search([])
        for template in self.env["eguitra.hsseq.report.template"].sudo().search([]):
            for company in template.company_id or companies:
                self._get(template, company, previous)._freeze()
        return True


class EguitraHsseqReportValue(models.Model):
    _name = "eguitra.hsseq.report.value"
    _description = "Valeur d'un indicateur pour un mois de rapport"
    _order = "report_id, indicator_id"

    report_id = fields.Many2one("eguitra.hsseq.report.month", "Mois", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="report_id.company_id", store=True, index=True)
    indicator_id = fields.Many2one("eguitra.hsseq.report.indicator", "Indicateur", required=True, ondelete="cascade",
                                   index=True)
    computed_value = fields.Float("Valeur calculée (figée)", digits=(16, 4))
    computed_known = fields.Boolean("Valeur calculée connue")
    manual_value = fields.Float("Valeur saisie", digits=(16, 4))
    manual_known = fields.Boolean("Valeur saisie")
    comment = fields.Text("Commentaire")

    _indicator_unique = models.Constraint("unique(report_id, indicator_id)", "Une valeur par indicateur et par mois.")


class EguitraHsseqReportTemplateCompute(models.Model):
    _inherit = "eguitra.hsseq.report.template"

    # ─── Valeurs calculées ────────────────────────────────────────────────

    def _scope_sites(self):
        """Sites du périmètre du modèle (None : toute la société)."""
        self.ensure_one()
        return self.site_ids or None

    @api.model
    def _computed_values(self, company, month, comps=None, sites=None, kind=None):
        """Valeurs du catalogue pour un mois et une société, bornées si besoin à des sites et à un profil de
        véhicule : indicateurs du cockpit (fenêtre de douze mois pour les taux glissants), nombres du mois,
        situations de fin de mois (état du jour pour le mois en cours ou tout juste clos). comps : composantes
        du cockpit déjà lues (figées ou recalculées) pour le même périmètre."""
        Cockpit = self.env["eguitra.hsseq.cockpit"]
        window = months_back(month, 12)
        if comps is None:
            comps, _frozen = Cockpit._components(company, window, sites, kind)
        month_total = Cockpit._sum(comps, company, [month])
        rolling_total = Cockpit._sum(comps, company, window)
        if month == month_start(today(self.env)):
            drivers, valid = Cockpit._qualifications(company, sites)
            month_total["drivers"], month_total["drivers_valid"] = drivers, valid
            rolling_total["drivers"], rolling_total["drivers_valid"] = drivers, valid
        values = {}
        for key, spec in REPORT_KEYS.items():
            if spec["kind"] == "cockpit":
                rolling = next(row[6] for row in INDICATORS if row[0] == key)
                values[key] = Cockpit._value(key, rolling_total if rolling else month_total, kind)
            elif spec["kind"] == "component":
                values[key] = month_total.get(spec["component"]) or 0.0
        values.update(self._state_values(company, month, sites))
        return values

    @api.model
    def _state_values(self, company, month, sites=None):
        """Situations de fin de mois, connues pour le mois en cours ou le mois tout juste clos (pas encore
        figé) ; pour un mois plus ancien non figé, pas de donnée. Bornées aux sites donnés (les exigences,
        sans site, restent celles de la société)."""
        day = today(self.env)
        current = month_start(day)
        if month not in (current, current - relativedelta(months=1)):
            return dict.fromkeys((k for k, s in REPORT_KEYS.items() if s["kind"] == "state"), None)
        env = self.env
        end = min(month_end(month), day)
        company_base = [("company_id", "=", company.id)]
        base = company_base + ([("site_id", "in", sites.ids)] if sites else [])
        return {
            "risk_reviews_overdue": env["eguitra.hsseq.risk"].sudo().search_count(
                base + [("status", "=", "active"), ("review_date", "<", end)]),
            "risks_high_residual": env["eguitra.hsseq.risk"].sudo().search_count(
                base + [("status", "=", "active"), ("residual_level", "=", "high")]),
            "findings_open": env["eguitra.hsseq.finding"].sudo().search_count(base + [("status", "=", "open")]),
            "requirements_non_compliant": env["eguitra.hsseq.requirement"].sudo().search_count(
                company_base + [("status", "=", "non_compliant")]),
            "procedures_read_rate": self._procedures_read_rate(company, sites),
            "complaints_open": env["eguitra.hsseq.complaint"].sudo().search_count(base + [("status", "!=", "closed")]),
            "wastes_stored": env["eguitra.hsseq.waste"].sudo().search_count(base + [("status", "=", "stored")]),
        }

    @api.model
    def _procedures_read_counts(self, companies, sites=None):
        """Procédures en vigueur des sociétés (celles qui se rapportent à ces sites, None : toutes), comptes
        visés et lectures de leur version en vigueur : (procédures, comptes visés, lectures)."""
        Procedure = self.env["eguitra.hsseq.procedure"].sudo()
        procedures = Procedure.search([("company_id", "in", companies.ids), ("status", "=", "published")])
        procedures = procedures.filtered(lambda p: p.current_version_id and p._applies_to_sites(sites))
        index = Procedure._audience_index(companies) if procedures else []
        targets = read = 0
        for procedure in procedures:
            stats = procedure.current_version_id._read_stats(procedure._audience_users(index))
            targets += stats["targets"]
            read += stats["read"]
        return len(procedures), targets, read

    @api.model
    def _procedures_read_rate(self, company, sites=None):
        """Taux de lecture des versions en vigueur : lectures des comptes visés ÷ comptes visés."""
        _count, targets, read = self._procedures_read_counts(company, sites)
        return round(read * 100 / targets, 1) if targets else None

    # ─── Rapport d'un mois ────────────────────────────────────────────────

    def _report(self, company, month):
        """Rapport du mois : pour chaque indicateur, plan contre réalisé par mois depuis janvier, cumul de
        l'année et son état ; synthèse pour le comité (santé globale, points d'attention, tendance)."""
        self.ensure_one()
        settings = self.env["eguitra.hsseq.settings"]._get(company)
        months = [date(month.year, m, 1) for m in range(1, month.month + 1)]
        Month = self.env["eguitra.hsseq.report.month"]
        records = {m: Month._get(self, company, m, create=False) for m in months}
        live, comps = {}, None
        indicators = self._indicators()
        rows = []
        for indicator in indicators:
            series = []
            for m in months:
                record = records[m]
                stored = record._value(indicator) if record else None
                value, source = None, "none"
                if indicator.mode == "manual":
                    if stored and stored.manual_known:
                        value, source = stored.manual_value, "manual"
                elif record and record.frozen_on:
                    if stored and stored.computed_known:
                        value, source = stored.computed_value, "computed"
                else:
                    if m not in live:
                        if comps is None:
                            # Une lecture des composantes pour tous les mois de l'année et leurs fenêtres.
                            comps, _frozen = self.env["eguitra.hsseq.cockpit"]._components(
                                company, months_back(month, 11 + month.month), self._scope_sites(),
                                self.vehicle_kind or None)
                        live[m] = self._computed_values(company, m, comps, self._scope_sites(),
                                                        self.vehicle_kind or None)
                    value = live[m].get(indicator.key)
                    source = "computed" if value is not None else "none"
                target = indicator._target(m, settings)
                series.append({"month": month_key(m), "target": target, "value": value, "source": source,
                               "comment": (stored.comment or None) if stored else None,
                               "status": indicator_status(value, target, indicator.direction,
                                                          self.compliant_ratio, self.watch_ratio,
                                                          indicator.alert_threshold if indicator.has_threshold else None)})
            ytd, ytd_target = self._cumulate(indicator, series)
            status = indicator_status(ytd, ytd_target, indicator.direction, self.compliant_ratio, self.watch_ratio,
                                      indicator.alert_threshold if indicator.has_threshold else None)
            annual = [t for t in (indicator._target(date(month.year, m, 1), settings) for m in range(1, 13))
                      if t is not None]
            if not annual:
                annual_target = None
            elif indicator.aggregation == "sum":
                annual_target = round(sum(annual), 4)
            else:
                annual_target = round(sum(annual) / len(annual), 4)
            rows.append({
                "id": indicator.id, "code": indicator.code, "label": indicator.label, "nature": indicator.nature,
                "family": indicator.nature, "mode": indicator.mode, "key": indicator.key or None, "unit": indicator.unit,
                "direction": indicator.direction, "aggregation": indicator.aggregation,
                "annual_target": annual_target, "value": series[-1]["value"], "target": series[-1]["target"],
                "ytd": ytd, "ytd_target": ytd_target, "status": status, "comment": series[-1]["comment"],
                "series": series,
            })
        return {"months": [month_key(m) for m in months], "indicators": rows, "summary": self._summary(rows)}

    @staticmethod
    def _cumulate(indicator, series):
        values = [p["value"] for p in series if p["value"] is not None]
        targets = [p["target"] for p in series if p["target"] is not None]
        if indicator.aggregation == "sum":
            return (round(sum(values), 4) if values else None), (round(sum(targets), 4) if targets else None)
        if indicator.aggregation == "average":
            return (round(sum(values) / len(values), 4) if values else None), \
                (round(sum(targets) / len(targets), 4) if targets else None)
        last = next((p for p in reversed(series) if p["value"] is not None), None)
        return (last["value"], last["target"]) if last else (None, series[-1]["target"] if series else None)

    @staticmethod
    def _summary(rows):
        """Synthèse du comité : santé globale (états du cumul), points d'attention (non conformes puis sous
        surveillance), tendance mensuelle des indicateurs réactifs et des points d'attention."""
        by_status = {code: 0 for code in ("met", "watch", "missed", "no_data")}
        for row in rows:
            by_status[row["status"]] += 1
        measured = len(rows) - by_status["no_data"]
        attention = sorted((r for r in rows if r["status"] in ("missed", "watch")),
                           key=lambda r: (r["status"] != "missed", r["code"]))
        trend_rows = [r for r in rows if r["nature"] == "reactive" or r in attention]
        return {
            "by_status": by_status,
            "health": round(by_status["met"] * 100 / measured, 1) if measured else None,
            "attention_points": [{"id": r["id"], "code": r["code"], "label": r["label"], "nature": r["nature"],
                                  "ytd": r["ytd"], "ytd_target": r["ytd_target"], "unit": r["unit"],
                                  "status": r["status"], "comment": r["comment"]} for r in attention],
            "trend": [{"id": r["id"], "code": r["code"], "label": r["label"],
                       "series": [{"month": p["month"], "value": p["value"], "target": p["target"]} for p in r["series"]]}
                      for r in trend_rows],
        }
