// Génère docs/offre/Offre_technique_financiere_EGUITRA.docx et .md
// Usage : node docs/offre/build.js
const fs = require('fs');
const path = require('path');
const { HYP, P1, P2, PLANNING } = require('./contenu');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  ShadingType, HeadingLevel, AlignmentType, BorderStyle, LevelFormat, PageBreak,
  TableOfContents, Header, Footer, PageNumber, VerticalAlign, ImageRun,
} = require('docx');

// ---------------------------------------------------------------- calculs
const NBSP = ' ';
const gnf = (n) => Math.round(n).toLocaleString('fr-FR').replace(/[   ]/g, NBSP) + NBSP + 'GNF';
const gnfHT = (n) => `${gnf(n)} HT`;
const pct = (n, tot) => `${Math.round((n / tot) * 100)}${NBSP}%`;

const logoPath = HYP.logoFichiers.map((f) => path.join(__dirname, f)).find((f) => fs.existsSync(f));

// ---------------------------------------------------------------- contenu
// Blocs : h1, h2, h3, p, ul, table, callout, pagebreak, toc, cover
const B = [];
const h1 = (t) => B.push({ t: 'h1', v: t });
const h2 = (t) => B.push({ t: 'h2', v: t });
const h3 = (t) => B.push({ t: 'h3', v: t });
const p = (t) => B.push({ t: 'p', v: t });
const ul = (items) => B.push({ t: 'ul', v: items });
const table = (head, rows, widths, opts = {}) => B.push({ t: 'table', head, rows, widths, opts });
const callout = (t) => B.push({ t: 'callout', v: t });
const pagebreak = () => B.push({ t: 'pagebreak' });

B.push({ t: 'cover' });
pagebreak();
B.push({ t: 'toc' });
pagebreak();

// ================================================================ 1. Synthèse
h1('1. Synthèse de l\'offre');
p(`${HYP.client} et ${HYP.client2} partagent une direction générale, des locaux et deux projets de digitalisation : le département Finance d'une part, l'accompagnement des porteurs de projets d'autre part. ${HYP.prestataire} présente deux propositions qui répondent toutes deux à ces deux projets, dans le même délai de ${HYP.dureeSemaines} semaines et sur le même hébergement.`);
table(
  ['', P1.code, P2.code],
  [
    ['Approche', 'Une plateforme unique : un noyau de gestion open source éprouvé, invisible pour les utilisateurs, et deux applications à votre image, EGUITRA Finance et AxisPro Suite.', 'Deux applications indépendantes développées entièrement sur mesure, EGUITRA Finance et AxisPro Suite, déployées sur un même serveur.'],
    ['Attentes du département Finance couvertes', 'Vingt sur vingt', 'Quatorze en totalité, six en partie'],
    ['Délai de mise en production', `${HYP.dureeSemaines} semaines`, `${HYP.dureeSemaines} semaines`],
    ['Investissement, hébergement de la première année compris', gnfHT(P1.total), gnfHT(P2.total)],
    ['Hébergement, maintenance et support à partir de la deuxième année', `${gnfHT(P1.maintenanceAn)} par an`, `${gnfHT(P2.maintenanceAn)} par an`],
    ['Licences logicielles', 'Aucune', 'Aucune'],
    ['Garantie corrective', `${HYP.garantieMois} mois`, `${HYP.garantieMois} mois`],
  ],
  [2600, 3519, 3519],
);
callout(`Notre recommandation est la proposition 1. Pour ${gnf(P1.total - P2.total)} de plus, le groupe obtient un noyau comptable utilisé par des dizaines de milliers d'entreprises, le multi-sociétés, le rapprochement bancaire, les circuits d'approbation à plusieurs niveaux et une évolutivité sans nouveau développement. Les deux propositions sont détaillées et chiffrées ; le choix appartient à la direction.`);
p(`Validité de l'offre : ${HYP.validiteJours} jours à compter du ${HYP.dateOffre}. Tous les montants sont exprimés en francs guinéens, hors taxes.`);

pagebreak();

