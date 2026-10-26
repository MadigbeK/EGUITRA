"""Modules du cabinet (audit du noyau et de l'application web, lot 3) : seuil partiel égal à 0 (I-X4),
nombres à la française dans les textes (M8)."""

import re

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

    def test_nombres_a_la_francaise(self):
        """M8 : virgule décimale et milliers groupés dans les textes du noyau, jamais « 1.3 »."""
        self.assertEqual(engine.nombre(1234567.4), "1 234 567")
        self.assertEqual(engine.nombre(1.254, 2), "1,25")
        self.assertEqual(engine.nombre(-0.4), "0", "Jamais « -0 »")
        self.assertEqual((engine.taux(12.5), engine.taux(12), engine.taux(1.3), engine.taux(0)), ("12,5", "12", "1,3", "0"))
        self.assertEqual((heures(7.5), heures(8), heures(1234.25), heures(0.75)), ("7,5", "8", "1 234,25", "0,75"))

    def test_alertes_du_modele_a_la_francaise(self):
        """M8 : alertes du modèle sans point décimal (« 12,5 % », « 2,50 »)."""
        params = {"horizon": 5, "discount_rate": 12.5, "tax_rate": 0, "receivable_days": 0, "inventory_days": 0,
                  "payable_days": 0, "residual_value": False, "dscr_target": 2.5, "equity_target": 50.5}
        lines = [
            {"kind": "capex", "name": "Usine", "amount": 1000, "year": 0, "life": 5},
            {"kind": "revenue", "name": "Ventes", "quantity": 10, "price": 10},
            {"kind": "funding", "name": "Apport", "funding_type": "equity", "amount": 100},
            {"kind": "funding", "name": "Prêt", "funding_type": "loan", "amount": 300, "rate": 10, "life": 10},
        ]
        alerts = engine.analyse(params, lines)["alerts"]
        text = " ".join(alerts)
        self.assertIn(f"VAN négative au taux d'actualisation de 12,5{NBSP}%", text)
        self.assertIn("sous l'exigence de 2,50.", text)
        self.assertIn(f"sous le minimum de 50,5{NBSP}%.", text)
        self.assertIn("Plan de financement initial déséquilibré : 600 de ressources manquantes.", alerts)
        self.assertFalse(re.search(r"\d\.\d", text), f"Point décimal dans les alertes : {text}")


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
