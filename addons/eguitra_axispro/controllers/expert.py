"""API du mode expert d'AxisPro Suite : modèle financier, risques, plan d'actions, financements
recherchés et tableau de bord du portefeuille du cabinet."""

import io
from datetime import timedelta

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require
from odoo.addons.eguitra_api.files import XLSX_OPTIONS, xlsx_row
from odoo.addons.eguitra_finance.controllers.common import as_float, parse_date, today

from .. import engine
from ..models.pilotage import (
    ACTION_OPEN,
    ACTION_STATES,
    FUNDING_OPEN,
    FUNDING_STATES,
    FUNDING_WON,
    INSTRUMENTS,
    RISK_CATEGORIES,
    risk_level,
)
from ..models.plan import FIXED_CATEGORIES, FUNDING_TYPES, LINE_FIELDS, LINE_KINDS, PLAN_PARAMS, REPAYMENTS
from .axispro import READ, WRITE, _dossier

FLOAT_LINE = ("amount", "quantity", "price", "unit_cost", "growth", "price_growth", "rate")
INT_LINE = ("sequence", "year", "life", "grace")
CHOICES = {"kind": LINE_KINDS, "category": FIXED_CATEGORIES, "funding_type": FUNDING_TYPES, "repayment": REPAYMENTS}
PLAN_FLOATS = ("discount_rate", "tax_rate", "min_tax_rate", "receivable_days", "inventory_days", "payable_days",
               "dscr_target", "equity_target")
PLAN_INTS = ("first_year", "horizon", "tax_holiday", "loss_carry_years")
FOLLOW_UP_DAYS = 14


def _record(model, record_id, label):
    record = request.env[model].browse(record_id).exists()
    if not record:
        raise ApiError(404, "not_found", f"{label} introuvable.")
    return record


def _choice(value, options, name):
    if value in (None, "", False):
        return False
    if value not in dict(options):
        raise ApiError(400, "invalid_parameter", f"Valeur inconnue : {name}.")
    return value


def _int(value, name):
    if value in (None, ""):
        return 0
    try:
        return int(value)
    except (TypeError, ValueError) as e:
        raise ApiError(400, "invalid_parameter", f"Nombre entier invalide : {name}.") from e


def _options(currency=None):
    return {
        "kinds": dict(LINE_KINDS), "categories": dict(FIXED_CATEGORIES), "funding_types": dict(FUNDING_TYPES),
        "repayments": dict(REPAYMENTS), "factors": engine.FACTORS,
        "indicators": {k: {"label": v[0], "higher": v[1], "unit": engine.indicator_unit(k, currency),
                           "money": v[2] == engine.MONEY} for k, v in engine.INDICATORS.items()},
    }


def _add(totals, currency, amount):
    """Ajoute `amount` au total de sa devise : jamais une devise ajoutée à une autre."""
    totals[currency] = totals.get(currency, 0.0) + (amount or 0.0)
    return totals


# ─── Modèle financier ─────────────────────────────────────────────────────


def _analysis(plan, currency):
    """Analyse du modèle, alertes chiffrées dans la devise du dossier."""
    params, lines, first_year = plan._inputs()
    return engine.analyse(params, lines, first_year=first_year, currency=currency)


def _plan_payload(dossier):
    """Modèle financier d'un dossier. `dossier.currency` : devise des montants du modèle (celle du
    dossier) ; `dossier.locked` : décision du comité verrouillée, le modèle est figé (l'écran ne
    propose alors aucune saisie, le noyau la refuserait)."""
    plan = dossier.plan_ids[:1]
    currency = dossier.currency_id.name
    if plan:
        params = {key: plan[key] for key in PLAN_PARAMS}
        analysis = _analysis(plan, currency)
        header = {"id": plan.id, "first_year": plan.first_year or None, "notes": plan.notes or None, **params}
        lines = [dict({key: line[key] for key in LINE_FIELDS}, id=line.id) for line in plan.line_ids]
    else:
        first_year = dossier.date_start.year if dossier.date_start else None
        analysis = engine.analyse({}, [], first_year=first_year, currency=currency)
        header = {"id": None, "first_year": None, "notes": None, **engine.DEFAULT_PARAMS}
        lines = []
    return {"plan": header, "lines": lines, "analysis": analysis, "options": _options(currency),
            "dossier": {"investment": dossier.investment, "financing_need": dossier.financing_need,
                        "currency": currency, "locked": bool(dossier.locked_review_id)}}


