#!/usr/bin/env bash
# Mise en production : fige le code validé en recette et l'installe sur le noyau de production.
#   infra/release.sh                  nouvelle version : code actuel de la recette, sauvegarde de la
#                                     base, mise à jour des modules, redémarrage, contrôle
#   infra/release.sh --annoncee "AAAA-MM-JJ HH:MM"
#                                     idem, en précisant quand la mise en production a été annoncée
#                                     au client (heure de Conakry) : annoncée 48 heures à l'avance au
#                                     moins, l'interruption est une maintenance programmée, exclue du
#                                     calcul de la disponibilité ; sinon elle y compte
#   infra/release.sh --list           versions conservées et version en service
#   infra/release.sh --rollback ID    remet en service le code d'une version précédente ; la base
#                                     n'est pas restaurée (voir backup/README.md si besoin)
#   infra/release.sh --initial        première version, avant la création de la base (appelé par up.sh)
# Une version = les modules EGUITRA et OCA copiés dans releases/ID (lecture seule pour le noyau), le
# code source des applications web (réversibilité : l'image n'en contient que la construction) et les
# images eguitra/odoo:release-ID et eguitra/web:release-ID. Annoncer la mise en production 48 heures
# à l'avance (offre, chapitre 5.2) : le noyau s'arrête une à deux minutes.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
umask 022  # le code figé doit rester lisible par l'utilisateur odoo des conteneurs

RELEASES=releases
KEEP=5
MODULES=eguitra_base,eguitra_api,eguitra_finance,eguitra_approval,eguitra_transport,eguitra_chantier,eguitra_immobilier,eguitra_axispro,eguitra_analytics,eguitra_portail,eguitra_rh,eguitra_chat,eguitra_hsseq
mkdir -p "$RELEASES" ../logs

current() { readlink "$RELEASES/current" 2>/dev/null || true; }

prod_db_exists() {
  docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -Atc \
    "SELECT 1 FROM pg_database WHERE datname = '$ODOO_DB'" 2>/dev/null | grep -q 1
}

# Code et images de production sur la version $1 (bascule du lien en une seule opération).
activate() {
  docker tag "eguitra/odoo:release-$1" eguitra/odoo:production
  docker tag "eguitra/web:release-$1" eguitra/web:production
  ln -sfn "$1" "$RELEASES/current.tmp"
  mv -Tf "$RELEASES/current.tmp" "$RELEASES/current"
}

restart_production() {
  docker compose up -d --force-recreate --no-deps odoo web
}

wait_healthy() {
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:8069/api/v1/health 2>/dev/null \
       && curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:3000/login 2>/dev/null; then
      return 0
    fi
    sleep 5
  done
  return 1
}

announced=""
if [ "${1:-}" = "--annoncee" ]; then
  [ -n "${2:-}" ] || { echo "Préciser la date de l'annonce : --annoncee \"AAAA-MM-JJ HH:MM\"" >&2; exit 2; }
  announced=$(date -d "$2" +%s) || { echo "Date d'annonce illisible : $2" >&2; exit 2; }
  shift 2
fi

case "${1:-}" in
  --list)
    echo "Version en service : $(current)"
    find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -name '2*' -printf '%f\n' | sort -r
    [ -f "$RELEASES/HISTORY" ] && { echo "Historique :"; tail -20 "$RELEASES/HISTORY"; }
    exit 0
    ;;
  --rollback)
    id=${2:?"Préciser la version : infra/release.sh --rollback ID (voir --list)"}
    [ -d "$RELEASES/$id" ] || { echo "Version $id inconnue." >&2; exit 1; }
    activate "$id"
    restart_production
    if wait_healthy; then echo "Production revenue à la version $id."; else echo "ATTENTION : production sans réponse." >&2; fi
    echo "$(date '+%F %T') retour à la version $id" >> "$RELEASES/HISTORY"
    echo "La base n'a pas été restaurée : si la version annulée avait modifié sa structure, la restaurer"
    echo "au point de sauvegarde pris avant sa mise en production (releases/HISTORY, backup/README.md)."
    exit 0
    ;;
  --initial | "") ;;
  *) echo "Option inconnue : $1" >&2; exit 2 ;;
esac

id=$(date +%Y%m%d-%H%M)
dir=$RELEASES/$id
[ -e "$dir" ] && { echo "La version $id existe déjà : relancer dans une minute." >&2; exit 1; }
version=$(cat ../VERSION 2>/dev/null || echo "inconnue")
prev=$(current)
echo "Version $id : code de la recette ($version)."

