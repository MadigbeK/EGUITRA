"""API des documents et des urgences (spécification §3, §9.4, lot 3) : procédures versionnées et leurs accusés
de lecture, alertes flash et retours d'expérience anonymisés, plans d'intervention d'urgence et exercices,
annuaire de crise ; espace « mes documents » du compte (NIMOVA Terrain pour le conducteur).

Droits : hsseq rédige, publie, relance et archive. Lecture de gestion (taux de lecture, comptes en retard) :
administration, direction, hsseq ; l'auditeur lit les procédures et les alertes diffusées qui se rapportent à
ses sites, sans les noms des lecteurs. Plans, exercices et annuaire : administration, direction, hsseq, chef
de parc et auditeur pour leurs sites (un contact sans site vaut pour tous les sites). Tout compte interne lit
et accuse lecture des procédures en vigueur et des alertes diffusées qui le visent, et lit l'annuaire de
crise de ses sites (GET /hsseq/my/…)."""

from datetime import timedelta

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, read_json, require
from odoo.addons.eguitra_finance.controllers.exporting import export_meta, table_response

from ..models.common import (
    AUDIENCE_PROFILES,
    BULLETIN_KINDS,
    BULLETIN_STATUSES,
    DOMAINS,
    DRILL_STATUSES,
    PROCEDURE_STATUSES,
    SCENARIOS,
)
from .actions import action_line
from .common import (
    HSSEQ,
    attachments_rows,
    companies,
    company_ref,
    date_value,
    datetime_value,
    forbidden,
    get,
    history,
    hsseq_route,
    ids_list,
    in_scope,
    int_or_none,
    internal_only,
    is_hsseq,
    my_sites,
    page,
    page_args,
    personal_data_hidden,
    profiles,
    reads_all,
    scope_domain,
    site_ref,
    terrain_source,
    text,
    user_ref,
)

DOC_READ = ("admin", "direction", "hsseq", "auditeur")
PLAN_READ = ("admin", "direction", "hsseq", "exploitation", "auditeur")
PROCEDURE_TRANSITIONS = ("remind", "archive", "reactivate")
BULLETIN_TRANSITIONS = ("publish", "remind", "archive")
DRILL_TRANSITIONS = ("perform", "cancel", "reopen")
EXPORT_LIMIT = 10000


def today():
    return fields.Date.context_today(request.env.user)


def account_sites():
    """Sites de la portée du compte (None : tous les sites, profils de lecture complète)."""
    return None if reads_all() else my_sites()


def audience_values(data, values):
    """Public visé : codes de profil et sites (des sociétés du compte)."""
    if "audience_profiles" in data:
        codes = data["audience_profiles"]
        if not isinstance(codes, list) or not codes or set(codes) - set(AUDIENCE_PROFILES):
            raise ApiError(400, "invalid_parameter", "Public visé : au moins un profil parmi "
                                                     + ", ".join(AUDIENCE_PROFILES) + ".", fields=["audience_profiles"])
        values["audience_profiles"] = list(dict.fromkeys(codes))
    if "site_ids" in data:
        sites = request.env["eguitra.hsseq.site"].sudo().browse(ids_list(data, "site_ids")).exists()
        if sites.filtered(lambda s: s.company_id not in request.env.companies):
            raise forbidden("Site non autorisé.")
        values["site_ids"] = [(6, 0, sites.ids)]
    return values


def audience_row(record):
    return {"profiles": list(record.audience_profiles or []), "sites": [site_ref(s) for s in record.site_ids]}


def read_at(data):
    """Heure de lecture sur l'appareil : jamais dans le futur (cinq minutes de décalage d'horloge tolérées)."""
    value = datetime_value(data, "read_at") or fields.Datetime.now()
    if (value - fields.Datetime.now()).total_seconds() > 300:
        raise ApiError(400, "invalid_parameter", "Heure de lecture dans le futur.", fields=["read_at"])
    return value


def readers(record, targets):
    """Lecteurs et comptes en retard de lecture (noms retirés pour l'auditeur)."""
    acks = {a.user_id.id: a for a in record.acknowledgment_ids}
    if personal_data_hidden():
        return None, None
    read = [{"user": user_ref(u), "read_at": acks[u.id].read_at, "source": acks[u.id].source}
            for u in targets if u.id in acks]
    unread = [user_ref(u) for u in targets if u.id not in acks]
    return read, unread


# ─── Procédures ───────────────────────────────────────────────────────────


def version_row(version):
    if not version:
        return None
    version = version.sudo()
    return {"id": version.id, "version": version.version, "effective_date": version.effective_date,
            "change_summary": version.change_summary or None, "status": version.status,
            "published_at": version.published_at or None, "published_by": user_ref(version.published_by),
            "document": attachments_rows("procedure_version", version)}


def can_manage_read(procedure):
    """Lecture de gestion : profils de lecture complète ; auditeur pour une procédure de ses sites."""
    return reads_all() or ("auditeur" in profiles() and procedure._applies_to_sites(my_sites()))


def can_read_version(version):
    """Le document d'une version : gestion, ou compte visé par la procédure en vigueur."""
    procedure = version.sudo().procedure_id
    if can_manage_read(procedure):
        return True
    return version.status == "published" and procedure.status == "published" and procedure._applies_to(
        request.env.user)


def procedure_rights(procedure):
    hsseq = is_hsseq()
    transitions = [t for t in procedure._transitions() if hsseq]
    draft = procedure._draft_version()
    return transitions, {"can_edit": hsseq and procedure.status != "archived", "can_close": "archive" in transitions,
                         "can_approve": hsseq and bool(draft) and procedure.status != "archived"}


