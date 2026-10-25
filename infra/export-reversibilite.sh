#!/usr/bin/env bash
# Export de réversibilité (offre, chapitre 5.4) : tout ce qu'il faut pour reprendre la plateforme
# ailleurs, en formats ouverts, sans frais, sans arrêter la production.
#   infra/export-reversibilite.sh [répertoire]        (par défaut : ~/eguitra/exports)
# Un dossier daté contient :
#   base.sql.gz             base de production, export SQL complet en texte (pg_dump), sans propriétaires
#   pieces-jointes.tar.gz   pièces jointes de la base (filestore du noyau)
#   code.tar.gz             code de la version en service : modules EGUITRA et OCA, applications web
#   deploiement.tar.gz      configuration de déploiement et scripts, sans aucun secret
#   NOTICE.md               contenu, versions, procédure de réinstallation, empreintes SHA-256
# L'export contient les données de l'entreprise : le remettre au client par un moyen sûr, puis
# l'effacer du serveur.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
umask 077

out="${1:-../exports}/reversibilite-$(date +%Y%m%d-%H%M)"
mkdir -p "$out"
release=$(readlink releases/current)
version=$(cat "releases/$release/VERSION" 2>/dev/null || echo "inconnue")
sql() { docker compose exec -T db psql -U "$POSTGRES_USER" -d "$ODOO_DB" -Atc "$1"; }

echo "Base $ODOO_DB : export SQL."
docker compose exec -T db pg_dump -U "$POSTGRES_USER" --no-owner --no-privileges --encoding=UTF8 "$ODOO_DB" \
  | gzip > "$out/base.sql.gz"

echo "Pièces jointes."
if docker compose exec -T odoo test -d "/var/lib/odoo/filestore/$ODOO_DB"; then
  docker compose exec -T odoo tar -czf - -C /var/lib/odoo/filestore "$ODOO_DB" > "$out/pieces-jointes.tar.gz"
else
  echo "Aucune pièce jointe enregistrée." > "$out/pieces-jointes-absentes.txt"
fi

echo "Code de la version $release."
web_note="dans code.tar.gz (dossier web/)"
tar -czf "$out/code.tar.gz" --exclude=__pycache__ -C "releases/$release" .
if [ ! -d "releases/$release/web" ]; then
  # Versions antérieures au 25/10/2026 : le code des applications web n'était pas figé avec la version.
  tar -czf "$out/code-web-recette.tar.gz" --exclude=node_modules --exclude=.next -C .. apps/web
  web_note="dans code-web-recette.tar.gz : code de la recette au moment de l'export (la version en service ne l'a pas figé)"
fi

echo "Configuration de déploiement."
tar -czf "$out/deploiement.tar.gz" -C .. \
  --exclude=.env --exclude='.env.bak*' --exclude=backup.env --exclude=secrets --exclude=releases \
  --exclude=oca-src --exclude=production.conf --exclude=recette.conf --exclude=__pycache__ \
  infra scripts

modules=$(sql "select name || ' ' || coalesce(latest_version, '') from ir_module_module
               where state = 'installed' and name like 'eguitra%' order by name" | sed 's/^/- /')
{
  echo "# Export de réversibilité de la plateforme EGUITRA"
  echo
  echo "Offre OTF-EGUITRA-2026-37, chapitre 5.4 : propriété du client sur ses données et sur le code"
  echo "développé pour lui, réversibilité complète sans frais."
  echo
  echo "| Élément | Valeur |"
  echo "|---|---|"
  echo "| Date de l'export | $(date '+%d/%m/%Y %H:%M') |"
  echo "| Serveur | $(hostname) |"
  echo "| Version en service | $release (code $version) |"
  echo "| Noyau | Odoo 19.0 Community, image du $(docker image inspect -f '{{.Created}}' eguitra/odoo:production | cut -c1-10) |"
  echo "| Base de données | $(docker compose exec -T db postgres --version | tr -d '\r') |"
  echo "| Sociétés | $(sql 'select count(*) from res_company') |"
  echo "| Utilisateurs actifs | $(sql 'select count(*) from res_users where active') |"
  echo "| Pièces comptables | $(sql 'select count(*) from account_move') |"
  echo
  echo "## Modules de la plateforme installés"
  echo
  echo "$modules"
  echo
  echo "## Contenu"
  echo
  echo "| Fichier | Taille | Empreinte SHA-256 |"
  echo "|---|---|---|"
  for f in "$out"/*; do
    [ "$(basename "$f")" = NOTICE.md ] && continue
    echo "| $(basename "$f") | $(du -h "$f" | cut -f1) | $(sha256sum "$f" | cut -c1-64) |"
  done
  echo
  echo "Applications web : $web_note."
  echo
  echo "## Réinstallation"
  echo
  echo "1. Serveur Ubuntu avec Docker : suivre infra/README.md (deploiement.tar.gz), en particulier"
  echo "   setup-vps.sh, puis copier infra/.env.example en infra/.env et générer de nouveaux secrets."
  echo "2. Code : extraire code.tar.gz dans infra/releases/<version>/ et y pointer infra/releases/current."
  echo "3. Base : créer la base et le rôle applicatif (infra/up.sh, infra/init-db.sh), puis"
  echo "   gunzip -c base.sql.gz | psql -U <superutilisateur> -d <base>."
  echo "4. Pièces jointes : extraire pieces-jointes.tar.gz dans le volume du noyau, sous"
  echo "   /var/lib/odoo/filestore/, propriétaire 100:101 (utilisateur odoo de l'image officielle)."
  echo "5. Démarrer : docker compose up -d, puis contrôler la connexion et les derniers enregistrements."
  echo
  echo "Les mots de passe des utilisateurs sont conservés sous forme d'empreintes ; les secrets du"
  echo "serveur d'origine (fichiers .env, configurations des noyaux) ne sont pas exportés."
} > "$out/NOTICE.md"
echo "Export écrit dans $out :"
ls -la "$out"
