"""Référentiels d'HSSEQ (sites, véhicules, conducteurs, salariés, responsables possibles d'une action,
clients, seuils de criticité), rotations d'un véhicule à une date, sites et paramètres, échéances à 30 jours, espace du
conducteur, notifications et journal."""

from datetime import timedelta

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, read_json, require

from ..models.common import AUDITOR_GROUP, EXPLOITATION_GROUP, OBJECT_MODELS, VEHICLE_KINDS
from .common import (
    APP,
    CONFIG,
    DEADLINES,
    LOG,
    READ_ALL,
    companies,
    company_ref,
    date_value,
    driver_ref,
    forbidden,
    get,
    hsseq_route,
    ids_list,
    int_or_none,
    internal_only,
    is_hsseq,
    is_self_only,
    journal_row,
    my_driver,
    my_sites,
    page,
    page_args,
    personal_data_hidden,
    profiles,
    rotation_ref,
    scope_domain,
    scope_level,
    site_ref,
    site_scope,
    text,
    user_ref,
    vehicle_ref,
)

# Profils qui déclarent ou gèrent les personnes en cause d'un événement, hors conducteur : la liste des
# salariés leur est servie.
EVENT_PEOPLE = ("admin", "direction", "hsseq", "exploitation")
# Profils qui déclarent un événement (contrat §2).
DECLARE = ("admin", "direction", "hsseq", "exploitation", "conducteur")
# Profils à qui la liste des clients est servie (client ou donneur d'ordre d'un audit, d'une exigence, d'un
# modèle de rapport) : /finance/partners leur reste fermé.
CLIENTS = ("admin", "direction", "hsseq")
FITNESS = {"apte": "fit", "apte_reserve": "review", "inapte": "unfit", "echue": "unfit", "inconnu": "review"}
DOCUMENT_REASON = {"insurance": "V05", "inspection": "V05", "calibration": "V06", "tightness": "V06"}
SETTINGS_FIELDS = {
    "lock_start_date": "date", "qualifications_required_from": "date", "employee_file_required_from": "date",
    "documents_required_from": "date", "level_moderate_min": "int", "level_significant_min": "int",
    "level_high_min": "int", "investigation_hours_high": "int", "investigation_days_significant": "int",
    "investigation_days_moderate": "int", "client_notice_hours": "int", "verification_min_criticality": "int",
    "verification_days": "int", "escalation_days": "int", "costly_action_threshold": "float",
    "check_window_hours": "int", "breath_test_window_hours": "int", "night_start_hour": "float",
    "night_end_hour": "float", "max_driving_hours": "float", "risk_review_months": "int",
    # Lot 3.
    "co2_factor": "float", "complaint_response_days": "int", "read_reminder_days": "int",
}


def today():
    return fields.Date.context_today(request.env.user)


def site_row(site):
    site = site.sudo()
    return {"id": site.id, "name": site.name, "code": site.code, "company": company_ref(site.company_id),
            "default_vehicle_kind": site.default_vehicle_kind,
            "yard_managers": [user_ref(u) for u in site.manager_ids], "active": site.active,
            "vehicle_ids": site.vehicle_ids.ids}


def settings_row(settings):
    row = {key: settings[key] or None for key in SETTINGS_FIELDS}
    row.update({"company": company_ref(settings.company_id), "director": user_ref(settings.director_user_id),
                "criticality_thresholds": settings._thresholds(), "targets": settings.targets or {}})
    return row


def driver_sites(vehicles):
    """Site de chaque chauffeur : celui de l'ensemble dont il est le chauffeur habituel."""
    return {v.driver_id.id: v.site_id.id for v in vehicles if v.driver_id and v.site_id}


