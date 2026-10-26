"""API de l'environnement et de la qualité (spécification §3, §10, lot 3) : déversements, registre des
déchets, poussières sur site, contaminations de produit, réclamations clients ; consommation et émissions,
écarts de livraison calculés depuis Transport ; registres en Excel.

Droits : hsseq gère tout. Le chef de parc (exploitation) saisit et met à jour les déversements, les déchets
(et leur enlèvement) et les mesures de poussières de ses sites. Lecture : administration, direction, hsseq ;
chef de parc pour les déversements, déchets et poussières de ses sites ; auditeur pour toutes ces fiches de
ses sites (lecture seule, sans les noms des personnes). Portée fermée par défaut : une fiche sans site n'est
lue que des profils de lecture complète. Contaminations et réclamations : administration, direction, hsseq,
auditeur (ses sites)."""

from datetime import timedelta

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, read_json, require
from odoo.addons.eguitra_finance.controllers.exporting import export_meta, table_response

from ..models.common import (
    COMPLAINT_NATURES,
    COMPLAINT_SEVERITIES,
    COMPLAINT_STATUSES,
    CONTAMINATION_KINDS,
    CONTAMINATION_STATUSES,
    DUST_UNITS,
    SPILL_STATUSES,
    WASTE_KINDS,
    WASTE_STATUSES,
    WASTE_UNITS,
)
from ..models.environment import ANALYSIS_GROUPS
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
    in_scope,
    int_or_none,
    is_hsseq,
    my_sites,
    number,
    page,
    page_args,
    personal_data_hidden,
    profiles,
    ref,
    rotation_ref,
    scope_domain,
    sheet_filters,
    site_ref,
    site_scope,
    text,
    user_ref,
    vehicle_ref,
)

ENV_READ = ("admin", "direction", "hsseq", "exploitation", "auditeur")
ENV_FIELD = ("hsseq", "exploitation")
QUALITY_READ = ("admin", "direction", "hsseq", "auditeur")
SPILL_SORTS = {"occurred_at": "occurred_at", "reference": "reference", "volume_liters": "volume_liters",
               "status": "status"}
WASTE_SORTS = {"produced_on": "produced_on", "reference": "reference", "pickup_date": "pickup_date",
               "status": "status"}
DUST_SORTS = {"measured_on": "measured_on", "value": "value"}
CONTAMINATION_SORTS = {"detected_on": "detected_on", "reference": "reference", "status": "status"}
COMPLAINT_SORTS = {"received_on": "received_on", "reference": "reference", "response_due": "response_due",
                   "status": "status"}
EXPORT_LIMIT = 10000


def today():
    return fields.Date.context_today(request.env.user)


def person(user):
    """Nom d'un compte, retiré pour l'auditeur."""
    return None if personal_data_hidden() else user_ref(user)


def is_yard_writer(site):
    """Le chef de parc écrit sur les fiches de ses sites (portée fermée : jamais sans site)."""
    return "exploitation" in profiles() and bool(site) and site in my_sites()


def can_write(record):
    return is_hsseq() or is_yard_writer(record.sudo().site_id)


def get_scoped(model, record_id, label):
    """Fiche d'une des sociétés du compte, dans sa portée par site (404 sinon)."""
    record = get(model, record_id, label)
    if not in_scope(record.sudo().site_id):
        raise ApiError(404, "not_found", f"{label} introuvable.")
    return record


def base_domain(kw):
    return [("company_id", "in", companies(kw).ids)] + scope_domain()


def field_site(data, record=None):
    """Site d'une saisie : obligatoire et de ses sites pour le chef de parc, facultatif pour hsseq."""
    site = None
    if data.get("site_id"):
        site = get("eguitra.hsseq.site", data["site_id"], "Site")
    elif record is not None and "site_id" not in data:
        site = record.sudo().site_id or None
    if not is_hsseq() and not is_yard_writer(site):
        raise forbidden("Saisie réservée aux sites auxquels vous êtes rattaché.")
    return site


def links(data, values):
    """Rotation, ensemble, produit et événement cités par une saisie, des sociétés du compte."""
    if "rotation_id" in data:
        rotation = get("eguitra.transport.rotation", data["rotation_id"], "Rotation") if data["rotation_id"] else None
        values["rotation_id"] = rotation.id if rotation else False
    if "vehicle_id" in data:
        vehicle = get("eguitra.transport.vehicle", data["vehicle_id"], "Ensemble") if data["vehicle_id"] else None
        values["vehicle_id"] = vehicle.id if vehicle else False
    if "product_id" in data:
        product = request.env["eguitra.transport.product"].sudo().browse(int_or_none(data, "product_id") or 0).exists()
        values["product_id"] = product.id or False
    if "event_id" in data:
        event = get("eguitra.hsseq.event", data["event_id"], "Événement") if data["event_id"] else None
        values["event_id"] = event.id if event else False
    return values


def period(kw):
    """Période d'une liste ou d'une analyse : date_from et date_to, sinon le mois en cours."""
    start = date_value(kw, "date_from") or today().replace(day=1)
    end = date_value(kw, "date_to") or today()
    if end < start:
        raise ApiError(400, "invalid_parameter", "La période se termine après son début.", fields=["date_to"])
    return start, end


def choice(data, key, choices, message):
    if data.get(key) not in dict(choices):
        raise ApiError(400, "invalid_parameter", message, fields=[key])
    return data[key]


