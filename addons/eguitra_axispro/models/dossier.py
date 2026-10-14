"""Dossier de projet : évaluation par stage gate, score, éliminatoires, recommandation, écarts,
data room et échanges avec le porteur.

Score : chaque critère évalué vaut 1 (satisfait), 0,5 (partiel) ou 0 (non satisfait) ; « sans objet »
sort du calcul. Le score d'un domaine est la moyenne pondérée de ses critères évalués, sur 100 ; le
score global, la moyenne des domaines pondérée par leur poids. Recommandation : NO-GO si un critère
éliminatoire n'est pas satisfait ; GO si le score atteint le seuil GO sans critère critique non
satisfait ; CONDITIONNEL au-dessus du seuil conditionnel ; NO-GO sinon.
"""

from odoo import api, fields, models
from odoo.exceptions import UserError

from .policy import STATUS_VALUES

STATUSES = [
    ("not_assessed", "Non évalué"),
    ("met", "Satisfait"),
    ("partial", "Partiellement satisfait"),
    ("not_met", "Non satisfait"),
    ("na", "Sans objet"),
]
RECOMMENDATIONS = [("go", "GO"), ("conditional", "GO sous conditions"), ("no_go", "NO-GO"), ("pending", "À compléter")]


class AxisproDossier(models.Model):
    _name = "axispro.dossier"
    _description = "Dossier de projet AxisPro"
    _order = "id desc"

    name = fields.Char("Projet", required=True)
    reference = fields.Char("Référence", default="/", readonly=True, copy=False, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one(related="company_id.currency_id")
    policy_id = fields.Many2one("axispro.policy", "Politique appliquée", required=True, readonly=True)
    promoter_id = fields.Many2one("res.partner", "Promoteur", required=True)
    portal_user_ids = fields.Many2many("res.users", string="Accès du porteur au portail")
    consultant_id = fields.Many2one("res.users", "Consultant", default=lambda self: self.env.user)
    sector = fields.Char("Secteur")
    location = fields.Char("Localisation")
    capacity = fields.Char("Capacité")
    investment = fields.Monetary("Investissement prévu")
    financing_need = fields.Monetary("Besoin de financement")
    date_start = fields.Date("Démarrage prévu")
    description = fields.Text("Description du projet")
    hypotheses = fields.Text("Hypothèses de décision")
    current_gate_id = fields.Many2one("axispro.gate", "Gate courant")
    state = fields.Selection(
        [("open", "En cours"), ("on_hold", "Suspendu"), ("closed", "Clos")], default="open", required=True
    )
    decision = fields.Selection(RECOMMENDATIONS, "Dernière décision du comité", readonly=True)
    analytic_account_id = fields.Many2one("account.analytic.account", "Compte analytique", readonly=True)
    evaluation_ids = fields.One2many("axispro.evaluation", "dossier_id", "Évaluations")
    document_ids = fields.One2many("axispro.document", "dossier_id", "Data room")
    review_ids = fields.One2many("axispro.review", "dossier_id", "Revues de comité")
    message_ids = fields.One2many("axispro.message", "dossier_id", "Échanges")

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            company = self.env["res.company"].browse(vals.get("company_id") or self.env.company.id)
            if not vals.get("policy_id"):
                policy = self.env["axispro.policy"].active_policy(company)
                if not policy:
                    raise UserError("Aucune politique d'évaluation en vigueur : importez puis activez la grille.")
                vals["policy_id"] = policy.id
            if vals.get("reference", "/") == "/":
                vals["reference"] = self.env["ir.sequence"].next_by_code("axispro.dossier") or "/"
        records = super().create(vals_list)
        plan = self.env.ref("eguitra_base.analytic_plan_dossier")
        for dossier in records:
            dossier.current_gate_id = dossier.policy_id.gate_ids.sorted("sequence")[:1]
            dossier.analytic_account_id = self.env["account.analytic.account"].sudo().create({
                "name": f"{dossier.reference} {dossier.name}", "plan_id": plan.id,
                "company_id": dossier.company_id.id, "partner_id": dossier.promoter_id.id,
            })
            self.env["axispro.evaluation"].create([
                {"dossier_id": dossier.id, "criterion_id": c.id} for c in dossier.policy_id.criterion_ids
            ])
        return records

    # ─── Score et recommandation ──────────────────────────────────────────

    def scoring(self, gate=None):
        """Scores par domaine, score global, éliminatoires, critères critiques, recommandation.

        gate : limiter aux critères des gates jusqu'à celui-ci (évaluation à un gate donné).
        """
        self.ensure_one()
        policy = self.policy_id
        evaluations = self.evaluation_ids
        if gate:
            evaluations = evaluations.filtered(lambda e: e.criterion_id.gate_id.sequence <= gate.sequence)
        domains = []
        total_weight = total = 0.0
        for domain in policy.domain_ids:
            evals = evaluations.filtered(lambda e, d=domain: e.criterion_id.domain_id == d)
            scored = evals.filtered(lambda e: e.status in STATUS_VALUES)
            weight = sum(scored.mapped("criterion_id.weight"))
            score = (sum(STATUS_VALUES[e.status] * e.criterion_id.weight for e in scored) / weight * 100) if weight else None
            domains.append({
                "domain_id": domain.id, "code": domain.code, "name": domain.name, "weight": domain.weight,
                "score": score, "assessed": len(evals.filtered(lambda e: e.status != "not_assessed")),
                "criteria": len(evals),
            })
            if score is not None:
                total += score * domain.weight
                total_weight += domain.weight
        global_score = total / total_weight if total_weight else None
        knockouts = evaluations.filtered(lambda e: e.criterion_id.knockout and e.status == "not_met")
        critical = evaluations.filtered(lambda e: e.criterion_id.critical and e.status in ("not_met", "not_assessed"))
        assessed = len(evaluations.filtered(lambda e: e.status != "not_assessed"))
        if knockouts:
            recommendation = "no_go"
        elif global_score is None:
            recommendation = "pending"
        elif global_score >= policy.go_threshold and not critical:
            recommendation = "go"
        elif global_score >= policy.conditional_threshold:
            recommendation = "conditional"
        else:
            recommendation = "no_go"
        return {
            "global_score": global_score,
            "domains": domains,
            "knockouts": [{"code": e.criterion_id.code, "name": e.criterion_id.name} for e in knockouts],
            "critical_open": [{"code": e.criterion_id.code, "name": e.criterion_id.name} for e in critical],
            "assessed": assessed,
            "criteria": len(evaluations),
            "recommendation": recommendation,
            "thresholds": {"go": policy.go_threshold, "conditional": policy.conditional_threshold},
        }

    def gaps(self, limit=5):
        """Écarts prioritaires : poids du critère et du domaine, criticité, éliminatoire, niveau atteint."""
        self.ensure_one()
        rows = []
        for e in self.evaluation_ids.filtered(lambda e: e.status in ("not_met", "partial", "not_assessed")):
            c = e.criterion_id
            missing = 1.0 - STATUS_VALUES.get(e.status, 0.0)
            priority = c.weight * c.domain_id.weight * missing * (3 if c.knockout else 1) * (2 if c.critical else 1)
            rows.append({
                "criterion_id": c.id, "code": c.code, "name": c.name, "domain": c.domain_id.name,
                "gate": c.gate_id.code, "status": e.status, "knockout": c.knockout, "critical": c.critical,
                "priority": priority, "action": c.guidance or f"Compléter : {c.name}",
            })
        # Un éliminatoire non satisfait passe toujours en tête, puis l'ordre de priorité.
        return sorted(rows, key=lambda r: (not (r["knockout"] and r["status"] == "not_met"), -r["priority"]))[:limit]

    def documents_status(self):
        """Pièces standard attendues jusqu'au gate courant, avec la dernière version reçue."""
        self.ensure_one()
        gate_seq = self.current_gate_id.sequence if self.current_gate_id else 0
        result = []
        for doc_type in self.policy_id.document_type_ids:
            latest = self.document_ids.filtered(lambda d, t=doc_type: d.document_type_id == t).sorted("version")[-1:]
            due = (not doc_type.gate_id) or doc_type.gate_id.sequence <= gate_seq
            result.append({
                "document_type_id": doc_type.id, "code": doc_type.code, "name": doc_type.name,
                "category": doc_type.category or None, "required": doc_type.required, "due": due,
                "gate": doc_type.gate_id.code or None, "guidance": doc_type.guidance or None,
                "state": latest.state if latest else "missing", "version": latest.version if latest else 0,
                "document_id": latest.id if latest else None,
            })
        return result

    def action_advance_gate(self):
        """Passage au gate suivant : critères du gate évalués et aucun éliminatoire actif."""
        self.ensure_one()
        gate = self.current_gate_id
        pending = self.evaluation_ids.filtered(lambda e: e.criterion_id.gate_id == gate and e.status == "not_assessed")
        if pending:
            raise UserError(f"{len(pending)} critère(s) du gate {gate.code} restent à évaluer.")
        if self.scoring(gate)["knockouts"]:
            raise UserError("Un critère éliminatoire n'est pas satisfait : le dossier ne peut pas avancer.")
        following = self.policy_id.gate_ids.filtered(lambda g: g.sequence > gate.sequence).sorted("sequence")[:1]
        if not following:
            raise UserError("Le dossier est déjà au dernier gate.")
        self.current_gate_id = following
        return True


class AxisproEvaluation(models.Model):
    _name = "axispro.evaluation"
    _description = "Évaluation d'un critère"
    _order = "dossier_id, id"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True)
    criterion_id = fields.Many2one("axispro.criterion", required=True, ondelete="cascade")
    status = fields.Selection(STATUSES, default="not_assessed", required=True)
    comment = fields.Text("Commentaire")
    document_ids = fields.Many2many("axispro.document", string="Preuves")
    assessed_by = fields.Many2one("res.users", readonly=True)
    assessed_at = fields.Datetime(readonly=True)

    _unique = models.Constraint("unique(dossier_id, criterion_id)", "Un critère n'est évalué qu'une fois par dossier.")

    def write(self, vals):
        if "status" in vals:
            vals = dict(vals, assessed_by=self.env.user.id, assessed_at=fields.Datetime.now())
            if vals["status"] in ("met", "partial"):
                for evaluation in self:
                    criterion = evaluation.criterion_id
                    docs = vals.get("document_ids") or evaluation.document_ids
                    if criterion.evidence_required and not docs:
                        raise UserError(f"Le critère {criterion.code} exige une preuve jointe.")
        return super().write(vals)


