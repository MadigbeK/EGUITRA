"""Outils du cabinet pour le portail (AxisPro Suite) : synthèse, porteurs, messagerie de tous les
dossiers, communications, centre de ressources, événements et inscriptions, rendez-vous, avis.

Lecture : administration, direction et cabinet ; écriture : cabinet. Tout est borné à la société de
travail (MB AxisPro Consulting), que le préfixe /axispro/ impose."""

import base64
from datetime import timedelta

from odoo import fields, http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require
from odoo.addons.eguitra_api.files import ACCEPTED, checked_name, detect_type
from odoo.addons.eguitra_axispro.controllers.common import MAX_FILE, store_upload

from ..models.agenda import EVENT_KINDS, MEETING_MODES, REGISTRATION_STATES
from ..models.audience import AUDIENCES
from ..models.contenu import ANNOUNCEMENT_KINDS, ARTICLE_KINDS, CATEGORY_COLORS
from . import vues

READ = ("admin", "direction", "cabinet")
WRITE = ("cabinet",)
AUDIENCE_FIELDS = ("audience", "gate_codes", "sector_keywords")


def _company():
    return request.env.company


def _browse(model, record_id, label):
    record = request.env[model].sudo().browse(int(record_id)).exists()
    if not record or record.company_id != _company():
        raise ApiError(404, "not_found", f"{label} introuvable.")
    return record


def _dossier(dossier_id):
    return _browse("axispro.dossier", dossier_id, "Dossier")


def _text(value, size):
    return str(value or "").strip()[:size] or False


def _date(value):
    return fields.Date.to_date(str(value)[:10]) if value else False


def _datetime(value, label="Date"):
    if not value:
        return False
    try:
        return fields.Datetime.to_datetime(str(value).replace("T", " ")[:19])
    except ValueError as e:
        raise ApiError(400, "invalid_parameter", f"{label} invalide.") from e


def _audience(data):
    values = {}
    if "audience" in data:
        if data["audience"] not in dict(AUDIENCES):
            raise ApiError(400, "invalid_parameter", "Public inconnu.")
        values["audience"] = data["audience"]
    for key in ("gate_codes", "sector_keywords"):
        if key in data:
            values[key] = _text(data[key], 300)
    if "dossier_ids" in data:
        dossiers = request.env["axispro.dossier"].sudo().browse([int(i) for i in data["dossier_ids"] or []]).exists()
        values["dossier_ids"] = [(6, 0, dossiers.filtered(lambda d: d.company_id == _company()).ids)]
    return values


def _audience_row(record):
    return {"audience": record.audience, "audience_label": dict(AUDIENCES)[record.audience],
            "dossier_ids": record.dossier_ids.ids, "gate_codes": record.gate_codes or "",
            "sector_keywords": record.sector_keywords or ""}


def _announcement_admin(a):
    audience = a._audience_users() if a.state in ("published", "archived") else request.env["res.users"]
    reads = a.read_ids
    return dict(vues.announcement_row(a, full=True), **_audience_row(a), state=a.state,
                stats={"audience": len(audience), "read": len(reads),
                       "acknowledged": len(reads.filtered("acknowledged_at"))})


def _article_admin(a):
    reactions = a.reaction_ids
    row = vues.article_row(a, full=True)
    row.update({"state": a.state, "gate_codes": a.gate_codes or "", "tags_text": a.tags or "",
                "create_date": a.create_date, "write_date": a.write_date,
                "stats": {"views": a.view_count, "readers": len(reactions.filtered("viewed_at")),
                          "helpful": len(reactions.filtered(lambda r: r.helpful == "yes")),
                          "not_helpful": len(reactions.filtered(lambda r: r.helpful == "no")),
                          "bookmarks": len(reactions.filtered("bookmarked"))}})
    return row


