// Génère Compte_rendu_comite_de_pilotage.docx à partir de compte-rendu-comite-de-pilotage.md
// (source unique du texte).
//   node docs/projet/compte-rendu-comite-de-pilotage.js
const fs = require('fs');
const path = require('path');
const { build } = require('../outils/md-docx');

build({
  markdown: fs.readFileSync(path.join(__dirname, 'compte-rendu-comite-de-pilotage.md'), 'utf8'),
  out: path.join(__dirname, 'Compte_rendu_comite_de_pilotage.docx'),
  title: 'Compte rendu du comité de pilotage EGUITRA Finance et AxisPro Suite',
  footer: 'E-VOLUTION XP · Compte rendu du comité de pilotage',
}).then((out) => console.log(`Écrit : ${out}`));
