#!/usr/bin/env bash
# Contrôle de santé des sauvegardes (healthcheck du conteneur backup) : code 1 si
#  - l'archivage des WAL échoue ou n'a rien produit depuis 15 minutes (un segment toutes les 5 minutes) ;
#  - la dernière sauvegarde de base date de plus de 26 heures ;
#  - la copie hors site des WAL date de plus de 15 minutes, celle des pièces jointes de plus d'une
#    heure, ou la copie hors site n'est pas configurée alors qu'elle est exigée (OFFSITE_REQUIRED=1,
#    à poser avant la mise en service : sans elle, la perte de données ne serait pas bornée en cas
#    de perte du serveur).
set -uo pipefail
. /usr/local/bin/common.sh

problems=()
read -r archived failed < <(psql -d postgres -Atc \
  "select coalesce(extract(epoch from now() - last_archived_time)::int, 999999999),
          coalesce(last_failed_time > coalesce(last_archived_time, 'epoch'), false)
   from pg_stat_archiver" -F ' ' 2>/dev/null || echo "999999999 t")
(( archived > 900 )) && problems+=("aucun segment WAL archivé depuis $((archived / 60)) min")
[[ "$failed" == "t" ]] && problems+=("dernier archivage WAL en échec")
(( $(age_of base) > 93600 )) && problems+=("sauvegarde de base trop ancienne")
(( $(age_of files) > 3600 )) && problems+=("copie du filestore trop ancienne")
if [[ -n "${RECETTE_PGPASSWORD:-}" ]] && [[ -f "$BACKUP_DIR/status/recette" ]] && (( $(age_of recette) > 93600 )); then
  problems+=("copie de la recette trop ancienne")
fi
if [[ -n "${RCLONE_REMOTE:-}" ]]; then
  (( $(age_of offsite_wal) > 900 )) && problems+=("copie hors site des WAL en retard de $(( $(age_of offsite_wal) / 60 )) min")
  (( $(age_of offsite) > 3600 )) && problems+=("copie hors site des pièces jointes en retard")
elif [[ "${OFFSITE_REQUIRED:-0}" == "1" ]]; then
  problems+=("copie hors site exigée mais non configurée (RCLONE_REMOTE)")
fi

if (( ${#problems[@]} )); then
  printf 'ALERTE : %s\n' "${problems[@]}"
  exit 1
fi
echo "Sauvegardes à jour."
