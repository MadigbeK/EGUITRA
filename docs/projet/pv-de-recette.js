// Génère PV_de_recette.docx à partir de pv-de-recette.md (source unique du texte).
//   node docs/projet/pv-de-recette.js
// Arrête la génération si la synthèse ne porte plus les nombres de scénarios du cahier de recette
// ou si l'annexe ne liste plus les indicateurs de la validation de la reprise (outils/pv-controles.js).
const fs = require('fs');
const path = require('path');
const { build } = require('../outils/md-docx');
const { controler } = require('../outils/pv-controles');

const markdown = fs.readFileSync(path.join(__dirname, 'pv-de-recette.md'), 'utf8');
controler(markdown, 'pv-de-recette.md');

build({
  markdown,
  out: path.join(__dirname, 'PV_de_recette.docx'),
  title: 'Procès-verbal de recette EGUITRA Finance et AxisPro Suite',
  footer: 'E-VOLUTION XP · Procès-verbal de recette',
}).then((out) => console.log(`Écrit : ${out}`));
