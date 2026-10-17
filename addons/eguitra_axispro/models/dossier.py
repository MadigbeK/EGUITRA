"""Dossier de projet : évaluation selon la méthode MB AxisPro (scoring.py), stage gates, écarts,
data room, hypothèses de décision, révisions verrouillées et journal.

Statuts et points : disponible et exploitable (1), incomplet / à actualiser (0,5), non disponible
(0), non applicable (exclu ou 1 selon la politique) ; un critère non encore évalué compte comme non
disponible. Trois scores (Project Readiness, APD Readiness, Bankability), score par domaine,
knock-outs, classification en cinq classes, règles de passage des huit gates et recommandation :
voir scoring.py. Un dossier dont la décision de comité est verrouillée est figé jusqu'à l'ouverture
d'une nouvelle révision.
"""

from odoo import api, fields, models
from odoo.exceptions import UserError

from .. import scoring as method

STATUSES = [
    ("not_assessed", "Non évalué"),
    ("met", "Disponible et exploitable"),
    ("partial", "Incomplet / à actualiser"),
    ("not_met", "Non disponible"),
    ("na", "Non applicable"),
]
RECOMMENDATIONS = [
    ("bankable", "BANKABLE CANDIDATE"),
    ("apd_ready", "APD READY"),
    ("go", "GO"),
    ("conditional", "CONDITIONAL GO"),
    ("hold", "HOLD"),
    ("no_go", "NO-GO"),
    ("pending", "À compléter"),
]
COMMITTEE_DECISIONS = [
    ("go", "GO"), ("conditional", "CONDITIONAL GO"), ("hold", "HOLD"), ("no_go", "NO-GO"), ("postponed", "Ajourné"),
]
YES_NO = [("yes", "Oui"), ("no", "Non")]
# Champs figés par une décision de comité verrouillée.
FROZEN_FIELDS = {
    "name", "promoter_id", "sector", "location", "capacity", "investment", "financing_need", "currency_id",
    "date_start", "date_evaluation", "description", "hypotheses", "dscr_manual", "irr_manual", "dd_red_flag",
    "dataroom_open", "lenders_agreement", "cp_lifted", "financing_signed", "consultant_id",
}
HYPOTHESES = ("dd_red_flag", "dataroom_open", "lenders_agreement", "cp_lifted", "financing_signed")


