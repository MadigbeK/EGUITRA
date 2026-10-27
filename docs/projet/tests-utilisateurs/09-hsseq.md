# Cahier de test : HSSEQ

NIMOVA · HSSEQ (hygiène, santé, sécurité, environnement, qualité) et le verrou de départ de NIMOVA ·
Transport, pour EGUITRA GROUP SARLU et MB AxisPro Consulting.

Cockpit, événements et enquêtes, contrôles avant départ, verrou de départ et dérogations, plan
d'actions, habilitations, documents et urgences, audits et conformité, environnement, rapport mensuel
au format du donneur d'ordre, risques, revue de direction, télématique ; refus attendus par profil.

| Rubrique {28} | À remplir {72} |
|---|---|
| Module | HSSEQ (NIMOVA · HSSEQ) et verrou de départ (NIMOVA · Transport) |
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
« (démo) ». Rien de ce que vous y faites ne touche les vrais dossiers : vous pouvez tout essayer, y
compris les erreurs.

1. Se connecter. test.dg, test.parc et test.exploitation : ouvrez, dans Chrome ou Edge, l'adresse de
   la recette communiquée par E-VOLUTION XP, puis la tuile « Cockpit HSSEQ » du rayon HSSEQ de
   l'accueil (la tuile « Transport » du rayon Transport pour NIMOVA · Transport). test.hsseq et
   test.auditeur n'ont pas Finance : ouvrez l'adresse de la recette suivie de /hsseq. Identifiant :
   le compte de test indiqué dans le scénario. Mot de passe : le mot de passe commun de la recette,
   remis par l'administrateur.
2. Société. Les données de démonstration sont celles d'EGUITRA GROUP SARLU. test.hsseq est ouvert aux
   deux sociétés : travaillez dans EGUITRA GROUP SARLU, sauf mention contraire.
3. Dates. Les données de démonstration sont datées par rapport au jour de leur chargement (« il y a
   douze jours », « dans dix jours ») : une échéance lue peut différer de quelques jours de celle
   annoncée ici.
4. Verrou de départ. La partie B met le verrou en service sur la recette (HSE-11), puis le remet en
   l'état (HSE-19). Pendant ce temps, une rotation chargée ce jour-là ne se valide qu'après son départ
   en route : jouez la partie B d'une traite, après avoir prévenu les testeurs du cahier Transport. Le
   contrôle avant départ et l'alcootest se saisissent au téléphone, sur NIMOVA Terrain, qui n'est pas
   encore installable : HSE-17 écarte ces deux motifs pour le seul site de démonstration, le temps du
   test.
5. Jouer un scénario. Suivez les étapes dans l'ordre, avec les données indiquées. Un scénario à deux
   comptes se joue dans deux navigateurs (Chrome et Edge) ou sur deux postes. Notez les références
   créées (EVT/…, ACT/…) : d'autres scénarios s'en servent.
6. Noter le résultat. Cochez « Réussi » si l'écran correspond au résultat attendu, sinon « Échoué ».
   Dans « Remarques », notez ce qui diffère : l'écran, le message affiché, l'heure.
7. Signaler une anomalie. Menu du compte (rond à vos initiales, en haut à droite) > « Mes demandes »
   > « Nouvelle demande », type « Remarque de recette », application NIMOVA · HSSEQ (ou NIMOVA ·
   Transport pour les départs), la gravité ; titre commençant par le numéro du scénario (par exemple
   « HSE-14 : dérogation non proposée ») ; description ; « Déposer la demande ». Reportez le numéro
   reçu (DEM-…) dans les remarques.

## Comptes de test

| Compte {18} | Profil {22} | Périmètre {26} | Rôle dans ce cahier {34} |
|---|---|---|---|
| test.hsseq | Responsable HSSEQ | les deux sociétés | classement, enquêtes, dérogations, rapport mensuel, paramètres |
| test.parc | Exploitation | chef de parc du « Parc de Matoto (démo) » | déclarations, départs, demandes de dérogation, levées |
| test.exploitation | Exploitation | chef de parc du même site | rotations, responsable des actions de démonstration |
| test.dg | Direction | les deux sociétés | lecture, dépenses d'actions, revue de direction |
| test.auditeur | Auditeur HSSEQ, lecture seule | « Parc de Matoto (démo) », trente jours | refus |
| test.conducteur | Conducteur, téléphone seul | EGUITRA GROUP SARLU | refus |

Données fictives utiles : site « Parc de Matoto (démo) » et ses trois ensembles ; événements
« Recul sans guide au dépôt (démo) » (presque-accident, déclaré), « Câble électrique arraché près des
pompes (démo) » (situation dangereuse, en enquête) et « Sortie de route à Kindia (démo) » (accident de
la route, criticité élevée, deux actions dont une en retard) ; un contrôle avant départ bloquant
(« Plaques et étiquettes de danger en place », « Plaque arrachée (démo) ») et un alcootest négatif de
« Mamady Keïta (démo) » ; procédure « PR-HSE-DEMO-01 », « Dépotage d'une citerne (démo) » ; plan
« Déversement au dépotage (démo) » et deux exercices ; audit « Audit interne du parc (démo) » ; deux
exigences ; un déversement, un déchet et deux mesures de poussières ; deux risques ; revue « Revue de
direction du trimestre (démo) » ; deux violations de conduite ; modèle de rapport « Modèle générique de
donneur d'ordre (démo) ». Conducteurs : « Alpha Diallo (démo) » à jour, « Ousmane Bangoura (démo) »
avec les matières dangereuses échues.

## A. Cockpit et événements

### HSE-01. Lire le cockpit HSSEQ

Objectif : vérifier que le cockpit donne ce qui est à traiter, les indicateurs et la situation du
jour.

Compte : test.hsseq.

Données : aucune.

1. Ouvrez NIMOVA · HSSEQ, Pilotage > Cockpit.
2. Lisez les compteurs d'événements, puis les blocs « Départs du jour », « Actions en retard » et
   « Échéances à 30 jours ».
3. Parcourez « Indicateurs », « Risques et conformité », « Environnement, urgences et terrain »,
   « Comité mensuel », « Criticité des événements de la période » et « Dérogations au verrou ».
4. Dans « Période », passez de « Mois » à « 12 mois glissants » ; dans « Site », choisissez « Parc de
   Matoto (démo) » ; puis « Effacer les filtres ».
5. Cliquez sur le compteur des événements à classer.

Résultat attendu : la page « Cockpit HSSEQ » s'affiche, avec au moins un « événement déclaré à
classer », un « événement de criticité élevée ouvert » et une action en retard (« Recyclage conduite
défensive des conducteurs de la ligne Kindia (démo) »). Les chiffres suivent la période et le site
choisis. Le compteur ouvre la liste des événements déclarés.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-02. Déclarer un presque-accident

Objectif : vérifier la déclaration d'un événement depuis le bureau et l'estimation de sa criticité.

Compte : test.parc.

Données : type « Presque-accident » ; titre « Citerne garée sur le passage piéton (essai) » ; date et
heure : il y a une heure ; site « Parc de Matoto (démo) » ; lieu « Entrée du parc » ; description « Un
piéton a dû contourner la citerne par la voie de circulation. » ; gravité potentielle 4, probabilité 3.

1. Ouvrez Maîtrise des risques > Événements, puis « Déclarer un événement ».
2. Remplissez « Type d'événement », « Titre », « Date et heure », « Site », « Lieu » et
   « Description ». Laissez « Domaine » sur « Déduit du type ».
3. Dans « Gravité et probabilité », choisissez la « Gravité potentielle » et la « Probabilité » ;
   lisez le texte qui s'affiche.
4. Cliquez sur « Déclarer l'événement ».

Résultat attendu : à l'étape 3, « Criticité potentielle indicative : » apparaît avec l'effet du
niveau (« Criticité significative : enquête 5 Pourquoi sous 7 jours… »). La fenêtre rappelle « Le
Responsable HSSEQ est notifié de toute déclaration. ». La fiche de l'événement s'ouvre, avec une
référence EVT/… et le statut « Déclaré ». Notez la référence.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-03. Corriger sa déclaration avant le classement

Objectif : vérifier que le déclarant corrige sa déclaration tant qu'elle n'est pas classée.

Compte : test.parc.

Données : l'événement de HSE-02 ; nouveau lieu « Entrée du parc, côté pompes ».

1. Ouvrez la fiche de l'événement de HSE-02.
2. Cliquez sur « Corriger la déclaration ».
3. Dans la fenêtre « Corriger la déclaration … », modifiez « Lieu », puis « Enregistrer ».

Résultat attendu : la fiche montre le nouveau lieu ; le statut reste « Déclaré ». La fenêtre de
correction ne propose ni les notes ni les photos.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-04. Classer l'événement et lire sa criticité

