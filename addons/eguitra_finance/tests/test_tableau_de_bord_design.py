"""Compléments du tableau de bord et de la trésorerie demandés par le design du 22 octobre : même
période du mois précédent, détail de la classe 5, séries des chiffres clés, fenêtre commune, mois
clôturé, seuil de sécurité de la trésorerie, et une seule écriture des nombres (formats.py)."""

from datetime import timedelta

from odoo.tests import TransactionCase, tagged

from odoo.addons.eguitra_api.tests.common import ApiCase

from ..formats import days, money_short, ratio
from ..models.finance_metrics import month_bounds
from .common import FinanceDataMixin


@tagged("post_install", "-at_install")
class TestFormats(TransactionCase):
    def test_valeurs_de_reference_de_l_ecran(self):
        """Mêmes valeurs que les exemples de apps/web/lib/format.ts (fmtShort, fmtJours, fmtRatio)."""
        for value, expected in (
            (1_740_000_000, "1,74 Md"), (6_000_000_000, "6,00 Md"), (41_310_000_000, "41,31 Md"),
            (-11_550_000_000, "-11,55 Md"), (999_600_000, "1,00 Md"), (384_200_000, "384 M"),
            (99_960_000, "100 M"), (7_040_000, "7,0 M"), (224_050, "224 050"), (0, "0"), (-0.4, "0"),
        ):
            self.assertEqual(money_short(value, unit=None), expected, value)
        self.assertEqual(money_short(12_500_000), "12,5 M GNF")
        self.assertEqual(money_short(None), "–")
        self.assertEqual(days(56.5), "56,5 jours")
        self.assertEqual(days(56), "56,0 jours")
        self.assertEqual(days(1), "1,0 jour")
        self.assertEqual(ratio(2.9), "2,90")
        self.assertEqual(ratio(1.234), "1,23")

    def test_constats_sans_k(self):
        from odoo.addons.eguitra_analytics.engine.insights import gnf

        self.assertEqual(gnf(500_000), "500 000 GNF", "Jamais « 500 k »")
        self.assertEqual(gnf(1_200_000_000), "1,20 Md GNF", "« Md » toujours à deux décimales")
        self.assertEqual(gnf(250_000_000), "250 M GNF")


@tagged("post_install", "-at_install")
class TestTableauDeBordDesign(FinanceDataMixin, ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_finance_data()
        cls._create_user("aissatou", "finance")
        cls._create_user("mamadou.parc", "exploitation")
        cls.day = cls.today.replace(day=15)
        cls.pm_start, cls.pm_end = month_bounds(cls.day.replace(day=1) - timedelta(days=1))
        cls.make_invoice("out_invoice", 100_000_000, day=cls.pm_start.replace(day=10))
        cls.make_invoice("out_invoice", 40_000_000, day=cls.pm_start.replace(day=20))
        cls.make_invoice("out_invoice", 70_000_000, day=cls.day.replace(day=5))
        cls.make_invoice("in_invoice", 30_000_000, day=cls.day.replace(day=6))
        # Un compte de la classe 5 hors journaux de banque et de caisse (virements de fonds en cours).
        transit = cls.env["account.account"].search(
            [("code", "=like", "585%"), ("company_ids", "in", cls.company.ids)], limit=1)
        misc = cls.env["account.journal"].search([("type", "=", "general"), ("company_id", "=", cls.company.id)], limit=1)
        cls.transit = transit
        move = cls.env["account.move"].create({
            "move_type": "entry", "journal_id": misc.id, "date": cls.day.replace(day=7),
            "line_ids": [(0, 0, {"account_id": transit.id, "debit": 12_000_000, "name": "Fonds en transit"}),
                         (0, 0, {"account_id": cls.acc_services.id, "credit": 12_000_000, "name": "Fonds en transit"})],
        })
        move.action_post()
        cls.env["eguitra.alert.threshold"].search(
            [("company_id", "=", cls.company.id), ("code", "=", "cash_min")]).value = 5_000_000

    def setUp(self):
        super().setUp()
        self.token = self.open_session("aissatou")["access_token"]

    def _dashboard(self, day):
        status, body = self.call("GET", f"/finance/dashboard?date={day.isoformat()}", token=self.token)
        self.assertEqual(status, 200, body)
        return body

    def test_meme_periode_du_mois_precedent(self):
        d = self._dashboard(self.day)
        self.assertEqual(d["revenue_prev_month"], 140_000_000)
        self.assertEqual(d["revenue_prev_month_to_date"], 100_000_000, "Du 1er au 15 du mois précédent seulement")

    def test_classe_5_detaillee_et_trésorerie(self):
        d = self._dashboard(self.day)
        other = {row["code"]: row for row in d["cash_other"]}
        self.assertIn(self.transit.code, other)
        self.assertEqual(other[self.transit.code]["balance"], 12_000_000)
        journals = sum(row["balance"] for row in d["cash_by_journal"])
        self.assertAlmostEqual(journals + sum(row["balance"] for row in d["cash_other"]), d["cash"], places=2,
                               msg="Le billet s'additionne jusqu'à la trésorerie nette")
        status, position = self.call("GET", "/finance/treasury", token=self.token)
        self.assertEqual(status, 200, position)
        self.assertEqual(position["cash_min"], 5_000_000, "Seuil de sécurité servi à la trésorerie")
        self.assertIn(self.transit.code, [row["code"] for row in position["cash_other"]])
        self.assertAlmostEqual(position["total"] + sum(r["balance"] for r in position["cash_other"]), position["cash"], places=2)

    def test_series_des_chiffres_cles_et_fenetre_commune(self):
        d = self._dashboard(self.day)
        series = d["kpi_series"]
        months = [m["month"] for m in d["revenue_by_month"]]
        self.assertEqual(series["months"], months)
        self.assertEqual(months[0], d["fiscal_year"]["start"][:7], "Fenêtre : du début de l'exercice…")
        self.assertEqual(months[-1], self.day.strftime("%Y-%m"), "… au mois de l'arrêté")
        self.assertEqual([m["month"] for m in d["cash_monthly"]["months"]][:len(months)], months,
                         "Les flux de trésorerie partent du même mois")
        for key in ("ebe", "dso", "bfr", "debt", "dscr"):
            self.assertEqual(len(series[key]), len(months), key)
        self.assertAlmostEqual(sum(series["ebe"]), d["ebe_fy"], places=0, msg="L'EBE mensuel s'additionne en EBE de l'exercice")
        self.assertEqual(series["dso"][-1], d["working_capital"]["dso"], "La gravure finit sur le chiffre affiché")
        self.assertEqual(series["bfr"][-1], d["working_capital"]["bfr"])
        self.assertEqual(series["debt"][-1], d["debt"]["accounting_outstanding"])
        self.assertEqual(series["dscr"][-1], d["dscr"])

    def test_mois_cloture(self):
        self.assertFalse(self._dashboard(self.pm_end)["month_closed"])
        self.company.sudo().fiscalyear_lock_date = self.pm_end
        self.assertTrue(self._dashboard(self.pm_end)["month_closed"], "Mois clôturé : sa date de verrouillage l'atteint")
        self.assertFalse(self._dashboard(self.day)["month_closed"], "Le mois suivant reste ouvert")

    def test_tresorerie_refusee_hors_finance(self):
        token = self.open_session("mamadou.parc")["access_token"]
        self.assertEqual(self.call("GET", "/finance/treasury", token=token)[0], 403)
        self.assertEqual(self.call("GET", "/finance/dashboard", token=token)[0], 403)
