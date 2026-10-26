"""Discussion interne : conversations entre comptes internes de la plateforme.

Trois sortes de conversations :
- à deux (« direct ») : une seule par paire de comptes ;
- de groupe (« group ») : nommée ; son responsable (le créateur, puis le plus ancien membre s'il part)
  y ajoute et en retire des membres et la renomme ; chacun peut la quitter ;
- d'une fiche (« object ») : rattachée à un dossier AxisPro, un chantier, une rotation ou un bien. Qui
  peut lire la fiche la rejoint en ouvrant sa discussion ; elle se ferme à qui ne lit plus la fiche.

Confidentialité. Une conversation, ses membres et ses messages ne se lisent que par ses membres : les
règles d'enregistrement (security/chat_rules.xml) sont globales, elles valent pour tous les comptes,
administration comprise ; seul le superutilisateur du noyau, qui n'est le compte de personne, y échappe.
Les comptes n'ont que la lecture (security/ir.model.access.csv) : toute écriture passe par les méthodes
ci-dessous, qui contrôlent sous l'identité du compte avant d'écrire. L'administration ne lit aucune
conversation dont elle n'est pas membre ; elle peut seulement retirer un compte archivé de toutes les
conversations (remove_archived_user), sans en lire aucune.

Comptes admis (chat_allowed) : internes (jamais un porteur du portail), actifs, avec au moins un profil
interne. On n'ouvre une conversation, et l'on n'ajoute un membre, qu'avec des comptes qui partagent au
moins une société avec soi.

Messages : texte, pièces jointes (format reconnu au contenu, eguitra_api/files.py), réponse à un
message, retrait par son auteur (« message retiré » : texte et pièces ne sont plus servis, la trace
reste en base). La lecture est suivie par membre (eguitra.chat.read : dernier message lu) pour les
non-lus.
"""

import base64
import re

from odoo import Command, api, fields, models
from odoo.exceptions import AccessError, MissingError, UserError

from odoo.addons.eguitra_api.files import ACCEPTED, checked_name, detect_type
from odoo.addons.eguitra_base.models.res_users import PROFILE_GROUPS

ADMIN_GROUP = "eguitra_base.group_profile_admin"
# Profils internes : tous, sauf celui du porteur de projet (utilisateur du portail).
INTERNAL_PROFILES = tuple(code for code in PROFILE_GROUPS if code != "porteur")

KINDS = [("direct", "À deux"), ("group", "Groupe"), ("object", "Fiche")]
MESSAGE_KINDS = [("message", "Message"), ("event", "Événement")]

# Fiches qui portent une discussion : modèle -> nature affichée. Un modèle dont le module n'est pas
# installé est ignoré. Une nouvelle fiche s'inscrit ici et dans apps/web/lib/discussions.ts.
OBJECT_MODELS = {
    "axispro.dossier": "Dossier",
    "eguitra.chantier": "Chantier",
    "eguitra.transport.rotation": "Rotation",
    "eguitra.property": "Bien",
}

MAX_BODY = 5000
MAX_NAME = 80
MAX_MEMBERS = 50
MAX_FILES = 5
MAX_FILE = 20 * 1024 * 1024
MAX_FILES_TOTAL = 50 * 1024 * 1024
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _technical_ids(env):
    """Comptes techniques du noyau : jamais correspondants d'une discussion."""
    ids = []
    for xmlid in ("base.user_root", "base.user_admin", "base.public_user", "base.template_portal_user_id"):
        record = env.ref(xmlid, raise_if_not_found=False)
        if record:
            ids.append(record.id)
    return ids


def chat_allowed(user):
    """Compte admis à la discussion : interne, actif, avec au moins un profil interne."""
    user = user.sudo()
    if not user or not user.active or user.share or user.id in _technical_ids(user.env):
        return False
    return bool(set(user._eguitra_profiles()) & set(INTERNAL_PROFILES))


def shares_company(user, other):
    return bool(user.sudo().company_ids & other.sudo().company_ids)


def clean_text(value, size):
    """Texte d'un message : retours à la ligne gardés, caractères de contrôle retirés."""
    text = CONTROL.sub("", str(value or "").replace("\r\n", "\n").replace("\r", "\n")).strip()
    if len(text) > size:
        raise UserError(f"Message trop long : {size} caractères au plus.")
    return text


