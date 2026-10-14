// Génère un guide Word par profil (docs/guides/word/), à remettre en formation.
//   node docs/guides/build.js
// Chaque guide reprend la section commune « Pour tous : se connecter » du README.
const fs = require('fs');
const path = require('path');
const { build } = require('../outils/md-docx');

const DIR = __dirname;
const OUT = path.join(DIR, 'word');
const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
const common = readme.slice(readme.indexOf('## Pour tous : se connecter'));
fs.mkdirSync(OUT, { recursive: true });

const guides = fs.readdirSync(DIR).filter((f) => /^guide-.+\.md$/.test(f)).sort();
(async () => {
  for (const file of guides) {
    const md = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n');
    const [first, ...rest] = md.split('\n');
    const title = first.replace(/^#\s*/, '');
    const name = `Guide_${file.replace(/^guide-|\.md$/g, '')}.docx`;
    await build({
      markdown: [`${first}\n`, common, rest.join('\n')],
      out: path.join(OUT, name),
      title,
      footer: `E-VOLUTION XP · ${title}`,
    });
    console.log(`Écrit : ${path.join('docs', 'guides', 'word', name)}`);
  }
})();