Objectif : vérifier le classement par le Responsable HSSEQ, la criticité retenue et l'échéance
d'enquête qui en découle.

Compte : test.hsseq, puis test.parc.

Données : l'événement de HSE-02 ; gravité réelle 1 ; case gravité 4, probabilité 3 de la matrice.

1. test.hsseq : ouvrez la fiche, puis « Classer l'événement ». L'onglet « Classement » s'ouvre.
2. Choisissez la « Gravité réelle », puis cliquez sur la case de la matrice. Lisez « Criticité : » et
   l'encadré qui suit.
3. Cliquez sur « Classer l'événement ».
4. Ouvrez les onglets « Résumé » (carte « Échéances ») et « Notifications ».
5. test.parc : rouvrez la fiche.

Résultat attendu : la criticité est « Significative · 12 » (gravité potentielle multipliée par la
probabilité). Le statut passe à « Classé », l'échéance de l'enquête tombe sept jours après la
déclaration et « Notifications » liste « Criticité significative : Citerne garée sur le passage
piéton (essai) ». Chez test.parc, « Corriger la déclaration » n'est plus proposé et l'onglet
« Classement » montre la « Criticité retenue » en lecture.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-05. Conduire l'enquête et passer aux actions

Objectif : vérifier qu'une enquête ne passe aux actions qu'avec sa cause racine.

Compte : test.hsseq.

Données : l'événement « Câble électrique arraché près des pompes (démo) », en enquête ; trois
pourquoi au choix ; cause racine « Pas de rangement prévu pour les rallonges (essai) ».

1. Ouvrez la fiche, onglet « Enquête ». Lisez la carte « Conduite de l'enquête » (méthode, échéance).
2. Cliquez sur « Passer aux actions », puis confirmez.
3. Dans la carte « 5 Pourquoi », cliquez sur « Pourquoi 1 », « Pourquoi 2 », « Pourquoi 3 » et
   remplissez-les. Remplissez « Cause racine » et « Conclusion ».
4. Regardez « Passer aux actions », puis cliquez sur « Enregistrer l'enquête ».
5. Cliquez sur « Passer aux actions ». Lisez la fenêtre « Conclure l'enquête et passer aux actions ? »,
   puis confirmez.

Résultat attendu : à l'étape 2, le passage est refusé : « Renseignez la cause racine avant de passer
aux actions. ». À l'étape 4, « Passer aux actions » est grisé (« Enregistrez d'abord l'enquête. »),
puis « Enquête enregistrée. » s'affiche. À l'étape 5, le statut passe à « Actions en cours » et
l'enquête ne se modifie plus.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-06. Clôturer sans enquête un événement de criticité faible, puis le rouvrir

Objectif : vérifier la clôture directe d'un événement faible et la réouverture motivée.

Compte : test.hsseq.

Données : l'événement « Recul sans guide au dépôt (démo) », déclaré ; gravité réelle 1 ; case
gravité 1, probabilité 2 ; motif « Fait nouveau signalé par le chef de dépôt (essai) ».

1. Ouvrez la fiche, « Classer l'événement », choisissez les notes, puis « Classer l'événement ».
2. Cliquez sur « Clôturer ». Lisez la fenêtre « Clôturer l'événement … ? », puis confirmez.
3. Regardez la frise du cycle.
4. Cliquez sur « Rouvrir ». Laissez « Motif de la réouverture » vide, puis remplissez-le et
   « Rouvrir ».

Résultat attendu : l'encadré annonce « Criticité faible : enregistrement et suivi statistique ;
clôture directe possible sans action. ». Après la clôture, la frise marque l'enquête et les actions
« Sans objet » et le statut est « Clôturé ». « Rouvrir » reste grisé sans motif ; rouvert, l'événement
revient à « Classé ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-07. Immobiliser un véhicule après un événement de criticité élevée

Objectif : vérifier l'immobilisation d'un ensemble le temps de l'enquête, puis sa remise en service
motivée.

Compte : test.hsseq.

Données : l'événement « Sortie de route à Kindia (démo) » ; motif de la levée « Pare-chocs remplacé,
essai de freinage fait par l'atelier (essai) ».

1. Ouvrez la fiche. Lisez l'encadré de criticité élevée et regardez si « Clôturer » est proposé.
2. Ouvrez l'onglet « Actions ».
3. Cliquez sur « Immobiliser … ». Lisez la fenêtre, puis confirmez par « Immobiliser … ».
4. Ouvrez Maîtrise des risques > Immobilisations.
5. Sur l'ensemble, « Remettre en service ». Essayez d'abord un motif de trois lettres, puis le motif
   prévu, et « Remettre en service ».

Résultat attendu : « Clôturer » n'est pas proposé ; l'onglet « Actions » indique « La clôture de
l'événement attend la clôture ou l'annulation de 2 actions ouvertes. ». Après l'immobilisation, la
fiche annonce l'ensemble « immobilisé depuis le … ». Immobilisations le liste « En cours », avec la
mention que le motif V09 n'est pas encore activé. Un motif trop court est refusé (« Le motif de la
levée est obligatoire. ») ; ensuite,
« … remis en service : le motif V09 ne bloque plus ses départs. » et la ligne passe dans « Remises en
service ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-08. Enregistrer le coût d'un événement

Objectif : vérifier la saisie des coûts d'un événement et leur total.

Compte : test.hsseq.

Données : l'événement « Sortie de route à Kindia (démo) » (coût « Pare-chocs (démo) » de 4 500 000
GNF déjà saisi) ; coût « Franchise », libellé « Franchise de l'assureur (essai) », 1 000 000 GNF, à la
date du jour.

1. Ouvrez la fiche, onglet « Coûts ».
2. Dans « Ajouter un coût », remplissez « Nature », « Libellé », « Montant (GNF) » et « Date », puis
   « Ajouter ».
3. Sur la ligne ajoutée, « Retirer » : lisez la question, puis fermez sans confirmer.

Résultat attendu : le coût apparaît dans « Coûts enregistrés » ; la tuile « Franchise » et « Total
(GNF) » (5 500 000) se mettent à jour. Fermée sans confirmer, la fenêtre de retrait ne change rien.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## B. Contrôles avant départ et verrou de départ

### HSE-09. Lire un contrôle avant départ et sa non-conformité bloquante

Objectif : vérifier la lecture d'un contrôle saisi au parc et du point critique qui bloque le départ.

Compte : test.hsseq.

Données : les deux contrôles de démonstration.

1. Ouvrez Maîtrise des risques > Contrôles, onglet « Contrôles réalisés ».
2. Ouvrez le contrôle dont le résultat est « Bloquant ». Lisez l'encadré, puis « Réponses point par
   point ».
3. Ouvrez l'onglet « Non-conformités », filtre « Ouvertes », bascule « Bloquantes seulement ».
4. Notez le nom de l'ensemble concerné : les scénarios suivants s'en servent.

Résultat attendu : l'autre contrôle est « Conforme ». La fiche du contrôle bloquant annonce « Départ
de … bloqué (motif V02) », marque « Plaques et étiquettes de danger en place » comme « Point
critique » non conforme, avec le commentaire « Plaque arrachée (démo) », et porte « Photos
manquantes ». La non-conformité est ouverte, avec « Départ bloqué » sous l'ensemble.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-10. Lire les alcootests selon le profil

Objectif : vérifier que le résultat chiffré d'un alcootest n'est lu que par le Responsable HSSEQ.

Compte : test.hsseq, puis test.parc.

Données : l'alcootest de démonstration de « Mamady Keïta (démo) ».

1. test.hsseq : Contrôles, onglet « Alcootests ». Lisez l'encadré et les colonnes.
2. test.parc : même écran.

Résultat attendu : chez test.hsseq, « Détail chiffré réservé au Responsable HSSEQ : chaque lecture
de cette liste est journalisée. … », avec les colonnes « Résultat », « Taux (mg/L) » et « Appareil »
(« Négatif », « Éthylotest (démo) »). Chez test.parc, « Statut seul : ni résultat chiffré, ni
appareil, ni heure. Le détail est réservé au Responsable HSSEQ. » : la colonne « Statut » indique
« Conforme », sans taux ni appareil.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-11. Mettre le verrou de départ en service

Objectif : vérifier qu'avant sa mise en service le verrou informe sans bloquer, et qu'ensuite il
bloque le départ.

Compte : test.exploitation, test.parc, puis test.hsseq.

Données : une rotation du jour sur l'ensemble noté en HSE-09 : chauffeur « Alpha Diallo (démo) » ;
client « Démo - Distributeur pétrolier A » ; route « Conakry - Kankan (démo) » ; gasoil ; date de
chargement : aujourd'hui ; bon de livraison « BL-HSE-001 » ; volume chargé 33.

1. test.exploitation : NIMOVA · Transport, Exploitation > Rotations, « Nouvelle rotation » ;
   saisissez la rotation, puis « Enregistrer ».
