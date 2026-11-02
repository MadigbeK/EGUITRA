# Cahier de test : Agenda

NIMOVA · Agenda, l'agenda commun des comptes internes d'EGUITRA GROUP SARLU et de MB AxisPro
Consulting : un seul agenda par compte pour les deux sociétés.

Vues et navigation, événements, récurrence, invitations et réponses, disponibilités et recherche de
créneau, absence du bureau, ressources (salles, véhicules, équipements), partages et agendas
d'équipe, délégation à une assistante, échéances des modules, rappels, lien d'abonnement et import,
rendez-vous en ligne ; refus attendus par profil.

| Rubrique {28} | À remplir {72} |
|---|---|
| Module | Agenda (NIMOVA · Agenda) |
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
« (démo) ». Rien de ce que vous y faites ne touche les vrais agendas : vous pouvez tout essayer, y
compris les erreurs.

1. Se connecter. Ouvrez, dans Chrome ou Edge, l'adresse de la recette communiquée par E-VOLUTION XP,
   puis la tuile « Agenda » de l'accueil ; à défaut, l'adresse de la recette suivie de /agenda.
   Identifiant : le compte de test indiqué dans le scénario. Mot de passe : le mot de passe commun
   de la recette, remis par l'administrateur.
2. Société. L'agenda est le même dans les deux sociétés : le choix de la société en haut de l'écran
   ne change pas les événements affichés.
3. Dates. Les données de démonstration commencent le lundi qui suit leur chargement : le « Comité de
   direction (démo) » tombe chaque lundi de 9 h à 10 h 30. Ouvrez la semaine suivante si la semaine
   en cours est vide. Les heures sont celles de Conakry.
4. Courriels. La recette peut ne pas avoir de serveur de courrier : invitations et rappels restent
   alors dans l'application (cloche « Agenda » de l'en-tête). Les scénarios le précisent.
5. Jouer un scénario. Suivez les étapes dans l'ordre, avec les données indiquées. Un scénario à deux
   comptes se joue dans deux navigateurs (Chrome et Edge) ou sur deux postes. Les essais portent la
   mention « (essai) » dans leur titre : supprimez-les à la fin si le scénario le demande.
6. Noter le résultat. Cochez « Réussi » si l'écran correspond au résultat attendu, sinon « Échoué ».
   Dans « Remarques », notez ce qui diffère : l'écran, le message affiché, l'heure.
7. Signaler une anomalie. Menu du compte (rond à vos initiales, en haut à droite) > « Mes demandes »
   > « Nouvelle demande », type « Remarque de recette », application NIMOVA · Agenda, la gravité ;
   titre commençant par le numéro du scénario (par exemple « AGE-24 : aucun créneau proposé ») ;
   description ; « Déposer la demande ». Reportez le numéro reçu (DEM-…) dans les remarques.

## Comptes de test

| Compte {18} | Profil {22} | Périmètre {26} | Rôle dans ce cahier {34} |
|---|---|---|---|
| test.dg | Direction | les deux sociétés | dirigeant : comité, événement privé, délégation |
| test.daf | Finance | les deux sociétés | assistante de direction du DG (délégation), agenda d'équipe |
| test.comptable | Finance | les deux sociétés | invité, partage en modification |
| test.exploitation | Exploitation | EGUITRA GROUP SARLU | tournée avec le véhicule, invité |
| test.achats | Achats | les deux sociétés | organisatrice de la formation commune |
| test.rh | RH | les deux sociétés | invitée, absence du bureau |
| test.admin | Administration | les deux sociétés | ressources, rendez-vous en ligne, délégations des dirigeants |
| test.salarie, test.conducteur, test.porteur, test.auditeur | sans agenda | | refus |

Données fictives utiles : ressources « Salle de réunion du siège (démo) » (10 places) et « Véhicule
de service (démo) » (5 places) ; dans l'agenda de test.dg, « Comité de direction (démo) » (chaque
lundi, 12 fois, avec la salle, test.daf et test.exploitation obligatoires, test.achats facultatif),
« Rendez-vous personnel (démo) » (mardi, privé) et « Déplacement à Kamsar (démo) » (jeudi et
vendredi, absent du bureau) ; dans celui de test.daf, « Point de trésorerie (démo) » (chaque jeudi
à 15 h) ; « Tournée des parcs (démo) » de test.exploitation (mercredi matin, avec le véhicule) ;
« Formation à l'agenda (démo) » de test.achats (vendredi à 10 h) ; agenda d'équipe « Direction
financière (démo) » de test.daf, partagé en modification avec test.comptable, avec « Clôture
mensuelle (démo) » (le dernier vendredi de chaque mois). test.dg partage son agenda en lecture avec
test.daf et lui en a confié la gestion (« Assistante de direction (démo) ») : test.daf reçoit ses
invitations, sans voir ses événements privés.

## A. Prise en main et vues

### AGE-01. Ouvrir son agenda

Objectif : vérifier qu'un compte interne ouvre son agenda et y retrouve ses événements.

Compte : test.daf.

Données : la semaine du « Point de trésorerie (démo) ».

1. Ouvrez NIMOVA · Agenda (tuile « Agenda » de l'accueil).
2. Lisez le panneau de gauche : « Nouvel événement », le mini-calendrier, « Mes agendas »,
   « Agendas délégués », « Agendas partagés », « Ressources », « Échéances des modules ».
3. Avec la flèche « Période suivante », allez à la semaine du « Point de trésorerie (démo) ».

Résultat attendu : l'écran s'ouvre en vue « Semaine », titre « Semaine du … au … ». « Mon agenda »
est coché ; l'agenda de test.dg figure sous « Agendas délégués », « Direction financière (démo) »
sous « Mes agendas ». Le jeudi montre « Point de trésorerie (démo) » de 15 h à 16 h ; une ligne
marque l'heure courante dans la colonne du jour ; les heures hors travail sont grisées.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-02. Changer de vue et de période

Objectif : vérifier les vues et la navigation dans le temps.

Compte : test.daf.

Données : aucune.

1. Cliquez successivement sur « Jour », « Semaine de travail », « Mois », « Agenda » et
   « Planning ».
2. Revenez à « Mois », cliquez sur le numéro d'un jour.
3. Cliquez sur « Aujourd'hui », puis sur un jour du mois suivant dans le mini-calendrier.

Résultat attendu : « Semaine de travail » montre du lundi au vendredi ; « Mois » montre six
semaines ; « Agenda » liste trente jours à partir du jour affiché (« Rien de prévu sur cette
période. » s'il n'y a rien) ; « Planning » montre les disponibilités. Le clic sur un jour du mois
ouvre la vue « Jour » de ce jour. « Aujourd'hui » revient au jour courant ; le mini-calendrier
ouvre le jour choisi.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-03. Se servir du clavier

Objectif : vérifier les raccourcis clavier.

Compte : test.daf.

Données : aucune.

1. Cliquez dans une zone vide de l'écran (hors d'un champ).
2. Appuyez sur 4, puis j, puis k, puis t.
3. Appuyez sur 2, puis n ; fermez la fenêtre avec « Annuler ».
4. Appuyez sur la barre oblique (/).

