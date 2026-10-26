from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from ..models.period_close import pluriel
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

    def test_reevaluation_des_devises(self):
        """Banque en devise réévaluée (776/676) ; créance en devise : écart de conversion (479/478)
        extourné le mois suivant."""
        env = self.env
        usd, eur = env.ref("base.USD"), env.ref("base.EUR")
        foreign = eur if self.company.currency_id == usd else usd
        foreign.active = True
        Rate = env["res.currency.rate"]
        Rate.create({"currency_id": foreign.id, "name": self.month - relativedelta(months=1),
                     "inverse_company_rate": 8_600, "company_id": self.company.id})
        Rate.create({"currency_id": foreign.id, "name": self.end, "inverse_company_rate": 9_000,
                     "company_id": self.company.id})
        bank = env["account.journal"].create({"name": "Banque en devise DEMO", "type": "bank", "code": "BDV1",
                                              "currency_id": foreign.id, "company_id": self.company.id})
        deposit = env["account.move"].create({
            "move_type": "entry", "journal_id": bank.id, "date": self.month + relativedelta(days=1),
            "line_ids": [
                (0, 0, {"name": "Apport en devise", "account_id": bank.default_account_id.id, "currency_id": foreign.id,
                        "amount_currency": 1_000, "debit": 8_600_000}),
                (0, 0, {"name": "Apport en devise", "account_id": self.acc_services.id, "currency_id": foreign.id,
                        "amount_currency": -1_000, "credit": 8_600_000}),
            ],
        })
        deposit.action_post()
        invoice = env["account.move"].create({
            "move_type": "out_invoice", "partner_id": self.customer.id, "currency_id": foreign.id,
            "invoice_date": self.month + relativedelta(days=1),
            "invoice_line_ids": [(0, 0, {"name": "Transport en devise", "quantity": 1, "price_unit": 10_000,
                                         "account_id": self.acc_services.id, "tax_ids": [(6, 0, [])]})],
        })
        invoice.with_context(eguitra_approval_granted=True).action_post()
        self.assertAlmostEqual(invoice.amount_residual_signed, 86_000_000, 0)

        close = self._close()
        reval = close.generated_move_ids.filtered(lambda m: m.eguitra_close_kind == "fx_bank")
        self.assertTrue(reval, "Réévaluation de la banque en devise")
        self.assertAlmostEqual(self._balance(bank.default_account_id.code), 9_000_000, 0,
                               msg="1 000 au cours de clôture de 9 000")
        self.assertAlmostEqual(-self._balance("776"), 400_000, 0)
        fx = close.generated_move_ids.filtered(lambda m: m.eguitra_close_kind == "fx")
        self.assertAlmostEqual(-self._balance("479"), 4_000_000, 0, msg="Gain latent sur la créance : 10 000 × 400")
        self.assertAlmostEqual(self._balance("478"), 0, 0)
        reversal = close.generated_move_ids.filtered(lambda m: m.eguitra_close_kind == "fx_reversal")
        self.assertEqual(reversal.date, self.end + relativedelta(days=1))
        self.assertAlmostEqual(self._balance("479", self.end + relativedelta(days=1)), 0, 0, msg="Extourné le mois suivant")
        self.assertEqual(fx.line_ids.filtered(lambda line: line.partner_id).partner_id, self.customer)
        fy_start = env["eguitra.finance.metrics"].fiscal_year_bounds(self.company, self.end)[0]
        flow = env["eguitra.syscohada"].cash_flow(self.company, fy_start, self.end)
        self.assertAlmostEqual(flow["difference"], 0, 0, msg="Écart de conversion neutralisé au tableau des flux")

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

    def test_mois_non_termine_refuse(self):
        """Un mois ne se clôture qu'une fois terminé : le mois en cours, a fortiori un mois futur, est refusé."""
        Close = self.env["eguitra.period.close"]
        previous = {c["code"]: c for c in Close._get(self.company, self.month).action_check()}
        self.assertEqual(previous["month_ended"]["status"], "ok")
        for day in (self.today, self.today + relativedelta(months=2)):
            close = Close._get(self.company, day)
            checks = {c["code"]: c for c in close.action_check()}
            self.assertEqual(checks["month_ended"]["status"], "blocking", day)
            with self.assertRaises(UserError):
                close.action_close()
            self.assertEqual(close.state, "open")
        self.assertFalse(self.company.fiscalyear_lock_date, "Rien n'est verrouillé")

    def test_sceau_stable_et_complet(self):
        """Un journal ouvert après la clôture ou la société renommée ne lèvent pas le sceau ; le solde d'une
        ligne (balance, qui alimente les états) modifié seul le lève. Un sceau de la première version
        reste vérifiable à l'identique."""
        self.make_invoice("out_invoice", 100_000_000, day=self.month)
        close = self._close()
        self.assertEqual(close.seal_data.get("version"), 2)
        self.assertEqual(close._seal_hash(dict(close.seal_data, company="Autre société", vat="NIF-0000")), close.seal,
                         "L'identité de la société est hors de l'empreinte")
        legacy = close._seal_payload({key: close.seal_data[key] for key in ("company", "vat", "journals")})
        self.assertNotIn("version", legacy, "Sceau de la première version recalculé à l'identique")
        self.env["account.journal"].create({"name": "Banque ouverte après la clôture", "type": "bank", "code": "BNA9",
                                            "company_id": self.company.id})
        self.company.name = f"{self.company.name} (nouvelle raison sociale)"
        self.assertEqual(close.eguitra_verify_seal()["status"], "ok", "Ni le nouveau journal ni le nom ne lèvent le sceau")
        sealed = (close.seal, close.seal_data)
        close.sudo().write({"seal": close._seal_hash(legacy), "seal_data": legacy})
        self.assertEqual(close.eguitra_verify_seal()["status"], "ok", "Sceau de la première version")
        close.sudo().write({"seal": sealed[0], "seal_data": sealed[1]})

        line = self.env["account.move.line"].search(
            [("company_id", "=", self.company.id), ("date", "=", self.month), ("parent_state", "=", "posted")], limit=1)
        self.env.cr.execute("UPDATE account_move_line SET balance = balance + 1 WHERE id = %s", line.ids)
        self.env.invalidate_all()
        check = close.eguitra_verify_seal()
        self.assertEqual(check["status"], "altered", "Solde modifié hors de la plateforme")
        self.assertIn("contenu des écritures du mois modifié depuis la clôture", check["differences"])

    def test_provision_pour_perte_de_change_en_fin_d_exercice(self):
        """Créance en devise réglée après la fin de l'exercice, avant sa clôture : l'écart de conversion se
        calcule sur le reste dû au 31 décembre ; la clôture de décembre passe la provision pour perte de
        change (PDC), reprise le premier jour de l'exercice suivant."""
        env = self.env
        Account = env["account.account"]
        for prefix, kind in (("6971", "expense"), ("194", "liability_non_current"), ("7971", "income_other")):
            if not Account.search_count([("code", "=like", prefix + "%"), ("company_ids", "in", self.company.ids)]):
                Account.create({"code": prefix.ljust(6, "0"), "name": f"Compte {prefix} (test)", "account_type": kind,
                                "company_ids": [(6, 0, self.company.ids)]})
        fy_start = env["eguitra.finance.metrics"].fiscal_year_bounds(self.company, self.today)[0]
        end = fy_start - timedelta(days=1)
        month = end.replace(day=1)
        paid_on = end + timedelta(days=10)
        usd, eur = env.ref("base.USD"), env.ref("base.EUR")
        foreign = eur if self.company.currency_id == usd else usd
        foreign.active = True
        Rate = env["res.currency.rate"]
        for day, rate in ((month, 9_000), (end, 8_600), (paid_on, 9_000)):
            Rate.create({"currency_id": foreign.id, "name": day, "inverse_company_rate": rate, "company_id": self.company.id})
        invoice = env["account.move"].create({
            "move_type": "out_invoice", "partner_id": self.customer.id, "currency_id": foreign.id,
            "invoice_date": month + timedelta(days=1),
            "invoice_line_ids": [(0, 0, {"name": "Transport en devise", "quantity": 1, "price_unit": 10_000,
                                         "account_id": self.acc_services.id, "tax_ids": [(6, 0, [])]})],
        })
        invoice.with_context(eguitra_approval_granted=True).action_post()
        receivable = invoice.line_ids.filtered(lambda line: line.account_id.account_type == "asset_receivable")
        payment = env["account.move"].create({
            "move_type": "entry", "journal_id": self.bank.id, "date": paid_on,
            "line_ids": [(0, 0, {"name": "Règlement en devise", "account_id": receivable.account_id.id,
                                 "partner_id": self.customer.id, "currency_id": foreign.id, "amount_currency": -10_000,
                                 "credit": 90_000_000}),
                         (0, 0, {"name": "Règlement en devise", "account_id": self.bank.default_account_id.id,
                                 "debit": 90_000_000})],
        })
        payment.action_post()
        (receivable | payment.line_ids.filtered(lambda line: line.account_id == receivable.account_id)).reconcile()
        self.assertTrue(receivable.reconciled, "Réglée en janvier, avant la clôture de décembre")

        close = env["eguitra.period.close"]._get(self.company, month)
        self.assertIn("fx_provision", {g["kind"] for g in close._closing_preview()})
        close.action_close()
        moves = {kind: close.generated_move_ids.filtered(lambda m, k=kind: m.eguitra_close_kind == k)
                 for kind in ("fx", "fx_provision", "fx_provision_reversal")}
        self.assertTrue(moves["fx"], "Écart de conversion sur le reste dû au 31 décembre")
        self.assertAlmostEqual(self._balance("478", end), 4_000_000, 0, msg="10 000 × (9 000 - 8 600)")
        provision = moves["fx_provision"]
        self.assertEqual((provision.date, provision.ref), (end, f"PDC-{month:%m/%Y}"))
        self.assertAlmostEqual(sum(provision.line_ids.filtered(lambda l: l.account_id.code.startswith("697")).mapped("debit")),
                               4_000_000, 0, msg="Dotation aux provisions financières")
        self.assertAlmostEqual(-self._balance("194", end), 4_000_000, 0, msg="Provision pour pertes de change")
        reversal = moves["fx_provision_reversal"]
        self.assertEqual(reversal.date, end + timedelta(days=1), "Reprise au premier jour de l'exercice suivant")
        self.assertAlmostEqual(self._balance("194", end + timedelta(days=1)), 0, 0)
        self.assertAlmostEqual(-self._balance("797", end + timedelta(days=1)), 4_000_000, 0, msg="Reprise en 797")
        previous_start = env["eguitra.finance.metrics"].fiscal_year_bounds(self.company, end)[0]
        flow = env["eguitra.syscohada"].cash_flow(self.company, previous_start, end)
        self.assertAlmostEqual(flow["difference"], 0, 0, msg="La provision (194) ne fausse pas le tableau des flux")

    def test_credit_de_tva_sans_compte_4449(self):
        """Sans compte de crédit à reporter (4449), la liquidation garde le crédit au 445 et reste équilibrée,
        même quand un compte 445 est créditeur."""
        Account = self.env["account.account"]
        Account.search([("code", "=like", "4449%"), ("company_ids", "in", self.company.ids)]).write({"active": False})
        self.make_invoice("out_invoice", 10_000_000, day=self.month)  # TVA collectée 1,8 M
        bill = self.make_invoice("in_invoice", 50_000_000, day=self.month)  # TVA récupérable 9 M
        deductible = bill.line_ids.filtered(lambda line: line.tax_line_id).account_id
        other = Account.search([("code", "=like", "445%"), ("company_ids", "in", self.company.ids),
                                ("id", "!=", deductible.id)], order="code", limit=1)
        other = other or Account.create({"code": "445800", "name": "TVA récupérable (test)",
                                         "account_type": "asset_current", "company_ids": [(6, 0, self.company.ids)]})
        journal = self.env["account.journal"].search(
            [("company_id", "=", self.company.id), ("type", "=", "general"), ("code", "!=", "AN")], limit=1)
        self.env["account.move"].create({
            "move_type": "entry", "journal_id": journal.id, "date": self.month + relativedelta(days=3),
            "line_ids": [(0, 0, {"name": "Régularisation de TVA", "account_id": self.acc_purchase.id, "debit": 1_000_000}),
                         (0, 0, {"name": "Régularisation de TVA", "account_id": other.id, "credit": 1_000_000})],
        }).action_post()
        close = self._close()
        vat = close.generated_move_ids.filtered(lambda m: m.eguitra_close_kind == "vat")
        self.assertEqual(vat.state, "posted", "Liquidation équilibrée et validée")
        self.assertAlmostEqual(sum(vat.line_ids.mapped("debit")), sum(vat.line_ids.mapped("credit")), 2)
        self.assertFalse(vat.line_ids.filtered(lambda line: line.account_id.code.startswith("4441")), "Pas de TVA due")
        self.assertAlmostEqual(self._balance("443"), 0, 2, msg="TVA collectée soldée")
        self.assertAlmostEqual(self._balance(other.code), 0, 2, msg="445 créditeur soldé")
        self.assertAlmostEqual(self._balance("445"), 9_000_000 - 1_000_000 - 1_800_000, 2, msg="Crédit gardé au 445")

    def test_messages_accordes_au_nombre(self):
        """Messages des contrôles accordés au nombre, jamais « (s) »."""
        self.assertEqual([pluriel(n, "pièce") for n in (0, 1, 2)], ["0 pièce", "1 pièce", "2 pièces"])
        self.assertEqual(pluriel(1500, "ligne de relevé", "lignes de relevé"), "1 500 lignes de relevé")
        self.make_invoice("out_invoice", 1_000_000, day=self.month, post=False)
        checks = self.env["eguitra.period.close"]._get(self.company, self.month).action_check()
        drafts = next(c for c in checks if c["code"] == "draft_moves")
        self.assertTrue(drafts["detail"].startswith("1 pièce en brouillon jusqu'au"), drafts["detail"])
        self.assertNotIn("(s)", " ".join(c["detail"] or "" for c in checks))
