"""Représentations JSON communes au cabinet et au portail."""

import base64
import io
import os
import re
import zipfile

from odoo import fields
from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError
from odoo.addons.eguitra_api.files import ACCEPTED, EXTENSIONS, checked_name, detect_type

from ..models.dossier import HYPOTHESES
from ..models.sc01 import VERIFICATIONS
from ..scoring import METHOD_SC01, category_folder, category_letter, piece_name

MAX_FILE = 20 * 1024 * 1024
# Formats des pièces de la méthode SC-01 V2.0 (RG-06-02), lus dans le contenu ; CSV et TXT, sans signature, se
# reconnaissent à leur extension et à un contenu de texte.
PIECE_FORMATS = ["PDF", "JPG", "PNG", "WEBP", "CSV", "TXT", "DOCX", "XLSX", "PPTX"]
PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
TEXT_TYPES = {".csv": "text/csv", ".txt": "text/plain"}
OTHER_LETTER = "Z"
OTHER_FOLDER = "Autres_pieces"
# Espace d'un dossier côté porteur : large pour une data room de 42 pièces et leurs versions,
# borné pour qu'un compte porteur ne puisse pas remplir le disque du serveur.
MAX_DOSSIER_FILES = 400
MAX_DOSSIER_BYTES = 1024 * 1024 * 1024


def dossier_summary(d, result=None):
    """Synthèse d'un dossier ; `result` : évaluation déjà calculée (dossier.evaluate()), pour ne la
    calculer qu'une fois par requête. consultant_id : responsable du dossier ; can_assign :
    l'utilisateur confie les compartiments à un autre consultant (sinon il ne peut que s'attribuer
    un compartiment libre)."""
    r = result or d.evaluate()
    score = d.scoring(r)
    docs = d.documents_status(r)
    due = [x for x in docs if x["due"] and x["required"]]
    next_gate = score["next_gate"]
    return {
        "id": d.id, "reference": d.reference, "name": d.name, "state": d.state, "method": d.policy_id.method,
        "promoter": {"id": d.promoter_id.id, "name": d.promoter_id.name},
        "consultant": d.consultant_id.name or None, "consultant_id": d.consultant_id.id or None,
        "can_assign": d.can_assign(), "sector": d.sector or None, "location": d.location or None,
        "investment": d.investment, "financing_need": d.financing_need,
        "currency": {"id": d.currency_id.id, "name": d.currency_id.name, "symbol": d.currency_id.symbol},
        "current_gate": {"id": d.current_gate_id.id, "code": d.current_gate_id.code, "name": d.current_gate_id.name}
        if d.current_gate_id else None,
        "gates": [{"id": g.id, "code": g.code, "name": g.name, "sequence": g.sequence} for g in d.policy_id.gate_ids],
        "score": score["global_score"], "readiness": score["readiness"], "apd": score["apd"],
        "bankability": score["bankability"], "completeness": score["completeness"],
        "dataroom_completeness": score["dataroom_completeness"], "classification": score["classification"],
        "recommendation": score["recommendation"],
        # Recommandation de la méthode même pendant la saisie (« à compléter » côté plateforme tant que
        # pending_in_scope critères des gates atteints restent à évaluer) : score provisoire en liste.
        "method_recommendation": score["method_recommendation"], "pending_in_scope": score["pending_in_scope"],
        "next_gate": {"code": next_gate["code"], "name": next_gate["name"], "decision": next_gate["decision"]}
        if next_gate else None,
        "knockouts": len(score["knockouts"]), "decision": d.decision or None,
        "progress": {"assessed": score["assessed"], "criteria": score["criteria"]},
        "documents": {"due": len(due), "received": len([x for x in due if x["state"] in ("received", "validated")]),
                      "available": len([x for x in docs if x["available"]]), "total": len(docs)},
        "policy_version": d.policy_id.version,
        "revision": d.revision, "locked": bool(d.locked_review_id),
        "financial": _financial_brief(r.get("financial")),
        "risks": d.risk_summary(),
        "actions": d.action_summary(),
        # Relances du porteur (models/relance.py) : à relancer, échéances dépassées, dernière relance.
        "followup": d.followup(result=r),
    }


