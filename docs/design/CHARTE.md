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
- **Chiffres clés** (`Kpi`) : un filet, le libellé, la valeur, comme les « chiffres clés » d'un
  rapport annuel. Posés côte à côte, ils forment une bande de chiffres et non une grille de cartes
  identiques ; la couleur du filet reprend l'état.
- **Compteur** (`Compteur`) : un seul par écran.
- **Registre d'indicateurs** (tableau de bord) : libellé et précision à gauche, valeur à droite.
- **Répartition** (`Repartition`) : barre segmentée avec filets de séparation et légende chiffrée.
- **Colonnes** (`BarChart`) : barres fines, valeurs négatives sous la ligne de base, info-bulle au
  survol et au clavier, dernière valeur étiquetée.
- **Étapes** (`Etapes`) : les gates d'un dossier, numérotés parce qu'ils forment un parcours.
- **États** (`Badge`) : un carré de couleur et le mot ; pas de pastilles pastel.
- **Champs** : contour au trait fort, focus visible ; boutons d'envoi de fichier accessibles au
  clavier (`FileButton`).
- **Chargement** : un libellé qui dit ce qui charge, avec une barre fine, jamais un disque seul.

## Ce qui est écarté

Les signes d'une interface produite sans regard, relevés dans le guide transmis par le gérant, sont
écartés. Deux exceptions de la seconde version attendent l'arbitrage du gérant (audit du
22 octobre) : l'accent violet de l'Analyse, et les dégradés des boutons principaux et bandeaux.
Restent absents : violet et bleu par défaut ailleurs, fond blanc pur, palette arc-en-ciel, ombres partout,
grilles de cartes identiques, emoji, verre dépoli décoratif, tirets cadratins, polices par défaut,
liserés colorés à gauche des encadrés, grilles décoratives, coches vertes sur toutes les listes,
même grand arrondi partout, orbes flous, trames de points, étincelles, flèches animées, animations
au survol de tout, couleurs néon, pastels sans contraste. Les points médians de gabarit ont été
remplacés par une ponctuation française ordinaire, sauf dans les noms « NIMOVA · module » choisis
par le gérant.

La seconde version anime davantage, à la demande du gérant (entrées des écrans, compteurs, tracés
des graphiques, accueil). Aucune animation ne joue quand le système demande de les réduire.
