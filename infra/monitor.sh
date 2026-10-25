#!/usr/bin/env bash
# Supervision du serveur, toutes les 5 minutes (crontab de l'utilisateur deploy, voir monitor-install.sh) :
# conteneurs des deux environnements en marche et en bonne santé, API des noyaux, applications web,
# espace disque, sauvegardes de la production, test de restauration mensuel et trimestriel à un
# instant donné, double authentification exigée en production. Chaque contrôle réussi appelle la
# sonde externe HEARTBEAT_URL (facultative), qui alerte si le serveur ne donne plus signe de vie.
# Une alerte part au changement d'état (panne, retour à la normale), à chaque nouveau problème, et
# toutes les 6 heures tant que la panne dure, vers ALERT_WEBHOOK_URL (JSON {"text": …} : Slack, Teams,
# Google Chat) et/ou ALERT_NTFY_URL (texte brut, application ntfy sur téléphone). Les écarts connus
# (double authentification suspendue, copie hors site absente) sont rappelés une fois par jour sans
# compter comme une panne. Journal : ~/eguitra/logs/monitor.log.
set -uo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

LOG_DIR=../logs
STATE=$LOG_DIR/monitor.state
mkdir -p "$LOG_DIR"
problems=()

for service in db odoo web backup db-recette odoo-recette web-recette; do
  status=$(docker compose ps --format '{{.State}} {{.Health}}' "$service" 2>/dev/null | head -1)
  case "$status" in
    "running healthy" | "running ") ;;
    "running starting") ;;
    "") problems+=("service $service arrêté") ;;
    *) problems+=("service $service : $status") ;;
  esac
done
curl -fsS --max-time 10 -o /dev/null http://127.0.0.1:8069/api/v1/health 2>/dev/null || problems+=("production : noyau sans réponse")
curl -fsS --max-time 10 -o /dev/null http://127.0.0.1:3000/login 2>/dev/null || problems+=("production : applications web sans réponse")
curl -fsS --max-time 10 -o /dev/null http://127.0.0.1:8169/api/v1/health 2>/dev/null || problems+=("recette : noyau sans réponse")
curl -fsS --max-time 10 -o /dev/null http://127.0.0.1:3100/login 2>/dev/null || problems+=("recette : applications web sans réponse")
disk=$(df --output=pcent / | tail -1 | tr -dc '0-9')
(( disk >= 85 )) && problems+=("disque plein à ${disk} %")
backup=$(docker compose exec -T backup check.sh 2>/dev/null) || problems+=("sauvegardes : ${backup:-contrôle impossible}")
# Test de restauration mensuel (crontab) : le dernier réussi doit dater de moins de 40 jours.
restored=$(cat "$LOG_DIR/restore-test.ok" 2>/dev/null || echo 0)
(( $(date +%s) - restored > 40 * 86400 )) && problems+=("test de restauration : aucun réussi depuis plus de 40 jours (logs/restore-test.log)")
# Restauration à un instant donné, trimestrielle (crontab), avec compte rendu remis au client.
pitr=$(cat "$LOG_DIR/restore-pitr.ok" 2>/dev/null || echo 0)
(( pitr > 0 && $(date +%s) - pitr > 100 * 86400 )) && problems+=("restauration à un instant donné : aucune réussie depuis plus de 100 jours (logs/restore-reports/)")
# Écarts connus et décidés (avertissements) : rappelés une fois par jour, sans faire passer le serveur
# en panne. Sinon un écart durable masquerait les vraies pannes (pas d'alerte au changement d'état,
# plus de signe de vie vers la sonde externe).
warnings=()
# Double authentification : exigée en production (offre, chapitre 5.3) ; suspendue à la demande du
# gérant pendant la prise en main des comptes, à rétablir avant la reprise des données réelles.
mfa=$(docker compose exec -T db psql -U "$POSTGRES_USER" -d "$ODOO_DB" -Atc   "select value from ir_config_parameter where key = 'eguitra_api.mfa_required'" 2>/dev/null | tr -d '[:space:]')
[ "$mfa" = "0" ] && warnings+=("production : double authentification désactivée (eguitra_api.mfa_required = 0)")
[ -z "${RCLONE_REMOTE:-}" ] && warnings+=("sauvegardes : copie hors site non configurée (RCLONE_REMOTE)")

now=$(date +%s)
read -r last_state last_alert last_signature last_warning < "$STATE" 2>/dev/null \
  || { last_state=ok; last_alert=0; last_signature=-; last_warning=0; }
last_signature=${last_signature:--}
last_warning=${last_warning:-0}
host=$(hostname)
if (( ${#problems[@]} )); then
  state=ko
  message="EGUITRA $host : $(IFS='; '; echo "${problems[*]}")"
  signature=$(printf '%s\n' "${problems[@]}" | md5sum | cut -c1-12)
else
  state=ok
  message="EGUITRA $host : retour à la normale"
  signature=-
fi
echo "$(date '+%F %T') $state ${problems[*]:-}${warnings[*]:+ | avertissements : ${warnings[*]}}" >> "$LOG_DIR/monitor.log"
if [ "$state" = ok ] && [ -n "${HEARTBEAT_URL:-}" ]; then
  curl -fsS --max-time 10 -o /dev/null "$HEARTBEAT_URL" 2>/dev/null || true
fi

send() {
  [ -n "${ALERT_WEBHOOK_URL:-}" ] && curl -fsS --max-time 15 -H 'Content-Type: application/json' \
    -d "{\"text\": \"$(echo "$1" | sed 's/"/\\"/g')\"}" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1
  [ -n "${ALERT_NTFY_URL:-}" ] && curl -fsS --max-time 15 -H "Title: Supervision EGUITRA" -d "$1" "$ALERT_NTFY_URL" >/dev/null 2>&1
  return 0
}

# Alerte au changement d'état, à l'apparition d'un nouveau problème pendant une panne, puis toutes
# les 6 heures tant que la panne dure.
if [ "$state" != "$last_state" ] || [ "$signature" != "$last_signature" ] \
  || { [ "$state" = ko ] && (( now - last_alert >= 21600 )); }; then
  if [ "$state" = ko ] || [ "$last_state" = ko ]; then
    send "$message"
    last_alert=$now
  fi
fi
if (( ${#warnings[@]} )) && (( now - last_warning >= 86400 )); then
  send "EGUITRA $host, rappel quotidien : $(IFS='; '; echo "${warnings[*]}")"
  last_warning=$now
fi
echo "$state $last_alert $signature $last_warning" > "$STATE"