def positive(data, key, allow_zero=False):
    value = number(data, key, None)
    if value is None or value < 0 or (value == 0 and not allow_zero):
        raise ApiError(400, "invalid_parameter", f"Nombre {'positif ou nul' if allow_zero else 'positif'} attendu : "
                                                 f"{key}.", fields=[key])
    return value


# ─── Déversements ─────────────────────────────────────────────────────────


def spill_rights(spill):
    hsseq = is_hsseq()
    transitions = [t for t in spill._transitions() if hsseq]
    return transitions, {"can_edit": spill.status == "open" and can_write(spill), "can_close": "close" in transitions,
                         "can_approve": False}


def spill_row(spill, detail=False):
    spill = spill.sudo()
    transitions, rights = spill_rights(spill)
    row = {
        "id": spill.id, "reference": spill.reference, "occurred_at": spill.occurred_at, "site": site_ref(spill.site_id),
        "location": spill.location or None, "event": {"id": spill.event_id.id, "reference": spill.event_id.reference}
        if spill.event_id else None, "rotation": rotation_ref(spill.rotation_id), "vehicle": vehicle_ref(spill.vehicle_id),
        "product": ref(spill.product_id), "product_label": spill.product_label or None,
        "volume_liters": spill.volume_liters, "recovered_liters": spill.recovered_liters,
        "recovery_rate": spill.recovery_rate, "cost": spill.cost or 0, "status": spill.status,
        "rights": rights,
    }
    if detail:
        row.update({"company": company_ref(spill.company_id), "recovery": spill.recovery or None,
                    "reported_by": person(spill.reported_by), "closed_at": spill.closed_at or None,
                    "closed_by": person(spill.closed_by), "reopen_reason": spill.reopen_reason or None,
                    "attachments": attachments_rows("spill", spill), "history": history("spill", spill),
                    "transitions": transitions})
    return row


def spill_values(data, spill=None):
    values = links(data, {})
    if "occurred_at" in data:
        values["occurred_at"] = datetime_value(data, "occurred_at")
        if not values["occurred_at"] or values["occurred_at"] > fields.Datetime.now() + timedelta(minutes=5):
            raise ApiError(400, "invalid_parameter", "Date du déversement passée attendue.", fields=["occurred_at"])
    if "volume_liters" in data:
        values["volume_liters"] = positive(data, "volume_liters")
    if "recovered_liters" in data:
        values["recovered_liters"] = positive(data, "recovered_liters", allow_zero=True)
    volume = values.get("volume_liters", spill.volume_liters if spill else 0)
    if values.get("recovered_liters", spill.recovered_liters if spill else 0) > volume:
        raise ApiError(400, "invalid_parameter", "Le volume récupéré ne dépasse pas le volume déversé.",
                       fields=["recovered_liters"])
    for key, limit in (("location", 300), ("product_label", 200), ("recovery", 4000)):
        if key in data:
            values[key] = text(data, key, limit)
    if "cost" in data:
        values["cost"] = positive(data, "cost", allow_zero=True)
    return values


# ─── Déchets ──────────────────────────────────────────────────────────────


def waste_rights(waste):
    transitions = []
    for transition in waste._transitions():
        if transition == "collect" and can_write(waste):
            transitions.append(transition)
        elif transition == "reopen" and is_hsseq():
            transitions.append(transition)
    return transitions, {"can_edit": waste.status == "stored" and can_write(waste),
                         "can_close": "collect" in transitions, "can_approve": False}


def waste_row(waste, detail=False):
    waste = waste.sudo()
    transitions, rights = waste_rights(waste)
    row = {
        "id": waste.id, "reference": waste.reference, "site": site_ref(waste.site_id), "waste_kind": waste.waste_kind,
        "description": waste.description or None, "quantity": waste.quantity, "unit": waste.unit,
        "produced_on": waste.produced_on, "status": waste.status, "pickup_date": waste.pickup_date or None,
        "provider": ref(waste.provider_id) or ({"id": None, "name": waste.provider_name} if waste.provider_name
                                               else None),
        "manifest_reference": waste.manifest_reference or None,
        "manifest_attached": bool(waste._manifest()), "rights": rights,
    }
    if detail:
        row.update({"company": company_ref(waste.company_id), "note": waste.note or None,
                    "collected_by": person(waste.collected_by), "reopen_reason": waste.reopen_reason or None,
                    "attachments": attachments_rows("waste", waste), "history": history("waste", waste),
                    "transitions": transitions})
    return row


def waste_values(data, partial=False):
    values = {}
    if not partial or "waste_kind" in data:
        values["waste_kind"] = choice(data, "waste_kind", WASTE_KINDS, "Nature : used_oil, tyres, filters ou other.")
    if "unit" in data and data["unit"]:
        values["unit"] = choice(data, "unit", WASTE_UNITS, "Unité : l, kg, t ou unit.")
    if not partial or "quantity" in data:
        values["quantity"] = positive(data, "quantity")
    if "produced_on" in data:
        values["produced_on"] = date_value(data, "produced_on") or today()
        if values["produced_on"] > today():
            raise ApiError(400, "invalid_parameter", "Date d'entreposage passée ou du jour.", fields=["produced_on"])
    for key, limit in (("description", 200), ("note", 2000), ("provider_name", 200), ("manifest_reference", 64)):
        if key in data:
            values[key] = text(data, key, limit)
    if "provider_id" in data:
        partner = request.env["res.partner"].sudo().browse(int_or_none(data, "provider_id") or 0).exists()
        values["provider_id"] = partner.id or False
    if values.get("waste_kind") == "other" and not values.get("description") and not partial:
        raise ApiError(400, "missing_fields", "Précisez la nature d'un autre déchet.", fields=["description"])
    return values


