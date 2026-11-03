# Cahier de test : Achats et ventes

Le cycle commercial dans NIMOVA · Finance, pour EGUITRA GROUP SARLU et MB AxisPro Consulting :
catalogue des articles et prestations, offres commerciales, commandes des clients et leur facturation
(acomptes, quantités exécutées), offre de travaux vers le chantier, bons de commande fournisseur,
réceptions, rapprochement des pièces d'achat, devis fournisseurs, tableaux de bord et réglages.

Écrans : Finance > Ventes (onglets Factures, Offres, Commandes, Catalogue, Tableau de bord), Finance >
Achats et dépenses (onglets Pièces d'achat, Bons de commande, Catalogue, Tableau de bord), la fiche
d'un engagement de dépense, « À valider », Administration > Achats et ventes ; refus attendus par
profil.

| Rubrique {28} | À remplir {72} |
|---|---|
| Module | Achats et ventes (NIMOVA · Finance) |
| Version de la plateforme | ______ (communiquée par E-VOLUTION XP) |
| Date du test | ______ |
| Nom du testeur | ______ |
| Fonction | ______ |
| Profil utilisé | ______ |
| Compte de test | ______ |
| Société | ☐ EGUITRA GROUP SARLU    ☐ MB AxisPro Consulting |

Document préparé par E-VOLUTION XP le 27 octobre 2026, d'après les écrans de la plateforme à cette
date ; complété le 2 novembre 2026 (partie M) après le retour d'EGUITRA GROUP sur les bons de commande :
fournisseur créé depuis le bon, circuit d'approbation, traçabilité et signature, TVA, devis et
conditions ; circuit mis à jour le même jour selon la réponse d'EGUITRA GROUP : contrôle par le chef
comptable ou le DAF, puis approbation de la direction générale ; partie N : émission des bons de
commande réservée au service Achats chez EGUITRA GROUP SARLU (décision du même jour).

<!-- saut de page -->

## Mode d'emploi

Ce cahier se joue sur la recette : une copie complète de NIMOVA, avec des données fictives repérées
« (démo) ». Rien de ce que vous y faites ne touche les vrais dossiers : vous pouvez tout essayer, y
compris les erreurs.

1. Se connecter. Ouvrez, dans Chrome ou Edge, l'adresse de la recette communiquée par E-VOLUTION XP,
   puis la tuile « Finance » de l'accueil. Identifiant : le compte de test indiqué dans le scénario.
   Mot de passe : le mot de passe commun de la recette, remis par l'administrateur.
2. Société. Les données de démonstration sont surtout celles d'EGUITRA GROUP SARLU : travaillez dans
   cette société (choix en haut de l'écran), sauf mention contraire. Les comptes test.daf,
   test.comptable, test.dg, test.achats, test.achatvente et test.admin sont ouverts aux deux sociétés.
3. Numéros. Les offres sont numérotées OF/EG/2026/… pour EGUITRA GROUP SARLU et OF/MBAX/2026/… pour
   MB AxisPro Consulting ; les bons de commande BC/EG/…, BC/MBAX/… ; les réceptions REC/EG/…. Notez les
   numéros créés : d'autres scénarios s'en servent.
4. Courriels. La recette peut ne pas avoir de serveur de courrier : un envoi par courriel est alors
   refusé avec un message clair, et le document s'imprime. Les scénarios le précisent.
5. Jouer un scénario. Suivez les étapes dans l'ordre, avec les données indiquées. Un scénario à deux
   comptes se joue dans deux navigateurs (Chrome et Edge) ou sur deux postes. Les essais portent la
   mention « (essai) ».
6. Noter le résultat. Cochez « Réussi » si l'écran correspond au résultat attendu, sinon « Échoué ».
   Dans « Remarques », notez ce qui diffère : l'écran, le message affiché, l'heure.
7. Signaler une anomalie. Menu du compte (rond à vos initiales, en haut à droite) > « Mes demandes »
   > « Nouvelle demande », type « Remarque de recette », application NIMOVA · Finance, la gravité ;
   titre commençant par le numéro du scénario (par exemple « ACV-15 : acompte refusé ») ;
   description ; « Déposer la demande ». Reportez le numéro reçu (DEM-…) dans les remarques.

## Comptes de test

| Compte {18} | Profil {22} | Périmètre {26} | Rôle dans ce cahier {34} |
|---|---|---|---|
| test.daf | Finance | les deux sociétés | offres, facturation, réglages, contrôle des bons de commande (DAF) |
| test.comptable | Finance | les deux sociétés | contrôle des bons de commande (chef comptable), approbations, pièces d'achat |
| test.dg | Direction | les deux sociétés | offres, approbation des bons de commande, lecture |
| test.achats | Achats | les deux sociétés | émission des bons de commande (seul profil chez EGUITRA GROUP SARLU), réceptions, pièces d'achat |
| test.achatvente | Finance et achats | les deux sociétés | tout le cahier d'un seul compte, sauf les scénarios à deux personnes |
| test.chantiers | BTP | EGUITRA GROUP SARLU | engagement et bon de commande du chantier, situations |
| test.exploitation | Exploitation | EGUITRA GROUP SARLU | refus |
| test.admin | Administration | les deux sociétés | réglages, consultation |
| test.consultant | Cabinet | MB AxisPro Consulting | refus |

Données fictives utiles : catalogue d'EGUITRA GROUP SARLU « Location de camion-benne, par jour
(démo) », « Terrassement en déblai, au m³ (démo) », « Crépissage, au mètre carré (démo) », « Ciment
CPA 42,5, sac de 50 kg (démo) », « Gasoil, au litre (démo) » ; catalogue de MB AxisPro Consulting
« Accompagnement de porteur de projet, par jour (démo) » et « Étude de faisabilité, au forfait
(démo) » ; offre « Crépissage du bâtiment administratif (démo) » pour « Démo - Maître d'ouvrage »,
acceptée, avec deux acomptes facturés (50 % et 30 %) ; offre « Location de deux camions-bennes
(démo) » pour « Démo - Société minière B », envoyée, qui expire dans cinq jours ; offre « Étude de
faisabilité d'une unité de séchage (démo) » de MB AxisPro Consulting, en brouillon ; bon de commande
« Ciment du chantier (démo) » chez « Démo - Quincaillerie du port », approuvé, 120 sacs reçus sur
200, avec la pièce d'achat « FAC-QDP-0001 (démo) » en brouillon (150 sacs à 97 500 GNF) ; chantier
« Entrepôt de stockage (démo) » ; bon de commande « Groupe électrogène du chantier (démo) » chez
« Démo - Énergie et groupes de Guinée », 14 000 000 HT, facture proforma « PRO-EGG-0007 (démo) »
jointe, contrôlé, en attente de l'approbation de la direction générale ; bon de commande
« Gardiennage exonéré (démo) » sans TVA, en brouillon.

## A. Catalogue

### ACV-01. Lire le catalogue de la société

Objectif : vérifier que le catalogue montre les articles de la seule société de travail.

Compte : test.daf.

Données : aucune.

1. Ouvrez Comptabilité > Ventes, onglet « Catalogue ».
2. Lisez les colonnes « Article », « Type », « Unité », « Prix de vente HT », « TVA », « Activité »,
   « Usage ».
3. En haut de l'écran, passez dans MB AxisPro Consulting ; revenez dans EGUITRA GROUP SARLU.

Résultat attendu : dans EGUITRA GROUP SARLU, les cinq articles « (démo) » du groupe ; la location de
camion-benne est une « Prestation » au « Jours » (ou « Jour »), le ciment un « Article » marqué
« Achat ». Dans MB AxisPro Consulting, seuls l'accompagnement et l'étude au forfait (« fft »).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-02. Créer un article du catalogue

Objectif : vérifier la saisie d'un article avec son unité, son prix, son compte et sa TVA.

Compte : test.daf.

Données : « Pose de carrelage, au mètre carré (essai) », prestation, unité « m² », prix de vente
45 000, TVA de vente 18 %, compte de produit commençant par 706, activité « BTP ».

1. Onglet « Catalogue », « Nouvel article ».
2. Remplissez « Nom », « Type », « Unité », « Activité analytique ». Laissez « Vendu » coché.
3. Remplissez « Prix de vente HT (GNF) », « TVA de vente », « Compte de produit ».
4. Cliquez sur « Enregistrer ».

Résultat attendu : la fenêtre se ferme ; l'article apparaît dans la liste avec l'unité « m² », le
prix 45 000, la TVA, l'activité « BTP » et le badge « Vente ». En le rouvrant, le compte de produit
choisi est repris.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-03. Importer le catalogue depuis un fichier

Objectif : vérifier l'import au modèle fourni, puis la mise à jour par un second import.

Compte : test.daf.

Données : le modèle d'import, avec deux lignes ajoutées : « Location de chargeuse, par jour
(essai) », prestation, unité « fft », prix 2 500 000, TVA 18 % ; « Fer à béton de 12, la barre
(essai) », article, unité « ens. », prix 0, acheté « oui ».

1. Onglet « Catalogue », « Modèle d'import » : le fichier Excel se télécharge.
2. Remplissez les deux lignes sous l'en-tête, en gardant l'en-tête, et enregistrez.
3. Cliquez sur « Importer un fichier » et choisissez le fichier.
4. Changez le prix de la chargeuse à 2 600 000 dans le fichier, puis importez-le de nouveau.

Résultat attendu : à l'étape 3, « Import terminé : 2 articles créés, 0 mis à jour. » ; les deux
articles apparaissent. À l'étape 4, « 0 article créé, 2 mis à jour. » ; la chargeuse est à 2 600 000.
Une ligne à l'unité inconnue fait refuser tout le fichier avec « Ligne n : Unité inconnue… ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-04. Catalogue en lecture pour les achats

Objectif : vérifier que le profil Achats lit le catalogue sans le modifier.

Compte : test.achats.

Données : aucune.

1. Ouvrez Comptabilité > Achats et dépenses, onglet « Catalogue ».
2. Cherchez les boutons « Nouvel article », « Importer un fichier », « Modèle d'import ».
3. Cliquez sur une ligne du catalogue.

Résultat attendu : la liste s'affiche ; aucun des trois boutons n'est proposé ; cliquer sur une ligne
n'ouvre aucune fenêtre de modification. Les colonnes des comptes ne sont pas montrées.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## B. Offres commerciales

### ACV-05. Établir une offre avec rubriques, unités et remise

Objectif : vérifier la saisie complète d'une offre et sa numérotation propre à la société.

Compte : test.daf.

Données : client « Démo - Maître d'ouvrage » ; objet « Réfection de la cour (essai) » ; remise
générale 5 % ; rubrique « Terrassement » ; ligne « Terrassement en déblai, au m³ (démo) », 120 m³ ;
rubrique « Revêtement » ; ligne « Pose de carrelage, au mètre carré (essai) », 300 m² ; note
« Évacuation des gravats comprise (essai) » ; conditions « Exécution sous 30 jours (essai) ».

1. Ventes, onglet « Offres », « Nouvelle offre ».
2. Choisissez le « Client », saisissez le « Commentaire ou indication (objet) » et la « Remise
   générale (%) ». Laissez « Validité (jours) » vide.
3. Dans « Lignes », ajoutez les rubriques, les lignes (« Article du catalogue », puis la quantité) et
   la note avec « Rubrique », « Ligne » et « Note ».
4. Saisissez les « Conditions de l'offre », puis « Enregistrer l'offre ».

Résultat attendu : le total indicatif tient compte de la remise de 5 %. La fiche s'ouvre : numéro
OF/EG/2026/…, état « Brouillon », validité « 15 jours, jusqu'au … » ; les lignes portent leur unité
et la remise de 5 %. Notez le numéro.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-06. Imprimer l'offre

Objectif : vérifier l'offre imprimée au gabarit des factures de la société.

Compte : test.daf.

Données : l'offre d'ACV-05.

1. Ouvrez la fiche de l'offre, puis « Offre en PDF ».
2. Lisez le document.

Résultat attendu : le document porte le logo et l'identité d'EGUITRA GROUP SARLU, le titre « OFFRE »,
« N° OF/EG/2026/… », « Conakry, le … », le bloc « CLIENT » ; à droite « Référence offre : OF/EG/… » et
« Validité offre : 15 jours, jusqu'au … » ; « Commentaire ou indication : Réfection de la cour
(essai) » ; les rubriques « I. Terrassement » et « II. Revêtement » avec leur sous-total, les colonnes
« Unité » et « Remise », la note ; les totaux HT, TVA et TTC ; « Arrêtée la présente offre à la somme
de : » suivi du montant en lettres ; « CONDITIONS DE L'OFFRE ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-07. Marquer l'offre envoyée

Objectif : vérifier qu'une offre remise au client passe « Envoyée » et ne se modifie plus.

Compte : test.daf.

Données : l'offre d'ACV-05.

1. Sur la fiche, cliquez sur « Marquer envoyée ».
2. Cherchez le bouton « Modifier ».

Résultat attendu : « Offre marquée envoyée. » ; l'état devient « Envoyée », la date d'envoi
s'affiche. « Modifier » n'est plus proposé : une offre envoyée se change par une nouvelle version.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-08. Envoyer l'offre par courriel

Objectif : vérifier l'envoi par courriel, ou son refus clair sans serveur de courrier.

Compte : test.daf.

Données : l'offre d'ACV-05 ; adresse « essai@exemple.test ».

1. Sur la fiche, « Envoyer par courriel ».
2. Saisissez l'adresse, puis « Envoyer ».

Résultat attendu : avec un serveur de courrier, « Courriel envoyé, l'offre en PDF jointe. » et
l'adresse s'affiche sous « Envoyée ». Sans serveur, un message en français : « Aucun serveur d'envoi
de courriel n'est paramétré : imprimez le document et remettez-le. » ; rien ne change.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-09. Créer une nouvelle version

Objectif : vérifier qu'une nouvelle version reprend l'offre et remplace l'ancienne.

Compte : test.daf.

Données : l'offre d'ACV-05 ; nouvelle quantité de carrelage : 280 m².

1. Sur la fiche, « Nouvelle version ».
2. Sur la fiche de la version, « Modifier », changez la quantité de carrelage, « Enregistrer
   l'offre ».
3. Dans « Versions », cliquez sur la première version.

Résultat attendu : la version porte le numéro de l'offre suivi de « -V2 », état « Brouillon »,
validité de nouveau 15 jours, les mêmes lignes. La première version est « Remplacée » ; « Nouvelle
version » n'y est plus accepté (« Une version plus récente existe déjà »).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-10. Enregistrer le refus du client

Objectif : vérifier qu'un refus exige son motif.

Compte : test.daf.

Données : une offre en brouillon créée pour l'occasion (une ligne libre « Prestation (essai) »,
100 000) ; motif « Budget reporté à l'an prochain (essai) ».

1. Sur sa fiche, « Refusée par le client ».
2. Laissez le motif vide : le bouton reste grisé. Saisissez le motif, puis « Enregistrer le refus ».
3. Imprimez l'offre.

Résultat attendu : l'état devient « Refusée » avec le motif affiché. L'offre imprimée porte en tête
« OFFRE REFUSÉE par le client : document sans valeur d'engagement. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-11. Expiration d'une offre

Objectif : vérifier qu'une offre dont la validité est passée ne s'accepte plus et expire la nuit.

Compte : test.daf.

Données : une offre datée d'il y a 20 jours, validité 15 jours, une ligne libre.

1. « Nouvelle offre », « Date de l'offre » il y a 20 jours, « Validité (jours) » 15, une ligne,
   « Enregistrer l'offre ».
2. Cliquez sur « Acceptée par le client », puis confirmez.
3. Le lendemain, rouvrez la fiche.

Résultat attendu : à l'étape 2, un message : « L'offre … a expiré le … : créez-en une nouvelle
version, à faire accepter. ». Le lendemain, l'état est « Expirée » ; « Nouvelle version » reste
proposée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-12. Relancer une offre qui expire bientôt

Objectif : vérifier le repérage des offres qui expirent et la relance du client.

Compte : test.daf.

Données : l'offre « Location de deux camions-bennes (démo) ».

1. Onglet « Offres », vue « En cours » : lisez la colonne « Validité ».
2. Ouvrez la fiche, « Relancer le client », adresse « essai@exemple.test », « Envoyer ».

Résultat attendu : la ligne de l'offre porte « expire dans 5 j » (ou moins) sous sa date de validité.
La relance part par courriel avec l'offre jointe, ou, sans serveur de courrier, est refusée avec le
message de ACV-08.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-13. Numérotation propre à MB AxisPro Consulting

Objectif : vérifier que chaque société a sa propre suite de numéros.

Compte : test.daf.

Données : en haut de l'écran, la société MB AxisPro Consulting ; une offre au client « Démo - Porteur
de projet accompagné », ligne « Étude de faisabilité, au forfait (démo) ».

1. Passez dans MB AxisPro Consulting, Ventes, onglet « Offres ».
2. Créez l'offre, puis imprimez-la.

Résultat attendu : le numéro commence par OF/MBAX/2026/ ; l'offre imprimée porte l'identité et la
couleur de MB AxisPro Consulting, et l'unité « fft ». L'offre « Étude de faisabilité d'une unité de
séchage (démo) » figure dans la liste ; aucune offre d'EGUITRA GROUP SARLU n'y apparaît.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## C. Commandes et facturation

### ACV-14. Accepter une offre : elle devient commande

Objectif : vérifier le passage de l'offre à la commande.

Compte : test.daf.

Données : la version V2 d'ACV-09.

1. Sur la fiche, « Acceptée par le client », puis confirmez.
2. Ouvrez l'onglet « Commandes ».

Résultat attendu : « Offre acceptée : elle est devenue commande. » ; l'état est « Acceptée » ; la
carte « Facturation de la commande » montre « Commandé HT », « Facturé HT » à 0 et « Reste à
facturer HT ». La commande figure dans l'onglet « Commandes ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-15. Facturer une avance de démarrage de 50 %

Objectif : vérifier la facture d'acompte en pourcentage.

Compte : test.daf.

Données : la commande d'ACV-14 ; « Avance de démarrage 50 % ».

1. Sur la fiche de la commande, « Facturer un acompte ».
2. Choisissez « Pourcentage », saisissez 50 et le libellé, puis « Créer la facture d'acompte ».

Résultat attendu : la carte montre une ligne « Acompte ou avance » en « Brouillon » ; « Acomptes
facturés » vaut la moitié du hors taxes. Dans l'onglet « Factures », le brouillon porte le client,
la référence de l'offre (« Référence offre ») et la ligne « Avance de démarrage 50 % », au compte
4191, TVA comprise.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-16. Valider et imprimer la facture d'acompte

Objectif : vérifier que la facture produite est une facture de la plateforme, au gabarit du client.

Compte : test.daf.

Données : le brouillon d'ACV-15.

1. Onglet « Factures », ouvrez le brouillon, validez-le.
2. Imprimez la facture.

Résultat attendu : la facture reçoit le numéro suivant du journal de vente ; elle porte « FACTURE »,
« Référence offre : OF/EG/…-V2 », « Commentaire ou indication : Réfection de la cour (essai) », la
ligne de l'acompte, la TVA 18 % et le montant en lettres.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-17. Facturer un deuxième acompte en montant

Objectif : vérifier l'acompte en montant TVA comprise, et la borne du reste à facturer.

Compte : test.daf.

Données : la commande d'ACV-14 ; un montant TTC égal à 30 % du total TTC ; libellé « Deuxième
acompte 30 % ».

1. « Facturer un acompte », « Montant TTC », le montant et le libellé, « Créer la facture
   d'acompte ».
2. Validez la facture dans l'onglet « Factures ».
3. Essayez un nouvel acompte de 30 %.

Résultat attendu : la facture d'acompte vaut le montant saisi, TVA comprise. À l'étape 3, le message
« L'acompte dépasse ce qui reste à facturer de la commande. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-18. Facture finale : les acomptes sont déduits

Objectif : vérifier la déduction des acomptes sur la facture du solde.

Compte : test.daf.

Données : la commande d'ACV-14, ses deux acomptes validés.

1. Sur la fiche, « Facturer le reste (acomptes déduits) ».
2. Ouvrez le brouillon dans l'onglet « Factures ».

Résultat attendu : « Facture créée en brouillon, acomptes déduits… » ; la facture porte toutes les
lignes de la commande, puis deux lignes négatives « Déduction : Avance de démarrage 50 % » et
« Déduction : Deuxième acompte 30 % » ; son hors taxes est 20 % de la commande. Sur la fiche,
« Acomptes à déduire » vaut 0 et « Reste à facturer HT » 0.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-19. Facturer les quantités exécutées

Objectif : vérifier la facturation d'une prestation au fur et à mesure de son exécution.

Compte : test.daf.

Données : une offre acceptée pour « Démo - Société minière B », ligne « Location de camion-benne, par
jour (démo) », 20 jours ; 8 jours exécutés, puis 20.

1. Créez l'offre, puis « Acceptée par le client ».
2. « Quantités exécutées… », saisissez 8, puis « Enregistrer et facturer l'exécuté ».
3. De nouveau « Quantités exécutées… », 20, puis « Enregistrer et facturer l'exécuté ».

Résultat attendu : une première facture en brouillon de 8 jours, puis une seconde de 12 jours. La
colonne « Facturé » de la ligne passe à 8, puis 20 ; « Reste à facturer HT » vaut 0. Une quantité
exécutée au-delà des 20 jours commandés est refusée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-20. Annuler une commande

Objectif : vérifier qu'une commande ne s'annule que sans facture validée.

Compte : test.daf.

Données : la commande « Crépissage du bâtiment administratif (démo) », puis une commande acceptée
sans facture.

1. Ouvrez la commande de démonstration, « Annuler », confirmez.
2. Acceptez une offre d'essai sans la facturer, puis « Annuler », confirmez.

Résultat attendu : à l'étape 1, le message « La commande … a des factures validées (…) : établissez
un avoir depuis les ventes. » ; rien ne change. À l'étape 2, l'état devient « Annulée ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## D. Offre de travaux et chantier

### ACV-21. Établir une offre de travaux

Objectif : vérifier la saisie d'une offre de travaux avec avance de démarrage et retenue de garantie.

Compte : test.daf.

Données : client « Démo - Maître d'ouvrage » ; objet « Clôture du terrain (essai) » ; « Offre de
travaux (BTP) » cochée ; avance de démarrage 30 % ; retenue de garantie 5 % ; « Chantier existant »
vide ; deux lignes libres « Fondations de la clôture » 40 000 000 et « Élévation et enduit »
60 000 000.

1. « Nouvelle offre », remplissez l'en-tête, cochez la case de la carte « Offre de travaux (BTP) »,
   saisissez les taux.
2. Ajoutez les lignes, « Enregistrer l'offre ».

Résultat attendu : la fiche porte « Offre de travaux : avance de démarrage 30 %, retenue de garantie
5 %, chantier créé à l'acceptation. » ; le hors taxes est de 100 000 000.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-22. Acceptée, l'offre crée le chantier

Objectif : vérifier la création du chantier au montant de l'offre.

Compte : test.daf, puis test.chantiers.

Données : l'offre d'ACV-21.

1. test.daf : « Acceptée par le client », confirmez.
2. Lisez la carte « Chantier … » de la fiche ; cherchez « Facturer le reste ».
3. test.chantiers : ouvrez Métiers > BTP.

Résultat attendu : la carte « Chantier Clôture du terrain (essai) » montre le marché à 100 000 000 HT
et l'avance de démarrage à 30 %, soit 30 000 000 HT ; aucun bouton de facturation de la commande
(elle se facture par ses situations). Dans BTP, le chantier « Clôture du terrain (essai) » existe,
au maître d'ouvrage et au montant du marché de l'offre, retenue 5 %.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-23. Facturer l'avance de démarrage

Objectif : vérifier la facture unique de l'avance.

Compte : test.daf.

Données : la commande d'ACV-22.

1. Sur la fiche, « Facturer l'avance de démarrage », confirmez.
2. Lisez la liste des factures de la carte ; ouvrez la facture dans l'onglet « Factures ».

Résultat attendu : « Avance de démarrage facturée. » ; la facture est validée : « Avance de démarrage
30 % du marché - Clôture du terrain (essai) », 30 000 000 HT, 35 400 000 TTC, au compte 4191, avec la
référence de l'offre. « Avance à déduire » vaut 30 000 000 ; le bouton n'est plus proposé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-24. Situation d'avancement : l'avance se déduit au prorata

Objectif : vérifier la déduction de l'avance sur une situation, la retenue restant celle d'avant.

Compte : test.chantiers, puis test.daf.

Données : le chantier « Clôture du terrain (essai) » ; situation au cumul de 40 000 000.

1. test.chantiers : dans BTP, ouvrez le chantier, ajoutez la situation au cumul de 40 000 000.
2. test.daf : facturez la situation.
3. Ouvrez sa facture dans l'onglet « Factures ».

Résultat attendu : la facture porte la ligne des travaux de 40 000 000 et la ligne « Déduction de
l'avance de démarrage - situation n° 1 » de -12 000 000 (30 % des travaux), soit 28 000 000 HT et
33 040 000 TTC ; la retenue de garantie est de 2 000 000 (5 % des 40 000 000 de travaux). Sur la
commande, « Avance à déduire » vaut 18 000 000.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-25. Dernière situation : l'avance s'épuise

Objectif : vérifier que la situation qui atteint le montant du marché déduit le reste de l'avance.

Compte : test.chantiers, puis test.daf.

Données : le même chantier ; situation au cumul de 100 000 000.

1. test.chantiers : ajoutez la situation au cumul de 100 000 000.
2. test.daf : facturez-la ; ouvrez la fiche de la commande.

Résultat attendu : la facture déduit 18 000 000, le reste de l'avance ; « Avance à déduire » vaut 0 ;
« Travaux facturés HT » vaut 100 000 000 (100 %).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## E. Bons de commande fournisseur

### ACV-26. Bon de commande depuis un engagement approuvé

Objectif : vérifier qu'un bon de commande dans la limite de son engagement est approuvé d'office.

Compte : test.chantiers, test.comptable, puis test.achats.

Données : engagement « Fers à béton du chantier (essai) », fournisseur « Démo - Quincaillerie du
port », 6 000 000 HT ; ligne libre « Fer à béton de 12, la barre », 1 000 barres à 6 000, catégorie
de dépense au choix.

1. test.chantiers : Pilotage > Engagements de dépense, « Nouvel engagement », remplissez et
   « Soumettre à l'approbation ».
2. test.comptable : « À valider », approuvez la demande.
3. test.chantiers : rouvrez l'engagement ; regardez la carte « Bons de commande ».
4. test.achats : Achats et dépenses, onglet « Bons de commande », « Nouveau bon de commande » ;
   choisissez l'engagement dans « Engagement de dépense approuvé ».
5. Ajoutez la ligne (« Ligne », désignation, quantité, prix, « Catégorie de dépense »), puis
   « Soumettre à l'approbation ».

Résultat attendu : à l'étape 3, la carte n'offre pas « Bon de commande » à test.chantiers et indique
que le service Achats émet le bon depuis l'engagement (émission réservée chez EGUITRA GROUP SARLU).
Le fournisseur et l'objet de l'engagement sont repris. Le bon de commande
BC/EG/2026/… est aussitôt « Approuvé », sans nouvelle demande dans « À valider » : il reste dans
l'engagement approuvé. Il apparaît dans la carte « Bons de commande » de l'engagement et sous
Pilotage > Bons de commande. Un bon saisi sans ligne depuis un engagement dont la finance a précisé
le compte reprend seul le reste de l'engagement.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-27. Bon de commande direct, soumis au circuit

Objectif : vérifier qu'un bon de commande direct suit le circuit des bons de commande.

Compte : test.achats.

Données : fournisseur « Démo - Quincaillerie du port » ; objet « Peinture de façade (essai) » ;
ligne libre « Peinture acrylique, seau de 20 l », 40 seaux à 150 000, catégorie de dépense au choix.

1. Achats et dépenses, onglet « Bons de commande », « Nouveau bon de commande ».
2. Laissez « Engagement de dépense approuvé » vide ; remplissez le fournisseur, l'objet, la ligne et
   sa « Catégorie de dépense ».
3. « Soumettre à l'approbation ».

Résultat attendu : avant la soumission, le formulaire montre le circuit prévu pour 6 000 000 HT :
« Contrôle : chef comptable ou DAF » et « Approbation : direction générale (jusqu'à 10 M GNF HT…) »
requises, « Approbation : direction générale (plus de 10 M GNF HT) » sans objet. Après, le bon est
« En approbation », « chez : Finance et comptabilité ». Aucun champ de compte n'est proposé : la
catégorie fixe le compte. Notez le numéro.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-28. Quatre yeux : l'auteur n'approuve pas son bon

Objectif : vérifier que celui qui saisit un bon de commande n'en tranche aucune étape.

Compte : test.comptable, puis test.daf, dans la société MB AxisPro Consulting (où l'émission des bons
n'est pas réservée au service Achats).

Données : un bon de commande direct de 3 000 000 saisi et soumis par test.comptable, ligne libre et
catégorie de dépense au choix.

1. test.comptable : choisissez la société MB AxisPro Consulting ; créez et soumettez le bon de commande.
2. test.comptable : ouvrez « À valider ».
3. test.daf : ouvrez « À valider », puis la demande du bon.

Résultat attendu : chez test.comptable, la demande n'est pas dans la corbeille « À valider » (elle
figure dans ses demandes). Chez test.daf, elle y est, avec le détail du bon (« Saisi par … : ni lui,
ni le demandeur de son engagement ne tranchent une étape »), et « Approuver » est proposé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-29. Approuver un bon de commande de plus de 10 M

Objectif : vérifier les deux étapes du circuit (contrôle, approbation) et leurs responsables.

Compte : test.achats, test.comptable, test.daf, puis test.dg.

Données : bon de commande direct « Groupe électrogène 100 kVA (essai) », une ligne de 60 000 000.

1. test.achats : créez et soumettez le bon.
2. test.comptable : « À valider », ouvrez la demande, « Approuver » (contrôle).
3. test.daf : ouvrez « À valider ».
4. test.dg : « À valider », ouvrez la demande, « Approuver », confirmez.

Résultat attendu : la demande porte deux étapes : « Contrôle : chef comptable ou DAF », puis
« Approbation : direction générale (plus de 10 M GNF HT) ». Après test.comptable, le bon reste « En
approbation », chez la direction générale ; la demande n'est pas dans la corbeille de test.daf (le
contrôle est fait, une seule fois). Après test.dg, le bon est « Approuvé » ; son PDF porte le bloc
« CIRCUIT D'APPROBATION » avec les deux noms, leurs décisions, dates et heures.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-30. Refus puis nouvelle soumission

Objectif : vérifier le retour du bon en brouillon après un refus motivé.

Compte : test.daf, puis test.achats.

Données : le bon d'ACV-27 ; motif « Joindre un second devis (essai) ».

1. test.daf : refusez la demande avec le motif.
2. test.achats : ouvrez le bon ; « Modifier », ramenez la quantité à 35 seaux, « Soumettre à
   l'approbation ».

Résultat attendu : après le refus, le bon est « Refusé », avec « Refusé par … : Joindre un second
devis (essai) ». Après la modification, il repart « En approbation » ; la nouvelle demande montre le
nouveau montant.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-31. Imprimer et envoyer le bon de commande

Objectif : vérifier le bon de commande imprimé et son envoi au fournisseur.

Compte : test.achats.

Données : le bon d'ACV-26 (approuvé).

1. Ouvrez le bon, « Bon de commande en PDF ».
2. « Envoyer au fournisseur », adresse « essai@exemple.test », « Envoyer ».
3. Sans serveur de courrier, « Marquer envoyé ».

Résultat attendu : le document porte « BON DE COMMANDE », « N° BC/EG/2026/… », le bloc « FOURNISSEUR »,
« Engagement : ENG/… », les lignes, « Arrêté le présent bon de commande, toutes taxes comprises, à la
somme de : », et le bloc « CIRCUIT D'APPROBATION » : « Établi par … », puis « Approuvé d'office : dans
la limite de l'engagement approuvé ENG/… ». Le courriel part avec le bon joint, ou le message
d'absence de serveur s'affiche ; après « Marquer envoyé », l'état est « Envoyé ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-32. Annuler un bon de commande

Objectif : vérifier l'annulation d'un bon sans réception.

Compte : test.achats.

Données : le bon d'ACV-30, en approbation.

1. Ouvrez le bon, « Annuler », confirmez.
2. Ouvrez « Mes demandes ».

Résultat attendu : le bon est « Annulé » ; sa demande d'approbation est annulée et n'attend plus
personne.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## F. Réceptions

### ACV-33. Réception partielle avec bon de livraison

Objectif : vérifier la réception (service fait) partielle, par qui, quand, et sa pièce jointe.

Compte : test.chantiers.

Données : le bon d'ACV-26 ; 400 barres reçues ; un PDF ou une photo de bon de livraison.

1. Pilotage > Bons de commande, ouvrez le bon, « Enregistrer une réception ».
2. Dans « Reçu ce jour », saisissez 400 ; « Observations » « Première livraison (essai) » ;
   « Joindre le bon de livraison ».
3. « Enregistrer la réception ».

Résultat attendu : l'état devient « Reçu partiellement » ; la carte « Réceptions (service fait) »
montre REC/EG/2026/…, la date, « Constatée par » test.chantiers, les 400 barres et le bon de
livraison, téléchargeable.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-34. Pas de réception au-delà de la commande

Objectif : vérifier le refus d'une quantité reçue supérieure à la commande.

Compte : test.chantiers.

Données : le même bon ; 1 000 barres.

1. « Enregistrer une réception », saisissez 1 000.
2. « Enregistrer la réception ».

Résultat attendu : le message « … reçus en plus des … déjà reçus dépassent les … commandés. Faites
modifier la commande. » ; aucune réception n'est ajoutée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-35. Annuler une réception

Objectif : vérifier l'annulation motivée d'une réception.

Compte : test.chantiers.

Données : la réception d'ACV-33 ; motif « Quantité mal comptée (essai) ».

1. Dans la carte « Réceptions (service fait) », « Annuler » sur la ligne.
2. Saisissez le motif, « Annuler la réception ».
3. Enregistrez de nouveau la réception des 400 barres.

Résultat attendu : la réception passe « Annulée » ; la colonne « Reçu » de la ligne revient à 0 et
l'état à « Approuvé » ou « Envoyé ». La nouvelle réception remet le bon « Reçu partiellement ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## G. Rapprochement des pièces d'achat

### ACV-36. Pièce conforme : validée sans circuit

Objectif : vérifier qu'une facture du fournisseur conforme à la commande et à la réception se valide
sans repasser par le circuit.

Compte : test.achats.

Données : le bon d'ACV-33 ; facture « FAC-ESSAI-36 », date du jour, 400 barres à 6 000.

1. Ouvrez le bon, « Saisir la facture du fournisseur ».
2. Saisissez le numéro et la date ; gardez les quantités (le reçu non facturé) et les prix.
3. « Enregistrer et soumettre ».

Résultat attendu : la fenêtre « Pièce d'achat rattachée » dit « Conforme à la commande et à la
réception : comptabilisée sans circuit. ». La carte « Pièces d'achat rattachées et rapprochement »
montre la pièce « Conforme », « Comptabilisée » ; sur l'engagement, le consommé augmente d'autant.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-37. Écart de prix : la pièce passe par le circuit

Objectif : vérifier qu'un prix facturé au-delà de la tolérance renvoie la pièce au circuit des
pièces d'achat.

Compte : test.achats, puis test.comptable.

Données : le bon d'ACV-29 (groupe électrogène, approuvé) ; prix facturé 63 000 000, soit 5 % de plus
que le prix commandé.

1. test.achats : ouvrez le bon, « Enregistrer une réception » (1 reçu), « Enregistrer la réception ».
2. « Saisir la facture du fournisseur », « PU HT facturé » 63 000 000, « Enregistrer et soumettre ».
3. test.comptable : « À valider », approuvez la pièce.

Résultat attendu : à l'étape 2, « Écart de rapprochement : « Groupe électrogène 100 kVA (essai) » :
prix facturé 63 000 000 pour 60 000 000 commandé. Soumise, elle passe par le circuit des pièces
d'achat. » ; la pièce reste en brouillon, en validation (contrôle de la finance, puis accord de la
direction au-delà de 50 M). Elle n'est comptabilisée qu'au bout du circuit.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-38. Écart bloquant selon le réglage

