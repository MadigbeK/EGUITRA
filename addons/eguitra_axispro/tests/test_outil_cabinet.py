"""Outil de scoring du cabinet (version 3 : compartiments, 7 gates) importé tel quel comme grille,
suivi par compartiment, consultants affectés et complétude minimale d'un gate."""

import io

from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_axispro.tests.test_methode import crit, extended_grid, gate, run

SCORING_HEADER = ("Compartiment", "Domaine", "Critère / pièce", "Type d'exigence", "Statut", "Points", "Poids",
                  "Score pondéré", "Critique ?", "Knock-out ?", "Gate cible", "Pertinent Bancabilité",
                  "Référence / fichier", "Responsable", "Échéance", "Observation",
                  "Étude / analyse / document à produire (compartiment)", "Priorité gap (calc)")
CRITERIA = (
    ("C3 — Marché et commercial", "Analyse de marché", "Étude de marché", "PendantAPD", 2, "Oui", "Non", "Gate1", "Oui"),
    ("C1 — Foncier et autorisations", "Maîtrise foncière", "Foncier sécurisé", "Bloquant", 1, "Oui", "Oui", "Gate1",
     "Oui"),
    ("C3 — Marché et commercial", "Débouchés commerciaux", "Contrats d'achat signés", "Bloquant", 3, "Oui", "Oui",
     "Gate2", "Oui"),
    ("C1 — Foncier et autorisations", "Autorisations réglementaires", "Agréments sectoriels", "PendantAPD", 2, "Non",
     "Non", "Gate3", "Oui"),
    ("C1 — Foncier et autorisations", "Maîtrise foncière", "Plan cadastral", "DD-Closing", 1, "Non", "Non", "Gate4",
     "Non"),
)
GATES = (
    ("Gate 0", "Réception et enregistrement du projet", "Fiche projet reçue.", "Accusé de réception.",
     "Décision de recevabilité."),
    ("Gate 1", "Préqualification", "Checklist complétée à au moins 40% ; promoteur identifiable.", "Note de cadrage.",
     "Score de maturité ≥ 30/100 et aucun knock-out critique sur le bloc Promoteur/Foncier de base."),
    ("Gate 2", "Préfaisabilité", "Foncier confirmé.", "Note de préfaisabilité.",
     "Aucun knock-out actif sur Foncier / Marché-Commercial / Réglementaire ; Project Readiness Score ≥ 55/100."),
    ("Gate 3", "Préparation au lancement de l'APD", "CAPEX documentés.", "Dossier de lancement APD.",
     "APD Readiness Score ≥ 50/100 et zéro knock-out actif."),
    ("Gate 4", "Revue d'investissement et de bancabilité", "Modèle financier complet.", "Business plan bancable.",
     "Bankability Score ≥ 70/100 ; DSCR ≥ seuil bancaire (indicatif 1,4x)."),
)


