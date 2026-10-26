# Cahier de test : AxisPro Suite

NIMOVA · MB AxisPro Consulting, l'application du cabinet MB AxisPro Consulting.

Dossiers, évaluation par critère et par gate, compartiments, comité et décision scellée à deux,
data room, plan d'actions, financements, modèle financier, temps et honoraires, équipe et accès
des porteurs, outils du portail des porteurs.

| Rubrique {28} | À remplir {72} |
|---|---|
| Module | AxisPro Suite (NIMOVA · MB AxisPro Consulting) |
| Version de la plateforme | ______ (communiquée par E-VOLUTION XP) |
| Date du test | ______ |
| Nom du testeur | ______ |
| Fonction | ______ |
| Profil utilisé | ______ |
| Compte de test | ______ |
| Société | MB AxisPro Consulting |

Document préparé par E-VOLUTION XP le 26 octobre 2026, d'après les écrans de la plateforme à cette
date.

<!-- saut de page -->

## Mode d'emploi

Ce cahier se joue sur la recette : une copie complète de NIMOVA, avec des données fictives repérées
« Démo ». Rien de ce que vous y faites ne touche les vrais dossiers : vous pouvez tout essayer, y
compris les erreurs.

1. Se connecter. Ouvrez, dans Chrome ou Edge, l'adresse de la recette communiquée par E-VOLUTION XP
   suivie de /axispro (la direction peut aussi passer par l'accueil, tuile « Dossiers » du rayon MB
   AxisPro Consulting). Identifiant : le compte de test indiqué dans le scénario. Mot de passe : le
   mot de passe commun de la recette, communiqué par E-VOLUTION XP.
2. Deux consultants. Une décision du comité, un passage de gate forcé et la réouverture d'un dossier
   décidé engagent toujours au moins deux personnes : ces scénarios se jouent avec test.consultant
   et test.associe, deux testeurs ou deux navigateurs.
3. Jouer un scénario. Suivez les étapes dans l'ordre, avec les données indiquées. Un scénario à deux
   comptes se joue dans deux navigateurs (Chrome et Edge) ou sur deux postes. Travaillez sur le
   dossier ouvert pour le test (AXP-02), pas sur les dossiers de démonstration, sauf mention
   contraire.
4. Noter le résultat. Cochez « Réussi » si l'écran correspond au résultat attendu, sinon « Échoué ».
   Dans « Remarques », notez ce qui diffère : l'écran, le message affiché, l'heure.
5. Signaler une anomalie. Menu du compte (rond à vos initiales, en haut à droite) > « Mes demandes »
   > « Nouvelle demande », type « Remarque de recette », application NIMOVA · MB AxisPro Consulting,
   la gravité ; titre commençant par le numéro du scénario (par exemple « AXP-20 : décision non
   scellée ») ; description ; « Déposer la demande ». Reportez le numéro reçu (DEM-…) dans les
   remarques.

## Comptes de test

| Compte {20} | Profil {16} | Société {26} | Rôle dans ce cahier {38} |
|---|---|---|---|
| test.consultant | Cabinet | MB AxisPro Consulting | consultant, responsable des dossiers qu'il ouvre |
| test.associe | Cabinet | MB AxisPro Consulting | associé : second regard, compartiments, comité |
| test.dg | Direction | les deux | consultation du portefeuille |
| test.porteur | Porteur | MB AxisPro Consulting | vérification côté portail |
| test.daf | Finance | les deux | refus, facture d'honoraires |

Données fictives utiles : dossiers « Usine de briques compressées (démo) » (promoteur « Démo -
Briqueterie de Kindia SARL ») et « Unité de séchage de mangues (démo) » (promoteur « Démo - Vergers
de Mamou SA », suivi au portail par test.porteur).

## A. Consultant du cabinet

### AXP-01. Lire le portefeuille des dossiers

Objectif : vérifier que l'accueil donne l'état du portefeuille et des recommandations.

Compte : test.consultant.

Données : aucune.

1. Ouvrez NIMOVA · MB AxisPro Consulting : la page « Dossiers de projets » s'affiche.
2. Lisez la grille en vigueur (« Évaluation selon … »), les chiffres clés, l'« Entonnoir des dossiers
   par étape » et les « Recommandations ».
3. Passez de « Tableau » à « Liste ».

Résultat attendu : les dossiers apparaissent par étape (« Tableau ») ou en lignes (« Liste ») avec
leurs scores, leur prochain gate et leur besoin de financement.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-02. Ouvrir un dossier

Objectif : vérifier l'ouverture d'un dossier, sa référence et son responsable.

Compte : test.consultant.

Données : projet « Unité de transformation de manioc (essai) » ; promoteur « Essai Agro Forécariah
SARL » (à créer depuis le champ) ; secteur agro-industrie ; localisation Forécariah ; devise GNF ;
investissement 4 500 000 000 ; besoin de financement 3 000 000 000.

