# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Bascule des dossiers d'une ancienne politique (version 3, 104 critères) sur la grille SC-01 V2.0 en vigueur :
évaluations, pièces, rattachements et affectations suivent par libellé (axispro.dossier.switch_policy) ; un critère
sans équivalent reste non évalué ; chaque bascule est inscrite au journal du dossier. Idempotent : un dossier déjà
sur la méthode V2.0 est sauté.

À blanc par défaut : le bilan s'affiche et tout est annulé. BASCULE_APPLIQUER=1 enregistre. BASCULE_DOSSIERS : N° ou
identifiants séparés par des virgules (par défaut, tous les dossiers du cabinet). BASCULE_ENVIRONNEMENT doit valoir le
libellé de la base (« production » ou « recette ») ; en production, passer d'abord par infra/release.sh (sauvegarde).

  docker compose exec -T -e BASCULE_ENVIRONNEMENT=recette odoo-recette odoo shell -c /etc/odoo/odoo.conf \\
      -d "$RECETTE_DB" --no-http --log-level=warn < ../scripts/grille/basculer_v2.py
"""

import os

attendu = os.environ.get("BASCULE_ENVIRONNEMENT")
label = env["ir.config_parameter"].sudo().get_param("eguitra_api.environment_label") or "production"
assert attendu and attendu == label, f"Base « {label} », environnement demandé « {attendu} » : arrêt."

company = env["res.company"].sudo().search([("eguitra_entity", "=", "cabinet")], limit=1)
assert company, "Société du cabinet introuvable."
scoped = env(context=dict(env.context, allowed_company_ids=company.ids))
target = scoped["axispro.policy"].sudo().active_policy(company)
assert target and target.method == "sc01_v2", "Aucune grille V2.0 en vigueur : lancez d'abord mettre_en_place_v2.py."

domain = [("company_id", "=", company.id)]
wanted = [x.strip() for x in os.environ.get("BASCULE_DOSSIERS", "").split(",") if x.strip()]
dossiers = scoped["axispro.dossier"].sudo().search(domain)
if wanted:
    dossiers = dossiers.filtered(lambda d: d.reference in wanted or str(d.id) in wanted)
applied = os.environ.get("BASCULE_APPLIQUER") == "1"
print(f"GRILLE\tversion {target.version}\t{len(target.criterion_ids)} critères\t{'APPLIQUÉE' if applied else 'À BLANC'}")
done = skipped = 0
for dossier in dossiers:
    summary = dossier.switch_policy(target)
    if summary is None:
        skipped += 1
        print(f"DEJA\t{dossier.reference}")
        continue
    done += 1
    print(f"BASCULE\t{summary['reference']}\tgate {summary['gate']}\t{summary['moved']} repris\t"
          f"{summary['not_assessed']} non évalués\t{summary['na_pending']} NA à valider\t{len(summary['lost'])} sans équivalent")
    for name in summary["lost"]:
        print(f"PERDU\t{summary['reference']}\t{name}")
    score = dossier.scoring()
    print(f"SCORES\t{summary['reference']}\tReadiness {score['readiness']:g}\tAPD {score['apd']:g}\t"
          f"Bankability {score['bankability']:g}\t{score['classification']}")
print(f"BILAN\t{done} basculés\t{skipped} déjà sur la méthode")
if applied:
    env.cr.commit()
else:
    env.cr.rollback()
    print("À BLANC : rien n'est enregistré. BASCULE_APPLIQUER=1 pour enregistrer.")
