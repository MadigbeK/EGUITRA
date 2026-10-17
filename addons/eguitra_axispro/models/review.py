"""Revues de comité : instantané de l'évaluation, décision, conditions, verrouillage scellé,
comparaison, nouvelle révision.

Le verrouillage d'une décision fige le dossier (évaluation, fiche, hypothèses, modèle financier)
jusqu'à l'ouverture d'une nouvelle révision. Il calcule une empreinte HMAC-SHA256, avec le secret du
serveur, d'un contenu canonique : fiche, hypothèses, version de la grille, réglages, évaluations
(statuts, observations, preuves et leurs sommes de contrôle), pièces de la data room, scores et
décision. L'empreinte se vérifie à tout moment (contenu scellé intact, dossier modifié depuis ou non).
"""

import hashlib
import hmac
import json

from odoo import fields, models
from odoo.exceptions import UserError

from ..scoring import DECISIONS
from .dossier import COMMITTEE_DECISIONS, HYPOTHESES, RECOMMENDATIONS


class AxisproReview(models.Model):
    _name = "axispro.review"
    _description = "Revue de comité"
    _order = "dossier_id, date desc, id desc"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True)
    date = fields.Date(required=True, default=fields.Date.context_today)
    gate_id = fields.Many2one("axispro.gate", "Gate examiné")
    members = fields.Text("Membres du comité")
    instance = fields.Char("Instance")
    snapshot = fields.Json("Instantané de l'évaluation", readonly=True)
    recommendation = fields.Selection(RECOMMENDATIONS, "Recommandation calculée", readonly=True)
    decision = fields.Selection(COMMITTEE_DECISIONS, "Décision", required=True)
    conditions = fields.Text("Conditions")
    motive = fields.Text("Motif de la décision")
    minutes = fields.Text("Compte rendu")
    policy_version = fields.Integer("Version de la politique", readonly=True)
    revision = fields.Integer("Révision du dossier", readonly=True)
    state = fields.Selection([("draft", "Brouillon"), ("locked", "Verrouillée")], default="draft", required=True)
    locked_by = fields.Many2one("res.users", readonly=True)
    locked_at = fields.Datetime(readonly=True)
    sealed_content = fields.Json("Contenu scellé", readonly=True)
    fingerprint = fields.Char("Empreinte", readonly=True, copy=False)

    def write(self, vals):
        if self.filtered(lambda r: r.state == "locked") and set(vals) - {"state"}:
            raise UserError("Une décision verrouillée ne se modifie plus.")
        return super().write(vals)

    def unlink(self):
        if self.filtered(lambda r: r.state == "locked"):
            raise UserError("Une décision verrouillée ne se supprime pas.")
        return super().unlink()

    def action_lock(self):
        for review in self:
            if review.state == "locked":
                continue
            dossier = review.dossier_id
            if dossier.locked_review_id:
                raise UserError(f"Une décision est déjà verrouillée pour la révision {dossier.revision} : ouvrez une "
                                "nouvelle révision avant d'en verrouiller une autre.")
            result = dossier.evaluate()
            snapshot = dossier.scoring(result)
            snapshot["financial"] = {k: (result.get("financial") or {}).get(k) for k in SNAPSHOT_FINANCIAL} \
                if result.get("financial") else None
            content = _canonical(dossier, review, snapshot)
            fingerprint = _seal(self.env, content)
            super(AxisproReview, review).write({
                "state": "locked", "locked_by": self.env.user.id, "locked_at": fields.Datetime.now(),
                "snapshot": snapshot, "recommendation": snapshot["recommendation"], "revision": dossier.revision,
                "policy_version": dossier.policy_id.version, "sealed_content": content, "fingerprint": fingerprint,
            })
            values = {"locked_review_id": review.id}
            if review.decision != "postponed":
                values["decision"] = review.decision
            dossier.sudo().with_context(axispro_unlocked=True).write(values)
            dossier.log("decision", note=f"Décision {DECISIONS.get(review.decision, 'Ajourné')} verrouillée "
                                         f"(révision {dossier.revision}, empreinte {fingerprint[:16]}).")
            # Les conditions du comité deviennent des actions suivies du porteur.
            self.env["axispro.action"].from_conditions(review)
        return True

    def verify(self):
        """Contrôle de l'empreinte : contenu scellé intact, et dossier inchangé depuis la décision."""
        self.ensure_one()
        if self.state != "locked" or not self.fingerprint:
            return {"sealed": False}
        intact = hmac.compare_digest(_seal(self.env, self.sealed_content), self.fingerprint)
        current = None
        if self.dossier_id.locked_review_id == self:
            content = _canonical(self.dossier_id, self, self.sealed_content.get("snapshot", {}))
            current = _digest(content["dossier"]) == _digest(self.sealed_content.get("dossier", {}))
        return {"sealed": True, "intact": intact, "unchanged": current, "fingerprint": self.fingerprint}

    def compare(self, other):
        """Écart de scores, de domaines, de gates et d'indicateurs financiers entre deux revues
        (self : la plus récente)."""
        self.ensure_one()
        a, b = other.snapshot or {}, self.snapshot or {}
        by_code = {d["code"]: d for d in a.get("domains", [])}
        domains = []
        for d in b.get("domains", []):
            before = by_code.get(d["code"], {}).get("score")
            domains.append({"code": d["code"], "name": d["name"], "before": before, "after": d["score"],
                            "delta": (d["score"] - before) if d["score"] is not None and before is not None else None})
        gates_a = {g["code"]: g["decision"] for g in a.get("gates", [])}
        gates = [{"code": g["code"], "name": g["name"], "before": gates_a.get(g["code"]), "after": g["decision"]}
                 for g in b.get("gates", [])]
        fin_a, fin_b = a.get("financial") or {}, b.get("financial") or {}
        financial = [
            {"key": key, "before": fin_a.get(key), "after": fin_b.get(key)}
            for key in ("npv", "irr_project", "irr_equity", "dscr_min", "payback", "equity_share")
            if fin_a.get(key) is not None or fin_b.get(key) is not None
        ]
        scores = [{"key": k, "before": a.get(k), "after": b.get(k)} for k in ("readiness", "apd", "bankability",
                                                                              "completeness", "dataroom_completeness")]
        return {
            "financial": financial,
            "scores": scores,
            "gates": gates,
            "from": {"id": other.id, "date": other.date, "decision": other.decision, "score": a.get("global_score")},
            "to": {"id": self.id, "date": self.date, "decision": self.decision, "score": b.get("global_score")},
            "domains": domains,
            "knockouts_before": [k["code"] for k in a.get("knockouts", [])],
            "knockouts_after": [k["code"] for k in b.get("knockouts", [])],
        }


