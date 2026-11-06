// Génère Avenant_offre.docx à partir de avenant-offre.md (source unique du texte).
//   node docs/projet/avenant-offre.js
const fs = require('fs');
const path = require('path');
const { build } = require('../outils/md-docx');

build({
  markdown: fs.readFileSync(path.join(__dirname, 'avenant-offre.md'), 'utf8'),
  out: path.join(__dirname, 'Avenant_offre.docx'),
  title: 'Avenant n° 1 à l\'offre OTF-EGUITRA-2026-37',
  footer: 'E-VOLUTION XP · Avenant à l\'offre · Projet',
}).then((out) => console.log(`Écrit : ${out}`));