def _financial_brief(indicators):
    if not indicators:
        return None
    return {k: indicators[k] for k in ("npv", "irr_project", "irr_equity", "dscr_min", "payback", "equity_share",
                                       "cash_min")}


def dossier_detail(d, result=None):
    r = result or d.evaluate()
    data = dossier_summary(d, r)
    locked = d.locked_review_id
    data.update({
        "capacity": d.capacity or None, "date_start": d.date_start, "date_evaluation": d.date_evaluation,
        "description": d.description or None, "hypotheses": d.hypotheses or None,
        "decision_inputs": {
            "dscr_manual": d.dscr_manual or None, "irr_manual": d.irr_manual or None,
            **{key: d[key] or None for key in HYPOTHESES},
        },
        "scoring": d.scoring(r), "gaps": d.gaps(5, r),
        "portal_users": [{"id": u.id, "name": u.name, "login": u.login} for u in d.portal_user_ids],
        "contact": {"name": d.contact_name or None, "email": d.contact_email or None, "phone": d.contact_phone or None},
        # Méthode SC-01 V2.0 : recevabilité (EC-05), DSCR saisi (EC-08), barre des 7 étapes (6.12).
        "admissibility": d.admissibility(), "dscr": d.dscr_manual or None, "steps": d.steps(r),
        "reviews": [review_row(x) for x in d.review_ids],
        "locked_review": {"id": locked.id, "date": locked.date, "decision": locked.decision,
                          "fingerprint": locked.fingerprint, "locked_by": locked.locked_by.name or None}
        if locked else None,
    })
    return data


def review_row(r):
    snapshot = r.snapshot or {}
    return {
        "id": r.id, "date": r.date, "gate": r.gate_id.code or None, "members": r.members or None,
        "instance": r.instance or None, "motive": r.motive or None,
        "recommendation": r.recommendation, "decision": r.decision, "conditions": r.conditions or None,
        "minutes": r.minutes or None, "state": r.state, "locked_by": r.locked_by.name or None,
        "locked_at": r.locked_at, "policy_version": r.policy_version, "revision": r.revision or None,
        "fingerprint": r.fingerprint or None,
        "score": snapshot.get("global_score"), "readiness": snapshot.get("readiness"), "apd": snapshot.get("apd"),
        "bankability": snapshot.get("bankability"), "classification": snapshot.get("classification"),
    }


def document_row(doc, portal=False):
    """Pièce déposée ; pour le portail, sans les critères de la grille qu'elle justifie."""
    # La pièce se lit sous les droits de l'utilisateur ; seuls le type et la taille de son fichier se
    # lisent ensuite en sudo, comme au téléchargement : une pièce jointe non rattachée au dossier
    # (lisible de son seul créateur) ne fait pas échouer toute la data room.
    attachment = doc.attachment_id.sudo()
    row = {
        "id": doc.id, "name": doc.name, "version": doc.version, "state": doc.state, "comment": doc.comment or None,
        "document_type_id": doc.document_type_id.id or None, "uploaded_by": doc.uploaded_by.name,
        "uploaded_at": doc.uploaded_at, "mimetype": attachment.mimetype, "size": attachment.file_size,
        "portal_visible": doc.portal_visible, "validity_date": doc.validity_date, "after_lock": doc.after_lock,
        "criteria": [{"id": e.criterion_id.id, "code": e.criterion_id.code} for e in doc.evaluation_ids],
    }
    if portal:
        row.pop("criteria")
    return row


def message_row(m):
    """Message d'un dossier, pour le cabinet. Les pièces jointes (champ ajouté par le portail des
    porteurs, eguitra_portail, quand il est installé) sont des pièces de la data room du dossier."""
    documents = m.document_ids if "document_ids" in m._fields else m.env["axispro.document"]
    return {"id": m.id, "author": m.author_id.name, "from_promoter": m.author_id.share, "body": m.body,
            "date": m.date, "internal": m.internal,
            "attachments": [{"id": d.id, "name": d.name} for d in documents]}


