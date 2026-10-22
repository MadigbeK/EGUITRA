"""Moteur de paie (Guinée), sans accès à la base : bulletins, simulateur et tests l'utilisent.

Règles par défaut (docs/projet/rh/specification.md, chapitre 2), toutes paramétrables par société :
- CNSS : part salariale et part patronale sur l'assiette des gains soumis, plafonnée, avec un plancher
  au SMIG au prorata de la présence ; stagiaires et apprentis exclus.
- RTS (CGI, art. 58 et 63) : barème mensuel progressif sur le brut imposable diminué de la cotisation
  CNSS salariale. Les indemnités forfaitaires (logement, transport, panier, cherté de vie) sont
  exonérées dans la limite totale d'un pourcentage du brut (25 %, CGI art. 55-3).
- VF (CGI, art. 201) et taxe de formation (taxe d'apprentissage, art. 204 à 210) : à la charge de
  l'employeur, sur les rémunérations versées (remboursements de frais exclus) ; stagiaires exonérés
  jusqu'à 1 200 000 GNF, apprentis exonérés (art. 203 ter et 206).
Chaque montant est arrondi au franc, demi vers le haut.
"""

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

STAGIAIRE_EXEMPTION = 1_200_000


def gnf(value):
    """Arrondi au franc, demi vers le haut (jamais l'arrondi bancaire de round())."""
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


@dataclass
class Params:
    cnss_employee_rate: float = 5.0
    cnss_employer_rate: float = 18.0
    cnss_ceiling: float = 2_500_000
    smig: float = 550_000
    allowance_exempt_cap: float = 25.0
    brackets: list = field(default_factory=lambda: [(0, 0.0), (1_000_000, 5.0), (3_000_000, 8.0), (5_000_000, 10.0),
                                                    (10_000_000, 15.0), (20_000_000, 20.0)])
    vf_rate: float = 6.0
    training_tax_rate: float = 2.0
    monthly_hours: float = 173.33


@dataclass
class Item:
    """Élément du bulletin : gain (montant signé, une absence est un gain négatif) ou retenue."""
    code: str
    name: str
    kind: str
    amount: float
    cnss: bool = False
    taxable: bool = False
    exempt: bool = False
    account_code: str = ""
    base: float | None = None
    rate: float | None = None
    quantity: float | None = None


def rts_amount(base, brackets):
    """Retenue progressive : chaque tranche [seuil, seuil suivant[ au taux de la tranche."""
    if base <= 0:
        return 0, 0.0
    ordered = sorted(brackets)
    total = 0.0
    marginal = 0.0
    for index, (start, rate) in enumerate(ordered):
        end = ordered[index + 1][0] if index + 1 < len(ordered) else None
        if base <= start:
            break
        slice_ = (min(base, end) if end is not None else base) - start
        total += slice_ * rate / 100.0
        marginal = rate
    return gnf(total), marginal


def hourly_rate(base_salary, params):
    return base_salary / params.monthly_hours if params.monthly_hours else 0.0


