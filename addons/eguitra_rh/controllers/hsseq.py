"""API RH des données utiles à NIMOVA · HSSEQ : habilitations, aptitude médicale (statut seul), EPI remis,
indicateurs de sécurité (heures travaillées, accidents du travail, taux de fréquence et de gravité).
Contrat : apps/web/lib/rh-types.ts ; spécification : docs/projet/rh/specification.md, chapitre 7."""

import base64
import re
from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo import http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require
from odoo.addons.eguitra_api.files import ACCEPTED, checked_name, detect_type

from ..models.hsseq import PPE_ITEMS, state_on
from .common import READ, WRITE, date_value, emp_ref, get, int_or_false, number, refuse_own, scope, text, today

MAX_FILE = 20 * 1024 * 1024


def qualification_type_row(t):
    return {"id": t.id, "code": t.code, "name": t.name, "validity_months": t.validity_months,
            "mandatory_for_drivers": t.mandatory_for_drivers, "needs_document": t.needs_document, "active": t.active}


def qualification_row(q, day=None):
    day = day or today()
    return {"id": q.id, "employee": emp_ref(q.employee_id), "type": {"id": q.type_id.id, "code": q.type_id.code,
                                                                     "name": q.type_id.name},
            "obtained_date": q.obtained_date or None, "expiry_date": q.expiry_date or None,
            "reference": q.reference or None, "issuer": q.issuer or None, "note": q.note or None,
            "has_file": bool(q.attachment_id), "state": q._state(day)}


def ppe_row(p):
    return {"id": p.id, "employee": emp_ref(p.employee_id), "item": p.item, "description": p.description or None,
            "size": p.size or None, "quantity": p.quantity, "date": p.date, "renewal_date": p.renewal_date or None,
            "acknowledged": p.acknowledged, "note": p.note or None}


def fitness_row(emp, day=None):
    day = day or today()
    settings = request.env["eguitra.rh.settings"]._get(emp.company_id)
    state = emp._fitness_state(day)
    if state == "apte" and emp.medical_fitness_until:
        state = "a_renouveler" if state_on(emp.medical_fitness_until, day, settings.qualification_alert_days) == "a_renouveler" else "apte"
    return {"status": emp.medical_fitness or None, "state": state, "date": emp.medical_fitness_date or None,
            "until": emp.medical_fitness_until or None}


