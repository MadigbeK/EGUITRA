// Moteur de rendu commun : transforme une liste de blocs en .docx et en .md.
// Blocs : cover, toc, pagebreak, h1, h2, h3, p, ul, table, callout.
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  ShadingType, HeadingLevel, AlignmentType, BorderStyle, LevelFormat, PageBreak,
  TableOfContents, Header, Footer, PageNumber, VerticalAlign, ImageRun,
} = require('docx');

const NBSP = ' ';
const gnf = (n) => (n === 0 ? 'Offert' : Math.round(n).toLocaleString('fr-FR').replace(/[   ]/g, NBSP) + NBSP + 'GNF');
const gnfHT = (n) => `${gnf(n)} HT`;
const pct = (n, tot) => (n === 0 ? '0' + NBSP + '%' : `${Math.round((n / tot) * 100)}${NBSP}%`);

function blocs() {
  const B = [];
  return {
    B,
    h1: (t) => B.push({ t: 'h1', v: t }),
    h2: (t) => B.push({ t: 'h2', v: t }),
    h3: (t) => B.push({ t: 'h3', v: t }),
    p: (t) => B.push({ t: 'p', v: t }),
    ul: (items) => B.push({ t: 'ul', v: items }),
    table: (head, rows, widths, opts = {}) => B.push({ t: 'table', head, rows, widths, opts }),
    callout: (t) => B.push({ t: 'callout', v: t }),
    pagebreak: () => B.push({ t: 'pagebreak' }),
    cover: () => B.push({ t: 'cover' }),
    toc: () => B.push({ t: 'toc' }),
  };
}

// ---------------------------------------------------------------- Markdown
function toMarkdown(B, C) {
  const out = [];
  for (const b of B) {
    switch (b.t) {
      case 'cover':
        out.push(`![${C.prestataire}](${path.basename(C.logoPath || 'logo.png')})`, '',
          `# ${C.titre}`, '', `**${C.sousTitre}**`, '',
          ...(C.mentionRevision ? [C.mentionRevision, ''] : []),
          `Pour ${C.client} et ${C.client2}, à l'attention de ${C.dg}`, '',
          `Référence ${C.reference}, ${C.dateOffre}, valable ${C.validiteJours} jours`, '',
          `Émise par ${C.prestataire}, ${C.slogan}. Contact : ${C.contact}`, '');
        break;
      case 'toc': out.push('_Sommaire : voir la version Word, table des matières automatique._', ''); break;
      case 'pagebreak': out.push('', '---', ''); break;
      case 'h1': out.push('', `## ${b.v}`, ''); break;
      case 'h2': out.push('', `### ${b.v}`, ''); break;
      case 'h3': out.push('', `#### ${b.v}`, ''); break;
      case 'p': out.push(b.v, ''); break;
      case 'callout': out.push(`> ${b.v}`, ''); break;
      case 'ul': out.push(...b.v.map((i) => `- ${i}`), ''); break;
      case 'table': {
        const esc = (s) => String(s).replace(/\|/g, '\\|');
        out.push(`| ${b.head.map(esc).join(' | ')} |`, `|${b.head.map(() => '---').join('|')}|`);
        b.rows.forEach((r, i) => {
          const bold = (b.opts.lastBold && i === b.rows.length - 1) || (b.opts.boldRows || []).includes(i);
          out.push(`| ${r.map((c) => (bold ? `**${esc(c)}**` : esc(c))).join(' | ')} |`);
        });
        out.push('');
        break;
      }
    }
  }
  return out.join('\n').replace(/(\n---\n){2,}/g, '\n---\n');
}

// ---------------------------------------------------------------- DOCX
const NAVY = '1C1E6B'; // bleu du logo
const TEAL = '1A9E9E'; // vert-bleu du logo
const GREY = 'F2F4F7';
const FONT = 'Calibri';
const CONTENT_W = 9638; // A4 moins marges de 2 cm

const run = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size || 22, bold: o.bold, color: o.color, italics: o.italics });
const para = (text, o = {}) => new Paragraph({
  children: [run(text, o)], spacing: { after: o.after ?? 120, before: o.before ?? 0 }, alignment: o.align,
});
const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'C9CFD8' };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function docTable(head, rows, widths, opts = {}) {
  const w = widths || head.map(() => Math.floor(CONTENT_W / head.length));
  const mk = (text, i, o) => new TableCell({
    width: { size: w[i], type: WidthType.DXA },
    borders,
    verticalAlign: VerticalAlign.CENTER,
    shading: o.shade ? { type: ShadingType.CLEAR, fill: o.shade, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [run(String(text), { size: 19, bold: o.bold, color: o.color })], spacing: { after: 0 } })],
  });
  const headRow = new TableRow({
    tableHeader: true,
    children: head.map((h, i) => mk(h, i, { shade: NAVY, bold: true, color: 'FFFFFF' })),
  });
  const bodyRows = rows.map((r, ri) => {
    const bold = (opts.lastBold && ri === rows.length - 1) || (opts.boldRows || []).includes(ri);
    return new TableRow({ children: r.map((c, i) => mk(c, i, { bold, shade: bold ? 'E6F4F4' : (ri % 2 ? GREY : undefined) })) });
  });
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: w, rows: [headRow, ...bodyRows] });
}

