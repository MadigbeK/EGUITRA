import io
from datetime import timedelta

from odoo.tests import tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestFinanceApi(FinanceDataMixin, ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("fatou", "finance")
        cls._create_user("ibrahima", "exploitation")

    def setUp(self):
        super().setUp()
        self.token = self.open_session("fatou")["access_token"]

    def test_profil_exploitation_sans_tableau_de_bord(self):
        token = self.open_session("ibrahima")["access_token"]
        status, _b = self.call("GET", "/finance/dashboard", token=token)
        self.assertEqual(status, 403)

    def test_tiers_choisis_par_les_metiers_et_le_cabinet(self):
        """Sélecteur de tiers des chantiers, de l'immobilier, du parc et du cabinet : liste et création,
        sans les soldes réservés à la finance."""
        for login, profile, app in (("chef.chantier", "chantiers", "finance"), ("gestion.immo", "immobilier", "finance"),
                                    ("ibrahima", "exploitation", "finance"), ("consultant", "cabinet", "axispro")):
            if login == "consultant":  # un profil du cabinet exige la société MB AxisPro Consulting
                cabinet = self.env["res.company"].search([("eguitra_entity", "=", "cabinet")], limit=1)
                self._create_user(login, profile, company_id=cabinet.id, company_ids=[(6, 0, cabinet.ids)])
            elif login != "ibrahima":
                self._create_user(login, profile)
            token = self.open_session(login, app=app)["access_token"]
            status, body = self.call("GET", "/finance/partners?limit=5", token=token)
            self.assertEqual(status, 200, (profile, body))
            self.assertTrue(body["items"])
            self.assertIsNone(body["items"][0]["receivable"], "Soldes réservés à la finance")
            status, created = self.call("POST", "/finance/partners", {"name": f"Tiers de {login}", "customer": True,
                                                                     "credit_limit": 1_000_000}, token=token)
            self.assertEqual(status, 200, (profile, created))
            partner = self.env["res.partner"].browse(created["id"])
            self.assertFalse(partner.use_partner_credit_limit, "Limite de crédit fixée par la finance seule")
            self.assertEqual(partner.create_uid.login, login, "L'auteur de la fiche reste l'utilisateur")
        status, body = self.call("GET", "/finance/partners?limit=5", token=self.token)
        self.assertIn("receivable", body["items"][0])
        self.assertIsNotNone(body["items"][0]["receivable"], "La finance voit les soldes")
        status, updated = self.call("PATCH", f"/finance/partners/{partner.id}", {"credit_limit": 5_000_000, "phone": "620000001"},
                                    token=self.token)
        self.assertEqual(status, 200, updated)
        self.assertEqual(updated["credit_limit"], 5_000_000, "La finance tient les fiches des tiers et leurs limites")

    def test_facture_de_vente_complete(self):
        status, move = self.call("POST", "/finance/moves", {
            "move_type": "out_invoice",
            "partner_id": self.customer.id,
            "lines": [{"name": "Transport gasoil Conakry - Kankan", "quantity": 2, "price_unit": 150_000_000,
                       "account_id": self.acc_services.id}],
        }, token=self.token)
        self.assertEqual(status, 200, move)
        self.assertEqual(move["state"], "draft")
        self.assertEqual(move["amount_untaxed"], 300_000_000)
        self.assertEqual(move["amount_total"], 354_000_000, "TVA 18 % appliquée par défaut")

        status, posted = self.call("POST", f"/finance/moves/{move['id']}/post", token=self.token)
        self.assertEqual(status, 200, posted)
        self.assertEqual(posted["state"], "posted")
        self.assertTrue(posted["name"])

        status, paid = self.call("POST", f"/finance/moves/{move['id']}/payments", {
            "journal_id": self.bank.id, "amount": 154_000_000,
        }, token=self.token)
        self.assertEqual(status, 200, paid)
        self.assertEqual(paid["payment_state"], "partial")
        self.assertEqual(paid["amount_residual"], 200_000_000)

        status, listing = self.call("GET", "/finance/moves?type=out_invoice", token=self.token)
        self.assertEqual(status, 200)
        self.assertIn(move["id"], [m["id"] for m in listing["items"]])

        status, dashboard = self.call("GET", "/finance/dashboard", token=self.token)
        self.assertEqual(status, 200, dashboard)
        self.assertEqual(dashboard["revenue_month"], 300_000_000)
        self.assertEqual(dashboard["receivables"]["total"], 200_000_000)

    def test_od_desequilibree_refusee(self):
        status, body = self.call("POST", "/finance/moves", {
            "move_type": "entry", "journal_id": self.bank.id,
            "lines": [
                {"account_id": self.acc_purchase.id, "debit": 100},
                {"account_id": self.bank.default_account_id.id, "credit": 90},
            ],
        }, token=self.token)
        self.assertEqual(status, 422)
        self.assertIn("déséquilibrée", body["message"])

    def test_virement_interne_par_585(self):
        status, body = self.call("POST", "/finance/transfers", {
            "from_journal_id": self.bank.id, "to_journal_id": self.cash.id, "amount": 25_000_000,
        }, token=self.token)
        self.assertEqual(status, 200, body)
        self.assertEqual(len(body["moves"]), 2)
        transit = self.env["eguitra.finance.metrics"]._sum_balance(self.company, ["585"], None, self.today)
        self.assertEqual(transit, 0.0, "Le compte de passage est soldé après les deux écritures")
        status, position = self.call("GET", "/finance/treasury", token=self.token)
        balances = {a["journal_id"]: a["balance"] for a in position["accounts"]}
        self.assertEqual(balances[self.cash.id], 25_000_000)

    def test_caisse_et_rapprochement(self):
        invoice = self.make_invoice("out_invoice", 100_000_000)
        status, line = self.call("POST", f"/finance/treasury/{self.bank.id}/lines", {
            "label": f"VIR TOTAL {invoice.name}", "amount": 118_000_000, "partner_id": self.customer.id,
        }, token=self.token)
        self.assertEqual(status, 200, line)
        self.assertFalse(line["reconciled"])

        status, candidates = self.call("GET", f"/finance/treasury/lines/{line['id']}/candidates", token=self.token)
        self.assertEqual(status, 200)
        self.assertEqual(candidates[0]["move_id"], invoice.id, "La facture citée et au bon montant vient en tête")

        status, done = self.call("POST", f"/finance/treasury/lines/{line['id']}/reconcile",
                                 {"move_line_ids": [candidates[0]["id"]]}, token=self.token)
        self.assertEqual(status, 200, done)
        self.assertTrue(done["reconciled"])
        self.assertEqual(invoice.payment_state, "paid")

        status, fee = self.call("POST", f"/finance/treasury/{self.cash.id}/lines", {
            "label": "Frais de mission", "amount": -1_500_000, "counterpart_account_id": self.acc_purchase.id,
        }, token=self.token)
        self.assertEqual(status, 200, fee)
        self.assertTrue(fee["reconciled"], "Une opération imputée directement est soldée")

    def test_import_releve_csv(self):
        content = (
            "Date;Libellé;Débit;Crédit\n"
            "02/10/2026;VIREMENT RECU TOTAL;;118 000 000\n"
            "03/10/2026;FRAIS DE TENUE DE COMPTE;25 000,00;\n"
        ).encode()
        response = self.url_open(
            f"/api/v1/finance/treasury/{self.bank.id}/import",
            files={"file": ("releve.csv", io.BytesIO(content), "text/csv")},
            headers={"Authorization": f"Bearer {self.token}"},
            method="POST",
            timeout=60,
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["created"], 2)
        response = self.url_open(
            f"/api/v1/finance/treasury/{self.bank.id}/import",
            files={"file": ("releve.csv", io.BytesIO(content), "text/csv")},
            headers={"Authorization": f"Bearer {self.token}"},
            method="POST",
            timeout=60,
        )
        self.assertEqual(response.json()["skipped_duplicates"], 2, "Un relevé importé deux fois n'est pas dupliqué")

    def test_rapports_et_export(self):
        self.make_invoice("out_invoice", 70_000_000)
        status, catalog = self.call("GET", "/finance/reports/catalog", token=self.token)
        self.assertEqual(status, 200)
        keys = {r["key"] for g in catalog["groups"] for r in g["reports"]}
        self.assertTrue({"grand_livre", "balance", "ventes", "tva"} <= keys)
        status, result = self.call("POST", "/finance/reports/run", {"report": "ventes", "period": "month"}, token=self.token)
        self.assertEqual(status, 200, result)
        self.assertEqual(result["totals"]["ht"], 70_000_000)
        response = self.url_open("/api/v1/finance/reports/export", json={"report": "balance", "format": "xlsx"},
                                 headers={"Authorization": f"Bearer {self.token}"}, method="POST", timeout=60)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"PK"))

    def test_etats_et_tva(self):
        self.make_invoice("out_invoice", 100_000_000)
        self.make_invoice("in_invoice", 40_000_000)
        status, vat = self.call("GET", f"/finance/fiscal/vat?year={self.today.year}&month={self.today.month}",
                                token=self.token)
        self.assertEqual(status, 200, vat)
        self.assertEqual(vat["vat_collected"], 18_000_000)
        self.assertEqual(vat["vat_deductible"], 7_200_000)
        self.assertEqual(vat["vat_due"], 10_800_000)
        status, sheet = self.call("GET", "/finance/statements/balance-sheet", token=self.token)
        self.assertEqual(status, 200)
        self.assertEqual(sheet["difference"], 0)
        status, ifrs = self.call("GET", "/finance/ifrs", token=self.token)
        self.assertEqual(status, 200)
        self.assertTrue(ifrs["lines"])

    def test_cloture_par_api(self):
        status, registry = self.call("GET", f"/finance/closing?year={self.today.year}", token=self.token)
        self.assertEqual(status, 200)
        self.assertEqual(len(registry["months"]), 12)
        status, check = self.call("POST", "/finance/closing/check",
                                  {"period": self.today.replace(day=1).isoformat()}, token=self.token)
        self.assertEqual(status, 200, check)
        self.assertIn("checks", check)

    def test_controles_d_integrite(self):
        """Empreintes recalculées par le noyau : intactes après verrouillage, altération signalée."""
        invoice = self.make_invoice(day=self.today - timedelta(days=1))
        journal = invoice.journal_id.sudo()
        journal.restrict_mode_hash_table = True
        self.env["account.secure.entries.wizard"].sudo().create(
            {"company_id": self.company.id, "hash_date": self.today}).action_secure_entries()
        self.assertTrue(invoice.inalterable_hash)
        status, body = self.call("GET", "/finance/integrity", token=self.token)
        self.assertEqual(status, 200, body)
        self.assertTrue(body["checks"])
        self.assertIn("verified", [c["status"] for c in body["hash_chains"]])
        self.env.cr.execute("UPDATE account_move_line SET name = 'modifié hors plateforme' WHERE move_id = %s", invoice.ids)
        self.env.invalidate_all()
        status, body = self.call("GET", "/finance/integrity", token=self.token)
        self.assertIn("corrupted", [c["status"] for c in body["hash_chains"]], "Écriture modifiée en base signalée")
        self._create_user("dg", "direction")
        status, body = self.call("GET", "/finance/integrity", token=self.open_session("dg")["access_token"])
        self.assertEqual(status, 200, body)
        self.assertIsNone(body["hash_chains"], "La direction voit les contrôles, la vérification reste aux comptables")

    def test_nouveau_compte_de_tresorerie(self):
        self._create_user("aissatou", "admin")
        token = self.open_session("aissatou")["access_token"]
        payload = {"name": "Banque de démonstration", "type": "bank", "code": "bdm1", "bank_account_number": "GN0001"}
        status, journal = self.call("POST", "/finance/treasury/journals", payload, token=token)
        self.assertEqual(status, 200, journal)
        self.assertEqual(journal["code"], "BDM1")
        self.assertTrue(journal["account"].startswith("52"), "Compte de banque en 52")
        status, body = self.call("POST", "/finance/treasury/journals", payload, token=token)
        self.assertEqual((status, body["error"]), (409, "conflict"), "Code déjà pris : refus explicite")
        status, _b = self.call("POST", "/finance/treasury/journals", dict(payload, code="BDM2"), token=self.token)
        self.assertEqual(status, 403, "Réservé à l'administration")

    def test_budget(self):
        status, budget = self.call("POST", "/finance/budgets", {"name": "Budget 2026", "year": self.today.year},
                                   token=self.token)
        self.assertEqual(status, 200, budget)
        status, _b = self.call("POST", f"/finance/budgets/{budget['id']}/lines", {
            "account_id": self.acc_purchase.id, "month": self.today.month, "amount": 100_000_000,
        }, token=self.token)
        self.assertEqual(status, 200)
        self.make_invoice("in_invoice", 150_000_000)
        status, compare = self.call("GET", f"/finance/budgets/{budget['id']}/compare?month={self.today.month}",
                                    token=self.token)
        self.assertEqual(status, 200, compare)
        line = next(l for l in compare["lines"] if l["account_id"] == self.acc_purchase.id)
        self.assertEqual(line["budget"], 100_000_000)
        self.assertEqual(line["actual"], 150_000_000)
        self.assertTrue(line["alert"], "Dépassement de 50 % au-delà du seuil de 10 %")

    def test_relances_clients(self):
        from datetime import timedelta

        late = self.make_invoice("out_invoice", 10_000_000, day=self.today - timedelta(days=40))
        late.invoice_date_due = self.today - timedelta(days=40)
        Reminder = self.env["eguitra.reminder"]
        created = Reminder.generate(self.company, self.today)
        mine = created.filtered(lambda r: r.partner_id == self.customer)
        self.assertEqual(mine.level, "3", "Plus de 30 jours de retard : mise en demeure")
        self.assertIn(late, mine.invoice_ids)
        self.assertFalse(Reminder.generate(self.company, self.today).filtered(lambda r: r.partner_id == self.customer),
                         "Pas de nouvelle relance au même niveau")
        token = self.token
        status, body = self.call("GET", f"/finance/reminders/{mine.id}", token=token)
        self.assertEqual(status, 200, body)
        self.assertIn("mettons en demeure", body["letter"]["intro"])
        status, body = self.call("POST", f"/finance/reminders/{mine.id}/send", {"channel": "letter"}, token=token)
        self.assertEqual((status, body["state"]), (200, "sent"))