1. Cliquez sur « Nouveau dossier ». La fenêtre « Ouverture d'un dossier » s'ouvre.
2. Remplissez « Projet », « Promoteur », « Secteur », « Localisation », « Devise du dossier »,
   « Date d'évaluation », l'investissement prévu et le besoin de financement.
3. Cliquez sur « Ouvrir le dossier ».
4. Dans l'onglet « Synthèse », lisez le cadre « Équipe et accès du porteur au portail ».

Résultat attendu : le dossier reçoit une référence AX/… et s'ouvre sur l'onglet « Synthèse ». Les
onglets sont « Synthèse », « Évaluation », « Stage gates », « Modèle financier », « Risques »,
« Actions », « Financements », « Data room », « Comités », « Journal », « Échanges », « Rapport » et
« Temps ». Le cadre indique « Responsable du dossier : Test - Consultant du cabinet » et « Aucun
accès ouvert. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-03. Évaluer les critères en saisie guidée

Objectif : vérifier l'évaluation des critères et le recalcul des scores.

Compte : test.consultant.

Données : le dossier de AXP-02 ; cinq critères du premier gate.

1. Ouvrez l'onglet « Évaluation ». Le mode « Saisie guidée » montre les critères des gates atteints,
   les non évalués d'abord.
2. Donnez un statut à cinq critères : « Disponible », « Incomplet », « Non disponible », « Non
   applicable ».
3. Ouvrez « Détails, preuves et suivi » d'un critère : remplissez l'étude ou le document à produire,
   le responsable, l'échéance et l'observation.
4. Revenez à l'en-tête du dossier.

Résultat attendu : chaque statut s'enregistre aussitôt, avec « Dernière évaluation : Test -
Consultant du cabinet, le … ». Les scores de l'en-tête (Readiness, APD, Bankability) sont
recalculés ; le nombre de critères évalués augmente.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-04. Joindre la preuve d'un knock-out

Objectif : vérifier qu'un critère à preuve exigée, déclaré disponible sans pièce, est retenu
incomplet, puis disponible une fois la preuve jointe.

Compte : test.consultant.

Données : un critère marqué « Knock-out » et « Preuve exigée » ; une preuve en PDF valable jusqu'à la
fin de l'année prochaine.

1. Filtrez la check-list sur « Knock-outs ».
2. Déclarez un knock-out « Disponible » sans pièce. Lisez l'encadré sous la ligne.
3. Ouvrez « Détails, preuves et suivi », choisissez la date de « Validité », puis « Joindre une
   preuve » et le PDF.
4. Ouvrez l'onglet « Data room ».

Résultat attendu : à l'étape 2, l'encadré indique « Retenu incomplet / à actualiser par la politique :
… », la saisie restant « Disponible ». À l'étape 3, « Preuve « … » rattachée à … » ; le critère est
retenu disponible et porte « 1 preuve ». La pièce rattachée apparaît disponible dans la data room.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-05. Exporter et réimporter la fiche d'évaluation

Objectif : vérifier l'export de la fiche, sa modification hors ligne et son réimport avec aperçu.

Compte : test.consultant.

Données : le dossier de AXP-02 ; deux statuts modifiés dans le classeur.

1. Onglet « Évaluation », « Fiche d'évaluation » : le classeur se télécharge.
2. Dans Excel, changez le statut de deux critères ; enregistrez.
3. « Importer une fiche », choisissez le classeur.
4. Lisez l'aperçu des changements (colonnes « Critère », « Avant », « Après »), puis « Appliquer 2
   modifications ».

Résultat attendu : l'aperçu ne liste que les deux critères modifiés. Après application, « Fiche
d'évaluation importée : 2 critères mis à jour. ». Une fiche identique à l'évaluation affiche
« Aucune modification : la fiche correspond déjà à l'évaluation du dossier. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-06. Lire les stage gates

Objectif : vérifier la décision de chaque gate et le passage au gate suivant selon sa règle.

Compte : test.consultant.

Données : le dossier de AXP-02.

1. Ouvrez l'onglet « Stage gates ». Lisez le « Parcours du dossier » et, pour le gate en cours, sa
   décision, ses « Exigences d'entrée », ses « Livrables attendus » et ses « Critères de passage ».
2. Cliquez sur « Passer au gate suivant ».
3. Si la fenêtre « Passage contre la règle du gate » s'ouvre, lisez les motifs, puis « Annuler ».

Résultat attendu : chaque gate affiche GO, CONDITIONAL GO, HOLD ou NO-GO et ses motifs ; sous la
complétude minimale, le gate reste en HOLD. Un passage permis affiche « Le dossier passe au gate
suivant. ». Un passage contraire à la règle ouvre la fenêtre, qui demande un motif pour forcer
(AXP-19) ; « Annuler » ne change rien.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-07. Modifier une hypothèse du modèle financier

Objectif : vérifier que le modèle se recalcule en quittant une case.

