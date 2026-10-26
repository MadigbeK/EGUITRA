# Cahier de test : RH et paie

NIMOVA · RH, gestion commune du personnel d'EGUITRA GROUP SARLU et de MB AxisPro Consulting.

Salariés et dossiers, absences et congés, avances et prêts, paie du mois jusqu'au bulletin et à
l'écriture de paie, simulateur, « Mon espace » de chaque salarié et de son responsable.

| Rubrique {28} | À remplir {72} |
|---|---|
| Module | RH et paie (NIMOVA · RH) |
| Version de la plateforme | ______ (communiquée par E-VOLUTION XP) |
| Date du test | ______ |
| Nom du testeur | ______ |
| Fonction | ______ |
| Profil utilisé | ______ |
| Compte de test | ______ |
| Société | ☐ EGUITRA GROUP SARLU    ☐ MB AxisPro Consulting |

Document préparé par E-VOLUTION XP le 26 octobre 2026, d'après les écrans de la plateforme à cette
date.

<!-- saut de page -->

## Mode d'emploi

Ce cahier se joue sur la recette : une copie complète de NIMOVA, avec des salariés fictifs repérés
« (démo) ». Rien de ce que vous y faites ne touche la vraie paie : vous pouvez tout essayer, y compris
les erreurs. Les taux de paie de la recette restent à valider par l'expert-comptable et la CNSS : on
contrôle ici le fonctionnement, pas les taux.

1. Se connecter. Ouvrez, dans Chrome ou Edge, l'adresse de la recette communiquée par E-VOLUTION XP
   suivie de /rh : test.rh et test.salarie n'ont pas Finance, l'adresse seule les refuse. Les autres
   comptes peuvent aussi passer par l'accueil, rayon RH. Identifiant : le compte de test indiqué dans le scénario. Mot de
   passe : le mot de passe commun de la recette, communiqué par E-VOLUTION XP.
2. Une seule gestion pour deux sociétés. Les listes réunissent le personnel des deux sociétés ; le
   filtre « Société » restreint l'affichage. Chaque société garde sa paie.
3. Jouer un scénario. Suivez les étapes dans l'ordre, avec les données indiquées. Un scénario à deux
   comptes se joue dans deux navigateurs (Chrome et Edge) ou sur deux postes.
4. Noter le résultat. Cochez « Réussi » si l'écran correspond au résultat attendu, sinon « Échoué ».
   Dans « Remarques », notez ce qui diffère : l'écran, le message affiché, l'heure.
5. Signaler une anomalie. Menu du compte (rond à vos initiales, en haut à droite) > « Mes demandes »
   > « Nouvelle demande », type « Remarque de recette », application NIMOVA · RH, la gravité ; titre
   commençant par le numéro du scénario (par exemple « RH-09 : bulletin non calculé ») ; description ;
   « Déposer la demande ». Reportez le numéro reçu (DEM-…) dans les remarques. N'écrivez jamais un
   salaire réel dans une demande.

## Comptes de test

| Compte {18} | Profil ou rôle {22} | Dossier salarié lié {28} | Rôle dans ce cahier {32} |
|---|---|---|---|
| test.rh | Ressources humaines | aucun | dossiers, absences, avances, préparation de la paie |
| test.dg | Direction | Mamadou Sylla (démo) | validation de la paie, absences de son équipe |
| test.daf | Finance | aucun | comptabilisation de l'écriture de paie |
| test.salarie | Salarié, Mon espace seul | Thierno Baldé (démo), mécanicien | libre-service |
| test.exploitation | Responsable hiérarchique | Sékou Touré (démo), chef de parc | demandes de son équipe |
| test.parc | Salarié | Alpha Diallo (démo), chauffeur | demande d'absence en attente |
| test.admin | Administration | aucun | paramètres RH |

Données fictives utiles : douze salariés des deux sociétés ; la paie du mois précédent validée ; une
avance de 1 200 000 GNF à « Ousmane Bangoura (démo) » ; une demande de congé de « Alpha Diallo
(démo) » en attente.

