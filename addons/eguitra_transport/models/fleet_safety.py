"""Préparation du module HSSEQ : profil des ensembles, documents à échéance, charge utile, pesée.

- Profil : citerne (hydrocarbures, au m³) ou benne (vrac solide, à la tonne).
- Documents de l'ensemble avec date d'expiration : assurance et visite technique pour tous ; barémage et
  certificat d'étanchéité pour une citerne. Un document vaut jusqu'à sa date d'expiration ; il est
  « à renouveler » dans les 30 jours qui la précèdent.
- Charge utile (tonnes) et ticket de pesée de la rotation (poids brut, à vide, net) : une benne pesée
  au-delà de sa charge utile est signalée.
- Motifs qui s'opposent au départ d'une rotation (_departure_blockers) : liste de dict {code, message,
  severity}, « block » pour un motif bloquant, « warn » pour une vigilance. Le Transport y met ses
  contrôles ; le module HSSEQ y ajoute les siens en surchargeant la méthode.
"""

from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError

VEHICLE_KINDS = [("tanker", "Citerne"), ("tipper", "Benne")]
DOCUMENT_KINDS = [
    ("insurance", "Assurance"),
    ("technical_inspection", "Visite technique"),
    ("calibration", "Barémage de la citerne"),
    ("tightness", "Certificat d'étanchéité de la citerne"),
    ("other", "Autre document"),
]
# Documents exigés selon le profil de l'ensemble.
REQUIRED_DOCUMENTS = {
    "tanker": ("insurance", "technical_inspection", "calibration", "tightness"),
    "tipper": ("insurance", "technical_inspection"),
}
EXPIRY_WARNING_DAYS = 30


class EguitraTransportVehicleDocument(models.Model):
    _name = "eguitra.transport.vehicle.document"
    _description = "Document d'un ensemble routier"
    _order = "vehicle_id, kind, date_expiry desc, id desc"

    vehicle_id = fields.Many2one("eguitra.transport.vehicle", "Ensemble", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="vehicle_id.company_id", store=True, index=True)
    kind = fields.Selection(DOCUMENT_KINDS, "Document", required=True)
    name = fields.Char("Libellé", help="Pour un autre document : sa nature.")
    reference = fields.Char("Numéro")
    issuer = fields.Char("Délivré par", help="Assureur, centre de visite, service de métrologie…")
    date_issue = fields.Date("Délivré le")
    date_expiry = fields.Date("Valable jusqu'au", required=True)
    note = fields.Text("Note")
    active = fields.Boolean(default=True)

    @api.constrains("date_issue", "date_expiry")
    def _check_dates(self):
        for doc in self:
            if doc.date_issue and doc.date_expiry < doc.date_issue:
                raise ValidationError("La date d'expiration précède la date de délivrance.")

    def _state(self, day=None):
        """« valid », « expiring » (dans les 30 jours) ou « expired » à une date (aujourd'hui par défaut)."""
        self.ensure_one()
        day = day or fields.Date.context_today(self)
        if self.date_expiry < day:
            return "expired"
        return "expiring" if self.date_expiry <= day + timedelta(days=EXPIRY_WARNING_DAYS) else "valid"


class EguitraTransportVehicle(models.Model):
    _inherit = "eguitra.transport.vehicle"

    vehicle_kind = fields.Selection(VEHICLE_KINDS, "Profil", default="tanker", required=True)
    payload_tons = fields.Float("Charge utile (t)", digits=(8, 2), help="Poids de chargement autorisé.")
    document_ids = fields.One2many("eguitra.transport.vehicle.document", "vehicle_id", "Documents")

    def _current_documents(self):
        """Document le plus récent (dernière expiration) de chaque nature."""
        self.ensure_one()
        latest = {}
        for doc in self.document_ids.sorted("date_expiry", reverse=True):
            latest.setdefault(doc.kind, doc)
        return latest

    def _document_issues(self, day=None):
        """Documents manquants, expirés ou à renouveler, au format des motifs de départ."""
        self.ensure_one()
        day = day or fields.Date.context_today(self)
        labels = dict(DOCUMENT_KINDS)
        latest = self._current_documents()
        issues = []
        for kind in REQUIRED_DOCUMENTS.get(self.vehicle_kind, ()):
            doc = latest.get(kind)
            if not doc:
                issues.append({"code": f"document_missing:{kind}", "severity": "block",
                               "message": f"{self.name} : {labels[kind].lower()} non renseigné."})
                continue
            state = doc._state(day)
            if state == "expired":
                issues.append({"code": f"document_expired:{kind}", "severity": "block",
                               "message": f"{self.name} : {labels[kind].lower()} expiré le {doc.date_expiry:%d/%m/%Y}."})
            elif state == "expiring":
                issues.append({"code": f"document_expiring:{kind}", "severity": "warn",
                               "message": f"{self.name} : {labels[kind].lower()} à renouveler avant le "
                                          f"{doc.date_expiry:%d/%m/%Y}."})
        return issues


class EguitraTransportRotation(models.Model):
    _inherit = "eguitra.transport.rotation"

    weigh_ticket = fields.Char("Ticket de pesée")
    weight_gross = fields.Float("Poids brut (t)", digits=(10, 3))
    weight_tare = fields.Float("Poids à vide (t)", digits=(10, 3))
    weight_net = fields.Float("Poids net (t)", digits=(10, 3), compute="_compute_weight", store=True)
    over_payload = fields.Boolean("Au-delà de la charge utile", compute="_compute_weight", store=True)

    @api.depends("weight_gross", "weight_tare", "vehicle_id.payload_tons")
    def _compute_weight(self):
        for rot in self:
            net = rot.weight_gross - rot.weight_tare if rot.weight_gross and rot.weight_tare else 0.0
            rot.weight_net = net
            payload = rot.vehicle_id.payload_tons
            rot.over_payload = bool(payload and net > payload)

    @api.constrains("weight_gross", "weight_tare")
    def _check_weights(self):
        for rot in self:
            if rot.weight_gross and rot.weight_tare and rot.weight_tare > rot.weight_gross:
                raise ValidationError("Le poids à vide dépasse le poids brut du ticket de pesée.")

    def _departure_blockers(self):
        """Motifs qui s'opposent au départ de la rotation : documents de l'ensemble (manquants ou expirés :
        bloquants ; à renouveler : vigilance), chargement au-delà de la capacité de la citerne ou de la
        charge utile de la benne. Le module HSSEQ ajoute les siens (super() puis ses motifs)."""
        self.ensure_one()
        blockers = list(self.vehicle_id._document_issues(self.date_loading)) if self.vehicle_id else []
        if self.over_capacity:
            blockers.append({"code": "over_capacity", "severity": "block",
                             "message": f"{self.vehicle_id.name} : volume chargé au-delà de la capacité de la citerne."})
        if self.over_payload:
            blockers.append({"code": "over_payload", "severity": "block",
                             "message": f"{self.vehicle_id.name} : poids net au-delà de la charge utile."})
        return blockers