// ================================================================ 2. Compréhension
h1('2. Notre compréhension de votre besoin');
h2('2.1 Le groupe et ses activités');
p(`${HYP.client} opère sur trois secteurs : le transport et la logistique de produits pétroliers, le BTP et l'immobilier, complétés par une activité de négoce. Le transport d'hydrocarbures constitue le cœur de métier, avec une flotte de quinze ensembles citernes et des clients tels que les distributeurs pétroliers et les sociétés minières. ${HYP.client2}, cabinet de conseil du même groupe, accompagne des porteurs de projets vers le financement bancaire et l'investissement.`);
p('Le dossier de l\'exercice 2026 que vous nous avez transmis, arrêté au 15 août, donne la mesure du périmètre :');
table(
  ['Donnée', 'Volume au 15 août 2026'],
  [
    ['Activités et centres de coût', '7 activités, 9 centres de coût'],
    ['Comptes de trésorerie', '3 banques dont un compte USD, 2 caisses'],
    ['Flotte et chauffeurs', '15 ensembles citernes, 15 chauffeurs, 9 routes tarifées'],
    ['Rotations de transport enregistrées', '383'],
    ['Factures de vente et pièces d\'achat', '147 et 169'],
    ['Opérations de trésorerie', '412'],
    ['Immobilisations et financements', '24 immobilisations, 4 emprunts et crédits-bails'],
    ['Chiffre d\'affaires cumulé', `Environ 20,6 milliards${NBSP}GNF, dont 70${NBSP}% en transport d'hydrocarbures`],
  ],
  [4200, 5438],
);
h2('2.2 Les deux projets');
p('Projet 1 : la digitalisation du département Finance. Le courrier du responsable financier liste vingt attentes, de la comptabilité SYSCOHADA révisée à la rentabilité par trajet, en passant par la consolidation groupe, les workflows d\'approbation, la piste d\'audit et la disponibilité garantie. Le tableau du chapitre 5.1 répond point par point pour chaque proposition.');
p('Projet 2 : la digitalisation de l\'accompagnement des porteurs de projets. Le prototype MB AxisPro décrit une méthode d\'évaluation de la maturité et de la bancabilité : 111 critères répartis sur 15 domaines, huit stage gates, des critères éliminatoires, une data room de 42 pièces, des revues de comité et des rapports de décision.');
h2('2.3 Ce que nous retenons des prototypes existants');
p('Les deux prototypes générés par la direction constituent une spécification fonctionnelle de grande qualité. Nous les reprenons comme cahier des charges de référence dans les deux propositions, et notamment :');
ul([
  'Le principe de saisie unique : chaque donnée n\'est saisie qu\'une fois, tout le reste est calculé.',
  'Les règles de contrôle : équilibre débit et crédit, équilibre actif et passif, compte de passage des virements internes soldé, clôture refusée tant qu\'une alerte bloquante est active.',
  'Les indicateurs du dirigeant : chiffre d\'affaires et résultat par activité, trésorerie fin de mois, ancienneté des créances, service de la dette et DSCR, marge par rotation, écarts budgétaires.',
  'La méthode d\'évaluation AxisPro : pondération, critères critiques et éliminatoires, gaps prioritaires, historique des revues, politique d\'évaluation tracée dans chaque export.',
]);
p('Ces prototypes sont conçus pour un utilisateur unique, sans authentification, avec un fichier local comme seule sauvegarde. Les deux propositions conservent leurs règles et leur ergonomie, et y ajoutent ce qui manque à un outil d\'entreprise : multi-utilisateurs, droits par profil, piste d\'audit, sauvegardes, disponibilité et évolutivité.');

pagebreak();

// ================================================================ 3. Proposition 1
h1('3. Proposition 1 : plateforme intégrée sur noyau de gestion');
h2('3.1 Principe : un noyau invisible, des applications à votre image');
p('La plateforme repose sur deux couches strictement séparées.');
p('Le noyau de gestion est Odoo Community, complété par les modules de l\'Odoo Community Association (OCA) et par nos modules spécifiques. Il assure la tenue des écritures, la cohérence comptable, le multi-sociétés, le multi-devises, les droits d\'accès et la traçabilité. Il est publié sous licence libre : aucune redevance, aucune limite de nombre d\'utilisateurs, aucun éditeur à contacter pour une évolution.');
p(`Les applications métier sont développées sur mesure et constituent la seule interface utilisée par vos équipes : EGUITRA Finance pour le groupe, AxisPro Suite pour le cabinet. Elles reprennent votre identité visuelle, votre vocabulaire et vos parcours de saisie. Le client web du noyau n'est jamais exposé aux utilisateurs ; il reste accessible à la seule équipe technique de ${HYP.prestataire}, sur un accès réseau restreint. Cette approche est celle que nous avons mise en œuvre pour SOGUIPREM.`);
callout('Pour vos utilisateurs, il n\'existe qu\'EGUITRA Finance et AxisPro Suite. Le noyau reste un composant technique, au même titre que la base de données.');

h2('3.2 Architecture');
table(
  ['Couche', 'Composants', 'Rôle'],
  [
    ['Interface utilisateur', 'Applications web EGUITRA Finance et AxisPro Suite, application mobile de saisie des rotations, portail des porteurs de projets', 'Seule surface visible. Charte graphique du groupe, navigation métier, tableaux de bord, saisie guidée, exports.'],
    ['API métier', 'Modules spécifiques exposant une API sécurisée, authentification par jeton, double authentification', 'Traduit les actions métier en opérations du noyau, applique les règles de gestion, journalise.'],
    ['Noyau de gestion', 'Odoo Community, modules OCA, modules spécifiques du groupe', 'Comptabilité, analytique, trésorerie, immobilisations, budget, workflows, droits, audit.'],
    ['Données et documents', 'PostgreSQL, stockage de fichiers', 'Persistance, pièces justificatives, data room.'],
    ['Exploitation', 'VPS, conteneurs, proxy TLS, supervision, sauvegardes chiffrées hors site', 'Disponibilité, sécurité, restauration.'],
  ],
  [2000, 3900, 3738],
);

