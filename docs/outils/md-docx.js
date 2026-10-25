// Conversion Markdown -> Word aux couleurs des documents du projet (dossier de conception, guides).
// Markdown pris en charge : titre (#), sections (##, ###), paragraphes, listes à puces et numérotées
// (sur deux niveaux), tableaux, gras (**…**), code (`…`) et liens ([texte](cible), rendus en texte).
// Largeur d'une colonne : calculée sur la longueur des textes, ou imposée par « {n} » à la fin de son
// en-tête (poids relatif, de 4 à 60 ; utile aux tableaux à remplir, dont les cellules sont vides).
const fs = require('fs');
const path = require('path');
const {
  AlignmentType, BorderStyle, Document, Footer, ImageRun, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell,
  TableRow, TextRun, VerticalAlign, WidthType,
} = require('docx');

const NAVY = '1C1E6B', TEAL = '1A9E9E', GREY = 'F2F4F7', FONT = 'Calibri', W = 9638;
const LOGO = path.join(__dirname, '..', 'offre', 'logo-rendu.png');

function runs(text, o = {}) {
  const out = [];
  const plain = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const mk = (t, extra = {}) => new TextRun({ text: t, font: FONT, size: o.size || 20, bold: o.bold, color: o.color, italics: o.italics, ...extra });
  let last = 0;
  for (const m of plain.matchAll(re)) {
    if (m.index > last) out.push(mk(plain.slice(last, m.index)));
    const t = m[0];
    out.push(t.startsWith('**') ? mk(t.slice(2, -2), { bold: true }) : mk(t.slice(1, -1), { font: 'Consolas', size: (o.size || 20) - 2, color: o.color || '333333' }));
    last = m.index + t.length;
  }
  if (last < plain.length) out.push(mk(plain.slice(last)));
  return out;
}

const para = (text) => new Paragraph({ children: runs(text), spacing: { after: 100 }, alignment: AlignmentType.JUSTIFIED });
const heading = (text, level) => new Paragraph({
  children: runs(text, { size: level === 2 ? 26 : 22, bold: true, color: level === 2 ? NAVY : TEAL }),
  spacing: { before: level === 2 ? 280 : 200, after: 100 }, keepNext: true,
  border: level === 2 ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: TEAL, space: 2 } } : undefined,
});
const item = (text, marker, level) => new Paragraph({
  children: [new TextRun({ text: `${marker}\t`, font: FONT, size: 20, color: TEAL, bold: true }), ...runs(text)],
  indent: { left: 360 + level * 360, hanging: 360 }, tabStops: [{ type: 'left', position: 360 + level * 360 }],
  spacing: { after: 60 }, alignment: AlignmentType.JUSTIFIED,
});

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'C9CFD8' };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
function table(rawHead, rows) {
  const n = rawHead.length;
  const hints = rawHead.map((h) => h.match(/\s*\{(\d+)\}$/));
  const head = rawHead.map((h, i) => (hints[i] ? h.slice(0, hints[i].index) : h));
  // Largeurs proportionnelles à la longueur moyenne du texte de chaque colonne (bornées), sauf largeur imposée.
  const weight = head.map((h, i) => (hints[i] ? Math.min(60, Math.max(4, Number(hints[i][1])))
    : Math.min(60, Math.max(8, [h, ...rows.map((r) => r[i] || '')].reduce((a, t) => a + t.length, 0) / (rows.length + 1)))));
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
const isList = (l) => /^\s*(- |\d+\. )/.test(l);

/** Paragraphes Word d'un texte Markdown. */
function blocks(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (line.startsWith('# ')) {
      out.push(new Paragraph({ children: runs(line.slice(2), { size: 36, bold: true, color: NAVY }), spacing: { after: 160 } }));
      i += 1;
    } else if (line.startsWith('### ')) {
      out.push(heading(line.slice(4), 3));
      i += 1;
    } else if (line.startsWith('## ')) {
      out.push(heading(line.slice(3), 2));
      i += 1;
    } else if (line.startsWith('|')) {
      const head = splitRow(line);
      const rows = [];
      i += 2; // ligne de séparation |---|
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(splitRow(lines[i])); i += 1; }
      out.push(table(head, rows), new Paragraph({ spacing: { after: 80 }, children: [] }));
    } else if (line.startsWith('```')) {
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        out.push(new Paragraph({ children: [new TextRun({ text: lines[i], font: 'Consolas', size: 17, color: '333333' })], spacing: { after: 0 }, indent: { left: 360 } }));
        i += 1;
      }
      i += 1;
      out.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
    } else if (isList(line)) {
      while (i < lines.length && isList(lines[i])) {
        const m = lines[i].match(/^(\s*)(- |(\d+)\. )(.*)$/);
        let text = m[4];
        i += 1;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !isList(lines[i])) { text += ` ${lines[i].trim()}`; i += 1; }
        out.push(item(text, m[3] ? `${m[3]}.` : '•', m[1].length >= 2 ? 1 : 0));
      }
    } else {
      let text = line.trim();
      i += 1;
      while (i < lines.length && lines[i].trim() && !/^(#|\||```)/.test(lines[i]) && !isList(lines[i])) { text += ` ${lines[i].trim()}`; i += 1; }
      out.push(para(text));
    }
  }
  return out;
}

/** Écrit un document Word : logo, contenu Markdown (une ou plusieurs parties), pied de page numéroté. */
async function build({ markdown, out, title, footer }) {
  const children = [];
  if (fs.existsSync(LOGO)) {
    children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: fs.readFileSync(LOGO), transformation: { width: 150, height: 50 } })], spacing: { after: 160 } }));
  }
  for (const part of [].concat(markdown)) children.push(...blocks(part));
  const doc = new Document({
    creator: 'E-VOLUTION XP', title,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: `${footer} · page `, font: FONT, size: 16, color: '777777' }),
              new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '777777' }),
            ],
          })],
        }),
      },
      children,
    }],
  });
  fs.writeFileSync(out, await Packer.toBuffer(doc));
  return out;
}

module.exports = { build };
