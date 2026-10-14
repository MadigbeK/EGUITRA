from odoo import models


class AccountMove(models.Model):
    _inherit = "account.move"

    def _eguitra_post_or_submit(self):
        """Validation demandée depuis les applications ; le moteur d'approbation la transforme
        en soumission quand un circuit s'applique."""
        self.action_post()
        return True

    def _eguitra_approval_info(self):
        """État d'approbation affiché dans les applications (complété par eguitra_approval)."""
        self.ensure_one()
        return None
