"""Discussion interne : routes /chat/... (contrat : apps/web/lib/discussions.ts).

Ouvertes aux seuls profils internes (un porteur de projet, ou un compte sans profil interne, reçoit 403
partout) ; refusées à une session de Rotations (organisation.SESSION_ROUTES). Tout s'exécute sous
l'identité du compte : les règles d'enregistrement ne lui montrent que ses conversations, et les méthodes
du modèle (models/chat.py) contrôlent chaque écriture.

Temps réel sans websocket (le noyau n'est pas exposé) : l'écran relit, par la passerelle, les messages
de la conversation ouverte toutes les 5 secondes (/updates, après un identifiant donné) et le nombre de
non-lus toutes les 30 secondes (/unread). Ces relectures n'entrent au journal des accès qu'en cas de
refus ou d'erreur (api_route, journal=False).
"""

from datetime import datetime

from odoo import fields, http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.admin import _scope_domain
from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require, sudo_env
from odoo.addons.eguitra_api.files import ACCEPTED, detect_type

from ..models.chat import INTERNAL_PROFILES, MAX_FILE, MAX_FILES, OBJECT_MODELS

INTERNES = INTERNAL_PROFILES
ADMIN = ("admin",)
EXCERPT = 140


def _channels():
    return request.env["eguitra.chat.channel"]


def _user_ref(user):
    return {"id": user.id, "name": user.name} if user else None


def _excerpt(message):
    if message.withdrawn:
        return None
    text = " ".join((message.body or "").split())
    if not text and message.attachment_ids:
        names = message.attachment_ids.mapped("name")
        text = "Pièce jointe : " + ", ".join(names)
    return text[:EXCERPT] + ("…" if len(text) > EXCERPT else "")


def _message_row(message, me):
    """Message vu par un membre. Retiré : ni texte ni pièces, la mention seule."""
    m = message.sudo()
    reply = m.reply_to_id
    return {
        "id": m.id,
        "kind": m.kind,
        "author": _user_ref(m.author_id),
        "mine": m.author_id == me,
        "date": m.date,
        "body": None if m.withdrawn else (m.body or ""),
        "withdrawn": m.withdrawn,
        "withdrawn_date": m.withdrawn_date or None,
        "reply_to": {"id": reply.id, "author": reply.author_id.name or None, "excerpt": _excerpt(reply),
                     "withdrawn": reply.withdrawn} if reply else None,
        "attachments": [] if m.withdrawn else [
            {"id": a.id, "name": a.name, "mimetype": a.mimetype, "size": a.file_size} for a in m.attachment_ids
        ],
    }


def _other_of_direct(channel, me):
    """Correspondant d'une conversation à deux, même retiré depuis (compte archivé)."""
    ids = [int(i) for i in (channel.direct_key or "").split("-") if i]
    other_id = next((i for i in ids if i != me.id), None)
    return request.env["res.users"].sudo().with_context(active_test=False).browse(other_id).exists()


def _object_info(channel):
    record = channel._object_record()
    if record is None:
        return None
    return {"model": channel.res_model, "id": channel.res_id, "type": OBJECT_MODELS.get(channel.res_model, "Fiche"),
            "label": record.display_name or channel.name or ""}


def _title(channel, me, obj):
    sudo = channel.sudo()
    if sudo.kind == "direct":
        other = _other_of_direct(sudo, me)
        if not other:
            return "Conversation"
        return other.name + ("" if other.active else " (compte archivé)")
    if sudo.kind == "object":
        return f"{obj['type']} {obj['label']}" if obj else (sudo.name or "Fiche")
    return sudo.name or "Groupe"


