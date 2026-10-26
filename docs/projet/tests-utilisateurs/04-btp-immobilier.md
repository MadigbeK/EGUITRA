# Cahier de test : BTP et Immobilier

NIMOVA · Finance, menu Métiers, pour EGUITRA GROUP SARLU.

Chantiers, situations d'avancement, facturation et retenues de garantie ; biens, baux, loyers
émis chaque nuit, quittances, impayés et fin de bail.

| Rubrique {28} | À remplir {72} |
|---|---|
| Module | BTP et Immobilier (NIMOVA · Finance, menu Métiers) |
| Version de la plateforme | ______ (communiquée par E-VOLUTION XP) |
| Date du test | ______ |
| Nom du testeur | ______ |
| Fonction | ______ |
| Profil utilisé | ______ |
| Compte de test | ______ |
| Société | EGUITRA GROUP SARLU |

Document préparé par E-VOLUTION XP le 26 octobre 2026, d'après les écrans de la plateforme à cette
date.

<!-- saut de page -->

## Mode d'emploi

Ce cahier se joue sur la recette : une copie complète de NIMOVA, avec des données fictives repérées
« Démo ». Rien de ce que vous y faites ne touche les vrais comptes : vous pouvez tout essayer, y
compris les erreurs.

1. Se connecter. Ouvrez l'adresse de la recette communiquée par E-VOLUTION XP, dans Chrome ou Edge,
   puis la tuile Finance de l'accueil. Identifiant : le compte de test indiqué dans le scénario. Mot
   de passe : le mot de passe commun de la recette, communiqué par E-VOLUTION XP. Les comptes BTP et
   immobilier s'ouvrent directement sur leur écran.
2. Société. Le BTP et l'immobilier ne servent qu'EGUITRA GROUP SARLU : vérifiez ce nom en haut à
   droite avant de commencer.
3. Jouer un scénario. Suivez les étapes dans l'ordre, avec les données indiquées. Un scénario à deux
   comptes se joue dans deux navigateurs (Chrome et Edge) ou sur deux postes.
4. Noter le résultat. Cochez « Réussi » si l'écran correspond au résultat attendu, sinon « Échoué ».
   Dans « Remarques », notez ce qui diffère : l'écran, le message affiché, l'heure.
5. Signaler une anomalie. Menu du compte (rond à vos initiales, en haut à droite) > « Mes demandes »
   > « Nouvelle demande », type « Remarque de recette », application NIMOVA · Finance, la gravité ;
   titre commençant par le numéro du scénario (par exemple « IMM-05 : quittance illisible ») ;
   description ; « Déposer la demande ». Reportez le numéro reçu (DEM-…) dans les remarques.

## Comptes de test

| Compte {18} | Profil {18} | Sociétés {26} | Rôle dans ce cahier {38} |
|---|---|---|---|
| test.chantiers | BTP | EGUITRA GROUP SARLU | chantiers et situations |
| test.immobilier | Immobilier | EGUITRA GROUP SARLU | biens, baux, loyers, quittances |
| test.daf | Finance | les deux | facturation des situations, retenues, encaissement des loyers |
| test.dg | Direction | les deux | consultation |

Données fictives utiles : chantier « Entrepôt de stockage (démo) » (code CH-DEMO, marché de
2 400 000 000 GNF HT, retenue de 5 %, maître d'ouvrage « Démo - Maître d'ouvrage ») ; biens
« Bureaux Kaloum, 2e étage (démo) », loué par le bail BAIL-DEMO-01 à « Démo - Locataire des
bureaux » (25 000 000 GNF HT par mois, TVA), et « Villa Kipé (démo) », libre.

## A. BTP

### BTP-01. Lire l'écran BTP

Objectif : vérifier que l'écran donne le portefeuille des chantiers, le facturé et les retenues.

Compte : test.chantiers.

Données : aucune.

