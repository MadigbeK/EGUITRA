"""Barème officiel du transport des hydrocarbures et écarts des tarifs pratiqués.

Le barème national (arrêté A/2019/816/MH du Ministère des Hydrocarbures, 19 mars 2019, applicable au
1er avril 2019) fixe un tarif en GNF par litre pour chaque destination servie depuis un dépôt :
Conakry SGP, Kankan SGP, N'Zérékoré SGP et Kamsar CBG. Chiffres repris de l'annexe signée, qui fait
foi (le tableur de la SONAP diffère sur sept tarifs). La distance est une estimation : le tableur la
dérive du tarif (environ tarif ÷ 1,05) ; elle n'est gardée que lorsqu'elle est cohérente avec le tarif
signé.

Une route se rattache à une ligne du barème : c'est son tarif de référence. Un nouvel arrêté se charge
comme un nouveau barème ; la route suit alors la même destination du même dépôt dans le barème en
vigueur à la date de chargement. Les tarifs des routes, des clients et des rotations (en GNF par m³)
sont comparés au tarif officiel (× 1 000 L) : un écart au-delà de la tolérance de la société est
signalé, sans rien bloquer.
"""

import re
import unicodedata

from odoo import api, fields, models

DEPOTS = [
    ("conakry_sgp", "Conakry (dépôt SGP)"),
    ("kankan_sgp", "Kankan (dépôt SGP)"),
    ("nzerekore_sgp", "N'Zérékoré (dépôt SGP)"),
    ("kamsar_cbg", "Kamsar (dépôt CBG)"),
]
LITERS_PER_M3 = 1000


def slug(text):
    """Texte sans accent, casse ni ponctuation : « N'Zérékoré » et « Nzerekore » se rejoignent."""
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", text)


def destination_key(depot, destination):
    """Clé d'une destination d'un dépôt, d'un barème à l'autre."""
    return f"{depot}/{slug(destination)}"


class EguitraTransportOfficialScale(models.Model):
    _name = "eguitra.transport.official.scale"
    _description = "Barème officiel du transport des hydrocarbures"
    _order = "date_from desc, id desc"

    name = fields.Char("Texte", required=True, help="Par exemple : arrêté A/2019/816/MH.")
    authority = fields.Char("Autorité", help="Par exemple : Ministère des Hydrocarbures.")
    date_signed = fields.Date("Signé le")
    date_from = fields.Date("En vigueur à partir du", required=True)
    note = fields.Text("Note")
    rate_ids = fields.One2many("eguitra.transport.official.rate", "scale_id", "Tarifs")
    rate_count = fields.Integer("Nombre de destinations", compute="_compute_rate_count")

    @api.depends("rate_ids")
    def _compute_rate_count(self):
        for scale in self:
            scale.rate_count = len(scale.rate_ids)

    @api.model
    def _in_force(self, day):
        """Barème en vigueur à une date (le plus récent entré en vigueur), ou un enregistrement vide."""
        return self.search([("date_from", "<=", day or fields.Date.context_today(self))], limit=1)