# ─── Poussières ───────────────────────────────────────────────────────────


def dust_row(measure):
    measure = measure.sudo()
    return {"id": measure.id, "site": site_ref(measure.site_id), "measured_on": measure.measured_on,
            "point": measure.point or None, "value": measure.value, "unit": measure.unit,
            "threshold": measure.threshold, "exceeded": measure.exceeded, "method": measure.method or None,
            "note": measure.note or None, "measured_by": person(measure.measured_by),
            "rights": {"can_edit": can_write(measure), "can_close": False, "can_approve": False}}


def dust_values(data, partial=False):
    values = {}
    if not partial or "measured_on" in data:
        values["measured_on"] = date_value(data, "measured_on") or today()
        if values["measured_on"] > today():
            raise ApiError(400, "invalid_parameter", "Date de mesure passée ou du jour.", fields=["measured_on"])
    if not partial or "value" in data:
        values["value"] = positive(data, "value", allow_zero=True)
    if not partial or "threshold" in data:
        values["threshold"] = positive(data, "threshold")
    if not partial or "unit" in data:
        values["unit"] = choice(data, "unit", DUST_UNITS, "Unité : mg_m3 ou ug_m3.") if data.get("unit") else "mg_m3"
    for key, limit in (("point", 200), ("method", 200), ("note", 2000)):
        if key in data:
            values[key] = text(data, key, limit)
    return values


# ─── Contaminations ───────────────────────────────────────────────────────


def contamination_row(record, detail=False):
    record = record.sudo()
    transitions = [t for t in record._transitions() if is_hsseq()]
    row = {"id": record.id, "reference": record.reference, "detected_on": record.detected_on, "nature": record.nature,
           "rotation": rotation_ref(record.rotation_id), "vehicle": vehicle_ref(record.vehicle_id),
           "site": site_ref(record.site_id), "product": ref(record.product_id), "volume_m3": record.volume_m3 or None,
           "status": record.status,
           "rights": {"can_edit": is_hsseq() and record.status == "open", "can_close": "close" in transitions,
                      "can_approve": False}}
    if detail:
        row.update({"company": company_ref(record.company_id), "description": record.description,
                    "measures": record.measures or None, "cost": record.cost or 0,
                    "event": {"id": record.event_id.id, "reference": record.event_id.reference} if record.event_id
                    else None, "closed_at": record.closed_at or None, "reopen_reason": record.reopen_reason or None,
                    "attachments": attachments_rows("contamination", record),
                    "history": history("contamination", record), "transitions": transitions})
    return row


def contamination_values(data, partial=False):
    values = links(data, {})
    if not partial or "nature" in data:
        values["nature"] = choice(data, "nature", CONTAMINATION_KINDS, "Nature de contamination inconnue.")
    if not partial or "description" in data:
        values["description"] = text(data, "description", 4000)
        if not values["description"]:
            raise ApiError(400, "missing_fields", "Décrivez la contamination.", fields=["description"])
    if "detected_on" in data:
        values["detected_on"] = date_value(data, "detected_on") or today()
    if "site_id" in data:
        site = get("eguitra.hsseq.site", data["site_id"], "Site") if data["site_id"] else None
        values["site_id"] = site.id if site else False
    if "volume_m3" in data:
        values["volume_m3"] = positive(data, "volume_m3", allow_zero=True)
    if "cost" in data:
        values["cost"] = positive(data, "cost", allow_zero=True)
    if "measures" in data:
        values["measures"] = text(data, "measures", 4000)
    return values


# ─── Réclamations ─────────────────────────────────────────────────────────


def complaint_row(complaint, detail=False):
    complaint = complaint.sudo()
    transitions = [t for t in complaint._transitions() if is_hsseq()]
    if "close" in transitions and complaint._open_actions():
        transitions.remove("close")
    row = {"id": complaint.id, "reference": complaint.reference, "partner": ref(complaint.partner_id),
           "rotation": rotation_ref(complaint.rotation_id), "site": site_ref(complaint.site_id),
           "received_on": complaint.received_on, "nature": complaint.nature, "severity": complaint.severity,
           "response_due": complaint.response_due or None, "responded_on": complaint.responded_on or None,
           "response_days": complaint.response_days if complaint.responded_on else None,
           "on_time": complaint.on_time if complaint.responded_on else None, "overdue": complaint._overdue(today()),
           "status": complaint.status,
           "open_actions": len(complaint._open_actions()),
           "rights": {"can_edit": is_hsseq() and complaint.status != "closed", "can_close": "close" in transitions,
                      "can_approve": False}}
    if detail:
        row.update({"company": company_ref(complaint.company_id), "description": complaint.description,
                    "response": complaint.response or None, "responded_by": person(complaint.responded_by),
                    "vehicle": vehicle_ref(complaint.vehicle_id), "actions": [action_line(a) for a in complaint.action_ids],
                    "closed_at": complaint.closed_at or None, "reopen_reason": complaint.reopen_reason or None,
                    "attachments": attachments_rows("complaint", complaint), "history": history("complaint", complaint),
                    "transitions": transitions})
    return row


