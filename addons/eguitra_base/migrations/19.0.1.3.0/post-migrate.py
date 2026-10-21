"""19.0.1.3.0 : la société du cabinet s'appelle « MB AxisPro » (décision du gérant, 21 octobre 2026)."""

from odoo import SUPERUSER_ID, api

OLD_NAME = "MB AxisPro Consulting"
NEW_NAME = "MB AxisPro"


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    cabinet = env["res.company"].search([("eguitra_entity", "=", "cabinet"), ("name", "=", OLD_NAME)])
    cabinet.write({"name": NEW_NAME})