h2('3.3 EGUITRA Finance : les écrans');
table(
  ['Écran', 'Contenu'],
  [
    ['Tableau de bord du dirigeant', 'CA facturé, résultat, trésorerie fin de mois, encours clients, service de la dette, alertes actives, questions du dirigeant.'],
    ['Pilotage par activité', 'Répartition du CA, marge et charges par activité et par centre de coût, comparaison budget.'],
    ['Ventes', 'Factures de vente, avoirs, litiges, échéances, relances.'],
    ['Achats et dépenses', 'Pièces d\'achat par catégorie, TVA récupérable, justificatifs, circuit d\'approbation.'],
    ['Trésorerie', 'Encaissements, paiements, virements internes, position par compte et devise, rapprochement bancaire.'],
    ['Tiers', 'Clients et fournisseurs, conditions, limites de crédit, ancienneté des créances et des dettes.'],
    ['Immobilisations', 'Registre, amortissements, dotations mensuelles, cessions.'],
    ['Journaux et OD', 'Journaux de ventes, achats, banque, caisse, OD ; saisie d\'OD guidée.'],
    ['Balance et grand livre', 'Balance générale, grand livre par compte et par tiers, filtres par période et par activité.'],
    ['Budget face au réalisé', 'Lignes budgétaires mensuelles, écarts, seuils.'],
    ['Dette et financement', 'Emprunts et crédits-bails, échéanciers, DSCR.'],
    ['Alertes de gestion', 'Seuils de trésorerie, marge transport, écarts budgétaires, délais de recouvrement.'],
    ['Clôtures', 'Clôture mensuelle avec contrôles bloquants, registre des clôtures, réouverture contrôlée.'],
    ['Contrôles d\'intégrité', 'Équilibres, compte de passage, cohérence des références, empreinte des écritures.'],
    ['États financiers', 'Bilan, compte de résultat, tableau des flux au format SYSCOHADA, rapport mensuel de gestion.'],
    ['Approbations', 'Corbeille des engagements et paiements à valider par niveau.'],
    ['Exports', 'CSV et XLSX de tous les journaux et états, export d\'audit.'],
    ['Paramètres et utilisateurs', 'Référentiels, seuils, taux de change, profils et droits.'],
  ],
  [2800, 6838],
);
p('S\'y ajoutent les écrans métier : Flotte, Chauffeurs, Routes et tarifs, Rotations, Rentabilité par ensemble routier, Chantiers, Situations d\'avancement, Retenues de garantie, Biens, Baux, Quittancement, Patrimoine, Déclarations fiscales, Consolidation groupe et Passerelle IFRS.');

h2('3.4 Transport pétrolier : la rotation comme source unique');
p('Une rotation est saisie une seule fois, depuis le bureau ou depuis l\'application mobile au parc, y compris sans connexion : la saisie est mise en file et synchronisée dès que le réseau revient. Chaque rotation porte le camion, le chauffeur, le client, le produit, le volume, la route, le tarif, le carburant, les péages, les frais de chauffeur, la maintenance et les taxes spécifiques. Le noyau en déduit la ligne de facturation, les coûts analytiques par véhicule et par route, et la marge. Le seuil de marge transport du dossier devient une alerte automatique.');

h2('3.5 AxisPro Suite');
p('AxisPro Suite industrialise la méthode du prototype MB AxisPro dans un outil multi-utilisateurs, avec un portail pour les porteurs de projets. La grille d\'évaluation est importée comme données et reste modifiable par le cabinet, sans intervention technique.');
table(
  ['Écran', 'Contenu'],
  [
    ['Portefeuille de dossiers', 'Liste des projets par gate, secteur, promoteur, score et décision.'],
    ['Fiche projet', 'Identification, promoteur, localisation, capacité, calendrier, hypothèses de décision.'],
    ['Saisie guidée par gate', 'Critères du gate courant, statut, preuve jointe, commentaire.'],
    ['Score et knock-outs', 'Score par domaine, critères éliminatoires actifs, recommandation GO, NO-GO ou conditionnel.'],
    ['Gaps prioritaires', 'Classement selon poids, criticité et knock-out ; les cinq actions à mener.'],
    ['Data room', 'Index des pièces standard, disponibilité, versions, accès promoteur.'],
    ['Revues de comité', 'Enregistrement d\'une revue, historique, comparaison entre deux revues, verrouillage.'],
    ['Rapports', 'Rapport de décision pour le comité, liste des pièces à fournir pour le promoteur, export XLSX.'],
    ['Politique d\'évaluation', 'Réglages de pondération et de seuils, versionnés et rappelés dans chaque rapport.'],
    ['Portail du porteur de projet', 'Dépôt des pièces, avancement du dossier, échanges avec le cabinet.'],
  ],
  [2800, 6838],
);
p('Le cabinet dispose en outre, dans la même plateforme et sans coût supplémentaire, de la facturation de ses prestations et du suivi de ses temps par dossier.');

h2('3.6 Modules communautaires retenus');
table(
  ['Besoin', 'Module OCA'],
  [
    ['Rapprochement bancaire', 'account_reconcile_oca, account_statement_import_file'],
    ['Immobilisations', 'account_asset_management'],
    ['Budgets et états de gestion', 'mis_builder, mis_builder_budget'],
    ['États financiers et grand livre', 'account_financial_report'],
    ['Workflows d\'approbation', 'base_tier_validation, purchase_tier_validation, account_move_tier_validation'],
    ['Piste d\'audit', 'auditlog'],
    ['Contrats récurrents, loyers', 'contract'],
    ['Taux de change', 'currency_rate_update'],
    ['Gestion documentaire', 'dms'],
  ],
  [3600, 6038],
);
p('La liste définitive est arrêtée en semaine 1, module par module. Les besoins non couverts par un module communautaire sont réalisés en spécifique, sans surcoût par rapport à la présente offre.');

pagebreak();

