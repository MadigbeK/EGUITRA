# Système de conception « terrain » de NIMOVA

Téléphone et tablette, pour l'application native **NIMOVA Terrain** (React Native avec Expo, Android
d'abord). Version du 25 octobre 2026, session design.

- Cible décidée par le gérant : application native, téléphones Android de service fournis par EGUITRA
  et gérés à distance, plus la tablette de dépôt partagée. Pas de solution d'attente dans Rotations web :
  les formulaires HSSEQ n'existent que dans NIMOVA Terrain.
- Sources : spécification HSSEQ v1.0 du 24/10/2026 (diffusion restreinte, non versée au dépôt ; les
  renvois « § 4 » désignent ses sections), contrat d'API `docs/design/hsseq-contrat.md`, analyse
  `docs/projet/mobile/analyse-application-mobile.md` (branche `claude/bold-shannon-gpg2hv`), charte
  `docs/design/CHARTE.md`, jetons du web `apps/web/app/globals.css`, application actuelle
  `apps/web/components/mobile/RotationsApp.tsx`.
- Maquettes cliquables : `maquettes.html` (même dossier). Les mesures sont en **dp** : 1 px CSS de la
  maquette vaut 1 dp. Les tailles de texte sont en dp aussi, et suivent le réglage de taille du système.

Sommaire : 1. Principes. 2. Jetons. 3. Composants. 4. Écriture. 5. Mouvement et retours.
6. Accessibilité. 7. Polices. 8. Écarts et points à trancher. 9. Maquettes. Annexe : correspondance
avec les jetons du web.

---

## 1. Principes

| Contrainte | Ce qu'elle impose |
|---|---|
| **Plein soleil** | Texte à 7:1 au moins sur son fond (seuil AAA), jamais de gris clair, filets de 1,5 à 2,5 dp, graisse 500 au moins pour lire, 600 à 700 pour agir. Un état se lit au mot et à la forme, pas à une nuance. |
| **Doigts gantés** | Cibles de 56 dp au moins, 64 dp pour l'action principale, 104 dp pour une réponse de contrôle ; 12 dp entre deux cibles voisines. Aucun geste fin : ni glisser seul, ni pincer, ni appui long sans équivalent. |
| **Une main** | L'action principale et les réponses sont dans le tiers bas, sous le pouce. Le haut de l'écran sert à lire. Le retour Android (en bas) remplace le retour en haut pour qui tient le téléphone d'une main. |
| **Réseau faible** | Tout se saisit hors réseau ; la file SQLite envoie seule quand le réseau passe. L'heure de saisie reste distincte de l'heure de réception (§ 11). Un seul geste attend le réseau : la demande de départ (verrou évalué par le serveur). |
| **Appareils d'entrée de gamme** | Écran de 360 × 640 dp au moins à tenir, mémoire limitée, vibreur faible. Pas de flou, pas d'ombre animée, transitions de 150 ms au plus sur la transformation et l'opacité ; listes virtualisées (`FlatList`). Photos ramenées à 200 Ko environ. |
| **Tablette partagée** | Session courte : changement d'utilisateur par code ou badge QR, verrouillage après 2 minutes sans geste, rien de la session précédente à l'écran. Chaque validation engageante redemande le code. |

Deux règles de la charte tiennent ici aussi : **la couleur d'un module ne dit jamais un état** (le
pétrole et la latérite servent à la marque, aux actions, à la sélection), et **un même mot garde le
même ton partout** (table `ETAT_TON` du web, complétée au § 3.6).

---

## 2. Jetons

### 2.1 Couleurs

Deux modes : **plein soleil** (par défaut, fond clair très contrasté) et **nuit de cabine** (luminance
basse pour ne pas éblouir le conducteur, mêmes contrastes). Rapports mesurés sur la surface
(`surface`), puis sur le fond quand ils diffèrent.

| Jeton | Rôle | Plein soleil | Contraste | Nuit de cabine | Contraste |
|---|---|---|---|---|---|
| `fond` | Fond de l'écran | `#e9eeeb` | | `#0a1210` | |
| `surface` | Feuilles, boutons au trait | `#ffffff` | | `#111c18` | |
| `surface2` | Bouton inactif, encadrés secondaires | `#f1f4f2` | | `#18251f` | |
| `filet` | Séparateurs | `#d3ddd7` | décor | `#26352f` | décor |
| `filetFort` | Bords de touche, bord de barre | `#b4c2ba` | décor | `#33453e` | décor |
| `trait` | Contour des champs et des boutons au trait (2 dp) | `#4f625a` | 6,5:1 | `#6f857b` | 4,4:1 |
| `encre` | Texte principal | `#0b1a16` | 17,9:1 | `#e3ebe7` | 14,4:1 |
| `encre2` | Libellés | `#1f312b` | 13,7:1 | `#c3d1ca` | 11,1:1 |
| `second` | Texte secondaire, horodatages | `#3a4a44` | 9,4:1 (8,0 sur le fond) | `#a9bbb2` | 8,7:1 |
| `ok` | Texte favorable, bord « Conforme » | `#0a5c3d` | 8,0:1 | `#7fdcb0` | 10,6:1 |
| `okPlein` / `okSur` | « Conforme » choisi, texte dessus | `#0a5c3d` / `#ffffff` | 8,0:1 | `#155a3a` / `#e6f4ec` | 7,3:1 |
| `okDoux` | Fond d'une confirmation | `#e6f6ed` | `ok` dessus 7,2:1 | `#12301f` | 8,7:1 |
| `danger` | Bord d'alerte, « Non conforme » | `#9e2420` | 7,7:1 | `#ff9d94` | 8,7:1 |
| `dangerTexte` | Texte d'alerte sur fond doux | `#8a1d1a` | 7,8:1 sur doux | `#ff9d94` | 8,0:1 sur doux |
| `dangerPlein` / `dangerSur` | « Non conforme » choisi, bouton d'appel d'urgence | `#9e2420` / `#ffffff` | 7,7:1 | `#86231f` / `#ffe9e6` | 7,9:1 |
| `dangerDoux` | Fond d'alerte | `#fde6e3` | | `#3a1715` | |
| `warn` | Texte « à surveiller » | `#6b4300` | 8,7:1 (7,7 sur doux) | `#f5c66b` | 11,0:1 |
| `warnDoux` | Fond « à surveiller » | `#fdf0d5` | | `#33270c` | |

Couleurs de module (une par application, décision du 22/10 ; HSSEQ décidé le 25/10) :

