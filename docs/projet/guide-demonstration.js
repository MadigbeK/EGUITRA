// Guide pas à pas de la démonstration et questions-réponses (PowerPoint, généré avec pptxgenjs).
//   npm install pptxgenjs (dossier temporaire), puis : node guide-demonstration.js <adresse de la recette> <fichier.pptx>
// L'adresse de la recette n'est jamais écrite dans le dépôt : elle est passée en argument.
const pptxgen = require("pptxgenjs");
const URL = process.argv[2] || "https://recette.<adresse>.sslip.io";
const OUT = process.argv[3] || "Guide_demonstration.pptx";

const C = { forest: "142F29", green: "22634C", mint: "A5E6C2", gold: "D3AA5B", cream: "F9F8F5",
  ink: "1F2A26", muted: "55645D", white: "FFFFFF", line: "DCE3DE", soft: "EEF6F0" };
const H = "Georgia";
const B = "Calibri";

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9"; // 10 x 5.625 in
pres.author = "E-VOLUTION XP";
pres.title = "Guide de démonstration de la plateforme";

function footer(slide, label) {
  slide.addText(label, { x: 0.5, y: 5.25, w: 6.5, h: 0.25, fontFace: B, fontSize: 9, color: C.muted, margin: 0 });
  slide.addText("Recette · données fictives", { x: 6.5, y: 5.25, w: 3.0, h: 0.25, fontFace: B, fontSize: 9,
    color: C.muted, align: "right", margin: 0 });
}

function stepBadge(slide, n) {
  slide.addShape(pres.shapes.OVAL, { x: 0.5, y: 0.32, w: 0.62, h: 0.62, fill: { color: C.forest } });
  slide.addText(String(n), { x: 0.5, y: 0.32, w: 0.62, h: 0.62, fontFace: H, fontSize: 20, bold: true,
    color: C.gold, align: "center", valign: "middle", margin: 0 });
}

function title(slide, text, sub, x = 1.3) {
  slide.addText(text, { x, y: 0.28, w: 9.5 - x, h: 0.5, fontFace: H, fontSize: 24, bold: true, color: C.ink, margin: 0 });
  if (sub) slide.addText(sub, { x, y: 0.76, w: 9.5 - x, h: 0.3, fontFace: B, fontSize: 12, color: C.muted, margin: 0 });
}

// Liste numérotée de clics : [libellé en gras, suite]. Numéros dans des pastilles dorées ; la
// taille du texte se réduit si la liste ne tient pas dans la hauteur disponible.
function clicks(slide, items, opts = {}) {
  const x = opts.x ?? 0.5, y0 = opts.y ?? 1.25, w = opts.w ?? 5.6;
  const bottom = opts.caution ? 4.5 : 5.05;
  slide.addText("À l'écran", { x, y: y0, w, h: 0.3, fontFace: B, fontSize: 11, bold: true, color: C.green,
    charSpacing: 2, margin: 0 });
  const textW = w - 0.45;
  const layout = (size) => {
    const perLine = Math.floor(textW * 72 / (size * 0.5));
    return items.map((it) => {
      const text = it[0] + (it[1] ? " " + it[1] : "");
      const lines = Math.max(1, Math.ceil(text.length / perLine));
      return lines * size * 1.22 / 72 + 0.05;
    });
  };
  let size = opts.size ?? 13;
  let heights = layout(size);
  const gap = 0.13;
  while (heights.reduce((a, b) => a + b, 0) + gap * (items.length - 1) > bottom - (y0 + 0.4) && size > 10.5) {
    size -= 0.5;
    heights = layout(size);
  }
  let y = y0 + 0.4;
  items.forEach((it, i) => {
    slide.addShape(pres.shapes.OVAL, { x, y: y + 0.01, w: 0.3, h: 0.3, fill: { color: C.gold } });
    slide.addText(String(i + 1), { x, y: y + 0.01, w: 0.3, h: 0.3, fontFace: H, fontSize: 11, bold: true,
      color: C.forest, align: "center", valign: "middle", margin: 0 });
    slide.addText([{ text: it[0], options: { bold: true } }, { text: it[1] ? " " + it[1] : "" }],
      { x: x + 0.45, y, w: textW, h: heights[i], fontFace: B, fontSize: size, color: C.ink, valign: "top", margin: 0 });
    y += heights[i] + gap;
  });
}

// Encadré « À dire » (fond forêt)
function sayBox(slide, lines, opts = {}) {
  const x = opts.x ?? 6.35, y = opts.y ?? 1.25, w = opts.w ?? 3.15, h = opts.h ?? 3.75;
  slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: C.forest } });
  slide.addText("À dire", { x: x + 0.22, y: y + 0.18, w: w - 0.44, h: 0.3, fontFace: B, fontSize: 11, bold: true,
    color: C.gold, charSpacing: 2, margin: 0 });
  slide.addText(lines.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < lines.length - 1 } })),
    { x: x + 0.22, y: y + 0.55, w: w - 0.44, h: h - 0.75, fontFace: B, fontSize: 12, color: C.white,
      valign: "top", paraSpaceAfter: 6, margin: 0 });
}

