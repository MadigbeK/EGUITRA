"""Statistiques descriptives et robustes, régression, concentration (bibliothèque standard seulement).

Conventions communes : les valeurs None (et NaN) sont ignorées ; une statistique indéfinie (série vide,
dénominateur nul) vaut None plutôt que de lever une erreur ; les pourcentages sont exprimés en points
(12,5 = 12,5 %), les parts de la courbe de Lorenz et le coefficient de Gini en fractions (0 à 1).
"""

import math

# Constante du score robuste d'Iglewicz et Hoaglin : 0,6745 = quantile 75 % de la loi normale, qui
# rend la MAD comparable à un écart-type pour une distribution normale.
ROBUST_Z = 0.6745
# Seuil usuel d'un score robuste « aberrant » (Iglewicz et Hoaglin, 1993).
OUTLIER_Z = 3.5


def _clean(values):
    out = []
    for v in values or ():
        if v is None:
            continue
        v = float(v)
        if math.isnan(v):
            continue
        out.append(v)
    return out


def mean(values):
    xs = _clean(values)
    return sum(xs) / len(xs) if xs else None


def weighted_mean(values, weights):
    """Moyenne pondérée ; paires dont la valeur ou le poids manque ignorées ; None si poids nul."""
    pairs = [(float(v), float(w)) for v, w in zip(values, weights) if v is not None and w is not None]
    total = sum(w for _v, w in pairs)
    return sum(v * w for v, w in pairs) / total if total else None


def stdev(values, sample=True):
    """Écart-type (échantillon par défaut : n - 1) ; None sous deux valeurs."""
    xs = _clean(values)
    n = len(xs)
    if n < 2:
        return None
    m = sum(xs) / n
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1 if sample else n))


def quantile(values, q):
    """Quantile par interpolation linéaire entre les rangs (méthode 7 de Hyndman et Fan, celle des
    tableurs) ; None si la série est vide."""
    xs = sorted(_clean(values))
    if not xs:
        return None
    q = min(1.0, max(0.0, float(q)))
    h = (len(xs) - 1) * q
    lo = math.floor(h)
    hi = min(lo + 1, len(xs) - 1)
    return xs[lo] + (h - lo) * (xs[hi] - xs[lo])


def median(values):
    return quantile(values, 0.5)


def mad(values):
    """Écart absolu médian : médiane des |x - médiane| ; None si la série est vide."""
    xs = _clean(values)
    if not xs:
        return None
    m = median(xs)
    return median([abs(x - m) for x in xs])


def robust_z(values):
    """Score robuste de chaque valeur, dans l'ordre reçu : 0,6745 × (x - médiane) / MAD. Insensible aux
    valeurs extrêmes (contrairement au score z classique) ; 0 pour toutes si la MAD est nulle, None à la
    place d'une valeur manquante."""
    items = list(values or ())
    xs = _clean(items)
    if not xs:
        return [None for _ in items]
    m = median(xs)
    spread = mad(xs)
    result = []
    for v in items:
        if v is None or (isinstance(v, float) and math.isnan(v)):
            result.append(None)
        elif not spread:
            result.append(0.0)
        else:
            result.append(ROBUST_Z * (float(v) - m) / spread)
    return result


def linear_regression(xs, ys):
    """Moindres carrés ordinaires y = intercept + slope × x.

    Renvoie {slope, intercept, r2, stderr, n, se_regression, t} : stderr est l'erreur type de la pente,
    se_regression l'erreur type des résidus (n - 2 degrés de liberté), t = slope / stderr (au-delà de 2
    en valeur absolue, la pente est significative au seuil usuel). Paires incomplètes ignorées ; pente et
    ordonnée None sous deux points ou si x est constant (ordonnée : moyenne de y) ; R² vaut 1 quand y est
    constant (ajustement parfait par une pente nulle)."""
    pairs = [(float(x), float(y)) for x, y in zip(xs, ys) if x is not None and y is not None]
    n = len(pairs)
    result = {"slope": None, "intercept": None, "r2": None, "stderr": None, "n": n, "se_regression": None,
              "t": None}
    if not n:
        return result
    mx = sum(x for x, _y in pairs) / n
    my = sum(y for _x, y in pairs) / n
    sxx = sum((x - mx) ** 2 for x, _y in pairs)
    if n < 2 or sxx == 0:
        result["intercept"] = my
        return result
    sxy = sum((x - mx) * (y - my) for x, y in pairs)
    syy = sum((y - my) ** 2 for _x, y in pairs)
    slope = sxy / sxx
    intercept = my - slope * mx
    ss_res = sum((y - intercept - slope * x) ** 2 for x, y in pairs)
    result.update(slope=slope, intercept=intercept, r2=(1.0 - ss_res / syy) if syy > 0 else 1.0)
    if n > 2:
        se = math.sqrt(max(0.0, ss_res) / (n - 2))
        stderr = se / math.sqrt(sxx)
        exact = stderr <= 1e-9 * max(1.0, abs(slope))
        result.update(se_regression=se, stderr=stderr, t=None if exact else slope / stderr)
    return result


