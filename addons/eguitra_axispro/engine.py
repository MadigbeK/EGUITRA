"""Moteur du modèle financier d'un projet : comptes prévisionnels, BFR, dette, flux, rentabilité
(VAN, TRI), couverture de la dette (DSCR, LLCR), point mort, sensibilités et scénarios.

Calcul annuel, sans dépendance au noyau : année 0 = période d'investissement, années 1 à N =
exploitation. Montants hors taxes, dans la devise du dossier (un dossier peut être en USD ou en
EUR : aucune devise n'est écrite en dur, les textes reçoivent la devise du dossier).

Conventions (rappelées à l'écran et dans l'export) :
- coûts variables : coût unitaire de chaque produit et pourcentage du chiffre d'affaires au prix de
  base (un choc sur le prix de vente ne réduit pas le coût des matières) ;
- soldes intermédiaires de gestion à la manière du SYSCOHADA : marge sur coûts variables, valeur
  ajoutée, excédent brut d'exploitation (EBE), résultat d'exploitation, résultat net, CAF ;
- amortissement linéaire à partir de l'année de mise en service (année 1 pour un investissement
  de l'année 0) ;
- subvention d'investissement : ressource de financement, reprise au résultat sur sa durée ;
- impôt sur le résultat avec report des déficits (sans limite ou sur n exercices), exonération des
  premières années, impôt minimum en pourcentage du chiffre d'affaires ;
- BFR = créances clients + stocks - dettes fournisseurs, exprimés en jours ;
- CFADS (flux disponible pour le service de la dette) = EBE - impôt - variation du BFR ;
  DSCR = CFADS / service de la dette de l'année ; LLCR = valeur actuelle des CFADS / valeur
  actuelle du service de la dette, au taux moyen des emprunts ;
- flux du projet = EBE - impôt normatif sur le résultat d'exploitation - variation du BFR -
  investissements ; valeur résiduelle (valeur nette comptable et BFR récupéré) en dernière année ;
- flux des fonds propres = flux après impôt réel, financements externes reçus et service de la
  dette ; la dette restant due est déduite de la valeur résiduelle.
"""

import re

DEFAULT_PARAMS = {
    "horizon": 7,
    "discount_rate": 12.0,
    "tax_rate": 25.0,
    "min_tax_rate": 0.0,
    "tax_holiday": 0,
    "loss_carry_years": 0,
    "receivable_days": 30.0,
    "inventory_days": 30.0,
    "payable_days": 30.0,
    "dscr_target": 1.3,
    "equity_target": 20.0,
    "residual_value": True,
}
MAX_HORIZON = 20

# Variables de sensibilité : facteur multiplicatif appliqué à l'hypothèse.
FACTORS = {
    "price": "Prix de vente",
    "volume": "Volumes vendus",
    "variable": "Coûts variables",
    "fixed": "Charges fixes",
    "capex": "Investissement",
    "rate": "Taux d'intérêt",
}
SCENARIOS = (
    ("pessimiste", "Pessimiste", {"price": 0.90, "volume": 0.85, "variable": 1.05, "fixed": 1.05, "capex": 1.10},
     "Prix -10 %, volumes -15 %, coûts variables et charges fixes +5 %, investissement +10 %"),
    ("base", "Base", {}, "Hypothèses du modèle"),
    ("optimiste", "Optimiste", {"price": 1.05, "volume": 1.10, "variable": 0.97},
     "Prix +5 %, volumes +10 %, coûts variables -3 %"),
)
SHOCKS = (-20, -10, 10, 20)
FIXED_CATEGORIES = ("external", "personnel", "duties", "other")


def _num(value, default=0.0):
    # Pas de « value in (None, "", False) » : 0 == False, un zéro saisi serait remplacé par la valeur par défaut.
    if value is None or value is False or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


INSECABLE = " "  # entre un nombre et son unité, comme à l'écran (apps/web/lib/format.ts)


def nombre(value, digits=0):
    """Nombre écrit à la française dans un texte : milliers groupés par une espace, virgule décimale,
    `digits` décimales fixes, jamais « -0 » (« 1 234 567 », « 1,25 »)."""
    rounded = round(value, digits)
    if rounded == 0:
        rounded = 0.0
    return f"{rounded:,.{digits}f}".replace(",", " ").replace(".", ",")


