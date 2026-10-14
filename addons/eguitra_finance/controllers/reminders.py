"""Relances des clients : file d'envoi, lettres, envoi par courriel ou courrier."""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json

from .common import FIN_READ, FIN_WRITE, companies, ref, today


def _reminder(reminder_id):
    # Recherche soumise aux règles d'accès : une relance d'une autre société est introuvable.
    reminder = request.env["eguitra.reminder"].search([("id", "=", reminder_id)], limit=1)
    if not reminder:
        raise ApiError(404, "not_found", "Relance introuvable.")
    return reminder


def _row(r):
    return {
        "id": r.id, "partner": ref(r.partner_id), "email": r.partner_id.email or None, "date": r.date,
        "level": r.level, "level_label": dict(r._fields["level"].selection)[r.level], "days_overdue": r.days_overdue,
        "amount_due": r.amount_due, "invoices": len(r.invoice_ids), "state": r.state, "channel": r.channel or None,
        "sent_at": r.sent_at, "sent_by": r.sent_by.name or None,
    }


class EguitraFinanceReminders(http.Controller):
    @api_route("/finance/reminders", profiles=FIN_READ)
    def reminders(self, **kw):
        domain = [("company_id", "in", companies(kw).ids)]
        if kw.get("state") in ("to_send", "sent", "cancelled"):
            domain.append(("state", "=", kw["state"]))
        rows = request.env["eguitra.reminder"].search(domain, limit=300)
        return {"items": [_row(r) for r in rows],
                "mail_server": bool(request.env["ir.mail_server"].sudo().search_count([]))}

    @api_route("/finance/reminders/generate", methods=("POST",), profiles=FIN_WRITE)
    def generate(self, **kw):
        created = request.env["eguitra.reminder"].generate(companies(kw), today())
        return {"created": len(created), "items": [_row(r) for r in created]}

    @api_route("/finance/reminders/<int:reminder_id>", profiles=FIN_READ)
    def letter(self, reminder_id, **_kw):
        reminder = _reminder(reminder_id)
        return dict(_row(reminder), letter=reminder.letter())

    @api_route("/finance/reminders/<int:reminder_id>/send", methods=("POST",), profiles=FIN_WRITE)
    def send(self, reminder_id, **_kw):
        channel = read_json().get("channel")
        if channel not in ("email", "letter"):
            raise ApiError(400, "invalid_parameter", "Mode d'envoi inconnu (email ou letter).")
        reminder = _reminder(reminder_id)
        reminder.action_send(channel)
        return _row(reminder)

    @api_route("/finance/reminders/<int:reminder_id>/cancel", methods=("POST",), profiles=FIN_WRITE)
    def cancel(self, reminder_id, **_kw):
        reminder = _reminder(reminder_id)
        if reminder.state == "sent":
            raise ApiError(422, "business_rule", "Une relance envoyée ne s'annule pas.")
        reminder.state = "cancelled"
        return _row(reminder)
