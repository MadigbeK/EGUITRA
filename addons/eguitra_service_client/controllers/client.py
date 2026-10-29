"""API de l'espace client (/espace-client/…, profil client).

Le client n'a aucun droit direct sur les dossiers : chaque route lit pour lui, bornée aux dossiers des tiers que
suit son compte, dans ses sociétés. Il ne lit jamais les notes internes, les événements de suivi, les échéances
ni le responsable au-delà de son prénom (ou du nom du service). Un dossier d'un autre client répond 404, comme
un dossier inexistant. Les dépôts sont bornés : dossiers et messages par jour, pièces jointes en nombre, en taille
et en format.

Une lecture (GET) n'écrit rien.
"""

from datetime import timedelta

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require

from ..models.common import CLIENT, KINDS, OPEN_STATES, clean_line, clean_text
from .common import as_int, download, form_or_json, uploads

MAX_TICKETS_PER_DAY = 10
MAX_MESSAGES_PER_DAY = 100
MAX_FILES_PER_TICKET = 40


def _me():
    return request.env.user


def _partners(company=None):
    return _me()._eguitra_sc_partners(company)


def _companies():
    return _me().sudo().company_ids


def _tickets_domain():
    partners = _partners()
    return [("partner_id", "child_of", partners.ids or [0]), ("company_id", "in", _companies().ids)]


def _own(ticket_id):
    ticket = request.env["eguitra.sc.ticket"].sudo().search([("id", "=", as_int(ticket_id))] + _tickets_domain(),
                                                            limit=1)
    if not ticket:
        raise ApiError(404, "not_found", "Demande introuvable.")
    return ticket


def _today_count(model, domain):
    since = fields.Datetime.now() - timedelta(days=1)
    return request.env[model].sudo().search_count(domain + [("create_date", ">=", since)])