def audience_index(comps=None):
    """Comptes des sociétés avec leurs profils et leurs sites, calculés une fois par requête."""
    return request.env["eguitra.hsseq.procedure"].sudo()._audience_index(comps or request.env.companies)


def procedure_row(procedure, detail=False, index=None):
    procedure = procedure.sudo()
    transitions, rights = procedure_rights(procedure)
    current = procedure.current_version_id
    targets = procedure._audience_users(index) if current and procedure.status == "published" else None
    row = {"id": procedure.id, "code": procedure.code, "title": procedure.title, "domain": procedure.domain or None,
           "audience": audience_row(procedure), "status": procedure.status, "owner": user_ref(procedure.owner_id),
           "current_version": version_row(current), "draft_version": version_row(procedure._draft_version()),
           "read": current._read_stats(targets) if targets is not None else None, "rights": rights}
    if detail:
        read, unread = readers(current, targets) if targets is not None else (None, None)
        row.update({"company": company_ref(procedure.company_id), "description": procedure.description or None,
                    "versions": [version_row(v) for v in procedure.version_ids],
                    "readers": read, "unread": unread, "archive_reason": procedure.archive_reason or None,
                    "history": history("procedure", procedure), "transitions": transitions})
    return row


def get_procedure(procedure_id):
    procedure = get("eguitra.hsseq.procedure", procedure_id, "Procédure")
    if not can_manage_read(procedure):
        raise ApiError(404, "not_found", "Procédure introuvable.")
    return procedure


def procedure_values(data, partial=False):
    values = {}
    for key, limit, mandatory in (("code", 64, True), ("title", 300, True), ("description", 4000, False)):
        if not partial or key in data:
            values[key] = text(data, key, limit)
            if mandatory and not values[key]:
                raise ApiError(400, "missing_fields", "Référence et titre de la procédure sont obligatoires.",
                               fields=[key])
    if "domain" in data:
        if data["domain"] and data["domain"] not in dict(DOMAINS):
            raise ApiError(400, "invalid_parameter", "Domaine inconnu.", fields=["domain"])
        values["domain"] = data["domain"] or False
    if "owner_id" in data:
        owner = request.env["res.users"].sudo().browse(int_or_none(data, "owner_id") or 0).exists()
        if owner and owner.share:
            raise ApiError(422, "business_rule", "Responsable du document : un compte interne.", fields=["owner_id"])
        values["owner_id"] = owner.id or False
    return audience_values(data, values)


def version_values(data, partial=False):
    values = {}
    if not partial or "version" in data:
        values["version"] = text(data, "version", 32)
        if not values["version"]:
            raise ApiError(400, "missing_fields", "Numéro de version manquant.", fields=["version"])
    if not partial or "effective_date" in data:
        values["effective_date"] = date_value(data, "effective_date")
        if not values["effective_date"]:
            raise ApiError(400, "missing_fields", "Date d'effet manquante.", fields=["effective_date"])
    if "change_summary" in data:
        values["change_summary"] = text(data, "change_summary", 4000)
    return values


def get_version(procedure, version_id):
    version = procedure.sudo().version_ids.filtered(lambda v: v.id == version_id)
    if not version:
        raise ApiError(404, "not_found", "Version introuvable pour cette procédure.")
    return version


# ─── Alertes et retours d'expérience ──────────────────────────────────────


def can_read_bulletin(bulletin):
    """Gestion (lecture complète), auditeur pour une alerte diffusée de ses sites, ou compte visé."""
    bulletin = bulletin.sudo()
    if reads_all():
        return True
    if bulletin.status == "draft":
        return False
    if "auditeur" in profiles() and bulletin._applies_to_sites(my_sites()):
        return True
    return bulletin.status == "published" and bulletin._applies_to(request.env.user)


def bulletin_rights(bulletin):
    hsseq = is_hsseq()
    transitions = [t for t in bulletin._transitions() if hsseq]
    return transitions, {"can_edit": hsseq and bulletin.status == "draft", "can_close": "archive" in transitions,
                         "can_approve": "publish" in transitions}


def bulletin_row(bulletin, detail=False, index=None):
    bulletin = bulletin.sudo()
    transitions, rights = bulletin_rights(bulletin)
    published = bulletin.status != "draft"
    targets = bulletin._audience_users(index) if published and (reads_all() or "auditeur" in profiles()) else None
    row = {"id": bulletin.id, "reference": bulletin.reference, "kind": bulletin.kind, "title": bulletin.title,
           "status": bulletin.status, "audience": audience_row(bulletin), "published_at": bulletin.published_at or None,
           "read": bulletin._read_stats(targets) if targets is not None else None, "rights": rights}
    if detail:
        read, unread = readers(bulletin, targets) if targets is not None else (None, None)
        row.update({"company": company_ref(bulletin.company_id), "body": bulletin.body,
                    "key_messages": bulletin.key_messages or None,
                    # Événement d'origine : jamais servi hors des profils de lecture complète.
                    "event": {"id": bulletin.event_id.id, "reference": bulletin.event_id.reference}
                    if bulletin.event_id and reads_all() else None,
                    "published_by": user_ref(bulletin.published_by) if not personal_data_hidden() else None,
                    "anonymity_findings": bulletin._anonymity_findings()
                    if bulletin.status == "draft" and is_hsseq() else None,
                    "readers": read, "unread": unread, "archive_reason": bulletin.archive_reason or None,
                    "history": history("bulletin", bulletin) if reads_all() else [], "transitions": transitions})
    return row


def get_bulletin(bulletin_id):
    bulletin = get("eguitra.hsseq.bulletin", bulletin_id, "Alerte")
    if not (reads_all() or ("auditeur" in profiles() and can_read_bulletin(bulletin))):
        raise ApiError(404, "not_found", "Alerte introuvable.")
    return bulletin


