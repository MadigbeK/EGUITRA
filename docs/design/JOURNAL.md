# Journal de la session design NIMOVA

Tenu par la session design, sur la branche `claude/design-nimova`. La session fonctionnelle le
reporte dans `docs/projet/ETAT.md` au moment de la fusion.

## Fait

- 16 octobre 2026 : branche `claude/design-nimova` créée depuis `claude/bold-shannon-gpg2hv`
  (3b9ecfa), dans un worktree séparé ; `npm ci` dans `apps/web`.
- Prévisualisation avec les données de la recette, sans rien modifier sur le serveur : tunnel
  `ssh -N -L 8169:127.0.0.1:8169 eguitra-vps`, fichier `apps/web/.env.local` non versionné
  (`ODOO_URL=http://localhost:8169`, `COOKIE_PREFIX=egd`), `next dev --port 3200 --hostname 127.0.0.1`
  (serveur joignable depuis la seule machine du gérant). Le gérant se connecte lui-même aux comptes
  de recette.
- Lu : brief, état du projet, note de cadrage du DG (12 pages), 16 captures d'écran retenues par le
  gérant (Sypher, Vantus, ERP Software, « Production output », etc.), guide « 30 signes que ton site
  est vibe-codé » transmis par le gérant.

## Décisions du gérant (16 octobre 2026)

- Modèle : une synthèse originale des captures fournies, avec le fondamental NIMOVA.
- Méthode : le gérant donne carte blanche (« travaille en toute autonomie », « ne t'arrête qu'après
  avoir tout achevé »). Pas de validation intermédiaire de planche : le design est appliqué à tous
  les écrans du périmètre, puis présenté.
- Noms affichés : NIMOVA · Finance, NIMOVA · AxisPro, NIMOVA · Rotations. La société active
  s'affiche dans le sélecteur de l'en-tête.
- Portail des porteurs de projets : marque MB AxisPro Consulting, NIMOVA restant une marque interne.
- Nom de domaine : nimovagroup.com (voir `demandes-fonctionnelles.md`).

## Partis pris annoncés au gérant, sans objection

- Icônes : un jeu dessiné pour NIMOVA (SVG, un seul trait, une seule taille), sans dépendance ;
  `lucide-react` sera retiré. C'est le seul écart avec le brief, qui citait lucide-react.
- Caractères : Aptos n'étant pas libre, deux couples de polices libres sont proposés sur la planche
  et le gérant choisit. Ni Inter, ni Geist, ni Space Grotesk.
- Logo : le N du DG redessiné, en gardant le carré et les verts.
- Fond crème #F9F8F5, jamais de blanc pur. Pas d'ombre hors des éléments qui flottent (menus,
  fenêtres), pas de dégradé décoratif, pas d'emoji ni de tiret cadratin dans les textes.

## En cours

- Planche de proposition n° 1 : `docs/design/planche/`.
