"""API des contrôles avant départ (contrat §7) : grilles par type de véhicule (lisibles en entier pour le
cache de NIMOVA Terrain, avec leur version), saisie idempotente par client_uuid, non-conformités et leur
levée par le chef de parc (photo de la correction obligatoire). Pas de contre-visa au lot 1."""

import base64
import binascii
from datetime import timedelta

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, read_json, require
from odoo.addons.eguitra_api.files import checked_name, detect_type

from ..models.common import CHECK_KINDS, CHECK_RESULTS, VEHICLE_KINDS
from .common import (
    CONFIG,
    FIELD,
    attachments_rows,
    claim_attachments,
    client_uuid,
    companies,
    date_value,
    driver_ref,
    existing_by_uuid,
    forbidden,
    get,
    gps,
    gps_fields,
    history,
    hsseq_route,
    ids_list,
    int_or_none,
    is_hsseq,
    is_self_only,
    is_yard,
    my_driver,
    my_sites,
    number,
    page,
    page_args,
    profiles,
    reads_all,
    ref,
    reported_at,
    rotation_ref,
    scope_level,
    site_allowed,
    site_ref,
    text,
    user_ref,
    vehicle_ref,
)

TEMPLATE_READ = ("admin", "direction", "hsseq", "exploitation", "conducteur")
CHECK_READ = ("admin", "direction", "hsseq", "exploitation", "conducteur")
NC_READ = ("admin", "direction", "hsseq", "exploitation")
LIFT = ("hsseq", "exploitation")
SORTS = {"reported_at": "reported_at", "result": "result", "reference": "reference"}
MAX_SIGNATURE = 512 * 1024


# ─── Grilles ──────────────────────────────────────────────────────────────


def item_row(item):
    return {"id": item.id, "label": item.label, "blocking": item.blocking, "sequence": item.sequence,
            "linked_to": item.linked_to or None, "active": item.active}


def template_row(template, all_items=False):
    template = template.sudo()
    items = template._items(active_only=not all_items)
    stamps = [d for d in [template.write_date, *items.mapped("write_date")] if d]
    last = max(stamps) if stamps else template.create_date
    return {"id": template.id, "name": template.name, "kind": template.kind, "vehicle_kind": template.vehicle_kind,
            "version": template.version, "active": template.active, "items": [item_row(i) for i in items],
            "updated_at": last, "updated_by": user_ref(template.write_uid)}


def _template_values(data):
    values = {}
    if "name" in data:
        values["name"] = text(data, "name", 200)
    if "kind" in data:
        if data["kind"] not in dict(CHECK_KINDS):
            raise ApiError(400, "invalid_parameter", "Nature de grille inconnue.", fields=["kind"])
        values["kind"] = data["kind"]
    if "vehicle_kind" in data:
        if data["vehicle_kind"] not in dict(VEHICLE_KINDS):
            raise ApiError(400, "invalid_parameter", "Type de véhicule inconnu.", fields=["vehicle_kind"])
        values["vehicle_kind"] = data["vehicle_kind"]
    if "active" in data:
        values["active"] = bool(data["active"])
    return values


def _item_values(item):
    if not isinstance(item, dict) or not str(item.get("label") or "").strip():
        raise ApiError(400, "invalid_parameter", "Chaque point de la grille a un libellé.", fields=["items"])
    linked = item.get("linked_to") or False
    if linked and linked != "breath_test":
        raise ApiError(400, "invalid_parameter", "Seul le formulaire d'alcootest se relie à un point.", fields=["items"])
    return {"label": str(item["label"]).strip()[:300], "blocking": bool(item.get("blocking")),
            "sequence": int(number(item, "sequence", 10)), "linked_to": linked,
            "active": bool(item.get("active", True))}


# ─── Contrôles ────────────────────────────────────────────────────────────


def can_read(check):
    """Privilège positif : tout (administration, direction, hsseq), le site (chef de parc), soi-même sinon."""
    if reads_all():
        return True
    if is_yard():
        return site_allowed(check.site_id)
    driver = my_driver()
    return check.author_id == request.env.user or bool(driver and check.driver_id == driver)


def read_domain(kw):
    domain = [("company_id", "in", companies(kw).ids)]
    if reads_all():
        return domain
    if is_yard():
        sites = my_sites()
        if sites:
            domain += ["|", ("site_id", "in", sites.ids), ("site_id", "=", False)]
        return domain
    driver = my_driver()
    own = [("author_id", "=", request.env.uid)]
    return domain + (["|", ("driver_id", "=", driver.id)] + own if driver else own)