2. test.parc : NIMOVA · Transport, Exploitation > « Départs du jour ». Lisez l'encadré et l'état de
   la ligne.
3. test.hsseq : NIMOVA · HSSEQ, Administration > Paramètres, onglet « Réglages », « Société » EGUITRA
   GROUP SARLU. Si « Verrou de départ en service à partir du » porte déjà une date, notez-la et
   passez à l'étape 4 ; sinon, saisissez la date du jour, puis « Enregistrer les réglages ».
4. test.parc : rechargez « Départs du jour ».

Résultat attendu : à l'étape 2, « Verrou pas encore en service pour 1 départ : … Elles partent comme
avant ; leurs motifs s'affichent pour information. » (si le verrou était déjà en service, la ligne
est déjà « Bloqué »). À l'étape 3, « Réglages de EGUITRA GROUP SARLU
enregistrés. » et « Verrou de départ en service pour les rotations chargées à partir du … ». À
l'étape 4, la ligne passe à « Bloqué » et le chiffre « Bloqués » compte la rotation.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-12. Lire le détail d'un départ bloqué

Objectif : vérifier que le chef de parc voit chaque motif, qui le lève et s'il se déroge, que
Transport refuse la validation avant le départ et que la direction ne fait que lire.

Compte : test.parc, puis test.dg.

Données : la rotation de HSE-11.

1. Dans « Départs du jour », cliquez sur la ligne. La fenêtre « Départ de … » s'ouvre.
2. Cliquez sur « Vérifier à nouveau ». Lisez le bandeau, puis chaque motif (« Source », « Depuis »,
   « Lève ce motif », « Dérogation »).
3. Ouvrez NIMOVA · Transport, Exploitation > Rotations, puis la fiche de la rotation.
4. Cliquez sur « Valider ».
5. test.dg : NIMOVA · Transport, « Départs du jour », cliquez sur la même ligne.

Résultat attendu : bandeau « Départ bloqué ». « Point critique du contrôle avant départ non
conforme » (V02) est « Bloquant », levé par le « Chef de parc après correction, photo obligatoire »,
dérogation « Possible, sur demande du chef de parc ». Le contrôle avant départ (V01) et l'alcootest
(V03) sont « Non fait », « Jamais dérogeable », avec le rappel que ces saisies se font sur NIMOVA
Terrain. Dans Transport, la fiche affiche « Départ impossible pour l'instant : » et « Départ en
route » est grisé ; la validation est refusée : « Validation refusée pour la rotation … : Départ non
enregistré : la rotation passe « en route » avant d'être validée. ». Chez test.dg, ni « Faire partir »
ni « Demander une dérogation » : « Le chef de parc du site ou l'administration fait partir la
rotation ; vous lisez l'état du départ. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-13. Faire partir malgré un motif bloquant

Objectif : vérifier que le serveur refuse un départ tant qu'un motif bloquant reste ouvert.

Compte : test.parc.

Données : la rotation de HSE-11.

1. Dans la fenêtre « Départ de … », cliquez sur « Faire partir ».
2. Lisez la fenêtre « Faire partir … ? », puis confirmez par « Faire partir ».

Résultat attendu : la fenêtre prévient que le serveur vérifie le verrou une dernière fois. Le départ
est refusé : « Départ refusé par le serveur à … », chaque motif marqué « Dérogeable » ou « Jamais
dérogeable » ; « Faire partir » est grisé. La rotation reste en saisie.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-14. Demander une dérogation

Objectif : vérifier qu'un chef de parc demande une dérogation sur un seul motif dérogeable, avec un
motif écrit.

Compte : test.parc.

Données : la rotation de HSE-11 ; motif écrit court « Plaque à venir » ; puis « Plaque de danger
commandée, pose provisoire faite et vérifiée par le chef de parc (essai) ».

1. Dans la fenêtre « Départ de … », cliquez sur « Demander une dérogation ».
2. Lisez la liste « Motif à déroger, un seul par demande » et l'encadré des motifs jamais dérogeables.
3. Choisissez V02, saisissez le motif écrit court, puis « Valider ma demande ».
4. Remplacez-le par le motif complet, puis « Valider ma demande ».
5. Ouvrez NIMOVA · HSSEQ, Maîtrise des risques > Dérogations.

Résultat attendu : seul V02 est proposé ; l'encadré rappelle « Jamais dérogeables : contrôle avant
départ non réalisé (V01), alcootest non réalisé ou positif (V03). ». À l'étape 3, « Le motif écrit
compte 30 caractères au moins ; … pour l'instant. ». À l'étape 4, « Demande … envoyée : votre
validation compte pour 1 sur 2. La seconde revient au Responsable HSSEQ, une autre personne … » et
V02 passe « Attente Responsable HSSEQ ». Dans HSSEQ, la demande figure avec « 1 validation sur 2 ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-15. Refuser une dérogation avec un motif

Objectif : vérifier le refus motivé d'une dérogation par le Responsable HSSEQ.

Compte : test.hsseq, puis test.parc.

Données : la demande de HSE-14 ; motif du refus « Plaque provisoire non conforme à l'affichage exigé
(essai) ».

1. test.hsseq : Dérogations, onglet « À valider », ouvrez la demande. Lisez « Première validation »,
   « Seconde validation » et « Portée ».
2. Cliquez sur « Refuser », laissez « Motif du refus, obligatoire » vide, puis « Confirmer le refus ».
3. Remplissez le motif, puis « Confirmer le refus ».
4. test.parc : dans la fenêtre « Départ de … », « Vérifier à nouveau ».

Résultat attendu : la première validation est celle de test.parc (« La demande vaut première
validation. »), la seconde « En attente du Responsable HSSEQ, une autre personne que le demandeur ».
Sans motif : « Le motif du refus est obligatoire. ». Ensuite : « Dérogation refusée : le chef de parc
lit le motif du refus. » et la demande passe dans « Refusées ». Chez test.parc, la dérogation porte
« Refusée : » suivi du motif ; V02 redevient « Bloquant ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-16. Accorder une dérogation par une seconde personne

Objectif : vérifier qu'une dérogation devient active après la seconde validation, pour ce seul motif
et cette seule rotation.

Compte : test.parc, puis test.hsseq.

Données : la rotation de HSE-11 ; motif écrit « Plaque de danger réglementaire posée, photo jointe au
contrôle complémentaire (essai) ».

1. test.parc : nouvelle demande de dérogation sur V02, puis « Valider ma demande ».
2. test.hsseq : Dérogations, onglet « À valider », ouvrez la demande, puis « Valider la dérogation » ;
   confirmez.
3. test.parc : dans la fenêtre « Départ de … », « Vérifier à nouveau ». Lisez la section
   « Dérogations de la rotation ».

Résultat attendu : « Dérogation active pour … jusqu'au …. Le Directeur général est informé. » ; la
dérogation passe dans « Actives ». Chez test.parc, V02 porte « Sous dérogation », dérogation « Active
pour cette rotation », validée par les deux comptes, « pour ce seul motif et cette seule rotation »,
jusqu'à la fin prévue de la rotation. V01 et V03 restent ouverts.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-17. Faire partir une rotation dont les motifs sont levés ou couverts

Objectif : vérifier le départ en route une fois chaque motif bloquant levé ou couvert, et le réglage
d'un motif par site.

Compte : test.hsseq, puis test.parc.

Données : la rotation de HSE-16 ; site « Parc de Matoto (démo) ».

1. test.hsseq : Paramètres, onglet « Motifs du verrou ». Sur V01, « Par site » : dans « Sites du
   motif V01 », décochez « Parc de Matoto (démo) », puis « Enregistrer ». Faites de même pour V03.
2. test.parc : dans la fenêtre « Départ de … », « Vérifier à nouveau ».
3. Cliquez sur « Faire partir », puis confirmez.
4. Revenez à « Départs du jour », puis ouvrez la fiche de la rotation dans Transport.

Résultat attendu : à l'étape 1, « Motif V01 désactivé sur 1 site. » ; la colonne « Sites » indique
« Hors Parc de Matoto (démo) ». À l'étape 2, « Départ autorisé » : « Tous les motifs bloquants sont
levés ou couverts par une dérogation active. ». Après le départ, « En route » : « Rotation en route
depuis … Le serveur a vérifié le verrou au départ. ». La ligne indique « Parti à … » ; la fiche
Transport, « Partie le … (départ donné par Test - Agent de parc). ». Si un autre motif bloquant
apparaît (habilitation, document du véhicule), notez-le : il se lève ou se déroge de la même façon.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-18. Lever une non-conformité avec la photo de la correction

Objectif : vérifier que la levée d'un point critique exige la photo de la correction.

Compte : test.parc.

