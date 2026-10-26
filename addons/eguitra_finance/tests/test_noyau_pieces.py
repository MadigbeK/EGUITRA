import io
from datetime import timedelta

from odoo import Command
from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestNoyauPieces(FinanceDataMixin, ApiCase):
    """Pièces, tiers et rapports (audits du noyau et de l'application web) : saisies mal formées refusées en
    400 (M3), journal des à-nouveaux (M6), avoir daté (I-F13), retenue gardée en exonération (I-F14), dépense
    en devise convertie en OD refusée (C3), délai de paiement strict (C1 web), états de paiement en clair et
    export en GET (M2, I-C7)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("compta.np", "finance")
        cls._create_user("dg.np", "direction")
        cls._create_user("parc.np", "exploitation")
        env = cls.env
        cls.opening = env["account.journal"].search([("company_id", "=", cls.company.id), ("code", "=", "AN")], limit=1) \
            or env["account.journal"].create({"name": "À-nouveaux", "code": "AN", "type": "general",
                                              "company_id": cls.company.id})
        cls.usd = env.ref("base.USD")
        cls.usd.active = True

    def setUp(self):
        super().setUp()
        self.token = self.open_session("compta.np")["access_token"]

    def test_saisies_mal_formees_refusees(self):
        status, body = self.call("POST", "/finance/moves", {
            "move_type": "out_invoice", "partner_id": "abc", "lines": [{"name": "Transport", "price_unit": 1}],
        }, token=self.token)
        self.assertEqual((status, body.get("error")), (400, "invalid_parameter"), body)
        invoice = self.make_invoice("out_invoice", 1_000_000)
        status, body = self.call("POST", f"/finance/moves/{invoice.id}/payments", {"journal_id": "banque"}, token=self.token)
        self.assertEqual((status, body.get("error")), (400, "invalid_parameter"), body)
        status, body = self.call("POST", f"/finance/treasury/{self.bank.id}/lines", {"label": "Essai", "amount": "NaN"},
                                 token=self.token)
        self.assertEqual((status, body.get("error")), (400, "invalid_parameter"), "« NaN » n'est pas un montant")

    def test_journal_des_a_nouveaux_au_premier_jour_de_l_exercice(self):
        lines = [{"account_id": self.acc_purchase.id, "debit": 1_000_000, "name": "Reprise"},
                 {"account_id": self.acc_loan.id, "credit": 1_000_000, "name": "Reprise"}]
        status, body = self.call("POST", "/finance/moves", {
            "move_type": "entry", "journal_id": self.opening.id, "date": self.today.replace(month=6, day=15).isoformat(),
            "lines": lines}, token=self.token)
        self.assertEqual((status, body.get("error")), (422, "business_rule"), body)
        status, body = self.call("POST", "/finance/moves", {
            "move_type": "entry", "journal_id": self.opening.id, "date": self.today.replace(month=1, day=1).isoformat(),
            "lines": lines}, token=self.token)
        self.assertEqual(status, 200, "Correction d'un solde d'ouverture, au premier jour de l'exercice")

    def test_avoir_date_et_validable(self):
        invoice = self.make_invoice("out_invoice", 2_000_000)
        status, refund = self.call("POST", f"/finance/moves/{invoice.id}/reverse", {"reason": "Erreur de tarif"},
                                   token=self.token)
        self.assertEqual(status, 200, refund)
        self.assertEqual(refund["invoice_date"], self.today.isoformat(), "L'avoir porte sa date de facture")
        status, posted = self.call("POST", f"/finance/moves/{refund['id']}/post", token=self.token)
        self.assertEqual((status, posted["state"]), (200, "posted"), posted)

    def test_retenue_gardee_en_exoneration(self):
        self.customer.eguitra_vat_exempt = True
        retenue = self.env["account.tax"].create({
            "name": "Retenue (essai)", "amount": -5, "amount_type": "percent", "type_tax_use": "sale",
            "company_id": self.company.id,
        })
        invoice = self.env["account.move"].create({
            "move_type": "out_invoice", "partner_id": self.customer.id, "invoice_date": self.today,
            "invoice_line_ids": [Command.create({"name": "Prestation", "price_unit": 10_000_000,
                                                 "account_id": self.acc_services.id,
                                                 "tax_ids": [Command.set((self.tax_sale | retenue).ids)]})],
        })
        taxes = invoice.invoice_line_ids.tax_ids
        self.assertIn(retenue, taxes, "La retenue à la source reste sur la facture d'un client exonéré")
        self.assertNotIn(self.tax_sale, taxes, "La TVA, elle, passe en exonération")
        self.assertEqual(invoice.amount_total, 9_500_000)

    def test_depense_convertie_en_devise_refusee(self):
        category = self.env["eguitra.expense.category"].create({
            "name": "Salaires (devise)", "nature": "personnel", "account_id": self.acc_purchase.id,
            "partner_account_id": self.env["account.account"].search(
                [("code", "=like", "422%"), ("company_ids", "in", self.company.ids)], limit=1).id,
            "tax_mode": "none", "company_id": self.company.id,
        })
        status, body = self.call("POST", "/finance/moves", {
            "move_type": "in_invoice", "partner_id": self.supplier.id, "currency_id": self.usd.id,
            "lines": [{"name": "Salaires en dollars", "price_unit": 1_000, "category_id": category.id}],
        }, token=self.token)
        self.assertEqual((status, body.get("error")), (422, "business_rule"), "1 000 USD comptés 1 000 GNF : refusé")

    def test_virement_vers_un_compte_en_devise_refuse(self):
        usd_bank = self.env["account.journal"].create({"name": "Banque en dollars", "type": "bank", "code": "BUSD",
                                                       "currency_id": self.usd.id, "company_id": self.company.id})
        status, body = self.call("POST", "/finance/transfers", {
            "from_journal_id": self.bank.id, "to_journal_id": usd_bank.id, "amount": 5_000_000}, token=self.token)
        self.assertEqual((status, body.get("error")), (422, "business_rule"), body)
        status, line = self.call("POST", f"/finance/treasury/{usd_bank.id}/lines", {"label": "Apport", "amount": 500},
                                 token=self.token)
        self.assertEqual((status, line["currency"]), (200, "USD"), "Le montant d'une opération est dans la devise du compte")

    def test_delai_de_paiement_strict(self):
        for term in ({"days": None}, {"days": ""}, {"days": "30 j"}, {"days": 2.5}):
            status, body = self.call("PATCH", f"/finance/partners/{self.customer.id}", {"payment_term": term},
                                     token=self.token)
            self.assertEqual((status, body.get("error")), (400, "invalid_parameter"), (term, body))
        status, body = self.call("PATCH", f"/finance/partners/{self.customer.id}", {"credit_limit": -5}, token=self.token)
        self.assertEqual(status, 422, body)
        status, body = self.call("PATCH", f"/finance/partners/{self.customer.id}", {"payment_term": {"days": 30}},
                                 token=self.token)
        self.assertEqual(status, 200, body)
        for login in ("dg.np", "parc.np"):
            token = self.open_session(login)["access_token"]
            status, body = self.call("PATCH", f"/finance/partners/{self.customer.id}", {"payment_term": {"days": 0}},
                                     token=token)
            self.assertEqual((status, body.get("error")), (403, "forbidden"), (login, body))

    def test_etats_de_paiement_en_clair_et_export_en_get(self):
        self.make_invoice("out_invoice", 3_000_000)
        status, result = self.call("POST", "/finance/reports/run", {"report": "ventes", "period": "month"}, token=self.token)
        self.assertEqual(status, 200, result)
        self.assertIn("Non payée", {row["paiement"] for row in result["rows"]})
        self.assertNotIn("not_paid", {row["paiement"] for row in result["rows"]})
        query = "report=ventes&period=month&format=csv&filters=%7B%22paiement%22%3A%22not_paid%22%7D"
        response = self.url_open(f"/api/v1/finance/reports/export?{query}",
                                 headers={"Authorization": f"Bearer {self.token}", "X-Eguitra-App": "test"}, timeout=60)
        self.assertEqual(response.status_code, 200, response.text)
        text = response.content.decode("utf-8")
        self.assertIn("Non payée", text)
        self.assertNotIn("not_paid", text)
        token = self.open_session("parc.np")["access_token"]
        response = self.url_open(f"/api/v1/finance/reports/export?{query}",
                                 headers={"Authorization": f"Bearer {token}", "X-Eguitra-App": "test"}, timeout=60)
        self.assertEqual(response.status_code, 403, "États réservés à la finance et à la direction")


@tagged("post_install", "-at_install")
class TestNoyauTresorerieRelances(FinanceDataMixin, ApiCase):
    """Trésorerie et relances (audits du noyau et de l'application web) : relevé CSV lu sans erreur de
    séparateur et refusé s'il a des lignes illisibles (I-F10), soldes d'un relevé clôturé figés (M6),
    relances en monnaie de la société et sur le solde net (C5, I-F16), relance envoyée une seule fois (I-C6)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("tresor.nt", "finance")
        cls._create_user("dg.nt", "direction")

    def setUp(self):
        super().setUp()
        self.token = self.open_session("tresor.nt")["access_token"]

    def _import(self, content):
        response = self.url_open(
            f"/api/v1/finance/treasury/{self.bank.id}/import",
            files={"file": ("releve.csv", io.BytesIO(content.encode()), "text/csv")},
            headers={"Authorization": f"Bearer {self.token}"}, method="POST", timeout=60)
        return response.status_code, response.json()

    def test_releve_aux_milliers_par_points_et_lignes_illisibles(self):
        status, body = self._import(
            "Date;Libellé;Débit;Crédit\n"
            "02/10/2026;VIREMENT RECU;;150.000\n"
            "03/10/2026;VIREMENT RECU GROS;;1,500,000\n"
            "Total;;;\n")
        self.assertEqual((status, body.get("created")), (200, 2), body)
        lines = self.env["account.bank.statement.line"].search([("journal_id", "=", self.bank.id)])
        self.assertEqual(sorted(lines.mapped("amount")), [150_000, 1_500_000], "« 150.000 » vaut 150 000, pas 150")
        status, body = self._import(
            "Date;Libellé;Débit;Crédit\n"
            "05/10/2026;FRAIS;25 000,00;\n"
            "06/10/2026;ILLISIBLE;12.3456;\n")
        self.assertEqual((status, body.get("error")), (422, "statement_unreadable"), body)
        self.assertIn("ligne 3", body["message"])

    def test_soldes_d_un_releve_cloture_figes(self):
        status, body = self._import("Date;Libellé;Montant\n02/01/2026;VIREMENT;100 000\n")
        self.assertEqual(status, 200, body)
        statement = self.env["account.bank.statement"].browse(body["statement"]["id"])
        self.env.cr.execute("UPDATE res_company SET fiscalyear_lock_date = %s WHERE id = %s",
                            (statement.date + timedelta(days=1), self.company.id))
        self.company.invalidate_recordset(["fiscalyear_lock_date"])
        status, body = self.call("PATCH", f"/finance/treasury/statements/{statement.id}", {"balance_start": 5},
                                 token=self.token)
        self.assertEqual((status, body.get("error")), (422, "business_rule"), body)

    def test_relance_en_devise_et_sur_le_solde_net(self):
        usd = self.env.ref("base.USD")
        usd.active = True
        self.env["res.currency.rate"].create({"currency_id": usd.id, "name": self.today - timedelta(days=60),
                                              "inverse_company_rate": 8_600, "company_id": self.company.id})
        late = self.today - timedelta(days=40)
        invoice = self.env["account.move"].create({
            "move_type": "out_invoice", "partner_id": self.customer.id, "invoice_date": late, "invoice_date_due": late,
            "currency_id": usd.id,
            "invoice_line_ids": [Command.create({"name": "Transport", "price_unit": 1_000, "account_id": self.acc_services.id,
                                                 "tax_ids": [Command.set([])]})],
        })
        invoice.with_context(eguitra_approval_granted=True).action_post()
        Reminder = self.env["eguitra.reminder"]
        mine = Reminder.generate(self.company, self.today).filtered(lambda r: r.partner_id == self.customer)
        self.assertAlmostEqual(mine.amount_due, 8_600_000, delta=1, msg="1 000 USD relancés en GNF, pas « 1 000 GNF »")
        self.assertEqual(mine.letter()["invoices"][0]["residual"], mine.amount_due)
        mine.state = "cancelled"
        self.assertFalse(Reminder.generate(self.company, self.today).filtered(lambda r: r.partner_id == self.customer),
                         "Une relance annulée n'est pas recréée la nuit suivante")

        other = self.env["res.partner"].create({"name": "Client couvert par un avoir"})
        self.make_invoice("out_invoice", 1_000_000, day=late, due=late, partner=other)
        self.make_invoice("out_refund", 1_000_000, partner=other)
        self.assertFalse(Reminder.generate(self.company, self.today).filtered(lambda r: r.partner_id == other),
                         "Solde net nul : aucune relance")

    def test_relance_envoyee_une_seule_fois(self):
        late = self.today - timedelta(days=40)
        self.make_invoice("out_invoice", 5_000_000, day=late, due=late)
        reminder = self.env["eguitra.reminder"].generate(self.company, self.today).filtered(
            lambda r: r.partner_id == self.customer)
        self.env.flush_all()
        token = self.open_session("dg.nt")["access_token"]
        status, body = self.call("POST", f"/finance/reminders/{reminder.id}/send", {"channel": "letter"}, token=token)
        self.assertEqual((status, body.get("error")), (403, "forbidden"), "La direction consulte les relances")
        status, body = self.call("POST", f"/finance/reminders/{reminder.id}/send", {"channel": "letter"}, token=self.token)
        self.assertEqual((status, body["state"]), (200, "sent"), body)
        status, body = self.call("POST", f"/finance/reminders/{reminder.id}/send", {"channel": "letter"}, token=self.token)
        self.assertEqual((status, body.get("error")), (422, "business_rule"), body)
        self.assertIn("déjà envoyée", body["message"])

    def test_litige_sur_une_creance_reprise(self):
        journal = self.env["account.journal"].search([("company_id", "=", self.company.id), ("type", "=", "general")],
                                                     limit=1)
        entry = self.env["account.move"].create({
            "move_type": "entry", "journal_id": journal.id, "ref": "Reprise FAC-2025-118",
            "line_ids": [
                Command.create({"name": "Facture 118", "account_id": self.customer.property_account_receivable_id.id,
                                "partner_id": self.customer.id, "debit": 4_000_000}),
                Command.create({"name": "Reprise", "account_id": self.acc_services.id, "credit": 4_000_000}),
            ],
        })
        entry.with_context(eguitra_approval_granted=True).action_post()
        self.env.flush_all()
        status, body = self.call("POST", f"/finance/moves/{entry.id}/dispute", {"dispute": True, "reason": "Contestée"},
                                 token=self.token)
        self.assertEqual((status, body.get("dispute")), (200, True), body)