def bulletin_values(data, partial=False):
    values = {}
    if "kind" in data or not partial:
        if (data.get("kind") or "flash_alert") not in dict(BULLETIN_KINDS):
            raise ApiError(400, "invalid_parameter", "Nature : flash_alert ou lesson.", fields=["kind"])
        values["kind"] = data.get("kind") or "flash_alert"
    for key, limit, mandatory in (("title", 300, True), ("body", 8000, True), ("key_messages", 4000, False)):
        if not partial or key in data:
            values[key] = text(data, key, limit)
            if mandatory and not values[key]:
                raise ApiError(400, "missing_fields", "Titre et texte de l'alerte sont obligatoires.", fields=[key])
    if "event_id" in data:
        event = get("eguitra.hsseq.event", data["event_id"], "Événement") if data["event_id"] else None
        values["event_id"] = event.id if event else False
    return audience_values(data, values)


# ─── Plans, exercices, annuaire ───────────────────────────────────────────


def contact_row(contact):
    contact = contact.sudo()
    return {"id": contact.id, "site": site_ref(contact.site_id), "function": contact.function, "name": contact.name,
            "organization": contact.organization or None, "phone": contact.phone, "phone2": contact.phone2 or None,
            "email": contact.email or None, "call_order": contact.call_order, "note": contact.note or None,
            "active": contact.active,
            "rights": {"can_edit": is_hsseq(), "can_close": False, "can_approve": False}}


def contact_domain(kw, sites):
    """Annuaire de crise des sites donnés (None : tous) ; un contact sans site vaut pour tous les sites."""
    domain = [("company_id", "in", companies(kw).ids)]
    if sites is not None:
        domain += ["|", ("site_id", "=", False), ("site_id", "in", sites.ids)]
    return domain


def drill_row(drill, detail=False):
    drill = drill.sudo()
    transitions = [t for t in drill._transitions() if is_hsseq()]
    row = {"id": drill.id, "reference": drill.reference,
           "plan": {"id": drill.plan_id.id, "reference": drill.plan_id.reference, "title": drill.plan_id.title},
           "site": site_ref(drill.site_id), "scenario": drill.scenario, "planned_date": drill.planned_date,
           "performed_date": drill.performed_date or None, "status": drill.status,
           "overdue": drill.status == "planned" and drill.planned_date < today(),
           "participants_count": drill.participants_count or None,
           "rights": {"can_edit": is_hsseq() and drill.status != "cancelled", "can_close": "perform" in transitions,
                      "can_approve": False}}
    if detail:
        row.update({"company": company_ref(drill.company_id), "duration_minutes": drill.duration_minutes or None,
                    "participants": [] if personal_data_hidden() else [user_ref(u) for u in drill.participant_ids],
                    "debrief": drill.debrief or None, "cancel_reason": drill.cancel_reason or None,
                    "reopen_reason": drill.reopen_reason or None,
                    "actions": [action_line(a) for a in drill.action_ids],
                    "attachments": attachments_rows("drill", drill), "history": history("drill", drill),
                    "transitions": transitions})
    return row


def plan_row(plan, detail=False):
    plan = plan.sudo()
    done = plan.drill_ids.filtered(lambda d: d.status == "done").sorted("performed_date", reverse=True)
    upcoming = plan.drill_ids.filtered(lambda d: d.status == "planned").sorted("planned_date")
    row = {"id": plan.id, "reference": plan.reference, "site": site_ref(plan.site_id), "scenario": plan.scenario,
           "title": plan.title, "review_date": plan.review_date or None, "active": plan.active,
           "last_drill": done[:1].performed_date or None, "next_drill": upcoming[:1].planned_date or None,
           "rights": {"can_edit": is_hsseq(), "can_close": False, "can_approve": False}}
    if detail:
        row.update({"company": company_ref(plan.company_id), "response": plan.response,
                    "resources": plan.resources or None, "contacts": [contact_row(c) for c in plan.contact_ids],
                    "drills": [drill_row(d) for d in plan.drill_ids],
                    "attachments": attachments_rows("emergency_plan", plan),
                    "history": history("emergency_plan", plan)})
    return row


def plan_values(data, partial=False):
    values = {}
    if not partial or "scenario" in data:
        if data.get("scenario") not in dict(SCENARIOS):
            raise ApiError(400, "invalid_parameter", "Scénario inconnu.", fields=["scenario"])
        values["scenario"] = data["scenario"]
    for key, limit, mandatory in (("title", 300, True), ("response", 8000, True), ("resources", 4000, False)):
        if not partial or key in data:
            values[key] = text(data, key, limit)
            if mandatory and not values[key]:
                raise ApiError(400, "missing_fields", "Intitulé et conduite à tenir sont obligatoires.", fields=[key])
    if "review_date" in data:
        values["review_date"] = date_value(data, "review_date")
    if "active" in data:
        values["active"] = bool(data["active"])
    if "contact_ids" in data:
        contacts = request.env["eguitra.hsseq.crisis.contact"].sudo().browse(ids_list(data, "contact_ids")).exists()
        if contacts.filtered(lambda c: c.company_id not in request.env.companies):
            raise forbidden("Contact non autorisé.")
        values["contact_ids"] = [(6, 0, contacts.ids)]
    return values


