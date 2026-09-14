// Génère docs/offre/Offre_technique_financiere_EGUITRA.docx et .md
// Usage : node docs/offre/build.js
const fs = require('fs');
const path = require('path');
const { HYP, LOTS, OPTIONS } = require('./contenu');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  ShadingType, HeadingLevel, AlignmentType, BorderStyle, LevelFormat, PageBreak,
  TableOfContents, Header, Footer, PageNumber, VerticalAlign,
} = require('docx');

// ---------------------------------------------------------------- calculs
const fmtEUR = (n) => Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ') + ' EUR';
const fmtGNF = (n) => {
  const m = n / 1e6;
  const v = m < 100 ? Math.round(m * 10) / 10 : Math.round(m);
  return v.toLocaleString('fr-FR').replace(/ | /g, ' ') + ' M GNF';
};
const eurToGnf = (e) => e * HYP.tauxGNF;

for (const lot of LOTS) {
  lot.jours = lot.postes.reduce((s, p) => s + p[1], 0);
  lot.montant = lot.jours * HYP.tjm;
}
const totalJours = LOTS.reduce((s, l) => s + l.jours, 0);
const totalMontant = LOTS.reduce((s, l) => s + l.montant, 0);
const exploitationAn = HYP.forfaitExploitationMois * 12;
const premiereAnnee = totalMontant + exploitationAn;

// ---------------------------------------------------------------- contenu
// Blocs : h1, h2, h3, p, ul, ol, table, callout, pagebreak, toc
const B = [];
const h1 = (t) => B.push({ t: 'h1', v: t });
const h2 = (t) => B.push({ t: 'h2', v: t });
const h3 = (t) => B.push({ t: 'h3', v: t });
const p = (t) => B.push({ t: 'p', v: t });
const ul = (items) => B.push({ t: 'ul', v: items });
const ol = (items) => B.push({ t: 'ol', v: items });
const table = (head, rows, widths, opts = {}) => B.push({ t: 'table', head, rows, widths, opts });
const callout = (t) => B.push({ t: 'callout', v: t });
const pagebreak = () => B.push({ t: 'pagebreak' });

// ---- Page de garde
B.push({ t: 'cover' });
pagebreak();
B.push({ t: 'toc' });
pagebreak();

// ---- 1. Synthèse
h1('1. Synthèse de l\'offre');
p(`${HYP.client} et ${HYP.client2} partagent une direction générale, des locaux et deux projets de digitalisation : le département Finance d'une part, l'accompagnement des porteurs de projets d'autre part. La présente offre répond aux deux projets par une plateforme unique, composée d'un noyau de gestion éprouvé et d'applications métier conçues sur mesure pour vos équipes.`);
p('Ce que nous proposons :');
ul([
  'Un noyau de gestion open source, mature, multi-sociétés et multi-devises, qui porte la comptabilité SYSCOHADA, l\'analytique, la trésorerie, les immobilisations, le budget, les workflows d\'approbation et la piste d\'audit. Ce noyau n\'a aucun coût de licence.',
  'Des applications métier à votre image, EGUITRA Finance et AxisPro Suite, qui constituent la seule interface vue par vos utilisateurs : tableau de bord dirigeant, saisie guidée, rentabilité par camion et par route, suivi de chantiers, gestion locative, scoring de bancabilité, portail des porteurs de projets.',
  'Un hébergement sur serveur virtuel privé dédié, avec sauvegardes quotidiennes hors site, supervision et engagement de disponibilité.',
  'Une démarche par lots avec une mise en production de la finance pour l\'ouverture de l\'exercice 2027, puis transport et BTP, immobilier et fiscalité, et enfin AxisPro Suite.',
]);
p('Chiffres clés de l\'offre :');
table(
  ['Élément', 'Valeur'],
  [
    ['Charge totale de réalisation', `${totalJours} jours-homme`],
    ['Investissement de réalisation, cinq lots', `${fmtEUR(totalMontant)} HT, soit ${fmtGNF(eurToGnf(totalMontant))}`],
    ['Forfait exploitation et support', `${fmtEUR(HYP.forfaitExploitationMois)} HT par mois, hébergement inclus`],
    ['Coût de licence logicielle', '0 EUR, noyau et modules communautaires open source'],
    ['Durée totale', '48 semaines, Finance en production à la semaine 18'],
    ['Garantie corrective', `${HYP.garantieMois} mois après chaque mise en production`],
    ['Validité de l\'offre', `${HYP.validiteJours} jours à compter du ${HYP.dateOffre}`],
  ],
  [4200, 5438],
);
callout(`Les montants en GNF sont donnés à titre indicatif au taux de ${HYP.tauxGNF.toLocaleString('fr-FR')} GNF pour 1 EUR. La facturation est établie en EUR ou en GNF au taux du jour de facturation, au choix du client fixé au contrat.`);

