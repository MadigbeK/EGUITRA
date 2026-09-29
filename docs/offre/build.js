// Génère docs/offre/Offre_technique_financiere_EGUITRA.docx et .md (révision 1)
// Usage : node docs/offre/build.js
const fs = require('fs');
const path = require('path');
const { HYP, SAUVEGARDE, PENALITE, EVOLUTIONS, P1, PLANNING } = require('./contenu');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  ShadingType, HeadingLevel, AlignmentType, BorderStyle, LevelFormat, PageBreak,
  TableOfContents, Header, Footer, PageNumber, VerticalAlign, ImageRun,
} = require('docx');

// ---------------------------------------------------------------- calculs
const NBSP = ' ';
const gnf = (n) => Math.round(n).toLocaleString('fr-FR').replace(/[   ]/g, NBSP) + NBSP + 'GNF';
const gnfHT = (n) => `${gnf(n)} HT`;
const fmtPct = (n) => `${String(n).replace('.', ',')}${NBSP}%`;
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const dateFin = (() => { const d = new Date(`${HYP.dateOffreISO}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + HYP.validiteJours); return `${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; })();

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
h1('1. Synthèse de l\'offre révisée');
p(`Par courrier reçu à la suite de notre offre ${HYP.referenceInitiale} du ${HYP.dateOffreInitiale}, ${HYP.client} et ${HYP.client2} ont retenu la proposition 1, plateforme intégrée sur noyau de gestion, et nous ont demandé de clarifier ou de réviser six points : la validité de l'offre, la durée de la garantie corrective, la fréquence des sauvegardes, une clause de pénalité de retard, la définition des évolutions incluses dans la maintenance, et le montant de l'investissement.`);
p(`La présente révision remplace l'offre du ${HYP.dateOffreInitiale}. Elle porte sur la seule proposition 1, pour un périmètre fonctionnel strictement inchangé, et répond à chacun des six points. Le chapitre 2 en donne la synthèse, les chapitres suivants le détail.`);
table(
  ['', 'Offre révisée'],
  [
    ['Solution', 'Une plateforme unique : un noyau de gestion open source éprouvé, invisible pour les utilisateurs, et deux applications à votre image, EGUITRA Finance et AxisPro Suite.'],
    ['Attentes du département Finance couvertes', 'Vingt sur vingt'],
    ['Délai de mise en production', `${HYP.dureeSemaines} semaines, avec pénalités de retard`],
    ['Investissement, hébergement de la première année compris', gnfHT(P1.total)],
    ['Hébergement, maintenance et support à partir de la deuxième année', `${gnfHT(P1.maintenanceAn)} par an`],
    ['Licences logicielles', 'Aucune'],
    ['Garantie corrective', `${HYP.garantieMois} mois, couvrant la première clôture annuelle`],
    ['Perte de données maximale', `${SAUVEGARDE.rpoMinutes} minutes`],
  ],
  [3600, 6038],
);
callout(`Le montant de ${gnfHT(P1.total)} résulte d'un effort commercial de ${gnf(P1.effortCommercial)} sur la valeur des prestations, que nous consentons pour accompagner le groupe dans un projet structurant et inscrire notre relation dans la durée. Le périmètre, le planning et les engagements de service ne sont pas réduits.`);
p(`Validité de l'offre : ${HYP.validiteJours} jours à compter du ${HYP.dateOffre}, soit jusqu'au ${dateFin}. Tous les montants sont exprimés en francs guinéens, hors taxes.`);

pagebreak();

// ================================================================ 2. Suite donnée aux observations
h1('2. Suite donnée à vos observations');
p('Le tableau reprend, dans l\'ordre de votre courrier, chaque point soulevé et la réponse apportée dans cette révision.');
table(
  ['Point', 'Votre demande', 'Notre réponse', 'Chapitre'],
  [
    ['1. Validité de l\'offre', 'Trois durées différentes dans le document ; confirmer la durée applicable.', `La durée applicable est de ${HYP.validiteJours} jours. Les mentions de 60 jours en page de garde et au chapitre 8.6 de l'offre initiale étaient une erreur matérielle. La présente révision indique ${HYP.validiteJours} jours à compter du ${HYP.dateOffre}, soit jusqu'au ${dateFin}, en page de garde, en synthèse et dans les engagements contractuels.`, '1, 8.6'],
    ['3. Garantie corrective', 'Six mois au minimum, couvrant la première clôture annuelle complète.', `Garantie portée de 3 à ${HYP.garantieMois} mois à compter du procès-verbal de mise en production, sans surcoût. Elle couvre expressément les anomalies révélées lors de la clôture de l'exercice et des déclarations de fin d'exercice. Pour une commande passée avant fin octobre 2026, elle court au moins jusqu'en mai 2027, donc au-delà de la clôture 2026 et du dépôt des états financiers annuels.`, '7.1, 8.6'],
    ['5. Sauvegardes', 'Une sauvegarde plus fréquente, au moins pour les modules comptables, et ses conditions.', `Journalisation continue des transactions de la base, copiée hors site toutes les ${SAUVEGARDE.rpoMinutes} minutes, en plus de la sauvegarde complète quotidienne. La perte de données maximale passe de 24 heures à ${SAUVEGARDE.rpoMinutes} minutes, pour tous les modules puisque la plateforme repose sur une base unique. Incluse sans surcoût, la première année comme dans le forfait annuel.`, '6.2'],
    ['6. Calendrier', 'Insertion d\'une clause de pénalité de retard imputable au prestataire.', `Clause insérée : ${fmtPct(PENALITE.tauxJourPct)} du montant HT de la commande par jour calendaire de retard imputable à ${HYP.prestataire}, plafonnée à ${fmtPct(PENALITE.plafondPct)}, avec une date contractuelle de mise en production fixée au démarrage et des règles de neutralisation des retards non imputables.`, '7.6, 8.6'],
    ['7. Maintenance évolutive', 'Critères permettant de qualifier une évolution comme incluse ou facturable.', `Définition précise d'une évolution incluse (charge au plus égale à ${EVOLUTIONS.seuilJoursIncluse} jours, sans nouveau module ni interface externe), liste d'exemples inclus et facturables, procédure de qualification écrite sous ${EVOLUTIONS.delaiQualificationJoursOuvres} jours ouvrés, décompte trimestriel et tarif journalier des évolutions facturables.`, '8.4'],
    ['8. Conditions financières', `Offre à 40 000 000 GNF HT pour un périmètre inchangé.`, `Le périmètre est maintenu dans son intégralité. La valeur des prestations, détaillée au chapitre 8.2, s'établit à ${gnfHT(P1.valeurPostes)}. Nous consentons un effort commercial de ${gnf(P1.effortCommercial)} qui ramène l'investissement à ${gnfHT(P1.total)}, hébergement de la première année compris. Ce montant constitue notre meilleure offre pour le périmètre complet ; en dessous, nous devrions réduire le périmètre ou le niveau d'engagement, ce que nous ne recommandons pas pour un outil comptable de groupe.`, '8.2'],
  ],
  [1700, 2500, 4238, 1200],
);
p(`La proposition 2, deux applications indépendantes, n'est pas reprise dans cette révision, votre analyse portant sur la proposition 1. Elle reste disponible sur demande.`);

pagebreak();

// ================================================================ 3. Compréhension
h1('3. Notre compréhension de votre besoin');
h2('3.1 Le groupe et ses activités');
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
h2('3.2 Les deux projets');
p('Projet 1 : la digitalisation du département Finance. Le courrier du responsable financier liste vingt attentes, de la comptabilité SYSCOHADA révisée à la rentabilité par trajet, en passant par la consolidation groupe, les workflows d\'approbation, la piste d\'audit et la disponibilité garantie. Le tableau du chapitre 5 répond point par point.');
p('Projet 2 : la digitalisation de l\'accompagnement des porteurs de projets. Le prototype MB AxisPro décrit une méthode d\'évaluation de la maturité et de la bancabilité : 111 critères répartis sur 15 domaines, huit stage gates, des critères éliminatoires, une data room de 42 pièces, des revues de comité et des rapports de décision.');
h2('3.3 Ce que nous retenons des prototypes existants');
p('Les deux prototypes générés par la direction constituent une spécification fonctionnelle de grande qualité. Nous les reprenons comme cahier des charges de référence, et notamment :');
ul([
  'Le principe de saisie unique : chaque donnée n\'est saisie qu\'une fois, tout le reste est calculé.',
  'Les règles de contrôle : équilibre débit et crédit, équilibre actif et passif, compte de passage des virements internes soldé, clôture refusée tant qu\'une alerte bloquante est active.',
  'Les indicateurs du dirigeant : chiffre d\'affaires et résultat par activité, trésorerie fin de mois, ancienneté des créances, service de la dette et DSCR, marge par rotation, écarts budgétaires.',
  'La méthode d\'évaluation AxisPro : pondération, critères critiques et éliminatoires, gaps prioritaires, historique des revues, politique d\'évaluation tracée dans chaque export.',
]);
p('Ces prototypes sont conçus pour un utilisateur unique, sans authentification, avec un fichier local comme seule sauvegarde. La plateforme conserve leurs règles et leur ergonomie, et y ajoute ce qui manque à un outil d\'entreprise : multi-utilisateurs, droits par profil, piste d\'audit, sauvegardes, disponibilité et évolutivité.');

pagebreak();

// ================================================================ 4. La solution
h1('4. La solution : plateforme intégrée sur noyau de gestion');
h2('4.1 Principe : un noyau invisible, des applications à votre image');
p('La plateforme repose sur deux couches strictement séparées.');
p('Le noyau de gestion est Odoo Community, complété par les modules de l\'Odoo Community Association (OCA) et par nos modules spécifiques. Il assure la tenue des écritures, la cohérence comptable, le multi-sociétés, le multi-devises, les droits d\'accès et la traçabilité. Il est publié sous licence libre : aucune redevance, aucune limite de nombre d\'utilisateurs, aucun éditeur à contacter pour une évolution.');
p(`Les applications métier sont développées sur mesure et constituent la seule interface utilisée par vos équipes : EGUITRA Finance pour le groupe, AxisPro Suite pour le cabinet. Elles reprennent votre identité visuelle, votre vocabulaire et vos parcours de saisie. Le client web du noyau n'est jamais exposé aux utilisateurs ; il reste accessible à la seule équipe technique de ${HYP.prestataire}, sur un accès réseau restreint. Cette approche est celle que nous avons mise en œuvre pour SOGUIPREM.`);
callout('Pour vos utilisateurs, il n\'existe qu\'EGUITRA Finance et AxisPro Suite. Le noyau reste un composant technique, au même titre que la base de données.');

h2('4.2 Architecture');
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

h2('4.3 EGUITRA Finance : les écrans');
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

h2('4.4 Transport pétrolier : la rotation comme source unique');
p('Une rotation est saisie une seule fois, depuis le bureau ou depuis l\'application mobile au parc, y compris sans connexion : la saisie est mise en file et synchronisée dès que le réseau revient. Chaque rotation porte le camion, le chauffeur, le client, le produit, le volume, la route, le tarif, le carburant, les péages, les frais de chauffeur, la maintenance et les taxes spécifiques. Le noyau en déduit la ligne de facturation, les coûts analytiques par véhicule et par route, et la marge. Le seuil de marge transport du dossier devient une alerte automatique.');

h2('4.5 AxisPro Suite');
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

h2('4.6 Modules communautaires retenus');
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

// ================================================================ 5. Couverture
h1('5. Couverture des attentes du département Finance');
p('Les vingt attentes du courrier du responsable financier sont couvertes. Le tableau précise, pour chacune, le mécanisme retenu.');
table(
  ['Attente exprimée', 'Réponse de la plateforme'],
  [
    ['Visibilité globale et temps réel sur CA, résultat, trésorerie, indicateurs', 'Couverte : tableau de bord du dirigeant et pilotage par activité'],
    ['Vue consolidée du groupe, décomposable par activité, filiale, projet, ligne logistique', 'Couverte : multi-sociétés natif, consolidation groupe'],
    ['Comptabilité générale SYSCOHADA révisé', 'Couverte : plan de comptes du noyau, validé par votre expert-comptable'],
    ['Comptabilité analytique par centre de coût, projet, chantier, activité', 'Couverte : plans analytiques multi-axes'],
    ['Trésorerie et rapprochement bancaire', 'Couverte : import des relevés, rapprochement assisté'],
    ['Immobilisations et amortissements', 'Couverte : registre, dotations mensuelles, cessions'],
    ['Gestion budgétaire, écarts réalisé et prévisionnel', 'Couverte : lignes mensuelles, écarts, seuils'],
    ['Facturation client et fournisseur', 'Couverte : factures, avoirs, échéances, relances'],
    ['Gestion fiscale, TVA, déclarations locales', 'Couverte : TVA et déclarations guinéennes'],
    ['Workflow d\'approbation des engagements et paiements', 'Couverte : plusieurs niveaux et seuils'],
    ['Coûts et rentabilité par trajet et véhicule, volumes, taxes spécifiques', 'Couverte : rotation comme source unique'],
    ['Chantiers, facturation à l\'avancement, retenues de garantie', 'Couverte : situations d\'avancement, retenues'],
    ['Gestion locative et valorisation du patrimoine', 'Couverte : biens, baux, quittancement, patrimoine'],
    ['Traçabilité complète, piste d\'audit', 'Couverte : verrouillage par empreinte et journal d\'audit'],
    ['Sécurisation des données et des accès par profil', 'Couverte : double authentification, droits par profil'],
    ['Disponibilité garantie et sauvegardes', `Couverte : ${SAUVEGARDE.disponibilite}, perte de données maximale ${SAUVEGARDE.rpoMinutes} minutes`],
    ['Interface simple et formation', 'Couverte : applications à votre image, formation par profil'],
    ['Support réactif et accompagnement', 'Couverte : délais d\'intervention engagés, accompagnement renforcé'],
    ['Solution évolutive', 'Couverte : ajout de modules sans développement'],
    ['Tarification claire, sans coûts cachés', 'Couverte : forfait ferme, aucune licence, forfait annuel unique'],
  ],
  [4800, 4838],
);

pagebreak();

// ================================================================ 6. Hébergement
h1('6. Hébergement, sécurité et exploitation');
h2('6.1 Infrastructure');
ul([
  `Hébergement sur serveur virtuel privé dédié au groupe : ${HYP.vps}.`,
  'Déploiement en conteneurs, proxy avec certificats TLS renouvelés automatiquement, base de données dédiée.',
  'Deux environnements : production et recette. Chaque évolution passe en recette avant la production.',
  'Nom de domaine du groupe pour chaque application, par exemple finance.eguitragroup.com et axispro.mbaxisproconsulting.com.',
]);
h2('6.2 Sauvegardes et continuité');
p(`En réponse à votre point 5, le dispositif de sauvegarde est renforcé. La base de données est unique pour l'ensemble des modules : le renforcement s'applique donc à la comptabilité comme aux modules métier et à AxisPro Suite, sans distinction. Il est inclus sans surcoût, la première année comme dans le forfait annuel.`);
table(
  ['Mesure', 'Engagement'],
  [
    ['Journalisation continue des transactions', `Le journal des transactions de la base est copié hors site, chiffré, toutes les ${SAUVEGARDE.rpoMinutes} minutes. Il permet de restaurer la base à un instant donné quelconque des ${SAUVEGARDE.retentionJournaux} précédents.`],
    ['Sauvegarde complète', 'Quotidienne, chiffrée, copiée hors site chez un second fournisseur'],
    ['Pièces jointes et documents', 'Synchronisés hors site toutes les heures'],
    ['Rétention', `${SAUVEGARDE.retentionQuotidienne} sauvegardes quotidiennes, ${SAUVEGARDE.retentionMensuelle} sauvegardes mensuelles, journaux de transactions sur ${SAUVEGARDE.retentionJournaux}`],
    ['Perte de données maximale', `${SAUVEGARDE.rpoMinutes} minutes (24 heures dans l'offre initiale)`],
    ['Délai de reprise', `${SAUVEGARDE.rtoHeuresOuvrees} heures ouvrées après déclaration de sinistre`],
    ['Test de restauration', 'Chaque trimestre, avec compte rendu remis au client, dont un test de restauration à un instant donné'],
    ['Disponibilité cible', `${SAUVEGARDE.disponibilite} par mois, hors fenêtre de maintenance annoncée 48 heures à l'avance`],
  ],
  [3200, 6438],
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
p(`La plateforme est mise en production en ${HYP.dureeSemaines} semaines à compter du démarrage, par une équipe dédiée à temps plein. Le démarrage, noté T0, est la date à laquelle l'acompte de commande est encaissé et les prérequis du chapitre 7.5 sont remis ; la date contractuelle de mise en production est T0 plus ${HYP.dureeSemaines} semaines. Ce délai repose sur trois conditions : les prototypes de la direction servent de spécification, les composants d'interface déjà développés par ${HYP.prestataire} sont réutilisés, et les référents du client sont disponibles chaque semaine.`);
table(
  ['Semaine', 'Objet', 'Travaux', 'Jalon'],
  PLANNING,
  [1200, 1800, 4438, 2200],
);
p(`À l'issue de la semaine 4, ${HYP.prestataire} assure quatre semaines d'accompagnement renforcé sur site et à distance, puis la garantie corrective de ${HYP.garantieMois} mois décrite au chapitre 8.6.`);
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
  'Un comité de pilotage hebdomadaire avec la direction générale et le responsable financier. Son compte rendu constate l\'avancement, les décisions et, le cas échéant, les événements qui décalent la date contractuelle.',
  'Un point d\'avancement quotidien de quinze minutes avec le référent du client.',
  'Un espace partagé de suivi des demandes, accessible au client.',
]);
h2('7.5 Prérequis côté client');
ul([
  'Un référent par domaine disponible une demi-journée par jour pendant les quatre semaines.',
  'La charte graphique du groupe et du cabinet, ou un atelier de définition en semaine 1.',
  'Les relevés bancaires et les modèles de déclarations fiscales en vigueur.',
  'La validation du plan de comptes par votre expert-comptable en semaine 2.',
]);
h2('7.6 Respect du délai et pénalités de retard');
p(`En réponse à votre point 6, ${HYP.prestataire} s'engage sur la date contractuelle de mise en production selon les règles suivantes :`);
ul([
  `Si le procès-verbal de mise en production est signé après la date contractuelle et que le retard est imputable à ${HYP.prestataire}, une pénalité de ${fmtPct(PENALITE.tauxJourPct)} du montant HT de la commande est due par jour calendaire de retard, soit ${gnf(P1.total * PENALITE.tauxJourPct / 100)} par jour.`,
  `Les pénalités sont plafonnées à ${fmtPct(PENALITE.plafondPct)} du montant HT de la commande, soit ${gnf(P1.total * PENALITE.plafondPct / 100)}.`,
  'Ne sont pas imputables au prestataire, et décalent la date contractuelle d\'autant : l\'indisponibilité des référents, la remise tardive des prérequis, les délais de validation du client au-delà de deux jours ouvrés, les demandes hors périmètre, et les cas de force majeure. Ces événements sont constatés au comité de pilotage hebdomadaire.',
  'Les pénalités sont déduites du dernier terme de paiement. Elles constituent la seule indemnité due au titre du retard.',
]);

pagebreak();

// ================================================================ 8. Offre financière
h1('8. Offre financière');
h2('8.1 Hypothèses');
ul([
  'Tous les montants sont en francs guinéens, hors taxes. La TVA et les retenues applicables en Guinée sont ajoutées selon la réglementation en vigueur.',
  'Prix forfaitaire : le montant est ferme pour le périmètre décrit aux chapitres 4 et 5. Toute évolution de périmètre fait l\'objet d\'un avenant chiffré.',
  'Aucun coût de licence.',
  'L\'hébergement de la première année, avec le dispositif de sauvegarde renforcé du chapitre 6.2, est compris dans le montant.',
]);

h2(`8.2 ${P1.code} : ${P1.titre}`);
p(`Les postes sont valorisés comme dans l'offre initiale. L'effort commercial demandé au point 8 de votre courrier est appliqué sur le total, pour un périmètre inchangé.`);
table(
  ['Poste', 'Montant HT'],
  [
    ...P1.postes.map(([l, m]) => [l, gnf(m)]),
    ['Valeur des prestations', gnf(P1.valeurPostes)],
    ['Effort commercial consenti dans le cadre de la présente révision', `− ${gnf(P1.effortCommercial)}`],
    [`Total ${P1.code.toLowerCase()}, hébergement de la première année compris`, gnfHT(P1.total)],
  ],
  [7238, 2400],
  { boldRows: [P1.postes.length, P1.postes.length + 2] },
);

h2('8.3 Hébergement, maintenance et support à partir de la deuxième année');
p('La première année d\'hébergement est comprise dans le montant ci-dessus. À partir de la deuxième année, un forfait annuel unique couvre :');
table(
  ['Prestation', 'Détail'],
  [
    ['Hébergement', HYP.vps],
    ['Exploitation', `Supervision, sauvegardes quotidiennes et journalisation continue toutes les ${SAUVEGARDE.rpoMinutes} minutes, tests de restauration, mises à jour de sécurité, renouvellement des certificats`],
    ['Support', 'Assistance des utilisateurs du lundi au vendredi, de 8 h à 18 h, par messagerie, e-mail et téléphone'],
    ['Maintenance corrective', 'Correction de toute anomalie, sans limite'],
    ['Maintenance évolutive', `${EVOLUTIONS.joursParMois} jours par mois d'évolutions incluses, cumulables sur le trimestre (${EVOLUTIONS.joursParTrimestre} jours par trimestre), selon les règles du chapitre 8.4`],
    ['Forfait annuel', `${gnfHT(P1.maintenanceAn)}, facturé par semestre d'avance`],
  ],
  [2600, 7038],
  { boldRows: [5] },
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

h2('8.4 Qualification des évolutions : incluses ou facturables');
p('En réponse à votre point 7, une évolution est une demande de modification ou d\'ajout qui ne corrige pas une anomalie. Les anomalies relèvent de la maintenance corrective et sont traitées sans limite. Une évolution est incluse dans le forfait annuel lorsqu\'elle remplit les trois critères suivants :');
ul([
  `Sa charge totale, spécification, réalisation, test et livraison comprises, est estimée à ${EVOLUTIONS.seuilJoursIncluse} jours-homme au plus.`,
  'Elle s\'appuie sur les écrans, les données et les états existants : elle n\'ajoute ni module ni écran complet, ni interface avec un système externe, ni modification du modèle de données nécessitant une reprise de données.',
  `Elle s'inscrit dans le crédit du trimestre en cours : ${EVOLUTIONS.joursParTrimestre} jours, cumulables à l'intérieur du trimestre, non reportables au-delà.`,
]);
table(
  ['Évolutions incluses, exemples', 'Évolutions facturables, exemples'],
  [
    ['Ajout d\'un champ, d\'une colonne, d\'un filtre ou d\'un tri sur un écran existant', 'Nouveau module ou nouvel écran complet, par exemple la paie ou la gestion des stocks'],
    ['Nouvel état ou nouvel export construit à partir des données existantes', 'Interface avec un système externe : banque, opérateur de paiement mobile, logiciel tiers'],
    ['Modification d\'une règle d\'alerte, d\'un seuil, d\'un niveau ou d\'un montant dans un circuit d\'approbation', 'Ajout d\'une société au périmètre avec reprise de son historique'],
    ['Création d\'un profil utilisateur, d\'une activité, d\'un centre de coût, d\'une route tarifée', 'Refonte d\'un parcours de saisie ou d\'un tableau de bord complet'],
    ['Adaptation d\'une maquette d\'impression ou d\'un modèle de document', 'Changement réglementaire majeur, tel qu\'une nouvelle version du référentiel SYSCOHADA'],
    ['Ajustement de la grille de critères ou des pondérations AxisPro au-delà de ce que le cabinet paramètre lui-même', 'Montée de version majeure du noyau, formation complémentaire'],
  ],
  [4819, 4819],
);
p('Procédure :');
ul([
  'Le client dépose sa demande dans l\'espace partagé de suivi.',
  `${HYP.prestataire} qualifie la demande par écrit sous ${EVOLUTIONS.delaiQualificationJoursOuvres} jours ouvrés : incluse ou facturable, charge estimée, date de livraison proposée.`,
  'Une évolution incluse est imputée sur le crédit du trimestre, livrée en recette puis en production. Un décompte du crédit consommé et restant est communiqué chaque trimestre.',
  `Une évolution facturable fait l'objet d'un devis au tarif de ${gnfHT(EVOLUTIONS.tarifJourHT)} par jour-homme, tarif ferme pendant les deux premières années. Elle n'est engagée qu'après accord écrit du client.`,
  'En cas de désaccord sur la qualification, le point est arbitré au comité de suivi ; à défaut d\'accord, une demande dont la charge estimée ne dépasse pas le seuil est traitée comme incluse.',
]);

h2('8.5 Conditions de paiement');
ul([
  '50 % à la commande, 30 % à la recette en semaine 4, 20 % au procès-verbal de mise en production, déduction faite des pénalités éventuelles.',
  'Forfait annuel d\'hébergement, maintenance et support : par semestre d\'avance, à compter du treizième mois.',
  'Règlement à 30 jours date de facture, par virement bancaire.',
]);

h2('8.6 Engagements contractuels');
ul([
  `Garantie corrective de ${HYP.garantieMois} mois à compter du procès-verbal de mise en production, incluse dans le prix. Elle couvre la correction, sans frais et dans les délais d'intervention du chapitre 8.3, de toute anomalie de la plateforme par rapport au périmètre recetté, y compris les anomalies révélées lors de la clôture de l'exercice, de l'établissement des états financiers annuels et des déclarations fiscales de fin d'exercice. Elle ne couvre pas les évolutions de périmètre ni les erreurs de saisie, qui relèvent respectivement du chapitre 8.4 et du support.`,
  `Pénalités de retard imputable à ${HYP.prestataire} selon le chapitre 7.6 : ${fmtPct(PENALITE.tauxJourPct)} du montant HT par jour calendaire, plafonnées à ${fmtPct(PENALITE.plafondPct)}.`,
  'Propriété du client sur ses données et sur le code développé pour lui ; les composants génériques d\'E-VOLUTION XP restent réutilisables par E-VOLUTION XP.',
  'Réversibilité complète sur demande, sans frais, dans les formats ouverts décrits au chapitre 6.4.',
  'Confidentialité des données financières et des dossiers des porteurs de projets, y compris après la fin du contrat.',
  `Validité de l'offre : ${HYP.validiteJours} jours à compter du ${HYP.dateOffre}, soit jusqu'au ${dateFin}. La présente révision remplace l'offre ${HYP.referenceInitiale} du ${HYP.dateOffreInitiale}.`,
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
    ['Journal des transactions', 'Enregistrement continu de chaque modification de la base de données, qui permet de la restaurer à un instant donné.'],
  ],
  [2600, 7038],
);
h2('9.2 Signature');
p(`Pour ${HYP.raisonSociale}`);
p(HYP.signataire);
p(HYP.qualiteSignataire);
p('Signature : ________________');
p('');
p(`Pour ${HYP.client} et ${HYP.client2}`);
p(`Bon pour accord sur l'offre ${HYP.reference}, ${P1.code}, d'un montant de ${gnfHT(P1.total)}`);
p('Date : ________________');
p('Signature et cachet : ________________');
p('Mention manuscrite obligatoire :');
p('« Lu et approuvé. Bon pour accord »');

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
          `Référence ${HYP.reference}, révision ${HYP.revision} du ${HYP.dateOffre}, valable ${HYP.validiteJours} jours`, '',
          `Remplace l'offre ${HYP.referenceInitiale} du ${HYP.dateOffreInitiale}`, '',
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
  c.push(para(`Révision ${HYP.revision} du ${HYP.dateOffre}, offre valable ${HYP.validiteJours} jours`, { size: 20, color: '666666', after: 40 }));
  c.push(para(`Remplace l'offre ${HYP.referenceInitiale} du ${HYP.dateOffreInitiale}`, { size: 20, color: '666666', after: 40 }));
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
    title: `Offre technique et financière EGUITRA, révision ${HYP.revision}`,
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
  console.log(`OK : logo ${logoPath ? path.basename(logoPath) : 'absent'} ; ${P1.code} ${gnf(P1.total)} (valeur ${gnf(P1.valeurPostes)}, effort ${gnf(P1.effortCommercial)}) ; validité jusqu'au ${dateFin}`);
})();
