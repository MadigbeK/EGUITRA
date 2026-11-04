"""Bons de commande fournisseur, sur les commandes d'achat du noyau (module purchase, sans stock).

Un bon de commande naît d'un engagement de dépense approuvé (eguitra_approval) ou directement. Soumis, il
passe par le moteur d'approbation de la plateforme, avec les règles des engagements (mêmes seuils, mêmes
profils approbateurs, quatre yeux : celui qui l'a saisi, celui qui le soumet et le demandeur de son
engagement n'en tranchent aucune étape) ; un bon de commande couvert par son engagement approuvé (même
fournisseur, montant hors taxes dans l'engagement augmenté de sa tolérance) est approuvé d'office. La
demande garde l'empreinte du bon soumis : modifié ensuite, il doit être soumis à nouveau.

États de la plateforme (eguitra_status) : brouillon, refusé, en approbation, approuvé, envoyé, reçu
partiellement, reçu, facturé, annulé. La réception (service fait) se constate par des réceptions datées,
signées et justifiées (receipt.py) ; la pièce d'achat se rattache à la commande et se rapproche de la
commande et de la réception (account_move.py).
"""

import json
from datetime import date

import pytz

from odoo import Command, api, fields, models
from odoo.exceptions import AccessError, UserError

from odoo.addons.eguitra_approval.models.account_move import fingerprint
from odoo.addons.eguitra_base.lettres import amount_in_words, capitalize, money

from .documents import company_block, partner_block, report_css_and_accent, rows_of
from .sale_order import QUIET

STATUS = [
    ("draft", "Brouillon"),
    ("rejected", "Refusé"),
    ("to_approve", "En approbation"),
    ("approved", "Approuvé"),
    ("sent", "Envoyé"),
    ("partial", "Reçu partiellement"),
    ("received", "Reçu"),
    ("invoiced", "Facturé"),
    ("cancelled", "Annulé"),
]
EPSILON = 1e-6
QUOTE_KINDS = [("quote", "Devis"), ("proforma", "Facture proforma")]
CONAKRY = pytz.timezone("Africa/Conakry")
# Champs clés suivis par l'historique du bon (les lignes le sont à part : nombre et montant hors taxes).
TRACKED = {
    "partner_id": "Fournisseur", "eguitra_object": "Objet", "partner_ref": "Référence du devis ou de la proforma",
    "eguitra_quote_kind": "Nature de la pièce du fournisseur", "eguitra_quote_date": "Date du devis ou de la proforma",
    "payment_term_id": "Conditions de paiement", "eguitra_payment_note": "Précision sur le règlement",
    "date_planned": "Livraison prévue", "eguitra_delivery_days": "Délai de livraison (jours)",
    "eguitra_delivery_place": "Lieu de livraison", "eguitra_conditions": "Autres conditions",
    "eguitra_tax_exemption": "Mention d'exonération de TVA",
}
DECISIONS = {"approved": "Approuvé", "rejected": "Refusé", "pending": "En attente", "skipped": "Sans objet"}
# Profils approbateurs, tels qu'imprimés quand le compte n'a pas de fonction sur sa fiche.
PROFILE_TITLES = {"finance": "Finance et comptabilité", "direction": "Direction générale", "admin": "Administration"}
# Émission réservée au service Achats (res.company.eguitra_po_issue_reserved).
ISSUE_RESERVED = "L'émission des bons de commande est réservée au service Achats (Responsable Achats et Contrats)."
DRAFT_STATES = ("draft", "sent")
PRE_APPROVAL = ("draft", "sent", "to approve")
# Champs d'un brouillon que seul l'émetteur modifie (ceux de l'écran, lignes comprises).
ISSUE_FIELDS = set(TRACKED) | {"order_line", "eguitra_commitment_id", "currency_id", "fiscal_position_id"}
ISSUE_LINE_FIELDS = {"product_id", "name", "product_qty", "price_unit", "discount", "tax_ids", "product_uom_id",
                     "eguitra_account_id", "eguitra_expense_category_id", "analytic_distribution", "display_type"}


def conakry(moment):
    """Date et heure de Conakry (UTC+0, sans heure d'été), « 02/11/2026 à 14:05 »."""
    if not moment:
        return None
    return pytz.utc.localize(moment).astimezone(CONAKRY).strftime("%d/%m/%Y à %H:%M")


def company_address(company):
    """Adresse de la société, lieu de livraison par défaut."""
    return ", ".join(p for p in (company.street, company.street2, company.city) if p) or company.name


def _shown(value):
    """Valeur d'un champ suivi, lisible dans l'historique."""
    if hasattr(value, "_name"):
        return value.display_name or "–"
    if value in (False, None, ""):
        return "–"
    if isinstance(value, date):  # date ou date et heure
        return f"{value:%d/%m/%Y}"
    return str(value)


