import math

from odoo.tests import tagged
from odoo.tests.common import BaseCase

from ..engine import benford, forecast, stats


@tagged("post_install", "-at_install")
class TestStats(BaseCase):
    """Statistiques descriptives, robustes, régression et concentration sur des séries connues."""

    def test_quantiles_et_mad(self):
        self.assertEqual(stats.median([3, 1, 2]), 2)
        self.assertEqual(stats.median([1, 2, 3, 4]), 2.5)
        self.assertEqual(stats.quantile([1, 2, 3, 4], 0.25), 1.75, "Interpolation linéaire entre les rangs")
        self.assertIsNone(stats.quantile([], 0.5))
        self.assertIsNone(stats.median([None]))
        self.assertEqual(stats.mad([1, 1, 2, 2, 4, 6, 9]), 1)
        scores = stats.robust_z([1, 1, 2, 2, 4, 6, 9])
        self.assertAlmostEqual(scores[-1], 0.6745 * 7)
        self.assertGreater(scores[-1], stats.OUTLIER_Z, "9 est aberrant au seuil de 3,5")
        self.assertEqual(stats.robust_z([5, 5, 5]), [0.0, 0.0, 0.0], "MAD nulle : scores nuls")
        self.assertEqual(stats.robust_z([5, None]), [0.0, None])

    def test_regression_exacte(self):
        fit = stats.linear_regression([1, 2, 3, 4], [3, 5, 7, 9])
        self.assertAlmostEqual(fit["slope"], 2)
        self.assertAlmostEqual(fit["intercept"], 1)
        self.assertAlmostEqual(fit["r2"], 1)
        self.assertAlmostEqual(fit["stderr"], 0)
        self.assertIsNone(fit["t"], "Ajustement exact : t non défini (pas de valeur astronomique)")
        self.assertEqual(fit["n"], 4)
        noisy = stats.linear_regression([1, 2, 3, 4, 5], [2.1, 3.9, 6.2, 7.8, 10.1])
        self.assertAlmostEqual(noisy["slope"], 1.99)
        self.assertAlmostEqual(noisy["intercept"], 0.05)
        self.assertGreater(noisy["t"], 2, "Pente significative")
        flat = stats.linear_regression([2, 2, 2], [1, 2, 3])
        self.assertIsNone(flat["slope"], "x constant : pas de pente")
        self.assertEqual(flat["intercept"], 2)
        self.assertAlmostEqual(stats.correlation([1, 2, 3], [2, 4, 6]), 1)
        self.assertIsNone(stats.correlation([1, 2, 3], [5, 5, 5]))

    def test_concentration(self):
        self.assertEqual(stats.hhi([50, 50]), 5000)
        self.assertEqual(stats.hhi([25, 25, 25, 25]), 2500)
        self.assertEqual(stats.hhi([100, 0, -5]), 10000, "Valeurs négatives ramenées à 0")
        self.assertIsNone(stats.hhi([]))
        equal = stats.lorenz([10, 10, 10, 10])
        self.assertAlmostEqual(equal["gini"], 0, msg="Distribution égale : Gini nul")
        self.assertEqual(equal["points"][0], {"x": 0.0, "y": 0.0})
        self.assertEqual(equal["points"][-1], {"x": 1.0, "y": 1.0})
        self.assertEqual(equal["points"][2], {"x": 0.5, "y": 0.5})
        self.assertAlmostEqual(stats.lorenz([0, 0, 0, 100])["gini"], 0.75, msg="Un seul porte tout : 1 - 1/n")
        self.assertEqual(len(stats.lorenz(range(1, 501), max_points=51)["points"]), 51)
        self.assertEqual(stats.lorenz([])["gini"], None)
        self.assertEqual(stats.pareto_count([50, 30, 10, 5, 5]), 2, "50 + 30 = 80 %")
        self.assertEqual(stats.pareto_count([1, 1, 1, 1, 1]), 4)
        self.assertEqual(stats.pareto_count([]), 0)

    def test_variations(self):
        self.assertAlmostEqual(stats.pct_change(110, 100), 10)
        self.assertAlmostEqual(stats.pct_change(-50, -100), 50, msg="Base négative : sens de la variation")
        self.assertIsNone(stats.pct_change(1, 0))
        self.assertAlmostEqual(stats.cagr(100, 121, 2), 10)
        self.assertIsNone(stats.cagr(0, 121, 2))
        self.assertEqual(stats.linear_score(1.5, 0, 3), 50)
        self.assertEqual(stats.linear_score(90, 120, 60), 50, "Ratio dont la baisse est favorable")
        self.assertEqual(stats.linear_score(10, 0, 3), 100)
        self.assertAlmostEqual(stats.norm_cdf(0), 0.5)


