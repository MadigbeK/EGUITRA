"""NIMOVA · Analyse de MB AxisPro Consulting (spécification, chapitre 6).

Jeu d'essai fictif : grille au format MB AxisPro Consulting (huit gates, trois domaines, sept critères, trois
pièces), cinq dossiers en cours à des gates différents et un dossier clos, passages de gate datés au
journal (dont un passage forcé), évaluations et preuves, trois revues de comité verrouillées, quatre
recherches de financement, temps passés et une facture d'honoraires validée, actions (dont une en
retard) et risques. Les dates sont relatives au jour du test (T) ; les valeurs attendues se
vérifient à la main (calculs rappelés en commentaire).
"""

from datetime import datetime, time, timedelta

from odoo import fields
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_analytics.engine import portfolio as pf
from odoo.addons.eguitra_api.tests.common import ApiCase

HEADER = ("type", "code", "libelle", "domaine", "gate", "poids", "critique", "eliminatoire", "preuve", "aide",
          "exigence", "bancabilite", "livrable", "role", "regle", "seuil_attente", "seuil_go", "portee", "domaines",
          "criteres", "compartiment")
ROWS = [
    {"type": "gate", "code": "G0", "libelle": "Project Intake", "regle": "intake"},
    {"type": "gate", "code": "G1", "libelle": "Prequalification", "regle": "prequalification", "seuil_attente": "30",
     "seuil_go": "50", "portee": "cumulee"},
    {"type": "gate", "code": "G2", "libelle": "Pre-feasibility", "regle": "feasibility", "seuil_attente": "40",
     "portee": "cumulee", "domaines": "DOM01"},
    {"type": "gate", "code": "G3", "libelle": "APD Readiness", "regle": "apd", "seuil_attente": "65"},
    {"type": "gate", "code": "G4", "libelle": "Bankability", "regle": "bankability", "seuil_attente": "80"},
    {"type": "gate", "code": "G5", "libelle": "Due diligence", "regle": "due_diligence", "seuil_attente": "80"},
    {"type": "gate", "code": "G6", "libelle": "Structuring", "regle": "structuring", "seuil_attente": "65",
     "domaines": "DOM02"},
    {"type": "gate", "code": "G7", "libelle": "Financial close", "regle": "closing"},
    {"type": "domaine", "code": "DOM01", "libelle": "Marché et technique", "poids": "1",
     "livrable": "Étude de marché à commander", "compartiment": "C3 — Marché et commercial"},
    {"type": "domaine", "code": "DOM02", "libelle": "Juridique et foncier", "poids": "1",
     "compartiment": "C1 — Foncier et autorisations"},
    {"type": "domaine", "code": "DOM03", "libelle": "Finances", "poids": "1",
     "livrable": "Modèle financier et états financiers certifiés",
     "compartiment": "C4 — Coûts et modélisation financière"},
    {"type": "critere", "code": "C001", "libelle": "Étude de marché", "domaine": "DOM01", "gate": "G1", "poids": "2",
     "critique": "oui", "exigence": "apd", "bancabilite": "oui"},
    {"type": "critere", "code": "C002", "libelle": "Foncier sécurisé", "domaine": "DOM02", "gate": "G1", "poids": "1",
     "critique": "oui", "eliminatoire": "oui", "preuve": "oui", "exigence": "bloquant", "bancabilite": "oui"},
    {"type": "critere", "code": "C003", "libelle": "CAPEX détaillé", "domaine": "DOM01", "gate": "G2", "poids": "2",
     "exigence": "apd", "bancabilite": "oui", "livrable": "Devis des fournisseurs", "role": "capex"},
    {"type": "critere", "code": "C004", "libelle": "Modèle financier", "domaine": "DOM03", "gate": "G2", "poids": "2",
     "critique": "oui", "exigence": "apd", "bancabilite": "oui", "livrable": "Modèle financier bancable"},
    {"type": "critere", "code": "C005", "libelle": "Étude d'impact environnemental et social", "domaine": "DOM02",
     "gate": "G3", "poids": "1", "exigence": "apd", "bancabilite": "oui"},
    {"type": "critere", "code": "C006", "libelle": "États financiers du promoteur", "domaine": "DOM03", "gate": "G1",
     "poids": "1", "preuve": "oui", "exigence": "apd", "bancabilite": "oui",
     "livrable": "États financiers certifiés des trois derniers exercices"},
    {"type": "critere", "code": "C007", "libelle": "Pacte d'actionnaires", "domaine": "DOM02", "gate": "G6",
     "poids": "1", "exigence": "closing", "bancabilite": "non"},
    {"type": "piece", "code": "D001", "libelle": "Titre foncier", "domaine": "A. Foncier", "gate": "G1",
     "critique": "oui", "criteres": "C002"},
    {"type": "piece", "code": "D002", "libelle": "Étude de marché", "domaine": "B. Marché", "gate": "G1",
     "critique": "oui", "criteres": "C001"},
    {"type": "piece", "code": "D003", "libelle": "États financiers certifiés", "domaine": "C. Finances", "gate": "G1",
     "critique": "oui", "criteres": "C006"},
]
GRID = ("\n".join([";".join(HEADER)] + [";".join(row.get(h, "") for h in HEADER) for row in ROWS]) + "\n").encode()
MD = 1_000_000_000

