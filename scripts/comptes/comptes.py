# ruff: noqa: F821 (env est fourni par « odoo shell »)
"""Création des comptes des utilisateurs du client, en production ou en recette.

La liste nominative n'est jamais dans le dépôt : elle arrive par la variable COMPTES_JSON, liste
d'objets {"login", "nom", "email", "telephone", "profils": [...], "societes": ["groupe", "cabinet"]}
(la première société est celle par défaut). COMPTES_ENVIRONNEMENT doit valoir le libellé de la base
(« production » ou « recette ») : un garde-fou contre une base inattendue.

Chaque compte nouveau reçoit un mot de passe provisoire (à remplacer à la première connexion, avec
l'activation de la double authentification) ; il n'est écrit que sur la sortie standard, à rediriger
vers le fichier protégé infra/secrets/ du serveur. Un compte existant garde son mot de passe ; ses
profils, sociétés, nom, courriel et téléphone sont mis à jour.

Lancement sur le serveur, depuis infra/ :

  umask 077
  COMPTES_JSON="$(cat secrets/comptes-client.json)" docker compose exec -T -e COMPTES_JSON \\
      -e COMPTES_ENVIRONNEMENT=production odoo odoo shell -c /etc/odoo/odoo.conf -d "$ODOO_DB" \\
      --no-http --log-level=warn < ../scripts/comptes/comptes.py > secrets/comptes-client.log
  grep '^COMPTE' secrets/comptes-client.log >> secrets/comptes-client-production.tsv
  grep '^RESUME' secrets/comptes-client.log; rm secrets/comptes-client.log
"""

import json
import os
import secrets
import string

from odoo import Command

from odoo.addons.eguitra_api.organisation import PROFILE_ENTITY

attendu = os.environ.get("COMPTES_ENVIRONNEMENT")
label = env["ir.config_parameter"].sudo().get_param("eguitra_api.environment_label") or "production"
assert attendu and attendu == label, f"Base « {label} », environnement demandé « {attendu} » : arrêt."

Company = env["res.company"].sudo()
SOCIETES = {e: Company.search([("eguitra_entity", "=", e)], limit=1) for e in ("groupe", "cabinet")}
assert all(SOCIETES.values()), "Sociétés de la plateforme introuvables."
ALPHABET = "".join(c for c in string.ascii_letters + string.digits if c not in "Il1O0o")


def mot_de_passe():
    return "Nimova-" + "".join(secrets.choice(ALPHABET) for _ in range(12))


comptes = json.loads(os.environ["COMPTES_JSON"])
Users = env["res.users"].sudo().with_context(no_reset_password=True, active_test=False)
erreurs = []
for c in comptes:
    login = c["login"].strip().lower()
    for profil in c["profils"]:
        entite = PROFILE_ENTITY.get(profil)
        if entite and entite not in c["societes"]:
            erreurs.append(f"{login} : le profil {profil} exige la société {entite}.")
if erreurs:
    raise SystemExit("\n".join(erreurs))

for c in comptes:
    login = c["login"].strip().lower()
    societes = Company.browse([SOCIETES[e].id for e in c["societes"]])
    valeurs = {"name": c["nom"], "email": c.get("email") or login, "company_id": societes[0].id,
               "company_ids": [Command.set(societes.ids)]}
    user = Users.search([("login", "=", login)], limit=1)
    nouveau = not user
    password = None
    if nouveau:
        password = mot_de_passe()
        user = Users.create(dict(valeurs, login=login, password=password, eguitra_password_temporary=True,
                                 lang="fr_FR", tz="Africa/Conakry"))
    else:
        user.write(dict(valeurs, active=True))
    if c.get("telephone"):
        user.partner_id.phone = c["telephone"]
    user._eguitra_set_profiles(c["profils"])
    if password:
        print(f"COMPTE\t{login}\t{password}\t{c['nom']}")
    print(f"RESUME\t{login}\t{'créé' if nouveau else 'mis à jour'}\tprofils={','.join(user._eguitra_profiles())}\t"
          f"applications={','.join(user._eguitra_apps())}\tsociétés={', '.join(user.company_ids.mapped('name'))}")

env.cr.commit()
