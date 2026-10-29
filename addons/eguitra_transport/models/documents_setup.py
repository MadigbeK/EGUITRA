"""Réglages de la chaîne documentaire d'une opération de transport (29/10/2026) : numérotation par société et
par année (préfixes réglables : OT, OM, BV, LV, BCA), franchise d'immobilisation, mention aux autorités de
l'ordre de mission, consignes au chauffeur de la lettre de voiture, signataires, compte des avances de frais
de route et caisse des budgets de voyage ; conditions d'immobilisation propres à un client.

Les textes livrés par défaut sont des usages du transport routier, réglables par l'administration.
"""

import re

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

# Document -> (code de la séquence, préfixe par défaut, libellé).
DOCUMENT_SEQUENCES = {
    "order": ("eguitra.transport.order", "OT", "Ordres de transport"),
    "mission": ("eguitra.transport.mission", "OM", "Ordres de mission"),
    "budget": ("eguitra.transport.budget", "BV", "Budgets de voyage"),
    "waybill": ("eguitra.transport.waybill", "LV", "Lettres de voiture"),
    "voucher": ("eguitra.transport.fuel.voucher", "BCA", "Bons carburant"),
}
PREFIX = re.compile(r"^[A-Z0-9][A-Z0-9-]{0,9}$")
DEFAULT_AUTHORITIES_NOTE = ("Les autorités administratives et militaires des localités traversées sont priées de faciliter "
                            "l'accomplissement de cette mission.")
DEFAULT_INSTRUCTIONS = (
    "Interdiction de consommer de l'alcool ou des drogues.",
    "Interdiction de prendre des somnifères ou des médicaments qui altèrent la vigilance.",
    "Aucun passager non autorisé à bord.",
    "Aucune marchandise non autorisée à bord.",
    "Téléphone éteint pendant la conduite.",
    "Port de la ceinture de sécurité obligatoire.",
)
DEFAULT_FREE_DAYS = 2


