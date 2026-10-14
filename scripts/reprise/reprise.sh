#!/usr/bin/env bash
# Reprise des données (sur le serveur, depuis n'importe où dans le dépôt) :
#   scripts/reprise/reprise.sh recette dossier-des-csv                 contrôle seulement, rien n'est enregistré
#   scripts/reprise/reprise.sh recette dossier-des-csv --appliquer     enregistre si aucune anomalie
#   scripts/reprise/reprise.sh production dossier-des-csv [--appliquer]
# Toujours rejouer d'abord en recette. Variables facultatives : REPRISE_DATE_OUVERTURE (AAAA-MM-JJ,
# défaut 1er janvier de l'année), REPRISE_SOCIETE (groupe ou cabinet, défaut groupe : chaque société
# a sa propre comptabilité et se reprend séparément), REPRISE_UTILISATEUR (identifiant d'un
# administrateur), REPRISE_BUDGET_ANNEE, INIT_DB (autre base de l'environnement, pour un essai).
set -euo pipefail
[ $# -ge 2 ] || { echo "Usage : scripts/reprise/reprise.sh production|recette dossier-des-csv [--appliquer]" >&2; exit 2; }
DIR=$(cd "$2" && pwd)
APPLY=0
[ "${3:-}" = "--appliquer" ] && APPLY=1
cd "$(dirname "$0")/../../infra"
set -a; . ./.env; set +a
case "$1" in
  production) SERVICE=odoo; DB=${INIT_DB:-$ODOO_DB} ;;
  recette) SERVICE=odoo-recette; DB=${INIT_DB:-$RECETTE_DB} ;;
  *) echo "Environnement inconnu : $1 (production ou recette)." >&2; exit 2 ;;
esac

echo "Environnement $1, base $DB, société ${REPRISE_SOCIETE:-groupe}, fichiers de $DIR," \
     "$([ $APPLY = 1 ] && echo "enregistrement" || echo "contrôle seulement")."
docker compose run --rm -T -v "$DIR:/reprise:ro" \
  -e REPRISE_APPLIQUER="$APPLY" -e REPRISE_DATE_OUVERTURE="${REPRISE_DATE_OUVERTURE:-}" \
  -e REPRISE_SOCIETE="${REPRISE_SOCIETE:-groupe}" -e REPRISE_UTILISATEUR="${REPRISE_UTILISATEUR:-}" \
  -e REPRISE_BUDGET_ANNEE="${REPRISE_BUDGET_ANNEE:-}" \
  "$SERVICE" odoo shell -c /etc/odoo/odoo.conf -d "$DB" --no-http --log-level=warn < ../scripts/reprise/reprise.py
