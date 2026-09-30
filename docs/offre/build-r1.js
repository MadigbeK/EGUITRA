// Génère docs/offre/Offre_revisee_R1_EGUITRA.docx et .md
// Offre révisée, limitée à la proposition 1, en réponse aux observations du client.
// Usage : node docs/offre/build-r1.js
const path = require('path');
const { HYP, P1, PLANNING } = require('./contenu-r1');
const { blocs, ecrire, trouverLogo, gnf, gnfHT, pct, NBSP } = require('./rendu');

const logoPath = trouverLogo(__dirname, HYP.logoFichiers);
const { B, h1, h2, p, ul, table, callout, pagebreak, cover, toc } = blocs();

const remise = P1.totalInitial - P1.total;
const remisePct = Math.round((remise / P1.totalInitial) * 100);
const validite = `${HYP.validiteJours} jours à compter du ${HYP.dateOffre}`;
const garantieTexte = `${HYP.garantieMois} mois à compter du procès-verbal de mise en production et, si cette échéance est postérieure, jusqu'à la production des états financiers annuels de l'exercice 2026 et de la déclaration fiscale correspondante`;

cover();
pagebreak();
toc();
pagebreak();

// ================================================================ 1. Synthèse
h1('1. Synthèse de l\'offre révisée');
p(`Par courrier en réponse à notre offre ${HYP.referenceInitiale} du ${HYP.dateInitiale}, ${HYP.client} a retenu la proposition 1, plateforme intégrée sur noyau de gestion, et nous a demandé de clarifier ou réviser six points. La présente offre révisée y répond intégralement. Elle annule et remplace l'offre initiale pour la proposition 1 ; la proposition 2 n'est pas reconduite.`);
p('Le périmètre fonctionnel est inchangé : EGUITRA Finance et AxisPro Suite, vingt attentes du département Finance couvertes, mise en production en quatre semaines, hébergement de la première année compris.');
table(
  ['Élément', 'Offre initiale', 'Offre révisée'],
  [
    ['Montant, hébergement de la première année compris', gnfHT(P1.totalInitial), gnfHT(P1.total)],
    ['Validité', 'Incohérente entre sections', validite],
    ['Garantie corrective', '3 mois', `${HYP.garantieMois} mois, première clôture annuelle couverte`],
    ['Perte de données maximale', '24 heures', `${HYP.sauvegardeContinueMinutes} minutes, sans supplément`],
    ['Pénalités de retard', 'Aucune', `${HYP.penaliteParJourPct.toLocaleString('fr-FR')}${NBSP}% par jour ouvré, plafonnées à ${HYP.penalitePlafondPct}${NBSP}%`],
    ['Maintenance évolutive incluse', 'Non définie', 'Critères précis, chapitre 8.3'],
    ['Hébergement, maintenance et support à partir de la deuxième année', `${gnfHT(HYP.maintenanceAn)} par an`, `${gnfHT(HYP.maintenanceAn)} par an, inchangé`],
    ['Délai de mise en production', `${HYP.dureeSemaines} semaines`, `${HYP.dureeSemaines} semaines, inchangé`],
  ],
  [3438, 2800, 3400],
);
callout(`Le montant révisé de ${gnfHT(P1.total)} représente un effort commercial de ${gnf(remise)}, soit ${remisePct}${NBSP}% par rapport à l'offre initiale, pour un périmètre fonctionnel strictement identique. Il constitue notre meilleure offre et n'est pas susceptible d'une nouvelle réduction.`);

pagebreak();

