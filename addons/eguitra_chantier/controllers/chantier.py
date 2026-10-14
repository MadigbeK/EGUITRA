"""API Chantiers : marchés, situations d'avancement, retenues, coûts et marge par chantier."""

from odoo import http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, read_json, require
from odoo.addons.eguitra_finance.controllers.common import as_float, parse_date, today

READ = ("admin", "direction", "finance", "chantiers")
WRITE = ("admin", "finance", "chantiers")
INVOICE = ("admin", "finance")


def _chantier(chantier_id):
    chantier = request.env["eguitra.chantier"].browse(chantier_id).exists()
    if not chantier:
        raise ApiError(404, "not_found", "Chantier introuvable.")
    return chantier


def _costs(chantier):
    """Charges imputées sur l'axe du chantier (achats, caisse, salaires…)."""
    request.env.flush_all()
    request.env.cr.execute(
        """SELECT COALESCE(SUM(-aal.amount), 0) FROM account_analytic_line aal
             JOIN account_account aa ON aa.id = aal.general_account_id
            WHERE aal.%s = %%s AND COALESCE(aa.code_store->>(aal.company_id::text), '') LIKE '6%%'"""
        % request.env.ref("eguitra_base.analytic_plan_chantier")._column_name(),
        (chantier.analytic_account_id.id,),
    )
    return float(request.env.cr.fetchone()[0])


def _row(c, detail=False):
    data = {
        "id": c.id, "name": c.name, "code": c.code or None, "client": {"id": c.partner_id.id, "name": c.partner_id.name},
        "contract_amount": c.contract_amount, "retention_rate": c.retention_rate, "state": c.state,
        "date_start": c.date_start, "date_end": c.date_end, "date_reception": c.date_reception, "location": c.location or None,
        "invoiced_amount": c.invoiced_amount, "progress_pct": c.progress_pct,
        "retention_total": c.retention_total, "retention_released": c.retention_released,
        "retention_outstanding": c.retention_total - c.retention_released,
    }
    if detail:
        costs = _costs(c)
        data.update({
            "costs": costs,
            "margin": c.invoiced_amount - costs,
            "situations": [
                {"id": s.id, "number": s.number, "date": s.date, "period_label": s.period_label or None,
                 "cumulative_amount": s.cumulative_amount, "previous_amount": s.previous_amount,
                 "amount_period": s.amount_period, "retention_amount": s.retention_amount,
                 "progress_pct": s.progress_pct, "state": s.state,
                 "invoice": {"id": s.invoice_id.id, "name": s.invoice_id.name, "residual": s.invoice_id.amount_residual}
                 if s.invoice_id else None}
                for s in c.situation_ids.sorted("number")
            ],
        })
    return data


class EguitraChantiers(http.Controller):
    @api_route("/chantiers", profiles=READ)
    def list(self, **kw):
        domain = []
        if kw.get("state"):
            domain.append(("state", "in", kw["state"].split(",")))
        chantiers = request.env["eguitra.chantier"].search(domain)
        rows = [_row(c) for c in chantiers]
        return {"items": rows, "totals": {
            "contract_amount": sum(r["contract_amount"] for r in rows),
            "invoiced_amount": sum(r["invoiced_amount"] for r in rows),
            "retention_outstanding": sum(r["retention_outstanding"] for r in rows),
        }}

    @api_route("/chantiers/<int:chantier_id>", profiles=READ)
    def get(self, chantier_id, **_kw):
        return _row(_chantier(chantier_id), detail=True)

    def _values(self, data):
        values = {k: data[k] or False for k in ("name", "code", "location") if k in data}
        if "partner_id" in data:
            values["partner_id"] = int(data["partner_id"])
        for key in ("contract_amount", "retention_rate"):
            if key in data:
                values[key] = as_float(data[key] or 0, key)
        for key in ("date_start", "date_end", "date_reception"):
            if key in data:
                values[key] = parse_date(data, key)
        if data.get("state") in ("preparation", "progress", "received", "closed"):
            values["state"] = data["state"]
        return values

    @api_route("/chantiers", methods=("POST",), profiles=WRITE)
    def create(self, **_kw):
        data = read_json()
        require(data, "name", "partner_id")
        return _row(request.env["eguitra.chantier"].create(self._values(data)), detail=True)

    @api_route("/chantiers/<int:chantier_id>", methods=("PATCH",), profiles=WRITE)
    def update(self, chantier_id, **_kw):
        chantier = _chantier(chantier_id)
        chantier.write(self._values(read_json()))
        return _row(chantier, detail=True)

    @api_route("/chantiers/<int:chantier_id>/situations", methods=("POST",), profiles=WRITE)
    def add_situation(self, chantier_id, **_kw):
        chantier = _chantier(chantier_id)
        data = read_json()
        if data.get("progress_pct") not in (None, "") and not data.get("cumulative_amount"):
            if not chantier.contract_amount:
                raise ApiError(422, "business_rule", "Montant du marché requis pour saisir un pourcentage d'avancement.")
            cumulative = chantier.contract_amount * as_float(data["progress_pct"], "progress_pct") / 100
        else:
            (cumulative,) = require(data, "cumulative_amount")
            cumulative = as_float(cumulative, "cumulative_amount")
        request.env["eguitra.chantier.situation"].create({
            "chantier_id": chantier.id, "cumulative_amount": round(cumulative),
            "date": parse_date(data, "date", today()), "period_label": data.get("period_label") or False,
        })
        return _row(chantier, detail=True)

    @api_route("/chantiers/situations/<int:situation_id>/invoice", methods=("POST",), profiles=INVOICE)
    def invoice(self, situation_id, **_kw):
        situation = request.env["eguitra.chantier.situation"].browse(situation_id).exists()
        if not situation:
            raise ApiError(404, "not_found", "Situation introuvable.")
        situation.action_invoice()
        return _row(situation.chantier_id, detail=True)

    @api_route("/chantiers/situations/<int:situation_id>/cancel", methods=("POST",), profiles=WRITE)
    def cancel(self, situation_id, **_kw):
        situation = request.env["eguitra.chantier.situation"].browse(situation_id).exists()
        if not situation:
            raise ApiError(404, "not_found", "Situation introuvable.")
        situation.action_cancel()
        return _row(situation.chantier_id, detail=True)

    @api_route("/chantiers/<int:chantier_id>/release-retention", methods=("POST",), profiles=INVOICE)
    def release(self, chantier_id, **_kw):
        chantier = _chantier(chantier_id)
        chantier.action_release_retention()
        return _row(chantier, detail=True)