pagebreak();

// ---- 2. Compréhension du besoin
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
    ['Chiffre d\'affaires cumulé', 'Environ 20,6 milliards GNF, dont 70 % en transport d\'hydrocarbures'],
  ],
  [4200, 5438],
);

h2('2.2 Les deux projets');
p('Projet 1 : la digitalisation du département Finance. Le courrier du responsable financier liste vingt attentes, de la comptabilité SYSCOHADA révisée à la rentabilité par trajet, en passant par la consolidation groupe, les workflows d\'approbation, la piste d\'audit et la disponibilité garantie. Le tableau de couverture du chapitre 3.3 répond point par point.');
p('Projet 2 : la digitalisation de l\'accompagnement des porteurs de projets. Le prototype MB AxisPro décrit une méthode d\'évaluation de la maturité et de la bancabilité : 111 critères répartis sur 15 domaines, huit stage gates, des critères éliminatoires, une data room de 42 pièces, des revues de comité et des rapports de décision.');

h2('2.3 Ce que nous retenons des prototypes existants');
p('Les deux prototypes générés par la direction constituent une spécification fonctionnelle de grande qualité. Nous les reprenons comme cahier des charges de référence, et notamment :');
ul([
  'Le principe de saisie unique : chaque donnée n\'est saisie qu\'une fois, tout le reste est calculé.',
  'Les règles de contrôle : équilibre débit et crédit, équilibre actif et passif, compte de passage des virements internes soldé, clôture refusée tant qu\'une alerte bloquante est active.',
  'Les indicateurs du dirigeant : chiffre d\'affaires et résultat par activité, trésorerie fin de mois, ancienneté des créances, service de la dette et DSCR, marge par rotation, écarts budgétaires.',
  'La méthode d\'évaluation AxisPro : pondération, critères critiques et éliminatoires, gaps prioritaires, historique des revues, politique d\'évaluation tracée dans chaque export.',
]);
p('Ces prototypes sont conçus pour un utilisateur unique, sans authentification, avec un fichier local comme seule sauvegarde. La plateforme proposée conserve leurs règles et leur ergonomie, et y ajoute ce qui manque à un outil d\'entreprise : multi-utilisateurs, droits par profil, piste d\'audit, sauvegardes, disponibilité et évolutivité.');

pagebreak();

// ---- 3. Solution
h1('3. La solution proposée');
h2('3.1 Principe : un noyau invisible, des applications à votre image');
p('La plateforme repose sur deux couches strictement séparées.');
p('Le noyau de gestion est Odoo Community, complété par les modules de l\'Odoo Community Association (OCA) et par nos modules spécifiques. Il assure la tenue des écritures, la cohérence comptable, le multi-sociétés, le multi-devises, les droits d\'accès et la traçabilité. Il est publié sous licence libre LGPL : aucune redevance, aucune limite de nombre d\'utilisateurs, aucun éditeur à contacter pour une évolution.');
p('Les applications métier sont développées sur mesure et constituent la seule interface utilisée par vos équipes : EGUITRA Finance pour le groupe, AxisPro Suite pour le cabinet. Elles reprennent votre identité visuelle, votre vocabulaire et vos parcours de saisie. Le client web du noyau n\'est jamais exposé aux utilisateurs finaux ; il reste accessible à la seule équipe technique, sur un accès réseau restreint. Cette approche est celle que nous avons mise en œuvre pour SOGUIPREM.');
callout('Pour vos utilisateurs, il n\'existe qu\'EGUITRA Finance et AxisPro Suite. Le noyau reste un composant technique, comme la base de données.');

