# Guide du cabinet : AxisPro Suite

## Le tableau de bord (Cabinet > Dossiers)

L'accueil d'AxisPro montre le portefeuille : chiffres clés, entonnoir des dossiers par étape,
recommandations, puis le pilotage du cabinet. On y trouve le financement des projets (besoin,
montants sollicités et obtenus, démarches par étape), ce qu'il faut surveiller (actions en
retard, comptes rendus des porteurs à valider, risques critiques, relances des financeurs dans
les quatorze jours), la rentabilité des projets modélisés (TRI, DSCR, VAN) et la charge des
consultants. Les dossiers s'affichent en colonnes par étape (« Tableau ») ou en « Liste ».

## La méthode MB AxisPro

AxisPro Suite applique la méthode du cabinet « Project Readiness & Bankability Assessment » (réf.
MBAP/PROJECT-DEVELOPMENT/SC-01) :

- chaque critère reçoit un statut : disponible et exploitable (1 point), incomplet / à actualiser
  (0,5), non disponible (0), non applicable (exclu du calcul, ou 1 point selon la politique) ; un
  critère non encore évalué compte comme non disponible ;
- la politique peut requalifier un statut sans toucher la saisie : un critère qui exige une preuve
  (knock-out ou exigence bloquante), déclaré disponible sans pièce, est retenu « incomplet » ; une
  preuve dont la validité est dépassée aussi ;
- trois scores sur 100 : Project Readiness (toute la grille), APD Readiness (hors exigences DD,
  SPV, closing) et Bankability (critères pertinents pour la bancabilité) ; un score par domaine
  avec sa priorité (moins de 30 urgente, de 30 à 50 élevée, de 50 à 65 moyenne) ;
- un knock-out non disponible (ou incomplet, selon la politique) impose NO-GO quel que soit le
  score ;
- classification : ADVANCED / BANKABLE CANDIDATE (80), APD READY (65), CONDITIONAL GO (50), MAJOR
  GAPS / HOLD (30), CRITICAL / NO-GO ;
- chaque stage gate a sa règle de passage : recevabilité de la fiche (G0), préqualification (G1),
  préfaisabilité sans knock-out sur le foncier, le marché, le commercial et le réglementaire (G2),
  APD Readiness sans aucun knock-out (G3), Bankability et DSCR bancaire (G4), absence de red flag et
  data room exploitable (G5), accord des bailleurs et domaines SPV et Financement (G6), conditions
  levées et documentation signée (G7) ;
- la recommandation : BANKABLE CANDIDATE, APD READY, CONDITIONAL GO, HOLD ou NO-GO, « à
  compléter » tant que les critères des gates atteints ne sont pas tous évalués ;
- les écarts sont classés par priorité : un critère non disponible pèse son poids, plus 2 s'il est
  critique et 5 s'il est knock-out ; un critère incomplet, la moitié de son poids, plus 1 s'il est
  critique et 3 s'il est knock-out.

## La grille d'évaluation (Méthode > Grille d'évaluation)

La grille du cabinet (stage gates et leurs règles, domaines, critères, pièces de la data room et
leurs rattachements aux critères) est une donnée : « Classeur modèle » donne le format (onglet
Aide), « Importer une grille » charge le classeur du cabinet en nouvelle version, en brouillon.
Vérifier la version (le contrôle de cohérence signale knock-outs non critiques, pièces sans
critère, gates sans critère), régler la méthode (seuils des classes, DSCR bancaire, pondération à
plat ou par domaine, knock-out incomplet bloquant, preuve obligatoire, non applicables exclus,
péremption des preuves), les règles des gates (seuils, portée du score, domaines contrôlés), puis
« Mettre en vigueur ». Chaque modification ultérieure passe par « Nouvelle version » : un dossier
reste évalué selon la version en vigueur à son ouverture, rappelée dans chaque rapport.

