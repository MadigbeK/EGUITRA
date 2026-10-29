"""Tracteurs et remorques, convoyeur et dates prévues d'une opération (29/10/2026).

L'ensemble routier (eguitra.transport.vehicle) reste l'unité de gestion : rentabilité, compte analytique,
propriétaire et relevés, charges mensuelles, documents et verrou de départ d'HSSEQ. Il réunit désormais
un tracteur et une remorque (citerne ou benne), chacun avec son numéro de parc et son immatriculation
(eguitra.transport.unit). Une remorque change de tracteur : on la rattache à un autre ensemble, qu'elle
quitte d'office ; l'opération (la rotation) garde le tracteur et la remorque qui ont réellement roulé.

Compatibilité : les immatriculations « tractor_plate » et « trailer_plate » de l'ensemble restent des champs
enregistrés, lus par la facture, HSSEQ, les relevés et l'application mobile ; elles suivent le tracteur et la
remorque, et les écrire (écrans et scripts antérieurs) crée ou met à jour l'engin correspondant.
"""

from odoo import api, fields, models
from odoo.exceptions import ValidationError
from odoo.tools import float_compare

UNIT_KINDS = [("tractor", "Tracteur"), ("trailer", "Remorque")]
CREW_ROLES = [("driver", "Chauffeur"), ("assistant", "Convoyeur (aide-chauffeur)")]


class EguitraTransportUnit(models.Model):
    _name = "eguitra.transport.unit"
    _description = "Tracteur ou remorque"
    _order = "kind, fleet_number, id"
    _rec_names_search = ["fleet_number", "plate"]

    kind = fields.Selection(UNIT_KINDS, "Engin", required=True, default="tractor", index=True)
    fleet_number = fields.Char("N° de parc", required=True, help="Numéro interne de l'engin, par exemple TR-01 ou RE-01.")
    plate = fields.Char("Immatriculation")
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    brand = fields.Char("Marque et modèle")
    capacity_liters = fields.Integer("Capacité (litres)", help="Remorque citerne : capacité utile.")
    note = fields.Char("Note")
    active = fields.Boolean(default=True)
    tractor_vehicle_ids = fields.One2many("eguitra.transport.vehicle", "tractor_id", "Ensembles (tracteur)")
    trailer_vehicle_ids = fields.One2many("eguitra.transport.vehicle", "trailer_id", "Ensembles (remorque)")

    _fleet_number_unique = models.Constraint("unique(company_id, kind, fleet_number)",
                                             "Ce numéro de parc existe déjà pour ce type d'engin.")

    @api.depends("fleet_number", "plate", "kind")
    def _compute_display_name(self):
        for unit in self:
            plate = f" ({unit.plate})" if unit.plate else ""
            unit.display_name = f"{unit.fleet_number or ''}{plate}"

    @api.constrains("capacity_liters")
    def _check_capacity(self):
        if any((u.capacity_liters or 0) < 0 for u in self):
            raise ValidationError("La capacité d'une remorque ne peut pas être négative.")

    def _vehicle(self):
        """Ensemble auquel l'engin est rattaché aujourd'hui (le premier actif)."""
        self.ensure_one()
        vehicles = self.tractor_vehicle_ids if self.kind == "tractor" else self.trailer_vehicle_ids
        return vehicles.filtered("active")[:1]

    def _label(self):
        """« TR-01 (RC-1234-A) » : numéro de parc et immatriculation, pour les documents."""
        self.ensure_one()
        return self.display_name


