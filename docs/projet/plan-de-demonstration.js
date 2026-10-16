// Génère Plan_de_demonstration.docx à partir de plan-de-demonstration.md.
//   node docs/projet/plan-de-demonstration.js
const fs = require('fs');
const path = require('path');
const { build } = require('../outils/md-docx');

build({
  markdown: fs.readFileSync(path.join(__dirname, 'plan-de-demonstration.md'), 'utf8'),
  out: path.join(__dirname, 'Plan_de_demonstration.docx'),
  title: 'Plan de démonstration de la plateforme',
  footer: 'E-VOLUTION XP · Plan de démonstration, 16 octobre 2026',
}).then((out) => console.log(`Écrit : ${out}`));
