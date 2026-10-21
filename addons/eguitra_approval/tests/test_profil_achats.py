import io

from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import PASSWORD, ApiCase
from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin

PDF = b"%PDF-1.4 facture du fournisseur"


@tagged("post_install", "-at_install")
class TestProfilAchats(FinanceDataMixin, ApiCase):
    """Profil Achats (responsable des achats et des contrats) : engagements de dépense avec devis, pièces
    d'achat et avoirs fournisseurs saisis par catégorie de dépense avec leurs justificatifs, soumission au
    circuit d'approbation, fiches des fournisseurs ; ni ventes, ni trésorerie, ni états, ni analyse, ni choix
    du compte."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.acheteuse = cls._create_user("achats.test", "achats")

        def account(prefix):
            return cls.env["account.account"].search(
                [("code", "=like", prefix + "%"), ("company_ids", "in", cls.company.ids)], limit=1, order="code")

        Category = cls.env["eguitra.expense.category"]
        cls.category = Category.create({
            "name": "Fournitures de bureau (achats)", "nature": "frais_generaux", "account_id": cls.acc_purchase.id,
            "company_id": cls.company.id,
        })
        cls.salaries = Category.create({
            "name": "Salaires (achats)", "nature": "personnel", "account_id": account("6611").id,
            "partner_account_id": account("422").id, "tax_mode": "none", "company_id": cls.company.id,
        })
        cls.sale = cls.make_invoice("out_invoice", amount=10_000_000)

    def setUp(self):
        super().setUp()
        self.token = self.open_session("achats.test")["access_token"]

    def _get(self, path):
        return self.call("GET", path, token=self.token)

    def _upload(self, path, content=PDF, name="facture.pdf"):
        response = self.url_open("/api/v1" + path, files={"file": (name, io.BytesIO(content), "application/pdf")},
                                 headers={"Authorization": f"Bearer {self.token}"}, method="POST", timeout=60)
        return response.status_code, response.json()

    def _purchase(self, lines, **extra):
        return self.call("POST", "/finance/moves", dict({
            "move_type": "in_invoice", "partner_id": self.supplier.id, "ref": "FAC-2026-118", "lines": lines,
        }, **extra), token=self.token)

    def test_profil_et_applications(self):
        self.assertEqual(self.acheteuse._eguitra_profiles(), ["achats"])
        self.assertEqual(self.acheteuse._eguitra_apps(), ["finance"], "Finance seule : ni Analyse, ni AxisPro, ni Rotations")
        self.assertTrue(self.acheteuse.has_group("account.group_account_invoice"), "Facturation : pièces en brouillon")
        self.assertFalse(self.acheteuse.has_group("eguitra_finance.group_free_accounts"), "Ni saisie libre des comptes")
        status, me = self._get("/auth/me")
        self.assertEqual(status, 200, me)
        self.assertEqual((me["profiles"], me["apps"]), (["achats"], ["finance"]))
        self.assertEqual(me["rights"], {"free_accounts": False}, "Pas de saisie libre des comptes")
        status, body = self.call("POST", "/auth/login", {"login": "achats.test", "password": PASSWORD, "app": "analyse"})
        self.assertEqual((status, body.get("error")), (403, "app_forbidden"), body)

    def test_piece_d_achat_par_categorie_soumise_au_circuit(self):
        status, categories = self._get("/finance/expense-categories")
        self.assertEqual(status, 200, categories)
        ids = [c["id"] for c in categories]
        self.assertIn(self.category.id, ids)
        self.assertNotIn(self.salaries.id, ids, "Salaires, cotisations, impôts : opérations diverses de la finance")
        status, taxes = self._get("/finance/taxes?use=purchase")
        self.assertEqual(status, 200, taxes)
        self.assertTrue(taxes and all(t["use"] == "purchase" for t in taxes))
        self.assertEqual(self._get("/finance/taxes?use=sale")[0], 403)
        status, journals = self._get("/finance/journals")
        self.assertEqual(status, 200, journals)
        self.assertTrue(journals and all(j["type"] == "purchase" for j in journals), "Journaux d'achat seuls")
        self.assertEqual(self._get("/finance/journals?type=bank,cash")[0], 403)
        self.assertEqual(self._get("/finance/currencies")[0], 200)
        self.assertEqual(self._get("/finance/analytic-axes")[0], 200)

        status, body = self._purchase([{"name": "Ramettes de papier", "price_unit": 2_000_000}])
        self.assertEqual(status, 422, "Sans catégorie, la ligne n'a pas de compte")
        status, body = self._purchase([{"name": "Ramettes de papier", "price_unit": 2_000_000,
                                        "category_id": self.category.id, "account_id": self.acc_interest.id}])
        self.assertEqual(status, 403, "Le profil Achats ne choisit pas le compte")
        status, body = self._purchase([{"name": "Ramettes de papier", "price_unit": 2_000_000,
                                        "category_id": self.category.id, "tax_ids": self.tax_sale.ids}])
        self.assertEqual(status, 422, "Taxe de vente refusée sur une pièce d'achat")
        status, body = self._purchase([{"name": "Salaires d'octobre", "price_unit": 2_000_000,
                                        "category_id": self.salaries.id}])
        self.assertEqual(status, 403, "Opération diverse hors du profil")
        status, body = self._purchase([{"name": "Ramettes de papier", "price_unit": 2_000_000,
                                        "category_id": self.category.id}], dispute=True, dispute_reason="Prix")
        self.assertEqual(status, 403, "Le litige relève de la finance")

        status, move = self._purchase([{"name": "Ramettes de papier", "quantity": 4, "price_unit": 500_000,
                                        "category_id": self.category.id}])
        self.assertEqual(status, 200, move)
        self.assertEqual((move["move_type"], move["state"]), ("in_invoice", "draft"))
        line = move["lines"][0]
        self.assertEqual(line["account"]["id"], self.acc_purchase.id, "Le compte vient de la catégorie")
        self.assertEqual(line["category"]["id"], self.category.id)

        status, attachment = self._upload(f"/finance/moves/{move['id']}/attachments")
        self.assertEqual(status, 200, attachment)
        self.assertEqual(attachment["mimetype"], "application/pdf")
        status, detail = self._get(f"/finance/moves/{move['id']}")
        self.assertEqual(status, 200, detail)
        self.assertEqual([a["id"] for a in detail["attachments"]], [attachment["id"]])
        self.assertEqual((detail["amount_residual"], detail["payments"]), (None, None), "Ni reste dû ni règlements")
        response = self.url_open(f"/api/v1/finance/attachments/{attachment['id']}",
                                 headers={"Authorization": f"Bearer {self.token}"}, timeout=60)
        self.assertEqual(response.status_code, 200, "Justificatif téléchargé")

        status, move = self.call("PATCH", f"/finance/moves/{move['id']}", {
            "ref": "FAC-2026-118 bis",
            "lines": [{"name": "Ramettes de papier", "quantity": 5, "price_unit": 500_000, "category_id": self.category.id}],
        }, token=self.token)
        self.assertEqual(status, 200, move)
        self.assertEqual(move["amount_untaxed"], 2_500_000)

        status, move = self.call("POST", f"/finance/moves/{move['id']}/post", token=self.token)
        self.assertEqual(status, 200, move)
        self.assertEqual(move["state"], "draft", "Soumise : comptabilisée à la dernière approbation")
        self.assertEqual((move["approval"]["state"], move["approval"]["pending_with"]), ("pending", "Finance et comptabilité"))
        request_id = move["approval"]["request_id"]

        status, mine = self._get("/approvals/requests?mine=1")
        self.assertEqual(status, 200, mine)
        self.assertIn(request_id, [r["id"] for r in mine], "Elle suit ses demandes")
        status, inbox = self._get("/approvals/inbox")
        self.assertEqual((status, inbox), (200, []), "Elle n'en tranche aucune")
        status, request = self._get(f"/approvals/{request_id}")
        self.assertEqual((status, request["state"]), (200, "pending"), request)
        status, _b = self.call("POST", f"/approvals/{request_id}/approve", {}, token=self.token)
        self.assertEqual(status, 403)

        status, listing = self._get("/finance/moves")
        self.assertEqual(status, 200, listing)
        self.assertIn(move["id"], [m["id"] for m in listing["items"]])
        self.assertTrue(all(m["move_type"] in ("in_invoice", "in_refund") for m in listing["items"]),
                        "Liste bornée d'office aux pièces d'achat")
        self.assertIsNone(listing["totals"]["amount_residual"], "Pas d'encours fournisseurs")
        response = self.url_open(f"/api/v1/finance/moves/{move['id']}/pdf",
                                 headers={"Authorization": f"Bearer {self.token}"}, timeout=60)
        self.assertEqual(response.status_code, 200, "PDF de sa pièce d'achat")
        for method, path in (("POST", "payments"), ("POST", "cancel"), ("POST", "reset"), ("POST", "reverse")):
            status, _b = self.call(method, f"/finance/moves/{move['id']}/{path}", {"journal_id": self.bank.id},
                                   token=self.token)
            self.assertEqual(status, 403, path)

        status, refund = self.call("POST", "/finance/moves", {
            "move_type": "in_refund", "partner_id": self.supplier.id,
            "lines": [{"name": "Retour de ramettes", "price_unit": 500_000, "category_id": self.category.id}],
        }, token=self.token)
        self.assertEqual(status, 200, refund)
        status, _b = self.call("DELETE", f"/finance/moves/{refund['id']}", token=self.token)
        self.assertEqual(status, 200, "Brouillon supprimé")

    def test_fournisseurs(self):
        status, created = self.call("POST", "/finance/partners", {
            "name": "Quincaillerie de Matoto", "customer": True, "phone": "620000001", "credit_limit": 1_000_000,
            "supplier_payment_term": {"days": 30},
        }, token=self.token)
        self.assertEqual(status, 200, created)
        partner = self.env["res.partner"].browse(created["id"])
        self.assertEqual((partner.supplier_rank, partner.customer_rank), (1, 0), "Fiche d'un fournisseur")
        self.assertFalse(partner.use_partner_credit_limit, "Limite de crédit : finance seule")
        self.assertNotEqual(partner.property_supplier_payment_term_id.name, "30 jours", "Conditions de paiement : finance seule")
        self.assertEqual(partner.create_uid, self.acheteuse, "L'auteur de la fiche reste l'utilisatrice")
        self.assertIsNone(created["payable"])

        status, updated = self.call("PATCH", f"/finance/partners/{partner.id}", {
            "phone": "620000002", "rccm": "GN.TCC.2026.B.01234", "credit_limit": 5_000_000,
        }, token=self.token)
        self.assertEqual(status, 200, updated)
        partner.invalidate_recordset()  # modifiée par la requête : relue en base
        self.assertEqual((partner.phone, partner.company_registry), ("620000002", "GN.TCC.2026.B.01234"))
        self.assertFalse(partner.use_partner_credit_limit)
        status, _b = self.call("PATCH", f"/finance/partners/{self.customer.id}", {"phone": "620000003"}, token=self.token)
        self.assertEqual(status, 403, "Fiche d'un client : finance seule")

        status, listing = self._get("/finance/partners?kind=supplier&limit=50")
        self.assertEqual(status, 200, listing)
        self.assertTrue(listing["items"])
        self.assertTrue(all(p["payable"] is None and p["receivable"] is None for p in listing["items"]), "Sans soldes")
        self.make_invoice("in_invoice", amount=3_000_000)
        status, fiche = self._get(f"/finance/partners/{self.supplier.id}")
        self.assertEqual(status, 200, fiche)
        self.assertIsNone(fiche["payable"])
        self.assertEqual((fiche["aging"], fiche["open_items"]), (None, []), "Ni ancienneté ni encours")
        self.assertIsNone(fiche["payment_term"])
        self.assertTrue(fiche["recent_moves"])
        self.assertTrue(all(m["move_type"] in ("in_invoice", "in_refund") for m in fiche["recent_moves"]))
        status, fiche = self._get(f"/finance/partners/{self.customer.id}")
        self.assertEqual(status, 200, fiche)
        self.assertEqual(fiche["recent_moves"], [], "Aucune facture de vente du tiers")

    def test_engagement_de_depense(self):
        status, body = self.call("POST", "/finance/commitments", {
            "partner_id": self.supplier.id, "object": "Contrat de nettoyage des bureaux", "amount": 12_000_000,
            "account_id": self.acc_interest.id,
        }, token=self.token)
        self.assertEqual(status, 403, "Compte choisi hors catégorie : refusé")
        status, body = self.call("POST", "/finance/commitments", {
            "partner_id": self.supplier.id, "object": "Contrat de nettoyage des bureaux", "amount": 12_000_000,
            "category_id": self.category.id,
        }, token=self.token)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["account"]["id"], self.acc_purchase.id, "Le compte vient de la catégorie")
        status, quoted = self._upload(f"/finance/commitments/{body['id']}/quote", name="devis.pdf")
        self.assertEqual(status, 200, quoted)
        self.assertEqual(quoted["quote"]["name"], "devis.pdf")
        status, submitted = self.call("POST", f"/finance/commitments/{body['id']}/submit", token=self.token)
        self.assertEqual(status, 200, submitted)
        self.assertEqual((submitted["state"], submitted["approval"]["pending_with"]), ("submitted", "Finance et comptabilité"))
        status, rows = self._get("/finance/commitments")
        self.assertEqual(status, 200, rows)
        self.assertIn(body["id"], [r["id"] for r in rows])
        status, mine = self._get("/approvals/requests?mine=1")
        self.assertIn(("eguitra.commitment", body["id"]), [(r["res_model"], r["res_id"]) for r in mine])
        status, _b = self.call("POST", f"/finance/commitments/{body['id']}/close", token=self.token)
        self.assertEqual(status, 403, "Seules la finance et la direction soldent")
        status, bills = self._get(f"/finance/commitments/for-bill?partner_id={self.supplier.id}")
        self.assertEqual(status, 200, bills)

    def test_hors_du_profil(self):
        """Ventes, trésorerie, états, pilotage, clôtures, fiscalité, analyse : 403."""
        status, body = self.call("POST", "/finance/moves", {
            "move_type": "out_invoice", "partner_id": self.customer.id,
            "lines": [{"name": "Transport Conakry - Siguiri", "price_unit": 1_000_000}],
        }, token=self.token)
        self.assertEqual(status, 403, body)
        status, body = self.call("POST", "/finance/moves", {
            "move_type": "entry", "journal_id": self.bank.id, "lines": [],
        }, token=self.token)
        self.assertEqual(status, 403, body)
        for path in (
            "/finance/moves?type=out_invoice,out_refund",
            "/finance/moves?type=entry",
            f"/finance/moves/{self.sale.id}",
            f"/finance/moves/{self.sale.id}/pdf",
            "/finance/treasury",
            "/finance/statements/balance-sheet",
            "/finance/statements/income",
            "/finance/dashboard",
            "/finance/shell",
            "/finance/alerts",
            "/finance/closing",
            "/finance/accounts",
            "/finance/analytic-accounts",
            "/finance/payment-modes",
            "/approvals/rules",
        ):
            status, body = self._get(path)
            self.assertEqual(status, 403, (path, body))
        status, body = self.call("PATCH", f"/finance/moves/{self.sale.id}", {"ref": "X"}, token=self.token)
        self.assertEqual(status, 403, body)
        status, body = self._upload(f"/finance/moves/{self.sale.id}/attachments")
        self.assertEqual(status, 403, body)
        if self.env["ir.module.module"].search_count([("name", "=", "eguitra_analytics"), ("state", "=", "installed")]):
            status, body = self._get("/analyse/groupe/synthese")
            self.assertEqual(status, 403, body)