def taux(value):
    """Taux ou seuil écrit au plus juste, deux décimales au plus, sans zéro inutile : « 12 », « 12,5 »,
    « 1,3 » (et non « 12.5 » ni « 1.3 »)."""
    text = nombre(value, 2)
    return text.rstrip("0").rstrip(",") if "," in text else text


def _montant(value, currency):
    """Montant entier suivi de la devise du dossier quand elle est connue : « 1 500 000 GNF »."""
    return f"{nombre(value)}{INSECABLE}{currency}" if currency else nombre(value)


def npv(rate, flows):
    """Valeur actuelle nette au taux `rate` (fraction) ; flows[0] en t = 0."""
    return sum(f / (1 + rate) ** t for t, f in enumerate(flows))


def irr(flows, low=-0.95, high=10.0):
    """Taux de rendement interne par dichotomie (fraction) ; None si les flux ne changent pas de signe
    ou si aucun taux de l'intervalle n'annule la VAN."""
    if not any(f < 0 for f in flows) or not any(f > 0 for f in flows):
        return None
    f_low, f_high = npv(low, flows), npv(high, flows)
    if f_low * f_high > 0:
        return None
    for _ in range(200):
        mid = (low + high) / 2
        f_mid = npv(mid, flows)
        if abs(f_mid) < 1e-7 or high - low < 1e-12:
            return mid
        if f_low * f_mid < 0:
            high = mid
        else:
            low, f_low = mid, f_mid
    return (low + high) / 2


def ramp_factors(text):
    """« 60;80;100 » : montée en régime, en % de la pleine capacité, par année d'exploitation."""
    values = []
    for part in re.split(r"[;,/\s]+", str(text or "").strip()):
        if part:
            try:
                values.append(max(0.0, float(part)))
            except ValueError:
                continue
    return values


def loan_schedule(amount, rate, duration, grace, start, linear=False):
    """Échéancier annuel d'un emprunt versé en année `start` : intérêts sur l'encours d'ouverture,
    différé d'amortissement de `grace` années, puis annuités constantes ou amortissement constant.

    Renvoie {année: (encours d'ouverture, intérêts, capital remboursé, encours de clôture)}.
    """
    n = max(1, int(duration or 1))
    g = min(max(0, int(grace or 0)), n - 1)
    periods = n - g
    annuity = amount * rate / (1 - (1 + rate) ** -periods) if rate else amount / periods
    rows, balance = {}, amount
    for k in range(1, n + 1):
        interest = balance * rate
        if k <= g:
            principal = 0.0
        elif linear:
            principal = amount / periods
        else:
            principal = annuity - interest
        principal = min(max(principal, 0.0), balance)
        rows[start + k] = (balance, interest, principal, balance - principal)
        balance -= principal
    return rows


def _taxes(bases, revenue, p):
    """Impôt par année : report des déficits (limité à `loss_carry_years` exercices si non nul),
    exonération des `tax_holiday` premières années, impôt minimum en % du chiffre d'affaires."""
    rate, min_rate = p["tax_rate"] / 100, p["min_tax_rate"] / 100
    holiday, carry = int(p["tax_holiday"]), int(p["loss_carry_years"])
    losses, out = [], [0.0] * len(bases)
    for y in range(1, len(bases)):
        base = bases[y]
        if base < 0:
            losses.append([y, -base])
            taxable = 0.0
        else:
            taxable = base
            for loss in losses:
                if carry and y - loss[0] > carry:
                    continue
                used = min(loss[1], taxable)
                loss[1] -= used
                taxable -= used
        if y > holiday:
            out[y] = max(taxable * rate, revenue[y] * min_rate if revenue[y] > 0 else 0.0)
    return out


def _payback(flows):
    """Délai de récupération en années (interpolé) ; None si le cumul ne redevient pas positif."""
    cumul = 0.0
    for t, f in enumerate(flows):
        previous = cumul
        cumul += f
        if t and cumul >= 0 > previous:
            return t - 1 + (-previous / f if f else 0)
    return None


