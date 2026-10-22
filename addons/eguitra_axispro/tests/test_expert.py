from odoo.exceptions import UserError, ValidationError
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_axispro import engine

GRID = (
    "type;code;libelle;domaine;gate;poids;critique;eliminatoire;preuve;aide;indicateur;seuil;seuil_partiel\n"
    "gate;G0;Idée et opportunité;;;;;;;;;;\n"
    "domaine;D01;Finances;;;1;;;;;;;\n"
    "critere;C001;Étude de marché documentée;D01;G0;1;non;non;non;Fournir l'étude de marché.;;;\n"
    "critere;C002;Couverture du service de la dette;D01;G0;2;oui;non;non;DSCR du modèle.;dscr_min;1,3;1,1\n"
    "critere;C003;Rentabilité du projet;D01;G0;1;non;non;non;;TRI du projet;15;\n"
).encode()

# Projet simple calculé à la main : EBE 400 par an, prêt de 600 à 10 % sur 3 ans, sans impôt ni BFR.
SIMPLE = [
    {"kind": "capex", "name": "Équipement", "amount": 1000, "year": 0, "life": 5},
    {"kind": "revenue", "name": "Ventes", "quantity": 100, "price": 10},
    {"kind": "variable", "name": "Matières", "rate": 40},
    {"kind": "fixed", "name": "Loyer", "category": "external", "amount": 200},
    {"kind": "funding", "name": "Apport", "funding_type": "equity", "amount": 400},
    {"kind": "funding", "name": "Prêt", "funding_type": "loan", "amount": 600, "rate": 10, "life": 3},
]
SIMPLE_PARAMS = {"horizon": 5, "discount_rate": 10, "tax_rate": 0, "receivable_days": 0, "inventory_days": 0,
                 "payable_days": 0, "residual_value": False}