1. Connectez-vous et ouvrez Finance : l'écran « BTP » s'affiche.
2. Lisez « Marchés en portefeuille », « Travaux facturés » et « Retenues de garantie à recouvrer ».
3. Lisez la liste : « Maître d'ouvrage », « Marché HT », « Avancement facturé », « Facturé HT ».
4. Cliquez sur « Entrepôt de stockage (démo) ».

Résultat attendu : le chantier s'ouvre avec son avancement, ses coûts imputés, sa marge, son état et
ses situations, chacune avec « Cumul HT », « Période HT » et la retenue.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### BTP-02. Ouvrir un chantier

Objectif : vérifier la création d'un chantier et de son maître d'ouvrage.

Compte : test.chantiers.

Données : chantier « Clôture du dépôt de Kankan (essai) » ; code « CH-ESSAI » ; maître d'ouvrage
« Essai Mines du Nord SA » (à créer depuis le champ) ; localisation « Kankan » ; marché HT
800 000 000 ; retenue de garantie 5 ; démarrage le premier jour du mois.

1. Cliquez sur « Nouveau chantier ».
2. Remplissez « Chantier », « Code » et « Localisation ».
3. Dans « Maître d'ouvrage », saisissez le nom : il n'existe pas, créez-le depuis le champ.
4. Remplissez « Montant du marché HT (GNF) », « Retenue de garantie (%) » et « Démarrage ».
5. Cliquez sur « Créer ».

Résultat attendu : le chantier apparaît dans la liste, « En cours », avec son marché. Le maître
d'ouvrage est créé sans que ses soldes soient visibles du profil BTP.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### BTP-03. Saisir une situation en pourcentage d'avancement

Objectif : vérifier qu'une situation calcule le montant de la période et la retenue de garantie.

Compte : test.chantiers.

Données : le chantier de BTP-02 ; avancement cumulé 25 % ; période « Travaux d'octobre 2026
(essai) ».

1. Ouvrez le chantier, puis « Nouvelle situation ».
2. Dans « Saisie », choisissez « Avancement cumulé (%) » et saisissez 25.
3. Remplissez « Période », puis « Enregistrer ».

Résultat attendu : « Situation enregistrée en brouillon. ». La situation affiche un cumul de
200 000 000 GNF HT, une période de 200 000 000 GNF HT et une retenue de 10 000 000 GNF ; elle porte
la mention « À facturer » (la facturation revient à la finance).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### BTP-04. Saisir une situation en travaux cumulés

Objectif : vérifier la saisie en montant et le contrôle du cumul.

Compte : test.chantiers, après la facturation de BTP-03 (BTP-08).

Données : travaux cumulés HT 350 000 000 ; puis 150 000 000 ; puis 1 000 000 000 (au-delà du
marché).

1. « Nouvelle situation », « Saisie » : « Travaux cumulés HT », « Montant cumulé HT (GNF) »
   350 000 000, période « Travaux de novembre 2026 (essai) », « Enregistrer ».
2. Annulez cette situation (BTP-05), puis recommencez avec 150 000 000.
3. Recommencez avec 1 000 000 000.

Résultat attendu : à l'étape 1, la période vaut 150 000 000 GNF HT (350 000 000 moins les 200 000 000
déjà facturés). À l'étape 2, « Le cumul des travaux doit dépasser celui de la situation
précédente. ». À l'étape 3, « Le cumul dépasse le montant du marché : établissez d'abord un
avenant. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### BTP-05. Annuler une situation saisie

Objectif : vérifier l'annulation d'une situation non facturée, avec confirmation.

Compte : test.chantiers.

Données : une situation en brouillon.

1. Sur la situation, cliquez sur « Annuler ».
2. Lisez la fenêtre, fermez-la par « Annuler ».
3. Recommencez et confirmez par « Annuler la situation ».

Résultat attendu : la fenêtre demande « Annuler cette situation saisie ? Elle ne sera pas facturée. ».
Fermée sans confirmer, rien ne change ; confirmée, la situation est annulée et n'est pas facturée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### BTP-06. Modifier un chantier : avenant et réception

Objectif : vérifier l'avenant au marché et la réception provisoire.

