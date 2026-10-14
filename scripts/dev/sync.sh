#!/usr/bin/env bash
# Envoie le code (addons, apps, infra, scripts) sur le serveur de recette, sans les fichiers ignorés.
#   scripts/dev/sync.sh [hôte-ssh]   (par défaut : eguitra-vps)
set -euo pipefail
cd "$(dirname "$0")/../.."
HOST=${1:-eguitra-vps}
ARCHIVE=$(mktemp)
trap 'rm -f "$ARCHIVE"' EXIT
git ls-files -co --exclude-standard addons apps infra scripts | tar -cf "$ARCHIVE" -T -
scp -q "$ARCHIVE" "$HOST:/tmp/eguitra-sync.tar"
ssh "$HOST" 'mkdir -p ~/eguitra && tar -xf /tmp/eguitra-sync.tar -C ~/eguitra && rm -f /tmp/eguitra-sync.tar'
echo "Synchronisé vers $HOST:~/eguitra"
