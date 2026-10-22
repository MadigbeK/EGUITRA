"""Grille officielle MB AxisPro Consulting tirée du prototype de la direction (MB_AxisPro_Suite.html), au format
d'import de la plateforme (AxisPro Suite, Politique d'évaluation, Importer une grille).

Le prototype n'est pas versionné (document du client) : il est lu en place, comme une donnée, sans
rien exécuter. Le classeur produit n'est pas versionné non plus.

    python -I scripts/grille/extraire_prototype.py chemin/MB_AxisPro_Suite.html grille_mb_axispro.xlsx

Contenu : 8 stage gates (règles de passage, seuils, domaines contrôlés, exigences d'entrée,
livrables, critères de passage), 15 domaines (livrable type d'un écart), 111 critères (exigence,
poids, criticité, knock-out, bancabilité, preuve exigée pour les knock-outs et les exigences
bloquantes, rôle du CAPEX détaillé), 42 pièces de data room rattachées à leurs critères et
attendues au premier gate des critères qu'elles justifient.
"""

import json
import re
import sys

import xlsxwriter

HEADER = ("type", "code", "libelle", "domaine", "gate", "poids", "critique", "eliminatoire", "preuve", "aide",
          "exigence", "bancabilite", "livrable", "role", "regle", "seuil_attente", "seuil_go", "portee", "domaines",
          "criteres")
REQUIREMENTS = {"Bloquant": "bloquant", "PendantAPD": "apd", "DD-SPV-Closing": "closing"}
# Règles de passage du prototype (fonction REGLES) ; les gates 1 et 2 portent leur seuil sur les
# critères des gates atteints (portée cumulée), décision de la plateforme.
GATE_RULES = [
    {"regle": "intake"},
    {"regle": "prequalification", "seuil_attente": 30, "seuil_go": 50, "portee": "cumulee",
     "domaines": ["Promoteur / KYC", "Foncier et localisation"]},
    {"regle": "feasibility", "seuil_attente": 50, "portee": "cumulee",
     "domaines": ["Foncier et localisation", "Marché", "Commercial", "Réglementaire"]},
    {"regle": "apd", "seuil_attente": 50},
    {"regle": "bankability", "seuil_attente": 65},
    {"regle": "due_diligence", "seuil_attente": 80},
    {"regle": "structuring", "seuil_attente": 65, "domaines": ["SPV / Gouvernance", "Financement"]},
    {"regle": "closing"},
]
CAPEX = "C053"


def read_prototype(path):
    text = open(path, encoding="utf-8").read()
    match = re.search(r"^\s*const REF = (\{.*\});?\s*$", text, re.M)
    if not match:
        sys.exit("Référentiel REF introuvable dans le prototype.")
    ref = json.loads(match.group(1))
    block = re.search(r"const LIVRABLES = \{(.*?)\};", text, re.S)
    livrables = dict(re.findall(r'"([^"]+)"\s*:\s*"([^"]*)"', block.group(1))) if block else {}
    return ref, livrables


def build_rows(ref, livrables):
    domains = []
    for c in ref["criteres"]:
        if c["dom"] not in domains:
            domains.append(c["dom"])
    dom_code = {name: f"DOM{i:02d}" for i, name in enumerate(domains, start=1)}
    gate_of = {c["id"]: c["gate"] for c in ref["criteres"]}
    rows = []
    for i, g in enumerate(ref["gates"]):
        rule = GATE_RULES[i]
        rows.append({
            "type": "gate", "code": f"G{i}", "libelle": g["nom"], "regle": rule["regle"],
            "seuil_attente": rule.get("seuil_attente", ""), "seuil_go": rule.get("seuil_go", ""),
            "portee": rule.get("portee", "globale"),
            "domaines": ";".join(dom_code[d] for d in rule.get("domaines", [])),
            "livrable": g["livrables"], "passage": g["passage"], "entree": g["entree"],
        })
    for name in domains:
        rows.append({"type": "domaine", "code": dom_code[name], "libelle": name, "poids": 1,
                     "livrable": livrables.get(name, "")})
    for c in ref["criteres"]:
        rows.append({
            "type": "critere", "code": c["id"], "libelle": c["lib"], "domaine": dom_code[c["dom"]],
            "gate": f"G{c['gate']}", "poids": c["poids"], "critique": "oui" if c["critique"] else "non",
            "eliminatoire": "oui" if c["ko"] else "non",
            "preuve": "oui" if c["ko"] or c["type"] == "Bloquant" else "non",
            "exigence": REQUIREMENTS[c["type"]], "bancabilite": "oui" if c["banc"] else "non",
            "role": "capex" if c["id"] == CAPEX else "",
        })
    for p in ref["dataroom"]:
        linked = ref["mapping"].get(p["id"], [])
        first = min((gate_of[x] for x in linked if x in gate_of), default=None)
        rows.append({"type": "piece", "code": p["id"], "libelle": p["piece"], "domaine": p["cat"],
                     "gate": f"G{first}" if first is not None else "", "critique": "oui", "criteres": ";".join(linked)})
    return rows, len(domains)


def write(rows, path):
    columns = HEADER + ("entree", "passage")
    book = xlsxwriter.Workbook(path, {"strings_to_formulas": False, "strings_to_urls": False})
    sheet = book.add_worksheet("Grille")
    head = book.add_format({"bold": True, "bg_color": "#11221D", "font_color": "#FFFFFF"})
    for col, name in enumerate(columns):
        sheet.write_string(0, col, name, head)
    for r, row in enumerate(rows, start=1):
        for col, name in enumerate(columns):
            value = row.get(name, "")
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                sheet.write_number(r, col, value)
            else:
                sheet.write_string(r, col, str(value))
    sheet.set_column(2, 2, 60)
    sheet.freeze_panes(1, 3)
    book.close()


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    ref, livrables = read_prototype(sys.argv[1])
    rows, domains = build_rows(ref, livrables)
    write(rows, sys.argv[2])
    kinds = {k: sum(1 for r in rows if r["type"] == k) for k in ("gate", "domaine", "critere", "piece")}
    links = sum(len(r["criteres"].split(";")) for r in rows if r["type"] == "piece" and r["criteres"])
    ko = sum(1 for r in rows if r["type"] == "critere" and r["eliminatoire"] == "oui")
    print(f"{kinds['gate']} gates, {domains} domaines, {kinds['critere']} critères ({ko} knock-outs), "
          f"{kinds['piece']} pièces, {links} rattachements -> {sys.argv[2]}")


if __name__ == "__main__":
    main()
