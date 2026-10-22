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
- Logo, trois finalistes en situation (21 octobre) : `docs/design/logos/mise-en-situation.html`
  montre le pli (recommandé, avec un sceau réservé aux documents officiels, `sceau-pli.svg`), la
  source et le leppi dans la barre de l'application, les onglets du navigateur, l'icône du
  téléphone, l'écran de connexion et le rapport imprimé.
- Logo NIMOVA, fichiers définitifs de la piste recommandée, le pli (21 octobre) :
  `docs/design/logos/nimova/`, en SVG (nom vectorisé en Funnel Display 700, sans dépendance à la
  police) et en PNG transparents haute définition : logo horizontal (clair et inversé, 4000 px),
  logo vertical, marque seule (clair et inversé, 2048 px), icône d'application (1024, 512 et
  192 px), sceau des documents (2048 px). Remis au gérant.
- Logo intégré dans l'application (21 octobre, validé par le gérant) : `Monogramme` dessine le pli
  (seul sur fond clair, `clair` sur fond sombre, `tuile` sur son carré forêt) ; barre du haut,
  accueil, connexion (le grand N de la scène reprend le pli au trait), page d'erreur, Rotations.
  Icône d'onglet `public/icons/nimova.svg` et icônes d'installation de Rotations refaites au pli.
  Sceau (`SceauNimova`, `CachetDocument`) au pied du rapport mensuel et du rapport de dossier
  AxisPro, imprimé en couleur. Vérifié : `tsc` au vert ; `next build` non lancé en local (disque
  C: plein ce jour-là), construit sur le serveur sans erreur. En recette le 21 octobre (df60a8c,
  fusionné dans `claude/bold-shannon-gpg2hv` en 76732c4, cache de Rotations en `rotations-v3`).
  En production le 21 octobre à la demande du gérant (version 20261021-1536, 8cf57ee).
- Page de connexion (21 octobre, demande du gérant) : les cartes flottantes de la scène sont
  retirées ; le fond vert devient une photo d'équipe en salle de réunion (Pexels 9301288, licence
  Pexels gratuite, sans attribution obligatoire), assombrie pour la lecture, le grand N du pli
  toujours tracé par-dessus. Fichiers `public/scenes/` : WebP de 23 à 100 Ko selon l'écran
  (recadrage carré pour le grand écran, panoramique pour le téléphone), JPEG de secours de 112 Ko.
- Photo de connexion instantanée (22 octobre, le gérant la trouvait lente) : un aperçu flou de
  152 octets est inscrit dans la page et s'affiche au premier rendu, la photo nette le recouvre dès
  qu'elle arrive ; le fondu d'entrée (1,8 s) est supprimé, seul reste un léger recul. Fichiers
  renommés au numéro de la photo (`connexion-9301288-*`) et servis avec un cache d'un an
  (`next.config.ts`, `/scenes/*`, immuable) : aux visites suivantes, aucune requête. Taille de
  1000 px ajoutée (33 Ko) pour les écrans courants.
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

## Décisions du gérant (22 octobre 2026)

