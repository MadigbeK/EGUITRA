# Exploitation du serveur

Plateforme EGUITRA : noyau Odoo 19 (invisible des utilisateurs), PostgreSQL 16, applications web
Next.js (EGUITRA Finance, AxisPro Suite, portail des porteurs, Rotations), sauvegardes continues
et proxy TLS. Tout tourne dans Docker Compose (`compose.yaml`).

## Deux environnements séparés

| | Production | Recette |
|---|---|---|
| Rôle | données réelles du client | essais, formation, validation des versions |
| Base PostgreSQL | service `db`, base `ODOO_DB` (`eguitra`) | service `db-recette`, base `RECETTE_DB` (`eguitra_recette`) |
| Noyau | service `odoo`, port local 8069 | service `odoo-recette`, port local 8169 |
| Applications web | service `web`, port local 3000 | service `web-recette`, port local 3100 |
| Code | version figée `releases/current` (`release.sh`) | code de travail (`../addons`, `../apps/web`) |
| Pièces jointes | volume `odoo-prod-data` | volume `eguitra_odoo-data` |
| Sauvegardes | continues, hors site (`backup/`) | non (données reconstructibles) |

Les deux environnements ne partagent que le serveur et le proxy : ni grappe PostgreSQL, ni mot
de passe, ni fichiers, ni cookies de session. Le noyau de production se connecte à sa base avec un
rôle sans privilège de superutilisateur (`ODOO_DB_USER`).

Chaque environnement contient **les deux sociétés**, EGUITRA GROUP SARLU et MB AxisPro Consulting,
dans une même base : chacune a son plan de comptes SYSCOHADA, ses journaux, ses taxes et sa
numérotation ; les données sont cloisonnées par société ; un même compte peut être ouvert aux deux
sociétés (sélecteur en haut de l'écran, vue « Groupe consolidé »).

## Première installation

1. Serveur Ubuntu neuf : `sudo infra/setup-vps.sh` (utilisateur `deploy`, SSH par clé, pare-feu,
   fail2ban, mises à jour de sécurité, Docker, swap, fuseau Africa/Conakry).
2. Code : copier le dépôt dans `~/eguitra` (depuis un poste : `scripts/dev/sync.sh`).
3. Secrets : `cp infra/.env.example infra/.env`, remplir chaque valeur
   (`openssl rand -base64 33 | tr -d '/+='`), `chmod 600 infra/.env`. Optionnel :
   `infra/backup.env` pour la copie hors site.
4. `infra/up.sh` : rend `odoo/production.conf` et `odoo/recette.conf`, récupère les modules OCA
   épinglés, construit les images de la recette, crée le rôle applicatif de la production, prépare
   la première version de production, démarre tout.
5. Bases et premiers administrateurs :
   `infra/init-db.sh production identifiant "Nom Prénom"` puis
   `infra/init-db.sh recette identifiant "Nom Prénom"`. Chaque base reçoit les deux sociétés et un
   administrateur ouvert aux deux, au mot de passe provisoire affiché une seule fois ; à sa première
   connexion, il active la double authentification et choisit son mot de passe.
6. Toujours redémarrer un noyau après une installation ou une mise à jour de modules : le module
   d'audit modifie les modèles au chargement de ses règles (les scripts le font).
7. Proxy TLS, une fois les noms de domaine pointés vers le serveur : renseigner `ACME_EMAIL`,
   `*_DOMAIN` (dont `RECETTE_DOMAIN`) et `ADMIN_IPS` dans `.env`, puis
   `docker compose --profile proxy up -d`.

## Cycle d'une évolution

```bash
scripts/dev/sync.sh                  # 1. poste de développement : le code devient celui de la recette
ssh eguitra-vps
cd ~/eguitra/infra
./test.sh eguitra_base eguitra_api eguitra_finance eguitra_approval eguitra_transport eguitra_chantier eguitra_immobilier eguitra_axispro
docker compose stop odoo-recette     # 2. recette : mise à jour des modules modifiés
docker compose run --rm -T odoo-recette odoo -c /etc/odoo/odoo.conf -d eguitra_recette -u eguitra_finance --stop-after-init --workers 0
docker compose up -d --build odoo-recette web-recette
#                                      3. essais par les référents sur la recette, puis :
./release.sh                         # 4. mise en production (annoncée 48 heures à l'avance)
```

`release.sh` fige le code de la recette dans `releases/AAAAMMJJ-HHMM` (modules EGUITRA et OCA,
images `eguitra/odoo:release-…` et `eguitra/web:release-…`), prend une sauvegarde de base, met à
jour tous les modules EGUITRA de la base de production, redémarre et contrôle la production. En cas
d'échec de la mise à jour, le code précédent est remis en service automatiquement.
`./release.sh --list` montre les versions conservées et l'historique ; `./release.sh --rollback ID`
remet en service le code d'une version précédente (la base, elle, se restaure au point de
sauvegarde noté dans l'historique si la version annulée l'avait modifiée : `backup/README.md`).

## Tests

`infra/test.sh module…` installe les modules sur une base jetable de la recette, copiée d'un modèle
(`eguitra_ci_base`), et lance leurs tests ; `--rebuild` reconstruit le modèle (après un changement
de dépendances). La production n'est jamais sollicitée.

## Reprise des données

`scripts/reprise/reprise.sh recette|production dossier [--appliquer]` : toujours en recette d'abord,
une société à la fois (`REPRISE_SOCIETE=groupe` ou `cabinet`). Voir `scripts/reprise/README.md`.

