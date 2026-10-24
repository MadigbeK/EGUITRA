"""Écriture des nombres dans les textes du noyau, alignée sur apps/web/lib/format.ts (le contrat entre
l'écran et le noyau) : un même montant, un même délai, un même ratio s'écrivent pareil partout.

- Montant abrégé (money_short) : « 1,74 Md » (deux décimales, « Md » invariable), « 384 M » (millions
  entiers dès 100 M), « 7,0 M » (une décimale sous 100 M), « 224 050 » (entier groupé sous le million,
  jamais « 224 k ») ; un montant qui s'arrondirait à « 1 000 M » s'écrit « 1,00 Md », et « 99,96 M »
  s'écrit « 100 M ».
- Délai (days) : une décimale, « 56,5 jours ».
- Ratio (ratio) : deux décimales, « 1,23 ».
Arrondi au plus proche, demi vers le haut, comme Math.round ; jamais « -0 ».
"""

import math


def _round(value, digits=0):
    factor = 10 ** digits
    return math.floor(value * factor + 0.5) / factor


def number(value, digits=0):
    """1 234,5 : milliers groupés par une espace, virgule décimale, arrondi comme l'écran."""
    if value is None:
        return "–"
    rounded = _round(value, digits)
    if rounded == 0:
        rounded = 0.0  # jamais « -0 »
    return f"{rounded:,.{digits}f}".replace(",", " ").replace(".", ",")


def money_short(value, unit="GNF"):
    """Montant abrégé, unité facultative : 1 740 000 000 -> « 1,74 Md GNF », 7 040 000 -> « 7,0 M GNF »."""
    if value is None:
        return "–"
    suffix = f" {unit}" if unit else ""
    amount = abs(value)
    if amount >= 1e9 or _round(amount / 1e6) >= 1000:
        return f"{number(value / 1e9, 2)} Md{suffix}"
    if _round(amount) >= 1e6:
        if _round(amount / 1e5) >= 1000:
            return f"{number(value / 1e6, 0)} M{suffix}"
        return f"{number(value / 1e6, 1)} M{suffix}"
    return f"{number(value, 0)}{suffix}"


def days(value):
    """Délai à une décimale : 56.5 -> « 56,5 jours », 1 -> « 1,0 jour »."""
    if value is None:
        return "–"
    return f"{number(value, 1)} jour{'s' if abs(_round(value, 1)) >= 2 else ''}"


def ratio(value):
    """Ratio sans unité à deux décimales : 2.9 -> « 2,90 »."""
    return number(value, 2)