function logoRun(C, widthPx) {
  if (!C.logoPath) return null;
  const data = fs.readFileSync(C.logoPath);
  const h = Math.round(widthPx * 820 / 1400); // proportions du logo
  return new ImageRun({ type: 'png', data, transformation: { width: widthPx, height: h }, altText: { title: C.prestataire, description: `Logo ${C.prestataire}`, name: 'logo' } });
}

function coverPage(C) {
  const c = [];
  const logo = logoRun(C, 300);
  if (logo) c.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 900 }, children: [logo] }));
  else c.push(para(C.prestataire, { size: 40, bold: true, color: NAVY, align: AlignmentType.CENTER, before: 600, after: 900 }));
  c.push(para(C.titre, { size: 52, bold: true, color: NAVY, after: 240 }));
  c.push(para(C.sousTitre, { size: 28, color: '444444', after: C.mentionRevision ? 200 : 700 }));
  if (C.mentionRevision) c.push(para(C.mentionRevision, { size: 22, color: TEAL, bold: true, after: 700 }));
  c.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: TEAL, space: 1 } }, spacing: { after: 500 }, children: [] }));
  c.push(para(`Pour ${C.client}`, { size: 26, bold: true, after: 60 }));
  c.push(para(`et ${C.client2}`, { size: 26, bold: true, after: 60 }));
  c.push(para(`À l'attention de ${C.dg}`, { size: 22, after: 700 }));
  c.push(para(`Référence ${C.reference}`, { size: 20, color: '666666', after: 40 }));
  c.push(para(`${C.dateOffre}, offre valable ${C.validiteJours} jours`, { size: 20, color: '666666', after: 40 }));
  c.push(para(`${C.prestataire}, ${C.slogan}. Contact : ${C.contact}`, { size: 20, color: '666666', after: 40 }));
  c.push(para('Document confidentiel, destiné exclusivement à ses destinataires.', { size: 18, italics: true, color: '888888', before: 1200 }));
  return c;
}

function toDocx(B, C) {
  const children = [];
  for (const b of B) {
    switch (b.t) {
      case 'cover': children.push(...coverPage(C)); break;
      case 'toc':
        children.push(para('Sommaire', { size: 32, bold: true, color: NAVY, after: 240 }));
        children.push(new TableOfContents('Sommaire', { hyperlink: true, headingStyleRange: '1-2' }));
        break;
      case 'pagebreak': children.push(new Paragraph({ children: [new PageBreak()] })); break;
      case 'h1': children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(b.v, { size: 32, bold: true, color: NAVY })], spacing: { before: 240, after: 200 } })); break;
      case 'h2': children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run(b.v, { size: 26, bold: true, color: NAVY })], spacing: { before: 280, after: 120 } })); break;
      case 'h3': children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [run(b.v, { size: 22, bold: true, color: '333333' })], spacing: { before: 200, after: 80 } })); break;
      case 'p': children.push(para(b.v, { after: 140 })); break;
      case 'callout':
        children.push(new Paragraph({
          children: [run(b.v, { size: 21, italics: true, color: NAVY })],
          shading: { type: ShadingType.CLEAR, fill: 'E6F4F4', color: 'auto' },
          border: { left: { style: BorderStyle.SINGLE, size: 24, color: TEAL, space: 8 } },
          spacing: { before: 120, after: 200 }, indent: { left: 200, right: 200 },
        }));
        break;
      case 'ul': b.v.forEach((i) => children.push(new Paragraph({ numbering: { reference: 'puces', level: 0 }, children: [run(i)], spacing: { after: 80 } }))); break;
      case 'table':
        children.push(docTable(b.head, b.rows, b.widths, b.opts));
        children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
        break;
    }
  }

  const headerLogo = logoRun(C, 70);
  return new Document({
    creator: C.prestataire,
    title: `${C.titre} EGUITRA`,
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, color: NAVY, font: FONT }, paragraph: { spacing: { before: 240, after: 200 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: NAVY, font: FONT }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, color: '333333', font: FONT }, paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
      ],
    },
    numbering: {
      config: [
        { reference: 'puces', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 280 } } } }] },
      ],
    },
    features: { updateFields: true },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      headers: {
        default: new Header({ children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C9CFD8', space: 4 } },
          children: [...(headerLogo ? [headerLogo, run('    ', { size: 16 })] : []), run(`${C.titre}, ${C.client} et ${C.client2}`, { size: 16, color: '888888' })],
        })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(`${C.prestataire}, ${C.slogan}. Réf. ${C.reference}, confidentiel. Page `, { size: 16, color: '888888' }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '888888' })] })] }),
      },
      children,
    }],
  });
}

// C : { titre, sousTitre, mentionRevision?, prestataire, slogan, contact, client, client2, dg,
//       reference, dateOffre, validiteJours, logoPath }
async function ecrire(B, C, dossier, base) {
  fs.writeFileSync(path.join(dossier, `${base}.md`), toMarkdown(B, C));
  const buf = await Packer.toBuffer(toDocx(B, C));
  fs.writeFileSync(path.join(dossier, `${base}.docx`), buf);
}

function trouverLogo(dossier, fichiers) {
  return fichiers.map((f) => path.join(dossier, f)).find((f) => fs.existsSync(f));
}

module.exports = { blocs, ecrire, trouverLogo, gnf, gnfHT, pct, NBSP };
