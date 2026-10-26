// Génère les cahiers de test des utilisateurs finaux, un fichier Word par module, dans word/.
//   node docs/projet/tests-utilisateurs/build.js
// Source unique : les fichiers NN-module.md de ce dossier. Avant d'écrire, le script contrôle chaque
// cahier et s'arrête au premier écart : numéros des scénarios uniques et suivis, rubriques de chaque
// scénario (objectif, compte, données, étapes, résultat attendu, case Réussi / Échoué), tableau de
// synthèse égal au nombre de scénarios de chaque partie, nom du cabinet écrit en entier, aucun terme
// technique ni gras.
const fs = require('fs');
const path = require('path');
const { build } = require('../../outils/md-docx');

const DIR = __dirname;
const OUT = path.join(DIR, 'word');

/**
 * Termes à ne jamais montrer à un utilisateur final. Le métier « route » du transport reste permis,
 * comme les numéros de comptes (401, 422…), qui sont du vocabulaire de la comptabilité.
 */
const INTERDITS = [/\bAPI\b/, /\bOdoo\b/i, /\bendpoint/i, /\bHTTP/, /\bjetons?\b/i, /\btoken/i, /code d'erreur/i, /\bURL\b/];

function echec(fichier, message) {
  console.error(`${fichier} : ${message}`);
  process.exit(1);
}

/** Contrôle un cahier ; rend le décompte des scénarios par partie. */
function controler(fichier, md) {
  const lignes = md.split('\n');
  for (const [n, l] of lignes.entries()) {
    if (l.includes('**')) echec(fichier, `ligne ${n + 1} : pas de gras dans un cahier de test`);
    for (const re of INTERDITS) if (re.test(l)) echec(fichier, `ligne ${n + 1} : terme technique « ${l.match(re)[0]} »`);
  }
  // Nom du cabinet en entier, y compris quand il passe à la ligne dans la source.
  const nom = md.replace(/\n[ \t]*/g, ' ').match(/.{0,30}MB AxisPro(?! Consulting).{0,30}/);
  if (nom) echec(fichier, `écrire « MB AxisPro Consulting » en entier : « ${nom[0]} »`);

  // Parties : « ## A. Libellé » ; scénarios : « ### XXX-nn. Titre ».
  const parties = [];
  const ids = new Set();
  let prefixe = null;
  let attendu = 1;
  let courant = null;
  const fermer = () => {
    if (!courant) return;
    const corps = courant.lignes.join('\n');
    const manque = [];
    if (!/^Objectif : /m.test(corps)) manque.push('Objectif');
    if (!/^Compte : /m.test(corps)) manque.push('Compte');
    if (!/^Données : /m.test(corps)) manque.push('Données');
    if (!/^1\. /m.test(corps)) manque.push('étapes numérotées');
    if (!/^Résultat attendu : /m.test(corps)) manque.push('Résultat attendu');
    if (!/^\| ☐ Réussi \|/m.test(corps) || !/^\| ☐ Échoué \|/m.test(corps)) manque.push('case Réussi / Échoué');
    if (manque.length) echec(fichier, `${courant.id} : rubrique manquante (${manque.join(', ')})`);
    courant = null;
  };
  for (const l of lignes) {
    const partie = l.match(/^## ([A-Z])\. (.+)$/);
    const scenario = l.match(/^### ([A-Z]{2,4})-(\d{2})\. (.+)$/);
    if (l.startsWith('## ')) fermer();
    if (partie) parties.push({ cle: `${partie[1]}. ${partie[2]}`, n: 0 });
    if (scenario) {
      fermer();
      const [, p, num] = scenario;
      prefixe ??= p;
      if (p !== prefixe) echec(fichier, `${p}-${num} : préfixe différent de ${prefixe}`);
      if (Number(num) !== attendu) echec(fichier, `${p}-${num} : numéro attendu ${String(attendu).padStart(2, '0')}`);
      if (!parties.length) echec(fichier, `${p}-${num} : scénario hors d'une partie « ## A. … »`);
      attendu += 1;
      ids.add(`${p}-${num}`);
      parties[parties.length - 1].n += 1;
      courant = { id: `${p}-${num}`, lignes: [] };
    } else if (courant) courant.lignes.push(l);
  }
  fermer();

  // Synthèse : une ligne par partie, puis le total.
  const debut = lignes.findIndex((l) => l.startsWith('## Synthèse'));
  if (debut < 0) echec(fichier, 'section « ## Synthèse » absente');
  const lignesSynthese = lignes.slice(debut).filter((l) => /^\| [A-Z]\. /.test(l) || l.startsWith('| Total |'));
  const avecScenarios = parties.filter((p) => p.n > 0);
  for (const p of avecScenarios) {
    const ligne = lignesSynthese.find((l) => l.startsWith(`| ${p.cle} |`));
    if (!ligne) echec(fichier, `synthèse : ligne « ${p.cle} » absente`);
    const n = Number(ligne.split('|')[2].trim());
    if (n !== p.n) echec(fichier, `synthèse : « ${p.cle} » annonce ${n} scénarios, la partie en compte ${p.n}`);
  }
  const total = lignesSynthese.find((l) => l.startsWith('| Total |'));
  const somme = avecScenarios.reduce((a, p) => a + p.n, 0);
  if (!total || Number(total.split('|')[2].trim()) !== somme) echec(fichier, `synthèse : total attendu ${somme}`);
  if (!/^## Signatures/m.test(md)) echec(fichier, 'section « ## Signatures » absente');
  return { parties: avecScenarios, total: somme };
}

const cahiers = fs.readdirSync(DIR).filter((f) => /^\d{2}-.+\.md$/.test(f)).sort();
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  let ensemble = 0;
  for (const fichier of cahiers) {
    const md = fs.readFileSync(path.join(DIR, fichier), 'utf8').replace(/\r\n/g, '\n');
    const { parties, total } = controler(fichier, md);
    const titre = md.split('\n')[0].replace(/^#\s*/, '');
    const module = titre.replace(/^Cahier de test : /, '');
    // Nom de fichier sans accent ni espace, comme les autres documents Word du projet.
    const court = module.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const nom = `Cahier_de_test_${fichier.slice(0, 2)}_${court}.docx`;
    await build({ markdown: md, out: path.join(OUT, nom), title: titre, footer: `NIMOVA · ${titre}` });
    ensemble += total;
    console.log(`Écrit : word/${nom} (${total} scénarios : ${parties.map((p) => `${p.cle} ${p.n}`).join(' ; ')})`);
  }
  console.log(`${cahiers.length} cahiers, ${ensemble} scénarios.`);
})();
