// Génère Dossier_de_conception.docx à partir de dossier-de-conception.md (source unique du texte).
//   node docs/projet/dossier-de-conception.js
// Markdown pris en charge : titre (#), sections (##), paragraphes, listes à puces et numérotées,
// tableaux, gras (**…**) et code (`…`), comme dans la source.
const fs = require('fs');
const path = require('path');
const {
  AlignmentType, BorderStyle, Document, Footer, ImageRun, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell,
  TableRow, TextRun, VerticalAlign, WidthType,
} = require('docx');

const NAVY = '1C1E6B', TEAL = '1A9E9E', GREY = 'F2F4F7', FONT = 'Calibri', W = 9638;
const SRC = path.join(__dirname, 'dossier-de-conception.md');
const OUT = path.join(__dirname, 'Dossier_de_conception.docx');
const LOGO = path.join(__dirname, '..', 'offre', 'logo-rendu.png');

// Texte en ligne : **gras** et `code` ; le reste tel quel.
function runs(text, o = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: FONT, size: o.size || 20, bold: o.bold, color: o.color, italics: o.italics }));
    const t = m[0];
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), font: FONT, size: o.size || 20, bold: true, color: o.color, italics: o.italics }));
    else out.push(new TextRun({ text: t.slice(1, -1), font: 'Consolas', size: (o.size || 20) - 2, color: o.color || '333333' }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: FONT, size: o.size || 20, bold: o.bold, color: o.color, italics: o.italics }));
  return out;
}

const para = (text, o = {}) => new Paragraph({ children: runs(text, o), spacing: { after: o.after ?? 100, before: o.before ?? 0 }, alignment: o.align ?? AlignmentType.JUSTIFIED });
const heading = (text) => new Paragraph({
  children: runs(text, { size: 26, bold: true, color: NAVY }), spacing: { before: 280, after: 100 }, keepNext: true,
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: TEAL, space: 2 } },
});
const item = (text, marker, level = 0) => new Paragraph({
  children: [new TextRun({ text: `${marker}\t`, font: FONT, size: 20, color: TEAL, bold: true }), ...runs(text)],
  indent: { left: 360 + level * 360, hanging: 360 }, tabStops: [{ type: 'left', position: 360 + level * 360 }],
  spacing: { after: 60 }, alignment: AlignmentType.JUSTIFIED,
});

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'C9CFD8' };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
function table(head, rows) {
  // Largeurs proportionnelles à la longueur moyenne du texte de chaque colonne (bornées).
  const n = head.length;
  const weight = head.map((h, i) => Math.min(60, Math.max(8, [h, ...rows.map((r) => r[i] || '')].reduce((a, t) => a + t.length, 0) / (rows.length + 1))));
  const total = weight.reduce((a, b) => a + b, 0);
  const widths = weight.map((w) => Math.round((w / total) * W));
  const cell = (t, i, o = {}) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, borders, verticalAlign: VerticalAlign.CENTER,
    shading: o.shade ? { type: ShadingType.CLEAR, fill: o.shade, color: 'auto' } : undefined,
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
    children: [new Paragraph({ children: runs(t, { size: 17, bold: o.bold, color: o.color }), spacing: { after: 0 } })],
  });
  return new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, i, { shade: NAVY, bold: true, color: 'FFFFFF' })) }),
      ...rows.map((r, ri) => new TableRow({ children: Array.from({ length: n }, (_, i) => cell(r[i] || '', i, { shade: ri % 2 ? GREY : undefined })) })),
    ],
  });
}
const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

// Lecture du Markdown, bloc par bloc.
const lines = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').split('\n');
const children = [];
if (fs.existsSync(LOGO)) {
  children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: fs.readFileSync(LOGO), transformation: { width: 150, height: 50 } })], spacing: { after: 160 } }));
}
let i = 0;
while (i < lines.length) {
  const line = lines[i];
  if (!line.trim()) { i += 1; continue; }
  if (line.startsWith('# ')) {
    children.push(new Paragraph({ children: runs(line.slice(2), { size: 36, bold: true, color: NAVY }), spacing: { after: 160 } }));
    i += 1;
  } else if (line.startsWith('## ')) {
    children.push(heading(line.slice(3)));
    i += 1;
  } else if (line.startsWith('|')) {
    const head = splitRow(line);
    const rows = [];
    i += 2; // ligne de séparation |---|
    while (i < lines.length && lines[i].startsWith('|')) { rows.push(splitRow(lines[i])); i += 1; }
    children.push(table(head, rows), new Paragraph({ spacing: { after: 80 }, children: [] }));
  } else if (/^\s*- /.test(line) || /^\s*\d+\. /.test(line)) {
    while (i < lines.length && (/^\s*- /.test(lines[i]) || /^\s*\d+\. /.test(lines[i]))) {
      const m = lines[i].match(/^(\s*)(- |(\d+)\. )(.*)$/);
      let text = m[4];
      i += 1;
      while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*(- |\d+\. )/.test(lines[i])) { text += ` ${lines[i].trim()}`; i += 1; }
      children.push(item(text, m[3] ? `${m[3]}.` : '•', m[1].length >= 2 ? 1 : 0));
    }
  } else {
    let text = line.trim();
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^(#|\||\s*- |\s*\d+\. )/.test(lines[i])) { text += ` ${lines[i].trim()}`; i += 1; }
    children.push(para(text));
  }
}

const footer = new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: 'E-VOLUTION XP · Dossier de conception EGUITRA Finance et AxisPro Suite · page ', font: FONT, size: 16, color: '777777' }),
      new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '777777' }),
    ],
  })],
});

const doc = new Document({
  creator: 'E-VOLUTION XP', title: 'Dossier de conception EGUITRA Finance et AxisPro Suite',
  styles: { default: { document: { run: { font: FONT, size: 20 } } } },
  sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, footers: { default: footer }, children }],
});
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(OUT, buf); console.log(`Écrit : ${OUT}`); });
