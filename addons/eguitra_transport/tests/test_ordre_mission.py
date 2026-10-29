"""Ordre de mission : plan de voyage pré-rempli depuis la route, ce qui manque, saisie du plan, mention aux autorités
réglable, PDF « ORDRE DE MISSION » ; vigilances de départ d'une opération d'un ordre de transport."""

from odoo.tests import tagged

from .documents_common import DocumentsCase


@tagged("post_install", "-at_install")
class TestOrdreMission(DocumentsCase):
    def test_plan_pre_rempli_depuis_la_route(self):
        rot = self._operation()
        steps = rot._mission_steps()
        self.assertEqual([(s["place"], s["direction"]) for s in steps],
                         [("Conakry", "out"), ("Mamou", "out"), ("Siguiri", "out"), ("Conakry", "back")])
        self.assertEqual(steps[1]["stop_reason"], "Pause et contrôle")
        self.assertEqual(rot._mission_missing(), [], "Chauffeur, tracteur, remorque, ETD et plan : complet")
        mission = rot._ensure_mission()
        self.assertTrue(mission.name.startswith("OM/"))
        self.assertEqual(len(mission.step_ids), 4, "Le plan de la route devient celui de l'ordre de mission")
        self.assertEqual(rot._ensure_mission(), mission, "Un seul ordre de mission par opération")
        self.assertNotEqual(rot.name, "/", "L'opération citée par l'ordre de mission est numérotée")

    def test_ce_qui_manque(self):
        rot = self._operation(date_planned_departure=False, trailer_id=False)
        rot.driver_id = False
        missing = " ".join(rot._mission_missing())
        for expected in ("chauffeur", "remorque", "ETD"):
            self.assertIn(expected, missing)
        bare = self.env["eguitra.transport.route"].create({"name": "Route sans départ démo", "distance_km": 100})
        rot2 = self._operation(route_id=bare.id)
        self.assertIn("plan de voyage", " ".join(rot2._mission_missing()))

    def test_saisie_du_plan_et_mention(self):
        rot = self._operation()
        status, body = self._api("ibrahima", "PUT", f"/transport/rotations/{rot.id}/mission", {
            "steps": [{"place": "Dépôt démo", "city": "Conakry", "country": "Guinée", "direction": "out"},
                      {"place": "Kankan", "city": "Kankan", "country": "Guinée", "direction": "out",
                       "stop_reason": "Repos de nuit"},
                      {"place": "Site démo de Siguiri", "city": "Siguiri", "country": "Guinée", "direction": "out"}],
            "authorities_note": "Mention démo propre à la mission."})
        self.assertEqual(status, 200, body)
        self.assertEqual([s["place"] for s in body["steps"]], ["Dépôt démo", "Kankan", "Site démo de Siguiri"])
        status, body = self._api("ibrahima", "PUT", f"/transport/rotations/{rot.id}/mission",
                                 {"steps": [{"city": "Sans lieu"}]})
        self.assertEqual(status, 400, body)
        page = self._html("eguitra_transport.action_report_operation_mission", rot)
        for expected in ("ORDRE DE MISSION", rot._mission().name, "Il est ordonné, pour des raisons de service, à "
                         f"{self.driver.name}, chauffeur, et à {self.co_driver.name}, convoyeur,",
                         "N° de parc : ER-02", "Immatriculation : RC-2002-A", "Immatriculation : RC-2002-C",
                         "Kankan", "Repos de nuit", "Aller", "Départ prévu", "Mention démo propre à la mission.",
                         self.company.name, "Le Responsable des opérations", "Responsable démo"):
            self.assertIn(expected, page)
        status, body = self._api("ibrahima", "PUT", f"/transport/rotations/{rot.id}/mission",
                                 {"reset": True, "authorities_note": ""})
        self.assertEqual(len(body["steps"]), 4, "Plan de la route rétabli")
        self.company.transport_authorities_note = "Mention démo de la société."
        self.assertIn("Mention démo de la société.", self._html("eguitra_transport.action_report_operation_mission", rot))

    def test_vigilances_de_depart(self):
        """Opération d'un ordre de transport : ordre de mission incomplet et budget non approuvé signalés au départ,
        sans le bloquer ; une rotation hors ordre de transport n'a aucun motif nouveau."""
        plain = self._rotation()
        self.assertFalse([b for b in plain._departure_blockers() if b["code"] in ("T02", "T03")])
        order = self._order()
        rot = self._operation(order, date_planned_departure=False)
        rot._new_budget()
        codes = {b["code"]: b["severity"] for b in rot._departure_blockers()}
        self.assertEqual((codes.get("T02"), codes.get("T03")), ("warn", "warn"))
        rot.write({"volume_loaded": 40})
        rot.action_depart()
        self.assertEqual(rot.state, "en_route", "Vigilances : le départ reste possible")
