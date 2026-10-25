"""Sites (dépôts, bases) : nouveau référentiel d'HSSEQ, ni Transport ni RH n'en ayant. Un ensemble routier
est rattaché à un site (site_id ajouté au véhicule de Transport) ; un chef de parc (compte exploitation)
est rattaché à un ou plusieurs sites et ne lit alors que leurs objets. Aucun site : tous les sites."""

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .common import EXPLOITATION_GROUP, VEHICLE_KINDS


class EguitraHsseqSite(models.Model):
    _name = "eguitra.hsseq.site"
    _description = "Site HSSEQ (dépôt, base)"
    _order = "company_id, name"
    _check_company_auto = True

    name = fields.Char("Site", required=True)
    code = fields.Char("Code", required=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    default_vehicle_kind = fields.Selection(VEHICLE_KINDS, "Type de véhicule par défaut", default="tanker",
                                            required=True)
    manager_ids = fields.Many2many("res.users", "eguitra_hsseq_site_manager_rel", "site_id", "user_id",
                                   "Chefs de parc", help="Comptes du profil Exploitation transport rattachés au site.")
    vehicle_ids = fields.One2many("eguitra.transport.vehicle", "site_id", "Ensembles du site")
    active = fields.Boolean(default=True)

    _code_company_unique = models.Constraint("unique(code, company_id)", "Ce code de site existe déjà dans la société.")

    @api.constrains("manager_ids", "company_id")
    def _check_managers(self):
        for site in self:
            for user in site.manager_ids:
                if not user.has_group(EXPLOITATION_GROUP):
                    raise ValidationError(f"{user.name} n'a pas le profil Exploitation transport : seul un chef de "
                                          "parc se rattache à un site.")
                if site.company_id not in user.company_ids:
                    raise ValidationError(f"{user.name} n'est pas ouvert à la société {site.company_id.name}.")


class EguitraTransportVehicle(models.Model):
    _inherit = "eguitra.transport.vehicle"

    site_id = fields.Many2one("eguitra.hsseq.site", "Site HSSEQ", check_company=True, index=True,
                              ondelete="set null")


class ResUsers(models.Model):
    _inherit = "res.users"

    def _hsseq_site_ids(self):
        """Sites auxquels le compte est rattaché comme chef de parc (vide : aucun bornage)."""
        self.ensure_one()
        return self.env["eguitra.hsseq.site"].sudo().search([("manager_ids", "in", self.ids)])

    def _hsseq_employee(self):
        """Dossier salarié en cours du compte (RH), celui de la société de travail en priorité."""
        self.ensure_one()
        employees = self._eguitra_employees()
        return employees.filtered(lambda e: e.company_id == self.env.company)[:1] or employees[:1]

    def _hsseq_driver(self):
        """Chauffeur de Transport du compte, par son dossier salarié (employee.user_id, employee.driver_id)."""
        self.ensure_one()
        return self._hsseq_employee().sudo().driver_id

    def _eguitra_apps(self):
        """Un compte qui n'a que le profil conducteur n'ouvre que NIMOVA Terrain : aucune application web, pas
        même « Mon espace » de la RH que lui vaudrait son dossier salarié."""
        apps = super()._eguitra_apps()
        if self._eguitra_profiles() == ["conducteur"]:
            return [app for app in apps if app == "terrain"]
        return apps
