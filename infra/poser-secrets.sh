#!/usr/bin/env bash
# Pose sur le serveur ce que le gérant obtient lui-même chez un fournisseur. Les secrets se collent ici,
# masqués : ils ne passent ni par la ligne de commande, ni par l'historique, ni par une session de travail.
# À lancer par le gérant, dans son terminal : ssh -t eguitra-vps "cd ~/eguitra && bash infra/poser-secrets.sh <action>"
#   alerte                        crée un sujet ntfy privé, l'inscrit (ALERT_NTFY_URL) et envoie un essai
#   sonde                         adresse de la sonde externe (HEARTBEAT_URL, healthchecks.io)
#   courriel adresse [serveur]    boîte d'envoi (SMTP_*), puis paramétrage de la production et de la recette
#   ia                            clés Anthropic (après signature de l'accord), puis recréation des noyaux
#   hors-site                     copie hors site chiffrée vers Backblaze B2 (infra/backup.env), premier envoi
set -euo pipefail
cd "$(dirname "$0")"

# Écrit VAR='valeur' dans un fichier (droits 600), à la place d'une ligne existante. Les apostrophes
# rompraient la lecture du fichier, par le shell comme par Docker Compose : elles sont refusées.
poser() {
  local var=$1 valeur=$2 fichier=$3 tmp
  case "$valeur" in
    *"'"* | *$'\n'*) echo "Valeur de $var refusée : apostrophe ou retour à la ligne." >&2; return 1 ;;
  esac
  tmp=$(mktemp "$fichier.XXXXXX")
  grep -v "^$var=" "$fichier" > "$tmp" 2>/dev/null || true
  printf "%s='%s'\n" "$var" "$valeur" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$fichier"
}

# Lit une valeur sans l'afficher, dans la variable nommée. Vide : abandon, sauf si elle est facultative.
demander() {
  local invite=$1 sortie=$2 facultatif=${3:-} valeur
  read -rsp "$invite : " valeur
  echo
  if [ -z "$valeur" ] && [ -z "$facultatif" ]; then
    echo "Rien de saisi : rien n'est changé." >&2
    exit 1
  fi
  printf -v "$sortie" '%s' "$valeur"
}

alerte() {
  local url
  url="https://ntfy.sh/nimova-alertes-$(openssl rand -hex 12)"
  poser ALERT_NTFY_URL "$url" .env
  curl -fsS --max-time 15 -H "Title: Supervision EGUITRA" \
    -d "Essai du canal d'alerte : les pannes du serveur vous parviendront ici." "$url" > /dev/null
  echo "Essai envoyé. Dans l'application ntfy du téléphone, abonnez-vous à ce sujet :"
  echo "  ${url##*/}"
  echo "Le nom du sujet tient lieu de mot de passe : ne le publiez pas."
}

sonde() {
  local url
  demander "Adresse de la sonde (https://hc-ping.com/…)" url
  poser HEARTBEAT_URL "$url" .env
  curl -fsS --max-time 15 -o /dev/null "$url"
  echo "Sonde inscrite, premier signal envoyé. Elle sera appelée à chaque contrôle réussi (5 minutes)."
}

courriel() {
  local adresse=${1:-} serveur=${2:-smtp.mail.ovh.net} mot_de_passe
  [ -n "$adresse" ] || { echo "Usage : infra/poser-secrets.sh courriel adresse@domaine [serveur]" >&2; exit 2; }
  demander "Mot de passe de la boîte $adresse" mot_de_passe
  poser SMTP_HOST "$serveur" .env
  poser SMTP_PORT 465 .env
  poser SMTP_ENCRYPTION ssl .env
  poser SMTP_USER "$adresse" .env
  poser SMTP_PASSWORD "$mot_de_passe" .env
  poser SMTP_FROM "$adresse" .env
  bash mail-server.sh production
  bash mail-server.sh recette
}

ia() {
  local cle
  echo "Rappel : l'avenant à l'accord de confidentialité doit être signé avant de poser ces clés."
  demander "Clé Anthropic de la production (vide : ne pas la poser)" cle facultatif
  if [ -n "$cle" ]; then
    poser ANTHROPIC_API_KEY "$cle" .env
    docker compose up -d odoo
  fi
  demander "Clé Anthropic de la recette (vide : ne pas la poser)" cle facultatif
  if [ -n "$cle" ]; then
    poser RECETTE_ANTHROPIC_API_KEY "$cle" .env
    docker compose up -d odoo-recette
  fi
  echo "Noyaux recréés. Lecture active là où une clé est posée."
}

obscurcir() {
  printf '%s' "$1" | docker compose exec -T backup rclone obscure -
}

hors_site() {
  local identifiant cle bucket mot_de_passe sel coffre
  # Remplacer les mots de passe du chiffrement rendrait illisibles les copies déjà envoyées.
  if [ -f backup.env ]; then
    echo "infra/backup.env existe déjà : rien n'est changé." >&2
    exit 1
  fi
  demander "Identifiant de la clé Backblaze (keyID)" identifiant
  demander "Clé applicative Backblaze (applicationKey)" cle
  read -rp "Nom du bucket : " bucket
  case "$bucket" in
    "" | *[!a-zA-Z0-9-]*) echo "Nom de bucket invalide : rien n'est changé." >&2; exit 1 ;;
  esac
  mot_de_passe=$(openssl rand -base64 32 | tr -d '\n')
  sel=$(openssl rand -base64 32 | tr -d '\n')
  install -d -m 700 secrets
  coffre="secrets/hors-site-$(date +%Y%m%d-%H%M).txt"
  (umask 077; printf 'Mot de passe du chiffrement : %s\nSel du chiffrement : %s\nBucket : %s\n' "$mot_de_passe" "$sel" "$bucket" > "$coffre")
  install -m 600 backup.env.example backup.env
  poser RCLONE_CONFIG_OFFSITE_ACCOUNT "$identifiant" backup.env
  poser RCLONE_CONFIG_OFFSITE_KEY "$cle" backup.env
  poser RCLONE_CONFIG_SECURE_REMOTE "offsite:$bucket/eguitra" backup.env
  poser RCLONE_CONFIG_SECURE_PASSWORD "$(obscurcir "$mot_de_passe")" backup.env
  poser RCLONE_CONFIG_SECURE_PASSWORD2 "$(obscurcir "$sel")" backup.env
  docker compose up -d backup
  docker compose exec -T backup offsite.sh wal
  docker compose exec -T backup rclone size secure:
  echo "Copie hors site en service."
  echo "À FAIRE MAINTENANT : recopiez dans votre coffre le contenu de infra/$coffre."
  echo "Sans ces deux mots de passe, les copies sont illisibles si le serveur est perdu."
}

case "${1:-}" in
  alerte) alerte ;;
  sonde) sonde ;;
  courriel) courriel "${2:-}" "${3:-}" ;;
  ia) ia ;;
  hors-site) hors_site ;;
  *) echo "Usage : infra/poser-secrets.sh alerte|sonde|courriel|ia|hors-site" >&2; exit 2 ;;
esac
