#!/usr/bin/env bash
# Test de restauration, à lancer sur le serveur depuis infra/ (au moins une fois par mois) :
# la dernière sauvegarde de base et les WAL archivés sont restaurés dans un PostgreSQL jetable,
# isolé de la production (archives en lecture seule, port local 5433), puis contrôlés.
#
#   backup/restore-test.sh                                  état le plus récent possible
#   backup/restore-test.sh --target "2026-10-14 10:00:00"   état à un instant donné (heure de Conakry, UTC)
#   backup/restore-test.sh --keep                           laisse l'instance restaurée en marche
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

BACKUP_DIR=${BACKUP_DIR:-/srv/eguitra/backup}
NAME=eguitra-restore-test
target=""
keep=0
while (( $# )); do
  case "$1" in
    --target) target="$2"; shift 2 ;;
    --keep) keep=1; shift ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
done

# Sauvegarde de base : la plus récente, ou la plus récente antérieure à la cible.
limit="99999999T9999"
[[ -n "$target" ]] && limit=$(date -d "$target" +%Y%m%dT%H%M)
base=$(sudo find "$BACKUP_DIR/base" -mindepth 1 -maxdepth 1 -type d -name '2*' ! -name '*.partial' | sort \
  | while read -r dir; do [[ "$(basename "$dir")" > "$limit" ]] || echo "$dir"; done | tail -1)
[[ -n "$base" ]] || { echo "Aucune sauvegarde de base utilisable." >&2; exit 1; }
echo "Sauvegarde de base : $(basename "$base")${target:+, cible $target}"

docker rm -f "$NAME" >/dev/null 2>&1 || true
work=$(sudo mktemp -d /srv/eguitra/restore-test.XXXXXX)
cleanup() {
  if (( keep == 0 )); then
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    sudo rm -rf "$work"
  fi
}
trap cleanup EXIT

sudo tar -xzf "$base/base.tar.gz" -C "$work"
sudo tar -xzf "$base/pg_wal.tar.gz" -C "$work/pg_wal"
{
  echo "restore_command = 'test -f /backup/wal/%f.gz && gunzip -c /backup/wal/%f.gz > %p'"
  echo "recovery_target_action = 'promote'"
  if [[ -n "$target" ]]; then echo "recovery_target_time = '$target+00'"; fi
} | sudo tee -a "$work/postgresql.auto.conf" >/dev/null
sudo touch "$work/recovery.signal"
sudo chown -R 999:999 "$work"
sudo chmod 700 "$work"

docker run -d --name "$NAME" -p 127.0.0.1:5433:5432 \
  -v "$work:/var/lib/postgresql/data" -v "$BACKUP_DIR/wal:/backup/wal:ro" postgres:16 >/dev/null
echo "Rejeu des WAL en cours…"
state=""
for _ in $(seq 1 360); do
  [[ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" == "true" ]] || break
  state=$(docker exec "$NAME" psql -U "$POSTGRES_USER" -d postgres -Atc "select pg_is_in_recovery()" 2>/dev/null || true)
  [[ "$state" == "f" ]] && break
  sleep 5
done
if [[ "$state" != "f" ]]; then
  echo "ÉCHEC : la restauration n'a pas abouti. Journal :" >&2
  docker logs --tail 25 "$NAME" 2>&1 | cut -c1-240 >&2
  if docker logs "$NAME" 2>&1 | grep -q "recovery ended before configured recovery target was reached"; then
    echo "La cible est postérieure aux derniers journaux archivés (archivage au moins toutes les 15 minutes) :" \
      "choisissez un instant plus ancien ou attendez le prochain archivage." >&2
  fi
  exit 1
fi

sql() { docker exec "$NAME" psql -U "$POSTGRES_USER" -d "$ODOO_DB" -Atc "$1"; }
echo "Base $ODOO_DB restaurée. Contrôles :"
echo "  sociétés            : $(sql 'select count(*) from res_company')"
echo "  utilisateurs actifs : $(sql 'select count(*) from res_users where active')"
echo "  pièces comptables   : $(sql 'select count(*) from account_move')"
echo "  dernière écriture   : $(sql "select coalesce(max(write_date)::text, '-') from account_move")"
echo "  dernier accès API   : $(sql "select coalesce(max(date)::text, '-') from eguitra_api_access_log")"
echo "RÉUSSITE : restauration contrôlée."
if (( keep )); then
  echo "Instance laissée en marche sur 127.0.0.1:5433 (conteneur $NAME, données dans $work)."
  echo "Pour l'arrêter : docker rm -f $NAME && sudo rm -rf $work"
fi
