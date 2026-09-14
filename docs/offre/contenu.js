// Source unique des hypothèses de l'offre technique et financière.
// build.js rend le document en .docx et en .md à partir de ce fichier.
// Tous les montants sont en francs guinéens (GNF), hors taxes.

const HYP = {
  prestataire: 'E-VOLUTION XP',
  slogan: 'Transformation Numérique',
  contact: '[Téléphone et e-mail E-VOLUTION XP]',
  client: 'EGUITRA GROUP SARLU',
  client2: 'MB AxisPro Consulting',
  dg: 'M. Mohamed Nimaga, Directeur Général',
  dateOffre: '15 septembre 2026',
  reference: 'OTF-EGUITRA-2026-01',
  validiteJours: 60,
  dureeSemaines: 4,
  garantieMois: 3,
  vps: 'VPS 4 vCPU, 8 Go de mémoire, 160 Go de disque NVMe, adresse IP dédiée, nom de domaine, stockage de sauvegarde hors site',
  // Logo : docs/offre/logo.png s'il existe, sinon le rendu vectoriel logo-rendu.png
  logoFichiers: ['logo.png', 'logo-rendu.png'],
};

// Proposition 1 : plateforme intégrée sur noyau Odoo Community, invisible pour l'utilisateur.
const P1 = {
  code: 'Proposition 1',
  titre: 'Plateforme intégrée EGUITRA Finance et AxisPro Suite sur noyau de gestion',
  total: 92000000,
  maintenanceAn: 18000000, // à partir de la deuxième année, hébergement compris
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

// Proposition 2 : deux applications indépendantes, développées de zéro, sur le même VPS.
const P2 = {
  code: 'Proposition 2',
  titre: 'Deux applications indépendantes, EGUITRA Finance et AxisPro Suite, sur un VPS commun',
  total: 80000000,
  maintenanceAn: 15000000,
  postes: [
    ['Cadrage, conception et charte graphique des applications', 5000000],
    ['Socle technique commun : VPS, base de données, authentification, sauvegardes, supervision', 7000000],
    ['Application EGUITRA Finance : moteur comptable SYSCOHADA, ventes, achats, trésorerie, immobilisations, budget, clôtures, états, rotations transport, chantiers, gestion locative', 42000000],
    ['Application AxisPro Suite : grille de critères, stage gates, scoring, data room, revues de comité, rapports, portail des porteurs', 18000000],
    ['Reprise du dossier 2026, recette, formation, mise en production', 4000000],
    ['Hébergement VPS, nom de domaine et sauvegardes hors site pendant 12 mois', 4000000],
  ],
};

for (const p of [P1, P2]) {
  const somme = p.postes.reduce((s, x) => s + x[1], 0);
  if (somme !== p.total) throw new Error(`${p.code} : la somme des postes (${somme}) diffère du total (${p.total})`);
}

// Planning commun aux deux propositions, en quatre semaines.
const PLANNING = [
  ['Semaine 1', 'Cadrage et socle', 'Ateliers de cadrage avec la finance, l\'exploitation, les chantiers, l\'immobilier et le cabinet. Charte graphique validée. VPS en ligne, socle installé, comptes utilisateurs créés.', 'Dossier de conception signé, plateforme accessible'],
  ['Semaine 2', 'Finance et AxisPro', 'Paramétrage SYSCOHADA, axes analytiques, trésorerie, immobilisations, budget, approbations. Écrans EGUITRA Finance. Grille AxisPro importée et modèle de scoring en place. Reprise des référentiels et des soldes d\'ouverture.', 'Écrans finance en recette interne'],
  ['Semaine 3', 'Métiers et portail', 'Rotations, flotte, rentabilité, application mobile. Chantiers, retenues de garantie. Biens et baux. Déclarations fiscales. Écrans AxisPro Suite et portail des porteurs. Fin de la reprise des écritures 2026.', 'Périmètre complet livré en recette'],
  ['Semaine 4', 'Recette et mise en production', 'Recette avec vos équipes sur vos données, corrections, formation par profil, mise en production, exercice 2026 consultable et exercice 2027 prêt à l\'ouverture.', 'Procès-verbal de mise en production'],
];

module.exports = { HYP, P1, P2, PLANNING };
