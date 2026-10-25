"""Données et crochets du Transport pour le module HSSEQ (contrat convenu avec la session HSSEQ).

- Profil de l'ensemble : citerne (hydrocarbures, au m³) ou benne (vrac minier, à la tonne), et charge
  utile en tonnes.
- Documents de l'ensemble à échéance, avec historique : assurance, visite technique ; barémage et
  certificat d'étanchéité pour une citerne. Aides _expired_documents et _missing_documents : HSSEQ en
  fait ses motifs V05 et V06, le Transport ne les code pas lui-même.
- Ticket de pesée de la rotation (poids brut, à vide, net) et _overload() : HSSEQ en fait le motif V07.
- Départ : la rotation passe de « saisie » à « en route » par action_depart, que le serveur refuse tant
  qu'un motif bloquant reste ouvert (_departure_blockers). Le Transport n'y met que ses motifs
  d'exploitation (T01 : ensemble indisponible) ; HSSEQ y ajoute V01 à V09 et retire les motifs couverts
  par une dérogation (_departure_waived les liste pour la trace du départ). La validation (passage à
  « validée ») appelle _validation_blockers, vide ici : HSSEQ l'utilise pour exiger le départ.
- Format d'un motif : {code, label, source, since, waivable, severity} ; severity « block » ou « warn ».
"""

import json
from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError

from ..blocking import RotationBlocked, motif

VEHICLE_KINDS = [("tanker", "Citerne"), ("tipper", "Benne")]
DOCUMENT_KINDS = [
    ("insurance", "Assurance"),
    ("inspection", "Visite technique"),
    ("calibration", "Barémage de la citerne"),
    ("tightness", "Certificat d'étanchéité de la citerne"),
]
# Documents exigés selon le profil de l'ensemble.
REQUIRED_DOCUMENTS = {"tanker": ("insurance", "inspection", "calibration", "tightness"),
                      "tipper": ("insurance", "inspection")}
EXPIRY_WARNING_DAYS = 30
# États d'un ensemble qui ne part pas (motif T01).
UNAVAILABLE = {"maintenance": "en maintenance", "off": "hors service", "sold": "cédé"}


class EguitraTransportVehicleDocument(models.Model):
    _name = "eguitra.transport.vehicle.document"
    _description = "Document d'un ensemble routier"
    _order = "vehicle_id, kind, expiry_date desc, id desc"

    vehicle_id = fields.Many2one("eguitra.transport.vehicle", "Ensemble", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="vehicle_id.company_id", store=True, index=True)
    kind = fields.Selection(DOCUMENT_KINDS, "Document", required=True)
    reference = fields.Char("Numéro")
    issuer = fields.Char("Délivré par", help="Assureur, centre de visite, service de métrologie…")
    date_start = fields.Date("Valable à partir du")
    expiry_date = fields.Date("Valable jusqu'au", required=True)
    attachment_id = fields.Many2one("ir.attachment", "Pièce jointe", ondelete="set null")
    note = fields.Text("Note")

    @api.constrains("date_start", "expiry_date")
    def _check_dates(self):
        for doc in self:
            if doc.date_start and doc.expiry_date < doc.date_start:
                raise ValidationError("La date d'expiration précède la date de début de validité.")

    def _state(self, day=None):
        """« valid », « expiring » (dans les 30 jours) ou « expired » à une date (aujourd'hui par défaut)."""
        self.ensure_one()
        day = day or fields.Date.context_today(self)
        if self.expiry_date < day:
            return "expired"
        return "expiring" if self.expiry_date <= day + timedelta(days=EXPIRY_WARNING_DAYS) else "valid"


class EguitraTransportVehicle(models.Model):
    _inherit = "eguitra.transport.vehicle"

    vehicle_kind = fields.Selection(VEHICLE_KINDS, "Profil", default="tanker", required=True)
    payload_tonnes = fields.Float("Charge utile (t)", digits=(8, 2), help="Poids de chargement autorisé.")
    document_ids = fields.One2many("eguitra.transport.vehicle.document", "vehicle_id", "Documents")

    def _latest_documents(self):
        """Document le plus récent (dernière expiration) de chaque nature."""
        self.ensure_one()
        latest = {}
        for doc in self.document_ids.sorted("expiry_date", reverse=True):
            latest.setdefault(doc.kind, doc)
        return latest

    def _required_kinds(self, kinds=None):
        self.ensure_one()
        return tuple(kinds) if kinds is not None else REQUIRED_DOCUMENTS.get(self.vehicle_kind, ())

    def _expired_documents(self, on_date, kinds=None):
        """Documents expirés à une date : le plus récent de chaque nature (toutes celles qu'exige le profil,
        ou celles de kinds), retenu si sa date d'expiration est passée."""
        self.ensure_one()
        latest = self._latest_documents()
        docs = self.env["eguitra.transport.vehicle.document"]
        for kind in self._required_kinds(kinds):
            doc = latest.get(kind)
            if doc and doc.expiry_date < on_date:
                docs |= doc
        return docs

    def _missing_documents(self, kinds=None):
        """Natures de document exigées par le profil (ou celles de kinds) dont l'ensemble n'a aucun document."""
        self.ensure_one()
        latest = self._latest_documents()
        return [kind for kind in self._required_kinds(kinds) if kind not in latest]

    def _document_issues(self, day=None):
        """Documents manquants, expirés ou à renouveler, pour les écrans et les contrôles (pas un motif de
        départ : le verrou est celui du module HSSEQ)."""
        self.ensure_one()
        day = day or fields.Date.context_today(self)
        labels = dict(DOCUMENT_KINDS)
        issues = [{"code": f"document_missing:{kind}", "severity": "block",
                   "label": f"{self.name} : {labels[kind].lower()} non renseigné."} for kind in self._missing_documents()]
        latest = self._latest_documents()
        for kind in self._required_kinds():
            doc = latest.get(kind)
            if not doc:
                continue
            state = doc._state(day)
            if state == "expired":
                issues.append({"code": f"document_expired:{kind}", "severity": "block",
                               "label": f"{self.name} : {labels[kind].lower()} expiré le {doc.expiry_date:%d/%m/%Y}."})
            elif state == "expiring":
                issues.append({"code": f"document_expiring:{kind}", "severity": "warn",
                               "label": f"{self.name} : {labels[kind].lower()} à renouveler avant le "
                                        f"{doc.expiry_date:%d/%m/%Y}."})
        return issues


