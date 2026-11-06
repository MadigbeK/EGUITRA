# Cahier de test : Finance et comptabilité

NIMOVA · Finance, pour EGUITRA GROUP SARLU et MB AxisPro Consulting.

Ventes et factures imprimées au modèle de la société, achats, trésorerie, rapprochement, tiers,
relances, immobilisations, dette, budget, fiscalité, états au modèle SYSCOHADA et comparatifs de
l'exercice précédent, clôtures du mois et de l'exercice, approbations et engagements de dépense, avec
le profil Achats.

| Rubrique {28} | À remplir {72} |
|---|---|
| Module | Finance et comptabilité (NIMOVA · Finance) |
| Version de la plateforme | ______ (communiquée par E-VOLUTION XP) |
| Date du test | ______ |
| Nom du testeur | ______ |
| Fonction | ______ |
| Profil utilisé | ______ |
| Compte de test | ______ |
| Société | ☐ EGUITRA GROUP SARLU    ☐ MB AxisPro Consulting |

Document préparé par E-VOLUTION XP le 27 octobre 2026, d'après les écrans de la plateforme à cette
date.

<!-- saut de page -->

## Mode d'emploi

Ce cahier se joue sur la recette : une copie complète de NIMOVA, avec des données fictives repérées
« Démo ». Rien de ce que vous y faites ne touche les vrais comptes : vous pouvez tout essayer, y
compris les erreurs.

1. Se connecter. Ouvrez l'adresse de la recette communiquée par E-VOLUTION XP, dans Chrome ou Edge,
   puis une tuile du rayon Finance de l'accueil (par exemple « Tableau de bord »). Identifiant : le compte de test indiqué dans le scénario. Mot
   de passe : le mot de passe commun de la recette, communiqué par E-VOLUTION XP.
2. Société. Sauf mention contraire, travaillez dans EGUITRA GROUP SARLU : vérifiez le nom affiché en
   haut à droite avant de commencer.
3. Jouer un scénario. Suivez les étapes dans l'ordre, avec les données indiquées. Un scénario à deux
   comptes se joue dans deux navigateurs (Chrome et Edge) ou sur deux postes. Notez les numéros des
   pièces créées : d'autres scénarios s'en servent.
4. Noter le résultat. Cochez « Réussi » si l'écran correspond au résultat attendu, sinon « Échoué ».
   Dans « Remarques », notez ce qui diffère : l'écran, le message affiché, l'heure.
5. Signaler une anomalie. Menu du compte (rond à vos initiales, en haut à droite) > « Mes demandes »
   > « Nouvelle demande », type « Remarque de recette », application NIMOVA · Finance, la gravité ;
   titre commençant par le numéro du scénario (par exemple « FIN-06 : PDF de la facture vide ») ;
   description ; « Déposer la demande ». Reportez le numéro reçu (DEM-…) dans les remarques.

## Comptes de test

| Compte {18} | Profil {18} | Sociétés {26} | Rôle dans ce cahier {38} |
|---|---|---|---|
| test.dg | Direction | les deux | tableau de bord, approbations de la direction, réouverture, lecture des comparatifs |
| test.daf | Finance | les deux | approbations de la finance, trésorerie, états, clôtures |
| test.comptable | Finance | les deux | saisie des ventes, des achats et des opérations, factures imprimées |
| test.achats | Achats | les deux | engagements, pièces d'achat, fournisseurs |
| test.admin | Administration | les deux | utilisateurs, seuils, journal d'audit, sociétés, factures et journaux, import des comparatifs |
| test.chantiers | BTP | EGUITRA GROUP SARLU | refus |

Données fictives utiles : clients « Démo - Distributeur pétrolier A » et « Démo - Société minière
B » ; fournisseurs « Démo - Fournisseur de carburant » et « Démo - Garage poids lourds » ; pièces
d'achat en attente d'approbation DEMO2-APP-1 (15 000 000 GNF HT) et DEMO2-APP-2 (72 000 000 GNF
HT) ; emprunt DEMO2-EMP-01 ; immobilisation « Ensemble citerne DEMO-04 (démo) ». Côté MB AxisPro
Consulting : clients « Démo - Briqueterie de Kindia SARL » et « Démo - Vergers de Mamou SA ».

## A. Direction générale

### FIN-01. Lire le tableau de bord du dirigeant

Objectif : vérifier que la direction lit la situation à une date choisie, pour une société ou pour le
groupe.

Compte : test.dg.

Données : date d'arrêté au dernier jour du mois précédent.

1. Ouvrez Finance > Pilotage > Tableau de bord. La page « Tableau de bord du dirigeant » s'affiche.
2. Dans « Arrêté au », choisissez le dernier jour du mois précédent.
3. Sous « Périmètre », choisissez « Groupe consolidé », puis revenez à « Société ».
4. Faites défiler jusqu'à « Ce qui demande une décision » et « Les questions du dirigeant ».
5. Cliquez sur « Imprimer ».

Résultat attendu : les chiffres se recalculent à la date choisie. « Groupe consolidé » réunit les
deux sociétés ; « Société » revient à la seule société de travail. Chaque question du dirigeant a
sa réponse et son verdict. L'impression donne un tableau de bord lisible, sans les menus.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-02. Imprimer le rapport mensuel de gestion

Objectif : vérifier que le rapport du mois se lit et s'imprime pour être diffusé.

Compte : test.dg.

Données : le mois précédent.

1. Ouvrez Pilotage > Rapport mensuel.
2. Dans « Mois », choisissez le mois précédent.
3. Lisez « Lecture de la période », « Trésorerie et financement », « Clients et fournisseurs » et
   « Activité transport du mois ».
4. Cliquez sur « Imprimer ».

Résultat attendu : le rapport porte le nom de la société et la période arrêtée. Le résultat du mois
est comparé au mois précédent et à l'an dernier. Un seuil non renseigné s'affiche « seuil non fixé »
au lieu d'un verdict. L'impression est complète.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-03. Approuver une dépense de plus de 50 millions

Objectif : vérifier qu'une pièce d'achat au-delà de 50 000 000 GNF attend l'accord de la direction
après celui de la finance.

Compte : test.dg, une fois l'étape de la finance approuvée par test.daf (comme en FIN-11).

Données : la pièce DEMO2-APP-2 (72 000 000 GNF HT, « Démo - Fournisseur de carburant »), ou une
pièce de plus de 50 000 000 GNF saisie pour ce test.

1. Ouvrez Pilotage > À valider, onglet « À approuver ».
2. Ouvrez la demande. Vérifiez « Montant », « Tiers », « Demandée par » et le circuit : l'étape de
   la finance porte « Approuvée par » avec son auteur.
3. Cliquez sur « Approuver ».
4. Dans la fenêtre « Approuver la demande ? », confirmez.

Résultat attendu : la fenêtre rappelle que c'est la dernière étape du circuit et que la pièce sera
comptabilisée. Le message « Demande approuvée. » s'affiche ; la pièce quitte la corbeille et passe à
l'état comptabilisé dans Comptabilité > Achats et dépenses.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-04. Refuser une demande avec un motif

Objectif : vérifier qu'un refus exige un motif et renvoie la pièce au demandeur sans la comptabiliser.

Compte : test.dg.

Données : une pièce de plus de 50 000 000 GNF en attente de la direction ; motif « Devis
concurrent à fournir. ».

1. Pilotage > À valider > « À approuver », ouvrez la demande.
2. Laissez « Commentaire » vide et regardez le bouton « Refuser ».
3. Écrivez le motif dans « Commentaire », puis « Refuser ».
4. Dans la fenêtre « Refuser la demande ? », confirmez.

Résultat attendu : tant que le commentaire est vide, « Refuser » reste grisé (« Obligatoire en cas
de refus. »). Avec le motif, « Demande refusée. » s'affiche. La pièce n'est pas comptabilisée ; le
demandeur lit le motif dans ses demandes.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-05. Rouvrir un mois clôturé

Objectif : vérifier que la direction rouvre un mois clôturé avec un motif inscrit au registre.

Compte : test.dg, après le scénario FIN-29.

Données : le mois clôturé en FIN-29 ; motif « Facture de septembre reçue en retard, à saisir. ».

1. Ouvrez Comptabilité > Clôtures et contrôles, puis le mois clôturé.
2. Saisissez un motif de moins de dix caractères dans « Motif de réouverture » : « Rouvrir le mois »
   reste grisé.
3. Saisissez le motif complet, puis « Rouvrir le mois ».
4. Confirmez dans la fenêtre qui s'ouvre.

Résultat attendu : la fenêtre explique que les écritures du mois redeviennent modifiables et que la
réouverture et son motif sont inscrits au registre des clôtures. Le mois n'est plus marqué
« Clôturé le … » et le registre garde la réouverture.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## B. Finance et comptabilité

### FIN-06. Créer, valider et imprimer une facture de vente

Objectif : vérifier qu'une facture se saisit, se valide et s'imprime avec la numérotation de la
société.

Compte : test.comptable.

Données : client « Démo - Distributeur pétrolier A » ; ligne « Transport de gasoil, essai FIN-06 »,
quantité 1, prix unitaire HT 10 000 000, TVA de la société.

1. Ouvrez Comptabilité > Ventes, puis « Nouvelle facture ». La fenêtre « Nouvelle facture de vente »
   s'ouvre.