// ================================================================ 4. Proposition 2
h1('4. Proposition 2 : deux applications indépendantes');
h2('4.1 Principe');
p(`Deux applications web distinctes sont développées entièrement sur mesure par ${HYP.prestataire}, chacune avec sa base de données, ses utilisateurs et ses droits. Elles sont déployées sur le même VPS, derrière le même proxy sécurisé, et partagent les mêmes mécanismes de sauvegarde et de supervision. Il n'y a pas de noyau de gestion tiers : chaque fonction est écrite pour vous, à partir des prototypes de la direction.`);
h2('4.2 Application EGUITRA Finance');
p('L\'application reprend le moteur comptable du prototype de la direction et le transpose en application multi-utilisateurs :');
ul([
  'Référentiels : plan de comptes SYSCOHADA, activités, centres de coût, tiers, devises, catégories de dépense, types d\'opération, comptes de trésorerie.',
  'Journaux : ventes, achats et dépenses, trésorerie, rotations de transport, immobilisations, OD. Comptes de contrepartie déduits automatiquement, TVA calculée.',
  'Trésorerie : position par compte et devise, virements internes par compte de passage, pointage des opérations rapprochées.',
  'Immobilisations : registre, dotations mensuelles générées, cessions.',
  'Budget : lignes mensuelles par nature, écarts face au réalisé, seuils d\'alerte.',
  'Clôtures mensuelles : contrôles bloquants, registre, scellement du dossier par empreinte.',
  'États : balance, grand livre, bilan et compte de résultat SYSCOHADA, rapport mensuel de gestion, exports CSV et XLSX.',
  'Métiers : rentabilité par camion et par route à partir des rotations ; suivi des chantiers avec situations d\'avancement et retenues de garantie ; biens, baux et loyers pour l\'immobilier.',
  'Tableau de bord du dirigeant, alertes de gestion, dette et DSCR.',
  'Utilisateurs, profils, journal des modifications.',
]);
h2('4.3 Application AxisPro Suite');
p('L\'application reprend le prototype MB AxisPro avec le même périmètre fonctionnel que dans la proposition 1 : portefeuille de dossiers, fiche projet, saisie guidée par gate, score et knock-outs, gaps prioritaires, data room, revues de comité, rapports PDF et XLSX, politique d\'évaluation, portail des porteurs de projets.');
h2('4.4 Limites à connaître');
p('Cette proposition est plus légère et moins coûteuse. Elle comporte des limites que nous préférons énoncer avant la signature :');
ul([
  'Le moteur comptable est développé pour vous : il n\'a pas l\'historique d\'un noyau utilisé par des dizaines de milliers d\'entreprises. La recette avec votre expert-comptable est d\'autant plus importante.',
  'Pas de multi-sociétés ni de consolidation automatique : la vue groupe se fait par activité, dans une seule entité juridique.',
  'Rapprochement bancaire par pointage manuel, sans import de relevés électroniques.',
  'Circuit d\'approbation à un seul niveau de validation.',
  'Chaque nouvelle fonction est un développement : l\'évolutivité dépend entièrement du prestataire.',
]);

pagebreak();

// ================================================================ 5. Comparaison
h1('5. Comparaison et recommandation');
h2('5.1 Couverture des attentes du département Finance');
table(
  ['Attente exprimée', P1.code, P2.code],
  [
    ['Visibilité globale et temps réel sur CA, résultat, trésorerie, indicateurs', 'Couverte', 'Couverte'],
    ['Vue consolidée du groupe, décomposable par activité, filiale, projet, ligne logistique', 'Couverte, multi-sociétés natif', 'Partielle : par activité, une seule société'],
    ['Comptabilité générale SYSCOHADA révisé', 'Couverte, plan de comptes du noyau', 'Couverte, moteur développé pour vous'],
    ['Comptabilité analytique par centre de coût, projet, chantier, activité', 'Couverte, plans analytiques multi-axes', 'Couverte'],
    ['Trésorerie et rapprochement bancaire', 'Couverte, import des relevés', 'Partielle : pointage manuel'],
    ['Immobilisations et amortissements', 'Couverte', 'Couverte'],
    ['Gestion budgétaire, écarts réalisé et prévisionnel', 'Couverte', 'Couverte'],
    ['Facturation client et fournisseur', 'Couverte, avec relances', 'Couverte, sans relances automatiques'],
    ['Gestion fiscale, TVA, déclarations locales', 'Couverte', 'Partielle : TVA ; déclarations en option'],
    ['Workflow d\'approbation des engagements et paiements', 'Couverte, plusieurs niveaux et seuils', 'Partielle : un niveau'],
    ['Coûts et rentabilité par trajet et véhicule, volumes, taxes spécifiques', 'Couverte', 'Couverte'],
    ['Chantiers, facturation à l\'avancement, retenues de garantie', 'Couverte', 'Couverte'],
    ['Gestion locative et valorisation du patrimoine', 'Couverte', 'Partielle : baux et loyers, sans quittancement automatique'],
    ['Traçabilité complète, piste d\'audit', 'Couverte, verrouillage par empreinte et journal d\'audit', 'Couverte, journal des modifications et empreinte'],
    ['Sécurisation des données et des accès par profil', 'Couverte', 'Couverte'],
    ['Disponibilité garantie et sauvegardes', 'Couverte', 'Couverte'],
    ['Interface simple et formation', 'Couverte', 'Couverte'],
    ['Support réactif et accompagnement', 'Couverte', 'Couverte'],
    ['Solution évolutive', 'Couverte, ajout de modules sans développement', 'Partielle : chaque évolution est un développement'],
    ['Tarification claire, sans coûts cachés', 'Couverte', 'Couverte'],
  ],
  [3838, 2900, 2900],
);
h2('5.2 Critères de choix');
table(
  ['Critère', P1.code, P2.code],
  [
    ['Investissement, première année', gnfHT(P1.total), gnfHT(P2.total)],
    ['Coût annuel à partir de la deuxième année', gnfHT(P1.maintenanceAn), gnfHT(P2.maintenanceAn)],
    ['Délai', `${HYP.dureeSemaines} semaines`, `${HYP.dureeSemaines} semaines`],
    ['Robustesse comptable', 'Noyau éprouvé, mis à jour par une communauté mondiale', 'Moteur écrit pour le groupe, éprouvé par la recette'],
    ['Périmètre', 'Vingt attentes sur vingt', 'Quatorze complètes, six partielles'],
    ['Évolutivité', 'Modules existants pour la paie, les stocks, les achats, la GMAO', 'Développement spécifique à chaque besoin'],
    ['Dépendance au prestataire', 'Faible : code ouvert, communauté, autres intégrateurs possibles', 'Forte : seul le prestataire connaît le code'],
    ['Simplicité technique', 'Plus de composants à exploiter', 'Deux applications légères'],
  ],
  [2600, 3519, 3519],
);
h2('5.3 Notre recommandation');
p(`Nous recommandons la proposition 1. L'écart de ${gnf(P1.total - P2.total)} finance un noyau comptable dont la fiabilité n'a plus à être démontrée, et évite au groupe de payer, dans deux ans, le développement de fonctions que le noyau apporte déjà. La proposition 2 reste pertinente si la direction privilégie un outil minimal et un budget plus serré ; elle est présentée avec ses limites pour que la décision soit prise en connaissance de cause.`);

