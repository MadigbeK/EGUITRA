import io
from datetime import date

from odoo import Command
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@tagged("post_install", "-at_install")
class TestTreasuryOperations(FinanceDataMixin, ApiCase):
    """Opérations de trésorerie imputées sur les axes, modes de paiement, justificatifs, rapprochement."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("fatou", "finance")
        plan = cls.env.ref("eguitra_base.analytic_plan_activite")
        cls.activity = cls.env["account.analytic.account"].create(
            {"name": "Transport de personnel", "plan_id": plan.id, "company_id": cls.company.id})
        cls.mode = cls.env["eguitra.payment.mode"].search([("name", "=", "Espèces")], limit=1)

    def setUp(self):
        super().setUp()
        self.token = self.open_session("fatou")["access_token"]

    def _upload(self, path, content=PNG, name="recu.png"):
        response = self.url_open("/api/v1" + path, files={"file": (name, io.BytesIO(content), "image/png")},
                                 headers={"Authorization": f"Bearer {self.token}"}, method="POST", timeout=60)
        return response.status_code, response.json()

    def test_modes_de_paiement(self):
        status, modes = self.call("GET", "/finance/payment-modes", token=self.token)
        self.assertEqual(status, 200, modes)
        self.assertTrue({"Virement", "Chèque", "Espèces", "Mobile money"} <= {m["name"] for m in modes})
        status, created = self.call("POST", "/finance/payment-modes", {"name": "Orange Money"}, token=self.token)
        self.assertEqual(status, 200, created)
        status, body = self.call("POST", "/finance/payment-modes", {"name": "orange money"}, token=self.token)
        self.assertEqual(status, 409)
        status, body = self.call("PATCH", f"/finance/payment-modes/{created['id']}", {"active": False}, token=self.token)
        self.assertEqual((status, body["active"]), (200, False))

    def test_operation_imputee_sur_les_axes(self):
        status, line = self.call("POST", f"/finance/treasury/{self.cash.id}/lines", {
            "label": "Carburant du minibus", "amount": -1_500_000, "counterpart_account_id": self.acc_purchase.id,
            "analytic_distribution": {str(self.activity.id): 100}, "payment_mode_id": self.mode.id,
            "reference": "BON-0042",
        }, token=self.token)
        self.assertEqual(status, 200, line)
        self.assertTrue(line["reconciled"])
        self.assertEqual(line["payment_mode"]["name"], "Espèces")
        self.assertEqual(line["reference"], "BON-0042")
        self.assertEqual(line["counterpart"][0]["code"], self.acc_purchase.code)
        self.assertEqual(line["counterpart"][0]["analytic"][0]["id"], self.activity.id)

        status, body = self._upload(f"/finance/treasury/lines/{line['id']}/attachments")
        self.assertEqual(status, 200, body)
        status, listing = self.call("GET", f"/finance/treasury/{self.cash.id}/lines?state=all", token=self.token)
        row = next(r for r in listing["items"] if r["id"] == line["id"])
        self.assertEqual(row["attachments"], 1)

        status, body = self.call("POST", f"/finance/treasury/{self.cash.id}/lines", {
            "label": "Sans compte", "amount": -10_000, "analytic_distribution": {str(self.activity.id): 100},
        }, token=self.token)
        self.assertEqual(status, 422, "L'analytique accompagne un compte d'imputation")

    def test_imputation_directe_au_rapprochement(self):
        status, line = self.call("POST", f"/finance/treasury/{self.bank.id}/lines", {
            "label": "FRAIS TENUE DE COMPTE", "amount": -25_000, "payment_mode_id": self.mode.id,
        }, token=self.token)
        self.assertEqual(status, 200, line)
        self.assertFalse(line["reconciled"])
        status, _b = self._upload(f"/finance/treasury/lines/{line['id']}/attachments")
        self.assertEqual(status, 200)
        status, candidates = self.call("GET", f"/finance/treasury/lines/{line['id']}/candidates", token=self.token)
        self.assertEqual(status, 200, candidates)
        self.assertTrue(all(c["kind"] == "move_line" for c in candidates))

        status, done = self.call("POST", f"/finance/treasury/lines/{line['id']}/reconcile", {
            "account_id": self.acc_purchase.id, "analytic_distribution": {str(self.activity.id): 100},
        }, token=self.token)
        self.assertEqual(status, 200, done)
        self.assertTrue(done["reconciled"])
        self.assertEqual(done["attachments"], 1, "Le justificatif suit l'opération recréée")
        self.assertEqual(done["payment_mode"]["name"], "Espèces")
        self.assertEqual(done["counterpart"][0]["analytic"][0]["id"], self.activity.id)

        status, body = self.call("POST", f"/finance/treasury/lines/{done['id']}/reconcile",
                                 {"account_id": self.acc_purchase.id}, token=self.token)
        self.assertEqual(status, 422, "Déjà rapprochée")

    def test_reglement_avec_mode_de_paiement(self):
        invoice = self.make_invoice("out_invoice", 10_000_000)
        mode = self.env["eguitra.payment.mode"].search([("name", "=", "Virement")], limit=1)
        status, paid = self.call("POST", f"/finance/moves/{invoice.id}/payments", {
            "journal_id": self.bank.id, "payment_mode_id": mode.id}, token=self.token)
        self.assertEqual(status, 200, paid)
        payment = self.env["account.payment"].search([("partner_id", "=", self.customer.id)], order="id desc", limit=1)
        self.assertEqual(payment.eguitra_payment_mode_id, mode)


@tagged("post_install", "-at_install")
class TestBankReconciliationStatement(FinanceDataMixin, ApiCase):
    """Soldes des relevés à l'import, état de rapprochement et contrôle de clôture."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("fatou", "finance")

    def setUp(self):
        super().setUp()
        self.token = self.open_session("fatou")["access_token"]

    def _import(self, text, **form):
        response = self.url_open(
            f"/api/v1/finance/treasury/{self.bank.id}/import", data=form,
            files={"file": ("releve.csv", io.BytesIO(text.encode()), "text/csv")},
            headers={"Authorization": f"Bearer {self.token}"}, method="POST", timeout=60,
        )
        return response.status_code, response.json()

    def test_soldes_lus_dans_le_releve(self):
        status, body = self._import(
            "Date;Libellé;Débit;Crédit;Solde\n"
            ";Solde initial;;;1 000 000\n"
            "02/10/2026;VIREMENT RECU CLIENT;;500 000;1 500 000\n"
            "03/10/2026;FRAIS DE TENUE DE COMPTE;25 000;;1 475 000\n"
            ";Nouveau solde;;;1 475 000\n"
        )
        self.assertEqual(status, 200, body)
        self.assertEqual(body["created"], 2, "Les lignes de solde ne sont pas des opérations")
        self.assertEqual((body["balances"]["start"], body["balances"]["end"]), (1_000_000, 1_475_000))
        self.assertTrue(body["balances"]["controlled"])
        self.assertEqual(body["balances"]["gap"], 0)
        self.assertTrue(body["statement"]["is_complete"])

        # Relevé suivant, en ordre décroissant, avec un solde progressif seulement.
        status, body = self._import(
            "Date;Libellé;Montant;Solde\n"
            "10/10/2026;PRELEVEMENT ASSURANCE;-100 000;1 373 000\n"
            "08/10/2026;FRAIS SMS;-2 000;1 473 000\n"
        )
        self.assertEqual(status, 200, body)
        self.assertEqual((body["balances"]["start"], body["balances"]["end"]), (1_475_000, 1_373_000))
        self.assertFalse(body["warnings"], "Le solde initial prolonge le relevé précédent")

        # Situation comptable : à-nouveau de la banque, puis un virement interne (absent du relevé).
        opening = self.env["account.journal"].create({"name": "À-nouveaux", "code": "AN", "type": "general",
                                                      "company_id": self.company.id})
        self.env["account.move"].create({
            "move_type": "entry", "journal_id": opening.id, "date": date(2026, 10, 1),
            "line_ids": [
                Command.create({"name": "Banque", "account_id": self.bank.default_account_id.id, "debit": 1_000_000}),
                Command.create({"name": "Ouverture", "account_id": self.acc_loan.id, "credit": 1_000_000}),
            ],
        }).action_post()
        status, transfer = self.call("POST", "/finance/transfers", {
            "from_journal_id": self.bank.id, "to_journal_id": self.cash.id, "amount": 50_000, "date": "2026-10-15",
        }, token=self.token)
        self.assertEqual(status, 200, transfer)

        status, state = self.call("GET", f"/finance/treasury/{self.bank.id}/reconciliation-statement?date=2026-10-31",
                                  token=self.token)
        self.assertEqual(status, 200, state)
        self.assertEqual(state["bank_balance"], 1_373_000)
        self.assertEqual(state["book_balance"], 1_323_000)
        self.assertEqual(state["book_only_total"], -50_000, "Le virement interne n'est pas sur le relevé")
        self.assertEqual(len(state["book_only"]), 1)
        self.assertEqual(state["residual_gap"], 0)
        self.assertTrue(state["balanced"])
        self.assertEqual(len(state["unreconciled"]), 4)
        self.assertEqual(state["diagnostics"]["opening_gap"], 0)

        response = self.url_open(
            f"/api/v1/finance/treasury/{self.bank.id}/reconciliation-statement?date=2026-10-31&format=xlsx",
            headers={"Authorization": f"Bearer {self.token}"}, timeout=60)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"PK"))

        close = self.env["eguitra.period.close"]._get(self.company, date(2026, 10, 1))
        checks = {c["code"]: c for c in close._run_controls()}
        self.assertEqual(checks["bank_statement_balance"]["status"], "ok", checks["bank_statement_balance"])
        statement = self.env["account.bank.statement"].search([("journal_id", "=", self.bank.id)],
                                                              order="first_line_index desc", limit=1)
        status, corrected = self.call("PATCH", f"/finance/treasury/statements/{statement.id}",
                                      {"balance_end_real": 1_383_000}, token=self.token)
        self.assertEqual(status, 200, corrected)
        self.assertFalse(corrected["is_complete"])
        checks = {c["code"]: c for c in close._run_controls()}
        self.assertEqual(checks["bank_statement_balance"]["status"], "blocking",
                         "Solde du relevé différent du solde comptable : clôture refusée")

    def test_ecart_du_releve_refuse_sauf_confirmation(self):
        text = "Date;Libellé;Montant\n05/11/2026;REMISE DE CHEQUES;300 000\n06/11/2026;AGIOS;-4 500\n"
        status, body = self._import(text, balance_start="0", balance_end="300 000")
        self.assertEqual((status, body["error"]), (422, "statement_gap"), body)
        self.assertEqual(body["balances"]["gap"], -4_500)
        self.assertFalse(self.env["account.bank.statement.line"].search_count(
            [("journal_id", "=", self.bank.id), ("payment_ref", "=", "AGIOS")]), "Rien n'est importé")
        status, body = self._import(text, balance_start="0", balance_end="300 000", force="1")
        self.assertEqual(status, 200, body)
        self.assertFalse(body["statement"]["is_complete"], "Le relevé garde le solde de la banque")
        self.assertEqual(body["statement"]["balance_end_real"], 300_000)

    def test_operation_saisie_rattachee_au_releve(self):
        status, line = self.call("POST", f"/finance/treasury/{self.bank.id}/lines", {
            "label": "COMMISSION VIREMENT", "amount": -15_000, "date": "2026-11-20"}, token=self.token)
        self.assertEqual(status, 200, line)
        status, body = self._import("Date;Libellé;Montant\n20/11/2026;COMMISSION VIREMENT;-15 000\n"
                                    "21/11/2026;VERSEMENT ESPECES;2 000 000\n")
        self.assertEqual(status, 200, body)
        self.assertEqual((body["created"], body["attached"], body["skipped_duplicates"]), (1, 1, 0))
        st_line = self.env["account.bank.statement.line"].browse(line["id"])
        self.assertEqual(st_line.statement_id.id, body["statement"]["id"], "La banque confirme l'opération saisie")