h2('3.2 Architecture d\'ensemble');
table(
  ['Couche', 'Composants', 'Rôle'],
  [
    ['Interface utilisateur', 'Applications web EGUITRA Finance et AxisPro Suite, application mobile de saisie des rotations, portail des porteurs de projets', 'Seule surface visible. Charte graphique du groupe, navigation métier, tableaux de bord, saisie guidée, exports.'],
    ['API métier', 'Modules spécifiques exposant une API REST sécurisée, authentification par jeton, double authentification', 'Traduit les actions métier en opérations du noyau, applique les règles de gestion, journalise.'],
    ['Noyau de gestion', 'Odoo Community, modules OCA, modules spécifiques du groupe', 'Comptabilité, analytique, trésorerie, immobilisations, budget, workflows, droits, audit.'],
    ['Données et documents', 'PostgreSQL, stockage de fichiers, index de recherche', 'Persistance, pièces justificatives, data room.'],
    ['Exploitation', 'Serveur VPS, conteneurs, proxy TLS, supervision, sauvegardes chiffrées hors site', 'Disponibilité, sécurité, restauration.'],
  ],
  [2000, 3900, 3738],
);

h2('3.3 Couverture des attentes du département Finance');
p('Chaque attente exprimée dans votre courrier est couverte selon l\'un des trois modes suivants : natif dans le noyau, module OCA, ou développement spécifique réalisé par nos soins.');
table(
  ['Attente exprimée', 'Mode', 'Réponse apportée'],
  [
    ['Visibilité globale et temps réel sur CA, résultat, trésorerie, indicateurs', 'Spécifique', 'Tableau de bord dirigeant d\'EGUITRA Finance, alimenté en direct par le noyau.'],
    ['Vue consolidée du groupe, décomposable par activité, filiale, projet, ligne logistique', 'Natif + OCA', 'Multi-sociétés natif, plans analytiques multi-axes, rapports consolidés OCA mis_builder.'],
    ['Comptabilité générale SYSCOHADA révisé', 'Natif', 'Plan de comptes SYSCOHADA du noyau, adapté à votre plan et validé avec votre expert-comptable.'],
    ['Comptabilité analytique par centre de coût, projet, chantier, activité', 'Natif', 'Plans analytiques Activité, Centre de coût, Chantier, Véhicule, Bien immobilier.'],
    ['Trésorerie et rapprochement bancaire', 'OCA', 'Import des relevés, rapprochement assisté, position de trésorerie par compte et par devise.'],
    ['Immobilisations et amortissements', 'OCA', 'Fiches d\'immobilisation, plans d\'amortissement, dotations automatiques, cessions.'],
    ['Gestion budgétaire, écarts réalisé et prévisionnel', 'OCA', 'Budgets mensuels par ligne et par activité, écarts calculés, seuils d\'alerte.'],
    ['Facturation client et fournisseur', 'Natif', 'Factures, avoirs, échéances, relances, lettrage.'],
    ['Gestion fiscale, TVA, déclarations locales', 'Natif + Spécifique', 'Taxes natives, états de déclaration au format guinéen développés au lot 3.'],
    ['Workflow d\'approbation des engagements et paiements', 'OCA', 'Circuits de validation à plusieurs niveaux sur les achats, factures et paiements, avec seuils par montant.'],
    ['Coûts et rentabilité par trajet et véhicule, volumes, taxes spécifiques', 'Spécifique', 'Module rotations lié à la flotte : volume, route, tarif, carburant, péages, frais chauffeur, maintenance, taxes ; marge par camion et par route.'],
    ['Chantiers, facturation à l\'avancement, retenues de garantie', 'Natif + Spécifique', 'Facturation par jalons, retenue de garantie par condition de paiement à deux échéances, état des retenues à libérer.'],
    ['Gestion locative et valorisation du patrimoine', 'OCA + Spécifique', 'Contrats récurrents pour les loyers, module biens et baux, valorisation du patrimoine.'],
    ['Traçabilité complète, piste d\'audit', 'Natif + OCA', 'Verrouillage des écritures par empreinte, dates de verrouillage, journal d\'audit de chaque modification.'],
    ['Sécurisation des données et des accès par profil', 'Natif + Spécifique', 'Rôles par profil, double authentification, chiffrement en transit et des sauvegardes.'],
    ['Disponibilité garantie et sauvegardes', 'Exploitation', 'Engagement de disponibilité, sauvegardes quotidiennes hors site, restauration testée chaque trimestre.'],
    ['Interface simple et formation', 'Spécifique', 'Applications conçues avec vos équipes, formation par profil incluse dans chaque lot.'],
    ['Support réactif et accompagnement', 'Exploitation', 'Forfait exploitation et support avec délais d\'intervention contractuels.'],
    ['Solution évolutive', 'Natif', 'Ajout de sociétés, d\'activités et d\'utilisateurs sans licence supplémentaire.'],
    ['Tarification claire, sans coûts cachés', 'Offre', 'Pas de licence ; prix forfaitaire par lot ; forfait mensuel unique pour l\'exploitation.'],
  ],
  [3300, 1500, 4838],
);