## A. Ressources humaines

### RH-01. Lire le tableau de bord RH

Objectif : vérifier que le tableau de bord donne l'effectif, la masse salariale et ce qui est à
traiter.

Compte : test.rh.

Données : aucune.

1. Ouvrez NIMOVA · RH, Pilotage > Tableau de bord.
2. Lisez « Effectif », « Entrées et sorties de l'année », « Masse salariale mensuelle », « Taux
   d'absence (30 jours) », l'« Échéancier » et « Paie du mois ».
3. Choisissez une seule société dans le filtre « Société », puis revenez aux deux.

Résultat attendu : les chiffres réunissent les deux sociétés, puis se limitent à la société choisie.
L'échéancier liste les fins d'essai et de contrat, les documents à renouveler et les dossiers
incomplets.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-02. Embaucher un salarié

Objectif : vérifier la création d'un dossier et l'attribution du matricule selon l'employeur.

Compte : test.rh.

Données : « Mariama Condé (essai) » ; employeur EGUITRA GROUP SARLU ; fonction « Assistante
administrative » ; responsable hiérarchique « Mamadou Sylla (démo) » ; CDD de 6 mois ; embauche au
premier jour du mois ; fin de la période d'essai un mois plus tard ; salaire de base 3 500 000.

1. Ouvrez Personnel > Salariés, puis « Nouveau salarié ».
2. Remplissez « Nom et prénoms », « Employeur », « Fonction », « Responsable hiérarchique », « Type de
   contrat », « Date d'embauche », « Fin de la période d'essai », « Fin du contrat » et « Salaire de
   base mensuel (GNF) ».
3. Laissez vide « Fin du contrat », puis cliquez sur « Créer le dossier ».
4. Remplissez « Fin du contrat », puis « Créer le dossier ».

Résultat attendu : à l'étape 3, la création est refusée : un CDD a une date de fin. À l'étape 4, le
dossier est créé avec un matricule EG-… ; la liste signale « dossier à compléter ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-03. Compléter le dossier d'un salarié

Objectif : vérifier les onglets du dossier, les éléments fixes et les documents à échéance.

Compte : test.rh.

Données : le dossier de RH-02 ; numéro CNSS « 123456 » ; paiement par virement ; activité
administration ; élément fixe « Transport » 300 000 ; document « Contrat signé » expirant à la fin du
CDD.

1. Ouvrez le dossier. Lisez les onglets « Identité », « Contrat et rémunération », « Congés »,
   « Documents » et « Paie ».
2. « Modifier » : saisissez le « Numéro CNSS », le « Mode de paiement du salaire » et l'activité.
   Enregistrez.
3. Onglet « Contrat et rémunération », « Éléments fixes » : ajoutez la rubrique et son montant.
4. Onglet « Documents » : déposez le contrat avec sa date d'échéance.

Résultat attendu : la mention « dossier à compléter » disparaît une fois la fiche complète. L'élément
fixe s'ajoute au brut mensuel. Le document figure avec son échéance, rappelée dans l'échéancier.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-04. Augmenter un salaire avec un motif

Objectif : vérifier que tout changement du salaire de base garde son motif dans l'historique.

Compte : test.rh.

Données : le dossier de RH-02 ; nouveau salaire 3 800 000 ; motif « Avenant (essai) ».

1. Ouvrez le dossier, « Modifier ». Changez le « Salaire de base mensuel (GNF) ».
2. Remplissez « Motif du changement de salaire », puis enregistrez.
3. Onglet « Contrat et rémunération », lisez « Historique du salaire de base ».

Résultat attendu : l'historique montre la date, l'ancien et le nouveau salaire, l'écart et le motif,
avec l'auteur du changement.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-05. Enregistrer une absence constatée

Objectif : vérifier la saisie directe d'une absence et le décompte en jours ouvrables.

