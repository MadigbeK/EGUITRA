"""Offres commerciales et commandes des clients, sur les commandes de vente du noyau (module sale).

Une offre (sale.order en brouillon) porte sa référence propre à la société (OF/EG/2026/0001), sa date, sa
validité (15 jours par défaut, réglable par société), son objet (« Commentaire ou indication »), ses lignes
avec rubriques, notes, unités et remises, ses conditions. États de la plateforme (eguitra_status) :
brouillon, envoyée, acceptée, refusée, expirée (tâche de nuit), annulée, remplacée (par une nouvelle
version, OF/EG/2026/0001-V2). Acceptée, l'offre devient la commande du client (état « sale » du noyau) et se
facture : en totalité, par acomptes (pourcentage ou montant, déduits de la facture finale) ou par quantités
exécutées. La facture produite est une facture de la plateforme, au gabarit de la société, sa « Référence
offre » renseignée (ref = numéro de l'offre).

Offre de travaux (EGUITRA GROUP SARLU) : acceptée, elle crée le chantier ou s'y rattache, le montant du
marché étant le hors taxes de l'offre ; elle ne se facture alors que par les situations du chantier et son
avance de démarrage (chantier.py), jamais depuis la commande.

Les opérations se font sans suivi par messages du noyau (tracking_disable) : la piste d'audit de la plateforme
(auditlog) les trace, et aucun courriel ne part vers le client sans action explicite (« Envoyer par courriel »).
"""

from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import UserError

from odoo.addons.eguitra_base.lettres import amount_in_words, capitalize
from odoo.addons.eguitra_base.models.account_journal import DEFAULT_SIGNATORY

from .documents import (
    company_block,
    mail_server_ready,
    partner_block,
    report_css_and_accent,
    rows_of,
    send_mail,
    totals_of,
)

STATUS = [
    ("draft", "Brouillon"),
    ("sent", "Envoyée"),
    ("accepted", "Acceptée"),
    ("refused", "Refusée"),
    ("expired", "Expirée"),
    ("cancelled", "Annulée"),
    ("replaced", "Remplacée"),
]
CLOSE_REASONS = [("refused", "Refusée"), ("expired", "Expirée"), ("cancelled", "Annulée"), ("replaced", "Remplacée")]
INVOICE_MODES = [("order", "Quantités commandées"), ("delivered", "Quantités exécutées")]
OPEN_STATES = ("draft", "sent")
QUIET = {"tracking_disable": True, "mail_notrack": True, "mail_create_nolog": True, "mail_create_nosubscribe": True,
         "mail_auto_subscribe_no_notify": True}


def _fmt_date(day):
    return f"{day:%d/%m/%Y}" if day else ""