def complaint_values(data, partial=False):
    values = links(data, {})
    values.pop("product_id", None)
    values.pop("event_id", None)
    if not partial or "nature" in data:
        values["nature"] = choice(data, "nature", COMPLAINT_NATURES, "Nature de réclamation inconnue.")
    if "severity" in data or not partial:
        values["severity"] = choice(data, "severity", COMPLAINT_SEVERITIES, "Gravité : minor, major ou critical.") \
            if data.get("severity") else "minor"
    if not partial or "description" in data:
        values["description"] = text(data, "description", 4000)
        if not values["description"]:
            raise ApiError(400, "missing_fields", "Décrivez la réclamation.", fields=["description"])
    if "received_on" in data:
        values["received_on"] = date_value(data, "received_on") or today()
        if values["received_on"] > today():
            raise ApiError(400, "invalid_parameter", "Date de réception passée ou du jour.", fields=["received_on"])
    if "response_due" in data and partial:
        values["response_due"] = date_value(data, "response_due")
    if "partner_id" in data:
        partner = request.env["res.partner"].sudo().browse(int_or_none(data, "partner_id") or 0).exists()
        if not partner:
            raise ApiError(400, "missing_fields", "Client de la réclamation manquant.", fields=["partner_id"])
        values["partner_id"] = partner.id
    if "site_id" in data:
        site = get("eguitra.hsseq.site", data["site_id"], "Site") if data["site_id"] else None
        values["site_id"] = site.id if site else False
    return values


# ─── Analyses ─────────────────────────────────────────────────────────────


def analysis_args(kw):
    """Période, regroupement, sites (portée fermée par défaut) et profil d'une analyse."""
    start, end = period(kw)
    group_by = kw.get("group_by") or "vehicle"
    if group_by not in ANALYSIS_GROUPS:
        raise ApiError(400, "invalid_parameter", "Regroupement : vehicle, site, month ou rotation.", fields=["group_by"])
    kind = kw.get("vehicle_kind") or None
    if kind and kind not in ("tanker", "tipper"):
        raise ApiError(400, "invalid_parameter", "Type de véhicule : tanker ou tipper.", fields=["vehicle_kind"])
    sites = site_scope()
    if kw.get("site_id"):
        site = get("eguitra.hsseq.site", kw["site_id"], "Site")
        if not in_scope(site):
            raise forbidden("Site non autorisé.")
        sites = site
    return start, end, group_by, sites, kind


def reads_quality():
    return bool(profiles() & set(QUALITY_READ))