Compte : test.consultant.

Données : le dossier « Usine de briques compressées (démo) » ; prix unitaire augmenté de 10 %.

1. Ouvrez l'onglet « Modèle financier ». Notez « VAN du projet », « TRI du projet » et le DSCR
   minimal.
2. Dans le tableau des produits, modifiez « Prix unitaire », puis cliquez ailleurs (ou Entrée).
3. Relisez les indicateurs, puis cliquez sur « Export XLSX ».

Résultat attendu : la VAN, le TRI et le DSCR changent dès la sortie de la case. Échap reprend la
valeur enregistrée. Le classeur exporté reprend les hypothèses et les comptes prévisionnels.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-08. Tenir le registre des risques

Objectif : vérifier l'ajout d'un risque, sa place dans la matrice et son action de traitement.

Compte : test.consultant.

Données : risque « Retard de livraison des presses (essai) » ; probabilité et impact élevés ;
traitement confié au porteur.

1. Onglet « Risques », cadre « Nouveau risque » : remplissez « Risque », « Catégorie »,
   « Responsable du traitement », « Probabilité », « Impact » et « Mesures d'atténuation », puis
   « Enregistrer ».
2. Repérez le risque dans la « Matrice probabilité × impact ».
3. Ouvrez le risque, renseignez « Probabilité après traitement » et « Impact après traitement »,
   puis cliquez sur « Créer l'action de traitement ». Lisez la fenêtre, puis « Créer l'action ».
4. Ouvrez l'onglet « Actions ».

Résultat attendu : le risque figure au registre avec sa criticité avant et après traitement. La
fenêtre prévient que l'action, confiée au porteur, lui sera notifiée sur le portail. L'action
apparaît dans le plan d'actions du dossier.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-09. Construire le plan d'actions

Objectif : vérifier la création des actions et la validation du compte rendu d'un porteur.

Compte : test.consultant (puis test.porteur au portail).

Données : le dossier « Unité de séchage de mangues (démo) » ; action « Fournir les devis des presses
(essai) », confiée au porteur, échéance dans quinze jours.

1. Onglet « Actions », « Créer depuis les écarts prioritaires ».
2. Cadre « Nouvelle action » : « Action », « Confiée à » (porteur), « Échéance », « Détail attendu »,
   puis « Ajouter ».
3. test.porteur déclare l'action faite au portail (cahier du portail, POR-07).
4. test.consultant : sur l'action déclarée faite, lisez « Compte rendu du porteur : », puis
   « Valider ».

Résultat attendu : « … actions créées depuis les écarts prioritaires. », puis « Action ajoutée. ».
L'action du porteur passe dans les actions déclarées faites, à valider, puis validée avec sa date et
son auteur.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-10. Suivre une démarche de financement

Objectif : vérifier l'enregistrement d'une démarche auprès d'un financeur et sa relance.

Compte : test.consultant.

Données : financeur « Banque d'essai de Guinée » (à créer depuis le champ) ; instrument prêt ; montant
sollicité 2 000 000 000 ; date de relance dans dix jours.

1. Onglet « Financements », cadre « Nouvelle démarche ».
2. Remplissez « Financeur (banque, fonds, investisseur) », « Instrument », « Montant sollicité »,
   la prochaine étape et la « Date de relance », puis « Enregistrer ».
3. Ouvrez Cabinet > Financements.

Résultat attendu : la démarche figure dans le dossier avec la couverture du besoin ; la page
Financements la montre par étape et dans les prochaines relances.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-11. Valider une pièce et en faire reprendre une autre

Objectif : vérifier la revue des pièces de la data room et le motif transmis au porteur.

Compte : test.consultant.

Données : le dossier « Unité de séchage de mangues (démo) », avec deux pièces reçues du porteur (au
besoin, faites-les déposer par test.porteur, POR-04) ; motif « Bilan non signé : merci de déposer la
version signée. ».

1. Onglet « Data room », cadre « Pièces standard ». Sur une pièce reçue, cliquez sur « Valider ».
2. Sur l'autre pièce, cliquez sur « À reprendre ». La fenêtre « Reprise de « … » » s'ouvre.
3. Regardez le bouton « Demander la reprise » tant que le motif est vide, puis saisissez le motif dans
   « Motif de la reprise, lu par le porteur au portail » et cliquez sur « Demander la reprise ».
4. Cliquez sur « Pièces à fournir », puis sur « Data room (.zip) ».

Résultat attendu : « … validée. » pour la première pièce. « Demander la reprise » reste grisé sans
motif ; ensuite, « … : reprise demandée au porteur. », la pièce est comptée « À reprendre » et le
porteur lit le motif au portail. « Pièces à fournir » donne la liste imprimable ; l'archive contient
la dernière version de chaque pièce, rangée par rubrique, avec un sommaire.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-12. Écrire au porteur et noter en interne

Objectif : vérifier que les notes internes restent invisibles du porteur.

