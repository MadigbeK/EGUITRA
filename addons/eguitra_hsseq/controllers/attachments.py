"""API des pièces jointes d'HSSEQ (contrat §11) : dépôt multipart d'une photo ou d'un PDF, avant la fiche
(rattachée ensuite par attachment_ids, au seul déposant) ou sur une fiche existante ; formats reconnus au
contenu (eguitra_api/files.py : JPEG, PNG, PDF), 8 Mo au plus ; téléchargement aux droits de la fiche ;
suppression par l'auteur ou hsseq tant que la fiche n'est pas close. Idempotent par client_uuid."""

import base64
import re

from odoo import http
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError
from odoo.addons.eguitra_api.files import checked_name, detect_type

from ..models.common import ATTACHMENT_OBJECTS
from . import actions, checks, events, waivers
from .common import (
    client_uuid,
    existing_by_uuid,
    forbidden,
    get,
    hsseq_route,
    internal_only,
    is_hsseq,
    profiles,
    scope_level,
    site_allowed,
)

MAX_FILE = 8 * 1024 * 1024
MAX_PER_RECORD = 30
FORMATS = {"image/jpeg", "image/png", "application/pdf"}
# Dépôt sans fiche (avant le formulaire) : comptes des profils de l'application.
UPLOADERS = {"admin", "direction", "hsseq", "exploitation", "conducteur"}
MODELS = {"event": "eguitra.hsseq.event", "action": "eguitra.hsseq.action", "check": "eguitra.hsseq.check",
          "nonconformity": "eguitra.hsseq.nonconformity", "waiver": "eguitra.hsseq.waiver"}


def closed(object_key, record):
    return {"event": record.status == "closed" if object_key == "event" else False,
            "action": record.status in ("closed", "cancelled") if object_key == "action" else False,
            "nonconformity": record.status != "open" if object_key == "nonconformity" else False,
            "waiver": record.status not in ("pending_hsseq", "active") if object_key == "waiver" else False,
            }.get(object_key, False)


def can_read(object_key, record):
    return {"event": events.can_read, "action": actions.can_read, "check": checks.can_read,
            "nonconformity": lambda nc: checks.can_read(nc.check_id), "waiver": waivers.can_read}[object_key](record)


def can_attach(object_key, record):
    """Ajouter une pièce à la fiche : son auteur ou responsable, le chef de parc du site, ou hsseq."""
    if closed(object_key, record):
        return False
    if is_hsseq():
        return True
    user = request.env.user
    yard = scope_level() == "site"
    if object_key == "event":
        return record.reported_by == user or (yard and site_allowed(record.site_id))
    if object_key == "action":
        return record.owner_id == user
    if object_key == "check":
        return record.author_id == user or (yard and site_allowed(record.site_id))
    if object_key == "nonconformity":
        return record.check_id.author_id == user or (yard and site_allowed(record.site_id))
    if object_key == "waiver":
        return record.requested_by == user
    return False


def read_upload():
    upload = request.httprequest.files.get("file")
    if not upload or not upload.filename:
        raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
    content = upload.read(MAX_FILE + 1)
    if len(content) > MAX_FILE:
        raise ApiError(413, "too_large", "Fichier trop volumineux (8 Mo au plus).")
    mimetype = detect_type(content)
    if mimetype not in FORMATS:
        raise ApiError(415, "unsupported_type", "Formats acceptés : JPEG, PNG ou PDF.")
    name = " ".join(re.sub(r"[\x00-\x1f\x7f]", " ", upload.filename).split())[:200]
    return content, mimetype, checked_name(name, mimetype, "photo")


