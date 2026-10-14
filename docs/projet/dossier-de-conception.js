// Génère Dossier_de_conception.docx à partir de dossier-de-conception.md (source unique du texte).
//   node docs/projet/dossier-de-conception.js
const fs = require('fs');
const path = require('path');
const { build } = require('../outils/md-docx');

build({
  markdown: fs.readFileSync(path.join(__dirname, 'dossier-de-conception.md'), 'utf8'),
  out: path.join(__dirname, 'Dossier_de_conception.docx'),
  title: 'Dossier de conception EGUITRA Finance et AxisPro Suite',
  footer: 'E-VOLUTION XP · Dossier de conception EGUITRA Finance et AxisPro Suite',
}).then((out) => console.log(`Écrit : ${out}`));
