"""Réglages des achats et des ventes, propres à chaque société (Finance > Administration > Achats et ventes,
administration et finance) : validité des offres, relance avant expiration, rapprochement des pièces d'achat
avec les commandes (tolérances, écart bloquant ou soumis au circuit), règle des trois devis. Les modifications
passent par la piste d'audit (res.company est suivi par eguitra_base).

Numérotation propre à chaque société : offres (OF/EG/2026/0001, OF/MBAX/2026/0001), bons de commande
(BC/…) et réceptions (REC/…), par des séquences rattachées à la société sous les codes du noyau
(sale.order, purchase.order) : le noyau prend d'abord la séquence de la société.
"""

from odoo import fields, models
from odoo.exceptions import UserError

from .approval import ensure_purchase_order_rules

# Repère de la société dans les numéros ; à défaut, les quatre premières lettres de son nom.
TAGS = {"groupe": "EG", "cabinet": "MBAX"}
# Code de séquence -> (libellé, préfixe du document).
SEQUENCES = {
    "sale.order": ("Offres commerciales", "OF"),
    "purchase.order": ("Bons de commande fournisseur", "BC"),
    "eguitra.commerce.receipt": ("Réceptions (service fait)", "REC"),
}
DEFAULT_VALIDITY = 15
MATCH_MODES = [("approval", "Écart soumis au circuit des pièces d'achat"), ("block", "Écart bloquant")]


class ResCompany(models.Model):
    _inherit = "res.company"

    eguitra_offer_reminder_days = fields.Integer(
        "Relance avant expiration (jours)", default=3,
        help="Nombre de jours avant l'expiration d'une offre envoyée où son auteur est relancé ; 0 : pas de relance.")
    eguitra_match_qty_tolerance = fields.Float(
        "Tolérance sur les quantités (%)", default=0.0,
        help="Quantité facturée admise au-delà de la quantité reçue, en pourcentage de celle-ci.")
    eguitra_match_price_tolerance = fields.Float(
        "Tolérance sur les prix (%)", default=2.0,
        help="Prix unitaire facturé admis au-delà du prix commandé, en pourcentage de celui-ci.")
    eguitra_match_mode = fields.Selection(
        MATCH_MODES, "Écart de rapprochement", default="approval", required=True,
        help="Une pièce d'achat qui s'écarte de sa commande ou de sa réception passe par le circuit des pièces "
             "d'achat (règle actuelle), ou ne se valide pas tant que l'écart n'est pas corrigé.")
    eguitra_three_quotes_threshold = fields.Monetary(
        "Trois devis au-delà de (HT)", currency_field="currency_id", default=0.0,
        help="Un engagement de dépense de plus de ce montant se soumet avec trois devis fournisseurs au moins et "
             "le devis retenu, motivé ; 0 : règle désactivée.")

    def _eguitra_tag(self):
        self.ensure_one()
        return TAGS.get(self.eguitra_entity) or "".join(ch for ch in (self.name or "").upper() if ch.isalnum())[:4] or "SOC"

    def _eguitra_commerce_sequence(self, code):
        """Séquence de la société pour le code (créée au besoin : une société ajoutée plus tard a la sienne)."""
        self.ensure_one()
        Sequence = self.env["ir.sequence"].sudo()
        sequence = Sequence.search([("code", "=", code), ("company_id", "=", self.id)], limit=1)
        if sequence:
            return sequence
        label, kind = SEQUENCES[code]
        return Sequence.create({
            "name": f"{label} - {self.name}", "code": code, "company_id": self.id,
            "prefix": f"{kind}/{self._eguitra_tag()}/%(year)s/", "padding": 4, "implementation": "no_gap",
        })

    def _eguitra_commerce_setup(self):
        """Installation (et société ajoutée) : séquences propres, validité des offres à 15 jours (au lieu des
        30 du noyau), acomptes des clients en 4191 « Clients, avances et acomptes reçus », validation des
        bons de commande en une étape dans le noyau (le circuit est celui de la plateforme)."""
        for company in self:
            for code in SEQUENCES:
                company._eguitra_commerce_sequence(code)
            values = {}
            if company.quotation_validity_days == 30:
                values["quotation_validity_days"] = DEFAULT_VALIDITY
            if not company.downpayment_account_id:
                advance = company._eguitra_advance_account(required=False)
                if advance:
                    values["downpayment_account_id"] = advance.id
            if company.po_double_validation != "one_step":
                values["po_double_validation"] = "one_step"
            if values:
                company.write(values)
        # Circuit des bons de commande (contrôle, approbation de la direction générale), s'il manque.
        ensure_purchase_order_rules(self.env, self)
        return True

    def _eguitra_advance_account(self, required=True):
        """Compte des acomptes et avances reçus des clients : celui des acomptes de la société, à défaut 4191."""
        self.ensure_one()
        account = self.downpayment_account_id or self.env["account.account"].sudo().search(
            [("code", "=like", "4191%"), ("company_ids", "in", self.ids)], order="code", limit=1)
        if not account and required:
            raise UserError("Compte 4191 « Clients, avances et acomptes reçus » introuvable dans le plan de comptes.")
        return account