Objectif : vérifier qu'un écart bloque la pièce quand l'administration le règle ainsi.

Compte : test.admin, puis test.achats.

Données : la pièce « FAC-QDP-0001 (démo) » du bon « Ciment du chantier (démo) » (150 sacs facturés
pour 120 reçus, à 97 500 pour 95 000).

1. test.admin : Administration > Achats et ventes, « Une pièce en écart » : « Écart bloquant »,
   « Enregistrer les réglages ».
2. test.achats : Achats et dépenses, onglet « Pièces d'achat », ouvrez la pièce et validez-la.
3. test.admin : remettez « Écart soumis au circuit des pièces d'achat ».

Résultat attendu : à l'étape 2, le message « La pièce … s'écarte du bon de commande … : « Ciment
CPA 42,5… » : 150 facturés pour 120 reçus. … prix facturé 97 500 pour 95 000 commandé. Corrigez la
pièce (quantités, prix) ou enregistrez la réception manquante. » ; la pièce reste en brouillon.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-39. Lire le rapprochement sur le bon de commande

Objectif : vérifier l'affichage des écarts d'une pièce rattachée.

Compte : test.daf.

Données : le bon « Ciment du chantier (démo) ».

1. Achats et dépenses, onglet « Bons de commande », vue « À recevoir », ouvrez le bon.
2. Lisez les cartes « Réceptions (service fait) » et « Pièces d'achat rattachées et rapprochement ».

