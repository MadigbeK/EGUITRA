# Guide de NIMOVA · Analyse

## Principe

Analyse répond aux questions du dirigeant à partir des données saisies dans NIMOVA, sans rien
ressaisir et sans rien modifier. Son contenu dépend de la société choisie dans la colonne de gauche :
pour EGUITRA GROUP SARLU, la santé financière, la trésorerie, les clients, la flotte et les routes, les
dépenses et l'atterrissage de l'exercice ; pour MB AxisPro Consulting, le portefeuille de projets, leurs
faiblesses, la qualité des décisions de comité, les financements, l'activité et les honoraires du
cabinet. Un compte ouvert aux deux sociétés passe de l'une à l'autre par le sélecteur de société.

Analyse s'ouvre aux profils direction, finance et administration (groupe) et direction, cabinet et
administration (cabinet) ; la finance voit aussi l'activité et les honoraires du cabinet.

## Lire un écran

Chaque écran pose une question (« Où va la trésorerie ? ») et y répond en une phrase, calculée sur les
données de la période. Viennent ensuite l'évidence (le graphique qui justifie la réponse), puis le
détail (tableaux), puis les constats.

- **Période** : exercice en cours (défaut), 12 derniers mois, trimestre ou mois ; « Arrêté au » fixe la
  date de fin. Les comparaisons portent sur la même période un an plus tôt.
- **Qualité des données** : la pastille donne la fiabilité des chiffres de l'écran (0 à 100) et ses
  réserves (par exemple : pièces sans imputation analytique). Une analyse n'est jamais meilleure que
  la saisie : corriger les réserves améliore toutes les analyses.
- **Info-bulles** : survoler un graphique donne la valeur exacte ; les légendes masquent ou montrent une
  série.
- **Imprimer** : chaque écran s'imprime proprement pour un comité ou un conseil.

## Les constats

Un constat est un fait chiffré qui appelle une action. Il porte une gravité (critique, élevée, moyenne,
information, positif), un impact en GNF quand il se mesure, une confiance (de 0 à 100 %), une action
recommandée et un lien vers l'écran où agir. « Pourquoi ce constat ? » montre la méthode : aucune
analyse n'est une boîte noire. Le cockpit reprend les dix constats les plus importants de toutes les
sections ; un constat positif y figure toujours.

## EGUITRA GROUP

| Écran | Question | À retenir |
|---|---|---|
| Cockpit | Où en est le groupe ? | Score de santé sur cinq axes (liquidité, rentabilité, solvabilité, recouvrement, exploitation), indicateurs comparés à N-1 et au budget, cascade du chiffre d'affaires au résultat net, métiers. |
| Rentabilité | D'où vient la marge ? | Pont de l'EBE d'une année sur l'autre par activité, effets volume, prix et mix du transport ; structure des coûts (charges fixes, part variable, point mort, marge de sécurité, levier) ; budget et probabilité de dépassement ; chantiers (indice de performance des coûts, marge à terminaison) et immobilier. |
| Trésorerie et prévision | Où va la trésorerie ? | Prévision à 13 semaines avec sa fourchette (scénarios pessimiste, central, optimiste), fondée sur le délai de paiement réel de chaque client ; semaines avant le seuil de trésorerie minimale ; cycle de conversion (DSO, DPO, BFR). |
| Portefeuille clients | Quels clients font la valeur et le risque ? | Concentration (courbe de Lorenz, indice de Gini, HHI), matrice valeur × comportement de paiement, note de paiement par client, tendance des retards, pertes attendues. |
| Flotte et routes | Quelles routes et quels camions gagnent de l'argent ? | Marge par route et par mois, classement des ensembles routiers, consommations anormales, tarif de point mort et tarif cible par route, manquants. |
| Dépenses et contrôles | Où part l'argent, et qu'est-ce qui cloche ? | Dépenses par catégorie et activité, concentration des fournisseurs, dérive des prix, test de Benford sur les montants, doublons de factures, montants inhabituels. |
| Atterrissage et simulateur | Où finira l'exercice ? | Prévision du chiffre d'affaires et de l'EBE jusqu'à la fin de l'exercice, probabilité d'atteindre le budget ; simulateur : faire varier tarif, volume, carburant et masse salariale et lire l'EBE recalculé. |
| Fiabilité des données | Peut-on se fier aux chiffres ? | Onze contrôles pondérés : imputation analytique, relevés rapprochés, justificatifs, délais de saisie, brouillons anciens, comptes d'attente, tiers sans NIF, rotations non facturées. |

## MB AxisPro Consulting

| Écran | Question | À retenir |
|---|---|---|
| Cockpit | Où en est le portefeuille du cabinet ? | Dossiers actifs, besoin de financement et pipeline pondéré par la probabilité de bancabilité, entonnoir des gates, matrice de maturité (Readiness × Bankability). |
| Projets et pipeline | Où en sont les projets ? | Conversion entre gates, durée passée dans chaque gate (dossiers encore en cours compris), goulot, répartition par secteur et localisation, dossiers attendus aux gates APD et Bankability. |
| Diagnostic des projets | Quelles faiblesses reviennent d'un projet à l'autre ? | Carte des domaines par dossier, critères le plus souvent manquants (thèmes de formation ou de prestations à proposer), knock-outs, preuves et pièces manquantes, progression des scores. |
| Qualité des décisions | Les comités suivent-ils la méthode ? | Décisions par mois, accord entre recommandation de la méthode et décision du comité (kappa), passages forcés, délai jusqu'à la décision. |
| Financements | Quels financeurs, pour quels projets ? | Flux secteur → financeur → état, montants demandés et obtenus, taux de succès, ticket moyen. |
| Activité et honoraires | Le temps du cabinet est-il bien valorisé ? | Heures par consultant et par semaine, taux de réalisation (facturé / valeur du temps), rentabilité par dossier et par ligne de service, prévision des honoraires et temps non facturé. Le taux horaire de référence et le taux de revient se règlent par l'administration (paramètres `eguitra_analytics.cabinet_hourly_rate` et `eguitra_analytics.cabinet_cost_ratio`). |
| Risques et exécution | Les plans d'actions avancent-ils ? | Matrice des risques ouverts, actions en retard, vitesse d'exécution, réactivité des porteurs. |

## Bonnes pratiques

- Ouvrir le cockpit chaque lundi et traiter les constats critiques de la semaine.
- Avant un comité de direction, imprimer le cockpit et l'écran du sujet.
- Une analyse surprenante se vérifie d'un clic : le lien du constat ouvre l'écran de gestion concerné.
