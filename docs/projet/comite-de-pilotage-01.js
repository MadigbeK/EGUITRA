// Génère Comite_de_pilotage_01.docx à partir de comite-de-pilotage-01.md (source unique du texte).
//   node docs/projet/comite-de-pilotage-01.js
const fs = require('fs');
const path = require('path');
const { build } = require('../outils/md-docx');

build({
  markdown: fs.readFileSync(path.join(__dirname, 'comite-de-pilotage-01.md'), 'utf8'),
  out: path.join(__dirname, 'Comite_de_pilotage_01.docx'),
  title: 'Comité de pilotage n° 1, EGUITRA Finance et AxisPro Suite',
  footer: 'E-VOLUTION XP · Comité de pilotage n° 1 · Projet',
}).then((out) => console.log(`Écrit : ${out}`));