Résultat attendu : la réception de 120 sacs, et la pièce « FAC-QDP-0001 (démo) » marquée « Écart »,
avec les deux écarts écrits en clair, et « Passe par le circuit des pièces d'achat. ». Le bon est
« Reçu partiellement » (120 sur 200).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-40. Pièce d'achat sans commande : rien ne change

Objectif : vérifier qu'une pièce d'achat saisie sans bon de commande suit les règles actuelles.

Compte : test.achats, puis test.comptable.

Données : pièce d'achat « Fournitures de bureau (essai) », 500 000, catégorie au choix, saisie
directement.

1. test.achats : onglet « Pièces d'achat », « Nouvelle pièce d'achat », saisissez et soumettez.
2. test.comptable : « À valider », approuvez.

Résultat attendu : comme avant le module : la pièce part au circuit (« Pièces d'achat : contrôle de
la finance ») et n'est comptabilisée qu'après l'approbation.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## H. Devis fournisseurs

### ACV-41. Comparer des devis et retenir le meilleur

Objectif : vérifier la comparaison des devis d'un engagement et le choix motivé.

Compte : test.chantiers.

Données : engagement en brouillon « Location de groupe électrogène (essai) », 4 000 000 ; devis
« Démo - Quincaillerie du port » 4 000 000, délai 10 jours ; second devis d'un autre fournisseur
3 600 000, délai 15 jours ; motif « Moins cher, délai acceptable (essai) ».

