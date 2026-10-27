"""Montants en toutes lettres, chiffres romains et nombres des documents imprimés, en français.

Sans accès à la base : les factures (eguitra_base), les bulletins de paie (eguitra_rh, par son moteur)
et les tests l'utilisent. Les nombres suivent la règle d'apps/web/lib/format.ts : milliers groupés,
virgule décimale, arrondi demi vers le haut, jamais « -0 ». Le groupe des milliers est l'espace
insécable ordinaire (U+00A0), et non l'espace fine de l'écran : les polices des PDF ne l'ont pas toutes.
"""

from decimal import ROUND_HALF_UP, Decimal

INSECABLE = " "
# Franc guinéen : montant entier, sans centimes.
GNF = ("franc guinéen", "francs guinéens")
CENTIMES = ("centime", "centimes")

_UNITS = ["", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze",
          "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"]
_TENS = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante", "soixante", "quatre-vingt", "quatre-vingt"]
_ROMAN = [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
          (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]


# ─── Montants en toutes lettres ───────────────────────────────────────────


def _below_100(n):
    if n < 20:
        return _UNITS[n]
    tens, unit = divmod(n, 10)
    if tens in (7, 9):
        unit += 10
    word = _TENS[tens]
    if unit == 0:
        return word + ("s" if tens == 8 else "")
    if unit in (1, 11) and tens not in (8, 9):
        return f"{word} et {_UNITS[unit]}"
    return f"{word}-{_UNITS[unit]}"


def _below_1000(n):
    hundreds, rest = divmod(n, 100)
    if hundreds == 0:
        return _below_100(rest)
    head = "cent" if hundreds == 1 else f"{_UNITS[hundreds]} cent"
    if rest == 0:
        return head + ("s" if hundreds > 1 else "")
    return f"{head} {_below_100(rest)}"


def _words(n):
    parts = []
    for size, singular, plural in ((10**9, "milliard", "milliards"), (10**6, "million", "millions"), (1000, "mille", "mille")):
        count, n = divmod(n, size)
        if not count:
            continue
        if size == 1000:
            # « cent » et « vingt » restent invariables devant « mille » (deux cent mille).
            head = _below_1000(count)
            if head.endswith(("cents", "vingts")):
                head = head[:-1]
            parts.append("mille" if count == 1 else f"{head} mille")
        else:
            parts.append(f"{_words(count)} {singular if count == 1 else plural}")
    if n:
        parts.append(_below_1000(n))
    return " ".join(parts)


def _with_unit(n, singular, plural):
    """« zéro franc guinéen », « un franc guinéen », « un million de francs guinéens », « un million
    d'euros », « deux cent mille quatre-vingts francs guinéens »."""
    if n == 0:
        return f"zéro {singular}"
    if n == 1:
        return f"un {singular}"
    words = _words(n)
    joint = " "
    if words.endswith(("million", "millions", "milliard", "milliards")):
        joint = " d'" if plural[:1].lower() in "aeiouyéèêàâîôû" else " de "
    return f"{words}{joint}{plural}"


def _label(value, default):
    """Libellé d'une unité de devise (« Euros » du noyau) : au pluriel et en minuscules, singulier sans le
    « s » final ; un code (« XOF ») reste tel quel."""
    label = (value or "").strip()
    if not label:
        return default
    if label.isupper():
        return (label, label)
    plural = label.lower()
    return (plural[:-1] if plural.endswith("s") else plural, plural)


def _units(currency):
    """(singulier, pluriel, centime au singulier et au pluriel, décimales) d'une devise : None ou « GNF »
    pour le franc guinéen, un autre code, ou un enregistrement res.currency du noyau."""
    code = currency if isinstance(currency, str) or currency is None else currency.name
    if not code or code == "GNF":
        return (*GNF, *CENTIMES, 0)
    if isinstance(currency, str):
        return (code, code, *CENTIMES, 2)
    unit = _label(currency.currency_unit_label, (code, code))
    subunit = _label(currency.currency_subunit_label, CENTIMES)
    return (*unit, *subunit, currency.decimal_places)


def amount_in_words(value, currency=None):
    """Montant en toutes lettres : « deux cent mille quatre-vingts francs guinéens ».

    currency : None ou « GNF » (francs guinéens, montant entier, arrondi au franc), un autre code de devise
    (« USD » : son code), ou une devise du noyau (res.currency) : son libellé (« euros »), et ses centimes
    quand le montant en porte (« mille deux cents euros et cinquante cents »)."""
    singular, plural, sub_singular, sub_plural, digits = _units(currency)
    amount = Decimal(str(value or 0)).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)
    sign = "moins " if amount < 0 else ""
    amount = abs(amount)
    whole = int(amount)
    cents = int((amount - whole) * 10**digits)
    if cents and not whole:
        return sign + _with_unit(cents, sub_singular, sub_plural)
    text = _with_unit(whole, singular, plural)
    if cents:
        text += " et " + _with_unit(cents, sub_singular, sub_plural)
    return sign + text


def capitalize(text):
    """Première lettre en majuscule, le reste inchangé (« Deux millions de francs guinéens »)."""
    return text[:1].upper() + text[1:] if text else text


def roman(n):
    """Chiffres romains des rubriques d'une facture : 1 -> « I », 4 -> « IV », 14 -> « XIV »."""
    result = []
    for value, letters in _ROMAN:
        count, n = divmod(n, value)
        result.append(letters * count)
    return "".join(result)


# ─── Nombres des documents ────────────────────────────────────────────────


def _round(value, digits):
    """Arrondi demi vers le haut à `digits` décimales, sans « -0 »."""
    result = Decimal(str(value or 0)).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)
    return abs(result) if result == 0 else result


def number(value, digits=0):
    """Nombre à `digits` décimales fixes, milliers groupés : « 1 365,46 », « 12 500 »."""
    return f"{_round(value, digits):,.{digits}f}".replace(",", INSECABLE).replace(".", ",")


def number_trim(value, max_digits=3):
    """Nombre à `max_digits` décimales au plus, sans zéro final : « 2,5 », « 39 875 », « 452,125 »."""
    text = number(value, max_digits)
    if max_digits and "," in text:
        text = text.rstrip("0").rstrip(",")
    return text


def money(value, currency_name="GNF", digits=0):
    """« 1 234 567 GNF », « 1 250,50 USD »."""
    return f"{number(value, digits)}{INSECABLE}{currency_name}"
