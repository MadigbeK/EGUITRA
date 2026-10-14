#!/usr/bin/env bash
# Copie des pièces jointes du noyau (filestore) : miroir à jour toutes les 15 minutes et, avec
# --snapshot, instantané quotidien en liens physiques (seuls les nouveaux fichiers occupent de la place).
set -euo pipefail
. /usr/local/bin/common.sh

src="/var/lib/odoo/filestore/${ODOO_DB:?ODOO_DB manquant}"
if [[ ! -d "$src" ]]; then
  log "Filestore $src absent : rien à copier."
  mark_ok files
  exit 0
fi
mkdir -p "$BACKUP_DIR/filestore/current" "$BACKUP_DIR/filestore/snapshots"
rsync -a --delete "$src/" "$BACKUP_DIR/filestore/current/"
mark_ok files

if [[ "${1:-}" == "--snapshot" ]]; then
  snap="$BACKUP_DIR/filestore/snapshots/$(date +%Y%m%d)"
  [[ -d "$snap" ]] || cp -al "$BACKUP_DIR/filestore/current" "$snap"
  limit=$(date -d "-${BACKUP_RETENTION_DAYS} days" +%Y%m%d)
  for dir in "$BACKUP_DIR"/filestore/snapshots/2*; do
    [[ -d "$dir" && "$(basename "$dir")" < "$limit" ]] && rm -rf "$dir" && log "Instantané $(basename "$dir") purgé."
  done
  log "Instantané du filestore $(basename "$snap") prêt."
fi
