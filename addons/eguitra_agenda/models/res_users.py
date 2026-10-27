from odoo import fields, models


class ResUsers(models.Model):
    _inherit = "res.users"

    # Délégations accordées par le compte (mandant) : sert aux règles d'enregistrement de l'agenda.
    agenda_delegation_ids = fields.One2many("eguitra.agenda.delegation", "owner_id", "Délégations de l'agenda")

    def write(self, vals):
        result = super().write(vals)
        if "active" in vals and not vals["active"]:
            # Un compte désactivé perd ses partages et délégations ; ses participants sont prévenus.
            self.env["eguitra.agenda.calendar"].sudo()._on_users_deactivated(self)
        return result
