# Cahier de test : Socle commun

NIMOVA, plateforme de gestion d'EGUITRA GROUP SARLU et de MB AxisPro Consulting.

Connexion, mot de passe, double authentification, société de travail, déconnexion après inactivité,
« Mes demandes » et discussion interne : ce qui est commun à toutes les applications.

| Rubrique {28} | À remplir {72} |
|---|---|
| Module | Socle commun à toutes les applications |
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

Ce cahier se joue sur la recette : une copie complète de NIMOVA, avec des données fictives repérées
« Démo ». Rien de ce que vous y faites ne touche les vrais comptes : vous pouvez tout essayer, y
compris les erreurs.

1. Se connecter. Ouvrez l'adresse de la recette communiquée par E-VOLUTION XP, dans Chrome ou Edge.
   Identifiant : le compte de test indiqué dans le scénario. Mot de passe : le mot de passe commun de
   la recette, communiqué par E-VOLUTION XP. La double authentification est suspendue sur la recette
   pendant les tests, sauf mention contraire. L'adresse de la recette ouvre la connexion à Finance :
   un compte sans Finance (cabinet, RH, salarié, porteur) se connecte par l'adresse de la recette
   suivie de /axispro, /rh ou /portail.
2. Jouer un scénario. Suivez les étapes dans l'ordre, avec les données indiquées. Un scénario à deux
   comptes se joue dans deux navigateurs (Chrome et Edge) ou sur deux postes.
3. Noter le résultat. Cochez « Réussi » si l'écran correspond au résultat attendu, sinon « Échoué ».
   Dans « Remarques », notez ce qui diffère : l'écran, le message affiché, l'heure.