pagebreak();

// ================================================================ 6. Hébergement
h1('6. Hébergement, sécurité et exploitation');
p('Ce chapitre s\'applique aux deux propositions.');
h2('6.1 Infrastructure');
ul([
  `Hébergement sur serveur virtuel privé dédié au groupe : ${HYP.vps}.`,
  'Déploiement en conteneurs, proxy avec certificats TLS renouvelés automatiquement, base de données dédiée.',
  'Deux environnements : production et recette. Chaque évolution passe en recette avant la production.',
  'Nom de domaine du groupe pour chaque application, par exemple finance.eguitragroup.com et axispro.mbaxisproconsulting.com.',
]);
h2('6.2 Sauvegardes et continuité');
table(
  ['Mesure', 'Engagement'],
  [
    ['Sauvegarde complète', 'Quotidienne, chiffrée, copiée hors site chez un second fournisseur'],
    ['Rétention', '30 sauvegardes quotidiennes, 12 sauvegardes mensuelles'],
    ['Perte de données maximale', '24 heures'],
    ['Délai de reprise', '4 heures ouvrées après déclaration de sinistre'],
    ['Test de restauration', 'Chaque trimestre, avec compte rendu remis au client'],
    ['Disponibilité cible', '99,5 % par mois, hors fenêtre de maintenance annoncée 48 heures à l\'avance'],
  ],
  [3600, 6038],
);
h2('6.3 Sécurité');
ul([
  'Authentification par mot de passe robuste et double authentification pour tous les utilisateurs.',
  'Droits par profil : direction, finance, exploitation transport, chantiers, immobilier, cabinet, porteur de projet. Chaque profil ne voit que son périmètre.',
  'Piste d\'audit : chaque création, modification et suppression est journalisée avec l\'utilisateur, la date et les valeurs avant et après.',
  'Écritures comptables verrouillées après clôture, avec empreinte de chaînage.',
  'Chiffrement des échanges et des sauvegardes, journaux d\'accès conservés 12 mois.',
  'Mises à jour de sécurité appliquées chaque mois en recette puis en production.',
]);
h2('6.4 Réversibilité');
p('Le client est propriétaire de ses données. À tout moment, sur simple demande, nous remettons une copie complète de la base, des pièces jointes et du code développé pour lui, dans des formats ouverts, avec la documentation d\'installation.');

pagebreak();

