"""Réglages du service client (administration), catégories, équipes, réponses types (agents) et comptes de
l'espace client (agents et administration), dans la société de travail."""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require

from ..models.client_access import LinkConfirmation
from ..models.common import AGENTS, ALL, READ_ALL, SETTINGS_WRITE, clean_line, public_url
from .common import as_int, company, partner_of


def _record(model, record_id, label):
    record = request.env[model].sudo().with_context(active_test=False).browse(as_int(record_id)).exists()
    if not record or record.company_id != company():
        raise ApiError(404, "not_found", f"{label} introuvable dans la société de travail.")
    return record


def _members(values):
    if not isinstance(values, list):
        raise ApiError(400, "invalid_parameter", "Membres invalides.")
    users = request.env["res.users"].sudo().browse([as_int(v, "member_ids") for v in values]).exists()
    wrong = users.filtered(lambda u: u.share or company() not in u.company_ids
                           or "service-client" not in u._eguitra_apps())
    if wrong or len(users) != len(values):
        raise ApiError(422, "business_rule", "Un membre d'équipe est un compte interne de la société qui ouvre le "
                                             "service client.")
    return users


def _settings_payload():
    comp = company()
    row = request.env["eguitra.sc.settings"]._get(comp)._row()
    row.update({
        "public_url": public_url(request.env),
        "channels": {"email": request.env["eguitra.sc.mail.gateway"]._status(comp),
                     "whatsapp": request.env["eguitra.sc.whatsapp"]._status(comp),
                     "mail_server": bool(request.env["ir.mail_server"].sudo().search_count([]))},
        "webhook_path": "/api/whatsapp/webhook",
    })
    return row


