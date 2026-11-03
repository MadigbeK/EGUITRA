"""Achats et ventes, version 19.0.1.1.2 (décision du gérant du 2 novembre 2026, à la demande d'EGUITRA GROUP) :
émission des bons de commande réservée au service Achats (Responsable Achats et Contrats) chez EGUITRA GROUP
SARLU ; ouverte comme avant chez MB AxisPro Consulting (à confirmer par le client). Les bons déjà soumis ou
approuvés ne changent pas ; un brouillon saisi par un autre profil se modifie, se soumet ou s'annule désormais
par le service Achats. Réglage modifiable ensuite par l'administration (Finance > Administration > Achats et
ventes)."""

import logging

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_commerce.hooks import reserve_purchase_order_issue

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    reserve_purchase_order_issue(env)
    drafts = env["purchase.order"].search_count([("state", "in", ("draft", "sent")),
                                                 ("company_id.eguitra_po_issue_reserved", "=", True)])
    for company in env["res.company"].search([("eguitra_entity", "in", ("groupe", "cabinet"))]):
        _logger.info("Émission des bons de commande de %s : %s.", company.name,
                     "réservée au service Achats" if company.eguitra_po_issue_reserved else "ouverte comme avant")
    if drafts:
        _logger.info("%s bon(s) de commande en brouillon : désormais modifiés et soumis par le service Achats.", drafts)
