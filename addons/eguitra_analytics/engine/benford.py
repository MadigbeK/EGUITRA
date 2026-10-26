"""Loi de Benford : test du premier chiffre et des deux premiers chiffres significatifs.

Dans une population de montants « naturels » (factures, dépenses) couvrant plusieurs ordres de grandeur,
la proportion des montants dont le premier chiffre est d vaut log10(1 + 1/d) : 30,1 % de 1, 4,6 % de 9.
Un écart signale des montants fabriqués ou fractionnés (seuils d'approbation contournés), des doublons ou
une population hétérogène ; c'est un indice qui oriente un contrôle par sondage, jamais une preuve.

Mesures (Nigrini, Benford's Law, 2012) : écart absolu moyen (MAD) des proportions, avec ses seuils de
conformité ; khi-deux (8 degrés de liberté pour le premier chiffre, valeur critique 15,51 à 5 %) et sa
probabilité critique, très sensible à la taille de l'échantillon ; z de chaque chiffre avec correction de
continuité (au-delà de 1,96, l'écart est significatif à 5 %). Les proportions observées et attendues sont
données en % (30,1), la MAD en proportion (0,006), comme les seuils publiés.
"""

import math

FIRST_DIGIT_MAD = ((0.006, "close", "Conformité proche"), (0.012, "acceptable", "Acceptable"),
                   (0.015, "marginal", "Conformité marginale"))
FIRST_TWO_MAD = ((0.0012, "close", "Conformité proche"), (0.0018, "acceptable", "Acceptable"),
                 (0.0022, "marginal", "Conformité marginale"))
NONCONFORMITY = ("nonconformity", "Non-conformité")
CHI2_CRITICAL_FIRST = 15.507  # 8 degrés de liberté, 5 %
MIN_SAMPLE = 100
Z_SIGNIFICANT = 1.96


def leading_digits(amount, count=1):
    """Les `count` premiers chiffres significatifs d'un montant (entier), None pour 0."""
    value = abs(float(amount))
    if value == 0 or math.isnan(value) or math.isinf(value):
        return None
    if value >= 10 ** (count - 1):
        digits = str(int(value))
    else:
        digits = f"{value:.{count + 15}e}".replace(".", "")
    digits = digits.lstrip("0")
    return int(digits[:count]) if len(digits) >= count else None


def _chi2_sf_even(x, df):
    """Probabilité critique du khi-deux pour un nombre pair de degrés de liberté (forme fermée)."""
    half = x / 2.0
    term, total = 1.0, 1.0
    for i in range(1, df // 2):
        term *= half / i
        total += term
    return math.exp(-half) * total


def _conformity(mad_value, thresholds):
    if mad_value is None:
        return None, None
    for limit, code, label in thresholds:
        if mad_value <= limit:
            return code, label
    return NONCONFORMITY


def _test(amounts, min_amount, count):
    domain = range(1, 10) if count == 1 else range(10, 100)
    values = []
    for a in amounts or ():
        if a is None or abs(float(a)) < min_amount:
            continue
        d = leading_digits(a, count)
        if d is not None and d in domain:
            values.append(d)
    n = len(values)
    counts = dict.fromkeys(domain, 0)
    for d in values:
        counts[d] += 1
    rows, chi2, deviations = [], 0.0, []
    for d in domain:
        expected = math.log10(1 + 1 / d)
        observed = counts[d] / n if n else 0.0
        z = None
        if n:
            se = math.sqrt(expected * (1 - expected) / n)
            z = max(0.0, abs(observed - expected) - 1 / (2 * n)) / se
            chi2 += (counts[d] - n * expected) ** 2 / (n * expected)
            deviations.append(abs(observed - expected))
        rows.append({"d": d, "count": counts[d], "observed": round(observed * 100, 3),
                     "expected": round(expected * 100, 3), "z": round(z, 3) if z is not None else None,
                     "excess": bool(n and observed > expected and z is not None and z > Z_SIGNIFICANT)})
    mad_value = sum(deviations) / len(deviations) if deviations else None
    return n, rows, (chi2 if n else None), mad_value


def first_digits(amounts, min_amount=1000):
    """Test du premier chiffre sur les montants d'au moins min_amount (en valeur absolue).

    Renvoie {n, digits: [{d, count, observed, expected, z, excess}], chi2, chi2_critical, p_value, mad,
    conformity (close | acceptable | marginal | nonconformity), conformity_label, suspicious (chiffres en
    excès significatif), warning (échantillon de moins de 100 montants), min_amount}."""
    n, rows, chi2, mad_value = _test(amounts, min_amount, 1)
    code, label = _conformity(mad_value, FIRST_DIGIT_MAD)
    return {
        "n": n, "digits": rows, "chi2": chi2, "chi2_critical": CHI2_CRITICAL_FIRST,
        "p_value": _chi2_sf_even(chi2, 8) if chi2 is not None else None,
        "mad": mad_value, "conformity": code, "conformity_label": label,
        "suspicious": [r["d"] for r in rows if r["excess"]],
        "warning": (f"Échantillon de {n} montant{'s' if n > 1 else ''} : sous {MIN_SAMPLE} montants, le test n'est qu'indicatif."
                    if n < MIN_SAMPLE else None),
        "min_amount": min_amount,
    }


def first_two_digits(amounts, min_amount=1000):
    """Test des deux premiers chiffres (10 à 99), plus fin pour repérer un montant répété ou un seuil
    contourné ; mêmes clés que first_digits (seuils de MAD : 0,0012 / 0,0018 / 0,0022)."""
    n, rows, chi2, mad_value = _test(amounts, min_amount, 2)
    code, label = _conformity(mad_value, FIRST_TWO_MAD)
    return {
        "n": n, "digits": rows, "chi2": chi2, "chi2_critical": None, "p_value": None,
        "mad": mad_value, "conformity": code, "conformity_label": label,
        "suspicious": [r["d"] for r in rows if r["excess"]],
        "warning": (f"Échantillon de {n} montant{'s' if n > 1 else ''} : le test des deux premiers chiffres demande plusieurs "
                    "centaines de montants." if n < 5 * MIN_SAMPLE else None),
        "min_amount": min_amount,
    }
