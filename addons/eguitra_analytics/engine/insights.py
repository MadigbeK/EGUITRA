"""Constats (insights) : structure, score d'impact et tri (spécification, chapitre 4).

Un constat est un dictionnaire sérialisable ; `insight()` le construit et calcule son score. Le score
combine l'impact en GNF (log, pour qu'un constat à 2 Md ne masque pas tout), la gravité et la
confiance ; les constats « positive » passent après les problèmes de même poids mais restent
présents (une synthèse n'est jamais que négative).
"""

import math

from odoo.addons.eguitra_finance.formats import money_short

SEVERITIES = ("critical", "high", "medium", "info", "positive")
SEVERITY_WEIGHT = {"critical": 5.0, "high": 3.5, "medium": 2.0, "info": 1.0, "positive": 1.5}


def insight(key, domain, severity, title, narrative, *, metric=None, impact_gnf=None, confidence=0.8,
            method="", evidence=None, action=None, link=None):
    """Constat prêt à servir. metric : {label, value, unit, reference, reference_label}."""
    if severity not in SEVERITIES:
        raise ValueError(f"Gravité inconnue : {severity}")
    confidence = max(0.0, min(1.0, float(confidence)))
    impact = abs(float(impact_gnf)) if impact_gnf else 0.0
    score = SEVERITY_WEIGHT[severity] * (1.0 + math.log10(1.0 + impact / 1_000_000.0)) * (0.5 + confidence / 2)
    return {
        "id": key, "domain": domain, "severity": severity, "title": title, "narrative": narrative,
        "metric": metric, "impact_gnf": round(impact_gnf) if impact_gnf else None,
        "confidence": round(confidence, 2), "method": method, "evidence": evidence, "action": action,
        "link": link, "score": round(score, 3),
    }


def rank(items, limit=6):
    """Constats triés par score décroissant, `limit` au plus, au moins un constat positif s'il en
    existe un et que la liste en compte trois ou plus (à la dernière place)."""
    ordered = sorted(items, key=lambda i: (-i["score"], i["id"]))
    selected = ordered[:limit]
    if limit >= 3 and not any(i["severity"] == "positive" for i in selected):
        positive = next((i for i in ordered if i["severity"] == "positive"), None)
        if positive:
            selected = selected[:limit - 1] + [positive]
    return selected


def gnf(value):
    """Montant lisible, même règle que l'écran (eguitra_finance.formats.money_short) : 1 234 567 890 ->
    « 1,23 Md GNF », 12 500 000 -> « 12,5 M GNF », 384 200 000 -> « 384 M GNF », 12 500 -> « 12 500 GNF »."""
    return money_short(value)


def pct(value, digits=1):
    """Pourcentage français : 12.345 -> « 12,3 % »."""
    if value is None:
        return "–"
    return f"{value:,.{digits}f} %".replace(",", " ").replace(".", ",")
