# Dossier technique : faire évoluer et exploiter la plateforme

Destiné à l'équipe technique (E-VOLUTION XP ou tout prestataire repreneur, offre § 5.4
réversibilité). Il décrit l'architecture, la façon d'ajouter une fonction, un module EGUITRA ou un
module du noyau (Odoo Community, OCA) sans casser l'existant, la livraison, l'exploitation et la
réversibilité. Il complète `infra/README.md` (exploitation) et le dossier de conception
(`docs/projet/Dossier_de_conception.docx`). État au 25 octobre 2026.

## 1. Architecture en bref

- Noyau : Odoo 19.0 Community, jamais montré aux utilisateurs, localisation `l10n_gn`. Dix modules
  OCA épinglés (`infra/oca/modules.txt` ; commits des douze dépôts, dépendances comprises, dans
  `infra/oca/lock.txt`). Le moteur `eguitra_approval` remplace `base_tier_validation`, absent en 19.0.
- Onze modules spécifiques `addons/eguitra_*` (tableau ci-dessous).
- API métier : `/api/v1`, routes déclarées par `@api_route`
  (`addons/eguitra_api/controllers/framework.py`), exécutées sous l'identité de l'utilisateur
  (droits et règles de société du noyau appliqués). Sociétés, applications et profils sont décrits
  en un seul endroit : `addons/eguitra_api/organisation.py`, avec son pendant web
  `apps/web/lib/config.ts`.
- Une application web Next.js (`apps/web`) pour toutes les surfaces : `/finance`, `/transport`
  (application à part entière depuis le 22 octobre 2026), `/axispro`, `/analyse`, `/portail`,
  `/mobile` (Rotations, application web progressive utilisable hors ligne) et `/rh`. Le navigateur
  ne parle qu'à la passerelle `/api/odoo`.

| Module | Dépend de | Rôle |
|---|---|---|
| `eguitra_base` | `account`, `analytic`, `l10n_gn`, `auth_totp`, les dix modules OCA | Sociétés, dix profils, sept axes analytiques, règles de la piste d'audit |
| `eguitra_api` | `eguitra_base`, `auth_password_policy` | Cadre de l'API, authentification, double authentification, sessions, comptes et sociétés, fichiers reçus (`files.py`) |
| `eguitra_finance` | `eguitra_api`, modules OCA de la comptabilité | Pilotage, comptabilité, trésorerie, clôtures, états, fiscalité, dette, immobilisations, budget, consolidation, validation de la reprise |
| `eguitra_approval` | `eguitra_finance` | Circuits d'approbation, engagements de dépense, décaissements |
| `eguitra_transport` | `eguitra_finance` | Flotte, rotations, facturation, manquants, taxes, rentabilité, ensembles gérés, coûts standard, synchronisation de Rotations |
| `eguitra_chantier` | `eguitra_finance` | BTP : chantiers, situations, retenues de garantie |
| `eguitra_immobilier` | `eguitra_finance`, `contract` | Biens, baux, loyers, quittancement |
| `eguitra_axispro` | `eguitra_finance` | AxisPro Suite : grille, dossiers, évaluation, data room, comités, rapports, mode expert, portail de base |
| `eguitra_portail` | `eguitra_axispro` | Portail des porteurs enrichi (communications, ressources, événements, rendez-vous, notifications) |
| `eguitra_analytics` | finance, transport, chantier, immobilier, axispro | Analyse, en lecture seule, par société |
| `eguitra_rh` | `eguitra_finance`, `eguitra_transport` | Personnel, absences, avances, paie, bulletins |

## 2. Environnements

Deux environnements complets sur le même serveur, sans base, secret ni cookie communs ; seuls le
serveur et le proxy (Caddy, TLS automatique) sont partagés.

