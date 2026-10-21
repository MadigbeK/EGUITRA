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
- Vérification complète sur la maquette (16 octobre) : 32 écrans et les 7 onglets de 8 dossiers
  AxisPro, en grand écran et sur téléphone de 360 px (aucune erreur, aucun débordement, aucune
  valeur manquante) ; connexion (erreur, code, activation), mot de passe provisoire, portail
  (message envoyé), Rotations (saisie transmise), recherche Ctrl K, repli du menu, fenêtres,
  tri, onglets, graphiques au clavier ; appels d'API identiques à l'origine dans chaque fichier.
  Corrigés : débordements sur téléphone (rapport mensuel, transport, data room, rapport de
  décision ; le champ de fichier caché sortait de son tableau). Ajoutés : page « introuvable »
  et page d'erreur aux couleurs de NIMOVA (au lieu de la page anglaise de Next.js).
- Relecture indépendante du diff (essais réels à 360 et 1280 px) puis corrections : chiffres clés
  de Ventes et Achats bloqués à 0 (le compteur ne démarrait pas si la valeur arrivait après le
  premier affichage), tuile du monogramme invisible sous 1024 px, entrée active invisible avant
  le chargement du script, trait des onglets sur plusieurs lignes, compteur de trésorerie rogné,
  double navigation dans la liste AxisPro, impression des bandeaux et des courbes, étiquettes de
  mois serrées sur téléphone, graduations d'une série nulle, focus rendu par la recherche Ctrl K
  et raccourci laissé au navigateur sur le portail, contrastes du texte blanc sur les dégradés.
- Version du cache de Rotations passée à `rotations-v2` par la session fonctionnelle (commit
  8b3e66e) : les téléphones déjà équipés reçoivent le nouveau manifeste et les nouvelles icônes.
  Toute nouvelle retouche de ces icônes ou du manifeste demandera `rotations-v3`.
- Accueil NIMOVA (`/accueil`), refait sur le modèle exact de l'accueil d'Odoo fourni par le gérant :
  fond clair aux rubans de lumière, grille d'applications sans titre ni bandeau, tuiles blanches
  portant chacune une icône illustrée en aplats de couleur dessinée pour son module
  (`components/accueil/icones-modules.tsx`, 28 icônes), libellés courts ; Finance puis AxisPro,
  Rotations et Réglages en fin ; société et compte en haut à droite ; taper au clavier ouvre la
  recherche. La racine et la connexion y mènent (aiguillage repris par la session fonctionnelle).
- Accueil en motion design, à la demande du gérant (« plus haut de gamme, animé, interactif ») :
  - icônes vivantes : chaque icône est découpée en pièces animées selon son sens (barres qui
    poussent, courbe qui se trace, cloche qui sonne, camion qui roule, aiguille du chrono, roue
    dentée, pièces qui tombent…) ; elles jouent en vague à l'arrivée, puis à chaque survol ou
    focus clavier ;
  - tuiles : entrée en vague avec rebond, inclinaison 3D sous le curseur, reflet qui suit la
    souris, enfoncement au clic ;
  - ouverture : la tuile grandit jusqu'à couvrir l'écran pendant le chargement du module ;
  - recherche : les tuiles retirées ou rendues glissent à leur nouvelle place ; les flèches du
    clavier passent d'une tuile à sa voisine ;
  - fond : rubans qui dérivent lentement et lumière qui suit le curseur.
  Tout s'arrête net avec la préférence « réduire les animations » du système. Classes
  `.tuile*`, `.ic .a-*` et `.accueil-ruban*` dans `app/globals.css`. En recette le 16 octobre
  (commit 8be3967, fusionné dans `claude/bold-shannon-gpg2hv`).
