"""Outils communs aux routes de l'API Finance."""

from datetime import date

from odoo import fields
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError

FIN_READ = ("admin", "direction", "finance")
FIN_WRITE = ("admin", "finance")


def companies(kw):
    """Sociétés couvertes : la société de travail, ou tout le groupe si scope=group."""
    env = request.env
    if kw.get("scope") == "group":
        return env.user.company_ids.sorted("id")
    return env.company


def parse_date(kw, name, default=None):
    value = kw.get(name)
    if value in (None, ""):
        return default
    try:
        return fields.Date.to_date(value)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"Date invalide : {name}.") from e


def today():
    return fields.Date.context_today(request.env.user)


def as_float(value, name):
    try:
        return float(value)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"Nombre invalide : {name}.") from e


def ref(record):
    return {"id": record.id, "name": record.display_name} if record else None


def account_ref(account):
    if not account:
        return None
    return {"id": account.id, "code": account.code, "name": account.name}


def move_summary(move):
    return {
        "id": move.id,
        "name": move.name if move.name != "/" else None,
        "move_type": move.move_type,
        "state": move.state,
        "partner": ref(move.partner_id),
        "journal": ref(move.journal_id),
        "date": move.date,
        "invoice_date": move.invoice_date,
        "invoice_date_due": move.invoice_date_due,
        "ref": move.ref or None,
        "currency": move.currency_id.name,
        "amount_untaxed": move.amount_untaxed,
        "amount_tax": move.amount_tax,
        "amount_total": move.amount_total,
        "amount_residual": move.amount_residual,
        "payment_state": move.payment_state,
        "company": ref(move.company_id),
    }


def move_detail(move):
    data = move_summary(move)
    lines = move.invoice_line_ids if move.is_invoice(include_receipts=True) else move.line_ids
    data.update({
        "narration": move.narration or None,
        "lines": [
            {
                "id": line.id,
                "name": line.name,
                "account": account_ref(line.account_id),
                "partner": ref(line.partner_id),
                "quantity": line.quantity,
                "price_unit": line.price_unit,
                "taxes": [{"id": t.id, "name": t.name, "amount": t.amount} for t in line.tax_ids],
                "price_subtotal": line.price_subtotal,
                "price_total": line.price_total,
                "debit": line.debit,
                "credit": line.credit,
                "analytic_distribution": line.analytic_distribution or {},
                "display_type": line.display_type,
            }
            for line in lines
        ],
        "attachments": [
            {"id": a.id, "name": a.name, "mimetype": a.mimetype, "size": a.file_size}
            for a in request.env["ir.attachment"].search([("res_model", "=", "account.move"), ("res_id", "=", move.id)])
        ],
        "payments": move.invoice_payments_widget or None,
        "can_post": move.state == "draft",
        "can_pay": move.state == "posted" and move.payment_state in ("not_paid", "partial") and move.is_invoice(),
    })
    return data


def iso(value):
    return value.isoformat() if isinstance(value, date) else value