4. Signaler une anomalie. Dans une application, cliquez sur le rond à vos initiales, en haut à
   droite, puis « Mes demandes » et « Nouvelle demande ». Choisissez le type « Remarque de
   recette », l'application concernée et la gravité ; commencez le titre par le numéro du scénario
   (par exemple « SOC-09 : la question ne s'affiche pas ») ; décrivez ce que vous avez fait, ce que
   vous attendiez et ce qui s'est produit ; cliquez sur « Déposer la demande ». Reportez le numéro
   reçu (DEM-…) dans les remarques du scénario.
5. Ne saisissez aucune information réelle confidentielle : ni compte bancaire, ni salaire, ni mot de
   passe dans une demande ou un message.

## Comptes de test

| Compte {18} | Profil {22} | Sociétés {26} | Utilisé ici pour {34} |
|---|---|---|---|
| test.comptable | Finance | les deux | connexion, demandes, discussion |
| test.daf | Finance | les deux | société de travail, discussion |
| test.dg | Direction | les deux | demandes des sociétés, applications d'une seule société |
| test.admin | Administration | les deux | traitement des demandes, confidentialité |
| test.chantiers | BTP | EGUITRA GROUP SARLU | discussion d'une fiche |
| test.consultant | Cabinet | MB AxisPro Consulting | discussion d'un dossier, refus |
| test.parc | Exploitation | EGUITRA GROUP SARLU | refus |
| test.salarie | Salarié (Mon espace) | EGUITRA GROUP SARLU | refus |
| test.porteur | Porteur de projet | MB AxisPro Consulting | refus |

## A. Tous les profils : connexion et compte

### SOC-01. Se connecter à la recette

Objectif : vérifier qu'un compte de test ouvre la plateforme et que le compte connecté est le bon.

Compte : test.comptable.

Données : identifiant test.comptable ; mot de passe commun de la recette.

1. Ouvrez l'adresse de la recette dans Chrome ou Edge.
2. Dans « Identifiant », saisissez test.comptable.
3. Dans « Mot de passe », saisissez le mot de passe commun. Cliquez sur l'œil au bout du champ : le
   mot de passe s'affiche en clair. Cliquez de nouveau : il est masqué.
4. Cliquez sur « Se connecter ».
5. Dans le rayon Finance de l'accueil, cliquez sur la tuile « Tableau de bord », puis sur le rond à
   vos initiales, en haut à droite.

Résultat attendu : l'accueil NIMOVA s'ouvre sur les rayons des applications du compte (Finance,
Transport, Analyse), chacun avec ses tuiles. Dans Finance, le menu du compte affiche « Test -
Comptable » et « test.comptable », puis « Changer le mot de passe », « Mes demandes », les autres
applications du compte et « Se déconnecter ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-02. Refuser un mot de passe erroné

Objectif : vérifier qu'un mot de passe faux est refusé sans dire lequel des deux champs est faux.

Compte : test.comptable.

Données : un mot de passe volontairement faux, par exemple « Essai-incorrect-1 ».

1. Sur la page « Connexion », saisissez test.comptable et le mot de passe faux.
2. Cliquez sur « Se connecter ».
3. Recommencez avec le bon mot de passe.

Résultat attendu : à l'étape 2, le message « Identifiant ou mot de passe incorrect. » s'affiche et la
page de connexion reste ouverte. À l'étape 3, la connexion aboutit.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-03. Bloquer le compte après cinq essais faux

Objectif : vérifier qu'après cinq mots de passe faux de suite, le compte est bloqué un quart d'heure.

Compte : test.salarie (le blocage vaut pour tous les testeurs du bureau qui utilisent ce compte :
prévenez-les, jouez ce scénario en fin de journée).

Données : un mot de passe faux, puis le bon ; l'adresse de la recette suivie de /rh (test.salarie
n'a que « Mon espace »).

1. Saisissez test.salarie et un mot de passe faux, puis « Se connecter ». Recommencez jusqu'à cinq
   essais faux.
2. Saisissez maintenant le bon mot de passe, puis « Se connecter ».
3. Attendez quinze minutes, puis reconnectez-vous avec le bon mot de passe.

Résultat attendu : à l'étape 2, le message « Trop de tentatives. Réessayez dans 15 minutes. »
s'affiche, même avec le bon mot de passe. À l'étape 3, la connexion aboutit.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-04. Changer le mot de passe

Objectif : vérifier les règles du mot de passe et le verrou propre à la recette.

Compte : test.comptable.

Données : un nouveau mot de passe court (« Court-12 »), puis deux saisies différentes, puis un
nouveau mot de passe de 12 caractères saisi deux fois à l'identique.

1. Menu du compte (rond à vos initiales) > « Changer le mot de passe ». La page « Mot de passe »
   s'ouvre.
2. Saisissez le mot de passe commun dans « Mot de passe actuel », « Court-12 » dans « Nouveau mot de
   passe » et dans « Confirmation », puis « Enregistrer le nouveau mot de passe ».
3. Saisissez deux valeurs différentes dans « Nouveau mot de passe » et « Confirmation », puis
   « Enregistrer le nouveau mot de passe ».
4. Saisissez le même mot de passe de 12 caractères dans les deux champs, puis « Enregistrer le
   nouveau mot de passe ».
5. Déconnectez-vous et reconnectez-vous avec le mot de passe commun.

Résultat attendu : étape 2, « Le mot de passe doit contenir au moins 10 caractères. » ; étape 3,
« Les deux saisies du nouveau mot de passe diffèrent. » ; étape 4, « Recette : le mot de passe est
commun à tous les comptes et ne se modifie pas. ». Le mot de passe commun reste valable (étape 5).
En production, l'étape 4 change le mot de passe et ramène à la page de connexion avec « Mot de
passe modifié. Reconnectez-vous avec le nouveau mot de passe. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-05. Activer la double authentification à la première connexion

Objectif : vérifier qu'un compte sans double authentification est guidé pour l'activer avant
d'entrer.

Compte : le compte que E-VOLUTION XP aura remis à zéro pour ce test. À jouer le jour où la double
authentification est rétablie sur la recette (E-VOLUTION XP prévient les testeurs).

Données : un téléphone avec Google Authenticator, Microsoft Authenticator ou FreeOTP.

1. Connectez-vous avec l'identifiant et le mot de passe.
2. L'écran « Double authentification » s'affiche : suivez ses trois consignes. Ouvrez l'application
   d'authentification du téléphone et scannez le code affiché (ou saisissez la clé écrite sous le
   code).
3. Saisissez un code faux de 6 chiffres, puis « Activer et se connecter ».
4. Saisissez le code à 6 chiffres affiché par le téléphone, puis « Activer et se connecter ».

