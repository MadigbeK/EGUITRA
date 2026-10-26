from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo import fields
from odoo.tests import tagged

from ..models.cockpit import INDICATORS
from .common import HsseqCase


@tagged("post_install", "-at_install")
class TestReviews(HsseqCase):
    """Revue de direction tenue entièrement à partir du module (critère de recette du lot 3) : préparée avec
    ses éléments d'entrée générés depuis des données de test (indicateurs, événements marquants, actions en
    retard, audits et constats, exigences non conformes, risques, environnement), tenue (éléments figés),
    décisions et actions d'origine « revue », close puis rouverte par le seul Responsable HSSEQ, compte rendu
    en PDF, suite reprise par la revue suivante ; droits par profil."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.auditor = cls._create_user("awa.auditrice", "auditeur")
        cls.auditor.write({"hsseq_audit_until": cls.day + timedelta(days=10),
                           "hsseq_audit_site_ids": [(6, 0, cls.site.ids)]})

    def _data(self):
        env = self.env
        event = self.event(event_type="road_accident", title="Sortie de route à Kindia")
        event.action_classify({"potential_severity": 5, "probability": 4})
        overdue = env["eguitra.hsseq.action"].create({
            "origin": "event", "event_id": event.id, "description": "Recycler les conducteurs à la conduite défensive",
            "owner_id": self.parc.id, "due_date": self.day - timedelta(days=5)})
        audit = env["eguitra.hsseq.audit"].create({"title": "Audit interne ISO 45001", "standard": "iso_45001",
                                                   "planned_date": self.day, "company_id": self.company.id,
                                                   "site_id": self.site.id})
        audit.action_perform()
        finding = env["eguitra.hsseq.finding"].create({"audit_id": audit.id, "classification": "major",
                                                       "description": "Aucun exercice d'urgence depuis 18 mois"})
        requirement = env["eguitra.hsseq.requirement"].create({
            "company_id": self.company.id, "source": "law", "source_reference": "Texte fictif, art. 3",
            "title": "Déclaration des déchets dangereux", "status": "non_compliant"})
        risk = env["eguitra.hsseq.risk"].create({
            "company_id": self.company.id, "site_id": self.site.id, "hazard": "Vapeurs au dôme",
            "feared_event": "Inflammation au chargement", "owner_id": self.hsseq.id, "raw_severity": 5,
            "raw_probability": 4, "residual_severity": 4, "residual_probability": 4})
        risk.action_activate()
        env["eguitra.hsseq.spill"].create({"company_id": self.company.id, "site_id": self.site.id,
                                           "occurred_at": fields.Datetime.now() - timedelta(minutes=30),
                                           "volume_liters": 40})
        return event, overdue, finding, requirement, risk

    def _review(self, login="dg.hsseq", **values):
        payload = {"period_start": str(self.day.replace(day=1) - relativedelta(months=2)), "period_end": str(self.day),
                   "planned_date": str(self.day), "agenda": "Bilan HSSEQ du trimestre ; objectifs ; ressources"}
        payload.update(values)
        return self.api(login, "POST", "/hsseq/reviews", payload)

    def test_revue_tenue_a_partir_du_module(self):
        event, overdue, finding, requirement, risk = self._data()
        status, review = self._review()
        self.assertEqual(status, 200, review)
        self.assertEqual((review["state"], review["transitions"]), ("prepared", ["refresh", "hold"]))
        self.assertTrue(review["reference"].startswith("RDD/") and review["title"].startswith("Revue de direction"))
        inputs = review["inputs"]
        self.assertEqual(len(inputs["period"]["months"]), 3)
        self.assertEqual([i["code"] for i in inputs["indicators"]], [row[0] for row in INDICATORS],
                         "Indicateurs du cockpit sur la période")
        self.assertIn(event.id, [e["id"] for e in inputs["events"]["notable"]], "Événement marquant")
        self.assertIn(overdue.id, [a["id"] for a in inputs["actions"]["overdue_items"]], "Action en retard")
        self.assertEqual((inputs["audits"]["planned"], inputs["audits"]["done"]), (1, 1))
        self.assertIn(finding.id, [f["id"] for f in inputs["audits"]["open_findings"]], "Écart majeur ouvert")
        self.assertIn(requirement.id, [r["id"] for r in inputs["requirements"]["non_compliant"]])
        self.assertIn(risk.id, [r["id"] for r in inputs["risks"]["high_residual"]])
        self.assertEqual(inputs["environment"]["spills"], 1)
        self.assertIsNone(inputs["previous_review"])
        path = f"/hsseq/reviews/{review['id']}"
        status, body = self.api("dg.hsseq", "POST", f"{path}/hold", {})
        self.assertEqual((status, body["error"]), (422, "participants_required"))
        self.env["eguitra.hsseq.spill"].create({"company_id": self.company.id, "site_id": self.site.id,
                                                "occurred_at": fields.Datetime.now() - timedelta(minutes=20),
                                                "volume_liters": 10})
        status, refreshed = self.api("kadi.hsseq", "POST", f"{path}/refresh")
        self.assertEqual((status, refreshed["inputs"]["environment"]["spills"]), (200, 2), "Régénérés tant que préparée")
        status, held = self.api("dg.hsseq", "POST", f"{path}/hold", {"participant_ids": [self.dg.id, self.hsseq.id],
                                                                     "external_participants": "Représentant du "
                                                                                              "personnel (fictif)"})
        self.assertEqual((status, held["state"], held["held_on"], len(held["participants"])),
                         (200, "held", str(self.day), 2), held)
        status, body = self.api("kadi.hsseq", "POST", f"{path}/refresh")
        self.assertEqual((status, body["error"]), (422, "invalid_transition"), "Tenue : éléments d'entrée figés")
        status, body = self.api("dg.hsseq", "POST", f"{path}/close")
        self.assertEqual((status, body["error"]), (422, "minutes_required"))
        status, _b = self.api("kadi.hsseq", "PATCH", path, {
            "minutes": "Accident de Kindia examiné ; programme de recyclage validé.",
            "conclusion": "Système adapté ; efforts à porter sur la conduite défensive."})
        self.assertEqual(status, 200)
        status, body = self.api("dg.hsseq", "POST", f"{path}/close")
        self.assertEqual((status, body["error"]), (422, "decisions_missing"))
        status, decided = self.api("dg.hsseq", "POST", f"{path}/decisions", {
            "topic": "resources", "description": "Budget de formation à la conduite défensive",
            "action": {"owner_id": self.parc.id, "due_date": str(self.day + timedelta(days=60)),
                       "expected_evidence": "Attestations de formation"}})
        self.assertEqual(status, 200, decided)
        [decision] = decided["decisions"]
        action = decision["action"]
        self.assertEqual((action["origin"], action["origin_id"], decision["owner"]["id"]),
                         ("review", review["id"], self.parc.id), "Action d'origine « revue »")
        status, detail = self.api("kadi.hsseq", "GET", f"/hsseq/actions/{action['id']}")
        self.assertIn(review["reference"], detail["origin_label"])
        status, listing = self.api("kadi.hsseq", "GET", "/hsseq/actions?origin=review")
        self.assertEqual([a["id"] for a in listing["items"]], [action["id"]])
        status, closed = self.api("dg.hsseq", "POST", f"{path}/close")
        self.assertEqual((status, closed["state"]), (200, "closed"), closed)
        status, body = self.api("dg.hsseq", "PATCH", path, {"minutes": "x"})
        self.assertEqual((status, body["error"]), (422, "invalid_transition"))
        status, body = self.api("dg.hsseq", "POST", f"{path}/decisions", {"description": "x"})
        self.assertEqual((status, body["error"]), (422, "invalid_transition"), "Close : plus de décision")
        status, _b = self.api("dg.hsseq", "POST", f"{path}/reopen", {"reason": "Oubli"})
        self.assertEqual(status, 403, "Réouverture : le Responsable HSSEQ seul")
        status, body = self.api("kadi.hsseq", "POST", f"{path}/reopen", {})
        self.assertEqual((status, body["error"]), (422, "reason_required"))
        status, reopened = self.api("kadi.hsseq", "POST", f"{path}/reopen", {"reason": "Décision à compléter"})
        self.assertEqual((status, reopened["state"]), (200, "held"))
        self.api("dg.hsseq", "POST", f"{path}/close")
        # Compte rendu en PDF rendu par le noyau.
        token = self.token("dg.hsseq")
        self.env.flush_all()
        response = self.url_open(f"/api/v1{path}/report.pdf", headers={"Authorization": f"Bearer {token}",
                                                                       "X-Eguitra-App": "test"}, timeout=120)
        self.assertEqual((response.status_code, response.headers.get("Content-Type")), (200, "application/pdf"))
        # La revue suivante reprend la suite de celle-ci.
        status, following = self._review(period_start=str(self.day.replace(day=1)), title="Revue suivante")
        self.assertEqual(status, 200, following)
        previous = following["inputs"]["previous_review"]
        self.assertEqual((previous["reference"], previous["decisions"][0]["action"]["id"]),
                         (review["reference"], action["id"]))

    def test_droits_par_profil(self):
        status, review = self._review(login="kadi.hsseq")
        self.assertEqual(status, 200, review)
        path = f"/hsseq/reviews/{review['id']}"
        for login in ("ibrahima", "rh.hsseq", "awa.auditrice", "fatou"):
            status, _b = self._review(login=login)
            self.assertEqual(status, 403, f"{login} ne prépare pas de revue")
            for method, sub, payload in (("GET", "", None), ("PATCH", "", {"agenda": "x"}),
                                         ("POST", "/hold", {"participant_ids": [self.dg.id]}),
                                         ("POST", "/decisions", {"description": "x"}), ("GET", "/report.pdf", None)):
                status, _b = self.api(login, method, path + sub, payload)
                self.assertEqual(status, 403, f"{login} {method} {sub}")
        status, _b = self.driver_api("GET", "/hsseq/reviews")
        self.assertEqual(status, 403)
        status, body = self._review(period_end=str(self.day - relativedelta(years=3)))
        self.assertEqual((status, body["error"]), (400, "invalid_parameter"), "Période inversée")
        status, listing = self.api("admin.hsseq", "GET", "/hsseq/reviews")
        self.assertEqual((status, listing["total_count"]), (200, 1), "L'administration lit les revues")
