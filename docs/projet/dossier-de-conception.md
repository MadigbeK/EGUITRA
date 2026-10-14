# Dossier de conception : EGUITRA Finance et AxisPro Suite

Projet de document, version de travail du 14 octobre 2026, à relire par le gérant avant envoi au client.
Référence : offre OTF-EGUITRA-2026-37. Objet : arrêter la conception (offre, chapitre 6.2, jalon de
la semaine 1) et la liste définitive des composants (offre, chapitre 3.8). Les montants et délais
de l'offre ne changent pas.

## 1. Ce qui est construit

Une plateforme unique pour EGUITRA GROUP SARLU et MB AxisPro Consulting :

- **EGUITRA Finance** : pilotage du dirigeant, comptabilité SYSCOHADA, trésorerie, approbations,
  clôtures, états financiers, fiscalité, dette, immobilisations, budget, et les métiers transport,
  chantiers et immobilier.
- **AxisPro Suite** : évaluation des projets par stage gates, scoring, data room, comités, rapports,
  temps et honoraires du cabinet.
- **Portail des porteurs de projets** : suivi du dossier, dépôt des pièces, échanges avec le cabinet.
- **Rotations** : application de saisie au parc, installable sur téléphone, utilisable sans réseau.

Les utilisateurs ne voient que ces quatre applications. Le noyau de gestion (Odoo Community 19)
tient les comptes et n'est accessible qu'à l'équipe technique.

## 2. Architecture

| Couche | Réalisation |
|---|---|
| Applications | Une application web (quatre espaces : finance, axispro, portail, mobile), à l'image du groupe et du cabinet, en français. |
| Passerelle | Le navigateur ne détient jamais les jetons d'accès (cookies protégés) ; contrôle d'origine contre la falsification de requêtes ; fichiers déposés toujours servis en téléchargement. |
| API métier | Huit modules spécifiques ; chaque appel s'exécute sous l'identité de l'utilisateur, avec ses droits. Double authentification, sessions révocables, limitation des essais, journal des accès. |
| Noyau | Odoo Community 19, localisation guinéenne (plan SYSCOHADA en GNF), dix modules OCA. |
| Données | PostgreSQL 16 et pièces jointes ; une base par environnement, contenant les deux sociétés. |
| Exploitation | Serveur dédié, conteneurs, proxy TLS à certificats automatiques, sauvegardes continues chiffrées hors site, supervision. |

**Deux environnements complets et séparés** sur le même serveur : la **production** (données
réelles) et la **recette** (essais, formation, validation de chaque évolution). Chacun a sa propre
base de données, son noyau, ses applications web et ses mots de passe ; ils ne partagent que le
serveur. Une évolution est installée en recette, essayée par les référents, puis mise en production
par une procédure qui fige la version validée, sauvegarde la base juste avant, met à jour le noyau
et contrôle le résultat, avec retour automatique à la version précédente en cas d'échec.

## 3. Composants du noyau : liste définitive

| Fonction | Composant |
|---|---|
| Comptabilité, multi-sociétés, multi-devises, analytique | Odoo Community 19 (standard), localisation `l10n_gn` |
| Rapprochement bancaire, import des relevés | `account_reconcile_oca`, `account_statement_import_file` |
| Immobilisations et amortissements | `account_asset_management` |
| Budgets et états de gestion | `mis_builder`, `mis_builder_budget` |
| États financiers et grand livre | `account_financial_report` |
| Piste d'audit | `auditlog` |
| Contrats récurrents et loyers | `contract` |
| Taux de change | `currency_rate_update` |
| Gestion documentaire | `dms` |
| Circuits d'approbation | moteur spécifique `eguitra_approval` (voir ci-dessous) |
| Modules spécifiques | `eguitra_base`, `eguitra_api`, `eguitra_finance`, `eguitra_approval`, `eguitra_transport`, `eguitra_chantier`, `eguitra_immobilier`, `eguitra_axispro` |

**Écart avec l'offre, sans surcoût.** Les modules `base_tier_validation`, `purchase_tier_validation`
et `account_move_tier_validation` n'existent pas pour la version 19 du noyau, retenue parce qu'elle
est maintenue jusqu'à l'automne 2028. Le besoin (corbeille de validation à plusieurs niveaux, seuils
par montant et par nature) est couvert par un moteur spécifique : niveaux successifs, approbateur
par profil, seuils par nature de pièce, journal des décisions, nouvelle approbation si la pièce est
modifiée, aucun contournement possible hors du moteur.

## 4. Organisation des données