Résultat attendu : 4 ouvre la vue « Mois », j le mois suivant, k le précédent, t le jour courant ;
2 ouvre la vue « Semaine » ; n ouvre la fenêtre « Nouvel événement » ; la barre oblique place le
curseur dans « Rechercher (/) ». La ligne d'aide sous l'agenda rappelle ces raccourcis.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-04. Rechercher un événement

Objectif : vérifier la recherche dans les agendas que le compte lit.

Compte : test.daf.

Données : « trésorerie », puis « Kamsar », puis « personnel ».

1. Dans « Rechercher (/) », saisissez « trésorerie ».
2. Cliquez sur le résultat.
3. Recherchez « Kamsar », puis « personnel ».

Résultat attendu : « Point de trésorerie (démo) » est proposé avec sa date ; le clic ouvre le jour
et la fiche de l'événement. « Déplacement à Kamsar (démo) » (agenda de test.dg, lu par
délégation) est trouvé. « Rendez-vous personnel (démo) », privé, n'est pas trouvé : « Aucun
événement ne correspond. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-05. Mode nuit et téléphone

Objectif : vérifier le mode nuit et l'affichage sur un écran étroit.

Compte : test.comptable.

Données : un téléphone, ou la fenêtre du navigateur réduite à moins de 768 pixels de large.

1. Cliquez sur l'icône en forme de lune (« Mode nuit »), puis rechargez la page.
2. Cliquez sur l'icône en forme de soleil (« Repasser en clair »).
3. Ouvrez l'agenda sur le téléphone (ou dans la fenêtre réduite).
4. Touchez « Agendas ».

Résultat attendu : le mode nuit assombrit l'agenda et se retrouve après le rechargement ; le
soleil revient au clair. Sur le téléphone, l'agenda s'ouvre en vue « Agenda » (liste), sans
défilement de côté ; « Agendas » ouvre le panneau des agendas dans une fenêtre.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## B. Événements

### AGE-06. Créer un événement d'un glissement

Objectif : vérifier la création rapide sur la grille.

Compte : test.comptable.

Données : titre « Revue des immobilisations (essai) » ; mardi prochain de 14 h à 15 h 30.

1. Vue « Semaine », semaine de mardi prochain.
2. Dans la colonne du mardi, glissez la souris de 14 h à 15 h 30, puis relâchez.
3. Saisissez le titre, puis « Créer l'événement ».

Résultat attendu : la fenêtre « Nouvel événement » s'ouvre avec mardi, 14:00 et 15:30 déjà
remplis. Après la création, « Événement créé. » s'affiche et le bloc apparaît dans la grille, à la
couleur de « Mon agenda ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-07. Créer un événement complet

Objectif : vérifier toutes les rubriques du formulaire.

Compte : test.comptable.

Données : titre « Rapprochement bancaire (essai) » ; mercredi prochain de 10 h à 11 h ; lieu
« Siège, bureau 4 » ; lien de visioconférence « https://visio.example.org/rapprochement » ;
description « Relevés de septembre et d'octobre. » ; catégorie « Réunion » ; rappel « 30 minutes
avant », « Dans l'application ».

1. « Nouvel événement ». Remplissez « Titre », « Début », « Fin », « Lieu », « Lien de
   visioconférence » et « Description ».
2. Cliquez sur la catégorie « Réunion ».
3. Dans « Rappels », décochez « Mes rappels par défaut », « Ajouter un rappel », choisissez le
   délai et le canal.
4. « Créer l'événement », puis cliquez sur l'événement dans la grille.

Résultat attendu : la fiche montre la date et l'horaire, le lieu, « Rejoindre la visioconférence »,
la description, les badges « Publique » et « Occupé », la catégorie « Réunion », et « Créé par Test
- Comptable ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-08. Une journée entière sur plusieurs jours

Objectif : vérifier un événement de plusieurs jours sans horaire.

Compte : test.comptable.

Données : titre « Inventaire physique (essai) » ; du lundi au mercredi de la semaine suivante ;
« Afficher comme » : « Absent du bureau ».

1. « Nouvel événement », cochez « Journée entière ».
2. Choisissez « Premier jour » et « Dernier jour », puis « Afficher comme ».
3. « Créer l'événement » ; regardez la semaine, puis le mois.

Résultat attendu : l'événement occupe la ligne « Journée » en haut de la grille, du lundi au
mercredi, sans horaire ; il figure aussi sur ces trois jours dans la vue « Mois ». La fiche indique
« Absent du bureau ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-09. Déplacer et allonger à la souris

Objectif : vérifier le glisser-déposer d'un événement simple.

Compte : test.comptable.

Données : « Revue des immobilisations (essai) » d'AGE-06.

1. Faites glisser l'événement du mardi au jeudi, à 9 h.
2. Tirez le bas de l'événement jusqu'à 11 h.
3. Rechargez la page.

Résultat attendu : à chaque geste, un message confirme le déplacement (« … déplacé au jeudi …,
09:00. »). Après le rechargement, l'événement est le jeudi de 9 h à 11 h.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-10. Un événement privé reste « Occupé » pour les autres

Objectif : vérifier qu'un événement privé ne montre que l'occupation, même à un collègue qui lit
l'agenda.

Compte : test.dg, puis test.daf.

Données : « Rendez-vous personnel (démo) » du mardi.

1. test.dg : ouvrez l'événement : lisez son titre et le badge « Privée ».
2. test.daf : cochez l'agenda de test.dg (« Agendas délégués ») et allez au même mardi.
3. test.daf : cliquez sur le bloc du mardi midi.

