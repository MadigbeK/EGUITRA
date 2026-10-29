# Cahier de test : Service client

Le service client de NIMOVA, pour EGUITRA GROUP SARLU et MB AxisPro Consulting : dossiers des demandes et
réclamations des clients, saisis par l'équipe (téléphone, visite, courrier) ou reçus par courriel, par
l'espace client en ligne et par WhatsApp ; échéances en heures ouvrées et escalade ; réponses types,
satisfaction, fusion des doublons ; liens vers les fiches des autres modules et vers HSSEQ ; tableau de
bord ; espace client des clients.

Écrans : l'application « Service client » de l'accueil (Dossiers, Nouveau dossier, Tableau de bord,
Comptes de l'espace client, Réglages du service client) et l'« Espace client » des clients ; refus
attendus par profil.

| Rubrique {28} | À remplir {72} |
|---|---|
| Module | Service client (NIMOVA · Service client et Espace client) |
| Version de la plateforme | ______ (communiquée par E-VOLUTION XP) |
| Date du test | ______ |
| Nom du testeur | ______ |
| Fonction | ______ |
| Profil utilisé | ______ |
| Compte de test | ______ |
| Société | ☐ EGUITRA GROUP SARLU    ☐ MB AxisPro Consulting |

Document préparé par E-VOLUTION XP le 29 octobre 2026, d'après les écrans de la plateforme à cette
date.

<!-- saut de page -->

## Mode d'emploi

Ce cahier se joue sur la recette : une copie complète de NIMOVA, avec des données fictives repérées
« (démo) ». Rien de ce que vous y faites ne touche les vrais dossiers : vous pouvez tout essayer, y
compris les erreurs.

1. Se connecter. Ouvrez, dans Chrome ou Edge, l'adresse de la recette communiquée par E-VOLUTION XP,
   puis la tuile « Service client » de l'accueil. Identifiant : le compte de test indiqué dans le
   scénario. Mot de passe : le mot de passe commun de la recette, remis par l'administrateur. Les
   comptes test.client et test.client.cabinet se connectent à l'espace client : adresse de la recette
   suivie de /espace-client.
2. Société. Les dossiers de démonstration sont surtout ceux d'EGUITRA GROUP SARLU : travaillez dans
   cette société (choix en haut de l'écran), sauf mention contraire. test.serviceclient, test.dg et
   test.admin sont ouverts aux deux sociétés.
3. Numéros. Les dossiers sont numérotés SC/EG/2026/… pour EGUITRA GROUP SARLU et SC/MBAX/2026/… pour
   MB AxisPro Consulting. Notez les numéros créés : d'autres scénarios s'en servent.
4. Courriel et WhatsApp. La recette peut ne pas avoir de boîte de courriel relevée, de serveur d'envoi
   ni de numéro WhatsApp : les réglages le disent, et les dossiers de démonstration « courriel » et
   « WhatsApp » ont été simulés. Une réponse qui ne peut pas partir reste dans le dossier, marquée
   « Non envoyé », avec son motif. Les scénarios le précisent.
5. Jouer un scénario. Suivez les étapes dans l'ordre, avec les données indiquées. Un scénario à deux
   comptes se joue dans deux navigateurs (Chrome et Edge) ou sur deux postes. Les essais portent la
   mention « (essai) ».
6. Noter le résultat. Cochez « Réussi » si l'écran correspond au résultat attendu, sinon « Échoué ».
   Dans « Remarques », notez ce qui diffère : l'écran, le message affiché, l'heure.
7. Signaler une anomalie. Menu du compte (rond à vos initiales, en haut à droite) > « Mes demandes »
   > « Nouvelle demande », type « Remarque de recette », application NIMOVA · Service client, la
   gravité ; titre commençant par le numéro du scénario (par exemple « SCL-12 : délai faux ») ;
   description ; « Déposer la demande ». Reportez le numéro reçu (DEM-…) dans les remarques.

## Comptes de test

| Compte {20} | Profil {22} | Périmètre {26} | Rôle dans ce cahier {32} |
|---|---|---|---|
| test.serviceclient | Service client | les deux sociétés | saisie, réponses, affectation, comptes clients |
| test.exploitation | Exploitation | EGUITRA GROUP SARLU | dossiers qui lui sont confiés |
| test.immobilier | Immobilier | EGUITRA GROUP SARLU | dossiers qui lui sont confiés |
| test.consultant | Cabinet | MB AxisPro Consulting | dossiers qui lui sont confiés |
| test.dg | Direction | les deux sociétés | lecture de tous les dossiers, tableau de bord, escalade |
| test.admin | Administration | les deux sociétés | réglages, catégories, équipes |
| test.client | Client | EGUITRA GROUP SARLU | espace client (Démo - Transports Kaloum) |
| test.client.cabinet | Client | MB AxisPro Consulting | espace client (Démo - Coopérative de Kindia) |
| test.achats | Achats | les deux sociétés | refus |
| test.porteur | Porteur de projet | MB AxisPro Consulting | refus |

Données fictives utiles : clients « Démo - Transports Kaloum (client) » (téléphone +224 620 00 00 01)
et « Démo - Résidence Les Palmiers (locataire) » pour EGUITRA GROUP SARLU, « Démo - Coopérative de
Kindia (client du cabinet) » pour MB AxisPro Consulting ; équipe « Exploitation (démo) » (test.exploitation,
test.parc) ; dossiers « Manquant de 1 500 litres à la livraison de Kamsar (démo) » (téléphone, en
cours, confié à l'exploitation), « Facture EG24138 contestée (démo) » (courriel simulé, expéditeur non
vérifié), « Retard de livraison à Boké (démo) » (WhatsApp simulé, fenêtre de 24 heures fermée),
« Relevé de compte d'octobre (démo) » (espace client), « Fuite d'eau dans l'appartement B2 (démo) »
(visite, en attente du client, confié à l'immobilier), « Camion immobilisé chargé à Coyah (démo) »
(urgent, en retard, escaladé), « Attestation de livraison pour la douane (démo) » (résolu, noté 4 sur
5), « Location d'un camion-benne pour le chantier de Dubréka (démo) » (rouvert), « Changement d'adresse
de facturation (démo) » (clos) ; pour MB AxisPro Consulting, « Date de remise du rapport d'évaluation
(démo) » (espace client, confié au consultant) et « Facture d'honoraires à scinder en deux échéances
(démo) » (nouveau).

## A. Accès et applications

### SCL-01. Ouvrir le service client

Objectif : vérifier que l'agent trouve l'application et ses écrans.

Compte : test.serviceclient.

Données : aucune.

1. Ouvrez l'accueil NIMOVA ; cherchez la tuile « Service client ».
2. Ouvrez-la ; parcourez le menu : Dossiers, Nouveau dossier, Tableau de bord, Comptes de l'espace
   client, Réglages du service client.

Résultat attendu : la tuile est présente ; les cinq entrées s'ouvrent sans erreur ; la liste « Ouverts »
montre les dossiers (démo) d'EGUITRA GROUP SARLU, avec leur numéro SC/EG/2026/…, leur état et leur
échéance.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-02. Un métier ne voit que ses dossiers

Objectif : vérifier qu'un compte métier n'ouvre que les dossiers qui lui sont confiés.

Compte : test.exploitation.

Données : dossier « Manquant de 1 500 litres à la livraison de Kamsar (démo) ».

1. Ouvrez la tuile « Service client ».
2. Lisez la liste ; cherchez « Nouveau dossier » au menu.

Résultat attendu : seuls les dossiers confiés à test.exploitation ou à l'équipe « Exploitation (démo) »
apparaissent, dont le manquant de Kamsar ; « Nouveau dossier », le tableau de bord et les comptes
clients ne sont pas au menu.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-03. La direction lit tout

Objectif : vérifier que la direction lit tous les dossiers sans pouvoir répondre à ceux qui ne lui sont
pas confiés.

Compte : test.dg.

Données : dossier « Relevé de compte d'octobre (démo) ».

1. Ouvrez la liste des dossiers, vue « Tous ».
2. Ouvrez le relevé de compte.

Résultat attendu : tous les dossiers de la société sont listés ; le relevé s'ouvre avec son fil, sans
zone « Répondre au client » ni boutons de traitement.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-04. L'espace client du client

Objectif : vérifier que le client entre dans son espace, sans la marque interne.

Compte : test.client.

Données : aucune.

1. Ouvrez l'adresse de la recette suivie de /espace-client et connectez-vous.
2. Lisez l'en-tête et la liste « Mes demandes ».

Résultat attendu : l'en-tête dit « Espace client » et EGUITRA GROUP SARLU ; la liste montre le relevé de
compte d'octobre et les autres demandes de Démo - Transports Kaloum, jamais celles d'un autre client ;
ni discussion, ni agenda, ni lanceur.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## B. Saisie par l'équipe

### SCL-05. Retrouver le client pendant un appel

Objectif : vérifier la recherche par téléphone et l'affichage des dossiers en cours.

Compte : test.serviceclient.

Données : le numéro 620 00 00 01.

1. Ouvrez « Nouveau dossier ».
2. Dans « Rechercher », tapez 620 00 00 01.

Résultat attendu : Démo - Transports Kaloum apparaît, avec ses dossiers en cours (numéro, objet, état) ;
un clic sur un numéro ouvre le dossier.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-06. Saisir un appel avec réponse immédiate

Objectif : vérifier la saisie complète et la première réponse notée.

Compte : test.serviceclient.

Données : client Démo - Transports Kaloum ; objet « Horaires de chargement au dépôt (essai) » ;
catégorie « Livraison » ; réponse « Le dépôt charge de 7 h à 16 h. ».

1. « Nouveau dossier », recherchez le client puis « Choisir ».
2. Remplissez l'objet, la catégorie et « Réponse donnée pendant l'appel ».
3. « Enregistrer le dossier ».

Résultat attendu : la fiche du dossier s'ouvre, numérotée SC/EG/2026/… ; l'état est « En cours » ; la
première réponse est datée dans « Échéances » ; le fil montre la réponse, marquée « Communiqué de vive
voix ou par courrier ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-07. Saisir un contact qui n'est pas client

Objectif : vérifier qu'un dossier s'ouvre pour un simple contact.

Compte : test.serviceclient.

Données : contact « Mme Camara (essai) », téléphone +224 664 00 00 00, objet « Tarif d'une rotation
Conakry - Mamou (essai) ».

1. « Nouveau dossier » ; laissez le client vide ; remplissez le contact et l'objet ; canal « Téléphone
   ».
2. Enregistrez, puis revenez à « Nouveau dossier » et recherchez 664 00 00.

Résultat attendu : le dossier s'ouvre avec « Contact non client » ; à la recherche, Mme Camara apparaît
comme contact non client, avec ce dossier en cours.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-08. Réclamation proposée par la catégorie

Objectif : vérifier que la catégorie propose le type.

Compte : test.serviceclient.

Données : catégorie « Retard ».

1. « Nouveau dossier » pour Démo - Transports Kaloum, catégorie « Retard », objet « Camion en retard à
   Kindia (essai) », sans toucher au type.
2. Enregistrez.

Résultat attendu : le dossier est une « Réclamation » (en-tête de la fiche).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-09. Saisie incomplète refusée

Objectif : vérifier les contrôles de la saisie.

Compte : test.serviceclient.

Données : aucune.

1. « Nouveau dossier » : remplissez seulement l'objet, sans client ni contact.

Résultat attendu : le bouton « Enregistrer le dossier » reste inactif ; en ajoutant un nom de contact,
il s'active.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## C. Traitement d'un dossier

### SCL-10. Confier un dossier

Objectif : vérifier l'affectation et la notification du responsable.

Compte : test.serviceclient puis test.immobilier.

Données : le dossier d'essai de SCL-06.

1. Dans la fiche, « Classement et affectation » : responsable test.immobilier, « Enregistrer ».
2. Avec test.immobilier, ouvrez le service client.

Résultat attendu : l'état passe à « Assigné » si le dossier était nouveau ; un événement « Responsable :
… » entre dans le fil ; test.immobilier voit le dossier dans sa liste.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-11. Répondre par le canal du dossier

Objectif : vérifier la réponse au client et l'état d'envoi.

Compte : test.serviceclient.

Données : dossier « Relevé de compte d'octobre (démo) » (espace client).

1. Ouvrez le dossier ; « Répondre au client », canal « Espace client ».
2. Écrivez « Le relevé est joint. », joignez un PDF, « Envoyer la réponse ».

Résultat attendu : la réponse entre dans le fil avec sa pièce, marquée « Envoyé » ; le dossier passe «
En cours » ; la première réponse est datée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-12. Note interne

Objectif : vérifier qu'une note reste interne.

Compte : test.serviceclient puis test.client.

Données : dossier « Relevé de compte d'octobre (démo) ».

1. Onglet « Note interne » : « Client à rappeler avant vendredi (essai). », « Ajouter la note ».
2. Avec test.client, ouvrez la demande dans l'espace client.

Résultat attendu : la note apparaît en jaune, « Note interne », dans la fiche ; le client ne la voit
pas.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-13. Attente du client

Objectif : vérifier l'arrêt de l'horloge et la relance par le client.

Compte : test.serviceclient puis test.client.

Données : dossier « Relevé de compte d'octobre (démo) ».

1. « Traitement » > « En attente du client » ; notez « Résolution avant le ».
2. Avec test.client, répondez à la demande dans l'espace client.
3. Revenez sur la fiche avec test.serviceclient.

Résultat attendu : l'état est « En attente du client » ; après la réponse du client, il revient « En
cours » et « Résolution avant le » recule du temps passé à attendre (heures ouvrées).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-14. Résoudre puis clore

Objectif : vérifier les passages d'état et la demande de satisfaction.

Compte : test.serviceclient.

Données : un dossier d'essai téléphonique en cours.

1. « Traitement » > « Résolu ».
2. Puis « Clos ».

Résultat attendu : à « Résolu », le fil dit que la satisfaction est à recueillir auprès du client ; «
Clos » ferme le dossier : « Répondre au client » disparaît, « Rouvert » est proposé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-15. Le métier traite son dossier

Objectif : vérifier ce qu'un métier peut faire.

Compte : test.exploitation.

Données : dossier « Manquant de 1 500 litres à la livraison de Kamsar (démo) ».

1. Répondez au client (canal « Téléphone »), puis ajoutez une note.
2. « Traitement » : lisez les boutons.

Résultat attendu : réponse et note s'enregistrent ; « En attente du client » et « Résolu » sont
proposés, jamais « Clos » ; ni le classement, ni l'affectation, ni la fusion ne sont proposés.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-16. Rattacher un expéditeur non vérifié

Objectif : vérifier le rattachement à la main après vérification.

Compte : test.serviceclient.

Données : dossier « Facture EG24138 contestée (démo) ».

1. Ouvrez le dossier : lisez l'avertissement « Expéditeur non vérifié ».
2. « Client » > « Rattacher à un client » : Démo - Transports Kaloum, « Rattacher ».

Résultat attendu : l'avertissement explique de vérifier l'identité ; après le rattachement, le client
est Démo - Transports Kaloum et le badge « Expéditeur non vérifié » disparaît.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## D. Échéances et escalade

### SCL-17. Échéances selon la priorité

Objectif : vérifier le calcul en heures ouvrées.

Compte : test.serviceclient.

Données : un dossier d'essai ouvert un jour ouvré à 9 h (heure de Conakry).

1. Lisez « Première réponse avant le » (priorité normale : 8 heures ouvrées).
2. Passez la priorité à « Urgente » et enregistrez.

Résultat attendu : en normale, l'échéance tombe le même jour à 17 h (du lundi au vendredi, de 8 h à 17
h) ; en urgente, une heure après l'ouverture ; un dossier ouvert le vendredi soir n'échoit que le lundi.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-18. Catégorie plus exigeante

Objectif : vérifier que le délai le plus court l'emporte.

Compte : test.admin puis test.serviceclient.

Données : catégorie « Retard ».

1. Réglages > Catégories : « Retard », première réponse 2 heures, « Enregistrer ».
2. Ouvrez un dossier d'essai « Retard » en priorité normale.

Résultat attendu : la première réponse est due 2 heures ouvrées après l'ouverture (et non 8).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-19. Dossier en retard escaladé

Objectif : vérifier l'affichage du retard et l'escalade.

Compte : test.serviceclient puis test.dg.

Données : dossier « Camion immobilisé chargé à Coyah (démo) ».

1. Liste des dossiers, vue « En retard ».
2. Ouvrez le dossier, lisez « Échéances ».
3. Avec test.dg, ouvrez le tableau de bord.

Résultat attendu : le dossier est marqué « Réponse en retard » ; « Escalade » dit « Direction prévenue »
; il figure dans « Dossiers en retard » du tableau de bord ; le fil porte les événements d'escalade.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-20. Pas de retard en attente du client

Objectif : vérifier que l'attente arrête l'horloge.

Compte : test.immobilier.

Données : dossier « Fuite d'eau dans l'appartement B2 (démo) ».

1. Ouvrez le dossier en attente du client ; lisez son état et ses badges.

Résultat attendu : aucun badge « Résolution en retard » tant que le dossier attend le client.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## E. Réponses types, fusion et satisfaction

### SCL-21. Utiliser une réponse type

Objectif : vérifier le remplacement des variables.

Compte : test.serviceclient.

Données : réponse type « Accusé de réception ».

1. Ouvrez un dossier d'essai ; « Réponse type » : « Accusé de réception ».

Résultat attendu : le texte se remplit avec le nom du contact, le numéro du dossier, son objet, votre
prénom et le nom de la société, sans accolade restante ; il reste modifiable avant l'envoi.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-22. Créer une réponse type

Objectif : vérifier la gestion des réponses types par les agents.

Compte : test.serviceclient.

Données : « Délai de livraison (essai) », texte « Bonjour {client}, votre commande part sous 48 heures.
».

1. Réglages > Réponses types > « Nouvelle réponse type » ; enregistrez.
2. Ouvrez un dossier et choisissez-la.

Résultat attendu : la réponse type est listée ; dans le dossier, {client} est remplacé par le nom du
contact.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-23. Fusionner deux dossiers en double

Objectif : vérifier la fusion.

Compte : test.serviceclient.

Données : deux dossiers d'essai du même client.

1. Ouvrez le doublon ; « Doublon » : tapez le numéro du dossier à garder, « Fusionner ».

Résultat attendu : la page passe au dossier gardé, qui reprend le fil du doublon (événement « Dossier …
fusionné dans celui-ci ») ; le doublon est clos, marqué « Fusionné dans … ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-24. Fusion refusée entre deux clients

Objectif : vérifier qu'on ne mélange pas deux clients.

Compte : test.serviceclient.

Données : un dossier de Démo - Transports Kaloum et un de Démo - Résidence Les Palmiers.

1. Essayez de fusionner l'un dans l'autre.

Résultat attendu : refus en français : les deux dossiers sont ceux de clients différents.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-25. Noter la satisfaction recueillie au téléphone

Objectif : vérifier la note de l'agent.

Compte : test.serviceclient.

Données : un dossier d'essai résolu, téléphonique.

1. « Satisfaction du client » : 3 étoiles, commentaire « Délai un peu long (essai). », « Enregistrer la
   note ».

Résultat attendu : la note et le commentaire s'affichent ; une seconde note est refusée ; le tableau de
bord la compte.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## F. Courriel

### SCL-26. État de la relève

Objectif : vérifier le message des réglages selon la configuration.

Compte : test.admin.

Données : aucune.

1. Réglages du service client > Canaux > Courriel.

Résultat attendu : sans boîte configurée sur le serveur, le message dit que la relève est inactive et
pourquoi ; avec une boîte, « Boîte … relevée toutes les 5 minutes » ; sans serveur de réception réglé,
il dit que tout expéditeur sera « non vérifié ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-27. Dossier ouvert par courriel

Objectif : vérifier un dossier reçu par courriel (simulé en recette).

Compte : test.serviceclient.

Données : dossier « Facture EG24138 contestée (démo) ».

1. Ouvrez le dossier ; lisez le canal, le fil et les événements.

Résultat attendu : canal « Courriel » ; le message du client est dans le fil ; un événement dit que
l'expéditeur n'est pas vérifié et qu'aucune réponse automatique n'est partie.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-28. Répondre par courriel

Objectif : vérifier l'envoi ou son refus clair.

Compte : test.serviceclient.

Données : dossier « Facture EG24138 contestée (démo) ».

1. « Répondre au client », canal « Courriel », « Nous vérifions la facture (essai). », envoyez.

Résultat attendu : avec un serveur d'envoi, la réponse est « Envoyé » et part avec le numéro du dossier
entre crochets dans l'objet ; sans serveur, elle est « Non envoyé » avec le motif, et la première
réponse n'est pas notée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-29. Réponse du client rattachée

Objectif : vérifier qu'une réponse rejoint son dossier (boîte configurée seulement).

Compte : test.serviceclient.

Données : une boîte de recette relevée et une adresse de test authentifiée.

1. Depuis l'adresse de test, répondez au courriel reçu de SCL-28, sans changer l'objet.
2. Attendez la relève (5 minutes) et rouvrez le dossier.

Résultat attendu : la réponse entre dans le fil du même dossier ; d'une adresse non authentifiée, un
nouveau dossier « expéditeur non vérifié » s'ouvre à la place, qui cite le dossier probable.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-30. Réponses automatiques ignorées

Objectif : vérifier la protection contre les boucles (boîte configurée seulement).

Compte : test.admin.

Données : une réponse d'absence envoyée à la boîte de recette.

1. Envoyez à la boîte un message d'absence (réponse automatique de la messagerie).
2. Après la relève, cherchez un nouveau dossier.

Résultat attendu : aucun dossier n'est ouvert et aucun accusé n'est renvoyé : le message est seulement
noté comme refusé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## G. WhatsApp

### SCL-31. État du canal

Objectif : vérifier le message des réglages.

Compte : test.admin.

Données : aucune.

1. Réglages du service client > Canaux > WhatsApp.

Résultat attendu : sans configuration, « Canal WhatsApp inactif » avec ce qui manque ; avec, « Canal
WhatsApp actif » et, sans modèle approuvé, l'avertissement correspondant.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-32. Dossier reçu par WhatsApp

Objectif : vérifier un dossier WhatsApp (simulé en recette).

Compte : test.serviceclient.

Données : dossier « Retard de livraison à Boké (démo) ».

1. Ouvrez le dossier ; lisez le canal, le numéro et le fil.

Résultat attendu : canal « WhatsApp », le numéro du contact, le message reçu, le badge « Expéditeur non
vérifié » (numéro inconnu des contacts).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-33. Hors de la fenêtre de 24 heures

Objectif : vérifier le refus clair sans modèle approuvé.

Compte : test.serviceclient.

Données : dossier « Retard de livraison à Boké (démo) ».

1. « Répondre au client », canal « WhatsApp » ; lisez l'avertissement ; écrivez et envoyez.

Résultat attendu : l'écran prévient que la fenêtre est fermée ; sans modèle réglé, l'envoi est refusé
avec un message qui invite à répondre par un autre canal ; avec un modèle, il part et la réponse attend
le prochain message du client.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-34. Note du client par un chiffre

Objectif : vérifier la satisfaction par WhatsApp (numéro de recette seulement).

Compte : test.serviceclient.

Données : un numéro WhatsApp de test et un dossier WhatsApp résolu.

1. Résolvez le dossier ; depuis le téléphone, répondez « 4 merci ».

Résultat attendu : la note 4 et le commentaire « merci » s'inscrivent sur le dossier, qui reste résolu ;
un remerciement part.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## H. Espace client

### SCL-35. Déposer une demande

Objectif : vérifier le dépôt et son accusé.

Compte : test.client.

Données : objet « Copie du bon de livraison du 27 octobre (essai) », catégorie « Livraison ».

1. « Nouvelle demande » ; remplissez ; « Déposer la demande ».

Résultat attendu : la demande s'ouvre avec son numéro SC/EG/2026/… et l'état « Reçue » ; un accusé de
réception est dans les échanges ; test.serviceclient la voit dans sa liste (canal « Espace client »).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-36. Répondre avec une pièce

Objectif : vérifier la réponse du client et les formats acceptés.

Compte : test.client.

Données : la demande de SCL-35 ; un PDF ; un fichier .exe renommé .pdf.

1. Écrivez « Voici le bon (essai). », joignez le PDF, « Envoyer ».
2. Recommencez avec le faux PDF.

Résultat attendu : le message et sa pièce apparaissent ; le faux PDF est refusé en français (formats
acceptés).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-37. Le client ne voit que l'essentiel

Objectif : vérifier ce que le client lit.

Compte : test.client.

Données : dossier « Relevé de compte d'octobre (démo) », avec la note de SCL-12.

1. Ouvrez la demande ; lisez « Suivie par », les échanges et l'état.

Résultat attendu : « Suivie par » donne le seul prénom de l'agent (ou « Service client de … ») ; aucune
note interne, aucun événement, aucune échéance ; l'état est celui du client (par exemple « En cours de
traitement »).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-38. Confirmer la résolution

Objectif : vérifier la clôture par le client.

Compte : test.serviceclient puis test.client.

Données : la demande de SCL-35.

1. Avec test.serviceclient, passez-la « Résolu ».
2. Avec test.client, ouvrez-la : « Confirmer la résolution ».

Résultat attendu : le client lit « Votre demande est résolue » ; après confirmation, elle est « Close »
et ne se répond plus.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-39. Donner son avis

Objectif : vérifier la satisfaction dans l'espace client.

Compte : test.client.

Données : une demande résolue.

1. « Votre avis sur notre réponse » : 5 étoiles, « Donner mon avis ».

Résultat attendu : l'avis s'affiche ; il ne se donne qu'une fois ; une note de 1 ou 2 prévient le
responsable du dossier.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-40. Ouvrir un compte client

Objectif : vérifier l'invitation (aucune inscription libre).

Compte : test.serviceclient.

Données : client Démo - Résidence Les Palmiers ; contact « Mme Soumah (essai) », adresse de test.

1. Comptes de l'espace client > « Ouvrir un compte » ; choisissez le client ; nom et adresse ; « Inviter
   ».
2. Ouvrez le lien reçu (ou remis à l'écran sans serveur de courrier), choisissez un mot de passe.

Résultat attendu : avec un serveur de courrier, « Invitation envoyée » ; sans, le lien est affiché une
fois à l'agent ; le lien mène à « Bienvenue dans votre espace client » ; après le mot de passe, la
connexion à /espace-client fonctionne et ne montre que Démo - Résidence Les Palmiers.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-41. Pas de reprise d'un compte existant

Objectif : vérifier qu'on ne prend pas le compte d'un autre.

Compte : test.serviceclient.

Données : l'adresse d'un compte interne, puis celle d'un compte client existant d'un autre client.

1. « Ouvrir un compte » avec l'identifiant d'un compte interne (par exemple celui d'un collègue).
2. « Ouvrir un compte » pour Démo - Transports Kaloum avec l'adresse du compte de SCL-40.

Résultat attendu : le premier est refusé (« Cette adresse est déjà utilisée… ») sans rien dire du compte
; le second demande une confirmation explicite (« Confirmer le rattachement ») avant que le compte suive
les deux clients.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## I. Liens et HSSEQ

### SCL-42. Lier une facture

Objectif : vérifier la fiche liée bornée au client.

Compte : test.serviceclient.

Données : dossier « Facture EG24138 contestée (démo) » rattaché à son client (SCL-16).

1. « Fiche liée » : nature « Facture » ; cherchez ; « Lier » sur une facture du client.

Résultat attendu : seules les factures de Démo - Transports Kaloum sont proposées ; une fois liée, «
Facture : … » s'affiche ; le client lit la nature et le numéro dans son espace.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-43. Créer la réclamation HSSEQ

Objectif : vérifier le passage d'une réclamation de qualité à HSSEQ.

Compte : test.serviceclient.

Données : dossier « Manquant de 1 500 litres à la livraison de Kamsar (démo) ».

1. « Réclamation de qualité (HSSEQ) » > « Créer la réclamation HSSEQ ».
2. Avec test.hsseq, ouvrez HSSEQ > Environnement et qualité, réclamations.

Résultat attendu : le dossier cite la réclamation HSSEQ créée ; dans HSSEQ, elle porte le client, la
nature « Manquant à la livraison » et le numéro du dossier dans sa description.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-44. Rejoindre une réclamation HSSEQ

Objectif : vérifier qu'un second dossier rejoint la même réclamation.

Compte : test.serviceclient.

Données : un second dossier « Produit » d'essai du même client.

1. « Réclamation de qualité (HSSEQ) » : « Rejoindre » sur la réclamation de SCL-43.

Résultat attendu : le dossier cite la même réclamation ; une réclamation d'un autre client n'est jamais
proposée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## J. Tableau de bord et réglages

### SCL-45. Lire le tableau de bord

Objectif : vérifier les indicateurs.

Compte : test.dg.

Données : aucune.

1. Service client > Tableau de bord ; changez la période.

Résultat attendu : dossiers ouverts, en retard, délais moyens de première réponse et de résolution
(heures ouvrées), satisfaction moyenne, répartitions par état, priorité, catégorie, canal, responsable,
réclamations par activité et par client, dossiers en retard.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-46. Exporter

Objectif : vérifier les exports.

Compte : test.dg.

Données : aucune.

1. « Excel », puis « CSV (synthèse) ».

Résultat attendu : le classeur s'ouvre avec un onglet par tableau, en-tête de la société et de la
période ; le CSV s'ouvre dans Excel avec les accents.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-47. Régler les heures et les délais

Objectif : vérifier les réglages de l'administration.

Compte : test.admin.

Données : ouverture 7,5 ; fermeture 16,5.

1. Réglages > Délais et escalade : ouverture 7.5, fermeture 16.5 ; enregistrez.
2. Essayez ensuite une ouverture après la fermeture.

Résultat attendu : les réglages s'enregistrent et les échéances des dossiers ouverts sont recalculées ;
l'incohérence est refusée en français.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-48. Réglages en lecture pour l'agent

Objectif : vérifier que l'agent ne modifie pas les réglages.

Compte : test.serviceclient.

Données : aucune.

1. Ouvrez Réglages du service client > Délais et escalade.

Résultat attendu : les champs sont grisés, sans bouton « Enregistrer » ; les réponses types restent
modifiables.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## K. Refus attendus

### SCL-49. Le profil Achats n'ouvre pas le service client

Objectif : vérifier le refus.

Compte : test.achats.

Données : aucune.

1. Cherchez la tuile « Service client » ; ouvrez l'adresse de la recette suivie de /service-client.

Résultat attendu : pas de tuile ; la page dit que le profil ne donne pas accès à cette application.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-50. Le porteur n'ouvre ni le service client ni l'espace client

Objectif : vérifier le refus.

Compte : test.porteur.

Données : aucune.

1. Ouvrez l'adresse de la recette suivie de /service-client, puis /espace-client.

Résultat attendu : les deux sont refusés ; le porteur reste sur son portail.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-51. Le client n'ouvre pas le service client

Objectif : vérifier qu'un client ne voit rien d'interne.

Compte : test.client.

Données : aucune.

1. Connecté à l'espace client, ouvrez l'adresse de la recette suivie de /service-client.

Résultat attendu : accès refusé : le client n'atteint aucun écran interne.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-52. Un métier ne modifie pas un dossier

Objectif : vérifier les bornes du métier.

Compte : test.immobilier.

Données : un dossier qui ne lui est pas confié (numéro noté).

1. Ouvrez l'adresse de la recette suivie de /service-client/dossiers/ et le numéro interne du dossier.

Résultat attendu : le dossier est introuvable pour ce compte.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## L. Séparation des deux sociétés

### SCL-53. Chaque société ses dossiers

Objectif : vérifier la séparation.

Compte : test.serviceclient.

Données : aucune.

1. Dans EGUITRA GROUP SARLU, lisez la liste.
2. En haut de l'écran, passez dans MB AxisPro Consulting.

Résultat attendu : dans EGUITRA GROUP SARLU, seuls les dossiers SC/EG/… ; dans MB AxisPro Consulting,
seuls les SC/MBAX/…, dont « Date de remise du rapport d'évaluation (démo) » et la facture d'honoraires ;
catégories, équipes et réponses types sont celles de la société.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SCL-54. Le client d'une société ne voit pas l'autre

Objectif : vérifier la séparation dans l'espace client.

Compte : test.client.cabinet.

Données : aucune.

1. Connectez-vous à l'espace client ; lisez la liste et l'en-tête.

Résultat attendu : seules les demandes de Démo - Coopérative de Kindia, de MB AxisPro Consulting ;
aucune d'EGUITRA GROUP SARLU.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## Synthèse

| Partie {52} | Scénarios {12} | Réussis {12} | Échoués {12} | Non joués {12} |
|---|---|---|---|---|
| A. Accès et applications | 4 | | | |
| B. Saisie par l'équipe | 5 | | | |
| C. Traitement d'un dossier | 7 | | | |
| D. Échéances et escalade | 4 | | | |
| E. Réponses types, fusion et satisfaction | 5 | | | |
| F. Courriel | 5 | | | |
| G. WhatsApp | 4 | | | |
| H. Espace client | 7 | | | |
| I. Liens et HSSEQ | 3 | | | |
| J. Tableau de bord et réglages | 4 | | | |
| K. Refus attendus | 4 | | | |
| L. Séparation des deux sociétés | 2 | | | |
| Total | 54 | | | |

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
