// Génère docs/offre/Annexe_detail_par_poste_EGUITRA.docx et .md
// Annexe d'une page : répartition du montant par poste, dans la présentation de l'offre initiale.
// Usage : node docs/offre/build-annexe-postes.js
const path = require('path');
const { HYP, P1 } = require('./contenu-v2');
const { blocs, ecrire, trouverLogo, gnf, gnfHT, pct, NBSP } = require('./rendu');

const logoPath = trouverLogo(__dirname, HYP.logoFichiers);
const { B, h1, p, table, ul } = blocs();

h1('Détail du montant par poste');
p(`À la demande d'EGUITRA GROUP SARLU, le présent document détaille la répartition du montant de l'offre ${HYP.reference}, soit ${gnfHT(P1.total)}, dans la présentation par poste de l'offre initiale du 15 septembre 2026. Le périmètre fonctionnel est inchangé ; la ventilation distingue le serveur, le paramétrage du noyau et chacun des modules développés.`);
table(
  ['Poste', 'Montant HT', 'Part'],
  [
    ...P1.postes.map(([l, m]) => [l, gnf(m), pct(m, P1.total)]),
    ['Total', gnf(P1.total), `100${NBSP}%`],
  ],
  [6238, 2200, 1200],
  { lastBold: true },
);
p('Lecture de la répartition :');
ul([
  'Les postes techniques, serveur, paramétrage du noyau et développement des modules, représentent 90 % du montant.',
  'Le nom de domaine et les certificats sont offerts. Si le groupe dispose déjà d\'un nom de domaine, il est utilisé tel quel.',
  'Le cadrage, la reprise des données, la recette et la formation sont réduits au strict nécessaire grâce aux prototypes de la direction et à des fichiers de gestion déjà structurés.',
  'L\'hébergement de la première année est facturé à son coût, sans marge.',
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
