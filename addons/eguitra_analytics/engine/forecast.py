"""Prévision de séries mensuelles : lissage exponentiel (Holt, Holt-Winters), simulation de Monte-Carlo,
détection de rupture (CUSUM). Bibliothèque standard seulement, tirages à graine fixe (résultats
reproductibles d'un appel à l'autre).

Méthode de forecast_series :
- Holt-Winters additif à tendance (éventuellement amortie) quand la série compte au moins deux saisons
  complètes (24 mois pour une saison de 12) : saisonnalité initiale tirée des deux premières saisons,
  corrigée de la tendance ;
- sinon Holt à tendance amortie (Gardner et McKenzie) dès 4 points ;
- sinon, ou pour une série constante, prévision naïve (dernière valeur) ; une série vide donne des listes
  vides.
Les paramètres de lissage sont choisis par recherche sur grille en minimisant la somme des carrés des
erreurs de prévision à un pas en validation glissante : chaque point n'est prévu qu'avec les points qui
le précèdent (origine glissante). Les intervalles à 80 % viennent de l'écart quadratique moyen de ces
erreurs, élargi avec l'horizon selon les formules analytiques des modèles ETS de classe 1 (Hyndman et
al., 2008). La MAPE est celle des prévisions à un pas sur le dernier tiers de la série (au moins trois
points). Une série sans valeur négative n'a jamais de prévision ni de borne négative.
"""

import math
import random

from . import stats

# Quantile 90 % de la loi normale : un intervalle à 80 % est prévision ± 1,2816 σ.
Z80 = 1.2815515655446004

HOLT_ALPHAS = (0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9)
HOLT_BETAS = (0.01, 0.05, 0.1, 0.2, 0.3)
HOLT_PHIS = (0.8, 0.85, 0.9, 0.95, 0.98)
HW_ALPHAS = (0.1, 0.2, 0.3, 0.5, 0.7, 0.9)
HW_BETAS = (0.01, 0.05, 0.1, 0.2)
HW_GAMMAS = (0.05, 0.1, 0.2, 0.4)
HW_PHIS = (0.9, 0.95, 0.98, 1.0)


def _phi_sum(phi, h):
    """φ + φ² + … + φ^h."""
    return sum(phi ** i for i in range(1, h + 1))


# ─── Holt (tendance amortie) ──────────────────────────────────────────────


def _holt(values, alpha, beta, phi):
    """Filtre de Holt amorti : niveau et tendance finaux, erreurs de prévision à un pas (à partir du
    troisième point : les deux premiers servent à l'initialisation l0 = y0, b0 = y1 - y0)."""
    level, trend = values[0], values[1] - values[0]
    residuals = []
    for t in range(1, len(values)):
        y = values[t]
        if t >= 2:
            residuals.append(y - (level + phi * trend))
        new_level = alpha * y + (1 - alpha) * (level + phi * trend)
        trend = beta * (new_level - level) + (1 - beta) * phi * trend
        level = new_level
    return level, trend, residuals


# ─── Holt-Winters additif ─────────────────────────────────────────────────


def _hw_init(values, m):
    """Initialisation sur les deux premières saisons : tendance = écart des moyennes saisonnières / m,
    niveau à la fin de la première saison, indices saisonniers moyens corrigés de la tendance (somme nulle)."""
    first = sum(values[:m]) / m
    second = sum(values[m:2 * m]) / m
    trend = (second - first) / m
    center = (m - 1) / 2
    season = []
    for i in range(m):
        a = values[i] - (first + trend * (i - center))
        b = values[m + i] - (second + trend * (i - center))
        season.append((a + b) / 2)
    shift = sum(season) / m
    season = [s - shift for s in season]
    level = first + trend * center
    return level, trend, season


def _holt_winters(values, m, alpha, beta, gamma, phi):
    """Filtre de Holt-Winters additif à partir de la deuxième saison ; erreurs à un pas comptées à partir de
    la troisième saison seulement : les deux premières ont servi à l'initialisation, le modèle s'y jugerait
    sur ses propres points (erreurs trop faibles, intervalles et probabilités trop resserrés)."""
    level, trend, season = _hw_init(values, m)
    residuals = []
    for t in range(m, len(values)):
        y = values[t]
        s = season[t % m]
        if t >= 2 * m:
            residuals.append(y - (level + phi * trend + s))
        new_level = alpha * (y - s) + (1 - alpha) * (level + phi * trend)
        trend = beta * (new_level - level) + (1 - beta) * phi * trend
        season[t % m] = gamma * (y - new_level) + (1 - gamma) * s
        level = new_level
    return level, trend, season, residuals


def _sse(residuals):
    return sum(e * e for e in residuals)


