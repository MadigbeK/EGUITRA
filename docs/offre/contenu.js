// Hypothèses de l'offre technique et financière du 29 septembre 2026.
// build.js rend le document en .docx et en .md à partir de ce fichier.
// Tous les montants sont en francs guinéens (GNF), hors taxes.

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
  reference: 'OTF-EGUITRA-2026-37',
  dateOffre: '29 septembre 2026',
  dateOffreISO: '2026-09-29',
  dateOffrePrecedente: '15 septembre 2026', // offre annulée et remplacée par la présente
  validiteJours: 30,
  dureeSemaines: 4,
  accompagnementSemaines: 4,
  garantieMois: 6,
  vps: 'VPS 4 vCPU, 8 Go de mémoire, 160 Go de disque NVMe, adresse IP dédiée, nom de domaine, stockage de sauvegarde hors site',
  // Logo : docs/offre/logo.png s'il existe, sinon le rendu vectoriel logo-rendu.png
  logoFichiers: ['logo.png', 'logo-rendu.png'],
};

const SAUVEGARDE = {
  rpoMinutes: 15, // perte de données maximale
  rtoHeuresOuvrees: 4, // délai de reprise
  retentionJournaux: '14 jours', // restauration à un instant donné
  retentionQuotidienne: 30,
  retentionMensuelle: 12,
  disponibilite: '99,5 %',
};

const PENALITE = {
  tauxJourPct: 0.1, // pourcent du montant HT par jour calendaire de retard imputable au prestataire
  plafondPct: 5,
};

const EVOLUTIONS = {
  joursParMois: 2,
  joursParTrimestre: 6,
  seuilJoursIncluse: 2,
  delaiQualificationJoursOuvres: 2,
  tarifJourHT: 750000,
};

const OFFRE = {
  total: 50000000,
  maintenanceAn: 9000000, // hébergement, exploitation, support et maintenance, à partir de la deuxième année
  postes: [
    ['Cadrage, conception des parcours utilisateurs et charte graphique', 3000000],
    ['Socle technique et hébergement de la première année : VPS, noyau de gestion, sécurité, sauvegardes, supervision', 8000000],
    ['EGUITRA Finance : comptabilité SYSCOHADA, analytique, trésorerie, immobilisations, budget, approbations, clôtures et états', 17000000],
    ['Modules métier : transport pétrolier et application mobile, chantiers, immobilier, fiscalité, consolidation et passerelle IFRS', 11500000],
    ['AxisPro Suite et portail des porteurs de projets', 7500000],
    ['Reprise de l\'exercice 2026, recette, formation et mise en production', 3000000],
  ],
};
{
  const somme = OFFRE.postes.reduce((s, x) => s + x[1], 0);
  if (somme !== OFFRE.total) throw new Error(`La somme des postes (${somme}) diffère du total (${OFFRE.total})`);
}

const PLANNING = [
  ['Semaine 1', 'Cadrage et socle', 'Ateliers avec la direction, la finance, l\'exploitation transport, les chantiers, l\'immobilier et le cabinet. Validation des parcours et de la charte graphique. Serveur en ligne, noyau installé, comptes créés.', 'Dossier de conception signé, plateforme accessible en recette'],
  ['Semaine 2', 'Cœur financier', 'Plan de comptes SYSCOHADA, axes analytiques, comptes de trésorerie, immobilisations, budget, circuits d\'approbation. Écrans EGUITRA Finance. Grille AxisPro chargée, moteur de scoring en place. Reprise des référentiels et des soldes d\'ouverture.', 'Écrans financiers en recette interne'],
  ['Semaine 3', 'Modules métier et portail', 'Rotations, flotte, rentabilité, application mobile. Chantiers et retenues de garantie. Biens, baux, loyers. Déclarations fiscales. Écrans AxisPro Suite et portail des porteurs. Reprise des écritures 2026 achevée.', 'Périmètre complet livré en recette'],
  ['Semaine 4', 'Recette et mise en production', 'Recette avec vos équipes sur vos données, corrections, formation par profil, bascule en production. Exercice 2026 consultable, exercice 2027 prêt à l\'ouverture.', 'Procès-verbal de mise en production'],
];

module.exports = { HYP, SAUVEGARDE, PENALITE, EVOLUTIONS, OFFRE, PLANNING };
