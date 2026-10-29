"""Comptes de l'espace client : créés par un agent du service client ou par l'administration, jamais par
inscription libre. Le client reçoit par courriel un lien d'invitation (jeton haché en base, valable 72 heures,
à usage unique) où il choisit son mot de passe ; il active ensuite la double authentification à sa première
connexion, comme le porteur de projet. Un compte suit un ou plusieurs tiers (plusieurs comptes peuvent suivre
le même tiers : les contacts d'une même entreprise), dans la société qui l'a invité."""

import secrets
from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import UserError

from odoo.addons.eguitra_api.models.api_token import hash_token

from .common import clean_email, clean_line, mail_body, mail_server_ready, public_url

INVITATION_HOURS = 72


class ResUsers(models.Model):
    _inherit = "res.users"

    eguitra_sc_partner_ids = fields.Many2many(
        "res.partner", "eguitra_sc_user_partner_rel", "user_id", "partner_id", "Tiers suivis dans l'espace client",
        help="Compte du profil client : il ne lit que les dossiers de ces tiers, dans ses sociétés.")

    def _eguitra_sc_partners(self, company=None):
        """Tiers suivis par le compte client (entreprises), dans une société ou dans les siennes."""
        self.ensure_one()
        user = self.sudo()
        companies = company or user.company_ids
        return user.eguitra_sc_partner_ids.commercial_partner_id.filtered(
            lambda p: not p.company_id or p.company_id in companies)