def can_lift(nc):
    return nc.status == "open" and (is_hsseq() or ("exploitation" in profiles() and site_allowed(nc.site_id)))


def nc_row(nc):
    nc = nc.sudo()
    lift = can_lift(nc)
    return {
        "id": nc.id, "check": {"id": nc.check_id.id, "reference": nc.check_id.reference},
        "item": {"id": nc.item_id.id, "label": nc.label, "blocking": nc.blocking},
        "vehicle": vehicle_ref(nc.vehicle_id), "rotation": rotation_ref(nc.rotation_id), "site": site_ref(nc.site_id),
        "found_at": nc.found_at, "comment": nc.comment or None,
        "photos": attachments_rows("nonconformity", nc, role="photo"), "photos_missing": nc._photos_missing(),
        "status": nc.status, "lifted_at": nc.lifted_at or None, "lifted_by": user_ref(nc.lifted_by),
        "lift_comment": nc.lift_comment or None, "lift_photos": attachments_rows("nonconformity", nc, role="lift"),
        "action": ref(nc.action_id), "rights": {"can_edit": False, "can_close": lift, "can_approve": False},
    }


def check_line(check):
    check = check.sudo()
    return {
        "id": check.id, "reference": check.reference,
        "template": {"id": check.template_id.id, "name": check.template_id.name, "version": check.template_version},
        "kind": check.kind, "vehicle_kind": check.vehicle_kind, "vehicle": vehicle_ref(check.vehicle_id),
        "rotation": rotation_ref(check.rotation_id), "driver": driver_ref(check.driver_id), "site": site_ref(check.site_id),
        "author": user_ref(check.author_id), "reported_at": check.reported_at, "result": check.result,
        "open_nonconformities": len(check.nonconformity_ids.filtered(lambda n: n.status == "open")),
        "photos_missing": check._photos_missing(),
    }


def check_detail(check):
    check = check.sudo()
    by_answer = {nc.answer_id.id: nc for nc in check.nonconformity_ids}
    row = check_line(check)
    signature = request.env["eguitra.hsseq.attachment"]._for("check", check, role="signature")[:1]
    row.update({
        "client_uuid": check.client_uuid or None, "synced_at": check.synced_at, "offline": check.offline,
        "duration_s": check.duration_s or None, **gps_fields(check),
        "answers": [{"item_id": a.item_id.id, "label": a.label, "blocking": a.blocking, "sequence": a.sequence,
                     "answer": a.answer, "comment": a.comment or None,
                     "nonconformity_id": by_answer[a.id].id if a.id in by_answer else None,
                     "photos": attachments_rows("nonconformity", by_answer[a.id]) if a.id in by_answer else []}
                    for a in check.answer_ids],
        "signature": signature._row() if signature else None,
        "nonconformities": [nc_row(nc) for nc in check.nonconformity_ids],
        "attachments": attachments_rows("check", check),
        "history": [] if is_self_only() else history("check", check),
        "transitions": ["lift"] if any(can_lift(nc) for nc in check.nonconformity_ids) else [],
        "rights": {"can_edit": is_hsseq(),
                   "can_close": any(can_lift(nc) for nc in check.nonconformity_ids),
                   "can_approve": False},
    })
    return row


def get_check(check_id):
    check = get("eguitra.hsseq.check", check_id, "Contrôle")
    if not can_read(check):
        raise ApiError(404, "not_found", "Contrôle introuvable.")
    return check


def store_signature(check, value):
    """Signature du contrôle : image PNG ou JPEG en base64 (« data:image/png;base64,… » accepté)."""
    if not value:
        return
    raw = str(value).split(",", 1)[1] if str(value).startswith("data:") else str(value)
    try:
        content = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as e:
        raise ApiError(400, "invalid_parameter", "Signature illisible.", fields=["signature"]) from e
    mimetype = detect_type(content)
    if len(content) > MAX_SIGNATURE or mimetype not in ("image/png", "image/jpeg"):
        raise ApiError(415, "unsupported_type", "Signature : image PNG ou JPEG de 512 Ko au plus.", fields=["signature"])
    attachment = request.env["ir.attachment"].sudo().create({
        "name": checked_name("signature", mimetype), "datas": base64.b64encode(content), "mimetype": mimetype,
        "res_model": check._name, "res_id": check.id})
    request.env["eguitra.hsseq.attachment"].sudo().create({
        "name": attachment.name, "attachment_id": attachment.id, "object": "check", "res_id": check.id,
        "role": "signature", "company_id": check.company_id.id})