SECTION_KEYS = {
    "synthese": {"kpis", "funnel", "maturity"},
    "portefeuille": {"funnel", "time_in_gate", "bottleneck", "by_sector", "by_location", "pipeline_value", "forecast"},
    "diagnostic": {"domain_heatmap", "top_gaps", "knockouts", "evidence", "progression"},
    "comites": {"decisions", "agreement", "forced_gates", "time_to_decision", "score_at_decision"},
    "financements": {"flows", "by_funder", "pipeline"},
    "activite": {"time", "realization", "profitability", "revenue", "forecast"},
    "risques": {"risk_matrix", "actions", "responsiveness"},
}
ENVELOPE_KEYS = {"entity", "company", "period", "generated_at", "quality", "insights"}
KPI_KEYS = {"key", "label", "value", "unit", "previous", "target", "delta_pct", "trend", "status", "definition",
            "inverse"}
INSIGHT_KEYS = {"id", "domain", "severity", "title", "narrative", "metric", "impact_gnf", "confidence", "method",
                "evidence", "action", "link", "score"}


@tagged("post_install", "-at_install")
class TestPortefeuilleMethodes(TransactionCase):
    """Méthodes pures du portefeuille (engine/portfolio.py)."""

    def test_probabilite_de_bancabilite(self):
        self.assertAlmostEqual(pf.bankability_probability(50), 0.2)
        self.assertAlmostEqual(pf.bankability_probability(65), 0.5)
        self.assertAlmostEqual(pf.bankability_probability(80), 0.8)
        self.assertEqual(pf.bankability_probability(95, knockout=True), 0.0, "Nulle si knock-out confirmé")

    def test_quantiles_et_kaplan_meier(self):
        self.assertEqual(pf.median([40, 60, 100]), 60.0)
        self.assertEqual(pf.quantile([40, 60, 100], 0.75), 80.0, "Interpolation entre 60 et 100")
        self.assertIsNone(pf.median([]))
        # Passages achevés 40, 60, 100 ; dossiers encore dans le gate depuis 45 et 110 jours :
        # S(40) = 4/5, S(60) = 4/5 × 2/3, S(100) = S(60) × 1/2 = 0,27 -> médiane 100 (et non 60).
        self.assertEqual(pf.km_median([(40, True), (60, True), (100, True), (45, False), (110, False)]), 100.0)
        self.assertIsNone(pf.km_median([(80, True), (150, False), (155, False)]),
                          "Survie au-dessus de 50 % : médiane inconnue, plus longue que le suivi")

    def test_notes_du_journal(self):
        self.assertEqual(pf.parse_gate_note("Passage de G0 à G1."), ("G0", "G1", False))
        self.assertEqual(pf.parse_gate_note("Passage forcé de G1 à G2 (HOLD) : titre attendu"), ("G1", "G2", True))
        self.assertIsNone(pf.parse_gate_note("Pièce déposée : statuts (version 1)."))

    def test_accord_methode_comite(self):
        stats = pf.agreement([("bankable", "go"), ("hold", "conditional"), ("no_go", "hold"), ("pending", "go"),
                              ("go", "postponed")])
        self.assertEqual((stats["n"], stats["agreed"], stats["lenient"], stats["strict"]), (3, 1, 2, 0),
                         "À compléter et ajourné écartés ; deux décisions plus favorables que la méthode")
        # po = 1/3 ; pe = (1/3 × 1/3) [GO] + (1/3 × 1/3) [HOLD] = 2/9 ; kappa = (1/3 - 2/9) / (7/9) = 1/7.
        self.assertAlmostEqual(stats["kappa"], 1 / 7)

    def test_calendrier(self):
        self.assertEqual(pf.month_keys(fields.Date.to_date("2025-11-15"), fields.Date.to_date("2026-02-01")),
                         ["2025-11", "2025-12", "2026-01", "2026-02"])
        self.assertEqual(pf.next_months(fields.Date.to_date("2026-11-30"), 3), ["2026-12", "2027-01", "2027-02"])
        self.assertAlmostEqual(pf.hhi([8, 2]), 0.68)


