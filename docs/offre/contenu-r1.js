// Hypothèses de l'offre révisée (révision 1), limitée à la proposition 1,
// établie en réponse aux observations du client sur l'offre du 15 septembre 2026.
// Tous les montants sont en francs guinéens (GNF), hors taxes.

const HYP = {
  prestataire: 'E-VOLUTION XP',
  raisonSociale: 'E-volution Experience',
  signataire: 'Madigbè KOUYATÉ',
  qualiteSignataire: 'Gérant',
  slogan: 'Transformation Numérique',
  contact: '+224 628 86 22 55 / emkouyate@e-volutionxp.com',
  client: 'EGUITRA GROUP SARLU',
  client2: 'MB AxisPro Consulting',
  dg: 'M. Mohamed Nimaga, Directeur Général',
  referenceInitiale: 'OTF-EGUITRA-2026-36',
  dateInitiale: '15 septembre 2026',
  reference: 'OTF-EGUITRA-2026-36-R1',
  dateOffre: '30 septembre 2026',
  validiteJours: 30, // une seule valeur, reprise partout dans le document
  dureeSemaines: 4,
  garantieMois: 6, // couvre la première clôture annuelle
  vps: 'VPS 4 vCPU, 8 Go de mémoire, 160 Go de disque NVMe, adresse IP dédiée, nom de domaine, stockage de sauvegarde hors site',
  // Sauvegardes renforcées, sans supplément
  sauvegardeContinueMinutes: 15,
  // Pénalités de retard
  penaliteParJourPct: 0.5, // % du montant HT par jour ouvré de retard imputable au prestataire
  penalitePlafondPct: 10, // % du montant HT
  // Maintenance à partir de la deuxième année
  maintenanceAn: 9000000,
  joursEvolutifsInclusParMois: 2,
  tjmEvolutions: 800000, // GNF HT par jour au-delà du forfait
  logoFichiers: ['logo.png', 'logo-rendu.png'],
};

// Montant initial de la proposition 1 et montant révisé.
const P1 = {
  totalInitial: 92000000,
  total: 50000000,
  postes: [
    ['Cadrage, conception et charte graphique des applications', 3000000],
    ['Socle technique : VPS, installation du noyau et des modules communautaires, sécurité, sauvegardes, supervision', 4000000],
    ['EGUITRA Finance : paramétrage SYSCOHADA, analytique, trésorerie et rapprochement, immobilisations, budget, approbations, états financiers, 18 écrans', 17000000],
    ['Transport pétrolier et BTP : rotations, flotte, rentabilité par camion et par route, application mobile, chantiers, retenues de garantie', 8000000],
    ['Immobilier, fiscalité guinéenne, consolidation groupe, passerelle IFRS', 4000000],
    ['AxisPro Suite : grille de critères, stage gates, scoring, data room, revues de comité, rapports, portail des porteurs', 8000000],
    ['Reprise du dossier 2026, recette, formation, mise en production', 3000000],
    ['Hébergement VPS, nom de domaine et sauvegardes hors site pendant 12 mois', 3000000],
  ],
};
{
  const somme = P1.postes.reduce((s, x) => s + x[1], 0);
  if (somme !== P1.total) throw new Error(`Proposition 1 révisée : la somme des postes (${somme}) diffère du total (${P1.total})`);
}

// Planning en quatre semaines, inchangé.
const PLANNING = [
  ['Semaine 1', 'Cadrage et socle', 'Ateliers de cadrage avec la finance, l\'exploitation, les chantiers, l\'immobilier et le cabinet. Charte graphique validée. VPS en ligne, socle installé, comptes utilisateurs créés.', 'Dossier de conception signé, plateforme accessible'],
  ['Semaine 2', 'Finance et AxisPro', 'Paramétrage SYSCOHADA, axes analytiques, trésorerie, immobilisations, budget, approbations. Écrans EGUITRA Finance. Grille AxisPro importée et modèle de scoring en place. Reprise des référentiels et des soldes d\'ouverture.', 'Écrans finance en recette interne'],
  ['Semaine 3', 'Métiers et portail', 'Rotations, flotte, rentabilité, application mobile. Chantiers, retenues de garantie. Biens et baux. Déclarations fiscales. Écrans AxisPro Suite et portail des porteurs. Fin de la reprise des écritures 2026.', 'Périmètre complet livré en recette'],
  ['Semaine 4', 'Recette et mise en production', 'Recette avec vos équipes sur vos données, corrections, formation par profil, mise en production, exercice 2026 consultable et exercice 2027 prêt à l\'ouverture.', 'Procès-verbal de mise en production'],
];

module.exports = { HYP, P1, PLANNING };
