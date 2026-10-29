"""Routes internes des dossiers du service client (/service-client/…), dans la société de travail."""

from datetime import timedelta

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require
from odoo.addons.eguitra_finance.controllers.common import parse_date, today
from odoo.addons.eguitra_finance.controllers.exporting import export_meta, table_response

from .. import whatsapp as wa
from ..models.common import (
    AGENTS,
    ALL,
    CHANNELS,
    KINDS,
    LINK_MODELS,
    OPEN_STATES,
    PRIORITIES,
    READ_ALL,
    STATES,
    clean_line,
    clean_text,
    public_url,
)
from .common import as_int, company, download, form_or_json, partner_of, profiles, ticket_of, uploads, writable

PAGE = 100
EDITABLE = ("category_id", "kind", "priority", "subject", "description", "partner_id", "contact_name", "contact_email",
            "contact_phone", "link_model", "link_id", "channel")


def _category(value):
    if not value:
        return request.env["eguitra.sc.category"]
    category = request.env["eguitra.sc.category"].sudo().browse(as_int(value, "category_id")).exists()
    if not category or category.company_id != company():
        raise ApiError(422, "business_rule", "Catégorie inconnue dans la société.")
    return category


def _team(value):
    if not value:
        return request.env["eguitra.sc.team"]
    team = request.env["eguitra.sc.team"].sudo().browse(as_int(value, "team_id")).exists()
    if not team or team.company_id != company():
        raise ApiError(422, "business_rule", "Équipe inconnue dans la société.")
    return team


def _user(value):
    if not value:
        return request.env["res.users"]
    user = request.env["res.users"].sudo().browse(as_int(value, "user_id")).exists()
    if not user:
        raise ApiError(422, "business_rule", "Responsable inconnu.")
    return user


def _values(data, partial=False):
    """Champs d'un dossier saisis par un agent, contrôlés."""
    vals = {}
    if not partial or "subject" in data:
        vals["subject"] = clean_line(data.get("subject"), 200)
        if not vals["subject"]:
            raise ApiError(400, "missing_fields", "Objet du dossier manquant.", fields=["subject"])
    if "description" in data:
        vals["description"] = clean_text(data.get("description"), 10000, "La description") or False
    for key, choices in (("kind", KINDS), ("priority", PRIORITIES), ("channel", CHANNELS)):
        if key in data:
            if data[key] not in dict(choices):
                raise ApiError(400, "invalid_parameter", f"Valeur inconnue : {key}.")
            vals[key] = data[key]
    if "category_id" in data:
        vals["category_id"] = _category(data["category_id"]).id or False
    if "partner_id" in data:
        vals["partner_id"] = partner_of(data["partner_id"]).commercial_partner_id.id if data["partner_id"] else False
        if vals["partner_id"]:
            vals["sender_unverified"] = False
    for key, size in (("contact_name", 120), ("contact_phone", 40)):
        if key in data:
            vals[key] = clean_line(data.get(key), size) or False
    if "contact_email" in data:
        vals["contact_email"] = (data.get("contact_email") or "").strip() or False
    if "link_model" in data or "link_id" in data:
        model = data.get("link_model") or False
        if model and (model not in LINK_MODELS or model not in request.env):
            raise ApiError(422, "business_rule", "Nature de fiche inconnue ou module absent.")
        vals["link_model"] = model
        vals["link_id"] = as_int(data.get("link_id"), "link_id") if model else 0
    return vals


def _domain(kw):
    domain = [("company_id", "=", company().id)]
    if kw.get("state"):
        states = OPEN_STATES if kw["state"] == "open" else [s for s in kw["state"].split(",") if s in dict(STATES)]
        domain.append(("state", "in", list(states)))
    for key, choices in (("priority", PRIORITIES), ("channel", CHANNELS), ("kind", KINDS)):
        if kw.get(key) and kw[key] in dict(choices):
            domain.append((key, "=", kw[key]))
    for key in ("category_id", "user_id", "team_id", "partner_id"):
        if kw.get(key):
            domain.append((key, "=", as_int(kw[key], key)))
    if kw.get("mine") == "1":
        user = request.env.user
        domain += ["|", ("user_id", "=", user.id), ("team_id.member_ids", "in", [user.id])]
    if kw.get("unassigned") == "1":
        domain.append(("user_id", "=", False))
    if kw.get("unverified") == "1":
        domain.append(("sender_unverified", "=", True))
    if kw.get("late") == "1":
        now = fields.Datetime.now()
        domain += [("state", "in", OPEN_STATES), "|", "&", ("date_first_response", "=", False),
                   ("date_first_response_due", "<", now), "&", ("state", "!=", "waiting"),
                   ("date_resolution_due", "<", now)]
    query = clean_line(kw.get("q"), 80)
    if query:
        domain += ["|", "|", "|", "|", "|", ("name", "ilike", query), ("subject", "ilike", query),
                   ("contact_name", "ilike", query), ("contact_email", "ilike", query),
                   ("contact_phone", "ilike", query), ("partner_id.name", "ilike", query)]
    return domain


