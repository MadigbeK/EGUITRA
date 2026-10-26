from datetime import timedelta

from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_finance.tests.common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestChantier(FinanceDataMixin, TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls.chantier = cls.env["eguitra.chantier"].create({
            "name": "Route Kankan - Kouroussa, lot 2", "code": "CH-2026-01", "partner_id": cls.customer.id,
            "contract_amount": 2_000_000_000, "retention_rate": 5,
        })

    def _situation(self, cumulative):
        return self.env["eguitra.chantier.situation"].create({"chantier_id": self.chantier.id, "cumulative_amount": cumulative})

    def test_axe_analytique(self):
        self.assertEqual(self.chantier.analytic_account_id.plan_id, self.env.ref("eguitra_base.analytic_plan_chantier"))

    def test_situations_et_retenues(self):
        s1 = self._situation(500_000_000)
        s1.action_invoice()
        self.assertEqual(s1.amount_period, 500_000_000)
        self.assertEqual(s1.retention_amount, 25_000_000)
        self.assertEqual(s1.invoice_id.amount_total, 590_000_000, "Travaux de la période TTC")
        self.assertEqual(s1.invoice_id.amount_residual, 565_000_000, "Net à payer : TTC moins la retenue")
        self.assertEqual(self.chantier.state, "progress")

        s2 = self._situation(1_200_000_000)
        self.assertEqual(s2.number, 2)
        self.assertEqual(s2.previous_amount, 500_000_000)
        s2.action_invoice()
        self.assertEqual(s2.amount_period, 700_000_000)
        self.assertEqual(self.chantier.invoiced_amount, 1_200_000_000)
        self.assertEqual(self.chantier.retention_total, 60_000_000)
        self.assertAlmostEqual(self.chantier.progress_pct, 60.0)

        retention = self.env["eguitra.finance.metrics"]._sum_balance(self.company, ["4117"], None, self.today)
        self.assertEqual(retention, 60_000_000, "Les retenues sont portées en 4117")

        self.chantier.action_release_retention()
        self.assertEqual(self.chantier.retention_released, 60_000_000)
        retention = self.env["eguitra.finance.metrics"]._sum_balance(self.company, ["4117"], None, self.today)
        self.assertEqual(retention, 0)
        with self.assertRaises(UserError):
            self.chantier.action_release_retention()

    def test_cumul_superieur_au_marche(self):
        with self.assertRaises(UserError):
            self._situation(2_500_000_000).action_invoice()

    def test_cumul_decroissant_refuse(self):
        self._situation(500_000_000).action_invoice()
        with self.assertRaises(UserError):
            self._situation(400_000_000).action_invoice()

    def test_fiche_modifiable_avec_ses_garde_fous(self):
        """Avenant, retenue, réception et clôture : la fiche se modifie sans fausser les retenues comptabilisées."""
        self.chantier.write({"retention_rate": 7.5})
        self.assertEqual(self.chantier.retention_rate, 7.5, "Aucune situation facturée : la retenue se change")
        self._situation(500_000_000).action_invoice()
        with self.assertRaises(UserError):
            self.chantier.write({"retention_rate": 5})
        self.chantier.write({"retention_rate": 7.5})  # valeur inchangée : acceptée
        with self.assertRaises(UserError):
            self.chantier.write({"contract_amount": 400_000_000})
        with self.assertRaises(UserError):
            self.chantier.write({"retention_rate": 120})
        self.chantier.write({"contract_amount": 2_300_000_000})
        self.assertAlmostEqual(self.chantier.progress_pct, 500 / 2300 * 100, msg="Avenant de 300 M : avancement recalculé")
        with self.assertRaises(UserError):
            self.chantier.write({"state": "received"})
        self.chantier.write({"state": "received", "date_reception": self.today})
        with self.assertRaises(UserError):
            self.chantier.write({"date_reception": False})
        draft = self._situation(900_000_000)
        with self.assertRaises(UserError):
            self.chantier.write({"state": "closed"})
        draft.action_cancel()
        self.chantier.write({"state": "closed"})
        with self.assertRaises(UserError):
            self._situation(1_000_000_000)
        self.chantier.write({"state": "progress"})
        self.assertEqual(self._situation(1_000_000_000).number, 3, "Rouvert : la saisie reprend")

    def test_situations_facturees_dans_l_ordre(self):
        """C9 : deux situations saisies avant facturation ne facturent pas deux fois les mêmes travaux."""
        s1 = self._situation(500_000_000)
        s2 = self._situation(1_200_000_000)
        self.assertEqual(self.chantier.progress_pct, 0, "Les brouillons ne comptent pas dans l'avancement")
        with self.assertRaises(UserError):
            s2.action_invoice()
        s1.action_invoice()
        self.assertEqual((s2.previous_amount, s2.amount_period, s2.retention_amount), (500_000_000, 700_000_000, 35_000_000),
                         "S1 facturée : la période de S2 se recalcule sur le cumul facturé")
        s2.action_invoice()
        self.assertEqual(s2.invoice_id.amount_untaxed, 700_000_000)
        self.assertEqual(self.chantier.invoiced_amount, 1_200_000_000)
        self.assertEqual(self.chantier._retention_balance(), 60_000_000)

    def test_situation_facturee_figee(self):
        """C10 : ni le maître d'ouvrage ni le cumul d'une situation facturée ne changent ensuite, et un avenant
        laisse les montants facturés tels quels."""
        s1 = self._situation(500_000_000)
        s1.action_invoice()
        other = self.env["res.partner"].create({"name": "SOGUIPAMI"})
        with self.assertRaises(UserError):
            self.chantier.write({"partner_id": other.id})
        with self.assertRaises(UserError):
            s1.write({"cumulative_amount": 600_000_000})
        self.chantier.write({"contract_amount": 2_500_000_000})
        self.assertEqual((s1.amount_period, s1.retention_amount), (500_000_000, 25_000_000), "Montants facturés inchangés")

    def test_annulation_de_la_derniere_situation_par_avoir(self):
        """I-C2 : la dernière situation facturée s'annule par un avoir, sa retenue est extournée et son cumul
        redevient facturable ; pas une situation suivie d'une autre, ni une situation déjà réglée (à confirmer
        en 19 : rapprochement automatique de _reverse_moves avec cancel=True)."""
        s1 = self._situation(500_000_000)
        s1.action_invoice()
        s2 = self._situation(1_200_000_000)
        s2.action_invoice()
        with self.assertRaises(UserError):
            s1.action_reverse()
        s2.action_reverse()
        self.assertEqual(s2.state, "cancelled")
        self.assertEqual((s2.credit_note_id.move_type, s2.credit_note_id.amount_untaxed), ("out_refund", 700_000_000))
        self.assertAlmostEqual(s2.invoice_id.amount_residual, 0, msg="Facture soldée par l'avoir")
        self.assertEqual(self.chantier.invoiced_amount, 500_000_000)
        self.assertEqual(self.chantier._retention_balance(), 25_000_000, "Retenue de S2 extournée")
        s3 = self._situation(1_200_000_000)
        s3.action_invoice()
        self.assertEqual(s3.amount_period, 700_000_000, "Le cumul annulé redevient facturable")
        self.env["account.payment.register"].with_context(active_model="account.move", active_ids=s3.invoice_id.ids).create(
            {"journal_id": self.bank.id, "amount": 100_000_000}).action_create_payments()
        with self.assertRaises(UserError):
            s3.action_reverse()

    def test_retenues_liberees_exigibles(self):
        """C10 et I-C3 : la libération porte le solde 4117 du chantier, dans le journal des opérations diverses
        (jamais celui des à-nouveaux), et la créance libérée est échue dès la libération (relancée)."""
        Journal = self.env["account.journal"]
        an = Journal.search([("company_id", "=", self.company.id), ("code", "=", "AN")], limit=1) or Journal.create(
            {"name": "À-nouveaux", "type": "general", "code": "AN", "company_id": self.company.id})
        an.sequence = 0
        self._situation(500_000_000).action_invoice()
        self.chantier.action_release_retention()
        move = self.chantier.release_move_ids
        line = move.line_ids.filtered(lambda l: l.debit)
        self.assertEqual((line.date_maturity, line.debit), (self.today, 25_000_000))
        self.assertNotEqual(move.journal_id, an)
        self.assertEqual(self.chantier._released_due(), 25_000_000, "Retenue libérée suivie jusqu'à son règlement")
        self.assertEqual(self.chantier._retention_balance(), 0)

    def test_activite_btp_arrondi_et_libelles(self):
        """I-C4 et M10 : le chiffre d'affaires porte l'activité BTP ; retenue arrondie au franc, demi vers le
        haut ; libellés écrits à la française."""
        self.chantier.write({"retention_rate": 2.5})
        sit = self._situation(500_000_020)
        sit.action_invoice()
        self.assertEqual(sit.retention_amount, 12_500_001, "12 500 000,5 arrondi vers le haut")
        line = sit.invoice_id.invoice_line_ids
        activity = self.env["eguitra.chantier"]._activity_account(self.company)
        self.assertEqual(activity.name, "BTP")
        self.assertIn(str(activity.id), ",".join(line.analytic_distribution))
        self.assertIn("avancement cumulé 25,0", line.name)
        self.assertIn("2,5", sit.retention_move_id.ref)

    def test_dates_incoherentes_refusees(self):
        self.chantier.write({"date_start": self.today})
        with self.assertRaises(UserError):
            self.chantier.write({"date_end": self.today - timedelta(days=1)})
        with self.assertRaises(UserError):
            self.chantier.write({"state": "received", "date_reception": self.today - timedelta(days=1)})