Carte blanche donnée à la session design pour les arbitrages de l'audit (« TU AS CARTE BLANCHE,
PILOTE CA »), appliquée sur la branche `claude/harmonisation-composants`.
- Analyse en or bronze au lieu du violet, rappel de la diagonale d'or du logo. Une couleur par
  application : Finance vert, AxisPro et portail bleu, Transport ambre, Rotations latérite, RH
  prune, Analyse or bronze. Jetons de `[data-app="analyse"]` : accent #86601c (5,67:1 sur le blanc,
  5,02 sur le fond), fort #6e4e15, haut #94691f (texte blanc 4,88:1), vif #b8872e (décor, 3,2:1),
  doux #f6eedd (texte accent 4,91:1) ; mode nuit : accent #e2bf74 et encre #1a1408 (10,4:1). Les
  violets écrits en dur partent aussi : icône de l'Analyse à l'accueil, teinte de l'application dans
  la coque, barre rose clair (#f3a9c9) au lieu du lilas sur le billet, événements de l'agenda du
  portail en rose. La rubrique de teinte « violet » du portail s'affiche en rose sous le nom
  « Rose » ; sa clé `violet` reste, c'est la valeur enregistrée par le noyau.
- Dégradés : aplat de la couleur de l'application partout, sauf trois surfaces de marque qui gardent
  le leur (billet de trésorerie, panneau de la page de connexion, en-tête de Rotations). La classe
  `.n-degrade` est supprimée. Boutons principaux (survol en `--accent-strong`), avatars, numéros,
  gates, pastilles et bulles de message passent en `bg-accent` (texte blanc de 5,08 à 6,96:1 selon
  l'application). Le bandeau du dossier AxisPro, le compte choisi de la trésorerie, les bandeaux
  bleu nuit du portail et la date des rendez-vous passent en `bg-accent-strong` : sur l'accent, leurs
  textes à 60-80 % de blanc et leurs pastilles translucides tombaient sous 4,5:1 ; sur l'accent fort,
  le blanc à 70 % donne 4,67:1 au moins, et les textes à 60 et 65 % montent à 75 %. Heure et auteur
  des bulles passent à 90 % de blanc. Aplats aussi pour les colonnes (`BarChart`, entonnoir du
  pipeline), les filets de la coque, le fil doré des rubriques, le fond de l'accueil, de la
  messagerie et des communications épinglées. Gardés : rubans et reflet de l'accueil (bandes nettes
  et animation), aires des courbes et éventail des prévisions (encodage des données), squelettes de
  chargement et rayures.

## Partis pris de la session design

- Icônes : un jeu dessiné pour NIMOVA, sans dépendance ; `lucide-react` retiré. C'est le seul écart
  avec le brief, qui citait lucide-react.
- Caractères : Funnel Display et Funnel Sans (licence OFL), choix du gérant pour la seconde
  version (la première utilisait Barlow).
- Logo : le N du DG redessiné, carré et verts conservés, diagonale dorée.
- Couleurs : une par application (jade Finance, azur AxisPro et portail, or bronze Analyse depuis
  le 22 octobre, corail Rotations) ; la société de travail se reconnaît à son logo dans la barre du
  haut.
- Signature : les guillochis (gravures des billets), une seule pièce maîtresse par écran (le
  billet de trésorerie au tableau de bord), tout le reste calme.
- Les valeurs absentes s'affichent « – » (tiret demi-cadratin) au lieu du tiret cadratin.

## Audit du design (22 octobre 2026)

Demandé par le gérant après la mise en production du logo. Trois passes : accessibilité (WCAG 2.2
AA), cohérence visuelle, revue des écrans sur la maquette. Corrigé :
- Accessibilité : contour de focus et jauges sur l'accent (contraste suffisant), bordure de champ
  `--line-champ` (3:1), placeholders lisibles, dégradé partant de l'accent sous le texte blanc,
  fenêtres au clavier (focus à l'ouverture, Tab maintenu, retour au déclencheur), sceaux d'état lus
  en toutes lettres, messages annoncés (`role="status"`), lien « Aller au contenu », marge de
  défilement sous la barre collante, trente champs nommés, un titre d'onglet par écran Finance et
  AxisPro, titres h1 de l'accueil et de Rotations, texte de connexion lisible sur toute la photo.
- Écrans : pluriels accordés (plus de « (s) »), recherche de l'accueil toujours visible (au toucher,
  rien ne la faisait apparaître), noms d'étape de l'entonnoir AxisPro sur deux lignes, constats de
  l'Analyse en feuille (sans liseré, pastille ni étincelle), libellés en casse normale, page
  d'erreur en « Erreur » avec le bouton commun.
- Code mort : quatre animations et douze icônes inutilisées.
- `CHARTE.md` mise à jour (logo le pli, Funnel, page de connexion, arbitrages en attente).

## Harmonisation des composants (22 octobre 2026)

Suite de l'audit, sur la branche `claude/harmonisation-composants` tirée de
`claude/bold-shannon-gpg2hv`. Présentation seulement : aucune logique métier ni aucun appel d'API ne
change. Un commit par point (deux pour l'état commun) :
- État commun : `Etat` (`components/ui.tsx`) rend le chargement, l'erreur avec « Réessayer » ou
  l'état vide, puis le contenu ; sans enfant, il sert de retour anticipé
  (`if (!data) return <Etat error={error} onRetry={() => mutate()} />`). Appliqué à 82 états :
  61 lisaient la donnée sans son erreur et restaient sur « Chargement » si l'API tombait, dont
  l'espace du porteur (une panne de `/portail/espace` bloquait tout le portail) et la cloche de
  ses notifications ; 21 affichaient l'erreur au-dessus d'une carte qui tournait encore (comités,
  temps, engagements, relances, imputations, utilisateurs, RH, transport). Les listes de choix des
  formulaires (comptes, taxes, journaux) restent vides en cas d'erreur, sans attente sans fin :
  non touchées. `ErrorBox` appelle `onRetry()` sans argument (un `mutate` passé tel quel recevait
  l'événement du clic).
- Tailles de bouton : `size` (`sm` 32 px, `md` 36 px par défaut, `lg` 44 px au toucher) remplace
  les 83 boutons dimensionnés à la main. `classesBouton()` donne la même allure à un lien : page
  d'erreur, raccourcis du tableau de bord, liens d'action du portail. `FileButton` suit `sm`/`md`.
- Surfaces : `FEUILLE` (rayon 20 px, `--ombre-feuille`, sans bordure) pour `Card`, `Kpi` et les
  blocs faits à la main (rayons de 14 à 22 px, bordure et `--ombre-carte`) ; un état porté par la
  bordure (gate en cours, échéance dépassée, envoi en erreur) passe en anneau. `PANNEAU`
  (`rounded-2xl`, soit 18 px dans ce thème, bordure, `--ombre-flottante`, marge 6 px, entrées en
  `rounded-xl`, 14 px) pour les menus de la coque,
  des rubriques, du lanceur, de l'accueil, du portail et pour `Modal` ; ceux qui étaient en
  `bg-white` suivent le thème sombre. Survols en dur (`#f2f6f3`, `#f1f6f3`, `#fafcfa`, blanc
  translucide) passés sur `panel-2`, `panel-3` et `panel`.
- Confirmations : `demanderConfirmation(question, { titre, action, danger })` ouvre la `Modal`
  commune (titre tiré de la question, « Annuler », action en rouge si destructrice) et remplace les
  31 `window.confirm`. La fenêtre prend l'application et le thème du bouton qui l'ouvre. `Modal`
  tient une pile : Échap ne ferme que la fenêtre du dessus.
- Couleurs des graphiques : `lib/couleurs.ts` tient la seule gamme (`SERIES`, réexportée par
  `ui.tsx` et `analyse/charts/commun.tsx`) et les couleurs d'état (`ETATS`, `ECHELLE`,
  `COULEUR_VERDICT`, `COULEUR_DECISION`, `COULEUR_FINANCEMENT`), sur les jetons `var(--g-*)`.
  Jetons ajoutés : `--g-jade-fonce`, `--g-jade-clair`, `--g-rouge`, `--g-bordeaux`, `--g-gris`,
  `--or-fonce`. `GAMME` est retirée. Gardés : palette du billet (fond sombre), types d'événements
  du portail, papier du bulletin.
- `Kpi` : `icon` et `teinte`, ignorées depuis la refonte, quittent sa signature et ses 62 appels
  (et `KpiContrat`). `IconTile` et `TUILE` restent : le portail, l'Analyse, le pilotage et la
  synthèse Transport s'en servent. Aucune icône retirée de `icons.tsx`.

Vérifié : `tsc --noEmit` et `next build` passent ; sur la maquette d'API, tableau de bord Finance
(gamme et états sur jetons, balance âgée, jauge du DSCR), menus de la coque et lanceur (`PANNEAU`),
erreur dans `Etat` sur les engagements (route absente de la maquette), confirmation de mise en
vigueur de la grille (titre, explication, Échap, retour du focus), confirmation posée sur la fiche
d'un chantier (Échap ne ferme qu'elle), boutons `sm` des situations (32 px), cockpit de l'Analyse.
Non vérifié à l'écran : le portail des porteurs, car la maquette ne sert pas `/portail/espace`
(réécrit depuis) ; la coque y affiche désormais l'erreur au lieu de « Préparation de votre
espace » sans fin.

## Reste à faire

- Arbitrages du gérant (audit du 22 octobre) : jargon anglais du cabinet (Readiness, Bankability,
  Data room, Pipeline) ; icônes en tête des boutons texte. L'accent de l'Analyse et les dégradés sont
  tranchés (voir les décisions du 22 octobre).
- Harmonisation des composants : faite le 22 octobre (section ci-dessus), sauf l'échelle des
  titres et des tailles de texte. Restent aussi les sceaux d'icône (`TUILE`) et les couleurs des
  types d'événements du portail, encore en hexadécimal, et les listes « Chargement des listes » et
  « Chargement des rotations » de Rotations mobile (hors `useApi`), qui attendent sans fin hors
  réseau sans cache. Maquette d'API : ajouter les routes du portail réécrit (`/portail/espace`).
- Charte d'EGUITRA GROUP (PDF confié le 21 octobre, disque E:) : à confronter aux choix faits,
  dont les logos des deux sociétés repris de leurs sites, à faire confirmer par le client.

## Pour la session fonctionnelle

- Voir `demandes-fonctionnelles.md` : domaine nimovagroup.com (le cache de Rotations est réglé).
- À la fusion : les écrans ont été retouchés pour leur seule présentation (imports d'icônes,
  libellés, classes) ; en cas de conflit avec une évolution fonctionnelle, garder la logique de
  la session fonctionnelle et réappliquer la présentation.
- Depuis l'harmonisation : un nouvel écran prend `Etat` pour ses appels d'API, `size` pour un petit
  bouton, `FEUILLE` ou `PANNEAU` pour une surface, `demanderConfirmation` au lieu de
  `window.confirm`, et ses couleurs dans `lib/couleurs.ts`. `GAMME` n'existe plus : un écran écrit
  ailleurs qui la cite passe sur `SERIES` (même ordre). `Kpi` refuse `icon` et `teinte`.
