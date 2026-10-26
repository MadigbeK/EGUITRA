# Cahier de test : Transport et Rotations

NIMOVA · Transport (au bureau) et NIMOVA · Rotations (au téléphone), pour EGUITRA GROUP SARLU.

Rotations, fiche rotation, validation par un autre compte, départ en route, facturation, flotte et
chauffeurs, routes et barème officiel, propriétaires, manquants, taxes ; saisie au parc hors
réseau, correction et envoi.

| Rubrique {28} | À remplir {72} |
|---|---|
| Module | Transport (bureau) et Rotations (téléphone) |
| Version de la plateforme | ______ (communiquée par E-VOLUTION XP) |
| Date du test | ______ |
| Nom du testeur | ______ |
| Fonction | ______ |
| Profil utilisé | ______ |
| Compte de test | ______ |
| Société | EGUITRA GROUP SARLU |
| Téléphone utilisé (Rotations) | ______ |

Document préparé par E-VOLUTION XP le 26 octobre 2026, d'après les écrans de la plateforme à cette
date.

<!-- saut de page -->

## Mode d'emploi

Ce cahier se joue sur la recette : une copie complète de NIMOVA, avec des données fictives repérées
« Démo ». Rien de ce que vous y faites ne touche les vrais comptes : vous pouvez tout essayer, y
compris les erreurs.

1. Se connecter. Au bureau : ouvrez l'adresse de la recette communiquée par E-VOLUTION XP, dans
   Chrome ou Edge, puis la tuile Transport de l'accueil. Au parc : sur le téléphone, ouvrez dans
   Chrome l'adresse de la recette suivie de /mobile. Identifiant : le compte de test indiqué dans le
   scénario. Mot de passe : le mot de passe commun de la recette, communiqué par E-VOLUTION XP.
2. Jouer un scénario. Suivez les étapes dans l'ordre, avec les données indiquées. Un scénario à deux
   comptes se joue dans deux navigateurs (Chrome et Edge), sur deux postes, ou au bureau et au
   téléphone. Notez le numéro des rotations créées : d'autres scénarios s'en servent.
3. Noter le résultat. Cochez « Réussi » si l'écran correspond au résultat attendu, sinon « Échoué ».
   Dans « Remarques », notez ce qui diffère : l'écran, le message affiché, l'heure.
4. Signaler une anomalie. Au bureau, menu du compte (rond à vos initiales, en haut à droite) > « Mes
   demandes » > « Nouvelle demande », type « Remarque de recette », application NIMOVA · Transport ou
   NIMOVA · Rotations, la gravité ; titre commençant par le numéro du scénario (par exemple « TRA-23 :
   saisie hors réseau perdue ») ; description ; « Déposer la demande ». Reportez le numéro reçu
   (DEM-…) dans les remarques.

## Comptes de test

| Compte {18} | Profil {18} | Où {20} | Rôle dans ce cahier {44} |
|---|---|---|---|
| test.exploitation | Exploitation | bureau | saisie, départ en route, validation, référentiels |
| test.parc | Exploitation | téléphone et bureau | saisie au parc, validation des saisies du bureau |
| test.daf | Finance | bureau | facturation, prix du carburant, propriétaires, paramètres |
| test.dg | Direction | bureau | rentabilité, consultation |
| test.chantiers | BTP | bureau | refus |

Données fictives utiles : ensembles DEMO-01, DEMO-02 et DEMO-03 (citernes de 33 m³), chauffeurs
« Chauffeur démo A », « B » et « C », routes « Conakry - Kankan (démo) » (450 000 GNF par m³),
« Conakry - Labé (démo) » et « Conakry - Siguiri (démo) », clients « Démo - Distributeur pétrolier
A » et « Démo - Société minière B » (tarif négocié de 600 000 GNF par m³ sur Conakry - Siguiri).

## A. Exploitation au bureau

### TRA-01. Lire le tableau de bord du transport

Objectif : vérifier que le tableau de bord donne l'activité du mois et ce qui reste à traiter.

Compte : test.exploitation.

Données : aucune.

