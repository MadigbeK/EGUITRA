"""Lettre de voiture (LV) d'une opération : le document qui accompagne la marchandise, puis sa réception.

Elle reprend l'opération (tracteur et remorque, chauffeur, départ, ETD, ETA et ETR), l'ordre de transport, le
bon de livraison, le connaissement et la référence du client, les colis (nature, description, poids brut et
net, conditionnement, emballage, dimensions et volumes, nombre), le chargeur, le lieu et la date du
chargement, le destinataire et la destination, l'arrivée prévue, le transitaire, l'agent livreur et le commis
chargeur, la franchise d'immobilisation et les consignes au chauffeur (réglages de la société).

Ce qui vient de l'opération ou de l'ordre n'est saisi qu'une fois : la lettre ne garde que ce qui lui est
propre, ou ce qu'on y corrige. Elle se crée d'elle-même à la première impression ou saisie.

Réception : réceptionnaire, arrivée du véhicule, déchargement, départ du véhicule, quantité reçue conforme,
avarie et ses causes, visa. Elle alimente l'opération (volume livré, date de livraison) : le manquant de la
rotation se calcule de là, sans seconde saisie. Une rotation validée dont la réception change revient en
saisie (validation par un autre compte, comme toute correction).

Immobilisation : jours entre l'arrivée et le départ du véhicule (toute journée commencée compte), moins la
franchise (2 jours par défaut, réglable pour la société et pour un client). Si le client le prévoit, les
jours au-delà s'ajoutent à la facture des rotations, au tarif journalier du client.
"""

import math

from odoo import Command, api, fields, models
from odoo.exceptions import UserError, ValidationError

from ..nombres import fmt_int

WEIGHT_UOMS = [("l", "L"), ("kg", "kg"), ("t", "t")]


