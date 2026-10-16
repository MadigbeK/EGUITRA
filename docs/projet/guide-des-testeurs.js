// Génère Guide_des_testeurs.docx à partir de guide-des-testeurs.md.
//   node docs/projet/guide-des-testeurs.js
const fs = require('fs');
const path = require('path');
const { build } = require('../outils/md-docx');

build({
  markdown: fs.readFileSync(path.join(__dirname, 'guide-des-testeurs.md'), 'utf8'),
  out: path.join(__dirname, 'Guide_des_testeurs.docx'),
  title: 'Guide des testeurs de la plateforme NIMOVA',
  footer: 'E-VOLUTION XP · Guide des testeurs (recette)',
}).then((out) => console.log(`Écrit : ${out}`));