1. Créez l'engagement en brouillon, ouvrez-le.
2. Dans « Devis fournisseurs comparés », « Ajouter un devis », deux fois ; joignez une pièce à l'un.
3. « Retenir » sur le second, motif, « Retenir ce devis ».

Résultat attendu : les deux devis s'affichent avec montant, délai et pièce. Le second est « Retenu »
avec son motif ; l'engagement prend son fournisseur et son montant (3 600 000).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-42. Trois devis au-delà du seuil

Objectif : vérifier la règle des trois devis, désactivée par défaut, réglée par l'administration.

Compte : test.admin, puis test.chantiers.

Données : seuil 3 000 000 ; l'engagement d'ACV-41.

1. test.admin : Administration > Achats et ventes, « Trois devis exigés au-delà de (GNF HT) » :
   3 000 000, « Enregistrer les réglages ».
2. test.chantiers : sur l'engagement, « Soumettre à l'approbation ».
3. Ajoutez un troisième devis, retenez de nouveau le second, puis soumettez.
4. test.admin : remettez le seuil à 0.

Résultat attendu : à l'étape 2, le message « Un engagement de plus de 3 000 000 GNF HT se soumet avec 3
devis de fournisseurs différents au moins (2 joints). » ; la carte le rappelle. À l'étape 3,
l'engagement part en approbation.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-43. Devis figés après la soumission