def analyse(params, lines, factors=None, first_year=None, currency=None):
    """Modèle complet. `lines` : dictionnaires de lignes (kind : capex, revenue, variable, fixed,
    funding) ; `factors` : chocs multiplicatifs (clés de FACTORS) ; `currency` : code de la devise du
    dossier, écrit après les montants des alertes (« 1 500 000 USD »)."""
    p = dict(DEFAULT_PARAMS)
    p.update({k: v for k, v in (params or {}).items() if k in DEFAULT_PARAMS and v is not None})
    for key in DEFAULT_PARAMS:
        if key != "residual_value":
            p[key] = _num(p[key], DEFAULT_PARAMS[key])
    fx = dict.fromkeys(FACTORS, 1.0)
    fx.update({k: _num(v, 1.0) for k, v in (factors or {}).items() if k in FACTORS})
    H = int(min(max(1, p["horizon"]), MAX_HORIZON))
    size = H + 1

    def zeros():
        return [0.0] * size

    revenue, base_revenue, unit_costs, depreciation, capex, nbv_end = zeros(), zeros(), zeros(), zeros(), zeros(), 0.0
    fixed = {c: zeros() for c in FIXED_CATEGORIES}
    equity, loans_in, grants_in, grant_release = zeros(), zeros(), zeros(), zeros()
    opening, interest, principal, closing = zeros(), zeros(), zeros(), zeros()
    revenue_lines, loans = [], []

    for line in lines:
        kind = line.get("kind")
        if kind == "revenue":
            qty = _num(line.get("quantity")) * fx["volume"]
            price = _num(line.get("price"))
            unit_cost = _num(line.get("unit_cost"))
            start = max(1, int(_num(line.get("year"), 1)))
            ramps = ramp_factors(line.get("ramp"))
            g_vol, g_price = _num(line.get("growth")) / 100, _num(line.get("price_growth")) / 100
            values = zeros()
            for y in range(start, size):
                k = y - start
                ramp = (ramps[k] if k < len(ramps) else ramps[-1]) / 100 if ramps else 1.0
                volume = qty * ramp * (1 + g_vol) ** k
                inflation = (1 + g_price) ** k
                values[y] = volume * price * inflation * fx["price"]
                revenue[y] += values[y]
                # Les coûts variables suivent les volumes, pas un choc sur le prix de vente.
                base_revenue[y] += volume * price * inflation
                unit_costs[y] += volume * unit_cost * inflation
            revenue_lines.append({"name": line.get("name") or "Produit", "values": values})
        elif kind == "fixed":
            category = line.get("category") if line.get("category") in FIXED_CATEGORIES else "external"
            amount = _num(line.get("amount")) * fx["fixed"]
            start = max(1, int(_num(line.get("year"), 1)))
            growth = _num(line.get("growth")) / 100
            for y in range(start, size):
                fixed[category][y] += amount * (1 + growth) ** (y - start)
        elif kind == "capex":
            amount = _num(line.get("amount")) * fx["capex"]
            year = int(min(max(0, _num(line.get("year"))), H))
            life = int(max(0, _num(line.get("life"))))
            capex[year] += amount
            if life:
                first = max(1, year)
                for y in range(first, min(first + life, size)):
                    depreciation[y] += amount / life
                nbv_end += amount * max(0, life - (H - first + 1)) / life
            else:
                nbv_end += amount  # terrain : non amortissable
        elif kind == "funding":
            amount = _num(line.get("amount"))
            year = int(min(max(0, _num(line.get("year"))), H))
            ftype = line.get("funding_type") or "equity"
            if ftype == "loan":
                loan_rate = _num(line.get("rate")) / 100 * fx["rate"]
                loans.append((amount, loan_rate))
                loans_in[year] += amount
                closing[year] += amount  # encours à la fin de l'année du versement
                schedule = loan_schedule(amount, loan_rate, line.get("life"), line.get("grace"), year,
                                         linear=line.get("repayment") == "linear")
                for y, (o, i, c, end) in schedule.items():
                    if y < size:
                        opening[y] += o
                        interest[y] += i
                        principal[y] += c
                        closing[y] += end
            elif ftype == "grant":
                grants_in[year] += amount
                life = int(max(0, _num(line.get("life"))))
                if life:
                    first = max(1, year)  # reprise au rythme des amortissements
                    for y in range(first, min(first + life, size)):
                        grant_release[y] += amount / life
            else:
                equity[year] += amount

    variable_rate = sum(_num(x.get("rate")) for x in lines if x.get("kind") == "variable") / 100
    variable = [(base_revenue[y] * variable_rate + unit_costs[y]) * fx["variable"] for y in range(size)]

    margin = [revenue[y] - variable[y] for y in range(size)]
    value_added = [margin[y] - fixed["external"][y] - fixed["other"][y] for y in range(size)]
    ebitda = [value_added[y] - fixed["duties"][y] - fixed["personnel"][y] for y in range(size)]
    ebit = [ebitda[y] - depreciation[y] for y in range(size)]
    pretax = [ebit[y] - interest[y] + grant_release[y] for y in range(size)]
    tax = _taxes(pretax, revenue, p)
    net = [pretax[y] - tax[y] for y in range(size)]
    caf = [net[y] + depreciation[y] - grant_release[y] for y in range(size)]

    receivables = [revenue[y] * p["receivable_days"] / 365 for y in range(size)]
    stocks = [variable[y] * p["inventory_days"] / 365 for y in range(size)]
    payables = [(variable[y] + fixed["external"][y]) * p["payable_days"] / 365 for y in range(size)]
    bfr = [receivables[y] + stocks[y] - payables[y] for y in range(size)]
    delta_bfr = [0.0] + [bfr[y] - bfr[y - 1] for y in range(1, size)]

    service = [interest[y] + principal[y] for y in range(size)]
    cfads = [ebitda[y] - tax[y] - delta_bfr[y] if y else 0.0 for y in range(size)]
    dscr = [cfads[y] / service[y] if service[y] > 0 else None for y in range(size)]

    tax_unlevered = _taxes(ebit, revenue, p)
    fcf = [ebitda[y] - tax_unlevered[y] - delta_bfr[y] - capex[y] for y in range(size)]
    fcfe = [ebitda[y] - tax[y] - delta_bfr[y] - capex[y] + loans_in[y] + grants_in[y] - service[y] for y in range(size)]
    cash = [fcfe[y] + equity[y] for y in range(size)]
    debt_end = closing[H]
    residual = nbv_end + bfr[H] if p["residual_value"] else 0.0
    fcf_payback = list(fcf)
    if p["residual_value"]:
        fcf[H] += residual
        fcfe[H] += residual - debt_end
    cumulative, running = [], 0.0
    for value in cash:
        running += value
        cumulative.append(running)

    rate = p["discount_rate"] / 100
    project_irr, equity_irr = irr(fcf), irr(fcfe)
    service_years = [y for y in range(1, size) if service[y] > 0]
    dscr_values = [dscr[y] for y in service_years]
    loan_total = sum(a for a, _r in loans)
    debt_rate = sum(a * r for a, r in loans) / loan_total if loan_total else 0.0
    llcr = None
    if service_years:
        pv_service = sum(service[y] / (1 + debt_rate) ** y for y in service_years)
        pv_cfads = sum(cfads[y] / (1 + debt_rate) ** y for y in service_years)
        llcr = pv_cfads / pv_service if pv_service else None
    discounted = [f / (1 + rate) ** t for t, f in enumerate(fcf_payback)]

    fixed_total = [sum(fixed[c][y] for c in FIXED_CATEGORIES) for y in range(size)]
    breakeven = []
    for y in range(size):
        charges = fixed_total[y] + depreciation[y] + interest[y]
        ratio_margin = margin[y] / revenue[y] if revenue[y] else 0.0
        breakeven.append(charges / ratio_margin if ratio_margin > 0 else None)

    totals = {"equity": sum(equity), "loan": sum(loans_in), "grant": sum(grants_in)}
    resources = sum(totals.values())
    capex_total = sum(capex)
    cash_min = min(cumulative)
    cash_min_year = cumulative.index(cash_min)
    initial_uses = capex[0] + bfr[1] if size > 1 else capex[0]
    initial_resources = equity[0] + loans_in[0] + grants_in[0]
    labels = ["Inv."] + [str(first_year + y - 1) if first_year else f"A{y}" for y in range(1, size)]

    indicators = {
        "npv": npv(rate, fcf),
        "irr_project": project_irr * 100 if project_irr is not None else None,
        "irr_equity": equity_irr * 100 if equity_irr is not None else None,
        "dscr_min": min(dscr_values) if dscr_values else None,
        "dscr_min_year": service_years[dscr_values.index(min(dscr_values))] if dscr_values else None,
        "dscr_avg": sum(dscr_values) / len(dscr_values) if dscr_values else None,
        "llcr": llcr,
        "payback": _payback(fcf_payback),
        "discounted_payback": _payback(discounted),
        "revenue_cruise": revenue[H],
        "ebitda_cruise": ebitda[H],
        "ebitda_margin": ebitda[H] / revenue[H] * 100 if revenue[H] else None,
        "net_margin": net[H] / revenue[H] * 100 if revenue[H] else None,
        "breakeven_revenue": breakeven[H],
        "breakeven_ratio": breakeven[H] / revenue[H] * 100 if breakeven[H] is not None and revenue[H] else None,
        "capex_total": capex_total,
        "funding_total": resources,
        "funding": totals,
        "equity_share": totals["equity"] / resources * 100 if resources else None,
        "gearing": totals["loan"] / (totals["equity"] + totals["grant"]) if totals["equity"] + totals["grant"] else None,
        "cash_min": cash_min,
        "cash_min_year": cash_min_year,
        "net_income_total": sum(net),
        "debt_end": debt_end,
        "residual_value": residual,
        "debt_rate": debt_rate * 100,
    }
    financing_plan = {
        "uses": [{"label": "Investissements de l'année 0", "amount": capex[0]},
                 {"label": "Besoin en fonds de roulement de démarrage", "amount": bfr[1] if size > 1 else 0.0}],
        "resources": [{"label": "Apport des promoteurs", "amount": equity[0]},
                      {"label": "Emprunts", "amount": loans_in[0]},
                      {"label": "Subventions", "amount": grants_in[0]}],
        "uses_total": initial_uses,
        "resources_total": initial_resources,
        "gap": initial_resources - initial_uses,
    }

    def row(key, label, values, strong=False, ratio=False):
        return {"key": key, "label": label, "values": values, "strong": strong, "ratio": ratio}

    statements = [
        row("revenue", "Chiffre d'affaires", revenue, strong=True),
        row("variable", "Coûts variables", [-v for v in variable]),
        row("margin", "Marge sur coûts variables", margin, strong=True),
        row("external", "Services extérieurs", [-v for v in fixed["external"]]),
        row("other", "Autres charges", [-v for v in fixed["other"]]),
        row("value_added", "Valeur ajoutée", value_added, strong=True),
        row("duties", "Impôts et taxes", [-v for v in fixed["duties"]]),
        row("personnel", "Charges de personnel", [-v for v in fixed["personnel"]]),
        row("ebitda", "Excédent brut d'exploitation", ebitda, strong=True),
        row("depreciation", "Dotations aux amortissements", [-v for v in depreciation]),
        row("ebit", "Résultat d'exploitation", ebit, strong=True),
        row("interest", "Charges financières", [-v for v in interest]),
        row("grant_release", "Quote-part de subvention virée au résultat", grant_release),
        row("pretax", "Résultat avant impôt", pretax),
        row("tax", "Impôt sur le résultat", [-v for v in tax]),
        row("net", "Résultat net", net, strong=True),
        row("caf", "Capacité d'autofinancement", caf, strong=True),
    ]
    flows = [
        row("ebitda", "Excédent brut d'exploitation", ebitda),
        row("tax", "Impôt sur le résultat", [-v for v in tax]),
        row("delta_bfr", "Variation du BFR", [-v for v in delta_bfr]),
        row("cfads", "Flux disponible pour la dette (CFADS)", cfads, strong=True),
        row("capex", "Investissements", [-v for v in capex]),
        row("equity", "Apport des promoteurs", equity),
        row("loans", "Emprunts reçus", loans_in),
        row("grants", "Subventions reçues", grants_in),
        row("service", "Service de la dette", [-v for v in service]),
        row("cash", "Trésorerie de l'année", cash, strong=True),
        row("cash_cumulative", "Trésorerie cumulée", cumulative, strong=True),
        row("fcf", "Flux du projet (valeur résiduelle comprise)", fcf),
        row("fcfe", "Flux des fonds propres", fcfe),
    ]
    debt = [
        row("opening", "Encours d'ouverture", opening),
        row("interest", "Intérêts", interest),
        row("principal", "Capital remboursé", principal),
        row("service", "Service de la dette", service, strong=True),
        row("closing", "Encours de clôture", closing),
        row("dscr", "DSCR", dscr, strong=True, ratio=True),
    ]
    working_capital = [
        row("receivables", "Créances clients", receivables),
        row("stocks", "Stocks", stocks),
        row("payables", "Dettes fournisseurs", [-v for v in payables]),
        row("bfr", "Besoin en fonds de roulement", bfr, strong=True),
        row("breakeven", "Point mort (chiffre d'affaires)", breakeven),
    ]

    # Textes lus à l'écran et dans l'export : nombres à la française (virgule décimale, jamais « 1.3 »),
    # montants dans la devise du dossier.
    alerts = []
    if not revenue_lines:
        alerts.append("Aucun produit saisi : le modèle ne génère pas de chiffre d'affaires.")
    if indicators["npv"] < 0:
        alerts.append(f"VAN négative au taux d'actualisation de {taux(p['discount_rate'])}{INSECABLE}% : le projet ne "
                      "crée pas de valeur.")
    if dscr_values and indicators["dscr_min"] < p["dscr_target"]:
        alerts.append(f"DSCR minimal de {nombre(indicators['dscr_min'], 2)} en {labels[indicators['dscr_min_year']]}, "
                      f"sous l'exigence de {nombre(p['dscr_target'], 2)}.")
    if cash_min < 0:
        alerts.append(f"Trésorerie cumulée négative en {labels[cash_min_year]} : un financement complémentaire "
                      f"de {_montant(-cash_min, currency)} est nécessaire.")
    if financing_plan["gap"] < 0:
        alerts.append(f"Plan de financement initial déséquilibré : {_montant(-financing_plan['gap'], currency)} de "
                      "ressources manquantes.")
    if resources and indicators["equity_share"] < p["equity_target"]:
        alerts.append(f"Apport des promoteurs de {taux(indicators['equity_share'])}{INSECABLE}% des ressources, "
                      f"sous le minimum de {taux(p['equity_target'])}{INSECABLE}%.")
    if debt_end > 0.5:
        alerts.append(f"Dette restant due en fin d'horizon : {_montant(debt_end, currency)}.")

    return {
        "params": p,
        "labels": labels,
        "statements": statements,
        "flows": flows,
        "debt": debt,
        "working_capital": working_capital,
        "revenue_lines": revenue_lines,
        "indicators": indicators,
        "financing_plan": financing_plan,
        "alerts": alerts,
    }


