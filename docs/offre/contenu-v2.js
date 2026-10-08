// Hypothèses de l'offre finale (proposition unique : plateforme intégrée sur noyau de gestion).
// Aucune donnée chiffrée du dossier JSON de test n'est utilisée.
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
  reference: 'OTF-EGUITRA-2026-37',
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

const P1 = {
  total: 50000000,
  postes: [
    ['Cadrage, conception et charte graphique des applications', 1500000],
    ['Serveur VPS : acquisition et configuration complète (système, conteneurs, proxy TLS, base de données, supervision, sauvegardes renforcées)', 5000000],
    ['Nom de domaine et certificats TLS', 0],
    ['Installation et paramétrage du noyau et des modules communautaires : plan SYSCOHADA, sociétés, devises, journaux, axes analytiques', 5000000],
    ['Module EGUITRA Finance : API métier, règles de gestion, contrôles de clôture, alertes, états financiers, 18 écrans', 14000000],
    ['Module transport pétrolier : rotations, flotte, routes et tarifs, rentabilité par camion et par route, application mobile', 6000000],
    ['Module BTP : chantiers, situations d\'avancement, retenues de garantie', 3000000],
    ['Module immobilier : biens, baux, quittancement, patrimoine', 2500000],
    ['Module fiscalité guinéenne, consolidation groupe et passerelle IFRS', 2500000],
    ['Module AxisPro Suite : grille de critères, stage gates, scoring, data room, revues de comité, rapports, portail des porteurs', 7000000],
    ['Reprise des données de l\'exercice en cours', 1000000],
    ['Recette, formation par profil, mise en production', 1500000],
    ['Hébergement VPS et sauvegardes hors site pendant 12 mois', 1000000],
  ],
};
{
  const somme = P1.postes.reduce((s, x) => s + x[1], 0);
  if (somme !== P1.total) throw new Error(`Offre : la somme des postes (${somme}) diffère du total (${P1.total})`);
}

// Planning en quatre semaines.
const PLANNING = [
  ['Semaine 1', 'Cadrage et socle', 'Ateliers de cadrage avec la finance, l\'exploitation, les chantiers, l\'immobilier et le cabinet. Charte graphique validée. VPS en ligne, socle installé, comptes utilisateurs créés.', 'Dossier de conception signé, plateforme accessible'],
  ['Semaine 2', 'Finance et AxisPro', 'Paramétrage SYSCOHADA, axes analytiques, trésorerie, immobilisations, budget, approbations. Écrans EGUITRA Finance. Grille AxisPro importée et modèle de scoring en place. Reprise des référentiels et des soldes d\'ouverture.', 'Écrans finance en recette interne'],
  ['Semaine 3', 'Métiers et portail', 'Rotations, flotte, rentabilité, application mobile. Chantiers, retenues de garantie. Biens et baux. Déclarations fiscales. Écrans AxisPro Suite et portail des porteurs. Fin de la reprise des écritures de l\'exercice en cours.', 'Périmètre complet livré en recette'],
  ['Semaine 4', 'Recette et mise en production', 'Recette avec vos équipes sur vos données, corrections, formation par profil, mise en production, exercice en cours consultable et exercice suivant prêt à l\'ouverture.', 'Procès-verbal de mise en production'],
];

module.exports = { HYP, P1, PLANNING };
