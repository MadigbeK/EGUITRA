from odoo import Command
from odoo.exceptions import UserError
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestCommitment(FinanceDataMixin, ApiCase):
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
