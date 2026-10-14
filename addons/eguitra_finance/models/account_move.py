from odoo import fields, models


class AccountMove(models.Model):
    _inherit = "account.move"

    eguitra_manual_entry = fields.Boolean(
        "Saisie manuelle", copy=False, readonly=True,
        help="Opération diverse saisie dans les applications (et non produite par le noyau).",
    )

    def _eguitra_post_or_submit(self):
        """Validation demandée depuis les applications ; le moteur d'approbation la transforme
        en soumission quand un circuit s'applique."""
        self.action_post()
        return True

    def _eguitra_approval_info(self):
        """État d'approbation affiché dans les applications (complété par eguitra_approval)."""
        self.ensure_one()
        return None
