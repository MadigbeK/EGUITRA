#!/usr/bin/env bash
# Restauration : ./restore.sh <archive.tar.gpg> [base]   (restaure le dump et le filestore)
# Pour un instant précis entre deux sauvegardes, restaurer la sauvegarde de base puis rejouer
# les journaux du dossier wal/ avec recovery_target_time (procédure documentée dans README).
set -euo pipefail
cd "$(dirname "$0")/.." && set -a && . ./.env && set +a
ARCHIVE=$1; DB=${2:-eguitra}
WORK=$(mktemp -d)
gpg --batch --yes --passphrase "$BACKUP_PASSPHRASE" -d "$ARCHIVE" | tar -C "$WORK" -xf -
docker compose exec -T db dropdb -U "$POSTGRES_USER" --if-exists "$DB"
docker compose exec -T db createdb -U "$POSTGRES_USER" "$DB"
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$DB" < "$WORK/$DB.dump"
docker compose exec -T odoo tar -C /var/lib/odoo -xzf - < "$WORK/filestore.tgz"
rm -rf "$WORK"
echo "Base $DB restaurée depuis $ARCHIVE."