2. Choisissez le « Client ». Laissez « Date de la pièce » à la date du jour et « Échéance » vide.
3. Remplissez la ligne : « Libellé », « Qté », « Prix unitaire HT », « TVA ».
4. Cliquez sur « Enregistrer et valider ».
5. Ouvrez la facture dans la liste, puis cliquez sur « PDF ».

Résultat attendu : la facture reçoit un numéro d'EGUITRA GROUP SARLU. Total HT 10 000 000 GNF,
TVA et total TTC calculés. L'échéance suit les conditions du client. Le PDF suit le modèle de la
société (détail en FIN-52 à FIN-55) : logo et identité de la société, « FACTURE » et son numéro, bloc
« CLIENT », la ligne, les totaux et le montant en toutes lettres. Sans unité ni rubrique, le tableau
n'a ni colonne « Unité » ni « Sous-total ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-07. Établir un avoir sur une facture

Objectif : vérifier qu'une facture validée s'annule par un avoir, et non par une modification.

Compte : test.comptable.

Données : la facture de FIN-06.

1. Comptabilité > Ventes, ouvrez la facture de FIN-06.
2. Cliquez sur « Établir un avoir ».
3. Lisez la fenêtre « Établir un avoir sur … ? », puis « Établir l'avoir ».
4. Cliquez sur « Ouvrir l'avoir », vérifiez-le, puis « Valider ».

Résultat attendu : la fenêtre précise que l'avoir, créé en brouillon, reprend toutes les lignes et ne
compte qu'une fois validé. Le message « Avoir créé en brouillon : vérifiez-le, puis validez-le. »
s'affiche. Une fois validé, le reste dû de la facture diminue du montant de l'avoir.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-08. Encaisser une partie d'une facture

Objectif : vérifier l'encaissement partiel d'une facture et le reste dû.

Compte : test.comptable.

Données : une facture validée de 10 000 000 GNF HT (créée comme en FIN-06) ; notez son total TTC ;
encaissement de 5 000 000 GNF par virement.

1. Comptabilité > Ventes, ouvrez la facture, puis « Encaisser ».
2. Choisissez le « Compte de trésorerie » et le « Mode de paiement ».
3. Saisissez 5 000 000 dans « Montant » et la date du jour dans « Date ».
4. Cliquez sur « Enregistrer le règlement ».
5. Revenez à la liste, vue « À régler ».

Résultat attendu : sans montant saisi, le bouton propose « Encaisser tout le reste dû ». Après
l'enregistrement, le « Reste dû » de la facture vaut son total TTC moins 5 000 000 GNF ; elle figure
toujours dans la vue « À régler ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-09. Déclarer puis lever un litige

Objectif : vérifier qu'une facture contestée sort des relances le temps du litige.

Compte : test.comptable.

Données : la facture de FIN-08 ; motif « Volume livré contesté par le client. ».

1. Ouvrez la facture, puis « Déclarer un litige ».
2. Saisissez le motif dans « Motif du litige », puis « Déclarer ».
3. Revenez à la liste et choisissez la vue « Litiges ».
4. Rouvrez la facture, puis « Lever le litige ».

Résultat attendu : « Déclarer » reste grisé tant que le motif est vide. La facture porte la mention
« Litige » et figure dans la vue « Litiges ». Après « Lever le litige », elle en sort.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-10. Préparer les catégories de dépense

Objectif : vérifier que la finance met en place les catégories qui fixent le compte et la TVA des
achats.

Compte : test.daf.

Données : aucune.

1. Ouvrez Administration > Imputations automatiques, onglet « Catégories de dépense ».
2. Si la liste est vide, cliquez sur « Proposer les catégories usuelles ».
3. Relisez la liste : « Carburant et lubrifiants », « Entretien et réparation des véhicules »,
   « Salaires »…

Résultat attendu : le message indique le nombre de catégories usuelles ajoutées, « à revoir avec
l'expert-comptable », ou « Les catégories usuelles sont déjà présentes. ». Chaque catégorie montre
son compte et sa TVA.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-11. Saisir une pièce d'achat et la faire approuver

Objectif : vérifier qu'une pièce saisie par un comptable passe au circuit et qu'une autre personne de
la finance l'approuve.

Compte : test.comptable (saisie), puis test.daf (approbation).

Données : fournisseur « Démo - Garage poids lourds » ; référence du fournisseur « FG-2026-118 » ;
ligne « Révision du tracteur DEMO-02 », catégorie « Entretien et réparation des véhicules »,
quantité 1, prix unitaire HT 7 800 000 ; une facture numérisée en PDF.

1. test.comptable : Comptabilité > Achats et dépenses > « Nouvelle facture fournisseur ».
2. Choisissez le « Fournisseur », saisissez la « Référence du fournisseur », puis la ligne.
3. Cliquez sur « Enregistrer en brouillon ». Ouvrez la pièce, « Joindre un justificatif », choisissez
   le PDF.
4. Cliquez sur « Soumettre / valider ».
5. test.daf : Pilotage > À valider > « À approuver ». Ouvrez la demande, regardez la pièce jointe,
   puis « Approuver » et confirmez.

Résultat attendu : après l'étape 4, la pièce reste en brouillon avec la mention « En validation ».
test.daf la trouve dans sa corbeille, avec le montant, le tiers et le demandeur. Après approbation :
« Demande approuvée. », et la pièce est comptabilisée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-12. Engager une dépense avant la commande

Objectif : vérifier le circuit d'un engagement et la facture qui le consomme sans repasser au
circuit.

Compte : test.comptable (saisie), test.daf puis test.dg (approbations).

Données : fournisseur « Démo - Fournisseur de carburant » ; objet « Gasoil de la flotte, novembre
(essai) » ; montant HT 60 000 000 ; catégorie « Carburant et lubrifiants » ; un devis en PDF.

1. test.comptable : Pilotage > Engagements de dépense > « Nouvel engagement ».
2. Remplissez « Fournisseur », « Objet de la dépense », « Montant hors taxes (GNF) », « Catégorie de
   dépense », « Livraison ou exécution prévue » et « Justification ». « Enregistrer en brouillon ».
3. Ouvrez l'engagement, « Joindre le devis », puis « Soumettre à l'approbation ».
4. test.daf, puis test.dg : Pilotage > À valider, approuvez l'engagement.
5. test.comptable : saisissez la facture du fournisseur de 55 000 000 GNF HT ; dans « Engagement de
   dépense », choisissez l'engagement ; « Envoyer pour approbation ».
6. Rouvrez l'engagement.

Résultat attendu : « Engagement envoyé pour approbation. » à l'étape 3. Au-delà de 50 000 000 GNF,
la direction approuve après la finance. La facture rattachée est comptabilisée sans nouveau circuit.
Dans l'engagement, « Factures fournisseurs rattachées » montre la facture et « Reste à engager » vaut
5 000 000 GNF.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-13. Saisir une sortie de caisse avec son justificatif

Objectif : vérifier la saisie d'une opération de trésorerie et son justificatif.

Compte : test.comptable.

Données : compte de caisse de la société ; sortie de 350 000 GNF ; libellé « Frais de mission
Kindia (essai) » ; référence « BC-0412 » ; un reçu en PDF.

1. Ouvrez Comptabilité > Trésorerie et choisissez le compte de caisse.
2. Cliquez sur « Nouvelle opération ». Laissez l'onglet « Sortie ».
3. Choisissez un « Type d'opération » de frais (à défaut « Saisie libre »), saisissez la « Date »,
   le « Montant », le « Mode de paiement », la « Référence » et le « Libellé ».
4. Cliquez sur « Enregistrer », puis sur « Joindre le justificatif » et choisissez le reçu.

Résultat attendu : l'opération apparaît dans la liste du compte avec son justificatif. Le solde de
la caisse baisse de 350 000 GNF. Un montant saisi avec un signe moins est refusé : « Saisissez le
montant sans signe moins : le sens vient de « Sortie » ou « Entrée ». ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-14. Importer un relevé bancaire

Objectif : vérifier l'import d'un relevé, le contrôle de ses soldes et l'élimination des doublons.

Compte : test.daf.

Données : un relevé d'essai au format CSV ou XLSX (colonnes date, libellé, montant), fourni par
E-VOLUTION XP ou préparé dans Excel, avec son solde initial et son solde final.