SNAPSHOT_FINANCIAL = ("npv", "irr_project", "irr_equity", "dscr_min", "llcr", "payback", "equity_share",
                      "ebitda_margin", "cash_min")


def _canonical(dossier, review, snapshot):
    """Contenu scellé : état du dossier au verrouillage et décision du comité."""
    evaluations = []
    for e in dossier.evaluation_ids.sorted(lambda e: e.criterion_id.code):
        evaluations.append([e.criterion_id.code, e.status, e.comment or "", e.deliverable or "", e.responsible or "",
                            str(e.due_date or ""),
                            sorted([d.name, d.version, d.state, d.attachment_id.sudo().checksum or ""] for d in e.document_ids)])
    documents = sorted([d.document_type_id.code or "", d.name, d.version, d.state, str(d.validity_date or ""),
                        d.attachment_id.sudo().checksum or ""] for d in dossier.document_ids)
    plan = dossier.plan_ids[:1]
    lines = sorted([str(v) for v in line.read(["kind", "name", "amount", "quantity", "price", "unit_cost", "rate",
                                                   "year", "life", "grace", "growth", "price_growth", "ramp"])[0].values()]
                   for line in plan.line_ids) if plan else []
    dossier_content = {
        "reference": dossier.reference, "revision": dossier.revision, "name": dossier.name,
        "promoter": dossier.promoter_id.name, "sector": dossier.sector or "", "location": dossier.location or "",
        "investment": dossier.investment, "financing_need": dossier.financing_need,
        "currency": dossier.currency_id.name, "date_evaluation": str(dossier.date_evaluation or ""),
        "hypotheses": {h: dossier[h] or "" for h in HYPOTHESES},
        "dscr_manual": dossier.dscr_manual, "irr_manual": dossier.irr_manual,
        "policy": {"name": dossier.policy_id.name, "version": dossier.policy_id.version,
                   "settings": dossier.policy_id.scoring_settings()},
        "evaluations": evaluations, "documents": documents, "plan": lines,
    }
    return {
        "dossier": dossier_content,
        "decision": {"decision": review.decision, "date": str(review.date), "instance": review.instance or "",
                     "motive": review.motive or "", "conditions": review.conditions or "",
                     "members": review.members or "", "locked_by": review.env.user.name},
        "snapshot": snapshot,
    }


def _digest(content):
    return hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def _seal(env, content):
    secret = env["ir.config_parameter"].sudo().get_param("database.secret") or ""
    payload = json.dumps(content, sort_keys=True, ensure_ascii=False, default=str).encode()
    return hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