class EguitraRhHsseq(http.Controller):
    # ─── Référentiel des habilitations ───────────────────────────────────

    def _type_values(self, data):
        values = {k: text(data, k) for k in ("code", "name") if k in data}
        if values.get("code"):
            values["code"] = values["code"].upper().replace(" ", "_")[:30]
        for key in ("mandatory_for_drivers", "needs_document", "active"):
            if key in data:
                values[key] = bool(data[key])
        if "validity_months" in data:
            values["validity_months"] = max(int(number(data, "validity_months")), 0)
        return values

    @api_route("/rh/qualification-types", profiles=READ)
    def qualification_types(self, **_kw):
        Type = request.env["eguitra.rh.qualification.type"].with_context(active_test=False)
        return [qualification_type_row(t) for t in Type.search([])]

    @api_route("/rh/qualification-types", methods=("POST",), profiles=WRITE)
    def create_qualification_type(self, **_kw):
        data = read_json()
        require(data, "code", "name")
        return qualification_type_row(request.env["eguitra.rh.qualification.type"].create(self._type_values(data)))

    @api_route("/rh/qualification-types/<int:type_id>", methods=("PATCH",), profiles=WRITE)
    def update_qualification_type(self, type_id, **_kw):
        record = request.env["eguitra.rh.qualification.type"].with_context(active_test=False).browse(type_id).exists()
        if not record:
            raise ApiError(404, "not_found", "Type d'habilitation introuvable.")
        record.write(self._type_values(read_json()))
        return qualification_type_row(record)

    # ─── Habilitations ───────────────────────────────────────────────────

    @api_route("/rh/qualifications/matrix", profiles=READ)
    def matrix(self, **kw):
        """Matrice des habilitations : salariés (les conducteurs seulement par défaut) × types."""
        day = today()
        domain = [("company_id", "in", scope(kw).ids), ("hire_date", "<=", day),
                  "|", ("exit_date", "=", False), ("exit_date", ">=", day)]
        if str(kw.get("drivers_only", "1")).lower() not in ("0", "false"):
            domain.append(("driver_id", "!=", False))
        Employee = request.env["eguitra.rh.employee"]
        types = request.env["eguitra.rh.qualification.type"].search([])
        rows = []
        for emp in Employee.search(domain):
            cells = {r["code"]: {"state": r["state"], "expiry": r["expiry"], "id": r["qualification_id"]}
                     for r in emp._qualification_rows(day)}
            driver = emp.sudo().driver_id
            # Même règle que le verrou de départ d'HSSEQ (motif V04), pour un conducteur seulement.
            status = Employee._hsseq_driver_status(driver, day) if driver else None
            rows.append({"employee": dict(emp_ref(emp), company_id=emp.company_id.id),
                         "driver": {"id": driver.id, "name": driver.name} if driver else None,
                         "fitness": fitness_row(emp, day), "cells": cells,
                         "blocking": bool(status and status["blocking"]),
                         "reasons": status["reasons"] if status else []})
        return {"types": [qualification_type_row(t) for t in types], "rows": rows}

    def _qualification_values(self, data, creating=False):
        values = {k: text(data, k) for k in ("reference", "issuer", "note") if k in data}
        for key in ("obtained_date", "expiry_date"):
            if key in data:
                values[key] = date_value(data, key)
        if creating:
            qual_type = request.env["eguitra.rh.qualification.type"].browse(int_or_false(data, "type_id")).exists()
            if not qual_type:
                raise ApiError(422, "business_rule", "Type d'habilitation inconnu.")
            values["type_id"] = qual_type.id
            if not values.get("expiry_date") and qual_type.validity_months and values.get("obtained_date"):
                values["expiry_date"] = values["obtained_date"] + relativedelta(months=qual_type.validity_months,
                                                                               days=-1)
        return values

    @api_route("/rh/qualifications", profiles=READ)
    def qualifications(self, **kw):
        domain = [("company_id", "in", scope(kw).ids)]
        if kw.get("employee_id"):
            domain.append(("employee_id", "=", int_or_false(kw, "employee_id")))
        day = today()
        return [qualification_row(q, day) for q in request.env["eguitra.rh.qualification"].search(domain)]

    @api_route("/rh/qualifications", methods=("POST",), profiles=WRITE)
    def create_qualification(self, **_kw):
        data = read_json()
        require(data, "employee_id", "type_id")
        emp = get("eguitra.rh.employee", int_or_false(data, "employee_id"), "Salarié")
        refuse_own(emp)
        values = self._qualification_values(data, creating=True)
        return qualification_row(request.env["eguitra.rh.qualification"].create(dict(values, employee_id=emp.id)))

    @api_route("/rh/qualifications/<int:qualification_id>", methods=("PATCH",), profiles=WRITE)
    def update_qualification(self, qualification_id, **_kw):
        qual = get("eguitra.rh.qualification", qualification_id, "Habilitation")
        refuse_own(qual.employee_id)
        qual.write(self._qualification_values(read_json()))
        return qualification_row(qual)

    @api_route("/rh/qualifications/<int:qualification_id>", methods=("DELETE",), profiles=WRITE)
    def delete_qualification(self, qualification_id, **_kw):
        qual = get("eguitra.rh.qualification", qualification_id, "Habilitation")
        refuse_own(qual.employee_id)
        attachment = qual.attachment_id.sudo()
        qual.unlink()
        attachment.unlink()
        return {"status": "ok"}

    @api_route("/rh/qualifications/<int:qualification_id>/file", methods=("POST",), profiles=WRITE)
    def upload_qualification_file(self, qualification_id, **_kw):
        qual = get("eguitra.rh.qualification", qualification_id, "Habilitation")
        refuse_own(qual.employee_id)
        upload = request.httprequest.files.get("file")
        if not upload or not upload.filename:
            raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
        content = upload.read(MAX_FILE + 1)
        if len(content) > MAX_FILE:
            raise ApiError(413, "too_large", "Fichier trop volumineux (20 Mo maximum).")
        mimetype = detect_type(content)
        if not mimetype:
            raise ApiError(415, "unsupported_type", f"Formats acceptés : {ACCEPTED}.")
        old = qual.attachment_id.sudo()
        name = " ".join(re.sub(r"[\x00-\x1f\x7f]", " ", upload.filename).split())[:200]
        qual.attachment_id = request.env["ir.attachment"].sudo().create({
            "name": checked_name(name, mimetype), "datas": base64.b64encode(content), "mimetype": mimetype,
            "res_model": "eguitra.rh.qualification", "res_id": qual.id,
        }).id
        old.unlink()
        return qualification_row(qual)

    @api_route("/rh/qualifications/<int:qualification_id>/file", profiles=READ)
    def qualification_file(self, qualification_id, **_kw):
        qual = get("eguitra.rh.qualification", qualification_id, "Habilitation")
        att = qual.attachment_id.sudo()
        if not att:
            raise ApiError(404, "not_found", "Aucun justificatif pour cette habilitation.")
        return request.make_response(att.raw or b"", headers=[
            ("Content-Type", att.mimetype or "application/octet-stream"),
            ("Content-Disposition", content_disposition(att.name or "justificatif")),
            ("X-Content-Type-Options", "nosniff"),
        ])

    # ─── EPI remis ───────────────────────────────────────────────────────

    @api_route("/rh/ppe", profiles=READ)
    def ppe(self, **kw):
        domain = [("company_id", "in", scope(kw).ids)]
        if kw.get("employee_id"):
            domain.append(("employee_id", "=", int_or_false(kw, "employee_id")))
        return [ppe_row(p) for p in request.env["eguitra.rh.ppe.issue"].search(domain, limit=1000)]

    @api_route("/rh/ppe", methods=("POST",), profiles=WRITE)
    def create_ppe(self, **_kw):
        data = read_json()
        require(data, "employee_id", "item")
        emp = get("eguitra.rh.employee", int_or_false(data, "employee_id"), "Salarié")
        refuse_own(emp)
        if data["item"] not in dict(PPE_ITEMS):
            raise ApiError(400, "invalid_parameter", "Équipement inconnu.")
        record = request.env["eguitra.rh.ppe.issue"].create({
            "employee_id": emp.id, "item": data["item"], "description": text(data, "description"),
            "size": text(data, "size"), "quantity": int(number(data, "quantity", 1)),
            "date": date_value(data, "date") or today(), "renewal_date": date_value(data, "renewal_date"),
            "acknowledged": bool(data.get("acknowledged")), "note": text(data, "note"),
        })
        return ppe_row(record)

    @api_route("/rh/ppe/<int:ppe_id>", methods=("DELETE",), profiles=WRITE)
    def delete_ppe(self, ppe_id, **_kw):
        record = get("eguitra.rh.ppe.issue", ppe_id, "Remise d'EPI")
        refuse_own(record.employee_id)
        record.unlink()
        return {"status": "ok"}

    # ─── Indicateurs de sécurité ─────────────────────────────────────────

    @api_route("/rh/safety", profiles=READ)
    def safety(self, **kw):
        """Taux de fréquence et de gravité sur 12 mois glissants (ou la période demandée), échéances des
        habilitations et des aptitudes dans les 30 jours."""
        day = today()
        companies = scope(kw)
        date_to = date_value(kw, "date_to") or day
        date_from = date_value(kw, "date_from") or date_to - relativedelta(years=1) + timedelta(days=1)
        Employee = request.env["eguitra.rh.employee"]
        indicators = Employee._hsseq_indicators(companies, date_from, date_to)
        settings = request.env["eguitra.rh.settings"]._get(request.env.company)
        expiring = Employee._hsseq_expiring(companies, settings.qualification_alert_days, day)
        names = {e.id: e for e in Employee.sudo().browse({r["employee_id"] for r in expiring})}
        drivers = Employee.search([("company_id", "in", companies.ids), ("driver_id", "!=", False), ("hire_date", "<=", day),
                                   "|", ("exit_date", "=", False), ("exit_date", ">=", day)])
        blocked = [e for e in drivers if Employee._hsseq_driver_status(e.sudo().driver_id, day)["blocking"]]
        return dict(
            indicators, date_from=date_from, date_to=date_to,
            drivers=len(drivers), drivers_up_to_date=len(drivers) - len(blocked),
            up_to_date_rate=round((len(drivers) - len(blocked)) / len(drivers) * 100, 1) if drivers else None,
            expiring=[dict(r, employee=emp_ref(names[r["employee_id"]])) for r in expiring],
        )
