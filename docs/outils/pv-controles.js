// Contrôles des procès-verbaux de recette et de mise en production avant génération :
// - la synthèse porte, par attente, le nombre de scénarios du cahier de recette
//   (docs/projet/cahier-de-recette.py, source unique des scénarios) ;
// - l'annexe de la reprise liste, dans l'ordre, les indicateurs recalculés par la plateforme
//   (addons/eguitra_finance/models/reprise_reference.py, INDICATORS).
// Un écart arrête la génération : le Markdown du procès-verbal est à mettre à jour.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CAHIER = path.join(ROOT, 'docs', 'projet', 'cahier-de-recette.py');
const REPRISE = path.join(ROOT, 'addons', 'eguitra_finance', 'models', 'reprise_reference.py');

function bloc(text, start, file) {
  const i = text.indexOf(start);
  const j = i < 0 ? -1 : text.indexOf('\n]\n', i);
  if (j < 0) throw new Error(`${start} introuvable dans ${file}`);
  return text.slice(i, j);
}

/** Nombre de scénarios par code d'attente ({ '1': 4, …, AX: 14 }). */
function scenariosParAttente() {
  const counts = {};
  for (const m of bloc(fs.readFileSync(CAHIER, 'utf8'), 'SCENARIOS = [', CAHIER).matchAll(/^\s*\("[A-Z]\d+",\s*"([^"]+)"/gm)) {
    counts[m[1]] = (counts[m[1]] || 0) + 1;
  }
  return counts;
}

/** Libellés des indicateurs de la validation de la reprise, dans l'ordre de la plateforme. */
function indicateursReprise() {
  return [...bloc(fs.readFileSync(REPRISE, 'utf8'), 'INDICATORS = [', REPRISE).matchAll(/\("\w+",\s*"([^"]+)",\s*"\w+"\)/g)].map((m) => m[1]);
}

function controler(markdown, name) {
  const errors = [];
  const expected = scenariosParAttente();
  const found = {};
  for (const m of markdown.matchAll(/^\| (\d+|AX) \| [^|\n]+ \| (\d+) \|/gm)) found[m[1]] = Number(m[2]);
  for (const code of new Set([...Object.keys(expected), ...Object.keys(found)])) {
    if ((expected[code] || 0) !== (found[code] || 0)) {
      errors.push(`attente ${code} : ${found[code] || 0} scénarios dans ${name}, ${expected[code] || 0} dans le cahier`);
    }
  }
  const total = Object.values(expected).reduce((a, b) => a + b, 0);
  const totalRow = markdown.match(/^\| Total \|[^|\n]*\| (\d+) \|/m);
  if (!totalRow || Number(totalRow[1]) !== total) {
    errors.push(`total : ${totalRow ? totalRow[1] : 'absent'} dans ${name}, ${total} dans le cahier`);
  }
  const labels = indicateursReprise();
  const annex = [...markdown.matchAll(/^\| (\d+) \| ([^|\n]+?) \| \| \|$/gm)].map((m) => m[2]);
  if (annex.join('\n') !== labels.join('\n')) {
    errors.push(`annexe de la reprise : ${annex.length} indicateurs dans ${name}, ${labels.length} dans la plateforme, ou libellés différents (${labels.join(', ')})`);
  }
  if (errors.length) throw new Error(`${name} n'est plus à jour :\n- ${errors.join('\n- ')}`);
  return { scenarios: total, indicateurs: labels.length };
}

module.exports = { controler, scenariosParAttente, indicateursReprise };