@tagged("post_install", "-at_install")
class TestForecast(BaseCase):
    """Prévision : Holt-Winters, Holt amorti, naïf, Monte-Carlo, rupture."""

    @staticmethod
    def _seasonal(start, count):
        return [100 + 2 * t + 10 * math.sin(2 * math.pi * t / 12) for t in range(start, start + count)]

    def test_holt_winters_retrouve_la_saisonnalite(self):
        history = self._seasonal(0, 36)
        result = forecast.forecast_series(history, 12)
        self.assertEqual(result["method"], "holt_winters", "Au moins deux saisons complètes")
        truth = self._seasonal(36, 12)
        for got, expected in zip(result["forecast"], truth):
            self.assertAlmostEqual(got, expected, delta=1e-6)
        peak = max(range(12), key=lambda i: result["forecast"][i] - 2 * (36 + i))
        self.assertEqual((36 + peak) % 12, 3, "Pic saisonnier (hors tendance) au quatrième mois de la saison")
        self.assertLess(result["mape"], 1e-6)
        self.assertEqual(len(result["low"]), 12)
        self.assertTrue(all(lo <= f <= hi for lo, f, hi in zip(result["low"], result["forecast"], result["high"])))

    def test_holt_et_naif(self):
        linear = [10 + 3 * t for t in range(10)]
        result = forecast.forecast_series(linear, 3)
        self.assertEqual(result["method"], "holt", "Moins de deux saisons : Holt à tendance amortie")
        self.assertLess(result["params"]["phi"], 1)
        self.assertGreater(result["forecast"][0], linear[-1])
        self.assertLess(result["forecast"][2], 10 + 3 * 12, "Tendance amortie : sous la droite")
        self.assertGreater(result["forecast"][2], result["forecast"][1])
        naive = forecast.forecast_series([5, 7], 2)
        self.assertEqual(naive["method"], "naive")
        self.assertEqual(naive["forecast"], [7.0, 7.0])
        self.assertAlmostEqual(naive["high"][1] - 7, forecast.Z80 * 2 * math.sqrt(2), msg="σ √h")
        empty = forecast.forecast_series([], 2)
        self.assertEqual((empty["forecast"], empty["low"], empty["method"], empty["mape"]), ([], [], "naive", None))
        flat = forecast.forecast_series([40.0] * 30, 3)
        self.assertEqual(flat["method"], "naive", "Série constante : rien à lisser")
        self.assertEqual(flat["forecast"], [40.0] * 3)
        self.assertEqual(flat["mape"], 0)
        self.assertEqual(forecast.forecast_series([None, float("nan"), 3, 4], 1)["method"], "holt",
                         "Valeurs manquantes comptées pour 0")
        falling = forecast.forecast_series([100 - 20 * t for t in range(6)], 4)
        self.assertTrue(all(v >= 0 for v in falling["forecast"] + falling["low"]),
                        "Série positive : jamais de prévision négative")

    def test_monte_carlo_reproductible(self):
        residuals = [-20, -10, 0, 10, 20]
        self.assertEqual(forecast.probability_reach([100, 100], [100, 100], 300, residuals), 1.0)
        self.assertEqual(forecast.probability_reach([100, 100], [100, 100], 450, residuals), 0.0,
                         "Au mieux 440")
        first = forecast.probability_reach([100, 100], [100, 100], 400, residuals)
        self.assertEqual(first, forecast.probability_reach([100, 100], [100, 100], 400, residuals), "Graine fixe")
        self.assertTrue(0.4 < first < 0.8)
        self.assertEqual(forecast.probability_reach([100], [50], 140, []), 1.0, "Sans résidu : prévision ponctuelle")
        self.assertIsNone(forecast.probability_reach([100], [50], None, residuals))
        spread = forecast.total_distribution([100, 100], [100, 100], residuals)
        self.assertLessEqual(spread["p10"], spread["p50"])
        self.assertLessEqual(spread["p50"], spread["p90"])

    def test_cusum(self):
        result = forecast.cusum([10, 11, 9, 10, 11, 9, 10, 20, 21, 19, 20, 21])
        self.assertTrue(result["change"])
        self.assertEqual((result["index"], result["direction"]), (7, "up"))
        self.assertAlmostEqual(result["mean_before"], 10)
        self.assertFalse(forecast.cusum([10] * 12)["change"])
        self.assertFalse(forecast.cusum([10, 12])["change"], "Moins de six points")


@tagged("post_install", "-at_install")
class TestBenford(BaseCase):
    def test_suite_geometrique_conforme(self):
        # Suite géométrique de raison 10^(1/250) sur quatre décades : mantisses uniformes, loi de Benford.
        amounts = [1000 * 10 ** (i / 250) for i in range(1000)]
        result = benford.first_digits(amounts)
        self.assertEqual(result["n"], 1000)
        self.assertLess(result["mad"], 0.006)
        self.assertEqual(result["conformity"], "close")
        self.assertEqual(result["suspicious"], [])
        self.assertIsNone(result["warning"])
        self.assertGreater(result["p_value"], 0.05)
        one = result["digits"][0]
        self.assertEqual(one["d"], 1)
        self.assertAlmostEqual(one["expected"], 30.103, places=3)

    def test_montants_fabriques(self):
        result = benford.first_digits([5000 + i for i in range(200)] + [500])
        self.assertEqual(result["n"], 200, "Montants sous le minimum écartés")
        self.assertEqual(result["conformity"], "nonconformity")
        self.assertEqual(result["suspicious"], [5])
        self.assertGreater(result["chi2"], result["chi2_critical"])
        small = benford.first_digits([1500, 2500])
        self.assertIn("indicatif", small["warning"])
        self.assertEqual(benford.leading_digits(999_999.99), 9)
        self.assertEqual(benford.leading_digits(5.5, 2), 55)
        self.assertEqual(benford.first_two_digits([1000 * 10 ** (i / 250) for i in range(1000)])["n"], 1000)


@tagged("post_install", "-at_install")
class TestFormatsConstats(BaseCase):
    """Constats du groupe : délais et montants écrits comme dans l'application web (format.ts)."""

    def test_delais_a_une_decimale(self):
        from ..engine.insights import gnf
        from ..models.groupe import _days

        self.assertEqual(_days(56.5), "56,5 jours")
        self.assertEqual(_days(56), "56,0 jours", "Toujours une décimale, comme fmtJours")
        self.assertEqual(_days(1.2), "1,2 jour")
        self.assertEqual(_days(None), "–")
        self.assertEqual(gnf(500_000), "500 000 GNF", "Jamais « k »")
