# Dossier de conception : EGUITRA Finance et AxisPro Suite

Projet, version du 25 octobre 2026, à relire par le gérant avant envoi au client. Il remplace le
projet du 17 octobre 2026, qui n'a pas été signé.

Référence : offre OTF-EGUITRA-2026-37 du 29 septembre 2026. Objet : arrêter la conception (offre,
chapitre 6.2, jalon de la semaine 1) et la liste définitive des composants du noyau (chapitre 3.8).
Le document décrit la plateforme telle qu'elle est au 25 octobre 2026 et signale chaque écart avec
l'offre. Les montants et les délais de l'offre ne changent pas.

Il s'appuie sur les prototypes de la direction (M. Diallo, DGA), adoptés comme cahier des charges
(offre, 2.3), et sur le courrier du responsable financier (M. Kalissa) et ses vingt attentes.

## 1. Ce qui est construit

Une plateforme unique pour EGUITRA GROUP SARLU et MB AxisPro Consulting, sur un noyau de gestion
que les utilisateurs ne voient jamais. Les applications prévues par l'offre :

- EGUITRA Finance : pilotage du dirigeant, comptabilité SYSCOHADA révisé, analytique, trésorerie et
  rapprochement bancaire, approbations, clôtures, états financiers, fiscalité, dette,
  immobilisations, budget, consolidation, BTP (chantiers) et immobilier.
- Transport pétrolier : flotte, chauffeurs, routes et tarifs, rotations, facturation, manquants,
  taxes spécifiques, rentabilité par ensemble routier et par route.
- Rotations : application de saisie au parc, installable sur téléphone, utilisable sans réseau.
- AxisPro Suite : évaluation des projets selon la méthode de MB AxisPro Consulting (stage gates,
  scores, knock-outs, écarts prioritaires), data room, comités et décisions scellées, rapports,
  temps et honoraires du cabinet.
- Portail des porteurs de projets : dépôt des pièces, suivi du dossier, échanges avec le cabinet.

Une seule application web sert toutes les surfaces. Les écrans portent la marque NIMOVA, identité
transmise par la direction générale le 15 octobre 2026.

| Adresse | Application | Société servie | Profils |
|---|---|---|---|
| /finance | EGUITRA Finance | l'une ou l'autre, au choix ; vue consolidée | administration, direction, finance, achats, exploitation, BTP, immobilier |
| /transport | Transport, application à part entière depuis le 22 octobre 2026 | EGUITRA GROUP SARLU | administration, direction, finance, exploitation |
| /mobile | Rotations, utilisable hors ligne | EGUITRA GROUP SARLU | administration, exploitation |
| /axispro | AxisPro Suite | MB AxisPro Consulting | administration, direction, cabinet |
| /portail | Portail des porteurs de projets | MB AxisPro Consulting | porteur de projet |
| /analyse | Analyse (ajout, point 2) | les deux, analyses propres à chacune | administration, direction, finance, cabinet |
| /rh | RH et paie (ajout, point 2) | les deux | administration, direction, ressources humaines ; « Mon espace » pour un salarié |

## 2. Ajouts réalisés hors du périmètre de l'offre initiale

Les éléments suivants ont été réalisés en plus de l'offre. Ils ne font pas partie du périmètre
décrit aux chapitres 3 et 4. Tous sont en production, sauf le module HSSEQ, à venir.

