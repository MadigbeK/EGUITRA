"""Factures au modèle des sociétés du groupe : montant en lettres, gabarit, numérotation reprise de
l'ancien système. Données fictives : aucun numéro de compte, téléphone ni adresse du client."""

import html
import re
from types import SimpleNamespace

from odoo import Command, fields
from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged

from ..lettres import amount_in_words, capitalize, number_trim, roman


@tagged("post_install", "-at_install")
class TestFacture(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.ref("base.main_company")
        cls.env = cls.env(context=dict(cls.env.context, allowed_company_ids=[cls.company.id]))
        env = cls.env
        cls.company.write({
            "street": "Quartier Démo, rue D-12", "city": "Conakry", "zip": "1234", "phone": "620 00 00 01 / 620 00 00 02",
            "email": "factures@exemple.test", "vat": "100200300", "company_registry": "RCCM-DEMO-0001",
            "report_header": "Slogan de démonstration",
        })
        cls.income = env["account.account"].search(
            [("code", "=like", "706%"), ("company_ids", "in", cls.company.ids)], order="code", limit=1)
        cls.tax = env["account.tax"].search([("company_id", "=", cls.company.id), ("type_tax_use", "=", "sale"),
                                             ("amount", "=", 18), ("amount_type", "=", "percent")], limit=1)
        # Banque des règlements : celle du plan de comptes, avec ses comptes d'attente.
        cls.payment_bank = env["account.journal"].search(
            [("company_id", "=", cls.company.id), ("type", "=", "bank")], order="id", limit=1)
        cls.customer = env["res.partner"].create({
            "name": "CLIENT DÉMO SA", "street": "Avenue de démonstration", "city": "Kindia",
            "phone": "620 99 99 99", "email": "client@exemple.test", "vat": "900800700",
        })
        cls.shown = env["account.journal"].create({
            "name": "Banque Démo A", "type": "bank", "code": "TBQA", "company_id": cls.company.id,
            "bank_acc_number": "99000111222333", "eguitra_show_on_invoices": True,
        })
        cls.shown.bank_account_id.write({
            "eguitra_iban": "GN00DEMO99000111222333",
            "bank_id": env["res.bank"].create({"name": "Banque Démo A", "bic": "DEMOGNXX"}).id,
        })
        cls.hidden = env["account.journal"].create({
            "name": "Banque Démo B", "type": "bank", "code": "TBQB", "company_id": cls.company.id,
            "bank_acc_number": "99000444555666",
        })

    def _journal(self, code="TFAC", **values):
        return self.env["account.journal"].create(dict({
            "name": f"Ventes {code}", "type": "sale", "code": code, "company_id": self.company.id,
            "refund_sequence": True,
        }, **values))

    def _invoice(self, journal, lines=None, post=True, move_type="out_invoice", **values):
        lines = lines or [Command.create({"name": "Location de véhicule", "quantity": 1, "price_unit": 1_000_000,
                                          "account_id": self.income.id, "tax_ids": [Command.set(self.tax.ids)]})]
        move = self.env["account.move"].create(dict({
            "move_type": move_type, "journal_id": journal.id, "partner_id": self.customer.id,
            "invoice_date": fields.Date.context_today(self.env.user), "invoice_line_ids": lines,
        }, **values))
        if post:
            # Hors du circuit d'approbation (eguitra_approval), quand il est installé.
            move.with_context(eguitra_approval_granted=True).action_post()
        return move

    def _html(self, move, report="account.account_invoices"):
        """Texte de la facture rendue en HTML : balises retirées, blancs ordinaires réduits (les espaces
        insécables des montants restent)."""
        content, _type = self.env["ir.actions.report"]._render_qweb_html(report, move.ids)
        text = re.sub(r"<[^>]+>", " ", content.decode() if isinstance(content, bytes) else str(content))
        return re.sub(r"[ \t\r\n]+", " ", html.unescape(text))

    # ─── Montant en lettres ───────────────────────────────────────────────

    def test_montant_en_lettres_partage(self):
        """Montant en lettres commun aux factures et aux bulletins (eguitra_rh l'importe de son moteur)."""
        self.assertEqual(amount_in_words(1_180_000), "un million cent quatre-vingt mille francs guinéens")
        self.assertEqual(amount_in_words(1_000_000, "GNF"), "un million de francs guinéens")
        self.assertEqual(amount_in_words(200_080), "deux cent mille quatre-vingts francs guinéens")
        self.assertEqual(amount_in_words(1), "un franc guinéen")
        self.assertEqual(amount_in_words(0), "zéro franc guinéen")
        self.assertEqual(amount_in_words(2_800_000, self.company.currency_id),
                         "deux millions huit cent mille francs guinéens", "Devise GNF de la société")
        euro = SimpleNamespace(name="EUR", currency_unit_label="Euros", currency_subunit_label="Cents", decimal_places=2)
        self.assertEqual(amount_in_words(1250.5, euro), "mille deux cent cinquante euros et cinquante cents")
        self.assertEqual(amount_in_words(1_000_000, euro), "un million d'euros")
        self.assertEqual(amount_in_words(1, euro), "un euro")
        self.assertEqual(amount_in_words(3000, "USD"), "trois mille USD", "Devise sans libellé : son code")
        self.assertEqual(capitalize("deux millions de francs guinéens"), "Deux millions de francs guinéens")
        self.assertEqual([roman(n) for n in (1, 2, 4, 9, 14, 40)], ["I", "II", "IV", "IX", "XIV", "XL"])
        self.assertEqual(number_trim(39.875 * 1000), "39 875")
        self.assertEqual(number_trim(452.5), "452,5")

    # ─── Gabarit ──────────────────────────────────────────────────────────

    def test_facture_au_modele_des_societes(self):
        journal = self._journal()
        unit = self.env.ref("uom.product_uom_unit")
        other_unit = self.env["uom.uom"].search([("id", "!=", unit.id)], limit=1)
        line = {"account_id": self.income.id, "tax_ids": [Command.set(self.tax.ids)]}
        invoice = self._invoice(journal, ref="OFF-DEMO-012", eguitra_object="Crépissage du bâtiment principal", lines=[
            Command.create({"display_type": "line_section", "name": "Charpente et couverture"}),
            Command.create(dict(line, name="Charpente", quantity=2, price_unit=250_000, product_uom_id=other_unit.id)),
            Command.create(dict(line, name="Couverture", quantity=1, price_unit=300_000)),
            Command.create({"display_type": "line_note", "name": "Travaux réalisés selon le devis accepté."}),
            Command.create({"display_type": "line_section", "name": "Divers"}),
            Command.create(dict(line, name="Accessoires de fixation", quantity=1, price_unit=200_000)),
        ])
        self.assertEqual(invoice.amount_total, 1_180_000)
        self.assertEqual(invoice._get_name_invoice_report(), "eguitra_base.report_invoice_document")
        page = self._html(invoice)
        for expected in (
            "FACTURE", f"N° {invoice.name}", f"Conakry, le {invoice.invoice_date:%d/%m/%Y}",
            # Société : raison sociale, adresse, contacts, mentions légales, slogan de l'en-tête.
            self.company.name, "Quartier Démo, rue D-12", "BP 1234 – Conakry", "Contact : 620 00 00 01 / 620 00 00 02",
            "E-mail : factures@exemple.test", "NIF : 100200300 · RCCM : RCCM-DEMO-0001", "Slogan de démonstration",
            # Client, référence de l'offre, objet.
            "CLIENT", "Nom : CLIENT DÉMO SA", "Adresse : Avenue de démonstration, Kindia", "Contact : 620 99 99 99",
            "E-mail : client@exemple.test", "NIF : 900800700", "Référence offre : OFF-DEMO-012",
            "Commentaire ou indication : Crépissage du bâtiment principal",
            # Rubriques numérotées et leur sous-total, note, colonne Unité (une ligne n'est pas en « Unité »).
            "I. Charpente et couverture", "Sous-total Charpente et couverture 800 000", "II. Divers",
            "Sous-total Divers 200 000", "Travaux réalisés selon le devis accepté.", "Unité",
            other_unit.with_context(lang=self.customer.lang or "en_US").name, "PU HT (GNF)", "Montant HT (GNF)",
            # Totaux, montant en toutes lettres du TTC, conditions de règlement, comptes, signataire.
            "Montant HT", "1 000 000 GNF", "NET À PAYER (TTC)", "1 180 000 GNF",
            "Arrêtée la présente facture à la somme de :", "Un million cent quatre-vingt mille francs guinéens",
            "CONDITIONS ET MODE DE RÈGLEMENT", f"Échéance : Le {invoice.invoice_date_due:%d/%m/%Y}",
            "Par chèque ou virement bancaire", "Banque Démo A : compte n° 99000111222333",
            "IBAN : GN00DEMO99000111222333 · SWIFT : DEMOGNXX", "Service Comptabilité & Finance",
        ):
            self.assertIn(expected, page)
        self.assertNotIn("99000444555666", page, "Compte non marqué « afficher sur les factures »")
        self.assertNotIn("BROUILLON", page)
        self.assertLess(page.index("Service Comptabilité & Finance"), page.rindex(self.company.name),
                        "Le signataire, puis la raison sociale")
        self.assertLess(page.index("I. Charpente"), page.index("Sous-total Charpente"))
        self.assertLess(page.index("Sous-total Charpente"), page.index("II. Divers"))

        journal.write({"eguitra_signatory": "SERVICE COMMERCIAL",
                       "eguitra_payment_methods": "Par espèces, virement bancaire ou chèque"})
        page = self._html(invoice)
        self.assertIn("SERVICE COMMERCIAL", page, "Signataire propre au journal de vente")
        self.assertIn("Par espèces, virement bancaire ou chèque", page)

    def test_sans_unite_ni_rubrique(self):
        """Lignes toutes en « Unité » : pas de colonne Unité ; sans section, pas de sous-total."""
        page = self._html(self._invoice(self._journal()))
        self.assertNotIn("Unité", page)
        self.assertNotIn("Sous-total", page)
        self.assertIn("Location de véhicule", page)

    def test_brouillon_avoir_et_reste_a_payer(self):
        journal = self._journal()
        draft = self._invoice(journal, post=False)
        page = self._html(draft)
        self.assertIn("BROUILLON", page, "Brouillon clairement marqué")
        self.assertIn("Brouillon", page)
        self.assertNotIn("N° ", page.split("CLIENT", 1)[0].split("FACTURE", 1)[-1], "Pas de numéro avant la validation")

        invoice = self._invoice(journal)
        wizard = self.env["account.payment.register"].with_context(
            active_model="account.move", active_ids=invoice.ids).create({
                "amount": 180_000, "journal_id": self.payment_bank.id,
                "payment_date": fields.Date.context_today(self.env.user)})
        wizard._create_payments()
        self.assertEqual(invoice.amount_residual, 1_000_000, "Facture partiellement réglée")
        page = self._html(invoice)
        self.assertIn("Paiement perçu", page)
        self.assertIn("Reste à payer", page)
        self.assertIn("1 000 000 GNF", page)
        page = self._html(invoice, "account.account_invoices_without_payment")
        self.assertNotIn("Reste à payer", page, "Impression sans règlements (profil Achats)")

        refund = invoice._reverse_moves([{"invoice_date": invoice.invoice_date, "ref": "Avoir de démonstration"}])
        refund.with_context(eguitra_approval_granted=True).action_post()
        page = self._html(refund)
        self.assertIn("AVOIR", page)
        self.assertIn("Arrêté le présent avoir à la somme de :", page)
        self.assertIn(f"Facture d'origine : {invoice.name}", page)
        self.assertNotIn("CONDITIONS ET MODE DE RÈGLEMENT", page)

    def test_pieces_d_achat_au_gabarit_du_noyau(self):
        purchase = self.env["account.move"].new({"move_type": "in_invoice", "company_id": self.company.id})
        self.assertEqual(purchase._get_name_invoice_report(), "account.report_invoice_document")

    # ─── Numérotation reprise de l'ancien système ─────────────────────────

    def test_numerotation_continue_l_ancien_systeme(self):
        journal = self._journal(eguitra_legacy_last_number="EG24137")
        self.assertEqual(journal._eguitra_next_number(), "EG24138", "Aperçu du prochain numéro")
        first = self._invoice(journal)
        self.assertEqual(first.name, "EG24138", "La première facture prend le numéro suivant de l'ancien système")
        second = self._invoice(journal)
        self.assertEqual(second.name, "EG24139", "Puis le noyau continue")
        self.assertEqual(journal._eguitra_next_number(), "EG24140")
        refund = self._invoice(journal, move_type="out_refund")
        self.assertFalse(refund.name.startswith("EG"), "Les avoirs gardent leur propre suite")
        with self.assertRaises(ValidationError, msg="Le journal numérote déjà ses factures"):
            journal.eguitra_legacy_last_number = "EG30000"

    def test_numero_continu_par_annee(self):
        year = fields.Date.context_today(self.env.user).year
        journal = self._journal("TFAY", eguitra_legacy_last_number=f"MBAX/{year}/0026")
        self.assertEqual(self._invoice(journal).name, f"MBAX/{year}/0027")
        self.assertEqual(self._invoice(journal).name, f"MBAX/{year}/0028")

    def test_numero_non_continuable_refuse(self):
        year = fields.Date.context_today(self.env.user).year
        journal = self._journal("TFAX")
        # Compteur, mois, année : le noyau lirait « année 06, compteur 26 » et écrirait 0026/MBAX06/27.
        with self.assertRaises(ValidationError) as refused:
            journal.eguitra_legacy_last_number = f"0026/MBAX06/{year % 100:02d}"
        message = str(refused.exception)
        self.assertIn("compteur n'est pas en fin de numéro", message)
        self.assertIn(f"MBAX/{year}/0026", message, "Dernier numéro à saisir au format continu le plus proche")
        self.assertIn(f"MBAX/{year}/0027", message, "Numéro de la première facture")
        refusal = journal._eguitra_legacy_refusal(f"0026/MBAX06/{year % 100:02d}")
        self.assertEqual((refusal["suggestion"], refusal["next"]), (f"MBAX/{year}/0026", f"MBAX/{year}/0027"))
        for number in (f"0026/MBAX/{year}", "FACTURE", "12345678901"):
            with self.subTest(number=number), self.assertRaises(ValidationError):
                journal.eguitra_legacy_last_number = number
        self.assertIsNone(journal._eguitra_legacy_refusal("EG24137"))
        purchase = self.env["account.journal"].search(
            [("company_id", "=", self.company.id), ("type", "=", "purchase")], limit=1)
        with self.assertRaises(ValidationError, msg="Journaux de vente seulement"):
            purchase.eguitra_legacy_last_number = "EG24137"