Résultat attendu : à l'étape 3, « Code incorrect. » et le code saisi est effacé. À l'étape 4, la
plateforme s'ouvre. Le bouton reste grisé tant que les 6 chiffres ne sont pas saisis.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-06. Se connecter avec le code de vérification

Objectif : vérifier qu'une connexion demande le code du téléphone une fois la double
authentification activée.

Compte : le compte du scénario SOC-05.

Données : le téléphone relié au compte.

1. Déconnectez-vous, puis reconnectez-vous avec l'identifiant et le mot de passe.
2. L'écran « Code de vérification » s'affiche. Cliquez sur « Revenir à l'identifiant », puis
   reconnectez-vous.
3. Saisissez le code à 6 chiffres affiché par le téléphone, puis « Valider ».

Résultat attendu : « Revenir à l'identifiant » ramène à la saisie de l'identifiant. Avec le bon code,
la plateforme s'ouvre. Un code faux affiche « Code incorrect. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-07. Trouver un écran et changer d'application

Objectif : vérifier les trois moyens de se déplacer : l'accueil, la recherche d'écran et le menu des
espaces.

Compte : test.dg.

Données : le mot « relances ».

1. Sur l'accueil NIMOVA, saisissez « relances » dans « Rechercher un module » : la tuile des relances
   apparaît. Ouvrez-la.
2. Dans Finance, cliquez sur « Rechercher un écran » en haut (ou Ctrl K), saisissez « trésorerie »
   et choisissez l'écran proposé.
3. Cliquez sur le nom de l'espace, en haut à gauche (NIMOVA, puis le nom du module) : la liste des
   espaces du compte s'ouvre. Choisissez Transport.

Résultat attendu : chaque moyen ouvre l'écran demandé. Le menu des espaces liste ceux du compte
(Finance, Transport, MB AxisPro Consulting, Analyse, RH) avec, pour chacun, une ligne de
présentation.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-08. Se déconnecter

Objectif : vérifier que la déconnexion ferme la session dans tous les onglets.

Compte : test.comptable.

Données : deux onglets ouverts sur NIMOVA, l'un sur Finance, l'autre sur Analyse.

1. Dans le premier onglet, menu du compte > « Se déconnecter ».
2. Revenez au second onglet.
3. Dans le second onglet, rechargez la page.

Résultat attendu : les deux onglets affichent la page « Connexion ». Après rechargement, aucun écran
ne s'ouvre sans nouvelle connexion.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## B. Tous les profils : déconnexion après inactivité

### SOC-09. Répondre à la question « Êtes-vous toujours là ? »

Objectif : vérifier qu'après une minute sans activité, la plateforme demande si vous êtes là.

Compte : test.comptable.

Données : aucune.

1. Ouvrez Finance, Tableau de bord.
2. Ne touchez plus ni la souris, ni le clavier, ni l'écran pendant une minute.
3. Lisez la fenêtre qui s'ouvre, puis cliquez sur « Je suis là ».

Résultat attendu : après une minute, la fenêtre « Êtes-vous toujours là ? » s'ouvre : « Aucune
activité depuis un moment. Sans réponse, vous serez déconnecté dans 30 secondes, pour protéger vos
données. ». Le nombre de secondes diminue. « Je suis là » ferme la fenêtre ; vous restez sur
l'écran, connecté.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-10. Être déconnecté faute de réponse

Objectif : vérifier qu'à défaut de réponse dans les 30 secondes, la session est fermée.

Compte : test.comptable.

Données : aucune.

1. Ouvrez un écran, puis restez sans activité jusqu'à l'ouverture de la fenêtre « Êtes-vous toujours
   là ? ».
2. Ne répondez pas pendant 30 secondes.
3. Reconnectez-vous.

Résultat attendu : à la fin du compte à rebours, la page « Connexion » s'affiche avec le message
« Vous avez été déconnecté après une période d'inactivité. ». La reconnexion aboutit.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-11. Travailler dans un autre onglet sans être déconnecté

Objectif : vérifier que l'activité dans un onglet vaut pour tous les onglets, et que « Me
déconnecter » les ferme tous.

Compte : test.comptable.

Données : deux onglets ouverts sur NIMOVA.

