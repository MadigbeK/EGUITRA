from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo import fields
from odoo.tests import tagged

from ..models.cockpit import INDICATORS, month_start
from .common import HsseqCase

LOT3 = ("spills", "dust_exceedances", "complaints", "complaints_on_time", "telematics_violations", "drills_completion")


@tagged("post_install", "-at_install")
class TestCockpitLot3(HsseqCase):
    """Indicateurs du lot 3 au cockpit et au rapport mensuel, calculés depuis des rotations et des fiches de
    test : consommation et émissions au facteur d'émission des paramètres, écarts de livraison des citernes et
    des bennes, déversements, poussières, réclamations dans le délai, violations par 100 voyages, exercices ;
    situations du lot 3 ; clés calculables du rapport mensuel et modèle NIMOVA."""

    def _departed(self, **values):
        rotation = self._rotation(**values)
        rotation.write({"state": "done"})
        return rotation

    def test_indicateurs_depuis_les_rotations_et_les_fiches(self):
        env = self.env
        self.settings.co2_factor = 2.5
        first = self._departed(fuel_liters=500)
        second = self._departed(fuel_liters=480)
        tipper = env["eguitra.transport.vehicle"].create({"name": "BN-01", "vehicle_kind": "tipper", "payload_tonnes": 35,
                                                          "site_id": self.site2.id})
        third = self._departed(vehicle_id=tipper.id, weight_gross=48, weight_tare=16, volume_loaded=32,
                               volume_delivered=31.2, fuel_liters=300)
        now = fields.Datetime.now() - timedelta(minutes=30)
        base = {"company_id": self.company.id}
        env["eguitra.hsseq.spill"].create(dict(base, site_id=self.site.id, occurred_at=now, volume_liters=100,
                                               recovered_liters=60, vehicle_id=self.truck.id))
        for value in (12, 4):
            env["eguitra.hsseq.dust"].create(dict(base, site_id=self.site.id, value=value, threshold=10))
        env["eguitra.hsseq.complaint"].create(dict(base, partner_id=self.customer.id, nature="delay",
                                                   description="Retard", rotation_id=first.id))
        for kind in ("speeding", "harsh_braking"):
            env["eguitra.hsseq.telematics.violation"].create(dict(base, occurred_at=now, vehicle_id=self.truck.id,
                                                                  violation_type=kind, source="IVMS"))
        plan = env["eguitra.hsseq.emergency.plan"].create(dict(base, site_id=self.site.id, scenario="fire",
                                                               title="Incendie au parc", response="Évacuer"))
        Drill = env["eguitra.hsseq.drill"]
        Drill.create({"plan_id": plan.id, "planned_date": self.day}).action_perform(debrief="Évacuation en 4 minutes")
        Drill.create({"plan_id": plan.id, "planned_date": self.day})
        status, cockpit = self.api("kadi.hsseq", "GET", "/hsseq/cockpit")
        self.assertEqual(status, 200, cockpit)
        rows = {i["code"]: i for i in cockpit["indicators"]}
        values = {code: row["value"] for code, row in rows.items()}
        fuel_km = first.distance_km + second.distance_km + third.distance_km
        self.assertEqual(values["fuel_consumption"], round(1280 * 100 / fuel_km, 1))
        self.assertEqual(values["co2_emissions"], round(1280 * 2.5 / fuel_km, 2), "Facteur d'émission des paramètres")
        self.assertEqual(values["tanker_shortage"], round((first.shortage + second.shortage) * 1000
                                                          / (first.volume_delivered + second.volume_delivered), 2))
        self.assertEqual(values["tipper_variance"], 25.0, "Écart de tonnage ÷ tonnage chargé (‰)")
        self.assertEqual((values["spills"], values["dust_exceedances"], values["complaints"]), (1, 1, 1))
        self.assertEqual(values["telematics_violations"], round(2 * 100 / 3, 2), "Violations par 100 voyages")
        self.assertEqual(values["drills_completion"], 50.0)
        for code in LOT3 + ("tipper_variance",):
            self.assertTrue(rows[code]["source"], code)
            self.assertIn(rows[code]["status"], ("met", "watch", "missed", "no_data"), code)
        self.assertEqual((rows["spills"]["status"], rows["spills"]["family"]), ("missed", "reactive"),
                         "Un déversement pour une cible nulle")
        status, tippers = self.api("kadi.hsseq", "GET", "/hsseq/cockpit?vehicle_kind=tipper")
        values = {i["code"]: i["value"] for i in tippers["indicators"]}
        self.assertEqual((values["tanker_shortage"], values["tipper_variance"], values["telematics_violations"]),
                         (None, 25.0, 0.0), "Filtre benne")
        # Situations du lot 3.
        self.assertEqual((cockpit["environment"]["spills_open"], cockpit["environment"]["dust_exceedances_30d"],
                          cockpit["environment"]["complaints_open"]), (1, 1, 1))
        self.assertEqual((cockpit["emergency"]["plans_active"], cockpit["telematics"]["violations"],
                          cockpit["telematics"]["by_type"]["speeding"]), (1, 2, 1))
        status, yard = self.api("ibrahima", "GET", "/hsseq/cockpit")
        values = {i["code"]: i["value"] for i in yard["indicators"]}
        self.assertEqual((values["tipper_variance"], yard["environment"]["complaints_open"]), (None, None),
                         "Chef de parc : ses sites, sans les réclamations")
        status, other = self.api("sekou.parc", "GET", "/hsseq/cockpit")
        self.assertEqual((other["environment"]["spills_open"], other["telematics"]["violations"]), (0, 0), "Autre site")
        # Rapport mensuel : clés calculables et modèle NIMOVA.
        Template = env["eguitra.hsseq.report.template"]
        computed = Template._computed_values(self.company, month_start(self.day))
        self.assertAlmostEqual(computed["co2_kg"], 1280 * 2.5)
        self.assertEqual((computed["spill_liters"], computed["violations"], computed["violations_speeding"],
                          computed["drills_done"], computed["dust_measurements"]), (100, 2, 1, 1, 2))
        self.assertAlmostEqual(computed["tipper_variance_t"], 0.8)
        self.assertEqual((computed["complaints_open"], computed["wastes_stored"], computed["procedures_read_rate"]),
                         (1, 0, None))
        nimova = Template.search([("code", "=", "NIMOVA")])
        self.assertEqual(set(nimova._indicators().mapped("key")), {row[0] for row in INDICATORS},
                         "Un indicateur du modèle NIMOVA par indicateur du cockpit")
        status, keys = self.api("dg.hsseq", "GET", "/hsseq/reports/keys")
        self.assertTrue({"co2_kg", "spill_liters", "telematics_violations", "procedures_read_rate"}
                        <= {k["key"] for k in keys})

    def test_reclamations_traitees_dans_le_delai(self):
        received = self.day - timedelta(days=20)
        Complaint = self.env["eguitra.hsseq.complaint"]
        base = {"company_id": self.company.id, "partner_id": self.customer.id, "nature": "quality",
                "description": "Odeur suspecte", "received_on": received, "site_id": self.site.id}
        answered = Complaint.create(base)
        answered.action_answer("Analyse du produit, lot conforme", received + timedelta(days=3))
        Complaint.create(base)
        due = received + timedelta(days=15)
        month = month_start(due)
        Cockpit = self.env["eguitra.hsseq.cockpit"]
        comps = Cockpit._live(self.company, [month])[(self.company.id, month)]
        self.assertEqual((comps["complaints_due"], comps["complaints_on_time"]), (2, 1))
        self.assertEqual(Cockpit._value("complaints_on_time", comps), 50.0)

    def test_mois_fige_avant_le_lot_3(self):
        """Un mois figé avant le lot 3 n'a pas les émissions : elles se déduisent du carburant, au facteur de la
        société."""
        previous = month_start(self.day) - relativedelta(months=1)
        self.env["eguitra.hsseq.indicator.snapshot"].create({
            "company_id": self.company.id, "month": previous, "components": {"fuel_liters": 1000, "fuel_km": 2000}})
        Cockpit = self.env["eguitra.hsseq.cockpit"]
        comps, frozen = Cockpit._components(self.company, [previous])
        self.assertTrue(frozen)
        row = comps[(self.company.id, previous)]
        self.assertAlmostEqual(row["co2_kg"], 2680.0)
        self.assertEqual(row["spills"], 0.0, "Composante absente d'un mois figé : nulle")
        self.assertEqual(Cockpit._value("co2_emissions", row), 1.34)
