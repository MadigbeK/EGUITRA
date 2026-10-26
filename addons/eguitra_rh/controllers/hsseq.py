"""API RH des données utiles à NIMOVA · HSSEQ : habilitations, aptitude médicale (statut seul), EPI remis,
indicateurs de sécurité (heures travaillées, accidents du travail, taux de fréquence et de gravité).
Contrat : apps/web/lib/rh-types.ts ; spécification : docs/projet/rh/specification.md, chapitre 7."""

import base64
import io
import re
import unicodedata
from datetime import date, datetime, timedelta

from dateutil.relativedelta import relativedelta

from odoo import http
from odoo.exceptions import UserError, ValidationError
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require
from odoo.addons.eguitra_api.files import (
    ACCEPTED,
    XLSX,
    XLSX_OPTIONS,
    checked_name,
    detect_type,
    workbook_sheets,
    xlsx_row,
)

from ..models.hsseq import FITNESS, PPE_ITEMS, state_on
from .common import READ, WRITE, date_value, emp_ref, get, int_or_false, number, refuse_own, scope, text, today

MAX_FILE = 20 * 1024 * 1024
MAX_IMPORT = 5 * 1024 * 1024

# Classeur de reprise : en-têtes du modèle, puis les variantes reconnues à l'import (casse, accents et
# apostrophes ignorés).
QUALIFICATION_HEADERS = ["Matricule", "Salarié", "Société", "Code habilitation", "Habilitation", "Obtenue le",
                         "Expire le", "Référence", "Délivrée par"]
FITNESS_HEADERS = ["Matricule", "Salarié", "Société", "Aptitude", "Visite le", "Valable jusqu'au"]
QUALIFICATION_COLUMNS = {
    "matricule": "matricule", "code habilitation": "code", "code": "code", "obtenue le": "obtained",
    "obtention": "obtained", "date d obtention": "obtained", "expire le": "expiry", "expiration": "expiry",
    "date d expiration": "expiry", "reference": "reference", "numero": "reference", "numero ou reference": "reference",
    "delivree par": "issuer", "organisme": "issuer",
}
FITNESS_COLUMNS = {
    "matricule": "matricule", "aptitude": "status", "statut": "status", "visite le": "date",
    "date de la visite": "date", "valable jusqu au": "until", "validite": "until", "date de validite": "until",
}


def _plain(value):
    """Texte comparable : minuscules, sans accents, apostrophes ni espaces superflus."""
    value = str(value or "").replace("'", " ").replace("’", " ")
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return " ".join(value.lower().replace("_", " ").split())


def _cell(value):
    """Valeur d'une cellule, None si vide (un nombre entier lu en flottant redevient entier)."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value.strip() if isinstance(value, str) else value


def _cell_date(value):
    """Date d'une cellule : date du tableur, texte JJ/MM/AAAA ou AAAA-MM-JJ, ou numéro de série du tableur."""
    value = _cell(value)
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if 20000 < value < 80000:  # numéro de série d'une date du tableur (1954 à 2119)
            return date(1899, 12, 30) + timedelta(days=int(value))
        raise ValueError(value)
    raw = str(value).split(" ")[0]
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    raise ValueError(value)


def _fitness_of(value):
    v = _plain(value)
    if v.startswith("inapte"):
        return "inapte"
    if v.startswith("apte"):
        return "apte_reserve" if "reserve" in v else "apte"
    return None


def _anomalies(errors):
    return f"{len(errors)} anomalie{'s' if len(errors) > 1 else ''} : rien n'est enregistré."