class AxisproDossier(models.Model):
    _name = "axispro.dossier"
    _description = "Dossier de projet AxisPro"
    _order = "id desc"

    name = fields.Char("Projet", required=True)
    reference = fields.Char("Référence", default="/", readonly=True, copy=False, index=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    currency_id = fields.Many2one("res.currency", "Devise du dossier", required=True,
                                  default=lambda self: self.env.company.currency_id)
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
    date_evaluation = fields.Date("Date d'évaluation")
    description = fields.Text("Description du projet")
    hypotheses = fields.Text("Commentaires et hypothèses de décision")
    # Hypothèses de décision exigées par les gates 4 à 7 (DSCR et TRI : saisis seulement en l'absence
    # de modèle financier, qui les calcule).
    dscr_manual = fields.Float("DSCR minimum déclaré")
    irr_manual = fields.Float("TRI projet déclaré (%)")
    dd_red_flag = fields.Selection(YES_NO, "Red flag bloquant en due diligence")
    dataroom_open = fields.Selection(YES_NO, "Data room constituée et ouverte")
    lenders_agreement = fields.Selection(YES_NO, "Accord de principe des bailleurs")
    cp_lifted = fields.Selection(YES_NO, "Conditions précédentes levées")
    financing_signed = fields.Selection(YES_NO, "Documentation de financement signée")
    current_gate_id = fields.Many2one("axispro.gate", "Gate courant")
    state = fields.Selection(
        [("open", "En cours"), ("on_hold", "Suspendu"), ("closed", "Clos")], default="open", required=True
    )
    decision = fields.Selection(COMMITTEE_DECISIONS, "Dernière décision du comité", readonly=True)
    revision = fields.Integer("Révision", default=1, readonly=True, copy=False)
    locked_review_id = fields.Many2one("axispro.review", "Décision verrouillée en vigueur", readonly=True, copy=False)
    analytic_account_id = fields.Many2one("account.analytic.account", "Compte analytique", readonly=True)
    evaluation_ids = fields.One2many("axispro.evaluation", "dossier_id", "Évaluations")
    document_ids = fields.One2many("axispro.document", "dossier_id", "Data room")
    review_ids = fields.One2many("axispro.review", "dossier_id", "Revues de comité")
    message_ids = fields.One2many("axispro.message", "dossier_id", "Échanges")
    journal_ids = fields.One2many("axispro.journal", "dossier_id", "Journal")

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
            vals.setdefault("currency_id", company.currency_id.id)
            vals.setdefault("date_evaluation", fields.Date.context_today(self))
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

    def write(self, vals):
        if FROZEN_FIELDS & set(vals) and not self.env.context.get("axispro_unlocked"):
            self._check_unlocked()
        return super().write(vals)

    def _check_unlocked(self):
        for dossier in self:
            if dossier.locked_review_id:
                raise UserError(f"Dossier {dossier.reference} verrouillé par la décision du comité (révision "
                                f"{dossier.revision}) : ouvrez une nouvelle révision pour le modifier.")

    def log(self, kind, note=None, criterion=None, before=None, after=None):
        """Inscription au journal du dossier (auteur authentifié, horodatage du serveur)."""
        values = [{"dossier_id": d.id, "kind": kind, "note": note or False, "criterion_id": criterion.id if criterion else False,
                   "before": before or False, "after": after or False} for d in self]
        return self.env["axispro.journal"].sudo().create(values)

    # ─── Méthode d'évaluation ─────────────────────────────────────────────

    def _scoring_inputs(self):
        self.ensure_one()
        policy = self.policy_id
        today = fields.Date.context_today(self)
        gates = policy.gate_ids.sorted("sequence")
        index = {g.id: i for i, g in enumerate(gates)}
        criteria = [{
            "id": c.id, "code": c.code, "name": c.name, "domain_id": c.domain_id.id,
            "gate_index": index.get(c.gate_id.id, 0), "gate_code": c.gate_id.code, "weight": c.weight,
            "critical": c.critical, "knockout": c.knockout, "evidence": c.evidence_required,
            "requirement": c.requirement_type, "bankability": c.bankability,
        } for c in policy.criterion_ids.sorted("sequence")]
        evaluations = {}
        for e in self.evaluation_ids:
            proofs = e.document_ids.filtered(lambda d: d.state != "rejected")
            valid = proofs.filtered(lambda d: not d.validity_date or d.validity_date >= today)
            evaluations[e.criterion_id.id] = {
                "status": e.status, "has_proof": bool(proofs),
                "expired_on": max(proofs.mapped("validity_date")) if proofs and not valid else None,
            }
        latest = {}
        for doc in self.document_ids.sorted("version"):
            if doc.document_type_id:
                latest[doc.document_type_id.id] = doc
        documents = [{
            "id": t.id, "code": t.code, "name": t.name, "category": t.category or None,
            "file_state": latest[t.id].state if t.id in latest else "missing", "criterion_ids": t.criterion_ids.ids,
        } for t in policy.document_type_ids]
        domains = [{"id": d.id, "code": d.code, "name": d.name, "weight": d.weight} for d in policy.domain_ids]
        gate_rows = [{
            "id": g.id, "code": g.code, "name": g.name, "index": i, "rule": g.rule_code,
            "hold": g.threshold_hold or None, "go": g.threshold_go or None, "domain_ids": g.domain_ids.ids,
            "scope": g.score_scope, "entry_requirements": g.entry_requirements or g.description or None,
            "deliverables": g.deliverables or None, "exit_criteria": g.exit_criteria or None,
        } for i, g in enumerate(gates)]
        financial = self.financial_indicators() or {}
        dscr = financial.get("dscr_min")
        if dscr is None and self.dscr_manual:
            dscr = self.dscr_manual
        context = {
            "fiche": {"name": self.name, "promoter": self.promoter_id.name, "sector": self.sector, "location": self.location},
            "hyp": dict({h: self[h] or None for h in HYPOTHESES}, dscr=dscr),
            "investment": self.investment, "capex_criterion_id": policy.capex_criterion_id.id,
        }
        return policy.scoring_settings(), criteria, evaluations, domains, documents, gate_rows, context, financial

    def evaluate(self):
        """Résultat complet de la méthode d'évaluation, enrichi des contrôles propres à la plateforme."""
        self.ensure_one()
        settings, criteria, evaluations, domains, documents, gates, context, financial = self._scoring_inputs()
        result = method.compute(settings, criteria, evaluations, domains, documents, gates, context)
        result["financial"] = financial
        result["anomalies"] = result["anomalies"] + self._extra_anomalies(result, financial)
        return result

    def _extra_anomalies(self, result, financial):
        notes = []
        plan = self.plan_ids[:1]
        if financial and plan:
            capex = financial.get("capex_total") or 0
            if self.investment and capex and abs(capex - self.investment) > 0.10 * self.investment:
                notes.append(f"Investissement de la fiche ({self.investment:,.0f}) et investissements du modèle financier "
                             f"({capex:,.0f}) diffèrent de plus de 10 %.".replace(",", " "))
            external = (financial.get("funding") or {}).get("loan", 0) + (financial.get("funding") or {}).get("grant", 0)
            if self.financing_need and external and abs(external - self.financing_need) > 0.10 * self.financing_need:
                notes.append(f"Besoin de financement de la fiche ({self.financing_need:,.0f}) et financements externes du "
                             f"modèle ({external:,.0f}) diffèrent de plus de 10 %.".replace(",", " "))
            for e in self.evaluation_ids.filtered(lambda e: e.criterion_id.indicator and e.status != "not_assessed"):
                suggestion = e.criterion_id.suggestion(financial)
                if suggestion and suggestion.get("status") and suggestion["status"] != e.status:
                    notes.append(f"{e.criterion_id.code} : statut saisi différent de celui que suggère le modèle "
                                 f"financier ({dict(STATUSES)[suggestion['status']]}).")
        for e in self.evaluation_ids.filtered(lambda e: e.status == "met" and e.document_ids):
            if all(d.state == "rejected" for d in e.document_ids):
                notes.append(f"{e.criterion_id.code} : déclaré disponible alors que toutes ses preuves sont à reprendre.")
        if self.decision in ("go", "conditional") and result["knockouts"]:
            notes.append("Décision favorable du comité alors qu'un knock-out est actif.")
        return notes

    def scoring(self, result=None):
        """Synthèse de l'évaluation pour l'API et les instantanés de comité (sans le détail des lignes)."""
        self.ensure_one()
        r = result or self.evaluate()
        gate_by_index = {g["index"]: g for g in r["gates"]}

        def brief(x):
            return {"code": x["code"], "name": x["name"], "domain": x["domain"].get("name"),
                    "gate": gate_by_index.get(x["gate_index"], {}).get("code")}

        policy = self.policy_id
        reached = self.current_gate_id
        index = {g.id: i for i, g in enumerate(policy.gate_ids.sorted("sequence"))}
        current = index.get(reached.id, 0) if reached else 0
        pending = sum(1 for x in r["lines"] if x["entered"] == "not_assessed" and x["gate_index"] <= current)
        # Recommandation « à compléter » tant que les critères des gates atteints ne sont pas tous
        # évalués : la méthode compte un critère non évalué comme non disponible, ce qui donnerait un
        # NO-GO en cours de saisie. Les scores, eux, restent ceux de la méthode.
        if not r["assessed"]:
            recommendation, detail = "pending", "Évaluation à commencer : aucun critère n'est encore renseigné."
        elif pending:
            recommendation, detail = "pending", (f"{pending} critère(s) des gates atteints à évaluer avant la "
                                                 "recommandation.")
        else:
            recommendation, detail = r["recommendation"], r["recommendation_detail"]
        return {
            "global_score": r["readiness"],
            "readiness": r["readiness"],
            "apd": r["apd"],
            "bankability": r["bankability"],
            "completeness": r["completeness"],
            "dataroom_completeness": r["dataroom_completeness"],
            "classification": r["classification"],
            "recommendation": recommendation,
            "recommendation_detail": detail,
            "method_recommendation": r["recommendation"],
            "domains": r["domains"],
            "knockouts": [brief(x) for x in r["knockouts"]],
            "knockouts_pending": sum(1 for x in r["knockouts"] if x["entered"] == "not_assessed"),
            "critical_open": [brief(x) for x in r["critical_missing"]],
            "critical_missing_excl_ko": len(r["critical_missing_excl_ko"]),
            "requalified": [dict(brief(x), entered=x["entered"], retained=x["status"], alerts=x["alerts"])
                            for x in r["requalified"]],
            "gates": r["gates"],
            "next_gate": r["next_gate"],
            "anomalies": r["anomalies"],
            "proofs": r["proofs"],
            "gaps_open": len(r["gaps"]),
            "documents_missing": sum(1 for d in r["dataroom"] if not d["available"]),
            "pending_in_scope": pending,
            "assessed": r["assessed"],
            "criteria": r["criteria"],
            "policy": {k: r["policy"][k] for k in ("weighting", "ko_partial_blocks", "evidence_check", "exclude_na",
                                                   "expiry_check")},
            "thresholds": {"bankable": policy.threshold_bankable, "go": policy.go_threshold,
                           "conditional": policy.conditional_threshold, "hold": policy.threshold_hold,
                           "dscr": policy.dscr_target},
        }

    def gaps(self, limit=5, result=None):
        """Écarts prioritaires (formule du prototype), avec livrable, responsable, échéance et preuve."""
        self.ensure_one()
        r = result or self.evaluate()
        evaluations = {e.criterion_id.id: e for e in self.evaluation_ids}
        criteria = {c.id: c for c in self.policy_id.criterion_ids}
        gate_by_index = {g["index"]: g for g in r["gates"]}
        rows = []
        for g in r["gaps"][:limit] if limit else r["gaps"]:
            e = evaluations.get(g["id"])
            c = criteria[g["id"]]
            rows.append({
                "criterion_id": g["id"], "code": g["code"], "name": g["name"], "domain": g["domain"].get("name"),
                "gate": gate_by_index.get(g["gate_index"], {}).get("code"), "status": g["status"], "entered": g["entered"],
                "knockout": bool(g.get("knockout")), "critical": bool(g.get("critical")),
                "blocking": g.get("requirement") == "blocking", "priority": round(g["priority"], 2),
                "action": (e and e.deliverable) or c.default_deliverable(),
                "responsible": (e and e.responsible) or None, "due_date": (e and e.due_date) or None,
                "has_proof": g["has_proof"], "evaluation_id": e.id if e else None,
            })
        return rows

    def documents_status(self, result=None):
        """Pièces standard : attendues jusqu'au gate courant, dernière version, disponibilité (fichier déposé
        ou preuve d'un critère rattaché), origine et critères justifiés."""
        self.ensure_one()
        r = result or self.evaluate()
        available = {d["id"]: d for d in r["dataroom"]}
        gate_seq = self.current_gate_id.sequence if self.current_gate_id else 0
        out = []
        for doc_type in self.policy_id.document_type_ids:
            latest = self.document_ids.filtered(lambda d, t=doc_type: d.document_type_id == t).sorted("version")[-1:]
            due = (not doc_type.gate_id) or doc_type.gate_id.sequence <= gate_seq
            info = available.get(doc_type.id, {})
            out.append({
                "document_type_id": doc_type.id, "code": doc_type.code, "name": doc_type.name,
                "category": doc_type.category or None, "required": doc_type.required, "due": due,
                "gate": doc_type.gate_id.code or None, "guidance": doc_type.guidance or None,
                "state": latest.state if latest else "missing", "version": latest.version if latest else 0,
                "document_id": latest.id if latest else None, "validity_date": latest.validity_date if latest else None,
                "available": bool(info.get("available")), "origin": info.get("origin"),
                "criteria": info.get("criteria", []),
            })
        return out

    def action_advance_gate(self, force_reason=None):
        """Passage au gate suivant : décision GO ou CONDITIONAL GO du gate courant ; sinon refus motivé,
        sauf passage forcé par le cabinet avec un motif inscrit au journal."""
        self.ensure_one()
        self._check_unlocked()
        gates = self.policy_id.gate_ids.sorted("sequence")
        gate = self.current_gate_id or gates[:1]
        following = gates.filtered(lambda g: g.sequence > gate.sequence)[:1]
        if not following:
            raise UserError("Le dossier est déjà au dernier gate.")
        decision = next((g for g in self.evaluate()["gates"] if g["gate_id"] == gate.id), None)
        if decision and decision["decision"] not in ("go", "conditional"):
            if not force_reason:
                raise UserError(f"Gate {gate.code} : {method.DECISIONS[decision['decision']]}. " + " ".join(decision["motifs"]))
            self.log("gate", note=f"Passage forcé de {gate.code} à {following.code} ({method.DECISIONS[decision['decision']]}) : "
                                  f"{force_reason}")
        else:
            self.log("gate", note=f"Passage de {gate.code} à {following.code}.")
        self.current_gate_id = following
        return True

    def action_new_revision(self):
        """Nouvelle révision après une décision verrouillée : le dossier redevient modifiable."""
        self.ensure_one()
        if not self.locked_review_id:
            raise UserError("Aucune décision verrouillée : le dossier est déjà modifiable.")
        previous = self.locked_review_id
        self.with_context(axispro_unlocked=True).write({"revision": self.revision + 1, "locked_review_id": False})
        self.log("revision", note=f"Révision {self.revision} ouverte après la décision du {previous.date:%d/%m/%Y} "
                                  f"({method.DECISIONS.get(previous.decision, previous.decision)}).")
        return True


class AxisproEvaluation(models.Model):
    _name = "axispro.evaluation"
    _description = "Évaluation d'un critère"
    _order = "dossier_id, id"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True)
    criterion_id = fields.Many2one("axispro.criterion", required=True, ondelete="cascade")
    status = fields.Selection(STATUSES, default="not_assessed", required=True)
    comment = fields.Text("Observation")
    document_ids = fields.Many2many("axispro.document", string="Preuves")
    deliverable = fields.Char("Document à produire")
    responsible = fields.Char("Responsable")
    due_date = fields.Date("Échéance")
    assessed_by = fields.Many2one("res.users", readonly=True)
    assessed_at = fields.Datetime(readonly=True)

    _unique = models.Constraint("unique(dossier_id, criterion_id)", "Un critère n'est évalué qu'une fois par dossier.")

    def write(self, vals):
        if not self.env.context.get("axispro_unlocked"):
            self.dossier_id._check_unlocked()
        if "status" in vals:
            labels = dict(STATUSES)
            changed = self.filtered(lambda e: e.status != vals["status"])
            for e in changed:
                e.dossier_id.log("status", criterion=e.criterion_id, before=labels[e.status], after=labels[vals["status"]])
            vals = dict(vals, assessed_by=self.env.user.id, assessed_at=fields.Datetime.now())
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
    validity_date = fields.Date("Valable jusqu'au", help="Au-delà, une preuve est comptée comme incomplète.")
    after_lock = fields.Boolean("Reçue après la décision verrouillée", readonly=True)
    comment = fields.Text("Observation du cabinet")
    uploaded_by = fields.Many2one("res.users", default=lambda self: self.env.user, readonly=True)
    uploaded_at = fields.Datetime(default=fields.Datetime.now, readonly=True)
    portal_visible = fields.Boolean("Visible du porteur", default=True)
    evaluation_ids = fields.Many2many("axispro.evaluation", "axispro_document_axispro_evaluation_rel",
                                      "axispro_document_id", "axispro_evaluation_id", "Critères justifiés")

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("document_type_id"):
                previous = self.sudo().search([
                    ("dossier_id", "=", vals["dossier_id"]), ("document_type_id", "=", vals["document_type_id"]),
                ], order="version desc", limit=1)
                vals["version"] = previous.version + 1 if previous else 1
            dossier = self.env["axispro.dossier"].sudo().browse(vals["dossier_id"])
            if dossier.locked_review_id:
                vals["after_lock"] = True
        records = super().create(vals_list)
        for doc in records:
            doc.dossier_id.log("document", note=f"Pièce déposée : {doc.name} (version {doc.version})"
                                                + (", après la décision verrouillée" if doc.after_lock else "") + ".")
        return records


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


class AxisproJournal(models.Model):
    _name = "axispro.journal"
    _description = "Journal d'un dossier AxisPro"
    _order = "date desc, id desc"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True)
    date = fields.Datetime(default=fields.Datetime.now, required=True, readonly=True)
    user_id = fields.Many2one("res.users", "Par", default=lambda self: self.env.user, required=True, readonly=True)
    kind = fields.Selection(
        [("status", "Statut d'un critère"), ("document", "Data room"), ("gate", "Stage gate"),
         ("decision", "Décision de comité"), ("revision", "Révision"), ("import", "Import")],
        required=True, readonly=True,
    )
    criterion_id = fields.Many2one("axispro.criterion", "Critère", ondelete="set null", readonly=True)
    before = fields.Char("Avant", readonly=True)
    after = fields.Char("Après", readonly=True)
    note = fields.Text(readonly=True)