- **Sociétés (multi-sociétés)** : EGUITRA GROUP SARLU (groupe) et MB AxisPro Consulting (cabinet)
  vivent dans la même base, avec des **comptabilités entièrement séparées** : chacune son plan de
  comptes SYSCOHADA, ses journaux, ses taxes, sa numérotation des pièces, ses exercices et ses
  clôtures. Les données sont cloisonnées par société : un utilisateur ne voit que les sociétés qui
  lui sont ouvertes.
- **Un compte pour les deux sociétés** : l'administration ouvre à chaque utilisateur une société ou
  les deux. Un utilisateur ouvert aux deux passe de l'une à l'autre par le sélecteur en haut de
  l'écran, sans se reconnecter ; la direction dispose en plus de la vue « Groupe consolidé »
  (tableau de bord, états, pilotage). AxisPro Suite et le portail s'ouvrent sur la société du cabinet.
- **Plan de comptes** : plan SYSCOHADA de la localisation guinéenne (1 142 comptes), **à valider par
  l'expert-comptable** (offre, chapitre 6.5), ainsi que la table de correspondance des rubriques du
  bilan, du compte de résultat et du tableau des flux.
- **Axes analytiques** : activité, centre de coût, chantier, ensemble routier, route, bien immobilier,
  dossier AxisPro. Les axes chantier, ensemble routier, route, bien et dossier se créent seuls avec
  leur objet.
- **Journaux** : ventes (FAC), achats (FACTU), banques et caisses, opérations diverses (OD),
  à-nouveaux (AN, situation d'ouverture du tableau des flux), différences de change.
- **Profils** : direction, finance, exploitation transport, chantiers, immobilier, cabinet,
  administration, porteur de projet. Chaque profil ne voit que les écrans et les données de son
  périmètre ; un utilisateur peut cumuler plusieurs profils.

## 5. Règles de gestion paramétrées (valeurs de départ, ajustables par l'administration)

| Règle | Valeur proposée |
|---|---|
| Approbation des pièces d'achat | toutes : contrôle de la finance ; au-delà de 50 M GNF : accord de la direction |
| Approbation des règlements | au-delà de 100 M GNF : accord de la direction |
| Alertes du tableau de bord | marge transport < 15 % ; créances échues depuis plus de 60 jours ; clôture mensuelle en retard de plus de 10 jours ; compte de passage 585 non soldé (bloquant) ; dépassement budgétaire > 10 % ; validation en attente depuis plus de 3 jours ; trésorerie minimale et encours échu maximal à fixer |
| Relances des clients | rappel dès 1 jour de retard, relance ferme à 15 jours, mise en demeure à 30 jours (jamais envoyée sans décision de la finance) |
| Clôture mensuelle | contrôles bloquants (équilibres, compte de passage, pièces en attente, relevés rapprochés), verrouillage et empreinte de chaînage des écritures, réouverture tracée |
| Transport | tarif du client sur la route, à défaut tarif de la route ; facture par client, une ligne par rotation |
| Chantiers | retenue de garantie (5 % par défaut) portée en 4117 jusqu'à sa libération |
| AxisPro | score par domaine pondéré ; éliminatoire non satisfait : NO-GO ; GO à partir de 70/100 sans critère critique ouvert ; conditionnel à partir de 50/100 ; preuve exigée pour les critères qui le demandent |

## 6. Sécurité

Double authentification pour tous les utilisateurs (y compris le portail et l'application Rotations),
mots de passe d'au moins 10 caractères, mot de passe provisoire à remplacer avant tout accès,
sessions courtes et révocables, limitation des essais par identifiant et par adresse, journal des
accès conservé 12 mois, piste d'audit avec valeurs avant et après, échanges chiffrés (TLS), noyau et
base jamais exposés sur Internet, client web du noyau réservé aux adresses de l'équipe technique.

## 7. Hébergement, sauvegardes et exploitation

- Serveur dédié OVHcloud (Gravelines, France), 6 vCPU, 12 Go de mémoire, **100 Go de disque**
  (l'offre annonçait 160 Go ; le modèle commandé n'en propose pas davantage). Engagement : disque
  supplémentaire ajouté sans surcoût dès que l'occupation l'exige (supervision à 85 %).
- Deux environnements séparés, recette et production, sur le même serveur (voir 2) ; la base de
  production est accédée par un compte sans privilège d'administration de la base.
- Sauvegardes conformes au chapitre 5.2 de l'offre : journalisation continue (perte maximale
  15 minutes), sauvegarde complète quotidienne, pièces jointes toutes les 15 minutes, copie hors
  site chiffrée chez un second fournisseur, rétention de 30 sauvegardes quotidiennes, 12 mensuelles
  et 14 jours de journaux ; test de restauration trimestriel, dont une restauration à un instant
  donné, avec compte rendu. Restauration vérifiée le 14 octobre 2026, y compris à un instant donné.
  La recette a en plus une copie logique chaque nuit, gardée 7 jours.
- Supervision toutes les 5 minutes (services, disque, sauvegardes) avec alertes.

## 8. Reprise de l'exercice 2026

Fichiers simples remplis à partir du classeur 2026 : tiers, soldes d'ouverture (journal des
à-nouveaux), écritures de l'exercice pièce par pièce (ventes, achats, trésorerie, OD) avec lettrage
des comptes de tiers, budget mensuel, rotations. Chaque chargement est d'abord contrôlé (aucune
écriture en cas d'anomalie), rejoué autant que nécessaire en recette, puis appliqué en production.
Les relevés bancaires 2026 se chargent par l'écran Trésorerie ; immobilisations et emprunts se
saisissent dans leurs écrans. Les balances obtenues sont confrontées au classeur et validées par le
responsable financier avant la mise en production (offre, chapitre 6.3).