Compte : test.rh.

Données : salarié « Ibrahima Barry (démo) » ; congé payé du lundi au samedi de la semaine prochaine.

1. Ouvrez Personnel > Absences et congés, puis « Saisir une absence ».
2. Choisissez le « Salarié », le « Type d'absence » et les dates ; lisez la durée affichée.
3. Laissez cochée « Enregistrer comme approuvée (absence constatée ou accord déjà donné) », puis
   « Enregistrer l'absence ».
4. Ouvrez l'onglet « Planning du mois ».

Résultat attendu : la durée affichée est de 6 jours ouvrables (du lundi au samedi), moins un jour
férié s'il en tombe un dans la semaine. L'absence apparaît au planning et le solde de congés du
salarié baisse d'autant.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-06. Trancher une demande d'absence

Objectif : vérifier l'approbation et le refus motivé d'une demande, et le dépassement du solde.

Compte : test.rh.

Données : la demande de « Alpha Diallo (démo) » en attente, à approuver ; une seconde demande, à
refuser, déposée pour l'occasion par test.parc depuis « Mon espace » ; motif « Période de forte
activité (essai) ».

1. Absences et congés, onglet « À valider ». Sur la première demande, cliquez sur « Approuver ».
2. Sur la seconde, cliquez sur « Refuser », saisissez le « Motif du refus », confirmez.
3. Si une demande dépasse le solde acquis, lisez la fenêtre « Solde de congés insuffisant ».

Résultat attendu : la demande approuvée quitte « À valider » et figure au planning ; la demande
refusée porte son motif, lu par le salarié dans « Mon espace ». Au-delà du solde, seul le service RH
peut « Approuver quand même », la fenêtre précisant que le solde deviendra négatif.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-07. Lire le planning et les soldes de congés

Objectif : vérifier le planning du mois et le calcul des soldes.

Compte : test.rh.

Données : aucune.

1. Absences et congés, onglet « Planning du mois ». Passez au « Mois suivant », puis au « Mois
   précédent ».
2. Ouvrez l'onglet « Soldes de congés ».

Résultat attendu : le planning montre les absences par salarié (teinte pâle pour une demande en
attente). Chaque solde vaut le solde de reprise plus les jours acquis (2,5 jours par mois) moins les
jours pris.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-08. Accorder une avance sur salaire

Objectif : vérifier l'enregistrement d'une avance et sa retenue mensuelle sur la paie.

Compte : test.rh.

Données : salarié « Mamady Keïta (démo) » ; avance de 900 000 versée ce jour ; mensualité 300 000 ;
premier mois de retenue : le mois en cours.

1. Ouvrez Personnel > Avances et prêts, puis « Nouvelle avance ou prêt ».
2. Remplissez « Salarié », « Nature » (« Avance sur salaire »), « Date du versement », « Montant
   (GNF) », « Mensualité retenue (GNF) » et « Premier mois de retenue ». Enregistrez.
3. Lisez « Avances et prêts non soldés » et « Retenues mensuelles ».

Résultat attendu : l'avance figure « En cours » avec un reste dû de 900 000 GNF ; la retenue de
300 000 GNF sera faite sur la prochaine paie (RH-09).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-09. Préparer la paie du mois

Objectif : vérifier la préparation des paies du mois, une par société employeur.

Compte : test.rh.

Données : le mois en cours ; toutes les sociétés.

1. Ouvrez Paie > Paie du mois, puis « Préparer la paie de … » (ou « Préparer une paie »).
2. Choisissez le « Mois de paie » et « Toutes les sociétés qui ont du personnel », puis « Calculer les
   bulletins ».
3. Ouvrez la paie d'EGUITRA GROUP SARLU. Lisez « Brut », « Cotisations et impôts », « Net à payer »,
   « Coût employeur » et les anomalies.
4. Repérez le bulletin de « Mamady Keïta (démo) ».

