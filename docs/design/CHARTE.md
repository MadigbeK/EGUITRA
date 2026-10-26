# Charte de l'interface NIMOVA

Charte appliquée à l'application web (`apps/web`) en octobre 2026. Elle part du « fondamental » fixé
par le DG dans sa note de cadrage (nom, signature, palette, marque interne commune aux deux
structures) et des captures d'écran retenues par le gérant. Elle écarte les choix par défaut des
interfaces générées (voir la dernière partie).

> Mise à jour du 22 octobre 2026. Le gérant a jugé la première version « fade » le 16 octobre :
> la seconde, colorée et animée, est décrite au fil de `JOURNAL.md`. Cette charte en reprend les
> règles qui tiennent ; la marque, les caractères et la liste des choix écartés sont à jour, le
> détail des composants de la seconde version reste dans le journal.

## L'idée

Deux images tiennent l'interface, toutes deux tirées du métier du groupe.

**Le dos du registre.** Une comptabilité se tient dans des registres ; on sait quel livre on a en
main à la couleur et au titre de son dos. La colonne de gauche de NIMOVA est ce dos : vert forêt
quand on travaille dans les livres d'EGUITRA GROUP, bleu nuit dans ceux de MB AxisPro Consulting,
avec le nom de la société écrit à la verticale. Changer de société change la couleur : on ne saisit
pas une pièce dans la mauvaise comptabilité par distraction.

**Le compteur.** Le premier métier d'EGUITRA est le transport d'hydrocarbures, et les citernes se
mesurent au compteur volumétrique. Le chiffre qu'un écran met en avant (la trésorerie nette du
tableau de bord) s'affiche chiffre par chiffre, dans des cases de compteur, et ses rouleaux tournent
une seule fois à l'ouverture. Le code de double authentification reprend les mêmes cases, et les
volumes saisis dans Rotations le même dessin de chiffres.

Tout le reste se tait : fond crème, encre vert forêt, surfaces en aplat sans bordure ni ombre,
menus en texte seul.

## La marque

- **NIMOVA**, « Système intégré de gestion », signature « La maîtrise intégrée de votre
  performance. » (note du DG).
- **Logo « le pli »** (choisi par le gérant le 21 octobre 2026, en production le jour même) : un
  N fait d'un seul ruban plié, deux montants vert forêt reliés par une diagonale d'or. Fichiers
  définitifs dans `docs/design/logos/nimova/` ; dans l'application, `components/brand.tsx`
  (`Monogramme`, et `SceauNimova` / `CachetDocument` pour le sceau des rapports imprimés),
  `public/icons/nimova.svg` et les icônes de Rotations dans `public/icons/`.
- **Noms affichés** (décision du gérant, 16 octobre 2026) : NIMOVA · Finance, NIMOVA · AxisPro,
  NIMOVA · Rotations (`lib/config.ts`).
- **Portail des porteurs de projets** : marque MB AxisPro Consulting, bleu nuit, sans nom ni
  monogramme NIMOVA (marque interne). En attendant le logo officiel du cabinet, une composition
  typographique sobre ; l'icône d'onglet `public/icons/portail.svg` reprend ses initiales.
- **Page de connexion** : une photo d'équipe en réunion (Pexels 9301288, licence gratuite),
  assombrie au vert forêt pour la lecture, le grand N du pli tracé au trait par-dessus, la date du
  jour à Conakry. La photo s'affiche dès le premier rendu (aperçu flou inscrit dans la page).

## Les couleurs

Les cinq premières sont relevées dans le PDF du DG ; les suivantes en dérivent pour l'écran, avec un
contraste mesuré sur le crème (texte courant : 4,5:1 au moins).

| Nom | Valeur | Rôle | Contraste sur crème |
|---|---|---|---|
| Forêt | #142F29 | Encre, dos d'EGUITRA GROUP, couvertures | 13,6:1 |
| Pin | #22634C | Actions principales de Finance et Rotations, états favorables | 6,7:1 |
| Vert d'eau | #A5E6C2 | Monogramme, textes sur fond forêt | 10,0:1 sur forêt |
| Or | #D4AA5B | Accent rare : élément actif, vue consolidée, diagonale du monogramme | 6,6:1 sur forêt, jamais en texte sur crème |
| Crème | #FAF9F5 | Surfaces | |
| Nuit | #23364B | Dos de MB AxisPro, actions d'AxisPro et du portail | 11,7:1 |
| Brume | #EFF6F1 | Fond des pages | |
| Filet | #DAE5DD | Séparateurs | |
| Encre seconde | #2B443D | Libellés | 10,0:1 |
| Gris vert | #5B6B63 | Textes secondaires | 5,4:1 |
| Or foncé | #7D5C17 | Textes d'avertissement | 5,8:1 |
| Latérite | #A23B28 | Erreurs, retards, montants négatifs | 6,2:1 |
| Trait de champ | #869690 | Contour des champs de saisie (`--line-champ`) | 3,1:1 sur blanc (seuil des composants) |