| Ajout | Réalisé le | Ce qui dépasse l'offre |
|---|---|---|
| Transport, application à part entière | 22 octobre 2026 | Application séparée d'EGUITRA Finance ; ensembles gérés pour des propriétaires, règles de répartition et relevés mensuels ; coûts standard des routes et marge estimée des rotations. |
| Portail des porteurs enrichi (module `eguitra_portail`) | 22 octobre 2026 | Communications du cabinet, centre de ressources, événements et formations, rendez-vous, notifications, simulateurs, avis des porteurs. |
| AxisPro Suite, mode expert | 16 octobre 2026 | Modèle financier prévisionnel (VAN, TRI, DSCR, sensibilités, scénarios), registre des risques, plan d'actions, financements recherchés, pilotage du portefeuille. |
| Analyse | 18 octobre 2026 | Analyses statistiques et prévisions propres à chaque société (trésorerie à 13 semaines, rentabilité, clients, portefeuille du cabinet), constats classés par impact. |
| RH et paie | 22 octobre 2026 | Personnel, absences et congés, avances et prêts, paie et bulletins, déclarations sociales. La paie figure parmi les évolutions facturables de l'offre (chapitre 7.4). |
| HSSEQ | à venir | Module à réaliser sous avenant, à partir de la spécification v1.0 du 24 octobre 2026. |

Les fonctions prévues par l'offre restent dues et garanties, quelle que soit l'application qui les
porte : le transport pétrolier des chapitres 3.4 et 3.5 dans l'application Transport ; le dépôt
des pièces, le suivi du dossier et les échanges du chapitre 3.7 dans le portail.

Garantie. Le chapitre 7.1 de l'offre garantit la plateforme six mois à compter du procès-verbal de
mise en production, pour les anomalies par rapport au périmètre recetté. Il exclut les évolutions
de périmètre, qui relèvent du chapitre 7.4. Toute évolution de périmètre fait l'objet d'un avenant
chiffré (chapitre 8.1). Sauf accord écrit, la garantie, le support et la maintenance ne s'étendent
donc pas aux ajouts ci-dessus.

## 3. Architecture

| Couche | Réalisation |
|---|---|
| Applications | Une application web (Next.js) pour toutes les surfaces du point 1, en français, à l'image du groupe et du cabinet. |
| Passerelle | Le navigateur ne parle qu'à la passerelle `/api/odoo` et ne détient jamais les jetons d'accès (cookies protégés) ; contrôle d'origine contre la falsification de requêtes ; politique de sécurité du contenu ; fichiers déposés toujours servis en téléchargement. |
| API métier | Routes `/api/v1` exécutées dans le noyau (module `eguitra_api`), sous l'identité de l'utilisateur et avec ses droits. |
| Noyau | Odoo 19.0 Community, localisation guinéenne (plan SYSCOHADA en GNF), dix modules OCA, onze modules spécifiques. |
| Données | PostgreSQL 16 et pièces jointes ; une base par environnement, contenant les deux sociétés. |
| Exploitation | Serveur dédié, conteneurs, proxy TLS à certificats automatiques, sauvegardes, supervision (état exact au point 9). |

Deux environnements complets et séparés sur le même serveur : la production (données réelles) et
la recette (essais, formation, validation de chaque évolution). Chacun a sa base, son noyau, ses
applications web, ses secrets et ses cookies ; ils ne partagent que le serveur et le proxy. Une
évolution est installée en recette, essayée par les référents, puis mise en production par une
procédure unique : la version validée est figée, la base sauvegardée juste avant, le noyau mis à
jour, le résultat contrôlé ; en cas d'échec, la version précédente revient en service.

## 4. Composants du noyau : liste définitive

Liste arrêtée le 14 octobre 2026, lendemain de la réunion de cadrage, après installation et tests
de chaque module sur la version 19.0 du noyau. Les modules OCA sont figés à un commit précis (`infra/oca/lock.txt`) ;
une mise à jour se décide et se teste en recette.

| Fonction | Composant |
|---|---|
| Comptabilité, multi-sociétés, multi-devises, analytique | Odoo 19.0 Community (standard), localisation `l10n_gn` |
| Double authentification, politique des mots de passe | `auth_totp`, `auth_password_policy` (Odoo Community) |
| Rapprochement bancaire, import des relevés | `account_reconcile_oca`, `account_statement_import_file` |
| Immobilisations et amortissements | `account_asset_management` |
| Budgets et états de gestion | `mis_builder`, `mis_builder_budget` |
| États financiers et grand livre | `account_financial_report` |
| Piste d'audit | `auditlog` |
| Contrats récurrents et loyers | `contract` |
| Taux de change | `currency_rate_update` |
| Gestion documentaire | `dms` |
| Circuits d'approbation | moteur spécifique `eguitra_approval` |

