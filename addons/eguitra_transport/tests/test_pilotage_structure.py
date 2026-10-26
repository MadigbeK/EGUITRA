import calendar

from odoo import Command
from odoo.tests import tagged

from .common import TransportCase

APPROVED = {"eguitra_approval_granted": True}


@tagged("post_install", "-at_install")
class TestPilotageStructure(TransportCase):
    """Audit du 25 octobre : résultat des ensembles après structure transmis au pilotage (I-T1) ; parts des
    propriétaires et commissions hors des charges de structure (I-T9)."""

    def setUp(self):
        super().setUp()
        self.first = self.today.replace(day=1)
        self.last = self.today.replace(day=calendar.monthrange(self.today.year, self.today.month)[1])
        self.activity = self.env["eguitra.transport.rotation"]._activity_account(self.company)

    def _bill(self, amount, distribution):
        bill = self.env["account.move"].create({
            "move_type": "in_invoice", "partner_id": self.supplier.id, "invoice_date": self.today,
            "invoice_line_ids": [Command.create({"name": "Charges du transport", "quantity": 1, "price_unit": amount,
                                                 "account_id": self.acc_purchase.id, "tax_ids": [Command.clear()],
                                                 "analytic_distribution": distribution})],
        })
        bill.with_context(**APPROVED).action_post()
        return bill

    def test_pilotage_juge_le_resultat_apres_structure(self):
        self._rotation().action_validate()
        self._bill(8_000_000, {str(self.activity.id): 100})  # charge de l'activité, sans ensemble
        report = self.env["eguitra.transport.analysis"].report(self.company, self.first, self.last, "vehicle")
        [row] = [r for r in report["rows"] if r["key"] == self.truck.id]
        self.assertGreater(row["structure"], 0)
        kpis = self.env["eguitra.finance.metrics"].transport_kpis(self.company, self.first, self.last)
        self.assertEqual(kpis["vehicles"]["basis"], "net", "Résultat après charges de structure")
        [item] = [v for v in kpis["vehicles"]["items"] if v["key"] == self.truck.id]
        self.assertAlmostEqual(item["result"], row["net_result"])
        self.assertLess(item["result"], item["margin"])

    def test_pieces_des_releves_hors_structure(self):
        owner = self.env["res.partner"].create({"name": "Propriétaire Camara"})
        managed = self.env["eguitra.transport.vehicle"].create({"name": "ER-G1", "capacity_liters": 40000,
                                                               "ownership": "managed", "owner_id": owner.id})
        self._rotation(vehicle_id=managed.id).action_validate()
        self._rotation().action_validate()
        Analysis = self.env["eguitra.transport.analysis"]
        before = Analysis.structure(self.company, self.first, self.last)["companies"][0]
        statement = self.env["eguitra.transport.owner.statement"]._establish(managed, self.first, self.last)
        statement.action_prepare_moves()
        self.assertTrue(statement.move_ids)
        statement.move_ids.with_context(**APPROVED).action_post()
        after = Analysis.structure(self.company, self.first, self.last)["companies"][0]
        self.assertEqual(after["activity_charges"], before["activity_charges"],
                         "La part du propriétaire n'entre pas dans les charges de l'activité")
        self.assertEqual(after["structure"], before["structure"], "Ni dans la structure répartie sur la flotte")