Résultat attendu : test.dg voit tout. test.daf voit un bloc « Occupé » sans titre ; la fiche
indique « Occupation sans détail : l'agenda ne vous est partagé que pour les disponibilités, ou
l'événement est privé. ». Aucun titre, lieu ni description n'apparaît.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-11. Un événement confidentiel ne montre que son titre

Objectif : vérifier la visibilité « Confidentielle ».

Compte : test.daf, puis test.comptable.

Données : dans « Direction financière (démo) », événement « Préparation du conseil (essai) »,
vendredi prochain de 11 h à 12 h, visibilité « Confidentielle », description « Points sensibles. ».

1. test.daf : créez l'événement dans l'agenda « Direction financière (démo) » (champ « Agenda »),
   visibilité « Confidentielle ».
2. test.comptable : cochez « Direction financière (démo) » et ouvrez l'événement.

Résultat attendu : test.comptable voit le titre et l'horaire ; la fiche indique « Événement
confidentiel : seul le titre vous est montré. » ; la description n'apparaît pas.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-12. Joindre une pièce et exporter l'événement

Objectif : vérifier les pièces jointes et l'export d'un événement.

Compte : test.comptable.

Données : « Rapprochement bancaire (essai) » d'AGE-07 ; un fichier PDF quelconque.

1. Ouvrez l'événement. Dans « Pièces jointes », « Joindre un fichier » : choisissez le PDF.
2. Cliquez sur le nom de la pièce, puis retirez-la (icône corbeille).
3. Cliquez sur « Exporter (.ics) » et ouvrez le fichier téléchargé avec Outlook.

Résultat attendu : « Pièce jointe ajoutée. », la pièce se télécharge, puis « Pièce retirée. ».
Outlook ouvre l'événement avec son titre, sa date, son horaire et son lieu.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-13. Supprimer un événement : les participants sont prévenus

Objectif : vérifier qu'une suppression prévient les invités.

Compte : test.comptable, puis test.rh.

Données : « Point paie (essai) », lundi prochain de 16 h à 16 h 30, avec test.rh invitée.

1. test.comptable : créez l'événement et invitez test.rh (« Inviter un participant »).
2. test.comptable : ouvrez l'événement, « Supprimer », lisez la fenêtre « Supprimer
   l'événement », puis « Supprimer ».
3. test.rh : ouvrez la cloche « Agenda » de l'en-tête.

Résultat attendu : la fenêtre indique « Les participants sont prévenus de l'annulation. » ; puis
« Événement supprimé. ». test.rh a deux notifications : l'invitation, puis l'annulation ; l'événement
a disparu de son agenda.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## C. Récurrence

### AGE-14. Une série hebdomadaire sur plusieurs jours

Objectif : vérifier une récurrence hebdomadaire avec un nombre d'occurrences.

Compte : test.exploitation.

Données : « Point sécurité (essai) », 7 h 30 à 7 h 45, lundi et mercredi, 6 fois, à partir de
lundi prochain.

1. « Nouvel événement », titre et horaire du lundi prochain.
2. « Répétition » : « Chaque semaine » ; cliquez sur « lu » et « me » ; « Fin » : « Après… »,
   « Occurrences » : 6.
3. « Créer l'événement », puis parcourez les trois semaines suivantes.

Résultat attendu : six occurrences, lundi et mercredi, sur trois semaines. La fiche indique
« Chaque semaine le lundi et le mercredi, 6 fois ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-15. Une série mensuelle par rang

Objectif : vérifier la récurrence « le dernier vendredi du mois ».

Compte : test.daf, puis test.comptable.

Données : « Clôture mensuelle (démo) » de l'agenda « Direction financière (démo) ».

1. test.daf : vue « Mois » ; cochez « Direction financière (démo) » ; ouvrez « Clôture mensuelle
   (démo) ».
2. Avancez de trois mois.
3. test.comptable : cochez le même agenda et vérifiez le mois en cours.

Résultat attendu : la fiche indique « Chaque mois, le dernier vendredi, 6 fois » ; l'événement
tombe chaque mois sur le dernier vendredi, en journée entière. test.comptable le voit aussi.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-16. Modifier une seule occurrence

Objectif : vérifier qu'une occurrence se modifie sans toucher la série.

Compte : test.exploitation.

Données : « Point sécurité (essai) » d'AGE-14, deuxième occurrence.

1. Ouvrez la deuxième occurrence, « Modifier ».
2. Dans « Événement récurrent : appliquer à », choisissez « cette occurrence » ; mettez 8 h à
   8 h 15, puis « Enregistrer ».
3. Ouvrez la première et la troisième occurrence.

Résultat attendu : seule la deuxième occurrence est à 8 h ; sa fiche porte « (occurrence
modifiée) ». Les autres restent à 7 h 30.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-17. Modifier celle-ci et les suivantes

Objectif : vérifier la coupure d'une série à partir d'une occurrence.

Compte : test.exploitation.

Données : « Point sécurité (essai) », quatrième occurrence ; nouveau lieu « Parc de Matoto ».

1. Ouvrez la quatrième occurrence, « Modifier », « celle-ci et les suivantes ».
2. Lieu « Parc de Matoto », puis « Enregistrer ».
3. Ouvrez la troisième, puis la cinquième occurrence.

Résultat attendu : la troisième n'a pas de lieu ; la quatrième, la cinquième et la sixième ont
« Parc de Matoto ». Le total reste de six occurrences.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-18. Déplacer une occurrence à la souris, supprimer la série

Objectif : vérifier le choix de la portée au glisser-déposer et la suppression d'une série.

Compte : test.exploitation.

Données : « Point sécurité (essai) ».

1. Faites glisser la cinquième occurrence d'une heure plus tard. Lisez la fenêtre « Déplacer un
   événement récurrent », puis « Cette occurrence ».
2. Ouvrez la première occurrence, « Supprimer », choisissez « Toute la série », puis
   « Supprimer ».

Résultat attendu : la fenêtre propose « Annuler », « Toute la série », « Celle-ci et les
suivantes » et « Cette occurrence » ; seule la cinquième est déplacée. Après la suppression,
aucune occurrence ne reste, ni modifiée ni déplacée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## D. Invitations et réponses

### AGE-19. Inviter des collègues et voir leurs disponibilités

Objectif : vérifier l'invitation, les participants obligatoires ou facultatifs et l'alerte de
conflit.