Compte : test.consultant, puis test.porteur.

Données : le dossier « Unité de séchage de mangues (démo) » ; message « Merci pour vos pièces (essai
AXP-12). » ; note interne « Vérifier la marge du distributeur (note interne, essai). ».

1. Onglet « Échanges » : écrivez le message dans « Message au porteur », puis « Envoyer ».
2. Cochez « Note interne au cabinet », écrivez la note, puis « Envoyer ».
3. test.porteur : ouvrez « Messages » au portail.

Résultat attendu : « Message envoyé au porteur. », puis « Note interne enregistrée. ». Les deux écrits
figurent dans les échanges du dossier, la note marquée comme interne. Le porteur lit le message,
jamais la note.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-13. Ouvrir puis retirer l'accès d'un porteur au portail

Objectif : vérifier l'ouverture du portail à un porteur, le contrôle de l'identifiant et le retrait
de l'accès, avec confirmation.

Compte : test.consultant.

Données : le dossier de AXP-02 ; identifiant « essai.porteur.manioc » ; nom « Essai Porteur Manioc » ;
un mot de passe provisoire d'essai de votre choix, de 10 caractères au moins ; puis l'identifiant
« test.porteur ».

1. Onglet « Synthèse », cadre « Équipe et accès du porteur au portail ». Saisissez « test.porteur »
   comme identifiant, un nom, puis « Ouvrir l'accès ».
2. Saisissez l'identifiant « essai.porteur.manioc », le « Nom du porteur » et un mot de passe
   provisoire de 8 caractères : regardez le message et le bouton.
3. Complétez le mot de passe à 10 caractères au moins, puis « Ouvrir l'accès ».
4. En face du porteur ajouté, cliquez sur « Retirer l'accès ». Lisez la fenêtre « Retirer l'accès au
   portail », puis « Annuler ».
5. Recommencez et confirmez par « Retirer l'accès ».
6. Ouvrez l'onglet « Journal ».

Résultat attendu : à l'étape 1, l'accès est refusé : le compte « test.porteur » suit déjà le dossier
d'un autre promoteur, et un compte porteur ne sert qu'un promoteur. À l'étape 2, « 10 caractères au
moins. » et « Ouvrir l'accès » grisé. À l'étape 3, « Accès au portail ouvert : le porteur remplacera
ce mot de passe provisoire à sa première connexion. ». La fenêtre de l'étape 4 précise que le porteur
ne verra plus le dossier et que son compte est désactivé s'il ne suit plus aucun dossier ; « Annuler »
ne change rien. À l'étape 5, « Accès de Essai Porteur Manioc retiré. » et « Aucun accès ouvert. ». Le
journal garde l'ouverture et le retrait.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-14. Saisir du temps et facturer les honoraires

Objectif : vérifier la saisie des temps et la facture d'honoraires dans la comptabilité du cabinet.

Compte : test.consultant, puis test.daf.

Données : le dossier de AXP-02 ; 3,5 heures « Analyse du plan d'affaires (essai) » ; taux horaire HT
500 000.

1. Onglet « Temps », « Saisir du temps » : « Date des travaux », « Heures », « Travaux réalisés »,
   puis « Enregistrer ».
2. Cliquez sur « Facturer les honoraires (3,5 h non facturées) ». Saisissez le « Taux horaire HT
   (GNF) », puis « Créer la facture ».
3. test.daf : Finance, société MB AxisPro Consulting, Comptabilité > Ventes, vue « Brouillons ».

Résultat attendu : « Temps enregistré. », puis « Facture d'honoraires créée en brouillon (… TTC), à
valider dans Finance. ». Le temps passe de « À facturer » à la facture. La facture figure en
brouillon dans les ventes de MB AxisPro Consulting, jamais dans celles d'EGUITRA GROUP SARLU.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-15. Télécharger le rapport et les exports

Objectif : vérifier les documents du dossier pour le comité.

Compte : test.consultant.

Données : le dossier « Usine de briques compressées (démo) ».

1. Onglet « Rapport ». Cliquez sur « Rapport du comité (PDF) ».
2. Cliquez sur « Classeur d'évaluation », puis sur « Pièces à fournir (PDF) ».
3. Cliquez sur « Imprimer l'aperçu ».

Résultat attendu : le rapport reprend la fiche, les scores, les gates, les écarts prioritaires, les
contrôles, le modèle financier, les risques et la data room. Le classeur suit le plan du modèle du
cabinet. Chaque document rappelle la version de la grille.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-16. Préparer une nouvelle version de la grille

Objectif : vérifier qu'une modification de la grille passe par une nouvelle version en brouillon, et
que sa mise en vigueur est confirmée.

Compte : test.consultant. Ne confirmez pas la mise en vigueur sans l'accord du cabinet : elle
s'applique à tous les dossiers ouverts ensuite.

Données : la grille en vigueur.

