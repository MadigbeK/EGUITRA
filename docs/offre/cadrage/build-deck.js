// Génère docs/offre/cadrage/Reunion_de_cadrage_EGUITRA.pptx
// Support de la réunion de cadrage du mardi 13 octobre 2026.
// Usage : node docs/offre/cadrage/build-deck.js
const path = require('path');
const fs = require('fs');
const pptxgen = require('pptxgenjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const sharp = require('sharp');
const Fi = require('react-icons/fi');
const { applyTheme } = require('/root/.claude/skills/synced/48c54c87-a6ec-4706-91d5-f8ba25e3902c_22a7aa7d-5a02-4f98-b5e5-9df3c9a41624/pptx/scripts/apply_theme.js');
const { HYP, PLANNING } = require('../contenu-v2');

const OUT = path.join(__dirname, 'Reunion_de_cadrage_EGUITRA.pptx');
const LOGO = ['logo.png', 'logo-rendu.png'].map((f) => path.join(__dirname, '..', f)).find((f) => fs.existsSync(f));

const THEME = {
  name: 'E-VOLUTION XP',
  headFontFace: 'Cambria',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '1C1E6B', lt1: 'FFFFFF', dk2: '0F1140', lt2: 'EEF3F6',
    accent1: '1A9E9E', accent2: '1C1E6B', accent3: 'E0A83C', accent4: '8FA2C0', accent5: '33A98C', accent6: 'F2777A',
    hlink: '1A9E9E', folHlink: '1A9E9E',
  },
};

