import calendar
from datetime import timedelta

from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .common import TransportCase


@tagged("post_install", "-at_install")
class TestRelevesAudit(TransportCase):
    """Audit du 25 octobre : commission d'un propriétaire bénéficiaire (I-T2), relevés sans chevauchement
    (M12), règle de répartition archivée (M11), identifiant mal formé (M3)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.owner = cls.env["res.partner"].create({"name": "Propriétaire Camara"})
        cls.managed = cls.env["eguitra.transport.vehicle"].create({
            "name": "ER-G1", "capacity_liters": 40000, "ownership": "managed", "owner_id": cls.owner.id})
        cls.first = cls.today.replace(day=1)
        cls.last = cls.today.replace(day=calendar.monthrange(cls.today.year, cls.today.month)[1])
        cls.Statement = cls.env["eguitra.transport.owner.statement"]

    def test_commission_du_proprietaire_dans_sa_part(self):
        self.env["eguitra.transport.share.rule"].create({"partner_id": self.owner.id, "rate": 10,
                                                         "vehicle_id": self.managed.id})
        rot = self._rotation(vehicle_id=self.managed.id)
        rot.action_validate()
        st = self.Statement._establish(self.managed, self.first, self.last)
        commission = st.line_ids.filtered(lambda l: l.kind == "commission")
        self.assertEqual(commission.amount, round(rot.revenue * 0.10))
        self.assertEqual(st.owner_amount, st.margin, "Sa commission lui revient avec sa part : rien n'est retenu")
        self.assertIn("versée avec la part du propriétaire", commission.name)
        st.action_prepare_moves()
        owner_move = st.line_ids.filtered(lambda l: l.kind == "owner").move_id
        self.assertEqual(owner_move.amount_untaxed, st.margin, "Une seule pièce, part et commission comprises")
        self.assertEqual(len(st.move_ids), 1)

    def test_releves_sans_chevauchement(self):
        self.Statement._establish(self.managed, self.first, self.last)
        with self.assertRaises(ValidationError):
            self.Statement._establish(self.managed, self.first + timedelta(days=1), self.last + timedelta(days=5))
        token = self.open_session("fatou")["access_token"]
        status, body = self.call("POST", "/transport/owner-statements", {
            "vehicle_id": self.managed.id, "date_from": str(self.last), "date_to": str(self.last + timedelta(days=10))},
            token=token)
        self.assertEqual(status, 422, body)
        status, body = self.call("POST", "/transport/owner-statements", {
            "vehicle_id": "ER-G1", "date_from": str(self.first), "date_to": str(self.last)}, token=token)
        self.assertEqual(status, 400, "Identifiant mal formé : 400, pas une erreur 500")

    def test_regle_archivee_et_non_supprimee(self):
        rule = self.env["eguitra.transport.share.rule"].create({"partner_id": self.owner.id, "rate": 5,
                                                                "vehicle_id": self.managed.id})
        token = self.open_session("fatou")["access_token"]
        status, body = self.call("DELETE", f"/transport/share-rules/{rule.id}", token=token)
        self.assertEqual((status, body["active"]), (200, False), body)
        self.assertTrue(rule.exists(), "Archivée, gardée pour les relevés passés")
        status, rules = self.call("GET", "/transport/share-rules", token=token)
        self.assertNotIn(rule.id, [r["id"] for r in rules])
        status, rules = self.call("GET", "/transport/share-rules?archived=1", token=token)
        self.assertIn(rule.id, [r["id"] for r in rules])
        self.assertNotIn(rule, self.env["eguitra.transport.share.rule"]._rules_for(self.managed, self.today))