Résultat attendu : une paie par société est préparée (« Paie de … préparée pour 2 sociétés : ouvrez
chacune pour la contrôler et la valider. »), avec un bulletin pour chaque salarié sous contrat ce
mois-là. Le bulletin de Mamady Keïta porte la retenue d'avance de 300 000 GNF.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-10. Saisir les éléments variables d'un bulletin

Objectif : vérifier les heures supplémentaires et les primes du mois, et le recalcul du bulletin.

Compte : test.rh.

Données : salarié « Alpha Diallo (démo) » ; 6 heures supplémentaires ; prime 250 000, motif
« Rotation de nuit (essai) ».

1. Dans la paie de RH-09, sur le bulletin du salarié, cliquez sur « Éléments ».
2. Dans « Éléments du mois, … », choisissez la « Rubrique » des heures supplémentaires, saisissez les
   heures, puis « Ajouter ».
3. Ajoutez la prime avec son « Montant (GNF) » et son « Motif ».
4. Fermez la fenêtre et cliquez sur « Recalculer ».

Résultat attendu : le bulletin se recalcule à chaque élément : heures payées au taux horaire majoré,
prime soumise ou non à la RTS selon sa rubrique. « Recalculer » garde les saisies (« Bulletins
recalculés. »).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-11. Comptabiliser la paie validée

Objectif : vérifier la transmission de l'écriture de paie à la finance et les exports.

Compte : test.rh, après la validation de la paie par la direction (RH-17).

Données : la paie d'EGUITRA GROUP SARLU du mois, validée.

1. Ouvrez la paie validée (« Validée : bulletins figés »).
2. Cliquez sur « Comptabiliser ».
3. Cliquez sur « Excel » et ouvrez le classeur.
4. Ouvrez le « Bulletin » d'un salarié, puis « Imprimer ».

Résultat attendu : « Écriture de paie créée en brouillon dans le journal des salaires : la finance la
relit et la comptabilise. ». Le classeur contient le livre de paie, les virements, la déclaration
CNSS et les impôts sur salaires. Le bulletin imprimé porte le net à payer en chiffres et en lettres.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-12. Rouvrir une paie pour la corriger

Objectif : vérifier la réouverture d'une paie validée ou comptabilisée en brouillon.

Compte : test.rh.

Données : la paie de RH-11, dont l'écriture n'est pas encore comptabilisée par la finance.

1. Ouvrez la paie, puis « Rouvrir ».
2. Modifiez un élément variable, puis « Recalculer ».

Résultat attendu : « Paie rouverte ; l'écriture en brouillon a été supprimée. » (ou « Paie rouverte :
les bulletins sont de nouveau modifiables. » si elle n'était que validée). La paie repasse en
préparation et doit être validée de nouveau par la direction.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-13. Déclarer la sortie d'un salarié

Objectif : vérifier la sortie et le prorata de la dernière paie.

Compte : test.rh.

Données : le dossier de RH-02 ; dernier jour travaillé le 15 du mois prochain ; motif fin de CDD.

1. Ouvrez le dossier, puis « Sortie ».
2. Remplissez « Date de sortie (dernier jour travaillé) » et « Motif », puis « Enregistrer la
   sortie ».
3. Ouvrez Personnel > Salariés et choisissez l'état « Sortis ».

Résultat attendu : le salarié reste dans la liste des sortis ; ses absences futures et ses éléments
cessent à la date de sortie ; sa dernière paie sera calculée au prorata.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-14. Simuler un salaire

Objectif : vérifier le simulateur dans les deux sens.

Compte : test.rh.

Données : salaire de base 4 500 000 ; puis net voulu 3 500 000.

1. Ouvrez Paie > Simulateur de salaire, mode « Du salaire de base au net ». Saisissez le montant.
2. Lisez « Net à payer », « Coût employeur » et le détail (assiette CNSS, CNSS salarié et employeur,
   brut imposable).
3. Passez à « Du net au salaire de base » et saisissez le net voulu.

