"""Contrôle de fidélité de la reprise : les valeurs de référence du prototype de la direction
recalculées à partir des fichiers de reprise (et non de la base), avec les formules du moteur du
prototype, sur les écritures telles que la plateforme les comptabilisera.

    python -I scripts/reprise/controle_reference.py dossier_des_csv reference.json
        [--rapport fichier.txt] [--relatif] [--ecart-reprise premiere|derniere]

Entrées : parametres.json, soldes_ouverture.csv, ecritures.csv, immobilisations.csv, rotations.csv
(produits par dossier_json.py) et reference.json (extraire_reference.py). Sortie : un tableau
indicateur / attendu / recalculé / écart, puis « n/N conformes » (tolérance de la vue du prototype).

Ce que la plateforme comptabilisera, et que le contrôle reproduit :
- à-nouveaux (journal AN) à la date de début d'exercice, compte client et compte fournisseur
  éclatés par facture, avec échéance et référence ;
- écritures de l'exercice telles que reprise.py les passe ; lettrage d'une facture avec les
  règlements de même tiers, même compte et même référence (colonne lettrage) ;
- dotations aux amortissements : calculées par la plateforme depuis le registre (module
  account_asset_management : linéaire, dotations mensuelles datées de fin de mois, prorata temporis
  au jour de la mise en service, arrondi au franc), cumul repris au 31/12 en lignes de reprise,
  écart avec le plan théorique porté sur la première dotation de l'exercice (règle actuelle,
  « premiere ») ou, pour mesurer une variante, sur la dernière dotation du plan (« derniere ») ;
  dotations comptabilisées au jour d'arrêté (fin de mois échue). Un bien dont la colonne methode vaut
  « mois » (dossier_json.py --convention=prototype) suit la méthode « nombre de dotations » du module :
  12 × durée dotations égales arrondies au franc, la dernière amortissant le reste.

Formules du prototype (fonction Moteur) : balance de la période (mois de début à mois d'arrêté,
à-nouveaux compris) ; produits = crédit - débit de la classe 7 ; dotations = solde 68 ; charges
financières = solde 67 ; charges d'exploitation = solde de la classe 6 - 68 - 67 ; EBITDA, résultats ;
trésorerie = classe 5 ; stocks = classe 3 ; créances et dettes : encours facture par facture (TTC
moins règlements de même référence), échu si l'échéance est dépassée au jour d'arrêté ; CA et achats
TTC des pièces de la période ; transport depuis les rotations (CA = volume × tarif, coûts déclarés,
km aller-retour) ; actif = immobilisations brutes - amortissements + stocks + créances + TVA
récupérable (445) + trésorerie ; passif = capital, réserves, report à nouveau, résultat, emprunts
(162), crédit-bail (173), dettes fournisseurs, dettes sociales (42, 43), fiscales (443, 444, 447,
448), comptes courants (46).
"""

import csv
import json
import math
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

YES = ("oui", "o", "x", "1", "vrai")


# ─── Lecture des fichiers ─────────────────────────────────────────────────

def read(folder, name):
    path = folder / name
    if not path.exists():
        return []
    text = path.read_bytes().decode("utf-8-sig")
    first = text.split("\n", 1)[0]
    reader = csv.DictReader(text.splitlines(), delimiter=";" if first.count(";") >= first.count(",") else ",")
    reader.fieldnames = [f.strip().lower() for f in reader.fieldnames or []]
    return [{k: (v or "").strip() for k, v in row.items() if k} for row in reader]


def num(value):
    if value in ("", None):
        return 0.0
    return float(re.sub(r"[\s  ]", "", str(value)).replace(",", "."))


def day(value):
    if not value:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(value[:10], fmt).date()
        except ValueError:
            continue
    raise ValueError(f"date illisible « {value} »")


def per(d):
    return d.year * 100 + d.month if d else 0


def R(value):
    """Math.round du prototype."""
    return math.floor(value + 0.5)


# ─── Arrondi et plan d'amortissement du module account_asset_management ──

def odoo_round(value, rounding=1.0):
    """float_round d'Odoo (demi au plus loin de zéro, correction de l'erreur de représentation)."""
    normalized = value / rounding
    if normalized == 0:
        return 0.0
    epsilon = 2 ** (math.log2(abs(normalized)) - 52)
    return round(normalized + math.copysign(epsilon, normalized)) * rounding


def is_zero(value):
    return odoo_round(value) == 0