Objectif : vérifier que les devis d'un engagement soumis ne changent plus.

Compte : test.chantiers.

Données : l'engagement d'ACV-42, en approbation.

1. Ouvrez l'engagement, cherchez « Ajouter un devis », « Retenir » et la corbeille des devis.

Résultat attendu : aucun de ces boutons n'est proposé ; les devis et le choix restent lisibles.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## I. Tableaux de bord et exports

### ACV-44. Tableau de bord des ventes

Objectif : vérifier les indicateurs des ventes.

Compte : test.dg.

Données : aucune.

1. Ventes, onglet « Tableau de bord ».
2. Lisez « Offres en cours », « Taux de transformation », « Reste à facturer », « Acomptes à
   déduire » ; parcourez les trois onglets.
3. Changez la période « Offres datées du … au … ».

Résultat attendu : les offres en cours comptent celle des camions-bennes, signalée sous sa validité ;
le taux de transformation rapporte les offres acceptées aux offres décidées (acceptées, refusées,
expirées) de la période ; « Acomptes à déduire » liste la commande « Crépissage du bâtiment
administratif (démo) ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-45. Tableau de bord des achats

Objectif : vérifier les indicateurs des achats.

Compte : test.daf.

Données : aucune.

1. Achats et dépenses, onglet « Tableau de bord ».
2. Parcourez « À recevoir », « À facturer », « Écarts », « Engagements non soldés ».

Résultat attendu : « Ciment du chantier (démo) » est à recevoir (reste 80 sacs) ; il n'est pas « À
facturer », sa pièce en brouillon couvrant déjà plus que le reçu ; « Écarts » montre « FAC-QDP-0001
(démo) » et ses écarts ; les engagements approuvés non soldés sont listés avec leur reste.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-46. Exporter les tableaux de bord