@tagged("post_install", "-at_install")
class TestAnalyseCabinet(ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.cabinet = cls.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        cls.groupe = cls.env.ref("base.main_company")
        cls.env = cls.env(context=dict(cls.env.context, allowed_company_ids=cls.cabinet.ids))
        cls.today = fields.Date.today()
        cls.policy = cls.env["axispro.policy"].import_grid(cls.cabinet, "Méthode MB AxisPro Consulting (essai)", "grille.csv", GRID)
        cls.policy.action_activate()
        cls.gates = {g.code: g for g in cls.policy.gate_ids}
        cabinet = {"company_id": cls.cabinet.id, "company_ids": [(6, 0, cls.cabinet.ids)]}
        cls._create_user("analyste.cabinet", "cabinet", **cabinet)
        cls.awa = cls._create_user("awa.conseil", "cabinet", name="Awa Camara", **cabinet)
        cls.moussa = cls._create_user("moussa.conseil", "cabinet", name="Moussa Diallo", **cabinet)
        cls._create_user("finance.cabinet", "finance", **cabinet)
        cls._create_user("dg.deux.societes", "direction", company_id=cls.groupe.id,
                         company_ids=[(6, 0, (cls.groupe | cls.cabinet).ids)])
        cls._create_user("dg.groupe.seul", "direction", company_id=cls.groupe.id, company_ids=[(6, 0, cls.groupe.ids)])
        cls._create_user("exploitant.groupe", "exploitation", company_id=cls.groupe.id,
                         company_ids=[(6, 0, cls.groupe.ids)])
        cls._build_portfolio()

    # ─── Jeu d'essai ──────────────────────────────────────────────────────

    @classmethod
    def _at(cls, days_ago):
        return datetime.combine(cls.today - timedelta(days=days_ago), time(10, 0))

    @classmethod
    def _day(cls, days_ago):
        return cls.today - timedelta(days=days_ago)

    @classmethod
    def _dossier(cls, name, promoter, sector, location, need, investment, consultant, created, **extra):
        partner = cls.env["res.partner"].create({"name": promoter, "is_company": True})
        dossier = cls.env["axispro.dossier"].create(dict({
            "name": name, "promoter_id": partner.id, "company_id": cls.cabinet.id, "sector": sector,
            "location": location, "financing_need": need, "investment": investment, "consultant_id": consultant.id,
        }, **extra))
        cls.env.cr.execute("UPDATE axispro_dossier SET create_date = %s WHERE id = %s", (cls._at(created), dossier.id))
        return dossier

    @classmethod
    def _passages(cls, dossier, *steps):
        """steps : (jours avant T, origine, arrivée[, motif du passage forcé])."""
        for days_ago, src, dst, *reason in steps:
            note = f"Passage forcé de {src} à {dst} (HOLD) : {reason[0]}" if reason else f"Passage de {src} à {dst}."
            cls.env["axispro.journal"].sudo().create({"dossier_id": dossier.id, "kind": "gate", "note": note,
                                                      "date": cls._at(days_ago)})
            dossier.current_gate_id = cls.gates[dst]

    @classmethod
    def _evaluate(cls, dossier, statuses, proofs=()):
        """statuses : {code: statut} ; proofs : [(code du critère, code de la pièce, jours avant T)]."""
        evaluations = {e.criterion_id.code: e for e in dossier.evaluation_ids}
        for code, piece, days_ago in proofs:
            doc_type = cls.policy.document_type_ids.filtered(lambda t, c=piece: t.code == c)
            attachment = cls.env["ir.attachment"].create({"name": f"{piece}.pdf", "raw": b"%PDF-1.4 " + piece.encode()})
            document = cls.env["axispro.document"].create({
                "dossier_id": dossier.id, "document_type_id": doc_type.id, "name": doc_type.name,
                "attachment_id": attachment.id, "uploaded_at": cls._at(days_ago),
            })
            evaluations[code].document_ids = [(4, document.id)]
        for code, status in statuses.items():
            evaluations[code].status = status

    @classmethod
    def _review(cls, dossier, days_ago, gate, decision, **extra):
        review = cls.env["axispro.review"].create(dict({
            "dossier_id": dossier.id, "date": cls._day(days_ago), "gate_id": cls.gates[gate].id, "decision": decision,
            "motive": "Décision motivée du comité d'investissement (essai).",
        }, **extra))
        review.action_lock()
        return review

    @classmethod
    def _created(cls, record, days_ago):
        cls.env.cr.execute(f"UPDATE {record._table} SET create_date = %s WHERE id = %s", (cls._at(days_ago), record.id))

    @classmethod
    def _build_portfolio(cls):
        T = cls
        # A : G3 depuis T-150 (G0 10 j, G1 60 j, G2 80 j) ; Readiness 85, Bankability 94,4, DSCR 1,45 :
        # BANKABLE CANDIDATE.
        cls.a = T._dossier("Centrale solaire de Kindia", "Kindia Solaire SA (essai)", "Énergie", "Kindia", 8 * MD,
                           12 * MD, cls.awa, 300, dscr_manual=1.45)
        T._passages(cls.a, (290, "G0", "G1"), (230, "G1", "G2"), (150, "G2", "G3"))
        T._evaluate(cls.a, {"C001": "met", "C002": "met", "C003": "met", "C004": "met", "C005": "partial", "C006": "met"},
                    proofs=[("C002", "D001", 280), ("C006", "D003", 270)])
        # B : G2 depuis T-155 (G0 5 j, G1 40 j) ; Readiness 45, Bankability 50 (probabilité 0,2) : HOLD.
        cls.b = T._dossier("Rizerie de Kankan", "Rizerie du Milo SARL (essai)", "Agro-industrie", "Kankan", 3 * MD,
                           4.5 * MD, cls.moussa, 200)
        T._passages(cls.b, (195, "G0", "G1"), (155, "G1", "G2"))
        T._evaluate(cls.b, {"C001": "met", "C002": "met", "C003": "partial", "C004": "not_met", "C006": "partial"},
                    proofs=[("C002", "D001", 160)])
        # C : G1 depuis T-110 ; knock-out confirmé (foncier non disponible) : NO-GO.
        cls.c = T._dossier("Briqueterie de Mamou", "Briqueterie du Fouta (essai)", "Matériaux de construction", "Mamou",
                           1.2 * MD, 1.8 * MD, cls.awa, 120)
        T._passages(cls.c, (110, "G0", "G1"))
        T._evaluate(cls.c, {"C001": "met", "C002": "not_met", "C006": "not_met"})
        # D : G1 depuis T-45.
        cls.d = T._dossier("Vergers du Labé", "Vergers du Fouta (essai)", "Agro-industrie", "Labé", 0.8 * MD, 1.2 * MD,
                           cls.moussa, 50)
        T._passages(cls.d, (45, "G0", "G1"))
        T._evaluate(cls.d, {"C001": "partial", "C002": "met", "C006": "not_met"}, proofs=[("C002", "D001", 40)])
        # E : G2 depuis T-150 par un passage forcé (G1 100 j) ; foncier incomplet : knock-out ; états
        # financiers déclarés disponibles sans pièce : requalifiés incomplets.
        cls.e = T._dossier("Station de traitement d'eau de Siguiri", "Eaux de Siguiri (essai)", "Eau et assainissement",
                           "Siguiri", 2 * MD, 3 * MD, cls.awa, 260)
        T._passages(cls.e, (250, "G0", "G1"),
                    (150, "G1", "G2", "Titre foncier attendu du ministère, accord du directeur général"))
        T._evaluate(cls.e, {"C001": "met", "C002": "partial", "C003": "met", "C004": "partial", "C006": "met"})
        # F : clos au gate G1 (abandon), hors portefeuille.
        cls.f = T._dossier("Pisciculture de Boffa", "Aquaculture de Boffa (essai)", "Aquaculture", "Boffa", 0.6 * MD,
                           0.9 * MD, cls.moussa, 400)
        T._passages(cls.f, (380, "G0", "G1"))
        cls.f.state = "closed"

        # Comités verrouillés : A GO (méthode : BANKABLE), C HOLD (méthode : NO-GO), B CONDITIONAL GO
        # (méthode : HOLD) avec une condition, qui devient une action échue à T-30.
        cls.review_a = T._review(cls.a, 140, "G3", "go")
        cls.review_c = T._review(cls.c, 100, "G1", "hold")
        cls.review_b = T._review(cls.b, 60, "G2", "conditional",
                                 conditions="1. Produire les états financiers certifiés du promoteur")
        condition = cls.env["axispro.action"].search([("review_id", "=", cls.review_b.id)])
        T._created(condition, 60)

        # Financements : 5 Md en instruction (relance échue), 1,5 Md obtenus sur 2, un refus, une subvention.
        Partner, Funding = cls.env["res.partner"], cls.env["axispro.funding"]
        kaloum = Partner.create({"name": "Banque Kaloum Démo", "is_company": True})
        horizon = Partner.create({"name": "Fonds Horizon Sahel (essai)", "is_company": True})
        verte = Partner.create({"name": "Agence Verte (essai)", "is_company": True})
        cls.kaloum, cls.horizon = kaloum, horizon
        Funding.create([
            {"dossier_id": cls.a.id, "funder_id": kaloum.id, "instrument": "bank_loan", "amount_requested": 5 * MD,
             "state": "review", "date_submitted": T._day(100), "next_date": T._day(5), "next_step": "Comité de crédit"},
            {"dossier_id": cls.a.id, "funder_id": horizon.id, "instrument": "equity", "amount_requested": 2 * MD,
             "amount_granted": 1.5 * MD, "state": "signed", "date_submitted": T._day(200), "date_decision": T._day(120)},
            {"dossier_id": cls.b.id, "funder_id": kaloum.id, "instrument": "bank_loan", "amount_requested": 2 * MD,
             "state": "rejected", "date_submitted": T._day(150), "date_decision": T._day(90)},
            {"dossier_id": cls.b.id, "funder_id": verte.id, "instrument": "grant", "amount_requested": 0.5 * MD,
             "amount_granted": 0.5 * MD, "state": "disbursed", "date_submitted": T._day(180),
             "date_decision": T._day(100)},
        ])

        # Temps : 20 h sur A facturées 10 M GNF (500 000 GNF/h) ; 8 h facturables et 2 h non
        # facturables sur B, 5 h facturables sur C, non facturées.
        Timesheet = cls.env["axispro.timesheet"]
        for dossier, user, days_ago, hours, billable in (
            (cls.a, cls.awa, 40, 10, True), (cls.a, cls.awa, 35, 6, True), (cls.a, cls.moussa, 30, 4, True),
            (cls.b, cls.moussa, 20, 8, True), (cls.b, cls.awa, 15, 2, False), (cls.c, cls.awa, 10, 5, True),
        ):
            Timesheet.create({"dossier_id": dossier.id, "user_id": user.id, "date": T._day(days_ago), "hours": hours,
                              "description": "Analyse et rédaction (essai)", "billable": billable})
        cls.invoice = Timesheet.search([("dossier_id", "=", cls.a.id)]).action_invoice(500_000)
        cls.invoice.invoice_date = cls.today
        cls.invoice.with_context(eguitra_approval_granted=True).action_post()

        # Risques : deux critiques (20 sur A, sans action ; 16 sur E, traité), un modéré, un maîtrisé.
        Risk = cls.env["axispro.risk"]
        Risk.create({"dossier_id": cls.a.id, "name": "Retard de raccordement au réseau électrique",
                     "category": "technical", "probability": 4, "impact": 5,
                     "mitigation": "Convention de raccordement à signer avec l'opérateur"})
        Risk.create({"dossier_id": cls.b.id, "name": "Volatilité du prix du paddy", "category": "market",
                     "probability": 3, "impact": 3, "mitigation": "Contrats d'approvisionnement à prix plafonné"})
        change = Risk.create({"dossier_id": cls.e.id, "name": "Dépréciation du franc guinéen", "category": "country",
                              "probability": 4, "impact": 4, "mitigation": "Couverture partielle en devises"})
        Risk.create({"dossier_id": cls.c.id, "name": "Accès au gisement d'argile", "category": "technical",
                     "probability": 2, "impact": 2, "state": "closed"})
        T._created(change.action_plan(), 10)

        # Actions : deux terminées (30 et 10 jours), un compte rendu à valider, deux ouvertes à l'heure.
        Action = cls.env["axispro.action"]
        for dossier, name, assignee, created, due, state, done in (
            (cls.a, "Compléter l'étude d'impact environnemental", "porteur", 100, -20, "in_progress", None),
            (cls.b, "Mettre à jour les états financiers", "porteur", 90, 50, "done", 60),
            (cls.c, "Obtenir le titre foncier", "porteur", 80, 60, "done", 70),
            (cls.e, "Relancer le ministère des Mines", "cabinet", 20, -10, "todo", None),
            (cls.d, "Établir le plan de trésorerie", "porteur", 30, 3, "submitted", None),
        ):
            action = Action.create({"dossier_id": dossier.id, "name": name, "assignee": assignee, "state": state,
                                    "due_date": T._day(due), "done_date": T._day(done) if done is not None else False})
            T._created(action, created)
        cls.env.invalidate_all()

    # ─── Outils ───────────────────────────────────────────────────────────

    def _get(self, section, token, period="12m", **headers):
        status, body = self.call("GET", f"/analyse/cabinet/{section}?period={period}&date_to={self.today}",
                                 token=token, headers=headers or None)
        return status, body

    def _check_envelope(self, section, body):
        self.assertEqual((ENVELOPE_KEYS | SECTION_KEYS[section]) - set(body), set(), f"{section} : clés du contrat")
        self.assertEqual((body["entity"], body["company"]["id"]), ("cabinet", self.cabinet.id))
        self.assertEqual(body["period"]["code"], "12m")
        self.assertIsInstance(body["quality"]["score"], int)
        self.assertLessEqual(len(body["insights"]), 10 if section == "synthese" else 6)
        for item in body["insights"]:
            self.assertEqual(INSIGHT_KEYS - set(item), set(), item)
            self.assertTrue(item["narrative"] and item["method"], item)

    # ─── Routes ───────────────────────────────────────────────────────────

    def test_toutes_les_sections(self):
        token = self.open_session("analyste.cabinet", app="analyse")["access_token"]
        for section in SECTION_KEYS:
            status, body = self._get(section, token)
            self.assertEqual(status, 200, f"{section} : {body}")
            self._check_envelope(section, body)

    def test_synthese(self):
        token = self.open_session("analyste.cabinet", app="analyse")["access_token"]
        status, body = self._get("synthese", token)
        self.assertEqual(status, 200, body)
        kpis = {k["key"]: k for k in body["kpis"]}
        for kpi in body["kpis"]:
            self.assertEqual(KPI_KEYS - set(kpi), set(), kpi)
        self.assertEqual(kpis["active_dossiers"]["value"], 5, "Cinq dossiers en cours, le dossier clos exclu")
        self.assertEqual(kpis["financing_need"]["value"], 15 * MD, "8 + 3 + 1,2 + 0,8 + 2 Md")
        # Readiness : A 85, B 45, C 20, D 20, E 60 -> moyenne 46.
        self.assertEqual(kpis["readiness_avg"]["value"], 46.0)
        # Revues verrouillées de la période : GO, CONDITIONAL GO, HOLD -> 2 sur 3.
        self.assertEqual(kpis["gate_pass_rate"]["value"], 66.7)
        # Séjours achevés hors recevabilité : G1 60, 40, 100 ; G2 80 -> médiane 70.
        self.assertEqual(kpis["gate_median_days"]["value"], 70.0)
        self.assertEqual(kpis["fees"]["value"], 10_000_000)
        self.assertEqual(kpis["realization_rate"]["value"], 57.1, "10 M facturés / (35 h × 500 000)")
        expected = sum(
            d.financing_need * pf.bankability_probability(d.scoring()["bankability"], d in (self.c, self.e))
            for d in (self.a, self.b, self.c, self.d, self.e))
        self.assertAlmostEqual(kpis["weighted_pipeline"]["value"], expected, delta=1)
        funnel = {f["gate"]: f for f in body["funnel"]}
        self.assertEqual([funnel[g]["count"] for g in ("G0", "G1", "G2", "G3", "G4")], [0, 2, 2, 1, 0])
        self.assertEqual(len(body["maturity"]), 5)
        self.assertTrue(any(i["severity"] == "positive" for i in body["insights"]), "Une synthèse n'est jamais que négative")

    def test_portefeuille(self):
        token = self.open_session("analyste.cabinet", app="analyse")["access_token"]
        status, body = self._get("portefeuille", token)
        self.assertEqual(status, 200, body)
        funnel = {f["gate"]: f for f in body["funnel"]}
        self.assertEqual((funnel["G2"]["count"], funnel["G2"]["need"]), (2, 5 * MD), "B et E : 3 + 2 Md")
        self.assertEqual([funnel[g]["reached"] for g in ("G0", "G1", "G2", "G3", "G4")], [6, 6, 3, 1, 0])
        self.assertEqual(funnel["G1"]["conversion_pct"], 50.0, "3 dossiers sur 6 ont atteint G2")
        self.assertEqual(funnel["G1"]["pass_rate_pct"], 75.0, "3 passés, 1 clos à G1 ; les dossiers en cours écartés")
        times = {t["gate"]: t for t in body["time_in_gate"]}
        self.assertEqual((times["G1"]["median_days"], times["G1"]["p75_days"], times["G1"]["n"]), (60.0, 80.0, 3))
        self.assertEqual(times["G1"]["km_median_days"], 100.0, "C (110 j) et D (45 j) encore en G1")
        self.assertEqual(times["G0"]["median_days"], 10.0, "5, 5, 10, 10, 10, 20")
        self.assertEqual((times["G2"]["median_days"], times["G2"]["in_gate"]), (80.0, 2))
        self.assertIsNone(times["G2"]["km_median_days"], "B et E dépassent 150 jours")
        bottleneck = body["bottleneck"]
        # G2 : 2 dossiers × 152,5 jours (âge médian de B et E) = 305 ; G1 : 2 × 77,5 ; G3 : 1 × 150.
        self.assertEqual((bottleneck["gate"], bottleneck["days_per_dossier"], bottleneck["load_days"]), ("G2", 152.5, 305.0))
        pipeline = {p["id"]: p for p in body["pipeline_value"]["dossiers"]}
        self.assertAlmostEqual(pipeline[self.b.id]["probability"], 0.2, places=3, msg="Bankability 50")
        self.assertEqual((pipeline[self.e.id]["knockout"], pipeline[self.e.id]["probability"]), (True, 0.0))
        self.assertEqual(pipeline[self.e.id]["knockouts"], ["C002"])
        sectors = {s["label"]: s for s in body["by_sector"]}
        self.assertEqual((sectors["Agro-industrie"]["count"], sectors["Agro-industrie"]["need"]), (2, 3.8 * MD))
        self.assertLessEqual({"apd_3m", "apd_6m", "bankability_3m", "bankability_6m", "velocity"}, set(body["forecast"]))
        self.assertEqual([t["gate"] for t in body["forecast"]["targets"]], ["G3", "G4"])
        self.assertIn("cabinet.goulot.G2", [i["id"] for i in body["insights"]])

    def test_diagnostic(self):
        c1 = self.policy.compartment_ids.filtered(lambda k: k.code == "C1")
        self.b.assign(c1, self.awa)
        token = self.open_session("analyste.cabinet", app="analyse")["access_token"]
        status, body = self._get("diagnostic", token)
        self.assertEqual(status, 200, body)
        compartments = {c["code"]: c for c in body["compartments"]}
        self.assertEqual(list(compartments), ["C1", "C3", "C4"], "Compartiments dans l'ordre de leurs codes")
        self.assertEqual((compartments["C1"]["dossiers"], compartments["C1"]["unassigned"],
                          compartments["C1"]["consultants"]), (5, 4, [{"name": "Awa Camara", "dossiers": 1}]))
        self.assertEqual(compartments["C3"]["domains"], ["Marché et technique"])
        top = body["top_gaps"][0]
        # C006 exigé dans les 5 dossiers, en écart dans 4 : B incomplet, C et D non disponibles, E sans
        # preuve ; priorités 0,5 + 1 + 1 + 0,5 -> 0,75.
        self.assertEqual((top["code"], top["frequency"], top["frequency_pct"], top["avg_priority"]),
                         ("C006", 4, 80.0, 0.75))
        self.assertEqual((top["not_met"], top["partial"], top["requalified"]), (2, 1, 1))
        self.assertEqual(sorted(top["dossiers"]), sorted([self.b.reference, self.c.reference, self.d.reference,
                                                          self.e.reference]))
        self.assertEqual(top["theme"], "États financiers certifiés des trois derniers exercices")
        knockouts = {k["code"]: k for k in body["knockouts"]}
        self.assertEqual((knockouts["C002"]["count"], knockouts["C002"]["need"]), (2, 3.2 * MD), "C et E")
        evidence = body["evidence"]
        self.assertEqual((evidence["required"], evidence["proven"], evidence["no_proof"], evidence["coverage_pct"]),
                         (5, 4, 1, 80.0))
        self.assertEqual(evidence["missing"], 11, "A 1, B 2, C 3, D 2, E 3 pièces attendues manquantes")
        self.assertEqual(len(body["domain_heatmap"]["cells"]), 15, "5 dossiers × 3 domaines")
        self.assertIn(self.c.id, body["progression"]["stagnating"], "Aucun progrès depuis la revue de T-100")
        self.assertIn("cabinet.faiblesse.C006", [i["id"] for i in body["insights"]])

    def test_comites(self):
        token = self.open_session("analyste.cabinet", app="analyse")["access_token"]
        status, body = self._get("comites", token)
        self.assertEqual(status, 200, body)
        agreement = body["agreement"]
        matrix = {(r, d): agreement["matrix"][i][j] for i, r in enumerate(agreement["recommendations"])
                  for j, d in enumerate(agreement["decisions"])}
        self.assertEqual((matrix[("bankable", "go")], matrix[("hold", "conditional")], matrix[("no_go", "hold")]),
                         (1, 1, 1))
        self.assertEqual(sum(matrix.values()), 3)
        self.assertEqual((agreement["agreement_pct"], agreement["kappa"], agreement["lenient"], agreement["strict"]),
                         (33.3, 0.143, 2, 0))
        self.assertEqual(body["decisions"]["totals"], {"go": 1, "conditional": 1, "hold": 1, "no_go": 0, "postponed": 0})
        self.assertEqual([(f["dossier"], f["gate"], f["to"]) for f in body["forced_gates"]],
                         [(self.e.reference, "G1", "G2")])
        self.assertEqual(body["forced_summary"], {"count": 1, "passages": 9, "share_pct": 11.1})
        # Ouverture -> première décision : A 160 j, B 140 j, C 20 j.
        self.assertEqual((body["time_to_decision"]["median_days"], body["time_to_decision"]["n"]), (140.0, 3))
        self.assertEqual((body["conditions"]["count"], body["conditions"]["overdue"]), (1, 1))
        go = next(s for s in body["score_at_decision"] if s["decision"] == "go")
        self.assertEqual(go["scores"], [85.0])

    def test_financements(self):
        token = self.open_session("analyste.cabinet", app="analyse")["access_token"]
        status, body = self._get("financements", token)
        self.assertEqual(status, 200, body)
        funders = {f["id"]: f for f in body["by_funder"]}
        self.assertEqual((funders[self.kaloum.id]["requested"], funders[self.kaloum.id]["success_pct"]), (7 * MD, 0.0))
        self.assertEqual((funders[self.horizon.id]["success_pct"], funders[self.horizon.id]["avg_ticket"],
                          funders[self.horizon.id]["avg_days"]), (100.0, 1.5 * MD, 80.0))
        coverage = body["coverage"]
        self.assertEqual((coverage["granted"], coverage["open_requested"], coverage["uncovered"], coverage["success_pct"]),
                         (2 * MD, 5 * MD, 8 * MD, 66.7))
        pipeline = {p["state"]: p for p in body["pipeline"]}
        self.assertEqual((pipeline["review"]["count"], pipeline["review"]["amount"]), (1, 5 * MD))
        links = {(x["source"], x["target"]): x["value"] for x in body["flows"]["links"]}
        self.assertEqual(links[("sector:Énergie", "funder:bank")], 5 * MD)
        self.assertEqual(links[("funder:bank", "state:lost")], 2 * MD)
        self.assertEqual(len(body["follow_ups"]), 1, "Relance prévue à T-5")

    def test_activite(self):
        token = self.open_session("analyste.cabinet", app="analyse")["access_token"]
        status, body = self._get("activite", token)
        self.assertEqual(status, 200, body)
        real = body["realization"]
        # 35 h × 500 000 = 17,5 M ; facturé 10 M ; carnet 13 h (6,5 M) ; non facturable 2 h (1 M).
        self.assertEqual((real["standard_rate"], real["rate_source"], real["value"], real["billed"]),
                         (500_000, "derived", 17_500_000, 10_000_000))
        self.assertEqual((real["overall_pct"], real["wip_value"], real["non_billable_value"]), (57.1, 6_500_000, 1_000_000))
        by_dossier = {r["id"]: r for r in real["by_dossier"]}
        self.assertEqual((by_dossier[self.a.id]["realization_pct"], by_dossier[self.b.id]["realization_pct"]), (100.0, 0.0))
        consultants = {c["name"]: c for c in real["by_consultant"]}
        self.assertEqual((consultants["Awa Camara"]["hours"], consultants["Awa Camara"]["realization_pct"]), (23.0, 69.6),
                         "8 M facturés / (23 h × 500 000)")
        profit = {r["id"]: r for r in body["profitability"]["rows"]}
        # A : 10 M d'honoraires - 20 h × 500 000 × 40 % = 6 M de marge.
        self.assertEqual((profit[self.a.id]["fees"], profit[self.a.id]["cost"], profit[self.a.id]["margin"],
                          profit[self.a.id]["margin_pct"]), (10_000_000, 4_000_000, 6_000_000, 60.0))
        self.assertEqual(profit[self.b.id]["margin_ltd"], -2_000_000)
        self.assertEqual(body["profitability"]["cost_rate_pct"], 40.0)
        projets = next(s for s in body["revenue"]["monthly"]["series"] if s["key"] == "projets")
        self.assertEqual(projets["values"][-1], 10_000_000, "Gestion de projets, mois de la facture")
        self.assertGreaterEqual(body["revenue"]["receivables"]["open"], 10_000_000)
        self.assertEqual((len(body["forecast"]["fees"]), body["forecast"]["backlog_hours"]), (3, 13.0))
        self.assertEqual(body["time"]["consultants"], ["Awa Camara", "Moussa Diallo"])
        self.assertIn("cabinet.temps_non_facture", [i["id"] for i in body["insights"]])

    def test_risques(self):
        token = self.open_session("analyste.cabinet", app="analyse")["access_token"]
        status, body = self._get("risques", token)
        self.assertEqual(status, 200, body)
        matrix = body["risk_matrix"]
        self.assertEqual((matrix["open"], matrix["critical"]), (3, 2), "Le risque maîtrisé est exclu")
        cell = next(c for c in matrix["cells"] if (c["probability"], c["impact"]) == (4, 5))
        self.assertEqual((cell["count"], cell["criticality"]), (1, "critical"))
        actions = body["actions"]
        # Ouvertes : condition du comité (échue à T-30), traitement du risque de change, A, E, D (à valider).
        self.assertEqual((actions["open"], actions["overdue"], actions["submitted"], actions["done"]), (5, 1, 1, 2))
        self.assertEqual(actions["median_days"], 20.0, "Actions terminées en 30 et 10 jours")
        responsiveness = body["responsiveness"]
        # Pièces déposées : A 10 et 20 jours, B 35 jours, D 5 jours après leur demande -> médiane 15.
        self.assertEqual((responsiveness["median_days"], responsiveness["n"], responsiveness["pending"]), (15.0, 4, 11))
        ids = [i["id"] for i in body["insights"]]
        self.assertIn("cabinet.risques_critiques", ids, "Risque critique de A sans action")
        self.assertIn("cabinet.actions_en_retard", ids)

    # ─── Droits ───────────────────────────────────────────────────────────

    def test_societe_et_profils(self):
        token = self.open_session("dg.groupe.seul", app="finance")["access_token"]
        status, body = self._get("synthese", token)
        self.assertEqual((status, body["error"]), (422, "wrong_company"), "Analyses du cabinet refusées depuis le groupe")
        token = self.open_session("exploitant.groupe", app="finance")["access_token"]
        status, body = self._get("portefeuille", token)
        self.assertEqual((status, body["error"]), (403, "forbidden"), "Profil exploitation non autorisé")
        token = self.open_session("finance.cabinet", app="finance")["access_token"]
        self.assertEqual(self._get("synthese", token)[0], 403, "La finance ne lit pas le portefeuille")
        status, body = self._get("activite", token)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["realization"]["billed"], 10_000_000, "Activité et honoraires ouverts à la finance")
        token = self.open_session("dg.deux.societes", app="analyse")["access_token"]
        status, body = self._get("synthese", token, **{"X-Eguitra-Company": str(self.cabinet.id)})
        self.assertEqual((status, body.get("entity")), (200, "cabinet"), body)
        status, body = self._get("risques", token, **{"X-Eguitra-Company": str(self.groupe.id)})
        self.assertEqual(status, 422, "Même compte, société du groupe choisie : refus")

    def test_export_excel_et_profils(self):
        """Classeur Excel d'une section du cabinet ; la finance n'exporte que l'activité et les honoraires."""
        query = f"?period=12m&date_to={self.today}"
        token = self.open_session("analyste.cabinet", app="analyse")["access_token"]
        response = self.url_open(f"/api/v1/analyse/cabinet/diagnostic.xlsx{query}",
                                 headers={"Authorization": f"Bearer {token}"}, timeout=120)
        self.assertEqual(response.status_code, 200, response.text[:300])
        self.assertTrue(response.content.startswith(b"PK"))
        finance = {"Authorization": f"Bearer {self.open_session('finance.cabinet', app='analyse')['access_token']}"}
        response = self.url_open(f"/api/v1/analyse/cabinet/activite.xlsx{query}", headers=finance, timeout=120)
        self.assertEqual(response.status_code, 200, response.text[:300])
        response = self.url_open(f"/api/v1/analyse/cabinet/diagnostic.xlsx{query}", headers=finance, timeout=60)
        self.assertEqual(response.status_code, 403, "La finance n'ouvre pas le diagnostic des projets")