def _columns(header, names):
    index = {}
    for i, label in enumerate(header):
        key = names.get(_plain(label))
        if key:
            index.setdefault(key, i)
    return index


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
    if state in ("apte", "apte_reserve") and emp.medical_fitness_until:
        if state_on(emp.medical_fitness_until, day, settings.qualification_alert_days) == "a_renouveler":
            state = "a_renouveler"
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

    def _staff(self, kw, day):
        """Salariés en poste au jour donné, les conducteurs seulement sauf drivers_only=0."""
        domain = [("company_id", "in", scope(kw).ids), ("hire_date", "<=", day),
                  "|", ("exit_date", "=", False), ("exit_date", ">=", day)]
        if str(kw.get("drivers_only", "1")).lower() not in ("0", "false"):
            domain.append(("driver_id", "!=", False))
        return request.env["eguitra.rh.employee"].search(domain)

    @api_route("/rh/qualifications/matrix", profiles=READ)
    def matrix(self, **kw):
        """Matrice des habilitations : salariés (les conducteurs seulement par défaut) × types."""
        day = today()
        Employee = request.env["eguitra.rh.employee"]
        types = request.env["eguitra.rh.qualification.type"].search([])
        rows = []
        for emp in self._staff(kw, day):
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

    # ─── Reprise par classeur ────────────────────────────────────────────

    @api_route("/rh/qualifications/template", profiles=READ)
    def qualification_template(self, **kw):
        """Classeur de reprise des habilitations et des aptitudes, rempli de ce qui est déjà connu :
        « Habilitations » (une rangée par salarié et par type, la plus récente de chaque type),
        « Aptitude » (une rangée par salarié) et une notice. Complété, il se réimporte par
        POST /rh/qualifications/import. Conducteurs seulement, sauf drivers_only=0."""
        import xlsxwriter

        day = today()
        employees = self._staff(kw, day)
        types = request.env["eguitra.rh.qualification.type"].search([])
        out = io.BytesIO()
        book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
        head = book.add_format({"bold": True, "bg_color": "#10133A", "font_color": "#FFFFFF"})
        grey = book.add_format({"font_color": "#6B7280"})
        day_format = book.add_format({"num_format": "dd/mm/yyyy"})

        def write_date(sheet, row, col, value):
            if value:
                sheet.write_datetime(row, col, datetime.combine(value, datetime.min.time()), day_format)

        sheet = book.add_worksheet("Habilitations")
        xlsx_row(sheet, 0, QUALIFICATION_HEADERS, head)
        row = 0
        for emp in employees:
            latest = {}
            for qual in emp.sudo().qualification_ids.sorted(lambda q: (q.expiry_date or date.max, q.id)):
                latest[qual.type_id.id] = qual
            for qual_type in types:
                qual = latest.get(qual_type.id)
                row += 1
                xlsx_row(sheet, row, [emp.matricule, emp.name, emp.company_id.name], grey)
                xlsx_row(sheet, row, [qual_type.code], col=3)
                xlsx_row(sheet, row, [qual_type.name], grey, col=4)
                if qual:
                    write_date(sheet, row, 5, qual.obtained_date)
                    write_date(sheet, row, 6, qual.expiry_date)
                    xlsx_row(sheet, row, [qual.reference or "", qual.issuer or ""], col=7)
        codes = [t.code for t in types]
        if codes and len(",".join(codes)) <= 255:  # limite d'une liste de validation du tableur
            sheet.data_validation(1, 3, max(row, 1), 3, {"validate": "list", "source": codes})
        sheet.freeze_panes(1, 2)
        for col, width in enumerate((11, 28, 24, 22, 30, 13, 13, 22, 24)):
            sheet.set_column(col, col, width)

        sheet = book.add_worksheet("Aptitude")
        xlsx_row(sheet, 0, FITNESS_HEADERS, head)
        labels = dict(FITNESS)
        for row, emp in enumerate(employees, start=1):
            xlsx_row(sheet, row, [emp.matricule, emp.name, emp.company_id.name], grey)
            xlsx_row(sheet, row, [labels.get(emp.medical_fitness, "")], col=3)
            write_date(sheet, row, 4, emp.medical_fitness_date)
            write_date(sheet, row, 5, emp.medical_fitness_until)
        sheet.data_validation(1, 3, max(len(employees), 1), 3, {"validate": "list", "source": list(labels.values())})
        sheet.freeze_panes(1, 2)
        for col, width in enumerate((11, 28, 24, 20, 13, 16)):
            sheet.set_column(col, col, width)

        sheet = book.add_worksheet("Notice")
        for row, line in enumerate((
            "Reprise des habilitations et des aptitudes médicales (NIMOVA · RH)",
            "",
            "Habilitations : une rangée par salarié et par habilitation. Dates au format JJ/MM/AAAA. Laissez la "
            "rangée vide si le salarié n'a pas cette habilitation.",
            "Expiration vide : calculée depuis l'obtention et la durée de validité du type.",
            "Une rangée qui reprend une habilitation déjà connue (même salarié, même type, même date d'obtention "
            "ou d'expiration) la met à jour ; sinon une nouvelle habilitation est ajoutée et l'ancienne reste dans "
            "l'historique.",
            "Aptitude : Apte, Apte avec réserve ou Inapte, avec la date de la visite et celle de validité. "
            "N'inscrivez jamais de détail médical, ni la nature d'une réserve.",
            "Seuls le matricule et le code comptent : les colonnes Salarié, Société et Habilitation sont indicatives.",
            "Rien n'est enregistré si une rangée est en erreur : corrigez les rangées signalées puis réimportez.",
            "Les justificatifs se déposent ensuite sur chaque habilitation, depuis la fiche du salarié.",
            "Personne n'importe ses propres habilitations ni sa propre aptitude : un autre membre du service RH s'en charge.",
        )):
            sheet.write_string(row, 0, line, head if row == 0 else None)
        sheet.set_column(0, 0, 120)
        book.close()
        return request.make_response(out.getvalue(), headers=[
            ("Content-Type", XLSX), ("Cache-Control", "no-store"),
            ("Content-Disposition", content_disposition(f"reprise_habilitations_{day:%Y%m%d}.xlsx")),
        ])

    @api_route("/rh/qualifications/import", methods=("POST",), profiles=WRITE)
    def import_qualifications(self, **_kw):
        """Reprise par classeur (modèle : GET /rh/qualifications/template). « Habilitations » : matricule,
        code, obtention, expiration (vide : obtention + durée du type), référence, organisme ; une
        habilitation du même salarié et du même type, à la même date d'obtention ou d'expiration, est mise à
        jour, sinon ajoutée. « Aptitude » : matricule, aptitude, visite, validité. Rien n'est enregistré si
        une rangée est en erreur ; personne n'importe ses propres données."""
        upload = request.httprequest.files.get("file")
        if not upload:
            raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
        content = upload.read(MAX_IMPORT + 1)
        if len(content) > MAX_IMPORT:
            raise ApiError(413, "too_large", "Fichier trop volumineux (5 Mo maximum).")
        sheets = workbook_sheets(content)
        qual_rows = sheets.get("habilitations")
        fit_rows = sheets.get("aptitude") or sheets.get("aptitudes")
        if not qual_rows and not fit_rows:
            raise ApiError(422, "business_rule", "Feuilles « Habilitations » et « Aptitude » attendues : "
                                                 "partez du modèle de reprise.")
        Employee = request.env["eguitra.rh.employee"]
        types = {t.code.upper(): t for t in request.env["eguitra.rh.qualification.type"].search([])}
        errors, found = [], {}

        def employee(sheet, number, value):
            matricule = str(value or "").strip().upper()
            if not matricule:
                errors.append(f"{sheet}, ligne {number} : matricule manquant.")
                return None
            if matricule not in found:
                match = Employee.search([("matricule", "=", matricule), ("company_id", "in", request.env.companies.ids)])
                found[matricule] = match if len(match) == 1 else None
            emp = found[matricule]
            if not emp:
                errors.append(f"{sheet}, ligne {number} : matricule « {matricule} » inconnu.")
            elif emp.sudo().user_id == request.env.user:
                errors.append(f"{sheet}, ligne {number} : vos propres données sont saisies par un autre membre du "
                              "service RH.")
                return None
            return emp

        def reader(rows, names):
            index = _columns(rows[0], names)
            return index, lambda row, key: _cell(row[index[key]]) if key in index and index[key] < len(row) else None

        qualifications, seen = [], set()
        if qual_rows:
            index, cell = reader(qual_rows, QUALIFICATION_COLUMNS)
            if "matricule" not in index or "code" not in index:
                raise ApiError(422, "business_rule", "Feuille « Habilitations » : colonnes Matricule et Code "
                                                     "habilitation attendues.")
            for number, row in enumerate(qual_rows[1:], start=2):
                if all(cell(row, key) is None for key in ("obtained", "expiry", "reference", "issuer")):
                    continue  # rangée du modèle laissée vide : le salarié n'a pas cette habilitation
                emp = employee("Habilitations", number, cell(row, "matricule"))
                code = str(cell(row, "code") or "").strip().upper()
                qual_type = types.get(code)
                if not qual_type:
                    errors.append(f"Habilitations, ligne {number} : code d'habilitation « {code} » inconnu."
                                  if code else f"Habilitations, ligne {number} : code d'habilitation manquant.")
                try:
                    obtained, expiry = _cell_date(cell(row, "obtained")), _cell_date(cell(row, "expiry"))
                except ValueError:
                    errors.append(f"Habilitations, ligne {number} : date illisible (attendue au format JJ/MM/AAAA).")
                    continue
                if not obtained and not expiry:
                    errors.append(f"Habilitations, ligne {number} : date d'obtention ou d'expiration manquante.")
                    continue
                if not emp or not qual_type:
                    continue
                if not expiry and qual_type.validity_months:
                    expiry = obtained + relativedelta(months=qual_type.validity_months, days=-1)
                key = (emp.id, qual_type.id, obtained, expiry)
                if key in seen:
                    errors.append(f"Habilitations, ligne {number} : rangée en double.")
                    continue
                seen.add(key)
                values = {"obtained_date": obtained or False, "expiry_date": expiry or False}
                for field, column in (("reference", "reference"), ("issuer", "issuer")):
                    if cell(row, column) is not None:
                        values[field] = " ".join(str(cell(row, column)).split())[:500]
                qualifications.append((number, emp, qual_type, values))

        fitness, seen_fitness = [], set()
        if fit_rows:
            index, cell = reader(fit_rows, FITNESS_COLUMNS)
            if "matricule" not in index or "status" not in index:
                raise ApiError(422, "business_rule", "Feuille « Aptitude » : colonnes Matricule et Aptitude attendues.")
            for number, row in enumerate(fit_rows[1:], start=2):
                if all(cell(row, key) is None for key in ("status", "date", "until")):
                    continue
                emp = employee("Aptitude", number, cell(row, "matricule"))
                status = _fitness_of(cell(row, "status"))
                if not status:
                    errors.append(f"Aptitude, ligne {number} : écrivez Apte, Apte avec réserve ou Inapte.")
                try:
                    visit, until = _cell_date(cell(row, "date")), _cell_date(cell(row, "until"))
                except ValueError:
                    errors.append(f"Aptitude, ligne {number} : date illisible (attendue au format JJ/MM/AAAA).")
                    continue
                if visit and until and until < visit:
                    errors.append(f"Aptitude, ligne {number} : la date de validité précède la visite.")
                    continue
                if emp and status:
                    if emp.id in seen_fitness:
                        errors.append(f"Aptitude, ligne {number} : salarié déjà présent plus haut.")
                        continue
                    seen_fitness.add(emp.id)
                    fitness.append((number, emp, {"medical_fitness": status, "medical_fitness_date": visit or False,
                                                  "medical_fitness_until": until or False}))
        if errors:
            raise ApiError(422, "business_rule", _anomalies(errors), errors=errors[:50])

        Qualification = request.env["eguitra.rh.qualification"]
        result = {"created": 0, "updated": 0, "fitness": 0, "unchanged": 0}
        for number, emp, qual_type, values in qualifications:
            existing = emp.qualification_ids.filtered(lambda q, t=qual_type, v=values: q.type_id == t and (
                (v["obtained_date"] and q.obtained_date == v["obtained_date"])
                or (v["expiry_date"] and q.expiry_date == v["expiry_date"])))[:1]
            changes = {k: v for k, v in values.items() if not existing or existing[k] != v}
            try:
                with request.env.cr.savepoint():
                    if not existing:
                        Qualification.create(dict(values, employee_id=emp.id, type_id=qual_type.id))
                        result["created"] += 1
                    elif changes:
                        existing.write(changes)
                        result["updated"] += 1
                    else:
                        result["unchanged"] += 1
            except (UserError, ValidationError) as e:  # contrainte d'une rangée : rattachée à sa ligne du fichier
                errors.append(f"Habilitations, ligne {number} : {e.args[0] if e.args else e}")
        for number, emp, values in fitness:
            changes = {k: v for k, v in values.items() if emp[k] != v}
            if not changes:
                result["unchanged"] += 1
                continue
            try:
                with request.env.cr.savepoint():
                    emp.write(changes)
                    result["fitness"] += 1
            except (UserError, ValidationError) as e:
                errors.append(f"Aptitude, ligne {number} : {e.args[0] if e.args else e}")
        if errors:
            raise ApiError(422, "business_rule", _anomalies(errors), errors=errors[:50])
        return result

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
