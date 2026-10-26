"""Cockpit HSSEQ (contrat §4) : indicateurs du mois (ou des douze mois) avec leur source et leur série de
douze mois, départs bloqués du jour, actions en retard, échéances à 30 jours, événements à suivre et leur
matrice de criticité sur la période."""

from collections import Counter
from datetime import datetime, time

from dateutil.relativedelta import relativedelta

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError

from ..models.cockpit import month_end, month_label, parse_month
from ..models.common import FINDING_CLASSES, LEVELS, REQUIREMENT_STATUSES, STANDARDS, matrix_cells
from .actions import overdue_lines
from .common import (
    COCKPIT_READ,
    companies,
    forbidden,
    get,
    hsseq_route,
    in_scope,
    personal_data_hidden,
    profiles,
    site_ref,
    site_scope,
    vehicle_ref,
)
from .lock import departures
from .referentials import deadline_items


def event_matrix(comps, month, period, sites, vehicle_kind):
    """Événements survenus sur la période (le mois, ou les douze mois qui s'y terminent), comptés par case
    gravité potentielle × probabilité ; les événements pas encore classés restent hors matrice."""
    start = month if period == "month" else month - relativedelta(months=11)
    domain = [("company_id", "in", comps.ids), ("occurred_at", ">=", datetime.combine(start, time.min)),
              ("occurred_at", "<=", datetime.combine(month_end(month), time.max))]
    if sites:
        domain.append(("site_id", "in", sites.ids))
    if vehicle_kind:
        domain.append(("vehicle_id.vehicle_kind", "=", vehicle_kind))
    events = request.env["eguitra.hsseq.event"].sudo().search(domain)
    counts = Counter((e.potential_severity, e.probability) for e in events if e.potential_severity and e.probability)
    settings = request.env["eguitra.hsseq.settings"]._get(comps[:1] or request.env.company)
    cells = [dict(cell, potential_severity=cell["severity"]) for cell in matrix_cells(counts, settings._level)]
    return cells, len(events) - sum(counts.values())


def lot2_blocks(comps, month, sites):
    """Situation du lot 2, bornée aux sites (fermé par défaut : un objet sans site n'est compté que sans
    bornage) : risques par niveau brut et résiduel, revues échues ; audits de l'année ; constats ouverts
    par classement ; exigences (profils qui lisent le registre) ; immobilisations en cours."""
    env = request.env
    day = fields.Date.context_today(env.user)
    site_domain = [("site_id", "in", sites.ids)] if sites else []
    base = [("company_id", "in", comps.ids)]
    risks = env["eguitra.hsseq.risk"].sudo().search(base + site_domain + [("status", "=", "active")])
    year_audits = env["eguitra.hsseq.audit"].sudo().search(base + site_domain + [
        ("status", "!=", "cancelled"), ("planned_date", ">=", month.replace(month=1)),
        ("planned_date", "<=", month_end(month))])
    done = year_audits.filtered(lambda a: a.status in ("done", "closed"))
    findings = env["eguitra.hsseq.finding"].sudo().search(base + site_domain + [("status", "=", "open")])
    immobilizations = env["eguitra.hsseq.immobilization"].sudo().search(base + site_domain + [("status", "=", "active")])
    blocks = {
        "risks": {"active": len(risks),
                  "by_raw_level": {code: len(risks.filtered(lambda r, c=code: r.raw_level == c)) for code, _l in LEVELS},
                  "by_residual_level": {code: len(risks.filtered(lambda r, c=code: r.residual_level == c))
                                        for code, _l in LEVELS},
                  "reviews_overdue": len(risks.filtered(lambda r: r.review_date and r.review_date < day))},
        "audits": {"year": month.year, "planned": len(year_audits), "done": len(done),
                   "rate": round(len(done) * 100 / len(year_audits), 1) if year_audits else None},
        "findings": {"open_by_class": {code: len(findings.filtered(lambda f, c=code: f.classification == c))
                                       for code, _l in FINDING_CLASSES}},
        "immobilizations": {"active": len(immobilizations),
                            "items": [{"id": i.id, "vehicle": vehicle_ref(i.vehicle_id), "site": site_ref(i.site_id),
                                       "event": {"id": i.event_id.id, "reference": i.event_id.reference},
                                       "since": i.since} for i in immobilizations[:8]]},
        "requirements": None, "iso_maturity": None,
    }
    if profiles() & {"admin", "direction", "hsseq", "auditeur"}:
        requirements = env["eguitra.hsseq.requirement"].sudo().search(base)
        blocks["requirements"] = {"by_status": {code: len(requirements.filtered(lambda r, c=code: r.status == c))
                                                for code, _l in REQUIREMENT_STATUSES},
                                  "non_compliant": len(requirements.filtered(lambda r: r.status == "non_compliant"))}
        maturity = []
        for code, label in STANDARDS:
            subset = requirements.filtered(lambda r, c=code: r.standard == c)
            evaluated = subset.filtered(lambda r: r.status != "not_evaluated")
            if not subset:
                continue
            score = sum(1 if r.status == "compliant" else 0.5 if r.status == "partial" else 0 for r in evaluated)
            maturity.append({"standard": code, "label": label, "requirements": len(subset), "evaluated": len(evaluated),
                             "score": round(score * 100 / len(evaluated), 1) if evaluated else None})
        blocks["iso_maturity"] = maturity or None
    return blocks


