# Cahier de test : Analyse

NIMOVA · Analyse, pour EGUITRA GROUP SARLU et MB AxisPro Consulting.

Cockpit, sections d'analyse de chaque société, période et date d'arrêté, constats et leurs liens
« Voir », simulateur, export Excel et impression.

| Rubrique {28} | À remplir {72} |
|---|---|
| Module | Analyse (NIMOVA · Analyse) |
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
« Démo ». L'Analyse lit les données sans jamais les modifier : vous pouvez tout essayer.

1. Se connecter. Ouvrez l'adresse de la recette communiquée par E-VOLUTION XP, dans Chrome ou Edge,
   puis la tuile « Analyse » de l'accueil (test.consultant, qui n'a pas Finance, ouvre l'adresse de la
   recette suivie de /analyse). Identifiant : le compte de test indiqué dans le scénario. Mot
   de passe : le mot de passe commun de la recette, communiqué par E-VOLUTION XP.
2. Société. Le contenu de l'Analyse dépend de la société de travail, choisie en haut à droite :
   vérifiez-la avant chaque scénario.
3. Jouer un scénario. Suivez les étapes dans l'ordre. Les chiffres fictifs de la recette sont peu
   nombreux : jugez la cohérence et la clarté plus que les montants.
4. Noter le résultat. Cochez « Réussi » si l'écran correspond au résultat attendu, sinon « Échoué ».
   Dans « Remarques », notez ce qui diffère : l'écran, le message affiché, l'heure.
5. Signaler une anomalie. Menu du compte (rond à vos initiales, en haut à droite) > « Mes demandes »
   > « Nouvelle demande », type « Remarque de recette », application NIMOVA · Analyse, la gravité ;
   titre commençant par le numéro du scénario (par exemple « ANA-04 : lien Voir sans effet ») ;
   description ; « Déposer la demande ». Reportez le numéro reçu (DEM-…) dans les remarques.

## Comptes de test

| Compte {18} | Profil {18} | Sociétés {26} | Rôle dans ce cahier {38} |
|---|---|---|---|
| test.dg | Direction | les deux | toutes les sections des deux sociétés |
| test.daf | Finance | les deux | sections du groupe, honoraires du cabinet |
| test.consultant | Cabinet | MB AxisPro Consulting | sections du cabinet |
| test.exploitation | Exploitation | EGUITRA GROUP SARLU | refus |

## A. Direction générale

### ANA-01. Lire le cockpit du groupe

Objectif : vérifier que le cockpit répond en une phrase et montre la santé du groupe.

Compte : test.dg, société EGUITRA GROUP SARLU.

Données : période « Exercice ».

1. Ouvrez NIMOVA · Analyse > Synthèse > Cockpit.
2. Lisez la question « Où en est EGUITRA GROUP aujourd'hui ? » et la phrase de réponse.
3. Lisez « Score de santé », « Du chiffre d'affaires au résultat net », « Les métiers » et « Les
   constats qui comptent ».

Résultat attendu : la réponse est calculée sur la période. Le score de santé porte sur cinq axes ; la
cascade va du chiffre d'affaires au résultat net. Sans écritures, l'écran le dit (« Aucune écriture
validée sur la période ») au lieu d'afficher des zéros.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ANA-02. Changer la période et la date d'arrêté

Objectif : vérifier que tous les chiffres suivent la période choisie.

Compte : test.dg.

Données : périodes « Exercice », « 12 mois », « Trimestre », « Mois » ; date d'arrêté au dernier jour
du mois précédent.

1. Dans « Période », passez d'« Exercice » à « 12 mois », « Trimestre », puis « Mois ».
2. Dans « Arrêté au », choisissez le dernier jour du mois précédent.
3. Ouvrez une autre section, puis revenez au cockpit.

Résultat attendu : la réponse, les graphiques et les constats se recalculent à chaque choix ; les
comparaisons portent sur la même période un an plus tôt. La période choisie est gardée d'un écran à
l'autre.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ANA-03. Comprendre un constat

Objectif : vérifier qu'un constat dit sa gravité, son impact, sa confiance, l'action à mener et sa
méthode.

Compte : test.dg.

Données : un constat du cockpit.

1. Dans « Les constats qui comptent », lisez la gravité (« Critique », « Élevée », « Moyenne », « À
   noter » ou « Point fort »), l'impact en GNF et la confiance.
2. Lisez la ligne « Action : ».
3. Cliquez sur « Pourquoi ce constat ? ».

Résultat attendu : la méthode s'affiche (« Méthode : … ») ; aucune analyse n'est une boîte noire. Un
constat positif figure parmi les constats du cockpit.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ANA-04. Suivre le lien « Voir » d'un constat

Objectif : vérifier que le lien d'un constat ouvre l'écran de gestion où agir, dans la même société.

