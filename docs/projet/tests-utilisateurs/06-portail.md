# Cahier de test : Portail des porteurs de projets

Le portail des porteurs de projets de MB AxisPro Consulting.

Accueil, projet, pièces et data room, plan d'actions, messages, rendez-vous, agenda, actualités,
conseils et ressources, événements, simulateurs, profil et avis ; confidentialité du dossier.

| Rubrique {28} | À remplir {72} |
|---|---|
| Module | Portail des porteurs de projets |
| Version de la plateforme | ______ (communiquée par E-VOLUTION XP) |
| Date du test | ______ |
| Nom du testeur | ______ |
| Fonction | ______ |
| Profil utilisé | ______ |
| Compte de test | ______ |
| Société | MB AxisPro Consulting |
| Appareil utilisé | ☐ Ordinateur    ☐ Téléphone |

Document préparé par E-VOLUTION XP le 26 octobre 2026, d'après les écrans de la plateforme à cette
date.

<!-- saut de page -->

## Mode d'emploi

Ce cahier se joue sur la recette : une copie complète de NIMOVA, avec des données fictives repérées
« Démo ». Rien de ce que vous y faites ne touche les vrais dossiers : vous pouvez tout essayer, y
compris les erreurs.

1. Se connecter. Ouvrez l'adresse du portail de la recette communiquée par E-VOLUTION XP (l'adresse
   de la recette suivie de /portail), dans Chrome ou Edge, sur ordinateur ou sur téléphone. Identifiant : le compte de test indiqué dans le
   scénario. Mot de passe : le mot de passe commun de la recette, communiqué par E-VOLUTION XP.
2. Le cabinet. Plusieurs scénarios demandent une réponse du cabinet : un testeur du cabinet joue en
   même temps le compte test.consultant (cahier AxisPro Suite).
3. Jouer un scénario. Suivez les étapes dans l'ordre, avec les données indiquées. Les scénarios à
   deux comptes se jouent dans deux navigateurs (Chrome et Edge) ou sur deux appareils.
4. Noter le résultat. Cochez « Réussi » si l'écran correspond au résultat attendu, sinon « Échoué ».
   Dans « Remarques », notez ce qui diffère : l'écran, le message affiché, l'heure.
5. Signaler une anomalie. Le portail n'a pas « Mes demandes » : notez l'anomalie dans les remarques
   et transmettez le cahier au testeur du cabinet, qui la dépose dans « Mes demandes » (type
   « Remarque de recette », application Portail des porteurs de projets), avec un titre commençant
   par le numéro du scénario (par exemple « POR-04 : dépôt refusé »).

## Comptes de test

| Compte {18} | Profil {18} | Dossier suivi {36} | Rôle dans ce cahier {28} |
|---|---|---|---|
| test.porteur | Porteur | Unité de séchage de mangues (démo) | porteur de projet |
| porteur.demo | Porteur | Usine de briques compressées (démo) | second porteur, refus |
| test.consultant | Cabinet | les dossiers du cabinet | réponses du cabinet |

## A. Porteur de projet

### POR-01. Se connecter au portail

Objectif : vérifier la connexion du porteur et la présentation de son espace.

Compte : test.porteur.

Données : identifiant test.porteur ; mot de passe commun de la recette.

1. Ouvrez l'adresse du portail. La page « Connexion » indique « Votre espace de porteur de projet
   chez MB AxisPro Consulting. ».
2. Saisissez l'identifiant et le mot de passe, puis « Se connecter ».
3. Sur ordinateur, regardez le menu à gauche ; sur téléphone, la barre du bas et le bouton « Ouvrir
   le menu ».

Résultat attendu : l'accueil s'ouvre au nom du porteur, aux couleurs de MB AxisPro Consulting. Le
menu propose « Accueil », « Mon projet », « Pièces et data room », « Plan d'actions », « Messages »,
« Rendez-vous », « Agenda », « Actualités », « Conseils et ressources », « Événements et
formations », « Simulateurs », « Votre avis » et « Mon profil ». Le nom de NIMOVA n'apparaît pas.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-02. Lire l'accueil