@tagged("post_install", "-at_install")
class TestMoteurFinancier(TransactionCase):
    def test_echeancier_et_taux(self):
        rows = engine.loan_schedule(600.0, 0.10, 3, 0, 0)
        annuity = 600 * 0.10 / (1 - 1.1 ** -3)
        self.assertAlmostEqual(rows[1][1] + rows[1][2], annuity, places=6)
        self.assertAlmostEqual(rows[3][3], 0.0, places=6, msg="Emprunt soldé à son terme")
        grace = engine.loan_schedule(600.0, 0.10, 4, 1, 0)
        self.assertEqual(grace[1][2], 0.0, "Différé : intérêts seuls la première année")
        self.assertAlmostEqual(grace[1][1], 60.0)
        linear = engine.loan_schedule(600.0, 0.10, 3, 0, 0, linear=True)
        self.assertAlmostEqual(linear[2][2], 200.0)
        self.assertAlmostEqual(engine.irr([-100, 60, 60]), 0.130662, places=5)
        self.assertIsNone(engine.irr([100, 50]), "Pas de TRI sans changement de signe")
        self.assertAlmostEqual(engine.npv(0.10, [-100, 110]), 0.0, places=9)

    def test_projet_calcule_a_la_main(self):
        result = engine.analyse(SIMPLE_PARAMS, SIMPLE)
        ind = result["indicators"]
        self.assertAlmostEqual(ind["ebitda_cruise"], 400.0)
        annuity = 600 * 0.10 / (1 - 1.1 ** -3)
        self.assertAlmostEqual(ind["dscr_min"], 400 / annuity, places=6)
        self.assertAlmostEqual(ind["npv"], -1000 + 400 * (1 - 1.1 ** -5) / 0.10, places=4)
        self.assertAlmostEqual(ind["irr_project"], 28.6493, places=3)
        self.assertAlmostEqual(ind["payback"], 2.5, places=6)
        self.assertAlmostEqual(ind["equity_share"], 40.0)
        self.assertAlmostEqual(ind["breakeven_revenue"], (200 + 200) / 0.6, places=6,
                               msg="Point mort de croisière : charges fixes et amortissements sur le taux de marge")
        self.assertEqual(result["financing_plan"]["gap"], 0.0, "Plan de financement initial équilibré")
        self.assertEqual(ind["cash_min"], 0.0)
        self.assertEqual(result["labels"][0], "Inv.")

    def test_impot_reports_exoneration_minimum(self):
        params = dict(engine.DEFAULT_PARAMS, tax_rate=25, min_tax_rate=0, tax_holiday=0, loss_carry_years=0)
        bases, revenue = [0, -100, 50, 80], [0, 1, 1, 1]
        self.assertEqual(engine._taxes(bases, revenue, params), [0.0, 0.0, 0.0, 7.5], "Déficit reporté sans limite")
        self.assertEqual(engine._taxes(bases, revenue, dict(params, loss_carry_years=1)), [0.0, 0.0, 0.0, 20.0],
                         "Déficit perdu au-delà d'un exercice")
        self.assertEqual(engine._taxes([0, 100, 100], [0, 1, 1], dict(params, tax_holiday=1)), [0.0, 0.0, 25.0])
        self.assertEqual(engine._taxes([0, -50], [0, 1000], dict(params, min_tax_rate=1)), [0.0, 10.0],
                         "Impôt minimum dû même en perte")
        self.assertEqual(engine.analyse({"tax_rate": 0}, [])["params"]["tax_rate"], 0.0,
                         "Un taux nul saisi n'est pas remplacé par le taux par défaut")

    def test_sensibilites_et_marges(self):
        stress = engine.stress(SIMPLE_PARAMS, SIMPLE)
        price = next(s for s in stress["sensitivities"] if s["key"] == "price")
        volume = next(s for s in stress["sensitivities"] if s["key"] == "volume")
        self.assertLess(price["rows"][0]["npv"], volume["rows"][0]["npv"],
                        "Une baisse de prix pèse plus qu'une baisse de volume : les coûts variables restent dus")
        self.assertEqual([s["key"] for s in stress["scenarios"]], ["pessimiste", "base", "optimiste"])
        margin = stress["margins"]["price_npv"]
        self.assertTrue(0 < margin < 100)
        self.assertAlmostEqual(engine.analyse(SIMPLE_PARAMS, SIMPLE, {"price": 1 - margin / 100})["indicators"]["npv"],
                               0.0, delta=1.0)
        self.assertEqual(engine.ramp_factors("60 ; 80;100"), [60.0, 80.0, 100.0])


