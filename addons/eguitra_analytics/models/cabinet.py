"""Analyses de MB AxisPro Consulting (spécification, chapitre 6).

Une méthode publique par section (synthese, portefeuille, diagnostic, comites, financements,
activite, risques), de signature (company, period, ctx=None) -> dict : blocs de la section, constats
(insight puis rank) et fiabilité. `ctx` partage entre sections les données d'une requête (le cockpit
réunit toutes les sections) : chaque dossier n'est évalué qu'une fois par requête (dossier.evaluate()
puis dossier.scoring(résultat), méthode MB AxisPro Consulting de scoring.py).

Conventions :
- Les états (gate courant, scores, risques et actions ouverts) sont ceux de la date d'arrêté pour le
  gate (reconstitué depuis le journal des passages) et du jour du calcul pour les scores ; les flux
  (passages de gate, décisions, temps, honoraires, actions créées et terminées, pièces déposées) sont
  comptés sur la période demandée, comparée à la même période un an plus tôt.
- Montants en GNF hors taxes ; un besoin de financement en devise est converti au cours de la date
  d'arrêté.
- Les bornes et seuils d'alerte sont les constantes ci-dessous ; deux paramètres système :
  eguitra_analytics.cabinet_hourly_rate (taux horaire standard de vente, GNF/h ; à défaut, taux moyen
  des factures d'honoraires validées des 12 derniers mois) et eguitra_analytics.cabinet_cost_ratio
  (taux de revient du temps, en part du taux de vente ; 0,40 par défaut).
"""

from collections import defaultdict
from datetime import timedelta
from functools import cached_property
from urllib.parse import quote

from dateutil.relativedelta import relativedelta

from odoo import models

from odoo.addons.eguitra_axispro.models.dossier import COMMITTEE_DECISIONS, RECOMMENDATIONS
from odoo.addons.eguitra_axispro.models.pilotage import (
    ACTION_OPEN,
    FUNDING_OPEN,
    FUNDING_STATES,
    FUNDING_WON,
    RISK_CATEGORIES,
    risk_level,
)
from odoo.addons.eguitra_axispro.models.timesheet import CABINET_ACTIVITIES, PROJECT_ACTIVITY
from odoo.addons.eguitra_finance.models.finance_metrics import ACC_CODE

from ..engine import portfolio as pf
from ..engine.forecast import forecast_series
from ..engine.insights import gnf, insight, pct, rank

OPEN_STATES = ("open", "on_hold")
SECTIONS = ("portefeuille", "diagnostic", "comites", "financements", "activite", "risques")
RECOMMENDATION_LABELS = dict(RECOMMENDATIONS)
DECISION_LABELS = dict(COMMITTEE_DECISIONS)
DECISION_KEYS = [key for key, _label in COMMITTEE_DECISIONS]
RECOMMENDATION_KEYS = [key for key, _label in RECOMMENDATIONS]
PASSING_DECISIONS = ("go", "conditional")
FAVORABLE_RECOMMENDATIONS = ("bankable", "apd_ready", "go")

PARAM_HOURLY_RATE = "eguitra_analytics.cabinet_hourly_rate"
PARAM_COST_RATIO = "eguitra_analytics.cabinet_cost_ratio"
COST_RATIO_DEFAULT = 0.40
GATE_TARGET_DAYS = 60          # durée cible d'un gate (hors recevabilité)
STUCK_DAYS = 90                # âge au-delà duquel un dossier est bloqué, faute de trois passages observés
MISSING_OLD_DAYS = 60          # pièce attendue manquante depuis plus de 60 jours
UNBILLED_OLD_DAYS = 60         # temps facturable non facturé depuis plus de 60 jours
STALE_FUNDING_DAYS = 90        # dossier en instruction chez un financeur depuis plus de 90 jours
STAGNATION_DAYS = 90           # aucun progrès de score sur 90 jours au moins
DECISION_TARGET_DAYS = 120     # délai de l'ouverture à la première décision du comité
REALIZATION_TARGET = 85.0
RESPONSE_TARGET_DAYS = 15
CANDIDATE_HORIZON_DAYS = 183

FUNDER_TYPES = {
    "bank_loan": ("bank", "Banques et crédit-bail"), "leasing": ("bank", "Banques et crédit-bail"),
    "equity": ("investor", "Investisseurs"), "quasi_equity": ("investor", "Investisseurs"),
    "grant": ("donor", "Bailleurs de fonds et subventions"), "guarantee": ("guarantor", "Garants"),
    "microfinance": ("mfi", "Microfinance"), "other": ("other", "Autres financeurs"),
}
FUNDING_STAGES = {
    "identified": ("prospect", "Identifié"), "submitted": ("review", "En instruction"),
    "review": ("review", "En instruction"), "agreed": ("agreed", "Accord de principe"),
    "signed": ("won", "Obtenu"), "disbursed": ("won", "Obtenu"),
    "rejected": ("lost", "Refusé ou abandonné"), "withdrawn": ("lost", "Refusé ou abandonné"),
}
RISK_CRITICALITY = {"critical": "critical", "high": "high", "moderate": "medium", "low": "low"}
PRIORITY_LEVEL = {"URGENTE": "high", "ÉLEVÉE": "high", "MOYENNE": "medium", "FAIBLE": "low"}
SERVICE_KEYS = {
    PROJECT_ACTIVITY: "projets", "Formation et coaching": "formation", "Conseil": "conseil",
    "Audit d'évaluation des transporteurs": "audit_transporteurs", "Certification": "certification",
}
AGE_BUCKETS = (("0_30", "0 à 30 jours", 0, 30), ("31_60", "31 à 60 jours", 31, 60),
               ("61_90", "61 à 90 jours", 61, 90), ("plus_90", "Plus de 90 jours", 91, None))


# ─── Mise en forme ─────────────────────────────────────────────────────────


def _r(value, digits=1):
    return None if value is None else round(value, digits)


def _fr(value, digits=0):
    """Nombre à la française : 1234,5 -> « 1 234,5 »."""
    if value is None:
        return "–"
    return f"{value:,.{digits}f}".replace(",", " ").replace(".", ",")


def _days(value):
    if value is None:
        return "–"
    n = round(value)
    return f"{_fr(n)} jour{'s' if n >= 2 else ''}"


def _n(count, one, many=None):
    """« 1 dossier », « 3 dossiers »."""
    return f"{count} {one if count < 2 else (many or one + 's')}"


def _refs(dossiers, limit=3):
    names = [d.reference or d.name for d in dossiers[:limit]]
    more = len(dossiers) - limit
    return ", ".join(names) + (f" et {more} autre{'s' if more > 1 else ''}" if more > 0 else "")


def _share(part, total):
    return part / total * 100 if total else None


def _confidence(n, full=8, floor=0.45):
    """Confiance d'un constat selon le nombre d'observations : de 0,45 à 0,95."""
    return min(0.95, floor + (0.95 - floor) * min(n, full) / full)


def _status(value, good, warn, inverse=False):
    if value is None:
        return "neutral"
    if inverse:
        return "good" if value <= good else "warn" if value <= warn else "bad"
    return "good" if value >= good else "warn" if value >= warn else "bad"


def _kpi(key, label, value, unit, definition, previous=None, target=None, trend=None, status="neutral",
         inverse=False):
    digits = 0 if unit in ("gnf", "count") else 1
    delta = None
    if value is not None and previous not in (None, 0):
        delta = round((value - previous) / abs(previous) * 100, 1)
    return {
        "key": key, "label": label, "value": _r(value, digits), "unit": unit, "previous": _r(previous, digits),
        "target": _r(target, digits), "delta_pct": delta, "trend": [_r(v, digits) for v in trend or []],
        "status": status, "definition": definition, "inverse": inverse,
    }


def _quality(notes):
    """notes : [(texte, pénalité sur 100)]. Score : 100 moins les pénalités, borné à 0."""
    return {"score": max(0, round(100 - sum(p for _t, p in notes))), "notes": [t for t, _p in notes]}


def _dossier_link(dossier):
    return f"/axispro/dossiers/{dossier.id}"


def _section_link(section, anchor=None, **params):
    """Lien vers une section de l'Analyse : la cible en paramètres (?gate=G2), mise en évidence par l'écran,
    et le bloc qui explique le constat en ancre (#temps), jusqu'où l'écran fait défiler."""
    query = "&".join(f"{key}={quote(str(value), safe='')}" for key, value in params.items() if value not in (None, ""))
    return f"/analyse/{section}" + (f"?{query}" if query else "") + (f"#{anchor}" if anchor else "")


def _historique_clos(months, values, day):
    """Série mensuelle sans le mois de la date d'arrêté quand il est entamé : ses chiffres partiels (le 3 du
    mois, trois jours d'honoraires) tireraient la prévision vers le bas. Renvoie (mois, valeurs, entamé)."""
    entame = (day + timedelta(days=1)).month == day.month
    if entame and months and months[-1] == pf.month_key(day):
        return months[:-1], values[:-1], True
    return months, values, False


def _knockouts_confirmes(snapshot):
    """Knock-outs constatés à la décision : ceux de l'instantané scellé, moins ceux dont le critère n'était
    pas encore évalué (la méthode compte un critère non évalué comme non disponible)."""
    snap = snapshot or {}
    return max(0, len(snap.get("knockouts") or []) - int(snap.get("knockouts_pending") or 0))


def _recommandation_scellee(recommendation, snapshot):
    """Recommandation de la méthode à la décision, pour l'accord avec le comité : un NO-GO qui ne tient qu'à
    des knock-outs non encore évalués (gate non atteint) n'est pas un verdict de la méthode, il reste hors
    du calcul comme une recommandation à compléter."""
    snap = snapshot or {}
    if recommendation == "no_go" and snap.get("knockouts") and not _knockouts_confirmes(snap):
        return "pending"
    return recommendation or "pending"


def _brief(dossier):
    return {"id": dossier.id, "reference": dossier.reference, "name": dossier.name}


def _bucket(days):
    return next(key for key, _label, low, high in AGE_BUCKETS if days >= low and (high is None or days <= high))


def _forecast(values, horizon):
    """Prévision par forecast_series (engine/forecast.py), bornée à zéro (des dossiers ou des honoraires ne
    sont jamais négatifs). Série dégénérée refusée par le moteur : prévision indisponible (listes vides)."""
    try:
        fc = forecast_series(values, horizon)
    except (ValueError, ZeroDivisionError, OverflowError):
        return {"forecast": [], "low": [], "high": [], "method": None, "mape": None}

    def clean(seq):
        return [max(0.0, float(v)) for v in (seq or fc["forecast"])]

    return {"forecast": clean(fc["forecast"]), "low": clean(fc.get("low")), "high": clean(fc.get("high")),
            "method": fc.get("method"), "mape": fc.get("mape")}


# ─── Données d'une requête ─────────────────────────────────────────────────


class Bundle:
    """Données d'une requête, lues une fois et partagées entre les sections : dossiers, évaluations
    (une par dossier), gates, passages du journal, revues de comité."""

    def __init__(self, env, company, period):
        self.env = env
        self.company = company
        self.period = period
        self.date_from = period["date_from"]
        self.date_to = period["date_to"]
        self.prev_from = period["previous"]["date_from"]
        self.prev_to = period["previous"]["date_to"]
        self._results = {}
        self._timelines = {}
        self.sections = {}

    def in_period(self, day):
        return bool(day) and self.date_from <= day <= self.date_to

    def in_previous(self, day):
        return bool(day) and self.prev_from <= day <= self.prev_to

    @cached_property
    def policy(self):
        return self.env["axispro.policy"].active_policy(self.company)

    @cached_property
    def thresholds(self):
        p = self.policy
        if not p:
            return {"bankable": 80.0, "apd": 65.0, "conditional": 50.0, "hold": 30.0}
        return {"bankable": p.threshold_bankable, "apd": p.go_threshold, "conditional": p.conditional_threshold,
                "hold": p.threshold_hold}

    @cached_property
    def dossiers(self):
        """Dossiers de la société ouverts au plus tard à la date d'arrêté (tous états)."""
        records = self.env["axispro.dossier"].search([("company_id", "=", self.company.id)], order="id")
        return records.filtered(lambda d: d.create_date.date() <= self.date_to)

    @cached_property
    def live(self):
        """Dossiers du portefeuille : en cours ou suspendus."""
        return self.dossiers.filtered(lambda d: d.state in OPEN_STATES)

    def result(self, dossier):
        """(évaluation complète, synthèse) du dossier, calculées une seule fois."""
        if dossier.id not in self._results:
            r = dossier.evaluate()
            self._results[dossier.id] = (r, dossier.scoring(r))
        return self._results[dossier.id]

    @cached_property
    def gates(self):
        """Gates du portefeuille : ceux de la politique en vigueur dans leur ordre, puis ceux des
        versions antérieures encore appliquées à des dossiers (rapprochés par leur code)."""
        rows, seen = [], set()
        for policy in self.policy | self.dossiers.policy_id:
            for g in policy.gate_ids.sorted("sequence"):
                if g.code not in seen:
                    seen.add(g.code)
                    rows.append({"code": g.code, "name": g.name, "rule": g.rule_code, "sequence": g.sequence,
                                 "index": len(rows)})
        return rows

    @cached_property
    def gate_index(self):
        return {g["code"]: g["index"] for g in self.gates}

    @cached_property
    def gate_names(self):
        return {g["code"]: g["name"] for g in self.gates}

    @cached_property
    def gate_by_rule(self):
        result = {}
        for g in self.gates:
            result.setdefault(g["rule"], g["code"])
        return result

    @cached_property
    def intake_gates(self):
        return {g["code"] for g in self.gates if g["rule"] == "intake"}

    @cached_property
    def passages(self):
        """Passages de gate du journal par dossier : [{date, src, dst, forced, reason}], dans l'ordre."""
        entries = self.env["axispro.journal"].search(
            [("dossier_id", "in", self.dossiers.ids), ("kind", "=", "gate")], order="date asc, id asc")
        result = defaultdict(list)
        for entry in entries:
            parsed = pf.parse_gate_note(entry.note)
            if not parsed:
                continue
            src, dst, forced = parsed
            reason = entry.note.split(" : ", 1)[1].strip() if forced and " : " in entry.note else None
            result[entry.dossier_id.id].append({"date": entry.date.date(), "src": src, "dst": dst, "forced": forced,
                                                "reason": reason})
        return result

    def timeline(self, dossier):
        """Séjours du dossier dans ses gates jusqu'à la date d'arrêté (journal des passages).

        Le gate à la date d'arrêté est l'arrivée du dernier passage antérieur ; si le journal ne
        rejoint pas le gate courant du dossier (historique repris ou incomplet), le gate courant est
        retenu et le dossier est écarté des calculs de durée (incomplete)."""
        if dossier.id in self._timelines:
            return self._timelines[dossier.id]
        gates = dossier.policy_id.gate_ids.sorted("sequence")
        first = gates[:1].code or dossier.current_gate_id.code or ""
        passages = self.passages.get(dossier.id, [])
        rows = pf.sojourns(dossier.create_date.date(), [(p["date"], p["src"], p["dst"], p["forced"]) for p in passages],
                           first, self.date_to)
        gate = rows[-1]["gate"]
        incomplete = False
        later = any(p["date"] > self.date_to for p in passages)
        current = dossier.current_gate_id.code
        if not later and current and gate != current:
            gate, incomplete = current, True
        entered = {}
        for s in rows:
            entered.setdefault(s["gate"], s["start"])
        local = {g.code: i for i, g in enumerate(gates)}
        data = {
            "sojourns": rows, "gate": gate, "index": self.gate_index.get(gate, 0), "local_index": local.get(gate, 0),
            "incomplete": incomplete, "entered": entered, "age": None if incomplete else rows[-1]["days"],
            "sequence": next((g.sequence for g in gates if g.code == gate), 0),
        }
        self._timelines[dossier.id] = data
        return data

    def amount(self, dossier, value):
        """Montant du dossier en devise de la société (cours de la date d'arrêté)."""
        if not value:
            return 0.0
        currency = dossier.currency_id
        if currency and currency != self.company.currency_id:
            return currency._convert(value, self.company.currency_id, self.company, self.date_to)
        return value

    def need(self, dossier):
        return self.amount(dossier, dossier.financing_need)

    def investment(self, dossier):
        return self.amount(dossier, dossier.investment)

    def confirmed_knockouts(self, dossier):
        """Knock-outs actifs sur des critères effectivement évalués (un critère non encore évalué compte
        comme non disponible dans la méthode, mais n'est pas un knock-out constaté)."""
        r, _s = self.result(dossier)
        return [x for x in r["knockouts"] if x["entered"] != "not_assessed"]

    def probability(self, dossier):
        _r_, s = self.result(dossier)
        return pf.bankability_probability(s["bankability"], bool(self.confirmed_knockouts(dossier)))

    @cached_property
    def reviews(self):
        return self.env["axispro.review"].search(
            [("company_id", "=", self.company.id), ("date", "<=", self.date_to)], order="date asc, id asc")

    @cached_property
    def locked_reviews(self):
        return self.reviews.filtered(lambda r: r.state == "locked")

    @cached_property
    def completed_sojourns(self):
        """Séjours achevés (passage enregistré) de tous les dossiers à l'historique complet."""
        rows = []
        for d in self.dossiers:
            t = self.timeline(d)
            if not t["incomplete"]:
                rows.extend(dict(s, dossier=d) for s in t["sojourns"] if not s["open"])
        return rows

    @cached_property
    def waiting(self):
        """Séjours en cours des dossiers actifs, par gate : [(dossier, âge en jours)]. Un dossier suspendu
        n'attend pas une décision du gate : il ne fait ni goulot ni dossier bloqué."""
        result = defaultdict(list)
        for d in self.live.filtered(lambda d: d.state == "open"):
            t = self.timeline(d)
            if not t["incomplete"]:
                result[t["gate"]].append((d, t["age"]))
        return result

    def chart_months(self):
        """Mois des graphiques : ceux de la période, étendus aux 12 derniers mois si elle est plus courte."""
        start = min(self.date_from, self.date_to.replace(day=1) - relativedelta(months=11))
        return pf.month_keys(start, self.date_to)


