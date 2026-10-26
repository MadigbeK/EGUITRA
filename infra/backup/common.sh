#!/usr/bin/env bash
# Fonctions communes aux scripts de sauvegarde (conteneur backup).
BACKUP_DIR=${BACKUP_DIR:-/backup}
BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}
OFFSITE_RETENTION_DAYS=${OFFSITE_RETENTION_DAYS:-30}
MONTHLY_RETENTION_DAYS=${MONTHLY_RETENTION_DAYS:-366}
# Journaux hors site : 15 jours, pour garantir 14 jours complets de restauration à un instant donné
# (la sauvegarde de base qui précède l'instant visé peut dater de la veille).
WAL_RETENTION_DAYS=${WAL_RETENTION_DAYS:-15}

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*"
}

# Horodatage du dernier succès d'une tâche (lu par check.sh).
mark_ok() {
  mkdir -p "$BACKUP_DIR/status"
  date +%s > "$BACKUP_DIR/status/$1"
}

# Âge en secondes du dernier succès d'une tâche (très grand si jamais réussie).
age_of() {
  local f="$BACKUP_DIR/status/$1"
  if [[ -f "$f" ]]; then echo $(( $(date +%s) - $(cat "$f") )); else echo 999999999; fi
}

# Sauvegardes de base complètes, de la plus ancienne à la plus récente.
base_backups() {
  find "$BACKUP_DIR/base" -mindepth 1 -maxdepth 1 -type d -name '2*' ! -name '*.partial' 2>/dev/null | sort
}
