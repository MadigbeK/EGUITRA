# EGUITRA Finance et AxisPro Suite

Plateforme de gestion financière pour EGUITRA GROUP SARLU (transport de produits pétroliers, BTP, immobilier)
et outil d'évaluation de bancabilité pour MB AxisPro Consulting (même groupe, même DG : M. Mohamed Nimaga).
Prestataire : E-VOLUTION XP, Madigbè KOUYATÉ, gérant. Client final : département Finance d'EGUITRA.

## Où en est le projet (mis à jour le 9 octobre 2026)

- Offre signée en principe : `docs/offre/Offre_technique_financiere_EGUITRA_v2.docx`, 50 000 000 GNF HT, 4 semaines,
  garantie 6 mois, sauvegardes toutes les 15 minutes, pénalités de retard 0,5 % par jour ouvré plafonnées à 10 %.
- Réunion de cadrage : mardi 13 octobre 2026, 10 h à 12 h, locaux d'EGUITRA. Support : `docs/offre/cadrage/`.
- Objectif interne : première mise en production Finance + AxisPro le **23 octobre** (le gérant part au Canada le 26),
  version complète le **6 novembre** (date contractuelle). Transport, BTP, immobilier, portail et mobile se finissent à distance.
- Le fichier JSON `EGUITRA_dossier_2026.json` reçu au départ est un jeu de TEST, pas des données réelles. Ne jamais
  citer ses chiffres au client.

## Architecture (héritée du socle SOGUIPREM, dépôt `MadigbeK/pharmaxp`)

| Dossier | Rôle |
|---|---|
| `infra/` | VPS Ubuntu 24.04, Docker Compose : PostgreSQL 16 (archivage continu des WAL), Odoo 18 Community + OCA, API, worker, web, Redis, Caddy (TLS, client web du noyau réservé aux IP admin). Sauvegardes chiffrées hors site. |
| `addons/` | Modules Odoo spécifiques `eguitra_*`. Seul `eguitra_core` existe (squelette + API `/api/eguitra/`). |
| `api/` | FastAPI, Python 3.12. Auth JWT + Argon2, sessions révocables, audit, rate limit Redis. Lectures SQL directes sur la base Odoo (rôle `eguitra_readonly`), écritures via JSON-RPC (compte `eguitra_bot`). Moteur de rapports déclaratif `app/reports/registry.py`. Dashboard dirigeant `app/routers/finance.py`. |
| `web/` | Next.js 16, Tailwind, shell « cockpit » bleu nuit / vert-bleu / or. Le navigateur ne parle qu'aux Route Handlers Next (`app/api/*`) qui proxifient l'API avec les cookies httpOnly `eguitra_access` / `eguitra_refresh`. |
| `docs/offre/` | Offres, annexes, kit de cadrage, générés par `node docs/offre/build*.js` (source unique `contenu*.js`, rendu `rendu.js`). |

Règle d'or de l'offre : **l'utilisateur ne voit jamais Odoo**. Toute interface passe par `web/`. Le mot « noyau » suffit devant le client.

Rôles plateforme : `super_admin`, `dg`, `finance`, `exploitation`, `chantiers`, `immobilier`, `cabinet`, `porteur` (porteur de projet, portail AxisPro uniquement).

## Ce qui est fait et vérifié

- API : 17 tests unitaires (`pytest`), lint `ruff` propre. Migrations Alembic créent `platform.users`, `refresh_tokens`, `audit_log`.
- Flux complet vérifié avec Playwright sur un PostgreSQL local : login, cookies, `/finance` (dashboard), `/finance/rapports`.
- Les 9 rapports financiers et le dashboard ont été exécutés contre `api/tests/fixtures/odoo18_mini.sql`, un schéma
  minimal imitant les tables Odoo 18 (`account_move`, `account_move_line`, `account_account.code_store` jsonb, etc.).
- Les 23 modules OCA de `infra/oca-repos.txt` existent sur la branche 18.0 (vérifié par clone).

## Ce qui n'est PAS encore vérifié

- Le noyau Odoo 18 lui-même n'a jamais été lancé (pas de Docker dans la session cloud). Premier vrai test = premier
  `docker compose up` sur le VPS ou en local. Attendre des surprises sur les dépendances Python des modules OCA
  (`infra/oca-requirements.txt`, à installer dans une image Odoo dérivée si nécessaire).
- `l10n_syscohada` : vérifier le plan de comptes contre celui de l'expert-comptable du client.
- Les requêtes SQL du registre supposent Odoo 18 (`code_store` jsonb par société). Si une table diffère, corriger `registry.py`.

## Prochaines étapes, dans l'ordre

1. Déployer sur le VPS (`infra/README.md`), créer la base `eguitra`, installer les modules, créer `eguitra_bot` et le rôle lecture seule, seed de l'admin.
2. Écrans Finance restants sur le même moteur de rapports : Ventes, Achats, Trésorerie, Tiers, Balance, Journaux (pages `web/app/finance/*` appelant `/reports/run`).
3. `addons/eguitra_core` : axes analytiques (activité, centre de coût, chantier, véhicule, bien), circuits d'approbation (`base_tier_validation`), seuils d'alerte, contrôles de clôture (compte de passage 585000 soldé, équilibres).
4. Écritures depuis la surcouche via JSON-RPC : facture de vente, facture d'achat, paiement, OD.
5. AxisPro Suite : modèle critères/gates/scoring (grille de 111 critères importée comme données), data room, revues, rapports, portail porteur.
6. Transport (rotations, flotte, rentabilité, mobile hors ligne), BTP (situations, retenues de garantie), immobilier (biens, baux), fiscal, consolidation.

## Lancer en local

```bash
# API (Python 3.12, PostgreSQL et Redis locaux ou via compose)
cd api && pip install ".[dev]" && cp ../infra/.env.example .env   # adapter les hôtes
alembic upgrade head && uvicorn app.main:app --port 8000
# Web
cd web && npm install && API_INTERNAL_URL=http://localhost:8000 npm run dev
# Stack complète (nécessite Docker)
cd infra && cp .env.example .env && ./fetch-oca.sh && docker compose up -d --build
```

Fixture Odoo minimale pour tester sans noyau : `psql -d eguitra -f api/tests/fixtures/odoo18_mini.sql`.
Le rate limit de login est par IP : `redis-cli FLUSHALL` si 429 pendant les tests.

## Conventions

- Branche de travail : `claude/erp-odoo-clients-eu6ep6`. Commits en français, descriptifs.
- Tout texte visible du client en français, montants en GNF sans décimale (`fmtGNF`).
- Ne pas committer `.env`, `infra/oca-src/`, `infra/oca/`, `node_modules/`, `.next/`.
- Documents client : régénérer par les scripts de `docs/offre/`, ne pas éditer les `.docx` à la main.
- Lint : `ruff check app tests` et `ruff format` côté API ; `npx tsc --noEmit` et `npx next build` côté web.
