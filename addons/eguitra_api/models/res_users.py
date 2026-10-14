from odoo import fields, models

from odoo.addons.eguitra_base.models.res_users import PROFILE_GROUPS

# Applications ouvertes à chaque profil.
APP_PROFILES = {
    "finance": {"admin", "direction", "finance", "exploitation", "chantiers", "immobilier"},
    "axispro": {"admin", "direction", "cabinet"},
    "portail": {"porteur"},
    "mobile": {"admin", "exploitation"},
}


class ResUsers(models.Model):
    _inherit = "res.users"

    eguitra_password_temporary = fields.Boolean(
        string="Mot de passe provisoire",
        help="Mot de passe fixé par un administrateur : l'utilisateur doit le changer à la connexion.",
    )

    def _eguitra_apps(self):
        self.ensure_one()
        profiles = set(self._eguitra_profiles())
        return [app for app, allowed in APP_PROFILES.items() if profiles & allowed]

    def _eguitra_public(self):
        """Représentation de l'utilisateur renvoyée aux applications."""
        self.ensure_one()
        user = self.sudo()
        return {
            "id": user.id,
            "name": user.name,
            "login": user.login,
            "email": user.email or None,
            "profiles": self._eguitra_profiles(),
            "apps": self._eguitra_apps(),
            "company_id": user.company_id.id,
            "companies": [
                {"id": c.id, "name": c.name, "entity": c.eguitra_entity or None}
                for c in user.company_ids
            ],
            "mfa_enabled": bool(user.totp_enabled),
            "password_change_required": bool(user.eguitra_password_temporary),
            "lang": user.lang,
            "tz": user.tz or "Africa/Conakry",
        }

    def _eguitra_set_profiles(self, profiles):
        """Remplace les profils de la plateforme ; un porteur de projet n'a que ce profil."""
        self.ensure_one()
        unknown = set(profiles) - set(PROFILE_GROUPS)
        if unknown:
            raise ValueError(f"Profils inconnus : {', '.join(sorted(unknown))}")
        groups = {code: self.env.ref(xmlid) for code, xmlid in PROFILE_GROUPS.items()}
        if "porteur" in profiles:
            if len(profiles) > 1:
                raise ValueError("Le profil porteur de projet ne se combine avec aucun autre.")
            self.sudo().write({"group_ids": [(6, 0, groups["porteur"].ids)]})
            return
        commands = [(3, g.id) for code, g in groups.items() if code not in profiles]
        commands += [(4, groups[code].id) for code in profiles]
        if self.share:
            commands.append((3, self.env.ref("base.group_portal").id))
            commands.append((4, self.env.ref("base.group_user").id))
        self.sudo().write({"group_ids": commands})
