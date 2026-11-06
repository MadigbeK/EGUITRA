"""Méthode SC-01 V2.0 : cas de référence T-01 à T-06 (section 13.1), scénarios T-10 à T-15 et T-18, T-19 (13.2), droits
par profil (section 3), règles de gestion RG, bascule d'un dossier et reprise du prototype. Grille numérique de
sc01_cases et libellés fictifs : aucun libellé du cabinet."""

import io
import re
import time
import zipfile
from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_api.files import workbook_sheets
from odoo.addons.eguitra_api.tests.common import PASSWORD, ApiCase
from odoo.addons.eguitra_axispro import reprise, scoring
from odoo.addons.eguitra_axispro.tests import sc01_cases

LETTERS = "ABCDEFGHIJ"
# Grille d'une politique plus ancienne, libellés fictifs : un critère et une pièce retrouvés dans la grille V2.0 d'essai.
LEGACY_GRID = (
    "type;code;libelle;domaine;gate;poids;critique;eliminatoire;preuve;aide\n"
    "gate;G0;Intake;;;;;;;\n"
    "gate;G1;Préqualification;;;;;;;\n"
    "gate;G2;Préfaisabilité;;;;;;;\n"
    "domaine;D01;Juridique;;;1;;;;\n"
    "critere;C001;Critère 0;D01;G0;1;non;non;non;\n"
    "critere;C002;Ancien critère sans équivalent;D01;G0;1;non;non;non;\n"
    "piece;P01;Pièce A;A. Corporate;G0;;oui;;;\n"
).encode()
RG_ADMISSIBLE = "Cochez les 4 conditions de recevabilité avant de déclarer le projet recevable."
RG_IDENTITY = "Renseignez au moins l'intitulé et le promoteur."
RG_CONTRARY = "Décision contraire à la recommandation : saisissez le motif."
CONDITIONS = {"rec_sector": True, "rec_country": True, "rec_size": True, "rec_promoter": True}
PDF = b"%PDF-1.4 piece d'essai"


def ids_of(rows):
    return [row["id"] for row in rows]


def sc01_policy(env, company, activate=True):
    """Politique V2.0 d'essai : 8 gates, 15 domaines, 111 critères numérotés, une pièce attendue par catégorie."""
    last = env["axispro.policy"].search([("company_id", "=", company.id)], order="version desc", limit=1)
    policy = env["axispro.policy"].create({
        "name": "Grille V2.0 d'essai", "version": last.version + 1, "company_id": company.id,
        "method": scoring.METHOD_SC01, "weighting": "flat", "exclude_na": True, "threshold_hold": 30.0,
        "conditional_threshold": 50.0, "go_threshold": 65.0, "threshold_bankable": 80.0, "dscr_target": 1.3,
    })
    gates = env["axispro.gate"].create([{"policy_id": policy.id, "sequence": n, "code": f"G{n}", "name": f"Gate {n}"}
                                        for n in range(sc01_cases.LAST_GATE + 1)])
    domains = env["axispro.domain"].create([{"policy_id": policy.id, "sequence": n, "code": f"DOM{n:02d}", "name": f"Domaine {n}"}
                                            for n in range(1, 16)])
    criteria = env["axispro.criterion"].create([{
        "policy_id": policy.id, "sequence": rank, "code": f"C{rank:03d}", "name": f"Critère {rank}",
        "domain_id": domains[domain - 1].id, "gate_id": gates[gate].id, "weight": weight, "critical": bool(critical),
        "knockout": bool(knockout), "requirement_type": sc01_cases.REQUIREMENTS[kind], "bankability": bool(bankable),
    } for rank, domain, kind, weight, critical, knockout, gate, bankable in sc01_cases.CRITERIA])
    env["axispro.document.type"].create([{
        "policy_id": policy.id, "code": f"P{letter}1", "name": f"Pièce {letter}", "category": f"{letter}. Catégorie {letter}",
    } for letter in LETTERS])
    if activate:
        policy.action_activate()
    return policy, criteria


@tagged("post_install", "-at_install")
class TestMoteurSc01(TransactionCase):
    def test_cas_de_reference(self):
        values = sc01_cases.check_reference_cases(scoring.compute, self.assertEqual)
        self.assertEqual(set(values), {"T-01", "T-02", "T-03", "T-04", "T-05", "T-06"})

    def test_arrondi_comme_excel(self):
        self.assertEqual(scoring.excel_round(2.5), 3.0, "Jamais l'arrondi bancaire")
        self.assertEqual(scoring.excel_round(1.005, 2), 1.01)
        self.assertEqual(scoring.excel_round(55.55, 1), 55.6)

    def test_non_applicable_non_valide_compte_non_disponible(self):
        criteria, domains, gates = sc01_cases.grid()
        ids = [c["id"] for c in criteria]
        notes = {i: {"status": "met"} for i in ids}
        notes[ids[0]] = {"status": "na", "na_validated": False}
        context = {"current_gate_index": 0, "admissible": False, "hyp": {"dscr": None}, "today": None}
        pending = scoring.compute({"method": "sc01_v2"}, criteria, notes, domains, [], gates, context)
        self.assertLess(pending["readiness"], 100.0)
        self.assertEqual(len(pending["na_pending"]), 1)
        notes[ids[0]]["na_validated"] = True
        validated = scoring.compute({"method": "sc01_v2"}, criteria, notes, domains, [], gates, context)
        self.assertEqual(validated["readiness"], 100.0)

    def test_nom_normalise(self):
        day = fields.Date.to_date("2026-10-22")
        self.assertEqual(scoring.piece_name("C", 1, "Lettre d'attribution terrain.PDF", day),
                         "C1_Lettre_d_attribution_terrain_20261022.pdf")
        self.assertEqual(scoring.category_folder("A. Corporate / KYC"), "A_Corporate_KYC")

    def test_message_de_relance(self):
        items = [
            {"label": "Pièce critique", "status": "not_met", "observation": None, "due_date": None, "blocking": True},
            {"label": "Autre pièce", "status": "partial", "observation": "signature absente",
             "due_date": fields.Date.to_date("2026-12-01"), "blocking": False},
        ]
        message = scoring.sc01_relance_message("MBAP-2026-001", "Projet", "Aïssatou Bah", 2, "Préfaisabilité", items, "Consultant")
        self.assertIn("Objet : MBAP-2026-001 · Pièces attendues pour l'évaluation du projet Projet", message)
        self.assertIn("Pièces prioritaires (conditionnent la poursuite du dossier) :\n- Pièce critique", message)
        self.assertIn("- Autre pièce (à compléter ou actualiser : signature absente) · échéance : 01/12/2026", message)
        self.assertTrue(message.endswith("Cordialement,\nConsultant\nMB AxisPro Consulting"))


