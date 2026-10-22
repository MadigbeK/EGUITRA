"""19.0.1.6.0 : la société du cabinet s'appelle de nouveau « MB AxisPro Consulting », partout (décision du
gérant, 22 octobre 2026, qui annule le nom court de la 19.0.1.3.0)."""

from odoo import SUPERUSER_ID, api

OLD_NAME = "MB AxisPro"
NEW_NAME = "MB AxisPro Consulting"


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    cabinet = env["res.company"].search([("eguitra_entity", "=", "cabinet"), ("name", "=", OLD_NAME)])
    cabinet.write({"name": NEW_NAME})
