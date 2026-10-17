"""Paramètres du transport : tolérance et traitement des manquants (société, client), volumes à 15 °C.

Ordre de résolution de la tolérance de manquant d'une rotation : tarif du client pour le produit
(ou tous produits), sinon conditions du client, sinon valeur par défaut de la société. Le
traitement du manquant hors tolérance suit le client, à défaut la société :
- constat seulement : manquant suivi, valorisé et signalé, sans effet sur la marge ni écriture ;
- déduction : ligne négative sur la facture du client (compte des manquants), à la charge de la marge ;
- créance sur le chauffeur : le client réclame le manquant hors de notre facture (note de débit
  enregistrée par la finance) et la société le reprend au chauffeur : opération diverse au débit du
  compte du chauffeur, au crédit du compte des manquants ; coût net nul pour la marge ;
- les deux : déduction sur la facture et créance sur le chauffeur.
"""

from odoo import fields, models
from odoo.exceptions import UserError

SHORTAGE_RULES = [
    ("none", "Constat seulement"),
    ("invoice", "Déduction sur la facture du client"),
    ("driver", "Créance sur le chauffeur"),
    ("both", "Déduction sur la facture et créance sur le chauffeur"),
]
DEDUCTED = ("invoice", "both")
CLAIMED = ("driver", "both")


class ResCompany(models.Model):
    _inherit = "res.company"

    transport_shortage_tolerance = fields.Float(
        "Tolérance de manquant par défaut (%)", digits=(5, 3), default=0.5,
        help="Part du volume chargé admise en manquant (évaporation, mesure) ; au-delà, le manquant est excédentaire.",
    )
    transport_shortage_rule = fields.Selection(
        SHORTAGE_RULES, "Traitement du manquant excédentaire", default="none", required=True,
        help="Constat seulement : le manquant est suivi et signalé, sans écriture.",
    )
    transport_volume_correction = fields.Boolean(
        "Manquants sur volumes corrigés à 15 °C",
        help="Les manquants se calculent sur les volumes ramenés à 15 °C (températures et masse volumique "
             "du bon de chargement), la facturation reste sur le volume livré.",
    )
    transport_shortage_account_id = fields.Many2one(
        "account.account", "Compte des manquants",
        help="Charge de la déduction accordée au client ; la créance sur le chauffeur la reprend. "
             "Vide : premier compte 6588, sinon 658.",
    )
    transport_claim_account_id = fields.Many2one(
        "account.account", "Compte des créances sur les chauffeurs",
        help="Vide : premier compte 4211, sinon 421 (personnel, avances et acomptes).",
    )
    transport_activity_id = fields.Many2one(
        "account.analytic.account", "Activité du transport",
        help="Activité analytique des factures de rotations et de la rentabilité du transport (reprise : "
             "l'activité de l'ancien classeur). Vide : activité « Transport pétrolier », créée au besoin.",
    )

    def _transport_account(self, field, prefixes, label):
        """Compte paramétré, sinon premier compte du plan sous les préfixes donnés."""
        self.ensure_one()
        if self[field]:
            return self[field]
        Account = self.env["account.account"]
        for prefix in prefixes:
            account = Account.search([("code", "=like", prefix + "%"), ("company_ids", "in", self.ids)],
                                     order="code", limit=1)
            if account:
                return account
        raise UserError(f"{label} introuvable : choisissez-le dans Finance > Transport > Paramètres.")

    def _transport_shortage_account(self):
        return self._transport_account("transport_shortage_account_id", ("6588", "658"), "Compte des manquants")

    def _transport_claim_account(self):
        return self._transport_account("transport_claim_account_id", ("4211", "421"),
                                       "Compte des créances sur les chauffeurs")


class ResPartner(models.Model):
    _inherit = "res.partner"

    transport_tolerance_custom = fields.Boolean(
        "Tolérance de manquant propre au client", help="Sinon, tolérance par défaut de la société.")
    transport_shortage_tolerance = fields.Float("Tolérance de manquant du client (%)", digits=(5, 3))
    transport_shortage_rule = fields.Selection(
        SHORTAGE_RULES, "Traitement du manquant excédentaire (client)", help="Vide : règle de la société.")