def drill_values(data, partial=False):
    values = {}
    if not partial or "planned_date" in data:
        values["planned_date"] = date_value(data, "planned_date")
        if not values["planned_date"]:
            raise ApiError(400, "missing_fields", "Date prévue de l'exercice manquante.", fields=["planned_date"])
    for key in ("participants_count", "duration_minutes"):
        if key in data:
            values[key] = max(int_or_none(data, key) or 0, 0)
    if "debrief" in data:
        values["debrief"] = text(data, "debrief", 8000)
    if "participant_ids" in data:
        users = request.env["res.users"].sudo().browse(ids_list(data, "participant_ids")).exists()
        values["participant_ids"] = [(6, 0, users.filtered(lambda u: not u.share).ids)]
    return values


def contact_values(data, partial=False):
    values = {}
    for key, limit, mandatory in (("function", 200, True), ("name", 200, True), ("phone", 64, True),
                                  ("organization", 200, False), ("phone2", 64, False), ("email", 200, False),
                                  ("note", 2000, False)):
        if not partial or key in data:
            values[key] = text(data, key, limit)
            if mandatory and not values[key]:
                raise ApiError(400, "missing_fields", "Fonction, nom et téléphone du contact sont obligatoires.",
                               fields=[key])
    if "call_order" in data:
        values["call_order"] = max(int_or_none(data, "call_order") or 10, 0)
    if "site_id" in data:
        site = get("eguitra.hsseq.site", data["site_id"], "Site") if data["site_id"] else None
        values["site_id"] = site.id if site else False
    if "active" in data:
        values["active"] = bool(data["active"])
    return values


