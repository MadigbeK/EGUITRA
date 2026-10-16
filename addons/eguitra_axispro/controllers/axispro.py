"""API AxisPro Suite (cabinet) : politique, dossiers, évaluation, data room, comités, rapports, temps."""

import io

from odoo import fields, http
from odoo.http import request

from odoo.addons.eguitra_api.controllers.framework import ApiError, api_route, int_arg, read_json, require
from odoo.addons.eguitra_api.files import XLSX_OPTIONS, xlsx_row
from odoo.addons.eguitra_finance.controllers.common import as_float, move_summary, parse_date, today

from ..engine import INDICATORS
from ..models.dossier import RECOMMENDATIONS, STATUSES
from ..models.pilotage import ACTION_OPEN, ACTION_STATES, RISK_CATEGORIES, risk_level
from ..models.policy import grid_template
from .common import (
    document_row,
    dossier_detail,
    dossier_summary,
    download,
    message_row,
    review_row,
    store_upload,
)

READ = ("admin", "direction", "cabinet")
WRITE = ("cabinet",)
# Indicateurs financiers figés dans l'instantané d'une revue de comité.
SNAPSHOT_INDICATORS = ("npv", "irr_project", "irr_equity", "dscr_min", "llcr", "payback", "equity_share",
                       "ebitda_margin", "cash_min")


def _dossier(dossier_id):
    dossier = request.env["axispro.dossier"].browse(dossier_id).exists()
    if not dossier:
        raise ApiError(404, "not_found", "Dossier introuvable.")
    return dossier


def _report_financial(dossier):
    plan = dossier.plan_ids[:1]
    if not plan or not plan.line_ids:
        return None
    analysis = plan.analysis()
    return {"indicators": analysis["indicators"], "financing_plan": analysis["financing_plan"],
            "alerts": analysis["alerts"], "params": analysis["params"]}


def _policy_payload(policy):
    return {
        "id": policy.id, "name": policy.name, "version": policy.version, "state": policy.state,
        "date_active": policy.date_active, "go_threshold": policy.go_threshold,
        "conditional_threshold": policy.conditional_threshold, "notes": policy.notes or None,
        "gates": [{"id": g.id, "code": g.code, "name": g.name, "description": g.description or None} for g in policy.gate_ids],
        "domains": [{"id": d.id, "code": d.code, "name": d.name, "weight": d.weight} for d in policy.domain_ids],
        "criteria": [
            {"id": c.id, "code": c.code, "name": c.name, "domain_id": c.domain_id.id, "gate_id": c.gate_id.id,
             "weight": c.weight, "critical": c.critical, "knockout": c.knockout,
             "evidence_required": c.evidence_required, "guidance": c.guidance or None,
             "indicator": c.indicator or None, "indicator_threshold": c.indicator_threshold if c.indicator else None,
             "indicator_partial": c.indicator_partial if c.indicator and c.indicator_has_partial else None}
            for c in policy.criterion_ids
        ],
        "indicators": {k: {"label": v[0], "higher": v[1], "unit": v[2]} for k, v in INDICATORS.items()},
        "documents": [
            {"id": t.id, "code": t.code, "name": t.name, "category": t.category or None, "gate_id": t.gate_id.id or None,
             "required": t.required, "guidance": t.guidance or None}
            for t in policy.document_type_ids
        ],
    }