h2('3.4 EGUITRA Finance : les écrans');
p('L\'application reprend la structure du prototype de la direction et l\'étend. Les écrans du lot 1 :');
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
    ['Exports', 'CSV et XLSX de tous les journaux, états, export d\'audit.'],
    ['Paramètres et utilisateurs', 'Référentiels, seuils, taux de change, profils et droits.'],
  ],
  [2800, 6838],
);
p('Les lots 2 et 3 ajoutent les écrans Flotte, Chauffeurs, Routes et tarifs, Rotations, Rentabilité par ensemble routier, Chantiers, Situations d\'avancement, Retenues de garantie, Biens, Baux, Quittancement, Patrimoine, Déclarations fiscales, Consolidation groupe et Passerelle IFRS.');

h2('3.5 Transport pétrolier : la rotation comme source unique');
p('Une rotation est saisie une seule fois, depuis le bureau ou depuis l\'application mobile au parc, y compris sans connexion : la saisie est mise en file et synchronisée dès que le réseau revient. Chaque rotation porte le camion, le chauffeur, le client, le produit, le volume, la route, le tarif, le carburant, les péages, les frais de chauffeur, la maintenance et les taxes spécifiques. Le noyau en déduit la ligne de facturation, les coûts analytiques par véhicule et par route, et la marge. Le seuil de marge transport du dossier devient une alerte automatique.');

h2('3.6 AxisPro Suite : l\'accompagnement des porteurs de projets');
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
p('Le cabinet dispose en outre, dans le même outil et sans coût supplémentaire, de la facturation de ses prestations et du suivi de ses temps par dossier.');

pagebreak();

// ---- 4. Infrastructure
h1('4. Hébergement, sécurité et exploitation');
h2('4.1 Infrastructure');
ul([
  `Hébergement sur serveur virtuel privé dédié : ${HYP.hebergementInclus}.`,
  'Déploiement en conteneurs, proxy avec certificats TLS renouvelés automatiquement, base PostgreSQL dédiée.',
  'Deux environnements : production et recette. La recette reçoit chaque évolution avant la production.',
  'Nom de domaine du groupe pour chaque application, par exemple finance.eguitragroup.com.',
]);
h2('4.2 Sauvegardes et continuité');
table(
  ['Mesure', 'Engagement'],
  [
    ['Sauvegarde complète', 'Quotidienne, chiffrée, copiée hors site chez un second fournisseur'],
    ['Rétention', '30 sauvegardes quotidiennes, 12 sauvegardes mensuelles'],
    ['Perte de données maximale', '24 heures en standard ; 1 heure avec l\'archivage continu en option'],
    ['Délai de reprise', '4 heures ouvrées après déclaration de sinistre'],
    ['Test de restauration', 'Chaque trimestre, avec compte rendu remis au client'],
    ['Disponibilité cible', '99,5 % par mois, hors fenêtre de maintenance annoncée 48 heures à l\'avance'],
  ],
  [3600, 6038],
);
h2('4.3 Sécurité et conformité');
ul([
  'Authentification par mot de passe robuste et double authentification pour tous les utilisateurs.',
  'Droits par profil : direction, finance, exploitation transport, chantiers, immobilier, cabinet, porteur de projet. Chaque profil ne voit que son périmètre.',
  'Piste d\'audit : chaque création, modification et suppression est journalisée avec l\'utilisateur, la date et les valeurs avant et après.',
  'Écritures comptables verrouillées par empreinte après validation, dates de verrouillage par période.',
  'Chiffrement des échanges et des sauvegardes, journaux d\'accès conservés 12 mois.',
  'Mises à jour de sécurité du système et du noyau appliquées chaque mois en recette puis en production.',
]);
h2('4.4 Réversibilité');
p('Le client est propriétaire de ses données. À tout moment, sur simple demande, nous remettons une copie complète de la base, des pièces jointes et du code des modules spécifiques, dans des formats ouverts. La documentation d\'installation permet à un tiers de reprendre l\'exploitation.');

