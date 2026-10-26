"""API des audits et de la conformité (spécification §3, §7) : programme d'audits et son cycle, constats et
leurs actions, registre des exigences et leur revue, registres en Excel.

Gestion par hsseq. Lecture des audits et des constats : administration, direction, hsseq ; chef de parc et
auditeur pour ceux de leurs sites (portée fermée par défaut : un audit sans site n'est lu que des profils
de lecture complète). Registre des exigences : administration, direction, hsseq et auditeur."""

from collections import Counter

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, read_json, require
from odoo.addons.eguitra_finance.controllers.exporting import export_meta, table_response

from ..models.common import (
    AUDIT_STANDARDS,
    AUDIT_STATUSES,
    AUDITOR_KINDS,
    FINDING_CLASSES,
    FINDING_STATUSES,
    REQUIREMENT_SOURCES,
    REQUIREMENT_STATUSES,
    STANDARDS,
)
from .actions import action_line
from .common import (
    HSSEQ,
    attachments_rows,
    companies,
    date_value,
    get,
    history,
    hsseq_route,
    in_scope,
    int_or_none,
    is_hsseq,
    page,
    page_args,
    profiles,
    ref,
    scope_domain,
    site_ref,
    text,
    user_ref,
)

AUDIT_READ = ("admin", "direction", "hsseq", "exploitation", "auditeur")
REQUIREMENT_READ = ("admin", "direction", "hsseq", "auditeur")
AUDIT_TRANSITIONS = ("perform", "close", "reopen", "cancel")
AUDIT_SORTS = {"planned_date": "planned_date", "reference": "reference", "status": "status"}
REQUIREMENT_SORTS = {"reference": "reference", "source": "source", "status": "status",
                     "next_review_date": "next_review_date"}


def today():
    return fields.Date.context_today(request.env.user)


# ─── Audits ───────────────────────────────────────────────────────────────


def audit_domain(kw):
    return [("company_id", "in", companies(kw).ids)] + scope_domain()


def audit_list_domain(kw):
    """Domaine de la liste des audits (et de son export) : portée du compte, filtres, année ou période."""
    domain = audit_domain(kw)
    if kw.get("status"):
        domain.append(("status", "in", kw["status"].split(",")))
    if kw.get("standard"):
        domain.append(("standard", "in", kw["standard"].split(",")))
    if kw.get("site_id"):
        domain.append(("site_id", "=", int_or_none(kw, "site_id")))
    year = int_or_none(kw, "year") or today().year
    start, end = date_value(kw, "date_from"), date_value(kw, "date_to")
    domain.append(("planned_date", ">=", start or today().replace(year=year, month=1, day=1)))
    domain.append(("planned_date", "<=", end or today().replace(year=year, month=12, day=31)))
    return domain


def reads_requirements():
    return bool(profiles() & set(REQUIREMENT_READ))


def get_audit(audit_id):
    audit = get("eguitra.hsseq.audit", audit_id, "Audit")
    if not in_scope(audit.site_id):
        raise ApiError(404, "not_found", "Audit introuvable.")
    return audit


def audit_rights(audit):
    hsseq = is_hsseq()
    transitions = [t for t in audit._transitions() if hsseq]
    if "close" in transitions and audit._majors_without_action():
        transitions.remove("close")
    return transitions, {"can_edit": hsseq and audit.status in ("planned", "done"), "can_close": "close" in transitions,
                         "can_approve": False}


def finding_row(finding):
    finding = finding.sudo()
    return {"id": finding.id, "reference": finding.reference, "audit": {"id": finding.audit_id.id,
                                                                        "reference": finding.audit_id.reference},
            "classification": finding.classification, "description": finding.description,
            "requirement": {"id": finding.requirement_id.id, "reference": finding.requirement_id.reference,
                            "title": finding.requirement_id.title} if finding.requirement_id else None,
            "status": finding.status, "site": site_ref(finding.site_id),
            "actions": [action_line(a) for a in finding.action_ids],
            "attachments": attachments_rows("finding", finding),
            "rights": {"can_edit": is_hsseq() and finding.audit_id.status in ("planned", "done"), "can_close": False,
                       "can_approve": False}}


