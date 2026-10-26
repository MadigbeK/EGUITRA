"""Dossier de projet : évaluation selon la méthode MB AxisPro Consulting (scoring.py), stage gates, écarts,
data room, hypothèses de décision, révisions verrouillées et journal.

Statuts et points : disponible et exploitable (1), incomplet / à actualiser (0,5), non disponible
(0), non applicable (exclu ou 1 selon la politique) ; un critère non encore évalué compte comme non
disponible. Trois scores (Project Readiness, APD Readiness, Bankability), score par domaine,
knock-outs, classification en cinq classes, règles de passage des huit gates et recommandation :
voir scoring.py. Un dossier dont la décision de comité est verrouillée est figé jusqu'à l'ouverture
d'une nouvelle révision.

Quatre yeux (décision du gérant) : une décision du comité engage au moins deux personnes. Le verrou
de la décision et le passage forcé d'un gate sont refusés quand aucun autre compte que celui qui
agit n'a contribué à la révision en cours (évaluation des critères, fiche et hypothèses, modèle
financier, pièces de la data room) ; celui qui a verrouillé la décision n'ouvre pas la révision qui
la défait. Décision du gérant (22 octobre 2026, appliquée le 26) : sceller la décision du comité,
forcer le passage d'un gate et ouvrir une nouvelle révision sont réservés aux associés du cabinet et
à la direction ouverte à la société du cabinet, en plus des quatre yeux ; le consultant garde le reste.
Un consultant n'écrit l'évaluation que des
compartiments qui lui sont confiés ; un compartiment sans consultant reste ouvert à tout le cabinet
et le responsable du dossier évalue tous les compartiments. La lecture reste ouverte à toute
l'équipe.
"""

from odoo import SUPERUSER_ID, Command, api, fields, models
from odoo.exceptions import AccessError, UserError

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
# Ce qui entre dans le score ou le contenu scellé : qui l'écrit rejoint les auteurs de la révision en
# cours (decision_inputs_by). Fiche et hypothèses du dossier (sauf le consultant responsable : ni score
# ni sceau) ; pièce de la data room (nom, version, état, validité, fichier, rattachements) ; évaluation
# d'un critère, que seuls les consultants admis sur son compartiment écrivent.
DECISION_FIELDS = FROZEN_FIELDS - {"consultant_id"}
DOCUMENT_INPUT_FIELDS = {"name", "document_type_id", "attachment_id", "state", "validity_date", "evaluation_ids"}
EVALUATION_FIELDS = {"status", "comment", "deliverable", "responsible", "due_date", "document_ids"}


def _system(env):
    """Compte système (installation, migrations, scripts, jeux d'essai) : hors des contrôles de
    personne (quatre yeux, compartiments), qui portent sur les comptes du cabinet. Un appel de
    l'API s'exécute toujours sous l'identité de l'utilisateur, même en sudo()."""
    return env.uid == SUPERUSER_ID


# Profils qui scellent une décision, forcent un gate et rouvrent une révision (décision du gérant).
DECISION_GROUPS = ("eguitra_base.group_profile_associe", "eguitra_base.group_profile_direction")


def _input_author(env):
    """Compte à inscrire parmi les auteurs de la révision : compte interne hors système (un
    porteur qui dépose une pièce par le portail ne verrouille jamais un comité)."""
    return not _system(env) and not env.user.share


def _montant(value, devise):
    """Montant entier, milliers groupés par une espace insécable, suivi de la devise du dossier."""
    return f"{value:,.0f}".replace(",", " ") + (f" {devise}" if devise else "")


