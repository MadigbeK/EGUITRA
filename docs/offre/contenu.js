// Source unique des hypothèses de l'offre technique et financière, révision 1.
// build.js rend le document en .docx et en .md à partir de ce fichier.
// Tous les montants sont en francs guinéens (GNF), hors taxes.
//
// La version envoyée le 15 septembre 2026 est conservée dans envoyes/ (PDF)
// et dans l'historique git (commit « Aligne la source sur la version envoyée »).

const HYP = {
  prestataire: 'E-VOLUTION XP',
  raisonSociale: 'E-volution Experience',
  slogan: 'Transformation Numérique',
  contact: '+224 628 86 22 55 / emkouyate@e-volutionxp.com',
  signataire: 'Madigbè KOUYATÉ',
  qualiteSignataire: 'Gérant',
  client: 'EGUITRA GROUP SARLU',
  client2: 'MB AxisPro Consulting',
  dg: 'M. Mohamed Nimaga, Directeur Général',
  // Offre initiale et révision
  referenceInitiale: 'OTF-EGUITRA-2026-36',
  dateOffreInitiale: '15 septembre 2026',
  reference: 'OTF-EGUITRA-2026-36-R1',
  revision: 1,
  dateOffre: '29 septembre 2026',
  dateOffreISO: '2026-09-29',
  validiteJours: 60,
  dureeSemaines: 4,
  garantieMois: 6,
  vps: 'VPS 4 vCPU, 8 Go de mémoire, 160 Go de disque NVMe, adresse IP dédiée, nom de domaine, stockage de sauvegarde hors site',
  // Logo : docs/offre/logo.png s'il existe, sinon le rendu vectoriel logo-rendu.png
  logoFichiers: ['logo.png', 'logo-rendu.png'],
};

// Sauvegardes : réponse au point 5 du client (perte de données maximale de 24 h jugée excessive).
const SAUVEGARDE = {
  rpoMinutes: 15, // perte de données maximale
  rtoHeuresOuvrees: 4, // délai de reprise
  retentionJournaux: '14 jours', // restauration à un instant donné
  retentionQuotidienne: 30,
  retentionMensuelle: 12,
  disponibilite: '99,5 %',
};

// Pénalités de retard : réponse au point 6 du client.
const PENALITE = {
  tauxJourPct: 0.1, // pourcent du montant HT de la commande par jour calendaire de retard
  plafondPct: 5, // pourcent du montant HT de la commande
};

// Maintenance évolutive : réponse au point 7 du client.
const EVOLUTIONS = {
  joursParMois: 2,
  joursParTrimestre: 6,
  seuilJoursIncluse: 2, // charge maximale d'une évolution incluse
  delaiQualificationJoursOuvres: 2,
  tarifJourHT: 750000, // tarif d'un jour-homme pour les évolutions facturables
};

// Proposition 1 : plateforme intégrée sur noyau Odoo Community, invisible pour l'utilisateur.
// Les postes restent valorisés comme dans l'offre initiale ; l'effort commercial
// ramène le total au montant convenu, pour un périmètre inchangé.
const P1 = {
  code: 'Proposition 1',
  titre: 'Plateforme intégrée EGUITRA Finance et AxisPro Suite sur noyau de gestion',
  total: 50000000,
  maintenanceAn: 9000000, // à partir de la deuxième année, hébergement compris
  postes: [
    ['Cadrage, conception et charte graphique des applications', 6000000],
    ['Socle technique : VPS, installation du noyau et des modules communautaires, sécurité, sauvegardes, supervision', 8000000],
    ['EGUITRA Finance : paramétrage SYSCOHADA, analytique, trésorerie et rapprochement, immobilisations, budget, approbations, états financiers, 18 écrans', 32000000],
    ['Transport pétrolier et BTP : rotations, flotte, rentabilité par camion et par route, application mobile, chantiers, retenues de garantie', 14000000],
    ['Immobilier, fiscalité guinéenne, consolidation groupe, passerelle IFRS', 8000000],
    ['AxisPro Suite : grille de critères, stage gates, scoring, data room, revues de comité, rapports, portail des porteurs', 14000000],
    ['Reprise du dossier 2026, recette, formation, mise en production', 6000000],
    ['Hébergement VPS, nom de domaine et sauvegardes hors site pendant 12 mois', 4000000],
  ],
};
P1.valeurPostes = P1.postes.reduce((s, x) => s + x[1], 0);
P1.effortCommercial = P1.valeurPostes - P1.total;
if (P1.effortCommercial < 0) throw new Error(`${P1.code} : le total (${P1.total}) dépasse la somme des postes (${P1.valeurPostes})`);

// Planning en quatre semaines.
const PLANNING = [
  ['Semaine 1', 'Cadrage et socle', 'Ateliers de cadrage avec la finance, l\'exploitation, les chantiers, l\'immobilier et le cabinet. Charte graphique validée. VPS en ligne, socle installé, comptes utilisateurs créés.', 'Dossier de conception signé, plateforme accessible'],
  ['Semaine 2', 'Finance et AxisPro', 'Paramétrage SYSCOHADA, axes analytiques, trésorerie, immobilisations, budget, approbations. Écrans EGUITRA Finance. Grille AxisPro importée et modèle de scoring en place. Reprise des référentiels et des soldes d\'ouverture.', 'Écrans finance en recette interne'],
  ['Semaine 3', 'Métiers et portail', 'Rotations, flotte, rentabilité, application mobile. Chantiers, retenues de garantie. Biens et baux. Déclarations fiscales. Écrans AxisPro Suite et portail des porteurs. Fin de la reprise des écritures 2026.', 'Périmètre complet livré en recette'],
  ['Semaine 4', 'Recette et mise en production', 'Recette avec vos équipes sur vos données, corrections, formation par profil, mise en production, exercice 2026 consultable et exercice 2027 prêt à l\'ouverture.', 'Procès-verbal de mise en production'],
];

module.exports = { HYP, SAUVEGARDE, PENALITE, EVOLUTIONS, P1, PLANNING };
