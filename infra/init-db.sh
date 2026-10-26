#!/usr/bin/env bash
# Crée la base d'un environnement : français, Guinée, plan de comptes SYSCOHADA, modules OCA et
# modules EGUITRA, les deux sociétés (EGUITRA GROUP SARLU et MB AxisPro Consulting, comptabilités
# séparées), puis le premier administrateur, ouvert aux deux sociétés.
#   infra/init-db.sh production identifiant "Nom de l'administrateur"
#   infra/init-db.sh recette identifiant "Nom de l'administrateur"
# Le mot de passe provisoire s'affiche une seule fois (ou va dans ADMIN_PASSWORD_FILE, voir
# admin-account.sh) : le remettre à l'administrateur, qui activera la double authentification et
# le remplacera à sa première connexion.
# INIT_DB=autre_base permet un essai sur une autre base du même environnement.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

[ $# -eq 3 ] || { echo "Usage : infra/init-db.sh production|recette identifiant \"Nom de l'administrateur\"" >&2; exit 2; }
case "$1" in
  production) SERVICE=odoo; WEB=web; DB_SERVICE=db; DB=${INIT_DB:-$ODOO_DB}
              [ -e releases/current ] || { echo "Aucune version de production : lancer infra/up.sh." >&2; exit 1; } ;;
  recette) SERVICE=odoo-recette; WEB=web-recette; DB_SERVICE=db-recette; DB=${INIT_DB:-$RECETTE_DB} ;;
  *) echo "Environnement inconnu : $1 (production ou recette)." >&2; exit 2 ;;
esac
ADMIN_LOGIN=$(echo "$2" | tr '[:upper:]' '[:lower:]')
ADMIN_NAME=$3
EGUITRA_MODULES=(eguitra_base eguitra_api eguitra_finance eguitra_approval eguitra_transport eguitra_chantier
                 eguitra_immobilier eguitra_axispro eguitra_analytics eguitra_portail eguitra_rh eguitra_chat
                 eguitra_hsseq)
ODOO=(docker compose run --rm -T "$SERVICE" odoo)
CONF=(-c /etc/odoo/odoo.conf)

psql_db() { docker compose exec -T "$DB_SERVICE" psql -U "$POSTGRES_USER" -d "$1" -Atc "$2"; }

docker compose stop "$SERVICE"
if psql_db postgres "SELECT 1 FROM pg_database WHERE datname = '$DB'" | grep -q 1; then
  # Un noyau démarré sans sa base la crée d'office, vide (module base seul). Cette base-là se
  # remplace ; une base où les modules EGUITRA sont installés n'est jamais touchée.
  if psql_db "$DB" "SELECT 1 FROM ir_module_module WHERE name = 'eguitra_base' AND state = 'installed'" | grep -q 1; then
    echo "La base $DB existe déjà, avec les modules EGUITRA : rien n'est fait." >&2
    docker compose up -d "$SERVICE" "$WEB"
    exit 1
  fi
  echo "Base $DB vide (créée d'office par le noyau à son démarrage) : elle est remplacée."
  psql_db postgres "DROP DATABASE \"$DB\" WITH (FORCE)"
fi

"${ODOO[@]}" db "${CONF[@]}" init "$DB" --language fr_FR --country gn
# shellcheck disable=SC2046
"${ODOO[@]}" module install "${CONF[@]}" -d "$DB" l10n_gn $(grep -v '^#' oca/modules.txt) "${EGUITRA_MODULES[@]}"

ADMIN_PASSWORD_FILE=${ADMIN_PASSWORD_FILE:-} ./admin-account.sh "$1" "$ADMIN_LOGIN" "$ADMIN_NAME"

# Le module d'audit modifie les modèles au chargement de ses règles : redémarrer le noyau.
docker compose up -d "$SERVICE" "$WEB"
echo "Base $DB ($1) prête."