@tagged("post_install", "-at_install")
class TestDossierSc01(ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.cabinet = cls.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        cls.env = cls.env(context=dict(cls.env.context, allowed_company_ids=cls.cabinet.ids))
        cls.policy, cls.criteria = sc01_policy(cls.env, cls.cabinet)
        both = [(6, 0, cls.cabinet.ids)]
        cls._create_user("sc01.evaluateur", "cabinet", company_id=cls.cabinet.id, company_ids=both)
        cls._create_user("sc01.admin", "associe", company_id=cls.cabinet.id, company_ids=both)
        cls._create_user("sc01.comite", "direction", company_id=cls.cabinet.id, company_ids=both)
        cls._create_user("sc01.lecteur", "lecteur", company_id=cls.cabinet.id, company_ids=both)
        cls.auditeur_hsseq = cls._create_user("sc01.auditeur", "auditeur", company_id=cls.cabinet.id, company_ids=both)

    def setUp(self):
        super().setUp()
        self._tokens = {}

    def _token(self, login):
        """Session ouverte à la demande : une seule connexion par compte et par test."""
        if login not in self._tokens:
            self._tokens[login] = self.open_session(login, app="axispro")["access_token"]
        return self._tokens[login]

    @property
    def evaluateur(self):
        return self._token("sc01.evaluateur")

    @property
    def admin(self):
        return self._token("sc01.admin")

    @property
    def comite(self):
        return self._token("sc01.comite")

    @property
    def lecteur(self):
        return self._token("sc01.lecteur")

    def api(self, method, path, payload=None, token=None):
        self.env.flush_all()
        result = self.call(method, path, payload, token or self.evaluateur)
        self.env.invalidate_all()
        return result

    def deposit(self, dossier_id, files, data=None, token=None):
        self.env.flush_all()
        response = self.url_open(f"/api/v1/axispro/dossiers/{dossier_id}/pieces", data=data or {},
                                 files=[("file", (name, io.BytesIO(content), "application/octet-stream"))
                                        for name, content in files],
                                 headers={"Authorization": f"Bearer {token or self.evaluateur}", "X-Eguitra-App": "test"},
                                 method="POST", timeout=60)
        self.env.invalidate_all()
        return response

    def download(self, path, token=None):
        self.env.flush_all()
        return self.url_open(f"/api/v1{path}", headers={"Authorization": f"Bearer {token or self.evaluateur}",
                                                        "X-Eguitra-App": "test"}, timeout=120)

    def new_project(self, name="Projet d'essai", admissible=False):
        status, body = self.api("POST", "/axispro/dossiers", {"name": name, "promoter_name": "Société d'essai"})
        self.assertEqual(status, 200, body)
        dossier = self.env["axispro.dossier"].browse(body["id"])
        if admissible:
            dossier.with_context(axispro_unlocked=True).write(dict(CONDITIONS, admissible=True))
        return dossier

    def note(self, dossier, ranks=None, **values):
        evaluations = dossier.evaluation_ids
        if ranks is not None:
            wanted = self.criteria.filtered(lambda c: c.sequence in ranks)
            evaluations = evaluations.filtered(lambda e: e.criterion_id in wanted)
        if values:
            evaluations.write(values)
        return evaluations

    # ─── Fiche ────────────────────────────────────────────────────────────

    def test_t10_numerotation(self):
        first = self.new_project("Premier")
        second = self.new_project("Second")
        match = re.fullmatch(r"MBAP-(\d{4})-(\d{3})", first.reference)
        self.assertTrue(match, first.reference)
        self.assertEqual(match.group(1), str(fields.Date.today().year))
        self.assertEqual(second.reference, f"MBAP-{match.group(1)}-{int(match.group(2)) + 1:03d}")

    def test_identite_obligatoire(self):
        status, body = self.api("POST", "/axispro/dossiers", {"name": "Sans promoteur"})
        self.assertEqual((status, body["error"], body["message"]), (400, "missing_fields", RG_IDENTITY))
        status, body = self.api("POST", "/axispro/dossiers", {"name": "Secteur", "promoter_name": "X", "sector": "Inconnu"})
        self.assertEqual((status, body["fields"]), (422, ["sector"]))

    def test_t11_recevabilite(self):
        dossier = self.new_project()
        path = f"/axispro/dossiers/{dossier.id}"
        status, body = self.api("PATCH", path, {"rec_sector": True, "rec_country": True, "rec_size": True, "admissible": True})
        self.assertEqual((status, body["message"], body["fields"]), (422, RG_ADMISSIBLE, ["admissible"]))
        self.assertEqual(dossier.current_gate_id.sequence, 0)
        status, body = self.api("PATCH", path, dict(CONDITIONS, admissible=True))
        self.assertEqual(status, 200, body)
        self.assertEqual(dossier.current_gate_id.sequence, 1, "RG-05-03 : du Gate 0 au Gate 1")
        self.assertTrue(body["admissibility"]["admissible"])
        self.assertEqual(body["admissibility"]["by"], "Sc01.Evaluateur")
        self.assertEqual([s["state"] for s in body["steps"]][0], "Recevable")
        self.assertEqual(len(body["steps"]), 7)
        self.assertEqual(body["steps"][2]["state"], "0 / 111 notés")

    def test_dscr_a_la_virgule(self):
        dossier = self.new_project()
        status, body = self.api("PATCH", f"/axispro/dossiers/{dossier.id}", {"dscr_manual": "1,45"})
        self.assertEqual((status, body["dscr"]), (200, 1.45))

    # ─── Critères ─────────────────────────────────────────────────────────

    def test_observation_obligatoire_et_journal(self):
        dossier = self.new_project()
        evaluation = self.note(dossier, [0])
        path = f"/axispro/evaluations/{evaluation.id}"
        for status_key in ("partial", "na"):
            status, body = self.api("PATCH", path, {"status": status_key})
            self.assertEqual((status, body["fields"]), (422, ["comment"]))
        status, _body = self.api("PATCH", path, {"status": "partial", "comment": "Pièce à actualiser"})
        self.assertEqual(status, 200)
        status, _body = self.api("PATCH", path, {"comment": "Pièce périmée", "reference": "REF-1"})
        self.assertEqual(status, 200)
        entry = self.env["axispro.journal"].search([("dossier_id", "=", dossier.id), ("kind", "=", "evaluation"),
                                                    ("note", "=", "Observation")], limit=1)
        self.assertEqual((entry.before, entry.after), ("Pièce à actualiser", "Pièce périmée"), "RG-07-04")
        self.assertEqual(entry.user_id.login, "sc01.evaluateur")
        self.assertEqual(evaluation.reference, "REF-1")

    def test_validation_non_applicable(self):
        dossier = self.new_project()
        self.note(dossier, status="met")
        evaluation = self.note(dossier, [0], status="na", comment="Sans objet")
        result = dossier.evaluate()
        self.assertLess(result["readiness"], 100.0, "RG-07-03 : compté non disponible avant validation")
        path = f"/axispro/evaluations/{evaluation.id}/validate-na"
        status, _body = self.api("POST", path, {"validated": True})
        self.assertEqual(status, 403, "Évaluateur : pas de validation")
        status, body = self.api("POST", path, {"validated": True}, token=self.admin)
        self.assertEqual((status, body["evaluation"]["na_pending"], body["evaluation"]["na_validated_by"]), (200, False, "Sc01.Admin"))
        self.assertEqual(dossier.evaluate()["readiness"], 100.0)
        status, rows = self.api("GET", f"/axispro/dossiers/{dossier.id}/criteria")
        self.assertEqual(status, 200)
        self.assertEqual((rows[0]["rank"], rows[0]["na_validated"], rows[0]["na_pending"]), (0, True, False))
        evaluation.write({"status": "met"})
        self.assertFalse(evaluation.na_validated, "Un statut qui change retire la validation")

    # ─── Résultats et versions ────────────────────────────────────────────

    def test_versions_figees(self):
        dossier = self.new_project()
        path = f"/axispro/dossiers/{dossier.id}/versions"
        status, first = self.api("POST", path)
        self.assertEqual((status, first["label"], first["readiness"]), (200, "v1", 0.0))
        self.note(dossier, status="met")
        status, second = self.api("POST", path)
        self.assertEqual((status, second["label"], second["readiness"]), (200, "v2", 100.0))
        status, rows = self.api("GET", path, token=self.lecteur)
        self.assertEqual((status, [r["label"] for r in rows]), (200, ["v2", "v1"]))
        status, detail = self.api("GET", f"/axispro/versions/{first['id']}", token=self.lecteur)
        self.assertEqual((status, detail["snapshot"]["notes"][0]["status"]), (200, "not_assessed"))
        version = self.env["axispro.version"].browse(first["id"])
        with self.assertRaises(UserError):
            version.write({"readiness": 50.0})
        with self.assertRaises(UserError):
            version.unlink()
        status, _body = self.api("POST", path, token=self.lecteur)
        self.assertEqual(status, 403)

    def test_resultats(self):
        dossier = self.new_project(admissible=True)
        status, body = self.api("GET", f"/axispro/dossiers/{dossier.id}/resultats", token=self.lecteur)
        self.assertEqual(status, 200)
        self.assertEqual((body["gate"]["index"], body["target_gate"]["index"]), (1, 2))
        self.assertEqual(body["tiles"]["knockouts"], 2)
        self.assertEqual(body["tiles"]["knockouts_next"], 7)
        self.assertEqual(body["tiles"]["decision"], "no_go")
        self.assertEqual(len(body["domains"]), 15)
        self.assertEqual(len(body["gaps_top"]), 20)
        self.assertEqual(body["next_version"], 1)
        self.assertFalse(body["passage"]["favorable"])
        self.assertEqual(body["passage"]["to_name"], "Gate 2")

    # ─── Relances et pilotage ─────────────────────────────────────────────

    def test_t12_t13_t14_suivi_promoteur(self):
        chase = self.new_project("À relancer")
        today = fields.Date.today()
        self.env["axispro.relance"].create({"dossier_id": chase.id, "channel": "phone", "date": today - timedelta(days=15)})
        self.assertEqual(chase.followup()["label"], "À relancer")
        status, board = self.api("GET", "/axispro/pilotage")
        self.assertEqual(status, 200)
        self.assertIn(chase.id, [r["id"] for r in board["to_chase"]])
        status, body = self.api("POST", f"/axispro/dossiers/{chase.id}/relances", {"channel": "email", "note": "Relance"})
        self.assertEqual(status, 200)
        self.assertEqual(body["followup"]["label"], f"Relancé le {today:%d/%m/%Y}")
        self.assertTrue(body["message"].startswith(f"Objet : {chase.reference} · "), "Message de l'annexe D")
        self.assertEqual(len(body["items"]), 20)
        status, board = self.api("GET", "/axispro/pilotage")
        self.assertNotIn(chase.id, [r["id"] for r in board["to_chase"]], "Sorti de la liste")
        late = self.new_project("Échéance dépassée")
        self.note(late, [0], due_date=today - timedelta(days=1))
        info = late.followup()
        self.assertEqual((info["label"], info["tone"]), ("1 échéance(s) dépassée(s)", "rouge"))
        status, board = self.api("GET", "/axispro/pilotage")
        self.assertEqual(board["to_chase"][0]["id"], late.id, "En tête de liste")
        self.assertTrue(board["to_chase"][0]["next_due_overdue"])

    def test_pilotage(self):
        admitted = self.new_project("Prêt", admissible=True)
        self.note(admitted, status="met")
        fresh = self.new_project("À statuer")
        closed = self.new_project("Clos")
        closed.with_context(axispro_unlocked=True).write({"state": "closed"})
        status, board = self.api("GET", "/axispro/pilotage", token=self.lecteur)
        self.assertEqual(status, 200)
        self.assertIn(admitted.id, ids_of(board["ready"]))
        self.assertEqual(next(r for r in board["ready"] if r["id"] == admitted.id)["target_gate"], 2)
        self.assertIn(fresh.id, ids_of(board["to_complete"]))
        self.assertEqual(next(r for r in board["to_complete"] if r["id"] == fresh.id)["reason"], "Recevabilité à statuer")
        self.assertIn(closed.id, ids_of(board["rows"]))
        for key in ("to_chase", "ready", "blocked", "to_complete", "recent"):
            self.assertNotIn(closed.id, ids_of(board[key]), f"{key} : un dossier clos n'y figure pas")
        self.assertEqual(max(g["pct"] for g in board["by_gate"]), 100)
        self.assertEqual(len(board["by_gate"]), 8)
        status, filtered = self.api("GET", "/axispro/pilotage?filtre=apd")
        self.assertIn(admitted.id, ids_of(filtered["rows"]))
        self.assertNotIn(fresh.id, ids_of(filtered["rows"]))
        status, _body = self.api("GET", "/axispro/pilotage?filtre=autre")
        self.assertEqual(status, 400)

    def test_pilotage_500_dossiers_en_moins_de_deux_secondes(self):
        # Charge créée en SQL à partir d'un dossier réel : 500 dossiers et leurs critères, par l'ORM et le module d'audit,
        # dépassent la mémoire allouée au processus de test.
        promoter = self.env["res.partner"].create({"name": "Promoteur de charge"})
        modele = self.env["axispro.dossier"].create({"name": "Charge", "promoter_id": promoter.id, "company_id": self.cabinet.id})
        self.env.flush_all()
        cr = self.env.cr
        cr.execute("""SELECT column_name FROM information_schema.columns
                       WHERE table_name = 'axispro_dossier' AND column_name NOT IN ('id', 'name', 'reference')""")
        colonnes = ", ".join(f'"{row[0]}"' for row in cr.fetchall())
        cr.execute(f"""INSERT INTO axispro_dossier (name, reference, {colonnes})
                       SELECT 'Charge ' || n, 'MBAP-2099-' || lpad(n::text, 3, '0'), {colonnes}
                         FROM axispro_dossier, generate_series(1, 500) AS n WHERE id = %s RETURNING id""", (modele.id,))
        copies = [row[0] for row in cr.fetchall()]
        cr.execute("""SELECT column_name FROM information_schema.columns
                       WHERE table_name = 'axispro_evaluation' AND column_name NOT IN ('id', 'dossier_id')""")
        colonnes = ", ".join(f'"{row[0]}"' for row in cr.fetchall())
        cr.execute(f"""INSERT INTO axispro_evaluation (dossier_id, {colonnes})
                       SELECT d, {colonnes} FROM axispro_evaluation, unnest(%s) AS d WHERE dossier_id = %s""",
                   (copies, modele.id))
        token = self.lecteur  # Session ouverte avant la mesure.
        self.env.flush_all()
        self.env.invalidate_all()
        started = time.perf_counter()
        status, board = self.call("GET", "/axispro/pilotage", token=token)
        elapsed = time.perf_counter() - started
        self.assertEqual(status, 200)
        self.assertGreaterEqual(board["counters"]["projects"], 500)
        self.assertLess(elapsed, 2.0)

    # ─── Comité ───────────────────────────────────────────────────────────

    def test_t15_decision_contraire(self):
        dossier = self.new_project(admissible=True)
        path = f"/axispro/dossiers/{dossier.id}/decisions"
        status, body = self.api("GET", path, token=self.comite)
        self.assertEqual((status, body["can_decide"], body["preselected"]), (200, True, "hold"))
        status, body = self.api("POST", path, {"decision": "go", "from_gate": 1}, token=self.comite)
        self.assertEqual((status, body["message"], body["fields"]), (422, RG_CONTRARY, ["motive"]))
        self.assertEqual(dossier.current_gate_id.sequence, 1)
        self.assertFalse(dossier.review_ids, "Rien n'est créé")
        status, body = self.api("POST", path, {"decision": "go", "from_gate": 1, "motive": "Risque accepté", "members": "A, B"},
                                token=self.comite)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["dossier"]["gate"]["index"], 2)
        self.assertEqual(dossier.current_gate_id.sequence, 2)
        row = body["decisions"][0]
        self.assertEqual((row["gate"], row["decision_label"], row["members"]), ("1 → 2", "GO", "A, B"))
        review = dossier.review_ids
        self.assertEqual(review.state, "locked")
        self.assertTrue(review.verify()["intact"], "Décision scellée")
        self.assertFalse(dossier.locked_review_id, "Le dossier reste modifiable")
        status, _body = self.api("POST", path, {"decision": "hold", "from_gate": 1}, token=self.comite)
        self.assertEqual(status, 409, "Le gate affiché n'est plus le gate courant")
        status, _body = self.api("PATCH", f"/axispro/reviews/{review.id}", {"motive": "Autre"})
        self.assertEqual(status, 422, "Une décision enregistrée n'est plus modifiable")

    def test_hold_et_no_go(self):
        dossier = self.new_project(admissible=True)
        path = f"/axispro/dossiers/{dossier.id}/decisions"
        status, body = self.api("POST", path, {"decision": "hold"}, token=self.comite)
        self.assertEqual((status, body["dossier"]["gate"]["index"]), (200, 1), "HOLD maintient, sans motif : conforme")
        status, body = self.api("POST", path, {"decision": "no_go"}, token=self.comite)
        self.assertEqual((status, body["dossier"]["state"]), (200, "closed"))
        self.assertEqual(dossier.followup()["label"], "Clos")
        status, body = self.api("GET", path, token=self.comite)
        self.assertFalse(body["can_decide"])
        self.assertIn("clos", body["refusal"])

    def test_hold_contraire_se_motive(self):
        dossier = self.new_project(admissible=True)
        self.note(dossier, status="met")
        status, body = self.api("POST", f"/axispro/dossiers/{dossier.id}/decisions", {"decision": "hold"}, token=self.comite)
        self.assertEqual((status, body["message"]), (422, RG_CONTRARY))

    def test_droits_du_comite(self):
        dossier = self.new_project(admissible=True)
        path = f"/axispro/dossiers/{dossier.id}/decisions"
        status, _body = self.api("POST", path, {"decision": "hold"})
        self.assertEqual(status, 403, "Évaluateur : pas de décision")
        status, _body = self.api("POST", path, {"decision": "hold"}, token=self.lecteur)
        self.assertEqual(status, 403, "Lecteur : pas de décision")
        evaluation = self.note(dossier, [0])
        status, _body = self.api("PATCH", f"/axispro/evaluations/{evaluation.id}", {"status": "met"}, token=self.admin)
        self.assertEqual(status, 200)
        status, body = self.api("POST", path, {"decision": "hold"}, token=self.admin)
        self.assertEqual(status, 403, "RG-00-01 : qui a noté ne vote pas")
        self.assertIn("noté des critères", body["message"])
        status, body = self.api("GET", path, token=self.admin)
        self.assertFalse(body["can_decide"])
        self.assertIn("noté des critères", body["refusal"])

    # ─── Pièces ───────────────────────────────────────────────────────────

    def test_pieces_noms_formats_et_rattachement(self):
        dossier = self.new_project()
        response = self.deposit(dossier.id, [("Lettre d'attribution.PDF", PDF), ("note.txt", b"Texte de la note")], {"category": "C"})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        today = f"{fields.Date.today():%Y%m%d}"
        self.assertEqual([p["name"] for p in body["pieces"]],
                         [f"C1_Lettre_d_attribution_{today}.pdf", f"C2_note_{today}.txt"])
        piece = body["pieces"][0]
        self.assertEqual((piece["verification"], piece["verification_label"], piece["source"], piece["category_letter"]),
                         ("to_check", "À vérifier", "team", "C"))
        status, listing = self.api("GET", f"/axispro/dossiers/{dossier.id}/pieces", token=self.lecteur)
        self.assertEqual(status, 200)
        self.assertEqual(listing["count"], 2)
        self.assertEqual(len(listing["categories"]), 10)
        self.assertEqual(next(c for c in listing["categories"] if c["letter"] == "C")["count"], 2)
        evaluation = self.note(dossier, [5])
        status, row = self.api("PATCH", f"/axispro/pieces/{piece['id']}", {"evaluation_id": evaluation.id, "verification": "conforming"})
        self.assertEqual(status, 200, row)
        self.assertEqual((row["verification"], row["criterion"]["rank"]), ("conforming", 5))
        self.assertEqual(evaluation.reference, piece["name"], "La référence vide est renseignée")
        self.assertEqual(evaluation.status, "not_assessed", "RG-06-03 : le statut ne change jamais")
        status, row = self.api("PATCH", f"/axispro/pieces/{piece['id']}", {"evaluation_id": None})
        self.assertIsNone(row["criterion"])
        attachment = self.env["axispro.document"].browse(piece["id"]).attachment_id
        status, _body = self.api("DELETE", f"/axispro/pieces/{piece['id']}")
        self.assertEqual(status, 200)
        self.assertFalse(attachment.exists(), "Le fichier stocké est effacé")
        status, _body = self.api("DELETE", f"/axispro/pieces/{body['pieces'][1]['id']}", token=self.lecteur)
        self.assertEqual(status, 403)

    def test_pieces_refusees(self):
        dossier = self.new_project()
        response = self.deposit(dossier.id, [("virus.exe", b"MZ executable")])
        self.assertEqual(response.status_code, 415)
        self.assertEqual(response.json()["message"], "virus.exe : format non accepté, convertissez-le en PDF")
        self.policy.max_file_mb = 1
        response = self.deposit(dossier.id, [("lourd.pdf", PDF + b"0" * (1024 * 1024))])
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["message"], "lourd.pdf : plus de 1 Mo, compressez le fichier")
        response = self.deposit(dossier.id, [("bon.pdf", PDF), ("virus.exe", b"MZ")])
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual((len(body["pieces"]), body["errors"][0]["file"]), (1, "virus.exe"))
        webp = self.deposit(dossier.id, [("photo.webp", b"RIFF\x10\x00\x00\x00WEBPVP8 ")])
        self.assertEqual(webp.status_code, 200, webp.text)

    def test_business_plan(self):
        dossier = self.new_project()
        response = self.deposit(dossier.id, [("plan.pdf", PDF)], {"business_plan": "1"})
        self.assertEqual(response.status_code, 200, response.text)
        piece = response.json()["pieces"][0]
        self.assertEqual((piece["category_letter"], piece["criterion"]["rank"]), ("B", 0))
        evaluation = self.note(dossier, [0])
        self.assertEqual(evaluation.status, "not_assessed")
        self.assertEqual(evaluation.comment, "Business plan déposé à la création : statut à fixer après vérification")

    def test_t18_dossier_complet(self):
        dossier = self.new_project(admissible=True)
        for n in range(10):
            self.assertEqual(self.deposit(dossier.id, [(f"piece{n}.pdf", PDF)], {"category": "A"}).status_code, 200)
        missing = dossier.document_ids[:1]
        missing.attachment_id.sudo().write({"raw": b""})
        response = self.download(f"/axispro/dossiers/{dossier.id}/dossier.zip", token=self.lecteur)
        self.assertEqual(response.status_code, 200, response.text[:300])
        self.assertIn(f"Dossier_{dossier.reference}.zip", response.headers["Content-Disposition"])
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            names = archive.namelist()
            lost = archive.read("03_Pieces_non_recuperees.txt").decode()
            message = archive.read("02_Relance_promoteur.txt").decode()
        self.assertIn(f"00_Synthese_{dossier.reference}.pdf", names)
        self.assertIn(f"01_Scoring_{dossier.reference}.xlsx", names)
        self.assertEqual(len([n for n in names if n.startswith("Pieces/A_Categorie_A/")]), 9)
        self.assertIn(missing.name, lost)
        self.assertIn("MB AxisPro Consulting", message)

    def test_classeur_de_scoring(self):
        dossier = self.new_project()
        response = self.download(f"/axispro/dossiers/{dossier.id}/scoring.xlsx", token=self.lecteur)
        self.assertEqual(response.status_code, 200)
        sheets = workbook_sheets(response.content)
        self.assertEqual(list(sheets), ["synthese", "scoring", "gaps prioritaires"])
        header = list(sheets["scoring"][0])
        self.assertEqual(header[:3], ["Domaine", "Critère / pièce", "Type d'exigence"])
        self.assertIn("Observation", header)
        self.assertEqual(len(sheets["scoring"]), 112)
        self.assertEqual(len(sheets["gaps prioritaires"]), 21)

    # ─── Droits ───────────────────────────────────────────────────────────

    def test_t19_lecteur(self):
        dossier = self.new_project()
        evaluation = self.note(dossier, [0])
        for method, path, payload in (
            ("POST", "/axispro/dossiers", {"name": "Refus", "promoter_name": "X"}),
            ("PATCH", f"/axispro/dossiers/{dossier.id}", {"name": "Refus"}),
            ("PATCH", f"/axispro/evaluations/{evaluation.id}", {"status": "met"}),
            ("POST", f"/axispro/dossiers/{dossier.id}/relances", {"channel": "email"}),
            ("POST", f"/axispro/evaluations/{evaluation.id}/validate-na", {}),
            ("DELETE", f"/axispro/dossiers/{dossier.id}", {"confirm": dossier.reference}),
        ):
            status, _body = self.api(method, path, payload, token=self.lecteur)
            self.assertEqual(status, 403, f"{method} {path}")
        for path in ("/axispro/reference", "/axispro/pilotage", "/axispro/dossiers", f"/axispro/dossiers/{dossier.id}",
                     f"/axispro/dossiers/{dossier.id}/criteria", f"/axispro/dossiers/{dossier.id}/relances"):
            status, body = self.api("GET", path, token=self.lecteur)
            self.assertEqual(status, 200, f"{path} {body}")
        status, reference = self.api("GET", "/axispro/reference", token=self.lecteur)
        self.assertTrue(reference["rights"]["read_only"])
        self.assertEqual(len(reference["categories"]), 10)
        self.assertEqual(len(reference["sectors"]), 9)
        status, _body = self.api("GET", "/axispro/timesheets", token=self.lecteur)
        self.assertEqual(status, 403, "Le lecteur ne lit pas les temps")

    def test_auditeur_hsseq_sans_acces(self):
        """L'auditeur externe HSSEQ, même ouvert à la société du cabinet, ne lit aucun dossier, ni par l'API ni par
        l'ORM : le filtre de société ne suffit pas, le module ne lui donne aucun droit."""
        dossier = self.new_project()
        status, body = self.call("POST", "/auth/login", {"login": "sc01.auditeur", "password": PASSWORD, "app": "axispro"})
        self.assertEqual((status, body["error"]), (403, "app_forbidden"), "AxisPro ne s'ouvre pas à ce profil")
        # Session ouverte depuis NIMOVA · HSSEQ : jeton émis ici, car ce module peut manquer à la base d'essai.
        token = self.env["eguitra.api.token"]._issue_session(self.auditeur_hsseq, "hsseq", mfa_passed=True)["access_token"]
        for path in ("/axispro/dossiers", f"/axispro/dossiers/{dossier.id}", "/axispro/pilotage", "/axispro/reference",
                     f"/axispro/dossiers/{dossier.id}/criteria", f"/axispro/dossiers/{dossier.id}/documents",
                     f"/axispro/dossiers/{dossier.id}/pieces", f"/axispro/dossiers/{dossier.id}/dossier.zip"):
            status, body = self.api("GET", path, token=token)
            self.assertEqual((status, body["error"]), (403, "forbidden"), path)
        auditeur = self.auditeur_hsseq
        for model in ("axispro.dossier", "axispro.evaluation", "axispro.document", "axispro.plan", "axispro.review"):
            with self.assertRaises(AccessError, msg=model):
                self.env[model].with_user(auditeur).search([])
        with self.assertRaises(AccessError):
            dossier.with_user(auditeur).read(["name"])
        group = self.env.ref("eguitra_base.group_profile_auditeur")
        rights = self.env["ir.model.access"].search([("group_id", "=", group.id), ("model_id.model", "=like", "axispro.%")])
        self.assertFalse(rights, "Le module ne garde aucun droit pour l'auditeur")

    # ─── Évaluateur limité à ses projets (section 3) ─────────────────────

    def test_evaluateur_limite_a_ses_projets(self):
        both = [(6, 0, self.cabinet.ids)]
        self._create_user("sc01.autre", "cabinet", company_id=self.cabinet.id, company_ids=both)
        autre = self._token("sc01.autre")
        dossier = self.new_project()
        evaluation = self.note(dossier, [0])
        for path in (f"/axispro/dossiers/{dossier.id}", f"/axispro/dossiers/{dossier.id}/criteria",
                     f"/axispro/dossiers/{dossier.id}/pieces", f"/axispro/dossiers/{dossier.id}/relances"):
            status, body = self.api("GET", path, token=autre)
            self.assertEqual(status, 404, f"{path} {body}")
        status, body = self.api("PATCH", f"/axispro/evaluations/{evaluation.id}", {"status": "met"}, token=autre)
        self.assertIn(status, (403, 404), body)
        status, pilotage = self.api("GET", "/axispro/pilotage", token=autre)
        self.assertNotIn(dossier.id, ids_of(pilotage["rows"]))
        status, pilotage = self.api("GET", "/axispro/pilotage")
        self.assertIn(dossier.id, ids_of(pilotage["rows"]))
        for token in (self.admin, self.comite, self.lecteur):
            status, body = self.api("GET", f"/axispro/dossiers/{dossier.id}", token=token)
            self.assertEqual(status, 200, body)
        # Le responsable confie son dossier : il ne le voit plus, et le nouveau responsable le voit.
        receiver = self.env["res.users"].search([("login", "=", "sc01.autre")])
        status, body = self.api("POST", f"/axispro/dossiers/{dossier.id}/lead", {"user_id": receiver.id})
        self.assertEqual((status, body.get("handed_over")), (200, True), body)
        self.assertEqual(dossier.consultant_id, receiver)
        status, _body = self.api("GET", f"/axispro/dossiers/{dossier.id}")
        self.assertEqual(status, 404)
        status, body = self.api("GET", f"/axispro/dossiers/{dossier.id}", token=autre)
        self.assertEqual(status, 200, body)
        # Dossier sans responsable : ouvert à tous les évaluateurs.
        dossier.sudo().write({"consultant_id": False})
        status, body = self.api("GET", f"/axispro/dossiers/{dossier.id}")
        self.assertEqual(status, 200, body)

    # ─── Procès-verbal et relance envoyée (RG-10-03, AJ-04) ──────────────

    def test_proces_verbal(self):
        dossier = self.new_project(admissible=True)
        status, body = self.api("POST", f"/axispro/dossiers/{dossier.id}/decisions",
                                {"decision": "hold", "members": "Membre A, Membre B", "motive": "Pièces manquantes.",
                                 "date": str(fields.Date.context_today(dossier))}, token=self.comite)
        self.assertEqual(status, 200, body)
        pv = body["decisions"][0]["pv"]
        response = self.download(pv, token=self.lecteur)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("attachment", response.headers["Content-Disposition"])
        self.assertIn(f"PV_{dossier.reference}", response.headers["Content-Disposition"])
        # En essai, le noyau rend le gabarit sans passer par le convertisseur PDF.
        self.assertIn("Membre A, Membre B", response.text)
        self.assertIn("Pièces manquantes.", response.text)
        self.assertIn(body["decisions"][0]["fingerprint"], response.text)

    def test_relance_envoyee_par_courriel(self):
        dossier = self.new_project()
        payload = {"channel": "email", "send": True, "body": "Objet : Pièces attendues\n\nBonjour <b>Madame</b>,"}
        self.env["ir.mail_server"].sudo().search([]).unlink()
        status, body = self.api("GET", f"/axispro/dossiers/{dossier.id}/relances")
        self.assertFalse(body["email_ready"])
        dossier.with_context(axispro_unlocked=True).write({"contact_email": "contact@example.com"})
        status, body = self.api("POST", f"/axispro/dossiers/{dossier.id}/relances", payload)
        self.assertEqual(status, 422, "Sans serveur d'envoi, rien ne part et rien ne s'enregistre")
        self.assertFalse(dossier.relance_ids)
        self.env["ir.mail_server"].sudo().create({"name": "Essai", "smtp_host": "localhost"})
        status, body = self.api("POST", f"/axispro/dossiers/{dossier.id}/relances", payload)
        self.assertEqual(status, 200, body)
        self.assertTrue(body["email_ready"])
        self.assertEqual(len(body["history"]), 1)
        mail = self.env["mail.mail"].sudo().search([("email_to", "=", "contact@example.com")])
        self.assertEqual((len(mail), mail.subject), (1, "Pièces attendues"))
        self.assertIn("&lt;b&gt;Madame&lt;/b&gt;", str(mail.body_html), "Le message saisi n'est jamais interprété")
        # Sans courriel du contact : refus clair.
        dossier.with_context(axispro_unlocked=True).write({"contact_email": False})
        status, body = self.api("POST", f"/axispro/dossiers/{dossier.id}/relances", payload)
        self.assertEqual((status, body["fields"]), (422, ["contact_email"]), body)

    # ─── Lien de dépôt du promoteur (AJ-02, T-20) ────────────────────────

    def public_deposit(self, token, files, data=None):
        self.env.flush_all()
        response = self.url_open(f"/api/v1/depot/{token}", data=data or {},
                                 files=[("file", (name, io.BytesIO(content), "application/octet-stream"))
                                        for name, content in files], method="POST", timeout=60)
        self.env.invalidate_all()
        return response

    def test_t20_lien_de_depot(self):
        dossier = self.new_project()
        status, link = self.api("POST", f"/axispro/dossiers/{dossier.id}/deposit-links", {})
        self.assertEqual(status, 200, link)
        token = link["token"]
        record = self.env["axispro.deposit.link"].browse(link["id"])
        self.assertNotIn(token, record.token_hash, "Seule l'empreinte du jeton est gardée")
        status, listed = self.api("GET", f"/axispro/dossiers/{dossier.id}/deposit-links")
        self.assertNotIn("token", listed["links"][0], "Le jeton ne se relit jamais")
        # Page publique, sans session : le projet, jamais une note ni un score.
        status, page = self.call("GET", f"/depot/{token}")
        self.assertEqual((status, page["project"], page["deposited"]), (200, dossier.name, []), page)
        self.assertEqual(set(page), {"project", "reference", "company", "expires_at", "formats", "max_file_mb",
                                     "categories", "deposited"})
        self.assertEqual(set(page["categories"][0]), {"letter", "name"})
        # Trois pièces, l'une classée : visibles à l'équipe, « À vérifier », origine portail.
        for name, data in (("a.pdf", None), ("b.pdf", {"category": "C"}), ("c.pdf", None)):
            response = self.public_deposit(token, [(name, PDF)], data)
            self.assertEqual(response.status_code, 200, response.text)
        status, pieces = self.api("GET", f"/axispro/dossiers/{dossier.id}/pieces")
        self.assertEqual(status, 200, pieces)
        documents = dossier.document_ids
        self.assertEqual(len(documents), 3)
        self.assertEqual(set(documents.mapped("verification")), {"to_check"})
        self.assertEqual(set(documents.mapped("source")), {"portal"})
        self.assertEqual(pieces["count"], 3)
        row = next(c for c in pieces["categories"] if c["letter"] == "C")["pieces"][0]
        self.assertEqual((row["source"], row["uploaded_by"]), ("portal", "Promoteur (lien de dépôt)"))
        self.assertEqual(len(pieces["others"]), 2)
        status, page = self.call("GET", f"/depot/{token}")
        self.assertEqual(sorted(p["name"] for p in page["deposited"]), ["a.pdf", "b.pdf", "c.pdf"])
        # La page ne cite que les pièces de ce lien : une pièce de l'équipe n'y paraît pas.
        self.assertEqual(self.deposit(dossier.id, [("equipe.pdf", PDF)]).status_code, 200)
        status, page = self.call("GET", f"/depot/{token}")
        self.assertNotIn("equipe.pdf", [p["name"] for p in page["deposited"]])
        # Refus : format, catégorie, jeton inconnu.
        self.assertEqual(self.public_deposit(token, [("x.exe", b"MZ essai")]).status_code, 415)
        self.assertEqual(self.public_deposit(token, [("d.pdf", PDF)], {"category": "Z"}).status_code, 400)
        self.assertEqual(self.public_deposit("x" * 43, [("d.pdf", PDF)]).status_code, 404)
        status, _body = self.call("GET", "/depot/court")
        self.assertEqual(status, 404)
        # Lien expiré, puis lien retiré : refusés.
        record.sudo().write({"expires_at": fields.Datetime.now() - timedelta(minutes=1)})
        status, body = self.call("GET", f"/depot/{token}")
        self.assertEqual((status, body["error"]), (410, "link_expired"), body)
        self.assertEqual(self.public_deposit(token, [("d.pdf", PDF)]).status_code, 410)
        status, link = self.api("POST", f"/axispro/dossiers/{dossier.id}/deposit-links", {"days": 3})
        status, body = self.api("DELETE", f"/axispro/deposit-links/{link['id']}")
        self.assertEqual(status, 200, body)
        status, body = self.call("GET", f"/depot/{link['token']}")
        self.assertEqual((status, body["error"]), (410, "link_expired"), body)
        # Droits : lecteur et comité ne gèrent pas les liens ; durée hors limites refusée.
        for token_reader in (self.lecteur, self.comite):
            status, _body = self.api("GET", f"/axispro/dossiers/{dossier.id}/deposit-links", token=token_reader)
            self.assertEqual(status, 403)
            status, _body = self.api("POST", f"/axispro/dossiers/{dossier.id}/deposit-links", {}, token=token_reader)
            self.assertEqual(status, 403)
        status, _body = self.api("POST", f"/axispro/dossiers/{dossier.id}/deposit-links", {"days": 400})
        self.assertEqual(status, 400)
        # Dossier clos : plus de dépôt.
        status, link = self.api("POST", f"/axispro/dossiers/{dossier.id}/deposit-links", {})
        dossier.with_context(axispro_unlocked=True).write({"state": "closed"})
        status, body = self.call("GET", f"/depot/{link['token']}")
        self.assertEqual(status, 410, body)

    def test_suppression(self):
        dossier = self.new_project()
        self.assertEqual(self.deposit(dossier.id, [("piece.pdf", PDF)], {"category": "A"}).status_code, 200)
        attachment = dossier.document_ids.attachment_id
        path = f"/axispro/dossiers/{dossier.id}"
        status, _body = self.api("DELETE", path, {"confirm": dossier.reference})
        self.assertEqual(status, 403, "Évaluateur : pas de suppression")
        status, body = self.api("DELETE", path, {"confirm": "autre"}, token=self.admin)
        self.assertEqual((status, body["fields"]), (400, ["confirm"]))
        status, _body = self.api("DELETE", path, {"confirm": dossier.reference}, token=self.admin)
        self.assertEqual(status, 200)
        self.assertFalse(dossier.exists())
        self.assertFalse(attachment.exists())

    def test_referentiel_reserve_a_l_administrateur(self):
        policy, _criteria = sc01_policy(self.env, self.cabinet, activate=False)
        path = f"/axispro/policies/{policy.id}"
        status, _body = self.api("PATCH", path, {"notes": "Refus"})
        self.assertEqual(status, 403)
        status, body = self.api("PATCH", path, {"relance_days": 21}, token=self.admin)
        self.assertEqual((status, body["relance_days"], body["method"]), (200, 21, "sc01_v2"))
        status, _body = self.api("POST", f"{path}/activate")
        self.assertEqual(status, 403)
        # Brouillon de l'ancienne méthode : un évaluateur ne le fait pas passer en V2.0 ni n'en règle les paramètres.
        policy.write({"method": "platform"})
        for payload in ({"method": "sc01_v2"}, {"points_partial": 1}, {"relance_days": 1}):
            status, _body = self.api("PATCH", path, payload)
            self.assertEqual(status, 403, payload)
        self.assertEqual(policy.method, "platform")

    def test_ancienne_methode(self):
        legacy = self.env["axispro.policy"].import_grid(self.cabinet, "Ancienne", "grille.csv", LEGACY_GRID)
        promoter = self.env["res.partner"].create({"name": "Ancien promoteur"})
        dossier = self.env["axispro.dossier"].create({"name": "Ancien", "promoter_id": promoter.id, "policy_id": legacy.id,
                                                      "company_id": self.cabinet.id})
        status, body = self.api("GET", f"/axispro/dossiers/{dossier.id}/resultats")
        self.assertEqual((status, body["error"]), (422, "legacy_method"))
        status, body = self.api("GET", f"/axispro/dossiers/{dossier.id}")
        self.assertEqual((status, body["method"], body["steps"]), (200, "platform", []))
        status, board = self.api("GET", "/axispro/pilotage")
        self.assertEqual(next(r for r in board["rows"] if r["id"] == dossier.id)["method"], "platform")


