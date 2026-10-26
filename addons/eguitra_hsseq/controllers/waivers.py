"""API des dérogations au verrou de départ (contrat §10) : demande par un chef de parc (qui vaut première
validation), seconde validation ou refus par un compte hsseq d'une autre personne, annulation par le
demandeur ou hsseq. Jamais sur V01 ni V03."""

from datetime import timedelta

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, read_json, require

from ..models.common import WAIVER_STATUSES
from .common import (
    attachments_rows,
    companies,
    date_value,
    forbidden,
    get,
    history,
    hsseq_route,
    int_or_none,
    is_hsseq,
    page,
    page_args,
    rotation_ref,
    scope_level,
    site_allowed,
    site_ref,
    user_ref,
    vehicle_ref,
    yard_domain,
)

READ = ("admin", "direction", "hsseq", "exploitation", "auditeur")
REQUEST = ("exploitation",)
DECIDE = ("hsseq",)
CANCEL = ("exploitation", "hsseq")
SORTS = {"requested_at": "requested_at", "status": "status", "reference": "reference"}


def is_requester(waiver):
    return waiver.sudo().requested_by == request.env.user


def can_read(waiver):
    scope = scope_level()
    if scope == "all":
        return True
    return scope == "site" and (is_requester(waiver) or site_allowed(waiver.site_id))


def user_transitions(waiver):
    result = []
    for transition in waiver._transitions():
        if transition in ("approve", "refuse") and is_hsseq() and not is_requester(waiver):
            result.append(transition)
        elif transition == "cancel" and (is_hsseq() or is_requester(waiver)):
            result.append(transition)
    return result


def waiver_row(waiver):
    waiver = waiver.sudo()
    transitions = user_transitions(waiver)
    reason = request.env["eguitra.hsseq.lock.reason"]._settings_map().get(waiver.reason_code)
    return {
        "id": waiver.id, "reference": waiver.reference, "rotation": rotation_ref(waiver.rotation_id),
        "vehicle": vehicle_ref(waiver.vehicle_id), "site": site_ref(waiver.site_id), "reason_code": waiver.reason_code,
        "reason_label": reason.name if reason else waiver.reason_code, "justification": waiver.justification,
        "requested_by": user_ref(waiver.requested_by), "requested_at": waiver.requested_at,
        "approvals": [{"level": a["level"], "role": a["role"], "by": user_ref(a["by"]), "at": a["at"]}
                      for a in waiver._approvals()],
        "status": waiver.status, "expires": waiver.expires or None, "expired_at": waiver.expired_at or None,
        "refusal_reason": waiver.refusal_reason or None, "decided_by": user_ref(waiver.decided_by),
        "management_notified_at": waiver.management_notified_at or None,
        "attachments": attachments_rows("waiver", waiver),
        "history": history("waiver", waiver),
        "transitions": transitions,
        "rights": {"can_edit": is_requester(waiver) and waiver.status == "pending_hsseq",
                   "can_close": "cancel" in transitions,
                   "can_approve": "approve" in transitions},
    }


def get_waiver(waiver_id):
    waiver = get("eguitra.hsseq.waiver", waiver_id, "Dérogation")
    if not can_read(waiver):
        raise ApiError(404, "not_found", "Dérogation introuvable.")
    return waiver._refresh()


class EguitraHsseqWaivers(http.Controller):
    @hsseq_route("/hsseq/waivers", profiles=READ)
    def waivers(self, **kw):
        domain = [("company_id", "in", companies(kw).ids)]
        if scope_level() == "site":
            scoped = yard_domain()
            if scoped is not None:
                domain += ["|", ("requested_by", "=", request.env.uid)] + scoped
        if kw.get("status"):
            domain.append(("status", "in", kw["status"].split(",")))
        for key in ("rotation_id", "site_id"):
            if kw.get(key):
                domain.append((key, "=", int_or_none(kw, key)))
        if kw.get("reason_code"):
            domain.append(("reason_code", "=", kw["reason_code"]))
        start, end = date_value(kw, "date_from"), date_value(kw, "date_to")
        if start:
            domain.append(("requested_at", ">=", fields.Datetime.to_datetime(start)))
        if end:
            domain.append(("requested_at", "<", fields.Datetime.to_datetime(end) + timedelta(days=1)))
        Waiver = request.env["eguitra.hsseq.waiver"].sudo()
        Waiver.search(domain + [("status", "in", ("pending_hsseq", "active"))])._refresh()
        offset, limit, order = page_args(kw, "-requested_at", SORTS)
        rows = Waiver.search(domain, offset=offset, limit=limit, order=order)
        counts = {"by_status": {code: Waiver.search_count(domain + [("status", "=", code)]) for code, _l in WAIVER_STATUSES}}
        return page([waiver_row(w) for w in rows], Waiver.search_count(domain), offset, limit, counts)

    @hsseq_route("/hsseq/waivers/<int:waiver_id>", profiles=READ)
    def waiver(self, waiver_id, **_kw):
        return waiver_row(get_waiver(waiver_id))

    @hsseq_route("/hsseq/waivers", methods=("POST",), profiles=REQUEST)
    def request_waiver(self, **_kw):
        """Demande d'un chef de parc du site de la rotation ; elle vaut première validation."""
        data = read_json()
        require(data, "rotation_id", "reason_code")
        rotation = get("eguitra.transport.rotation", data["rotation_id"], "Rotation")
        if not site_allowed(rotation.vehicle_id.site_id):
            raise forbidden("Rotation d'un autre site.")
        waiver = request.env["eguitra.hsseq.waiver"]._hsseq_request(rotation, str(data["reason_code"]).upper(),
                                                                    data.get("justification"))
        return waiver_row(waiver)

    @hsseq_route("/hsseq/waivers/<int:waiver_id>/approve", methods=("POST",), profiles=DECIDE)
    def approve(self, waiver_id, **_kw):
        waiver = get_waiver(waiver_id)
        waiver.action_approve()
        return waiver_row(waiver)

    @hsseq_route("/hsseq/waivers/<int:waiver_id>/refuse", methods=("POST",), profiles=DECIDE)
    def refuse(self, waiver_id, **_kw):
        waiver = get_waiver(waiver_id)
        waiver.action_refuse(read_json().get("reason"))
        return waiver_row(waiver)

    @hsseq_route("/hsseq/waivers/<int:waiver_id>/cancel", methods=("POST",), profiles=CANCEL)
    def cancel(self, waiver_id, **_kw):
        waiver = get_waiver(waiver_id)
        if not (is_hsseq() or is_requester(waiver)):
            raise forbidden("Seuls le demandeur et le Responsable HSSEQ annulent une dérogation.")
        waiver.action_cancel()
        return waiver_row(waiver)