def correlation(xs, ys):
    """Coefficient de corrélation de Pearson ; None si une des séries est constante."""
    pairs = [(float(x), float(y)) for x, y in zip(xs, ys) if x is not None and y is not None]
    n = len(pairs)
    if n < 2:
        return None
    mx = sum(x for x, _y in pairs) / n
    my = sum(y for _x, y in pairs) / n
    sxx = sum((x - mx) ** 2 for x, _y in pairs)
    syy = sum((y - my) ** 2 for _x, y in pairs)
    if not sxx or not syy:
        return None
    return sum((x - mx) * (y - my) for x, y in pairs) / math.sqrt(sxx * syy)


def cagr(first, last, periods):
    """Taux de croissance annuel (ou par période) composé, en % : ((last / first)^(1 / periods) - 1) × 100 ;
    None si first n'est pas positif, last négatif ou periods non positif."""
    if first is None or last is None or periods is None or first <= 0 or last < 0 or periods <= 0:
        return None
    return ((last / first) ** (1.0 / periods) - 1.0) * 100.0


def pct_change(new, old):
    """Variation en % : (new - old) / |old| × 100 ; None si old est nul ou manquant."""
    if new is None or old is None or not old:
        return None
    return (new - old) / abs(old) * 100.0


def hhi(values):
    """Indice de Herfindahl-Hirschman : somme des carrés des parts en % (0 à 10 000). Repères du
    département de la Justice américain : moins de 1 500, peu concentré ; 1 500 à 2 500, modérément ;
    au-delà de 2 500, très concentré. Valeurs négatives ramenées à 0 ; None si le total est nul."""
    xs = [max(0.0, v) for v in _clean(values)]
    total = sum(xs)
    if total <= 0:
        return None
    return sum((x / total * 100.0) ** 2 for x in xs)


def lorenz(values, max_points=None):
    """Courbe de Lorenz et coefficient de Gini.

    Valeurs triées par ordre croissant ; points {x : part cumulée des individus, y : part cumulée des
    valeurs}, de (0, 0) à (1, 1), en fractions arrondies à 4 décimales. Gini = 1 - Σ (x_i - x_{i-1}) ×
    (y_i + y_{i-1}) (aire par trapèzes) : 0 pour une distribution égale, proche de 1 quand un seul
    individu porte tout. Valeurs négatives ramenées à 0. max_points réduit le nombre de points renvoyés
    (le Gini reste calculé sur toutes les valeurs)."""
    xs = sorted(max(0.0, v) for v in _clean(values))
    n = len(xs)
    total = sum(xs)
    if not n or total <= 0:
        return {"points": [], "gini": None}
    points = [(0.0, 0.0)]
    cumulative = 0.0
    area = 0.0
    for i, x in enumerate(xs, start=1):
        previous = cumulative / total
        cumulative += x
        current = cumulative / total
        area += (current + previous) / n
        points.append((i / n, current))
    gini = max(0.0, min(1.0, 1.0 - area))
    if max_points and len(points) > max_points >= 2:
        step = (len(points) - 1) / (max_points - 1)
        points = [points[round(i * step)] for i in range(max_points)]
    return {"points": [{"x": round(x, 4), "y": round(y, 4)} for x, y in points], "gini": gini}


def pareto_count(values, share=0.8):
    """Nombre d'individus (les plus gros d'abord) qui portent `share` (fraction, 0,8 par défaut) du
    total ; 0 si le total est nul."""
    xs = sorted((max(0.0, v) for v in _clean(values)), reverse=True)
    total = sum(xs)
    if total <= 0:
        return 0
    cumulative = 0.0
    for i, x in enumerate(xs, start=1):
        cumulative += x
        if cumulative >= share * total - 1e-9 * total:
            return i
    return len(xs)


def linear_score(value, worst, best):
    """Note de 0 à 100 par interpolation linéaire entre une borne « pire » (0) et une borne « meilleure »
    (100), bornée aux extrémités ; fonctionne dans les deux sens (worst > best pour un ratio dont la
    baisse est favorable). None si value est None."""
    if value is None:
        return None
    if best == worst:
        return 100.0 if value >= best else 0.0
    return max(0.0, min(100.0, (value - worst) / (best - worst) * 100.0))


def norm_cdf(x):
    """Fonction de répartition de la loi normale centrée réduite."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))
