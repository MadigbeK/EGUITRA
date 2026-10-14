#!/usr/bin/env bash
# Supervision du serveur, toutes les 5 minutes (crontab de l'utilisateur deploy, voir monitor-install.sh) :
# conteneurs en marche et en bonne santé, API du noyau, applications web, espace disque, sauvegardes.
# Une alerte part au changement d'état (panne, retour à la normale), et toutes les 6 heures tant
# que la panne dure, vers ALERT_WEBHOOK_URL (JSON {"text": …} : Slack, Teams, Google Chat) et/ou
# ALERT_NTFY_URL (texte brut, application ntfy sur téléphone). Journal : ~/eguitra/logs/monitor.log.
set -uo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

LOG_DIR=../logs
STATE=$LOG_DIR/monitor.state
mkdir -p "$LOG_DIR"
problems=()

for service in db odoo web backup; do
  status=$(docker compose ps --format '{{.State}} {{.Health}}' "$service" 2>/dev/null | head -1)
  case "$status" in
    "running healthy" | "running ") ;;
    "running starting") ;;
    "") problems+=("service $service arrêté") ;;
    *) problems+=("service $service : $status") ;;
  esac
done
curl -fsS --max-time 10 http://127.0.0.1:8069/api/v1/health >/dev/null 2>&1 || problems+=("API du noyau sans réponse")
curl -fsS --max-time 10 -o /dev/null http://127.0.0.1:3000/login 2>/dev/null || problems+=("applications web sans réponse")
disk=$(df --output=pcent / | tail -1 | tr -dc '0-9')
(( disk >= 85 )) && problems+=("disque plein à ${disk} %")
backup=$(docker compose exec -T backup check.sh 2>/dev/null) || problems+=("sauvegardes : ${backup:-contrôle impossible}")

now=$(date +%s)
read -r last_state last_alert < "$STATE" 2>/dev/null || { last_state=ok; last_alert=0; }
host=$(hostname)
if (( ${#problems[@]} )); then
  state=ko
  message="EGUITRA $host : $(IFS='; '; echo "${problems[*]}")"
else
  state=ok
  message="EGUITRA $host : retour à la normale"
fi
echo "$(date '+%F %T') $state ${problems[*]:-}" >> "$LOG_DIR/monitor.log"

send() {
  [ -n "${ALERT_WEBHOOK_URL:-}" ] && curl -fsS --max-time 15 -H 'Content-Type: application/json' \
    -d "{\"text\": \"$(echo "$1" | sed 's/"/\\"/g')\"}" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1
  [ -n "${ALERT_NTFY_URL:-}" ] && curl -fsS --max-time 15 -H "Title: Supervision EGUITRA" -d "$1" "$ALERT_NTFY_URL" >/dev/null 2>&1
  return 0
}

if [ "$state" != "$last_state" ] || { [ "$state" = ko ] && (( now - last_alert >= 21600 )); }; then
  if [ "$state" = ko ] || [ "$last_state" = ko ]; then
    send "$message"
    last_alert=$now
  fi
fi
echo "$state $last_alert" > "$STATE"