class EguitraTransportRotation(models.Model):
    _inherit = "eguitra.transport.rotation"

    weigh_ticket = fields.Char("Ticket de pesée")
    weight_gross = fields.Float("Poids brut (t)", digits=(10, 3))
    weight_tare = fields.Float("Poids à vide (t)", digits=(10, 3))
    weight_net = fields.Float("Poids net (t)", digits=(10, 3), compute="_compute_weight", store=True)
    over_payload = fields.Boolean("Au-delà de la charge utile", compute="_compute_weight", store=True)
    departed_at = fields.Datetime("Parti le", readonly=True, copy=False)
    departed_by = fields.Many2one("res.users", "Départ donné par", readonly=True, copy=False)
    departure_log = fields.Text("Avertissements et dérogations du départ", readonly=True, copy=False,
                                help="JSON : avertissements et motifs dérogés au moment du départ.")

    @api.depends("weight_gross", "weight_tare", "vehicle_id.payload_tonnes")
    def _compute_weight(self):
        for rot in self:
            rot.weight_net = rot.weight_gross - rot.weight_tare if rot.weight_gross and rot.weight_tare else 0.0
            rot.over_payload = rot._overload() > 0

    @api.constrains("weight_gross", "weight_tare")
    def _check_weights(self):
        for rot in self:
            if rot.weight_gross and rot.weight_tare and rot.weight_tare > rot.weight_gross:
                raise ValidationError("Le poids à vide dépasse le poids brut du ticket de pesée.")

    def _overload(self):
        """Tonnes au-delà de la charge utile de l'ensemble (poids net du ticket de pesée), 0 sinon."""
        self.ensure_one()
        net = self.weight_gross - self.weight_tare if self.weight_gross and self.weight_tare else 0.0
        payload = self.vehicle_id.payload_tonnes
        return max(0.0, net - payload) if payload and net else 0.0

    # ─── Départ et validation ─────────────────────────────────────────────

    def _departure_blockers(self):
        """Motifs qui s'opposent au départ. Transport : T01, ensemble en maintenance, hors service ou cédé.
        Le module HSSEQ ajoute les siens (super() puis V01 à V09) et retire ceux qu'une dérogation couvre."""
        self.ensure_one()
        vehicle = self.vehicle_id
        if vehicle and vehicle.state in UNAVAILABLE:
            return [motif("T01", f"{vehicle.name} est {UNAVAILABLE[vehicle.state]} : il ne part pas en rotation.",
                          "transport")]
        return []

    def _departure_waived(self):
        """Motifs dérogés pour ce départ, écrits dans sa trace ; le module HSSEQ les fournit."""
        return []

    def _validation_blockers(self):
        """Motifs qui s'opposent à la validation (passage à « validée ») ; vide ici. Le module HSSEQ y exige
        le passage par « en route » des rotations chargées après sa mise en service."""
        return []

    def action_depart(self):
        """Départ en route, évalué par le serveur au moment de la demande (jamais en file hors ligne)."""
        for rot in self:
            if rot.state != "draft":
                raise UserError(f"Rotation {rot._label()} : seule une rotation saisie part en route.")
            blockers = rot._departure_blockers()
            blocking = [b for b in blockers if b["severity"] == "block"]
            if blocking:
                raise RotationBlocked(f"Départ refusé pour la rotation {rot._label()}", blockers)
            warnings, waived = [b for b in blockers if b["severity"] == "warn"], rot._departure_waived()
            rot.write({
                "state": "en_route", "departed_at": fields.Datetime.now(), "departed_by": self.env.user.id,
                "departure_log": json.dumps({"warnings": warnings, "waived": waived}, ensure_ascii=False, default=str)
                if warnings or waived else False,
            })
        return True

    def action_validate(self):
        for rot in self.filtered(lambda r: r.state in ("draft", "en_route")):
            blockers = rot._validation_blockers()
            if any(b["severity"] == "block" for b in blockers):
                raise RotationBlocked(f"Validation refusée pour la rotation {rot._label()}", blockers)
        return super().action_validate()

    def action_reset(self):
        # Retour en saisie d'une rotation partie : le départ sera à redonner (la piste d'audit garde l'ancien).
        en_route = self.filtered(lambda r: r.state == "en_route")
        en_route.write({"state": "draft", "departed_at": False, "departed_by": False, "departure_log": False})
        return super().action_reset()
