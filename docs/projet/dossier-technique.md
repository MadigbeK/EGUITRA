# Dossier technique : faire évoluer la plateforme

Destiné à l'équipe technique (E-VOLUTION XP ou tout prestataire repreneur, offre § 5.4 réversibilité).
Il décrit comment ajouter une fonction, un module EGUITRA ou un module du noyau (Odoo Community, OCA)
sans casser l'existant, et comment le livrer. Il complète `infra/README.md` (exploitation) et le
dossier de conception (`docs/projet/Dossier_de_conception.docx`).

## 1. Architecture en bref

- Noyau : Odoo 19.0 Community, jamais montré aux utilisateurs. Modules métier `addons/eguitra_*`
  (base, api, finance, approval, transport, chantier, immobilier, axispro) et dix modules OCA épinglés
  (`infra/oca/`).
- API métier : `/api/v1`, routes déclarées par `@api_route` (`addons/eguitra_api/controllers/framework.py`),
  exécutées sous l'identité de l'utilisateur (droits et règles de société du noyau appliqués).
- Une application web Next.js (`apps/web`) pour les quatre surfaces : `/finance`, `/axispro`,
  `/portail`, `/mobile`. Le navigateur ne parle qu'à la passerelle `/api/odoo`.
- Deux environnements séparés sur le serveur : production (`db`, `odoo`, `web`) et recette
  (`db-recette`, `odoo-recette`, `web-recette`), sans base, secret ni cookie communs.

## 2. Ajouter une fonction à un module EGUITRA

1. Modèle : champs et méthodes dans `addons/eguitra_<module>/models/`. Tout nouveau modèle reçoit ses
   droits (`security/ir.model.access.csv`, par profil) et une règle de société
   (`security/*_rules.xml`, `company_id in company_ids`), sinon un profil d'une autre société le lirait.
2. Piste d'audit : déclarer le modèle dans la liste passée à `eguitra.setup.ensure_audit_rules`
   (crochet `post_init_hook` du module) et, pour les bases existantes, dans une migration.
3. Version et migration : augmenter la version du manifeste (`19.0.1.x.0`) et écrire
   `migrations/<version>/post-migrate.py` pour les données à transformer. Redémarrer le noyau après
   la mise à jour (module d'audit).
4. Route d'API : `@api_route("/<module>/...", profiles=(...))` dans `controllers/`. Le premier segment
   de la route fixe la société servie (`addons/eguitra_api/organisation.py`, `MODULE_ENTITY`) : une
   route de transport, de chantier ou d'immobilier ne répond que dans EGUITRA GROUP, une route
   AxisPro ou du portail que dans MB AxisPro. Une erreur métier se signale par
   `UserError` (réponse 422) ou `ApiError`.
5. Écran : page dans `apps/web/app/<surface>/...`, composants dans `apps/web/components/`,
   types dans `apps/web/lib/*-types.ts`, entrée de menu dans `apps/web/lib/nav.ts` (profils et société
   qui la voient). Les appels passent par `useApi`, `apiSend`, `apiUpload`, `apiDownload`
   (`apps/web/lib/api-client.ts`).
6. Tests : `addons/eguitra_<module>/tests/` (classes `ApiCase` pour l'API). Ils tournent sur une base
   jetable : `infra/test.sh eguitra_<module>` sur le serveur.
7. Guides : mettre à jour `docs/guides/guide-<profil>.md`, puis `node docs/guides/build.js` (Word).

## 3. Ajouter un module EGUITRA

1. Créer `addons/eguitra_<nom>/` sur le modèle des autres (manifeste, `security/`, `models/`,
   `controllers/`, `tests/`), dépendant de `eguitra_api` (et de `eguitra_finance` s'il comptabilise).
2. Organisation : déclarer sa société dans `addons/eguitra_api/organisation.py` (`MODULE_ENTITY` pour
   le préfixe de ses routes, `PROFILE_ENTITY` pour un nouveau profil) et, s'il s'agit d'une nouvelle
   application, dans `APPS` (profils, société) et dans `apps/web/lib/config.ts` (`APPS`).
3. Profils : un nouveau profil se déclare dans `eguitra_base` (groupe et libellé).
4. Livraison : ajouter le module à `MODULES` de `infra/release.sh` et à `EGUITRA_MODULES` de
   `infra/init-db.sh`, puis l'installer en recette :
   `docker compose run --rm -T odoo-recette odoo -c /etc/odoo/odoo.conf -d eguitra_recette -i eguitra_<nom> --stop-after-init --workers 0`.

## 4. Ajouter un module du noyau (Odoo Community ou OCA)

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
   être utilisée passe par une route d'API et un écran (chapitre 2, étapes 4 et 5) ; une fonction de
   fond (tâche planifiée, calcul) n'a besoin que de son paramétrage.
6. Piste d'audit et droits : comme au chapitre 2 pour les modèles du module qui portent des données
   de gestion.

## 5. Livrer

1. Recette : `scripts/dev/sync.sh` envoie le code ; mettre à jour les modules en recette puis
   redémarrer `odoo-recette` (et reconstruire `web-recette` si l'application web a changé).
2. Contrôles : `ruff check addons scripts`, `npx tsc --noEmit` et `npx next build` (dans `apps/web`),
   `infra/test.sh` sur les modules touchés, scénarios du cahier de recette concernés.
3. Production : uniquement `infra/release.sh` (version figée, sauvegarde de la base, mise à jour des
   modules, contrôle, retour arrière possible : `--rollback`), annoncée 48 heures à l'avance. Jamais
   de données de démonstration ni de test en production.

## 6. Règles à respecter

- Ne jamais committer de secrets (`.env`, clés, mots de passe) ; fournir des `.env.example`.
- Fichiers en fins de ligne LF (les scripts shell en CRLF ne s'exécutent pas sur le serveur).
- Exports vers les tableurs : écrire le texte par `xlsx_row` (`eguitra_api/files.py`), jamais comme
  formule. Fichiers reçus : contrôler leur format réel (`detect_type`).
- Une donnée de gestion modifiable par le client (grille, seuils, barèmes) est une donnée, pas du code.
