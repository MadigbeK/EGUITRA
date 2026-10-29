"""Ordre de transport (OT) : la commande du client, qui regroupe une ou plusieurs opérations (rotations).

Le client demande et autorise EGUITRA GROUP à transporter sa marchandise (avec chargement, déchargement ou
stockage le cas échéant) : marchandise, quantité, poids, valeur, origine et destination, destinataire réel,
adresse de facturation, référence du client. L'OT tient lieu de dossier : son numéro est la référence
reprise sur l'ordre de mission, le budget de voyage et la lettre de voiture de chacune de ses opérations
(un dossier distinct n'aurait pas de contenu propre dans le transport d'hydrocarbures d'EGUITRA GROUP).

États : brouillon, validé (accord du client, pièce signée jointe au besoin), exécuté (toutes ses opérations
livrées), clôturé (toutes facturées), annulé. Exécuté et clôturé se posent d'eux-mêmes au fil des
opérations, et se défont si une opération s'ajoute ou si une facture est défaite.
"""

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from odoo.addons.eguitra_base.lettres import number_trim

ORDER_STATES = [("draft", "Brouillon"), ("validated", "Validé"), ("executed", "Exécuté"), ("closed", "Clôturé"),
                ("cancelled", "Annulé")]
QUANTITY_UOMS = [("l", "litres"), ("kg", "kg"), ("t", "t")]
LIVE_STATES = ("validated", "executed", "closed")
# Ordre ouvert : il reçoit des opérations (préparées dès le brouillon, avant la signature du client).
OPEN_STATES = ("draft", "validated", "executed")


