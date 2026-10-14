"""Représentations JSON communes au cabinet et au portail."""

import base64

from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError

MAX_FILE = 20 * 1024 * 1024
ALLOWED_MIMETYPES = (
    "application/pdf", "image/jpeg", "image/png", "application/zip",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel", "application/msword", "text/csv",
)


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


def store_upload(dossier, document_type_id=None, name=None, portal_visible=True):
    """Enregistre le fichier reçu comme nouvelle version de pièce ; contrôle taille et type."""
    upload = request.httprequest.files.get("file")
    if not upload:
        raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
    content = upload.read()
    if len(content) > MAX_FILE:
        raise ApiError(413, "too_large", "Fichier trop volumineux (20 Mo maximum).")
    if upload.mimetype not in ALLOWED_MIMETYPES:
        raise ApiError(415, "unsupported_type", "Formats acceptés : PDF, images, Word, Excel, CSV, ZIP.")
    doc_type = None
    if document_type_id:
        doc_type = request.env["axispro.document.type"].sudo().browse(int(document_type_id)).exists()
        if not doc_type or doc_type.policy_id != dossier.policy_id:
            raise ApiError(422, "business_rule", "Pièce standard inconnue pour ce dossier.")
    attachment = request.env["ir.attachment"].sudo().create({
        "name": upload.filename or "piece", "datas": base64.b64encode(content), "mimetype": upload.mimetype,
        "res_model": "axispro.dossier", "res_id": dossier.id,
    })
    return request.env["axispro.document"].sudo().create({
        "dossier_id": dossier.id, "document_type_id": doc_type.id if doc_type else False,
        "name": name or (doc_type.name if doc_type else upload.filename) or "Pièce",
        "attachment_id": attachment.id, "portal_visible": portal_visible, "uploaded_by": request.env.user.id,
    })


def download(doc):
    att = doc.attachment_id.sudo()
    return request.make_response(att.raw or b"", headers=[
        ("Content-Type", att.mimetype or "application/octet-stream"),
        ("Content-Disposition", f'attachment; filename="{att.name}"'),
        ("X-Content-Type-Options", "nosniff"),
    ])
