"""19.0.1.0.2 : nom des paies avec élision (« Paie d'octobre 2026 » au lieu de « Paie de octobre 2026 »)."""

from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    payrolls = env["eguitra.rh.payroll"].search([])
    payrolls._compute_name()
    payrolls.flush_recordset(["name"])