class EguitraTransportOrder(models.Model):
    _name = "eguitra.transport.order"
    _description = "Ordre de transport"
    _order = "date desc, id desc"
    _check_company_auto = True

    name = fields.Char("Numéro", default="/", copy=False, readonly=True, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    partner_id = fields.Many2one("res.partner", "Client", required=True, check_company=True, index=True)
    date = fields.Date("Date", required=True, default=fields.Date.context_today)
    state = fields.Selection(ORDER_STATES, "État", default="draft", required=True, index=True, copy=False)
    # Type de prestation.
    service_transport = fields.Boolean("Transport", default=True)
    with_loading = fields.Boolean("Avec chargement")
    with_unloading = fields.Boolean("Avec déchargement")
    with_storage = fields.Boolean("Avec stockage")
    # Marchandise.
    product_id = fields.Many2one("eguitra.transport.product", "Produit transporté", check_company=True,
                                 ondelete="restrict")
    goods_description = fields.Char("Description de la marchandise")
    packaging = fields.Char("Conditionnement", default="Vrac liquide")
    quantity = fields.Float("Quantité", digits=(14, 3))
    quantity_uom = fields.Selection(QUANTITY_UOMS, "Unité", default="l", required=True)
    weight_gross = fields.Float("Poids brut", digits=(14, 3), help="Dans l'unité de la quantité.")
    weight_net = fields.Float("Poids net", digits=(14, 3), help="Dans l'unité de la quantité.")
    goods_value = fields.Monetary("Valeur de la marchandise")
    extra_insurance = fields.Boolean("Assurance complémentaire")
    attached_documents = fields.Text("Documents joints", help="Bons, connaissements, certificats remis avec l'ordre.")
    # Origine et destination.
    route_id = fields.Many2one("eguitra.transport.route", "Route", check_company=True,
                               help="Route proposée aux opérations de l'ordre.")
    origin = fields.Char("Origine")
    destination = fields.Char("Destination")
    destination_country = fields.Char("Pays de destination", default="Guinée")
    consignee = fields.Char("Destinataire réel", help="Vide : le client.")
    billing_address = fields.Text("Adresse de facturation", help="Vide : adresse du client.")
    client_ref = fields.Char("Référence du client")
    note = fields.Text("Observation")
    client_signatory = fields.Char("Signataire pour le client", help="Nom et fonction, imprimés sous « Pour le client ».")
    # Accord du client.
    signed_attachment_id = fields.Many2one("ir.attachment", "Ordre signé par le client", copy=False, ondelete="set null")
    validated_by = fields.Many2one("res.users", "Validé par", readonly=True, copy=False)
    validated_at = fields.Datetime("Validé le", readonly=True, copy=False)
    cancel_reason = fields.Char("Motif d'annulation", copy=False)
    rotation_ids = fields.One2many("eguitra.transport.rotation", "order_id", "Opérations")
    rotation_count = fields.Integer("Opérations", compute="_compute_progress")
    delivered_count = fields.Integer("Opérations livrées", compute="_compute_progress")
    invoiced_count = fields.Integer("Opérations facturées", compute="_compute_progress")

    @api.depends("rotation_ids.state", "rotation_ids.date_delivery", "rotation_ids.volume_delivered")
    def _compute_progress(self):
        for order in self:
            ops = order.rotation_ids.filtered(lambda r: r.state != "cancelled")
            order.rotation_count = len(ops)
            order.delivered_count = len(ops.filtered(lambda r: r._is_delivered()))
            order.invoiced_count = len(ops.filtered(lambda r: r.state == "invoiced"))

    @api.constrains("quantity", "weight_gross", "weight_net", "goods_value")
    def _check_amounts(self):
        for order in self:
            if min(order.quantity or 0, order.weight_gross or 0, order.weight_net or 0, order.goods_value or 0) < 0:
                raise ValidationError("Quantité, poids et valeur d'un ordre de transport ne sont jamais négatifs.")
            if order.weight_gross and order.weight_net and order.weight_net > order.weight_gross:
                raise ValidationError("Le poids net dépasse le poids brut.")

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            route = self.env["eguitra.transport.route"].browse(vals["route_id"]) if vals.get("route_id") else None
            if route:
                vals.setdefault("origin", route.origin or False)
                vals.setdefault("destination", route.destination or False)
        orders = super().create(vals_list)
        for order in orders:
            order.name = order.company_id._transport_next_number("order", order.date)
        return orders

    def write(self, vals):
        frozen = set(vals) - {"state", "note", "signed_attachment_id", "client_signatory", "validated_by",
                              "validated_at", "cancel_reason", "client_ref", "attached_documents"}
        if frozen and self.filtered(lambda o: o.state in ("closed", "cancelled")):
            raise UserError("Un ordre de transport clôturé ou annulé ne se modifie plus.")
        if frozen & {"partner_id", "company_id"} and self.rotation_ids.filtered(lambda r: r.state != "cancelled"):
            raise UserError("Le client d'un ordre de transport qui a des opérations ne change pas.")
        return super().write(vals)

    # ─── Contenu ──────────────────────────────────────────────────────────

    def _consignee(self):
        self.ensure_one()
        return self.consignee or self.partner_id.commercial_partner_id.name or ""

    def _billing_address(self):
        self.ensure_one()
        if self.billing_address:
            return self.billing_address
        partner = self.partner_id
        return ", ".join(p for p in (partner.street, partner.street2, partner.zip, partner.city) if p)

    def _quantity_label(self, value=None):
        self.ensure_one()
        value = self.quantity if value is None else value
        return f"{number_trim(value)} {dict(QUANTITY_UOMS)[self.quantity_uom]}" if value else ""

    def _quantity_m3(self):
        """Quantité en m³ (volume prévu d'une opération) ; None si elle s'exprime en poids."""
        self.ensure_one()
        return (self.quantity or 0.0) / 1000 if self.quantity_uom == "l" else None

    def _missing(self):
        """Ce qui manque pour imprimer l'ordre de transport, en clair."""
        self.ensure_one()
        missing = []
        if not self.partner_id:
            missing.append("le client")
        if not (self.service_transport or self.with_loading or self.with_unloading or self.with_storage):
            missing.append("le type de prestation (transport, chargement, déchargement ou stockage)")
        if not (self.product_id or self.goods_description):
            missing.append("la marchandise (produit ou description)")
        if not self.quantity:
            missing.append("la quantité")
        if not self.packaging:
            missing.append("le conditionnement")
        if not (self.origin or self.route_id.origin):
            missing.append("l'origine")
        if not (self.destination or self.route_id.destination):
            missing.append("la destination")
        if not self._billing_address():
            missing.append("l'adresse de facturation (ou celle du client)")
        return missing

    # ─── États ────────────────────────────────────────────────────────────

    def action_validate(self):
        """Accord du client : l'ordre est complet ; une pièce signée peut être jointe avant ou après."""
        for order in self:
            if order.state != "draft":
                raise UserError(f"L'ordre de transport {order.name} n'est pas en brouillon.")
            missing = order._missing()
            if missing:
                raise UserError(f"Ordre de transport {order.name} incomplet : {', '.join(missing)}.")
            order.write({"state": "validated", "validated_by": self.env.user.id, "validated_at": fields.Datetime.now()})
            order._sync_state()
        return True

    def action_reset(self):
        """Retour au brouillon d'un ordre validé dont aucune opération n'est partie."""
        for order in self:
            if order.state != "validated":
                raise UserError(f"Seul un ordre validé revient en brouillon ({order.name}).")
            if order.rotation_ids.filtered(lambda r: r.state not in ("draft", "cancelled")):
                raise UserError(f"L'ordre {order.name} a des opérations parties ou validées : il reste validé.")
            order.write({"state": "draft", "validated_by": False, "validated_at": False})
        return True

    def action_cancel(self, reason=None):
        for order in self:
            if order.state in ("closed", "cancelled"):
                raise UserError(f"L'ordre de transport {order.name} est déjà {dict(ORDER_STATES)[order.state].lower()}.")
            live = order.rotation_ids.filtered(lambda r: r.state not in ("draft", "cancelled"))
            if live:
                raise UserError(f"L'ordre {order.name} a des opérations parties, validées ou facturées "
                                f"({', '.join(live.mapped(lambda r: r._label()))}) : annulez-les d'abord.")
            order.rotation_ids.filtered(lambda r: r.state == "draft").action_cancel()
            order.write({"state": "cancelled", "cancel_reason": (reason or "").strip() or False})
        return True

    def _sync_state(self):
        """Exécuté quand toutes les opérations (hors annulées) sont livrées, clôturé quand toutes sont
        facturées ; revient à « validé » ou « exécuté » si une opération s'ajoute ou si une facture est défaite."""
        for order in self.filtered(lambda o: o.state in LIVE_STATES):
            ops = order.rotation_ids.filtered(lambda r: r.state != "cancelled")
            if ops and all(r.state == "invoiced" for r in ops):
                target = "closed"
            elif ops and all(r._is_delivered() for r in ops):
                target = "executed"
            else:
                target = "validated"
            if target != order.state:
                super(EguitraTransportOrder, order).write({"state": target})


class EguitraTransportRotation(models.Model):
    _inherit = "eguitra.transport.rotation"

    order_id = fields.Many2one("eguitra.transport.order", "Ordre de transport", check_company=True, index=True,
                               ondelete="restrict")
    volume_planned = fields.Float("Volume prévu (m³)", digits=(12, 3),
                                  help="Quantité prévue par l'ordre de transport, avant le chargement.")

    def _is_delivered(self):
        """Livrée : validée ou facturée, ou réception enregistrée (date et volume livrés)."""
        self.ensure_one()
        return self.state in ("done", "invoiced") or bool(self.date_delivery and self.volume_delivered)

    def _ensure_number(self):
        """Numéro d'opération attribué dès qu'un document la cite (ordre de transport, ordre de mission,
        budget, lettre de voiture), sans attendre la validation."""
        for rot in self.filtered(lambda r: not r.name or r.name == "/"):
            rot.sudo().name = self.env["ir.sequence"].sudo().with_company(rot.company_id).next_by_code(
                "eguitra.transport.rotation") or "/"

    @api.constrains("order_id", "partner_id")
    def _check_order(self):
        for rot in self.filtered("order_id"):
            if rot.order_id.partner_id.commercial_partner_id != rot.partner_id.commercial_partner_id:
                raise ValidationError(f"Rotation {rot._label()} : le client diffère de celui de l'ordre de "
                                      f"transport {rot.order_id.name}.")

    @api.model
    def _check_order_open(self, order):
        """Un ordre de transport reçoit des opérations tant qu'il est ouvert : ni clôturé ni annulé."""
        if order.state not in OPEN_STATES:
            raise UserError(f"L'ordre de transport {order.name} est {dict(ORDER_STATES)[order.state].lower()} : "
                            "il ne reçoit plus d'opération.")

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("order_id"):
                order = self.env["eguitra.transport.order"].browse(vals["order_id"])
                self._check_order_open(order)
                vals.setdefault("partner_id", order.partner_id.id)
                if order.product_id:
                    vals.setdefault("product_id", order.product_id.id)
                if order.route_id:
                    vals.setdefault("route_id", order.route_id.id)
        rotations = super().create(vals_list)
        linked = rotations.filtered("order_id")
        linked._ensure_number()
        linked.order_id._sync_state()
        return rotations

    def _check_order_change(self, order_id):
        """Rattacher une opération à un ordre, ou l'en détacher (revue de sécurité du 29/10/2026) : jamais une
        rotation validée ou facturée ; l'ordre visé est ouvert, du même client et de la même société."""
        order = self.env["eguitra.transport.order"].browse(order_id) if order_id else None
        for rot in self:
            if rot.order_id.id == (order.id if order else False):
                continue
            if rot.state in ("done", "invoiced"):
                raise UserError(f"Rotation {rot._label()} validée ou facturée : elle ne change pas d'ordre de transport.")
            if order:
                self._check_order_open(order)
                if order.company_id != rot.company_id:
                    raise UserError(f"L'ordre de transport {order.name} est d'une autre société.")
                if order.partner_id.commercial_partner_id != rot.partner_id.commercial_partner_id:
                    raise UserError(f"Rotation {rot._label()} : le client diffère de celui de l'ordre de transport "
                                    f"{order.name}.")

    def write(self, vals):
        if "order_id" in vals:
            self._check_order_change(vals["order_id"])
        orders = self.order_id
        result = super().write(vals)
        if "order_id" in vals:
            self.filtered("order_id")._ensure_number()
        if {"state", "order_id", "date_delivery", "volume_delivered"} & set(vals):
            (orders | self.order_id)._sync_state()
        return result
