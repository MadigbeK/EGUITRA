from odoo.tests import tagged

from .common import TransportCase

APPROVED = {"eguitra_approval_granted": True}


@tagged("post_install", "-at_install")
class TestFacturesDefaites(TransportCase):
    """Audit du 25 octobre : facture des rotations supprimée, annulée ou extournée (C12), volume facturé à
    trois décimales (I-T3), factures à établir au montant facturable (I-T8)."""

    def _invoiced(self, **values):
        """Rotation validée et facturée, avec une créance sur le chauffeur pour son manquant."""
        self.company.transport_shortage_rule = "driver"
        self.driver.partner_id = self.env["res.partner"].create({"name": "Mamadou Diallo (chauffeur)"})
        rot = self._rotation(volume_delivered=39.5, shortage_unit_price=9_000_000, **values)
        rot.action_validate()
        invoice = rot.action_invoice()
        self.assertEqual(rot.state, "invoiced")
        self.assertTrue(rot.shortage_claim_move_id, "Créance sur le chauffeur en brouillon")
        return rot, invoice

    def test_facture_supprimee(self):
        rot, invoice = self._invoiced()
        claim = rot.shortage_claim_move_id
        invoice.unlink()
        self.assertEqual(rot.state, "done", "Rotation de nouveau à facturer")
        self.assertFalse(rot.invoice_id)
        self.assertFalse(claim.exists(), "Créance en brouillon retirée")
        self.assertFalse(rot.shortage_claim_move_id)
        rot.action_invoice()
        self.assertTrue(rot.invoice_id and rot.shortage_claim_move_id, "Refacturée, avec une nouvelle créance")

    def test_facture_annulee(self):
        rot, invoice = self._invoiced()
        invoice.with_context(**APPROVED).action_post()
        claim = rot.shortage_claim_move_id
        claim.with_context(**APPROVED).action_post()
        invoice.button_draft()
        invoice.button_cancel()
        self.assertEqual((invoice.state, rot.state), ("cancel", "done"))
        self.assertFalse(rot.invoice_id)
        self.assertEqual(rot.shortage_claim_move_id, claim, "Une créance validée reste : la finance la défait")

    def test_facture_extournee(self):
        rot, invoice = self._invoiced()
        invoice.with_context(**APPROVED).action_post()
        invoice.with_context(**APPROVED)._reverse_moves(cancel=True)
        self.assertEqual((invoice.payment_state, rot.state), ("reversed", "done"))
        self.assertFalse(rot.invoice_id)

    def test_volume_facture_a_trois_decimales(self):
        rot = self._rotation(volume_delivered=39.875)
        rot.action_validate()
        line = rot.action_invoice().invoice_line_ids.filtered(lambda l: rot.name in l.name and "Transport" in l.name)
        self.assertEqual((line.quantity, line.price_subtotal), (1, 39.875 * 1_200_000))
        self.assertIn("39,875 m³", line.name)
        self.assertIn(f"1 200 000 {rot.currency_id.name} le m³", line.name)

    def test_factures_a_etablir_au_montant_facturable(self):
        self.env["eguitra.transport.tax"].create({"name": "Taxe refacturée", "nature": "road", "base": "delivered",
                                                  "rate": 10_000, "rebillable": True})
        rot = self._rotation()
        rot.action_validate()
        self.assertTrue(rot.taxes_rebilled)
        targets = self.env["eguitra.period.close"]._close_accrual_targets(self.company, rot.date_loading)
        self.assertEqual(targets[f"rotation:{rot.id}"]["amount"], rot.billed_amount)
        self.assertEqual(rot.billed_amount, rot.revenue + rot.taxes_rebilled, "Taxes refacturées comprises")
