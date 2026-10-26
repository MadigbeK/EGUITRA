# Cahier de test : AxisPro Suite

NIMOVA · MB AxisPro Consulting, l'application du cabinet MB AxisPro Consulting.

Dossiers, évaluation par critère et par gate, compartiments, comité et décision scellée, data
room, plan d'actions, financements, modèle financier, temps et honoraires, outils du portail des
porteurs.

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

1. Se connecter. Ouvrez l'adresse de la recette communiquée par E-VOLUTION XP, dans Chrome ou Edge,
   puis la tuile MB AxisPro Consulting de l'accueil. Identifiant : le compte de test indiqué dans le
   scénario. Mot de passe : le mot de passe commun de la recette, communiqué par E-VOLUTION XP.
2. Deux consultants. Plusieurs scénarios demandent deux comptes du cabinet (un consultant et un
   associé) : une décision du comité engage toujours au moins deux personnes. Demandez à E-VOLUTION
   XP le second compte du cabinet avant de commencer.
3. Jouer un scénario. Suivez les étapes dans l'ordre, avec les données indiquées. Un scénario à deux
   comptes se joue dans deux navigateurs (Chrome et Edge) ou sur deux postes. Travaillez de
   préférence sur un dossier ouvert pour le test (AXP-02), pas sur les dossiers de démonstration.
4. Noter le résultat. Cochez « Réussi » si l'écran correspond au résultat attendu, sinon « Échoué ».
   Dans « Remarques », notez ce qui diffère : l'écran, le message affiché, l'heure.
5. Signaler une anomalie. Menu du compte (rond à vos initiales, en haut à droite) > « Mes demandes »
   > « Nouvelle demande », type « Remarque de recette », application NIMOVA · MB AxisPro Consulting,
   la gravité ; titre commençant par le numéro du scénario (par exemple « AXP-13 : décision non
   scellée ») ; description ; « Déposer la demande ». Reportez le numéro reçu (DEM-…) dans les
   remarques.

## Comptes de test

| Compte {20} | Profil {16} | Société {26} | Rôle dans ce cahier {38} |
|---|---|---|---|
| test.consultant | Cabinet | MB AxisPro Consulting | consultant, responsable des dossiers qu'il ouvre |
| second compte du cabinet | Cabinet | MB AxisPro Consulting | associé : second regard, compartiments, comité |
| test.dg | Direction | les deux | consultation du portefeuille |
| test.porteur | Porteur | MB AxisPro Consulting | vérification côté portail |
| test.daf | Finance | les deux | refus |

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

Objectif : vérifier l'ouverture d'un dossier et sa référence.

Compte : test.consultant.

Données : projet « Unité de transformation de manioc (essai) » ; promoteur « Essai Agro Forécariah
SARL » (à créer depuis le champ) ; secteur agro-industrie ; localisation Forécariah ; devise GNF ;
investissement 4 500 000 000 ; besoin de financement 3 000 000 000.

1. Cliquez sur « Nouveau dossier ». La fenêtre « Ouverture d'un dossier » s'ouvre.
2. Remplissez « Projet », « Promoteur », « Secteur », « Localisation », « Devise du dossier »,
   « Date d'évaluation », l'investissement prévu et le besoin de financement.
3. Cliquez sur « Ouvrir le dossier ».

Résultat attendu : le dossier reçoit une référence AX/… et s'ouvre sur l'onglet « Synthèse ». Les
onglets sont « Synthèse », « Évaluation », « Stage gates », « Modèle financier », « Risques »,
« Actions », « Financements », « Data room », « Comités », « Journal », « Échanges », « Rapport » et
« Temps ». test.consultant en est le responsable.

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
3. Ouvrez « Détails, preuves et suivi » d'un critère : remplissez « Étude, analyse ou document à
   produire », « Responsable », « Échéance » et « Observation ».
4. Revenez à l'en-tête du dossier.

Résultat attendu : chaque statut s'enregistre aussitôt, avec « Dernière évaluation : test.consultant,
le … ». Les scores Project Readiness, APD et Bankability de l'en-tête sont recalculés ; le nombre de
critères évalués augmente.

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
2. Déclarez un knock-out « Disponible » sans pièce. Lisez la ligne « Retenu ».
3. Ouvrez « Détails, preuves et suivi », choisissez la date de « Validité », puis « Joindre une
   preuve » et le PDF.
4. Ouvrez l'onglet « Data room ».

