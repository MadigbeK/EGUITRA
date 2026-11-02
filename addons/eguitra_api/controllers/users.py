"""Photo d'un compte (avatar) : GET /users/<id>/avatar?size=128|512.

Affichée par la discussion, l'agenda et le bandeau du compte connecté, à la place des initiales quand le
compte a une vraie photo (../avatars.py). Ouverte à tout compte interne connecté, salarié sans profil
compris ; le compte visé doit être interne et partager au moins une société avec le demandeur, sinon 404
(rien ne dit s'il existe). Un compte du portail ou de l'espace client est refusé (403). Rien d'autre que
l'image n'est servi.

Comme la photo du salarié (eguitra_rh, controllers/photo.py) : ETag (version et taille) et cache privé
revalidé à chaque affichage (« private, no-cache ») ; un droit retiré vaut dès l'affichage suivant, et un
poste partagé ne ressert pas la photo à un autre compte sans demander au noyau.
"""

import base64

from odoo import http
from odoo.http import request

from ..avatars import AVATAR_SIZES, avatar_versions
from ..files import detect_image
from .framework import ApiError, api_route, sudo_env


class EguitraUsersController(http.Controller):
    @api_route("/users/<int:user_id>/avatar")
    def avatar(self, user_id, **kw):
        field = AVATAR_SIZES.get(str(kw.get("size") or "128"))
        if not field:
            raise ApiError(400, "invalid_parameter", "Taille de photo : 128 ou 512.")
        me = request.env.user
        if me.share:
            raise ApiError(403, "forbidden", "Accès réservé aux comptes internes.")
        target = sudo_env()["res.users"].with_context(active_test=False).browse(user_id)
        version = avatar_versions(target, me).get(user_id)
        data = target.partner_id[field] if version else None
        if not data:
            raise ApiError(404, "not_found", "Aucune photo pour ce compte.")
        etag = f'"{version}-{field}"'
        headers = [("ETag", etag), ("Cache-Control", "private, no-cache"), ("X-Content-Type-Options", "nosniff")]
        wanted = request.httprequest.headers.get("If-None-Match") or ""
        if etag in {tag.strip().removeprefix("W/") for tag in wanted.split(",")}:
            return request.make_response(b"", headers=headers, status=304)
        content = base64.b64decode(data)
        mimetype = detect_image(content)
        if not mimetype:  # jamais l'avatar dessiné (SVG) ni un contenu inattendu
            raise ApiError(404, "not_found", "Aucune photo pour ce compte.")
        return request.make_response(content, headers=headers + [
            ("Content-Type", mimetype),
            ("Content-Disposition", "inline; filename=photo"),
        ])
