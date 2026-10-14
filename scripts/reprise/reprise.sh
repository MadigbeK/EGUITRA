#!/usr/bin/env bash
# Reprise des données (sur le serveur, depuis infra/ ou n'importe où dans le dépôt) :
#   scripts/reprise/reprise.sh dossier-des-csv                 contrôle seulement, rien n'est enregistré
#   scripts/reprise/reprise.sh dossier-des-csv --appliquer     enregistre si aucune anomalie
# Variables facultatives : REPRISE_DATE_OUVERTURE (AAAA-MM-JJ, défaut 1er janvier de l'année),
# REPRISE_SOCIETE (groupe ou cabinet, défaut groupe), REPRISE_UTILISATEUR (identifiant d'un
# administrateur), INIT_DB (autre base que celle de .env, pour un essai).
set -euo pipefail
[ $# -ge 1 ] || { echo "Usage : scripts/reprise/reprise.sh dossier-des-csv [--appliquer]" >&2; exit 2; }
DIR=$(cd "$1" && pwd)
APPLY=0
[ "${2:-}" = "--appliquer" ] && APPLY=1
cd "$(dirname "$0")/../../infra"
set -a; . ./.env; set +a
DB=${INIT_DB:-$ODOO_DB}

echo "Base $DB, fichiers de $DIR, $([ $APPLY = 1 ] && echo "enregistrement" || echo "contrôle seulement")."
docker compose run --rm -T -v "$DIR:/reprise:ro" \
  -e REPRISE_APPLIQUER="$APPLY" -e REPRISE_DATE_OUVERTURE="${REPRISE_DATE_OUVERTURE:-}" \
  -e REPRISE_SOCIETE="${REPRISE_SOCIETE:-groupe}" -e REPRISE_UTILISATEUR="${REPRISE_UTILISATEUR:-}" \
  odoo odoo shell -c /etc/odoo/odoo.conf -d "$DB" --no-http --log-level=warn < ../scripts/reprise/reprise.py
