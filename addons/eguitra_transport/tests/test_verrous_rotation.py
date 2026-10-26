import calendar

from odoo.exceptions import UserError
from odoo.tests import tagged

from .common import TransportCase


@tagged("post_install", "-at_install")
class TestVerrousRotation(TransportCase):
    """Audit du 25 octobre : une rotation validée qu'on corrige revient en saisie (I-T5) ; elle ne bouge plus
    après la clôture de son mois ou la préparation des pièces d'un relevé de propriétaire (I-T6)."""

    def _saisie_validee(self):
        """Rotation saisie par le parc, validée par la finance (règle des quatre yeux)."""
        agent = self.open_session("ibrahima")["access_token"]
        status, row = self.call("POST", "/transport/rotations", {
            "vehicle_id": self.truck.id, "partner_id": self.customer.id, "route_id": self.route.id,
            "product": "gasoil", "volume_loaded": 40, "volume_delivered": 39.8}, token=agent)
        self.assertEqual(status, 200, row)
        finance = self.open_session("fatou")["access_token"]
        status, row = self.call("POST", f"/transport/rotations/{row['id']}/validate", {}, token=finance)
        self.assertEqual((status, row["state"]), (200, "done"), row)
        return row["id"], agent, finance

    def test_correction_apres_validation_remise_en_saisie(self):
        rot_id, agent, finance = self._saisie_validee()
        status, row = self.call("PATCH", f"/transport/rotations/{rot_id}", {"note": "Livrée de nuit"}, token=agent)
        self.assertEqual((status, row["state"]), (200, "done"), "Une note seule ne change pas la validation")
        status, row = self.call("PATCH", f"/transport/rotations/{rot_id}", {"volume_delivered": 39}, token=agent)
        self.assertEqual((status, row["state"], row["volume_delivered"]), (200, "draft", 39), row)
        status, _b = self.call("POST", f"/transport/rotations/{rot_id}/validate", {}, token=agent)
        self.assertEqual(status, 422, "L'auteur ne revalide pas sa propre correction")
        status, row = self.call("POST", f"/transport/rotations/{rot_id}/validate", {}, token=finance)
        self.assertEqual((status, row["state"]), (200, "done"))

    def test_mois_cloture(self):
        rot_id, agent, _finance = self._saisie_validee()
        rot = self.env["eguitra.transport.rotation"].browse(rot_id)
        self.company.fiscalyear_lock_date = rot.date_loading
        status, body = self.call("PATCH", f"/transport/rotations/{rot_id}", {"volume_delivered": 39}, token=agent)
        self.assertEqual(status, 422, body)
        self.assertIn("clôturé", body["message"])
        for action in ("cancel", "reset"):
            status, body = self.call("POST", f"/transport/rotations/{rot_id}/{action}", {}, token=agent)
            self.assertEqual(status, 422, (action, body))
        self.assertEqual(rot.state, "done")
        with self.assertRaises(UserError):
            rot.fuel_cost = 1

    def test_releve_aux_pieces_preparees(self):
        owner = self.env["res.partner"].create({"name": "Propriétaire Camara"})
        managed = self.env["eguitra.transport.vehicle"].create({"name": "ER-G1", "capacity_liters": 40000,
                                                               "ownership": "managed", "owner_id": owner.id})
        rot = self._rotation(vehicle_id=managed.id)
        rot.action_validate()
        first = self.today.replace(day=1)
        last = self.today.replace(day=calendar.monthrange(self.today.year, self.today.month)[1])
        statement = self.env["eguitra.transport.owner.statement"]._establish(managed, first, last)
        statement.action_prepare_moves()
        with self.assertRaises(UserError):
            rot.action_cancel()
        with self.assertRaises(UserError):
            rot.action_reset()
        statement.action_reset()
        rot.action_cancel()
        self.assertEqual(rot.state, "cancelled", "Pièces du relevé retirées : la rotation se corrige de nouveau")
