"""Public d'une publication du cabinet (communication, événement) : tous les porteurs, certains dossiers,
les dossiers arrivés à certaines étapes ou ceux de certains secteurs."""

from odoo import api, fields, models
from odoo.exceptions import UserError

AUDIENCES = [
    ("all", "Tous les porteurs"),
    ("dossiers", "Dossiers choisis"),
    ("gates", "Dossiers à certaines étapes"),
    ("sectors", "Dossiers de certains secteurs"),
]


def split_list(value):
    """« G0, G1 ; G2 » -> ["G0", "G1", "G2"] (liste saisie librement, sans doublon)."""
    seen = []
    for item in (value or "").replace(";", ",").split(","):
        item = item.strip()
        if item and item not in seen:
            seen.append(item)
    return seen


class PortailAudienceMixin(models.AbstractModel):
    _name = "portail.audience.mixin"
    _description = "Public d'une publication du portail"

    audience = fields.Selection(AUDIENCES, "Public", default="all", required=True)
    dossier_ids = fields.Many2many("axispro.dossier", string="Dossiers visés")
    gate_codes = fields.Char("Étapes visées", help="Codes des étapes, séparés par des virgules (G0, G1...).")
    sector_keywords = fields.Char("Secteurs visés", help="Mots des secteurs, séparés par des virgules.")

    @api.constrains("audience", "dossier_ids", "gate_codes", "sector_keywords")
    def _check_audience(self):
        for record in self:
            if record.audience == "dossiers" and not record.dossier_ids:
                raise UserError("Choisissez au moins un dossier.")
            if record.audience == "gates" and not split_list(record.gate_codes):
                raise UserError("Indiquez au moins une étape (G0, G1...).")
            if record.audience == "sectors" and not split_list(record.sector_keywords):
                raise UserError("Indiquez au moins un secteur.")

    def _matches(self, dossiers):
        """Un des dossiers (ceux d'un porteur) fait-il partie du public ?"""
        self.ensure_one()
        dossiers = dossiers.filtered(lambda d: d.company_id == self.company_id)
        if not dossiers:
            return False
        if self.audience == "all":
            return True
        if self.audience == "dossiers":
            return bool(dossiers & self.dossier_ids)
        if self.audience == "gates":
            codes = set(split_list(self.gate_codes))
            return any(d.current_gate_id.code in codes for d in dossiers)
        words = [w.lower() for w in split_list(self.sector_keywords)]
        return any(any(w in (d.sector or "").lower() for w in words) for d in dossiers)

    def _audience_dossiers(self):
        """Dossiers ouverts du public, dans la société de la publication."""
        self.ensure_one()
        Dossier = self.env["axispro.dossier"].sudo()
        dossiers = Dossier.search([("company_id", "=", self.company_id.id), ("state", "!=", "closed")])
        return dossiers.filtered(lambda d: self._matches(d))

    def _audience_users(self):
        return self._audience_dossiers().portal_user_ids.filtered("active")
