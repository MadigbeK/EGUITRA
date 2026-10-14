"""Représentations JSON communes au cabinet et au portail."""

import base64

from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError
from odoo.addons.eguitra_api.files import ACCEPTED, checked_name, detect_type

MAX_FILE = 20 * 1024 * 1024
# Espace d'un dossier côté porteur : large pour une data room de 42 pièces et leurs versions,
# borné pour qu'un compte porteur ne puisse pas remplir le disque du serveur.
MAX_DOSSIER_FILES = 400
MAX_DOSSIER_BYTES = 1024 * 1024 * 1024


def dossier_summary(d):
    score = d.scoring()
    docs = d.documents_status()
    due = [x for x in docs if x["due"] and x["required"]]
    return {
        "id": d.id, "reference": d.reference, "name": d.name, "state": d.state,
        "promoter": {"id": d.promoter_id.id, "name": d.promoter_id.name},
        "consultant": d.consultant_id.name or None, "sector": d.sector or None, "location": d.location or None,
        "investment": d.investment, "financing_need": d.financing_need,
        "current_gate": {"id": d.current_gate_id.id, "code": d.current_gate_id.code, "name": d.current_gate_id.name}
        if d.current_gate_id else None,
        "gates": [{"id": g.id, "code": g.code, "name": g.name, "sequence": g.sequence} for g in d.policy_id.gate_ids],
        "score": score["global_score"], "recommendation": score["recommendation"],
        "knockouts": len(score["knockouts"]), "decision": d.decision or None,
        "progress": {"assessed": score["assessed"], "criteria": score["criteria"]},
        "documents": {"due": len(due), "received": len([x for x in due if x["state"] in ("received", "validated")])},
        "policy_version": d.policy_id.version,
    }


def dossier_detail(d):
    data = dossier_summary(d)
    data.update({
        "capacity": d.capacity or None, "date_start": d.date_start, "description": d.description or None,
        "hypotheses": d.hypotheses or None, "scoring": d.scoring(), "gaps": d.gaps(5),
        "portal_users": [{"id": u.id, "name": u.name, "login": u.login} for u in d.portal_user_ids],
        "reviews": [review_row(r) for r in d.review_ids],
    })
    return data


def review_row(r):
    return {
        "id": r.id, "date": r.date, "gate": r.gate_id.code or None, "members": r.members or None,
        "recommendation": r.recommendation, "decision": r.decision, "conditions": r.conditions or None,
        "minutes": r.minutes or None, "state": r.state, "locked_by": r.locked_by.name or None,
        "locked_at": r.locked_at, "policy_version": r.policy_version,
        "score": (r.snapshot or {}).get("global_score"),
    }


def document_row(doc):
    return {
        "id": doc.id, "name": doc.name, "version": doc.version, "state": doc.state, "comment": doc.comment or None,
        "document_type_id": doc.document_type_id.id or None, "uploaded_by": doc.uploaded_by.name,
        "uploaded_at": doc.uploaded_at, "mimetype": doc.attachment_id.mimetype, "size": doc.attachment_id.file_size,
        "portal_visible": doc.portal_visible,
    }


def message_row(m):
    return {"id": m.id, "author": m.author_id.name, "from_promoter": m.author_id.share, "body": m.body,
            "date": m.date, "internal": m.internal}


def store_upload(dossier, document_type_id=None, name=None, portal_visible=True, quota=False):
    """Enregistre le fichier reçu comme nouvelle version de pièce ; contrôle taille, format réel et,
    pour un dépôt du porteur (quota), l'espace occupé par le dossier."""
    upload = request.httprequest.files.get("file")
    if not upload:
        raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
    content = upload.read(MAX_FILE + 1)
    if len(content) > MAX_FILE:
        raise ApiError(413, "too_large", "Fichier trop volumineux (20 Mo maximum).")
    mimetype = detect_type(content)
    if not mimetype:
        raise ApiError(415, "unsupported_type", f"Formats acceptés : {ACCEPTED}. Enregistrez le document dans l'un de ces formats.")
    if quota:
        stored = dossier.sudo().document_ids
        if len(stored) >= MAX_DOSSIER_FILES or sum(stored.attachment_id.mapped("file_size")) + len(content) > MAX_DOSSIER_BYTES:
            raise ApiError(422, "quota_exceeded", "L'espace de ce dossier est plein (400 pièces ou 1 Go) : contactez votre consultant.")
    doc_type = None
    if document_type_id:
        doc_type = request.env["axispro.document.type"].sudo().browse(int(document_type_id)).exists()
        if not doc_type or doc_type.policy_id != dossier.policy_id:
            raise ApiError(422, "business_rule", "Pièce standard inconnue pour ce dossier.")
    filename = checked_name(upload.filename, mimetype)
    attachment = request.env["ir.attachment"].sudo().create({
        "name": filename, "datas": base64.b64encode(content), "mimetype": mimetype,
        "res_model": "axispro.dossier", "res_id": dossier.id,
    })
    return request.env["axispro.document"].sudo().create({
        "dossier_id": dossier.id, "document_type_id": doc_type.id if doc_type else False,
        "name": name or (doc_type.name if doc_type else filename) or "Pièce",
        "attachment_id": attachment.id, "portal_visible": portal_visible, "uploaded_by": request.env.user.id,
    })


def download(doc):
    att = doc.attachment_id.sudo()
    return request.make_response(att.raw or b"", headers=[
        ("Content-Type", att.mimetype or "application/octet-stream"),
        ("Content-Disposition", content_disposition(att.name or "piece")),
        ("X-Content-Type-Options", "nosniff"),
    ])
