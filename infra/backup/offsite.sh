#!/usr/bin/env bash
# Envoi hors site, chiffré, des sauvegardes (rclone). RCLONE_REMOTE désigne un distant de type
# « crypt » : les fichiers sont chiffrés sur le serveur avant de partir (voir backup.env.example).
#   offsite.sh quick   segments WAL et pièces jointes (toutes les 15 minutes)
#   offsite.sh full    en plus, sauvegardes de base et purge distante (chaque nuit)
set -euo pipefail
. /usr/local/bin/common.sh

if [[ -z "${RCLONE_REMOTE:-}" ]]; then
  log "Copie hors site non configurée (RCLONE_REMOTE vide) : sauvegardes seulement locales."
  exit 0
fi
remote="${RCLONE_REMOTE%/}"
opts=(--ignore-existing --transfers 4 --retries 3 --low-level-retries 10 --stats-one-line --stats 0)

rclone copy "$BACKUP_DIR/wal" "$remote/wal" --exclude '*.tmp' "${opts[@]}"
rclone copy "$BACKUP_DIR/filestore/current" "$remote/filestore" "${opts[@]}"
if [[ "${1:-quick}" == "full" ]]; then
  rclone copy "$BACKUP_DIR/base" "$remote/base" --exclude '*.partial/**' "${opts[@]}"
  rclone delete "$remote/base" --min-age "${OFFSITE_RETENTION_DAYS}d"
  rclone delete "$remote/wal" --min-age "${OFFSITE_RETENTION_DAYS}d"
  rclone rmdirs "$remote/base" --leave-root
  mark_ok offsite_full
fi
mark_ok offsite
log "Copie hors site (${1:-quick}) terminée."