class AxisproDocument(models.Model):
    _name = "axispro.document"
    _description = "Pièce de data room"
    _order = "dossier_id, document_type_id, version desc"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True)
    document_type_id = fields.Many2one("axispro.document.type", "Pièce standard")
    name = fields.Char("Intitulé", required=True)
    version = fields.Integer(default=1)
    attachment_id = fields.Many2one("ir.attachment", required=True, ondelete="restrict")
    state = fields.Selection(
        [("received", "Reçue"), ("validated", "Validée"), ("rejected", "À reprendre")], default="received", required=True
    )
    comment = fields.Text("Observation du cabinet")
    uploaded_by = fields.Many2one("res.users", default=lambda self: self.env.user, readonly=True)
    uploaded_at = fields.Datetime(default=fields.Datetime.now, readonly=True)
    portal_visible = fields.Boolean("Visible du porteur", default=True)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("document_type_id"):
                previous = self.sudo().search([
                    ("dossier_id", "=", vals["dossier_id"]), ("document_type_id", "=", vals["document_type_id"]),
                ], order="version desc", limit=1)
                vals["version"] = previous.version + 1 if previous else 1
        return super().create(vals_list)


class AxisproMessage(models.Model):
    _name = "axispro.message"
    _description = "Échange sur un dossier"
    _order = "date asc, id asc"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True)
    author_id = fields.Many2one("res.users", required=True, default=lambda self: self.env.user)
    body = fields.Text(required=True)
    date = fields.Datetime(default=fields.Datetime.now, required=True)
    internal = fields.Boolean("Note interne au cabinet")
