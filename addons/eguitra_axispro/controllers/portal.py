"""API du portail des porteurs de projets : leur dossier, leurs pièces, leurs échanges avec le cabinet.

Le porteur n'accède qu'aux dossiers dont il est utilisateur du portail (règles d'accès du noyau
et contrôle explicite ici) ; il ne voit ni le détail du scoring interne, ni les notes internes.
"""

from datetime import timedelta

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require

from .common import document_row, download, message_row, store_upload
from .rapports import pieces_pdf

PORTEUR = ("porteur",)
# Ce que le porteur voit d'une pièce attendue : jamais les critères de la grille qu'elle justifie.
PORTAL_DOCUMENT_KEYS = ("document_type_id", "code", "name", "category", "required", "due", "gate", "guidance",
                        "state", "version")
MAX_DAILY_MESSAGES = 50


def _own(dossier_id):
    dossier = request.env["axispro.dossier"].sudo().browse(dossier_id).exists()
    if not dossier or request.env.user not in dossier.portal_user_ids:
        raise ApiError(404, "not_found", "Dossier introuvable.")
    return dossier


def _portal_view(dossier):
    result = dossier.evaluate()
    docs = [{k: d[k] for k in PORTAL_DOCUMENT_KEYS} for d in dossier.documents_status(result)]
    due = [d for d in docs if d["due"] and d["required"]]
    return {
        "id": dossier.id, "reference": dossier.reference, "name": dossier.name, "state": dossier.state,
        "consultant": dossier.consultant_id.name or None,
        "current_gate": {"code": dossier.current_gate_id.code, "name": dossier.current_gate_id.name}
        if dossier.current_gate_id else None,
        "gates": [{"code": g.code, "name": g.name, "reached": g.sequence <= (dossier.current_gate_id.sequence or 0)}
                  for g in dossier.policy_id.gate_ids],
        "documents": docs,
        "documents_progress": {"due": len(due), "received": len([d for d in due if d["state"] in ("received", "validated")])},
        "actions": [{"name": g["name"], "action": g["action"]} for g in dossier.gaps(5, result)],
        "tasks": [_task_row(a) for a in _tasks(dossier)],
        "decision": dossier.decision or None,
    }


def _tasks(dossier):
    """Actions confiées au porteur et rendues visibles par le cabinet."""
    return dossier.action_ids.filtered(
        lambda a: a.portal_visible and a.assignee == "porteur" and a.state != "cancelled"
    ).sorted(lambda a: (a.state == "done", a.due_date or fields.Date.today(), a.id))


def _task_row(action):
    return {"id": action.id, "name": action.name, "description": action.description or None,
            "due_date": action.due_date, "state": action.state, "porteur_comment": action.porteur_comment or None,
            "overdue": action.is_overdue()}


class EguitraPortal(http.Controller):
    @api_route("/portail/dossiers", profiles=PORTEUR)
    def dossiers(self, **_kw):
        dossiers = request.env["axispro.dossier"].sudo().search([("portal_user_ids", "in", request.env.user.id)])
        return [_portal_view(d) for d in dossiers]

    @api_route("/portail/dossiers/<int:dossier_id>", profiles=PORTEUR)
    def dossier(self, dossier_id, **_kw):
        return _portal_view(_own(dossier_id))

    @api_route("/portail/dossiers/<int:dossier_id>/pieces.pdf", profiles=PORTEUR)
    def pieces(self, dossier_id, **_kw):
        """Liste imprimable des pièces attendues du porteur et des compléments demandés."""
        return pieces_pdf(_own(dossier_id))

    @api_route("/portail/dossiers/<int:dossier_id>/documents", profiles=PORTEUR)
    def documents(self, dossier_id, **_kw):
        dossier = _own(dossier_id)
        files = dossier.document_ids.filtered("portal_visible")
        return [document_row(d, portal=True) for d in files]

    @api_route("/portail/dossiers/<int:dossier_id>/documents", methods=("POST",), profiles=PORTEUR)
    def upload(self, dossier_id, **_kw):
        dossier = _own(dossier_id)
        if dossier.state == "closed":
            raise ApiError(422, "business_rule", "Ce dossier est clos.")
        form = request.httprequest.form
        return document_row(store_upload(dossier, form.get("document_type_id"), form.get("name"), quota=True),
                            portal=True)

    @api_route("/portail/documents/<int:document_id>/download", profiles=PORTEUR)
    def download_document(self, document_id, **_kw):
        doc = request.env["axispro.document"].sudo().browse(document_id).exists()
        if not doc or not doc.portal_visible:
            raise ApiError(404, "not_found", "Pièce introuvable.")
        _own(doc.dossier_id.id)
        return download(doc)

    @api_route("/portail/actions/<int:action_id>/report", methods=("POST",), profiles=PORTEUR)
    def report_action(self, action_id, **_kw):
        """Le porteur déclare une action réalisée ; le cabinet la valide ensuite."""
        action = request.env["axispro.action"].sudo().browse(action_id).exists()
        if not action or not action.portal_visible or action.assignee != "porteur":
            raise ApiError(404, "not_found", "Action introuvable.")
        dossier = _own(action.dossier_id.id)
        if dossier.state == "closed" or action.state not in ("todo", "in_progress", "submitted"):
            raise ApiError(422, "business_rule", "Cette action n'attend plus de compte rendu.")
        (comment,) = require(read_json(), "comment")
        action.write({"state": "submitted", "porteur_comment": str(comment)[:5000]})
        return _task_row(action)

    @api_route("/portail/dossiers/<int:dossier_id>/messages", profiles=PORTEUR)
    def messages(self, dossier_id, **_kw):
        dossier = _own(dossier_id)
        return [message_row(m) for m in dossier.message_ids.filtered(lambda m: not m.internal)]

    @api_route("/portail/dossiers/<int:dossier_id>/messages", methods=("POST",), profiles=PORTEUR)
    def post_message(self, dossier_id, **_kw):
        dossier = _own(dossier_id)
        (body,) = require(read_json(), "body")
        Message = request.env["axispro.message"].sudo()
        recent = Message.search_count([
            ("dossier_id", "=", dossier.id), ("author_id", "=", request.env.user.id),
            ("date", ">=", fields.Datetime.now() - timedelta(days=1)),
        ])
        if recent >= MAX_DAILY_MESSAGES:
            raise ApiError(429, "too_many_requests", "Trop de messages en 24 heures : appelez votre consultant.")
        message = Message.create(
            {"dossier_id": dossier.id, "body": str(body)[:5000], "author_id": request.env.user.id, "internal": False}
        )
        return message_row(message)
