"""Comptes de l'espace client : créés par un agent du service client ou par l'administration, jamais par
inscription libre. Le client reçoit par courriel un lien d'invitation (jeton haché en base, valable 72 heures,
à usage unique) où il choisit son mot de passe ; il active ensuite la double authentification à sa première
connexion, comme le porteur de projet. Un compte suit un ou plusieurs tiers (plusieurs comptes peuvent suivre
le même tiers : les contacts d'une même entreprise), dans la société qui l'a invité."""

import logging
import secrets
from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import AccessDenied, UserError

from odoo.addons.eguitra_api.models.api_token import hash_token

from .common import clean_email, clean_line, mail_body, mail_server_ready, public_url

INVITATION_HOURS = 72
_logger = logging.getLogger(__name__)


class MfaRequired(UserError):
    """Code de double authentification absent ou faux à l'ouverture d'un lien de réinitialisation."""


class LinkConfirmation(UserError):
    """Rattachement d'un compte existant à un autre tiers, à confirmer par l'agent."""


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
    kind = fields.Selection([("invite", "Invitation"), ("reset", "Réinitialisation du mot de passe")], "Nature",
                            required=True, default="invite")

    @api.model
    def _check_partner(self, partner, company):
        partner = partner.sudo().commercial_partner_id
        if not partner or (partner.company_id and partner.company_id != company):
            raise UserError("Client inconnu dans la société.")
        return partner

    @api.model
    def _owned(self, user, company):
        """Compte de l'espace client de cette société et d'elle seule : les agents d'une société ne gèrent que ceux-là
        (jamais un compte interne, un porteur, ni un compte d'une autre société)."""
        user = user.sudo()
        return bool(user) and user.share and set(user._eguitra_profiles()) <= {"client"} \
            and set(user.company_ids.ids) == {company.id}

    @api.model
    def open_account(self, partner, name, email, company, confirm_link=False):
        """Compte du client pour un tiers de la société : créé au besoin (profil client). Un compte existant n'est
        cherché que par son identifiant (l'adresse, en égalité exacte, jamais par son champ courriel modifiable) et
        n'est repris que s'il est un compte client de cette société seule ; s'il suit déjà un autre tiers, l'agent
        doit le confirmer (confirm_link), et le rattachement est journalisé. Une invitation part par courriel pour
        un compte qui ne s'est jamais connecté."""
        partner = self._check_partner(partner, company)
        email = clean_email(email, required=True)
        name = clean_line(name, 120) or partner.name
        Users = self.env["res.users"].sudo().with_context(no_reset_password=True, active_test=False)
        user = Users.search([("login", "=", email)], limit=1)
        created = not user
        if user and not self._owned(user, company):
            # Rien n'est dit du compte existant (interne, porteur, autre société) au-delà de ce refus.
            raise UserError("Cette adresse est déjà utilisée par un compte de la plateforme : choisissez une autre "
                            "adresse pour ce contact, ou adressez-vous à l'administration.")
        others = user.eguitra_sc_partner_ids.commercial_partner_id - partner if user else None
        if others and not confirm_link:
            raise LinkConfirmation("Un compte de l'espace client existe déjà à cette adresse pour un autre client de la "
                                   "société : confirmez qu'il doit aussi suivre ce client (cette personne verra les "
                                   "demandes des deux clients).")
        if others:
            _logger.warning("Service client : compte %s (%s) rattaché au client %s en plus de %s, confirmé par %s",
                            user.id, user.login, partner.display_name, ", ".join(others.mapped("display_name")),
                            self.env.user.login)
        if created:
            user = Users.create({
                "name": name, "login": email, "email": email, "company_id": company.id,
                "company_ids": [(6, 0, company.ids)], "lang": "fr_FR", "tz": "Africa/Conakry",
                # Mot de passe aléatoire, jamais communiqué : le client choisit le sien par l'invitation.
                "password": secrets.token_urlsafe(24),
            })
            user._eguitra_set_profiles(["client"])
        else:
            user.write({"active": True})
        if partner not in user.eguitra_sc_partner_ids:
            user.write({"eguitra_sc_partner_ids": [(4, partner.id)]})
        invitation = self.invite(user, company) if created or not user.login_date else None
        return user, created, invitation

    def _new_link(self, user, company, kind):
        url = public_url(self.env)
        if not url:
            raise UserError("Adresse publique de l'espace client non réglée (Réglages du service client) : "
                            "l'invitation ne peut pas porter de lien.")
        self.sudo().search([("user_id", "=", user.id), ("used_at", "=", False)]).write({"token_hash": False})
        raw = secrets.token_urlsafe(32)
        invitation = self.sudo().create({
            "user_id": user.id, "company_id": company.id, "token_hash": hash_token(raw), "kind": kind,
            "expires_at": fields.Datetime.now() + timedelta(hours=INVITATION_HOURS),
        })
        return invitation, f"{url}/invitation/{raw}"

    def _mail_link(self, user, company, link, kind):
        settings = self.env["eguitra.sc.settings"]._get(company)
        if kind == "reset":
            title, paragraphs = "Nouveau mot de passe", [
                f"Bonjour {user.name},",
                f"Le service client de {company.name} vous envoie, à votre demande, un lien pour choisir un nouveau mot "
                f"de passe de votre espace client, valable {INVITATION_HOURS} heures : {link}",
                "Si la double authentification est activée sur votre compte, le code de votre application "
                "d'authentification vous sera demandé.",
                "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe ne change pas.",
            ]
        else:
            title, paragraphs = "Votre espace client", [
                f"Bonjour {user.name},",
                f"Le service client de {company.name} vous ouvre un espace en ligne pour déposer vos demandes et "
                "réclamations, suivre leur traitement et échanger avec nous.",
                f"Choisissez votre mot de passe en ouvrant ce lien, valable {INVITATION_HOURS} heures : {link}",
                f"Votre identifiant : {user.login}. À la première connexion, une application d'authentification (sur "
                "votre téléphone) vous sera demandée pour sécuriser votre compte.",
                "Si vous n'attendiez pas ce message, ignorez-le.",
            ]
        self.env["mail.mail"].sudo().create({
            "subject": f"{title} : espace client {company.name}", "email_to": user.email, "auto_delete": True,
            "email_from": settings.mail_address or company.email or False,
            "body_html": mail_body(company, title, paragraphs),
        })

    @api.model
    def invite(self, user, company):
        """Invitation d'un compte qui ne s'est jamais connecté (les précédentes sont annulées) : lien envoyé par
        courriel ; sans serveur de courrier, le lien est rendu une fois à l'agent, qui le transmet par un autre
        canal. Un compte déjà utilisé ne reçoit jamais de lien par cette voie (reset)."""
        user = user.sudo()
        if not self._owned(user, company):
            raise UserError("Compte de l'espace client introuvable dans la société.")
        if user.login_date:
            raise UserError("Ce compte s'est déjà connecté : son mot de passe se réinitialise par son courriel.")
        invitation, link = self._new_link(user, company, "invite")
        sent = bool(user.email and mail_server_ready(self.env))
        if sent:
            self._mail_link(user, company, link, "invite")
        invitation.write({"sent": sent})
        return {"invitation": invitation, "link": None if sent else link, "sent": sent}

    @api.model
    def reset(self, user, company):
        """Réinitialisation du mot de passe d'un compte déjà utilisé : le lien part par le courriel du compte, et par
        lui seul (jamais rendu à l'agent) ; la double authentification du compte reste exigée à son ouverture."""
        user = user.sudo()
        if not self._owned(user, company):
            raise UserError("Compte de l'espace client introuvable dans la société.")
        if not user.email:
            raise UserError("Ce compte n'a pas d'adresse électronique : la réinitialisation passe par l'administration.")
        if not mail_server_ready(self.env):
            raise UserError("Aucun serveur d'envoi de courriel n'est paramétré : la réinitialisation passe par le "
                            "courriel du compte, elle est impossible pour l'instant.")
        invitation, link = self._new_link(user, company, "reset")
        self._mail_link(user, company, link, "reset")
        invitation.write({"sent": True})
        return {"invitation": invitation, "link": None, "sent": True}

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

    def accept(self, password, code=None):
        """Le client choisit son mot de passe (règles de robustesse de la plateforme) ; le lien ne sert qu'une
        fois et les sessions ouvertes du compte sont fermées. Un compte dont la double authentification est activée
        donne aussi son code, comme à la connexion : un lien seul ne suffit pas à reprendre le compte."""
        self.ensure_one()
        invitation = self.sudo()
        user = invitation.user_id
        if user.totp_enabled:
            code = str(code or "").replace(" ", "")
            if not (code.isdigit() and len(code) == 6):
                raise MfaRequired("Code de double authentification requis.")
            try:
                user.with_user(user)._check_credentials({"type": "totp", "token": int(code)}, {"interactive": True})
            except AccessDenied as e:
                raise MfaRequired("Code de double authentification incorrect.") from e
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
        return users.filtered(lambda u: self._owned(u, company) and u._eguitra_sc_partners(company))

    @api.model
    def account_row(self, user, company):
        user = user.sudo()
        last = self.sudo().search([("user_id", "=", user.id)], limit=1)
        return {
            "id": user.id, "name": user.name, "login": user.login, "active": user.active,
            "partners": [{"id": p.id, "name": p.name} for p in user._eguitra_sc_partners(company)],
            "last_login": user.login_date or None, "mfa_enabled": bool(user.totp_enabled),
            "invitation": {"expires_at": last.expires_at, "used": bool(last.used_at), "sent": last.sent,
                           "kind": last.kind} if last else None,
        }
