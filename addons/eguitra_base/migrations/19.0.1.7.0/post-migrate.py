"""19.0.1.7.0 : le franc guinéen s'écrit « GNF » sur les documents comme dans les applications, au lieu
du « FG » du noyau (décision du gérant, 22 octobre 2026)."""

from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    api.Environment(cr, SUPERUSER_ID, {})["eguitra.setup"].ensure_document_settings()