def _last_logins(users):
    """Dernière connexion réussie de chaque compte (tentatives de connexion de l'API)."""
    if not users:
        return {}
    request.env.cr.execute(
        "SELECT login, MAX(date) FROM eguitra_api_login_attempt WHERE success AND login = ANY(%s) GROUP BY login",
        (users.mapped("login"),))
    by_login = dict(request.env.cr.fetchall())
    return {u.id: by_login.get(u.login) for u in users}


def _portal_dossiers():
    Dossier = request.env["axispro.dossier"].sudo()
    return Dossier.search([("company_id", "=", _company().id), "|", ("portal_user_ids", "!=", False),
                           ("message_ids", "!=", False)])


class EguitraPortailCabinet(http.Controller):
    # ─── Synthèse et porteurs ────────────────────────────────────────────

    @api_route("/axispro/portail/synthese", profiles=READ)
    def synthese(self, **_kw):
        company, me = _company(), request.env.user
        now = fields.Datetime.now()
        dossiers = _portal_dossiers()
        porteurs = dossiers.portal_user_ids.filtered("active")
        logins = _last_logins(porteurs)
        unread = request.env["portail.read.marker"].unread(me, dossiers)
        waiting = [d for d in dossiers if d.message_ids.filtered(lambda m: not m.internal)[-1:].author_id.share]
        Meeting = request.env["portail.meeting"].sudo()
        feedback = request.env["portail.feedback"].sudo().search([("company_id", "=", company.id)])
        recommend = [r for r in feedback.mapped("recommend") if r >= 0]
        promoters = len([r for r in recommend if r >= 9])
        detractors = len([r for r in recommend if r <= 6])
        actions = request.env["axispro.action"].sudo().search(
            [("company_id", "=", company.id), ("state", "=", "submitted"), ("assignee", "=", "porteur")])
        events = request.env["portail.event"].sudo().search(
            [("company_id", "=", company.id), ("state", "=", "published"), ("start", ">=", now)])
        Article = request.env["portail.article"].sudo()
        announcements = request.env["portail.announcement"].sudo().search(
            [("company_id", "=", company.id), ("state", "=", "published")])
        return {
            "porteurs": {"total": len(porteurs),
                         "active_30d": len([u for u in porteurs if logins.get(u.id) and logins[u.id] >= now - timedelta(days=30)]),
                         "never": len([u for u in porteurs if not logins.get(u.id)])},
            "messages": {"unread": sum(unread.values()), "waiting": len(waiting)},
            "meetings": {"requested": Meeting.search_count([("company_id", "=", company.id), ("state", "=", "requested")]),
                         "upcoming": Meeting.search_count([("company_id", "=", company.id), ("state", "=", "confirmed"),
                                                           ("start", ">=", now)])},
            "actions_submitted": len(actions),
            "events": {"upcoming": len(events),
                       "registrations": len(events.registration_ids.filtered(lambda r: r.state == "registered"))},
            "feedback": {"count": len(feedback),
                         "average": round(sum(feedback.mapped("score")) / len(feedback), 1) if feedback else None,
                         "nps": round(100 * (promoters - detractors) / len(recommend)) if recommend else None},
            "articles": {"published": Article.search_count([("company_id", "=", company.id), ("state", "=", "published")]),
                         "drafts": Article.search_count([("company_id", "=", company.id), ("state", "=", "draft")]),
                         "views": sum(Article.search([("company_id", "=", company.id)]).mapped("view_count"))},
            "announcements": {"published": len(announcements),
                              "ack_pending": sum(max(0, len(a._audience_users()) - len(a.read_ids.filtered("acknowledged_at")))
                                                 for a in announcements.filtered("require_ack"))},
            "to_do": [
                *({"kind": "meeting", "title": f"Rendez-vous demandé : {m.subject}",
                   "detail": f"{m.requested_by.name}, {m.dossier_id.reference}", "link": "/axispro/portail/rendez-vous",
                   "date": m.create_date}
                  for m in Meeting.search([("company_id", "=", company.id), ("state", "=", "requested")], limit=10)),
                *({"kind": "message", "title": f"Message en attente de réponse : {d.reference}",
                   "detail": d.name, "link": f"/axispro/portail/messages?dossier={d.id}",
                   "date": d.message_ids.filtered(lambda m: not m.internal)[-1:].date} for d in waiting[:10]),
                *({"kind": "action", "title": f"Compte rendu à valider : {a.name}",
                   "detail": f"{a.dossier_id.reference}, {a.dossier_id.name}", "link": f"/axispro/dossiers/{a.dossier_id.id}",
                   "date": a.write_date} for a in actions[:10]),
            ],
        }

    @api_route("/axispro/portail/porteurs", profiles=READ)
    def porteurs(self, **_kw):
        dossiers = _portal_dossiers()
        users = dossiers.portal_user_ids
        logins = _last_logins(users)
        rows = []
        for user in users:
            mine = dossiers.filtered(lambda d, u=user: u in d.portal_user_ids)
            sent = request.env["axispro.message"].sudo().search(
                [("dossier_id", "in", mine.ids), ("author_id", "=", user.id)], order="date desc", limit=1)
            rows.append({"id": user.id, "name": user.name, "login": user.login, "active": user.active,
                         "phone": user.partner_id.phone or None, "last_login": logins.get(user.id),
                         "last_message": sent.date if sent else None,
                         "dossiers": [{"id": d.id, "reference": d.reference, "name": d.name,
                                       "current_gate": vues.gate_ref(d.current_gate_id)} for d in mine],
                         "feedback": [{"score": f.score, "topic": f.topic, "date": f.create_date}
                                      for f in mine.feedback_ids.filtered(lambda f, u=user: f.user_id == u)[:3]]})
        rows.sort(key=lambda r: r["last_login"] or fields.Datetime.to_datetime("1970-01-01"), reverse=True)
        return rows

    @api_route("/axispro/portail/cibles", profiles=READ)
    def cibles(self, **_kw):
        """Ce qu'il faut pour viser un public : dossiers, étapes et secteurs connus."""
        Dossier = request.env["axispro.dossier"].sudo()
        dossiers = Dossier.search([("company_id", "=", _company().id), ("state", "!=", "closed")])
        policy = request.env["axispro.policy"].sudo().active_policy(_company())
        return {
            "dossiers": [{"id": d.id, "reference": d.reference, "name": d.name, "sector": d.sector or None,
                          "current_gate": vues.gate_ref(d.current_gate_id), "portal_users": len(d.portal_user_ids)}
                         for d in dossiers],
            "gates": [{"code": g.code, "name": g.name} for g in policy.gate_ids.sorted("sequence")] if policy else [],
            "sectors": sorted({d.sector for d in dossiers if d.sector}),
            "audiences": [{"key": k, "label": v} for k, v in AUDIENCES],
            "announcement_kinds": [{"key": k, "label": v} for k, v in ANNOUNCEMENT_KINDS],
            "article_kinds": [{"key": k, "label": v} for k, v in ARTICLE_KINDS],
            "event_kinds": [{"key": k, "label": v} for k, v in EVENT_KINDS],
            "meeting_modes": [{"key": k, "label": v} for k, v in MEETING_MODES],
            "colors": list(CATEGORY_COLORS),
        }

    # ─── Messagerie de tous les dossiers ─────────────────────────────────

    @api_route("/axispro/portail/conversations", profiles=READ)
    def conversations(self, **_kw):
        me = request.env.user
        dossiers = _portal_dossiers()
        unread = request.env["portail.read.marker"].unread(me, dossiers)
        rows = []
        for d in dossiers:
            public = d.message_ids.filtered(lambda m: not m.internal)
            last = public[-1:]
            rows.append({
                "dossier": {"id": d.id, "reference": d.reference, "name": d.name, "promoter": d.promoter_id.name,
                            "consultant": d.consultant_id.name or None, "state": d.state},
                "portal_users": [u.name for u in d.portal_user_ids],
                "last_message": {"author": last.author_id.name, "body": vues.excerpt(last.body, 140), "date": last.date,
                                 "from_promoter": last.author_id.share} if last else None,
                "unread": unread.get(d.id, 0), "waiting": bool(last and last.author_id.share), "count": len(public),
            })
        rows.sort(key=lambda r: (r["last_message"] or {}).get("date") or fields.Datetime.to_datetime("1970-01-01"),
                  reverse=True)
        return rows

    @api_route("/axispro/portail/conversations/<int:dossier_id>", profiles=READ)
    def conversation(self, dossier_id, **_kw):
        me, dossier = request.env.user, _dossier(dossier_id)
        messages = dossier.message_ids
        public = messages.filtered(lambda m: not m.internal)
        if public:
            request.env["portail.read.marker"].mark(me, dossier, max(public.ids))
        return {"dossier": dict(vues.dossier_ref(dossier), promoter=dossier.promoter_id.name),
                "portal_users": [vues.person(u) for u in dossier.portal_user_ids],
                "messages": [vues.message_row(m, me) for m in messages]}

    @api_route("/axispro/portail/conversations/<int:dossier_id>", methods=("POST",), profiles=WRITE)
    def repondre(self, dossier_id, **_kw):
        me, dossier = request.env.user, _dossier(dossier_id)
        form = request.httprequest.form
        body = (form.get("body") or "").strip()
        internal = form.get("internal") in ("1", "true")
        has_file = bool(request.httprequest.files.get("file"))
        if not body and not has_file:
            raise ApiError(400, "missing_fields", "Écrivez un message ou joignez un fichier.", fields=["body"])
        documents = store_upload(dossier, portal_visible=not internal) if has_file else request.env["axispro.document"]
        message = request.env["axispro.message"].sudo().create({
            "dossier_id": dossier.id, "author_id": me.id, "internal": internal,
            "body": body[:5000] or f"Pièce jointe : {documents.name}", "document_ids": [(6, 0, documents.ids)],
        })
        if not internal:
            request.env["portail.read.marker"].mark(me, dossier, message.id)
        return vues.message_row(message, me)

    @api_route("/axispro/portail/documents/<int:document_id>/download", profiles=READ)
    def telecharger(self, document_id, **_kw):
        doc = _browse("axispro.document", document_id, "Pièce")
        attachment = doc.attachment_id
        return request.make_response(attachment.raw, headers=[
            ("Content-Type", attachment.mimetype or "application/octet-stream"),
            ("Content-Disposition", content_disposition(attachment.name)),
            ("X-Content-Type-Options", "nosniff"),
        ])

    # ─── Communications ──────────────────────────────────────────────────

    @api_route("/axispro/portail/annonces", profiles=READ)
    def annonces(self, **_kw):
        found = request.env["portail.announcement"].sudo().search([("company_id", "=", _company().id)])
        return [_announcement_admin(a) for a in found]

    def _announcement_values(self, data):
        values = _audience(data)
        if "kind" in data:
            if data["kind"] not in dict(ANNOUNCEMENT_KINDS):
                raise ApiError(400, "invalid_parameter", "Nature inconnue.")
            values["kind"] = data["kind"]
        for key, size in (("title", 200), ("body", 60_000), ("cta_url", 500), ("cta_label", 80)):
            if key in data:
                values["name" if key == "title" else key] = _text(data[key], size)
        for key in ("pinned", "require_ack"):
            if key in data:
                values[key] = bool(data[key])
        if "expire_date" in data:
            values["expire_date"] = _date(data["expire_date"])
        return values

    @api_route("/axispro/portail/annonces", methods=("POST",), profiles=WRITE)
    def creer_annonce(self, **_kw):
        data = read_json()
        require(data, "title")
        announcement = request.env["portail.announcement"].sudo().create(
            dict(self._announcement_values(data), company_id=_company().id, author_id=request.env.user.id))
        if data.get("publish"):
            announcement.action_publish()
        return _announcement_admin(announcement)

    @api_route("/axispro/portail/annonces/<int:announcement_id>", methods=("PATCH",), profiles=WRITE)
    def modifier_annonce(self, announcement_id, **_kw):
        announcement = _browse("portail.announcement", announcement_id, "Communication")
        announcement.write(self._announcement_values(read_json()))
        return _announcement_admin(announcement)

    @api_route("/axispro/portail/annonces/<int:announcement_id>/<string:action>", methods=("POST",), profiles=WRITE)
    def etat_annonce(self, announcement_id, action, **_kw):
        announcement = _browse("portail.announcement", announcement_id, "Communication")
        if action == "publier":
            announcement.action_publish()
        elif action == "archiver":
            announcement.state = "archived"
        elif action == "supprimer":
            if announcement.state != "draft":
                raise ApiError(422, "business_rule", "Seul un brouillon se supprime : archivez une communication publiée.")
            announcement.unlink()
            return {"status": "ok"}
        else:
            raise ApiError(404, "not_found", "Action inconnue.")
        return _announcement_admin(announcement)

    @api_route("/axispro/portail/annonces/<int:announcement_id>/lectures", profiles=READ)
    def lectures(self, announcement_id, **_kw):
        announcement = _browse("portail.announcement", announcement_id, "Communication")
        reads = {r.user_id.id: r for r in announcement.read_ids}
        users = announcement._audience_users() | announcement.read_ids.user_id
        return [{"user_id": u.id, "user": u.name, "read_at": reads[u.id].read_at if u.id in reads else None,
                 "acknowledged_at": reads[u.id].acknowledged_at if u.id in reads else None} for u in users]

    # ─── Centre de ressources ────────────────────────────────────────────

    @api_route("/axispro/portail/rubriques", profiles=READ)
    def rubriques(self, **_kw):
        categories = request.env["portail.category"].sudo().search([("company_id", "=", _company().id)])
        return [vues.category_row(c, len(c.article_ids)) for c in categories]

    def _category_values(self, data):
        values = {}
        for key, size in (("name", 80), ("description", 200), ("icon", 40)):
            if key in data:
                values[key] = _text(data[key], size)
        if "color" in data:
            if data["color"] not in CATEGORY_COLORS:
                raise ApiError(400, "invalid_parameter", "Teinte inconnue.")
            values["color"] = data["color"]
        if "sequence" in data:
            values["sequence"] = int(data["sequence"] or 0)
        return values

    @api_route("/axispro/portail/rubriques", methods=("POST",), profiles=WRITE)
    def creer_rubrique(self, **_kw):
        data = read_json()
        require(data, "name")
        category = request.env["portail.category"].sudo().create(dict(self._category_values(data), company_id=_company().id))
        return vues.category_row(category, 0)

    @api_route("/axispro/portail/rubriques/<int:category_id>", methods=("PATCH",), profiles=WRITE)
    def modifier_rubrique(self, category_id, **_kw):
        category = _browse("portail.category", category_id, "Rubrique")
        category.write(self._category_values(read_json()))
        return vues.category_row(category, len(category.article_ids))

    @api_route("/axispro/portail/articles", profiles=READ)
    def articles(self, **_kw):
        found = request.env["portail.article"].sudo().search([("company_id", "=", _company().id)])
        return [_article_admin(a) for a in found]

    @api_route("/axispro/portail/articles/<int:article_id>", profiles=READ)
    def article(self, article_id, **_kw):
        return _article_admin(_browse("portail.article", article_id, "Contenu"))

    def _article_values(self, data):
        values = {}
        if "kind" in data:
            if data["kind"] not in dict(ARTICLE_KINDS):
                raise ApiError(400, "invalid_parameter", "Format inconnu.")
            values["kind"] = data["kind"]
        for key, size in (("title", 200), ("summary", 300), ("body", 60_000), ("tags", 300), ("gate_codes", 200),
                          ("video_url", 500)):
            if key in data:
                values["name" if key == "title" else key] = _text(data[key], size)
        if "featured" in data:
            values["featured"] = bool(data["featured"])
        if "category_id" in data:
            values["category_id"] = _browse("portail.category", data["category_id"], "Rubrique").id \
                if data["category_id"] else False
        return values

    @api_route("/axispro/portail/articles", methods=("POST",), profiles=WRITE)
    def creer_article(self, **_kw):
        data = read_json()
        require(data, "title")
        article = request.env["portail.article"].sudo().create(
            dict(self._article_values(data), company_id=_company().id, author_id=request.env.user.id))
        return _article_admin(article)

    @api_route("/axispro/portail/articles/<int:article_id>", methods=("PATCH",), profiles=WRITE)
    def modifier_article(self, article_id, **_kw):
        article = _browse("portail.article", article_id, "Contenu")
        article.write(self._article_values(read_json()))
        return _article_admin(article)

    @api_route("/axispro/portail/articles/<int:article_id>/<string:action>", methods=("POST",), profiles=WRITE)
    def etat_article(self, article_id, action, **_kw):
        article = _browse("portail.article", article_id, "Contenu")
        if action == "publier":
            article.action_publish()
        elif action == "archiver":
            article.state = "archived"
        elif action == "brouillon":
            article.state = "draft"
        elif action == "supprimer":
            if article.state == "published":
                raise ApiError(422, "business_rule", "Archivez d'abord ce contenu publié.")
            article.attachment_ids.unlink()
            article.unlink()
            return {"status": "ok"}
        elif action == "fichiers":
            return self._ajouter_fichier(article)
        else:
            raise ApiError(404, "not_found", "Action inconnue.")
        return _article_admin(article)

    def _ajouter_fichier(self, article):
        upload = request.httprequest.files.get("file")
        if not upload:
            raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
        if len(article.attachment_ids) >= 10:
            raise ApiError(422, "business_rule", "Dix fichiers au plus par contenu.")
        content = upload.read(MAX_FILE + 1)
        if len(content) > MAX_FILE:
            raise ApiError(413, "too_large", "Fichier trop volumineux (20 Mo maximum).")
        mimetype = detect_type(content)
        if not mimetype:
            raise ApiError(415, "unsupported_type", f"Formats acceptés : {ACCEPTED}.")
        attachment = request.env["ir.attachment"].sudo().create({
            "name": checked_name(upload.filename, mimetype), "datas": base64.b64encode(content), "mimetype": mimetype,
            "res_model": "portail.article", "res_id": article.id,
        })
        article.attachment_ids = [(4, attachment.id)]
        return _article_admin(article)

    @api_route("/axispro/portail/articles/<int:article_id>/fichiers/<int:attachment_id>", methods=("DELETE",),
               profiles=WRITE)
    def retirer_fichier(self, article_id, attachment_id, **_kw):
        article = _browse("portail.article", article_id, "Contenu")
        attachment = article.attachment_ids.filtered(lambda a: a.id == attachment_id)
        if not attachment:
            raise ApiError(404, "not_found", "Fichier introuvable.")
        article.attachment_ids = [(3, attachment.id)]
        attachment.unlink()
        return _article_admin(article)

    @api_route("/axispro/portail/articles/<int:article_id>/fichiers/<int:attachment_id>", profiles=READ)
    def fichier_article(self, article_id, attachment_id, **_kw):
        article = _browse("portail.article", article_id, "Contenu")
        attachment = article.attachment_ids.filtered(lambda a: a.id == attachment_id)
        if not attachment:
            raise ApiError(404, "not_found", "Fichier introuvable.")
        return request.make_response(attachment.raw, headers=[
            ("Content-Type", attachment.mimetype or "application/octet-stream"),
            ("Content-Disposition", content_disposition(attachment.name)),
            ("X-Content-Type-Options", "nosniff"),
        ])

    # ─── Événements ──────────────────────────────────────────────────────

    @api_route("/axispro/portail/evenements", profiles=READ)
    def evenements(self, **_kw):
        events = request.env["portail.event"].sudo().search([("company_id", "=", _company().id)])
        return [vues.event_row(e, cabinet=True) for e in events]

    def _event_values(self, data):
        values = _audience(data)
        if "kind" in data:
            if data["kind"] not in dict(EVENT_KINDS):
                raise ApiError(400, "invalid_parameter", "Format inconnu.")
            values["kind"] = data["kind"]
        for key, size in (("name", 200), ("description", 20_000), ("speaker", 200), ("location", 200),
                          ("online_url", 500)):
            if key in data:
                values[key] = _text(data[key], size)
        for key in ("start", "end", "registration_deadline"):
            if key in data:
                values[key] = _datetime(data[key], key)
        if "capacity" in data:
            values["capacity"] = int(data["capacity"] or 0)
        return values

    @api_route("/axispro/portail/evenements", methods=("POST",), profiles=WRITE)
    def creer_evenement(self, **_kw):
        data = read_json()
        require(data, "name", "start", "end")
        event = request.env["portail.event"].sudo().create(dict(self._event_values(data), company_id=_company().id))
        if data.get("publish"):
            event.action_publish()
        return vues.event_row(event, cabinet=True)

    @api_route("/axispro/portail/evenements/<int:event_id>", methods=("PATCH",), profiles=WRITE)
    def modifier_evenement(self, event_id, **_kw):
        event = _browse("portail.event", event_id, "Événement")
        event.write(self._event_values(read_json()))
        return vues.event_row(event, cabinet=True)

    @api_route("/axispro/portail/evenements/<int:event_id>/<string:action>", methods=("POST",), profiles=WRITE)
    def etat_evenement(self, event_id, action, **_kw):
        event = _browse("portail.event", event_id, "Événement")
        if action == "publier":
            event.action_publish()
        elif action == "annuler":
            event.action_cancel()
        elif action == "supprimer":
            if event.state != "draft":
                raise ApiError(422, "business_rule", "Seul un brouillon se supprime : annulez un événement publié.")
            event.unlink()
            return {"status": "ok"}
        else:
            raise ApiError(404, "not_found", "Action inconnue.")
        return vues.event_row(event, cabinet=True)

    @api_route("/axispro/portail/evenements/<int:event_id>/inscriptions", profiles=READ)
    def inscriptions(self, event_id, **_kw):
        event = _browse("portail.event", event_id, "Événement")
        return [{"id": r.id, "user": r.user_id.name, "login": r.user_id.login, "phone": r.user_id.partner_id.phone or None,
                 "dossier": {"id": r.dossier_id.id, "reference": r.dossier_id.reference} if r.dossier_id else None,
                 "state": r.state, "state_label": dict(REGISTRATION_STATES)[r.state], "note": r.note or None,
                 "date": r.create_date} for r in event.registration_ids]

    @api_route("/axispro/portail/inscriptions/<int:registration_id>", methods=("PATCH",), profiles=WRITE)
    def pointer(self, registration_id, **_kw):
        registration = _browse("portail.event.registration", registration_id, "Inscription")
        (state,) = require(read_json(), "state")
        if state not in ("registered", "attended", "absent", "cancelled"):
            raise ApiError(400, "invalid_parameter", "État inconnu.")
        if state == "cancelled":
            registration.cancel()
        else:
            registration.state = state
        return {"id": registration.id, "state": registration.state,
                "state_label": dict(REGISTRATION_STATES)[registration.state]}

    # ─── Rendez-vous ─────────────────────────────────────────────────────

    @api_route("/axispro/portail/rendez-vous", profiles=READ)
    def rendez_vous(self, **_kw):
        meetings = request.env["portail.meeting"].sudo().search([("company_id", "=", _company().id)], limit=300)
        order = {"requested": 0, "confirmed": 1, "done": 2, "declined": 3, "cancelled": 4}
        rows = [vues.meeting_row(m, request.env.user) for m in meetings]
        rows.sort(key=lambda r: (order[r["state"]], r["start"] or r["create_date"]))
        return rows

    @api_route("/axispro/portail/rendez-vous", methods=("POST",), profiles=WRITE)
    def planifier(self, **_kw):
        """Rendez-vous fixé par le cabinet : confirmé d'emblée, le porteur est prévenu."""
        data = read_json()
        dossier_id, subject, start = require(data, "dossier_id", "subject", "start")
        dossier = _dossier(dossier_id)
        mode = data.get("mode") or "office"
        if mode not in dict(MEETING_MODES):
            raise ApiError(400, "invalid_parameter", "Forme de rendez-vous inconnue.")
        meeting = request.env["portail.meeting"].sudo().create({
            "dossier_id": dossier.id, "requested_by": request.env.user.id, "consultant_id": request.env.user.id,
            "subject": _text(subject, 200), "agenda": _text(data.get("agenda"), 3000), "mode": mode,
            "duration": int(data.get("duration") or 60),
        })
        meeting.confirm(_datetime(start), location=_text(data.get("location"), 200),
                        online_url=_text(data.get("online_url"), 500), cabinet_note=_text(data.get("cabinet_note"), 2000))
        return vues.meeting_row(meeting, request.env.user)

    @api_route("/axispro/portail/rendez-vous/<int:meeting_id>", methods=("PATCH",), profiles=WRITE)
    def traiter(self, meeting_id, **_kw):
        meeting = _browse("portail.meeting", meeting_id, "Rendez-vous")
        data = read_json()
        (action,) = require(data, "action")
        note = _text(data.get("cabinet_note"), 2000)
        if action == "confirm":
            values = {"consultant_id": meeting.consultant_id.id or request.env.user.id}
            for key, size in (("location", 200), ("online_url", 500)):
                if key in data:
                    values[key] = _text(data[key], size)
            if "duration" in data:
                values["duration"] = int(data["duration"] or 60)
            if data.get("mode") in dict(MEETING_MODES):
                values["mode"] = data["mode"]
            if note:
                values["cabinet_note"] = note
            meeting.confirm(_datetime(data.get("start"), "Date du rendez-vous"), **values)
        elif action == "decline":
            meeting.decline(note)
        elif action == "cancel":
            meeting.cancel(note)
        elif action == "done":
            meeting.mark_done(_text(data.get("minutes"), 20_000))
        elif action == "minutes":
            meeting.minutes = _text(data.get("minutes"), 20_000)
        else:
            raise ApiError(400, "invalid_parameter", "Action inconnue.")
        return vues.meeting_row(meeting, request.env.user)

    # ─── Avis ────────────────────────────────────────────────────────────

    @api_route("/axispro/portail/avis", profiles=READ)
    def avis(self, **_kw):
        feedback = request.env["portail.feedback"].sudo().search([("company_id", "=", _company().id)], limit=500)
        return [vues.feedback_row(f) for f in feedback]

    # ─── Notifications du cabinet ────────────────────────────────────────

    @api_route("/axispro/portail/notifications", profiles=READ)
    def notifications(self, **_kw):
        Notification = request.env["portail.notification"].sudo()
        items = Notification.search([("user_id", "=", request.env.user.id)], limit=60)
        unread = Notification.search_count([("user_id", "=", request.env.user.id), ("read_at", "=", False)])
        return {"unread": unread, "items": [vues.notification_row(n) for n in items]}

    @api_route("/axispro/portail/notifications/lues", methods=("POST",), profiles=READ)
    def lues(self, **_kw):
        request.env["portail.notification"].sudo().search(
            [("user_id", "=", request.env.user.id), ("read_at", "=", False)]).write({"read_at": fields.Datetime.now()})
        return {"unread": 0}