## 9. Cahier de recette : les vingt attentes du département Finance

| # | Attente | Où la vérifier | Vérification |
|---|---|---|---|
| 1 | Visibilité temps réel CA, résultat, trésorerie | Tableau de bord, Rapport mensuel | Saisir une facture : CA et encours à jour immédiatement |
| 2 | Vue consolidée, décomposable | Sélecteur de société, bouton Groupe ; Activités et budget | Un même compte passe d'une société à l'autre, comptabilités séparées ; vue groupe ; marge par activité, chantier, ensemble, route |
| 3 | Comptabilité SYSCOHADA révisé | Balance et états | Bilan équilibré, compte de résultat, tableau des flux rapproché de la trésorerie |
| 4 | Analytique multi-axes | Activités et budget | Imputation automatique depuis rotations, chantiers, loyers |
| 5 | Trésorerie et rapprochement | Trésorerie | Import d'un relevé réel, rapprochement des lignes |
| 6 | Immobilisations et amortissements | Immobilisations | Dotations mensuelles automatiques, sortie d'actif (cession) |
| 7 | Budget et écarts | Activités et budget | Budget mensuel, réalisé, écarts, alerte de dépassement |
| 8 | Facturation clients et fournisseurs | Ventes, Achats, Relances clients | Facture, avoir, échéance, relance |
| 9 | Fiscalité, TVA, déclarations | Fiscalité | TVA du mois rapprochée des écritures, modèle validé par l'expert-comptable |
| 10 | Approbation des engagements et paiements | À valider | Pièce au-delà du seuil bloquée jusqu'à approbation |
| 11 | Coûts et rentabilité transport | Transport, application Rotations | Rotation saisie au parc hors réseau, marge par ensemble et par route |
| 12 | Chantiers, avancement, retenues | Chantiers | Situation facturée, retenue en 4117, libération |
| 13 | Gestion locative et patrimoine | Immobilier | Bail, loyers générés, impayés, quittance |
| 14 | Traçabilité, piste d'audit | Journal d'audit | Modification visible avec valeurs avant et après |
| 15 | Sécurité des accès par profil | Utilisateurs | Double authentification, profil limité à son périmètre, sociétés ouvertes par utilisateur |
| 16 | Disponibilité et sauvegardes | Compte rendu de restauration | Restauration à un instant donné réussie |
| 17 | Interface simple, formation | Guides par profil | Formation de chaque profil sur ses écrans |
| 18 | Support et accompagnement | Procédure de support | Délais d'intervention de l'offre, chapitre 7.2 |
| 19 | Solution évolutive | Dossier technique | Ajout d'un module du noyau sans développement |
| 20 | Tarification claire | Offre, chapitre 8 | Sans objet en recette |

## 10. Points à valider par le client

1. Plan de comptes et correspondances des états (expert-comptable, semaine 2).
2. Seuils d'approbation et d'alerte (tableau du point 5).
3. Charte graphique du groupe et du cabinet (couleurs et logos ; les couleurs actuelles sont provisoires).
4. Noms de domaine et accès à leur gestion (finance, axispro, portail, recette).
5. Grille d'évaluation AxisPro officielle et liste des pièces de la data room.
6. Liste des utilisateurs, de leurs profils et des sociétés ouvertes à chacun (groupe, cabinet ou
   les deux) ; téléphones des agents du parc (double authentification).
7. Fournisseur de stockage hors site (second hébergeur) et serveur d'envoi de courriel.
8. Classeur 2026 définitif, relevés bancaires 2026, modèles de déclarations fiscales.

## 11. Validation

| Pour EGUITRA GROUP SARLU et MB AxisPro Consulting | Pour E-VOLUTION XP |
|---|---|
| M. Mohamed Nimaga, Directeur Général | Madigbè Kouyaté, gérant |
| Date et signature : | Date et signature : |
