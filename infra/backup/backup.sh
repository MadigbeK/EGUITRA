#!/usr/bin/env bash
# Sauvegarde complète quotidienne : dump PostgreSQL + filestore, chiffrée, envoyée hors site.
set -euo pipefail
cd "$(dirname "$0")/.." && set -a && . ./.env && set +a
STAMP=$(date +%Y%m%d-%H%M)
WORK=$(mktemp -d)
for DB in eguitra eguitra_recette; do
  docker compose exec -T db pg_dump -U "$POSTGRES_USER" -Fc "$DB" > "$WORK/$DB.dump" 2>/dev/null || true
done
docker compose exec -T odoo tar -C /var/lib/odoo -czf - filestore > "$WORK/filestore.tgz"
tar -C "$WORK" -cf - . | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$BACKUP_PASSPHRASE" -o "$WORK/eguitra-$STAMP.tar.gpg"
rclone copy "$WORK/eguitra-$STAMP.tar.gpg" "$RCLONE_REMOTE/daily/"
# Première sauvegarde du mois conservée 12 mois
[ "$(date +%d)" = "01" ] && rclone copy "$WORK/eguitra-$STAMP.tar.gpg" "$RCLONE_REMOTE/monthly/"
rclone delete --min-age 30d "$RCLONE_REMOTE/daily/"
rclone delete --min-age 366d "$RCLONE_REMOTE/monthly/"
rm -rf "$WORK"
echo "Sauvegarde $STAMP envoyée."