def store_upload(dossier, document_type_id=None, name=None, portal_visible=True, quota=False, validity_date=None):
    """Enregistre le fichier reçu comme nouvelle version de pièce ; contrôle taille, format réel et,
    pour un dépôt du porteur (quota), l'espace occupé par le dossier."""
    upload = request.httprequest.files.get("file")
    if not upload:
        raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
    if dossier.sudo().policy_id.method == METHOD_SC01:
        return store_piece(dossier, upload, doc_type=_document_type(dossier, document_type_id),
                           portal_visible=portal_visible, quota=quota, validity_date=validity_date)
    content = upload.read(MAX_FILE + 1)
    if len(content) > MAX_FILE:
        raise ApiError(413, "too_large", "Fichier trop volumineux (20 Mo maximum).")
    mimetype = detect_type(content)
    if not mimetype:
        raise ApiError(415, "unsupported_type", f"Formats acceptés : {ACCEPTED}. Enregistrez le document dans l'un de ces formats.")
    if quota:
        _check_quota(dossier, len(content))
    doc_type = _document_type(dossier, document_type_id)
    filename = checked_name(upload.filename, mimetype)
    attachment = request.env["ir.attachment"].sudo().create({
        "name": filename, "datas": base64.b64encode(content), "mimetype": mimetype,
        "res_model": "axispro.dossier", "res_id": dossier.id,
    })
    return request.env["axispro.document"].sudo().create({
        "dossier_id": dossier.id, "document_type_id": doc_type.id if doc_type else False,
        # Nom libre du déposant : une ligne, sans caractère de contrôle, 200 caractères au plus.
        "name": " ".join(re.sub(r"[\x00-\x1f\x7f]", " ", name or "").split())[:200]
        or (doc_type.name if doc_type else filename) or "Pièce",
        "attachment_id": attachment.id, "portal_visible": portal_visible, "uploaded_by": request.env.user.id,
        "validity_date": validity_date or False,
    })


def _check_quota(dossier, size):
    stored = dossier.sudo().document_ids
    if len(stored) >= MAX_DOSSIER_FILES or sum(stored.attachment_id.mapped("file_size")) + size > MAX_DOSSIER_BYTES:
        raise ApiError(422, "quota_exceeded", "L'espace de ce dossier est plein (400 pièces ou 1 Go) : contactez votre consultant.")


def _document_type(dossier, document_type_id):
    if not document_type_id:
        return None
    try:
        type_id = int(document_type_id)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", "Pièce standard inconnue.") from e
    doc_type = request.env["axispro.document.type"].sudo().browse(type_id).exists()
    if not doc_type or doc_type.policy_id != dossier.sudo().policy_id:
        raise ApiError(422, "business_rule", "Pièce standard inconnue pour ce dossier.")
    return doc_type


def detect_piece(content, filename):
    """Format reconnu d'une pièce (type, extension), ou None. Les documents à macros restent refusés : detect_type
    et, pour une présentation, le même contrôle du contenu de l'archive."""
    mimetype = detect_type(content)
    if mimetype:
        return mimetype, EXTENSIONS[mimetype]
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp", ".webp"
    if content.startswith(b"PK\x03\x04"):
        try:
            names = zipfile.ZipFile(io.BytesIO(content)).namelist()
        except (zipfile.BadZipFile, ValueError, EOFError, OSError, NotImplementedError):
            return None
        if "ppt/presentation.xml" in names and not any(n.lower().endswith("vbaproject.bin") for n in names):
            return PPTX, ".pptx"
        return None
    extension = os.path.splitext(filename)[1].lower()
    if extension in TEXT_TYPES and content and b"\0" not in content:
        for encoding in ("utf-8", "cp1252"):
            try:
                content.decode(encoding)
                return TEXT_TYPES[extension], extension
            except UnicodeDecodeError:
                continue
    return None


