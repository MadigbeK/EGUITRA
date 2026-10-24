"""Écriture des nombres dans les documents et les messages du Transport : la règle d'apps/web/lib/format.ts.

Milliers toujours groupés, virgule décimale, espace insécable avant l'unité, arrondi demi vers le
haut et jamais « -0 » ; montants en GNF sans décimale ; volumes en m³ à deux décimales ; jours à une
décimale et ratios à deux (dans les classeurs, par le format des cellules). Les documents écrivent
les montants en entier (tableaux, relevés) : les abréviations « Md » et « M » des chiffres clés n'y
servent pas.

Le groupe des milliers est l'espace insécable ordinaire (U+00A0), et non l'espace fine de l'écran :
les polices des PDF ne l'ont pas toutes. Les factures gardent leurs volumes à trois décimales
(models/rotation.py, fmt_m3), comme la quantité facturée.
"""

from decimal import ROUND_HALF_UP, Decimal

INSECABLE = " "


def _round(value, digits):
    """Arrondi demi vers le haut à `digits` décimales, sans « -0 »."""
    result = Decimal(str(value or 0)).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)
    return abs(result) if result == 0 else result


def fixe(value, digits):
    """Nombre à `digits` décimales fixes, milliers groupés : « 1 365,46 », « 23,0 », « 12 500 »."""
    return f"{_round(value, digits):,.{digits}f}".replace(",", INSECABLE).replace(".", ",")


def fmt_int(value):
    """« 1 234 567 »"""
    return fixe(value, 0)


def fmt_money(value, currency="GNF"):
    """« 1 234 567 GNF »"""
    return f"{fmt_int(value)}{INSECABLE}{currency}"


def fmt_volume(value, unit=True):
    """Volume à deux décimales : « 36,50 m³ » (unit=False : « 36,50 »)."""
    return f"{fixe(value, 2)}{INSECABLE}m³" if unit else fixe(value, 2)


def fmt_rate(value):
    """Taux contractuel (commission, tolérance) tel que saisi, sans zéro inutile : « 15 % », « 2,5 % »."""
    text = f"{_round(value, 3):f}".rstrip("0").rstrip(".") if value else "0"
    return f"{text.replace('.', ',')}{INSECABLE}%"