class EguitraAxispro(http.Controller):
    # ─── Politique d'évaluation ───────────────────────────────────────────

    @api_route("/axispro/policies", profiles=READ)
    def policies(self, **_kw):
        return [
            {"id": p.id, "name": p.name, "version": p.version, "state": p.state, "date_active": p.date_active,
             "criteria": len(p.criterion_ids), "domains": len(p.domain_ids), "gates": len(p.gate_ids),
             "documents": len(p.document_type_ids)}
            for p in request.env["axispro.policy"].search([])
        ]

    @api_route("/axispro/policies/<int:policy_id>", profiles=READ)
    def policy(self, policy_id, **_kw):
        policy = request.env["axispro.policy"].browse(policy_id).exists()
        if not policy:
            raise ApiError(404, "not_found", "Politique introuvable.")
        return _policy_payload(policy)

    @api_route("/axispro/policy", profiles=READ)
    def active_policy(self, **_kw):
        policy = request.env["axispro.policy"].active_policy(request.env.company)
        return _policy_payload(policy) if policy else None

    @api_route("/axispro/policies/template", profiles=READ)
    def template(self, **_kw):
        return request.make_response(grid_template(), headers=[
            ("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            ("Content-Disposition", 'attachment; filename="grille_axispro_modele.xlsx"'),
        ])

    @api_route("/axispro/policies/import", methods=("POST",), profiles=WRITE)
    def import_policy(self, **_kw):
        upload = request.httprequest.files.get("file")
        if not upload:
            raise ApiError(400, "missing_fields", "Classeur manquant.", fields=["file"])
        form = request.httprequest.form
        policy = request.env["axispro.policy"].import_grid(
            request.env.company, form.get("name") or "Politique d'évaluation AxisPro", upload.filename or "grille.xlsx",
            upload.read(), go=float(form.get("go_threshold") or 70), conditional=float(form.get("conditional_threshold") or 50),
            notes=form.get("notes") or None,
        )
        return _policy_payload(policy)

    @api_route("/axispro/policies/<int:policy_id>/activate", methods=("POST",), profiles=WRITE)
    def activate_policy(self, policy_id, **_kw):
        policy = request.env["axispro.policy"].browse(policy_id).exists()
        if not policy:
            raise ApiError(404, "not_found", "Politique introuvable.")
        policy.action_activate()
        return _policy_payload(policy)

    @api_route("/axispro/policies/<int:policy_id>/new-version", methods=("POST",), profiles=WRITE)
    def new_version(self, policy_id, **_kw):
        policy = request.env["axispro.policy"].browse(policy_id).exists()
        if not policy:
            raise ApiError(404, "not_found", "Politique introuvable.")
        return _policy_payload(policy.copy_as_new_version())

    @api_route("/axispro/criteria/<int:criterion_id>", methods=("PATCH",), profiles=WRITE)
    def update_criterion(self, criterion_id, **_kw):
        """Ajustement d'un critère d'une version en brouillon (pondération, criticité, aide)."""
        criterion = request.env["axispro.criterion"].browse(criterion_id).exists()
        if not criterion:
            raise ApiError(404, "not_found", "Critère introuvable.")
        if criterion.policy_id.state != "draft":
            raise ApiError(422, "business_rule", "Seule une version en brouillon se modifie : créez une nouvelle version.")
        data = read_json()
        values = {k: data[k] for k in ("name", "guidance") if k in data}
        for key in ("critical", "knockout", "evidence_required"):
            if key in data:
                values[key] = bool(data[key])
        if "weight" in data:
            values["weight"] = as_float(data["weight"], "weight")
        if "indicator" in data:
            if data["indicator"] and data["indicator"] not in INDICATORS:
                raise ApiError(400, "invalid_parameter", "Indicateur inconnu.")
            values["indicator"] = data["indicator"] or False
        if "indicator_threshold" in data:
            values["indicator_threshold"] = as_float(data["indicator_threshold"] or 0, "indicator_threshold")
        if "indicator_partial" in data:
            partial = data["indicator_partial"]
            values["indicator_has_partial"] = partial not in (None, "")
            values["indicator_partial"] = as_float(partial, "indicator_partial") if partial not in (None, "") else 0.0
        criterion.write(values)
        return {"status": "ok"}

    # ─── Dossiers ─────────────────────────────────────────────────────────

    @api_route("/axispro/dossiers", profiles=READ)
    def dossiers(self, **kw):
        domain = []
        if kw.get("state"):
            domain.append(("state", "in", kw["state"].split(",")))
        if kw.get("search"):
            domain += ["|", ("name", "ilike", kw["search"]), ("reference", "ilike", kw["search"])]
        return [dossier_summary(d) for d in request.env["axispro.dossier"].search(domain, limit=int_arg(kw, "limit", 200, 1, 1000))]

    @api_route("/axispro/dossiers/<int:dossier_id>", profiles=READ)
    def dossier(self, dossier_id, **_kw):
        return dossier_detail(_dossier(dossier_id))

    def _values(self, data):
        values = {k: data[k] or False for k in ("name", "sector", "location", "capacity", "description", "hypotheses")
                  if k in data}
        for key in ("investment", "financing_need"):
            if key in data:
                values[key] = as_float(data[key] or 0, key)
        if "date_start" in data:
            values["date_start"] = parse_date(data, "date_start")
        if data.get("promoter_id"):
            values["promoter_id"] = int(data["promoter_id"])
        if data.get("state") in ("open", "on_hold", "closed"):
            values["state"] = data["state"]
        return values

    @api_route("/axispro/dossiers", methods=("POST",), profiles=WRITE)
    def create_dossier(self, **_kw):
        data = read_json()
        require(data, "name", "promoter_id")
        return dossier_detail(request.env["axispro.dossier"].create(self._values(data)))

    @api_route("/axispro/dossiers/<int:dossier_id>", methods=("PATCH",), profiles=WRITE)
    def update_dossier(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        dossier.write(self._values(read_json()))
        return dossier_detail(dossier)

    @api_route("/axispro/dossiers/<int:dossier_id>/portal-access", methods=("POST",), profiles=WRITE)
    def portal_access(self, dossier_id, **_kw):
        """Ouvre le portail au porteur : compte porteur créé au besoin, mot de passe provisoire."""
        dossier = _dossier(dossier_id)
        data = read_json()
        login, name, password = require(data, "login", "name", "password")
        Users = request.env["res.users"].sudo().with_context(no_reset_password=True)
        user = Users.with_context(active_test=False).search([("login", "=", str(login).strip().lower())], limit=1)
        if user and not user.share:
            raise ApiError(409, "conflict", "Cet identifiant appartient à un utilisateur interne.")
        if not user:
            user = Users.create({
                "name": name, "login": str(login).strip().lower(), "password": password,
                "email": data.get("email") or False, "eguitra_password_temporary": True,
                "company_id": dossier.company_id.id, "company_ids": [(6, 0, dossier.company_id.ids)],
            })
            user._eguitra_set_profiles(["porteur"])
        dossier.sudo().portal_user_ids = [(4, user.id)]
        return dossier_detail(dossier)

    @api_route("/axispro/dossiers/<int:dossier_id>/criteria", profiles=READ)
    def criteria(self, dossier_id, **kw):
        dossier = _dossier(dossier_id)
        evaluations = dossier.evaluation_ids
        if kw.get("gate_id"):
            evaluations = evaluations.filtered(lambda e: e.criterion_id.gate_id.id == int_arg(kw, "gate_id"))
        indicators = dossier.financial_indicators() if evaluations.criterion_id.filtered("indicator") else None
        return [
            {"id": e.id, "criterion_id": e.criterion_id.id, "code": e.criterion_id.code, "name": e.criterion_id.name,
             "domain": e.criterion_id.domain_id.name, "gate_id": e.criterion_id.gate_id.id, "weight": e.criterion_id.weight,
             "critical": e.criterion_id.critical, "knockout": e.criterion_id.knockout,
             "evidence_required": e.criterion_id.evidence_required, "guidance": e.criterion_id.guidance or None,
             "status": e.status, "comment": e.comment or None, "documents": e.document_ids.ids,
             "assessed_by": e.assessed_by.name or None, "assessed_at": e.assessed_at,
             "suggestion": e.criterion_id.suggestion(indicators) if e.criterion_id.indicator else None,
             "indicator": e.criterion_id.indicator or None}
            for e in evaluations
        ]

    @api_route("/axispro/evaluations/<int:evaluation_id>", methods=("PATCH",), profiles=WRITE)
    def evaluate(self, evaluation_id, **_kw):
        evaluation = request.env["axispro.evaluation"].browse(evaluation_id).exists()
        if not evaluation:
            raise ApiError(404, "not_found", "Évaluation introuvable.")
        data = read_json()
        values = {}
        if "status" in data:
            if data["status"] not in dict(STATUSES):
                raise ApiError(400, "invalid_parameter", "Statut inconnu.")
            values["status"] = data["status"]
        if "comment" in data:
            values["comment"] = data["comment"] or False
        if "document_ids" in data:
            docs = request.env["axispro.document"].browse([int(i) for i in data["document_ids"]]).exists()
            if docs.filtered(lambda d: d.dossier_id != evaluation.dossier_id):
                raise ApiError(422, "business_rule", "Les preuves doivent provenir de la data room du dossier.")
            values["document_ids"] = [(6, 0, docs.ids)]
        evaluation.write(values)
        return {"status": "ok", "scoring": evaluation.dossier_id.scoring()}

    @api_route("/axispro/dossiers/<int:dossier_id>/advance-gate", methods=("POST",), profiles=WRITE)
    def advance(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        dossier.action_advance_gate()
        return dossier_detail(dossier)

    # ─── Data room ────────────────────────────────────────────────────────

    @api_route("/axispro/dossiers/<int:dossier_id>/documents", profiles=READ)
    def documents(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        return {"standard": dossier.documents_status(),
                "files": [document_row(doc) for doc in dossier.document_ids]}

    @api_route("/axispro/dossiers/<int:dossier_id>/documents", methods=("POST",), profiles=WRITE)
    def upload(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        form = request.httprequest.form
        doc = store_upload(dossier, form.get("document_type_id"), form.get("name"),
                           portal_visible=form.get("portal_visible", "1") != "0")
        return document_row(doc)

    @api_route("/axispro/documents/<int:document_id>", methods=("PATCH",), profiles=WRITE)
    def review_document(self, document_id, **_kw):
        doc = request.env["axispro.document"].browse(document_id).exists()
        if not doc:
            raise ApiError(404, "not_found", "Pièce introuvable.")
        data = read_json()
        values = {}
        if data.get("state") in ("received", "validated", "rejected"):
            values["state"] = data["state"]
        if "comment" in data:
            values["comment"] = data["comment"] or False
        if "portal_visible" in data:
            values["portal_visible"] = bool(data["portal_visible"])
        doc.write(values)
        return document_row(doc)

    @api_route("/axispro/documents/<int:document_id>/download", profiles=READ)
    def download_document(self, document_id, **_kw):
        doc = request.env["axispro.document"].browse(document_id).exists()
        if not doc:
            raise ApiError(404, "not_found", "Pièce introuvable.")
        return download(doc)

    # ─── Comités ──────────────────────────────────────────────────────────

    @api_route("/axispro/dossiers/<int:dossier_id>/reviews", methods=("POST",), profiles=WRITE)
    def create_review(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        data = read_json()
        (decision,) = require(data, "decision")
        if decision not in dict(RECOMMENDATIONS + [("postponed", "")]):
            raise ApiError(400, "invalid_parameter", "Décision inconnue.")
        scoring = dossier.scoring()
        financial = dossier.financial_indicators()
        if financial:
            scoring["financial"] = {k: financial[k] for k in SNAPSHOT_INDICATORS}
        review = request.env["axispro.review"].create({
            "dossier_id": dossier.id, "date": parse_date(data, "date", today()), "gate_id": dossier.current_gate_id.id,
            "members": data.get("members") or False, "decision": decision, "conditions": data.get("conditions") or False,
            "minutes": data.get("minutes") or False, "snapshot": scoring, "recommendation": scoring["recommendation"],
            "policy_version": dossier.policy_id.version,
        })
        if data.get("lock"):
            review.action_lock()
        return review_row(review)

    @api_route("/axispro/reviews", profiles=READ)
    def reviews(self, **kw):
        """Toutes les revues de comité, les plus récentes d'abord, avec leur dossier."""
        domain = [("state", "=", kw["state"])] if kw.get("state") in ("draft", "locked") else []
        reviews = request.env["axispro.review"].search(domain, order="date desc, id desc",
                                                       limit=int_arg(kw, "limit", 200, 1, 1000))
        return [
            dict(review_row(r), dossier={"id": r.dossier_id.id, "reference": r.dossier_id.reference,
                                         "name": r.dossier_id.name, "promoter": r.dossier_id.promoter_id.name})
            for r in reviews
        ]

    @api_route("/axispro/reviews/<int:review_id>/lock", methods=("POST",), profiles=WRITE)
    def lock_review(self, review_id, **_kw):
        review = request.env["axispro.review"].browse(review_id).exists()
        if not review:
            raise ApiError(404, "not_found", "Revue introuvable.")
        review.action_lock()
        return review_row(review)

    @api_route("/axispro/reviews/compare", profiles=READ)
    def compare(self, **kw):
        Review = request.env["axispro.review"]
        a = Review.browse(int_arg(kw, "a")).exists()
        b = Review.browse(int_arg(kw, "b")).exists()
        if not a or not b or a.dossier_id != b.dossier_id:
            raise ApiError(422, "business_rule", "Choisissez deux revues du même dossier.")
        older, newer = (a, b) if (a.date, a.id) <= (b.date, b.id) else (b, a)
        return newer.compare(older)

    # ─── Rapports ─────────────────────────────────────────────────────────

    @api_route("/axispro/dossiers/<int:dossier_id>/report", profiles=READ)
    def report(self, dossier_id, **_kw):
        """Rapport de décision du comité ; la politique appliquée y est rappelée."""
        dossier = _dossier(dossier_id)
        policy = dossier.policy_id
        return {
            "dossier": dossier_detail(dossier),
            "policy": {"name": policy.name, "version": policy.version, "date_active": policy.date_active,
                       "notes": policy.notes or None, "go_threshold": policy.go_threshold,
                       "conditional_threshold": policy.conditional_threshold},
            "documents": dossier.documents_status(),
            "financial": _report_financial(dossier),
            "risks": [{"name": r.name, "category": r.category, "score": r.score, "level": risk_level(r.score),
                       "mitigation": r.mitigation or None, "state": r.state}
                      for r in dossier.risk_ids.filtered(lambda r: r.state != "closed")[:10]],
            "actions": [{"name": a.name, "assignee": a.assignee, "due_date": a.due_date, "state": a.state}
                        for a in dossier.action_ids.filtered(lambda a: a.state in ACTION_OPEN)],
            "fundings": [{"funder": f.funder_id.name, "instrument": f.instrument, "amount_requested": f.amount_requested,
                          "amount_granted": f.amount_granted, "state": f.state} for f in dossier.funding_ids],
            "generated_at": fields.Datetime.now(),
        }

    @api_route("/axispro/dossiers/<int:dossier_id>/report.xlsx", profiles=READ)
    def report_xlsx(self, dossier_id, **_kw):
        import xlsxwriter

        dossier = _dossier(dossier_id)
        scoring = dossier.scoring()
        out = io.BytesIO()
        book = xlsxwriter.Workbook(out, XLSX_OPTIONS)
        bold = book.add_format({"bold": True})
        head = book.add_format({"bold": True, "bg_color": "#11221D", "font_color": "#FFFFFF"})
        sheet = book.add_worksheet("Synthèse")
        labels = dict(RECOMMENDATIONS)
        rows = [
            ("Dossier", f"{dossier.reference} - {dossier.name}"), ("Promoteur", dossier.promoter_id.name),
            ("Gate courant", dossier.current_gate_id.name or ""), ("Score global", round(scoring["global_score"] or 0, 1)),
            ("Recommandation", labels.get(scoring["recommendation"], "")),
            ("Critères éliminatoires actifs", ", ".join(k["code"] for k in scoring["knockouts"]) or "Aucun"),
            ("Politique appliquée", f"{dossier.policy_id.name}, version {dossier.policy_id.version}"),
        ]
        for r, (k, v) in enumerate(rows):
            sheet.write_string(r, 0, k, bold)
            xlsx_row(sheet, r, [v], col=1)
        sheet.set_column(0, 0, 32)
        sheet.set_column(1, 1, 70)
        dom = book.add_worksheet("Domaines")
        xlsx_row(dom, 0, ["Code", "Domaine", "Pondération", "Score /100", "Critères évalués"], head)
        for r, d in enumerate(scoring["domains"], start=1):
            xlsx_row(dom, r, [d["code"], d["name"], d["weight"], round(d["score"], 1) if d["score"] is not None else "",
                              f"{d['assessed']}/{d['criteria']}"])
        crit = book.add_worksheet("Critères")
        xlsx_row(crit, 0, ["Code", "Critère", "Domaine", "Gate", "Poids", "Critique", "Éliminatoire", "Statut", "Commentaire"], head)
        statuses = dict(STATUSES)
        for r, e in enumerate(dossier.evaluation_ids, start=1):
            c = e.criterion_id
            xlsx_row(crit, r, [c.code, c.name, c.domain_id.name, c.gate_id.code, c.weight, "oui" if c.critical else "",
                               "oui" if c.knockout else "", statuses[e.status], e.comment or ""])
        gaps = book.add_worksheet("Écarts prioritaires")
        xlsx_row(gaps, 0, ["Rang", "Critère", "Domaine", "Action attendue du promoteur"], head)
        for r, g in enumerate(dossier.gaps(5), start=1):
            xlsx_row(gaps, r, [r, f"{g['code']} {g['name']}", g["domain"], g["action"]])
        financial = dossier.financial_indicators()
        if financial:
            fin = book.add_worksheet("Modèle financier")
            xlsx_row(fin, 0, ["Indicateur", "Valeur"], head)
            for r, (key, (label, _higher, unit)) in enumerate(INDICATORS.items(), start=1):
                value = financial.get(key)
                xlsx_row(fin, r, [f"{label} ({unit})", round(value, 2) if value is not None else "n.d."])
            fin.set_column(0, 0, 45)
            fin.set_column(1, 1, 22)
        if dossier.risk_ids:
            sheet_risks = book.add_worksheet("Risques")
            xlsx_row(sheet_risks, 0, ["Risque", "Catégorie", "Probabilité", "Impact", "Criticité", "Atténuation", "État"],
                     head)
            categories = dict(RISK_CATEGORIES)
            for r, risk in enumerate(dossier.risk_ids, start=1):
                xlsx_row(sheet_risks, r, [risk.name, categories.get(risk.category, ""), risk.probability, risk.impact,
                                          risk.score, risk.mitigation or "", risk.state])
            sheet_risks.set_column(0, 0, 40)
            sheet_risks.set_column(5, 5, 60)
        if dossier.action_ids:
            sheet_actions = book.add_worksheet("Plan d'actions")
            xlsx_row(sheet_actions, 0, ["Action", "Confiée à", "Échéance", "État"], head)
            states = dict(ACTION_STATES)
            for r, action in enumerate(dossier.action_ids, start=1):
                xlsx_row(sheet_actions, r, [action.name, "Porteur" if action.assignee == "porteur" else "Cabinet",
                                            action.due_date.isoformat() if action.due_date else "", states[action.state]])
            sheet_actions.set_column(0, 0, 60)
            sheet_actions.set_column(1, 3, 16)
        book.close()
        return request.make_response(out.getvalue(), headers=[
            ("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            ("Content-Disposition", f'attachment; filename="{dossier.reference.replace("/", "-")}_evaluation.xlsx"'),
        ])

    # ─── Échanges ─────────────────────────────────────────────────────────

    @api_route("/axispro/dossiers/<int:dossier_id>/messages", profiles=READ)
    def messages(self, dossier_id, **_kw):
        return [message_row(m) for m in _dossier(dossier_id).message_ids]

    @api_route("/axispro/dossiers/<int:dossier_id>/messages", methods=("POST",), profiles=WRITE)
    def post_message(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        data = read_json()
        (body,) = require(data, "body")
        message = request.env["axispro.message"].create(
            {"dossier_id": dossier.id, "body": str(body)[:5000], "internal": bool(data.get("internal"))}
        )
        return message_row(message)

    # ─── Temps et facturation ─────────────────────────────────────────────

    @api_route("/axispro/timesheets", profiles=READ)
    def timesheets(self, **kw):
        domain = []
        if kw.get("dossier_id"):
            domain.append(("dossier_id", "=", int_arg(kw, "dossier_id")))
        if kw.get("unbilled") == "1":
            domain += [("billable", "=", True), ("invoice_id", "=", False)]
        sheets = request.env["axispro.timesheet"].search(domain, limit=int_arg(kw, "limit", 300, 1, 2000))
        return [
            {"id": t.id, "dossier": {"id": t.dossier_id.id, "reference": t.dossier_id.reference, "name": t.dossier_id.name},
             "user": t.user_id.name, "date": t.date, "hours": t.hours, "description": t.description,
             "billable": t.billable, "invoice": t.invoice_id.name or None}
            for t in sheets
        ]

    @api_route("/axispro/timesheets", methods=("POST",), profiles=WRITE)
    def log_time(self, **_kw):
        data = read_json()
        dossier_id, hours, description = require(data, "dossier_id", "hours", "description")
        sheet = request.env["axispro.timesheet"].create({
            "dossier_id": int(dossier_id), "hours": as_float(hours, "hours"), "description": description,
            "date": parse_date(data, "date", today()), "billable": data.get("billable", True) is not False,
        })
        return {"id": sheet.id}

    @api_route("/axispro/dossiers/<int:dossier_id>/invoice", methods=("POST",), profiles=("cabinet", "admin"))
    def invoice(self, dossier_id, **_kw):
        dossier = _dossier(dossier_id)
        data = read_json()
        sheets = request.env["axispro.timesheet"].search([("dossier_id", "=", dossier.id)])
        extra = [{"name": str(x["name"]), "amount": as_float(x["amount"], "amount")} for x in data.get("lines") or []]
        invoice = sheets.action_invoice(as_float(data.get("hourly_rate") or 0, "hourly_rate"), extra)
        return move_summary(invoice)
