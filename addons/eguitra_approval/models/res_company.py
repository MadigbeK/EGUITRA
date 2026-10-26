from odoo import api, models

from .approval import DEFAULT_RULES


class ResCompany(models.Model):
    _inherit = "res.company"

    @api.model_create_multi
    def create(self, vals_list):
        """Une société créée après l'installation reçoit le circuit par défaut (offre, chapitre 3.4) : sans
        règle, toutes ses pièces, ses règlements et ses décaissements passaient sans approbation."""
        companies = super().create(vals_list)
        self.env["eguitra.approval.rule"].ensure_defaults(DEFAULT_RULES)
        return companies