Objectif : vérifier les exports Excel et CSV.

Compte : test.daf.

Données : aucune.

1. Sur le tableau de bord des ventes, « Excel », puis « CSV du tableau » sur l'onglet « Commandes à
   facturer ».
2. Sur celui des achats, « Excel ».

Résultat attendu : le classeur des ventes a quatre feuilles (« Synthèse », « Offres en cours »,
« Commandes à facturer », « Acomptes à déduire »), avec la société et la date d'export en tête ; le
CSV reprend les colonnes du tableau, séparées par des points-virgules ; les montants sont des
nombres, aucun texte n'est lu comme une formule.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## J. Réglages

### ACV-47. Régler la validité et le rapprochement

Objectif : vérifier les réglages propres à chaque société.

Compte : test.admin.

Données : validité 10 jours, tolérance de prix 3 %, dans MB AxisPro Consulting.

1. Passez dans MB AxisPro Consulting, Administration > Achats et ventes.
2. « Validité par défaut (jours) » : 10 ; « Tolérance sur les prix (%) » : 3 ; « Enregistrer les
   réglages ».
3. Repassez dans EGUITRA GROUP SARLU, rouvrez l'écran.
4. Remettez 15 et 2 dans MB AxisPro Consulting.

Résultat attendu : « Réglages enregistrés. » ; dans EGUITRA GROUP SARLU, la validité reste 15 jours
et la tolérance 2 %. Une validité de 0 est refusée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-48. Régler la numérotation

Objectif : vérifier le préfixe et le prochain numéro, et le refus d'un numéro déjà donné.

Compte : test.daf.

Données : la carte « Numérotation », ligne « Offres commerciales ».

1. Administration > Achats et ventes ; lisez « Prochain : OF/EG/2026/… ».
2. Mettez « Prochain numéro » au numéro d'une offre déjà créée, « Enregistrer les réglages ».
3. Remettez le prochain numéro affiché à l'étape 1.

Résultat attendu : à l'étape 2, « Le numéro OF/EG/2026/… existe déjà : choisissez un numéro suivant le
dernier attribué. » ; rien ne change.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## K. Refus attendus

### ACV-49. Le profil Achats ne voit pas les ventes

Objectif : vérifier que le profil Achats n'atteint ni les offres ni les commandes des clients.

Compte : test.achats.

Données : aucune.

1. Ouvrez le menu de Finance ; cherchez « Ventes ».
2. Ouvrez l'adresse de la recette suivie de /finance/ventes/offres.

Résultat attendu : « Ventes » n'est pas au menu ; la page des offres affiche un refus en français
(« Accès non autorisé pour votre profil. »), sans données.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-50. La direction établit des offres, la finance facture

Objectif : vérifier que la direction ne crée pas de facture depuis une commande.

Compte : test.dg.

Données : une commande acceptée (par exemple celle d'ACV-19).

1. Créez une offre d'essai : elle s'enregistre.
2. Ouvrez la commande ; cherchez « Facturer un acompte » et « Facturer le reste ».

Résultat attendu : l'offre s'enregistre ; sur la commande, les boutons de facturation ne sont pas
proposés à la direction (« Quantités exécutées… » reste proposé).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-51. Un métier ne voit que ses bons de commande

Objectif : vérifier que le BTP ne voit que ses demandes et ne saisit pas la pièce d'achat.

Compte : test.chantiers.

Données : le bon d'ACV-26 (le sien) et celui d'ACV-27 (de test.achats).

1. Pilotage > Bons de commande : lisez la liste.
2. Ouvrez le bon d'ACV-26 ; cherchez « Saisir la facture du fournisseur ».

Résultat attendu : la liste montre le bon d'ACV-26, pas celui d'ACV-27 ; aucune barre d'onglets ;
« Saisir la facture du fournisseur » n'est pas proposé (réservé à la finance et aux achats).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-52. Réglages réservés à l'administration et à la finance

Objectif : vérifier le refus des réglages aux autres profils.

Compte : test.dg, puis test.exploitation.

Données : aucune.

1. test.dg : cherchez « Achats et ventes » dans Administration ; ouvrez l'adresse de la recette
   suivie de /finance/admin/commerce.
2. test.exploitation : ouvrez la même adresse.

Résultat attendu : l'entrée n'est pas au menu ; la page affiche un refus en français, sans réglages.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## L. Séparation des deux sociétés

### ACV-53. Les offres de chaque société restent dans ses livres

Objectif : vérifier que les comptabilités restent séparées.

Compte : test.daf.

Données : l'offre d'ACV-13 (MB AxisPro Consulting).

1. Dans EGUITRA GROUP SARLU, Ventes, onglet « Offres », vue « Toutes » : cherchez OF/MBAX.
2. Dans MB AxisPro Consulting, essayez une offre avec l'article « Location de camion-benne, par jour
   (démo) » : la liste « Article du catalogue » ne le propose pas.
3. Dans MB AxisPro Consulting, cherchez la carte « Offre de travaux (BTP) » du formulaire.

Résultat attendu : aucune offre OF/MBAX dans EGUITRA GROUP SARLU ; le catalogue de MB AxisPro
Consulting ne propose que ses articles ; la carte « Offre de travaux (BTP) » n'apparaît pas (les
chantiers ne concernent qu'EGUITRA GROUP SARLU).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-54. Le cabinet n'ouvre pas Finance

Objectif : vérifier qu'un compte du cabinet n'atteint pas les achats et les ventes.

Compte : test.consultant.

Données : aucune.

1. Ouvrez l'adresse de la recette suivie de /finance/ventes/offres.
2. Ouvrez l'adresse de la recette suivie de /finance/achats/commandes.

Résultat attendu : NIMOVA ouvre AxisPro Suite ou affiche un refus en français ; aucune offre ni aucun
bon de commande n'est montré.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## M. Bons de commande : retour du client du 2 novembre

### ACV-55. Créer un fournisseur depuis le bon de commande

Objectif : vérifier qu'un fournisseur absent se crée depuis le formulaire du bon, enregistré aussitôt
dans la base et choisi dans le bon.

Compte : test.achats.

Données : fournisseur « Menuiserie de Matoto (essai) », NIF 445566778, RCCM « RCCM essai 0042 »,
téléphone 620 00 00 42, ville Conakry ; ligne libre « Portes isoplanes », 4 à 450 000, catégorie
de dépense au choix.

1. Achats et dépenses, onglet « Bons de commande », « Nouveau bon de commande ».
2. Dans « Fournisseur », tapez « Menuiserie de Matoto (essai) », puis « Créer « Menuiserie de
   Matoto (essai) » » (ou le bouton « Nouveau » à côté du champ).
3. Dans la fenêtre « Nouveau fournisseur », complétez le NIF, le RCCM, le téléphone et la ville,
   puis « Enregistrer le fournisseur ».
4. Ajoutez la ligne, « Enregistrer en brouillon ».
5. Ouvrez un nouveau bon de commande et cherchez « Matoto » dans « Fournisseur ».

Résultat attendu : la fenêtre se ferme, le fournisseur est choisi dans le bon ; le bon s'enregistre
à son nom. À l'étape 5, la fiche est proposée dans la liste : elle est dans la base des
fournisseurs, avec son NIF et sa ville.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-56. Doublon probable : reprendre la fiche existante

Objectif : vérifier qu'un fournisseur déjà connu n'est pas créé une seconde fois par mégarde.

Compte : test.achats.

Données : le fournisseur d'ACV-55 ; nom saisi « MENUISERIE DE MATOTO (ESSAI) SARL » ; puis un autre
nom, « Atelier bois (essai) », avec le NIF 445566778.

1. « Nouveau bon de commande », « Fournisseur » : « Nouveau », saisissez le premier nom,
   « Enregistrer le fournisseur ».
2. Lisez l'avertissement, puis « Reprendre cette fiche ».
3. Recommencez avec « Atelier bois (essai) » et le NIF 445566778.

Résultat attendu : à l'étape 1, la fenêtre annonce un fournisseur probablement déjà enregistré
(même nom ou même NIF) et montre la fiche d'ACV-55 ; « Reprendre cette fiche » la choisit dans le
bon, sans rien créer. À l'étape 3, le même NIF déclenche le même avertissement ; « Créer quand même
une nouvelle fiche » reste possible si le cas est réel.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-57. Circuit prévu selon le montant, avant la soumission

Objectif : vérifier que le formulaire montre les étapes de contrôle et d'approbation qui
s'appliqueront, selon le seuil de 10 000 000 GNF HT.

Compte : test.achats.

Données : ligne libre « Climatiseurs (essai) », d'abord 4 à 2 500 000 (10 000 000 exactement), puis
5 à 2 500 000.

1. « Nouveau bon de commande », fournisseur « Démo - Quincaillerie du port », ajoutez la ligne.
2. Lisez la carte « Circuit d'approbation prévu ».
3. Passez la quantité à 5 et relisez la carte.

Résultat attendu : la carte montre trois règles. Pour 10 000 000 HT, « 1. Contrôle : chef comptable ou
DAF » (« Finance et comptabilité », dès le premier franc) et « 2. Approbation : direction générale
(jusqu'à 10 M GNF HT, niveau à définir avec la direction générale) » (« Jusqu'à 10 000 000 GNF HT
inclus ») sont « Requise » ; « 2. Approbation : direction générale (plus de 10 M GNF HT) » est « Sans
objet ». Pour 12 500 000 HT, c'est l'inverse pour les deux règles de la direction : une seule
approbation de la direction générale s'applique. La carte rappelle que celui qui saisit le bon n'en
tranche aucune étape.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-58. Émission, contrôle, approbation : trois personnes

Objectif : vérifier la séparation des responsabilités : celui qui émet le bon ne tranche rien, le
contrôle est fait par le chef comptable ou le DAF (l'un ou l'autre, une seule fois), l'approbation par
la direction générale.

Compte : test.achats, test.comptable, test.daf, puis test.dg.

Données : le bon d'ACV-57 (12 500 000 HT) ; un second bon identique, « Climatiseurs, second site
(essai) ».

1. test.achats : soumettez les deux bons ; ouvrez « À valider ».
2. test.comptable : « À valider », ouvrez la demande du premier bon, « Approuver » avec le
   commentaire « Devis et budget vérifiés (essai) ».
3. test.comptable et test.daf : rouvrez « À valider ».
4. test.daf : ouvrez la demande du second bon, « Approuver » (contrôle).
5. test.dg : « À valider », approuvez les deux demandes.

Résultat attendu : test.achats ne voit aucune des deux demandes dans sa corbeille. Après l'étape 2, la
demande du premier bon n'est plus dans la corbeille de test.comptable ni dans celle de test.daf : le
contrôle est fait, l'approbation revient à la direction générale. Le second bon est contrôlé par
test.daf : le chef comptable ou le DAF peuvent chacun contrôler. Après test.dg, les deux bons sont
« Approuvés ». La fiche du bon montre la carte « Circuit d'approbation » : chaque étape, le profil
attendu, la décision, la personne, la date et l'heure, le commentaire.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-59. Responsables, dates et preuve sur le bon imprimé

Objectif : vérifier que le bon approuvé imprimé identifie ses responsables, leurs dates de décision
et la preuve de l'approbation.

Compte : test.dg, puis test.achats.

Données : bon « Groupe électrogène du chantier (démo) », contrôlé, en attente de la direction
générale.

1. test.dg : « À valider », ouvrez la demande du bon, vérifiez la proforma jointe, « Approuver ».
2. test.achats : ouvrez le bon, « Bon de commande en PDF ».

Résultat attendu : le document porte le bloc « CIRCUIT D'APPROBATION » : « Établi par … le … à … ;
soumis par … le … à … », puis une ligne par étape du circuit (contrôle, approbation) avec le nom, la
fonction ou le profil, « Approuvé », la date et l'heure de Conakry. Sous le tableau : « Demande
d'approbation n° … · empreinte SHA-256 du bon soumis : … » et la mention de la signature électronique
simple. Le bandeau « BROUILLON » a disparu.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-60. Historique du bon de commande

Objectif : vérifier que chaque action sur le bon est retracée : qui, quand, quoi.

Compte : test.achats.

Données : le bon d'ACV-30 (refusé puis modifié et soumis de nouveau), ou celui d'ACV-58.

1. Ouvrez le bon ; carte « Historique », « Afficher l'historique ».

Résultat attendu : la liste montre, dans l'ordre, la création, les modifications (avec l'ancienne et
la nouvelle valeur : quantité et montant des lignes, référence du devis…), chaque soumission avec son
numéro de demande, chaque décision avec son auteur et son commentaire (le motif du refus), puis, s'il
y a lieu, l'envoi au fournisseur, les réceptions, la pièce d'achat, les pièces jointes, l'annulation.
Rien ne s'y modifie ni ne s'y efface.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-61. Signature manuscrite de l'approbateur sur le bon

