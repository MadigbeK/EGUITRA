"""Achats et ventes, version 19.0.1.1.1 (réponse d'EGUITRA GROUP du 2 novembre 2026 sur le circuit des bons de
commande), sur une base existante :
- là où le circuit par défaut de la version 19.0.1.1.0 (contrôle, validation, direction au-delà de 10 M) est
  resté exactement tel quel, il est remplacé par le nouveau défaut : contrôle par le chef comptable ou le DAF,
  puis approbation de la direction générale (règle « jusqu'à 10 M », niveau à définir avec la direction
  générale, et règle « plus de 10 M ») ; les anciennes règles sont archivées et renommées, jamais supprimées ;
- une société dont l'administration a modifié le circuit n'est pas touchée (journal) ;
- les demandes d'approbation déjà ouvertes gardent leurs étapes, figées à la soumission (libellé et profil) :
  un bon en attente de la validation ou de la direction s'approuve comme prévu ; les bons soumis ensuite
  suivent le nouveau circuit ;
- une société sans aucune règle de cette nature reçoit le nouveau défaut.
"""

import logging

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_commerce.models.approval import ensure_purchase_order_rules, upgrade_purchase_order_rules

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    replaced, kept = upgrade_purchase_order_rules(env)
    for company in replaced:
        _logger.info("Circuit des bons de commande de %s : ancien défaut remplacé (contrôle, puis direction "
                     "générale).", company.name)
    for company in kept:
        _logger.warning("Circuit des bons de commande de %s modifié par l'administration : laissé tel quel, "
                        "à revoir dans Circuits.", company.name)
    ensure_purchase_order_rules(env)
