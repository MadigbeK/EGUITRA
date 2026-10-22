// Génère Questionnaire_parametrage_transport.docx à partir de questionnaire-transport.md (lui-même produit par questionnaire-transport.py).
//   python docs/projet/questionnaire-transport.py && node docs/projet/questionnaire-transport.js
const fs = require('fs');
const path = require('path');
const { build } = require('../outils/md-docx');

build({
  markdown: fs.readFileSync(path.join(__dirname, 'questionnaire-transport.md'), 'utf8'),
  out: path.join(__dirname, 'Questionnaire_parametrage_transport.docx'),
  title: 'Questionnaire de paramétrage : transport',
  footer: 'E-VOLUTION XP · Questionnaire de paramétrage transport',
}).then((out) => console.log(`Écrit : ${out}`));