Compte : test.dg.

Données : un constat avec un lien « Voir » (par exemple sur les créances ou le transport).

1. Sur le constat, cliquez sur « Voir ».
2. Regardez l'écran ouvert et la société affichée en haut à droite.
3. Revenez à l'Analyse, passez à MB AxisPro Consulting, et suivez le « Voir » d'un constat du cabinet.

Résultat attendu : chaque lien ouvre l'écran concerné (par exemple Relances clients, Rentabilité du
transport, un dossier AxisPro), dans les livres de la société analysée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ANA-05. Parcourir les sections du groupe

Objectif : vérifier que chaque section pose sa question et y répond.

Compte : test.dg, société EGUITRA GROUP SARLU.

Données : aucune.

1. Ouvrez tour à tour, sous « EGUITRA GROUP » : « Rentabilité », « Trésorerie et prévision »,
   « Portefeuille clients », « Flotte et routes », « Dépenses et contrôles », « Atterrissage et
   simulateur », « Fiabilité des données ».
2. Pour chacune, lisez la question, la réponse, le graphique et les constats.

Résultat attendu : chaque section s'ouvre sans erreur avec sa question (par exemple « Où va la
trésorerie dans les 13 prochaines semaines ? », « Quelles routes et quels camions gagnent de
l'argent ? »). Les survols des graphiques donnent la valeur exacte.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ANA-06. Essayer le simulateur

Objectif : vérifier que le simulateur recalcule l'EBE selon les hypothèses, sans rien enregistrer.

Compte : test.dg.

Données : tarif +5 %, carburant +10 %, masse salariale −4 %.

1. Ouvrez « Atterrissage et simulateur », bloc « Simulateur : et si… ».
2. Déplacez les curseurs du tarif, du volume transporté, du carburant et de la masse salariale.
3. Essayez un scénario proposé (par exemple « Masse salariale −4 % »).

Résultat attendu : l'EBE recalculé suit chaque curseur. Sans douze mois de données, le bloc indique
« Simulateur indisponible » et l'explique. Rien n'est enregistré.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ANA-07. Exporter un écran dans Excel et l'imprimer

Objectif : vérifier l'export de toutes les données d'un écran et son impression.

Compte : test.dg.

Données : la section « Portefeuille clients », période « Exercice ».

1. Cliquez sur « Excel ». Ouvrez le classeur.
2. Revenez à l'écran et cliquez sur « Imprimer ».

Résultat attendu : le classeur porte un onglet de synthèse (société, période, fiabilité), un onglet
des constats et un onglet par tableau ou graphique ; les chiffres sont des nombres. L'impression est
propre, sans menus.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ANA-08. Passer à l'analyse du cabinet

Objectif : vérifier que l'Analyse change de contenu avec la société, et passe d'elle-même dans les
bons livres quand le compte y est ouvert.

Compte : test.dg.

Données : aucune.

1. En haut à droite, passez à MB AxisPro Consulting. Lisez le cockpit : « Où en est le portefeuille
   de projets du cabinet ? ».
2. Regardez le menu : les sections « MB AxisPro Consulting » remplacent celles du groupe.
3. Dans la barre d'adresse, remplacez la fin de l'adresse par /analyse/rentabilite.

Résultat attendu : à l'étape 3, l'écran annonce « Ouverture dans les livres de EGUITRA GROUP
SARLU… », puis ouvre la section Rentabilité du groupe : le compte y est ouvert.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ANA-09. Lire la qualité des données et passer en mode nuit

Objectif : vérifier la pastille de fiabilité d'un écran et le mode d'affichage.

Compte : test.dg.

Données : aucune.

1. Sur un écran, lisez la pastille « Qualité des données … / 100 » et ses réserves.
2. Cliquez sur « Mode nuit », puis revenez en mode clair.

Résultat attendu : la pastille donne une note de 0 à 100 et les réserves (par exemple des pièces sans
imputation analytique). Le mode nuit garde tout lisible.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## B. Finance

### ANA-10. Améliorer la fiabilité des données

Objectif : vérifier les contrôles de fiabilité et l'effet d'une correction.

Compte : test.daf, société EGUITRA GROUP SARLU.

Données : une réserve corrigeable (par exemple une pièce sans imputation analytique).

1. Ouvrez « Fiabilité des données » : lisez la question « Peut-on se fier aux chiffres ? » et les
   contrôles pondérés.
2. Corrigez dans Finance la pièce signalée (par son lien « Voir »).
3. Revenez à « Fiabilité des données ».

Résultat attendu : les onze contrôles sont listés avec leur poids ; après correction, le contrôle
concerné et la note de fiabilité s'améliorent.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ANA-11. Lire l'activité et les honoraires du cabinet

