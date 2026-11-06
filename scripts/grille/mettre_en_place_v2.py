# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Met en place la grille SC-01 V2.0 de MB AxisPro Consulting : import de l'outil V2.0, complété par la version 3
(compartiments et documents à produire, par libellé de critère), contrôle du contenu, mise en vigueur sur demande.

Idempotent : un classeur déjà importé (même empreinte SHA-256) ne crée pas de nouvelle version. Les classeurs du
cabinet ne sont jamais dans le dépôt : ils sont déposés sur le serveur (infra/secrets/) et lus dans le conteneur.
GRILLE_ENVIRONNEMENT doit valoir le libellé de la base (« production » ou « recette »).

  docker compose exec -T -e GRILLE_ENVIRONNEMENT=recette -e GRILLE_FICHIER=/tmp/outil.xlsx \\
      -e GRILLE_COMPLEMENT=/tmp/outil-v3.xlsx -e GRILLE_ACTIVER=1 odoo-recette odoo shell -c /etc/odoo/odoo.conf \\
      -d "$RECETTE_DB" --no-http --log-level=warn < ../scripts/grille/mettre_en_place_v2.py

Les dossiers ouverts gardent leur politique : leur passage à la grille V2.0 se fait par scripts/grille/basculer_v2.py.
"""

import hashlib
import os

ATTENDU = {"gates": 8, "domains": 15, "criteria": 111, "documents": 42}

attendu = os.environ.get("GRILLE_ENVIRONNEMENT")
label = env["ir.config_parameter"].sudo().get_param("eguitra_api.environment_label") or "production"
assert attendu and attendu == label, f"Base « {label} », environnement demandé « {attendu} » : arrêt."

path = os.environ["GRILLE_FICHIER"]
company = env["res.company"].sudo().search([("eguitra_entity", "=", "cabinet")], limit=1)
assert company, "Société du cabinet introuvable."
Policy = env["axispro.policy"].sudo().with_company(company)
with open(path, "rb") as handle:
    content = handle.read()
checksum = hashlib.sha256(content).hexdigest()
policy = Policy.search([("company_id", "=", company.id), ("source_checksum", "=", checksum)], limit=1)
if policy:
    print(f"DEJA IMPORTEE\tversion {policy.version}\t{policy.name}")
else:
    complement = None
    if os.environ.get("GRILLE_COMPLEMENT"):
        with open(os.environ["GRILLE_COMPLEMENT"], "rb") as handle:
            complement = handle.read()
    policy = Policy.import_grid(company, os.environ.get("GRILLE_NOM") or "Outil de scoring MB AxisPro Consulting (SC-01 V2.0)",
                                os.path.basename(path), content, complement=complement)
    policy.write({"source_checksum": checksum})
    print(f"VERSION\t{policy.version}\t{policy.name}")
assert policy.method == "sc01_v2", f"Méthode « {policy.method} » : ce classeur n'est pas l'outil V2.0."
check = policy.integrity()
print(f"CONTENU\t{check['gates']} gates\t{check['compartments']} compartiments\t{check['domains']} domaines\t"
      f"{check['criteria']} critères\t{check['knockouts']} knock-outs\t{check['documents']} pièces")
for key, expected in ATTENDU.items():
    assert check[key] == expected, f"{key} : {check[key]} au lieu de {expected}."
print(f"REGLAGES\tHOLD {policy.threshold_hold:g}\tCONDITIONAL {policy.conditional_threshold:g}\t"
      f"APD {policy.go_threshold:g}\tBANKABLE {policy.threshold_bankable:g}\tDSCR {policy.dscr_target:g}\t"
      f"INC bloquant dès le Gate {policy.ko_partial_from_gate}\tPoints {policy.points_met:g} / {policy.points_partial:g} / "
      f"{policy.points_not_met:g}")
for gate in policy.gate_ids.sorted("sequence"):
    print(f"GATE\t{gate.code}\t{gate.name}\tattente {gate.threshold_hold:g}")
for note in check["notes"]:
    print(f"NOTE\t{note}")
if os.environ.get("GRILLE_ACTIVER") == "1" and policy.state != "active":
    policy.action_activate()
    print(f"EN VIGUEUR\tversion {policy.version}")
env.cr.commit()