Résultat attendu : le net et le coût employeur se calculent à la saisie ; le mode inverse propose le
salaire de base qui donne le net voulu. Rien n'est enregistré.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-15. Consulter les paramètres RH

Objectif : vérifier les paramètres de paie et le calendrier, tenus par l'administration et la RH.

Compte : test.admin.

Données : aucune.

1. Ouvrez Administration > Paramètres RH.
2. Parcourez les taux et le barème de la RTS, les rubriques, les types d'absence, les jours fériés et
   les départements.

Résultat attendu : les paramètres communs aux deux sociétés et ceux propres à chacune (numéro
d'employeur CNSS, taxe de formation, journal des salaires) sont lisibles et modifiables.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## B. Direction

### RH-16. Trancher une demande de son équipe

Objectif : vérifier que la direction tranche les demandes de ses collaborateurs directs.

Compte : test.dg.

Données : la demande de permission de « Aïssatou Bah (démo) », en attente.

1. Ouvrez « Mon espace », bloc « Demandes de votre équipe » (ou Absences et congés > « À valider »).
2. Approuvez la demande.

Résultat attendu : la demande est approuvée ; la salariée lit la décision dans son espace.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-17. Valider la paie préparée par la RH

Objectif : vérifier que la paie est validée par la direction, et non par qui l'a préparée.

Compte : test.dg, après RH-09 et RH-10.

Données : la paie d'EGUITRA GROUP SARLU du mois, sans anomalie bloquante.

1. Ouvrez Paie > Paie du mois, puis la paie.
2. Contrôlez les totaux et les anomalies.
3. Cliquez sur « Valider la paie ».
4. test.salarie : ouvrez « Mon espace ».

Résultat attendu : « Paie validée : les bulletins sont figés et consultables par les salariés. ».
Chaque salarié retrouve son bulletin dans « Mes bulletins de paie ». S'il reste une anomalie
bloquante ou si des données ont changé depuis le calcul, « Valider la paie » reste grisé et le dit.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## C. Finance

### RH-18. Comptabiliser l'écriture de paie

Objectif : vérifier que l'écriture de paie arrive en brouillon dans la comptabilité de la bonne
société.

Compte : test.daf, société EGUITRA GROUP SARLU.

Données : l'écriture de paie de RH-11.

1. Ouvrez NIMOVA · Finance > Comptabilité > Journaux et OD.
2. Ouvrez l'écriture de paie du mois, dans le journal des salaires. Vérifiez qu'elle est équilibrée.
3. Validez-la.

Résultat attendu : l'écriture porte les comptes de salaires, de charges sociales, de CNSS, d'impôts
et un compte 422 par salarié, avec l'activité imputée. Une fois validée, la paie ne peut plus être
rouverte par la RH sans que la finance remette l'écriture en brouillon.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## D. Salarié et responsable

### RH-19. Consulter son espace

Objectif : vérifier que le salarié voit son dossier résumé, son solde et ses bulletins, et rien
d'autre.

Compte : test.salarie.

Données : aucune.

1. Ouvrez l'adresse de la recette suivie de /rh et connectez-vous : l'application s'ouvre sur « Mon
   espace » (« Bonjour, Thierno »).
2. Lisez « Solde de congés », « Ancienneté », « Dernier bulletin » et « Mon dossier ».
3. Dans « Mes bulletins de paie », cliquez sur « Ouvrir », puis « Imprimer ».

Résultat attendu : seules les informations de Thierno Baldé (démo) apparaissent. Le bulletin s'ouvre et
s'imprime. « Mon dossier » rappelle de signaler une information à corriger au service RH.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-20. Demander une absence et l'annuler

Objectif : vérifier la demande d'absence en libre-service et son annulation.

Compte : test.salarie.

Données : congé payé de deux jours la semaine prochaine.

1. « Mon espace », « Demander une absence ».
2. Choisissez le « Type d'absence », « Du » et « Au » ; lisez la durée ; écrivez un motif ; « Envoyer
   la demande ».
3. Dans « Mes absences », annulez la demande en attente : lisez la fenêtre, puis « Annuler la
   demande ».

Résultat attendu : la demande part au responsable et au service RH ; elle figure « à valider ».
L'annulation demande confirmation ; ensuite, la demande n'est plus en attente.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-21. Trancher la demande d'un collaborateur

Objectif : vérifier que le responsable hiérarchique tranche les demandes de son équipe depuis son
espace.

Compte : test.salarie (demande), puis test.exploitation (responsable).

Données : une nouvelle demande de test.salarie (comme en RH-20, sans l'annuler).

1. test.exploitation : ouvrez NIMOVA · RH. « Mon espace » montre « Demandes de votre équipe ».
2. Approuvez la demande de Thierno Baldé (démo).
3. Regardez « Absences à venir dans l'équipe ».
4. test.salarie : relisez « Mes absences ».

Résultat attendu : la demande est approuvée par le responsable ; elle apparaît dans les absences à
venir de l'équipe et chez le salarié comme approuvée. Le responsable ne voit pas les salaires de son
équipe.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## E. Refus attendus

### RH-22. Le salarié n'ouvre que son espace

Objectif : vérifier qu'un salarié sans profil ne voit aucun autre dossier.

Compte : test.salarie.

Données : aucune.

1. Regardez le menu : seuls « Mon espace » et « Guide RH » sont proposés.
2. Dans la barre d'adresse, remplacez la fin de l'adresse par /rh/salaries.

Résultat attendu : l'écran revient à « Mon espace » ; aucune liste du personnel, aucun salaire d'un
autre salarié n'apparaît.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-23. Personne ne tranche sa propre absence

Objectif : vérifier qu'aucun compte, direction comprise, n'approuve sa propre demande.

Compte : test.dg (lié au dossier de Mamadou Sylla (démo)).

Données : une demande de congé de test.dg pour lui-même.

1. « Mon espace », « Demander une absence », envoyez la demande.
2. Ouvrez Absences et congés > « À valider » et tentez d'approuver votre propre demande.

Résultat attendu : l'approbation est refusée : « Vous ne pouvez pas trancher votre propre demande
d'absence : un autre responsable s'en charge. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-24. La RH ne valide pas la paie qu'elle a préparée

Objectif : vérifier le principe des quatre yeux sur la paie.

Compte : test.rh, sur la paie préparée en RH-09.

Données : aucune.

1. Ouvrez la paie en préparation.

Résultat attendu : « Valider la paie » n'est pas proposé ; la paie indique « La paie est validée par
la direction, et jamais par une personne qui l'a préparée (création, calcul ou éléments
variables). ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-25. Personne ne se rattache à son propre dossier

Objectif : vérifier qu'un gestionnaire ne lie pas un dossier salarié à son propre compte.

Compte : test.rh.

Données : le dossier de RH-02.

1. Ouvrez le dossier, « Modifier ». Dans « Compte NIMOVA du salarié », choisissez le compte de
   test.rh, puis enregistrez.

Résultat attendu : l'enregistrement est refusé : « Vous ne pouvez pas lier un dossier salarié à votre
propre compte : un autre membre du service RH s'en charge. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-26. La finance n'ouvre pas la RH, la direction ne modifie rien

Objectif : vérifier que les salaires restent réservés à la RH, à la direction et à l'administration,
et que la direction consulte seulement.

Compte : test.daf, puis test.dg.

Données : aucune.

1. test.daf : l'accueil ne montre pas de rayon RH. Remplacez la fin de l'adresse par /rh.
2. test.dg : ouvrez Personnel > Salariés, puis un dossier.

Résultat attendu : test.daf voit la page « Accès non ouvert à votre profil ». test.dg lit les dossiers
mais ne voit ni « Nouveau salarié » ni « Modifier ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## F. Contrôles de saisie et de sécurité

### RH-27. Nombres écrits à la française

Objectif : vérifier que les montants et les heures s'écrivent à la française et qu'une écriture
ambiguë est refusée avec un message.

Compte : test.rh.

Données : salaire « 4 500 000 » puis « 4.500.000 » ; heures supplémentaires « 2,5 ».

1. « Nouveau salarié » : saisissez « 4.500.000 » dans « Salaire de base mensuel (GNF) », puis cliquez
   sur « Créer le dossier ».
2. Remplacez par « 4 500 000 ».
3. Dans les éléments du mois d'un bulletin, saisissez « 2,5 » heures.

Résultat attendu : à l'étape 1, le champ est signalé en rouge (« Nombre illisible : écrivez par
exemple 750 000 ou 2,5. »), la fenêtre indique « Un nombre est illisible : corrigez le champ signalé
en rouge. » et rien n'est créé. « 4 500 000 » et « 2,5 » sont acceptés.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-28. Absences impossibles refusées avec un message