Graphiques : une seule série par graphique, dans la couleur d'action ; l'ancienneté des créances
suit une rampe ordonnée (vert pour le non échu, puis latérite de plus en plus sombre), toujours
accompagnée d'une légende chiffrée. La couleur n'est jamais seule à porter un état : un libellé
le dit en toutes lettres.

## Les caractères

Choix du gérant (16 octobre 2026), licence libre OFL, embarquées à la construction par `next/font`
et servies par le site lui-même :

- **Funnel Display** : titres, grands chiffres, compteurs.
- **Funnel Sans** : textes, menus, champs et montants (chiffres tabulaires) ; la classe
  `font-mono` désigne ces montants alignés, sans chasse fixe.

Casse normale partout : pas de libellés en capitales espacées. Ni Inter, ni Geist, ni Space Grotesk.

## Les icônes

Jeu dessiné pour le projet (`components/icons.tsx`) : grille de 24, un seul trait de 1,5,
extrémités franches et angles vifs, comme le monogramme. Le camion est une citerne. Une icône
n'apparaît que lorsqu'elle dit quelque chose que le texte ne dit pas : bouton sans libellé (avec son
nom pour les lecteurs d'écran), état, pièce jointe. Les menus sont en texte seul.

## Les composants

`components/ui.tsx` porte l'essentiel ; les écrans gardent leur logique.

- **Surfaces** : aplats crème posés sur la brume, rayon de 10 px, sans bordure ni ombre. Seuls les
  éléments qui flottent (menus, fenêtres, info-bulles) ont une ombre.
- **Chiffres clés** (`Kpi`) : le libellé, la valeur, une précision, comme les « chiffres clés »
  d'un rapport annuel. Posés côte à côte, ils forment un registre (une seule feuille réglée) et non
  une grille de cartes identiques. Le sceau porte l'état, par la couleur et par la forme : disque
  pour conforme, triangle pour à surveiller, losange pour alerte ; pas de sceau sans état. Au pied,
  la gravure : quand une vraie série existe (`serie`), une gravure de tendance, faisceau guilloché
  dont le trait médian suit la série, dernier point marqué, en encre neutre ; c'est alors la seule
  courbe sous le chiffre. Sans série, des ondes décoratives en or, gravées une fois puis immobiles,
  jamais à la couleur de l'état. Un chiffre clé ne réagit pas au survol tant qu'il n'est pas un lien.
- **Chiffres qui défilent** (`Valeur`) : la valeur juste est rendue dès le départ (rendu serveur,
  impression, capture, lecteur d'écran). Le défilement depuis zéro part juste avant que le chiffre
  entre à l'écran, dure 700 ms au plus et ne remplace jamais une valeur juste déjà visible. D'une
  valeur à la suivante, le chiffre glisse seulement si l'écriture est la même (« 980 M » se pose
  sur « 1,02 Md » sans défiler). Rien ne défile si le système demande de réduire les animations ou
  si le navigateur économise les données.
- **Nombres** (`lib/format.ts`) : une seule écriture. Milliards en « Md », invariable, à deux
  décimales (« 1,74 Md », « 6,00 Md ») ; millions entiers à partir de 100 M (« 384 M »), à une
  décimale en dessous (« 7,0 M ») ; sous le million, l'entier groupé ; jamais de « k ». Milliers
  toujours groupés, espace insécable avant l'unité. Délais en jours à une décimale (`fmtJours`,
  « 56,5 j »), ratios à deux décimales (`fmtRatio`, « 2,90 »). Les graduations d'axe gardent les
  mêmes unités sans zéros inutiles (`fmtAxe`, « 6 Md »). Dans un tableau, le montant entier
  (`fmtInt`) et l'unité dans l'en-tête.
- **Compteur** (`Compteur`) : un seul par écran.
- **Courbes** (`AreaChart`) : une période qui n'est pas close (mois en cours, `enCours`) se trace en
  pointillé, avec un point creux, et l'info-bulle le dit ; une fin de mois partielle ne se lit pas
  comme une chute.
