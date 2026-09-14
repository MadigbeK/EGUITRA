// Source unique de l'offre technique et financière.
// Ce fichier décrit le contenu ; build.js le rend en .docx et en .md.
// Les montants sont dérivés des hypothèses ci-dessous : modifier TJM ou les
// charges par lot suffit à recalculer toute l'offre.

const HYP = {
  prestataire: '[Nom du prestataire]',
  contact: '[Nom, téléphone, e-mail du contact commercial]',
  client: 'EGUITRA GROUP SARLU',
  client2: 'MB AxisPro Consulting',
  dg: 'M. Mohamed Nimaga, Directeur Général',
  dateOffre: '15 septembre 2026',
  reference: 'OTF-EGUITRA-2026-01',
  validiteJours: 60,
  tjm: 250, // EUR HT par jour-homme, taux mixte
  tauxGNF: 9450, // GNF pour 1 EUR, taux indicatif du dossier au 15/08/2026
  forfaitExploitationMois: 1100, // EUR HT / mois
  hebergementInclus: 'VPS de production 8 vCPU / 32 Go RAM / 400 Go NVMe, VPS de recette, stockage de sauvegarde hors site',
  garantieMois: 3,
};

// Charges par lot, en jours-homme.
const LOTS = [
  {
    code: 'Lot 0',
    titre: 'Cadrage et preuve de concept',
    duree: 'Semaines 1 à 3',
    postes: [
      ['Ateliers de cadrage (finance, transport, BTP, immobilier, AxisPro)', 6],
      ['Instance de démonstration chargée avec le dossier 2026', 5],
      ['Dossier de conception et charte des écrans', 4],
    ],
  },
  {
    code: 'Lot 1',
    titre: 'Socle et application EGUITRA Finance',
    duree: 'Semaines 3 à 18',
    postes: [
      ['Infrastructure VPS, environnements, sauvegardes, supervision', 8],
      ['Paramétrage du noyau : SYSCOHADA, sociétés, devises, journaux, axes analytiques, modules OCA', 25],
      ['Développements noyau : API de la surcouche, règles de gestion, contrôles de clôture, alertes, exports', 20],
      ['Surcouche EGUITRA Finance : 18 écrans web', 55],
      ['États financiers SYSCOHADA et rapport mensuel de gestion', 10],
      ['Reprise du dossier 2026 et validation face au classeur', 8],
      ['Recette, formation, mise en production', 12],
    ],
  },
  {
    code: 'Lot 2',
    titre: 'Transport pétrolier et BTP',
    duree: 'Semaines 16 à 28',
    postes: [
      ['Module rotations, flotte, routes, volumes et taxes spécifiques', 15],
      ['Écrans transport et application mobile de saisie des rotations (hors ligne)', 25],
      ['Module chantiers : situations d\'avancement, retenues de garantie, coûts', 8],
      ['Écrans BTP', 12],
      ['Recette, formation, mise en production', 7],
    ],
  },
  {
    code: 'Lot 3',
    titre: 'Immobilier, fiscalité, consolidation groupe',
    duree: 'Semaines 27 à 36',
    postes: [
      ['Module biens, baux, quittancement, valorisation du patrimoine', 8],
      ['Écrans immobilier', 12],
      ['Déclarations fiscales guinéennes (TVA, retenues, états annuels)', 8],
      ['Consolidation groupe et tableaux de bord multi-sociétés', 8],
      ['Passerelle SYSCOHADA vers IFRS et provisionnement IFRS 9', 6],
      ['Recette, formation, mise en production', 5],
    ],
  },
  {
    code: 'Lot 4',
    titre: 'AxisPro Suite : accompagnement des porteurs de projets',
    duree: 'Semaines 34 à 48',
    postes: [
      ['Modèle de données : grille de critères, gates, knock-outs, politique d\'évaluation, scoring', 12],
      ['Data room, pièces à fournir, portail des porteurs de projets', 12],
      ['Revues de comité, verrouillage, rapports PDF promoteur et comité', 8],
      ['Surcouche AxisPro Suite : 10 écrans web et portail', 30],
      ['Import de la grille de 111 critères et reprise des dossiers en cours', 3],
      ['Recette, formation, mise en production', 6],
    ],
  },
];

const OPTIONS = [
  ['Serveur de secours à Conakry avec réplication de la base', 'Matériel estimé 3 500 EUR + 5 jours', 5, 3500],
  ['Astreinte 7 jours sur 7 pour les incidents bloquants', '400 EUR HT par mois', 0, 0],
  ['Journée de formation complémentaire', 'Au TJM', 1, 0],
  ['Archivage des relevés bancaires par import automatique (selon formats des banques)', '6 jours', 6, 0],
];

module.exports = { HYP, LOTS, OPTIONS };
