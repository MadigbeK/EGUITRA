// Génère Questionnaire_parametrage_finance.docx à partir de questionnaire-finance.md (lui-même produit par questionnaire-finance.py).
//   python docs/projet/questionnaire-finance.py && node docs/projet/questionnaire-finance.js
const fs = require('fs');
const path = require('path');
const { build } = require('../outils/md-docx');

build({
  markdown: fs.readFileSync(path.join(__dirname, 'questionnaire-finance.md'), 'utf8'),
  out: path.join(__dirname, 'Questionnaire_parametrage_finance.docx'),
  title: 'Questionnaire de paramétrage : finance et comptabilité',
  footer: 'E-VOLUTION XP · Questionnaire de paramétrage finance',
}).then((out) => console.log(`Écrit : ${out}`));