| | Production | Recette |
|---|---|---|
| Services | `db`, `odoo`, `web`, `backup` | `db-recette`, `odoo-recette`, `web-recette` |
| Ports locaux | noyau 8069, web 3000 | noyau 8169, web 3100 |
| Base | `eguitra`, rôle applicatif sans superutilisateur | `eguitra_recette` |
| Code | version figée `infra/releases/current`, mise en service par `infra/release.sh` | code de travail, envoyé par `scripts/dev/sync.sh` |
| Données | réelles (vide jusqu'à la reprise) ; jamais de données de démonstration ni de test | fictives, repérées « Démo » |
| Sauvegardes | continues (chapitre 8) | copie logique chaque nuit, gardée 7 jours |

Les noyaux et les applications n'écoutent que sur 127.0.0.1 ; l'accès d'administration passe par
un tunnel SSH (`infra/README.md`, « Accès techniques »). Un noyau démarré sans sa base la créerait
vide : `up.sh` ne démarre un noyau que si sa base existe.

## 3. Ajouter une fonction à un module EGUITRA

1. Modèle : champs et méthodes dans `addons/eguitra_<module>/models/`. Tout nouveau modèle reçoit ses
   droits (`security/ir.model.access.csv`, par profil) et une règle de société
   (`security/*_rules.xml`, `company_id in company_ids`), sinon un profil d'une autre société le lirait.
2. Piste d'audit : ajouter le modèle à la liste `AUDITED_MODELS` du paquet (`__init__.py`, ou
   `hooks.py`), passée à `eguitra.setup.ensure_audit_rules` par le crochet `post_init_hook` du
   module ; pour les bases existantes, une migration appelle `ensure_all_audit_rules` (exemple :
   `eguitra_base/migrations/19.0.1.8.0/end-migrate.py`). Le test `test_audit_coverage`
   d'`eguitra_base` échoue si un modèle de la plateforme n'est ni suivi ni écarté explicitement
   (`AUDIT_EXCLUDED_MODELS`).
