"""Signature manuscrite scannée des approbateurs (models/res_users.py) : chacun dépose la sienne ; l'administration
dépose ou retire celle d'un approbateur. Elle n'est imprimée qu'en face d'une approbation donnée par ce compte."""

import base64

from odoo import http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route

from ..models.res_users import MAX_SIGNATURE
from .common import SIGNATURE, SIGNATURE_ADMIN, user_ref

APPROVER_PROFILES = {"admin", "direction", "finance"}


def signature_row(user):
    user = user.sudo()
    return {
        "user": user_ref(user), "has_signature": bool(user.eguitra_signature),
        "mimetype": user.eguitra_signature_mimetype or None, "updated_at": user.eguitra_signature_at or None,
        "updated_by": user_ref(user.eguitra_signature_by), "function": user.partner_id.function or None,
    }


def _content():
    upload = request.httprequest.files.get("file")
    if not upload:
        raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
    content = upload.read(MAX_SIGNATURE + 1)
    if len(content) > MAX_SIGNATURE:
        raise ApiError(413, "too_large", "Image de signature trop lourde : 500 Ko au plus.")
    return content


def _image(user):
    user = user.sudo()
    if not user.eguitra_signature:
        raise ApiError(404, "not_found", "Aucune signature déposée.")
    return request.make_response(base64.b64decode(user.eguitra_signature), headers=[
        ("Content-Type", user.eguitra_signature_mimetype or "image/png"),
        ("Content-Disposition", content_disposition("signature" + (
            ".jpg" if user.eguitra_signature_mimetype == "image/jpeg" else ".png"))),
        ("X-Content-Type-Options", "nosniff"), ("Cache-Control", "no-store"),
    ])


def _approver(user_id):
    """Compte approbateur (administration, direction, finance) ouvert à la société de travail."""
    user = request.env["res.users"].sudo().browse(user_id).exists()
    if not user or request.env.company not in user.company_ids or not set(user._eguitra_profiles()) & APPROVER_PROFILES:
        raise ApiError(404, "not_found", "Approbateur introuvable dans la société de travail.")
    return user


class EguitraCommerceSignatures(http.Controller):
    @api_route("/commerce/signature", profiles=SIGNATURE)
    def my_signature(self, **_kw):
        return signature_row(request.env.user)

    @api_route("/commerce/signature/image", profiles=SIGNATURE)
    def my_signature_image(self, **_kw):
        return _image(request.env.user)

    @api_route("/commerce/signature", methods=("POST",), profiles=SIGNATURE)
    def upload_my_signature(self, **_kw):
        """Signature de l'utilisateur : PNG ou JPEG, 500 Ko au plus."""
        user = request.env.user
        user._eguitra_set_signature(_content(), user)
        return signature_row(user)

    @api_route("/commerce/signature", methods=("DELETE",), profiles=SIGNATURE)
    def delete_my_signature(self, **_kw):
        request.env.user._eguitra_clear_signature()
        return signature_row(request.env.user)

    # ─── Administration : signatures des approbateurs ─────────────────────

    @api_route("/commerce/signatures", profiles=SIGNATURE_ADMIN)
    def signatures(self, **_kw):
        users = request.env["res.users"].sudo().search([("company_ids", "in", request.env.company.id),
                                                        ("share", "=", False)], order="name")
        return [signature_row(u) for u in users if set(u._eguitra_profiles()) & APPROVER_PROFILES]

    @api_route("/commerce/signatures/<int:user_id>/image", profiles=SIGNATURE_ADMIN)
    def signature_image(self, user_id, **_kw):
        return _image(_approver(user_id))

    @api_route("/commerce/signatures/<int:user_id>", methods=("POST",), profiles=SIGNATURE_ADMIN)
    def upload_signature(self, user_id, **_kw):
        user = _approver(user_id)
        user._eguitra_set_signature(_content(), request.env.user)
        return signature_row(user)

    @api_route("/commerce/signatures/<int:user_id>", methods=("DELETE",), profiles=SIGNATURE_ADMIN)
    def delete_signature(self, user_id, **_kw):
        user = _approver(user_id)
        user._eguitra_clear_signature()
        return signature_row(user)
