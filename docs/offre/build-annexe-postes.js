// Génère docs/offre/Annexe_detail_par_poste_EGUITRA.docx et .md
// Annexe d'une page : répartition du montant par poste, dans la présentation de l'offre initiale.
// Usage : node docs/offre/build-annexe-postes.js
const path = require('path');
const { HYP, P1 } = require('./contenu-v2');
const { P1: INITIAL } = require('./contenu');
const { blocs, ecrire, trouverLogo, gnf, gnfHT, pct, NBSP } = require('./rendu');

const logoPath = trouverLogo(__dirname, HYP.logoFichiers);
const { B, h1, p, table, ul } = blocs();

// Les huit postes sont les mêmes dans les deux offres, dans le même ordre.
if (INITIAL.postes.length !== P1.postes.length) throw new Error('Les deux offres n\'ont pas le même nombre de postes');

h1('Détail du montant par poste');
p(`À la demande d'EGUITRA GROUP SARLU, le présent document détaille la répartition du montant de l'offre ${HYP.reference}, soit ${gnfHT(P1.total)}, selon les huit postes de l'offre initiale du 15 septembre 2026. Le périmètre fonctionnel de chaque poste est inchangé.`);
table(
  ['Poste', 'Offre initiale', 'Offre en vigueur', 'Part'],
  [
    ...P1.postes.map(([l, m], i) => [l, gnf(INITIAL.postes[i][1]), gnf(m), pct(m, P1.total)]),
    ['Total', gnf(INITIAL.total), gnf(P1.total), `100${NBSP}%`],
  ],
  [4838, 1700, 1800, 1300],
  { lastBold: true },
);
p('Ce qui rend cette répartition possible, poste par poste :');
ul([
  'Cadrage et conception : les prototypes de la direction tiennent lieu de spécification, les ateliers se limitent aux arbitrages.',
  'Socle technique : installation industrialisée, déjà éprouvée sur nos déploiements précédents.',
  'EGUITRA Finance, transport, BTP, immobilier et AxisPro Suite : réutilisation des composants d\'interface et des modules développés par E-VOLUTION XP pour SOGUIPREM ; seule l\'adaptation à vos règles et à votre charte est facturée.',
  'Reprise des données, recette et formation : charge réduite grâce à des fichiers de gestion déjà structurés et à une formation par profil regroupée en semaine 4.',
  'Hébergement de la première année : facturé à son coût, sans marge.',
]);
p(`Montants en francs guinéens, hors taxes. La garantie corrective de ${HYP.garantieMois} mois, les sauvegardes renforcées et l'engagement de délai avec pénalités sont compris dans le total, sans poste distinct.`);

(async () => {
  await ecrire(B, {
    titre: 'Annexe : détail du montant par poste',
    sousTitre: `Offre technique et financière ${HYP.reference}`,
    prestataire: HYP.prestataire, slogan: HYP.slogan, contact: HYP.contact,
    client: HYP.client, client2: HYP.client2, dg: HYP.dg,
    reference: HYP.reference, dateOffre: '7 octobre 2026', validiteJours: HYP.validiteJours, logoPath,
  }, __dirname, 'Annexe_detail_par_poste_EGUITRA');
  console.log(`OK : annexe, total ${gnf(P1.total)}`);
})();