1. Ouvrez Méthode > Grille d'évaluation. Lisez « Versions » et la version « En vigueur ».
2. Cliquez sur « Nouvelle version ».
3. Dans « Domaines et critères », modifiez l'aide d'un critère.
4. Cliquez sur « Mettre en vigueur », lisez la fenêtre, puis « Annuler ».

Résultat attendu : à l'étape 2, « Nouvelle version créée en brouillon : ajustez-la puis mettez-la en
vigueur. ». La version en vigueur, elle, ne se modifie pas (« Cette version n'est plus modifiable. …
créez une nouvelle version. »). La fenêtre de mise en vigueur précise que la version actuelle sera
archivée et que les dossiers ouverts gardent leur version ; « Annuler » ne change rien.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-17. Suspendre, reprendre et clore un dossier

Objectif : vérifier les états du dossier et leur confirmation.

Compte : test.consultant.

Données : un dossier ouvert pour l'essai (comme en AXP-02, autre que celui des scénarios suivants).

1. Dans l'en-tête du dossier, à côté de « État du dossier : En cours », cliquez sur « Suspendre ».
   Lisez la fenêtre, puis confirmez.
2. Cliquez sur « Reprendre », confirmez.
3. Cliquez sur « Clore le dossier ». Lisez la fenêtre, puis confirmez.
4. Ouvrez l'onglet « Évaluation », puis « Stage gates » et « Comités ».
5. Cliquez sur « Reprendre », confirmez.

Résultat attendu : « Dossier suspendu. », « Dossier en cours. », puis « Dossier clos. ». La fenêtre de
clôture précise que le dossier ne s'évalue plus, ne passe plus de gate, ne reçoit plus de revue de
comité et que le porteur ne peut plus y déposer de pièce ni de message. Clos, le dossier l'indique
et « Passer au gate suivant » est grisé. Repris, il redevient « En cours ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## B. Associé : second regard et décisions à deux

### AXP-18. Confier un compartiment à l'associé

Objectif : vérifier que le responsable du dossier confie un compartiment et que chacun ne voit que
les siens dans « Mes compartiments ».

Compte : test.consultant (responsable), puis test.associe.

Données : le dossier de AXP-02 ; compartiment C2 confié à test.associe.

1. test.consultant : onglet « Synthèse », cadre « Suivi par compartiment ». Dans le choix du
   consultant du compartiment C2, prenez « Test - Associé du cabinet ».
2. test.associe : ouvrez le dossier, onglet « Évaluation », cliquez sur « Mes compartiments ».
3. test.associe : évaluez un critère du compartiment C2.

Résultat attendu : « Compartiment C2 confié à Test - Associé du cabinet. » ; le journal du dossier
garde le changement. Avec « Mes compartiments », test.associe ne voit que les critères de C2 et les
évalue. Le dossier a désormais deux contributeurs.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-19. Forcer le passage d'un gate, avec un motif

Objectif : vérifier qu'un passage contre la règle exige un motif et deux personnes, et qu'il est
inscrit au journal.

Compte : test.consultant (le dossier ayant été évalué aussi par test.associe en AXP-18).

Données : le dossier de AXP-02, dont le gate en cours refuse le passage ; motif « Décision du comité
du 15, pièce attendue sous huit jours (essai). ».

1. Onglet « Stage gates », « Passer au gate suivant ». La fenêtre « Passage contre la règle du gate »
   s'ouvre.
2. Saisissez un motif de moins de dix caractères dans « Motif du passage forcé (10 caractères au
   moins) », puis le motif complet.
3. Cliquez sur « Forcer le passage ».
4. Ouvrez l'onglet « Journal ».

Résultat attendu : « Forcer le passage » reste grisé tant que le motif compte moins de dix
caractères. Ensuite, « Passage forcé enregistré
au journal du dossier. » : le dossier passe au gate suivant. Le journal porte le motif, son auteur
et la décision calculée ; le rapport le reprendra.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-20. Sceller une décision de comité à deux

Objectif : vérifier qu'une décision HOLD exige un motif, qu'elle est confirmée avant d'être scellée,
et qu'elle fige le dossier.

Compte : test.consultant (le dossier ayant été évalué aussi par test.associe en AXP-18).

Données : le dossier de AXP-02 ; décision HOLD ; motif « Étude de marché à compléter. » ; une
condition « Déposer l'étude de marché (essai) ».

1. Onglet « Comités », cadre « Nouvelle revue de comité ». Choisissez la « Décision » HOLD, laissez le
   motif vide et regardez les boutons.
2. Saisissez le motif dans « Motif de la décision (obligatoire pour HOLD et NO-GO) » et la condition
   dans « Conditions », puis « Enregistrer en brouillon ».
3. Sur la revue, cliquez sur « Verrouiller ». Lisez la fenêtre « Sceller et verrouiller la
   décision », puis « Sceller et verrouiller ».
