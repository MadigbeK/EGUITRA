"""Achats et ventes, version 19.0.1.1.3 (réponse d'EGUITRA GROUP du 3 novembre 2026, transmise par le gérant) :
- la direction générale est l'approbateur final des bons de 10 000 000 GNF HT ou moins : la règle « jusqu'à
  10 M » perd sa mention « niveau à définir avec la direction générale », là où son libellé est resté celui de la
  version 19.0.1.1.1 (profil et plafond inchangés ; les demandes déjà ouvertes gardent leurs étapes) ;
- chez MB AxisPro Consulting aussi, l'émission des bons de commande est réservée au service Achats (la même
  personne que chez EGUITRA GROUP SARLU, dont le compte est ouvert aux deux sociétés). La réserve d'EGUITRA GROUP
  SARLU n'est pas touchée ; un brouillon saisi chez MB AxisPro Consulting par un autre profil se modifie, se
  soumet ou s'annule désormais par le service Achats.
"""

import logging

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_commerce.hooks import reserve_purchase_order_issue
from odoo.addons.eguitra_commerce.models.approval import rename_small_purchase_order_rule

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    renamed = rename_small_purchase_order_rule(env)
    for rule in renamed:
        _logger.info("Circuit des bons de commande de %s : règle « %s ».", rule.company_id.name, rule.name)
    reserve_purchase_order_issue(env, ("cabinet",))
    drafts = env["purchase.order"].search_count([("state", "in", ("draft", "sent")),
                                                 ("company_id.eguitra_entity", "=", "cabinet")])
    _logger.info("Émission des bons de commande de MB AxisPro Consulting réservée au service Achats (%s brouillon(s) "
                 "désormais modifiés et soumis par le service Achats).", drafts)
