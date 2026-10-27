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

from odoo import Command, api, fields, models
from odoo.exceptions import UserError

from odoo.addons.eguitra_approval.models.account_move import fingerprint
from odoo.addons.eguitra_base.lettres import amount_in_words, capitalize

from .documents import company_block, partner_block, report_css_and_accent, rows_of, totals_of
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


class PurchaseOrder(models.Model):
    _inherit = "purchase.order"

    eguitra_object = fields.Char("Objet de la commande")
    eguitra_conditions = fields.Text("Conditions", help="Délai, lieu de livraison ou d'exécution, modalités.")
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

    # ─── Circuit d'approbation (moteur eguitra_approval) ──────────────────

    def _eguitra_fingerprint(self):
        """Fournisseur, devise, engagement et lignes (article, libellé, quantité, prix, remise, taxes, compte,
        analytique) : ce que l'approbateur a vu."""
        self.ensure_one()
        lines = sorted(
            [line.product_id.id, line.name or "", round(line.product_qty, 4), round(line.price_unit, 2),
             round(line.discount or 0.0, 2), sorted(line.tax_ids.ids), line.eguitra_account_id.id,
             json.dumps(line.analytic_distribution or {}, sort_keys=True)]
            for line in self._eguitra_product_lines()
        )
        return fingerprint(["purchase_order", self.partner_id.id, self.currency_id.id, self.eguitra_commitment_id.id,
                            round(self.amount_untaxed, 2), lines])

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
        others = commitment.eguitra_purchase_order_ids.filtered(lambda o: o != self and o.state != "cancel")
        allowed = commitment.amount * (1 + commitment.tolerance_pct() / 100)
        return sum(others.mapped("amount_untaxed")) + self.amount_untaxed <= allowed + 0.5

    def _eguitra_required_rules(self):
        self.ensure_one()
        Rule = self.env["eguitra.approval.rule"]
        if self._eguitra_commitment_covers():
            return Rule
        return Rule._applicable("commitment", self.company_id, self.amount_untaxed, self._eguitra_account_codes())

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
        self._eguitra_check_submittable()
        Request = self.env["eguitra.approval.request"]
        for order in self:
            rules = order._eguitra_required_rules()
            if not rules:
                order._eguitra_approve()
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
            "steps": [{"label": s.label, "profile": labels.get(s.profile), "state": s.state,
                       "decided_by": s.decided_by.name or None, "decided_at": s.decided_at}
                      for s in request.step_ids.sorted("sequence")],
        }

    # ─── Cycle de vie ─────────────────────────────────────────────────────

    def action_eguitra_cancel(self, reason=None):
        """Annulation : sans réception enregistrée ni pièce d'achat validée ; la demande en cours est annulée."""
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
        return True

    def action_eguitra_mark_sent(self, emailed_to=None):
        for order in self:
            if order.state != "purchase":
                raise UserError(f"Seul un bon de commande approuvé s'envoie au fournisseur ({order.name}).")
            values = {"eguitra_sent_at": fields.Datetime.now(), "eguitra_sent_by": self.env.user.id}
            if emailed_to:
                values["eguitra_emailed_to"] = emailed_to
            order._eguitra_quiet().write(values)
        return True

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
            references.append(("Référence fournisseur", self.partner_ref))
        if self.date_planned:
            references.append(("Livraison prévue", f"{self.date_planned:%d/%m/%Y}"))
        banner = None
        if self.state in ("draft", "sent", "to approve"):
            banner = "BROUILLON : bon de commande non approuvé, à ne pas transmettre au fournisseur."
        elif self.state == "cancel":
            banner = "BON DE COMMANDE ANNULÉ : il ne doit pas être exécuté."
        request = self._eguitra_last_request()
        approvers = []
        if request and request.state == "approved":
            approvers = [f"{s.decided_by.name} ({s.label})" for s in request.step_ids.sorted("sequence")
                         if s.state == "approved" and s.decided_by]
        return {
            "accent": accent, "css": css, "banner": banner, "title": "BON DE COMMANDE", "number": self.name,
            "status": {"to_approve": "En approbation", "draft": "Brouillon", "rejected": "Refusé"}.get(self.eguitra_status),
            "place_date": f"{company.city}, le {day:%d/%m/%Y}" if company.city else f"Date : {day:%d/%m/%Y}",
            "company_name": company.name, "company_lines": company_block(company),
            "party_label": "FOURNISSEUR", "party": partner_block(self.partner_id, company),
            "references": references, "object": (self.eguitra_object or "").strip() or None,
            "rows": rows, "show_unit": show_unit, "show_discount": show_discount,
            "price_label": f"PU HT ({self.currency_id.name})", "amount_label": f"Montant HT ({self.currency_id.name})",
            "totals": totals_of(self, main_label="TOTAL TTC"),
            "words_intro": "Arrêté le présent bon de commande à la somme de :",
            "words": capitalize(amount_in_words(self.amount_total, self.currency_id)),
            "terms": {"conditions": (self.eguitra_conditions or "").strip() or None,
                      "term": self.payment_term_id.name or None, "validity": None},
            "terms_title": "CONDITIONS DE LA COMMANDE",
            "approvers": approvers,
            "signatory": "Pour la société, la Direction",
        }


class PurchaseOrderLine(models.Model):
    _inherit = "purchase.order.line"

    eguitra_expense_category_id = fields.Many2one("eguitra.expense.category", "Catégorie de dépense",
                                                  index="btree_not_null")
    eguitra_account_id = fields.Many2one("account.account", "Compte de charge",
                                         help="Compte de la ligne (catégorie, engagement) ; sinon celui de l'article.")
    eguitra_receipt_line_ids = fields.One2many("eguitra.commerce.receipt.line", "purchase_line_id", "Réceptions")

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