class EguitraHsseqAttachments(http.Controller):
    @hsseq_route("/hsseq/attachments", methods=("POST",), profiles=None)
    def upload(self, **_kw):
        internal_only()
        form = request.httprequest.form
        uuid = client_uuid(form)
        existing = existing_by_uuid("eguitra.hsseq.attachment", uuid)
        if existing:
            return existing._row()
        object_key = form.get("model") or form.get("object") or None
        record = None
        if object_key:
            if object_key not in ATTACHMENT_OBJECTS:
                raise ApiError(400, "invalid_parameter", "Fiche inconnue.", fields=["model"])
            record = get(MODELS[object_key], form.get("id") or form.get("object_id"), "Fiche")
            if not can_read(object_key, record) or not can_attach(object_key, record):
                raise forbidden("Pièce jointe non autorisée sur cette fiche.")
            if request.env["eguitra.hsseq.attachment"].sudo().search_count(
                    [("object", "=", object_key), ("res_id", "=", record.id)]) >= MAX_PER_RECORD:
                raise ApiError(422, "business_rule", f"{MAX_PER_RECORD} pièces au plus par fiche.")
        elif not profiles() & UPLOADERS:
            raise forbidden("Dépôt sans fiche réservé aux profils de NIMOVA · HSSEQ.")
        content, mimetype, name = read_upload()
        role = "evidence" if object_key == "action" else "photo"
        if object_key == "nonconformity" and record.status == "open" and form.get("role") == "lift":
            role = "lift"
        file = request.env["ir.attachment"].sudo().create({
            "name": name, "datas": base64.b64encode(content), "mimetype": mimetype,
            "res_model": "eguitra.hsseq.attachment", "res_id": 0})
        attachment = request.env["eguitra.hsseq.attachment"].sudo().create({
            "name": name, "attachment_id": file.id, "role": role, "caption": (form.get("caption") or "")[:300] or False,
            "client_uuid": uuid, "author_id": request.env.uid,
            "company_id": record.company_id.id if record else request.env.company.id})
        file.res_id = attachment.id
        if record:
            attachment._link(object_key, record, role)
        return attachment._row()

    def _attachment(self, attachment_id):
        attachment = request.env["eguitra.hsseq.attachment"].sudo().browse(attachment_id).exists()
        if not attachment:
            raise ApiError(404, "not_found", "Pièce jointe introuvable.")
        record = attachment._record()
        if record is None:
            if attachment.author_id != request.env.user:
                raise ApiError(404, "not_found", "Pièce jointe introuvable.")
            return attachment, None
        if not record or (record.company_id and record.company_id not in request.env.companies) \
                or not can_read(attachment.object, record):
            raise ApiError(404, "not_found", "Pièce jointe introuvable.")
        return attachment, record

    @hsseq_route("/hsseq/attachments/<int:attachment_id>/download", profiles=None)
    def download(self, attachment_id, **_kw):
        internal_only()
        attachment, _record = self._attachment(attachment_id)
        file = attachment.attachment_id.sudo()
        return request.make_response(file.raw or b"", headers=[
            ("Content-Type", file.mimetype or "application/octet-stream"),
            ("Content-Disposition", content_disposition(file.name or "piece")),
            ("X-Content-Type-Options", "nosniff"),
        ])

    @hsseq_route("/hsseq/attachments/<int:attachment_id>", methods=("DELETE",), profiles=None)
    def delete(self, attachment_id, **_kw):
        internal_only()
        attachment, record = self._attachment(attachment_id)
        if not (attachment.author_id == request.env.user or is_hsseq()):
            raise forbidden("Seuls son auteur et le Responsable HSSEQ retirent une pièce.")
        if record is not None and closed(attachment.object, record):
            raise ApiError(422, "invalid_transition", "Fiche close : la pièce ne se retire plus.")
        if attachment.role == "lift" or (attachment.object == "action" and record.status == "to_verify"):
            raise ApiError(422, "invalid_transition", "Pièce probante d'une levée ou d'une réalisation : conservée.")
        if record is not None:
            request.env["eguitra.hsseq.journal"]._log(attachment.object, record, "attachment_removed", note=attachment.name)
        attachment.attachment_id.unlink()
        return {"status": "ok"}