## Sauvegardes

Voir `backup/README.md` : archivage continu de la production (perte maximale 15 minutes),
sauvegarde de base chaque nuit, pièces jointes, copie hors site chiffrée, test de restauration
(`backup/restore-test.sh`).

## Courriel

Les relances des clients partent par courriel dès qu'un serveur d'envoi est paramétré : renseigner
les variables `SMTP_*` de `.env`, puis `infra/mail-server.sh production` (et `recette` si besoin) ;
le script teste la connexion. Sans serveur, les relances s'impriment.

## Supervision

`infra/monitor-install.sh` (une fois, à relancer après une mise à jour de ce script) planifie
`monitor.sh` toutes les 5 minutes : conteneurs des deux environnements et leur santé, noyaux,
applications web, disque (alerte à 85 %), sauvegardes (archivage et copie hors site des WAL de
moins de 15 minutes), test de restauration réussi depuis moins de 40 jours, restauration à un
instant donné réussie depuis moins de 100 jours, double authentification exigée en production
(`eguitra_api.mfa_required` différent de 0). Il planifie aussi ces tests (le 1er de chaque mois ;
chaque trimestre avec compte rendu, voir `backup/README.md`) et le rapport de disponibilité.
Les alertes partent au changement d'état et toutes les 6 heures pendant une panne, vers
`ALERT_WEBHOOK_URL` et/ou `ALERT_NTFY_URL` (`.env`) ; journal dans `logs/monitor.log`, gardé 13 mois.

Sonde externe : `HEARTBEAT_URL` (`.env`, par exemple un contrôle healthchecks.io attendu toutes les
5 minutes) est appelée à chaque contrôle réussi ; le service externe alerte quand le signal cesse
(serveur arrêté, réseau coupé), ce que le serveur ne peut pas signaler lui-même.

Disponibilité (engagement de 99,5 % par mois) : `infra/availability-report.py [AAAA-MM]`, lancé
seul le 1er de chaque mois pour le mois précédent, calcule la disponibilité de la production sur le
journal de supervision (un créneau de 5 minutes sans contrôle compte comme indisponible) hors
maintenances déclarées dans `logs/maintenances.txt` ; `release.sh` y inscrit chaque mise en
production. Compte rendu : `logs/availability/AAAA-MM.md`.

## Accès techniques

- Recette : paramètre système `eguitra_api.environment_label` = `recette` ; l'application
  d'authentification du téléphone affiche alors « EGUITRA recette », distinct de la production.
- Recette ouverte sur Internet en HTTPS avant l'achat du domaine (16 octobre 2026) : nom provisoire
  `recette.<adresse IP, points remplacés par des tirets>.sslip.io` (service DNS public qui renvoie
  l'adresse contenue dans le nom), dans `RECETTE_DOMAIN` de `infra/.env` ; certificat Let's Encrypt
  obtenu par Caddy (`docker compose --profile proxy up -d caddy`). Les domaines non renseignés prennent
  un nom en `.localhost` (jamais joignable) : la production reste fermée tant qu'ils ne sont pas définis.
- Bascule sur le domaine définitif (`nimova.gn`, commandé le 21 octobre 2026, DNS gérés par le
  registraire) :
  1. chez le registraire, enregistrements A vers l'adresse du serveur pour `finance`, `axispro`,
     `portail` (ou le nom choisi pour le portail), `recette` et `noyau` ;
  2. `infra/domaines.sh verifier nimova.gn` : chaque nom doit pointer vers le serveur ;
  3. `infra/domaines.sh appliquer nimova.gn [nom-du-portail]` : copie de `.env`, noms inscrits, proxy
     recréé, certificats obtenus, chaque adresse contrôlée en HTTPS (le noyau répond 403 hors des
     adresses `ADMIN_IPS`) ; l'ancien nom de la recette en `sslip.io` cesse de répondre ;
  4. vérifier `ACME_EMAIL` (adresse réelle) et `ADMIN_IPS` (adresses de l'équipe technique) dans
     `.env` ;
  5. rétablir la double authentification de la recette avant de communiquer son adresse
     (paramètre système `eguitra_api.mfa_required` = 1 dans la base de recette, puis
     `docker compose restart odoo-recette`).

- Noyaux et applications n'écoutent que sur 127.0.0.1 ; accès d'administration par tunnel SSH :
  `ssh -N -L 3000:127.0.0.1:3000 -L 3100:127.0.0.1:3100 -L 8069:127.0.0.1:8069 -L 8169:127.0.0.1:8169 eguitra-vps`,
  puis http://localhost:3000 (production) et http://localhost:3100 (recette). Navigateur : Chrome,
  Edge ou Firefox ; les cookies de session sont sécurisés (`__Host-`) et Safari les refuse sur
  http://localhost.
- Après activation du proxy, le client web du noyau de production (`CORE_DOMAIN`) n'est ouvert
  qu'aux adresses `ADMIN_IPS` ; l'API des noyaux n'est jamais publiée.
- Journaux : `docker compose logs --tail 100 <service>` ; accès web dans le volume `caddy-data`
  (`/data/logs/acces.log`) ; mises en production dans `releases/HISTORY` et `logs/release-*.log`.

## Données de démonstration

`scripts/recette/donnees_demo.py` charge des données fictives (repérées « Démo ») dans la base de
recette pour les démonstrations. Jamais sur le noyau de production.
