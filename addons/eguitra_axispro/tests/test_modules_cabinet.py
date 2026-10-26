"""Modules du cabinet (audit du noyau et de l'application web, lot 3) : devise du dossier dans le
portefeuille, les financements et le modèle financier (I-X3), seuil partiel égal à 0 (I-X4), nombres
à la française dans les textes, poids, heures et taux horaire contrôlés (M8)."""

import re

from odoo.exceptions import UserError, ValidationError
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_axispro import engine
from odoo.addons.eguitra_axispro.models.timesheet import heures
from odoo.addons.eguitra_axispro.tests.test_expert import SIMPLE, SIMPLE_PARAMS

NBSP = " "
HEADER = ("type", "code", "libelle", "domaine", "gate", "poids", "critique", "eliminatoire", "preuve", "aide",
          "indicateur", "seuil", "seuil_partiel", "criteres")
ROWS = (
    {"type": "gate", "code": "G0", "libelle": "Idée et opportunité"},
    {"type": "gate", "code": "G1", "libelle": "Étude de faisabilité"},
    {"type": "domaine", "code": "D01", "libelle": "Finances", "poids": "1"},
    {"type": "domaine", "code": "D02", "libelle": "Juridique", "poids": "1"},
    {"type": "critere", "code": "C001", "libelle": "Société immatriculée", "domaine": "D02", "gate": "G0", "poids": "1",
     "critique": "non", "eliminatoire": "non", "preuve": "non"},
    # VAN : satisfait à 1 000, incomplet dès 0 (seuil partiel nul, I-X4).
    {"type": "critere", "code": "C002", "libelle": "Valeur créée par le projet", "domaine": "D01", "gate": "G0",
     "poids": "2", "critique": "non", "eliminatoire": "non", "preuve": "non", "indicateur": "npv", "seuil": "1000",
     "seuil_partiel": "0"},
    {"type": "critere", "code": "C003", "libelle": "Plan de financement établi", "domaine": "D01", "gate": "G1",
     "poids": "1", "critique": "non", "eliminatoire": "non", "preuve": "non"},
    {"type": "piece", "code": "P01", "libelle": "Statuts de la société", "domaine": "Juridique", "gate": "G0",
     "critique": "oui", "aide": "Copie certifiée.", "criteres": "C001"},
    {"type": "piece", "code": "P02", "libelle": "Plan d'affaires", "domaine": "Projet", "gate": "G1", "critique": "oui"},
)
GRID = ("\n".join([";".join(HEADER)] + [";".join(row.get(h, "") for h in HEADER) for row in ROWS]) + "\n").encode()

# Plan de financement initial déséquilibré : 1 000 investis, 400 apportés, ni BFR ni impôt.
GAP = [
    {"kind": "capex", "name": "Équipement", "amount": 1000, "year": 0, "life": 5},
    {"kind": "revenue", "name": "Ventes", "quantity": 100, "price": 10},
    {"kind": "funding", "name": "Apport", "funding_type": "equity", "amount": 400},
]