def _threshold(params, lines, key, metric, target):
    """Baisse maximale (en %) de l'hypothèse `key` avant que l'indicateur passe sous `target` ;
    None si l'indicateur est déjà sous la cible ou n'existe pas."""

    def value(factor):
        return analyse(params, lines, {key: factor})["indicators"][metric]

    current = value(1.0)
    if current is None or current < target:
        return None
    floor = value(0.0)
    if floor is not None and floor >= target:
        return 100.0
    low, high = 0.0, 1.0
    for _ in range(30):
        mid = (low + high) / 2
        v = value(mid)
        if v is not None and v >= target:
            high = mid
        else:
            low = mid
    return (1 - high) * 100


def stress(params, lines, first_year=None):
    """Sensibilités (chocs de -20 % à +20 % par hypothèse, classées par effet sur la VAN), scénarios
    et marges de sécurité (baisse supportable du prix et des volumes)."""
    base = analyse(params, lines, first_year=first_year)["indicators"]
    sensitivities = []
    for key, label in FACTORS.items():
        rows = []
        for shock in SHOCKS:
            ind = analyse(params, lines, {key: 1 + shock / 100})["indicators"]
            rows.append({"shock": shock, "npv": ind["npv"], "irr_project": ind["irr_project"],
                         "dscr_min": ind["dscr_min"], "cash_min": ind["cash_min"]})
        swing = abs(rows[-1]["npv"] - rows[0]["npv"])
        sensitivities.append({"key": key, "label": label, "rows": rows, "swing": swing})
    sensitivities.sort(key=lambda s: -s["swing"])
    scenarios = []
    for key, label, factors, description in SCENARIOS:
        ind = analyse(params, lines, factors)["indicators"]
        scenarios.append({"key": key, "label": label, "description": description, "factors": factors,
                          "indicators": {k: ind[k] for k in ("npv", "irr_project", "irr_equity", "dscr_min",
                                                             "payback", "cash_min", "ebitda_margin")}})
    margins = {
        "price_npv": _threshold(params, lines, "price", "npv", 0.0),
        "volume_npv": _threshold(params, lines, "volume", "npv", 0.0),
        "price_dscr": _threshold(params, lines, "price", "dscr_min", 1.0) if base["dscr_min"] is not None else None,
        "volume_dscr": _threshold(params, lines, "volume", "dscr_min", 1.0) if base["dscr_min"] is not None else None,
    }
    return {"base": base, "sensitivities": sensitivities, "scenarios": scenarios, "margins": margins}


