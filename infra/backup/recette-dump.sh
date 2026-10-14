#!/usr/bin/env bash
# Copie logique de la base de recette, chaque nuit, gardée 7 jours sur le serveur (pas de copie
# hors site) : les essais des référents pendant la recette ne se perdent pas en cas de fausse
# manœuvre. Restauration : pg_restore --create dans la grappe db-recette (voir README.md).
set -euo pipefail
. /usr/local/bin/common.sh

if [[ -z "${RECETTE_PGPASSWORD:-}" || -z "${RECETTE_DB:-}" ]]; then
  log "Copie de la recette non configurée."
  exit 0
fi
dir="$BACKUP_DIR/recette"
mkdir -p "$dir"
file="$dir/${RECETTE_DB}-$(date +%Y%m%dT%H%M).dump"
PGPASSWORD=$RECETTE_PGPASSWORD pg_dump -h db-recette -U "$PGUSER" -Fc -f "$file.partial" "$RECETTE_DB"
mv "$file.partial" "$file"
find "$dir" -name '*.dump' -mtime +7 -delete
mark_ok recette
log "Copie de la recette $(basename "$file") prête ($(du -h "$file" | cut -f1))."
