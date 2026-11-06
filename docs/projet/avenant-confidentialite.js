// Génère Avenant_confidentialite.docx à partir de avenant-confidentialite.md (source unique du texte).
//   node docs/projet/avenant-confidentialite.js
const fs = require('fs');
const path = require('path');
const { build } = require('../outils/md-docx');

build({
  markdown: fs.readFileSync(path.join(__dirname, 'avenant-confidentialite.md'), 'utf8'),
  out: path.join(__dirname, 'Avenant_confidentialite.docx'),
  title: 'Avenant n° 1 à l\'accord de confidentialité réciproque',
  footer: 'E-VOLUTION XP · Avenant à l\'accord de confidentialité · Projet',
}).then((out) => console.log(`Écrit : ${out}`));