Résultat attendu : à l'étape 2, le critère est retenu « Incomplet » par la politique, la saisie
restant « Disponible ». À l'étape 3, « Preuve « … » rattachée à … » ; le critère est retenu
disponible. La pièce rattachée apparaît disponible dans la data room.

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
4. Lisez l'aperçu « Import de … » (colonnes « Critère », « Avant », « Après »), puis « Appliquer 2
   modifications ».

Résultat attendu : l'aperçu ne liste que les deux critères modifiés. Après application, « Fiche
d'évaluation importée. » et les deux statuts sont à jour. Une fiche identique à l'évaluation affiche
« Aucune modification : la fiche correspond déjà à l'évaluation du dossier. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-06. Lire les stage gates et passer au gate suivant

Objectif : vérifier la décision de chaque gate et le passage au gate suivant.

Compte : test.consultant.

Données : le dossier de AXP-02.

1. Ouvrez l'onglet « Stage gates ». Lisez le « Parcours du dossier » et, pour le gate en cours, sa
   décision, ses « Exigences d'entrée », ses « Livrables attendus » et ses « Critères de passage ».
2. Si la décision du gate le permet, cliquez sur « Passer au gate suivant ».

Résultat attendu : chaque gate affiche GO, CONDITIONAL GO, HOLD ou NO-GO et ses motifs. Sous la
complétude minimale, le gate reste en HOLD. Un passage permis fait du gate suivant le gate en cours ;
le journal le garde.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-07. Modifier une hypothèse du modèle financier

Objectif : vérifier que le modèle se recalcule en quittant une case.

Compte : test.consultant.

Données : le dossier « Usine de briques compressées (démo) » ou un dossier de test avec un modèle ;
prix unitaire augmenté de 10 %.

1. Ouvrez l'onglet « Modèle financier ». Notez « VAN du projet », « TRI du projet » et le DSCR
   minimal.
2. Dans le tableau des produits, modifiez « Prix unitaire », puis cliquez ailleurs.
3. Relisez les indicateurs, puis cliquez sur « Export XLSX ».

Résultat attendu : la VAN, le TRI et le DSCR changent dès la sortie de la case. Le classeur exporté
reprend les hypothèses et les comptes prévisionnels.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-08. Tenir le registre des risques

Objectif : vérifier l'ajout d'un risque, sa place dans la matrice et son action de traitement.

Compte : test.consultant.

Données : risque « Retard de livraison des presses (essai) », probabilité et impact élevés.

1. Onglet « Risques », « Nouveau risque ». Remplissez le risque, la probabilité, l'impact, la mesure
   d'atténuation et les valeurs après traitement. Enregistrez.
2. Repérez le risque dans la « Matrice probabilité × impact ».
3. Cliquez sur « Créer l'action de traitement », puis ouvrez l'onglet « Actions ».

Résultat attendu : le risque figure au registre avec sa criticité avant et après traitement. L'action
de traitement apparaît dans le plan d'actions du dossier.

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
2. « Nouvelle action » : « Action », « Confiée à » (porteur), « Échéance », « Détail attendu ».
   Enregistrez.
3. test.porteur déclare l'action faite au portail (cahier du portail, POR-07).
4. test.consultant : sur l'action déclarée faite, lisez « Compte rendu du porteur : », puis
   « Valider ».

Résultat attendu : les écarts prioritaires deviennent des actions (« … actions créées »). L'action du
porteur passe dans « Déclarées faites, à valider », puis validée avec sa date.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-10. Suivre une démarche de financement

Objectif : vérifier l'enregistrement d'une démarche auprès d'un financeur et sa relance.

Compte : test.consultant.

Données : financeur « Banque d'essai de Guinée » (à créer depuis le champ) ; instrument prêt ; montant
sollicité 2 000 000 000 ; date de relance dans dix jours.

1. Onglet « Financements », « Nouvelle démarche ».
2. Remplissez « Financeur (banque, fonds, investisseur) », « Instrument », « Montant sollicité
   (GNF) », la prochaine étape et la « Date de relance ». Enregistrez.
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

Données : le dossier « Unité de séchage de mangues (démo) », avec deux pièces déposées par le porteur
(au besoin, faites-les déposer par test.porteur, POR-04) ; motif « Bilan non signé : merci de
déposer la version signée. ».

1. Onglet « Data room ». Sur une pièce reçue, cliquez sur « Valider ».
2. Sur l'autre pièce, cliquez sur « À reprendre », saisissez le motif dans la fenêtre, puis
   confirmez.
