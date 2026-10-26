"""API des habilitations (spécification §3, §9.3) : matrice des compétences par conducteur, lue dans RH,
statuts seulement (valid, to_renew, expired, missing), aptitude en statut seul, jamais de détail médical ;
filtres société, site, statut, type et blocage du verrou (V04) ; alertes J-30 et J-7 envoyées.

Lecture : administration, direction, hsseq, RH ; chef de parc pour les conducteurs de ses sites. Le
conducteur lit ses propres habilitations par GET /hsseq/me. L'écriture des habilitations reste dans RH."""

from collections import Counter

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError

from ..models.qualification import STATUS_RANK, driver_sites
from .common import (
    READ_ALL,
    companies,
    company_ref,
    date_value,
    driver_ref,
    forbidden,
    get,
    hsseq_route,
    in_scope,
    page,
    site_ref,
    site_scope,
)

QUAL_READ = ("admin", "direction", "hsseq", "rh", "exploitation")
# Lecture complète de la matrice ; tout autre compte (chef de parc) : ses sites seulement, fermé par défaut.
QUAL_FULL = READ_ALL | {"rh"}
ALERTS_READ = ("admin", "direction", "hsseq", "rh")


def qualification_types(codes=None):
    Type = request.env["eguitra.rh.qualification.type"].sudo()
    types = Type.search([])
    if codes:
        types = types.filtered(lambda t: t.code in codes)
    return types


def matrix_rows(comps, day, site=None, types=None):
    """Conducteurs en poste (salariés RH liés à un chauffeur) des sociétés. Portée fermée par défaut : hors
    lecture complète, les conducteurs des sites du compte seulement (aucun sans site rattaché) ; un
    conducteur sans site connu n'est lu que par les profils de lecture complète."""
    env = request.env
    types = types if types is not None else qualification_types()
    employees = env["eguitra.rh.employee"].sudo().search([
        ("company_id", "in", comps.ids), ("driver_id", "!=", False), ("hire_date", "<=", day),
        "|", ("exit_date", "=", False), ("exit_date", ">=", day)], order="name")
    on_site = driver_sites(env["eguitra.transport.vehicle"].sudo().search([("company_id", "in", comps.ids)]))
    scope = site_scope(QUAL_FULL)
    rows = []
    for employee in employees:
        driver_site = on_site.get(employee.driver_id.id)
        if site and driver_site != site:
            continue
        if scope is not None and not (driver_site and driver_site in scope):
            continue
        row = employee._hsseq_matrix_row(types, day)
        row.update(driver=driver_ref(employee.driver_id), site=site_ref(driver_site),
                   company=company_ref(employee.company_id))
        rows.append(row)
    return rows


class EguitraHsseqQualifications(http.Controller):
    @hsseq_route("/hsseq/qualifications", profiles=QUAL_READ)
    def qualifications(self, **kw):
        """Matrice des compétences : une ligne par conducteur, une case par type d'habilitation."""
        day = date_value(kw, "date") or fields.Date.context_today(request.env.user)
        site = None
        if kw.get("site_id"):
            site = get("eguitra.hsseq.site", kw["site_id"], "Site")
            if not in_scope(site, QUAL_FULL):
                raise forbidden("Site non autorisé.")
        codes = [c for c in (kw.get("type") or "").split(",") if c]
        types = qualification_types(codes or None)
        rows = matrix_rows(companies(kw), day, site, types)
        counts = {"by_status": {s: 0 for s in STATUS_RANK} | dict(Counter(r["status"] for r in rows)),
                  "drivers": len(rows), "blocking": sum(1 for r in rows if r["blocking"]),
                  "up_to_date": sum(1 for r in rows if not r["blocking"])}
        if kw.get("status"):
            wanted = set(kw["status"].split(","))
            if wanted - set(STATUS_RANK):
                raise ApiError(400, "invalid_parameter", "Statut : valid, to_renew, expired ou missing.",
                               fields=["status"])
            # Statut d'ensemble du conducteur, ou de la case du type filtré.
            rows = [r for r in rows if r["status"] in wanted or (codes and any(
                c["status"] in wanted for c in r["qualifications"]))]
        if str(kw.get("blocking", "")) in ("1", "true"):
            rows = [r for r in rows if r["blocking"]]
        if kw.get("search"):
            q = kw["search"].lower()
            rows = [r for r in rows if q in (r["employee"]["name"] or "").lower()]
        try:
            offset = max(int(kw.get("offset") or 0), 0)
            limit = min(max(int(kw.get("limit") or 200), 1), 500)
        except (TypeError, ValueError) as e:
            raise ApiError(400, "invalid_parameter", "Pagination invalide.") from e
        result = page(rows[offset:offset + limit], len(rows), offset, limit, counts)
        result["types"] = [{"code": t.code, "name": t.name, "mandatory": t.mandatory_for_drivers} for t in types]
        result["date"] = day
        return result

    @hsseq_route("/hsseq/qualifications/alerts", profiles=ALERTS_READ)
    def alerts(self, **kw):
        """Alertes J-30 et J-7 envoyées (habilitations, aptitudes, documents des véhicules)."""
        domain = [("company_id", "in", companies(kw).ids)]
        if kw.get("kind"):
            domain.append(("kind", "in", kw["kind"].split(",")))
        if "rh" in request.env.user._eguitra_profiles() and not set(request.env.user._eguitra_profiles()) & {
                "admin", "direction", "hsseq"}:
            domain.append(("kind", "!=", "vehicle_document"))
        Alert = request.env["eguitra.hsseq.expiry.alert"].sudo()
        rows = Alert.search(domain, limit=500)
        return [{"id": a.id, "kind": a.kind, "subject": a.subject, "label": a.label, "expires_on": a.expiry_date,
                 "stage": a.stage, "reason_code": a.reason_code or None, "site": site_ref(a.site_id),
                 "sent_at": a.sent_at, "recipients": len(a.recipient_ids)} for a in rows]
