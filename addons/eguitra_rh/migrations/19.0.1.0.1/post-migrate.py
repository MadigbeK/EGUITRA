"""19.0.1.0.1 : quatre yeux sur la paie. « Préparée par » des paies existantes, reconstitué à partir de
qui les a créées et de qui a calculé leurs bulletins ou saisi leurs éléments variables : aucun de ces
comptes ne pourra valider la paie (ni la revalider après réouverture)."""

from odoo import SUPERUSER_ID, api


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    for payroll in env["eguitra.rh.payroll"].search([]):
        slips = payroll.payslip_ids
        users = (payroll.create_uid | slips.create_uid | slips.write_uid | slips.input_ids.create_uid
                 | slips.input_ids.write_uid)
        if users:
            payroll.prepared_by_ids = [(4, user.id) for user in users]