class EguitraScInvitation(models.Model):
    _name = "eguitra.sc.invitation"
    _description = "Invitation à l'espace client"
    _order = "id desc"

    user_id = fields.Many2one("res.users", "Compte", required=True, index=True, ondelete="cascade")
    company_id = fields.Many2one("res.company", "Société", required=True, index=True, ondelete="cascade")
    token_hash = fields.Char("Empreinte du lien", index=True, copy=False)
    expires_at = fields.Datetime("Valable jusqu'au", required=True)
    used_at = fields.Datetime("Utilisée le")
    sent = fields.Boolean("Envoyée par courriel")

    @api.model
    def _check_partner(self, partner, company):
        partner = partner.sudo().commercial_partner_id
        if not partner or (partner.company_id and partner.company_id != company):
            raise UserError("Client inconnu dans la société.")
        return partner

    @api.model
    def open_account(self, partner, name, email, company):
        """Compte du client pour un tiers de la société : créé au besoin (profil client), rattaché sinon ; une
        invitation part par courriel. Un identifiant interne n'est jamais repris."""
        partner = self._check_partner(partner, company)
        email = clean_email(email, required=True)
        name = clean_line(name, 120) or partner.name
        Users = self.env["res.users"].sudo().with_context(no_reset_password=True, active_test=False)
        user = Users.search([("login", "=", email)], limit=1)
        created = not user
        if user and not user.share:
            raise UserError("Cette adresse est l'identifiant d'un compte interne : choisissez une autre adresse.")
        if user and set(user._eguitra_profiles()) - {"client"}:
            raise UserError("Cette adresse est l'identifiant d'un compte du portail des porteurs : choisissez-en une "
                            "autre pour l'espace client.")
        if created:
            user = Users.create({
                "name": name, "login": email, "email": email, "company_id": company.id,
                "company_ids": [(6, 0, company.ids)], "lang": "fr_FR", "tz": "Africa/Conakry",
                # Mot de passe aléatoire, jamais communiqué : le client choisit le sien par l'invitation.
                "password": secrets.token_urlsafe(24),
            })
            user._eguitra_set_profiles(["client"])
        else:
            vals = {"active": True}
            if company not in user.company_ids:
                vals["company_ids"] = [(4, company.id)]
            user.write(vals)
        if partner not in user.eguitra_sc_partner_ids:
            user.write({"eguitra_sc_partner_ids": [(4, partner.id)]})
        invitation = self.invite(user, company) if created or not user.login_date else None
        return user, created, invitation

    @api.model
    def invite(self, user, company):
        """Nouvelle invitation (les précédentes sont annulées) : lien envoyé par courriel ; sans serveur de
        courrier, le lien est rendu une fois à l'agent, qui le transmet par un autre canal."""
        user = user.sudo()
        url = public_url(self.env)
        if not url:
            raise UserError("Adresse publique de l'espace client non réglée (Réglages du service client) : "
                            "l'invitation ne peut pas porter de lien.")
        self.sudo().search([("user_id", "=", user.id), ("used_at", "=", False)]).write({"token_hash": False})
        raw = secrets.token_urlsafe(32)
        invitation = self.sudo().create({
            "user_id": user.id, "company_id": company.id, "token_hash": hash_token(raw),
            "expires_at": fields.Datetime.now() + timedelta(hours=INVITATION_HOURS),
        })
        link = f"{url}/invitation/{raw}"
        sent = False
        if user.email and mail_server_ready(self.env):
            settings = self.env["eguitra.sc.settings"]._get(company)
            self.env["mail.mail"].sudo().create({
                "subject": f"Votre espace client {company.name}", "email_to": user.email, "auto_delete": True,
                "email_from": settings.mail_address or company.email or False,
                "body_html": mail_body(company, "Votre espace client", [
                    f"Bonjour {user.name},",
                    f"Le service client de {company.name} vous ouvre un espace en ligne pour déposer vos demandes et "
                    "réclamations, suivre leur traitement et échanger avec nous.",
                    f"Choisissez votre mot de passe en ouvrant ce lien, valable {INVITATION_HOURS} heures : {link}",
                    f"Votre identifiant : {user.login}. À la première connexion, une application d'authentification "
                    "(sur votre téléphone) vous sera demandée pour sécuriser votre compte.",
                    "Si vous n'attendiez pas ce message, ignorez-le.",
                ]),
            })
            sent = True
        invitation.write({"sent": sent})
        return {"invitation": invitation, "link": None if sent else link, "sent": sent}

    @api.model
    def _find(self, raw):
        """Invitation valable derrière un lien ; sinon vide (rien n'est dit de plus)."""
        raw = (raw or "").strip()
        if not 20 <= len(raw) <= 100:
            return self.browse()
        invitation = self.sudo().search([("token_hash", "=", hash_token(raw))], limit=1)
        if not invitation or invitation.used_at or invitation.expires_at < fields.Datetime.now() \
                or not invitation.user_id.active:
            return self.browse()
        return invitation

    def accept(self, password):
        """Le client choisit son mot de passe (règles de robustesse de la plateforme) ; le lien ne sert qu'une
        fois et les sessions ouvertes du compte sont fermées."""
        self.ensure_one()
        invitation = self.sudo()
        password = str(password or "")
        if len(password) < 10:
            raise UserError("Mot de passe trop court : 10 caractères au moins.")
        if password.lower() == (invitation.user_id.login or "").lower():
            raise UserError("Le mot de passe ne reprend pas l'identifiant.")
        invitation.user_id.write({"password": password, "eguitra_password_temporary": False})
        invitation.write({"used_at": fields.Datetime.now(), "token_hash": False})
        self.env["eguitra.api.token"].sudo()._revoke_user(invitation.user_id)
        return invitation.user_id

    @api.model
    def accounts_of(self, company, partner=None):
        """Comptes de l'espace client qui suivent un tiers de la société (ou tous les tiers de la société)."""
        domain = [("share", "=", True), ("company_ids", "in", company.ids), ("eguitra_sc_partner_ids", "!=", False)]
        if partner:
            domain.append(("eguitra_sc_partner_ids", "in", partner.commercial_partner_id.ids))
        users = self.env["res.users"].sudo().with_context(active_test=False).search(domain, order="name", limit=500)
        return users.filtered(lambda u: u._eguitra_sc_partners(company))

    @api.model
    def account_row(self, user, company):
        user = user.sudo()
        last = self.sudo().search([("user_id", "=", user.id)], limit=1)
        return {
            "id": user.id, "name": user.name, "login": user.login, "active": user.active,
            "partners": [{"id": p.id, "name": p.name} for p in user._eguitra_sc_partners(company)],
            "last_login": user.login_date or None, "mfa_enabled": bool(user.totp_enabled),
            "invitation": {"expires_at": last.expires_at, "used": bool(last.used_at), "sent": last.sent} if last else None,
        }