class EguitraAnalyticsCabinet(models.AbstractModel):
    _name = "eguitra.analytics.cabinet"
    _description = "Analyses du cabinet"

    # ─── Points d'entrée ──────────────────────────────────────────────────

    def _bundle(self, company, period, sudo=False):
        return Bundle(self.sudo().env if sudo else self.env, company, period)

    def _run(self, name, company, period, ctx=None, limit=6):
        b = ctx or self._bundle(company, period)
        data = dict(self._section(b, name))
        candidates, notes = data.pop("_insights"), data.pop("_notes")
        data["insights"] = rank(candidates, limit)
        data["quality"] = _quality(notes)
        return data

    def _section(self, b, name):
        if name not in b.sections:
            b.sections[name] = getattr(self, f"_{name}")(b)
        return b.sections[name]

    def synthese(self, company, period, ctx=None):
        """Cockpit du cabinet (6.1) : indicateurs clés, entonnoir des gates, nuage de maturité et les
        dix meilleurs constats de toutes les sections."""
        b = ctx or self._bundle(company, period)
        data = self._synthese(b)
        candidates = data.pop("_insights")
        data["insights"] = rank(candidates, 10)
        return data

    def portefeuille(self, company, period, ctx=None):
        """Où en sont les projets (6.2)."""
        return self._run("portefeuille", company, period, ctx)

    def diagnostic(self, company, period, ctx=None):
        """Faiblesses systémiques des projets (6.3)."""
        return self._run("diagnostic", company, period, ctx)

    def comites(self, company, period, ctx=None):
        """Qualité des décisions (6.4)."""
        return self._run("comites", company, period, ctx)

    def financements(self, company, period, ctx=None):
        """Financements recherchés (6.5)."""
        return self._run("financements", company, period, ctx)

    def activite(self, company, period, ctx=None):
        """Activité et honoraires (6.6). Ouverte aussi au profil finance, qui ne lit pas les dossiers du
        cabinet : ses agrégats sont alors calculés en lecture privilégiée, bornés à la société de travail
        (déjà contrôlée par la route) ; seuls des totaux et des références de dossiers sont rendus."""
        user = self.env.user
        trusted = self.env.su or user.has_group("eguitra_base.group_profile_cabinet") or \
            user.has_group("eguitra_base.group_profile_direction")
        return self._run("activite", company, period, ctx or self._bundle(company, period, sudo=not trusted))

    def risques(self, company, period, ctx=None):
        """Risques et exécution (6.7)."""
        return self._run("risques", company, period, ctx)

    # ─── 6.1 Synthèse ─────────────────────────────────────────────────────

    def _synthese(self, b):
        """Indicateurs du cockpit.

        - Dossiers actifs : en cours à la date d'arrêté (les suspendus sont rappelés à part).
        - Besoin de financement et pipeline pondéré : besoin × probabilité de bancabilité (fonction
          logistique du score Bankability : 50 → 0,2 ; 65 → 0,5 ; 80 → 0,8 ; nulle si knock-out confirmé).
        - Score moyen Readiness : dossiers dont au moins un critère est évalué.
        - Taux de passage de gate : part des revues de comité verrouillées de la période concluant à GO
          ou CONDITIONAL GO (hors ajournements), définition des stage gates.
        - Durée médiane d'un gate : séjours achevés sur la période, hors recevabilité (formalité).
        - Honoraires : chiffre d'affaires (comptes 70) de la société sur la période.
        - Taux de réalisation : honoraires facturés du temps de la période / valeur de ce temps au
          taux standard (section Activité)."""
        sections = {name: self._section(b, name) for name in SECTIONS}
        port, act = sections["portefeuille"], sections["activite"]
        live = b.live
        running = live.filtered(lambda d: d.state == "open")
        need = sum(b.need(d) for d in live)
        weighted = port["pipeline_value"]["weighted"]
        assessed = [b.result(d)[1]["readiness"] for d in live if b.result(d)[1]["assessed"]]
        readiness = pf.mean(assessed)
        th = b.thresholds

        def pass_rate(in_range):
            decided = [r for r in b.locked_reviews if in_range(r.date) and r.decision != "postponed"]
            return _share(sum(1 for r in decided if r.decision in PASSING_DECISIONS), len(decided))

        def gate_median(in_range):
            return pf.median([s["days"] for s in b.completed_sojourns
                              if in_range(s["end"]) and s["gate"] not in b.intake_gates])

        rate_now, rate_before = pass_rate(b.in_period), pass_rate(b.in_previous)
        median_now, median_before = gate_median(b.in_period), gate_median(b.in_previous)
        summary = act["summary"]
        ratio = _share(weighted, need)
        kpis = [
            _kpi("active_dossiers", "Dossiers actifs", len(running), "count",
                 f"Dossiers en cours à la date d'arrêté ; {_n(len(live) - len(running), 'dossier suspendu', 'dossiers suspendus')} en plus, hors dossiers clos."),
            _kpi("financing_need", "Besoin de financement", need, "gnf",
                 "Besoin de financement cumulé des dossiers en cours et suspendus (dossiers en devise convertis au "
                 "cours de la date d'arrêté)."),
            _kpi("weighted_pipeline", "Pipeline pondéré", weighted, "gnf",
                 "Besoin de financement × probabilité de bancabilité de chaque dossier (fonction logistique du score "
                 "Bankability : 50 → 20 %, 65 → 50 %, 80 → 80 % ; nulle si un knock-out est confirmé).",
                 status=_status(ratio, 50, 25)),
            _kpi("readiness_avg", "Score moyen Readiness", readiness, "score",
                 f"Moyenne du Project Readiness des dossiers du portefeuille dont au moins un critère est évalué "
                 f"({len(assessed)} sur {len(live)}) ; cible : seuil APD READY de la politique.",
                 target=th["apd"], status=_status(readiness, th["apd"], th["conditional"])),
            _kpi("gate_pass_rate", "Taux de passage de gate", rate_now, "pct",
                 "Part des revues de comité verrouillées de la période concluant à GO ou CONDITIONAL GO (hors "
                 "ajournements).", previous=rate_before, status=_status(rate_now, 60, 40)),
            _kpi("gate_median_days", "Durée médiane d'un gate", median_now, "days",
                 f"Médiane des séjours achevés dans un gate sur la période (journal des passages), hors recevabilité ; "
                 f"cible : {GATE_TARGET_DAYS} jours.", previous=median_before, target=GATE_TARGET_DAYS,
                 status=_status(median_now, GATE_TARGET_DAYS, GATE_TARGET_DAYS * 1.5, inverse=True), inverse=True),
            _kpi("fees", "Honoraires de la période", summary["fees"], "gnf",
                 "Chiffre d'affaires hors taxes du cabinet (comptes 70, pièces validées) sur la période, comparé à la "
                 "même période un an plus tôt.", previous=summary["fees_previous"], trend=summary["fees_trend"],
                 status="neutral" if not summary["fees_previous"] else
                 ("good" if summary["fees"] >= summary["fees_previous"] else "warn")),
            _kpi("realization_rate", "Taux de réalisation", summary["realization_pct"], "pct",
                 "Honoraires facturés du temps passé sur la période / valeur de ce temps au taux horaire standard "
                 "(temps non facturable compris).", target=REALIZATION_TARGET, trend=summary["realization_trend"],
                 status=_status(summary["realization_pct"], REALIZATION_TARGET, 70)),
        ]
        funnel = [{k: row[k] for k in ("gate", "label", "count", "need", "investment", "conversion_pct")}
                  for row in port["funnel"]]
        maturity, counts = [], defaultdict(int)
        for d in live:
            _r_, s = b.result(d)
            if not s["assessed"]:
                continue
            high_r, high_b = s["readiness"] >= th["apd"], s["bankability"] >= th["bankable"]
            counts[(high_r, high_b)] += 1
            maturity.append({
                "id": d.id, "reference": d.reference, "name": d.name, "readiness": _r(s["readiness"]),
                "bankability": _r(s["bankability"]), "need": round(b.need(d)), "recommendation": s["recommendation"],
                "sector": (d.sector or "").strip() or "Non renseigné", "gate": b.timeline(d)["gate"],
                "probability": round(b.probability(d), 3), "link": _dossier_link(d),
            })
        quadrants = [
            {"key": "presentable", "label": "Présentables aux financeurs", "readiness": [th["apd"], 100],
             "bankability": [th["bankable"], 100], "count": counts[(True, True)]},
            {"key": "structure", "label": "Prêts techniquement, à structurer financièrement",
             "readiness": [th["apd"], 100], "bankability": [0, th["bankable"]], "count": counts[(True, False)]},
            {"key": "confirm", "label": "Bancabilité à confirmer sur le fond", "readiness": [0, th["apd"]],
             "bankability": [th["bankable"], 100], "count": counts[(False, True)]},
            {"key": "upstream", "label": "À accompagner en amont", "readiness": [0, th["apd"]],
             "bankability": [0, th["bankable"]], "count": counts[(False, False)]},
        ]
        candidates, qualities = [], []
        for name in SECTIONS:
            candidates.extend(sections[name]["_insights"])
            qualities.append(_quality(sections[name]["_notes"]))
        notes = []
        for q in qualities:
            for note in q["notes"]:
                if note not in notes:
                    notes.append(note)
        return {
            "kpis": kpis, "funnel": funnel, "maturity": maturity,
            "maturity_thresholds": {"readiness": th["apd"], "bankability": th["bankable"], "quadrants": quadrants},
            "sections": {name: {"insights": len(sections[name]["_insights"]),
                                "quality": q["score"]} for name, q in zip(SECTIONS, qualities)},
            "quality": {"score": round(sum(q["score"] for q in qualities) / len(qualities)), "notes": notes[:8]},
            "_insights": candidates,
        }

    # ─── 6.2 Portefeuille ─────────────────────────────────────────────────

    def _portefeuille(self, b):
        """Entonnoir, durées dans les gates, goulot, secteurs et localisations, pipeline pondéré,
        dossiers attendus aux gates APD et Bankability.

        - Entonnoir : dossiers du portefeuille par gate à la date d'arrêté ; « reached » : dossiers
          (clos compris) ayant atteint le gate ; conversion = atteints du gate suivant / atteints du gate ;
          taux de passage résolu = passés / (passés + arrêtés à ce gate), qui écarte les dossiers encore en
          cours (la conversion brute les compte comme des échecs).
        - Durées : séjours achevés (médiane, 3e quartile) et médiane de Kaplan-Meier, qui tient compte
          des dossiers encore dans le gate (censure) ; un écart entre les deux révèle des dossiers lents.
        - Goulot : charge du gate = dossiers en attente × durée de référence (la plus grande de la
          médiane observée et de l'âge médian des dossiers en attente), en jours-dossiers.
        - Prévision : arrivées mensuelles observées au gate (journal), prolongées par forecast_series ;
          dossiers en approche : durée restante = médianes des gates restant à franchir, moins l'âge dans
          le gate courant."""
        gates, live = b.gates, b.live
        rows = {g["code"]: {"gate": g["code"], "label": g["name"], "sequence": g["sequence"], "rule": g["rule"],
                            "count": 0, "on_hold": 0, "need": 0.0, "investment": 0.0, "weighted_need": 0.0,
                            "reached": 0, "dropped": 0, "conversion_pct": None, "pass_rate_pct": None}
                for g in gates}
        last = len(gates) - 1
        for d in b.dossiers:
            t = b.timeline(d)
            for g in gates[: t["index"] + 1]:
                rows[g["code"]]["reached"] += 1
            row = rows.get(t["gate"])
            if row is None:
                continue
            if d.state not in OPEN_STATES:
                if t["index"] < last:
                    row["dropped"] += 1
                continue
            row["count"] += 1
            row["on_hold"] += 1 if d.state == "on_hold" else 0
            row["need"] += b.need(d)
            row["investment"] += b.investment(d)
            row["weighted_need"] += b.need(d) * b.probability(d)
        funnel = [rows[g["code"]] for g in gates]
        for i, row in enumerate(funnel[:-1]):
            passed = funnel[i + 1]["reached"]
            row["conversion_pct"] = _r(_share(passed, row["reached"]))
            row["pass_rate_pct"] = _r(_share(passed, passed + row["dropped"]))
        for row in funnel:
            for key in ("need", "investment", "weighted_need"):
                row[key] = round(row[key])

        completed = defaultdict(list)
        for s in b.completed_sojourns:
            completed[s["gate"]].append(s)
        time_in_gate = []
        for g in gates:
            done = completed.get(g["code"], [])
            durations = [s["days"] for s in done]
            ages = [age for _d, age in b.waiting.get(g["code"], [])]
            recent = [s["days"] for s in done if b.in_period(s["end"])]
            time_in_gate.append({
                "gate": g["code"], "label": g["name"], "median_days": _r(pf.median(durations)),
                "p75_days": _r(pf.quantile(durations, 0.75)), "n": len(durations),
                "km_median_days": _r(pf.km_median([(x, True) for x in durations] + [(a, False) for a in ages])),
                "period_median_days": _r(pf.median(recent)), "period_n": len(recent), "in_gate": len(ages),
                "median_age_days": _r(pf.median(ages)), "max_age_days": max(ages, default=None),
                "forced": sum(1 for s in done if s["forced"]),
            })
        by_code = {row["gate"]: row for row in time_in_gate}

        loads = []
        for row in time_in_gate:
            if row["in_gate"]:
                ref = max(row["median_days"] or 0, row["median_age_days"] or 0)
                loads.append((row["in_gate"] * ref, ref, row))
        bottleneck = None
        if loads:
            load, ref, row = max(loads, key=lambda x: (x[0], x[1]))
            waiting = sorted(b.waiting[row["gate"]], key=lambda x: -x[1])
            km = row["km_median_days"]
            comment = (f"{_n(row['in_gate'], 'dossier')} en attente depuis {_days(row['median_age_days'])} en médiane ; "
                       + (f"durée médiane des passages achevés : {_days(row['median_days'])}"
                          if row["median_days"] is not None else "aucun passage achevé observé")
                       + (f", {_days(km)} en tenant compte des dossiers en cours." if km is not None
                          else f", plus de {_days(row['max_age_days'])} en tenant compte des dossiers en cours."
                          if row["n"] else "."))
            bottleneck = {
                "gate": row["gate"], "label": row["label"], "in_gate": row["in_gate"], "median_days": row["median_days"],
                "median_age_days": row["median_age_days"], "km_median_days": km, "days_per_dossier": _r(ref),
                "load_days": _r(load), "need": round(sum(b.need(d) for d, _a in waiting)), "comment": comment,
                "dossiers": [dict(_brief(d), age_days=age, link=_dossier_link(d)) for d, age in waiting],
            }

        def grouped(field):
            groups = {}
            for d in live:
                label = (d[field] or "").strip() or "Non renseigné"
                g = groups.setdefault(label, {"key": label, "label": label, "count": 0, "need": 0.0, "investment": 0.0,
                                              "weighted_need": 0.0, "_r": [], "_b": []})
                _res, s = b.result(d)
                g["count"] += 1
                g["need"] += b.need(d)
                g["investment"] += b.investment(d)
                g["weighted_need"] += b.need(d) * b.probability(d)
                if s["assessed"]:
                    g["_r"].append(s["readiness"])
                    g["_b"].append(s["bankability"])
            total = sum(g["need"] for g in groups.values())
            out = []
            for g in groups.values():
                scores, bank = g.pop("_r"), g.pop("_b")
                out.append(dict(g, need=round(g["need"]), investment=round(g["investment"]),
                                weighted_need=round(g["weighted_need"]), avg_score=_r(pf.mean(scores)),
                                bankability_avg=_r(pf.mean(bank)), share_pct=_r(_share(g["need"], total))))
            return sorted(out, key=lambda x: (-x["need"], x["label"]))

        by_sector, by_location = grouped("sector"), grouped("location")
        concentration = None
        if by_sector:
            index = pf.hhi([s["need"] for s in by_sector])
            concentration = {"hhi": _r(index, 3), "top": by_sector[0]["label"], "top_share_pct": by_sector[0]["share_pct"]}

        pipeline_rows = []
        for d in live:
            _res, s = b.result(d)
            ko = b.confirmed_knockouts(d)
            p, need = b.probability(d), b.need(d)
            pipeline_rows.append({
                "id": d.id, "reference": d.reference, "name": d.name, "gate": b.timeline(d)["gate"], "need": round(need),
                "bankability": _r(s["bankability"]), "probability": round(p, 3), "weighted": round(need * p),
                "knockout": bool(ko), "knockouts": [x["code"] for x in ko], "recommendation": s["recommendation"],
                "link": _dossier_link(d),
            })
        pipeline_rows.sort(key=lambda x: (-x["weighted"], -x["need"], x["reference"] or ""))
        raw = sum(b.need(d) for d in live)
        weighted = sum(b.need(d) * b.probability(d) for d in live)
        pipeline_value = {
            "raw": round(raw), "weighted": round(weighted), "ratio_pct": _r(_share(weighted, raw)),
            "method": "Probabilité = 1 / (1 + e^(-k (Bankability - 65))), k = ln 4 / 15 (50 → 0,2 ; 65 → 0,5 ; "
                      "80 → 0,8), nulle si un knock-out est confirmé sur un critère évalué.",
            "dossiers": pipeline_rows,
        }

        forecast = self._gate_forecast(b, gates, funnel, by_code)
        notes = self._portfolio_notes(b)
        candidates = self._portfolio_insights(b, funnel, time_in_gate, bottleneck, by_sector, concentration,
                                              pipeline_value, forecast)
        return {
            "funnel": funnel, "time_in_gate": time_in_gate, "bottleneck": bottleneck, "by_sector": by_sector,
            "by_location": by_location, "concentration": concentration, "pipeline_value": pipeline_value,
            "forecast": forecast, "_insights": candidates, "_notes": notes,
        }

    def _gate_forecast(self, b, gates, funnel, by_code):
        """Dossiers attendus aux gates APD et Bankability dans les 3 et 6 prochains mois."""
        since = min((d.create_date.date() for d in b.dossiers), default=b.date_to)
        span = (b.date_to.year - since.year) * 12 + b.date_to.month - since.month + 1
        months = pf.months_back(b.date_to, max(6, min(24, span)))
        year_ago = b.date_to - relativedelta(years=1)
        exits = defaultdict(int)
        for s in b.completed_sojourns:
            if year_ago < s["end"] <= b.date_to:
                exits[s["gate"]] += 1
        velocity = [{"gate": g["code"], "label": g["name"], "dossiers_per_month": round(exits[g["code"]] / 12, 2)}
                    for g in gates]
        reference = {code: (row["median_days"] if row["median_days"] is not None else row["km_median_days"])
                     for code, row in by_code.items()}
        fallback = pf.median([v for v in reference.values() if v is not None]) or STUCK_DAYS
        pass_rates = {row["gate"]: row["pass_rate_pct"] for row in funnel}
        result = {"apd_3m": None, "apd_6m": None, "bankability_3m": None, "bankability_6m": None,
                  "velocity": velocity, "targets": []}
        for rule in ("apd", "bankability"):
            code = b.gate_by_rule.get(rule)
            if not code:
                continue
            target = b.gate_index[code]
            arrivals = defaultdict(int)
            for passages in b.passages.values():
                for p in passages:
                    if p["dst"] == code and p["date"] <= b.date_to:
                        arrivals[pf.month_key(p["date"])] += 1
            # Mois entamé écarté de l'historique : la prévision part du dernier mois clos (le mois en cours
            # devient le premier mois prévu).
            history, values, _entame = _historique_clos(months, [float(arrivals.get(m, 0)) for m in months], b.date_to)
            fc = _forecast(values, 6)
            point, low, high = fc["forecast"], fc["low"], fc["high"]
            approaching = []
            for d in b.live:
                t = b.timeline(d)
                if t["incomplete"] or t["index"] >= target:
                    continue
                days, probability = 0.0, 1.0
                for g in gates[t["index"]:target]:
                    duration = reference.get(g["code"])
                    duration = fallback if duration is None else duration
                    if g["code"] == t["gate"]:
                        duration = max(duration - t["age"], 0)
                    days += duration
                    rate = pass_rates.get(g["code"])
                    probability = None if probability is None or rate is None else probability * rate / 100
                if days <= CANDIDATE_HORIZON_DAYS:
                    approaching.append(dict(_brief(d), gate=t["gate"], eta_days=round(days),
                                            eta_date=b.date_to + timedelta(days=round(days)),
                                            pass_probability=_r(probability, 3),
                                            knockout=bool(b.confirmed_knockouts(d)), link=_dossier_link(d)))
            approaching.sort(key=lambda x: (x["eta_days"], x["reference"] or ""))
            def total(seq, n):
                return _r(sum(seq[:n])) if seq else None

            key = "apd" if rule == "apd" else "bankability"
            result[f"{key}_3m"] = total(point, 3)
            result[f"{key}_6m"] = total(point, 6)
            result["targets"].append({
                "gate": code, "label": b.gate_names[code], "rule": rule, "expected_3m": total(point, 3),
                "expected_6m": total(point, 6), "interval_3m": [total(low, 3), total(high, 3)],
                "interval_6m": [total(low, 6), total(high, 6)], "method": fc["method"],
                "mape": _r(fc["mape"]), "history": {"months": history, "values": values},
                "candidates": approaching,
            })
        return result

    def _portfolio_notes(self, b):
        notes = []
        live = b.live
        if not live:
            return [("Aucun dossier en cours : le portefeuille est vide à la date d'arrêté.", 0)]
        without_need = live.filtered(lambda d: not d.financing_need)
        if without_need:
            notes.append((f"{_n(len(without_need), 'dossier')} sans besoin de financement renseigné "
                          f"({_refs(without_need)}).", 30 * len(without_need) / len(live)))
        unassessed = [d for d in live if not b.result(d)[1]["assessed"]]
        if unassessed:
            notes.append((f"{_n(len(unassessed), 'dossier')} sans aucun critère évalué : exclus des moyennes de score.",
                          30 * len(unassessed) / len(live)))
        incomplete = [d for d in b.dossiers if b.timeline(d)["incomplete"]]
        if incomplete:
            notes.append((f"Historique des passages de gate incomplet pour {_n(len(incomplete), 'dossier')} : "
                          "exclus des durées.", 20 * len(incomplete) / len(b.dossiers)))
        foreign = live.filtered(lambda d: d.currency_id and d.currency_id != b.company.currency_id)
        if foreign:
            notes.append((f"{_n(len(foreign), 'dossier')} en devise, converti(s) au cours du "
                          f"{b.date_to:%d/%m/%Y}.", 0))
        return notes

    def _portfolio_insights(self, b, funnel, time_in_gate, bottleneck, by_sector, concentration, pipeline, forecast):
        out = []
        total_need = pipeline["raw"]
        if bottleneck and bottleneck["in_gate"]:
            age = bottleneck["median_age_days"] or 0
            severity = "high" if bottleneck["in_gate"] >= 2 and age > STUCK_DAYS else "medium"
            out.append(insight(
                f"cabinet.goulot.{bottleneck['gate']}", "portefeuille", severity,
                f"Le gate {bottleneck['gate']} ({bottleneck['label']}) est le goulot du portefeuille",
                f"{bottleneck['comment']} Ces dossiers portent {gnf(bottleneck['need'])} de besoin de financement"
                + (f", soit {pct(_share(bottleneck['need'], total_need))} du portefeuille." if total_need else "."),
                metric={"label": "Âge médian dans le gate", "value": bottleneck["median_age_days"] or 0, "unit": "days",
                        "reference": bottleneck["median_days"], "reference_label": "Durée médiane observée"},
                impact_gnf=bottleneck["need"],
                confidence=_confidence(bottleneck["in_gate"] + next(r["n"] for r in time_in_gate
                                                                    if r["gate"] == bottleneck["gate"])),
                method="Charge de chaque gate = dossiers en attente × durée de référence (la plus grande de la médiane "
                       "des passages achevés et de l'âge médian des dossiers en attente) ; le goulot est le gate de plus "
                       "forte charge. Médiane de Kaplan-Meier : séjours en cours comptés comme censurés.",
                evidence={"type": "bars", "data": {"labels": [x["reference"] or x["name"] for x in bottleneck["dossiers"]],
                                                   "values": [x["age_days"] for x in bottleneck["dossiers"]], "unit": "days"}},
                action=f"Tenir une revue d'avancement ciblée des dossiers en {bottleneck['gate']} : lever les écarts "
                       "bloquants avec les porteurs, ou prononcer un HOLD pour libérer la capacité des consultants.",
                link=_section_link("portefeuille", "temps", gate=bottleneck["gate"]),
            ))
        stuck = []
        p75 = {row["gate"]: (row["p75_days"] if row["n"] >= 3 else None) for row in time_in_gate}
        for code, waiting in b.waiting.items():
            limit = p75.get(code) or STUCK_DAYS
            stuck.extend((d, age, code, limit) for d, age in waiting if age > limit and code not in
                         ((bottleneck or {}).get("gate"),))
        if stuck:
            stuck.sort(key=lambda x: -x[1])
            dossiers = [x[0] for x in stuck]
            need = sum(b.need(d) for d in dossiers)
            out.append(insight(
                "cabinet.dossiers_bloques", "portefeuille", "medium",
                f"{_n(len(stuck), 'dossier dépasse', 'dossiers dépassent')} la durée habituelle de leur gate",
                " ; ".join(f"{d.reference or d.name} : {_days(age)} en {code} (seuil {_days(limit)})"
                          for d, age, code, limit in stuck[:3]) + ".",
                metric={"label": "Âge le plus élevé", "value": stuck[0][1], "unit": "days", "reference": stuck[0][3],
                        "reference_label": "Seuil (3e quartile des passages, à défaut 90 jours)"},
                impact_gnf=need, confidence=0.7,
                method="Âge dans le gate courant comparé au 3e quartile des séjours achevés du même gate (au moins trois "
                       "passages observés), à défaut à 90 jours.",
                action="Fixer avec chaque porteur une échéance de levée des écarts ; sans engagement daté, proposer un "
                       "HOLD au prochain comité.",
                link=_dossier_link(dossiers[0]) if len(dossiers) == 1 else "/analyse/portefeuille",
            ))
        if concentration and concentration["hhi"] is not None and concentration["hhi"] > 0.25 and len(by_sector) >= 2 \
                and len(b.live) >= 3:
            top = by_sector[0]
            out.append(insight(
                "cabinet.concentration_sectorielle", "portefeuille", "medium",
                f"Le besoin de financement est concentré sur le secteur {top['label']}",
                f"{top['label']} représente {pct(top['share_pct'])} du besoin de financement du portefeuille (indice de "
                f"Herfindahl {_fr(concentration['hhi'], 2)}) : un retournement du secteur ou le retrait d'un financeur "
                "spécialisé toucherait l'essentiel du pipeline.",
                metric={"label": "Part du premier secteur", "value": top["share_pct"] or 0, "unit": "pct",
                        "reference": 50.0, "reference_label": "Seuil de vigilance"},
                impact_gnf=top["need"], confidence=0.75,
                method="Indice de Herfindahl-Hirschman des besoins de financement par secteur (au-delà de 0,25 : "
                       "portefeuille concentré).",
                evidence={"type": "bars", "data": {"labels": [s["label"] for s in by_sector],
                                                   "values": [s["need"] for s in by_sector], "unit": "gnf"}},
                action="Orienter la prospection vers d'autres secteurs et diversifier les financeurs sollicités pour le "
                       "secteur dominant.",
                link="/analyse/portefeuille",
            ))
        ratio = pipeline["ratio_pct"]
        if ratio is not None and total_need:
            near = [x for x in pipeline["dossiers"] if not x["knockout"] and x["bankability"] is not None
                    and 55 <= x["bankability"] < 75]
            if ratio < 25:
                out.append(insight(
                    "cabinet.pipeline_pondere", "portefeuille", "medium",
                    f"Seuls {pct(ratio)} du besoin de financement sont bancables à court terme",
                    f"Pondéré par la probabilité de bancabilité de chaque dossier, le pipeline vaut "
                    f"{gnf(pipeline['weighted'])} pour {gnf(total_need)} de besoin de financement."
                    + (f" {_n(len(near), 'dossier est', 'dossiers sont')} proche(s) du seuil (Bankability entre 55 et 75)."
                       if near else ""),
                    metric={"label": "Pipeline pondéré / besoin", "value": ratio, "unit": "pct", "reference": 50.0,
                            "reference_label": "Portefeuille équilibré"},
                    impact_gnf=total_need - pipeline["weighted"], confidence=_confidence(len(b.live)),
                    method=pipeline["method"],
                    action="Concentrer l'accompagnement sur les dossiers proches du seuil (Bankability entre 55 et 75) : "
                           "c'est là qu'un point de score gagné accroît le plus la probabilité de financement.",
                    link="/analyse/portefeuille",
                ))
            elif ratio >= 50:
                out.append(insight(
                    "cabinet.pipeline_pondere", "portefeuille", "positive",
                    f"Le pipeline pondéré couvre {pct(ratio)} du besoin de financement",
                    f"{gnf(pipeline['weighted'])} de besoin sont portés par des dossiers à forte probabilité de "
                    f"bancabilité, sur {gnf(total_need)}.",
                    metric={"label": "Pipeline pondéré / besoin", "value": ratio, "unit": "pct", "reference": 50.0,
                            "reference_label": "Portefeuille équilibré"},
                    impact_gnf=pipeline["weighted"], confidence=_confidence(len(b.live)), method=pipeline["method"],
                    action="Préparer la présentation des dossiers les plus probables aux financeurs ciblés.",
                    link="/analyse/financements",
                ))
        bankable = [d for d in b.live if b.result(d)[1]["recommendation"] == "bankable"]
        if bankable:
            need = sum(b.need(d) for d in bankable)
            out.append(insight(
                "cabinet.bancables", "portefeuille", "positive",
                f"{_n(len(bankable), 'dossier présentable', 'dossiers présentables')} aux financeurs",
                f"{_refs(bankable)} {'atteint' if len(bankable) == 1 else 'atteignent'} le statut BANKABLE CANDIDATE "
                f"de la méthode, pour {gnf(need)} de besoin de financement.",
                metric={"label": "Dossiers BANKABLE CANDIDATE", "value": len(bankable), "unit": "count",
                        "reference": len(b.live), "reference_label": "Dossiers du portefeuille"},
                impact_gnf=need, confidence=0.85,
                method="Recommandation de la méthode MB AxisPro Consulting : Bankability au-dessus du seuil de la politique, gate "
                       "Bankability en GO (DSCR au moins égal au seuil bancaire), aucun knock-out actif.",
                action="Ouvrir les data rooms et organiser la présentation aux financeurs ciblés.",
                link=_dossier_link(bankable[0]) if len(bankable) == 1 else "/analyse/financements",
            ))
        for i, row in enumerate(funnel[:-1]):
            resolved = funnel[i + 1]["reached"] + row["dropped"]
            if row["pass_rate_pct"] is not None and resolved >= 3 and row["pass_rate_pct"] < 50:
                out.append(insight(
                    f"cabinet.conversion.{row['gate']}", "portefeuille", "medium",
                    f"Plus d'un dossier sur deux s'arrête au gate {row['gate']}",
                    f"Sur {resolved} dossiers dont le sort est connu à ce gate, {row['dropped']} ont été clos sans le "
                    f"franchir (taux de passage {pct(row['pass_rate_pct'])}).",
                    metric={"label": "Taux de passage", "value": row["pass_rate_pct"], "unit": "pct", "reference": 50.0,
                            "reference_label": "Seuil"},
                    confidence=_confidence(resolved),
                    method="Taux de passage résolu : dossiers ayant atteint le gate suivant / (ces dossiers + dossiers "
                           "clos à ce gate) ; les dossiers encore en cours sont écartés.",
                    action="Renforcer la préqualification en amont de ce gate pour n'engager que des projets à même de "
                           "le franchir.",
                    link=_section_link("portefeuille", "entonnoir", gate=row["gate"]),
                ))
        for target in forecast["targets"]:
            soon = [c for c in target["candidates"] if c["eta_days"] <= 92 and not c["knockout"]]
            if target["expected_6m"] or soon:
                out.append(insight(
                    f"cabinet.prevision.{target['gate']}", "portefeuille", "info",
                    f"Dossiers attendus au gate {target['gate']} ({target['label']}) dans les six mois",
                    f"Au rythme observé, {_fr(target['expected_6m'] or 0, 1)} arrivée(s) attendue(s) en six mois "
                    f"({_fr(target['expected_3m'] or 0, 1)} en trois mois)"
                    + (f" ; {_n(len(soon), 'dossier')} en approche d'ici trois mois : {_refs([b.env['axispro.dossier'].browse(c['id']) for c in soon])}."
                       if soon else "."),
                    metric={"label": "Arrivées attendues à 6 mois", "value": target["expected_6m"] or 0, "unit": "count",
                            "reference": None, "reference_label": None},
                    confidence=0.55,
                    method=f"Arrivées mensuelles au gate (journal des passages) prolongées par {target['method'] or 'lissage'} ; "
                           "dossiers en approche : médianes des gates restant à franchir moins l'âge dans le gate courant.",
                    action="Préparer les comités et la charge des consultants pour ces arrivées.",
                    link=_section_link("portefeuille", "prevision", gate=target["gate"]),
                ))
        return out

    # ─── 6.3 Diagnostic ───────────────────────────────────────────────────

    def _diagnostic(self, b):
        """Faiblesses systémiques des projets.

        - Écarts : critères exigés (gate atteint) et évalués, retenus non disponibles ou incomplets par la
          méthode (requalification comprise : preuve absente ou périmée) ; un critère non encore évalué est
          un retard d'évaluation, pas une faiblesse du projet, et se compte à part. Fréquence = dossiers en
          écart / dossiers où le critère est exigé ; priorité moyenne = formule de la méthode.
        - Domaines : score de la méthode (toute la grille) pour la carte, et score « exigible » (critères
          des gates atteints, évalués) pour les moyennes, qui ne pénalise pas un dossier jeune.
        - Pièces : attendues jusqu'au gate courant, obligatoires, non disponibles ; âge = depuis l'entrée
          dans le gate où elles sont attendues.
        - Progression : instantanés des revues de comité et scores actuels ; vitesse = points de
          Readiness gagnés par mois entre le premier instantané et la date d'arrêté."""
        live = b.live
        domains, seen = [], set()
        for policy in b.policy | live.policy_id:
            for dom in policy.domain_ids.sorted("sequence"):
                if dom.code not in seen:
                    seen.add(dom.code)
                    domains.append({"code": dom.code, "label": dom.name, "deliverable": dom.deliverable or None})
        heat_rows, cells = [], []
        due_scores = defaultdict(list)
        method_scores = defaultdict(list)
        gaps = {}
        knockouts = {}
        backlog, backlog_dossiers = 0, set()
        evidence = {"required": 0, "proven": 0, "no_proof": 0, "expired": 0}
        missing = []
        pending_ko = 0
        # Carte des domaines sur une seule grille : celle en vigueur si des dossiers la suivent, sinon
        # celle du plus grand nombre de dossiers ; les dossiers d'une autre version sont comptés à part.
        heat_policy = b.policy if b.policy and b.policy in live.policy_id else \
            max(live.policy_id, key=lambda p: len(live.filtered(lambda d, p=p: d.policy_id == p)), default=None)
        heat_domains = ([{"code": dom.code, "label": dom.name} for dom in heat_policy.domain_ids.sorted("sequence")]
                        if heat_policy else [])
        other_policy = 0
        compartments = {}
        for d in live:
            r, s = b.result(d)
            t = b.timeline(d)
            idx = t["local_index"]
            on_map = not heat_policy or d.policy_id == heat_policy
            other_policy += not on_map
            if on_map:
                heat_rows.append(dict(_brief(d), gate=t["gate"], readiness=_r(s["readiness"])))
                # Suivi par compartiment (outil du cabinet, version 3) : charge et retard de chaque bloc
                # d'expertise sur le portefeuille, consultants affectés.
                owners = {a.compartment_id.id: a.user_id.name for a in d.assignment_ids}
                for c in r.get("compartments") or []:
                    row = compartments.setdefault(c["code"], {
                        "code": c["code"], "label": c["name"], "domains": c["domains"], "dossiers": 0, "_scores": [],
                        "gaps": 0, "studies": 0, "knockouts": 0, "unassigned": 0, "_owners": defaultdict(int),
                        "_unassigned": []})
                    row["dossiers"] += 1
                    if c["score"] is not None:
                        row["_scores"].append(c["score"])
                    row["gaps"] += c["gaps"]
                    row["studies"] += c["studies"]
                    row["knockouts"] += c["knockouts"]
                    if c["compartment_id"] in owners:
                        row["_owners"][owners[c["compartment_id"]]] += 1
                    else:
                        row["unassigned"] += 1
                        row["_unassigned"].append(d)
            for row in r["domains"]:
                if on_map:
                    cells.append({"dossier": d.reference, "dossier_id": d.id, "domain": row["code"],
                                  "score": _r(row["score"]), "priority": PRIORITY_LEVEL.get(row["priority"]),
                                  "priority_label": row["priority"]})
                if row["score"] is not None:
                    method_scores[row["code"]].append(row["score"])
            priorities = {g["id"]: g["priority"] for g in r["gaps"]}
            acc = defaultdict(lambda: [0.0, 0.0])
            exclude_na = r["policy"]["exclude_na"]
            for x in r["lines"]:
                if x["gate_index"] > idx:
                    continue
                code = x["code"]
                info = gaps.setdefault(code, {
                    "code": code, "label": x["name"], "domain": x["domain"].get("name"),
                    "domain_code": x["domain"].get("code"), "gate": None, "due": 0, "frequency": 0, "not_met": 0,
                    "partial": 0, "requalified": 0, "_priorities": [], "knockout": bool(x.get("knockout")),
                    "critical": bool(x.get("critical")), "need": 0.0, "_dossiers": [], "criterion_id": x["id"],
                })
                info["due"] += 1
                if x["entered"] == "not_assessed":
                    backlog += 1
                    backlog_dossiers.add(d.id)
                    if x.get("knockout"):
                        pending_ko += 1
                    continue
                if not (exclude_na and x["status"] == "na"):
                    acc[x["domain"].get("code")][0] += x["points"] * x["weight"]
                    acc[x["domain"].get("code")][1] += x["weight"]
                if x.get("evidence") and x["entered"] == "met":
                    evidence["required"] += 1
                    alerts = " ".join(x["alerts"])
                    if "périmée" in alerts:
                        evidence["expired"] += 1
                    elif "sans pièce" in alerts:
                        evidence["no_proof"] += 1
                    else:
                        evidence["proven"] += 1
                if x["status"] in ("not_met", "partial"):
                    kind = "not_met" if x["status"] == "not_met" else ("requalified" if x["entered"] == "met" else "partial")
                    info["frequency"] += 1
                    info[kind] += 1
                    info["_priorities"].append(priorities.get(x["id"], 0.0))
                    info["need"] += b.need(d)
                    info["_dossiers"].append((d, kind))
            for code, (points, weight) in acc.items():
                if weight:
                    due_scores[code].append(points / weight * 100)
            for x in b.confirmed_knockouts(d):
                k = knockouts.setdefault(x["code"], {"code": x["code"], "label": x["name"],
                                                     "domain": x["domain"].get("name"), "count": 0, "need": 0.0,
                                                     "_dossiers": []})
                k["count"] += 1
                k["need"] += b.need(d)
                k["_dossiers"].append(d)
            for doc in d.documents_status(r):
                if doc["due"] and doc["required"] and not doc["available"]:
                    requested = t["entered"].get(doc["gate"]) if doc["gate"] else d.create_date.date()
                    requested = requested or d.create_date.date()
                    missing.append(dict(_brief(d), code=doc["code"], label=doc["name"], gate=doc["gate"],
                                        age_days=max((b.date_to - requested).days, 0), link=_dossier_link(d)))
        gate_of = {}
        for policy in b.policy | live.policy_id:
            for c in policy.criterion_ids:
                gate_of.setdefault(c.code, (c.gate_id.code, c.default_deliverable()))
        top_gaps = []
        for info in gaps.values():
            if not info["frequency"]:
                continue
            dossiers = info.pop("_dossiers")
            prios = info.pop("_priorities")
            gate, deliverable = gate_of.get(info["code"], (None, None))
            top_gaps.append(dict(
                info, gate=gate, theme=deliverable, frequency_pct=_r(_share(info["frequency"], info["due"])),
                avg_priority=_r(pf.mean(prios), 2), need=round(info["need"]),
                dossiers=[d.reference for d, _k in dossiers],
                details=[dict(_brief(d), status=kind, link=_dossier_link(d)) for d, kind in dossiers],
            ))
        top_gaps.sort(key=lambda x: (-x["frequency"], -(x["avg_priority"] or 0), x["code"]))
        for info in gaps.values():
            info.pop("_dossiers", None)
            info.pop("_priorities", None)
        themes = defaultdict(lambda: {"gaps": 0, "dossiers": set(), "criteria": []})
        for g in top_gaps:
            theme = themes[g["domain_code"]]
            theme["gaps"] += g["frequency"]
            theme["dossiers"].update(g["dossiers"])
            theme["criteria"].append(g["code"])
        domain_by_code = {dom["code"]: dom for dom in domains}
        theme_rows = sorted(({
            "domain": code, "label": domain_by_code.get(code, {}).get("label"), "gaps": v["gaps"],
            "dossiers": len(v["dossiers"]), "criteria": v["criteria"],
            "deliverable": domain_by_code.get(code, {}).get("deliverable"),
        } for code, v in themes.items()), key=lambda x: (-x["dossiers"], -x["gaps"], x["domain"] or ""))
        averages = []
        for dom in domains:
            scores = due_scores.get(dom["code"], [])
            weak = sum(1 for x in scores if x < 50)
            averages.append({
                "code": dom["code"], "label": dom["label"], "mean": _r(pf.mean(scores)),
                "method_mean": _r(pf.mean(method_scores.get(dom["code"], []))), "n": len(scores),
                "weak": weak, "weak_share_pct": _r(_share(weak, len(scores))), "deliverable": dom["deliverable"],
            })
        ko_rows = []
        for k in sorted(knockouts.values(), key=lambda x: (-x["count"], -x["need"], x["code"])):
            dossiers = k.pop("_dossiers")
            ko_rows.append(dict(k, need=round(k["need"]), dossiers=[d.reference for d in dossiers],
                                details=[dict(_brief(d), link=_dossier_link(d)) for d in dossiers]))
        missing.sort(key=lambda x: (-x["age_days"], x["reference"] or ""))
        buckets = defaultdict(int)
        for m in missing:
            buckets[_bucket(m["age_days"])] += 1
        ages = [m["age_days"] for m in missing]
        evidence_block = {
            "coverage_pct": _r(_share(evidence["proven"], evidence["required"])), "required": evidence["required"],
            "proven": evidence["proven"], "no_proof": evidence["no_proof"], "expired": evidence["expired"],
            "missing": len(missing), "missing_median_age_days": _r(pf.median(ages)),
            "missing_over_60": sum(1 for a in ages if a > MISSING_OLD_DAYS),
            "missing_by_age": [{"bucket": key, "label": label, "count": buckets[key]} for key, label, _l, _h in AGE_BUCKETS],
            "rows": missing[:30],
        }
        compartment_rows = []
        for row in compartments.values():
            scores, owners, unassigned = row.pop("_scores"), row.pop("_owners"), row.pop("_unassigned")
            compartment_rows.append(dict(
                row, mean=_r(pf.mean(scores)), gaps_per_dossier=_r(row["gaps"] / row["dossiers"]) if row["dossiers"] else None,
                consultants=[{"name": name, "dossiers": n} for name, n in sorted(owners.items(), key=lambda x: (-x[1], x[0]))],
                unassigned_dossiers=[dict(_brief(d), link=_dossier_link(d)) for d in unassigned],
            ))
        progression = self._progression(b)
        notes = []
        if backlog:
            total_due = sum(info["due"] for info in gaps.values())
            notes.append((f"{_n(backlog, 'critère')} des gates atteints reste(nt) à évaluer sur "
                          f"{_n(len(backlog_dossiers), 'dossier')} : écarts sous-estimés d'autant.",
                          40 * backlog / total_due if total_due else 0))
        if not live:
            notes.append(("Aucun dossier en cours à diagnostiquer.", 0))
        candidates = self._diagnostic_insights(b, top_gaps, averages, ko_rows, evidence_block, backlog,
                                               backlog_dossiers, pending_ko, progression)
        candidates += self._compartment_insights(compartment_rows)
        return {
            "compartments": compartment_rows,
            "domain_heatmap": {"dossiers": heat_rows, "domains": heat_domains or [{"code": x["code"], "label": x["label"]}
                                                                                   for x in domains],
                               "cells": cells, "averages": averages,
                               "policy": {"name": heat_policy.name, "version": heat_policy.version} if heat_policy else None,
                               "other_policy_dossiers": other_policy},
            "top_gaps": top_gaps[:15], "themes": theme_rows, "knockouts": ko_rows,
            "knockouts_pending": pending_ko, "evaluation_backlog": {"criteria": backlog, "dossiers": len(backlog_dossiers)},
            "evidence": evidence_block, "progression": progression, "_insights": candidates, "_notes": notes,
        }

    def _progression(self, b):
        live_ids = set(b.live.ids)
        points = defaultdict(list)
        for review in b.reviews:
            if review.dossier_id.id in live_ids and review.snapshot:
                snap = review.snapshot
                points[review.dossier_id.id].append({
                    "date": review.date, "readiness": snap.get("readiness"), "apd": snap.get("apd"),
                    "bankability": snap.get("bankability"), "decision": review.decision, "source": "review",
                })
        dates = sorted({p["date"] for rows in points.values() for p in rows} | {b.date_to})
        series, rows = [], []
        for d in b.live:
            history = sorted(points.get(d.id, []), key=lambda p: p["date"])
            if not history:
                continue
            _r_, s = b.result(d)
            current = {"date": b.date_to, "readiness": s["readiness"], "apd": s["apd"], "bankability": s["bankability"],
                       "decision": None, "source": "current"}
            history.append(current)
            by_date = {}
            for p in history:
                by_date[p["date"]] = p["readiness"]
            series.append({"id": d.id, "reference": d.reference, "scores": [_r(by_date.get(day)) for day in dates]})
            first = history[0]
            span = (b.date_to - first["date"]).days
            delta = (s["readiness"] or 0) - (first["readiness"] or 0)
            rows.append(dict(_brief(d), first_date=first["date"], first_readiness=_r(first["readiness"]),
                             readiness=_r(s["readiness"]), delta=_r(delta), days=span,
                             velocity_per_month=_r(delta / span * 30) if span >= 30 else None,
                             points=[dict(p, readiness=_r(p["readiness"]), apd=_r(p["apd"]),
                                          bankability=_r(p["bankability"])) for p in history],
                             link=_dossier_link(d)))
        velocities = [x["velocity_per_month"] for x in rows if x["velocity_per_month"] is not None]
        return {"dates": dates, "dossiers": series, "rows": rows,
                "median_velocity_per_month": _r(pf.median(velocities)),
                "improving": sum(1 for x in rows if (x["delta"] or 0) > 0),
                "stagnating": [x["id"] for x in rows if (x["delta"] or 0) <= 0 and x["days"] >= STAGNATION_DAYS
                               and (x["readiness"] or 0) < b.thresholds["bankable"]]}

    def _compartment_insights(self, rows):
        """Constats du suivi par compartiment : bloc d'expertise en retard, compartiments sans consultant."""
        out = []
        late = [x for x in rows if x["mean"] is not None and x["dossiers"] >= 2 and x["mean"] < 50]
        if late:
            worst = min(late, key=lambda x: (x["mean"], -x["gaps"]))
            out.append(insight(
                f"cabinet.compartiment_en_retard.{worst['code']}", "diagnostic", "medium",
                f"Le compartiment {worst['code']} {worst['label']} est le plus en retard",
                f"Score moyen de {_fr(worst['mean'], 1)}/100 sur {_n(worst['dossiers'], 'dossier')}, "
                f"{_n(worst['gaps'], 'manque')} à traiter ({_fr(worst['gaps_per_dossier'], 1)} par dossier) et "
                f"{_n(worst['studies'], 'étude renseignée', 'études renseignées')} : "
                f"{', '.join(worst['domains'])}.",
                metric={"label": "Score moyen du compartiment", "value": worst["mean"], "unit": "score",
                        "reference": 50.0, "reference_label": "Priorité élevée en dessous"},
                confidence=_confidence(worst["dossiers"]),
                method="Score de la méthode sur les critères des domaines du compartiment (toute la grille), moyenne "
                       "des dossiers suivant la grille de la carte des domaines ; manques : critères non disponibles "
                       "ou incomplets.",
                action="Renforcer ce compartiment : consultant dédié, études à lancer en priorité (les plus longues "
                       "d'abord), pièces à réclamer aux porteurs.",
                link=f"/analyse/diagnostic?compartment={worst['code']}",
            ))
        unassigned = [x for x in rows if x["unassigned"]]
        if unassigned:
            total = sum(x["unassigned"] for x in unassigned)
            dossiers = {d["reference"] or d["name"] for x in unassigned for d in x["unassigned_dossiers"]}
            out.append(insight(
                "cabinet.compartiments_sans_consultant", "diagnostic", "info",
                f"{_n(total, 'compartiment')} sans consultant sur {_n(len(dossiers), 'dossier')}",
                "Un manque sans responsable n'est qu'une observation : chaque compartiment d'un dossier se confie à "
                f"un consultant ({', '.join(x['code'] for x in unassigned)}).",
                metric={"label": "Compartiments sans consultant", "value": total, "unit": "count",
                        "reference": 0, "reference_label": "Cible"},
                confidence=0.95,
                method="Affectations des consultants par compartiment, dossiers en cours suivant la grille de la carte "
                       "des domaines.",
                action="Confier chaque compartiment à un consultant depuis la synthèse du dossier.",
                link="/analyse/diagnostic",
            ))
        return out

    def _diagnostic_insights(self, b, top_gaps, averages, knockouts, evidence, backlog, backlog_dossiers, pending_ko,
                             progression):
        out = []
        live_need = sum(b.need(d) for d in b.live)
        Dossier = b.env["axispro.dossier"]
        # Un critère éliminatoire actif a son propre constat (knock-out) : pas de doublon ici.
        active_ko = {k["code"] for k in knockouts}
        systemic = [g for g in top_gaps if g["frequency"] >= 2 and (g["frequency_pct"] or 0) >= 40
                    and g["code"] not in active_ko]
        for g in systemic[:2]:
            severity = "high" if g["knockout"] or g["critical"] else "medium"
            parts = [text for count, text in (
                (g["not_met"], f"{g['not_met']} non disponible{'s' if g['not_met'] > 1 else ''}"),
                (g["partial"], f"{g['partial']} incomplet{'s' if g['partial'] > 1 else ''}"),
                (g["requalified"], f"{g['requalified']} sans preuve valable"),
            ) if count]
            out.append(insight(
                f"cabinet.faiblesse.{g['code']}", "diagnostic", severity,
                f"« {g['label']} » fait défaut dans {pct(g['frequency_pct'], 0)} des dossiers",
                f"Le critère {g['code']} ({g['domain']}) est non disponible ou incomplet dans {g['frequency']} des "
                f"{g['due']} dossiers où il est exigé ({', '.join(parts)}) ; priorité moyenne de l'écart : "
                f"{_fr(g['avg_priority'], 1)}.",
                metric={"label": "Dossiers en écart", "value": g["frequency_pct"] or 0, "unit": "pct",
                        "reference": 40.0, "reference_label": "Seuil de faiblesse systémique"},
                impact_gnf=g["need"], confidence=_confidence(g["due"]),
                method="Critères exigés aux gates atteints et évalués, retenus non disponibles ou incomplets par la "
                       "méthode (requalification comprise) ; fréquence rapportée aux dossiers où le critère est exigé.",
                evidence={"type": "table", "data": {"columns": ["Dossier", "Statut retenu"],
                                                    "rows": [[x["reference"] or x["name"], x["status"]] for x in g["details"]]}},
                action=f"Proposer une prestation ou un atelier collectif aux porteurs concernés : {g['theme'] or g['label']}.",
                link=f"/analyse/diagnostic?criterion={g['code']}",
            ))
        weak = [a for a in averages if a["mean"] is not None and a["n"] >= 3 and a["mean"] < 50]
        if weak:
            dom = min(weak, key=lambda a: a["mean"])
            deliverable = dom["deliverable"]
            out.append(insight(
                f"cabinet.domaine_faible.{dom['code']}", "diagnostic", "medium",
                f"Le domaine {dom['label']} est le point faible du portefeuille",
                f"Score moyen de {_fr(dom['mean'], 1)}/100 sur les critères exigés et évalués, {dom['weak']} dossier(s) "
                f"sur {dom['n']} sous 50.",
                metric={"label": "Score moyen du domaine", "value": dom["mean"], "unit": "score", "reference": 50.0,
                        "reference_label": "Priorité élevée en dessous"},
                confidence=_confidence(dom["n"]),
                method="Score du domaine sur les seuls critères des gates atteints et évalués (points × poids / poids), "
                       "moyenne des dossiers du portefeuille.",
                action=f"Construire une offre d'accompagnement dédiée : {deliverable or 'livrable type du domaine à définir'}.",
                link=f"/analyse/diagnostic?domain={dom['code']}",
            ))
        for k in knockouts[:2]:
            dossiers = Dossier.browse([x["id"] for x in k["details"]])
            share = _share(k["need"], live_need) or 0
            deliverable = next((g["theme"] for g in top_gaps if g["code"] == k["code"]), None)
            out.append(insight(
                f"cabinet.knockout.{k['code']}", "diagnostic", "critical" if share >= 20 else "high",
                f"Knock-out « {k['label']} » actif sur {_n(k['count'], 'dossier')}",
                f"Tant qu'il n'est pas levé, aucune décision favorable n'est possible : {gnf(k['need'])} de besoin de "
                f"financement sont bloqués ({_refs(dossiers)}).",
                metric={"label": "Part du besoin de financement bloquée", "value": round(share, 1), "unit": "pct",
                        "reference": None, "reference_label": None},
                impact_gnf=k["need"], confidence=0.9,
                method="Critère éliminatoire évalué non disponible (ou incomplet si la politique le prévoit) : NO-GO "
                       "quel que soit le score.",
                action=f"Lever en priorité : {deliverable or k['label']}.",
                link=_dossier_link(dossiers[0]) if len(dossiers) == 1 else f"/analyse/diagnostic?criterion={k['code']}",
            ))
        if evidence["expired"] or evidence["no_proof"]:
            count = evidence["expired"] + evidence["no_proof"]
            out.append(insight(
                "cabinet.preuves", "diagnostic", "medium",
                f"{_n(count, 'critère déclaré disponible', 'critères déclarés disponibles')} sans preuve valable",
                f"{evidence['no_proof']} sans pièce justificative et {evidence['expired']} à la preuve périmée : la "
                "méthode les retient comme incomplets, ce qui abaisse les scores et peut activer un knock-out.",
                metric={"label": "Couverture des preuves", "value": evidence["coverage_pct"] or 0, "unit": "pct",
                        "reference": 100.0, "reference_label": "Cible"},
                confidence=0.85,
                method="Critères à preuve requise déclarés disponibles : preuve déposée, non rejetée et en cours de "
                       "validité.",
                action="Demander les pièces justificatives ou leur version actualisée aux porteurs concernés.",
                link="/analyse/diagnostic",
            ))
        old = [m for m in evidence["rows"] if m["age_days"] > MISSING_OLD_DAYS]
        if evidence["missing_over_60"]:
            out.append(insight(
                "cabinet.pieces_anciennes", "diagnostic", "medium",
                f"{_n(evidence['missing_over_60'], 'pièce attendue manque', 'pièces attendues manquent')} depuis plus de "
                f"{MISSING_OLD_DAYS} jours",
                "La plus ancienne : " + (f"{old[0]['label']} ({old[0]['reference']}, {_days(old[0]['age_days'])})." if old else "–"),
                metric={"label": "Âge médian des pièces manquantes", "value": evidence["missing_median_age_days"] or 0,
                        "unit": "days", "reference": float(MISSING_OLD_DAYS), "reference_label": "Seuil"},
                confidence=0.8,
                method="Pièces standard obligatoires attendues jusqu'au gate courant, ni déposées ni couvertes par une "
                       "preuve ; âge depuis l'entrée du dossier dans le gate où elles sont attendues.",
                action="Adresser à chaque porteur la liste imprimable des pièces attendues et fixer une échéance.",
                link=_dossier_link(Dossier.browse(old[0]["id"])) if len(old) == 1 else "/analyse/diagnostic",
            ))
        if backlog:
            out.append(insight(
                "cabinet.evaluations_en_retard", "diagnostic", "medium",
                f"{_n(backlog, 'critère')} des gates atteints reste(nt) à évaluer",
                f"Sur {_n(len(backlog_dossiers), 'dossier')}, la recommandation reste « à compléter » tant que ces "
                f"critères ne sont pas évalués" + (f", dont {pending_ko} éliminatoire(s)." if pending_ko else "."),
                metric={"label": "Critères à évaluer", "value": backlog, "unit": "count", "reference": 0,
                        "reference_label": "Cible"},
                confidence=0.9,
                method="Critères des gates atteints encore au statut « non évalué ».",
                action="Planifier les évaluations manquantes avec les consultants référents avant le prochain comité.",
                link="/analyse/diagnostic",
            ))
        stagnating = Dossier.browse(progression["stagnating"])
        if stagnating:
            out.append(insight(
                "cabinet.stagnation", "diagnostic", "medium",
                f"{_n(len(stagnating), 'dossier ne progresse', 'dossiers ne progressent')} plus",
                f"{_refs(stagnating)} : aucun gain de Readiness depuis {'sa' if len(stagnating) == 1 else 'leur'} "
                f"première revue de comité, il y a au moins {STAGNATION_DAYS} jours.",
                metric={"label": "Dossiers sans progrès", "value": len(stagnating), "unit": "count", "reference": 0,
                        "reference_label": "Cible"},
                impact_gnf=sum(b.need(d) for d in stagnating), confidence=0.7,
                method="Readiness à la date d'arrêté comparé au premier instantané de revue de comité (au moins 90 jours).",
                action="Revoir avec chaque porteur son plan d'actions ; à défaut d'engagement, proposer un HOLD.",
                link=_dossier_link(stagnating[0]) if len(stagnating) == 1 else "/analyse/diagnostic",
            ))
        velocity = progression["median_velocity_per_month"]
        if velocity is not None and velocity > 0:
            out.append(insight(
                "cabinet.progression", "diagnostic", "positive",
                f"Les dossiers gagnent {_fr(velocity, 1)} point(s) de Readiness par mois",
                f"{_n(progression['improving'], 'dossier progresse', 'dossiers progressent')} depuis leur première revue "
                "de comité (vitesse médiane).",
                metric={"label": "Gain médian mensuel", "value": velocity, "unit": "score", "reference": None,
                        "reference_label": None},
                confidence=_confidence(len(progression["rows"])),
                method="Points de Readiness gagnés entre le premier instantané de revue de comité et la date d'arrêté, "
                       "rapportés à 30 jours ; médiane des dossiers.",
                action="Partager avec l'équipe les pratiques des dossiers qui progressent le plus vite.",
                link="/analyse/diagnostic",
            ))
        return out

    # ─── 6.4 Comités ──────────────────────────────────────────────────────

    def _comites(self, b):
        """Qualité des décisions.

        Décisions : revues de comité verrouillées (la décision n'engage le dossier qu'une fois scellée) ;
        les brouillons sont signalés à part. Accord : recommandation calculée au scellement × décision,
        ramenées à l'échelle GO / CONDITIONAL GO / HOLD / NO-GO (BANKABLE CANDIDATE et APD READY valent
        GO) ; taux d'accord, kappa de Cohen, décisions plus favorables ou plus sévères que la méthode.
        Passages forcés : journal des passages. Délai de décision : ouverture du dossier → première
        décision verrouillée. Scores à la décision : instantané scellé."""
        locked = b.locked_reviews
        period_reviews = locked.filtered(lambda r: b.in_period(r.date))
        drafts = b.reviews.filtered(lambda r: r.state == "draft" and b.in_period(r.date))
        months = b.chart_months()
        counts = defaultdict(int)
        for r in locked:
            counts[(pf.month_key(r.date), r.decision)] += 1
        decisions = {
            "months": months,
            "series": [{"key": key, "label": DECISION_LABELS[key], "unit": "count",
                        "values": [counts[(m, key)] for m in months]} for key in DECISION_KEYS],
            "totals": {key: sum(1 for r in period_reviews if r.decision == key) for key in DECISION_KEYS},
        }
        pairs = [(_recommandation_scellee(r.recommendation, r.snapshot), r.decision) for r in period_reviews]
        ko_pending = sum(1 for r in period_reviews if r.recommendation == "no_go"
                         and _recommandation_scellee(r.recommendation, r.snapshot) == "pending")
        matrix = [[sum(1 for rec, dec in pairs if rec == rk and dec == dk) for dk in DECISION_KEYS]
                  for rk in RECOMMENDATION_KEYS]
        stats = pf.agreement(pairs)
        agreement = {
            "recommendations": RECOMMENDATION_KEYS, "decisions": DECISION_KEYS,
            "recommendation_labels": [RECOMMENDATION_LABELS[k] for k in RECOMMENDATION_KEYS],
            "decision_labels": [DECISION_LABELS[k] for k in DECISION_KEYS], "matrix": matrix,
            # Lecture de chaque case (accord, comité plus favorable ou plus sévère, hors calcul) : sept
            # recommandations face à cinq décisions, la diagonale de la matrice n'est pas l'accord.
            "matrix_kinds": [[pf.agreement_kind(rk, dk) for dk in DECISION_KEYS] for rk in RECOMMENDATION_KEYS],
            "agreement_pct": _r(stats["agreement_pct"]), "kappa": _r(stats["kappa"], 3), "n": stats["n"],
            "agreed": stats["agreed"], "lenient": stats["lenient"], "strict": stats["strict"],
            "excluded": len(pairs) - stats["n"],
        }
        passages = [(b.env["axispro.dossier"].browse(did), p) for did, rows in b.passages.items() for p in rows
                    if b.in_period(p["date"])]
        forced = [(d, p) for d, p in passages if p["forced"]]
        forced_rows = []
        for d, p in sorted(forced, key=lambda x: x[1]["date"], reverse=True):
            score = next((r.snapshot.get("readiness") for r in reversed(b.reviews)
                          if r.dossier_id == d and r.date <= p["date"] and r.snapshot), None)
            forced_rows.append({"dossier": d.reference, "dossier_id": d.id, "name": d.name, "gate": p["src"],
                                "to": p["dst"], "date": p["date"], "reason": p["reason"], "score": _r(score),
                                "link": _dossier_link(d)})
        forced_summary = {"count": len(forced), "passages": len(passages), "share_pct": _r(_share(len(forced), len(passages)))}
        first_decision = {}
        for r in locked:
            first_decision.setdefault(r.dossier_id.id, r)
        delays = []
        for r in first_decision.values():
            days = max((r.date - r.dossier_id.create_date.date()).days, 0)
            delays.append((r, days))
        recent = [(r, days) for r, days in delays if b.in_period(r.date)]
        by_month = defaultdict(list)
        for r, days in recent:
            by_month[pf.month_key(r.date)].append(days)
        time_to_decision = {
            "median_days": _r(pf.median([x for _r_, x in recent])), "p75_days": _r(pf.quantile([x for _r_, x in recent], 0.75)),
            "n": len(recent), "history_median_days": _r(pf.median([x for _r_, x in delays])), "history_n": len(delays),
            "by_month": [{"month": m, "days": _r(pf.median(by_month[m]))} for m in months if by_month.get(m)],
            "rows": [dict(_brief(r.dossier_id), date=r.date, days=days, decision=r.decision) for r, days in
                     sorted(recent, key=lambda x: -x[1])],
        }
        score_at_decision = []
        for key in DECISION_KEYS:
            subset = [r for r in period_reviews if r.decision == key]
            readiness = [(r.snapshot or {}).get("readiness") for r in subset]
            readiness = [x for x in readiness if x is not None]
            bank = [x for x in ((r.snapshot or {}).get("bankability") for r in subset) if x is not None]
            score_at_decision.append({
                "decision": key, "label": DECISION_LABELS[key], "n": len(subset), "scores": [_r(x) for x in readiness],
                "median": _r(pf.median(readiness)), "q1": _r(pf.quantile(readiness, 0.25)),
                "q3": _r(pf.quantile(readiness, 0.75)), "min": _r(min(readiness, default=None)),
                "max": _r(max(readiness, default=None)), "bankability_median": _r(pf.median(bank)),
            })
        actions = b.env["axispro.action"].search([("company_id", "=", b.company.id), ("source", "=", "committee"),
                                                  ("dossier_id", "in", b.dossiers.ids)])
        actions = actions.filtered(lambda a: a.create_date.date() <= b.date_to)
        open_actions = actions.filtered(lambda a: a.state in ACTION_OPEN)
        # Conditions en retard : celles des seuls dossiers actifs (suspendu ou clos : rien à relancer).
        late = open_actions.filtered(lambda a: a.is_overdue(b.date_to) and a.dossier_id.state == "open")
        decided = actions.filtered(lambda a: a.state != "cancelled")
        conditions = {"count": len(actions), "done": len(actions.filtered(lambda a: a.state == "done")),
                      "open": len(open_actions), "overdue": len(late),
                      "done_rate_pct": _r(_share(len(actions.filtered(lambda a: a.state == "done")), len(decided)))}
        favorable_ko = [r for r in period_reviews if r.decision in PASSING_DECISIONS and _knockouts_confirmes(r.snapshot)]
        notes = []
        if drafts:
            notes.append((f"{_n(len(drafts), 'revue de comité', 'revues de comité')} de la période non verrouillée(s) : "
                          "hors analyse des décisions.", 10 * len(drafts) / (len(drafts) + len(period_reviews))))
        missing = period_reviews.filtered(lambda r: not r.recommendation)
        if missing:
            notes.append((f"{_n(len(missing), 'décision')} sans recommandation calculée.", 10))
        if ko_pending:
            notes.append((f"{_n(ko_pending, 'décision écartée', 'décisions écartées')} de l'accord : le NO-GO de la "
                          "méthode n'y tenait qu'à des knock-outs non encore évalués.", 5))
        if not period_reviews:
            notes.append(("Aucune décision de comité verrouillée sur la période.", 0))
        candidates = self._comites_insights(b, agreement, forced_summary, forced_rows, time_to_decision,
                                            score_at_decision, conditions, late, favorable_ko)
        return {
            "decisions": decisions, "agreement": agreement, "forced_gates": forced_rows,
            "forced_summary": forced_summary, "time_to_decision": time_to_decision,
            "score_at_decision": score_at_decision, "conditions": conditions,
            "favorable_with_knockout": [dict(_brief(r.dossier_id), review_id=r.id, date=r.date, decision=r.decision,
                                             knockouts=[k.get("code") for k in r.snapshot.get("knockouts", [])])
                                        for r in favorable_ko],
            "_insights": candidates, "_notes": notes,
        }

    def _comites_insights(self, b, agreement, forced_summary, forced_rows, time_to_decision, score_at_decision,
                          conditions, late, favorable_ko):
        out = []
        n = agreement["n"]
        rate = agreement["agreement_pct"]
        if n >= 3 and rate is not None:
            kappa = agreement["kappa"]
            kappa_text = f", kappa de Cohen {_fr(kappa, 2)}" if kappa is not None else ""
            if rate < 70:
                lenient = agreement["lenient"] >= agreement["strict"]
                out.append(insight(
                    "cabinet.accord_methode", "comites", "high" if rate < 50 else "medium",
                    f"Le comité s'écarte de la méthode dans {pct(100 - rate, 0)} des décisions",
                    f"Sur {n} décisions comparables, {agreement['agreed']} "
                    f"{'suit' if agreement['agreed'] < 2 else 'suivent'} la recommandation calculée ; le comité "
                    f"a été plus favorable que la méthode {agreement['lenient']} fois et plus sévère {agreement['strict']} "
                    f"fois{kappa_text}.",
                    metric={"label": "Taux d'accord", "value": rate, "unit": "pct", "reference": 70.0,
                            "reference_label": "Seuil de vigilance"},
                    confidence=_confidence(n),
                    method="Recommandation scellée au verrouillage × décision du comité, sur l'échelle GO / CONDITIONAL GO "
                           "/ HOLD / NO-GO (BANKABLE CANDIDATE et APD READY valent GO) ; kappa de Cohen : accord au-delà "
                           "du hasard.",
                    evidence={"type": "table", "data": {
                        "columns": ["Recommandation"] + agreement["decision_labels"],
                        "rows": [[agreement["recommendation_labels"][i]] + row for i, row in enumerate(agreement["matrix"])
                                 if any(row)]}},
                    action=("Motiver par écrit chaque décision plus favorable que la méthode et, si l'écart persiste, "
                            "revoir les seuils de la politique d'évaluation." if lenient else
                            "Vérifier que la grille ne surévalue pas les dossiers : critères ou seuils trop souples."),
                    link="/analyse/comites",
                ))
            elif rate >= 85:
                out.append(insight(
                    "cabinet.accord_methode", "comites", "positive",
                    f"Les décisions du comité suivent la méthode dans {pct(rate, 0)} des cas",
                    f"{agreement['agreed']} décisions sur {n} concordent avec la recommandation calculée{kappa_text}.",
                    metric={"label": "Taux d'accord", "value": rate, "unit": "pct", "reference": 85.0,
                            "reference_label": "Cible"},
                    confidence=_confidence(n), method="Recommandation scellée × décision du comité ; kappa de Cohen.",
                    action="Maintenir la motivation écrite des rares écarts.", link="/analyse/comites",
                ))
        for r in favorable_ko[:2]:
            d = r.dossier_id
            out.append(insight(
                f"cabinet.decision_ko.{r.id}", "comites", "critical",
                f"Décision {DECISION_LABELS[r.decision]} sur {d.reference} malgré un knock-out actif",
                f"Le comité du {r.date:%d/%m/%Y} a rendu une décision favorable alors que l'instantané scellé portait "
                f"{_n(_knockouts_confirmes(r.snapshot), 'knock-out constaté', 'knock-outs constatés')}.",
                metric={"label": "Knock-outs à la décision", "value": _knockouts_confirmes(r.snapshot),
                        "unit": "count", "reference": 0, "reference_label": "Règle de la méthode"},
                impact_gnf=b.need(d), confidence=0.95,
                method="Instantané scellé de la revue de comité : knock-outs actifs au verrouillage, sur des critères "
                       "évalués (un critère pas encore évalué n'est pas un knock-out constaté).",
                action="Faire lever le knock-out avant tout engagement auprès d'un financeur, ou motiver la dérogation.",
                link=_dossier_link(d),
            ))
        if forced_summary["count"] and (forced_summary["share_pct"] or 0) >= 10:
            dossiers = b.env["axispro.dossier"].browse([x["dossier_id"] for x in forced_rows])
            out.append(insight(
                "cabinet.passages_forces", "comites", "high" if forced_summary["share_pct"] >= 25 else "medium",
                f"{_n(forced_summary['count'], 'passage de gate forcé', 'passages de gate forcés')} sur la période",
                f"Soit {pct(forced_summary['share_pct'])} des {forced_summary['passages']} passages ({_refs(dossiers)}). "
                + (f"Motif le plus récent : « {forced_rows[0]['reason']} »." if forced_rows and forced_rows[0]["reason"] else ""),
                metric={"label": "Part des passages forcés", "value": forced_summary["share_pct"], "unit": "pct",
                        "reference": 10.0, "reference_label": "Seuil de vigilance"},
                impact_gnf=sum(b.need(d) for d in dossiers), confidence=_confidence(forced_summary["passages"]),
                method="Passages de gate inscrits au journal comme forcés (décision du gate ni GO ni CONDITIONAL GO).",
                action="Soumettre tout passage forcé au comité et suivre la levée des écarts qui l'ont motivé.",
                link=_dossier_link(dossiers[0]) if len(dossiers) == 1 else "/analyse/comites",
            ))
        median = time_to_decision["median_days"]
        if median is not None and time_to_decision["n"] >= 2:
            if median > DECISION_TARGET_DAYS:
                out.append(insight(
                    "cabinet.delai_decision", "comites", "medium",
                    f"{_days(median)} en médiane avant la première décision du comité",
                    f"Mesuré sur {_n(time_to_decision['n'], 'dossier')} décidé(s) pour la première fois sur la période.",
                    metric={"label": "Délai médian", "value": median, "unit": "days",
                            "reference": float(DECISION_TARGET_DAYS), "reference_label": "Cible"},
                    confidence=_confidence(time_to_decision["n"]),
                    method="Ouverture du dossier → première revue de comité verrouillée.",
                    action="Inscrire chaque dossier au comité dès la préqualification achevée.", link="/analyse/comites",
                ))
        if late:
            dossiers = late.dossier_id
            out.append(insight(
                "cabinet.conditions_en_retard", "comites", "high",
                f"{_n(len(late), 'condition du comité non levée', 'conditions du comité non levées')} à l'échéance",
                f"Conditions posées par le comité et levées : {conditions['done']} sur {conditions['count']} ; en "
                f"retard : {_refs(dossiers)}.",
                metric={"label": "Conditions levées", "value": conditions["done_rate_pct"] or 0, "unit": "pct",
                        "reference": 100.0, "reference_label": "Cible"},
                impact_gnf=sum(b.need(d) for d in dossiers), confidence=0.9,
                method="Actions issues des conditions des revues de comité verrouillées, ouvertes et échues.",
                action="Relancer les porteurs et réinscrire les dossiers concernés au prochain comité.",
                link=_dossier_link(dossiers[0]) if len(dossiers) == 1 else "/analyse/risques",
            ))
        go = next(x for x in score_at_decision if x["decision"] == "go")
        if go["n"] >= 2 and go["median"] is not None and go["median"] < b.thresholds["conditional"]:
            out.append(insight(
                "cabinet.go_faible_score", "comites", "medium",
                "Des GO sont accordés sur des scores faibles",
                f"Readiness médian des décisions GO : {_fr(go['median'], 1)}/100, sous le seuil CONDITIONAL GO de la "
                f"politique ({_fr(b.thresholds['conditional'], 0)}).",
                metric={"label": "Readiness médian des GO", "value": go["median"], "unit": "score",
                        "reference": b.thresholds["conditional"], "reference_label": "Seuil CONDITIONAL GO"},
                confidence=_confidence(go["n"]), method="Instantanés scellés des décisions GO de la période.",
                action="Réserver le GO aux dossiers au-dessus du seuil ; sinon, CONDITIONAL GO avec conditions datées.",
                link="/analyse/comites",
            ))
        return out

    # ─── 6.5 Financements ─────────────────────────────────────────────────

    def _financements(self, b):
        """Financements recherchés.

        Flux : secteur → type de financeur (déduit de l'instrument : prêt et crédit-bail → banques ;
        participation et quasi-fonds propres → investisseurs ; subvention → bailleurs ; garantie,
        microfinance) → état (identifié, en instruction, accord, obtenu, refusé ou abandonné), en montants
        sollicités. Par financeur : taux de succès sur les demandes tranchées (obtenues / obtenues +
        refusées, abandons exclus), ticket moyen obtenu, délai dépôt → décision. Couverture : montants
        obtenus et en cours rapportés au besoin de financement de chaque dossier."""
        fundings = b.env["axispro.funding"].search([("company_id", "=", b.company.id),
                                                     ("dossier_id", "in", b.dossiers.ids)])
        fundings = fundings.filtered(lambda f: f.create_date.date() <= b.date_to)
        nodes, links = {}, defaultdict(float)
        for f in fundings:
            sector = (f.dossier_id.sector or "").strip() or "Non renseigné"
            ftype, flabel = FUNDER_TYPES.get(f.instrument, FUNDER_TYPES["other"])
            stage, slabel = FUNDING_STAGES[f.state]
            ids = (f"sector:{sector}", f"funder:{ftype}", f"state:{stage}")
            nodes.setdefault(ids[0], {"id": ids[0], "label": sector, "group": "sector"})
            nodes.setdefault(ids[1], {"id": ids[1], "label": flabel, "group": "funder"})
            nodes.setdefault(ids[2], {"id": ids[2], "label": slabel, "group": "state"})
            amount = f.amount_requested or f.amount_granted
            links[(ids[0], ids[1])] += amount
            links[(ids[1], ids[2])] += amount
        flows = {"nodes": list(nodes.values()),
                 "links": [{"source": s, "target": t, "value": round(v)} for (s, t), v in links.items() if v]}

        def delay(f):
            if f.date_submitted and f.date_decision and f.date_decision >= f.date_submitted:
                return (f.date_decision - f.date_submitted).days
            return None

        by_funder = []
        for funder in fundings.funder_id:
            subset = fundings.filtered(lambda f, p=funder: f.funder_id == p)
            won = subset.filtered(lambda f: f.state in FUNDING_WON)
            lost = subset.filtered(lambda f: f.state == "rejected")
            delays = [x for x in (delay(f) for f in won | lost) if x is not None]
            types = {FUNDER_TYPES.get(f.instrument, FUNDER_TYPES["other"])[1] for f in subset}
            requested_won = sum(won.mapped("amount_requested"))
            by_funder.append({
                "key": str(funder.id), "id": funder.id, "label": funder.name, "type": ", ".join(sorted(types)),
                "count": len(subset), "requested": round(sum(subset.mapped("amount_requested"))),
                "granted": round(sum(won.mapped("amount_granted"))), "won": len(won), "decided": len(won) + len(lost),
                "open": len(subset.filtered(lambda f: f.state in FUNDING_OPEN)),
                "success_pct": _r(_share(len(won), len(won) + len(lost))),
                "avg_ticket": round(sum(won.mapped("amount_granted")) / len(won)) if won else None,
                "avg_days": _r(pf.mean(delays)), "median_days": _r(pf.median(delays)),
                "granted_vs_requested_pct": _r(_share(sum(won.mapped("amount_granted")), requested_won)),
            })
        by_funder.sort(key=lambda x: (-x["requested"], x["label"]))
        won_all = fundings.filtered(lambda f: f.state in FUNDING_WON)
        lost_all = fundings.filtered(lambda f: f.state == "rejected")
        success = _share(len(won_all), len(won_all) + len(lost_all))
        open_all = fundings.filtered(lambda f: f.state in FUNDING_OPEN)
        pipeline = []
        for key, label in FUNDING_STATES:
            subset = fundings.filtered(lambda f, k=key: f.state == k)
            pipeline.append({"state": key, "label": label, "count": len(subset),
                             "amount": round(sum(subset.mapped("amount_requested"))),
                             "granted": round(sum(subset.mapped("amount_granted")))})
        coverage_rows = []
        for d in b.live:
            subset = fundings.filtered(lambda f, x=d: f.dossier_id == x)
            need = b.need(d)
            granted = sum(subset.filtered(lambda f: f.state in FUNDING_WON).mapped("amount_granted"))
            pending = sum(subset.filtered(lambda f: f.state in FUNDING_OPEN).mapped("amount_requested"))
            coverage_rows.append(dict(
                _brief(d), need=round(need), granted=round(granted), open_requested=round(pending),
                coverage_pct=_r(_share(granted, need)), gap=round(max(need - granted - pending, 0)),
                probability=round(b.probability(d), 3), funders=len(subset.funder_id),
                recommendation=b.result(d)[1]["recommendation"], link=_dossier_link(d)))
        total_need = sum(b.need(d) for d in b.live)
        live_ids = set(b.live.ids)
        granted_live = sum(f.amount_granted for f in won_all if f.dossier_id.id in live_ids)
        open_live = sum(f.amount_requested for f in open_all if f.dossier_id.id in live_ids)
        coverage = {
            "need": round(total_need), "granted": round(granted_live), "open_requested": round(open_live),
            "coverage_pct": _r(_share(granted_live, total_need)),
            "uncovered": round(max(total_need - granted_live - open_live, 0)),
            "expected_gnf": round(open_live * success / 100) if success is not None else None,
            "success_pct": _r(success), "rows": sorted(coverage_rows, key=lambda x: -x["gap"]),
        }
        # Relances : démarches des seuls dossiers actifs (un dossier suspendu ou clos ne se relance pas).
        follow_ups = open_all.filtered(lambda f: f.next_date and f.next_date < b.date_to
                                       and f.dossier_id.state == "open").sorted("next_date")
        stale = open_all.filtered(lambda f: f.state in ("submitted", "review") and f.state_date
                                  and (b.date_to - f.state_date).days > STALE_FUNDING_DAYS)
        notes = []
        no_amount = fundings.filtered(lambda f: not f.amount_requested and f.state not in FUNDING_WON)
        if no_amount:
            notes.append((f"{_n(len(no_amount), 'demande de financement', 'demandes de financement')} sans montant "
                          "sollicité.", 20 * len(no_amount) / len(fundings)))
        no_next = open_all.filtered(lambda f: not f.next_date)
        if no_next:
            notes.append((f"{_n(len(no_next), 'demande en cours', 'demandes en cours')} sans relance planifiée.",
                          10 * len(no_next) / len(open_all)))
        if not fundings:
            notes.append(("Aucune recherche de financement enregistrée.", 0))
        candidates = self._financements_insights(b, fundings, by_funder, coverage, coverage_rows, success, won_all,
                                                 lost_all, follow_ups, stale)
        return {
            "flows": flows, "by_funder": by_funder, "pipeline": pipeline, "coverage": coverage,
            "follow_ups": [dict(_brief(f.dossier_id), funding_id=f.id, funder=f.funder_id.name, state=f.state,
                                amount=round(f.amount_requested), next_date=f.next_date, next_step=f.next_step or None,
                                days_late=(b.date_to - f.next_date).days, link=_dossier_link(f.dossier_id))
                           for f in follow_ups],
            "_insights": candidates, "_notes": notes,
        }

    def _financements_insights(self, b, fundings, by_funder, coverage, rows, success, won, lost, follow_ups, stale):
        out = []
        Dossier = b.env["axispro.dossier"]
        orphans = [x for x in rows if x["funders"] == 0 and x["need"]
                   and (x["probability"] >= 0.5 or x["recommendation"] in ("bankable", "apd_ready"))]
        for x in sorted(orphans, key=lambda x: -x["need"])[:2]:
            out.append(insight(
                f"cabinet.sans_financeur.{x['id']}", "financements", "high",
                f"{x['reference']} est prêt mais aucun financeur n'est sollicité",
                f"{x['name']} : probabilité de bancabilité de {pct(x['probability'] * 100, 0)} pour "
                f"{gnf(x['need'])} de besoin de financement, sans aucune demande enregistrée.",
                metric={"label": "Probabilité de bancabilité", "value": round(x["probability"] * 100, 1), "unit": "pct",
                        "reference": 50.0, "reference_label": "Seuil"},
                impact_gnf=x["need"], confidence=0.8,
                method="Dossiers du portefeuille de probabilité au moins égale à 50 % (ou recommandés BANKABLE "
                       "CANDIDATE ou APD READY) sans recherche de financement enregistrée.",
                action="Identifier deux ou trois financeurs adaptés à l'instrument recherché et leur soumettre le "
                       "dossier.",
                link=_dossier_link(Dossier.browse(x["id"])),
            ))
        if follow_ups:
            amount = sum(follow_ups.mapped("amount_requested"))
            oldest = follow_ups[0]
            out.append(insight(
                "cabinet.relances", "financements", "medium",
                f"{_n(len(follow_ups), 'relance de financeur en retard', 'relances de financeurs en retard')}",
                f"{gnf(amount)} de demandes attendent une relance planifiée ; la plus ancienne : {oldest.funder_id.name} "
                f"pour {oldest.dossier_id.reference}, prévue le {oldest.next_date:%d/%m/%Y}.",
                metric={"label": "Retard maximal", "value": (b.date_to - oldest.next_date).days, "unit": "days",
                        "reference": 0, "reference_label": "Cible"},
                impact_gnf=amount, confidence=0.9,
                method="Demandes en cours dont la date de relance prévue est passée.",
                action="Relancer les financeurs concernés et replanifier la prochaine étape.",
                link=_dossier_link(oldest.dossier_id) if len(follow_ups) == 1 else "/analyse/financements",
            ))
        if stale:
            amount = sum(stale.mapped("amount_requested"))
            out.append(insight(
                "cabinet.instruction_longue", "financements", "medium",
                f"{_n(len(stale), 'demande en instruction', 'demandes en instruction')} depuis plus de "
                f"{STALE_FUNDING_DAYS} jours",
                f"{gnf(amount)} sollicités sans évolution de l'état depuis plus de {STALE_FUNDING_DAYS} jours "
                f"({_refs(stale.dossier_id)}).",
                metric={"label": "Demandes figées", "value": len(stale), "unit": "count", "reference": 0,
                        "reference_label": "Cible"},
                impact_gnf=amount, confidence=0.8,
                method="Demandes déposées ou en instruction dont l'étape n'a pas changé depuis 90 jours.",
                action="Obtenir du financeur un calendrier de décision ; à défaut, ouvrir une alternative.",
                link="/analyse/financements",
            ))
        decided = len(won) + len(lost)
        if decided >= 3 and success is not None:
            if success < 34:
                out.append(insight(
                    "cabinet.taux_succes", "financements", "high",
                    f"Seules {pct(success, 0)} des demandes tranchées aboutissent",
                    f"{len(won)} financement(s) obtenu(s) pour {len(lost)} refus.",
                    metric={"label": "Taux de succès", "value": success, "unit": "pct", "reference": 50.0,
                            "reference_label": "Repère"},
                    confidence=_confidence(decided),
                    method="Demandes obtenues / (obtenues + refusées) ; abandons et demandes en cours exclus.",
                    action="Analyser les motifs de refus avec les financeurs et ne soumettre que des dossiers au-dessus "
                           "du seuil Bankability.",
                    link="/analyse/financements",
                ))
            elif success >= 60:
                out.append(insight(
                    "cabinet.taux_succes", "financements", "positive",
                    f"{pct(success, 0)} des demandes tranchées aboutissent",
                    f"{len(won)} financement(s) obtenu(s) pour {len(lost)} refus, {gnf(sum(won.mapped('amount_granted')))} "
                    "accordés.",
                    metric={"label": "Taux de succès", "value": success, "unit": "pct", "reference": 50.0,
                            "reference_label": "Repère"},
                    impact_gnf=sum(won.mapped("amount_granted")), confidence=_confidence(decided),
                    method="Demandes obtenues / (obtenues + refusées) ; abandons et demandes en cours exclus.",
                    action="Capitaliser sur les financeurs les plus réceptifs pour les prochains dossiers.",
                    link="/analyse/financements",
                ))
        best = [x for x in by_funder if x["won"] and x["decided"] >= 1]
        if best:
            top = max(best, key=lambda x: (x["granted"], x["success_pct"] or 0))
            out.append(insight(
                f"cabinet.financeur_cle.{top['id']}", "financements", "positive",
                f"{top['label']} est le premier financeur du portefeuille",
                f"{gnf(top['granted'])} accordés sur {top['won']} demande(s) obtenue(s), taux de succès de "
                f"{pct(top['success_pct'], 0)}" + (f", décision en {_days(top['median_days'])} en médiane." if top["median_days"] is not None else "."),
                metric={"label": "Montant accordé", "value": top["granted"], "unit": "gnf", "reference": None,
                        "reference_label": None},
                impact_gnf=top["granted"], confidence=_confidence(top["decided"]),
                method="Montants accordés (conventions signées et décaissements) par financeur.",
                action="Présenter en priorité à ce financeur les dossiers de même profil.",
                link="/analyse/financements",
            ))
        if coverage["need"] and coverage["uncovered"] > 0 and coverage["coverage_pct"] is not None \
                and coverage["coverage_pct"] < 30:
            out.append(insight(
                "cabinet.couverture", "financements", "info",
                f"{pct(coverage['coverage_pct'])} du besoin de financement est couvert",
                f"{gnf(coverage['granted'])} obtenus et {gnf(coverage['open_requested'])} en cours de sollicitation pour "
                f"{gnf(coverage['need'])} de besoin ; {gnf(coverage['uncovered'])} restent sans financeur identifié.",
                metric={"label": "Besoin couvert", "value": coverage["coverage_pct"], "unit": "pct", "reference": None,
                        "reference_label": None},
                impact_gnf=coverage["uncovered"], confidence=0.75,
                method="Montants obtenus et demandes en cours rapportés au besoin de financement des dossiers du "
                       "portefeuille.",
                action="Élargir la prospection aux financeurs non encore sollicités pour les dossiers sans couverture.",
                link="/analyse/financements",
            ))
        return out

    # ─── 6.6 Activité et honoraires ───────────────────────────────────────

    def _standard_rate(self, b, sheets):
        """Taux horaire standard : paramètre système, à défaut taux moyen des factures d'honoraires
        validées des 12 derniers mois (montant hors taxes / heures facturées)."""
        raw = b.env["ir.config_parameter"].sudo().get_param(PARAM_HOURLY_RATE) or ""
        try:
            value = float(str(raw).replace(" ", "").replace(",", "."))
        except ValueError:
            value = 0.0
        if value > 0:
            return value, "parameter"
        year_ago = b.date_to - relativedelta(years=1)
        invoices = sheets.invoice_id.filtered(
            lambda m: _billed(m) and m.invoice_date and year_ago < m.invoice_date <= b.date_to)
        hours = sum(sheets.filtered(lambda t: t.invoice_id in invoices).mapped("hours"))
        amount = sum(_net_billed(b.env, invoices, b.date_to).values())
        if hours and amount > 0:
            return amount / hours, "derived"
        return None, None

    def _cost_ratio(self, b):
        raw = b.env["ir.config_parameter"].sudo().get_param(PARAM_COST_RATIO) or ""
        try:
            value = float(str(raw).replace(",", "."))
        except ValueError:
            value = 0.0
        return value if 0 < value <= 1.5 else COST_RATIO_DEFAULT

    def _income_lines(self, b, xmlid):
        """Produits (comptes 70) par compte analytique d'un axe et par jour, jusqu'à la date d'arrêté."""
        plan = b.env.ref(xmlid, raise_if_not_found=False)
        if not plan:
            return []
        column = plan.sudo()._column_name()
        code = ACC_CODE.replace("aml.", "aal.")
        b.env.flush_all()
        b.env.cr.execute(
            f"""SELECT aal.{column}, aal.date, COALESCE(SUM(aal.amount), 0)
                  FROM account_analytic_line aal
                  JOIN account_account aa ON aa.id = aal.general_account_id
                 WHERE aal.company_id = %(company)s AND aal.date <= %(date_to)s AND aal.{column} IS NOT NULL
                   AND {code} LIKE '70%%'
              GROUP BY 1, 2""",
            {"company": b.company.id, "date_to": b.date_to},
        )
        return [(account_id, day, float(amount)) for account_id, day, amount in b.env.cr.fetchall()]

    def _revenue_by_month(self, b, start):
        b.env.flush_all()
        b.env.cr.execute(
            f"""SELECT to_char(date_trunc('month', aml.date), 'YYYY-MM'), COALESCE(SUM(aml.balance), 0)
                  FROM account_move_line aml
                  JOIN account_account aa ON aa.id = aml.account_id
                 WHERE aml.parent_state = 'posted' AND aml.company_id = %(company)s
                   AND aml.date >= %(start)s AND aml.date <= %(end)s AND {ACC_CODE} LIKE '70%%'
              GROUP BY 1""",
            {"company": b.company.id, "start": start, "end": b.date_to},
        )
        return {month: -float(amount) for month, amount in b.env.cr.fetchall()}

    def _receivables_by_client(self, b, limit=8):
        b.env.flush_all()
        b.env.cr.execute(
            """SELECT aml.partner_id, COALESCE(SUM(aml.amount_residual), 0),
                      COALESCE(SUM(CASE WHEN aml.date_maturity < %(day)s THEN aml.amount_residual END), 0),
                      MIN(CASE WHEN aml.date_maturity < %(day)s AND aml.amount_residual > 0 THEN aml.date_maturity END)
                 FROM account_move_line aml
                 JOIN account_account aa ON aa.id = aml.account_id
                WHERE aml.parent_state = 'posted' AND aml.company_id = %(company)s
                  AND aa.account_type = 'asset_receivable' AND NOT aml.reconciled AND aml.date <= %(day)s
             GROUP BY 1 HAVING SUM(aml.amount_residual) > 0
             ORDER BY 2 DESC LIMIT %(limit)s""",
            {"company": b.company.id, "day": b.date_to, "limit": limit},
        )
        rows = b.env.cr.fetchall()
        partners = b.env["res.partner"].sudo().browse([r[0] for r in rows if r[0]])
        names = {p.id: p.name for p in partners}
        return [{"partner_id": pid, "name": names.get(pid, "Sans tiers"), "open": round(float(total)),
                 "overdue": round(float(overdue)),
                 "days_overdue": (b.date_to - oldest).days if oldest else 0} for pid, total, overdue, oldest in rows]

    def _activite(self, b):
        """Activité et honoraires.

        - Valeur du temps = heures × taux standard ; honoraires facturés d'une heure = montant hors taxes
          de sa facture validée (non contrepassée) / heures de la facture (forfaits compris) ; taux de
          réalisation = facturé / valeur du temps de la période (temps non facturable compris) ; carnet =
          temps facturable non encore facturé (ou en facture brouillon) × taux standard.
        - Rentabilité d'un dossier : honoraires comptabilisés sur son compte analytique (comptes 70) moins
          coût du temps (heures × taux standard × taux de revient), sur la période et depuis l'ouverture.
        - Chiffre d'affaires par ligne de service : axe Activité des écritures validées (comptes 70) ;
          « non imputé » = chiffre d'affaires de la société sans activité.
        - Prévision : honoraires mensuels prolongés de trois mois par forecast_series."""
        env, company = b.env, b.company
        sheets = env["axispro.timesheet"].search([("company_id", "=", company.id), ("date", "<=", b.date_to)])
        period_sheets = sheets.filtered(lambda t: b.in_period(t.date))
        rate, rate_source = self._standard_rate(b, sheets)
        ratio = self._cost_ratio(b)
        invoices = sheets.invoice_id.filtered(_billed)
        invoice_hours = defaultdict(float)
        for t in sheets.filtered(lambda t: t.invoice_id in invoices):
            invoice_hours[t.invoice_id.id] += t.hours
        net = _net_billed(env, invoices, b.date_to)
        effective = {m.id: net[m.id] / invoice_hours[m.id] for m in invoices if invoice_hours[m.id]}

        def billed_value(t):
            return t.hours * effective.get(t.invoice_id.id, 0.0) if t.invoice_id in invoices else 0.0

        def unbilled(t):
            # « À facturer », la définition d'AxisPro : temps facturable encore rattaché à aucune facture. Le
            # temps d'une facture annulée, contrepassée ou en brouillon n'y est pas : il ne se refacture pas
            # tant que la facture le garde (signalé dans la fiabilité des données).
            return t.billable and not t.invoice_id

        def blank():
            return {"hours": 0.0, "billable_hours": 0.0, "billed": 0.0, "billed_hours": 0.0, "wip_hours": 0.0,
                    "non_billable_hours": 0.0}

        by_dossier, by_user = defaultdict(blank), defaultdict(blank)
        for t in period_sheets:
            for acc in (by_dossier[t.dossier_id], by_user[t.user_id]):
                acc["hours"] += t.hours
                acc["billable_hours"] += t.hours if t.billable else 0.0
                acc["non_billable_hours"] += 0.0 if t.billable else t.hours
                acc["billed"] += billed_value(t)
                acc["billed_hours"] += t.hours if t.invoice_id in invoices else 0.0
                acc["wip_hours"] += t.hours if unbilled(t) else 0.0
        hours = sum(period_sheets.mapped("hours"))
        billed = sum(billed_value(t) for t in period_sheets)
        billed_hours = sum(t.hours for t in period_sheets if t.invoice_id in invoices)
        value = hours * rate if rate else None
        wip_hours = sum(t.hours for t in period_sheets if unbilled(t))
        non_billable = sum(t.hours for t in period_sheets if not t.billable)

        def realization(acc):
            v = acc["hours"] * rate if rate else None
            return v, _share(acc["billed"], v) if v else None

        realization_rows = []
        for d, acc in by_dossier.items():
            v, rp = realization(acc)
            realization_rows.append(dict(_brief(d), hours=_r(acc["hours"]), billable_hours=_r(acc["billable_hours"]),
                                         value=round(v) if v is not None else None, billed=round(acc["billed"]),
                                         realization_pct=_r(rp), wip_hours=_r(acc["wip_hours"]), link=_dossier_link(d)))
        realization_rows.sort(key=lambda x: (-(x["value"] or 0), x["reference"] or ""))
        consultants = []
        for user, acc in by_user.items():
            v, rp = realization(acc)
            consultants.append({"id": user.id, "name": user.name, "hours": _r(acc["hours"]),
                                "billable_hours": _r(acc["billable_hours"]), "value": round(v) if v is not None else None,
                                "billed": round(acc["billed"]), "realization_pct": _r(rp),
                                "effective_rate": round(acc["billed"] / acc["hours"]) if acc["hours"] else None})
        consultants.sort(key=lambda x: (-x["hours"], x["name"]))

        weeks = pf.week_keys(b.date_from, b.date_to, limit=53)
        week_hours = defaultdict(float)
        for t in period_sheets:
            week_hours[(t.user_id.name, pf.week_start(t.date).isoformat())] += t.hours
        names = [c["name"] for c in consultants]
        time = {
            "consultants": names, "weeks": weeks,
            "cells": [{"consultant": n, "week": w, "hours": _r(week_hours.get((n, w), 0.0))} for n in names for w in weeks],
            "by_dossier": [{k: x[k] for k in ("id", "reference", "name", "hours", "billable_hours")}
                           for x in sorted(realization_rows, key=lambda x: -(x["hours"] or 0))],
            "by_service": [{"key": SERVICE_KEYS[name], "label": name, "hours": _r(hours if name == PROJECT_ACTIVITY else 0.0)}
                           for name in CABINET_ACTIVITIES],
            # Par semaine et par consultant : le total de l'équipe divisé par les consultants qui ont saisi du
            # temps sur la période (et non le total de l'équipe).
            "hours_per_week": _r(hours / len(weeks) / len(period_sheets.user_id)) if weeks and period_sheets else None,
        }
        realization_block = {
            "overall_pct": _r(_share(billed, value)) if value else None, "standard_rate": round(rate) if rate else None,
            "rate_source": rate_source, "effective_rate": round(billed / hours) if hours else None,
            "billed_rate": round(billed / billed_hours) if billed_hours else None,
            "hours": _r(hours), "value": round(value) if value is not None else None, "billed": round(billed),
            "wip_hours": _r(wip_hours), "wip_value": round(wip_hours * rate) if rate else None,
            "non_billable_hours": _r(non_billable), "non_billable_value": round(non_billable * rate) if rate else None,
            "by_dossier": realization_rows, "by_consultant": consultants,
        }

        dossier_lines = self._income_lines(b, "eguitra_base.analytic_plan_dossier")
        dossiers_by_account = {d.analytic_account_id.id: d for d in b.dossiers if d.analytic_account_id}
        fees_period, fees_ltd = defaultdict(float), defaultdict(float)
        for account_id, day, amount in dossier_lines:
            d = dossiers_by_account.get(account_id)
            if d:
                fees_ltd[d.id] += amount
                if b.in_period(day):
                    fees_period[d.id] += amount
        hours_ltd = defaultdict(float)
        for t in sheets:
            hours_ltd[t.dossier_id.id] += t.hours
        hours_period = {d.id: acc["hours"] for d, acc in by_dossier.items()}
        cost_rate = rate * ratio if rate else None
        profit_rows = []
        for d in b.dossiers:
            if not (fees_ltd.get(d.id) or hours_ltd.get(d.id)):
                continue
            fees, fees_all = fees_period.get(d.id, 0.0), fees_ltd.get(d.id, 0.0)
            cost = hours_period.get(d.id, 0.0) * cost_rate if cost_rate else None
            cost_all = hours_ltd.get(d.id, 0.0) * cost_rate if cost_rate else None
            margin = fees - cost if cost is not None else None
            margin_all = fees_all - cost_all if cost_all is not None else None
            profit_rows.append(dict(
                _brief(d), consultant=d.consultant_id.name or None, fees=round(fees), hours=_r(hours_period.get(d.id, 0.0)),
                cost=round(cost) if cost is not None else None, margin=round(margin) if margin is not None else None,
                margin_pct=_r(_share(margin, fees)) if margin is not None and fees else None, fees_ltd=round(fees_all),
                hours_ltd=_r(hours_ltd.get(d.id, 0.0)), cost_ltd=round(cost_all) if cost_all is not None else None,
                margin_ltd=round(margin_all) if margin_all is not None else None,
                margin_ltd_pct=_r(_share(margin_all, fees_all)) if margin_all is not None and fees_all else None,
                link=_dossier_link(d)))
        profit_rows.sort(key=lambda x: (x["margin_ltd"] if x["margin_ltd"] is not None else 0, x["reference"] or ""))

        months = b.chart_months()
        start = min(b.date_from, b.date_to.replace(day=1) - relativedelta(months=23))
        activity_lines = self._income_lines(b, "eguitra_base.analytic_plan_activite")
        accounts = env["account.analytic.account"].sudo().browse(sorted({a for a, _d, _m in activity_lines}))
        account_names = {a.id: a.name for a in accounts}
        service_month, service_period = defaultdict(float), defaultdict(float)
        for account_id, day, amount in activity_lines:
            name = account_names.get(account_id)
            key = SERVICE_KEYS.get(name, "autres")
            service_month[(key, pf.month_key(day))] += amount
            if b.in_period(day):
                service_period[key] += amount
        totals = self._revenue_by_month(b, start.replace(day=1))
        period_total = self._revenue_period(b, b.date_from, b.date_to)
        previous_total = self._revenue_period(b, b.prev_from, b.prev_to)
        keys = [(SERVICE_KEYS[n], n) for n in CABINET_ACTIVITIES] + [("autres", "Autres activités")]
        series = []
        for key, label in keys:
            values = [round(service_month.get((key, m), 0.0)) for m in months]
            if key in SERVICE_KEYS.values() or any(values):
                series.append({"key": key, "label": label, "unit": "gnf", "values": values})
        assigned = {m: sum(service_month.get((k, m), 0.0) for k, _l in keys) for m in months}
        unassigned = [round(totals.get(m, 0.0) - assigned[m]) for m in months]
        if any(abs(v) >= 1 for v in unassigned):
            series.append({"key": "non_impute", "label": "Sans activité", "unit": "gnf", "values": unassigned})
        unassigned_period = period_total - sum(service_period.values())
        by_service = []
        for key, label in keys:
            revenue = service_period.get(key, 0.0)
            service_hours = hours if key == "projets" else 0.0
            cost = service_hours * cost_rate if cost_rate and key == "projets" else None
            if revenue or key in SERVICE_KEYS.values():
                by_service.append({"key": key, "label": label, "revenue": round(revenue), "hours": _r(service_hours),
                                   "cost": round(cost) if cost is not None else None,
                                   "margin": round(revenue - cost) if cost is not None else None,
                                   "margin_pct": _r(_share(revenue - cost, revenue)) if cost is not None and revenue else None,
                                   "share_pct": _r(_share(revenue, period_total))})
        metrics = env["eguitra.finance.metrics"]
        receivables = metrics.open_items(company, "asset_receivable", b.date_to)
        # DSO de la finance (working_capital) : créances TTC / ventes TTC des douze derniers mois × jours, et
        # non rapportées au chiffre d'affaires hors taxes (18 % de trop).
        start_12m = b.date_to - relativedelta(years=1) + timedelta(days=1)
        sales_12m = sum(s for s, _p in env["eguitra.analytics.groupe"].documents_ttc(company, start_12m, b.date_to).values())
        days_12m = (b.date_to - start_12m).days + 1
        revenue_block = {
            "monthly": {"months": months, "series": series},
            "total": round(period_total), "previous": round(previous_total), "unassigned": round(unassigned_period),
            "receivables": {"open": round(receivables["total"]), "overdue": round(receivables["overdue"]),
                            "aging": {k: round(v) for k, v in receivables["aging"].items()},
                            "dso_days": _r(receivables["total"] / sales_12m * days_12m) if sales_12m > 0 else None,
                            "by_client": self._receivables_by_client(b)},
        }

        history = pf.months_back(b.date_to, 24)
        values = [totals.get(m, 0.0) for m in history]
        history, values, entame = _historique_clos(history, values, b.date_to)
        while len(values) > 6 and not values[0]:
            values.pop(0)
            history = history[1:]
        fc = _forecast(values, 4 if entame else 3)
        if entame:
            # Prévision partie du dernier mois clos : le mois en cours d'abord, puis les trois suivants.
            fc = dict(fc, forecast=fc["forecast"][1:], low=fc["low"][1:], high=fc["high"][1:])
        backlog = [t for t in sheets if unbilled(t)]
        backlog_hours = sum(t.hours for t in backlog)
        backlog_old = sum(t.hours for t in backlog if (b.date_to - t.date).days > UNBILLED_OLD_DAYS)
        backlog_by_dossier = defaultdict(lambda: [0.0, None])
        for t in backlog:
            acc = backlog_by_dossier[t.dossier_id]
            acc[0] += t.hours
            acc[1] = min(acc[1], t.date) if acc[1] else t.date
        forecast = {
            "months": pf.next_months(b.date_to, 3), "fees": [round(v) for v in fc["forecast"]],
            "low": [round(v) for v in fc["low"]], "high": [round(v) for v in fc["high"]],
            "method": fc["method"], "mape": _r(fc["mape"]),
            "history": {"months": history, "values": [round(v) for v in values]},
            "backlog_hours": _r(backlog_hours), "backlog_value": round(backlog_hours * rate) if rate else None,
            "backlog_old_hours": _r(backlog_old),
            "backlog": sorted(({**_brief(d), "hours": _r(h), "value": round(h * rate) if rate else None,
                                "oldest": oldest, "age_days": (b.date_to - oldest).days, "link": _dossier_link(d)}
                               for d, (h, oldest) in backlog_by_dossier.items()), key=lambda x: -x["hours"]),
        }
        trend_months = pf.months_back(b.date_to, 12)
        month_value, month_billed = defaultdict(float), defaultdict(float)
        for t in sheets:
            key = pf.month_key(t.date)
            month_value[key] += t.hours * (rate or 0.0)
            month_billed[key] += billed_value(t)
        summary = {
            "hours": _r(hours), "fees": round(period_total), "fees_previous": round(previous_total),
            "fees_trend": [round(totals.get(m, 0.0)) for m in trend_months],
            "realization_pct": realization_block["overall_pct"],
            "realization_trend": [_r(_share(month_billed[m], month_value[m])) if month_value[m] else None
                                  for m in trend_months] if rate else [],
            "wip_value": realization_block["wip_value"], "receivables": revenue_block["receivables"]["open"],
            "overdue": revenue_block["receivables"]["overdue"],
        }
        notes = []
        if rate_source is None:
            notes.append(("Taux horaire standard non paramétré et aucune facture d'honoraires validée sur 12 mois : "
                          "valeur du temps et réalisation non calculables (paramètre "
                          f"{PARAM_HOURLY_RATE}).", 30))
        elif rate_source == "derived":
            notes.append((f"Taux horaire standard déduit des factures d'honoraires des 12 derniers mois "
                          f"({gnf(rate)}/h) : à fixer par le paramètre {PARAM_HOURLY_RATE}.", 5))
        if period_total and abs(unassigned_period) >= 1:
            notes.append((f"{gnf(unassigned_period)} de chiffre d'affaires sans activité analytique sur la période.",
                          min(20, 20 * abs(unassigned_period) / abs(period_total))))
        drafts = sheets.invoice_id.filtered(lambda m: m.state == "draft")
        if drafts:
            notes.append((f"{_n(len(drafts), 'facture d’honoraires', 'factures d’honoraires')} en brouillon : temps ni "
                          "facturé ni « à facturer » tant qu'elle n'est pas validée.", 5))
        stuck = [t for t in sheets if t.billable and t.invoice_id and t.invoice_id not in invoices
                 and t.invoice_id.state != "draft"]
        if stuck:
            notes.append((f"{_fr(sum(t.hours for t in stuck), 1)} h rattachées à des factures annulées ou contrepassées : "
                          "ni facturées ni refacturables tant qu'elles restent attachées à la facture (AxisPro).", 10))
        candidates = self._activite_insights(b, rate, ratio, realization_block, profit_rows, forecast, revenue_block,
                                             summary, by_service)
        return {
            "time": time, "realization": realization_block,
            "profitability": {"cost_rate_pct": _r(ratio * 100), "cost_hourly": round(cost_rate) if cost_rate else None,
                              "rows": profit_rows, "by_service": by_service},
            "revenue": revenue_block, "forecast": forecast, "summary": summary,
            "_insights": candidates, "_notes": notes,
        }

    def _revenue_period(self, b, start, end):
        return b.env["eguitra.finance.metrics"].revenue(b.company, start, end)

    def _activite_insights(self, b, rate, ratio, real, profit_rows, forecast, revenue, summary, by_service):
        out = []
        Dossier = b.env["axispro.dossier"]
        if forecast["backlog_value"]:
            old_hours = forecast["backlog_old_hours"] or 0
            top = forecast["backlog"][0]
            out.append(insight(
                "cabinet.temps_non_facture", "activite",
                "high" if forecast["backlog_hours"] and old_hours / forecast["backlog_hours"] >= 0.5 else "medium",
                f"{gnf(forecast['backlog_value'])} de temps facturable restent à facturer",
                f"{_fr(forecast['backlog_hours'], 1)} h facturables ne sont pas encore facturées"
                + (f", dont {_fr(old_hours, 1)} h de plus de {UNBILLED_OLD_DAYS} jours" if old_hours else "")
                + f" ; {top['reference']} en porte la plus grande part ({_fr(top['hours'], 1)} h).",
                metric={"label": "Carnet à facturer", "value": forecast["backlog_value"], "unit": "gnf",
                        "reference": None, "reference_label": None},
                impact_gnf=forecast["backlog_value"], confidence=0.9,
                method="Temps facturable sans facture validée (ou en facture brouillon) × taux horaire standard.",
                evidence={"type": "bars", "data": {"labels": [x["reference"] for x in forecast["backlog"][:8]],
                                                   "values": [x["value"] for x in forecast["backlog"][:8]], "unit": "gnf"}},
                action=f"Émettre la facture d'honoraires de {top['reference']} ({gnf(top['value'])}), puis des autres "
                       "dossiers du carnet.",
                link=_dossier_link(Dossier.browse(top["id"])),
            ))
        rp = real["overall_pct"]
        if rp is not None and real["value"]:
            loss = real["value"] - real["billed"]
            body = (f"Sur la période, {_fr(real['hours'], 1)} h valent {gnf(real['value'])} au taux standard de "
                    f"{gnf(rate)}/h ; {gnf(real['billed'])} sont facturés, {gnf(real['wip_value'])} restent à facturer et "
                    f"{gnf(real['non_billable_value'])} relèvent de temps non facturable.")
            method = ("Honoraires facturés du temps de la période (montant hors taxes de chaque facture validée réparti "
                      "sur ses heures) / heures × taux standard"
                      + (" (taux déduit des factures des 12 derniers mois)." if real["rate_source"] == "derived" else "."))
            if rp < REALIZATION_TARGET:
                out.append(insight(
                    "cabinet.realisation", "activite", "high" if rp < 70 else "medium",
                    f"Taux de réalisation de {pct(rp, 0)}", body,
                    metric={"label": "Taux de réalisation", "value": rp, "unit": "pct", "reference": REALIZATION_TARGET,
                            "reference_label": "Cible"},
                    impact_gnf=loss, confidence=_confidence(len(real["by_dossier"])), method=method,
                    evidence={"type": "bars", "data": {"labels": [x["name"] for x in real["by_consultant"]],
                                                       "values": [x["realization_pct"] or 0 for x in real["by_consultant"]],
                                                       "unit": "pct"}},
                    action="Facturer le carnet, limiter le temps non facturable et revoir les forfaits des dossiers "
                           "à faible réalisation.",
                    link="/analyse/activite",
                ))
            elif rp >= 95:
                out.append(insight(
                    "cabinet.realisation", "activite", "positive", f"Taux de réalisation de {pct(rp, 0)}", body,
                    metric={"label": "Taux de réalisation", "value": rp, "unit": "pct", "reference": REALIZATION_TARGET,
                            "reference_label": "Cible"},
                    impact_gnf=real["billed"], confidence=_confidence(len(real["by_dossier"])), method=method,
                    action="Maintenir la facturation au fil de l'eau.", link="/analyse/activite",
                ))
        losers = [x for x in profit_rows if x["margin_ltd"] is not None and x["margin_ltd"] < 0 and (x["hours_ltd"] or 0) >= 5]
        for x in sorted(losers, key=lambda x: x["margin_ltd"])[:2]:
            out.append(insight(
                f"cabinet.dossier_deficitaire.{x['id']}", "activite", "high",
                f"Le dossier {x['reference']} coûte plus qu'il ne rapporte",
                f"{_fr(x['hours_ltd'], 1)} h passées depuis l'ouverture (coût du temps {gnf(x['cost_ltd'])} au taux de "
                f"revient de {pct(ratio * 100, 0)} du taux de vente) pour {gnf(x['fees_ltd'])} d'honoraires comptabilisés.",
                metric={"label": "Marge depuis l'ouverture", "value": x["margin_ltd"], "unit": "gnf", "reference": 0,
                        "reference_label": "Point mort"},
                impact_gnf=-x["margin_ltd"], confidence=0.8,
                method="Honoraires comptabilisés sur le compte analytique du dossier (comptes 70) moins heures × taux "
                       "standard × taux de revient (paramètre eguitra_analytics.cabinet_cost_ratio).",
                action="Facturer le temps en attente ou renégocier le forfait ; à défaut, plafonner le temps alloué.",
                link=_dossier_link(Dossier.browse(x["id"])),
            ))
        receivables = revenue["receivables"]
        if receivables["overdue"] > 0:
            over90 = receivables["aging"].get("plus_90", 0)
            top = receivables["by_client"][0] if receivables["by_client"] else None
            out.append(insight(
                "cabinet.creances_echues", "activite",
                "high" if over90 > 0 or receivables["overdue"] > 0.5 * receivables["open"] else "medium",
                f"{gnf(receivables['overdue'])} de créances clients échues",
                f"Sur {gnf(receivables['open'])} de créances ouvertes"
                + (f", dont {gnf(over90)} échues depuis plus de 90 jours" if over90 else "")
                + (f" ; premier débiteur : {top['name']} ({gnf(top['open'])})." if top else "."),
                metric={"label": "Part échue", "value": round(_share(receivables["overdue"], receivables["open"]) or 0, 1),
                        "unit": "pct", "reference": None, "reference_label": None},
                impact_gnf=receivables["overdue"], confidence=0.9,
                method="Écritures clients validées non lettrées, échéance dépassée à la date d'arrêté.",
                action="Relancer les débiteurs échus, en commençant par les plus anciens et les plus importants.",
                link="/analyse/activite",
            ))
        fees, before = summary["fees"], summary["fees_previous"]
        if before:
            growth = (fees - before) / abs(before) * 100
            if growth >= 10:
                out.append(insight(
                    "cabinet.honoraires_hausse", "activite", "positive",
                    f"Honoraires en hausse de {pct(growth, 0)} sur un an",
                    f"{gnf(fees)} sur la période contre {gnf(before)} un an plus tôt.",
                    metric={"label": "Variation sur un an", "value": round(growth, 1), "unit": "pct", "reference": 0,
                            "reference_label": "N-1"},
                    impact_gnf=fees - before, confidence=0.85,
                    method="Chiffre d'affaires (comptes 70) de la période comparé à la même période un an plus tôt.",
                    action="Consolider les lignes de service qui portent la croissance.", link="/analyse/activite",
                ))
            elif growth <= -20:
                out.append(insight(
                    "cabinet.honoraires_baisse", "activite", "medium",
                    f"Honoraires en baisse de {pct(-growth, 0)} sur un an",
                    f"{gnf(fees)} sur la période contre {gnf(before)} un an plus tôt.",
                    metric={"label": "Variation sur un an", "value": round(growth, 1), "unit": "pct", "reference": 0,
                            "reference_label": "N-1"},
                    impact_gnf=before - fees, confidence=0.85,
                    method="Chiffre d'affaires (comptes 70) de la période comparé à la même période un an plus tôt.",
                    action="Relancer la prospection des lignes de service en recul et facturer le carnet.",
                    link="/analyse/activite",
                ))
        if any(forecast["fees"]):
            total = sum(forecast["fees"])
            out.append(insight(
                "cabinet.prevision_honoraires", "activite", "info",
                f"Honoraires attendus sur les trois prochains mois : {gnf(total)}",
                f"Fourchette de {gnf(sum(forecast['low']))} à {gnf(sum(forecast['high']))}"
                + (f" ; carnet à facturer : {gnf(forecast['backlog_value'])}." if forecast["backlog_value"] else "."),
                metric={"label": "Prévision à 3 mois", "value": total, "unit": "gnf", "reference": None,
                        "reference_label": None},
                confidence=0.55 if forecast["mape"] is None else max(0.3, min(0.9, 1 - forecast["mape"] / 100)),
                method=f"Honoraires mensuels prolongés par {forecast['method'] or 'lissage exponentiel'}"
                       + (f" (erreur moyenne {pct(forecast['mape'], 0)})." if forecast["mape"] is not None else "."),
                action="Ajuster la charge des consultants et la prospection à ce niveau d'activité.",
                link="/analyse/activite",
            ))
        services = [s for s in by_service if s["revenue"] > 0]
        if services and summary["fees"]:
            top = max(services, key=lambda s: s["revenue"])
            if (top["share_pct"] or 0) >= 80:
                out.append(insight(
                    "cabinet.ligne_dominante", "activite", "info",
                    f"{top['label']} fait {pct(top['share_pct'], 0)} du chiffre d'affaires",
                    f"Les autres lignes de service pèsent {pct(max(0.0, 100 - top['share_pct']), 0)} des honoraires de "
                    "la période : le cabinet dépend d'une seule source de revenus.",
                    metric={"label": "Part de la première ligne", "value": top["share_pct"], "unit": "pct",
                            "reference": 80.0, "reference_label": "Seuil"},
                    confidence=0.75, method="Chiffre d'affaires de la période par activité analytique du cabinet.",
                    action="Proposer aux porteurs accompagnés les formations et audits du cabinet, à partir des "
                           "faiblesses récurrentes du diagnostic.",
                    link="/analyse/diagnostic",
                ))
        return out

    # ─── 6.7 Risques et exécution ─────────────────────────────────────────

    def _risques(self, b):
        """Risques et exécution.

        - Matrice : risques ouverts (non maîtrisés) des dossiers du portefeuille, probabilité × impact ;
          niveaux de criticité du module (≥ 15 critique, ≥ 10 élevé, ≥ 5 modéré).
        - Actions : ouvertes, en retard (échéance dépassée, hors comptes rendus en attente de validation),
          vélocité hebdomadaire (créées, terminées), délai médian création → réalisation des actions
          terminées sur la période ; semaines pour solder = ouvertes / débit hebdomadaire de la période.
        - Réactivité des porteurs : pièce standard obligatoire demandée (entrée du dossier dans le gate où
          elle est attendue) → premier dépôt ; les pièces encore manquantes sont comptées à part, avec leur
          âge."""
        env, live = b.env, b.live
        risks = env["axispro.risk"].search([("company_id", "=", b.company.id), ("dossier_id", "in", live.ids),
                                            ("state", "!=", "closed")], order="score desc, id asc")
        treated = set(env["axispro.action"].search([("risk_id", "in", risks.ids), ("state", "!=", "cancelled")]).risk_id.ids)
        cells = []
        for probability in range(1, 6):
            for impact in range(1, 6):
                subset = risks.filtered(lambda r, p=probability, i=impact: r.probability == p and r.impact == i)
                cells.append({"probability": probability, "impact": impact, "count": len(subset),
                              "score": probability * impact,
                              "criticality": RISK_CRITICALITY[risk_level(probability * impact)],
                              "risks": [f"{r.dossier_id.reference} · {r.name}" for r in subset[:5]]})
        levels = defaultdict(int)
        for r in risks:
            levels[RISK_CRITICALITY[risk_level(r.score)]] += 1
        categories = dict(RISK_CATEGORIES)
        by_category = []
        for key in {r.category for r in risks}:
            subset = risks.filtered(lambda r, k=key: r.category == k)
            by_category.append({"category": key, "label": categories.get(key, key), "count": len(subset),
                                "avg_score": _r(pf.mean(subset.mapped("score"))), "max_score": max(subset.mapped("score"))})
        by_category.sort(key=lambda x: (-x["count"], -x["max_score"], x["category"]))
        critical = risks.filtered(lambda r: risk_level(r.score) == "critical")
        residual = risks.filtered(lambda r: r.residual_score)
        risk_matrix = {
            "cells": cells, "open": len(risks), "critical": len(critical), "levels": ["low", "medium", "high", "critical"],
            "by_level": {k: levels[k] for k in ("low", "medium", "high", "critical")}, "by_category": by_category,
            "mitigated_pct": _r(_share(len(risks.filtered("mitigation")), len(risks))),
            "treated_pct": _r(_share(sum(1 for r in risks if r.id in treated), len(risks))),
            "residual_reduction": _r(pf.mean([r.score - r.residual_score for r in residual])),
            "top": [dict(_brief(r.dossier_id), risk_id=r.id, risk=r.name, category=r.category, score=r.score,
                         level=RISK_CRITICALITY[risk_level(r.score)], treated=r.id in treated,
                         mitigation=bool(r.mitigation), link=_dossier_link(r.dossier_id)) for r in risks[:8]],
        }

        actions = env["axispro.action"].search([("company_id", "=", b.company.id), ("dossier_id", "in", b.dossiers.ids)])
        actions = actions.filtered(lambda a: a.create_date.date() <= b.date_to)
        open_actions = actions.filtered(lambda a: a.state in ACTION_OPEN and a.dossier_id in live)
        overdue = open_actions.filtered(lambda a: a.is_overdue(b.date_to))
        submitted = open_actions.filtered(lambda a: a.state == "submitted")
        done = actions.filtered(lambda a: a.state == "done" and b.in_period(a.done_date))
        leads = [max((a.done_date - a.create_date.date()).days, 0) for a in done]
        weeks = pf.week_keys(b.date_from, b.date_to, limit=26)
        created_w, done_w = defaultdict(int), defaultdict(int)
        for a in actions:
            created_w[pf.week_start(a.create_date.date()).isoformat()] += 1
            if a.state == "done" and a.done_date:
                done_w[pf.week_start(a.done_date).isoformat()] += 1
        period_weeks = max(1.0, ((b.date_to - b.date_from).days + 1) / 7)
        throughput = len(done) / period_weeks
        created_period = actions.filtered(lambda a: b.in_period(a.create_date.date()))
        by_assignee = []
        for key, label in (("porteur", "Porteur"), ("cabinet", "Cabinet")):
            subset = done.filtered(lambda a, k=key: a.assignee == k)
            by_assignee.append({
                "assignee": key, "label": label, "open": len(open_actions.filtered(lambda a, k=key: a.assignee == k)),
                "overdue": len(overdue.filtered(lambda a, k=key: a.assignee == k)), "done": len(subset),
                "median_days": _r(pf.median([max((a.done_date - a.create_date.date()).days, 0) for a in subset])),
            })
        actions_block = {
            "open": len(open_actions), "overdue": len(overdue), "submitted": len(submitted),
            "created": len(created_period), "done": len(done), "median_days": _r(pf.median(leads)),
            "p75_days": _r(pf.quantile(leads, 0.75)),
            "velocity": [{"week": w, "created": created_w.get(w, 0), "done": done_w.get(w, 0)} for w in weeks],
            "throughput_per_week": _r(throughput, 2),
            "weeks_to_clear": _r(len(open_actions) / throughput) if throughput else None,
            "by_assignee": by_assignee,
            "overdue_rows": [dict(_brief(a.dossier_id), action_id=a.id, action=a.name, assignee=a.assignee,
                                  source=a.source, due_date=a.due_date, days_late=(b.date_to - a.due_date).days,
                                  link=_dossier_link(a.dossier_id))
                             for a in overdue.sorted(lambda a: a.due_date)[:15]],
        }

        documents = env["axispro.document"].search([("company_id", "=", b.company.id), ("dossier_id", "in", live.ids),
                                                    ("document_type_id", "!=", False)])
        first_upload = {}
        for doc in documents:
            day = doc.uploaded_at.date() if doc.uploaded_at else None
            if day and day <= b.date_to:
                key = (doc.dossier_id.id, doc.document_type_id.id)
                first_upload[key] = min(first_upload.get(key, day), day)
        responses, pending = [], []
        per_dossier = {}
        for d in live:
            t = b.timeline(d)
            gates = {g.code: g.sequence for g in d.policy_id.gate_ids}
            opening = d.create_date.date()
            row = per_dossier.setdefault(d.id, {"dossier": d, "delays": [], "pending": []})
            for doc_type in d.policy_id.document_type_ids.filtered("required"):
                code = doc_type.gate_id.code
                if code and gates.get(code, 0) > t["sequence"]:
                    continue
                requested = (t["entered"].get(code) if code else opening) or opening
                uploaded = first_upload.get((d.id, doc_type.id))
                if uploaded:
                    days = max((uploaded - requested).days, 0)
                    if b.in_period(uploaded):
                        responses.append(days)
                        row["delays"].append(days)
                else:
                    age = max((b.date_to - requested).days, 0)
                    pending.append(age)
                    row["pending"].append(age)
        by_dossier = []
        for row in per_dossier.values():
            if not row["delays"] and not row["pending"]:
                continue
            d = row["dossier"]
            by_dossier.append(dict(_brief(d), promoter=d.promoter_id.name, median_days=_r(pf.median(row["delays"])),
                                   responded=len(row["delays"]), pending=len(row["pending"]),
                                   oldest_pending_days=max(row["pending"], default=None), link=_dossier_link(d)))
        by_dossier.sort(key=lambda x: (-(x["oldest_pending_days"] or 0), -(x["median_days"] or 0), x["reference"] or ""))
        porteur_done = done.filtered(lambda a: a.assignee == "porteur")
        responsiveness = {
            "median_days": _r(pf.median(responses)), "p75_days": _r(pf.quantile(responses, 0.75)), "n": len(responses),
            "pending": len(pending), "pending_median_age_days": _r(pf.median(pending)),
            "actions_median_days": _r(pf.median([max((a.done_date - a.create_date.date()).days, 0) for a in porteur_done])),
            "by_dossier": by_dossier,
        }
        notes = []
        without_mitigation = risks.filtered(lambda r: not r.mitigation)
        if without_mitigation:
            notes.append((f"{_n(len(without_mitigation), 'risque ouvert')} sans mesure d'atténuation décrite.",
                          15 * len(without_mitigation) / len(risks)))
        no_due = open_actions.filtered(lambda a: not a.due_date)
        if no_due:
            notes.append((f"{_n(len(no_due), 'action ouverte')} sans échéance : retards non mesurables.",
                          15 * len(no_due) / len(open_actions)))
        candidates = self._risques_insights(b, risks, critical, treated, actions_block, overdue, submitted,
                                            created_period, done, responsiveness)
        return {"risk_matrix": risk_matrix, "actions": actions_block, "responsiveness": responsiveness,
                "_insights": candidates, "_notes": notes}

    def _risques_insights(self, b, risks, critical, treated, actions, overdue, submitted, created, done, responsiveness):
        out = []
        untreated = critical.filtered(lambda r: r.id not in treated)
        if untreated:
            dossiers = untreated.dossier_id
            out.append(insight(
                "cabinet.risques_critiques", "risques", "high",
                f"{_n(len(untreated), 'risque critique', 'risques critiques')} sans plan de traitement",
                " ; ".join(f"{r.dossier_id.reference} : {r.name} (criticité {r.score})" for r in untreated[:3]) + ".",
                metric={"label": "Risques critiques non traités", "value": len(untreated), "unit": "count",
                        "reference": 0, "reference_label": "Cible"},
                impact_gnf=sum(b.need(d) for d in dossiers), confidence=0.85,
                method="Risques ouverts de criticité au moins égale à 15 (probabilité × impact) sans action de "
                       "traitement liée.",
                action="Transformer les mesures d'atténuation en actions datées, confiées au porteur ou au cabinet.",
                link=_dossier_link(dossiers[0]) if len(dossiers) == 1 else "/analyse/risques",
            ))
        if overdue:
            share = _share(len(overdue), actions["open"]) or 0
            porteur = len(overdue.filtered(lambda a: a.assignee == "porteur"))
            oldest = overdue.sorted(lambda a: a.due_date)[0]
            out.append(insight(
                "cabinet.actions_en_retard", "risques", "high" if share >= 25 else "medium",
                f"{_n(len(overdue), 'action en retard', 'actions en retard')} sur {actions['open']} ouverte(s)",
                f"{porteur} confiée(s) aux porteurs, {len(overdue) - porteur} au cabinet ; la plus ancienne : "
                f"« {oldest.name} » ({oldest.dossier_id.reference}), échue depuis {_days((b.date_to - oldest.due_date).days)}.",
                metric={"label": "Part des actions en retard", "value": round(share, 1), "unit": "pct", "reference": 10.0,
                        "reference_label": "Seuil de vigilance"},
                impact_gnf=sum(b.need(d) for d in overdue.dossier_id), confidence=0.9,
                method="Actions ouvertes dont l'échéance est dépassée à la date d'arrêté (hors comptes rendus en "
                       "attente de validation).",
                action="Faire le point avec chaque porteur concerné et replanifier les échéances irréalistes.",
                link=_dossier_link(oldest.dossier_id) if len(overdue.dossier_id) == 1 else "/analyse/risques",
            ))
        if len(created) > len(done) and actions["open"] and actions["weeks_to_clear"] and actions["weeks_to_clear"] > 12:
            out.append(insight(
                "cabinet.plan_actions_charge", "risques", "medium",
                "Le plan d'actions s'alourdit plus vite qu'il ne se solde",
                f"{len(created)} actions créées pour {len(done)} terminées sur la période ; au rythme actuel "
                f"({_fr(actions['throughput_per_week'] * 52 / 12, 1)} par mois), il faudrait {_fr(actions['weeks_to_clear'], 0)} "
                f"semaines pour solder les {actions['open']} actions ouvertes.",
                metric={"label": "Semaines pour solder", "value": actions["weeks_to_clear"], "unit": "count",
                        "reference": 12, "reference_label": "Seuil"},
                confidence=0.7,
                method="Débit = actions terminées sur la période / semaines de la période ; semaines pour solder = "
                       "actions ouvertes / débit (loi de Little).",
                action="Prioriser les actions qui conditionnent le prochain gate et clore celles devenues sans objet.",
                link="/analyse/risques",
            ))
        if submitted:
            out.append(insight(
                "cabinet.validations_en_attente", "risques", "medium",
                f"{_n(len(submitted), 'compte rendu de porteur attend', 'comptes rendus de porteurs attendent')} la "
                "validation du cabinet",
                f"Actions déclarées réalisées par les porteurs : {_refs(submitted.dossier_id)}.",
                metric={"label": "Comptes rendus à valider", "value": len(submitted), "unit": "count", "reference": 0,
                        "reference_label": "Cible"},
                confidence=0.9, method="Actions au statut « déclarée réalisée par le porteur ».",
                action="Valider ou renvoyer chaque compte rendu sous 48 heures : la réactivité du cabinet entretient "
                       "celle des porteurs.",
                link="/analyse/risques",
            ))
        median = responsiveness["median_days"]
        if median is not None and responsiveness["n"] >= 2:
            if median > 2 * RESPONSE_TARGET_DAYS:
                out.append(insight(
                    "cabinet.reactivite_porteurs", "risques", "medium",
                    f"Les porteurs mettent {_days(median)} en médiane à fournir une pièce",
                    f"Mesuré sur {_n(responsiveness['n'], 'pièce déposée', 'pièces déposées')} sur la période ; "
                    f"{_n(responsiveness['pending'], 'pièce reste', 'pièces restent')} attendue(s).",
                    metric={"label": "Délai médian de dépôt", "value": median, "unit": "days",
                            "reference": float(RESPONSE_TARGET_DAYS), "reference_label": "Cible"},
                    confidence=_confidence(responsiveness["n"]),
                    method="Entrée du dossier dans le gate où la pièce est attendue → premier dépôt de la pièce.",
                    action="Remettre la liste des pièces dès l'entrée dans le gate, avec une échéance et une relance "
                           "à J+15.",
                    link="/analyse/risques",
                ))
            elif median <= RESPONSE_TARGET_DAYS:
                out.append(insight(
                    "cabinet.reactivite_porteurs", "risques", "positive",
                    f"Les porteurs fournissent leurs pièces en {_days(median)} en médiane",
                    f"Mesuré sur {_n(responsiveness['n'], 'pièce déposée', 'pièces déposées')} sur la période.",
                    metric={"label": "Délai médian de dépôt", "value": median, "unit": "days",
                            "reference": float(RESPONSE_TARGET_DAYS), "reference_label": "Cible"},
                    confidence=_confidence(responsiveness["n"]),
                    method="Entrée du dossier dans le gate où la pièce est attendue → premier dépôt de la pièce.",
                    action="Maintenir la remise de la liste des pièces dès l'entrée dans chaque gate.",
                    link="/analyse/risques",
                ))
        slow = [x for x in responsiveness["by_dossier"] if (x["oldest_pending_days"] or 0) > MISSING_OLD_DAYS]
        if slow:
            x = slow[0]
            out.append(insight(
                f"cabinet.porteur_lent.{x['id']}", "risques", "medium",
                f"{x['promoter']} n'a pas fourni {_n(x['pending'], 'pièce attendue', 'pièces attendues')}",
                f"Dossier {x['reference']} : la plus ancienne est attendue depuis {_days(x['oldest_pending_days'])}.",
                metric={"label": "Attente la plus longue", "value": x["oldest_pending_days"], "unit": "days",
                        "reference": float(MISSING_OLD_DAYS), "reference_label": "Seuil"},
                confidence=0.8,
                method="Pièces standard obligatoires attendues au gate courant ou avant, sans dépôt.",
                action="Appeler le porteur, convenir d'une date de dépôt et l'inscrire au plan d'actions.",
                link=_dossier_link(b.env["axispro.dossier"].browse(x["id"])),
            ))
        return out


def _billed(move):
    """Facture d'honoraires validée et non contrepassée."""
    return move.state == "posted" and move.move_type == "out_invoice" and move.payment_state != "reversed"


def _net_billed(env, invoices, day):
    """Montant hors taxes de chaque facture d'honoraires, net des avoirs validés qui la contrepassent
    (reversed_entry_id), lettrés ou non, partiels compris, jusqu'à la date d'arrêté."""
    net = {m.id: m.amount_untaxed_signed for m in invoices}
    if invoices:
        refunds = env["account.move"].search([("reversed_entry_id", "in", invoices.ids), ("state", "=", "posted"),
                                              ("move_type", "=", "out_refund"), ("date", "<=", day)])
        for refund in refunds:
            net[refund.reversed_entry_id.id] += refund.amount_untaxed_signed
    return net