Un critère peut être adossé à un indicateur du modèle financier (DSCR minimal, TRI, apport des
promoteurs, délai de récupération, point mort…) avec un seuil de satisfaction et, au besoin, un
seuil de satisfaction partielle. Dans le classeur : colonnes facultatives `indicateur`, `seuil`
et `seuil_partiel` (la feuille « Indicateurs » du classeur modèle donne les codes). Dans une
version en brouillon, la colonne « Indicateur du modèle financier » se règle aussi à l'écran.
L'évaluateur reçoit alors un statut suggéré, qu'il applique ou non.

## Les dossiers

« Nouveau dossier » : projet, promoteur, secteur, localisation, capacité, devise du dossier, date
d'évaluation, investissement, besoin de financement. La fiche du dossier comporte :

- Synthèse : « où en est le dossier » (les trois scores, la classification, la recommandation et
  son motif, le prochain gate et ses motifs), knock-outs actifs, critiques manquants, complétude
  des critères et de la data room, les actions prioritaires (livrable, responsable, échéance),
  les contrôles de cohérence (investissement de la fiche et du modèle financier, financements,
  statut saisi et statut suggéré, preuves à reprendre, décision favorable malgré un knock-out),
  les scores par domaine, la fiche projet et les hypothèses de décision des gates 4 à 7 (DSCR et
  TRI déclarés à défaut de modèle financier, red flag, data room ouverte, accord des bailleurs,
  conditions levées, documentation signée), la rentabilité et l'accès du porteur au portail.
- Évaluation : la check-list, par domaine. « Saisie guidée » ne montre que les critères des gates
  atteints, les non évalués d'abord ; « Grille complète » montre tout. Filtres : domaine, gate,
  non évalués, écarts, knock-outs, critiques, exigences bloquantes, requalifiés, avec ou sans
  preuve. Pour chaque critère : le statut, le statut retenu par la politique s'il diffère (avec la
  raison), et dans « Détails » l'étude ou le document à produire, le responsable, l'échéance,
  l'observation, les preuves (« Joindre une preuve » dépose la pièce dans la data room et la
  rattache au critère, avec sa date de validité). « Fiche d'évaluation » télécharge la fiche ;
  « Importer une fiche » la recharge (classeur, CSV ou export JSON, rapprochement par code ou par
  intitulé) après un aperçu des changements. Pour un critère adossé au modèle financier,
  l'encadré « Modèle financier » donne la valeur, le seuil et le statut suggéré.
- Stage gates : pour chaque gate, sa règle, sa décision (GO, CONDITIONAL GO, HOLD, NO-GO) et ses
  motifs, les exigences d'entrée, les livrables et les critères de passage. « Passer au gate
  suivant » suit la décision du gate courant ; le cabinet peut passer outre avec un motif, inscrit
  au journal.
- Modèle financier : voir ci-dessous.
- Risques : registre des risques du projet, matrice probabilité × impact avant et après
  traitement, mesures d'atténuation ; « Créer l'action de traitement » ajoute l'action au plan.
- Actions : plan d'actions du dossier. « Créer depuis les écarts prioritaires » transforme les
  écarts de la grille en actions du porteur ; les conditions d'un comité deviennent des actions
  dès que la décision est verrouillée. Chaque action a une échéance, un responsable (porteur ou
  cabinet) et un état ; une action du porteur visible au portail reçoit son compte rendu
  (« Déclarée faite »), que le cabinet valide.
- Financements : démarches auprès des banques, fonds et investisseurs (instrument, montants
  sollicité et accordé, taux, durée, prochaine étape, date de relance), couverture du besoin.