// Bandeau d'avertissement (bordure dorée)
function caution(slide, text, y = 4.62) {
  slide.addShape(pres.shapes.RECTANGLE, { x: 0.5, y, w: 5.6, h: 0.5, fill: { color: C.white },
    line: { color: C.gold, width: 1.5 } });
  slide.addText([{ text: "Attention  ", options: { bold: true, color: C.gold } }, { text, options: { color: C.ink } }],
    { x: 0.62, y, w: 5.4, h: 0.5, fontFace: B, fontSize: 11, valign: "middle", margin: 0 });
}

function stepSlide(n, t, sub, items, say, opts = {}) {
  const s = pres.addSlide();
  s.background = { color: C.cream };
  stepBadge(s, n);
  title(s, t, sub);
  clicks(s, items, { ...opts, caution: opts.caution });
  sayBox(s, say);
  if (opts.caution) caution(s, opts.caution);
  footer(s, `Étape ${n} · ${opts.duration ?? ""}`.replace(/ · $/, ""));
  return s;
}

// ─── 1. Couverture ───────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.forest };
  s.addShape(pres.shapes.RECTANGLE, { x: 7.1, y: 0, w: 0.45, h: 5.625, fill: { color: C.green } });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 7.75, y: 0.7, w: 1.75, h: 1.75, fill: { color: C.mint }, rectRadius: 0.18 });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 8.12, y: 1.07, w: 1.01, h: 1.01, fill: { color: C.forest }, rectRadius: 0.1 });
  s.addText("N", { x: 8.12, y: 1.07, w: 1.01, h: 1.01, fontFace: H, fontSize: 36, bold: true, color: C.mint,
    align: "center", valign: "middle", margin: 0 });
  s.addText("NIMOVA", { x: 0.6, y: 0.75, w: 6, h: 0.6, fontFace: H, fontSize: 30, bold: true, color: C.white, margin: 0 });
  s.addText("SYSTÈME INTÉGRÉ DE GESTION", { x: 0.6, y: 1.35, w: 6, h: 0.3, fontFace: B, fontSize: 12, bold: true,
    color: C.mint, charSpacing: 3, margin: 0 });
  s.addText("Présenter la plateforme", { x: 0.6, y: 2.05, w: 6.3, h: 0.6, fontFace: H, fontSize: 30, color: C.white, margin: 0 });
  s.addText("Guide pas à pas pour la démonstration au DG, et questions-réponses", { x: 0.6, y: 2.7, w: 6.3, h: 0.7,
    fontFace: B, fontSize: 15, color: C.white, margin: 0 });
  s.addText("EGUITRA GROUP × MB AxisPro Consulting · 16 octobre 2026", { x: 0.6, y: 4.55, w: 6.3, h: 0.3,
    fontFace: B, fontSize: 11, bold: true, color: C.white, margin: 0 });
  s.addText("Recette, données fictives repérées « Démo »", { x: 0.6, y: 4.85, w: 6.3, h: 0.3, fontFace: B,
    fontSize: 10, color: C.mint, margin: 0 });
}

// ─── 2. Mode d'emploi du guide ───────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  title(s, "Comment lire ce guide", "Une diapositive par étape de la démonstration", 0.5);
  const cards = [
    ["À l'écran", "Les clics, dans l'ordre. Les mots entre « » sont écrits tels quels sur l'écran : menu, onglet ou bouton.", C.white, C.ink],
    ["À dire", "Deux à quatre phrases simples pour le DG pendant que l'écran s'affiche.", C.forest, C.white],
    ["Attention", "Ce qu'il ne faut pas cliquer pendant la démonstration.", C.white, C.ink],
  ];
  cards.forEach(([t, d, bg, fg], i) => {
    const x = 0.5 + i * 3.08;
    s.addShape(pres.shapes.RECTANGLE, { x, y: 1.35, w: 2.85, h: 2.2, fill: { color: bg },
      line: { color: i === 2 ? C.gold : (i === 0 ? C.line : C.forest), width: i === 2 ? 1.5 : 1 } });
    s.addText(t, { x: x + 0.22, y: 1.55, w: 2.4, h: 0.35, fontFace: H, fontSize: 16, bold: true,
      color: i === 1 ? C.gold : (i === 2 ? C.gold : C.green), margin: 0 });
    s.addText(d, { x: x + 0.22, y: 2.0, w: 2.4, h: 1.4, fontFace: B, fontSize: 12.5, color: fg, valign: "top", margin: 0 });
  });
  s.addText([
    { text: "La colonne de gauche ", options: { bold: true } },
    { text: "porte la bascule Finance | AxisPro, la société de travail, les écrans par famille et, en bas, votre nom. " },
    { text: "En haut, ", options: { bold: true } },
    { text: "« Rechercher un écran » (Ctrl K) ouvre n'importe quel écran en tapant quelques lettres." },
  ], { x: 0.5, y: 3.85, w: 9, h: 0.8, fontFace: B, fontSize: 13, color: C.ink, margin: 0 });
  footer(s, "Mode d'emploi");
}