Compte : test.chantiers.

Données : le chantier de BTP-02 ; avenant HT 100 000 000 ; état réceptionné, réception provisoire à
la date du jour.

1. Ouvrez le chantier, puis « Modifier le chantier ».
2. Saisissez l'avenant dans « Avenant HT (GNF) » et enregistrez.
3. Rouvrez « Modifier le chantier », passez l'état à réceptionné sans date de réception, enregistrez.
4. Ajoutez la date de réception, enregistrez.

Résultat attendu : le marché passe à 900 000 000 GNF HT. À l'étape 3, l'enregistrement est refusé :
« Date requise pour un chantier réceptionné. ». À l'étape 4, le chantier est réceptionné. Une fois
une situation facturée, le champ « Retenue de garantie (%) » est figé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## B. Finance pour le BTP

### BTP-07. Lire le chantier comme la finance

Objectif : vérifier que la finance voit les commandes de facturation que le profil BTP n'a pas.

Compte : test.daf.

Données : le chantier de BTP-02.

1. Ouvrez Finance > Métiers > BTP, puis le chantier.
2. Regardez la situation de BTP-03.

Résultat attendu : la situation propose « Facturer ». Le chantier propose « Libérer les retenues »
(grisé tant qu'aucune retenue n'est à libérer).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### BTP-08. Facturer une situation

Objectif : vérifier la facture de la période et la retenue de garantie portée en 4117.

Compte : test.daf.

Données : la situation de BTP-03 (200 000 000 GNF HT).

1. Sur la situation, cliquez sur « Facturer ».
2. Lisez la fenêtre, puis confirmez.
3. Ouvrez Comptabilité > Ventes et la facture créée.

Résultat attendu : la fenêtre annonce « Facturer la situation n° 1 ? La facture de 200 000 000 GNF HT
est validée et la retenue de garantie comptabilisée. ». La facture au maître d'ouvrage est validée ;
la retenue de 10 000 000 GNF figure dans les retenues à recouvrer du chantier.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### BTP-09. Annuler une situation facturée par un avoir

Objectif : vérifier qu'une situation facturée s'annule par un avoir et que son cumul redevient
facturable.

Compte : test.daf.

Données : la dernière situation facturée d'un chantier, non réglée par le client.

1. Sur la situation, cliquez sur « Annuler par un avoir ».
2. Lisez la fenêtre, puis confirmez.

Résultat attendu : la fenêtre précise que l'avoir de la facture et l'extourne de la retenue sont
comptabilisés ce jour et que le cumul redevient facturable. La situation porte « Annulée (avoir …) ».
Seule la dernière situation facturée propose ce bouton.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### BTP-10. Libérer les retenues de garantie

Objectif : vérifier qu'à la réception, les retenues redeviennent exigibles du client.

Compte : test.daf.

Données : un chantier dont au moins une situation est facturée (par exemple celui de BTP-08).

1. Ouvrez le chantier, puis « Libérer les retenues ».
2. Lisez la fenêtre, puis confirmez.

Résultat attendu : la fenêtre annonce le montant qui passe de 4117 au compte du client. Le message
« Retenues libérées : elles redeviennent exigibles du client. » s'affiche ; le chantier indique
ensuite les retenues « Libérées et non encore réglées par le client », exigibles et relancées.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## C. Immobilier

### IMM-01. Lire l'écran Immobilier

Objectif : vérifier la synthèse du patrimoine et les trois onglets.

Compte : test.immobilier.

Données : aucune.

1. Connectez-vous et ouvrez Finance : l'écran « Immobilier » s'affiche.
2. Lisez « Biens », « Loyers annuels », « Valeur du patrimoine », « Rendement brut » et « Loyers
   impayés ».
3. Ouvrez les onglets « Biens et baux », « Loyers émis » et « Impayés et relances ».

Résultat attendu : les biens fictifs figurent, l'un « Loué », l'autre « Libre ». Le taux d'occupation,
les loyers annuels et le rendement correspondent aux baux en cours.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### IMM-02. Créer un bien

