from odoo import models

# Code de profil exposé aux applications -> groupe du noyau.
PROFILE_GROUPS = {
    "admin": "eguitra_base.group_profile_admin",
    "direction": "eguitra_base.group_profile_direction",
    "finance": "eguitra_base.group_profile_finance",
    "achats": "eguitra_base.group_profile_achats",
    "exploitation": "eguitra_base.group_profile_exploitation",
    "chantiers": "eguitra_base.group_profile_chantiers",
    "immobilier": "eguitra_base.group_profile_immobilier",
    "cabinet": "eguitra_base.group_profile_cabinet",
    "rh": "eguitra_base.group_profile_rh",
    "hsseq": "eguitra_base.group_profile_hsseq",
    "conducteur": "eguitra_base.group_profile_conducteur",
    "porteur": "eguitra_base.group_profile_porteur",
}


class ResUsers(models.Model):
    _inherit = "res.users"

    def _eguitra_profiles(self):
        """Codes de profil de l'utilisateur, dans l'ordre de PROFILE_GROUPS."""
        self.ensure_one()
        return [code for code, xmlid in PROFILE_GROUPS.items() if self.has_group(xmlid)]
