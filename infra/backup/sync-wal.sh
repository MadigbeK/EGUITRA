#!/usr/bin/env bash
# Pousse les journaux de transactions archivés hors site. À lancer toutes les 15 minutes.
set -euo pipefail
cd "$(dirname "$0")/.." && set -a && . ./.env && set +a
VOL=$(docker volume inspect -f '{{.Mountpoint}}' "$(basename "$PWD")_wal-archive")
rclone sync "$VOL" "$RCLONE_REMOTE/wal/" --min-age 1m
# Nettoyage local des journaux de plus de 30 jours
find "$VOL" -type f -mtime +30 -delete
