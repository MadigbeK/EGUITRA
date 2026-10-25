"""Référentiels d'HSSEQ (sites, véhicules, conducteurs, responsables possibles d'une action, seuils de
criticité), sites et paramètres, échéances à 30 jours, espace du conducteur, notifications et journal."""

from datetime import timedelta

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, read_json, require

from ..models.common import EXPLOITATION_GROUP, OBJECT_MODELS, VEHICLE_KINDS
from .common import (
    APP,
    CONFIG,
    DEADLINES,
    LOG,
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
    is_yard,
    journal_row,
    my_driver,
    my_sites,
    page,
    page_args,
    profiles,
    rotation_ref,
    site_ref,
    text,
    user_ref,
    vehicle_ref,
)

FITNESS = {"apte": "fit", "apte_reserve": "review", "inapte": "unfit", "echue": "unfit", "inconnu": "review"}
DOCUMENT_REASON = {"insurance": "V05", "inspection": "V05", "calibration": "V06", "tightness": "V06"}
SETTINGS_FIELDS = {
    "lock_start_date": "date", "qualifications_required_from": "date", "employee_file_required_from": "date",
    "documents_required_from": "date", "level_moderate_min": "int", "level_significant_min": "int",
    "level_high_min": "int", "investigation_hours_high": "int", "investigation_days_significant": "int",
    "investigation_days_moderate": "int", "client_notice_hours": "int", "verification_min_criticality": "int",
    "verification_days": "int", "escalation_days": "int", "costly_action_threshold": "float",
    "check_window_hours": "int", "breath_test_window_hours": "int",
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
    l'horizon, expirées comprises, date croissante ; bornées aux sites d'un chef de parc."""
    env = request.env
    day = today()
    limit = day + timedelta(days=horizon)
    yard_sites = my_sites() if is_yard() else env["eguitra.hsseq.site"]
    vehicles = env["eguitra.transport.vehicle"].sudo().search([("company_id", "in", comps.ids)])
    on_site = driver_sites(vehicles)
    Site = env["eguitra.hsseq.site"].sudo()
    items = []

    def keep(site_id):
        if site and site_id != site.id:
            return False
        return not yard_sites or not site_id or site_id in yard_sites.ids

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
        on_site = driver_sites(vehicles)
        owners = env["res.users"]
        if not field_only:
            owners = env["res.users"].sudo().search([("share", "=", False), ("company_ids", "in", comps.ids)], limit=500)
            owners = owners.filtered(lambda u: set(u._eguitra_profiles()) - {"conducteur"})
        settings = env["eguitra.hsseq.settings"]._get(env.company)
        employee = env.user._hsseq_employee()
        return {
            "sites": [site_row(s) for s in sites],
            "vehicles": [dict(vehicle_ref(v), site_id=v.site_id.id or None, driver_id=v.driver_id.id or None,
                              payload_tonnes=(v.payload_tonnes or None) if "payload_tonnes" in v._fields else None)
                         for v in vehicles],
            "drivers": [dict(driver_ref(d), site_id=on_site.get(d.id)) for d in drivers],
            "owners": [user_ref(u) for u in owners],
            "criticality_thresholds": settings._thresholds(),
            "costly_action_threshold": settings.costly_action_threshold,
            "check_window_hours": settings.check_window_hours,
            "breath_test_window_hours": settings.breath_test_window_hours,
            "vehicle_kinds": [{"code": k, "label": label} for k, label in VEHICLE_KINDS],
            "me": {"profiles": sorted(user_profiles), "site_ids": my_sites().ids,
                   "employee_id": employee.id or None, "driver_id": driver.id or None},
        }

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
        return {
            "employee": {"id": employee.id, "name": employee.name, "matricule": employee.matricule} if employee else None,
            "driver": driver_ref(driver),
            "fitness": FITNESS.get(employee._fitness_state(day)) if employee else None,
            "qualifications": [{k: r[k] for k in ("code", "name", "mandatory", "state", "expiry")}
                               for r in employee._qualification_rows(day)] if employee else [],
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
