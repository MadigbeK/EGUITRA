"""Ensemble routier en tracteur et remorque : engins créés par les immatriculations, remorque qui change de
tracteur, rotation qui garde les engins qui ont roulé, capacité de la remorque, facture et relevé inchangés,
migration des ensembles existants."""

import importlib.util
from pathlib import Path

from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .documents_common import DocumentsCase

APPROVED = {"eguitra_approval_granted": True}
MIGRATION = Path(__file__).resolve().parent.parent / "migrations" / "19.0.1.8.0" / "post-migrate.py"


@tagged("post_install", "-at_install")
class TestTracteurRemorque(DocumentsCase):
    def test_engins_crees_par_les_immatriculations(self):
        tractor, trailer = self.tanker.tractor_id, self.tanker.trailer_id
        self.assertEqual((tractor.kind, tractor.fleet_number, tractor.plate), ("tractor", "ER-02", "RC-2002-A"))
        self.assertEqual((trailer.kind, trailer.plate, trailer.capacity_liters), ("trailer", "RC-2002-C", 40000))
        # L'immatriculation de l'ensemble suit l'engin, et l'écrire met l'engin à jour.
        tractor.plate = "RC-2002-B"
        self.assertEqual(self.tanker.tractor_plate, "RC-2002-B")
        self.tanker.trailer_plate = "RC-2002-D"
        self.assertEqual(trailer.plate, "RC-2002-D")
        self.assertFalse(self.truck.trailer_id, "Ensemble sans citerne renseignée : pas de remorque créée")
        with self.assertRaises(ValidationError):
            self.truck.tractor_id = trailer

    def test_remorque_change_de_tracteur(self):
        trailer = self.tanker.trailer_id
        before = self._operation(volume_loaded=30)
        self.assertEqual((before.tractor_id, before.trailer_id), (self.tanker.tractor_id, trailer))
        # La remorque passe sur l'ensemble ER-01 : elle quitte ER-02 ; la rotation passée garde ses engins.
        self.truck.trailer_id = trailer
        self.assertFalse(self.tanker.trailer_id)
        self.assertEqual(before.trailer_id, trailer)
        after = self._operation(vehicle_id=self.truck.id, volume_loaded=30)
        self.assertEqual((after.tractor_id, after.trailer_id), (self.truck.tractor_id, trailer))
        # Remorque d'un autre ensemble pour une seule rotation.
        spare = self.env["eguitra.transport.unit"].create({"kind": "trailer", "fleet_number": "RE-09",
                                                           "plate": "RC-9009-C", "capacity_liters": 30000})
        swapped = self._operation(vehicle_id=self.truck.id, trailer_id=spare.id, volume_loaded=33)
        self.assertEqual(swapped.trailer_id, spare)
        self.assertTrue(swapped.over_capacity, "Capacité de la remorque qui a roulé (30 m³), non de l'ensemble")
        self.assertEqual(self.truck.trailer_id, trailer, "L'ensemble garde sa remorque habituelle")

    def test_facture_porte_les_engins_qui_ont_roule(self):
        spare = self.env["eguitra.transport.unit"].create({"kind": "trailer", "fleet_number": "RE-08",
                                                           "plate": "RC-8008-C"})
        rot = self._operation(trailer_id=spare.id, volume_loaded=40, volume_delivered=40, delivery_note="BL-DEMO-77")
        rot.action_validate()
        invoice = rot.action_invoice()
        values = invoice._eguitra_report_values()
        self.assertEqual(values["transport_rows"][0]["truck"], "RC-2002-A / RC-8008-C")

    def test_releve_du_proprietaire_inchange(self):
        """L'ensemble reste l'unité des relevés : les rotations de l'ensemble y comptent, quelle que soit la remorque."""
        owner = self.env["res.partner"].create({"name": "Propriétaire démo"})
        self.tanker.sudo().write({"ownership": "managed", "owner_id": owner.id})
        spare = self.env["eguitra.transport.unit"].create({"kind": "trailer", "fleet_number": "RE-07"})
        rot = self._operation(trailer_id=spare.id, volume_loaded=40, volume_delivered=40, date_loading=self.today)
        rot.action_validate()
        statement = self.env["eguitra.transport.owner.statement"]._establish(
            self.tanker, self.today.replace(day=1), self.today)
        self.assertIn(rot, statement.rotation_ids)
        self.assertEqual(statement.revenue, rot.revenue)

    def test_migration_des_ensembles(self):
        """19.0.1.8.0 : ensembles et rotations d'avant reçoivent leur tracteur et leur remorque."""
        old = self.env["eguitra.transport.vehicle"].create({"name": "ER-90", "capacity_liters": 33000})
        rot = self._operation(vehicle_id=old.id, volume_loaded=30, volume_delivered=30)
        rot.action_validate()
        invoice = rot.action_invoice()
        invoice.with_context(**APPROVED).action_post()
        self.env.flush_all()
        # État d'avant la version : immatriculations sur l'ensemble, aucun engin, rotations sans engins.
        cr = self.env.cr
        cr.execute("UPDATE eguitra_transport_vehicle SET tractor_id = NULL, trailer_id = NULL, "
                   "tractor_plate = 'RC-9090-A', trailer_plate = 'RC-9090-C' WHERE id = %s", [old.id])
        cr.execute("UPDATE eguitra_transport_rotation SET tractor_id = NULL, trailer_id = NULL WHERE id = %s", [rot.id])
        cr.execute("DELETE FROM eguitra_transport_unit WHERE fleet_number = 'ER-90'")
        self.env.invalidate_all()
        spec = importlib.util.spec_from_file_location("transport_post_migrate_19_0_1_8_0", MIGRATION)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.migrate(cr, "19.0.1.7.0")
        self.env.invalidate_all()
        self.assertEqual((old.tractor_id.fleet_number, old.tractor_id.plate), ("ER-90", "RC-9090-A"))
        self.assertEqual((old.trailer_id.plate, old.trailer_id.capacity_liters), ("RC-9090-C", 33000))
        self.assertEqual((old.tractor_plate, old.trailer_plate), ("RC-9090-A", "RC-9090-C"), "Immatriculations gardées")
        self.assertEqual((rot.tractor_id, rot.trailer_id), (old.tractor_id, old.trailer_id),
                         "La rotation facturée reçoit les engins de son ensemble")
        self.assertEqual(rot.state, "invoiced")
        self.assertEqual(invoice._eguitra_report_values()["transport_rows"][0]["truck"], "RC-9090-A / RC-9090-C")
        # Réglages créés pour la société du groupe, et la migration rejouée ne crée rien en double.
        units = self.env["eguitra.transport.unit"].search_count([])
        module.migrate(cr, "19.0.1.7.0")
        self.assertEqual(self.env["eguitra.transport.unit"].search_count([]), units)
        self.assertTrue(self.env["eguitra.transport.budget.rubric"].search_count([("company_id", "=", self.company.id)]))
        self.assertTrue(self.env["eguitra.approval.rule"].search_count(
            [("company_id", "=", self.company.id), ("document", "=", "travel_budget")]))

    def test_api_flotte(self):
        status, body = self._api("ibrahima", "POST", "/transport/units", {
            "kind": "trailer", "fleet_number": "RE-11", "plate": "RC-1111-C", "capacity_liters": 36000})
        self.assertEqual(status, 200, body)
        status, body = self._api("ibrahima", "PATCH", f"/transport/vehicles/{self.truck.id}",
                                 {"trailer_id": body["id"], "fuel_consumption": 42})
        self.assertEqual(status, 200, body)
        self.assertEqual((self.truck.trailer_id.fleet_number, self.truck.fuel_consumption), ("RE-11", 42))
        status, vehicles = self._api("ibrahima", "GET", "/transport/vehicles")
        row = next(v for v in vehicles if v["id"] == self.truck.id)
        self.assertEqual(row["trailer"]["plate"], "RC-1111-C")
        status, body = self._api("ibrahima", "PATCH", f"/transport/vehicles/{self.truck.id}",
                                 {"trailer_id": self.truck.tractor_id.id})
        self.assertEqual(status, 422, "Un tracteur n'est pas une remorque")
        status, body = self._api("ibrahima", "PATCH", f"/transport/drivers/{self.co_driver.id}", {"crew_role": "pilote"})
        self.assertEqual(status, 400, body)
        status, refs = self._api("ibrahima", "GET", "/transport/referentials")
        self.assertTrue(any(t["name"].startswith("RE-11") for t in refs["trailers"]))
        self.assertIn("crew_role", refs["drivers"][0])
