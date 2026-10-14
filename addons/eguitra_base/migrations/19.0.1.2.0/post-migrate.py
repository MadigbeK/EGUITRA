"""19.0.1.2.0 : intitulé « NIF » de l'identifiant fiscal sur les documents imprimés."""

from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    api.Environment(cr, SUPERUSER_ID, {})["eguitra.setup"].ensure_document_settings()