1. Laissez le premier onglet sur Finance, Tableau de bord.
2. Dans le second onglet, travaillez pendant deux minutes (déplacez-vous dans les menus, faites
   défiler les pages).
3. Revenez au premier onglet.
4. Restez sans activité jusqu'à la question « Êtes-vous toujours là ? », puis cliquez sur « Me
   déconnecter ».

Résultat attendu : à l'étape 3, le premier onglet est toujours ouvert et ne pose aucune question. À
l'étape 4, les deux onglets passent à la page « Connexion ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## C. Direction et finance : société de travail

### SOC-12. Changer de société de travail

Objectif : vérifier qu'un compte ouvert aux deux sociétés passe de l'une à l'autre et ne voit que
les livres de la société choisie.

Compte : test.daf.

Données : aucune.

1. Ouvrez Finance > Comptabilité > Ventes et notez la société affichée en haut à droite, à côté de son
   logo.
2. Cliquez sur ce nom de société. Sous « Livres ouverts », choisissez MB AxisPro Consulting.
3. Regardez la liste des ventes et le menu du haut.
4. Revenez à EGUITRA GROUP SARLU de la même façon.

Résultat attendu : l'écran se recharge à chaque changement. Sous MB AxisPro Consulting, seules les
factures du cabinet apparaissent et le menu « Métiers » (BTP, Immobilier) disparaît. De retour sous
EGUITRA GROUP SARLU, les factures du groupe et le menu « Métiers » reviennent.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-13. Garder sa société dans chaque onglet

Objectif : vérifier qu'un onglet ouvert dans une société continue d'y enregistrer, même si un autre
onglet est passé dans l'autre société.

Compte : test.daf.

Données : client « Démo - Distributeur pétrolier A » ; une ligne « Essai d'onglet », quantité 1,
prix 100 000.

1. Onglet 1 : Finance > Comptabilité > Ventes, société EGUITRA GROUP SARLU.
2. Onglet 2 : ouvrez le même écran, puis passez à MB AxisPro Consulting (« Livres ouverts »).
3. Revenez à l'onglet 1 sans le recharger. Cliquez sur « Nouvelle facture », saisissez le client et la
   ligne, puis enregistrez la facture en brouillon.
4. Dans l'onglet 2, rechargez la liste des ventes de MB AxisPro Consulting.

Résultat attendu : la facture créée à l'étape 3 figure dans les ventes d'EGUITRA GROUP SARLU
(onglet 1) et n'apparaît pas dans celles de MB AxisPro Consulting (onglet 2).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-14. Ouvrir une application qui ne sert qu'une société

Objectif : vérifier que Transport travaille toujours dans EGUITRA GROUP SARLU et AxisPro toujours dans
MB AxisPro Consulting, quelle que soit la société choisie ailleurs.

Compte : test.dg.

Données : aucune.

1. Dans Finance, passez à MB AxisPro Consulting.
2. Par le menu des espaces (en haut à gauche), ouvrez Transport.
3. Regardez la société affichée en haut à droite, puis cliquez dessus.
4. Ouvrez ensuite MB AxisPro Consulting (AxisPro) par le même menu.

Résultat attendu : Transport s'ouvre dans EGUITRA GROUP SARLU, sans liste « Livres ouverts » à choisir.
AxisPro s'ouvre dans MB AxisPro Consulting, de même.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## D. Tous les comptes internes : Mes demandes

### SOC-15. Déposer une remarque de recette

Objectif : vérifier qu'une demande se dépose et reçoit aussitôt son numéro.

Compte : test.comptable.

Données : type « Remarque de recette » ; application NIMOVA · Finance ; gravité « Mineure » ; titre
« SOC-15 : essai de dépôt » ; description « Essai du cahier de test, sans anomalie réelle. ».

1. Dans Finance, menu du compte > « Mes demandes ». La page « Mes demandes » s'ouvre, avec, à droite,
   « Comment une demande est suivie ».
2. Cliquez sur « Nouvelle demande ».
3. Choisissez le type, l'« Application concernée » et la « Gravité » ; lisez l'indication sous la
   gravité. Si la « Société concernée » est proposée, choisissez EGUITRA GROUP SARLU.
4. Remplissez « Titre » et « Description ». Le bouton « Déposer la demande » reste grisé tant que l'un
   des deux est vide.
