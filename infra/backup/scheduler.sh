#!/usr/bin/env bash
# Planificateur des sauvegardes (boucle à la minute, sans cron) :
#  - toutes les 15 minutes : miroir du filestore puis copie hors site des WAL et pièces jointes ;
#  - chaque nuit à BACKUP_HOUR h 30 : sauvegarde de base, instantané du filestore, copie hors site
#    complète et purges ;
#  - au démarrage, et tant qu'aucune n'a réussi, une sauvegarde de base (les WAL seuls ne suffisent
#    pas à restaurer).
# L'archivage continu des WAL est fait par PostgreSQL lui-même (archive-wal.sh, archive_timeout).
set -uo pipefail
. /usr/local/bin/common.sh

BACKUP_HOUR=${BACKUP_HOUR:-01}
log "Planificateur des sauvegardes démarré (sauvegarde de base à ${BACKUP_HOUR} h 30, rétention ${BACKUP_RETENTION_DAYS} jours)."
last_night=""
last_try=0

while true; do
  now=$(date +%s)
  minute=$(date +%M)
  if [[ -z "$(base_backups | tail -1)" ]] && (( now - last_try >= 600 )); then
    last_try=$now
    /usr/local/bin/base-backup.sh || log "ÉCHEC de la sauvegarde de base initiale, nouvel essai dans 10 minutes."
  fi
  if (( 10#$minute % 15 == 0 )); then
    /usr/local/bin/files-backup.sh || log "ÉCHEC de la copie du filestore."
    /usr/local/bin/offsite.sh quick || log "ÉCHEC de la copie hors site."
  fi
  if [[ "$(date +%H)" == "$BACKUP_HOUR" && "$minute" == "30" && "$last_night" != "$(date +%F)" ]]; then
    last_night=$(date +%F)
    /usr/local/bin/base-backup.sh || log "ÉCHEC de la sauvegarde de base."
    /usr/local/bin/files-backup.sh --snapshot || log "ÉCHEC de l'instantané du filestore."
    /usr/local/bin/offsite.sh full || log "ÉCHEC de la copie hors site complète."
  fi
  sleep $(( 60 - 10#$(date +%S) ))
done