| Jeton | HSSEQ, pétrole | Rotations, latérite | Nuit : HSSEQ | Nuit : Rotations |
|---|---|---|---|---|
| `accent` (bords, icônes, segments faits) | `#0a6e86` (5,9:1) | `#b83e16` (5,6:1) | `#3fb6d1` | `#ff8a63` |
| `accentTexte` (texte à la couleur du module) | `#075668` (8,3:1) | `#983210` (7,5:1) | `#6fd0e6` (9,8:1) | `#ff9b74` (8,5:1) |
| `accentPlein` / `accentSur` (action principale) | `#075668` / `#ffffff` (8,3:1) | `#983210` / `#ffffff` (7,5:1) | `#0b4b5a` / `#e2f6fb` (8,7:1) | `#7a2a10` / `#fff1ea` (8,8:1) |
| `accentDoux` | `#e2f2f6` | `#fdebe4` | `#0c2a31` | `#35170c` |
| `accentVif` (décor seulement, 3:1) | `#14a3c2` | `#f0663f` | | |
| `entete1`, `entete2` (dégradé de l'en-tête) | `#075668`, `#063f4c` | `#983210`, `#7a2a10` | `#0b3f4c`, `#082c35` | `#5e200b`, `#3f1608` |

- L'action principale prend `accentPlein` (la couleur forte du module), jamais `accent` : le texte
  blanc y garde 7:1.
- **Jaune sécurité `#f2b705`** : le casque de l'icône HSSEQ, le marquage au sol des photos dessinées.
  Jamais en texte, jamais pour un état.
- **Or `#d3aa5b`** sur forêt : la pastille réseau quand il manque (encre `#0b1a16` dessus, 8,2:1), le
  liseré des cases de code. **Forêt `#142f29`** : écran de verrouillage de la tablette, fin du dégradé
  des en-têtes.
- **Quel module, quelle couleur** : l'écran prend la couleur du module auquel il appartient. « Ma
  journée », la saisie des rotations et la file d'envoi sont de Rotations (latérite) ; contrôle,
  alcootest, déclaration, verrou, flotte et dérogations sont d'HSSEQ (pétrole). Changer de couleur dit
  qu'on change de registre, comme le dos du registre de la charte. Les tuiles HSSEQ de « Ma journée »
  portent déjà le pétrole.

### 2.2 Caractères

Funnel Display pour les titres et les chiffres, Funnel Sans pour le reste (charte ; écart avec la
spécification au § 7). Chiffres tabulaires partout (`fontVariant: ['tabular-nums']`).

| Jeton | Police | Taille / interligne (dp) | Emploi |
|---|---|---|---|
| `chiffre` | Funnel Display 700 | 40 / 44 | Véhicule pré-rempli, chiffres d'une confirmation |
| `titreFort` | Funnel Display 700 | 30 / 34 | Libellé d'un point de contrôle, état d'un écran (« Départ bloqué ») |
| `titre` | Funnel Display 700 | 24 / 28 | Titre de bloc, registre de la tablette |
| `libelle` | Funnel Sans 700 | 19 / 23 | Réponses géantes, titres de motif, en-tête |
| `bouton` | Funnel Sans 600 | 18 / 22 | Action principale |
| `texte` | Funnel Sans 400 à 600 | 17 / 24 | Tout texte à lire : **jamais en dessous** |
| `service` | Funnel Sans 600 | 15 / 20 | Horodatages, compteurs, tampons, ligne d'état. Seul texte sous 17, toujours en 600 et à 7:1 |

Casse normale partout, pas de capitales espacées. Le système peut agrandir le texte jusqu'à 200 % :
les mises en page passent à la ligne au lieu de couper (§ 6).

### 2.3 Tailles et cibles

| Jeton | dp | Emploi |
|---|---|---|
| `cible` | 56 | Toute cible touchable : bouton secondaire, puce, filtre, ligne de liste, pastille réseau (zone de toucher), retour |
| `cibleForte` | 64 | Action principale de la barre basse, touches du pavé, boutons d'appel d'urgence |
| `choix` | 104 | Réponses « Conforme » et « Non conforme » d'un point critique |
| `tuile` | 120 | Types de déclaration |
| `declencheur` | 84 | Déclencheur de l'appareil photo |
| `ecart` | 12 | Espace minimal entre deux cibles voisines |
| `icone` | 24 (28 à 40 en tête de bloc) | Trait de 2 dp au terrain (1,5 au web), extrémités franches |

Une cible visuellement plus petite (pastille de 36 dp de haut) garde 56 dp de zone de toucher
(`hitSlop`).

### 2.4 Zones du pouce

Téléphone de 390 × 844 dp, barres système comprises (barre d'état 24 dp, navigation 48 dp).

| Zone | Où | Ce qu'on y met |
|---|---|---|
| Facile | Tiers bas : au-dessous de 563 dp, jusqu'à la barre de navigation | Action principale, réponses de contrôle, pavé numérique, déclencheur, tuile la plus fréquente |
| Étirée | Milieu | Contenu à lire, puces de défaut, choix secondaires, « Corriger » |
| Difficile | Haut et coins hauts | Titre, pastille réseau (consultation), retour en haut (rare, doublé par le retour Android) |

Tablette de 1024 × 768 dp en paysage : tenue à deux mains, les pouces atteignent les deux bandes
basses latérales ; posée sur un support, tout est atteignable. L'action principale va **en bas à
droite**, la navigation (flotte, file à traiter) dans la colonne de gauche, jamais d'action engageante
en haut au centre.

### 2.5 Espacements, rayons, traits

- Espacements (dp) : `1` 4, `2` 8, `3` 12, `4` 16, `5` 20, `6` 24, `8` 32. Gouttière de 16 au
  téléphone, 24 à la tablette ; 16 entre les blocs, 10 à 12 entre les cibles.
- Rayons : tampon 4 (charte), champ et puce 10 à 12, bouton 12, feuille 14, réponse géante 14, tuile
  16, fenêtre 20, pastille 999. Pas un seul grand rayon partout.
- Traits : filet 1,5 ; contour de champ et de bouton au trait 2 ; réponse géante et alerte 2,5 ; zone
  de photo obligatoire en tirets de 2,5.
- Ombres : seulement la barre basse (vers le haut) et les fenêtres. Aucune ombre animée.

### 2.6 Modes

- **Plein soleil** par défaut. **Nuit de cabine** proposée automatiquement après 18 h 45 et avant
  6 h 45 à Conakry (lever et coucher du soleil varient peu dans l'année), et toujours au choix dans le
  menu du compte. On suit `useColorScheme()` si le téléphone est réglé en sombre.
- En nuit de cabine : aplats d'action foncés (pas de grands blocs clairs), barres système foncées
  (`expo-status-bar`, `expo-navigation-bar`), photos sans changement.
- Option à valider au cadrage : monter la luminosité pendant un formulaire en plein soleil
  (`expo-brightness`), au prix de la batterie.

### 2.7 Transposition React Native

Un seul fichier de thème, typé, partagé par tous les écrans ; les tailles sont des nombres (dp).

```ts
// theme/terrain.ts
export const couleurs = {
  soleil: {
    fond: '#e9eeeb', surface: '#ffffff', surface2: '#f1f4f2', filet: '#d3ddd7', filetFort: '#b4c2ba', trait: '#4f625a',
    encre: '#0b1a16', encre2: '#1f312b', second: '#3a4a44',
    ok: '#0a5c3d', okPlein: '#0a5c3d', okSur: '#ffffff', okDoux: '#e6f6ed',
    danger: '#9e2420', dangerTexte: '#8a1d1a', dangerPlein: '#9e2420', dangerSur: '#ffffff', dangerDoux: '#fde6e3',
    warn: '#6b4300', warnDoux: '#fdf0d5', voile: 'rgba(11,26,22,0.55)', enteteFin: '#142f29', enteteEncre: '#ffffff',
  },
  nuit: {
    fond: '#0a1210', surface: '#111c18', surface2: '#18251f', filet: '#26352f', filetFort: '#33453e', trait: '#6f857b',
    encre: '#e3ebe7', encre2: '#c3d1ca', second: '#a9bbb2',
    ok: '#7fdcb0', okPlein: '#155a3a', okSur: '#e6f4ec', okDoux: '#12301f',
    danger: '#ff9d94', dangerTexte: '#ff9d94', dangerPlein: '#86231f', dangerSur: '#ffe9e6', dangerDoux: '#3a1715',
    warn: '#f5c66b', warnDoux: '#33270c', voile: 'rgba(0,0,0,0.65)', enteteFin: '#0a1210', enteteEncre: '#e3ebe7',
  },
} as const;

export const modules = {
  hsseq: {
    soleil: { accent: '#0a6e86', accentTexte: '#075668', accentPlein: '#075668', accentSur: '#ffffff', accentDoux: '#e2f2f6', entete: ['#075668', '#063f4c'] },
    nuit: { accent: '#3fb6d1', accentTexte: '#6fd0e6', accentPlein: '#0b4b5a', accentSur: '#e2f6fb', accentDoux: '#0c2a31', entete: ['#0b3f4c', '#082c35'] },
  },
  rotations: {
    soleil: { accent: '#b83e16', accentTexte: '#983210', accentPlein: '#983210', accentSur: '#ffffff', accentDoux: '#fdebe4', entete: ['#983210', '#7a2a10'] },
    nuit: { accent: '#ff8a63', accentTexte: '#ff9b74', accentPlein: '#7a2a10', accentSur: '#fff1ea', accentDoux: '#35170c', entete: ['#5e200b', '#3f1608'] },
  },
} as const;

export const marque = { foret: '#142f29', or: '#d3aa5b', menthe: '#a5e6c2', jauneSecurite: '#f2b705' } as const;

export const mesures = { cible: 56, cibleForte: 64, choix: 104, tuile: 120, declencheur: 84, ecart: 12, icone: 24 } as const;
export const espaces = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 } as const;
export const rayons = { tampon: 4, champ: 10, bouton: 12, feuille: 14, tuile: 16, fenetre: 20, pastille: 999 } as const;
export const traits = { filet: 1.5, champ: 2, fort: 2.5 } as const;

// Android : une famille par graisse (fontWeight ne choisit pas un fichier embarqué).
export const polices = {
  titre: 'FunnelDisplay-Bold', titreDemi: 'FunnelDisplay-SemiBold',
  texte: 'FunnelSans-Regular', texteDemi: 'FunnelSans-SemiBold', texteGras: 'FunnelSans-Bold',
} as const;

export const textes = {
  chiffre: { fontFamily: polices.titre, fontSize: 40, lineHeight: 44 },
  titreFort: { fontFamily: polices.titre, fontSize: 30, lineHeight: 34 },
  titre: { fontFamily: polices.titre, fontSize: 24, lineHeight: 28 },
  libelle: { fontFamily: polices.texteGras, fontSize: 19, lineHeight: 23 },
  bouton: { fontFamily: polices.texteDemi, fontSize: 18, lineHeight: 22 },
  texte: { fontFamily: polices.texte, fontSize: 17, lineHeight: 24 },
  service: { fontFamily: polices.texteDemi, fontSize: 15, lineHeight: 20 },
} as const;
```

Exemple d'emploi, la réponse géante d'un point de contrôle :

```ts
const s = StyleSheet.create({
  choix: {
    flex: 1, minHeight: mesures.choix, borderRadius: rayons.feuille, borderWidth: traits.fort,
    alignItems: 'center', justifyContent: 'center', gap: espaces[2],
  },
  libelleChoix: { ...textes.libelle, fontVariant: ['tabular-nums'] },
});
// Couleurs prises dans le thème actif : bord `ok` ou `danger`, aplat `okPlein` ou `dangerPlein` une fois choisi.
```

- Le thème actif (mode × module) passe par un contexte (`useTerrain()`), jamais par des couleurs écrites
  dans un écran.
- `Pressable` partout, avec `android_ripple={{ color, foreground: true }}` : l'onde part du doigt, la
  confirmation est à l'endroit du geste.
- Marges de sécurité par `react-native-safe-area-context` : Android 15 impose l'affichage bord à bord,
  la barre d'action se pose au-dessus de la barre de navigation système, l'en-tête passe sous la barre
  d'état (sa couleur la teinte).

---

## 3. Composants

Chaque composant : son rôle, ses mesures, ses états, puis ce qu'il demande au natif.

### 3.1 En-tête de terrain

- 64 dp, dégradé de marque à 135° de `entete1` à `entete2` puis forêt (exception de la charte : la
  surface de marque de Rotations, déclinée par module). Texte blanc à 7:1 au moins, parce que le
  dégradé part de la couleur forte et non de l'accent.
- **Le pli** : en tuile de 40 dp (blanc à 14 %) sur les écrans d'accueil ; en filigrane tracé au trait
  (10 % d'opacité) dans tous les en-têtes.
- Titre court en `libelle` (19, Funnel Display), sous-titre en 15 : véhicule, personne ou étape.
  Un titre ne se coupe pas : « Contrôle » et « Avant départ, CT-07 » plutôt que « Contrôle avant
  départ » tronqué.
- Sur un sous-écran, la tuile cède la place au retour (flèche, 56 dp) ; le retour Android fait la même
  chose.
- À droite : la pastille réseau (§ 3.7) ; à la tablette, le bouton de l'utilisateur (avatar, nom,
  « Changer d'utilisateur »).

### 3.2 Barre d'action basse

- Collée au bas, au-dessus de la barre de navigation Android ; fond `surface`, filet `filetFort` en
  haut, ombre vers le haut.
- Une **ligne d'état** de 20 dp (15, semi-gras) dit ce qui se passe ou pourquoi l'action attend, avec
  son icône, puis **une seule action principale** de 64 dp en `accentPlein`.
- Deux actions au plus, côte à côte (secondaire au trait à gauche, principale à droite) ; si elles ne
  tiennent pas, elles s'empilent, la principale en bas.
- États de l'action : repos ; pressé (aplat assombri, échelle 0,98, instantané) ; en cours (« Envoi… »
  et indicateur) ; fait (aplat `okPlein` et « Contrôle enregistré » pendant 1,5 s) ; inactif (fond
  `surface2`, texte `second`, toujours lisible) avec la raison dans la ligne d'état.
- Clavier ouvert : la barre cesse d'être collée et suit le contenu (`KeyboardAvoidingView`, ou
  `react-native-keyboard-controller`), pour ne jamais cacher le champ en cours (règle déjà tenue par
  Rotations web).
- Ce qui ne va jamais dans la barre : une action destructrice, « Changer la réponse », « Ce n'est pas mon
  camion ». Elles restent dans le contenu, loin du pouce qui valide.

### 3.3 Point de contrôle

- **Point critique** : un point par écran. Mention « Point critique : un défaut bloque le départ » avec
  le cadenas, libellé en `titreFort` (30), consigne courte en 17, puis deux réponses de 104 dp dans
  le tiers bas : **Non conforme** à gauche, **Conforme** à droite (sous le pouce droit). Réglage
  « main gauche » dans le menu du compte : l'ordre s'inverse.
- Forme et mot : disque coché pour « Conforme », losange barré pour « Non conforme » (les formes du
  sceau de la charte). Au repos, bouton blanc bordé à la couleur de l'état ; choisi, aplat plein.
- « Conforme » : l'aplat se remplit, vibration de sélection, point suivant aussitôt (160 ms au plus,
  sans glissement). Le point précédent reste rappelé en haut, avec « Corriger ».
- « Non conforme » : vibration d'avertissement, l'écran passe à la photo obligatoire (§ 3.4).
- **Point non bloquant** : liste courte, une ligne par point, deux réponses de 56 dp côte à côte.
- Le point « alcootest du conducteur » de la grille ne se répond jamais ici : il est relié au formulaire
  d'alcootest (`linked_to: "breath_test"`, contrat § 7) et s'affiche en statut seul dans le
  récapitulatif.
- Le récapitulatif met les non-conformités en tête, avec leur conséquence (V02) et la personne qui
  peut les lever, puis les conformes repliés.
- API : `answer` ∈ `ok`, `not_ok` ; `duration_s` mesure le temps passé ; `photo_missing` et
  `incomplete_answers` sont des refus du noyau, que l'écran empêche avant l'envoi.

### 3.4 Photo obligatoire

- Après « Non conforme » : tampon « Non conforme », puces de défauts courants (2 colonnes de 56 dp, un
  toucher), puis la **zone de photo obligatoire** : tirets `danger`, fond `dangerDoux`, appareil photo
  de 40 dp, « Photo obligatoire » ; elle ouvre l'appareil photo, comme l'action de la barre basse.
- Tant que la photo manque : ligne d'état « Photo obligatoire pour une non-conformité », action
  « Prendre la photo ». Une fois jointe : vignette, heure, poids, « Reprendre », et l'action devient
  « Continuer ».
- Appareil photo intégré (`expo-camera`, `CameraView`) : la photo ne passe pas par la galerie du
  téléphone. Déclencheur de 84 dp, lampe à gauche, fermeture en haut ; le retour Android ferme
  l'appareil photo sans rien perdre.
- Compression sur l'appareil (`expo-image-manipulator`) : côté long 1 280 px, JPEG à 0,6, 200 Ko
  environ ; fichier gardé dans le dossier de l'application (`expo-file-system`) jusqu'à l'envoi, envoyé
  après la fiche (`POST /hsseq/attachments`, puis `attachment_ids`).
- Même composant pour la levée d'une non-conformité (photo « après correction », exigée) et pour la
  déclaration (photo conseillée, bouton « Sans photo » aussi grand que les autres).

### 3.5 Progression et minuteur

- Bandeau de 52 dp sous l'en-tête : « Point 2 sur 12 », segments (7 critiques, un intervalle, 5 non
  bloquants), minuteur à droite.
