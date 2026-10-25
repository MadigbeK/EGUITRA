"""Cockpit HSSEQ (contrat §4) : indicateurs du mois (ou des douze mois) avec leur source et leur série de
douze mois, départs bloqués du jour, actions en retard, échéances à 30 jours, événements à suivre."""

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError

from ..models.cockpit import month_end, month_label, parse_month
from .actions import overdue_lines
from .common import COCKPIT, companies, forbidden, get, hsseq_route, my_sites, scope_level, site_allowed
from .lock import departures
from .referentials import deadline_items


class EguitraHsseqCockpit(http.Controller):
    @hsseq_route("/hsseq/cockpit", profiles=COCKPIT)
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
        if kw.get("site_id"):
            sites = get("eguitra.hsseq.site", kw["site_id"], "Site")
            if not site_allowed(sites):
                raise forbidden("Site non autorisé.")
        elif scope_level() == "site":
            sites = my_sites()
        result = env["eguitra.hsseq.cockpit"]._compute(comps, month, period, sites or None, vehicle_kind)
        Event = env["eguitra.hsseq.event"].sudo()
        event_domain = [("company_id", "in", comps.ids)] + ([("site_id", "in", sites.ids)] if sites else [])
        now = fields.Datetime.now()
        date_to = min(month_end(month), day)
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
            "blocked_departures": departures(comps, day, sites or None, vehicle_kind, blocked_only=True),
            "overdue_actions": overdue_lines(comps, sites or None),
            "deadlines": {"horizon_days": 30,
                          "items": deadline_items(comps, 30, site=sites if len(sites) == 1 else None,
                                                  vehicle_kind=vehicle_kind)},
            "events": {
                "to_classify": Event.search_count(event_domain + [("status", "=", "reported")]),
                "overdue_investigations": Event.search_count(event_domain + [
                    ("status", "in", ("classified", "investigation")), ("investigation_due", "<", now)]),
                "high_open": Event.search_count(event_domain + [("level", "=", "high"), ("status", "!=", "closed")]),
            },
            "iso_maturity": None,
            "computed_at": now,
        }