Données : la non-conformité de HSE-09 ; une photo JPEG ; correction « Plaque de danger réglementaire
reposée (essai) ».

1. Ouvrez NIMOVA · HSSEQ, Contrôles, onglet « Non-conformités », puis « Lever » sur la
   non-conformité.
2. Dans « Lever la non-conformité », regardez le bouton de confirmation.
3. Cliquez sur « Ajouter la photo de la correction », choisissez la photo, puis remplissez
   « Correction réalisée (obligatoire) ».
4. Cliquez sur « Lever la non-conformité ».

Résultat attendu : tant que la photo ou la correction manque, « Lever la non-conformité » est grisé.
Ensuite, « Non-conformité « Plaques et étiquettes de danger en place » levée sur … ». La
non-conformité passe dans « Levées » ; la fiche du contrôle n'annonce plus le blocage V02.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-19. Rétablir les motifs et remettre le verrou hors service

Objectif : vérifier qu'un motif s'applique de nouveau à tous les sites et que le verrou se remet hors
service, pour rendre la recette aux autres testeurs.

Compte : test.hsseq.

Données : la date notée en HSE-11 (vide si le verrou n'était pas en service).

1. Paramètres, onglet « Motifs du verrou ». Sur V01, « Par site » : recochez « Parc de Matoto
   (démo) », puis « Enregistrer ». Faites de même pour V03.
2. Onglet « Réglages », « Société » EGUITRA GROUP SARLU : remettez « Verrou de départ en service à
   partir du » à sa valeur notée en HSE-11, puis « Enregistrer les réglages ».

Résultat attendu : « Motif V01 appliqué sur tous les sites. », puis de même pour V03 ; la colonne
« Sites » indique « Tous les sites ». Avec la date vidée, la carte « Mise en service » indique
« Verrou de départ pas encore en service : Transport fait partir les rotations comme avant, les
motifs s'affichent pour information. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## C. Plan d'actions

### HSE-20. Lire et filtrer le plan d'actions

Objectif : vérifier le registre unique des actions, ses onglets, ses filtres et le retard.

Compte : test.hsseq.

Données : les deux actions de démonstration de « Sortie de route à Kindia (démo) ».

1. Ouvrez Maîtrise des risques > Plan d'actions. Lisez les onglets « À traiter », « À vérifier »,
   « Closes », « Annulées » et « Toutes ».
2. Activez la bascule « En retard », puis retirez-la.
3. Dans « Origine », choisissez « Événement » ; dans « Responsable », choisissez Test - Responsable
   exploitation transport.
4. Cliquez sur une action : sa fiche s'ouvre à côté de la liste.

Résultat attendu : « Recyclage conduite défensive des conducteurs de la ligne Kindia (démo) » est en
retard (colonne « Retard » en jours) ; « Consigne de vitesse par temps de pluie, signée par les
conducteurs (démo) » ne l'est pas. Chaque ligne cite son origine et son responsable. La page rappelle
les relances à J-7, le jour de l'échéance puis chaque semaine, et l'escalade au Directeur général
au-delà de 30 jours de retard.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-21. Démarrer et clore une action avec sa preuve

Objectif : vérifier qu'une action ne se clôt qu'avec sa preuve et passe en vérification d'efficacité
quand son origine est grave.

Compte : test.exploitation (responsable de l'action).

Données : l'action « Recyclage conduite défensive des conducteurs de la ligne Kindia (démo) » ; une
feuille d'émargement en PDF.

1. Ouvrez Plan d'actions, puis la fiche de l'action. Cliquez sur « Démarrer ».
2. Cliquez sur « Clore l'action ». Lisez la fenêtre « Clore l'action … » et regardez son bouton de
   confirmation.
3. Cliquez sur « Joindre la preuve » et choisissez le PDF. Lisez la mention sur la criticité de
   l'origine.
4. Cliquez sur « Clore l'action ».

Résultat attendu : « Action démarrée. », statut « En cours ». Sans preuve, « Aucune preuve jointe :
l'action ne peut pas être close sans elle. » et « Clore l'action » est grisé. Avec la preuve, la
fenêtre annonce « Origine de criticité 8 ou plus : l'action passera « À vérifier » … », puis « Action
réalisée : vérification d'efficacité dans 90 jours. » ; l'action passe dans l'onglet « À vérifier ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-22. Faire valider une action coûteuse par la direction

Objectif : vérifier qu'une action au-delà du seuil de coût ne démarre qu'après la validation de la
direction.

Compte : test.hsseq, test.exploitation, puis test.dg.

Données : l'action « Consigne de vitesse par temps de pluie, signée par les conducteurs (démo) », à
faire ; coût estimé 60 000 000 GNF (au-delà du seuil affiché sous le champ, 50 000 000 GNF par
défaut).

1. test.hsseq : ouvrez la fiche, « Modifier », saisissez le « Coût estimé (GNF) », puis
   « Enregistrer ».
2. test.exploitation : ouvrez la fiche, puis « Démarrer ».
3. test.dg : ouvrez la fiche, puis « Valider la dépense ». Lisez la fenêtre « Valider l'action
   coûteuse », puis « Valider ».
4. test.exploitation : rouvrez la fiche.

Résultat attendu : à l'étape 1, « Action mise à jour. », la fiche porte « À valider » et l'avis
« Action coûteuse : … La direction la valide avant son démarrage ». À l'étape 2, le démarrage est
refusé : « Action coûteuse : la direction la valide avant son démarrage. ». À l'étape 3, « Action
validée par la direction : son responsable peut la démarrer. ». À l'étape 4, « Démarrer » aboutit.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-23. Annuler une action, puis la rouvrir avec un motif

Objectif : vérifier que l'annulation et la réouverture d'une action exigent un motif.

Compte : test.hsseq.

Données : l'action de HSE-22 ; motifs « Remplacée par une consigne commune (essai) », puis « Consigne
commune abandonnée (essai) ».

1. Ouvrez la fiche, puis « Annuler l'action ». Saisissez trois lettres dans « Motif (obligatoire) »,
   puis le motif complet, et « Annuler l'action ».
2. Ouvrez l'onglet « Annulées ».
3. Ouvrez la fiche, « Rouvrir », saisissez le second motif, puis « Rouvrir l'action ».

Résultat attendu : le bouton reste grisé sous cinq caractères. « Action annulée. » ; l'action figure
dans « Annulées ». Rouverte : « Action rouverte : elle revient en cours. », statut « En cours ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## D. Habilitations, documents et urgences

### HSE-24. Lire la matrice des habilitations

Objectif : vérifier que HSSEQ lit les habilitations tenues par RH et le départ qui en découle, sans
rien y modifier.

Compte : test.hsseq.

Données : les conducteurs de démonstration.

1. Ouvrez Personnel et conformité > Habilitations, onglet « Matrice des compétences ».
2. Lisez « Conducteurs en poste », « Habilitations à jour », « À renouveler » et « Départ refusé
   (V04) ».
3. Lisez les lignes d'« Ousmane Bangoura (démo) » et d'« Alpha Diallo (démo) », dont « Aptitude
   médicale » et « Départ ».
4. Activez la bascule « Départ refusé », puis « Effacer les filtres ».

Résultat attendu : le bandeau rappelle que les habilitations et l'aptitude se saisissent dans NIMOVA
· RH. Ousmane Bangoura (démo) a les matières dangereuses « Échue » et un départ « Bloqué » ; Alpha
Diallo (démo) est « Autorisé ». L'aptitude ne montre qu'un statut (« Apte », « À revoir » ou « Non
apte »). La bascule ne garde que les conducteurs au départ refusé. Aucun bouton ne modifie une
habilitation.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-25. Suivre les échéances des habilitations

Objectif : vérifier les alertes d'échéance et la matrice réduite du chef de parc.

Compte : test.hsseq, puis test.parc.

Données : aucune.

1. test.hsseq : Habilitations, onglet « Alertes d'échéance ». Lisez le texte d'en-tête, puis les
   colonnes « Échéance », « Concerne », « Alerte » et « À l'échéance ».
2. Dans « Nature des échéances », choisissez « Habilitations », puis « Documents des véhicules ».
3. test.parc : ouvrez Habilitations.

Résultat attendu : les alertes partent 30 puis 7 jours avant chaque échéance (« J-30 », « J-7 »),
avec le motif du verrou ouvert le jour de l'échéance ; à défaut, « Aucune alerte envoyée : aucune
échéance dans les 30 jours. ». Chez test.parc, ni onglets ni alertes : la matrice indique
« Conducteurs des ensembles de vos sites. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-26. Accuser lecture d'une procédure

Objectif : vérifier qu'un compte visé lit une procédure en vigueur et en accuse lecture.

Compte : test.parc, puis test.hsseq.

Données : la procédure « PR-HSE-DEMO-01 », « Dépotage d'une citerne (démo) ».

1. test.parc : ouvrez Personnel et conformité > Documents et urgences, onglet « À lire ».
2. Sur la procédure, « Télécharger le document », puis « J'ai lu la procédure ». Lisez la fenêtre
   « Accuser lecture de PR-HSE-DEMO-01 ? », puis confirmez.
3. test.hsseq : onglet « Procédures », ouvrez la procédure. Lisez « Lecture de la version 1 ».

Résultat attendu : le document s'ouvre. La fenêtre précise que l'accusé est daté et ne se retire
pas ; la procédure porte ensuite « Lecture accusée le … ». Chez test.hsseq, test.parc figure dans
« Lectures accusées », les autres comptes visés dans « Pas encore lu ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-27. Publier une nouvelle version d'une procédure

Objectif : vérifier qu'une version ne se publie qu'avec son document et redemande la lecture aux
comptes visés.

Compte : test.hsseq, puis test.parc.

Données : la procédure « PR-HSE-DEMO-01 » ; version 2, date d'effet du jour, changements « Ajout du
contrôle du bac de rétention (essai) » ; un PDF.

1. test.hsseq : fiche de la procédure, « Nouvelle version ». Remplissez « Numéro de version », « Date
   d'effet » et « Changements apportés », puis « Créer la version ».
2. Regardez « Publier la version 2 ».
3. Dans « Version en brouillon », « Joindre le document » et choisissez le PDF.
4. Cliquez sur « Publier la version 2 », puis confirmez par « Publier ».
5. test.parc : onglet « À lire ».

Résultat attendu : sans document, « Publier la version 2 » est grisé (« Joignez d'abord le document de
la version »). Ensuite : « Document joint à la version 2 : elle peut être publiée. », puis « Version 2
publiée : sa lecture est demandée à … comptes visés. ». La version 1 passe dans « Versions
remplacées ». Chez test.parc, la procédure revient à lire.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-28. Diffuser une alerte flash anonymisée

Objectif : vérifier que la diffusion est refusée tant que le texte désigne un véhicule ou une
personne.

Compte : test.hsseq.

Données : nature « Alerte flash » ; titre « Recul sans guide sur le quai (essai) » ; texte « DEMO-01 a
reculé sans guide sur le quai de chargement. » ; à retenir « Pas de recul sans guide. » ; profils
visés « Chefs de parc ».

1. Documents et urgences, onglet « Alertes et retours d'expérience », « Nouvelle alerte ».
2. Remplissez « Nature », « Titre », « Ce qui s'est passé », « Ce qu'il faut retenir » et « Profils
   visés », puis « Créer le brouillon ».
3. Lisez le contrôle d'anonymat de la fiche, puis « Diffuser » et confirmez.
4. « Modifier le brouillon » : remplacez « DEMO-01 » par « Une citerne », puis « Enregistrer ».
5. « Diffuser », puis confirmez.

Résultat attendu : à l'étape 3, « Diffusion refusée en l'état : le texte cite encore 1 élément qui
désignent une personne ou un véhicule. » (immatriculation ou code d'ensemble « DEMO-01 »), tampon
« Noms à retirer » ; la diffusion est refusée. Après correction, « Contrôle d'anonymat : aucun nom de
personne ni aucune immatriculation relevés … », puis « Alerte flash diffusée à … comptes visés. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-29. Déclarer réalisé un exercice d'urgence et en tirer une action

Objectif : vérifier le bilan d'un exercice, l'action qui en découle et l'annuaire de crise.

Compte : test.hsseq.

Données : le plan « Déversement au dépotage (démo) » et son exercice planifié ; 6 participants ; 20
minutes ; bilan « Alerte en 2 minutes, kit du quai 2 toujours incomplet (essai). » ; action
« Compléter le kit antidéversement du quai 2 (essai) », confiée à Test - Responsable exploitation
transport, échéance dans un mois, preuve attendue « Photo du kit complet ».

1. Documents et urgences, onglet « Plans d'urgence et exercices ». Lisez les chiffres, puis la liste
   « Exercices ».
2. Ouvrez l'exercice planifié, « Déclarer réalisé ». Dans « Exercice … réalisé », remplissez « Réalisé
   le » (aujourd'hui), « Participants », « Durée (minutes) » et « Bilan », puis « Déclarer réalisé ».
3. Cliquez sur « Nouvelle action », remplissez la fenêtre, puis « Créer l'action ».
4. Ouvrez l'onglet « Annuaire de crise ».

Résultat attendu : « Exercice déclaré réalisé : tirez de son bilan les actions du plan. », puis
« Action ACT/… créée, confiée à Test - Responsable exploitation transport. » ; l'action figure dans
« Actions de l'exercice » et au plan d'actions, origine « Exercice d'urgence ». L'annuaire classe les
contacts par ordre d'appel, « Tous les sites » puis le site de démonstration.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## E. Audits, conformité et environnement

### HSE-30. Couvrir un écart majeur par une action, puis clore l'audit

Objectif : vérifier qu'un audit ne se clôt qu'une fois chaque écart majeur couvert par une action.

Compte : test.hsseq.

Données : l'« Audit interne du parc (démo) », réalisé ; son constat « Aucun exercice d'urgence depuis
18 mois (démo) » ; action « Programmer un exercice d'urgence par trimestre (essai) », confiée à Test -
Responsable exploitation transport.

1. Ouvrez Personnel et conformité > Audits et conformité, onglet « Programme d'audits », puis l'audit.
2. Lisez le bandeau et regardez si « Clore l'audit » est proposé.
3. Dans « Constats », ouvrez l'écart majeur, puis « Nouvelle action ». Remplissez « Action »,
   « Responsable », « Échéance » et « Preuve attendue », puis « Créer l'action ».
4. Revenez à l'audit, cliquez sur « Clore l'audit », lisez la question, puis confirmez.

Résultat attendu : à l'étape 2, « Écart majeur sans action : … L'audit ne se clôt qu'une fois chacun
couvert par une action (ni annulée). » ; « Clore l'audit » n'est pas proposé. À l'étape 3, « Action
… ajoutée au plan d'actions. ». À l'étape 4, la fenêtre prévient que les constats ne se modifieront
plus, puis « Audit clos. » et le statut « Clos ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-31. Planifier un audit, le déclarer réalisé et y ajouter un constat

Objectif : vérifier le programme d'audits et le classement des constats.

Compte : test.hsseq.

Données : intitulé « Audit ISO 14001 du parc (essai) » ; référentiel « ISO 14001, environnement » ;
prévu le jour même ; site « Parc de Matoto (démo) » ; auditeur interne Test - Responsable HSSEQ ;
constat « Écart mineur », « Fûts d'huile sans étiquette au magasin (essai) ».

1. Audits et conformité, « Planifier un audit ». Remplissez « Intitulé », « Référentiel », « Prévu
   le », « Site », « Auditeur » (« Interne ») et « Périmètre », puis « Planifier l'audit ».
2. Sur la fiche, « Déclarer réalisé » ; dans « Audit … réalisé », laissez la date du jour, puis
   « Déclarer réalisé ».
3. « Ajouter un constat » : choisissez le « Classement », remplissez « Constat », puis « Ajouter le
   constat ».

Résultat attendu : l'audit s'ouvre au statut « Planifié », puis « Audit déclaré réalisé : saisissez
ses constats et sa conclusion. ». Le constat s'ajoute (« Constat ajouté à l'audit. ») avec une
référence en -C01, statut « Ouvert » tant qu'aucune action ne le solde.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-32. Revoir la conformité d'une exigence

Objectif : vérifier la revue d'une exigence du registre et sa preuve.

Compte : test.hsseq.

Données : l'exigence « Déclaration annuelle des déchets dangereux (démo) » ; conformité « Partiellement
conforme » ; constat « Déclaration préparée, pas encore déposée (essai) » ; un PDF.

1. Audits et conformité, onglet « Exigences », ouvrez l'exigence.
2. « Joindre une preuve » : choisissez le PDF.
3. « Revoir la conformité » : choisissez la « Conformité constatée », remplissez « Constat de la
   revue », laissez la « Prochaine revue » proposée, puis « Enregistrer la revue ».

Résultat attendu : « Preuve jointe à l'exigence. », puis « Revue de conformité enregistrée. ». La
fiche indique « Partiellement conforme », la date de la dernière revue et la prochaine, environ un an
plus tard.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-33. Déclarer un déversement, puis le clore

Objectif : vérifier la déclaration d'un déversement par le chef de parc et sa clôture par le
Responsable HSSEQ.

Compte : test.parc, puis test.hsseq.

Données : survenu il y a une heure ; site « Parc de Matoto (démo) » ; lieu « Aire de lavage (essai) » ;
produit « Gasoil » ; volume déversé 20 ; volume récupéré 25, puis 15 ; récupération « Absorbant
répandu, terre mise en fût (essai) ».

1. test.parc : Environnement et terrain > Environnement et qualité, onglet « Déversements »,
   « Déclarer un déversement ».
2. Remplissez « Survenu le », « Site », « Lieu », « Produit », « Volume déversé (L) » et « Volume
   récupéré (L) » (25). Lisez le message, corrigez à 15, laissez « Récupération et confinement »
   vide, puis « Déclarer le déversement ».
3. Ouvrez la fiche du déversement.
4. test.hsseq : ouvrez la même fiche, « Clore le déversement », remplissez « Récupération et
   confinement », puis « Clore le déversement ».

Résultat attendu : avec 25 litres, « Entre zéro et le volume déversé. ». La fiche indique « 20 L
déversés, 15 L récupérés. » (75 %) et « La récupération et le confinement restent à décrire : le
Responsable HSSEQ ne clôt pas le déversement sans eux. ». Ensuite, « Déversement clos. », statut
« Clos ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-34. Enregistrer l'enlèvement d'un déchet avec son bordereau

Objectif : vérifier qu'un enlèvement ne s'enregistre qu'avec son prestataire, son numéro et son
bordereau joint.

Compte : test.parc.

Données : le déchet « Fûts au magasin (démo) » (huiles usagées, 400 litres) ; prestataire
« Prestataire d'essai » ; bordereau « BSD-ESSAI-01 » ; un PDF.

1. Environnement et qualité, onglet « Déchets ». Lisez « huiles usagées entreposées ».
2. Ouvrez le déchet, puis « Enregistrer l'enlèvement ».
3. Remplissez « Enlevé le », « Prestataire » et « Numéro du bordereau » ; regardez le bouton de
   confirmation.
4. « Joindre le bordereau » : choisissez le PDF, puis « Enregistrer l'enlèvement ».

Résultat attendu : sans bordereau joint, « Enregistrer l'enlèvement » est grisé. Ensuite,
« Enlèvement enregistré : le déchet sort des quantités entreposées. » ; le déchet est « Enlevé »,
« Bordereau joint », et les huiles entreposées baissent de 400 litres.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-35. Saisir une mesure de poussières au-dessus du seuil

Objectif : vérifier le calcul du dépassement d'une mesure de poussières.

Compte : test.parc.

Données : site « Parc de Matoto (démo) » ; point « Entrée du parc (essai) » ; unité mg/m³ ; valeur
12,5 ; seuil 10.

1. Environnement et qualité, onglet « Poussières », « Saisir une mesure ».
2. Remplissez « Site », « Mesuré le », « Point de mesure », « Valeur mesurée (mg/m³) » et « Seuil
   (mg/m³) ». Lisez l'aperçu.
3. Cliquez sur « Enregistrer la mesure ».
4. Cochez « Dépassements seulement ».

Résultat attendu : l'aperçu annonce « Seuil dépassé » avant l'enregistrement. La mesure figure avec
« Seuil dépassé » ; la case ne garde que les dépassements (dont le relevé de démonstration à 11,2),
pas celui à 6,5, « Sous le seuil ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-36. Répondre à une réclamation client et la clore

Objectif : vérifier le délai de réponse d'une réclamation et sa clôture.

Compte : test.hsseq.

Données : client « Démo - Distributeur pétrolier A » ; nature « Retard de livraison » ; gravité
« Mineure » ; reçue le jour même ; réclamation « Livraison arrivée avec un jour de retard (essai) » ;
réponse « Retard dû à une panne, nouvelle tournée planifiée (essai) ».

1. Environnement et qualité, onglet « Réclamations », « Nouvelle réclamation ». Remplissez la
   fenêtre, puis « Enregistrer la réclamation ».
2. Lisez la colonne « Réponse ».
3. Ouvrez la réclamation, « Répondre au client », remplissez « Réponse au client », puis
   « Enregistrer la réponse ».
4. « Clore la réclamation », lisez la question, puis « Clore ».

Résultat attendu : la réclamation est « Reçue », réponse attendue « Avant le … », quinze jours plus
tard par défaut. « Réponse au client enregistrée. », statut « Répondue », « Dans le délai ». Puis
« Réclamation close. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## F. Rapport mensuel du donneur d'ordre

### HSE-37. Lire le rapport du mois en cours, avant le gel du 5

Objectif : vérifier qu'un mois en cours se saisit au fil du mois mais ne se valide qu'après le gel de
ses valeurs calculées, le 5 du mois suivant.

Compte : test.hsseq.

Données : le modèle « Modèle générique de donneur d'ordre (démo) » ; le mois en cours.

1. Ouvrez Pilotage > Rapport mensuel. Dans « Modèle du donneur d'ordre », choisissez le modèle de
   démonstration.
2. Dans la frise des mois, survolez le mois en cours, puis ouvrez-le.
3. Lisez la carte du mois et le bandeau d'état ; cherchez « Valider le mois ».
4. Dans « Indicateurs d'… », comparez la ligne P-2 (calculée) et la ligne P-1 (saisie). Passez de
   « Mois et cumul » à « Mois par mois ».

Résultat attendu : le mois porte « En cours » ; sa carte indique « Valeurs calculées provisoires :
elles se figent le … », le 5 du mois suivant. Le bandeau dit « Mois en cours : saisissez au fil du
mois. La validation s'ouvre le …, quand les valeurs calculées se figent. » et liste les valeurs
restant à saisir. « Valider le mois » n'est pas proposé. P-2 porte « calculé par nimova » sous son
libellé et n'a pas de case de saisie ; P-1 a une case « À saisir ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-38. Ajuster le modèle du donneur d'ordre

Objectif : vérifier la modification d'un modèle : premier mois, nouvel indicateur saisi, numéro
unique.

Compte : test.hsseq.

Données : le modèle de démonstration ; premier mois : le mois précédent ; indicateur « P-1 », puis
« P-5 », libellé « Visites de sécurité de la direction (essai) », proactif, saisi chaque mois, unité
« nbre », plan de 2 chaque mois.

1. Rapport mensuel, « Modifier le modèle ». Dans les paramètres, onglet « Modèles de rapport », ouvrez
   le modèle (« Modifier ») s'il n'est pas déjà ouvert.
2. Dans « Premier mois du rapport », choisissez le mois précédent (s'il figure déjà dans la frise,
   gardez la valeur).
3. « Ajouter un indicateur proactif » : saisissez « P-1 » dans « N° » ; lisez le message ; remplacez
   par « P-5 ».
4. Remplissez « Libellé », « Nature », « Valeur » (« Saisi chaque mois »), « Unité » ; dans « Même
   plan chaque mois », saisissez 2, puis « Appliquer aux douze mois » ; « Valider l'indicateur ».
5. Cliquez sur « Enregistrer ».

Résultat attendu : à l'étape 3, « Déjà pris dans ce modèle, retirés compris. … ». « Valider
l'indicateur » reporte P-5 dans la liste ; seul « Enregistrer » envoie le modèle : « Modèle « Modèle
générique de donneur d'ordre (démo) » enregistré. ». Au rapport mensuel, la frise montre le mois
précédent et P-5 apparaît dans « 1. Indicateurs proactifs ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-39. Saisir les valeurs et les commentaires d'un mois clos

Objectif : vérifier la saisie des valeurs du mois, l'état de chaque indicateur et l'historique.

Compte : test.hsseq.

Données : le mois précédent ; P-1 : 1 ; P-4 : 1 ; P-5 : 2 ; R-3 : 0 ; commentaire de R-1 « Aucun
accident de la route (essai) » ; commentaire du mois « Mois sans accident ; contrôles à renforcer
(essai) ».

1. Rapport mensuel, ouvrez le mois précédent dans la frise.
2. Lisez le bandeau d'état.
3. Saisissez les valeurs dans « Réalisé … », le commentaire de R-1, puis le commentaire du mois dans
   « Faits marquants, explications des écarts, décisions ». Lisez le bandeau « Saisies non
   enregistrées » et regardez « Valider le mois ».
4. Cliquez sur « Enregistrer ». Dépliez « Historique du mois ».

Résultat attendu : le mois porte « À valider » ; « Mois clos : complétez les valeurs saisies et les
commentaires, puis validez le rapport. ». Avant l'enregistrement, « Valider le mois » est grisé
(« Enregistrez d'abord vos saisies. »). Ensuite, « Saisies enregistrées. » ; chaque ligne porte son
état (« Conforme », « Sous surveillance », « Non conforme » ou « Sans donnée ») et l'historique une
ligne « saisie de … » par valeur.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-40. Valider le mois

Objectif : vérifier la validation du rapport du mois et le gel de ses valeurs calculées.

Compte : test.hsseq.

Données : le mois de HSE-39.

1. Cliquez sur « Valider le mois ». Lisez la fenêtre « Valider le rapport de … », puis confirmez par
   « Valider le mois ».
2. Lisez la carte du mois, le bandeau et la frise ; cherchez les cases de saisie.

Résultat attendu : la fenêtre prévient qu'une fois validé, le rapport ne se modifie plus sans
réouverture motivée (et cite les valeurs saisies manquantes, s'il en reste). « Rapport de … validé. »
s'affiche ; « Valeurs calculées figées le … » ; le bandeau « Validé le … par Test - Responsable
HSSEQ. Rouvrir le mois exige un motif, inscrit au journal. » ; la frise marque le mois « Validé ».
Plus aucune case de saisie.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-41. Rouvrir un mois validé avec un motif

Objectif : vérifier que la réouverture exige un motif, l'inscrit au journal et garde les valeurs
calculées figées.

Compte : test.hsseq.

Données : le mois validé de HSE-40 ; motif « Err », puis « Correction de la valeur de P-1 (essai) » ;
P-1 corrigé à 2.

1. Cliquez sur « Rouvrir le mois ». Dans « Rouvrir le rapport de … », saisissez « Err » dans « Motif
   (obligatoire) » et regardez le bouton.
2. Saisissez le motif complet, puis « Rouvrir le mois ».
3. Corrigez P-1, « Enregistrer », puis « Valider le mois » de nouveau.
4. Dépliez « Historique du mois ».

Résultat attendu : sous cinq caractères, « Rouvrir le mois » est grisé. Ensuite, « Rapport de …
rouvert : il revient en brouillon. » ; les valeurs calculées restent celles figées. Le mois se valide
de nouveau. L'historique montre « mois rouvert : « Correction de la valeur de P-1 (essai) » », la
saisie corrigée et les deux validations.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-42. Exporter le rapport en Excel et en PDF

Objectif : vérifier les exports au format du donneur d'ordre.

Compte : test.hsseq, puis test.dg.

Données : le mois validé de HSE-41.

1. test.hsseq : sur le mois, cliquez sur « Excel » et ouvrez le classeur.
2. Cliquez sur « PDF » et ouvrez le document.
3. test.dg : ouvrez le même mois, puis « Excel » et « PDF ».

Résultat attendu : le classeur rapport_hsse_…_AAAA_MM.xlsx contient les feuilles « Synthèse comité »
(santé globale, points d'attention, tendance) et « Indicateurs » (plan et réalisé de chaque mois,
cumul, cible cumulée, état, commentaire du mois en pied). Le PDF, en paysage, porte la période,
l'état « Validé », « 1. Santé globale des indicateurs », « 2. Points d'attention prioritaires » et
« 3. Plan contre réalisé depuis janvier ». test.dg obtient les mêmes fichiers, sans rien pouvoir
saisir.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## G. Risques, revue de direction et télématique

### HSE-43. Inscrire un risque au registre et le mettre en vigueur

Objectif : vérifier la cotation d'un risque avant et après mesures, sa mise en vigueur et sa revue
par son propriétaire.

Compte : test.hsseq, puis test.exploitation.

Données : nature « Danger pour la sécurité » ; profil « Citerne » ; site « Parc de Matoto (démo) » ;
activité « Stationnement au parc (essai) » ; danger « Circulation de citernes près des piétons » ;
événement redouté « Piéton heurté par une citerne en manœuvre (essai) » ; avant mesures gravité 4,
probabilité 4 ; après mesures gravité 4, probabilité 5, puis 4 et 2 ; propriétaire Test - Responsable
exploitation transport ; mesure « Ingénierie », « Passage piéton balisé et séparé (essai) », « En
place ».

1. test.hsseq : Maîtrise des risques > Registre des risques, « Nouveau risque ». Remplissez la
   fenêtre ; dans « Cotation », choisissez la case « Avant mesures », puis la case « Après mesures »
   à probabilité 5 ; lisez le message ; choisissez la case à probabilité 2. « Créer le risque ».
2. « Ajouter une mesure » : choisissez le niveau, remplissez « Mesure » et « État », puis « Ajouter la
   mesure ».
3. « Mettre en vigueur », puis confirmez.
4. test.exploitation : ouvrez le risque, « Faire la revue » ; remplissez « Constat », gardez la date
   proposée, puis « Enregistrer la revue ».

Résultat attendu : une cotation après mesures plus forte que la brute est refusée (« La gravité et la
probabilité résiduelles ne dépassent pas les brutes : les mesures réduisent le risque. »). Le risque
est créé « À évaluer », criticité brute « Élevée · 16 », résiduelle « Significative · 8 ». « Mesure
ajoutée. », puis « Risque mis en vigueur : il entre au registre. ». Chez le propriétaire, « Revue
enregistrée : prochaine revue le … ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-44. Tenir et clore une revue de direction

Objectif : vérifier que la direction tient la revue, y inscrit ses décisions et la clôt.

Compte : test.dg.

Données : la « Revue de direction du trimestre (démo) », préparée ; compte rendu « Échanges sur les
indicateurs et les événements du trimestre (essai) » ; décision de nature « Ressources », « Recruter
un second animateur sécurité (essai) » ; conclusions « Système efficace, vigilance sur les
déversements (essai) ».

1. Ouvrez Pilotage > Revue de direction, puis la revue.
2. « Déclarer la revue tenue » : laissez « Aujourd'hui » et les participants présents cochés, puis
   « Déclarer la revue tenue ».
3. Lisez le bandeau « Avant de clore la revue : ».
4. « Compte rendu des échanges » : « Rédiger », saisissez le texte, « Enregistrer ». « Décisions et
   actions » : « Inscrire une décision », remplissez « Nature de la décision » et « Décision »,
   « Inscrire la décision ». « Conclusions de la direction » : « Rédiger », saisissez, « Enregistrer ».
5. « Clore la revue », confirmez, puis « Compte rendu (PDF) ».

Résultat attendu : « Revue tenue le … : éléments d'entrée figés. … ». Le bandeau liste « Compte rendu
des échanges », « Au moins une décision » et « Conclusions de la direction », puis « Tout est prêt :
la revue peut être close. ». « Décision inscrite. » ; après la clôture, « Revue close : son compte
rendu définitif se télécharge en PDF. » ; le PDF reprend les douze rubriques de la revue.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-45. Lire les violations de conduite et contrôler un fichier d'import

Objectif : vérifier la lecture des violations relevées par les boîtiers et le refus d'un fichier au
mauvais format.

Compte : test.hsseq.

Données : les deux violations de démonstration ; un fichier PDF quelconque.

1. Ouvrez Environnement et terrain > Télématique. Lisez « Violations pour 100 voyages », « Violations
   du mois, à ce jour » et « Dernier import ».
2. Onglet « Violations » : passez les bascules « Excès de vitesse » et « Freinage brusque ».
3. Cliquez sur « Importer un fichier », puis « Colonnes attendues ».
4. « Choisir le fichier » : dans la fenêtre de choix, affichez tous les fichiers et prenez le PDF,
   puis « Contrôler le fichier ».

Résultat attendu : les deux violations de source « Démonstration (démo) » s'affichent et les
bascules filtrent leur type. « Colonnes attendues » liste la date, le véhicule et le type, puis les
colonnes facultatives. Le PDF est refusé : « Formats acceptés : CSV ou Excel (.xlsx), sans macro. » ;
rien n'est importé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## H. Refus attendus

### HSE-46. L'auditeur lit sans rien modifier

Objectif : vérifier que l'auditeur externe lit HSSEQ en lecture seule, sans les noms des personnes ni
les alcootests.

Compte : test.auditeur.

Données : l'événement « Sortie de route à Kindia (démo) ».

1. Ouvrez l'adresse de la recette suivie de /hsseq et connectez-vous. Parcourez le menu.
2. Ouvrez Contrôles, puis le Cockpit (bloc « Départs du jour »).
3. Ouvrez la fiche de l'événement.
4. Événements, « Déclarer un événement » : remplissez le type, le titre, la date et la description,
   puis « Déclarer l'événement ».

Résultat attendu : le menu ne propose ni « Rapport mensuel », ni « Habilitations », ni
« Paramètres ». Contrôles n'a pas d'onglet « Alcootests » ; le cockpit indique « Le détail des départs
bloqués, qui nomme les conducteurs, n'est pas servi à votre profil. ». La fiche ne propose ni
« Clôturer », ni « Immobiliser … », ni « Corriger la déclaration », et ne nomme ni le déclarant ni
les personnes en cause. La déclaration est refusée : « Profil auditeur : lecture seule. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-47. L'auditeur ne lit que ses sites

Objectif : vérifier qu'un objet hors du périmètre de l'auditeur lui reste invisible.

Compte : test.hsseq, test.dg, puis test.auditeur.

Données : un événement sans site : type « Situation dangereuse », titre « Glissade au siège
(essai) », description « Sol mouillé sans signalisation. ».

1. test.hsseq : déclarez l'événement en laissant « Site » vide. Notez sa référence.
2. test.dg : Événements, cherchez la référence.
3. test.auditeur : Événements, cherchez la même référence ; puis remplacez la fin de l'adresse par
   /hsseq/habilitations.

Résultat attendu : test.dg voit l'événement. test.auditeur ne le voit pas : seuls les événements du
« Parc de Matoto (démo) » figurent dans sa liste. L'adresse des habilitations le ramène au cockpit,
sans rien afficher.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-48. L'auditeur n'entre plus après sa date de fin d'accès

Objectif : vérifier que l'accès de l'auditeur cesse à sa date de fin, puis reprend une fois
prolongé.

Compte : test.hsseq, puis test.auditeur.

Données : fin d'accès : hier ; puis dans trente jours.

1. test.hsseq : Paramètres, onglet « Auditeurs ». Lisez la ligne de test.auditeur (« Sites audités »,
   « Fin d'accès »).
2. Cliquez sur « Modifier » ; dans « Accès de … », saisissez la date d'hier dans « Fin d'accès », puis
   « Enregistrer ».
3. test.auditeur : déconnectez-vous, puis reconnectez-vous à l'adresse de la recette suivie de /hsseq.
4. test.hsseq : remettez « Fin d'accès » dans trente jours, « Enregistrer ». test.auditeur :
   reconnectez-vous.

Résultat attendu : « Accès de … enregistré. » ; la fin d'accès porte « Échue ». La connexion de
test.auditeur est refusée : « Votre profil ne donne pas accès à cette application. ». Après la
prolongation, la connexion aboutit.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-49. Le chef de parc n'ouvre ni le rapport mensuel ni les paramètres et ne classe pas

Objectif : vérifier ce qui reste fermé au chef de parc dans HSSEQ.

Compte : test.parc.

Données : un événement à l'état « Déclaré » du « Parc de Matoto (démo) » (au besoin, déclarez-en un
comme en HSE-02).

1. Parcourez le menu de NIMOVA · HSSEQ.
2. Remplacez la fin de l'adresse par /hsseq/rapports, puis par /hsseq/parametres.
3. Ouvrez la fiche d'un événement déclaré, onglet « Classement ».
4. Ouvrez Audits et conformité, puis Environnement et qualité ; regardez les onglets.
5. Ouvrez Dérogations et lisez le bandeau.

Résultat attendu : ni « Rapport mensuel », ni « Revue de direction », ni « Paramètres » au menu ; les
deux adresses ramènent au cockpit. La fiche ne propose pas « Classer l'événement » ; le classement
s'affiche en lecture. Pas d'onglet « Exigences » ni « Revue de direction » dans Audits et conformité ;
pas d'onglet « Manquants et contaminations » ni « Réclamations » dans Environnement et qualité.
Dérogations : « Vous suivez ici les dérogations de vos sites. Une demande se fait depuis Transport,
« Départs du jour », sur le départ concerné. », sans « Valider la dérogation ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-50. La direction lit sans décider à la place du Responsable HSSEQ

Objectif : vérifier que la direction consulte HSSEQ sans valider une dérogation, un rapport ou un
classement à la place du Responsable HSSEQ.

Compte : test.dg.

Données : les dérogations de HSE-15 et HSE-16 ; le rapport mensuel du mois en cours ; l'événement de
HSE-47, déclaré.

1. Ouvrez Dérogations (onglet « Actives » ou « Refusées »), puis une dérogation.
2. Ouvrez Rapport mensuel, mois en cours.
3. Ouvrez la fiche de l'événement de HSE-47.
4. Remplacez la fin de l'adresse par /hsseq/parametres.

Résultat attendu : Dérogations : « Lecture seule. Vous êtes informé de chaque dérogation à son
activation. … » ; la fiche ne propose que « Fermer ». Rapport mensuel : aucune case de saisie, ni
« Valider le mois » ni « Rouvrir le mois » ; le bandeau commence par « Rapport en brouillon : le
Responsable HSSEQ le complète ». La fiche ne propose pas « Classer l'événement ». Les paramètres
ramènent au cockpit.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-51. Le conducteur n'ouvre pas les écrans du bureau

Objectif : vérifier qu'un compte conducteur, réservé au téléphone, n'entre dans aucune application du
bureau.

Compte : test.conducteur.

Données : aucune.

1. Ouvrez l'adresse de la recette suivie de /hsseq et connectez-vous avec test.conducteur.
2. Recommencez avec l'adresse de la recette seule.

Résultat attendu : les deux connexions sont refusées : « Votre profil ne donne pas accès à cette
application. ». Aucune donnée n'est affichée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## I. Contrôles de saisie et de sécurité

### HSE-52. Déclaration incomplète, datée dans le futur ou avec une pièce refusée

Objectif : vérifier les contrôles de la déclaration d'un événement.

Compte : test.parc.

Données : une date et une heure de demain ; un document Word (.docx).

1. « Déclarer un événement », puis « Déclarer l'événement » sans rien remplir.
2. Remplissez le type, le titre et la description ; mettez la date de demain, puis « Déclarer
   l'événement ».
3. Dans « Photos », « Ajouter des photos » : choisissez le document Word.
4. « Annuler ».

Résultat attendu : étape 1, « Complétez les champs signalés. », avec « Choisissez le type. »,
« Donnez un titre court. » et « Décrivez l'événement. » sous les champs. Étape 2, « Date dans le
futur. » et « La date de l'événement ne peut pas être dans le futur. ». Étape 3, « … : format non
accepté (JPEG, PNG ou PDF) ». Rien n'est déclaré.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-53. Nombres et saisies non enregistrées dans le rapport mensuel

Objectif : vérifier qu'un nombre illisible est refusé et qu'une saisie non enregistrée n'est pas
perdue sans prévenir.

Compte : test.hsseq.

Données : le mois en cours ; P-1 : « deux », puis « 1,5 ».

1. Rapport mensuel, mois en cours : saisissez « deux » dans le réalisé de P-1. Lisez le bandeau et
   regardez « Enregistrer », « Excel » et « PDF ».
2. Remplacez par « 1,5 ».
3. Sans enregistrer, cliquez sur un autre mois de la frise. Lisez la fenêtre, puis « Annuler ».
4. Cliquez de nouveau sur un autre mois, puis « Abandonner ».

Résultat attendu : étape 1, la case est bordée de rouge, « Nombre illisible : P-1. », « Enregistrer »
est grisé ; « Excel » et « PDF » aussi (« Enregistrez d'abord vos saisies : l'export reprend le
rapport enregistré. »). « 1,5 » est accepté. La fenêtre « Saisies non enregistrées » demande
« Abandonner 1 saisie non enregistrée ? » : « Annuler » garde la saisie, « Abandonner » la perd et
change de mois.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-54. Un double clic ne déclare qu'un événement

Objectif : vérifier qu'un double clic n'enregistre qu'une fois.

Compte : test.parc.

Données : type « Situation dangereuse » ; titre « Extincteur absent du quai 1 (essai) » ; date et
heure : il y a une heure ; description « Support vide à l'entrée du quai. ».

1. « Déclarer un événement », remplissez la fenêtre, puis double-cliquez sur « Déclarer
   l'événement ».
2. Revenez au registre et cherchez « Extincteur absent du quai 1 (essai) ».

Résultat attendu : un seul événement porte ce titre.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### HSE-55. Message clair en cas de coupure du réseau

Objectif : vérifier qu'une coupure pendant un enregistrement est annoncée en français, sans perdre la
saisie.

Compte : test.hsseq.

Données : le mois en cours du rapport mensuel ; P-4 : 1.

1. Saisissez la valeur de P-4.
2. Coupez le réseau du poste, puis « Enregistrer ».
3. Rétablissez le réseau, puis « Enregistrer » de nouveau.

Résultat attendu : à l'étape 2, un message en français signale l'échec, sans texte en anglais ni
code ; la saisie reste dans le bandeau « Saisies non enregistrées ». À l'étape 3, « Saisies
enregistrées. » ; l'historique du mois ne porte la saisie qu'une fois.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## Synthèse

| Partie {52} | Scénarios {12} | Réussis {12} | Échoués {12} | Non joués {12} |
|---|---|---|---|---|
| A. Cockpit et événements | 8 | | | |
| B. Contrôles avant départ et verrou de départ | 11 | | | |
| C. Plan d'actions | 4 | | | |
| D. Habilitations, documents et urgences | 6 | | | |
| E. Audits, conformité et environnement | 7 | | | |
| F. Rapport mensuel du donneur d'ordre | 6 | | | |
| G. Risques, revue de direction et télématique | 3 | | | |
| H. Refus attendus | 6 | | | |
| I. Contrôles de saisie et de sécurité | 4 | | | |
| Total | 55 | | | |

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