class EguitraHsseqDocuments(http.Controller):
    # ─── Procédures ───────────────────────────────────────────────────────

    def _procedures(self, kw):
        domain = [("company_id", "in", companies(kw).ids)]
        if kw.get("status"):
            domain.append(("status", "in", kw["status"].split(",")))
        if kw.get("domain"):
            domain.append(("domain", "=", kw["domain"]))
        if kw.get("search"):
            domain += ["|", ("code", "ilike", kw["search"]), ("title", "ilike", kw["search"])]
        rows = request.env["eguitra.hsseq.procedure"].sudo().search(domain, order="code, id")
        return rows.filtered(can_manage_read)

    @hsseq_route("/hsseq/procedures", profiles=DOC_READ)
    def procedures(self, **kw):
        rows = self._procedures(kw)
        offset, limit, _order = page_args(kw, "code", {"code": "code"})
        counts = {"by_status": {code: len(rows.filtered(lambda p, c=code: p.status == c))
                                for code, _l in PROCEDURE_STATUSES}}
        index = audience_index(companies(kw)) if rows else []
        return page([procedure_row(p, index=index) for p in rows[offset:offset + limit]], len(rows), offset, limit,
                    counts)

    @hsseq_route("/hsseq/procedures/<int:procedure_id>", profiles=DOC_READ)
    def procedure(self, procedure_id, **_kw):
        return procedure_row(get_procedure(procedure_id), detail=True)

    @hsseq_route("/hsseq/procedures", methods=("POST",), profiles=HSSEQ)
    def create_procedure(self, **_kw):
        """Procédure et sa première version en brouillon ({code, title, audience_profiles, site_ids, version,
        effective_date, change_summary})."""
        data = read_json()
        require(data, "code", "title", "version", "effective_date")
        company = companies(data)[:1] if data.get("company_id") else request.env.company
        values = procedure_values(data)
        values.setdefault("audience_profiles", ["conducteur"])
        procedure = request.env["eguitra.hsseq.procedure"].sudo().create(dict(values, company_id=company.id))
        request.env["eguitra.hsseq.procedure.version"].sudo().create(dict(version_values(data),
                                                                          procedure_id=procedure.id))
        return procedure_row(procedure, detail=True)

    @hsseq_route("/hsseq/procedures/<int:procedure_id>", methods=("PATCH",), profiles=HSSEQ)
    def update_procedure(self, procedure_id, **_kw):
        procedure = get_procedure(procedure_id)
        if procedure.status == "archived":
            raise ApiError(422, "invalid_transition", "Procédure archivée : réactivez-la avant de la modifier.")
        procedure.write(procedure_values(read_json(), partial=True))
        return procedure_row(procedure, detail=True)

    @hsseq_route("/hsseq/procedures/<int:procedure_id>/versions", methods=("POST",), profiles=HSSEQ)
    def create_version(self, procedure_id, **_kw):
        procedure = get_procedure(procedure_id)
        if procedure.status == "archived":
            raise ApiError(422, "invalid_transition", "Procédure archivée : réactivez-la avant une nouvelle version.")
        if procedure._draft_version():
            raise ApiError(422, "invalid_transition", "Une version en brouillon existe déjà : publiez-la ou "
                                                      "modifiez-la.")
        data = read_json()
        require(data, "version", "effective_date")
        request.env["eguitra.hsseq.procedure.version"].sudo().create(dict(version_values(data),
                                                                          procedure_id=procedure.id))
        return procedure_row(procedure, detail=True)

    @hsseq_route("/hsseq/procedures/<int:procedure_id>/versions/<int:version_id>", methods=("PATCH",), profiles=HSSEQ)
    def update_version(self, procedure_id, version_id, **_kw):
        procedure = get_procedure(procedure_id)
        version = get_version(procedure, version_id)
        if version.status != "draft":
            raise ApiError(422, "invalid_transition", "Version publiée : elle ne se modifie plus (nouvelle version).")
        version.write(version_values(read_json(), partial=True))
        return procedure_row(procedure, detail=True)

    @hsseq_route("/hsseq/procedures/<int:procedure_id>/versions/<int:version_id>/publish", methods=("POST",),
                 profiles=HSSEQ)
    def publish_version(self, procedure_id, version_id, **_kw):
        procedure = get_procedure(procedure_id)
        get_version(procedure, version_id).action_publish()
        return procedure_row(procedure, detail=True)

    @hsseq_route("/hsseq/procedures/<int:procedure_id>/<string:transition>", methods=("POST",), profiles=HSSEQ)
    def procedure_transition(self, procedure_id, transition, **_kw):
        if transition not in PROCEDURE_TRANSITIONS:
            raise ApiError(404, "not_found", "Transition inconnue.")
        procedure = get_procedure(procedure_id)
        data = read_json()
        if transition == "remind":
            procedure._require("remind")
            reminded = procedure.current_version_id._remind()
            return dict(procedure_row(procedure, detail=True), reminded=len(reminded))
        if transition == "archive":
            procedure.action_archive_procedure(data.get("reason"))
        else:
            procedure.action_reactivate(data.get("reason"))
        return procedure_row(procedure, detail=True)

    @hsseq_route("/hsseq/procedures/<int:procedure_id>/acknowledge", methods=("POST",), profiles=None)
    def acknowledge_procedure(self, procedure_id, **_kw):
        """Accusé de lecture de la version en vigueur par le compte visé (idempotent) ; version_id, s'il est
        donné, doit être celle en vigueur."""
        internal_only()
        procedure = get("eguitra.hsseq.procedure", procedure_id, "Procédure").sudo()
        if procedure.status != "published" or not procedure._applies_to(request.env.user):
            raise ApiError(404, "not_found", "Procédure introuvable.")
        data = read_json()
        version = procedure.current_version_id
        if data.get("version_id") and int_or_none(data, "version_id") != version.id:
            raise ApiError(409, "conflict", "Une nouvelle version est en vigueur : lisez-la avant d'en accuser "
                                            "lecture.", fields=["version_id"])
        ack, _created = request.env["eguitra.hsseq.acknowledgment"]._acknowledge(
            version, request.env.user, read_at(data), terrain_source())
        return my_procedure_row(procedure, ack)

    # ─── Alertes flash et retours d'expérience ────────────────────────────

    @hsseq_route("/hsseq/bulletins", profiles=DOC_READ)
    def bulletins(self, **kw):
        domain = [("company_id", "in", companies(kw).ids)]
        if not reads_all():
            domain.append(("status", "!=", "draft"))
        for key in ("status", "kind"):
            if kw.get(key):
                domain.append((key, "in", kw[key].split(",")))
        rows = request.env["eguitra.hsseq.bulletin"].sudo().search(domain, order="published_at desc, id desc")
        rows = rows.filtered(can_read_bulletin)
        offset, limit, _order = page_args(kw, "published_at", {"published_at": "published_at"})
        counts = {"by_status": {code: len(rows.filtered(lambda b, c=code: b.status == c))
                                for code, _l in BULLETIN_STATUSES}}
        index = audience_index(companies(kw)) if rows else []
        return page([bulletin_row(b, index=index) for b in rows[offset:offset + limit]], len(rows), offset, limit,
                    counts)

    @hsseq_route("/hsseq/bulletins/<int:bulletin_id>", profiles=DOC_READ)
    def bulletin(self, bulletin_id, **_kw):
        return bulletin_row(get_bulletin(bulletin_id), detail=True)

    @hsseq_route("/hsseq/bulletins", methods=("POST",), profiles=HSSEQ)
    def create_bulletin(self, **_kw):
        data = read_json()
        require(data, "title", "body")
        company = companies(data)[:1] if data.get("company_id") else request.env.company
        bulletin = request.env["eguitra.hsseq.bulletin"].sudo().create(dict(bulletin_values(data),
                                                                            company_id=company.id))
        return bulletin_row(bulletin, detail=True)

    @hsseq_route("/hsseq/bulletins/<int:bulletin_id>", methods=("PATCH",), profiles=HSSEQ)
    def update_bulletin(self, bulletin_id, **_kw):
        bulletin = get_bulletin(bulletin_id)
        if bulletin.status != "draft":
            raise ApiError(422, "invalid_transition", "Alerte diffusée : elle ne se modifie plus.")
        bulletin.write(bulletin_values(read_json(), partial=True))
        return bulletin_row(bulletin, detail=True)

    @hsseq_route("/hsseq/bulletins/<int:bulletin_id>/<string:transition>", methods=("POST",), profiles=HSSEQ)
    def bulletin_transition(self, bulletin_id, transition, **_kw):
        if transition not in BULLETIN_TRANSITIONS:
            raise ApiError(404, "not_found", "Transition inconnue.")
        bulletin = get_bulletin(bulletin_id)
        data = read_json()
        if transition == "publish":
            bulletin.action_publish()
        elif transition == "remind":
            bulletin._require("remind")
            reminded = bulletin._remind()
            return dict(bulletin_row(bulletin, detail=True), reminded=len(reminded))
        else:
            bulletin.action_archive_bulletin(data.get("reason"))
        return bulletin_row(bulletin, detail=True)

    @hsseq_route("/hsseq/bulletins/<int:bulletin_id>/acknowledge", methods=("POST",), profiles=None)
    def acknowledge_bulletin(self, bulletin_id, **_kw):
        internal_only()
        bulletin = get("eguitra.hsseq.bulletin", bulletin_id, "Alerte").sudo()
        if bulletin.status != "published" or not bulletin._applies_to(request.env.user):
            raise ApiError(404, "not_found", "Alerte introuvable.")
        ack, _created = request.env["eguitra.hsseq.acknowledgment"]._acknowledge(
            bulletin, request.env.user, read_at(read_json()), terrain_source())
        return my_bulletin_row(bulletin, ack)

    # ─── Mes documents (web et NIMOVA Terrain) ────────────────────────────

    @hsseq_route("/hsseq/my/documents", profiles=None)
    def my_documents(self, **kw):
        """Procédures en vigueur et alertes diffusées qui visent le compte, avec son accusé de lecture ; les
        non lues d'abord. unread=1 : les non lues seules."""
        internal_only()
        env = request.env
        user = env.user
        entry = (set(user._eguitra_profiles()), user._hsseq_audience_sites())
        Ack = env["eguitra.hsseq.acknowledgment"].sudo()
        procedures = env["eguitra.hsseq.procedure"].sudo().search(
            [("company_id", "in", user.company_ids.ids), ("status", "=", "published")], order="code, id")
        procedures = procedures.filtered(lambda p: p.current_version_id and p._applies_to(user, entry))
        acks = {a.version_id.id: a for a in Ack.search([("user_id", "=", user.id),
                                                         ("version_id", "in", procedures.current_version_id.ids)])}
        bulletins = env["eguitra.hsseq.bulletin"].sudo().search(
            [("company_id", "in", user.company_ids.ids), ("status", "=", "published")],
            order="published_at desc, id desc", limit=200)
        bulletins = bulletins.filtered(lambda b: b._applies_to(user, entry))
        bulletin_acks = {a.bulletin_id.id: a for a in Ack.search([("user_id", "=", user.id),
                                                                  ("bulletin_id", "in", bulletins.ids)])}
        procedure_rows = [my_procedure_row(p, acks.get(p.current_version_id.id)) for p in procedures]
        bulletin_rows = [my_bulletin_row(b, bulletin_acks.get(b.id)) for b in bulletins]
        if str(kw.get("unread", "")) in ("1", "true"):
            procedure_rows = [r for r in procedure_rows if not r["read"]]
            bulletin_rows = [r for r in bulletin_rows if not r["read"]]
        procedure_rows.sort(key=lambda r: r["read"])
        bulletin_rows.sort(key=lambda r: r["read"])
        return {"procedures": procedure_rows, "bulletins": bulletin_rows,
                "unread_count": sum(not r["read"] for r in procedure_rows + bulletin_rows)}

    @hsseq_route("/hsseq/my/crisis-contacts", profiles=None)
    def my_crisis_contacts(self, **_kw):
        """Annuaire de crise des sites du compte (conducteur : le site de son ensemble), contacts communs
        compris, dans l'ordre d'appel."""
        internal_only()
        user = request.env.user
        sites = user._hsseq_audience_sites()
        domain = [("company_id", "in", user.company_ids.ids)]
        if sites is not None:
            domain += ["|", ("site_id", "=", False), ("site_id", "in", sites.ids)]
        contacts = request.env["eguitra.hsseq.crisis.contact"].sudo().search(domain, order="call_order, id")
        return {"sites": [site_ref(s) for s in sites] if sites is not None else None,
                "items": [my_contact_row(c) for c in contacts]}

    # ─── Plans d'intervention d'urgence ───────────────────────────────────

    def _plans(self, kw):
        domain = [("company_id", "in", companies(kw).ids)] + scope_domain()
        if kw.get("site_id"):
            domain.append(("site_id", "=", int_or_none(kw, "site_id")))
        if kw.get("scenario"):
            domain.append(("scenario", "in", kw["scenario"].split(",")))
        Plan = request.env["eguitra.hsseq.emergency.plan"].sudo()
        if str(kw.get("active", "1")) in ("all", ""):
            Plan = Plan.with_context(active_test=False)
        return Plan, domain

    @hsseq_route("/hsseq/emergency-plans", profiles=PLAN_READ)
    def plans(self, **kw):
        Plan, domain = self._plans(kw)
        offset, limit, order = page_args(kw, "site", {"site": "site_id", "scenario": "scenario"})
        return page([plan_row(p) for p in Plan.search(domain, offset=offset, limit=limit, order=order)],
                    Plan.search_count(domain), offset, limit)

    def _plan(self, plan_id):
        plan = request.env["eguitra.hsseq.emergency.plan"].sudo().with_context(active_test=False).browse(
            plan_id).exists()
        if not plan or plan.company_id not in request.env.companies or not in_scope(plan.site_id):
            raise ApiError(404, "not_found", "Plan d'intervention introuvable.")
        return plan

    @hsseq_route("/hsseq/emergency-plans/<int:plan_id>", profiles=PLAN_READ)
    def plan(self, plan_id, **_kw):
        return plan_row(self._plan(plan_id), detail=True)

    @hsseq_route("/hsseq/emergency-plans", methods=("POST",), profiles=HSSEQ)
    def create_plan(self, **_kw):
        data = read_json()
        require(data, "site_id", "scenario", "title", "response")
        site = get("eguitra.hsseq.site", data["site_id"], "Site")
        plan = request.env["eguitra.hsseq.emergency.plan"].sudo().create(
            dict(plan_values(data), site_id=site.id, company_id=site.company_id.id))
        return plan_row(plan, detail=True)

    @hsseq_route("/hsseq/emergency-plans/<int:plan_id>", methods=("PATCH",), profiles=HSSEQ)
    def update_plan(self, plan_id, **_kw):
        plan = self._plan(plan_id)
        data = read_json()
        values = plan_values(data, partial=True)
        if data.get("site_id"):
            site = get("eguitra.hsseq.site", data["site_id"], "Site")
            values.update(site_id=site.id)
        plan.write(values)
        return plan_row(plan, detail=True)

    # ─── Exercices ────────────────────────────────────────────────────────

    def _drill_domain(self, kw):
        domain = [("company_id", "in", companies(kw).ids)] + scope_domain()
        for key in ("status", "scenario"):
            if kw.get(key):
                domain.append((key, "in", kw[key].split(",")))
        for key in ("site_id", "plan_id"):
            if kw.get(key):
                domain.append((key, "=", int_or_none(kw, key)))
        year = int_or_none(kw, "year")
        if year:
            domain += [("planned_date", ">=", f"{year}-01-01"), ("planned_date", "<=", f"{year}-12-31")]
        return domain

    @hsseq_route("/hsseq/drills", profiles=PLAN_READ)
    def drills(self, **kw):
        domain = self._drill_domain(kw)
        offset, limit, order = page_args(kw, "-planned_date", {"planned_date": "planned_date"})
        Drill = request.env["eguitra.hsseq.drill"].sudo()
        counts = {"by_status": {code: Drill.search_count(domain + [("status", "=", code)])
                                for code, _l in DRILL_STATUSES},
                  "overdue": Drill.search_count(domain + [("status", "=", "planned"), ("planned_date", "<", today())])}
        return page([drill_row(d) for d in Drill.search(domain, offset=offset, limit=limit, order=order)],
                    Drill.search_count(domain), offset, limit, counts)

    def _drill(self, drill_id):
        drill = get("eguitra.hsseq.drill", drill_id, "Exercice")
        if not in_scope(drill.site_id):
            raise ApiError(404, "not_found", "Exercice introuvable.")
        return drill

    @hsseq_route("/hsseq/drills/<int:drill_id>", profiles=PLAN_READ)
    def drill(self, drill_id, **_kw):
        return drill_row(self._drill(drill_id), detail=True)

    @hsseq_route("/hsseq/emergency-plans/<int:plan_id>/drills", methods=("POST",), profiles=HSSEQ)
    def create_drill(self, plan_id, **_kw):
        plan = self._plan(plan_id)
        if not plan.active:
            raise ApiError(422, "invalid_transition", "Plan archivé : pas de nouvel exercice.")
        drill = request.env["eguitra.hsseq.drill"].sudo().create(dict(drill_values(read_json()), plan_id=plan.id))
        return drill_row(drill, detail=True)

    @hsseq_route("/hsseq/drills/<int:drill_id>", methods=("PATCH",), profiles=HSSEQ)
    def update_drill(self, drill_id, **_kw):
        drill = self._drill(drill_id)
        if drill.status == "cancelled":
            raise ApiError(422, "invalid_transition", "Exercice annulé : il ne se modifie plus.")
        drill.write(drill_values(read_json(), partial=True))
        return drill_row(drill, detail=True)

    @hsseq_route("/hsseq/drills/<int:drill_id>/<string:transition>", methods=("POST",), profiles=HSSEQ)
    def drill_transition(self, drill_id, transition, **_kw):
        if transition not in DRILL_TRANSITIONS:
            raise ApiError(404, "not_found", "Transition inconnue.")
        drill = self._drill(drill_id)
        data = read_json()
        if transition == "perform":
            drill.action_perform(date_value(data, "performed_date"), text(data, "debrief", 8000),
                                 int_or_none(data, "participants_count"))
        elif transition == "cancel":
            drill.action_cancel(data.get("reason"))
        else:
            drill.action_reopen(data.get("reason"))
        return drill_row(drill, detail=True)

    # ─── Annuaire de crise ────────────────────────────────────────────────

    @hsseq_route("/hsseq/crisis-contacts", profiles=PLAN_READ)
    def contacts(self, **kw):
        domain = contact_domain(kw, account_sites())
        if kw.get("site_id"):
            domain.append(("site_id", "in", [int_or_none(kw, "site_id"), False]))
        Contact = request.env["eguitra.hsseq.crisis.contact"].sudo()
        if str(kw.get("active", "1")) in ("all", ""):
            Contact = Contact.with_context(active_test=False)
        return [contact_row(c) for c in Contact.search(domain, order="call_order, id")]

    @hsseq_route("/hsseq/crisis-contacts", methods=("POST",), profiles=HSSEQ)
    def create_contact(self, **_kw):
        data = read_json()
        require(data, "function", "name", "phone")
        company = companies(data)[:1] if data.get("company_id") else request.env.company
        values = contact_values(data)
        if values.get("site_id"):
            company = request.env["eguitra.hsseq.site"].sudo().browse(values["site_id"]).company_id
        return contact_row(request.env["eguitra.hsseq.crisis.contact"].sudo().create(dict(values, company_id=company.id)))

    @hsseq_route("/hsseq/crisis-contacts/<int:contact_id>", methods=("PATCH",), profiles=HSSEQ)
    def update_contact(self, contact_id, **_kw):
        contact = request.env["eguitra.hsseq.crisis.contact"].sudo().with_context(active_test=False).browse(
            contact_id).exists()
        if not contact or contact.company_id not in request.env.companies:
            raise ApiError(404, "not_found", "Contact introuvable.")
        contact.write(contact_values(read_json(), partial=True))
        return contact_row(contact)

    # ─── Registres ────────────────────────────────────────────────────────

    @hsseq_route("/hsseq/documents/export.xlsx", profiles=PLAN_READ)
    def export(self, **kw):
        """Registres des documents et des urgences, bornés comme les listes du même compte : procédures et
        alertes pour les profils qui les lisent ; plans, exercices et annuaire de crise de ses sites."""
        env = request.env
        comps = companies(kw)
        meta = export_meta(comps)
        Plan, plan_domain = self._plans(kw)
        plans = Plan.search(plan_domain, order="site_id, scenario, id", limit=EXPORT_LIMIT)
        drills = env["eguitra.hsseq.drill"].sudo().search(self._drill_domain(kw), order="planned_date, id",
                                                          limit=EXPORT_LIMIT)
        contacts = env["eguitra.hsseq.crisis.contact"].sudo().search(contact_domain(kw, account_sites()),
                                                                     order="call_order, id", limit=EXPORT_LIMIT)
        scenarios, drill_states = dict(SCENARIOS), dict(DRILL_STATUSES)
        sheets = []
        if profiles() & set(DOC_READ):
            index = audience_index(comps)
            procedures = self._procedures(kw)
            rows = []
            for p in procedures:
                current = p.current_version_id
                stats = current._read_stats(p._audience_users(index)) if current and p.status == "published" \
                    else None
                rows.append([p.code, p.title, dict(PROCEDURE_STATUSES).get(p.status), current.version or "",
                             current.effective_date or None, ", ".join(p.audience_profiles or []),
                             ", ".join(p.site_ids.mapped("name")) or "Tous", stats["targets"] if stats else None,
                             stats["read"] if stats else None, stats["rate"] if stats else None])
            sheets.append({"title": "Procédures", "meta": meta,
                           "columns": [("Référence", "text"), ("Titre", "text"), ("État", "text"), ("Version", "text"),
                                       ("Date d'effet", "date"), ("Profils visés", "text"), ("Sites visés", "text"),
                                       ("Comptes visés", "int"), ("Lectures", "int"), ("Taux de lecture (%)", "percent")],
                           "rows": rows, "totals": None})
            bulletins = env["eguitra.hsseq.bulletin"].sudo().search(
                [("company_id", "in", comps.ids)] + ([] if reads_all() else [("status", "!=", "draft")]),
                order="published_at, id", limit=EXPORT_LIMIT).filtered(can_read_bulletin)
            rows = []
            for b in bulletins:
                stats = b._read_stats(b._audience_users(index)) if b.status != "draft" else None
                rows.append([b.reference, dict(BULLETIN_KINDS).get(b.kind), b.title, dict(BULLETIN_STATUSES).get(b.status),
                             b.published_at.date() if b.published_at else None, stats["read"] if stats else None,
                             stats["targets"] if stats else None])
            sheets.append({"title": "Alertes et retours d'expérience", "meta": meta,
                           "columns": [("Référence", "text"), ("Nature", "text"), ("Titre", "text"), ("État", "text"),
                                       ("Diffusé le", "date"), ("Lectures", "int"), ("Comptes visés", "int")],
                           "rows": rows, "totals": None})
        sheets += [
            {"title": "Plans d'intervention", "meta": meta,
             "columns": [("Référence", "text"), ("Site", "text"), ("Scénario", "text"), ("Plan", "text"),
                         ("Conduite à tenir", "text"), ("Prochaine revue", "date")],
             "rows": [[p.reference, p.site_id.name, scenarios.get(p.scenario), p.title, p.response,
                       p.review_date or None] for p in plans], "totals": None},
            {"title": "Exercices", "meta": meta,
             "columns": [("Référence", "text"), ("Plan", "text"), ("Site", "text"), ("Scénario", "text"),
                         ("Prévu le", "date"), ("Réalisé le", "date"), ("État", "text"), ("Participants", "int"),
                         ("Bilan", "text")],
             "rows": [[d.reference, d.plan_id.reference, d.site_id.name, scenarios.get(d.scenario), d.planned_date,
                       d.performed_date or None, drill_states.get(d.status), d.participants_count or None,
                       d.debrief or ""] for d in drills], "totals": None},
            {"title": "Annuaire de crise", "meta": meta,
             "columns": [("Ordre d'appel", "int"), ("Site", "text"), ("Fonction", "text"), ("Nom", "text"),
                         ("Organisme", "text"), ("Téléphone", "text"), ("Second téléphone", "text")],
             "rows": [[c.call_order, c.site_id.name or "Tous les sites", c.function, c.name, c.organization or "",
                       c.phone, c.phone2 or ""] for c in contacts], "totals": None},
        ]
        return table_response(f"documents_urgences_hsseq_{today():%Y%m%d}", sheets)