5. Cliquez sur « Déposer la demande ».

Résultat attendu : la fiche de la demande s'ouvre avec le message « Demande DEM-… déposée.
L'accusé de réception paraîtra dans le fil dès sa prise en charge (engagement de prise en charge sous
1 jour ouvré, correction à la prochaine livraison planifiée). ». État « Déposée », gravité
« Mineure ». Dans « Échanges », la description apparaît comme premier message ; dans « Suivi »,
« Prise en charge : En attente ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-16. Compléter une demande et retrouver ses demandes

Objectif : vérifier que l'auteur complète le fil et retrouve ses demandes par état et par type.

Compte : test.comptable.

Données : la demande du scénario SOC-15.

1. Dans la fiche de la demande, écrivez « Précision : écran Ventes, vers 10 h. » dans le champ du
   bas, puis « Envoyer ».
2. Cliquez sur « Mes demandes » en haut de la fiche pour revenir à la liste.
3. Choisissez l'état « À traiter (déposées, en cours) », puis le type « Remarque de recette ».
4. Choisissez le type « Demande d'évolution ».

Résultat attendu : le message apparaît dans « Échanges », à votre nom (« Vous »). La liste montre la
demande avec son numéro, son type, l'application, « 1 message », sa gravité et son état. Avec le
type « Demande d'évolution », la liste affiche « Aucune demande dans cette sélection. » (si vous n'en
avez déposé aucune).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-17. Confirmer la résolution d'une demande

Objectif : vérifier que l'auteur clôt lui-même une demande résolue.

Compte : test.comptable, après le scénario SOC-20 joué par test.admin.

Données : la demande du scénario SOC-15, résolue par l'administration.

1. Ouvrez « Mes demandes », puis la demande : son état est « Résolue ».
2. Lisez « Réponse du support », à droite.
3. Cliquez sur « Confirmer la résolution ».

Résultat attendu : l'encadré invite à confirmer la résolution ou à rouvrir la demande. Après
confirmation, l'état passe à « Close », « Close le » s'affiche dans « Suivi » et le fil indique
« Demande terminée : pour un nouveau besoin, déposez une nouvelle demande. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-18. Rouvrir une demande dont le problème persiste

Objectif : vérifier que l'auteur rouvre une demande résolue en disant ce qui ne va toujours pas.

Compte : test.comptable, avec une seconde demande résolue par test.admin.

Données : motif « Le problème se produit encore à l'impression. ».

1. Ouvrez la demande résolue.
2. Cliquez sur « Le problème persiste ».
3. Saisissez le motif, puis « Rouvrir la demande ».

Résultat attendu : « Rouvrir la demande » reste grisé tant que le motif est vide. Après l'envoi, la
demande n'est plus « Résolue » et le motif figure dans le fil.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-19. Voir les demandes de ses sociétés (direction)

Objectif : vérifier que la direction lit les demandes des comptes de ses sociétés, et les siennes
seules sur demande.

Compte : test.dg.

Données : la demande de test.comptable (SOC-15).

1. Dans Finance, menu du compte > « Mes demandes ».
2. Sous « Demandes affichées », choisissez « Mes sociétés », puis « Les miennes ».
3. Ouvrez la demande de test.comptable.

Résultat attendu : « Mes sociétés » montre aussi les demandes des autres comptes, avec la colonne
« Auteur » (nom et société). « Les miennes » ne garde que celles de test.dg. Dans la fiche de
test.comptable, le fil indique « Seuls l'auteur de la demande et le support écrivent dans ce
fil. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## E. Administration : traitement des demandes

### SOC-20. Prendre en charge et résoudre une demande

Objectif : vérifier le traitement d'une demande et l'accusé de réception dans le fil de l'auteur.

Compte : test.admin.

Données : la demande du scénario SOC-15 ; réponse « Essai traité : aucune correction nécessaire. ».

1. Menu du compte > « Mes demandes ». Les onglets « Demandes » et « Synthèse » s'affichent.
2. Ouvrez la demande de test.comptable. À droite, le cadre « Traitement (administration) ».
3. Confirmez la « Gravité (à confirmer) », puis « Prendre en charge ».
4. Écrivez la réponse dans « Réponse écrite ». Avant cela, « Résoudre » reste grisé.
5. Cliquez sur « Résoudre ».
6. Ouvrez l'onglet « Synthèse » de « Mes demandes ».