3. Cliquez sur « Pièces à fournir », puis sur « Data room (.zip) ».

Résultat attendu : la première pièce est disponible ; la seconde est comptée « À reprendre » et le
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

1. Onglet « Échanges » : choisissez « Message au porteur », écrivez le message, « Envoyer ».
2. Choisissez « Note interne au cabinet », écrivez la note, « Envoyer ».
3. test.porteur : ouvrez « Messages » au portail.

Résultat attendu : les deux écrits figurent dans les échanges du dossier, la note marquée « Note
interne, invisible du porteur ». Le porteur lit le message, jamais la note.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-13. Saisir du temps et facturer les honoraires

Objectif : vérifier la saisie des temps et la facture d'honoraires dans la comptabilité du cabinet.

Compte : test.consultant, puis test.daf.

Données : le dossier de AXP-02 ; 3,5 heures « Analyse du plan d'affaires (essai) » ; taux horaire HT
500 000.

1. Onglet « Temps », « Saisir du temps » : « Date des travaux », « Heures », « Travaux réalisés »,
   « Enregistrer ».
2. Cliquez sur « Facturer les honoraires (3,5 h non facturées) ». Saisissez le « Taux horaire HT
   (GNF) », puis « Créer la facture ».
3. test.daf : Finance, société MB AxisPro Consulting, Comptabilité > Ventes, vue « Brouillons ».

Résultat attendu : « Facture d'honoraires créée en brouillon (… TTC). ». Le temps passe de « À
facturer » à la facture. La facture figure en brouillon dans les ventes de MB AxisPro Consulting,
jamais dans celles d'EGUITRA GROUP SARLU.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-14. Télécharger le rapport et les exports

Objectif : vérifier les documents du dossier pour le comité.

Compte : test.consultant.

Données : le dossier « Usine de briques compressées (démo) ».

1. Onglet « Rapport ». Cliquez sur « Rapport du comité (PDF) ».
2. Cliquez sur « Classeur d'évaluation », puis « Pièces à fournir (PDF) ».
3. Cliquez sur « Imprimer l'aperçu ».

Résultat attendu : le rapport reprend la fiche, les scores, les gates, les écarts prioritaires, les
contrôles, le modèle financier, les risques et la data room. Le classeur suit le plan du modèle du
cabinet. Chaque document rappelle la version de la grille.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-15. Préparer une nouvelle version de la grille

Objectif : vérifier qu'une modification de la grille passe par une nouvelle version en brouillon, et
que sa mise en vigueur est confirmée.

Compte : test.consultant. Ne pas confirmer la mise en vigueur sans l'accord du cabinet : elle
s'applique à tous les dossiers ouverts ensuite.

Données : la grille en vigueur.

1. Ouvrez Méthode > Grille d'évaluation. Lisez « Versions » et la version « En vigueur ».
2. Créez une nouvelle version : le message « Nouvelle version créée en brouillon : ajustez-la puis
   mettez-la en vigueur. » s'affiche.
3. Dans « Domaines et critères », modifiez l'aide d'un critère.
4. Cliquez sur « Mettre en vigueur », lisez la fenêtre, puis « Annuler ».