def end_of_month(d):
    following = date(d.year + d.month // 12, d.month % 12 + 1, 1)
    return following - timedelta(days=1)


def add_years(d, years):
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # 29 février
        return d.replace(year=d.year + years, day=28)


def add_months(d, months):
    y, m = divmod(d.month - 1 + months, 12)
    return min(date(d.year + y, m + 1, 1) + timedelta(days=d.day - 1), end_of_month(date(d.year + y, m + 1, 1)))


def asset_table(base, years, start, by_months=False):
    """Tableau d'amortissement du module (méthode linéaire, dotations mensuelles, exercice civil, sans
    calcul au jour ni années bissextiles) : reproduction de _compute_depreciation_table et de ses
    étapes. Méthode « durée en années » (method_time year, prorata temporis : premier exercice au jour
    près) ou, by_months, « nombre de dotations » (method_time number : 12 × durée dotations égales à
    partir de la fin du mois de mise en service, la dernière amortissant le reste)."""
    count = years * 12
    stop = (add_months(start, count) if by_months else add_years(start, years)) - timedelta(days=1)
    table, fy = [], start
    while fy <= stop:
        table.append({"date_start": date(fy.year, 1, 1), "date_stop": date(fy.year, 12, 31)})
        fy = date(fy.year + 1, 1, 1)
    line_dates, current = [], end_of_month(start)
    while current < stop:
        line_dates.append(current)
        current = end_of_month(current + timedelta(days=1))
    if not (by_months and len(line_dates) == count):
        line_dates.append(current)
    # Montant par exercice (_compute_depreciation_amount_per_fiscal_year).
    residual, i_max = base, len(table) - 1
    for i, entry in enumerate(table):
        if by_months:
            entry.update(period_amount=odoo_round(base / count), fy_amount=None)
            continue
        year_amount = base / years
        if i == i_max:
            fy_amount = residual
        elif i == 0:
            fy_amount = year_amount * ((entry["date_stop"] - start).days + 1) / (
                (entry["date_stop"] - entry["date_start"]).days + 1)
        else:
            fy_amount = year_amount
        if odoo_round(fy_amount - residual) > 0:
            fy_amount = residual
        entry.update(period_amount=odoo_round(year_amount / 12), fy_amount=odoo_round(fy_amount))
        residual -= entry["fy_amount"]
        if is_zero(residual):
            break
    table = table[: i + 1]
    # Répartition sur les mois (_compute_depreciation_table_lines).
    remaining, depreciated, i_max = base, 0.0, len(table) - 1
    for i, entry in enumerate(table):
        lines, check = [], 0.0
        li_max = len(line_dates) - 1
        li = 0
        for li, line_date in enumerate(line_dates):
            if is_zero(remaining):
                break
            if line_date > min(entry["date_stop"], stop) and not (i == i_max and li == li_max):
                break
            if i == 0 and li == 0 and not by_months:
                full = len([x for x in line_dates if x <= entry["date_stop"]]) - 1
                amount = odoo_round(entry["fy_amount"] - entry["period_amount"] * full)
            else:
                amount = entry["period_amount"]
            if i == i_max and li == li_max:
                amount, remaining = remaining, 0.0
            else:
                remaining -= amount
            check += amount
            lines.append({"date": line_date, "amount": amount, "remaining": remaining})
            depreciated += amount
        # Écart d'un exercice avec son montant annuel : méthode « durée en années » seulement.
        if lines and not by_months and not is_zero(check - entry["fy_amount"]):
            gap = check - entry["fy_amount"]
            remaining += gap
            lines[-1].update(amount=lines[-1]["amount"] - gap, remaining=remaining)
            depreciated -= gap
        entry["lines"] = lines
        line_dates = line_dates[li:]
    return [e for e in table if e["lines"]]


def board_lines(table, base, depreciated, start=(0, 0), first_adjustment=0.0):
    """Lignes de dotation créées depuis le tableau (_compute_depreciation_line) : la dernière
    amortit le reste ; first_adjustment est retranché de la première ligne créée."""
    last = table[-1]["lines"][-1]["date"]
    out, first = [], True
    ti, li = start
    for entry in table[ti:]:
        for line in entry["lines"][li:]:
            amount = line["amount"] - (first_adjustment if first else 0.0)
            first = False
            if line["date"] == last:
                amount = base - depreciated
            if amount:
                out.append((line["date"], odoo_round(amount)))
                depreciated += odoo_round(amount)
        li = 0
    return out


def platform_board(base, years, start, opening, accumulated, rule="premiere", by_months=False):
    """Plan d'un bien tel que la plateforme le tiendra : reprise du cumul au 31/12 (lignes de reprise,
    eguitra_takeover), puis plan recalculé, l'écart avec le plan théorique porté sur la première
    dotation restant à comptabiliser (règle du module) ou, en variante, sur la dernière."""
    table = asset_table(base, years, start, by_months)
    lines = board_lines(table, base, 0.0)
    if start >= opening:
        return {"lines": lines, "theoretical": 0.0, "gap": 0.0}
    before = [x for x in lines if x[0] < opening]
    theoretical = odoo_round(sum(a for _d, a in before))
    if not before or is_zero(base - accumulated):
        return {"lines": [], "theoretical": theoretical, "gap": accumulated - theoretical}
    last = before[-1][0]
    table = asset_table(base, years, start, by_months)
    # Position de la dernière ligne de reprise dans le tableau (compute_depreciation_board du module).
    ti = next((k for k, e in enumerate(table) if e["date_start"] <= last <= e["date_stop"]), len(table) - 1)
    entry, li = table[ti], 0
    residual_table = entry["lines"][-1]["remaining"]
    if entry["date_stop"] == last:
        ti += 1
    else:
        floor = entry["date_start"]
        for line in entry["lines"]:
            residual_table = line["remaining"]
            if floor <= last <= line["date"]:
                break
            floor = line["date"]
            li += 1
        if line["date"] == last:
            li += 1
    if ti >= len(table):
        raise ValueError("plan de la plateforme achevé avant l'ouverture alors que le cumul repris est incomplet")
    diff = odoo_round(residual_table - (base - accumulated))
    future = board_lines(table, base, accumulated, (ti, li), diff if rule == "premiere" else 0.0)
    if future and future[0][1] < 0:
        raise ValueError("première dotation négative : la reprise serait refusée")
    return {"lines": future, "theoretical": theoretical, "gap": accumulated - theoretical}


def prototype_accumulated(base, years, acquired, ref):
    """cumulA du prototype : mois entiers à compter du mois suivant l'acquisition."""
    if years <= 0:
        return 0
    months = min(max((ref.year - acquired.year) * 12 + ref.month - acquired.month, 0), years * 12)
    return R(base * months / (years * 12))


# ─── Recalcul ─────────────────────────────────────────────────────────────

class Control:
    def __init__(self, folder, rule="premiere"):
        self.folder = folder
        params = json.loads((folder / "parametres.json").read_text(encoding="utf-8"))
        self.opening = day(params["date_debut"])
        self.closing = day(params["date_arrete"])
        self.journals = params.get("journaux") or {"ventes": "FAC", "achats": "FACTU", "od": "OD"}
        self.period = (per(self.opening), per(self.closing))
        self.rule = rule
        self.lines = []
        self.asset_detail = []
        self._load()

    def _line(self, d, journal, piece, account, debit, credit, partner="", due=None, letter=""):
        self.lines.append({"date": d, "journal": journal.upper(), "piece": piece, "account": account,
                           "debit": debit, "credit": credit, "partner": partner, "due": due, "letter": letter})

    def _load(self):
        for r in read(self.folder, "soldes_ouverture.csv"):
            self._line(self.opening, "AN", "AN", r["compte"], num(r.get("debit")), num(r.get("credit")),
                       r.get("tiers", ""), day(r.get("echeance")), r.get("reference", ""))
        for r in read(self.folder, "ecritures.csv"):
            self._line(day(r["date"]), r["journal"], r["piece"], r["compte"], num(r.get("debit")), num(r.get("credit")),
                       r.get("tiers", ""), day(r.get("echeance")), r.get("lettrage", ""))
        for r in read(self.folder, "immobilisations.csv"):
            self._asset(r)
        self.rotations = read(self.folder, "rotations.csv")

    def _asset(self, r):
        years = int(num(r.get("duree")) or 0)
        if not years or (r.get("non_amortissable") or "").lower() in YES:
            return
        base, start, cumul = num(r["valeur_brute"]), day(r["date_mise_en_service"]), num(r.get("cumul"))
        by_months = (r.get("methode") or "").lower() == "mois"
        board = platform_board(base, years, start, self.opening, cumul, self.rule, by_months)
        posted = [(d, a) for d, a in board["lines"] if self.opening <= d <= self.closing]
        for d, a in posted:
            self._line(d, "AMORT", f"Dotation {r['code']}", r["compte_dotation"], a, 0.0)
            self._line(d, "AMORT", f"Dotation {r['code']}", r["compte_amortissement"], 0.0, a)
        last_month = end_of_month(self.closing) if self.closing == end_of_month(self.closing) else \
            date(self.closing.year, self.closing.month, 1) - timedelta(days=1)
        acquired = day(r.get("date_acquisition")) or start
        prototype = prototype_accumulated(base, years, acquired, last_month) - (cumul if start < self.opening else 0)
        self.asset_detail.append({"code": r["code"], "platform": sum(a for _d, a in posted), "prototype": prototype,
                                  "gap": board["gap"], "start": start})

    def in_period(self, d):
        return self.period[0] <= per(d) <= self.period[1]

    def compute(self):
        bal = defaultdict(lambda: [0.0, 0.0])
        for x in self.lines:
            if self.in_period(x["date"]):
                bal[x["account"]][0] += x["debit"]
                bal[x["account"]][1] += x["credit"]

        def net(prefix):
            return sum(c - d for a, (d, c) in bal.items() if a.startswith(prefix))

        m = {"totalDebit": sum(d for d, _c in bal.values()), "totalCredit": sum(c for _d, c in bal.values())}
        m["produits"] = net("7")
        m["dotations"] = -net("68")
        m["chargesFin"] = -net("67")
        m["chargesExpl"] = -net("6") - m["dotations"] - m["chargesFin"]
        m["ebitda"] = m["produits"] - m["chargesExpl"]
        m["resultatExpl"] = m["ebitda"] - m["dotations"]
        m["resultatNet"] = m["resultatExpl"] - m["chargesFin"]
        m["tresorerie"] = -net("5")
        m["stocks"] = -net("3")
        m["creances"], m["creancesEchues"] = self._outstanding("41", 1)
        m["dettes"], m["dettesEchues"] = self._outstanding("40", -1)
        m["caTTC"], m["achatsTTC"] = self._invoiced()
        m.update(self._transport())
        brute = sum(d - c for a, (d, c) in bal.items() if a.startswith("2") and not a.startswith("28"))
        amort = sum(c - d for a, (d, c) in bal.items() if a.startswith("28"))
        vat = sum(d - c for a, (d, c) in bal.items() if a.startswith("445"))
        m["totalActif"] = brute - amort + m["stocks"] + m["creances"] + vat + m["tresorerie"]
        equity = net("101") + net("106") + net("110") + net("12") + m["resultatNet"]
        m["capitauxPropres"] = equity
        m["totalPassif"] = (equity + net("162") + net("173") + m["dettes"] + net("42") + net("43") + net("443")
                            + net("444") + net("447") + net("448") + net("46"))
        return m

    def _outstanding(self, prefix, sign):
        """Encours facture par facture : lignes de même compte, tiers et référence, comme le lettrage."""
        groups = defaultdict(lambda: {"balance": 0.0, "due": None})
        for x in self.lines:
            if not x["account"].startswith(prefix) or not x["letter"]:
                continue
            g = groups[(x["account"], x["partner"], x["letter"])]
            g["balance"] += sign * (x["debit"] - x["credit"])
            if x["due"] and sign * (x["debit"] - x["credit"]) > 0:
                g["due"] = max(filter(None, (g["due"], x["due"])))
        total = sum(g["balance"] for g in groups.values())
        overdue = sum(g["balance"] for g in groups.values()
                      if g["balance"] > 0.5 and g["due"] and (self.closing - g["due"]).days > 0)
        return total, overdue

    def _invoiced(self):
        pieces = defaultdict(list)
        for x in self.lines:
            if x["journal"] not in ("AN", "AMORT"):
                pieces[(x["journal"], x["piece"])].append(x)
        sales = purchases = 0.0
        for (journal, _piece), lines in pieces.items():
            if not self.in_period(lines[0]["date"]):
                continue
            if journal == self.journals["ventes"].upper():
                sales += sum(x["debit"] - x["credit"] for x in lines if x["account"].startswith("41"))
            charge = any(x["debit"] and x["account"][:1] in "26" for x in lines)
            if journal == self.journals["achats"].upper() or (journal == self.journals["od"].upper() and charge):
                purchases += sum(x["credit"] - x["debit"] for x in lines
                                 if x["account"].startswith("4") and not x["account"].startswith("445"))
        return sales, purchases

    def _transport(self):
        rows = [r for r in self.rotations if self.in_period(day(r["date_chargement"]))]
        costs = ("carburant", "peages", "frais_chauffeur", "entretien", "pneus", "taxes", "autres")
        return {
            "caTransport": sum(odoo_round((num(r.get("volume_livre")) or num(r.get("volume_charge"))) * num(r.get("tarif")))
                               for r in rows),
            "coutsDirects": sum(num(r.get(c)) for r in rows for c in costs),
            "rotations": len(rows),
            "volume": round(sum(num(r.get("volume_livre")) or num(r.get("volume_charge")) for r in rows) * 1000, 3),
            "km": sum(num(r.get("km")) for r in rows),
            "nonFacturees": len([r for r in rows if (r.get("facturee") or "").lower() not in YES]),
        }


def fmt(value):
    return f"{value:,.0f}".replace(",", " ")


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    options = dict(a[2:].split("=", 1) if "=" in a else (a[2:], "1") for a in argv if a.startswith("--"))
    if len(args) != 2:
        sys.exit("Usage : python -I scripts/reprise/controle_reference.py dossier_des_csv reference.json "
                 "[--rapport=fichier.txt] [--relatif] [--ecart-reprise=premiere|derniere]")
    rule = options.get("ecart-reprise", "premiere")
    if rule not in ("premiere", "derniere"):
        sys.exit("--ecart-reprise : premiere (règle actuelle de la plateforme) ou derniere (variante).")
    control = Control(Path(args[0]), rule)
    reference = json.loads(Path(args[1]).read_text(encoding="utf-8"))
    tolerance = float(reference.get("tolerance", 10))
    values = control.compute()
    relative = "relatif" in options
    out = [f"Contrôle de la reprise face au prototype, du {control.opening:%d/%m/%Y} au {control.closing:%d/%m/%Y} "
           f"(tolérance {tolerance:g} GNF ; écart de reprise des immobilisations : {rule} dotation)", ""]
    width = max(len(i["libelle"]) for i in reference["indicateurs"])
    header = f"{'Indicateur':<{width}}  " + ("Écart relatif" if relative else
                                             f"{'Attendu':>18}  {'Recalculé':>18}  {'Écart':>16}") + "  Statut"
    out += [header, "-" * len(header)]
    ok = 0
    for item in reference["indicateurs"]:
        expected = item["attendu"]
        value = values.get(item["cle"]) if item.get("cle") else None
        if value is None:
            out.append(f"{item['libelle']:<{width}}  non recalculable ({item['expression']})")
            continue
        gap = value - expected
        good = abs(gap) <= tolerance
        ok += good
        if relative:
            share = f"{gap / expected * 100:+.4f} %" if expected else f"{gap:+.0f}"
            out.append(f"{item['libelle']:<{width}}  {share:>13}  {'conforme' if good else 'ÉCART'}")
        else:
            out.append(f"{item['libelle']:<{width}}  {fmt(expected):>18}  {fmt(value):>18}  {fmt(gap):>16}  "
                       f"{'conforme' if good else 'ÉCART'}")
    out += ["", f"{ok}/{len(reference['indicateurs'])} conformes"]
    differing = [a for a in control.asset_detail if abs(a["platform"] - a["prototype"]) > 0.5]
    if differing:
        total = sum(a["platform"] - a["prototype"] for a in differing)
        out += ["", "Dotations de la période par bien : plateforme (plan du module, méthode « mois » ou prorata au jour "
                    "de la mise en service, règle de reprise) et convention du prototype (mois entiers à compter du "
                    "mois suivant l'acquisition)"]
        if relative:
            out.append(f"{len(differing)} bien(s) diffèrent ; écart total {total / max(1, sum(a['prototype'] for a in control.asset_detail)) * 100:+.2f} % des dotations du prototype.")
        else:
            out += [f"  {a['code']:<12} plateforme {fmt(a['platform']):>15}  prototype {fmt(a['prototype']):>15}  écart "
                    f"{fmt(a['platform'] - a['prototype']):>13}  (écart de reprise {fmt(a['gap'])})" for a in differing]
            out.append(f"  Total de l'écart : {fmt(total)} GNF")
    text = "\n".join(out)
    print(text)
    if options.get("rapport"):
        Path(options["rapport"]).write_text(text + "\n", encoding="utf-8")
        print(f"\nRapport écrit dans {options['rapport']}.")
    return ok == len(reference["indicateurs"])


if __name__ == "__main__":
    sys.exit(0 if main(sys.argv[1:]) else 1)