// ================================================================ 2. Réponses
h1('2. Réponse à vos observations');
p('Chaque point de votre courrier est repris ci-dessous avec notre réponse et le chapitre du présent document où elle est contractualisée.');
table(
  ['Point', 'Votre demande', 'Notre réponse', 'Chapitre'],
  [
    ['1. Validité', 'Confirmer et harmoniser la durée de validité, indiquée à 60 jours en page de garde, 30 jours en synthèse et 60 jours en engagements.', `Nous confirmons une validité unique de ${validite}. Elle figure à l'identique en page de garde, en synthèse et dans les engagements contractuels.`, '1 et 8.6'],
    ['3. Garantie', 'Porter la garantie corrective à six mois au minimum, pour couvrir la première clôture annuelle complète.', `Accordé. La garantie corrective est portée à ${HYP.garantieMois} mois et couvre, en tout état de cause, la première clôture annuelle et la déclaration fiscale de fin d'exercice, même si elles interviennent au-delà.`, '8.6'],
    ['5. Sauvegardes', 'Réduire l\'exposition de vingt-quatre heures par une sauvegarde plus fréquente ; en préciser les conditions.', `Accordé, sans supplément. En plus de la sauvegarde complète quotidienne, les journaux de transactions de la base sont archivés hors site toutes les ${HYP.sauvegardeContinueMinutes} minutes et les pièces jointes toutes les heures. La perte de données maximale passe de 24 heures à ${HYP.sauvegardeContinueMinutes} minutes pour l'ensemble des modules, avec restauration à l'instant choisi.`, '6.2'],
    ['6. Calendrier', 'Insérer une clause de pénalité de retard imputable au prestataire.', `Accordé. Pénalité de ${HYP.penaliteParJourPct.toLocaleString('fr-FR')}${NBSP}% du montant HT par jour ouvré de retard imputable à ${HYP.prestataire} sur la date contractuelle de mise en production, plafonnée à ${HYP.penalitePlafondPct}${NBSP}% du montant HT, déduite de la dernière facture.`, '7.2'],
    ['7. Maintenance évolutive', 'Définir les critères qui distinguent une évolution incluse d\'une évolution facturable.', `Accordé. Une évolution est incluse si elle relève du paramétrage ou d'une adaptation d'un écran, d'un état ou d'une règle existants, et représente au plus une journée de travail. Tout ce qui crée un écran, un module, un flux ou une intégration est facturable sur devis. Le détail figure au chapitre 8.3, avec le tarif journalier applicable au-delà du forfait.`, '8.3'],
    ['8. Conditions financières', `Revoir le montant de la proposition 1 et soumettre une offre à ${gnfHT(40000000)}, pour un périmètre inchangé.`, `Nous avons revu le montant en profondeur. Notre offre révisée s'établit à ${gnfHT(P1.total)}, périmètre inchangé, hébergement de la première année compris. Le chapitre 8.1 explique ce qui rend cet effort possible et pourquoi ${gnfHT(40000000)} ne permettrait pas de tenir le périmètre et les engagements demandés.`, '8.1 et 8.2'],
  ],
  [1400, 2600, 4238, 1400],
);

pagebreak();

// ================================================================ 3. Compréhension
h1('3. Rappel du besoin');
p(`${HYP.client} opère sur trois secteurs : le transport et la logistique de produits pétroliers, le BTP et l'immobilier, complétés par une activité de négoce. ${HYP.client2}, cabinet de conseil du même groupe, accompagne des porteurs de projets vers le financement bancaire et l'investissement. Les deux projets de digitalisation, le département Finance et l'accompagnement des porteurs de projets, sont couverts par la présente offre.`);
table(
  ['Donnée du dossier 2026', 'Volume au 15 août 2026'],
  [
    ['Activités et centres de coût', '7 activités, 9 centres de coût'],
    ['Comptes de trésorerie', '3 banques dont un compte USD, 2 caisses'],
    ['Flotte et chauffeurs', '15 ensembles citernes, 15 chauffeurs, 9 routes tarifées'],
    ['Rotations, factures de vente, pièces d\'achat, opérations de trésorerie', '383, 147, 169, 412'],
    ['Immobilisations et financements', '24 immobilisations, 4 emprunts et crédits-bails'],
    ['Chiffre d\'affaires cumulé', `Environ 20,6 milliards${NBSP}GNF, dont 70${NBSP}% en transport d'hydrocarbures`],
  ],
  [4200, 5438],
);
p('Les prototypes générés par la direction, EGUITRA Finance et MB AxisPro, restent le cahier des charges de référence : saisie unique, contrôles de clôture bloquants, indicateurs du dirigeant, méthode d\'évaluation de la bancabilité à 111 critères, huit stage gates et data room de 42 pièces.');

pagebreak();