Objectif : vérifier qu'un approbateur dépose l'image de sa signature et qu'elle s'imprime en face de
son approbation.

Compte : test.daf, puis test.achats.

Données : une image PNG ou JPEG de signature sur fond blanc, de moins de 500 Ko (une signature
fictive) ; un fichier PDF quelconque.

1. test.daf : « À valider », onglet « Circuits », carte « Ma signature manuscrite », « Déposer ma
   signature » avec le PDF.
2. Recommencez avec l'image.
3. Un nouveau bon de 5 000 000, saisi et soumis par test.achats : test.daf le contrôle
   (« Approuver »), test.dg l'approuve.
4. test.achats : imprimez ce bon une fois approuvé.

Résultat attendu : le PDF est refusé (« La signature est une image PNG ou JPEG »). L'image est
acceptée et montrée en aperçu, avec la date du dépôt. Sur le bon imprimé, la signature figure dans
la colonne « Signature » de la ligne de test.daf (contrôle) seulement ; la ligne de la direction
générale reste sans image si test.dg n'en a pas déposé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-62. Bon de commande avec TVA

Objectif : vérifier les montants avec TVA à l'écran et sur le bon imprimé.

Compte : test.achats.

Données : ligne libre « Ciment (essai) », 10 à 100 000, TVA par défaut (18 %).

1. Créez le bon en brouillon, ouvrez-le, « Bon de commande en PDF ».

Résultat attendu : la fiche montre 1 000 000 HT et 1 180 000 TTC. Le PDF porte « Montant HT »
1 000 000, la TVA à 18 % 180 000, « TOTAL TTC » 1 180 000, et « Arrêté le présent bon de commande,
toutes taxes comprises, à la somme de : », suivi du montant en lettres (un million cent quatre-vingt
mille francs guinéens).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-63. Bon de commande sans TVA

Objectif : vérifier qu'un bon sans aucune TVA ne porte pas de « TOTAL TTC » et affiche sa mention
d'exonération.

Compte : test.achats.

Données : bon « Gardiennage exonéré (démo) », 3 000 000, sans TVA.

1. Ouvrez le bon, « Modifier » : la ligne est sur « Aucune » TVA ; lisez le champ « Mention
   d'exonération de TVA ».
2. « Enregistrer en brouillon », puis « Bon de commande en PDF ».

Résultat attendu : le PDF porte « Montant hors taxes » 3 000 000 et « TOTAL (sans TVA) » 3 000 000,
jamais « TOTAL TTC » ; « Arrêté le présent bon de commande, sans TVA, à la somme de : », suivi du
montant en lettres (trois millions de francs guinéens) ; « Mention : Prestation exonérée de TVA (mention de démonstration) » sous les
totaux.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-64. Bon de commande mixte, avec et sans TVA

Objectif : vérifier le calcul d'un bon dont une partie seulement est soumise à la TVA.

Compte : test.achats.

Données : deux lignes libres : « Matériel électrique (essai) » 1 à 1 000 000, TVA 18 % ;
« Frais de transport non taxés (essai) » 1 à 500 000, TVA « Aucune ».

1. Créez le bon en brouillon, « Bon de commande en PDF ».

Résultat attendu : 1 500 000 HT, 180 000 de TVA, 1 680 000 TTC. Le PDF porte « Montant HT »
1 500 000, « dont hors TVA (exonéré ou non soumis) » 500 000, la TVA à 18 % 180 000 et « TOTAL TTC »
1 680 000, montants arrondis au franc.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-65. Devis ou proforma du fournisseur : référence, date et pièce

Objectif : vérifier qu'un bon de commande porte la référence et la date du devis ou de la facture
proforma, et la pièce jointe.

Compte : test.achats, puis test.comptable.

Données : facture proforma « PRO-ESSAI-12 » datée d'hier, un fichier PDF ; ligne libre « Pneus
315/80 R22,5 (essai) », 4 à 2 800 000.

1. test.achats : « Nouveau bon de commande » ; dans la carte « Devis ou facture proforma du
   fournisseur », nature « Facture proforma », référence, date, « Joindre la proforma » avec le PDF.
2. Ajoutez la ligne, « Soumettre à l'approbation ».
3. test.comptable : « À valider », ouvrez la demande ; téléchargez la pièce.
4. test.achats : imprimez le bon.