- Segments : fait (`accent`), non conforme (`danger`), en cours (`encre`), à faire (`filetFort`).
- **Le minuteur mesure, il ne presse pas** : temps écoulé en 15, gris `second`, jamais de compte à
  rebours ni de rouge à 4 minutes. L'objectif de moins de 4 minutes (§ 5) est dit une fois, avant de
  commencer. La déclaration affiche aussi son temps, et le rend à la fin (« en 24 secondes »).
- `accessibilityRole="progressbar"` avec la valeur ; le minuteur n'est pas annoncé à chaque seconde.

### 3.6 Tampon d'état

Le tampon de la charte, agrandi pour le terrain : rayon 4, filet de 1,5, texte de 15 semi-gras, le mot
en toutes lettres ; plein (fond doux) pour ce qui demande une action (`warn`, `danger`), au trait pour
le reste. Un losange accompagne les alertes les plus graves (« Bloqué », « Criticité élevée »).

Mots employés au terrain, avec leur ton (ceux de la table commune ou de `components/hsseq/commun.tsx`,
sinon proposés) :

| Ton | Mots |
|---|---|
| Alerte (`danger`) | Bloqué, Bloquant, Non conforme, Refusée, Immobilisé (proposé), Criticité élevée (proposé) |
| À surveiller (`warn`) | En attente, À valider, Attente Responsable HSSEQ, Active (dérogation), Sous dérogation, Ouverte (non-conformité), À contrôler (proposé), À ouvrir (proposé) |
| Favorable (`ok`) | Autorisé, Levée, Fait (proposé), Envoyé (proposé), Aucun positif (proposé) |
| Neutre | À faire, En route (proposé), À décider (proposé), Citerne, Benne |