- Data room : les pièces standard, disponibles par un dépôt ou par la preuve d'un critère
  rattaché (l'origine est indiquée), leur date de validité, les versions, la validation ou la
  demande de reprise avec motif, la complétude ; « Pièces à fournir » imprime la liste pour le
  porteur, « Data room (.zip) » télécharge la dernière version de chaque pièce, rangée par
  rubrique, avec un sommaire. Formats acceptés : PDF, JPEG, PNG, Word .docx et Excel .xlsx,
  reconnus d'après leur contenu ; les fichiers à macros, les archives ZIP et les anciens formats
  .doc et .xls sont refusés. L'espace d'un dossier est limité à 400 pièces ou 1 Go pour les dépôts
  du porteur.
- Comités : revue avec décision (GO, CONDITIONAL GO, HOLD, NO-GO, ajourné), instance, membres,
  motif (obligatoire pour HOLD et NO-GO), conditions et compte rendu. « Enregistrer, sceller et
  verrouiller » fige la décision avec un instantané des scores et des indicateurs financiers et la
  scelle par une empreinte ; le dossier est alors figé (évaluation, fiche, hypothèses, modèle
  financier) jusqu'à « Ouvrir une nouvelle révision ». « Vérifier » contrôle l'empreinte à tout
  moment. Cocher deux revues pour les comparer (scores, gates, domaines, indicateurs financiers).
- Journal : chaque changement de statut, dépôt, validation, passage de gate, décision, révision et
  import, avec son auteur et son heure.
- Échanges : messages au porteur, ou notes internes invisibles du porteur.
- Rapport : rapport du comité en PDF (fiche, scores, gates, domaines, écarts, contrôles,
  hypothèses, modèle financier, risques, data room, décision scellée et son empreinte), classeur
  d'évaluation au plan du modèle du cabinet (Dashboard, Scoring, Gaps_Prioritaires,
  Data_Room_Index, Stage_Gate, Politique, puis modèle financier, risques et actions), export JSON,
  pièces à fournir et aperçu imprimable.
- Temps : temps passés et facture d'honoraires au taux horaire.

## Le modèle financier

On saisit les hypothèses dans les tableaux, directement dans les cases ; tout se recalcule en
quittant la case :

- Investissements : montant, année (0 = avant l'exploitation), durée d'amortissement (0 pour un
  terrain).
- Produits : volume annuel à pleine capacité, unité, prix unitaire, coût variable unitaire,
  montée en régime en pourcentage de la capacité par année (par exemple 60;80;100), croissance
  des volumes et évolution des prix.
- Coûts variables en pourcentage du chiffre d'affaires (commissions, redevances).
- Charges fixes annuelles par rubrique (services extérieurs, personnel, impôts et taxes, autres),
  avec leur évolution annuelle.
- Plan de financement : apports, emprunts (taux, durée, différé, annuités constantes ou
  amortissement constant), subventions (reprise au résultat sur leur durée).
- Paramètres : horizon, taux d'actualisation, impôt sur les sociétés, impôt minimum, années
  d'exonération, report des déficits, délais clients, stocks et fournisseurs, DSCR et apport
  exigés.

L'écran donne la VAN, le TRI du projet et des fonds propres, le DSCR minimal et moyen, le LLCR,
le délai de récupération, la marge d'EBE et le point mort, les alertes (trésorerie négative,
DSCR sous l'exigence, plan de financement déséquilibré, apport insuffisant), les comptes
prévisionnels (résultat, flux, dette, BFR), le plan de financement initial, les sensibilités
(de -20 % à +20 % sur chaque hypothèse), trois scénarios et les marges de sécurité (baisse du
prix ou des volumes supportable avant une VAN négative ou un DSCR sous 1). « Export XLSX »
donne le modèle complet.

## Plan d'actions, financements, comités, temps, pièces

« Plan d'actions » réunit les actions de tous les dossiers (filtres : ouvertes, en retard, à
valider) ; « Financements » montre les démarches par étape et les relances à venir ; « Comités »
liste les dossiers à présenter et les décisions rendues ; « Temps et facturation » récapitule les
heures par dossier ; « Pièces standard » montre la liste attendue des porteurs.