Objectif : vérifier que la finance lit les honoraires du cabinet, et seulement eux.

Compte : test.daf, société MB AxisPro Consulting.

Données : aucune.

1. Passez à MB AxisPro Consulting.
2. Regardez le menu de l'Analyse.
3. Ouvrez « Activité et honoraires » : « Le temps du cabinet se transforme-t-il en honoraires ? ».

Résultat attendu : sous « MB AxisPro Consulting », la finance ne voit que le cockpit et « Activité et
honoraires ». L'écran donne les heures, le taux de réalisation et la rentabilité par dossier.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## C. Cabinet

### ANA-12. Parcourir l'analyse du portefeuille de projets

Objectif : vérifier les sections du cabinet.

Compte : test.consultant.

Données : aucune.

1. Ouvrez NIMOVA · Analyse : le cockpit du cabinet s'ouvre.
2. Ouvrez « Projets et pipeline », « Diagnostic des projets », « Qualité des décisions »,
   « Financements », « Activité et honoraires » et « Risques et exécution ».
3. Dans « Diagnostic des projets », lisez le bloc par compartiment d'expertise.

Résultat attendu : chaque section répond à sa question (par exemple « Le comité décide-t-il comme la
méthode le recommande ? »). Le diagnostic montre les faiblesses qui reviennent d'un dossier à
l'autre, par domaine et par compartiment.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## D. Refus attendus

### ANA-13. Le cabinet ne voit pas l'analyse du groupe

Objectif : vérifier qu'un compte du cabinet seul n'ouvre aucune analyse d'EGUITRA GROUP SARLU.

Compte : test.consultant.

Données : aucune.

1. Regardez le menu de l'Analyse.
2. Dans la barre d'adresse, remplacez la fin de l'adresse par /analyse/tresorerie.

Résultat attendu : le menu ne propose aucune section « EGUITRA GROUP ». À l'étape 2, l'écran indique
« Cette analyse concerne EGUITRA GROUP SARLU. », précise que le compte n'est pas ouvert à cette
société et propose de revenir au cockpit ; aucun chiffre du groupe n'est montré.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ANA-14. L'exploitation n'ouvre pas l'Analyse

Objectif : vérifier que l'Analyse est réservée à la direction, à la finance, au cabinet et à
l'administration.

Compte : test.exploitation.

Données : aucune.

1. Connectez-vous : l'accueil ne montre pas de rayon Analyse.
2. Dans la barre d'adresse, remplacez la fin de l'adresse par /analyse.

Résultat attendu : la page « Accès non ouvert à votre profil » s'affiche, sans aucune donnée.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## E. Contrôles de saisie et de sécurité

### ANA-15. Message clair en cas de coupure et export unique

Objectif : vérifier le message en cas de coupure et qu'un double clic sur « Excel » ne prépare qu'un
classeur.

Compte : test.dg.

Données : aucune.

1. Coupez le réseau du poste, puis changez de période.
2. Rétablissez le réseau et cliquez sur « Réessayer ».
3. Double-cliquez sur « Excel ».

Résultat attendu : à l'étape 1, un message en français indique que le serveur ne répond pas et
invite à vérifier la connexion ; aucun texte en anglais ni code. À l'étape 2, l'écran revient. À
l'étape 3, le bouton tourne pendant la préparation et un seul classeur est téléchargé.

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

### ANA-16. Déconnexion après une minute sans activité

Objectif : vérifier que l'Analyse, souvent laissée ouverte en réunion, applique la déconnexion après
inactivité.

Compte : test.dg.

Données : aucune.

1. Ouvrez le cockpit et laissez l'écran sans y toucher pendant une minute.
2. Répondez « Je suis là ».
3. Recommencez et laissez passer les 30 secondes.

Résultat attendu : après une minute, la question « Êtes-vous toujours là ? » s'affiche ; « Je suis là »
garde l'écran ouvert. Sans réponse, la page de connexion s'affiche avec « Vous avez été déconnecté
après une période d'inactivité. ».

| Résultat {22} | Remarques {78} |
|---|---|
| ☐ Réussi | |
| ☐ Échoué | |

## Synthèse

| Partie {52} | Scénarios {12} | Réussis {12} | Échoués {12} | Non joués {12} |
|---|---|---|---|---|
| A. Direction générale | 9 | | | |
| B. Finance | 2 | | | |
| C. Cabinet | 1 | | | |
| D. Refus attendus | 2 | | | |
| E. Contrôles de saisie et de sécurité | 2 | | | |
| Total | 16 | | | |

L'Analyse ne comporte ni saisie de montants ni action irréversible : le simulateur se règle par des
curseurs et rien n'est enregistré. Les contrôles des nombres et des confirmations sont donc joués
dans les autres cahiers.

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