# Unité des indicateurs exprimés en montant (VAN, trésorerie) : la devise du modèle, celle du dossier,
# jamais une devise écrite en dur (audit du noyau, I-X3 : un dossier en USD était libellé en GNF).
# indicator_unit() la remplace par le code de la devise quand il est connu.
MONEY = "devise du dossier"

# Indicateurs du modèle utilisables par un critère de la grille : libellé, sens (True : plus haut
# est meilleur), unité d'affichage.
INDICATORS = {
    "dscr_min": ("DSCR minimal", True, "x"),
    "llcr": ("LLCR", True, "x"),
    "irr_project": ("TRI du projet", True, "%"),
    "irr_equity": ("TRI des fonds propres", True, "%"),
    "npv": ("VAN du projet", True, MONEY),
    "payback": ("Délai de récupération", False, "ans"),
    "equity_share": ("Apport des promoteurs", True, "%"),
    "gearing": ("Endettement (dette / fonds propres)", False, "x"),
    "ebitda_margin": ("Marge d'EBE en croisière", True, "%"),
    "breakeven_ratio": ("Point mort en % du CA de croisière", False, "%"),
    "cash_min": ("Trésorerie cumulée minimale", True, MONEY),
}


def indicator_unit(key, currency=None):
    """Unité d'affichage d'un indicateur : pour un montant, le code de la devise du dossier
    (`currency`, « USD »), à défaut « devise du dossier » ; sinon son unité (x, %, ans)."""
    unit = INDICATORS[key][2]
    return (currency or MONEY) if unit == MONEY else unit


def suggest(indicator, threshold, partial, indicators):
    """Statut suggéré pour un critère adossé à un indicateur : satisfait au seuil, partiel au seuil
    partiel (facultatif : None quand il n'est pas défini), non satisfait sinon ; None si l'indicateur
    n'est pas calculable."""
    if indicator not in INDICATORS:
        return None
    value = indicators.get(indicator)
    if value is None:
        return {"status": None, "value": None}
    higher = INDICATORS[indicator][1]

    def passes(limit):
        return value >= limit if higher else value <= limit

    if passes(threshold):
        status = "met"
    # Un seuil partiel de 0 compte (audit du noyau, I-X4) : « 0.0 in (None, False) » est vrai en
    # Python, la VAN positive d'un critère « partiel à 0 » sortait non satisfaite.
    elif partial is not None and passes(partial):
        status = "partial"
    else:
        status = "not_met"
    return {"status": status, "value": value}