async function icon(name, hex) {
  const svg = renderToStaticMarkup(React.createElement(Fi[name], { color: '#' + hex, size: 256 }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return 'image/png;base64,' + buf.toString('base64');
}

(async () => {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_16x9'; // 10 x 5.625
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  pres.author = HYP.prestataire; pres.company = 'E-VOLUTION XP'; pres.title = 'Réunion de cadrage EGUITRA';
  const C = pres.SchemeColor;

  // Icônes pré-rendues
  const I = {};
  for (const [k, hex] of [['FiTarget', 'FFFFFF'], ['FiUsers', 'FFFFFF'], ['FiInbox', 'FFFFFF'], ['FiXCircle', '1C1E6B'],
    ['FiLayers', '1A9E9E'], ['FiCalendar', '1A9E9E'], ['FiCheckSquare', 'FFFFFF'], ['FiFileText', 'FFFFFF'],
    ['FiTruck', 'FFFFFF'], ['FiHome', 'FFFFFF'], ['FiBriefcase', 'FFFFFF'], ['FiServer', 'FFFFFF'], ['FiPenTool', 'FFFFFF'],
    ['FiClock', '1A9E9E'], ['FiArrowRight', '1A9E9E'], ['FiShield', 'FFFFFF']]) I[k] = await icon(k, hex);

  // ---- Layouts
  pres.defineSlideMaster({
    title: 'DARK', background: { color: THEME.colors.dk1 },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 2.0, w: 8.8, h: 1.1, fontSize: 40, bold: true, color: C.background1, margin: 0 } } },
      { placeholder: { options: { name: 'body', type: 'body', x: 0.6, y: 3.15, w: 8.8, h: 1.65, fontSize: 18, color: C.accent4, margin: 0 } } },
    ],
  });
  pres.defineSlideMaster({
    title: 'CONTENT', background: { color: THEME.colors.lt1 },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.35, w: 9.0, h: 0.7, fontSize: 28, bold: true, color: C.text1, margin: 0 } } },
      ...(LOGO ? [{ image: { x: 8.9, y: 5.1, w: 0.6, h: 0.35, path: LOGO } }] : []),
      { text: { text: 'Réunion de cadrage, EGUITRA GROUP et MB AxisPro Consulting', options: { x: 0.5, y: 5.15, w: 6, h: 0.3, fontSize: 9, color: C.accent4, margin: 0 } } },
    ],
    slideNumber: { x: 8.3, y: 5.15, w: 0.5, h: 0.3, fontSize: 9, color: C.accent4 },
  });

  // Aides de composition
  const circleIcon = (slide, img, x, y, d, fill) => {
    slide.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill } });
    slide.addImage({ data: img, x: x + d * 0.25, y: y + d * 0.25, w: d * 0.5, h: d * 0.5 });
  };
  const card = (slide, x, y, w, h, img, head, body, opts = {}) => {
    slide.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: C.background2 }, line: { color: C.background2 }, objectName: `card ${head}` });
    if (img) circleIcon(slide, img, x + 0.2, y + 0.2, 0.5, opts.iconFill || C.accent1);
    slide.addText(head, { x: x + (img ? 0.85 : 0.2), y: y + 0.18, w: w - (img ? 1.05 : 0.4), h: 0.55, fontSize: 15, bold: true, color: C.text1, margin: 0, isTextBox: true, valign: 'middle' });
    slide.addText(body, { x: x + 0.2, y: y + 0.85, w: w - 0.4, h: h - 1.0, fontSize: 12.5, color: C.text2, margin: 0, isTextBox: true, valign: 'top' });
  };
  const bullets = (items, size = 14) => items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < items.length - 1, paraSpaceAfter: 6, fontSize: size, color: C.text2 } }));

  // ================================================================ 1. Titre
  pres.addSection({ title: 'Ouverture' });
  let s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'Ouverture' });
  if (LOGO) s.addImage({ path: LOGO, x: 0.6, y: 0.5, w: 1.7, h: 1.0 });
  s.addText('Réunion de cadrage', { placeholder: 'title' });
  s.addText('EGUITRA Finance et AxisPro Suite\nMardi 13 octobre 2026, 10 h, locaux d\'EGUITRA GROUP', { placeholder: 'body' });
  s.addText(`${HYP.prestataire}, ${HYP.slogan}`, { x: 0.6, y: 4.9, w: 6, h: 0.3, fontSize: 11, color: C.accent1, margin: 0, isTextBox: true });
  s.addNotes('Accueil. Se présenter, présenter l\'équipe, remercier pour l\'accord de principe. Rappeler que la réunion dure une demi-journée et que l\'on sort avec des décisions, pas avec des idées.');

  // ================================================================ 2. Objectifs
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Ouverture' });
  s.addText('Ce que nous devons avoir décidé à 14 h', { placeholder: 'title' });
  card(s, 0.5, 1.3, 2.9, 2.6, I.FiTarget, 'Le périmètre', 'Les règles de gestion de chaque module, les écrans prioritaires, ce qui entre dans la version du 6 novembre et ce qui attend.');
  card(s, 3.55, 1.3, 2.9, 2.6, I.FiUsers, 'Les personnes', 'Un référent par domaine, disponible une demi-journée par jour, et l\'heure du point quotidien.');
  card(s, 6.6, 1.3, 2.9, 2.6, I.FiInbox, 'Les éléments', 'Fichiers de gestion, plan de comptes, relevés bancaires, charte, grille AxisPro : qui remet quoi, et quand.');
  s.addShape(pres.ShapeType.roundRect, { x: 0.5, y: 4.15, w: 9.0, h: 0.7, rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: C.accent4, width: 0.75 } });
  s.addImage({ data: I.FiXCircle, x: 0.7, y: 4.33, w: 0.34, h: 0.34 });
  s.addText('Ce que nous ne faisons pas aujourd\'hui : concevoir des écrans ou discuter du contrat. Le contrat est signé, les écrans se valident en semaine 2 sur la recette.', { x: 1.2, y: 4.15, w: 8.2, h: 0.7, fontSize: 12.5, color: C.text1, margin: 0, isTextBox: true, valign: 'middle' });
  s.addNotes('Cadrer les attentes dès la première minute. Si quelqu\'un veut parler de prix ou de délai, renvoyer au contrat signé.');

  // ================================================================ 3. Ordre du jour
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Ouverture' });
  s.addText('Ordre du jour, une demi-journée', { placeholder: 'title' });
  const agenda = [
    ['10 h 00', 'Ouverture, objectifs, règles du jeu', '15 min'],
    ['10 h 15', 'La plateforme, le planning, l\'organisation', '30 min'],
    ['10 h 45', 'Atelier Finance', '60 min'],
    ['11 h 45', 'Pause', '15 min'],
    ['12 h 00', 'Ateliers Transport, BTP, Immobilier', '45 min'],
    ['12 h 45', 'Atelier AxisPro Suite', '30 min'],
    ['13 h 15', 'Technique, charte graphique, accès', '20 min'],
    ['13 h 35', 'Décisions, référents, prochaines étapes', '25 min'],
  ];
  s.addTable(agenda.map(([h, t, d], i) => [
    { text: h, options: { bold: true, color: C.accent1, fontSize: 13, align: 'left' } },
    { text: t, options: { color: C.text1, fontSize: 13 } },
    { text: d, options: { color: C.text2, fontSize: 12, align: 'right' } },
  ]), { x: 0.5, y: 1.25, w: 9.0, colW: [1.2, 6.4, 1.4], rowH: 0.42, border: { type: 'solid', color: THEME.colors.lt2, pt: 1 }, fill: { color: 'FFFFFF' }, margin: 0.06 });
  s.addNotes('Tenir l\'horaire. Un atelier qui déborde se termine par une liste de questions ouvertes à traiter dans la semaine, pas par un dépassement.');

  // ================================================================ 4. Le projet
  pres.addSection({ title: 'Le projet' });
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Le projet' });
  s.addText('Deux applications, un noyau invisible', { placeholder: 'title' });
  const layer = (y, h, fill, txt, sub, txtColor) => {
    s.addShape(pres.ShapeType.roundRect, { x: 0.5, y, w: 5.6, h, rectRadius: 0.06, fill: { color: fill }, line: { color: fill } });
    s.addText([{ text: txt, options: { bold: true, fontSize: 14, color: txtColor, breakLine: true } }, { text: sub, options: { fontSize: 11, color: txtColor } }], { x: 0.7, y, w: 5.2, h, margin: 0, isTextBox: true, valign: 'middle' });
  };
  layer(1.3, 1.0, THEME.colors.accent1, 'EGUITRA Finance et AxisPro Suite', 'Ce que vos équipes voient : vos écrans, votre charte, votre vocabulaire, le mobile et le portail', 'FFFFFF');
  layer(2.4, 0.75, THEME.colors.lt2, 'API métier', 'Règles de gestion, droits, journalisation', THEME.colors.dk1);
  layer(3.25, 0.75, THEME.colors.lt2, 'Noyau de gestion open source', 'Comptabilité, analytique, trésorerie, immobilisations, budget, workflows', THEME.colors.dk1);
  layer(4.1, 0.75, THEME.colors.dk1, 'Serveur VPS dédié', 'Base de données, sauvegardes toutes les 15 minutes, supervision', 'FFFFFF');
  s.addText(bullets([
    'Aucune licence, aucune limite d\'utilisateurs.',
    'Le noyau n\'est jamais montré aux utilisateurs.',
    'Vingt attentes du département Finance couvertes.',
    'Garantie de 6 mois, première clôture annuelle comprise.',
  ], 13.5), { x: 6.4, y: 1.3, w: 3.1, h: 3.5, margin: 0, isTextBox: true, valign: 'top' });
  s.addNotes('Ne pas prononcer le nom du noyau devant les utilisateurs finaux si la direction préfère ; le contrat le nomme, les utilisateurs ne le verront jamais.');

  // ================================================================ 5. Périmètre
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Le projet' });
  s.addText('Le périmètre de la version du 6 novembre', { placeholder: 'title' });
  card(s, 0.5, 1.25, 4.4, 3.7, I.FiFileText, 'EGUITRA Finance',
    'Tableau de bord dirigeant, pilotage par activité, ventes, achats, trésorerie et rapprochement, tiers, immobilisations, journaux et OD, balance et grand livre, budget, dette et DSCR, alertes, clôtures, contrôles, états SYSCOHADA, approbations, exports, paramètres.\n\nMétiers : flotte, rotations, rentabilité par camion et par route, chantiers et retenues de garantie, biens et baux, déclarations fiscales, consolidation, passerelle IFRS.');
  card(s, 5.1, 1.25, 4.4, 3.7, I.FiBriefcase, 'AxisPro Suite',
    'Portefeuille de dossiers, fiche projet, saisie guidée par gate, score et knock-outs, gaps prioritaires, data room, revues de comité, rapports comité et promoteur, politique d\'évaluation, portail du porteur de projet.\n\nFacturation et suivi des temps du cabinet dans le même outil.', { iconFill: C.accent2 });
  s.addNotes('Tout ce qui est listé ici est dans le prix. Tout ce qui n\'y est pas se note dans la liste des demandes et se traite après la mise en production, dans la maintenance évolutive ou sur devis.');

  // ================================================================ 6. Planning
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Le projet' });
  s.addText('Quatre semaines, du 13 octobre au 6 novembre', { placeholder: 'title' });
  const weeks = [
    ['Semaine 1', '13 au 16 oct.', 'Cadrage et socle', 'Ateliers, charte validée, serveur en ligne, comptes créés'],
    ['Semaine 2', '19 au 23 oct.', 'Finance et AxisPro', 'Paramétrage, écrans finance, grille AxisPro, soldes d\'ouverture'],
    ['Semaine 3', '26 au 30 oct.', 'Métiers et portail', 'Transport, BTP, immobilier, fiscal, AxisPro, fin de reprise'],
    ['Semaine 4', '2 au 6 nov.', 'Recette et mise en production', 'Recette sur vos données, formation, PV de mise en production'],
  ];
  weeks.forEach(([w, d, t, b], i) => {
    const x = 0.5 + i * 2.3;
    s.addShape(pres.ShapeType.roundRect, { x, y: 1.3, w: 2.1, h: 2.5, rectRadius: 0.08, fill: { color: i === 0 ? THEME.colors.accent1 : THEME.colors.lt2 }, line: { color: i === 0 ? THEME.colors.accent1 : THEME.colors.lt2 } });
    const col = i === 0 ? 'FFFFFF' : THEME.colors.dk1;
    s.addText([
      { text: w, options: { bold: true, fontSize: 15, color: col, breakLine: true } },
      { text: d, options: { fontSize: 11, color: col, breakLine: true } },
      { text: ' ', options: { fontSize: 6, breakLine: true } },
      { text: t, options: { bold: true, fontSize: 12.5, color: col, breakLine: true } },
      { text: b, options: { fontSize: 11, color: col } },
    ], { x: x + 0.15, y: 1.4, w: 1.8, h: 2.3, margin: 0, isTextBox: true, valign: 'top' });
  });
  s.addImage({ data: I.FiClock, x: 0.5, y: 4.1, w: 0.35, h: 0.35 });
  s.addText('Ensuite : quatre semaines d\'accompagnement renforcé, puis garantie corrective de 6 mois couvrant la clôture annuelle. Pénalité de retard de 0,5 % par jour ouvré si le retard nous est imputable.', { x: 1.0, y: 4.0, w: 8.5, h: 0.6, fontSize: 12.5, color: C.text2, margin: 0, isTextBox: true, valign: 'middle' });
  s.addNotes('Insister : le délai tient si les référents sont disponibles et si les éléments arrivent cette semaine. Tout retard côté client décale la date du même nombre de jours, constaté en comité.');

  // ================================================================ 7. Organisation
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Le projet' });
  s.addText('Notre organisation sur quatre semaines', { placeholder: 'title' });
  card(s, 0.5, 1.25, 4.4, 2.05, I.FiUsers, 'Côté EGUITRA et MB AxisPro', 'Un référent par domaine : finance, transport, chantiers, immobilier, cabinet. Une demi-journée par jour, surtout en semaines 2 et 4. L\'expert-comptable valide le plan de comptes en semaine 2.');
  card(s, 5.1, 1.25, 4.4, 2.05, I.FiShield, 'Côté E-VOLUTION XP', 'Un directeur de projet, interlocuteur unique. Consultant finance, développeurs, ingénieur exploitation. Présents sur site aux ateliers et à la recette.', { iconFill: C.accent2 });
  const rows = [
    ['Chaque jour', 'Point de 15 minutes avec le référent du jour, à heure fixe'],
    ['Chaque semaine', 'Comité de pilotage avec la direction et le responsable financier, compte rendu écrit'],
    ['En continu', 'Espace partagé des demandes et des questions ouvertes, visible de tous'],
  ];
  s.addTable(rows.map(([a, b]) => [
    { text: a, options: { bold: true, color: C.accent1, fontSize: 13 } },
    { text: b, options: { color: C.text1, fontSize: 13 } },
  ]), { x: 0.5, y: 3.5, w: 9.0, colW: [1.8, 7.2], rowH: 0.42, border: { type: 'solid', color: THEME.colors.lt2, pt: 1 }, fill: { color: 'FFFFFF' }, margin: 0.06 });
  s.addNotes('Faire nommer les référents séance tenante et noter l\'heure du point quotidien. Sans cela, la semaine 2 démarre à vide.');

  // ================================================================ 8. Atelier Finance
  pres.addSection({ title: 'Ateliers' });
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Ateliers' });
  s.addText('Atelier Finance, 60 minutes', { placeholder: 'title' });
  circleIcon(s, I.FiFileText, 0.5, 1.3, 0.55, C.accent1);
  s.addText('Ce que nous devons trancher ensemble', { x: 1.2, y: 1.3, w: 8, h: 0.55, fontSize: 15, bold: true, color: C.text1, margin: 0, isTextBox: true, valign: 'middle' });
  s.addText(bullets([
    'Plan de comptes : votre plan actuel, les comptes par activité, les comptes de trésorerie et de passage.',
    'Axes analytiques : activités, centres de coût, chantiers, véhicules, biens. Qui porte quoi.',
    'Journaux et pièces : numérotation, justificatifs obligatoires, catégories de dépense.',
    'Circuits d\'approbation : qui valide un engagement, un paiement, à partir de quel montant.',
    'Seuils d\'alerte : trésorerie, marge transport, écart budgétaire, délai de recouvrement, DSCR.',
    'Clôture mensuelle : qui la lance, qui peut rouvrir, quels contrôles bloquent.',
    'États : bilan, compte de résultat, flux, rapport mensuel de gestion. Modèles actuels à remettre.',
    'Devises : GNF, USD, EUR. Source et fréquence des taux.',
  ], 13), { x: 0.5, y: 2.0, w: 9.0, h: 3.0, margin: 0, isTextBox: true, valign: 'top' });
  s.addNotes('Le responsable financier parle, vous notez. Objectif : repartir avec le plan de comptes et les modèles d\'états en main, ou une date de remise dans la semaine.');

  // ================================================================ 9. Ateliers métiers
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Ateliers' });
  s.addText('Ateliers métiers, 45 minutes', { placeholder: 'title' });
  card(s, 0.5, 1.25, 2.9, 3.6, I.FiTruck, 'Transport', 'Liste des camions et chauffeurs. Routes, tarifs, distances. Produits transportés. Coûts d\'une rotation : carburant, péages, frais chauffeur, maintenance, taxes. Qui saisit, où, et avec quel réseau.');
  card(s, 3.55, 1.25, 2.9, 3.6, I.FiBriefcase, 'BTP', 'Chantiers en cours. Mode de facturation : jalons ou situations mensuelles. Taux et durée de la retenue de garantie. Coûts suivis par chantier.', { iconFill: C.accent2 });
  card(s, 6.6, 1.25, 2.9, 3.6, I.FiHome, 'Immobilier', 'Liste des biens et des baux. Périodicité des loyers, charges, dépôts. Quittances actuelles. Valeur du patrimoine et méthode.');
  s.addNotes('Trois référents différents, quinze minutes chacun. Repartir avec les listes : flotte, chantiers, biens. Elles conditionnent la reprise des données.');

  // ================================================================ 10. Atelier AxisPro
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Ateliers' });
  s.addText('Atelier AxisPro Suite, 30 minutes', { placeholder: 'title' });
  circleIcon(s, I.FiCheckSquare, 0.5, 1.3, 0.55, C.accent2);
  s.addText('Industrialiser la méthode du cabinet sans la figer', { x: 1.2, y: 1.3, w: 8, h: 0.55, fontSize: 15, bold: true, color: C.text1, margin: 0, isTextBox: true, valign: 'middle' });
  s.addText(bullets([
    'La grille : 111 critères, 15 domaines, pondérations, critères critiques et éliminatoires. Version de référence à remettre.',
    'Les gates 0 à 7 : règles de passage, qui décide, qui verrouille.',
    'La politique d\'évaluation : réglages actuels, qui peut les modifier.',
    'La data room : les 42 pièces standard, formats acceptés, qui dépose.',
    'Les rapports : modèles comité et promoteur, logo et mentions du cabinet.',
    'Le portail : ce qu\'un porteur de projet voit, ce qu\'il ne voit pas.',
    'Dossiers en cours à reprendre, et leur stade.',
  ], 13), { x: 0.5, y: 2.0, w: 9.0, h: 3.0, margin: 0, isTextBox: true, valign: 'top' });
  s.addNotes('Le prototype du DGA est la référence. Demander qui maintiendra la grille après la mise en production : c\'est une donnée, pas du code.');

  // ================================================================ 11. Technique et charte
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Ateliers' });
  s.addText('Technique, charte et accès, 20 minutes', { placeholder: 'title' });
  card(s, 0.5, 1.25, 4.4, 2.05, I.FiServer, 'Serveur et accès', 'Nom de domaine : le vôtre ou le nôtre, offert. Liste des utilisateurs et profils. Adresses e-mail pour la double authentification. Qualité du réseau au parc et sur les chantiers.');
  card(s, 5.1, 1.25, 4.4, 2.05, I.FiPenTool, 'Charte graphique', 'Logos EGUITRA et MB AxisPro en haute définition, couleurs, polices. Sans charte formelle, nous la définissons ici en vingt minutes.', { iconFill: C.accent2 });
  card(s, 0.5, 3.45, 9.0, 1.5, I.FiInbox, 'Données à reprendre', 'Fichiers de gestion de l\'exercice en cours, relevés bancaires électroniques de chaque banque, modèles de déclarations fiscales, coordonnées de l\'expert-comptable.');
  s.addNotes('Vérifier concrètement les formats de relevés que les banques fournissent : c\'est ce qui conditionne l\'import automatique.');

  // ================================================================ 12. Décisions
  pres.addSection({ title: 'Décisions' });
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Décisions' });
  s.addText('Les décisions à prendre avant 14 h', { placeholder: 'title' });
  const dec = [
    'Les cinq référents sont nommés, avec leurs créneaux de disponibilité',
    'L\'heure du point quotidien et le jour du comité hebdomadaire sont fixés',
    'Le nom de domaine est choisi',
    'La charte graphique est validée ou l\'atelier charte est daté',
    'Le plan de comptes de référence et les modèles d\'états sont identifiés, avec une date de remise',
    'La liste des utilisateurs et de leurs profils est arrêtée',
    'Les listes flotte, chantiers, biens et la grille AxisPro ont un propriétaire et une date',
    'La date de validation du plan de comptes par l\'expert-comptable est fixée en semaine 2',
  ];
  dec.forEach((t, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.5 + col * 4.6, y = 1.3 + row * 0.9;
    s.addShape(pres.ShapeType.ellipse, { x, y: y + 0.12, w: 0.42, h: 0.42, fill: { color: THEME.colors.accent1 }, line: { color: THEME.colors.accent1 } });
    s.addText(String(i + 1), { x, y: y + 0.12, w: 0.42, h: 0.42, fontSize: 13, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0, isTextBox: true });
    s.addText(t, { x: x + 0.55, y, w: 3.85, h: 0.7, fontSize: 12.5, color: C.text1, margin: 0, isTextBox: true, valign: 'middle' });
  });
  s.addNotes('Lire les huit points à voix haute et obtenir un oui ou une date pour chacun. C\'est la sortie de la réunion.');

  // ================================================================ 13. Éléments à remettre
  s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: 'Décisions' });
  s.addText('À remettre avant le vendredi 16 octobre', { placeholder: 'title' });
  const rem = [
    ['Plan de comptes actuel et modèles d\'états financiers', 'Responsable financier'],
    ['Fichiers de gestion de l\'exercice en cours', 'Responsable financier'],
    ['Relevés bancaires électroniques, un par banque', 'Responsable financier'],
    ['Modèles de déclarations fiscales en vigueur', 'Responsable financier'],
    ['Listes flotte, chauffeurs, routes et tarifs', 'Référent transport'],
    ['Liste des chantiers et contrats en cours', 'Référent chantiers'],
    ['Liste des biens et des baux', 'Référent immobilier'],
    ['Grille AxisPro de référence et dossiers en cours', 'Référent cabinet'],
    ['Logos, charte, liste des utilisateurs et profils', 'Direction générale'],
  ];
  s.addTable([
    [{ text: 'Élément', options: { bold: true, color: 'FFFFFF', fill: { color: THEME.colors.dk1 }, fontSize: 12 } }, { text: 'Qui', options: { bold: true, color: 'FFFFFF', fill: { color: THEME.colors.dk1 }, fontSize: 12 } }],
    ...rem.map(([a, b], i) => [
      { text: a, options: { color: C.text1, fontSize: 12, fill: { color: i % 2 ? THEME.colors.lt2 : 'FFFFFF' } } },
      { text: b, options: { color: C.text2, fontSize: 12, fill: { color: i % 2 ? THEME.colors.lt2 : 'FFFFFF' } } },
    ]),
  ], { x: 0.5, y: 1.25, w: 9.0, colW: [6.2, 2.8], rowH: 0.36, border: { type: 'solid', color: 'FFFFFF', pt: 1 }, margin: 0.05 });
  s.addNotes('Chaque ligne a un nom. Une ligne sans nom à la fin de la réunion est un retard qui vous sera opposable plus tard : la faire attribuer.');

  // ================================================================ 14. Prochaines étapes
  s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'Décisions' });
  s.addText('Et dès demain', { placeholder: 'title' });
  s.addText('Compte rendu et liste des décisions sous 24 heures.\nServeur en ligne et premiers comptes créés cette semaine.\nDossier de conception à signer vendredi 16 octobre.\nSemaine 2 démarre lundi 19 octobre avec l\'atelier plan de comptes.', { placeholder: 'body' });
  s.addText(`${HYP.contact}`, { x: 0.6, y: 4.9, w: 8, h: 0.3, fontSize: 11, color: C.accent1, margin: 0, isTextBox: true });
  s.addNotes('Remercier. Rappeler la date de signature du dossier de conception : c\'est le jalon de la semaine 1.');

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log('OK :', path.basename(OUT));
})().catch((e) => { console.error(e); process.exit(1); });
