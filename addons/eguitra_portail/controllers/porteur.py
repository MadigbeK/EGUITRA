"""API du porteur de projet : son espace, son projet, ses pièces, sa messagerie, ses rendez-vous, les
communications, ressources et événements du cabinet, son agenda, ses notifications et ses avis.

Le porteur ne lit que ses dossiers (utilisateur du portail du dossier) et les publications dont il fait
partie du public ; jamais le détail du scoring, les notes internes ni les critères de la grille.
"""

from datetime import timedelta

from odoo import fields, http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require
from odoo.addons.eguitra_axispro.controllers.common import store_upload

from ..models.agenda import MEETING_MODES
from ..models.suivi import FEEDBACK_TOPICS
from . import vues

PORTEUR = ("porteur",)
MAX_DAILY_MESSAGES = 50
MAX_OPEN_MEETING_REQUESTS = 3
PORTAL_DOCUMENT_KEYS = ("document_type_id", "code", "name", "category", "required", "due", "gate", "guidance",
                        "state", "version")
PROFILE_FIELDS = ("phone", "email", "street", "city", "website")
PROFILE_LABELS = {"phone": "Téléphone", "email": "Courriel", "street": "Adresse", "city": "Ville",
                  "website": "Site internet"}


def _me():
    return request.env.user


def _dossiers():
    return request.env["axispro.dossier"].sudo().search([("portal_user_ids", "in", _me().id)])


def _own(dossier_id):
    try:
        dossier_id = int(dossier_id)
    except (TypeError, ValueError) as e:
        raise ApiError(404, "not_found", "Dossier introuvable.") from e
    dossier = request.env["axispro.dossier"].sudo().browse(dossier_id).exists()
    if not dossier or _me() not in dossier.portal_user_ids:
        raise ApiError(404, "not_found", "Dossier introuvable.")
    return dossier


def _open(dossier):
    if dossier.state == "closed":
        raise ApiError(422, "business_rule", "Ce dossier est clos.")


def _tasks(dossier):
    return dossier.action_ids.filtered(
        lambda a: a.portal_visible and a.assignee == "porteur" and a.state != "cancelled")


def _portal_docs(dossier, result=None):
    result = result or dossier.evaluate()
    return [{k: d[k] for k in PORTAL_DOCUMENT_KEYS} for d in dossier.documents_status(result)]


def _datetime(value, label):
    if not value:
        return None
    try:
        return fields.Datetime.to_datetime(str(value).replace("T", " ")[:19])
    except ValueError as e:
        raise ApiError(400, "invalid_parameter", f"{label} : date invalide.") from e


def _announcements(dossiers):
    companies = dossiers.company_id
    if not companies:
        return request.env["portail.announcement"].browse()
    found = request.env["portail.announcement"].sudo().search(
        [("company_id", "in", companies.ids), ("state", "=", "published")])
    return found.visible_now().filtered(lambda a: a._matches(dossiers))


def _reads(announcements):
    reads = request.env["portail.announcement.read"].sudo().search(
        [("announcement_id", "in", announcements.ids), ("user_id", "=", _me().id)])
    return {r.announcement_id.id: r for r in reads}


def _events(dossiers, since):
    Registration = request.env["portail.event.registration"].sudo()
    mine = Registration.search([("user_id", "=", _me().id)])
    events = request.env["portail.event"].sudo().search(
        [("company_id", "in", dossiers.company_id.ids), ("state", "in", ("published", "cancelled")), ("end", ">=", since)])
    registrations = {r.event_id.id: r for r in mine}
    visible = events.filtered(lambda e: e.id in registrations or (e.state == "published" and e._matches(dossiers)))
    return visible, registrations


def _gate_codes(dossiers):
    return {d.current_gate_id.code for d in dossiers if d.current_gate_id}


def _reactions(articles):
    reactions = request.env["portail.article.reaction"].sudo().search(
        [("article_id", "in", articles.ids), ("user_id", "=", _me().id)])
    return {r.article_id.id: r for r in reactions}


def _published_articles(dossiers):
    return request.env["portail.article"].sudo().search(
        [("company_id", "in", dossiers.company_id.ids), ("state", "=", "published")])


def _notifications_unread():
    return request.env["portail.notification"].sudo().search_count([("user_id", "=", _me().id), ("read_at", "=", False)])


