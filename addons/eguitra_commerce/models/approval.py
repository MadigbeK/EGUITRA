"""Le moteur d'approbation de la plateforme (eguitra_approval), prolongé aux bons de commande fournisseur par
héritage, sans second moteur : mêmes étapes, même corbeille, même empreinte de la pièce soumise. La demande
porte la nature « Bons de commande fournisseur » ; la dernière approbation approuve le bon de commande, un
refus le renvoie en brouillon.

Circuit propre aux bons de commande (retour du client du 2 novembre 2026, carte blanche du gérant), en trois
étapes explicites, réglables par l'administration (Finance > Circuits, nature « Bons de commande
fournisseur ») et créées par défaut pour chaque société :
1. Contrôle : conformité de la commande, budget, pièces jointes (devis, proforma) ; finance (comptable), dès le
   premier franc ;
2. Validation : finance (directeur administratif et financier), dès le premier franc, par une autre personne
   que celle du contrôle ;
3. Approbation : direction générale, pour un bon de plus de 10 000 000 GNF HT.
Seuils proposés, à confirmer par le gérant. Une société sans aucune règle de cette nature garde le circuit
des engagements de dépense (comportement antérieur).

Séparation des responsabilités, comme pour toute demande : celui qui a saisi le bon, celui qui le soumet et le
demandeur de l'engagement d'où il vient n'en tranchent aucune étape, et un même compte ne tranche qu'une étape
d'une même demande.
"""

from odoo import api, fields, models

from odoo.addons.eguitra_approval.models.approval import APPROVER_PROFILES

PURCHASE_ORDER = "purchase.order"
PO_DOCUMENT = "purchase_order"
PO_DIRECTION_THRESHOLD = 10_000_000
PURCHASE_ORDER_RULES = [
    {"document": PO_DOCUMENT, "sequence": 1, "min_amount": 0, "approver_profile": "finance",
     "name": "Contrôle : conformité, budget et pièces (comptabilité)"},
    {"document": PO_DOCUMENT, "sequence": 2, "min_amount": 0, "approver_profile": "finance",
     "name": "Validation : direction administrative et financière"},
    {"document": PO_DOCUMENT, "sequence": 3, "min_amount": PO_DIRECTION_THRESHOLD, "approver_profile": "direction",
     "name": "Approbation : direction générale (plus de 10 M GNF HT)"},
]


def ensure_purchase_order_rules(env, companies=None):
    """Circuit par défaut des bons de commande pour chaque société qui n'a aucune règle de cette nature (même
    inactive : un circuit désactivé par l'administration n'est pas recréé). Idempotent."""
    Rule = env["eguitra.approval.rule"].sudo().with_context(active_test=False)
    for company in companies if companies is not None else env["res.company"].sudo().search([]):
        if not Rule.search_count([("company_id", "=", company.id), ("document", "=", PO_DOCUMENT)]):
            for values in PURCHASE_ORDER_RULES:
                Rule.create(dict(values, company_id=company.id))


class EguitraApprovalRule(models.Model):
    _inherit = "eguitra.approval.rule"

    document = fields.Selection(selection_add=[(PO_DOCUMENT, "Bons de commande fournisseur")],
                                ondelete={PO_DOCUMENT: "cascade"})

    @api.model
    def _eguitra_po_document(self, company):
        """Nature dont les règles s'appliquent aux bons de commande de la société : la leur si elle en a, sinon
        celle des engagements de dépense."""
        has_own = self.sudo().with_context(active_test=False).search_count(
            [("company_id", "=", company.id), ("document", "=", PO_DOCUMENT)])
        return PO_DOCUMENT if has_own else "commitment"

    @api.model
    def _eguitra_po_circuit(self, company, amount, account_codes=None):
        """Circuit prévu pour un bon de commande de ce montant HT : toutes les règles actives de la nature, avec
        celles qui s'appliquent (applies) ; les étapes dans l'ordre."""
        document = self._eguitra_po_document(company)
        applicable = self._applicable(document, company, amount, account_codes)
        labels = dict(APPROVER_PROFILES)
        rules = self.sudo().search([("company_id", "=", company.id), ("document", "=", document)])
        return {
            "document": document, "covered": False, "amount": amount,
            "rules": [{"id": r.id, "sequence": r.sequence, "name": r.name, "profile": r.approver_profile,
                       "profile_label": labels.get(r.approver_profile, r.approver_profile),
                       "min_amount": r.min_amount, "max_amount": r.max_amount or None,
                       "account_prefix": r.account_prefix or None, "applies": r in applicable}
                      for r in rules.sorted(lambda r: (r.sequence, r.min_amount))],
            "steps": len(applicable),
        }


class EguitraApprovalRequest(models.Model):
    _inherit = "eguitra.approval.request"

    document = fields.Selection(selection_add=[(PO_DOCUMENT, "Bons de commande fournisseur")],
                                ondelete={PO_DOCUMENT: "cascade"})

    def _authors(self):
        authors = super()._authors()
        if self.res_model == PURCHASE_ORDER:
            record = self._record()
            if record:
                authors |= record.sudo().eguitra_commitment_id.requested_by
        return authors

    def _current_amount(self):
        if self.res_model == PURCHASE_ORDER:
            record = self._record()
            return record.amount_untaxed if record else self.amount
        return super()._current_amount()

    def _on_approved(self):
        if self.res_model == PURCHASE_ORDER:
            record = self._record()
            if record:
                record._eguitra_on_approved()
            return
        return super()._on_approved()

    def action_reject(self, comment):
        result = super().action_reject(comment)
        if self.res_model == PURCHASE_ORDER:
            record = self._record()
            if record:
                record._eguitra_on_rejected()
        return result

    def _document_detail(self):
        """Bon de commande dans la corbeille de validation : pièce du fournisseur, conditions, pièces jointes,
        lignes ; l'approbateur contrôle sans quitter la corbeille."""
        if self.res_model != PURCHASE_ORDER:
            return super()._document_detail()
        order = self._record()
        if not order:
            return None
        kind = dict(order._fields["eguitra_quote_kind"].selection).get(order.eguitra_quote_kind, "Devis")
        return {
            "name": order.name, "date": order.date_order.date() if order.date_order else None,
            "state": order.eguitra_status, "object": order.eguitra_object or None,
            "note": " · ".join(p for p in (
                f"{kind} {order.partner_ref}" + (f" du {order.eguitra_quote_date:%d/%m/%Y}" if order.eguitra_quote_date else "")
                if order.partner_ref else "",
                " ; ".join(f"{label} : {value}" for label, value in order._eguitra_terms_rows()),
                f"{len(order.eguitra_document_ids)} pièce(s) jointe(s)" if order.eguitra_document_ids else "aucune pièce jointe",
            ) if p) or None,
            "lines": [{"name": line.name, "account": line._eguitra_expense_account().code or None,
                       "amount": line.price_subtotal} for line in order._eguitra_product_lines()],
        }