Résultat attendu : après « Prendre en charge », l'état passe à « Prise en charge » et une ligne de
suivi s'inscrit dans le fil. Après « Résoudre », l'état est « Résolue » et la réponse s'affiche sous
« Réponse du support ». La « Synthèse » donne les demandes par état et par type et les délais de
prise en charge.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-21. Refuser une demande, avec confirmation

Objectif : vérifier qu'un refus demande une réponse et une confirmation, et qu'il est définitif.

Compte : test.admin, sur une demande déposée pour l'occasion par test.comptable.

Données : réponse « Demande hors du périmètre de l'offre. ».

1. Ouvrez la demande, écrivez la réponse dans « Réponse écrite », puis cliquez sur « Refuser ».
2. Dans la fenêtre « Refuser la demande ? », cliquez d'abord sur « Annuler ».
3. Recommencez et cliquez sur « Refuser ».
4. Avec test.comptable, ouvrez la demande.

Résultat attendu : la fenêtre précise que l'auteur lira le motif et que la demande ne pourra plus
être rouverte. « Annuler » ne change rien. Après « Refuser », l'état est « Refusée » ; test.comptable
lit le « Motif du refus » et ne peut plus écrire dans le fil.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## F. Tous les comptes internes : discussion

### SOC-22. Écrire à un collègue

Objectif : vérifier qu'une conversation à deux s'ouvre et que le message arrive de lui-même.

Compte : test.daf (navigateur 1) et test.comptable (navigateur 2).

Données : message « Bonjour, essai de la discussion (SOC-22). ».

1. test.daf : cliquez sur l'icône à bulles « Discussion », en haut de l'écran. Le panneau
   « Conversations » s'ouvre.
2. Cliquez sur « Nouvelle », choisissez « À deux », puis sous « À qui écrire ? » saisissez
   « Comptable » et choisissez « Test - Comptable ».
3. Écrivez le message dans « Votre message… » et appuyez sur Entrée.
4. test.comptable : attendez quelques secondes sans recharger la page.
5. test.comptable : ouvrez l'icône, puis la conversation. Répondez « Bien reçu. » en passant une
   ligne avec Maj + Entrée avant d'envoyer par Entrée.

Résultat attendu : la conversation porte la mention « Conversation à deux ». Chez test.comptable, un
chiffre apparaît sur l'icône en quelques secondes et disparaît une fois la conversation lue. Maj +
Entrée passe à la ligne sans envoyer. La réponse arrive chez test.daf de la même façon.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-23. Répondre à un message et retirer le sien

Objectif : vérifier la citation d'un message et le retrait d'un message envoyé.

Compte : test.comptable, dans la conversation du scénario SOC-22.

Données : aucune.

1. Survolez le message de test.daf et cliquez sur « Répondre ». La citation s'affiche au-dessus du
   champ ; écrivez une réponse et envoyez-la.
2. Sur votre propre message, cliquez sur « Retirer ». À la question « Retirer ce message ? »,
   cliquez sur « Retirer ».
3. Regardez la conversation avec test.daf.

Résultat attendu : la réponse montre l'extrait du message cité. Le message retiré affiche « Message
retiré par vous. » chez test.comptable et « Message retiré par son auteur. » chez test.daf ; son
texte n'est plus lisible.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-24. Joindre un fichier à un message

Objectif : vérifier que les formats admis passent et que les autres sont refusés avec un message
clair.

Compte : test.daf.

Données : un fichier PDF ; une archive .zip ; un fichier de plus de 20 Mo.

1. Dans une conversation, cliquez sur le trombone « Joindre des fichiers », choisissez le PDF et
   envoyez.
2. Recommencez avec l'archive .zip (dans la fenêtre de choix, affichez « Tous les fichiers »).
3. Recommencez avec le fichier de plus de 20 Mo.

Résultat attendu : le PDF arrive et s'ouvre chez le correspondant. L'archive est refusée : « (nom du
fichier) : format refusé. Formats acceptés : PDF, JPEG, PNG, Word (.docx) ou Excel (.xlsx).
Enregistrez le document dans l'un de ces formats. ». Le gros fichier est refusé : « (nom du
fichier) : fichier trop volumineux (20 Mo au plus). ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-25. Créer un groupe et en gérer les membres

