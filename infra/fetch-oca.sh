#!/usr/bin/env bash
# Clone les dépôts OCA listés dans oca-repos.txt (branche ODOO_VERSION) et expose les modules dans ./oca
set -euo pipefail
cd "$(dirname "$0")"
VERSION="${ODOO_VERSION:-$(grep -E '^ODOO_VERSION=' .env 2>/dev/null | cut -d= -f2 || echo 17.0)}"
mkdir -p oca-src oca
grep -vE '^\s*(#|$)' oca-repos.txt | while read -r repo modules; do
  if [ ! -d "oca-src/$repo" ]; then
    git clone --depth 1 -b "$VERSION" "https://github.com/OCA/$repo.git" "oca-src/$repo" || { echo "ATTENTION : $repo n'a pas de branche $VERSION" >&2; continue; }
  fi
  if [ -z "$modules" ]; then modules=$(ls "oca-src/$repo" | grep -v '^setup$'); fi
  for m in $modules; do
    [ -d "oca-src/$repo/$m" ] && ln -sfn "../oca-src/$repo/$m" "oca/$m" || echo "ATTENTION : module $m absent de $repo en $VERSION" >&2
  done
done
# Dépendances Python des modules OCA
find oca-src -name requirements.txt -maxdepth 2 -exec cat {} + | sort -u > oca-requirements.txt
echo "Modules exposés : $(ls oca | wc -l). Dépendances Python dans oca-requirements.txt (à installer dans l'image odoo si nécessaire)."