// ─── 3. Préparation ──────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  stepBadge(s, 0);
  title(s, "Avant la réunion (15 minutes)", "À faire seul, avant l'arrivée du DG");
  clicks(s, [
    ["Ouvrir Chrome ou Edge", "(pas Safari), puis l'adresse de la recette ci-contre."],
    ["Se connecter :", "identifiant emkouyate, mot de passe provisoire, « Se connecter »."],
    ["Double authentification :", "sur le téléphone, ouvrir Google Authenticator ou Microsoft Authenticator, « + », scanner le code affiché, puis taper le code à 6 chiffres."],
    ["Mot de passe :", "choisir le mot de passe définitif (10 caractères au moins), puis se reconnecter."],
    ["Ouvrir un onglet par étape", "(Ctrl+T) : Tableau de bord, À valider, Transport, Immobilier, Clôtures, et AxisPro (bascule en haut du menu)."],
  ], { size: 12.5 });
  s.addShape(pres.shapes.RECTANGLE, { x: 6.35, y: 1.25, w: 3.15, h: 3.75, fill: { color: C.forest } });
  s.addText("Votre adresse", { x: 6.57, y: 1.43, w: 2.7, h: 0.3, fontFace: B, fontSize: 11, bold: true, color: C.gold,
    charSpacing: 2, margin: 0 });
  s.addText(URL + "/finance", { x: 6.57, y: 1.8, w: 2.75, h: 0.75, fontFace: B, fontSize: 11.5, bold: true,
    color: C.white, valign: "top", margin: 0 });
  s.addText([
    { text: "Identifiant : emkouyate", options: { breakLine: true } },
    { text: "Autres écrans : même adresse suivie de /axispro, /mobile ou /portail.", options: { breakLine: true } },
    { text: "Code refusé ? Attendre le code suivant (il change toutes les 30 secondes)." },
  ], { x: 6.57, y: 2.65, w: 2.75, h: 2.2, fontFace: B, fontSize: 11.5, color: C.white, valign: "top",
    paraSpaceAfter: 6, margin: 0 });
  footer(s, "Préparation");
}

// ─── 4. Repères de l'écran (schéma) ──────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  title(s, "Repères : où se trouve quoi", "Schéma de l'écran d'EGUITRA Finance", 0.5);
  // cadre écran
  s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.2, w: 5.9, h: 3.85, fill: { color: C.white }, line: { color: C.line, width: 1 } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.2, w: 1.75, h: 3.85, fill: { color: C.soft } });
  s.addText("NIMOVA", { x: 0.62, y: 1.27, w: 1.5, h: 0.25, fontFace: H, fontSize: 10, bold: true, color: C.ink, margin: 0 });
  // 1. bascule Finance | AxisPro
  s.addShape(pres.shapes.RECTANGLE, { x: 0.62, y: 1.58, w: 1.5, h: 0.28, fill: { color: C.white }, line: { color: C.line, width: 1 } });
  s.addText("Finance | AxisPro", { x: 0.62, y: 1.58, w: 1.5, h: 0.28, fontFace: B, fontSize: 8.5, bold: true, color: C.ink, align: "center", valign: "middle", margin: 0 });
  // 2. société de travail
  s.addShape(pres.shapes.RECTANGLE, { x: 0.62, y: 1.95, w: 1.5, h: 0.3, fill: { color: C.white }, line: { color: C.green, width: 1 } });
  s.addText("Société ▾", { x: 0.62, y: 1.95, w: 1.5, h: 0.3, fontFace: B, fontSize: 9, color: C.ink, align: "center", valign: "middle", margin: 0 });
  // 3. écrans par famille
  const menu = ["PILOTAGE", "Tableau de bord", "À valider", "COMPTABILITÉ", "Ventes, Trésorerie…", "MÉTIERS", "Transport, Chantiers…", "ADMINISTRATION"];
  s.addText(menu.map((m, i) => ({ text: m, options: { bold: m === m.toUpperCase(), color: m === m.toUpperCase() ? C.green : C.ink, breakLine: i < menu.length - 1 } })),
    { x: 0.62, y: 2.37, w: 1.55, h: 2.05, fontFace: B, fontSize: 8.5, valign: "top", margin: 0, paraSpaceAfter: 2 });
  // 4. compte, en bas de la colonne
  s.addShape(pres.shapes.OVAL, { x: 0.62, y: 4.6, w: 0.3, h: 0.3, fill: { color: C.white }, line: { color: C.green, width: 1 } });
  s.addText("MK", { x: 0.62, y: 4.6, w: 0.3, h: 0.3, fontFace: B, fontSize: 7, bold: true, color: C.green, align: "center", valign: "middle", margin: 0 });
  s.addText("Votre nom", { x: 0.98, y: 4.6, w: 1.2, h: 0.3, fontFace: B, fontSize: 8.5, color: C.ink, valign: "middle", margin: 0 });
  // 5. barre du haut : recherche
  s.addShape(pres.shapes.RECTANGLE, { x: 2.25, y: 1.2, w: 4.15, h: 0.45, fill: { color: C.white }, line: { color: C.line, width: 1 } });
  s.addShape(pres.shapes.RECTANGLE, { x: 3.75, y: 1.28, w: 2.05, h: 0.3, fill: { color: C.soft }, line: { color: C.line, width: 1 } });
  s.addText("Rechercher un écran   Ctrl K", { x: 3.75, y: 1.28, w: 2.05, h: 0.3, fontFace: B, fontSize: 8.5, color: C.muted, align: "center", valign: "middle", margin: 0 });
  s.addText("Contenu de l'écran choisi", { x: 2.4, y: 2.8, w: 3.85, h: 0.5, fontFace: B, fontSize: 12, color: C.muted, align: "center", margin: 0 });
  // légendes
  const legends = [
    ["1", "« Finance | AxisPro »", "passer d'une application à l'autre d'un clic (comptes ouverts aux deux)."],
    ["2", "« Société »", "EGUITRA GROUP SARLU ou MB AxisPro Consulting ; l'écran se recharge."],
    ["3", "Menu", "les écrans, par famille ; un clic ouvre l'écran."],
    ["4", "Votre nom", "en bas à gauche : « Changer le mot de passe », « Se déconnecter »."],
    ["5", "« Rechercher un écran »", "en haut : taper quelques lettres, puis Entrée."],
  ];
  legends.forEach(([n, t, d], i) => {
    const y = 1.2 + i * 0.77;
    s.addShape(pres.shapes.OVAL, { x: 6.7, y, w: 0.36, h: 0.36, fill: { color: C.gold } });
    s.addText(n, { x: 6.7, y, w: 0.36, h: 0.36, fontFace: H, fontSize: 12, bold: true, color: C.forest, align: "center", valign: "middle", margin: 0 });
    s.addText([{ text: t, options: { bold: true, breakLine: true } }, { text: d }],
      { x: 7.15, y: y - 0.04, w: 2.4, h: 0.74, fontFace: B, fontSize: 10, color: C.ink, valign: "top", margin: 0 });
  });
  // repères sur le schéma
  [[2.14, 1.59, "1"], [2.14, 1.97, "2"], [2.14, 2.37, "3"], [2.14, 4.62, "4"], [3.42, 1.3, "5"]].forEach(([x, y, n]) => {
    s.addShape(pres.shapes.OVAL, { x, y, w: 0.26, h: 0.26, fill: { color: C.gold } });
    s.addText(n, { x, y, w: 0.26, h: 0.26, fontFace: H, fontSize: 9, bold: true, color: C.forest, align: "center", valign: "middle", margin: 0 });
  });
  footer(s, "Repères");
}