class EguitraTransportVehicle(models.Model):
    _inherit = "eguitra.transport.vehicle"

    tractor_id = fields.Many2one("eguitra.transport.unit", "Tracteur", check_company=True, index=True,
                                 domain=[("kind", "=", "tractor")], ondelete="restrict")
    trailer_id = fields.Many2one("eguitra.transport.unit", "Remorque", check_company=True, index=True,
                                 domain=[("kind", "=", "trailer")], ondelete="restrict",
                                 help="Une remorque rattachée ici quitte l'ensemble qui la portait.")
    # Immatriculations enregistrées (lues par la facture, HSSEQ, les relevés, l'application mobile) : elles
    # suivent le tracteur et la remorque ; les écrire crée ou met à jour l'engin.
    tractor_plate = fields.Char("Immatriculation du tracteur", compute="_compute_plates", inverse="_inverse_tractor_plate",
                                store=True, readonly=False)
    trailer_plate = fields.Char("Immatriculation de la citerne", compute="_compute_plates",
                                inverse="_inverse_trailer_plate", store=True, readonly=False)
    fuel_consumption = fields.Float(
        "Consommation (L/100 km)", digits=(6, 1),
        help="Consommation habituelle de l'ensemble chargé : pré-remplit le carburant du budget de voyage "
             "(aller-retour de la route × consommation). Vide : carburant de référence de la route.")

    @api.depends("tractor_id.plate", "trailer_id.plate")
    def _compute_plates(self):
        for vehicle in self:
            # Sans engin rattaché, l'immatriculation saisie (reprise, écrans antérieurs) reste telle quelle.
            if vehicle.tractor_id:
                vehicle.tractor_plate = vehicle.tractor_id.plate
            if vehicle.trailer_id:
                vehicle.trailer_plate = vehicle.trailer_id.plate

    def _unit_for(self, kind, plate):
        """Engin du type, créé au besoin avec le code de l'ensemble pour numéro de parc (à corriger ensuite
        dans Flotte si le parc numérote autrement ses tracteurs et ses remorques)."""
        self.ensure_one()
        Unit = self.env["eguitra.transport.unit"].sudo()
        number = self.name
        unit = Unit.with_context(active_test=False).search(
            [("company_id", "=", self.company_id.id), ("kind", "=", kind), ("fleet_number", "=", number)], limit=1)
        if unit:
            unit.plate = plate
            return unit
        return Unit.create({"kind": kind, "fleet_number": number, "plate": plate, "company_id": self.company_id.id,
                            "capacity_liters": self.capacity_liters if kind == "trailer" else 0})

    def _inverse_tractor_plate(self):
        for vehicle in self:
            if vehicle.tractor_id:
                if vehicle.tractor_id.plate != vehicle.tractor_plate:
                    vehicle.tractor_id.sudo().plate = vehicle.tractor_plate
            elif vehicle.tractor_plate:
                vehicle.tractor_id = vehicle._unit_for("tractor", vehicle.tractor_plate)

    def _inverse_trailer_plate(self):
        for vehicle in self:
            if vehicle.trailer_id:
                if vehicle.trailer_id.plate != vehicle.trailer_plate:
                    vehicle.trailer_id.sudo().plate = vehicle.trailer_plate
            elif vehicle.trailer_plate:
                vehicle.trailer_id = vehicle._unit_for("trailer", vehicle.trailer_plate)

    @api.constrains("tractor_id", "trailer_id")
    def _check_units(self):
        for vehicle in self:
            if vehicle.tractor_id and vehicle.tractor_id.kind != "tractor":
                raise ValidationError(f"Ensemble {vehicle.name} : {vehicle.tractor_id.fleet_number} n'est pas un tracteur.")
            if vehicle.trailer_id and vehicle.trailer_id.kind != "trailer":
                raise ValidationError(f"Ensemble {vehicle.name} : {vehicle.trailer_id.fleet_number} n'est pas une remorque.")

    @api.constrains("fuel_consumption")
    def _check_consumption(self):
        if any((v.fuel_consumption or 0) < 0 for v in self):
            raise ValidationError("La consommation d'un ensemble ne peut pas être négative.")

    def _release_units(self):
        """Un tracteur ou une remorque n'appartient qu'à un ensemble actif à la fois : rattaché ici, il quitte
        l'ensemble qui le portait (une remorque change de tracteur)."""
        for vehicle in self:
            for field in ("tractor_id", "trailer_id"):
                unit = vehicle[field]
                if not unit:
                    continue
                others = self.search([("id", "!=", vehicle.id), (field, "=", unit.id)])
                if others:
                    # Écriture directe : l'immatriculation enregistrée des autres ensembles est gardée telle quelle.
                    super(EguitraTransportVehicle, others).write({field: False})

    @api.model_create_multi
    def create(self, vals_list):
        vehicles = super().create(vals_list)
        vehicles.filtered(lambda v: v.tractor_id or v.trailer_id)._release_units()
        return vehicles

    def write(self, vals):
        result = super().write(vals)
        if {"tractor_id", "trailer_id"} & set(vals):
            self._release_units()
        if "capacity_liters" in vals:
            # Capacité de l'ensemble (écrans et reprise antérieurs) : celle de sa remorque.
            for vehicle in self.filtered("trailer_id"):
                if vehicle.trailer_id.capacity_liters != vehicle.capacity_liters:
                    vehicle.trailer_id.sudo().capacity_liters = vehicle.capacity_liters
        return result