pagebreak();

// ---- 5. Démarche
h1('5. Démarche et planning');
h2('5.1 Une réalisation par lots');
p('Chaque lot est livré, recetté et mis en production indépendamment. Le groupe utilise la finance dès la semaine 18, sans attendre les lots suivants.');
table(
  ['Lot', 'Contenu', 'Période', 'Jalon'],
  [
    ['Lot 0', 'Cadrage et preuve de concept sur vos données 2026', 'Semaines 1 à 3', 'Dossier de conception validé'],
    ['Lot 1', 'Socle et EGUITRA Finance', 'Semaines 3 à 18', 'Exercice 2027 ouvert dans EGUITRA Finance'],
    ['Lot 2', 'Transport pétrolier et BTP', 'Semaines 16 à 28', 'Rotations et chantiers en production'],
    ['Lot 3', 'Immobilier, fiscalité, consolidation, IFRS', 'Semaines 27 à 36', 'Première déclaration produite par l\'outil'],
    ['Lot 4', 'AxisPro Suite', 'Semaines 34 à 48', 'Premier comité tenu dans AxisPro Suite'],
  ],
  [1200, 4238, 2000, 2200],
);
h2('5.2 Reprise des données');
p('Le dossier 2026 est repris intégralement : référentiels, tiers, plan de comptes, immobilisations, financements, budget, ventes, achats, trésorerie, rotations et OD. Les balances obtenues sont confrontées au classeur d\'origine et validées par votre responsable financier avant la mise en production. L\'exercice 2026 est ainsi consultable dans l\'outil dès le premier jour.');
h2('5.3 Recette et formation');
ul([
  'Chaque lot fait l\'objet d\'un cahier de recette rédigé avec vos équipes, puis d\'une recette en environnement dédié.',
  'Formation par profil : direction, finance, exploitation, chantiers, immobilier, cabinet. Supports et guides utilisateur remis en français.',
  'Accompagnement renforcé pendant les quatre semaines suivant chaque mise en production.',
]);
h2('5.4 Gouvernance');
ul([
  'Un comité de pilotage mensuel avec la direction générale et le responsable financier.',
  'Un point d\'avancement hebdomadaire avec le référent de chaque lot.',
  'Un espace partagé de suivi des demandes, accessible au client.',
]);
h2('5.5 Équipe');
table(
  ['Rôle', 'Mission'],
  [
    ['Directeur de projet et architecte', 'Interlocuteur unique, conception, arbitrages, qualité des livraisons.'],
    ['Consultant fonctionnel finance', 'Paramétrage SYSCOHADA, analytique, états financiers, reprise des données, formation.'],
    ['Développeurs noyau', 'Modules spécifiques, API, règles de gestion, intégration des modules OCA.'],
    ['Développeurs interface', 'Applications EGUITRA Finance et AxisPro Suite, application mobile, portail.'],
    ['Ingénieur exploitation', 'Infrastructure, sécurité, sauvegardes, supervision, support.'],
    ['Expert-comptable partenaire', 'Validation du plan de comptes, des états financiers et des déclarations fiscales guinéennes.'],
  ],
  [3200, 6438],
);
h2('5.6 Prérequis côté client');
ul([
  'Un référent par domaine disponible environ une demi-journée par semaine pendant son lot.',
  'La charte graphique du groupe et du cabinet, ou à défaut un atelier de définition au lot 0.',
  'Les accès aux relevés bancaires électroniques et les modèles de déclarations fiscales en vigueur.',
  'La validation du plan de comptes par votre expert-comptable au lot 1.',
]);

pagebreak();