Objectif : vérifier l'enregistrement d'un bien et sa valeur.

Compte : test.immobilier.

Données : « Magasin de Matoto (essai) » ; nature magasin ; surface 180 ; adresse « Matoto,
Conakry » ; valeur d'acquisition 900 000 000 ; valeur actuelle 1 000 000 000.

1. Onglet « Biens et baux », « Nouveau bien ».
2. Remplissez « Désignation », « Nature », « Surface (m²) », « Adresse », « Valeur d'acquisition
   (GNF) » et « Valeur actuelle (GNF) » ; laissez « Date de l'évaluation » vide.
3. Cliquez sur « Enregistrer ».

Résultat attendu : « Bien enregistré. ». Le bien est « Libre » ; la valeur du patrimoine augmente de
1 000 000 000 GNF ; la date de l'évaluation est celle du jour.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### IMM-03. Louer un bien et activer le bail

Objectif : vérifier la signature d'un bail et le démarrage du quittancement.

Compte : test.immobilier.

Données : le bien de IMM-02 ; bail « BAIL-ESSAI-01 » ; locataire « Essai Commerce Matoto SARL » (à
créer depuis le champ) ; prise d'effet au premier jour du mois précédent ; mensuel ; loyer HT
8 000 000 ; charges 500 000 ; dépôt de garantie 16 000 000 ; bail soumis à la TVA.

1. En face du bien, cliquez sur « Louer ». La fenêtre « Bail, Magasin de Matoto (essai) » s'ouvre.
2. Remplissez « Référence du bail », « Locataire », la prise d'effet, « Périodicité », « Loyer HT par
   période (GNF) », « Charges par période (GNF) », « Dépôt de garantie (GNF) » ; cochez « Bail
   soumis à la TVA ». Laissez « Échéance du bail » et « Premier loyer à émettre » vides.
3. Cliquez sur « Signer et activer le bail », lisez la fenêtre, puis confirmez.

Résultat attendu : la fenêtre annonce que les loyers échus depuis la prise d'effet seront émis et
validés à la prochaine émission, au plus tard la nuit suivante. Le message « Bail BAIL-ESSAI-01
activé : le quittancement démarre. » s'affiche ; le bien est « Loué ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### IMM-04. Émettre les loyers échus

Objectif : vérifier l'émission immédiate des loyers dus, une facture par échéance.

Compte : test.immobilier.

Données : le bail de IMM-03.

1. Cliquez sur « Émettre les loyers échus », en haut de l'écran.
2. Lisez la fenêtre, puis « Émettre les loyers ».
3. Ouvrez l'onglet « Loyers émis ».
4. Recommencez l'émission.

Résultat attendu : la fenêtre rappelle qu'une facture validée ne s'annule que par un avoir. Les loyers
du mois précédent et du mois en cours sont émis : une facture par échéance, datée de l'échéance. À
l'étape 4, « Aucun loyer échu à émettre. » : rien n'est émis deux fois.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### IMM-05. Délivrer la quittance d'un loyer réglé

Objectif : vérifier qu'une quittance n'est délivrée que pour un loyer entièrement réglé.

Compte : test.daf (encaissement), puis test.immobilier.

Données : deux loyers émis en IMM-04.

1. test.immobilier : onglet « Loyers émis ». Regardez les deux loyers.
2. test.daf : Comptabilité > Ventes, ouvrez la facture du premier loyer, « Encaisser », tout le reste
   dû.
3. test.immobilier : rechargez « Loyers émis ». Sur le loyer réglé, cliquez sur « Quittance ».
4. Dans « Quittance de loyer », cliquez sur « Imprimer ».

Résultat attendu : avant l'encaissement, aucun loyer ne propose « Quittance ». Après, le loyer réglé
la propose ; la quittance porte le bailleur, le locataire, le bien, la période et le montant. Le
loyer non réglé n'en propose toujours pas.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### IMM-06. Suivre les loyers impayés

Objectif : vérifier la liste des loyers échus non réglés.

Compte : test.immobilier.