def _ensure_plan(dossier):
    return dossier.plan_ids[:1] or request.env["axispro.plan"].create({"dossier_id": dossier.id})


def _line_values(data):
    values = {}
    for key in FLOAT_LINE:
        if key in data:
            values[key] = as_float(data[key] or 0, key)
    for key in INT_LINE:
        if key in data:
            values[key] = _int(data[key], key)
    for key, options in CHOICES.items():
        if key in data:
            values[key] = _choice(data[key], options, key)
    for key in ("name", "unit", "ramp"):
        if key in data:
            values[key] = str(data[key] or "").strip()[:200] or False
    if values.get("ramp"):
        if not engine.ramp_factors(values["ramp"]):
            raise ApiError(400, "invalid_parameter", "Montée en régime : pourcentages séparés par des points-virgules.")
    return values


def _plan_xlsx(dossier):
    import xlsxwriter

    plan = dossier.plan_ids[:1]
    analysis, stress = _analysis(plan, dossier.currency_id.name), plan.stress()
    out = io.BytesIO()
    book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
    head = book.add_format({"bold": True, "bg_color": "#11221D", "font_color": "#FFFFFF"})
    bold = book.add_format({"bold": True})
    money = book.add_format({"num_format": "#,##0"})
    money_bold = book.add_format({"num_format": "#,##0", "bold": True})
    ratio = book.add_format({"num_format": "0.00"})
    labels = analysis["labels"]

    sheet = book.add_worksheet("Synthèse")
    ind = analysis["indicators"]
    rows = [
        ("Dossier", f"{dossier.reference} - {dossier.name}"),
        ("Devise des montants", dossier.currency_id.name),
        ("VAN du projet", ind["npv"]), ("TRI du projet (%)", ind["irr_project"]),
        ("TRI des fonds propres (%)", ind["irr_equity"]), ("DSCR minimal", ind["dscr_min"]),
        ("DSCR moyen", ind["dscr_avg"]), ("LLCR", ind["llcr"]), ("Délai de récupération (ans)", ind["payback"]),
        ("Délai de récupération actualisé (ans)", ind["discounted_payback"]),
        ("Marge d'EBE en croisière (%)", ind["ebitda_margin"]), ("Point mort en % du CA", ind["breakeven_ratio"]),
        ("Investissement total", ind["capex_total"]), ("Ressources totales", ind["funding_total"]),
        ("Apport des promoteurs (%)", ind["equity_share"]), ("Endettement (dette / fonds propres)", ind["gearing"]),
        ("Trésorerie cumulée minimale", ind["cash_min"]),
    ]
    for r, (label, value) in enumerate(rows):
        sheet.write_string(r, 0, label, bold)
        if isinstance(value, (int, float)):
            sheet.write_number(r, 1, value, ratio if abs(value) < 1000 else money)
        else:
            xlsx_row(sheet, r, [value if value is not None else "n.d."], col=1)
    r = len(rows) + 1
    sheet.write_string(r, 0, "Alertes", bold)
    for i, alert in enumerate(analysis["alerts"] or ["Aucune"], start=r + 1):
        xlsx_row(sheet, i, [alert])
    sheet.set_column(0, 0, 40)
    sheet.set_column(1, 1, 60)

    hyp = book.add_worksheet("Hypothèses")
    xlsx_row(hyp, 0, ["Paramètre", "Valeur"], head)
    params = analysis["params"]
    names = {f.name: f.string for f in plan._fields.values()}
    for r, key in enumerate(PLAN_PARAMS, start=1):
        xlsx_row(hyp, r, [names.get(key, key), params[key] if not isinstance(params[key], bool) else ("oui" if params[key] else "non")])
    start = len(PLAN_PARAMS) + 2
    columns = ["Nature", "Libellé", "Montant", "Volume", "Unité", "Prix", "Coût unitaire", "Montée en régime",
               "Croissance %", "Évolution des prix %", "Taux %", "Année", "Durée", "Différé", "Rubrique", "Ressource"]
    xlsx_row(hyp, start, columns, head)
    kinds, cats, ftypes = dict(LINE_KINDS), dict(FIXED_CATEGORIES), dict(FUNDING_TYPES)
    for r, line in enumerate(plan.line_ids, start=start + 1):
        xlsx_row(hyp, r, [kinds[line.kind], line.name, line.amount, line.quantity, line.unit or "", line.price,
                          line.unit_cost, line.ramp or "", line.growth, line.price_growth, line.rate, line.year,
                          line.life, line.grace, cats.get(line.category, ""), ftypes.get(line.funding_type, "")])
    hyp.set_column(0, 1, 28)
    hyp.set_column(2, 15, 14)
    if plan.notes:
        xlsx_row(hyp, start + len(plan.line_ids) + 2, ["Hypothèses et sources", plan.notes])

    def table(name, rows_):
        ws = book.add_worksheet(name)
        xlsx_row(ws, 0, [""] + labels, head)
        for r, row in enumerate(rows_, start=1):
            ws.write_string(r, 0, row["label"], bold if row["strong"] else None)
            for c, value in enumerate(row["values"], start=1):
                if value is None:
                    ws.write_string(r, c, "")
                else:
                    ws.write_number(r, c, value, ratio if row["ratio"] else (money_bold if row["strong"] else money))
        ws.set_column(0, 0, 44)
        ws.set_column(1, len(labels), 15)
        ws.freeze_panes(1, 1)

    table("Compte de résultat", analysis["statements"])
    table("Flux et trésorerie", analysis["flows"])
    table("Dette", analysis["debt"])
    table("BFR et point mort", analysis["working_capital"])

    sens = book.add_worksheet("Sensibilités")
    xlsx_row(sens, 0, ["Hypothèse", "Choc %", "VAN", "TRI projet %", "DSCR minimal", "Trésorerie minimale"], head)
    r = 1
    for item in stress["sensitivities"]:
        for row in item["rows"]:
            xlsx_row(sens, r, [item["label"], row["shock"], row["npv"], row["irr_project"] if row["irr_project"] is not None else "",
                               row["dscr_min"] if row["dscr_min"] is not None else "", row["cash_min"]])
            r += 1
    r += 1
    xlsx_row(sens, r, ["Scénario", "Hypothèses", "VAN", "TRI projet %", "DSCR minimal", "Trésorerie minimale"], head)
    for scenario in stress["scenarios"]:
        r += 1
        s = scenario["indicators"]
        xlsx_row(sens, r, [scenario["label"], scenario["description"], s["npv"],
                           s["irr_project"] if s["irr_project"] is not None else "",
                           s["dscr_min"] if s["dscr_min"] is not None else "", s["cash_min"]])
    sens.set_column(0, 1, 30)
    sens.set_column(2, 5, 18)
    book.close()
    return out.getvalue()


