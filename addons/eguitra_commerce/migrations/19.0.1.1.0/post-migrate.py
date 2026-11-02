"""Achats et ventes, version 19.0.1.1.0 (retour du client du 2 novembre 2026 sur les bons de commande), sur une
base existante :
- circuit par défaut des bons de commande (contrôle, validation, approbation de la direction au-delà de
  10 000 000 GNF HT) pour chaque société qui n'a aucune règle de cette nature ; les demandes déjà ouvertes
  gardent leurs étapes ;
- lieu de livraison par défaut (adresse de la société) sur les bons encore en brouillon ;
- empreinte des demandes des bons de commande : elle couvre désormais aussi la pièce du fournisseur et les
  conditions. Une demande dont l'empreinte correspond encore au bon selon l'ancienne formule (bon inchangé
  depuis sa soumission) reçoit l'empreinte de la nouvelle formule, calculée sur le même bon ; sans cela, les
  bons en approbation ne s'approuveraient plus et les bons approuvés seraient imprimés « modifiés depuis leur
  soumission » ;
- piste d'audit des pièces jointes des bons.
Redémarrer le noyau ensuite (module d'audit)."""

import json

from odoo import SUPERUSER_ID, api

from odoo.addons.eguitra_approval.models.account_move import fingerprint
from odoo.addons.eguitra_commerce.hooks import AUDITED_MODELS
from odoo.addons.eguitra_commerce.models.approval import ensure_purchase_order_rules
from odoo.addons.eguitra_commerce.models.purchase_order import company_address


def _previous_fingerprint(order):
    """Empreinte d'un bon selon la formule de la version 19.0.1.0.0."""
    lines = sorted(
        [line.product_id.id, line.name or "", round(line.product_qty, 4), round(line.price_unit, 2),
         round(line.discount or 0.0, 2), sorted(line.tax_ids.ids), line.eguitra_account_id.id,
         json.dumps(line.analytic_distribution or {}, sort_keys=True)]
        for line in order._eguitra_product_lines()
    )
    return fingerprint(["purchase_order", order.partner_id.id, order.currency_id.id, order.eguitra_commitment_id.id,
                        round(order.amount_untaxed, 2), lines])


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    ensure_purchase_order_rules(env)
    for order in env["purchase.order"].search([("state", "in", ("draft", "sent")), ("eguitra_delivery_place", "=", False)]):
        order.with_context(eguitra_no_history=True, tracking_disable=True).write(
            {"eguitra_delivery_place": company_address(order.company_id)})
    requests = env["eguitra.approval.request"].search([("res_model", "=", "purchase.order"),
                                                       ("state", "in", ("pending", "approved"))])
    for request in requests:
        order = request._record()
        if order and request.fingerprint and request.fingerprint == _previous_fingerprint(order):
            request.fingerprint = order._eguitra_fingerprint()
    env["eguitra.setup"].ensure_audit_rules(AUDITED_MODELS)
