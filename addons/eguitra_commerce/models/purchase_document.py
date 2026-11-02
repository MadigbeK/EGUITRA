"""Pièces jointes et historique des bons de commande fournisseur (retour du client du 2 novembre 2026).

Pièces jointes : devis ou facture proforma du fournisseur, contrat, bon de livraison, autre ; plusieurs par
bon, chacune avec sa catégorie, son auteur et sa date. Le format est lu dans le contenu (eguitra_api,
files.py). Avant l'approbation, une pièce mal jointe se retire ; une fois le bon soumis, approuvé ou annulé,
ses pièces sont archivées : elles ne se suppriment ni ne se remplacent plus.

Historique : les actions qui ne se lisent pas ailleurs (modifications des champs clés et des lignes,
approbation d'office par l'engagement, envoi au fournisseur, annulation, pièces jointes ou retirées) sont
écrites ici, sans modification ni suppression possible ; la route de l'historique y ajoute ce que gardent
déjà les autres fiches (création, soumissions et décisions du circuit, réceptions, pièces d'achat).
"""

from odoo import api, fields, models
from odoo.exceptions import UserError

DOCUMENT_CATEGORIES = [
    ("quote", "Devis du fournisseur"),
    ("proforma", "Facture proforma"),
    ("contract", "Contrat"),
    ("delivery", "Bon de livraison"),
    ("other", "Autre"),
]
EVENT_KINDS = [
    ("created", "Création"),
    ("modified", "Modification"),
    ("submitted", "Soumission au circuit"),
    ("approved", "Approbation"),
    ("rejected", "Refus"),
    ("approved_auto", "Approbation d'office (engagement)"),
    ("sent", "Envoi au fournisseur"),
    ("received", "Réception"),
    ("receipt_cancelled", "Réception annulée"),
    ("billed", "Pièce d'achat"),
    ("cancelled", "Annulation"),
    ("document_added", "Pièce jointe"),
    ("document_removed", "Pièce retirée"),
]
# États du noyau où les pièces d'un bon se retirent encore : brouillon (ou refusé), jamais soumis.
EDITABLE_STATES = ("draft", "sent")


class EguitraCommercePurchaseDocument(models.Model):
    _name = "eguitra.commerce.purchase.document"
    _description = "Pièce jointe d'un bon de commande fournisseur"
    _order = "order_id, uploaded_at, id"

    order_id = fields.Many2one("purchase.order", "Bon de commande", required=True, ondelete="restrict", index=True)
    company_id = fields.Many2one(related="order_id.company_id", store=True, index=True)
    category = fields.Selection(DOCUMENT_CATEGORIES, "Catégorie", required=True, default="other")
    name = fields.Char("Nom du fichier", required=True)
    attachment_id = fields.Many2one("ir.attachment", "Fichier", required=True, ondelete="restrict")
    mimetype = fields.Char(related="attachment_id.mimetype")
    file_size = fields.Integer(related="attachment_id.file_size")
    note = fields.Char("Observation")
    origin = fields.Char("Provenance", help="Par exemple : devis retenu de l'engagement ENG/…")
    uploaded_by = fields.Many2one("res.users", "Joint par", required=True, default=lambda self: self.env.user,
                                  readonly=True)
    uploaded_at = fields.Datetime("Joint le", required=True, default=fields.Datetime.now, readonly=True)

    @api.model_create_multi
    def create(self, vals_list):
        documents = super().create(vals_list)
        for document in documents:
            document.order_id._eguitra_log(
                "document_added", f"{dict(DOCUMENT_CATEGORIES)[document.category]} : {document.name}",
                document.origin or document.note or None)
        return documents

    def _eguitra_check_removable(self):
        for document in self:
            if document.order_id.state not in EDITABLE_STATES:
                raise UserError(f"Le bon de commande {document.order_id.name} est soumis, approuvé ou annulé : ses "
                                "pièces jointes sont archivées et ne se retirent plus.")

    def write(self, vals):
        if set(vals) - {"note"}:
            self._eguitra_check_removable()
        return super().write(vals)

    def unlink(self):
        if self.env.context.get("_force_unlink"):  # désinstallation du module
            return super().unlink()
        self._eguitra_check_removable()
        for document in self:
            document.order_id._eguitra_log(
                "document_removed", f"{dict(DOCUMENT_CATEGORIES)[document.category]} : {document.name}")
        attachments = self.attachment_id
        result = super().unlink()
        attachments.sudo().unlink()
        return result


class EguitraCommercePurchaseEvent(models.Model):
    _name = "eguitra.commerce.purchase.event"
    _description = "Historique d'un bon de commande fournisseur"
    _order = "date, id"

    order_id = fields.Many2one("purchase.order", "Bon de commande", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="order_id.company_id", store=True, index=True)
    date = fields.Datetime("Date", required=True, default=fields.Datetime.now, readonly=True)
    user_id = fields.Many2one("res.users", "Par", required=True, default=lambda self: self.env.user, readonly=True)
    kind = fields.Selection(EVENT_KINDS, "Action", required=True, readonly=True)
    summary = fields.Char("Résumé", required=True, readonly=True)
    detail = fields.Text("Détail", readonly=True)

    def write(self, vals):
        raise UserError("L'historique d'un bon de commande ne se modifie pas.")

    def unlink(self):
        if not self.env.context.get("_force_unlink"):  # sauf à la désinstallation du module
            raise UserError("L'historique d'un bon de commande ne se supprime pas.")
        return super().unlink()
