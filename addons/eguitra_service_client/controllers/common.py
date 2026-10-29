"""Outils communs des routes du service client (/service-client/…, /espace-client/…).

Profils (règle du projet, organisation.APPS) :
- agents du service client et administration (AGENTS) : tout, dans la société de travail ;
- direction (READ_ALL) : lecture de tous les dossiers et tableau de bord ; elle traite ceux qui lui sont
  assignés ;
- métiers (finance, exploitation, BTP, immobilier, cabinet) : les dossiers qui leur sont assignés (à eux ou à
  leur équipe), réponse, note et passage d'état, sans affecter, fusionner ni régler ;
- réglages (heures, délais, catégories, équipes) : administration seule ; réponses types : agents ;
- client (espace client) : ses dossiers, par controllers/client.py.

Les dossiers sont lus sous l'identité du compte (règles d'accès : société, assignation), puis traités par les
méthodes du modèle, qui contrôlent elles-mêmes ce qu'elles permettent.
"""

import base64

from odoo.http import content_disposition, request

from odoo.addons.eguitra_api.controllers.framework import ApiError
from odoo.addons.eguitra_api.files import ACCEPTED, checked_name, detect_type

from ..models.common import MAX_FILE, MAX_FILES_PER_MESSAGE


def company():
    return request.env.company


def profiles():
    return set(request.env.user._eguitra_profiles())


def as_int(value, name="identifiant"):
    if isinstance(value, bool):
        raise ApiError(400, "invalid_parameter", f"Identifiant invalide : {name}.")
    try:
        return int(value)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"Identifiant invalide : {name}.") from e


def ticket_of(ticket_id):
    """Dossier de la société de travail que le compte lit (règles d'accès) ; 404 sinon."""
    ticket = request.env["eguitra.sc.ticket"].search([("id", "=", as_int(ticket_id)),
                                                      ("company_id", "=", company().id)], limit=1)
    if not ticket:
        raise ApiError(404, "not_found", "Dossier introuvable dans la société de travail.")
    return ticket


def writable(ticket):
    """Le compte traite-t-il ce dossier ? Agent ou administration, ou responsable (ou équipe) du dossier."""
    user = request.env.user
    t = ticket.sudo()
    if profiles() & {"admin", "service_client"}:
        return True
    if user == t.user_id or user in t.team_id.member_ids:
        return True
    raise ApiError(403, "forbidden", "Ce dossier ne vous est pas assigné : vous le lisez seulement.")


def partner_of(value):
    """Tiers de la société de travail (ou partagé) ; 422 sinon."""
    partner = request.env["res.partner"].sudo().browse(as_int(value, "partner_id")).exists()
    if not partner or (partner.company_id and partner.company_id != company()):
        raise ApiError(422, "business_rule", "Client inconnu dans la société.")
    return partner


def uploads(owner_model, owner_id, field="files"):
    """Fichiers reçus (multipart) : nombre, taille et format reconnu au contenu ; ir.attachment créés."""
    files = request.httprequest.files.getlist(field) or request.httprequest.files.getlist("file")
    if len(files) > MAX_FILES_PER_MESSAGE:
        raise ApiError(413, "too_many_files", f"{MAX_FILES_PER_MESSAGE} pièces jointes au plus par message.")
    ids = []
    for upload in files:
        content = upload.read(MAX_FILE + 1)
        if len(content) > MAX_FILE:
            raise ApiError(413, "too_large", "Fichier trop volumineux (10 Mo maximum).")
        mimetype = detect_type(content)
        if not mimetype:
            raise ApiError(415, "unsupported_type", f"Formats acceptés : {ACCEPTED}.")
        attachment = request.env["ir.attachment"].sudo().create({
            "name": checked_name(upload.filename, mimetype), "datas": base64.b64encode(content), "mimetype": mimetype,
            "res_model": owner_model, "res_id": owner_id,
        })
        ids.append(attachment.id)
    return ids


def download(attachment):
    att = attachment.sudo()
    return request.make_response(att.raw or b"", headers=[
        ("Content-Type", att.mimetype or "application/octet-stream"),
        ("Content-Disposition", content_disposition(att.name or "piece")),
        ("X-Content-Type-Options", "nosniff"),
        ("Cache-Control", "no-store"),
    ])


def form_or_json():
    """Corps d'une requête : formulaire (avec fichiers) ou JSON."""
    from odoo.addons.eguitra_api.controllers.framework import read_json

    if request.httprequest.mimetype == "multipart/form-data":
        return dict(request.httprequest.form)
    return read_json()