# ─── Représentations ──────────────────────────────────────────────────────


def risk_row(risk):
    return {
        "id": risk.id, "name": risk.name, "category": risk.category, "description": risk.description or None,
        "probability": risk.probability, "impact": risk.impact, "score": risk.score, "level": risk_level(risk.score),
        "mitigation": risk.mitigation or None, "residual_probability": risk.residual_probability or None,
        "residual_impact": risk.residual_impact or None, "residual_score": risk.residual_score or None,
        "residual_level": risk_level(risk.residual_score) if risk.residual_score else None,
        "owner": risk.owner, "state": risk.state,
        "actions": len(request.env["axispro.action"].search([("risk_id", "=", risk.id)])),
    }


def action_row(action, with_dossier=False, today_=None):
    row = {
        "id": action.id, "name": action.name, "description": action.description or None, "source": action.source,
        "criterion": action.criterion_id.code or None, "criterion_name": action.criterion_id.name or None,
        "review_id": action.review_id.id or None,
        "compartment": action.criterion_id.domain_id.compartment_id.code or None,
        "compartment_name": action.criterion_id.domain_id.compartment_id.name or None,
        "risk_id": action.risk_id.id or None, "assignee": action.assignee, "user": action.user_id.name or None,
        "due_date": action.due_date, "state": action.state, "portal_visible": action.portal_visible,
        "porteur_comment": action.porteur_comment or None, "done_date": action.done_date,
        "done_by": action.done_by.name or None, "overdue": action.is_overdue(today_),
    }
    if with_dossier:
        row["dossier"] = {"id": action.dossier_id.id, "reference": action.dossier_id.reference,
                          "name": action.dossier_id.name}
    return row