1. Ouvrez NIMOVA · Transport, Exploitation > Tableau de bord.
2. Lisez « Volume livré ce mois », « Flotte », « Chiffre d'affaires du mois », « Marge du mois »,
   « À facturer » et « Saisies à valider ».
3. Lisez « Contrôles de la flotte et des rotations ».

Résultat attendu : la page « Transport pétrolier » s'affiche avec les chiffres du mois. La flotte se
répartit entre « En service », « En maintenance » et « Hors service ». Les contrôles signalent les
anomalies de la flotte et des rotations, ou « Conforme ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-02. Saisir une rotation au bureau

Objectif : vérifier la saisie d'une rotation et l'estimation de sa marge avant l'enregistrement.

Compte : test.exploitation.

Données : ensemble DEMO-01 ; client « Démo - Distributeur pétrolier A » ; route « Conakry - Kankan
(démo) » ; produit gasoil ; bon de livraison « BL-ESSAI-201 » ; volume chargé 33 ; volume livré
32,95 ; carburant 3 200 000 ; péages 250 000 ; frais du chauffeur 600 000.

1. Ouvrez Exploitation > Rotations, puis « Nouvelle rotation ».
2. Choisissez l'« Ensemble routier » : laissez « Chauffeur » vide (chauffeur habituel).
3. Choisissez le « Produit », le « Client » et la « Route ». Laissez « Tarif (m³) » et « Distance
   parcourue (km) » vides.
4. Saisissez les dates, le « Bon de livraison », les volumes et les frais.
5. Lisez « Montant estimé », « Coût standard de la route » et « Marge estimée », puis
   « Enregistrer ».

Résultat attendu : le montant estimé suit le tarif de la route (450 000 GNF par m³). La rotation est
créée à l'état saisi et figure dans le filtre « Saisies à valider ». En bas de la fenêtre, la mention
« La validation revient à un autre compte que celui qui saisit. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-03. Faire valider la rotation par un autre compte

Objectif : vérifier qu'une rotation n'est jamais validée par le compte qui l'a saisie.

Compte : test.exploitation, puis test.parc au bureau.

Données : la rotation de TRA-02.

1. test.exploitation : dans la liste, cliquez sur la rotation. Sa fiche « Rotation … » s'ouvre.
2. Regardez le bouton « Valider » et le message de la fiche.
3. test.parc : ouvrez NIMOVA · Transport au bureau, Exploitation > Rotations, ouvrez la même fiche
   et cliquez sur « Valider ».

Résultat attendu : chez test.exploitation, « Valider » est grisé et la fiche indique « Vous avez saisi
cette rotation : elle se valide par un autre compte. ». Chez test.parc, la validation aboutit : la
rotation passe dans « À facturer (validées) ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-04. Faire partir une rotation en route

Objectif : vérifier le départ en route d'une rotation saisie, donné par l'exploitation.

Compte : test.exploitation.

Données : une rotation à l'état saisi sur DEMO-01, dont les documents sont à jour (TRA-08).

1. Ouvrez la fiche de la rotation.
2. Lisez les éventuels encadrés « Départ impossible pour l'instant : » ou « À noter avant le
   départ : ».
3. Cliquez sur « Départ en route ».
4. Revenez à la liste, filtre « En route ».

Résultat attendu : la rotation passe à « En route » ; la fiche indique qui a donné le départ
(« départ donné par … »). Elle se valide ensuite par un compte autre que celui qui l'a saisie.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-05. Corriger une rotation validée

Objectif : vérifier qu'une correction remet la rotation en saisie, pour une nouvelle validation.

Compte : test.exploitation.

Données : une rotation validée et non facturée ; volume livré corrigé à 32,90.

1. Ouvrez la fiche de la rotation validée. Lisez l'encadré.
2. Modifiez le « Volume livré (m³) », puis « Enregistrer ».
3. Regardez l'état de la rotation.

Résultat attendu : l'encadré annonce « Corriger une rotation validée la remet en saisie : un autre
compte la revalide. ». Après l'enregistrement, la rotation est revenue à l'état saisi et figure dans
« Saisies à valider ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-06. Lire et trier la liste des rotations

