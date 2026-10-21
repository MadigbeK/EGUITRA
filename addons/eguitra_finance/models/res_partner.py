from odoo import fields, models


class ResPartner(models.Model):
    """Fiche tiers enrichie (prototype de la direction) : secteur, contact, assujettissement à la TVA.
    Code (ref), RCCM (company_registry) et conditions de paiement sont des champs du noyau."""

    _inherit = "res.partner"

    eguitra_sector = fields.Char("Secteur")
    eguitra_contact = fields.Char("Interlocuteur", help="Interlocuteur chez le tiers (nom, fonction).")
    eguitra_vat_exempt = fields.Boolean(
        "Non assujetti à la TVA",
        help="Ses factures et avoirs de vente sont émis en exonération de TVA, quel que soit le module qui les crée.",
    )
