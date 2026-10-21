"""Valeurs de référence du prototype de la direction (EGUITRA_App.html, vue « Validation face au
classeur ») vers un fichier JSON lu par controle_reference.py.

Le prototype est un document du client, lu comme une donnée sans rien exécuter ; le fichier produit
contient des montants du client et ne se versionne pas.

    python -I scripts/reprise/extraire_reference.py chemin/EGUITRA_App.html dossier_de_sortie/reference.json         [--date=AAAA-MM-JJ]

Le même fichier se charge dans la plateforme (Clôtures et contrôles > Validation de la reprise, route
/finance/reprise/references) : « values » y porte chaque valeur sous le code de la plateforme
(models/reprise_reference.py) et « date_to » la date d'arrêté du classeur (option --date, la
dateArrete du dossier).

Chaque entrée du tableau REFERENCE du prototype (libellé, accesseur sur le résultat du moteur,
valeur attendue) devient un indicateur ; l'accesseur donne sa clé (agregats.totalDebit -> totalDebit,
ligne TOTAL de l'actif -> totalActif…). La tolérance est celle de la vue (constante TOL).
"""

import json
import re
import sys
from pathlib import Path

# Clé du prototype -> code de l'indicateur dans la plateforme (eguitra_finance, reprise_reference.py).
PLATFORM_CODES = {
    "totalDebit": "debit_total", "totalCredit": "credit_total", "produits": "revenue",
    "chargesExpl": "operating_expenses", "ebitda": "ebitda", "dotations": "depreciation",
    "resultatExpl": "operating_result", "chargesFin": "financial_expenses", "resultatNet": "net_result",
    "tresorerie": "cash", "stocks": "inventory", "creances": "receivables", "creancesEchues": "receivables_overdue",
    "dettes": "payables", "dettesEchues": "payables_overdue", "caTTC": "sales_ttc", "achatsTTC": "purchases_ttc",
    "caTransport": "transport_revenue", "coutsDirects": "transport_direct_costs", "rotations": "rotations",
    "volume": "volume_liters", "km": "kilometers", "nonFacturees": "rotations_unbilled",
    "totalActif": "assets_total", "totalPassif": "liabilities_total", "capitauxPropres": "equity",
}
ENTRY = re.compile(r'^\s*\[\s*"((?:[^"\\]|\\.)*)"\s*,\s*(m\s*=>.*?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]\s*,?\s*$')


def key_of(expression):
    """Clé de l'indicateur d'après l'accesseur du prototype."""
    found = re.search(r"m\.agregats\.(\w+)", expression)
    if found:
        return found.group(1)
    side = re.search(r"m\.(actif|passif)\.find", expression)
    if side and "TOTAL" in expression:
        return "totalActif" if side.group(1) == "actif" else "totalPassif"
    if side and "CAPITAUX PROPRES" in expression:
        return "capitauxPropres"
    return None


def extract(text):
    block = re.search(r"const REFERENCE\s*=\s*\[(.*?)\n\];", text, re.S)
    if not block:
        sys.exit("Tableau REFERENCE introuvable dans le prototype.")
    items = []
    for line in block.group(1).splitlines():
        match = ENTRY.match(line)
        if match:
            label, expression, value = match.groups()
            items.append({"libelle": json.loads(f'"{label}"'), "expression": expression, "cle": key_of(expression),
                          "attendu": float(value) if "." in value else int(value)})
        elif line.strip():
            sys.exit(f"Ligne du tableau REFERENCE non reconnue : {line.strip()[:80]}")
    tolerance = re.search(r"function vueValidation\(\)\{.*?const TOL\s*=\s*(\d+(?:\.\d+)?)", text, re.S)
    return {"source": "REFERENCE du prototype", "tolerance": float(tolerance.group(1)) if tolerance else 10.0,
            "indicateurs": items}


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    options = dict(a[2:].split("=", 1) for a in argv if a.startswith("--") and "=" in a)
    if len(args) != 2 or ("date" in options and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", options["date"])):
        sys.exit("Usage : python -I scripts/reprise/extraire_reference.py prototype.html reference.json "
                 "[--date=AAAA-MM-JJ]")
    source, target = Path(args[0]), Path(args[1])
    data = extract(source.read_text(encoding="utf-8"))
    data["values"] = {PLATFORM_CODES[i["cle"]]: i["attendu"] for i in data["indicateurs"] if i["cle"] in PLATFORM_CODES}
    if options.get("date"):
        data["date_to"] = options["date"]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    unknown = [i["libelle"] for i in data["indicateurs"] if not i["cle"]]
    print(f"{len(data['indicateurs'])} valeurs de référence écrites dans {target} (tolérance {data['tolerance']:g} GNF).")
    if unknown:
        print("Accesseurs non reconnus : " + ", ".join(unknown))


if __name__ == "__main__":
    main(sys.argv[1:])
