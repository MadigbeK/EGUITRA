// Recopie les guides affichés dans l'application (page /finance/guide) depuis leur source Markdown.
//   node docs/guides/web.js
// À relancer après toute modification de guide-finance.md ou de guide-achats.md : l'image de l'application web ne contient
// que apps/web, le guide y est donc embarqué sous forme de module (apps/web/lib/guides.ts).
const fs = require('fs');
const path = require('path');

const GUIDES = { finance: 'guide-finance.md', achats: 'guide-achats.md' };
const OUT = path.join(__dirname, '..', '..', 'apps', 'web', 'lib', 'guides.ts');

const lines = [
  '// Fichier généré par docs/guides/web.js depuis docs/guides/*.md : ne pas modifier à la main.',
  '',
  'export const GUIDES: Record<string, string> = {',
];
for (const [key, file] of Object.entries(GUIDES)) {
  const md = fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
  lines.push(`  ${key}: ${JSON.stringify(md)},`);
}
lines.push('};', '');
fs.writeFileSync(OUT, lines.join('\n'));
console.log(`Écrit : ${path.relative(path.join(__dirname, '..', '..'), OUT).split(path.sep).join('/')}`);
