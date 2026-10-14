from dateutil.relativedelta import relativedelta

from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestImmobilier(FinanceDataMixin, TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.tenant = cls.env["res.partner"].create({"name": "ORANGE GUINEE"})
        cls.bien = cls.env["eguitra.property"].create({
            "name": "Immeuble Kaloum, 2e étage", "kind": "bureau", "area_m2": 240, "acquisition_value": 3_000_000_000,
            "current_value": 3_600_000_000,
        })

    def _lease(self, start, **values):
        base = {"name": "BAIL-2026-01", "property_id": self.bien.id, "partner_id": self.tenant.id,
                "date_start": start, "rent": 25_000_000, "vat": True}
        base.update(values)
        return self.env["eguitra.lease"].create(base)

    def test_axe_analytique_du_bien(self):
        self.assertEqual(self.bien.analytic_account_id.plan_id, self.env.ref("eguitra_base.analytic_plan_bien"))

    def test_quittancement_avec_rattrapage(self):
        start = (self.today - relativedelta(months=2)).replace(day=1)
        lease = self._lease(start)
        lease.action_activate()
        self.assertEqual(lease.state, "active")
        self.assertTrue(self.bien.occupied)
        invoices = self.env["eguitra.lease"].generate_rents(self.company, self.today)
        self.assertEqual(len(invoices), 3, "Trois mois échus, mois courant compris (loyer payable d'avance)")
        self.assertEqual(set(invoices.mapped("state")), {"posted"})
        first = invoices.sorted("invoice_date")[0]
        self.assertEqual(first.amount_untaxed, 25_000_000)
        self.assertEqual(first.amount_total, 29_500_000, "Bail commercial soumis à la TVA")
        line = first.invoice_line_ids
        self.assertTrue(line.account_id.code.startswith("7073"), "Loyers en 7073")
        self.assertIn(str(self.bien.analytic_account_id.id), ",".join(line.analytic_distribution))
        again = self.env["eguitra.lease"].generate_rents(self.company, self.today)
        self.assertFalse(again, "Aucun loyer facturé deux fois")

    def test_quittancement_de_nuit(self):
        start = (self.today - relativedelta(months=1)).replace(day=1)
        self._lease(start).action_activate()
        self.env["eguitra.lease"]._cron_generate_rents()
        invoices = self.env["account.move"].search([("partner_id", "=", self.tenant.id), ("move_type", "=", "out_invoice")])
        self.assertEqual(set(invoices.mapped("state")), {"posted"}, "Loyers validés sans intervention")
        self.assertEqual(sorted(invoices.mapped("invoice_date")), [start, start + relativedelta(months=1)],
                         "Une facture par échéance, datée de l'échéance")
        self.env["eguitra.lease"]._cron_generate_rents()
        self.assertEqual(self.env["account.move"].search_count([("partner_id", "=", self.tenant.id)]), 2)
        self.assertTrue(self.env.ref("eguitra_immobilier.cron_rents").active)
        cron = self.env.ref("contract.contract_cron_for_invoice")
        self.assertFalse(cron.active, "Génération du module contract remplacée")
        cron.active = True  # base existante : la fiche du module contract n'est pas rechargée à la mise à jour
        self.env["eguitra.lease"]._disable_contract_cron()
        self.assertFalse(cron.active, "Désactivée à chaque mise à jour du module")

    def test_fin_de_bail(self):
        start = (self.today - relativedelta(months=2)).replace(day=1)
        lease = self._lease(start)
        lease.action_activate()
        lease.action_terminate(start + relativedelta(months=1, days=-1))  # dernier jour du premier mois
        self.assertEqual(lease.state, "terminated")
        self.assertFalse(self.bien.occupied, "Le bien redevient libre")
        Move = self.env["account.move"]
        domain = [("partner_id", "=", self.tenant.id), ("move_type", "=", "out_invoice")]
        self.assertEqual(Move.search(domain).mapped("invoice_date"), [start], "Échéances dues facturées, rien au-delà de la fin")
        self.env["eguitra.lease"]._cron_generate_rents()
        self.assertEqual(Move.search_count(domain), 1, "Un locataire parti n'est plus facturé")
        with self.assertRaises(UserError):
            self._lease(start, name="BAIL-2026-03").action_terminate(start)  # bail non activé

    def test_un_seul_bail_en_cours_par_bien(self):
        self._lease(self.today).action_activate()
        with self.assertRaises(UserError):
            self._lease(self.today, name="BAIL-2026-02").action_activate()

    def test_impayes_et_synthese(self):
        start = (self.today - relativedelta(months=3)).replace(day=1)
        self._lease(start, vat=False).action_activate()
        self.env["eguitra.lease"].generate_rents(self.company, self.today)
        unpaid = self.env["eguitra.lease"].unpaid_rents(self.company, self.today + relativedelta(days=45))
        self.assertTrue(unpaid)
        summary = self.env["eguitra.lease"].summary(self.company, self.today)
        self.assertEqual(summary["occupied"], 1)
        self.assertEqual(summary["annual_rent"], 300_000_000)
        self.assertAlmostEqual(summary["gross_yield"], 300_000_000 / 3_600_000_000 * 100)
