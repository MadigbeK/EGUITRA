"""Émission des bons de commande réservée au service Achats (décision du gérant du 2 novembre 2026, à la
demande d'EGUITRA GROUP) : réglage par société (actif chez EGUITRA GROUP SARLU, inactif chez MB AxisPro
Consulting), contrôlé dans le modèle (création, y compris depuis un engagement ou par duplication, modification
d'un brouillon et de ses lignes, soumission, annulation avant approbation) et par les routes (refus 403 en
clair, drapeaux des écrans) ; lecture, réception, pièces jointes, facture du fournisseur, contrôle et
approbation inchangés ; réglage tenu par l'administration ; mise en place de la migration. Données fictives."""

import base64
import io

from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from ..hooks import reserve_purchase_order_issue
from ..models.purchase_order import ISSUE_RESERVED
from .common import CommerceDataMixin

PDF = b"%PDF-1.4 contrat du fournisseur (essai)"
# Comptes qui lisent tous les bons de la société sans les émettre.
READERS = ("fin.emission", "dg.emission", "admin.emission")


@tagged("post_install", "-at_install")
class TestEmissionAchats(CommerceDataMixin, TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_commerce()
        cls.acheteur = cls.make_user("acheteur.emission", "achats")
        cls.comptable = cls.make_user("comptable.emission", "finance", companies=cls.groupe | cls.cabinet)
        cls.dg = cls.make_user("dg.emission", "direction")
        cls.admin = cls.make_user("admin.emission", "admin")
        cls.exploitation = cls.make_user("exploitation.emission", "exploitation")
        cls.chef_chantier = cls.make_user("chantier.emission", "chantiers")
        cls.achatvente = cls.make_user("achatvente.emission", "finance", "achats")
        cls.refused = (cls.comptable, cls.dg, cls.admin, cls.exploitation, cls.chef_chantier)

    def _cabinet_po(self, user):
        product = self.env["product.template"]._eguitra_generic_product(self.cabinet, "purchase")
        return self.make_po(user=user, company=self.cabinet, lines=[Command.create({
            "product_id": product.id, "name": "Fournitures du cabinet (test)", "product_qty": 1, "price_unit": 300_000,
            "date_planned": self.planned, "tax_ids": [Command.set([])]})])

    def test_reglage_et_mise_en_place(self):
        self.assertTrue(self.groupe.eguitra_po_issue_reserved)
        self.assertFalse(self.cabinet.eguitra_po_issue_reserved)
        (self.groupe | self.cabinet).write({"eguitra_po_issue_reserved": False})
        reserve_purchase_order_issue(self.env)
        self.assertEqual((self.groupe.eguitra_po_issue_reserved, self.cabinet.eguitra_po_issue_reserved), (True, False),
                         "Migration : réservée chez EGUITRA GROUP SARLU, ouverte chez MB AxisPro Consulting")
        other = self.env["res.company"].create({"name": "Société créée plus tard (test)"})
        self.assertFalse(other.eguitra_po_issue_reserved, "Nouvelle société : émission ouverte, comme avant")
        self.assertTrue(self.groupe._eguitra_can_issue_purchase_orders(self.acheteur))
        self.assertTrue(self.groupe._eguitra_can_issue_purchase_orders(self.achatvente), "Finance et achats : émet")
        for user in self.refused:
            self.assertFalse(self.groupe._eguitra_can_issue_purchase_orders(user), user.login)
            self.assertTrue(self.cabinet._eguitra_can_issue_purchase_orders(user), user.login)

    def test_creation_reservee_aux_achats(self):
        for user in self.refused:
            with self.assertRaisesRegex(AccessError, "réservée au service Achats", msg=user.login):
                self.make_po(user=user)
        commitment = self.env["eguitra.commitment"].create({
            "partner_id": self.supplier.id, "object": "Engagement approuvé (test)", "amount": 5_000_000,
            "account_id": self.acc_purchase.id, "company_id": self.groupe.id, "state": "approved",
            "requested_by": self.chef_chantier.id,
        })
        with self.assertRaises(AccessError, msg="Depuis un engagement non plus"):
            self.make_po(user=self.chef_chantier, eguitra_commitment_id=commitment.id)
        po = self.make_po(user=self.acheteur, eguitra_commitment_id=commitment.id)
        self.assertEqual(po.create_uid, self.acheteur)
        with self.assertRaises(AccessError, msg="Ni par duplication"):
            po.with_user(self.comptable).sudo().copy()
        self.assertTrue(self.make_po().exists(), "Le compte du système (tâches techniques) n'est pas concerné")

    def test_brouillon_soumission_et_annulation_reservees(self):
        po = self.make_po(user=self.acheteur, lines=[self.po_line("Ciment (test)", 10, 100_000)])
        line = po.order_line
        for user in self.refused:
            as_user = po.with_user(user).sudo()
            with self.assertRaises(AccessError, msg=f"{user.login} : modification"):
                as_user.write({"partner_ref": "DEV-REFUS"})
            with self.assertRaises(AccessError, msg=f"{user.login} : ligne modifiée"):
                line.with_user(user).sudo().write({"price_unit": 1})
            with self.assertRaises(AccessError, msg=f"{user.login} : ligne ajoutée"):
                as_user.write({"order_line": [self.po_line("Ajout (test)", 1, 1)]})
            with self.assertRaises(AccessError, msg=f"{user.login} : ligne retirée"):
                line.with_user(user).sudo().unlink()
            with self.assertRaises(AccessError, msg=f"{user.login} : soumission"):
                as_user.action_eguitra_submit()
            with self.assertRaises(AccessError, msg=f"{user.login} : annulation"):
                as_user.action_eguitra_cancel()
        self.assertEqual((po.partner_ref, line.price_unit, po.state), (False, 100_000, "draft"), "Rien n'a changé")
        po.write({"partner_ref": "DEV-OK-01"})
        po.action_eguitra_submit()
        self.assertEqual(po.eguitra_status, "to_approve")
        request = self.request_of(po)
        with self.assertRaises(AccessError, msg="Annulation en approbation : service Achats"):
            po.with_user(self.comptable).sudo().action_eguitra_cancel()
        request.with_user(self.comptable).action_reject("Joindre le devis (test)")
        self.assertEqual(po.eguitra_status, "rejected")
        with self.assertRaises(AccessError, msg="Nouvelle soumission : service Achats"):
            po.with_user(self.comptable).sudo().action_eguitra_submit()
        po.action_eguitra_submit()
        po.action_eguitra_cancel(reason="Besoin abandonné (test)")
        self.assertEqual(po.eguitra_status, "cancelled", "Le service Achats annule avant l'approbation")

    def test_controle_approbation_et_suite_inchanges(self):
        po = self.make_po(user=self.acheteur, lines=[self.po_line("Groupe électrogène (test)", 1, 12_000_000)])
        po.action_eguitra_submit()
        request = self.request_of(po)
        request.with_user(self.comptable).action_approve("Contrôlé (test)")
        request.with_user(self.dg).action_approve("Approuvé (test)")
        self.assertEqual(po.eguitra_status, "approved", "Contrôle par la finance, approbation par la direction")
        as_finance = po.with_user(self.comptable).sudo()
        as_finance.action_eguitra_mark_sent()
        receipt = po.with_user(self.chef_chantier).sudo().eguitra_receive({po.order_line: 1})
        self.assertEqual(receipt.received_by, self.chef_chantier, "Réception (service fait) par un autre profil")
        attachment = self.env["ir.attachment"].sudo().create({
            "name": "contrat.pdf", "datas": base64.b64encode(PDF), "mimetype": "application/pdf",
            "res_model": po._name, "res_id": po.id})
        self.env["eguitra.commerce.purchase.document"].with_user(self.comptable).sudo().create({
            "order_id": po.id, "category": "contract", "name": "contrat.pdf", "attachment_id": attachment.id})
        bill = as_finance.eguitra_create_bill(ref="FAC-EMISSION-01")
        self.assertEqual(bill.eguitra_purchase_order_id, po, "Facture du fournisseur saisie par la finance")

    def test_societe_sans_reserve(self):
        po = self._cabinet_po(self.comptable)
        po.write({"partner_ref": "DEV-CAB-01"})
        po.action_eguitra_submit()
        self.assertEqual(po.create_uid, self.comptable, "MB AxisPro Consulting : la finance émet, comme avant")
        self.assertIn(po.eguitra_status, ("to_approve", "approved"))


@tagged("post_install", "-at_install")
class TestApiEmissionAchats(CommerceDataMixin, ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_commerce()
        both = [(6, 0, (cls.groupe | cls.cabinet).ids)]
        cls._create_user("fin.emission", "finance", company_ids=both)
        cls._create_user("dg.emission", "direction")
        cls._create_user("admin.emission", "admin", company_ids=both)
        cls._create_user("achats.emission", "achats")
        cls._create_user("btp.emission", "chantiers")
        cls._create_user("exp.emission", "exploitation")
        cls.btp_user = cls.env["res.users"].search([("login", "=", "btp.emission")])
        cls.category = cls.env["eguitra.expense.category"].create({
            "name": "Fournitures (émission, essai)", "nature": "opex_metier", "account_id": cls.acc_purchase.id,
            "company_id": cls.groupe.id,
        })
        # Code de compte propre à chaque société : recherche faite dans la société du cabinet.
        cabinet_account = cls.env["account.account"].with_company(cls.cabinet).search(
            [("code", "=like", "60%"), ("company_ids", "in", cls.cabinet.ids)], order="code", limit=1)
        cls.category_cabinet = cls.env["eguitra.expense.category"].create({
            "name": "Fournitures du cabinet (essai)", "nature": "opex_metier", "account_id": cabinet_account.id,
            "company_id": cls.cabinet.id,
        })

    def setUp(self):
        super().setUp()
        self.tokens = {login: self.open_session(login)["access_token"]
                       for login in ("fin.emission", "dg.emission", "admin.emission", "achats.emission",
                                     "btp.emission", "exp.emission")}
        self.achats = self.tokens["achats.emission"]
        self.finance = self.tokens["fin.emission"]

    def _ok(self, method, path, payload=None, token=None, headers=None):
        status, body = self.call(method, path, payload, token=token or self.achats, headers=headers)
        self.assertEqual(status, 200, body)
        return body

    def _refused(self, method, path, payload=None, logins=None):
        for login in logins or ("fin.emission", "dg.emission", "admin.emission", "btp.emission", "exp.emission"):
            with self.subTest(route=f"{method} {path}", compte=login):
                status, body = self.call(method, path, payload, token=self.tokens[login])
                self.assertEqual(status, 403, body)
                self.assertEqual(body.get("message"), ISSUE_RESERVED)

    def _payload(self, category=None, **values):
        return dict({
            "partner_id": self.supplier.id, "object": "Matériel (essai)",
            "lines": [{"name": "Disjoncteurs (essai)", "quantity": 10, "price_unit": 100_000,
                       "category_id": (category or self.category).id}],
        }, **values)

    def test_emission_reservee_par_les_routes(self):
        self._refused("POST", "/commerce/purchase-orders", self._payload())
        commitment = self.env["eguitra.commitment"].create({
            "partner_id": self.supplier.id, "object": "Engagement du chantier (essai)", "amount": 2_000_000,
            "account_id": self.acc_purchase.id, "company_id": self.groupe.id, "state": "approved",
            "requested_by": self.btp_user.id,
        })
        self.env.flush_all()
        self._refused("POST", "/commerce/purchase-orders", {"commitment_id": commitment.id})
        purchasing = self._ok("GET", f"/commerce/commitments/{commitment.id}/purchasing",
                              token=self.tokens["btp.emission"])
        self.assertEqual((purchasing["can_order"], purchasing["issue_reserved"]), (False, True))
        self.assertTrue(self._ok("GET", f"/commerce/commitments/{commitment.id}/purchasing")["can_order"])
        from_commitment = self._ok("POST", "/commerce/purchase-orders", {"commitment_id": commitment.id})
        self.assertEqual(from_commitment["commitment"]["id"], commitment.id, "Le service Achats émet depuis l'engagement")

        po = self._ok("POST", "/commerce/purchase-orders", self._payload())
        path = f"/commerce/purchase-orders/{po['id']}"
        self.assertEqual((po["can"]["edit"], po["can"]["submit"], po["can"]["cancel"]), (True, True, True))
        seen = self._ok("GET", path, token=self.finance)
        self.assertEqual((seen["issue_reserved"], seen["can"]["edit"], seen["can"]["submit"], seen["can"]["cancel"]),
                         (True, False, False, False), "Lecture permise, émission refusée : drapeaux des écrans")
        listed = self._ok("GET", "/commerce/purchase-orders", token=self.finance)
        self.assertEqual((listed["issue_reserved"], listed["can_issue"]), (True, False))
        self.assertTrue(self._ok("GET", "/commerce/purchase-orders")["can_issue"])
        refs = self._ok("GET", "/commerce/referentials", token=self.finance)
        self.assertEqual((refs["issue_reserved"], refs["can_issue"]), (True, False))
        # Les métiers ne voient pas le bon d'un autre (404) ; les autres profils le lisent et reçoivent le refus.
        self._refused("PATCH", path, {"object": "Refusé"}, logins=READERS)
        self._refused("POST", f"{path}/submit", {}, logins=READERS)
        self._refused("POST", f"{path}/cancel", {}, logins=READERS)
        self.env.invalidate_all()
        order = self.env["purchase.order"].browse(po["id"])
        self.assertEqual((order.eguitra_object, order.state), ("Matériel (essai)", "draft"), "Rien n'a changé")

        submitted = self._ok("POST", f"{path}/submit", {})
        self.assertEqual(submitted["status"], "to_approve")
        self._refused("POST", f"{path}/cancel", {}, logins=READERS)
        request_id = submitted["approval"]["request_id"]
        self._ok("POST", f"/approvals/{request_id}/approve", {}, token=self.finance)
        approved = self._ok("POST", f"/approvals/{request_id}/approve", {}, token=self.tokens["dg.emission"])
        self.assertEqual(approved["state"], "approved", "Contrôle et approbation inchangés")
        line_id = self._ok("GET", path, token=self.finance)["lines"][0]["id"]
        received = self._ok("POST", f"{path}/receipts", {"lines": [{"id": line_id, "quantity": 10}]}, token=self.finance)
        self.assertEqual(received["status"], "received", "Réception par la finance")
        response = self.url_open(f"/api/v1{path}/documents", data={"category": "contract"},
                                 files={"file": ("contrat.pdf", io.BytesIO(PDF))},
                                 headers={"Authorization": f"Bearer {self.finance}", "X-Eguitra-App": "test"}, timeout=60)
        self.assertEqual(response.status_code, 200, response.text[:300])
        billed = self._ok("POST", f"{path}/bill", {"ref": "FAC-EMISSION-02"}, token=self.finance)
        self.assertTrue(billed["bill"]["id"], "Facture du fournisseur saisie par la finance")

    def test_reglage_tenu_par_l_administration(self):
        settings = self._ok("GET", "/commerce/settings", token=self.finance)
        self.assertEqual((settings["po_issue_reserved"], settings["po_issue_reserved_editable"]), (True, False))
        status, body = self.call("PATCH", "/commerce/settings", {"po_issue_reserved": False}, token=self.finance)
        self.assertEqual(status, 403, "La finance ne lève pas la réserve")
        self._ok("PATCH", "/commerce/settings", {"po_issue_reserved": True, "validity_days": 20}, token=self.finance)
        admin = self.tokens["admin.emission"]
        self.assertTrue(self._ok("GET", "/commerce/settings", token=admin)["po_issue_reserved_editable"])
        self._ok("PATCH", "/commerce/settings", {"po_issue_reserved": False}, token=admin)
        self.env.invalidate_all()
        self.assertFalse(self.groupe.eguitra_po_issue_reserved)
        po = self._ok("POST", "/commerce/purchase-orders", self._payload(), token=self.finance)
        self.assertTrue(po["can"]["submit"], "Réserve levée : la finance émet de nouveau")

    def test_cabinet_sans_reserve(self):
        cabinet = {"X-Eguitra-Company": str(self.cabinet.id)}
        po = self._ok("POST", "/commerce/purchase-orders", self._payload(category=self.category_cabinet),
                      token=self.finance, headers=cabinet)
        self.assertTrue(po["name"].startswith(f"BC/MBAX/{self.year}/"))
        self.assertEqual((po["issue_reserved"], po["can"]["submit"]), (False, True), "Comportement précédent")
        self._ok("POST", f"/commerce/purchase-orders/{po['id']}/submit", {}, token=self.finance, headers=cabinet)