@tagged("post_install", "-at_install")
class TestAxisproExpert(ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.cabinet = cls.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        cls.env = cls.env(context=dict(cls.env.context, allowed_company_ids=cls.cabinet.ids))
        cls.policy = cls.env["axispro.policy"].import_grid(cls.cabinet, "Politique experte", "grille.csv", GRID)
        cls.policy.action_activate()
        cls.promoter = cls.env["res.partner"].create({"name": "Briqueterie du Fouta"})
        cls.bank = cls.env["res.partner"].create({"name": "Banque de démonstration", "is_company": True})
        cls._create_user("expert", "cabinet", company_id=cls.cabinet.id, company_ids=[(6, 0, cls.cabinet.ids)])
        # Second consultant : verrouille la décision sur le modèle financier saisi par l'expert (quatre yeux).
        cls._create_user("expert.relecteur", "cabinet", company_id=cls.cabinet.id,
                         company_ids=[(6, 0, cls.cabinet.ids)])

    def setUp(self):
        super().setUp()
        self.dossier = self.env["axispro.dossier"].create({"name": "Usine de briques", "promoter_id": self.promoter.id,
                                                           "company_id": self.cabinet.id})
        self.token = self.open_session("expert", app="axispro")["access_token"]

    def _fill_plan(self):
        path = f"/axispro/dossiers/{self.dossier.id}/plan"
        status, body = self.call("PATCH", path, SIMPLE_PARAMS, token=self.token)
        self.assertEqual(status, 200, body)
        for line in SIMPLE:
            status, body = self.call("POST", path + "/lines", line, token=self.token)
            self.assertEqual(status, 200, body)
        return body

    def test_import_des_indicateurs_de_la_grille(self):
        c2 = self.policy.criterion_ids.filtered(lambda c: c.code == "C002")
        self.assertEqual((c2.indicator, c2.indicator_threshold, c2.indicator_partial), ("dscr_min", 1.3, 1.1))
        c3 = self.policy.criterion_ids.filtered(lambda c: c.code == "C003")
        self.assertEqual(c3.indicator, "irr_project", "Indicateur reconnu par son libellé")
        self.assertFalse(c3.indicator_has_partial)
        bad = GRID.replace(b"dscr_min;1,3", b"inconnu;1,3")
        with self.assertRaises(UserError):
            self.env["axispro.policy"].import_grid(self.cabinet, "X", "g.csv", bad)

    def test_modele_financier_par_l_api(self):
        status, empty = self.call("GET", f"/axispro/dossiers/{self.dossier.id}/plan", token=self.token)
        self.assertEqual((status, empty["plan"]["id"], empty["lines"]), (200, None, []))
        body = self._fill_plan()
        ind = body["analysis"]["indicators"]
        self.assertAlmostEqual(ind["irr_project"], 28.6493, places=3)
        self.assertEqual(len(body["lines"]), 6)
        loan = next(line for line in body["lines"] if line["funding_type"] == "loan")
        status, body = self.call("PATCH", f"/axispro/plan-lines/{loan['id']}", {"grace": 5}, token=self.token)
        self.assertEqual(status, 422, "Un différé égal ou supérieur à la durée est refusé")
        status, body = self.call("PATCH", f"/axispro/plan-lines/{loan['id']}", {"grace": 1, "life": 4}, token=self.token)
        self.assertEqual(status, 200, body)
        principal = next(r for r in body["analysis"]["debt"] if r["key"] == "principal")["values"]
        self.assertEqual(principal[1], 0.0, "Différé d'un an : pas de capital remboursé en première année")
        self.assertAlmostEqual(body["analysis"]["indicators"]["dscr_min"], 400 / (600 * 0.1 / (1 - 1.1 ** -3)), places=6)
        status, stress = self.call("GET", f"/axispro/dossiers/{self.dossier.id}/plan/stress", token=self.token)
        self.assertEqual(status, 200, stress)
        self.assertEqual(len(stress["sensitivities"]), len(engine.FACTORS))
        response = self.url_open(f"/api/v1/axispro/dossiers/{self.dossier.id}/plan.xlsx",
                                 headers={"Authorization": f"Bearer {self.token}"}, timeout=60)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"PK"))
        status, body = self.call("DELETE", f"/axispro/plan-lines/{loan['id']}", token=self.token)
        self.assertEqual((status, len(body["lines"])), (200, 5))
        with self.assertRaises(ValidationError):
            self.dossier.plan_ids.write({"horizon": 40})

    def test_suggestion_des_criteres_et_instantane_du_comite(self):
        self._fill_plan()
        status, criteria = self.call("GET", f"/axispro/dossiers/{self.dossier.id}/criteria", token=self.token)
        self.assertEqual(status, 200, criteria)
        dscr = next(c for c in criteria if c["code"] == "C002")
        self.assertEqual(dscr["suggestion"]["status"], "met", "DSCR de 1,66 au-dessus du seuil de 1,3")
        tri = next(c for c in criteria if c["code"] == "C003")
        self.assertEqual(tri["suggestion"]["status"], "met")
        self.assertIsNone(next(c for c in criteria if c["code"] == "C001")["suggestion"])
        # Quatre yeux : l'expert a saisi le modèle financier, un second consultant verrouille.
        relecteur = self.open_session("expert.relecteur", app="axispro")["access_token"]
        status, review = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/reviews",
                                   {"decision": "conditional", "conditions": "1. Lever les garanties\n- Signer le bail du site\n\n",
                                    "lock": True}, token=relecteur)
        self.assertEqual(status, 200, review)
        snapshot = self.env["axispro.review"].browse(review["id"]).snapshot
        self.assertAlmostEqual(snapshot["financial"]["irr_project"], 28.6493, places=3)
        actions = self.dossier.action_ids.filtered(lambda a: a.source == "committee")
        self.assertEqual(sorted(actions.mapped("name")), ["Lever les garanties", "Signer le bail du site"],
                         "Chaque condition du comité devient une action du porteur")
        status, _b = self.call("PATCH", f"/axispro/dossiers/{self.dossier.id}/plan", {"discount_rate": 30},
                               token=self.token)
        self.assertEqual(status, 422, "Modèle financier figé par la décision verrouillée")
        status, _b = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/new-revision", token=relecteur)
        self.assertEqual(status, 403, "Celui qui a verrouillé ne rouvre pas")
        status, _b = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/new-revision", token=self.token)
        self.assertEqual(status, 200, _b)
        status, _b = self.call("PATCH", f"/axispro/dossiers/{self.dossier.id}/plan", {"discount_rate": 30},
                               token=self.token)
        self.assertEqual(status, 200, _b)
        status, second = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/reviews", {"decision": "go"},
                                   token=self.token)
        status, diff = self.call("GET", f"/axispro/reviews/compare?a={review['id']}&b={second['id']}", token=self.token)
        self.assertEqual(status, 200, diff)
        npv = next(x for x in diff["financial"] if x["key"] == "npv")
        self.assertGreater(npv["before"], npv["after"], "La comparaison des revues montre l'effet sur la VAN")

    def test_actions_risques_et_portail(self):
        status, body = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/actions/from-gaps", {}, token=self.token)
        self.assertEqual((status, body["created"]), (200, 3), body)
        status, body = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/actions/from-gaps", {}, token=self.token)
        self.assertEqual(body["created"], 0, "Pas de doublon d'une action encore ouverte")
        status, risks = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/risks",
                                  {"name": "Prix du ciment", "category": "market", "probability": 4, "impact": 5,
                                   "mitigation": "Contrat d'approvisionnement à prix ferme"}, token=self.token)
        self.assertEqual(status, 200, risks)
        risk = risks["risks"][0]
        self.assertEqual((risk["score"], risk["level"]), (20, "critical"))
        status, _b = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/risks",
                               {"name": "Hors échelle", "probability": 6, "impact": 1}, token=self.token)
        self.assertEqual(status, 422)
        status, action = self.call("POST", f"/axispro/risks/{risk['id']}/action", token=self.token)
        self.assertEqual((status, action["source"], action["assignee"]), (200, "risk", "porteur"), action)
        self.assertEqual(self.env["axispro.risk"].browse(risk["id"]).state, "mitigating")

        porteur = self._create_user("porteur.briques", "porteur", company_id=self.cabinet.id,
                                    company_ids=[(6, 0, self.cabinet.ids)])
        self.dossier.portal_user_ids = [(4, porteur.id)]
        other = self.env["axispro.dossier"].create({"name": "Autre", "promoter_id": self.promoter.id,
                                                     "company_id": self.cabinet.id})
        foreign = self.env["axispro.action"].create({"dossier_id": other.id, "name": "Action d'un autre dossier"})
        internal = self.env["axispro.action"].create({"dossier_id": self.dossier.id, "name": "Note du cabinet",
                                                      "assignee": "cabinet"})
        ptoken = self.open_session("porteur.briques", app="portail")["access_token"]
        status, view = self.call("GET", f"/portail/dossiers/{self.dossier.id}", token=ptoken)
        self.assertEqual(status, 200, view)
        task_ids = [t["id"] for t in view["tasks"]]
        self.assertNotIn(internal.id, task_ids, "Les actions du cabinet restent internes")
        self.assertEqual(len(task_ids), 4)
        status, _b = self.call("POST", f"/portail/actions/{foreign.id}/report", {"comment": "Fait"}, token=ptoken)
        self.assertEqual(status, 404, "Le porteur n'agit que sur son dossier")
        status, task = self.call("POST", f"/portail/actions/{action['id']}/report",
                                 {"comment": "Contrat signé avec le cimentier"}, token=ptoken)
        self.assertEqual((status, task["state"]), (200, "submitted"), task)
        status, done = self.call("PATCH", f"/axispro/actions/{action['id']}", {"state": "done"}, token=self.token)
        self.assertEqual((status, done["state"]), (200, "done"))
        self.assertTrue(done["done_date"] and done["done_by"], "Validation du cabinet tracée")
        status, _b = self.call("POST", f"/portail/actions/{action['id']}/report", {"comment": "Encore"}, token=ptoken)
        self.assertEqual(status, 422, "Une action validée n'attend plus de compte rendu")

    def test_financements_et_portefeuille(self):
        self._fill_plan()
        status, funding = self.call("POST", f"/axispro/dossiers/{self.dossier.id}/fundings",
                                    {"funder_id": self.bank.id, "instrument": "bank_loan", "amount_requested": 600,
                                     "next_step": "Comité de crédit", "next_date": "2020-01-01"}, token=self.token)
        self.assertEqual(status, 200, funding)
        status, funding = self.call("PATCH", f"/axispro/fundings/{funding['id']}", {"state": "signed", "amount_granted": 550},
                                    token=self.token)
        self.assertEqual((status, funding["state"]), (200, "signed"))
        self.assertTrue(funding["date_decision"], "Date de décision posée à la signature")
        self.env["axispro.action"].create({"dossier_id": self.dossier.id, "name": "Action en retard",
                                           "due_date": "2020-01-01"})
        self.env["axispro.risk"].create({"dossier_id": self.dossier.id, "name": "Change", "probability": 5, "impact": 4})
        status, board = self.call("GET", "/axispro/portfolio", token=self.token)
        self.assertEqual(status, 200, board)
        self.assertGreaterEqual(board["financing"]["granted"], 550)
        self.assertGreaterEqual(board["actions"]["overdue"], 1)
        self.assertGreaterEqual(board["risks"]["critical"], 1)
        mine = next(p for p in board["projects"] if p["id"] == self.dossier.id)
        self.assertAlmostEqual(mine["irr_project"], 28.6493, places=3)
        self.assertEqual(sum(g["count"] for g in board["funnel"]), board["counts"]["open"] + board["counts"]["on_hold"])

    def test_droits_du_mode_expert(self):
        self._create_user("dg.cabinet", "direction", company_id=self.cabinet.id, company_ids=[(6, 0, self.cabinet.ids)])
        dg = self.open_session("dg.cabinet", app="axispro")["access_token"]
        path = f"/axispro/dossiers/{self.dossier.id}"
        self.assertEqual(self.call("GET", path + "/plan", token=dg)[0], 200, "La direction consulte")
        self.assertEqual(self.call("PATCH", path + "/plan", {"horizon": 5}, token=dg)[0], 403, "mais ne modifie pas")
        self.assertEqual(self.call("POST", path + "/risks", {"name": "X"}, token=dg)[0], 403)
        groupe = self.env.ref("base.main_company")
        self._create_user("dg.groupe.seul", "direction", company_id=groupe.id, company_ids=[(6, 0, groupe.ids)])
        other = self.open_session("dg.groupe.seul", app="finance")["access_token"]
        risk = self.env["axispro.risk"].create({"dossier_id": self.dossier.id, "name": "Change"})
        for route in (path + "/plan", f"/axispro/actions?dossier_id={self.dossier.id}", "/axispro/portfolio"):
            self.assertEqual(self.call("GET", route, token=other)[0], 422, f"{route} : module du cabinet")
        dg = self.env["res.users"].search([("login", "=", "dg.groupe.seul")])
        for model in ("axispro.plan", "axispro.risk", "axispro.action", "axispro.funding"):
            self.assertFalse(self.env[model].with_user(dg).with_context(allowed_company_ids=groupe.ids).search([]),
                             f"{model} du cabinet invisible depuis le groupe")
        self.assertTrue(risk.exists())