// ---- 6. Offre financière
h1('6. Offre financière');
h2('6.1 Hypothèses');
ul([
  `Taux journalier moyen de ${fmtEUR(HYP.tjm)} HT, identique pour tous les profils.`,
  'Prix forfaitaires par lot, sur la base des charges détaillées ci-dessous. Toute évolution de périmètre fait l\'objet d\'un avenant chiffré au même taux.',
  'Aucun coût de licence : noyau et modules communautaires sous licence libre.',
  `Montants en GNF indicatifs au taux de ${HYP.tauxGNF.toLocaleString('fr-FR')} GNF pour 1 EUR.`,
  'Montants hors taxes ; la TVA et les retenues applicables en Guinée sont ajoutées selon la réglementation en vigueur.',
]);

h2('6.2 Réalisation : détail par lot');
for (const lot of LOTS) {
  h3(`${lot.code} : ${lot.titre}`);
  table(
    ['Poste', 'Jours'],
    [...lot.postes.map(([l, j]) => [l, String(j)]), [`Total ${lot.code}`, `${lot.jours} jours, ${fmtEUR(lot.montant)} HT`]],
    [7638, 2000],
    { lastBold: true },
  );
}

h2('6.3 Récapitulatif de la réalisation');
table(
  ['Lot', 'Jours', 'Montant HT', 'Équivalent GNF'],
  [
    ...LOTS.map((l) => [`${l.code} : ${l.titre}`, String(l.jours), fmtEUR(l.montant), fmtGNF(eurToGnf(l.montant))]),
    ['Total réalisation', String(totalJours), fmtEUR(totalMontant), fmtGNF(eurToGnf(totalMontant))],
  ],
  [4438, 1200, 2000, 2000],
  { lastBold: true },
);

h2('6.4 Exploitation et support');
p('Le forfait mensuel couvre l\'ensemble de l\'exploitation. Il démarre à la mise en production du lot 1.');
table(
  ['Prestation incluse', 'Détail'],
  [
    ['Hébergement', HYP.hebergementInclus],
    ['Exploitation', 'Supervision, sauvegardes, tests de restauration, mises à jour de sécurité, renouvellement des certificats'],
    ['Support', 'Assistance utilisateurs du lundi au vendredi, de 8 h à 18 h, heure de Conakry, par messagerie, e-mail et téléphone'],
    ['Maintenance corrective', 'Correction de toute anomalie, sans limite'],
    ['Maintenance évolutive', 'Deux jours par mois de petites évolutions, cumulables sur le trimestre'],
    ['Forfait mensuel', `${fmtEUR(HYP.forfaitExploitationMois)} HT, soit ${fmtGNF(eurToGnf(HYP.forfaitExploitationMois))}, facturé par trimestre d'avance`],
  ],
  [2600, 7038],
  { lastBold: true },
);
p('Délais d\'intervention du support :');
table(
  ['Gravité', 'Définition', 'Prise en charge', 'Résolution ou contournement'],
  [
    ['Bloquante', 'Application inaccessible ou saisie impossible pour tous', '2 heures ouvrées', '8 heures ouvrées'],
    ['Majeure', 'Fonction essentielle indisponible pour un profil', '4 heures ouvrées', '2 jours ouvrés'],
    ['Mineure', 'Gêne sans blocage', '1 jour ouvré', 'Prochaine livraison planifiée'],
  ],
  [1600, 3838, 2000, 2200],
);

h2('6.5 Options');
table(
  ['Option', 'Prix'],
  OPTIONS.map(([l, prix]) => [l, prix]),
  [6638, 3000],
);

h2('6.6 Synthèse financière');
table(
  ['Poste', 'Montant HT', 'Équivalent GNF'],
  [
    ['Réalisation des cinq lots', fmtEUR(totalMontant), fmtGNF(eurToGnf(totalMontant))],
    ['Exploitation et support, 12 mois', fmtEUR(exploitationAn), fmtGNF(eurToGnf(exploitationAn))],
    ['Total première année', fmtEUR(premiereAnnee), fmtGNF(eurToGnf(premiereAnnee))],
    ['Années suivantes, exploitation et support', `${fmtEUR(exploitationAn)} par an`, `${fmtGNF(eurToGnf(exploitationAn))} par an`],
  ],
  [4438, 2600, 2600],
  { lastBold: false, boldRows: [2] },
);

