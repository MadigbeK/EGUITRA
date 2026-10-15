#!/usr/bin/env bash
# Crée un compte d'administration de la plateforme, ouvert aux deux sociétés, au mot de passe
# provisoire (à remplacer à la première connexion, avec activation de la double authentification).
#   infra/admin-account.sh production|recette identifiant "Nom de l'administrateur"
# Variables facultatives :
#   ADMIN_PROFILES=admin,direction,...  profils du compte (par défaut : admin) ; « tous » donne tous
#                                       les profils internes (super administrateur), le profil
#                                       porteur de projet excepté (il ne se combine avec aucun autre)
#   ADMIN_PASSWORD=...                  mot de passe provisoire imposé (10 caractères au moins) ;
#                                       sinon il est tiré au hasard
#   ADMIN_PASSWORD_FILE=chemin          le mot de passe tiré au hasard est écrit dans ce fichier
#                                       (lisible par le seul utilisateur courant) au lieu d'être affiché
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

[ $# -eq 3 ] || { echo "Usage : infra/admin-account.sh production|recette identifiant \"Nom de l'administrateur\"" >&2; exit 2; }
case "$1" in
  production) SERVICE=odoo; DB=${INIT_DB:-$ODOO_DB} ;;
  recette) SERVICE=odoo-recette; DB=${INIT_DB:-$RECETTE_DB} ;;
  *) echo "Environnement inconnu : $1 (production ou recette)." >&2; exit 2 ;;
esac
ADMIN_LOGIN=$(echo "$2" | tr '[:upper:]' '[:lower:]')
ADMIN_NAME=$3
ADMIN_PROFILES=${ADMIN_PROFILES:-admin}
[ "$ADMIN_PROFILES" = "tous" ] && ADMIN_PROFILES=admin,direction,finance,exploitation,chantiers,immobilier,cabinet
imposed=${ADMIN_PASSWORD:+1}
if [ -n "$imposed" ]; then
  [ ${#ADMIN_PASSWORD} -ge 10 ] || { echo "Mot de passe provisoire trop court (10 caractères au moins)." >&2; exit 2; }
else
  ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)-$(date +%Y)
fi
export ADMIN_LOGIN ADMIN_NAME ADMIN_PASSWORD ADMIN_PROFILES

# Les valeurs passent par l'environnement (-e NOM sans valeur) : le mot de passe n'apparaît pas dans
# la ligne de commande du conteneur.
docker compose run --rm -T -e ADMIN_LOGIN -e ADMIN_NAME -e ADMIN_PASSWORD -e ADMIN_PROFILES \
  "$SERVICE" odoo shell -c /etc/odoo/odoo.conf -d "$DB" --no-http --log-level=warn <<'PY'
import os
import sys

from odoo import Command

login = os.environ["ADMIN_LOGIN"]
profiles = [p.strip() for p in os.environ["ADMIN_PROFILES"].split(",") if p.strip()]
if env["res.users"].with_context(active_test=False).search_count([("login", "=", login)]):
    print(f"ÉCHEC : l'identifiant {login} existe déjà.")
    sys.exit(1)
companies = env["res.company"].search([])
user = env["res.users"].with_context(no_reset_password=True).create({
    "name": os.environ["ADMIN_NAME"],
    "login": login,
    "password": os.environ["ADMIN_PASSWORD"],
    "eguitra_password_temporary": True,
    "company_id": env.ref("base.main_company").id,
    "company_ids": [Command.set(companies.ids)],
})
user._eguitra_set_profiles(profiles)
env.cr.commit()
print("COMPTE CRÉÉ ; profils : " + ", ".join(user._eguitra_profiles()))
print("Sociétés ouvertes : " + ", ".join(companies.mapped("name")))
PY

echo "Administrateur $ADMIN_LOGIN ($1, base $DB)."
if [ -n "$imposed" ]; then
  echo "Mot de passe provisoire : celui fourni (à remplacer à la première connexion)."
elif [ -n "${ADMIN_PASSWORD_FILE:-}" ]; then
  (umask 077; mkdir -p "$(dirname "$ADMIN_PASSWORD_FILE")"; printf '%s %s\n' "$ADMIN_LOGIN" "$ADMIN_PASSWORD" > "$ADMIN_PASSWORD_FILE")
  echo "Mot de passe provisoire enregistré dans $ADMIN_PASSWORD_FILE (à supprimer une fois remis)."
else
  echo "Mot de passe provisoire (affiché une seule fois) : $ADMIN_PASSWORD"
fi