// ================================================================ 7. Démarche
h1('7. Démarche et planning en quatre semaines');
h2('7.1 Planning');
p(`Les deux propositions sont réalisées en ${HYP.dureeSemaines} semaines à compter de la commande, par une équipe dédiée à temps plein. Ce délai repose sur trois conditions : les prototypes de la direction servent de spécification, les composants d'interface déjà développés par ${HYP.prestataire} sont réutilisés, et les référents du client sont disponibles chaque semaine.`);
table(
  ['Semaine', 'Objet', 'Travaux', 'Jalon'],
  PLANNING,
  [1200, 1800, 4438, 2200],
);
p(`À l'issue de la semaine 4, ${HYP.prestataire} assure quatre semaines d'accompagnement renforcé sur site et à distance, puis la garantie corrective de ${HYP.garantieMois} mois.`);
h2('7.2 Reprise des données');
p('Le dossier 2026 est repris intégralement : référentiels, tiers, plan de comptes, immobilisations, financements, budget, ventes, achats, trésorerie, rotations et OD. Les balances obtenues sont confrontées au classeur d\'origine et validées par votre responsable financier avant la mise en production. L\'exercice 2026 est ainsi consultable dans l\'outil dès le premier jour, et l\'exercice 2027 s\'ouvre directement dans l\'outil.');
h2('7.3 Recette et formation');
ul([
  'Cahier de recette rédigé avec vos équipes en semaine 3, recette en semaine 4 sur vos données.',
  'Formation par profil : direction, finance, exploitation, chantiers, immobilier, cabinet. Supports et guides utilisateur remis en français.',
  'Accompagnement renforcé pendant les quatre semaines suivant la mise en production.',
]);
h2('7.4 Gouvernance');
ul([
  'Un comité de pilotage hebdomadaire avec la direction générale et le responsable financier.',
  'Un point d\'avancement quotidien de quinze minutes avec le référent du client.',
  'Un espace partagé de suivi des demandes, accessible au client.',
]);
h2('7.5 Équipe E-VOLUTION XP');
table(
  ['Rôle', 'Mission'],
  [
    ['Directeur de projet et architecte', 'Interlocuteur unique, conception, arbitrages, qualité des livraisons.'],
    ['Consultant fonctionnel finance', 'Paramétrage SYSCOHADA, analytique, états financiers, reprise des données, formation.'],
    ['Développeurs', 'Noyau et API dans la proposition 1, moteur comptable dans la proposition 2 ; applications EGUITRA Finance et AxisPro Suite, application mobile, portail.'],
    ['Ingénieur exploitation', 'VPS, sécurité, sauvegardes, supervision, support.'],
    ['Expert-comptable partenaire', 'Validation du plan de comptes, des états financiers et des déclarations fiscales guinéennes.'],
  ],
  [3200, 6438],
);
h2('7.6 Prérequis côté client');
ul([
  'Un référent par domaine disponible une demi-journée par jour pendant les quatre semaines.',
  'La charte graphique du groupe et du cabinet, ou un atelier de définition en semaine 1.',
  'Les relevés bancaires et les modèles de déclarations fiscales en vigueur.',
  'La validation du plan de comptes par votre expert-comptable en semaine 2.',
]);

pagebreak();

// ================================================================ 8. Offre financière
h1('8. Offre financière');
h2('8.1 Hypothèses');
ul([
  'Tous les montants sont en francs guinéens, hors taxes. La TVA et les retenues applicables en Guinée sont ajoutées selon la réglementation en vigueur.',
  'Prix forfaitaires : le montant de chaque proposition est ferme pour le périmètre décrit. Toute évolution de périmètre fait l\'objet d\'un avenant chiffré.',
  'Aucun coût de licence dans les deux propositions.',
  'L\'hébergement de la première année est compris dans le montant de chaque proposition.',
]);

for (const P of [P1, P2]) {
  h2(`8.${P === P1 ? 2 : 3} ${P.code} : ${P.titre}`);
  table(
    ['Poste', 'Montant HT', 'Part'],
    [...P.postes.map(([l, m]) => [l, gnf(m), pct(m, P.total)]), [`Total ${P.code.toLowerCase()}`, gnf(P.total), `100${NBSP}%`]],
    [6238, 2200, 1200],
    { lastBold: true },
  );
}

h2('8.4 Hébergement, maintenance et support à partir de la deuxième année');
p('La première année d\'hébergement est comprise dans chaque proposition. À partir de la deuxième année, un forfait annuel unique couvre :');
table(
  ['Prestation', 'Détail'],
  [
    ['Hébergement', HYP.vps],
    ['Exploitation', 'Supervision, sauvegardes, tests de restauration, mises à jour de sécurité, renouvellement des certificats'],
    ['Support', 'Assistance des utilisateurs du lundi au vendredi, de 8 h à 18 h, par messagerie, e-mail et téléphone'],
    ['Maintenance corrective', 'Correction de toute anomalie, sans limite'],
    ['Maintenance évolutive', 'Deux jours par mois de petites évolutions, cumulables sur le trimestre'],
    [`Forfait annuel, ${P1.code.toLowerCase()}`, `${gnfHT(P1.maintenanceAn)}, facturé par semestre d'avance`],
    [`Forfait annuel, ${P2.code.toLowerCase()}`, `${gnfHT(P2.maintenanceAn)}, facturé par semestre d'avance`],
  ],
  [2600, 7038],
  { boldRows: [5, 6] },
);
p('Délais d\'intervention du support, applicables dès la mise en production :');
table(
  ['Gravité', 'Définition', 'Prise en charge', 'Résolution ou contournement'],
  [
    ['Bloquante', 'Application inaccessible ou saisie impossible pour tous', '2 heures ouvrées', '8 heures ouvrées'],
    ['Majeure', 'Fonction essentielle indisponible pour un profil', '4 heures ouvrées', '2 jours ouvrés'],
    ['Mineure', 'Gêne sans blocage', '1 jour ouvré', 'Prochaine livraison planifiée'],
  ],
  [1600, 3838, 2000, 2200],
);

h2('8.5 Synthèse financière');
table(
  ['', P1.code, P2.code],
  [
    ['Réalisation et hébergement, première année', gnfHT(P1.total), gnfHT(P2.total)],
    ['Hébergement, maintenance et support, par an à partir de la deuxième année', gnfHT(P1.maintenanceAn), gnfHT(P2.maintenanceAn)],
    ['Coût cumulé sur trois ans', gnfHT(P1.total + 2 * P1.maintenanceAn), gnfHT(P2.total + 2 * P2.maintenanceAn)],
  ],
  [3838, 2900, 2900],
  { boldRows: [0] },
);

h2('8.6 Conditions de paiement');
ul([
  '50 % à la commande, 30 % à la recette en semaine 4, 20 % au procès-verbal de mise en production.',
  'Forfait annuel d\'hébergement, maintenance et support : par semestre d\'avance, à compter du treizième mois.',
  'Règlement à 30 jours date de facture, par virement bancaire.',
]);