4. Ouvrez l'onglet « Évaluation » et tentez de changer un statut.
5. Revenez à « Comités » et cliquez sur « Vérifier » sur la revue.

Résultat attendu : à l'étape 1, « Motif obligatoire pour une décision HOLD ou NO-GO, dès le
brouillon. » et les deux boutons d'enregistrement sont grisés. À l'étape 2, « Revue enregistrée en
brouillon : elle se corrige jusqu'à son verrouillage. ». La fenêtre de l'étape 3 précise que la
décision ne se modifiera plus et fige le dossier jusqu'à une nouvelle révision, ouverte par un autre
compte ; après confirmation, « Décision scellée et verrouillée. ». L'évaluation est figée (« Décision
du comité verrouillée : l'évaluation est figée. … »). « Vérifier » répond « Empreinte valide, dossier
inchangé depuis la décision : … ». La condition devient une action du porteur.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-21. Ouvrir une nouvelle révision par un autre compte

Objectif : vérifier que celui qui a verrouillé la décision ne la défait pas lui-même.

Compte : test.consultant (qui a verrouillé en AXP-20), puis test.associe.

Données : le dossier figé de AXP-20.

1. test.consultant : dans l'en-tête du dossier, cliquez sur « Ouvrir une nouvelle révision ». Lisez la
   fenêtre, puis « Ouvrir la révision ».
2. test.associe : faites de même.

Résultat attendu : la fenêtre rappelle que la décision scellée reste au dossier et que celui qui l'a
verrouillée ne peut pas ouvrir la révision. À l'étape 1, refus : « Principe des quatre yeux : vous
avez verrouillé la décision en vigueur du dossier … (révision …), vous ne pouvez donc pas ouvrir la
nouvelle révision qui la défait. Un autre consultant du cabinet doit l'ouvrir. ». À l'étape 2,
« Nouvelle révision ouverte : le dossier est de nouveau modifiable. » ; la décision scellée reste
dans l'historique.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-22. Comparer deux revues de comité

Objectif : vérifier la comparaison de deux décisions.

Compte : test.consultant.

Données : le dossier de AXP-21, avec une seconde revue enregistrée sur la nouvelle révision.

1. Onglet « Comités » : enregistrez une seconde revue en brouillon (par exemple CONDITIONAL GO).
2. Dans l'historique, cochez les deux revues.
3. Lisez la « Comparaison du … au … ».

Résultat attendu : la comparaison montre l'évolution des scores, des gates, des domaines et des
indicateurs financiers entre les deux revues.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-23. Changer de responsable du dossier

Objectif : vérifier que seul le responsable en place confie le dossier à un autre consultant, avec
confirmation.

Compte : test.consultant (responsable), puis test.associe.

Données : le dossier de AXP-02, non figé (après AXP-21).

1. test.consultant : onglet « Synthèse », cadre « Équipe et accès du porteur au portail ». Dans
   « Confier à un autre consultant », choisissez « Test - Associé du cabinet », puis « Confier le
   dossier ».
2. Lisez la fenêtre « Changer de responsable », puis « Confier le dossier ».
3. test.consultant : rechargez la synthèse.
4. test.associe : confiez de nouveau le dossier à « Test - Consultant du cabinet ».

