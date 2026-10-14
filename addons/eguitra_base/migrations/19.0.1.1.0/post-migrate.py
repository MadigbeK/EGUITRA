"""19.0.1.1.0 : retrait du logo d'exemple du noyau sur les sociétés déjà créées."""

from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    env["eguitra.setup"].clear_placeholder_logos()