def cabinet_workbook(partial_points=0.5, statuses=None, studies=None):
    """Classeur au plan de l'outil du cabinet, notices comprises (elles ne sont pas des critères)."""
    import xlsxwriter

    statuses, studies = statuses or {}, studies or {}
    out = io.BytesIO()
    book = xlsxwriter.Workbook(out, {"in_memory": True})
    dash = book.add_worksheet("Dashboard")
    dash.write_string(0, 0, "MB AXISPRO CONSULTING — PROJECT READINESS & BANKABILITY ASSESSMENT TOOL")
    dash.write_string(1, 0, "Réf. MBAP/PROJECT-DEVELOPMENT/SC-01 — Essai")
    sheet = book.add_worksheet("Scoring")
    for c, title in enumerate(SCORING_HEADER):
        sheet.write_string(0, c, title)
    for r, (comp, dom, label, kind, weight, critical, ko, target, bank) in enumerate(CRITERIA, start=1):
        for c, value in enumerate((comp, dom, label, kind, statuses.get(label, "Non disponible"))):
            sheet.write_string(r, c, value)
        sheet.write_number(r, 5, 0)
        sheet.write_number(r, 6, weight)
        sheet.write_number(r, 7, 0)
        for c, value in zip((8, 9, 10, 11), (critical, ko, target, bank), strict=True):
            sheet.write_string(r, c, value)
        if label in studies:
            sheet.write_string(r, 16, studies[label])
    sheet.write_string(len(CRITERIA) + 3, 0, "NOTICE EXPLICATIVE — ONGLET SCORING")
    sheet.write_string(len(CRITERIA) + 5, 0, "Compartiment")
    sheet.write_string(len(CRITERIA) + 5, 1, "Le bloc d'expertise auquel le critère est confié.")
    params = book.add_worksheet("Parametres")
    for c, title in enumerate(("STATUT", "POINTS", "", "SEUIL MIN", "CLASSIFICATION", "DÉCISION")):
        params.write_string(0, c, title)
    for r, (status, points, floor, label) in enumerate((
            ("Disponible et exploitable", 1, 0, "🔴 CRITICAL / NO-GO"),
            ("Incomplet / à actualiser", partial_points, 30, "🟠 MAJOR GAPS / HOLD"),
            ("Non disponible", 0, 50, "🟡 CONDITIONAL GO"),
            ("Non applicable", 1, 65, "🟢 APD READY"),
            ("", None, 80, "🟢🟢 ADVANCED / BANKABLE CANDIDATE")), start=1):
        params.write_string(r, 0, status)
        if points is not None:
            params.write_number(r, 1, points)
        params.write_number(r, 3, floor)
        params.write_string(r, 4, label)
    gates = book.add_worksheet("Stage_Gate")
    for c, title in enumerate(("Gate", "Nom", "Exigences minimales d'entrée", "Livrables attendus",
                               "Critères de passage au gate suivant")):
        gates.write_string(0, c, title)
    for r, row in enumerate(GATES, start=1):
        for c, value in enumerate(row):
            gates.write_string(r, c, value)
    gates.write_string(len(GATES) + 3, 0, "NOTICE EXPLICATIVE — ONGLET STAGE_GATE")
    gates.write_string(len(GATES) + 5, 0, "Gate 9")
    room = book.add_worksheet("Data_Room_Index")
    room.write_string(0, 0, "MB AXISPRO CONSULTING — DATA ROOM INDEX STANDARD")
    for c, title in enumerate(("Catégorie", "N°", "Pièce")):
        room.write_string(1, c, title)
    for r, (category, number, piece) in enumerate((("C. Foncier et site", 1, "Titre foncier"), ("", 2, "Plan cadastral"),
                                                   ("B. Projet et marché", 1, "Étude de marché")), start=2):
        room.write_string(r, 0, category)
        room.write_number(r, 1, number)
        room.write_string(r, 2, piece)
    room.write_string(8, 0, "NOTICE EXPLICATIVE — ONGLET DATA_ROOM_INDEX")
    book.close()
    return out.getvalue()


@tagged("post_install", "-at_install")
class TestCompartimentsEtCompletude(TransactionCase):
    def test_suivi_par_compartiment(self):
        domains = [
            {"id": 1, "code": "DOM01", "name": "Marché", "weight": 1.0, "compartment_id": 20, "compartment_code": "C3",
             "compartment_name": "Marché et commercial", "compartment_sequence": 2},
            {"id": 2, "code": "DOM02", "name": "Foncier", "weight": 1.0, "compartment_id": 10, "compartment_code": "C1",
             "compartment_name": "Foncier et autorisations", "compartment_sequence": 1},
            {"id": 3, "code": "DOM03", "name": "Commercial", "weight": 1.0, "compartment_id": 20,
             "compartment_code": "C3", "compartment_name": "Marché et commercial", "compartment_sequence": 2},
        ]
        criteria = [crit(1, 2, domain=1), crit(2, domain=2, knockout=True), crit(3, domain=3), crit(4, domain=2)]
        evaluations = {1: {"status": "met"}, 2: {"status": "not_met", "study": True}, 3: {"status": "partial"},
                       4: {"status": "na"}}
        from odoo.addons.eguitra_axispro import scoring

        r = scoring.compute({"exclude_na": False}, criteria, evaluations, domains, [], [],
                            {"fiche": {}, "hyp": {}, "investment": 0, "capex_criterion_id": None})
        self.assertEqual([c["code"] for c in r["compartments"]], ["C1", "C3"], "Ordre des compartiments")
        c1, c3 = r["compartments"]
        self.assertEqual((c1["criteria"], c1["gaps"], c1["studies"], c1["knockouts"]), (2, 1, 1, 1))
        self.assertAlmostEqual(c1["score"], 50.0, msg="Non applicable compté 1 point")
        self.assertEqual(c3["domains"], ["Marché", "Commercial"])
        self.assertAlmostEqual(c3["score"], (2 + 0.5) / 3 * 100)
        self.assertEqual(c3["gaps"], 1)

    def test_completude_minimale_du_gate(self):
        criteria = [crit(1, gate=1), crit(2, gate=1), crit(3, gate=1), crit(4, gate=2)]
        g1 = gate(1, "prequalification", hold=30, go=50, min_completeness=40)
        r = run(criteria, {1: "met", 2: "partial", 3: "partial", 4: "not_met"}, gates=[gate(0, "intake"), g1])
        decision = r["gates"][1]
        self.assertEqual(decision["decision"], "hold", decision)
        self.assertIn("Complétude documentaire 25,0 %, minimum 40 %", decision["motifs"][0])
        r = run(criteria, {1: "met", 2: "met", 3: "partial", 4: "not_met"}, gates=[gate(0, "intake"), g1])
        self.assertEqual(r["gates"][1]["decision"], "go", "Complétude de 50 % : le gate s'examine")
        cumulative = dict(g1, scope="cumulative", min_completeness=60)
        r = run(criteria, {1: "met", 2: "met", 3: "partial", 4: "not_met"}, gates=[gate(0, "intake"), cumulative])
        self.assertEqual(r["gates"][1]["decision"], "go", "Portée cumulée : 2 critères sur 3 des gates atteints")
        ko = [crit(1, gate=1, knockout=True), crit(2, gate=1)]
        r = run(ko, {1: "not_met", 2: "not_met"}, gates=[g1])
        self.assertEqual(r["gates"][0]["decision"], "no_go", "Un knock-out reste un NO-GO")


