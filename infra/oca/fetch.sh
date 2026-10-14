#!/usr/bin/env bash
# Récupère les dépôts OCA (branche 19.0) aux commits épinglés dans lock.txt.
#   oca/fetch.sh            clone ou remet chaque dépôt au commit épinglé
#   oca/fetch.sh --update   avance chaque dépôt à la tête de 19.0 et réécrit lock.txt
# Produit aussi oca-src/addons_path (pour odoo.conf) et oca-src/requirements.txt (pour l'image).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../oca-src"
BRANCH=19.0
LOCK="$HERE/lock.txt"
UPDATE=${1:-}

mkdir -p "$SRC"
touch "$LOCK"
declare -A PIN
while read -r repo sha; do [ -n "${repo:-}" ] && PIN[$repo]=$sha; done < <(grep -v '^#' "$LOCK" || true)

NEWLOCK=""
ADDONS=""
: > "$SRC/requirements.txt"
for repo in $(grep -v '^#' "$HERE/repos.txt"); do
  dir="$SRC/$repo"
  if [ ! -d "$dir/.git" ]; then
    git clone -q --branch "$BRANCH" "https://github.com/OCA/$repo.git" "$dir"
  fi
  git -C "$dir" fetch -q origin "$BRANCH"
  if [ "$UPDATE" = "--update" ] || [ -z "${PIN[$repo]:-}" ]; then
    git -C "$dir" checkout -q --detach "origin/$BRANCH"
  else
    git -C "$dir" checkout -q --detach "${PIN[$repo]}"
  fi
  sha="$(git -C "$dir" rev-parse HEAD)"
  echo "$repo ${sha:0:12}"
  NEWLOCK+="$repo $sha"$'\n'
  ADDONS+="/mnt/oca/$repo,"
  [ -f "$dir/requirements.txt" ] && grep -v '^\s*#' "$dir/requirements.txt" >> "$SRC/requirements.txt" || true
done

printf '# Commits OCA épinglés (branche %s). Généré par oca/fetch.sh.\n%s' "$BRANCH" "$NEWLOCK" > "$LOCK"
echo "${ADDONS%,}" > "$SRC/addons_path"
sort -u -o "$SRC/requirements.txt" "$SRC/requirements.txt"
sed -i '/^\s*$/d' "$SRC/requirements.txt"
