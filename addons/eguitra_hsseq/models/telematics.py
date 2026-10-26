"""Violations de conduite relevées par la télématique (OBC, GPS, IVMS) : modèle d'import générique, en
attendant l'interface du fournisseur (spécification §12, lot 3 bis, à chiffrer avec lui).

Un fichier CSV ou Excel exporté du système du fournisseur est importé par le Responsable HSSEQ (contrôle du
fichier par eguitra_api/files.py) : date et heure, véhicule (code de l'ensemble ou immatriculation),
chauffeur (facultatif), type (excès de vitesse, freinage brusque, conduite de nuit, temps de conduite),
source, et facultativement valeur, seuil, durée, lieu et identifiant de la violation chez le fournisseur.
L'import est tout ou rien : une ligne illisible le refuse en entier, avec la liste des lignes en cause ; une
violation déjà importée (même identifiant et même source, ou même véhicule, type et horodatage) est ignorée.
La rotation en cours du véhicule à cette date est rattachée, et son chauffeur à défaut d'un chauffeur reconnu.
La date et l'heure peuvent venir d'une seule colonne ou de deux (« Date » et « Heure »). Un import refusé
laisse sa trace (import « refusé » avec ses erreurs).

Le cockpit compte les violations par 100 voyages (départs du mois)."""

import re
import unicodedata
from datetime import date, datetime, time, timedelta

from odoo import api, fields, models

from .common import VIOLATION_TYPES, departed_states

HEADERS = {
    "occurred_at": ("date", "date heure", "date et heure", "horodatage", "occurred at", "timestamp"),
    "time": ("heure", "heure de l evenement", "heure locale", "time"),
    "vehicle": ("vehicule", "ensemble", "immatriculation", "code vehicule", "vehicle", "plaque"),
    "driver": ("chauffeur", "conducteur", "driver"),
    "violation_type": ("type", "type de violation", "violation", "infraction", "evenement", "alerte"),
    "source": ("source", "systeme", "fournisseur", "boitier"),
    "value": ("valeur", "vitesse", "vitesse relevee", "value"),
    "limit_value": ("seuil", "limite", "vitesse autorisee", "limit"),
    "duration_minutes": ("duree", "duree min", "duree minutes", "duree (min)"),
    "location": ("lieu", "position", "localisation", "location", "adresse"),
    "external_id": ("identifiant", "id", "reference", "external id", "numero"),
}
TYPE_WORDS = {
    "speeding": ("exces de vitesse", "survitesse", "vitesse", "speeding", "overspeed"),
    "harsh_braking": ("freinage brusque", "freinage", "harsh braking", "harsh brake"),
    "night_driving": ("conduite de nuit", "nuit", "night driving", "night"),
    "driving_time": ("temps de conduite", "temps de conduite depasse", "conduite continue", "driving time",
                     "fatigue"),
}
TYPE_CODES = dict(VIOLATION_TYPES)


def plain(value):
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9()]+", " ", text).split())


def compact(value):
    return re.sub(r"[^a-z0-9]", "", plain(value))


def parse_datetime(value):
    """Horodatage d'une cellule : date et heure du classeur, ou texte jj/mm/aaaa hh:mm[:ss], aaaa-mm-jj
    hh:mm[:ss] ou ISO 8601 (UTC, l'heure de Conakry)."""
    if isinstance(value, datetime):
        return value.replace(tzinfo=None, microsecond=0)
    if isinstance(value, date):
        return datetime.combine(value, time.min)
    text = str(value or "").strip()
    if not text:
        raise ValueError("date absente")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo:
            parsed = (parsed - parsed.utcoffset()).replace(tzinfo=None)
        return parsed.replace(microsecond=0)
    except ValueError:
        pass
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y", "%d-%m-%Y %H:%M:%S", "%d-%m-%Y %H:%M",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    raise ValueError(f"date illisible : {text}")


