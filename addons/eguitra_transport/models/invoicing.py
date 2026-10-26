"""Factures des rotations défaites par la finance (audit du 25 octobre, C12).

Une facture des rotations supprimée (brouillon), annulée, ou extournée en totalité rend ses rotations
« à facturer » : validées, sans facture, de nouveau dans la facturation, les alertes et les factures à
établir. Leurs créances sur le chauffeur encore en brouillon sont retirées (une nouvelle facturation
les recrée) ; une créance déjà validée reste, elle se défait par la finance.
"""

from odoo import models


class AccountMove(models.Model):
    _inherit = "account.move"

    def _release_transport_rotations(self):
        rotations = self.env["eguitra.transport.rotation"].sudo().search([("invoice_id", "in", self.ids)])
        if not rotations:
            return
        claims = rotations.shortage_claim_move_id.filtered(lambda m: m.state == "draft")
        rotations.write({"state": "done", "invoice_id": False})
        if claims:
            rotations.filtered(lambda r: r.shortage_claim_move_id in claims).write({"shortage_claim_move_id": False})
            claims.unlink()

    def unlink(self):
        self._release_transport_rotations()
        return super().unlink()

    def button_cancel(self):
        result = super().button_cancel()
        self.filtered(lambda m: m.state == "cancel")._release_transport_rotations()
        return result

    def _reverse_moves(self, default_values_list=None, cancel=False):
        # Extourne totale (avoir lettré avec la facture) : la facture ne vaut plus.
        reverses = super()._reverse_moves(default_values_list=default_values_list, cancel=cancel)
        if cancel:
            self._release_transport_rotations()
        return reverses