Compte : test.achats.

Données : « Comité achats (essai) », lundi prochain de 9 h 30 à 10 h 30 ; test.dg obligatoire,
test.rh facultative.

1. « Nouvel événement », titre et horaire.
2. « Inviter un participant » : saisissez « dg », choisissez Test - Direction générale ; puis
   « rh », Test - Gestionnaire RH ; décochez « Obligatoire » pour test.rh.
3. Lisez la ligne sous chaque nom, puis « Créer l'événement ».

Résultat attendu : sous test.dg s'affiche « Occupé » (le comité de direction) ; sous test.rh,
« Libre ». Après la création, le message signale « Test - Direction générale est occupé
… » sans bloquer la création. La fiche liste les deux participants, test.rh « (facultatif) », tous
deux « Sans réponse ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-20. Répondre à une invitation avec un commentaire

Objectif : vérifier la réponse d'un invité et sa remontée à l'organisateur.

Compte : test.rh, puis test.achats.

Données : « Comité achats (essai) » d'AGE-19 ; commentaire « Je rejoins à 10 h. ».

1. test.rh : ouvrez la cloche « Agenda » ; lisez la notification, cliquez dessus.
2. Saisissez le commentaire, puis « Provisoire ».
3. test.achats : ouvrez l'événement.

Résultat attendu : la cloche annonce l'invitation (« Une invitation attend votre réponse. ») ; le
clic ouvre l'événement. « Réponse enregistrée. » ; l'événement apparaît en provisoire chez test.rh.
test.achats voit test.rh « Provisoire » avec « « Je rejoins à 10 h. » » et reçoit une notification
de la réponse.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-21. Proposer un autre horaire

Objectif : vérifier la proposition d'horaire et son acceptation par l'organisateur.

Compte : test.dg, puis test.achats.

Données : « Comité achats (essai) » ; proposition lundi prochain de 11 h à 12 h.

1. test.dg : ouvrez l'événement, « Proposer un autre horaire » ; « Début proposé », « Fin
   proposée », puis « Envoyer la proposition ».
2. test.achats : ouvrez l'événement ; lisez la ligne de test.dg, puis « Retenir ».

Résultat attendu : « Proposition envoyée à l'organisateur. » ; test.achats est notifié et voit
« Propose … 11:00 - 12:00 ». Après « Retenir », « Horaire retenu. » : l'événement passe de 11 h à
12 h, et les participants sont prévenus du changement.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-22. Inviter une personne extérieure

Objectif : vérifier l'invitation par adresse électronique et la réponse notée par l'organisateur.

Compte : test.achats.

Données : « Visite fournisseur (essai) », jeudi prochain de 15 h à 16 h ; adresse
« contact@fournisseur-essai.gn ».

1. « Nouvel événement » ; dans « Inviter un participant », saisissez l'adresse et choisissez
   « Adresse électronique ».
2. « Créer l'événement » ; lisez le message.
3. Ouvrez l'événement ; dans la liste de réponse de l'invité, choisissez « Accepté ».

Résultat attendu : l'invité porte « Invitation par courriel ». Avec un serveur de courrier, le
message annonce « 1 courriel(s) d'invitation envoyé(s). » ; sans serveur, « Aucun serveur de
courrier : les invitations restent dans l'application. ». « Réponse notée. » ; l'invité passe à
« Accepté ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## E. Disponibilités, créneaux et absence

### AGE-23. Régler ses heures de travail

Objectif : vérifier les heures de travail et leur affichage.

Compte : test.rh.

Données : lundi à vendredi, 8 h à 12 h et 13 h à 16 h 30 ; samedi décoché.

1. Réglages > Réglages de l'agenda, carte « Heures de travail et rappels ».
2. Pour le lundi, « Avec une pause » ; mettez 16:30 en fin d'après-midi ; faites de même pour les
   autres jours. Laissez le samedi et le dimanche décochés.
3. « Enregistrer », puis ouvrez Mon agenda en vue « Semaine de travail ».

Résultat attendu : « Réglages enregistrés. ». La grille grise la pause de midi et la fin de journée
après 16 h 30.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-24. Trouver un créneau commun

Objectif : vérifier la recherche du créneau qui convient à tous.

Compte : test.daf.

Données : « Arbitrage budgétaire (essai) », une heure ; test.dg et test.exploitation obligatoires ;
la salle de réunion.

1. « Nouvel événement », titre ; durée d'une heure (début et fin).
2. Invitez test.dg et test.exploitation ; cochez « Salle de réunion du siège (démo) ».
3. « Trouver un créneau » ; cliquez sur le premier créneau proposé.
4. « Créer l'événement ».

Résultat attendu : une liste de créneaux est proposée dans les heures de travail de chacun, hors
du comité du lundi et du déplacement à Kamsar, chacun avec qui est disponible. Le clic remplit le
début et la fin ; l'événement est créé sans conflit, la salle réservée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-25. Lire le planning d'équipe

Objectif : vérifier la vue des disponibilités des collègues et des ressources.

Compte : test.daf.

Données : test.dg, test.exploitation, test.comptable ; la semaine des données de démonstration.

1. Équipe > Planning d'équipe.
2. Dans « Ajouter un collègue… », ajoutez les trois comptes.
3. Allez au lundi du comité, puis au mercredi de la tournée.

Résultat attendu : une ligne par personne et par ressource, les plages occupées en couleur
(« Occupé ») sans titre pour les agendas non partagés en lecture. Le lundi matin, test.dg et la
salle sont occupés ; le mercredi matin, test.exploitation et le véhicule. Le choix des collègues
est gardé au rechargement.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-26. Ne pas communiquer ses disponibilités

Objectif : vérifier qu'un compte peut masquer ses disponibilités.

Compte : test.comptable, puis test.daf.

Données : aucune.

1. test.comptable : Réglages de l'agenda, décochez « Mes disponibilités (« Occupé », sans détail)
   sont visibles de mes collègues », « Enregistrer ».
2. test.daf : Planning d'équipe, ligne de test.comptable ; puis « Nouvel événement », invitez
   test.comptable.
3. test.comptable : recochez la case et enregistrez.

Résultat attendu : pour test.daf, la ligne de test.comptable indique « Disponibilités non
communiquées » au planning comme sous son nom dans l'invitation. Après l'étape 3, ses plages
occupées réapparaissent.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-27. Absence du bureau avec refus d'office

