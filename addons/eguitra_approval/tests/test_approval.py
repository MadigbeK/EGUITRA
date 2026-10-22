from odoo import Command
from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase
from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestApproval(FinanceDataMixin, ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.comptable = cls._create_user("comptable", "finance")
        cls.chef_comptable = cls._create_user("chef.comptable", "finance")
        cls.dg = cls._create_user("dg", "direction")
        cls.chef_chantier = cls._create_user("chef.chantier", "chantiers")

    def _bill(self, amount, user=None):
        Move = self.env["account.move"].with_user(user or self.comptable)
        return Move.create({
            "move_type": "in_invoice",
            "partner_id": self.supplier.id,
            "invoice_date": self.today,
            "invoice_line_ids": [Command.create({
                "name": "Gasoil", "quantity": 1, "price_unit": amount, "account_id": self.acc_purchase.id,
                "tax_ids": [Command.set(self.tax_purchase.ids)],
            })],
        })

    def _request(self, record):
        return self.env["eguitra.approval.request"].search(
            [("res_model", "=", record._name), ("res_id", "=", record.id), ("state", "!=", "cancelled")], order="id desc", limit=1
        )

    def test_validation_directe_refusee(self):
        bill = self._bill(10_000_000)
        with self.assertRaises(UserError):
            bill.with_user(self.comptable).action_post()
        # Le drapeau de contournement n'a d'effet qu'en mode superutilisateur (pas par RPC).
        with self.assertRaises(UserError):
            bill.with_user(self.comptable).with_context(eguitra_approval_granted=True).action_post()

    def test_od_saisie_soumise_au_circuit(self):
        self.env["eguitra.approval.rule"].create({
            "name": "OD : contrôle de la direction", "document": "entry", "sequence": 1, "min_amount": 1_000_000,
            "approver_profile": "direction", "company_id": self.company.id,
        })
        journal = self.env["account.journal"].search([("company_id", "=", self.company.id), ("type", "=", "general")], limit=1)
        lines = [
            Command.create({"name": "Provision", "account_id": self.acc_purchase.id, "debit": 5_000_000}),
            Command.create({"name": "Provision", "account_id": self.bank.default_account_id.id, "credit": 5_000_000}),
        ]
        od = self.env["account.move"].with_user(self.comptable).create(
            {"move_type": "entry", "journal_id": journal.id, "line_ids": lines, "eguitra_manual_entry": True}
        )
        od.with_user(self.comptable)._eguitra_post_or_submit()
        self.assertEqual(od.state, "draft")
        self._request(od).with_user(self.dg).action_approve()
        self.assertEqual(od.state, "posted")

    def test_circuit_un_niveau(self):
        bill = self._bill(10_000_000)
        bill.with_user(self.comptable)._eguitra_post_or_submit()
        self.assertEqual(bill.state, "draft")
        request = self._request(bill)
        self.assertEqual(len(request.step_ids), 1, "Moins de 50 M : la finance seule")
        with self.assertRaises(AccessError):
            request.with_user(self.comptable).action_approve()
        request.with_user(self.chef_comptable).action_approve("Conforme au bon de commande")
        self.assertEqual(request.state, "approved")
        self.assertEqual(bill.state, "posted", "La dernière approbation comptabilise la pièce")

    def test_circuit_deux_niveaux(self):
        bill = self._bill(100_000_000)
        bill.with_user(self.comptable)._eguitra_post_or_submit()
        request = self._request(bill)
        self.assertEqual(request.step_ids.mapped("profile"), ["finance", "direction"])
        with self.assertRaises(AccessError):
            request.with_user(self.dg).action_approve()  # la direction attend la finance
        request.with_user(self.chef_comptable).action_approve()
        self.assertEqual(bill.state, "draft")
        self.assertEqual(request.pending_profile, "direction")
        request.with_user(self.dg).action_approve("Accord")
        self.assertEqual(bill.state, "posted")

    def test_quatre_yeux_entre_les_etapes(self):
        """Un compte porteur des profils finance et direction (comme l'administration) ne tranche qu'une
        étape d'une même demande : la suivante revient à une autre personne."""
        cumul = self._create_user("daf.dg", "finance", "direction")
        bill = self._bill(100_000_000)
        bill.with_user(self.comptable)._eguitra_post_or_submit()
        request = self._request(bill)
        self.assertEqual(request.step_ids.mapped("profile"), ["finance", "direction"])
        request.with_user(cumul).action_approve("Contrôlé")
        self.assertEqual(request.pending_profile, "direction")
        self.assertFalse(request._can_decide(cumul))
        with self.assertRaisesRegex(AccessError, "autre personne"):
            request.with_user(cumul).action_approve("Accord")
        with self.assertRaisesRegex(AccessError, "autre personne"):
            request.with_user(cumul).action_reject("Refus")
        self.assertEqual((request.state, bill.state), ("pending", "draft"))
        request.with_user(self.dg).action_approve("Accord")
        self.assertEqual(bill.state, "posted")

    def test_quatre_yeux_par_api(self):
        self._create_user("daf.dg", "finance", "direction")
        bill = self._bill(100_000_000)
        bill.with_user(self.comptable)._eguitra_post_or_submit()
        req = self._request(bill)
        token = self.open_session("daf.dg")["access_token"]
        status, inbox = self.call("GET", "/approvals/inbox", token=token)
        self.assertEqual((status, [r["id"] for r in inbox]), (200, [req.id]), inbox)
        status, shell = self.call("GET", "/finance/shell", token=token)
        self.assertEqual((status, shell["badges"]["approvals"]), (200, 1), shell)
        status, done = self.call("POST", f"/approvals/{req.id}/approve", {"comment": "Contrôlé"}, token=token)
        self.assertEqual(status, 200, done)
        self.assertEqual(done["pending_with"], "Direction générale")
        self.assertFalse(done["can_decide"], "L'étape de la direction revient à une autre personne")
        status, inbox = self.call("GET", "/approvals/inbox", token=token)
        self.assertEqual((status, inbox), (200, []), "Plus rien à trancher pour ce compte")
        status, shell = self.call("GET", "/finance/shell", token=token)
        self.assertEqual((status, shell["badges"]["approvals"]), (200, 0), "Pastille cohérente avec la corbeille")
        status, body = self.call("POST", f"/approvals/{req.id}/approve", {"comment": "Accord"}, token=token)
        self.assertEqual(status, 403, body)
        self.assertIn("autre personne", body["message"])
        status, body = self.call("POST", f"/approvals/{req.id}/reject", {"comment": "Refus"}, token=token)
        self.assertEqual(status, 403, body)
        self.assertEqual(bill.state, "draft")
        token_dg = self.open_session("dg")["access_token"]
        status, shell = self.call("GET", "/finance/shell", token=token_dg)
        self.assertEqual((status, shell["badges"]["approvals"]), (200, 1), shell)
        status, done = self.call("POST", f"/approvals/{req.id}/approve", {"comment": "Accord"}, token=token_dg)
        self.assertEqual((status, done["state"]), (200, "approved"), done)

    def test_refus_puis_nouvelle_soumission(self):
        bill = self._bill(10_000_000)
        bill.with_user(self.comptable)._eguitra_post_or_submit()
        request = self._request(bill)
        with self.assertRaises(UserError):
            request.with_user(self.chef_comptable).action_reject("")
        request.with_user(self.chef_comptable).action_reject("Montant à vérifier")
        self.assertEqual(request.state, "rejected")
        self.assertEqual(bill.state, "draft")
        bill.with_user(self.comptable)._eguitra_post_or_submit()
        nouvelle = self._request(bill)
        self.assertNotEqual(nouvelle, request)
        self.assertEqual(nouvelle.state, "pending")

    def test_modification_pendant_la_validation(self):
        bill = self._bill(10_000_000)
        bill.with_user(self.comptable)._eguitra_post_or_submit()
        request = self._request(bill)
        bill.with_user(self.comptable).write({
            "invoice_line_ids": [Command.update(bill.invoice_line_ids.id, {"price_unit": 90_000_000})],
        })
        with self.assertRaises(UserError):
            request.with_user(self.chef_comptable).action_approve()  # montant changé depuis la soumission
        bill.with_user(self.comptable)._eguitra_post_or_submit()
        self.assertEqual(request.state, "cancelled", "La nouvelle soumission remplace l'ancienne")
        nouvelle = self._request(bill)
        self.assertEqual(nouvelle.amount, 106_200_000)
        self.assertEqual(len(nouvelle.step_ids), 2, "Le nouveau montant appelle l'accord de la direction")

    def test_piece_approuvee_puis_modifiee(self):
        """Remise en brouillon après approbation : toute modification impose une nouvelle approbation."""
        bill = self._bill(10_000_000)
        bill.with_user(self.comptable)._eguitra_post_or_submit()
        self._request(bill).with_user(self.chef_comptable).action_approve()
        self.assertEqual(bill.state, "posted")
        bill.with_user(self.comptable).button_draft()
        bill.with_user(self.comptable).action_post()
        self.assertEqual(bill.state, "posted", "Pièce inchangée : l'approbation tient")
        bill.with_user(self.comptable).button_draft()
        autre = self.env["res.partner"].create({"name": "Fournisseur substitué"})
        bill.with_user(self.comptable).write({"partner_id": autre.id})
        with self.assertRaises(UserError):
            bill.with_user(self.comptable).action_post()
        bill.with_user(self.comptable)._eguitra_post_or_submit()
        self.assertEqual(bill.state, "draft")
        self.assertEqual(self._request(bill).state, "pending", "Une nouvelle demande est ouverte")

    def test_reglement_soumis_au_dela_du_seuil(self):
        bill = self._bill(150_000_000)
        bill.sudo().with_context(eguitra_approval_granted=True).action_post()
        wizard = self.env["account.payment.register"].with_user(self.comptable).with_context(
            active_model="account.move", active_ids=bill.ids
        ).create({"journal_id": self.bank.id})
        wizard._create_payments()
        payment = self.env["account.payment"].search([("partner_id", "=", self.supplier.id)], order="id desc", limit=1)
        self.assertEqual(payment.move_id.state, "draft", "Plus de 100 M : le règlement attend l'accord de la direction")
        self.assertEqual(bill.payment_state, "not_paid")
        request = self._request(payment)
        request.with_user(self.dg).action_approve()
        self.assertEqual(payment.move_id.state, "posted")
        self.assertIn(bill.payment_state, ("paid", "in_payment"))
        payment.with_user(self.comptable).action_draft()
        payment.with_user(self.comptable).write({"amount": payment.amount + 1_000_000})
        with self.assertRaises(UserError):
            payment.with_user(self.comptable).action_post()  # règlement modifié après l'accord

    def test_corbeille_par_api(self):
        bill = self._bill(100_000_000)
        bill.with_user(self.comptable)._eguitra_post_or_submit()
        token = self.open_session("chef.comptable")["access_token"]
        status, inbox = self.call("GET", "/approvals/inbox", token=token)
        self.assertEqual(status, 200, inbox)
        self.assertEqual(len(inbox), 1)
        self.assertTrue(inbox[0]["can_decide"])
        status, done = self.call("POST", f"/approvals/{inbox[0]['id']}/approve", {"comment": "OK"}, token=token)
        self.assertEqual(status, 200, done)
        self.assertEqual(done["pending_with"], "Direction générale")

        token_dg = self.open_session("dg")["access_token"]
        status, inbox_dg = self.call("GET", "/approvals/inbox", token=token_dg)
        self.assertEqual([r["id"] for r in inbox_dg], [inbox[0]["id"]])
        status, refus = self.call("POST", f"/approvals/{inbox[0]['id']}/reject", {}, token=token_dg)
        self.assertEqual(status, 400, "Le motif du refus est obligatoire")

        token_requester = self.open_session("comptable")["access_token"]
        status, moves = self.call("GET", f"/finance/moves/{bill.id}", token=token_requester)
        self.assertEqual(moves["approval"]["state"], "pending")
        self.assertEqual(moves["approval"]["pending_with"], "Direction générale")

    def test_demandes_visibles_selon_le_profil(self):
        bill = self._bill(100_000_000)
        bill.with_user(self.comptable)._eguitra_post_or_submit()
        req = self._request(bill)
        token = self.open_session("chef.chantier")["access_token"]
        status, rows = self.call("GET", "/approvals/requests", token=token)
        self.assertEqual(status, 200, rows)
        self.assertNotIn(req.id, [r["id"] for r in rows], "Un chef de chantier ne voit pas les achats de la finance")
        status, _b = self.call("GET", f"/approvals/{req.id}", token=token)
        self.assertEqual(status, 404)
        status, rows = self.call("GET", "/approvals/requests", token=self.open_session("dg")["access_token"])
        self.assertIn(req.id, [r["id"] for r in rows], "La direction voit toutes les demandes de ses sociétés")