def deadline_items(comps, horizon, kind=None, site=None, vehicle_kind=None):
    """Échéances des personnes (habilitations et aptitude, RH) et des véhicules (documents, Transport) dans
    l'horizon, expirées comprises, date croissante. Portée fermée par défaut : hors lecture complète
    (admin, direction, hsseq, RH), les échéances des sites du compte seulement (aucune sans site rattaché,
    ni celle d'une personne ou d'un véhicule sans site)."""
    env = request.env
    day = today()
    limit = day + timedelta(days=horizon)
    scope = site_scope(READ_ALL | {"rh"})
    vehicles = env["eguitra.transport.vehicle"].sudo().search([("company_id", "in", comps.ids)])
    on_site = driver_sites(vehicles)
    Site = env["eguitra.hsseq.site"].sudo()
    items = []

    def keep(site_id):
        if site and site_id != site.id:
            return False
        return scope is None or bool(site_id and site_id in scope.ids)

    if kind in (None, "qualification"):
        Type = env["eguitra.rh.qualification.type"].sudo().with_context(active_test=False)
        mandatory = {t.code: t.mandatory_for_drivers for t in Type.search([])}
        Employee = env["eguitra.rh.employee"].sudo()
        for row in Employee._hsseq_expiring(comps, horizon, day):
            site_id = on_site.get(row["driver_id"])
            if not keep(site_id):
                continue
            person = Employee.browse(row["employee_id"])
            subject = ({"type": "driver", "id": row["driver_id"], "name": person.name} if row["driver_id"]
                       else {"type": "employee", "id": person.id, "name": person.name})
            items.append({
                "kind": "qualification", "document_kind": row["code"], "subject": subject, "label": row["name"],
                "expires_on": row["expiry"], "days_left": row["days_left"], "expired": row["days_left"] < 0,
                "reason_code": "V04" if row["kind"] == "fitness" or mandatory.get(row["code"]) else None,
                "site": site_ref(Site.browse(site_id)) if site_id else None,
            })
    if kind in (None, "vehicle_document") and "eguitra.transport.vehicle.document" in env:
        labels = dict(env["eguitra.transport.vehicle.document"]._fields["kind"].selection)
        for vehicle in vehicles:
            if vehicle_kind and vehicle_ref(vehicle)["vehicle_kind"] != vehicle_kind:
                continue
            if not keep(vehicle.site_id.id):
                continue
            for doc in vehicle._latest_documents().values():
                if doc.expiry_date > limit:
                    continue
                items.append({
                    "kind": "vehicle_document", "document_kind": doc.kind,
                    "subject": {"type": "vehicle", "id": vehicle.id, "name": vehicle.name},
                    "label": labels.get(doc.kind, doc.kind), "expires_on": doc.expiry_date,
                    "days_left": (doc.expiry_date - day).days, "expired": doc.expiry_date < day,
                    "reason_code": DOCUMENT_REASON.get(doc.kind), "site": site_ref(vehicle.site_id),
                })
    return sorted(items, key=lambda i: (i["expires_on"], i["subject"]["name"] or ""))


def client_rows(comps):
    """Clients des sociétés (fiches tiers clients, communes ou de la société) et tiers déjà cités par un
    audit, une exigence ou un modèle de rapport : identifiant et nom seulement."""
    env = request.env
    Partner = env["res.partner"].sudo()
    used = (env["eguitra.hsseq.audit"].sudo().search([("company_id", "in", comps.ids)]).partner_id
            | env["eguitra.hsseq.requirement"].sudo().search([("company_id", "in", comps.ids)]).partner_id
            | env["eguitra.hsseq.report.template"].sudo().with_context(active_test=False).search([]).partner_id)
    clients = Partner.search([("customer_rank", ">", 0), ("company_id", "in", comps.ids + [False])], order="name",
                             limit=1000) | used
    return [{"id": p.id, "name": p.name} for p in clients.sorted(lambda p: (p.name or "").lower())]


def auditor_row(user):
    user = user.sudo()
    return {"id": user.id, "name": user.name, "login": user.login, "access_until": user.hsseq_audit_until or None,
            "expired": user._hsseq_audit_expired(), "sites": [site_ref(s) for s in user.hsseq_audit_site_ids],
            "companies": [company_ref(c) for c in user.company_ids]}


def employee_rows(comps, vehicles):
    """Salariés en poste des sociétés (identifiant, nom, société, site de l'ensemble du chauffeur s'il est
    connu), pour désigner les personnes en cause d'un événement ; aucune autre donnée du dossier RH."""
    day = today()
    employees = request.env["eguitra.rh.employee"].sudo().search([
        ("company_id", "in", comps.ids), ("hire_date", "<=", day), "|", ("exit_date", "=", False),
        ("exit_date", ">=", day)], order="name")
    on_site = driver_sites(vehicles)
    Site = request.env["eguitra.hsseq.site"].sudo()
    return [{"id": e.id, "name": e.name, "company": company_ref(e.company_id),
             "site_id": on_site.get(e.driver_id.id),
             "site": site_ref(Site.browse(on_site[e.driver_id.id])) if e.driver_id.id in on_site else None}
            for e in employees]