Objectif : vérifier l'absence programmée et le refus automatique des invitations.

Compte : test.rh, puis test.achats.

Données : absence du lundi au vendredi de la semaine suivante ; message « En mission à Boké, de
retour lundi. » ; invitation « Point recrutement (essai) », mercredi de cette semaine-là à 10 h.

1. test.rh : Réglages de l'agenda, « Absence du bureau » : cochez « Je suis absent du bureau »,
   « Du », « Jusqu'au », le message, cochez « Refuser d'office les invitations qui tombent pendant
   l'absence », « Enregistrer ».
2. test.achats : créez l'événement et invitez test.rh.
3. test.achats : ouvrez l'événement ; lisez la cloche.
4. test.rh : décochez « Je suis absent du bureau », « Enregistrer ».

Résultat attendu : « Absence enregistrée : vos invitants en sont prévenus. ». À l'invitation,
test.rh est indiquée « Absent du bureau : En mission à Boké… » ; après la création, elle est
« Refusé » avec « Refus d'office : absent du bureau », et test.achats reçoit « Test - Gestionnaire RH
est absent du bureau ». « Absence levée. » à l'étape 4.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## F. Ressources

### AGE-28. Déclarer une salle

Objectif : vérifier la déclaration d'une ressource par l'administration.

Compte : test.admin.

Données : « Salle du conseil (essai) », « Salle de réunion », capacité 4, emplacement « Siège, 2e
étage ».

1. Administration > Ressources, carte « Nouvelle ressource ».
2. « Nom », « Nature », « Capacité », « Emplacement », puis « Créer ».
3. Ouvrez Mon agenda : panneau « Ressources ».

Résultat attendu : « Ressource créée. » ; la salle figure dans « Ressources réservables » avec sa
nature, ses places et son emplacement, et dans le panneau « Ressources » de l'agenda de chacun.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-29. Une ressource ne se réserve pas deux fois

Objectif : vérifier le refus d'une double réservation et la proposition du créneau libre le plus
proche.

Compte : test.comptable.

Données : « Réunion fournisseurs (essai) », lundi du comité de 9 h 30 à 10 h 30, avec la « Salle de
réunion du siège (démo) ».

1. « Nouvel événement », titre et horaire ; cochez la salle ; lisez sa ligne.
2. « Créer l'événement » ; lisez le message.
3. Mettez l'horaire proposé par le message, puis « Créer l'événement ».

Résultat attendu : la salle est marquée « Déjà réservée » ; l'enregistrement est refusé :
« Salle de réunion du siège (démo) est déjà réservée … Créneau libre le plus proche : … ». Rien
n'est créé. Au créneau proposé, l'événement est créé avec la salle.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-30. Capacité d'une ressource

Objectif : vérifier qu'une salle trop petite est refusée.

Compte : test.comptable.

Données : « Salle du conseil (essai) » d'AGE-28 (4 places) ; « Atelier de clôture (essai) », vendredi
prochain à 14 h, avec quatre invités (test.daf, test.dg, test.achats, test.rh).

1. Créez l'événement avec les quatre invités et la salle.
2. Retirez un invité, puis « Créer l'événement ».

Résultat attendu : à l'étape 1, « Salle du conseil (essai) accueille 4 personnes ; l'événement en
compte 5. Choisissez une autre ressource. ». À l'étape 2, l'événement est créé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-31. Retirer une ressource

Objectif : vérifier qu'une ressource retirée n'est plus réservable.

Compte : test.admin, puis test.comptable.

Données : « Salle du conseil (essai) ».

1. test.admin : Ressources, « Retirer » sur la salle.
2. test.comptable : « Nouvel événement », regardez la liste « Ressources ».

Résultat attendu : la salle porte « Retirée » chez test.admin ; elle n'est plus proposée aux
autres comptes. Les événements déjà réservés la gardent dans leur fiche.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## G. Partages et agendas d'équipe

### AGE-32. Créer un agenda d'équipe et le partager

Objectif : vérifier l'agenda d'équipe, sa couleur et les trois niveaux de partage.

Compte : test.exploitation, puis test.daf.

Données : agenda « Maintenance des citernes (essai) » ; partagé avec test.daf.

1. test.exploitation : Réglages de l'agenda, « Mes agendas et leurs partages » : « Nouvel agenda
   d'équipe ou de projet », nom, « Créer » ; choisissez une couleur.
2. « Partager avec… » : test.daf ; lisez le niveau ; passez-le à « Lecture des détails ».
3. Créez dans cet agenda « Vidange citerne 12 (essai) », mardi prochain à 8 h.
4. test.daf : cochez l'agenda dans « Agendas partagés », ouvrez l'événement.

Résultat attendu : « Agenda créé. » ; le partage commence à « Disponibilités seulement »
(« Agenda partagé avec … (disponibilités) : changez le niveau au besoin. »), puis « Partage
modifié. ». test.daf est notifiée du partage, voit l'agenda à la couleur choisie, avec le niveau
« Lecture », et lit le détail de l'événement sans pouvoir le modifier.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-33. Un partage en modification n'ajoute que des événements publics

Objectif : vérifier les droits d'un partage en modification.

Compte : test.comptable.

Données : agenda « Direction financière (démo) » (partagé en modification) ; « Relance des
impayés (essai) », jeudi prochain à 11 h.

1. « Nouvel événement », « Agenda » : « Direction financière (démo) (partage) » ; visibilité
   « Privée » ; « Créer l'événement ».
2. Repassez en « Publique », « Créer l'événement ».
3. Ouvrez l'événement, « Modifier », changez l'heure, « Enregistrer ».

Résultat attendu : à l'étape 1, « Un partage en modification n'ajoute que des événements
publics. ». À l'étape 2, l'événement est créé ; la modification est acceptée. test.daf, propriétaire,
le voit dans son agenda d'équipe.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-34. Retirer un partage

Objectif : vérifier qu'un partage retiré coupe l'accès aussitôt.

Compte : test.exploitation, puis test.daf.

Données : « Maintenance des citernes (essai) » d'AGE-32.

1. test.exploitation : Réglages, retirez le partage avec test.daf (icône corbeille).
2. test.daf : rechargez l'agenda ; recherchez « Vidange ».
3. test.exploitation : supprimez l'agenda d'essai.