h2('8.7 Engagements contractuels');
ul([
  `Garantie corrective de ${HYP.garantieMois} mois après la mise en production, incluse dans le prix.`,
  'Propriété du client sur ses données et sur le code développé pour lui ; les composants génériques d\'E-VOLUTION XP restent réutilisables par E-VOLUTION XP.',
  'Réversibilité complète sur demande, sans frais, dans les formats ouverts décrits au chapitre 6.4.',
  'Confidentialité des données financières et des dossiers des porteurs de projets, y compris après la fin du contrat.',
  `Validité de l'offre : ${HYP.validiteJours} jours à compter du ${HYP.dateOffre}.`,
]);

pagebreak();

// ================================================================ 9. Annexes
h1('9. Annexes');
h2('9.1 Glossaire');
table(
  ['Terme', 'Définition'],
  [
    ['OCA', 'Odoo Community Association, association qui publie des modules libres pour le noyau de gestion.'],
    ['SYSCOHADA', 'Système comptable de l\'Organisation pour l\'harmonisation en Afrique du droit des affaires, version révisée.'],
    ['DSCR', 'Ratio de couverture du service de la dette.'],
    ['Stage gate', 'Étape de décision d\'un projet, avec ses règles de passage.'],
    ['Knock-out', 'Critère éliminatoire imposant un NO-GO quel que soit le score.'],
    ['VPS', 'Serveur virtuel privé, dédié au client chez un hébergeur.'],
    ['TLS', 'Chiffrement des échanges entre le navigateur et le serveur.'],
  ],
  [2000, 7638],
);
h2('9.2 Signature');
p(`Pour ${HYP.prestataire} :`);
p('Nom, qualité, date et signature');
p(`Pour ${HYP.client} et ${HYP.client2}, bon pour accord sur la proposition retenue :`);
p('Proposition retenue :  1    2');
p('Nom, qualité, date, signature et cachet');

// ---------------------------------------------------------------- rendu MD
function toMarkdown() {
  const out = [];
  for (const b of B) {
    switch (b.t) {
      case 'cover':
        out.push(`![${HYP.prestataire}](${path.basename(logoPath || 'logo.png')})`, '',
          '# Offre technique et financière', '',
          '**Digitalisation du département Finance et de l\'accompagnement des porteurs de projets**', '',
          `Pour ${HYP.client} et ${HYP.client2}, à l'attention de ${HYP.dg}`, '',
          `Référence ${HYP.reference}, ${HYP.dateOffre}, valable ${HYP.validiteJours} jours`, '',
          `Émise par ${HYP.prestataire}, ${HYP.slogan}. Contact : ${HYP.contact}`, '');
        break;
      case 'toc': out.push('_Sommaire : voir la version Word, table des matières automatique._', ''); break;
      case 'pagebreak': out.push('', '---', ''); break;
      case 'h1': out.push('', `## ${b.v}`, ''); break;
      case 'h2': out.push('', `### ${b.v}`, ''); break;
      case 'h3': out.push('', `#### ${b.v}`, ''); break;
      case 'p': out.push(b.v, ''); break;
      case 'callout': out.push(`> ${b.v}`, ''); break;
      case 'ul': out.push(...b.v.map((i) => `- ${i}`), ''); break;
      case 'table': {
        const esc = (s) => String(s).replace(/\|/g, '\\|');
        out.push(`| ${b.head.map(esc).join(' | ')} |`, `|${b.head.map(() => '---').join('|')}|`);
        b.rows.forEach((r, i) => {
          const bold = (b.opts.lastBold && i === b.rows.length - 1) || (b.opts.boldRows || []).includes(i);
          out.push(`| ${r.map((c) => (bold ? `**${esc(c)}**` : esc(c))).join(' | ')} |`);
        });
        out.push('');
        break;
      }
    }
  }
  return out.join('\n').replace(/(\n---\n){2,}/g, '\n---\n');
}

// ---------------------------------------------------------------- rendu DOCX
const NAVY = '1C1E6B'; // bleu du logo
const TEAL = '1A9E9E'; // vert-bleu du logo
const GREY = 'F2F4F7';
const FONT = 'Calibri';
const CONTENT_W = 9638; // A4 moins marges de 2 cm

const run = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size || 22, bold: o.bold, color: o.color, italics: o.italics });
const para = (text, o = {}) => new Paragraph({
  children: [run(text, o)], spacing: { after: o.after ?? 120, before: o.before ?? 0 }, alignment: o.align,
});
const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'C9CFD8' };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function docTable(head, rows, widths, opts = {}) {
  const w = widths || head.map(() => Math.floor(CONTENT_W / head.length));
  const mk = (text, i, o) => new TableCell({
    width: { size: w[i], type: WidthType.DXA },
    borders,
    verticalAlign: VerticalAlign.CENTER,
    shading: o.shade ? { type: ShadingType.CLEAR, fill: o.shade, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [run(String(text), { size: 19, bold: o.bold, color: o.color })], spacing: { after: 0 } })],
  });
  const headRow = new TableRow({
    tableHeader: true,
    children: head.map((h, i) => mk(h, i, { shade: NAVY, bold: true, color: 'FFFFFF' })),
  });
  const bodyRows = rows.map((r, ri) => {
    const bold = (opts.lastBold && ri === rows.length - 1) || (opts.boldRows || []).includes(ri);
    return new TableRow({ children: r.map((c, i) => mk(c, i, { bold, shade: bold ? 'E6F4F4' : (ri % 2 ? GREY : undefined) })) });
  });
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: w, rows: [headRow, ...bodyRows] });
}