Un seul état vivant par écran (la pastille réseau quand une saisie attend) : il bat trois fois puis
s'arrête. Jamais dans une ligne de liste.

### 3.7 Pastille réseau et file d'envoi

- Pastille dans l'en-tête, 36 dp de haut dans une zone de toucher de 56 : « En ligne » (point vert
  d'eau, fond blanc à 15 %), « Réseau faible » ou « Hors réseau » (fond or, encre presque noire), et
  le nombre de saisies en attente dans une pastille forêt. Un toucher ouvre la file d'envoi.
- « Réseau faible » se déduit du dernier échange réel (réponse lente ou en échec), pas seulement de
  l'état du téléphone (`@react-native-community/netinfo` plus la mesure des appels, comme Rotations
  web).
- **File d'envoi** commune à toute l'application, en SQLite (`expo-sqlite`) : une table des saisies
  (`client_uuid`, formulaire, corps, `reported_at`, utilisateur, état, essais, dernier message) et une
  table des pièces (chemin, poids, état). Envoi au retour du réseau, à l'ouverture de l'application et
  en arrière-plan (`expo-background-task`), groupé par `POST /hsseq/sync` (cinquante au plus), photos
  d'abord. Un `client_uuid` déjà reçu ne crée pas de doublon.
- Chaque saisie de la file montre **ses deux heures** : « Saisi 05:44 », « Envoi : en attente » puis
  « Envoyé 06:03 ». Tampon « En attente » ou « Envoyé ».
