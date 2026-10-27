"""Offres commerciales et commandes des clients : numérotation par société, validité, expiration, versions,
refus, acceptation, facturation totale, par acomptes (déduits de la facture finale) et par quantités exécutées,
facture au gabarit de la plateforme avec la « Référence offre », offre imprimée."""

from datetime import timedelta

from odoo import Command
from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from .common import CommerceDataMixin


@tagged("post_install", "-at_install")
class TestOffres(CommerceDataMixin, TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_commerce()
        cls.daf = cls.make_user("daf.commerce", "finance", companies=cls.groupe | cls.cabinet)

    def _post(self, moves):
        moves.with_user(self.daf)._eguitra_post_or_submit()
        self.assertTrue(all(m.state == "posted" for m in moves), "Facture de vente validée sans circuit")

    def test_numerotation_propre_a_chaque_societe(self):
        offer = self.make_offer()
        self.assertTrue(offer.name.startswith(f"OF/EG/{self.year}/"), offer.name)
        cabinet_partner = self.env["res.partner"].create({"name": "Porteur de projet (test)"})
        other = self.make_offer(company=self.cabinet, partner_id=cabinet_partner.id, lines=[
            Command.create({"product_id": self.env["product.template"]._eguitra_generic_product(self.cabinet, "sale").id,
                            "name": "Honoraires d'accompagnement", "product_uom_qty": 3, "price_unit": 2_000_000,
                            "tax_ids": [Command.set([])]})])
        self.assertTrue(other.name.startswith(f"OF/MBAX/{self.year}/"), other.name)
        po = self.make_po()
        self.assertTrue(po.name.startswith(f"BC/EG/{self.year}/"), po.name)
        po_cabinet = self.make_po(company=self.cabinet, lines=[Command.create({
            "product_id": self.env["product.template"]._eguitra_generic_product(self.cabinet, "purchase").id,
            "name": "Fournitures du cabinet", "product_qty": 1, "price_unit": 100_000, "date_planned": self.planned,
            "tax_ids": [Command.set([])]})])
        self.assertTrue(po_cabinet.name.startswith(f"BC/MBAX/{self.year}/"), po_cabinet.name)
        self.assertNotEqual(self.groupe._eguitra_commerce_sequence("sale.order"),
                            self.cabinet._eguitra_commerce_sequence("sale.order"), "Une séquence par société")

    def test_validite_par_defaut_et_expiration(self):
        self.assertEqual(self.groupe.quotation_validity_days, 15, "Validité des offres : 15 jours par défaut")
        offer = self.make_offer()
        self.assertEqual(offer.eguitra_status, "draft")
        self.assertEqual(offer._eguitra_validity_days(), 15)
        offer.action_eguitra_mark_sent()
        self.assertEqual((offer.state, offer.eguitra_status), ("sent", "sent"))
        self.assertTrue(offer.eguitra_sent_at)
        offer.validity_date = offer.eguitra_offer_date - timedelta(days=1)
        with self.assertRaises(UserError, msg="Une offre dont la validité est passée ne s'accepte plus"):
            offer.action_eguitra_accept()
        expired = self.env["sale.order"]._cron_eguitra_expire()
        self.assertGreaterEqual(expired, 1)
        self.assertEqual((offer.state, offer.eguitra_status), ("cancel", "expired"))
        # Une offre expirée se reprend par une nouvelle version, valable à nouveau 15 jours.
        version = offer.action_eguitra_new_version()
        self.assertEqual(version.name, f"{offer.name}-V2")
        self.assertEqual((version.eguitra_status, version.eguitra_version), ("draft", 2))
        self.assertEqual(version._eguitra_validity_days(), 15)
        self.assertEqual(offer.eguitra_status, "expired", "L'offre expirée le reste")

    def test_versions_d_une_offre(self):
        offer = self.make_offer(lines=[self.sale_line("Étude de faisabilité", 1, 4_000_000)])
        offer.action_eguitra_mark_sent()
        v2 = offer.action_eguitra_new_version()
        self.assertEqual(offer.eguitra_status, "replaced", "L'offre envoyée est remplacée par sa nouvelle version")
        self.assertEqual(v2.eguitra_root_id, offer)
        self.assertEqual(v2.eguitra_previous_id, offer)
        self.assertEqual(v2.order_line.mapped("name"), ["Étude de faisabilité"], "Les lignes sont reprises")
        with self.assertRaises(UserError, msg="Une seule version ouverte : la plus récente"):
            offer.action_eguitra_new_version()
        v3 = v2.action_eguitra_new_version()
        self.assertEqual(v3.name, f"{offer.name}-V3")
        self.assertEqual(v3._eguitra_versions(), offer | v2 | v3)
        v3.action_eguitra_accept()
        with self.assertRaises(UserError, msg="Une offre acceptée ne change plus"):
            v3.action_eguitra_new_version()

    def test_refus_motive_et_annulation(self):
        offer = self.make_offer()
        with self.assertRaises(UserError):
            offer.action_eguitra_refuse("  ")
        offer.action_eguitra_refuse("Prix au-dessus du budget du client")
        self.assertEqual((offer.state, offer.eguitra_status), ("cancel", "refused"))
        self.assertEqual(offer.eguitra_refusal_reason, "Prix au-dessus du budget du client")
        with self.assertRaises(UserError):
            offer.action_eguitra_accept()
        other = self.make_offer()
        other.action_eguitra_cancel()
        self.assertEqual(other.eguitra_status, "cancelled")

    def test_acceptation_sans_message_au_client(self):
        offer = self.make_offer()
        offer.action_eguitra_accept()
        self.assertEqual((offer.state, offer.eguitra_status), ("sale", "accepted"))
        self.assertTrue(offer.eguitra_accepted_at)
        self.assertNotIn(self.customer, offer.message_partner_ids, "Aucun message du noyau ne part vers le client")

    def test_acomptes_puis_facture_finale(self):
        """Avance de démarrage 50 %, deuxième acompte 30 %, puis facture finale qui déduit les acomptes."""
        offer = self.make_offer(lines=[
            Command.create({"display_type": "line_section", "name": "Gros œuvre"}),
            self.sale_line("Fondations", 1, 6_000_000),
            self.sale_line("Élévation des murs", 1, 4_000_000),
        ])
        offer.action_eguitra_accept()
        first = offer.eguitra_create_invoice("percentage", 50, label="Avance de démarrage 50 %")
        self.assertEqual(len(first), 1)
        self.assertEqual(first.move_type, "out_invoice")
        self.assertEqual(first.state, "draft", "Facture créée en brouillon, validée ensuite dans les ventes")
        self.assertAlmostEqual(first.amount_untaxed, 5_000_000)
        self.assertAlmostEqual(first.amount_total, 5_900_000, msg="TVA 18 % sur l'acompte")
        lines = first.invoice_line_ids.filtered(lambda l: l.display_type == "product")
        self.assertEqual(set(lines.mapped("name")), {"Avance de démarrage 50 %"})
        self.assertTrue(all(code.startswith("4191") for code in lines.account_id.mapped("code")),
                        "Acompte reçu en 4191 « Clients, avances et acomptes reçus »")
        self.assertEqual(first.ref, offer.name, "La facture porte la référence de l'offre")
        self.assertEqual(first.eguitra_object, "Travaux de démonstration")
        self._post(first)

        second = offer.eguitra_create_invoice("percentage", 30, label="Deuxième acompte 30 %")
        self.assertAlmostEqual(second.amount_untaxed, 3_000_000)
        self._post(second)
        amounts = offer._eguitra_amounts()
        self.assertAlmostEqual(amounts["advances"], 8_000_000)
        self.assertAlmostEqual(amounts["to_deduct"], 8_000_000)
        with self.assertRaises(UserError, msg="Un acompte ne dépasse pas ce qui reste à facturer"):
            offer.eguitra_create_invoice("percentage", 30)

        final = offer.eguitra_create_invoice("total")
        self.assertAlmostEqual(final.amount_untaxed, 2_000_000, msg="10 M commandés moins 8 M d'acomptes")
        deductions = final.invoice_line_ids.filtered(lambda l: l.display_type == "product" and l.price_subtotal < 0)
        self.assertEqual(len(deductions), 2)
        self.assertTrue(all(name.startswith("Déduction : ") for name in deductions.mapped("name")), deductions.mapped("name"))
        self._post(final)
        amounts = offer._eguitra_amounts()
        self.assertAlmostEqual(amounts["invoiced"], 10_000_000)
        self.assertAlmostEqual(amounts["to_invoice"], 0)
        self.assertAlmostEqual(amounts["to_deduct"], 0)
        with self.assertRaises(UserError, msg="Tout est facturé"):
            offer.eguitra_create_invoice("total")

    def test_acompte_en_montant(self):
        offer = self.make_offer()
        offer.action_eguitra_accept()
        # Hypothèse sur le noyau 19 : un acompte en montant fixe s'entend TVA comprise (proportion du total TTC de la
        # commande appliquée à chaque groupe de taxe), comme depuis la 17.
        invoice = offer.eguitra_create_invoice("fixed", 2_360_000)
        self.assertAlmostEqual(invoice.amount_total, 2_360_000, msg="Montant de l'acompte, TVA comprise")
        with self.assertRaises(UserError):
            offer.eguitra_create_invoice("fixed", 0)

    def test_facturation_par_quantites_executees(self):
        day = self.env.ref("uom.product_uom_day", raise_if_not_found=False) or self.unit
        offer = self.make_offer(lines=[self.sale_line("Assistance technique sur site", 10, 500_000,
                                                      product=self.item_service, uom=day)])
        offer.action_eguitra_accept()
        with self.assertRaises(UserError, msg="Rien d'exécuté : rien à facturer"):
            offer.eguitra_create_invoice("delivered")
        line = offer.order_line
        line.qty_delivered = 4
        first = offer.eguitra_create_invoice("delivered")
        self.assertEqual(first.invoice_line_ids.filtered(lambda l: l.display_type == "product").quantity, 4)
        self.assertAlmostEqual(first.amount_untaxed, 2_000_000)
        self.assertEqual(first.invoice_line_ids.account_id, self.acc_services, "Compte de produit de l'article")
        self._post(first)
        line.qty_delivered = 10
        second = offer.eguitra_create_invoice("delivered")
        self.assertEqual(second.invoice_line_ids.filtered(lambda l: l.display_type == "product").quantity, 6)
        self._post(second)
        self.assertAlmostEqual(offer._eguitra_amounts()["to_invoice"], 0)

    def test_offre_imprimee_au_gabarit_de_la_societe(self):
        self.groupe.city = "Conakry"
        offer = self.make_offer(lines=[
            Command.create({"display_type": "line_section", "name": "Terrassement"}),
            self.sale_line("Déblais", 120, 25_000, uom=self.uom_m3),
            self.sale_line("Remblais", 80, 30_000, uom=self.uom_m3, discount=10),
            Command.create({"display_type": "line_note", "name": "Évacuation des déblais comprise."}),
        ], eguitra_conditions="Exécution sous 30 jours après l'ordre de service.")
        text = self.html_of("eguitra_commerce.action_report_offer", offer)
        for expected in ("OFFRE", f"N° {offer.name}", "CLIENT", self.customer.name, f"Référence offre : {offer.name}",
                         "Validité offre : 15 jours, jusqu'au", "Commentaire ou indication : Travaux de démonstration",
                         "I. Terrassement", "Sous-total Terrassement", "Évacuation des déblais comprise.",
                         "Unité", "Remise", "10 %", "Arrêtée la présente offre à la somme de :",
                         "CONDITIONS DE L'OFFRE", "Exécution sous 30 jours", "Conakry, le"):
            self.assertIn(expected, text)
        offer.action_eguitra_refuse("Hors budget")
        self.assertIn("OFFRE REFUSÉE", self.html_of("eguitra_commerce.action_report_offer", offer))