class EguitraServiceClientTickets(http.Controller):
    @api_route("/service-client/context", profiles=ALL)
    def context(self, **_kw):
        """Ce qu'il faut à l'écran : droits du compte, catégories, équipes, réponses types, responsables possibles,
        état des canaux et natures de fiches liées."""
        comp = company()
        mine = profiles()
        Users = request.env["res.users"].sudo()
        assignees = Users.search([("share", "=", False), ("company_ids", "in", comp.ids)], order="name")
        assignees = assignees.filtered(lambda u: "service-client" in u._eguitra_apps())
        return {
            "company": {"id": comp.id, "name": comp.name, "entity": comp.eguitra_entity or None},
            "profiles": sorted(mine),
            "can": {"manage": bool(mine & set(AGENTS)), "settings": "admin" in mine,
                    "dashboard": bool(mine & set(READ_ALL))},
            "categories": [c._row() for c in request.env["eguitra.sc.category"].sudo().search(
                [("company_id", "=", comp.id)])],
            "teams": [t._row() for t in request.env["eguitra.sc.team"].sudo().search([("company_id", "=", comp.id)])],
            "templates": [t._row() for t in request.env["eguitra.sc.template"].sudo().search(
                [("company_id", "=", comp.id)])],
            "assignees": [{"id": u.id, "name": u.name} for u in assignees],
            "channels": {"email": request.env["eguitra.sc.mail.gateway"]._status(comp),
                         "whatsapp": request.env["eguitra.sc.whatsapp"]._status(comp),
                         "mail_server": bool(request.env["ir.mail_server"].sudo().search_count([])),
                         "public_url": public_url(request.env)},
            "links": request.env["eguitra.sc.links"].available(),
            "hsseq": "eguitra.hsseq.complaint" in request.env,
        }

    @api_route("/service-client/tickets", profiles=ALL)
    def list(self, **kw):
        Ticket = request.env["eguitra.sc.ticket"]
        domain = _domain(kw)
        limit, offset = int_arg(kw, "limit", PAGE, 1, 500), int_arg(kw, "offset", 0, 0)
        now = fields.Datetime.now()
        tickets = Ticket.search(domain, limit=limit, offset=offset)
        base = [("company_id", "=", company().id)]
        return {
            "items": [t._row(now) for t in tickets], "total": Ticket.search_count(domain),
            "counts": {"open": Ticket.search_count(base + [("state", "in", OPEN_STATES)]),
                       "mine": Ticket.search_count(base + [("state", "in", OPEN_STATES), "|",
                                                           ("user_id", "=", request.env.uid),
                                                           ("team_id.member_ids", "in", [request.env.uid])]),
                       "unassigned": Ticket.search_count(base + [("state", "in", OPEN_STATES), ("user_id", "=", False)]),
                       "late": Ticket.search_count(_domain({"late": "1"}))},
        }

    @api_route("/service-client/tickets", methods=("POST",), profiles=AGENTS)
    def create(self, **_kw):
        """Saisie par l'équipe (appel, visite, courrier) : objet, client ou contact, canal, catégorie, type,
        priorité, responsable ; « answer » : réponse donnée sur-le-champ (première réponse notée)."""
        data = read_json()
        vals = _values(data)
        if not vals.get("partner_id") and not (vals.get("contact_name") or vals.get("contact_phone")
                                               or vals.get("contact_email")):
            raise ApiError(400, "missing_fields", "Client ou contact (nom, téléphone ou courriel) manquant.",
                           fields=["partner_id"])
        vals.setdefault("channel", "phone")
        if vals.get("partner_id") and not vals.get("contact_name"):
            vals["contact_name"] = request.env["res.partner"].sudo().browse(vals["partner_id"]).name
        category = request.env["eguitra.sc.category"].sudo().browse(vals.get("category_id") or 0).exists()
        if category and category.kind and "kind" not in data:
            vals["kind"] = category.kind
        team = _team(data.get("team_id")) if data.get("team_id") else category.team_id
        user = _user(data.get("user_id"))
        ticket = request.env["eguitra.sc.ticket"].create(dict(vals, company_id=company().id))
        ticket.sudo()._event(f"Dossier saisi par {request.env.user.name} ({dict(CHANNELS)[ticket.channel].lower()}).")
        if user or team:
            ticket.assign(user if user else None, team if team else None)
        answer = clean_text(data.get("answer"), 10000, "La réponse")
        if answer:
            ticket.reply(answer, channel=ticket.channel)
        if ticket.channel in ("email", "whatsapp", "portal"):
            ticket.sudo()._acknowledge()
        return ticket._detail()

    @api_route("/service-client/tickets/<int:ticket_id>", profiles=ALL)
    def detail(self, ticket_id, **_kw):
        return ticket_of(ticket_id)._detail()

    @api_route("/service-client/tickets/<int:ticket_id>", methods=("PATCH",), profiles=AGENTS)
    def update(self, ticket_id, **_kw):
        ticket = ticket_of(ticket_id)
        data = read_json()
        if ticket.sudo().merged_into_id:
            raise ApiError(422, "business_rule", "Dossier fusionné : il ne se modifie plus.")
        vals = _values({k: v for k, v in data.items() if k in EDITABLE}, partial=True)
        if vals:
            before = ticket.sudo().read(list(vals))[0]
            ticket.write(vals)
            changed = [ticket._fields[k].string for k in vals if before.get(k) != ticket.sudo().read([k])[0].get(k)]
            if changed:
                ticket.sudo()._event("Dossier modifié : " + ", ".join(changed) + ".")
        if "user_id" in data or "team_id" in data:
            ticket.assign(_user(data.get("user_id")) if "user_id" in data else None,
                          _team(data.get("team_id")) if "team_id" in data else None)
        return ticket._detail()

    @api_route("/service-client/tickets/<int:ticket_id>/state", methods=("POST",), profiles=ALL)
    def state(self, ticket_id, **_kw):
        ticket = ticket_of(ticket_id)
        writable(ticket)
        data = read_json()
        (state,) = require(data, "state")
        ticket.set_state(state, reason=data.get("reason"))
        return ticket._detail()

    @api_route("/service-client/tickets/<int:ticket_id>/reply", methods=("POST",), profiles=ALL)
    def reply(self, ticket_id, **_kw):
        """Réponse au client par le canal du dossier (ou « channel ») ; pièces jointes en multipart (files)."""
        ticket = ticket_of(ticket_id)
        writable(ticket)
        data = form_or_json()
        template = None
        if data.get("template_id"):
            template = request.env["eguitra.sc.template"].sudo().browse(as_int(data["template_id"])).exists()
            if not template or template.company_id != ticket.company_id:
                raise ApiError(422, "business_rule", "Réponse type inconnue dans la société.")
        channel = data.get("channel") or None
        if channel and channel not in dict(CHANNELS):
            raise ApiError(400, "invalid_parameter", "Canal inconnu.")
        attachments = uploads("eguitra.sc.ticket", ticket.id)
        message = ticket.reply(data.get("body"), channel=channel, attachments=attachments, template=template)
        return dict(ticket._detail(), sent=message._row(internal=True))

    @api_route("/service-client/tickets/<int:ticket_id>/note", methods=("POST",), profiles=ALL)
    def note(self, ticket_id, **_kw):
        ticket = ticket_of(ticket_id)
        writable(ticket)
        data = form_or_json()
        ticket.post_note(data.get("body"), attachments=uploads("eguitra.sc.ticket", ticket.id))
        return ticket._detail()

    @api_route("/service-client/tickets/<int:ticket_id>/templates/<int:template_id>", profiles=ALL)
    def template(self, ticket_id, template_id, **_kw):
        """Texte d'une réponse type pour ce dossier, variables remplacées."""
        ticket = ticket_of(ticket_id)
        template = request.env["eguitra.sc.template"].sudo().browse(template_id).exists()
        if not template or template.company_id != ticket.company_id:
            raise ApiError(404, "not_found", "Réponse type introuvable.")
        return {"id": template.id, "body": template.render(ticket, request.env.user)}

    @api_route("/service-client/tickets/<int:ticket_id>/attachments/<int:attachment_id>", profiles=ALL)
    def attachment(self, ticket_id, attachment_id, **_kw):
        ticket = ticket_of(ticket_id)
        attachment = ticket.sudo().message_ids.attachment_ids.filtered(lambda a: a.id == attachment_id)
        if not attachment:
            raise ApiError(404, "not_found", "Pièce jointe introuvable.")
        return download(attachment)

    @api_route("/service-client/tickets/<int:ticket_id>/merge", methods=("POST",), profiles=AGENTS)
    def merge(self, ticket_id, **_kw):
        """Fusionne ce dossier (en double) dans « into_id » ; rend le dossier gardé."""
        source = ticket_of(ticket_id)
        (into,) = require(read_json(), "into_id")
        target = ticket_of(into)
        return source.merge_into(target)._detail()

    @api_route("/service-client/tickets/<int:ticket_id>/satisfaction", methods=("POST",), profiles=AGENTS)
    def satisfaction(self, ticket_id, **_kw):
        """Note recueillie par l'agent (téléphone, visite) : {score, comment}."""
        ticket = ticket_of(ticket_id)
        data = read_json()
        (score,) = require(data, "score")
        ticket.record_satisfaction(score, data.get("comment"), channel=ticket.sudo().channel)
        return ticket._detail()

    @api_route("/service-client/tickets/<int:ticket_id>/hsseq", profiles=AGENTS)
    def hsseq_candidates(self, ticket_id, **_kw):
        ticket = ticket_of(ticket_id)
        Complaint = request.env.get("eguitra.hsseq.complaint")
        natures = [{"code": c, "label": label} for c, label in Complaint._fields["nature"].selection] \
            if Complaint is not None else []
        return {"available": Complaint is not None, "natures": natures,
                "complaints": request.env["eguitra.sc.links"].hsseq_candidates(ticket.sudo())}

    @api_route("/service-client/tickets/<int:ticket_id>/hsseq", methods=("POST",), profiles=AGENTS)
    def hsseq(self, ticket_id, **_kw):
        """Réclamation de qualité vers HSSEQ : {mode: create|join, complaint_id, nature}."""
        ticket = ticket_of(ticket_id)
        data = read_json()
        request.env["eguitra.sc.links"].hsseq_link(ticket, data.get("mode"), data.get("complaint_id"),
                                                   data.get("nature"))
        return ticket._detail()

    # ─── Recherche du client et des fiches ───────────────────────────────

    @api_route("/service-client/clients", profiles=AGENTS)
    def clients(self, **kw):
        """Recherche pendant un appel, par nom, téléphone ou courriel : tiers de la société et contacts déjà
        connus des dossiers, avec leurs dossiers en cours."""
        query = clean_line(kw.get("q"), 80)
        if len(query) < 2:
            return {"partners": [], "contacts": []}
        comp = company()
        digits = wa.normalize_phone(query)
        Partner = request.env["res.partner"].sudo()
        domain = [("company_id", "in", [False, comp.id]), ("active", "=", True), "|", "|",
                  ("name", "ilike", query), ("email", "ilike", query), ("phone", "ilike", query)]
        partners = Partner.search(domain, limit=15).commercial_partner_id
        Ticket = request.env["eguitra.sc.ticket"].sudo()
        if digits:
            known = Ticket.search([("company_id", "=", comp.id), ("contact_phone_norm", "=", digits),
                                   ("partner_id", "!=", False)], limit=5)
            partners |= known.partner_id.commercial_partner_id

        def open_of(domain):
            return [{"id": t.id, "name": t.name, "subject": t.subject, "state": t.state,
                     "state_label": dict(STATES)[t.state], "date_open": t.date_open}
                    for t in Ticket.search([("company_id", "=", comp.id), ("state", "in", OPEN_STATES),
                                            ("merged_into_id", "=", False)] + domain, limit=10)]

        rows = []
        for p in partners[:15]:
            rows.append({"id": p.id, "name": p.name, "email": p.email or None, "phone": p.phone or None,
                         "open": open_of([("partner_id", "child_of", p.id)]),
                         "accounts": len(request.env["eguitra.sc.invitation"].accounts_of(comp, p))})
        contacts = []
        clause = [("contact_name", "ilike", query), ("contact_email", "ilike", query), ("contact_phone", "ilike", query)]
        if digits:
            clause.append(("contact_phone_norm", "=", digits))
        contact_domain = [("company_id", "=", comp.id), ("partner_id", "=", False)] + ["|"] * (len(clause) - 1) + clause
        seen = set()
        for t in Ticket.search(contact_domain, limit=30, order="id desc"):
            key = (t.contact_email or "", t.contact_phone_norm or "", t.contact_name or "")
            if key in seen:
                continue
            seen.add(key)
            same = [("id", "=", t.id)]
            if t.contact_email:
                same.append(("contact_email", "=", t.contact_email))
            if t.contact_phone_norm:
                same.append(("contact_phone_norm", "=", t.contact_phone_norm))
            contacts.append({"name": t.contact_name or None, "email": t.contact_email or None,
                             "phone": t.contact_phone or None,
                             "open": open_of([("partner_id", "=", False)] + ["|"] * (len(same) - 1) + same)})
            if len(contacts) >= 10:
                break
        return {"partners": rows, "contacts": contacts}

    @api_route("/service-client/links", profiles=AGENTS)
    def links(self, **kw):
        """Fiches à lier au dossier : model, q, partner_id (client du dossier)."""
        partner = partner_of(kw["partner_id"]) if kw.get("partner_id") else None
        return request.env["eguitra.sc.links"].search_records(kw.get("model"), kw.get("q"), company(), partner)

    # ─── Notifications ───────────────────────────────────────────────────

    @api_route("/service-client/notifications", profiles=ALL, journal=False)
    def notifications(self, **_kw):
        Notification = request.env["eguitra.sc.notification"]
        domain = [("user_id", "=", request.env.uid), "|", ("company_id", "=", company().id), ("company_id", "=", False)]
        rows = Notification.search(domain, limit=50)
        return {"items": [n._row() for n in rows], "unread": Notification.search_count(domain + [("read", "=", False)])}

    @api_route("/service-client/notifications/read", methods=("POST",), profiles=ALL)
    def notifications_read(self, **_kw):
        data = read_json()
        domain = [("user_id", "=", request.env.uid), ("read", "=", False)]
        if not data.get("all"):
            ids = [as_int(i, "ids") for i in (data.get("ids") or [])]
            domain.append(("id", "in", ids))
        request.env["eguitra.sc.notification"].search(domain).write({"read": True})
        return {"status": "ok"}

    # ─── Tableau de bord et échéances ────────────────────────────────────

    @api_route("/service-client/dashboard", profiles=READ_ALL)
    def dashboard(self, **kw):
        """Tableau de bord de la société de travail ; date_from et date_to bornent les délais et la satisfaction
        (90 derniers jours par défaut) ; format=xlsx ou csv (sheet=n) pour l'export."""
        comp = company()
        end = parse_date(kw, "date_to", today())
        start = parse_date(kw, "date_from", end - timedelta(days=90))
        if start > end:
            raise ApiError(400, "invalid_parameter", "Période invalide : le début précède la fin.")
        Dashboard = request.env["eguitra.sc.dashboard"]
        data = Dashboard.compute(comp, start, end)
        if kw.get("format") in ("xlsx", "csv"):
            meta = export_meta(comp, [("Période", f"{start:%d/%m/%Y} au {end:%d/%m/%Y}")])
            return table_response(f"service-client-{fields.Date.to_string(end)}", Dashboard.sheets(comp, data, meta),
                                  kw["format"], int_arg(kw, "sheet", 0, 0))
        return data

    @api_route("/service-client/deadlines", profiles=ALL)
    def deadlines(self, **kw):
        """Échéances des dossiers ouverts (première réponse, résolution) entre deux dates, pour l'agenda ; bornées
        aux dossiers que le compte lit et à 92 jours."""
        start = parse_date(kw, "date_from", today())
        end = parse_date(kw, "date_to", fields.Date.add(start, days=31))
        items = request.env["eguitra.sc.dashboard"].deadlines(request.env.user, company(), start,
                                                              min(end, fields.Date.add(start, days=92)))
        return {"items": items}
