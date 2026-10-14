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

docker compose build
docker compose up -d
docker compose ps