def parse_time(value):
    """Heure d'une cellule : heure du classeur, horodatage (son heure), fraction de jour, ou texte hh:mm[:ss]
    (« 8h30 » accepté)."""
    if isinstance(value, time):
        return value.replace(microsecond=0)
    if isinstance(value, datetime):
        return value.time().replace(microsecond=0)
    if isinstance(value, (int, float)) and 0 <= value < 1:
        seconds = min(round(value * 86400), 86399)
        return time(seconds // 3600, seconds % 3600 // 60, seconds % 60)
    text = str(value or "").strip().lower().replace(" ", "").replace("h", ":").rstrip(":")
    if not text:
        raise ValueError("heure absente")
    for fmt in ("%H:%M:%S", "%H:%M", "%H"):
        try:
            return datetime.strptime(text, fmt).time()
        except ValueError:
            continue
    raise ValueError(f"heure illisible : {value}")


def parse_number(value):
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = re.sub(r"[\s  ]", "", str(value)).replace(",", ".")
    cleaned = re.sub(r"[^0-9.\-]", "", cleaned)
    return float(cleaned) if cleaned not in ("", "-", ".") else None


def violation_type(value):
    text = plain(value)
    if text in TYPE_CODES:
        return text
    if text.replace(" ", "_") in TYPE_CODES:
        return text.replace(" ", "_")
    # Le libellé le plus long d'abord : « temps de conduite » avant « conduite de nuit », « freinage brusque »
    # avant « vitesse ».
    words = sorted(((w, code) for code, ws in TYPE_WORDS.items() for w in ws), key=lambda x: -len(x[0]))
    for word, code in words:
        if text == word or f" {word} " in f" {text} ":
            return code
    return None


class EguitraHsseqTelematicsImport(models.Model):
    _name = "eguitra.hsseq.telematics.import"
    _description = "Import de violations télématiques"
    _order = "imported_at desc, id desc"

    name = fields.Char("Fichier", required=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    state = fields.Selection([("done", "Importé"), ("rejected", "Refusé")], "État", required=True, default="done",
                             index=True)
    errors = fields.Json("Erreurs", help="Lignes en erreur d'un import refusé : [{line, message}].")
    error_count = fields.Integer("Lignes en erreur")
    source = fields.Char("Source", help="Système ou fournisseur : OBC, GPS, IVMS…")
    imported_by = fields.Many2one("res.users", "Importé par", required=True, default=lambda self: self.env.uid)
    imported_at = fields.Datetime("Importé le", required=True, default=fields.Datetime.now)
    row_count = fields.Integer("Lignes lues")
    created_count = fields.Integer("Violations créées")
    duplicate_count = fields.Integer("Doublons ignorés")
    warnings = fields.Json("Avertissements", help="Lignes dont le chauffeur n'a pas été reconnu.")
    violation_ids = fields.One2many("eguitra.hsseq.telematics.violation", "import_id", "Violations")


class EguitraHsseqTelematicsViolation(models.Model):
    _name = "eguitra.hsseq.telematics.violation"
    _description = "Violation de conduite (télématique)"
    _order = "occurred_at desc, id desc"
    _check_company_auto = True

    company_id = fields.Many2one("res.company", required=True, index=True)
    occurred_at = fields.Datetime("Survenue le", required=True, index=True)
    vehicle_id = fields.Many2one("eguitra.transport.vehicle", "Ensemble routier", required=True, check_company=True,
                                 index=True, ondelete="restrict")
    site_id = fields.Many2one(related="vehicle_id.site_id", store=True, index=True, string="Site")
    driver_id = fields.Many2one("eguitra.transport.driver", "Chauffeur", check_company=True, index=True,
                                ondelete="set null")
    rotation_id = fields.Many2one("eguitra.transport.rotation", "Rotation", check_company=True, index=True,
                                  ondelete="set null")
    violation_type = fields.Selection(VIOLATION_TYPES, "Type", required=True, index=True)
    source = fields.Char("Source", required=True)
    value = fields.Float("Valeur relevée", digits=(10, 2), help="Vitesse en km/h, décélération…")
    limit_value = fields.Float("Seuil", digits=(10, 2))
    duration_minutes = fields.Float("Durée (minutes)", digits=(8, 1))
    location = fields.Char("Lieu")
    external_id = fields.Char("Identifiant chez le fournisseur", index=True)
    import_id = fields.Many2one("eguitra.hsseq.telematics.import", "Import", ondelete="set null", index=True)

    @api.model
    def _rotation_at(self, vehicle, moment):
        """Rotation partie du véhicule en cours au moment donné (chargée ce jour-là ou avant, pas encore
        revenue)."""
        day = moment.date()
        return self.env["eguitra.transport.rotation"].sudo().search([
            ("vehicle_id", "=", vehicle.id), ("state", "in", departed_states(self.env)), ("date_loading", "<=", day),
            "|", "|", ("date_return", ">=", day), "&", ("date_return", "=", False), ("date_delivery", ">=", day),
            "&", ("date_return", "=", False), ("date_delivery", "=", False)], order="date_loading desc, id desc", limit=1)

    @api.model
    def _parse(self, rows, companies, default_source=None):
        """Lignes d'un fichier (en-tête en première ligne) -> (valeurs à créer, erreurs [{line, message}],
        avertissements, doublons)."""
        if not rows:
            return [], [{"line": 1, "message": "Fichier vide."}], [], 0
        headers = [plain(h) for h in rows[0]]
        index = {}
        for i, header in enumerate(headers):
            for key, aliases in HEADERS.items():
                if header in aliases and key not in index:
                    index[key] = i
        missing = [k for k in ("occurred_at", "vehicle", "violation_type") if k not in index]
        if missing:
            return [], [{"line": 1, "message": "Colonnes attendues : date, véhicule, type (puis chauffeur, source, "
                                               "valeur, seuil, durée, lieu, identifiant)."}], [], 0
        if "source" not in index and not (default_source or "").strip():
            return [], [{"line": 1, "message": "Source manquante : une colonne « source » ou le champ source du "
                                               "formulaire (OBC, GPS, IVMS…)."}], [], 0
        Vehicle = self.env["eguitra.transport.vehicle"].sudo().with_context(active_test=False)
        vehicles = {}
        for vehicle in Vehicle.search([("company_id", "in", companies.ids)]):
            for label in (vehicle.name, vehicle.tractor_plate, vehicle.trailer_plate):
                if compact(label):
                    vehicles.setdefault(compact(label), vehicle)
        Driver = self.env["eguitra.transport.driver"].sudo().with_context(active_test=False)
        drivers = {}
        for driver in Driver.search([("company_id", "in", companies.ids)]):
            drivers.setdefault((driver.company_id.id, plain(driver.name)), driver)

        def cell(row, key):
            i = index.get(key)
            return row[i] if i is not None and i < len(row) else None

        values, errors, warnings, duplicates, seen = [], [], [], 0, set()
        for number, row in enumerate(rows[1:], start=2):
            if not any(c not in (None, "") for c in row):
                continue
            try:
                moment = parse_datetime(cell(row, "occurred_at"))
                # Colonne « Heure » à part : elle complète la date.
                if "time" in index and cell(row, "time") not in (None, ""):
                    moment = datetime.combine(moment.date(), parse_time(cell(row, "time")))
            except ValueError as e:
                errors.append({"line": number, "message": f"Date ou heure : {e}."})
                continue
            if moment > fields.Datetime.now() + timedelta(minutes=5):
                errors.append({"line": number, "message": "Date dans le futur."})
                continue
            vehicle = vehicles.get(compact(cell(row, "vehicle")))
            if not vehicle:
                errors.append({"line": number, "message": f"Véhicule inconnu : {cell(row, 'vehicle') or '(vide)'}."})
                continue
            kind = violation_type(cell(row, "violation_type"))
            if not kind:
                errors.append({"line": number, "message": f"Type inconnu : {cell(row, 'violation_type') or '(vide)'} "
                                                          "(excès de vitesse, freinage brusque, conduite de nuit, "
                                                          "temps de conduite)."})
                continue
            try:
                numbers = {k: parse_number(cell(row, k)) for k in ("value", "limit_value", "duration_minutes")}
            except ValueError:
                errors.append({"line": number, "message": "Valeur, seuil ou durée : nombre illisible."})
                continue
            source = str(cell(row, "source") or default_source or "").strip()[:64]
            external = str(cell(row, "external_id") or "").strip()[:128] or False
            key = ("ext", source, external) if external else ("row", vehicle.id, kind, moment)
            Violation = self.sudo()
            company = [("company_id", "=", vehicle.company_id.id)]
            exists = Violation.search_count(company + [("external_id", "=", external), ("source", "=", source)]) \
                if external else Violation.search_count(company + [("vehicle_id", "=", vehicle.id),
                                                                   ("violation_type", "=", kind),
                                                                   ("occurred_at", "=", moment)])
            if key in seen or exists:
                duplicates += 1
                continue
            seen.add(key)
            rotation = self._rotation_at(vehicle, moment)
            driver = self.env["eguitra.transport.driver"]
            label = str(cell(row, "driver") or "").strip()
            if label:
                driver = drivers.get((vehicle.company_id.id, plain(label)), driver)
                if not driver:
                    warnings.append({"line": number, "message": f"Chauffeur non reconnu : « {label} » ; celui de la "
                                                                "rotation est retenu s'il y en a une."})
            driver = driver or rotation.driver_id
            values.append({
                "company_id": vehicle.company_id.id, "occurred_at": moment, "vehicle_id": vehicle.id,
                "driver_id": driver.id or False, "rotation_id": rotation.id or False, "violation_type": kind,
                "source": source, "value": numbers["value"] or 0.0, "limit_value": numbers["limit_value"] or 0.0,
                "duration_minutes": numbers["duration_minutes"] or 0.0,
                "location": str(cell(row, "location") or "").strip()[:200] or False, "external_id": external,
            })
        return values, errors, warnings, duplicates
