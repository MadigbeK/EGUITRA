from odoo import fields, models

from odoo.addons.eguitra_base.models.res_users import PROFILE_GROUPS

from ..organisation import APPS, ENTITY_NAMES, PROFILE_ENTITY


class ResUsers(models.Model):
    _inherit = "res.users"

    eguitra_password_temporary = fields.Boolean(
        string="Mot de passe provisoire",
        help="Mot de passe fixé par un administrateur : l'utilisateur doit le changer à la connexion.",
    )

    def _eguitra_apps(self):
        """Applications du compte : un de ses profils l'ouvre, le compte est ouvert à la société
        qu'elle sert (AxisPro Suite sans MB AxisPro n'aurait rien à montrer) et son module est installé."""
        self.ensure_one()
        profiles = set(self._eguitra_profiles())
        entities = set(self.sudo().company_ids.mapped("eguitra_entity"))
        return [app for app, spec in APPS.items()
                if profiles & spec["profiles"] and (not spec["entity"] or spec["entity"] in entities)
                and (not spec.get("model") or spec["model"] in self.env)]

    def _eguitra_check_companies(self):
        """Un profil propre à une société exige que le compte soit ouvert à cette société."""
        self.ensure_one()
        entities = set(self.sudo().company_ids.mapped("eguitra_entity"))
        for profile in self._eguitra_profiles():
            entity = PROFILE_ENTITY.get(profile)
            if entity and entity not in entities:
                name = self.env.ref(PROFILE_GROUPS[profile]).sudo().name
                raise ValueError(f"Le profil « {name} » exige la société {ENTITY_NAMES[entity]}.")

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
            "rights": self._eguitra_rights(),
        }

    # ─── Droits complémentaires aux profils ──────────────────────────────

    def _eguitra_right_groups(self):
        """Droits complémentaires aux profils, code -> groupe du noyau (xmlid). Les modules déclarent les
        leurs par héritage (eguitra_finance : free_accounts, saisie libre des comptes) ; l'administration
        des utilisateurs les accorde ou les retire, la session les transmet aux applications."""
        return {}

    def _eguitra_rights(self):
        """Droits complémentaires du compte : {code: accordé}."""
        self.ensure_one()
        return {code: self.has_group(xmlid) for code, xmlid in self._eguitra_right_groups().items()}

    def _eguitra_set_rights(self, rights):
        """Accorde (True) ou retire (False) les droits complémentaires cités ; les autres sont inchangés."""
        self.ensure_one()
        groups = self._eguitra_right_groups()
        if not isinstance(rights, dict):
            raise ValueError("Droits complémentaires invalides.")
        unknown = set(rights) - set(groups)
        if unknown:
            raise ValueError(f"Droits inconnus : {', '.join(sorted(unknown))}")
        commands = [(4 if granted else 3, self.env.ref(groups[code]).id) for code, granted in rights.items()]
        if commands:
            self.sudo().write({"group_ids": commands})

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
