#!/usr/bin/env bash
# Essai complet de la reprise sur une base jetable de la recette (jamais la production) : base neuve
# (copie de la base modèle des tests, modules EGUITRA installés), reprise enregistrée, dotations jusqu'à
# la date d'arrêté et contrôle « n/26 » des valeurs de référence.
#   scripts/reprise/essai.sh dossier-des-fichiers [base]
# Le dossier contient les fichiers de reprise et reference.json (scripts/reprise/README.md). Base jetable
# par défaut : eguitra_reprise_essai (remplacée à chaque essai). Variables transmises à reprise.sh :
# REPRISE_DATE_OUVERTURE (défaut AAAA-01-01 de l'année en cours), REPRISE_BUDGET_ANNEE, REPRISE_SOCIETE,
# REPRISE_CONVENTION_AMORTISSEMENT (README, « Convention d'amortissement des biens repris »).
set -euo pipefail
[ $# -ge 1 ] || { echo "Usage : scripts/reprise/essai.sh dossier-des-fichiers [base]" >&2; exit 2; }
DIR=$(cd "$1" && pwd)
DB=${2:-eguitra_reprise_essai}
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE/../../infra"
set -a; . ./.env; set +a
[ "$DB" != "${ODOO_DB:-eguitra}" ] && [ "$DB" != "${RECETTE_DB:-eguitra_recette}" ] || {
  echo "Base « $DB » refusée : l'essai remplace sa base, il ne vise ni la production ni la recette." >&2; exit 1; }
[ -f "$DIR/reference.json" ] || { echo "reference.json absent de $DIR." >&2; exit 1; }
MODULES=(eguitra_base eguitra_api eguitra_finance eguitra_approval eguitra_transport eguitra_chantier
         eguitra_immobilier eguitra_axispro eguitra_analytics eguitra_portail eguitra_rh eguitra_chat)
ODOO=(docker compose run --rm -T odoo-recette odoo)

echo "Essai de reprise sur la base jetable $DB (recette), fichiers de $DIR."
docker compose exec -T db-recette psql -U "$POSTGRES_USER" -d postgres -Atc \
  "SELECT 1 FROM pg_database WHERE datname = 'eguitra_ci_base'" | grep -q 1 || {
  echo "Base modèle eguitra_ci_base absente : lancer d'abord infra/test.sh (elle y est créée)." >&2; exit 1; }
"${ODOO[@]}" db -c /etc/odoo/odoo.conf duplicate --force eguitra_ci_base "$DB"
"${ODOO[@]}" module install -c /etc/odoo/odoo.conf -d "$DB" "${MODULES[@]}"
REPRISE_DATE_OUVERTURE=${REPRISE_DATE_OUVERTURE:-$(date +%Y)-01-01} INIT_DB=$DB \
  "$HERE/reprise.sh" recette "$DIR" --appliquer
docker compose run --rm -T -v "$DIR:/reprise:ro" -e REPRISE_SOCIETE="${REPRISE_SOCIETE:-groupe}" odoo-recette \
  odoo shell -c /etc/odoo/odoo.conf -d "$DB" --no-http --log-level=warn < "$HERE/validation.py"
echo "Essai terminé (base $DB conservée pour examen ; elle est remplacée au prochain essai)."