class PurchaseOrder(models.Model):
    _inherit = "purchase.order"

    eguitra_object = fields.Char("Objet de la commande")
    eguitra_conditions = fields.Text("Autres conditions", help="Modalités, garanties, pénalités… imprimées au bas du bon.")
    # Pièce du fournisseur à l'origine du bon : sa référence est celle du noyau (partner_ref).
    eguitra_quote_kind = fields.Selection(QUOTE_KINDS, "Nature de la pièce du fournisseur", default="quote")
    eguitra_quote_date = fields.Date("Date du devis ou de la proforma")
    eguitra_payment_note = fields.Char("Précision sur le règlement",
                                       help="Par exemple : 30 % à la commande, solde à la livraison, par virement.")
    eguitra_delivery_days = fields.Integer("Délai de livraison (jours)")
    eguitra_delivery_place = fields.Char("Lieu de livraison", help="Par défaut, l'adresse de la société.")
    eguitra_tax_exemption = fields.Char("Mention d'exonération de TVA",
                                        help="Imprimée sous les totaux, par exemple la référence d'une exonération.")
    eguitra_document_ids = fields.One2many("eguitra.commerce.purchase.document", "order_id", "Pièces jointes")
    eguitra_event_ids = fields.One2many("eguitra.commerce.purchase.event", "order_id", "Historique")
    eguitra_commitment_id = fields.Many2one("eguitra.commitment", "Engagement de dépense", index="btree_not_null",
                                            copy=False)
    eguitra_status = fields.Selection(STATUS, "État du bon de commande", compute="_compute_eguitra_status",
                                      store=True, index=True)
    eguitra_rejected = fields.Boolean("Refusé par le circuit", copy=False, readonly=True)
    eguitra_sent_at = fields.Datetime("Envoyé le", copy=False, readonly=True)
    eguitra_sent_by = fields.Many2one("res.users", "Envoyé par", copy=False, readonly=True)
    eguitra_emailed_to = fields.Char("Envoyé à", copy=False, readonly=True)
    eguitra_receipt_ids = fields.One2many("eguitra.commerce.receipt", "purchase_order_id", "Réceptions")
    eguitra_bill_ids = fields.One2many("account.move", "eguitra_purchase_order_id", "Pièces d'achat")

    @api.depends("state", "eguitra_rejected", "eguitra_sent_at", "order_line.product_qty", "order_line.qty_received",
                 "order_line.qty_invoiced", "order_line.display_type")
    def _compute_eguitra_status(self):
        for order in self:
            lines = order.order_line.filtered(lambda l: not l.display_type)
            if order.state == "cancel":
                order.eguitra_status = "cancelled"
            elif order.state == "to approve":
                order.eguitra_status = "to_approve"
            elif order.state in ("draft", "sent"):
                order.eguitra_status = "rejected" if order.eguitra_rejected else "draft"
            elif lines and all(l.qty_invoiced >= l.product_qty - EPSILON for l in lines):
                order.eguitra_status = "invoiced"
            elif lines and all(l.qty_received >= l.product_qty - EPSILON for l in lines):
                order.eguitra_status = "received"
            elif any(l.qty_received > EPSILON for l in lines):
                order.eguitra_status = "partial"
            else:
                order.eguitra_status = "sent" if order.eguitra_sent_at else "approved"

    def _eguitra_quiet(self):
        return self.with_context(**QUIET)

    def _eguitra_product_lines(self):
        return self.order_line.filtered(lambda l: not l.display_type)

    # ─── Émission réservée au service Achats (réglage de la société) ──────

    def _eguitra_check_issuer(self, companies=None):
        """Émission (création, modification d'un brouillon, soumission, annulation avant approbation) : refusée au
        compte qui n'est pas du service Achats quand la société la lui réserve. Contrôle du modèle : aucun chemin
        (route, engagement, duplication, action groupée) ne le contourne ; seul le compte du système y échappe."""
        user = self.env.user
        for company in companies if companies is not None else self.company_id:
            if not company._eguitra_can_issue_purchase_orders(user):
                raise AccessError(ISSUE_RESERVED)

    def _eguitra_pre_approval(self):
        """Bons pas encore approuvés : brouillons, refusés, en approbation."""
        return self.filtered(lambda o: o.state in PRE_APPROVAL)

    # ─── Création, historique, devis repris de l'engagement ───────────────

    @api.model_create_multi
    def create(self, vals_list):
        Company = self.env["res.company"]
        companies = Company.browse(list({vals.get("company_id") or self.env.company.id for vals in vals_list}))
        self._eguitra_check_issuer(companies.sudo())
        for vals in vals_list:
            if not vals.get("eguitra_delivery_place"):
                company = Company.browse(vals["company_id"]) if vals.get("company_id") else self.env.company
                vals["eguitra_delivery_place"] = company_address(company)
        orders = super().create(vals_list)
        orders._eguitra_take_selected_quote()
        return orders

    def _eguitra_lines_state(self):
        """(clé, texte) des lignes chiffrées : la clé change dès qu'une ligne change, le texte se lit."""
        self.ensure_one()
        key = sorted([line.name or "", round(line.product_qty, 4), round(line.price_unit, 2), round(line.discount or 0.0, 2),
                      sorted(line.tax_ids.ids)] for line in self._eguitra_product_lines())
        count = len(key)
        text = (f"{count} ligne{'s' if count > 1 else ''}, "
                f"{money(self.amount_untaxed, self.currency_id.name, self.currency_id.decimal_places)} HT, "
                f"{money(self.amount_total, self.currency_id.name, self.currency_id.decimal_places)} TTC")
        return json.dumps(key, default=str), text

    def write(self, vals):
        if set(vals) & ISSUE_FIELDS:
            self.filtered(lambda o: o.state in DRAFT_STATES)._eguitra_check_issuer()
        tracked = [name for name in TRACKED if name in vals]
        lines = "order_line" in vals
        if self.env.context.get("eguitra_no_history") or not (tracked or lines):
            return super().write(vals)
        before = {order.id: ({name: _shown(order[name]) for name in tracked}, order._eguitra_lines_state())
                  for order in self}
        result = super().write(vals)
        for order in self:
            old, (old_key, old_text) = before[order.id]
            changes = [f"{TRACKED[name]} : {old[name]} → {_shown(order[name])}" for name in tracked
                       if _shown(order[name]) != old[name]]
            if lines:
                key, text = order._eguitra_lines_state()
                if key != old_key:
                    changes.append(f"Lignes : {old_text} → {text}")
            if changes:
                order._eguitra_log("modified", "Bon de commande modifié", "\n".join(changes))
        return result

    def _eguitra_log(self, kind, summary, detail=None):
        """Action écrite à l'historique du bon (sans modification ni suppression possible)."""
        Event = self.env["eguitra.commerce.purchase.event"].sudo()
        for order in self:
            Event.create({"order_id": order.id, "kind": kind, "summary": (summary or "")[:250] or kind,
                          "detail": detail or False, "user_id": self.env.user.id})

    def _eguitra_take_selected_quote(self):
        """Bon issu d'un engagement dont un devis a été retenu (même fournisseur) : sa référence, sa date et sa
        pièce sont reprises d'office, la pièce copiée dans les pièces jointes du bon."""
        Document = self.env["eguitra.commerce.purchase.document"].sudo()
        for order in self:
            commitment = order.eguitra_commitment_id.sudo()
            quote = commitment.eguitra_quote_ids.filtered("selected")[:1]
            if not quote or quote.partner_id.commercial_partner_id != order.partner_id.commercial_partner_id:
                continue
            values = {}
            if not order.partner_ref and quote.reference:
                values["partner_ref"] = quote.reference
            if not order.eguitra_quote_date and quote.date:
                values["eguitra_quote_date"] = quote.date
            if values:
                values["eguitra_quote_kind"] = "quote"
                order.with_context(eguitra_no_history=True)._eguitra_quiet().write(values)
            if quote.attachment_id and not order.eguitra_document_ids.filtered(lambda d: d.category in ("quote", "proforma")):
                attachment = quote.attachment_id.sudo().copy({"res_model": order._name, "res_id": order.id})
                Document.create({"order_id": order.id, "category": "quote", "name": attachment.name or "devis",
                                 "attachment_id": attachment.id,
                                 "origin": f"Devis retenu de l'engagement {commitment.name}"})

    # ─── Circuit d'approbation (moteur eguitra_approval) ──────────────────

    def _eguitra_fingerprint(self):
        """Fournisseur, devise, engagement, pièce du fournisseur (nature, référence, date), conditions (paiement,
        livraison, autres, exonération) et lignes (article, libellé, quantité, prix, remise, taxes, compte,
        analytique) : ce que l'approbateur a vu."""
        self.ensure_one()
        lines = sorted(
            [line.product_id.id, line.name or "", round(line.product_qty, 4), round(line.price_unit, 2),
             round(line.discount or 0.0, 2), sorted(line.tax_ids.ids), line.eguitra_account_id.id,
             json.dumps(line.analytic_distribution or {}, sort_keys=True)]
            for line in self._eguitra_product_lines()
        )
        terms = [self.eguitra_quote_kind or "", self.partner_ref or "", str(self.eguitra_quote_date or ""),
                 self.payment_term_id.id, self.eguitra_payment_note or "",
                 str(self.date_planned.date()) if self.date_planned else "", self.eguitra_delivery_days or 0,
                 self.eguitra_delivery_place or "", self.eguitra_conditions or "", self.eguitra_tax_exemption or ""]
        return fingerprint(["purchase_order", self.partner_id.id, self.currency_id.id, self.eguitra_commitment_id.id,
                            round(self.amount_untaxed, 2), lines, terms])

    def _eguitra_account_codes(self):
        """Comptes de charge des lignes ; None quand l'un manque (les règles réservées à un préfixe de compte
        s'appliquent alors aussi, comme pour un engagement au compte à préciser)."""
        self.ensure_one()
        codes = []
        for line in self._eguitra_product_lines():
            account = line._eguitra_expense_account()
            if not account.code:
                return None
            codes.append(account.code)
        return codes

    def _eguitra_commitment_covers(self):
        """Le bon de commande reste-t-il dans son engagement approuvé (même société, même fournisseur, total
        hors taxes des bons de l'engagement dans son montant augmenté de la tolérance) ?"""
        self.ensure_one()
        commitment = self.eguitra_commitment_id.sudo()
        if not commitment or commitment.state != "approved" or commitment.company_id != self.company_id:
            return False
        if commitment.partner_id.commercial_partner_id != self.partner_id.commercial_partner_id:
            return False
        allowed = commitment.amount * (1 + commitment.tolerance_pct() / 100)
        return commitment._eguitra_engaged(order=self) + self.amount_untaxed <= allowed + 0.5

    def _eguitra_required_rules(self):
        self.ensure_one()
        Rule = self.env["eguitra.approval.rule"]
        if self._eguitra_commitment_covers():
            return Rule
        return Rule._applicable(Rule._eguitra_po_document(self.company_id), self.company_id, self.amount_untaxed,
                                self._eguitra_account_codes())

    def _eguitra_circuit_preview(self):
        """Circuit prévu pour le bon tel qu'il est (étapes, profil attendu, seuils), avant sa soumission."""
        self.ensure_one()
        covered = self._eguitra_commitment_covers()
        preview = self.env["eguitra.approval.rule"]._eguitra_po_circuit(
            self.company_id, self.amount_untaxed, self._eguitra_account_codes())
        if covered:
            preview["covered"] = True
            for rule in preview["rules"]:
                rule["applies"] = False
        return preview

    def _eguitra_last_request(self):
        self.ensure_one()
        return self.env["eguitra.approval.request"].sudo().search(
            [("res_model", "=", self._name), ("res_id", "=", self.id), ("state", "!=", "cancelled")],
            order="id desc", limit=1,
        )

    def _eguitra_check_submittable(self):
        for order in self:
            if order.state not in ("draft", "sent"):
                raise UserError(f"Le bon de commande {order.name} a déjà été soumis.")
            lines = order._eguitra_product_lines()
            if not lines:
                raise UserError(f"Le bon de commande {order.name} n'a aucune ligne.")
            if any(line.product_qty <= 0 or line.price_unit < 0 for line in lines):
                raise UserError("Chaque ligne a une quantité positive et un prix qui n'est pas négatif.")
            if order.amount_untaxed <= 0:
                raise UserError("Le montant du bon de commande doit être positif.")

    def action_eguitra_submit(self):
        """Soumission : circuit d'approbation, ou approbation d'office dans la limite de l'engagement approuvé."""
        self._eguitra_check_issuer()
        self._eguitra_check_submittable()
        Request = self.env["eguitra.approval.request"]
        for order in self:
            rules = order._eguitra_required_rules()
            if not rules:
                order._eguitra_approve()
                commitment = order.eguitra_commitment_id.sudo()
                order._eguitra_log("approved_auto", "Approuvé d'office" + (
                    f" : dans la limite de l'engagement approuvé {commitment.name}" if commitment else
                    " : aucune règle du circuit ne s'applique à ce montant"))
                continue
            request = Request._open(order, "commitment", rules, order.amount_untaxed, order.partner_id)
            request.sudo().write({"document": "purchase_order",
                                  "name": f"Bon de commande fournisseur : {order.name} ({order.partner_id.name})"})
            order._eguitra_quiet().write({"state": "to approve", "eguitra_rejected": False})
        return True

    def _eguitra_approve(self):
        orders = self._eguitra_quiet()
        orders.button_approve()
        # Validation en une étape dans le noyau (réglage posé à l'installation) ; à défaut, le circuit de la
        # plateforme a tranché : la commande est approuvée.
        orders.filtered(lambda o: o.state != "purchase").write({"state": "purchase", "date_approve": fields.Datetime.now()})
        orders.write({"eguitra_rejected": False})

    def _eguitra_on_approved(self):
        self.filtered(lambda o: o.state == "to approve")._eguitra_approve()

    def _eguitra_on_rejected(self):
        self.filtered(lambda o: o.state == "to approve")._eguitra_quiet().write(
            {"state": "draft", "eguitra_rejected": True})

    def _eguitra_approval_info(self):
        self.ensure_one()
        request = self._eguitra_last_request()
        if not request:
            return None
        step = request.current_step_id
        labels = dict(request._fields["pending_profile"].selection)
        refusal = request.step_ids.filtered(lambda s: s.state == "rejected")[:1] if request.state == "rejected" else None
        return {
            "request_id": request.id, "state": request.state,
            "pending_with": labels.get(step.profile) if step and request.state == "pending" else None,
            "rejected_by": refusal.decided_by.name if refusal else None,
            "rejected_reason": (refusal.comment or None) if refusal else None,
            "requested_by": request.requested_by.name, "requested_at": request.requested_at,
            "fingerprint": (request.fingerprint or "")[:16] or None,
            "steps": [{"sequence": s.sequence, "label": s.label, "profile": labels.get(s.profile), "state": s.state,
                       "decided_by": s.decided_by.name or None, "decided_at": s.decided_at,
                       "comment": s.comment or None,
                       "min_amount": s.rule_id.min_amount if s.rule_id else None}
                      for s in request.step_ids.sorted("sequence")],
        }

    def _eguitra_signer_title(self, user, profile):
        """Fonction imprimée d'un approbateur : celle de sa fiche, sinon son profil approbateur."""
        return user.sudo().partner_id.function or PROFILE_TITLES.get(profile) or ""

    # ─── Cycle de vie ─────────────────────────────────────────────────────

    def action_eguitra_cancel(self, reason=None):
        """Annulation : sans réception enregistrée ni pièce d'achat validée ; la demande en cours est annulée. Avant
        l'approbation, elle relève de l'émetteur (service Achats, si la société le lui réserve)."""
        self._eguitra_pre_approval()._eguitra_check_issuer()
        for order in self:
            if order.eguitra_receipt_ids.filtered(lambda r: r.state == "done"):
                raise UserError(f"Le bon de commande {order.name} a des réceptions : annulez-les d'abord.")
            if order.eguitra_bill_ids.filtered(lambda m: m.state not in ("draft", "cancel")) or \
                    order.invoice_ids.filtered(lambda m: m.state not in ("draft", "cancel")):
                raise UserError(f"Le bon de commande {order.name} a des pièces d'achat validées.")
            request = order._eguitra_last_request()
            if request.state == "pending":
                request.sudo().state = "cancelled"
            (order.eguitra_bill_ids | order.invoice_ids).filtered(lambda m: m.state == "draft").button_cancel()
            if order.locked:
                order.button_unlock()
        self._eguitra_quiet().button_cancel()
        self._eguitra_log("cancelled", "Bon de commande annulé", (reason or "").strip() or None)
        return True

    def action_eguitra_mark_sent(self, emailed_to=None):
        for order in self:
            if order.state != "purchase":
                raise UserError(f"Seul un bon de commande approuvé s'envoie au fournisseur ({order.name}).")
            values = {"eguitra_sent_at": fields.Datetime.now(), "eguitra_sent_by": self.env.user.id}
            if emailed_to:
                values["eguitra_emailed_to"] = emailed_to
            order._eguitra_quiet().write(values)
            order._eguitra_log("sent", f"Envoyé au fournisseur par courriel à {emailed_to}" if emailed_to else
                               "Marqué envoyé au fournisseur (remis en main propre ou imprimé)")
        return True

    # ─── Historique ───────────────────────────────────────────────────────

    def _eguitra_history(self):
        """Historique du bon, du plus ancien au plus récent : création ; actions écrites à l'historique
        (modifications, approbation d'office, envoi, annulation, pièces jointes) ; soumissions et décisions du
        circuit (moteur d'approbation) ; réceptions et leurs annulations ; pièces d'achat rattachées."""
        self.ensure_one()
        order = self.sudo()
        labels = dict(self.env["eguitra.commerce.purchase.event"]._fields["kind"].selection)
        currency = order.currency_id
        events = []

        def add(moment, kind, user, summary, detail=None):
            if moment:
                events.append({"date": moment, "date_label": conakry(moment), "kind": kind, "label": labels.get(kind, kind),
                               "user": user.name if user else None, "summary": summary, "detail": detail or None})

        add(order.create_date, "created", order.create_uid, f"Bon de commande {order.name} créé")
        for event in order.eguitra_event_ids:
            add(event.date, event.kind, event.user_id, event.summary, event.detail)
        requests = self.env["eguitra.approval.request"].sudo().search(
            [("res_model", "=", order._name), ("res_id", "=", order.id)], order="id")
        for request in requests:
            steps = request.step_ids.sorted("sequence")
            add(request.requested_at, "submitted", request.requested_by,
                f"Soumis au circuit d'approbation (demande n° {request.id}, "
                f"{money(request.amount, currency.name, currency.decimal_places)} HT)",
                "Étapes prévues : " + " ; ".join(s.label for s in steps) if steps else None)
            for step in steps.filtered(lambda s: s.state in ("approved", "rejected")):
                add(step.decided_at, step.state, step.decided_by,
                    f"{DECISIONS[step.state]} : {step.label}", step.comment)
        if order.eguitra_sent_at and not order.eguitra_event_ids.filtered(lambda e: e.kind == "sent"):
            add(order.eguitra_sent_at, "sent", order.eguitra_sent_by, "Envoyé au fournisseur" + (
                f" par courriel à {order.eguitra_emailed_to}" if order.eguitra_emailed_to else ""))
        for receipt in order.eguitra_receipt_ids.sorted("id"):
            quantities = " ; ".join(f"{line.quantity:g} {line.product_uom_id.name or ''} {line.purchase_line_id.name}".strip()
                                    for line in receipt.line_ids)
            add(receipt.create_date, "received", receipt.received_by,
                f"Réception {receipt.name} du {receipt.date:%d/%m/%Y}", quantities or receipt.note)
            if receipt.state == "cancelled":
                add(receipt.cancelled_at, "receipt_cancelled", receipt.cancelled_by, f"Réception {receipt.name} annulée",
                    receipt.cancel_reason)
        for move in (order.eguitra_bill_ids | order.invoice_ids).sorted("id"):
            name = move.name if move.name and move.name != "/" else "en brouillon"
            add(move.create_date, "billed", move.create_uid,
                f"Pièce d'achat {name}" + (f" (facture du fournisseur {move.ref})" if move.ref else ""),
                f"{money(move.amount_untaxed, currency.name, currency.decimal_places)} HT, "
                f"{money(move.amount_total, currency.name, currency.decimal_places)} TTC")
        events.sort(key=lambda e: e["date"])
        return events

    # ─── Réception et pièce d'achat ───────────────────────────────────────

    def eguitra_receive(self, quantities, date=None, note=None, received_by=None):
        """Réception (service fait) : {ligne de commande : quantité reçue}. Rend la réception enregistrée."""
        self.ensure_one()
        if self.state != "purchase":
            raise UserError("Seul un bon de commande approuvé se réceptionne.")
        tolerance = (self.company_id.eguitra_match_qty_tolerance or 0.0) / 100
        commands = []
        for line, qty in quantities.items():
            if line.order_id != self or line.display_type:
                raise UserError("Ligne étrangère au bon de commande.")
            if qty < 0:
                raise UserError("Une quantité reçue n'est pas négative.")
            if not qty:
                continue
            if line.qty_received + qty > line.product_qty * (1 + tolerance) + EPSILON:
                raise UserError(f"« {line.name} » : {qty:g} reçus en plus des {line.qty_received:g} déjà reçus dépassent "
                                f"les {line.product_qty:g} commandés. Faites modifier la commande.")
            commands.append(Command.create({"purchase_line_id": line.id, "quantity": qty}))
        if not commands:
            raise UserError("Indiquez au moins une quantité reçue.")
        receipt = self.env["eguitra.commerce.receipt"].create({
            "purchase_order_id": self.id, "date": date or fields.Date.context_today(self), "note": note or False,
            "received_by": (received_by or self.env.user).id, "line_ids": commands,
        })
        receipt.line_ids.purchase_line_id._eguitra_sync_received()
        return receipt

    def eguitra_create_bill(self, ref=None, invoice_date=None, quantities=None, prices=None):
        """Pièce d'achat du fournisseur rattachée à la commande, en brouillon : par défaut les quantités reçues et
        pas encore facturées, au prix commandé. quantities, prices : {ligne de commande : valeur} facturées par
        le fournisseur (le rapprochement en lit l'écart). Rend la pièce."""
        self.ensure_one()
        if self.state != "purchase":
            raise UserError("Seul un bon de commande approuvé reçoit la pièce d'achat du fournisseur.")
        quantities, prices = quantities or {}, prices or {}
        commands = []
        for line in self._eguitra_product_lines():
            qty = quantities[line] if line in quantities else max(line.qty_received - line.qty_invoiced, 0.0)
            if qty <= EPSILON:
                continue
            values = line._prepare_account_move_line()
            values["quantity"] = qty
            if line in prices:
                values["price_unit"] = prices[line]
            commands.append(Command.create(values))
        if not commands:
            raise UserError("Rien à facturer : aucune quantité reçue qui ne soit déjà sur une pièce d'achat. Enregistrez "
                            "d'abord la réception.")
        commitment = self.eguitra_commitment_id.sudo()
        values = {
            "move_type": "in_invoice", "partner_id": self.partner_id.id, "company_id": self.company_id.id,
            "currency_id": self.currency_id.id, "invoice_date": invoice_date or fields.Date.context_today(self),
            "ref": ref or False, "invoice_origin": self.name, "eguitra_purchase_order_id": self.id,
            "invoice_line_ids": commands,
        }
        if self.payment_term_id:
            values["invoice_payment_term_id"] = self.payment_term_id.id
        if self.fiscal_position_id:
            values["fiscal_position_id"] = self.fiscal_position_id.id
        if commitment and commitment.state == "approved" and \
                commitment.partner_id.commercial_partner_id == self.partner_id.commercial_partner_id:
            values["eguitra_commitment_id"] = commitment.id
        return self.env["account.move"].with_context(default_move_type="in_invoice", **QUIET).create(values)

    # ─── Gabarit du bon de commande (report/report_purchase_order.xml) ────

    def _eguitra_report_values(self):
        self.ensure_one()
        company = self.company_id
        accent, css = report_css_and_accent(self.env, company)
        day = (self.date_approve or self.date_order).date() if (self.date_approve or self.date_order) else \
            fields.Date.context_today(self)
        lines = self.order_line.sorted(lambda l: (l.sequence, l.id))
        rows, show_unit, show_discount = rows_of(self.env, lines, self.currency_id, quantity="product_qty",
                                                 uom="product_uom_id")
        references = [("Bon de commande", self.name)]
        if self.eguitra_commitment_id:
            references.append(("Engagement", self.eguitra_commitment_id.name))
        if self.partner_ref:
            kind = "Facture proforma" if self.eguitra_quote_kind == "proforma" else "Devis du fournisseur"
            references.append((kind, self.partner_ref + (f" du {self.eguitra_quote_date:%d/%m/%Y}"
                                                         if self.eguitra_quote_date else "")))
        if self.date_planned:
            references.append(("Livraison prévue", f"{self.date_planned:%d/%m/%Y}"))
        banner = None
        if self.state in ("draft", "sent", "to approve"):
            banner = "BROUILLON : bon de commande non approuvé, à ne pas transmettre au fournisseur."
        elif self.state == "cancel":
            banner = "BON DE COMMANDE ANNULÉ : il ne doit pas être exécuté."
        totals, taxed = self._eguitra_report_totals()
        return {
            "accent": accent, "css": css, "banner": banner, "title": "BON DE COMMANDE", "number": self.name,
            "status": {"to_approve": "En approbation", "draft": "Brouillon", "rejected": "Refusé"}.get(self.eguitra_status),
            "place_date": f"{company.city}, le {day:%d/%m/%Y}" if company.city else f"Date : {day:%d/%m/%Y}",
            "company_name": company.name, "company_lines": company_block(company),
            "party_label": "FOURNISSEUR", "party": partner_block(self.partner_id, company),
            "references": references, "object": (self.eguitra_object or "").strip() or None,
            "rows": rows, "show_unit": show_unit, "show_discount": show_discount,
            "price_label": f"PU HT ({self.currency_id.name})", "amount_label": f"Montant HT ({self.currency_id.name})",
            "totals": totals,
            "tax_note": (self.eguitra_tax_exemption or "").strip() or None,
            "words_intro": "Arrêté le présent bon de commande, " + (
                "toutes taxes comprises" if taxed else "sans TVA") + ", à la somme de :",
            "words": capitalize(amount_in_words(self.amount_total, self.currency_id)),
            "terms": {"conditions": (self.eguitra_conditions or "").strip() or None, "conditions_label": "Autres conditions",
                      "term": None, "validity": None, "rows": self._eguitra_terms_rows()},
            "terms_title": "CONDITIONS DE LA COMMANDE",
            "approvers": [],
            "circuit": self._eguitra_report_circuit(),
            "signatory": "Pour la société, la Direction",
        }

    def _eguitra_terms_rows(self):
        """Conditions structurées imprimées : paiement, délai et lieu de livraison."""
        self.ensure_one()
        rows = []
        payment = " – ".join(p for p in (self.payment_term_id.name, (self.eguitra_payment_note or "").strip()) if p)
        if payment:
            rows.append(("Conditions de paiement", payment))
        delay = []
        if self.date_planned:
            delay.append(f"livraison prévue le {self.date_planned:%d/%m/%Y}")
        if self.eguitra_delivery_days:
            delay.append(f"{self.eguitra_delivery_days} jour{'s' if self.eguitra_delivery_days > 1 else ''} "
                         "à compter de la réception du bon")
        if delay:
            rows.append(("Délai de livraison", capitalize(", ".join(delay))))
        if (self.eguitra_delivery_place or "").strip():
            rows.append(("Lieu de livraison", self.eguitra_delivery_place.strip()))
        return rows

    def _eguitra_report_totals(self):
        """Totaux du bon : montant hors taxes, TVA par taux (groupes de taxe du noyau), part hors TVA d'un bon
        mixte, total TTC ; sans aucune TVA, « TOTAL (sans TVA) ». Rend (lignes, avec TVA)."""
        self.ensure_one()
        currency = self.currency_id

        def fmt(value):
            return money(value, currency.name, currency.decimal_places)

        lines = self._eguitra_product_lines()
        if currency.is_zero(self.amount_tax):
            return [{"label": "Montant hors taxes", "amount": fmt(self.amount_untaxed)},
                    {"label": "TOTAL (sans TVA)", "amount": fmt(self.amount_total), "main": True}], False
        untaxed_lines = lines.filtered(lambda l: currency.is_zero(l.price_tax))
        rows = []
        for index, subtotal in enumerate((self.tax_totals or {}).get("subtotals") or []):
            rows.append({"label": "Montant HT" if index == 0 else subtotal.get("name"),
                         "amount": fmt(subtotal.get("base_amount_currency", self.amount_untaxed))})
            if index == 0 and untaxed_lines and len(untaxed_lines) < len(lines):
                rows.append({"label": "dont hors TVA (exonéré ou non soumis)",
                             "amount": fmt(sum(untaxed_lines.mapped("price_subtotal")))})
            for group in subtotal.get("tax_groups") or []:
                rows.append({"label": self._eguitra_tax_group_label(group),
                             "amount": fmt(group.get("tax_amount_currency", 0.0))})
        if not rows:
            rows = [{"label": "Montant HT", "amount": fmt(self.amount_untaxed)},
                    {"label": "TVA", "amount": fmt(self.amount_tax)}]
        rows.append({"label": "TOTAL TTC", "amount": fmt(self.amount_total), "main": True})
        return rows, True

    def _eguitra_tax_group_label(self, group):
        """Libellé d'un groupe de taxe, avec son taux quand le nom du groupe ne le dit pas (« TVA (18 %) »)."""
        name = group.get("group_name") or "TVA"
        if "%" in name:
            return name
        taxes = self._eguitra_product_lines().tax_ids.filtered(lambda t: t.tax_group_id.id == group.get("id"))
        rates = sorted({t.amount for t in taxes if t.amount_type == "percent"})
        return f"{name} ({', '.join(f'{rate:g} %' for rate in rates)})" if rates else name

    def _eguitra_report_circuit(self):
        """Bloc « Circuit d'approbation » du bon imprimé : établi par, chaque étape (nom, fonction ou profil,
        décision, date et heure de Conakry, signature manuscrite déposée), preuve (numéro de la demande,
        empreinte SHA-256 du bon soumis, contrôlée de nouveau à l'impression)."""
        self.ensure_one()
        order = self.sudo()
        circuit = {"established": f"Établi par {order.create_uid.name} le {conakry(order.create_date)}"
                   if order.create_date else None, "rows": [], "proof": None, "note": None, "warning": None}
        request = order._eguitra_last_request()
        auto = order.eguitra_event_ids.filtered(lambda e: e.kind == "approved_auto")[-1:]
        if auto and (not request or auto.date >= request.requested_at):
            circuit["note"] = f"{auto.summary}, le {conakry(auto.date)}."
            return circuit
        if not request:
            return circuit
        circuit["established"] += f" ; soumis par {request.requested_by.name} le {conakry(request.requested_at)}"
        for step in request.step_ids.sorted("sequence"):
            decided = step.state in ("approved", "rejected")
            signature = step.decided_by._eguitra_signature_uri() if step.state == "approved" and step.decided_by else None
            circuit["rows"].append({
                "step": step.label, "name": step.decided_by.name if decided else "–",
                "function": self._eguitra_signer_title(step.decided_by, step.profile) if decided else
                PROFILE_TITLES.get(step.profile, ""),
                "decision": DECISIONS.get(step.state, step.state) + (f" : {step.comment}" if decided and step.comment else ""),
                "date": conakry(step.decided_at) if decided else "–", "signature": signature,
            })
        if request.fingerprint:
            circuit["proof"] = (f"Demande d'approbation n° {request.id} · empreinte SHA-256 du bon soumis : "
                                f"{request.fingerprint[:16]}…")
        circuit["note"] = ("Signature électronique simple : chaque décision est donnée par un compte authentifié de la "
                           "plateforme, horodatée et liée à l'empreinte du bon ; toute modification du bon après sa "
                           "soumission en annule l'approbation.")
        if request.state in ("pending", "approved") and not request._matches(order):
            circuit["warning"] = "Le bon a été modifié depuis sa soumission : cette approbation ne le couvre plus."
        return circuit