Objectif : vérifier que l'accueil dit au porteur où en est son projet et ce qui l'attend.

Compte : test.porteur.

Données : aucune.

1. Lisez le bandeau : le projet, son étape et l'anneau de « préparation ».
2. Lisez « Vos prochaines étapes », « À venir » et le parcours du dossier.
3. Utilisez les raccourcis « Déposer une pièce », « Écrire au cabinet », « Demander un rendez-vous »,
   « Simuler un prêt ».

Résultat attendu : les prochaines étapes sont classées, le plus urgent en premier. Le taux de
préparation porte sur les pièces, les actions et les étapes ; ce n'est pas la note d'évaluation du
cabinet. Chaque raccourci ouvre l'écran annoncé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-03. Consulter son projet

Objectif : vérifier la fiche du projet, l'équipe du cabinet et les financements recherchés.

Compte : test.porteur.

Données : aucune.

1. Ouvrez « Mon projet ».
2. Lisez la fiche, le parcours d'étapes, l'équipe du cabinet (téléphone et courriel), les financements
   recherchés et l'historique du dossier.

Résultat attendu : les informations sont celles du dossier « Unité de séchage de mangues (démo) ».
Aucun score, aucun critère, aucune note interne du cabinet n'apparaît.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-04. Déposer une pièce attendue

Objectif : vérifier le dépôt d'une pièce et son suivi.

Compte : test.porteur.

