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
        self.assertEqual(cockpit["events"], {"to_classify": 0, "overdue_investigations": 0, "high_open": 0})
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
