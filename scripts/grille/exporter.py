# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Exporte la grille AxisPro en vigueur (MB AxisPro) au format d'import de la plateforme, à
l'identique : gates et leurs règles, compartiments, domaines, critères (codes, aides, livrables,
indicateurs), pièces et leurs rattachements. Sert à porter en production la grille validée en
recette, quand la production n'a pas de version précédente dont reprendre codes et rattachements.

Le classeur est écrit dans le conteneur (GRILLE_SORTIE) ; les réglages de la politique (seuils,
contrôles, DSCR, principes) sont imprimés sur une ligne « REGLAGES » au format JSON, à passer à
scripts/grille/importer.py par GRILLE_REGLAGES. Lancement sur le serveur, depuis infra/ :

  docker compose exec -T -e GRILLE_SORTIE=/tmp/grille.xlsx odoo-recette odoo shell -c /etc/odoo/odoo.conf \\
      -d "$RECETTE_DB" --no-http --log-level=warn < ../scripts/grille/exporter.py
  docker compose cp odoo-recette:/tmp/grille.xlsx secrets/grille/grille-recette.xlsx
"""

import json
import os

import xlsxwriter

from odoo.addons.eguitra_axispro.models.policy import GRID_COLUMNS, OPTIONAL_COLUMNS

company = env["res.company"].sudo().search([("eguitra_entity", "=", "cabinet")], limit=1)
policy = env["axispro.policy"].sudo().active_policy(company)
assert policy, "Aucune grille en vigueur à exporter."
REQUIREMENT = {"blocking": "bloquant", "apd": "apd", "closing": "closing"}
columns = GRID_COLUMNS + OPTIONAL_COLUMNS


def yes(value):
    return "oui" if value else "non"


def number(value):
    return f"{value:g}" if value else ""


rows = []
for g in policy.gate_ids.sorted("sequence"):
    rows.append({"type": "gate", "code": g.code, "libelle": g.name, "aide": g.description or "",
                 "regle": g.rule_code, "seuil_attente": number(g.threshold_hold), "seuil_go": number(g.threshold_go),
                 "portee": "cumulee" if g.score_scope == "cumulative" else "globale",
                 "domaines": ";".join(g.domain_ids.mapped("code")), "entree": g.entry_requirements or "",
                 "livrable": g.deliverables or "", "passage": g.exit_criteria or "",
                 "completude_min": number(g.min_completeness)})
for d in policy.domain_ids.sorted("sequence"):
    k = d.compartment_id
    rows.append({"type": "domaine", "code": d.code, "libelle": d.name, "poids": number(d.weight) or "0",
                 "livrable": d.deliverable or "", "compartiment": f"{k.code} — {k.name}" if k else ""})
for c in policy.criterion_ids.sorted("sequence"):
    rows.append({"type": "critere", "code": c.code, "libelle": c.name, "domaine": c.domain_id.code,
                 "gate": c.gate_id.code, "poids": number(c.weight) or "0", "critique": yes(c.critical),
                 "eliminatoire": yes(c.knockout), "preuve": yes(c.evidence_required), "aide": c.guidance or "",
                 "exigence": REQUIREMENT[c.requirement_type], "bancabilite": yes(c.bankability),
                 "livrable": c.deliverable or "", "role": "capex" if c == policy.capex_criterion_id else "",
                 "indicateur": c.indicator or "", "seuil": f"{c.indicator_threshold:g}" if c.indicator else "",
                 "seuil_partiel": f"{c.indicator_partial:g}" if c.indicator and c.indicator_has_partial else ""})
for t in policy.document_type_ids.sorted("sequence"):
    rows.append({"type": "piece", "code": t.code, "libelle": t.name, "domaine": t.category or "",
                 "gate": t.gate_id.code or "", "critique": yes(t.required), "aide": t.guidance or "",
                 "criteres": ";".join(t.criterion_ids.mapped("code"))})

book = xlsxwriter.Workbook(os.environ.get("GRILLE_SORTIE") or "/tmp/grille.xlsx",
                           {"strings_to_formulas": False, "strings_to_urls": False})
sheet = book.add_worksheet("Grille")
for col, name in enumerate(columns):
    sheet.write_string(0, col, name)
for r, row in enumerate(rows, start=1):
    for col, name in enumerate(columns):
        sheet.write_string(r, col, str(row.get(name, "")))
book.close()

settings = {key: policy[key] for key in ("threshold_hold", "conditional_threshold", "go_threshold",
                                         "threshold_bankable", "dscr_target", "weighting", "ko_partial_blocks",
                                         "evidence_check", "exclude_na", "expiry_check")}
settings["notes"] = policy.notes or ""
kinds = {k: sum(1 for r in rows if r["type"] == k) for k in ("gate", "domaine", "critere", "piece")}
print(f"EXPORT\t{policy.name}, version {policy.version}\t{kinds['gate']} gates\t{len(policy.compartment_ids)} "
      f"compartiments\t{kinds['domaine']} domaines\t{kinds['critere']} critères\t{kinds['piece']} pièces\t"
      f"{sum(len(t.criterion_ids) for t in policy.document_type_ids)} rattachements")
print("REGLAGES\t" + json.dumps(settings, ensure_ascii=False))
