#!/usr/bin/env bash
# Bascule sur les noms de domaine définitifs : contrôle des enregistrements DNS, inscription des noms
# dans infra/.env, recréation du proxy (certificats Let's Encrypt obtenus seuls), contrôle HTTPS.
#   infra/domaines.sh verifier nimova.gn                       noms attendus et leur adresse, rien ne change
#   infra/domaines.sh appliquer nimova.gn [nom-du-portail]     bascule (le portail : portail.<domaine> par défaut)
# Noms : finance, axispro, portail, recette et noyau sous le domaine. Le noyau ne répond qu'aux adresses
# ADMIN_IPS (403 ailleurs, y compris depuis le serveur lui-même : c'est le signe que le proxy le sert).
set -euo pipefail
cd "$(dirname "$0")"

ACTION=${1:-}
DOMAIN=${2:-}
[ -n "$ACTION" ] && [ -n "$DOMAIN" ] || {
  echo "Usage : infra/domaines.sh verifier|appliquer domaine [nom-du-portail]" >&2; exit 2; }
PORTAIL=${3:-portail.$DOMAIN}
declare -A NAMES=(
  [FINANCE_DOMAIN]="finance.$DOMAIN" [AXISPRO_DOMAIN]="axispro.$DOMAIN" [PORTAIL_DOMAIN]="$PORTAIL"
  [RECETTE_DOMAIN]="recette.$DOMAIN" [CORE_DOMAIN]="noyau.$DOMAIN"
)
ORDER=(FINANCE_DOMAIN AXISPRO_DOMAIN PORTAIL_DOMAIN RECETTE_DOMAIN CORE_DOMAIN)
SERVER_IP=$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')

resolve() { getent ahostsv4 "$1" | awk '{print $1; exit}'; }

verifier() {
  local missing=0
  echo "Adresse du serveur : $SERVER_IP"
  for key in "${ORDER[@]}"; do
    local name=${NAMES[$key]} ip
    ip=$(resolve "$name" || true)
    if [ "$ip" = "$SERVER_IP" ]; then
      printf "  OK        %-28s -> %s\n" "$name" "$ip"
    else
      printf "  A CRÉER   %-28s -> %s (attendu : enregistrement A vers %s)\n" "$name" "${ip:-aucune adresse}" "$SERVER_IP"
      missing=$((missing + 1))
    fi
  done
  return "$missing"
}

set_env() {
  local key=$1 value=$2
  if grep -q "^$key=" .env; then
    sed -i "s|^$key=.*|$key=$value|" .env
  else
    echo "$key=$value" >> .env
  fi
}

case "$ACTION" in
  verifier)
    if verifier; then echo "Tous les noms pointent vers le serveur : « appliquer » peut suivre."; fi
    ;;
  appliquer)
    if ! verifier; then
      echo "Des enregistrements manquent ou pointent ailleurs : rien n'est changé." >&2
      exit 1
    fi
    cp -p .env ".env.avant-domaines-$(date +%Y%m%d-%H%M)"
    for key in "${ORDER[@]}"; do set_env "$key" "${NAMES[$key]}"; done
    docker compose --profile proxy up -d --force-recreate caddy
    echo "Proxy recréé ; certificats en cours d'obtention (une à deux minutes)."
    for key in "${ORDER[@]}"; do
      name=${NAMES[$key]}
      code=000
      for _ in $(seq 1 24); do
        code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://$name/login" || true)
        [ "$code" != "000" ] && break
        sleep 5
      done
      expected="200, 307 ou 308"; [ "$key" = CORE_DOMAIN ] && expected="403 hors des adresses ADMIN_IPS"
      printf "  %-28s HTTPS %s (attendu : %s)\n" "$name" "$code" "$expected"
    done
    echo "Noms inscrits dans infra/.env (copie de l'ancien fichier : .env.avant-domaines-*)."
    ;;
  *)
    echo "Action inconnue : $ACTION (verifier ou appliquer)." >&2
    exit 2
    ;;
esac
