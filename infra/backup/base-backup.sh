#!/usr/bin/env bash
# Sauvegarde de base (pg_basebackup, toutes les bases du serveur) puis purge selon la rétention.
# Avec les segments WAL archivés en continu, elle permet de restaurer à n'importe quel instant
# depuis la plus ancienne sauvegarde conservée.
set -euo pipefail
. /usr/local/bin/common.sh

stamp=$(date +%Y%m%dT%H%M)
dest="$BACKUP_DIR/base/$stamp"
mkdir -p "$BACKUP_DIR/base"
find "$BACKUP_DIR/base" -mindepth 1 -maxdepth 1 -name '*.partial' -exec rm -rf {} +

log "Sauvegarde de base $stamp : début."
pg_basebackup -D "$dest.partial" -Ft -z -X stream --checkpoint=fast --label "eguitra-$stamp" --no-password
# Premier segment WAL nécessaire à cette sauvegarde : les segments plus anciens deviennent inutiles
# une fois les sauvegardes plus anciennes purgées.
tar -xzOf "$dest.partial/base.tar.gz" backup_label \
  | sed -n 's/^START WAL LOCATION: .*(file \([0-9A-F]\{24\}\))$/\1/p' > "$dest.partial/wal_start"
[[ -s "$dest.partial/wal_start" ]] || { log "backup_label illisible : sauvegarde rejetée."; exit 1; }
mv "$dest.partial" "$dest"
log "Sauvegarde de base $stamp terminée ($(du -sh "$dest" | cut -f1))."
mark_ok base

# Rétention : on garde les sauvegardes récentes, et toujours les deux dernières.
limit=$(date -d "-${BACKUP_RETENTION_DAYS} days" +%Y%m%dT%H%M)
mapfile -t all < <(base_backups)
for i in "${!all[@]}"; do
  name=$(basename "${all[$i]}")
  if (( ${#all[@]} - i > 2 )) && [[ "$name" < "$limit" ]]; then
    rm -rf "${all[$i]}"
    log "Sauvegarde de base $name purgée (plus de ${BACKUP_RETENTION_DAYS} jours)."
  fi
done
oldest=$(base_backups | head -1)
pg_archivecleanup -x .gz "$BACKUP_DIR/wal" "$(cat "$oldest/wal_start")"
log "Segments WAL antérieurs à $(basename "$oldest") purgés."