def funding_row(funding, with_dossier=False):
    """Démarche de financement ; `currency` : devise de ses montants, celle de son dossier."""
    row = {
        "id": funding.id, "funder": {"id": funding.funder_id.id, "name": funding.funder_id.name},
        "currency": funding.currency_id.name or None,
        "instrument": funding.instrument, "amount_requested": funding.amount_requested,
        "amount_granted": funding.amount_granted, "rate": funding.rate or None,
        "duration_months": funding.duration_months or None, "state": funding.state, "state_date": funding.state_date,
        "date_submitted": funding.date_submitted, "date_decision": funding.date_decision,
        "next_step": funding.next_step or None, "next_date": funding.next_date,
        "conditions": funding.conditions or None,
    }
    if with_dossier:
        row["dossier"] = {"id": funding.dossier_id.id, "reference": funding.dossier_id.reference,
                          "name": funding.dossier_id.name}
    return row


class EguitraAxisproExpert(http.Controller):
    # ─── Modèle financier ─────────────────────────────────────────────────

    @api_route("/axispro/dossiers/<int:dossier_id>/plan", profiles=READ)
    def plan(self, dossier_id, **_kw):
        return _plan_payload(_dossier(dossier_id))

    @api_route("/axispro/dossiers/<int:dossier_id>/plan", methods=("PATCH",), profiles=WRITE)
    def update_plan(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        data = read_json()
        values = {}
        for key in PLAN_FLOATS:
            if key in data:
                values[key] = as_float(data[key] or 0, key)
        for key in PLAN_INTS:
            if key in data:
                values[key] = _int(data[key], key)
        if "residual_value" in data:
            values["residual_value"] = bool(data["residual_value"])
        if "notes" in data:
            values["notes"] = str(data["notes"] or "")[:5000] or False
        _ensure_plan(dossier).write(values)
        return _plan_payload(dossier)

    @api_route("/axispro/dossiers/<int:dossier_id>/plan/lines", methods=("POST",), profiles=WRITE)
    def create_line(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        data = read_json()
        require(data, "kind", "name")
        values = _line_values(data)
        if values["kind"] == "fixed" and not values.get("category"):
            values["category"] = "external"
        if values["kind"] == "revenue" and "year" not in values:
            values["year"] = 1
        request.env["axispro.plan.line"].create(dict(values, plan_id=_ensure_plan(dossier).id))
        return _plan_payload(dossier)

    @api_route("/axispro/plan-lines/<int:line_id>", methods=("PATCH",), profiles=WRITE)
    def update_line(self, line_id, **_kw):
        line = _record("axispro.plan.line", line_id, "Hypothèse")
        values = _line_values(read_json())
        values.pop("kind", None)  # la nature d'une hypothèse ne change pas : supprimer et recréer
        line.write(values)
        return _plan_payload(line.plan_id.dossier_id)

    @api_route("/axispro/plan-lines/<int:line_id>", methods=("DELETE",), profiles=WRITE)
    def delete_line(self, line_id, **_kw):
        line = _record("axispro.plan.line", line_id, "Hypothèse")
        dossier = line.plan_id.dossier_id
        line.unlink()
        return _plan_payload(dossier)

    @api_route("/axispro/dossiers/<int:dossier_id>/plan/stress", profiles=READ)
    def plan_stress(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        plan = dossier.plan_ids[:1]
        if not plan or not plan.line_ids:
            return None
        return plan.stress()

    @api_route("/axispro/dossiers/<int:dossier_id>/plan.xlsx", profiles=READ)
    def plan_xlsx(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        if not dossier.plan_ids.line_ids:
            raise ApiError(422, "business_rule", "Le modèle financier est vide.")
        return request.make_response(_plan_xlsx(dossier), headers=[
            ("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            ("Content-Disposition", f'attachment; filename="{dossier.reference.replace("/", "-")}_modele_financier.xlsx"'),
        ])

    # ─── Risques ──────────────────────────────────────────────────────────

    def _risk_values(self, data):
        values = {}
        for key in ("name", "description", "mitigation"):
            if key in data:
                values[key] = str(data[key] or "").strip()[:5000] or False
        for key in ("probability", "impact", "residual_probability", "residual_impact"):
            if key in data:
                values[key] = _int(data[key], key)
        if "category" in data:
            values["category"] = _choice(data["category"], RISK_CATEGORIES, "category") or "other"
        if data.get("owner") in ("porteur", "cabinet", "tiers"):
            values["owner"] = data["owner"]
        if data.get("state") in ("open", "mitigating", "closed"):
            values["state"] = data["state"]
        return values

    @staticmethod
    def _risks_payload(dossier):
        return {"risks": [risk_row(r) for r in dossier.risk_ids], "summary": dossier.risk_summary(),
                "categories": dict(RISK_CATEGORIES)}

    @api_route("/axispro/dossiers/<int:dossier_id>/risks", profiles=READ)
    def risks(self, dossier_id, **_kw):
        return self._risks_payload(_dossier(dossier_id))

    @api_route("/axispro/dossiers/<int:dossier_id>/risks", methods=("POST",), profiles=WRITE)
    def create_risk(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        data = read_json()
        require(data, "name")
        request.env["axispro.risk"].create(dict(self._risk_values(data), dossier_id=dossier.id))
        return self._risks_payload(dossier)

    @api_route("/axispro/risks/<int:risk_id>", methods=("PATCH",), profiles=WRITE)
    def update_risk(self, risk_id, **_kw):
        risk = _record("axispro.risk", risk_id, "Risque")
        risk.write(self._risk_values(read_json()))
        return risk_row(risk)

    @api_route("/axispro/risks/<int:risk_id>", methods=("DELETE",), profiles=WRITE)
    def delete_risk(self, risk_id, **_kw):
        _record("axispro.risk", risk_id, "Risque").unlink()
        return {"status": "ok"}

    @api_route("/axispro/risks/<int:risk_id>/action", methods=("POST",), profiles=WRITE)
    def risk_action(self, risk_id, **_kw):
        return action_row(_record("axispro.risk", risk_id, "Risque").action_plan())

    # ─── Plan d'actions ───────────────────────────────────────────────────

    def _action_values(self, data):
        values = {}
        for key in ("name", "description"):
            if key in data:
                values[key] = str(data[key] or "").strip()[:5000] or False
        if "due_date" in data:
            values["due_date"] = parse_date(data, "due_date") or False
        if data.get("assignee") in ("porteur", "cabinet"):
            values["assignee"] = data["assignee"]
        if "state" in data:
            values["state"] = _choice(data["state"], ACTION_STATES, "state") or "todo"
        if "portal_visible" in data:
            values["portal_visible"] = bool(data["portal_visible"])
        if data.get("user_id"):
            values["user_id"] = int(data["user_id"])
        return values

    @api_route("/axispro/actions", profiles=READ)
    def actions(self, **kw):
        domain = []
        if kw.get("dossier_id"):
            domain.append(("dossier_id", "=", int_arg(kw, "dossier_id")))
        if kw.get("state") == "open":
            domain.append(("state", "in", ACTION_OPEN))
        elif kw.get("state") in dict(ACTION_STATES):
            domain.append(("state", "=", kw["state"]))
        if kw.get("assignee") in ("porteur", "cabinet"):
            domain.append(("assignee", "=", kw["assignee"]))
        if kw.get("mine") == "1":
            domain.append(("user_id", "=", request.env.user.id))
        records = request.env["axispro.action"].search(domain, limit=int_arg(kw, "limit", 500, 1, 2000),
                                                       order="due_date asc, id asc")
        day = today()
        rows = [action_row(a, with_dossier=not kw.get("dossier_id"), today_=day) for a in records]
        if kw.get("overdue") == "1":
            rows = [r for r in rows if r["overdue"]]
        return rows

    @api_route("/axispro/dossiers/<int:dossier_id>/actions", methods=("POST",), profiles=WRITE)
    def create_action(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        data = read_json()
        require(data, "name")
        values = dict(self._action_values(data), dossier_id=dossier.id, source="manual")
        values.setdefault("due_date", today() + timedelta(days=30))
        return action_row(request.env["axispro.action"].create(values))

    @api_route("/axispro/dossiers/<int:dossier_id>/actions/from-gaps", methods=("POST",), profiles=WRITE)
    def actions_from_gaps(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        created = request.env["axispro.action"].from_gaps(dossier, limit=int_arg(read_json(), "limit", 5, 1, 20))
        return {"created": len(created), "actions": [action_row(a) for a in dossier.action_ids]}

    @api_route("/axispro/actions/<int:action_id>", methods=("PATCH",), profiles=WRITE)
    def update_action(self, action_id, **_kw):
        action = _record("axispro.action", action_id, "Action")
        action.write(self._action_values(read_json()))
        return action_row(action)

    @api_route("/axispro/actions/<int:action_id>", methods=("DELETE",), profiles=WRITE)
    def delete_action(self, action_id, **_kw):
        _record("axispro.action", action_id, "Action").unlink()
        return {"status": "ok"}

    # ─── Financements recherchés ──────────────────────────────────────────

    def _funding_values(self, data):
        values = {}
        if data.get("funder_id"):
            values["funder_id"] = int(data["funder_id"])
        if "instrument" in data:
            values["instrument"] = _choice(data["instrument"], INSTRUMENTS, "instrument") or "other"
        if "state" in data:
            values["state"] = _choice(data["state"], FUNDING_STATES, "state") or "identified"
        for key in ("amount_requested", "amount_granted", "rate"):
            if key in data:
                values[key] = as_float(data[key] or 0, key)
        if "duration_months" in data:
            values["duration_months"] = _int(data["duration_months"], "duration_months")
        for key in ("date_submitted", "date_decision", "next_date"):
            if key in data:
                values[key] = parse_date(data, key) or False
        for key in ("next_step", "conditions"):
            if key in data:
                values[key] = str(data[key] or "").strip()[:5000] or False
        return values

    @api_route("/axispro/fundings", profiles=READ)
    def fundings(self, **kw):
        domain = []
        if kw.get("dossier_id"):
            domain.append(("dossier_id", "=", int_arg(kw, "dossier_id")))
        if kw.get("state") == "open":
            domain.append(("state", "in", FUNDING_OPEN))
        records = request.env["axispro.funding"].search(domain, limit=int_arg(kw, "limit", 500, 1, 2000))
        return [funding_row(f, with_dossier=not kw.get("dossier_id")) for f in records]

    @api_route("/axispro/dossiers/<int:dossier_id>/fundings", methods=("POST",), profiles=WRITE)
    def create_funding(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        data = read_json()
        require(data, "funder_id")
        return funding_row(request.env["axispro.funding"].create(dict(self._funding_values(data), dossier_id=dossier.id)))

    @api_route("/axispro/fundings/<int:funding_id>", methods=("PATCH",), profiles=WRITE)
    def update_funding(self, funding_id, **_kw):
        funding = _record("axispro.funding", funding_id, "Financement")
        funding.write(self._funding_values(read_json()))
        return funding_row(funding)

    @api_route("/axispro/fundings/<int:funding_id>", methods=("DELETE",), profiles=WRITE)
    def delete_funding(self, funding_id, **_kw):
        _record("axispro.funding", funding_id, "Financement").unlink()
        return {"status": "ok"}

    # ─── Portefeuille ─────────────────────────────────────────────────────

    @api_route("/axispro/portfolio", profiles=READ)
    def portfolio(self, **_kw):
        """Tableau de bord du cabinet : entonnoir des gates, recommandations, rentabilité, besoins et
        financements obtenus, actions en retard, risques critiques, relances, charge et honoraires.

        Devises (audit du noyau, I-X3) : un dossier se chiffre dans sa devise, que suivent ses démarches
        de financement. Aucun montant d'une devise ne s'ajoute à une autre : les montants simples
        (need, investment, requested, granted) ne portent que sur la devise de la société (`currency`),
        et chaque devise a ses totaux (`by_currency`, `need_by_currency`, `investment_by_currency`).
        Pas de conversion : sans cours saisi, le noyau compterait 1 USD pour 1 GNF, et le cours du jour
        ne dit rien d'un besoin à financer sur plusieurs années, que les financeurs instruisent dans la
        devise du dossier. Les honoraires facturés sont lus dans la devise de la société."""
        env = request.env
        day = today()
        company_currency = env.company.currency_id.name
        dossiers = env["axispro.dossier"].search([("state", "in", ("open", "on_hold"))])
        funnel, recommendations, sectors, projects = {}, {}, {}, []
        by_currency = {}

        def bucket(currency):
            return by_currency.setdefault(currency, {"currency": currency, "need": 0.0, "investment": 0.0,
                                                     "requested": 0.0, "granted": 0.0})

        for d in dossiers:
            currency = d.currency_id.name
            gate = d.current_gate_id
            if gate:
                entry = funnel.setdefault(gate.code, {"code": gate.code, "name": gate.name, "sequence": gate.sequence,
                                                      "count": 0, "need_by_currency": {}})
                entry["count"] += 1
                _add(entry["need_by_currency"], currency, d.financing_need)
            result = d.evaluate()
            score = d.scoring(result)
            recommendations[score["recommendation"]] = recommendations.get(score["recommendation"], 0) + 1
            sector = (d.sector or "Non renseigné").strip()
            item = sectors.setdefault(sector, {"label": sector, "count": 0, "investment_by_currency": {}})
            item["count"] += 1
            _add(item["investment_by_currency"], currency, d.investment)
            totals = bucket(currency)
            totals["need"] += d.financing_need
            totals["investment"] += d.investment
            fin = result.get("financial")
            projects.append({
                "id": d.id, "reference": d.reference, "name": d.name, "promoter": d.promoter_id.name,
                "state": d.state, "gate": gate.code or None, "score": score["global_score"],
                "readiness": score["readiness"], "apd": score["apd"], "bankability": score["bankability"],
                "assessed": score["assessed"],
                "classification": score["classification"], "knockouts": len(score["knockouts"]),
                "recommendation": score["recommendation"], "financing_need": d.financing_need,
                "currency": currency,
                "npv": fin["npv"] if fin else None, "irr_project": fin["irr_project"] if fin else None,
                "dscr_min": fin["dscr_min"] if fin else None, "consultant": d.consultant_id.name or None,
                "risks": d.risk_summary(), "actions": d.action_summary(),
            })
        for entry in funnel.values():
            entry["need"] = entry["need_by_currency"].get(company_currency, 0.0)
        for item in sectors.values():
            item["investment"] = item["investment_by_currency"].get(company_currency, 0.0)
        fundings = env["axispro.funding"].search([("dossier_id", "in", dossiers.ids)])
        pipeline = []
        for key, label in FUNDING_STATES:
            subset = fundings.filtered(lambda f, k=key: f.state == k)
            split = {}
            for f in subset:
                row = split.setdefault(f.currency_id.name, {"currency": f.currency_id.name, "count": 0,
                                                            "requested": 0.0, "granted": 0.0})
                row["count"] += 1
                row["requested"] += f.amount_requested
                row["granted"] += f.amount_granted
            own = split.get(company_currency, {})
            pipeline.append({"state": key, "label": label, "count": len(subset),
                             "requested": own.get("requested", 0.0), "granted": own.get("granted", 0.0),
                             "by_currency": sorted(split.values(),
                                                   key=lambda r: (r["currency"] != company_currency, r["currency"]))})
        won = fundings.filtered(lambda f: f.state in FUNDING_WON)
        for f in fundings.filtered(lambda f: f.state not in ("rejected", "withdrawn")):
            bucket(f.currency_id.name)["requested"] += f.amount_requested
        for f in won:
            bucket(f.currency_id.name)["granted"] += f.amount_granted
        main = by_currency.get(company_currency) or {"need": 0.0, "investment": 0.0, "requested": 0.0, "granted": 0.0}
        follow_ups = fundings.filtered(
            lambda f: f.state in FUNDING_OPEN and f.next_date and f.next_date <= day + timedelta(days=FOLLOW_UP_DAYS)
        ).sorted("next_date")
        actions = env["axispro.action"].search([("dossier_id", "in", dossiers.ids), ("state", "in", ACTION_OPEN)],
                                               order="due_date asc, id asc")
        overdue = actions.filtered(lambda a: a.is_overdue(day))
        due_soon = actions.filtered(lambda a: not a.is_overdue(day) and a.due_date and a.due_date <= day + timedelta(days=7))
        risks = env["axispro.risk"].search([("dossier_id", "in", dossiers.ids), ("state", "!=", "closed")],
                                           order="score desc, id asc")
        critical = risks.filtered(lambda r: risk_level(r.score) == "critical")
        since = day - timedelta(days=30)
        sheets = env["axispro.timesheet"].search([("date", ">=", since)])
        workload = {}
        for d in dossiers:
            name = d.consultant_id.name or "Non affecté"
            workload.setdefault(name, {"name": name, "dossiers": 0, "hours": 0.0})["dossiers"] += 1
        for sheet in sheets:
            workload.setdefault(sheet.user_id.name, {"name": sheet.user_id.name, "dossiers": 0, "hours": 0.0})
            workload[sheet.user_id.name]["hours"] += sheet.hours
        unbilled = env["axispro.timesheet"].search([("billable", "=", True), ("invoice_id", "=", False)])
        year_start = day.replace(month=1, day=1)
        invoices = env["axispro.timesheet"].search([("invoice_id", "!=", False)]).invoice_id.filtered(
            lambda m: m.state == "posted" and m.invoice_date and m.invoice_date >= year_start
        )
        reviews = env["axispro.review"].search([("date", ">=", day - timedelta(days=90))])
        return {
            "generated_at": fields.Datetime.now(),
            "currency": company_currency,
            "counts": {"open": len(dossiers.filtered(lambda d: d.state == "open")),
                       "on_hold": len(dossiers.filtered(lambda d: d.state == "on_hold"))},
            "funnel": sorted(funnel.values(), key=lambda x: x["sequence"]),
            "recommendations": recommendations,
            "sectors": sorted(sectors.values(), key=lambda x: (-x["investment"], -x["count"], x["label"])),
            "projects": projects,
            "financing": {
                "need": main["need"],
                "investment": main["investment"],
                "requested": main["requested"],
                "granted": main["granted"],
                "by_currency": sorted(by_currency.values(),
                                      key=lambda r: (r["currency"] != company_currency, r["currency"])),
                "pipeline": pipeline,
            },
            "follow_ups": [funding_row(f, with_dossier=True) for f in follow_ups[:10]],
            "actions": {"open": len(actions), "overdue": len(overdue), "due_soon": len(due_soon),
                        "submitted": len(actions.filtered(lambda a: a.state == "submitted")),
                        "list": [action_row(a, with_dossier=True, today_=day) for a in (overdue | due_soon)[:12]]},
            "risks": {"open": len(risks), "critical": len(critical),
                      "list": [dict(risk_row(r), dossier={"id": r.dossier_id.id, "reference": r.dossier_id.reference,
                                                          "name": r.dossier_id.name}) for r in risks[:8]]},
            "workload": sorted(workload.values(), key=lambda x: -x["hours"]),
            # Montant hors taxes dans la devise de la société, quelle que soit la devise d'une facture.
            "fees": {"unbilled_hours": sum(unbilled.mapped("hours")),
                     "invoiced_year": sum(invoices.mapped("amount_untaxed_signed")), "currency": company_currency},
            "committees": {"last_90_days": len(reviews),
                           "decisions": {k: len(reviews.filtered(lambda r, k=k: r.decision == k))
                                         for k in ("go", "conditional", "hold", "no_go", "postponed")}},
        }