def clean_line(value, size):
    """Nom d'un groupe : une ligne, sans caractère de contrôle."""
    return " ".join(CONTROL.sub(" ", str(value or "")).split())[:size]


class ChatChannel(models.Model):
    _name = "eguitra.chat.channel"
    _description = "Conversation de la discussion interne"
    _order = "id desc"

    name = fields.Char("Nom", help="Groupe : nom choisi ; fiche : libellé de la fiche à l'ouverture.")
    kind = fields.Selection(KINDS, "Sorte", required=True)
    owner_id = fields.Many2one("res.users", "Responsable", ondelete="set null", index=True,
                               help="Groupe : ajoute et retire des membres, renomme la conversation.")
    member_ids = fields.One2many("eguitra.chat.member", "channel_id", "Membres")
    message_ids = fields.One2many("eguitra.chat.message", "channel_id", "Messages")
    res_model = fields.Char("Modèle de la fiche", index=True)
    res_id = fields.Integer("Fiche", index=True)
    direct_key = fields.Char("Paire de comptes", index=True, copy=False)

    _direct_unique = models.Constraint("unique(direct_key)", "Une seule conversation à deux par paire de comptes.")
    _object_unique = models.Constraint("unique(res_model, res_id)", "Une seule discussion par fiche.")

    # ─── Comptes ─────────────────────────────────────────────────────────

    @api.model
    def _check_chat_user(self):
        if not chat_allowed(self.env.user):
            raise AccessError("La discussion est réservée aux comptes internes de la plateforme.")

    @api.model
    def _colleague(self, user_id):
        """Compte admis qui partage au moins une société avec le compte courant."""
        me = self.env.user
        try:
            user_id = int(user_id)
        except (TypeError, ValueError) as e:
            raise UserError("Compte inconnu.") from e
        user = self.env["res.users"].sudo().browse(user_id).exists()
        if not user or user == me or not chat_allowed(user):
            raise UserError("Ce compte ne reçoit pas de messages : seuls les comptes internes actifs participent à la "
                            "discussion.")
        if not shares_company(me, user):
            raise AccessError(f"Vous ne partagez aucune société avec {user.name} : la conversation est refusée.")
        return user

    @api.model
    def search_colleagues(self, query="", limit=20):
        """Collègues à qui écrire : comptes admis qui partagent au moins une société avec soi."""
        self._check_chat_user()
        me = self.env.user.sudo()
        groups = [self.env.ref(PROFILE_GROUPS[code]).id for code in INTERNAL_PROFILES]
        domain = [
            ("share", "=", False), ("id", "not in", _technical_ids(self.env) + [me.id]),
            ("company_ids", "in", me.company_ids.ids), ("group_ids", "in", groups),
        ]
        query = clean_line(query, 80)
        if query:
            domain += ["|", ("name", "ilike", query), ("login", "ilike", query)]
        users = self.env["res.users"].sudo().search(domain, limit=limit * 2, order="name, id")
        return users.filtered(chat_allowed)[:limit]

    # ─── Ouverture ───────────────────────────────────────────────────────

    @api.model
    def open_direct(self, user_id):
        """Conversation à deux avec un collègue : la même à chaque ouverture, créée la première fois."""
        self._check_chat_user()
        me = self.env.user
        other = self._colleague(user_id)
        key = "-".join(str(i) for i in sorted((me.id, other.id)))
        channel = self.sudo().search([("direct_key", "=", key)], limit=1)
        if not channel:
            channel = self.sudo().create({
                "kind": "direct", "direct_key": key,
                "member_ids": [Command.create({"user_id": me.id}), Command.create({"user_id": other.id})],
            })
        else:
            missing = (me | other) - channel.member_ids.user_id
            if missing:
                channel.member_ids = [Command.create({"user_id": u.id}) for u in missing]
                channel._mark_read(missing, channel._last_message_id())
        return channel.with_env(self.env)

    @api.model
    def create_group(self, name, user_ids):
        """Conversation de groupe nommée ; son créateur en est le responsable."""
        self._check_chat_user()
        me = self.env.user
        name = clean_line(name, MAX_NAME)
        if not name:
            raise UserError("Donnez un nom au groupe.")
        others = self.env["res.users"]
        for user_id in dict.fromkeys(user_ids or []):
            if str(user_id) != str(me.id):
                others |= self._colleague(user_id)
        if not others:
            raise UserError("Choisissez au moins un collègue.")
        if len(others) + 1 > MAX_MEMBERS:
            raise UserError(f"Un groupe compte {MAX_MEMBERS} membres au plus.")
        channel = self.sudo().create({
            "kind": "group", "name": name, "owner_id": me.id,
            "member_ids": [Command.create({"user_id": u.id}) for u in me | others],
        })
        channel._event(f"{me.name} a créé le groupe « {name} ».")
        return channel.with_env(self.env)

    @api.model
    def open_object(self, model, res_id):
        """Discussion d'une fiche : qui peut lire la fiche la rejoint ; l'historique ne compte pas en non-lus."""
        self._check_chat_user()
        me = self.env.user
        record = self._readable_object(model, res_id)
        channel = self.sudo().search([("kind", "=", "object"), ("res_model", "=", model), ("res_id", "=", record.id)],
                                     limit=1)
        if not channel:
            channel = self.sudo().create({"kind": "object", "res_model": model, "res_id": record.id,
                                          "name": (record.display_name or "")[:200] or False})
        if me not in channel.member_ids.user_id:
            channel.member_ids = [Command.create({"user_id": me.id})]
            channel._mark_read(me, channel._last_message_id())
        return channel.with_env(self.env)

    @api.model
    def _readable_object(self, model, res_id):
        """Fiche lue sous l'identité du compte, dans toutes ses sociétés ; sinon refus."""
        if model not in OBJECT_MODELS or model not in self.env:
            raise UserError("Cette fiche ne porte pas de discussion.")
        user = self.env.user
        try:
            res_id = int(res_id)
        except (TypeError, ValueError) as e:
            raise MissingError("Fiche introuvable.") from e
        records = self.env[model].with_user(user).with_context(allowed_company_ids=user.sudo().company_ids.ids)
        record = records.browse(res_id).exists()
        if not record:
            raise MissingError("Fiche introuvable.")
        record.check_access("read")
        return record

    @api.model
    def _get_for_user(self, channel_id):
        """Conversation dont le compte est membre (règles d'enregistrement) et, pour une fiche, que le compte
        lit encore ; sinon introuvable, sans dire si elle existe."""
        self._check_chat_user()
        try:
            channel_id = int(channel_id)
        except (TypeError, ValueError) as e:
            raise MissingError("Conversation introuvable.") from e
        channel = self.search([("id", "=", channel_id)])
        if not channel:
            raise MissingError("Conversation introuvable.")
        channel._check_object_access()
        return channel

    def _check_object_access(self):
        for channel in self:
            if channel.kind == "object":
                channel._readable_object(channel.res_model, channel.res_id)

    def _object_record(self):
        """Fiche lisible de la conversation (sous l'identité du compte), ou None."""
        self.ensure_one()
        if self.kind != "object":
            return None
        try:
            return self._readable_object(self.res_model, self.res_id)
        except (AccessError, MissingError, UserError):
            return None

    # ─── Membres ─────────────────────────────────────────────────────────

    def _check_owner(self, action):
        self.ensure_one()
        if self.kind != "group":
            raise UserError("Seule une conversation de groupe se gère : une conversation à deux ou d'une fiche n'a pas "
                            "de responsable.")
        if self.sudo().owner_id != self.env.user:
            raise AccessError(f"Seul le responsable du groupe {action}.")

    def add_members(self, user_ids):
        """Le responsable du groupe ajoute des collègues ; ils lisent l'historique, sans non-lus d'avant."""
        self._check_owner("y ajoute des membres")
        me = self.env.user
        channel = self.sudo()
        current = channel.member_ids.user_id
        new = self.env["res.users"]
        for user_id in dict.fromkeys(user_ids or []):
            user = self._colleague(user_id)
            if user not in current:
                new |= user
        if not new:
            raise UserError("Ces comptes sont déjà membres de la conversation.")
        if len(current) + len(new) > MAX_MEMBERS:
            raise UserError(f"Un groupe compte {MAX_MEMBERS} membres au plus.")
        last = channel._last_message_id()
        channel.member_ids = [Command.create({"user_id": u.id}) for u in new]
        channel._mark_read(new, last)
        channel._event(f"{me.name} a ajouté {', '.join(new.mapped('name'))}.")
        return self

    def remove_member(self, user_id):
        """Retrait d'un membre par le responsable du groupe, ou départ du compte lui-même (groupe ou fiche).
        Rend vrai si le compte courant a quitté la conversation."""
        self.ensure_one()
        me = self.env.user
        channel = self.sudo()
        try:
            user_id = int(user_id)
        except (TypeError, ValueError) as e:
            raise MissingError("Ce compte n'est pas membre de la conversation.") from e
        member = channel.member_ids.filtered(lambda m: m.user_id.id == user_id)
        if not member:
            raise MissingError("Ce compte n'est pas membre de la conversation.")
        if channel.kind == "direct":
            raise UserError("Une conversation à deux ne se quitte pas.")
        leaving = member.user_id == me
        if not leaving:
            self._check_owner("en retire des membres")
        user = member.user_id
        member.unlink()
        self.env["eguitra.chat.read"].sudo().search([("channel_id", "=", channel.id), ("user_id", "=", user.id)]).unlink()
        if channel.kind == "group":
            channel._event(f"{user.name} a quitté la conversation." if leaving else f"{me.name} a retiré {user.name}.")
            channel._transfer_owner(user)
        return leaving

    def _transfer_owner(self, gone):
        """Le responsable parti, le plus ancien membre encore admis le devient."""
        self.ensure_one()
        channel = self.sudo()
        if channel.kind != "group" or channel.owner_id != gone:
            return
        heir = channel.member_ids.sorted("id").user_id.filtered(chat_allowed)[:1]
        channel.owner_id = heir.id or False
        if heir:
            channel._event(f"{heir.name} est désormais responsable du groupe.", author=False)

    def rename(self, name):
        self._check_owner("le renomme")
        name = clean_line(name, MAX_NAME)
        if not name:
            raise UserError("Donnez un nom au groupe.")
        channel = self.sudo()
        if name != channel.name:
            channel.name = name
            channel._event(f"{self.env.user.name} a renommé le groupe « {name} ».")
        return self

    @api.model
    def remove_archived_user(self, user):
        """Administration : retire un compte archivé de toutes ses conversations, sans en lire aucune. Rend le
        nombre de conversations quittées."""
        if not self.env.user.has_group(ADMIN_GROUP):
            raise AccessError("Seule l'administration retire un compte archivé des conversations.")
        user = user.sudo().with_context(active_test=False)
        if user.active:
            raise UserError("Seul un compte archivé (désactivé) se retire des conversations : désactivez-le d'abord.")
        members = self.env["eguitra.chat.member"].sudo().search([("user_id", "=", user.id)])
        channels = members.channel_id
        members.unlink()
        self.env["eguitra.chat.read"].sudo().search([("user_id", "=", user.id)]).unlink()
        for channel in channels:
            if channel.kind in ("direct", "group"):
                channel._event(f"{user.name} ne participe plus à la conversation (compte archivé).", author=False)
            channel._transfer_owner(user)
        return len(channels)

    # ─── Messages ────────────────────────────────────────────────────────

    def _post_blocked(self):
        """Motif qui empêche d'écrire dans la conversation, ou None."""
        self.ensure_one()
        channel = self.sudo()
        me = self.env.user
        if channel.kind == "direct":
            other_id = next((int(i) for i in (channel.direct_key or "").split("-") if i and int(i) != me.id), None)
            other = self.env["res.users"].sudo().with_context(active_test=False).browse(other_id).exists()
            if not other or other not in channel.member_ids.user_id or not chat_allowed(other):
                return "Votre correspondant ne participe plus à la discussion : la conversation reste lisible."
            if not shares_company(me, other):
                return f"Vous ne partagez plus de société avec {other.name} : la conversation reste lisible."
        return None

    def post(self, body, reply_to_id=None, files=()):
        """Message du compte courant. files : [(nom, contenu)] reçus du navigateur, contrôlés ici."""
        self.ensure_one()
        me = self.env.user
        channel = self.sudo()
        blocked = self._post_blocked()
        if blocked:
            raise UserError(blocked)
        body = clean_text(body, MAX_BODY)
        files = list(files or [])
        if not body and not files:
            raise UserError("Écrivez un message ou joignez un fichier.")
        if len(files) > MAX_FILES:
            raise UserError(f"{MAX_FILES} pièces jointes au plus par message.")
        if sum(len(content) for _name, content in files) > MAX_FILES_TOTAL:
            raise UserError("Pièces jointes trop volumineuses : 50 Mo au plus par message.")
        checked = []
        for filename, content in files:
            if len(content) > MAX_FILE:
                raise UserError(f"{filename} : fichier trop volumineux (20 Mo au plus).")
            mimetype = detect_type(content)
            if not mimetype:
                raise UserError(f"{filename} : format refusé. Formats acceptés : {ACCEPTED}.")
            checked.append((checked_name(filename, mimetype), content, mimetype))
        Message = self.env["eguitra.chat.message"].sudo()
        reply = Message
        if reply_to_id:
            try:
                reply = Message.browse(int(reply_to_id)).exists()
            except (TypeError, ValueError):
                reply = Message
            if not reply or reply.channel_id != channel or reply.kind != "message":
                raise UserError("Le message auquel vous répondez n'est pas dans cette conversation.")
            if reply.withdrawn:
                raise UserError("Ce message a été retiré : on n'y répond plus.")
        message = Message.create({
            "channel_id": channel.id, "author_id": me.id, "kind": "message", "body": body or False,
            "reply_to_id": reply.id or False,
        })
        if checked:
            attachments = self.env["ir.attachment"].sudo().create([{
                "name": name, "datas": base64.b64encode(content), "mimetype": mimetype,
                "res_model": "eguitra.chat.message", "res_id": message.id,
            } for name, content, mimetype in checked])
            message.attachment_ids = [Command.set(attachments.ids)]
        channel._mark_read(me, message.id)
        return message.with_env(self.env)

    def _event(self, text, author=None):
        """Événement de la conversation (création, membres, nom) : affiché dans le fil, jamais compté en non-lus."""
        self.ensure_one()
        user = self.env.user if author is None else author
        return self.env["eguitra.chat.message"].sudo().create({
            "channel_id": self.id, "kind": "event", "body": text, "author_id": user.id if user else False,
        })

    def _last_message_id(self):
        self.ensure_one()
        self.env["eguitra.chat.message"].flush_model(["channel_id"])
        self.env.cr.execute("SELECT MAX(id) FROM eguitra_chat_message WHERE channel_id = %s", (self.id,))
        return self.env.cr.fetchone()[0] or 0

    @api.model
    def _last_message_ids(self, channel_ids):
        """Dernier message (événements compris) de chaque conversation : {conversation: message}."""
        if not channel_ids:
            return {}
        self.env["eguitra.chat.message"].flush_model(["channel_id"])
        self.env.cr.execute(
            "SELECT channel_id, MAX(id) FROM eguitra_chat_message WHERE channel_id IN %s GROUP BY channel_id",
            (tuple(channel_ids),),
        )
        return dict(self.env.cr.fetchall())

    # ─── Lecture ─────────────────────────────────────────────────────────

    def mark_read(self, message_id=None):
        """Le compte a lu la conversation jusqu'au message donné (au dernier, à défaut)."""
        self.ensure_one()
        last = self._last_message_id()
        try:
            target = min(int(message_id), last) if message_id else last
        except (TypeError, ValueError) as e:
            raise UserError("Message inconnu.") from e
        self._mark_read(self.env.user, target)
        return self

    def _mark_read(self, users, message_id):
        """Dernier message lu, qui ne recule jamais (requêtes parallèles comprises)."""
        self.ensure_one()
        if not message_id:
            return
        Read = self.env["eguitra.chat.read"]
        Read.flush_model()
        for user in users:
            self.env.cr.execute(
                """
                INSERT INTO eguitra_chat_read (channel_id, user_id, last_read_id, create_uid, create_date, write_uid,
                                               write_date)
                VALUES (%s, %s, %s, %s, now() at time zone 'UTC', %s, now() at time zone 'UTC')
                ON CONFLICT (channel_id, user_id) DO UPDATE
                SET last_read_id = GREATEST(eguitra_chat_read.last_read_id, EXCLUDED.last_read_id),
                    write_uid = EXCLUDED.write_uid, write_date = EXCLUDED.write_date
                """,
                (self.id, user.id, message_id, self.env.uid, self.env.uid),
            )
        Read.invalidate_model()

    @api.model
    def _unread_by_channel(self):
        """Messages non lus du compte courant par conversation : messages des autres membres, ni retirés ni
        événements, après son dernier message lu ; conversations de fiches qu'il lit encore."""
        me = self.env.user
        for name in ("eguitra.chat.member", "eguitra.chat.message", "eguitra.chat.read"):
            self.env[name].flush_model()
        self.env.cr.execute(
            """
            SELECT mb.channel_id, COUNT(m.id)
              FROM eguitra_chat_member mb
              JOIN eguitra_chat_message m ON m.channel_id = mb.channel_id
         LEFT JOIN eguitra_chat_read r ON r.channel_id = mb.channel_id AND r.user_id = mb.user_id
             WHERE mb.user_id = %s AND m.kind = 'message' AND m.withdrawn IS NOT TRUE
               AND m.author_id IS DISTINCT FROM %s AND m.id > COALESCE(r.last_read_id, 0)
          GROUP BY mb.channel_id
            """,
            (me.id, me.id),
        )
        counts = dict(self.env.cr.fetchall())
        if not counts:
            return {}
        channels = self.search([("id", "in", list(counts))])
        readable = channels.filtered(lambda c: c.kind != "object" or c._object_record() is not None)
        return {channel.id: counts[channel.id] for channel in readable}

    @api.model
    def unread_summary(self):
        self._check_chat_user()
        counts = self._unread_by_channel()
        return {"unread": sum(counts.values()), "conversations": len(counts)}

    @api.model
    def _my_last_read(self, channel):
        marker = self.env["eguitra.chat.read"].search([("channel_id", "=", channel.id), ("user_id", "=", self.env.uid)],
                                                      limit=1)
        return marker.last_read_id or 0