def _lead_label(dossier):
    """« le responsable du dossier (Nom) » pour un message de refus ; sans nom si le dossier n'a pas
    de responsable désigné (dossier créé par le compte système)."""
    lead = dossier.sudo().consultant_id.filtered(lambda u: u.id != SUPERUSER_ID)
    return f"le responsable du dossier ({lead.name})" if lead else "le responsable du dossier"


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
    assignment_ids = fields.One2many("axispro.assignment", "dossier_id", "Consultants par compartiment")
    decision_inputs_by = fields.Many2many(
        "res.users", "axispro_dossier_decision_input_rel", "dossier_id", "user_id",
        "Auteurs de la révision en cours", readonly=True, copy=False,
        help="Comptes du cabinet qui ont, depuis l'ouverture de la révision, évalué un critère, créé ou modifié "
             "la fiche et les hypothèses du dossier, le modèle financier ou les pièces de la data room (quatre "
             "yeux). Remis à zéro à chaque nouvelle révision.")

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
        records._note_decision_input()
        return records

    def write(self, vals):
        if FROZEN_FIELDS & set(vals) and not self.env.context.get("axispro_unlocked"):
            self._check_unlocked()
        if DECISION_FIELDS & set(vals) and _input_author(self.env):
            vals = dict(vals, decision_inputs_by=[Command.link(self.env.uid)])
        before = {d.id: d.state for d in self} if "state" in vals else {}
        result = super().write(vals)
        labels = dict(self._fields["state"].selection)
        for dossier in self.filtered(lambda d: d.id in before and before[d.id] != d.state):
            dossier.log("state", before=labels[before[dossier.id]], after=labels[dossier.state])
        return result

    def _note_decision_input(self):
        """Inscrit l'utilisateur parmi les auteurs de la révision en cours (évaluation des critères,
        fiche et hypothèses, modèle financier, pièces de la data room) : quatre yeux."""
        if not _input_author(self.env):
            return
        uid = self.env.uid
        todo = self.sudo().filtered(lambda d: uid not in d.decision_inputs_by.ids)
        if todo:
            todo.write({"decision_inputs_by": [Command.link(uid)]})

    def _check_unlocked(self):
        """Refus d'écrire ce que la décision fige (évaluation, fiche, hypothèses, modèle financier, pièces
        antérieures) : dossier verrouillé par une décision du comité, ou dossier clos (il se rouvre
        d'abord)."""
        for dossier in self:
            if dossier.locked_review_id:
                raise UserError(f"Dossier {dossier.reference} verrouillé par la décision du comité (révision "
                                f"{dossier.revision}) : ouvrez une nouvelle révision pour le modifier.")
            dossier._check_open()

    def _check_open(self):
        """Un dossier clos se consulte ; il ne s'évalue plus, ne passe plus de gate et ne reçoit plus de
        revue de comité tant qu'il n'est pas rouvert."""
        for dossier in self:
            if dossier.state == "closed":
                raise UserError(f"Dossier {dossier.reference} clos : rouvrez-le (état « En cours ») pour le modifier.")

    def change_lead(self, user):
        """Nouveau responsable du dossier, choisi par le responsable en place (tout le cabinet si le
        dossier n'en a pas), inscrit au journal ; figé comme la fiche par une décision verrouillée."""
        self.ensure_one()
        lead = self.sudo().consultant_id.filtered(lambda u: u.id != SUPERUSER_ID)
        if lead and lead != self.env.user and not _system(self.env):
            raise AccessError(f"Seul {_lead_label(self)} confie le dossier à un autre responsable.")
        if user == lead:
            return True
        self.write({"consultant_id": user.id})
        self.log("assignment", note="Responsable du dossier", before=lead.name or "Aucun", after=user.name)
        return True

    def evaluators(self):
        """Comptes auteurs de la révision en cours (decision_inputs_by) : ceux qui, depuis son
        ouverture, ont évalué un critère, créé ou modifié la fiche et les hypothèses, le modèle
        financier ou les pièces de la data room. Compte système et porteurs exclus."""
        self.ensure_one()
        authors = self.sudo().decision_inputs_by
        return authors.filtered(lambda u: u.id != SUPERUSER_ID and not u.share).with_env(self.env)

    def _check_four_eyes(self, action):
        """Quatre yeux : une décision du comité engage au moins deux personnes. `action` (verrouiller
        la décision, forcer un gate) est refusée quand aucun autre compte que celui qui agit ne figure
        parmi les auteurs de la révision en cours : seul auteur, ou révision sans autre contribution."""
        for dossier in self:
            if _system(dossier.env):
                continue
            me = dossier.env.user
            authors = dossier.evaluators()
            if authors - me:
                continue
            situation = (f"vous êtes le seul auteur de la révision {dossier.revision} du dossier {dossier.reference}"
                         if me in authors else
                         f"aucun autre consultant n'a contribué à la révision {dossier.revision} du dossier "
                         f"{dossier.reference}")
            raise AccessError(
                f"Principe des quatre yeux : une décision du comité engage au moins deux personnes. Or {situation} "
                "(évaluation des critères, fiche et hypothèses, modèle financier, pièces) : vous ne pouvez donc "
                f"pas {action} seul. Un autre consultant du cabinet doit contribuer à cette révision ou s'en charger."
            )

    def _check_decision_right(self, action):
        """Sceller la décision du comité, forcer le passage d'un gate, ouvrir une nouvelle révision :
        réservé à un associé du cabinet ou à la direction ouverte à la société du dossier (refus 403),
        avant les quatre yeux, qui s'appliquent toujours. Compte système hors contrôle."""
        for dossier in self:
            if _system(dossier.env):
                continue
            user = dossier.env.user
            associe = user.has_group(DECISION_GROUPS[0])
            direction = user.has_group(DECISION_GROUPS[1]) and dossier.company_id in user.sudo().company_ids
            if not (associe or direction):
                raise AccessError(
                    f"Réservé à un associé du cabinet ou à la direction : vous ne pouvez pas {action} "
                    f"(dossier {dossier.reference}). Demandez-le à un associé de MB AxisPro Consulting."
                )

    def _check_consultant(self, action):
        """Ce qui reste au consultant (passage d'un gate selon la règle) : profil cabinet (refus 403)."""
        for dossier in self:
            if not _system(dossier.env) and not dossier.env.user.has_group("eguitra_base.group_profile_cabinet"):
                raise AccessError(f"Réservé au cabinet : vous ne pouvez pas {action} (dossier {dossier.reference}).")

    def _evaluation_refusal(self, compartment, user=None):
        """Motif du refus d'écrire l'évaluation d'un critère de `compartment` pour `user` (par défaut
        l'utilisateur), ou None si le compte peut l'écrire. Un consultant n'évalue que les compartiments
        qui lui sont confiés ; un compartiment sans consultant, ou un critère hors compartiment, reste
        ouvert à tout le cabinet ; le responsable du dossier (consultant_id) évalue tous les
        compartiments. La lecture n'est pas concernée."""
        self.ensure_one()
        user = user or self.env.user
        if not compartment or user.id == SUPERUSER_ID:
            return None
        dossier = self.sudo()
        owner = dossier.assignment_ids.filtered(lambda a: a.compartment_id == compartment).user_id
        if not owner or user in (owner | dossier.consultant_id):
            return None
        return (f"compartiment {compartment.code} {compartment.name} confié à {owner.name} ; seuls ce consultant "
                f"et {_lead_label(dossier)} en écrivent l'évaluation.")

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
                "study": bool(e.deliverable),
            }
        latest = {}
        for doc in self.document_ids.sorted("version"):
            if doc.document_type_id:
                latest[doc.document_type_id.id] = doc
        documents = [{
            "id": t.id, "code": t.code, "name": t.name, "category": t.category or None,
            "file_state": latest[t.id].state if t.id in latest else "missing", "criterion_ids": t.criterion_ids.ids,
        } for t in policy.document_type_ids]
        domains = [{"id": d.id, "code": d.code, "name": d.name, "weight": d.weight,
                    "compartment_id": d.compartment_id.id or None, "compartment_code": d.compartment_id.code or None,
                    "compartment_name": d.compartment_id.name or None,
                    "compartment_sequence": d.compartment_id.sequence if d.compartment_id else 0}
                   for d in policy.domain_ids]
        gate_rows = [{
            "id": g.id, "code": g.code, "name": g.name, "index": i, "rule": g.rule_code,
            "min_completeness": g.min_completeness or None,
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
            # Gate courant : les knock-outs encore à évaluer des gates non atteints ne sont pas actifs, et
            # le prochain gate se cherche à partir de lui (scoring.compute).
            "current_gate_index": index.get(self.current_gate_id.id, 0) if self.current_gate_id else 0,
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
        devise = self.currency_id.name or ""
        if financial and plan:
            capex = financial.get("capex_total") or 0
            if self.investment and capex and abs(capex - self.investment) > 0.10 * self.investment:
                notes.append(f"Investissement de la fiche ({_montant(self.investment, devise)}) et investissements du "
                             f"modèle financier ({_montant(capex, devise)}) diffèrent de plus de 10 %.")
            external = (financial.get("funding") or {}).get("loan", 0) + (financial.get("funding") or {}).get("grant", 0)
            if self.financing_need and external and abs(external - self.financing_need) > 0.10 * self.financing_need:
                notes.append(f"Besoin de financement de la fiche ({_montant(self.financing_need, devise)}) et financements "
                             f"externes du modèle ({_montant(external, devise)}) diffèrent de plus de 10 %.")
            for e in self.evaluation_ids.filtered(lambda e: e.criterion_id.indicator and e.status != "not_assessed"):
                suggestion = e.criterion_id.suggestion(financial)
                if suggestion and suggestion.get("status") and suggestion["status"] != e.status:
                    notes.append(f"{e.criterion_id.code} : statut saisi différent de celui que suggère le modèle "
                                 f"financier ({dict(STATUSES)[suggestion['status']]}).")
        for e in self.evaluation_ids.filtered(lambda e: e.status == "met" and e.document_ids):
            if all(d.state == "rejected" for d in e.document_ids):
                notes.append(f"{e.criterion_id.code} : déclaré disponible alors que toutes ses preuves sont à reprendre.")
        # La décision rappelée est celle de la révision en cours (verrouillée) ; après une nouvelle
        # révision, la décision précédente n'est plus confrontée au dossier qui évolue.
        if self.locked_review_id and self.decision in ("go", "conditional") and result["knockouts"]:
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
            recommendation, detail = "pending", (f"{method.pluriel(pending, 'critère des gates atteints', 'critères des gates atteints')} "
                                                 "à évaluer avant la recommandation.")
        else:
            recommendation, detail = r["recommendation"], r["recommendation_detail"]
        owners = {a.compartment_id.id: a.user_id for a in self.assignment_ids}
        compartments = [dict(c, owner={"id": owners[c["compartment_id"]].id, "name": owners[c["compartment_id"]].name}
                             if c["compartment_id"] in owners else None) for c in r["compartments"]]
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
            "compartments": compartments,
            "knockouts": [brief(x) for x in r["knockouts"]],
            # Knock-outs encore à évaluer, tous gates confondus (ceux des gates non atteints ne sont pas actifs).
            "knockouts_pending": sum(1 for x in r["lines"] if x.get("knockout") and x["entered"] == "not_assessed"),
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
                "compartment": g["domain"].get("compartment_code"), "compartment_id": g["domain"].get("compartment_id"),
                "compartment_name": g["domain"].get("compartment_name"),
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
                "after_lock": bool(latest.after_lock) if latest else False,
                "available": bool(info.get("available")), "origin": info.get("origin"),
                "criteria": info.get("criteria", []),
            })
        return out

    def can_assign(self):
        """Le compte confie, reprend ou retire les compartiments du dossier : responsable du dossier
        (consultant_id) ou compte système. Un autre consultant ne fait que s'attribuer un
        compartiment libre."""
        self.ensure_one()
        return _system(self.env) or self.env.user == self.consultant_id

    def assign(self, compartment, user):
        """Confie un compartiment de la grille à un consultant (user vide : retire l'affectation).
        L'évaluation étant réservée au consultant affecté, seuls le responsable du dossier
        (consultant_id) et le compte système confient un compartiment à quelqu'un d'autre, le
        reprennent ou retirent l'affectation ; un consultant de l'équipe peut seulement s'attribuer
        un compartiment encore libre, prise inscrite au journal du dossier. Refus 403 sinon."""
        self.ensure_one()
        if compartment.policy_id != self.policy_id:
            raise UserError("Ce compartiment n'appartient pas à la grille du dossier.")
        current = self.assignment_ids.filtered(lambda a: a.compartment_id == compartment)
        me = self.env.user
        self_take = False
        if current.user_id != user and not self.can_assign():
            label = f"Compartiment {compartment.code} {compartment.name}"
            if current:
                raise AccessError(f"{label} confié à {current.user_id.sudo().name} : seul {_lead_label(self)} "
                                  "change ou retire cette affectation.")
            if user != me:
                raise AccessError(f"{label} libre : vous pouvez vous l'attribuer, mais seul {_lead_label(self)} "
                                  "le confie à un autre consultant.")
            self_take = True
        before = current.user_id.name or None
        if not user:
            current.unlink()
        elif current:
            current.user_id = user
        else:
            self.env["axispro.assignment"].create({"dossier_id": self.id, "compartment_id": compartment.id,
                                                   "user_id": user.id})
        if (user.name if user else None) != before:
            note = f"Compartiment {compartment.code} {compartment.name}"
            if self_take:
                note += " : pris en charge par le consultant lui-même"
            self.log("assignment", note=note, before=before or "Non affecté", after=user.name if user else "Non affecté")
        return True

    def action_advance_gate(self, force_reason=None):
        """Passage au gate suivant : décision GO ou CONDITIONAL GO du gate courant (consultant du
        cabinet) ; sinon refus motivé, sauf passage forcé avec un motif inscrit au journal, par un
        associé ou la direction, jamais par une seule personne : un autre compte doit avoir contribué
        à la révision (quatre yeux)."""
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
            self._check_decision_right(f"forcer le passage du gate {gate.code}")
            self._check_four_eyes(f"forcer le passage du gate {gate.code}")
            self.log("gate", note=f"Passage forcé de {gate.code} à {following.code} ({method.DECISIONS[decision['decision']]}) : "
                                  f"{force_reason}")
        else:
            self._check_consultant(f"faire passer le dossier au gate {following.code}")
            self.log("gate", note=f"Passage de {gate.code} à {following.code}.")
        # Contrôles faits : écriture du noyau (la direction n'écrit pas les dossiers du cabinet).
        self.sudo().current_gate_id = following
        return True

    def action_new_revision(self):
        """Nouvelle révision après une décision verrouillée : le dossier redevient modifiable. Elle
        défait le verrou : un associé ou la direction l'ouvre, autre que celui qui a verrouillé
        (quatre yeux)."""
        self.ensure_one()
        if not self.locked_review_id:
            raise UserError("Aucune décision verrouillée : le dossier est déjà modifiable.")
        self._check_decision_right("ouvrir une nouvelle révision")
        previous = self.locked_review_id
        if not _system(self.env) and previous.locked_by == self.env.user:
            raise AccessError(
                f"Principe des quatre yeux : vous avez verrouillé la décision en vigueur du dossier {self.reference} "
                f"(révision {self.revision}), vous ne pouvez donc pas ouvrir la nouvelle révision qui la défait. "
                "Un autre associé du cabinet, ou la direction, doit l'ouvrir."
            )
        # Les auteurs se comptent par révision : la nouvelle repart à vide. Contrôles faits : écriture
        # du noyau (la direction n'écrit pas les dossiers du cabinet).
        self.sudo().with_context(axispro_unlocked=True).write({"revision": self.revision + 1, "locked_review_id": False,
                                                               "decision_inputs_by": [Command.clear()]})
        # Les pièces reçues après la décision défaite entrent dans la nouvelle révision : la prochaine
        # décision verrouillée les fige comme les autres (sinon une pièce reçue après un verrou
        # précédent resterait modifiable sous une décision scellée qui s'appuie sur elle).
        self.sudo().document_ids.filtered("after_lock").write({"after_lock": False})
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

    def _check_evaluator(self):
        """Refus (403) d'écrire l'évaluation d'un critère hors des compartiments ouverts au compte."""
        for e in self:
            refusal = e.dossier_id._evaluation_refusal(e.criterion_id.domain_id.compartment_id)
            if refusal:
                raise AccessError(f"Critère {e.criterion_id.code} : {refusal}")

    def write(self, vals):
        if not self.env.context.get("axispro_unlocked"):
            self.dossier_id._check_unlocked()
        if EVALUATION_FIELDS & set(vals):
            self._check_evaluator()
            self.dossier_id._note_decision_input()
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
    after_lock = fields.Boolean("Reçue après la décision verrouillée", readonly=True,
                                help="Pièce reçue après la décision verrouillée en vigueur : elle se traite librement. "
                                     "Remis à faux à l'ouverture d'une nouvelle révision.")
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
        # Quatre yeux : la pièce entre dans le score et le contenu scellé.
        records.dossier_id._note_decision_input()
        return records

    def write(self, vals):
        """Une pièce antérieure à la décision verrouillée entre dans le score scellé : son état et sa
        validité ne changent plus avant une nouvelle révision. Une pièce reçue après la décision se
        traite librement. Tout changement de validité est inscrit au journal du dossier. L'auteur
        d'un changement scellé rejoint les auteurs de la révision (quatre yeux)."""
        if {"state", "validity_date", "evaluation_ids"} & set(vals) and not self.env.context.get("axispro_unlocked"):
            self.filtered(lambda d: not d.after_lock).dossier_id._check_unlocked()
        if DOCUMENT_INPUT_FIELDS & set(vals):
            self.dossier_id._note_decision_input()
        before = {d.id: d.validity_date for d in self} if "validity_date" in vals else {}
        result = super().write(vals)
        for doc in self.filtered(lambda d: d.id in before and before[d.id] != d.validity_date):
            old, new = before[doc.id], doc.validity_date
            doc.dossier_id.log("document", note=f"{doc.name} (version {doc.version}) : validité "
                                                f"{f'{old:%d/%m/%Y}' if old else 'sans date'} → "
                                                f"{f'{new:%d/%m/%Y}' if new else 'sans date'}.")
        return result

    def unlink(self):
        self.dossier_id._note_decision_input()
        return super().unlink()


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