class EguitraTransportWaybill(models.Model):
    _name = "eguitra.transport.waybill"
    _description = "Lettre de voiture"
    _order = "date desc, id desc"
    _check_company_auto = True

    name = fields.Char("Numéro", default="/", copy=False, readonly=True, index=True)
    rotation_id = fields.Many2one("eguitra.transport.rotation", "Opération", required=True, ondelete="cascade",
                                  index=True, check_company=True)
    company_id = fields.Many2one(related="rotation_id.company_id", store=True, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    date = fields.Date("Date", required=True, default=fields.Date.context_today)
    # Références (vides : celles de l'opération ou de l'ordre de transport).
    bill_of_lading = fields.Char("Connaissement")
    client_ref = fields.Char("Référence du client")
    # Chargement et livraison.
    shipper = fields.Char("Chargeur")
    loading_place = fields.Char("Lieu de chargement")
    loading_at = fields.Datetime("Date et heure de chargement")
    consignee = fields.Char("Destinataire")
    destination = fields.Char("Destination")
    arrival_planned_at = fields.Datetime("Arrivée estimée")
    forwarder = fields.Char("Transitaire")
    delivery_agent = fields.Char("Agent livreur")
    loader_clerk = fields.Char("Commis chargeur")
    weight_uom = fields.Selection(WEIGHT_UOMS, "Unité des poids", default="l", required=True)
    package_ids = fields.One2many("eguitra.transport.waybill.package", "waybill_id", "Colis")
    note = fields.Text("Observations")
    # Réception.
    receiver_name = fields.Char("Réceptionnaire")
    vehicle_arrival_at = fields.Datetime("Arrivée du véhicule")
    unloading_at = fields.Datetime("Déchargement")
    vehicle_departure_at = fields.Datetime("Départ du véhicule")
    received_qty = fields.Float("Reçu conforme (L)", digits=(14, 2))
    damaged_qty = fields.Float("Avarie (L)", digits=(14, 2))
    damage_cause = fields.Text("Causes de l'avarie")
    receiver_visa = fields.Boolean("Visa du réceptionnaire obtenu")
    reception_attachment_id = fields.Many2one("ir.attachment", "Lettre visée (scan)", ondelete="set null", copy=False)
    received_by = fields.Many2one("res.users", "Réception saisie par", readonly=True, copy=False)
    received_at = fields.Datetime("Réception saisie le", readonly=True, copy=False)
    shortage_qty = fields.Float("Manquant (L)", digits=(14, 2), compute="_compute_reception", store=True)
    free_days = fields.Integer("Franchise (jours)", compute="_compute_reception", store=True)
    immobilized_days = fields.Integer("Jours d'immobilisation", compute="_compute_reception", store=True)
    billable_days = fields.Integer("Jours au-delà de la franchise", compute="_compute_reception", store=True)
    demurrage_rate = fields.Monetary("Tarif journalier d'immobilisation", compute="_compute_demurrage_terms",
                                     store=True, readonly=False, help="Tarif du client, repris à la saisie de l'opération.")
    demurrage_billable = fields.Boolean("Immobilisation facturée", compute="_compute_demurrage_terms", store=True,
                                        readonly=False)
    demurrage_amount = fields.Monetary("Immobilisation à facturer", compute="_compute_demurrage_amount", store=True)

    _rotation_unique = models.Constraint("unique(rotation_id)", "L'opération a déjà sa lettre de voiture.")

    @api.constrains("received_qty", "damaged_qty")
    def _check_quantities(self):
        if any((w.received_qty or 0) < 0 or (w.damaged_qty or 0) < 0 for w in self):
            raise ValidationError("Les quantités de la réception ne sont jamais négatives.")

    @api.constrains("vehicle_arrival_at", "unloading_at", "vehicle_departure_at")
    def _check_reception_dates(self):
        for waybill in self:
            arrival, unloading, departure = waybill.vehicle_arrival_at, waybill.unloading_at, waybill.vehicle_departure_at
            if arrival and departure and departure < arrival:
                raise ValidationError("Le départ du véhicule précède son arrivée.")
            if arrival and unloading and unloading < arrival:
                raise ValidationError("Le déchargement précède l'arrivée du véhicule.")

    @api.depends("received_qty", "damaged_qty", "rotation_id.volume_loaded", "vehicle_arrival_at",
                 "vehicle_departure_at", "rotation_id.partner_id", "company_id")
    def _compute_reception(self):
        for waybill in self:
            rot = waybill.rotation_id
            loaded = (rot.volume_loaded or 0.0) * 1000
            received = waybill.received_qty or 0.0
            waybill.shortage_qty = max(0.0, loaded - received - (waybill.damaged_qty or 0.0)) if received else 0.0
            client = rot.partner_id.commercial_partner_id
            free = client.transport_demurrage_free_days or (waybill.company_id or self.env.company).transport_demurrage_free_days
            waybill.free_days = free
            days = waybill._immobilized_days()
            waybill.immobilized_days = days
            waybill.billable_days = max(0, days - free)

    # Calcul à part : un tarif corrigé sur la lettre ne fige pas les autres valeurs de la réception. Les
    # conditions du client suivent ses réglages tant que la rotation n'est pas facturée ; facturée, elles restent.
    @api.depends("rotation_id.partner_id", "rotation_id.partner_id.commercial_partner_id.transport_demurrage_rate",
                 "rotation_id.partner_id.commercial_partner_id.transport_demurrage_billable")
    def _compute_demurrage_terms(self):
        for waybill in self:
            if waybill.rotation_id.state == "invoiced" and waybill.id:
                continue
            client = waybill.rotation_id.partner_id.commercial_partner_id
            waybill.demurrage_rate = client.transport_demurrage_rate
            waybill.demurrage_billable = client.transport_demurrage_billable

    @api.depends("billable_days", "demurrage_rate", "demurrage_billable")
    def _compute_demurrage_amount(self):
        for waybill in self:
            billable = waybill.demurrage_billable and waybill.billable_days and waybill.demurrage_rate
            waybill.demurrage_amount = waybill.billable_days * waybill.demurrage_rate if billable else 0.0

    def _immobilized_days(self):
        """Jours entre l'arrivée et le départ du véhicule : toute journée commencée compte (0 sans les deux)."""
        self.ensure_one()
        arrival, departure = self.vehicle_arrival_at, self.vehicle_departure_at
        if not (arrival and departure) or departure <= arrival:
            return 0
        return math.ceil((departure - arrival).total_seconds() / 86400)

    @api.model_create_multi
    def create(self, vals_list):
        waybills = super().create(vals_list)
        for waybill in waybills:
            waybill.name = waybill.company_id._transport_next_number("waybill", waybill.date)
            waybill.rotation_id._ensure_number()
        return waybills

    def write(self, vals):
        reception = {"received_qty", "damaged_qty", "vehicle_arrival_at", "unloading_at", "vehicle_departure_at"}
        if reception & set(vals) and self.filtered(lambda w: w.rotation_id.state == "invoiced"):
            raise UserError("Rotation facturée : la réception ne change plus ; établissez un avoir si nécessaire.")
        return super().write(vals)

    # ─── Valeurs effectives (lettre, puis opération et ordre) ─────────────

    def _transport_order(self):
        return self.rotation_id.order_id

    def _shipper(self):
        self.ensure_one()
        return self.shipper or self.rotation_id.partner_id.commercial_partner_id.name or ""

    def _consignee(self):
        self.ensure_one()
        order = self._transport_order()
        return self.consignee or (order._consignee() if order else self.rotation_id.partner_id.commercial_partner_id.name) or ""

    def _loading_place(self):
        self.ensure_one()
        order = self._transport_order()
        return self.loading_place or self.rotation_id.route_id.origin or (order.origin if order else "") or ""

    def _destination(self):
        self.ensure_one()
        order = self._transport_order()
        return self.destination or self.rotation_id.route_id.destination or (order.destination if order else "") or ""

    def _client_ref(self):
        self.ensure_one()
        order = self._transport_order()
        return self.client_ref or (order.client_ref if order else "") or ""

    def _packages(self):
        """Colis : ceux de la lettre, sinon un colis tiré de l'opération (produit, volume chargé ou prévu)."""
        self.ensure_one()
        uom = dict(WEIGHT_UOMS)[self.weight_uom]
        if self.package_ids:
            return [{"nature": p.nature or "", "description": p.description or "", "gross": p.weight_gross,
                     "net": p.weight_net, "packaging": p.packaging or "", "wrapping": p.wrapping or "",
                     "dimensions": p.dimensions or "", "count": p.count, "uom": uom} for p in self.package_ids]
        return self.rotation_id._default_packages()

    def _missing(self):
        """Ce qui manque pour imprimer la lettre de voiture."""
        self.ensure_one()
        return self.rotation_id._waybill_missing(self)


class EguitraTransportWaybillPackage(models.Model):
    _name = "eguitra.transport.waybill.package"
    _description = "Colis d'une lettre de voiture"
    _order = "waybill_id, sequence, id"

    waybill_id = fields.Many2one("eguitra.transport.waybill", "Lettre de voiture", required=True, ondelete="cascade",
                                 index=True)
    company_id = fields.Many2one(related="waybill_id.company_id", store=True, index=True)
    sequence = fields.Integer(default=10)
    nature = fields.Char("Nature", required=True)
    description = fields.Char("Description")
    weight_gross = fields.Float("Poids brut", digits=(14, 2))
    weight_net = fields.Float("Poids net", digits=(14, 2))
    packaging = fields.Char("Conditionnement")
    wrapping = fields.Char("Emballage")
    dimensions = fields.Char("Dimensions et volumes")
    count = fields.Integer("Nombre")

    @api.constrains("weight_gross", "weight_net", "count")
    def _check_package(self):
        for package in self:
            if min(package.weight_gross or 0, package.weight_net or 0, package.count or 0) < 0:
                raise ValidationError("Poids et nombre d'un colis ne sont jamais négatifs.")


class EguitraTransportRotation(models.Model):
    _inherit = "eguitra.transport.rotation"

    waybill_ids = fields.One2many("eguitra.transport.waybill", "rotation_id", "Lettre de voiture")

    def _waybill(self):
        self.ensure_one()
        return self.waybill_ids[:1]

    def _ensure_waybill(self):
        """Lettre de voiture de l'opération, créée au besoin."""
        self.ensure_one()
        waybill = self._waybill()
        if not waybill:
            if self.state == "cancelled":
                raise UserError(f"Rotation {self._label()} annulée : pas de lettre de voiture.")
            waybill = self.env["eguitra.transport.waybill"].sudo().create({"rotation_id": self.id})
        return waybill

    def _default_packages(self):
        """Colis tiré de l'opération : produit, volume chargé (à défaut prévu) en litres, conditionnement de
        l'ordre de transport."""
        self.ensure_one()
        liters = (self.volume_loaded or self.volume_planned or 0.0) * 1000
        if not liters:
            return []
        packaging = self.order_id.packaging if self.order_id else "Vrac liquide"
        description = (self.order_id.goods_description or "") if self.order_id else ""
        return [{"nature": self.product_id.name or "", "description": description,
                 "gross": liters, "net": liters, "packaging": packaging or "", "wrapping": "", "dimensions": "",
                 "count": 0, "uom": "L"}]

    def _waybill_missing(self, waybill=None):
        """Ce qui manque pour imprimer la lettre de voiture (lettre existante ou non)."""
        self.ensure_one()
        waybill = waybill or self._waybill()
        missing = []
        if not self.driver_id:
            missing.append("le chauffeur")
        if not self.tractor_id:
            missing.append("le tracteur")
        if not self.trailer_id and self.vehicle_id.trailer_id:
            missing.append("la remorque")
        if not self.date_planned_departure:
            missing.append("le départ prévu (ETD)")
        if not self.date_planned_arrival:
            missing.append("l'arrivée prévue (ETA)")
        packages = waybill._packages() if waybill else self._default_packages()
        if not packages:
            missing.append("les colis (volume chargé ou prévu de l'opération, ou colis saisis)")
        loading = waybill._loading_place() if waybill else (self.route_id.origin or self.order_id.origin)
        destination = waybill._destination() if waybill else (self.route_id.destination or self.order_id.destination)
        if not loading:
            missing.append("le lieu de chargement")
        if not destination:
            missing.append("la destination")
        return missing

    def _record_reception(self, values):
        """Réception de la lettre de voiture : elle fixe le volume livré et la date de livraison de l'opération.
        Une rotation validée dont le volume livré change revient en saisie (quatre yeux)."""
        self.ensure_one()
        waybill = self._ensure_waybill()
        waybill.write(dict(values, received_by=self.env.user.id, received_at=fields.Datetime.now()))
        updates = {}
        if waybill.received_qty:
            delivered = round(waybill.received_qty / 1000, 3)
            if abs(delivered - (self.volume_delivered or 0.0)) > 0.0005:
                updates["volume_delivered"] = delivered
        day = (waybill.unloading_at or waybill.vehicle_arrival_at)
        if day:
            day = fields.Date.context_today(self, day)
            if day != self.date_delivery:
                updates["date_delivery"] = day
        if updates:
            if self.state == "invoiced":
                raise UserError("Rotation facturée : la réception ne change plus ; établissez un avoir si nécessaire.")
            if self.state == "done" and "volume_delivered" in updates:
                self.action_reset()
            self.write(updates)
        return waybill

    # ─── Facture : immobilisation au-delà de la franchise ─────────────────

    def _demurrage_line_vals(self, income_account, sale_tax):
        self.ensure_one()
        waybill = self._waybill()
        if not waybill or not waybill.demurrage_amount:
            return []
        days, free = waybill.billable_days, waybill.free_days
        label = (f"Immobilisation du camion chez le destinataire : {days} jour{'s' if days > 1 else ''} au-delà de la "
                 f"franchise de {free} jour{'s' if free > 1 else ''}, à {fmt_int(waybill.demurrage_rate)} "
                 f"{self.currency_id.name} le jour ({self.name}, {waybill.name}, {self.vehicle_id.name})")
        return [{
            "name": label, "quantity": 1, "price_unit": waybill.demurrage_amount, "account_id": income_account.id,
            "analytic_distribution": self._analytic_distribution(),
            "tax_ids": [Command.set(sale_tax.ids)] if sale_tax else [Command.clear()],
        }]

    def _tax_lines_vals(self, income_account, sale_tax):
        # La facture des rotations ajoute, après les taxes refacturées, l'immobilisation facturable.
        return super()._tax_lines_vals(income_account, sale_tax) + self._demurrage_line_vals(income_account, sale_tax)