// ─── Étapes ──────────────────────────────────────────────────────────────
stepSlide(1, "Ouverture", "3 minutes · aucun clic, seulement le tableau de bord à l'écran", [
  ["Afficher l'onglet « Tableau de bord »", "avant que le DG ne s'installe."],
  ["Rappeler sa note :", "centraliser, maîtriser, décider, pour deux structures complémentaires."],
  ["Annoncer le plan :", "finance, approbations, transport, chantiers, immobilier, AxisPro, sécurité, suite."],
], [
  "La plateforme existe et tourne sur un serveur dédié, avec une production et une recette.",
  "Les chiffres affichés aujourd'hui sont fictifs.",
  "L'identité NIMOVA est en cours d'application à tous les écrans.",
], { duration: "3 min" });

stepSlide(2, "Connexion et sécurité", "3 minutes · montrer l'écran de connexion sans vous déconnecter", [
  ["Ouvrir une fenêtre privée :", "Ctrl+Maj+N."],
  ["Taper l'adresse de la recette :", "l'écran de connexion s'affiche."],
  ["Montrer :", "identifiant, mot de passe, puis le code à 6 chiffres du téléphone."],
  ["Fermer la fenêtre privée", "et revenir à l'onglet du tableau de bord."],
], [
  "La double authentification est obligatoire pour tous, porteurs de projets compris.",
  "Chaque profil ne voit que son périmètre ; toutes les connexions sont journalisées.",
  "Personne ne travaille dans Odoo : c'est le moteur comptable, invisible.",
], { duration: "3 min" });

stepSlide(3, "Deux sociétés, un seul compte", "3 minutes · la promesse faite au client", [
  ["Colonne de gauche, carte « Société » :", "choisir « MB AxisPro Consulting ». L'écran se recharge : autres chiffres, autre comptabilité."],
  ["Revenir à « EGUITRA GROUP SARLU ».", ""],
  ["Sur le tableau de bord, cliquer « Groupe consolidé » :", "les deux sociétés réunies."],
  ["Recliquer sur la société", "pour revenir à une seule."],
], [
  "Un même compte peut ouvrir les deux sociétés ; les comptabilités restent séparées.",
  "Plans de comptes, journaux et numérotations sont propres à chaque société.",
  "La vue consolidée est réservée à la direction et à la finance.",
], { duration: "3 min" });

{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  stepBadge(s, 4);
  title(s, "Tableau de bord du dirigeant", "5 minutes · menu Pilotage > « Tableau de bord »");
  const stats = [["3,66 Md", "chiffre d'affaires 2026"], ["0,87 Md", "résultat de l'exercice"], ["0,99 Md", "trésorerie"], ["1,26 Md", "créances, dont 158 M échues"]];
  stats.forEach(([v, l], i) => {
    const x = 0.5 + i * 2.27;
    s.addShape(pres.shapes.RECTANGLE, { x, y: 1.25, w: 2.07, h: 1.2, fill: { color: C.white }, line: { color: C.line, width: 1 } });
    s.addText(v, { x: x + 0.15, y: 1.35, w: 1.8, h: 0.55, fontFace: H, fontSize: 24, bold: true, color: C.green, margin: 0 });
    s.addText(l, { x: x + 0.15, y: 1.92, w: 1.8, h: 0.45, fontFace: B, fontSize: 10.5, color: C.muted, valign: "top", margin: 0 });
  });
  s.addText("GNF, EGUITRA GROUP SARLU, chiffres fictifs", { x: 0.5, y: 2.5, w: 9, h: 0.25, fontFace: B, fontSize: 9, italic: true, color: C.muted, margin: 0 });
  s.addText([
    { text: "Montrer, de haut en bas : ", options: { bold: true, color: C.green } },
    { text: "chiffre d'affaires, résultat, trésorerie par compte, créances par ancienneté.", options: { breakLine: true } },
    { text: "Menu « Alertes » : ", options: { bold: true, color: C.green } },
    { text: "« Clôture en retard » : septembre n'est pas encore clôturé. Les seuils se règlent dans Administration.", options: { breakLine: true } },
    { text: "Menu « Rapport mensuel » : ", options: { bold: true, color: C.green } },
    { text: "la synthèse du mois, à imprimer pour la direction." },
  ], { x: 0.5, y: 2.9, w: 9, h: 1.9, fontFace: B, fontSize: 13, color: C.ink, valign: "top", paraSpaceAfter: 8, margin: 0 });
  footer(s, "Étape 4 · 5 min");
}

