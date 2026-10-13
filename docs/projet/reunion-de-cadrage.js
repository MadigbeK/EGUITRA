const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, AlignmentType, VerticalAlign } = require('docx');

const NAVY = '1C1E6B', TEAL = '1A9E9E', GREY = 'F2F4F7', FONT = 'Calibri', W = 9638;
const run = (t, o = {}) => new TextRun({ text: t, font: FONT, size: o.size || 20, bold: o.bold, color: o.color, italics: o.italics });
const para = (t, o = {}) => new Paragraph({ children: [run(t, o)], spacing: { after: o.after ?? 80, before: o.before ?? 0 }, alignment: o.align });
const h = (t) => new Paragraph({ children: [run(t, { size: 24, bold: true, color: NAVY })], spacing: { before: 200, after: 80 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: TEAL, space: 2 } } });
const cb = { style: BorderStyle.SINGLE, size: 4, color: 'C9CFD8' };
const borders = { top: cb, bottom: cb, left: cb, right: cb };
function table(head, rows, widths) {
  const mk = (t, i, o = {}) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, borders, verticalAlign: VerticalAlign.CENTER,
    shading: o.shade ? { type: ShadingType.CLEAR, fill: o.shade, color: 'auto' } : undefined, margins: { top: 50, bottom: 50, left: 90, right: 90 },
    children: [new Paragraph({ children: [run(String(t), { size: 18, bold: o.bold, color: o.color })], spacing: { after: 0 } })] });
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths, rows: [
    new TableRow({ tableHeader: true, children: head.map((x, i) => mk(x, i, { shade: NAVY, bold: true, color: 'FFFFFF' })) }),
    ...rows.map((r, ri) => new TableRow({ children: r.map((c, i) => mk(c, i, { shade: ri % 2 ? GREY : undefined })) })),
  ] });
}
const gap = () => new Paragraph({ spacing: { after: 60 }, children: [] });

const children = [
  new Paragraph({ children: [run('Réunion de cadrage', { size: 36, bold: true, color: NAVY })], spacing: { after: 40 } }),
  para('Plateforme EGUITRA Finance et AxisPro Suite. 20 minutes.', { size: 22, color: '444444', after: 40 }),
  para('Date : ____________    Lieu : ____________    Animateur : Madigbè KOUYATÉ, E-VOLUTION XP', { size: 18, color: '666666', after: 40 }),
  para('Participants : ______________________________________________________________', { size: 18, color: '666666', after: 120 }),

  h('Ordre du jour'),
  table(['Min', 'Point', 'À acter'], [
    ['3', 'Objectif et périmètre', 'Une plateforme, deux applications, mise en production en 4 semaines.'],
    ['5', 'Démarrage et date contractuelle', 'Acompte encaissé le ______. Prérequis remis : oui / non. T0 = ______. Date contractuelle = T0 + 4 semaines = ______.'],
    ['5', 'Organisation', 'Référents nommés ci-dessous. Comité de pilotage hebdomadaire : ______ à ______. Point quotidien de 15 min : ______. Espace de suivi des demandes : ______.'],
    ['4', 'Prérequis à remettre', 'Liste ci-dessous, une date par pièce manquante.'],
    ['3', 'Prochaines étapes', 'Ateliers par domaine cette semaine. Dossier de conception signé le ______. Liste des modules arrêtée le ______.'],
  ], [700, 2900, 6038]),
  gap(),

  h('Référents, une demi-journée par jour pendant 4 semaines'),
  table(['Domaine', 'Nom', 'Téléphone', 'Créneau'], [
    ['Direction générale', '', '', ''], ['Finance et comptabilité', '', '', ''], ['Exploitation transport', '', '', ''],
    ['Chantiers', '', '', ''], ['Immobilier', '', '', ''], ['Cabinet AxisPro', '', '', ''], ['Expert-comptable, semaine 2', '', '', ''],
  ], [2900, 2800, 1900, 2038]),
  gap(),

  h('Prérequis à remettre'),
  table(['', 'Pièce', 'Remise le'], [
    ['☐', 'Charte graphique et logos haute définition du groupe et du cabinet', ''],
    ['☐', 'Classeur de l\'exercice 2026, dernière version, avec sa date d\'arrêté', ''],
    ['☐', 'Relevés bancaires des 3 banques depuis le 1er janvier 2026', ''],
    ['☐', 'Modèles de déclarations fiscales en vigueur', ''],
    ['☐', 'Plan de comptes actuel et contact de l\'expert-comptable', ''],
    ['☐', 'Liste des utilisateurs par profil, e-mail et téléphone', ''],
    ['☐', 'Grille AxisPro, liste des pièces de la data room, dossiers en cours', ''],
    ['☐', 'Accès aux noms de domaine', ''],
  ], [500, 7338, 1800]),
  gap(),

  h('Décisions et actions'),
  table(['Action', 'Responsable', 'Échéance'], [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']], [5838, 2200, 1600]),
  gap(),
  para('Rappel : tout retard côté client (référent absent, pièce manquante) est constaté au comité de pilotage et décale la date contractuelle. Toute demande hors périmètre est notée dans l\'espace de suivi pour avenant.', { size: 17, italics: true, color: '666666', before: 60 }),
];

const doc = new Document({
  creator: 'E-VOLUTION XP', title: 'Réunion de cadrage',
  styles: { default: { document: { run: { font: FONT, size: 20 } } } },
  sections: [{ properties: { page: { margin: { top: 900, bottom: 800, left: 1134, right: 1134 } } }, children }],
});
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(require('path').join(__dirname, 'Reunion_de_cadrage.docx'), b); console.log('OK'); });
