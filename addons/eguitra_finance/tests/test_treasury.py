import importlib.util
import io
import os
from datetime import date

from odoo import Command
from odoo.modules.module import get_module_path
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin
from .pilotage_common import PilotageMixin

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

    def test_types_d_operation(self):
        def create(**values):
            return self.call("POST", "/finance/treasury/operation-types", values, token=self.token)

        status, mission = create(name="Frais de mission", direction="out", account_id=self.acc_purchase.id)
        self.assertEqual(status, 200, mission)
        self.assertFalse(mission["to_match"])
        status, body = create(name="Vers la caisse", direction="out", account_id=self.bank.default_account_id.id)
        self.assertEqual(status, 422, "Un mouvement entre comptes de trésorerie est un virement interne")
        receivable = self.customer.property_account_receivable_id
        status, receipt = create(name="Encaissement client", direction="in", account_id=receivable.id,
                                 reference_required=True)
        self.assertEqual(status, 200, receipt)
        self.assertTrue(receipt["to_match"], "Contrepartie client : rapprochement avec la facture")
        status, transfer = create(name="Virement vers la caisse", direction="out", is_transfer=True)
        self.assertEqual(status, 200, transfer)

        status, line = self.call("POST", f"/finance/treasury/{self.cash.id}/lines", {
            "label": "Mission à Boké", "amount": 500_000, "operation_type_id": mission["id"]}, token=self.token)
        self.assertEqual(status, 200, line)
        self.assertEqual(line["amount"], -500_000, "Le type fixe le sens")
        self.assertTrue(line["reconciled"], "Et la contrepartie")
        self.assertEqual(line["operation_type"]["name"], "Frais de mission")
        status, body = self.call("POST", f"/finance/treasury/{self.bank.id}/lines", {
            "label": "Virement client", "amount": 118_000_000, "operation_type_id": receipt["id"]}, token=self.token)
        self.assertEqual(status, 400, "Référence obligatoire")
        status, line = self.call("POST", f"/finance/treasury/{self.bank.id}/lines", {
            "label": "Virement client", "amount": 118_000_000, "operation_type_id": receipt["id"],
            "reference": "FAC/2026/0001"}, token=self.token)
        self.assertEqual(status, 200, line)
        self.assertFalse(line["reconciled"], "Reste à rapprocher de la facture")
        status, body = self.call("POST", f"/finance/treasury/{self.bank.id}/lines", {
            "label": "Retrait", "amount": 1_000_000, "operation_type_id": transfer["id"]}, token=self.token)
        self.assertEqual(status, 422)
        status, body = self.call("POST", "/finance/treasury/operation-types/defaults", token=self.token)
        self.assertEqual(status, 200, body)
        self.assertTrue(body["created"])

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

    def _import(self, text, name="releve.csv", **form):
        response = self.url_open(
            f"/api/v1/finance/treasury/{self.bank.id}/import", data=form,
            files={"file": (name, io.BytesIO(text.encode()), "text/csv")},
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

    def test_releve_camt053(self):
        """Relevé normalisé ISO 20022 : soldes OPBD et CLBD, sens CRDT et DBIT, opération en attente ignorée."""
        def entry(amount, sign, day, label, status="BOOK"):
            return (f"<Ntry><Amt Ccy='GNF'>{amount}</Amt><CdtDbtInd>{sign}</CdtDbtInd><Sts><Cd>{status}</Cd></Sts>"
                    f"<BookgDt><Dt>{day}</Dt></BookgDt><ValDt><Dt>{day}</Dt></ValDt>"
                    f"<NtryDtls><TxDtls><RmtInf><Ustrd>{label}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>")

        def balance(code, amount):
            return (f"<Bal><Tp><CdOrPrtry><Cd>{code}</Cd></CdOrPrtry></Tp><Amt Ccy='GNF'>{amount}</Amt>"
                    f"<CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-12-01</Dt></Dt></Bal>")

        xml = ("<?xml version='1.0' encoding='UTF-8'?>"
               "<Document xmlns='urn:iso:std:iso:20022:tech:xsd:camt.053.001.08'><BkToCstmrStmt><Stmt>"
               "<Id>REL-12</Id><Acct><Id><Othr><Id>0001234567</Id></Othr></Id></Acct>"
               + balance("OPBD", "2000000.00") + balance("CLBD", "2650000.00")
               + entry("800000.00", "CRDT", "2026-12-02", "REGLEMENT FACTURE FA-12")
               + entry("150000.00", "DBIT", "2026-12-03", "LOYER DECEMBRE")
               + entry("99000.00", "DBIT", "2026-12-04", "PRELEVEMENT A VENIR", status="PDNG")
               + "</Stmt></BkToCstmrStmt></Document>")
        status, body = self._import(xml, name="releve.xml")
        self.assertEqual(status, 200, body)
        self.assertEqual(body["created"], 2, "L'opération en attente n'est pas au relevé")
        self.assertEqual((body["balances"]["start"], body["balances"]["end"]), (2_000_000, 2_650_000))
        self.assertEqual(body["balances"]["gap"], 0)
        lines = self.env["account.bank.statement.line"].search([("journal_id", "=", self.bank.id),
                                                                ("payment_ref", "=", "LOYER DECEMBRE")])
        self.assertEqual(lines.amount, -150_000)

        status, body = self._import("<Document><Autre/></Document>", name="autre.xml")
        self.assertEqual(status, 422, body)


@tagged("post_install", "-at_install")
class TestTreasuryLoanOperations(PilotageMixin, ApiCase):
    """Types d'opération à part d'emprunt : le déblocage se comptabilise par l'opération de trésorerie
    (crédit du compte de dette du financement) ; capital et intérêts servent aux seuls mouvements hors
    échéancier et ne règlent jamais une échéance (pas de double comptabilisation)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.metrics = cls.env["eguitra.finance.metrics"]
        cls._create_user("mariama", "finance")

    def setUp(self):
        super().setUp()
        self.token = self.open_session("mariama")["access_token"]
        status, body = self.call("POST", "/finance/treasury/operation-types/defaults", token=self.token)
        self.assertEqual(status, 200, body)
        status, kinds = self.call("GET", "/finance/treasury/operation-types", token=self.token)
        self.kinds = {k["loan_part"]: k for k in kinds if k["loan_part"] != "none"}

    def _operation(self, part, amount, **extra):
        return self.call("POST", f"/finance/treasury/{self.bank.id}/lines", dict(
            {"label": f"Financement, {part}", "amount": amount, "operation_type_id": self.kinds[part]["id"]}, **extra),
            token=self.token)

    def test_types_de_financement(self):
        self.assertEqual(set(self.kinds), {"disbursement", "principal", "interest"}, "Types usuels des financements")
        self.assertEqual(self.kinds["disbursement"]["direction"], "in")
        self.assertEqual((self.kinds["principal"]["direction"], self.kinds["interest"]["direction"]), ("out", "out"))
        self.assertIsNone(self.kinds["disbursement"]["account"], "Compte du financement désigné à la saisie")
        status, body = self.call("POST", "/finance/treasury/operation-types", {
            "name": "Déblocage à l'envers", "direction": "out", "loan_part": "disbursement"}, token=self.token)
        self.assertEqual(status, 422, "Un déblocage est une entrée")

    def test_deblocage_comptabilise(self):
        loan = self.loan(principal=120_000_000, rate=12)
        self.env.flush_all()  # visible des requêtes HTTP
        self.assertAlmostEqual(self.metrics.debt_position(self.company, self.today)["schedule_gap"], -120_000_000,
                               msg="Déblocage pas encore comptabilisé")
        status, body = self._operation("disbursement", 120_000_000)
        self.assertEqual((status, body.get("fields")), (400, ["loan_id"]), "Le financement est demandé")
        draft = self.env["eguitra.loan"].create({
            "name": "Crédit en préparation", "partner_id": self.supplier.id, "principal": 10_000_000,
            "start_date": self.today, "duration_months": 12,
        })
        self.env.flush_all()
        status, body = self._operation("disbursement", 10_000_000, loan_id=draft.id)
        self.assertEqual(status, 422, "Financement en brouillon : pas encore de comptes arrêtés")

        status, line = self._operation("disbursement", 120_000_000, loan_id=loan.id)
        self.assertEqual(status, 200, line)
        self.assertTrue(line["reconciled"])
        self.assertEqual(line["amount"], 120_000_000, "Entrée de banque")
        self.assertEqual([c["code"] for c in line["counterpart"]], [self.acc_loan.code], "Crédit du compte de dette")
        self.assertEqual(line["loan"]["id"], loan.id)
        self.assertEqual(line["partner"]["id"], self.supplier.id, "Le prêteur en tiers")
        position = self.metrics.debt_position(self.company, self.today)
        self.assertAlmostEqual(position["accounting_outstanding"], 120_000_000)
        self.assertAlmostEqual(position["schedule_gap"], 0, msg="Le déblocage comptabilisé ferme l'écart")
        status, body = self._operation("disbursement", 1_000_000, loan_id=loan.id)
        self.assertEqual(status, 422, "Déblocages cumulés au-delà du montant emprunté")
        self.assertFalse(loan.line_ids.filtered("paid"), "Aucune échéance touchée")

    def test_remboursement_anticipe_et_interets_hors_echeancier(self):
        loan = self.loan(principal=120_000_000, rate=12)
        self.env.flush_all()  # visible des requêtes HTTP
        status, line = self._operation("disbursement", 120_000_000, loan_id=loan.id)
        self.assertEqual(status, 200, line)
        first = loan.line_ids[0]
        for part, amount in (("principal", first.total), ("principal", first.principal), ("interest", first.interest)):
            status, body = self._operation(part, amount, loan_id=loan.id)
            self.assertEqual(status, 422, f"{amount} : montant d'une échéance, réglée par le relevé ou « Régler »")
        status, body = self._operation("principal", 130_000_000, loan_id=loan.id)
        self.assertEqual(status, 422, "Au-delà du capital restant dû")
        status, body = self._operation("principal", 7_000_000, loan_id=loan.id, counterpart_account_id=self.acc_purchase.id)
        self.assertEqual(status, 422, "La contrepartie est le compte du financement")

        status, line = self._operation("principal", 7_000_000, loan_id=loan.id)
        self.assertEqual(status, 200, line)
        self.assertEqual(line["amount"], -7_000_000, "Sortie de banque")
        self.assertEqual([c["code"] for c in line["counterpart"]], [self.acc_loan.code], "Débit du compte de dette")
        status, line = self._operation("interest", 345_678, loan_id=loan.id)
        self.assertEqual(status, 200, line)
        self.assertEqual([c["code"] for c in line["counterpart"]], [self.acc_interest.code], "Charges financières")
        self.assertFalse(loan.line_ids.filtered("paid"), "Aucune échéance réglée par ces types")
        self.assertAlmostEqual(self.metrics.debt_position(self.company, self.today)["schedule_gap"], -7_000_000,
                               msg="Remboursement anticipé : écart signalé jusqu'à la révision de l'échéancier")

    def test_rapprochement_selon_un_type(self):
        loan = self.loan(principal=50_000_000, rate=0)
        self.env.flush_all()  # visible des requêtes HTTP
        status, line = self.call("POST", f"/finance/treasury/{self.bank.id}/lines", {
            "label": "VIR RECU BICIGUI DEBLOCAGE", "amount": 50_000_000}, token=self.token)
        self.assertEqual(status, 200, line)
        self.assertFalse(line["reconciled"])
        path = f"/finance/treasury/lines/{line['id']}/reconcile"
        status, body = self.call("POST", path, {"operation_type_id": self.kinds["principal"]["id"], "loan_id": loan.id},
                                 token=self.token)
        self.assertEqual(status, 422, "Un remboursement est une sortie : pas pour une entrée de banque")
        status, done = self.call("POST", path, {"operation_type_id": self.kinds["disbursement"]["id"], "loan_id": loan.id},
                                 token=self.token)
        self.assertEqual(status, 200, done)
        self.assertTrue(done["reconciled"])
        self.assertEqual([c["code"] for c in done["counterpart"]], [self.acc_loan.code])
        self.assertEqual(done["operation_type"]["id"], self.kinds["disbursement"]["id"])
        self.assertEqual(done["loan"]["id"], loan.id, "Le financement suit l'opération recréée")
        self.assertAlmostEqual(self.metrics.debt_position(self.company, self.today)["schedule_gap"], 0)

    def test_migration_des_types_de_financement(self):
        """La migration 19.0.1.5.0 ajoute les types des financements aux sociétés déjà équipées."""
        path = os.path.join(get_module_path("eguitra_finance"), "migrations", "19.0.1.5.0", "post-migrate.py")
        spec = importlib.util.spec_from_file_location("eguitra_finance_migration_19_0_1_5_0", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        Kind = self.env["eguitra.treasury.operation.type"].with_context(active_test=False)
        Kind.search([("company_id", "=", self.company.id), ("loan_part", "!=", "none")]).unlink()
        migration._loan_operation_types(self.env)
        parts = Kind.search([("company_id", "=", self.company.id), ("loan_part", "!=", "none")]).mapped("loan_part")
        self.assertEqual(sorted(parts), ["disbursement", "interest", "principal"])