def _mape(values, residuals):
    """MAPE (%) des erreurs à un pas du dernier tiers de la série (trois points au moins), actuals nuls exclus."""
    if not residuals:
        return None
    window = max(3, len(residuals) // 3)
    actuals = values[len(values) - len(residuals):]
    pairs = list(zip(actuals, residuals))[-window:]
    errors = [abs(e) / abs(y) for y, e in pairs if y]
    return sum(errors) / len(errors) * 100.0 if errors else None


def _sigma(residuals):
    return math.sqrt(_sse(residuals) / len(residuals)) if residuals else 0.0


def forecast_series(values, horizon, season=12):
    """Prévision de `horizon` périodes après la série.

    Renvoie {forecast, low, high, method (holt_winters | holt | naive), mape, params, residuals, coefficients,
    sigma, n} : low et high bornent un intervalle de prévision à 80 % ; mape est en % (12,5 = 12,5 %) ;
    residuals sont les erreurs de prévision à un pas (pour probability_reach) ; coefficients, les poids
    c_1 … c_(h-1) par lesquels une erreur se propage aux mois suivants (l'erreur à h pas vaut ε_h + Σ c_j
    ε_(h-j), modèles ETS de classe 1) ; sigma l'écart quadratique moyen des erreurs. Holt-Winters exige deux
    saisons d'initialisation et six mois au-delà pour juger son ajustement. Ne lève jamais d'exception :
    série vide -> listes vides ; série courte (moins de 4 points) ou constante -> méthode naive ; valeurs
    manquantes (None, NaN) comptées pour 0."""
    ys = []
    for v in values or ():
        v = float(v) if v is not None else 0.0
        ys.append(0.0 if math.isnan(v) or math.isinf(v) else v)
    n = len(ys)
    horizon = max(0, int(horizon or 0))
    nonnegative = all(y >= 0 for y in ys)
    constant = n > 0 and max(ys) == min(ys)

    def result(points, widths, method, residuals, params, coefficients):
        sigma = _sigma(residuals)
        low = [p - Z80 * sigma * w for p, w in zip(points, widths)]
        high = [p + Z80 * sigma * w for p, w in zip(points, widths)]
        if nonnegative:
            points, low, high = ([max(0.0, v) for v in seq] for seq in (points, low, high))
        return {"forecast": points, "low": low, "high": high, "method": method, "mape": _mape(ys, residuals),
                "params": params, "residuals": residuals, "coefficients": coefficients, "sigma": sigma, "n": n}

    if not n:
        return {"forecast": [], "low": [], "high": [], "method": "naive", "mape": None, "params": {},
                "residuals": [], "coefficients": [], "sigma": 0.0, "n": 0}

    if not constant and season and season > 1 and n >= 2 * season + 6:
        best = None
        for alpha in HW_ALPHAS:
            for beta in HW_BETAS:
                for gamma in HW_GAMMAS:
                    for phi in HW_PHIS:
                        fit = _holt_winters(ys, season, alpha, beta, gamma, phi)
                        score = _sse(fit[3])
                        if best is None or score < best[0] - 1e-9 * (1 + best[0]):
                            best = (score, (alpha, beta, gamma, phi), fit)
        _score, (alpha, beta, gamma, phi), (level, trend, seasonal, residuals) = best
        points, widths, coefficients = [], [], []
        variance = 1.0
        for h in range(1, horizon + 1):
            points.append(level + _phi_sum(phi, h) * trend + seasonal[(n - 1 + h) % season])
            if h > 1:
                j = h - 1
                c = alpha + alpha * beta * _phi_sum(phi, j) + gamma * (1 - alpha) * (1 if j % season == 0 else 0)
                coefficients.append(c)
                variance += c * c
            widths.append(math.sqrt(variance))
        return result(points, widths, "holt_winters", residuals,
                      {"alpha": alpha, "beta": beta, "gamma": gamma, "phi": phi, "season": season}, coefficients)

    if not constant and n >= 4:
        best = None
        for alpha in HOLT_ALPHAS:
            for beta in HOLT_BETAS:
                for phi in HOLT_PHIS:
                    fit = _holt(ys, alpha, beta, phi)
                    score = _sse(fit[2])
                    if best is None or score < best[0] - 1e-9 * (1 + best[0]):
                        best = (score, (alpha, beta, phi), fit)
        _score, (alpha, beta, phi), (level, trend, residuals) = best
        points, widths, coefficients = [], [], []
        variance = 1.0
        for h in range(1, horizon + 1):
            points.append(level + _phi_sum(phi, h) * trend)
            if h > 1:
                c = alpha + alpha * beta * _phi_sum(phi, h - 1)
                coefficients.append(c)
                variance += c * c
            widths.append(math.sqrt(variance))
        return result(points, widths, "holt", residuals, {"alpha": alpha, "beta": beta, "phi": phi}, coefficients)

    # Naïf (série courte ou constante) : dernière valeur ; erreurs = variations successives (marche
    # aléatoire, σ × √h : chaque erreur se reporte entière sur les mois suivants).
    residuals = [ys[i] - ys[i - 1] for i in range(1, n)]
    points = [ys[-1]] * horizon
    widths = [math.sqrt(h) for h in range(1, horizon + 1)]
    return result(points, widths, "naive", residuals, {}, [1.0] * max(0, horizon - 1))


# ─── Simulation ───────────────────────────────────────────────────────────


def _simulated_totals(history, forecast, residuals, draws, seed, nonnegative, coefficients=None):
    base = sum(float(v or 0.0) for v in history or ())
    points = [float(v or 0.0) for v in forecast or ()]
    errors = [float(e) for e in residuals or () if e is not None]
    weights = [float(c) for c in coefficients or ()]
    if not points or not errors:
        return [base + sum(points)]
    rng = random.Random(seed)
    totals = []
    for _ in range(max(1, int(draws))):
        total = base
        shocks = []
        for h, p in enumerate(points):
            # Trajectoire : le choc du mois et ceux des mois précédents, propagés par les poids du modèle.
            shocks.append(rng.choice(errors))
            error = shocks[h] + sum(weights[j - 1] * shocks[h - j] for j in range(1, h + 1) if j <= len(weights))
            value = p + error
            total += max(0.0, value) if nonnegative else value
        totals.append(total)
    return totals


def probability_reach(history, forecast, target, residuals, draws=1000, seed=7, *, nonnegative=False,
                      coefficients=None):
    """Probabilité (0 à 1) que le cumul réalisé (history) plus les périodes prévues atteigne target.

    Monte-Carlo à graine fixe : on simule des trajectoires, chaque mois recevant un choc tiré avec remise
    parmi les erreurs de prévision à un pas observées (bootstrap des résidus) ; avec coefficients (ceux de
    forecast_series), les chocs des mois précédents se propagent comme dans le modèle, sans quoi les mois
    seraient indépendants et la fourchette trop étroite (une probabilité de 9 % pour 29 %). Sans résidu, la
    réponse est 0 ou 1 selon la prévision ponctuelle ; None sans cible. nonnegative ramène à 0 une période
    simulée négative (chiffre d'affaires)."""
    if target is None:
        return None
    totals = _simulated_totals(history, forecast, residuals, draws, seed, nonnegative, coefficients)
    return sum(1 for t in totals if t >= target) / len(totals)


def total_distribution(history, forecast, residuals, draws=1000, seed=7, *, nonnegative=False, coefficients=None):
    """Distribution simulée du cumul (même tirage que probability_reach) : {p10, p50, p90, mean}."""
    totals = _simulated_totals(history, forecast, residuals, draws, seed, nonnegative, coefficients)
    return {"p10": stats.quantile(totals, 0.1), "p50": stats.quantile(totals, 0.5),
            "p90": stats.quantile(totals, 0.9), "mean": stats.mean(totals)}


# ─── Rupture ──────────────────────────────────────────────────────────────


def cusum(values, k=0.5, h=4.0, baseline=None):
    """Détection de rupture de niveau par CUSUM tabulaire (Page, 1954).

    Les valeurs sont centrées et réduites sur une période de référence (la première moitié de la série,
    trois points au moins, ou les `baseline` premiers points) ; on cumule les écarts au-delà de k écarts-
    types (S+ vers le haut, S- vers le bas) et on signale une rupture dès qu'un cumul dépasse h. Le point de
    rupture estimé est le début de la séquence qui a déclenché l'alerte.

    Renvoie {change, index, alarm_index, direction (up | down), statistic, mean_before, mean_after, upper,
    lower} ; index et direction None sans rupture (ou sous six points)."""
    xs = [float(v or 0.0) for v in (values or ())]
    n = len(xs)
    result = {"change": False, "index": None, "alarm_index": None, "direction": None, "statistic": 0.0,
              "mean_before": None, "mean_after": None, "upper": [0.0] * n, "lower": [0.0] * n}
    if n < 6:
        return result
    n0 = min(n, max(3, int(baseline) if baseline else n // 2))
    reference = xs[:n0]
    mu = stats.mean(reference)
    sigma = stats.stdev(reference) or stats.stdev(xs)
    if not sigma:
        return result
    upper, lower = [], []
    sp = sn = 0.0
    start_p = start_n = 0
    for t, x in enumerate(xs):
        z = (x - mu) / sigma
        if sp == 0.0:
            start_p = t
        if sn == 0.0:
            start_n = t
        sp = max(0.0, sp + z - k)
        sn = max(0.0, sn - z - k)
        upper.append(sp)
        lower.append(sn)
        if not result["change"] and (sp > h or sn > h):
            up = sp >= sn
            index = start_p if up else start_n
            result.update(change=True, index=index, alarm_index=t, direction="up" if up else "down",
                          statistic=sp if up else sn, mean_before=stats.mean(xs[:index]) if index else None,
                          mean_after=stats.mean(xs[index:]))
    result["upper"], result["lower"] = upper, lower
    if not result["change"]:
        result["statistic"] = max(max(upper), max(lower))
    return result
