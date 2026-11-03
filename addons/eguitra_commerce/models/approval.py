"""Le moteur d'approbation de la plateforme (eguitra_approval), prolongé aux bons de commande fournisseur par
héritage, sans second moteur : mêmes étapes, même corbeille, même empreinte de la pièce soumise. La demande
porte la nature « Bons de commande fournisseur » ; la dernière approbation approuve le bon de commande, un
refus le renvoie en brouillon.

Circuit propre aux bons de commande, réglable par l'administration (Finance > À valider > Circuits, nature
« Bons de commande fournisseur ») et créé par défaut pour chaque société. Réponse d'EGUITRA GROUP du
2 novembre 2026 : le bon est émis par le responsable Achats et Contrats, contrôlé par le chef comptable ou le
DAF (une seule étape, l'un ou l'autre), approuvé par la direction générale au-delà de 10 000 000 GNF HT ;
réponse du 3 novembre : la direction générale est aussi l'approbateur final des bons de 10 000 000 GNF HT ou
moins.
Circuit par défaut :
1. Contrôle : chef comptable ou DAF (profil finance), dès le premier franc ;
2. Approbation : direction générale, en deux règles de même niveau et de plages disjointes, dont une seule
   s'applique à un montant donné, pour que l'administration puisse changer le profil ou le plafond de l'une
   sans toucher l'autre (Circuits, sans développement) :
   - jusqu'à 10 000 000 GNF HT inclus ;
   - plus de 10 000 000 GNF HT (strictement au-delà).
Une société sans aucune règle de cette nature garde le circuit des engagements de dépense (comportement
antérieur).

Séparation des responsabilités, comme pour toute demande : celui qui a saisi le bon, celui qui le soumet et le
demandeur de l'engagement d'où il vient n'en tranchent aucune étape, et un même compte ne tranche qu'une étape
d'une même demande. Les étapes d'une demande sont figées à sa soumission (libellé, profil) : changer le circuit
ne modifie pas les demandes déjà ouvertes.
"""

from odoo import api, fields, models

from odoo.addons.eguitra_approval.models.approval import APPROVER_PROFILES

PURCHASE_ORDER = "purchase.order"
PO_DOCUMENT = "purchase_order"
PO_DIRECTION_THRESHOLD = 10_000_000
PURCHASE_ORDER_RULES = [
    {"document": PO_DOCUMENT, "sequence": 1, "min_amount": 0, "max_amount": 0, "approver_profile": "finance",
     "name": "Contrôle : chef comptable ou DAF"},
    {"document": PO_DOCUMENT, "sequence": 2, "min_amount": 0, "max_amount": PO_DIRECTION_THRESHOLD,
     "approver_profile": "direction",
     "name": "Approbation : direction générale (jusqu'à 10 M GNF HT)"},
    {"document": PO_DOCUMENT, "sequence": 2, "min_amount": PO_DIRECTION_THRESHOLD, "max_amount": 0,
     "approver_profile": "direction", "name": "Approbation : direction générale (plus de 10 M GNF HT)"},
]
# Circuit par défaut de la version 19.0.1.1.0 (contrôle, validation, direction au-delà de 10 M), remplacé par la
# migration 19.0.1.1.1 là où l'administration ne l'a pas modifié.
PURCHASE_ORDER_RULES_V1 = [
    {"document": PO_DOCUMENT, "sequence": 1, "min_amount": 0, "approver_profile": "finance",
     "name": "Contrôle : conformité, budget et pièces (comptabilité)"},
    {"document": PO_DOCUMENT, "sequence": 2, "min_amount": 0, "approver_profile": "finance",
     "name": "Validation : direction administrative et financière"},
    {"document": PO_DOCUMENT, "sequence": 3, "min_amount": PO_DIRECTION_THRESHOLD, "approver_profile": "direction",
     "name": "Approbation : direction générale (plus de 10 M GNF HT)"},
]
REPLACED_PREFIX = "Ancien circuit, remplacé le 2 novembre 2026 : "
# Libellé de la règle « jusqu'à 10 M » de la version 19.0.1.1.1, quand son niveau restait à définir.
PO_SMALL_RULE_NAME_V2 = ("Approbation : direction générale (jusqu'à 10 M GNF HT, niveau à définir avec la direction "
                         "générale)")


def ensure_purchase_order_rules(env, companies=None):
    """Circuit par défaut des bons de commande pour chaque société qui n'a aucune règle de cette nature (même
    inactive : un circuit désactivé par l'administration n'est pas recréé). Idempotent."""
    Rule = env["eguitra.approval.rule"].sudo().with_context(active_test=False)
    for company in companies if companies is not None else env["res.company"].sudo().search([]):
        if not Rule.search_count([("company_id", "=", company.id), ("document", "=", PO_DOCUMENT)]):
            for values in PURCHASE_ORDER_RULES:
                Rule.create(dict(values, company_id=company.id))


def _rule_key(rule):
    return (rule.sequence, rule.name, rule.approver_profile, float(rule.min_amount or 0),
            float(rule.max_amount or 0), rule.account_prefix or "", bool(rule.active))


def _default_keys(rules):
    return sorted((v["sequence"], v["name"], v["approver_profile"], float(v.get("min_amount") or 0),
                   float(v.get("max_amount") or 0), "", True) for v in rules)


def upgrade_purchase_order_rules(env, companies=None):
    """Remplace l'ancien circuit par défaut (PURCHASE_ORDER_RULES_V1) par le nouveau, société par société, là où
    il est resté exactement tel quel (trois règles, mêmes noms, profils, montants, actives, sans préfixe de
    compte). Les anciennes règles sont archivées et renommées, jamais supprimées : les étapes des demandes déjà
    ouvertes y restent rattachées et gardent leur libellé et leur profil. Une société dont l'administration a
    modifié le circuit n'est pas touchée. Idempotent. Rend (sociétés mises à jour, sociétés laissées)."""
    Rule = env["eguitra.approval.rule"].sudo().with_context(active_test=False)
    Company = env["res.company"].sudo()
    replaced, kept = Company.browse(), Company.browse()
    for company in companies if companies is not None else Company.search([]):
        rules = Rule.search([("company_id", "=", company.id), ("document", "=", PO_DOCUMENT)])
        if not rules or sorted(_rule_key(r) for r in rules.filtered("active")) == _default_keys(PURCHASE_ORDER_RULES):
            continue  # sans circuit (créé ensuite par ensure_purchase_order_rules) ou déjà à jour
        if sorted(_rule_key(r) for r in rules) != _default_keys(PURCHASE_ORDER_RULES_V1):
            kept |= company
            continue
        for rule in rules:
            rule.write({"active": False, "name": REPLACED_PREFIX + rule.name})
        for values in PURCHASE_ORDER_RULES:
            Rule.create(dict(values, company_id=company.id))
        replaced |= company
    return replaced, kept


def rename_small_purchase_order_rule(env):
    """La direction générale est l'approbateur final des bons de 10 M GNF HT ou moins (réponse d'EGUITRA GROUP du
    3 novembre 2026) : la règle « jusqu'à 10 M » perd sa mention « niveau à définir », là où son libellé est resté
    celui de la version 19.0.1.1.1. Les étapes des demandes déjà ouvertes gardent leur libellé. Idempotent ; rend
    les règles renommées."""
    rules = env["eguitra.approval.rule"].sudo().search([("document", "=", PO_DOCUMENT),
                                                         ("name", "=", PO_SMALL_RULE_NAME_V2)])
    rules.write({"name": PURCHASE_ORDER_RULES[1]["name"]})
    return rules


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
