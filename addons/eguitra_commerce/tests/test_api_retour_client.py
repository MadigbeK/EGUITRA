"""Routes du retour du client du 2 novembre 2026 sur les bons de commande : fournisseur créé depuis le bon et
doublon probable, circuit prévu, devis ou proforma et conditions saisis, pièces jointes (dépôt contrôlé au
contenu, recherche, retrait avant soumission, archive ensuite), historique, signature des approbateurs ;
refus par profil de chaque nouvelle route, bons des métiers cloisonnés. Données fictives."""

import io

from PIL import Image

from odoo import fields
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_api.tests.profils import RefusParProfil
from odoo.addons.eguitra_finance.controllers.common import ACHATS, FIN_WRITE
from odoo.addons.eguitra_finance.controllers.partners import PICKERS

from ..controllers.common import PURCHASE_ALL, SIGNATURE, SIGNATURE_ADMIN
from .common import CommerceDataMixin

PDF = b"%PDF-1.4 facture proforma du fournisseur (essai)"


def png():
    buffer = io.BytesIO()
    Image.new("RGB", (300, 100), "white").save(buffer, "PNG")
    return buffer.getvalue()


@tagged("post_install", "-at_install")
class TestApiRetourClient(RefusParProfil, CommerceDataMixin, ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_commerce()
        cls.fin_user = cls._create_user("fin.retour", "finance")
        cls._create_user("fin2.retour", "finance")
        cls._create_user("achats.retour", "achats")
        cls._create_user("admin.retour", "admin")
        cls._create_user("btp.retour", "chantiers")
        cls._create_user("btp2.retour", "chantiers")
        cls.category = cls.env["eguitra.expense.category"].create({
            "name": "Fournitures (essai)", "nature": "opex_metier", "account_id": cls.acc_purchase.id,
            "company_id": cls.groupe.id,
        })

    def setUp(self):
        super().setUp()
        self.finance = self.open_session("fin.retour")["access_token"]
        self.achats = self.open_session("achats.retour")["access_token"]

    def _ok(self, method, path, payload=None, token=None):
        status, body = self.call(method, path, payload, token=token or self.finance)
        self.assertEqual(status, 200, body)
        return body

    def _upload(self, path, name, content, token=None, data=None):
        response = self.url_open(f"/api/v1{path}", data=data or {}, files={"file": (name, io.BytesIO(content))},
                                 headers={"Authorization": f"Bearer {token or self.finance}", "X-Eguitra-App": "test"},
                                 timeout=60)
        try:
            return response.status_code, response.json()
        except ValueError:
            return response.status_code, response.text

    def _download(self, path, token=None):
        return self.url_open(f"/api/v1{path}", headers={"Authorization": f"Bearer {token or self.finance}",
                                                         "X-Eguitra-App": "test"}, timeout=60)

    def _po_payload(self, **values):
        return dict({
            "partner_id": self.supplier.id, "object": "Matériel électrique (essai)",
            "lines": [{"name": "Disjoncteurs (essai)", "quantity": 10, "price_unit": 100_000, "category_id": self.category.id}],
        }, **values)

    # ─── Fournisseur créé depuis le bon ───────────────────────────────────

    def test_fournisseur_cree_depuis_le_bon_et_doublon(self):
        created = self._ok("POST", "/finance/partners", {
            "name": "Quincaillerie Démo (essai)", "vat": "778899123", "rccm": "GN.CKY.2026.B.00001",
            "phone": "620000010", "city": "Conakry", "supplier": True, "check_duplicates": True,
        }, token=self.achats)
        partner = self.env["res.partner"].browse(created["id"])
        self.assertEqual((partner.supplier_rank, partner.company_registry), (1, "GN.CKY.2026.B.00001"))
        status, body = self.call("POST", "/finance/partners", {
            "name": "QUINCAILLERIE DEMO (ESSAI) SARL", "supplier": True, "check_duplicates": True}, token=self.achats)
        self.assertEqual(status, 409, "Même nom, autre graphie et forme juridique : doublon probable")
        self.assertEqual([p["id"] for p in body["duplicates"]], [partner.id])
        status, body = self.call("POST", "/finance/partners", {
            "name": "Autre enseigne (essai)", "vat": "778 899 123", "supplier": True, "check_duplicates": True},
            token=self.achats)
        self.assertEqual(status, 409, "Même NIF")
        forced = self._ok("POST", "/finance/partners", {
            "name": "Autre enseigne (essai)", "vat": "778899123", "supplier": True, "check_duplicates": True,
            "force": True}, token=self.achats)
        self.assertNotEqual(forced["id"], partner.id, "Confirmée, la création se fait")
        po = self._ok("POST", "/commerce/purchase-orders", self._po_payload(partner_id=partner.id), token=self.achats)
        self.assertEqual(po["partner"]["id"], partner.id, "Choisi aussitôt dans le bon de commande")
        self.assertRefuseHors(FIN_WRITE + PICKERS + ACHATS, "POST", "/finance/partners",
                              {"name": "Refusé (essai)", "check_duplicates": True})

    # ─── Circuit prévu, devis, conditions, pièces jointes, historique ─────

    def test_circuit_prevu(self):
        big = self._ok("GET", "/commerce/purchase-orders/circuit?amount=10000001")
        self.assertEqual((big["document"], big["steps"]), ("purchase_order", 2))
        self.assertEqual([(r["profile"], r["min_amount"], r["max_amount"]) for r in big["rules"] if r["applies"]],
                         [("finance", 0, None), ("direction", 10_000_000, None)], "Contrôle, puis direction (plus de 10 M)")
        edge = self._ok("GET", "/commerce/purchase-orders/circuit?amount=10000000", token=self.achats)
        self.assertEqual([(r["profile"], r["min_amount"], r["max_amount"]) for r in edge["rules"] if r["applies"]],
                         [("finance", 0, None), ("direction", 0, 10_000_000)], "Exactement 10 M : règle « jusqu'à 10 M »")
        self.assertEqual(len(edge["rules"]), 3, "Les trois règles sont montrées, avec celles qui s'appliquent")
        small = self._ok("GET", "/commerce/purchase-orders/circuit?amount=5000000", token=self.achats)
        self.assertEqual(small["steps"], 2)
        commitment = self.env["eguitra.commitment"].create({
            "partner_id": self.supplier.id, "object": "Engagement approuvé (essai)", "amount": 6_000_000,
            "account_id": self.acc_purchase.id, "company_id": self.groupe.id, "state": "approved",
        })
        covered = self._ok("GET", f"/commerce/purchase-orders/circuit?amount=5000000&commitment_id={commitment.id}")
        self.assertTrue(covered["covered"], "Dans la limite de l'engagement approuvé : approuvé d'office")
        self.assertRefuseHors(PURCHASE_ALL, "GET", "/commerce/purchase-orders/circuit?amount=1")

    def test_devis_conditions_pieces_et_historique_par_les_routes(self):
        term = self.env["account.payment.term"].search([("company_id", "in", [False, self.groupe.id])], limit=1)
        refs = self._ok("GET", "/commerce/referentials", token=self.achats)
        self.assertIn(term.id, [t["id"] for t in refs["payment_terms"]])
        self.assertTrue(refs["delivery_place"])
        po = self._ok("POST", "/commerce/purchase-orders", self._po_payload(
            quote_kind="proforma", partner_ref="PRO-ESSAI-7", quote_date=str(fields.Date.today()),
            payment_term_id=term.id, payment_note="50 % à la commande (essai)", delivery_days=10,
            delivery_place="Chantier de démonstration (essai)", tax_exemption="Mention d'exonération (essai)",
        ), token=self.achats)
        self.assertEqual((po["quote_kind"], po["partner_ref"], po["payment_term"]["id"], po["delivery_days"],
                          po["delivery_place"]), ("proforma", "PRO-ESSAI-7", term.id, 10, "Chantier de démonstration (essai)"))
        self.assertEqual(po["circuit"]["steps"], 2, "Circuit prévu affiché avant la soumission")
        status, body = self.call("POST", "/commerce/purchase-orders", self._po_payload(quote_kind="facture"),
                                 token=self.achats)
        self.assertEqual(status, 400)
        path = f"/commerce/purchase-orders/{po['id']}"

        status, document = self._upload(f"{path}/documents", "proforma.pdf", PDF, token=self.achats,
                                        data={"category": "proforma"})
        self.assertEqual(status, 200, document)
        self.assertEqual((document["category"], document["removable"]), ("proforma", True))
        status, body = self._upload(f"{path}/documents", "programme.exe", b"MZ\x90\x00 executable", token=self.achats)
        self.assertEqual(status, 415, "Format lu dans le contenu")
        self.assertEqual(self._download(f"/commerce/purchase-documents/{document['id']}", token=self.achats).content, PDF)
        listed = self._ok("GET", "/commerce/purchase-orders?quote_ref=PRO-ESSAI", token=self.achats)
        self.assertIn(po["id"], [o["id"] for o in listed["items"]], "Filtre par référence du devis")
        found = self._ok("GET", "/commerce/purchase-documents?search=PRO-ESSAI-7", token=self.achats)
        self.assertIn(document["id"], [d["id"] for d in found["items"]], "Pièce retrouvée par la référence du bon")
        self._ok("DELETE", f"/commerce/purchase-documents/{document['id']}", token=self.achats)
        status, document = self._upload(f"{path}/documents", "proforma.pdf", PDF, token=self.achats,
                                        data={"category": "proforma"})
        self.assertEqual(status, 200, document)
        self._ok("POST", f"{path}/submit", {}, token=self.achats)
        status, body = self.call("DELETE", f"/commerce/purchase-documents/{document['id']}", token=self.achats)
        self.assertEqual(status, 422, "Bon soumis : la pièce est archivée")
        self.assertEqual(self._ok("GET", path, token=self.achats)["documents"][0]["removable"], False)

        history = self._ok("GET", f"{path}/history", token=self.achats)["items"]
        kinds = [event["kind"] for event in history]
        for kind in ("created", "document_added", "document_removed", "submitted"):
            self.assertIn(kind, kinds)
        pdf = self._download(f"{path}/pdf", token=self.achats)
        self.assertEqual(pdf.headers["Content-Type"], "application/pdf")

        self.assertRefuseHors(PURCHASE_ALL, "GET", f"{path}/history")
        self.assertRefuseHors(PURCHASE_ALL, "GET", f"{path}/documents")
        self.assertRefuseHors(PURCHASE_ALL, "POST", f"{path}/documents")
        self.assertRefuseHors(PURCHASE_ALL, "GET", "/commerce/purchase-documents")
        self.assertRefuseHors(PURCHASE_ALL, "GET", f"/commerce/purchase-documents/{document['id']}")
        self.assertRefuseHors(PURCHASE_ALL, "DELETE", f"/commerce/purchase-documents/{document['id']}")
        self.env.invalidate_all()
        self.assertTrue(self.env["eguitra.commerce.purchase.document"].browse(document["id"]).exists(), "Rien n'a changé")

    def test_pieces_des_metiers_cloisonnees(self):
        btp = self.open_session("btp.retour")["access_token"]
        btp2 = self.open_session("btp2.retour")["access_token"]
        po = self._ok("POST", "/commerce/purchase-orders", self._po_payload(), token=btp)
        status, document = self._upload(f"/commerce/purchase-orders/{po['id']}/documents", "devis.pdf", PDF, token=btp,
                                        data={"category": "quote"})
        self.assertEqual(status, 200, document)
        self.assertEqual(self._download(f"/commerce/purchase-documents/{document['id']}", token=btp2).status_code, 404,
                         "La pièce du bon d'un autre conducteur reste invisible")
        self.assertNotIn(document["id"], [d["id"] for d in self._ok("GET", "/commerce/purchase-documents", token=btp2)["items"]])
        status, body = self.call("GET", f"/commerce/purchase-orders/{po['id']}/history", token=btp2)
        self.assertEqual(status, 404)
        self.assertIn(document["id"], [d["id"] for d in self._ok("GET", "/commerce/purchase-documents")["items"]],
                      "La finance retrouve les pièces de tous les bons de la société")

    # ─── Signature des approbateurs ───────────────────────────────────────

    def test_signature_des_approbateurs(self):
        status, body = self._upload("/commerce/signature", "signature.png", png())
        self.assertEqual(status, 200, body)
        self.assertTrue(body["has_signature"])
        image = self._download("/commerce/signature/image")
        self.assertEqual(image.headers["Content-Type"], "image/png")
        status, body = self._upload("/commerce/signature", "signature.pdf", PDF)
        self.assertEqual(status, 422, "Une signature est une image PNG ou JPEG")
        self.assertFalse(self._ok("DELETE", "/commerce/signature")["has_signature"])

        admin = self.open_session("admin.retour")["access_token"]
        listed = self._ok("GET", "/commerce/signatures", token=admin)
        self.assertIn(self.fin_user.id, [s["user"]["id"] for s in listed])
        status, body = self._upload(f"/commerce/signatures/{self.fin_user.id}", "signature.png", png(), token=admin)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["updated_by"]["name"], "Admin.Retour")
        buyer = self.env["res.users"].search([("login", "=", "achats.retour")])
        status, body = self._upload(f"/commerce/signatures/{buyer.id}", "signature.png", png(), token=admin)
        self.assertEqual(status, 404, "Le profil Achats n'approuve rien : pas de signature d'approbateur")

        self.assertRefuseHors(SIGNATURE, "GET", "/commerce/signature")
        self.assertRefuseHors(SIGNATURE, "POST", "/commerce/signature")
        self.assertRefuseHors(SIGNATURE, "DELETE", "/commerce/signature")
        self.assertRefuseHors(SIGNATURE_ADMIN, "GET", "/commerce/signatures")
        self.assertRefuseHors(SIGNATURE_ADMIN, "POST", f"/commerce/signatures/{self.fin_user.id}")
        self.assertRefuseHors(SIGNATURE_ADMIN, "DELETE", f"/commerce/signatures/{self.fin_user.id}")
        self.env.invalidate_all()
        self.assertTrue(self.fin_user.eguitra_signature, "Rien n'a changé après les refus")
