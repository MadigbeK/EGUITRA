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
- Identité appliquée à toute l'application web (charte : `docs/design/CHARTE.md`) :
  - thème (`app/globals.css`) : palette relevée dans le PDF du DG, teintes dérivées à contraste AA
    mesuré, polices Barlow embarquées par `next/font`, petits rayons, aucune ombre hors éléments
    flottants ;
  - marque (`components/brand.tsx`) : monogramme N redessiné, noms « NIMOVA · module »
    (`lib/config.ts`), icônes du site et de Rotations (`public/icons/`, manifeste) ;
  - jeu d'icônes dessiné pour le projet (`components/icons.tsx`), `lucide-react` retiré ;
  - coque (`components/shell/AppShell.tsx`) : dos du registre à la couleur de la société active,
    navigation en texte seul, choix de la société, menu du compte ; variante du portail sous la
    marque MB AxisPro Consulting ;
  - connexion : couverture reprise de la note du DG, code de vérification en cases de compteur ;
    titre et icône d'onglet du cabinet pour le portail ;
  - composants (`components/ui.tsx`) : chiffres clés en bande, compteur, répartition segmentée,
    colonnes avec info-bulles, étapes, boutons d'envoi de fichiers accessibles au clavier ;
  - écrans : tableau de bord du dirigeant recomposé (trésorerie au compteur, registre
    d'indicateurs), Transport (volume livré au compteur), Rotations repensée pour le téléphone,
    portail du porteur, gates d'AxisPro en étapes ; textes sans tirets cadratins ni points
    médians de gabarit, libellés en casse normale.
- Maquette d'API locale pour contrôler les écrans connectés sans mot de passe réel :
  `docs/design/maquette-api/` (données fictives, outil de conception uniquement).
- Contrôles : `npx tsc --noEmit` et `npx next build` sans erreur.

## Décisions du gérant (16 octobre 2026)

- Modèle : une synthèse originale des captures fournies, avec le fondamental NIMOVA.
- Méthode : le gérant donne carte blanche (« travaille en toute autonomie », « ne t'arrête qu'après
  avoir tout achevé »). Pas de validation intermédiaire de planche : le design est appliqué à tous
  les écrans du périmètre, puis présenté.
- Noms affichés : NIMOVA · Finance, NIMOVA · AxisPro, NIMOVA · Rotations. La société active
  s'affiche dans le sélecteur de la coque.
- Portail des porteurs de projets : marque MB AxisPro Consulting, NIMOVA restant une marque interne.
- Nom de domaine : nimovagroup.com (voir `demandes-fonctionnelles.md`).

## Partis pris de la session design

- Icônes : un jeu dessiné pour NIMOVA, sans dépendance ; `lucide-react` retiré. C'est le seul écart
  avec le brief, qui citait lucide-react.
- Caractères : Barlow, Barlow Semi Condensed et Barlow Condensed (licence OFL), choisies pour leur
  origine (signalétique routière, plaques d'immatriculation) et leurs chiffres tabulaires.
- Logo : le N du DG redessiné, carré et verts conservés, diagonale dorée.
- Couleur de la coque : celle de la société dont on tient les livres (forêt pour EGUITRA GROUP,
  nuit pour MB AxisPro Consulting).
- Les valeurs absentes s'affichent « – » (tiret demi-cadratin) au lieu du tiret cadratin.

## En cours

- Contrôle visuel de chaque écran sur la maquette d'API, puis corrections.

## Pour la session fonctionnelle

- Voir `demandes-fonctionnelles.md` : domaine nimovagroup.com, version du cache de Rotations.
