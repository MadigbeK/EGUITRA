"""Routes des achats et des ventes : parcours par les écrans (offre, commande, facture ; bon de commande,
approbation, réception, pièce d'achat rapprochée), réglages, catalogue et son import, tableaux de bord et
exports, échéances ; refus par profil de chaque route ; demandes des métiers ; séparation des deux sociétés."""

import csv
import io

from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_api.tests.profils import RefusParProfil

from ..controllers.common import (
    CATALOGUE_READ,
    CATALOGUE_WRITE,
    PURCHASE_ALL,
    PURCHASE_BILL,
    PURCHASE_DASH,
    PURCHASE_FULL,
    QUOTES,
    SALES_INVOICE,
    SALES_READ,
    SALES_WRITE,
    SETTINGS,
)
from .common import CommerceDataMixin

PDF = b"%PDF-1.4 bon de livraison du fournisseur (test)"


@tagged("post_install", "-at_install")
class TestApiCommerce(RefusParProfil, CommerceDataMixin, ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_commerce()
        both = [(6, 0, (cls.groupe | cls.cabinet).ids)]
        cls._create_user("fin.commerce", "finance", company_ids=both)
        cls._create_user("fin2.commerce", "finance")
        cls._create_user("dg.commerce", "direction")
        cls._create_user("achats.commerce", "achats")
        cls._create_user("btp.commerce", "chantiers")
        cls._create_user("btp2.commerce", "chantiers")
        cls.category = cls.env["eguitra.expense.category"].create({
            "name": "Fournitures de chantier (test)", "nature": "opex_metier", "account_id": cls.acc_purchase.id,
            "company_id": cls.groupe.id,
        })

    def setUp(self):
        super().setUp()
        self.finance = self.open_session("fin.commerce")["access_token"]

    def _ok(self, method, path, payload=None, token=None, headers=None):
        status, body = self.call(method, path, payload, token=token or self.finance, headers=headers)
        self.assertEqual(status, 200, body)
        return body

    def _download(self, path, token=None):
        response = self.url_open(f"/api/v1{path}", headers={"Authorization": f"Bearer {token or self.finance}",
                                                             "X-Eguitra-App": "test"}, timeout=60)
        self.assertEqual(response.status_code, 200, response.text[:300])
        return response

    def _upload(self, path, name, content, token=None):
        response = self.url_open(f"/api/v1{path}", files={"file": (name, io.BytesIO(content))},
                                 headers={"Authorization": f"Bearer {token or self.finance}", "X-Eguitra-App": "test"},
                                 timeout=60)
        try:
            return response.status_code, response.json()
        except ValueError:
            return response.status_code, response.text

    def _offer_payload(self, **values):
        return dict({
            "partner_id": self.customer.id, "object": "Assistance technique (essai)", "discount": 5,
            "lines": [
                {"display_type": "line_section", "name": "Assistance"},
                {"name": "Ingénieur sur site", "quantity": 2, "price_unit": 1_000_000,
                 "product_id": self.item_service.id},
            ],
        }, **values)

    # ─── Ventes ───────────────────────────────────────────────────────────

    def test_offre_commande_et_facture_par_les_routes(self):
        refs = self._ok("GET", "/commerce/referentials")
        self.assertTrue(refs["uoms"])
        self.assertTrue(any(t["id"] == self.tax_sale.id for t in refs["sale_taxes"]))
        offer = self._ok("POST", "/commerce/offers", self._offer_payload(validity_days=10))
        self.assertTrue(offer["name"].startswith(f"OF/EG/{self.year}/"))
        self.assertEqual((offer["status"], offer["validity_days"]), ("draft", 10))
        priced = [line for line in offer["lines"] if line["display_type"] == "product"]
        self.assertEqual(priced[0]["discount"], 5, "Remise générale appliquée à la ligne")
        self.assertAlmostEqual(offer["amount_untaxed"], 1_900_000)
        path = f"/commerce/offers/{offer['id']}"
        self.assertEqual(self._ok("PATCH", path, {"object": "Assistance technique, deux jours (essai)"})["object"],
                         "Assistance technique, deux jours (essai)")
        self.assertEqual(self._ok("POST", f"{path}/send", {})["status"], "sent")
        status, body = self.call("PATCH", path, {"object": "Refusé"}, token=self.finance)
        self.assertEqual(status, 422, "Une offre envoyée se modifie par une nouvelle version")
        response = self._download(f"{path}/pdf")
        self.assertEqual(response.headers["Content-Type"], "application/pdf")
        self.assertIn(b"OFFRE", response.content)
        status, body = self.call("POST", f"{path}/send", {"email": True}, token=self.finance)
        self.assertEqual(status, 422, "Sans serveur de courrier (ou sans adresse), rien ne part : l'écran le dit")

        self.assertRefuseHors(SALES_READ, "GET", "/commerce/offers")
        self.assertRefuseHors(SALES_READ, "GET", path)
        self.assertRefuseHors(SALES_READ, "GET", f"{path}/pdf")
        self.assertRefuseHors(SALES_WRITE, "POST", "/commerce/offers", self._offer_payload())
        self.assertRefuseHors(SALES_WRITE, "PATCH", path, {"object": "Refusé"})
        self.assertRefuseHors(SALES_WRITE, "POST", f"{path}/refuse", {"reason": "Refusé"})
        self.assertRefuseHors(SALES_READ, "GET", "/commerce/sales/payment-terms")

        order = self._ok("POST", f"{path}/accept", {})
        self.assertEqual(order["status"], "accepted")
        invoiced = self._ok("POST", f"/commerce/orders/{offer['id']}/invoice",
                            {"method": "percentage", "value": 50, "label": "Avance de démarrage 50 %"})
        self.assertEqual(len(invoiced["created"]), 1)
        advance = self.env["account.move"].browse(invoiced["created"][0]["id"])
        self.assertEqual((advance.state, advance.ref), ("draft", offer["name"]))
        self.assertAlmostEqual(advance.amount_untaxed, 950_000)
        self.assertAlmostEqual(invoiced["invoicing"]["advances"], 950_000)
        self.assertRefuseHors(SALES_INVOICE, "POST", f"/commerce/orders/{offer['id']}/invoice", {"method": "total"})
        self.assertRefuseHors(SALES_WRITE, "PATCH", f"/commerce/orders/{offer['id']}/delivered",
                              {"lines": [{"id": priced[0]["id"], "qty_delivered": 1}]})
        self.assertRefuseHors(SALES_INVOICE, "POST", f"/commerce/orders/{offer['id']}/advance", {})
        status, body = self.call("POST", f"/commerce/orders/{offer['id']}/advance", {}, token=self.finance)
        self.assertEqual(status, 422, "Avance de démarrage : offres de travaux seulement")

        dg = self.open_session("dg.commerce")["access_token"]
        status, body = self.call("POST", "/commerce/offers", self._offer_payload(), token=dg)
        self.assertEqual(status, 200, "La direction établit des offres")
        status, body = self.call("POST", f"/commerce/orders/{offer['id']}/invoice", {"method": "total"}, token=dg)
        self.assertEqual(status, 403, "La facturation reste à la finance")

    def test_versions_refus_et_echeances(self):
        offer = self._ok("POST", "/commerce/offers", self._offer_payload())
        path = f"/commerce/offers/{offer['id']}"
        self._ok("POST", f"{path}/send", {})
        version = self._ok("POST", f"{path}/version", {})
        self.assertEqual((version["name"], version["version"], version["status"]), (f"{offer['name']}-V2", 2, "draft"))
        self.assertEqual(self._ok("GET", path)["status"], "replaced")
        status, body = self.call("POST", f"/commerce/offers/{version['id']}/refuse", {}, token=self.finance)
        self.assertEqual(status, 422, "Motif du refus obligatoire")
        refused = self._ok("POST", f"/commerce/offers/{version['id']}/refuse", {"reason": "Budget reporté"})
        self.assertEqual(refused["status"], "refused")
        other = self._ok("POST", "/commerce/offers", self._offer_payload())
        deadlines = self._ok("GET", "/commerce/deadlines")
        self.assertIn(("offer_expiry", other["id"]), [(i["kind"], i["res_id"]) for i in deadlines["items"]])
        listed = self._ok("GET", "/commerce/offers?view=closed")
        self.assertEqual({i["status"] for i in listed["items"]} - {"refused", "expired", "cancelled", "replaced"}, set())

    # ─── Achats ───────────────────────────────────────────────────────────

    def _po_payload(self, **values):
        return dict({
            "partner_id": self.supplier.id, "object": "Ciment du chantier (essai)",
            "lines": [{"name": "Ciment CPA (sacs)", "quantity": 10, "price_unit": 100_000,
                       "category_id": self.category.id}],
        }, **values)

    def test_bon_de_commande_approbation_reception_et_piece_par_les_routes(self):
        achats = self.open_session("achats.commerce")["access_token"]
        status, body = self.call("POST", "/commerce/purchase-orders",
                                 self._po_payload(lines=[{"name": "Ciment", "quantity": 1, "price_unit": 10,
                                                          "account_id": self.acc_purchase.id}]), token=achats)
        self.assertEqual(status, 403, "Le profil Achats ne choisit pas le compte")
        po = self._ok("POST", "/commerce/purchase-orders", self._po_payload(submit=True), token=achats)
        self.assertTrue(po["name"].startswith(f"BC/EG/{self.year}/"))
        self.assertEqual(po["status"], "to_approve")
        self.assertEqual(po["lines"][0]["account"]["id"], self.acc_purchase.id, "Compte de la catégorie de dépense")
        request_id = po["approval"]["request_id"]
        status, body = self.call("POST", f"/approvals/{request_id}/approve", {}, token=achats)
        self.assertEqual(status, 403, "Le profil Achats ne tranche aucune demande")
        self._ok("POST", f"/approvals/{request_id}/approve", {})
        path = f"/commerce/purchase-orders/{po['id']}"
        po = self._ok("GET", path, token=achats)
        self.assertEqual(po["status"], "approved")
        self.assertEqual(self._ok("POST", f"{path}/send", {}, token=achats)["status"], "sent")
        self.assertEqual(self._download(f"{path}/pdf", token=achats).headers["Content-Type"], "application/pdf")
        line_id = po["lines"][0]["id"]
        received = self._ok("POST", f"{path}/receipts", {"lines": [{"id": line_id, "quantity": 4}],
                                                         "note": "Livraison partielle (essai)"}, token=achats)
        self.assertEqual(received["status"], "partial")
        receipt_id = received["receipt"]["id"]
        status, body = self._upload(f"/commerce/receipts/{receipt_id}/attachment", "bl.pdf", PDF, token=achats)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["attachment"]["name"], "bl.pdf")
        self.assertEqual(self._download(f"/commerce/receipts/{receipt_id}/attachment", token=achats).content, PDF)
        status, body = self.call("POST", f"{path}/receipts", {"lines": [{"id": line_id, "quantity": 7}]}, token=achats)
        self.assertEqual(status, 422, "Réception au-delà de la commande refusée")

        billed = self._ok("POST", f"{path}/bill", {"ref": "FAC-ESSAI-01", "submit": True}, token=achats)
        bill = billed["bill"]
        self.assertTrue(bill["match"]["ok"], bill["match"])
        self.assertEqual(bill["state"], "posted", "Rapprochée de la commande et de la réception : validée sans circuit")
        match = self._ok("GET", f"/commerce/bills/{bill['id']}/match", token=achats)
        self.assertEqual(match["match"]["rows"][0]["received"], 4)

        self.assertRefuseHors(PURCHASE_ALL, "GET", "/commerce/purchase-orders")
        self.assertRefuseHors(PURCHASE_ALL, "GET", path)
        self.assertRefuseHors(PURCHASE_ALL, "POST", "/commerce/purchase-orders", self._po_payload())
        self.assertRefuseHors(PURCHASE_ALL, "PATCH", path, {"object": "Refusé"})
        self.assertRefuseHors(PURCHASE_ALL, "POST", f"{path}/cancel", {})
        self.assertRefuseHors(PURCHASE_ALL, "GET", f"{path}/pdf")
        self.assertRefuseHors(PURCHASE_ALL, "POST", f"{path}/receipts", {"lines": [{"id": line_id, "quantity": 1}]})
        self.assertRefuseHors(PURCHASE_ALL, "POST", f"/commerce/receipts/{receipt_id}/cancel", {"reason": "Refusé"})
        self.assertRefuseHors(PURCHASE_ALL, "POST", f"/commerce/receipts/{receipt_id}/attachment")
        self.assertRefuseHors(PURCHASE_ALL, "GET", f"/commerce/receipts/{receipt_id}/attachment")
        self.assertRefuseHors(PURCHASE_BILL, "POST", f"{path}/bill", {})
        self.assertRefuseHors(PURCHASE_FULL, "GET", f"/commerce/bills/{bill['id']}/match")
        self.env.invalidate_all()
        self.assertEqual(self.env["purchase.order"].browse(po["id"]).order_line.qty_received, 4, "Rien n'a changé")

    def test_les_metiers_ne_voient_que_leurs_demandes(self):
        btp = self.open_session("btp.commerce")["access_token"]
        btp2 = self.open_session("btp2.commerce")["access_token"]
        po = self._ok("POST", "/commerce/purchase-orders", self._po_payload(), token=btp)
        path = f"/commerce/purchase-orders/{po['id']}"
        self.assertIn(po["id"], [i["id"] for i in self._ok("GET", "/commerce/purchase-orders", token=btp)["items"]])
        self.assertNotIn(po["id"], [i["id"] for i in self._ok("GET", "/commerce/purchase-orders", token=btp2)["items"]])
        status, body = self.call("GET", path, token=btp2)
        self.assertEqual(status, 404, "Le bon d'un autre conducteur de travaux reste invisible")
        self.assertIn(po["id"], [i["id"] for i in self._ok("GET", "/commerce/purchase-orders")["items"]],
                      "La finance voit tous les bons de la société")
        status, body = self.call("POST", f"{path}/bill", {}, token=btp)
        self.assertEqual(status, 403, "La pièce d'achat reste à la finance et aux achats")
        commitment = self.env["eguitra.commitment"].create({
            "partner_id": self.supplier.id, "object": "Engagement d'un autre (essai)", "amount": 1_000_000,
            "account_id": self.acc_purchase.id, "company_id": self.groupe.id, "state": "approved",
        })
        status, body = self.call("POST", "/commerce/purchase-orders", {"commitment_id": commitment.id}, token=btp)
        self.assertEqual(status, 403, "Un métier ne commande que sur ses propres engagements")
        from_commitment = self._ok("POST", "/commerce/purchase-orders", {"commitment_id": commitment.id})
        self.assertEqual(from_commitment["commitment"]["id"], commitment.id)
        self.assertAlmostEqual(from_commitment["amount_untaxed"], 1_000_000, msg="Une ligne du reste à commander")
        self.assertEqual(from_commitment["lines"][0]["account"]["id"], self.acc_purchase.id)

    def test_devis_fournisseurs_d_un_engagement(self):
        commitment = self.env["eguitra.commitment"].create({
            "partner_id": self.supplier.id, "object": "Matériel informatique (essai)", "amount": 9_000_000,
            "account_id": self.acc_purchase.id, "company_id": self.groupe.id,
        })
        path = f"/commerce/commitments/{commitment.id}"
        other = self.env["res.partner"].create({"name": "Fournisseur informatique (essai)"})
        data = self._ok("POST", f"{path}/quotes", {"partner_id": self.supplier.id, "amount": 9_000_000})
        data = self._ok("POST", f"{path}/quotes", {"partner_id": other.id, "amount": 8_500_000, "delay_days": 10})
        self.assertEqual(len(data["quotes"]), 2)
        quote_id = next(q["id"] for q in data["quotes"] if q["partner"]["id"] == other.id)
        status, body = self._upload(f"/commerce/supplier-quotes/{quote_id}/file", "devis.pdf", b"%PDF-1.4 devis")
        self.assertEqual(status, 200, body)
        status, body = self.call("POST", f"/commerce/supplier-quotes/{quote_id}/select", {"reason": ""}, token=self.finance)
        self.assertEqual(status, 422, "Choix motivé")
        data = self._ok("POST", f"/commerce/supplier-quotes/{quote_id}/select", {"reason": "Moins cher, délai tenu"})
        self.assertEqual((data["commitment"]["partner"]["id"], data["commitment"]["amount"]), (other.id, 8_500_000))
        self.assertRefuseHors(QUOTES, "GET", f"{path}/purchasing")
        self.assertRefuseHors(QUOTES, "POST", f"{path}/quotes", {"partner_id": other.id, "amount": 1})
        self.assertRefuseHors(QUOTES, "POST", f"/commerce/supplier-quotes/{quote_id}/select", {"reason": "Refusé"})
        self.assertRefuseHors(QUOTES, "DELETE", f"/commerce/supplier-quotes/{quote_id}")

    # ─── Catalogue, réglages, tableaux de bord ────────────────────────────

    def test_catalogue_et_import(self):
        item = self._ok("POST", "/commerce/catalogue", {
            "name": "Forfait de mobilisation (essai)", "kind": "service", "uom": "fft", "list_price": 2_500_000,
            "income_account_id": self.acc_services.id, "sale_tax_ids": [self.tax_sale.id], "sale_ok": True,
            "purchase_ok": False,
        })
        self.assertEqual((item["uom"]["name"], item["kind"], item["income_account"]["id"]), ("fft", "service",
                                                                                           self.acc_services.id))
        self.assertIn(item["id"], [i["id"] for i in self._ok("GET", "/commerce/catalogue?usage=sale")])
        rows = [["Nom", "Type (prestation ou article)", "Unité", "Prix de vente HT", "Compte de produit", "TVA de vente (%)"],
                ["Location de groupe électrogène, par jour (essai)", "prestation", "ml", "750000", "706100", "18"],
                ["Ciment en sacs (essai)", "article", "ens.", "95000", "", "18"]]
        buffer = io.StringIO()
        csv.writer(buffer, delimiter=";").writerows(rows)
        status, body = self._upload("/commerce/catalogue/import", "catalogue.csv", buffer.getvalue().encode("utf-8"))
        self.assertEqual((status, body.get("created"), body.get("updated")), (200, 2, 0), body)
        status, body = self._upload("/commerce/catalogue/import", "catalogue.csv", buffer.getvalue().encode("utf-8"))
        self.assertEqual((status, body.get("created"), body.get("updated")), (200, 0, 2), "Mêmes noms : mis à jour")
        bad = "Nom;Unité\nArticle à l'unité inconnue (essai);unité-qui-n-existe-pas\n".encode()
        status, body = self._upload("/commerce/catalogue/import", "mauvais.csv", bad)
        self.assertEqual(status, 422, body)
        self.assertIn("Ligne 2", body["message"])
        self.assertRefuseHors(CATALOGUE_READ, "GET", "/commerce/catalogue")
        self.assertRefuseHors(CATALOGUE_READ, "GET", "/commerce/referentials")
        self.assertRefuseHors(CATALOGUE_WRITE, "POST", "/commerce/catalogue", {"name": "Refusé"})
        self.assertRefuseHors(CATALOGUE_WRITE, "PATCH", f"/commerce/catalogue/{item['id']}", {"name": "Refusé"})
        self.assertRefuseHors(CATALOGUE_WRITE, "POST", "/commerce/catalogue/import")
        self.assertRefuseHors(CATALOGUE_WRITE, "GET", "/commerce/catalogue/import-template")

    def test_reglages_et_numerotation(self):
        settings = self._ok("GET", "/commerce/settings")
        self.assertEqual(settings["validity_days"], 15)
        updated = self._ok("PATCH", "/commerce/settings", {
            "validity_days": 10, "match_mode": "block", "three_quotes_threshold": 5_000_000,
            "numbering": {"sale.order": {"prefix": "OFR/EG/%(year)s/", "next_number": 500}},
        })
        offer_numbering = next(n for n in updated["numbering"] if n["code"] == "sale.order")
        self.assertEqual(offer_numbering["next"], f"OFR/EG/{self.year}/0500")
        self.assertEqual((updated["validity_days"], updated["match_mode"]), (10, "block"))
        offer = self._ok("POST", "/commerce/offers", self._offer_payload())
        self.assertEqual((offer["name"], offer["validity_days"]), (f"OFR/EG/{self.year}/0500", 10))
        status, body = self.call("PATCH", "/commerce/settings",
                                 {"numbering": {"sale.order": {"next_number": 500}}}, token=self.finance)
        self.assertEqual(status, 422, "Un numéro déjà attribué ne se redonne pas")
        status, body = self.call("PATCH", "/commerce/settings", {"validity_days": 0}, token=self.finance)
        self.assertEqual(status, 422)
        self.assertRefuseHors(SETTINGS, "GET", "/commerce/settings")
        self.assertRefuseHors(SETTINGS, "PATCH", "/commerce/settings", {"validity_days": 30})
        self.env.invalidate_all()
        self.assertEqual(self.groupe.quotation_validity_days, 10, "Rien n'a changé après les refus")

    def test_tableaux_de_bord_et_exports(self):
        self._ok("POST", "/commerce/offers", self._offer_payload())
        sales = self._ok("GET", "/commerce/sales/dashboard")
        self.assertGreaterEqual(sales["kpis"]["open_count"], 1)
        self.assertTrue(self._download("/commerce/sales/dashboard?format=xlsx").content.startswith(b"PK"))
        text = self._download("/commerce/sales/dashboard?format=csv&sheet=1").content.decode("utf-8-sig")
        self.assertIn("Offre;Client", text)
        purchases = self._ok("GET", "/commerce/purchases/dashboard")
        self.assertIn("to_receive_count", purchases["kpis"])
        self.assertTrue(self._download("/commerce/purchases/dashboard?format=xlsx").content.startswith(b"PK"))
        self.assertRefuseHors(SALES_READ, "GET", "/commerce/sales/dashboard")
        self.assertRefuseHors(PURCHASE_DASH, "GET", "/commerce/purchases/dashboard")
        self.assertRefuseHors(SALES_READ + ("achats", "exploitation", "chantiers", "immobilier"), "GET",
                              "/commerce/deadlines")

    def test_separation_des_deux_societes(self):
        cabinet = {"X-Eguitra-Company": str(self.cabinet.id)}
        partner = self.env["res.partner"].create({"name": "Porteur accompagné (essai)"})
        offer = self._ok("POST", "/commerce/offers", {
            "partner_id": partner.id, "object": "Accompagnement (essai)",
            "lines": [{"name": "Honoraires d'accompagnement", "quantity": 3, "price_unit": 1_500_000, "tax_ids": []}],
        }, headers=cabinet)
        self.assertTrue(offer["name"].startswith(f"OF/MBAX/{self.year}/"))
        status, body = self.call("GET", f"/commerce/offers/{offer['id']}", token=self.finance)
        self.assertEqual(status, 404, "L'offre de MB AxisPro Consulting n'apparaît pas dans les livres d'EGUITRA GROUP")
        self.assertNotIn(offer["id"], [i["id"] for i in self._ok("GET", "/commerce/offers")["items"]])
        status, body = self.call("POST", "/commerce/offers", self._offer_payload(), token=self.finance, headers=cabinet)
        self.assertEqual(status, 422, "Un article du catalogue d'EGUITRA GROUP ne sert pas à MB AxisPro Consulting")
        status, body = self.call("POST", "/commerce/offers", self._offer_payload(chantier_mode=True, lines=[
            {"name": "Mission", "quantity": 1, "price_unit": 1}]), token=self.finance, headers=cabinet)
        self.assertEqual(status, 422, "Pas d'offre de travaux dans les livres du cabinet")
        status, body = self.call("PATCH", "/commerce/settings", {"validity_days": 20}, token=self.finance, headers=cabinet)
        self.assertEqual(status, 200, body)
        self.env.invalidate_all()
        self.assertEqual((self.cabinet.quotation_validity_days, self.groupe.quotation_validity_days), (20, 15),
                         "Réglages propres à chaque société")