class EguitraServiceClientAdmin(http.Controller):
    # ─── Réglages ────────────────────────────────────────────────────────

    @api_route("/service-client/settings", profiles=READ_ALL)
    def settings(self, **_kw):
        return _settings_payload()

    @api_route("/service-client/settings", methods=("PATCH",), profiles=SETTINGS_WRITE)
    def update_settings(self, **_kw):
        data = read_json()
        settings = request.env["eguitra.sc.settings"]._get(company())
        settings.write(settings._values(data))
        if "public_url" in data:
            url = clean_line(data.get("public_url"), 200).rstrip("/")
            if url and (not url.startswith("https://") or " " in url):
                raise ApiError(422, "business_rule", "L'adresse publique commence par https:// (adresse du site, sans "
                                                     "chemin).")
            request.env["ir.config_parameter"].sudo().set_param("eguitra_service_client.public_url", url or "")
        if {"work_start", "work_end"} & set(data) or any(k.startswith(("first_", "resolution_")) for k in data):
            open_tickets = request.env["eguitra.sc.ticket"].sudo().search(
                [("company_id", "=", company().id), ("state", "not in", ("resolved", "closed"))])
            open_tickets._compute_deadlines()
        return _settings_payload()

    # ─── Catégories ──────────────────────────────────────────────────────

    @api_route("/service-client/categories", profiles=ALL)
    def categories(self, **_kw):
        Category = request.env["eguitra.sc.category"].sudo().with_context(active_test=False)
        return [c._row() for c in Category.search([("company_id", "=", company().id)])]

    @api_route("/service-client/categories", methods=("POST",), profiles=SETTINGS_WRITE)
    def create_category(self, **_kw):
        Category = request.env["eguitra.sc.category"]
        vals = Category._values(read_json(), company())
        return Category.sudo().create(dict(vals, company_id=company().id))._row()

    @api_route("/service-client/categories/<int:category_id>", methods=("PATCH",), profiles=SETTINGS_WRITE)
    def update_category(self, category_id, **_kw):
        category = _record("eguitra.sc.category", category_id, "Catégorie")
        category.write(category._values(read_json(), company(), partial=True))
        return category._row()

    # ─── Équipes ─────────────────────────────────────────────────────────

    @api_route("/service-client/teams", profiles=ALL)
    def teams(self, **_kw):
        Team = request.env["eguitra.sc.team"].sudo().with_context(active_test=False)
        return [t._row() for t in Team.search([("company_id", "=", company().id)])]

    def _team_values(self, data, partial=False):
        vals = {}
        if not partial or "name" in data:
            vals["name"] = clean_line(data.get("name"), 80)
            if not vals["name"]:
                raise ApiError(400, "missing_fields", "Nom de l'équipe manquant.", fields=["name"])
        if "member_ids" in data:
            vals["member_ids"] = [(6, 0, _members(data["member_ids"]).ids)]
        if "leader_id" in data:
            vals["leader_id"] = _members([data["leader_id"]]).id if data["leader_id"] else False
        if "active" in data:
            vals["active"] = bool(data["active"])
        return vals

    @api_route("/service-client/teams", methods=("POST",), profiles=SETTINGS_WRITE)
    def create_team(self, **_kw):
        vals = self._team_values(read_json())
        return request.env["eguitra.sc.team"].sudo().create(dict(vals, company_id=company().id))._row()

    @api_route("/service-client/teams/<int:team_id>", methods=("PATCH",), profiles=SETTINGS_WRITE)
    def update_team(self, team_id, **_kw):
        team = _record("eguitra.sc.team", team_id, "Équipe")
        team.write(self._team_values(read_json(), partial=True))
        return team._row()

    # ─── Réponses types ──────────────────────────────────────────────────

    @api_route("/service-client/templates", profiles=ALL)
    def templates(self, **_kw):
        Template = request.env["eguitra.sc.template"].sudo().with_context(active_test=False)
        return [t._row() for t in Template.search([("company_id", "=", company().id)])]

    @api_route("/service-client/templates", methods=("POST",), profiles=AGENTS)
    def create_template(self, **_kw):
        Template = request.env["eguitra.sc.template"]
        vals = Template._values(read_json(), company())
        return Template.sudo().create(dict(vals, company_id=company().id))._row()

    @api_route("/service-client/templates/<int:template_id>", methods=("PATCH",), profiles=AGENTS)
    def update_template(self, template_id, **_kw):
        template = _record("eguitra.sc.template", template_id, "Réponse type")
        template.write(template._values(read_json(), company(), partial=True))
        return template._row()

    # ─── Comptes de l'espace client ──────────────────────────────────────

    @api_route("/service-client/client-accounts", profiles=AGENTS)
    def client_accounts(self, **kw):
        partner = partner_of(kw["partner_id"]) if kw.get("partner_id") else None
        Invitation = request.env["eguitra.sc.invitation"]
        return [Invitation.account_row(u, company()) for u in Invitation.accounts_of(company(), partner)]

    @api_route("/service-client/client-accounts", methods=("POST",), profiles=AGENTS)
    def open_client_account(self, **_kw):
        """Ouvre l'espace client à un contact d'un tiers de la société : {partner_id, name, email}. Le compte
        reçoit une invitation par courriel (mot de passe à choisir) ; sans serveur de courrier, le lien est rendu
        une fois, à transmettre par un autre canal."""
        data = read_json()
        partner_id, email = require(data, "partner_id", "email")
        Invitation = request.env["eguitra.sc.invitation"]
        try:
            user, created, invitation = Invitation.open_account(partner_of(partner_id), data.get("name"), email,
                                                                company(), confirm_link=data.get("confirm_link") is True)
        except LinkConfirmation as e:
            raise ApiError(409, "confirm_required", str(e.args[0])) from e
        return dict(Invitation.account_row(user, company()), created=created,
                    invitation_sent=bool(invitation and invitation["sent"]),
                    invitation_link=invitation["link"] if invitation else None)

    @api_route("/service-client/client-accounts/<int:user_id>/invite", methods=("POST",), profiles=AGENTS)
    def reinvite(self, user_id, **_kw):
        """Compte qui ne s'est jamais connecté : nouvelle invitation (lien rendu une fois sans serveur de courrier).
        Compte déjà utilisé : réinitialisation du mot de passe, par le seul courriel du compte (serveur de courrier
        exigé) ; le lien n'est jamais rendu ici, et la double authentification du compte reste exigée."""
        Invitation = request.env["eguitra.sc.invitation"]
        user = self._account(user_id)
        if user.login_date:
            Invitation.reset(user, company())
            return dict(Invitation.account_row(user, company()), invitation_sent=True, invitation_link=None,
                        reset=True)
        result = Invitation.invite(user, company())
        return dict(Invitation.account_row(user, company()), invitation_sent=result["sent"],
                    invitation_link=result["link"], reset=False)

    @api_route("/service-client/client-accounts/<int:user_id>/partners/<int:partner_id>", methods=("DELETE",),
               profiles=AGENTS)
    def unlink_partner(self, user_id, partner_id, **_kw):
        """Retire au compte le suivi d'un tiers de la société ; sans tiers suivi, le compte est désactivé et ses
        sessions fermées."""
        user = self._account(user_id)
        partner = partner_of(partner_id).commercial_partner_id
        if partner not in user.eguitra_sc_partner_ids:
            raise ApiError(404, "not_found", "Ce compte ne suit pas ce client.")
        user.write({"eguitra_sc_partner_ids": [(3, partner.id)]})
        if not user.eguitra_sc_partner_ids:
            user.write({"active": False})
            request.env["eguitra.api.token"].sudo()._revoke_user(user)
        return request.env["eguitra.sc.invitation"].account_row(user, company())

    def _account(self, user_id):
        """Compte client de la société de travail, et d'elle seule : un agent ne gère que ceux-là."""
        user = request.env["res.users"].sudo().with_context(active_test=False).browse(user_id).exists()
        Invitation = request.env["eguitra.sc.invitation"]
        if not user or "client" not in user._eguitra_profiles() or not Invitation._owned(user, company()) \
                or not user._eguitra_sc_partners(company()):
            raise ApiError(404, "not_found", "Compte de l'espace client introuvable dans la société.")
        return user

    # ─── Journal des messages reçus ──────────────────────────────────────

    @api_route("/service-client/inbound", profiles=SETTINGS_WRITE)
    def inbound(self, **kw):
        """Messages reçus par courriel et WhatsApp : dossiers ouverts, rattachés, refusés (boucles, rebonds)."""
        Inbound = request.env["eguitra.sc.inbound"].sudo()
        domain = [("company_id", "=", company().id)]
        if kw.get("outcome"):
            domain.append(("outcome", "=", kw["outcome"]))
        rows = Inbound.search(domain, limit=int_arg(kw, "limit", 100, 1, 500))
        return [{"id": r.id, "date": r.create_date, "channel": r.channel, "sender": r.sender or None,
                 "outcome": r.outcome, "reason": r.reason or None,
                 "ticket": {"id": r.ticket_id.id, "name": r.ticket_id.name} if r.ticket_id else None} for r in rows]