- **Registre d'indicateurs** (tableau de bord) : libellé et précision à gauche, valeur à droite.
- **Répartition** (`Repartition`) : barre segmentée avec filets de séparation et légende chiffrée.
- **Colonnes** (`BarChart`) : barres fines, valeurs négatives sous la ligne de base, info-bulle au
  survol et au clavier, dernière valeur étiquetée.
- **Étapes** (`Etapes`) : les gates d'un dossier, numérotés parce qu'ils forment un parcours.
- **États** (`Badge`, table `ETAT_TON` de `lib/couleurs.ts`) : un tampon, et non plus un carré de
  couleur ni une pastille pastel à point. Rayon de 4 px, filet de 1 px à la couleur de l'état, le mot
  en toutes lettres. Quatre tons : alerte (danger), à surveiller (warn), favorable (ok), neutre. Le
  tampon est plein, sur le fond doux, pour ce qui demande une action (warn, danger) ; il est au trait
  pour le reste. Un même mot garde le même ton dans toutes les applications : Critique et Bloquante
  en alerte ; Élevée à surveiller ; Moyenne et Information neutres ; Point fort favorable ;
  Brouillon et Annulée neutres ; Saisie, À valider et Non payée à surveiller ; Échue en alerte ;
  Validée, Comptabilisée, Facturée et Payée favorables. Dans Transport, une rotation validée qui
  attend sa facture s'écrit « À facturer », au trait neutre, pour ne pas se confondre avec
  « Facturée ». Un mot absent de la table s'y ajoute, au lieu de recevoir sa couleur sur place.
  **La couleur d'une application ne dit jamais un état** : elle sert à la marque, aux actions, à la
  sélection et aux graphiques. Un tampon qui reçoit encore le ton `accent` s'écrit à l'encre. Un
  état vivant (le seul de son écran : gate en cours, envoi en attente) bat trois fois, puis
  s'arrête ; jamais dans une ligne de tableau.
- **Champs** : contour au trait fort, focus visible ; boutons d'envoi de fichier accessibles au
  clavier (`FileButton`).
- **Chargement** : un libellé qui dit ce qui charge, avec une barre fine, jamais un disque seul.

## Ce qui est écarté

Les signes d'une interface produite sans regard, relevés dans le guide transmis par le gérant, sont
écartés. Une couleur par application, tranchée par le gérant le 22 octobre 2026 : Finance vert,
AxisPro et le portail bleu, Transport ambre, Rotations latérite, RH prune, Analyse or bronze (la
diagonale d'or du logo, accent #86601c, 5,67:1 sur le blanc). HSSEQ s'y ajoute le 25 octobre 2026
en pétrole, teinte 192° restée libre et qui ne dit aucun état (accent #0a6e86, 5,85:1 sous le blanc,
5,18:1 sur le fond ; vif #14a3c2 au décor seulement ; mode nuit #5cc4dc, 8:1 sur le panneau sombre),
avec le jaune sécurité #f2b705 dans ses icônes. Le violet n'apparaît plus nulle part.
Pas de dégradé de couleur : boutons principaux, avatars, numéros, colonnes, pastilles et bandeaux
sont des aplats de la couleur de l'application (`--accent`, `--accent-strong` au survol, et pour les
grandes surfaces qui portent des textes secondaires, afin que le blanc y garde 4,5:1). Trois surfaces
de marque gardent leur dégradé : le billet de trésorerie du tableau de bord, le panneau de la page de
connexion et l'en-tête de Rotations. Les couleurs vives, les animations et les guillochis restent.
Restent absents : violet, bleu par défaut hors d'AxisPro, fond blanc pur, palette arc-en-ciel, ombres partout,
grilles de cartes identiques, emoji, verre dépoli décoratif, tirets cadratins, polices par défaut,
liserés colorés à gauche des encadrés, grilles décoratives, coches vertes sur toutes les listes,
même grand arrondi partout, orbes flous, trames de points, étincelles, flèches animées, animations
au survol de tout, couleurs néon, pastels sans contraste. Les points médians de gabarit ont été
remplacés par une ponctuation française ordinaire, sauf dans les noms « NIMOVA · module » choisis
par le gérant.

La seconde version anime davantage, à la demande du gérant (entrées des écrans, compteurs, tracés
des graphiques, accueil). Aucune animation ne joue quand le système demande de les réduire.
