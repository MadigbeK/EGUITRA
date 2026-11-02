"""Bons de commande fournisseur : depuis un engagement approuvé ou directement, circuit d'approbation du moteur
de la plateforme et règle des quatre yeux, empreinte, refus, réception partielle, pièce d'achat rattachée et
rapprochement à trois voies (écarts de prix et de quantité, tolérances, écart bloquant ou soumis au circuit),
pièce d'achat sans commande inchangée, comparaison des devis fournisseurs, bon de commande imprimé."""

from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, tagged

from .common import CommerceDataMixin


@tagged("post_install", "-at_install")
class TestAchats(CommerceDataMixin, TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_commerce()
        cls.acheteur = cls.make_user("acheteur.commerce", "achats")
        cls.comptable = cls.make_user("comptable.commerce", "finance")
        cls.chef_comptable = cls.make_user("chef.commerce", "finance")
        cls.daf = cls.make_user("daf.commerce", "finance")
        cls.dg = cls.make_user("dg.commerce", "direction")
        cls.chef_chantier = cls.make_user("chantier.commerce", "chantiers")
        cls.groupe.write({"eguitra_match_mode": "approval", "eguitra_match_price_tolerance": 2.0,
                          "eguitra_match_qty_tolerance": 0.0, "eguitra_three_quotes_threshold": 0.0})

    def _commitment(self, amount, user=None, partner=None):
        commitment = self.env["eguitra.commitment"].with_user(user or self.chef_chantier).create({
            "partner_id": (partner or self.supplier).id, "object": "Gasoil du chantier de démonstration",
            "amount": amount, "account_id": self.acc_purchase.id, "company_id": self.groupe.id,
        })
        return commitment

    def _approve_commitment(self, commitment):
        commitment.action_submit()
        request = self.request_of(commitment)
        request.with_user(self.chef_comptable).action_approve()
        if request.state == "pending":
            request.with_user(self.dg).action_approve()
        self.assertEqual(commitment.state, "approved")
        return commitment

    def _approve_all(self, request, users=None):
        """Chaque étape en attente tranchée par le premier compte qui le peut (une personne par étape)."""
        users = users or (self.comptable, self.chef_comptable, self.daf, self.dg)
        while request.state == "pending":
            decider = next((u for u in users if request._can_decide(u)), None)
            self.assertTrue(decider, f"Personne pour l'étape « {request.current_step_id.label} »")
            request.with_user(decider).action_approve()

    def _approved_po(self, lines=None):
        po = self.make_po(lines=lines, user=self.acheteur)
        po.action_eguitra_submit()
        request = self.request_of(po)
        if request:
            self._approve_all(request)
        self.assertEqual(po.eguitra_status, "approved")
        return po

    # ─── Bon de commande et circuit ───────────────────────────────────────

    def test_bon_de_commande_couvert_par_son_engagement(self):
        commitment = self._approve_commitment(self._commitment(10_000_000))
        po = self.make_po(user=self.chef_chantier, eguitra_commitment_id=commitment.id,
                          lines=[self.po_line("Gasoil (litres)", 800, 12_500)])
        self.assertTrue(po._eguitra_commitment_covers(), "10 M commandés pour 10 M engagés")
        po.action_eguitra_submit()
        self.assertEqual((po.state, po.eguitra_status), ("purchase", "approved"), "Approuvé d'office : l'engagement l'est")
        self.assertFalse(self.request_of(po), "Pas de nouveau circuit")
        over = self.make_po(user=self.chef_chantier, eguitra_commitment_id=commitment.id,
                            lines=[self.po_line("Gasoil supplémentaire", 100, 12_500)])
        self.assertFalse(over._eguitra_commitment_covers(), "Au-delà de l'engagement et de sa tolérance")
        over.action_eguitra_submit()
        self.assertEqual(over.eguitra_status, "to_approve", "Circuit habituel au-delà de l'engagement")

    def test_demandeur_de_l_engagement_ecarte_du_circuit_du_bon(self):
        commitment = self._approve_commitment(self._commitment(5_000_000, user=self.comptable))
        po = self.make_po(user=self.acheteur, eguitra_commitment_id=commitment.id,
                          lines=[self.po_line("Gasoil et lubrifiants", 1, 8_000_000)])
        po.action_eguitra_submit()
        request = self.request_of(po)
        self.assertTrue(request, "8 M commandés pour 5 M engagés : circuit")
        with self.assertRaises(AccessError, msg="Le demandeur de l'engagement ne tranche pas le bon qui en découle"):
            request.with_user(self.comptable).action_approve()
        request.with_user(self.chef_comptable).action_approve()
        with self.assertRaises(AccessError, msg="Ni la validation"):
            request.with_user(self.comptable).action_approve()
        request.with_user(self.daf).action_approve()
        self.assertEqual(po.eguitra_status, "approved")

    def test_circuit_d_approbation_et_quatre_yeux(self):
        po = self.make_po(user=self.acheteur, lines=[self.po_line("Groupe électrogène 100 kVA", 1, 60_000_000)])
        po.action_eguitra_submit()
        self.assertEqual((po.state, po.eguitra_status), ("to approve", "to_approve"))
        request = self.request_of(po)
        self.assertEqual(request.document, "purchase_order")
        self.assertEqual(request.step_ids.mapped("profile"), ["finance", "finance", "direction"],
                         "Circuit des bons de commande : contrôle, validation, direction au-delà de 10 M")
        with self.assertRaises(AccessError, msg="Celui qui crée et soumet le bon ne l'approuve pas"):
            request.with_user(self.acheteur).action_approve()
        with self.assertRaises(AccessError, msg="L'étape de la finance ne revient pas à la direction"):
            request.with_user(self.dg).action_approve()
        request.with_user(self.comptable).action_approve()
        self.assertEqual(po.state, "to approve", "Il reste la validation et l'étape de la direction")
        with self.assertRaises(AccessError, msg="Le contrôleur ne valide pas aussi"):
            request.with_user(self.comptable).action_approve()
        request.with_user(self.chef_comptable).action_approve()
        request.with_user(self.dg).action_approve()
        self.assertEqual((po.state, po.eguitra_status), ("purchase", "approved"))
        self.assertEqual(request.state, "approved")

    def test_auteur_du_bon_ecarte_meme_s_il_ne_le_soumet_pas(self):
        po = self.make_po(user=self.chef_comptable, lines=[self.po_line("Climatiseurs", 2, 3_000_000)])
        po.with_user(self.acheteur).sudo().action_eguitra_submit()
        request = self.request_of(po)
        self.assertEqual(request.requested_by, self.acheteur)
        with self.assertRaises(AccessError, msg="L'auteur du bon de commande n'en tranche aucune étape"):
            request.with_user(self.chef_comptable).action_approve()
        request.with_user(self.comptable).action_approve()
        with self.assertRaises(AccessError, msg="Ni la validation"):
            request.with_user(self.chef_comptable).action_approve()
        request.with_user(self.daf).action_approve()
        self.assertEqual(po.state, "purchase")

    def test_refus_puis_resoumission_et_empreinte(self):
        po = self.make_po(user=self.acheteur, lines=[self.po_line("Pneumatiques", 4, 1_500_000)])
        po.action_eguitra_submit()
        request = self.request_of(po)
        request.with_user(self.comptable).action_reject("Devis comparatif manquant")
        self.assertEqual((po.state, po.eguitra_status), ("draft", "rejected"))
        self.assertEqual(po._eguitra_approval_info()["rejected_reason"], "Devis comparatif manquant")
        po.order_line.price_unit = 1_400_000
        po.action_eguitra_submit()
        second = self.request_of(po)
        self.assertNotEqual(second, request)
        self.assertEqual(po.eguitra_status, "to_approve")
        # Modifié pendant l'approbation (hors des écrans, qui le refusent) : l'approbation est refusée.
        po.order_line.price_unit = 1_600_000
        with self.assertRaises(UserError):
            second.with_user(self.comptable).action_approve()

    # ─── Réception et rapprochement ───────────────────────────────────────

    def test_reception_partielle_puis_totale(self):
        po = self._approved_po(lines=[self.po_line("Gasoil (litres)", 1000, 12_000, product=self.item_supply),
                                      self.po_line("Transport du gasoil", 1, 2_000_000)])
        fuel, transport = po.order_line.sorted("sequence")
        receipt = po.eguitra_receive({fuel: 400}, note="Première livraison")
        self.assertTrue(receipt.name.startswith(f"REC/EG/{self.year}/"))
        self.assertEqual(fuel.qty_received, 400)
        self.assertEqual(po.eguitra_status, "partial")
        with self.assertRaises(UserError, msg="Pas de réception au-delà de la commande"):
            po.eguitra_receive({fuel: 700})
        po.eguitra_receive({fuel: 600, transport: 1})
        self.assertEqual(po.eguitra_status, "received")
        second = po.eguitra_receipt_ids.sorted("id")[-1]
        with self.assertRaises(UserError):
            second.action_cancel("")
        second.action_cancel("Quantités mal saisies")
        self.assertEqual((fuel.qty_received, transport.qty_received), (400, 0))
        self.assertEqual(po.eguitra_status, "partial")

    def test_rapprochement_conforme_sans_circuit(self):
        po = self._approved_po(lines=[self.po_line("Gasoil (litres)", 1000, 12_000, product=self.item_supply)])
        po.eguitra_receive({po.order_line: 400})
        bill = po.eguitra_create_bill(ref="FAC-FOURN-001")
        self.assertEqual((bill.move_type, bill.state, bill.eguitra_purchase_order_id), ("in_invoice", "draft", po))
        line = bill.invoice_line_ids
        self.assertEqual((line.quantity, line.price_unit, line.purchase_line_id), (400, 12_000, po.order_line))
        self.assertEqual(line.account_id, self.acc_purchase, "Compte de charge de l'article")
        match = bill._eguitra_match()
        self.assertTrue(match["ok"], match["issues"])
        self.assertFalse(bill._eguitra_required_rules(), "Couverte par la commande approuvée")
        bill.with_user(self.comptable)._eguitra_post_or_submit()
        self.assertEqual(bill.state, "posted")
        self.assertEqual(po.order_line.qty_invoiced, 400)
        with self.assertRaises(UserError, msg="Tout le reçu est facturé"):
            po.eguitra_create_bill()

    def test_ecart_de_prix_passe_par_le_circuit(self):
        po = self._approved_po(lines=[self.po_line("Ciment (sacs)", 100, 95_000)])
        po.eguitra_receive({po.order_line: 100})
        within = po.eguitra_create_bill(prices={po.order_line: 96_500})
        self.assertTrue(within._eguitra_match()["ok"], "1,6 % au-dessus du prix : dans la tolérance de 2 %")
        within.button_cancel()
        bill = po.eguitra_create_bill(prices={po.order_line: 100_000})
        match = bill._eguitra_match()
        self.assertFalse(match["ok"])
        self.assertIn("prix facturé", " ".join(match["issues"]))
        rules = bill._eguitra_required_rules()
        self.assertEqual(rules.mapped("approver_profile"), ["finance"], "Règle actuelle des pièces d'achat")
        bill.with_user(self.acheteur)._eguitra_post_or_submit()
        self.assertEqual(bill.state, "draft", "En attente de la finance")
        request = self.request_of(bill)
        self.assertEqual(request.document, "in_invoice")
        request.with_user(self.comptable).action_approve()
        self.assertEqual(bill.state, "posted")

    def test_ecart_de_quantite_bloquant(self):
        self.groupe.eguitra_match_mode = "block"
        po = self._approved_po(lines=[self.po_line("Parpaings", 2000, 4_000)])
        po.eguitra_receive({po.order_line: 1500})
        bill = po.eguitra_create_bill(quantities={po.order_line: 2000})
        match = bill._eguitra_match()
        self.assertFalse(match["ok"])
        self.assertIn("2000 facturés pour 1500 reçus", " ".join(match["issues"]))
        with self.assertRaises(UserError, msg="Écart bloquant : ni soumise ni validée"):
            bill.with_user(self.comptable)._eguitra_post_or_submit()
        with self.assertRaises(UserError):
            bill.with_user(self.comptable).action_post()
        self.assertFalse(self.request_of(bill))
        bill.invoice_line_ids.quantity = 1500
        bill.with_user(self.comptable)._eguitra_post_or_submit()
        self.assertEqual(bill.state, "posted", "Corrigée, la pièce se valide")

    def test_piece_d_achat_sans_commande_inchangee(self):
        bill = self.make_invoice("in_invoice", amount=5_000_000, post=False)
        self.assertFalse(bill.eguitra_purchase_order_id)
        rules = bill._eguitra_required_rules()
        self.assertEqual(rules.mapped("approver_profile"), ["finance"], "Circuit actuel des pièces d'achat")
        bill.with_user(self.acheteur)._eguitra_post_or_submit()
        self.assertEqual(bill.state, "draft")
        self.assertEqual(self.request_of(bill).document, "in_invoice")
        commitment = self._approve_commitment(self._commitment(10_000_000))
        covered = self.make_invoice("in_invoice", amount=5_000_000, post=False)
        covered.eguitra_commitment_id = commitment
        covered.with_user(self.comptable)._eguitra_post_or_submit()
        self.assertEqual(covered.state, "posted", "Couverte par l'engagement, comme avant")

    def test_bon_de_commande_imprime(self):
        commitment = self._approve_commitment(self._commitment(10_000_000))
        po = self.make_po(user=self.chef_chantier, eguitra_commitment_id=commitment.id,
                          lines=[self.po_line("Gasoil (litres)", 800, 12_500)],
                          eguitra_conditions="Livraison au parc de démonstration.")
        text = self.html_of("eguitra_commerce.action_report_purchase_order", po)
        for expected in ("BON DE COMMANDE", f"N° {po.name}", "FOURNISSEUR", self.supplier.name,
                         f"Engagement : {commitment.name}", "Commentaire ou indication : Fournitures de démonstration",
                         "Arrêté le présent bon de commande, toutes taxes comprises, à la somme de :", "BROUILLON",
                         "CONDITIONS DE LA COMMANDE", "Livraison au parc de démonstration."):
            self.assertIn(expected, text)
        direct = self.make_po(user=self.acheteur, lines=[self.po_line("Bureaux", 3, 2_000_000)])
        direct.action_eguitra_submit()
        self._approve_all(self.request_of(direct))
        text = self.html_of("eguitra_commerce.action_report_purchase_order", direct)
        self.assertNotIn("BROUILLON", text)
        self.assertIn("CIRCUIT D'APPROBATION", text)
        self.assertIn(self.comptable.name, text)

    # ─── Devis fournisseurs ───────────────────────────────────────────────

    def test_trois_devis_au_dela_du_seuil(self):
        Partner = self.env["res.partner"]
        suppliers = [Partner.create({"name": f"Fournisseur {letter} (test)", "supplier_rank": 1}) for letter in "ABC"]
        commitment = self._commitment(12_000_000)
        commitment.action_submit()
        self.assertEqual(commitment.state, "submitted", "Règle désactivée par défaut (aucun seuil)")
        self.groupe.eguitra_three_quotes_threshold = 5_000_000
        commitment = self._commitment(12_000_000)
        Quote = self.env["eguitra.commerce.supplier.quote"].with_user(self.chef_chantier)
        Quote.create({"commitment_id": commitment.id, "partner_id": suppliers[0].id, "amount": 12_000_000})
        Quote.create({"commitment_id": commitment.id, "partner_id": suppliers[1].id, "amount": 11_000_000,
                      "delay_days": 20})
        with self.assertRaises(UserError, msg="Plus de 5 M : trois devis au moins"):
            commitment.action_submit()
        third = Quote.create({"commitment_id": commitment.id, "partner_id": suppliers[2].id, "amount": 11_500_000,
                              "delay_days": 5})
        with self.assertRaises(UserError, msg="Le devis retenu est choisi avant la soumission"):
            commitment.action_submit()
        with self.assertRaises(UserError, msg="Choix motivé"):
            third.action_select("")
        third.action_select("Délai de 5 jours, compatible avec le planning du chantier")
        self.assertEqual((commitment.partner_id, commitment.amount), (suppliers[2], 11_500_000),
                         "L'engagement prend le fournisseur et le montant du devis retenu")
        commitment.action_submit()
        self.assertEqual(commitment.state, "submitted")
        with self.assertRaises(UserError, msg="Les devis d'un engagement soumis ne changent plus"):
            third.with_user(self.chef_chantier).write({"amount": 10_000_000})
