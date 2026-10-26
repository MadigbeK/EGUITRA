from datetime import timedelta

from odoo.tests import tagged

from ..models.cockpit import INDICATORS, month_start
from .common import HsseqCase

CODES = [row[0] for row in INDICATORS]


@tagged("post_install", "-at_install")
class TestCockpit(HsseqCase):
    """Cockpit : sans erreur sur une base vide, indicateurs avec leur source, mois figé le 5 du mois suivant."""

    def test_cockpit_sur_base_vide(self):
        self.env["eguitra.hsseq.event"].search([]).unlink()
        status, cockpit = self.api("kadi.hsseq", "GET", "/hsseq/cockpit")
        self.assertEqual(status, 200, cockpit)
        self.assertEqual([i["code"] for i in cockpit["indicators"]], CODES)
        for indicator in cockpit["indicators"]:
            self.assertTrue(indicator["source"], indicator["code"])
            self.assertEqual(len(indicator["series"]), 12, indicator["code"])
        rates = {i["code"]: i for i in cockpit["indicators"]}
        self.assertFalse(rates["frequency_rate"]["site_scoped"], "TF : heures de RH par société, sans filtre de site")
        self.assertIn(cockpit["hours_basis"], ("paid", "presence"))
        events = cockpit["events"]
        self.assertEqual({k: events[k] for k in ("to_classify", "overdue_investigations", "high_open",
                                                 "matrix_unclassified")}, dict.fromkeys(
            ("to_classify", "overdue_investigations", "high_open", "matrix_unclassified"), 0))
        self.assertEqual((len(events["matrix"]), sum(c["count"] for c in events["matrix"])), (25, 0))
        status, other = self.api("kadi.hsseq", "GET", "/hsseq/cockpit?period=12m&vehicle_kind=tipper")
        self.assertEqual(status, 200, other)
        self.assertIsNone(next(i for i in other["indicators"] if i["code"] == "tanker_shortage")["value"],
                          "Écart des citernes sans objet sur le filtre benne")
        status, body = self.api("kadi.hsseq", "GET", "/hsseq/cockpit?month=2026-13")
        self.assertEqual(status, 400)

    def test_indicateurs_et_mois_fige(self):
        rot = self._rotation()
        self.check(rot, failing=("Freins et ralentisseur, essai statique",))
        self.breath(rot, "positive")
        rot.driver_id = self.driver
        self.event(event_type="near_miss")
        self.event(event_type="road_accident")
        status, cockpit = self.api("ibrahima", "GET", "/hsseq/cockpit")
        self.assertEqual(status, 200, cockpit)
        values = {i["code"]: i["value"] for i in cockpit["indicators"]}
        self.assertEqual(values["breath_test_positives"], 1, "Positifs comptés, sans nom")
        self.assertEqual(values["check_compliance"], 0.0, "Un contrôle, un point critique non conforme")
        self.assertEqual(values["reporting_ratio"], 1.0, "Un presque-accident pour un accident")
        self.assertTrue(cockpit["blocked_departures"]["items"], "La rotation du jour est bloquée")
        self.assertIn("pending_checks_only", cockpit["blocked_departures"]["items"][0])
        previous = month_start(self.day) - timedelta(days=1)
        snapshot = self.env["eguitra.hsseq.cockpit"]._freeze(self.company, month_start(previous))
        self.assertTrue(snapshot)
        self.assertFalse(self.env["eguitra.hsseq.cockpit"]._freeze(self.company, month_start(previous)),
                         "Un mois ne se fige qu'une fois")
        status, frozen = self.api("kadi.hsseq", "GET", f"/hsseq/cockpit?month={previous:%Y-%m}&company_id={self.company.id}")
        self.assertEqual((status, frozen["period"]["frozen"]), (200, True), frozen)

    def test_indicateurs_du_lot_2(self):
        env = self.env
        risk = env["eguitra.hsseq.risk"].create({
            "company_id": self.company.id, "site_id": self.site.id, "hazard": "Vapeurs au dôme",
            "feared_event": "Inflammation", "owner_id": self.parc.id, "raw_severity": 4, "raw_probability": 4,
            "residual_severity": 2, "residual_probability": 3})
        risk.action_activate()
        risk.review_date = self.day - timedelta(days=1)
        Audit = env["eguitra.hsseq.audit"]
        done = Audit.create({"title": "Audit interne", "standard": "internal", "planned_date": self.day,
                             "company_id": self.company.id, "site_id": self.site.id})
        done.action_perform()
        Audit.create({"title": "Audit ISO 14001", "standard": "iso_14001", "planned_date": self.day,
                      "company_id": self.company.id, "site_id": self.site.id})
        env["eguitra.hsseq.finding"].create({"audit_id": done.id, "classification": "major", "description": "Écart"})
        Requirement = env["eguitra.hsseq.requirement"]
        for status in ("compliant", "non_compliant"):
            Requirement.create({"company_id": self.company.id, "source": "standard", "standard": "iso_45001",
                                "source_reference": "ISO 45001", "title": f"Exigence {status}", "status": status})
        event = self.event()
        event.action_classify({"potential_severity": 5, "probability": 4})
        event.action_immobilize("Expertise")
        status, cockpit = self.api("kadi.hsseq", "GET", "/hsseq/cockpit")
        self.assertEqual(status, 200, cockpit)
        values = {i["code"]: i["value"] for i in cockpit["indicators"]}
        self.assertEqual((values["audits_completion"], values["immobilizations"]), (50.0, 1),
                         "Audits réalisés contre planifiés, immobilisations V09 du mois")
        rows = {i["code"]: i for i in cockpit["indicators"]}
        audits = rows["audits_completion"]
        self.assertEqual((audits["status"], audits["family"], audits["series"][-1]["target"]), ("missed", "proactive", 100.0),
                         "50 % pour une cible de 100 % : non conforme ; indicateur proactif ; cible par mois")
        self.assertEqual((rows["immobilizations"]["status"], rows["immobilizations"]["family"]), ("missed", "reactive"))
        self.assertTrue(all(i["status"] in ("met", "watch", "missed", "no_data") for i in cockpit["indicators"]))
        self.assertEqual(rows["tipper_variance"]["status"], "no_data", "Sans valeur : pas de donnée")
        self.assertEqual((cockpit["risks"]["by_raw_level"]["high"], cockpit["risks"]["by_residual_level"]["moderate"],
                          cockpit["risks"]["reviews_overdue"]), (1, 1, 1))
        self.assertEqual((cockpit["audits"]["planned"], cockpit["audits"]["done"]), (2, 1))
        self.assertEqual(cockpit["findings"]["open_by_class"]["major"], 1)
        self.assertEqual(cockpit["requirements"]["non_compliant"], 1)
        [iso] = cockpit["iso_maturity"]
        self.assertEqual((iso["standard"], iso["score"]), ("iso_45001", 50.0))
        self.assertEqual(cockpit["immobilizations"]["active"], 1)
        self.assertEqual(set(cockpit["waivers_by_reason"]) >= {"V06", "V07", "V08", "V09"}, True)
        status, yard = self.api("ibrahima", "GET", "/hsseq/cockpit")
        self.assertEqual((status, yard["requirements"], yard["risks"]["active"]), (200, None, 1),
                         "Chef de parc : ses sites, sans le registre des exigences")
        status, other = self.api("sekou.parc", "GET", "/hsseq/cockpit")
        self.assertEqual((other["risks"]["active"], other["immobilizations"]["active"]), (0, 0), "Autre site")
