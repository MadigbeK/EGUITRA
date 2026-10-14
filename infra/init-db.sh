#!/usr/bin/env bash
# Crée la base servie par le noyau (ODOO_DB de infra/.env) : français, Guinée, plan de comptes
# SYSCOHADA, modules OCA et modules EGUITRA, puis le premier administrateur.
#   infra/init-db.sh identifiant "Nom de l'administrateur"
# Le mot de passe provisoire s'affiche une seule fois : le remettre à l'administrateur, qui le
# remplacera et activera la double authentification à sa première connexion.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
# INIT_DB permet un essai sur une autre base sans toucher à .env (la base servie reste ODOO_DB).
ODOO_DB=${INIT_DB:-$ODOO_DB}

[ $# -eq 2 ] || { echo "Usage : infra/init-db.sh identifiant \"Nom de l'administrateur\"" >&2; exit 2; }
ADMIN_LOGIN=$(echo "$1" | tr '[:upper:]' '[:lower:]')
ADMIN_NAME=$2
EGUITRA_MODULES=(eguitra_base eguitra_api eguitra_finance eguitra_approval eguitra_transport eguitra_chantier
                 eguitra_immobilier eguitra_axispro)
ODOO=(docker compose run --rm -T odoo odoo)
CONF=(-c /etc/odoo/odoo.conf)

if docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -Atc \
     "SELECT 1 FROM pg_database WHERE datname = '$ODOO_DB'" | grep -q 1; then
  echo "La base $ODOO_DB existe déjà : rien n'est fait." >&2
  exit 1
fi

docker compose stop odoo
"${ODOO[@]}" db "${CONF[@]}" init "$ODOO_DB" --language fr_FR --country gn
# shellcheck disable=SC2046
"${ODOO[@]}" module install "${CONF[@]}" -d "$ODOO_DB" l10n_gn $(grep -v '^#' oca/modules.txt) "${EGUITRA_MODULES[@]}"

ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)-$(date +%Y)
docker compose run --rm -T -e ADMIN_LOGIN="$ADMIN_LOGIN" -e ADMIN_NAME="$ADMIN_NAME" -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  odoo odoo shell "${CONF[@]}" -d "$ODOO_DB" --no-http --log-level=warn <<'PY'
import os
from odoo import Command

companies = env["res.company"].search([])
user = env["res.users"].with_context(no_reset_password=True).create({
    "name": os.environ["ADMIN_NAME"],
    "login": os.environ["ADMIN_LOGIN"],
    "password": os.environ["ADMIN_PASSWORD"],
    "eguitra_password_temporary": True,
    "company_id": env.ref("base.main_company").id,
    "company_ids": [Command.set(companies.ids)],
})
user._eguitra_set_profiles(["admin"])
env.cr.commit()
PY

# Le module d'audit modifie les modèles au chargement de ses règles : redémarrer le noyau.
docker compose start odoo
echo "Base $ODOO_DB prête. Administrateur : $ADMIN_LOGIN"
echo "Mot de passe provisoire (affiché une seule fois) : $ADMIN_PASSWORD"