Résultat attendu : la fiche du bon montre « Facture proforma du fournisseur : PRO-ESSAI-12 du … » et
la pièce dans la carte « Pièces jointes », catégorie « Facture proforma », avec le nom de celui qui
l'a jointe et la date. Le contrôleur voit la référence et télécharge la pièce depuis la corbeille. Le
PDF porte « Facture proforma : PRO-ESSAI-12 du … ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-66. Retrouver les pièces dans les archives

Objectif : vérifier qu'une pièce se retrouve par la référence du devis et ne s'efface plus une fois
le bon soumis.

Compte : test.achats.

Données : le bon d'ACV-65.

1. Liste des bons de commande : tapez « PRO-ESSAI-12 » dans la recherche.
2. « Pièces des bons » : tapez « PRO-ESSAI-12 », puis filtrez la catégorie « Facture proforma ».
3. Téléchargez la pièce ; cliquez sur le numéro du bon.
4. Sur la fiche du bon, cherchez le moyen de retirer la pièce.

Résultat attendu : la liste ne montre que le bon d'ACV-65. « Pièces des bons » trouve la proforma,
avec son bon, son fournisseur et la référence ; le numéro ouvre le bon. La pièce porte « Archivée » :
elle ne se retire plus (un brouillon jamais soumis permet de retirer une pièce mal jointe). Une
nouvelle pièce, un contrat par exemple, s'ajoute encore.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-67. Conditions de paiement, délai et lieu de livraison

Objectif : vérifier la saisie des conditions de la commande et leur impression.

Compte : test.achats.

Données : conditions de paiement au choix dans la liste ; précision « 30 % à la commande, solde à
la livraison (essai) » ; livraison prévue dans quinze jours ; délai de livraison 15 jours ; lieu
« Chantier de l'entrepôt de stockage (essai) » ; autres conditions « Garantie d'un an (essai) ».

1. « Nouveau bon de commande », fournisseur et ligne au choix ; observez le lieu de livraison proposé.
2. Remplissez la carte « Conditions de la commande », « Enregistrer en brouillon ».
3. Ouvrez le bon, « Bon de commande en PDF ».

Résultat attendu : vide, le lieu de livraison proposé est l'adresse de la société. La fiche du bon
montre les conditions de paiement avec la précision, le délai, le lieu et les autres conditions. Le
PDF les reprend sous « CONDITIONS DE LA COMMANDE » : « Conditions de paiement : … – 30 % à la
commande… », « Délai de livraison : Livraison prévue le …, 15 jours à compter de la réception du
bon », « Lieu de livraison : … », « Autres conditions : Garantie d'un an (essai) ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-68. Devis retenu de l'engagement repris d'office

Objectif : vérifier qu'un bon issu d'un engagement reprend la référence, la date et la pièce du
devis retenu.

Compte : test.chantiers, test.comptable, puis test.achats.

Données : engagement « Agrégats du chantier (essai) », fournisseur « Démo - Quincaillerie du port »,
4 000 000 ; devis « DEV-AGR-03 » daté d'avant-hier, 4 000 000, avec un PDF joint.

1. test.chantiers : créez l'engagement ; dans sa carte des devis, ajoutez le devis, joignez le PDF,
   retenez-le avec un motif ; soumettez l'engagement.
2. test.comptable : approuvez-le.
3. test.achats : « Nouveau bon de commande », choisissez l'engagement dans « Engagement de dépense
   approuvé », enregistrez le bon.

Résultat attendu : le bon porte « Devis du fournisseur : DEV-AGR-03 du … » ; sa carte « Pièces
jointes » contient le devis, catégorie « Devis du fournisseur », provenance « Devis retenu de
l'engagement ENG/… ». Le PDF imprime la référence et la date du devis.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## N. Émission des bons de commande réservée au service Achats

### ACV-69. Le service Achats émet le bon de commande

Objectif : vérifier que le Responsable Achats et Contrats crée, modifie, soumet et annule un bon de
commande chez EGUITRA GROUP SARLU.

Compte : test.achats.

Données : fournisseur « Démo - Quincaillerie du port » ; ligne libre « Tôles ondulées (essai) », 50 à
85 000, catégorie de dépense au choix ; puis un second bon identique, « Tôles, second lot (essai) ».

1. Achats et dépenses, onglet « Bons de commande » : « Nouveau bon de commande », remplissez,
   « Enregistrer en brouillon ».
2. Ouvrez le bon, « Modifier », passez la quantité à 60, « Soumettre à l'approbation ».
3. Créez et soumettez le second bon, ouvrez-le, « Annuler », confirmez.

Résultat attendu : les boutons « Nouveau bon de commande », « Modifier », « Soumettre à
l'approbation » et « Annuler » sont proposés. Le premier bon est « En approbation », chez « Finance et
comptabilité » ; le second est « Annulé », sa demande d'approbation abandonnée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-70. La finance et la direction n'émettent pas, mais contrôlent et approuvent

Objectif : vérifier la séparation entre émission, contrôle et approbation.

Compte : test.daf, test.dg, puis test.comptable.

Données : le premier bon d'ACV-69, en approbation ; un brouillon saisi par test.achats.

1. test.daf : onglet « Bons de commande » ; lisez le haut de l'écran ; ouvrez le brouillon.
2. test.dg : même chose.
3. test.comptable : « À valider », approuvez le bon d'ACV-69 (contrôle).
4. test.dg : « À valider », approuvez-le.

Résultat attendu : aux étapes 1 et 2, pas de bouton « Nouveau bon de commande » ; l'indication
« Émission réservée au service Achats (Responsable Achats et Contrats) » s'affiche ; le brouillon se
lit, son PDF s'imprime, mais « Modifier », « Soumettre à l'approbation » et « Annuler » ne sont pas
proposés (« ce brouillon se modifie, se soumet ou s'annule par le service Achats »). Le contrôle de
test.comptable et l'approbation de test.dg se font normalement : le bon est « Approuvé ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-71. Les métiers n'émettent pas depuis leur engagement

Objectif : vérifier qu'un conducteur de travaux ne crée pas de bon de commande, même depuis son
engagement approuvé, et que la suite du bon reste ouverte (réception).

Compte : test.chantiers, puis test.achats.

Données : un engagement approuvé de test.chantiers (celui d'ACV-26 par exemple).

1. test.chantiers : ouvrez l'engagement, carte « Bons de commande » ; puis l'onglet « Bons de
   commande ».
2. test.achats : émettez le bon depuis l'engagement (« Nouveau bon de commande », « Engagement de
   dépense approuvé »), soumettez-le.
3. test.chantiers : une fois le bon approuvé, ouvrez-le, « Enregistrer une réception ».

Résultat attendu : à l'étape 1, aucun bouton de création ; la carte indique que le service Achats émet
le bon depuis l'engagement. À l'étape 3, test.chantiers voit le bon de son engagement et enregistre la
réception (service fait) : seule l'émission est réservée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ACV-72. Réglage tenu par l'administration

Objectif : vérifier que la réserve de l'émission se règle par société, par l'administration seule.

Compte : test.daf, puis test.admin.

Données : aucune.

1. test.daf : Administration > Achats et ventes, carte « Bons de commande fournisseur ».
2. test.admin : même écran, société EGUITRA GROUP SARLU, puis MB AxisPro Consulting.

Résultat attendu : chez test.daf, la case « Émission des bons de commande réservée au service Achats »
est cochée et grisée (« Réglage tenu par l'administration : consultation seulement ») ; ses autres
réglages s'enregistrent comme avant. Chez test.admin, la case se modifie : cochée pour EGUITRA GROUP
SARLU, décochée pour MB AxisPro Consulting. Ne la décochez pas pour EGUITRA GROUP SARLU (ou recochez-la
aussitôt) : les autres scénarios la supposent active.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## Synthèse

| Partie {52} | Scénarios {12} | Réussis {12} | Échoués {12} | Non joués {12} |
|---|---|---|---|---|
| A. Catalogue | 4 | | | |
| B. Offres commerciales | 9 | | | |
| C. Commandes et facturation | 7 | | | |
| D. Offre de travaux et chantier | 5 | | | |
| E. Bons de commande fournisseur | 7 | | | |
| F. Réceptions | 3 | | | |
| G. Rapprochement des pièces d'achat | 5 | | | |
| H. Devis fournisseurs | 3 | | | |
| I. Tableaux de bord et exports | 3 | | | |
| J. Réglages | 2 | | | |
| K. Refus attendus | 4 | | | |
| L. Séparation des deux sociétés | 2 | | | |
| M. Bons de commande : retour du client du 2 novembre | 14 | | | |
| N. Émission des bons de commande réservée au service Achats | 4 | | | |
| Total | 72 | | | |

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
