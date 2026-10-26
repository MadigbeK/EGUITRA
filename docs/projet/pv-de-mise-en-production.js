// Génère PV_de_mise_en_production.docx à partir de pv-de-mise-en-production.md (source unique du texte).
//   node docs/projet/pv-de-mise-en-production.js
// Arrête la génération si la synthèse ne porte plus les nombres de scénarios du cahier de recette
// ou si l'annexe ne liste plus les indicateurs de la validation de la reprise (outils/pv-controles.js).
const fs = require('fs');
const path = require('path');
const { build } = require('../outils/md-docx');
const { controler } = require('../outils/pv-controles');

const markdown = fs.readFileSync(path.join(__dirname, 'pv-de-mise-en-production.md'), 'utf8');
controler(markdown, 'pv-de-mise-en-production.md');

build({
  markdown,
  out: path.join(__dirname, 'PV_de_mise_en_production.docx'),
  title: 'Procès-verbal de mise en production EGUITRA Finance et AxisPro Suite',
  footer: 'E-VOLUTION XP · Procès-verbal de mise en production',
}).then((out) => console.log(`Écrit : ${out}`));
