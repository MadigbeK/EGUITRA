"""API de la télématique (OBC, GPS, IVMS), en attendant l'interface du fournisseur : import générique des
violations de conduite depuis un fichier CSV ou Excel, contrôlé par eguitra_api/files.py (format reconnu au
contenu, classeur borné en taille et en lignes, macros jamais exécutées), puis lecture des violations.

Import : profil hsseq, tout ou rien (une ligne en erreur refuse le fichier, avec la liste des lignes en
cause) ; dry_run=1 contrôle le fichier sans rien enregistrer. Lecture des violations : administration,
direction, hsseq ; chef de parc et auditeur pour les véhicules de leurs sites (portée fermée par défaut),
sans le nom du chauffeur pour l'auditeur. Historique des imports : administration, direction, hsseq."""

import csv
import io
from datetime import datetime, time, timedelta

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, json_response
from odoo.addons.eguitra_api.files import MAX_ROWS, XLSX, detect_type, workbook_rows

from ..models.common import VIOLATION_TYPES, departed_states
from .common import (
    HSSEQ,
    companies,
    date_value,
    driver_ref,
    hsseq_route,
    int_or_none,
    page,
    page_args,
    rotation_ref,
    scope_domain,
    site_ref,
    user_ref,
    vehicle_ref,
)

VIOLATION_READ = ("admin", "direction", "hsseq", "exploitation", "auditeur")
IMPORT_READ = ("admin", "direction", "hsseq")
MAX_IMPORT = 5 * 1024 * 1024
MAX_REPORTED = 200
SORTS = {"occurred_at": "occurred_at", "violation_type": "violation_type"}


def read_rows(upload):
    """Lignes d'un fichier CSV (texte UTF-8 ou Latin-1, séparateur ; , ou tabulation) ou d'un classeur Excel
    (.xlsx), au plus MAX_ROWS ; tout autre format est refusé."""
    content = upload.read(MAX_IMPORT + 1)
    if len(content) > MAX_IMPORT:
        raise ApiError(413, "too_large", "Fichier trop volumineux (5 Mo au plus).")
    mimetype = detect_type(content)
    if mimetype == XLSX:
        return workbook_rows(content)
    if mimetype is not None or content.startswith(b"PK") or b"\x00" in content:
        raise ApiError(415, "unsupported_type", "Formats acceptés : CSV ou Excel (.xlsx), sans macro.")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    sample = text[:4096]
    try:
        delimiter = csv.Sniffer().sniff(sample, delimiters=";,\t").delimiter if sample.strip() else ","
    except csv.Error:
        delimiter = max((";", ",", "\t"), key=sample.count)
    rows = []
    for row in csv.reader(io.StringIO(text), delimiter=delimiter):
        if len(rows) > MAX_ROWS:
            raise ApiError(422, "business_rule", f"Fichier trop long : {MAX_ROWS} lignes au plus.")
        rows.append(row)
    return rows


def violation_row(violation):
    violation = violation.sudo()
    return {"id": violation.id, "occurred_at": violation.occurred_at, "violation_type": violation.violation_type,
            "vehicle": vehicle_ref(violation.vehicle_id), "site": site_ref(violation.site_id),
            "driver": driver_ref(violation.driver_id), "rotation": rotation_ref(violation.rotation_id),
            "source": violation.source, "value": violation.value or None, "limit_value": violation.limit_value or None,
            "duration_minutes": violation.duration_minutes or None, "location": violation.location or None,
            "external_id": violation.external_id or None,
            "import": {"id": violation.import_id.id, "name": violation.import_id.name} if violation.import_id else None}


def import_row(batch):
    batch = batch.sudo()
    return {"id": batch.id, "name": batch.name, "company": {"id": batch.company_id.id, "name": batch.company_id.name},
            "state": batch.state, "source": batch.source or None, "imported_by": user_ref(batch.imported_by),
            "imported_at": batch.imported_at, "rows": batch.row_count, "created": batch.created_count,
            "duplicates": batch.duplicate_count, "warnings": batch.warnings or [], "errors": batch.errors or [],
            "error_count": batch.error_count}


def preview_row(values):
    """Violation à créer, au format de violation_row (aperçu à blanc)."""
    env = request.env
    vehicle = env["eguitra.transport.vehicle"].sudo().browse(values["vehicle_id"])
    return {"id": None, "occurred_at": values["occurred_at"], "violation_type": values["violation_type"],
            "vehicle": vehicle_ref(vehicle), "site": site_ref(vehicle.site_id),
            "driver": driver_ref(env["eguitra.transport.driver"].sudo().browse(values["driver_id"] or [])),
            "rotation": rotation_ref(env["eguitra.transport.rotation"].sudo().browse(values["rotation_id"] or [])),
            "source": values["source"], "value": values["value"] or None, "limit_value": values["limit_value"] or None,
            "duration_minutes": values["duration_minutes"] or None, "location": values["location"] or None,
            "external_id": values["external_id"] or None, "import": None}


def trip_domain(kw, start, end):
    """Rotations parties de la période, aux filtres de la liste (société, portée par site, site, ensemble,
    chauffeur)."""
    domain = [("company_id", "in", companies(kw).ids), ("state", "in", departed_states(request.env)),
              ("date_loading", ">=", start), ("date_loading", "<=", end)] + scope_domain("vehicle_id.site_id")
    if kw.get("site_id"):
        domain.append(("vehicle_id.site_id", "=", int_or_none(kw, "site_id")))
    for key in ("vehicle_id", "driver_id"):
        if kw.get(key):
            domain.append((key, "=", int_or_none(kw, key)))
    return domain


