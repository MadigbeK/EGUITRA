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
- Relecture visuelle de chaque écran sur la maquette, en grand écran et sur un téléphone de
  360 px, puis corrections (titres d'onglet, chiffres sur une ligne, étiquettes neutres, aplats,
  marque du cabinet seule côté porteur).
- Charte (`docs/design/CHARTE.md`), planche de présentation (`docs/design/planche/index.html`,
  régénérée par `node docs/design/planche/construire.mjs`) et captures de référence
  (`docs/design/captures/`, données fictives).
- Relecture indépendante du diff (logique intacte : chemins d'API, corps de requêtes et valeurs
  identiques) puis corrections : touche Entrée des boutons placés dans une ligne de tableau
  cliquable rendue à son bouton, colonnes sans titre non triables, rôles ARIA ramenés à des
  boutons à état pressé, tiroir du téléphone fermé par Échap avec retour du focus, aucune mention
  de NIMOVA dans les métadonnées du portail, titres d'onglet « page · NIMOVA Finance », tailles
  de champ de Rotations à 16 px (pas de zoom à la saisie sur iPhone).
- Contrôles : `npx tsc --noEmit` et `npx next build` sans erreur.
- Branche `claude/design-nimova` poussée sur GitHub le 16 octobre 2026 ; rien n'est déployé.

## Seconde version (16 octobre 2026, après-midi)

Le gérant a jugé la première version « fade » : il veut le langage visuel de ses captures (Vantus,
Sypher, ERP Software, « Production output ») : coloré, animé, interactif. Refonte faite dans la
même branche, sans toucher à la logique des écrans :

- Logos des deux sociétés repris de leurs sites (eguitragroup.com, mbaxisproconsulting.com),
  recadrés en versions couleur et blanche, complètes et emblèmes : `apps/web/public/brand/`,
  composant `LogoSociete` (`components/brand.tsx`). Le portail porte désormais le logo officiel
  de MB AxisPro Consulting.
- Polices : Funnel Display (titres, grands chiffres) et Funnel Sans (texte, montants), choix du
  gérant, embarquées par `next/font`.
- Thème (`app/globals.css`) : fond gris vert, panneaux blancs, une couleur par application (jade
  pour Finance, azur pour AxisPro et le portail, corail pour Rotations), gamme de six couleurs
  pour les graphiques contrôlée pour les daltoniens (outil de validation de palette), contrastes
  AA mesurés. Bibliothèque de mouvements : entrée orchestrée de chaque écran, cartes qui
  surgissent, barres qui poussent, courbes qui se tracent, repères qui glissent ; tout s'arrête
  quand le système demande de réduire les animations.
- Composants (`components/ui.tsx`) : chiffres clés en cartes avec pastille d'icône et valeur qui
  défile, puces d'état colorées, onglets et bascules à repère glissant, squelettes de chargement,
  courbes à réticule et info-bulle (souris et clavier, légende qui masque une série), colonnes en
  dégradé, anneau, jauge à aiguille, classement à barres texturées, tableaux à en-tête teinté.
- Coque (`components/shell/AppShell.tsx`) : colonne blanche à icônes, repliable, repère de page
  qui glisse, choix de la société avec les logos, fil d'Ariane, recherche d'écran (Ctrl K),
  passage d'une application à l'autre, menu du compte.
- Connexion : scène animée (le N du monogramme qui se trace, fragments des écrans qui flottent,
  camion qui roule sur sa route, logos des deux sociétés) ; portail : scène du cabinet (escalier
  de son emblème qui monte).
- Tableau de bord du dirigeant recomposé : trésorerie au compteur avec barres par compte, quatre
  chiffres clés, courbes du chiffre d'affaires et du résultat, alertes à pastilles, anneau de
  l'ancienneté des créances, jauge de couverture de la dette, indicateurs, classement des marges.
- Écrans enrichis ensuite, carte blanche du gérant : transport (volume au compteur, état de la
  flotte en segments, chiffres clés à pastilles), trésorerie (comptes en cartes, compte choisi
  en dégradé), AxisPro (chiffres clés, score en pastille), portail (étape, pièces, consultant,
  messages en bulles), Rotations (en-tête corail, état du réseau qui bat, cartes de saisie).
  Couleur du navigateur de Rotations passée au corail (`app/mobile/layout.tsx`, manifeste).
- Contrôles : `npx tsc --noEmit` et `npx next build` ; rendu vérifié sur la maquette d'API
  (grand écran et téléphone de 390 px).
- AxisPro refait à la demande du gérant (« le design d'AxisPro est laid ») : accueil en portefeuille
  (chiffres clés, entonnoir des dossiers par étape, anneau des recommandations, tableau en
  colonnes par étape avec cartes de dossier, vue liste au choix mémorisée), fiche dossier
  (bandeau azur avec anneau de score, domaines avec les seuils GO et sous conditions, écarts
  numérotés, état des critères choisi par puces colorées, échanges en bulles), comités (dossiers
  à présenter en cartes à anneau de score), temps (heures par dossier en classement), pièces
  standard (étapes numérotées).
- Coque : bascule « Finance | AxisPro » en tête de la colonne de navigation, pour passer d'un
  espace de gestion à l'autre d'un clic (comptes ouverts aux deux).
- Précaution : ne pas lancer `next build` dans `apps/web` pendant un `next dev` ; le cache
  partagé provoque une boucle de rechargement. Supprimer `apps/web/.next` avant de relancer.
- `docs/design/CHARTE.md` et la planche décrivent la première version : à refaire sur la
  seconde si le gérant la valide.

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
- Caractères : Funnel Display et Funnel Sans (licence OFL), choix du gérant pour la seconde
  version (la première utilisait Barlow).
- Logo : le N du DG redessiné, carré et verts conservés, diagonale dorée.
- Couleurs : une par application (jade Finance, azur AxisPro et portail, corail Rotations) ; la
  société de travail se reconnaît à son logo dans la colonne de navigation.
- Les valeurs absentes s'affichent « – » (tiret demi-cadratin) au lieu du tiret cadratin.

## Reste à faire

- Validation de l'ensemble par le gérant, sur la recette (http://localhost:3200 avec le tunnel)
  ou sur la planche ; ajustements éventuels dans cette branche.
- Logos repris des sites des deux sociétés : à faire confirmer par le client (fichiers vectoriels
  officiels si disponibles) ; l'icône d'onglet du portail (`public/icons/portail.svg`) reste
  typographique.

## Pour la session fonctionnelle

- Voir `demandes-fonctionnelles.md` : domaine nimovagroup.com, version du cache de Rotations.
- À la fusion : les écrans ont été retouchés pour leur seule présentation (imports d'icônes,
  libellés, classes) ; en cas de conflit avec une évolution fonctionnelle, garder la logique de
  la session fonctionnelle et réappliquer la présentation.