Résultat attendu : « Partage retiré. ». L'agenda disparaît du panneau de test.daf ; la recherche ne
trouve plus l'événement. L'agenda d'essai est supprimé (« Agenda supprimé. »).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## H. Délégation

### AGE-35. L'assistante crée un événement pour le DG

Objectif : vérifier qu'une déléguée agit dans l'agenda du dirigeant, au nom de celui-ci, avec la
trace « par … pour le compte de … ».

Compte : test.daf, puis test.dg.

Données : « Audience ministère (essai) », mercredi prochain de 15 h à 16 h, dans l'agenda de test.dg.

1. test.daf : « Nouvel événement », « Agenda » : l'agenda de test.dg « (délégation) ».
2. Titre, horaire, « Créer l'événement » ; ouvrez la fiche.
3. test.dg : ouvrez Mon agenda et l'événement.

Résultat attendu : l'événement est dans l'agenda de test.dg, organisé par test.dg ; la fiche
indique « Créé par Test - Responsable financier pour le compte de Test - Direction générale ».
L'action figure dans le journal de l'agenda de test.dg (Réglages, « Journal de mon agenda »).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-36. Répondre pour le compte du dirigeant

Objectif : vérifier qu'une déléguée qui reçoit les invitations répond au nom du dirigeant.

Compte : test.achats, puis test.daf, puis test.dg.

Données : « Comité achats (essai) » d'AGE-19 (test.dg invité).

1. test.daf : ouvrez la cloche, puis l'invitation reçue pour test.dg.
2. Dans « Votre réponse », choisissez « Pour Test - Direction générale », « Accepter ».
3. test.achats : ouvrez l'événement. test.dg : ouvrez-le aussi.

Résultat attendu : la cloche de test.daf montre l'invitation de test.dg. Après la réponse, test.dg
est « Accepté », avec « Réponse de Test - Responsable financier ». test.dg voit la même réponse.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-37. Ouvrir les événements privés à la déléguée

Objectif : vérifier les options d'une délégation.

Compte : test.dg, puis test.daf.

Données : « Rendez-vous personnel (démo) ».

1. test.dg : Réglages de l'agenda, « Délégations » ; sur la ligne de test.daf, cochez « Voit les
   événements privés ».
2. test.daf : ouvrez « Rendez-vous personnel (démo) ».
3. test.dg : décochez l'option.

Résultat attendu : « Option enregistrée. ». test.daf lit désormais le titre et le détail de
l'événement privé ; après l'étape 3, elle ne voit plus que « Occupé ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-38. L'administration pose une délégation pour un dirigeant

Objectif : vérifier que la direction ou l'administration confie l'agenda d'un dirigeant, et que
celui-ci en est prévenu.

Compte : test.admin, puis test.dg, puis test.comptable.

Données : dirigeant test.dg ; délégué test.comptable ; motif « Intérim de l'assistante (essai) ».

1. test.admin : Réglages de l'agenda, « Délégations des dirigeants (direction et
   administration) » : « Dirigeant » : Test - Direction générale ; « Motif » ; « Délégué… » :
   test.comptable.
2. test.dg : ouvrez la cloche ; puis Réglages, « Délégations ».
3. test.comptable : ouvrez Mon agenda.

Résultat attendu : « Délégation posée : … gère l'agenda. Le dirigeant en est prévenu ; elle est
inscrite dans la piste d'audit. ». test.dg est notifié (« Test - Administrateur a confié la gestion
de votre agenda à Test - Comptable »), et la ligne indique « Posée par Test - Administrateur :
Intérim de l'assistante (essai) ». test.comptable voit l'agenda de test.dg sous « Agendas
délégués ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-39. Retirer une délégation ou y renoncer

Objectif : vérifier le retrait par le dirigeant et la renonciation par le délégué.

Compte : test.comptable, puis test.dg.

Données : la délégation d'AGE-38.

1. test.comptable : Réglages, « Agendas que je gère » : « Y renoncer » sur l'agenda de test.dg.
2. test.dg : Réglages, « Délégations » ; lisez la liste ; « Journal de mon agenda ».

Résultat attendu : « Vous avez renoncé à cette délégation. » ; l'agenda de test.dg quitte le
panneau de test.comptable. test.dg ne voit plus que test.daf comme déléguée ; le journal montre la
pose puis le retrait. Le bouton « Retirer » de test.dg aurait le même effet.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## I. Échéances des modules et rappels

### AGE-40. Afficher les échéances des modules

Objectif : vérifier que les échéances des autres applications s'affichent dans l'agenda.

Compte : test.daf.

Données : le mois en cours et le suivant.

1. Vue « Mois ». Dans « Échéances des modules », cochez « Déclarations fiscales », « Clôtures de
   période » et « À valider ».
2. Cliquez sur une échéance.
3. Décochez « Déclarations fiscales ».

Résultat attendu : les échéances s'affichent en journée entière, bordées en pointillés à la
couleur de leur source (déclaration fiscale le 15 du mois suivant la période, par exemple) ; le
clic ouvre la fiche concernée dans son application. Les cases restent cochées d'une connexion à
l'autre ; décocher retire la source de l'affichage.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-41. Les échéances suivent les droits de chacun

Objectif : vérifier qu'un compte ne voit que les échéances de ses applications.

Compte : test.exploitation, puis test.rh.

Données : aucune.

1. test.exploitation : lisez la liste « Échéances des modules ».
2. test.rh : lisez la même liste ; cochez « Absences de l'équipe ».

Résultat attendu : test.exploitation n'a ni « Déclarations fiscales » ni « Clôtures de période »,
ni « Absences de l'équipe ». test.rh a « Mes absences » et « Absences de l'équipe » ; les congés
validés s'affichent en journée entière.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-42. Recevoir un rappel

Objectif : vérifier les rappels dans l'application et les rappels par défaut.

Compte : test.comptable.

Données : « Appel banque (essai) », dans 20 minutes, rappel « 15 minutes avant » « Dans
l'application » ; puis des rappels par défaut de 10 minutes.

1. Créez l'événement avec son rappel.
2. Attendez l'heure du rappel (cinq minutes de marge), puis ouvrez la cloche.
3. Réglages, « Rappels par défaut » : un rappel de 10 minutes ; cochez « Récapitulatif de ma
   journée chaque matin, à » 7 h ; « Enregistrer ».