Objectif : vérifier qu'un groupe se crée, que son créateur en est le responsable et qu'il en gère seul
les membres.

Compte : test.daf (responsable), puis test.comptable.

Données : nom « Clôture d'octobre (essai) » ; membres Test - Comptable et Test - Direction générale.

1. test.daf : « Nouvelle », « Groupe ». Saisissez le « Nom du groupe », ajoutez les deux membres sous
   « Membres du groupe », puis « Créer le groupe ».
2. Écrivez un premier message.
3. Cliquez sur « Membres (3) ». Vérifiez la mention « Responsable » à côté de votre nom.
4. test.comptable : ouvrez le groupe, puis « Membres (3) ».
5. test.comptable : cliquez sur « Quitter la conversation », puis sur « Quitter ».
6. test.daf : dans « Membres », ajoutez de nouveau Test - Comptable avec « Ajouter un collègue ».

Résultat attendu : le bouton « Créer le groupe » reste grisé sans nom ou sans membre. Chez test.daf,
« Renommer », « Retirer » (pour chaque membre) et « Ajouter un collègue » sont proposés ; chez
test.comptable, ils ne le sont pas. Avant de quitter, la question « Quitter ce groupe ? Seul son
responsable pourra vous y ajouter de nouveau. » s'affiche. Rajouté, test.comptable relit tout
l'historique.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-26. Discuter d'une fiche

Objectif : vérifier que le bouton « Discussion » d'une fiche ouvre la conversation de la fiche à ceux
qui peuvent la lire.

Compte : test.chantiers et test.daf.

Données : le chantier « Entrepôt de stockage (démo) ».

1. test.chantiers : Finance > Métiers > BTP, ouvrez le chantier, puis cliquez sur « Discussion ».
2. Écrivez « Point sur la situation du mois (essai). » et envoyez.
3. test.daf : ouvrez le même chantier, puis « Discussion ».
4. test.daf : dans la conversation, cliquez sur le lien qui ouvre la fiche.

Résultat attendu : le panneau s'ouvre sur « Discussion de la fiche », avec la mention « Discussion de
la fiche, ouverte à ses lecteurs ». test.daf y lit le message de test.chantiers et peut répondre. Le
lien ramène à l'écran BTP. Le même bouton existe sur une rotation (Transport), un bien (Immobilier)
et un dossier (AxisPro).

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-27. Ouvrir la discussion en pleine page

Objectif : vérifier la page « Discussion » et que la discussion ne retient pas la session.

Compte : test.comptable.

Données : une conversation existante.

1. Ouvrez le panneau de discussion, puis « Pleine page ».
2. Recherchez une conversation dans le champ « Collègue, groupe, fiche… ».
3. Laissez la page ouverte, sans toucher à rien, pendant une minute, alors que test.daf vous envoie un
   message.

Résultat attendu : la page « Discussion » rappelle que seuls les membres d'une conversation la
lisent, l'administration comprise. La recherche filtre la liste. À l'étape 3, le message arrive,
puis la question « Êtes-vous toujours là ? » s'affiche quand même : l'arrivée d'un message ne compte
pas comme une activité.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## G. Refus attendus

### SOC-28. Application non ouverte au profil

Objectif : vérifier qu'un compte ne peut pas ouvrir une application que son profil n'ouvre pas.

Compte : test.consultant.

Données : aucune.

1. Ouvrez l'adresse de la recette (connexion à Finance) et connectez-vous avec test.consultant.
2. Ouvrez l'adresse de la recette suivie de /axispro et connectez-vous : l'accueil ne montre pas de
   rayon Finance.
3. Dans la barre d'adresse du navigateur, remplacez la fin de l'adresse par /finance et validez.
4. Cliquez sur le bouton proposé.

Résultat attendu : à l'étape 1, « Votre profil ne donne pas accès à cette application. ». À l'étape
3, la page « Accès non ouvert à votre profil » s'affiche : « Votre profil ne donne pas accès à NIMOVA
· Finance. Si votre travail le demande, l'administrateur de la plateforme peut vous ouvrir ce
profil. ». Aucun chiffre de Finance n'est montré. Le bouton « Aller à MB AxisPro Consulting » ouvre
AxisPro.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-29. Collègue d'une autre société non proposé

