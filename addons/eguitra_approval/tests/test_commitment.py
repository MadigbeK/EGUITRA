from odoo import Command
from odoo.exceptions import UserError
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_api.tests.profils import RefusParProfil
from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin

# Profils des routes des engagements (controllers/commitments.py, INTERNAL).
INTERNAL = ("admin", "direction", "finance", "exploitation", "chantiers", "immobilier", "cabinet", "achats")


@tagged("post_install", "-at_install")
class TestCommitment(RefusParProfil, FinanceDataMixin, ApiCase):
    """Engagements de dépense : circuit d'approbation avant la commande, consommation par les pièces
    d'achat, qui ne refont pas le circuit dans la limite de l'engagement."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.comptable = cls._create_user("comptable.eng", "finance")
        cls.chef_comptable = cls._create_user("chef.eng", "finance")
        cls.dg = cls._create_user("dg.eng", "direction")
        cls.chef_chantier = cls._create_user("chantier.eng", "chantiers")

    def _commitment(self, amount, user=None):
        return self.env["eguitra.commitment"].with_user(user or self.chef_chantier).create({
            "partner_id": self.supplier.id, "object": "Gasoil du chantier de Kindia", "amount": amount,
            "account_id": self.acc_purchase.id, "company_id": self.company.id,
        })

    def _bill(self, amount, commitment=None):
        return self.env["account.move"].with_user(self.comptable).create({
            "move_type": "in_invoice", "partner_id": self.supplier.id, "invoice_date": self.today,
            "eguitra_commitment_id": commitment.id if commitment else False,
            "invoice_line_ids": [Command.create({
                "name": "Gasoil", "quantity": 1, "price_unit": amount, "account_id": self.acc_purchase.id,
                "tax_ids": [Command.set(self.tax_purchase.ids)],
            })],
        })

    def _request(self, record):
        return self.env["eguitra.approval.request"].search(
            [("res_model", "=", record._name), ("res_id", "=", record.id), ("state", "!=", "cancelled")],
            order="id desc", limit=1)

    def test_engagement_approuve_puis_consomme(self):
        commitment = self._commitment(100_000_000)
        self.assertTrue(commitment.name.startswith("ENG/"))
        commitment.action_submit()
        self.assertEqual(commitment.state, "submitted")
        request = self._request(commitment)
        self.assertEqual(request.step_ids.mapped("profile"), ["finance", "direction"], "Plus de 50 M : deux niveaux")
        with self.assertRaises(UserError):
            commitment.with_user(self.chef_chantier).write({"amount": 120_000_000})
        request.with_user(self.chef_comptable).action_approve()
        request.with_user(self.dg).action_approve()
        self.assertEqual(commitment.state, "approved", "Engagé")

        bill = self._bill(60_000_000, commitment)
        bill.with_user(self.comptable)._eguitra_post_or_submit()
        self.assertEqual(bill.state, "posted", "Dans l'engagement approuvé : pas de nouveau circuit")
        self.assertAlmostEqual(commitment.consumed, 60_000_000)
        self.assertAlmostEqual(commitment.remaining, 40_000_000)

        over = self._bill(50_000_000, commitment)
        over.with_user(self.comptable)._eguitra_post_or_submit()
        self.assertEqual(over.state, "draft", "Au-delà du reste à engager et de la tolérance : circuit habituel")
        self.assertTrue(self._request(over))

        within = self._bill(44_000_000, commitment)
        within.with_user(self.comptable)._eguitra_post_or_submit()
        self.assertEqual(within.state, "posted", "Tolérance de 5 % sur l'engagement")
        state = self.env["eguitra.report.engine"].run("engagements_non_soldes", self.company)
        row = next(r for r in state["rows"] if r["numero"] == commitment.name)
        self.assertAlmostEqual(row["reste"], 100_000_000 - 104_000_000, msg="État des engagements non soldés")
        commitment.action_close()
        self.assertEqual(commitment.state, "done")

    def test_refus_et_autre_fournisseur(self):
        commitment = self._commitment(10_000_000)
        commitment.action_submit()
        request = self._request(commitment)
        request.with_user(self.chef_comptable).action_reject("Devis manquant")
        self.assertEqual(commitment.state, "rejected")
        commitment.with_user(self.chef_chantier).write({"amount": 9_000_000})
        commitment.action_submit()
        self._request(commitment).with_user(self.chef_comptable).action_approve()
        self.assertEqual(commitment.state, "approved")

        other = self.env["res.partner"].create({"name": "Autre fournisseur"})
        bill = self._bill(5_000_000, commitment)
        bill.partner_id = other
        bill.with_user(self.comptable)._eguitra_post_or_submit()
        self.assertEqual(bill.state, "draft", "Un autre fournisseur ne consomme pas l'engagement")
        with self.assertRaises(UserError):
            commitment.unlink()

    def test_engagements_par_l_api(self):
        token = self.open_session("chantier.eng", app="finance")["access_token"]
        status, body = self.call("POST", "/finance/commitments", {
            "partner_id": self.supplier.id, "object": "Location d'une pelle", "amount": 20_000_000,
            "account_id": self.acc_purchase.id, "submit": True,
        }, token=token)
        self.assertEqual(status, 200, body)
        self.assertEqual((body["state"], body["approval"]["pending_with"]), ("submitted", "Finance et comptabilité"))
        status, rows = self.call("GET", "/finance/commitments?state=submitted", token=token)
        self.assertEqual(status, 200, rows)
        self.assertIn(body["id"], [r["id"] for r in rows])
        status, _b = self.call("POST", f"/finance/commitments/{body['id']}/close", token=token)
        self.assertEqual(status, 403, "Seules la finance et la direction soldent")
        ftoken = self.open_session("chef.eng", app="finance")["access_token"]
        status, inbox = self.call("GET", "/approvals/inbox", token=ftoken)
        request = next(r for r in inbox if r["res_model"] == "eguitra.commitment" and r["res_id"] == body["id"])
        status, detail = self.call("GET", f"/approvals/{request['id']}", token=ftoken)
        self.assertEqual(detail["document_detail"]["object"], "Location d'une pelle")
        status, _b = self.call("POST", f"/approvals/{request['id']}/approve", {}, token=ftoken)
        self.assertEqual(status, 200, _b)
        status, bills = self.call("GET", f"/finance/commitments/for-bill?partner_id={self.supplier.id}", token=ftoken)
        self.assertIn(body["id"], [c["id"] for c in bills], "Proposé à la saisie d'une pièce du fournisseur")

    def test_modifier_en_brouillon_puis_apres_refus(self):
        """« Modifier » : un engagement se corrige en brouillon ou refusé (la finance en précise le compte),
        jamais une fois soumis ; corrigé après un refus, il est resoumis et refait le circuit."""
        token = self.open_session("chantier.eng", app="finance")["access_token"]
        status, draft = self.call("POST", "/finance/commitments", {
            "partner_id": self.supplier.id, "object": "Location d'un camion-benne", "amount": 8_000_000,
        }, token=token)
        self.assertEqual(status, 200, draft)
        self.assertIsNone(draft["account"], "Compte à préciser par la finance")
        path = f"/finance/commitments/{draft['id']}"
        status, body = self.call("PATCH", path, {
            "object": "Location de deux camions-bennes", "amount": 16_000_000, "date_expected": self.today.isoformat(),
        }, token=token)
        self.assertEqual(status, 200, body)
        self.assertEqual((body["object"], body["amount"], body["date_expected"]),
                         ("Location de deux camions-bennes", 16_000_000, self.today.isoformat()))
        status, body = self.call("PATCH", path, {"object": " "}, token=token)
        self.assertEqual(status, 400, "L'objet se change, il ne se vide pas")
        ftoken = self.open_session("chef.eng", app="finance")["access_token"]
        status, body = self.call("PATCH", path, {"account_id": self.acc_purchase.id}, token=ftoken)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["account"]["id"], self.acc_purchase.id, "La finance précise le compte")

        status, body = self.call("POST", f"{path}/submit", token=token)
        self.assertEqual((status, body["state"]), (200, "submitted"), body)
        first = body["approval"]["request_id"]
        status, body = self.call("PATCH", path, {"amount": 20_000_000}, token=token)
        self.assertEqual(status, 422, "Soumis : il ne se modifie plus")
        status, body = self.call("POST", f"/approvals/{first}/reject", {"comment": "Un seul camion suffit"}, token=ftoken)
        self.assertEqual(status, 200, body)
        status, body = self.call("GET", path, token=token)
        self.assertEqual((body["state"], body["approval"]["rejected_reason"], body["approval"]["rejected_by"]),
                         ("rejected", "Un seul camion suffit", self.chef_comptable.name), "Le demandeur lit le motif")

        status, body = self.call("PATCH", path, {"object": "Location d'un camion-benne", "amount": 8_000_000}, token=token)
        self.assertEqual((status, body["amount"]), (200, 8_000_000), body)
        status, body = self.call("POST", f"{path}/submit", token=token)
        self.assertEqual((status, body["state"]), (200, "submitted"), body)
        second = body["approval"]["request_id"]
        self.assertNotEqual(second, first, "Nouvelle demande, au montant corrigé")
        status, body = self.call("POST", f"/approvals/{second}/approve", {}, token=ftoken)
        self.assertEqual(status, 200, body)
        status, body = self.call("GET", path, token=token)
        self.assertEqual((body["state"], body["amount"]), ("approved", 8_000_000))

    def test_regle_par_compte_appliquee_sans_compte(self):
        """Règle réservée à certains comptes (investissements, préfixe 2) : un engagement sans compte la suit
        aussi, faute de pouvoir l'écarter ; le compte précisé, seules les règles de son compte s'appliquent."""
        rule = self.env["eguitra.approval.rule"].create({
            "name": "Investissements : accord de la direction", "company_id": self.company.id,
            "document": "commitment", "sequence": 3, "min_amount": 0, "account_prefix": "2",
            "approver_profile": "direction",
        })
        asset = self.env["account.account"].search(
            [("code", "=like", "24%"), ("company_ids", "in", self.company.ids)], limit=1)
        self.assertTrue(asset, "Compte de matériel (24) du plan")
        commitment = self._commitment(10_000_000)
        commitment.account_id = False
        self.assertIn(rule, commitment._eguitra_required_rules(), "Sans compte : la règle des investissements s'applique")
        commitment.account_id = self.acc_purchase
        self.assertNotIn(rule, commitment._eguitra_required_rules(), "Compte de charges : elle ne s'applique pas")
        commitment.account_id = asset
        self.assertIn(rule, commitment._eguitra_required_rules(), "Compte d'immobilisation : elle s'applique")
        commitment.account_id = False
        commitment.action_submit()
        self.assertEqual(self._request(commitment).step_ids.mapped("profile"), ["finance", "direction"],
                         "Soumis sans compte : la direction tranche aussi")

    def test_modification_et_soumission_refusees_hors_profils(self):
        """Routes des engagements (INTERNAL) : le porteur et la RH sont refusés, sans effet sur l'engagement."""
        commitment = self._commitment(5_000_000)
        self.assertRefuseHors(INTERNAL, "PATCH", f"/finance/commitments/{commitment.id}", {"amount": 1})
        self.assertRefuseHors(INTERNAL, "POST", f"/finance/commitments/{commitment.id}/submit")
        commitment.invalidate_recordset()
        self.assertEqual((commitment.amount, commitment.state), (5_000_000, "draft"))
