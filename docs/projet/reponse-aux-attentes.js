// Génère Reponse_aux_attentes.docx à partir de reponse-aux-attentes.md (source unique du texte).
//   node docs/projet/reponse-aux-attentes.js
const fs = require('fs');
const path = require('path');
const { build } = require('../outils/md-docx');

build({
  markdown: fs.readFileSync(path.join(__dirname, 'reponse-aux-attentes.md'), 'utf8'),
  out: path.join(__dirname, 'Reponse_aux_attentes.docx'),
  title: 'Réponse aux vingt attentes du département Finance',
  footer: 'E-VOLUTION XP · Réponse aux attentes du département Finance',
}).then((out) => console.log(`Écrit : ${out}`));
