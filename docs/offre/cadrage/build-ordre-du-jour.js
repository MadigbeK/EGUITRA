// Génère docs/offre/cadrage/Ordre_du_jour_cadrage_EGUITRA.docx et .md
// Ordre du jour d'une page, à envoyer au client avant la réunion.
// Usage : node docs/offre/cadrage/build-ordre-du-jour.js
const path = require('path');
const { HYP } = require('../contenu-v2');
const { blocs, ecrire, trouverLogo } = require('../rendu');

const logoPath = trouverLogo(path.join(__dirname, '..'), HYP.logoFichiers);
const { B, h1, h2, p, ul, table } = blocs();

h1('Réunion de cadrage, ordre du jour');
p('Projet : EGUITRA Finance et AxisPro Suite, offre OTF-EGUITRA-2026-37. Mardi 13 octobre 2026, de 10 h à 12 h, dans les locaux d\'EGUITRA GROUP SARLU.');
p('Objectif : arrêter ensemble les règles de gestion, les référents et les éléments nécessaires au démarrage, pour une mise en production le vendredi 6 novembre 2026.');
table(
  ['Heure', 'Séquence', 'Durée'],
  [
    ['10 h 00', 'Ouverture, objectifs de la réunion, règles de travail', '10 min'],
    ['10 h 10', 'La plateforme, le planning en quatre semaines, l\'organisation du projet', '20 min'],
    ['10 h 30', 'Finance : plan de comptes, axes analytiques, circuits d\'approbation, seuils d\'alerte, clôture, états financiers', '35 min'],
    ['11 h 05', 'AxisPro Suite : grille d\'évaluation, stage gates, data room, portail des porteurs', '15 min'],
    ['11 h 20', 'Technique et charte : nom de domaine, logos, utilisateurs et profils, relevés bancaires, expert-comptable', '15 min'],
    ['11 h 35', 'Décisions, désignation des référents, éléments à remettre, prochaines étapes', '20 min'],
    ['11 h 55', 'Clôture', '5 min'],
  ],
  [1200, 7038, 1400],
);
h2('Participants souhaités');
ul([
  'M. Mohamed Nimaga, Directeur Général, pour l\'ouverture et les décisions.',
  'Le responsable du département Finance.',
  'Le Directeur Général Adjoint, auteur des prototypes.',
  'Un référent pour le cabinet MB AxisPro.',
  'Les référents transport, chantiers et immobilier, à l\'ouverture si possible : leurs ateliers de trente minutes se tiendront dans la semaine, le mercredi 14 ou le jeudi 15 octobre.',
  'Pour E-VOLUTION XP : Madigbè KOUYATÉ, directeur de projet, et le consultant finance.',
]);
h2('À apporter si possible');
ul([
  'Le plan de comptes actuel et les modèles d\'états financiers.',
  'Les logos d\'EGUITRA GROUP et de MB AxisPro, et la charte graphique si elle existe.',
  'La liste des utilisateurs pressentis, avec leur fonction.',
  'La grille d\'évaluation AxisPro de référence.',
]);
p(`Contact : ${HYP.contact}`);

(async () => {
  await ecrire(B, {
    titre: 'Ordre du jour',
    sousTitre: 'Réunion de cadrage du mardi 13 octobre 2026',
    prestataire: HYP.prestataire, slogan: HYP.slogan, contact: HYP.contact,
    client: HYP.client, client2: HYP.client2, dg: HYP.dg,
    reference: HYP.reference, dateOffre: '9 octobre 2026', validiteJours: 0, logoPath,
  }, __dirname, 'Ordre_du_jour_cadrage_EGUITRA');
  console.log('OK : ordre du jour');
})();
