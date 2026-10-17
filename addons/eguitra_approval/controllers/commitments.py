"""Engagements de dépense : saisie, devis, soumission au circuit, consommation par les pièces d'achat."""

import base64

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require
from odoo.addons.eguitra_api.files import ACCEPTED, checked_name, detect_type

from ..models.commitment import STATES

INTERNAL = ("admin", "direction", "finance", "exploitation", "chantiers", "immobilier", "cabinet")
MAX_QUOTE = 20 * 1024 * 1024


def _commitment(commitment_id):
    rec = request.env["eguitra.commitment"].browse(commitment_id).exists()
    if not rec:
        raise ApiError(404, "not_found", "Engagement introuvable.")
    return rec


def commitment_row(c, detail=False):
    states = dict(STATES)
    request_ = c._eguitra_last_request()
    step = request_.current_step_id if request_ else None
    profiles = dict(request_._fields["pending_profile"].selection) if request_ else {}
    data = {
        "id": c.id, "name": c.name, "object": c.object, "date": c.date, "date_expected": c.date_expected,
        "partner": {"id": c.partner_id.id, "name": c.partner_id.name},
        "account": {"id": c.account_id.id, "code": c.account_id.code, "name": c.account_id.name} if c.account_id else None,
        "analytic_distribution": c.analytic_distribution or {},
        "amount": c.amount, "consumed": c.consumed, "remaining": c.remaining, "currency": c.currency_id.name,
        "state": c.state, "state_label": states[c.state], "requested_by": c.requested_by.name,
        "quote": {"id": c.quote_id.id, "name": c.quote_id.name} if c.quote_id else None,
        "approval": {"request_id": request_.id, "state": request_.state,
                     "pending_with": profiles.get(step.profile) if step and request_.state == "pending" else None}
        if request_ else None,
        "company": c.company_id.name,
    }
    if detail:
        data["note"] = c.note or None
        data["moves"] = [{"id": m.id, "name": m.name if m.name != "/" else None, "date": m.invoice_date or m.date,
                          "state": m.state, "amount_untaxed": abs(m.amount_untaxed_signed), "ref": m.ref or None}
                         for m in c.move_ids]
        data["tolerance_pct"] = c.tolerance_pct()
    return data


class EguitraCommitments(http.Controller):
    @api_route("/finance/commitments", profiles=INTERNAL)
    def commitments(self, **kw):
        domain = []
        if kw.get("state"):
            domain.append(("state", "in", kw["state"].split(",")))
        if kw.get("partner_id"):
            domain.append(("partner_id", "=", int_arg(kw, "partner_id")))
        if kw.get("open") == "1":
            domain.append(("state", "=", "approved"))
        recs = request.env["eguitra.commitment"].search(domain, limit=int_arg(kw, "limit", 300, 1, 2000))
        return [commitment_row(c) for c in recs]

    @api_route("/finance/commitments/<int:commitment_id>", profiles=INTERNAL)
    def commitment(self, commitment_id, **_kw):
        return commitment_row(_commitment(commitment_id), detail=True)

    def _values(self, data):
        values = {k: data[k] or False for k in ("object", "note") if k in data}
        if "partner_id" in data:
            values["partner_id"] = int(data["partner_id"])
        if "account_id" in data:
            values["account_id"] = int(data["account_id"]) if data["account_id"] else False
        if "amount" in data:
            try:
                values["amount"] = float(data["amount"])
            except (TypeError, ValueError) as e:
                raise ApiError(400, "invalid_parameter", "Montant invalide.") from e
        for key in ("date", "date_expected"):
            if key in data:
                values[key] = data[key] or False
        if "analytic_distribution" in data:
            values["analytic_distribution"] = data["analytic_distribution"] or False
        return values

    @api_route("/finance/commitments", methods=("POST",), profiles=INTERNAL)
    def create(self, **_kw):
        data = read_json()
        require(data, "partner_id", "object", "amount")
        rec = request.env["eguitra.commitment"].create(self._values(data))
        if data.get("submit"):
            rec.action_submit()
        return commitment_row(rec, detail=True)

    @api_route("/finance/commitments/<int:commitment_id>", methods=("PATCH",), profiles=INTERNAL)
    def update(self, commitment_id, **_kw):
        rec = _commitment(commitment_id)
        rec.write(self._values(read_json()))
        return commitment_row(rec, detail=True)

    @api_route("/finance/commitments/<int:commitment_id>/<string:action>", methods=("POST",), profiles=INTERNAL)
    def act(self, commitment_id, action, **_kw):
        rec = _commitment(commitment_id)
        actions = {"submit": rec.action_submit, "close": rec.action_close, "cancel": rec.action_cancel}
        if action not in actions:
            raise ApiError(404, "not_found", "Action inconnue.")
        if action == "close" and "finance" not in request.env.user._eguitra_profiles() \
                and "direction" not in request.env.user._eguitra_profiles():
            raise ApiError(403, "forbidden", "Seules la finance et la direction soldent un engagement.")
        actions[action]()
        return commitment_row(rec, detail=True)

    @api_route("/finance/commitments/<int:commitment_id>/quote", methods=("POST",), profiles=INTERNAL)
    def quote(self, commitment_id, **_kw):
        """Devis joint à l'engagement (format contrôlé sur le contenu)."""
        rec = _commitment(commitment_id)
        upload = request.httprequest.files.get("file")
        if not upload:
            raise ApiError(400, "missing_fields", "Fichier manquant.", fields=["file"])
        content = upload.read(MAX_QUOTE + 1)
        if len(content) > MAX_QUOTE:
            raise ApiError(413, "too_large", "Fichier trop volumineux (20 Mo maximum).")
        mimetype = detect_type(content)
        if not mimetype:
            raise ApiError(415, "unsupported_type", f"Formats acceptés : {ACCEPTED}.")
        attachment = request.env["ir.attachment"].sudo().create({
            "name": checked_name(upload.filename, mimetype, "devis"), "datas": base64.b64encode(content),
            "mimetype": mimetype, "res_model": rec._name, "res_id": rec.id,
        })
        rec.sudo().quote_id = attachment
        return commitment_row(rec, detail=True)

    @api_route("/finance/commitments/<int:commitment_id>/quote", profiles=INTERNAL)
    def download_quote(self, commitment_id, **_kw):
        rec = _commitment(commitment_id)
        att = rec.quote_id.sudo()
        if not att:
            raise ApiError(404, "not_found", "Aucun devis joint.")
        return request.make_response(att.raw or b"", headers=[
            ("Content-Type", att.mimetype or "application/octet-stream"),
            ("Content-Disposition", http.content_disposition(att.name or "devis")),
            ("X-Content-Type-Options", "nosniff"),
        ])

    @api_route("/finance/commitments/for-bill", profiles=INTERNAL)
    def for_bill(self, **kw):
        """Engagements en cours d'un fournisseur, proposés à la saisie d'une pièce d'achat."""
        partner = request.env["res.partner"].browse(int_arg(kw, "partner_id")).exists()
        if not partner:
            return []
        recs = request.env["eguitra.commitment"].search([
            ("state", "=", "approved"), ("partner_id.commercial_partner_id", "=", partner.commercial_partner_id.id),
        ])
        return [commitment_row(c) for c in recs]