class SaleOrder(models.Model):
    _inherit = "sale.order"

    eguitra_object = fields.Char("Objet", help="« Commentaire ou indication » de l'offre et de ses factures.")
    eguitra_conditions = fields.Text("Conditions de l'offre", help="Délais, modalités d'exécution et de règlement.")
    eguitra_offer_date = fields.Date("Date de l'offre", default=fields.Date.context_today, copy=False)
    eguitra_status = fields.Selection(STATUS, "État de l'offre", compute="_compute_eguitra_status", store=True,
                                      index=True)
    eguitra_close_reason = fields.Selection(CLOSE_REASONS, "Motif de clôture", copy=False, readonly=True)
    eguitra_refusal_reason = fields.Text("Motif du refus", copy=False)
    eguitra_root_id = fields.Many2one("sale.order", "Première version", copy=False, index="btree_not_null")
    eguitra_previous_id = fields.Many2one("sale.order", "Version précédente", copy=False)
    eguitra_version = fields.Integer("Version", default=1, copy=False)
    eguitra_sent_at = fields.Datetime("Envoyée le", copy=False, readonly=True)
    eguitra_sent_by = fields.Many2one("res.users", "Envoyée par", copy=False, readonly=True)
    eguitra_emailed_to = fields.Char("Envoyée à", copy=False, readonly=True)
    eguitra_accepted_at = fields.Datetime("Acceptée le", copy=False, readonly=True)
    eguitra_accepted_by = fields.Many2one("res.users", "Acceptée par", copy=False, readonly=True)
    eguitra_closed_at = fields.Datetime("Close le", copy=False, readonly=True)
    eguitra_closed_by = fields.Many2one("res.users", "Close par", copy=False, readonly=True)
    eguitra_reminded_at = fields.Datetime("Relancée le", copy=False, readonly=True)
    eguitra_invoice_mode = fields.Selection(INVOICE_MODES, "Facturation", default="order", required=True,
                                            help="Quantités facturées : celles de la commande, ou celles exécutées.")
    # Offre de travaux (BTP, EGUITRA GROUP SARLU).
    eguitra_chantier_mode = fields.Boolean("Offre de travaux (chantier)")
    eguitra_chantier_id = fields.Many2one("eguitra.chantier", "Chantier", index="btree_not_null")
    eguitra_advance_rate = fields.Float("Avance de démarrage (%)")
    eguitra_retention_rate = fields.Float("Retenue de garantie (%)", default=5.0)

    @api.depends("state", "eguitra_close_reason")
    def _compute_eguitra_status(self):
        for order in self:
            if order.state == "sale":
                order.eguitra_status = "accepted"
            elif order.state == "cancel":
                order.eguitra_status = order.eguitra_close_reason or "cancelled"
            elif order.state == "sent":
                order.eguitra_status = "sent"
            else:
                order.eguitra_status = "draft"

    # ─── Outils ───────────────────────────────────────────────────────────

    def _eguitra_quiet(self):
        """Opérations sans messages ni abonnements du noyau : rien ne part vers le client sans action explicite."""
        return self.with_context(**QUIET)

    def _eguitra_root(self):
        self.ensure_one()
        return self.eguitra_root_id or self

    def _eguitra_versions(self):
        """Toutes les versions de l'offre, de la première à la dernière."""
        self.ensure_one()
        root = self._eguitra_root()
        return (root | self.sudo().search([("eguitra_root_id", "=", root.id)])).sorted("eguitra_version")

    def _eguitra_is_btp(self):
        self.ensure_one()
        return bool(self.eguitra_chantier_mode or self.eguitra_chantier_id)

    def _eguitra_validity_days(self):
        self.ensure_one()
        if not self.validity_date:
            return 0
        start = self.eguitra_offer_date or fields.Date.context_today(self)
        return max((self.validity_date - start).days, 0)

    def _eguitra_check_open(self, what):
        for order in self:
            if order.state not in OPEN_STATES:
                status = dict(STATUS).get(order.eguitra_status, order.eguitra_status)
                raise UserError(f"{what} : l'offre {order.name} est {status.lower()}, seule une offre en brouillon ou "
                                "envoyée le permet.")

    # ─── Cycle de l'offre ─────────────────────────────────────────────────

    def action_eguitra_mark_sent(self, emailed_to=None):
        """Offre remise au client (main propre, courriel) : elle passe « Envoyée »."""
        self._eguitra_check_open("Envoi")
        now = fields.Datetime.now()
        for order in self:
            values = {"eguitra_sent_at": now, "eguitra_sent_by": self.env.user.id}
            if order.state == "draft":
                values["state"] = "sent"
            if emailed_to:
                values["eguitra_emailed_to"] = emailed_to
            order._eguitra_quiet().write(values)
        return True

    def action_eguitra_accept(self):
        """Acceptation du client : l'offre devient la commande. Une offre expirée ne s'accepte plus (nouvelle
        version) ; une offre de travaux crée son chantier ou s'y rattache."""
        self._eguitra_check_open("Acceptation")
        today = fields.Date.context_today(self)
        for order in self:
            if order.validity_date and order.validity_date < today:
                raise UserError(f"L'offre {order.name} a expiré le {_fmt_date(order.validity_date)} : créez-en une "
                                "nouvelle version, à faire accepter.")
            if not order.order_line.filtered(lambda line: not line.display_type):
                raise UserError(f"L'offre {order.name} n'a aucune ligne chiffrée.")
            if order.eguitra_chantier_mode:
                order._eguitra_check_btp_offer()
        quiet = self._eguitra_quiet()
        quiet.action_confirm()
        for order in quiet:
            # Le noyau abonne le client à la commande : aucun message ne doit lui partir de là.
            order.message_unsubscribe(partner_ids=order.partner_id.ids)
            order.write({"eguitra_accepted_at": fields.Datetime.now(), "eguitra_accepted_by": self.env.user.id})
            if order._eguitra_is_btp():
                order._eguitra_link_chantier()
        return True

    def _eguitra_close(self, reason, comment=None):
        self._eguitra_quiet().write({
            "eguitra_close_reason": reason, "eguitra_closed_at": fields.Datetime.now(),
            "eguitra_closed_by": self.env.user.id, "eguitra_refusal_reason": comment or False,
        })
        self._eguitra_quiet()._action_cancel()

    def action_eguitra_refuse(self, reason):
        if not (reason or "").strip():
            raise UserError("Indiquez le motif du refus du client.")
        self._eguitra_check_open("Refus")
        self._eguitra_close("refused", reason.strip())
        return True

    def action_eguitra_cancel(self):
        """Annulation : une offre ouverte, ou une commande sans facture validée (ses brouillons sont annulés)."""
        for order in self:
            if order.state in OPEN_STATES:
                continue
            if order.state != "sale":
                raise UserError(f"L'offre {order.name} est déjà close.")
            posted = order.invoice_ids.filtered(lambda move: move.state == "posted")
            if posted:
                raise UserError(f"La commande {order.name} a des factures validées ({', '.join(posted.mapped('name'))}) : "
                                "établissez un avoir depuis les ventes.")
            if order.eguitra_chantier_id and order.eguitra_chantier_id.situation_ids.filtered(
                    lambda s: s.state == "invoiced"):
                raise UserError(f"Le chantier de la commande {order.name} a des situations facturées.")
            if order.locked:
                order.action_unlock()
        self._eguitra_close("cancelled")
        return True

    def action_eguitra_new_version(self):
        """Nouvelle version de l'offre (OF/…-V2), à modifier puis à envoyer : l'offre ouverte est remplacée ;
        une offre refusée ou expirée reste telle quelle. Une offre acceptée ne change plus."""
        self.ensure_one()
        if self.state == "sale":
            raise UserError("Une offre acceptée ne change plus : établissez une nouvelle offre pour un avenant.")
        versions = self._eguitra_versions()
        newer = versions.filtered(lambda o: o.eguitra_version > self.eguitra_version and o.eguitra_status != "replaced")
        if newer:
            raise UserError(f"Une version plus récente existe déjà : {newer[-1].name}.")
        root = self._eguitra_root()
        number = max(versions.mapped("eguitra_version")) + 1
        new = self._eguitra_quiet().copy({
            "name": f"{root.name}-V{number}", "eguitra_root_id": root.id, "eguitra_version": number,
            "eguitra_previous_id": self.id, "eguitra_offer_date": fields.Date.context_today(self),
        })
        if self.state in OPEN_STATES:
            self._eguitra_close("replaced")
        return new

    @api.model
    def _cron_eguitra_expire(self):
        """Tâche de nuit : les offres ouvertes dont la validité est passée expirent."""
        today = fields.Date.context_today(self)
        orders = self.sudo().search([("state", "in", OPEN_STATES), ("validity_date", "!=", False),
                                     ("validity_date", "<", today)])
        if orders:
            orders._eguitra_close("expired")
        return len(orders)

    @api.model
    def _cron_eguitra_remind(self):
        """Tâche du matin : l'auteur d'une offre envoyée qui expire bientôt (réglage de la société) est relancé
        par courriel, une seule fois ; sans serveur de courrier, le tableau de bord la signale."""
        if not mail_server_ready(self.env):
            return 0
        today = fields.Date.context_today(self)
        count = 0
        for company in self.env["res.company"].sudo().search([("eguitra_offer_reminder_days", ">", 0)]):
            limit = today + timedelta(days=company.eguitra_offer_reminder_days)
            orders = self.sudo().search([
                ("company_id", "=", company.id), ("state", "=", "sent"), ("validity_date", ">=", today),
                ("validity_date", "<=", limit), ("eguitra_reminded_at", "=", False),
            ])
            for order in orders:
                author = order.user_id or order.create_uid
                if not author.email:
                    continue
                send_mail(self.env, author.email, f"Offre {order.name} : expire le {_fmt_date(order.validity_date)}",
                          f"Offre {order.name}", [
                              f"L'offre {order.name} ({order.partner_id.name}, {order.eguitra_object or 'sans objet'}) "
                              f"expire le {_fmt_date(order.validity_date)}.",
                              "Relancez le client depuis Finance > Ventes > Offres, ou créez une nouvelle version.",
                          ], company=company)
                order._eguitra_quiet().write({"eguitra_reminded_at": fields.Datetime.now()})
                count += 1
        return count

    # ─── Facturation de la commande ───────────────────────────────────────

    def _prepare_invoice(self):
        values = super()._prepare_invoice()
        # « Référence offre » de la facture : le numéro de l'offre acceptée (pas une référence du client).
        values["ref"] = self.name
        if self.eguitra_object:
            values["eguitra_object"] = self.eguitra_object
        return values

    def _eguitra_amounts(self):
        """Suivi de la facturation, hors taxes : commandé, facturé (hors acomptes), acomptes facturés et déjà
        déduits, reste à facturer. Factures non annulées (brouillons compris : ils seront validés ou annulés)."""
        self.ensure_one()
        if self.eguitra_chantier_id:
            chantier = self.eguitra_chantier_id.sudo()
            advance = chantier.eguitra_advance_amount if chantier.eguitra_advance_invoice_id else 0.0
            return {
                "ordered": chantier.contract_amount, "invoiced": chantier.invoiced_amount,
                "advances": advance, "advances_deducted": chantier.eguitra_advance_deducted,
                "to_deduct": max(advance - chantier.eguitra_advance_deducted, 0.0),
                "to_invoice": max(chantier.contract_amount - chantier.invoiced_amount, 0.0),
            }
        regular = advances = deducted = 0.0
        for line in self.sudo().order_line.filtered(lambda l: not l.display_type):
            for inv_line in line.invoice_lines.filtered(lambda l: l.move_id.state != "cancel"):
                sign = -1 if inv_line.move_id.move_type == "out_refund" else 1
                amount = sign * inv_line.price_subtotal
                if line.is_downpayment:
                    if amount >= 0:
                        advances += amount
                    else:
                        deducted -= amount
                else:
                    regular += amount
        ordered = self.amount_untaxed
        return {"ordered": ordered, "invoiced": regular, "advances": advances, "advances_deducted": deducted,
                "to_deduct": max(advances - deducted, 0.0), "to_invoice": max(ordered - regular, 0.0)}

    def eguitra_create_invoice(self, method, value=None, label=None, deduct=None):
        """Facture de la commande, en brouillon (validée ensuite dans les ventes) :
        - total : quantités commandées non encore facturées ;
        - delivered : quantités exécutées non encore facturées ;
        - percentage, fixed : acompte (pourcentage de la commande, ou montant TTC), déduit de la facture finale.
        deduct : déduire les acomptes déjà facturés (par défaut : facture totale, ou toutes les quantités
        exécutées). Rend les factures créées."""
        self.ensure_one()
        order = self._eguitra_quiet()
        if order.state != "sale":
            raise UserError("Seule une commande (offre acceptée) se facture.")
        if order._eguitra_is_btp():
            raise UserError("Offre de travaux : elle se facture par les situations du chantier et son avance de "
                            "démarrage (Finance > BTP), jamais depuis la commande.")
        Move = self.env["account.move"]
        if method in ("total", "delivered"):
            mode = "order" if method == "total" else "delivered"
            if order.eguitra_invoice_mode != mode:
                order.eguitra_invoice_mode = mode
            lines = order.order_line.filtered(lambda l: not l.display_type and not l.is_downpayment)
            if not any(line.qty_to_invoice > 0 for line in lines):
                raise UserError("Rien à facturer : " + ("toutes les quantités commandées sont déjà facturées."
                                                         if method == "total" else
                                                         "saisissez d'abord les quantités exécutées."))
            if deduct is None:
                deduct = method == "total" or all(l.qty_delivered >= l.product_uom_qty for l in lines)
            moves = order._create_invoices(final=bool(deduct))
        elif method in ("percentage", "fixed"):
            try:
                amount = float(value)
            except (TypeError, ValueError) as e:
                raise UserError("Indiquez le pourcentage ou le montant de l'acompte.") from e
            if amount <= 0:
                raise UserError("Un acompte est positif.")
            amounts = order._eguitra_amounts()
            if method == "percentage":
                if amount > 100:
                    raise UserError("Un acompte ne dépasse pas 100 % de la commande.")
                share = amount / 100.0
            else:
                share = amount / order.amount_total if order.amount_total else 0.0
            open_share = 1 - ((amounts["advances"] - amounts["advances_deducted"] + amounts["invoiced"]) / amounts["ordered"]
                              if amounts["ordered"] else 0.0)
            if share > open_share + 1e-6:
                raise UserError("L'acompte dépasse ce qui reste à facturer de la commande.")
            wizard = self.env["sale.advance.payment.inv"].sudo().with_context(
                active_model="sale.order", active_ids=order.ids, **QUIET).create({
                    "advance_payment_method": method, "sale_order_ids": [(6, 0, order.ids)],
                    "amount": amount if method == "percentage" else 0.0,
                    "fixed_amount": amount if method == "fixed" else 0.0,
                })
            moves = wizard._create_invoices(order)
            text = (label or "").strip() or (
                f"Acompte de {amount:g} % sur la commande {order.name}".replace(".", ",") if method == "percentage"
                else f"Acompte sur la commande {order.name}")
            dp_lines = moves.invoice_line_ids.filtered(lambda l: l.display_type == "product")
            dp_lines.write({"name": text})
            dp_lines.sale_line_ids.filtered("is_downpayment").write({"eguitra_advance_label": text})
        else:
            raise UserError("Mode de facturation inconnu (total, delivered, percentage, fixed).")
        moves = Move.browse(moves.ids)
        for move in moves.filtered(lambda m: not m.eguitra_object and order.eguitra_object):
            move.eguitra_object = order.eguitra_object
        return moves

    # ─── Offre de travaux (chantier) ──────────────────────────────────────

    def _eguitra_check_btp_offer(self):
        self.ensure_one()
        if self.company_id.eguitra_entity != "groupe":
            raise UserError("Les offres de travaux (chantiers) ne concernent qu'EGUITRA GROUP SARLU.")
        if not 0 <= (self.eguitra_advance_rate or 0) <= 100 or not 0 <= (self.eguitra_retention_rate or 0) <= 100:
            raise UserError("L'avance de démarrage et la retenue de garantie sont des pourcentages, de 0 à 100.")
        if (self.eguitra_advance_rate or 0) + (self.eguitra_retention_rate or 0) >= 100:
            # Chaque situation déduit l'avance au prorata et retient la garantie : réunies, elles laissent un net
            # à payer positif.
            raise UserError("L'avance de démarrage et la retenue de garantie réunies restent sous 100 % des travaux.")
        chantier = self.eguitra_chantier_id
        if chantier:
            if chantier.company_id != self.company_id:
                raise UserError("Chantier d'une autre société.")
            if chantier.partner_id.commercial_partner_id != self.partner_id.commercial_partner_id:
                raise UserError(f"Le chantier {chantier.name} a un autre maître d'ouvrage que le client de l'offre.")
            other = self.sudo().search([("eguitra_chantier_id", "=", chantier.id), ("state", "=", "sale"),
                                        ("id", "!=", self.id)], limit=1)
            if other:
                raise UserError(f"Le chantier {chantier.name} est déjà le marché de l'offre {other.name}.")
            if chantier.eguitra_advance_invoice_id:
                raise UserError(f"Le chantier {chantier.name} a déjà une avance de démarrage facturée.")

    def _eguitra_link_chantier(self):
        """Offre de travaux acceptée : chantier créé (ou celui choisi), montant du marché égal au hors taxes de
        l'offre, avance de démarrage à son taux. La retenue de garantie suit les règles du chantier."""
        self.ensure_one()
        Chantier = self.env["eguitra.chantier"].sudo()
        values = {"contract_amount": self.amount_untaxed, "eguitra_sale_order_id": self.id,
                  "eguitra_advance_rate": self.eguitra_advance_rate or 0.0}
        chantier = self.eguitra_chantier_id.sudo()
        if chantier:
            if not chantier.situation_ids.filtered(lambda s: s.state == "invoiced"):
                values["retention_rate"] = self.eguitra_retention_rate
            chantier.write(values)
        else:
            chantier = Chantier.create(dict(values, **{
                "name": (self.eguitra_object or self.name)[:120], "partner_id": self.partner_id.id,
                "company_id": self.company_id.id, "retention_rate": self.eguitra_retention_rate,
                "date_start": fields.Date.context_today(self),
            }))
        # Facturée par le chantier : la commande n'a rien à facturer d'elle-même.
        self.write({"eguitra_chantier_id": chantier.id, "eguitra_invoice_mode": "delivered"})
        return chantier

    # ─── Gabarit de l'offre (report/report_offer.xml) ─────────────────────

    def _eguitra_report_values(self):
        """Valeurs de l'offre imprimée, au gabarit des factures de la société (eguitra_base)."""
        self.ensure_one()
        company = self.company_id
        accent, css = report_css_and_accent(self.env, company)
        day = self.eguitra_offer_date or fields.Date.context_today(self)
        lines = self.order_line.filtered(lambda l: not l.is_downpayment).sorted(lambda l: (l.sequence, l.id))
        rows, show_unit, show_discount = rows_of(self.env, lines, self.currency_id, quantity="product_uom_qty",
                                                 uom="product_uom_id")
        validity = None
        if self.validity_date:
            days = self._eguitra_validity_days()
            validity = (f"{days} jours, jusqu'au {_fmt_date(self.validity_date)}" if days
                        else f"jusqu'au {_fmt_date(self.validity_date)}")
        references = [("Référence offre", self.name)]
        if validity:
            references.append(("Validité offre", validity))
        if self.eguitra_version > 1:
            references.append(("Version", str(self.eguitra_version)))
        banners = {
            "refused": "OFFRE REFUSÉE par le client : document sans valeur d'engagement.",
            "expired": "OFFRE EXPIRÉE : sa validité est passée.",
            "cancelled": "OFFRE ANNULÉE.",
            "replaced": "OFFRE REMPLACÉE par une version plus récente.",
        }
        status = {"draft": "Brouillon", "accepted": "Acceptée"}.get(self.eguitra_status)
        journal = self.env["account.journal"].sudo().search(
            [("company_id", "=", company.id), ("type", "=", "sale")], order="sequence, id", limit=1)
        terms = {
            "conditions": (self.eguitra_conditions or "").strip() or None,
            "term": self.payment_term_id.name or None,
            "validity": validity,
        }
        return {
            "accent": accent, "css": css, "banner": banners.get(self.eguitra_status),
            "title": "OFFRE", "number": self.name, "status": status,
            "place_date": f"{company.city}, le {day:%d/%m/%Y}" if company.city else f"Date : {day:%d/%m/%Y}",
            "company_name": company.name, "company_lines": company_block(company),
            "party_label": "CLIENT", "party": partner_block(self.partner_id, company),
            "references": references, "object": (self.eguitra_object or "").strip() or None,
            "rows": rows, "show_unit": show_unit, "show_discount": show_discount,
            "price_label": f"PU HT ({self.currency_id.name})", "amount_label": f"Montant HT ({self.currency_id.name})",
            "totals": totals_of(self, main_label="TOTAL TTC"),
            "words_intro": "Arrêtée la présente offre à la somme de :",
            "words": capitalize(amount_in_words(self.amount_total, self.currency_id)),
            "terms": terms, "terms_title": "CONDITIONS DE L'OFFRE",
            "signatory": (journal.eguitra_signatory if journal else None) or DEFAULT_SIGNATORY,
        }