def audit_line(audit):
    audit = audit.sudo()
    counts = Counter(audit.finding_ids.mapped("classification"))
    return {
        "id": audit.id, "reference": audit.reference, "title": audit.title, "standard": audit.standard,
        "partner": ref(audit.partner_id), "site": site_ref(audit.site_id), "auditor_kind": audit.auditor_kind,
        "auditor": user_ref(audit.auditor_user_id) if audit.auditor_kind == "internal" else
        ({"id": None, "name": audit.auditor_name} if audit.auditor_name else None),
        "planned_date": audit.planned_date, "actual_date": audit.actual_date or None, "status": audit.status,
        "findings": {code: counts.get(code, 0) for code, _l in FINDING_CLASSES},
        "open_findings": len(audit.finding_ids.filtered(lambda f: f.status == "open")),
    }


def audit_detail(audit):
    audit = audit.sudo()
    transitions, rights = audit_rights(audit)
    row = audit_line(audit)
    row.update({
        "company": {"id": audit.company_id.id, "name": audit.company_id.name}, "scope": audit.scope or None,
        "conclusion": audit.conclusion or None, "closed_at": audit.closed_at or None,
        "closed_by": user_ref(audit.closed_by), "cancel_reason": audit.cancel_reason or None,
        "reopen_reason": audit.reopen_reason or None,
        "findings_list": [finding_row(f) for f in audit.finding_ids],
        "majors_without_action": audit._majors_without_action().ids,
        "attachments": attachments_rows("audit", audit), "history": history("audit", audit),
        "transitions": transitions, "rights": rights,
    })
    return row


def audit_values(data, audit=None):
    values = {}
    if "title" in data:
        values["title"] = text(data, "title", 300)
        if not values["title"]:
            raise ApiError(400, "missing_fields", "Intitulé de l'audit manquant.", fields=["title"])
    if "standard" in data:
        if data["standard"] not in dict(AUDIT_STANDARDS):
            raise ApiError(400, "invalid_parameter", "Programme : iso_45001, iso_14001, iso_9001, client ou internal.",
                           fields=["standard"])
        values["standard"] = data["standard"]
    if "auditor_kind" in data:
        if data["auditor_kind"] not in dict(AUDITOR_KINDS):
            raise ApiError(400, "invalid_parameter", "Auditeur : internal ou external.", fields=["auditor_kind"])
        values["auditor_kind"] = data["auditor_kind"]
    for key, limit in (("scope", 4000), ("conclusion", 4000), ("auditor_name", 200)):
        if key in data:
            values[key] = text(data, key, limit)
    for key in ("planned_date", "actual_date"):
        if key in data:
            values[key] = date_value(data, key)
    if "planned_date" in values and not values["planned_date"]:
        raise ApiError(400, "missing_fields", "Date prévue manquante.", fields=["planned_date"])
    if "site_id" in data:
        site = get("eguitra.hsseq.site", data["site_id"], "Site") if data["site_id"] else None
        values["site_id"] = site.id if site else False
    if "partner_id" in data:
        partner = request.env["res.partner"].sudo().browse(int_or_none(data, "partner_id") or 0).exists()
        values["partner_id"] = partner.id or False
    if "auditor_id" in data:
        user = request.env["res.users"].sudo().browse(int_or_none(data, "auditor_id") or 0).exists()
        if user and user.share:
            raise ApiError(422, "business_rule", "Auditeur interne : un compte interne.", fields=["auditor_id"])
        values["auditor_user_id"] = user.id or False
    return values


def finding_values(data, partial=False):
    values = {}
    if not partial or "classification" in data:
        if data.get("classification") not in dict(FINDING_CLASSES):
            raise ApiError(400, "invalid_parameter", "Classement : major, minor ou observation.",
                           fields=["classification"])
        values["classification"] = data["classification"]
    if not partial or "description" in data:
        values["description"] = text(data, "description", 4000)
        if not values["description"]:
            raise ApiError(400, "missing_fields", "Description du constat manquante.", fields=["description"])
    if "requirement_id" in data:
        requirement = get("eguitra.hsseq.requirement", data["requirement_id"], "Exigence") if data["requirement_id"] \
            else None
        values["requirement_id"] = requirement.id if requirement else False
    if "sequence" in data:
        values["sequence"] = int_or_none(data, "sequence") or 10
    return values


# ─── Exigences ────────────────────────────────────────────────────────────


