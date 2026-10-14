#!/usr/bin/env bash
# Démarre ou met à jour la plateforme sur le serveur (production et recette).
#   infra/up.sh   rend les configurations des deux noyaux depuis .env, récupère OCA, construit les
#                 images de la recette, crée le rôle applicatif de la production, prépare la première
#                 version de production si aucune n'existe, démarre tout.
# Le code de production ne change qu'avec infra/release.sh : up.sh ne touche pas à la version en service.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "infra/.env manquant : copier .env.example et le remplir." >&2; exit 1; }
set -a; . ./.env; set +a
for var in POSTGRES_USER POSTGRES_PASSWORD ODOO_ADMIN_PASSWD ODOO_DB ODOO_DB_USER ODOO_DB_PASSWORD \
           RECETTE_DB RECETTE_POSTGRES_PASSWORD RECETTE_ODOO_ADMIN_PASSWD; do
  [ -n "${!var:-}" ] || { echo "Variable $var absente de infra/.env (voir .env.example)." >&2; exit 1; }
done

./oca/fetch.sh
OCA_ADDONS_PATH="$(cat oca-src/addons_path)"
export OCA_ADDONS_PATH

# Configurations des noyaux : elles contiennent des secrets, lisibles seulement par l'utilisateur
# odoo des conteneurs (uid 100, gid 101 dans l'image officielle).
render() (
  umask 077  # sous-shell : ce masque ne vaut que pour le fichier temporaire
  target=$1
  tmp="$(mktemp)"
  envsubst '${OD_DB_HOST} ${OD_DB_USER} ${OD_DB_PASSWORD} ${OD_ADMIN_PASSWD} ${OD_DB} ${OD_WORKERS} ${OCA_ADDONS_PATH}' \
    < odoo/odoo.conf.template > "$tmp"
  sudo install -o 100 -g 101 -m 640 "$tmp" "odoo/$target"
  rm -f "$tmp"
)
OD_DB_HOST=db OD_DB_USER=$ODOO_DB_USER OD_DB_PASSWORD=$ODOO_DB_PASSWORD OD_ADMIN_PASSWD=$ODOO_ADMIN_PASSWD \
  OD_DB=$ODOO_DB OD_WORKERS=4 render production.conf
OD_DB_HOST=db-recette OD_DB_USER=$POSTGRES_USER OD_DB_PASSWORD=$RECETTE_POSTGRES_PASSWORD \
  OD_ADMIN_PASSWD=$RECETTE_ODOO_ADMIN_PASSWD OD_DB=$RECETTE_DB OD_WORKERS=2 render recette.conf
export -n OD_DB_HOST OD_DB_USER OD_DB_PASSWORD OD_ADMIN_PASSWD OD_DB OD_WORKERS 2>/dev/null || true

# Répertoire des sauvegardes : réservé à root ; les WAL sont écrits par PostgreSQL (uid 999).
BACKUP_DIR=${BACKUP_DIR:-/srv/eguitra/backup}
sudo install -d -m 700 -o root -g root "$BACKUP_DIR" "$BACKUP_DIR/base" "$BACKUP_DIR/filestore" "$BACKUP_DIR/status"
sudo install -d -m 700 -o 999 -g 999 "$BACKUP_DIR/wal"

# Images de la recette et des sauvegardes (la production n'a pas d'image construite ici).
docker compose build

docker compose up -d db db-recette
until docker compose exec -T db pg_isready -U "$POSTGRES_USER" -d postgres >/dev/null 2>&1; do sleep 2; done

# Base de production : connexion de sauvegarde en réplication depuis le réseau Docker, et rôle
# applicatif du noyau sans privilège de superutilisateur (il crée et possède sa base).
docker compose exec -T db sh -c 'grep -q "^host replication all samenet" "$PGDATA/pg_hba.conf" || echo "host replication all samenet scram-sha-256" >> "$PGDATA/pg_hba.conf"'
docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -v role="$ODOO_DB_USER" -v pass="$ODOO_DB_PASSWORD" >/dev/null <<'SQL'
SELECT format('CREATE ROLE %I LOGIN CREATEDB NOSUPERUSER NOCREATEROLE NOREPLICATION', :'role')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN CREATEDB NOSUPERUSER PASSWORD %L', :'role', :'pass') \gexec
SELECT pg_reload_conf();
SQL

# Première version de production (code actuel de la recette) si aucune n'existe encore.
[ -e releases/current ] || ./release.sh --initial

# Un noyau démarré sans sa base la créerait d'office, vide : on attend alors init-db.sh.
until docker compose exec -T db-recette pg_isready -U "$POSTGRES_USER" -d postgres >/dev/null 2>&1; do sleep 2; done
db_exists() {
  docker compose exec -T "$1" psql -U "$POSTGRES_USER" -d postgres -Atc \
    "SELECT 1 FROM pg_database WHERE datname = '$2'" | grep -q 1
}
services=(db db-recette backup)
if db_exists db "$ODOO_DB"; then
  services+=(odoo web)
else
  echo "Production : base $ODOO_DB absente, noyau non démarré ; la créer avec infra/init-db.sh production."
fi
if db_exists db-recette "$RECETTE_DB"; then
  services+=(odoo-recette web-recette)
else
  echo "Recette : base $RECETTE_DB absente, noyau non démarré ; la créer avec infra/init-db.sh recette."
fi
docker compose up -d --remove-orphans "${services[@]}"
docker compose ps
