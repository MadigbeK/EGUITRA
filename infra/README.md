# Exploitation du serveur

Plateforme EGUITRA : noyau Odoo 19 (invisible des utilisateurs), PostgreSQL 16, applications web
Next.js (EGUITRA Finance, AxisPro Suite, portail des porteurs, Rotations), sauvegardes continues
et proxy TLS. Tout tourne dans Docker Compose (`compose.yaml`).

## Première installation

1. Serveur Ubuntu neuf : `sudo infra/setup-vps.sh` (utilisateur `deploy`, SSH par clé, pare-feu,
   fail2ban, mises à jour de sécurité, Docker, swap, fuseau Africa/Conakry).
2. Code : copier le dépôt dans `~/eguitra` (depuis un poste : `scripts/dev/sync.sh`).
3. Secrets : `cp infra/.env.example infra/.env`, remplir chaque valeur (`openssl rand -base64 33`),
   `chmod 600 infra/.env`. Optionnel : `infra/backup.env` pour la copie hors site.
4. `infra/up.sh` : rend `odoo/odoo.conf`, récupère les modules OCA épinglés, construit les images,
   démarre db, odoo, web et backup, autorise la connexion de sauvegarde.
5. Base et premier administrateur : `infra/init-db.sh identifiant "Nom Prénom"` crée la base
   nommée par `ODOO_DB` (français, Guinée, plan SYSCOHADA, modules OCA et EGUITRA) et un
   administrateur au mot de passe provisoire, affiché une seule fois. À sa première connexion,
   l'administrateur remplace ce mot de passe et active la double authentification.
6. Toujours redémarrer le noyau après une installation ou une mise à jour de modules : le
   module d'audit modifie les modèles au chargement de ses règles (`init-db.sh` le fait).
7. Proxy TLS, une fois les noms de domaine pointés vers le serveur : renseigner `ACME_EMAIL`,
   `*_DOMAIN` et `ADMIN_IPS` dans `.env`, puis `docker compose --profile proxy up -d`.

## Mises à jour

```bash
scripts/dev/sync.sh                      # depuis le poste de développement
ssh eguitra-vps
cd ~/eguitra/infra
docker compose stop odoo
docker compose run --rm -T odoo odoo -c /etc/odoo/odoo.conf -d "$ODOO_DB" -u eguitra_finance --stop-after-init --workers 0
docker compose start odoo
docker compose build web && docker compose up -d web
```

Avant toute mise à jour en production : sauvegarde de base à la main
(`docker compose exec backup base-backup.sh`) et passage complet des tests.

## Tests

`infra/test.sh module…` installe les modules sur une base jetable copiée d'un modèle (`eguitra_ci_base`)
et lance leurs tests ; `--rebuild` reconstruit le modèle (après un changement de dépendances).

```bash
./test.sh eguitra_base eguitra_api eguitra_finance eguitra_approval eguitra_transport eguitra_chantier eguitra_immobilier eguitra_axispro
```

## Sauvegardes

Voir `backup/README.md` : archivage continu (perte maximale 15 minutes), sauvegarde de base chaque
nuit, filestore, copie hors site chiffrée, test de restauration (`backup/restore-test.sh`).

## Supervision

`infra/monitor-install.sh` (une fois) planifie `monitor.sh` toutes les 5 minutes : conteneurs et
leur santé, API du noyau, applications web, disque (alerte à 85 %), sauvegardes. Les alertes
partent au changement d'état et toutes les 6 heures pendant une panne, vers `ALERT_WEBHOOK_URL`
et/ou `ALERT_NTFY_URL` (`.env`) ; journal dans `logs/monitor.log`. Une fois les domaines publiés,
ajouter une surveillance externe de disponibilité (sonde HTTPS sur l'adresse de connexion).

## Accès techniques

- Noyau et applications n'écoutent que sur 127.0.0.1 ; accès d'administration par tunnel SSH :
  `ssh -N -L 3000:127.0.0.1:3000 -L 8069:127.0.0.1:8069 eguitra-vps`.
- Après activation du proxy, le client web du noyau (`CORE_DOMAIN`) n'est ouvert qu'aux adresses
  `ADMIN_IPS` ; l'API du noyau n'est jamais publiée.
- Journaux : `docker compose logs --tail 100 <service>` ; accès web dans le volume `caddy-data`
  (`/data/logs/acces.log`).

## Recette

`scripts/recette/donnees_demo.py` charge des données fictives (repérées « Démo ») dans la base de
recette pour les démonstrations. Ne jamais le lancer sur la base de production.