def requirement_row(requirement, detail=False):
    requirement = requirement.sudo()
    row = {
        "id": requirement.id, "reference": requirement.reference, "source": requirement.source,
        "standard": requirement.standard or None, "partner": ref(requirement.partner_id),
        "source_reference": requirement.source_reference, "title": requirement.title,
        "summary": requirement.summary or None, "expected_evidence": requirement.expected_evidence or None,
        "status": requirement.status, "last_review_at": requirement.last_review_at or None,
        "last_reviewed_by": user_ref(requirement.last_reviewed_by), "next_review_date": requirement.next_review_date or None,
        "review_overdue": bool(requirement.next_review_date and requirement.next_review_date < today()),
        "evidence": attachments_rows("requirement", requirement),
        "rights": {"can_edit": is_hsseq(), "can_close": False, "can_approve": is_hsseq()},
    }
    if detail:
        row.update({"review_comment": requirement.review_comment or None,
                    "findings": [{"id": f.id, "reference": f.reference, "classification": f.classification,
                                  "status": f.status} for f in requirement.finding_ids if in_scope(f.site_id)],
                    "history": history("requirement", requirement),
                    "transitions": ["review"] if is_hsseq() else []})
    return row


def requirement_values(data, partial=False):
    values = {}
    if not partial or "source" in data:
        if data.get("source") not in dict(REQUIREMENT_SOURCES):
            raise ApiError(400, "invalid_parameter", "Source : law, standard ou client_contract.", fields=["source"])
        values["source"] = data["source"]
    if "standard" in data:
        if data["standard"] and data["standard"] not in dict(STANDARDS):
            raise ApiError(400, "invalid_parameter", "Référentiel inconnu.", fields=["standard"])
        values["standard"] = data["standard"] or False
    for key, limit, mandatory in (("source_reference", 300, True), ("title", 300, True), ("summary", 4000, False),
                                  ("expected_evidence", 4000, False)):
        if not partial or key in data:
            values[key] = text(data, key, limit)
            if mandatory and not values[key]:
                raise ApiError(400, "missing_fields", "Référence et intitulé de l'exigence sont obligatoires.",
                               fields=[key])
    if "partner_id" in data:
        partner = request.env["res.partner"].sudo().browse(int_or_none(data, "partner_id") or 0).exists()
        values["partner_id"] = partner.id or False
    if "next_review_date" in data:
        values["next_review_date"] = date_value(data, "next_review_date")
    return values