@tagged("post_install", "-at_install")
class TestModulesCabinetMoteur(TransactionCase):
    def test_seuil_partiel_nul(self):
        """I-X4 : un seuil partiel de 0 compte (0.0 == False en Python l'écartait)."""
        self.assertEqual(engine.suggest("npv", 1000, 0.0, {"npv": 500})["status"], "partial")
        self.assertEqual(engine.suggest("npv", 1000, 0.0, {"npv": -1})["status"], "not_met")
        self.assertEqual(engine.suggest("npv", 1000, None, {"npv": 500})["status"], "not_met", "Sans seuil partiel")
        self.assertEqual(engine.suggest("npv", 1000, 0.0, {"npv": 1000})["status"], "met")
        self.assertEqual(engine.suggest("payback", 3, 0.0, {"payback": 2})["status"], "met", "Plus bas est meilleur")
        self.assertEqual(engine.suggest("npv", 1000, 0.0, {"npv": None}), {"status": None, "value": None})

    def test_unite_des_indicateurs_en_montant(self):
        """I-X3 : aucune devise écrite en dur ; un montant prend la devise du dossier."""
        units = {key: unit for key, (_label, _higher, unit) in engine.INDICATORS.items()}
        self.assertNotIn("GNF", units.values())
        self.assertEqual((units["npv"], units["cash_min"]), (engine.MONEY, engine.MONEY))
        self.assertEqual(engine.indicator_unit("npv", "USD"), "USD")
        self.assertEqual(engine.indicator_unit("cash_min"), "devise du dossier")
        self.assertEqual(engine.indicator_unit("dscr_min", "USD"), "x", "Un ratio garde son unité")

    def test_nombres_a_la_francaise(self):
        """M8 : virgule décimale et milliers groupés dans les textes du noyau, jamais « 1.3 »."""
        self.assertEqual(engine.nombre(1234567.4), "1 234 567")
        self.assertEqual(engine.nombre(1.254, 2), "1,25")
        self.assertEqual(engine.nombre(-0.4), "0", "Jamais « -0 »")
        self.assertEqual((engine.taux(12.5), engine.taux(12), engine.taux(1.3), engine.taux(0)), ("12,5", "12", "1,3", "0"))
        self.assertEqual((heures(7.5), heures(8), heures(1234.25), heures(0.75)), ("7,5", "8", "1 234,25", "0,75"))

    def test_alertes_du_modele_a_la_francaise_et_dans_la_devise(self):
        """M8 et I-X3 : alertes du modèle sans point décimal, montants suivis de la devise du dossier."""
        params = {"horizon": 5, "discount_rate": 12.5, "tax_rate": 0, "receivable_days": 0, "inventory_days": 0,
                  "payable_days": 0, "residual_value": False, "dscr_target": 2.5, "equity_target": 50.5}
        lines = [
            {"kind": "capex", "name": "Usine", "amount": 1000, "year": 0, "life": 5},
            {"kind": "revenue", "name": "Ventes", "quantity": 10, "price": 10},
            {"kind": "funding", "name": "Apport", "funding_type": "equity", "amount": 100},
            {"kind": "funding", "name": "Prêt", "funding_type": "loan", "amount": 300, "rate": 10, "life": 10},
        ]
        alerts = engine.analyse(params, lines, currency="USD")["alerts"]
        text = " ".join(alerts)
        self.assertIn(f"VAN négative au taux d'actualisation de 12,5{NBSP}%", text)
        self.assertIn("sous l'exigence de 2,50.", text)
        self.assertIn(f"sous le minimum de 50,5{NBSP}%.", text)
        self.assertIn(f"Plan de financement initial déséquilibré : 600{NBSP}USD de ressources manquantes.", alerts)
        self.assertTrue(any(a.startswith("Trésorerie cumulée négative") and a.endswith(f"{NBSP}USD est nécessaire.")
                            for a in alerts), alerts)
        self.assertTrue(any(a.startswith("Dette restant due en fin d'horizon") and a.endswith(f"{NBSP}USD.")
                            for a in alerts), alerts)
        self.assertFalse(re.search(r"\d\.\d", text), f"Point décimal dans les alertes : {text}")
        self.assertNotIn("GNF", text)
        unlabelled = engine.analyse(params, lines)["alerts"]
        self.assertIn("Plan de financement initial déséquilibré : 600 de ressources manquantes.", unlabelled,
                      "Sans devise connue, le montant seul")