Les dépendances techniques de ces modules viennent des mêmes dépôts OCA (douze dépôts, branche 19.0,
commits figés).

Écart avec l'offre, sans surcoût. Les modules `base_tier_validation`, `purchase_tier_validation` et
`account_move_tier_validation` cités au chapitre 3.8 n'existent pas pour la version 19.0 du noyau,
retenue parce qu'elle est maintenue plus longtemps (jusqu'à l'automne 2028). Le besoin (corbeille de
validation à plusieurs niveaux, seuils par montant et par nature) est couvert par le moteur
spécifique : niveaux successifs, approbateurs par profil, seuils par nature de pièce, journal des
décisions, nouvelle approbation si la pièce est modifiée, aucun contournement hors du moteur ; un
même compte ne tranche qu'une étape d'une demande.

Les onze modules spécifiques :

| Module | Rôle |
|---|---|
| `eguitra_base` | Sociétés, profils, axes analytiques, règles de la piste d'audit |
| `eguitra_api` | API métier, authentification, double authentification, sessions, administration des comptes et des sociétés, contrôle des fichiers reçus |
| `eguitra_finance` | EGUITRA Finance : pilotage, comptabilité, trésorerie, clôtures, états, fiscalité, dette, immobilisations, budget, consolidation, validation de la reprise |
| `eguitra_approval` | Circuits d'approbation : engagements de dépense, pièces d'achat, règlements et décaissements |
| `eguitra_transport` | Transport : flotte, chauffeurs, routes et tarifs, rotations, facturation, manquants, taxes spécifiques, rentabilité, synchronisation de Rotations ; ensembles gérés et coûts standard (ajout) |
| `eguitra_chantier` | BTP : chantiers, situations d'avancement, facturation, retenues de garantie |
| `eguitra_immobilier` | Immobilier : biens, baux, loyers, quittancement, impayés |
| `eguitra_axispro` | AxisPro Suite : grille versionnée, dossiers, évaluation, data room, comités, rapports, temps et honoraires, portail de base ; mode expert (ajout) |
| `eguitra_portail` | Portail des porteurs enrichi (ajout) |
| `eguitra_analytics` | Analyse, en lecture seule (ajout) |
| `eguitra_rh` | RH et paie (ajout) |

## 5. Organisation des données

- Sociétés : EGUITRA GROUP SARLU et MB AxisPro Consulting vivent dans la même base, avec des
  comptabilités séparées. Chacune a son plan de comptes SYSCOHADA, ses journaux, ses taxes, sa
  numérotation des pièces, ses exercices et ses clôtures. Un utilisateur ne voit que les sociétés
  qui lui sont ouvertes.
- Un compte pour les deux sociétés : l'administration ouvre à chaque utilisateur une société ou
  les deux. Un utilisateur ouvert aux deux passe de l'une à l'autre par le sélecteur de l'écran,
  sans se reconnecter. La direction et la finance disposent de la vue « Groupe consolidé ».
- Applications et sociétés : Transport, BTP, immobilier et Rotations ne servent qu'EGUITRA GROUP
  SARLU ; AxisPro Suite et le portail ne servent que MB AxisPro Consulting ; Finance, Analyse et RH
  servent les deux. Le noyau refuse qu'un module réservé à une société travaille dans l'autre.
- Plan de comptes : plan SYSCOHADA de la localisation guinéenne (1 142 comptes par société), à
  valider par l'expert-comptable (offre, chapitre 6.5), avec la table de correspondance des
  rubriques du bilan, du compte de résultat et du tableau des flux.
- Axes analytiques : activité, centre de coût, chantier, ensemble routier, route, bien immobilier,
  dossier AxisPro. Les axes chantier, ensemble, route, bien et dossier se créent avec leur objet.
  Activités du cabinet : gestion de projets, formation et coaching, conseil, audit d'évaluation des
  transporteurs, certification.
