"""Factures au modèle des sociétés, côté API : objet, rubriques et unités des lignes, impression, paramètres
des journaux (signataire, modes de règlement, numérotation reprise, comptes bancaires) et refus par profil.
Données fictives : aucun numéro de compte, téléphone ni adresse du client."""

import html
import re

from odoo import fields
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_api.tests.profils import RefusParProfil

from ..controllers.common import FIN_READ, FIN_WRITE
from ..controllers.moves import PURCHASE_READ
from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestApiFactures(RefusParProfil, FinanceDataMixin, ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("admin.factures", "admin")
        cls._create_user("fatou", "finance")
        # Séquence haute : jamais le journal de vente par défaut des autres factures du test.
        cls.journal = cls.env["account.journal"].create({
            "name": "Ventes de démonstration", "type": "sale", "code": "TDEM", "company_id": cls.company.id,
            "sequence": 99,
        })
        cls.bank_demo = cls.env["account.journal"].create({
            "name": "Banque de démonstration", "type": "bank", "code": "TBQD", "company_id": cls.company.id,
        })
        cls.year = fields.Date.context_today(cls.env.user).year

    def setUp(self):
        super().setUp()
        self.finance = self.open_session("fatou")["access_token"]

    def _admin(self):
        return self.open_session("admin.factures")["access_token"]

    def _pdf_text(self, move_id, token):
        # En test, Odoo rend le rapport en HTML au lieu du PDF.
        response = self.url_open(f"/api/v1/finance/moves/{move_id}/pdf",
                                 headers={"Authorization": f"Bearer {token}", "X-Eguitra-App": "test"}, timeout=60)
        self.assertEqual(response.status_code, 200, response.text[:500])
        self.assertEqual(response.headers["Content-Type"], "application/pdf")
        text = re.sub(r"<[^>]+>", " ", response.content.decode("utf-8", "replace"))
        return re.sub(r"[ \t\r\n]+", " ", html.unescape(text))

    def test_objet_rubriques_et_unites_de_la_facture(self):
        status, uoms = self.call("GET", "/finance/uoms", token=self.finance)
        self.assertEqual(status, 200, uoms)
        unit = self.env.ref("uom.product_uom_unit")
        other = next(u for u in uoms if u["id"] != unit.id)
        status, move = self.call("POST", "/finance/moves", {
            "move_type": "out_invoice", "partner_id": self.customer.id, "journal_id": self.journal.id,
            "ref": "OFF-DEMO-007", "invoice_object": "  Location de véhicule  ",
            "lines": [
                {"display_type": "line_section", "name": "Véhicules"},
                {"name": "Véhicule de liaison, 4 jours", "quantity": 4, "price_unit": 250_000,
                 "account_id": self.acc_services.id, "uom_id": other["id"]},
                {"display_type": "line_note", "name": "Carburant à la charge du client."},
            ],
        }, token=self.finance)
        self.assertEqual(status, 200, move)
        self.assertEqual(move["invoice_object"], "Location de véhicule")
        self.assertEqual(move["amount_untaxed"], 1_000_000)
        self.assertEqual([line["display_type"] for line in move["lines"]], ["line_section", "product", "line_note"])
        self.assertEqual(move["lines"][1]["uom"]["id"], other["id"])

        status, body = self.call("PATCH", f"/finance/moves/{move['id']}", {"invoice_object": "Location d'un véhicule"},
                                 token=self.finance)
        self.assertEqual((status, body.get("invoice_object")), (200, "Location d'un véhicule"), body)

        page = self._pdf_text(move["id"], self.finance)
        for expected in ("BROUILLON", "Référence offre : OFF-DEMO-007", "Commentaire ou indication : Location d'un véhicule",
                         "I. Véhicules", "Sous-total Véhicules 1 000 000", "Carburant à la charge du client.",
                         "Arrêtée la présente facture à la somme de :",
                         "Un million cent quatre-vingt mille francs guinéens", "Service Comptabilité & Finance"):
            self.assertIn(expected, page)

        status, body = self.call("POST", "/finance/moves", {
            "move_type": "out_invoice", "partner_id": self.customer.id,
            "lines": [{"display_type": "line_section", "name": "Rubrique sans ligne"}],
        }, token=self.finance)
        self.assertEqual(status, 400, "Une facture porte au moins une ligne chiffrée")
        status, body = self.call("POST", "/finance/moves", {
            "move_type": "out_invoice", "partner_id": self.customer.id,
            "lines": [{"name": "Ligne", "quantity": 1, "price_unit": 10, "uom_id": 999_999_999}],
        }, token=self.finance)
        self.assertEqual(status, 422, "Unité inconnue")

        # Objet modifiable par la finance seule : direction (lecture), achats (pièces d'achat), métiers refusés.
        self.assertRefuseHors(FIN_WRITE, "PATCH", f"/finance/moves/{move['id']}", {"invoice_object": "Refusé"})
        self.env.invalidate_all()
        self.assertEqual(self.env["account.move"].browse(move["id"]).eguitra_object, "Location d'un véhicule")
        self.assertRefuseHors(PURCHASE_READ, "GET", "/finance/uoms")

    def test_parametres_des_journaux_de_vente(self):
        admin = self._admin()
        status, settings = self.call("GET", "/finance/invoicing/settings", token=self.finance)
        self.assertEqual(status, 200, settings)
        row = next(j for j in settings["sales"] if j["id"] == self.journal.id)
        self.assertEqual((row["signatory"], row["payment_methods"], row["legacy_last_number"], row["last_number"]),
                         ("Service Comptabilité & Finance", "Par chèque ou virement bancaire", None, None))
        self.assertTrue(row["next_number"], "Aperçu du prochain numéro")

        path = f"/finance/invoicing/journals/{self.journal.id}"
        status, body = self.call("PATCH", path, {"legacy_last_number": f"0026/MBAX06/{self.year % 100:02d}"}, token=admin)
        self.assertEqual(status, 422, body)
        self.assertIn("compteur n'est pas en fin de numéro", body["message"])
        self.assertEqual((body["suggestion"], body["next_number"]), (f"MBAX/{self.year}/0026", f"MBAX/{self.year}/0027"))
        status, body = self.call("GET", f"{path}/numbering?last=EG24137", token=admin)
        self.assertEqual((status, body.get("next_number")), (200, "EG24138"), body)
        status, body = self.call("GET", f"{path}/numbering?last=0026%2FMBAX%2F{self.year}", token=admin)
        self.assertEqual(status, 422, "Le numéro finit par l'année : refusé avant l'enregistrement")

        status, body = self.call("PATCH", path, {
            "signatory": "SERVICE FINANCE", "payment_methods": "Par espèces, virement bancaire ou chèque",
            "legacy_last_number": "EG24137",
        }, token=admin)
        self.assertEqual(status, 200, body)
        self.assertEqual((body["signatory"], body["legacy_last_number"], body["next_number"]),
                         ("SERVICE FINANCE", "EG24137", "EG24138"))
        # Le réglage vient d'une requête : le cache du test est relu.
        self.env.invalidate_all()
        invoice = self.env["account.move"].create({
            "move_type": "out_invoice", "journal_id": self.journal.id, "partner_id": self.customer.id,
            "invoice_date": self.today, "invoice_line_ids": [(0, 0, {
                "name": "Location de véhicule", "quantity": 1, "price_unit": 1_000_000,
                "account_id": self.acc_services.id, "tax_ids": [(6, 0, self.tax_sale.ids)]})],
        })
        invoice.with_context(eguitra_approval_granted=True).action_post()
        self.assertEqual(invoice.name, "EG24138", "Première facture du journal : suite de l'ancien système")
        status, body = self.call("GET", "/finance/invoicing/settings", token=admin)
        row = next(j for j in body["sales"] if j["id"] == self.journal.id)
        self.assertEqual((row["last_number"], row["next_number"]), ("EG24138", "EG24139"))
        status, body = self.call("PATCH", path, {"legacy_last_number": "EG30000"}, token=admin)
        self.assertEqual(status, 422, "Le journal numérote déjà ses factures")
        status, body = self.call("PATCH", path, {"show_on_invoices": True}, token=admin)
        self.assertEqual(status, 422, "Réglage d'un journal de banque refusé sur un journal de vente")

        page = self._pdf_text(invoice.id, admin)
        self.assertIn("SERVICE FINANCE", page)
        self.assertIn("Par espèces, virement bancaire ou chèque", page)
        self.assertIn("N° EG24138", page)

    def test_comptes_bancaires_portes_sur_les_factures(self):
        admin = self._admin()
        path = f"/finance/invoicing/journals/{self.bank_demo.id}"
        status, body = self.call("PATCH", path, {"show_on_invoices": True}, token=admin)
        self.assertEqual(status, 422, "Un compte affiché sur les factures a son numéro")
        status, body = self.call("PATCH", path, {
            "account_number": "99000777888999", "bank_name": "Banque Démo C", "iban": "gn00 demo 9900 0777 8889 99",
            "swift": "democnxx", "show_on_invoices": True,
        }, token=admin)
        self.assertEqual(status, 200, body)
        self.assertEqual((body["account_number"], body["bank_name"], body["iban"], body["swift"], body["show_on_invoices"]),
                         ("99000777888999", "Banque Démo C", "GN00DEMO99000777888999", "DEMOCNXX", True))
        self.env.invalidate_all()
        banks = self.company._eguitra_invoice_banks()
        self.assertIn({"bank": "Banque Démo C", "number": "99000777888999", "iban": "GN00DEMO99000777888999",
                       "swift": "DEMOCNXX", "currency": None}, banks)
        status, body = self.call("PATCH", path, {"signatory": "Refusé"}, token=admin)
        self.assertEqual(status, 422, "Réglage d'un journal de vente refusé sur un journal de banque")
        status, settings = self.call("GET", "/finance/invoicing/settings", token=self.finance)
        self.assertIn(self.bank_demo.id, [b["id"] for b in settings["banks"] if b["show_on_invoices"]])

        invoice = self.make_invoice()
        page = self._pdf_text(invoice.id, self.finance)
        self.assertIn("Banque Démo C : compte n° 99000777888999", page)
        self.assertIn("IBAN : GN00DEMO99000777888999 · SWIFT : DEMOCNXX", page)

        status, body = self.call("PATCH", path, {"show_on_invoices": False}, token=admin)
        self.assertEqual((status, body.get("show_on_invoices")), (200, False), body)
        self.assertNotIn("99000777888999", self._pdf_text(invoice.id, self.finance))

    def test_refus_par_profil(self):
        """Lecture : profils de la finance ; modification et aperçu de la numérotation : administration."""
        self.assertRefuseHors(FIN_READ, "GET", "/finance/invoicing/settings")
        sale = f"/finance/invoicing/journals/{self.journal.id}"
        self.assertRefuseHors(("admin",), "PATCH", sale, {"signatory": "Refusé", "legacy_last_number": "EG100"})
        self.assertRefuseHors(("admin",), "GET", f"{sale}/numbering?last=EG100")
        self.assertRefuseHors(("admin",), "PATCH", f"/finance/invoicing/journals/{self.bank_demo.id}",
                              {"account_number": "99000000000001"})
        self.env.invalidate_all()
        self.assertEqual((self.journal.eguitra_signatory, self.journal.eguitra_legacy_last_number),
                         ("Service Comptabilité & Finance", False), "Rien n'a changé")
        self.assertFalse(self.bank_demo.bank_account_id)
        status, _body = self.call("PATCH", sale, {"signatory": "Refusé"}, token=self.finance)
        self.assertEqual(status, 403, "La finance consulte, l'administration modifie")
