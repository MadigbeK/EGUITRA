from dateutil.relativedelta import relativedelta

from odoo.tests import TransactionCase, tagged

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestClosingComplete(FinanceDataMixin, TransactionCase):
    """Clôture complète : dotations, liquidation de la TVA, instantané, sceau et PV."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.month = cls.today.replace(day=1) - relativedelta(months=1)
        cls.end = cls.month + relativedelta(months=1, days=-1)

    def _balance(self, prefix, day=None):
        return self.env["eguitra.finance.metrics"]._sum_balance(self.company, [prefix], None, day or self.end)

    def _close(self):
        close = self.env["eguitra.period.close"]._get(self.company, self.month)
        close.action_close()
        return close

    def test_liquidation_de_la_tva_et_sceau(self):
        self.make_invoice("out_invoice", 100_000_000, day=self.month)
        self.make_invoice("in_invoice", 40_000_000, day=self.month)
        close = self.env["eguitra.period.close"]._get(self.company, self.month)
        preview = {g["kind"]: g for g in close._closing_preview()}
        self.assertEqual(preview["vat"]["amount"], 10_800_000, "TVA due annoncée avant la clôture")

        close.action_close()
        self.assertEqual(close.state, "closed")
        vat = close.generated_move_ids.filtered(lambda m: m.eguitra_close_kind == "vat")
        self.assertEqual(vat.ref, f"TVA-{self.month:%m/%Y}")
        self.assertEqual(vat.date, self.end, "Liquidation datée du dernier jour du mois, dans la période scellée")
        self.assertAlmostEqual(self._balance("443"), 0, 2, msg="TVA collectée soldée")
        self.assertAlmostEqual(self._balance("445"), 0, 2, msg="TVA récupérable soldée")
        due = vat.line_ids.filtered(lambda line: line.account_id.code.startswith("4441"))
        self.assertAlmostEqual(due.credit, 10_800_000, 2)
        self.assertEqual(due.date_maturity, self.end + relativedelta(days=15), "Échéance au 15 du mois suivant")
        vat_return = self.env["eguitra.tax.return"].search(
            [("company_id", "=", self.company.id), ("period", "=", self.month), ("kind", "=", "vat")])
        self.assertEqual(vat_return.settlement_move_id, vat, "La déclaration du mois pointe sa liquidation")
        self.assertEqual(vat_return.amount_due, 10_800_000)

        self.assertEqual(len(close.seal or ""), 64, "Sceau SHA-256")
        self.assertTrue(close.snapshot["generated"])
        self.assertAlmostEqual(close.snapshot["total_debit"], close.snapshot["total_credit"], 2)
        self.assertEqual(close.eguitra_verify_seal()["status"], "ok")
        html = self.env["ir.actions.report"]._render_qweb_html("eguitra_finance.action_report_period_close", close.ids)[0]
        self.assertIn(close.seal, html.decode())

        # Une écriture du mois modifiée hors de la plateforme lève le sceau.
        invoice_line = self.env["account.move.line"].search(
            [("company_id", "=", self.company.id), ("date", "=", self.month), ("parent_state", "=", "posted")], limit=1)
        self.env.cr.execute("UPDATE account_move_line SET name = 'modifié hors plateforme' WHERE id = %s", invoice_line.ids)
        self.env.invalidate_all()
        check = close.eguitra_verify_seal()
        self.assertEqual(check["status"], "altered")
        self.assertTrue(check["differences"])

    def test_credit_de_tva_reporte(self):
        self.make_invoice("out_invoice", 10_000_000, day=self.month)
        self.make_invoice("in_invoice", 50_000_000, day=self.month)
        close = self._close()
        vat = close.generated_move_ids.filtered(lambda m: m.eguitra_close_kind == "vat")
        self.assertTrue(vat)
        self.assertFalse(vat.line_ids.filtered(lambda line: line.account_id.code.startswith("4441")), "Pas de TVA due")
        credit = self._balance("4449") or self._balance("445")
        self.assertAlmostEqual(credit, 9_000_000 - 1_800_000, 2, msg="Crédit de TVA reporté (4449, sinon 445)")

    def test_reouverture_puis_complement(self):
        self.make_invoice("out_invoice", 100_000_000, day=self.month)
        close = self._close()
        first_seal = close.seal
        close.action_reopen("Facture de transport oubliée")
        self.assertFalse(close.seal)
        self.assertEqual(close.event_ids[:1].seal, first_seal, "La réouverture garde le sceau levé")
        self.make_invoice("out_invoice", 50_000_000, day=self.month)
        close.action_close()
        vats = close.generated_move_ids.filtered(lambda m: m.eguitra_close_kind == "vat")
        self.assertEqual(len(vats), 2, "Seul le complément est liquidé")
        self.assertAlmostEqual(-self._balance("4441"), 27_000_000, 2)
        self.assertNotEqual(close.seal, first_seal)

    def test_dotations_du_mois_a_la_cloture(self):
        def account(prefix):
            return self.env["account.account"].search(
                [("code", "=like", prefix + "%"), ("company_ids", "in", self.company.ids)], limit=1, order="code")

        journal = self.env["account.journal"].search([("company_id", "=", self.company.id), ("type", "=", "general")],
                                                     limit=1)
        profile = self.env["account.asset.profile"].create({
            "name": "Matériel de transport", "account_asset_id": account("2451").id,
            "account_depreciation_id": account("2845").id, "account_expense_depreciation_id": account("6813").id,
            "journal_id": journal.id, "method": "linear", "method_number": 5, "method_period": "month",
            "prorata": True, "company_id": self.company.id,
        })
        asset = self.env["account.asset"].create({
            "name": "Citerne DEMO", "profile_id": profile.id, "purchase_value": 600_000_000,
            "date_start": self.month, "company_id": self.company.id,
        })
        asset.compute_depreciation_board()
        asset.validate()
        close = self.env["eguitra.period.close"]._get(self.company, self.month)
        checks = {c["code"]: c for c in close.action_check()}
        self.assertEqual(checks["depreciation_posted"]["status"], "warning", "Annoncée, la clôture la comptabilise")
        close.action_close()
        line = asset.depreciation_line_ids.filtered(lambda l: l.type == "depreciate" and l.line_date == self.end)
        self.assertTrue(line.move_check, "Dotation du mois comptabilisée par la clôture")
        final = {c["code"]: c for c in close.last_check["checks"]}
        self.assertEqual(final["depreciation_posted"]["status"], "ok", "Contrôle refait après les générations")
        self.assertAlmostEqual(close.snapshot["depreciations"], line.amount, 2)
