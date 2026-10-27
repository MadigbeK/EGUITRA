"""Comparatifs du premier exercice (Finance > Clôtures et contrôles, à côté de la validation de la reprise) :
import des états de l'exercice précédent au modèle du système normal, contrôles, bilan d'ouverture.

Mêmes profils que la validation de la reprise (reprise.py) : lecture par les profils de la finance, import et
remplacement par l'administration seule. Le remplacement d'un import se confirme (409 sans replace=1) ; la
piste d'audit garde l'import, le remplacement et chaque montant (hooks.py)."""

from datetime import timedelta

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route
from odoo.addons.eguitra_api.files import XLSX, checked_name, detect_type

from ..models.statement_comparative import ComparativeExists
from .common import FIN_READ, parse_date, today

# Profil de la validation de la reprise pour le chargement des valeurs de référence (reprise.py).
COMPARATIVES_IMPORT = ("admin",)
MAX_IMPORT = 5 * 1024 * 1024


def _previous_closing(company):
    """Clôture de l'exercice qui précède celui d'aujourd'hui (date proposée par défaut)."""
    metrics = request.env["eguitra.finance.metrics"].sudo()
    fy_start = metrics.fiscal_year_bounds(company, today())[0]
    return fy_start - timedelta(days=1)


class EguitraFinanceComparatives(http.Controller):
    @api_route("/finance/comparatives", profiles=FIN_READ)
    def comparatives(self, **_kw):
        """Imports de la société de travail, du plus récent au plus ancien, avec leurs contrôles."""
        company = request.env.company
        records = request.env["eguitra.statement.comparative"].search([("company_id", "=", company.id)])
        return {"company": company.name, "default_date_to": _previous_closing(company),
                "items": [record.summary() for record in records]}

    @api_route("/finance/comparatives/import", methods=("POST",), profiles=COMPARATIVES_IMPORT)
    def import_comparatives(self, **_kw):
        """Classeur XLSX au modèle (feuilles Bilan, Compte de Résultat, Tableau des flux de trésorerie) ; date_to :
        clôture de l'exercice importé (par défaut, celle de l'exercice précédent) ; replace=1 remplace un import
        existant de la même date, après confirmation à l'écran."""
        upload = request.httprequest.files.get("file")
        if not upload:
            raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
        content = upload.read(MAX_IMPORT + 1)
        if len(content) > MAX_IMPORT:
            raise ApiError(413, "too_large", "Fichier trop volumineux (5 Mo maximum).")
        if detect_type(content) != XLSX:
            raise ApiError(422, "business_rule", "Classeur Excel (.xlsx) attendu, sans macros.")
        form = request.httprequest.form
        company = request.env.company
        date_to = parse_date(form, "date_to") or _previous_closing(company)
        replace = form.get("replace") == "1"
        Comparative = request.env["eguitra.statement.comparative"]
        try:
            record = Comparative.import_workbook(company, date_to, content, checked_name(upload.filename, XLSX, "etats"),
                                                 replace=replace)
        except ComparativeExists as e:
            existing = e.record
            raise ApiError(409, "conflict", f"Des états de l'exercice clos le {date_to:%d/%m/%Y} ont déjà été importés "
                                            f"(« {existing.source or 'classeur'} », par {existing.imported_by.name or '?'}) : "
                                            "confirmez leur remplacement.", existing=existing.summary()) from e
        return dict(record.summary(), replaced=replace)

    @api_route("/finance/comparatives/opening", profiles=FIN_READ)
    def opening(self, **kw):
        """Bilan d'ouverture : à-nouveaux (journal AN) face au bilan importé de l'exercice clos le date_to."""
        company = request.env.company
        date_to = parse_date(kw, "date_to") or _previous_closing(company)
        return request.env["eguitra.statement.comparative"].opening_check(company, date_to)
