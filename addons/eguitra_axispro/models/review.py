"""Revues de comité : instantané du score, décision, conditions, verrouillage, comparaison."""

from odoo import fields, models
from odoo.exceptions import UserError

from .dossier import RECOMMENDATIONS


class AxisproReview(models.Model):
    _name = "axispro.review"
    _description = "Revue de comité"
    _order = "dossier_id, date desc, id desc"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True)
    date = fields.Date(required=True, default=fields.Date.context_today)
    gate_id = fields.Many2one("axispro.gate", "Gate examiné")
    members = fields.Text("Membres du comité")
    snapshot = fields.Json("Instantané de l'évaluation", readonly=True)
    recommendation = fields.Selection(RECOMMENDATIONS, "Recommandation calculée", readonly=True)
    decision = fields.Selection(RECOMMENDATIONS + [("postponed", "Ajourné")], "Décision", required=True)
    conditions = fields.Text("Conditions")
    minutes = fields.Text("Compte rendu")
    policy_version = fields.Integer("Version de la politique", readonly=True)
    state = fields.Selection([("draft", "Brouillon"), ("locked", "Verrouillée")], default="draft", required=True)
    locked_by = fields.Many2one("res.users", readonly=True)
    locked_at = fields.Datetime(readonly=True)

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
            review.write({"state": "locked", "locked_by": self.env.user.id, "locked_at": fields.Datetime.now()})
            review.dossier_id.decision = review.decision if review.decision != "postponed" else review.dossier_id.decision
            # Les conditions du comité deviennent des actions suivies du porteur.
            self.env["axispro.action"].from_conditions(review)
        return True

    def compare(self, other):
        """Écart de score global et par domaine entre deux revues (self : la plus récente)."""
        self.ensure_one()
        a, b = other.snapshot or {}, self.snapshot or {}
        by_code = {d["code"]: d for d in a.get("domains", [])}
        domains = []
        for d in b.get("domains", []):
            before = by_code.get(d["code"], {}).get("score")
            domains.append({"code": d["code"], "name": d["name"], "before": before, "after": d["score"],
                            "delta": (d["score"] - before) if d["score"] is not None and before is not None else None})
        fin_a, fin_b = a.get("financial") or {}, b.get("financial") or {}
        financial = [
            {"key": key, "before": fin_a.get(key), "after": fin_b.get(key)}
            for key in ("npv", "irr_project", "irr_equity", "dscr_min", "payback", "equity_share")
            if fin_a.get(key) is not None or fin_b.get(key) is not None
        ]
        return {
            "financial": financial,
            "from": {"id": other.id, "date": other.date, "decision": other.decision, "score": a.get("global_score")},
            "to": {"id": self.id, "date": self.date, "decision": self.decision, "score": b.get("global_score")},
            "domains": domains,
            "knockouts_before": [k["code"] for k in a.get("knockouts", [])],
            "knockouts_after": [k["code"] for k in b.get("knockouts", [])],
        }
