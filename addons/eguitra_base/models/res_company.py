from odoo import fields, models


class ResCompany(models.Model):
    _inherit = "res.company"

    eguitra_entity = fields.Selection(
        [("groupe", "EGUITRA GROUP"), ("cabinet", "MB AxisPro Consulting")],
        string="Entité de la plateforme",
        help="EGUITRA GROUP : EGUITRA Finance, Rotations et modules métier (transport, chantiers, immobilier). "
        "MB AxisPro Consulting : EGUITRA Finance, AxisPro Suite et portail des porteurs de projets.",
    )