Objectif : vérifier les filtres, le tri et la marge estimée de la liste.

Compte : test.exploitation.

Données : aucune.

1. Exploitation > Rotations. Dans « Statut », passez de « À traiter (saisies, en route, à facturer) »
   à « Facturées », puis à « Toutes ».
2. Cliquez sur l'en-tête de la colonne « Marge (GNF) », puis de nouveau.
3. Si la liste dépasse cent rotations, utilisez « Suivantes » et « Précédentes ».
4. Repérez une rotation sans frais saisis.

Résultat attendu : chaque filtre ne montre que les rotations de son état. Le tri porte sur toutes les
rotations du filtre, pas seulement sur la page affichée. Une rotation sans frais montre une marge
estimée avec le coût standard de la route.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-07. Ajouter un chauffeur

Objectif : vérifier la création d'un chauffeur et le suivi de la validité de son permis.

Compte : test.exploitation.

Données : nom « Chauffeur essai D » ; téléphone « +224 600 00 00 09 » ; permis « P-77881 », valable
jusqu'au 31 décembre de l'an prochain ; puis une date passée.

1. Ouvrez Référentiels > Flotte et chauffeurs, bloc « Chauffeurs ».
2. Remplissez « Nom », « Téléphone », « N° de permis » et « Permis valable jusqu'au », puis
   « Ajouter le chauffeur ».
3. Changez la date du permis pour une date passée.

Résultat attendu : le chauffeur apparaît dans la liste. Avec une date passée, son permis est marqué
« Expiré ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-08. Tenir les documents d'un ensemble

Objectif : vérifier l'enregistrement des documents exigés d'un ensemble et de leur échéance.

Compte : test.exploitation.

Données : ensemble DEMO-01 ; les quatre documents exigés, « Assurance », « Visite technique »,
« Barémage de la citerne » et « Certificat d'étanchéité de la citerne », chacun avec un numéro
(par exemple « AS-2026-554 »), délivré par « Organisme d'essai », valable du 1er janvier au 31
décembre de l'année ; une attestation en PDF.

1. Flotte et chauffeurs, bloc « Ensembles routiers » : cliquez sur l'état des documents de DEMO-01
   (par exemple « manquants ou expirés »). La fenêtre « Documents de DEMO-01 » s'ouvre.
2. « Ajouter un document » : remplissez « Document », « Numéro », « Délivré par », « Valable à partir
   du », « Valable jusqu'au ». Recommencez pour les quatre documents, puis « Enregistrer ».
3. Sur l'assurance enregistrée, « Joindre la pièce ».

Résultat attendu : les documents figurent avec leurs dates et la pièce jointe ; l'état des documents
de DEMO-01 passe à jour. Un renouvellement s'ajoute comme un nouveau document ; l'ancien reste à
l'historique.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-09. Ajouter une route

Objectif : vérifier la création d'une route et le contrôle de ses distances.

Compte : test.exploitation.

Données : route « Conakry - Mamou (essai) » ; aller 270 km ; aller-retour 540 km ; durée 3 jours ;
tarif 260 000 GNF par m³ ; puis un aller-retour de 700 km.

1. Ouvrez Référentiels > Routes et tarifs, bloc « Routes tarifées ».
2. Remplissez la nouvelle route, puis « Ajouter la route ».
3. Remplacez l'aller-retour par 700 km.