h2('6.7 Conditions de paiement');
ul([
  'Par lot : 40 % à la commande du lot, 40 % à la recette, 20 % à la mise en production.',
  'Forfait exploitation et support : par trimestre d\'avance.',
  'Options : à la commande.',
  'Règlement à 30 jours date de facture, par virement.',
]);

h2('6.8 Engagements contractuels');
ul([
  `Garantie corrective de ${HYP.garantieMois} mois après chaque mise en production, incluse dans le prix du lot.`,
  'Propriété du client sur ses données et sur le code des modules spécifiques développés pour lui ; les composants génériques du prestataire restent réutilisables par celui-ci.',
  'Réversibilité complète sur demande, sans frais, dans les formats ouverts décrits au chapitre 4.4.',
  'Confidentialité des données financières et des dossiers des porteurs de projets, y compris après la fin du contrat.',
  `Validité de l'offre : ${HYP.validiteJours} jours à compter du ${HYP.dateOffre}.`,
]);

pagebreak();

// ---- 7. Annexes
h1('7. Annexes');
h2('7.1 Modules communautaires OCA retenus');
table(
  ['Besoin', 'Module OCA'],
  [
    ['Rapprochement bancaire', 'account_reconcile_oca, account_statement_import_file et formats associés'],
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
p('La liste définitive est arrêtée au lot 0, module par module, sur la version du noyau retenue. Les besoins non couverts par un module communautaire sont réalisés en spécifique, sans surcoût par rapport à la présente offre.');
h2('7.2 Modules spécifiques développés pour le groupe');
ul([
  'eguitra_core : référentiels, règles de gestion communes, API de la surcouche, alertes.',
  'eguitra_finance : contrôles de clôture, compte de passage, rapport mensuel, exports d\'audit.',
  'eguitra_transport : rotations, routes, tarifs, volumes, taxes, rentabilité par véhicule.',
  'eguitra_btp : chantiers, situations d\'avancement, retenues de garantie.',
  'eguitra_immo : biens, baux, quittancement, patrimoine.',
  'eguitra_fiscal : déclarations guinéennes, passerelle IFRS.',
  'axispro_suite : critères, gates, scoring, data room, revues, rapports, portail.',
]);
h2('7.3 Glossaire');
table(
  ['Terme', 'Définition'],
  [
    ['OCA', 'Odoo Community Association, association qui publie des modules libres pour le noyau.'],
    ['SYSCOHADA', 'Système comptable de l\'Organisation pour l\'harmonisation en Afrique du droit des affaires, version révisée.'],
    ['DSCR', 'Ratio de couverture du service de la dette.'],
    ['Stage gate', 'Étape de décision d\'un projet, avec ses règles de passage.'],
    ['Knock-out', 'Critère éliminatoire imposant un NO-GO quel que soit le score.'],
    ['VPS', 'Serveur virtuel privé, dédié au client chez un hébergeur.'],
    ['TJM', 'Taux journalier moyen, prix d\'une journée de travail.'],
  ],
  [2000, 7638],
);

// ---------------------------------------------------------------- rendu MD
function toMarkdown() {
  const out = [];
  for (const b of B) {
    switch (b.t) {
      case 'cover':
        out.push(`# Offre technique et financière`, '',
          `**Digitalisation du département Finance et de l'accompagnement des porteurs de projets**`, '',
          `Pour ${HYP.client} et ${HYP.client2}, à l'attention de ${HYP.dg}`, '',
          `Référence ${HYP.reference}, ${HYP.dateOffre}, valable ${HYP.validiteJours} jours`, '',
          `Émise par ${HYP.prestataire}. Contact : ${HYP.contact}`, '');
        break;
      case 'toc': out.push('_Sommaire : voir la version Word, table des matières automatique._', ''); break;
      case 'pagebreak': out.push('', '---', ''); break;
      case 'h1': out.push('', `## ${b.v}`, ''); break;
      case 'h2': out.push('', `### ${b.v}`, ''); break;
      case 'h3': out.push('', `#### ${b.v}`, ''); break;
      case 'p': out.push(b.v, ''); break;
      case 'callout': out.push(`> ${b.v}`, ''); break;
      case 'ul': out.push(...b.v.map((i) => `- ${i}`), ''); break;
      case 'ol': out.push(...b.v.map((i, k) => `${k + 1}. ${i}`), ''); break;
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
  // supprime les séparateurs consécutifs (couverture puis sommaire)
  return out.join('\n').replace(/(\n---\n){2,}/g, '\n---\n');
}

// ---------------------------------------------------------------- rendu DOCX
const NAVY = '1F3A5F';
const GOLD = 'B8860B';
const GREY = 'F2F4F7';
const FONT = 'Calibri';
const CONTENT_W = 9638; // A4 moins marges de 2 cm

const run = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size || 22, bold: o.bold, color: o.color, italics: o.italics });
const para = (text, o = {}) => new Paragraph({
  children: [run(text, o)], spacing: { after: o.after ?? 120, before: o.before ?? 0 }, alignment: o.align, style: o.style,
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
    return new TableRow({ children: r.map((c, i) => mk(c, i, { bold, shade: bold ? 'E8EDF5' : (ri % 2 ? GREY : undefined) })) });
  });
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: w, rows: [headRow, ...bodyRows] });
}