1. Trésorerie, choisissez un compte bancaire, puis « Importer un relevé ».
2. Choisissez le fichier. Saisissez le « Solde initial du relevé » et le « Solde final du relevé »
   (ou laissez-les vides s'ils figurent dans le fichier), puis « Importer ».
3. Importez une seconde fois le même fichier.
4. Importez un fichier dont le solde final saisi est faux de 1 000 GNF.

Résultat attendu : étape 2, le nombre d'opérations importées et « Relevé équilibré. ». Étape 3,
les lignes déjà présentes sont comptées en doublons ignorés, rien n'est importé deux fois. Étape 4,
l'écart est signalé et l'import attend « Importer malgré l'écart ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-15. Rapprocher une ligne du relevé

Objectif : vérifier qu'une ligne du relevé se rapproche de sa facture et solde la créance.

Compte : test.daf.

Données : une ligne de relevé égale au reste dû d'une facture client (par exemple celle de FIN-08).

1. Trésorerie, compte bancaire du relevé, vue « À rapprocher ».
2. Sur la ligne, cliquez sur « Rapprocher ». La fenêtre « Rapprocher, … » propose les pièces en
   attente.
3. Choisissez la facture proposée, puis « Rapprocher ».
4. Rouvrez la ligne : « Annuler le rapprochement », lisez la question, puis annulez la fenêtre.

Résultat attendu : la ligne passe à « Rapprochée » et la facture est soldée. La fenêtre
d'annulation explique que l'opération redevient « à rapprocher » ; fermée par « Annuler », rien ne
change.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-16. Faire un virement interne

Objectif : vérifier qu'un virement entre deux comptes passe par le compte de passage 585, soldé.

Compte : test.comptable.

Données : de la banque vers la caisse, 5 000 000 GNF, libellé « Alimentation de la caisse
(essai) ».

1. Trésorerie > « Virement interne ».
2. Choisissez « Depuis » et « Vers », saisissez le « Montant (GNF) » et le libellé.
3. Cliquez sur « Enregistrer le virement ».
4. Ouvrez Comptabilité > Balance et états > « Balance, grand livre et rapports » et regardez le
   compte 585.

Résultat attendu : les deux comptes bougent de 5 000 000 GNF en sens contraire ; le compte 585 est
soldé. Un virement de plus de 100 000 000 GNF resterait en attente d'approbation, avec un message qui
demande de ne pas le saisir une seconde fois.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-17. Établir l'état de rapprochement

Objectif : vérifier l'état de rapprochement d'un compte bancaire à une date.

Compte : test.daf.

Données : le compte bancaire du relevé importé en FIN-14.

1. Trésorerie, choisissez le compte bancaire, puis « État de rapprochement ».
2. Vérifiez le « Compte » et choisissez la date « Arrêté au ».
3. Lisez le solde du relevé, les opérations absentes du relevé, le solde comptable et l'écart.
4. Exportez ou imprimez l'état.

Résultat attendu : la page « État de rapprochement bancaire » affiche « Rapprochement équilibré »
ou « Écart à expliquer », avec le détail des opérations en cause et la liste des « Relevés
importés ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-18. Relancer un client en retard

Objectif : vérifier le calcul des relances et la lettre imprimable.

Compte : test.comptable.

Données : une facture échue depuis plus de 30 jours (sinon, une facture saisie avec une date
ancienne).

1. Ouvrez Comptabilité > Relances clients, puis « Calculer maintenant ».
2. Dans l'onglet « À envoyer », ouvrez une relance.
3. Cliquez sur « Lettre en PDF ».
4. Cliquez sur « Marquer remise » et confirmez.
5. Ouvrez l'onglet « Envoyées ».

Résultat attendu : chaque relance porte son niveau (rappel, relance ferme ou mise en demeure), le
retard et le montant échu. La lettre reprend les factures, le total échu et la formule de politesse.
Après confirmation, la relance passe dans « Envoyées » et ne peut plus être annulée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-19. Lire la balance âgée des tiers

Objectif : vérifier l'ancienneté des créances et des dettes par tiers.

Compte : test.daf.

Données : aucune.

1. Ouvrez Comptabilité > Tiers.
2. Sous « Vue », choisissez « Balance âgée ».
3. Passez de « Clients » à « Fournisseurs ».
4. Revenez à « Fiches » et ouvrez la fiche d'un client.

Résultat attendu : la balance âgée donne l'ancienneté par tranche et l'encours de chaque tiers avec
son retard. La fiche montre « Nous doit », « Nous lui devons » et l'historique des pièces.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-20. Créer et mettre en service une immobilisation

Objectif : vérifier qu'une immobilisation reçoit son plan d'amortissement.

Compte : test.daf.

Données : catégorie « Matériel de transport », 5 ans (à créer si absente) ; immobilisation
« Tracteur d'essai FIN-20 », valeur d'acquisition HT 600 000 000, mise en service au premier jour du
mois.

1. Ouvrez Comptabilité > Immobilisations. Si la catégorie manque : « Catégories », remplissez
   « Nom », « Durée (années) » et les comptes, puis « Ajouter la catégorie ».
2. Cliquez sur « Nouvelle immobilisation ».
3. Remplissez « Désignation », « Catégorie », « Valeur d'acquisition HT » et « Mise en service ».
4. Cliquez sur « Enregistrer et mettre en service ».
5. Ouvrez l'immobilisation.

Résultat attendu : l'immobilisation figure au registre avec sa valeur brute. Son plan
d'amortissement donne une dotation par mois sur 60 mois ; les dotations échues sont comptabilisées
chaque nuit.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-21. Céder une immobilisation

Objectif : vérifier la sortie de l'actif, avec confirmation avant les écritures.

Compte : test.daf.

Données : l'immobilisation de FIN-20 ; prix de cession HT 550 000 000 ; acquéreur « Démo - Société
minière B ».

1. Ouvrez l'immobilisation, puis « Sortir de l'actif ».
2. Remplissez « Date de sortie », « Prix de cession HT », « Acquéreur » et « Motif ».
3. Cliquez sur « Confirmer la sortie ». Lisez la fenêtre, puis confirmez.

Résultat attendu : la fenêtre « Céder … pour … ? » annonce la dotation jusqu'à la date, la sortie de
l'actif et la cession. Après confirmation, l'immobilisation n'est plus en service au registre. Avec
un prix de 0, la sortie est une mise au rebut (« Mettre au rebut »).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-22. Enregistrer un emprunt et son échéancier

Objectif : vérifier la création d'un financement et sa mise en service.

Compte : test.daf.

Données : référence « Emprunt d'essai FIN-22 » ; prêteur « Démo - Banque de financement » ;
montant 300 000 000 ; taux annuel 12 ; durée 24 mois ; différé 0.

1. Ouvrez Comptabilité > Dette et financement, puis « Nouveau financement ».
2. Remplissez la référence, le prêteur, l'objet, le montant, le « Taux annuel (%) », la « Durée
   (mois) » et le « Différé (mois) », ainsi que le compte de dette, le compte d'intérêts et le
   journal de règlement s'ils sont demandés.
3. Cliquez sur « Calculer l'échéancier ».
4. Ouvrez le financement, puis « Mettre en service » et confirmez.

Résultat attendu : l'échéancier compte 24 échéances. La fenêtre de mise en service précise que
l'échéancier ne se modifiera plus. Le message « Financement mis en service. » s'affiche ; le
financement figure « En cours » et compte dans l'encours et le service de la dette.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-23. Saisir un budget et le comparer au réalisé

Objectif : vérifier la saisie d'une ligne budgétaire et la comparaison au réalisé.

Compte : test.daf.

Données : ligne « Carburant (essai) », nature charges, comptes 605 ; montant annuel 1 200 000 000.

1. Ouvrez Pilotage > Activités et budget, onglet « Budget et écarts ». S'il n'y a pas de budget pour
   l'exercice, cliquez sur « Nouveau budget ».
2. Cliquez sur « Nouvelle ligne ». Remplissez « Nature », « Ligne budgétaire » et « Comptes ».
3. Saisissez 1 200 000 000 dans « Répartir un montant annuel (GNF) », puis « Répartir sur douze
   mois ». Enregistrez.
4. Lisez la ligne dans le tableau des écarts, puis cliquez sur « Exporter ».

Résultat attendu : chaque mois reçoit 100 000 000 GNF. Le tableau montre le budget cumulé, le
réalisé, l'engagé, le disponible, l'écart et un statut. Le classeur exporté reprend ces colonnes.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-24. Préparer la TVA du mois

Objectif : vérifier la TVA collectée et déductible du mois, tirée des écritures validées.

Compte : test.daf.

Données : le mois en cours (factures de FIN-06 et FIN-11).

1. Ouvrez Comptabilité > Fiscalité, onglet « TVA ».
2. Choisissez le « Mois ».
3. Lisez « TVA collectée », « TVA déductible », « TVA à payer » ou « Crédit à reporter », et le
   « Détail par taxe ».
4. Ouvrez l'onglet « Retenues à la source », puis « Historique ».

Résultat attendu : la TVA collectée comprend celle de la facture de FIN-06 et la TVA déductible
celle de la pièce de FIN-11. La TVA à payer égale la TVA collectée moins la déductible et le crédit
reporté.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-25. Éditer le bilan et le compte de résultat

Objectif : vérifier les états SYSCOHADA et leurs exports.

Compte : test.daf.

Données : arrêté au dernier jour du mois précédent.

1. Ouvrez Comptabilité > Balance et états. Onglet « Bilan », date « Arrêté au ».
2. Comparez « Total général actif » (BZ, tableau « Bilan actif ») et « Total général passif » (DZ,
   tableau « Bilan passif »).
3. Ouvrez « Compte de résultat », puis « Tableau des flux ».
4. Cliquez sur « XLSX » d'un état, puis sur « Tous les états (XLSX) ».

Résultat attendu : le message « Bilan équilibré au » suivi de la date s'affiche ; le total général de
l'actif égale celui du passif. Le compte de résultat donne le mois, l'exercice, le pourcentage du
chiffre d'affaires et la même période de l'an dernier (colonne « N-1 »). Les classeurs s'ouvrent dans
Excel, avec des nombres et non du texte. Le détail des états au modèle SYSCOHADA est en partie H.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-26. Lire le consolidé du groupe

Objectif : vérifier le consolidé des deux sociétés et l'élimination des opérations entre elles.

Compte : test.daf (ouvert aux deux sociétés).

Données : une facture de MB AxisPro Consulting à EGUITRA GROUP SARLU, si E-VOLUTION XP l'a préparée
sur la recette.

1. Balance et états, onglet « Consolidé du groupe ».
2. Lisez le compte de résultat et le bilan de chaque société, la colonne « Éliminations » et la
   colonne « Groupe ».

Résultat attendu : pour chaque ligne, la colonne « Groupe » égale la somme des deux sociétés moins
les éliminations. Les ventes et achats réciproques, la créance et la dette entre les sociétés
s'éliminent.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-27. Passer une opération diverse

Objectif : vérifier qu'une opération diverse se saisit équilibrée.

Compte : test.daf.

Données : modèle « Charge constatée d'avance » ; 2 400 000 GNF entre un compte de charge et le compte
476.

1. Ouvrez Comptabilité > Journaux et OD, puis « Nouvelle OD ».
2. Choisissez le « Modèle », le « Journal » et la « Date » ; complétez les comptes et les montants.
3. Laissez volontairement un écart de 100 GNF entre « Débit » et « Crédit ».
4. Corrigez l'écart, puis « Valider ».

Résultat attendu : à l'étape 3, le message « Écart débit - crédit : 100 GNF. Une pièce doit être
équilibrée. » s'affiche et « Valider » reste grisé. Corrigée, l'opération est validée et figure dans
la liste des opérations diverses.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-28. Lire les alertes de gestion

Objectif : vérifier que chaque règle d'alerte compare une valeur à un seuil et propose une action.

Compte : test.daf.

Données : aucune.

1. Ouvrez Pilotage > Alertes. La page « Alertes de gestion » s'affiche.
2. Sous « Règles affichées », passez de « Alertes actives » à « Toutes les règles ».
3. Lisez « Seuils en vigueur ».

Résultat attendu : chaque alerte porte sa gravité, la valeur constatée, le seuil et l'action
recommandée. « Toutes les règles » ajoute les règles conformes. Un seuil non renseigné apparaît
« À renseigner ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-29. Clôturer un mois

Objectif : vérifier les contrôles avant clôture, la clôture et son procès-verbal.

Compte : test.daf. À jouer en accord avec E-VOLUTION XP : un mois clôturé n'accepte plus de saisie
pour aucun testeur, jusqu'à sa réouverture (FIN-05).

Données : le mois précédent.

1. Ouvrez Comptabilité > Clôtures et contrôles, choisissez l'« Exercice », puis le mois précédent.
2. Cliquez sur « Lancer les contrôles ». Lisez les anomalies et les « Écritures que passera la
   clôture ».
3. Si aucune anomalie n'est bloquante, cliquez sur « Clôturer le mois ». Lisez la fenêtre, puis
   confirmez.
4. Cliquez sur « PV de clôture ».

Résultat attendu : une anomalie bloquante garde « Clôturer le mois » grisé. La fenêtre annonce les
dotations, la liquidation de la TVA, les factures à établir, puis le verrouillage et le scellement.
Après clôture, le mois porte « Clôturé le … », son « Sceau de la période (SHA-256) » et le PV le
reprend.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-30. Vérifier les contrôles d'intégrité

Objectif : vérifier que le sceau d'un mois clôturé est recalculé à l'identique.

Compte : test.daf, après FIN-29.

Données : le mois clôturé.

1. Clôtures et contrôles, bloc « Contrôles du mois écoulé ».
2. Lisez la ligne du mois clôturé : « Sceau recalculé » et « Sceau du procès-verbal ».

Résultat attendu : le sceau recalculé est identique à celui du PV ; aucune ligne « À examiner ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-31. Suivre la clôture de l'exercice

Objectif : vérifier que le bloc de clôture de l'exercice dit où en est l'exercice et ce qui manque
au verrouillage définitif.

Compte : test.daf, puis test.dg.

Données : l'exercice en cours.

1. Clôtures et contrôles, choisissez l'exercice en cours. Lisez le bloc « Clôture de l'exercice … ».
2. Lisez « Les douze mois de l'exercice », « Résultat de l'exercice », « Restant à affecter » et
   « Verrouillage définitif ».
3. test.dg : ouvrez le même bloc.

Résultat attendu : le bloc liste les conditions du verrouillage : « Exercice terminé », « Douze mois
clôturés », « Aucune pièce en brouillon jusqu'à la fin de l'exercice ». Tant qu'elles ne sont pas
toutes remplies, « Verrouiller définitivement » reste indisponible, y compris pour la direction.
Chez test.daf, le bloc indique « Le verrouillage définitif est réservé à la direction et à
l'administration. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## C. Achats

### FIN-32. Ouvrir l'espace du profil Achats

Objectif : vérifier que le profil Achats n'ouvre que ses écrans.

Compte : test.achats.

Données : aucune.

1. Connectez-vous et ouvrez Finance.
2. Regardez l'écran d'accueil et les menus « Pilotage » et « Comptabilité ».

Résultat attendu : Finance s'ouvre sur « Achats et dépenses ». Les menus ne proposent que « Mes
demandes », « Engagements de dépense », « Guide des achats », « Achats et dépenses » et
« Fournisseurs ». Les vues de la liste sont « Toutes », « Brouillons et en approbation » et
« Comptabilisées ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-33. Créer la fiche d'un fournisseur

Objectif : vérifier la création d'un fournisseur, après recherche d'un doublon.

Compte : test.achats.

Données : « Essai Fournitures Kaloum SARL » ; NIF « 123456789 » ; secteur « Fournitures de
bureau » ; téléphone « +224 620 00 00 00 ».

1. Ouvrez Comptabilité > Fournisseurs. Dans « Rechercher un fournisseur », saisissez « Kaloum ».
2. Le fournisseur n'existe pas : cliquez sur « Nouveau fournisseur ».
3. Remplissez la raison sociale, le NIF, le secteur et le téléphone, puis « Enregistrer ».
4. Ouvrez la fiche créée.

Résultat attendu : la fiche montre les coordonnées et « Factures récentes » (« Aucune facture
fournisseur. »). Elle ne montre ni solde ni conditions de paiement, tenus par la finance.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-34. Demander un engagement de dépense

Objectif : vérifier qu'un engagement se prépare, reçoit son devis et part au circuit.

Compte : test.achats.

Données : fournisseur « Essai Fournitures Kaloum SARL » ; objet « Fournitures de bureau, quatrième
trimestre (essai) » ; montant HT 4 500 000 ; catégorie « Fournitures de bureau » ; un devis en PDF.

1. Pilotage > Engagements de dépense > « Nouvel engagement ».
2. Remplissez les champs, puis « Enregistrer en brouillon ».
3. Ouvrez l'engagement, « Joindre le devis », choisissez le PDF.
4. Cliquez sur « Soumettre à l'approbation ».
5. Ouvrez Pilotage > Mes demandes.

Résultat attendu : « Devis joint. » puis « Engagement envoyé pour approbation. ». L'engagement n'est
plus modifiable. Dans « Mes demandes », onglet « En validation », il figure avec l'étape en cours.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-35. Saisir une pièce d'achat par catégorie

Objectif : vérifier que l'acheteur saisit une pièce sans choisir de compte et la soumet au circuit.

Compte : test.achats.

Données : fournisseur « Démo - Garage poids lourds » ; référence « FG-2026-131 » ; ligne
« Remplacement de deux pneus (essai) », catégorie « Pièces de rechange et pneumatiques », quantité
2, prix unitaire HT 1 250 000 ; une facture en PDF.

1. Comptabilité > Achats et dépenses > « Nouvelle facture fournisseur ».
2. Remplissez le fournisseur, la référence et la ligne. Vérifiez qu'aucune colonne ne permet de
   choisir un compte.
3. Laissez la catégorie vide et cliquez sur « Enregistrer en brouillon ».
4. Choisissez la catégorie, puis « Enregistrer en brouillon ».
5. Ouvrez la pièce, « Joindre un justificatif », puis « Envoyer pour approbation ».

Résultat attendu : étape 3, le message « Choisissez la catégorie de dépense de chaque ligne : le
compte en découle. ». Étape 5, la pièce est « En validation » et suivie dans « Mes demandes ». Les
catégories « Salaires », « Charges sociales » et « Impôts et taxes » ne sont pas proposées.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-36. Corriger une pièce refusée

Objectif : vérifier qu'une pièce refusée revient à l'acheteur avec le motif et se soumet de nouveau.

Compte : test.daf (refus), puis test.achats.

Données : la pièce de FIN-35 ; motif « Joindre le bon de livraison signé. ».

1. test.daf : Pilotage > À valider, ouvrez la pièce, écrivez le motif dans « Commentaire »,
   « Refuser », confirmez.
2. test.achats : Pilotage > Mes demandes, onglet « Refusées ». Lisez le motif.
3. Ouvrez la pièce dans Achats et dépenses, joignez le bon de livraison (« Joindre un
   justificatif »), puis « Modifier » et « Envoyer pour approbation ».

Résultat attendu : le motif du refus est lisible par l'acheteur. Après correction, la pièce repart
au circuit : elle revient dans la corbeille de la finance.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-37. Saisir un avoir de fournisseur

Objectif : vérifier la saisie d'un avoir reçu d'un fournisseur.

Compte : test.achats.

Données : fournisseur « Démo - Garage poids lourds » ; référence de l'avoir « AV-2026-007 » ; ligne
« Remise sur révision (essai) », catégorie « Entretien et réparation des véhicules », 300 000 HT.

1. Achats et dépenses > « Avoir ». La fenêtre « Nouvel avoir fournisseur » s'ouvre.
2. Remplissez l'avoir comme une pièce d'achat, enregistrez, joignez le justificatif et soumettez.

Résultat attendu : l'avoir est enregistré et suivi comme une pièce d'achat (« En validation »).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## D. Administration

### FIN-38. Créer un utilisateur et lui ouvrir ses sociétés

Objectif : vérifier la création d'un compte, ses profils et ses sociétés, et la règle des profils
propres à une société.

Compte : test.admin.

Données : « Essai Comptable Deux » ; identifiant « essai.comptable2 » ; profil Finance ; sociétés :
les deux.

1. Ouvrez Administration > Utilisateurs, puis « Nouvel utilisateur ».
2. Remplissez « Nom complet », « Identifiant », « Courriel » et « Mot de passe provisoire ».
3. Cochez les deux sociétés sous « Sociétés accessibles » et choisissez la « Société à
   l'ouverture ».
4. Cochez le profil Finance sous « Profils », puis « Enregistrer ».
5. Rouvrez la fiche et cochez le profil BTP, puis décochez EGUITRA GROUP SARLU.

Résultat attendu : avec le profil Finance, « Saisie libre des comptes » est cochée d'office sous
« Droits complémentaires ». Le compte figure dans la liste avec ses profils, « À activer » pour la
double authentification et « Actif ». À l'étape 5, cocher BTP coche d'office EGUITRA GROUP SARLU ;
la décocher affiche « Le profil « BTP » exige la société EGUITRA GROUP SARLU. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-39. Désactiver puis réactiver un compte

Objectif : vérifier la désactivation d'un compte et ses effets.

Compte : test.admin, et le compte créé en FIN-38.

Données : aucune.

1. Ouvrez la fiche du compte, puis « Désactiver » et confirmez.
2. Tentez de vous connecter avec ce compte.
3. Revenez à la fiche, « Réactiver » et confirmez.
4. Essayez « Remettre le mot de passe » avec un mot de passe de 10 caractères.

Résultat attendu : la fenêtre de désactivation précise que les pièces et l'historique restent. Le
compte désactivé ne se connecte plus ; réactivé, il se connecte. À l'étape 4, la recette refuse :
« Recette : le mot de passe est commun à tous les comptes et ne se modifie pas. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-40. Modifier un seuil d'alerte

Objectif : vérifier qu'un seuil modifié change le jugement des alertes.

Compte : test.admin, puis test.daf.

Données : le seuil de trésorerie minimale, porté à une valeur supérieure à la trésorerie actuelle.

1. Ouvrez Administration > Seuils et taux, bloc « Seuils d'alerte ».
2. Modifiez le seuil et enregistrez.
3. test.daf : ouvrez Pilotage > Alertes.
4. test.admin : remettez la valeur d'origine.

Résultat attendu : le message « Seuil « … » enregistré. » s'affiche. L'alerte correspondante devient
active chez test.daf. Une valeur vide est refusée : « Valeur requise : saisissez 0 pour éteindre la
règle. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-41. Retrouver une modification au journal d'audit

Objectif : vérifier que chaque modification garde son auteur, sa date et les valeurs avant et après.

Compte : test.achats (modification), puis test.admin.

Données : le fournisseur de FIN-33, dont le téléphone passe à « +224 620 11 11 11 ».

1. test.achats : modifiez le téléphone du fournisseur et enregistrez.
2. test.admin : ouvrez Administration > Journal d'audit, onglet « Piste d'audit ».
3. Filtrez sur l'« Auteur » Test - Acheteur.
4. Ouvrez l'onglet « Journal des accès ».

Résultat attendu : la modification apparaît avec l'auteur, la date, l'ancien et le nouveau numéro.
Le journal des accès liste les connexions du jour avec leur résultat.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## E. Refus attendus

### FIN-42. Le profil Achats n'ouvre ni les ventes ni la trésorerie

Objectif : vérifier que le profil Achats ne voit aucun écran réservé à la finance.

Compte : test.achats.

Données : aucune.

1. Cherchez dans les menus « Ventes », « Trésorerie », « Balance et états », « Tableau de bord ».
2. Dans la barre d'adresse, remplacez la fin de l'adresse par /finance/tresorerie et validez.

Résultat attendu : aucune de ces entrées n'apparaît. À l'étape 2, l'écran n'affiche aucune donnée et
signale « Non ouvert à votre profil ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-43. Personne n'approuve sa propre pièce

Objectif : vérifier qu'une pièce ne peut pas être tranchée par la personne qui l'a saisie.

Compte : test.comptable.

Données : une pièce d'achat saisie et soumise par test.comptable (comme en FIN-11).

1. Ouvrez Pilotage > À valider, onglet « À approuver ».
2. Ouvrez l'onglet « Mes demandes », puis la demande.

Résultat attendu : la pièce n'est pas dans « À approuver » de test.comptable : elle attend une autre
personne de la finance. Dans « Mes demandes », elle figure avec l'étape en cours ; sa fiche ne propose
ni « Approuver » ni « Refuser ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-44. Une pièce modifiée repasse au circuit

Objectif : vérifier qu'une pièce soumise puis modifiée doit être soumise à nouveau, l'approbateur
validant toujours ce qu'il voit.

Compte : test.comptable, puis test.daf.

Données : une pièce d'achat soumise et non encore approuvée.

1. test.comptable : ouvrez la pièce « En validation », « Modifier », changez le prix unitaire, puis
   « Enregistrer ».
2. test.daf : ouvrez la demande dans « À approuver » et tentez « Approuver ».

Résultat attendu : l'ancienne demande n'est plus approuvable : « La pièce a été modifiée depuis sa
soumission : elle doit être soumise à nouveau. ». La pièce modifiée doit être soumise de nouveau
pour revenir au circuit.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-45. La finance clôture, la direction rouvre

Objectif : vérifier le partage des rôles de la clôture mensuelle.

Compte : test.dg, puis test.daf.

Données : un mois terminé, ouvert ; puis le mois clôturé en FIN-29.

1. test.dg : Clôtures et contrôles, ouvrez un mois terminé non clôturé.
2. test.daf : ouvrez le mois clôturé en FIN-29.

Résultat attendu : chez test.dg, « Lancer les contrôles » est proposé mais pas « Clôturer le mois »,
avec la mention « La clôture elle-même est faite par la finance ». Chez test.daf, le mois clôturé ne
propose pas « Rouvrir le mois » : « La réouverture d'un mois clôturé est réservée à la direction et
à l'administration ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-46. Aucune saisie dans un mois clôturé

Objectif : vérifier qu'un mois clôturé refuse toute nouvelle écriture.

Compte : test.comptable, pendant que le mois de FIN-29 est clôturé.

Données : une facture de vente datée d'un jour du mois clôturé.

1. Ventes > « Nouvelle facture », date de la pièce dans le mois clôturé, puis « Enregistrer et
   valider ».

Résultat attendu : la validation est refusée par un message qui indique que la période est close ;
aucune écriture n'est passée dans le mois clôturé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-47. Les profils métier n'ont pas le tableau de bord

Objectif : vérifier qu'un profil métier n'ouvre que ses écrans de Finance.

Compte : test.chantiers.

Données : aucune.

1. Connectez-vous et ouvrez Finance.
2. Cherchez dans les menus « Tableau de bord », « Ventes », « Trésorerie ».

Résultat attendu : Finance s'ouvre sur l'écran BTP. Les menus ne proposent ni « Tableau de bord », ni
« Ventes », ni « Trésorerie ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## F. Contrôles de saisie et de sécurité

### FIN-48. Nombres écrits à la française

Objectif : vérifier que les montants s'écrivent à la française et qu'une écriture ambiguë est refusée
avec un message, au lieu d'être mal lue.

Compte : test.comptable.

Données : quantité « 2,5 » ; prix « 750 000 » ; puis prix « 2.500.000 ».

1. Ventes > « Nouvelle facture ». Client « Démo - Société minière B », libellé « Essai des
   nombres ».
2. Saisissez « 2,5 » dans « Qté » et « 750 000 » dans « Prix unitaire HT ».
3. Remplacez le prix par « 2.500.000 ».
4. Remettez « 750 000 », puis « Enregistrer en brouillon ».

Résultat attendu : à l'étape 2, le total HT vaut 1 875 000 GNF. À l'étape 3, la ligne affiche
« Nombre illisible (prix unitaire) : écrivez par exemple 750 000 ou 2,5. » et les boutons
d'enregistrement sont grisés. À l'étape 4, le brouillon est enregistré avec 1 875 000 GNF HT.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-49. Un double clic n'enregistre qu'une pièce

Objectif : vérifier qu'un double clic sur un bouton d'enregistrement ne crée pas deux pièces.

Compte : test.comptable.

Données : une facture de vente d'essai de 100 000 GNF.

1. Ventes > « Nouvelle facture », remplissez la facture.
2. Double-cliquez rapidement sur « Enregistrer en brouillon ».
3. Vue « Brouillons » : comptez les brouillons de ce client à ce montant.
4. Recommencez avec un virement interne (« Enregistrer le virement ») de 10 000 GNF.

Résultat attendu : le bouton tourne pendant l'enregistrement ; une seule facture et un seul virement
sont créés.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-50. Confirmation avant une action irréversible

Objectif : vérifier qu'une action sans retour demande une confirmation, et qu'« Annuler » ne change
rien.

Compte : test.comptable.

Données : le brouillon de FIN-49 ; la facture validée de FIN-06.

1. Ouvrez le brouillon, puis « Supprimer le brouillon ». Lisez la fenêtre, puis « Annuler ».
2. Recommencez et confirmez par « Supprimer ».
3. test.daf : ouvrez la facture validée, « Annuler la pièce ». Lisez la fenêtre, puis « Annuler ».

Résultat attendu : étape 1, la fenêtre « Supprimer ce brouillon ? » précise qu'il disparaît
définitivement ; « Annuler » le garde. Étape 2, il disparaît. Étape 3, la fenêtre explique les effets
de l'annulation et conseille l'avoir ; « Annuler » ne change rien.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-51. Message clair en cas de coupure du réseau

Objectif : vérifier qu'une coupure pendant un enregistrement est annoncée en français et que la
saisie n'est pas perdue.

Compte : test.comptable.

Données : une sortie de caisse de 20 000 GNF.

1. Trésorerie > « Nouvelle opération », remplissez la sortie.
2. Coupez le réseau du poste, puis « Enregistrer ».
3. Rétablissez le réseau, puis cliquez de nouveau sur « Enregistrer ».

Résultat attendu : à l'étape 2, un message en français signale l'échec (réseau indisponible ou
enregistrement impossible), sans texte en anglais ni code ; la fenêtre reste ouverte avec la
saisie. À l'étape 3, l'opération est enregistrée une seule fois.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## G. Factures au modèle de la société

### FIN-52. Mettre le slogan et les téléphones de la société sur les factures

Objectif : vérifier que l'identité saisie dans Sociétés figure en tête des factures imprimées.

Compte : test.admin, puis test.comptable.

Données : slogan « Votre partenaire global pour un avenir durable » ; téléphones « +224 620 00 00 01
/ +224 620 00 00 02 » (fictifs) ; la facture validée de FIN-06. Notez les valeurs actuelles de la
fiche pour les remettre à la fin.

1. test.admin : ouvrez Administration > Sociétés, carte « Groupe » (EGUITRA GROUP SARLU).
2. Saisissez le « Slogan » et les « Téléphones » ; vérifiez que « Ville » porte « Conakry ». Cliquez
   sur « Enregistrer ».
3. test.comptable : Comptabilité > Ventes, ouvrez la facture de FIN-06, puis « PDF ».
4. test.admin : remettez les valeurs notées, puis « Enregistrer ».

Résultat attendu : le message « Société enregistrée. » s'affiche. En tête du PDF, le logo et le
slogan. Dessous, à gauche, la raison sociale, l'adresse, « BP … – Conakry » si une boîte postale est
saisie, « Contact : +224 620 00 00 01 / +224 620 00 00 02 », le courriel et, s'ils sont renseignés,
le NIF et le RCCM ; à droite, « FACTURE », « N° » suivi du numéro et « Conakry, le » suivi de la date
de la facture. Les titres sont à la couleur de la société, à défaut en vert.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-53. Régler le signataire, les modes de règlement et les comptes bancaires

Objectif : vérifier que l'administration règle le bas des factures : signataire, modes de règlement
et comptes bancaires cochés « Afficher sur les factures ».

Compte : test.admin, puis test.comptable.

Données : premier journal du bloc « Journaux de vente » : signataire « SERVICE COMMERCIAL », modes de
règlement « Par espèces, virement bancaire ou chèque » ; premier compte du bloc « Comptes bancaires
portés sur les factures » : banque « Banque d'essai », numéro « 99000111222333 », IBAN « gn00 essa
9900 0111 2223 33 », code SWIFT « essagnxx » (fictifs) ; la facture validée de FIN-06. Notez les
valeurs actuelles pour les remettre à la fin.

1. test.admin : ouvrez Finance > Administration > Factures et journaux. Lisez la présentation de la
   page.
2. Dans le premier journal de vente, saisissez le « Signataire » et les « Modes de règlement », puis
   « Enregistrer ».
3. Dans le premier compte bancaire, videz « Numéro de compte » et cochez « Afficher sur les
   factures » : regardez le bouton « Enregistrer ».
4. Remplissez « Banque », « Numéro de compte », « IBAN » et « Code SWIFT », laissez la case cochée,
   puis « Enregistrer ».
5. test.comptable : ouvrez la facture de FIN-06, puis « PDF ».
6. test.admin : décochez « Afficher sur les factures », « Enregistrer », puis remettez les valeurs
   notées. test.comptable : rouvrez le PDF.

Résultat attendu : « Journal « … » enregistré. », puis « Compte « … » enregistré. ». À l'étape 3,
« Enregistrer » reste grisé tant que le numéro de compte manque. Après l'étape 4, l'IBAN et le SWIFT
reviennent en majuscules, sans espaces, et le compte porte « Sur les factures ». Sur le PDF, sous
« CONDITIONS ET MODE DE RÈGLEMENT » : « Par espèces, virement bancaire ou chèque », puis « Banque
d'essai : compte n° 99000111222333 » et « IBAN : GN00ESSA99000111222333 · SWIFT : ESSAGNXX » ; en bas
à droite, « SERVICE COMMERCIAL », puis la raison sociale. Les comptes non cochés n'y figurent pas. À
l'étape 6, le compte porte « Hors des factures » et disparaît du PDF.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-54. Saisir une facture avec objet, rubriques, notes et unité

Objectif : vérifier que le formulaire de vente porte la référence de l'offre, l'objet, les rubriques,
les notes et l'unité, et que le PDF les reprend au modèle de la société.

Compte : test.comptable.

Données : client « Démo - Distributeur pétrolier A » ; « Référence de l'offre » « OFF-ESSAI-012 » ;
« Contrat ou bon de commande » « BC-ESSAI-045 » ; « Objet de la facture » « Crépissage du bâtiment
principal (essai) » ; rubrique « Charpente et couverture » avec les lignes « Charpente » (une unité
de la liste autre que l'unité ordinaire, quantité 2, prix unitaire HT 250 000) et « Couverture »
(quantité 1, prix 300 000), puis la note « Travaux réalisés selon le devis accepté. » ; rubrique
« Divers » avec la ligne « Accessoires de fixation » (quantité 1, prix 200 000) ; TVA de la société,
sans retenue.

1. Ouvrez Comptabilité > Ventes, puis « Nouvelle facture ». Choisissez le « Client » et remplissez
   « Référence de l'offre », « Contrat ou bon de commande » et « Objet de la facture ».
2. Cliquez sur « Ajouter une rubrique », supprimez la ligne vide du haut (corbeille), puis écrivez
   « Charpente et couverture ».
3. « Ajouter une ligne » deux fois : « Charpente », avec son « Unité », puis « Couverture ». Cliquez
   ensuite sur « Ajouter une note ».
4. « Ajouter une rubrique » : « Divers », puis « Ajouter une ligne » : « Accessoires de fixation ».
5. Cliquez sur « Enregistrer en brouillon ». Ouvrez le brouillon, puis « PDF ».
6. Cliquez sur « Valider », puis de nouveau sur « PDF ».

Résultat attendu : la fiche du brouillon montre « Objet : » suivi de l'objet et « Rubrique :
Charpente et couverture ». Le PDF du brouillon porte en tête « BROUILLON : facture non validée, sans
numéro ni valeur comptable. Le numéro est attribué à la validation. » et « Brouillon » sous
« FACTURE », sans numéro ; validée, la facture n'a plus ce bandeau et porte « N° » suivi de son
numéro. Le PDF porte « Référence offre : OFF-ESSAI-012 » et « Contrat ou bon de commande :
BC-ESSAI-045 » à droite du bloc « CLIENT », et dessous « Commentaire ou indication : Crépissage du
bâtiment principal (essai) ». Le tableau a les colonnes « N° », « Description », « Unité »,
« Quantité », « PU HT (GNF) » et « Montant HT (GNF) » : « I. Charpente et couverture », ses lignes 1
et 2, la note en italique, « Sous-total Charpente et couverture » 800 000, puis « II. Divers », la
ligne 3 et « Sous-total Divers » 200 000. Totaux : « Montant HT » 1 000 000 GNF, la TVA à 18 %
(180 000 GNF) et « NET À PAYER (TTC) » 1 180 000 GNF ; à gauche, « Arrêtée la présente facture à la
somme de : » et « Un million cent quatre-vingt mille francs guinéens ». Plus bas, « CONDITIONS ET MODE
DE RÈGLEMENT » (échéance, modes de règlement, comptes bancaires cochés) et, à droite, le signataire
puis la raison sociale.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-55. Imprimer une facture en partie réglée et un avoir

Objectif : vérifier le reste à payer d'une facture en partie réglée et la présentation d'un avoir.

Compte : test.comptable.

Données : la facture validée de FIN-54 (1 180 000 GNF TTC) ; encaissement de 180 000 GNF ; l'avoir
validé en FIN-07.

1. Comptabilité > Ventes, ouvrez la facture de FIN-54, puis « Encaisser ».
2. Choisissez le « Compte de trésorerie » et le « Mode de paiement », saisissez 180 000 dans
   « Montant », puis « Enregistrer le règlement ».
3. Cliquez sur « PDF ».
4. Ouvrez l'avoir de FIN-07 dans la liste des ventes, puis « PDF ».

Résultat attendu : sous « NET À PAYER (TTC) », le PDF de la facture ajoute « Paiement perçu »
180 000 GNF, puis « Reste à payer » 1 000 000 GNF en gras. Le PDF de l'avoir porte « AVOIR » et son
numéro, « Référence : Avoir sur » suivi du numéro de la facture de FIN-06, « Facture d'origine : »
suivi du même numéro, « TOTAL TTC » et « Arrêté le présent avoir à la somme de : » avec le montant en
toutes lettres ; il n'a pas de bloc « CONDITIONS ET MODE DE RÈGLEMENT ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-56. Reprendre la numérotation de l'ancien système

Objectif : vérifier que le dernier numéro de l'ancien système donne le numéro de la prochaine facture
(EG24137 donne EG24138), et qu'un format que la plateforme ne sait pas continuer est refusé, avec un
format proposé.

Compte : test.admin.

Données : le premier journal de vente, qui a déjà des factures de démonstration ; un journal de vente
encore sans facture, préparé sur la recette par E-VOLUTION XP ; les numéros « EG24137 », puis
« 0026/MBAX06/26 » (ancien format de MB AxisPro Consulting). Numéros proposés donnés pour 2026 : ils
portent l'année en cours.

1. Ouvrez Finance > Administration > Factures et journaux, bloc « Journaux de vente ». Regardez le
   premier journal.
2. Sur le journal préparé, saisissez « EG24137 » dans « Dernier numéro de l'ancien système », puis
   cliquez hors du champ.
3. Remplacez par « 0026/MBAX06/26 » et cliquez hors du champ.
4. Cliquez sur le bouton qui propose de saisir « MBAX/2026/0026 ».
5. Remettez « EG24137 », cliquez hors du champ, puis « Enregistrer ».

Résultat attendu : étape 1, le champ est grisé, avec « Le journal numérote déjà ses factures
(dernière : …) : la numérotation continue d'elle-même. » ; « Prochaine facture : » donne le numéro
suivant de ce journal. Étape 2, « Prochaine facture : EG24138 » s'affiche à côté du nom du journal.
Étape 3, un message rouge refuse le numéro, car le compteur n'est pas en fin de numéro ; il propose de
saisir « MBAX/2026/0026 » : la première facture portera « MBAX/2026/0027 », puis la numérotation
repartira à 0001 chaque année. « Enregistrer » reste grisé. Étape 4, le champ reçoit
« MBAX/2026/0026 » et « Prochaine facture : MBAX/2026/0027 » s'affiche. Étape 5, « Journal « … »
enregistré. » et « Prochaine facture : EG24138 ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-57. Les réglages des factures sont tenus par l'administration

Objectif : vérifier que la finance consulte les réglages des factures sans les modifier, et que les
autres profils n'y ont pas accès.

Compte : test.daf, puis test.achats.

Données : aucune.

1. test.daf : ouvrez Finance > Administration > Factures et journaux.
2. Essayez de modifier un signataire ou de cocher « Afficher sur les factures ».
3. Cherchez « Sociétés » dans le menu « Administration ». Dans la barre d'adresse, remplacez la fin de
   l'adresse par /finance/admin/societes et validez.
4. test.achats : remplacez la fin de l'adresse par /finance/admin/factures et validez.

Résultat attendu : chez test.daf, la page affiche « Réglages tenus par l'administration :
consultation seulement. » ; champs et cases sont grisés, sans bouton « Enregistrer ». « Sociétés »
n'apparaît pas ; par l'adresse, l'écran n'affiche aucune donnée et signale « Non ouvert à votre
profil ». Chez test.achats, Factures et journaux n'affiche aucune donnée et signale « Non ouvert à
votre profil ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## H. États au modèle SYSCOHADA

### FIN-58. Lire le bilan détaillé par poste

Objectif : vérifier le bilan au modèle du système normal : postes détaillés, brut, amortissements et
dépréciations, net et N-1.

Compte : test.daf.

Données : arrêté au dernier jour du mois précédent. Les dates de cette partie sont données pour une
campagne de tests en 2026 : l'exercice précédent est 2025.

1. Ouvrez Comptabilité > Balance et états, onglet « Bilan », et choisissez la date « Arrêté au ».
2. Lisez le message au-dessus des tableaux.
3. Dans « Bilan actif », lisez les colonnes, puis les postes sous « Immobilisations incorporelles »
   (AD), « Immobilisations corporelles » (AI), « Immobilisations financières » (AQ) et « Créances et
   emplois assimilés » (BG).
4. Sur la ligne « Matériel de transport » (AN), comparez « Brut », « Amort. et dépréc. » et « Net ».
5. Lisez « Bilan passif ».

Résultat attendu : le message « Bilan équilibré au » suivi de la date, puis « Montants en GNF ;
colonne N-1 : bilan à la clôture de l'exercice précédent. ». « Bilan actif » a les colonnes
« Réf. », « Rubrique », « Note », « Brut », « Amort. et dépréc. », « Net » et « N-1 (31/12/2025) ».
Les postes AE à AH, AJ à AN, AR et AS, BH à BJ sont en retrait sous leur rubrique ; « Avances et
acomptes versés sur immobilisations » (AP) est une ligne à part, hors des immobilisations
corporelles ; les rubriques et les totaux (AD, AI, AQ, AZ, BG, BK, BT, BZ) sont en gras. Sur chaque
ligne, le net égale le brut moins les amortissements et dépréciations : AN porte en brut les
ensembles et véhicules de la société (dont « Ensemble citerne DEMO-04 (démo) ») et en amortissements
leur cumul. La colonne « Note » donne le numéro de la note annexe (« 3 » pour les immobilisations
incorporelles et corporelles, « 7 » pour les clients). « Bilan passif » a les colonnes « Note »,
« Net » et « N-1 ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-59. Lire les signes, les notes et les lettres des états

Objectif : vérifier le signe et la note du compte de résultat, les lettres A à H du tableau des flux
et son contrôle par la trésorerie du bilan.

Compte : test.daf.

Données : du 1er janvier à la date du jour.

1. Onglet « Compte de résultat » : choisissez « Du » et « Au ».
2. Lisez la colonne qui suit « Rubrique », puis la colonne « Note ».
3. Onglet « Tableau des flux », même période : lisez la colonne qui suit « Rubrique ».
4. Lisez la ligne placée sous FE, les dernières lignes du tableau et le message au-dessus.

Résultat attendu : au compte de résultat, « + » devant chaque produit (lignes T, par exemple
« Travaux, services vendus », note 21), « - » devant chaque charge (lignes R, par exemple « Charges
de personnel », note 27), rien devant les soldes (« Chiffre d'affaires », « Résultat net ») ; les
montants restent positifs, le signe dit le sens. Les colonnes « Mois », « Exercice », « % du CA » et
« N-1 » (même période de l'an dernier) suivent. Au tableau des flux, les lettres A à H marquent les
totaux ZA à ZH ; la ligne « Variation du BF lié aux activités opérationnelles (FB + FC + FD + FE) »
suit FE ; en bas, « Contrôle : trésorerie actif - trésorerie passif du bilan » égale ZH, et le message
commence par « Le tableau rejoint la trésorerie nette du bilan au ». Sinon, le message chiffre l'écart,
à analyser avec l'expert-comptable, et une ligne rouge « Écart : contrôle - trésorerie nette de fin
(H) » s'ajoute.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-60. Produire les états au modèle SYSCOHADA

Objectif : vérifier le classeur « Modèle SYSCOHADA » : trois feuilles au modèle de l'expert-comptable,
des valeurs et jamais de formules.

Compte : test.daf.

Données : arrêté au dernier jour du mois précédent.

1. Onglet « Bilan », date « Arrêté au », puis « Modèle SYSCOHADA ».
2. Ouvrez le classeur dans Excel et lisez le nom des feuilles.
3. Feuille « Bilan » : lisez l'en-tête et les colonnes de l'actif et du passif. Comparez trois postes
   avec l'écran, par leur code de la colonne « REF ». Cliquez sur la cellule d'un total.
4. Lisez les feuilles « Compte de Résultat » et « Tableau des Flux de trésorerie ».
5. Onglet « Compte de résultat » : changez « Du » pour le 1er du mois, gardez « Au », puis « Modèle
   SYSCOHADA ».

Résultat attendu : le classeur a trois feuilles, « Bilan », « Compte de Résultat » et « Tableau des
Flux de trésorerie ». Chacune porte « Désignation entité : EGUITRA GROUP SARLU », « Numéro
d'identification : » suivi du NIF de la société (ou « non renseigné »), « Exercice clos le
31-12-2026 » et « Durée (en mois) : 12 », puis un titre comme « BILAN AU 30 SEPTEMBRE 2026 ». L'actif
a les colonnes « REF », « ACTIF », « Note », « EXERCICE AU » la date d'arrêté (« BRUT », « AMORT. ET
DÉPRÉC. », « NET ») et « EXERCICE AU 31/12/2025 » (« NET ») ; le passif a « REF », « PASSIF »,
« Note » et les deux colonnes « NET ». Les montants sont ceux de l'écran, les totaux en gras ; une
cellule de total contient un nombre, pas une formule. Le compte de résultat porte le signe et la note
de chaque ligne ; le tableau des flux, ses lettres, la variation du BF et le contrôle de la
trésorerie. À l'étape 5, le classeur porte toujours sur l'exercice, de son premier jour à la date
« Au ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-61. Importer les états de l'exercice précédent

Objectif : vérifier l'import des états de l'exercice précédent au modèle, ses refus et ses contrôles.

Compte : test.admin.

Données : deux classeurs produits par « Modèle SYSCOHADA » (Balance et états, onglet « Bilan ») : le
premier arrêté à la date du jour, le second au 31/12/2025, dernier jour de l'exercice précédent. Sur
la recette, l'exercice précédent n'a aucune écriture : ne datez aucune pièce de 2025 pendant ces
essais.

1. Produisez les deux classeurs : « Arrêté au » à la date du jour, puis « Modèle SYSCOHADA » ;
   « Arrêté au » au 31/12/2025, puis « Modèle SYSCOHADA ».
2. Ouvrez Comptabilité > Clôtures et contrôles, bloc « Comparatifs du premier exercice », en bas de
   la page. Lisez la date proposée dans « Exercice clos le ».
3. Cliquez sur « États de l'exercice (.xlsx) » et choisissez le classeur arrêté à la date du jour.
4. Changez « Exercice clos le » pour le 30/06/2025, puis choisissez le classeur du 31/12/2025.
5. Remettez « Exercice clos le » au 31/12/2025 et choisissez de nouveau ce classeur.
6. Lisez la fiche de l'import.

Résultat attendu : « Exercice clos le » propose le 31/12/2025. Étape 3, refus : « Le classeur porte
sur l'exercice 2026 et non 2025 : choisissez la date de clôture correspondante. ». Étape 4, refus :
« Le 30/06/2025 n'est pas une date de clôture d'exercice de EGUITRA GROUP SARLU. ». Ces refus
n'enregistrent rien. Étape 5, « États importés : contrôles ci-dessous. ». La fiche annonce « Exercice
du 01/01/2025 au 31/12/2025 : 7 contrôles conformes sur 7 », puis le nom du classeur, la société et
« importé par Test - Administrateur le » suivi de la date. Elle liste, chacun marqué « Conforme » :
« Bilan équilibré : total actif (BZ) = total passif (DZ) », « Résultat du bilan (CJ) = résultat net
du compte de résultat (XI) », « Chaque total égal à la somme de ses postes », « Actif : net = brut -
amortissements et dépréciations », « Trésorerie nette de fin (ZH) = trésorerie actif (BT) -
trésorerie passif (DT) », « Trésorerie nette d'ouverture (ZA) = BT - DT de l'exercice précédent » et
« Report à nouveau (CH) = report N-1 + résultat N-1 - distributions ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-62. Remplacer l'import et le lire en colonne N-1

Objectif : vérifier que le remplacement d'un import se confirme, que les contrôles signalent un écart
sans bloquer l'import, et que les états importés servent de colonne N-1.

Compte : test.admin, puis test.daf.

Données : le classeur du 31/12/2025 de FIN-61 ; une copie de ce classeur où, dans la feuille
« Bilan », bloc « PASSIF », la ligne « CA » porte 100 000 000 dans la colonne « EXERCICE AU
31/12/2025 ».

1. test.admin : préparez la copie dans Excel et enregistrez-la.
2. Clôtures et contrôles, « Comparatifs du premier exercice », « Exercice clos le » au 31/12/2025 :
   choisissez la copie. Lisez la fenêtre, puis « Annuler ».
3. Recommencez et confirmez par « Remplacer l'import ».
4. test.daf : Balance et états, onglet « Bilan », « Arrêté au » à la date du jour. Lisez les messages
   et la colonne N-1 de « Capital » (CA).
5. Onglet « Compte de résultat », « Du » au 01/01/2026 : « Au » à la date du jour, puis au 31/12/2026.
6. test.admin : remplacez de nouveau l'import par le classeur d'origine.

Résultat attendu : étape 2, la fenêtre indique que des états de l'exercice clos le 31/12/2025 ont déjà
été importés (nom du classeur, par Test - Administrateur), demande de confirmer leur remplacement et
précise que le remplacement est inscrit à la piste d'audit ; « Annuler » ne change rien. Étape 3,
« Import remplacé : contrôles ci-dessous. » et « 6 contrôles conformes sur 7 » : « Chaque total égal
à la somme de ses postes » est marqué « Écart » et cite « CP Total capitaux propres et ressources
assimilées (net) : attendu 100 000 000 GNF, lu 0 GNF » ; l'import est enregistré malgré l'écart. Étape
4, le message « Colonne N-1 (bilan au 31/12/2025) : états de l'exercice précédent importés pour
EGUITRA GROUP SARLU » s'affiche et « Capital » montre 100 000 000 en N-1. Étape 5, à la date du jour, un
avertissement explique que les états importés valent pour l'exercice entier et invite à choisir
l'exercice complet ; au 31/12/2026, le message « Colonne N-1 (compte de résultat) : états de
l'exercice précédent importés » s'affiche. Étape 6, la fiche revient à « 7 contrôles conformes sur
7 ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-63. Contrôler le bilan d'ouverture

Objectif : vérifier la comparaison, poste par poste, des à-nouveaux de l'exercice et du bilan importé
de l'exercice précédent.

Compte : test.daf.

Données : l'import de FIN-61 (classeur d'origine).

1. Clôtures et contrôles, bloc « Comparatifs du premier exercice » : sur la fiche de l'import,
   cliquez sur « Bilan d'ouverture ».
2. Lisez le message, puis le tableau.
3. Cliquez sur « Tous les postes », puis sur « Écarts seulement ».
4. Cliquez sur « Masquer le bilan d'ouverture ».

Résultat attendu : le tableau a les colonnes « Réf. », « Poste », « Bilan importé (net) »,
« À-nouveaux (net) » et « Écarts ». Le message est l'un des trois suivants : « Bilan d'ouverture au
01/01/2026 conforme au bilan importé, poste par poste. » ; le nombre de postes qui diffèrent entre
les à-nouveaux et le bilan importé, avec le rappel que le résultat de l'exercice précédent se lit en
CJ s'il est repris au compte 13, en CH s'il l'est au compte 12 ou au compte d'affectation du
résultat ; ou « Aucun à-nouveau (journal AN) dans l'exercice ouvert le 01/01/2026 : la reprise des
soldes d'ouverture reste à faire. ». Sur la recette, les à-nouveaux de démonstration diffèrent du
classeur importé, à zéro : les postes en cause, dont la banque (BS), sont listés avec leur écart.
« Tous les postes » ajoute les postes conformes, marqués « – ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### FIN-64. L'import est réservé à l'administration, la lecture à la finance et à la direction

Objectif : vérifier que seule l'administration importe ou remplace les états de l'exercice précédent,
et que la finance et la direction les lisent et produisent le classeur au modèle.

Compte : test.daf, puis test.dg.

Données : l'import de FIN-61.

1. test.daf : ouvrez Clôtures et contrôles, bloc « Comparatifs du premier exercice ».
2. test.dg : ouvrez le même bloc, puis « Bilan d'ouverture » sur la fiche de l'import.
3. test.dg : Balance et états, onglet « Bilan », « Modèle SYSCOHADA ».

Résultat attendu : chez test.daf comme chez test.dg, le bloc ne propose ni « Exercice clos le » ni
« États de l'exercice (.xlsx) » et précise « L'import est fait par l'administration. ». La fiche de
l'import, ses contrôles et le bilan d'ouverture se lisent. test.dg obtient le classeur au modèle.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## Synthèse

| Partie {52} | Scénarios {12} | Réussis {12} | Échoués {12} | Non joués {12} |
|---|---|---|---|---|
| A. Direction générale | 5 | | | |
| B. Finance et comptabilité | 26 | | | |
| C. Achats | 6 | | | |
| D. Administration | 4 | | | |
| E. Refus attendus | 6 | | | |
| F. Contrôles de saisie et de sécurité | 4 | | | |
| G. Factures au modèle de la société | 6 | | | |
| H. États au modèle SYSCOHADA | 7 | | | |
| Total | 64 | | | |

Réserves et anomalies relevées :

| N° {6} | Scénario {12} | Constat {52} | Demande DEM-… {16} | Gravité {14} |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |

## Signatures

| Le testeur {50} | Le référent du domaine {50} |
|---|---|
| Nom : | Nom : |
| Fonction : | Fonction : |
| Date : | Date : |
| Signature : | Signature : |
