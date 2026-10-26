"""Circuit d'approbation, version 19.0.1.3.0 (audit du noyau, C1 et M13) sur une base existante :
- l'entrée d'un virement interne entre désormais dans l'empreinte de sa sortie : l'empreinte des
  demandes en cours sur une sortie de virement est recalculée, sans quoi leur approbation serait
  refusée (« pièce modifiée ») ;
- une société sans aucune règle (créée après l'installation) reçoit le circuit par défaut.
Redémarrer le noyau ensuite (module d'audit)."""

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_approval.models.approval import DEFAULT_RULES


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    for request in env["eguitra.approval.request"].search([("res_model", "=", "account.move"), ("state", "=", "pending")]):
        move = request._record()
        if move and move.eguitra_paired_move_id:
            request.fingerprint = move._eguitra_fingerprint()
    env["eguitra.approval.rule"].ensure_defaults(DEFAULT_RULES)