4. « Nouvel événement » : lisez la case « Mes rappels par défaut ».

Résultat attendu : la cloche montre le rappel de « Appel banque (essai) », une seule fois. La case
de l'étape 4 indique « Mes rappels par défaut (10 minutes avant) ». Avec un serveur de courrier,
le récapitulatif de la journée arrive le lendemain vers 7 h.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## J. Abonnement, import et export

### AGE-43. S'abonner à son agenda depuis Outlook

Objectif : vérifier le lien d'abonnement en lecture seule.

Compte : test.dg.

Données : Outlook (ou Google Agenda, ajout d'un agenda par son adresse).

1. Réglages, « Lien d'abonnement (Outlook, Google Agenda) » : laissez cochée « Événements privés
   en « Occupé » dans l'abonnement », puis « Créer le lien ».
2. « Copier le lien ». Dans Outlook, « Ajouter un calendrier depuis Internet », collez le lien.
3. Rechargez la page des réglages.

Résultat attendu : « Nouveau lien créé : copiez-le maintenant, il ne sera plus affiché. ». Outlook
affiche le comité, le déplacement et l'audience ; « Rendez-vous personnel (démo) » y figure en
« Occupé », sans titre ; aucun participant n'apparaît. Après rechargement, le lien n'est plus
affiché en entier.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-44. Révoquer le lien d'abonnement

Objectif : vérifier qu'un lien révoqué ne sert plus.

Compte : test.dg.

Données : le lien d'AGE-43.

1. Réglages, « Révoquer ».
2. Collez l'ancien lien dans la barre d'adresse du navigateur.
3. « Créer le lien » de nouveau.

Résultat attendu : « Lien révoqué : il ne sert plus. ». L'ancien lien donne « Abonnement
introuvable. ». Le nouveau lien est différent du premier.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-45. Importer un fichier .ics

Objectif : vérifier l'import d'un agenda extérieur, sans doublon.

Compte : test.comptable.

Données : un fichier .ics exporté d'Outlook ou de Google Agenda (deux ou trois événements), ou celui
d'AGE-12.

1. Réglages, « Importer un fichier .ics » ; « Dans l'agenda » : Mon agenda ; « Choisir le fichier ».
2. Lisez le bilan ; ouvrez un événement importé.
3. Importez le même fichier une seconde fois.

Résultat attendu : « Fichier importé. » et le bilan « … événement(s) créé(s), 0 mis à jour » ;
les événements apparaissent dans l'agenda, sans participant invité. Le second import annonce
« 0 événement(s) créé(s), … mis à jour » : aucun doublon.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## K. Rendez-vous en ligne

### AGE-46. Préparer un type de rendez-vous

Objectif : vérifier qu'un type de rendez-vous se prépare même quand le service est fermé.

Compte : test.achats.

Données : « Entretien fournisseur (essai) », 30 minutes, domaines autorisés « fournisseur.gn »,
question « Objet de la demande ».

1. Réglages, « Rendez-vous en ligne » : lisez l'encadré.
2. « Intitulé », « Durée (minutes) », « Domaines autorisés », « Question posée », « Créer ».

Résultat attendu : tant que l'administration n'a pas ouvert le service, l'encadré indique « La
prise de rendez-vous en ligne n'est pas ouverte sur la plateforme… ». « Type de rendez-vous créé
(non publié). » ; il ne peut pas être publié.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-47. Prendre rendez-vous de l'extérieur

Objectif : vérifier la prise de rendez-vous par une personne extérieure et sa confirmation par
courriel.

Compte : test.admin, test.achats, puis un navigateur sans session (fenêtre privée).

Données : le type d'AGE-46 ; adresse de la recette ; une boîte aux lettres d'un domaine autorisé.
À jouer seulement si la recette a un serveur de courrier.

1. test.admin : Ressources, « Prise de rendez-vous en ligne » : « Adresse publique du site » (celle
   de la recette en https), « Enregistrer l'adresse », « Ouvrir ».
2. test.achats : cochez « Publié » sur le type, « Copier le lien ».
3. Fenêtre privée : ouvrez le lien ; choisissez un créneau ; nom ; d'abord une adresse d'un autre
   domaine, puis celle du domaine autorisé ; « Demander ce rendez-vous ».
4. Ouvrez le courriel reçu et son lien ; « Confirmer le rendez-vous ».
5. test.achats : ouvrez Mon agenda. test.admin : « Fermer » la prise de rendez-vous.

Résultat attendu : la page publique montre le type, la durée et les créneaux libres seulement. Une
adresse d'un autre domaine est refusée. « Vérifiez votre messagerie » ; rien n'est confirmé à
l'ouverture du lien, seulement au clic : « Rendez-vous confirmé ». L'événement entre dans l'agenda
de test.achats, qui est notifiée. Fermée, la page publique répond « Page introuvable. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## L. Refus attendus

### AGE-48. Les comptes sans agenda n'entrent pas

Objectif : vérifier que salarié seul, conducteur, porteur de projet et auditeur n'ont pas d'agenda.

Compte : test.salarie, test.conducteur, test.porteur, test.auditeur.

Données : aucune.

1. Avec chacun des comptes, ouvrez l'adresse de la recette suivie de /agenda et connectez-vous.
2. test.dg : « Nouvel événement », « Inviter un participant » : saisissez « Salarié ».

Résultat attendu : chaque connexion est refusée : « Votre profil ne donne pas accès à cette
application. ». Aucune tuile « Agenda » n'apparaît à leur accueil. Ces comptes ne sont pas proposés
comme participants internes.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-49. Les ressources sont réservées à l'administration

Objectif : vérifier qu'un autre profil ne gère pas les ressources.

Compte : test.dg.

Données : aucune.

1. Cherchez « Administration > Ressources » dans le menu de l'agenda.
2. Ouvrez l'adresse de la recette suivie de /agenda/ressources.

Résultat attendu : le menu « Administration » n'apparaît pas ; l'adresse ramène à l'agenda. test.dg
réserve les ressources mais ne les crée, ne les modifie ni ne les retire.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-50. L'administrateur ne lit pas les agendas des autres

Objectif : vérifier que l'administration n'a pas de lecture des agendas des collègues.

Compte : test.admin.

Données : les événements de démonstration de test.dg.

1. Planning d'équipe : ajoutez test.dg ; allez au lundi du comité.
2. Recherchez « Comité de direction ».
3. Ouvrez l'adresse de la recette suivie de /agenda?evenement= et un numéro quelconque.

Résultat attendu : le planning ne montre que « Occupé », sans titre. La recherche ne trouve rien.
Aucun événement d'un autre compte ne s'ouvre en détail (au mieux « Occupé », sinon un message
« introuvable »).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-51. Nul ne se délègue l'agenda d'un autre

Objectif : vérifier les refus de délégation.

Compte : test.admin, puis test.daf.

Données : dirigeant test.dg.

1. test.admin : « Délégations des dirigeants », « Dirigeant » : test.dg ; dans « Délégué… »,
   saisissez « Administrateur ».
2. test.daf : Réglages, « Délégations » : cherchez la carte « Délégations des dirigeants ».
3. test.daf : dans « Confier mon agenda à… », choisissez test.salarie (si proposé) ou saisissez
   « Salarié ».

Résultat attendu : étape 1, Test - Administrateur n'est pas proposé : nul ne se confie l'agenda
d'un dirigeant, une autre personne de la direction ou de l'administration doit poser la
délégation. Étape 2, la carte n'existe pas pour test.daf. Étape 3, aucun compte sans agenda
(salarié seul, conducteur, porteur, auditeur) n'est proposé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-52. Un compte désactivé perd partages et délégations

Objectif : vérifier ce que devient l'agenda d'un compte désactivé, et que les participants sont
prévenus.

Compte : test.admin, avec test.daf.

Données : un compte créé pour l'essai avec un profil interne (par exemple celui du scénario FIN-38
du cahier Finance).

