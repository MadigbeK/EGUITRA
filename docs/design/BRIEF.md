# Brief de la session design : identité NIMOVA et refonte de l'interface

Session ouverte le 15 octobre 2026 par le gérant, en parallèle de la session « fonctionnalités ».
Lire d'abord `CLAUDE.md`, `docs/projet/ETAT.md` et `docs/client/2026-10-15-identite-nimova/`
(message du DG, présentation PDF, premiers constats).

## Ce qui est imposé

Le DG a fixé la nouvelle identité du système : **NIMOVA**, « Système intégré de gestion ».
« Tu peux l'améliorer mais le fondamental reste. L'outil doit être unique à nous. »

- Le nom NIMOVA et la signature « La maîtrise intégrée de votre performance ».
- Une marque interne, commune aux deux structures (EGUITRA GROUP SARLU, MB AxisPro Consulting) :
  une plateforme commune, deux espaces de gestion.
- La palette de sa présentation sert de base, affinable : verts profonds #142F29 et #22634C,
  vert d'eau #A5E6C2, accent doré #D3AA5B, fond crème #F9F8F5. Sa police (Aptos, Microsoft)
  n'est pas libre pour le web : choisir une police libre, auto-hébergée.

## Ce que veut le gérant

Il trouve la présentation du DG laide et refuse un design « IA » générique (tableau de bord
interchangeable, cartes arrondies pastel, choix par défaut). Il va fournir un **modèle** : lien de
démonstration, captures d'écran, éventuellement le zip d'un template acheté. Suivre ce modèle
fidèlement, en y appliquant le fondamental NIMOVA. Sans modèle, ne rien inventer : demander.

## Périmètre de cette session

Uniquement la présentation de `apps/web` :
- thème : `app/globals.css` (variables, thèmes `data-app`) ;
- composants de base : `components/ui.tsx` ; coque : `components/shell/` (en-tête, menu,
  sélecteur de société) ;
- page de connexion `app/login`, portail `app/portail`, application Rotations
  (`components/mobile/`, `public/mobile.webmanifest`, `public/icons/`) ;
- noms affichés (`lib/config.ts`, constante `APPS`), titres, favicon.

Ne pas toucher : `addons/`, `infra/`, `scripts/` ; la logique des écrans (appels d'API, routes
`app/api/`, `lib/session.ts`, `lib/api-client.ts`, `proxy.ts`, `public/mobile-sw.js`). Un besoin
fonctionnel se note dans `docs/design/demandes-fonctionnelles.md` pour l'autre session.

Questions ouvertes à poser au gérant :
- nom des espaces et des applications (par exemple « NIMOVA · Finance », « NIMOVA · AxisPro ») ;
- le portail des porteurs de projets, clients extérieurs du cabinet, garde-t-il la marque
  MB AxisPro Consulting (NIMOVA étant une marque interne) ?
- nom de domaine : nimova.com est pris ; nimova.cloud et nimovagroup.com sont libres.

## Contraintes techniques

- Politique de sécurité du contenu en production (`next.config.ts`) : polices, images et scripts
  servis par le site lui-même. Pas de CDN ni de Google Fonts à l'exécution : `next/font` (fichiers
  embarqués à la construction) ou fichiers dans `public/`.
- Next.js 16, React 19, Tailwind 4, icônes lucide-react. Pas de nouvelle dépendance lourde sans
  raison.
- Accessibilité : contrastes AA, focus visibles, navigation au clavier ; écrans de 360 px
  (Rotations, portail) à 1440 px.
- Textes en français, montants en GNF.

## Organisation entre les deux sessions

- Travailler dans un **worktree git séparé**, sur la branche `claude/design-nimova` créée depuis
  `claude/bold-shannon-gpg2hv`, puis `npm ci` dans `apps/web` du worktree.
- Commits en français, un sujet par commit ; ne pousser que `claude/design-nimova`.
- Jamais `scripts/dev/sync.sh`, `infra/release.sh` ni aucune modification sur le serveur : la
  session fonctionnelle fusionne la branche et déploie (recette, puis production) après
  validation du gérant.
- Ne pas modifier `docs/projet/ETAT.md` : tenir `docs/design/JOURNAL.md` (fait, en cours,
  décisions) ; la session fonctionnelle le reportera à la fusion.
- Avant de rendre la main : `npx tsc --noEmit` et `npx next build` dans `apps/web`.

## Prévisualiser avec les données de la recette

1. Tunnel vers le noyau de recette : `ssh -N -L 8169:127.0.0.1:8169 eguitra-vps`.
2. Dans `apps/web` du worktree, fichier `.env.local` (non versionné) :
   `ODOO_URL=http://localhost:8169` et `COOKIE_PREFIX=egd`.
3. `npx next dev --port 3200`, puis http://localhost:3200/finance (et /axispro, /portail, /mobile).
4. Comptes de recette : `docs/projet/ETAT.md`, chapitre 6. Mots de passe et clés de double
   authentification dans `~/eguitra/infra/.env` du serveur (lecture par SSH) ; ne jamais les
   recopier dans le dépôt ni dans les réponses.