Résultat attendu : la route apparaît avec ses distances et son tarif. Avec 700 km, l'aller-retour est
marqué « Incohérent » (écart de plus de 15 % avec deux fois l'aller).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-10. Consulter le barème officiel

Objectif : vérifier la lecture du barème officiel et sa comparaison avec les tarifs des routes.

Compte : test.exploitation.

Données : dépôt de Conakry ; destination « Siguiri ».

1. Ouvrez Référentiels > Barème officiel. Lisez l'en-tête (autorité, date de signature).
2. Choisissez le « Dépôt », puis saisissez « Siguiri » dans « Destination ou préfecture ».
3. Lisez « Tarif (GNF/L) », « Par m³ (GNF) » et « Distance estimée (km) ».
4. Ouvrez Routes et tarifs et lisez la colonne « Barème officiel (GNF par m³) » de « Conakry - Siguiri
   (démo) ».

Résultat attendu : le barème donne le tarif officiel par litre et par m³. Dans Routes et tarifs,
l'écart entre le tarif de la route et le barème est affiché ; au-delà de la tolérance, il est
signalé en couleur.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-11. Suivre les manquants

Objectif : vérifier le suivi des manquants tolérés et hors tolérance.

Compte : test.exploitation.

Données : le mois en cours.

1. Ouvrez Exploitation > Manquants. Choisissez la période (« Du », « Au »).
2. Sous « Par », passez de « Ensemble routier » à chauffeur, client et route.
3. Lisez « Manquant total », « Hors tolérance », « Valeur hors tolérance » et le bloc « Rotations
   hors tolérance ».

Résultat attendu : les manquants se regroupent selon le choix ; les rotations au-delà de la
tolérance sont listées avec leur valeur, ou le message « Aucune rotation au-delà de la tolérance sur
la période. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-12. Exporter les rotations

Objectif : vérifier l'export des rotations dans Excel.

Compte : test.exploitation.

Données : les rotations du mois.

1. Exploitation > Rotations, « Exporter les rotations ».
2. Choisissez les dates de chargement, le « Statut » « Validées et facturées » et le « Format »
   « Excel (XLSX) ».
3. Ouvrez le fichier.

Résultat attendu : le classeur contient une ligne par rotation, une colonne par frais, puis les
kilomètres et les ratios ; les montants sont des nombres.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## B. Finance et direction

### TRA-13. Facturer les rotations validées

Objectif : vérifier qu'une facture par client est créée, avec une ligne par rotation.

Compte : test.daf.

Données : deux rotations validées du même client (par exemple « Démo - Distributeur pétrolier A »).

1. Exploitation > Rotations, « Statut » : « À facturer (validées) ».
2. Cochez les deux rotations, puis « Facturer la sélection ».
3. Ouvrez NIMOVA · Finance > Comptabilité > Ventes, vue « Brouillons ».
4. Ouvrez la facture, vérifiez-la, puis « Valider ».

Résultat attendu : le message « 1 facture créée en brouillon, à valider dans Ventes. » s'affiche. La
facture du client porte une ligne par rotation (et, s'il y a lieu, les taxes refacturées et la
déduction du manquant). Les rotations passent dans « Facturées ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-14. Enregistrer un nouveau prix du carburant

Objectif : vérifier qu'un nouveau prix du carburant change le coût standard des nouvelles rotations
sans réécrire les rotations validées.

Compte : test.daf.

Données : prix du litre 13 000 GNF à partir du jour ; source « Structure des prix (essai) ».

1. Ouvrez Référentiels > Routes et tarifs, bloc « Prix du carburant ».
2. Remplissez « À partir du », « Prix du litre (GNF) » et « Source », puis « Enregistrer le prix ».
3. Notez la marge d'une rotation validée avant ce jour, puis rouvrez-la.
4. Saisissez une nouvelle rotation sur une route qui a un forfait de carburant : lisez le « Coût
   standard de la route ».

Résultat attendu : le prix apparaît dans la liste. La rotation validée garde son coût standard et sa
marge. La nouvelle rotation calcule son coût standard avec 13 000 GNF le litre.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-15. Appliquer le tarif négocié d'un client

Objectif : vérifier que le tarif d'un client sur une route prime sur le tarif de la route.

Compte : test.daf, puis test.exploitation.

Données : client « Démo - Société minière B », route « Conakry - Siguiri (démo) », tarif négocié de
600 000 GNF par m³ (déjà en place).

1. test.daf : Routes et tarifs, bloc « Tarifs des clients » : vérifiez le tarif.
2. test.exploitation : saisissez une rotation pour ce client sur cette route, sans tarif.
3. Ouvrez la fiche de la rotation et lisez « Tarif appliqué ».

Résultat attendu : la rotation prend 600 000 GNF par m³, et non le tarif de la route.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-16. Déclarer un ensemble géré et une règle de répartition

Objectif : vérifier la propriété d'un ensemble géré pour un propriétaire et la part retenue par la
société.

Compte : test.daf.

Données : ensemble DEMO-02, géré pour le propriétaire « Démo - Garage poids lourds » (propriétaire
fictif) ; charge mensuelle « Assurance » 1 500 000 GNF ; règle de 5 % du chiffre d'affaires pour la
société.

1. Flotte et chauffeurs : pour DEMO-02, dans la colonne « Propriété », choisissez « Géré pour un
   propriétaire », puis le propriétaire.
2. Dans la colonne « Charges / mois (GNF) » de DEMO-02, cliquez sur « Saisir ». « Ajouter une
   charge » : « Charge », « Montant », « Périodicité ».
3. Ouvrez Gestion > Propriétaires et répartition, bloc « Règles de répartition » : ajoutez la règle
   (« Ensemble ou catégorie… », « Bénéficiaire… », « Taux (% du chiffre d'affaires) »).

Résultat attendu : DEMO-02 est marqué géré, avec sa charge mensuelle. La règle apparaît dans « Règles
de répartition ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-17. Établir le relevé d'un propriétaire et préparer ses pièces

Objectif : vérifier le relevé mensuel, ses exports et ses pièces en brouillon.

Compte : test.daf.

Données : le mois en cours, avec au moins une rotation validée sur DEMO-02.

1. Propriétaires et répartition : choisissez le « Mois », puis « Établir les relevés du mois ».
2. Ouvrez le relevé de DEMO-02 : lisez le chiffre d'affaires, les charges, la marge, les commissions
   et la part du propriétaire.
3. Cliquez sur « PDF », puis « Excel ».
4. Cliquez sur « Préparer les pièces ».
5. Cliquez sur « Rouvrir ».

Résultat attendu : étape 4, « Pièces préparées en brouillon, à valider dans Achats et Ventes. » ; la
facture d'achat du propriétaire (ou une facture au propriétaire si la part est négative) apparaît en
brouillon dans Finance. Étape 5, « Pièces en brouillon supprimées, relevé rouvert. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-18. Lire l'état des taxes spécifiques

Objectif : vérifier l'état mensuel des taxes spécifiques et son export.

Compte : test.daf.

Données : le mois en cours.

1. Ouvrez Gestion > Taxes spécifiques. Choisissez la période.
2. Lisez le tableau par nature et le bloc « Comptabilisé sur les comptes du barème, en GNF ».
3. Cliquez sur « Export XLSX ».

Résultat attendu : les taxes sont détaillées par nature, avec la part refacturée et le total, et
rapprochées des montants comptabilisés. Sans barème, le message invite à le paramétrer.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-19. Régler le traitement des manquants

Objectif : vérifier le paramétrage des manquants par la finance.

Compte : test.daf.

Données : tolérance de 0,5 % ; traitement « Déduction sur la facture du client ».

1. Ouvrez Référentiels > Paramètres.
2. Modifiez la tolérance de manquant et le traitement du manquant hors tolérance, puis enregistrez.
3. Remettez les valeurs d'origine.

Résultat attendu : les nouvelles valeurs sont enregistrées et s'appliquent aux rotations saisies
ensuite. Les choix proposés sont « Constat seulement », « Déduction sur la facture du client »,
« Créance sur le chauffeur » et « Déduction et créance sur le chauffeur ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-20. Analyser la rentabilité

Objectif : vérifier que la direction lit la marge par ensemble, route, chauffeur, client et mois.

Compte : test.dg.

Données : le mois en cours, puis l'exercice.

1. Ouvrez Gestion > Rentabilité. Choisissez la période (« Du », « Au »).
2. Sous « Par », passez de « Ensemble routier » à route, chauffeur, client et mois.
3. Lisez « Chiffre d'affaires transport », « Marge directe », « Structure au km » et « Ensembles
   déficitaires ».
4. Comparez les colonnes « Coûts standard (GNF) », « Coûts déclarés (GNF) » et « Coûts comptabilisés
   (GNF) ».

Résultat attendu : chaque regroupement donne le volume, le chiffre d'affaires, les coûts et la marge.
Les trois sortes de coûts sont côte à côte, avec leur écart.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## C. Parc : Rotations au téléphone

### TRA-21. Installer Rotations sur le téléphone

Objectif : vérifier l'installation de l'application sur l'écran d'accueil et la connexion.

Compte : test.parc.

Données : un téléphone Android avec Chrome, du réseau.

1. Dans Chrome, ouvrez l'adresse de la recette suivie de /mobile.
2. Connectez-vous avec test.parc et le mot de passe commun.
3. Menu de Chrome > « Ajouter à l'écran d'accueil ».
4. Fermez Chrome, puis ouvrez Rotations depuis l'icône.

Résultat attendu : l'icône Rotations apparaît sur l'écran d'accueil. L'application s'ouvre sur ses
trois onglets « Nouvelle », « À envoyer » et « Envoyées », avec la pastille « En ligne ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-22. Saisir une rotation avec du réseau

Objectif : vérifier qu'une rotation saisie au parc part aussitôt au bureau.

Compte : test.parc (téléphone), puis test.exploitation (bureau).

Données : ensemble DEMO-03 ; client « Démo - Société minière B » ; route « Conakry - Labé
(démo) » ; bon de livraison « BL-PARC-301 » ; volume chargé 33.

1. Onglet « Nouvelle » : remplissez « Date de chargement », « Ensemble routier » (le chauffeur
   habituel se remplit), « Client », « Route », « Produit », « Bon de livraison » et « Volume chargé
   (m³) ».
2. Touchez « Enregistrer la rotation ».
3. Ouvrez l'onglet « Envoyées ».
4. test.exploitation : ouvrez Rotations au bureau, filtre « Saisies à valider ».

Résultat attendu : « Rotation enregistrée » s'affiche ; avec la pastille « En ligne », l'envoi est
immédiat. La rotation figure dans « Envoyées » (« Reçue au bureau ») et, au bureau, avec la mention
de saisie au téléphone. Le téléphone n'affiche ni tarif ni marge.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-23. Saisir hors réseau, puis envoyer au retour du réseau

Objectif : vérifier que les saisies sans réseau sont gardées sur le téléphone et partent seules, sans
doublon.

Compte : test.parc.

Données : deux rotations : DEMO-01, bon « BL-PARC-302 » ; DEMO-02, bon « BL-PARC-303 ».

1. Passez le téléphone en mode avion. La pastille indique « Hors réseau ».
2. Saisissez les deux rotations et touchez « Enregistrer la rotation » pour chacune.
3. Ouvrez « À envoyer » : les deux saisies y sont, « En attente ».
4. Fermez l'application, rouvrez-la (toujours en mode avion) : les saisies sont toujours là.
5. Quittez le mode avion et attendez quelques secondes (ou touchez « Envoyer »).
6. Au bureau, cherchez les deux bons de livraison.

Résultat attendu : hors réseau, l'écran indique « Hors réseau : la saisie attendra le réseau ». Au
retour du réseau, « À envoyer » se vide (« Toutes vos saisies ont été transmises. ») et chaque
rotation n'existe qu'une fois au bureau.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-24. Corriger une saisie en attente

Objectif : vérifier la correction d'une saisie encore sur le téléphone.

Compte : test.parc.

Données : une saisie hors réseau avec un volume chargé de 31, à corriger en 33.

1. En mode avion, saisissez la rotation et enregistrez-la.
2. Dans « À envoyer », touchez « Corriger » sur la saisie.
3. Le formulaire indique « Correction d'une saisie en attente. » : corrigez le volume, puis
   « Enregistrer la correction ».
4. Quittez le mode avion.

Résultat attendu : la saisie corrigée part avec le volume de 33 ; une seule rotation est créée au
bureau.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-25. Volume au-delà de la capacité du camion

Objectif : vérifier qu'un volume supérieur à la capacité est signalé au parc et corrigé au bureau
avant validation.

Compte : test.parc, puis test.exploitation.

Données : DEMO-01 (33 m³), volume chargé 34.

1. Saisissez la rotation avec 34 m³, puis « Enregistrer la rotation ».
2. Lisez la fenêtre « Enregistrer au-delà de la capacité ? », puis « Enregistrer quand même ».
3. test.exploitation : ouvrez la rotation au bureau et tentez de la valider.
4. Corrigez le volume à 33, enregistrez ; faites valider par un autre compte.

Résultat attendu : la fenêtre explique que le bureau devra corriger le volume avant validation. Au
bureau, la rotation est signalée « Chargé au-delà de la capacité » et sa validation est refusée tant
que le volume n'est pas corrigé ; corrigée, elle se valide.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-26. Rester connecté au parc

Objectif : vérifier que Rotations ne déconnecte pas après une minute sans activité, contrairement aux
applications du bureau.

Compte : test.parc.

Données : aucune.

1. Ouvrez Rotations et laissez le téléphone posé, écran allumé, pendant deux minutes.
2. Reprenez une saisie.

Résultat attendu : aucune question « Êtes-vous toujours là ? » ; l'application reste ouverte et la
saisie se poursuit.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-27. Se déconnecter du téléphone

Objectif : vérifier la déconnexion, avec ou sans réseau.

Compte : test.parc.

Données : aucune saisie en attente.

1. En mode avion, touchez l'icône « Se déconnecter » en haut de l'écran.
2. Quittez le mode avion, touchez de nouveau « Se déconnecter ». Lisez la fenêtre « Se déconnecter ? »,
   puis confirmez.
3. Rouvrez Rotations.

Résultat attendu : hors réseau, « Déconnexion impossible sans réseau : réessayez au retour du
réseau. ». Avec du réseau, la fenêtre prévient que les listes gardées sur le téléphone seront
effacées ; après confirmation, Rotations demande une nouvelle connexion.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## D. Refus attendus

### TRA-28. L'exploitation ne voit pas les propriétaires et ne règle pas les paramètres

Objectif : vérifier que les écrans de la finance sont fermés ou en lecture seule pour l'exploitation.

Compte : test.exploitation.

Données : aucune.

1. Ouvrez le menu « Gestion ».
2. Ouvrez Référentiels > Paramètres.
3. Dans Routes et tarifs, regardez le bloc « Prix du carburant ».

Résultat attendu : « Propriétaires et répartition » n'apparaît pas. Les paramètres s'affichent avec
la mention « Paramètres tenus par la finance : consultation seulement. ». Le prix du carburant ne se
modifie pas.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-29. La finance ne donne pas le départ en route

Objectif : vérifier que seul le parc (profil Exploitation) ou l'administration fait partir une
rotation.

Compte : test.daf.

Données : une rotation à l'état saisi.

1. Ouvrez la fiche de la rotation.

Résultat attendu : la fiche ne propose pas « Départ en route » et indique « Le départ en route est
donné par le parc (profil Exploitation) ou un administrateur. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-30. Pas de départ avec un document manquant ou expiré

Objectif : vérifier qu'un ensemble dont un document exigé manque ou est expiré ne part pas en route.

Compte : test.exploitation.

Données : une rotation saisie sur DEMO-03, dont aucun document n'est enregistré.

1. Flotte et chauffeurs : regardez l'état des documents de DEMO-03.
2. Ouvrez la fiche de la rotation et regardez « Départ en route ».

Résultat attendu : DEMO-03 est signalé « manquants ou expirés ». La fiche affiche « Départ impossible
pour l'instant : » avec les documents en cause, et « Départ en route » reste grisé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-31. L'exploitation ne facture pas, la direction ne saisit pas

Objectif : vérifier le partage des rôles entre exploitation, finance et direction.

Compte : test.exploitation, puis test.dg.

Données : des rotations validées.

1. test.exploitation : Rotations, filtre « À facturer (validées) », cochez une rotation.
2. test.dg : ouvrez Exploitation > Rotations, puis la fiche d'une rotation.

Résultat attendu : chez test.exploitation, « Facturer la sélection » n'est pas proposé. Chez test.dg,
ni « Nouvelle rotation » ni bouton de validation ou de correction : la direction consulte.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-32. Rotations et Transport refusés aux autres profils

Objectif : vérifier que l'application du parc et celle du transport ne s'ouvrent qu'aux profils
prévus.

Compte : test.daf (Rotations), puis test.chantiers (Transport).

Données : aucune.

1. test.daf : ouvrez l'adresse de la recette suivie de /mobile et connectez-vous.
2. test.chantiers : dans la barre d'adresse, remplacez la fin de l'adresse par /transport.

Résultat attendu : test.daf est refusé : « Votre profil ne donne pas accès à cette application. ».
test.chantiers voit la page « Accès non ouvert à votre profil », sans aucune donnée du transport.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## E. Contrôles de saisie et de sécurité

### TRA-33. Nombres écrits à la française

Objectif : vérifier que les volumes et les frais s'écrivent à la française et qu'une écriture ambiguë
est refusée avec un message.

Compte : test.exploitation (bureau), puis test.parc (téléphone).

Données : volume livré « 32,95 » ; frais de carburant « 3 200 000 » ; puis volume « 33.000 » et frais
« 3.200.000 ».

1. Au bureau, « Nouvelle rotation » : saisissez « 32,95 » et « 3 200 000 ».
2. Remplacez par « 33.000 » et « 3.200.000 ».
3. Au téléphone, saisissez « 3.200.000 » dans un frais.

Résultat attendu : à l'étape 1, les valeurs sont acceptées et le montant estimé se calcule. À
l'étape 2, chaque champ affiche « Nombre illisible : écrivez par exemple 750 000 ou 2,5. » et
« Enregistrer » est grisé. Le téléphone affiche le même message sous le champ.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-34. Un double clic n'enregistre qu'une rotation

Objectif : vérifier qu'un double clic au bureau, ou un envoi répété au parc, ne crée pas de doublon.

Compte : test.exploitation, puis test.parc.

Données : une rotation d'essai au bureau ; une saisie hors réseau au téléphone.

1. Au bureau, remplissez une « Nouvelle rotation » et double-cliquez sur « Enregistrer ».
2. Au téléphone, saisissez une rotation hors réseau ; au retour du réseau, touchez deux fois
   « Envoyer ».
3. Au bureau, comptez les rotations portant ces bons de livraison.

Résultat attendu : une seule rotation pour chaque saisie.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-35. Confirmation avant d'annuler une rotation ou de supprimer une saisie

Objectif : vérifier qu'une suppression ou une annulation demande confirmation.

Compte : test.exploitation, puis test.parc.

Données : une rotation saisie au bureau ; une saisie en attente au téléphone.

1. Au bureau, fiche de la rotation : « Annuler la rotation ». Lisez la question, puis annulez la
   fenêtre.
2. Recommencez et confirmez.
3. Au téléphone, « À envoyer » : « Supprimer » sur la saisie. Lisez la question.

Résultat attendu : au bureau, « Annuler la rotation … ? Elle ne sera ni facturée ni comptée. » ;
fermée sans confirmer, rien ne change ; confirmée, la rotation passe dans les annulées. Au
téléphone : « Supprimer cette saisie du téléphone ? Elle ne sera pas transmise. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### TRA-36. Message clair en cas de coupure au bureau

Objectif : vérifier qu'une coupure pendant une validation est annoncée en français.

Compte : test.parc au bureau.

Données : une rotation saisie par test.exploitation.

1. Ouvrez la fiche de la rotation.
2. Coupez le réseau du poste, puis « Valider ».
3. Rétablissez le réseau et cliquez de nouveau sur « Valider ».

Résultat attendu : à l'étape 2, un message en français signale l'échec, sans texte en anglais ni
code ; la rotation reste à l'état saisi. À l'étape 3, elle est validée une seule fois.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## Synthèse

| Partie {52} | Scénarios {12} | Réussis {12} | Échoués {12} | Non joués {12} |
|---|---|---|---|---|
| A. Exploitation au bureau | 12 | | | |
| B. Finance et direction | 8 | | | |
| C. Parc : Rotations au téléphone | 7 | | | |
| D. Refus attendus | 5 | | | |
| E. Contrôles de saisie et de sécurité | 4 | | | |
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
