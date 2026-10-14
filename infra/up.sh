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

umask 077
envsubst < odoo/odoo.conf.template > odoo/odoo.conf
# L'utilisateur odoo du conteneur (uid 100 dans l'image officielle) doit pouvoir le lire.
chmod 644 odoo/odoo.conf

docker compose build
docker compose up -d
docker compose ps
