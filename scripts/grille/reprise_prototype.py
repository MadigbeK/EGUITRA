# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Reprend les projets saisis dans le prototype MB AxisPro (cahier des charges, section 14) : un fichier JSON (liste
de documents au format 8.1) et un dossier de pièces, chacune nommée par son identifiant de 32 caractères. Idempotent :
un N° déjà présent est sauté. Les données du client ne sont jamais dans le dépôt : elles sont déposées sur le serveur.

À blanc par défaut : le bilan s'affiche et tout est annulé ; REPRISE_APPLIQUER=1 enregistre. REPRISE_CONTROLE : fichier
JSON {N° : {readiness, apd, bankability}} fourni par le cabinet, comparé aux scores recalculés (tolérance 0,05).

  docker compose exec -T -e REPRISE_ENVIRONNEMENT=recette -e REPRISE_JSON=/tmp/projets.json -e REPRISE_PIECES=/tmp/pieces \\
      odoo-recette odoo shell -c /etc/odoo/odoo.conf -d "$RECETTE_DB" --no-http --log-level=warn \\
      < ../scripts/grille/reprise_prototype.py
"""

import json
import os

from odoo.addons.eguitra_axispro.reprise import TOLERANCE, gap, import_project

attendu = os.environ.get("REPRISE_ENVIRONNEMENT")
label = env["ir.config_parameter"].sudo().get_param("eguitra_api.environment_label") or "production"
assert attendu and attendu == label, f"Base « {label} », environnement demandé « {attendu} » : arrêt."

company = env["res.company"].sudo().search([("eguitra_entity", "=", "cabinet")], limit=1)
assert company, "Société du cabinet introuvable."
scoped = env(context=dict(env.context, allowed_company_ids=company.ids))
policy = scoped["axispro.policy"].sudo().active_policy(company)
assert policy and policy.method == "sc01_v2", "Aucune grille V2.0 en vigueur : lancez d'abord mettre_en_place_v2.py."
with open(os.environ["REPRISE_JSON"], encoding="utf-8") as handle:
    projects = json.load(handle)
controls = {}
if os.environ.get("REPRISE_CONTROLE"):
    with open(os.environ["REPRISE_CONTROLE"], encoding="utf-8") as handle:
        controls = json.load(handle)
folder = os.environ.get("REPRISE_PIECES") or ""


def read_piece(identifier):
    # Identifiant de 32 caractères hexadécimaux, jamais un chemin.
    if not identifier or not str(identifier).isalnum() or not folder:
        return None
    path = os.path.join(folder, str(identifier))
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as handle:
        return handle.read()


failures = 0
for project in projects:
    bilan = import_project(scoped, project, policy, read_piece)
    scores = bilan["scores"]
    state = "REPRIS" if bilan["created"] else "DEJA"
    print(f"{state}\t{bilan['reference']}\tReadiness {scores['readiness']:g}\tAPD {scores['apd']:g}\t"
          f"Bankability {scores['bankability']:g}\t{len(bilan['missing'])} pièces introuvables")
    for name in bilan["missing"]:
        print(f"PIECE MANQUANTE\t{bilan['reference']}\t{name}")
    expected = controls.get(bilan["reference"])
    if expected:
        ecart = gap(scores, expected)
        failures += ecart > TOLERANCE
        print(f"CONTROLE\t{bilan['reference']}\técart {ecart:.2f}\t{'OK' if ecart <= TOLERANCE else 'ÉCART'}")
if os.environ.get("REPRISE_APPLIQUER") == "1" and not failures:
    env.cr.commit()
    print("ENREGISTRÉ")
else:
    env.cr.rollback()
    print(f"RIEN N'EST ENREGISTRÉ ({failures} écarts de contrôle). REPRISE_APPLIQUER=1 pour enregistrer.")
