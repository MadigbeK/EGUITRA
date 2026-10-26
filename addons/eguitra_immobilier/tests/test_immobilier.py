from datetime import date
from unittest.mock import patch

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
        self.assertEqual(self.env.ref("eguitra_immobilier.cron_rents").nextcall.hour, 1, "Quittancement la nuit, à 1 h")
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
        first = self.today.replace(day=1)
        self._lease(first).action_activate()
        with self.assertRaises(UserError):
            self._lease(first, name="BAIL-2026-02").action_activate()

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

    def _rent_invoices(self):
        return self.env["account.move"].search(
            [("partner_id", "=", self.tenant.id), ("move_type", "=", "out_invoice")]).sorted("invoice_date")

    def test_fin_de_bail_future_sans_loyer_perdu(self):
        """Congé donné pour une date future (C11) : le bail reste en cours et quittancé jusqu'à sa fin, puis la
        tâche de nuit le résilie après ses derniers loyers ; la dernière période est facturée au prorata."""
        start = (self.today - relativedelta(months=1)).replace(day=1)
        lease = self._lease(start)
        lease.action_activate()
        end = start + relativedelta(months=3, days=14)  # le 15 du quatrième mois
        lease.action_terminate(end)
        self.assertEqual((lease.state, lease.date_end), ("active", end), "Fin future : le bail reste en cours")
        self.assertTrue(self.bien.occupied)
        self.env["eguitra.lease"]._cron_generate_rents(today=end + relativedelta(days=1))
        self.assertEqual(lease.state, "terminated", "Résilié le lendemain de sa fin")
        self.assertFalse(self.bien.occupied)
        invoices = self._rent_invoices()
        self.assertEqual(invoices.mapped("invoice_date"), [start + relativedelta(months=i) for i in range(4)],
                         "Tous les loyers jusqu'à la fin du bail, aucun perdu")
        last_start = start + relativedelta(months=3)
        days = (last_start + relativedelta(months=1) - last_start).days
        self.assertEqual(invoices[-1].amount_untaxed, round(25_000_000 * 15 / days),
                         "Dernière période coupée par la fin : loyer au prorata des 15 jours")
        self.assertEqual(invoices[0].amount_untaxed, 25_000_000)

    def test_fin_au_milieu_d_une_periode_deja_facturee(self):
        """Fin du bail au milieu d'une période déjà facturée (I-C5) : résiliation sans erreur du module contract ;
        la période facturée au-delà de la fin reste à annuler par un avoir (à confirmer en 19)."""
        start = (self.today - relativedelta(months=2)).replace(day=1)
        lease = self._lease(start)
        lease.action_activate()
        self.env["eguitra.lease"].generate_rents(self.company, self.today)
        end = start + relativedelta(months=1, days=9)  # le 10 du deuxième mois, période déjà facturée
        lease.action_terminate(end)
        self.assertEqual((lease.state, lease.date_end), ("terminated", end))
        self.assertGreater(lease._invoiced_until(), end, "Loyers facturés au-delà de la fin : avoir à établir")

    def test_bail_repris_en_cours(self):
        """Bail repris en cours (I-C10) : la plateforme n'émet qu'à partir du premier loyer à émettre, sans
        rattrapage depuis la prise d'effet."""
        first = self.today.replace(day=1)
        lease = self._lease(first - relativedelta(years=2), rent_start=first)
        lease.action_activate()
        invoices = self.env["eguitra.lease"].generate_rents(self.company, self.today)
        self.assertEqual(invoices.mapped("invoice_date"), [first])
        with self.assertRaises(UserError):
            self._lease(first, name="BAIL-2026-04", rent_start=first - relativedelta(days=1))

    def test_echeance_du_29_au_31_refusee(self):
        """Une échéance le 29, le 30 ou le 31 glisserait au 28 après un mois court (I-C6) : refusée à l'activation."""
        lease = self._lease(date(self.today.year - 1, 1, 31))
        with self.assertRaises(UserError):
            lease.action_activate()
        self.assertEqual(lease.state, "draft")

    def test_emission_jamais_au_dela_d_aujourd_hui(self):
        """Émission manuelle à une date future (M10) : bornée à aujourd'hui, aucun loyer à venir émis."""
        start = self.today.replace(day=1)
        self._lease(start).action_activate()
        invoices = self.env["eguitra.lease"].generate_rents(self.company, self.today + relativedelta(months=3))
        self.assertEqual(invoices.mapped("invoice_date"), [start])

    def test_fin_de_bail_sans_plafond_d_echeances(self):
        """Une fin de bail émet toutes les échéances dues, au-delà des 36 d'un passage de nuit (M10)."""
        start = (self.today - relativedelta(months=38)).replace(day=1)
        lease = self._lease(start, vat=False)
        lease.action_activate()
        lease.action_terminate(start + relativedelta(months=38, days=-1))
        self.assertEqual(lease.state, "terminated")
        self.assertEqual(len(self._rent_invoices()), 38, "Aucune échéance perdue à la résiliation")

    def test_patrimoine_et_impayes_nets_des_avoirs(self):
        """Patrimoine bien par bien (I-C8) ; un loyer annulé par un avoir n'est pas un impayé (I-C9)."""
        self.env["eguitra.property"].create({"name": "Villa Kipé", "kind": "villa", "acquisition_value": 2_000_000_000})
        start = (self.today - relativedelta(months=2)).replace(day=1)
        self._lease(start, vat=False).action_activate()
        Lease = self.env["eguitra.lease"]
        invoices = Lease.generate_rents(self.company, self.today)
        later = self.today + relativedelta(days=45)
        self.assertEqual(len(Lease.unpaid_rents(self.company, later)), 3)
        refund = invoices.sorted("invoice_date")[0]._reverse_moves([{"date": self.today, "invoice_date": self.today}])
        refund.action_post()
        self.assertEqual(len(Lease.unpaid_rents(self.company, later)), 2, "Ni le loyer annulé, ni l'avoir")
        summary = Lease.summary(self.company, later)
        self.assertEqual(summary["unpaid_count"], 2)
        self.assertEqual(summary["unpaid_amount"], 50_000_000)
        self.assertEqual(summary["portfolio_value"], 3_600_000_000 + 2_000_000_000,
                         "Valeur actuelle du bien réévalué, valeur d'acquisition de l'autre")

    def test_echec_du_quittancement_inscrit_sur_le_bail(self):
        """Un bail en échec n'arrête pas les autres ; le motif reste inscrit sur lui jusqu'au passage réussi
        suivant (M10)."""
        start = (self.today - relativedelta(months=1)).replace(day=1)
        bad = self._lease(start)
        bad.action_activate()
        magasin = self.env["eguitra.property"].create({"name": "Magasin Madina", "kind": "magasin"})
        good = self._lease(start, name="BAIL-2026-09", property_id=magasin.id)
        good.action_activate()
        Lease = type(self.env["eguitra.lease"])
        original = Lease._generate_rents

        def generate(lease, until, limit=36):
            if lease == bad:
                raise UserError("Journal des ventes introuvable")
            return original(lease, until, limit=limit)

        errors = []
        with patch.object(Lease, "_generate_rents", generate):
            self.env["eguitra.lease"].generate_rents(self.company, self.today, errors=errors)
        self.assertEqual([(e["lease"], e["message"]) for e in errors], [("BAIL-2026-01", "Journal des ventes introuvable")])
        self.assertEqual(bad.rent_error, "Journal des ventes introuvable")
        self.assertTrue(bad.rent_error_at)
        self.assertGreater(good.next_invoice_date, self.today, "L'autre bail est quittancé")
        self.assertEqual(self.env["eguitra.lease"].summary(self.company, self.today)["rent_errors"], 1)
        self.env["eguitra.lease"]._cron_generate_rents()
        self.assertFalse(bad.rent_error, "Passage réussi : l'échec s'efface")
