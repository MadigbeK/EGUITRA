#!/usr/bin/env bash
# Lance les tests de modules sur une base jetable, copiée d'une base modèle.
#   infra/test.sh eguitra_base eguitra_api ...
# La base modèle (noyau, localisation Guinée, modules OCA) est créée au premier appel ;
# infra/test.sh --rebuild la reconstruit après une mise à jour du noyau ou des modules OCA.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

BASE=eguitra_ci_base
CI=eguitra_ci
ODOO=(docker compose run --rm -T odoo odoo)
CONF=(-c /etc/odoo/odoo.conf)

if [ "${1:-}" = "--rebuild" ]; then
  shift
  "${ODOO[@]}" db "${CONF[@]}" drop "$BASE" 2>/dev/null || true
fi
[ $# -gt 0 ] || { echo "Usage : infra/test.sh [--rebuild] module..." >&2; exit 2; }

db_exists() {
  docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -Atc \
    "SELECT 1 FROM pg_database WHERE datname = '$1'" | grep -q 1
}

if ! db_exists "$BASE"; then
  "${ODOO[@]}" db "${CONF[@]}" init "$BASE" --language fr_FR --country gn
  # shellcheck disable=SC2046
  "${ODOO[@]}" module install "${CONF[@]}" -d "$BASE" l10n_gn $(grep -v '^#' oca/modules.txt)
fi

"${ODOO[@]}" db "${CONF[@]}" duplicate --force "$BASE" "$CI"

MODS=$(IFS=,; echo "$*")
TAGS=$(printf '/%s,' "$@")
LOG=$(mktemp)
"${ODOO[@]}" "${CONF[@]}" -d "$CI" -i "$MODS" --test-enable --test-tags "${TAGS%,}" \
  --stop-after-init --workers 0 --log-level=test 2>&1 | tee "$LOG" | grep -E " (ERROR|CRITICAL) |FAIL|Ran |tests? in " || true

if grep -qE " (ERROR|CRITICAL) " "$LOG"; then
  echo "ÉCHEC : voir les erreurs ci-dessus (journal complet : $LOG)"
  exit 1
fi
echo "SUCCÈS : $(grep -cE 'Starting .*\.test_' "$LOG") tests exécutés sans erreur"
rm -f "$LOG"