class EguitraHsseqCockpit(http.Controller):
    @hsseq_route("/hsseq/cockpit", profiles=COCKPIT_READ)
    def cockpit(self, **kw):
        env = request.env
        day = fields.Date.context_today(env.user)
        try:
            month = parse_month(kw.get("month"), day)
        except (TypeError, ValueError) as e:
            raise ApiError(400, "invalid_parameter", "Mois attendu au format AAAA-MM.", fields=["month"]) from e
        period = kw.get("period") or "month"
        if period not in ("month", "12m"):
            raise ApiError(400, "invalid_parameter", "Période : month ou 12m.", fields=["period"])
        vehicle_kind = kw.get("vehicle_kind") or kw.get("profile") or None
        if vehicle_kind and vehicle_kind not in ("tanker", "tipper"):
            raise ApiError(400, "invalid_parameter", "Type de véhicule : tanker ou tipper.", fields=["vehicle_kind"])
        comps = companies(kw)
        Site = env["eguitra.hsseq.site"].sudo()
        sites = Site
        # Portée fermée par défaut : hors lecture complète, les sites du compte, et aucun s'il n'en a pas.
        scope = site_scope()
        if kw.get("site_id"):
            sites = get("eguitra.hsseq.site", kw["site_id"], "Site")
            if not in_scope(sites):
                raise forbidden("Site non autorisé.")
        elif scope is not None:
            if not scope:
                raise forbidden("Aucun site n'est rattaché à votre compte : le cockpit se lit par site.")
            sites = scope
        result = env["eguitra.hsseq.cockpit"]._compute(comps, month, period, sites or None, vehicle_kind)
        Event = env["eguitra.hsseq.event"].sudo()
        event_domain = [("company_id", "in", comps.ids)] + ([("site_id", "in", sites.ids)] if sites else [])
        now = fields.Datetime.now()
        date_to = min(month_end(month), day)
        matrix, unclassified = event_matrix(comps, month, period, sites, vehicle_kind)
        lot2 = lot2_blocks(comps, month, sites)
        blocked = departures(comps, day, sites or None, vehicle_kind, blocked_only=True)
        deadlines = deadline_items(comps, 30, site=sites if len(sites) == 1 else None, vehicle_kind=vehicle_kind)
        if personal_data_hidden():
            # Auditeur : ni conducteurs des départs bloqués, ni échéances des personnes.
            blocked["items"] = []
            deadlines = [d for d in deadlines if d["kind"] == "vehicle_document"]
        return {
            "period": {"type": period, "month": month.strftime("%Y-%m"), "date_from": month, "date_to": date_to,
                       "label": month_label(month), "frozen": result["frozen"], "frozen_on": result["frozen_on"]},
            "filters": {"company_id": int(kw["company_id"]) if kw.get("company_id") else None,
                        "site_id": sites.id if len(sites) == 1 and kw.get("site_id") else None,
                        "vehicle_kind": vehicle_kind},
            "referentials": {"companies": [{"id": c.id, "name": c.name} for c in comps],
                             "sites": [{"id": s.id, "name": s.name}
                                       for s in Site.search([("company_id", "in", comps.ids)])]},
            "hours_basis": result["hours_basis"],
            "indicators": result["indicators"],
            "blocked_departures": blocked,
            "overdue_actions": overdue_lines(comps, sites or None),
            "deadlines": {"horizon_days": 30, "items": deadlines},
            "events": {
                "to_classify": Event.search_count(event_domain + [("status", "=", "reported")]),
                "overdue_investigations": Event.search_count(event_domain + [
                    ("status", "in", ("classified", "investigation")), ("investigation_due", "<", now)]),
                "high_open": Event.search_count(event_domain + [("level", "=", "high"), ("status", "!=", "closed")]),
                # Matrice des événements de la période : severity est la gravité potentielle.
                "matrix": matrix,
                "matrix_unclassified": unclassified,
            },
            "waivers_by_reason": result["waivers_by_reason"],
            "risks": lot2["risks"],
            "audits": lot2["audits"],
            "findings": lot2["findings"],
            "requirements": lot2["requirements"],
            "immobilizations": lot2["immobilizations"],
            "iso_maturity": lot2["iso_maturity"],
            "computed_at": now,
        }
