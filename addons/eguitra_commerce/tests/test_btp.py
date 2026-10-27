"""Offre de travaux vers le chantier : l'offre acceptée crée le chantier (ou s'y rattache), le montant du marché
est le hors taxes de l'offre ; l'avance de démarrage se facture une fois puis se déduit au prorata des
situations jusqu'à épuisement ; la retenue de garantie reste calculée sur les travaux de la période."""

from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from .common import CommerceDataMixin


@tagged("post_install", "-at_install")
class TestOffreDeTravaux(CommerceDataMixin, TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_commerce()

    def _btp_offer(self, **values):
        return self.make_offer(lines=[
            self.sale_line("Lot 1 : terrassements et assainissement", 1, 1_200_000_000),
            self.sale_line("Lot 2 : chaussée", 1, 800_000_000),
        ], **dict({"eguitra_chantier_mode": True, "eguitra_advance_rate": 30, "eguitra_retention_rate": 5,
                   "eguitra_object": "Route de démonstration, lot 3"}, **values))

    def _situation(self, chantier, cumulative):
        situation = self.env["eguitra.chantier.situation"].create(
            {"chantier_id": chantier.id, "cumulative_amount": cumulative})
        situation.action_invoice()
        return situation

    def test_offre_acceptee_cree_le_chantier_et_son_avance_se_deduit(self):
        offer = self._btp_offer()
        offer.action_eguitra_accept()
        chantier = offer.eguitra_chantier_id
        self.assertTrue(chantier, "Le chantier est créé à l'acceptation")
        self.assertEqual((chantier.name, chantier.partner_id, chantier.contract_amount, chantier.retention_rate),
                         ("Route de démonstration, lot 3", self.customer, 2_000_000_000, 5))
        self.assertEqual(chantier.eguitra_sale_order_id, offer)
        self.assertEqual(offer.eguitra_invoice_mode, "delivered")
        self.assertTrue(all(line.qty_to_invoice == 0 for line in offer.order_line),
                        "La commande de travaux n'a rien à facturer d'elle-même")
        with self.assertRaises(UserError, msg="Offre de travaux : facturée par les situations, jamais par la commande"):
            offer.eguitra_create_invoice("total")

        advance = chantier.action_eguitra_invoice_advance()
        self.assertEqual(advance.state, "posted")
        self.assertAlmostEqual(advance.amount_untaxed, 600_000_000, msg="30 % du marché")
        self.assertAlmostEqual(advance.amount_total, 708_000_000, msg="TVA 18 % comprise")
        self.assertTrue(advance.invoice_line_ids.account_id.code.startswith("4191"))
        self.assertEqual(advance.ref, offer.name, "Référence offre de la facture d'avance")
        self.assertAlmostEqual(chantier.eguitra_advance_remaining, 600_000_000)
        with self.assertRaises(UserError, msg="L'avance se facture une fois"):
            chantier.action_eguitra_invoice_advance()

        s1 = self._situation(chantier, 500_000_000)
        invoice = s1.invoice_id
        deduction = invoice.invoice_line_ids.filtered(lambda l: l.eguitra_advance_kind == "deduction")
        self.assertAlmostEqual(deduction.price_subtotal, -150_000_000, msg="30 % des 500 M de travaux de la période")
        self.assertTrue(deduction.account_id.code.startswith("4191"))
        self.assertAlmostEqual(invoice.amount_untaxed, 350_000_000)
        self.assertAlmostEqual(invoice.amount_total, 413_000_000)
        self.assertEqual(s1.amount_period, 500_000_000, "La période reste celle des travaux")
        self.assertEqual(s1.retention_amount, 25_000_000, "Retenue de garantie : 5 % des travaux, comme avant")
        self.assertAlmostEqual(invoice.amount_residual, 388_000_000, msg="Net à payer : TTC moins la retenue")
        self.assertEqual(chantier.invoiced_amount, 500_000_000)
        self.assertAlmostEqual(chantier.eguitra_advance_deducted, 150_000_000)
        self.assertAlmostEqual(chantier.eguitra_advance_remaining, 450_000_000)

        s2 = self._situation(chantier, 2_000_000_000)
        self.assertAlmostEqual(
            s2.invoice_id.invoice_line_ids.filtered(lambda l: l.eguitra_advance_kind == "deduction").price_subtotal,
            -450_000_000, msg="Dernière situation du marché : le reste de l'avance")
        self.assertEqual(s2.amount_period, 1_500_000_000)
        self.assertAlmostEqual(chantier.eguitra_advance_remaining, 0, msg="Avance épuisée")
        amounts = offer._eguitra_amounts()
        self.assertAlmostEqual(amounts["invoiced"], 2_000_000_000)
        self.assertAlmostEqual(amounts["to_deduct"], 0)

        # Annulée par un avoir, la dernière situation rend sa déduction : elle se refait à la facturation suivante.
        s2.action_reverse()
        self.assertAlmostEqual(chantier.eguitra_advance_remaining, 450_000_000)
        s3 = self._situation(chantier, 2_000_000_000)
        self.assertAlmostEqual(
            s3.invoice_id.invoice_line_ids.filtered(lambda l: l.eguitra_advance_kind == "deduction").price_subtotal,
            -450_000_000)
        self.assertEqual(chantier._retention_balance(), 100_000_000, "Retenues de S1 et S3 en 4117")

    def test_rattachement_a_un_chantier_existant(self):
        Chantier = self.env["eguitra.chantier"]
        chantier = Chantier.create({"name": "Bâtiment administratif (test)", "partner_id": self.customer.id})
        offer = self._btp_offer(eguitra_chantier_id=chantier.id, eguitra_advance_rate=20)
        offer.action_eguitra_accept()
        self.assertEqual(offer.eguitra_chantier_id, chantier)
        self.assertEqual(chantier.contract_amount, 2_000_000_000, "Montant du marché : le hors taxes de l'offre")
        self.assertEqual(chantier.eguitra_advance_rate, 20)
        other = self._btp_offer(eguitra_chantier_id=chantier.id)
        with self.assertRaises(UserError, msg="Un chantier, une offre acceptée"):
            other.action_eguitra_accept()
        stranger = self.env["res.partner"].create({"name": "Autre maître d'ouvrage (test)"})
        elsewhere = Chantier.create({"name": "Chantier d'un autre client (test)", "partner_id": stranger.id})
        mismatch = self._btp_offer(eguitra_chantier_id=elsewhere.id)
        with self.assertRaises(UserError, msg="Le client de l'offre est le maître d'ouvrage du chantier"):
            mismatch.action_eguitra_accept()

    def test_garde_fous_de_l_offre_de_travaux(self):
        with self.assertRaises(UserError, msg="Avance et retenue réunies sous 100 %"):
            self._btp_offer(eguitra_advance_rate=96, eguitra_retention_rate=5).action_eguitra_accept()
        partner = self.env["res.partner"].create({"name": "Client du cabinet (test)"})
        cabinet_offer = self.make_offer(company=self.cabinet, partner_id=partner.id, eguitra_chantier_mode=True, lines=[
            self.sale_line("Mission", 1, 1_000_000,
                           product=self.env["product.template"]._eguitra_generic_product(self.cabinet, "sale"), taxes=self.env["account.tax"])])
        with self.assertRaises(UserError, msg="Les chantiers ne concernent qu'EGUITRA GROUP SARLU"):
            cabinet_offer.action_eguitra_accept()
        # Sans avance : la situation se facture exactement comme avant.
        offer = self._btp_offer(eguitra_advance_rate=0)
        offer.action_eguitra_accept()
        situation = self._situation(offer.eguitra_chantier_id, 500_000_000)
        self.assertEqual(len(situation.invoice_id.invoice_line_ids), 1)
        self.assertAlmostEqual(situation.invoice_id.amount_untaxed, 500_000_000)
