# Réponse aux vingt attentes du département Finance

Note de E-VOLUTION XP pour EGUITRA GROUP SARLU, à l'attention de M. Kalissa, responsable financier.
Version du 17 octobre 2026. Référence : offre OTF-EGUITRA-2026-37, chapitre 4.

Le courrier du responsable financier énumère vingt attentes ; l'offre y répond au chapitre 4 et adopte
les prototypes de la direction (EGUITRA Finance, moteur comptable, et MB AxisPro Suite) comme cahier
des charges. Cette note dit, attente par attente, ce que la plateforme fait aujourd'hui, où le
vérifier sur l'environnement de recette, et ce qui attend encore une décision de votre part. Chaque
point se rejoue avec le cahier de recette (`Cahier_de_recette.xlsx`, 73 scénarios).

## Les vingt attentes

| # | Attente | Ce que fait la plateforme | Où le vérifier |
|---|---|---|---|
| 1 | Visibilité globale et en temps réel | Tableau de bord du dirigeant à toute date, pour une société ou le groupe : chiffre d'affaires face au budget, marges, trésorerie et sa prévision, délais clients, couverture de la dette ; onze questions du dirigeant avec leur verdict ; « ce qui demande une décision » ; rapport mensuel rédigé, comparé au mois précédent et à l'an dernier. | Pilotage > Tableau de bord, Rapport mensuel |
| 2 | Vue consolidée, décomposable | Un même compte passe d'une société à l'autre ; compte de résultat et bilan par société, éliminations des opérations entre sociétés du groupe et total du groupe ; résultat par activité, centre de coût, chantier, ensemble routier, route, bien. | Balance et états > Consolidé du groupe ; Activités et budget |
| 3 | Comptabilité SYSCOHADA révisé | Plan SYSCOHADA, bilan, compte de résultat, tableau des flux rapproché de la trésorerie, balance et grand livre exportables ; clôture mensuelle complète (dotations, liquidation de la TVA, factures à établir, sceau et procès-verbal) ; export SAF-T. | Balance et états ; Clôtures et contrôles |
| 4 | Comptabilité analytique | Saisie sur plusieurs axes par ligne, imputations automatiques (rotations, chantiers, loyers, catégories de dépense, types d'opération), axes obligatoires par compte, contrôle des centres de coût imputés hors de leur activité. | Saisie des pièces ; Administration > Imputations |
| 5 | Trésorerie et rapprochement | Position par compte et devise ; import des relevés CSV, XLSX ou ISO 20022 camt.053, soldes contrôlés ; rapprochement proposé (factures, règlements, échéances d'emprunt) ; état de rapprochement ; flux mensuels et prévision à trois mois. | Trésorerie |
| 6 | Immobilisations et amortissements | Registre, dotations mensuelles automatiques, sorties d'actif, biens non amortissables, contrôle trimestriel des biens totalement amortis, registre exporté. | Immobilisations |
| 7 | Budget et écarts | Lignes budgétaires mensuelles par comptes, réalisé, engagé, disponible, écarts et statut par ligne, import et export Excel, alerte de dépassement. | Activités et budget > Budget |
| 8 | Facturation clients et fournisseurs | Factures, avoirs, échéances, relances à trois niveaux, litiges qui suspendent les relances, balance âgée clients et fournisseurs avec le statut de chaque tiers. | Ventes, Achats, Relances, Tiers |
| 9 | Fiscalité | TVA collectée et déductible rapprochée des écritures et liquidée à la clôture, retenues à la source paramétrables, déclarations et leur historique. | Fiscalité |
| 10 | Approbation des engagements et paiements | Engagement de dépense approuvé avant la commande (devis joint), consommé par les factures du fournisseur ; pièces d'achat, règlements et décaissements au-delà des seuils bloqués jusqu'à la dernière approbation ; décisions journalisées. | Engagements de dépense ; À valider |
| 11 | Rentabilité du transport | Rotation saisie au parc, même sans réseau ; marge par rotation, ensemble routier et route, coûts au kilomètre, charges de structure, ensembles déficitaires ; volumes, manquants tolérés et excédentaires, taxes spécifiques au barème et leur état mensuel. | Transport ; application Rotations |
| 12 | Chantiers | Situations d'avancement facturées, retenue de garantie portée en 4117 jusqu'à sa libération. | Chantiers |
| 13 | Gestion locative et patrimoine | Biens, baux, quittancement chaque nuit, impayés, quittances, valorisation et rendement du patrimoine. | Immobilier |
| 14 | Traçabilité | Journal d'audit (valeurs avant et après) sur tous les modèles de gestion ; écritures chaînées par empreinte, période scellée à la clôture et contrôle d'intégrité. | Journal d'audit ; Clôtures et contrôles |
| 15 | Sécurité des accès | Double authentification, droits par profil, sociétés ouvertes par utilisateur, journal des accès, sessions révocables. | Administration > Utilisateurs |
| 16 | Disponibilité et sauvegardes | Sauvegarde continue (perte de 15 minutes au plus), copie hors site chiffrée, restauration trimestrielle à un instant donné avec compte rendu, rapport mensuel de disponibilité. | Compte rendu de restauration |
| 17 | Interface simple et formation | Applications à votre image, saisie guidée, guide intégré à chaque espace, guides Word par profil. | Guides |
| 18 | Support et accompagnement | Procédure de support, délais d'intervention de l'offre (chapitre 7.2). | Procédure de support |
| 19 | Solution évolutive | Ajout d'un module du noyau sans développement, procédure de mise en production avec retour arrière (dossier technique). | Dossier technique |
| 20 | Tarification claire | Forfait ferme, aucune licence, forfait annuel unique (offre, chapitre 8). | Offre |

## Les prototypes de la direction

**EGUITRA Finance, moteur comptable.** Chaque fonction du prototype a été reprise, souvent au-delà :
catégories de dépense et types d'opération qui déduisent comptes, TVA et axes ; référentiels tenus
par la finance (plan comptable, axes, produits transportés) ; clôture mensuelle complète ; exports
de tous les états ; rentabilité du transport avec charges de structure ; besoin en fonds de
roulement et délais clients et fournisseurs ; flux mensuels de trésorerie ; dette (encours, dette
nette, couverture) ; budget par ligne budgétaire ; alertes de gestion à quatre gravités avec
l'action recommandée ; tableau de bord et onze questions du dirigeant ; rapport mensuel ;
pertes attendues IFRS 9 et passerelle IFRS ; export SAF-T ; réévaluation des devises ; guide intégré.
Les anomalies relevées dans le prototype n'ont pas été reproduites (par exemple la pièce de TVA
datée hors de la période scellée).

**MB AxisPro Suite.** La méthode du cabinet (réf. MBAP/PROJECT-DEVELOPMENT/SC-01) est appliquée
telle quelle : grille officielle de 111 critères, 15 domaines et 8 gates ; scores Project
Readiness, APD Readiness et Bankability ; knock-outs ; écarts prioritaires ; data room alimentée
par les preuves des critères ; règles de passage des gates ; classes et recommandation. En plus :
décision du comité scellée qui fige le dossier jusqu'à une nouvelle révision, journal du dossier,
modèle financier, risques, plan d'actions, rapports et classeur au format du cabinet.

## Reprise de l'exercice 2026

Le dossier du prototype se convertit en fichiers de reprise, puis la plateforme recalcule les 26
valeurs de référence du classeur et en donne la conformité (« n/26 »), annexée au procès-verbal de
bascule. Sur le dossier reçu, 18 valeurs sur 26 sont conformes. Les 8 autres ont une seule cause :
la façon d'amortir. Le prototype amortit en mois entiers à compter du mois qui suit l'acquisition ;
la plateforme amortit au jour près depuis la mise en service. Les deux sont défendables ; il faut
choisir (décision 1 ci-dessous).

## Décisions attendues de votre part

1. **Convention d'amortissement** des biens repris, avec l'expert-comptable : continuer la méthode
   historique du classeur (permanence des méthodes : il ne reste alors que des écarts d'arrondi de
   quelques dizaines de francs), ou adopter le calcul au jour près de la plateforme (l'écart de
   reprise est alors rattrapé sur une dotation, à placer en janvier 2026 ou en fin de plan).
2. **Emprunts** : taux d'intérêt de chaque emprunt (absents du classeur) ; l'à-nouveau du compte
   162 semble compter deux fois le déblocage de mars 2026, à confirmer.
3. **Seuils** d'approbation et d'alerte : ceux du prototype sont repris (trésorerie minimale, marge
   transport, délai de recouvrement, couverture de la dette, dépassement budgétaire) ; à confirmer
   avec la direction.
4. **Frais communs** aux deux sociétés : clé de répartition et refacturation (ils s'éliminent déjà
   en consolidation dès qu'ils sont refacturés).
5. **Choix comptables** à valider avec l'expert-comptable : plan de comptes et correspondances des
   états, règlement des échéances d'emprunt, factures à établir hors taxes, comptes des manquants du
   transport.
6. **Droits** : le parc peut-il modifier la fiche d'un chauffeur et les coefficients à 15 °C ; la
   finance d'une société peut-elle modifier un produit transporté commun aux deux sociétés.