def rotation_window_domain(day):
    """Rotations en cours au jour donné : chargées ce jour-là, ou chargées avant et pas encore revenues
    (retour au dépôt, sinon livraison, sinon rotation encore ouverte)."""
    return [("date_loading", "<=", day), "|", "|", ("date_loading", "=", day), ("date_return", ">=", day),
            "&", ("date_return", "=", False), "|", ("date_delivery", ">=", day), ("state", "in", ("draft", "en_route"))]


class EguitraHsseqReferentials(http.Controller):
    # ─── Référentiels ─────────────────────────────────────────────────────

    @hsseq_route("/hsseq/referentials", profiles=APP)
    def referentials(self, **kw):
        env = request.env
        comps = companies(kw)
        sites = env["eguitra.hsseq.site"].sudo().search([("company_id", "in", comps.ids)])
        vehicles = env["eguitra.transport.vehicle"].sudo().search([("company_id", "in", comps.ids)])
        driver = my_driver()
        user_profiles = profiles()
        field_only = is_self_only()
        drivers = driver if field_only else env["eguitra.transport.driver"].sudo().search(
            [("company_id", "in", comps.ids)])
        if personal_data_hidden():
            drivers = env["eguitra.transport.driver"]  # auditeur : pas de liste nominative des conducteurs
        on_site = driver_sites(vehicles)
        owners = env["res.users"]
        if not field_only:
            owners = env["res.users"].sudo().search([("share", "=", False), ("company_ids", "in", comps.ids)], limit=500)
            owners = owners.filtered(lambda u: set(u._eguitra_profiles()) - {"conducteur"})
        settings = env["eguitra.hsseq.settings"]._get(env.company)
        employee = env.user._hsseq_employee()
        people = bool(user_profiles & set(EVENT_PEOPLE))
        return {
            "sites": [site_row(s) for s in sites],
            "vehicles": [dict(vehicle_ref(v), site_id=v.site_id.id or None, driver_id=v.driver_id.id or None,
                              payload_tonnes=(v.payload_tonnes or None) if "payload_tonnes" in v._fields else None,
                              immobilized=v.hsseq_immobilized)
                         for v in vehicles],
            "drivers": [dict(driver_ref(d), site_id=on_site.get(d.id)) for d in drivers],
            "owners": [user_ref(u) for u in owners],
            # Salariés (personnes en cause d'un événement) : profils qui gèrent les événements seulement.
            "employees": employee_rows(comps, vehicles) if people else [],
            "clients": client_rows(comps) if user_profiles & set(CLIENTS) else [],
            "criticality_thresholds": settings._thresholds(),
            "costly_action_threshold": settings.costly_action_threshold,
            "check_window_hours": settings.check_window_hours,
            "breath_test_window_hours": settings.breath_test_window_hours,
            # Délai de revue d'un risque (prochaine revue proposée).
            "risk_review_months": settings.risk_review_months,
            "vehicle_kinds": [{"code": k, "label": label} for k, label in VEHICLE_KINDS],
            "me": {"profiles": sorted(user_profiles), "site_ids": my_sites().ids,
                   "employee_id": employee.id or None, "driver_id": driver.id or None},
        }

    # ─── Rotations à une date ─────────────────────────────────────────────

    @hsseq_route("/hsseq/rotations", profiles=DECLARE)
    def rotations(self, **kw):
        """Rotations chargées ou en cours à une date (aujourd'hui par défaut), tous états, d'un ensemble
        (vehicle_id) ou de tous : rattacher un événement à une rotation, même partie ou terminée.
        Conducteur : ses propres rotations ; hors lecture complète, les ensembles des sites du compte (fermé
        par défaut)."""
        day = date_value(kw, "date") or today()
        domain = [("company_id", "in", companies(kw).ids)] + rotation_window_domain(day)
        if kw.get("vehicle_id"):
            vehicle = get("eguitra.transport.vehicle", kw["vehicle_id"], "Ensemble")
            domain.append(("vehicle_id", "=", vehicle.id))
        if scope_level() == "self":
            driver = my_driver()
            domain.append(("driver_id", "=", driver.id if driver else 0))
        else:
            domain += scope_domain("vehicle_id.site_id")
        rotations = request.env["eguitra.transport.rotation"].sudo().search(
            domain, order="date_loading desc, id desc", limit=200)
        return {"date": day, "items": [
            dict(rotation_ref(r), vehicle=vehicle_ref(r.vehicle_id), driver=driver_ref(r.driver_id),
                 site=site_ref(r.vehicle_id.site_id), departed_at=r.departed_at or None,
                 date_delivery=r.date_delivery or None, date_return=r.date_return or None) for r in rotations]}

    # ─── Sites ────────────────────────────────────────────────────────────

    @hsseq_route("/hsseq/sites", profiles=APP)
    def sites(self, **kw):
        Site = request.env["eguitra.hsseq.site"].sudo().with_context(active_test=False)
        return [site_row(s) for s in Site.search([("company_id", "in", companies(kw).ids)])]

    def _site_values(self, data, site=None):
        values = {k: text(data, k, 120) for k in ("name", "code") if k in data}
        company = site.company_id if site else request.env.company
        if "company_id" in data:
            company = request.env["res.company"].browse(int_or_none(data, "company_id") or 0)
            if company not in request.env.companies:
                raise forbidden("Société non autorisée.")
            values["company_id"] = company.id
        if "default_vehicle_kind" in data:
            if data["default_vehicle_kind"] not in dict(VEHICLE_KINDS):
                raise ApiError(400, "invalid_parameter", "Type de véhicule inconnu.", fields=["default_vehicle_kind"])
            values["default_vehicle_kind"] = data["default_vehicle_kind"]
        if "active" in data:
            values["active"] = bool(data["active"])
        if "yard_manager_ids" in data:
            users = request.env["res.users"].sudo().browse(ids_list(data, "yard_manager_ids")).exists()
            wrong = users.filtered(lambda u: not u.has_group(EXPLOITATION_GROUP) or company not in u.company_ids)
            if wrong:
                raise ApiError(422, "business_rule", f"Un chef de parc est un compte Exploitation transport de la "
                                                     f"société : {', '.join(wrong.mapped('name'))}.",
                               fields=["yard_manager_ids"])
            values["manager_ids"] = [(6, 0, users.ids)]
        return values, company

    def _assign_vehicles(self, site, data):
        """Rattachement des ensembles au site (extension du contrat : Transport ne porte pas le site)."""
        if "vehicle_ids" not in data:
            return
        Vehicle = request.env["eguitra.transport.vehicle"].sudo()
        wanted = Vehicle.browse(ids_list(data, "vehicle_ids")).exists()
        if wanted.filtered(lambda v: v.company_id != site.company_id):
            raise ApiError(422, "business_rule", "Un ensemble d'une autre société ne se rattache pas à ce site.",
                           fields=["vehicle_ids"])
        (site.vehicle_ids - wanted).write({"site_id": False})
        wanted.write({"site_id": site.id})

    @hsseq_route("/hsseq/sites", methods=("POST",), profiles=CONFIG)
    def create_site(self, **_kw):
        data = read_json()
        require(data, "name", "code")
        values, company = self._site_values(data)
        site = request.env["eguitra.hsseq.site"].sudo().create(dict(values, company_id=company.id))
        self._assign_vehicles(site, data)
        return site_row(site)

    @hsseq_route("/hsseq/sites/<int:site_id>", methods=("PATCH",), profiles=CONFIG)
    def update_site(self, site_id, **_kw):
        site = get("eguitra.hsseq.site", site_id, "Site")
        data = read_json()
        values, _company = self._site_values(data, site)
        site.write(values)
        self._assign_vehicles(site, data)
        return site_row(site)

    # ─── Auditeurs (§8) ───────────────────────────────────────────────────

    def _auditor_accounts(self, kw=None):
        users = request.env["res.users"].sudo().search([("share", "=", False),
                                                        ("company_ids", "in", companies(kw).ids)])
        return users.filtered(lambda u: u.has_group(AUDITOR_GROUP))

    @hsseq_route("/hsseq/auditors", profiles=CONFIG)
    def auditors(self, **kw):
        """Comptes du profil auditeur des sociétés : date de fin d'accès et sites audités."""
        return [auditor_row(u) for u in self._auditor_accounts(kw)]

    @hsseq_route("/hsseq/auditors/<int:user_id>", methods=("PATCH",), profiles=CONFIG)
    def update_auditor(self, user_id, **_kw):
        """Périmètre et durée d'un auditeur : {access_until, site_ids} (sites de ses sociétés)."""
        user = self._auditor_accounts().filtered(lambda u: u.id == user_id)
        if not user:
            raise ApiError(404, "not_found", "Auditeur introuvable.")
        data = read_json()
        values = {}
        if "access_until" in data:
            values["hsseq_audit_until"] = date_value(data, "access_until")
        if "site_ids" in data:
            sites = request.env["eguitra.hsseq.site"].sudo().browse(ids_list(data, "site_ids")).exists()
            if sites.filtered(lambda s: s.company_id not in user.company_ids):
                raise ApiError(422, "business_rule", "Un site audité appartient à une société de l'auditeur.",
                               fields=["site_ids"])
            values["hsseq_audit_site_ids"] = [(6, 0, sites.ids)]
        before = auditor_row(user)
        user.sudo().write(values)
        after = auditor_row(user)
        request.env["eguitra.hsseq.journal"]._log(
            "auditor", user, "write", note="Périmètre ou durée de l'auditeur", field="access_until",
            old=str(before["access_until"] or ""), new=str(after["access_until"] or ""))
        return after

    # ─── Paramètres ───────────────────────────────────────────────────────

    @hsseq_route("/hsseq/settings", profiles=CONFIG)
    def settings(self, **kw):
        company = companies(kw)[:1] if kw.get("company_id") else request.env.company
        return settings_row(request.env["eguitra.hsseq.settings"]._get(company))

    @hsseq_route("/hsseq/settings", methods=("PATCH",), profiles=CONFIG)
    def update_settings(self, **_kw):
        data = read_json()
        company = companies(data)[:1] if data.get("company_id") else request.env.company
        settings = request.env["eguitra.hsseq.settings"]._get(company)
        values = {}
        for key, kind in SETTINGS_FIELDS.items():
            if key not in data:
                continue
            if kind == "date":
                values[key] = date_value(data, key)
                continue
            try:
                values[key] = (int if kind == "int" else float)(data[key] or 0)
            except (TypeError, ValueError) as e:
                raise ApiError(400, "invalid_parameter", f"Valeur invalide : {key}.", fields=[key]) from e
        if "director_id" in data:
            director = request.env["res.users"].sudo().browse(int_or_none(data, "director_id") or 0).exists()
            values["director_user_id"] = director.id or False
        if "targets" in data:
            if not isinstance(data["targets"], dict):
                raise ApiError(400, "invalid_parameter", "Cibles attendues par code d'indicateur.", fields=["targets"])
            try:
                values["targets"] = {str(k): float(v) for k, v in data["targets"].items() if v not in (None, "")}
            except (TypeError, ValueError) as e:
                raise ApiError(400, "invalid_parameter", "Cible invalide.", fields=["targets"]) from e
        settings.write(values)
        return settings_row(settings)

    # ─── Échéances (§9.3) ─────────────────────────────────────────────────

    @hsseq_route("/hsseq/deadlines", profiles=DEADLINES)
    def deadlines(self, **kw):
        try:
            horizon = min(max(int(kw.get("horizon") or 30), 0), 366)
        except (TypeError, ValueError) as e:
            raise ApiError(400, "invalid_parameter", "Horizon invalide.", fields=["horizon"]) from e
        kind = kw.get("kind") or None
        if kind and kind not in ("qualification", "vehicle_document"):
            raise ApiError(400, "invalid_parameter", "Nature d'échéance inconnue.", fields=["kind"])
        site = get("eguitra.hsseq.site", kw["site_id"], "Site") if kw.get("site_id") else None
        # Profil RH seul : les personnes, pas les véhicules.
        if not profiles() & {"admin", "direction", "hsseq", "exploitation"}:
            if kind == "vehicle_document":
                raise forbidden("Les échéances des véhicules ne relèvent pas du profil RH.")
            kind = "qualification"
        items = deadline_items(companies(kw), horizon, kind=kind, site=site, vehicle_kind=kw.get("vehicle_kind"))
        return {"horizon_days": horizon, "items": items}

    # ─── Espace du conducteur ─────────────────────────────────────────────

    @hsseq_route("/hsseq/me", profiles=None)
    def me(self, **_kw):
        """Le compte relié à un salarié RH et à un chauffeur : ses rotations du jour (et leur verrou), ses
        habilitations et son aptitude, en statut seul."""
        internal_only()
        env = request.env
        employee = env.user._hsseq_employee().sudo()
        driver = employee.driver_id
        day = today()
        rotations = env["eguitra.transport.rotation"].sudo()
        if driver:
            rotations = rotations.search([("driver_id", "=", driver.id), "|", ("state", "=", "en_route"),
                                          "&", ("state", "=", "draft"), ("date_loading", "=", day)])
        else:
            rotations = rotations.browse()
        detail = is_hsseq()
        # Ses habilitations, au format de la matrice (statut, dates d'obtention et d'expiration).
        matrix = employee._hsseq_matrix_row(
            env["eguitra.rh.qualification.type"].sudo().search([]), day) if employee else None
        cells = {c["code"]: c for c in matrix["qualifications"]} if matrix else {}
        return {
            "employee": {"id": employee.id, "name": employee.name, "matricule": employee.matricule} if employee else None,
            "driver": driver_ref(driver),
            "fitness": FITNESS.get(employee._fitness_state(day)) if employee else None,
            "qualifications": [dict({k: r[k] for k in ("code", "name", "mandatory", "state", "expiry")},
                                    **{k: cells.get(r["code"], {}).get(k) for k in ("status", "obtained_on",
                                                                                    "expires_on", "days_left")})
                               for r in employee._qualification_rows(day)] if employee else [],
            "qualifications_status": matrix["status"] if matrix else None,
            "departure_blocked": matrix["blocking"] if matrix else None,
            "rotations": [dict(rotation_ref(r), vehicle=vehicle_ref(r.vehicle_id),
                               lock=r._hsseq_evaluate(detail=detail) if r.state == "draft" else None)
                          for r in rotations],
        }

    # ─── Notifications ────────────────────────────────────────────────────

    @hsseq_route("/hsseq/notifications", profiles=None)
    def notifications(self, **kw):
        internal_only()
        domain = [("user_id", "=", request.env.uid), ("channel", "=", "app")]
        if str(kw.get("unread", "")).lower() in ("1", "true"):
            domain.append(("read_at", "=", False))
        Notification = request.env["eguitra.hsseq.notification"].sudo()
        offset, limit, order = page_args(kw, "-id", {"id": "id"})
        rows = Notification.search(domain, offset=offset, limit=limit, order=order)
        return page([n._row() for n in rows], Notification.search_count(domain), offset, limit,
                    {"unread": Notification.search_count(domain + [("read_at", "=", False)])})

    @hsseq_route("/hsseq/notifications/<int:notification_id>/read", methods=("POST",), profiles=None)
    def read_notification(self, notification_id, **_kw):
        internal_only()
        notification = request.env["eguitra.hsseq.notification"].sudo().browse(notification_id).exists()
        if not notification or notification.user_id != request.env.user:
            raise ApiError(404, "not_found", "Notification introuvable.")
        if not notification.read_at:
            notification.read_at = fields.Datetime.now()
        return notification._row()

    # ─── Journal ──────────────────────────────────────────────────────────

    @hsseq_route("/hsseq/log", profiles=LOG)
    def log(self, **kw):
        model = kw.get("model") or kw.get("object")
        record_id = kw.get("id") or kw.get("object_id")
        domain = ["|", ("company_id", "=", False), ("company_id", "in", companies(kw).ids)]
        if model:
            if model not in OBJECT_MODELS:
                raise ApiError(400, "invalid_parameter", "Fiche inconnue.", fields=["model"])
            domain.append(("model", "=", model))
            if record_id:
                domain.append(("res_id", "=", get(OBJECT_MODELS[model], record_id, "Fiche").id))
        start, end = date_value(kw, "date_from"), date_value(kw, "date_to")
        if start:
            domain.append(("at", ">=", start))
        if end:
            domain.append(("at", "<", end + timedelta(days=1)))
        Journal = request.env["eguitra.hsseq.journal"].sudo()
        offset, limit, order = page_args(kw, "-at", {"at": "at"})
        return page([journal_row(e) for e in Journal.search(domain, offset=offset, limit=limit, order=order)],
                    Journal.search_count(domain), offset, limit)
