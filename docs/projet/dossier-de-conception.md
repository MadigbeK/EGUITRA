# Dossier de conception : EGUITRA Finance et AxisPro Suite

Projet de document, version de travail du 17 octobre 2026, à relire par le gérant avant envoi au client.
Il intègre les prototypes de la direction (M. Diallo, DGA), adoptés comme cahier des charges (offre,
§ 2.3), et le courrier du responsable financier (M. Kalissa) énumérant les vingt attentes.
Référence : offre OTF-EGUITRA-2026-37. Objet : arrêter la conception (offre, chapitre 6.2, jalon de
la semaine 1) et la liste définitive des composants (offre, chapitre 3.8). Les montants et délais
de l'offre ne changent pas.

## 1. Ce qui est construit

Une plateforme unique pour EGUITRA GROUP SARLU et MB AxisPro Consulting :

- **EGUITRA Finance** : pilotage du dirigeant, comptabilité SYSCOHADA, trésorerie, approbations,
  clôtures, états financiers, fiscalité, dette, immobilisations, budget, et les métiers chantiers et
  immobilier.
- **NIMOVA · Transport** (application à part entière depuis le 22 octobre 2026) : rotations,
  facturation, manquants, rentabilité (coûts standard, déclarés, comptabilisés), ensembles gérés
  pour des propriétaires et leurs relevés, taxes spécifiques, flotte, routes et tarifs.
- **AxisPro Suite** : évaluation des projets selon la méthode MB AxisPro Consulting (stage gates, scoring
  Readiness et Bankability, knock-outs, écarts prioritaires), data room, comités et décisions
  scellées, rapports, modèle financier, risques et plan d'actions, temps et honoraires du cabinet.
- **Portail des porteurs de projets** : suivi du dossier, dépôt des pièces, échanges avec le cabinet.
- **Rotations** : application de saisie au parc, installable sur téléphone, utilisable sans réseau.

Les utilisateurs ne voient que ces applications (et NIMOVA · Analyse, pour le dirigeant). Le noyau de gestion (Odoo Community 19)
tient les comptes et n'est accessible qu'à l'équipe technique.

## 2. Architecture