def _row(channel, me, unread, last_ids):
    """Ligne de la liste des conversations."""
    sudo = channel.sudo()
    obj = _object_info(channel) if sudo.kind == "object" else None
    last = request.env["eguitra.chat.message"].sudo().browse(last_ids.get(channel.id)).exists()
    members = sudo.member_ids.user_id
    return {
        "id": channel.id,
        "kind": sudo.kind,
        "title": _title(channel, me, obj),
        "object": obj,
        "members_count": len(members),
        "members": [_user_ref(u) for u in members[:6]],
        "owner": sudo.owner_id == me,
        "unread": unread.get(channel.id, 0),
        "last_message": {
            "id": last.id, "kind": last.kind, "author": last.author_id.name or None, "mine": last.author_id == me,
            "date": last.date, "excerpt": _excerpt(last), "withdrawn": last.withdrawn,
        } if last else None,
        "last_activity": last.date if last else sudo.create_date,
    }


def _detail(channel):
    me = request.env.user
    sudo = channel.sudo()
    channel.invalidate_recordset()
    unread = _channels()._unread_by_channel()
    data = _row(channel, me, unread, _channels()._last_message_ids(channel.ids))
    owner = sudo.kind == "group" and sudo.owner_id == me
    blocked = channel._post_blocked()
    data.update({
        "members": [{"id": m.user_id.id, "name": m.user_id.name, "owner": m.user_id == sudo.owner_id,
                     "me": m.user_id == me, "archived": not m.user_id.active} for m in sudo.member_ids],
        "can": {"post": not blocked, "add": owner, "remove": owner, "rename": owner,
                "leave": sudo.kind in ("group", "object")},
        "post_blocked": blocked,
    })
    return data


def _ids(values, field):
    if not isinstance(values, list) or not values:
        raise ApiError(400, "missing_fields", "Choisissez au moins un collègue.", fields=[field])
    try:
        return [int(v) for v in values]
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", "Comptes invalides.") from e


def _since(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).removesuffix("Z")).replace(tzinfo=None, microsecond=0)
    except ValueError as e:
        raise ApiError(400, "invalid_parameter", "Repère de relecture invalide.") from e


def _uploads():
    """Fichiers joints au message (champ « file », plusieurs possibles), lus avec une borne de taille."""
    uploads = [u for u in request.httprequest.files.getlist("file") if u and u.filename]
    if len(uploads) > MAX_FILES:
        raise ApiError(422, "business_rule", f"{MAX_FILES} pièces jointes au plus par message.")
    files = []
    for upload in uploads:
        content = upload.read(MAX_FILE + 1)
        if len(content) > MAX_FILE:
            raise ApiError(413, "too_large", f"{upload.filename} : fichier trop volumineux (20 Mo au plus).")
        if not detect_type(content):
            raise ApiError(415, "unsupported_type",
                           f"{upload.filename} : format refusé. Formats acceptés : {ACCEPTED}. Enregistrez le document "
                           "dans l'un de ces formats.")
        files.append((upload.filename, content))
    return files