Données : le second loyer de IMM-05, non réglé.

1. Ouvrez l'onglet « Impayés et relances ».
2. Lisez le locataire, l'échéance, le retard en jours et le reste dû.

Résultat attendu : le loyer non réglé figure avec son retard. Les relances (rappel, relance ferme,
mise en demeure) sont préparées par la finance dans Relances clients.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### IMM-07. Enregistrer un bail en attente sur un bien loué

Objectif : vérifier qu'un bien n'a qu'un bail en cours, et qu'un second bail attend la fin du premier.

Compte : test.immobilier.

Données : le bien « Bureaux Kaloum, 2e étage (démo) » ; bail « BAIL-ESSAI-02 », locataire « Démo -
Locataire des bureaux », prise d'effet dans trois mois.

1. Ouvrez le bien, puis « Nouveau bail ».
2. Remplissez le bail. Lisez le bouton proposé, puis « Enregistrer en attente ».

Résultat attendu : la fenêtre indique « Le bien a un bail en cours : enregistrez celui-ci en
attente. ». Le message « Bail BAIL-ESSAI-02 enregistré en attente : activez-le quand le bien sera
libre. » s'affiche ; le bail figure « Bail en attente » dans « Baux du bien ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### IMM-08. Mettre fin à un bail

Objectif : vérifier la fin de bail immédiate ou programmée, avec confirmation.

Compte : test.immobilier.

Données : le bail de IMM-03 ; d'abord une date de fin dans deux mois, puis la date du jour.

1. En face du bien, cliquez sur « Fin de bail ». Saisissez une « Date de fin » dans deux mois,
   « Programmer la fin du bail », lisez la fenêtre, puis confirmez.
2. Rouvrez « Fin de bail », saisissez la date du jour, « Mettre fin au bail », lisez la fenêtre, puis
   confirmez.

Résultat attendu : étape 1, « Fin du bail BAIL-ESSAI-01 programmée au … » : le bail reste en cours
jusque-là. Étape 2, la fenêtre précise que c'est définitif ; puis « Bail BAIL-ESSAI-01 résilié : le
bien est libre. ». Si des loyers ont été émis au-delà de la date, le message le signale : la
période en trop s'annule par un avoir (finance).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### IMM-09. Réévaluer un bien

Objectif : vérifier que la valeur actuelle d'un bien met à jour le patrimoine et le rendement.

Compte : test.immobilier.

Données : « Villa Kipé (démo) » ; valeur actuelle 2 500 000 000.

1. Ouvrez le bien, puis « Modifier le bien ».
2. Saisissez la « Valeur actuelle (GNF) », laissez « Date de l'évaluation » vide, puis
   « Enregistrer ».
3. Relisez « Valeur du patrimoine » et « Rendement brut ».

Résultat attendu : la valeur du bien porte « Évaluée le » avec la date du jour ; la valeur du
patrimoine et le rendement brut sont recalculés.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## D. Refus attendus

### BTP-11. Le profil BTP ne facture pas

Objectif : vérifier que la facturation et la libération des retenues sont réservées à la finance.

Compte : test.chantiers.

Données : une situation en brouillon ; un chantier avec des retenues.

1. Ouvrez le chantier.

Résultat attendu : la situation affiche « À facturer » au lieu du bouton « Facturer ». Ni « Annuler
par un avoir » ni « Libérer les retenues » ne sont proposés.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### BTP-12. Chaque métier ne voit que son écran

Objectif : vérifier que le BTP ne voit pas l'immobilier, et inversement.

Compte : test.chantiers, puis test.immobilier.

Données : aucune.

1. test.chantiers : ouvrez le menu « Métiers ».
2. test.immobilier : ouvrez le menu « Métiers ».

Résultat attendu : test.chantiers ne voit que « BTP » ; test.immobilier ne voit que « Immobilier ».
Aucun des deux ne voit « Tableau de bord », « Ventes » ou « Trésorerie ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### BTP-13. Pas de BTP ni d'immobilier dans les livres de MB AxisPro Consulting