- Journaux : ventes (FAC), achats (FACTU), banques et caisses, opérations diverses (OD), à-nouveaux
  (AN, situation d'ouverture du tableau des flux), différences de change, salaires (SAL, créé par
  le module RH).

## 6. Profils et droits

Dix profils. L'offre (chapitre 5.3) en cite sept ; s'y ajoutent l'administration (prévue au
chapitre 3.4), les achats (21 octobre 2026) et les ressources humaines (22 octobre 2026, avec le
module RH). Un utilisateur peut cumuler plusieurs profils.

| Profil | Applications | Société | Périmètre |
|---|---|---|---|
| Direction générale | Finance, Transport, AxisPro Suite, Analyse, RH | celles du compte | Tableau de bord, pilotage, consolidation, dernier niveau d'approbation ; lecture seule dans AxisPro Suite |
| Finance et comptabilité | Finance, Transport, Analyse | celles du compte | Ventes, achats, trésorerie, immobilisations, budget, clôtures, états, déclarations |
| Achats | Finance, partie achats | celles du compte | Engagements de dépense et devis, pièces d'achat et avoirs fournisseurs, fiches fournisseurs ; ni ventes, ni trésorerie, ni états |
| Exploitation transport | Finance, Transport, Rotations | EGUITRA GROUP SARLU | Flotte, chauffeurs, routes et tarifs, rotations, rentabilité |
| BTP | Finance | EGUITRA GROUP SARLU | Chantiers, situations d'avancement, retenues de garantie |
| Immobilier | Finance | EGUITRA GROUP SARLU | Biens, baux, loyers et quittancement, patrimoine |
| Cabinet | AxisPro Suite, Analyse | MB AxisPro Consulting | Dossiers, évaluations, data room, comités, rapports, temps et honoraires |
| Ressources humaines | RH | celles du compte | Personnel, absences et congés, avances, paie et bulletins |
| Administration | toutes, sauf le portail | celles du compte | Référentiels, seuils, taux de change, comptes et profils, journal d'audit |
| Porteur de projet | Portail | MB AxisPro Consulting | Ses dossiers seulement |

Un compte lié à un dossier du personnel ouvre aussi RH, réduit à « Mon espace » : son dossier, ses
absences, ses bulletins.

Règles de séparation, issues de l'audit des rôles du 22 octobre 2026 et en production depuis le
même jour :

- un compte ne tranche qu'une étape d'une même demande d'approbation ;
- personne ne modifie son propre dossier du personnel, ses éléments de paie ni ses avances ; la paie
  n'est validée que par la direction, jamais par le compte qui l'a préparée ; aucune absence n'est
  approuvée par son bénéficiaire ;
- AxisPro Suite : un consultant n'évalue que les compartiments qui lui sont confiés (le responsable
  du dossier, tout le dossier) ; la décision du comité et le passage forcé d'un gate demandent deux
  personnes au moins ; une décision verrouillée est rouverte par un autre compte ; un porteur déjà
  suivi pour un autre promoteur ne peut pas être rattaché à un dossier ;
- chaque route de l'API est réservée à des profils, et les refus sont testés.

## 7. Règles de gestion paramétrées

Valeurs de départ, ajustables par l'administration.

