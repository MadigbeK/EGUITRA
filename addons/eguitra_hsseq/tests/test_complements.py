from datetime import timedelta

from odoo import fields
from odoo.tests import tagged

from .common import HsseqCase

BRAKES = "Freins et ralentisseur, essai statique"


@tagged("post_install", "-at_install")
class TestComplements(HsseqCase):
    """Compléments du lot 1 demandés par les écrans : matrice des événements du cockpit, rotations d'un
    véhicule à une date, salariés des référentiels, validations attendues des actions, photos manquantes
    sur la liste des contrôles."""

    def test_matrice_des_evenements_du_cockpit(self):
        self.env["eguitra.hsseq.event"].search([]).unlink()
        first = self.event(potential_severity=4, probability=3)
        self.event(potential_severity=4, probability=3)
        self.event(potential_severity=5, probability=5)
        self.event()  # pas encore classé
        self.event(potential_severity=1, probability=1, occurred_at=fields.Datetime.now() - timedelta(days=400))
        month = first.occurred_at.strftime("%Y-%m")
        status, cockpit = self.api("kadi.hsseq", "GET", f"/hsseq/cockpit?month={month}")
        self.assertEqual(status, 200, cockpit)
        matrix = cockpit["events"]["matrix"]
        self.assertEqual(len(matrix), 25, "Une case par gravité potentielle et probabilité")
        cells = {(c["severity"], c["probability"]): c for c in matrix}
        self.assertEqual((cells[(4, 3)]["count"], cells[(4, 3)]["criticality"], cells[(4, 3)]["level"]),
                         (2, 12, "significant"))
        self.assertEqual((cells[(5, 5)]["count"], cells[(5, 5)]["level"]), (1, "high"))
        self.assertEqual(cells[(1, 1)]["count"], 0, "Événement hors de la période")
        self.assertEqual(cockpit["events"]["matrix_unclassified"], 1, "Non classé : hors matrice, compté à part")
        status, yearly = self.api("kadi.hsseq", "GET", f"/hsseq/cockpit?month={month}&period=12m")
        self.assertEqual(sum(c["count"] for c in yearly["events"]["matrix"]), 3, "Douze mois : plus de 400 jours exclus")
        status, other = self.api("sekou.parc", "GET", f"/hsseq/cockpit?month={month}")
        self.assertEqual((status, sum(c["count"] for c in other["events"]["matrix"])), (200, 0),
                         "Chef de parc d'un autre site : les événements de Matoto n'y sont pas")

    def test_rotations_d_un_vehicule_a_une_date(self):
        today = self.day
        current = self._rotation()
        earlier = self._rotation(date_loading=today - timedelta(days=3))
        earlier.write({"date_delivery": today - timedelta(days=2), "date_return": today - timedelta(days=1)})
        status, rows = self.api("ibrahima", "GET", f"/hsseq/vehicles/{self.truck.id}/rotations")
        self.assertEqual((status, [r["id"] for r in rows]), (200, [current.id]), rows)
        self.assertEqual(set(rows[0]) >= {"id", "name", "date_loading", "state", "vehicle", "driver", "departed_at"}, True)
        status, rows = self.api("ibrahima", "GET",
                                f"/hsseq/vehicles/{self.truck.id}/rotations?date={today - timedelta(days=2)}")
        self.assertEqual([r["id"] for r in rows], [earlier.id], "En route ce jour-là : entre chargement et retour")
        status, mine = self.driver_api("GET", f"/hsseq/vehicles/{self.truck.id}/rotations")
        self.assertEqual((status, [r["id"] for r in mine]), (200, [current.id]), "Le conducteur : ses rotations")
        current.driver_id = False
        status, mine = self.driver_api("GET", f"/hsseq/vehicles/{self.truck.id}/rotations")
        self.assertEqual((status, mine), (200, []), "Rotation d'un autre conducteur : pas servie au conducteur")
        status, _b = self.api("sekou.parc", "GET", f"/hsseq/vehicles/{self.truck.id}/rotations")
        self.assertEqual(status, 404, "Ensemble d'un autre site")
        for login in ("rh.hsseq", "fatou"):
            status, _b = self.api(login, "GET", f"/hsseq/vehicles/{self.truck.id}/rotations")
            self.assertEqual(status, 403, f"{login} ne déclare pas d'événement")

    def test_salaries_dans_les_referentiels(self):
        for login in ("kadi.hsseq", "ibrahima"):
            status, refs = self.api(login, "GET", "/hsseq/referentials")
            self.assertEqual(status, 200, refs)
            [row] = [e for e in refs["employees"] if e["id"] == self.employee.id]
            self.assertEqual(set(row), {"id", "name", "company", "site"}, "Aucune autre donnée du dossier RH")
            self.assertEqual((row["name"], row["site"]["id"], row["company"]["id"]),
                             (self.employee.name, self.site.id, self.company.id))
        for login in ("dg.hsseq", "admin.hsseq", "rh.hsseq"):
            status, refs = self.api(login, "GET", "/hsseq/referentials")
            self.assertEqual((status, refs["employees"]), (200, []), f"{login} ne gère pas les événements")
        status, refs = self.driver_api("GET", "/hsseq/referentials")
        self.assertEqual((status, refs["employees"]), (200, []), "Le conducteur ne reçoit pas la liste des salariés")

    def test_validation_attendue_des_actions(self):
        self.settings.costly_action_threshold = 50_000_000
        event = self.event()
        Action = self.env["eguitra.hsseq.action"]
        costly = Action.create({"origin": "event", "event_id": event.id, "description": "Remplacer les freins",
                                "owner_id": self.parc.id, "due_date": self.day + timedelta(days=20),
                                "estimated_cost": 80_000_000})
        cheap = Action.create({"origin": "event", "event_id": event.id, "description": "Afficher la consigne",
                               "owner_id": self.parc.id, "due_date": self.day + timedelta(days=20),
                               "estimated_cost": 1_000_000})
        status, listing = self.api("dg.hsseq", "GET", "/hsseq/actions")
        self.assertEqual(status, 200, listing)
        lines = {a["id"]: a for a in listing["items"]}
        self.assertEqual((lines[costly.id]["approval_pending"], lines[cheap.id]["approval_pending"]), (True, False))
        self.assertEqual(listing["counts"]["approval_pending"], 1)
        status, pending = self.api("dg.hsseq", "GET", "/hsseq/actions?approval_pending=1")
        self.assertEqual([a["id"] for a in pending["items"]], [costly.id])
        costly.with_user(self.dg).action_approve()
        status, listing = self.api("dg.hsseq", "GET", "/hsseq/actions?approval_pending=1")
        self.assertEqual((listing["total_count"], listing["counts"]["approval_pending"]), (0, 0), "Validée : plus attendue")

    def test_photos_manquantes_sur_la_liste_des_controles(self):
        rot = self._rotation()
        check = self.check(rot, failing=(BRAKES,))
        status, listing = self.api("ibrahima", "GET", "/hsseq/checks")
        self.assertEqual(status, 200, listing)
        [line] = [c for c in listing["items"] if c["id"] == check.id]
        self.assertTrue(line["photos_missing"], "Non-conformité sans photo : signalée sur la ligne")
        self.assertIsNone(line["complement_of"])