class EguitraHsseqAudits(http.Controller):
    # ─── Audits ───────────────────────────────────────────────────────────

    @hsseq_route("/hsseq/audits", profiles=AUDIT_READ)
    def audits(self, **kw):
        domain = audit_list_domain(kw)
        offset, limit, order = page_args(kw, "planned_date", AUDIT_SORTS)
        Audit = request.env["eguitra.hsseq.audit"].sudo()
        rows = Audit.search(domain, offset=offset, limit=limit, order=order)
        planned = Audit.search(domain + [("status", "!=", "cancelled")])
        done = planned.filtered(lambda a: a.status in ("done", "closed"))
        counts = {"by_status": {code: Audit.search_count(domain + [("status", "=", code)]) for code, _l in AUDIT_STATUSES},
                  "planned": len(planned), "done": len(done),
                  "completion_rate": round(len(done) * 100 / len(planned), 1) if planned else None}
        return page([audit_line(a) for a in rows], Audit.search_count(domain), offset, limit, counts)

    @hsseq_route("/hsseq/audits/<int:audit_id>", profiles=AUDIT_READ)
    def audit(self, audit_id, **_kw):
        return audit_detail(get_audit(audit_id))

    @hsseq_route("/hsseq/audits", methods=("POST",), profiles=HSSEQ)
    def create_audit(self, **_kw):
        data = read_json()
        require(data, "title", "standard", "planned_date")
        company = companies(data)[:1] if data.get("company_id") else request.env.company
        audit = request.env["eguitra.hsseq.audit"].sudo().create(dict(audit_values(data), company_id=company.id))
        return audit_detail(audit)

    @hsseq_route("/hsseq/audits/<int:audit_id>", methods=("PATCH",), profiles=HSSEQ)
    def update_audit(self, audit_id, **_kw):
        audit = get_audit(audit_id)
        if audit.status not in ("planned", "done"):
            raise ApiError(422, "invalid_transition", "Audit clos ou annulé : rouvrez-le avant de le modifier.")
        audit.write(audit_values(read_json(), audit))
        return audit_detail(audit)

    @hsseq_route("/hsseq/audits/<int:audit_id>/<string:transition>", methods=("POST",), profiles=HSSEQ)
    def audit_transition(self, audit_id, transition, **_kw):
        if transition not in AUDIT_TRANSITIONS:
            raise ApiError(404, "not_found", "Transition inconnue.")
        audit = get_audit(audit_id)
        data = read_json()
        if transition == "perform":
            audit.action_perform(date_value(data, "actual_date"))
        elif transition == "close":
            audit.action_close()
        elif transition == "reopen":
            audit.action_reopen(data.get("reason"))
        else:
            audit.action_cancel(data.get("reason"))
        return audit_detail(audit)

    # ─── Constats ─────────────────────────────────────────────────────────

    @hsseq_route("/hsseq/audits/<int:audit_id>/findings", methods=("POST",), profiles=HSSEQ)
    def create_finding(self, audit_id, **_kw):
        audit = get_audit(audit_id)
        if audit.status not in ("planned", "done"):
            raise ApiError(422, "invalid_transition", "Audit clos ou annulé : plus de constat.")
        request.env["eguitra.hsseq.finding"].sudo().create(dict(finding_values(read_json()), audit_id=audit.id))
        return audit_detail(audit)

    @hsseq_route("/hsseq/findings", profiles=AUDIT_READ)
    def findings(self, **kw):
        domain = [("company_id", "in", companies(kw).ids)] + scope_domain()
        if kw.get("classification"):
            domain.append(("classification", "in", kw["classification"].split(",")))
        if kw.get("status"):
            domain.append(("status", "in", kw["status"].split(",")))
        for key in ("audit_id", "requirement_id", "site_id"):
            if kw.get(key):
                domain.append((key, "=", int_or_none(kw, key)))
        offset, limit, order = page_args(kw, "-id", {"id": "id"})
        Finding = request.env["eguitra.hsseq.finding"].sudo()
        rows = Finding.search(domain, offset=offset, limit=limit, order=order)
        open_domain = domain + [("status", "=", "open")]
        counts = {"by_status": {code: Finding.search_count(domain + [("status", "=", code)]) for code, _l in FINDING_STATUSES},
                  "open_by_class": {code: Finding.search_count(open_domain + [("classification", "=", code)])
                                    for code, _l in FINDING_CLASSES}}
        return page([finding_row(f) for f in rows], Finding.search_count(domain), offset, limit, counts)

    @hsseq_route("/hsseq/findings/<int:finding_id>", profiles=AUDIT_READ)
    def finding(self, finding_id, **_kw):
        finding = get("eguitra.hsseq.finding", finding_id, "Constat")
        if not in_scope(finding.site_id):
            raise ApiError(404, "not_found", "Constat introuvable.")
        return finding_row(finding)

    @hsseq_route("/hsseq/findings/<int:finding_id>", methods=("PATCH",), profiles=HSSEQ)
    def update_finding(self, finding_id, **_kw):
        finding = get("eguitra.hsseq.finding", finding_id, "Constat")
        if finding.audit_id.status not in ("planned", "done"):
            raise ApiError(422, "invalid_transition", "Audit clos ou annulé : le constat ne se modifie plus.")
        finding.write(finding_values(read_json(), partial=True))
        return finding_row(finding)

    # ─── Exigences ────────────────────────────────────────────────────────

    def _requirement_domain(self, kw):
        domain = [("company_id", "in", companies(kw).ids)]
        for key in ("source", "status", "standard"):
            if kw.get(key):
                domain.append((key, "in", kw[key].split(",")))
        if kw.get("partner_id"):
            domain.append(("partner_id", "=", int_or_none(kw, "partner_id")))
        if str(kw.get("review_overdue", "")) in ("1", "true"):
            domain.append(("next_review_date", "<", today()))
        if kw.get("search"):
            q = kw["search"]
            domain += ["|", "|", ("reference", "ilike", q), ("title", "ilike", q), ("source_reference", "ilike", q)]
        return domain

    @hsseq_route("/hsseq/requirements", profiles=REQUIREMENT_READ)
    def requirements(self, **kw):
        domain = self._requirement_domain(kw)
        offset, limit, order = page_args(kw, "reference", REQUIREMENT_SORTS)
        Requirement = request.env["eguitra.hsseq.requirement"].sudo()
        rows = Requirement.search(domain, offset=offset, limit=limit, order=order)
        counts = {"by_status": {code: Requirement.search_count(domain + [("status", "=", code)])
                                for code, _l in REQUIREMENT_STATUSES}}
        return page([requirement_row(r) for r in rows], Requirement.search_count(domain), offset, limit, counts)

    @hsseq_route("/hsseq/requirements/<int:requirement_id>", profiles=REQUIREMENT_READ)
    def requirement(self, requirement_id, **_kw):
        return requirement_row(get("eguitra.hsseq.requirement", requirement_id, "Exigence"), detail=True)

    @hsseq_route("/hsseq/requirements", methods=("POST",), profiles=HSSEQ)
    def create_requirement(self, **_kw):
        data = read_json()
        require(data, "source", "source_reference", "title")
        company = companies(data)[:1] if data.get("company_id") else request.env.company
        requirement = request.env["eguitra.hsseq.requirement"].sudo().create(
            dict(requirement_values(data), company_id=company.id))
        return requirement_row(requirement, detail=True)

    @hsseq_route("/hsseq/requirements/<int:requirement_id>", methods=("PATCH",), profiles=HSSEQ)
    def update_requirement(self, requirement_id, **_kw):
        requirement = get("eguitra.hsseq.requirement", requirement_id, "Exigence")
        requirement.write(requirement_values(read_json(), partial=True))
        return requirement_row(requirement, detail=True)

    @hsseq_route("/hsseq/requirements/<int:requirement_id>/review", methods=("POST",), profiles=HSSEQ)
    def review_requirement(self, requirement_id, **_kw):
        requirement = get("eguitra.hsseq.requirement", requirement_id, "Exigence")
        data = read_json()
        require(data, "status")
        requirement.action_review(data["status"], text(data, "comment", 2000), date_value(data, "next_review_date"))
        return requirement_row(requirement, detail=True)

    # ─── Registres ────────────────────────────────────────────────────────

    @hsseq_route("/hsseq/audits/export.xlsx", profiles=AUDIT_READ)
    def export(self, **kw):
        """Registre des audits et des constats, avec les mêmes domaines que les listes au même compte ;
        la feuille des exigences pour les seuls profils qui lisent le registre des exigences."""
        Audit = request.env["eguitra.hsseq.audit"].sudo()
        audits = Audit.search(audit_list_domain(kw), order="planned_date, id", limit=10000)
        standards, statuses, classes = dict(AUDIT_STANDARDS), dict(AUDIT_STATUSES), dict(FINDING_CLASSES)
        sources, req_statuses = dict(REQUIREMENT_SOURCES), dict(REQUIREMENT_STATUSES)
        meta = export_meta(companies(kw))
        sheets = [
            {"title": "Programme d'audits", "meta": meta,
             "columns": [("Référence", "text"), ("Audit", "text"), ("Programme", "text"), ("Site", "text"),
                         ("Auditeur", "text"), ("Prévu le", "date"), ("Réalisé le", "date"), ("État", "text"),
                         ("Écarts majeurs", "int"), ("Écarts mineurs", "int"), ("Observations", "int")],
             "rows": [[a.reference, a.title, standards.get(a.standard), a.site_id.name or "",
                       a.auditor_user_id.name if a.auditor_kind == "internal" else (a.auditor_name or ""),
                       a.planned_date, a.actual_date or None, statuses.get(a.status)]
                      + [len(a.finding_ids.filtered(lambda f, c=c: f.classification == c)) for c in classes]
                      for a in audits], "totals": None},
            {"title": "Constats", "meta": meta,
             "columns": [("Référence", "text"), ("Audit", "text"), ("Classement", "text"), ("Constat", "text"),
                         ("Exigence", "text"), ("Statut", "text"), ("Actions", "text")],
             "rows": [[f.reference, f.audit_id.reference, classes.get(f.classification), f.description,
                       f.requirement_id.reference or "", dict(FINDING_STATUSES).get(f.status),
                       ", ".join(f.action_ids.mapped("reference"))] for f in audits.finding_ids], "totals": None},
        ]
        if reads_requirements():
            requirements = request.env["eguitra.hsseq.requirement"].sudo().search(
                self._requirement_domain(kw), order="source, source_reference, id", limit=10000)
            sheets.append({
                "title": "Registre des exigences", "meta": meta,
                "columns": [("Référence", "text"), ("Source", "text"), ("Référence du texte", "text"),
                            ("Exigence", "text"), ("Preuve attendue", "text"), ("Statut", "text"),
                            ("Dernière revue", "date"), ("Prochaine revue", "date")],
                "rows": [[r.reference, sources.get(r.source), r.source_reference, r.title, r.expected_evidence or "",
                          req_statuses.get(r.status), r.last_review_at.date() if r.last_review_at else None,
                          r.next_review_date or None] for r in requirements], "totals": None})
        return table_response(f"audits_conformite_hsseq_{today():%Y%m%d}", sheets)