stepSlide(5, "Approuver une dépense en direct", "5 minutes · menu Pilotage > « À valider »", [
  ["Onglet « Ma corbeille » :", "deux pièces d'achat saisies par le comptable."],
  ["Cliquer la pièce de 17,7 M (pneus) :", "un seul niveau, la finance."],
  ["Écrire un commentaire", "puis « Approuver » : la pièce est comptabilisée."],
  ["Cliquer la pièce de 85 M (gasoil) :", "deux niveaux, finance puis direction. « Approuver », puis « Approuver » au niveau suivant."],
], [
  "Toute pièce d'achat passe par la finance ; au-delà de 50 M, aussi par la direction.",
  "Personne n'approuve sa propre pièce.",
  "Une pièce modifiée après accord repart dans le circuit.",
  "Les seuils sont réglables.",
], { duration: "5 min", caution: "« Refuser » exige un motif : ne pas l'utiliser pendant la démonstration." });

stepSlide(6, "Ventes et trésorerie", "4 minutes · menu Comptabilité", [
  ["« Ventes » :", "cliquer une facture « Démo - Distributeur pétrolier A »."],
  ["Bouton « PDF » :", "la facture imprimée, avec l'identité de la société, le NIF et le RCCM."],
  ["« Nouvelle facture » :", "montrer la saisie (client, lignes, TVA), puis fermer sans enregistrer."],
  ["« Trésorerie » :", "position par compte ; « Importer » un relevé de banque ; les opérations « À rapprocher »."],
], [
  "Une facture saisie une fois alimente la comptabilité, la TVA et les tableaux de bord.",
  "Les relevés bancaires s'importent depuis un fichier Excel ou CSV de la banque.",
  "Le rapprochement propose les pièces correspondantes.",
], { duration: "4 min" });

stepSlide(7, "Le suivi financier", "4 minutes · menu Comptabilité", [
  ["« Relances clients » :", "rappel, relance ferme, mise en demeure ; bouton « Imprimer » pour la lettre."],
  ["« Immobilisations » :", "deux biens amortis chaque mois sans intervention."],
  ["« Dette et financement » :", "emprunt d'un milliard, échéancier, échéances réglées."],
  ["« Balance et états » :", "bilan, compte de résultat, tableau des flux SYSCOHADA ; export Excel."],
  ["« Fiscalité » :", "TVA du mois ; export complet pour l'auditeur."],
], [
  "Les relances sont calculées chaque jour ; une mise en demeure n'est jamais envoyée sans décision.",
  "Les états sont au format SYSCOHADA révisé.",
  "Tout s'exporte en Excel.",
], { duration: "4 min" });

stepSlide(8, "Clôtures et contrôles d'intégrité", "3 minutes · menu Comptabilité > « Clôtures et contrôles »", [
  ["Faire défiler jusqu'à « Contrôles d'intégrité » :", "les contrôles du mois écoulé."],
  ["Cliquer un mois ouvert, puis « Lancer les contrôles » :", "équilibres, brouillons, rapprochement, ordre des mois."],
  ["Fermer la fenêtre", "sans clôturer."],
], [
  "Une clôture verrouille les écritures du mois et les chaîne par une empreinte.",
  "Une écriture modifiée hors de la plateforme serait signalée.",
  "Une réouverture est motivée et tracée.",
], { duration: "3 min", caution: "Ne jamais cliquer « Clôturer le mois » pendant la démonstration." });

stepSlide(9, "Transport", "5 minutes · menu Métiers > « Transport »", [
  ["Onglet « Rentabilité » :", "marge par ensemble routier, par route, par client et par mois."],
  ["Montrer la route Conakry - Labé :", "environ 10 % de marge, contre plus de 60 % ailleurs."],
  ["Onglet « Rotations » :", "« Saisies à valider », puis « Validées, à facturer »."],
  ["« Nouvelle rotation » :", "montrer le formulaire (camion, client, route, volumes, frais), puis fermer."],
], [
  "La rotation est saisie une seule fois : elle fait la facture et la rentabilité.",
  "Le tarif vient du contrat du client, sinon du tarif de la route.",
  "Une facture par client, une ligne par rotation.",
], { duration: "5 min" });

