from odoo import fields, models


class ResCompany(models.Model):
    _inherit = "res.company"

    eguitra_entity = fields.Selection(
        [("groupe", "EGUITRA GROUP"), ("cabinet", "MB AxisPro Consulting")],
        string="Entité de la plateforme",
        help="Application qui sert cette société : EGUITRA Finance (groupe) ou AxisPro Suite (cabinet).",
    )