class EguitraChatController(http.Controller):
    # ─── Non-lus et liste ────────────────────────────────────────────────

    @api_route("/chat/unread", profiles=INTERNES, journal=False)
    def unread(self, **_kw):
        """Nombre de messages non lus (relu toutes les 30 secondes par l'en-tête)."""
        return _channels().unread_summary()

    @api_route("/chat/conversations", profiles=INTERNES, journal=False)
    def conversations(self, **_kw):
        """Conversations du compte, la plus récemment active en tête (relue avec les non-lus). Une
        conversation de fiche que le compte ne lit plus n'y figure pas."""
        Channel = _channels()
        Channel._check_chat_user()
        me = request.env.user
        channels = Channel.search([])
        channels = channels.filtered(lambda c: c.kind != "object" or c._object_record() is not None)
        unread = Channel._unread_by_channel()
        last_ids = Channel._last_message_ids(channels.ids)
        rows = [_row(c, me, unread, last_ids) for c in channels]
        rows.sort(key=lambda r: (r["last_message"]["id"] if r["last_message"] else 0, r["id"]), reverse=True)
        return rows

    @api_route("/chat/users", profiles=INTERNES)
    def users(self, **kw):
        """Recherche d'un collègue : comptes internes actifs qui partagent au moins une société avec soi."""
        users = _channels().search_colleagues(kw.get("q") or "", limit=int_arg(kw, "limit", 20, 1, 50))
        mine = request.env.user.sudo().company_ids
        return [{"id": u.id, "name": u.name, "companies": (u.company_ids & mine).mapped("name")} for u in users]

    # ─── Ouverture ───────────────────────────────────────────────────────

    @api_route("/chat/conversations", methods=("POST",), profiles=INTERNES)
    def open_conversation(self, **_kw):
        """Conversation à deux (kind « direct », user_id) ou de groupe (kind « group », name, user_ids)."""
        data = read_json()
        (kind,) = require(data, "kind")
        Channel = _channels()
        if kind == "direct":
            (user_id,) = require(data, "user_id")
            channel = Channel.open_direct(user_id)
        elif kind == "group":
            (name,) = require(data, "name")
            channel = Channel.create_group(name, _ids(data.get("user_ids"), "user_ids"))
        else:
            raise ApiError(400, "invalid_parameter", "Sorte de conversation inconnue : direct ou group.")
        return _detail(channel)

    @api_route("/chat/objects", methods=("POST",), profiles=INTERNES)
    def open_object(self, **_kw):
        """Discussion d'une fiche (model, id) : refusée à qui ne lit pas la fiche."""
        data = read_json()
        model, res_id = require(data, "model", "id")
        return _detail(_channels().open_object(str(model), res_id))

    # ─── Conversation ────────────────────────────────────────────────────

    @api_route("/chat/conversations/<int:channel_id>", profiles=INTERNES)
    def conversation(self, channel_id, **_kw):
        return _detail(_channels()._get_for_user(channel_id))

    @api_route("/chat/conversations/<int:channel_id>", methods=("PATCH",), profiles=INTERNES)
    def rename(self, channel_id, **_kw):
        (name,) = require(read_json(), "name")
        return _detail(_channels()._get_for_user(channel_id).rename(name))

    @api_route("/chat/conversations/<int:channel_id>/members", methods=("POST",), profiles=INTERNES)
    def add_members(self, channel_id, **_kw):
        channel = _channels()._get_for_user(channel_id)
        return _detail(channel.add_members(_ids(read_json().get("user_ids"), "user_ids")))

    @api_route("/chat/conversations/<int:channel_id>/members/<int:user_id>", methods=("DELETE",), profiles=INTERNES)
    def remove_member(self, channel_id, user_id, **_kw):
        """Le responsable du groupe retire un membre ; un membre quitte la conversation (son propre compte)."""
        channel = _channels()._get_for_user(channel_id)
        if channel.remove_member(user_id):
            return {"left": True}
        return _detail(channel)

    # ─── Messages ────────────────────────────────────────────────────────

    @api_route("/chat/conversations/<int:channel_id>/messages", profiles=INTERNES)
    def messages(self, channel_id, **kw):
        """Derniers messages (50), ou ceux d'avant un identifiant (before) ; cursor : repère de la relecture."""
        channel = _channels()._get_for_user(channel_id)
        limit = int_arg(kw, "limit", 50, 1, 200)
        domain = [("channel_id", "=", channel.id)]
        before = int_arg(kw, "before")
        if before:
            domain.append(("id", "<", before))
        found = request.env["eguitra.chat.message"].search(domain, order="id desc", limit=limit + 1)
        me = request.env.user
        return {
            "messages": [_message_row(m, me) for m in reversed(found[:limit])],
            "has_more": len(found) > limit,
            "last_read_id": _channels()._my_last_read(channel),
            "cursor": fields.Datetime.now(),
        }

    @api_route("/chat/conversations/<int:channel_id>/updates", profiles=INTERNES, journal=False)
    def updates(self, channel_id, **kw):
        """Relecture de la conversation ouverte (toutes les 5 secondes) : messages après « after », messages
        retirés depuis « since » (repère rendu par l'appel précédent)."""
        channel = _channels()._get_for_user(channel_id)
        after = int_arg(kw, "after", 0, 0)
        since = _since(kw.get("since"))
        now = fields.Datetime.now()
        Message = request.env["eguitra.chat.message"]
        new = Message.search([("channel_id", "=", channel.id), ("id", ">", after)], order="id", limit=200)
        changed = Message.search([("channel_id", "=", channel.id), ("id", "<=", after),
                                  ("withdrawn_date", ">=", since)], order="id") if since else Message
        me = request.env.user
        return {"messages": [_message_row(m, me) for m in new], "changed": [_message_row(m, me) for m in changed],
                "cursor": now}

    @api_route("/chat/conversations/<int:channel_id>/messages", methods=("POST",), profiles=INTERNES)
    def post(self, channel_id, **_kw):
        """Message en multipart : body, reply_to (facultatif), file (zéro à cinq fichiers)."""
        channel = _channels()._get_for_user(channel_id)
        form = request.httprequest.form
        files = _uploads()
        body = form.get("body") or ""
        if not body.strip() and not files:
            raise ApiError(400, "missing_fields", "Écrivez un message ou joignez un fichier.", fields=["body"])
        message = channel.post(body, reply_to_id=form.get("reply_to") or None, files=files)
        return _message_row(message, request.env.user)

    @api_route("/chat/conversations/<int:channel_id>/read", methods=("POST",), profiles=INTERNES, journal=False)
    def read(self, channel_id, **_kw):
        """Lu jusqu'au message donné ; rend les non-lus du compte, pour l'en-tête."""
        channel = _channels()._get_for_user(channel_id)
        channel.mark_read(read_json().get("message_id"))
        return _channels().unread_summary()

    @api_route("/chat/messages/<int:message_id>/withdraw", methods=("POST",), profiles=INTERNES)
    def withdraw(self, message_id, **_kw):
        message = self._message(message_id)
        return _message_row(message.withdraw(), request.env.user)

    @api_route("/chat/messages/<int:message_id>/files/<int:attachment_id>", profiles=INTERNES)
    def download(self, message_id, attachment_id, **_kw):
        message = self._message(message_id)
        if message.sudo().withdrawn:
            raise ApiError(404, "not_found", "Ce message a été retiré : sa pièce jointe n'est plus servie.")
        attachment = message.sudo().attachment_ids.filtered(lambda a: a.id == attachment_id)
        if not attachment:
            raise ApiError(404, "not_found", "Pièce jointe introuvable.")
        return request.make_response(attachment.raw or b"", headers=[
            ("Content-Type", attachment.mimetype or "application/octet-stream"),
            ("Content-Disposition", content_disposition(attachment.name or "piece")),
            ("X-Content-Type-Options", "nosniff"),
        ])

    def _message(self, message_id):
        """Message d'une conversation du compte (règles d'enregistrement), fiche encore lisible."""
        message = request.env["eguitra.chat.message"].search([("id", "=", message_id)])
        if not message:
            raise ApiError(404, "not_found", "Message introuvable.")
        _channels()._get_for_user(message.channel_id.id)
        return message

    # ─── Administration ──────────────────────────────────────────────────

    @api_route("/chat/admin/users/<int:user_id>/remove", methods=("POST",), profiles=ADMIN)
    def remove_archived_user(self, user_id, **_kw):
        """Retire un compte archivé de toutes ses conversations ; rend leur nombre, sans les nommer."""
        env = sudo_env()
        user = env["res.users"].with_context(active_test=False).search([("id", "=", user_id)] + _scope_domain(env),
                                                                       limit=1)
        if not user or set(user.company_ids.ids) - set(request.env.user.company_ids.ids):
            raise ApiError(404, "not_found", "Utilisateur introuvable.")
        return {"removed": _channels().remove_archived_user(user)}