Résultat attendu : la fenêtre précise que le nouveau responsable confiera seul ensuite les
compartiments et le dossier. « Dossier confié à Test - Associé du cabinet. » ; le cadre indique le
nouveau responsable et le journal garde le changement. À l'étape 3, test.consultant ne peut plus
confier le dossier (le choix n'est plus proposé). À l'étape 4, le dossier revient à test.consultant.
Sur un dossier figé, le bouton est grisé : « Figé par la décision verrouillée, comme la fiche. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## C. Outils du portail des porteurs (cabinet)

### AXP-24. Lire la synthèse du portail

Objectif : vérifier que le cabinet voit ce qui l'attend sur le portail.

Compte : test.consultant.

Données : aucune.

1. Ouvrez Cabinet > Portail des porteurs. Les onglets « Synthèse », « Messages », « Communications »,
   « Ressources », « Événements », « Rendez-vous », « Porteurs et avis » s'affichent.
2. Lisez la synthèse : porteurs actifs, messages en attente, rendez-vous demandés, comptes rendus à
   valider, inscriptions, satisfaction.

Résultat attendu : chaque chiffre renvoie à l'onglet où agir ; la liste dit ce qui attend le cabinet.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-25. Répondre à un porteur depuis la messagerie du cabinet

Objectif : vérifier la messagerie de tous les dossiers et la note interne.

Compte : test.consultant, puis test.porteur.

Données : un message envoyé par test.porteur (POR-06).

1. Onglet « Messages ». Choisissez « Non lues », puis la conversation de test.porteur.
2. Écrivez une réponse dans « Votre réponse au porteur… », envoyez (Ctrl + Entrée).
3. Cochez « Note interne », écrivez une note, puis « Enregistrer la note ».
4. test.porteur : lisez ses messages.

Résultat attendu : la conversation est signalée « En attente de réponse » avant la réponse. Le
porteur lit la réponse, jamais la note interne.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-26. Publier une communication avec accusé de lecture

Objectif : vérifier la publication d'une communication à un public choisi et le suivi de sa lecture.

Compte : test.consultant, puis test.porteur.

Données : titre « Appel à projets agricole (essai) » ; public : le dossier « Unité de séchage de
mangues (démo) » ; accusé de lecture demandé.

1. Onglet « Communications », « Nouvelle communication » : « Titre », « Nature », « Texte », le public
   et l'accusé de lecture. « Enregistrer le brouillon ».
2. Sur la communication, cliquez sur « Publier », lisez la fenêtre « Publier … ? », puis confirmez.
3. test.porteur : ouvrez « Actualités », lisez la communication, confirmez la lecture.
4. test.consultant : relisez la communication (« Lue », « Accusés »).

Résultat attendu : « Communication publiée : les porteurs visés sont prévenus. ». Le porteur la voit
avec une notification ; après sa confirmation, le cabinet voit l'accusé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-27. Confirmer un rendez-vous demandé par un porteur

Objectif : vérifier la réponse du cabinet à une demande de rendez-vous et le compte rendu partagé.

Compte : test.consultant, puis test.porteur.

Données : une demande de rendez-vous de test.porteur (POR-09).

1. Onglet « Rendez-vous », bloc « À confirmer ou à décliner » : ouvrez la demande.
2. Cliquez sur un des « Créneaux proposés par le porteur », renseignez le « Lieu », confirmez.
3. Le jour venu (ou sur un rendez-vous passé), « Marquer tenu » avec un compte rendu.

Résultat attendu : « Rendez-vous confirmé : le porteur est prévenu. » ; le rendez-vous passe dans
« Confirmés à venir ». Marqué tenu, son compte rendu est lisible par le porteur.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-28. Publier un événement et gérer les inscriptions

Objectif : vérifier la publication d'un événement, la liste d'attente et le pointage.

Compte : test.consultant, puis test.porteur et porteur.demo.

Données : « Atelier plan d'affaires (essai) » ; une seule place.

1. Onglet « Événements », « Nouvel événement » : intitulé, dates, lieu, « Places » 1. Enregistrez,
   puis publiez et confirmez.
2. test.porteur, puis porteur.demo : inscrivez-vous au portail.
3. test.consultant : ouvrez les « Inscrits », pointez « Présent » ou « Absent », puis « Exporter la
   liste (CSV) ».

Résultat attendu : le premier inscrit a la place, le second est en liste d'attente. La liste des
inscrits se pointe et s'exporte.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## D. Direction

### AXP-29. Consulter un dossier sans le modifier

Objectif : vérifier que la direction suit le portefeuille et les dossiers en lecture seule.

Compte : test.dg.

Données : le dossier « Usine de briques compressées (démo) ».

1. Ouvrez NIMOVA · MB AxisPro Consulting : lisez le portefeuille.
2. Ouvrez le dossier, onglets « Synthèse » et « Évaluation ».
3. Ouvrez Méthode > Grille d'évaluation.

Résultat attendu : le portefeuille et le dossier sont lisibles. L'évaluation affiche « Lecture seule :
votre profil consulte l'évaluation. Seul le profil cabinet évalue les critères et joint les
preuves. » ; la grille affiche « Lecture seule : votre profil consulte la grille. … ». Ni « Ouvrir
l'accès », ni « Confier le dossier », ni « Suspendre » ne sont proposés.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## E. Refus attendus

### AXP-30. Un consultant seul ne scelle pas une décision

Objectif : vérifier le principe des quatre yeux.

Compte : test.consultant seul.

Données : un dossier ouvert pour l'essai (par exemple celui de AXP-17, repris), dont test.consultant
a évalué au moins un critère et que personne d'autre n'a touché ; décision GO.

1. Onglet « Comités », « Nouvelle revue de comité », décision GO, « Enregistrer, sceller et
   verrouiller », puis « Sceller et verrouiller ».

Résultat attendu : le verrouillage est refusé : « Principe des quatre yeux : une décision du comité
engage au moins deux personnes. Or vous êtes le seul auteur de la révision … : vous ne pouvez donc
pas … seul. Un autre consultant du cabinet doit contribuer à cette révision ou s'en charger. ». Le
dossier n'est pas figé. Le même refus s'applique à un passage de gate forcé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-31. Un compartiment confié à un autre ne s'évalue pas

Objectif : vérifier qu'un consultant n'évalue que ses compartiments, sauf le responsable du dossier.

Compte : test.consultant (responsable), puis test.associe.

Données : le dossier de AXP-18 ; compartiment C3 confié à test.consultant.

1. test.consultant : dans « Suivi par compartiment », confiez C3 à « Test - Consultant du cabinet ».
2. test.associe : dans « Évaluation », « Grille complète », repérez un critère de C3.

Résultat attendu : chez test.associe, les boutons de statut des critères de C3 sont grisés et la ligne
indique « Compartiment confié à Test - Consultant du cabinet » ; seuls ce consultant et le
responsable du dossier les évaluent.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-32. AxisPro fermé à la finance et au porteur

Objectif : vérifier que l'application du cabinet ne s'ouvre qu'aux profils prévus.

Compte : test.daf, puis test.porteur.

Données : aucune.

1. test.daf : l'accueil ne montre pas de rayon MB AxisPro Consulting. Dans la barre d'adresse,
   remplacez la fin de l'adresse par /axispro.
2. test.porteur : faites de même depuis le portail.

Résultat attendu : dans les deux cas, la page « Accès non ouvert à votre profil » s'affiche, sans
aucune donnée des dossiers.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-33. Formats de fichiers refusés dans la data room

Objectif : vérifier que seuls les formats sûrs entrent dans la data room.

Compte : test.consultant.

Données : une archive .zip ; un ancien document Word .doc ; un document Word à macros (.docm).

1. Onglet « Data room », « Pièce libre » : choisissez l'archive (affichez « Tous les fichiers » dans
   la fenêtre de choix).
