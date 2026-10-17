#!/usr/bin/env bash
# Lance les tests de modules sur une base jetable, copiée d'une base modèle, dans l'environnement de
# recette (noyau odoo-recette, grappe db-recette) : la production n'est jamais sollicitée.
#   infra/test.sh eguitra_base eguitra_api ...
# La base modèle (noyau, localisation Guinée, modules OCA) est créée au premier appel ;
# infra/test.sh --rebuild la reconstruit après une mise à jour du noyau ou des modules OCA.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

BASE=eguitra_ci_base
CI=eguitra_ci
ODOO=(docker compose run --rm -T odoo-recette odoo)
CONF=(-c /etc/odoo/odoo.conf)

if [ "${1:-}" = "--rebuild" ]; then
  shift
  "${ODOO[@]}" db "${CONF[@]}" drop "$BASE" 2>/dev/null || true
fi
[ $# -gt 0 ] || { echo "Usage : infra/test.sh [--rebuild] module..." >&2; exit 2; }

db_exists() {
  docker compose exec -T db-recette psql -U "$POSTGRES_USER" -d postgres -Atc \
    "SELECT 1 FROM pg_database WHERE datname = '$1'" | grep -q 1
}

if ! db_exists "$BASE"; then
  "${ODOO[@]}" db "${CONF[@]}" init "$BASE" --language fr_FR --country gn
  # shellcheck disable=SC2046
  "${ODOO[@]}" module install "${CONF[@]}" -d "$BASE" l10n_gn $(grep -v '^#' oca/modules.txt)
fi

"${ODOO[@]}" db "${CONF[@]}" duplicate --force "$BASE" "$CI"

# Arguments : modules, ou module:Classe pour ne lancer qu'une classe de tests (module installé quand même).
MODS=$(printf '%s\n' "$@" | cut -d: -f1 | sort -u | paste -sd, -)
TAGS=$(printf '/%s,' "$@")
LOG=$(mktemp)
# Installation, puis tests dans un second processus : le module d'audit remplace create et write des
# modèles suivis au moment où leurs règles sont posées ; installés et testés dans le même processus,
# les surcharges des modules chargés ensuite seraient court-circuitées. En production, le noyau est
# redémarré après chaque installation (infra/README.md) ; les tests reproduisent cet état.
"${ODOO[@]}" "${CONF[@]}" -d "$CI" --db-filter "^$CI\$" -i "$MODS" --stop-after-init --workers 0 \
  --log-level=info > "$LOG" 2>&1 || true
"${ODOO[@]}" "${CONF[@]}" -d "$CI" --db-filter "^$CI\$" -u "$MODS" --test-enable --test-tags "${TAGS%,}" \
  --stop-after-init --workers 0 --log-level=test 2>&1 | tee -a "$LOG" | grep -E " (ERROR|CRITICAL) |FAIL|Ran |tests? in " || true

if grep -qE " (ERROR|CRITICAL) " "$LOG"; then
  echo "ÉCHEC : voir les erreurs ci-dessus (journal complet : $LOG)"
  exit 1
fi
echo "SUCCÈS : $(grep -cE 'Starting .*\.test_' "$LOG") tests exécutés sans erreur"
rm -f "$LOG"