@tagged("post_install", "-at_install")
class TestRepriseSc01(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.cabinet = cls.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        cls.env = cls.env(context=dict(cls.env.context, allowed_company_ids=cls.cabinet.ids))
        cls.old = cls.env["axispro.policy"].import_grid(cls.cabinet, "Version 3", "grille.csv", LEGACY_GRID)
        cls.target, cls.criteria = sc01_policy(cls.env, cls.cabinet)
        cls.promoter = cls.env["res.partner"].create({"name": "Promoteur d'essai"})

    def test_bascule(self):
        dossier = self.env["axispro.dossier"].create({"name": "À basculer", "promoter_id": self.promoter.id,
                                                      "policy_id": self.old.id, "company_id": self.cabinet.id})
        gates = self.old.gate_ids.sorted("sequence")
        dossier.current_gate_id = gates[1]
        evaluations = {e.criterion_id.name: e for e in dossier.evaluation_ids}
        evaluations["Critère 0"].write({"status": "partial", "comment": "À actualiser", "responsible": "Promoteur"})
        evaluations["Ancien critère sans équivalent"].write({"status": "met"})
        attachment = self.env["ir.attachment"].create({"name": "statuts.pdf", "raw": PDF})
        document = self.env["axispro.document"].create({
            "dossier_id": dossier.id, "name": "Statuts", "attachment_id": attachment.id,
            "document_type_id": self.old.document_type_ids.id,
        })
        evaluations["Critère 0"].write({"document_ids": [(4, document.id)]})
        summary = dossier.switch_policy(self.target)
        self.assertEqual((summary["moved"], summary["lost"], summary["gate"]), (1, ["Ancien critère sans équivalent"], 1))
        self.assertEqual(dossier.policy_id, self.target)
        self.assertEqual(dossier.current_gate_id.sequence, 1)
        self.assertEqual(len(dossier.evaluation_ids), 111)
        kept = dossier.evaluation_ids.filtered(lambda e: e.criterion_id.name == "Critère 0")
        self.assertEqual((kept.status, kept.comment, kept.responsible), ("partial", "À actualiser", "Promoteur"))
        self.assertEqual(kept.document_ids, document)
        self.assertEqual((document.category_letter, document.category_rank), ("A", 1))
        self.assertEqual(document.document_type_id.policy_id, self.target)
        self.assertTrue(dossier.admissible, "Au-delà du Gate 0, tenu pour recevable")
        self.assertEqual(dossier.evaluate()["method"], scoring.METHOD_SC01)
        self.assertIn("Ancien critère", dossier.journal_ids.filtered(lambda j: j.kind == "import").note)
        self.assertIsNone(dossier.switch_policy(self.target), "Idempotent")

    def test_reprise_du_prototype(self):
        reference = "MBAP-2026-901"
        doc = {
            "num": reference, "intitule": "Projet du prototype", "promoteur": "Promoteur repris", "contact": "A. Bah",
            "email": "a.bah@exemple.gn", "tel": "+224 600 00 00 01", "secteur": "Énergie", "localisation": "Kindia",
            "capex": "12 500 000 USD", "financement": "environ 8 M", "description": "Essai", "gate": 2, "recevable": True,
            "rec": [True, True, True, True], "dscr": "1,3",
            "notes": {"0": {"s": "OK", "resp": "Bah", "ech": "2027-01-15", "obs": "", "ref": "R1"},
                      "1": {"s": "NA", "obs": "Sans objet"}, "2": {"s": "INC", "obs": "À compléter"}},
            "pieces": [{"id": "a" * 32, "nom": "A1_Statuts_20261103.pdf", "orig": "Statuts.pdf", "cat": 0, "crit": 0,
                        "verif": "Conforme", "date": "2026-11-03", "taille": 10, "type": "application/pdf"},
                       {"id": "b" * 32, "nom": "A2_Perdue_20261103.pdf", "orig": "Perdue.pdf", "cat": 0, "crit": None,
                        "verif": "À vérifier", "date": "2026-11-03", "taille": 10, "type": "application/pdf"}],
            "relances": [{"date": "2026-11-01", "canal": "Courriel", "note": "Première relance", "par": "x"}],
            "decisions": [{"date": "2026-11-02", "gate": "1 → 2", "decision": "GO", "membres": "A, B", "motif": "", "r": 12.5, "par": "x"}],
            "versions": [{"date": "2026-11-02", "r": 12.5, "apd": 10.0, "bank": 9.0, "ko": 1, "gate": 1}],
        }
        bilan = reprise.import_project(self.env, doc, self.target, lambda identifier: PDF if identifier == "a" * 32 else None)
        self.assertTrue(bilan["created"])
        self.assertEqual(bilan["missing"], ["A2_Perdue_20261103.pdf"])
        dossier = self.env["axispro.dossier"].search([("reference", "=", reference)])
        self.assertEqual(dossier.current_gate_id.sequence, 2)
        self.assertTrue(dossier.admissible)
        self.assertEqual(dossier.investment, 12500000.0)
        self.assertEqual(dossier.financing_need, 0.0, "Montant illisible : le texte reste dans la description")
        self.assertIn("environ 8 M", dossier.description)
        self.assertEqual(dossier.dscr_manual, 1.3)
        rows = {e.criterion_id.sequence: e for e in dossier.evaluation_ids}
        self.assertEqual((rows[0].status, rows[0].reference), ("met", "R1"))
        self.assertTrue(rows[1].na_validated)
        self.assertEqual(rows[2].status, "partial")
        self.assertEqual(len(dossier.document_ids), 1)
        self.assertEqual(dossier.document_ids.evaluation_ids, rows[0])
        self.assertEqual((dossier.review_ids.decision, dossier.review_ids.state), ("go", "locked"))
        self.assertEqual(dossier.decision, "go")
        self.assertEqual(dossier.version_ids.rank, 1)
        self.assertEqual(dossier.relance_ids.channel, "email")
        again = reprise.import_project(self.env, doc, self.target, lambda identifier: PDF)
        self.assertFalse(again["created"], "Idempotent")
        self.assertEqual(self.env["axispro.dossier"].search_count([("reference", "=", reference)]), 1)
        self.assertEqual(reprise.gap(again["scores"], again["scores"]), 0.0)
