#!/usr/bin/env bash
# Mise à jour de sécurité mensuelle des images (offre, chapitre 5.3 : chaque mois, en recette puis en
# production). Le système du serveur se met à jour seul chaque nuit, sans redémarrage (setup-vps.sh) ;
# la supervision rappelle un redémarrage en attente, et cette mise à jour au-delà de 35 jours.
#   infra/maj-securite.sh recette     images de base téléchargées à nouveau (Odoo 19 officiel, Node 22,
#                                     PostgreSQL 16, Caddy), images de la recette reconstruites et mises
#                                     en service, base de recette relancée sur la nouvelle image
#                                     PostgreSQL, audit des dépendances des applications web. Ensuite :
#                                     infra/test.sh --rebuild sur tous les modules (base modèle refaite sur le nouveau noyau) et contrôle de la recette.
#   infra/maj-securite.sh production --annoncee "AAAA-MM-JJ HH:MM"
#                                     proxy relancé sur sa nouvelle image, puis mise en production des
#                                     images validées en recette (infra/release.sh, base de production et
#                                     sauvegardes relancées sur la nouvelle image PostgreSQL). Annoncer
#                                     l'intervention au client 48 heures à l'avance.
# Compte rendu du mois : logs/maj-securite/AAAA-MM.md (à joindre au rapport mensuel).
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

LOG_DIR=../logs
mkdir -p "$LOG_DIR/maj-securite"
report="$LOG_DIR/maj-securite/$(date +%Y-%m).md"
BASES=(odoo:19.0 node:22-alpine postgres:16 caddy:2.10)

image_state() {
  docker image inspect -f '{{.Created}} {{index .RepoDigests 0}}' "$1" 2>/dev/null \
    | sed -E 's/^([0-9-]+)T.* .*@sha256:(.{12}).*/\1, empreinte \2/' || echo "absente"
}

wait_url() {
  for _ in $(seq 1 60); do
    curl -fsS --max-time 5 -o /dev/null "$1" 2>/dev/null && return 0
    sleep 5
  done
  return 1
}

[ -f "$report" ] || printf '# Mise à jour de sécurité des images, %s\n\n' "$(date +%m/%Y)" > "$report"

case "${1:-}" in
  recette)
    declare -A before
    for img in "${BASES[@]}"; do before[$img]=$(image_state "$img"); done
    for img in "${BASES[@]}"; do docker pull -q "$img" >/dev/null; done
    docker compose build --pull odoo-recette web-recette
    docker compose up -d --no-deps db-recette
    until docker compose exec -T db-recette pg_isready -U "$POSTGRES_USER" -d postgres >/dev/null 2>&1; do sleep 2; done
    docker compose up -d --no-deps --force-recreate odoo-recette web-recette
    health="recette en service"
    wait_url http://127.0.0.1:8169/api/v1/health && wait_url http://127.0.0.1:3100/login \
      || health="ÉCHEC : recette sans réponse après la mise à jour (docker compose logs odoo-recette web-recette)"
    # Dépendances des applications web : vulnérabilités connues des paquets livrés (hors outils de
    # développement). Une vulnérabilité élevée se corrige dans le code (package.json), puis repasse
    # par la recette.
    audit=$(docker run --rm -v "$PWD/../apps/web:/app:ro" -w /app node:22-alpine \
      npm audit --omit=dev --audit-level=high 2>&1 | tail -3 | tr '\n' ' ') || true
    {
      echo "## Recette, $(date '+%d/%m/%Y %H:%M')"
      echo
      echo "| Image de base | Avant | Après |"
      echo "|---|---|---|"
      for img in "${BASES[@]}"; do echo "| $img | ${before[$img]} | $(image_state "$img") |"; done
      echo
      echo "- Audit des dépendances web (npm audit, paquets livrés) : ${audit:-sans résultat}"
      echo "- État : $health"
      echo "- Suite : infra/test.sh --rebuild sur tous les modules, contrôle des écrans de la recette, puis"
      echo "  infra/maj-securite.sh production --annoncee \"AAAA-MM-JJ HH:MM\"."
      echo
    } >> "$report"
    tail -n 20 "$report"
    [[ "$health" == ÉCHEC* ]] && exit 1
    exit 0
    ;;
  production)
    [ "${2:-}" = "--annoncee" ] && [ -n "${3:-}" ] \
      || { echo "Préciser l'annonce : infra/maj-securite.sh production --annoncee \"AAAA-MM-JJ HH:MM\"" >&2; exit 2; }
    # Le proxy sert les deux environnements : il n'est recréé que si son image a changé (une à deux
    # secondes d'interruption).
    docker compose --profile proxy up -d --no-deps caddy
    ./release.sh --annoncee "$3"
    date +%s > "$LOG_DIR/maj-securite.ok"
    {
      echo "## Production, $(date '+%d/%m/%Y %H:%M')"
      echo
      echo "- Proxy à jour ($(image_state caddy:2.10)), version de production : $(readlink releases/current)."
      echo "- Intervention annoncée au client le $3."
      echo
    } >> "$report"
    tail -n 6 "$report"
    ;;
  *)
    echo "Usage : infra/maj-securite.sh recette | production --annoncee \"AAAA-MM-JJ HH:MM\"" >&2
    exit 2
    ;;
esac