Objectif : vérifier que ces métiers ne servent qu'EGUITRA GROUP SARLU.

Compte : test.daf.

Données : aucune.

1. Passez à la société MB AxisPro Consulting (en haut à droite, « Livres ouverts »).
2. Ouvrez le menu « Métiers ».
3. Dans la barre d'adresse, remplacez la fin de l'adresse par /finance/chantiers et validez.

Résultat attendu : le menu « Métiers » n'apparaît pas. À l'étape 3, l'écran n'affiche aucun chantier
et indique « Ce module ne concerne qu'EGUITRA GROUP SARLU : choisissez cette société en haut de
l'écran, ou ouvrez l'application qui la sert. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### IMM-10. La direction consulte l'immobilier sans le modifier

Objectif : vérifier que la direction lit les biens et les baux sans pouvoir les modifier.

Compte : test.dg.

Données : aucune.

1. Ouvrez Finance > Métiers > Immobilier, puis un bien.

Résultat attendu : biens, baux et loyers sont lisibles. Ni « Nouveau bien », ni « Louer », ni « Fin de
bail », ni « Émettre les loyers échus » ne sont proposés.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## E. Contrôles de saisie et de sécurité

### BTP-14. Nombres écrits à la française

Objectif : vérifier qu'un montant ou un pourcentage ambigu est refusé avec un message.

Compte : test.chantiers, puis test.immobilier.

Données : marché « 800 000 000 » puis « 800.000.000 » ; avancement « 12,5 » ; loyer « 8 000 000 » puis
« 8.000.000 ».

1. « Nouveau chantier » : saisissez « 800.000.000 » dans « Montant du marché HT (GNF) », puis
   « 800 000 000 ».
2. « Nouvelle situation » sur un chantier : « Avancement cumulé (%) » 12,5.
3. test.immobilier : « Louer » un bien libre, « Loyer HT par période (GNF) » « 8.000.000 », puis
   « 8 000 000 ».

Résultat attendu : « 800.000.000 » et « 8.000.000 » sont refusés par le message « Nombre illisible :
écrivez par exemple 750 000 ou 2,5. » sous le champ, et l'enregistrement est bloqué.
« 800 000 000 », « 12,5 » et « 8 000 000 » sont acceptés.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### IMM-11. Date d'échéance de fin de mois refusée

Objectif : vérifier qu'un premier loyer fixé au 29, 30 ou 31 est refusé avec une explication.

Compte : test.immobilier.

Données : un bien libre ; premier loyer à émettre au 31 du mois.

1. « Louer » le bien, saisissez le bail avec « Premier loyer à émettre » au 31.
2. Tentez d'activer le bail.

Résultat attendu : le message « Échéance le 29, 30 ou 31 : elle glisserait au 28 après un mois
court. Choisissez une date du 1er au 28 ; les jours précédents se facturent à part. » s'affiche et
le bail ne peut pas être activé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### IMM-12. Un double clic n'émet les loyers qu'une fois

Objectif : vérifier qu'un double clic sur une émission ou une facturation n'enregistre qu'une fois.

Compte : test.immobilier, puis test.daf.

Données : un bail dont un loyer est échu et non émis ; une situation de chantier en brouillon.

1. test.immobilier : « Émettre les loyers échus », puis double-cliquez sur « Émettre les loyers ».
2. Onglet « Loyers émis » : comptez les factures de l'échéance.
3. test.daf : double-cliquez sur « Facturer » d'une situation, puis confirmez.

Résultat attendu : une seule facture par échéance de loyer ; une seule facture pour la situation.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## Synthèse

| Partie {52} | Scénarios {12} | Réussis {12} | Échoués {12} | Non joués {12} |
|---|---|---|---|---|
| A. BTP | 6 | | | |
| B. Finance pour le BTP | 4 | | | |
| C. Immobilier | 9 | | | |
| D. Refus attendus | 4 | | | |
| E. Contrôles de saisie et de sécurité | 3 | | | |
| Total | 26 | | | |

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