# 1. Images construites depuis le code de la recette, puis code figé (sans historique git ; les
#    fichiers OCA inchangés sont partagés avec la version précédente).
docker compose build odoo-recette web-recette
# La recette tourne sur les images qui viennent d'être construites : ce qui part en production est
# exactement ce qui tourne en recette.
for svc in odoo-recette web-recette; do
  cid=$(docker compose ps -q "$svc")
  [ -n "$cid" ] || continue
  if [ "$(docker image inspect -f '{{.Id}}' "eguitra/${svc%-recette}:recette")" != "$(docker inspect -f '{{.Image}}' "$cid")" ]; then
    docker compose up -d --force-recreate --no-deps "$svc"
  fi
done
mkdir -p "$dir"
rsync -a --exclude __pycache__ ../addons/ "$dir/addons/"
rsync -a --exclude node_modules --exclude .next --exclude tsconfig.tsbuildinfo ../apps/web/ "$dir/web/"
if [ -n "$prev" ]; then
  rsync -a --exclude .git --link-dest "$PWD/$RELEASES/$prev/oca" oca-src/ "$dir/oca/"
else
  rsync -a --exclude .git oca-src/ "$dir/oca/"
fi
echo "$version" > "$dir/VERSION"
docker tag eguitra/odoo:recette "eguitra/odoo:release-$id"
docker tag eguitra/web:recette "eguitra/web:release-$id"

# 2. Mise en service : sauvegarde de la base, mise à jour des modules, redémarrage.
stamp=""
if [ "${1:-}" != "--initial" ] && prod_db_exists; then
  echo "Sauvegarde de base avant mise à jour."
  docker compose exec -T backup base-backup.sh
  stamp=$(date '+%F %T')
  activate "$id"
  down_since=$(date '+%F %H:%M')
  docker compose stop web odoo
  # Base et sauvegardes recréées seulement si leur configuration ou leurs scripts ont changé (archivage des WAL, par
  # exemple), pendant que le noyau est arrêté.
  docker compose up -d --no-deps --build db backup
  log=../logs/release-$id.log
  # -i installe un module nouveau de la version (sans effet sur un module déjà installé), -u met à jour les autres.
  if ! docker compose run --rm -T --no-deps odoo odoo -c /etc/odoo/odoo.conf -d "$ODOO_DB" -i "$MODULES" -u "$MODULES" \
         --stop-after-init --workers 0 > "$log" 2>&1 || grep -qE " (ERROR|CRITICAL) " "$log"; then
    echo "ÉCHEC de la mise à jour des modules (journal : $log)." >&2
    if [ -n "$prev" ]; then activate "$prev"; fi
    restart_production
    echo "Code de la version précédente ($prev) remis en service. La base a pu être modifiée en partie :" >&2
    echo "la restaurer à l'instant $stamp si nécessaire (backup/README.md)." >&2
    echo "$(date '+%F %T') ÉCHEC de la version $id ($version)" >> "$RELEASES/HISTORY"
    echo "$down_since $(date '+%F %H:%M') mise en production de la version $id (échec, retour arrière)" >> ../logs/interventions.txt
    exit 1
  fi
  restart_production
  if ! wait_healthy; then
    echo "ATTENTION : production sans réponse après la mise en service (docker compose logs odoo web)." >&2
    exit 1
  fi
  # Maintenance programmée si elle a été annoncée au client 48 heures à l'avance au moins (offre,
  # chapitre 5.2) : exclue du calcul de la disponibilité (availability-report.py). Sinon c'est une
  # intervention, qui compte dans ce calcul.
  window="$down_since $(date '+%F %H:%M') mise en production de la version $id"
  if [ -n "$announced" ] && (( $(date +%s) - announced >= 48 * 3600 )); then
    echo "$window" >> ../logs/maintenances.txt
  else
    echo "$window (non annoncée 48 heures à l'avance)" >> ../logs/interventions.txt
    echo "Mise en production non annoncée 48 heures à l'avance : l'interruption compte dans la disponibilité."
  fi
else
  # Pas encore de base de production : le noyau n'est pas démarré (il la créerait vide).
  activate "$id"
fi
echo "$(date '+%F %T') version $id ($version)${stamp:+ ; sauvegarde prise avant mise à jour : $stamp}" >> "$RELEASES/HISTORY"
echo "Version $id en service."

# 3. On garde les dernières versions (et toujours celle en service) pour pouvoir revenir en arrière.
find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -name '2*' -printf '%f\n' | sort -r | tail -n +$((KEEP + 1)) |
  while read -r old; do
    [ "$old" = "$(current)" ] && continue
    rm -rf "${RELEASES:?}/$old"
    docker rmi "eguitra/odoo:release-$old" "eguitra/web:release-$old" >/dev/null 2>&1 || true
  done