class EguitraHsseqEnvironment(http.Controller):
    # ─── Déversements ─────────────────────────────────────────────────────

    def _spill_domain(self, kw):
        domain = base_domain(kw)
        if kw.get("status"):
            domain.append(("status", "in", kw["status"].split(",")))
        for key in ("site_id", "vehicle_id", "event_id"):
            if kw.get(key):
                domain.append((key, "=", int_or_none(kw, key)))
        if kw.get("date_from"):
            domain.append(("occurred_at", ">=", date_value(kw, "date_from")))
        if kw.get("date_to"):
            domain.append(("occurred_at", "<", date_value(kw, "date_to") + timedelta(days=1)))
        return domain

    @hsseq_route("/hsseq/spills", profiles=ENV_READ)
    def spills(self, **kw):
        domain = self._spill_domain(kw)
        offset, limit, order = page_args(kw, "-occurred_at", SPILL_SORTS)
        Spill = request.env["eguitra.hsseq.spill"].sudo()
        everything = Spill.search(domain)
        counts = {"by_status": {code: len(everything.filtered(lambda s, c=code: s.status == c))
                                for code, _l in SPILL_STATUSES},
                  "volume_liters": round(sum(everything.mapped("volume_liters")), 1),
                  "recovered_liters": round(sum(everything.mapped("recovered_liters")), 1)}
        return page([spill_row(s) for s in Spill.search(domain, offset=offset, limit=limit, order=order)],
                    len(everything), offset, limit, counts)

    @hsseq_route("/hsseq/spills/<int:spill_id>", profiles=ENV_READ)
    def spill(self, spill_id, **_kw):
        return spill_row(get_scoped("eguitra.hsseq.spill", spill_id, "Déversement"), detail=True)

    @hsseq_route("/hsseq/spills", methods=("POST",), profiles=ENV_FIELD)
    def create_spill(self, **_kw):
        data = read_json()
        require(data, "occurred_at", "volume_liters")
        site = field_site(data)
        values = spill_values(data)
        company = site.company_id if site else (companies(data)[:1] if data.get("company_id") else request.env.company)
        values.update(site_id=site.id if site else False, company_id=company.id, reported_by=request.env.uid)
        spill = request.env["eguitra.hsseq.spill"].sudo().create(values)
        return spill_row(spill, detail=True)

    @hsseq_route("/hsseq/spills/<int:spill_id>", methods=("PATCH",), profiles=ENV_FIELD)
    def update_spill(self, spill_id, **_kw):
        spill = get_scoped("eguitra.hsseq.spill", spill_id, "Déversement")
        if not spill_row(spill)["rights"]["can_edit"]:
            raise forbidden("Déversement clos, ou hors de vos sites.")
        data = read_json()
        values = spill_values(data, spill)
        if "site_id" in data:
            site = field_site(data, spill)
            values["site_id"] = site.id if site else False
        spill.write(values)
        return spill_row(spill, detail=True)

    @hsseq_route("/hsseq/spills/<int:spill_id>/<string:transition>", methods=("POST",), profiles=HSSEQ)
    def spill_transition(self, spill_id, transition, **_kw):
        if transition not in ("close", "reopen"):
            raise ApiError(404, "not_found", "Transition inconnue.")
        spill = get_scoped("eguitra.hsseq.spill", spill_id, "Déversement")
        data = read_json()
        if "recovery" in data:
            spill.write({"recovery": text(data, "recovery", 4000)})
        if transition == "close":
            spill.action_close()
        else:
            spill.action_reopen(data.get("reason"))
        return spill_row(spill, detail=True)

    # ─── Déchets ──────────────────────────────────────────────────────────

    def _waste_domain(self, kw):
        domain = base_domain(kw)
        for key in ("status", "waste_kind"):
            if kw.get(key):
                domain.append((key, "in", kw[key].split(",")))
        if kw.get("site_id"):
            domain.append(("site_id", "=", int_or_none(kw, "site_id")))
        if kw.get("date_from"):
            domain.append(("produced_on", ">=", date_value(kw, "date_from")))
        if kw.get("date_to"):
            domain.append(("produced_on", "<=", date_value(kw, "date_to")))
        return domain

    @hsseq_route("/hsseq/wastes", profiles=ENV_READ)
    def wastes(self, **kw):
        domain = self._waste_domain(kw)
        offset, limit, order = page_args(kw, "-produced_on", WASTE_SORTS)
        Waste = request.env["eguitra.hsseq.waste"].sudo()
        everything = Waste.search(domain)
        quantities = {}
        for waste in everything.filtered(lambda w: w.status == "stored"):
            key = f"{waste.waste_kind}:{waste.unit}"
            quantities[key] = round(quantities.get(key, 0.0) + waste.quantity, 2)
        counts = {"by_status": {code: len(everything.filtered(lambda w, c=code: w.status == c))
                                for code, _l in WASTE_STATUSES},
                  "stored_quantities": [{"waste_kind": k.split(":")[0], "unit": k.split(":")[1], "quantity": q}
                                        for k, q in sorted(quantities.items())]}
        return page([waste_row(w) for w in Waste.search(domain, offset=offset, limit=limit, order=order)],
                    len(everything), offset, limit, counts)

    @hsseq_route("/hsseq/wastes/<int:waste_id>", profiles=ENV_READ)
    def waste(self, waste_id, **_kw):
        return waste_row(get_scoped("eguitra.hsseq.waste", waste_id, "Déchet"), detail=True)

    @hsseq_route("/hsseq/wastes", methods=("POST",), profiles=ENV_FIELD)
    def create_waste(self, **_kw):
        data = read_json()
        require(data, "waste_kind", "quantity")
        site = field_site(data)
        values = waste_values(data)
        company = site.company_id if site else (companies(data)[:1] if data.get("company_id") else request.env.company)
        values.update(site_id=site.id if site else False, company_id=company.id)
        return waste_row(request.env["eguitra.hsseq.waste"].sudo().create(values), detail=True)

    @hsseq_route("/hsseq/wastes/<int:waste_id>", methods=("PATCH",), profiles=ENV_FIELD)
    def update_waste(self, waste_id, **_kw):
        waste = get_scoped("eguitra.hsseq.waste", waste_id, "Déchet")
        if not waste_row(waste)["rights"]["can_edit"]:
            raise forbidden("Déchet enlevé, ou hors de vos sites.")
        data = read_json()
        values = waste_values(data, partial=True)
        if "site_id" in data:
            site = field_site(data, waste)
            values["site_id"] = site.id if site else False
        waste.write(values)
        return waste_row(waste, detail=True)

    @hsseq_route("/hsseq/wastes/<int:waste_id>/<string:transition>", methods=("POST",), profiles=ENV_FIELD)
    def waste_transition(self, waste_id, transition, **_kw):
        if transition not in ("collect", "reopen"):
            raise ApiError(404, "not_found", "Transition inconnue.")
        waste = get_scoped("eguitra.hsseq.waste", waste_id, "Déchet")
        data = read_json()
        if transition == "reopen":
            if not is_hsseq():
                raise forbidden("Réouverture réservée au Responsable HSSEQ.")
            waste.action_reopen(data.get("reason"))
            return waste_row(waste, detail=True)
        if not can_write(waste):
            raise forbidden("Enlèvement des déchets de vos sites seulement.")
        provider = request.env["res.partner"].sudo().browse(int_or_none(data, "provider_id") or 0).exists()
        waste.action_collect(date_value(data, "pickup_date"), text(data, "manifest_reference", 64), provider or None,
                             text(data, "provider_name", 200) or None)
        return waste_row(waste, detail=True)

    # ─── Poussières ───────────────────────────────────────────────────────

    def _dust_domain(self, kw):
        domain = base_domain(kw)
        if kw.get("site_id"):
            domain.append(("site_id", "=", int_or_none(kw, "site_id")))
        if str(kw.get("exceeded", "")) in ("1", "true"):
            domain.append(("exceeded", "=", True))
        if kw.get("date_from"):
            domain.append(("measured_on", ">=", date_value(kw, "date_from")))
        if kw.get("date_to"):
            domain.append(("measured_on", "<=", date_value(kw, "date_to")))
        return domain

    @hsseq_route("/hsseq/dust-measurements", profiles=ENV_READ)
    def dust_measurements(self, **kw):
        domain = self._dust_domain(kw)
        offset, limit, order = page_args(kw, "-measured_on", DUST_SORTS)
        Dust = request.env["eguitra.hsseq.dust"].sudo()
        return page([dust_row(m) for m in Dust.search(domain, offset=offset, limit=limit, order=order)],
                    Dust.search_count(domain), offset, limit,
                    {"exceeded": Dust.search_count(domain + [("exceeded", "=", True)])})

    @hsseq_route("/hsseq/dust-measurements", methods=("POST",), profiles=ENV_FIELD)
    def create_dust(self, **_kw):
        data = read_json()
        require(data, "site_id", "value", "threshold")
        site = field_site(data)
        values = dust_values(data)
        values.update(site_id=site.id, company_id=site.company_id.id, measured_by=request.env.uid)
        return dust_row(request.env["eguitra.hsseq.dust"].sudo().create(values))

    @hsseq_route("/hsseq/dust-measurements/<int:measure_id>", methods=("PATCH",), profiles=ENV_FIELD)
    def update_dust(self, measure_id, **_kw):
        measure = get_scoped("eguitra.hsseq.dust", measure_id, "Mesure")
        if not can_write(measure):
            raise forbidden("Mesure d'un site hors de vos sites.")
        data = read_json()
        values = dust_values(data, partial=True)
        if "site_id" in data:
            site = field_site(data, measure)
            if not site:
                raise ApiError(400, "missing_fields", "Site de la mesure manquant.", fields=["site_id"])
            values["site_id"] = site.id
        measure.write(values)
        return dust_row(measure)

    # ─── Contaminations ───────────────────────────────────────────────────

    def _contamination_domain(self, kw):
        domain = base_domain(kw)
        for key in ("status", "nature"):
            if kw.get(key):
                domain.append((key, "in", kw[key].split(",")))
        for key in ("site_id", "rotation_id", "vehicle_id"):
            if kw.get(key):
                domain.append((key, "=", int_or_none(kw, key)))
        if kw.get("date_from"):
            domain.append(("detected_on", ">=", date_value(kw, "date_from")))
        if kw.get("date_to"):
            domain.append(("detected_on", "<=", date_value(kw, "date_to")))
        return domain

    @hsseq_route("/hsseq/contaminations", profiles=QUALITY_READ)
    def contaminations(self, **kw):
        domain = self._contamination_domain(kw)
        offset, limit, order = page_args(kw, "-detected_on", CONTAMINATION_SORTS)
        Model = request.env["eguitra.hsseq.contamination"].sudo()
        counts = {"by_status": {code: Model.search_count(domain + [("status", "=", code)])
                                for code, _l in CONTAMINATION_STATUSES}}
        return page([contamination_row(r) for r in Model.search(domain, offset=offset, limit=limit, order=order)],
                    Model.search_count(domain), offset, limit, counts)

    @hsseq_route("/hsseq/contaminations/<int:record_id>", profiles=QUALITY_READ)
    def contamination(self, record_id, **_kw):
        return contamination_row(get_scoped("eguitra.hsseq.contamination", record_id, "Contamination"), detail=True)

    @hsseq_route("/hsseq/contaminations", methods=("POST",), profiles=HSSEQ)
    def create_contamination(self, **_kw):
        data = read_json()
        require(data, "nature", "description")
        company = companies(data)[:1] if data.get("company_id") else request.env.company
        record = request.env["eguitra.hsseq.contamination"].sudo().create(
            dict(contamination_values(data), company_id=company.id))
        return contamination_row(record, detail=True)

    @hsseq_route("/hsseq/contaminations/<int:record_id>", methods=("PATCH",), profiles=HSSEQ)
    def update_contamination(self, record_id, **_kw):
        record = get_scoped("eguitra.hsseq.contamination", record_id, "Contamination")
        if record.status != "open":
            raise ApiError(422, "invalid_transition", "Contamination close : rouvrez-la avant de la modifier.")
        record.write(contamination_values(read_json(), partial=True))
        return contamination_row(record, detail=True)

    @hsseq_route("/hsseq/contaminations/<int:record_id>/<string:transition>", methods=("POST",), profiles=HSSEQ)
    def contamination_transition(self, record_id, transition, **_kw):
        if transition not in ("close", "reopen"):
            raise ApiError(404, "not_found", "Transition inconnue.")
        record = get_scoped("eguitra.hsseq.contamination", record_id, "Contamination")
        data = read_json()
        if "measures" in data:
            record.write({"measures": text(data, "measures", 4000)})
        if transition == "close":
            record.action_close()
        else:
            record.action_reopen(data.get("reason"))
        return contamination_row(record, detail=True)

    # ─── Réclamations ─────────────────────────────────────────────────────

    def _complaint_domain(self, kw):
        domain = base_domain(kw)
        for key in ("status", "nature", "severity"):
            if kw.get(key):
                domain.append((key, "in", kw[key].split(",")))
        for key in ("partner_id", "site_id", "rotation_id"):
            if kw.get(key):
                domain.append((key, "=", int_or_none(kw, key)))
        if str(kw.get("overdue", "")) in ("1", "true"):
            domain += [("status", "=", "received"), ("response_due", "<", today())]
        if kw.get("date_from"):
            domain.append(("received_on", ">=", date_value(kw, "date_from")))
        if kw.get("date_to"):
            domain.append(("received_on", "<=", date_value(kw, "date_to")))
        return domain

    @hsseq_route("/hsseq/complaints", profiles=QUALITY_READ)
    def complaints(self, **kw):
        domain = self._complaint_domain(kw)
        offset, limit, order = page_args(kw, "-received_on", COMPLAINT_SORTS)
        Model = request.env["eguitra.hsseq.complaint"].sudo()
        counts = {"by_status": {code: Model.search_count(domain + [("status", "=", code)])
                                for code, _l in COMPLAINT_STATUSES},
                  "overdue": Model.search_count(domain + [("status", "=", "received"), ("response_due", "<", today())])}
        return page([complaint_row(c) for c in Model.search(domain, offset=offset, limit=limit, order=order)],
                    Model.search_count(domain), offset, limit, counts)

    @hsseq_route("/hsseq/complaints/<int:complaint_id>", profiles=QUALITY_READ)
    def complaint(self, complaint_id, **_kw):
        return complaint_row(get_scoped("eguitra.hsseq.complaint", complaint_id, "Réclamation"), detail=True)

    @hsseq_route("/hsseq/complaints", methods=("POST",), profiles=HSSEQ)
    def create_complaint(self, **_kw):
        data = read_json()
        require(data, "nature", "description")
        if not data.get("partner_id") and not data.get("rotation_id"):
            raise ApiError(400, "missing_fields", "Client ou rotation de la réclamation manquant.",
                           fields=["partner_id"])
        values = complaint_values(data)
        company = companies(data)[:1] if data.get("company_id") else request.env.company
        if values.get("rotation_id"):
            company = request.env["eguitra.transport.rotation"].sudo().browse(values["rotation_id"]).company_id
        record = request.env["eguitra.hsseq.complaint"].sudo().create(dict(values, company_id=company.id))
        return complaint_row(record, detail=True)

    @hsseq_route("/hsseq/complaints/<int:complaint_id>", methods=("PATCH",), profiles=HSSEQ)
    def update_complaint(self, complaint_id, **_kw):
        complaint = get_scoped("eguitra.hsseq.complaint", complaint_id, "Réclamation")
        if complaint.status == "closed":
            raise ApiError(422, "invalid_transition", "Réclamation close : rouvrez-la avant de la modifier.")
        complaint.write(complaint_values(read_json(), partial=True))
        return complaint_row(complaint, detail=True)

    @hsseq_route("/hsseq/complaints/<int:complaint_id>/<string:transition>", methods=("POST",), profiles=HSSEQ)
    def complaint_transition(self, complaint_id, transition, **_kw):
        if transition not in ("answer", "close", "reopen"):
            raise ApiError(404, "not_found", "Transition inconnue.")
        complaint = get_scoped("eguitra.hsseq.complaint", complaint_id, "Réclamation")
        data = read_json()
        if transition == "answer":
            complaint.action_answer(text(data, "response", 4000), date_value(data, "responded_on"))
        elif transition == "close":
            complaint.action_close()
        else:
            complaint.action_reopen(data.get("reason"))
        return complaint_row(complaint, detail=True)

    # ─── Analyses depuis Transport ────────────────────────────────────────

    @hsseq_route("/hsseq/environment/consumption", profiles=ENV_READ)
    def consumption(self, **kw):
        """Consommation (L/100 km) et émissions (kg de CO₂ par km), par véhicule, site, mois ou rotation."""
        start, end, group_by, sites, kind = analysis_args(kw)
        result = request.env["eguitra.hsseq.environment"]._consumption(companies(kw), start, end, sites, kind, group_by)
        return dict(result, date_from=start, date_to=end, vehicle_kind=kind,
                    source="Transport : rotations parties (en route, validées, facturées), carburant saisi")

    @hsseq_route("/hsseq/environment/deliveries", profiles=ENV_READ)
    def deliveries(self, **kw):
        """Écarts de livraison : manquants des citernes et écarts de tonnage des bennes (‰)."""
        start, end, group_by, sites, kind = analysis_args(kw)
        result = request.env["eguitra.hsseq.environment"]._deliveries(companies(kw), start, end, sites, kind, group_by)
        return dict(result, date_from=start, date_to=end, vehicle_kind=kind,
                    source="Transport : rotations livrées ; benne : poids net du ticket de pesée et quantité livrée")

    # ─── Registres ────────────────────────────────────────────────────────

    @hsseq_route("/hsseq/environment/export.xlsx", profiles=ENV_READ)
    def export(self, **kw):
        """Registres de l'environnement et de la qualité, aux mêmes domaines que les listes du même compte ;
        contaminations et réclamations pour les profils qui les lisent ; consommation et écarts de livraison
        de la période, par véhicule. Filtres communs company_id, site_id, date_from et date_to ; filtres
        propres à chaque feuille, préfixés : spills_, wastes_, dust_, contaminations_, complaints_, analysis_
        (spills_status=closed, analysis_vehicle_kind=tipper…)."""
        env = request.env
        comps = companies(kw)
        meta = export_meta(comps)
        spills = env["eguitra.hsseq.spill"].sudo().search(self._spill_domain(sheet_filters(kw, "spills")),
                                                          order="occurred_at, id", limit=EXPORT_LIMIT)
        wastes = env["eguitra.hsseq.waste"].sudo().search(self._waste_domain(sheet_filters(kw, "wastes")),
                                                          order="produced_on, id", limit=EXPORT_LIMIT)
        dust = env["eguitra.hsseq.dust"].sudo().search(self._dust_domain(sheet_filters(kw, "dust")),
                                                       order="measured_on, id", limit=EXPORT_LIMIT)
        kinds, units, wstat = dict(WASTE_KINDS), dict(WASTE_UNITS), dict(WASTE_STATUSES)
        sheets = [
            {"title": "Déversements", "meta": meta,
             "columns": [("Référence", "text"), ("Survenu le", "date"), ("Site", "text"), ("Lieu", "text"),
                         ("Produit", "text"), ("Volume (L)", "number"), ("Récupéré (L)", "number"),
                         ("Récupération", "text"), ("Coût", "money"), ("Événement", "text"), ("Statut", "text")],
             "rows": [[s.reference, s.occurred_at, s.site_id.name or "", s.location or "",
                       s.product_id.name or s.product_label or "", s.volume_liters, s.recovered_liters,
                       s.recovery or "", s.cost, s.event_id.reference or "", dict(SPILL_STATUSES).get(s.status)]
                      for s in spills], "totals": None},
            {"title": "Registre des déchets", "meta": meta,
             "columns": [("Référence", "text"), ("Site", "text"), ("Nature", "text"), ("Précision", "text"),
                         ("Quantité", "number"), ("Unité", "text"), ("Entreposé le", "date"), ("Statut", "text"),
                         ("Enlevé le", "date"), ("Prestataire", "text"), ("Bordereau", "text")],
             "rows": [[w.reference, w.site_id.name or "", kinds.get(w.waste_kind), w.description or "", w.quantity,
                       units.get(w.unit), w.produced_on, wstat.get(w.status), w.pickup_date or None,
                       w.provider_id.name or w.provider_name or "", w.manifest_reference or ""] for w in wastes],
             "totals": None},
            {"title": "Poussières", "meta": meta,
             "columns": [("Site", "text"), ("Mesuré le", "date"), ("Point", "text"), ("Valeur", "number"),
                         ("Unité", "text"), ("Seuil", "number"), ("Dépassement", "text"), ("Méthode", "text")],
             "rows": [[m.site_id.name, m.measured_on, m.point or "", m.value, dict(DUST_UNITS).get(m.unit),
                       m.threshold, "Oui" if m.exceeded else "Non", m.method or ""] for m in dust], "totals": None},
        ]
        if reads_quality():
            contaminations = env["eguitra.hsseq.contamination"].sudo().search(
                self._contamination_domain(sheet_filters(kw, "contaminations")), order="detected_on, id",
                limit=EXPORT_LIMIT)
            complaints = env["eguitra.hsseq.complaint"].sudo().search(
                self._complaint_domain(sheet_filters(kw, "complaints")), order="received_on, id",
                limit=EXPORT_LIMIT)
            sheets += [
                {"title": "Contaminations", "meta": meta,
                 "columns": [("Référence", "text"), ("Constatée le", "date"), ("Nature", "text"), ("Rotation", "text"),
                             ("Ensemble", "text"), ("Produit", "text"), ("Volume (m³)", "number"), ("Constat", "text"),
                             ("Mesures", "text"), ("Statut", "text")],
                 "rows": [[c.reference, c.detected_on, dict(CONTAMINATION_KINDS).get(c.nature), c.rotation_id.name or "",
                           c.vehicle_id.name or "", c.product_id.name or "", c.volume_m3, c.description,
                           c.measures or "", dict(CONTAMINATION_STATUSES).get(c.status)] for c in contaminations],
                 "totals": None},
                {"title": "Réclamations clients", "meta": meta,
                 "columns": [("Référence", "text"), ("Reçue le", "date"), ("Client", "text"), ("Rotation", "text"),
                             ("Nature", "text"), ("Gravité", "text"), ("Réclamation", "text"),
                             ("Réponse attendue", "date"), ("Répondue le", "date"), ("Délai (jours)", "int"),
                             ("Dans le délai", "text"), ("Statut", "text")],
                 "rows": [[c.reference, c.received_on, c.partner_id.name, c.rotation_id.name or "",
                           dict(COMPLAINT_NATURES).get(c.nature), dict(COMPLAINT_SEVERITIES).get(c.severity),
                           c.description, c.response_due or None, c.responded_on or None,
                           c.response_days if c.responded_on else None,
                           ("Oui" if c.on_time else "Non") if c.responded_on else "",
                           dict(COMPLAINT_STATUSES).get(c.status)] for c in complaints], "totals": None},
            ]
        start, end, _group_by, sites, kind = analysis_args(dict(sheet_filters(kw, "analysis"), group_by="vehicle"))
        Analysis = env["eguitra.hsseq.environment"]
        consumption = Analysis._consumption(comps, start, end, sites, kind, "vehicle")
        deliveries = Analysis._deliveries(comps, start, end, sites, kind, "vehicle")
        label = f"du {start:%d/%m/%Y} au {end:%d/%m/%Y}"
        analysis_meta = export_meta(comps, [("Période", label)])
        sheets += [
            {"title": "Consommation et émissions", "meta": analysis_meta,
             "columns": [("Ensemble", "text"), ("Rotations", "int"), ("Km", "number"), ("Carburant (L)", "number"),
                         ("L/100 km", "number"), ("CO₂ (kg)", "number"), ("kg CO₂/km", "number")],
             "rows": [[r["label"], r["rotations"], r["km"], r["fuel_liters"], r["l_100km"], r["co2_kg"],
                       r["co2_kg_per_km"]] for r in consumption["items"]], "totals": None},
            {"title": "Écarts de livraison", "meta": analysis_meta,
             "columns": [("Profil", "text"), ("Ensemble", "text"), ("Rotations", "int"), ("Chargé", "number"),
                         ("Livré", "number"), ("Écart", "number"), ("Écart (‰)", "number")],
             "rows": [["Citerne (m³)", r["label"], r["rotations"], r["loaded_15"], r["delivered"], r["shortage"],
                       r["per_mille"]] for r in deliveries["tanker"]["items"]]
             + [["Benne (t)", r["label"], r["rotations"], r["loaded_t"], r["delivered_t"], r["variance_t"],
                 r["per_mille"]] for r in deliveries["tipper"]["items"]], "totals": None},
        ]
        return table_response(f"environnement_qualite_hsseq_{today():%Y%m%d}", sheets)