stepSlide(10, "Rotations, l'application du parc", "3 minutes · sur un téléphone, ou l'ordinateur en mode téléphone", [
  ["Téléphone :", "ouvrir l'adresse suivie de /mobile, se connecter, puis « Ajouter à l'écran d'accueil »."],
  ["Ordinateur :", "touche F12, puis Ctrl+Maj+M pour l'affichage téléphone."],
  ["« Nouvelle » :", "camion, client, route, volume, puis « Enregistrer la rotation »."],
  ["Couper le réseau", "(mode avion, ou F12 > Réseau > « Hors connexion ») et saisir une autre rotation : elle attend dans « À envoyer »."],
  ["Rétablir le réseau :", "elle part seule, sans doublon."],
], [
  "Au parc, même sans réseau, la saisie n'est jamais perdue.",
  "Le téléphone ne garde ni tarifs ni marges.",
  "Le bureau valide, puis facture.",
], { duration: "3 min", size: 12 });

stepSlide(11, "Chantiers et immobilier", "4 minutes · menu Métiers", [
  ["« Chantiers » :", "cliquer « Entrepôt de stockage (démo) » : situations d'avancement, retenue de garantie de 5 %."],
  ["« Immobilier », onglet « Biens et baux » :", "les bureaux de Kaloum sont loués."],
  ["Onglet « Loyers émis » :", "trois loyers émis chaque mois sans intervention ; « Quittance » sur le loyer d'août, réglé."],
  ["Onglet « Impayés et relances » :", "les loyers de septembre et d'octobre."],
], [
  "Chaque chantier a sa marge ; la retenue de garantie est suivie jusqu'à sa libération.",
  "Les loyers sont facturés chaque jour, avec rattrapage.",
  "La quittance n'est délivrée que pour un loyer réglé.",
], { duration: "4 min" });

stepSlide(12, "AxisPro, le cabinet", "6 minutes · bascule « AxisPro » en haut du menu", [
  ["Accueil « Dossiers de projets » :", "entonnoir par étape, recommandations ; cliquer la carte « Usine de briques compressées (démo) »."],
  ["« Synthèse » :", "score, recommandation, critères éliminatoires, étapes (« Stage gates »)."],
  ["« Data room » :", "les pièces attendues et déposées ; « Déposer » pour en ajouter."],
  ["« Comités » :", "décisions verrouillées ; « Rapport » : « Imprimer le rapport de décision »."],
  ["« Temps et facturation » :", "« Saisir du temps », puis « Créer la facture »."],
], [
  "La grille montrée est une grille de démonstration de 10 critères.",
  "La grille officielle (111 critères) s'importera depuis le classeur du cabinet.",
  "Chaque dossier garde la version de la grille en vigueur à son ouverture.",
], { duration: "6 min", size: 12.5 });

stepSlide(13, "Le portail du porteur (facultatif)", "3 minutes · compte de démonstration prêt", [
  ["Compte prêt :", "identifiant porteur.demo, dossier « Usine de briques compressées (démo) » ; mot de passe remis à part."],
  ["Dans une fenêtre privée (Ctrl+Maj+N) :", "adresse suivie de /portail, identifiant, mot de passe, « Se connecter »."],
  ["Première connexion :", "scanner le code QR avec l'application d'authentification, puis taper le code à 6 chiffres."],
  ["Montrer :", "son avancement par étape, ses pièces à fournir, ses échanges avec le cabinet."],
  ["Pour un vrai porteur :", "dans le dossier, carte « Accès du porteur au portail », puis « Ouvrir l'accès »."],
], [
  "Le porteur ne voit que son dossier.",
  "Il dépose ses pièces et échange avec son consultant.",
  "Il ne voit jamais le score détaillé ni les notes internes du cabinet.",
], { duration: "3 min" });

stepSlide(14, "Administration et sûreté", "3 minutes · menu Administration", [
  ["« Utilisateurs » :", "profils et sociétés de chaque compte, double authentification activée ou non."],
  ["« Sociétés » :", "raison sociale, NIF, RCCM, logo : ce qui s'imprime sur les factures."],
  ["« Journal d'audit » :", "qui a modifié quoi, avec les valeurs avant et après."],
], [
  "Sauvegarde continue : 15 minutes de données au plus en cas de sinistre.",
  "Test de restauration automatique chaque mois.",
  "Supervision toutes les 5 minutes.",
  "Aucune licence, ni par utilisateur.",
], { duration: "3 min" });

{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  stepBadge(s, 15);
  title(s, "La suite et les décisions", "5 minutes · conclure par ce qu'on attend du DG");
  const rows = [
    ["Identité NIMOVA", "Appliquée à tous les écrans avant la recette.", "Valider l'identité"],
    ["Nom de domaine", "nimovagroup.com (nimova.com est déjà pris).", "Enregistrer le domaine"],
    ["Reprise 2026", "Classeur et relevés bancaires repris, balances comparées.", "Remettre le classeur"],
    ["Utilisateurs", "Comptes créés par profil et par société.", "Liste des utilisateurs"],
    ["Plan de comptes", "Validation des états avec l'expert-comptable.", "Contact de l'expert"],
    ["Modules hors contrat", "Stocks et carburant, maintenance, RH, commandes, devis.", "Chiffrage séparé"],
  ];
  const tbl = [[
    { text: "Sujet", options: { bold: true, color: C.white, fill: { color: C.forest } } },
    { text: "Ce qui se passe", options: { bold: true, color: C.white, fill: { color: C.forest } } },
    { text: "Ce qu'il faut du client", options: { bold: true, color: C.white, fill: { color: C.forest } } },
  ]].concat(rows.map((r, i) => r.map((c, j) => ({ text: c, options: {
    bold: j === 0, color: C.ink, fill: { color: i % 2 ? C.white : C.soft } } }))));
  s.addTable(tbl, { x: 0.5, y: 1.25, w: 9, colW: [2.1, 4.4, 2.5], fontFace: B, fontSize: 11.5,
    border: { type: "solid", pt: 0.5, color: C.line }, rowH: 0.42, valign: "middle" });
  footer(s, "Étape 15 · 5 min");
}

