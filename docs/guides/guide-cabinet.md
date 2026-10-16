# Guide du cabinet : AxisPro Suite

## Le tableau de bord (Cabinet > Dossiers)

L'accueil d'AxisPro montre le portefeuille : chiffres clés, entonnoir des dossiers par étape,
recommandations, puis le pilotage du cabinet. On y trouve le financement des projets (besoin,
montants sollicités et obtenus, démarches par étape), ce qu'il faut surveiller (actions en
retard, comptes rendus des porteurs à valider, risques critiques, relances des financeurs dans
les quatorze jours), la rentabilité des projets modélisés (TRI, DSCR, VAN) et la charge des
consultants. Les dossiers s'affichent en colonnes par étape (« Tableau ») ou en « Liste ».

## La grille d'évaluation (Méthode > Grille d'évaluation)

La grille du cabinet (stage gates, domaines pondérés, critères, pièces de la data room) est une
donnée : « Classeur modèle » donne le format, « Importer une grille » charge le classeur du
cabinet en nouvelle version, en brouillon. Vérifier la version, ajuster pondérations et
criticités, puis « Mettre en vigueur ». Chaque modification ultérieure passe par « Nouvelle
version » : un dossier reste évalué selon la version en vigueur à son ouverture, rappelée dans
chaque rapport.

Un critère peut être adossé à un indicateur du modèle financier (DSCR minimal, TRI, apport des
promoteurs, délai de récupération, point mort…) avec un seuil de satisfaction et, au besoin, un
seuil de satisfaction partielle. Dans le classeur : colonnes facultatives `indicateur`, `seuil`
et `seuil_partiel` (la feuille « Indicateurs » du classeur modèle donne les codes). Dans une
version en brouillon, la colonne « Indicateur du modèle financier » se règle aussi à l'écran.
L'évaluateur reçoit alors un statut suggéré, qu'il applique ou non.

## Les dossiers

« Nouveau dossier » : projet, promoteur, secteur, localisation, capacité, investissement, besoin
de financement, hypothèses de décision. La fiche du dossier comporte :

- Synthèse : score global et par domaine, éliminatoires actifs, recommandation (GO, GO sous
  conditions, NO-GO, ou à compléter tant que le gate courant n'est pas entièrement évalué),
  rentabilité (VAN, TRI, DSCR, apport), risques et actions ouverts, les cinq écarts
  prioritaires, le passage au gate suivant et l'ouverture du portail au porteur.
- Évaluation : critères du gate, statut (satisfait, partiel, non satisfait, sans objet),
  commentaire et preuves tirées de la data room (obligatoires pour les critères qui l'exigent).
  Pour un critère adossé au modèle financier, l'encadré « Modèle financier » donne la valeur, le
  seuil et le statut suggéré ; « Appliquer » le reprend.
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
- Data room : pièces standard attendues, dépôts du cabinet ou du porteur, versions, validation
  ou demande de reprise avec motif. Formats acceptés : PDF, JPEG, PNG, Word .docx et Excel .xlsx,
  reconnus d'après leur contenu ; les fichiers à macros, les archives ZIP et les anciens formats
  .doc et .xls sont refusés. L'espace d'un dossier est limité à 400 pièces ou 1 Go pour les dépôts
  du porteur.
- Comités : revue avec décision, membres, conditions et compte rendu ; « Enregistrer et
  verrouiller » fige la décision avec un instantané du score et des indicateurs financiers ;
  cocher deux revues pour les comparer (domaines et indicateurs financiers).
- Échanges : messages au porteur, ou notes internes invisibles du porteur.
- Rapport : rapport de décision imprimable (avec le modèle financier, les principaux risques, le
  plan d'actions et les financements recherchés) et export XLSX.
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
