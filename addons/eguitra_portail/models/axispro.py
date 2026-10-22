"""Le dossier AxisPro prévient le portail : chaque événement utile au porteur (message, pièce validée ou
à reprendre, action, étape franchie, décision du comité, financement) devient une notification, et
chaque envoi du porteur prévient son consultant. Les messages peuvent porter des pièces jointes."""

from odoo import api, fields, models

from odoo.addons.eguitra_axispro.models.dossier import COMMITTEE_DECISIONS
from odoo.addons.eguitra_axispro.models.pilotage import FUNDING_STATES

CABINET_INBOX = "/axispro/portail/messages"


def _notify(env, users, kind, title, body, link, dossier):
    env["portail.notification"].sudo().notify(users, kind, title, body, link, dossier=dossier)


def _consultant(dossier):
    return dossier.consultant_id


class AxisproMessage(models.Model):
    _inherit = "axispro.message"

    document_ids = fields.Many2many("axispro.document", "axispro_message_document_rel", "message_id", "document_id",
                                    "Pièces jointes")

    @api.model_create_multi
    def create(self, vals_list):
        messages = super().create(vals_list)
        for message in messages.filtered(lambda m: not m.internal):
            dossier = message.dossier_id
            excerpt = " ".join((message.body or "").split())[:140]
            if message.author_id.share:
                _notify(self.env, _consultant(dossier), "message", f"Message de {message.author_id.name}", excerpt,
                        f"{CABINET_INBOX}?dossier={dossier.id}", dossier)
            else:
                _notify(self.env, dossier.portal_user_ids, "message", f"Nouveau message de {message.author_id.name}",
                        excerpt, f"/portail/messages?dossier={dossier.id}", dossier)
        return messages


class AxisproDocument(models.Model):
    _inherit = "axispro.document"

    @api.model_create_multi
    def create(self, vals_list):
        documents = super().create(vals_list)
        for doc in documents.filtered("portal_visible"):
            dossier = doc.dossier_id
            if doc.uploaded_by.share:
                _notify(self.env, _consultant(dossier), "document", f"Pièce déposée : {doc.name}",
                        f"{dossier.reference}, version {doc.version}", f"/axispro/dossiers/{dossier.id}", dossier)
            else:
                _notify(self.env, dossier.portal_user_ids, "document", f"Document du cabinet : {doc.name}",
                        "Disponible dans vos pièces.", f"/portail/pieces?dossier={dossier.id}", dossier)
        return documents

    def write(self, vals):
        before = {d.id: d.state for d in self} if "state" in vals else {}
        result = super().write(vals)
        for doc in self.filtered(lambda d: d.portal_visible and before.get(d.id) not in (None, d.state)):
            if doc.state == "validated":
                title, body = f"Pièce validée : {doc.name}", "Le cabinet a validé votre pièce."
            elif doc.state == "rejected":
                title, body = f"Pièce à reprendre : {doc.name}", doc.comment or "Votre consultant vous en précise la raison."
            else:
                continue
            _notify(self.env, doc.dossier_id.portal_user_ids, "document", title, body,
                    f"/portail/pieces?dossier={doc.dossier_id.id}", doc.dossier_id)
        return result


class AxisproAction(models.Model):
    _inherit = "axispro.action"

    def _for_porteur(self):
        return self.filtered(lambda a: a.portal_visible and a.assignee == "porteur")

    @api.model_create_multi
    def create(self, vals_list):
        actions = super().create(vals_list)
        for action in actions._for_porteur().filtered(lambda a: a.state in ("todo", "in_progress")):
            due = f"À faire avant le {action.due_date:%d/%m/%Y}." if action.due_date else ""
            _notify(self.env, action.dossier_id.portal_user_ids, "action", f"Nouvelle action : {action.name}", due,
                    f"/portail/actions?dossier={action.dossier_id.id}", action.dossier_id)
        return actions

    def write(self, vals):
        before = {a.id: a.state for a in self} if "state" in vals else {}
        result = super().write(vals)
        for action in self._for_porteur().filtered(lambda a: before.get(a.id) not in (None, a.state)):
            dossier = action.dossier_id
            if action.state == "done":
                _notify(self.env, dossier.portal_user_ids, "action", f"Action validée : {action.name}",
                        "Le cabinet a validé votre compte rendu.", f"/portail/actions?dossier={dossier.id}", dossier)
            elif action.state == "submitted":
                _notify(self.env, action.user_id | _consultant(dossier), "action", f"Compte rendu reçu : {action.name}",
                        " ".join((action.porteur_comment or "").split())[:140], f"/axispro/dossiers/{dossier.id}", dossier)
        return result


class AxisproDossier(models.Model):
    _inherit = "axispro.dossier"

    meeting_ids = fields.One2many("portail.meeting", "dossier_id", "Rendez-vous")
    feedback_ids = fields.One2many("portail.feedback", "dossier_id", "Avis du porteur")

    def write(self, vals):
        watched = {"current_gate_id", "decision"} & set(vals)
        before = {d.id: (d.current_gate_id, d.decision) for d in self} if watched else {}
        result = super().write(vals)
        for dossier in self.filtered(lambda d: d.id in before and d.portal_user_ids):
            old_gate, old_decision = before[dossier.id]
            link = f"/portail/projet?dossier={dossier.id}"
            # Étape initiale posée à la création : pas une avancée du dossier.
            if dossier.current_gate_id and old_gate and dossier.current_gate_id != old_gate:
                _notify(self.env, dossier.portal_user_ids, "gate", f"Nouvelle étape : {dossier.current_gate_id.name}",
                        f"Votre dossier {dossier.reference} avance.", link, dossier)
            if dossier.decision and dossier.decision != old_decision:
                _notify(self.env, dossier.portal_user_ids, "decision",
                        f"Décision du comité : {dict(COMMITTEE_DECISIONS)[dossier.decision]}",
                        "Votre consultant vous en détaille les conditions.", link, dossier)
        return result


class AxisproFunding(models.Model):
    _inherit = "axispro.funding"

    @api.model_create_multi
    def create(self, vals_list):
        fundings = super().create(vals_list)
        for funding in fundings:
            dossier = funding.dossier_id
            _notify(self.env, dossier.portal_user_ids, "funding", f"Piste de financement : {funding.funder_id.name}",
                    dict(FUNDING_STATES)[funding.state], f"/portail/projet?dossier={dossier.id}", dossier)
        return fundings

    def write(self, vals):
        before = {f.id: f.state for f in self} if "state" in vals else {}
        result = super().write(vals)
        for funding in self.filtered(lambda f: before.get(f.id) not in (None, f.state)):
            dossier = funding.dossier_id
            _notify(self.env, dossier.portal_user_ids, "funding", f"Financement {funding.funder_id.name}",
                    dict(FUNDING_STATES)[funding.state], f"/portail/projet?dossier={dossier.id}", dossier)
        return result