class ResCompany(models.Model):
    _inherit = "res.company"

    transport_demurrage_free_days = fields.Integer(
        "Franchise d'immobilisation (jours)", default=DEFAULT_FREE_DAYS,
        help="Jours d'immobilisation du camion chez le destinataire compris dans le prix du transport ; au-delà, "
             "l'immobilisation se compte et, si le client le prévoit, se facture.")
    transport_authorities_note = fields.Text(
        "Mention aux autorités (ordre de mission)", default=DEFAULT_AUTHORITIES_NOTE)
    transport_waybill_note = fields.Text(
        "Autres mentions de la lettre de voiture", help="Imprimées sous la franchise d'immobilisation (NB).")
    transport_order_signatory = fields.Char(
        "Signataire des ordres de transport", default="La Direction générale",
        help="Bloc « Pour EGUITRA GROUP » de l'ordre de transport : fonction, puis nom si renseigné.")
    transport_order_signatory_name = fields.Char("Nom du signataire des ordres de transport")
    transport_operations_manager = fields.Char(
        "Responsable des opérations", help="Nom imprimé sous « Responsable des opérations » (budget de voyage).")
    transport_advance_account_id = fields.Many2one(
        "account.account", "Compte des avances de frais de route",
        help="Avance en espèces remise au chauffeur, à justifier au retour. Vide : premier compte 4213 (frais "
             "avancés au personnel), sinon 4211 ou 421.")
    transport_budget_journal_id = fields.Many2one(
        "account.journal", "Caisse des budgets de voyage", domain=[("type", "in", ("cash", "bank"))],
        help="Caisse proposée pour les décaissements, reliquats et compléments ; vide : première caisse.")
    transport_driver_instruction_ids = fields.One2many(
        "eguitra.transport.driver.instruction", "company_id", "Consignes au chauffeur")

    @api.constrains("transport_demurrage_free_days")
    def _check_free_days(self):
        if any((c.transport_demurrage_free_days or 0) < 0 for c in self):
            raise ValidationError("La franchise d'immobilisation ne peut pas être négative.")

    def _transport_advance_account(self):
        return self._transport_account("transport_advance_account_id", ("4213", "4211", "421"),
                                       "Compte des avances de frais de route")

    def _transport_budget_journal(self):
        self.ensure_one()
        if self.transport_budget_journal_id:
            return self.transport_budget_journal_id
        return self.env["account.journal"].sudo().search(
            [("company_id", "=", self.id), ("type", "=", "cash")], order="sequence, id", limit=1)

    # ─── Numérotation des documents ───────────────────────────────────────

    def _transport_sequence(self, document):
        """Séquence d'un document pour la société, créée au besoin (compteur remis à 1 chaque année)."""
        self.ensure_one()
        code, prefix, label = DOCUMENT_SEQUENCES[document]
        Sequence = self.env["ir.sequence"].sudo()
        sequence = Sequence.search([("code", "=", code), ("company_id", "=", self.id)], limit=1)
        if not sequence:
            sequence = Sequence.create({
                "name": f"{label} ({self.name})", "code": code, "company_id": self.id,
                "prefix": f"{prefix}/%(range_year)s/", "padding": 4, "use_date_range": True,
                "implementation": "no_gap",
            })
        return sequence

    def _transport_next_number(self, document, day=None):
        """Numéro suivant : « OT/2026/0001 », par société et par année (date du document)."""
        self.ensure_one()
        return self._transport_sequence(document).next_by_id(sequence_date=day or fields.Date.context_today(self))

    def _transport_prefixes(self):
        self.ensure_one()
        prefixes = {}
        for document, (_code, default, _label) in DOCUMENT_SEQUENCES.items():
            prefix = self._transport_sequence(document).prefix or ""
            prefixes[document] = prefix.split("/%(")[0] or default
        return prefixes

    def _transport_set_prefix(self, document, prefix):
        """Préfixe d'un document (« OT », « LV »…) : lettres majuscules, chiffres et tirets, 10 au plus. Les
        numéros déjà attribués ne changent pas ; le compteur de l'année continue."""
        self.ensure_one()
        if document not in DOCUMENT_SEQUENCES:
            raise UserError("Document inconnu.")
        prefix = (prefix or "").strip().upper()
        if not PREFIX.match(prefix):
            raise UserError(f"Préfixe « {prefix} » refusé : lettres majuscules, chiffres et tirets, 10 au plus.")
        self._transport_sequence(document).write({"prefix": f"{prefix}/%(range_year)s/"})

    def _transport_documents_setup(self):
        """Séquences et consignes par défaut des sociétés (installation, migration, recette)."""
        Instruction = self.env["eguitra.transport.driver.instruction"].sudo()
        for company in self:
            for document in DOCUMENT_SEQUENCES:
                company._transport_sequence(document)
            if not Instruction.with_context(active_test=False).search_count([("company_id", "=", company.id)]):
                Instruction.create([{"company_id": company.id, "sequence": (i + 1) * 10, "name": text}
                                    for i, text in enumerate(DEFAULT_INSTRUCTIONS)])


class EguitraTransportDriverInstruction(models.Model):
    _name = "eguitra.transport.driver.instruction"
    _description = "Consigne au chauffeur (lettre de voiture)"
    _order = "company_id, sequence, id"

    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    sequence = fields.Integer(default=10)
    name = fields.Char("Consigne", required=True)
    active = fields.Boolean(default=True)


class ResPartner(models.Model):
    _inherit = "res.partner"

    transport_demurrage_billable = fields.Boolean(
        "Immobilisation facturée", help="Les jours d'immobilisation au-delà de la franchise s'ajoutent à la facture "
                                        "des rotations du client, au tarif journalier ci-dessous.")
    transport_demurrage_rate = fields.Float("Tarif journalier d'immobilisation (GNF)", digits=(16, 0))
    transport_demurrage_free_days = fields.Integer(
        "Franchise d'immobilisation du client (jours)", help="0 : franchise de la société.")

    @api.constrains("transport_demurrage_rate", "transport_demurrage_free_days")
    def _check_demurrage(self):
        for partner in self:
            if (partner.transport_demurrage_rate or 0) < 0 or (partner.transport_demurrage_free_days or 0) < 0:
                raise ValidationError("Tarif et franchise d'immobilisation ne peuvent pas être négatifs.")