class EguitraTransportDriver(models.Model):
    _inherit = "eguitra.transport.driver"

    crew_role = fields.Selection(CREW_ROLES, "Fonction", default="driver", required=True,
                                 help="Chauffeur, ou convoyeur (aide-chauffeur) qui l'accompagne.")

    def _ensure_partner(self):
        """Fiche tiers du chauffeur (avances de frais de route, créances) : créée au besoin à son nom."""
        self.ensure_one()
        if not self.partner_id:
            self.sudo().partner_id = self.env["res.partner"].sudo().create({
                "name": self.name, "phone": self.phone or False, "company_id": self.company_id.id,
            })
        return self.sudo().partner_id


class EguitraTransportRotation(models.Model):
    _inherit = "eguitra.transport.rotation"

    tractor_id = fields.Many2one("eguitra.transport.unit", "Tracteur", check_company=True, index=True,
                                 domain=[("kind", "=", "tractor")],
                                 help="Tracteur qui a roulé ; vide à la saisie : celui de l'ensemble.")
    trailer_id = fields.Many2one("eguitra.transport.unit", "Remorque", check_company=True, index=True,
                                 domain=[("kind", "=", "trailer")],
                                 help="Remorque qui a roulé ; vide à la saisie : celle de l'ensemble.")
    co_driver_id = fields.Many2one("eguitra.transport.driver", "Convoyeur", check_company=True,
                                   help="Aide-chauffeur qui accompagne le chauffeur.")
    date_planned_departure = fields.Date("Départ prévu (ETD)")
    date_planned_arrival = fields.Date("Arrivée prévue (ETA)")
    date_planned_return = fields.Date("Retour prévu à la base (ETR)")

    @api.constrains("date_planned_departure", "date_planned_arrival", "date_planned_return")
    def _check_planned_dates(self):
        for rot in self:
            start, arrival, back = rot.date_planned_departure, rot.date_planned_arrival, rot.date_planned_return
            if start and arrival and arrival < start:
                raise ValidationError(f"Rotation {rot._label()} : l'arrivée prévue précède le départ prévu.")
            if back and (arrival or start) and back < (arrival or start):
                raise ValidationError(f"Rotation {rot._label()} : le retour prévu précède l'arrivée prévue.")

    @api.constrains("driver_id", "co_driver_id")
    def _check_crew(self):
        for rot in self:
            if rot.co_driver_id and rot.co_driver_id == rot.driver_id:
                raise ValidationError(f"Rotation {rot._label()} : le convoyeur n'est pas le chauffeur.")

    @api.depends("volume_loaded", "vehicle_id.capacity_liters", "trailer_id.capacity_liters")
    def _compute_over_capacity(self):
        # Capacité de la remorque qui a roulé, à défaut celle de l'ensemble.
        for rot in self:
            capacity = rot.trailer_id.capacity_liters or rot.vehicle_id.capacity_liters
            rot.over_capacity = bool(capacity) and float_compare(
                (rot.volume_loaded or 0.0) * 1000, capacity, precision_digits=0) > 0

    def _capacity_liters(self):
        self.ensure_one()
        return self.trailer_id.capacity_liters or self.vehicle_id.capacity_liters

    @api.model
    def _units_from_vehicle(self, vals):
        """Tracteur et remorque de l'ensemble, quand la saisie ne les donne pas (Rotations, reprise, écrans)."""
        if vals.get("vehicle_id"):
            vehicle = self.env["eguitra.transport.vehicle"].browse(vals["vehicle_id"])
            if "tractor_id" not in vals and vehicle.tractor_id:
                vals["tractor_id"] = vehicle.tractor_id.id
            if "trailer_id" not in vals and vehicle.trailer_id:
                vals["trailer_id"] = vehicle.trailer_id.id
        return vals

    @api.model_create_multi
    def create(self, vals_list):
        return super().create([self._units_from_vehicle(dict(vals)) for vals in vals_list])

    def write(self, vals):
        if vals.get("vehicle_id") and not ({"tractor_id", "trailer_id"} & set(vals)):
            # Changement d'ensemble sans engin désigné : ceux du nouvel ensemble.
            vals = self._units_from_vehicle(dict(vals))
        return super().write(vals)
