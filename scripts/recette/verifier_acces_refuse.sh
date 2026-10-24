#!/usr/bin/env bash
# Vérifie sur la recette la page d'accès refusé, avec les comptes de test (mot de passe commun) :
# un compte qui ouvre une application que son profil n'ouvre pas est renvoyé vers /acces-refuse,
# qui nomme l'application, propose une application ouverte au compte et ne montre rien du contenu.
# Lancement sur le serveur : MOT_DE_PASSE=... bash scripts/recette/verifier_acces_refuse.sh
set -u
B=${BASE:-http://127.0.0.1:3100}
: "${MOT_DE_PASSE:?Donner le mot de passe commun de la recette dans MOT_DE_PASSE}"
J=$(mktemp -d)
trap 'rm -rf "$J"' EXIT
echecs=0

verifier() { # compte application-de-connexion chemin-refusé texte-attendu lien-attendu
  local compte=$1 app=$2 chemin=$3 nom=$4 lien=$5
  curl -s -c "$J/$compte" -H "Content-Type: application/json" -H "Origin: $B" \
    --data-binary "{\"login\":\"$compte\",\"password\":\"$MOT_DE_PASSE\",\"app\":\"$app\"}" "$B/api/session/login" -o /dev/null
  local cible
  cible=$(curl -s -b "$J/$compte" -o /dev/null -w "%{redirect_url}" "$B$chemin")
  local page
  page=$(curl -s -L -b "$J/$compte" "$B$chemin")
  local ok=1
  [[ $cible == *"/acces-refuse?app="* ]] || ok=0
  grep -q "Accès non ouvert à votre profil" <<<"$page" || ok=0
  grep -qF "$nom" <<<"$page" || ok=0
  grep -qF "href=\"$lien\"" <<<"$page" || ok=0
  if [ $ok = 1 ]; then echo "OK      $compte sur $chemin : refusé, renvoi vers $lien"
  else echo "ÉCHEC   $compte sur $chemin : redirection « $cible »"; echecs=$((echecs + 1)); fi
}

verifier test.salarie rh /finance "NIMOVA · Finance" /rh
verifier test.porteur portail /axispro "NIMOVA · MB AxisPro Consulting" /portail
verifier test.chantiers finance /rh "NIMOVA · RH" /finance
verifier test.consultant axispro /transport "NIMOVA · Transport" /axispro

[ $echecs = 0 ] && echo "Accès refusé : tout est conforme." || { echo "$echecs échec(s)."; exit 1; }
