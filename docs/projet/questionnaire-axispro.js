// Génère Questionnaire_parametrage_axispro.docx à partir de questionnaire-axispro.md (lui-même produit par questionnaire-axispro.py).
//   python docs/projet/questionnaire-axispro.py && node docs/projet/questionnaire-axispro.js
const fs = require('fs');
const path = require('path');
const { build } = require('../outils/md-docx');

build({
  markdown: fs.readFileSync(path.join(__dirname, 'questionnaire-axispro.md'), 'utf8'),
  out: path.join(__dirname, 'Questionnaire_parametrage_axispro.docx'),
  title: 'Questionnaire de paramétrage : AxisPro',
  footer: 'E-VOLUTION XP · Questionnaire de paramétrage AxisPro',
}).then((out) => console.log(`Écrit : ${out}`));