- « Envoyer maintenant » est inactif hors réseau, avec la raison ; l'envoi automatique continue.
- Une saisie d'un autre utilisateur (tablette) reste dans la file et part avec le jeton de son auteur
  à sa prochaine session, comme dans Rotations aujourd'hui.

### 3.8 Écran de verrou

Le téléphone demande, le serveur décide (`POST /hsseq/lock/evaluate`, contrat § 9).

- **Départ bloqué** : encadré `danger` (cadenas de 40 dp, « Départ bloqué » en 30, nombre de motifs),
  puis une carte par motif : code en pastille noire (V02), titre en mots simples, précision, « Lève ce
  motif : nom, rôle » et un bouton d'appel de 56 dp. Ligne d'état : heure de la vérification et
  « Seul le bureau autorise le départ ». Action : « Vérifier à nouveau ».
- **Départ autorisé** : encadré `ok` ; les motifs levés (tampon « Levée ») et couverts par une
  dérogation (tampon « Sous dérogation », avec sa portée) restent listés. Action : « Partir : passer en
  route ».
- **Hors réseau** : encadré `warn`, « Départ non vérifié », dernière réponse du bureau avec son heure,
  jamais « autorisé » ; nouvel essai automatique.
- Titres des motifs pour le conducteur (le libellé est côté écran, contrat § 1) : V01 « Le contrôle
  avant départ n'est pas fait » ; V02 « Un point critique est non conforme » ; V03 « Alcootest : voir
  le Responsable HSSEQ » (le `detail` est nul hors du profil `hsseq`, et le mot ne dit pas si le test
  manque ou s'il est positif) ; V04 « Votre permis n'est plus valide » ; V05 « Un document du camion est
  expiré ».
- Le conducteur ne voit pas les dérogations possibles : c'est au chef de parc de les demander.
- Version tablette : la fiche du véhicule dans la flotte du jour (§ 9 des maquettes, parcours e).

### 3.9 Demande de dérogation

Contrat § 10 : une rotation, **un seul motif**, justification écrite, deux validations par deux
personnes distinctes, expiration à la fin de la rotation.

- Fenêtre de 660 dp à la tablette. « Motif à déroger, un seul par demande » : boutons radio de 64 dp
  parmi les motifs ouverts dérogeables. V01 et V03 n'ont pas de bouton : un encadré à part, cadenas,
  « Jamais dérogeables ».
- Motif écrit obligatoire, 30 caractères au moins, compteur visible sur la ligne du libellé.
- Trois règles dites avant l'envoi : pour cette seule rotation, expire à l'arrivée ; deux validations,
  la vôtre puis celle du Responsable HSSEQ ; le Directeur général est informé et la dérogation compte
  dans les indicateurs.
- La demande du chef de parc **vaut première validation**, signée par son code (« Valider ma
  demande »). État suivant : « Attente Responsable HSSEQ », avec le nom attendu.
- Seconde validation (Responsable HSSEQ) : file à gauche, demande entière à droite (motif, texte du chef
  de parc, première validation, portée, rappel V01 et V03 toujours vérifiés), « Refuser » au trait
  rouge et « Valider la dérogation » en aplat, séparés de 12 dp. Validation par code. Refus avec motif
  obligatoire (`reason_required`). Si la même personne tente la seconde validation, le refus
  `same_approver` est dit en clair : « Vous avez donné la première validation : une autre personne doit
  donner la seconde. »
- États affichés : Attente chef de parc, Attente Responsable HSSEQ, Active, Expirée, Refusée, Annulée ;
  le départ couvert passe en « Sous dérogation ».

### 3.10 Signature

- Zone de 358 × 230 dp au téléphone, ligne de base en tirets, « Signez ici avec le doigt » ; « Effacer »
  et « Signer avec mon code » en dessous ; tracé dessiné avec `react-native-svg` et le geste de
  `react-native-gesture-handler` (ou Skia), enregistré en image vectorielle légère.
- **Équivalent sans tracé** : le code personnel vaut signature (identité, heure, objet signé). C'est la
  voie normale avec des gants, et pour l'accessibilité (WCAG 2.5.7).
- À la tablette, toute validation engageante (levée, dérogation) se signe par le code.
- États : vide (action « Enregistrer » inactive, raison dans la ligne d'état), signé (heure), effacé.

### 3.11 Changement d'utilisateur (tablette partagée)

- Tablette en **mode kiosque** (gestion de flotte Android, « lock task ») : seul le bouton retour
  reste dans la barre système, et il ne quitte pas l'écran de verrouillage.
- Écran de verrouillage sur forêt : le casque HSSEQ, « Tablette du dépôt SGP Conakry », « Qui utilise
  la tablette ? » et les tuiles des habitués (128 dp : initiales sur or, nom, rôle). À droite, le code
  personnel dans **les cases du compteur** (charte) et un pavé de 64 dp ; « Scanner mon badge » ouvre
  la lecture du badge QR par la caméra avant (`expo-camera`, `barcodeScannerSettings`).
- Verrouillage après 2 minutes sans geste, préavis de 20 secondes (« La tablette se verrouille dans
  20 s. Touchez pour rester. ») ; aucune donnée de la session précédente à l'écran ; jetons de chaque
  personne dans `expo-secure-store`.
- Le badge ouvre une session ; il ne suffit pas pour valider : le code est redemandé à chaque
  validation engageante.
- Au téléphone de service, personnel : double authentification à l'inscription de l'appareil, puis code
  personnel au réveil de l'application.

### 3.12 Alertes de criticité

Criticité d'un événement = gravité potentielle × probabilité, de 1 à 25 (§ 9.1, contrat § 3).

| Niveau | Criticité | Au terrain |
|---|---|---|
| Élevée | 15 à 25 | Tampon plein « Criticité élevée », losange, valeur et calcul ; notification immédiate (push, priorité haute) au Directeur général et au Responsable HSSEQ ; écran d'alerte avec la matrice 5 × 5 et les effets automatiques |
| Significative | 8 à 14 | Tampon plein « Significative » (`warn`), triangle ; notification normale |
| Modérée | 4 à 7 | Tampon au trait, sans notification push |
| Faible | 1 à 3 | Tampon au trait |

- L'écran d'alerte liste les effets avec leur échéance et leur état, **ce qui reste à faire en premier** :
  immobilisation (V09) « À décider », arbre des causes sous 72 h « À ouvrir », donneur d'ordre sous
  24 h « À faire », Directeur général prévenu « Fait ».
- L'immobilisation est une décision, en bouton à part (« Immobiliser CT-11 », au trait rouge), jamais
  automatique.
- Au conducteur, une alerte est une **alerte flash anonymisée** (§ 9.4) : ni déclarant ni personnes en
  cause, une consigne simple (« Rampe 3 : ne reculez jamais sans guide »).
- Pour un accident déclaré, l'appel passe avant la saisie : « D'abord la sécurité », bouton « Appeler les
  secours du dépôt » (aplat `dangerPlein`, numéro paramétré par site et gardé hors réseau) et « Appeler
  le chef de parc ».

### 3.13 Saisie masquée (alcootest)

- Pavé propre à l'application (64 dp), pas de clavier système : ni suggestion, ni copie, ni historique.
- Chaque caractère s'affiche en point ; **aucun bouton pour afficher**. « Le chiffre reste masqué. Il est
  chiffré sur le téléphone, puis envoyé au seul Responsable HSSEQ. »
- La valeur ne va jamais dans SQLite : elle reste dans le coffre (`expo-secure-store`) jusqu'à l'envoi,
  puis elle est effacée. L'écran est protégé des captures et masqué dans les applications récentes
  (`expo-screen-capture`).
- Confirmation : « Alcootest fait », sans chiffre, sans « négatif », sans couleur qui le trahirait. Le
  conducteur et « Ma journée » ne lisent que « Fait ».
- Le jour où un éthylotest connecté sera choisi, l'écran devient « Lecture de l'appareil » (Bluetooth,
  module natif) et rien n'est tapé.

### 3.14 Déclaration en un geste

- Trois tuiles de 120 dp, le **plus fréquent au plus près du pouce** : Presque-accident (en bas),
  Situation dangereuse, Accident (en haut, bord rouge). Aucune gravité demandée au conducteur.
- Photo ensuite (conseillée), puis une phrase dictée (« Toucher pour dicter », toucher pour arrêter ;
  pas d'appui long obligatoire) ou tapée.
- Position relevée sans geste (`expo-location`, précision équilibrée), affichée avec sa précision ;
  sans signal, la dernière position connue avec son heure ; jamais d'attente du GPS pour envoyer.
- Une photo ou une phrase suffit pour envoyer. Objectif : moins de 30 secondes, chronométré
  discrètement.
- Véhicule en mouvement (vitesse GPS au-dessus de 10 km/h) : l'écran demande de s'arrêter.
- Dictée : la reconnaissance vocale hors ligne en français n'est pas fournie par Expo. Deux voies à
  valider au cadrage : le micro du clavier Android (paquet français hors ligne installé par la gestion
  de flotte) ou un module de reconnaissance sur l'appareil.

---

## 4. Écriture

- Français simple, phrases courtes, vouvoiement. Le bouton dit l'action avec un verbe : « Prendre la
  photo », « Lever la non-conformité », « Demander le départ », « Valider la dérogation ». Jamais « OK »
  ni « Valider » seul quand l'objet n'est pas évident.
- Un message dit ce qui s'est passé, puis ce qu'il faut faire : « Hors réseau : le contrôle partira seul
  dès que le réseau passe. Rien à refaire. »
- Jamais « (s) » : « 1 motif », « 2 motifs » (fonction `pluriel`). Typographie française : espaces
  insécables avant « : ; ? ! », guillemets « », milliers groupés (36 000 L).
- Heures en 05:44, dates en 26/10, durées en « 2 min 58 s ».
- Aucun jargon anglais affiché :

| Écrire | Ne pas écrire |
|---|---|
| presque-accident | near miss |
| situation dangereuse | unsafe condition |
| contrôle avant départ, liste de contrôle | check-list, pre-trip |
| conforme, non conforme | OK, NOK, pass, fail |
| réunion de sécurité | TBM, toolbox |
| envoyer, envoi, file d'envoi | upload, sync, queue |
| hors réseau | offline |
| code personnel | PIN |
| badge QR | QR code |
| dérogation | waiver, bypass |
| départ bloqué | locked |
| équipements de protection (EPI) | PPE |

- Les codes du verrou (V01 à V09) se montrent, pour parler le même langage au dépôt, mais jamais seuls :
  toujours avec leur phrase.
- « MB AxisPro Consulting » en entier si le cabinet est cité (il ne l'est pas au terrain).

---

## 5. Mouvement et retours

- **Aucune animation ne retarde la saisie.** Un toucher est pris aussitôt, même pendant une transition ;
  transitions de 150 ms au plus, transformation et opacité seulement ; aucune entrée orchestrée au
  terrain.
- **Confirmation à l'endroit du geste** : le bouton touché change d'aplat (onde Android au doigt), puis
  la ligne d'état juste au-dessus de la barre dit le résultat. Pas de bandeau en haut de l'écran.
- Vibrations (`expo-haptics`, ou `Vibration.vibrate` de React Native pour un motif précis) :

| Moment | Retour | Natif (Android) |
|---|---|---|
| Conforme, choix d'une puce | Court, 15 à 20 ms | `Haptics.selectionAsync()` |
| Non conforme | Double, 30-60-30 ms | `Haptics.notificationAsync(Warning)` |
| Enregistré, envoyé, session ouverte | 40 ms | `Haptics.notificationAsync(Success)` |
| Départ bloqué, refus, erreur | 60-40-60 ms | `Haptics.notificationAsync(Error)` |
| Touche du pavé | 10 ms | `Haptics.selectionAsync()` |
| Navigation | Aucun | |

  Vibreur faible sur les appareils d'entrée de gamme : à essayer sur les modèles retenus. La vibration
  double le visuel, elle ne le remplace jamais. Aucun son par défaut (dépôt bruyant).
- Un seul état vivant par écran, qui bat trois fois puis s'arrête (charte).
- Écran éveillé pendant un formulaire (`expo-keep-awake`).
- Réduction des animations demandée par le système (`AccessibilityInfo.isReduceMotionEnabled`) : plus
  aucune transition ; les vibrations restent (réglage à part dans le menu du compte).
- **Retour Android** (`BackHandler`, ou la navigation) :
  - dans un formulaire : point précédent ou écran précédent, la saisie reste en brouillon ;
  - sur « Non conforme » : la réponse est retirée, le point est à refaire ;
  - appareil photo, fenêtre : fermeture, rien n'est envoyé ;
  - après un enregistrement : retour à « Ma journée », jamais dans le formulaire envoyé ;
  - « Ma journée » : l'application passe en arrière-plan ;
  - tablette en kiosque : sans effet sur l'écran de verrouillage.
  Le retour prédictif d'Android 13 et suivants est à vérifier avec la navigation retenue.

---

## 6. Accessibilité

- Contrastes : 7:1 pour tout texte (AAA), 3:1 au moins pour les bords et les icônes utiles (4,4 à 6,5
  ici). La couleur ne porte jamais seule un état : mot, forme (disque, triangle, losange) et position.
- Cibles : 56 dp au moins, bien au-delà du minimum WCAG 2.5.8 (24) et du 2.5.5 (44).
- Taille du texte du système respectée (`allowFontScaling`), jusqu'à 200 % ; `maxFontSizeMultiplier`
  de 1,3 seulement sur les tampons et la pastille, qui doivent tenir sur une ligne. Les mises en page
  passent à la ligne, rien n'est coupé.
- Lecteur d'écran (TalkBack) : `accessibilityRole` (button, radio, progressbar, header),
  `accessibilityState` (`selected`, `checked`, `disabled`), libellés complets (« Conforme,
  pneumatiques, point 2 sur 12 »). Ligne d'état en région vivante polie (`accessibilityLiveRegion`) ;
  « Départ bloqué » et une criticité élevée annoncés aussitôt (`announceForAccessibility`).
- Ordre de lecture : titre, contenu, ligne d'état, action. Focus visible au clavier externe (3 dp).
- Pas de geste seul : la signature a son code, la dictée son champ, l'appui long n'est jamais obligatoire.
- Authentification sans épreuve de mémoire (WCAG 3.3.8) : badge QR possible à la place du code.
- Délai : le minuteur n'expire jamais ; le verrouillage de la tablette prévient 20 secondes avant.
- Lecture difficile : pictogramme et mot ensemble, consignes en trois étapes au plus. Piste pour plus
  tard : lecture à voix haute des consignes.

---

## 7. Polices : écart avec la spécification

La spécification (§ 2) ne cite que « Funnel Sans ». La charte NIMOVA, choisie par le gérant le
16 octobre, emploie **Funnel Display** pour les titres, les grands chiffres et les cases du compteur, et
**Funnel Sans** pour le texte. Recommandation : **suivre la charte**, pour que NIMOVA Terrain et le web
aient la même voix ; la spécification ne demande pas d'écarter Funnel Display, elle ne la nomme pas.

Pour le natif, **embarquer les deux polices** dans l'application (licence libre OFL), pas de chargement
par le réseau : plugin `expo-font` dans la configuration, fichiers statiques par graisse (Android ne
choisit pas une graisse dans un fichier variable embarqué) : Funnel Display SemiBold et Bold, Funnel
Sans Regular, SemiBold et Bold, soit cinq fichiers. Repli : la police du système (Roboto), sans
changement de mise en page.

---

## 8. Écarts et points à trancher

1. **Polices** : voir le § 7 (spécification : Funnel Sans seule ; charte : Display et Sans).
2. **Statut d'alcootest renvoyé au conducteur** : le contrat (§ 2) sert à tout autre profil que `hsseq`
   un statut `compliant`, `non_compliant` ou `not_done`, y compris en réponse à la saisie. Le téléphone
   du conducteur recevrait donc « non conforme » après un test positif, même si l'écran n'affiche que
   « Fait ». Proposé : pour le profil `conducteur`, une réponse sans résultat (`performed` seul).
3. **Point « alcootest négatif » des grilles** (§ 5) : il contredirait la confidentialité (§ 9.4) s'il se
   répondait dans le contrôle. Le contrat le relie au formulaire d'alcootest ; les maquettes le
   montrent en statut seul. Aligné, à garder ainsi.
4. **« Presque-accident » ou « presqu'accident »** : le terrain écrit « presque-accident » (demande du
   gérant) ; le web (`components/hsseq/commun.tsx`), le contrat et la spécification (§ 10) écrivent
   « presqu'accident ». À harmoniser sur une seule forme.
5. **« Contrôle avant départ » ou « contrôle pré-départ »** : même question ; le terrain écrit
   « avant départ », plus simple.
6. **Ton de « Élevée »** : la table commune met « Élevée » en `warn` (priorité d'une alerte), et
   `tonHsseq` la lit en premier ; la criticité élevée, niveau le plus grave, sort donc au web avec le
   même ton que « Significative ». Le terrain écrit « Criticité élevée » en `danger`. Proposé : ajouter ce
   mot composé à la table HSSEQ et l'employer au web aussi.
7. **Départs en attente du contrôle** : le verrou renvoie `allowed: false` pour toute rotation dont le
   contrôle et l'alcootest ne sont pas encore faits (V01, V03). La flotte du jour afficherait le matin
   un mur de « Bloqué ». Les maquettes écrivent « À contrôler » (`warn`) quand seuls V01 et V03 sont
   ouverts, et « Bloqué » sinon. Règle d'écran à confirmer, mot à ajouter à la table.
8. **Verrou sans réseau** : les trois formulaires marchent hors réseau (§ 11), pas la demande de
   départ, évaluée par le serveur. Il faut une procédure quand le réseau manque au dépôt (wifi du
   dépôt, ou passage en route demandé par le chef de parc depuis sa tablette). À décider.
9. **Signature par code** : avec des gants, le tracé est peu fiable ; le code personnel signe. Valeur
   de cette signature (identité, heure, objet) à confirmer par la Direction générale.
10. **V05 réunit l'assurance et la visite technique**, toutes deux dérogeables d'après la spécification.
    Rouler sans assurance engage la société ; la Direction générale peut vouloir séparer l'assurance
    (non dérogeable) de la visite technique. Non modifié ici, à trancher.
11. **Une dérogation, un motif** (contrat § 10) : la demande se fait motif par motif ; la spécification
    ne le précisait pas. Les maquettes suivent le contrat.
12. **Responsable HSSEQ au téléphone** : l'analyse le prévoit aussi au téléphone (inspections,
    contrôles inopinés) ; les maquettes ne couvrent que la tablette.
13. Les maquettes d'écrans annoncées par la spécification (« fournies séparément ») n'ont pas été
    reçues ; celles-ci couvrent le contrôle avant départ mobile, pas le cockpit ni le registre des
    risques (web).

---

## 9. Maquettes

`maquettes.html`, fichier autonome (seules les polices viennent de Google Fonts, avec repli système).
Cadres Android à l'échelle réelle : téléphone de 390 × 844 dp, tablette de 1024 × 768 dp, barre d'état
et barre de navigation comprises ; le bouton retour Android fonctionne. Menu à gauche : mode (plein
soleil ou nuit de cabine), réseau, main du pouce, échelle, et les six parcours :

| Parcours | Qui | Écrans |
|---|---|---|
| a. Contrôle avant départ | Conducteur, téléphone | Ma journée, camion pré-rempli, point critique, non conforme avec photo exigée, appareil photo, points non bloquants, récapitulatif, signature, enregistré hors réseau, file d'envoi |
| b. Alcootest | Conducteur, téléphone | Consignes, saisie masquée, « Fait » sans résultat |
| c. Déclaration en 30 secondes | Conducteur, téléphone | Type en un geste, accident (secours d'abord), photo, phrase et position, enregistrée |
| d. Verrou au départ | Conducteur, téléphone | Demander le départ, départ bloqué (V02, V05), hors réseau, départ autorisé |
| e. Flotte du jour | Chef de parc, tablette | Ouverture par code, flotte du jour, levée d'une non-conformité, demande de dérogation, changement d'utilisateur par badge |
| f. Dérogations et alertes | Responsable HSSEQ, tablette | Dérogations à valider, seconde validation par code, alerte de criticité élevée, immobilisation |

Un écran s'ouvre directement par son adresse : `maquettes.html#a4`, `maquettes.html#e2/nuit`.
Données fictives : citernes du dépôt SGP de Conakry, rotation ROT-0418 vers Kindia.

---

## Annexe : correspondance avec les jetons du web

L'identité reste commune : mêmes noms de rôle que `apps/web/app/globals.css`, valeurs renforcées pour
le plein soleil. Rotations web (`/mobile`) garde son rôle actuel ; ce tableau sert si on veut l'aligner,
et pour reconnaître un jeton d'un code à l'autre.

| Web (`globals.css`) | Valeur web | Terrain plein soleil | Terrain nuit de cabine |
|---|---|---|---|
| `--bg` | `#eef2ef` | `fond` `#e9eeeb` | `#0a1210` |
| `--panel` | `#ffffff` | `surface` `#ffffff` | `#111c18` |
| `--panel-2` | `#f5f8f6` | `surface2` `#f1f4f2` | `#18251f` |
| `--line` | `#e1e8e3` | `filet` `#d3ddd7` | `#26352f` |
| `--line-strong` | `#c4cfc8` | `filetFort` `#b4c2ba` | `#33453e` |
| `--line-champ` | `#869690` (3,1:1) | `trait` `#4f625a` (6,5:1, 2 dp) | `#6f857b` |
| `--ink` | `#10241f` | `encre` `#0b1a16` | `#e3ebe7` |
| `--ink-2` | `#344a42` | `encre2` `#1f312b` | `#c3d1ca` |
| `--muted` | `#5c6e66` (5,4:1) | `second` `#3a4a44` (9,4:1) | `#a9bbb2` |
| `--ok`, `--ok-texte` | `#0c7a52`, `#0b6b48` | `ok` `#0a5c3d` | `#7fdcb0` |
| `--ok-doux` | `#e2f5ea` | `okDoux` `#e6f6ed` | `#12301f` |
| `--danger` | `#c0302d` (5,3:1) | `danger` `#9e2420`, `dangerTexte` `#8a1d1a` | `#ff9d94` |
| `--danger-doux` | `#fde8e6` | `dangerDoux` `#fde6e3` | `#3a1715` |
| `--warn` | `#8a5700` (6,1:1) | `warn` `#6b4300` | `#f5c66b` |
| `--warn-doux` | `#fdf1d9` | `warnDoux` `#fdf0d5` | `#33270c` |
| `--accent` (`mobile`, Rotations) | `#b83e16` | `accent` `#b83e16`, `accentPlein` `#983210` | `#ff8a63`, `#7a2a10` |
| `--accent-strong` (`mobile`) | `#983210` | `accentTexte` `#983210` | `#ff9b74` |
| `--accent-doux` (`mobile`) | `#fdebe4` | `accentDoux` `#fdebe4` | `#35170c` |
| `--n-foret`, `--n-or`, `--n-menthe` | `#142f29`, `#d3aa5b`, `#a5e6c2` | `marque` | inchangés |
| `--font-display`, `--font-sans` | Funnel Display, Funnel Sans (`next/font`) | `polices` (fichiers embarqués) | |
| `--radius-lg` (panneaux) | 10 | `feuille` 14 | |
| tampon (`Badge`) | 12 px, rayon 4, filet 1 | 15 dp, rayon 4, filet 1,5 | |
| `TERRAIN` de `RotationsApp.tsx` | muted 7,8:1, champ 5,4:1, libellés de 14 | `second` 9,4:1, `trait` 6,5:1, texte de 17 | |

Pétrole d'HSSEQ pour le web, si l'application `/hsseq` le prend (décision du 25/10) :

```css
[data-app="hsseq"] {
  --accent: #0a6e86;        /* 5,9:1 sur le blanc */
  --accent-strong: #075668; /* 8,3:1, texte blanc dessus */
  --accent-haut: #0c7d98;
  --accent-vif: #14a3c2;    /* décor seulement */
  --accent-doux: #e2f2f6;
  --accent-lueur: rgb(20 163 194 / 0.35);
}
```

Si Rotations web est retouché un jour : son en-tête part de `#c4471d` (texte blanc à 4,9:1), en dessous
du 7:1 visé au terrain ; le partir de `#983210` comme ici. Ses onglets du haut (« Nouvelle », « À
envoyer », « Envoyées ») sont hors de la zone du pouce ; ses libellés de 14 px et ses boutons de 48 px
sont en dessous des jetons du terrain.
