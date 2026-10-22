# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Importe une grille d'évaluation AxisPro (outil de scoring du cabinet tel quel, ou format d'import
de la plateforme) dans MB AxisPro, en nouvelle version, et la met en vigueur sur demande.

Le classeur du cabinet n'est jamais dans le dépôt : il est déposé sur le serveur (infra/secrets/) et
lu dans le conteneur par son chemin. GRILLE_ENVIRONNEMENT doit valoir le libellé de la base
(« production » ou « recette ») : un garde-fou contre une base inattendue.

Lancement sur le serveur, depuis infra/ (classeur copié dans le conteneur, lu sur l'entrée standard) :

  docker compose exec -T -e GRILLE_ENVIRONNEMENT=recette -e GRILLE_NOM="Outil de scoring MB AxisPro (SC-01)" \\
      -e GRILLE_ACTIVER=1 -e GRILLE_FICHIER=/tmp/outil.xlsx odoo-recette odoo shell -c /etc/odoo/odoo.conf \\
      -d "$RECETTE_DB" --no-http --log-level=warn < ../scripts/grille/importer.py

Les dossiers ouverts gardent la version de grille en vigueur à leur ouverture ; seuls les nouveaux
dossiers suivent la version mise en vigueur.

Production sans grille : y importer la grille validée en recette, exportée par
scripts/grille/exporter.py (codes, rattachements des pièces compris), avec ses réglages
(GRILLE_REGLAGES='{...}', la ligne REGLAGES de l'export).
"""

import os

attendu = os.environ.get("GRILLE_ENVIRONNEMENT")
label = env["ir.config_parameter"].sudo().get_param("eguitra_api.environment_label") or "production"
assert attendu and attendu == label, f"Base « {label} », environnement demandé « {attendu} » : arrêt."

path = os.environ["GRILLE_FICHIER"]
company = env["res.company"].sudo().search([("eguitra_entity", "=", "cabinet")], limit=1)
assert company, "Société du cabinet introuvable."
Policy = env["axispro.policy"].sudo().with_company(company)
with open(path, "rb") as handle:
    content = handle.read()
policy = Policy.import_grid(company, os.environ.get("GRILLE_NOM") or "Grille d'évaluation AxisPro",
                            os.path.basename(path), content)
# Réglages d'une grille exportée (scripts/grille/exporter.py, ligne REGLAGES) : seuils, contrôles,
# DSCR et principes, que le format d'import ne porte pas.
REGLAGES = ("threshold_hold", "conditional_threshold", "go_threshold", "threshold_bankable", "dscr_target",
            "weighting", "ko_partial_blocks", "evidence_check", "exclude_na", "expiry_check", "notes")
if os.environ.get("GRILLE_REGLAGES"):
    import json

    reglages = json.loads(os.environ["GRILLE_REGLAGES"])
    inconnus = set(reglages) - set(REGLAGES)
    assert not inconnus, f"Réglages inconnus : {', '.join(sorted(inconnus))}."
    policy.write(reglages)
    policy._check_thresholds()
check = policy.integrity()
print(f"VERSION\t{policy.version}\t{policy.name}")
print(f"CONTENU\t{check['gates']} gates\t{check['compartments']} compartiments\t{check['domains']} domaines\t"
      f"{check['criteria']} critères\t{check['knockouts']} knock-outs\t{check['documents']} pièces\t"
      f"{check['links']} rattachements")
print(f"REGLAGES\tHOLD {policy.threshold_hold:g}\tCONDITIONAL {policy.conditional_threshold:g}\t"
      f"APD {policy.go_threshold:g}\tBANKABLE {policy.threshold_bankable:g}\tDSCR {policy.dscr_target:g}\t"
      f"KO incomplet bloquant {policy.ko_partial_blocks}\tNA exclus {policy.exclude_na}")
for gate in policy.gate_ids:
    print(f"GATE\t{gate.code}\t{gate.name}\t{gate.rule_code}\tattente {gate.threshold_hold:g}\t"
          f"complétude min {gate.min_completeness:g}\t{', '.join(gate.domain_ids.mapped('code'))}")
for note in check["notes"]:
    print(f"NOTE\t{note}")
if os.environ.get("GRILLE_ACTIVER") == "1":
    policy.action_activate()
    print(f"EN VIGUEUR\tversion {policy.version}")
env.cr.commit()