Objectif : vérifier les contrôles des dates d'absence.

Compte : test.rh.

Données : l'absence de RH-05 ; une absence d'un seul dimanche.

1. « Saisir une absence » pour le même salarié, sur des dates qui chevauchent celle de RH-05.
2. « Saisir une absence » sur un dimanche seul.

Résultat attendu : étape 1, « … a déjà une absence demandée ou approuvée sur ces dates. » ; étape 2,
« Aucun jour ouvrable dans cette période (dimanches et jours fériés exclus). ». Rien n'est
enregistré.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-29. Un double clic ne prépare qu'une paie

Objectif : vérifier qu'un double clic n'enregistre qu'une fois.

Compte : test.rh.

Données : un mois sans paie (par exemple le mois suivant) ; une société.

1. « Préparer une paie », choisissez le mois et la société, puis double-cliquez sur « Calculer les
   bulletins ».
2. Revenez à la liste des paies.

Résultat attendu : une seule paie pour ce mois et cette société. Une seconde préparation est refusée :
la paie de ce mois existe déjà.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-30. Confirmation avant d'annuler une absence ou une avance

Objectif : vérifier qu'une annulation demande confirmation, et qu'« Annuler » ne change rien.

Compte : test.rh.

Données : l'absence de RH-05 ; l'avance de RH-08, avant toute retenue.