Objectif : vérifier que la discussion ne propose que des collègues qui partagent une société avec
vous.

Compte : test.consultant (MB AxisPro Consulting seulement).

Données : le collègue « Test - Agent de parc » (EGUITRA GROUP SARLU seulement).

1. Ouvrez la discussion, « Nouvelle », « À deux ».
2. Sous « À qui écrire ? », saisissez « parc ».
3. Saisissez ensuite « directeur » ou « Direction ».

Résultat attendu : « Test - Agent de parc » n'est pas proposé (« Aucun collègue à proposer. »). Test -
Direction générale, ouvert aux deux sociétés, est proposé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-30. Conversation fermée à l'administration

Objectif : vérifier que l'administration ne lit pas une conversation dont elle n'est pas membre.

Compte : test.admin.

Données : la conversation à deux de test.daf et test.comptable (SOC-22).

1. Ouvrez la discussion de test.admin et parcourez la liste « Conversations ».
2. Recherchez « Comptable » dans le champ de recherche de la liste.

Résultat attendu : la conversation entre test.daf et test.comptable n'apparaît pas. test.admin ne
voit que ses propres conversations.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-31. Pas de discussion ni de demandes pour le salarié et le porteur

Objectif : vérifier que la discussion interne est réservée aux comptes internes qui ont un profil, et
« Mes demandes » aux comptes internes.

Compte : test.salarie, puis test.porteur.

Données : aucune.

1. test.salarie : ouvrez l'adresse de la recette suivie de /rh et connectez-vous. Regardez la barre
   du haut de « Mon espace ».
2. test.porteur : ouvrez l'adresse de la recette suivie de /portail et connectez-vous. Ouvrez le menu
   de votre compte.

Résultat attendu : test.salarie ne voit pas l'icône de discussion. test.porteur ne voit ni l'icône de
discussion ni « Mes demandes » : il écrit au cabinet par « Messages » du portail.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## H. Contrôles de saisie et de sécurité

### SOC-32. Message clair en cas de coupure du réseau

Objectif : vérifier qu'une coupure du réseau est annoncée par un message en français.

Compte : test.comptable.

Données : un poste dont on peut couper le Wi-Fi ou débrancher le câble réseau.

1. Ouvrez la page « Connexion » et saisissez l'identifiant et le mot de passe.
2. Coupez le réseau du poste, puis cliquez sur « Se connecter ».
3. Rétablissez le réseau et cliquez de nouveau sur « Se connecter ».

Résultat attendu : à l'étape 2, le message « Réseau indisponible : vérifiez la connexion puis
réessayez. » s'affiche ; aucun message en anglais ni code. Le bouton redevient cliquable. À l'étape
3, la connexion aboutit.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### SOC-33. Un double clic ne dépose qu'une demande

Objectif : vérifier qu'un double clic sur un bouton d'enregistrement n'enregistre qu'une fois.

Compte : test.comptable.

Données : type « Question » ; titre « SOC-33 : double clic » ; description « Essai du double clic. ».

1. « Mes demandes » > « Nouvelle demande ». Remplissez la demande.
2. Double-cliquez rapidement sur « Déposer la demande ».
3. Revenez à la liste « Mes demandes ».

Résultat attendu : le bouton tourne pendant l'envoi ; une seule demande « SOC-33 : double clic »
figure dans la liste.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## Synthèse

| Partie {52} | Scénarios {12} | Réussis {12} | Échoués {12} | Non joués {12} |
|---|---|---|---|---|
| A. Tous les profils : connexion et compte | 8 | | | |
| B. Tous les profils : déconnexion après inactivité | 3 | | | |
| C. Direction et finance : société de travail | 3 | | | |
| D. Tous les comptes internes : Mes demandes | 5 | | | |
| E. Administration : traitement des demandes | 2 | | | |
| F. Tous les comptes internes : discussion | 6 | | | |
| G. Refus attendus | 4 | | | |
| H. Contrôles de saisie et de sécurité | 2 | | | |
| Total | 33 | | | |

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