2. Recommencez avec le .doc, puis le .docm.

Résultat attendu : chaque dépôt est refusé par un message qui rappelle les formats acceptés : PDF,
JPEG, PNG, Word (.docx) ou Excel (.xlsx). Aucune pièce n'est ajoutée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## F. Contrôles de saisie et de sécurité

### AXP-34. Nombres écrits à la française

Objectif : vérifier que les montants et les heures s'écrivent à la française et qu'une écriture
ambiguë est refusée avec un message, sans être mal lue.

Compte : test.consultant.

Données : modèle financier : prix « 12 500 » puis « 12.500 » puis « 2.500.000 » ; temps : « 1,5 »
heure.

1. Modèle financier, case « Prix unitaire » d'un produit : saisissez « 12 500 », cliquez ailleurs.
2. Saisissez « 12.500 », cliquez ailleurs.
3. Saisissez « 2.500.000 », cliquez ailleurs, puis appuyez sur Échap.
4. Onglet « Temps », « Saisir du temps » : « Heures » « 1,5 », enregistrez.

Résultat attendu : « 12 500 » est enregistré tel quel. « 12.500 » et « 2.500.000 » sont refusés par le
message « Nombre illisible : écrivez par exemple 750 000 ou 2,5. » sous la case : rien n'est
enregistré, la valeur n'est jamais lue 12,5 ; Échap reprend la valeur enregistrée. « 1,5 » heure est
accepté.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-35. Un double clic ne franchit qu'un gate et ne crée qu'une facture

Objectif : vérifier qu'un double clic n'enregistre qu'une fois.

Compte : test.consultant.

Données : un dossier dont le gate en cours permet le passage ; des temps à facturer.

1. Onglet « Stage gates » : double-cliquez sur « Passer au gate suivant ».
2. Onglet « Temps » : double-cliquez sur « Créer la facture ».

Résultat attendu : le dossier ne franchit qu'un seul gate ; si le second clic arrive, l'écran le dit
et relit le dossier. Une seule facture d'honoraires est créée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-36. Confirmation avant une action irréversible

Objectif : vérifier qu'une suppression ou une publication demande confirmation, et qu'« Annuler » ne
change rien.

Compte : test.consultant.

Données : une action du plan d'actions créée pour le test ; un brouillon de communication.

1. Onglet « Actions » : « Supprimer » sur l'action. Lisez la fenêtre « Supprimer l'action … ? », puis
   annulez ; recommencez et confirmez.
2. Portail des porteurs > Communications : « Supprimer le brouillon », lisez la fenêtre, annulez.

Résultat attendu : chaque fenêtre nomme l'élément concerné. « Annuler » ne change rien ; confirmée,
l'action est supprimée (« Action supprimée. »).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## Synthèse

| Partie {52} | Scénarios {12} | Réussis {12} | Échoués {12} | Non joués {12} |
|---|---|---|---|---|
| A. Consultant du cabinet | 17 | | | |
| B. Associé : second regard et décisions à deux | 6 | | | |
| C. Outils du portail des porteurs (cabinet) | 5 | | | |
| D. Direction | 1 | | | |
| E. Refus attendus | 4 | | | |
| F. Contrôles de saisie et de sécurité | 3 | | | |
| Total | 36 | | | |

Réserves et anomalies relevées :

| N° {6} | Scénario {12} | Constat {52} | Demande DEM-… {16} | Gravité {14} |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |

## Signatures

| Le testeur {50} | Le référent du domaine {50} |
|---|---|
| Nom : | Nom : |
| Fonction : | Fonction : |
| Date : | Date : |
| Signature : | Signature : |
