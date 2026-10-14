#!/usr/bin/env bash
# Contrôle de santé des sauvegardes (healthcheck du conteneur backup) : code 1 si
#  - l'archivage des WAL échoue ou n'a rien produit depuis 30 minutes ;
#  - la dernière sauvegarde de base date de plus de 26 heures ;
#  - la copie hors site, si elle est configurée, n'a pas réussi depuis 1 heure.
set -uo pipefail
. /usr/local/bin/common.sh

problems=()
read -r archived failed < <(psql -d postgres -Atc \
  "select coalesce(extract(epoch from now() - last_archived_time)::int, 999999999),
          coalesce(last_failed_time > coalesce(last_archived_time, 'epoch'), false)
   from pg_stat_archiver" -F ' ' 2>/dev/null || echo "999999999 t")
(( archived > 1800 )) && problems+=("aucun segment WAL archivé depuis $((archived / 60)) min")
[[ "$failed" == "t" ]] && problems+=("dernier archivage WAL en échec")
(( $(age_of base) > 93600 )) && problems+=("sauvegarde de base trop ancienne")
(( $(age_of files) > 3600 )) && problems+=("copie du filestore trop ancienne")
if [[ -n "${RECETTE_PGPASSWORD:-}" ]] && [[ -f "$BACKUP_DIR/status/recette" ]] && (( $(age_of recette) > 93600 )); then
  problems+=("copie de la recette trop ancienne")
fi
if [[ -n "${RCLONE_REMOTE:-}" ]] && (( $(age_of offsite) > 3600 )); then
  problems+=("copie hors site en retard")
fi

if (( ${#problems[@]} )); then
  printf 'ALERTE : %s\n' "${problems[@]}"
  exit 1
fi
echo "Sauvegardes à jour."