class EguitraHsseqChecks(http.Controller):
    # ─── Grilles ──────────────────────────────────────────────────────────

    @hsseq_route("/hsseq/checks/templates", profiles=TEMPLATE_READ)
    def templates(self, **kw):
        domain = []
        if kw.get("vehicle_kind"):
            domain.append(("vehicle_kind", "=", kw["vehicle_kind"]))
        if kw.get("kind"):
            domain.append(("kind", "=", kw["kind"]))
        Template = request.env["eguitra.hsseq.check.template"].sudo()
        active = str(kw.get("active", "1")).lower()
        if active in ("all", ""):
            Template = Template.with_context(active_test=False)
        elif active in ("0", "false"):
            Template = Template.with_context(active_test=False)
            domain.append(("active", "=", False))
        config = bool(profiles() & set(CONFIG))
        return [template_row(t, all_items=config) for t in Template.search(domain)]

    @hsseq_route("/hsseq/checks/templates", methods=("POST",), profiles=CONFIG)
    def create_template(self, **_kw):
        data = read_json()
        require(data, "name", "vehicle_kind")
        Template = request.env["eguitra.hsseq.check.template"].sudo().with_context(hsseq_no_bump=True)
        template = Template.create(_template_values(data))
        for item in data.get("items") or []:
            request.env["eguitra.hsseq.check.item"].sudo().with_context(hsseq_no_bump=True).create(
                dict(_item_values(item), template_id=template.id))
        return template_row(template, all_items=True)

    @hsseq_route("/hsseq/checks/templates/<int:template_id>", methods=("PATCH",), profiles=CONFIG)
    def update_template(self, template_id, **_kw):
        """Grille et points en une seule version : points cités par id mis à jour, nouveaux créés, absents
        retirés (archivés s'ils ont déjà été répondus)."""
        data = read_json()
        template = request.env["eguitra.hsseq.check.template"].sudo().with_context(active_test=False).browse(
            template_id).exists()
        if not template:
            raise ApiError(404, "not_found", "Grille introuvable.")
        quiet = template.with_context(hsseq_no_bump=True)
        quiet.write(_template_values(data))
        if "items" in data:
            # Une seule version pour toute la modification : les points ajoutés y entrent, les points retirés en
            # sortent. Un point retiré s'archive, jamais supprimé : un appareil hors ligne peut encore le répondre
            # sur sa version de la grille.
            following = template.version + 1
            Item = request.env["eguitra.hsseq.check.item"].sudo().with_context(hsseq_no_bump=True, active_test=False)
            existing = {i.id: i for i in template._items(active_only=False)}
            kept = set()
            for item in data["items"] or []:
                values = _item_values(item)
                item_id = int_or_none(item, "id") if isinstance(item, dict) else None
                if item_id:
                    if item_id not in existing:
                        raise ApiError(422, "business_rule", "Point d'une autre grille.", fields=["items"])
                    current = existing[item_id]
                    if values["active"] != current.active:
                        if values["active"]:
                            values.update(retired_version=0, since_version=following)
                        else:
                            values.update(retired_version=following)
                    current.with_context(hsseq_no_bump=True).write(values)
                    kept.add(item_id)
                else:
                    Item.create(dict(values, template_id=template.id, since_version=following))
            for item_id in [i for i in existing if i not in kept]:
                item = existing[item_id].with_context(hsseq_no_bump=True)
                if item.active:
                    item.write({"active": False, "retired_version": following})
        template._bump_version()
        return template_row(template, all_items=True)

    # ─── Contrôles ────────────────────────────────────────────────────────

    def _list_domain(self, kw):
        domain = read_domain(kw)
        start, end = date_value(kw, "date_from"), date_value(kw, "date_to")
        if start:
            domain.append(("reported_at", ">=", fields.Datetime.to_datetime(start)))
        if end:
            domain.append(("reported_at", "<", fields.Datetime.to_datetime(end) + timedelta(days=1)))
        for key in ("site_id", "vehicle_id", "rotation_id", "driver_id"):
            if kw.get(key):
                domain.append((key, "=", int_or_none(kw, key)))
        if kw.get("vehicle_kind"):
            domain.append(("vehicle_kind", "=", kw["vehicle_kind"]))
        if kw.get("result"):
            domain.append(("result", "in", kw["result"].split(",")))
        return domain, start, end

    @hsseq_route("/hsseq/checks", profiles=CHECK_READ)
    def checks(self, **kw):
        domain, start, end = self._list_domain(kw)
        offset, limit, order = page_args(kw, "-reported_at", SORTS)
        Check = request.env["eguitra.hsseq.check"].sudo()
        rows = Check.search(domain, offset=offset, limit=limit, order=order)
        counts = {"by_result": {code: Check.search_count(domain + [("result", "=", code)]) for code, _l in CHECK_RESULTS}}
        if not is_self_only():
            counts.update(self._departures(kw, start, end))
        return page([check_line(c) for c in rows], Check.search_count(domain), offset, limit, counts)

    def _departures(self, kw, start, end):
        """Départs de la période (rotations parties, validées ou facturées) et ceux qui ont été contrôlés."""
        day = fields.Date.context_today(request.env.user)
        start, end = start or day.replace(day=1), end or day
        Rotation = request.env["eguitra.transport.rotation"].sudo()
        states = [s for s in ("en_route", "done", "invoiced") if s in dict(Rotation._fields["state"].selection)]
        domain = [("company_id", "in", companies(kw).ids), ("state", "in", states), ("date_loading", ">=", start),
                  ("date_loading", "<=", end)]
        sites = my_sites() if is_yard() else None
        if kw.get("site_id"):
            domain.append(("vehicle_id.site_id", "=", int_or_none(kw, "site_id")))
        elif sites:
            domain.append(("vehicle_id.site_id", "in", sites.ids))
        rotations = Rotation.search(domain)
        checked = request.env["eguitra.hsseq.check"].sudo().search(
            [("rotation_id", "in", rotations.ids), ("kind", "=", "pre_departure")]).rotation_id
        return {"departures": len(rotations), "departures_checked": len(checked)}

    @hsseq_route("/hsseq/checks/<int:check_id>", profiles=CHECK_READ)
    def check(self, check_id, **_kw):
        return check_detail(get_check(check_id))

    @hsseq_route("/hsseq/checks", methods=("POST",), profiles=FIELD)
    def create_check(self, **_kw):
        """Contrôle saisi sur NIMOVA Terrain ou au bureau ; un client_uuid déjà reçu renvoie le contrôle
        existant. Le contrôle est accepté sans ses photos (photos_missing)."""
        data = read_json()
        require(data, "template_id", "answers")
        uuid = client_uuid(data)
        existing = existing_by_uuid("eguitra.hsseq.check", uuid)
        if existing:
            return check_detail(existing)
        template = request.env["eguitra.hsseq.check.template"].sudo().browse(int_or_none(data, "template_id") or 0).exists()
        if not template or not template.active:
            raise ApiError(422, "business_rule", "Grille inconnue ou retirée.", fields=["template_id"])
        rotation_id = int_or_none(data, "rotation_id")
        rotation = get("eguitra.transport.rotation", rotation_id, "Rotation") if rotation_id else None
        vehicle_id = int_or_none(data, "vehicle_id")
        vehicle = rotation.vehicle_id if rotation else (
            get("eguitra.transport.vehicle", vehicle_id, "Ensemble") if vehicle_id else None)
        if not vehicle:
            raise ApiError(400, "missing_fields", "Rotation ou ensemble à contrôler manquant.", fields=["vehicle_id"])
        if rotation and vehicle_id and vehicle_id != rotation.vehicle_id.id:
            raise ApiError(422, "business_rule", "L'ensemble n'est pas celui de la rotation.", fields=["vehicle_id"])
        driver_id = int_or_none(data, "driver_id")
        driver = get("eguitra.transport.driver", driver_id, "Conducteur") if driver_id else (
            rotation.driver_id if rotation else vehicle.driver_id)
        scope = scope_level()
        if scope == "self":
            mine = my_driver()
            if not mine or not self._drives(mine, vehicle, rotation):
                raise forbidden("Un conducteur ne contrôle que l'ensemble de ses propres rotations.")
            driver = mine
        elif scope == "site" and not site_allowed(vehicle.site_id):
            raise forbidden("Ensemble d'un autre site.")
        answers, photos = [], {}
        for answer in data.get("answers") or []:
            if not isinstance(answer, dict) or not answer.get("item_id"):
                raise ApiError(400, "invalid_parameter", "Réponse sans point.", fields=["answers"])
            if answer.get("answer") not in ("ok", "not_ok", "na"):
                raise ApiError(400, "invalid_parameter", "Réponse : ok, not_ok ou na.", fields=["answers"])
            item_id = int_or_none(answer, "item_id")
            answers.append({"item_id": item_id, "answer": answer["answer"], "comment": text(answer, "comment", 1000)})
            photos[item_id] = ids_list(answer, "attachment_ids")
        values = {"company_id": vehicle.company_id.id, "template_id": template.id, "vehicle_id": vehicle.id,
                  "template_version": int_or_none(data, "template_version") or template.version,
                  "rotation_id": rotation.id if rotation else False, "driver_id": driver.id or False,
                  "author_id": request.env.uid, "client_uuid": uuid, "reported_at": reported_at(data),
                  "offline": bool(data.get("offline")), "duration_s": int(number(data, "duration_s")),
                  "synced_at": fields.Datetime.now(), **gps(data)}
        check = request.env["eguitra.hsseq.check"]._hsseq_create(values, answers)
        # Photos déposées avant la fiche : rattachées à la non-conformité de leur point (au contrôle sinon).
        for nc in check.nonconformity_ids:
            claim_attachments(photos.pop(nc.item_id.id, []), "nonconformity", nc, role="photo")
        claim_attachments([i for ids in photos.values() for i in ids] + ids_list(data, "attachment_ids"), "check", check)
        store_signature(check, data.get("signature"))
        return check_detail(check)

    @staticmethod
    def _drives(driver, vehicle, rotation):
        """Le conducteur conduit-il cet ensemble : sa rotation, ou l'ensemble dont il est le chauffeur habituel
        ou celui d'une de ses rotations pas encore terminées ?"""
        if rotation:
            return rotation.driver_id == driver
        if vehicle.driver_id == driver:
            return True
        return bool(request.env["eguitra.transport.rotation"].sudo().search_count([
            ("vehicle_id", "=", vehicle.id), ("driver_id", "=", driver.id), ("state", "in", ("draft", "en_route"))]))

    @hsseq_route("/hsseq/checks/<int:check_id>/lift", methods=("POST",), profiles=LIFT)
    def lift(self, check_id, **_kw):
        check = get_check(check_id)
        data = read_json()
        require(data, "nonconformity_id")
        nc = check.nonconformity_ids.filtered(lambda n: n.id == int_or_none(data, "nonconformity_id"))
        if not nc:
            raise ApiError(404, "not_found", "Non-conformité introuvable sur ce contrôle.")
        if not can_lift(nc) and nc.status == "open":
            raise forbidden("Levée réservée au chef de parc du site et au Responsable HSSEQ.")
        attachments = claim_attachments(ids_list(data, "attachment_ids"), "nonconformity", nc, role="lift")
        nc.action_lift(text(data, "comment", 2000), attachments)
        return check_detail(check)

    @hsseq_route("/hsseq/checks/nonconformities", profiles=NC_READ)
    def nonconformities(self, **kw):
        domain = [("company_id", "in", companies(kw).ids)]
        sites = my_sites() if is_yard() else None
        if sites:
            domain += ["|", ("site_id", "in", sites.ids), ("site_id", "=", False)]
        if kw.get("status"):
            domain.append(("status", "in", kw["status"].split(",")))
        if str(kw.get("blocking", "")) in ("1", "true"):
            domain.append(("blocking", "=", True))
        for key in ("site_id", "vehicle_id"):
            if kw.get(key):
                domain.append((key, "=", int_or_none(kw, key)))
        offset, limit, order = page_args(kw, "-found_at", {"found_at": "found_at"})
        NC = request.env["eguitra.hsseq.nonconformity"].sudo()
        rows = NC.search(domain, offset=offset, limit=limit, order=order)
        counts = {"open": NC.search_count(domain + [("status", "=", "open")]),
                  "blocking_open": NC.search_count(domain + [("status", "=", "open"), ("blocking", "=", True)])}
        return page([nc_row(n) for n in rows], NC.search_count(domain), offset, limit, counts)
