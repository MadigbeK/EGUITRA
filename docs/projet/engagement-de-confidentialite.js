// Génère docs/projet/Engagement_de_confidentialite.docx : engagement du prestataire, signé avant la
// remise des données réelles du client (complète l'accord de confidentialité réciproque).
// Une page, sobre : le logo, un titre, six articles en texte suivi, les signatures. Une seule police
// (Garamond), la hiérarchie par la taille et la graisse, le bleu du logo pour le seul titre.
// Usage : node docs/projet/engagement-de-confidentialite.js
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, Footer, TableLayoutType,
} = require('docx');

const POLICE = 'Garamond', ENCRE = '222222', NUIT = '1D1D69', GRIS = '6B6B6B';
const A4 = { width: 11906, height: 16838 };
const MARGE = 1500;
const W = A4.width - 2 * MARGE;

const run = (text, o = {}) => new TextRun({
  text: text.replace(/'/g, '’'), font: POLICE, size: o.size ?? 23, bold: o.bold, italics: o.italics, color: o.color ?? ENCRE,
});
const para = (enfants, o = {}) => new Paragraph({
  children: Array.isArray(enfants) ? enfants : [enfants],
  alignment: o.align ?? AlignmentType.LEFT,
  spacing: { before: o.avant ?? 0, after: o.apres ?? 150, line: 276 },
});
const article = (n, titre, texte) => para([run(`${n}. ${titre}. `, { bold: true }), run(texte)]);

const c = [];
c.push(new Paragraph({ spacing: { after: 560 }, children: [new ImageRun({
  type: 'png', data: fs.readFileSync(path.join(__dirname, 'assets', 'logo-evolution-xp.png')),
  transformation: { width: 104, height: 61 },
  altText: { title: 'E-VOLUTION XP', description: 'Logo E-VOLUTION XP', name: 'logo' },
})] }));

c.push(para(run('Engagement de confidentialité', { size: 40, color: NUIT }), { align: AlignmentType.LEFT, apres: 360 }));

c.push(para(run('E-volution Experience (E-VOLUTION XP), représentée par M. Madigbè KOUYATÉ, gérant, s\'engage envers EGUITRA GROUP SARLU et MB AxisPro, représentées par M. Mohamed NIMAGA, directeur général (ensemble « le Client »), à protéger les données que le Client lui confie pour la plateforme NIMOVA (offre OTF-EGUITRA-2026-37 du 29 septembre 2026), dans les conditions suivantes. Cet engagement complète l\'accord de confidentialité réciproque ; en cas de différence, la règle la plus protectrice pour le Client s\'applique.'), { apres: 240 }));

c.push(article(1, 'Données concernées', 'Toutes les données du Client, quel qu\'en soit le support : comptabilité, banque et trésorerie, transport, contrats, clients et fournisseurs, données personnelles des salariés, des chauffeurs et des porteurs de projets, dossiers et méthode d\'évaluation AxisPro, identifiants et accès.'));
c.push(article(2, 'Usage', 'Ces données servent uniquement au projet : reprise de l\'historique, paramétrage, essais et support. Elles ne sont ni vendues, ni communiquées à un tiers, ni réutilisées pour un autre client.'));
c.push(article(3, 'Accès et conservation', 'Seules les personnes désignées par le prestataire, tenues par le même engagement, y ont accès. Les données sont hébergées sur le serveur dédié du projet, dans l\'Union européenne, avec une connexion et des sauvegardes chiffrées. Les copies de travail restent sur un poste chiffré le temps nécessaire. Les démonstrations utilisent des données fictives, et un essai sur données réelles se fait sur une base temporaire, effacée ensuite.'));
c.push(article(4, 'Outils', 'Les outils d\'assistance, y compris d\'intelligence artificielle, sont utilisés dans un cadre professionnel et réglés pour que les données ne servent pas à entraîner leurs modèles.'));
c.push(article(5, 'Incident', 'Toute perte, erreur d\'envoi ou tout accès non autorisé est signalé par écrit au Client dans les 48 heures.'));
c.push(article(6, 'Fin de mission et durée', 'Les copies de travail sont supprimées dans les 30 jours qui suivent la validation de la reprise, ou à la demande du Client. Les données de la plateforme restent sa propriété et lui sont remises sur demande. L\'engagement vaut dès sa signature, pendant tout le projet puis cinq ans après ; sans limite de durée pour la méthode AxisPro et les secrets d\'affaires du Client.'));

c.push(para(run('Fait à Conakry, le ____________________, en deux exemplaires.'), { avant: 360, apres: 420, align: AlignmentType.LEFT }));

const aucun = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const sansBord = { top: aucun, bottom: aucun, left: aucun, right: aucun };
const moitie = W / 2;
const bloc = (lignes) => new TableCell({
  width: { size: moitie, type: WidthType.DXA }, borders: sansBord,
  children: lignes.map(([texte, o]) => para(run(texte, o), { align: AlignmentType.LEFT, apres: 20 })),
});
c.push(new Table({
  width: { size: W, type: WidthType.DXA }, columnWidths: [moitie, moitie], layout: TableLayoutType.FIXED,
  borders: { top: aucun, bottom: aucun, left: aucun, right: aucun, insideHorizontal: aucun, insideVertical: aucun },
  rows: [new TableRow({ cantSplit: true, children: [
    bloc([['Pour E-VOLUTION XP', { bold: true }], ['Madigbè KOUYATÉ, gérant', { color: GRIS }]]),
    bloc([['Pour le Client, pris connaissance', { bold: true }], ['Mohamed NIMAGA, directeur général', { color: GRIS }]]),
  ] })],
}));
// Word exige un paragraphe après le dernier tableau.
c.push(new Paragraph({ children: [run('', { size: 2 })], spacing: { before: 0, after: 0, line: 20, lineRule: 'exact' } }));

const doc = new Document({
  creator: 'E-VOLUTION XP', title: 'Engagement de confidentialité',
  styles: { default: { document: { run: { font: POLICE, size: 23, color: ENCRE } } } },
  sections: [{
    properties: { page: { size: A4, margin: { top: 1100, bottom: 1100, left: MARGE, right: MARGE, footer: 560 } } },
    footers: { default: new Footer({ children: [para(
      run('E-volution Experience, Conakry, République de Guinée, +224 628 86 22 55, emkouyate@e-volutionxp.com', { size: 16, color: GRIS }),
      { align: AlignmentType.CENTER, apres: 0 },
    )] }) },
    children: c,
  }],
});
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(path.join(__dirname, 'Engagement_de_confidentialite.docx'), b); console.log('OK'); });