Résultat attendu : la version en vigueur ne se modifie pas (« Cette version n'est plus modifiable »).
La fenêtre de mise en vigueur précise que la version actuelle sera archivée et que les dossiers
ouverts gardent leur version ; « Annuler » ne change rien.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## B. Associé : second regard et décision du comité

### AXP-16. Confier un compartiment à un consultant

Objectif : vérifier que le responsable du dossier confie un compartiment et que chacun ne voit que
les siens dans « Mes compartiments ».

Compte : test.consultant (responsable), puis le second compte du cabinet (associé).

Données : le dossier de AXP-02 ; compartiment C2 confié à l'associé.

1. test.consultant : onglet « Synthèse », bloc « Suivi par compartiment ». Dans « Consultant du
   compartiment C2 », choisissez l'associé.
2. L'associé : ouvrez le dossier, onglet « Évaluation », cliquez sur « Mes compartiments ».
3. L'associé : évaluez un critère du compartiment C2.

Résultat attendu : le message « Compartiment C2 confié à … » s'affiche et le journal du dossier le
garde. Avec « Mes compartiments », l'associé ne voit que les critères de C2 ; il les évalue.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-17. Sceller une décision de comité à deux

Objectif : vérifier qu'une décision engage au moins deux personnes, qu'elle est confirmée avant
d'être scellée et qu'elle fige le dossier.

Compte : test.consultant (le dossier ayant aussi été évalué par l'associé en AXP-16).

Données : le dossier de AXP-02, évalué par les deux comptes (AXP-03 et AXP-16) ; décision HOLD ;
instance « Comité d'investissement (essai) » ; motif « Étude de marché à compléter. ».

1. Onglet « Comités », « Nouvelle revue de comité ». Choisissez la « Décision » HOLD, sans motif, puis
   « Enregistrer en brouillon ».
2. Ajoutez le motif dans « Motif de la décision (obligatoire pour HOLD et NO-GO) » et une condition
   dans « Conditions », puis « Enregistrer en brouillon ».
3. Cliquez sur « Enregistrer, sceller et verrouiller » (ou « Verrouiller » sur la revue). Lisez la
   fenêtre, puis confirmez.
4. Ouvrez l'onglet « Évaluation » et tentez de changer un statut.
5. Sur la revue, cliquez sur « Vérifier ».

Résultat attendu : à l'étape 1, le HOLD sans motif est refusé. À l'étape 3, la fenêtre précise que la
décision ne se modifiera plus et fige le dossier jusqu'à une nouvelle révision ; après confirmation,
« Décision enregistrée, scellée et verrouillée : le dossier est figé. ». L'évaluation est en lecture
seule (« Décision du comité verrouillée : l'évaluation est figée. »). « Vérifier » répond « Décision
scellée et verrouillée. ». La condition devient une action du porteur.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-18. Ouvrir une nouvelle révision par un autre compte

Objectif : vérifier que celui qui a verrouillé la décision ne la défait pas lui-même.

Compte : le compte qui a verrouillé en AXP-17, puis l'autre compte du cabinet.

Données : le dossier figé de AXP-17.

1. Le compte qui a verrouillé : cliquez sur « Ouvrir une nouvelle révision » dans l'en-tête du dossier.
2. L'autre compte : cliquez sur « Ouvrir une nouvelle révision ».

Résultat attendu : à l'étape 1, l'ouverture est refusée par un message qui demande un autre compte. À
l'étape 2, une nouvelle révision s'ouvre : l'évaluation redevient modifiable ; la décision scellée
reste dans l'historique.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-19. Comparer deux revues de comité

Objectif : vérifier la comparaison de deux décisions.

Compte : test.consultant.

Données : un dossier avec deux revues (par exemple après une seconde décision sur la révision de
AXP-18).

1. Onglet « Comités », « Historique (cochez deux revues pour les comparer) » : cochez « Comparer cette
   revue » sur deux revues.
2. Lisez la « Comparaison du … au … ».

Résultat attendu : la comparaison montre l'évolution des scores, des gates, des domaines et des
indicateurs financiers entre les deux revues.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## C. Outils du portail des porteurs (cabinet)

### AXP-20. Lire la synthèse du portail

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

### AXP-21. Répondre à un porteur depuis la messagerie du cabinet

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

### AXP-22. Publier une communication avec accusé de lecture

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

### AXP-23. Confirmer un rendez-vous demandé par un porteur

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

### AXP-24. Publier un événement et gérer les inscriptions

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

### AXP-25. Consulter un dossier sans le modifier

Objectif : vérifier que la direction suit le portefeuille et les dossiers en lecture seule.

Compte : test.dg.

Données : le dossier « Usine de briques compressées (démo) ».

1. Ouvrez NIMOVA · MB AxisPro Consulting : lisez le portefeuille.
2. Ouvrez le dossier, onglet « Évaluation ».
3. Ouvrez Méthode > Grille d'évaluation.

Résultat attendu : le portefeuille et le dossier sont lisibles. L'évaluation affiche « Lecture seule :
votre profil consulte l'évaluation. Seul le profil cabinet évalue les critères et joint les
preuves. » ; la grille affiche « Lecture seule : votre profil consulte la grille. … ». Aucun bouton
de saisie n'est proposé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## E. Refus attendus

### AXP-26. Un consultant seul ne scelle pas une décision

Objectif : vérifier le principe des quatre yeux.

Compte : test.consultant seul.

Données : un dossier ouvert et évalué par test.consultant seul ; décision GO.

1. Onglet « Comités », « Nouvelle revue de comité », décision GO, « Enregistrer, sceller et
   verrouiller », confirmez.

Résultat attendu : le verrouillage est refusé : « Principe des quatre yeux : une décision du comité
engage au moins deux personnes. Or vous êtes le seul auteur de la révision … : vous ne pouvez donc
pas … seul. Un autre consultant du cabinet doit contribuer à cette révision ou s'en charger. ». Le
dossier n'est pas figé. Le même refus s'applique à un passage de gate forcé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-27. Un compartiment confié à un autre ne s'évalue pas

Objectif : vérifier qu'un consultant n'évalue que ses compartiments, sauf le responsable du dossier.

Compte : l'associé, puis test.consultant.

Données : le dossier de AXP-16, dont le compartiment C3 est confié à test.consultant.

1. test.consultant (responsable) : confiez C3 à lui-même dans « Suivi par compartiment ».
2. L'associé : dans « Évaluation », « Grille complète », tentez de changer le statut d'un critère de
   C3.

Résultat attendu : le changement est refusé par un message qui indique que le compartiment C3 est
confié à test.consultant et que seuls ce consultant et le responsable du dossier en écrivent
l'évaluation ; le statut reste inchangé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-28. AxisPro fermé à la finance et au porteur

Objectif : vérifier que l'application du cabinet ne s'ouvre qu'aux profils prévus.

Compte : test.daf, puis test.porteur.

Données : aucune.

1. test.daf : l'accueil ne montre pas de tuile MB AxisPro Consulting. Dans la barre d'adresse,
   remplacez la fin de l'adresse par /axispro.
2. test.porteur : faites de même depuis le portail.

Résultat attendu : dans les deux cas, la page « Accès non ouvert à votre profil » s'affiche, sans
aucune donnée des dossiers.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-29. Formats de fichiers refusés dans la data room

Objectif : vérifier que seuls les formats sûrs entrent dans la data room.

Compte : test.consultant.

Données : une archive .zip ; un ancien document Word .doc ; un document Word à macros (.docm).

1. Onglet « Data room », « Déposer » sur une pièce : choisissez l'archive (affichez « Tous les
   fichiers » dans la fenêtre de choix).
2. Recommencez avec le .doc, puis le .docm.

Résultat attendu : chaque dépôt est refusé par un message qui rappelle les formats acceptés : PDF,
JPEG, PNG, Word (.docx) ou Excel (.xlsx). Aucune pièce n'est ajoutée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## F. Contrôles de saisie et de sécurité

### AXP-30. Nombres écrits à la française

Objectif : vérifier que les montants et les heures s'écrivent à la française et qu'une écriture
ambiguë est refusée avec un message, sans être mal lue.

Compte : test.consultant.

Données : modèle financier : prix « 12 500 » puis « 12.500 » puis « 2.500.000 » ; temps : « 1,5 »
heure.

1. Modèle financier, case « Prix unitaire » d'un produit : saisissez « 12 500 », cliquez ailleurs.
2. Saisissez « 12.500 », cliquez ailleurs.
3. Saisissez « 2.500.000 », cliquez ailleurs.
4. Onglet « Temps », « Saisir du temps » : « Heures » « 1,5 », enregistrez.

Résultat attendu : « 12 500 » est enregistré tel quel. « 12.500 » et « 2.500.000 » sont refusés par le
message « Nombre illisible : écrivez par exemple 750 000 ou 2,5. » : la valeur n'est ni lue 12,5 ni
enregistrée. « 1,5 » heure est accepté.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-31. Un double clic ne franchit qu'un gate et ne crée qu'une facture

Objectif : vérifier qu'un double clic n'enregistre qu'une fois.

Compte : test.consultant.

Données : un dossier dont le gate en cours permet le passage ; des temps à facturer.

1. Onglet « Stage gates » : double-cliquez sur « Passer au gate suivant ».
2. Onglet « Temps » : double-cliquez sur « Créer la facture ».

Résultat attendu : le dossier ne franchit qu'un seul gate ; une seule facture d'honoraires est
créée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AXP-32. Confirmation avant une action irréversible

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
| A. Consultant du cabinet | 15 | | | |
| B. Associé : second regard et décision du comité | 4 | | | |
| C. Outils du portail des porteurs (cabinet) | 5 | | | |
| D. Direction | 1 | | | |
| E. Refus attendus | 4 | | | |
| F. Contrôles de saisie et de sécurité | 3 | | | |
| Total | 32 | | | |

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