@tagged("post_install", "-at_install")
class TestModulesCabinetApi(ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.cabinet = cls.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
        cls.env = cls.env(context=dict(cls.env.context, allowed_company_ids=cls.cabinet.ids))
        cls.policy = cls.env["axispro.policy"].import_grid(cls.cabinet, "Grille du lot 3", "grille.csv", GRID)
        cls.policy.action_activate()
        cls.promoter = cls.env["res.partner"].create({"name": "Rizerie de Kankan"})
        cls.bank = cls.env["res.partner"].create({"name": "Banque des projets", "is_company": True})
        cls._create_user("consultant.lot3", "cabinet", company_id=cls.cabinet.id, company_ids=[(6, 0, cls.cabinet.ids)])
        # Devise autre que celle de la société, pour un dossier chiffré en devise étrangère.
        euro, dollar = cls.env.ref("base.EUR"), cls.env.ref("base.USD")
        cls.foreign = dollar if cls.cabinet.currency_id == euro else euro
        cls.foreign.active = True

    def setUp(self):
        super().setUp()
        self.token = self.open_session("consultant.lot3", app="axispro")["access_token"]

    def call(self, *args, **kwargs):
        # Écritures du test en base avant que le noyau, qui répond dans un autre fil, ne les lise.
        self.env.flush_all()
        return super().call(*args, **kwargs)

    def _dossier(self, **values):
        return self.env["axispro.dossier"].create(dict({"name": "Rizerie", "promoter_id": self.promoter.id,
                                                        "company_id": self.cabinet.id}, **values))

    def _plan(self, dossier, lines=SIMPLE, params=SIMPLE_PARAMS):
        plan = self.env["axispro.plan"].create(dict(params, dossier_id=dossier.id))
        self.env["axispro.plan.line"].create([dict(line, plan_id=plan.id) for line in lines])
        return plan

    def _evaluation(self, dossier, code):
        return dossier.evaluation_ids.filtered(lambda e: e.criterion_id.code == code)

    # ─── I-X3 : devise du dossier ─────────────────────────────────────────

    def test_portefeuille_totalise_par_devise(self):
        """I-X3 : 500 € de besoin ne s'ajoutent pas aux GNF ; chaque devise a ses totaux, les montants simples
        ne portent que sur la devise de la société."""
        local = self.cabinet.currency_id
        sector_name = "Agro-industrie (essai du lot 3)"
        d_local = self._dossier(name="Rizerie", sector=sector_name, financing_need=1_000_000, investment=2_000_000)
        d_foreign = self._dossier(name="Centrale solaire", sector=sector_name, currency_id=self.foreign.id,
                                  financing_need=500, investment=800)
        Funding = self.env["axispro.funding"]
        Funding.create({"dossier_id": d_local.id, "funder_id": self.bank.id, "amount_requested": 600_000,
                        "amount_granted": 400_000, "state": "signed"})
        f_foreign = Funding.create({"dossier_id": d_foreign.id, "funder_id": self.bank.id, "amount_requested": 300,
                                    "amount_granted": 250, "state": "disbursed"})
        self.assertEqual(f_foreign.currency_id, self.foreign, "Une démarche suit la devise de son dossier")

        status, board = self.call("GET", "/axispro/portfolio", token=self.token)
        self.assertEqual(status, 200, board)
        live = self.env["axispro.dossier"].search([("company_id", "=", self.cabinet.id),
                                                   ("state", "in", ("open", "on_hold"))])
        fundings = Funding.search([("dossier_id", "in", live.ids)])

        def expected(currency):
            dossiers = live.filtered(lambda d: d.currency_id == currency)
            mine = fundings.filtered(lambda f: f.currency_id == currency)
            return {"need": sum(dossiers.mapped("financing_need")), "investment": sum(dossiers.mapped("investment")),
                    "requested": sum(mine.filtered(lambda f: f.state not in ("rejected", "withdrawn"))
                                     .mapped("amount_requested")),
                    "granted": sum(mine.filtered(lambda f: f.state in ("signed", "disbursed")).mapped("amount_granted"))}

        financing = board["financing"]
        self.assertEqual(board["currency"], local.name)
        rows = {r["currency"]: r for r in financing["by_currency"]}
        self.assertEqual(financing["by_currency"][0]["currency"], local.name, "La devise de la société en tête")
        for currency in (local, self.foreign):
            for key, value in expected(currency).items():
                self.assertAlmostEqual(rows[currency.name][key], value, places=2, msg=f"{currency.name} {key}")
        for key, value in expected(local).items():
            self.assertAlmostEqual(financing[key], value, places=2,
                                   msg=f"{key} : la devise de la société seule, sans les {self.foreign.name}")
        self.assertGreaterEqual(rows[self.foreign.name]["granted"], 250.0)
        staged = live.filtered("current_gate_id")
        for currency in (local, self.foreign):
            on_gates = sum(g["need_by_currency"].get(currency.name, 0.0) for g in board["funnel"])
            self.assertAlmostEqual(on_gates, sum(staged.filtered(lambda d, c=currency: d.currency_id == c)
                                                 .mapped("financing_need")), places=2, msg=currency.name)
        self.assertAlmostEqual(sum(g["need"] for g in board["funnel"]),
                               sum(g["need_by_currency"].get(local.name, 0.0) for g in board["funnel"]), places=2,
                               msg="Besoin d'une étape : la devise de la société seule")
        sector = next(s for s in board["sectors"] if s["label"] == sector_name)
        self.assertEqual(sector["investment_by_currency"], {local.name: 2_000_000.0, self.foreign.name: 800.0})
        self.assertEqual((sector["count"], sector["investment"]), (2, 2_000_000.0), "Les 800 en devise ne s'ajoutent pas")
        project = next(p for p in board["projects"] if p["id"] == d_foreign.id)
        self.assertEqual((project["currency"], project["financing_need"]), (self.foreign.name, 500.0))
        disbursed = next(p for p in financing["pipeline"] if p["state"] == "disbursed")
        split = {r["currency"]: r for r in disbursed["by_currency"]}
        foreign_disbursed = fundings.filtered(lambda f: f.state == "disbursed" and f.currency_id == self.foreign)
        self.assertAlmostEqual(split[self.foreign.name]["granted"], sum(foreign_disbursed.mapped("amount_granted")),
                               places=2)
        self.assertAlmostEqual(disbursed["granted"], split.get(local.name, {}).get("granted", 0.0), places=2)
        self.assertEqual(board["fees"]["currency"], local.name)

        status, rows = self.call("GET", f"/axispro/fundings?dossier_id={d_foreign.id}", token=self.token)
        self.assertEqual((status, rows[0]["currency"]), (200, self.foreign.name), rows)

    def test_modele_financier_dans_la_devise_du_dossier(self):
        """I-X3 : le modèle d'un dossier en devise étrangère s'y chiffre (alertes, indicateurs en montant,
        suggestion d'un critère adossé à la VAN), et dit le verrou du comité."""
        dossier = self._dossier(name="Centrale solaire", currency_id=self.foreign.id)
        self._plan(dossier, GAP)
        status, body = self.call("GET", f"/axispro/dossiers/{dossier.id}/plan", token=self.token)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["dossier"]["currency"], self.foreign.name)
        self.assertIs(body["dossier"]["locked"], False)
        self.assertEqual(body["options"]["indicators"]["npv"]["unit"], self.foreign.name)
        self.assertTrue(body["options"]["indicators"]["npv"]["money"])
        self.assertEqual(body["options"]["indicators"]["dscr_min"]["unit"], "x")
        self.assertIn(f"Plan de financement initial déséquilibré : 600{NBSP}{self.foreign.name} de ressources "
                      "manquantes.", body["analysis"]["alerts"])
        self.assertNotIn("GNF", " ".join(body["analysis"]["alerts"]))
        status, criteria = self.call("GET", f"/axispro/dossiers/{dossier.id}/criteria", token=self.token)
        self.assertEqual(status, 200, criteria)
        npv = next(c for c in criteria if c["code"] == "C002")["suggestion"]
        self.assertEqual((npv["unit"], npv["currency"], npv["money"]), (self.foreign.name, self.foreign.name, True))
        status, policy = self.call("GET", f"/axispro/policies/{self.policy.id}", token=self.token)
        self.assertEqual(policy["indicators"]["npv"]["unit"], "devise du dossier",
                         "Une grille sert des dossiers de toutes devises")
        response = self.url_open(f"/api/v1/axispro/dossiers/{dossier.id}/plan.xlsx",
                                 headers={"Authorization": f"Bearer {self.token}"}, timeout=60)
        self.assertEqual(response.status_code, 200)

    # ─── I-X4 : seuil partiel nul ─────────────────────────────────────────

    def test_seuil_partiel_nul_dans_le_dossier(self):
        """I-X4 : VAN de 516 sous le seuil de 1 000 mais au-dessus du seuil partiel de 0 : « incomplet »
        suggéré, et aucune anomalie quand l'évaluateur retient ce statut."""
        dossier = self._dossier()
        self._plan(dossier)
        status, criteria = self.call("GET", f"/axispro/dossiers/{dossier.id}/criteria", token=self.token)
        self.assertEqual(status, 200, criteria)
        suggestion = next(c for c in criteria if c["code"] == "C002")["suggestion"]
        self.assertEqual((suggestion["status"], suggestion["partial"]), ("partial", 0.0), suggestion)
        self.assertAlmostEqual(suggestion["value"], -1000 + 400 * (1 - 1.1 ** -5) / 0.10, places=4)
        self._evaluation(dossier, "C002").write({"status": "partial"})
        self.assertFalse([a for a in dossier.evaluate()["anomalies"] if a.startswith("C002")],
                         "Statut conforme à la suggestion : pas d'anomalie")
        self._evaluation(dossier, "C002").write({"status": "met"})
        self.assertTrue([a for a in dossier.evaluate()["anomalies"] if a.startswith("C002")],
                        "Statut contraire à la suggestion : anomalie")

    # ─── M8 : nombres à la française ──────────────────────────────────────

    def test_heures_de_la_facture_a_la_francaise(self):
        """M8 : la facture d'honoraires imprime « (1,5 h) », jamais « (1.5 h) »."""
        dossier = self._dossier()
        sheets = self.env["axispro.timesheet"].create({"dossier_id": dossier.id, "hours": 1.5, "description": "Analyse"})
        names = sheets.action_invoice(200_000).invoice_line_ids.mapped("name")
        self.assertTrue(any(name.endswith("(1,5 h)") for name in names), names)

    # ─── M8 : saisies contrôlées ──────────────────────────────────────────

    def test_poids_et_reglages_de_la_grille_controles(self):
        """M8 et C1 : ni poids négatif, ni DSCR bancaire vide ou nul, ni seuil d'indicateur vide, ni intitulé vide
        dans l'éditeur de la grille."""
        draft = self.policy.copy_as_new_version()
        domain = draft.domain_ids.filtered(lambda d: d.code == "D01")
        criterion = draft.criterion_ids.filtered(lambda c: c.code == "C002")
        for path, payload, field in (
            (f"/axispro/domains/{domain.id}", {"weight": -1}, "weight"),
            (f"/axispro/domains/{domain.id}", {"weight": None}, "weight"),
            (f"/axispro/domains/{domain.id}", {"name": ""}, "name"),
            (f"/axispro/criteria/{criterion.id}", {"weight": -0.5}, "weight"),
            (f"/axispro/criteria/{criterion.id}", {"indicator_threshold": None}, "indicator_threshold"),
            (f"/axispro/criteria/{criterion.id}", {"name": "  "}, "name"),
            (f"/axispro/policies/{draft.id}", {"dscr_target": 0}, "dscr_target"),
            (f"/axispro/policies/{draft.id}", {"dscr_target": None}, "dscr_target"),
            (f"/axispro/policies/{draft.id}", {"dscr_target": 130}, "dscr_target"),
            (f"/axispro/policies/{draft.id}", {"name": " "}, "name"),
        ):
            with self.subTest(path=path, payload=payload):
                status, body = self.call("PATCH", path, payload, token=self.token)
                self.assertEqual((status, body.get("fields")), (400, [field]), body)
        self.env.invalidate_all()
        self.assertEqual((domain.weight, criterion.weight, criterion.indicator_threshold, draft.dscr_target),
                         (1.0, 2.0, 1000.0, 1.3), "Rien n'a changé")

        for path, payload in ((f"/axispro/domains/{domain.id}", {"weight": 0}),
                              (f"/axispro/criteria/{criterion.id}", {"weight": 2.5, "indicator_threshold": 0}),
                              (f"/axispro/policies/{draft.id}", {"dscr_target": 1.25})):
            status, body = self.call("PATCH", path, payload, token=self.token)
            self.assertEqual(status, 200, body)
        self.env.invalidate_all()
        self.assertEqual((domain.weight, criterion.weight, criterion.indicator_threshold, draft.dscr_target),
                         (0.0, 2.5, 0.0, 1.25), "Un poids nul et un seuil de 0 se saisissent")
        with self.assertRaises(ValidationError):
            domain.weight = -2
        with self.assertRaises(ValidationError):
            criterion.weight = -1

    def test_temps_et_honoraires_controles(self):
        """M8 : heures positives, taux horaire et lignes de la facture d'honoraires positifs."""
        dossier = self._dossier()
        for hours in (0, -2, "abc"):
            with self.subTest(hours=hours):
                status, body = self.call("POST", "/axispro/timesheets",
                                         {"dossier_id": dossier.id, "hours": hours, "description": "Analyse"},
                                         token=self.token)
                self.assertEqual(status, 400, body)
        status, body = self.call("POST", "/axispro/timesheets",
                                 {"dossier_id": dossier.id, "hours": 1.5, "description": "  "}, token=self.token)
        self.assertEqual((status, body.get("fields")), (400, ["description"]), body)
        status, body = self.call("POST", "/axispro/timesheets",
                                 {"dossier_id": 999999, "hours": 1.5, "description": "Analyse"}, token=self.token)
        self.assertEqual(status, 404, body)
        self.env.invalidate_all()
        self.assertFalse(self.env["axispro.timesheet"].search([("dossier_id", "=", dossier.id)]), "Aucun temps enregistré")
        status, body = self.call("POST", "/axispro/timesheets",
                                 {"dossier_id": dossier.id, "hours": 1.5, "description": "Analyse du plan d'affaires"},
                                 token=self.token)
        self.assertEqual(status, 200, body)
        with self.assertRaises(ValidationError):
            self.env["axispro.timesheet"].create({"dossier_id": dossier.id, "hours": -1, "description": "Erreur"})

        invoice_path = f"/axispro/dossiers/{dossier.id}/invoice"
        for payload, field in (({"hourly_rate": 0}, "hourly_rate"), ({}, "hourly_rate"),
                               ({"hourly_rate": 200_000, "lines": [{"name": "Déplacement", "amount": 0}]}, "lines"),
                               ({"hourly_rate": 200_000, "lines": [{"name": " ", "amount": 50_000}]}, "lines")):
            with self.subTest(payload=payload):
                status, body = self.call("POST", invoice_path, payload, token=self.token)
                self.assertEqual((status, body.get("fields")), (400, [field]), body)
        self.env.invalidate_all()
        sheets = self.env["axispro.timesheet"].search([("dossier_id", "=", dossier.id)])
        self.assertFalse(sheets.invoice_id, "Aucune facture après un refus")
        status, body = self.call("POST", invoice_path, {"hourly_rate": 200_000}, token=self.token)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["amount_untaxed"], 300_000)
        pending = self.env["axispro.timesheet"].create({"dossier_id": dossier.id, "hours": 1, "description": "Revue"})
        with self.assertRaises(UserError):
            pending.action_invoice(0)
        with self.assertRaises(UserError):
            pending.action_invoice(200_000, [{"name": "Remise", "amount": -10_000}])