- Lanceur d'applications (17 octobre), demandé par le gérant sur le modèle de la grille de
  Microsoft 365 et de Google : dans la barre du haut de Finance et d'AxisPro, le bouton à neuf
  points ouvre un panneau des modules rangés par espace (Finance, AxisPro, Outils), avec les
  icônes de l'accueil et le module ouvert marqué. Le panneau se déploie en cercle depuis le
  bouton, les modules arrivent en vague et leurs icônes s'animent ; les points du bouton ondulent
  au survol et pivotent à l'ouverture. « Accueil NIMOVA », en pied de panneau, étend le panneau
  en plein écran avant que l'accueil fasse entrer ses tuiles. Clavier : flèches, Début, Fin,
  Échap (le focus revient au bouton) ; Tab hors du panneau ou un clic au-dehors le referment.
  Sur téléphone, le panneau occupe la largeur de l'écran. La liste des modules est commune à
  l'accueil et au lanceur (`components/accueil/tuiles.ts`) ; le lanceur est
  `components/shell/Lanceur.tsx`. En recette le 17 octobre (commit 130e7c0, fusionné dans
  `claude/bold-shannon-gpg2hv`).
- Précaution : ne pas lancer `next build` dans `apps/web` pendant un `next dev` ; le cache
  partagé provoque une boucle de rechargement. Supprimer `apps/web/.next` avant de relancer.
- NIMOVA · Analyse (18 octobre), sur la spécification `docs/projet/analyse/specification.md` :
  application `analyse` inscrite partout côté web (registre, navigation par société, bascule des
  espaces, lanceur, accueil et icônes vivantes, connexion, passerelle, garde des pages), accent
  violet, mode nuit (jetons `[data-theme="sombre"]`, bouton dans l'en-tête de chaque section),
  kit de treize graphiques SVG (`components/analyse/charts/`, géométrie d3, rendu React, info-bulles,
  légendes, clavier, tables de repli), cockpit et treize sections (`components/analyse/`), cartes de
  constats avec méthode dépliable, simulateur à curseurs, impression. Maquette d'API :
  `docs/design/maquette-api/analyse.mjs`. Vérifié sur la maquette en grand écran, en 1440 px, sur
  téléphone de 375 px et en mode nuit ; `tsc` et `next build` au vert.
- NIMOVA · Analyse, alignement sur le noyau (18 octobre, après la fusion avec `eguitra_analytics`) :
  le contrat web (`apps/web/lib/analyse-types.ts`) reprend bloc par bloc les formes réelles du noyau
  (clés, unités : parts en %, Lorenz, Gini, MAD et probabilités en fractions, cascades signées,
  sensibilités en GNF pour +1 %), les quinze écrans exploitent les blocs supplémentaires
  (`transport_effects`, `indicators`, `available`, `forecast.targets`, `maturity_thresholds`,
  `forced_summary`, `coverage`, `summary`…) et tiennent aux blocs absents, vides ou nuls (état vide,
  clés React uniques, évidences de constat normalisées quelle que soit leur forme). La maquette
  d'API est réécrite dans les mêmes formes (`analyse.mjs`, `analyse-groupe.mjs`,
  `analyse-cabinet.mjs`, `analyse-commun.mjs`). Vérifié dans le navigateur sur les réponses réelles
  de la recette (deux sociétés, exercice et 12 mois) puis sur la maquette, sans erreur de console.