Données : un document PDF de moins de 20 Mo (par exemple un relevé ou une attestation d'essai).

1. Ouvrez « Pièces et data room ». Lisez « Préparation de vos pièces » et la liste « Pièces
   attendues ».
2. Filtrez sur « À déposer », puis cliquez sur « Déposer » en face d'une pièce.
3. Choisissez le PDF.
4. Glissez un second document dans la zone « Glissez un document ici » et rattachez-le à une pièce
   attendue ou à « Un document libre », puis « Envoyer le document ».
5. Ouvrez « Mes envois ».

Résultat attendu : le message « « … » est bien reçu. Le cabinet le vérifie et vous tient informé. »
s'affiche ; la pièce passe dans « Reçues, en vérification ». Les deux envois figurent dans « Mes
envois ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-05. Reprendre une pièce renvoyée par le cabinet

Objectif : vérifier qu'une pièce à reprendre porte le commentaire du cabinet et se redépose.

Compte : test.porteur, après le scénario AXP-11 du cahier AxisPro Suite (pièce à reprendre).

Données : une version corrigée du document, en PDF.

1. « Pièces et data room », filtre « À reprendre ».
2. Lisez « Commentaire du cabinet : ».
3. Cliquez sur « Déposer la nouvelle version » et choisissez le PDF.

Résultat attendu : le commentaire du cabinet est lisible. La nouvelle version est reçue et la pièce
repasse en vérification ; l'ancienne version reste conservée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-06. Écrire à son consultant

Objectif : vérifier la messagerie avec le cabinet et les pièces jointes.

Compte : test.porteur, puis test.consultant.

Données : message « Bonjour, voici le devis demandé (essai POR-06). » ; un devis en PDF.

1. Ouvrez « Messages ».
2. Écrivez le message dans « Écrivez votre message… ».
3. Cliquez sur « Joindre un fichier » et choisissez le PDF.
4. Envoyez avec Ctrl + Entrée (ou « Envoyer le message »).
5. test.consultant répond depuis AxisPro Suite. Attendez la réponse.

Résultat attendu : le message et la pièce jointe apparaissent dans le fil. Le fichier joint est aussi
rangé dans les pièces du dossier. La réponse du consultant arrive dans le fil, avec une notification
sur la cloche.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-07. Déclarer une action faite

Objectif : vérifier le compte rendu d'une action confiée par le cabinet.

Compte : test.porteur.

Données : l'action « Fournir les devis des presses (essai) » confiée par le cabinet (AXP-09), ou une
autre action à faire ; compte rendu « Trois devis obtenus, déposés dans les pièces. ».

1. Ouvrez « Plan d'actions ». Repérez l'action dans « À faire ».
2. Cliquez sur « J'ai réalisé cette action ».
3. Rédigez le compte rendu, puis « Envoyer au cabinet ».

Résultat attendu : l'action passe dans « Transmises au cabinet » avec la mention « Votre consultant
vérifie, puis valide l'action. ». Une fois validée par le cabinet, elle figure parmi les actions
validées.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-08. Lire une actualité et en confirmer la lecture

Objectif : vérifier les communications du cabinet et l'accusé de lecture.

Compte : test.porteur.

Données : la communication « Appel à projets agricole (essai) » publiée par le cabinet (AXP-22), ou
une autre communication « À confirmer ».

1. Ouvrez « Actualités ».
2. Ouvrez la communication marquée « À confirmer ».
3. Cliquez sur « J'ai lu et pris connaissance ».

Résultat attendu : la communication s'affiche en entier, avec son bouton s'il y en a un. Après
confirmation, elle n'est plus « À confirmer » ; le cabinet voit l'accusé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-09. Demander un rendez-vous

Objectif : vérifier la demande de rendez-vous sur trois créneaux et son ajout à l'agenda.

Compte : test.porteur, puis test.consultant (confirmation, AXP-23).

Données : objet « Point sur le plan d'affaires (essai) » ; forme visioconférence ; trois créneaux la
semaine prochaine.

1. Ouvrez « Rendez-vous », puis « Demander un rendez-vous ».
2. Remplissez « Objet », choisissez la « Forme du rendez-vous », puis les « Créneaux proposés (de 1 à
   3) ».
3. Cliquez sur « Envoyer la demande ».
4. Après la confirmation du cabinet, ouvrez le rendez-vous, puis « Ajouter à mon agenda ».
5. Ouvrez « Agenda ».

Résultat attendu : la demande figure « En attente de confirmation ». Confirmée, elle passe « Confirmé »
avec une notification. « Ajouter à mon agenda » télécharge le rendez-vous pour le calendrier du
téléphone ou de l'ordinateur. L'agenda le montre avec les événements et les échéances.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-10. S'inscrire à un événement

Objectif : vérifier l'inscription, la liste d'attente et la désinscription.

Compte : test.porteur, puis porteur.demo.

Données : l'« Atelier plan d'affaires (essai) » à une place (AXP-24), ou un autre événement publié.

1. test.porteur : ouvrez « Événements et formations », l'événement, laissez une question pour
   l'intervenant, puis « Confirmer mon inscription ».
2. porteur.demo : ouvrez le même événement.
3. test.porteur : désinscrivez-vous (« Vous désinscrire ? »), confirmez.

Résultat attendu : test.porteur lit « Inscription confirmée. … ». porteur.demo voit « Complet : liste
d'attente ouverte » et peut « Rejoindre la liste d'attente ». Après la désinscription, « Vous êtes
désinscrit. Votre place revient à un autre porteur. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-11. Trouver un conseil

Objectif : vérifier le centre de ressources, la recherche et les recommandations de l'étape.

Compte : test.porteur.

Données : le mot « financement ».

1. Ouvrez « Conseils et ressources ».
2. Lisez les conseils recommandés pour votre étape.
3. Recherchez « financement », ouvrez un contenu, ajoutez-le à vos favoris et dites s'il vous a été
   utile.

Résultat attendu : les contenus publiés par le cabinet sont rangés par rubrique ; la recherche les
filtre ; le favori est gardé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-12. Simuler un prêt

Objectif : vérifier le simulateur de prêt, qui n'enregistre et ne transmet rien.

Compte : test.porteur.

Données : montant emprunté 500 000 000 ; taux annuel 14 ; durée totale 60 mois ; différé 6 mois.

1. Ouvrez « Simulateurs », onglet « Prêt ».
2. Saisissez « Montant emprunté », « Taux annuel », « Durée totale » et « Différé ».
3. Lisez l'échéance, le coût total et le tableau d'amortissement.
4. Ouvrez les onglets « Capacité de remboursement », « Seuil de rentabilité » et « Fonds de
   roulement ».

Résultat attendu : l'échéance et le tableau se calculent à la saisie. Les autres simulateurs
répondent de même. Rien n'apparaît côté cabinet.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-13. Mettre à jour ses coordonnées et demander celle de l'entreprise

Objectif : vérifier que le porteur change ses coordonnées, et que la fiche de l'entreprise passe par
une demande au cabinet.

Compte : test.porteur, puis test.consultant.

Données : téléphone « +224 621 00 00 00 » ; ville de l'entreprise « Mamou ».

1. Ouvrez « Mon profil ». Dans « Mes coordonnées », changez le « Téléphone » et enregistrez.
2. Dans « Demander une mise à jour de la fiche de l'entreprise », saisissez la « Ville » et envoyez.
3. test.consultant : ouvrez AxisPro Suite > Portail des porteurs > « Messages ».

Résultat attendu : le téléphone personnel est changé aussitôt. Pour l'entreprise : « Votre demande est
transmise à votre consultant, qui mettra la fiche à jour. » ; la fiche reste « tenue par le
cabinet ». La demande arrive dans la messagerie du cabinet.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-14. Donner son avis

Objectif : vérifier l'envoi d'un avis au cabinet.

Compte : test.porteur.

Données : note 4 étoiles ; recommandation 8 sur 10 ; commentaire « Suivi clair (essai). ».

1. Ouvrez « Votre avis ». Choisissez le sujet (le suivi du dossier).
2. Donnez la note, la recommandation et le commentaire, puis envoyez.

Résultat attendu : l'avis est enregistré ; sans note, l'envoi est refusé (« Donnez une note de 1 à 5
étoiles. »). Le cabinet le retrouve dans « Porteurs et avis ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-15. Lire et marquer ses notifications

Objectif : vérifier la cloche des notifications.

Compte : test.porteur.

Données : au moins une notification non lue (message, pièce validée, rendez-vous…).

1. Cliquez sur la cloche, en haut à droite.
2. Ouvrez une notification.
3. Cliquez sur « Tout marquer comme lu », lisez la fenêtre, puis confirmez.

Résultat attendu : chaque notification mène à l'écran concerné. La fenêtre précise que les
notifications restent consultables ; après confirmation, la cloche n'affiche plus de nouveauté.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## B. Refus attendus

### POR-16. Le porteur ne voit ni score ni note interne

Objectif : vérifier la confidentialité du travail du cabinet.

Compte : test.porteur, après le scénario AXP-12 (note interne du cabinet).

Données : le dossier « Unité de séchage de mangues (démo) ».

1. Parcourez « Mon projet », « Pièces et data room », « Plan d'actions » et « Messages ».

Résultat attendu : aucun score (Project Readiness, APD, Bankability), aucun critère de la grille,
aucune note interne (« Vérifier la marge du distributeur… ») n'apparaît. Seul le taux de préparation
est affiché.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-17. Le porteur ne voit que ses dossiers

Objectif : vérifier qu'un porteur ne lit jamais le dossier d'un autre porteur.

Compte : porteur.demo, puis test.porteur.

Données : les deux dossiers de démonstration.

1. porteur.demo : ouvrez « Mon projet », « Pièces et data room » et « Messages ».
2. test.porteur : faites de même.

Résultat attendu : porteur.demo ne voit que « Usine de briques compressées (démo) » ; test.porteur ne
voit que « Unité de séchage de mangues (démo) ». Aucun ne voit les pièces ni les messages de l'autre.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-18. Formats de fichiers refusés

Objectif : vérifier que les fichiers dangereux ou anciens sont refusés, avec les formats acceptés
rappelés.

Compte : test.porteur.

Données : une archive .zip ; un ancien fichier Excel .xls ; un programme renommé en .pdf (fichier
d'essai fourni par E-VOLUTION XP) ; un document Word à macros (.docm).

1. « Pièces et data room » : déposez chaque fichier sur une pièce (dans la fenêtre de choix,
   affichez « Tous les fichiers »).

Résultat attendu : chaque dépôt est refusé par un message qui rappelle les formats acceptés : PDF,
JPEG, PNG, Word (.docx) ou Excel (.xlsx). Le programme renommé est refusé lui aussi : le format est
reconnu au contenu, pas au nom. Aucune pièce n'est ajoutée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-19. Le portail n'ouvre pas les applications internes

Objectif : vérifier qu'un porteur n'ouvre ni Finance, ni AxisPro Suite, ni « Mes demandes ».

Compte : test.porteur.

Données : aucune.

1. Dans la barre d'adresse, remplacez la fin de l'adresse par /finance, puis par /compte/demandes.

Résultat attendu : la page « Accès non ouvert à votre profil » s'affiche, sans aucune donnée interne.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## C. Contrôles de saisie et de sécurité

### POR-20. Nombres écrits à la française dans les simulateurs

Objectif : vérifier que les montants s'écrivent à la française et qu'une écriture ambiguë est refusée
avec un message.

Compte : test.porteur.

Données : montant « 750 000 000 », taux « 2,5 », puis montant « 2.500.000 ».

1. « Simulateurs », onglet « Prêt » : saisissez « 750 000 000 » et « 2,5 ».
2. Remplacez le montant par « 2.500.000 ».

Résultat attendu : à l'étape 1, la simulation se calcule. À l'étape 2, le message « Nombre illisible :
écrivez par exemple 750 000 ou 2,5. » s'affiche sous le champ et le résultat n'est pas recalculé sur
une valeur mal lue.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-21. Un double clic n'envoie qu'un message

Objectif : vérifier qu'un double clic sur un envoi n'enregistre qu'une fois.

Compte : test.porteur.

Données : message « Essai du double clic (POR-21). ».

1. « Messages » : écrivez le message, puis double-cliquez sur « Envoyer le message ».
2. « Rendez-vous » : remplissez une demande, puis double-cliquez sur « Envoyer la demande ».

Résultat attendu : un seul message dans le fil ; une seule demande de rendez-vous.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-22. Confirmation avant d'annuler un rendez-vous

Objectif : vérifier qu'une annulation demande une confirmation et un mot d'explication.

Compte : test.porteur.

Données : un rendez-vous demandé ou confirmé.

1. Ouvrez le rendez-vous, puis « Annuler le rendez-vous ».
2. Lisez la fenêtre, écrivez quelques mots, puis « Confirmer l'annulation ».

Résultat attendu : rien n'est annulé avant « Confirmer l'annulation ». Le cabinet est prévenu de
l'annulation.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### POR-23. Coupure du réseau et inactivité

Objectif : vérifier le message en cas de coupure et la déconnexion après une minute sans activité.

Compte : test.porteur.

Données : un message à envoyer.

1. « Messages » : écrivez un message, coupez le réseau (mode avion du téléphone ou Wi-Fi du poste),
   puis envoyez.
2. Rétablissez le réseau et renvoyez.
3. Laissez le portail ouvert sans y toucher pendant une minute, puis pendant 30 secondes de plus.

Résultat attendu : à l'étape 1, un message en français signale que l'envoi n'a pas abouti ; le texte
saisi reste dans le champ. À l'étape 2, le message part une seule fois. À l'étape 3, la question
« Êtes-vous toujours là ? » s'affiche, puis la page de connexion, avec « Vous avez été déconnecté
après une période d'inactivité. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## Synthèse

| Partie {52} | Scénarios {12} | Réussis {12} | Échoués {12} | Non joués {12} |
|---|---|---|---|---|
| A. Porteur de projet | 15 | | | |
| B. Refus attendus | 4 | | | |
| C. Contrôles de saisie et de sécurité | 4 | | | |
| Total | 23 | | | |

Réserves et anomalies relevées :

| N° {6} | Scénario {12} | Constat {52} | Transmis au cabinet le {16} | Gravité {14} |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |

## Signatures

| Le testeur {50} | Le référent du cabinet {50} |
|---|---|
| Nom : | Nom : |
| Fonction : | Fonction : |
| Date : | Date : |
| Signature : | Signature : |