// ─── Dépannage ───────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.cream };
  title(s, "En cas de souci", "Les réflexes à avoir pendant la démonstration", 0.5);
  const items = [
    ["Retour à l'écran de connexion", "La session a expiré : se reconnecter (identifiant, mot de passe, code)."],
    ["Code à 6 chiffres refusé", "Attendre le code suivant sur le téléphone (30 secondes)."],
    ["« Accès non autorisé »", "Vérifier la société choisie à gauche ; certaines pages sont réservées à un profil."],
    ["Écran vide ou figé", "Recharger la page : touche F5."],
    ["Mauvaise société affichée", "Carte « Société » dans la colonne de gauche (EGUITRA Finance)."],
    ["Adresse injoignable", "Dernier recours : le tunnel SSH et http://localhost:3100."],
  ];
  items.forEach(([t, d], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.5 + col * 4.6, y = 1.25 + row * 1.25;
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 4.4, h: 1.08, fill: { color: C.white }, line: { color: C.line, width: 1 } });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.09, h: 1.08, fill: { color: C.gold } });
    s.addText(t, { x: x + 0.25, y: y + 0.1, w: 4.05, h: 0.32, fontFace: B, fontSize: 12.5, bold: true, color: C.green, margin: 0 });
    s.addText(d, { x: x + 0.25, y: y + 0.45, w: 4.05, h: 0.55, fontFace: B, fontSize: 11.5, color: C.ink, valign: "top", margin: 0 });
  });
  footer(s, "Dépannage");
}