1. Absences et congés, « Toutes les absences » : sur l'absence, « Annuler l'absence ». Lisez la
   fenêtre, puis fermez-la sans confirmer.
2. Avances et prêts : sur l'avance, annulez-la. Lisez la fenêtre, puis fermez-la sans confirmer.

Résultat attendu : chaque fenêtre nomme le salarié et dit l'effet de l'annulation (pour l'avance :
rien ne sera retenu sur la paie). Fermées sans confirmer, rien ne change.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### RH-31. Message clair en cas de coupure du réseau

Objectif : vérifier qu'une coupure pendant un enregistrement est annoncée en français, sans perdre la
saisie.

Compte : test.salarie.

Données : une demande d'absence.

1. « Demander une absence », remplissez la demande.
2. Coupez le réseau du poste, puis « Envoyer la demande ».
3. Rétablissez le réseau et renvoyez.

Résultat attendu : à l'étape 2, un message en français signale l'échec, sans texte en anglais ni code ;
la fenêtre reste ouverte avec la saisie. À l'étape 3, la demande part une seule fois.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## Synthèse

| Partie {52} | Scénarios {12} | Réussis {12} | Échoués {12} | Non joués {12} |
|---|---|---|---|---|
| A. Ressources humaines | 15 | | | |
| B. Direction | 2 | | | |
| C. Finance | 1 | | | |
| D. Salarié et responsable | 3 | | | |
| E. Refus attendus | 5 | | | |
| F. Contrôles de saisie et de sécurité | 5 | | | |
| Total | 31 | | | |

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