class SaleOrderLine(models.Model):
    _inherit = "sale.order.line"

    eguitra_account_id = fields.Many2one(
        "account.account", "Compte de produit", help="Compte de la ligne libre (sinon celui de l'article).")
    eguitra_advance_label = fields.Char("Libellé de l'acompte", copy=False)

    @api.depends("order_id.eguitra_invoice_mode")
    def _compute_qty_to_invoice(self):
        """Quantité à facturer selon la commande (quantités commandées ou exécutées), et non selon l'article ;
        les acomptes gardent le calcul du noyau (déduction sur la facture finale)."""
        super()._compute_qty_to_invoice()
        for line in self:
            if line.display_type or line.is_downpayment or line.state != "sale":
                continue
            base = line.qty_delivered if line.order_id.eguitra_invoice_mode == "delivered" else line.product_uom_qty
            line.qty_to_invoice = base - line.qty_invoiced

    def _prepare_invoice_line(self, **optional_values):
        values = super()._prepare_invoice_line(**optional_values)
        if self.display_type:
            return values
        if self.is_downpayment:
            if self.eguitra_advance_label:
                deduction = (values.get("quantity") or 0) < 0
                values["name"] = f"Déduction : {self.eguitra_advance_label}" if deduction else self.eguitra_advance_label
            return values
        if self.eguitra_account_id:
            values["account_id"] = self.eguitra_account_id.id
        if self.analytic_distribution and not values.get("analytic_distribution"):
            values["analytic_distribution"] = self.analytic_distribution
        return values