class ChatMember(models.Model):
    _name = "eguitra.chat.member"
    _description = "Membre d'une conversation de la discussion interne"
    _order = "id"

    channel_id = fields.Many2one("eguitra.chat.channel", "Conversation", required=True, index=True, ondelete="cascade")
    user_id = fields.Many2one("res.users", "Compte", required=True, index=True, ondelete="cascade")

    _member_unique = models.Constraint("unique(channel_id, user_id)", "Ce compte est déjà membre de la conversation.")


class ChatRead(models.Model):
    """Accusé de lecture : dernier message lu par un membre (non-lus). Hors piste d'audit, comme les autres
    accusés de lecture de la plateforme : il change à chaque lecture."""

    _name = "eguitra.chat.read"
    _description = "Lecture d'une conversation de la discussion interne"

    channel_id = fields.Many2one("eguitra.chat.channel", "Conversation", required=True, index=True, ondelete="cascade")
    user_id = fields.Many2one("res.users", "Compte", required=True, index=True, ondelete="cascade")
    last_read_id = fields.Integer("Dernier message lu", default=0)

    _read_unique = models.Constraint("unique(channel_id, user_id)", "Une seule lecture par membre et par conversation.")


class ChatMessage(models.Model):
    _name = "eguitra.chat.message"
    _description = "Message de la discussion interne"
    _order = "id"

    channel_id = fields.Many2one("eguitra.chat.channel", "Conversation", required=True, index=True, ondelete="cascade")
    author_id = fields.Many2one("res.users", "Auteur", index=True, ondelete="restrict")
    kind = fields.Selection(MESSAGE_KINDS, "Nature", required=True, default="message")
    body = fields.Text("Texte")
    date = fields.Datetime("Date", required=True, default=fields.Datetime.now, index=True)
    reply_to_id = fields.Many2one("eguitra.chat.message", "En réponse à", ondelete="set null")
    attachment_ids = fields.Many2many("ir.attachment", "eguitra_chat_message_attachment_rel", "message_id",
                                      "attachment_id", "Pièces jointes")
    withdrawn = fields.Boolean("Retiré", help="Retiré par son auteur : ni le texte ni les pièces ne sont plus servis ; "
                                              "le message reste en base comme trace.")
    withdrawn_date = fields.Datetime("Retiré le", index=True)

    def withdraw(self):
        """Retrait par son auteur : « message retiré » pour tous les membres, trace gardée."""
        self.ensure_one()
        message = self.sudo()
        if message.kind != "message" or message.author_id != self.env.user:
            raise AccessError("Seul l'auteur d'un message le retire.")
        if message.withdrawn:
            raise UserError("Ce message est déjà retiré.")
        message.write({"withdrawn": True, "withdrawn_date": fields.Datetime.now()})
        return self
