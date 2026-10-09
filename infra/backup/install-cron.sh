#!/usr/bin/env bash
# Installe les crons de sauvegarde pour l'utilisateur courant.
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
( crontab -l 2>/dev/null | grep -v "$DIR" ; \
  echo "15 2 * * * $DIR/backup.sh >> $HOME/backup.log 2>&1" ; \
  echo "*/15 * * * * $DIR/sync-wal.sh >> $HOME/wal.log 2>&1" ) | crontab -
echo "Crons installés : sauvegarde complète à 02 h 15, journaux toutes les 15 minutes."
