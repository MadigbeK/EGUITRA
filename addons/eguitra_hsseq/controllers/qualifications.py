"""API des habilitations (spécification §3, §9.3) : matrice des compétences par conducteur, lue dans RH,
statuts seulement (valid, to_renew, expired, missing), aptitude en statut seul, jamais de détail médical,
EPI remis ; filtres société, site, statut, type et blocage du verrou (V04) ; alertes J-30 et J-7 envoyées ;
habilitations exigées selon le profil du véhicule (citerne, benne).

Lecture : administration, direction, hsseq, RH ; chef de parc pour les conducteurs de ses sites. Le
conducteur lit ses propres habilitations par GET /hsseq/me. L'écriture des habilitations reste dans RH ; les
exigences par profil de véhicule se règlent par l'administration et hsseq."""

from collections import Counter
from datetime import timedelta

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, read_json

from ..models.qualification import STATUS_RANK, driver_kinds, driver_sites
from .common import (
    CONFIG,
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
    vehicles = env["eguitra.transport.vehicle"].sudo().search([("company_id", "in", comps.ids)])
    on_site, kinds = driver_sites(vehicles), driver_kinds(vehicles)
    obligations = env["eguitra.hsseq.qualification.rule"]._obligations()
    scope = site_scope(QUAL_FULL)
    rows = []
    for employee in employees:
        driver_site = on_site.get(employee.driver_id.id)
        if site and driver_site != site:
            continue
        if scope is not None and not (driver_site and driver_site in scope):
            continue
        row = employee._hsseq_matrix_row(types, day, kinds.get(employee.driver_id.id), obligations)
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
            # Avec un filtre de type : le statut de la case des types filtrés ; sinon le statut d'ensemble.
            if codes:
                rows = [r for r in rows if any(c["status"] in wanted for c in r["qualifications"])]
            else:
                rows = [r for r in rows if r["status"] in wanted]
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
        obligations = request.env["eguitra.hsseq.qualification.rule"]._obligations()
        result["types"] = [dict(type_obligation(t, obligations), mandatory=t.mandatory_for_drivers) for t in types]
        result["date"] = day
        return result

    @hsseq_route("/hsseq/qualifications/alerts", profiles=ALERTS_READ)
    def alerts(self, **kw):
        """Alertes J-30 et J-7 envoyées (habilitations, aptitudes, documents des véhicules)."""
        domain = [("company_id", "in", companies(kw).ids)]
        if kw.get("kind"):
            domain.append(("kind", "in", kw["kind"].split(",")))
        # Période d'envoi, puis d'expiration.
        for key, field, op in (("date_from", "sent_at", ">="), ("date_to", "sent_at", "<"),
                               ("expires_from", "expiry_date", ">="), ("expires_to", "expiry_date", "<=")):
            day = date_value(kw, key)
            if day:
                domain.append((field, op, day + timedelta(days=1) if key == "date_to" else day))
        if "rh" in request.env.user._eguitra_profiles() and not set(request.env.user._eguitra_profiles()) & {
                "admin", "direction", "hsseq"}:
            domain.append(("kind", "!=", "vehicle_document"))
        Alert = request.env["eguitra.hsseq.expiry.alert"].sudo()
        rows = Alert.search(domain, limit=500)
        return [alert_row(a) for a in rows]

    # ─── Habilitations exigées selon le profil du véhicule ────────────────

    @hsseq_route("/hsseq/qualifications/rules", profiles=QUAL_READ)
    def rules(self, **_kw):
        """Pour chaque type d'habilitation de RH : exigée des conducteurs de citerne, de benne (rule : réglée
        par HSSEQ ; sinon l'obligation de RH vaut pour les deux)."""
        obligations = request.env["eguitra.hsseq.qualification.rule"]._obligations()
        return [type_obligation(t, obligations) for t in qualification_types()]

    @hsseq_route("/hsseq/qualifications/rules", methods=("PATCH",), profiles=CONFIG)
    def update_rules(self, **_kw):
        """{rules: [{code, tanker, tipper}]} (booléens stricts) ; {code, reset: true} rend l'obligation de RH."""
        data = read_json()
        rows = data.get("rules")
        if not isinstance(rows, list):
            raise ApiError(400, "invalid_parameter", "Règles attendues : rules, une liste.", fields=["rules"])
        types = {t.code: t for t in qualification_types()}
        Rule = request.env["eguitra.hsseq.qualification.rule"].sudo()
        Journal = request.env["eguitra.hsseq.journal"]
        for row in rows:
            qual_type = types.get(row.get("code")) if isinstance(row, dict) else None
            if not qual_type:
                raise ApiError(400, "invalid_parameter", "Type d'habilitation inconnu.", fields=["rules"])
            rule = Rule.search([("type_id", "=", qual_type.id)], limit=1)
            if row.get("reset") is True:
                if rule:
                    Journal._log("qualification_rule", rule, "reset", note=qual_type.code)
                    rule.unlink()
                continue
            if not all(isinstance(row.get(k), bool) for k in ("tanker", "tipper")):
                raise ApiError(400, "invalid_parameter", "tanker et tipper : des booléens.", fields=["rules"])
            before = f"citerne {rule.tanker}, benne {rule.tipper}" if rule else "obligation de RH"
            values = {"tanker": row["tanker"], "tipper": row["tipper"]}
            if rule:
                rule.write(values)
            else:
                rule = Rule.create(dict(values, type_id=qual_type.id))
            Journal._log("qualification_rule", rule, "write", field=qual_type.code, old=before,
                         new=f"citerne {rule.tanker}, benne {rule.tipper}")
        obligations = Rule._obligations()
        return [type_obligation(t, obligations) for t in qualification_types()]


def type_obligation(qual_type, obligations):
    flags = obligations.get(qual_type.code, {"tanker": False, "tipper": False, "rule": False})
    return {"code": qual_type.code, "name": qual_type.name, "tanker": flags["tanker"], "tipper": flags["tipper"],
            "rule": flags["rule"], "rh_mandatory": qual_type.mandatory_for_drivers}


def alert_row(alert):
    """Alerte envoyée, avec ce qu'elle suit : salarié et type d'habilitation, ou ensemble et document."""
    parts = (alert.key or "").split(":")
    subject_id = int(parts[1]) if len(parts) == 3 and parts[1].isdigit() else None
    return {"id": alert.id, "key": alert.key, "kind": alert.kind, "subject": alert.subject, "label": alert.label,
            "employee_id": subject_id if parts[0] == "employee" else None,
            "vehicle_id": subject_id if parts[0] == "vehicle" else None,
            "item_code": parts[2] if len(parts) == 3 else None, "expires_on": alert.expiry_date, "stage": alert.stage,
            "reason_code": alert.reason_code or None, "site": site_ref(alert.site_id), "sent_at": alert.sent_at,
            "recipients": len(alert.recipient_ids)}