class PurchaseOrderLine(models.Model):
    _inherit = "purchase.order.line"

    eguitra_expense_category_id = fields.Many2one("eguitra.expense.category", "Catégorie de dépense",
                                                  index="btree_not_null")
    eguitra_account_id = fields.Many2one("account.account", "Compte de charge",
                                         help="Compte de la ligne (catégorie, engagement) ; sinon celui de l'article.")
    eguitra_receipt_line_ids = fields.One2many("eguitra.commerce.receipt.line", "purchase_line_id", "Réceptions")

    # Lignes d'un brouillon : réservées à l'émetteur, comme l'en-tête (PurchaseOrder._eguitra_check_issuer).
    @api.model_create_multi
    def create(self, vals_list):
        orders = self.env["purchase.order"].sudo().browse(list({vals["order_id"] for vals in vals_list if vals.get("order_id")}))
        orders.filtered(lambda o: o.state in DRAFT_STATES)._eguitra_check_issuer()
        return super().create(vals_list)

    def write(self, vals):
        if set(vals) & ISSUE_LINE_FIELDS:
            self.order_id.sudo().filtered(lambda o: o.state in DRAFT_STATES)._eguitra_check_issuer()
        return super().write(vals)

    def unlink(self):
        self.order_id.sudo().filtered(lambda o: o.state in DRAFT_STATES)._eguitra_check_issuer()
        return super().unlink()

    def _eguitra_expense_account(self):
        self.ensure_one()
        if self.eguitra_account_id:
            return self.eguitra_account_id
        product = self.product_id.with_company(self.order_id.company_id)
        return product.product_tmpl_id._get_product_accounts()["expense"] if product else self.env["account.account"]

    def _eguitra_sync_received(self):
        """Quantité reçue du noyau (saisie manuelle, sans stock) égale à la somme des réceptions enregistrées."""
        for line in self:
            received = sum(line.eguitra_receipt_line_ids.filtered(lambda r: r.receipt_id.state == "done").mapped("quantity"))
            line.with_context(**QUIET).qty_received = received

    def _prepare_account_move_line(self, move=False):
        values = super()._prepare_account_move_line(move)
        if self.display_type:
            return values
        account = self._eguitra_expense_account()
        if account:
            values["account_id"] = account.id
        if self.eguitra_expense_category_id:
            values["eguitra_expense_category_id"] = self.eguitra_expense_category_id.id
        if self.analytic_distribution and not values.get("analytic_distribution"):
            values["analytic_distribution"] = self.analytic_distribution
        return values