function coverPage() {
  const c = [];
  c.push(new Paragraph({ spacing: { before: 2400 }, children: [] }));
  c.push(para(HYP.prestataire, { size: 24, color: GOLD, bold: true, after: 1200 }));
  c.push(para('Offre technique et financière', { size: 52, bold: true, color: NAVY, after: 240 }));
  c.push(para('Digitalisation du département Finance et de l\'accompagnement des porteurs de projets', { size: 28, color: '444444', after: 900 }));
  c.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 1 } }, spacing: { after: 600 }, children: [] }));
  c.push(para(`Pour ${HYP.client}`, { size: 26, bold: true, after: 60 }));
  c.push(para(`et ${HYP.client2}`, { size: 26, bold: true, after: 60 }));
  c.push(para(`À l'attention de ${HYP.dg}`, { size: 22, after: 900 }));
  c.push(para(`Référence ${HYP.reference}`, { size: 20, color: '666666', after: 40 }));
  c.push(para(`${HYP.dateOffre}, offre valable ${HYP.validiteJours} jours`, { size: 20, color: '666666', after: 40 }));
  c.push(para(`Contact : ${HYP.contact}`, { size: 20, color: '666666', after: 40 }));
  c.push(para('Document confidentiel, destiné exclusivement à ses destinataires.', { size: 18, italics: true, color: '888888', before: 1800 }));
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
          shading: { type: ShadingType.CLEAR, fill: 'EEF3FA', color: 'auto' },
          border: { left: { style: BorderStyle.SINGLE, size: 24, color: GOLD, space: 8 } },
          spacing: { before: 120, after: 200 }, indent: { left: 200, right: 200 },
        }));
        break;
      case 'ul': b.v.forEach((i) => children.push(new Paragraph({ numbering: { reference: 'puces', level: 0 }, children: [run(i)], spacing: { after: 80 } }))); break;
      case 'ol': b.v.forEach((i) => children.push(new Paragraph({ numbering: { reference: 'nums', level: 0 }, children: [run(i)], spacing: { after: 80 } }))); break;
      case 'table':
        children.push(docTable(b.head, b.rows, b.widths, b.opts));
        children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
        break;
    }
  }

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
        { reference: 'nums', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 280 } } } }] },
      ],
    },
    features: { updateFields: true },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      headers: {
        default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C9CFD8', space: 4 } }, children: [run(`Offre technique et financière, ${HYP.client} et ${HYP.client2}`, { size: 16, color: '888888' })] })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(`${HYP.prestataire}, réf. ${HYP.reference}, confidentiel. Page `, { size: 16, color: '888888' }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '888888' })] })] }),
      },
      children,
    }],
  });
}

// ---------------------------------------------------------------- sortie
(async () => {
  const outDir = __dirname;
  const base = 'Offre_technique_financiere_EGUITRA';
  fs.writeFileSync(path.join(outDir, `${base}.md`), toMarkdown());
  const buf = await Packer.toBuffer(toDocx());
  fs.writeFileSync(path.join(outDir, `${base}.docx`), buf);
  console.log(`OK : ${totalJours} jours, ${fmtEUR(totalMontant)} réalisation, ${fmtEUR(premiereAnnee)} première année`);
})();