// ================================================================ 4. Solution
h1('4. La solution : plateforme intégrée sur noyau de gestion');
h2('4.1 Principe : un noyau invisible, des applications à votre image');
p('La plateforme repose sur deux couches strictement séparées. Le noyau de gestion est Odoo Community, complété par les modules de l\'Odoo Community Association (OCA) et par nos modules spécifiques. Il assure la tenue des écritures, la cohérence comptable, le multi-sociétés, le multi-devises, les droits d\'accès et la traçabilité. Il est publié sous licence libre : aucune redevance, aucune limite de nombre d\'utilisateurs, aucun éditeur à contacter pour une évolution.');
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
table(
  ['Attente exprimée', 'Réponse'],
  [
    ['Visibilité globale et temps réel sur CA, résultat, trésorerie, indicateurs', 'Couverte : tableau de bord du dirigeant alimenté en direct'],
    ['Vue consolidée du groupe, décomposable par activité, filiale, projet, ligne logistique', 'Couverte : multi-sociétés natif, plans analytiques multi-axes, rapports consolidés'],
    ['Comptabilité générale SYSCOHADA révisé', 'Couverte : plan de comptes du noyau, validé avec votre expert-comptable'],
    ['Comptabilité analytique par centre de coût, projet, chantier, activité', 'Couverte : axes Activité, Centre de coût, Chantier, Véhicule, Bien'],
    ['Trésorerie et rapprochement bancaire', 'Couverte : import des relevés, rapprochement assisté'],
    ['Immobilisations et amortissements', 'Couverte'],
    ['Gestion budgétaire, écarts réalisé et prévisionnel', 'Couverte'],
    ['Facturation client et fournisseur', 'Couverte, avec relances'],
    ['Gestion fiscale, TVA, déclarations locales', 'Couverte : états de déclaration au format guinéen'],
    ['Workflow d\'approbation des engagements et paiements', 'Couverte : plusieurs niveaux et seuils par montant'],
    ['Coûts et rentabilité par trajet et véhicule, volumes, taxes spécifiques', 'Couverte : module rotations'],
    ['Chantiers, facturation à l\'avancement, retenues de garantie', 'Couverte : jalons et conditions de paiement à deux échéances'],
    ['Gestion locative et valorisation du patrimoine', 'Couverte : contrats récurrents, biens et baux'],
    ['Traçabilité complète, piste d\'audit', 'Couverte : verrouillage par empreinte, journal d\'audit'],
    ['Sécurisation des données et des accès par profil', 'Couverte : rôles, double authentification, chiffrement'],
    ['Disponibilité garantie et sauvegardes', `Couverte : 99,5${NBSP}%, perte maximale ${HYP.sauvegardeContinueMinutes} minutes`],
    ['Interface simple et formation', 'Couverte : applications conçues avec vos équipes, formation par profil'],
    ['Support réactif et accompagnement', 'Couverte : délais d\'intervention contractuels'],
    ['Solution évolutive', 'Couverte : ajout de sociétés, d\'activités et de modules sans licence'],
    ['Tarification claire, sans coûts cachés', 'Couverte : forfait ferme, pas de licence, forfait annuel unique'],
  ],
  [4400, 5238],
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
h2('6.2 Sauvegardes et continuité, dispositif renforcé');
p('En réponse à votre point 5, le dispositif de sauvegarde est renforcé pour l\'ensemble des modules, sans supplément de prix, ni à la réalisation ni dans le forfait annuel :');
table(
  ['Mesure', 'Engagement'],
  [
    ['Sauvegarde complète', 'Quotidienne, chiffrée, copiée hors site chez un second fournisseur'],
    ['Archivage continu de la base', `Journaux de transactions PostgreSQL archivés hors site toutes les ${HYP.sauvegardeContinueMinutes} minutes ; restauration possible à tout instant entre deux sauvegardes complètes`],
    ['Pièces jointes et documents', 'Synchronisation hors site toutes les heures'],
    ['Rétention', '30 sauvegardes quotidiennes, 12 sauvegardes mensuelles, journaux de transactions conservés 30 jours'],
    ['Perte de données maximale', `${HYP.sauvegardeContinueMinutes} minutes pour la base, 1 heure pour les pièces jointes`],
    ['Délai de reprise', '4 heures ouvrées après déclaration de sinistre'],
    ['Test de restauration', 'Chaque trimestre, avec compte rendu remis au client ; le premier test est réalisé avant la mise en production'],
    ['Disponibilité cible', `99,5${NBSP}% par mois, hors fenêtre de maintenance annoncée 48 heures à l'avance`],
  ],
  [3200, 6438],
);
p('Conditions : le stockage hors site nécessaire est compris dans l\'hébergement de la première année et dans le forfait annuel. Une sauvegarde locale supplémentaire sur un serveur dans vos locaux à Conakry peut être ajoutée en option, sur devis, si la direction le souhaite.');
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
h1('7. Démarche, planning et pénalités de retard');
h2('7.1 Planning en quatre semaines');
p(`La réalisation est menée en ${HYP.dureeSemaines} semaines à compter de la date de commande, par une équipe dédiée à temps plein. La date de commande est celle de la réception du bon de commande signé et de l'acompte ; la date contractuelle de mise en production est fixée à ${HYP.dureeSemaines} semaines calendaires après cette date et inscrite au contrat.`);
table(
  ['Semaine', 'Objet', 'Travaux', 'Jalon'],
  PLANNING,
  [1200, 1800, 4438, 2200],
);
p(`À l'issue de la semaine 4, ${HYP.prestataire} assure quatre semaines d'accompagnement renforcé sur site et à distance, puis la garantie corrective de ${HYP.garantieMois} mois décrite au chapitre 8.6.`);
h2('7.2 Pénalités de retard');
p('En réponse à votre point 6, la clause suivante est intégrée au contrat :');
ul([
  `Tout retard sur la date contractuelle de mise en production imputable à ${HYP.prestataire} donne lieu à une pénalité de ${HYP.penaliteParJourPct.toLocaleString('fr-FR')}${NBSP}% du montant HT de la commande par jour ouvré de retard.`,
  `La pénalité est plafonnée à ${HYP.penalitePlafondPct}${NBSP}% du montant HT de la commande, soit ${gnf(P1.total * HYP.penalitePlafondPct / 100)}. Elle est déduite de la dernière facture, sans autre formalité qu'un décompte contradictoire.`,
  'Un retard est imputable au prestataire dès lors qu\'il ne résulte pas d\'une des causes suivantes : indisponibilité des référents du client aux créneaux convenus, remise tardive des éléments listés au chapitre 7.6, validation du plan de comptes par l\'expert-comptable au-delà de la semaine 2, demande de modification du périmètre, cas de force majeure.',
  'Un retard dû à l\'une de ces causes décale la date contractuelle de mise en production du même nombre de jours ouvrés, constaté par écrit au comité de pilotage hebdomadaire.',
  'La recette est réputée acquise si le client ne formule aucune réserve écrite dans les cinq jours ouvrés suivant la livraison en recette ; les réserves bloquantes sont levées avant la mise en production, les réserves mineures dans le cadre de la garantie.',
]);
h2('7.3 Reprise des données');
p('Le dossier 2026 est repris intégralement : référentiels, tiers, plan de comptes, immobilisations, financements, budget, ventes, achats, trésorerie, rotations et OD. Les balances obtenues sont confrontées au classeur d\'origine et validées par votre responsable financier avant la mise en production. L\'exercice 2026 est ainsi consultable dans l\'outil dès le premier jour, et l\'exercice 2027 s\'ouvre directement dans l\'outil.');
h2('7.4 Recette et formation');
ul([
  'Cahier de recette rédigé avec vos équipes en semaine 3, recette en semaine 4 sur vos données.',
  'Formation par profil : direction, finance, exploitation, chantiers, immobilier, cabinet. Supports et guides utilisateur remis en français.',
  'Accompagnement renforcé pendant les quatre semaines suivant la mise en production.',
]);
h2('7.5 Gouvernance');
ul([
  'Un comité de pilotage hebdomadaire avec la direction générale et le responsable financier, avec compte rendu écrit constatant l\'avancement et, le cas échéant, les décalages et leur cause.',
  'Un point d\'avancement quotidien de quinze minutes avec le référent du client.',
  'Un espace partagé de suivi des demandes, accessible au client.',
]);
h2('7.6 Prérequis côté client');
ul([
  'Un référent par domaine disponible une demi-journée par jour pendant les quatre semaines.',
  'La charte graphique du groupe et du cabinet, ou un atelier de définition en semaine 1.',
  'Les relevés bancaires et les modèles de déclarations fiscales en vigueur, remis au plus tard en semaine 1.',
  'La validation du plan de comptes par votre expert-comptable en semaine 2.',
]);

pagebreak();

// ================================================================ 8. Offre financière
h1('8. Offre financière révisée');
h2('8.1 Réponse à votre demande de révision du prix');
p(`Vous nous avez demandé une offre à ${gnfHT(40000000)} pour un périmètre inchangé. Nous avons repris chaque poste de l'offre initiale, à ${gnfHT(P1.totalInitial)}, et identifié trois leviers qui permettent de baisser sensiblement le prix sans toucher au périmètre ni à la qualité :`);
ul([
  'La réutilisation des composants d\'interface et des modules déjà développés par E-VOLUTION XP pour SOGUIPREM, qui réduit d\'environ moitié la charge sur EGUITRA Finance, le transport, le BTP et AxisPro Suite.',
  'L\'hébergement de la première année facturé à son coût, sans marge.',
  'Le cadrage et la reprise des données allégés grâce à la qualité des prototypes et du dossier 2026 déjà transmis.',
]);
p(`Ces leviers conduisent à ${gnfHT(P1.total)}. Descendre à ${gnfHT(40000000)} imposerait de retirer des fonctions du périmètre ou de renoncer aux engagements que vous avez demandés par ailleurs, garantie de six mois, sauvegardes renforcées et pénalités de retard, qui ont chacun un coût pour nous. Nous préférons un prix que nous pouvons tenir avec le périmètre complet à un prix qui nous obligerait à le réduire en cours de route.`);
callout(`${gnfHT(P1.total)}, périmètre fonctionnel inchangé, hébergement de la première année compris, garantie de ${HYP.garantieMois} mois, sauvegardes renforcées et pénalités de retard incluses. C'est notre meilleure offre.`);
p('Ce montant est ferme et définitif sous réserve que la commande intervienne pendant la durée de validité de la présente offre et que le périmètre reste celui décrit ici.');

h2('8.2 Détail par poste');
table(
  ['Poste', 'Montant HT', 'Part'],
  [...P1.postes.map(([l, m]) => [l, gnf(m), pct(m, P1.total)]), ['Total, offre révisée', gnf(P1.total), `100${NBSP}%`]],
  [6238, 2200, 1200],
  { lastBold: true },
);
p('Tous les montants sont en francs guinéens, hors taxes. La TVA et les retenues applicables en Guinée sont ajoutées selon la réglementation en vigueur. Aucun coût de licence.');

h2('8.3 Hébergement, maintenance et support à partir de la deuxième année');
p(`La première année d'hébergement est comprise dans le montant ci-dessus. À partir du treizième mois, un forfait annuel unique de ${gnfHT(HYP.maintenanceAn)}, inchangé par rapport à l'offre initiale, couvre :`);
table(
  ['Prestation', 'Détail'],
  [
    ['Hébergement', HYP.vps],
    ['Exploitation', 'Supervision, sauvegardes renforcées du chapitre 6.2, tests de restauration, mises à jour de sécurité, renouvellement des certificats'],
    ['Support', 'Assistance des utilisateurs du lundi au vendredi, de 8 h à 18 h, par messagerie, e-mail et téléphone'],
    ['Maintenance corrective', 'Correction de toute anomalie, sans limite'],
    ['Maintenance évolutive', `${HYP.joursEvolutifsInclusParMois} jours par mois d'évolutions incluses, cumulables sur le trimestre, selon les critères ci-dessous`],
    ['Forfait annuel', `${gnfHT(HYP.maintenanceAn)}, facturé par semestre d'avance`],
  ],
  [2600, 7038],
  { lastBold: true },
);
p('En réponse à votre point 7, une évolution est qualifiée d\'incluse ou de facturable selon les critères suivants :');
table(
  ['Évolution incluse dans le forfait', 'Évolution facturable sur devis'],
  [
    ['Modification ou ajout d\'un champ, d\'une colonne, d\'un filtre ou d\'un tri sur un écran existant', 'Création d\'un nouvel écran ou d\'un nouveau parcours de saisie'],
    ['Ajustement d\'un état, d\'un export ou d\'un rapport existant : colonne, total, mise en page, libellé', 'Création d\'un nouvel état, d\'un nouveau rapport ou d\'un nouveau module'],
    ['Nouvelle règle d\'alerte, nouveau seuil, nouveau contrôle de clôture sur les données existantes', 'Nouvelle intégration avec un système externe : banque, administration, logiciel tiers'],
    ['Ajustement d\'un circuit d\'approbation : niveaux, seuils, approbateurs', 'Nouvelle société, nouvelle activité ou nouveau métier nécessitant un paramétrage complet'],
    ['Création ou modification de profils, de droits, de référentiels, de taux, de paramètres', 'Modification du modèle de données : nouvel objet métier, nouvelle relation'],
    ['Toute demande représentant au plus une journée de travail', 'Toute demande représentant plus d\'une journée de travail'],
  ],
  [4819, 4819],
);
ul([
  `Chaque demande est qualifiée par écrit par ${HYP.prestataire} dans les deux jours ouvrés, avec la charge estimée ; le client valide avant réalisation.`,
  `Les jours inclus non consommés au terme d'un trimestre sont perdus. Au-delà des jours inclus, ou pour une évolution facturable, le tarif applicable est de ${gnfHT(HYP.tjmEvolutions)} par jour, sur devis accepté avant réalisation.`,
  'Une correction d\'anomalie n\'est jamais décomptée de la maintenance évolutive.',
]);
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

h2('8.4 Synthèse financière');
table(
  ['Poste', 'Montant HT'],
  [
    ['Réalisation et hébergement, première année', gnfHT(P1.total)],
    ['Hébergement, maintenance et support, par an à partir de la deuxième année', gnfHT(HYP.maintenanceAn)],
    ['Coût cumulé sur trois ans', gnfHT(P1.total + 2 * HYP.maintenanceAn)],
  ],
  [6438, 3200],
  { boldRows: [0] },
);

h2('8.5 Conditions de paiement');
ul([
  '50 % à la commande, 30 % à la recette en semaine 4, 20 % au procès-verbal de mise en production, déduction faite des pénalités éventuelles.',
  'Forfait annuel d\'hébergement, maintenance et support : par semestre d\'avance, à compter du treizième mois.',
  'Règlement à 30 jours date de facture, par virement bancaire.',
]);

h2('8.6 Engagements contractuels');
ul([
  `Garantie corrective de ${garantieTexte}. Elle couvre toute anomalie de fonctionnement, y compris celles révélées par la clôture annuelle et les déclarations fiscales de fin d'exercice, sans limite d'interventions.`,
  `Pénalités de retard imputables à ${HYP.prestataire} selon le chapitre 7.2.`,
  `Sauvegardes renforcées selon le chapitre 6.2, perte de données maximale de ${HYP.sauvegardeContinueMinutes} minutes.`,
  'Propriété du client sur ses données et sur le code développé pour lui ; les composants génériques d\'E-VOLUTION XP restent réutilisables par E-VOLUTION XP.',
  'Réversibilité complète sur demande, sans frais, dans les formats ouverts décrits au chapitre 6.4.',
  'Confidentialité des données financières et des dossiers des porteurs de projets, y compris après la fin du contrat.',
  `Validité de l'offre : ${validite}.`,
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
    ['Journal de transactions', 'Fichier où la base de données inscrit chaque modification avant de l\'appliquer ; son archivage permet de restaurer la base à un instant précis.'],
  ],
  [2000, 7638],
);
h2('9.2 Signature');
p(`Pour ${HYP.raisonSociale}`);
p(`${HYP.signataire}, ${HYP.qualiteSignataire}`);
p('Signature : ________________');
p(`Pour ${HYP.client} et ${HYP.client2}`);
p('Date : ________________');
p('Signature et cachet : ________________');
p('Mention manuscrite obligatoire : « Lu et approuvé. Bon pour accord »');

// ---------------------------------------------------------------- sortie
(async () => {
  await ecrire(B, {
    titre: 'Offre technique et financière révisée',
    sousTitre: 'Digitalisation du département Finance et de l\'accompagnement des porteurs de projets',
    mentionRevision: `Révision 1 de l'offre ${HYP.referenceInitiale} du ${HYP.dateInitiale}, en réponse à vos observations. Proposition 1 uniquement.`,
    prestataire: HYP.prestataire, slogan: HYP.slogan, contact: HYP.contact,
    client: HYP.client, client2: HYP.client2, dg: HYP.dg,
    reference: HYP.reference, dateOffre: HYP.dateOffre, validiteJours: HYP.validiteJours, logoPath,
  }, __dirname, 'Offre_revisee_R1_EGUITRA');
  console.log(`OK : logo ${logoPath ? path.basename(logoPath) : 'absent'} ; offre révisée ${gnf(P1.total)} ; remise ${gnf(remise)} (${remisePct} %)`);
})();