class EguitraPortailPorteur(http.Controller):
    # ─── Espace et tableau de bord ───────────────────────────────────────

    @api_route("/portail/espace", profiles=PORTEUR)
    def espace(self, **_kw):
        """Ce que l'en-tête et le menu du portail affichent : dossiers, compteurs, identité."""
        me, dossiers = _me(), _dossiers()
        unread = request.env["portail.read.marker"].unread(me, dossiers)
        announcements = _announcements(dossiers)
        reads = _reads(announcements)
        today = fields.Date.context_today(me)
        tasks = dossiers.action_ids.filtered(
            lambda a: a.portal_visible and a.assignee == "porteur" and a.state in ("todo", "in_progress"))
        now = fields.Datetime.now()
        meetings = dossiers.meeting_ids.filtered(lambda m: m.state == "confirmed" and m.start and m.start >= now)
        events, registrations = _events(dossiers, now)
        promoter = dossiers[:1].promoter_id
        return {
            "user": {"id": me.id, "name": me.name, "login": me.login, "company": promoter.name or None},
            "dossiers": [dict(vues.dossier_ref(d), unread_messages=unread.get(d.id, 0)) for d in dossiers],
            "counts": {
                "notifications": _notifications_unread(),
                "messages": sum(unread.values()),
                "announcements_unread": len([a for a in announcements if a.id not in reads]),
                "announcements_to_ack": len([a for a in announcements if a.require_ack
                                             and not (reads.get(a.id) and reads[a.id].acknowledged_at)]),
                "tasks_open": len(tasks),
                "tasks_overdue": len(tasks.filtered(lambda a: a.due_date and a.due_date < today)),
                "meetings_upcoming": len(meetings),
                "meetings_requested": len(dossiers.meeting_ids.filtered(lambda m: m.state == "requested")),
                "events_registered": len([e for e in events if e.start >= now and registrations.get(e.id)
                                          and registrations[e.id].state == "registered"]),
            },
        }

    @api_route("/portail/dossiers/<int:dossier_id>/tableau", profiles=PORTEUR)
    def tableau(self, dossier_id, **_kw):
        me, dossier = _me(), _own(dossier_id)
        result = dossier.evaluate()
        docs = _portal_docs(dossier, result)
        tasks = _tasks(dossier)
        today = fields.Date.context_today(me)
        now = fields.Datetime.now()
        steps = []
        for task in tasks.filtered(lambda a: a.state in ("todo", "in_progress")).sorted(
                lambda a: (a.due_date or today + timedelta(days=3650), a.id)):
            overdue = bool(task.due_date and task.due_date < today)
            soon = bool(task.due_date and task.due_date <= today + timedelta(days=7))
            steps.append({"kind": "action", "title": task.name, "detail": task.description or None,
                          "due": task.due_date, "link": f"/portail/actions?dossier={dossier.id}",
                          "urgency": "high" if overdue else "normal" if soon else "low"})
        for doc in docs:
            if doc["state"] == "rejected":
                steps.append({"kind": "piece", "title": f"Pièce à reprendre : {doc['name']}", "detail": doc["guidance"],
                              "due": None, "link": f"/portail/pieces?dossier={dossier.id}", "urgency": "high"})
            elif doc["due"] and doc["required"] and doc["state"] == "missing":
                steps.append({"kind": "piece", "title": f"Pièce attendue : {doc['name']}", "detail": doc["guidance"],
                              "due": None, "link": f"/portail/pieces?dossier={dossier.id}", "urgency": "normal"})
        unread = request.env["portail.read.marker"].unread(me, dossier).get(dossier.id, 0)
        if unread:
            steps.append({"kind": "message", "title": f"{unread} message{'s' if unread > 1 else ''} du cabinet à lire",
                          "detail": None, "due": None, "link": f"/portail/messages?dossier={dossier.id}",
                          "urgency": "normal"})
        announcements = _announcements(dossier)
        reads = _reads(announcements)
        for a in announcements.filtered(lambda a: a.require_ack and not (reads.get(a.id) and reads[a.id].acknowledged_at)):
            steps.append({"kind": "announcement", "title": f"À lire et confirmer : {a.name}", "detail": None,
                          "due": None, "link": f"/portail/actualites/{a.id}", "urgency": "high"})
        recent_feedback = dossier.feedback_ids.filtered(
            lambda f: f.user_id == me and f.create_date >= now - timedelta(days=90))
        if not recent_feedback and dossier.create_date <= now - timedelta(days=30):
            steps.append({"kind": "feedback", "title": "Donnez votre avis sur l'accompagnement",
                          "detail": "Deux minutes pour aider le cabinet à mieux vous servir.", "due": None,
                          "link": "/portail/avis", "urgency": "low"})
        order = {"high": 0, "normal": 1, "low": 2}
        steps.sort(key=lambda s: order[s["urgency"]])

        upcoming = [{"kind": "meeting", "title": m.subject, "date": m.start, "link": "/portail/rendez-vous"}
                    for m in dossier.meeting_ids.filtered(lambda m: m.state == "confirmed" and m.start and m.start >= now)]
        events, registrations = _events(dossier, now)
        upcoming += [{"kind": "event", "title": e.name, "date": e.start, "link": "/portail/evenements",
                      "registered": bool(registrations.get(e.id) and registrations[e.id].state == "registered")}
                     for e in events if e.state == "published" and e.start >= now]
        upcoming += [{"kind": "action", "title": t.name, "date": vues.at_noon(t.due_date),
                      "link": f"/portail/actions?dossier={dossier.id}"}
                     for t in tasks.filtered(lambda a: a.state in ("todo", "in_progress") and a.due_date and a.due_date >= today)]
        upcoming.sort(key=lambda u: u["date"])

        articles = _published_articles(dossier)
        codes = _gate_codes(dossier)
        reactions = _reactions(articles)
        ranked = sorted(articles, key=lambda a: (not (set(vues.split_list(a.gate_codes)) & codes),
                                                 bool(reactions.get(a.id) and reactions[a.id].viewed_at),
                                                 not a.featured))
        fundings = dossier.funding_ids
        return {
            "dossier": dict(vues.dossier_ref(dossier), gates=vues.gates_of(dossier), location=dossier.location or None),
            "preparation": vues.preparation(dossier, docs, tasks),
            "next_steps": steps[:8],
            "upcoming": upcoming[:6],
            "timeline": vues.timeline(dossier, limit=6),
            "announcements": [vues.announcement_row(a, reads.get(a.id)) for a in announcements[:3]],
            "articles": [vues.article_row(a, reactions.get(a.id), codes) for a in ranked[:3]],
            "fundings": {"count": len(fundings), "requested": sum(fundings.mapped("amount_requested")),
                         "granted": sum(fundings.mapped("amount_granted")),
                         "currency": dossier.currency_id.symbol or dossier.currency_id.name},
        }

    @api_route("/portail/dossiers/<int:dossier_id>/projet", profiles=PORTEUR)
    def projet(self, dossier_id, **_kw):
        dossier = _own(dossier_id)
        team = [dict(vues.person(dossier.consultant_id), role="Consultant principal")] if dossier.consultant_id else []
        for assignment in dossier.sudo().assignment_ids:
            if assignment.user_id != dossier.consultant_id:
                team.append(dict(vues.person(assignment.user_id), role=f"Référent {assignment.compartment_id.name}"))
        return {
            "dossier": dict(
                vues.dossier_ref(dossier), gates=vues.gates_of(dossier), location=dossier.location or None,
                capacity=dossier.capacity or None, investment=dossier.investment, financing_need=dossier.financing_need,
                currency={"name": dossier.currency_id.name, "symbol": dossier.currency_id.symbol},
                date_start=dossier.date_start, description=dossier.description or None,
                promoter=dossier.promoter_id.name),
            "team": team,
            "fundings": [vues.funding_row(f) for f in dossier.funding_ids.sorted(lambda f: (f.state_date or fields.Date.today()), reverse=True)],
            "timeline": vues.timeline(dossier),
        }

    # ─── Pièces ──────────────────────────────────────────────────────────

    @api_route("/portail/dossiers/<int:dossier_id>/pieces", profiles=PORTEUR)
    def pieces(self, dossier_id, **_kw):
        dossier = _own(dossier_id)
        docs = _portal_docs(dossier)
        files = dossier.sudo().document_ids.filtered("portal_visible").sorted(lambda d: d.uploaded_at, reverse=True)
        latest = {}
        for f in files:
            if f.document_type_id and f.document_type_id.id not in latest:
                latest[f.document_type_id.id] = f
        attendues = []
        for d in docs:
            last = latest.get(d["document_type_id"])
            attendues.append(dict(d, last_file={"id": last.id, "uploaded_at": last.uploaded_at, "comment": last.comment or None}
                                  if last else None))
        due = [d for d in docs if d["due"] and d["required"]]
        return {
            "closed": dossier.state == "closed",
            "progress": {"due": len(due), "received": len([d for d in due if d["state"] == "received"]),
                         "validated": len([d for d in due if d["state"] == "validated"]),
                         "rejected": len([d for d in due if d["state"] == "rejected"])},
            "attendues": attendues,
            "fichiers": [{"id": f.id, "name": f.name, "version": f.version, "state": f.state, "comment": f.comment or None,
                          "document_type_id": f.document_type_id.id or None, "uploaded_by": f.uploaded_by.name,
                          "uploaded_at": f.uploaded_at, "mimetype": f.attachment_id.mimetype,
                          "size": f.attachment_id.file_size, "from_cabinet": not f.uploaded_by.share} for f in files],
        }

    @api_route("/portail/dossiers/<int:dossier_id>/actions", profiles=PORTEUR)
    def actions(self, dossier_id, **_kw):
        dossier = _own(dossier_id)
        today = fields.Date.context_today(_me())
        return [{"id": a.id, "name": a.name, "description": a.description or None, "due_date": a.due_date,
                 "state": a.state, "porteur_comment": a.porteur_comment or None, "overdue": a.is_overdue(today),
                 "done_date": a.done_date, "source": a.source or None, "create_date": a.create_date}
                for a in _tasks(dossier).sorted(lambda a: (a.state == "done", a.due_date or today + timedelta(days=3650), a.id))]

    # ─── Messagerie ──────────────────────────────────────────────────────

    @api_route("/portail/dossiers/<int:dossier_id>/fil", profiles=PORTEUR)
    def fil(self, dossier_id, **_kw):
        me, dossier = _me(), _own(dossier_id)
        messages = dossier.sudo().message_ids.filtered(lambda m: not m.internal)
        if messages:
            request.env["portail.read.marker"].mark(me, dossier, max(messages.ids))
        return {"consultant": vues.person(dossier.consultant_id), "closed": dossier.state == "closed",
                "messages": [vues.message_row(m, me) for m in messages]}

    @api_route("/portail/dossiers/<int:dossier_id>/fil", methods=("POST",), profiles=PORTEUR)
    def ecrire(self, dossier_id, **_kw):
        me, dossier = _me(), _own(dossier_id)
        _open(dossier)
        form = request.httprequest.form
        body = (form.get("body") or "").strip()
        has_file = bool(request.httprequest.files.get("file"))
        if not body and not has_file:
            raise ApiError(400, "missing_fields", "Écrivez un message ou joignez un fichier.", fields=["body"])
        Message = request.env["axispro.message"].sudo()
        recent = Message.search_count([("dossier_id", "=", dossier.id), ("author_id", "=", me.id),
                                       ("date", ">=", fields.Datetime.now() - timedelta(days=1))])
        if recent >= MAX_DAILY_MESSAGES:
            raise ApiError(429, "too_many_requests", "Trop de messages en 24 heures : appelez votre consultant.")
        documents = store_upload(dossier, quota=True) if has_file else request.env["axispro.document"]
        message = Message.create({
            "dossier_id": dossier.id, "body": body[:5000] or f"Pièce jointe : {documents.name}", "author_id": me.id,
            "internal": False, "document_ids": [(6, 0, documents.ids)],
        })
        request.env["portail.read.marker"].mark(me, dossier, message.id)
        return vues.message_row(message, me)

    # ─── Rendez-vous ─────────────────────────────────────────────────────

    @api_route("/portail/dossiers/<int:dossier_id>/rendez-vous", profiles=PORTEUR)
    def rendez_vous(self, dossier_id, **_kw):
        me, dossier = _me(), _own(dossier_id)
        return [vues.meeting_row(m, me) for m in dossier.sudo().meeting_ids.sorted(
            lambda m: (m.state not in ("requested", "confirmed"), m.start or m.slot_1 or m.create_date), reverse=False)]

    @api_route("/portail/dossiers/<int:dossier_id>/rendez-vous", methods=("POST",), profiles=PORTEUR)
    def demander(self, dossier_id, **_kw):
        me, dossier = _me(), _own(dossier_id)
        _open(dossier)
        data = read_json()
        (subject,) = require(data, "subject")
        mode = data.get("mode") or "office"
        if mode not in dict(MEETING_MODES):
            raise ApiError(400, "invalid_parameter", "Forme de rendez-vous inconnue.")
        slots = [_datetime(s, "Créneau") for s in (data.get("slots") or [])[:3] if s]
        now = fields.Datetime.now()
        if not slots:
            raise ApiError(400, "missing_fields", "Proposez au moins un créneau.", fields=["slots"])
        if any(s <= now for s in slots):
            raise ApiError(422, "business_rule", "Les créneaux proposés doivent être à venir.")
        pending = dossier.sudo().meeting_ids.filtered(lambda m: m.state == "requested")
        if len(pending) >= MAX_OPEN_MEETING_REQUESTS:
            raise ApiError(422, "business_rule", "Trois demandes attendent déjà une réponse du cabinet.")
        meeting = request.env["portail.meeting"].sudo().create({
            "dossier_id": dossier.id, "requested_by": me.id, "consultant_id": dossier.consultant_id.id or False,
            "subject": str(subject)[:200], "agenda": str(data.get("agenda") or "")[:3000] or False, "mode": mode,
            "slot_1": slots[0], "slot_2": slots[1] if len(slots) > 1 else False,
            "slot_3": slots[2] if len(slots) > 2 else False,
            "duration": int(data.get("duration") or 60),
        })
        request.env["portail.notification"].sudo().notify(
            dossier.consultant_id, "meeting", f"Demande de rendez-vous : {meeting.subject}", f"{me.name}, {dossier.reference}",
            "/axispro/portail/rendez-vous", dossier=dossier)
        return vues.meeting_row(meeting, me)

    @api_route("/portail/rendez-vous/<int:meeting_id>/annuler", methods=("POST",), profiles=PORTEUR)
    def annuler(self, meeting_id, **_kw):
        meeting = request.env["portail.meeting"].sudo().browse(meeting_id).exists()
        if not meeting:
            raise ApiError(404, "not_found", "Rendez-vous introuvable.")
        _own(meeting.dossier_id.id)
        meeting.cancel(str(read_json().get("reason") or "")[:1000] or None, by_porteur=True)
        return vues.meeting_row(meeting, _me())

    # ─── Communications du cabinet ───────────────────────────────────────

    @api_route("/portail/actualites", profiles=PORTEUR)
    def actualites(self, **_kw):
        announcements = _announcements(_dossiers())
        reads = _reads(announcements)
        return [vues.announcement_row(a, reads.get(a.id)) for a in announcements]

    def _announcement(self, announcement_id):
        announcement = request.env["portail.announcement"].sudo().browse(announcement_id).exists()
        if not announcement or announcement not in _announcements(_dossiers()):
            raise ApiError(404, "not_found", "Communication introuvable.")
        return announcement

    @api_route("/portail/actualites/<int:announcement_id>", profiles=PORTEUR)
    def actualite(self, announcement_id, **_kw):
        announcement = self._announcement(announcement_id)
        Read = request.env["portail.announcement.read"].sudo()
        read = Read.search([("announcement_id", "=", announcement.id), ("user_id", "=", _me().id)], limit=1)
        if not read:
            read = Read.create({"announcement_id": announcement.id, "user_id": _me().id})
        return vues.announcement_row(announcement, read, full=True)

    @api_route("/portail/actualites/<int:announcement_id>/accuse", methods=("POST",), profiles=PORTEUR)
    def accuser(self, announcement_id, **_kw):
        announcement = self._announcement(announcement_id)
        Read = request.env["portail.announcement.read"].sudo()
        read = Read.search([("announcement_id", "=", announcement.id), ("user_id", "=", _me().id)], limit=1)
        now = fields.Datetime.now()
        if not read:
            read = Read.create({"announcement_id": announcement.id, "user_id": _me().id, "acknowledged_at": now})
        elif not read.acknowledged_at:
            read.acknowledged_at = now
        return vues.announcement_row(announcement, read, full=True)

    # ─── Centre de ressources ────────────────────────────────────────────

    @api_route("/portail/ressources", profiles=PORTEUR)
    def ressources(self, **_kw):
        dossiers = _dossiers()
        articles = _published_articles(dossiers)
        reactions = _reactions(articles)
        codes = _gate_codes(dossiers)
        categories = request.env["portail.category"].sudo().search([("company_id", "in", dossiers.company_id.ids)])
        counts = {c.id: len(articles.filtered(lambda a, c=c: a.category_id == c)) for c in categories}
        return {"categories": [vues.category_row(c, counts[c.id]) for c in categories if counts[c.id]],
                "articles": [vues.article_row(a, reactions.get(a.id), codes) for a in articles]}

    def _article(self, article_id):
        dossiers = _dossiers()
        article = request.env["portail.article"].sudo().browse(article_id).exists()
        if not article or article.state != "published" or article.company_id not in dossiers.company_id:
            raise ApiError(404, "not_found", "Contenu introuvable.")
        return article, dossiers

    def _reaction(self, article):
        Reaction = request.env["portail.article.reaction"].sudo()
        reaction = Reaction.search([("article_id", "=", article.id), ("user_id", "=", _me().id)], limit=1)
        return reaction or Reaction.create({"article_id": article.id, "user_id": _me().id})

    @api_route("/portail/ressources/<int:article_id>", profiles=PORTEUR)
    def ressource(self, article_id, **_kw):
        article, dossiers = self._article(article_id)
        reaction = self._reaction(article)
        if not reaction.viewed_at:
            reaction.viewed_at = fields.Datetime.now()
        article.write({"view_count": article.view_count + 1})
        codes = _gate_codes(dossiers)
        others = _published_articles(dossiers) - article
        related = others.filtered(lambda a: a.category_id == article.category_id)[:3] or others[:3]
        reactions = _reactions(related)
        row = vues.article_row(article, reaction, codes, full=True)
        row["category"] = vues.category_row(article.category_id) if article.category_id else None
        row["helpful_count"] = len(article.reaction_ids.filtered(lambda r: r.helpful == "yes"))
        row["related"] = [vues.article_row(a, reactions.get(a.id), codes) for a in related]
        return row

    @api_route("/portail/ressources/<int:article_id>/reaction", methods=("POST",), profiles=PORTEUR)
    def reagir(self, article_id, **_kw):
        article, dossiers = self._article(article_id)
        data = read_json()
        reaction = self._reaction(article)
        values = {}
        if "helpful" in data:
            if data["helpful"] not in (True, False, None):
                raise ApiError(400, "invalid_parameter", "Avis invalide.")
            values["helpful"] = {True: "yes", False: "no", None: False}[data["helpful"]]
        if "bookmarked" in data:
            values["bookmarked"] = bool(data["bookmarked"])
        reaction.write(values)
        return vues.article_row(article, reaction, _gate_codes(dossiers))

    @api_route("/portail/ressources/<int:article_id>/fichiers/<int:attachment_id>", profiles=PORTEUR)
    def fichier(self, article_id, attachment_id, **_kw):
        article, _dossiers_ = self._article(article_id)
        attachment = article.attachment_ids.filtered(lambda a: a.id == attachment_id)
        if not attachment:
            raise ApiError(404, "not_found", "Fichier introuvable.")
        return request.make_response(attachment.raw, headers=[
            ("Content-Type", attachment.mimetype or "application/octet-stream"),
            ("Content-Disposition", content_disposition(attachment.name)),
            ("X-Content-Type-Options", "nosniff"),
        ])

    # ─── Événements et formations ────────────────────────────────────────

    @api_route("/portail/evenements", profiles=PORTEUR)
    def evenements(self, **_kw):
        events, registrations = _events(_dossiers(), fields.Datetime.now() - timedelta(days=60))
        return [vues.event_row(e, registrations.get(e.id)) for e in events.sorted("start")]

    def _event(self, event_id):
        dossiers = _dossiers()
        events, registrations = _events(dossiers, fields.Datetime.now() - timedelta(days=60))
        event = events.filtered(lambda e: e.id == event_id)
        if not event:
            raise ApiError(404, "not_found", "Événement introuvable.")
        return event, dossiers, registrations

    @api_route("/portail/evenements/<int:event_id>/inscription", methods=("POST",), profiles=PORTEUR)
    def inscrire(self, event_id, **_kw):
        event, dossiers, _registrations = self._event(event_id)
        data = read_json()
        dossier = _own(data["dossier_id"]) if data.get("dossier_id") else dossiers[:1]
        registration = event.register(_me(), dossier, str(data.get("note") or "")[:1000])
        return vues.event_row(event, registration)

    @api_route("/portail/evenements/<int:event_id>/desinscription", methods=("POST",), profiles=PORTEUR)
    def desinscrire(self, event_id, **_kw):
        event, _dossiers_, registrations = self._event(event_id)
        registration = registrations.get(event.id)
        if not registration or registration.state not in ("registered", "waitlist"):
            raise ApiError(422, "business_rule", "Vous n'êtes pas inscrit à cet événement.")
        if event.start <= fields.Datetime.now():
            raise ApiError(422, "business_rule", "L'événement a commencé.")
        registration.cancel()
        return vues.event_row(event, registration)

    # ─── Agenda ──────────────────────────────────────────────────────────

    @api_route("/portail/agenda", profiles=PORTEUR)
    def agenda(self, **_kw):
        dossiers = _dossiers()
        start, end = vues.window(45, 240)
        items = []
        for m in dossiers.meeting_ids.filtered(lambda m: m.state in ("confirmed", "done") and m.start and start <= m.start <= end):
            items.append({"key": f"meeting-{m.id}", "kind": "meeting", "title": m.subject, "start": m.start, "end": m.end(),
                          "all_day": False, "link": "/portail/rendez-vous", "state": m.state,
                          "detail": dict(MEETING_MODES)[m.mode], "dossier": m.dossier_id.reference})
        events, registrations = _events(dossiers, start)
        for e in events.filtered(lambda e: e.state == "published" and e.start <= end):
            registration = registrations.get(e.id)
            items.append({"key": f"event-{e.id}", "kind": "event", "title": e.name, "start": e.start, "end": e.end,
                          "all_day": False, "link": f"/portail/evenements#evenement-{e.id}",
                          "state": registration.state if registration else "open", "detail": e.location or "En ligne",
                          "dossier": None})
        for a in dossiers.action_ids.filtered(lambda a: a.portal_visible and a.assignee == "porteur" and a.due_date
                                              and a.state != "cancelled"):
            day = vues.at_noon(a.due_date)
            if start <= day <= end:
                items.append({"key": f"action-{a.id}", "kind": "action", "title": a.name, "start": day, "end": None,
                              "all_day": True, "link": f"/portail/actions?dossier={a.dossier_id.id}", "state": a.state,
                              "detail": "Échéance", "dossier": a.dossier_id.reference})
        for f in dossiers.funding_ids.filtered("next_date"):
            day = vues.at_noon(f.next_date)
            if start <= day <= end:
                items.append({"key": f"funding-{f.id}", "kind": "funding", "title": f"{f.funder_id.name} : {f.next_step or 'relance'}",
                              "start": day, "end": None, "all_day": True,
                              "link": f"/portail/projet?dossier={f.dossier_id.id}", "state": f.state,
                              "detail": "Financement", "dossier": f.dossier_id.reference})
        items.sort(key=lambda i: i["start"])
        return items

    # ─── Notifications ───────────────────────────────────────────────────

    @api_route("/portail/notifications", profiles=PORTEUR)
    def notifications(self, **_kw):
        Notification = request.env["portail.notification"].sudo()
        items = Notification.search([("user_id", "=", _me().id)], limit=100)
        return {"unread": _notifications_unread(), "items": [vues.notification_row(n) for n in items]}

    @api_route("/portail/notifications/lues", methods=("POST",), profiles=PORTEUR)
    def lues(self, **_kw):
        ids = read_json().get("ids")
        domain = [("user_id", "=", _me().id), ("read_at", "=", False)]
        if ids:
            domain.append(("id", "in", [int(i) for i in ids if str(i).isdigit()]))
        request.env["portail.notification"].sudo().search(domain).write({"read_at": fields.Datetime.now()})
        return {"unread": _notifications_unread()}

    # ─── Profil et avis ──────────────────────────────────────────────────

    def _profile(self):
        me = _me()
        promoter = _dossiers()[:1].promoter_id
        return {"user": {"name": me.name, "login": me.login, "phone": me.partner_id.phone or None,
                         "email": me.partner_id.email or None},
                "entreprise": {"name": promoter.name, **{f: promoter[f] or None for f in PROFILE_FIELDS}}
                if promoter else None}

    @api_route("/portail/profil", profiles=PORTEUR)
    def profil(self, **_kw):
        return self._profile()

    @api_route("/portail/profil", methods=("PATCH",), profiles=PORTEUR)
    def modifier_profil(self, **_kw):
        """Le porteur tient à jour ses propres coordonnées. La fiche de son entreprise (tiers du cabinet,
        adresse de facturation comprise) ne change pas d'ici : sa demande part au consultant, qui la
        reporte après contrôle."""
        me, data, dossiers = _me(), read_json(), _dossiers()

        def clean(value, size=120):
            return " ".join(str(value or "").split())[:size] or False

        contact = {f: clean(data["user"][f]) for f in ("phone", "email") if f in (data.get("user") or {})}
        company = {f: clean(data["entreprise"][f]) for f in PROFILE_FIELDS if f in (data.get("entreprise") or {})}
        for values, label in ((contact, ""), (company, " de l'entreprise")):
            if values.get("email") and "@" not in values["email"]:
                raise ApiError(422, "business_rule", f"Adresse électronique{label} invalide.")
        if company.get("website") and not company["website"].startswith(("https://", "http://")):
            company["website"] = f"https://{company['website']}"
        if contact and me.partner_id in dossiers.promoter_id:
            # Compte rattaché à la fiche même de l'entreprise : même circuit que l'entreprise.
            company.update(contact)
            contact = {}
        if contact:
            me.partner_id.sudo().write(contact)
        promoter = dossiers[:1].promoter_id
        changes = [f"- {PROFILE_LABELS[f]} : {company[f] or '(à effacer)'}" for f in PROFILE_FIELDS
                   if f in company and (promoter[f] or False) != company[f]] if promoter else []
        if changes:
            dossier = dossiers.filtered(lambda d: d.promoter_id == promoter)[:1]
            request.env["axispro.message"].sudo().create({
                "dossier_id": dossier.id, "author_id": me.id, "internal": False,
                "body": "\n".join([f"Demande de mise à jour de la fiche de {promoter.name} :", *changes]),
            })
        return dict(self._profile(), request_sent=bool(changes))

    @api_route("/portail/avis", profiles=PORTEUR)
    def avis(self, **_kw):
        feedback = request.env["portail.feedback"].sudo().search([("user_id", "=", _me().id)], limit=50)
        return [vues.feedback_row(f) for f in feedback]

    @api_route("/portail/avis", methods=("POST",), profiles=PORTEUR)
    def donner_avis(self, **_kw):
        me = _me()
        data = read_json()
        dossier_id, score = require(data, "dossier_id", "score")
        dossier = _own(dossier_id)
        topic = data.get("topic") or "global"
        if topic not in dict(FEEDBACK_TOPICS):
            raise ApiError(400, "invalid_parameter", "Sujet inconnu.")
        event = request.env["portail.event"]
        if data.get("event_id"):
            registration = request.env["portail.event.registration"].sudo().search(
                [("event_id", "=", int(data["event_id"])), ("user_id", "=", me.id)], limit=1)
            if not registration:
                raise ApiError(422, "business_rule", "Vous n'étiez pas inscrit à cet événement.")
            event = registration.event_id
        try:
            values = {"score": int(score), "recommend": int(data["recommend"]) if data.get("recommend") not in (None, "") else -1,
                      "comment": str(data.get("comment") or "")[:3000] or False}
        except (TypeError, ValueError) as e:
            raise ApiError(400, "invalid_parameter", "Note invalide.") from e
        Feedback = request.env["portail.feedback"].sudo()
        recent = Feedback.search([("user_id", "=", me.id), ("dossier_id", "=", dossier.id), ("topic", "=", topic),
                                  ("event_id", "=", event.id or False),
                                  ("create_date", ">=", fields.Datetime.now() - timedelta(days=30))], limit=1)
        if recent:
            recent.write(values)
            feedback = recent
        else:
            feedback = Feedback.create(dict(values, dossier_id=dossier.id, user_id=me.id, topic=topic,
                                            event_id=event.id or False))
        return vues.feedback_row(feedback)