class EguitraEspaceClient(http.Controller):
    @api_route("/espace-client/me", profiles=CLIENT)
    def me(self, **_kw):
        """Compte, sociétés et tiers suivis, catégories proposées par société."""
        companies = []
        for comp in _companies():
            partners = _partners(comp)
            if not partners:
                continue
            categories = request.env["eguitra.sc.category"].sudo().search(
                [("company_id", "=", comp.id), ("portal", "=", True)])
            companies.append({"id": comp.id, "name": comp.name,
                              "partners": [{"id": p.id, "name": p.name} for p in partners],
                              "categories": [{"id": c.id, "name": c.name} for c in categories]})
        return {"name": _me().name, "login": _me().login, "companies": companies,
                "kinds": [{"code": code, "label": label} for code, label in KINDS]}

    @api_route("/espace-client/tickets", profiles=CLIENT)
    def tickets(self, **kw):
        domain = _tickets_domain() + [("merged_into_id", "=", False)]
        if kw.get("state") == "open":
            domain.append(("state", "in", OPEN_STATES + ("resolved",)))
        elif kw.get("state") == "closed":
            domain.append(("state", "=", "closed"))
        tickets = request.env["eguitra.sc.ticket"].sudo().search(domain, limit=200)
        return [t._client_row() for t in tickets]

    @api_route("/espace-client/tickets", methods=("POST",), profiles=CLIENT)
    def create(self, **_kw):
        """Nouvelle demande : {company_id, partner_id, category_id, kind, subject, description}."""
        data = read_json()
        subject, description = require(data, "subject", "description")
        companies = _companies().filtered(lambda c: _partners(c))
        if not companies:
            raise ApiError(422, "business_rule", "Votre compte n'est ouvert à aucun service client.")
        wanted = as_int(data["company_id"], "company_id") if data.get("company_id") else companies[0].id
        comp = companies.filtered(lambda c: c.id == wanted)
        if not comp:
            raise ApiError(422, "business_rule", "Société inconnue pour votre compte.")
        partners = _partners(comp)
        partner = partners.filtered(lambda p: p.id == as_int(data["partner_id"], "partner_id")) \
            if data.get("partner_id") else partners[:1]
        if not partner:
            raise ApiError(422, "business_rule", "Client inconnu pour votre compte.")
        if _today_count("eguitra.sc.ticket", [("client_user_id", "=", _me().id)]) >= MAX_TICKETS_PER_DAY:
            raise ApiError(429, "rate_limited", f"{MAX_TICKETS_PER_DAY} demandes par jour au plus : réessayez demain "
                                                "ou appelez le service client.")
        category = request.env["eguitra.sc.category"]
        if data.get("category_id"):
            category = category.sudo().search([("id", "=", as_int(data["category_id"], "category_id")),
                                               ("company_id", "=", comp.id), ("portal", "=", True)], limit=1)
            if not category:
                raise ApiError(422, "business_rule", "Catégorie inconnue.")
        kind = data.get("kind") or category.kind or "request"
        if kind not in dict(KINDS):
            raise ApiError(400, "invalid_parameter", "Type inconnu.")
        body = clean_text(description, 5000, "La description")
        Ticket = request.env["eguitra.sc.ticket"].sudo()
        ticket = Ticket.create({
            "company_id": comp.id, "channel": "portal", "partner_id": partner.id, "kind": kind,
            "category_id": category.id or False, "subject": clean_line(subject, 200) or "Demande",
            "description": body, "contact_name": _me().name, "contact_email": _me().email or False,
            "team_id": category.team_id.id or False,
        })
        ticket.sudo().write({"client_user_id": _me().id})
        ticket.client_message(body, "portal", user=_me(), notify=False)
        ticket._event(f"Demande déposée dans l'espace client par {_me().name}.")
        ticket._acknowledge()
        ticket._notify_new()
        return ticket._client_detail()

    @api_route("/espace-client/tickets/<int:ticket_id>", profiles=CLIENT)
    def detail(self, ticket_id, **_kw):
        return _own(ticket_id)._client_detail()

    @api_route("/espace-client/tickets/<int:ticket_id>/messages", methods=("POST",), profiles=CLIENT)
    def message(self, ticket_id, **_kw):
        """Réponse du client (texte et pièces jointes en multipart « files ») ; rouvre un dossier résolu."""
        ticket = _own(ticket_id)._final()
        if ticket.state == "closed":
            raise ApiError(422, "business_rule", "Cette demande est close : déposez une nouvelle demande au besoin.")
        if _today_count("eguitra.sc.message", [("author_id", "=", _me().id)]) >= MAX_MESSAGES_PER_DAY:
            raise ApiError(429, "rate_limited", "Trop de messages aujourd'hui : réessayez demain.")
        data = form_or_json()
        body = clean_text(data.get("body"), 5000, "Le message")
        files = request.httprequest.files.getlist("files") or request.httprequest.files.getlist("file")
        if files and len(ticket.message_ids.attachment_ids) + len(files) > MAX_FILES_PER_TICKET:
            raise ApiError(422, "quota_exceeded", f"{MAX_FILES_PER_TICKET} pièces jointes au plus par demande.")
        attachments = uploads("eguitra.sc.ticket", ticket.id)
        if not body and not attachments:
            raise ApiError(400, "missing_fields", "Écrivez votre message ou joignez une pièce.", fields=["body"])
        ticket.client_message(body or "(pièce jointe)", "portal", user=_me(), attachments=attachments)
        return ticket._client_detail()

    @api_route("/espace-client/tickets/<int:ticket_id>/attachments/<int:attachment_id>", profiles=CLIENT)
    def attachment(self, ticket_id, attachment_id, **_kw):
        """Pièce jointe d'un message public du dossier (jamais d'une note interne)."""
        ticket = _own(ticket_id)
        public = ticket.message_ids.filtered(lambda m: m.kind == "public")
        attachment = public.attachment_ids.filtered(lambda a: a.id == attachment_id)
        if not attachment:
            raise ApiError(404, "not_found", "Pièce jointe introuvable.")
        return download(attachment)

    @api_route("/espace-client/tickets/<int:ticket_id>/satisfaction", methods=("POST",), profiles=CLIENT)
    def satisfaction(self, ticket_id, **_kw):
        data = read_json()
        (score,) = require(data, "score")
        ticket = _own(ticket_id)
        ticket.record_satisfaction(score, data.get("comment"), channel="portal")
        return ticket._client_detail()

    @api_route("/espace-client/tickets/<int:ticket_id>/confirm", methods=("POST",), profiles=CLIENT)
    def confirm(self, ticket_id, **_kw):
        """Le client confirme la résolution : la demande est close."""
        ticket = _own(ticket_id)
        if ticket.state != "resolved":
            raise ApiError(422, "business_rule", "Seule une demande résolue se confirme.")
        ticket._apply_state("closed", auto=f"Résolution confirmée par le client ({_me().name}) : dossier clos.")
        return ticket._client_detail()
