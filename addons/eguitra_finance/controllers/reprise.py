"""Validation de la reprise : valeurs du classeur de référence face aux valeurs recalculées par la
plateforme (models/reprise_reference.py), à annexer au procès-verbal de bascule."""

import io
import json

from odoo import fields, http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route
from odoo.addons.eguitra_api.files import XLSX_OPTIONS, xlsx_row

from .common import FIN_READ

MAX_REFERENCE = 256 * 1024


class EguitraReprise(http.Controller):
    @api_route("/finance/reprise/validation", profiles=FIN_READ)
    def validation(self, **_kw):
        return request.env["eguitra.reprise.reference"].validation(request.env.company)

    @api_route("/finance/reprise/references", methods=("POST",), profiles=("admin",))
    def load_references(self, **_kw):
        """Fichier JSON des valeurs attendues : {"date_to": "AAAA-MM-JJ", "source": "...",
        "values": {code: valeur}} (produit par scripts/reprise/extraire_reference.py)."""
        upload = request.httprequest.files.get("file")
        if not upload:
            raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
        raw = upload.read(MAX_REFERENCE + 1)
        if len(raw) > MAX_REFERENCE:
            raise ApiError(413, "too_large", "Fichier trop volumineux.")
        try:
            data = json.loads(raw.decode("utf-8-sig"))
            date_to = fields.Date.to_date(data["date_to"])
            values = {str(k): float(v) for k, v in (data.get("values") or {}).items()}
        except (ValueError, KeyError, TypeError, AttributeError) as e:
            raise ApiError(422, "business_rule", "Fichier de référence illisible (date_to et values attendus).") from e
        try:
            request.env["eguitra.reprise.reference"].load(request.env.company, date_to, values,
                                                         source=data.get("source"))
        except ValueError as e:
            raise ApiError(422, "business_rule", str(e)) from e
        return request.env["eguitra.reprise.reference"].validation(request.env.company)

    @api_route("/finance/reprise/validation.xlsx", profiles=FIN_READ)
    def validation_xlsx(self, **_kw):
        import xlsxwriter

        result = request.env["eguitra.reprise.reference"].validation(request.env.company)
        out = io.BytesIO()
        book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
        head = book.add_format({"bold": True, "bg_color": "#11221D", "font_color": "#FFFFFF"})
        sheet = book.add_worksheet("Validation de la reprise")
        company = request.env.company.name
        xlsx_row(sheet, 0, [f"Validation de la reprise : {company}"])
        xlsx_row(sheet, 1, [f"Période du {result.get('date_from') or ''} au {result.get('date_to') or ''} ; "
                            f"{result['conform']}/{result['total']} indicateurs conformes ; calculé le "
                            f"{fields.Datetime.context_timestamp(request.env.user, fields.Datetime.now()):%d/%m/%Y %H:%M} "
                            f"par {request.env.user.name}."])
        xlsx_row(sheet, 3, ["Indicateur", "Attendu", "Recalculé", "Écart", "Tolérance", "Conforme"], head)
        for r, row in enumerate(result["rows"], start=4):
            xlsx_row(sheet, r, [row["label"], row["expected"], row["actual"] if row["actual"] is not None else "n.d.",
                                row["gap"] if row["gap"] is not None else "", row["tolerance"], "oui" if row["ok"] else "non"])
        sheet.set_column(0, 0, 40)
        sheet.set_column(1, 4, 22)
        book.close()
        return request.make_response(out.getvalue(), headers=[
            ("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            ("Content-Disposition", content_disposition("validation_reprise.xlsx")),
        ])