class EguitraHsseqTelematics(http.Controller):
    @hsseq_route("/hsseq/telematics/import", methods=("POST",), profiles=HSSEQ)
    def import_violations(self, **_kw):
        """Fichier (champ « file ») ; « source » si le fichier n'a pas de colonne source ; « dry_run » pour un
        contrôle sans enregistrement."""
        upload = request.httprequest.files.get("file")
        if not upload or not upload.filename:
            raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
        form = request.httprequest.form
        source = (form.get("source") or "").strip()[:64]
        dry_run = str(form.get("dry_run", "")).lower() in ("1", "true")
        rows = read_rows(upload)
        Violation = request.env["eguitra.hsseq.telematics.violation"].sudo()
        values, errors, warnings, duplicates = Violation._parse(rows, request.env.companies, source)
        lines = sum(1 for row in rows[1:] if any(c not in (None, "") for c in row))
        if errors:
            message = f"Import refusé, aucune violation enregistrée : {len(errors)} ligne(s) en erreur."
            if dry_run:
                raise ApiError(422, "import_rejected", message, errors=errors[:MAX_REPORTED])
            # Trace de l'import refusé (sans annulation de la transaction : rien d'autre n'a été écrit).
            batch = request.env["eguitra.hsseq.telematics.import"].sudo().create({
                "name": (upload.filename or "import")[:200], "company_id": request.env.company.id,
                "source": source or False, "imported_by": request.env.uid, "row_count": lines, "state": "rejected",
                "errors": errors[:MAX_REPORTED], "error_count": len(errors), "warnings": warnings[:MAX_REPORTED]})
            request.env["eguitra.hsseq.journal"]._log("telematics_import", batch, "rejected",
                                                      note=f"{len(errors)} ligne(s) en erreur")
            return json_response({"error": "import_rejected", "message": message, "errors": errors[:MAX_REPORTED],
                                  "import_id": batch.id}, 422)
        if dry_run:
            return {"dry_run": True, "rows": lines, "to_create": len(values), "duplicates": duplicates,
                    "warnings": warnings[:MAX_REPORTED], "preview": [preview_row(v) for v in values[:50]]}
        batch = request.env["eguitra.hsseq.telematics.import"].sudo().create({
            "name": (upload.filename or "import")[:200], "company_id": request.env.company.id, "source": source or False,
            "imported_by": request.env.uid, "row_count": lines, "created_count": len(values),
            "duplicate_count": duplicates, "warnings": warnings[:MAX_REPORTED]})
        if values:
            Violation.create([dict(v, import_id=batch.id) for v in values])
        request.env["eguitra.hsseq.journal"]._log("telematics_import", batch, "import",
                                                  note=f"{len(values)} violation(s), {duplicates} doublon(s)")
        return dict(import_row(batch), dry_run=False)

    @hsseq_route("/hsseq/telematics/imports", profiles=IMPORT_READ)
    def imports(self, **kw):
        domain = [("company_id", "in", companies(kw).ids)]
        if kw.get("state"):
            domain.append(("state", "in", kw["state"].split(",")))
        offset, limit, order = page_args(kw, "-imported_at", {"imported_at": "imported_at"})
        Import = request.env["eguitra.hsseq.telematics.import"].sudo()
        return page([import_row(b) for b in Import.search(domain, offset=offset, limit=limit, order=order)],
                    Import.search_count(domain), offset, limit)

    @hsseq_route("/hsseq/telematics/violations", profiles=VIOLATION_READ)
    def violations(self, **kw):
        domain = [("company_id", "in", companies(kw).ids)] + scope_domain()
        if kw.get("violation_type"):
            domain.append(("violation_type", "in", kw["violation_type"].split(",")))
        for key in ("vehicle_id", "site_id", "import_id", "rotation_id", "driver_id"):
            if kw.get(key):
                domain.append((key, "=", int_or_none(kw, key)))
        start = date_value(kw, "date_from") or fields.Date.context_today(request.env.user).replace(day=1)
        end = date_value(kw, "date_to") or fields.Date.context_today(request.env.user)
        if kw.get("date_from"):
            domain.append(("occurred_at", ">=", start))
        if kw.get("date_to"):
            domain.append(("occurred_at", "<", end + timedelta(days=1)))
        offset, limit, order = page_args(kw, "-occurred_at", SORTS)
        Violation = request.env["eguitra.hsseq.telematics.violation"].sudo()
        # Voyages (rotations parties) de la période et des mêmes filtres, pour le ratio par 100 voyages.
        trips = trip_domain(kw, start, end)
        departures = request.env["eguitra.transport.rotation"].sudo().search_count(trips)
        in_period = Violation.search_count(domain + [("occurred_at", ">=", datetime.combine(start, time.min)),
                                                     ("occurred_at", "<=", datetime.combine(end, time.max))])
        counts = {"by_type": {code: Violation.search_count(domain + [("violation_type", "=", code)])
                              for code, _l in VIOLATION_TYPES},
                  "period": {"date_from": start, "date_to": end}, "departures": departures,
                  "violations_in_period": in_period,
                  "per_100_trips": round(in_period * 100 / departures, 2) if departures else None}
        return page([violation_row(v) for v in Violation.search(domain, offset=offset, limit=limit, order=order)],
                    Violation.search_count(domain), offset, limit, counts)