# ─── Lignes de « mes documents » ──────────────────────────────────────────


def my_procedure_row(procedure, ack):
    version = procedure.current_version_id
    return {"id": procedure.id, "code": procedure.code, "title": procedure.title, "domain": procedure.domain or None,
            "version": {"id": version.id, "version": version.version, "effective_date": version.effective_date,
                        "published_at": version.published_at or None, "change_summary": version.change_summary or None},
            "document": attachments_rows("procedure_version", version), "read": bool(ack),
            "read_at": ack.read_at if ack else None}


def my_bulletin_row(bulletin, ack):
    """Alerte telle que la lit le compte visé : texte anonymisé, jamais l'événement d'origine."""
    return {"id": bulletin.id, "reference": bulletin.reference, "kind": bulletin.kind, "title": bulletin.title,
            "body": bulletin.body, "key_messages": bulletin.key_messages or None,
            "published_at": bulletin.published_at, "read": bool(ack), "read_at": ack.read_at if ack else None}


def my_contact_row(contact):
    return {"id": contact.id, "site": site_ref(contact.site_id), "function": contact.function, "name": contact.name,
            "organization": contact.organization or None, "phone": contact.phone, "phone2": contact.phone2 or None,
            "call_order": contact.call_order}


def overdue_drills(comps, sites=None):
    """Exercices planifiés dont la date est passée, et ceux des 30 prochains jours (cockpit)."""
    domain = [("company_id", "in", comps.ids), ("status", "=", "planned")]
    if sites is not None:
        domain.append(("site_id", "in", sites.ids))
    Drill = request.env["eguitra.hsseq.drill"].sudo()
    return {"overdue": Drill.search_count(domain + [("planned_date", "<", today())]),
            "upcoming": Drill.search_count(domain + [("planned_date", ">=", today()),
                                                     ("planned_date", "<=", today() + timedelta(days=30))])}