// ─── Questions-réponses ──────────────────────────────────────────────────
const QA = [
  ["Transport", [
    ["Comment voit-on si un camion est rentable ?", "Chaque rotation porte son chiffre d'affaires (tarif au m³ × volume) et ses coûts : carburant, péages, frais du chauffeur, entretien. Transport > « Rentabilité » donne la marge par camion, route, client et mois."],
    ["Et les manquants entre chargé et livré ?", "Chaque rotation calcule le manquant en m³ ; il apparaît dans les rotations et la rentabilité."],
    ["Et si le chauffeur n'a pas de réseau ?", "Rotations fonctionne hors ligne : la saisie attend sur le téléphone et part au retour du réseau, sans doublon."],
    ["Qui fixe le prix d'une rotation ?", "Pas le parc : le tarif négocié du client sur la route, sinon le tarif de la route. Le bureau valide avant facturation."],
  ]],
  ["Transport et logistique", [
    ["Comment facture-t-on nos clients ?", "On sélectionne les rotations validées d'un client : une facture par client, une ligne par rotation, TVA comprise."],
    ["Suivez-vous le carburant et la maintenance ?", "Les coûts de carburant et d'entretien sont suivis par rotation et par facture fournisseur. Un stock de carburant et des plans de maintenance seraient des modules supplémentaires, à chiffrer."],
    ["Peut-on suivre la disponibilité de la flotte ?", "Chaque ensemble a un état : en service, en maintenance, hors service. Le tableau Transport en fait la synthèse."],
    ["Et les permis des chauffeurs ?", "La fiche du chauffeur porte le numéro et la validité du permis."],
  ]],
  ["Chantiers et immobilier", [
    ["Comment gérez-vous la retenue de garantie ?", "5 % par défaut, portés en 4117 à chaque situation, puis libérés à la réception : ils redeviennent exigibles du client."],
    ["Peut-on facturer à l'avancement ?", "Oui : une situation en pourcentage ou en montant cumulé ; la finance émet la facture de la période."],
    ["Les loyers partent-ils tout seuls ?", "Oui, chaque jour : une facture par échéance, avec rattrapage. Les impayés entrent dans les relances ; la quittance s'imprime une fois le loyer réglé."],
    ["Et la valeur de notre patrimoine ?", "Chaque bien a sa valeur actuelle et sa date d'évaluation ; l'écran calcule le rendement brut."],
  ]],
  ["Finance et comptabilité", [
    ["Est-ce conforme au SYSCOHADA ?", "Oui : plan SYSCOHADA révisé de la Guinée (1 142 comptes), bilan, compte de résultat et tableau des flux au format SYSCOHADA. L'expert-comptable valide le plan avant la mise en production."],
    ["Et la TVA ?", "TVA à 18 % calculée à la saisie ; l'écran Fiscalité donne la TVA collectée et déductible du mois, et un export complet pour l'auditeur."],
    ["Peut-on modifier une écriture validée ?", "Avant clôture, on corrige par un avoir ou une extourne. Après clôture, les écritures sont verrouillées et chaînées ; une réouverture est motivée et tracée."],
    ["Qui valide nos dépenses ?", "Toute pièce d'achat par la finance, au-delà de 50 M aussi par la direction ; les règlements de plus de 100 M par la direction. Les seuils sont réglables."],
  ]],
  ["Pilotage", [
    ["Voit-on la trésorerie en temps réel ?", "Oui : la position par compte et par devise, mise à jour par la saisie et l'import des relevés bancaires."],
    ["Peut-on voir les deux sociétés ensemble ?", "Oui, la vue « Groupe consolidé », réservée à la direction et à la finance. Chaque société garde sa comptabilité."],
    ["Et le budget ?", "Budget par compte et par mois, comparé au réalisé, avec une alerte au-delà du seuil de dépassement."],
    ["Et nos emprunts ?", "Échéancier de chaque emprunt ou crédit-bail, échéances réglées, capital restant dû et couverture de la dette."],
  ]],
  ["AxisPro", [
    ["Notre grille d'évaluation sera-t-elle respectée ?", "Elle s'importe depuis votre classeur (111 critères, 15 domaines, 8 étapes) et reste modifiable par le cabinet. Chaque version est conservée."],
    ["Le porteur voit-il nos analyses ?", "Non : il voit son avancement, ses pièces à fournir et les échanges, jamais le score détaillé ni les notes internes."],
    ["Peut-on facturer notre temps ?", "Oui : temps par dossier, puis facture d'honoraires dans la comptabilité du cabinet."],
    ["Le groupe voit-il les dossiers du cabinet ?", "Non : un compte ne voit que les sociétés qui lui sont ouvertes, jusque dans les pièces et les comités."],
  ]],
  ["Le système (1/2)", [
    ["Combien d'utilisateurs peut-on avoir ?", "Autant que nécessaire : aucune licence, ni à l'achat ni par utilisateur."],
    ["Combien cela coûte-t-il ?", "50 000 000 GNF HT, hébergement de la première année compris ; puis 9 000 000 GNF HT par an pour l'hébergement, l'exploitation, le support et la maintenance."],
    ["Où sont nos données ?", "Sur un serveur dédié en France (OVHcloud). Sauvegarde continue, restauration testée chaque mois ; copie chiffrée chez un second hébergeur dès que son espace est fourni."],
    ["À qui appartient le système ?", "Au client : données et code développé pour lui. Une copie complète est remise sur simple demande, dans des formats ouverts."],
  ]],
  ["Le système (2/2)", [
    ["C'est Odoo ?", "Odoo Community est le moteur comptable, libre et sans licence. Les écrans, les règles et les profils sont faits pour vous ; personne ne travaille dans Odoo."],
    ["Et si internet tombe ?", "Les écrans du bureau ont besoin d'internet ; Rotations fonctionne hors ligne. Le serveur est engagé à 99,5 % de disponibilité."],
    ["Quand peut-on l'utiliser pour de vrai ?", "Après la reprise de l'exercice 2026, la recette avec vos référents et la formation par profil, dans le délai de 4 semaines du contrat."],
    ["Et les stocks, la paie, la banque en ligne ?", "Hors du contrat signé : ils se chiffrent à part. La plateforme est conçue pour ajouter des modules sans refonte."],
  ]],
];

QA.forEach(([theme, qas], idx) => {
  const s = pres.addSlide();
  s.background = { color: C.cream };
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.95, fill: { color: C.forest } });
  s.addText("Questions-réponses", { x: 0.5, y: 0.14, w: 5, h: 0.3, fontFace: B, fontSize: 11, bold: true, color: C.gold,
    charSpacing: 2, margin: 0 });
  s.addText(theme, { x: 0.5, y: 0.42, w: 9, h: 0.45, fontFace: H, fontSize: 22, bold: true, color: C.white, margin: 0 });
  qas.forEach(([q, a], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.5 + col * 4.6, y = 1.15 + row * 2.0;
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 4.4, h: 1.85, fill: { color: C.white }, line: { color: C.line, width: 1 } });
    s.addText(q, { x: x + 0.2, y: y + 0.12, w: 4.0, h: 0.5, fontFace: B, fontSize: 12.5, bold: true, color: C.green,
      valign: "top", margin: 0 });
    s.addText(a, { x: x + 0.2, y: y + 0.62, w: 4.0, h: 1.15, fontFace: B, fontSize: 11.5, color: C.ink, valign: "top", margin: 0 });
  });
  footer(s, `Questions-réponses ${idx + 1}/${QA.length}`);
});

// ─── Fin ─────────────────────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.forest };
  s.addText("NIMOVA", { x: 0.6, y: 1.7, w: 8.8, h: 0.7, fontFace: H, fontSize: 36, bold: true, color: C.white, margin: 0 });
  s.addText("La maîtrise intégrée de votre performance.", { x: 0.6, y: 2.45, w: 8.8, h: 0.5, fontFace: H, fontSize: 18,
    italic: true, color: C.mint, margin: 0 });
  s.addText("EGUITRA GROUP × MB AxisPro Consulting · E-VOLUTION XP", { x: 0.6, y: 4.6, w: 8.8, h: 0.3, fontFace: B,
    fontSize: 11, color: C.white, margin: 0 });
}

pres.writeFile({ fileName: OUT }).then((f) => console.log("Écrit : " + f));