class EguitraTransportOfficialRate(models.Model):
    _name = "eguitra.transport.official.rate"
    _description = "Tarif du barème officiel"
    _order = "scale_id, depot, sequence, id"
    _rec_names_search = ["destination", "prefecture"]

    scale_id = fields.Many2one("eguitra.transport.official.scale", "Barème", required=True, ondelete="cascade",
                               index=True)
    date_from = fields.Date(related="scale_id.date_from", store=True)
    depot = fields.Selection(DEPOTS, "Dépôt", required=True, index=True)
    sequence = fields.Integer("N°", help="Numéro de la destination dans l'annexe de l'arrêté.")
    destination = fields.Char("Destination", required=True)
    prefecture = fields.Char("Préfecture")
    rate = fields.Float("Tarif (GNF/L)", digits=(10, 2), required=True)
    distance_km = fields.Float("Distance estimée (km)", digits=(8, 1),
                               help="Estimation du tableur de la SONAP, dérivée du tarif ; à vérifier sur le terrain.")
    key = fields.Char("Clé", compute="_compute_key", store=True, index=True)

    _scale_key_unique = models.Constraint("unique(scale_id, key)", "Cette destination existe déjà dans ce barème.")

    @api.depends("depot", "destination")
    def _compute_key(self):
        for line in self:
            line.key = destination_key(line.depot, line.destination)

    @api.depends("depot", "destination", "rate")
    def _compute_display_name(self):
        depots = dict(DEPOTS)
        for line in self:
            depot = depots.get(line.depot, "").split(" (")[0]
            line.display_name = f"{line.destination} (depuis {depot})"

    def _rate_per_m3(self):
        """Tarif officiel en GNF par m³ (les tarifs des routes et des clients sont au m³)."""
        self.ensure_one()
        return round(self.rate * LITERS_PER_M3, 2)

    def _at(self, day):
        """Même destination du même dépôt dans le barème en vigueur à cette date ; vide si aucun barème
        n'est en vigueur ou si celui en vigueur ne la cite pas."""
        self.ensure_one()
        scale = self.env["eguitra.transport.official.scale"]._in_force(day)
        if not scale or scale == self.scale_id:
            return self if scale else self.browse()
        return self.search([("scale_id", "=", scale.id), ("key", "=", self.key)], limit=1)


def gap_pct(rate_per_m3, official):
    """Écart d'un tarif en GNF par m³ au tarif officiel (ligne de barème), en % ; None sans l'un des deux."""
    if not rate_per_m3 or not official:
        return None
    return (rate_per_m3 / official._rate_per_m3() - 1) * 100


class EguitraTransportRoute(models.Model):
    _inherit = "eguitra.transport.route"

    official_rate_id = fields.Many2one(
        "eguitra.transport.official.rate", "Tarif officiel de référence", ondelete="set null",
        help="Destination du barème officiel du transport des hydrocarbures desservie par cette route.")

    def _official_at(self, day):
        """Ligne du barème applicable à une date (barème en vigueur, même destination)."""
        self.ensure_one()
        return self.official_rate_id._at(day) if self.official_rate_id else self.official_rate_id

    def _suggest_official_rate(self):
        """Ligne du barème en vigueur pour l'arrivée de la route (« Conakry - Siguiri » : Siguiri), départagée
        par le dépôt que nomme le départ ; vide si rien ne correspond ou si le choix reste ambigu."""
        self.ensure_one()
        empty = self.env["eguitra.transport.official.rate"]
        scale = self.env["eguitra.transport.official.scale"]._in_force(fields.Date.context_today(self))
        parts = [p.strip() for p in (self.name or "").split(" - ")]
        arrival = self.destination or (parts[-1] if len(parts) > 1 else "")
        departure = self.origin or (parts[0] if len(parts) > 1 else "")
        if not scale or not arrival:
            return empty
        wanted = slug(arrival)
        candidates = scale.rate_ids.filtered(lambda r: slug(r.destination) == wanted)
        if len(candidates) > 1:
            city = slug(departure)
            candidates = candidates.filtered(lambda r: city and city.startswith(r.depot.split("_")[0]))
        return candidates if len(candidates) == 1 else empty


class EguitraTransportRotation(models.Model):
    _inherit = "eguitra.transport.rotation"

    def _official_gap(self):
        """(ligne du barème à la date de chargement, écart du tarif de la rotation en %) ; écart None sans
        tarif ou sans barème."""
        self.ensure_one()
        line = self.route_id._official_at(self.date_loading) if self.route_id else self.route_id.official_rate_id
        return line, gap_pct(self.rate, line)


class EguitraTransportTariff(models.Model):
    _inherit = "eguitra.transport.tariff"

    def _official_gap(self, day=None):
        """(ligne du barème en vigueur, écart du tarif du client en %)."""
        self.ensure_one()
        line = self.route_id._official_at(day or fields.Date.context_today(self))
        return line, gap_pct(self.rate, line)