| Règle | Valeur proposée |
|---|---|
| Engagements de dépense | approuvés avant la commande, devis joint : contrôle de la finance ; au-delà de 50 M GNF : accord de la direction ; les factures du fournisseur consomment l'engagement sans refaire le circuit, dans la limite du reste à engager (tolérance 5 %) |
| Approbation des pièces d'achat | toutes : contrôle de la finance ; au-delà de 50 M GNF : accord de la direction |
| Approbation des règlements et décaissements | règlements, sorties de caisse et de banque, échéances d'emprunt, virements internes : au-delà de 100 M GNF, accord de la direction ; l'opération reste en brouillon jusqu'à la dernière approbation |
| Alertes de gestion (gravités bloquante, critique, élevée, moyenne, avec l'action recommandée) | compte de passage 585 non soldé (bloquant) ; trésorerie sous le minimum (à fixer par société) et compte de banque ou de caisse négatif ; DSCR < 1,20 ; créances échues depuis plus de 90 jours, part échue > 20 %, délai de recouvrement > 60 jours, concentration sur un client > 40 % ; dettes fournisseurs échues ; résultat net cumulé négatif ; marge transport < 30 %, rotations non facturées, ensembles routiers déficitaires après charges de structure ; dépassement budgétaire > 10 % ; clôture en retard de plus de 10 jours ; validation en attente depuis plus de 3 jours |
| Pertes attendues (IFRS 9, retraitement hors livres SYSCOHADA) | non échu 1 %, 1 à 30 jours 3 %, 31 à 60 jours 10 %, 61 à 90 jours 25 %, au-delà 50 % |
| Relances des clients | rappel dès 1 jour de retard, relance ferme à 15 jours, mise en demeure à 30 jours (jamais envoyée sans décision de la finance) |
| Clôture mensuelle | contrôles bloquants (équilibres, compte de passage, pièces en attente, relevés rapprochés), verrouillage et empreinte de chaînage des écritures, réouverture tracée |
| Transport | tarif du client sur la route, à défaut tarif de la route ; facture par client, une ligne par rotation |
| Coût standard d'une rotation (ajout) | forfaits de la route (litres de carburant aller et retour × prix du litre à la date de chargement, prime de route, péages, autres frais) ; mis à jour tant que la rotation est saisie, figé à sa validation |
| Ensembles gérés pour des propriétaires (ajout) | règles de répartition en % du chiffre d'affaires brut, par ensemble ou par catégorie ; part du propriétaire = marge − commissions ; relevé mensuel figé, pièces en brouillon |
| Chantiers | retenue de garantie (5 % par défaut) portée en 4117 jusqu'à sa libération |
| Immobilier | quittancement chaque nuit : une facture par échéance passée, datée de l'échéance, validée aussitôt ; impayés relancés comme les autres créances |
| Pièces déposées | PDF, JPEG, PNG, Word .docx et Excel .xlsx, reconnus d'après leur contenu ; 20 Mo par fichier ; dossier d'un porteur limité à 400 pièces ou 1 Go, 50 messages par jour |
| AxisPro, méthode MB AxisPro Consulting (réf. MBAP/PROJECT-DEVELOPMENT/SC-01) | outil de scoring du cabinet, version 3, importé et en vigueur en production depuis le 22 octobre 2026 : 104 critères, 14 domaines, 8 compartiments d'expertise (C0 à C7, un consultant par compartiment), 7 gates, 9 knock-outs, 39 pièces de data room ; disponible et exploitable 1 point, incomplet 0,5, non disponible 0, non applicable 1, non évalué compté non disponible ; critère déclaré disponible sans la preuve exigée, ou avec une preuve périmée : retenu incomplet ; knock-out actif s'il est non disponible ; complétude documentaire minimale pour examiner un gate (40 % au gate 1, HOLD en dessous) ; scores Project Readiness, APD Readiness et Bankability ; seuils de classement lus dans l'onglet Paramètres de l'outil ; décision du comité scellée, dossier figé jusqu'à une nouvelle révision |

La grille de 111 critères tirée du prototype (15 domaines, 8 gates, 42 pièces) n'est plus en
vigueur : l'outil de la version 3 la remplace. La grille reste une donnée, modifiable par le cabinet
sans intervention technique (offre, chapitre 3.7).

## 8. Sécurité

En place :

- mots de passe d'au moins 10 caractères ; mot de passe provisoire à remplacer avant tout accès ;
- sessions courtes et révocables : accès de 15 minutes, session de 7 jours au plus, 90 jours pour
  les agents du parc dans Rotations ; la déconnexion ferme toute la session ;
- limitation des essais par identifiant et par adresse ; journal des accès conservé 12 mois ;
- piste d'audit avec valeurs avant et après ; écritures verrouillées après clôture, avec empreinte
  de chaînage ;
- échanges chiffrés (TLS) ; noyau et base jamais exposés sur Internet ; client web du noyau réservé
  aux adresses de l'équipe technique ;
- cloisonnement par société, jusque dans les pièces de la data room, les revues de comité et les
  grilles du cabinet ; une pièce approuvée puis modifiée doit être approuvée à nouveau ;
- fichiers déposés contrôlés d'après leur contenu (documents à macros refusés) ; exports pour
  tableur sans formule ; le téléphone d'un agent du parc ne garde ni tarifs ni marges et s'efface
  à la déconnexion ; aucune ressource chargée depuis un site tiers.

Double authentification : en place, exigée par l'offre pour tous les utilisateurs (chapitre 5.3).
Elle est suspendue en production depuis le 21 octobre 2026, à la demande du gérant d'E-VOLUTION XP,
pendant la prise en main des comptes du client. Elle est à rétablir avant la reprise des données
réelles. Elle est aussi suspendue en recette pendant les tests. Tant qu'elle est suspendue, la
plateforme n'est pas conforme au chapitre 5.3.

## 9. Hébergement, sauvegardes et exploitation

Serveur dédié chez OVHcloud (Gravelines, France), Ubuntu 26.04 LTS : 6 vCPU et 12 Go de mémoire
(l'offre en prévoit 4 et 8), 100 Go de disque NVMe. L'option de sauvegarde automatique de
l'hébergeur est activée.

Écart à l'offre : 100 Go de disque au lieu des 160 Go du chapitre 5.1. Le modèle commandé n'en
propose pas davantage ; le modèle supérieur était indisponible. Deux issues, à trancher au point 13 :

1. le client accepte l'écart par écrit, et E-VOLUTION XP ajoute du disque sans surcoût dès que
   l'occupation l'exige (alerte de la supervision à 85 %) ;
2. E-VOLUTION XP ajoute un disque pour porter la capacité à 160 Go au moins, sans surcoût.

Sauvegardes de la production, état au 25 octobre 2026 :

| Mesure | Engagement de l'offre (5.2) | État au 25 octobre 2026 |
|---|---|---|
| Journalisation continue | copie hors site chiffrée toutes les 15 minutes ; restauration à tout instant des 14 derniers jours | archivage des journaux de transactions (WAL) sur le serveur, toutes les 5 minutes au plus |
| Sauvegarde complète | quotidienne, chiffrée, copiée hors site chez un second fournisseur | quotidienne (01 h 30), sur le serveur |
| Pièces jointes | synchronisées hors site toutes les heures | miroir sur le serveur toutes les 15 minutes, instantané chaque nuit |
| Rétention | 30 sauvegardes quotidiennes, 12 mensuelles, journaux sur 14 jours | 14 jours sur le serveur ; les rétentions de l'offre s'appliqueront à la copie hors site |
| Perte de données maximale | 15 minutes | tenue tant que le serveur et ses disques restent disponibles ; pas garantie en cas de perte du serveur |
| Délai de reprise | 4 heures ouvrées | procédure écrite ; restauration du 25 octobre faite en 15 secondes, sur une base encore vide |
| Test de restauration | chaque trimestre, dont un à un instant donné, avec compte rendu | test mensuel de l'état le plus récent réussi ; premier test trimestriel à un instant donné réussi le 25 octobre 2026, avec compte rendu ; tests programmés chaque mois et chaque trimestre |
| Disponibilité | 99,5 % par mois | mesurée chaque mois sur le journal de la supervision |

Copie hors site chiffrée : outillée (chiffrement avant envoi, rétentions de l'offre), mais pas en
service tant que le stockage chez un second hébergeur n'est pas souscrit. Ce stockage fait partie
de l'hébergement compris dans l'offre (chapitre 5.1). Sa mise en service, suivie d'un test de
restauration depuis la copie hors site, est une condition de la mise en production (plan de
bascule). Jusque-là, l'engagement du chapitre 5.2 n'est pas tenu pour une perte totale du serveur.

Supervision : un contrôle toutes les 5 minutes porte sur les services des deux environnements, les
noyaux, les applications web, le disque, les sauvegardes, les tests de restauration et la double
authentification. Les alertes sont outillées (messagerie d'équipe, notification sur téléphone,
sonde externe), mais aucune destination n'est configurée : elles ne sont aujourd'hui inscrites
qu'au journal du serveur. Les destinations sont à convenir avec le client (point 12).

Mises à jour de sécurité : celles du système s'appliquent automatiquement, sans redémarrage
automatique ; celles des composants de la plateforme passent par la recette puis par la procédure
de mise en production.

## 10. Reprise de l'exercice 2026

Fichiers simples remplis à partir du classeur 2026 : tiers, soldes d'ouverture (journal des
à-nouveaux), écritures de l'exercice pièce par pièce (ventes, achats, trésorerie, OD) avec lettrage
des comptes de tiers, immobilisations, emprunts, budget mensuel, rotations. Chaque chargement est
d'abord contrôlé (aucune écriture en cas d'anomalie), rejoué autant que nécessaire en recette, puis
appliqué en production. Les relevés bancaires se chargent par l'écran Trésorerie, à partir du
lendemain de la date d'arrêté de la reprise. Les rotations suivies dans Datakö Fleet depuis mai 2026
se convertissent au même format.

Les balances obtenues sont confrontées au classeur et validées par le responsable financier avant
la mise en production (offre, chapitre 6.3) : les 26 valeurs de référence du classeur (équilibre,
résultat, trésorerie, créances, dettes, transport, bilan) sont recalculées par la plateforme ; leur
conformité (« n/26 ») est annexée aux procès-verbaux de recette et de mise en production.

État au 25 octobre 2026 : la reprise a été essayée de bout en bout sur une base jetable de la
recette, avec le dossier du prototype. 18 valeurs sur 26 sont conformes. Les 8 autres ont une seule
cause, la convention d'amortissement des biens repris : trois conventions sont prêtes, le choix
revient à l'expert-comptable. La base de production reste vide jusqu'à la reprise définitive, qui
attend le classeur 2026 définitif.

## 11. Cahier de recette : les vingt attentes du département Finance

Le cahier de recette (`Cahier_de_recette.xlsx`) compte 80 scénarios : 66 pour les vingt attentes du
département Finance, 14 pour AxisPro Suite et le portail. Le tableau dit où vérifier chaque attente.
La recette est constatée par le procès-verbal de recette, la mise en production par le
procès-verbal de mise en production (modèles dans `docs/projet/`).

| # | Attente | Où la vérifier | Vérification |
|---|---|---|---|
| 1 | Visibilité temps réel CA, résultat, trésorerie | Tableau de bord, Pilotage, Rapport mensuel | Saisir une facture : CA et encours à jour immédiatement ; questions du dirigeant avec leur verdict ; « ce qui demande une décision » ; arrêté à une date |
| 2 | Vue consolidée, décomposable | Sélecteur de société, vue Groupe ; États > Consolidé du groupe ; Activités et budget | Un même compte passe d'une société à l'autre, comptabilités séparées ; compte de résultat et bilan par société, éliminations intra-groupe, groupe ; marge par activité, centre de coût, chantier, ensemble, route |
| 3 | Comptabilité SYSCOHADA révisé | Balance et états, Clôtures | Bilan équilibré, compte de résultat, tableau des flux rapproché de la trésorerie ; clôture mensuelle complète ; exports XLSX et CSV des états ; SAF-T |
| 4 | Analytique multi-axes | Activités et budget, saisie des pièces | Imputation automatique depuis rotations, chantiers, loyers, catégories de dépense ; saisie sur plusieurs axes par ligne ; imputation obligatoire contrôlée |
| 5 | Trésorerie et rapprochement | Trésorerie | Import d'un relevé réel (CSV, XLSX ou camt.053), soldes contrôlés, rapprochement, état de rapprochement ; flux mensuels et prévision |
| 6 | Immobilisations et amortissements | Immobilisations | Dotations mensuelles automatiques ventilées par activité, sortie d'actif, registre exporté |
| 7 | Budget et écarts | Activités et budget | Budget mensuel par ligne budgétaire, réalisé, engagé, disponible, écarts, alerte de dépassement |
| 8 | Facturation clients et fournisseurs | Ventes, Achats, Relances clients | Facture, avoir, échéance, relance ; litige qui suspend les relances ; balance âgée |
| 9 | Fiscalité, TVA, déclarations | Fiscalité | TVA du mois rapprochée des écritures et liquidée à la clôture, retenues à la source, déclarations et historique, modèle validé par l'expert-comptable |
| 10 | Approbation des engagements et paiements | Engagements, À valider | Engagement approuvé avant la commande ; pièce, règlement ou décaissement au-delà du seuil bloqué jusqu'à approbation |
| 11 | Coûts et rentabilité transport | Transport, Rotations | Rotation saisie au parc hors réseau, marge par ensemble et par route, coût au km, charges de structure ; volumes, manquants et taxes spécifiques au barème |
| 12 | Chantiers, avancement, retenues | BTP | Situation facturée, retenue en 4117, libération |
| 13 | Gestion locative et patrimoine | Immobilier | Bail, loyers générés, impayés, quittance |
| 14 | Traçabilité, piste d'audit | Journal d'audit | Modification visible avec valeurs avant et après |
| 15 | Sécurité des accès par profil | Utilisateurs, connexion | Double authentification, profil limité à son périmètre, sociétés ouvertes par utilisateur |
| 16 | Disponibilité et sauvegardes | Compte rendu de restauration | Restauration à un instant donné réussie |
| 17 | Interface simple, formation | Guides par profil | Formation de chaque profil sur ses écrans |
| 18 | Support et accompagnement | Procédure de support | Délais d'intervention de l'offre, chapitre 7.2 |
| 19 | Solution évolutive | Dossier technique | Ajout d'un module du noyau sans développement |
| 20 | Tarification claire | Offre, chapitre 8 | Sans objet en recette |

## 12. Points à valider par le client

1. Plan de comptes et correspondances des états (expert-comptable, semaine 2).
2. Convention d'amortissement des biens repris (expert-comptable) ; taux des emprunts et à-nouveau
   du compte 162.
3. Seuils d'approbation et d'alerte (point 7).
4. Charte graphique de MB AxisPro Consulting ; celle d'EGUITRA GROUP SARLU est reçue et appliquée.
5. Noms de domaine définitifs : nimova.gn, commandé le 21 octobre 2026, attend sa finalisation ; la
   production est servie d'ici là sur des adresses provisoires.
6. Classeur 2026 définitif, relevés bancaires 2026, modèles de déclarations fiscales, export complet
   de Datakö Fleet.
7. Identité des sociétés (raison sociale, adresse, NIF, RCCM), reprise sur les factures.
8. Destinations des alertes de supervision et serveur d'envoi de courriel.
9. Téléphones des agents du parc, pour la double authentification de Rotations.
10. Confidentialité entre consultants du cabinet : aujourd'hui, tout le cabinet voit tous les
    dossiers.
11. Frais communs aux deux sociétés et leur clé de répartition.
12. Écart de disque (point 9) : acceptation écrite ou ajout de disque.

Le registre des prérequis (`docs/projet/registre-des-prerequis.md`) date chaque demande et sa
réception.

## 13. Validation

Le client approuve la conception décrite et la liste des composants du point 4.

Écart de disque (point 9) : issue 1, écart accepté / issue 2, disque ajouté (rayer la mention
inutile).

| Pour EGUITRA GROUP SARLU et MB AxisPro Consulting | Pour E-VOLUTION XP |
|---|---|
| M. Mohamed Nimaga, Directeur Général | Madigbè Kouyaté, gérant |
| Date et signature : | Date et signature : |
