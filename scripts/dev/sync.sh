#!/usr/bin/env bash
# Envoie le code (addons, apps, infra, scripts) sur le serveur, sans les fichiers ignorés. Il devient
# le code de la recette ; la production ne change qu'avec infra/release.sh.
#   scripts/dev/sync.sh [hôte-ssh]   (par défaut : eguitra-vps)
set -euo pipefail
cd "$(dirname "$0")/../.."
HOST=${1:-eguitra-vps}
ARCHIVE=$(mktemp)
trap 'rm -f "$ARCHIVE"' EXIT
git ls-files -co --exclude-standard addons apps infra scripts | tar -cf "$ARCHIVE" -T -
scp -q "$ARCHIVE" "$HOST:/tmp/eguitra-sync.tar"
ssh "$HOST" 'mkdir -p ~/eguitra && tar -xf /tmp/eguitra-sync.tar -C ~/eguitra && rm -f /tmp/eguitra-sync.tar'
# Version du code envoyé, reprise dans l'historique des mises en production.
VERSION="$(git rev-parse --short=10 HEAD)$(git diff --quiet HEAD -- addons apps infra scripts || echo ' + modifications non commitées') ($(date '+%F %H:%M'))"
echo "$VERSION" | ssh "$HOST" 'cat > ~/eguitra/VERSION'
echo "Synchronisé vers $HOST:~/eguitra"