class AxisproAssignment(models.Model):
    """Consultant chargé d'un compartiment de la grille sur un dossier (outil du cabinet : « chaque
    consultant filtre sur son compartiment »). L'affectation n'entre pas dans la décision : elle reste
    modifiable sur un dossier verrouillé, et chaque changement est inscrit au journal."""

    _name = "axispro.assignment"
    _description = "Consultant d'un compartiment sur un dossier"
    _order = "dossier_id, compartment_id"

    dossier_id = fields.Many2one("axispro.dossier", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="dossier_id.company_id", store=True)
    compartment_id = fields.Many2one("axispro.compartment", required=True, ondelete="cascade")
    user_id = fields.Many2one("res.users", "Consultant", required=True, ondelete="cascade")

    _unique = models.Constraint("unique(dossier_id, compartment_id)", "Un seul consultant par compartiment et par dossier.")

    @api.constrains("compartment_id", "dossier_id")
    def _check_policy(self):
        for a in self:
            if a.compartment_id.policy_id != a.dossier_id.policy_id:
                raise UserError("Ce compartiment n'appartient pas à la grille du dossier.")


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
         ("decision", "Décision de comité"), ("revision", "Révision"), ("import", "Import"),
         ("assignment", "Équipe du dossier"), ("portal", "Portail du porteur"), ("state", "État du dossier")],
        required=True, readonly=True,
    )
    criterion_id = fields.Many2one("axispro.criterion", "Critère", ondelete="set null", readonly=True)
    before = fields.Char("Avant", readonly=True)
    after = fields.Char("Après", readonly=True)
    note = fields.Text(readonly=True)