1. Compte d'essai : partagez votre agenda avec test.daf en lecture ; créez « Réunion d'adieu
   (essai) », demain à 10 h, et invitez test.daf.
2. test.admin : Finance > Administration > Utilisateurs, fiche du compte d'essai, « Désactiver »,
   confirmez.
3. test.daf : rechargez l'agenda ; ouvrez la cloche, puis l'événement.

Résultat attendu : l'agenda du compte d'essai a quitté le panneau de test.daf. La cloche annonce
« Organisateur désactivé : Réunion d'adieu (essai) » ; l'événement reste dans l'agenda de test.daf,
l'organisateur marqué « (compte désactivé) ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## M. Contrôles de saisie et de sécurité

### AGE-53. Saisies refusées

Objectif : vérifier les contrôles du formulaire.

Compte : test.comptable.

Données : lien de visioconférence « visio.example.org/essai » ; une fin avant le début.

1. « Nouvel événement », « Créer l'événement » sans titre.
2. Titre « Contrôle (essai) » ; fin une heure avant le début ; « Créer l'événement ».
3. Horaire correct ; lien de visioconférence sans « https:// » ; « Créer l'événement ».

Résultat attendu : étape 1, « Donnez un titre à l'événement. ». Étape 2, « L'événement finit après
son début. ». Étape 3, « Le lien de visioconférence commence par https:// (une adresse, sans
espace). ». Rien n'est créé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-54. Un double clic ne crée qu'un événement

Objectif : vérifier qu'un double clic n'enregistre qu'une fois.

Compte : test.comptable.

Données : « Double clic (essai) », vendredi prochain à 9 h.

1. « Nouvel événement », titre et horaire, puis double-cliquez sur « Créer l'événement ».
2. Recherchez « Double clic ».

Résultat attendu : un seul événement porte ce titre.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### AGE-55. Message clair en cas de coupure du réseau

Objectif : vérifier qu'une coupure pendant un enregistrement est annoncée en français, sans perdre la
saisie.

Compte : test.comptable.

Données : « Coupure (essai) », vendredi prochain à 16 h.

1. « Nouvel événement », titre et horaire.
2. Coupez le réseau du poste, puis « Créer l'événement ».
3. Rétablissez le réseau, puis « Créer l'événement » de nouveau.

Résultat attendu : à l'étape 2, un message en français signale l'échec, sans texte en anglais ni
code ; la fenêtre reste ouverte avec la saisie. À l'étape 3, « Événement créé. » ; un seul
événement porte ce titre.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## N. Photos des personnes

### AGE-56. Voir la photo des personnes dans l'agenda

Objectif : vérifier que l'agenda montre la photo d'un collègue à la place de ses initiales (agendas
délégués, organisateur, participants, délégations), et les initiales de qui n'a pas de photo.

Compte : test.daf.

Données : « Comité de direction (démo) » de lundi prochain ; photos de démonstration des comptes
test.dg et test.exploitation (dossiers « Mamadou Sylla (démo) » et « Sékou Touré (démo) ») ;
test.daf, test.achats et test.comptable n'ont pas de photo.

1. Regardez, à gauche, l'agenda de test.dg sous « Agendas délégués ».
2. Ouvrez « Comité de direction (démo) » de lundi prochain.
3. Fermez le détail, puis Réglages de l'agenda, « Délégations ».
4. « Nouvel événement », sous « Participants » saisissez « Exploitation » et choisissez le collègue
   proposé, puis « Annuler ».

Résultat attendu : à l'étape 1, un petit rond à la photo de test.dg précède le nom de son agenda. À
l'étape 2, sa photo précède « Organisateur » ; dans « Participants », test.exploitation a sa photo,
test.daf et test.achats leurs initiales, chaque rond de la même taille. À l'étape 3, la ligne « Agenda
de Test - Direction générale » porte sa photo. À l'étape 4, la photo de test.exploitation apparaît
dans la liste des invités.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## Synthèse

| Partie {52} | Scénarios {12} | Réussis {12} | Échoués {12} | Non joués {12} |
|---|---|---|---|---|
| A. Prise en main et vues | 5 | | | |
| B. Événements | 8 | | | |
| C. Récurrence | 5 | | | |
| D. Invitations et réponses | 4 | | | |
| E. Disponibilités, créneaux et absence | 5 | | | |
| F. Ressources | 4 | | | |
| G. Partages et agendas d'équipe | 3 | | | |
| H. Délégation | 5 | | | |
| I. Échéances des modules et rappels | 3 | | | |
| J. Abonnement, import et export | 3 | | | |
| K. Rendez-vous en ligne | 2 | | | |
| L. Refus attendus | 5 | | | |
| M. Contrôles de saisie et de sécurité | 3 | | | |
| N. Photos des personnes | 1 | | | |
| Total | 56 | | | |

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