3. Version et migration : augmenter la version du manifeste (`19.0.1.x.0`) et écrire
   `migrations/<version>/post-migrate.py` pour les données à transformer. Redémarrer le noyau après
   la mise à jour (module d'audit).
4. Route d'API : `@api_route("/<module>/...", profiles=(...))` dans `controllers/`. Le premier segment
   de la route fixe la société servie (`organisation.py`, `MODULE_ENTITY`) : une route de transport,
   de chantier ou d'immobilier ne répond que dans EGUITRA GROUP SARLU, une route AxisPro ou du
   portail que dans MB AxisPro Consulting. Une erreur métier se signale par `UserError` (réponse
   422) ou `ApiError`.
5. Écran : page dans `apps/web/app/<surface>/...`, composants dans `apps/web/components/`,
   types dans `apps/web/lib/*-types.ts`, entrée de menu dans `apps/web/lib/nav.ts` (profils et société
   qui la voient). Les appels passent par `useApi`, `apiSend`, `apiUpload`, `apiDownload`
   (`apps/web/lib/api-client.ts`). Une commande que l'API refuse à un profil ne s'affiche pas pour lui.
6. Tests : `addons/eguitra_<module>/tests/` (classes `ApiCase` pour l'API), avec un test de refus pour
   chaque profil qui ne doit pas accéder à la route. Ils tournent sur une base jetable :
   `infra/test.sh eguitra_<module>` sur le serveur.
7. Guides : mettre à jour `docs/guides/guide-<profil>.md`, puis `node docs/guides/build.js` (Word).

## 4. Ajouter un module EGUITRA

1. Créer `addons/eguitra_<nom>/` sur le modèle des autres (manifeste, `security/`, `models/`,
   `controllers/`, `tests/`), dépendant de `eguitra_api` (et de `eguitra_finance` s'il comptabilise).
2. Organisation : déclarer sa société dans `organisation.py` (`MODULE_ENTITY` pour le préfixe de ses
   routes, `PROFILE_ENTITY` pour un nouveau profil propre à une société) et, s'il s'agit d'une
   nouvelle application, dans `APPS` (profils, société) et dans `apps/web/lib/config.ts` (`APPS`).
3. Profils : un nouveau profil se déclare dans `eguitra_base` (`security/eguitra_security.xml`).
4. Livraison : ajouter le module à `MODULES` de `infra/release.sh`, à `EGUITRA_MODULES` de
   `infra/init-db.sh` et à `MODULES` de `scripts/reprise/essai.sh`. `infra/test.sh` et `release.sh`
   installent un module absent de la base. En recette :
   `docker compose run --rm -T odoo-recette odoo -c /etc/odoo/odoo.conf -d eguitra_recette -i eguitra_<nom> --stop-after-init --workers 0`,
   puis redémarrer `odoo-recette`.

## 5. Ajouter un module du noyau (Odoo Community ou OCA)

1. Vérifier qu'il existe en 19.0, sa licence (LGPL ou AGPL), ses dépendances, ses tests.
2. Module OCA : ajouter son dépôt à `infra/oca/repos.txt` (s'il n'y est pas) et son nom à
   `infra/oca/modules.txt`, puis `infra/oca/fetch.sh --update` sur le serveur : le commit est épinglé
   dans `infra/oca/lock.txt` (à committer), `oca-src/addons_path` et `oca-src/requirements.txt` sont
   régénérés. Module standard d'Odoo Community : rien à récupérer.
3. Base de test : `infra/test.sh --rebuild` reconstruit la base modèle avec le nouveau module, puis
   `infra/test.sh <modules concernés>`.
4. Dépendance : le déclarer dans le manifeste du module EGUITRA qui l'utilise (`depends`), afin qu'il
   s'installe avec lui ; sinon l'ajouter aux listes de `release.sh` et `init-db.sh`.
5. Le rendre visible : le noyau n'est jamais montré aux utilisateurs. Une fonction du module qui doit
   être utilisée passe par une route d'API et un écran (chapitre 3, étapes 4 et 5) ; une fonction de
   fond (tâche planifiée, calcul) n'a besoin que de son paramétrage.
6. Piste d'audit et droits : comme au chapitre 3 pour les modèles du module qui portent des données
   de gestion.

## 6. Livrer

1. Recette : `scripts/dev/sync.sh` envoie le code ; mettre à jour les modules en recette (`-u`) puis
   redémarrer `odoo-recette` (et reconstruire `web-recette` si l'application web a changé).
2. Contrôles : `ruff check addons scripts`, `npx tsc --noEmit` et `npx next build` (dans `apps/web`),
   `npm audit --omit=dev` (dans `apps/web`), `infra/test.sh` sur les modules touchés, scénarios du
   cahier de recette concernés.
3. Production : uniquement `infra/release.sh` (version figée, sauvegarde de la base, mise à jour des
   modules, contrôle, retour arrière possible : `--rollback`), annoncée 48 heures à l'avance. Une
   seule session conduit une mise en production à la fois (verrou convenu entre sessions :
   `~/eguitra/logs/mise-en-production.lock`). Historique : `infra/release.sh --list` et
   `infra/releases/HISTORY`.

## 7. Règles à respecter

- Ne jamais committer de secrets (`.env`, clés, mots de passe) ; fournir des `.env.example`.
- Fichiers en fins de ligne LF (les scripts shell en CRLF ne s'exécutent pas sur le serveur).
- Exports vers les tableurs : écrire le texte par `xlsx_row` (`eguitra_api/files.py`), jamais comme
  formule. Fichiers reçus : contrôler leur format réel (`detect_type`).
- Une donnée de gestion modifiable par le client (grille, seuils, barèmes) est une donnée, pas du code.
- Les documents et données du client (classeurs, grilles, exports) restent hors du dépôt.

## 8. Exploitation

Le détail est dans `infra/README.md` et `infra/backup/README.md`. État au 25 octobre 2026 :

| Fonction | Outil | État |
|---|---|---|
| Archivage des journaux de transactions (WAL) | `infra/backup/archive-wal.sh`, `archive_timeout` de 5 minutes | en service, sur le serveur |
| Sauvegarde de base | `infra/backup/base-backup.sh`, chaque nuit à 01 h 30 | en service, sur le serveur, 14 jours |
| Pièces jointes | `infra/backup/files-backup.sh`, miroir toutes les 15 minutes, instantané chaque nuit | en service, sur le serveur |
| Copie hors site chiffrée | `infra/backup/offsite.sh` (rclone, distant `crypt` ; 30 sauvegardes quotidiennes, 12 mensuelles, 15 jours de journaux) | pas en service : le stockage chez un second hébergeur n'est pas souscrit (`infra/backup.env`) |
| Tests de restauration | `infra/backup/restore-test.sh`, chaque mois et chaque trimestre à un instant donné, avec compte rendu ; `--offsite` restaure depuis la copie hors site et mesure le vrai délai de reprise | mensuel réussi ; premier test à un instant donné réussi le 25 octobre 2026 (`docs/projet/exploitation/restauration-20261025-0018.md`) ; restauration depuis la copie hors site à jouer dès sa mise en service |
| Supervision | `infra/monitor.sh` toutes les 5 minutes (`monitor-install.sh`) | en service ; aucune destination d'alerte configurée (`ALERT_WEBHOOK_URL`, `ALERT_NTFY_URL` dans `infra/.env`) : alertes inscrites au seul journal `logs/monitor.log` ; sonde externe `HEARTBEAT_URL` prévue |
| Disponibilité | `infra/availability-report.py`, chaque mois | outillé ; calcul sur le journal de la supervision, seules les maintenances annoncées 48 heures à l'avance étant exclues |
| Mises à jour de sécurité | système : chaque nuit, sans redémarrage (`setup-vps.sh`) ; images : `infra/maj-securite.sh`, chaque mois, recette puis production, annoncée 48 heures à l'avance, compte rendu du mois | outillées ; la supervision rappelle la mise à jour des images au-delà de 35 jours |
| Double authentification | paramètre `eguitra_api.mfa_required` | outillée ; suspendue en production depuis le 21 octobre 2026 à la demande du gérant, à rétablir avant la reprise des données réelles (paramètre à 1, puis redémarrage du noyau) ; suspendue aussi en recette |
| Courriel sortant | `infra/mail-server.sh` | pas de serveur d'envoi fourni : les relances s'impriment |
| Noms de domaine | `infra/domaines.sh` | adresses provisoires en `sslip.io` ; nimova.gn commandé le 21 octobre 2026, en attente de finalisation |
| Réversibilité | `infra/export-reversibilite.sh` | outillée depuis le 25 octobre 2026 (chapitre 9) |

Précaution : toujours redémarrer le noyau après l'installation ou la mise à jour de modules (le
module d'audit modifie les modèles au chargement de ses règles). Les tâches longues se lancent
détachées (`nohup … &`, journal dans `~/eguitra/logs/`).

## 9. Réversibilité (offre, chapitre 5.4)

Le client est propriétaire de ses données et du code développé pour lui. Sur simple demande et sans
frais, E-VOLUTION XP remet une copie complète, dans des formats ouverts. L'outil
`infra/export-reversibilite.sh` la produit en une fois, sans arrêter la production, dans un dossier
daté (par défaut sous `~/eguitra/exports`) :

| Fichier | Contenu |
|---|---|
| `base.sql.gz` | base de production, export SQL complet en texte (`pg_dump`), sans propriétaires |
| `pieces-jointes.tar.gz` | pièces jointes de la base |
| `code.tar.gz` | code de la version en service : modules EGUITRA et OCA, applications web |
| `deploiement.tar.gz` | configuration de déploiement et scripts, sans aucun secret |
| `NOTICE.md` | contenu, versions, procédure de réinstallation, empreintes SHA-256 |

L'export contient les données de l'entreprise : il se remet au client par un moyen sûr, puis
s'efface du serveur. Le présent dossier, `infra/README.md` et `infra/backup/README.md` complètent
la notice.

Les composants génériques d'E-VOLUTION XP restent réutilisables par E-VOLUTION XP (offre, 5.4).