def store_piece(dossier, upload, letter=None, doc_type=None, portal_visible=True, quota=False, validity_date=None,
                source="team", deposit_link=None):
    """Pièce de la méthode SC-01 V2.0 : taille et format réel (RG-06-02, messages de l'annexe D), nom normalisé
    (RG-06-01), état « À vérifier ». Le rattachement à un critère ne change jamais son statut (RG-06-03)."""
    sudo = dossier.sudo()
    filename = os.path.basename((upload.filename or "piece").replace("\\", "/")).strip() or "piece"
    limit = sudo.policy_id.max_file_mb or 20
    content = upload.read(limit * 1024 * 1024 + 1)
    if len(content) > limit * 1024 * 1024:
        raise ApiError(413, "too_large", f"{filename} : plus de {limit} Mo, compressez le fichier")
    detected = detect_piece(content, filename)
    if not detected:
        raise ApiError(415, "unsupported_type", f"{filename} : format non accepté, convertissez-le en PDF")
    if quota:
        _check_quota(dossier, len(content))
    mimetype, extension = detected
    if doc_type:
        letter = category_letter(doc_type.category) or letter
    letter = letter or OTHER_LETTER
    rank = sudo.next_piece_rank(letter)
    name = piece_name(letter, rank, os.path.splitext(filename)[0] + extension, fields.Date.context_today(sudo))
    attachment = request.env["ir.attachment"].sudo().create({
        "name": name, "datas": base64.b64encode(content), "mimetype": mimetype,
        "res_model": "axispro.dossier", "res_id": dossier.id,
    })
    return request.env["axispro.document"].sudo().create({
        "dossier_id": dossier.id, "document_type_id": doc_type.id if doc_type else False, "name": name,
        "original_name": filename[:200], "category_letter": letter, "category_rank": rank,
        "attachment_id": attachment.id, "portal_visible": portal_visible, "uploaded_by": request.env.user.id,
        "validity_date": validity_date or False, "verification": "to_check", "source": source,
        "deposit_link_id": deposit_link.id if deposit_link else False,
    })


def piece_categories(policy):
    """Les catégories de la data room (annexe B), tirées des pièces standard de la grille, de A à J."""
    rows = {}
    for t in policy.document_type_ids.sorted(lambda t: (t.category or "", t.id)):
        letter = category_letter(t.category)
        if letter:
            row = rows.setdefault(letter, {"letter": letter, "name": re.sub(r"^\s*[A-Za-z][.\s:/-]+", "", t.category),
                                           "folder": category_folder(t.category), "expected": []})
            row["expected"].append({"id": t.id, "name": t.name, "required": t.required})
    return [rows[key] for key in sorted(rows)]


def criterion_ranks(policy):
    """Rang des critères de la grille, de 0 à 110 (ordre de l'annexe A)."""
    return {c.id: i for i, c in enumerate(policy.criterion_ids.sorted("sequence"))}


def piece_row(doc, ranks):
    """Pièce de l'étape 2 (EC-06) ; `ranks` : criterion_ranks de la grille, lu une fois par requête."""
    attachment = doc.attachment_id.sudo()
    evaluation = doc.evaluation_ids[:1]
    criterion = evaluation.criterion_id
    return {
        "id": doc.id, "name": doc.name, "original_name": doc.original_name or attachment.name,
        "category_letter": doc.category_letter or None, "category_rank": doc.category_rank or None,
        "size": attachment.file_size, "mimetype": attachment.mimetype, "verification": doc.verification,
        "verification_label": dict(VERIFICATIONS)[doc.verification], "source": doc.source or "team",
        "uploaded_at": doc.uploaded_at,
        "uploaded_by": "Promoteur (lien de dépôt)" if doc.deposit_link_id else doc.uploaded_by.name,
        "criterion": {"evaluation_id": evaluation.id, "criterion_id": criterion.id, "rank": ranks.get(criterion.id),
                      "code": criterion.code, "name": criterion.name} if evaluation else None,
        "download": f"/axispro/documents/{doc.id}/download",
    }


def download(doc):
    att = doc.attachment_id.sudo()
    return request.make_response(att.raw or b"", headers=[
        ("Content-Type", att.mimetype or "application/octet-stream"),
        ("Content-Disposition", content_disposition(att.name or "piece")),
        ("X-Content-Type-Options", "nosniff"),
    ])
