#!/usr/bin/env bash
# Démarre ou met à jour la plateforme sur le serveur.
#   infra/up.sh   rend odoo.conf depuis .env, récupère OCA, construit l'image, démarre.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "infra/.env manquant : copier .env.example et le remplir." >&2; exit 1; }
set -a; . ./.env; set +a

./oca/fetch.sh
OCA_ADDONS_PATH="$(cat oca-src/addons_path)"
export OCA_ADDONS_PATH

# odoo.conf contient des secrets : lisible seulement par l'utilisateur odoo du conteneur
# (uid 100, gid 101 dans l'image officielle).
umask 077
TMP_CONF="$(mktemp)"
envsubst < odoo/odoo.conf.template > "$TMP_CONF"
sudo install -o 100 -g 101 -m 640 "$TMP_CONF" odoo/odoo.conf
rm -f "$TMP_CONF"

# Répertoire des sauvegardes : réservé à root ; les WAL sont écrits par PostgreSQL (uid 999).
BACKUP_DIR=${BACKUP_DIR:-/srv/eguitra/backup}
sudo install -d -m 700 -o root -g root "$BACKUP_DIR" "$BACKUP_DIR/base" "$BACKUP_DIR/filestore" "$BACKUP_DIR/status"
sudo install -d -m 700 -o 999 -g 999 "$BACKUP_DIR/wal"

docker compose build
docker compose up -d

# Le conteneur de sauvegarde se connecte en réplication (pg_basebackup) depuis le réseau Docker.
until docker compose exec -T db pg_isready -U "$POSTGRES_USER" -d postgres >/dev/null 2>&1; do sleep 2; done
docker compose exec -T db sh -c 'grep -q "^host replication all samenet" "$PGDATA/pg_hba.conf" || echo "host replication all samenet scram-sha-256" >> "$PGDATA/pg_hba.conf"'
docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -Atc "select pg_reload_conf()" >/dev/null
docker compose ps