- Troisième direction, « papier-valeur » (21 octobre), après la critique du gérant sur le
  tableau de bord (« identifiable IA à des kilomètres » : cartes à liseré coloré, colonne latérale,
  icônes, couleurs). La finesse des billets de banque et des titres (guillochis, sceaux, numéros de
  série) mariée à la simplicité d'Odoo :
  - plus de colonne latérale : une barre du haut à la manière d'Odoo, marque et espace (menu des
    espaces et accès à l'accueil), rubriques en menus illustrés (icône de l'accueil et une ligne
    qui dit ce qu'on y trouve pour chaque écran, pastilles des alertes et validations), fil d'or
    sous la rubrique de l'écran ouvert, pastille qui suit le curseur ; recherche, lanceur,
    équilibre de l'exercice (sceau), société et compte à droite ; sur téléphone, un tiroir des
    rubriques illustrées (`components/shell/Menus.tsx`, `AppShell.tsx`) ;
  - guillochis calculés (`components/guilloche.tsx`) : rosace d'anneaux ondulés et faisceaux de
    vagues qui se gravent au premier affichage ; un filigrane de rosace en haut de chaque écran ;
  - chiffres clés en coupons gravés : plus de liseré coloré ni de pastille d'icône, un sceau
    d'état, la valeur en grand, une gravure de vagues propre à chaque libellé dans l'encre de
    l'état ; une rangée faite seulement de chiffres clés devient un registre, une seule feuille
    réglée de filets comme une page de livre de comptes (règle CSS, sans toucher aux écrans) ;
  - feuilles sans bordure dessinée (liseré à peine visible, ombre basse), titres en Funnel
    Display, variations en texte avec un triangle ;
  - tableau de bord : la trésorerie nette devient un billet, fond forêt, rosace d'or, vagues de
    menthe, numéro de série à la date d'arrêté, barres des comptes en couleurs claires ;
  - huit icônes illustrées ajoutées pour les écrans qui n'en avaient pas (engagements, guide,
    plan comptable, utilisateurs, sociétés, axes, imputations, audit).
  Maquette d'API : le tableau de bord reçoit les champs ajoutés au noyau depuis (seuils, BFR,
  trésorerie mensuelle et prévue, décisions, questions du dirigeant, équilibre) et la route
  `/finance/shell`, avec des valeurs vraisemblables. Vérifié sur la maquette en 1440 px et sur
  téléphone (tableau de bord, ventes, trésorerie, Analyse, AxisPro, menus au clavier) ; `tsc` et
  `next build` au vert.
  En recette le 21 octobre (commit 863f064, fusionné dans `claude/bold-shannon-gpg2hv` en
  4d6881a) ; la production reste sur la version précédente jusqu'à validation du gérant.
- Maquette d'API d'AxisPro remise à niveau (21 octobre) : notation de la méthode (préparation,
  APD, bancabilité, complétude, data room, classement, porte suivante), synthèse des dossiers
  (risques, actions, devise) et fiche (données de décision, revue scellée). Les notes ne
  s'affichent plus « NaN / 100 » et la fiche d'un dossier s'ouvre. Le bandeau de la fiche porte une
  rosace guillochée à la place de l'escalier décoratif, qui chevauchait les notes.
- Pistes de logo (21 octobre), à la demande du gérant : six pistes dessinées en SVG dans
  `docs/design/logos/` (le pli, le grand livre, le sceau, le burin, le leppi, la source), chacune
  en version claire et sur fond sombre, et la planche `propositions.html` (marque seule, icône
  d'application, marque avec le nom, tenue à 48, 32 et 16 pixels). En attente du choix du gérant ;
  le monogramme actuel reste en place d'ici là.
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
- Couleurs : une par application (jade Finance, azur AxisPro et portail, violet Analyse, corail
  Rotations) ; la société de travail se reconnaît à son logo dans la barre du haut.
- Signature : les guillochis (gravures des billets), une seule pièce maîtresse par écran (le
  billet de trésorerie au tableau de bord), tout le reste calme.
- Les valeurs absentes s'affichent « – » (tiret demi-cadratin) au lieu du tiret cadratin.

## Reste à faire

- Validation de l'ensemble par le gérant, sur la recette (http://localhost:3200 avec le tunnel)
  ou sur la planche ; ajustements éventuels dans cette branche.
- Logo NIMOVA : choix d'une piste par le gérant (`docs/design/logos/propositions.html`), puis
  déclinaison (monogramme de l'application, icônes d'onglet et d'installation, écran de connexion).
- Logos repris des sites des deux sociétés : à faire confirmer par le client (fichiers vectoriels
  officiels si disponibles) ; l'icône d'onglet du portail (`public/icons/portail.svg`) reste
  typographique.

## Pour la session fonctionnelle

- Voir `demandes-fonctionnelles.md` : domaine nimovagroup.com (le cache de Rotations est réglé).
- À la fusion : les écrans ont été retouchés pour leur seule présentation (imports d'icônes,
  libellés, classes) ; en cas de conflit avec une évolution fonctionnelle, garder la logique de
  la session fonctionnelle et réappliquer la présentation.
