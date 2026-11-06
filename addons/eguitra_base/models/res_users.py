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
    # Associé du cabinet : porte le profil cabinet ; scelle, force un gate, rouvre une révision.
    "associe": "eguitra_base.group_profile_associe",
    # Lecteur du cabinet : consulte les dossiers de MB AxisPro Consulting, sans rien modifier.
    "lecteur": "eguitra_base.group_profile_lecteur",
    "rh": "eguitra_base.group_profile_rh",
    "hsseq": "eguitra_base.group_profile_hsseq",
    "conducteur": "eguitra_base.group_profile_conducteur",
    "auditeur": "eguitra_base.group_profile_auditeur",
    # Agent du service client (NIMOVA · Service client), pour l'une ou l'autre société.
    "service_client": "eguitra_base.group_profile_service_client",
    "porteur": "eguitra_base.group_profile_porteur",
    # Client de l'espace client en ligne (utilisateur du portail), sur le modèle du porteur.
    "client": "eguitra_base.group_profile_client",
}

# Profils des comptes externes (utilisateurs du portail) : chacun ne se combine avec aucun autre et n'ouvre
# aucune application interne (discussion, agenda, suivi des demandes).
EXTERNAL_PROFILES = ("porteur", "client")


class ResUsers(models.Model):
    _inherit = "res.users"

    def _eguitra_profiles(self):
        """Codes de profil de l'utilisateur, dans l'ordre de PROFILE_GROUPS."""
        self.ensure_one()
        return [code for code, xmlid in PROFILE_GROUPS.items() if self.has_group(xmlid)]