| Couche | Réalisation |
|---|---|
| Applications | Une application web (espaces : finance, transport, axispro, analyse, portail, mobile), à l'image du groupe et du cabinet, en français. |
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
| Engagements de dépense | approuvés avant la commande, devis joint : contrôle de la finance ; au-delà de 50 M GNF : accord de la direction ; les factures du fournisseur consomment l'engagement sans refaire le circuit, dans la limite du reste à engager (tolérance 5 %) |
| Approbation des pièces d'achat | toutes : contrôle de la finance ; au-delà de 50 M GNF : accord de la direction |
| Approbation des règlements et décaissements | règlements, sorties de caisse et de banque, échéances d'emprunt, virements internes : au-delà de 100 M GNF, accord de la direction ; l'opération reste en brouillon jusqu'à la dernière approbation |
| Alertes de gestion (gravités bloquante, critique, élevée, moyenne, avec l'action recommandée) | compte de passage 585 non soldé (bloquant) ; trésorerie sous le minimum (à fixer par société) et compte de banque ou de caisse négatif ; DSCR < 1,20 ; créances échues depuis plus de 90 jours, part échue > 20 %, délai de recouvrement > 60 jours, concentration sur un client > 40 % ; dettes fournisseurs échues ; résultat net cumulé négatif ; marge transport < 30 %, rotations non facturées, ensembles routiers déficitaires après charges de structure ; dépassement budgétaire > 10 % ; clôture en retard de plus de 10 jours ; validation en attente depuis plus de 3 jours |
| Pertes attendues (IFRS 9, retraitement hors livres SYSCOHADA) | non échu 1 %, 1 à 30 jours 3 %, 31 à 60 jours 10 %, 61 à 90 jours 25 %, au-delà 50 % |
| Relances des clients | rappel dès 1 jour de retard, relance ferme à 15 jours, mise en demeure à 30 jours (jamais envoyée sans décision de la finance) |
| Clôture mensuelle | contrôles bloquants (équilibres, compte de passage, pièces en attente, relevés rapprochés), verrouillage et empreinte de chaînage des écritures, réouverture tracée |
| Transport | tarif du client sur la route, à défaut tarif de la route ; facture par client, une ligne par rotation |
| Coût standard d'une rotation | forfaits de la route (litres de carburant aller et retour × prix du litre applicable à la date de chargement, prime de route, péages, autres frais) ; mis à jour tant que la rotation est saisie, figé à sa validation ; marge estimée = montant facturable + taxes refacturées − manquants à charge − coût standard |
| Ensembles gérés pour des propriétaires | règles de répartition en % du chiffre d'affaires brut, par ensemble ou par catégorie (la règle de l'ensemble l'emporte pour un même bénéficiaire), dues même si la marge est négative ; part du propriétaire = marge − commissions ; marge sur frais déclarés et charges mensuelles au prorata des jours, ou sur pièces comptabilisées sur l'ensemble ; relevé figé, pièces en brouillon (facture d'achat du propriétaire, refacturation d'une part négative, factures des commissions des tiers) |
| Chantiers | retenue de garantie (5 % par défaut) portée en 4117 jusqu'à sa libération |
| Immobilier | quittancement chaque nuit : une facture par échéance passée, datée de l'échéance, validée aussitôt (rattrapage compris) ; impayés relancés comme les autres créances |
| Pièces déposées | PDF, JPEG, PNG, Word .docx et Excel .xlsx, reconnus d'après leur contenu ; 20 Mo par fichier ; dossier d'un porteur limité à 400 pièces ou 1 Go, 50 messages par jour |
| AxisPro (méthode MB AxisPro Consulting, réf. SC-01) | grille officielle de 111 critères, 15 domaines, 8 gates ; atteint 1, partiel 0,5, non disponible 0, non évalué compté non disponible ; preuve exigée ou périmée : critère ramené à partiel ; scores Project Readiness, APD Readiness et Bankability ; knock-out non atteint (ou incomplet) : NO-GO ; BANKABLE à partir de 80/100, APD READY à partir de 65, CONDITIONAL GO à partir de 50, HOLD à partir de 30 ; décision du comité scellée, dossier figé jusqu'à une nouvelle révision |

## 6. Sécurité

Double authentification pour tous les utilisateurs (y compris le portail et l'application Rotations),
mots de passe d'au moins 10 caractères, mot de passe provisoire à remplacer avant tout accès,
sessions courtes et révocables (accès 15 minutes, session de 7 jours au plus, 90 jours pour les
agents du parc dans Rotations), déconnexion qui ferme toute la session, limitation des essais par
identifiant et par adresse, journal des accès conservé 12 mois, piste d'audit avec valeurs avant et
après, échanges chiffrés (TLS), noyau et base jamais exposés sur Internet, client web du noyau
réservé aux adresses de l'équipe technique.

Chaque société ne voit que ses propres données, jusque dans les pièces de la data room, les revues
de comité et les grilles du cabinet. Une pièce approuvée puis modifiée doit être approuvée à
nouveau. Les fichiers déposés sont contrôlés d'après leur contenu (les documents à macros sont
refusés) et toujours servis en téléchargement ; les exports pour tableur ne contiennent jamais de
formule. Le téléphone d'un agent du parc ne garde ni tarifs ni marges, et s'efface à la déconnexion.
Les applications appliquent une politique de sécurité du contenu (aucun script ni appel vers un
site tiers).

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
responsable financier avant la mise en production (offre, chapitre 6.3) : les 26 valeurs de
référence du classeur (équilibre, résultat, trésorerie, créances, dettes, transport, bilan) sont
recalculées par la plateforme et leur conformité (« n/26 ») est annexée au procès-verbal de bascule.

## 9. Cahier de recette : les vingt attentes du département Finance

| # | Attente | Où la vérifier | Vérification |
|---|---|---|---|
| 1 | Visibilité temps réel CA, résultat, trésorerie | Tableau de bord, Pilotage, Rapport mensuel | Saisir une facture : CA et encours à jour immédiatement ; onze questions du dirigeant avec leur verdict ; « ce qui demande une décision » ; arrêté à une date |
| 2 | Vue consolidée, décomposable | Sélecteur de société, bouton Groupe ; États > Consolidé du groupe ; Activités et budget | Un même compte passe d'une société à l'autre, comptabilités séparées ; compte de résultat et bilan par société, éliminations intra-groupe, groupe ; marge par activité, centre de coût, chantier, ensemble, route |
| 3 | Comptabilité SYSCOHADA révisé | Balance et états, Clôtures | Bilan équilibré, compte de résultat, tableau des flux rapproché de la trésorerie ; clôture mensuelle complète (dotations, liquidation de la TVA, factures à établir, sceau et procès-verbal) ; exports XLSX et CSV des états ; SAF-T |
| 4 | Analytique multi-axes | Activités et budget, saisie des pièces | Imputation automatique depuis rotations, chantiers, loyers, catégories de dépense ; saisie sur plusieurs axes par ligne ; imputation obligatoire contrôlée |
| 5 | Trésorerie et rapprochement | Trésorerie | Import d'un relevé réel (CSV, XLSX ou camt.053), soldes du relevé contrôlés, rapprochement des lignes, état de rapprochement ; flux mensuels et prévision à trois mois |
| 6 | Immobilisations et amortissements | Immobilisations | Dotations mensuelles automatiques ventilées par activité, sortie d'actif (cession), registre exporté |
| 7 | Budget et écarts | Activités et budget | Budget mensuel par ligne budgétaire, réalisé, engagé, disponible, écarts, alerte de dépassement |
| 8 | Facturation clients et fournisseurs | Ventes, Achats, Relances clients | Facture, avoir, échéance, relance ; litige qui suspend les relances ; balance âgée clients et fournisseurs |
| 9 | Fiscalité, TVA, déclarations | Fiscalité | TVA du mois rapprochée des écritures et liquidée à la clôture, retenues à la source, déclarations et historique, modèle validé par l'expert-comptable |
| 10 | Approbation des engagements et paiements | Engagements, À valider | Engagement approuvé avant la commande ; pièce, règlement ou décaissement au-delà du seuil bloqué jusqu'à approbation |
| 11 | Coûts et rentabilité transport | Transport, application Rotations | Rotation saisie au parc hors réseau, marge par ensemble et par route, coût au km, charges de structure ; volumes, manquants et taxes spécifiques au barème |
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