def compute(params, gains, deductions, contract_type="cdi", presence=1.0):
    """Calcule un bulletin.

    :param gains: liste d'Item de type gain (montants déjà arrondis ou non : ils sont arrondis ici)
    :param deductions: liste d'Item de type retenue (avances, prêts, autres retenues)
    :param presence: part du mois couverte par le contrat (plancher CNSS au prorata)
    :return: dict des totaux et des lignes du bulletin
    """
    for item in gains + deductions:
        item.amount = gnf(item.amount)
    gross = sum(i.amount for i in gains)
    social = contract_type not in ("stage", "apprentissage")

    cnss_raw = sum(i.amount for i in gains if i.cnss)
    cnss_base = 0
    if social and cnss_raw > 0:
        cnss_base = gnf(min(max(cnss_raw, params.smig * presence), params.cnss_ceiling))
    cnss_employee = gnf(cnss_base * params.cnss_employee_rate / 100.0)
    cnss_employer = gnf(cnss_base * params.cnss_employer_rate / 100.0)

    taxable_gross = sum(i.amount for i in gains if i.taxable)
    allowances = sum(i.amount for i in gains if i.taxable and i.exempt)
    exempt = gnf(min(max(allowances, 0), max(gross, 0) * params.allowance_exempt_cap / 100.0))
    taxable_base = max(taxable_gross - exempt, 0)
    rts_base = max(taxable_base - cnss_employee, 0)
    rts, marginal = rts_amount(rts_base, params.brackets)

    # VF et taxe de formation : rémunérations versées (soumises à la CNSS ou à la RTS), hors
    # remboursements de frais.
    paid = max(sum(i.amount for i in gains if i.cnss or i.taxable), 0)
    if contract_type == "apprentissage":
        employer_base = 0
    elif contract_type == "stage":
        employer_base = max(paid - STAGIAIRE_EXEMPTION, 0)
    else:
        employer_base = paid
    vf = gnf(employer_base * params.vf_rate / 100.0)
    training_tax = gnf(employer_base * params.training_tax_rate / 100.0)

    other = sum(i.amount for i in deductions)
    net = gross - cnss_employee - rts - other
    lines = [_line(i) for i in gains]
    if cnss_employee:
        lines.append({"code": "CNSS", "name": "Cotisation CNSS salariale", "kind": "deduction", "base": cnss_base,
                      "rate": params.cnss_employee_rate, "quantity": None, "amount": cnss_employee})
    if rts:
        lines.append({"code": "RTS", "name": "Retenue sur traitements et salaires", "kind": "deduction",
                      "base": rts_base, "rate": None, "quantity": None, "amount": rts})
    lines += [_line(i) for i in deductions]
    if cnss_employer:
        lines.append({"code": "CNSS_PAT", "name": "Cotisation CNSS patronale", "kind": "employer", "base": cnss_base,
                      "rate": params.cnss_employer_rate, "quantity": None, "amount": cnss_employer})
    if vf:
        lines.append({"code": "VF", "name": "Versement forfaitaire sur les salaires", "kind": "employer",
                      "base": employer_base, "rate": params.vf_rate, "quantity": None, "amount": vf})
    if training_tax:
        lines.append({"code": "TF", "name": "Taxe de formation", "kind": "employer", "base": employer_base,
                      "rate": params.training_tax_rate, "quantity": None, "amount": training_tax})
    return {
        "gross": gross,
        "cnss_base": cnss_base,
        "cnss_employee": cnss_employee,
        "cnss_employer": cnss_employer,
        "taxable_base": taxable_base,
        "exempt_allowances": exempt,
        "rts_base": rts_base,
        "rts": rts,
        "marginal_rate": marginal,
        "employer_base": employer_base,
        "vf": vf,
        "training_tax": training_tax,
        "deductions": other,
        "net": net,
        "employer_cost": gross + cnss_employer + vf + training_tax,
        "lines": lines,
    }


def _line(item):
    return {"code": item.code, "name": item.name, "kind": item.kind, "base": item.base, "rate": item.rate,
            "quantity": item.quantity, "amount": item.amount}


def base_for_net(params, net_target, build, contract_type="cdi"):
    """Salaire de base qui donne le net cible. build(base) renvoie (gains, retenues) pour ce salaire.

    Le net croît avec le salaire de base : recherche par dichotomie, puis ajustement au franc.
    """
    def net_of(base):
        gains, deductions = build(base)
        return compute(params, gains, deductions, contract_type)["net"]

    low, high = 0.0, max(float(net_target), 1.0) * 2
    while net_of(high) < net_target and high < 1e12:
        high *= 2
    for _ in range(80):
        mid = (low + high) / 2
        if net_of(mid) < net_target:
            low = mid
        else:
            high = mid
    base = gnf(high)
    while base > 0 and net_of(base - 1) >= net_target:
        base -= 1
    return base


def amount_in_words(value):
    """Montant en toutes lettres, en français (francs guinéens entiers)."""
    value = int(value)
    if value == 0:
        return "zéro franc guinéen"
    if abs(value) == 1:
        return ("moins " if value < 0 else "") + "un franc guinéen"
    words = ("moins " if value < 0 else "") + _words(abs(value))
    # « un million de francs », mais « un million deux cents francs ».
    joint = " de " if words.endswith(("million", "millions", "milliard", "milliards")) else " "
    return f"{words}{joint}francs guinéens"


_UNITS = ["", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze",
          "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"]
_TENS = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante", "soixante", "quatre-vingt", "quatre-vingt"]


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
