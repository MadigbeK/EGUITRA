"""Corbeille de validation et paramétrage des circuits."""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require

INTERNAL = ("admin", "direction", "finance", "exploitation", "chantiers", "immobilier", "cabinet")
# Profils qui voient toutes les demandes de leurs sociétés ; les autres ne voient que les leurs et
# celles dont une étape revient à l'un de leurs profils.
FULL_VIEW = ("admin", "direction", "finance")


def _visible(user):
    profiles = user._eguitra_profiles()
    domain = [("company_id", "in", user.company_ids.ids)]
    if not set(profiles) & set(FULL_VIEW):
        domain += ["|", ("requested_by", "=", user.id), ("step_ids.profile", "in", profiles)]
    return domain


def _req(request_id):
    rec = request.env["eguitra.approval.request"].sudo().search(
        [("id", "=", request_id)] + _visible(request.env.user), limit=1
    )
    if not rec:
        raise ApiError(404, "not_found", "Demande introuvable.")
    return rec


def _row(rec, detail=False):
    profiles = dict(rec._fields["pending_profile"].selection)
    data = {
        "id": rec.id,
        "name": rec.name,
        "document": rec.document,
        "res_model": rec.res_model,
        "res_id": rec.res_id,
        "amount": rec.amount,
        "partner": rec.partner_id.name or None,
        "company": rec.company_id.name,
        "requested_by": rec.requested_by.name,
        "requested_at": rec.requested_at,
        "state": rec.state,
        "pending_with": profiles.get(rec.pending_profile) if rec.pending_profile else None,
        "can_decide": rec._can_decide(request.env.user),
    }
    if detail:
        data["steps"] = [
            {"sequence": s.sequence, "label": s.label, "profile": profiles.get(s.profile), "state": s.state,
             "decided_by": s.decided_by.name or None, "decided_at": s.decided_at, "comment": s.comment or None}
            for s in rec.step_ids
        ]
        record = rec._record()
        if rec.res_model == "account.move" and record:
            data["document_detail"] = {
                "name": record.name if record.name != "/" else None, "ref": record.ref or None,
                "date": record.invoice_date or record.date, "state": record.state,
                "lines": [{"name": l.name, "account": l.account_id.code, "amount": l.price_subtotal or l.debit}
                          for l in (record.invoice_line_ids or record.line_ids.filtered("debit"))],
            }
        elif rec.res_model == "account.payment" and record:
            data["document_detail"] = {"name": record.name, "date": record.date, "state": record.state,
                                       "journal": record.journal_id.name, "memo": record.memo or None}
    return data


class EguitraApprovals(http.Controller):
    @api_route("/approvals/inbox", profiles=INTERNAL)
    def inbox(self, **_kw):
        """Demandes que l'utilisateur peut trancher maintenant."""
        user = request.env.user
        profiles = user._eguitra_profiles()
        requests = request.env["eguitra.approval.request"].sudo().search([
            ("state", "=", "pending"), ("company_id", "in", user.company_ids.ids),
            ("pending_profile", "in", profiles), ("requested_by", "!=", user.id),
        ], order="requested_at asc")
        return [_row(r) for r in requests]

    @api_route("/approvals/requests", profiles=INTERNAL)
    def requests(self, **kw):
        domain = _visible(request.env.user)
        if kw.get("state"):
            domain.append(("state", "in", kw["state"].split(",")))
        if kw.get("mine") == "1":
            domain.append(("requested_by", "=", request.env.user.id))
        recs = request.env["eguitra.approval.request"].sudo().search(domain, limit=int_arg(kw, "limit", 100, 1, 500))
        return [_row(r) for r in recs]

    @api_route("/approvals/<int:request_id>", profiles=INTERNAL)
    def get(self, request_id, **_kw):
        return _row(_req(request_id), detail=True)

    @api_route("/approvals/<int:request_id>/approve", methods=("POST",), profiles=INTERNAL)
    def approve(self, request_id, **_kw):
        rec = _req(request_id).with_user(request.env.user)
        rec.action_approve(read_json().get("comment"))
        return _row(rec, detail=True)

    @api_route("/approvals/<int:request_id>/reject", methods=("POST",), profiles=INTERNAL)
    def reject(self, request_id, **_kw):
        (comment,) = require(read_json(), "comment")
        rec = _req(request_id).with_user(request.env.user)
        rec.action_reject(comment)
        return _row(rec, detail=True)

    # ─── Paramétrage des circuits ─────────────────────────────────────────

    @api_route("/approvals/rules", profiles=("admin", "direction", "finance"))
    def rules(self, **_kw):
        Rule = request.env["eguitra.approval.rule"].sudo().with_context(active_test=False)
        docs = dict(Rule._fields["document"].selection)
        profiles = dict(Rule._fields["approver_profile"].selection)
        return [
            {"id": r.id, "name": r.name, "document": r.document, "document_label": docs[r.document],
             "sequence": r.sequence, "min_amount": r.min_amount, "max_amount": r.max_amount or None,
             "account_prefix": r.account_prefix or None, "approver_profile": r.approver_profile,
             "approver_label": profiles[r.approver_profile], "active": r.active}
            for r in Rule.search([("company_id", "=", request.env.company.id)])
        ]

    def _rule_values(self, data):
        values = {}
        for key in ("name", "document", "approver_profile", "account_prefix"):
            if key in data:
                values[key] = data[key] or False
        for key in ("sequence",):
            if key in data:
                values[key] = int(data[key])
        for key in ("min_amount", "max_amount"):
            if key in data:
                values[key] = float(data[key] or 0)
        if "active" in data:
            values["active"] = bool(data["active"])
        return values

    @api_route("/approvals/rules", methods=("POST",), profiles=("admin",))
    def create_rule(self, **_kw):
        data = read_json()
        require(data, "name", "document", "approver_profile")
        rule = request.env["eguitra.approval.rule"].sudo().create(
            dict(self._rule_values(data), company_id=request.env.company.id)
        )
        return {"id": rule.id}

    @api_route("/approvals/rules/<int:rule_id>", methods=("PATCH",), profiles=("admin",))
    def update_rule(self, rule_id, **_kw):
        rule = request.env["eguitra.approval.rule"].sudo().with_context(active_test=False).browse(rule_id).exists()
        if not rule or rule.company_id != request.env.company:
            raise ApiError(404, "not_found", "Règle introuvable.")
        rule.write(self._rule_values(read_json()))
        return {"status": "ok"}
