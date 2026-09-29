// Génère docs/offre/Offre_technique_financiere_EGUITRA.docx et .md
// Usage : node docs/offre/build.js
const fs = require('fs');
const path = require('path');
const { HYP, SAUVEGARDE, PENALITE, EVOLUTIONS, OFFRE, PLANNING } = require('./contenu');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  ShadingType, HeadingLevel, AlignmentType, BorderStyle, LevelFormat, PageBreak,
  TableOfContents, Header, Footer, PageNumber, VerticalAlign, ImageRun,
} = require('docx');

// ---------------------------------------------------------------- calculs
const NBSP = ' ';
const gnf = (n) => Math.round(n).toLocaleString('fr-FR').replace(/[   ]/g, NBSP) + NBSP + 'GNF';
const gnfHT = (n) => `${gnf(n)} HT`;
const pct = (n, tot) => `${Math.round((n / tot) * 100)}${NBSP}%`;
const fmtPct = (n) => `${String(n).replace('.', ',')}${NBSP}%`;
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const dateFin = (() => { const d = new Date(`${HYP.dateOffreISO}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + HYP.validiteJours); return `${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; })();
const logoPath = HYP.logoFichiers.map((f) => path.join(__dirname, f)).find((f) => fs.existsSync(f));

// ---------------------------------------------------------------- blocs
const B = [];
const h1 = (t) => B.push({ t: 'h1', v: t });
const h2 = (t) => B.push({ t: 'h2', v: t });
const p = (t) => B.push({ t: 'p', v: t });
const ul = (items) => B.push({ t: 'ul', v: items });
const table = (head, rows, widths, opts = {}) => B.push({ t: 'table', head, rows, widths, opts });
const callout = (t) => B.push({ t: 'callout', v: t });
const pagebreak = () => B.push({ t: 'pagebreak' });

B.push({ t: 'cover' });
pagebreak();
B.push({ t: 'toc' });
pagebreak();

// ================================================================ 1. L'essentiel
h1('1. L\'essentiel de notre offre');
p(`${HYP.client} conduit trois métiers exigeants, le transport d'hydrocarbures, le BTP et l'immobilier, et partage sa direction avec ${HYP.client2}, cabinet qui accompagne des porteurs de projets vers le financement. Les deux structures ont aujourd'hui des outils de gestion conçus pour un seul utilisateur, sans partage, sans droits d'accès et sans sauvegarde d'entreprise. Elles veulent un système unique, fiable, à leur image, qui donne au dirigeant une vision consolidée en temps réel et aux équipes des parcours de saisie simples.`);
p(`${HYP.prestataire} propose de mettre en production, en ${HYP.dureeSemaines} semaines, une plateforme de gestion intégrée composée de deux applications métier, EGUITRA Finance pour le groupe et AxisPro Suite pour le cabinet, bâties sur un noyau comptable open source éprouvé, Odoo Community, que les utilisateurs ne voient jamais. Le groupe bénéficie ainsi de la robustesse d'un moteur utilisé par des dizaines de milliers d'entreprises, sans licence ni redevance, et d'interfaces conçues pour ses métiers, son vocabulaire et sa charte.`);
table(
  ['Engagement', 'Contenu'],
  [
    ['Périmètre', 'Comptabilité SYSCOHADA révisé, analytique, trésorerie et rapprochement bancaire, immobilisations, budget, fiscalité guinéenne, consolidation groupe, transport pétrolier avec application mobile, chantiers, immobilier, évaluation et suivi des porteurs de projets, portail des porteurs'],
    ['Attentes du département Finance', 'Les vingt attentes du courrier du responsable financier sont couvertes, chapitre 4'],
    ['Délai', `${HYP.dureeSemaines} semaines à compter du démarrage, sous pénalités de retard`],
    ['Investissement', `${gnfHT(OFFRE.total)}, hébergement de la première année compris`],
    ['À partir de la deuxième année', `${gnfHT(OFFRE.maintenanceAn)} par an, hébergement, exploitation, support et maintenance`],
    ['Licences', 'Aucune, ni à l\'achat ni par utilisateur'],
    ['Garantie corrective', `${HYP.garantieMois} mois à compter de la réception, couvrant la première clôture annuelle`],
    ['Protection des données', `Perte de données maximale de ${SAUVEGARDE.rpoMinutes} minutes, reprise sous ${SAUVEGARDE.rtoHeuresOuvrees} heures ouvrées, disponibilité ${SAUVEGARDE.disponibilite}`],
    ['Propriété', 'Données et code développé pour vous, réversibilité complète sur demande'],
  ],
  [2600, 7038],
);
callout(`Un seul système, deux applications, aucune licence : le groupe et le cabinet disposent d'un outil de gestion complet pour ${gnfHT(OFFRE.total)}, puis ${gnfHT(OFFRE.maintenanceAn)} par an, avec des engagements écrits sur le délai, la garantie, la sauvegarde et le support.`);
p(`Cette offre est valable ${HYP.validiteJours} jours, jusqu'au ${dateFin}. Tous les montants sont exprimés en francs guinéens, hors taxes.`);

pagebreak();

// ================================================================ 2. Contexte et enjeux
h1('2. Votre contexte et vos enjeux');
h2('2.1 Deux structures, une direction, trois métiers');
p(`${HYP.client} exploite une flotte de quinze ensembles citernes pour le compte de distributeurs pétroliers et de sociétés minières, réalise des chantiers de BTP et gère un patrimoine immobilier, auxquels s'ajoute une activité de négoce. Le transport d'hydrocarbures représente environ 70 % d'un chiffre d'affaires cumulé de 20,6 milliards GNF au 15 août 2026. ${HYP.client2} évalue la maturité et la bancabilité de projets, accompagne leurs promoteurs et prépare les dossiers présentés aux banques et aux investisseurs.`);
p('Le dossier de l\'exercice 2026 que vous nous avez transmis donne la mesure de l\'activité à reprendre dans l\'outil :');
table(
  ['Donnée', 'Volume au 15 août 2026'],
  [
    ['Activités et centres de coût', '7 activités, 9 centres de coût'],
    ['Comptes de trésorerie', '3 banques dont un compte en USD, 2 caisses'],
    ['Flotte', '15 ensembles citernes, 15 chauffeurs, 9 routes tarifées'],
    ['Rotations de transport', '383'],
    ['Factures de vente et pièces d\'achat', '147 et 169'],
    ['Opérations de trésorerie', '412'],
    ['Immobilisations et financements', '24 immobilisations, 4 emprunts et crédits-bails'],
  ],
  [4200, 5438],
);
h2('2.2 Ce que la direction attend');
p('Le courrier du responsable financier formule vingt attentes pour le département Finance. Elles se regroupent en quatre familles : voir, avec une visibilité globale et en temps réel sur le chiffre d\'affaires, le résultat et la trésorerie, consolidée au niveau du groupe et décomposable par activité ; tenir, avec une comptabilité générale et analytique conforme au SYSCOHADA révisé, une gestion budgétaire, fiscale, des immobilisations et de la facturation ; piloter les métiers, avec la rentabilité par trajet et par véhicule, le suivi des chantiers et la gestion locative ; sécuriser, avec des circuits d\'approbation, une piste d\'audit complète, des accès par profil, une disponibilité garantie et une tarification sans coûts cachés.');
p('Pour le cabinet, le besoin est d\'industrialiser une méthode d\'évaluation déjà formalisée : 111 critères sur 15 domaines, huit stage gates, des critères éliminatoires, une data room de 42 pièces, des revues de comité et des rapports de décision, aujourd\'hui portés par un prototype à utilisateur unique.');
h2('2.3 Ce que nous retenons de vos prototypes');
p('Les deux prototypes conçus par la direction sont une spécification fonctionnelle de grande qualité. Nous les adoptons comme cahier des charges et nous en conservons les principes fondateurs :');
ul([
  'Chaque donnée est saisie une seule fois ; tout le reste est calculé.',
  'Les contrôles sont bloquants : équilibre débit et crédit, équilibre actif et passif, compte de passage des virements internes soldé, clôture refusée tant qu\'une alerte bloquante est active.',
  'Le dirigeant dispose d\'indicateurs de décision : chiffre d\'affaires et résultat par activité, trésorerie fin de mois, ancienneté des créances, service de la dette et DSCR, marge par rotation, écarts budgétaires.',
  'L\'évaluation des projets suit une politique explicite et versionnée : pondérations, critères critiques et éliminatoires, gaps prioritaires, historique des revues, rappel de la politique dans chaque rapport.',
]);
p('Ce qui manque à ces prototypes pour devenir un outil d\'entreprise, et que la plateforme apporte : le travail simultané de plusieurs utilisateurs, des droits par profil, une piste d\'audit, des sauvegardes et une disponibilité garanties, et la capacité d\'évoluer sans redéveloppement.');

pagebreak();

// ================================================================ 3. La plateforme
h1('3. La plateforme EGUITRA Finance et AxisPro Suite');
h2('3.1 Principes de conception');
p('La plateforme sépare strictement ce que les utilisateurs voient de ce qui tient les comptes.');
p(`Les applications métier, EGUITRA Finance et AxisPro Suite, sont développées sur mesure par ${HYP.prestataire}. Elles constituent la seule interface de vos équipes : navigation par métier, écrans de saisie guidée, tableaux de bord, exports, dans la charte graphique du groupe et du cabinet et avec votre vocabulaire. Une application mobile de saisie des rotations et un portail pour les porteurs de projets les complètent.`);
p(`Le noyau de gestion est Odoo Community, complété par les modules de l'Odoo Community Association (OCA) et par nos modules spécifiques. Il assure la tenue des écritures, la cohérence comptable, le multi-sociétés, le multi-devises, les circuits d'approbation, les droits d'accès et la traçabilité. Publié sous licence libre, il n'entraîne aucune redevance, aucune limite de nombre d'utilisateurs et aucune dépendance à un éditeur. Son interface d'administration n'est jamais exposée aux utilisateurs ; elle reste accessible à la seule équipe technique de ${HYP.prestataire}, sur un accès réseau restreint. Nous avons déployé cette architecture pour SOGUIPREM.`);
callout('Pour vos équipes, il n\'existe qu\'EGUITRA Finance et AxisPro Suite. Le noyau est un composant technique, au même titre que la base de données.');
h2('3.2 Architecture technique');
table(
  ['Couche', 'Composants', 'Rôle'],
  [
    ['Interface utilisateur', 'Applications web EGUITRA Finance et AxisPro Suite, application mobile de saisie des rotations, portail des porteurs de projets', 'Seule surface visible. Charte graphique, navigation métier, tableaux de bord, saisie guidée, exports.'],
    ['API métier', 'Modules spécifiques exposant une API sécurisée, authentification par jeton, double authentification', 'Traduit les actions métier en opérations du noyau, applique les règles de gestion, journalise.'],
    ['Noyau de gestion', 'Odoo Community, modules OCA, modules spécifiques du groupe', 'Comptabilité, analytique, trésorerie, immobilisations, budget, workflows, droits, audit.'],
    ['Données et documents', 'PostgreSQL, stockage de fichiers', 'Persistance, pièces justificatives, data room.'],
    ['Exploitation', 'VPS dédié, conteneurs, proxy TLS, supervision, sauvegardes chiffrées hors site', 'Disponibilité, sécurité, restauration.'],
  ],
  [2000, 3900, 3738],
);

h2('3.3 EGUITRA Finance : le cycle comptable');
p('EGUITRA Finance reprend le moteur comptable du prototype de la direction et le porte sur le noyau. Le cycle est le suivant :');
ul([
  'Saisie à la source : facture de vente, pièce d\'achat, opération de trésorerie, rotation de transport, situation de chantier ou quittance de loyer. Les comptes de contrepartie, la TVA et l\'imputation analytique sont déduits automatiquement.',
  'Approbation : les engagements et les paiements passent par une corbeille de validation à plusieurs niveaux, avec des seuils par montant et par nature.',
  'Contrôles permanents : équilibres, compte de passage, cohérence des références, empreinte de chaînage des écritures.',
  'Clôture mensuelle : contrôles bloquants, registre des clôtures, réouverture contrôlée, verrouillage des écritures.',
  'États : balance, grand livre par compte et par tiers, bilan, compte de résultat et tableau des flux au format SYSCOHADA, rapport mensuel de gestion, exports CSV et XLSX de tous les journaux et états.',
]);
h2('3.4 EGUITRA Finance : les écrans par profil');
table(
  ['Profil', 'Écrans'],
  [
    ['Direction générale', 'Tableau de bord du dirigeant : CA facturé, résultat, trésorerie fin de mois, encours clients, service de la dette et DSCR, alertes actives. Pilotage par activité et par centre de coût, comparaison au budget. Consolidation groupe.'],
    ['Finance et comptabilité', 'Ventes, achats et dépenses, trésorerie et rapprochement bancaire, tiers et limites de crédit, immobilisations et amortissements, journaux et OD guidées, balance et grand livre, budget face au réalisé, dette et financement, clôtures, contrôles d\'intégrité, états financiers, déclarations fiscales, passerelle IFRS, exports d\'audit.'],
    ['Exploitation transport', 'Flotte, chauffeurs, routes et tarifs, rotations, rentabilité par ensemble routier et par route, application mobile de saisie au parc.'],
    ['Chantiers', 'Chantiers, situations d\'avancement, facturation à l\'avancement, retenues de garantie.'],
    ['Immobilier', 'Biens, baux, loyers et quittancement, valorisation du patrimoine.'],
    ['Administration', 'Référentiels, seuils d\'alerte, taux de change, profils et droits, journal d\'audit.'],
  ],
  [2400, 7238],
);
h2('3.5 Transport pétrolier : la rotation, source unique');
p('Une rotation est saisie une seule fois, au bureau ou depuis l\'application mobile au parc, y compris sans réseau : la saisie est mise en file et synchronisée dès que la connexion revient. Elle porte le camion, le chauffeur, le client, le produit, le volume, la route, le tarif, le carburant, les péages, les frais de chauffeur, la maintenance et les taxes spécifiques. La plateforme en déduit la ligne de facturation, les coûts analytiques par véhicule et par route, et la marge. Le seuil de marge transport du dossier devient une alerte automatique sur le tableau de bord du dirigeant.');
h2('3.6 Chantiers, immobilier, fiscalité et consolidation');
ul([
  'Chantiers : chaque chantier est un axe analytique. Les situations d\'avancement génèrent la facturation, les retenues de garantie sont suivies jusqu\'à leur libération.',
  'Immobilier : biens, baux et loyers sont gérés par contrats récurrents ; le quittancement et les relances sont automatiques, le patrimoine est valorisé.',
  'Fiscalité guinéenne : TVA collectée et récupérable, retenues, déclarations locales préparées à partir des écritures, modèles validés avec votre expert-comptable.',
  'Consolidation : le multi-sociétés du noyau permet une vue groupe décomposable par entité, activité, chantier et ligne logistique, avec une passerelle vers un reporting IFRS.',
]);
h2('3.7 AxisPro Suite : de la grille d\'évaluation au comité');
p('AxisPro Suite industrialise la méthode du cabinet dans un outil multi-utilisateurs. La grille d\'évaluation est importée comme donnée et reste modifiable par le cabinet sans intervention technique. Le parcours d\'un dossier est le suivant :');
ul([
  'Ouverture du dossier : identification du projet, du promoteur, de la localisation, de la capacité et du calendrier ; hypothèses de décision.',
  'Saisie guidée par stage gate : critères du gate courant, statut, preuve jointe, commentaire.',
  'Score et knock-outs : score par domaine, critères éliminatoires actifs, recommandation GO, NO-GO ou conditionnelle.',
  'Gaps prioritaires : classement selon le poids, la criticité et les knock-outs ; les cinq actions à mener par le promoteur.',
  'Data room : index des pièces standard, disponibilité, versions, accès du promoteur.',
  'Revue de comité : enregistrement, historique, comparaison entre deux revues, verrouillage de la décision.',
  'Rapports : rapport de décision pour le comité, liste des pièces à fournir pour le promoteur, export XLSX. La politique d\'évaluation, versionnée, est rappelée dans chaque rapport.',
]);
p('Le portail des porteurs de projets leur permet de déposer leurs pièces, de suivre l\'avancement de leur dossier et d\'échanger avec le cabinet. Le cabinet dispose en outre, dans la même plateforme, de la facturation de ses prestations et du suivi de ses temps par dossier.');
h2('3.8 Composants du noyau retenus');
table(
  ['Fonction', 'Module communautaire'],
  [
    ['Rapprochement bancaire et import des relevés', 'account_reconcile_oca, account_statement_import_file'],
    ['Immobilisations et amortissements', 'account_asset_management'],
    ['Budgets et états de gestion', 'mis_builder, mis_builder_budget'],
    ['États financiers et grand livre', 'account_financial_report'],
    ['Circuits d\'approbation à plusieurs niveaux', 'base_tier_validation, purchase_tier_validation, account_move_tier_validation'],
    ['Piste d\'audit', 'auditlog'],
    ['Contrats récurrents et loyers', 'contract'],
    ['Taux de change', 'currency_rate_update'],
    ['Gestion documentaire', 'dms'],
  ],
  [3600, 6038],
);
p('La liste définitive est arrêtée en semaine 1, module par module. Tout besoin non couvert par un module communautaire est réalisé en spécifique, sans surcoût par rapport à la présente offre.');

pagebreak();

// ================================================================ 4. Attentes
h1('4. Réponse aux vingt attentes du département Finance');
table(
  ['Attente exprimée', 'Réponse de la plateforme'],
  [
    ['Visibilité globale et temps réel sur CA, résultat, trésorerie, indicateurs', 'Tableau de bord du dirigeant, pilotage par activité, indicateurs calculés à chaque saisie'],
    ['Vue consolidée du groupe, décomposable par activité, filiale, projet, ligne logistique', 'Multi-sociétés natif, axes analytiques multiples, consolidation groupe'],
    ['Comptabilité générale SYSCOHADA révisé', 'Plan de comptes SYSCOHADA du noyau, validé avec votre expert-comptable'],
    ['Comptabilité analytique par centre de coût, projet, chantier, activité', 'Plans analytiques multi-axes, imputation automatique à la saisie'],
    ['Trésorerie et rapprochement bancaire', 'Position par compte et devise, import des relevés, rapprochement assisté'],
    ['Immobilisations et amortissements', 'Registre, dotations mensuelles automatiques, cessions'],
    ['Gestion budgétaire, écarts réalisé et prévisionnel', 'Lignes budgétaires mensuelles, écarts, seuils d\'alerte'],
    ['Facturation client et fournisseur', 'Factures, avoirs, échéances, relances automatiques'],
    ['Gestion fiscale, TVA, déclarations locales', 'TVA et retenues calculées, déclarations préparées à partir des écritures'],
    ['Workflow d\'approbation des engagements et paiements', 'Corbeille de validation à plusieurs niveaux et seuils'],
    ['Coûts et rentabilité par trajet et véhicule, volumes, taxes spécifiques', 'Rotation comme source unique, marge par rotation, par véhicule et par route'],
    ['Chantiers, facturation à l\'avancement, retenues de garantie', 'Situations d\'avancement, facturation générée, retenues suivies'],
    ['Gestion locative et valorisation du patrimoine', 'Biens, baux, quittancement automatique, patrimoine'],
    ['Traçabilité complète, piste d\'audit', 'Journal d\'audit avec valeurs avant et après, empreinte de chaînage des écritures'],
    ['Sécurisation des données et des accès par profil', 'Double authentification, droits par profil, chiffrement'],
    ['Disponibilité garantie et sauvegardes', `Disponibilité ${SAUVEGARDE.disponibilite}, perte de données maximale ${SAUVEGARDE.rpoMinutes} minutes, tests de restauration trimestriels`],
    ['Interface simple et formation', 'Applications à votre image, saisie guidée, formation par profil, guides en français'],
    ['Support réactif et accompagnement', `Délais d'intervention engagés, ${HYP.accompagnementSemaines} semaines d'accompagnement renforcé`],
    ['Solution évolutive', 'Ajout de modules du noyau sans développement, évolutions incluses dans le forfait annuel'],
    ['Tarification claire, sans coûts cachés', 'Forfait ferme, aucune licence, forfait annuel unique'],
  ],
  [4600, 5038],
);

pagebreak();

// ================================================================ 5. Sécurité et continuité
h1('5. Hébergement, sécurité et continuité d\'activité');
h2('5.1 Hébergement');
ul([
  `Serveur virtuel privé dédié au groupe : ${HYP.vps}.`,
  'Déploiement en conteneurs, proxy avec certificats TLS renouvelés automatiquement, base de données dédiée.',
  'Deux environnements, recette et production : toute évolution est validée en recette avant d\'être mise en production.',
  'Noms de domaine du groupe et du cabinet, par exemple finance.eguitragroup.com et axispro.mbaxisproconsulting.com.',
]);
h2('5.2 Sauvegardes et reprise après sinistre');
p(`La base de données est unique pour l'ensemble des modules : les engagements ci-dessous s'appliquent à la comptabilité, aux modules métier et à AxisPro Suite sans distinction. Ils sont compris dans le montant de l'offre la première année, puis dans le forfait annuel.`);
table(
  ['Mesure', 'Engagement'],
  [
    ['Journalisation continue', `Le journal des transactions de la base est copié hors site, chiffré, toutes les ${SAUVEGARDE.rpoMinutes} minutes. Il permet de restaurer la base à n'importe quel instant des ${SAUVEGARDE.retentionJournaux} précédents.`],
    ['Sauvegarde complète', 'Quotidienne, chiffrée, copiée hors site chez un second fournisseur'],
    ['Pièces jointes et documents', 'Synchronisés hors site toutes les heures'],
    ['Rétention', `${SAUVEGARDE.retentionQuotidienne} sauvegardes quotidiennes, ${SAUVEGARDE.retentionMensuelle} sauvegardes mensuelles, journaux de transactions sur ${SAUVEGARDE.retentionJournaux}`],
    ['Perte de données maximale', `${SAUVEGARDE.rpoMinutes} minutes`],
    ['Délai de reprise', `${SAUVEGARDE.rtoHeuresOuvrees} heures ouvrées après déclaration de sinistre`],
    ['Test de restauration', 'Chaque trimestre, dont une restauration à un instant donné, avec compte rendu remis au client'],
    ['Disponibilité', `${SAUVEGARDE.disponibilite} par mois, hors fenêtre de maintenance annoncée 48 heures à l'avance`],
  ],
  [3000, 6638],
);
h2('5.3 Contrôle des accès et piste d\'audit');
ul([
  'Mot de passe robuste et double authentification pour tous les utilisateurs.',
  'Profils : direction, finance, exploitation transport, chantiers, immobilier, cabinet, porteur de projet. Chaque profil ne voit que son périmètre.',
  'Piste d\'audit : chaque création, modification et suppression est journalisée avec l\'utilisateur, la date et les valeurs avant et après.',
  'Écritures verrouillées après clôture, avec empreinte de chaînage.',
  'Chiffrement des échanges et des sauvegardes, journaux d\'accès conservés 12 mois.',
  'Mises à jour de sécurité appliquées chaque mois en recette puis en production.',
]);
h2('5.4 Propriété et réversibilité');
p('Le client est propriétaire de ses données et du code développé pour lui. À tout moment, sur simple demande et sans frais, nous remettons une copie complète de la base, des pièces jointes et du code, dans des formats ouverts, avec la documentation d\'installation. Les composants génériques d\'E-VOLUTION XP restent réutilisables par E-VOLUTION XP.');

pagebreak();

// ================================================================ 6. Mise en œuvre
h1('6. Mise en œuvre en quatre semaines');
h2('6.1 Démarrage et date contractuelle');
p(`Le démarrage, noté T0, est la date à laquelle l'acompte de commande est encaissé et les prérequis du chapitre 6.5 sont remis. La date contractuelle de mise en production est T0 plus ${HYP.dureeSemaines} semaines. Ce délai est tenu par une équipe dédiée à temps plein et repose sur trois conditions : vos prototypes servent de spécification, les composants d'interface déjà développés par ${HYP.prestataire} sont réutilisés, et vos référents sont disponibles chaque semaine.`);
h2('6.2 Planning');
table(['Semaine', 'Objet', 'Travaux', 'Jalon'], PLANNING, [1200, 1800, 4438, 2200]);
h2('6.3 Reprise de l\'exercice 2026');
p('Le dossier 2026 est repris intégralement : référentiels, tiers, plan de comptes, immobilisations, financements, budget, ventes, achats, trésorerie, rotations et OD. Les balances obtenues sont confrontées au classeur d\'origine et validées par votre responsable financier avant la mise en production. L\'exercice 2026 est consultable dans l\'outil dès le premier jour ; l\'exercice 2027 s\'y ouvre directement.');
h2('6.4 Recette, formation et accompagnement');
ul([
  'Cahier de recette rédigé avec vos équipes en semaine 3, recette en semaine 4 sur vos données.',
  'Formation par profil : direction, finance, exploitation, chantiers, immobilier, cabinet. Supports et guides utilisateur remis en français.',
  `${HYP.accompagnementSemaines} semaines d'accompagnement renforcé, sur site et à distance, après la mise en production.`,
  'Gouvernance : comité de pilotage hebdomadaire avec la direction générale et le responsable financier, point quotidien de quinze minutes avec le référent du client, espace partagé de suivi des demandes. Le compte rendu du comité constate l\'avancement, les décisions et les événements qui décalent la date contractuelle.',
]);
h2('6.5 Prérequis côté client');
ul([
  'Un référent par domaine, disponible une demi-journée par jour pendant les quatre semaines.',
  'La charte graphique du groupe et du cabinet, ou un atelier de définition en semaine 1.',
  'Les relevés bancaires et les modèles de déclarations fiscales en vigueur.',
  'La validation du plan de comptes par votre expert-comptable en semaine 2.',
]);
h2('6.6 Engagement de délai et pénalités de retard');
ul([
  `Si le procès-verbal de mise en production est signé après la date contractuelle et que le retard est imputable à ${HYP.prestataire}, une pénalité de ${fmtPct(PENALITE.tauxJourPct)} du montant HT de la commande est due par jour calendaire de retard, soit ${gnf(OFFRE.total * PENALITE.tauxJourPct / 100)} par jour.`,
  `Les pénalités sont plafonnées à ${fmtPct(PENALITE.plafondPct)} du montant HT de la commande, soit ${gnf(OFFRE.total * PENALITE.plafondPct / 100)}.`,
  'Ne sont pas imputables au prestataire et décalent la date contractuelle d\'autant : l\'indisponibilité des référents, la remise tardive des prérequis, les validations du client au-delà de deux jours ouvrés, les demandes hors périmètre et les cas de force majeure, constatés au comité de pilotage.',
  'Les pénalités sont déduites du dernier terme de paiement et constituent la seule indemnité due au titre du retard.',
]);

pagebreak();

// ================================================================ 7. Après la mise en production
h1('7. Garantie, support et maintenance');
h2('7.1 Garantie corrective');
p(`La plateforme est garantie ${HYP.garantieMois} mois à compter de la réception, constatée par le procès-verbal de mise en production. Pendant cette période, toute anomalie par rapport au périmètre recetté est corrigée sans frais, dans les délais d'intervention du chapitre 7.2, y compris les anomalies révélées lors de la clôture de l'exercice, de l'établissement des états financiers annuels et des déclarations fiscales de fin d'exercice. La garantie ne couvre pas les évolutions de périmètre, qui relèvent du chapitre 7.4, ni les erreurs de saisie, qui relèvent du support.`);
h2('7.2 Support et délais d\'intervention');
p('Le support est assuré du lundi au vendredi, de 8 h à 18 h, par messagerie, e-mail et téléphone, dès la mise en production. Les délais suivants sont engagés :');
table(
  ['Gravité', 'Définition', 'Prise en charge', 'Résolution ou contournement'],
  [
    ['Bloquante', 'Application inaccessible ou saisie impossible pour tous', '2 heures ouvrées', '8 heures ouvrées'],
    ['Majeure', 'Fonction essentielle indisponible pour un profil', '4 heures ouvrées', '2 jours ouvrés'],
    ['Mineure', 'Gêne sans blocage', '1 jour ouvré', 'Prochaine livraison planifiée'],
  ],
  [1600, 3838, 2000, 2200],
);
h2('7.3 Forfait annuel à partir de la deuxième année');
p(`La première année d'hébergement, d'exploitation et de support est comprise dans l'investissement. À partir du treizième mois, un forfait annuel unique de ${gnfHT(OFFRE.maintenanceAn)} couvre :`);
table(
  ['Prestation', 'Détail'],
  [
    ['Hébergement', HYP.vps],
    ['Exploitation', `Supervision, sauvegardes quotidiennes et journalisation continue toutes les ${SAUVEGARDE.rpoMinutes} minutes, tests de restauration, mises à jour de sécurité, renouvellement des certificats`],
    ['Support', 'Assistance des utilisateurs du lundi au vendredi, de 8 h à 18 h, selon les délais du chapitre 7.2'],
    ['Maintenance corrective', 'Correction de toute anomalie, sans limite'],
    ['Maintenance évolutive', `${EVOLUTIONS.joursParMois} jours par mois d'évolutions incluses, cumulables sur le trimestre, selon les règles du chapitre 7.4`],
  ],
  [2600, 7038],
);
h2('7.4 Évolutions incluses et évolutions facturables');
p('Une évolution est une demande de modification ou d\'ajout qui ne corrige pas une anomalie. Elle est incluse dans le forfait annuel lorsqu\'elle remplit les trois conditions suivantes :');
ul([
  `sa charge totale, spécification, réalisation, test et livraison comprises, est estimée à ${EVOLUTIONS.seuilJoursIncluse} jours-homme au plus ;`,
  'elle s\'appuie sur les écrans, les données et les états existants, sans ajouter de module ni d\'écran complet, sans interface avec un système externe et sans modification du modèle de données nécessitant une reprise ;',
  `elle s'inscrit dans le crédit du trimestre en cours, ${EVOLUTIONS.joursParTrimestre} jours, cumulables à l'intérieur du trimestre et non reportables au-delà.`,
]);
table(
  ['Incluses, par exemple', 'Facturables, par exemple'],
  [
    ['Ajout d\'un champ, d\'une colonne, d\'un filtre ou d\'un tri sur un écran existant', 'Nouveau module ou nouvel écran complet, par exemple la paie ou les stocks'],
    ['Nouvel état ou nouvel export construit à partir des données existantes', 'Interface avec un système externe : banque, opérateur de paiement mobile, logiciel tiers'],
    ['Modification d\'une règle d\'alerte, d\'un seuil ou d\'un niveau d\'approbation', 'Ajout d\'une société au périmètre avec reprise de son historique'],
    ['Création d\'un profil, d\'une activité, d\'un centre de coût, d\'une route tarifée', 'Refonte d\'un parcours de saisie ou d\'un tableau de bord complet'],
    ['Adaptation d\'une maquette d\'impression ou d\'un modèle de document', 'Changement réglementaire majeur, tel qu\'une nouvelle version du référentiel SYSCOHADA'],
    ['Ajustement de la grille ou des pondérations AxisPro au-delà du paramétrage accessible au cabinet', 'Montée de version majeure du noyau, formation complémentaire'],
  ],
  [4819, 4819],
);
ul([
  'Le client dépose sa demande dans l\'espace partagé de suivi.',
  `${HYP.prestataire} la qualifie par écrit sous ${EVOLUTIONS.delaiQualificationJoursOuvres} jours ouvrés : incluse ou facturable, charge estimée, date de livraison proposée.`,
  'Une évolution incluse est imputée sur le crédit du trimestre, livrée en recette puis en production. Un décompte du crédit consommé et restant est communiqué chaque trimestre.',
  `Une évolution facturable fait l'objet d'un devis au tarif de ${gnfHT(EVOLUTIONS.tarifJourHT)} par jour-homme, ferme pendant les deux premières années, et n'est engagée qu'après accord écrit du client.`,
  'En cas de désaccord sur la qualification, le comité de suivi arbitre ; à défaut d\'accord, une demande dont la charge ne dépasse pas le seuil est traitée comme incluse.',
]);

pagebreak();

// ================================================================ 8. Conditions financières
h1('8. Conditions financières');
h2('8.1 Investissement');
p('Prix forfaitaire et ferme pour le périmètre décrit aux chapitres 3 et 4. Toute évolution de périmètre fait l\'objet d\'un avenant chiffré. Aucun coût de licence.');
table(
  ['Poste', 'Montant HT', 'Part'],
  [...OFFRE.postes.map(([l, m]) => [l, gnf(m), pct(m, OFFRE.total)]), ['Total, hébergement de la première année compris', gnfHT(OFFRE.total), `100${NBSP}%`]],
  [6238, 2200, 1200],
  { lastBold: true },
);
h2('8.2 Coût total de possession sur trois ans');
table(
  ['', 'Montant HT'],
  [
    ['Réalisation, mise en production et première année d\'exploitation', gnfHT(OFFRE.total)],
    ['Deuxième année : hébergement, exploitation, support, maintenance', gnfHT(OFFRE.maintenanceAn)],
    ['Troisième année : hébergement, exploitation, support, maintenance', gnfHT(OFFRE.maintenanceAn)],
    ['Total sur trois ans', gnfHT(OFFRE.total + 2 * OFFRE.maintenanceAn)],
  ],
  [6838, 2800],
  { lastBold: true },
);
h2('8.3 Conditions de paiement');
ul([
  '50 % à la commande, 30 % à la recette en semaine 4, 20 % au procès-verbal de mise en production, déduction faite des pénalités éventuelles.',
  'Forfait annuel : par semestre d\'avance, à compter du treizième mois.',
  'Règlement à 30 jours date de facture, par virement bancaire.',
  'La TVA et les retenues applicables en Guinée sont ajoutées selon la réglementation en vigueur.',
]);
h2('8.4 Validité et engagements');
ul([
  `Validité de l'offre : ${HYP.validiteJours} jours à compter du ${HYP.dateOffre}, soit jusqu'au ${dateFin}. La présente offre annule et remplace notre offre du ${HYP.dateOffrePrecedente}.`,
  `Garantie corrective de ${HYP.garantieMois} mois à compter de la réception, chapitre 7.1.`,
  `Pénalités de retard : ${fmtPct(PENALITE.tauxJourPct)} du montant HT par jour calendaire de retard imputable à ${HYP.prestataire}, plafonnées à ${fmtPct(PENALITE.plafondPct)}, chapitre 6.6.`,
  `Perte de données maximale de ${SAUVEGARDE.rpoMinutes} minutes, reprise sous ${SAUVEGARDE.rtoHeuresOuvrees} heures ouvrées, disponibilité ${SAUVEGARDE.disponibilite}, chapitre 5.2.`,
  'Propriété du client sur ses données et sur le code développé pour lui, réversibilité complète sans frais, chapitre 5.4.',
  'Confidentialité des données financières et des dossiers des porteurs de projets, y compris après la fin du contrat.',
]);

pagebreak();

// ================================================================ 9. Acceptation et annexe
h1('9. Acceptation');
p(`Pour ${HYP.raisonSociale}`);
p(HYP.signataire);
p(HYP.qualiteSignataire);
p('Signature : ________________');
p('');
p(`Pour ${HYP.client} et ${HYP.client2}`);
p(`Bon pour accord sur l'offre ${HYP.reference} du ${HYP.dateOffre}, d'un montant de ${gnfHT(OFFRE.total)}`);
p('Date : ________________');
p('Signature et cachet : ________________');
p('Mention manuscrite obligatoire :');
p('« Lu et approuvé. Bon pour accord »');
h1('Annexe. Glossaire');
table(
  ['Terme', 'Définition'],
  [
    ['SYSCOHADA', 'Système comptable de l\'Organisation pour l\'harmonisation en Afrique du droit des affaires, version révisée.'],
    ['OCA', 'Odoo Community Association, association qui publie des modules libres pour le noyau de gestion.'],
    ['DSCR', 'Ratio de couverture du service de la dette.'],
    ['Stage gate', 'Étape de décision d\'un projet, avec ses règles de passage.'],
    ['Knock-out', 'Critère éliminatoire imposant un NO-GO quel que soit le score.'],
    ['Data room', 'Espace documentaire structuré d\'un dossier de projet.'],
    ['VPS', 'Serveur virtuel privé, dédié au client chez un hébergeur.'],
    ['TLS', 'Chiffrement des échanges entre le navigateur et le serveur.'],
    ['Journal des transactions', 'Enregistrement continu de chaque modification de la base de données, qui permet de la restaurer à un instant donné.'],
  ],
  [2600, 7038],
);

// ---------------------------------------------------------------- rendu MD
function toMarkdown() {
  const out = [];
  for (const b of B) {
    switch (b.t) {
      case 'cover':
        out.push(`![${HYP.prestataire}](${path.basename(logoPath || 'logo.png')})`, '',
          '# Offre technique et financière', '',
          '**Plateforme de gestion intégrée EGUITRA Finance et AxisPro Suite**', '',
          'Digitalisation du département Finance et de l\'accompagnement des porteurs de projets', '',
          `Pour ${HYP.client} et ${HYP.client2}, à l'attention de ${HYP.dg}`, '',
          `Référence ${HYP.reference}, ${HYP.dateOffre}, valable ${HYP.validiteJours} jours`, '',
          `Émise par ${HYP.prestataire}, ${HYP.slogan}. Contact : ${HYP.contact}`, '');
        break;
      case 'toc': out.push('_Sommaire : voir la version Word, table des matières automatique._', ''); break;
      case 'pagebreak': out.push('', '---', ''); break;
      case 'h1': out.push('', `## ${b.v}`, ''); break;
      case 'h2': out.push('', `### ${b.v}`, ''); break;
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
const NAVY = '1C1E6B';
const TEAL = '1A9E9E';
const GREY = 'F2F4F7';
const FONT = 'Calibri';
const CONTENT_W = 9638;

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
  const headRow = new TableRow({ tableHeader: true, children: head.map((h, i) => mk(h, i, { shade: NAVY, bold: true, color: 'FFFFFF' })) });
  const bodyRows = rows.map((r, ri) => {
    const bold = (opts.lastBold && ri === rows.length - 1) || (opts.boldRows || []).includes(ri);
    return new TableRow({ children: r.map((c, i) => mk(c, i, { bold, shade: bold ? 'E6F4F4' : (ri % 2 ? GREY : undefined) })) });
  });
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: w, rows: [headRow, ...bodyRows] });
}

function logoRun(widthPx) {
  if (!logoPath) return null;
  const data = fs.readFileSync(logoPath);
  const h = Math.round(widthPx * 820 / 1400);
  return new ImageRun({ type: 'png', data, transformation: { width: widthPx, height: h }, altText: { title: HYP.prestataire, description: `Logo ${HYP.prestataire}`, name: 'logo' } });
}

function coverPage() {
  const c = [];
  const logo = logoRun(300);
  if (logo) c.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 900 }, children: [logo] }));
  else c.push(para(HYP.prestataire, { size: 40, bold: true, color: NAVY, align: AlignmentType.CENTER, before: 600, after: 900 }));
  c.push(para('Offre technique et financière', { size: 52, bold: true, color: NAVY, after: 200 }));
  c.push(para('Plateforme de gestion intégrée EGUITRA Finance et AxisPro Suite', { size: 30, bold: true, color: TEAL, after: 120 }));
  c.push(para('Digitalisation du département Finance et de l\'accompagnement des porteurs de projets', { size: 26, color: '444444', after: 700 }));
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
      ],
    },
    numbering: { config: [{ reference: 'puces', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 280 } } } }] }] },
    features: { updateFields: true },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      headers: { default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C9CFD8', space: 4 } },
        children: [...(headerLogo ? [headerLogo, run('    ', { size: 16 })] : []), run(`Offre technique et financière, ${HYP.client} et ${HYP.client2}`, { size: 16, color: '888888' })],
      })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(`${HYP.prestataire}, ${HYP.slogan}. Réf. ${HYP.reference}, confidentiel. Page `, { size: 16, color: '888888' }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '888888' })] })] }) },
      children,
    }],
  });
}

// ---------------------------------------------------------------- sortie
(async () => {
  const base = 'Offre_technique_financiere_EGUITRA';
  fs.writeFileSync(path.join(__dirname, `${base}.md`), toMarkdown());
  fs.writeFileSync(path.join(__dirname, `${base}.docx`), await Packer.toBuffer(toDocx()));
  console.log(`OK : logo ${logoPath ? path.basename(logoPath) : 'absent'} ; total ${gnf(OFFRE.total)} ; validité jusqu'au ${dateFin}`);
})();