@tagged("post_install", "-at_install")
class TestOutilDuCabinet(ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.cabinet = cls.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        cls.env = cls.env(context=dict(cls.env.context, allowed_company_ids=cls.cabinet.ids))
        Policy = cls.env["axispro.policy"]
        cls.previous = Policy.import_grid(cls.cabinet, "Méthode MB AxisPro", "grille.csv", extended_grid())
        cls.previous.action_activate()
        cls.policy = Policy.import_grid(cls.cabinet, "Outil du cabinet v3", "outil.xlsx", cabinet_workbook())
        cls.promoter = cls.env["res.partner"].create({"name": "SPV Soleil"})
        cls.analyste = cls._create_user("analyste3", "cabinet", company_id=cls.cabinet.id,
                                        company_ids=[(6, 0, cls.cabinet.ids)])
        cls.directeur = cls._create_user("directeur3", "direction", company_id=cls.cabinet.id,
                                         company_ids=[(6, 0, cls.cabinet.ids)])

    def test_grille_tiree_de_l_outil(self):
        p = self.policy
        self.assertEqual((p.version, p.state), (self.previous.version + 1, "draft"))
        self.assertEqual((p.threshold_hold, p.conditional_threshold, p.go_threshold, p.threshold_bankable),
                         (30.0, 50.0, 65.0, 80.0))
        self.assertEqual((p.weighting, p.ko_partial_blocks, p.exclude_na, p.dscr_target), ("flat", False, False, 1.4),
                         "Réglages du classeur : knock-out incomplet non bloquant, non applicable à 1 point")
        self.assertEqual(p.notes, "Réf. MBAP/PROJECT-DEVELOPMENT/SC-01 — Essai")
        gates = {g.code: g for g in p.gate_ids}
        self.assertEqual(list(gates), ["G0", "G1", "G2", "G3", "G4"], "Notices ignorées")
        self.assertEqual([g.rule_code for g in gates.values()],
                         ["intake", "prequalification", "feasibility", "apd", "bankability"])
        g1, g2 = gates["G1"], gates["G2"]
        self.assertEqual((g1.threshold_hold, g1.threshold_go, g1.score_scope, g1.min_completeness),
                         (30.0, 50.0, "cumulative", 40.0))
        self.assertEqual((g2.threshold_hold, g2.score_scope), (55.0, "cumulative"))
        self.assertEqual(g2.domain_ids.mapped("name"), ["Analyse de marché", "Maîtrise foncière",
                                                        "Débouchés commerciaux", "Autorisations réglementaires"])
        self.assertEqual(g1.domain_ids.mapped("name"), ["Maîtrise foncière"])
        self.assertEqual((gates["G3"].threshold_hold, gates["G4"].threshold_hold), (50.0, 70.0))
        self.assertEqual([(k.code, k.name) for k in p.compartment_ids.sorted("sequence")],
                         [("C1", "Foncier et autorisations"), ("C3", "Marché et commercial")])
        domains = {d.name: d for d in p.domain_ids}
        self.assertEqual(domains["Autorisations réglementaires"].compartment_id.code, "C1")
        self.assertEqual(domains["Analyse de marché"].deliverable, "Étude de marché à commander",
                         "Livrable type repris du domaine précédent")
        criteria = {c.name: c for c in p.criterion_ids}
        self.assertEqual(len(criteria), 5)
        self.assertEqual((criteria["Étude de marché"].code, criteria["Foncier sécurisé"].code), ("C001", "C002"),
                         "Codes repris de la version précédente")
        self.assertEqual([criteria[n].code for n in ("Contrats d'achat signés", "Agréments sectoriels",
                                                     "Plan cadastral")], ["C006", "C007", "C008"])
        self.assertEqual((criteria["Plan cadastral"].requirement_type, criteria["Plan cadastral"].bankability),
                         ("closing", False))
        self.assertTrue(criteria["Contrats d'achat signés"].evidence_required, "Preuve exigée : knock-out")
        self.assertFalse(criteria["Agréments sectoriels"].evidence_required)
        pieces = {t.name: t for t in p.document_type_ids}
        self.assertEqual((pieces["Titre foncier"].code, pieces["Titre foncier"].criterion_ids.mapped("code"),
                          pieces["Titre foncier"].gate_id.code), ("D001", ["C002"], "G1"),
                         "Pièce et rattachement repris")
        self.assertEqual(pieces["Titre foncier"].category, "C. Foncier et site")
        self.assertFalse(pieces["Plan cadastral"].criterion_ids)
        self.assertEqual(p.integrity()["compartments"], 2)

    def test_bareme_different_refuse(self):
        with self.assertRaises(UserError) as error:
            self.env["axispro.policy"].import_grid(self.cabinet, "Essai", "outil.xlsx", cabinet_workbook(0.25))
        self.assertIn("Incomplet / à actualiser", str(error.exception))

    def test_nouvelle_version_garde_les_compartiments(self):
        draft = self.policy.copy_as_new_version()
        self.assertEqual(sorted(draft.compartment_ids.mapped("code")), ["C1", "C3"])
        self.assertTrue(all(d.compartment_id.policy_id == draft for d in draft.domain_ids))
        self.assertEqual(draft.gate_ids.filtered(lambda g: g.code == "G1").min_completeness, 40.0)

    def test_dossier_par_compartiment(self):
        self.policy.action_activate()
        dossier = self.env["axispro.dossier"].create({
            "name": "Centrale solaire", "promoter_id": self.promoter.id, "company_id": self.cabinet.id,
            "sector": "Énergie", "location": "Kindia",
        })
        token = self.open_session("analyste3", app="axispro")["access_token"]
        status, body = self.call("GET", "/axispro/consultants", token=token)
        self.assertEqual(status, 200, body)
        self.assertIn(self.analyste.id, [u["id"] for u in body])
        self.assertNotIn(self.directeur.id, [u["id"] for u in body])
        c1 = self.policy.compartment_ids.filtered(lambda k: k.code == "C1")
        status, body = self.call("POST", f"/axispro/dossiers/{dossier.id}/assignments",
                                 {"compartment_id": c1.id, "user_id": self.directeur.id}, token=token)
        self.assertEqual(status, 422, "Un compartiment se confie à un consultant du cabinet")
        status, body = self.call("POST", f"/axispro/dossiers/{dossier.id}/assignments",
                                 {"compartment_id": c1.id, "user_id": self.analyste.id}, token=token)
        self.assertEqual(status, 200, body)
        owners = {c["code"]: c["owner"] for c in body["compartments"]}
        self.assertEqual((owners["C1"]["id"], owners["C3"]), (self.analyste.id, None))
        self.env.invalidate_all()
        self.assertTrue(dossier.journal_ids.filtered(lambda j: j.kind == "assignment"))
        status, rows = self.call("GET", f"/axispro/dossiers/{dossier.id}/criteria?mine=1", token=token)
        self.assertEqual(status, 200, rows)
        self.assertEqual(sorted(r["name"] for r in rows), ["Agréments sectoriels", "Foncier sécurisé", "Plan cadastral"])
        self.assertEqual({r["compartment"] for r in rows}, {"C1"})

        # Fiche remplie dans l'outil du cabinet, réimportée : statuts et études à produire.
        content = cabinet_workbook(statuses={"Étude de marché": "Disponible et exploitable"},
                                   studies={"Foncier sécurisé": "Commander le levé topographique"})
        response = self.url_open(f"/api/v1/axispro/dossiers/{dossier.id}/evaluation/import",
                                 files={"file": ("outil.xlsx", io.BytesIO(content), "application/octet-stream")},
                                 headers={"Authorization": f"Bearer {token}"}, method="POST", timeout=60)
        body = response.json()
        self.assertTrue(body["applied"], body)
        self.env.invalidate_all()
        evaluations = {e.criterion_id.name: e for e in dossier.evaluation_ids}
        self.assertEqual(evaluations["Étude de marché"].status, "met")
        self.assertEqual(evaluations["Foncier sécurisé"].deliverable, "Commander le levé topographique")
        compartments = {c["code"]: c for c in dossier.scoring()["compartments"]}
        self.assertEqual((compartments["C1"]["studies"], compartments["C3"]["gaps"]), (1, 1))

        status, body = self.call("POST", f"/axispro/dossiers/{dossier.id}/assignments",
                                 {"compartment_id": c1.id, "user_id": None}, token=token)
        self.assertEqual(status, 200, body)
        self.env.invalidate_all()
        self.assertFalse(dossier.assignment_ids)
        response = self.url_open(f"/api/v1/axispro/dossiers/{dossier.id}/report.xlsx",
                                 headers={"Authorization": f"Bearer {token}"}, timeout=60)
        self.assertEqual(response.status_code, 200)
