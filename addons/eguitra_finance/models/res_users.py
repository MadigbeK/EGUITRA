"""Droit « Saisie libre des comptes » (groupe eguitra_finance.group_free_accounts).

Sans ce droit, un utilisateur de la finance ne choisit plus le compte général : la ligne prend le
compte de sa catégorie de dépense, du type d'opération, de l'activité (compte de produit) ou du
produit ; les opérations diverses lui sont refusées, comme le paramétrage des comptes des catégories,
des types d'opération et des financements (contrôle des routes : controllers/common.py,
require_free_accounts). Le droit est accordé d'office, pour ne rien changer au fonctionnement
antérieur : aux comptes des profils finance, direction et administration à l'installation et par la
migration 19.0.1.5.0, puis à tout compte qui reçoit son premier de ces profils ; l'administration le
retire au cas par cas (Administration > Utilisateurs).
"""

from odoo import api, models

FREE_ACCOUNTS = "eguitra_finance.group_free_accounts"
# Profils qui reçoivent d'office la saisie libre des comptes.
FREE_ACCOUNTS_PROFILES = frozenset({"admin", "direction", "finance"})


class ResUsers(models.Model):
    _inherit = "res.users"

    def _eguitra_right_groups(self):
        return dict(super()._eguitra_right_groups(), free_accounts=FREE_ACCOUNTS)

    def _eguitra_set_profiles(self, profiles):
        """Un compte qui reçoit son premier profil finance, direction ou administration reçoit aussi la
        saisie libre des comptes, que l'administration peut ensuite lui retirer."""
        self.ensure_one()
        before = FREE_ACCOUNTS_PROFILES & set(self._eguitra_profiles())
        result = super()._eguitra_set_profiles(profiles)
        if not before and FREE_ACCOUNTS_PROFILES & set(self._eguitra_profiles()):
            self.sudo().write({"group_ids": [(4, self.env.ref(FREE_ACCOUNTS).id)]})
        return result

    @api.model
    def _eguitra_grant_free_accounts(self):
        """Saisie libre des comptes pour tous les comptes actuels des profils finance, direction et
        administration (installation, migration 19.0.1.5.0) : leur fonctionnement ne change pas."""
        group = self.env.ref(FREE_ACCOUNTS)
        users = self.sudo().with_context(active_test=False).search([("share", "=", False)]).filtered(
            lambda user: FREE_ACCOUNTS_PROFILES & set(user._eguitra_profiles()))
        if users:
            users.write({"group_ids": [(4, group.id)]})
        return users
