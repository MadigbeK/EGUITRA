"""Le moteur d'approbation de la plateforme (eguitra_approval), prolongé aux bons de commande fournisseur par
héritage, sans second moteur : mêmes règles que les engagements de dépense (nature « commitment »), mêmes
étapes, même corbeille, même empreinte de la pièce soumise. La demande porte la nature « Bons de commande
fournisseur » ; la dernière approbation approuve le bon de commande, un refus le renvoie en brouillon.

Quatre yeux : comme pour toute demande, le demandeur et l'auteur de la pièce (celui qui a saisi le bon de
commande) n'en tranchent aucune étape ; s'y ajoute le demandeur de l'engagement d'où vient le bon.
"""

from odoo import fields, models

PURCHASE_ORDER = "purchase.order"


class EguitraApprovalRequest(models.Model):
    _inherit = "eguitra.approval.request"

    document = fields.Selection(selection_add=[("purchase_order", "Bons de commande fournisseur")],
                                ondelete={"purchase_order": "cascade"})

    def _authors(self):
        authors = super()._authors()
        if self.res_model == PURCHASE_ORDER:
            record = self._record()
            if record:
                authors |= record.sudo().eguitra_commitment_id.requested_by
        return authors

    def _current_amount(self):
        if self.res_model == PURCHASE_ORDER:
            record = self._record()
            return record.amount_untaxed if record else self.amount
        return super()._current_amount()

    def _on_approved(self):
        if self.res_model == PURCHASE_ORDER:
            record = self._record()
            if record:
                record._eguitra_on_approved()
            return
        return super()._on_approved()

    def action_reject(self, comment):
        result = super().action_reject(comment)
        if self.res_model == PURCHASE_ORDER:
            record = self._record()
            if record:
                record._eguitra_on_rejected()
        return result