function logoRun(widthPx) {
  if (!logoPath) return null;
  const data = fs.readFileSync(logoPath);
  const h = Math.round(widthPx * 820 / 1400); // proportions du logo
  return new ImageRun({ type: 'png', data, transformation: { width: widthPx, height: h }, altText: { title: HYP.prestataire, description: `Logo ${HYP.prestataire}`, name: 'logo' } });
}

function coverPage() {
  const c = [];
  const logo = logoRun(300);
  if (logo) c.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 900 }, children: [logo] }));
  else c.push(para(HYP.prestataire, { size: 40, bold: true, color: NAVY, align: AlignmentType.CENTER, before: 600, after: 900 }));
  c.push(para('Offre technique et financière', { size: 52, bold: true, color: NAVY, after: 240 }));
  c.push(para('Digitalisation du département Finance et de l\'accompagnement des porteurs de projets', { size: 28, color: '444444', after: 700 }));
  c.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: TEAL, space: 1 } }, spacing: { after: 500 }, children: [] }));
  c.push(para(`Pour ${HYP.client}`, { size: 26, bold: true, after: 60 }));
  c.push(para(`et ${HYP.client2}`, { size: 26, bold: true, after: 60 }));
  c.push(para(`À l'attention de ${HYP.dg}`, { size: 22, after: 700 }));
  c.push(para(`Référence ${HYP.reference}`, { size: 20, color: '666666', after: 40 }));
  c.push(para(`${HYP.dateOffre}, offre valable ${HYP.validiteJours} jours`, { size: 20, color: '666666', after: 40 }));
  c.push(para(`${HYP.prestataire}, ${HYP.slogan}. Contact : ${HYP.contact}`, { size: 20, color: '666666', after: 40 }));
  c.push(para('Document confidentiel, destiné exclusivement à ses destinataires.', { size: 18, italics: true, color: '888888', before: 1200 }));
  return c;
}

function toDocx() {
  const children = [];
  for (const b of B) {
    switch (b.t) {
      case 'cover': children.push(...coverPage()); break;
      case 'toc':
        children.push(para('Sommaire', { size: 32, bold: true, color: NAVY, after: 240 }));
        children.push(new TableOfContents('Sommaire', { hyperlink: true, headingStyleRange: '1-2' }));
        break;
      case 'pagebreak': children.push(new Paragraph({ children: [new PageBreak()] })); break;
      case 'h1': children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(b.v, { size: 32, bold: true, color: NAVY })], spacing: { before: 240, after: 200 } })); break;
      case 'h2': children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run(b.v, { size: 26, bold: true, color: NAVY })], spacing: { before: 280, after: 120 } })); break;
      case 'h3': children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [run(b.v, { size: 22, bold: true, color: '333333' })], spacing: { before: 200, after: 80 } })); break;
      case 'p': children.push(para(b.v, { after: 140 })); break;
      case 'callout':
        children.push(new Paragraph({
          children: [run(b.v, { size: 21, italics: true, color: NAVY })],
          shading: { type: ShadingType.CLEAR, fill: 'E6F4F4', color: 'auto' },
          border: { left: { style: BorderStyle.SINGLE, size: 24, color: TEAL, space: 8 } },
          spacing: { before: 120, after: 200 }, indent: { left: 200, right: 200 },
        }));
        break;
      case 'ul': b.v.forEach((i) => children.push(new Paragraph({ numbering: { reference: 'puces', level: 0 }, children: [run(i)], spacing: { after: 80 } }))); break;
      case 'table':
        children.push(docTable(b.head, b.rows, b.widths, b.opts));
        children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
        break;
    }
  }

  const headerLogo = logoRun(70);
  return new Document({
    creator: HYP.prestataire,
    title: 'Offre technique et financière EGUITRA',
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, color: NAVY, font: FONT }, paragraph: { spacing: { before: 240, after: 200 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: NAVY, font: FONT }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, color: '333333', font: FONT }, paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
      ],
    },
    numbering: {
      config: [
        { reference: 'puces', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 280 } } } }] },
      ],
    },
    features: { updateFields: true },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      headers: {
        default: new Header({ children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C9CFD8', space: 4 } },
          children: [...(headerLogo ? [headerLogo, run('    ', { size: 16 })] : []), run(`Offre technique et financière, ${HYP.client} et ${HYP.client2}`, { size: 16, color: '888888' })],
        })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(`${HYP.prestataire}, ${HYP.slogan}. Réf. ${HYP.reference}, confidentiel. Page `, { size: 16, color: '888888' }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '888888' })] })] }),
      },
      children,
    }],
  });
}

// ---------------------------------------------------------------- sortie
(async () => {
  const base = 'Offre_technique_financiere_EGUITRA';
  fs.writeFileSync(path.join(__dirname, `${base}.md`), toMarkdown());
  const buf = await Packer.toBuffer(toDocx());
  fs.writeFileSync(path.join(__dirname, `${base}.docx`), buf);
  console.log(`OK : logo ${logoPath ? path.basename(logoPath) : 'absent'} ; P1 ${gnf(P1.total)} ; P2 ${gnf(P2.total)}`);
})();
