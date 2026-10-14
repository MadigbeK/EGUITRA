// Génère Plan_de_bascule.docx à partir de plan-de-bascule.md (source unique du texte).
//   node docs/projet/plan-de-bascule.js
const fs = require('fs');
const path = require('path');
const { build } = require('../outils/md-docx');

build({
  markdown: fs.readFileSync(path.join(__dirname, 'plan-de-bascule.md'), 'utf8'),
  out: path.join(__dirname, 'Plan_de_bascule.docx'),
  title: 'Plan de mise en production EGUITRA Finance et AxisPro Suite',
  footer: 'E-VOLUTION XP · Plan de mise en production',
}).then((out) => console.log(`Écrit : ${out}`));
