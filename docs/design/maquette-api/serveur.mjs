/**
 * Maquette de l'API du noyau NIMOVA, pour le travail de design.
 *
 * Sert sur 127.0.0.1 les routes /api/v1/... qu'appellent EGUITRA Finance, AxisPro Suite, le
 * portail des porteurs de projets, l'application Rotations et NIMOVA · HSSEQ (avec les formulaires
 * de NIMOVA Terrain). Toutes les données sont fictives :
 * les sociétés tierces portent le suffixe « (démo) ». Outil de design seulement, à ne jamais
 * brancher sur la production ni sur la recette.
 *
 * Lancement : node docs/design/maquette-api/serveur.mjs   (port 8170 par défaut, variable PORT)
 * Côté web  : ODOO_URL=http://127.0.0.1:8170 et COOKIE_PREFIX=egm (voir README.md).
 *
 * Les formes des réponses reprennent les contrôleurs du noyau (addons/eguitra_*). Les données sont
 * produites au démarrage par un générateur déterministe (date de référence : 15 octobre 2026),
 * puis modifiées en mémoire par les actions des écrans ; un redémarrage remet tout à zéro.
 * Une route inconnue répond 404 et laisse dans le journal une ligne commençant par INCONNU.
 */

import http from "node:http";
import { URL } from "node:url";
import crypto from "node:crypto";
import { enregistrerAnalyse } from "./analyse.mjs";
import { enregistrerConformite } from "./hsseq-conformite.mjs";
import { enregistrerDocuments } from "./hsseq-documents.mjs";
import { enregistrerEnvironnement } from "./hsseq-environnement.mjs";
import { enregistrerRevues } from "./hsseq-revues.mjs";
import { enregistrerTelematique } from "./hsseq-telematique.mjs";
import { enregistrerHabilitationsRapports } from "./hsseq-habilitations-rapports.mjs";
import { enregistrerRisques } from "./hsseq-risques.mjs";
import { enregistrerTrajets, immobilisationDeLEvenement, immobilisationEnCours, immobilisationProposee, immobiliser, motifSurcharge, motifTrajet } from "./hsseq-trajets.mjs";
import { enregistrerProprietaires, fuelPriceAt, marginShown, monthlyOf, OWNERSHIP_LABELS, seedProprietaires, standardOf } from "./transport-proprietaires.mjs";

const PORT = Number(process.env.PORT) || 8170;
const HOST = "127.0.0.1";
/** Date de référence des données (« aujourd'hui » pour la maquette). */
const TODAY = "2026-10-15";
/** Heure de référence des données datées à la minute (alertes de validation en retard). */
const NOW_REF = `${TODAY}T12:00:00Z`;

/* ════════════════════════════════════════════════════════════════════════════
 * Outils
 * ══════════════════════════════════════════════════════════════════════════ */

class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.userMessage = message;
    this.extra = extra;
  }
}
const notFound = (message) => new ApiError(404, "not_found", message);
const businessRule = (message) => new ApiError(422, "business_rule", message);
const badParam = (message) => new ApiError(400, "invalid_parameter", message);

function requireFields(data, ...keys) {
  const missing = keys.filter((k) => data[k] === undefined || data[k] === null || data[k] === "");
  if (missing.length) throw new ApiError(400, "missing_fields", "Champs obligatoires manquants.", { fields: missing });
  return keys.map((k) => data[k]);
}

/** Générateur pseudo-aléatoire déterministe (mulberry32), un flux par domaine. */
function hashString(text) {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function makeRng(label) {
  let a = hashString(label) || 1;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted: (pairs) => {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let x = next() * total;
      for (const [value, w] of pairs) {
        x -= w;
        if (x < 0) return value;
      }
      return pairs[pairs.length - 1][0];
    },
    noise: (pct) => 1 + (next() * 2 - 1) * pct,
    chance: (p) => next() < p,
    uuid: () => {
      const h = Array.from({ length: 32 }, () => Math.floor(next() * 16).toString(16)).join("");
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
    },
  };
}

const pad = (n, w = 2) => String(n).padStart(w, "0");
const DAY_MS = 86400000;
const toTime = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromTime = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => fromTime(toTime(d) + n * DAY_MS);
const daysBetween = (a, b) => Math.round((toTime(b) - toTime(a)) / DAY_MS);
const lastDayOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthStart = (d) => `${d.slice(0, 7)}-01`;
const monthEnd = (d) => `${d.slice(0, 7)}-${pad(lastDayOf(+d.slice(0, 4), +d.slice(5, 7)))}`;
function addMonths(d, n) {
  let y = +d.slice(0, 4);
  let m = +d.slice(5, 7) - 1 + n;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  const day = Math.min(+d.slice(8, 10), lastDayOf(y, m + 1));
  return `${y}-${pad(m + 1)}-${pad(day)}`;
}
/** Mois « AAAA-MM » de from à to inclus. */
function monthKeys(from, to) {
  const keys = [];
  let k = from.slice(0, 7);
  const end = to.slice(0, 7);
  while (k <= end) {
    keys.push(k);
    k = addMonths(`${k}-01`, 1).slice(0, 7);
  }
  return keys;
}
const minDate = (a, b) => (a < b ? a : b);
const maxDate = (a, b) => (a > b ? a : b);
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(toTime(v));
const stamp = (date, h = 9, m = 0, s = 0) => `${date}T${pad(h)}:${pad(m)}:${pad(s)}Z`;
const nowStamp = () => `${new Date().toISOString().slice(0, 19)}Z`;
const frDate = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const monthLabel = (d) => `${MONTHS_FR[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
/** « d'octobre 2026 », « de septembre 2026 ». */
function ofMonth(d) {
  const m = MONTHS_FR[+d.slice(5, 7) - 1];
  return `${/^[aeiouéy]/.test(m) ? "d'" : "de "}${m} ${d.slice(0, 4)}`;
}
const round = (n) => Math.round(n);
const roundTo = (n, step) => Math.round(n / step) * step;
const round3 = (n) => Math.round(n * 1000) / 1000;
const sum = (arr, fn = (x) => x) => arr.reduce((s, x) => s + (Number(fn(x)) || 0), 0);
function groupBy(arr, keyFn) {
  const map = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(x);
  }
  return map;
}
const slug = (text) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(demo\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const upper = (text) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const fmtInt = (n) => Math.round(n).toLocaleString("fr-FR").replace(/[  ]/g, " ");
const byFr = (a, b) => String(a).localeCompare(String(b), "fr", { sensitivity: "base" });
const cleanNumber = (v) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")));

/** Paramètres de requête et de corps, avec les mêmes refus que le noyau. */
function intArg(src, name, def = null, min = null, max = null) {
  const v = src[name];
  if (v === undefined || v === null || v === "") return def;
  if (!/^-?\d+$/.test(String(v).trim())) throw badParam(`Paramètre ${name} invalide.`);
  let n = Number.parseInt(v, 10);
  if (min !== null) n = Math.max(min, n);
  if (max !== null) n = Math.min(max, n);
  return n;
}
function dateArg(src, name, def = null) {
  const v = src[name];
  if (v === undefined || v === null || v === "") return def;
  if (!isDate(String(v))) throw badParam(`Date invalide : ${name}.`);
  return String(v);
}
function numArg(v, name) {
  const n = cleanNumber(v);
  if (!Number.isFinite(n)) throw badParam(`Nombre invalide : ${name}.`);
  return n;
}

/* ─── Fichiers : CSV, classeur XLSX minimal, PDF minimal ─────────────────── */

function csvBuffer(headers, rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return "";
    let s = typeof v === "number" ? String(Math.round(v)) : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...rows].map((r) => r.map(cell).join(";"));
  return Buffer.from(`﻿${lines.join("\r\n")}\r\n`, "utf8");
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** Archive ZIP sans compression (suffisant pour un classeur XLSX). */
function zipStore(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const time = (9 << 11) | (30 << 5);
  const date = ((2026 - 1980) << 9) | (10 << 5) | 15;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, data);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(time, 12);
    head.writeUInt16LE(date, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(nameBuf.length, 28);
    head.writeUInt16LE(0, 30);
    head.writeUInt16LE(0, 32);
    head.writeUInt16LE(0, 34);
    head.writeUInt16LE(0, 36);
    head.writeUInt32LE(0, 38);
    head.writeUInt32LE(offset, 42);
    central.push(head, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, ...central, end]);
}
const xmlEscape = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
function columnName(index) {
  let s = "";
  let i = index + 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}
/** Classeur XLSX : une feuille par entrée, la première ligne en gras. */
function xlsxBuffer(sheets) {
  const sheetXml = (rows) => {
    const body = rows
      .map((row, r) => {
        const cells = row
          .map((v, c) => {
            const ref = `${columnName(c)}${r + 1}`;
            if (typeof v === "number" && Number.isFinite(v)) {
              const style = r === 0 ? 1 : Number.isInteger(v) ? 2 : 3;
              return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
            }
            return `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlEscape(v ?? "")}</t></is></c>`;
          })
          .join("");
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  };
  const names = sheets.map((s, i) => (s.name || `Feuille ${i + 1}`).replace(/[[\]:*?/\\]/g, " ").slice(0, 31));
  const files = [
    {
      name: "[Content_Types].xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    },
    {
      name: "_rels/.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: "xl/styles.xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s.rows) })),
  ];
  return zipStore(files.map((f) => ({ name: f.name, data: Buffer.from(f.text, "utf8") })));
}

/** PDF d'une page (police Helvetica), pour les impressions et les pièces jointes de la maquette. */
function pdfBuffer(title, lines) {
  const latin = (s) =>
    String(s)
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/œ/g, "oe")
      .replace(/Œ/g, "OE")
      .replace(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`, "g"), "-")
      .replace(/[  ]/g, " ")
      .replace(/[^\x00-\xff]/g, "?");
  const esc = (s) => latin(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  let content = `BT\n/F2 15 Tf\n50 790 Td\n(${esc(title)}) Tj\n/F1 10 Tf\n0 -12 Td\n14 TL\n`;
  for (const line of lines.slice(0, 52)) content += `(${esc(line)}) '\n`;
  content += "ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];
  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/* ─── Envois de fichiers (multipart/form-data) ──────────────────────────── */

function parseMultipart(buf, contentType) {
  const fields = {};
  const files = [];
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || "");
  if (!match || !buf.length) return { fields, files };
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    pos += boundary.length;
    if (buf.slice(pos, pos + 2).toString() === "--") break;
    if (buf.slice(pos, pos + 2).toString() === "\r\n") pos += 2;
    const headerEnd = buf.indexOf("\r\n\r\n", pos);
    if (headerEnd === -1) break;
    const headers = buf.slice(pos, headerEnd).toString("utf8");
    const next = buf.indexOf(boundary, headerEnd + 4);
    if (next === -1) break;
    const data = buf.slice(headerEnd + 4, Math.max(headerEnd + 4, next - 2));
    const name = /[;\s]name="([^"]*)"/i.exec(headers)?.[1];
    const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
    const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1];
    if (filename !== undefined) files.push({ field: name, filename, contentType: type, data });
    else if (name) fields[name] = data.toString("utf8");
    pos = next;
  }
  return { fields, files };
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ACCEPTED = "PDF, JPEG, PNG, Word (.docx) ou Excel (.xlsx)";
const EXTENSIONS = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", [DOCX]: ".docx", [XLSX]: ".xlsx" };
/** Format reconnu à la signature du contenu, comme le noyau (files.detect_type). */
function detectType(data) {
  if (data.slice(0, 1024).includes("%PDF-")) return "application/pdf";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.slice(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    if (data.includes("vbaProject.bin")) return null;
    if (data.includes("word/document.xml")) return DOCX;
    if (data.includes("xl/workbook.xml")) return XLSX;
  }
  return null;
}
function checkedName(filename, mimetype, fallback = "piece") {
  const name = String(filename || "").replace(/\\/g, "/").split("/").pop().trim() || fallback;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
  const expected = EXTENSIONS[mimetype];
  if (ext === expected || (mimetype === "image/jpeg" && ext === ".jpeg")) return name;
  return `${stem || fallback}${expected}`;
}
/** Fichier reçu d'un écran : contrôle de présence, de taille et de format. */
function uploadedFile(ctx, maxBytes, label = "Fichier") {
  const file = ctx.multipart().files.find((f) => f.field === "file");
  if (!file) throw new ApiError(400, "missing_fields", "Fichier manquant.", { fields: ["file"] });
  if (file.data.length > maxBytes) {
    throw new ApiError(413, "too_large", `${label} trop volumineux (${Math.round(maxBytes / 1048576)} Mo maximum).`);
  }
  return file;
}

/* ════════════════════════════════════════════════════════════════════════════
 * Référentiels : profils, sociétés, utilisateurs, tiers, plan de comptes, journaux
 * ══════════════════════════════════════════════════════════════════════════ */

const PROFILE_DEFS = [
  { code: "admin", name: "Administration", description: "Référentiels, seuils d'alerte, taux de change, profils et droits, journal d'audit." },
  { code: "direction", name: "Direction générale", description: "Tableau de bord du dirigeant, pilotage, consolidation, dernier niveau d'approbation." },
  { code: "finance", name: "Finance et comptabilité", description: "Ventes, achats, trésorerie, immobilisations, budget, clôtures, états et déclarations." },
  { code: "exploitation", name: "Exploitation transport", description: "Flotte, chauffeurs, routes et tarifs, rotations, rentabilité." },
  { code: "chantiers", name: "Chantiers", description: "Chantiers, situations d'avancement, retenues de garantie." },
  { code: "immobilier", name: "Immobilier", description: "Biens, baux, loyers et quittancement, patrimoine." },
  { code: "cabinet", name: "Cabinet AxisPro", description: "Dossiers de projets, évaluations, data room, comités, rapports, facturation des prestations." },
  { code: "porteur", name: "Porteur de projet", description: "Portail AxisPro : dépôt des pièces, suivi du dossier, échanges avec le cabinet." },
  { code: "hsseq", name: "Responsable HSSEQ", description: "Événements, enquêtes, actions, grilles de contrôle, dérogations au verrou, détail des alcootests." },
  { code: "conducteur", name: "Conducteur", description: "NIMOVA Terrain : contrôle avant départ, alcootest, déclaration d'événement." },
  { code: "auditeur", name: "Auditeur externe", description: "NIMOVA · HSSEQ en lecture seule, sur ses sites et jusqu'à sa date de fin d'accès." },
];
/** « terrain » : application native NIMOVA Terrain, ouverte à la connexion mais absente des espaces du web. */
const APPS = ["finance", "transport", "axispro", "portail", "mobile", "analyse", "hsseq", "terrain"];
/** Applications ouvertes à chaque profil (eguitra_api.models.res_users.APP_PROFILES). */
const APP_PROFILES = {
  finance: ["admin", "direction", "finance", "exploitation", "chantiers", "immobilier"],
  axispro: ["admin", "direction", "cabinet"],
  portail: ["porteur"],
  mobile: ["admin", "exploitation"],
  transport: ["admin", "direction", "finance", "exploitation"],
  analyse: ["admin", "direction", "finance", "cabinet"],
  hsseq: ["admin", "direction", "hsseq", "exploitation", "auditeur"],
  terrain: ["hsseq", "exploitation", "conducteur"],
};
const INTERNAL = ["admin", "direction", "finance", "exploitation", "chantiers", "immobilier", "cabinet"];
const appsFor = (profiles) => APPS.filter((app) => APP_PROFILES[app].some((p) => profiles.includes(p)));
/** Applications du web (sans NIMOVA Terrain, que le web ne connaît pas). */
const webAppsFor = (profiles) => appsFor(profiles).filter((app) => app !== "terrain");
const sortProfiles = (profiles) => PROFILE_DEFS.map((p) => p.code).filter((c) => profiles.includes(c));

const COMPANIES = {
  1: {
    id: 1, name: "EGUITRA GROUP SARLU", entity: "groupe", street: "Immeuble Kaloum Centre, avenue de la République",
    street2: "Quartier Almamya, commune de Kaloum", zip: "BP 4410", city: "Conakry", phone: "+224 620 00 10 10",
    email: "finance@eguitra.example", website: "www.eguitra.example", vat: "999000101A",
    company_registry: "GN.TCC.2012.B.00101 (démo)", currency: "GNF", country: "Guinée", logo: null,
  },
  2: {
    id: 2, name: "MB AxisPro", entity: "cabinet", street: "Immeuble Kaloum Centre, 5e étage",
    street2: "Avenue de la République, Kaloum", zip: "BP 4411", city: "Conakry", phone: "+224 620 00 20 20",
    email: "contact@axispro.example", website: "www.axispro.example", vat: "999000202B",
    company_registry: "GN.TCC.2019.B.00202 (démo)", currency: "GNF", country: "Guinée", logo: null,
  },
};
const COMPANY_IDS = [1, 2];
const companyRef = (cid) => ({ id: cid, name: COMPANIES[cid].name });

/** Comptes de la plateforme. Les identifiants spéciaux de la maquette choisissent l'utilisateur. */
const USERS = [
  { id: 2, login: "m.diallo", name: "Mariama Diallo", email: "m.diallo@eguitra.example", profiles: [...INTERNAL, "hsseq"], companies: [1, 2], company_id: 1, mfa: true, active: true, temp: false, last_login: "2026-10-15T07:58:12Z" },
  { id: 5, login: "o.bangoura", name: "Ousmane Bangoura", email: "o.bangoura@eguitra.example", profiles: ["finance"], companies: [1], company_id: 1, mfa: true, active: true, temp: false, last_login: "2026-10-15T08:21:40Z" },
  { id: 6, login: "k.sylla", name: "Kadiatou Sylla", email: "k.sylla@eguitra.example", profiles: ["finance"], companies: [1, 2], company_id: 1, mfa: true, active: true, temp: false, last_login: "2026-10-14T17:05:03Z" },
  { id: 8, login: "s.barry", name: "Saïdou Barry", email: "s.barry@eguitra.example", profiles: ["direction"], companies: [1, 2], company_id: 1, mfa: true, active: true, temp: false, last_login: "2026-10-13T19:42:51Z" },
  { id: 9, login: "h.soumah", name: "Hawa Soumah", email: "h.soumah@eguitra.example", profiles: ["immobilier"], companies: [1], company_id: 1, mfa: true, active: true, temp: false, last_login: "2026-10-14T10:16:22Z" },
  { id: 10, login: "ml.keita", name: "Mohamed Lamine Keïta", email: "ml.keita@eguitra.example", profiles: ["chantiers"], companies: [1], company_id: 1, mfa: true, active: true, temp: false, last_login: "2026-10-12T06:55:09Z" },
  { id: 11, login: "d.toure", name: "Djénabou Touré", email: "d.toure@eguitra.example", profiles: ["exploitation"], companies: [1], company_id: 1, mfa: true, active: true, temp: false, last_login: "2026-10-15T07:31:18Z" },
  { id: 12, login: "parc", name: "Mamadou Bah", email: "parc.matoto@eguitra.example", profiles: ["exploitation"], companies: [1], company_id: 1, mfa: true, active: true, temp: false, last_login: "2026-10-15T06:12:44Z" },
  { id: 13, login: "i.bangoura", name: "Ismaël Bangoura", email: null, profiles: ["exploitation"], companies: [1], company_id: 1, mfa: true, active: false, temp: false, last_login: "2026-04-30T16:11:00Z" },
  { id: 15, login: "provisoire", name: "Fatoumata Camara", email: "f.camara@eguitra.example", profiles: [...INTERNAL, "hsseq"], companies: [1, 2], company_id: 1, mfa: true, active: true, temp: true, last_login: null },
  { id: 16, login: "hsseq", name: "Fanta Kourouma", email: "f.kourouma@eguitra.example", profiles: ["hsseq"], companies: [1], company_id: 1, mfa: true, active: true, temp: false, last_login: "2026-10-15T06:51:09Z" },
  { id: 17, login: "conducteur", name: "Amadou Oury Diallo", email: null, profiles: ["conducteur"], companies: [1], company_id: 1, mfa: true, active: true, temp: false, last_login: "2026-10-14T17:21:40Z" },
  { id: 18, login: "s.conde", name: "Sékou Condé", email: "parc.boffa@eguitra.example", profiles: ["exploitation"], companies: [1], company_id: 1, mfa: true, active: true, temp: false, last_login: "2026-10-15T05:12:31Z" },
  { id: 19, login: "a.diakite", name: "Alhassane Diakité", email: "a.diakite@eguitra.example", profiles: ["exploitation"], companies: [1], company_id: 1, mfa: true, active: true, temp: false, last_login: "2026-10-14T16:02:57Z" },
  { id: 21, login: "cabinet", name: "Aïssatou Barry", email: "a.barry@axispro.example", profiles: ["cabinet"], companies: [2], company_id: 2, mfa: true, active: true, temp: false, last_login: "2026-10-15T08:47:30Z" },
  { id: 22, login: "t.diallo", name: "Thierno Diallo", email: "t.diallo@axispro.example", profiles: ["cabinet"], companies: [2], company_id: 2, mfa: true, active: true, temp: false, last_login: "2026-10-14T15:20:02Z" },
  // Auditeur externe (lot 2 HSSEQ) : lecture seule, site de Matoto, accès jusqu'au 31/12/2026.
  { id: 24, login: "auditeur", name: "Moussa Kaba", email: "m.kaba@audit-conseil.example", profiles: ["auditeur"], companies: [1], company_id: 1, mfa: true, active: true, temp: false, last_login: "2026-10-20T09:14:00Z", hsseq_audit_until: "2026-12-31", hsseq_audit_site_ids: [1] },
  { id: 23, login: "a.keita", name: "Aminata Keïta", email: "a.keita@axispro.example", profiles: ["cabinet"], companies: [2], company_id: 2, mfa: false, active: true, temp: true, last_login: null },
  { id: 41, login: "porteur", name: "Ibrahima Sow", email: "i.sow@rizerie-kankan.example", profiles: ["porteur"], companies: [2], company_id: 2, mfa: true, active: true, temp: false, last_login: "2026-10-11T20:03:15Z" },
  { id: 42, login: "nob.laiterie", name: "Néné Oumou Bah", email: "contact@laiterie-fouta.example", profiles: ["porteur"], companies: [2], company_id: 2, mfa: true, active: true, temp: false, last_login: "2026-09-02T09:12:00Z" },
  { id: 43, login: "f.camara.peche", name: "Fodé Camara", email: "f.camara@pecheries-kamsar.example", profiles: ["porteur"], companies: [2], company_id: 2, mfa: true, active: true, temp: false, last_login: "2026-10-09T18:27:41Z" },
];
const SPECIAL_LOGINS = { porteur: 41, parc: 12, provisoire: 15, cabinet: 21, hsseq: 16, conducteur: 17, boffa: 18, dg: 8, finance: 5, auditeur: 24 };
const DEFAULT_USER_ID = 2;
const userById = (id) => USERS.find((u) => u.id === id);
const userName = (id) => userById(id)?.name ?? "Système";
/** Utilisateur d'une session : un identifiant spécial, sinon le profil complet de Mariama Diallo. */
function sessionUser(login) {
  const base = userById(SPECIAL_LOGINS[login] ?? DEFAULT_USER_ID);
  return { ...base, login, profiles: sortProfiles(base.profiles), companies: [...base.companies].sort((a, b) => a - b) };
}
const passwordTemporary = (user) => user.temp && !DB.passwordChanged.has(user.id);

/* ─── Tiers (partagés par les deux sociétés ; soldes calculés par société) ── */

const PARTNERS = [];
function addPartner(id, name, city, roles, extra = {}) {
  const person = extra.person === true;
  PARTNERS.push({
    id, name, is_company: !person, city,
    customer: roles.includes("c"), supplier: roles.includes("f"),
    vat: person ? null : `99901${pad(id, 4)}A`,
    phone: `+224 6${pad(20 + (id % 10))} ${pad((id * 7) % 100)} ${pad((id * 13) % 100)} ${pad((id * 31) % 100)}`,
    email: extra.email !== undefined ? extra.email : person ? null : `contact@${slug(name)}.example`,
    street: extra.street ?? null, comment: extra.comment ?? null,
    credit_limit: extra.limit ?? 0, use_credit_limit: Boolean(extra.limit), active: true,
  });
}
addPartner(101, "Société Minière de Boffa (démo)", "Boffa", "c", { limit: 3_000_000_000, street: "Site minier, route de Koba" });
addPartner(102, "Bauxite Atlantique Kamsar (démo)", "Kamsar", "c", { limit: 2_500_000_000, street: "Cité minière, Kamsar" });
addPartner(103, "Mines d'Or du Haut Niger (démo)", "Siguiri", "c", { limit: 1_800_000_000, comment: "Plafond de crédit dépassé : livraisons soumises à l'accord de la direction financière." });
addPartner(104, "Distribution Pétrolière de Kankan (démo)", "Kankan", "c", { limit: 1_200_000_000 });
addPartner(105, "Aéro Services Gbessia (démo)", "Conakry", "c", { street: "Zone aéroportuaire, Gbessia" });
addPartner(106, "Énergie Fria Services (démo)", "Fria", "c", { comment: "Retards de paiement récurrents : relance téléphonique avant toute nouvelle livraison." });
addPartner(107, "Ciments du Rio Pongo (démo)", "Boffa", "c", { comment: "Litige sur les manquants de mars et avril 2026, dossier transmis à l'avocat." });
addPartner(108, "Stations Fouta Carburants (démo)", "Labé", "c");
addPartner(109, "Société des Eaux de Mamou (démo)", "Mamou", "c");
addPartner(110, "Agro Kindia Fruits (démo)", "Kindia", "c");
addPartner(111, "Agence Routière Préfectorale de Boké (démo)", "Boké", "c");
addPartner(112, "Société Immobilière de Ratoma (démo)", "Conakry", "c");
addPartner(113, "Clinique Les Palmiers de Dixinn (démo)", "Conakry", "c");
addPartner(114, "Université Privée de Kipé (démo)", "Conakry", "c");
addPartner(115, "Cabinet Juridique Sylla et Associés (démo)", "Conakry", "c", { street: "Immeuble Kaloum Centre, 3e étage" });
addPartner(116, "Groupe Hôtelier Kipé (démo)", "Conakry", "c");
addPartner(117, "Pharmacie du Carrefour de Matoto (démo)", "Conakry", "c", { email: null });
addPartner(118, "Logistique Express Matoto (démo)", "Conakry", "c");
addPartner(119, "Mamadou Saliou Diallo", "Conakry", "c", { person: true });
addPartner(120, "Aminata Camara", "Conakry", "c", { person: true, email: "a.camara.kipe@example.org" });
addPartner(121, "Organisation Humanitaire Fouta Santé (démo)", "Conakry", "c");
addPartner(122, "Bureau d'Études Techniques Soumah (démo)", "Conakry", "c");
addPartner(123, "Société de Négoce Atlantique (démo)", "Conakry", "c");
addPartner(124, "Boulangerie Moderne de Kipé (démo)", "Conakry", "c");
addPartner(131, "Carburants de la Presqu'île (démo)", "Conakry", "f");
addPartner(132, "Pneus et Pièces Poids Lourds (démo)", "Conakry", "f");
addPartner(133, "Garage Central de Matoto (démo)", "Conakry", "f");
addPartner(134, "Assurances du Golfe de Guinée (démo)", "Conakry", "f");
addPartner(135, "Ciment et Fer de Conakry (démo)", "Conakry", "f");
addPartner(136, "Électricité Générale Kaloum (démo)", "Conakry", "f");
addPartner(137, "Sécurité Gardiennage Ratoma (démo)", "Conakry", "f");
addPartner(138, "Télécom Services Guinée (démo)", "Conakry", "f");
addPartner(139, "Imprimerie Nouvelle de Dixinn (démo)", "Conakry", "f");
addPartner(140, "Cabinet d'Expertise Comptable Bah et Associés (démo)", "Conakry", "f");
addPartner(141, "Location d'Engins de Chantier Kagbelen (démo)", "Dubréka", "f");
addPartner(142, "Quincaillerie Générale de Madina (démo)", "Conakry", "f");
addPartner(151, "Banque du Golfe de Conakry (démo)", "Conakry", "f");
addPartner(152, "Banque Commerciale du Kaloum (démo)", "Conakry", "f");
addPartner(153, "Société de Crédit-Bail Ouest Africaine (démo)", "Conakry", "f");
addPartner(154, "Union Bancaire de Guinée (démo)", "Conakry", "f");
addPartner(155, "Fonds de Garantie des Investissements Agricoles (démo)", "Conakry", "c");
addPartner(161, "Rizerie Moderne de Kankan (démo)", "Kankan", "c", { email: "i.sow@rizerie-kankan.example" });
addPartner(162, "Pêcheries Artisanales de Kamsar (démo)", "Kamsar", "c");
addPartner(163, "Clinique Mère et Enfant de Labé (démo)", "Labé", "c");
addPartner(164, "Solaire Rural Fouta (démo)", "Pita", "c");
addPartner(165, "Port Sec Logistique de Kagbelen (démo)", "Dubréka", "c");
addPartner(166, "Huilerie de Palme de Forécariah (démo)", "Forécariah", "c");
addPartner(167, "Laiterie du Fouta (démo)", "Labé", "c");
addPartner(168, "Mangues Séchées de Kindia (démo)", "Kindia", "c");
addPartner(169, "Aquaculture du Konkouré (démo)", "Kindia", "c");
addPartner(170, "Groupement d'Intérêt Économique des Producteurs de Pomme de Terre et de Légumes du Fouta Djallon (démo)", "Timbi-Madina", "c");
addPartner(171, "Bureau Services Kaloum (démo)", "Conakry", "f");
addPartner(172, "Expertise Agro Conseil (démo)", "Conakry", "f");
addPartner(173, "Transports Camara et Fils (démo)", "Conakry", "f");
addPartner(174, "Moussa Kourouma", "Kankan", "f", { person: true });
addPartner(175, "Consortium Logistique du Niger (démo)", "Conakry", "f");
const partnerById = (id) => PARTNERS.find((p) => p.id === id);
const partnerRef = (id) => {
  const p = id ? partnerById(id) : null;
  return p ? { id: p.id, name: p.name } : null;
};
const partnerName = (id) => partnerById(id)?.name ?? null;

/* ─── Plan de comptes SYSCOHADA (commun aux deux sociétés) ─────────────── */

const ACCOUNT_DEFS = [
  ["101300", "Capital souscrit, appelé, versé", "equity"],
  ["111000", "Réserve légale", "equity"],
  ["118000", "Autres réserves", "equity"],
  ["121000", "Report à nouveau créditeur", "equity_unaffected"],
  ["131000", "Résultat net : bénéfice", "equity_unaffected"],
  ["162100", "Emprunts auprès des établissements de crédit", "liability_non_current"],
  ["166000", "Intérêts courus sur emprunts", "liability_non_current"],
  ["172000", "Dettes de location-acquisition, crédit-bail mobilier", "liability_non_current"],
  ["191000", "Provisions pour litiges", "liability_non_current"],
  ["213000", "Logiciels", "asset_non_current"],
  ["222000", "Terrains bâtis", "asset_fixed"],
  ["231100", "Bâtiments industriels", "asset_fixed"],
  ["231300", "Bâtiments administratifs et commerciaux", "asset_fixed"],
  ["234000", "Installations techniques", "asset_fixed"],
  ["241000", "Matériel et outillage industriel", "asset_fixed"],
  ["244100", "Matériel de bureau et informatique", "asset_fixed"],
  ["244400", "Mobilier de bureau", "asset_fixed"],
  ["245100", "Matériel de transport routier", "asset_fixed"],
  ["245200", "Véhicules de service", "asset_fixed"],
  ["281300", "Amortissements des logiciels", "asset_non_current"],
  ["283100", "Amortissements des bâtiments", "asset_fixed"],
  ["284100", "Amortissements du matériel industriel", "asset_fixed"],
  ["284400", "Amortissements du matériel et du mobilier de bureau", "asset_fixed"],
  ["284500", "Amortissements du matériel de transport", "asset_fixed"],
  ["332000", "Fournitures d'atelier et pièces de rechange", "asset_current"],
  ["401100", "Fournisseurs", "liability_payable", true],
  ["408100", "Fournisseurs, factures non parvenues", "liability_current"],
  ["409100", "Fournisseurs, avances et acomptes versés", "asset_prepayments"],
  ["411100", "Clients", "asset_receivable", true],
  ["411700", "Clients, retenues de garantie", "asset_receivable", true],
  ["416000", "Clients douteux ou litigieux", "asset_receivable", true],
  ["418100", "Clients, factures à établir", "asset_current"],
  ["419100", "Clients, avances et acomptes reçus", "liability_current"],
  ["421000", "Personnel, avances et acomptes", "asset_current"],
  ["422000", "Personnel, rémunérations dues", "liability_current"],
  ["431000", "Sécurité sociale (CNSS)", "liability_current"],
  ["441000", "État, impôt sur les bénéfices", "liability_current"],
  ["443100", "État, TVA facturée", "liability_current"],
  ["445100", "État, TVA récupérable sur immobilisations", "asset_current"],
  ["445200", "État, TVA récupérable sur achats", "asset_current"],
  ["447000", "État, impôts retenus à la source", "liability_current"],
  ["471000", "Débiteurs et créditeurs divers", "liability_current"],
  ["476000", "Charges constatées d'avance", "asset_prepayments"],
  ["485000", "Créances sur cessions d'immobilisations", "asset_current"],
  ["513000", "Chèques à encaisser", "asset_current"],
  ["521110", "Banque du Golfe de Conakry, compte courant GNF", "asset_cash"],
  ["521120", "Banque Commerciale du Kaloum, compte GNF", "asset_cash"],
  ["521130", "Banque Commerciale du Kaloum, compte USD", "asset_cash"],
  ["521140", "Union Bancaire de Guinée, compte du cabinet", "asset_cash"],
  ["571100", "Caisse du siège", "asset_cash"],
  ["571200", "Caisse du parc de Matoto", "asset_cash"],
  ["571300", "Caisse du cabinet", "asset_cash"],
  ["585000", "Virements de fonds", "asset_current", true],
  ["604200", "Matières combustibles (gasoil des ensembles)", "expense"],
  ["604400", "Fournitures d'atelier et pièces détachées", "expense"],
  ["604500", "Matériaux et fournitures de chantier", "expense"],
  ["604700", "Fournitures de bureau", "expense"],
  ["605100", "Eau", "expense"],
  ["605200", "Électricité", "expense"],
  ["605300", "Autres énergies (groupes électrogènes)", "expense"],
  ["614000", "Transport du personnel", "expense"],
  ["618100", "Voyages, déplacements et péages", "expense"],
  ["622200", "Locations de bâtiments", "expense"],
  ["622300", "Locations de matériel et d'engins", "expense"],
  ["624100", "Entretien et réparations des bâtiments", "expense"],
  ["624200", "Entretien et réparations du matériel roulant", "expense"],
  ["625200", "Assurances du matériel de transport", "expense"],
  ["627000", "Publicité et relations publiques", "expense"],
  ["628100", "Frais de télécommunications", "expense"],
  ["631100", "Frais bancaires", "expense"],
  ["632400", "Honoraires", "expense"],
  ["633000", "Frais de formation du personnel", "expense"],
  ["637000", "Personnel extérieur (gardiennage)", "expense"],
  ["641000", "Impôts et taxes directs (patente, contribution foncière)", "expense"],
  ["645000", "Autres impôts et taxes (taxes à l'essieu, vignettes)", "expense"],
  ["658000", "Charges diverses", "expense"],
  ["661100", "Appointements, salaires et commissions", "expense"],
  ["663000", "Indemnités et primes de route", "expense"],
  ["664100", "Charges sociales (CNSS)", "expense"],
  ["671200", "Intérêts des emprunts", "expense"],
  ["672000", "Intérêts dans les loyers de crédit-bail", "expense"],
  ["674000", "Agios et autres intérêts", "expense"],
  ["681300", "Dotations aux amortissements des immobilisations corporelles", "expense_depreciation"],
  ["691000", "Dotations aux provisions d'exploitation", "expense"],
  ["705100", "Travaux facturés, chantiers", "income"],
  ["706100", "Transport de produits pétroliers", "income"],
  ["706300", "Loyers des immeubles de rapport", "income"],
  ["706400", "Honoraires de conseil et d'évaluation", "income"],
  ["706500", "Formations et accompagnement", "income"],
  ["707100", "Produits accessoires, refacturations", "income"],
  ["758000", "Produits divers", "income_other"],
  ["776000", "Gains de change", "income_other"],
  ["781000", "Transferts de charges d'exploitation", "income_other"],
  ["812000", "Valeurs comptables des cessions d'immobilisations corporelles", "expense"],
  ["822000", "Produits des cessions d'immobilisations corporelles", "income_other"],
  ["891000", "Impôts sur les bénéfices de l'exercice", "expense"],
];
const ACCOUNTS = ACCOUNT_DEFS.map(([code, name, type, reconcile], i) => ({ id: i + 1, code, name, type, reconcile: Boolean(reconcile) }));
const ACCOUNT_BY_CODE = new Map(ACCOUNTS.map((a) => [a.code, a]));
const ACCOUNT_BY_ID = new Map(ACCOUNTS.map((a) => [a.id, a]));
const accountRef = (code) => {
  const a = ACCOUNT_BY_CODE.get(code);
  return a ? { id: a.id, code: a.code, name: a.name } : null;
};
const accountName = (code) => ACCOUNT_BY_CODE.get(code)?.name ?? code;

/* ─── Journaux, taxes, devises ──────────────────────────────────────────── */

const JOURNALS = [
  { id: 1, company_id: 1, name: "Ventes", code: "VTE", type: "sale", currency: null, account: "706100", sequence: 1 },
  { id: 2, company_id: 1, name: "Achats", code: "ACH", type: "purchase", currency: null, account: "604200", sequence: 2 },
  { id: 3, company_id: 1, name: "Opérations diverses", code: "OD", type: "general", currency: null, account: null, sequence: 3 },
  { id: 4, company_id: 1, name: "À-nouveaux", code: "AN", type: "general", currency: null, account: null, sequence: 4 },
  { id: 5, company_id: 1, name: "Banque du Golfe, compte courant", code: "BGC", type: "bank", currency: null, account: "521110", sequence: 5, share: 0.42 },
  { id: 6, company_id: 1, name: "Banque Commerciale du Kaloum, GNF", code: "BCK", type: "bank", currency: null, account: "521120", sequence: 6, share: 0.27 },
  { id: 7, company_id: 1, name: "Banque Commerciale du Kaloum, USD", code: "BCKU", type: "bank", currency: "USD", account: "521130", sequence: 7, share: 0.17 },
  { id: 8, company_id: 1, name: "Caisse du siège, Kaloum", code: "CSG", type: "cash", currency: null, account: "571100", sequence: 8, share: 0.09 },
  { id: 9, company_id: 1, name: "Caisse du parc, Matoto", code: "CPM", type: "cash", currency: null, account: "571200", sequence: 9, share: 0.05 },
  { id: 11, company_id: 2, name: "Ventes", code: "VTE", type: "sale", currency: null, account: "706400", sequence: 1 },
  { id: 12, company_id: 2, name: "Achats", code: "ACH", type: "purchase", currency: null, account: "622200", sequence: 2 },
  { id: 13, company_id: 2, name: "Opérations diverses", code: "OD", type: "general", currency: null, account: null, sequence: 3 },
  { id: 14, company_id: 2, name: "À-nouveaux", code: "AN", type: "general", currency: null, account: null, sequence: 4 },
  { id: 15, company_id: 2, name: "Union Bancaire, compte du cabinet", code: "UBG", type: "bank", currency: null, account: "521140", sequence: 5, share: 0.88 },
  { id: 16, company_id: 2, name: "Caisse du cabinet", code: "CCB", type: "cash", currency: null, account: "571300", sequence: 6, share: 0.12 },
];
const journalById = (id) => JOURNALS.find((j) => j.id === id);
const journalRef = (id) => {
  const j = journalById(id);
  return j ? { id: j.id, name: j.name } : null;
};
const journalOf = (cid, code) => JOURNALS.find((j) => j.company_id === cid && j.code === code);
const cashJournals = (cid) => JOURNALS.filter((j) => j.company_id === cid && (j.type === "bank" || j.type === "cash"));

const TAXES = [
  { id: 1, company_id: 1, name: "TVA 18 %", amount: 18, use: "sale", account: "443100" },
  { id: 2, company_id: 1, name: "Exonéré (0 %)", amount: 0, use: "sale", account: "443100" },
  { id: 3, company_id: 1, name: "TVA déductible 18 %", amount: 18, use: "purchase", account: "445200" },
  { id: 4, company_id: 1, name: "TVA déductible sur immobilisations 18 %", amount: 18, use: "purchase", account: "445100" },
  { id: 5, company_id: 1, name: "Non soumis (0 %)", amount: 0, use: "purchase", account: "445200" },
  { id: 6, company_id: 2, name: "TVA 18 %", amount: 18, use: "sale", account: "443100" },
  { id: 7, company_id: 2, name: "Exonéré (0 %)", amount: 0, use: "sale", account: "443100" },
  { id: 8, company_id: 2, name: "TVA déductible 18 %", amount: 18, use: "purchase", account: "445200" },
  { id: 9, company_id: 2, name: "Non soumis (0 %)", amount: 0, use: "purchase", account: "445200" },
];
const taxById = (id) => TAXES.find((t) => t.id === id);
/** Taxe par défaut : TVA 18 % de la société, à la vente ou à l'achat. */
const defaultTax = (cid, use) => TAXES.find((t) => t.company_id === cid && t.use === use && t.amount === 18);
const exemptTax = (cid, use) => TAXES.find((t) => t.company_id === cid && t.use === use && t.amount === 0);

const CURRENCIES = [
  { id: 1, name: "GNF", symbol: "FG", rate: 1, inverse_rate: 1, date: null },
  { id: 2, name: "USD", symbol: "$", rate: 0.00011554, inverse_rate: 8655, date: "2026-10-15" },
  { id: 3, name: "EUR", symbol: "€", rate: 0.00009955, inverse_rate: 10045, date: "2026-10-14" },
  { id: 4, name: "XOF", symbol: "CFA", rate: 0.06531679, inverse_rate: 15.31, date: "2026-10-01" },
];
const usdRate = () => CURRENCIES.find((c) => c.name === "USD").inverse_rate;

const PLANS = {
  activite: "Activité",
  centre_cout: "Centre de coût",
  chantier: "Chantier",
  vehicule: "Ensemble routier",
  route: "Route",
  bien: "Bien immobilier",
  dossier: "Dossier AxisPro",
};

const ALERT_CODES = {
  cash_min: "Trésorerie minimale (GNF)",
  receivable_overdue_days: "Créances échues depuis plus de (jours)",
  receivable_overdue_amount: "Encours clients échu maximal (GNF)",
  close_delay_days: "Clôture mensuelle en retard de plus de (jours)",
  transit_account: "Compte de passage 585 non soldé",
  transport_margin_min: "Marge transport minimale (%)",
  budget_overrun_pct: "Dépassement budgétaire toléré (%)",
  approval_delay_days: "Validation en attente depuis plus de (jours)",
};

/** État en mémoire de la maquette, rempli par seed() au démarrage. */
const DB = {
  moves: [], statementLines: [], statements: [], approvals: [], approvalRules: [], reminders: [],
  loans: [], assets: [], assetProfiles: [], budgets: [], closings: [], thresholds: [], analytic: [],
  vehicles: [], drivers: [], routes: [], tariffs: [], rotations: [],
  chantiers: [], situations: [], properties: [], leases: [],
  policies: [], dossiers: [], evaluations: [], documents: [], reviews: [], messages: [], timesheets: [],
  audit: [], accessLog: [], passwordChanged: new Set(), revokedRefresh: new Set(),
  hsseq: null,
};
const IDS = { move: 1000, st: 5000, statement: 40, approval: 300, step: 900, reminder: 60, rotation: 0, situation: 0, lease: 20, property: 20, asset: 0, profile: 0, loan: 10, loanLine: 0, budget: 10, budgetItem: 0, attachment: 700, chantier: 10, vehicle: 30, driver: 30, route: 20, tariff: 20, rule: 20, review: 80, message: 400, timesheet: 600, document: 900, dossier: 20, policy: 3, analytic: 400, user: 60, partner: 300, audit: 9000 };
const newId = (kind) => ++IDS[kind];

/* ════════════════════════════════════════════════════════════════════════════
 * Données métier : financements, transport, chantiers, immobilier
 * ══════════════════════════════════════════════════════════════════════════ */

const PERIOD_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

/** Échéancier d'un financement (eguitra_finance.models.loan.compute_schedule). */
function computeSchedule(loan) {
  const step = PERIOD_MONTHS[loan.periodicity] || 1;
  const count = Math.max(1, Math.floor(loan.duration_months / step));
  const grace = Math.min(count - 1, Math.floor((loan.grace_months || 0) / step));
  const rate = ((loan.annual_rate || 0) / 100) * (step / 12);
  const amortizing = count - grace;
  let remaining = loan.principal;
  const annuity = loan.method === "annuity" && rate ? (loan.principal * rate) / (1 - (1 + rate) ** -amortizing) : null;
  const first = loan.first_due_date || addMonths(loan.start_date, step);
  loan.lines = [];
  for (let i = 0; i < count; i++) {
    const interest = Math.round(remaining * rate);
    let principal;
    if (i < grace) principal = 0;
    else if (i === count - 1) principal = remaining;
    else if (annuity !== null) principal = Math.round(annuity - remaining * rate);
    else principal = Math.round(loan.principal / amortizing);
    remaining -= principal;
    loan.lines.push({
      id: newId("loanLine"), sequence: i + 1, due_date: addMonths(first, step * i), principal, interest,
      total: principal + interest, remaining: Math.max(0, remaining), paid: false, move_id: null,
    });
  }
}
const loanOutstanding = (loan) => sum(loan.lines.filter((l) => !l.paid), (l) => l.principal);

function seedLoans() {
  const defs = [
    { id: 1, company_id: 1, name: "Emprunt BGC 2024-01, renouvellement de la flotte", kind: "loan", partner_id: 151, principal: 8_500_000_000, annual_rate: 13.5, start_date: "2024-02-15", duration_months: 60, grace_months: 0, periodicity: "monthly", method: "annuity", principal_account: "162100", interest_account: "671200", journal_id: 5, state: "active" },
    { id: 2, company_id: 1, name: "Crédit-bail ER-14 et ER-15", kind: "lease", partner_id: 153, principal: 3_400_000_000, annual_rate: 14.25, start_date: "2026-03-10", duration_months: 48, grace_months: 0, periodicity: "monthly", method: "annuity", principal_account: "172000", interest_account: "672000", journal_id: 6, state: "active" },
    { id: 3, company_id: 1, name: "Emprunt BCK 2025-03, entrepôt de Matoto", kind: "loan", partner_id: 152, principal: 4_200_000_000, annual_rate: 12.75, start_date: "2025-03-01", duration_months: 84, grace_months: 6, periodicity: "quarterly", method: "linear", principal_account: "162100", interest_account: "671200", journal_id: 6, state: "active" },
    { id: 4, company_id: 1, name: "Emprunt matériel de chantier 2021", kind: "loan", partner_id: 152, principal: 1_200_000_000, annual_rate: 14, start_date: "2021-06-01", duration_months: 48, grace_months: 0, periodicity: "monthly", method: "annuity", principal_account: "162100", interest_account: "671200", journal_id: 5, state: "closed" },
    { id: 5, company_id: 1, name: "Crédit de campagne carburant 2027 (projet)", kind: "loan", partner_id: 151, principal: 1_500_000_000, annual_rate: 12, start_date: "2026-11-02", duration_months: 12, grace_months: 0, periodicity: "monthly", method: "linear", principal_account: null, interest_account: null, journal_id: null, state: "draft" },
  ];
  for (const d of defs) {
    const loan = { ...d, first_due_date: null, lines: [] };
    computeSchedule(loan);
    if (loan.state !== "draft") {
      for (const line of loan.lines) {
        // Échéance trimestrielle du 1er septembre 2026 restée impayée : elle apparaît échue.
        line.paid = line.due_date < TODAY && !(loan.id === 3 && line.due_date === "2026-09-01");
      }
    }
    DB.loans.push(loan);
  }
}

/* ─── Transport pétrolier ───────────────────────────────────────────────── */

const PRODUCTS = [["gasoil", "Gasoil"], ["essence", "Essence"], ["jet", "Jet A1"], ["petrole", "Pétrole lampant"], ["fuel", "Fuel"], ["autre", "Autre produit"]];
const COSTS = [["fuel_cost", "Carburant"], ["toll_cost", "Péages"], ["driver_fees", "Frais du chauffeur"], ["maintenance_cost", "Entretien et réparations"], ["specific_taxes", "Taxes spécifiques"], ["other_costs", "Autres frais"]];
const ROTATION_NOTES = [
  "Attente de deux jours au déchargement.",
  "Contrôle routier prolongé à Kindia.",
  "Livraison de nuit, réception signée par le chef de dépôt.",
  "Route coupée par les pluies, détour par Mamou.",
  "Écart de jaugeage contesté par le client.",
];

function rateFor(routeId, partnerId, product) {
  const tariffs = DB.tariffs.filter((t) => t.route_id === routeId && t.partner_id === partnerId);
  const exact = tariffs.find((t) => t.product === product) || tariffs.find((t) => !t.product);
  return exact ? exact.rate : DB.routes.find((r) => r.id === routeId)?.default_rate ?? 0;
}
/** Montants calculés d'une rotation (eguitra_transport.models.rotation._compute_amounts). */
function computeRotation(rot) {
  const billed = rot.volume_delivered || rot.volume_loaded;
  rot.shortage = rot.volume_delivered ? Math.max(0, round3((rot.volume_loaded || 0) - (rot.volume_delivered || 0))) : 0;
  rot.revenue = round(billed * (rot.rate || 0));
  rot.total_cost = COSTS.reduce((s, [c]) => s + (Number(rot[c]) || 0), 0);
  rot.margin = rot.revenue - rot.total_cost;
  rot.margin_rate = rot.revenue ? (rot.margin / rot.revenue) * 100 : 0;
}
function makeRotation(r, vehicle, params, route, partnerId, product, date, days) {
  const km = route.distance_km;
  const loaded = round3((vehicle.capacity_liters / 1000) * (0.975 + r.next() * 0.023));
  const shortage = round3(r.chance(0.86) ? 0.008 + r.next() * 0.05 : 0.08 + r.next() * 0.27);
  const fuelPrice = date >= "2026-06-01" ? 12500 : 12000;
  return {
    id: 0, company_id: 1, name: null, state: "draft", source: "office", client_uuid: null,
    date_loading: date, date_delivery: addDays(date, Math.max(1, Math.ceil(km / 380))),
    vehicle_id: vehicle.id, driver_id: r.chance(0.08) ? r.pick([17, 18]) : vehicle.driver_id,
    partner_id: partnerId, route_id: route.id, product, delivery_note: String(r.int(41000, 48999)),
    volume_loaded: loaded, volume_delivered: round3(loaded - shortage), rate: rateFor(route.id, partnerId, product),
    fuel_cost: roundTo(2 * km * params.cons * fuelPrice, 1000),
    toll_cost: km > 100 ? roundTo(km * 1500 + 200000, 1000) : 0,
    driver_fees: roundTo(days * 450000 + 250000, 1000),
    maintenance_cost: roundTo(2 * km * params.maint, 1000),
    specific_taxes: km > 100 ? 900000 : 150000,
    other_costs: roundTo(300000 + r.next() * (km > 100 ? 1300000 : 300000), 1000),
    note: r.chance(0.04) ? r.pick(ROTATION_NOTES) : null,
    invoice_id: null,
  };
}
function productFor(r, partnerId) {
  if (partnerId === 105) return "jet";
  if (partnerId === 109) return "gasoil";
  if (partnerId === 107) return r.chance(0.5) ? "fuel" : "gasoil";
  return r.weighted([["gasoil", 70], ["essence", 22], ["petrole", 4], ["fuel", 4]]);
}

function seedTransport() {
  const r = makeRng("transport");
  const V = (id, name, tractor, trailer, brand, capacity, driver, state) => ({
    id, company_id: 1, name, tractor_plate: tractor, trailer_plate: trailer, brand, capacity_liters: capacity, driver_id: driver, state, active: state !== "off",
  });
  DB.vehicles = [
    V(1, "ER-01", "RC 4521 A", "RC 4522 B", "Renault Kerax 440", 40000, 1, "service"),
    V(2, "ER-02", "RC 3187 A", "RC 3188 B", "Mercedes Actros 3341", 36000, 2, "service"),
    V(3, "ER-03", "RC 1876 A", "RC 1877 B", "Mercedes Actros 2641", 33000, 3, "off"),
    V(4, "ER-04", "RC 2954 A", "RC 2955 B", "Renault Kerax 400", 33000, 4, "service"),
    V(5, "ER-05", "RC 6012 A", "RC 6013 B", "MAN TGS 33.400", 40000, 5, "service"),
    V(6, "ER-06", "RC 6014 A", "RC 6015 B", "MAN TGS 33.400", 40000, 6, "service"),
    V(7, "ER-07", "RC 5178 A", "RC 5179 B", "Mercedes Actros 3341", 38000, 7, "maintenance"),
    V(8, "ER-08", "RC 5180 A", "RC 5181 B", "Iveco Trakker 410", 36000, 8, "service"),
    V(9, "ER-09", "RC 7731 A", "RC 7732 B", "MAN TGS 33.440", 40000, 9, "service"),
    V(10, "ER-10", "RC 7733 A", "RC 7734 B", "MAN TGS 33.440", 40000, 10, "service"),
    V(11, "ER-11", "RC 7735 A", "RC 7736 B", "MAN TGS 33.440", 40000, 11, "maintenance"),
    V(12, "ER-12", "RC 7737 A", "RC 7738 B", "MAN TGS 33.440", 40000, 12, "service"),
    V(13, "ER-13", "RC 7739 A", "RC 7740 B", "MAN TGS 33.440", 40000, 13, "service"),
    V(14, "ER-14", "RC 9402 A", "RC 9403 B", "Volvo FMX 440", 45000, 14, "service"),
    V(15, "ER-15", "RC 9404 A", "RC 9405 B", "Volvo FMX 440", 45000, 15, "service"),
    V(16, "ER-16", "RC 8815 A", "RC 8816 B", "Volvo FMX 440", 45000, 16, "service"),
  ];
  const D = (id, name, license, expiry) => ({
    id, company_id: 1, name, phone: `+224 62${id % 10} ${pad(10 + id * 3)} ${pad((id * 17) % 100)} ${pad((id * 29) % 100)}`,
    license_number: license, license_expiry: expiry, active: true,
  });
  DB.drivers = [
    D(1, "Amadou Oury Diallo", "PL-2017-00415", "2028-03-31"),
    D(2, "Mamadou Aliou Bah", "PL-2016-00288", "2027-09-30"),
    D(3, "Ibrahima Camara", "PL-2014-00107", "2027-06-30"),
    D(4, "Naby Bangoura", "PL-2015-00163", "2026-08-31"),
    D(5, "Fodé Sylla", "PL-2019-00532", "2029-01-31"),
    D(6, "Lamine Barry", "PL-2018-00477", "2027-11-30"),
    D(7, "Alseny Keïta", "PL-2018-00490", "2028-07-31"),
    D(8, "Mamady Touré", "PL-2016-00301", "2026-11-30"),
    D(9, "Karim Sow", "PL-2020-00611", "2029-05-31"),
    D(10, "Souleymane Diallo", "PL-2019-00577", "2028-09-30"),
    D(11, "Thierno Bah", "PL-2017-00398", "2027-02-28"),
    D(12, "Abdoul Karim Camara", "PL-2020-00640", "2028-12-31"),
    D(13, "Mohamed Soumah", "PL-2018-00455", "2027-08-31"),
    D(14, "Ousmane Sylla", "PL-2021-00702", "2029-10-31"),
    D(15, "Boubacar Bah", "PL-2021-00715", "2028-04-30"),
    D(16, "Moussa Bangoura", "PL-2019-00588", "2027-05-31"),
    D(17, "Aboubacar Keïta", "PL-2022-00810", "2028-01-31"),
    D(18, "Ismaël Sow", null, null),
  ];
  const R = (id, name, destination, km, rate) => ({
    id, company_id: 1, name, origin: "Dépôt de Conakry", destination, distance_km: km,
    default_rate: rate ?? roundTo(1500 * km + 70000, 5000), active: true,
  });
  DB.routes = [
    R(1, "Conakry - Kindia", "Kindia", 135),
    R(2, "Conakry - Fria", "Fria", 160),
    R(3, "Conakry - Mamou", "Mamou", 270),
    R(4, "Conakry - Boké", "Boké", 300),
    R(5, "Conakry - Kamsar", "Kamsar", 320),
    R(6, "Conakry - Labé", "Labé", 420),
    R(7, "Conakry - Kankan", "Kankan", 650),
    R(8, "Conakry - Siguiri", "Siguiri", 790),
    R(9, "Dépôt de Conakry - Aéroport de Gbessia", "Aéroport de Gbessia", 18, 115000),
  ];
  const T = (id, route_id, partner_id, product, rate) => ({ id, route_id, partner_id, product, rate });
  DB.tariffs = [
    T(1, 4, 101, null, 495000),
    T(2, 5, 102, "gasoil", 525000),
    T(3, 5, 102, "essence", 545000),
    T(4, 8, 103, null, 1210000),
    T(5, 7, 104, null, 1020000),
    T(6, 9, 105, "jet", 105000),
    T(7, 3, 108, null, 455000),
  ];
  const plan = {
    1: { routes: [[9, 3], [1, 3], [2, 2]], cons: 0.42, maint: 9000 },
    2: { routes: [[1, 3], [2, 2], [3, 2], [9, 1]], cons: 0.44, maint: 9500 },
    3: { routes: [[4, 3], [3, 2]], cons: 0.47, maint: 11500, end: "2026-05-18" },
    4: { routes: [[4, 3], [5, 2], [2, 1]], cons: 0.5, maint: 13000 },
    5: { routes: [[8, 5], [7, 1]], cons: 0.41, maint: 8500 },
    6: { routes: [[8, 4], [7, 2]], cons: 0.41, maint: 8500 },
    7: { routes: [[8, 3], [7, 3]], cons: 0.43, maint: 9500, end: "2026-09-21" },
    8: { routes: [[6, 4], [3, 2]], cons: 0.44, maint: 9500 },
    9: { routes: [[4, 3], [5, 3]], cons: 0.4, maint: 8000 },
    10: { routes: [[5, 3], [4, 2], [7, 1]], cons: 0.4, maint: 8000 },
    11: { routes: [[7, 3], [8, 2]], cons: 0.4, maint: 8000, end: "2026-10-06" },
    12: { routes: [[4, 3], [5, 2]], cons: 0.4, maint: 8000 },
    13: { routes: [[7, 2], [6, 2], [3, 1]], cons: 0.4, maint: 8000 },
    14: { routes: [[5, 4], [4, 2]], cons: 0.43, maint: 7500, start: "2026-03-16" },
    15: { routes: [[5, 3], [4, 3]], cons: 0.43, maint: 7500, start: "2026-03-17" },
    16: { routes: [[7, 3], [8, 2]], cons: 0.43, maint: 7500 },
  };
  const routeClients = {
    1: [[110, 5], [109, 1]], 2: [[106, 1]], 3: [[109, 3], [108, 2]], 4: [[101, 5], [107, 2]], 5: [[102, 1]],
    6: [[108, 1]], 7: [[104, 1]], 8: [[103, 1]], 9: [[105, 1]],
  };
  const route = (id) => DB.routes.find((x) => x.id === id);
  const vehicle = (id) => DB.vehicles.find((x) => x.id === id);
  const raw = [];
  for (const v of DB.vehicles) {
    const p = plan[v.id];
    let t = p.start || addDays("2026-01-02", v.id % 4);
    const end = p.end || TODAY;
    while (t <= end) {
      const rt = route(r.weighted(p.routes));
      let client = r.weighted(routeClients[rt.id]);
      if (client === 107 && t > "2026-05-31") client = 101;
      const month = +t.slice(5, 7);
      const rainy = month >= 7 && month <= 9;
      const days = Math.max(1, Math.round((2 * rt.distance_km) / (rainy ? 300 : 380))) + (rt.distance_km > 100 ? 1 : 0) + r.int(0, rainy ? 2 : 1);
      raw.push(makeRotation(r, v, p, rt, client, productFor(r, client), t, days));
      t = addDays(t, days);
    }
  }
  const breakdown = makeRotation(r, vehicle(7), plan[7], route(8), 103, "gasoil", "2026-09-24", 9);
  breakdown.maintenance_cost += 62_000_000;
  breakdown.note = "Panne de boîte de vitesses à Kouroussa : remorquage et réparation imputés à la rotation.";
  raw.push(breakdown);
  const incomplete = makeRotation(r, vehicle(8), plan[8], route(6), 108, "essence", "2026-10-04", 4);
  Object.assign(incomplete, { volume_loaded: 0, volume_delivered: 0, delivery_note: null, date_delivery: null, note: "Volume à confirmer avec le bon de livraison.", forceDraft: true });
  raw.push(incomplete);

  raw.sort((a, b) => a.date_loading.localeCompare(b.date_loading) || a.vehicle_id - b.vehicle_id);
  let seq = 0;
  for (const rot of raw) {
    rot.id = newId("rotation");
    if (rot.forceDraft) rot.state = "draft";
    else if (rot.date_loading <= "2026-09-30") rot.state = r.chance(0.012) ? "cancelled" : "invoiced";
    else if (rot.date_loading <= "2026-10-09") rot.state = "done";
    else rot.state = "draft";
    rot.source = r.chance(rot.state === "draft" ? 0.6 : 0.3) ? "mobile" : "office";
    if (rot.source === "mobile") rot.client_uuid = r.uuid();
    if (rot.state === "draft" && rot.date_loading > addDays(TODAY, -3)) {
      rot.date_delivery = null;
      rot.volume_delivered = 0;
      rot.delivery_note = null;
    }
    if (rot.state !== "draft") rot.name = `ROT/2026/${pad(++seq, 5)}`;
    delete rot.forceDraft;
    computeRotation(rot);
  }
  DB.rotations = raw;
  IDS.rotationSeq = seq;
}

/* ─── Chantiers ─────────────────────────────────────────────────────────── */

function seedChantiers() {
  const defs = [
    { id: 1, name: "Réhabilitation de la route Boké - Kamsar, lot 2", code: "CH-2025-07", partner_id: 111, contract_amount: 9_600_000_000, retention_rate: 5, state: "progress", date_start: "2025-11-03", date_end: "2027-03-31", location: "Boké", costs: 4_870_000_000,
      path: [["2025-12-31", 5], ["2026-01-31", 11], ["2026-02-28", 16], ["2026-03-31", 22], ["2026-04-30", 29], ["2026-05-31", 36], ["2026-06-30", 43], ["2026-07-31", 47], ["2026-08-31", 51], ["2026-09-30", 58, "Travaux de septembre 2026 (saisie erronée)", "cancelled"], ["2026-09-30", 61]] },
    { id: 2, name: "Immeuble de bureaux R+5, Kipé", code: "CH-2026-02", partner_id: 112, contract_amount: 6_400_000_000, retention_rate: 5, state: "progress", date_start: "2026-02-02", date_end: "2027-06-30", location: "Kipé, Ratoma", costs: 1_960_000_000,
      path: [["2026-03-31", 6], ["2026-04-30", 11], ["2026-05-31", 17], ["2026-06-30", 23], ["2026-07-31", 27], ["2026-08-31", 31], ["2026-09-30", 36]] },
    { id: 3, name: "Extension de la clinique Les Palmiers", code: "CH-2025-05", partner_id: 113, contract_amount: 2_900_000_000, retention_rate: 5, state: "received", date_start: "2025-09-15", date_end: "2026-08-31", date_reception: "2026-09-12", location: "Dixinn", costs: 2_540_000_000,
      path: [["2025-10-31", 12], ["2025-11-30", 24], ["2025-12-31", 35], ["2026-01-31", 47], ["2026-02-28", 58], ["2026-03-31", 69], ["2026-04-30", 78], ["2026-05-31", 86], ["2026-06-30", 92], ["2026-08-31", 97], ["2026-09-30", 100]] },
    { id: 4, name: "Dalle et merlons du dépôt de Kankan", code: "CH-2025-03", partner_id: 104, contract_amount: 1_900_000_000, retention_rate: 7, state: "closed", date_start: "2025-06-02", date_end: "2025-12-20", date_reception: "2025-12-20", location: "Kankan", costs: 1_610_000_000, releaseDate: "2026-06-22",
      path: [["2025-06-30", 14], ["2025-07-31", 27], ["2025-08-31", 38], ["2025-09-30", 55], ["2025-10-31", 72], ["2025-11-30", 90], ["2025-12-31", 100]] },
    { id: 5, name: "Voirie et réseaux du lotissement de Matoto", code: "CH-2026-06", partner_id: 112, contract_amount: 4_200_000_000, retention_rate: 5, state: "progress", date_start: "2026-07-01", date_end: "2027-09-30", location: "Matoto", costs: 618_000_000,
      path: [["2026-08-31", 5], ["2026-09-30", 11], ["2026-10-15", 16, "Travaux d'octobre 2026, première quinzaine", "draft"]] },
    { id: 6, name: "Centre de formation professionnelle de Mamou", code: "CH-2026-09", partner_id: 114, contract_amount: 3_600_000_000, retention_rate: 5, state: "preparation", date_start: "2026-11-16", date_end: "2028-02-29", location: "Mamou", costs: 46_000_000, path: [] },
  ];
  for (const d of defs) {
    const ch = {
      id: d.id, company_id: 1, name: d.name, code: d.code, partner_id: d.partner_id, contract_amount: d.contract_amount,
      retention_rate: d.retention_rate, state: d.state, date_start: d.date_start, date_end: d.date_end ?? null,
      date_reception: d.date_reception ?? null, location: d.location, costs: d.costs, retention_released: 0, releaseDate: d.releaseDate ?? null,
    };
    DB.chantiers.push(ch);
    d.path.forEach(([date, pct, label, state], i) => {
      DB.situations.push({
        id: newId("situation"), chantier_id: ch.id, number: i + 1, date, period_label: label || `Travaux ${ofMonth(date)}`,
        cumulative_amount: roundTo((ch.contract_amount * pct) / 100, 1000), state: state || "invoiced", invoice_id: null,
      });
    });
    if (ch.releaseDate) ch.retention_released = chantierTotals(ch).retention_total;
  }
}
const situationsOf = (ch) => DB.situations.filter((s) => s.chantier_id === ch.id).sort((a, b) => a.number - b.number);
/** Montants d'une situation (eguitra_chantier ... _compute_amounts). */
function situationAmounts(sit) {
  const ch = DB.chantiers.find((c) => c.id === sit.chantier_id);
  const previous = DB.situations.filter((s) => s.chantier_id === ch.id && s.state === "invoiced" && s.number < sit.number);
  const prev = previous.length ? Math.max(...previous.map((s) => s.cumulative_amount)) : 0;
  const amountPeriod = sit.cumulative_amount - prev;
  return {
    previous_amount: prev,
    amount_period: amountPeriod,
    retention_amount: round((amountPeriod * (ch.retention_rate || 0)) / 100),
    progress_pct: ch.contract_amount ? (sit.cumulative_amount / ch.contract_amount) * 100 : 0,
  };
}
function chantierTotals(ch) {
  const sits = situationsOf(ch);
  const done = sits.filter((s) => s.state === "invoiced").map((s) => ({ ...s, ...situationAmounts(s) }));
  const last = sits.filter((s) => s.state !== "cancelled").slice(-1)[0];
  return {
    invoiced_amount: sum(done, (s) => s.amount_period),
    retention_total: sum(done, (s) => s.retention_amount),
    progress_pct: last && ch.contract_amount ? (last.cumulative_amount / ch.contract_amount) * 100 : 0,
  };
}

/* ─── Immobilier ────────────────────────────────────────────────────────── */

const PROPERTY_KINDS = [["appartement", "Appartement"], ["villa", "Villa"], ["bureau", "Bureau"], ["magasin", "Magasin"], ["entrepot", "Entrepôt"], ["terrain", "Terrain"], ["immeuble", "Immeuble"]];

function seedImmobilier() {
  const P = (id, name, kind, address, city, area, acqDate, acqValue, current, valDate) => ({
    id, company_id: 1, name, kind, address, city, area_m2: area, acquisition_date: acqDate, acquisition_value: acqValue,
    current_value: current, valuation_date: valDate, note: null, active: true,
  });
  DB.properties = [
    P(1, "Plateau de bureaux, 3e étage, immeuble Kaloum Centre", "bureau", "Avenue de la République, Kaloum", "Conakry", 420, "2019-04-01", 6_800_000_000, 8_400_000_000, "2025-12-31"),
    P(2, "Villa K12, Kipé Centre émetteur", "villa", "Kipé Centre émetteur, Ratoma", "Conakry", 380, "2018-07-01", 3_900_000_000, 4_600_000_000, "2025-12-31"),
    P(3, "Appartement F4, résidence Les Cocotiers", "appartement", "Résidence Les Cocotiers, Ratoma", "Conakry", 140, "2020-02-01", 1_450_000_000, 1_600_000_000, "2025-12-31"),
    P(4, "Appartement F3, résidence Les Cocotiers", "appartement", "Résidence Les Cocotiers, Ratoma", "Conakry", 105, "2020-02-01", 1_150_000_000, 1_250_000_000, "2025-12-31"),
    P(5, "Magasin n° 2, marché de Matoto", "magasin", "Marché de Matoto", "Conakry", 60, "2017-05-01", 420_000_000, 550_000_000, "2025-12-31"),
    P(6, "Entrepôt logistique, zone industrielle de Matoto", "entrepot", "Zone industrielle, Matoto", "Conakry", 1800, "2025-03-01", 4_200_000_000, 4_350_000_000, "2026-06-30"),
    P(7, "Immeuble R+3, Dixinn Port", "immeuble", "Dixinn Port", "Conakry", 900, "2016-09-01", 7_200_000_000, 9_800_000_000, "2025-12-31"),
    P(8, "Bureaux de Dixinn, villa reconvertie", "bureau", "Dixinn Gare", "Conakry", 260, "2015-03-01", 1_600_000_000, 2_100_000_000, "2024-12-31"),
    P(9, "Terrain nu, Kagbelen", "terrain", "Kagbelen", "Dubréka", 4500, "2021-11-01", 900_000_000, 0, null),
    P(10, "Villa R5, Kaporo", "villa", "Kaporo, Ratoma", "Conakry", 320, "2019-10-01", 3_200_000_000, 3_800_000_000, "2025-12-31"),
    P(11, "Appartement F2, Boulbinet", "appartement", "Boulbinet, Kaloum", "Conakry", 75, "2022-04-01", 780_000_000, 0, null),
    P(12, "Local commercial, carrefour de Kipé", "magasin", "Carrefour de Kipé, Ratoma", "Conakry", 120, "2021-01-01", 1_150_000_000, 1_400_000_000, "2025-12-31"),
  ];
  const L = (id, name, property_id, partner_id, date_start, date_end, rent, charges, periodicity, vat, deposit, state, next, delay) => ({
    id, company_id: 1, name, property_id, partner_id, date_start, date_end, rent, charges, periodicity, vat, deposit_amount: deposit,
    state, next_invoice_date: next, payDelay: delay,
  });
  DB.leases = [
    L(1, "BAIL-2023-004", 1, 115, "2023-01-01", "2028-12-31", 72_000_000, 6_500_000, "monthly", true, 216_000_000, "active", "2026-11-01", 3),
    L(2, "BAIL-2025-002", 2, 120, "2025-02-01", "2027-01-31", 28_000_000, 0, "monthly", false, 84_000_000, "active", "2026-11-01", 8),
    L(3, "BAIL-2024-009", 3, 119, "2024-09-01", "2026-12-31", 11_500_000, 0, "monthly", false, 34_500_000, "active", "2026-11-01", 6),
    L(4, "BAIL-2025-011", 4, 121, "2025-04-01", "2027-03-31", 9_000_000, 800_000, "monthly", false, 27_000_000, "active", "2026-11-01", 12),
    L(5, "BAIL-2022-006", 5, 117, "2022-06-01", null, 4_800_000, 0, "monthly", true, 14_400_000, "active", "2026-11-01", 15),
    L(6, "BAIL-2025-007", 6, 118, "2025-07-15", "2030-07-14", 345_000_000, 15_000_000, "quarterly", true, 690_000_000, "active", "2026-10-15", 5),
    L(7, "BAIL-2021-003", 7, 116, "2021-01-01", "2026-12-31", 210_000_000, 0, "quarterly", true, 420_000_000, "active", "2027-01-01", 9),
    L(8, "BAIL-2023-010", 8, 122, "2023-07-01", "2026-06-30", 16_000_000, 0, "monthly", true, 48_000_000, "terminated", null, 4),
    L(9, "BAIL-2024-005", 10, 123, "2024-05-01", "2027-04-30", 24_000_000, 1_200_000, "monthly", true, 72_000_000, "active", "2026-11-01", 4),
    L(10, "BAIL-2021-008", 12, 124, "2021-03-01", "2027-02-28", 8_500_000, 0, "monthly", true, 25_500_000, "active", "2026-11-01", 6),
  ];
}
const propertyOccupied = (p) => DB.leases.some((l) => l.property_id === p.id && l.state === "active");
/** Échéances de loyer 2026 émises jusqu'à la date de référence. */
function rentPeriods() {
  const out = [];
  for (const lease of DB.leases) {
    const step = lease.periodicity === "quarterly" ? 3 : lease.periodicity === "yearly" ? 12 : 1;
    let d = lease.periodicity === "monthly" ? "2026-01-01" : lease.id === 6 ? "2026-01-15" : "2026-01-01";
    while (d <= TODAY) {
      const inLease = d >= lease.date_start && (!lease.date_end || d <= lease.date_end);
      const notYet = lease.next_invoice_date && d >= lease.next_invoice_date;
      if (inLease && !notYet) out.push({ lease, date: d, months: step });
      d = addMonths(d, step);
    }
  }
  return out;
}

/* ════════════════════════════════════════════════════════════════════════════
 * Comptabilité générale : produits et charges mensuels, bilan, états SYSCOHADA
 * ══════════════════════════════════════════════════════════════════════════ */

/** Produits et charges par mois : PL[société].get("AAAA-MM") = { compte: solde (débit positif) }. */
const PL = { 1: new Map(), 2: new Map() };
/** Dotations aux amortissements par mois et par compte 28x. */
const DEP_SPLIT = { 1: new Map(), 2: new Map() };
/** Le mois en cours ne court que jusqu'à la date de référence. */
const PARTIAL = Number(TODAY.slice(8, 10)) / lastDayOf(+TODAY.slice(0, 4), +TODAY.slice(5, 7));

/** Paramètres de bilan par société ; la trésorerie équilibre la balance. */
const BS = {
  1: {
    gross0: { "213000": 350e6, "222000": 2400e6, "231100": 3100e6, "231300": 1800e6, "234000": 650e6, "241000": 2600e6, "244100": 280e6, "244400": 170e6, "245100": 19800e6, "245200": 1100e6 },
    accDep0: { "281300": 190e6, "283100": 1480e6, "284100": 1350e6, "284400": 260e6, "284500": 7900e6 },
    life: { "213000": 5, "231100": 25, "231300": 25, "234000": 10, "241000": 8, "244100": 4, "244400": 10, "245100": 8, "245200": 5 },
    depAccount: { "213000": "281300", "231100": "283100", "231300": "283100", "234000": "284100", "241000": "284100", "244100": "284400", "244400": "284400", "245100": "284500", "245200": "284500" },
    capex: [
      { date: "2024-02-15", code: "245100", amount: 8450e6 },
      { date: "2025-03-01", code: "231300", amount: 4200e6 },
      { date: "2024-09-15", code: "231300", amount: 1500e6 },
      { date: "2025-06-20", code: "245100", amount: 1650e6 },
      { date: "2025-11-20", code: "241000", amount: 1500e6 },
      { date: "2026-03-12", code: "245100", amount: 3400e6 },
      { date: "2026-07-08", code: "241000", amount: 620e6 },
    ],
    disposals: [{ date: "2026-05-28", gross: { "245100": 1150e6 }, dep: { "284500": 940e6 } }],
    stocks: 1150e6, advances: 210e6, prepaid: 120e6, fnp: 150e6, clientAdvances: 180e6, salariesDue: 40e6, withholding: 35e6, misc: 120e6, accrued: 45e6,
    capital: 6000e6, legal: 600e6, reserves: 1400e6,
    dividends: [{ date: "2024-06-28", amount: 3000e6 }, { date: "2025-06-30", amount: 3600e6 }, { date: "2026-06-30", amount: 4200e6 }],
    // Classe 5 hors journaux de banque et de caisse (détail cash_other) : virement interne non
    // réceptionné (585) et chèques clients remis, à encaisser (513).
    transit: [{ from: "2026-10-14", amount: 180e6 }],
    cheques: [{ from: "2026-10-14", amount: 70e6 }],
    cashTarget: 4_380_000_000, ran0: 0, kR: 1, kP: 1,
  },
  2: {
    gross0: { "244100": 95e6, "244400": 70e6 },
    accDep0: { "284400": 60e6 },
    life: { "244100": 4, "244400": 10, "245200": 5 },
    depAccount: { "244100": "284400", "244400": "284400", "245200": "284500" },
    capex: [
      { date: "2025-01-15", code: "244100", amount: 128e6 },
      { date: "2026-02-10", code: "245200", amount: 320e6 },
    ],
    disposals: [],
    stocks: 0, advances: 8e6, prepaid: 14e6, fnp: 9e6, clientAdvances: 25e6, salariesDue: 6e6, withholding: 4e6, misc: 12e6, accrued: 0,
    capital: 500e6, legal: 50e6, reserves: 120e6,
    dividends: [{ date: "2024-06-28", amount: 150e6 }, { date: "2025-06-30", amount: 440e6 }, { date: "2026-06-30", amount: 430e6 }],
    transit: [],
    cheques: [],
    cashTarget: 268_000_000, ran0: 0, kR: 1, kP: 1,
  },
};

const putPL = (cid, key, code, amount) => {
  if (!amount) return;
  const m = PL[cid].get(key) || {};
  m[code] = (m[code] || 0) + amount;
  PL[cid].set(key, m);
};
/** Part d'un mois comprise dans [from, to] (le mois en cours s'arrête à la date de référence). */
function monthFraction(key, from, to) {
  const start = `${key}-01`;
  if (start > TODAY) return 0;
  const end = key === TODAY.slice(0, 7) ? TODAY : monthEnd(start);
  const a = maxDate(start, from);
  const b = minDate(end, to);
  if (a > b) return 0;
  return (daysBetween(a, b) + 1) / (daysBetween(start, end) + 1);
}
/** Soldes des comptes de gestion sur une période, toutes sociétés demandées confondues. */
function plRange(cids, from, to) {
  const out = {};
  const end = minDate(to, TODAY);
  if (!from || from > end) return out;
  for (const cid of cids) {
    for (const key of monthKeys(maxDate(from, "2024-01-01"), end)) {
      const amounts = PL[cid].get(key);
      if (!amounts) continue;
      const f = monthFraction(key, from, end);
      if (!f) continue;
      for (const [code, v] of Object.entries(amounts)) out[code] = (out[code] || 0) + v * f;
    }
  }
  return out;
}
const sumPrefix = (balances, prefixes) =>
  Object.entries(balances).reduce((s, [code, v]) => (prefixes.some((p) => code.startsWith(p)) ? s + v : s), 0);
const revenueBetween = (cids, from, to) => -sumPrefix(plRange(cids, from, to), ["70"]);
const purchasesBetween = (cids, from, to) => sumPrefix(plRange(cids, from, to), ["60", "61", "62", "63"]);

function grossAt(cid, d) {
  const p = BS[cid];
  const out = { ...p.gross0 };
  for (const c of p.capex) if (c.date <= d) out[c.code] = (out[c.code] || 0) + c.amount;
  for (const x of p.disposals) if (x.date <= d) for (const [code, v] of Object.entries(x.gross)) out[code] -= v;
  return out;
}
function accDepAt(cid, d) {
  const p = BS[cid];
  const out = { ...p.accDep0 };
  for (const [key, split] of DEP_SPLIT[cid]) {
    const f = monthFraction(key, "2024-01-01", d);
    if (!f) continue;
    for (const [acc, v] of Object.entries(split)) out[acc] = (out[acc] || 0) + v * f;
  }
  for (const x of p.disposals) if (x.date <= d) for (const [code, v] of Object.entries(x.dep)) out[code] -= v;
  return out;
}
function debtAt(cid, d) {
  const out = { loan: 0, lease: 0 };
  for (const loan of DB.loans) {
    if (loan.company_id !== cid || loan.state === "draft" || d < loan.start_date) continue;
    const repaid = sum(loan.lines.filter((l) => l.paid && l.due_date <= d), (l) => l.principal);
    out[loan.kind === "lease" ? "lease" : "loan"] += loan.principal - repaid;
  }
  return out;
}
const YEAR_RESULT = new Map();
function yearResult(cid, year) {
  const key = `${cid}-${year}`;
  if (!YEAR_RESULT.has(key)) {
    const pl = plRange([cid], `${year}-01-01`, `${year}-12-31`);
    YEAR_RESULT.set(key, -Object.values(pl).reduce((s, v) => s + v, 0));
  }
  return YEAR_RESULT.get(key);
}
function retainedAt(cid, d) {
  let total = 0;
  for (let y = 2024; y < +d.slice(0, 4); y++) total += yearResult(cid, y);
  return total - sum(BS[cid].dividends.filter((x) => x.date <= d), (x) => x.amount);
}
function incomeTaxDue(cid, d) {
  const y = +d.slice(0, 4);
  let due = sumPrefix(plRange([cid], `${y}-01-01`, d), ["891"]);
  if (d <= `${y}-04-30`) due += sumPrefix(plRange([cid], `${y - 1}-01-01`, `${y - 1}-12-31`), ["891"]);
  return due;
}
const provisionsAt = (cid, d) => sumPrefix(plRange([cid], "2024-01-01", d), ["691"]);
const transitAt = (cid, d) => sum(BS[cid].transit.filter((t) => t.from <= d), (t) => t.amount);
const chequesAt = (cid, d) => sum(BS[cid].cheques.filter((t) => t.from <= d), (t) => t.amount);
function retentionAt(cid, d) {
  let total = 0;
  for (const ch of DB.chantiers.filter((c) => c.company_id === cid)) {
    for (const s of situationsOf(ch)) if (s.state === "invoiced" && s.date <= d) total += situationAmounts(s).retention_amount;
    if (ch.releaseDate && ch.releaseDate <= d) total -= ch.retention_released;
  }
  return total;
}
const monthAmount = (cid, d, code) => (PL[cid].get(d.slice(0, 7)) || {})[code] || 0;

/** Comptes de bilan à une date (hors trésorerie, qui équilibre la balance). */
function bsAt(cid, d) {
  const p = BS[cid];
  const out = {};
  const add = (code, v) => {
    if (v) out[code] = (out[code] || 0) + v;
  };
  for (const [code, v] of Object.entries(grossAt(cid, d))) add(code, v);
  for (const [code, v] of Object.entries(accDepAt(cid, d))) add(code, -v);
  if (p.stocks) add("332000", p.stocks * (1 + 0.06 * Math.sin((+d.slice(5, 7) / 12) * 2 * Math.PI)));
  add("411100", p.kR * 1.18 * revenueBetween([cid], addDays(d, -40), d));
  add("411700", retentionAt(cid, d));
  add("409100", p.advances);
  add("445200", 0.18 * 0.45 * purchasesBetween([cid], addDays(d, -30), d));
  add("476000", p.prepaid);
  add("401100", -p.kP * 1.18 * purchasesBetween([cid], addDays(d, -35), d));
  add("408100", -p.fnp);
  add("419100", -p.clientAdvances);
  add("422000", -p.salariesDue);
  add("431000", -monthAmount(cid, d, "664100"));
  add("443100", -0.18 * 0.93 * 0.6 * revenueBetween([cid], addDays(d, -30), d));
  add("441000", -incomeTaxDue(cid, d));
  add("447000", -p.withholding);
  add("471000", -p.misc);
  const debt = debtAt(cid, d);
  add("162100", -debt.loan);
  add("172000", -debt.lease);
  add("166000", -p.accrued);
  add("191000", -provisionsAt(cid, d));
  add("101300", -p.capital);
  add("111000", -p.legal);
  add("118000", -p.reserves);
  add("121000", -(p.ran0 + retainedAt(cid, d)));
  add("585000", transitAt(cid, d));
  add("513000", chequesAt(cid, d));
  return out;
}
/** Balance complète d'une société à une date : bilan, résultat de l'exercice, trésorerie. */
function balancesAt(cid, D) {
  const d = minDate(D, TODAY);
  const out = bsAt(cid, d);
  for (const [code, v] of Object.entries(plRange([cid], `${d.slice(0, 4)}-01-01`, d))) out[code] = (out[code] || 0) + v;
  const plug = -Object.values(out).reduce((s, v) => s + v, 0);
  const journals = cashJournals(cid);
  let rest = plug;
  journals.forEach((j, i) => {
    const v = i === journals.length - 1 ? rest : plug * j.share;
    out[j.account] = (out[j.account] || 0) + v;
    rest -= v;
  });
  return out;
}
function sumBalances(cids, d) {
  const out = {};
  for (const cid of cids) for (const [code, v] of Object.entries(balancesAt(cid, d))) out[code] = (out[code] || 0) + v;
  return out;
}
const classFive = (balances) => sumPrefix(balances, ["5"]);

/** Produits et charges mensuels : exploitation réelle en 2026 (rotations, situations, loyers), historique simulé avant. */
function buildLedger() {
  const r = makeRng("comptabilite");
  const keys = monthKeys("2024-01-01", TODAY);
  const current = TODAY.slice(0, 7);
  for (const cid of COMPANY_IDS) {
    PL[cid] = new Map();
    DEP_SPLIT[cid] = new Map();
    for (const key of keys) {
      const f = key === current ? PARTIAL : 1;
      const split = {};
      for (const [code, value] of Object.entries(grossAt(cid, `${key}-01`))) {
        const life = BS[cid].life[code];
        if (!life || value <= 0) continue;
        const acc = BS[cid].depAccount[code];
        split[acc] = (split[acc] || 0) + (value / life / 12) * f;
      }
      DEP_SPLIT[cid].set(key, split);
      putPL(cid, key, "681300", sum(Object.values(split)));
    }
  }
  for (const loan of DB.loans) {
    if (loan.state === "draft") continue;
    for (const line of loan.lines) {
      if (line.due_date > TODAY || line.due_date < "2024-01-01") continue;
      putPL(loan.company_id, line.due_date.slice(0, 7), loan.kind === "lease" ? "672000" : "671200", line.interest);
    }
  }

  // Société 1 : activité réelle de 2026.
  const ops = new Map();
  for (const rot of DB.rotations) {
    if (rot.state === "cancelled" || !(rot.volume_delivered || rot.volume_loaded)) continue;
    const key = rot.date_loading.slice(0, 7);
    const o = ops.get(key) || { revenue: 0, fuel: 0, toll: 0, driver: 0, maint: 0, taxes: 0, other: 0 };
    o.revenue += rot.revenue;
    o.fuel += rot.fuel_cost;
    o.toll += rot.toll_cost;
    o.driver += rot.driver_fees;
    o.maint += rot.maintenance_cost;
    o.taxes += rot.specific_taxes;
    o.other += rot.other_costs;
    ops.set(key, o);
  }
  const btp = new Map();
  for (const sit of DB.situations) {
    if (sit.state !== "invoiced") continue;
    const key = sit.date.slice(0, 7);
    btp.set(key, (btp.get(key) || 0) + situationAmounts(sit).amount_period);
  }
  const rents = new Map();
  for (const p of rentPeriods()) {
    const key = p.date.slice(0, 7);
    const x = rents.get(key) || { rent: 0, charges: 0 };
    x.rent += p.lease.rent;
    x.charges += p.lease.charges;
    rents.set(key, x);
  }
  const zero = { revenue: 0, fuel: 0, toll: 0, driver: 0, maint: 0, taxes: 0, other: 0 };
  const fixed1 = { "604700": 8.5e6, "605100": 4.2e6, "605200": 23e6, "605300": 18e6, "614000": 11e6, "622200": 32e6, "624100": 21e6, "625200": 98e6, "627000": 6e6, "628100": 19e6, "632400": 34e6, "637000": 44e6, "641000": 22e6, "674000": 5e6 };
  const totals2026 = {};
  const sums = { revenue: 0, fuel: 0, toll: 0, driver: 0, maint: 0, taxes: 0, other: 0, btp: 0 };
  for (const key of monthKeys("2026-01-01", TODAY)) {
    const f = key === current ? PARTIAL : 1;
    const o = ops.get(key) || zero;
    const b = btp.get(key) || 0;
    const rr = rents.get(key) || { rent: 0, charges: 0 };
    putPL(1, key, "706100", -o.revenue);
    putPL(1, key, "705100", -b);
    putPL(1, key, "706300", -rr.rent);
    putPL(1, key, "707100", -(rr.charges + 0.006 * o.revenue));
    putPL(1, key, "758000", -r.int(2, 9) * 1e6 * f);
    putPL(1, key, "776000", -r.int(1, 6) * 1e6 * f);
    putPL(1, key, "604200", o.fuel * 1.05 + 25e6 * f);
    putPL(1, key, "604400", o.maint * 0.45);
    putPL(1, key, "624200", o.maint * 0.36 + (key === "2026-08" ? 320e6 : 0));
    putPL(1, key, "618100", o.toll + 9e6 * f * r.noise(0.2));
    putPL(1, key, "663000", o.driver + 14e6 * f);
    putPL(1, key, "645000", o.taxes + 12e6 * f);
    putPL(1, key, "658000", o.other * 0.4 + 6e6 * f);
    putPL(1, key, "604500", b * 0.58 * r.noise(0.08));
    putPL(1, key, "622300", b * 0.06);
    for (const [code, base] of Object.entries(fixed1)) putPL(1, key, code, base * f * r.noise(0.06));
    if (key === "2026-02") putPL(1, key, "641000", 95e6);
    if (key === "2026-03") putPL(1, key, "632400", 140e6);
    putPL(1, key, "633000", key.endsWith("3") || key.endsWith("9") ? 12e6 : 0);
    const salaries = 520e6 * f;
    putPL(1, key, "661100", salaries);
    putPL(1, key, "664100", salaries * 0.18);
    putPL(1, key, "631100", 0.0035 * (o.revenue + b + rr.rent));
    if (key !== current) {
      totals2026[+key.slice(5, 7)] = o.revenue + b + rr.rent + rr.charges;
      for (const k of Object.keys(zero)) sums[k] += o[k];
      sums.btp += b;
    }
  }
  putPL(1, "2026-08", "691000", 180e6);
  putPL(1, "2026-05", "812000", 210e6);
  putPL(1, "2026-05", "822000", -340e6);

  // Société 1 : historique 2024 et 2025, au rythme de 2026.
  const months2026 = Object.values(totals2026);
  const avg = sum(months2026) / months2026.length;
  const ratio = (k) => (sums.revenue ? sums[k] / sums.revenue : 0);
  for (const key of monthKeys("2024-01-01", "2025-12-31")) {
    const y = +key.slice(0, 4);
    const m = +key.slice(5, 7);
    const base = m <= 9 ? totals2026[m] : avg * [1.04, 1.07, 1.12][m - 10];
    const total = base * (y === 2025 ? 0.93 : 0.85) * r.noise(0.04);
    const transport = total * 0.64;
    const works = total * 0.24;
    const scale = y === 2025 ? 0.95 : 0.9;
    putPL(1, key, "706100", -transport);
    putPL(1, key, "705100", -works);
    putPL(1, key, "706300", -total * 0.09);
    putPL(1, key, "707100", -total * 0.03);
    putPL(1, key, "758000", -r.int(2, 9) * 1e6);
    putPL(1, key, "776000", -r.int(1, 6) * 1e6);
    putPL(1, key, "604200", transport * ratio("fuel") * 1.05 * r.noise(0.04) + 24e6);
    putPL(1, key, "604400", transport * ratio("maint") * 0.45 * r.noise(0.08));
    putPL(1, key, "624200", transport * ratio("maint") * 0.36 * r.noise(0.1));
    putPL(1, key, "618100", transport * ratio("toll") + 8e6);
    putPL(1, key, "663000", transport * ratio("driver") + 13e6);
    putPL(1, key, "645000", transport * ratio("taxes") + 11e6);
    putPL(1, key, "658000", transport * ratio("other") * 0.4 + 6e6);
    putPL(1, key, "604500", works * 0.58 * r.noise(0.08));
    putPL(1, key, "622300", works * 0.06);
    for (const [code, v] of Object.entries(fixed1)) putPL(1, key, code, v * scale * r.noise(0.06));
    if (m === 2) putPL(1, key, "641000", 88e6 * scale);
    if (m === 3) putPL(1, key, "632400", 130e6 * scale);
    const salaries = 520e6 * (y === 2025 ? 0.94 : 0.88) * (m === 12 ? 2 : 1);
    putPL(1, key, "661100", salaries);
    putPL(1, key, "664100", salaries * 0.18);
    putPL(1, key, "631100", 0.0035 * total);
  }
  putPL(1, "2025-12", "691000", 95e6);

  // Société 2 : cabinet de conseil, environ vingt fois plus petit.
  const c2 = {
    2024: [139, 176, 218, 183, 205, 229, 147, 92, 199, 221, 243, 262],
    2025: [162, 205, 251, 214, 238, 266, 171, 105, 233, 259, 281, 304],
    2026: [186, 241, 312, 198, 265, 289, 154, 98, 276, 118],
  };
  for (const key of keys) {
    const y = +key.slice(0, 4);
    const m = +key.slice(5, 7);
    const f = key === current ? PARTIAL : 1;
    const revenue = c2[y][m - 1] * 1e6 * (y === 2026 ? 1 : r.noise(0.03));
    const scale = y === 2026 ? 1 : y === 2025 ? 0.94 : 0.88;
    putPL(2, key, "706400", -revenue * 0.85);
    putPL(2, key, "706500", -revenue * 0.15);
    putPL(2, key, "758000", -r.int(0, 2) * 1e6 * f);
    putPL(2, key, "604700", 2.4e6 * f * r.noise(0.1));
    putPL(2, key, "605200", 3.6e6 * f * r.noise(0.1));
    putPL(2, key, "618100", revenue * 0.055 * r.noise(0.15));
    putPL(2, key, "622200", 14e6 * f);
    putPL(2, key, "628100", 2.7e6 * f * r.noise(0.08));
    putPL(2, key, "631100", revenue * 0.005);
    putPL(2, key, "632400", revenue * 0.09 * r.noise(0.2));
    putPL(2, key, "633000", m % 2 ? 1.5e6 * f : 0);
    putPL(2, key, "641000", revenue * 0.011);
    const salaries = 82e6 * scale * f * (m === 12 ? 2 : 1);
    putPL(2, key, "661100", salaries);
    putPL(2, key, "664100", salaries * 0.18);
  }

  // Impôt sur les bénéfices : 25 % du résultat mensuel positif ; arrondi au franc.
  for (const cid of COMPANY_IDS) {
    for (const key of keys) {
      const amounts = PL[cid].get(key) || {};
      const before = -Object.values(amounts).reduce((s, v) => s + v, 0);
      if (before > 0) putPL(cid, key, "891000", before * 0.25);
      const rounded = {};
      for (const [code, v] of Object.entries(PL[cid].get(key) || {})) if (Math.round(v)) rounded[code] = Math.round(v);
      PL[cid].set(key, rounded);
    }
  }
  YEAR_RESULT.clear();
}

/* ─── États SYSCOHADA révisé (eguitra_finance.models.syscohada) ───────────── */

const CR_LINES = [
  ["TA", "Ventes de marchandises", ["701"], [], "all"],
  ["RA", "Achats de marchandises", ["601"], [], "all"],
  ["RB", "Variation de stocks de marchandises", ["6031"], [], "all"],
  ["TB", "Ventes de produits fabriqués", ["702", "703", "704"], [], "all"],
  ["TC", "Travaux, services vendus", ["705", "706"], [], "all"],
  ["TD", "Produits accessoires", ["707"], [], "all"],
  ["TE", "Production stockée (ou déstockage)", ["73"], [], "all"],
  ["TF", "Production immobilisée", ["72"], [], "all"],
  ["TG", "Subventions d'exploitation", ["71"], [], "all"],
  ["TH", "Autres produits", ["75"], [], "all"],
  ["TI", "Transferts de charges d'exploitation", ["781"], [], "all"],
  ["RC", "Achats de matières premières et fournitures liées", ["602"], [], "all"],
  ["RD", "Variation de stocks de matières premières", ["6032"], [], "all"],
  ["RE", "Autres achats", ["604", "605", "606", "607", "608", "609"], [], "all"],
  ["RF", "Variation de stocks d'autres approvisionnements", ["6033"], [], "all"],
  ["RG", "Transports", ["61"], [], "all"],
  ["RH", "Services extérieurs", ["62", "63"], [], "all"],
  ["RI", "Impôts et taxes", ["64"], [], "all"],
  ["RJ", "Autres charges", ["65"], [], "all"],
  ["RK", "Charges de personnel", ["66"], [], "all"],
  ["TJ", "Reprises d'amortissements, provisions et dépréciations", ["791", "798", "799"], [], "all"],
  ["RL", "Dotations aux amortissements, provisions et dépréciations", ["681", "691"], [], "all"],
  ["TK", "Revenus financiers et assimilés", ["77"], [], "all"],
  ["TL", "Reprises de provisions et dépréciations financières", ["797"], [], "all"],
  ["TM", "Transferts de charges financières", ["787"], [], "all"],
  ["RM", "Frais financiers et charges assimilées", ["67"], [], "all"],
  ["RN", "Dotations aux provisions et dépréciations financières", ["687", "697"], [], "all"],
  ["TN", "Produits des cessions d'immobilisations", ["82"], [], "all"],
  ["TO", "Autres produits HAO", ["84", "86", "88"], [], "all"],
  ["RO", "Valeurs comptables des cessions d'immobilisations", ["81"], [], "all"],
  ["RP", "Autres charges HAO", ["83", "85"], [], "all"],
  ["RQ", "Participation des travailleurs", ["87"], [], "all"],
  ["RS", "Impôts sur le résultat", ["89"], [], "all"],
];
const CR_TOTALS = [
  ["XA", "Marge commerciale", [["TA", 1], ["RA", -1], ["RB", -1]]],
  ["XB", "Chiffre d'affaires", [["TA", 1], ["TB", 1], ["TC", 1], ["TD", 1]]],
  ["XC", "Valeur ajoutée", [["XA", 1], ["TB", 1], ["TC", 1], ["TD", 1], ["TE", 1], ["TF", 1], ["TG", 1], ["TH", 1], ["TI", 1], ["RC", -1], ["RD", -1], ["RE", -1], ["RF", -1], ["RG", -1], ["RH", -1], ["RI", -1], ["RJ", -1]]],
  ["XD", "Excédent brut d'exploitation", [["XC", 1], ["RK", -1]]],
  ["XE", "Résultat d'exploitation", [["XD", 1], ["TJ", 1], ["RL", -1]]],
  ["XF", "Résultat financier", [["TK", 1], ["TL", 1], ["TM", 1], ["RM", -1], ["RN", -1]]],
  ["XG", "Résultat des activités ordinaires", [["XE", 1], ["XF", 1]]],
  ["XH", "Résultat hors activités ordinaires", [["TN", 1], ["TO", 1], ["RO", -1], ["RP", -1]]],
  ["XI", "Résultat net", [["XG", 1], ["XH", 1], ["RQ", -1], ["RS", -1]]],
];
const CR_ORDER = ["TA", "RA", "RB", "XA", "TB", "TC", "TD", "XB", "TE", "TF", "TG", "TH", "TI", "RC", "RD", "RE", "RF", "RG", "RH", "RI", "RJ", "XC", "RK", "XD", "TJ", "RL", "XE", "TK", "TL", "TM", "RM", "RN", "XF", "XG", "TN", "TO", "RO", "RP", "XH", "RQ", "RS", "XI"];
const BILAN_ACTIF = [
  ["AD", "Immobilisations incorporelles", ["21", "281", "291"], [], "all"],
  ["AI", "Immobilisations corporelles", ["22", "23", "24", "282", "283", "284", "292", "293", "294"], [], "all"],
  ["AP", "Avances et acomptes versés sur immobilisations", ["25"], [], "all"],
  ["AQ", "Immobilisations financières", ["26", "27", "296", "297"], [], "all"],
  ["BA", "Actif circulant HAO", ["485", "488", "498"], [], "all"],
  ["BB", "Stocks et encours", ["3"], [], "all"],
  ["BH", "Fournisseurs, avances versées", ["409"], [], "all"],
  ["BI", "Clients", ["41"], ["419"], "debit", ["491"]],
  ["BJ", "Autres créances", ["42", "43", "44", "45", "46", "47", "185"], ["478", "479"], "debit", ["492", "493", "494", "495", "496", "497"]],
  ["BQ", "Titres de placement", ["50", "590"], [], "all"],
  ["BR", "Valeurs à encaisser", ["51"], [], "all"],
  ["BS", "Banques, chèques postaux, caisse et assimilés", ["52", "53", "54", "55", "57", "58"], [], "debit"],
  ["BU", "Écart de conversion actif", ["478"], [], "all"],
];
const BILAN_ACTIF_TOTALS = [
  ["AZ", "Total actif immobilisé", [["AD", 1], ["AI", 1], ["AP", 1], ["AQ", 1]]],
  ["BG", "Créances et emplois assimilés", [["BH", 1], ["BI", 1], ["BJ", 1]]],
  ["BK", "Total actif circulant", [["BA", 1], ["BB", 1], ["BG", 1]]],
  ["BT", "Total trésorerie actif", [["BQ", 1], ["BR", 1], ["BS", 1]]],
  ["BZ", "Total général actif", [["AZ", 1], ["BK", 1], ["BT", 1], ["BU", 1]]],
];
const BILAN_ACTIF_ORDER = ["AD", "AI", "AP", "AQ", "AZ", "BA", "BB", "BH", "BI", "BJ", "BG", "BK", "BQ", "BR", "BS", "BT", "BU", "BZ"];
const BILAN_PASSIF = [
  ["CA", "Capital", ["101", "102", "103", "104"], [], "all"],
  ["CB", "Apporteurs, capital non appelé", ["109"], [], "all"],
  ["CD", "Primes liées au capital social", ["105"], [], "all"],
  ["CE", "Écarts de réévaluation", ["106"], [], "all"],
  ["CF", "Réserves indisponibles", ["111", "112"], [], "all"],
  ["CG", "Réserves libres", ["113", "118"], [], "all"],
  ["CH", "Report à nouveau", ["12"], [], "all"],
  ["CJ", "Résultat net de l'exercice", ["13"], [], "all"],
  ["CL", "Subventions d'investissement", ["14"], [], "all"],
  ["CM", "Provisions réglementées", ["15"], [], "all"],
  ["DA", "Emprunts et dettes financières diverses", ["16", "181", "182", "183", "184"], [], "all"],
  ["DB", "Dettes de location-acquisition", ["17"], [], "all"],
  ["DC", "Provisions pour risques et charges", ["19"], [], "all"],
  ["DH", "Dettes circulantes HAO", ["481", "482", "484"], [], "all"],
  ["DI", "Clients, avances reçues", ["419"], [], "all"],
  ["DJ", "Fournisseurs d'exploitation", ["40"], ["409"], "credit"],
  ["DK", "Dettes fiscales et sociales", ["42", "43", "44"], [], "credit"],
  ["DM", "Autres dettes", ["41", "45", "46", "47", "185"], ["419", "478", "479"], "credit"],
  ["DN", "Provisions pour risques à court terme", ["499"], [], "all"],
  ["DQ", "Banques, crédits d'escompte", ["565"], [], "all"],
  ["DR", "Banques, crédits de trésorerie", ["52", "53", "54", "55", "56", "57", "58"], ["565"], "credit"],
  ["DV", "Écart de conversion passif", ["479"], [], "all"],
];
const BILAN_PASSIF_TOTALS = [
  ["CP", "Total capitaux propres et ressources assimilées", [["CA", 1], ["CB", 1], ["CD", 1], ["CE", 1], ["CF", 1], ["CG", 1], ["CH", 1], ["CJ", 1], ["CL", 1], ["CM", 1]]],
  ["DD", "Total dettes financières et ressources assimilées", [["DA", 1], ["DB", 1], ["DC", 1]]],
  ["DF", "Total ressources stables", [["CP", 1], ["DD", 1]]],
  ["DP", "Total passif circulant", [["DH", 1], ["DI", 1], ["DJ", 1], ["DK", 1], ["DM", 1], ["DN", 1]]],
  ["DT", "Total trésorerie passif", [["DQ", 1], ["DR", 1]]],
  ["DZ", "Total général passif", [["DF", 1], ["DP", 1], ["DT", 1], ["DV", 1]]],
];
const BILAN_PASSIF_ORDER = ["CA", "CB", "CD", "CE", "CF", "CG", "CH", "CJ", "CL", "CM", "CP", "DA", "DB", "DC", "DD", "DF", "DH", "DI", "DJ", "DK", "DM", "DN", "DP", "DQ", "DR", "DT", "DV", "DZ"];
const TFT_ROWS = [
  ["ZA", "Trésorerie nette au début de la période", true],
  ["FA", "Capacité d'autofinancement globale (CAFG)", false],
  ["FB", "Actif circulant HAO (variation)", false],
  ["FC", "Variation des stocks", false],
  ["FD", "Variation des créances", false],
  ["FE", "Variation du passif circulant", false],
  ["ZB", "Flux de trésorerie provenant des activités opérationnelles", true],
  ["FF", "Décaissements liés aux acquisitions d'immobilisations incorporelles", false],
  ["FG", "Décaissements liés aux acquisitions d'immobilisations corporelles", false],
  ["FH", "Décaissements liés aux acquisitions d'immobilisations financières", false],
  ["FI", "Encaissements liés aux cessions d'immobilisations incorporelles et corporelles", false],
  ["FJ", "Encaissements liés aux cessions d'immobilisations financières", false],
  ["ZC", "Flux de trésorerie provenant des activités d'investissement", true],
  ["FK", "Augmentations de capital par apports nouveaux", false],
  ["FL", "Subventions d'investissement reçues", false],
  ["FM", "Prélèvements sur le capital", false],
  ["FN", "Dividendes versés", false],
  ["ZD", "Flux provenant des capitaux propres", true],
  ["FO", "Emprunts", false],
  ["FP", "Autres dettes financières", false],
  ["FQ", "Remboursements des emprunts et autres dettes financières", false],
  ["ZE", "Flux provenant des capitaux étrangers", true],
  ["ZF", "Flux de trésorerie provenant des activités de financement", true],
  ["ZG", "Variation de la trésorerie nette de la période", true],
  ["ZH", "Trésorerie nette à la fin de la période", true],
];

function computeLines(balances, lines, signFn) {
  const values = {};
  const used = new Set();
  for (const [code, , include, exclude, mode, always = []] of lines) {
    let total = 0;
    for (const [account, balance] of Object.entries(balances)) {
      if (always.some((p) => account.startsWith(p))) {
        total += balance;
        used.add(account);
        continue;
      }
      if (exclude.some((p) => account.startsWith(p)) || !include.some((p) => account.startsWith(p))) continue;
      if (mode === "debit" && balance <= 0) continue;
      if (mode === "credit" && balance >= 0) continue;
      total += balance;
      used.add(account);
    }
    values[code] = signFn(code) * total;
  }
  return [values, used];
}
function applyTotals(values, totals) {
  for (const [code, , formula] of totals) values[code] = formula.reduce((s, [c, k]) => s + (values[c] || 0) * k, 0);
  return values;
}
function statementRows(values, order, lines, totals) {
  const labels = Object.fromEntries([...lines.map((l) => [l[0], l[1]]), ...totals.map((t) => [t[0], t[1]])]);
  const totalCodes = new Set(totals.map((t) => t[0]));
  return order.map((c) => ({ code: c, label: labels[c], amount: round(values[c] || 0), total: totalCodes.has(c) }));
}
const signPL = (code) => (code.startsWith("T") ? -1 : 1);

function incomeStatement(cids, from, to) {
  const balances = plRange(cids, from, to);
  const [values, used] = computeLines(balances, CR_LINES, signPL);
  applyTotals(values, CR_TOTALS);
  const unmapped = {};
  for (const [a, b] of Object.entries(balances)) if ("678".includes(a[0]) && !used.has(a) && Math.abs(b) > 0.5) unmapped[a] = round(b);
  return {
    date_from: from, date_to: to,
    lines: statementRows(values, CR_ORDER, CR_LINES, CR_TOTALS),
    totals: Object.fromEntries(CR_TOTALS.map(([c]) => [c, round(values[c] || 0)])),
    unmapped_accounts: unmapped,
  };
}
function positions(balances) {
  const [actif, usedA] = computeLines(balances, BILAN_ACTIF, () => 1);
  applyTotals(actif, BILAN_ACTIF_TOTALS);
  const [passif, usedP] = computeLines(balances, BILAN_PASSIF, () => -1);
  return { actif, passif, used: new Set([...usedA, ...usedP]) };
}
function balanceSheet(cids, d) {
  const balances = sumBalances(cids, d);
  const result = -Object.entries(balances).reduce((s, [a, b]) => ("678".includes(a[0]) ? s + b : s), 0);
  const { actif, passif, used } = positions(balances);
  passif.CJ = (passif.CJ || 0) + result;
  applyTotals(passif, BILAN_PASSIF_TOTALS);
  const unmapped = {};
  for (const [a, b] of Object.entries(balances)) if ("12345".includes(a[0]) && !used.has(a) && Math.abs(b) > 0.5) unmapped[a] = round(b);
  const difference = Math.round(actif.BZ - passif.DZ) || 0;
  return {
    date_to: d,
    actif: statementRows(actif, BILAN_ACTIF_ORDER, BILAN_ACTIF, BILAN_ACTIF_TOTALS),
    passif: statementRows(passif, BILAN_PASSIF_ORDER, BILAN_PASSIF, BILAN_PASSIF_TOTALS),
    total_actif: round(actif.BZ), total_passif: round(passif.DZ), difference, unmapped_accounts: unmapped,
  };
}
/** Flux d'investissement et de financement d'une période. */
function periodFlows(cids, from, to) {
  const end = minDate(to, TODAY);
  const out = { intangible: 0, tangible: 0, proceeds: 0, dividends: 0, newLoans: 0, newLeases: 0, repayments: 0 };
  for (const cid of cids) {
    for (const c of BS[cid].capex) {
      if (c.date < from || c.date > end) continue;
      if (c.code.startsWith("21")) out.intangible += c.amount;
      else out.tangible += c.amount;
    }
    out.dividends += sum(BS[cid].dividends.filter((x) => x.date >= from && x.date <= end), (x) => x.amount);
  }
  out.proceeds = -sumPrefix(plRange(cids, from, end), ["82"]);
  for (const loan of DB.loans) {
    if (!cids.includes(loan.company_id) || loan.state === "draft") continue;
    if (loan.start_date >= from && loan.start_date <= end) out[loan.kind === "lease" ? "newLeases" : "newLoans"] += loan.principal;
    out.repayments += sum(loan.lines.filter((l) => l.paid && l.due_date >= from && l.due_date <= end), (l) => l.principal);
  }
  return out;
}
function cashFlow(cids, from, to) {
  const a = positions(sumBalances(cids, addDays(from, -1)));
  const b = positions(sumBalances(cids, to));
  applyTotals(a.passif, BILAN_PASSIF_TOTALS);
  applyTotals(b.passif, BILAN_PASSIF_TOTALS);
  const [res] = computeLines(plRange(cids, from, to), CR_LINES, signPL);
  applyTotals(res, CR_TOTALS);
  const flows = periodFlows(cids, from, to);
  const v = {
    ZA: a.actif.BT - a.passif.DT,
    FA: res.XI + res.RL + res.RN - res.TJ - res.TL - res.TN + res.RO,
    FB: -(b.actif.BA - a.actif.BA),
    FC: -(b.actif.BB - a.actif.BB),
    FD: -(b.actif.BG - a.actif.BG),
    FE: b.passif.DP - a.passif.DP,
    FF: -flows.intangible, FG: -flows.tangible, FH: 0, FI: flows.proceeds, FJ: 0,
    FK: 0, FL: 0, FM: 0, FN: -flows.dividends,
    FO: flows.newLoans, FP: flows.newLeases, FQ: -flows.repayments,
  };
  const totalsOf = () => {
    v.ZB = v.FA + v.FB + v.FC + v.FD + v.FE;
    v.ZC = v.FF + v.FG + v.FH + v.FI + v.FJ;
    v.ZD = v.FK + v.FL + v.FM + v.FN;
    v.ZE = v.FO + v.FP + v.FQ;
    v.ZF = v.ZD + v.ZE;
    v.ZG = v.ZB + v.ZC + v.ZF;
    v.ZH = v.ZG + v.ZA;
  };
  totalsOf();
  const treasuryEnd = b.actif.BT - b.passif.DT;
  // Écart d'arrondi résiduel des proratas : rattaché au passif circulant.
  if (Math.abs(treasuryEnd - v.ZH) < 5e6) {
    v.FE += treasuryEnd - v.ZH;
    totalsOf();
  }
  return {
    date_from: from, date_to: to,
    lines: TFT_ROWS.map(([code, label, total]) => ({ code, label, amount: round(v[code]), total })),
    treasury_end: round(treasuryEnd),
    difference: Math.round(treasuryEnd - v.ZH) || 0,
  };
}

/* ─── Indicateurs du dirigeant (eguitra_finance.models.finance_metrics) ───── */

const revenue = (cids, from, to) => round(revenueBetween(cids, from, to));
// Arrondis au franc par société, en cumul pour les journaux : cash_by_journal + cash_other = cash au franc près.
const cashAt = (cids, d) => sum(cids, (cid) => round(classFive(balancesAt(cid, d))));
function cashByJournal(cids, d) {
  const rows = [];
  for (const cid of cids) {
    const balances = balancesAt(cid, d);
    let exact = 0;
    let shown = 0;
    for (const j of cashJournals(cid)) {
      exact += balances[j.account] || 0;
      const balance = round(exact) - shown;
      shown += balance;
      const foreign = j.currency && j.currency !== "GNF";
      rows.push({
        journal_id: j.id, name: j.name, type: j.type, company: COMPANIES[cid].name, currency: j.currency || "GNF",
        balance, balance_currency: foreign ? Math.round((balance / usdRate()) * 100) / 100 : balance,
      });
    }
  }
  return rows;
}
/** Comptes de la classe 5 hors journaux de banque et de caisse, à solde non nul (noyau : pilotage.cash_other). */
function cashOther(cids, d) {
  const rows = [];
  for (const cid of cids) {
    const journals = new Set(cashJournals(cid).map((j) => j.account));
    for (const [code, balance] of Object.entries(balancesAt(cid, d))) {
      if (!code.startsWith("5") || journals.has(code) || Math.abs(balance) < 0.5) continue;
      rows.push({ account_id: ACCOUNT_BY_CODE.get(code)?.id ?? null, code, name: accountName(code), company: COMPANIES[cid].name, balance: round(balance) });
    }
  }
  return rows.sort((a, b) => (a.company === b.company ? (a.code < b.code ? -1 : 1) : a.company < b.company ? -1 : 1));
}
/** Mois de la fenêtre commune des séries et des flux : du début de l'exercice au mois de l'arrêté. */
const windowMonths = (fyStart, day) => Math.max((+day.slice(0, 4) - +fyStart.slice(0, 4)) * 12 + +day.slice(5, 7) - +fyStart.slice(5, 7) + 1, 1);
function monthlySeries(cids, months, day, prefixes, sign = -1) {
  const start = addMonths(monthStart(day), -(months - 1));
  return Array.from({ length: months }, (_, i) => {
    const s = addMonths(start, i);
    const amount = sumPrefix(plRange(cids, s, minDate(monthEnd(s), day)), prefixes);
    return { month: s.slice(0, 7), amount: round(sign * amount) || 0 };
  });
}
function debtSummary(cids, day) {
  const loans = DB.loans.filter((l) => cids.includes(l.company_id) && (l.state === "active" || l.state === "closed"));
  const lines = loans.flatMap((l) => l.lines);
  const unpaid = lines.filter((l) => !l.paid);
  const next = unpaid.filter((l) => l.due_date >= day).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const yearAgo = addMonths(day, -12);
  const yearAhead = addMonths(day, 12);
  return {
    loans: loans.filter((l) => l.lines.length).length,
    outstanding: round(sum(unpaid, (l) => l.principal)),
    overdue: round(sum(unpaid.filter((l) => l.due_date < day), (l) => l.total)),
    next_due_date: next?.due_date ?? null,
    next_due_amount: next ? round(next.total) : 0,
    service_last_12m: round(sum(lines.filter((l) => l.due_date > yearAgo && l.due_date <= day), (l) => l.total)),
    service_next_12m: round(sum(lines.filter((l) => l.due_date > day && l.due_date <= yearAhead), (l) => l.total)),
  };
}

/** Rentabilité du transport par ensemble, route, chauffeur, client ou mois. */
function profitability(cids, from, to, group = "vehicle") {
  const rots = DB.rotations.filter((r) => cids.includes(r.company_id) && (r.state === "done" || r.state === "invoiced") && r.date_loading >= from && r.date_loading <= to);
  const keyFns = { vehicle: (r) => r.vehicle_id, route: (r) => r.route_id, driver: (r) => r.driver_id, client: (r) => r.partner_id, month: (r) => r.date_loading.slice(0, 7) };
  const mode = keyFns[group] ? group : "vehicle";
  const labelOf = {
    vehicle: (k) => DB.vehicles.find((v) => v.id === k)?.name,
    route: (k) => DB.routes.find((v) => v.id === k)?.name,
    driver: (k) => DB.drivers.find((v) => v.id === k)?.name,
    client: (k) => partnerName(k),
    month: (k) => k,
  }[mode];
  const rows = [];
  for (const [key, list] of groupBy(rots, keyFns[mode])) {
    const delivered = sum(list, (r) => r.volume_delivered);
    const loaded = sum(list, (r) => r.volume_loaded);
    const rev = sum(list, (r) => r.revenue);
    const cost = sum(list, (r) => r.total_cost);
    const margin = sum(list, (r) => r.margin);
    rows.push({
      key: key ?? null, label: (key !== null && labelOf(key)) || "Non renseigné", rotations: list.length,
      volume: round3(delivered || loaded), revenue: rev, cost, margin, shortage: round3(sum(list, (r) => r.shortage)),
      margin_rate: rev ? (margin / rev) * 100 : null, standard_cost: sum(list, (r) => standardOf(r).std_cost),
      costs: Object.fromEntries(COSTS.map(([c]) => [c, sum(list, (r) => r[c])])),
    });
  }
  return rows.sort(mode === "month" ? (a, b) => a.label.localeCompare(b.label) : (a, b) => (b.revenue || 0) - (a.revenue || 0));
}

/** Produits, charges et marge par compte analytique d'un axe. */
function analyticRows(cid, plan, from, to) {
  const pl = plRange([cid], from, to);
  const inc = (code) => -(pl[code] || 0);
  const exp = (code) => pl[code] || 0;
  const total6 = sumPrefix(pl, ["6"]);
  const sal = exp("661100") + exp("664100");
  const acc = (name) => DB.analytic.find((a) => a.company_id === cid && a.plan === plan && a.name === name);
  const row = (name, income, expense) => {
    const a = acc(name);
    return a ? { id: a.id, name: a.name, income, expense } : null;
  };
  const rows = [];
  if (plan === "activite" && cid === 1) {
    const transport = exp("604200") + exp("604400") + exp("624200") + exp("618100") + exp("663000") + exp("645000") + exp("625200") + exp("622200") + 0.5 * exp("658000") + 0.46 * sal + 0.66 * exp("681300") + 0.7 * (exp("671200") + exp("672000"));
    const works = exp("604500") + exp("622300") + 0.24 * sal + 0.12 * exp("681300") + 0.3 * exp("671200");
    const estate = exp("624100") + 0.5 * exp("641000") + 0.06 * sal + 0.15 * exp("681300");
    rows.push(row("Transport pétrolier", inc("706100") + 0.4 * inc("707100"), transport));
    rows.push(row("BTP et travaux", inc("705100"), works));
    rows.push(row("Immobilier locatif", inc("706300") + 0.6 * inc("707100"), estate));
    rows.push(row("Siège et services communs", 0, total6 - transport - works - estate));
  } else if (plan === "activite" && cid === 2) {
    const advice = 0.62 * sal + exp("618100") + exp("632400");
    const training = 0.13 * sal + 0.2 * exp("622200");
    rows.push(row("Conseil en bancabilité", inc("706400"), advice));
    rows.push(row("Formation et accompagnement", inc("706500"), training));
    rows.push(row("Structure du cabinet", 0, total6 - advice - training));
  } else if (plan === "centre_cout" && cid === 1) {
    rows.push(row("Direction générale", 0, exp("627000") + exp("632400") + 0.08 * sal + 0.4 * exp("614000")));
    rows.push(row("Direction financière", 0, exp("631100") + exp("671200") + exp("672000") + exp("674000") + 0.1 * sal + exp("691000")));
    rows.push(row("Exploitation transport", 0, exp("604200") + exp("618100") + exp("663000") + exp("645000") + exp("625200") + 0.45 * sal));
    rows.push(row("Atelier et maintenance", 0, exp("604400") + exp("624200") + 0.12 * sal));
    rows.push(row("Parc de Matoto", 0, exp("622200") + exp("605300") + 0.5 * exp("637000") + 0.05 * sal));
  } else if (plan === "centre_cout" && cid === 2) {
    rows.push(row("Cabinet", 0, total6 - exp("618100")));
    rows.push(row("Missions sur le terrain", 0, exp("618100")));
  } else if (plan === "chantier") {
    for (const ch of DB.chantiers.filter((c) => c.company_id === cid)) {
      const income = sum(situationsOf(ch).filter((s) => s.state === "invoiced" && s.date >= from && s.date <= to), (s) => situationAmounts(s).amount_period);
      const invoiced = chantierTotals(ch).invoiced_amount;
      const expense = invoiced > 0 ? ch.costs * (income / invoiced) : to >= "2026-09-01" && from <= TODAY ? ch.costs : 0;
      if (income || expense) rows.push(row(ch.name, income, expense));
    }
  } else if (plan === "vehicule" || plan === "route") {
    for (const p of profitability([cid], from, to, plan === "vehicule" ? "vehicle" : "route")) rows.push(row(p.label, p.revenue, p.cost));
  } else if (plan === "bien") {
    const months = Math.max(0, monthKeys(maxDate(from, "2026-01-01"), minDate(to, TODAY)).length);
    for (const prop of DB.properties.filter((p) => p.company_id === cid)) {
      const income = sum(rentPeriods().filter((p) => p.lease.property_id === prop.id && p.date >= from && p.date <= to), (p) => p.lease.rent + p.lease.charges);
      rows.push(row(prop.name, income, income * 0.08 + 1.2e6 * months));
    }
  } else if (plan === "dossier") {
    for (const d of DB.dossiers.filter((x) => x.company_id === cid)) {
      const income = sum(DB.moves.filter((m) => m.dossier_id === d.id && m.state === "posted" && m.move_type === "out_invoice" && m.invoice_date >= from && m.invoice_date <= to), (m) => m.amount_untaxed);
      const hours = sum(DB.timesheets.filter((t) => t.dossier_id === d.id && t.date >= from && t.date <= to), (t) => t.hours);
      if (income || hours) rows.push(row(`${d.reference} ${d.name}`, income, hours * 350000));
    }
  }
  return rows.filter(Boolean);
}
function byAnalyticPlan(cids, plan, from, to) {
  return cids
    .flatMap((cid) => analyticRows(cid, plan, from, to))
    .map(({ id, name, income, expense }) => ({
      analytic_account_id: id, name, income: round(income), expense: round(expense), margin: round(income - expense),
      margin_rate: income ? ((income - expense) / income) * 100 : null,
    }))
    .sort((a, b) => b.income - a.income);
}

/* ─── Alertes (eguitra_finance.models.alert et extensions des modules) ───── */

function companyAlerts(cid, day) {
  const th = Object.fromEntries(DB.thresholds.filter((t) => t.company_id === cid && t.active).map((t) => [t.code, t]));
  const alerts = [];
  const make = (t, title, message, value = null, link = null) => ({
    code: t.code, severity: t.severity, title, message, value: value === null ? null : round(value), threshold: t.value, link, company: COMPANIES[cid].name,
  });
  let t = th.cash_min;
  if (t && t.value) {
    const c = cashAt([cid], day);
    if (c < t.value) alerts.push(make(t, "Trésorerie sous le seuil", "La trésorerie nette est inférieure au seuil fixé.", c, "/finance/tresorerie"));
  }
  t = th.receivable_overdue_days;
  if (t && t.value) {
    const limit = addDays(day, -Math.trunc(t.value));
    const items = openInvoices([cid], "receivable").filter((m) => m.invoice_date_due && m.invoice_date_due < limit);
    if (items.length) alerts.push(make(t, "Créances anciennes", `${items.length} facture(s) échue(s) depuis plus de ${Math.trunc(t.value)} jours.`, sum(items, signedResidual), "/finance/tiers"));
  }
  t = th.receivable_overdue_amount;
  if (t && t.value) {
    const overdue = openItems([cid], "receivable", day).overdue;
    if (overdue > t.value) alerts.push(make(t, "Encours échu élevé", "L'encours clients échu dépasse le seuil fixé.", overdue, "/finance/tiers"));
  }
  t = th.transit_account;
  if (t) {
    const balance = transitAt(cid, day);
    if (Math.abs(balance) > 0.5) alerts.push(make(t, "Compte de passage non soldé", "Un virement interne n'a pas été réceptionné (compte 585).", balance, "/finance/tresorerie"));
  }
  t = th.close_delay_days;
  if (t && t.value) {
    const lastEnd = addDays(monthStart(day), -1);
    const closed = closingRecord(cid, monthStart(lastEnd))?.state === "closed";
    const hasEntries = DB.moves.some((m) => m.company_id === cid && m.state === "posted" && m.date <= lastEnd);
    if (hasEntries && !closed && daysBetween(lastEnd, day) > t.value) {
      alerts.push(make(t, "Clôture en retard", `Le mois de ${lastEnd.slice(5, 7)}/${lastEnd.slice(0, 4)} n'est pas clôturé.`, null, "/finance/clotures"));
    }
  }
  t = th.transport_margin_min;
  if (t && t.value) {
    const weak = profitability([cid], addDays(day, -30), day, "vehicle").filter((r) => r.margin_rate !== null && r.margin_rate < t.value);
    if (weak.length) {
      alerts.push(make(t, "Marge transport sous le seuil", `${weak.length} ensemble(s) sous ${Math.round(t.value)} % de marge sur 30 jours : ${weak.slice(0, 5).map((r) => r.label).join(", ")}.`, null, "/transport/rentabilite"));
    }
  }
  t = th.approval_delay_days;
  if (t && t.value) {
    const limit = `${new Date(Date.parse(NOW_REF) - t.value * DAY_MS).toISOString().slice(0, 19)}Z`;
    const late = DB.approvals.filter((a) => a.company_id === cid && a.state === "pending" && a.requested_at < limit).length;
    if (late) alerts.push(make(t, "Validations en retard", `${late} demande(s) en attente depuis plus de ${Math.trunc(t.value)} jours.`, null, "/finance/approbations"));
  }
  return alerts;
}
function activeAlerts(cids, day) {
  const order = { blocking: 0, warning: 1, info: 2 };
  return cids.flatMap((cid) => companyAlerts(cid, day)).sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
}

/*
 * Champs du tableau de bord ajoutés au noyau après la maquette (seuils, BFR, trésorerie mensuelle et
 * prévue, décisions, questions du dirigeant, équilibre du grand livre) : des valeurs vraisemblables
 * tirées des mêmes données, pour que la session design voie l'écran complet.
 */
const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** Seuils des écrans (noyau : threshold_values) : ceux de la première société, trésorerie minimale du groupe sommée. */
function seuilsTableau(cids) {
  const actifs = DB.thresholds.filter((t) => cids.includes(t.company_id) && t.active);
  const th = Object.fromEntries(actifs.filter((t) => t.company_id === cids[0]).map((t) => [t.code, t.value]));
  return {
    cash_min: sum(actifs.filter((t) => t.code === "cash_min"), (t) => t.value) || null,
    dscr_min: th.dscr_min || 1.2,
    dso_target_days: th.dso_target_days || 60,
    receivable_overdue_share_pct: 30,
    client_concentration_pct: 40,
    transport_margin_min: th.transport_margin_min || null,
    budget_overrun_pct: th.budget_overrun_pct || 10,
  };
}

function complementTableau(cids, day, base) {
  const fyStart = base.fiscal_year.start;
  const debut12 = addDays(addMonths(day, -12), 1);
  const rec = base.receivables;
  const pay = base.payables;
  const ventes = revenue(cids, debut12, day);
  const achats = purchasesBetween(cids, debut12, day);
  const journalier = ventes ? (ventes * 1.18) / 365 : null;
  const dso = journalier ? rec.total / journalier : null;
  const dpo = achats ? pay.total / ((achats * 1.18) / 365) : null;
  const vide = { non_echu: 0, "1_30": 0, "31_60": 0, "61_90": 0, plus_90: 0 };
  const working_capital = {
    date_from: debut12, date_to: day, days: 365,
    receivables: rec.total, receivables_overdue: rec.overdue, overdue_share_pct: rec.total ? (rec.overdue / rec.total) * 100 : null, receivables_doubtful: 0,
    payables: pay.total, payables_overdue: pay.overdue, stocks: 0,
    sales_ttc: round(ventes * 1.18), purchases_ttc: round(achats * 1.18), daily_sales_ttc: journalier,
    dso, dso_12m: dso, dpo, dio: null, cycle: dso !== null && dpo !== null ? dso - dpo : null,
    bfr: round(rec.total - pay.total), bfr_syscohada: round(rec.total - pay.total), balance_sheet_difference: 0, revenue: round(ventes),
    concentration: { partner: null, amount: 0, pct: null },
    receivables_aging: rec.aging, receivables_aging_count: vide, payables_aging: pay.aging, payables_aging_count: vide,
  };
  const th = seuilsTableau(cids);

  // Trésorerie de fin de mois sur l'exercice : constatée jusqu'au mois en cours, à venir ensuite.
  const mois = [];
  let precedent = cashAt(cids, addDays(fyStart, -1));
  for (let m = 0; m < 12; m++) {
    const debut = addMonths(fyStart, m);
    const fin = monthEnd(debut);
    const passe = debut <= day;
    const fin_ = passe ? cashAt(cids, fin < day ? fin : day) : null;
    const encaisse = passe ? round(revenue(cids, debut, fin < day ? fin : day) * 1.05) : 0;
    const net = passe ? round(fin_ - precedent) : 0;
    mois.push({
      month: debut.slice(0, 7), label: MOIS_FR[m], revenue: passe ? round(revenue(cids, debut, fin)) : 0,
      receipts: encaisse, payments: passe ? round(encaisse - net) : 0, net, end: fin_,
      status: !passe ? "a_venir" : th.cash_min && fin_ < th.cash_min ? "sous_seuil" : net < 0 ? "cash_net_negatif" : "conforme",
      current: debut.slice(0, 7) === day.slice(0, 7), active: passe,
    });
    if (passe) precedent = fin_;
  }
  const actifs = mois.filter((m) => m.active);
  const bas = actifs.reduce((b, m) => (b === null || m.end < b.end ? m : b), null);
  const cash_monthly = {
    fiscal_year: base.fiscal_year, opening: cashAt(cids, addDays(fyStart, -1)), threshold: th.cash_min,
    months: mois,
    summary: {
      receipts: actifs.reduce((s, m) => s + m.receipts, 0), payments: actifs.reduce((s, m) => s + m.payments, 0), net: actifs.reduce((s, m) => s + m.net, 0), end: base.cash,
      low_point: bas ? { month: bas.month, label: bas.label, end: bas.end } : null,
      negative_months: actifs.filter((m) => m.net < 0).length, active_months: actifs.length,
      below_threshold_months: actifs.filter((m) => m.status === "sous_seuil").length,
      average_payments: actifs.length ? round(actifs.reduce((s, m) => s + m.payments, 0) / actifs.length) : 0,
    },
  };

  // Prévision : encaissements attendus des clients, décaissements fournisseurs et échéances d'emprunt.
  const etape = (n, depart) => {
    const d = monthEnd(addMonths(day, n));
    const encaissements = round(rec.total * (n === 0 ? 0.35 : 0.2));
    const decaissements = round(pay.total * (n === 0 ? 0.45 : 0.25));
    const emprunts = round(base.debt.next_due_amount || 0);
    const net = encaissements - decaissements - emprunts;
    return { label: `${MOIS_FR[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`, month: d.slice(0, 7), date: d, start: depart, receivables: encaissements, payables: decaissements, loans: emprunts, net, end: depart + net };
  };
  const etapes = [];
  let depart = base.cash;
  for (let n = 0; n < 3; n++) {
    const e = etape(n, depart);
    etapes.push(e);
    depart = e.end;
  }
  const cash_forecast = { as_of: day, start: base.cash, threshold: th.cash_min, month_end: { ...etapes[0], doubtful_excluded: 0 }, months: etapes.slice(1) };

  const revenu = base.revenue_fy;
  const pertes = round(rec.aging.plus_90 * 0.5 + rec.aging["61_90"] * 0.2 + rec.aging["31_60"] * 0.05);
  const decisions = base.alerts.map((a, i) => ({
    key: `${a.code}.${i}`, code: a.code, status: "alert", severity: a.severity === "blocking" ? "critical" : a.severity === "warning" ? "warning" : "info",
    domain: a.link?.split("/")[2] ?? "finance", title: a.title, message: a.message, value: a.value, threshold: a.threshold ?? 0,
    unit: a.value === null ? "none" : "gnf", threshold_unit: "gnf", action: null, link: a.link, company: a.company,
  }));
  const verdict = (bon, moyen) => (bon ? "green" : moyen ? "orange" : "red");
  const questions = [
    { key: "cash", question: "Ai-je assez de trésorerie pour finir le mois ?", answer: `${Math.round(cash_forecast.month_end.end / 1e6)} M GNF prévus en fin de mois`, verdict: verdict(cash_forecast.month_end.end > (th.cash_min || 0) * 1.5, cash_forecast.month_end.end > (th.cash_min || 0)), reading: "Trésorerie de départ, plus les encaissements clients attendus, moins les fournisseurs et les emprunts." },
    { key: "dso", question: "Mes clients paient-ils à temps ?", answer: dso === null ? "Pas de ventes sur 12 mois" : `${Math.round(dso)} jours de crédit client en moyenne`, verdict: dso === null ? "grey" : verdict(dso <= th.dso_target_days, dso <= th.dso_target_days * 1.3), reading: `Cible fixée à ${th.dso_target_days} jours.` },
    { key: "marge", question: "Mon activité est-elle rentable ?", answer: `Marge nette de ${revenu ? Math.round((base.net_result_fy / revenu) * 100) : 0} % sur l'exercice`, verdict: verdict(base.net_result_fy > revenu * 0.08, base.net_result_fy > 0), reading: "Résultat net rapporté au chiffre d'affaires de l'exercice." },
    { key: "dette", question: "Ma dette est-elle soutenable ?", answer: base.dscr === null ? "Aucun service de dette sur 12 mois" : `L'EBE couvre ${base.dscr.toFixed(2).replace(".", ",")} fois le service de la dette`, verdict: base.dscr === null ? "grey" : verdict(base.dscr >= th.dscr_min * 1.25, base.dscr >= th.dscr_min), reading: `Minimum fixé : ${String(th.dscr_min).replace(".", ",")}.` },
  ];
  const debit = round(Math.abs(revenu) * 2.4);
  return {
    thresholds: th,
    margins: { revenue: revenu, ebe_pct: revenu ? (base.ebe_fy / revenu) * 100 : null, net_pct: revenu ? (base.net_result_fy / revenu) * 100 : null },
    working_capital, cash_monthly, cash_forecast, budget: null, transport: null,
    ledger: { date_from: fyStart, date_to: day, debit, credit: debit, difference: 0, balanced: true },
    expected_credit_loss: { total: pertes, rate_pct: rec.total ? (pertes / rec.total) * 100 : null, by_bucket: {}, rates: {} },
    lock_date: cids.map(lockDate).filter(Boolean).sort().pop() ?? null, decisions, questions,
    // Clôture comptable du mois de l'arrêté faite pour chaque société couverte (fausse au 15/10).
    month_closed: cids.every((cid) => (lockDate(cid) ?? "") >= monthEnd(day)),
    cash_other: cashOther(cids, day),
    debt: { ...base.debt, accounting_outstanding: base.debt.outstanding, schedule_gap: 0, net_debt: round(base.debt.outstanding - base.cash), gearing: null },
    alerts: decisions,
  };
}

function dashboard(cids, day) {
  const fyStart = `${day.slice(0, 4)}-01-01`;
  const mStart = monthStart(day);
  const pmStart = addMonths(mStart, -1);
  const pmEnd = addDays(mStart, -1);
  const statement = incomeStatement(cids, fyStart, day);
  const debt = debtSummary(cids, day);
  const ebe12 = incomeStatement(cids, addDays(addMonths(day, -12), 1), day).totals.XD;
  const service = debt.service_last_12m || debt.service_next_12m;
  // Même période du mois précédent : du 1er au même quantième, bornée à sa fin.
  const pmToDate = minDate(addDays(pmStart, +day.slice(8, 10) - 1), pmEnd);
  const fenetre = windowMonths(fyStart, day);
  const base = {
    companies: cids.map(companyRef),
    as_of: day,
    fiscal_year: { start: fyStart, end: `${day.slice(0, 4)}-12-31` },
    revenue_fy: revenue(cids, fyStart, day),
    revenue_month: revenue(cids, mStart, day),
    revenue_prev_month: revenue(cids, pmStart, pmEnd),
    revenue_prev_month_to_date: revenue(cids, pmStart, pmToDate),
    net_result_fy: statement.totals.XI,
    ebe_fy: statement.totals.XD,
    purchases_fy: round(purchasesBetween(cids, fyStart, day)),
    cash: cashAt(cids, day),
    cash_by_journal: cashByJournal(cids, day),
    receivables: openItems(cids, "receivable", day),
    payables: openItems(cids, "payable", day),
    // Fenêtre commune avec cash_monthly : du début de l'exercice au mois de l'arrêté.
    revenue_by_month: monthlySeries(cids, fenetre, day, ["70"]),
    result_by_month: monthlySeries(cids, fenetre, day, ["6", "7", "8"]),
    by_activity: byAnalyticPlan(cids, "activite", fyStart, day),
    debt,
    dscr: service ? ebe12 / service : null,
    alerts: activeAlerts(cids, day),
  };
  const data = { ...base, ...complementTableau(cids, day, base) };
  data.kpi_series = kpiSeries(cids, data);
  return data;
}

/**
 * Séries mensuelles des chiffres clés sur les mois de revenue_by_month (noyau : pilotage.kpi_series),
 * à la fin de chaque mois (au jour de l'arrêté pour le mois en cours) : EBE du mois, DSO et BFR de
 * l'exercice (soldes clients et fournisseurs du modèle), dette financière comptable (16, 17), DSCR sur
 * douze mois. Le dernier point reprend le chiffre affiché ; null quand la valeur n'est pas calculable.
 */
function kpiSeries(cids, data) {
  const day = data.as_of;
  const fyStart = data.fiscal_year.start;
  const months = data.revenue_by_month.map((m) => m.month);
  const series = { months, ebe: [], dso: [], bfr: [], debt: [], dscr: [] };
  for (const key of months) {
    const start = `${key}-01`;
    const end = minDate(monthEnd(start), day);
    const balances = Object.entries(sumBalances(cids, end));
    const of = (test) => sum(balances.filter(([code]) => test(code)), ([, v]) => v);
    const receivables = of((code) => ACCOUNT_BY_CODE.get(code)?.type === "asset_receivable");
    const payables = of((code) => ACCOUNT_BY_CODE.get(code)?.type === "liability_payable");
    const sales = revenue(cids, fyStart, end) * 1.18;
    const owed = debtSummary(cids, end);
    const service = owed.service_last_12m || owed.service_next_12m;
    series.ebe.push(incomeStatement(cids, start, end).totals.XD);
    series.dso.push(sales > 0 ? (receivables / sales) * (daysBetween(fyStart, end) + 1) : null);
    // BFR comme celui qu'affiche la maquette (working_capital, stocks à 0) : clients moins fournisseurs.
    series.bfr.push(round(receivables + payables));
    series.debt.push(round(sum(cids, (cid) => debtAt(cid, end).loan + debtAt(cid, end).lease)));
    series.dscr.push(service ? incomeStatement(cids, addDays(addMonths(end, -12), 1), end).totals.XD / service : null);
  }
  const last = months.length - 1;
  if (last >= 0) {
    // L'EBE mensuel s'additionne en EBE de l'exercice ; la gravure finit sur les chiffres affichés.
    series.ebe[last] = data.ebe_fy - sum(series.ebe.slice(0, last));
    series.dso[last] = data.working_capital.dso;
    series.bfr[last] = data.working_capital.bfr;
    series.debt[last] = data.debt.accounting_outstanding;
    series.dscr[last] = data.dscr;
  }
  return series;
}

function managementReport(cids, day) {
  const mStart = monthStart(day);
  const mEnd = monthEnd(day);
  const asOf = minDate(mEnd, TODAY);
  const dash = dashboard(cids, asOf);
  const fyStart = dash.fiscal_year.start;
  const keys = ["XB", "XC", "XD", "XE", "XF", "XH", "XI"];
  const labels = { XB: "Chiffre d'affaires", XC: "Valeur ajoutée", XD: "Excédent brut d'exploitation", XE: "Résultat d'exploitation", XF: "Résultat financier", XH: "Résultat HAO", XI: "Résultat net" };
  const month = incomeStatement(cids, mStart, mEnd).totals;
  const monthLy = incomeStatement(cids, addMonths(mStart, -12), monthEnd(addMonths(mStart, -12))).totals;
  const ytd = incomeStatement(cids, fyStart, mEnd).totals;
  const ytdLy = incomeStatement(cids, addMonths(fyStart, -12), monthEnd(addMonths(mStart, -12))).totals;
  const flows = Object.fromEntries(cashFlow(cids, fyStart, mEnd).lines.map((l) => [l.code, l.amount]));
  return {
    month: mStart.slice(0, 7),
    period: { start: mStart, end: mEnd, fiscal_year_start: fyStart },
    companies: dash.companies,
    kpis: {
      revenue_month: revenue(cids, mStart, mEnd), revenue_prev_month: revenue(cids, addMonths(mStart, -1), addDays(mStart, -1)),
      revenue_fy: revenue(cids, fyStart, mEnd), net_result_fy: dash.net_result_fy, ebe_fy: dash.ebe_fy, cash: dash.cash,
      receivables: dash.receivables.total, receivables_overdue: dash.receivables.overdue, payables: dash.payables.total, dscr: dash.dscr,
    },
    income: keys.map((k) => ({ code: k, label: labels[k], month: month[k] ?? 0, month_last_year: monthLy[k] ?? 0, ytd: ytd[k] ?? 0, ytd_last_year: ytdLy[k] ?? 0 })),
    by_activity: dash.by_activity,
    cash_by_journal: dash.cash_by_journal,
    cash_flow: Object.fromEntries(["ZA", "ZB", "ZC", "ZF", "ZG", "ZH"].map((k) => [k, flows[k] ?? 0])),
    transport: profitability(cids, mStart, mEnd, "vehicle"),
    debt: dash.debt,
    alerts: dash.alerts,
  };
}

/* ════════════════════════════════════════════════════════════════════════════
 * Pièces comptables, règlements, relevés bancaires, validations, relances
 * ══════════════════════════════════════════════════════════════════════════ */

const SEQUENCES = new Map();
/** Numéros de départ : l'historique antérieur à la maquette n'est pas reconstitué. */
const SEQ_START = { "1-ACH-2026": 411, "1-OD-2026": 185, "1-BGC-2026": 1208, "1-BCK-2026": 742, "1-RVTE-2026": 6, "2-ACH-2026": 36, "2-OD-2026": 41 };
function nextMoveName(move) {
  const j = journalById(move.journal_id);
  const code = move.move_type.endsWith("refund") ? `R${j.code}` : j.code;
  const year = (move.invoice_date || move.date).slice(0, 4);
  const key = `${move.company_id}-${code}-${year}`;
  const n = (SEQUENCES.get(key) ?? SEQ_START[key] ?? 0) + 1;
  SEQUENCES.set(key, n);
  return `${code}/${year}/${pad(n, 5)}`;
}
const isCustomer = (m) => m.move_type === "out_invoice" || m.move_type === "out_refund";
const isSupplier = (m) => m.move_type === "in_invoice" || m.move_type === "in_refund";
const signedResidual = (m) => (m.move_type.endsWith("refund") ? -1 : 1) * m.amount_residual;
const moveById = (id) => DB.moves.find((m) => m.id === id);

function computeMoveTotals(move) {
  if (move.move_type === "entry") {
    move.amount_total = round(sum(move.lines, (l) => l.debit));
    move.amount_untaxed = move.amount_total;
    move.amount_tax = 0;
    return;
  }
  let untaxed = 0;
  let tax = 0;
  for (const l of move.lines) {
    const sub = round(l.quantity * l.price_unit);
    untaxed += sub;
    const t = l.tax_id ? taxById(l.tax_id) : null;
    tax += t ? round((sub * t.amount) / 100) : 0;
  }
  move.amount_untaxed = untaxed;
  move.amount_tax = tax;
  move.amount_total = untaxed + tax;
}
function updatePaymentState(move) {
  if (move.move_type === "entry") move.payment_state = "not_paid";
  else if (move.blocked && move.amount_residual > 0.5) move.payment_state = "blocked";
  else if (move.amount_residual <= 0.5 && move.amount_total > 0) move.payment_state = move.inPayment ? "in_payment" : "paid";
  else if (move.amount_total - move.amount_residual > 0.5) move.payment_state = "partial";
  else move.payment_state = "not_paid";
}
function postMove(move) {
  move.state = "posted";
  move.posted_before = true;
  if (!move.name) move.name = nextMoveName(move);
  updatePaymentState(move);
}
function createMove(spec) {
  const id = newId("move");
  const entry = spec.move_type === "entry";
  const move = {
    id, company_id: spec.company_id, move_type: spec.move_type, state: "draft", name: null,
    partner_id: spec.partner_id ?? null, journal_id: spec.journal_id, date: spec.date,
    invoice_date: entry ? null : spec.invoice_date ?? spec.date,
    invoice_date_due: entry ? null : spec.due ?? spec.invoice_date ?? spec.date,
    ref: spec.ref ?? null, narration: spec.narration ?? null, invoice_origin: spec.origin ?? null,
    lines: [], attachments: spec.attachments ?? [], payments: [], posted_before: false, blocked: false, inPayment: false,
    payment_state: "not_paid", amount_untaxed: 0, amount_tax: 0, amount_total: 0, amount_residual: 0,
    dossier_id: spec.dossier_id ?? null, lease_id: spec.lease_id ?? null, situation_id: spec.situation_id ?? null, reversed_id: spec.reversed_id ?? null,
  };
  move.lines = spec.lines.map((l, i) => ({
    id: id * 100 + i + 1, name: l.name, account: l.account, quantity: l.quantity ?? 1, price_unit: l.price_unit ?? 0,
    tax_id: l.tax_id ?? null, analytic: l.analytic ?? {}, debit: round(l.debit ?? 0), credit: round(l.credit ?? 0), partner_id: l.partner_id ?? null,
  }));
  computeMoveTotals(move);
  move.amount_residual = entry ? 0 : move.amount_total;
  DB.moves.push(move);
  if (spec.state === "posted" || spec.state === "cancel") postMove(move);
  if (spec.state === "cancel") move.state = "cancel";
  return move;
}
/** Règlement d'une pièce ; renvoie le montant réellement imputé. */
function pay(move, date, amount, journalId) {
  const value = Math.min(round(amount), move.amount_residual);
  if (value <= 0) return 0;
  move.amount_residual -= value;
  move.payments.push({ date, amount: value, journal_id: journalId });
  updatePaymentState(move);
  return value;
}

function openInvoices(cids, kind) {
  return DB.moves.filter(
    (m) => cids.includes(m.company_id) && m.state === "posted" && (kind === "receivable" ? isCustomer(m) : isSupplier(m)) && m.amount_residual > 0.5,
  );
}
/** Encours non soldés, échu et ancienneté par tranche (finance_metrics.open_items). */
function openItems(cids, kind, day) {
  const aging = { non_echu: 0, "1_30": 0, "31_60": 0, "61_90": 0, plus_90: 0 };
  let total = 0;
  let overdue = 0;
  const items = openInvoices(cids, kind);
  for (const m of items) {
    const v = signedResidual(m);
    const due = m.invoice_date_due || m.date;
    const late = daysBetween(due, day);
    total += v;
    if (late > 0) overdue += v;
    aging[late <= 0 ? "non_echu" : late <= 30 ? "1_30" : late <= 60 ? "31_60" : late <= 90 ? "61_90" : "plus_90"] += v;
  }
  for (const k of Object.keys(aging)) aging[k] = round(aging[k]);
  return { total: round(total), overdue: round(overdue), documents: items.length, aging };
}

const analyticId = (cid, plan, name) => DB.analytic.find((a) => a.company_id === cid && a.plan === plan && a.name === name)?.id;
const distribution = (...ids) => Object.fromEntries(ids.filter(Boolean).map((id) => [String(id), 100]));

/** Délais de paiement constatés par client (jours après l'échéance). */
const PAY_BEHAVIOR = {
  101: { delay: 12 }, 102: { delay: 26, partial: true }, 103: { delay: 34, partial: true }, 104: { delay: 18 },
  105: { delay: 2 }, 106: { delay: 95, partial: true }, 107: { delay: 20 }, 108: { delay: 52, partial: true },
  109: { delay: 6 }, 110: { delay: 15 }, 111: { delay: 40, partial: true }, 112: { delay: 9 }, 113: { delay: 21 },
  114: { delay: 5 }, 155: { delay: 25 }, 161: { delay: 10 }, 162: { delay: 35, partial: true }, 163: { delay: 18 },
  164: { delay: 60 }, 165: { delay: 8 }, 166: { delay: 14 }, 167: { delay: 4 }, 168: { delay: 30 }, 169: { delay: 12 }, 170: { delay: 45, partial: true },
};
const TERMS = { 101: 45, 103: 60, 105: 15, 111: 30 };
const RECEIPT_JOURNAL = (m) => (m.company_id === 2 ? 15 : [101, 102, 103, 104].includes(m.partner_id) ? 5 : [119, 120].includes(m.partner_id) ? 8 : 6);

/** Flux de règlements à reporter sur les relevés : { move, date, amount, journal_id, reconciled }. */
const BANK_FLOWS = [];

function seedMoves() {
  const r = makeRng("pieces");
  const specs = [];
  // Factures de transport : une par client et par mois, une ligne par rotation.
  for (const [key, rots] of groupBy(DB.rotations.filter((x) => x.state === "invoiced"), (x) => `${x.partner_id}|${x.date_loading.slice(0, 7)}`)) {
    const [pid, month] = key.split("|");
    specs.push({ kind: "transport", partner_id: +pid, date: monthEnd(`${month}-01`), rots: rots.sort((a, b) => a.date_loading.localeCompare(b.date_loading)) });
  }
  for (const sit of DB.situations.filter((s) => s.state === "invoiced")) {
    specs.push({ kind: "situation", partner_id: DB.chantiers.find((c) => c.id === sit.chantier_id).partner_id, date: sit.date, sit });
  }
  for (const p of rentPeriods()) specs.push({ kind: "rent", partner_id: p.lease.partner_id, date: p.date, period: p });
  const order = { situation: 0, transport: 1, rent: 2 };
  specs.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind] || a.partner_id - b.partner_id);

  const activity = (name) => analyticId(1, "activite", name);
  for (const s of specs) {
    if (s.kind === "transport") {
      const lines = s.rots.map((rot) => {
        const vehicle = DB.vehicles.find((v) => v.id === rot.vehicle_id);
        const route = DB.routes.find((x) => x.id === rot.route_id);
        const billed = rot.volume_delivered || rot.volume_loaded;
        const product = (PRODUCTS.find(([c]) => c === rot.product)?.[1] ?? rot.product).toLowerCase();
        return {
          name: `Transport ${product} ${route.name}, ${billed.toFixed(3)} m³${rot.delivery_note ? `, BL ${rot.delivery_note}` : ""} (${rot.name}, ${vehicle.name}, ${frDate(rot.date_loading)})`,
          account: "706100", quantity: billed, price_unit: rot.rate, tax_id: 1,
          analytic: distribution(activity("Transport pétrolier"), analyticId(1, "vehicule", vehicle.name), analyticId(1, "route", route.name)),
        };
      });
      const move = createMove({
        company_id: 1, move_type: "out_invoice", partner_id: s.partner_id, journal_id: 1, date: s.date,
        due: addDays(s.date, TERMS[s.partner_id] ?? 30), origin: s.rots.map((x) => x.name).join(", "), lines, state: "posted",
      });
      for (const rot of s.rots) rot.invoice_id = move.id;
    } else if (s.kind === "situation") {
      const ch = DB.chantiers.find((c) => c.id === s.sit.chantier_id);
      const amounts = situationAmounts(s.sit);
      const move = createMove({
        company_id: 1, move_type: "out_invoice", partner_id: s.partner_id, journal_id: 1, date: s.date, due: addDays(s.date, 30),
        origin: `${ch.name} - situation ${s.sit.number}`, situation_id: s.sit.id, state: "posted",
        lines: [{
          name: `Situation n° ${s.sit.number} - ${ch.name}${s.sit.period_label ? ` - ${s.sit.period_label}` : ""} (avancement cumulé ${amounts.progress_pct.toFixed(1)} %)`,
          account: "705100", quantity: 1, price_unit: amounts.amount_period, tax_id: 1,
          analytic: distribution(activity("BTP et travaux"), analyticId(1, "chantier", ch.name)),
        }],
      });
      s.sit.invoice_id = move.id;
    } else {
      const { lease, date, months } = s.period;
      const prop = DB.properties.find((p) => p.id === lease.property_id);
      const tax = lease.vat ? 1 : 2;
      const label = months === 1 ? monthLabel(date) : `du trimestre du ${frDate(date)} au ${frDate(addDays(addMonths(date, 3), -1))}`;
      const lines = [{ name: `Loyer ${label} : ${prop.name}`, account: "706300", quantity: 1, price_unit: lease.rent, tax_id: tax, analytic: distribution(activity("Immobilier locatif"), analyticId(1, "bien", prop.name)) }];
      if (lease.charges) lines.push({ name: `Charges locatives ${label}`, account: "707100", quantity: 1, price_unit: lease.charges, tax_id: tax, analytic: distribution(analyticId(1, "bien", prop.name)) });
      createMove({
        company_id: 1, move_type: "out_invoice", partner_id: lease.partner_id, journal_id: 1, date, due: addDays(date, months === 1 ? 5 : 10),
        origin: lease.name, lease_id: lease.id, state: "posted", lines,
      });
    }
  }

  // Honoraires du cabinet (temps facturés et forfaits préparés par seedAxispro).
  for (const fee of DB.feeInvoices.sort((a, b) => a.date.localeCompare(b.date))) {
    const d = DB.dossiers.find((x) => x.id === fee.dossier_id);
    const move = createMove({
      company_id: 2, move_type: "out_invoice", partner_id: d.promoter_id, journal_id: 11, date: fee.date, due: addDays(fee.date, 30),
      origin: d.reference, dossier_id: d.id, state: fee.state || "posted",
      lines: fee.lines.map((l) => ({ ...l, account: l.account || "706400", tax_id: 6, analytic: distribution(analyticId(2, "dossier", `${d.reference} ${d.name}`)) })),
    });
    for (const t of DB.timesheets.filter((x) => fee.timesheetIds?.includes(x.id))) t.invoice_id = move.id;
  }

  // Pièces de vente particulières : brouillons, avoirs, facture annulée.
  createMove({ company_id: 1, move_type: "out_invoice", partner_id: 105, journal_id: 1, date: "2026-10-14", due: "2026-10-29", state: "draft", narration: "À valider après accord du client sur le tarif de stationnement.",
    lines: [{ name: "Refacturation des frais de stationnement au dépôt de Gbessia, octobre 2026", account: "707100", quantity: 1, price_unit: 6_500_000, tax_id: 1 }] });
  createMove({ company_id: 1, move_type: "out_invoice", partner_id: 110, journal_id: 1, date: "2026-10-13", state: "draft",
    lines: [{ name: "Transport exceptionnel Conakry - Kindia, livraison de nuit", account: "706100", quantity: 2, price_unit: 9_800_000, tax_id: 1 }] });
  const augustKamsar = DB.moves.find((m) => m.partner_id === 102 && m.invoice_date === "2026-08-31" && m.move_type === "out_invoice");
  const refund = createMove({ company_id: 1, move_type: "out_refund", partner_id: 102, journal_id: 1, date: "2026-09-08", due: "2026-09-08", state: "posted", ref: augustKamsar ? `Avoir sur ${augustKamsar.name}` : null,
    lines: [{ name: "Manquants constatés à la livraison de Kamsar, août 2026", account: "706100", quantity: 1, price_unit: 18_400_000, tax_id: 1 }] });
  pay(refund, "2026-09-12", refund.amount_total, 6);
  createMove({ company_id: 1, move_type: "out_refund", partner_id: 106, journal_id: 1, date: "2026-10-02", due: "2026-10-02", state: "posted", ref: "Geste commercial, retard de livraison de septembre",
    lines: [{ name: "Avoir pour retard de livraison, accord commercial du 30 septembre 2026", account: "706100", quantity: 1, price_unit: 9_500_000, tax_id: 1 }] });
  createMove({ company_id: 1, move_type: "out_invoice", partner_id: 109, journal_id: 1, date: "2026-09-12", due: "2026-10-12", state: "cancel", narration: "Facture établie en double, annulée.",
    lines: [{ name: "Transport gasoil Conakry - Mamou, facture établie en double", account: "706100", quantity: 36.8, price_unit: 475000, tax_id: 1 }] });
  createMove({ company_id: 2, move_type: "out_invoice", partner_id: 155, journal_id: 11, date: "2026-10-12", state: "draft",
    lines: [{ name: "Mission d'appui à la sélection des projets agricoles, tranche 2", account: "706400", quantity: 1, price_unit: 85_000_000, tax_id: 6 }] });

  // Règlements des clients selon leur comportement habituel.
  for (const m of DB.moves.filter((x) => x.move_type === "out_invoice" && x.state === "posted")) {
    let b = PAY_BEHAVIOR[m.partner_id] || { delay: 10 };
    if (m.lease_id) {
      const lease = DB.leases.find((l) => l.id === m.lease_id);
      b = { delay: lease.payDelay, cash: [119, 120, 117].includes(lease.partner_id) };
      if (lease.partner_id === 119 && m.invoice_date >= "2026-09-01") b = { never: true };
      if (lease.partner_id === 117 && m.invoice_date >= "2026-10-01") b = { never: true };
    }
    if (m.partner_id === 107 && m.invoice_date >= "2026-04-01") b = { never: true };
    if (b.never) continue;
    const due = m.invoice_date_due;
    const payDate = addDays(due, b.delay);
    const journal = b.cash ? 8 : RECEIPT_JOURNAL(m);
    if (payDate <= addDays(TODAY, -6)) {
      pay(m, payDate, m.amount_total, journal);
      BANK_FLOWS.push({ move: m, date: payDate, amount: m.amount_total, journal_id: journal, reconciled: true });
    } else if (payDate <= TODAY) {
      // Virement reçu ces derniers jours, pas encore rapproché : la facture reste ouverte.
      BANK_FLOWS.push({ move: m, date: payDate, amount: m.amount_residual, journal_id: journal, reconciled: false });
    } else if (b.partial && TODAY >= addDays(due, Math.floor(b.delay / 2) + 6)) {
      const partialDate = addDays(due, Math.floor(b.delay / 2));
      const value = pay(m, partialDate, roundTo(m.amount_total * 0.5, 1000), journal);
      BANK_FLOWS.push({ move: m, date: partialDate, amount: value, journal_id: journal, reconciled: true });
    }
  }
  // Loyer d'octobre réglé en espèces à l'accueil, en attente de rapprochement de la caisse.
  const cashRent = DB.moves.find((m) => m.lease_id === 2 && m.invoice_date === "2026-10-01");
  if (cashRent && cashRent.amount_residual > 0) {
    cashRent.inPayment = true;
    pay(cashRent, "2026-10-09", cashRent.amount_residual, 8);
  }

  seedPurchases(r);
  seedEntries();
}

/** Pièces d'achat de juin à octobre, cohérentes avec les charges du mois. */
function seedPurchases(r) {
  const plan = [
    { cid: 1, partner: 131, account: "604200", days: [3, 10, 17, 24], terms: 15, delay: 2, prefix: "FC", label: (d) => `Gasoil livré au parc de Matoto, semaine du ${frDate(d)}` },
    { cid: 1, partner: 132, account: "604400", days: [8, 22], terms: 30, delay: 6, prefix: "PP", label: () => "Pneumatiques et pièces détachées poids lourds" },
    { cid: 1, partner: 133, account: "624200", days: [25], terms: 30, delay: 10, prefix: "GCM", label: (d) => `Révisions et réparations du parc, ${monthLabel(d)}` },
    { cid: 1, partner: 134, account: "625200", days: [1], months: [7, 10], factor: 3, tax: 5, terms: 30, delay: 0, prefix: "AGG", label: (d) => `Assurance flotte, trimestre débutant le ${frDate(d)}` },
    { cid: 1, partner: 135, account: "604500", days: [6, 20], share: 0.7, terms: 30, delay: 8, prefix: "CFC", label: () => "Ciment, fer à béton et agrégats pour les chantiers" },
    { cid: 1, partner: 142, account: "604500", days: [15], share: 0.3, terms: 30, delay: 5, prefix: "QGM", label: () => "Quincaillerie et petit outillage de chantier" },
    { cid: 1, partner: 141, account: "622300", days: [25], terms: 30, delay: 15, prefix: "LEK", label: (d) => `Location d'engins de terrassement, ${monthLabel(d)}` },
    { cid: 1, partner: 136, account: "624100", days: [18], terms: 30, delay: 4, prefix: "EGK", label: () => "Entretien électrique des bâtiments du siège et du parc" },
    { cid: 1, partner: 137, account: "637000", days: [28], terms: 30, delay: 3, prefix: "SGR", label: (d) => `Gardiennage du siège et du parc, ${monthLabel(d)}` },
    { cid: 1, partner: 138, account: "628100", days: [5], terms: 15, delay: 1, prefix: "TSG", label: (d) => `Téléphonie, internet et flotte mobile, ${monthLabel(d)}` },
    { cid: 1, partner: 139, account: "604700", days: [12], months: [6, 8, 10], fixed: 4_200_000, terms: 30, delay: 5, prefix: "IND", label: () => "Imprimés, carnets de bons de livraison et fournitures" },
    { cid: 1, partner: 140, account: "632400", days: [30], months: [6, 9], fixed: 96_000_000, terms: 30, delay: 12, prefix: "BEA", label: (d) => `Honoraires de tenue et de révision des comptes, ${monthLabel(d)}` },
    { cid: 2, partner: 171, account: "622200", days: [2], terms: 15, delay: 3, prefix: "BSK", label: (d) => `Loyer des bureaux du cabinet, ${monthLabel(d)}` },
    { cid: 2, partner: 138, account: "628100", days: [5], terms: 15, delay: 2, prefix: "TSG", label: (d) => `Téléphonie et internet du cabinet, ${monthLabel(d)}` },
    { cid: 2, partner: 172, account: "632400", days: [20], terms: 30, delay: 9, prefix: "EAC", label: (d) => `Expertise agronomique sous-traitée, ${monthLabel(d)}` },
  ];
  const specs = [];
  for (const p of plan) {
    for (const month of [6, 7, 8, 9, 10]) {
      if (p.months && !p.months.includes(month)) continue;
      const key = `2026-${pad(month)}`;
      for (const day of p.days) {
        const date = `${key}-${pad(Math.min(day, lastDayOf(2026, month)))}`;
        if (date > TODAY) continue;
        const base = p.fixed ?? ((PL[p.cid].get(key) || {})[p.account] || 0) * (p.share ?? 1) * (p.factor ?? 1) / p.days.length;
        const amount = roundTo(month === 10 && !p.fixed ? base / PARTIAL : base, 1000);
        if (amount <= 0) continue;
        specs.push({ ...p, date, amount });
      }
    }
  }
  specs.sort((a, b) => a.date.localeCompare(b.date) || a.partner - b.partner);
  for (const s of specs) {
    const move = createMove({
      company_id: s.cid, move_type: "in_invoice", partner_id: s.partner, journal_id: s.cid === 1 ? 2 : 12, date: s.date, due: addDays(s.date, s.terms),
      ref: `${s.prefix}-2026-${pad(r.int(1000, 1999), 4)}`, state: "posted",
      lines: [{ name: s.label(s.date), account: s.account, quantity: 1, price_unit: s.amount, tax_id: s.tax ?? (s.cid === 1 ? 3 : 8) }],
    });
    // Facture du fournisseur numérisée, jointe à la pièce (deux pièces sur trois).
    if (move.id % 3) move.attachments.push({ id: newId("attachment"), name: `${move.ref}.pdf`, mimetype: "application/pdf", size: r.int(90, 900) * 1024 });
    const journal = s.cid === 2 ? 15 : s.partner === 131 ? 5 : 6;
    const payDate = addDays(move.invoice_date_due, s.delay);
    const special = s.partner === 131 && s.date === "2026-09-24" ? "unpaid" : s.partner === 133 && s.date === "2026-08-25" ? "blocked" : s.partner === 132 && s.date === "2026-09-22" ? "partial" : null;
    if (special === "blocked") {
      move.blocked = true;
      move.narration = "Règlement suspendu : contestation de la facturation de la main-d'œuvre (litige en cours).";
      updatePaymentState(move);
    } else if (special === "partial") {
      const value = pay(move, "2026-10-06", roundTo(move.amount_total * 0.5, 1000), journal);
      BANK_FLOWS.push({ move, date: "2026-10-06", amount: -value, journal_id: journal, reconciled: true });
    } else if (!special && payDate <= addDays(TODAY, -2)) {
      pay(move, payDate, move.amount_total, journal);
      BANK_FLOWS.push({ move, date: payDate, amount: -move.amount_total, journal_id: journal, reconciled: payDate <= addDays(TODAY, -5) });
    }
  }
}

/** Opérations diverses : salaires, dotations, provisions, échéances, virements, retenues de garantie. */
function seedEntries() {
  const od = (cid, date, ref, lines, state = "posted", journal = null) =>
    createMove({ company_id: cid, move_type: "entry", journal_id: journal ?? journalOf(cid, "OD").id, date, ref, state, lines: lines.map((l) => ({ ...l, name: l.name ?? ref })) });
  for (const cid of COMPANY_IDS) {
    for (const key of ["2026-07", "2026-08", "2026-09"]) {
      const amounts = PL[cid].get(key) || {};
      const salaries = amounts["661100"] || 0;
      const social = amounts["664100"] || 0;
      od(cid, monthEnd(`${key}-01`), `Salaires ${ofMonth(`${key}-01`)}`, [
        { account: "661100", debit: salaries },
        { account: "664100", debit: social },
        { account: "422000", credit: round(salaries * 0.8) },
        { account: "447000", credit: salaries - round(salaries * 0.8) },
        { account: "431000", credit: social },
      ]);
    }
    const salariesOct = round(cid === 1 ? 520e6 : 82e6);
    od(cid, "2026-10-31", "Salaires d'octobre 2026", [
      { account: "661100", debit: salariesOct },
      { account: "664100", debit: round(salariesOct * 0.18) },
      { account: "422000", credit: round(salariesOct * 0.8) },
      { account: "447000", credit: salariesOct - round(salariesOct * 0.8) },
      { account: "431000", credit: round(salariesOct * 0.18) },
    ], "draft");
    const split = DEP_SPLIT[cid].get("2026-09") || {};
    const depLines = Object.entries(split).map(([acc, v]) => ({ account: acc, credit: round(v) }));
    od(cid, "2026-09-30", "Dotations aux amortissements de septembre 2026", [{ account: "681300", debit: sum(depLines, (l) => l.credit) }, ...depLines]);
  }
  od(1, "2026-08-31", "Provision pour litige, Ciments du Rio Pongo (démo)", [{ account: "691000", debit: 180e6 }, { account: "191000", credit: 180e6 }]);
  const line = DB.loans.find((l) => l.id === 1).lines.find((l) => l.due_date === "2026-09-15");
  if (line) {
    od(1, "2026-09-15", `Emprunt BGC 2024-01, renouvellement de la flotte - échéance ${line.sequence}`, [
      { account: "162100", debit: line.principal, partner_id: 151 },
      { account: "671200", debit: line.interest, partner_id: 151, name: `Emprunt BGC 2024-01 - échéance ${line.sequence} - intérêts` },
      { account: "521110", credit: line.total, partner_id: 151 },
    ], "posted", 5);
  }
  od(1, "2026-09-30", "Reclassement du compte d'attente 471, encaissement non identifié", [{ account: "471000", debit: 12_500_000 }, { account: "411100", credit: 12_500_000, partner_id: 112 }]);
  od(1, "2026-10-06", "Écart de caisse constaté au parc de Matoto", [{ account: "658000", debit: 85_000 }, { account: "571200", credit: 85_000 }]);
  od(1, "2026-10-14", "Virement Banque du Golfe vers Caisse du siège", [{ account: "585000", debit: 180e6 }, { account: "521110", credit: 180e6 }], "posted", 5);
  od(1, "2026-10-14", "Chèques clients remis à la Banque du Golfe, à encaisser", [{ account: "513000", debit: 70e6 }, { account: "411100", credit: 70e6, partner_id: 101 }]);
  od(1, "2026-10-12", "Régularisation de TVA de septembre 2026", [{ account: "443100", debit: 41_300_000 }, { account: "445200", credit: 41_300_000 }], "draft");
  od(1, "2026-10-15", "Charges constatées d'avance, assurance flotte du 4e trimestre", [{ account: "476000", debit: 196e6 }, { account: "625200", credit: 196e6 }], "draft");
  for (const sit of DB.situations.filter((s) => s.state === "invoiced" && s.date >= "2026-08-01")) {
    const ch = DB.chantiers.find((c) => c.id === sit.chantier_id);
    const retention = situationAmounts(sit).retention_amount;
    if (!retention) continue;
    const label = `Retenue de garantie ${ch.retention_rate} % - situation ${sit.number} - ${ch.name}`;
    od(1, sit.date, label, [{ account: "411700", debit: retention, partner_id: ch.partner_id }, { account: "411100", credit: retention, partner_id: ch.partner_id }]);
  }
}

/** Relevés de banque et de caisse : règlements des pièces, frais, échéances, opérations de caisse. */
function seedStatementLines() {
  const lines = [];
  const add = (cid, journal_id, date, label, amount, partner_id = null, reconciled = true) =>
    lines.push({ company_id: cid, journal_id, date, label, amount: round(amount), partner_id, reconciled });
  for (const f of BANK_FLOWS) {
    if (f.date < "2026-08-16") continue;
    const m = f.move;
    const who = upper(partnerName(m.partner_id) || "");
    const label = f.amount >= 0 ? `VIR RECU ${who} ${m.name}` : `VIR EMIS ${who} FACT ${m.ref || m.name}`;
    add(m.company_id, f.journal_id, f.date, label, f.amount, m.partner_id, f.reconciled);
  }
  const loan1 = DB.loans.find((l) => l.id === 1);
  const loan2 = DB.loans.find((l) => l.id === 2);
  for (const l of loan1.lines.filter((x) => x.paid && x.due_date >= "2026-08-16")) add(1, 5, l.due_date, `PRELEVEMENT ECHEANCE PRET 2024-01 N ${l.sequence}`, -l.total, 151);
  for (const l of loan2.lines.filter((x) => x.paid && x.due_date >= "2026-08-16")) add(1, 6, l.due_date, `PRELEVEMENT LOYER CREDIT-BAIL ER-14 ER-15 N ${l.sequence}`, -l.total, 153);
  for (const [journal, fee] of [[5, 485000], [6, 362500]]) {
    add(1, journal, "2026-08-31", "FRAIS DE TENUE DE COMPTE AOUT 2026", -fee);
    add(1, journal, "2026-09-30", "FRAIS DE TENUE DE COMPTE SEPTEMBRE 2026", -fee);
  }
  add(1, 6, "2026-10-13", "COMMISSIONS SUR VIREMENTS EMIS", -126_500, null, false);
  add(1, 5, "2026-09-30", "VIREMENT SALAIRES SEPTEMBRE 2026", -round(((PL[1].get("2026-09") || {})["661100"] || 0) * 0.8));
  add(1, 5, "2026-10-14", "VIREMENT INTERNE VERS CAISSE DU SIEGE", -180e6);
  add(1, 6, "2026-09-15", "PAIEMENT TVA AOUT 2026 DGI", -312_400_000);
  add(1, 5, "2026-10-12", "VIR RECU REF 88412 SANS LIBELLE", 12_500_000, null, false);
  add(1, 7, "2026-09-18", "VIR RECU AERO SERVICES GBESSIA (DEMO) USD", 21_400);
  add(1, 7, "2026-09-18", "FRAIS SWIFT", -45);
  add(1, 7, "2026-10-12", "VIR EMIS FOURNISSEUR PIECES DUBAI", -18_250, null, false);
  const cash = [
    [8, "2026-09-03", "Achat de fournitures de bureau et papeterie", -1_850_000],
    [8, "2026-09-11", "Frais de mission Boké, suivi du chantier de la route", -3_200_000],
    [8, "2026-09-19", "Carburant du véhicule de service (bons)", -2_400_000],
    [8, "2026-09-26", "Remboursement de frais médicaux, personnel", -950_000],
    [8, "2026-10-02", "Achat d'eau minérale et de consommables", -420_000],
    [8, "2026-10-08", "Frais de mission Kamsar, réunion client", -2_150_000, false],
    [8, "2026-10-13", "Timbres fiscaux et frais de légalisation", -380_000, false],
    [9, "2026-09-05", "Avance frais de route ER-09, Conakry - Siguiri", -2_700_000],
    [9, "2026-09-16", "Achat de lubrifiants et de filtres", -4_150_000],
    [9, "2026-09-29", "Réparation de pneu, ER-02", -650_000],
    [9, "2026-10-07", "Prime de gardiennage de nuit", -500_000],
    [9, "2026-10-12", "Avance frais de route ER-05, Conakry - Kankan", -2_300_000, false],
    [16, "2026-09-10", "Frais de mission Labé, visite de site", -1_650_000],
    [16, "2026-10-05", "Fournitures pour l'atelier de formation", -780_000],
    [16, "2026-10-13", "Rafraîchissements du comité d'investissement", -320_000, false],
  ];
  for (const [journal, date, label, amount, reconciled = true] of cash) add(journalById(journal).company_id, journal, date, label, amount, null, reconciled);
  add(2, 15, "2026-09-30", "FRAIS DE TENUE DE COMPTE SEPTEMBRE 2026", -215_000);
  add(2, 15, "2026-10-14", "VIR RECU FONDS DE GARANTIE INVESTISSEMENTS AGRICOLES (DEMO)", 40_000_000, 155, false);
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.journal_id - b.journal_id);
  for (const l of lines) {
    const j = journalById(l.journal_id);
    const statement = j.type === "bank" ? (l.date >= "2026-10-01" ? `${j.code} 01/10/2026 - 13/10/2026` : `${j.code} ${l.date.slice(5, 7)}/${l.date.slice(0, 4)}`) : null;
    DB.statementLines.push({ id: newId("st"), ...l, statement, move_id: 60000 + IDS.st });
  }
}

/* ─── Circuits d'approbation (eguitra_approval) ─────────────────────────── */

const APPROVAL_DOCS = { in_invoice: "Pièces d'achat et avoirs fournisseurs", payment_out: "Règlements fournisseurs", entry: "Opérations diverses" };
const APPROVER_LABELS = { finance: "Finance et comptabilité", direction: "Direction générale", admin: "Administration" };

function applicableRules(cid, document, amount, accountCodes = []) {
  return DB.approvalRules
    .filter((r) => r.company_id === cid && r.document === document && r.active)
    .filter((r) => amount >= r.min_amount && !(r.max_amount && amount > r.max_amount))
    .filter((r) => !r.account_prefix || accountCodes.some((c) => c.startsWith(r.account_prefix)))
    .sort((a, b) => a.sequence - b.sequence || a.min_amount - b.min_amount);
}
const currentStep = (req) => req.steps.filter((s) => s.state === "pending").sort((a, b) => a.sequence - b.sequence)[0] ?? null;
const pendingProfile = (req) => (req.state === "pending" ? currentStep(req)?.profile ?? null : null);
function canDecide(req, user) {
  const step = currentStep(req);
  if (req.state !== "pending" || !step || user.id === req.requested_by) return false;
  return user.profiles.includes(step.profile);
}
function moveDisplayName(move) {
  return move.name || `${partnerName(move.partner_id) ?? "Pièce"}${move.ref ? `, réf. ${move.ref}` : ""}`;
}
/** Demande d'approbation ; une demande antérieure non aboutie sur la même pièce est annulée. */
function openApproval(record, document, rules, userId, at = nowStamp()) {
  for (const old of DB.approvals.filter((a) => a.res_model === "account.move" && a.res_id === record.id && (a.state === "pending" || a.state === "rejected"))) old.state = "cancelled";
  const req = {
    id: newId("approval"), name: `${APPROVAL_DOCS[document]} : ${moveDisplayName(record)}`, company_id: record.company_id, document,
    res_model: "account.move", res_id: record.id, amount: record.amount_total, partner_id: record.partner_id,
    requested_by: userId, requested_at: at, state: "pending",
    steps: rules.map((rule, i) => ({ id: newId("step"), sequence: i + 1, label: rule.name, profile: rule.approver_profile, state: "pending", decided_by: null, decided_at: null, comment: null })),
  };
  DB.approvals.push(req);
  return req;
}
function postOrSubmit(move, userId) {
  if (isSupplier(move)) {
    const rules = applicableRules(move.company_id, "in_invoice", move.amount_total, move.lines.map((l) => l.account));
    if (rules.length) {
      openApproval(move, "in_invoice", rules, userId);
      return;
    }
  }
  postMove(move);
}
function approvalInfo(move) {
  const req = DB.approvals.filter((a) => a.res_model === "account.move" && a.res_id === move.id).sort((a, b) => b.id - a.id)[0];
  if (!req) return null;
  const step = currentStep(req);
  return { request_id: req.id, state: req.state, level: step ? step.sequence : null, pending_with: step && req.state === "pending" ? APPROVER_LABELS[step.profile] : null };
}

function seedApprovals() {
  const R = (id, cid, document, sequence, min, max, prefix, profile, name, active = true) =>
    ({ id, company_id: cid, name, document, sequence, min_amount: min, max_amount: max, account_prefix: prefix, approver_profile: profile, active });
  DB.approvalRules = [
    R(1, 1, "in_invoice", 1, 0, 0, null, "finance", "Pièces d'achat : contrôle de la finance"),
    R(2, 1, "in_invoice", 2, 50_000_000, 0, null, "direction", "Pièces d'achat de plus de 50 M GNF : accord de la direction"),
    R(3, 1, "payment_out", 1, 100_000_000, 0, null, "direction", "Règlements de plus de 100 M GNF : accord de la direction"),
    R(4, 1, "in_invoice", 3, 0, 0, "2", "admin", "Investissements : accord de l'administration", false),
    R(5, 2, "in_invoice", 1, 0, 0, null, "finance", "Pièces d'achat : contrôle de la finance"),
    R(6, 2, "in_invoice", 2, 10_000_000, 0, null, "direction", "Pièces d'achat de plus de 10 M GNF : accord de la direction"),
    R(7, 2, "payment_out", 1, 25_000_000, 0, null, "direction", "Règlements de plus de 25 M GNF : accord de la direction"),
  ];
  const draft = (cid, partner, date, ref, label, account, amount, tax) =>
    createMove({ company_id: cid, move_type: "in_invoice", partner_id: partner, journal_id: cid === 1 ? 2 : 12, date, due: addDays(date, 30), ref, state: "draft",
      lines: [{ name: label, account, quantity: 1, price_unit: amount, tax_id: tax ?? (cid === 1 ? 3 : 8) }] });
  const decide = (req, seq, state, userId, at, comment = null) => {
    const step = req.steps.find((s) => s.sequence === seq);
    Object.assign(step, { state, decided_by: userId, decided_at: at, comment });
  };
  const rulesFor = (move) => applicableRules(move.company_id, "in_invoice", move.amount_total, move.lines.map((l) => l.account));

  const fuel = draft(1, 131, "2026-10-12", "FC-2026-1187", "Gasoil livré au parc de Matoto, semaine du 12/10/2026", "604200", 318_400_000);
  const earlier = openApproval(fuel, "in_invoice", rulesFor(fuel), 11, "2026-10-11T16:02:00Z");
  earlier.name = `${APPROVAL_DOCS.in_invoice} : ${moveDisplayName(fuel)} (première soumission)`;
  openApproval(fuel, "in_invoice", rulesFor(fuel), 11, "2026-10-12T10:14:00Z");
  const parts = draft(1, 132, "2026-10-08", "PP-2026-0934", "Pneumatiques Michelin X Multi et jantes, réassort du parc", "604400", 86_500_000);
  decide(openApproval(parts, "in_invoice", rulesFor(parts), 5, "2026-10-08T15:02:00Z"), 1, "approved", 6, "2026-10-09T09:40:00Z", "Conforme au bon de commande BC-2026-212.");
  const insurance = draft(1, 134, "2026-10-01", "AGG-2026-Q4-0071", "Assurance flotte, quatrième trimestre 2026", "625200", 294_000_000, 5);
  decide(openApproval(insurance, "in_invoice", rulesFor(insurance), 5, "2026-10-02T08:30:00Z"), 1, "approved", 2, "2026-10-03T11:05:00Z");
  const cement = draft(1, 135, "2026-10-05", "CFC-2026-1544", "Ciment CPJ 42.5 et fer à béton, chantier de Kipé", "604500", 61_200_000);
  const rejected = openApproval(cement, "in_invoice", rulesFor(cement), 10, "2026-10-05T11:20:00Z");
  decide(rejected, 1, "rejected", 2, "2026-10-06T16:05:00Z", "Facture en double avec la livraison du 20 septembre, déjà comptabilisée.");
  for (const s of rejected.steps) if (s.state === "pending") s.state = "skipped";
  rejected.state = "rejected";
  const engines = draft(1, 141, "2026-10-13", "LEK-2026-118", "Location d'une niveleuse et d'un compacteur, lotissement de Matoto", "622300", 72_000_000);
  openApproval(engines, "in_invoice", rulesFor(engines), 2, "2026-10-13T09:00:00Z");
  const printing = draft(1, 139, "2026-10-14", "IND-2026-0402", "Carnets de bons de livraison numérotés", "604700", 4_850_000);
  openApproval(printing, "in_invoice", rulesFor(printing), 9, "2026-10-14T14:12:00Z");
  const experts = draft(2, 172, "2026-10-09", "EAC-2026-0077", "Expertise agronomique, dossier de la rizerie de Kankan", "632400", 48_000_000);
  openApproval(experts, "in_invoice", applicableRules(2, "in_invoice", experts.amount_total, ["632400"]), 21, "2026-10-09T17:25:00Z");

  // Pièce approuvée puis comptabilisée en septembre.
  const garage = DB.moves.find((m) => m.partner_id === 133 && m.invoice_date === "2026-09-25");
  if (garage) {
    const req = openApproval(garage, "in_invoice", rulesFor(garage), 11, "2026-09-25T10:30:00Z");
    decide(req, 1, "approved", 5, "2026-09-26T08:15:00Z");
    if (req.steps[1]) decide(req, 2, "approved", 2, "2026-09-26T17:40:00Z", "Accord, réparation de l'ER-07 urgente.");
    req.state = "approved";
  }
  // Règlement fournisseur soumis à la direction.
  DB.approvals.push({
    id: newId("approval"), name: `${APPROVAL_DOCS.payment_out} : PAY/2026/00184`, company_id: 1, document: "payment_out",
    res_model: "account.payment", res_id: 184, amount: 412_000_000, partner_id: 131, requested_by: 6, requested_at: "2026-10-14T16:40:00Z", state: "pending",
    payment: { name: "PAY/2026/00184", date: "2026-10-14", state: "draft", journal: "Banque du Golfe, compte courant", memo: "Règlement des factures de gasoil de septembre" },
    steps: [{ id: newId("step"), sequence: 1, label: "Règlements de plus de 100 M GNF : accord de la direction", profile: "direction", state: "pending", decided_by: null, decided_at: null, comment: null }],
  });
}

/* ─── Relances clients (eguitra_finance.models.reminder) ─────────────────── */

const REMINDER_LEVELS = { 1: "Rappel", 2: "Relance ferme", 3: "Mise en demeure" };
const REMINDER_DAYS = { 1: 1, 2: 15, 3: 30 };
function overdueByPartner(cid, day) {
  const invoices = DB.moves.filter((m) => m.company_id === cid && m.move_type === "out_invoice" && m.state === "posted" && m.amount_residual > 0.5 && m.invoice_date_due < day);
  return groupBy(invoices, (m) => m.partner_id);
}
function levelFor(days) {
  let level = null;
  for (const [lvl, min] of Object.entries(REMINDER_DAYS)) if (days >= min) level = lvl;
  return level;
}
function seedReminders() {
  const add = (cid, partner, date, level, days, invoices, state, channel = null, sentAt = null, sentBy = null) =>
    DB.reminders.push({
      id: newId("reminder"), company_id: cid, partner_id: partner, date, level: String(level), days_overdue: days,
      amount_due: round(sum(invoices, (m) => m.amount_residual)), invoice_ids: invoices.map((m) => m.id), state, channel, sent_at: sentAt, sent_by: sentBy,
    });
  for (const cid of COMPANY_IDS) {
    for (const [partner, invoices] of overdueByPartner(cid, TODAY)) {
      if (partner === 104) continue; // relance non encore calculée : « Calculer maintenant » la crée
      const days = Math.max(...invoices.map((m) => daysBetween(m.invoice_date_due, TODAY)));
      const level = Number(levelFor(days));
      if (!level) continue;
      const oldest = invoices.map((m) => m.invoice_date_due).sort()[0];
      const hasMail = Boolean(partnerById(partner)?.email);
      if (level >= 2) add(cid, partner, addDays(oldest, REMINDER_DAYS[1]), 1, 1, invoices, "sent", hasMail ? "email" : "letter", stamp(addDays(oldest, 2), 7, 30), hasMail ? null : 6);
      if (level >= 3) add(cid, partner, addDays(oldest, REMINDER_DAYS[2]), 2, 15, invoices, "sent", hasMail ? "email" : "letter", stamp(addDays(oldest, 16), 7, 30), hasMail ? null : 6);
      const autoSent = level < 3 && hasMail && cid === 1;
      add(cid, partner, addDays(TODAY, -1), level, days, invoices, autoSent ? "sent" : "to_send", autoSent ? "email" : null, autoSent ? stamp(TODAY, 2, 0) : null, null);
    }
  }
  const paidLater = DB.moves.filter((m) => m.partner_id === 112 && m.move_type === "out_invoice" && m.payment_state === "paid").slice(-1);
  if (paidLater.length) add(1, 112, "2026-09-16", 1, 7, paidLater, "cancelled");
  const paid110 = DB.moves.filter((m) => m.partner_id === 110 && m.payment_state === "paid").slice(-1);
  if (paid110.length) add(1, 110, "2026-08-20", 2, 16, paid110, "cancelled");
}

/* ─── Immobilisations, budgets, clôtures, seuils, axes analytiques ───────── */

function assetBoard(asset) {
  const profile = DB.assetProfiles.find((p) => p.id === asset.profile_id);
  const years = profile?.method_number || 5;
  const lines = [];
  let id = asset.id * 100;
  const active = asset.state !== "draft";
  lines.push({ id: ++id, date: asset.date_start, type: "create", amount: asset.purchase_value, depreciated: 0, remaining: asset.purchase_value, posted: active });
  const base = asset.purchase_value - (asset.salvage_value || 0);
  const annual = base / years;
  const startYear = +asset.date_start.slice(0, 4);
  const firstFraction = (12 - +asset.date_start.slice(5, 7) + 1) / 12;
  let depreciated = 0;
  for (let y = startYear; depreciated < base - 0.5 && y <= startYear + years + 1; y++) {
    const date = `${y}-12-31`;
    if (asset.removal && date > asset.removal.date) {
      const amount = round(Math.min((annual * +asset.removal.date.slice(5, 7)) / 12, base - depreciated));
      depreciated += amount;
      lines.push({ id: ++id, date: asset.removal.date, type: "depreciate", amount, depreciated, remaining: asset.purchase_value - depreciated, posted: true });
      lines.push({ id: ++id, date: asset.removal.date, type: "remove", amount: asset.purchase_value - depreciated, depreciated, remaining: 0, posted: true });
      break;
    }
    const amount = round(Math.min(y === startYear ? annual * firstFraction : annual, base - depreciated));
    depreciated += amount;
    lines.push({ id: ++id, date, type: "depreciate", amount, depreciated, remaining: asset.purchase_value - depreciated, posted: active && date <= TODAY });
  }
  return lines;
}
function assetValues(asset) {
  const depreciated = sum(asset.board.filter((l) => l.type === "depreciate" && l.posted), (l) => l.amount);
  if (asset.state === "removed") return { depreciated, residual: 0 };
  return { depreciated, residual: asset.purchase_value - (asset.salvage_value || 0) - depreciated };
}
function seedAssets() {
  const P = (id, cid, name, years, asset, dep) => ({ id, company_id: cid, name, method: "linear", method_number: years, method_period: "year", account_asset: asset, account_depreciation: dep, account_expense: "681300", journal_id: cid === 1 ? 3 : 13 });
  DB.assetProfiles = [
    P(1, 1, "Matériel de transport, ensembles routiers", 8, "245100", "284500"),
    P(2, 1, "Bâtiments et constructions", 25, "231300", "283100"),
    P(3, 1, "Matériel et engins de chantier", 8, "241000", "284100"),
    P(4, 1, "Matériel informatique", 4, "244100", "284400"),
    P(5, 1, "Mobilier de bureau", 10, "244400", "284400"),
    P(6, 1, "Véhicules de service", 5, "245200", "284500"),
    P(7, 1, "Logiciels", 5, "213000", "281300"),
    P(8, 2, "Matériel informatique", 4, "244100", "284400"),
    P(9, 2, "Véhicules de mission", 5, "245200", "284500"),
    P(10, 2, "Mobilier de bureau", 10, "244400", "284400"),
  ];
  IDS.profile = 10;
  const A = (cid, name, code, profile, value, start, state, removal = null) => ({
    id: newId("asset"), company_id: cid, name, code, profile_id: profile, purchase_value: value, salvage_value: 0, date_start: start, state, partner_id: null, removal, method: "linear",
  });
  DB.assets = [
    A(1, "Ensemble ER-01, Renault Kerax 440 et citerne 40 000 L", "IMM-TR-2019-01", 1, 1_480_000_000, "2019-03-01", "open"),
    A(1, "Ensembles ER-09 à ER-13, cinq MAN TGS 33.440 et citernes", "IMM-TR-2024-02", 1, 8_450_000_000, "2024-02-15", "open"),
    A(1, "Ensemble ER-16, Volvo FMX 440 et citerne 45 000 L", "IMM-TR-2025-01", 1, 1_650_000_000, "2025-06-20", "open"),
    A(1, "Ensembles ER-14 et ER-15 (crédit-bail)", "IMM-TR-2026-01", 1, 3_400_000_000, "2026-03-12", "open"),
    A(1, "Ensemble ER-03, Mercedes Actros 2641 (occasion)", "IMM-TR-2019-03", 1, 1_150_000_000, "2019-01-15", "removed", { date: "2026-05-28", sale: 340_000_000, partner: 123 }),
    A(1, "Entrepôt logistique de Matoto", "IMM-BT-2025-01", 2, 4_200_000_000, "2025-03-01", "open"),
    A(1, "Siège social, immeuble Kaloum Centre (quote-part)", "IMM-BT-2012-01", 2, 3_100_000_000, "2012-01-01", "open"),
    A(1, "Pelle hydraulique sur chenilles 22 t", "IMM-CH-2022-01", 3, 1_380_000_000, "2022-04-15", "open"),
    A(1, "Bétonnière automotrice 3 m³ et vibreurs", "IMM-CH-2026-01", 3, 620_000_000, "2026-07-08", "open"),
    A(1, "Compacteur monocylindre 12 t", "IMM-CH-2020-01", 3, 940_000_000, "2020-09-01", "open"),
    A(1, "Parc informatique du siège, 24 postes et serveur", "IMM-IT-2023-01", 4, 285_000_000, "2023-01-10", "open"),
    A(1, "Serveurs et onduleurs 2021", "IMM-IT-2021-01", 4, 95_000_000, "2021-02-01", "close"),
    A(1, "Mobilier de bureau, siège de Kaloum", "IMM-MB-2018-01", 5, 170_000_000, "2018-06-01", "open"),
    A(1, "Pick-up Toyota Hilux, direction de l'exploitation", "IMM-VS-2024-01", 6, 465_000_000, "2024-05-02", "open"),
    A(1, "Logiciel de gestion de flotte et géolocalisation", "IMM-LG-2023-01", 7, 350_000_000, "2023-07-01", "open"),
    A(1, "Groupe électrogène 250 kVA, parc de Matoto", null, 3, 410_000_000, "2026-10-02", "draft"),
    A(2, "Ordinateurs portables des consultants (10)", "IMM-IT-2025-01", 8, 128_000_000, "2025-01-15", "open"),
    A(2, "Véhicule de mission, Toyota Land Cruiser Prado", "IMM-VS-2026-01", 9, 320_000_000, "2026-02-10", "open"),
    A(2, "Mobilier des bureaux de Kaloum", "IMM-MB-2024-01", 10, 70_000_000, "2024-03-01", "open"),
    A(2, "Vidéoprojecteur et matériel de formation", "IMM-IT-2021-02", 8, 24_000_000, "2021-09-01", "close"),
  ];
  for (const a of DB.assets) a.board = assetBoard(a);
}

function seedBudgets() {
  DB.budgets = [
    { id: 1, company_id: 1, name: "Budget 2026", date_from: "2026-01-01", date_to: "2026-12-31", state: "confirmed", items: [] },
    { id: 2, company_id: 1, name: "Budget 2025", date_from: "2025-01-01", date_to: "2025-12-31", state: "confirmed", items: [] },
    { id: 3, company_id: 2, name: "Budget 2026 du cabinet", date_from: "2026-01-01", date_to: "2026-12-31", state: "confirmed", items: [] },
  ];
  const factors = {
    1: { "706100": 1.06, "705100": 1.12, "706300": 1.04, "604200": 0.96, "604400": 1.0, "604500": 1.02, "624200": 0.92, "625200": 1.0, "661100": 1.03, "664100": 1.03, "622200": 1.0, "628100": 1.05, "632400": 1.1, "637000": 1.0, "641000": 1.0 },
    2: { "706400": 1.08, "706500": 1.1, "661100": 1.04, "664100": 1.04, "622200": 1.0, "618100": 1.0, "632400": 1.05 },
  };
  for (const b of DB.budgets) {
    const year = +b.date_from.slice(0, 4);
    for (const [code, factor] of Object.entries(factors[b.company_id])) {
      for (let m = 1; m <= 12; m++) {
        const base = Math.abs((PL[b.company_id].get(`${year - 1}-${pad(m)}`) || {})[code] || 0);
        if (base) b.items.push({ id: newId("budgetItem"), account: code, month: m, amount: roundTo(base * factor, 100000) });
      }
    }
  }
}

const closingRecord = (cid, period) => DB.closings.find((c) => c.company_id === cid && c.period === period);
function lockDate(cid) {
  const closed = DB.closings.filter((c) => c.company_id === cid && c.state === "closed").map((c) => c.period).sort();
  return closed.length ? monthEnd(closed[closed.length - 1]) : null;
}
function seedClosings() {
  IDS.closing = 100;
  IDS.closeEvent = 500;
  const add = (cid, period, state, events) => {
    const last = events.find((e) => e.action === "close");
    DB.closings.push({ id: newId("closing"), company_id: cid, period, state, closed_by: state === "closed" ? last?.user ?? null : null, closed_at: state === "closed" ? last?.date ?? null : null, last_check: null, events });
  };
  const ev = (action, user, date, reason = null) => ({ id: newId("closeEvent"), action, user, date, reason });
  for (const [cid, user, lastClosed] of [[1, 5, "2026-08"], [2, 6, "2026-07"]]) {
    for (const key of monthKeys("2025-01-01", lastClosed)) {
      const next = addMonths(`${key}-01`, 1);
      const date = stamp(addDays(next, 8 + (+key.slice(5, 7) % 4)), 16, 10 + (+key.slice(5, 7) % 40), 12);
      if (cid === 1 && key === "2026-05") {
        add(cid, `${key}-01`, "closed", [
          ev("close", user, "2026-06-04T15:22:41Z"),
          ev("reopen", 2, "2026-06-03T09:12:05Z", "Facture d'assurance de mai comptabilisée en juin par erreur : reclassement avant la clôture définitive."),
          ev("close", user, "2026-06-02T17:48:30Z"),
        ]);
      } else add(cid, `${key}-01`, "closed", [ev("close", user, date)]);
    }
  }
}

function seedThresholds() {
  const values = {
    1: { cash_min: [2_500_000_000, "warning"], receivable_overdue_days: [60, "warning"], receivable_overdue_amount: [2_000_000_000, "warning"], close_delay_days: [10, "warning"], transit_account: [0, "blocking"], transport_margin_min: [15, "warning"], budget_overrun_pct: [10, "warning"], approval_delay_days: [3, "info"] },
    2: { cash_min: [300_000_000, "warning"], receivable_overdue_days: [45, "warning"], receivable_overdue_amount: [0, "warning"], close_delay_days: [10, "warning"], transit_account: [0, "blocking"], transport_margin_min: [15, "warning", false], budget_overrun_pct: [15, "warning"], approval_delay_days: [5, "info"] },
  };
  let id = 0;
  for (const cid of COMPANY_IDS) {
    for (const code of Object.keys(ALERT_CODES)) {
      const [value, severity, active = true] = values[cid][code];
      DB.thresholds.push({ id: ++id, company_id: cid, code, value, severity, active });
    }
  }
}

function seedAnalytic() {
  const add = (cid, plan, name, code = null) => DB.analytic.push({ id: newId("analytic"), company_id: cid, plan, name, code, active: true });
  for (const n of ["Transport pétrolier", "BTP et travaux", "Immobilier locatif", "Siège et services communs"]) add(1, "activite", n);
  for (const n of ["Direction générale", "Direction financière", "Exploitation transport", "Atelier et maintenance", "Parc de Matoto"]) add(1, "centre_cout", n);
  for (const ch of DB.chantiers) add(1, "chantier", ch.name, ch.code);
  for (const v of DB.vehicles) add(1, "vehicule", v.name);
  for (const rt of DB.routes) add(1, "route", rt.name);
  for (const p of DB.properties) add(1, "bien", p.name);
  for (const n of ["Conseil en bancabilité", "Formation et accompagnement", "Structure du cabinet"]) add(2, "activite", n);
  for (const n of ["Cabinet", "Missions sur le terrain"]) add(2, "centre_cout", n);
  for (const d of DB.dossiers) add(2, "dossier", `${d.reference} ${d.name}`, d.reference);
}

/* ════════════════════════════════════════════════════════════════════════════
 * AxisPro Suite : grille d'évaluation, dossiers, data room, comités, temps
 * ══════════════════════════════════════════════════════════════════════════ */

const STATUS_VALUES = { met: 1, partial: 0.5, not_met: 0 };
/** Nombre à la française (noyau : scoring.fnum) et forme accordée au nombre, singulier jusqu'à 1 (scoring.accord, scoring.pluriel). */
const fnum = (v, digits = 1) => (v === null || v === undefined ? "–" : v.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/\s/g, " "));
const accord = (n, un, plusieurs = null) => (Math.abs(n) < 2 ? un : plusieurs || `${un}s`);
const pluriel = (n, un, plusieurs = null) => `${fnum(n, Number.isInteger(n) ? 0 : 1)} ${accord(n, un, plusieurs)}`;
const STATUSES = { not_assessed: "Non évalué", met: "Satisfait", partial: "Partiellement satisfait", not_met: "Non satisfait", na: "Sans objet" };
const RECOMMENDATION_LABELS = { go: "GO", conditional: "GO sous conditions", no_go: "NO-GO", pending: "À compléter", postponed: "Ajourné" };

const AX_GATES = [
  ["G0", "Idée et opportunité", "Le projet répond-il à un besoin avéré et le porteur est-il identifié ?"],
  ["G1", "Préfaisabilité", "Premières hypothèses de marché, de technique et de coûts."],
  ["G2", "Faisabilité", "Études complètes : marché, technique, environnement, juridique."],
  ["G3", "Montage financier", "Plan de financement, prévisions et structure des apports."],
  ["G4", "Bancabilité et due diligence", "Contrôles approfondis avant la présentation aux bailleurs."],
  ["G5", "Comité d'investissement", "Décision du comité et conditions suspensives."],
  ["G6", "Mise en place du financement", "Levée des conditions, signature des conventions, décaissement."],
  ["G7", "Suivi post-financement", "Suivi des engagements, des indicateurs et des remboursements."],
];
/** Domaines : [code, libellé, poids, critères [libellé, gate, poids, drapeaux c/k/e, aide]]. */
const AX_DOMAINS = [
  ["D01", "Porteur et gouvernance", 8, [
    ["Identité et références du promoteur vérifiées", "G0", 2, "ce", "Pièce d'identité et curriculum vitae du promoteur."],
    ["Expérience du promoteur dans le secteur", "G0", 3, "", "Années d'activité, projets comparables menés à terme."],
    ["Absence de condamnation et d'incident bancaire", "G1", 3, "ke", "Casier judiciaire et attestation de la centrale des risques."],
    ["Répartition du capital et bénéficiaires effectifs connus", "G1", 2, "ce", "Registre des associés et déclaration des bénéficiaires effectifs."],
    ["Organes de gouvernance définis", "G2", 1, "", null],
    ["Séparation des patrimoines du promoteur et de la société", "G2", 2, "", "Comptes bancaires distincts, aucune dépense personnelle en charges."],
    ["Engagement personnel et disponibilité du promoteur", "G0", 2, "", null],
    ["Plan de succession et équipe de relève", "G3", 1, "", null],
  ]],
  ["D02", "Marché et demande", 9, [
    ["Besoin du marché clairement identifié", "G0", 3, "c", null],
    ["Étude de marché documentée", "G1", 3, "e", "Joindre l'étude de marché, avec ses sources."],
    ["Taille et croissance du marché cible estimées", "G1", 2, "", null],
    ["Concurrence locale et importations analysées", "G1", 2, "", null],
    ["Clients potentiels identifiés et lettres d'intention", "G2", 3, "e", "Lettres d'intention signées des principaux acheteurs."],
    ["Prix de vente cohérents avec le marché", "G2", 2, "", null],
    ["Saisonnalité de la demande prise en compte", "G2", 1, "", null],
    ["Sensibilité de la demande au prix analysée", "G3", 1, "", null],
  ]],
  ["D03", "Stratégie commerciale", 6, [
    ["Positionnement et proposition de valeur", "G1", 2, "", null],
    ["Canaux de distribution définis", "G2", 2, "", null],
    ["Politique de prix et conditions de paiement", "G2", 2, "", null],
    ["Plan de communication et budget associé", "G3", 1, "", null],
    ["Contrats d'enlèvement ou de vente signés", "G4", 3, "ce", "Contrats ou bons de commande fermes couvrant la première année."],
    ["Objectifs de vente chiffrés par année", "G3", 2, "", null],
    ["Dépendance à un client unique maîtrisée", "G4", 2, "", "Aucun client au-delà de 40 % du chiffre d'affaires."],
  ]],
  ["D04", "Technique et production", 8, [
    ["Procédé technique éprouvé", "G1", 3, "c", null],
    ["Capacité de production dimensionnée sur la demande", "G2", 2, "", null],
    ["Devis des équipements de fournisseurs reconnus", "G2", 2, "e", "Trois devis comparables par équipement majeur."],
    ["Site d'implantation adapté (accès, énergie, eau)", "G2", 3, "", null],
    ["Planning de réalisation réaliste", "G3", 2, "", null],
    ["Plan de maintenance et pièces de rechange", "G3", 1, "", null],
    ["Normes de qualité et certifications visées", "G4", 1, "", null],
    ["Rendements techniques justifiés", "G2", 2, "", null],
  ]],
  ["D05", "Approvisionnement et logistique", 5, [
    ["Approvisionnement en matières premières sécurisé", "G2", 3, "c", null],
    ["Accords avec les principaux fournisseurs", "G3", 2, "e", null],
    ["Stockage et conservation des intrants", "G2", 1, "", null],
    ["Transport et logistique de distribution", "G2", 2, "", null],
    ["Stocks de sécurité dimensionnés", "G3", 1, "", null],
    ["Dépendance aux importations et risque de change", "G3", 2, "", null],
    ["Délais d'approvisionnement maîtrisés", "G3", 1, "", null],
  ]],
  ["D06", "Ressources humaines", 5, [
    ["Organigramme cible défini", "G2", 1, "", null],
    ["Compétences clés disponibles ou recrutables", "G2", 2, "", null],
    ["Plan de formation du personnel", "G3", 1, "", null],
    ["Masse salariale cohérente avec le marché", "G3", 2, "", null],
    ["Conformité au code du travail et à la CNSS", "G4", 2, "e", null],
    ["Encadrement technique qualifié", "G2", 2, "", null],
    ["Recrutement local privilégié", "G3", 1, "", null],
    ["Politique de rémunération et de fidélisation", "G3", 1, "", null],
  ]],
  ["D07", "Juridique et foncier", 7, [
    ["Société régulièrement constituée (statuts, RCCM)", "G1", 3, "ce", "Statuts certifiés et extrait RCCM de moins de trois mois."],
    ["Titre foncier ou bail de longue durée sécurisé", "G2", 3, "ke", "Titre foncier, arrêté d'attribution ou bail notarié d'au moins quinze ans."],
    ["Autorisations d'exploitation obtenues ou en cours", "G3", 2, "ce", null],
    ["Contrats clés revus par un juriste", "G4", 2, "", null],
    ["Absence de litige en cours sur le site", "G2", 2, "", null],
    ["Marques et propriété intellectuelle protégées", "G4", 1, "", null],
    ["Assurances obligatoires souscrites ou prévues", "G4", 2, "", null],
    ["Pacte d'associés signé", "G4", 1, "", null],
  ]],
  ["D08", "Environnement et social", 6, [
    ["Étude d'impact environnemental et social approuvée", "G3", 3, "ke", "Certificat de conformité environnementale ou avis favorable du ministère."],
    ["Gestion des déchets et des effluents", "G3", 2, "", null],
    ["Consultation des communautés riveraines", "G2", 2, "", null],
    ["Santé et sécurité au travail", "G3", 2, "", null],
    ["Absence de déplacement involontaire de populations", "G2", 2, "c", null],
    ["Consommation d'eau et d'énergie maîtrisée", "G3", 1, "", null],
    ["Plan de gestion environnementale et sociale", "G4", 2, "", null],
  ]],
  ["D09", "Modèle économique", 8, [
    ["Sources de revenus identifiées et réalistes", "G1", 3, "c", null],
    ["Structure des coûts complète", "G2", 3, "", null],
    ["Marge brute suffisante", "G2", 2, "", null],
    ["Seuil de rentabilité calculé", "G3", 2, "", null],
    ["Besoin en fonds de roulement estimé", "G3", 2, "", null],
    ["Résistance à une baisse de 20 % du chiffre d'affaires", "G3", 2, "", null],
    ["Avantage concurrentiel durable", "G2", 1, "", null],
  ]],
  ["D10", "Prévisions financières", 10, [
    ["Comptes prévisionnels sur cinq ans", "G3", 3, "ce", "Classeur avec les hypothèses détaillées."],
    ["Hypothèses de prévision documentées", "G3", 2, "", null],
    ["Trésorerie prévisionnelle mensuelle de la première année", "G3", 2, "", null],
    ["Couverture du service de la dette (DSCR) supérieure à 1,3", "G4", 3, "c", null],
    ["Taux de rentabilité interne supérieur au coût du capital", "G4", 2, "", null],
    ["Analyse de sensibilité et scénarios", "G4", 2, "", null],
    ["États financiers certifiés (société existante)", "G4", 2, "e", null],
    ["Cohérence du plan d'affaires et des prévisions", "G3", 1, "", null],
  ]],
  ["D11", "Structure de financement", 8, [
    ["Apport personnel du promoteur d'au moins 20 %", "G3", 3, "ke", "Relevés bancaires ou attestation de blocage des fonds."],
    ["Plan de financement équilibré", "G3", 3, "c", null],
    ["Lettres d'intérêt de banques ou de bailleurs", "G4", 2, "e", null],
    ["Subventions et financements concessionnels identifiés", "G3", 1, "", null],
    ["Durée du crédit adaptée à la durée de vie des actifs", "G4", 2, "", null],
    ["Différé de remboursement justifié", "G4", 1, "", null],
    ["Coût global du financement maîtrisé", "G4", 2, "", null],
  ]],
  ["D12", "Garanties et sûretés", 6, [
    ["Sûretés réelles proposées", "G4", 3, "c", null],
    ["Valeur des garanties évaluée par un expert", "G4", 2, "e", null],
    ["Caution personnelle du promoteur", "G4", 2, "", null],
    ["Garantie d'un fonds de garantie sollicitée", "G4", 1, "", null],
    ["Assurance des actifs financés", "G5", 2, "", null],
    ["Nantissement du fonds de commerce ou des équipements", "G5", 1, "", null],
    ["Domiciliation des recettes auprès de la banque", "G6", 2, "", null],
  ]],
  ["D13", "Risques et atténuation", 6, [
    ["Cartographie des risques du projet", "G3", 2, "", null],
    ["Risque de change évalué", "G3", 1, "", null],
    ["Risque de prix des matières premières couvert", "G3", 2, "", null],
    ["Risques climatiques et saisonniers pris en compte", "G3", 2, "", null],
    ["Plan de continuité en cas d'arrêt de production", "G5", 1, "", null],
    ["Risque pays et sécuritaire évalué", "G4", 1, "", null],
    ["Activité absente des listes d'exclusion des bailleurs", "G1", 2, "k", "Armes, tabac, jeux d'argent, exploitation forestière illégale."],
  ]],
  ["D14", "Impact et développement local", 4, [
    ["Emplois directs créés", "G2", 2, "", null],
    ["Emplois indirects et sous-traitance locale", "G2", 1, "", null],
    ["Valorisation de la production nationale", "G2", 2, "", null],
    ["Inclusion des femmes et des jeunes", "G3", 1, "", null],
    ["Contribution aux recettes publiques", "G3", 1, "", null],
    ["Accès des populations aux biens produits", "G3", 1, "", null],
    ["Indicateurs d'impact mesurables et suivis", "G7", 1, "", null],
  ]],
  ["D15", "Conformité fiscale et réglementaire", 4, [
    ["Immatriculation fiscale (NIF) à jour", "G1", 2, "e", null],
    ["Attestation de régularité fiscale", "G4", 2, "ce", null],
    ["Attestation de régularité sociale (CNSS)", "G4", 2, "e", null],
    ["Régime fiscal et incitations du code des investissements", "G3", 1, "", null],
    ["Agrément au code des investissements obtenu", "G5", 1, "", null],
    ["Conformité à la réglementation des changes", "G4", 1, "", null],
    ["Déclarations statistiques et sectorielles à jour", "G7", 1, "", null],
  ]],
];
/** Pièces standard : [libellé, rubrique, gate, obligatoire, consignes]. */
const AX_DOCS = [
  ["Pièce d'identité du promoteur", "Porteur", "G0", true, "Carte d'identité ou passeport en cours de validité."],
  ["Curriculum vitae du promoteur", "Porteur", "G0", true, null],
  ["Note de présentation du projet", "Projet", "G0", true, "Deux à cinq pages : besoin, solution, montant recherché."],
  ["Statuts de la société", "Juridique", "G1", true, "Copie certifiée conforme."],
  ["Extrait RCCM de moins de trois mois", "Juridique", "G1", true, null],
  ["Attestation d'immatriculation fiscale (NIF)", "Fiscal", "G1", true, null],
  ["Casier judiciaire du promoteur", "Juridique", "G1", true, "Bulletin n° 3 de moins de trois mois."],
  ["Étude de marché", "Marché", "G1", true, null],
  ["Étude de faisabilité technique", "Technique", "G2", true, null],
  ["Devis des équipements", "Technique", "G2", true, "Trois devis comparables par équipement majeur."],
  ["Titre foncier ou bail", "Foncier", "G2", true, null],
  ["Plan de masse et plans du site", "Technique", "G2", false, null],
  ["Lettres d'intention des clients", "Marché", "G2", true, null],
  ["Notice d'impact environnemental", "Environnement", "G2", true, null],
  ["Procès-verbal de consultation des riverains", "Environnement", "G2", false, null],
  ["Plan d'affaires complet", "Financier", "G3", true, null],
  ["Comptes prévisionnels sur cinq ans", "Financier", "G3", true, "Classeur Excel avec les hypothèses."],
  ["Plan de trésorerie de la première année", "Financier", "G3", true, null],
  ["Plan de financement", "Financier", "G3", true, null],
  ["Justificatif de l'apport personnel", "Financier", "G3", true, "Relevés bancaires ou attestation de blocage des fonds."],
  ["Contrats d'approvisionnement", "Opérations", "G3", false, null],
  ["Étude d'impact environnemental approuvée", "Environnement", "G3", true, null],
  ["Organigramme et fiches de poste", "Ressources humaines", "G3", false, null],
  ["Autorisations d'exploitation", "Juridique", "G3", true, null],
  ["États financiers certifiés des trois derniers exercices", "Financier", "G4", false, "Pour une société déjà en activité."],
  ["Attestation de régularité fiscale", "Fiscal", "G4", true, null],
  ["Attestation CNSS", "Social", "G4", true, null],
  ["Rapport d'évaluation des garanties", "Garanties", "G4", true, null],
  ["Lettres d'intérêt des banques", "Financier", "G4", true, null],
  ["Contrats de vente ou d'enlèvement", "Marché", "G4", true, null],
  ["Polices d'assurance", "Garanties", "G4", false, null],
  ["Pacte d'associés", "Juridique", "G4", false, null],
  ["Relevés bancaires des douze derniers mois", "Financier", "G4", true, null],
  ["Procès-verbal du comité d'investissement", "Décision", "G5", true, null],
  ["Lettre d'offre de financement", "Décision", "G5", true, null],
  ["Convention de crédit signée", "Financement", "G6", true, null],
  ["Actes de sûretés enregistrés", "Garanties", "G6", true, null],
  ["Attestation d'ouverture du compte de domiciliation", "Financement", "G6", true, null],
  ["Rapports trimestriels d'activité", "Suivi", "G7", true, null],
  ["États financiers annuels", "Suivi", "G7", true, null],
  ["Rapport de visite de site", "Suivi", "G7", false, null],
  ["Autres documents utiles", "Divers", null, false, "Tout document que le porteur juge utile au cabinet."],
];
/** Compartiments d'expertise (version 3 de l'outil de scoring du cabinet) : [code, intitulé, domaines].
 * Les grilles v2 et v3 en ont ; la v1 (archivée) n'en a pas, comme une grille antérieure à l'outil. */
const AX_COMPARTMENTS = [
  ["C0", "Coordination et cadrage projet", ["D01"]],
  ["C1", "Foncier et autorisations", ["D07", "D15"]],
  ["C2", "Technique et ingénierie", ["D04", "D05"]],
  ["C3", "Marché et commercial", ["D02", "D03"]],
  ["C4", "Environnement, social et impact", ["D08", "D14"]],
  ["C5", "Organisation et ressources humaines", ["D06"]],
  ["C6", "Modèle financier et bancabilité", ["D09", "D10", "D11"]],
  ["C7", "Garanties, risques et closing", ["D12", "D13"]],
];
/** Règle de passage, complétude documentaire minimale (exigence d'entrée, %) et texte d'entrée des gates. */
const AX_GATE_RULES = {
  G0: ["intake", null, "Fiche projet reçue et enregistrée."],
  G1: ["prequalification", 40, "Checklist complétée à au moins 40 % ; promoteur identifiable."],
  G2: ["feasibility", null, "Foncier confirmé et études de marché engagées."],
  G3: ["apd", null, "CAPEX documentés et plan de financement esquissé."],
  G4: ["bankability", 70, "Dossier documenté à au moins 70 % avant la revue de bancabilité."],
  G5: ["due_diligence", null, null],
  G6: ["structuring", null, null],
  G7: ["closing", null, null],
};
const AX_RULES = {
  intake: "Recevabilité (fiche projet)", prequalification: "Préqualification (knock-outs du gate, maturité)",
  feasibility: "Préfaisabilité (knock-outs des domaines clés, maturité)", apd: "APD Readiness (zéro knock-out, score APD)",
  bankability: "Bancabilité (score Bankability, DSCR)", due_diligence: "Due diligence (red flag, data room)",
  structuring: "Structuration (accord des bailleurs, domaines cibles)", closing: "Financial close (conditions levées, documentation signée)",
  generic: "Critères du gate évalués, sans knock-out",
};
const AX_SCOPES = { global: "Toute la grille", cumulative: "Critères des gates atteints" };
const AX_REQUIREMENTS = { blocking: "Bloquant", apd: "Pendant l'APD", closing: "Due diligence et closing" };
const AX_BANKABLE_DOMAINS = ["D09", "D10", "D11", "D12"];
const AX_INDICATORS = {
  dscr_min: { label: "DSCR minimal", higher: true, unit: "x" }, irr_project: { label: "TRI du projet", higher: true, unit: "%" },
  npv: { label: "VAN du projet", higher: true, unit: "GNF" }, payback: { label: "Délai de récupération", higher: false, unit: "ans" },
  equity_share: { label: "Apport des promoteurs", higher: true, unit: "%" },
};
/** Critères et pièces retirés de la version 1 (archivée). */
const V1_SKIPPED_CRITERIA = [8, 16, 46, 61, 87, 104, 111];
const V1_SKIPPED_DOCS = [12, 15, 23, 41];
const POLICY_NOTES = "Une recommandation GO exige un score d'au moins 70 sur 100 et aucun critère critique ouvert. Un critère éliminatoire non satisfait entraîne un NO-GO quel que soit le score. La décision appartient au comité d'investissement.";

function buildPolicy(id, version, state, dateActive, go, conditional, notes) {
  const p = id;
  const gates = AX_GATES.map(([code, name, description], i) => ({
    id: p * 10 + i + 1, code, name, description, sequence: i + 1, rule_code: AX_GATE_RULES[code]?.[0] ?? "generic",
    threshold_hold: null, threshold_go: null, score_scope: i <= 2 ? "cumulative" : "global", domain_ids: [],
    min_completeness: version >= 2 ? (AX_GATE_RULES[code]?.[1] ?? null) : null, entry_requirements: AX_GATE_RULES[code]?.[2] ?? null, deliverables: null, exit_criteria: null,
  }));
  const gateId = (code) => gates.find((g) => g.code === code)?.id ?? null;
  const compartments = version >= 2 ? AX_COMPARTMENTS.map(([code, name], i) => ({ id: p * 100 + 60 + i + 1, code, name, sequence: i + 1 })) : [];
  const compartmentOf = (domainCode) => compartments[AX_COMPARTMENTS.findIndex(([, , codes]) => codes.includes(domainCode))]?.id ?? null;
  const domains = [];
  const criteria = [];
  let n = 0;
  AX_DOMAINS.forEach(([code, name, weight, list], i) => {
    const domain = { id: p * 100 + i + 1, code, name, weight, sequence: i + 1, deliverable: null, compartment_id: compartmentOf(code) };
    domains.push(domain);
    for (const [label, gate, w, flags, guidance] of list) {
      n += 1;
      if (version === 1 && V1_SKIPPED_CRITERIA.includes(n)) continue;
      criteria.push({
        id: p * 1000 + n, code: `C${pad(n, 3)}`, number: n, name: label, domain_id: domain.id, gate_id: gateId(gate),
        weight: version === 3 && n === 72 ? 4 : w, critical: flags.includes("c"), knockout: flags.includes("k"), evidence_required: flags.includes("e"), guidance,
        requirement_type: flags.includes("c") || flags.includes("k") ? "blocking" : Number(gate.slice(1)) >= 5 ? "closing" : "apd",
        bankability: AX_BANKABLE_DOMAINS.includes(code), deliverable: null, indicator: null,
      });
    }
  });
  const documents = AX_DOCS.map(([name, category, gate, required, guidance], i) => ({
    id: p * 1000 + 500 + i + 1, code: `P${pad(i + 1, 2)}`, number: i + 1, name, category, gate_id: gate ? gateId(gate) : null, required, guidance,
  })).filter((d) => !(version === 1 && V1_SKIPPED_DOCS.includes(d.number)));
  return {
    id, company_id: 2, name: "Politique d'évaluation AxisPro", version, state, date_active: dateActive, go_threshold: go, conditional_threshold: conditional, notes,
    threshold_bankable: 80, threshold_hold: 40, dscr_target: 1.2, weighting: "domain", ko_partial_blocks: false, evidence_check: true, exclude_na: true, expiry_check: false,
    capex_criterion_id: null, gates, compartments, domains, criteria, documents,
  };
}
const policyById = (id) => DB.policies.find((p) => p.id === id);
const activePolicy = (cid) => DB.policies.find((p) => p.company_id === cid && p.state === "active") ?? null;
const evaluationsOf = (dossier) => DB.evaluations.filter((e) => e.dossier_id === dossier.id);
const criterionOf = (policy, id) => policy.criteria.find((c) => c.id === id);
const gateSeq = (policy, gateId) => policy.gates.find((g) => g.id === gateId)?.sequence ?? 0;

/** Score, éliminatoires, critères critiques ouverts et recommandation (axispro.dossier.scoring). */
function scoring(dossier, gate = null) {
  const policy = policyById(dossier.policy_id);
  let evals = evaluationsOf(dossier).map((e) => ({ e, c: criterionOf(policy, e.criterion_id) })).filter((x) => x.c);
  if (gate) evals = evals.filter((x) => gateSeq(policy, x.c.gate_id) <= gate.sequence);
  const domains = [];
  let total = 0;
  let totalWeight = 0;
  for (const domain of policy.domains) {
    const list = evals.filter((x) => x.c.domain_id === domain.id);
    const scored = list.filter((x) => x.e.status in STATUS_VALUES);
    const weight = sum(scored, (x) => x.c.weight);
    const score = weight ? (sum(scored, (x) => STATUS_VALUES[x.e.status] * x.c.weight) / weight) * 100 : null;
    domains.push({
      domain_id: domain.id, code: domain.code, name: domain.name, weight: domain.weight, score, assessed: list.filter((x) => x.e.status !== "not_assessed").length, criteria: list.length,
      gaps: list.filter((x) => ["partial", "not_met"].includes(x.e.status)).length, knockouts: list.filter((x) => x.c.knockout && x.e.status === "not_met").length,
    });
    if (score !== null) {
      total += score * domain.weight;
      totalWeight += domain.weight;
    }
  }
  const globalScore = totalWeight ? total / totalWeight : null;
  const reached = gate || policy.gates.find((g) => g.id === dossier.current_gate_id);
  const inScope = evals.filter((x) => !reached || gateSeq(policy, x.c.gate_id) <= reached.sequence);
  const knockouts = evals.filter((x) => x.c.knockout && x.e.status === "not_met");
  const critical = inScope.filter((x) => x.c.critical && (x.e.status === "not_met" || x.e.status === "not_assessed"));
  let recommendation;
  if (knockouts.length) recommendation = "no_go";
  else if (globalScore === null || inScope.some((x) => x.e.status === "not_assessed")) recommendation = "pending";
  else if (globalScore >= policy.go_threshold && !critical.length) recommendation = "go";
  else if (globalScore >= policy.conditional_threshold) recommendation = "conditional";
  else recommendation = "no_go";
  const borne = (v) => Math.max(0, Math.min(100, v));
  const readiness = borne(globalScore ?? 0);
  const apd = borne(readiness - 4 * critical.length);
  const bankability = borne(readiness - 12 * knockouts.length - 3 * critical.length);
  const assessed = evals.filter((x) => x.e.status !== "not_assessed").length;
  const pendingInScope = inScope.filter((x) => x.e.status === "not_assessed").length;
  // Recommandation de la méthode, jamais « à compléter » : pendant la saisie, un critère non évalué des
  // gates atteints y compte comme non disponible (score provisoire) ; ensuite, celle de la plateforme.
  let methodRecommendation = recommendation;
  if (recommendation === "pending") {
    let mTotal = 0;
    let mWeight = 0;
    for (const domain of policy.domains) {
      const list = inScope.filter((x) => x.c.domain_id === domain.id && (x.e.status in STATUS_VALUES || x.e.status === "not_assessed"));
      const weight = sum(list, (x) => x.c.weight);
      if (!weight) continue;
      mTotal += (sum(list, (x) => (STATUS_VALUES[x.e.status] ?? 0) * x.c.weight) / weight) * 100 * domain.weight;
      mWeight += domain.weight;
    }
    const provisional = mWeight ? mTotal / mWeight : 0;
    methodRecommendation = provisional >= policy.go_threshold && !critical.length ? "go" : provisional >= policy.conditional_threshold ? "conditional" : "no_go";
  }
  // Motif accordé au nombre (noyau : dossier.scoring et scoring._recommendation).
  let recommendationDetail;
  if (recommendation === "pending") {
    recommendationDetail = !assessed || !pendingInScope
      ? "Évaluation à commencer : aucun critère n'est encore renseigné."
      : `${pluriel(pendingInScope, "critère des gates atteints", "critères des gates atteints")} à évaluer avant la recommandation.`;
  } else if (knockouts.length) {
    recommendationDetail = `${pluriel(knockouts.length, "knock-out actif", "knock-outs actifs")} : aucune décision favorable possible avant leur levée.`;
  } else if (recommendation === "go") recommendationDetail = `Readiness ${fnum(readiness)}/100, sans knock-out actif.`;
  else if (recommendation === "conditional") recommendationDetail = `Readiness ${fnum(readiness)}/100 : poursuite sous conditions, gaps prioritaires à combler.`;
  else recommendationDetail = `Readiness ${fnum(readiness)}/100 : dossier non instruisable en l'état.`;
  const docs = documentsStatus(dossier).filter((x) => x.required);
  const recus = docs.filter((x) => ["received", "validated"].includes(x.state)).length;
  const classification = bankability >= 80 ? "Projet bancable" : apd >= 70 ? "Prêt pour l'APD" : readiness >= 50 ? "Projet prometteur" : "Projet à structurer";
  // Suivi par compartiment (scoring.compartments) : score des critères de ses domaines, manques, études
  // renseignées, knock-outs actifs et consultant affecté (axispro.assignment).
  const compartments = (policy.compartments || []).map((k) => {
    const members = policy.domains.filter((dm) => dm.compartment_id === k.id).map((dm) => dm.id);
    const list = evals.filter((x) => members.includes(x.c.domain_id));
    const scored = list.filter((x) => x.e.status in STATUS_VALUES);
    const weight = sum(scored, (x) => x.c.weight);
    const owner = (DB.assignments || []).find((a) => a.dossier_id === dossier.id && a.compartment_id === k.id);
    return {
      compartment_id: k.id, code: k.code, name: k.name, score: weight ? (sum(scored, (x) => STATUS_VALUES[x.e.status] * x.c.weight) / weight) * 100 : null,
      criteria: list.length, assessed: list.filter((x) => x.e.status !== "not_assessed").length,
      gaps: list.filter((x) => ["partial", "not_met"].includes(x.e.status)).length, studies: list.filter((x) => x.e.deliverable).length,
      knockouts: list.filter((x) => x.c.knockout && x.e.status === "not_met").length,
      domains: policy.domains.filter((dm) => members.includes(dm.id)).map((dm) => dm.name),
      owner: owner ? { id: owner.user_id, name: userName(owner.user_id) } : null,
    };
  });
  // Décision de chaque gate : franchi avant le gate courant ; ensuite knock-out que sa règle oppose
  // (NO-GO), critères à évaluer (HOLD), score des gates atteints ; une complétude sous le minimum du
  // gate ramène à HOLD.
  const domainName = (id) => policy.domains.find((dm) => dm.id === id)?.name ?? "";
  // Knock-outs actifs que la règle de passage du gate oppose (noyau : scoring._blocking_knockouts).
  const blockingOf = (g) => {
    const rule = g.rule_code ?? "generic";
    const upToGate = (x) => gateSeq(policy, x.c.gate_id) <= g.sequence;
    if (rule === "prequalification" || rule === "generic") return knockouts.filter(upToGate);
    if (rule === "feasibility") return knockouts.filter((x) => (g.domain_ids || []).includes(x.c.domain_id) || upToGate(x));
    if (rule === "apd" || rule === "bankability") return knockouts;
    return [];
  };
  const gateRows = [...policy.gates].sort((a, b) => a.sequence - b.sequence).map((g) => {
    const inGate = evals.filter((x) => x.c.gate_id === g.id);
    const upTo = evals.filter((x) => gateSeq(policy, x.c.gate_id) <= g.sequence);
    // Un gate franchi n'est plus jugé : aucun knock-out ne lui est opposé.
    const evaluated = g.sequence >= (reached?.sequence ?? 0);
    const kos = evaluated ? blockingOf(g) : [];
    const pending = upTo.filter((x) => x.e.status === "not_assessed").length;
    let decision = "go";
    let motifs = ["Gate franchi : critères évalués, sans knock-out actif."];
    if (evaluated) {
      const scored = upTo.filter((x) => x.e.status in STATUS_VALUES);
      const w = sum(scored, (x) => x.c.weight);
      const sc = w ? (sum(scored, (x) => STATUS_VALUES[x.e.status] * x.c.weight) / w) * 100 : 0;
      if (kos.length) [decision, motifs] = ["no_go", kos.map((x) => `Knock-out actif : ${x.c.name} (${domainName(x.c.domain_id)}).`)];
      else if (pending) [decision, motifs] = ["hold", [`${pluriel(pending, "critère des gates atteints", "critères des gates atteints")} à évaluer avant la décision.`]];
      else if (sc >= policy.go_threshold) [decision, motifs] = ["go", [`Score des gates atteints ${Math.floor(sc)}/100, au moins ${policy.go_threshold}.`]];
      else if (sc >= policy.conditional_threshold) [decision, motifs] = ["conditional", [`Score des gates atteints ${Math.floor(sc)}/100, sous ${policy.go_threshold} : passage sous conditions.`]];
      else [decision, motifs] = ["hold", [`Score des gates atteints ${Math.floor(sc)}/100, sous ${policy.conditional_threshold}.`]];
      const done = upTo.length ? (upTo.filter((x) => x.e.status !== "not_assessed").length / upTo.length) * 100 : 0;
      if (g.min_completeness && decision !== "no_go" && done < g.min_completeness) {
        motifs = [`Complétude documentaire des gates atteints ${Math.floor(done)} %, minimum ${g.min_completeness} % pour examiner ce gate.`, ...(decision === "hold" ? motifs : [])];
        decision = "hold";
      }
    }
    return {
      gate_id: g.id, code: g.code, name: g.name, index: g.sequence, rule: g.rule_code ?? "generic", decision, motifs, criteria: inGate.length,
      available: inGate.filter((x) => x.e.status === "met").length, knockouts: inGate.filter((x) => x.c.knockout && x.e.status === "not_met").length,
      // Ce qui bloque ce gate : critères encore à évaluer (du gate, puis jusqu'à lui) et knock-outs actifs que sa règle oppose.
      pending: inGate.filter((x) => x.e.status === "not_assessed").length, pending_in_scope: pending, knockouts_blocking: kos.length,
      entry_requirements: g.entry_requirements ?? null, deliverables: g.deliverables ?? null, exit_criteria: g.exit_criteria ?? null, min_completeness: g.min_completeness ?? null,
    };
  });
  const nextGate = gateRows.find((g) => g.decision !== "go") ?? null;
  return {
    global_score: globalScore, readiness, apd, bankability,
    completeness: evals.length ? (assessed / evals.length) * 100 : 0,
    dataroom_completeness: docs.length ? (recus / docs.length) * 100 : 0,
    classification, recommendation_detail: recommendationDetail, method_recommendation: methodRecommendation,
    domains: domains.map((d) => ({ ...d, priority: d.score === null ? null : d.score < 30 ? "URGENTE" : d.score < 50 ? "ÉLEVÉE" : d.score < 65 ? "MOYENNE" : "FAIBLE" })),
    compartments,
    knockouts: knockouts.map((x) => ({ code: x.c.code, name: x.c.name, domain: null, gate: null })),
    knockouts_pending: 0,
    critical_open: critical.map((x) => ({ code: x.c.code, name: x.c.name, domain: null, gate: null })),
    critical_missing_excl_ko: critical.length, requalified: [], gates: gateRows, next_gate: nextGate, anomalies: [],
    proofs: 0, gaps_open: evals.filter((x) => ["not_met", "partial", "not_assessed"].includes(x.e.status)).length,
    documents_missing: docs.length - recus, pending_in_scope: pendingInScope,
    assessed, criteria: evals.length, recommendation,
    policy: { weighting: policy.weighting ?? "domain", ko_partial_blocks: Boolean(policy.ko_partial_blocks), evidence_check: Boolean(policy.evidence_check), exclude_na: policy.exclude_na !== false, expiry_check: Boolean(policy.expiry_check) },
    thresholds: { bankable: policy.threshold_bankable ?? 80, go: policy.go_threshold, conditional: policy.conditional_threshold, hold: policy.threshold_hold ?? 40, dscr: policy.dscr_target ?? 1.2 },
  };
}
function gaps(dossier, limit = 5) {
  const policy = policyById(dossier.policy_id);
  const rows = [];
  for (const e of evaluationsOf(dossier)) {
    if (!["not_met", "partial", "not_assessed"].includes(e.status)) continue;
    const c = criterionOf(policy, e.criterion_id);
    if (!c) continue;
    const domain = policy.domains.find((d) => d.id === c.domain_id);
    const missing = 1 - (STATUS_VALUES[e.status] ?? 0);
    const comp = (policy.compartments || []).find((k) => k.id === domain.compartment_id);
    rows.push({
      criterion_id: c.id, code: c.code, name: c.name, domain: domain.name, gate: policy.gates.find((g) => g.id === c.gate_id)?.code ?? null,
      compartment: comp?.code ?? null, compartment_id: comp?.id ?? null, compartment_name: comp?.name ?? null,
      status: e.status, entered: e.status, knockout: c.knockout, critical: c.critical, blocking: c.requirement_type === "blocking",
      priority: c.weight * domain.weight * missing * (c.knockout ? 3 : 1) * (c.critical ? 2 : 1), action: e.deliverable || c.guidance || `Compléter : ${c.name}`,
      responsible: e.responsible ?? null, due_date: e.due_date ?? null, has_proof: e.document_ids.length > 0, evaluation_id: e.id,
    });
  }
  return rows.sort((a, b) => Number(!(a.knockout && a.status === "not_met")) - Number(!(b.knockout && b.status === "not_met")) || b.priority - a.priority).slice(0, limit);
}
function documentsStatus(dossier) {
  const policy = policyById(dossier.policy_id);
  const currentSeq = gateSeq(policy, dossier.current_gate_id);
  return policy.documents.map((t) => {
    const latest = DB.documents.filter((d) => d.dossier_id === dossier.id && d.document_type_id === t.id).sort((a, b) => a.version - b.version).slice(-1)[0];
    return {
      document_type_id: t.id, code: t.code, name: t.name, category: t.category, required: t.required,
      due: !t.gate_id || gateSeq(policy, t.gate_id) <= currentSeq, gate: policy.gates.find((g) => g.id === t.gate_id)?.code ?? null,
      guidance: t.guidance, state: latest ? latest.state : "missing", version: latest ? latest.version : 0, document_id: latest ? latest.id : null,
    };
  });
}

const DOSSIER_DEFS = [
  { id: 1, reference: "AX/2026/0001", name: "Rizerie moderne de Kankan, 4 t/h", promoter: 161, sector: "Agro-industrie", location: "Kankan", capacity: "4 tonnes de paddy par heure, 18 000 t par an", investment: 12_400_000_000, need: 8_700_000_000, start: "2027-01-15", gate: "G4", state: "open", consultant: 21, portal: [41], quality: "go", decision: "go", opened: "2026-02-09",
    description: "Construction d'une rizerie moderne à Kankan : décorticage, blanchiment, tri optique et ensachage, alimentée par des contrats de collecte avec 1 200 riziculteurs de Haute-Guinée.",
    hypotheses: "Prix d'achat du paddy à 4 200 GNF/kg, taux d'usinage de 65 %, vente du riz blanc à 9 800 GNF/kg aux grossistes de Kankan et de Conakry." },
  { id: 2, reference: "AX/2026/0002", name: "Pêcherie artisanale et chambre froide de Kamsar", promoter: 162, sector: "Pêche", location: "Kamsar", capacity: "Chambre froide de 120 t et 14 pirogues motorisées", investment: 3_600_000_000, need: 2_500_000_000, start: "2026-12-01", gate: "G3", state: "open", consultant: 22, portal: [43], quality: "conditional", critical: 78, opened: "2026-03-02",
    description: "Équipement de 14 pirogues motorisées et construction d'une chambre froide de 120 t au débarcadère de Kamsar pour approvisionner les poissonneries de Boké et de Conakry.",
    hypotheses: "Débarquement de 2,1 t par jour en saison, prix moyen de 18 000 GNF/kg, pertes après capture ramenées de 25 % à 8 %." },
  { id: 3, reference: "AX/2026/0003", name: "Clinique mère et enfant de Labé", promoter: 163, sector: "Santé", location: "Labé", capacity: "40 lits, bloc opératoire et maternité", investment: 9_800_000_000, need: 6_200_000_000, start: "2027-06-01", gate: "G2", state: "open", consultant: 21, quality: "pending", opened: "2026-04-20",
    description: "Clinique privée de 40 lits spécialisée dans la santé de la mère et de l'enfant, avec bloc opératoire, maternité et laboratoire.", hypotheses: null },
  { id: 4, reference: "AX/2026/0004", name: "Centrale solaire hybride de 2 MWc", promoter: 164, sector: "Énergie solaire", location: "Pita", capacity: "2 MWc et stockage de 4 MWh", investment: 21_500_000_000, need: 16_000_000_000, start: "2027-03-01", gate: "G4", state: "open", consultant: 22, quality: "knockout", decision: "no_go", opened: "2026-01-19",
    description: "Centrale photovoltaïque avec stockage alimentant un mini-réseau de 3 200 abonnés et deux unités de transformation agricole.", hypotheses: "Tarif de vente de 2 950 GNF/kWh, taux de recouvrement de 92 %." },
  { id: 5, reference: "AX/2026/0005", name: "Plateforme logistique du port sec de Kagbelen", promoter: 165, sector: "Logistique", location: "Dubréka", capacity: "6 hectares, 1 200 conteneurs par mois", investment: 28_000_000_000, need: 19_500_000_000, start: "2027-09-01", gate: "G1", state: "open", consultant: 21, quality: "pending", opened: "2026-07-07",
    description: "Port sec avec aire de stockage de conteneurs, entrepôts sous douane et voie de raccordement à la route nationale.", hypotheses: null },
  { id: 6, reference: "AX/2026/0006", name: "Huilerie de palme de Forécariah", promoter: 166, sector: "Agro-industrie", location: "Forécariah", capacity: "Presse de 5 t de régimes par heure", investment: 5_200_000_000, need: 3_100_000_000, start: null, gate: "G2", state: "on_hold", consultant: 22, quality: "conditional", critical: 32, opened: "2026-03-23",
    description: "Unité de pressage d'huile de palme rouge et de palmiste, suspendue dans l'attente de la sécurisation des plantations villageoises.", hypotheses: null },
  { id: 7, reference: "AX/2025/0014", name: "Laiterie du Fouta, 3 000 litres par jour", promoter: 167, sector: "Agro-industrie", location: "Labé", capacity: "3 000 litres de lait par jour", investment: 2_900_000_000, need: 1_800_000_000, start: "2026-01-10", gate: "G7", state: "closed", consultant: 21, portal: [42], quality: "go", decision: "go", policy: 1, opened: "2025-03-10",
    description: "Collecte, pasteurisation et transformation du lait de 240 éleveurs du Fouta : lait caillé, yaourt et fromage frais.", hypotheses: "Collecte de 3 000 L par jour en saison des pluies, 1 800 L en saison sèche." },
  { id: 8, reference: "AX/2025/0011", name: "Transformation de mangues séchées de Kindia", promoter: 168, sector: "Agro-industrie", location: "Kindia", capacity: "400 t de mangues fraîches par saison", investment: 1_600_000_000, need: 1_150_000_000, start: null, gate: "G4", state: "closed", consultant: 22, quality: "weak", decision: "no_go", policy: 1, opened: "2025-02-17",
    description: "Séchage solaire et conditionnement de mangues pour l'export, projet clos après l'avis défavorable du comité.", hypotheses: null },
  { id: 9, reference: "AX/2026/0007", name: "Aquaculture en cages sur le Konkouré", promoter: 169, sector: "Pêche et aquaculture", location: "Kindia", capacity: "24 cages, 180 t de tilapia par an", investment: 2_300_000_000, need: 1_700_000_000, start: null, gate: "G0", state: "open", consultant: 23, quality: "new", opened: "2026-10-06",
    description: "Élevage de tilapia en cages flottantes sur la retenue du Konkouré, avec écloserie et provenderie.", hypotheses: null },
  { id: 10, reference: "AX/2026/0008", name: "Chaîne de froid et conditionnement de pommes de terre de Timbi-Madina", promoter: 170, sector: "Agro-industrie", location: "Pita", capacity: "Entrepôt frigorifique de 1 500 t", investment: 6_700_000_000, need: 4_600_000_000, start: "2027-02-01", gate: "G2", state: "open", consultant: 21, quality: "conditional", critical: 32, opened: "2026-05-04",
    description: "Entrepôt frigorifique, calibrage et ensachage des pommes de terre du Fouta pour étaler la mise en marché sur toute l'année.", hypotheses: "Stockage de 1 500 t sur cinq mois, perte de poids limitée à 6 %." },
  { id: 11, reference: "AX/2026/0009", name: "Extension de la rizerie : unité d'étuvage", promoter: 161, sector: "Agro-industrie", location: "Kankan", capacity: "Étuvage de 1,5 t par heure", investment: 3_100_000_000, need: 2_200_000_000, start: "2027-10-01", gate: "G1", state: "open", consultant: 21, portal: [41], quality: "pending", opened: "2026-08-18",
    description: "Unité d'étuvage du paddy adossée à la rizerie de Kankan, pour un riz étuvé à plus forte valeur ajoutée.", hypotheses: null },
];
const QUALITIES = {
  go: [["met", 86], ["partial", 11], ["not_met", 2], ["na", 1]],
  conditional: [["met", 58], ["partial", 28], ["not_met", 11], ["na", 3]],
  knockout: [["met", 62], ["partial", 25], ["not_met", 10], ["na", 3]],
  pending: [["met", 70], ["partial", 20], ["not_met", 8], ["na", 2]],
  weak: [["met", 30], ["partial", 30], ["not_met", 40]],
};
const COMMENTS = {
  met: [null, null, "Conforme, pièce vérifiée.", "Satisfaisant au vu des justificatifs.", "Confirmé lors de la visite du site."],
  partial: ["Justificatif incomplet : à compléter par le porteur.", "Hypothèse plausible mais non documentée.", "Partiellement couvert, à préciser avant le comité."],
  not_met: ["Non démontré à ce stade.", "Pièce absente malgré deux relances.", "Écart important avec les références du secteur."],
  na: ["Sans objet pour ce projet."],
};
const PROOF_DOCS = { 1: 1, 3: 7, 4: 4, 10: 8, 13: 13, 21: 30, 26: 10, 33: 21, 43: 27, 47: 5, 48: 11, 49: 24, 55: 22, 69: 17, 75: 25, 77: 20, 79: 29, 85: 28, 105: 6, 106: 26, 107: 27 };
const WORKS = [
  "Analyse de la note de présentation et premier entretien", "Visite du site et entretien avec le promoteur", "Analyse de l'étude de marché",
  "Revue des comptes prévisionnels", "Évaluation des critères du gate", "Relecture des statuts et du pacte d'associés",
  "Échanges avec la banque sur la structure du financement", "Préparation du dossier de comité", "Rédaction du rapport d'évaluation",
  "Contrôle des pièces de la data room", "Atelier de modélisation financière avec le promoteur",
];

function seedAxispro() {
  const r = makeRng("axispro");
  DB.policies = [
    buildPolicy(1, 1, "archived", "2025-09-01", 70, 50, POLICY_NOTES),
    buildPolicy(2, 2, "active", "2026-02-02", 70, 50, POLICY_NOTES),
    buildPolicy(3, 3, "draft", null, 72, 52, `${POLICY_NOTES} Version 3 en préparation : seuils relevés de deux points et poids renforcé du critère de couverture du service de la dette.`),
  ];
  IDS.evaluation = 10000;
  DB.feeInvoices = [];
  for (const def of DOSSIER_DEFS) {
    const policy = policyById(def.policy ?? 2);
    const gate = policy.gates.find((g) => g.code === def.gate);
    const dossier = {
      id: def.id, reference: def.reference, name: def.name, company_id: 2, policy_id: policy.id, promoter_id: def.promoter,
      portal_user_ids: [...(def.portal || [])], consultant_id: def.consultant, sector: def.sector, location: def.location, capacity: def.capacity,
      investment: def.investment, financing_need: def.need, date_start: def.start, description: def.description, hypotheses: def.hypotheses,
      current_gate_id: gate.id, state: def.state, decision: def.decision ?? null, opened: def.opened,
    };
    DB.dossiers.push(dossier);
    const consultant = userName(def.consultant);
    const span = Math.max(1, daysBetween(def.opened, def.state === "closed" ? addMonths(def.opened, 9) : TODAY));
    for (const c of policy.criteria) {
      const seq = gateSeq(policy, c.gate_id);
      let status = "not_assessed";
      if (def.quality !== "new") {
        const assess = seq < gate.sequence || (seq === gate.sequence && (def.quality !== "pending" || r.chance(0.55)));
        if (assess) status = r.weighted(QUALITIES[def.quality] || QUALITIES.pending);
        if (assess && (c.knockout || (c.critical && def.quality === "go"))) status = "met";
      }
      if (def.critical && c.number === def.critical) status = "not_met";
      if (def.quality === "knockout" && c.number === 48) status = "not_met";
      const ev = {
        id: ++IDS.evaluation, dossier_id: dossier.id, criterion_id: c.id, status, comment: status === "not_assessed" ? null : r.pick(COMMENTS[status]),
        document_ids: [], deliverable: ["partial", "not_met"].includes(status) && c.number % 3 !== 1 ? `Étude complémentaire : ${c.name.charAt(0).toLowerCase()}${c.name.slice(1)}` : null,
        responsible: null, due_date: null, assessed_by: status === "not_assessed" ? null : def.consultant,
        assessed_at: status === "not_assessed" ? null : stamp(addDays(def.opened, Math.min(span - 1, Math.round((seq / 8) * span) + r.int(0, 20))), r.int(8, 17), r.int(0, 59)),
      };
      if (def.quality === "knockout" && c.number === 48) ev.comment = "Le terrain de Pita relève d'un domaine coutumier sans titre ni bail notarié : critère éliminatoire non satisfait.";
      DB.evaluations.push(ev);
    }
    // Data room : pièces dues jusqu'au gate courant.
    if (def.quality !== "new") {
      const porteur = def.portal?.[0] ?? null;
      for (const t of policy.documents) {
        const seq = t.gate_id ? gateSeq(policy, t.gate_id) : gate.sequence;
        if (seq > gate.sequence || (!t.gate_id && !r.chance(0.4))) continue;
        let state = seq < gate.sequence ? (r.chance(0.92) ? "validated" : "received") : r.weighted([["received", 6], ["validated", 2], ["missing", 2]]);
        if (!t.required && r.chance(0.4)) state = "missing";
        if (def.quality === "knockout" && t.number === 11) state = "missing";
        if (state === "missing") continue;
        const at = stamp(addDays(def.opened, Math.min(span - 1, Math.round(((seq + 0.5) / 8) * span) + r.int(0, 10))), r.int(8, 21), r.int(0, 59));
        const mimetype = t.number === 1 ? "image/jpeg" : t.number === 17 ? XLSX : t.number === 16 ? DOCX : "application/pdf";
        const doc = (version, st, comment, when, by) => ({
          id: newId("document"), dossier_id: dossier.id, document_type_id: t.id, name: t.name, version, state: st, comment,
          uploaded_by: by, uploaded_at: when, mimetype, size: r.int(80, 6200) * 1024, portal_visible: true,
          filename: `${slug(t.name)}-v${version}${EXTENSIONS[mimetype]}`,
        });
        const by = porteur && r.chance(0.7) ? porteur : def.consultant;
        if ((def.id === 1 && t.number === 20) || (def.id === 2 && t.number === 17)) {
          DB.documents.push(doc(1, "rejected", def.id === 1 ? "Relevé illisible : merci de fournir l'original remis par la banque." : "Hypothèses de prix du poisson non sourcées : joindre les relevés de la criée.", at, by));
          if (def.id === 1) DB.documents.push(doc(2, "validated", null, stamp("2026-09-05", 10, 2), porteur));
          continue;
        }
        DB.documents.push(doc(1, state, null, at, by));
      }
      if (def.id === 1) {
        DB.documents.push({ id: newId("document"), dossier_id: 1, document_type_id: null, name: "Note interne d'analyse de crédit", version: 1, state: "received", comment: null, uploaded_by: 22, uploaded_at: "2026-09-20T18:05:00Z", mimetype: DOCX, size: 412 * 1024, portal_visible: false, filename: "note-interne-analyse-credit.docx" });
      }
    }
    // Preuves jointes aux critères qui en exigent une.
    for (const ev of evaluationsOf(dossier)) {
      const c = criterionOf(policy, ev.criterion_id);
      if (!c.evidence_required || !["met", "partial"].includes(ev.status)) continue;
      const typeId = PROOF_DOCS[c.number] ? policy.documents.find((d) => d.number === PROOF_DOCS[c.number])?.id : null;
      const files = DB.documents.filter((d) => d.dossier_id === dossier.id && d.state !== "rejected");
      const proof = files.find((d) => d.document_type_id === typeId) || files[0];
      if (proof) ev.document_ids = [proof.id];
    }
    // Temps passés, facturés par trimestre ; forfaits d'évaluation à chaque gate franchi.
    const end = def.state === "closed" ? addMonths(def.opened, 9) : TODAY;
    let d = addDays(def.opened, 2);
    const staff = [def.consultant, def.consultant === 21 ? 22 : 21, 23];
    while (d <= end && def.quality !== "new") {
      DB.timesheets.push({ id: newId("timesheet"), dossier_id: dossier.id, user_id: r.weighted([[staff[0], 6], [staff[1], 3], [staff[2], 1]]), date: d, hours: r.int(3, 15) / 2, description: r.pick(WORKS), billable: r.chance(0.9), invoice_id: null });
      d = addDays(d, r.int(6, 16));
    }
    if (def.quality === "new") {
      DB.timesheets.push({ id: newId("timesheet"), dossier_id: dossier.id, user_id: 23, date: "2026-10-08", hours: 3.5, description: "Analyse de la note de présentation et premier entretien", billable: true, invoice_id: null });
    }
    const factor = Math.min(1.6, Math.max(0.7, def.need / 5e9));
    const gateFees = [60, 85, 120, 150, 190, 0, 0, 0];
    for (let k = 0; k < gate.sequence; k++) {
      const date = addDays(def.opened, 12 + k * 38);
      if (date > addDays(TODAY, -5) || !gateFees[k]) continue;
      DB.feeInvoices.push({ dossier_id: dossier.id, date, lines: [{ name: `Forfait d'évaluation ${policy.gates[k].code} : ${policy.gates[k].name.toLowerCase()} (${def.reference})`, quantity: 1, price_unit: roundTo(gateFees[k] * 1e6 * factor, 500000) }] });
    }
    const billable = DB.timesheets.filter((t) => t.dossier_id === dossier.id && t.billable);
    for (const quarterEnd of ["2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-08-31"]) {
      const batch = billable.filter((t) => !t.billed && t.date <= quarterEnd && t.date > addMonths(quarterEnd, -3));
      if (!batch.length || quarterEnd > TODAY) continue;
      for (const t of batch) t.billed = true;
      const lines = [...groupBy(batch, (t) => t.user_id)].map(([uid, list]) => {
        const hours = sum(list, (t) => t.hours);
        return { name: `Honoraires ${def.reference} - ${def.name} - ${userName(uid)} (${hours} h)`, quantity: hours, price_unit: 650000 };
      });
      DB.feeInvoices.push({ dossier_id: dossier.id, date: quarterEnd, lines, timesheetIds: batch.map((t) => t.id) });
    }
  }
  for (const t of DB.timesheets) delete t.billed;

  // Équipe des dossiers ouverts sur une grille à compartiments : compartiments confiés aux consultants.
  // C1 et C4 restent à affecter ; l'aquaculture du Konkouré, tout juste reçue, n'a pas encore d'équipe.
  DB.assignments = [];
  for (const dossier of DB.dossiers.filter((x) => x.state !== "closed" && x.id !== 9)) {
    const lead = dossier.consultant_id;
    const plan = { C0: lead, C2: 23, C3: lead === 21 ? 22 : 21, C5: lead, C6: lead, C7: lead === 21 ? 22 : 21 };
    for (const k of policyById(dossier.policy_id).compartments || []) {
      if (plan[k.code]) DB.assignments.push({ dossier_id: dossier.id, compartment_id: k.id, user_id: plan[k.code] });
    }
  }

  // Comités : instantanés de l'évaluation conservés avec chaque décision.
  const snapshot = (dossier, shift) => {
    const s = scoring(dossier);
    const domains = s.domains.map((x) => ({ ...x, score: x.score === null ? null : Math.max(0, Math.min(100, x.score + shift)) }));
    const weighted = domains.filter((x) => x.score !== null);
    const global = weighted.length ? sum(weighted, (x) => x.score * x.weight) / sum(weighted, (x) => x.weight) : null;
    return { ...s, domains, global_score: global };
  };
  const review = (dossierId, date, gateCode, decision, state, members, conditions, minutes, shift, lockedBy) => {
    const dossier = DB.dossiers.find((x) => x.id === dossierId);
    const policy = policyById(dossier.policy_id);
    const snap = snapshot(dossier, shift);
    DB.reviews.push({
      id: newId("review"), dossier_id: dossierId, date, gate_id: policy.gates.find((g) => g.code === gateCode).id, members, decision, conditions, minutes,
      snapshot: snap, recommendation: snap.recommendation === "pending" ? "conditional" : snap.recommendation, state, locked_by: state === "locked" ? lockedBy : null,
      locked_at: state === "locked" ? stamp(date, 18, 30) : null, policy_version: policy.version,
    });
  };
  const committee = "Saïdou Barry (président), Thierno Diallo, Aïssatou Barry, Kadiatou Sylla";
  review(1, "2026-06-18", "G3", "conditional", "locked", committee, "Justifier l'apport personnel par un relevé original ; compléter les contrats de collecte du paddy.", "Le comité relève la solidité du marché et demande la preuve de l'apport avant la due diligence bancaire.", -9, 22);
  review(1, "2026-09-24", "G4", "go", "locked", committee, "Assurance multirisque des équipements avant le premier décaissement ; domiciliation des recettes à la banque prêteuse.", "Avis favorable à l'unanimité. Le dossier sera présenté à deux banques de la place.", 0, 21);
  review(2, "2026-08-27", "G3", "postponed", "draft", "Saïdou Barry (président), Thierno Diallo, Aminata Keïta", null, "Décision ajournée : le plan de financement doit intégrer la contrepartie du fonds de garantie.", -2, null);
  review(4, "2026-07-09", "G4", "no_go", "locked", committee, null, "Critère éliminatoire : le site de Pita n'est couvert ni par un titre foncier ni par un bail notarié.", -1, 22);
  review(7, "2025-05-14", "G3", "conditional", "locked", "Saïdou Barry (président), Aïssatou Barry, Thierno Diallo", "Signature des contrats de collecte avec deux coopératives d'éleveurs.", "Projet pertinent, collecte à sécuriser.", -11, 21);
  review(7, "2025-11-20", "G5", "go", "locked", "Saïdou Barry (président), Aïssatou Barry, Thierno Diallo, Kadiatou Sylla", "Domiciliation des recettes et suivi trimestriel de la collecte.", "Financement accordé par le fonds de garantie agricole et une banque partenaire.", 0, 21);
  review(8, "2025-10-02", "G4", "no_go", "locked", "Saïdou Barry (président), Thierno Diallo", null, "Marge insuffisante à l'export et absence de contrat d'achat ferme.", 0, 22);

  const msg = (dossierId, at, author, body, internal = false) =>
    DB.messages.push({ id: newId("message"), dossier_id: dossierId, author_id: author, from_promoter: userById(author)?.profiles.includes("porteur") ?? false, body, date: at, internal });
  msg(1, "2026-09-02T09:14:00Z", 21, "Bonjour Monsieur Sow, merci de déposer à nouveau le justificatif de votre apport personnel : le relevé transmis est illisible.");
  msg(1, "2026-09-03T18:40:00Z", 41, "Bonsoir, je passe à la banque demain matin et je dépose l'original numérisé.");
  msg(1, "2026-09-05T10:02:00Z", 41, "C'est fait, la nouvelle version est dans la data room.");
  msg(1, "2026-09-05T15:30:00Z", 21, "Relevé conforme : apport confirmé à 2,6 milliards de GNF, soit 21 % du programme.", true);
  msg(1, "2026-09-25T11:00:00Z", 21, "Le comité du 24 septembre a rendu un avis favorable. Nous préparons la présentation du dossier aux banques.");
  msg(1, "2026-10-11T20:03:00Z", 41, "Merci beaucoup. Quand pourrons-nous rencontrer la banque ?");
  msg(2, "2026-08-28T09:30:00Z", 22, "Monsieur Camara, le comité a ajourné sa décision. Il faut revoir le plan de financement avec la contrepartie du fonds de garantie.");
  msg(2, "2026-08-29T12:15:00Z", 43, "Bien reçu. Le fonds nous demande les comptes prévisionnels mis à jour, je les envoie cette semaine.");
  msg(2, "2026-10-09T18:27:00Z", 43, "Les nouveaux comptes prévisionnels sont prêts, mais le fichier fait plus de 20 Mo. Puis-je l'envoyer en deux parties ?");
  msg(2, "2026-10-10T08:45:00Z", 22, "Oui, ou bien enregistrez-le au format Excel sans les graphiques.");
  msg(3, "2026-09-14T16:20:00Z", 21, "Visite du terrain prévue le 22 septembre avec le médecin promoteur.", true);
  msg(4, "2026-07-10T10:00:00Z", 22, "Le promoteur conteste l'avis : il propose un bail emphytéotique avec la communauté. À examiner pour une nouvelle présentation.", true);
  msg(10, "2026-09-30T11:40:00Z", 21, "Bonjour, les devis de l'équipement frigorifique sont attendus avant le passage au gate G3.");

  DB.policies.forEach((p) => {
    p.criteriaCount = p.criteria.length;
  });
}

/* ─── Administration : piste d'audit et journal des accès ───────────────── */

function seedAdmin() {
  const r = makeRng("audit");
  const entries = [
    ["2026-10-15T08:40:12Z", 5, "account.move", "Pièce comptable", "VTE/2026/00187", "write", [["Date d'échéance", "30/09/2026", "15/10/2026"], ["Référence", "", "BC-2026-118"]]],
    ["2026-10-15T08:12:55Z", 2, "res.users", "Utilisateur", "Aminata Keïta", "write", [["Profils", "", "Cabinet AxisPro"], ["Mot de passe provisoire", "Non", "Oui"]]],
    ["2026-10-14T17:58:02Z", 9, "res.partner", "Contact", "Boulangerie Moderne de Kipé (démo)", "write", [["Téléphone", "+224 620 11 22 33", "+224 624 40 52 34"]]],
    ["2026-10-14T16:41:20Z", 6, "account.payment", "Paiement", "PAY/2026/00184", "create", [["Montant", null, "412 000 000"], ["Journal", null, "Banque du Golfe, compte courant"], ["Tiers", null, "Carburants de la Presqu'île (démo)"]]],
    ["2026-10-14T11:03:47Z", 5, "account.move", "Pièce comptable", "Brouillon n° 1186", "unlink", []],
    ["2026-10-13T15:22:10Z", 2, "account.account", "Compte", "604200 Matières combustibles (gasoil des ensembles)", "write", [["Nom", "Achats de carburant", "Matières combustibles (gasoil des ensembles)"]]],
    ["2026-10-13T09:01:33Z", 2, "account.move", "Pièce comptable", "LEK-2026-118", "create", [["Tiers", null, "Location d'Engins de Chantier Kagbelen (démo)"], ["Montant total", null, "84 960 000"]]],
    ["2026-10-12T10:15:08Z", 11, "account.move", "Pièce comptable", "FC-2026-1187", "write", [["Montant hors taxes", "305 900 000", "318 400 000"]]],
    ["2026-10-09T09:40:41Z", 6, "account.move", "Pièce comptable", "PP-2026-0934", "write", [["Validation niveau 1", "En attente", "Approuvée"]]],
    ["2026-10-08T14:02:19Z", 2, "res.partner", "Contact", "Mines d'Or du Haut Niger (démo)", "write", [["Limite de crédit", "2 000 000 000", "1 800 000 000"]]],
    ["2026-10-07T12:31:50Z", 5, "account.move.line", "Écriture comptable", "OD/2026/00191", "write", [["Compte", "471000", "411100"]]],
    ["2026-10-06T16:05:12Z", 2, "account.move", "Pièce comptable", "CFC-2026-1544", "write", [["Validation niveau 1", "En attente", "Refusée"]]],
    ["2026-10-02T08:31:05Z", 5, "account.move", "Pièce comptable", "AGG-2026-Q4-0071", "create", [["Tiers", null, "Assurances du Golfe de Guinée (démo)"], ["Montant total", null, "294 000 000"]]],
    ["2026-09-30T18:20:44Z", 5, "account.move", "Pièce comptable", "OD/2026/00189", "create", [["Libellé", null, "Dotations aux amortissements de septembre 2026"]]],
    ["2026-09-26T17:40:03Z", 2, "account.move", "Pièce comptable", "ACH/2026/00498", "write", [["État", "Brouillon", "Comptabilisée"]]],
    ["2026-09-18T10:12:36Z", 2, "res.users", "Utilisateur", "Ismaël Bangoura", "write", [["Actif", "Oui", "Non"]]],
    ["2026-09-12T11:44:28Z", 6, "account.move", "Pièce comptable", "VTE/2026/00171", "write", [["État", "Comptabilisée", "Annulée"]]],
    ["2026-09-08T09:27:15Z", 5, "account.move", "Pièce comptable", "RVTE/2026/00007", "create", [["Tiers", null, "Bauxite Atlantique Kamsar (démo)"], ["Montant total", null, "21 712 000"]]],
    ["2026-09-03T15:51:39Z", 9, "res.partner", "Contact", "Boulangerie Moderne de Kipé (démo)", "create", [["Nom", null, "Boulangerie Moderne de Kipé (démo)"], ["Ville", null, "Conakry"]]],
    ["2026-08-31T19:05:00Z", 5, "account.move", "Pièce comptable", "OD/2026/00172", "create", [["Libellé", null, "Provision pour litige, Ciments du Rio Pongo (démo)"]]],
    ["2026-08-20T08:16:22Z", 2, "res.users", "Utilisateur", "Djénabou Touré", "write", [["Sociétés", "EGUITRA GROUP SARLU", "EGUITRA GROUP SARLU"], ["Profils", "Exploitation transport", "Exploitation transport"]]],
    ["2026-08-11T13:37:51Z", null, "res.partner", "Contact", "Société des Eaux de Mamou (démo)", "write", [["Courriel", "", "contact@societe-des-eaux-de-mamou.example"]]],
  ];
  DB.audit = entries.map(([date, user, model_code, model, record, method, lines], i) => ({
    id: 9000 - i, date, user: user ? userName(user) : null, model, model_code, res_id: 1000 + r.int(1, 900), record, method,
    lines: lines.map(([field, old, value]) => ({ field, old, new: value })),
  }));
  const paths = [
    ["GET", "/api/v1/finance/dashboard", "finance", 2, 200], ["GET", "/api/v1/finance/treasury", "finance", 6, 200], ["GET", "/api/v1/finance/moves", "finance", 5, 200],
    ["POST", "/api/v1/transport/sync", "mobile", 12, 200], ["GET", "/api/v1/transport/referentials", "mobile", 12, 200], ["GET", "/api/v1/axispro/dossiers", "axispro", 21, 200],
    ["PATCH", "/api/v1/axispro/evaluations/10412", "axispro", 22, 200], ["GET", "/api/v1/portail/dossiers", "portail", 41, 200], ["POST", "/api/v1/auth/login", "finance", null, 401],
    ["GET", "/api/v1/finance/closing", "finance", 5, 200], ["POST", "/api/v1/approvals/315/approve", "finance", 6, 200], ["GET", "/api/v1/admin/users", "finance", 2, 200],
    ["GET", "/api/v1/finance/dashboard", "finance", 11, 403], ["POST", "/api/v1/auth/login", "portail", null, 429], ["POST", "/api/v1/finance/moves", "finance", 5, 422],
  ];
  const ips = ["10.20.4.15", "10.20.4.22", "10.20.4.31", "198.51.100.24", "203.0.113.57", "192.0.2.140"];
  for (let i = 0; i < 70; i++) {
    const [method, path, app, user, status] = r.pick(paths);
    const t = Date.parse("2026-10-15T09:30:00Z") - i * r.int(9, 41) * 60000;
    DB.accessLog.push({ date: `${new Date(t).toISOString().slice(0, 19)}Z`, user: user ? userName(user) : null, method, path, status, duration_ms: r.int(18, 640), ip: user === 12 || user === 41 ? r.pick(ips.slice(3)) : r.pick(ips.slice(0, 3)), app });
  }
}

/* ─── Calage du bilan et ordre de génération ────────────────────────────── */

/** Clients et fournisseurs au bilan rejoignent les pièces ouvertes ; le report à nouveau fixe la trésorerie du jour. */
function calibrate() {
  for (const cid of COMPANY_IDS) {
    const p = BS[cid];
    p.ran0 = 0;
    const rev = revenueBetween([cid], addDays(TODAY, -40), TODAY);
    const pur = purchasesBetween([cid], addDays(TODAY, -35), TODAY);
    p.kR = rev > 0 ? openItems([cid], "receivable", TODAY).total / (1.18 * rev) : 0;
    p.kP = pur > 0 ? openItems([cid], "payable", TODAY).total / (1.18 * pur) : 0;
    p.ran0 = p.cashTarget - classFive(balancesAt(cid, TODAY));
  }
}

function seed() {
  seedLoans();
  seedTransport();
  seedProprietaires(DB);
  seedChantiers();
  seedImmobilier();
  buildLedger();
  seedAxispro();
  seedAnalytic();
  seedMoves();
  seedStatementLines();
  seedApprovals();
  seedReminders();
  seedAssets();
  seedBudgets();
  seedClosings();
  seedThresholds();
  seedAdmin();
  calibrate();
  seedHsseq();
}

/* ════════════════════════════════════════════════════════════════════════════
 * Routes
 * ══════════════════════════════════════════════════════════════════════════ */

const ROUTES = [];
/** Segments nommés d'une route : `:action` (mot), `:month` (AAAA-MM), `:slug` (code) ; tout autre est un identifiant. */
const SEGMENTS = { ":action": "([a-z_-]+)", ":month": "(\\d{4}-\\d{2})", ":slug": "([A-Za-z0-9_.-]+)" };
function route(method, pattern, profiles, handler, options = {}) {
  const regex = new RegExp(
    `^${pattern
      .split("/")
      .map((seg) => (seg.startsWith(":") ? (SEGMENTS[seg] ?? "(\\d+)") : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join("/")}$`,
  );
  ROUTES.push({ method, pattern, regex, profiles, handler, public: Boolean(options.public) });
}
const reply = (status, body) => ({ __status: status, __body: body });
const fileReply = (data, contentType, filename) => ({ __file: true, data, contentType, filename });
const FIN_READ = ["admin", "direction", "finance"];
const FIN_WRITE = ["admin", "finance"];
const PICKERS = ["exploitation", "chantiers", "immobilier", "cabinet"];
const TR_READ = ["admin", "direction", "finance", "exploitation"];
const TR_WRITE = ["admin", "finance", "exploitation"];
const CH_READ = ["admin", "direction", "finance", "chantiers"];
const CH_WRITE = ["admin", "finance", "chantiers"];
const IM_READ = ["admin", "direction", "finance", "immobilier"];
const IM_WRITE = ["admin", "finance", "immobilier"];
const AX_READ = ["admin", "direction", "cabinet"];
const AX_WRITE = ["cabinet"];
const ADMIN = ["admin"];
/** Sociétés couvertes : la société de travail, ou tout le groupe si scope=group. */
const scopeCompanies = (ctx, src = ctx.query) => (src.scope === "group" ? [...ctx.user.companies] : [ctx.company]);
const hasProfile = (ctx, list) => ctx.user.profiles.some((p) => list.includes(p));
const inCompanies = (ctx, cid) => ctx.user.companies.includes(cid);
const limitOf = (q, def, max) => intArg(q, "limit", def, 1, max);
const offsetOf = (q) => intArg(q, "offset", 0, 0);

/* ─── Authentification ──────────────────────────────────────────────────── */

const randomPart = () => crypto.randomBytes(12).toString("hex");
function publicUser(user, companyId = null) {
  return {
    id: user.id, name: user.name, login: user.login, email: user.email ?? null, profiles: sortProfiles(user.profiles), apps: webAppsFor(user.profiles),
    company_id: companyId ?? user.company_id, companies: [...user.companies].sort((a, b) => a - b).map((id) => ({ id, name: COMPANIES[id].name, entity: COMPANIES[id].entity })),
    mfa_enabled: Boolean(user.mfa), password_change_required: passwordTemporary(user), lang: "fr_FR", tz: "Africa/Conakry",
  };
}
function sessionTokens(login) {
  const enc = encodeURIComponent(login);
  return {
    status: "ok", access_token: `a.${enc}.${randomPart()}`, access_expires_in: 900, refresh_token: `r.${enc}.${randomPart()}`, refresh_expires_in: 43200,
    user: publicUser(sessionUser(login)),
  };
}
function tokenLogin(token, prefix) {
  if (typeof token !== "string" || !token.startsWith(`${prefix}.`)) return null;
  const rest = token.slice(prefix.length + 1);
  const i = rest.lastIndexOf(".");
  if (i <= 0) return null;
  try {
    return decodeURIComponent(rest.slice(0, i));
  } catch {
    return null;
  }
}
function totpCode(code) {
  const digits = String(code).replace(/ /g, "");
  if (!/^\d{6}$/.test(digits)) throw new ApiError(400, "invalid_code", "Le code comporte 6 chiffres.");
  return digits;
}

route("POST", "/auth/login", null, (ctx) => {
  const [rawLogin, password, app] = requireFields(ctx.body, "login", "password", "app");
  const login = String(rawLogin).trim().toLowerCase();
  if (!APPS.includes(app)) throw new ApiError(400, "invalid_app", "Application inconnue.");
  if (String(password) === "faux") return reply(401, { error: "invalid_credentials", message: "Identifiant ou mot de passe incorrect." });
  const user = sessionUser(login);
  if (!appsFor(user.profiles).includes(app)) throw new ApiError(403, "app_forbidden", "Votre profil ne donne pas accès à cette application.");
  if (login === "mfa") return { status: "mfa_required", mfa_token: `m.${randomPart()}` };
  if (login === "activation") {
    return {
      status: "mfa_setup_required", setup_token: `s.${randomPart()}`, secret: "JBSW Y3DP EHPK 3PXP",
      otpauth_uri: "otpauth://totp/NIMOVA:activation?secret=JBSWY3DPEHPK3PXP&issuer=NIMOVA",
    };
  }
  return sessionTokens(login);
}, { public: true });

route("POST", "/auth/mfa", null, (ctx) => {
  const [token, code] = requireFields(ctx.body, "mfa_token", "code");
  if (!String(token).startsWith("m.")) throw new ApiError(401, "invalid_token", "Étape expirée : reconnectez-vous.");
  if (totpCode(code) === "000000") return reply(401, { error: "invalid_code", message: "Code incorrect." });
  return sessionTokens("mfa");
}, { public: true });

route("POST", "/auth/mfa/setup", null, (ctx) => {
  const [token, code] = requireFields(ctx.body, "setup_token", "code");
  if (!String(token).startsWith("s.")) throw new ApiError(401, "invalid_token", "Étape expirée : reconnectez-vous.");
  if (totpCode(code) === "000000") return reply(401, { error: "invalid_code", message: "Code incorrect." });
  return sessionTokens("activation");
}, { public: true });

route("POST", "/auth/refresh", null, (ctx) => {
  const [raw] = requireFields(ctx.body, "refresh_token");
  const login = tokenLogin(String(raw), "r");
  if (!login || DB.revokedRefresh.has(String(raw))) throw new ApiError(401, "invalid_token", "Session expirée.");
  return sessionTokens(login);
}, { public: true });

route("POST", "/auth/logout", null, (ctx) => {
  if (ctx.body.refresh_token) DB.revokedRefresh.add(String(ctx.body.refresh_token));
  return { status: "ok" };
}, { public: true });

route("GET", "/auth/me", null, (ctx) => publicUser(ctx.user, ctx.company));

route("POST", "/auth/password", null, (ctx) => {
  const [oldPassword, newPassword] = requireFields(ctx.body, "old_password", "new_password");
  if (String(oldPassword) === "faux") return reply(401, { error: "invalid_credentials", message: "Mot de passe actuel incorrect." });
  if (oldPassword === newPassword) throw businessRule("Le nouveau mot de passe doit être différent.");
  if (ctx.user.temp) DB.passwordChanged.add(ctx.user.id);
  return { status: "ok", message: "Mot de passe modifié. Reconnectez-vous." };
});

route("GET", "/health", null, () => ({ status: "ok", database: "maquette" }), { public: true });

/* ─── Administration ────────────────────────────────────────────────────── */

function userRow(u) {
  return { ...publicUser(u), active: u.active, last_login: u.last_login };
}
function adminUser(ctx, id) {
  const u = userById(id);
  if (!u || u.companies.some((c) => !inCompanies(ctx, c))) throw notFound("Utilisateur introuvable.");
  return u;
}
function applyUser(ctx, u, data) {
  if ("name" in data) u.name = String(data.name || u.name);
  if ("email" in data) u.email = data.email || null;
  if ("active" in data) u.active = Boolean(data.active);
  if ("company_ids" in data) {
    const ids = (data.company_ids || []).map(Number);
    if (!ids.length || ids.some((c) => !inCompanies(ctx, c))) throw businessRule("Sociétés invalides.");
    u.companies = ids;
    u.company_id = Number(data.company_id) || ids[0];
  }
  if ("profiles" in data) {
    const profiles = [...(data.profiles || [])];
    const unknown = profiles.filter((p) => !PROFILE_DEFS.some((d) => d.code === p));
    if (unknown.length) throw businessRule(`Profils inconnus : ${unknown.sort().join(", ")}`);
    if (profiles.includes("porteur") && profiles.length > 1) throw businessRule("Le profil porteur de projet ne se combine avec aucun autre.");
    u.profiles = profiles.includes("admin") ? [...new Set([...profiles, "direction", "finance"])] : profiles;
  }
}
route("GET", "/admin/profiles", ADMIN, () => PROFILE_DEFS);
route("GET", "/admin/users", ADMIN, (ctx) => {
  const search = (ctx.query.search || "").toLowerCase();
  return USERS.filter((u) => u.companies.every((c) => inCompanies(ctx, c)))
    .filter((u) => !search || u.name.toLowerCase().includes(search) || u.login.includes(search))
    .sort((a, b) => byFr(a.name, b.name))
    .slice(offsetOf(ctx.query), offsetOf(ctx.query) + limitOf(ctx.query, 200, 500))
    .map(userRow);
});
route("POST", "/admin/users", ADMIN, (ctx) => {
  const [name, login, , profiles] = requireFields(ctx.body, "name", "login", "password", "profiles");
  const clean = String(login).trim().toLowerCase();
  if (USERS.some((u) => u.login === clean) || SPECIAL_LOGINS[clean]) throw new ApiError(409, "conflict", "Cet identifiant existe déjà.");
  const user = { id: newId("user"), login: clean, name: String(name), email: ctx.body.email || null, profiles: [], companies: [ctx.company], company_id: ctx.company, mfa: false, active: true, temp: true, last_login: null };
  applyUser(ctx, user, { profiles, ...(ctx.body.company_ids ? { company_ids: ctx.body.company_ids, company_id: ctx.body.company_id } : {}) });
  USERS.push(user);
  return userRow(user);
});
route("GET", "/admin/users/:id", ADMIN, (ctx) => userRow(adminUser(ctx, ctx.params[0])));
route("PATCH", "/admin/users/:id", ADMIN, (ctx) => {
  const u = adminUser(ctx, ctx.params[0]);
  if (u.id === ctx.user.id && ("active" in ctx.body || "profiles" in ctx.body)) throw businessRule("Vous ne pouvez pas modifier vos propres profils ni vous désactiver.");
  applyUser(ctx, u, ctx.body);
  return userRow(u);
});
route("POST", "/admin/users/:id/password", ADMIN, (ctx) => {
  const u = adminUser(ctx, ctx.params[0]);
  requireFields(ctx.body, "password");
  u.temp = true;
  DB.passwordChanged.delete(u.id);
  return { status: "ok" };
});
route("POST", "/admin/users/:id/reset-mfa", ADMIN, (ctx) => {
  adminUser(ctx, ctx.params[0]).mfa = false;
  return { status: "ok" };
});
route("GET", "/admin/access-log", ADMIN, (ctx) => {
  let rows = [...DB.accessLog].sort((a, b) => b.date.localeCompare(a.date));
  if (ctx.query.status_min) rows = rows.filter((r) => r.status >= intArg(ctx.query, "status_min"));
  return rows.slice(offsetOf(ctx.query), offsetOf(ctx.query) + limitOf(ctx.query, 200, 1000));
});
route("GET", "/admin/audit", ADMIN, (ctx) => {
  let rows = DB.audit;
  if (ctx.query.model) rows = rows.filter((a) => a.model_code === ctx.query.model);
  if (ctx.query.res_id) rows = rows.filter((a) => a.res_id === intArg(ctx.query, "res_id"));
  return rows.slice(offsetOf(ctx.query), offsetOf(ctx.query) + limitOf(ctx.query, 100, 500));
});
const COMPANY_FIELDS = ["name", "street", "street2", "zip", "city", "phone", "email", "website", "vat", "company_registry"];
const companyRow = (c) => ({ ...Object.fromEntries(COMPANY_FIELDS.map((f) => [f, c[f] || null])), id: c.id, entity: c.entity, currency: c.currency, country: c.country, logo: c.logo });
route("GET", "/admin/companies", ADMIN, (ctx) => [...ctx.user.companies].sort((a, b) => a - b).map((id) => companyRow(COMPANIES[id])));
route("PATCH", "/admin/companies/:id", ADMIN, (ctx) => {
  const c = COMPANIES[ctx.params[0]];
  if (!c || !inCompanies(ctx, c.id)) throw notFound("Société introuvable.");
  const data = ctx.body;
  if ("name" in data && !String(data.name ?? "").trim()) throw businessRule("La raison sociale est obligatoire.");
  if ("logo" in data && data.logo) {
    const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(String(data.logo));
    if (!String(data.logo).startsWith("data:") || !String(data.logo).includes(";base64,")) throw businessRule("Logo illisible : envoyer une image PNG ou JPEG.");
    if (!m) throw new ApiError(415, "unsupported_type", "Logo au format PNG ou JPEG seulement.");
    if (Buffer.from(m[2], "base64").length > 1024 * 1024) throw new ApiError(413, "too_large", "Logo trop volumineux (1 Mo au plus).");
  }
  for (const f of COMPANY_FIELDS) if (f in data) c[f] = data[f] === null ? null : String(data[f]).trim() || null;
  if ("logo" in data) c.logo = data.logo || null;
  return companyRow(c);
});

/* ─── Tableau de bord, alertes, états, pilotage ─────────────────────────── */

route("GET", "/finance/dashboard", FIN_READ, (ctx) => dashboard(scopeCompanies(ctx), minDate(dateArg(ctx.query, "date", TODAY), TODAY)));
// En-tête de Finance : équilibre de l'exercice et pastilles de la navigation.
route("GET", "/finance/shell", FIN_READ, (ctx) => {
  const d = dashboard([ctx.company], TODAY);
  const alertes = d.decisions;
  return {
    company: COMPANIES[ctx.company].name, fiscal_year: d.fiscal_year, debit: d.ledger.debit, credit: d.ledger.credit, difference: 0, balanced: true,
    badges: {
      alerts: alertes.length, alerts_severe: alertes.filter((a) => a.severity === "critical").length,
      approvals: DB.approvals.filter((a) => a.company_id === ctx.company && a.state === "pending").length, controls: 1, controls_blocking: 0,
    },
  };
});
route("GET", "/finance/alerts", FIN_READ, (ctx) => activeAlerts(scopeCompanies(ctx), TODAY));
route("GET", "/finance/statements/income", FIN_READ, (ctx) => {
  const end = dateArg(ctx.query, "date_to", TODAY);
  const start = dateArg(ctx.query, "date_from", `${end.slice(0, 4)}-01-01`);
  const cids = scopeCompanies(ctx);
  const current = incomeStatement(cids, start, end);
  if (ctx.query.compare === "previous_year") {
    const previous = incomeStatement(cids, addMonths(start, -12), addMonths(end, -12));
    const amounts = Object.fromEntries(previous.lines.map((l) => [l.code, l.amount]));
    for (const line of current.lines) line.previous = amounts[line.code] ?? 0;
  }
  return current;
});
route("GET", "/finance/management-report", FIN_READ, (ctx) => {
  let day = TODAY;
  if (ctx.query.month) {
    if (!/^\d{4}-\d{2}$/.test(ctx.query.month) || +ctx.query.month.slice(5) < 1 || +ctx.query.month.slice(5) > 12) throw badParam("Mois invalide (AAAA-MM).");
    day = `${ctx.query.month}-01`;
  }
  return managementReport(scopeCompanies(ctx), day);
});
route("GET", "/finance/statements/cash-flow", FIN_READ, (ctx) => {
  const end = dateArg(ctx.query, "date_to", TODAY);
  const start = dateArg(ctx.query, "date_from", `${end.slice(0, 4)}-01-01`);
  if (start > end) throw badParam("La période est inversée.");
  return cashFlow(scopeCompanies(ctx), start, end);
});
route("GET", "/finance/statements/balance-sheet", FIN_READ, (ctx) => balanceSheet(scopeCompanies(ctx), dateArg(ctx.query, "date", TODAY)));
route("GET", "/finance/analytics", FIN_READ, (ctx) => {
  const plan = ctx.query.plan || "activite";
  if (!PLANS[plan]) throw badParam("Axe analytique inconnu.");
  const end = dateArg(ctx.query, "date_to", TODAY);
  const start = dateArg(ctx.query, "date_from", `${end.slice(0, 4)}-01-01`);
  return { plan: PLANS[plan], date_from: start, date_to: end, rows: byAnalyticPlan(scopeCompanies(ctx), plan, start, end) };
});
route("GET", "/finance/analytic-accounts", [...FIN_READ, "exploitation", "chantiers", "immobilier"], (ctx) => {
  const plans = Object.keys(PLANS);
  return DB.analytic
    .filter((a) => a.company_id === ctx.company && (!PLANS[ctx.query.plan] || a.plan === ctx.query.plan))
    .sort((a, b) => plans.indexOf(a.plan) - plans.indexOf(b.plan) || byFr(a.code ?? "", b.code ?? "") || byFr(a.name, b.name))
    .map((a) => ({ id: a.id, name: a.name, code: a.code, plan: PLANS[a.plan], active: a.active }));
});
route("GET", "/finance/thresholds", FIN_READ, (ctx) =>
  DB.thresholds
    .filter((t) => t.company_id === ctx.company)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((t) => ({ id: t.id, code: t.code, label: ALERT_CODES[t.code], value: t.value, severity: t.severity, active: t.active })));
route("PATCH", "/finance/thresholds/:id", ADMIN, (ctx) => {
  const t = DB.thresholds.find((x) => x.id === ctx.params[0] && x.company_id === ctx.company);
  if (!t) throw notFound("Seuil introuvable.");
  if ("value" in ctx.body) t.value = Number(ctx.body.value || 0);
  if (["info", "warning", "blocking"].includes(ctx.body.severity)) t.severity = ctx.body.severity;
  if ("active" in ctx.body) t.active = Boolean(ctx.body.active);
  return { status: "ok" };
});

/* ─── Budget ────────────────────────────────────────────────────────────── */

function budgetOf(id) {
  const b = DB.budgets.find((x) => x.id === id);
  if (!b) throw notFound("Budget introuvable.");
  return b;
}
route("GET", "/finance/budgets", FIN_READ, (ctx) =>
  DB.budgets
    .filter((b) => b.company_id === ctx.company)
    .sort((a, b) => b.date_from.localeCompare(a.date_from))
    .map((b) => ({ id: b.id, name: b.name, date_from: b.date_from, date_to: b.date_to, state: b.state, lines: b.items.length })));
route("POST", "/finance/budgets", FIN_WRITE, (ctx) => {
  const [name, year] = requireFields(ctx.body, "name", "year");
  const y = Number.parseInt(year, 10);
  if (!Number.isFinite(y)) throw badParam("Nombre invalide : year.");
  const b = { id: newId("budget"), company_id: ctx.company, name: String(name), date_from: `${y}-01-01`, date_to: `${y}-12-31`, state: "draft", items: [] };
  DB.budgets.push(b);
  return { id: b.id, name: b.name };
});
route("GET", "/finance/budgets/:id/lines", FIN_READ, (ctx) => {
  const b = budgetOf(ctx.params[0]);
  const rows = new Map();
  for (const item of b.items) {
    const a = ACCOUNT_BY_CODE.get(item.account);
    const row = rows.get(a.id) || { account_id: a.id, code: a.code, name: a.name, months: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 0])) };
    row.months[item.month] += item.amount;
    rows.set(a.id, row);
  }
  const lines = [...rows.values()].sort((x, y) => x.code.localeCompare(y.code)).map((r) => ({ ...r, total: sum(Object.values(r.months)) }));
  return { budget: { id: b.id, name: b.name, year: +b.date_from.slice(0, 4) }, lines };
});
route("POST", "/finance/budgets/:id/lines", FIN_WRITE, (ctx) => {
  const b = budgetOf(ctx.params[0]);
  const [accountId, month, amount] = requireFields(ctx.body, "account_id", "month", "amount");
  const account = ACCOUNT_BY_ID.get(Number(accountId));
  if (!account) throw notFound("Compte introuvable.");
  const m = Number.parseInt(month, 10);
  if (!(m >= 1 && m <= 12)) throw badParam("Mois invalide.");
  const value = Math.max(0, numArg(amount, "amount"));
  const item = b.items.find((i) => i.account === account.code && i.month === m);
  if (item) item.amount = value;
  else b.items.push({ id: newId("budgetItem"), account: account.code, month: m, amount: value });
  return { status: "ok" };
});
route("GET", "/finance/budgets/:id/compare", FIN_READ, (ctx) => {
  const b = budgetOf(ctx.params[0]);
  const year = +b.date_from.slice(0, 4);
  const month = intArg(ctx.query, "month", year === +TODAY.slice(0, 4) ? +TODAY.slice(5, 7) : 12, 1, 12);
  const end = monthEnd(`${year}-${pad(month)}-01`);
  const planned = {};
  for (const item of b.items.filter((i) => i.month <= month)) planned[item.account] = (planned[item.account] || 0) + item.amount;
  const actual = Object.fromEntries(Object.entries(plRange([b.company_id], b.date_from, end)).filter(([code]) => /^[67]/.test(code)));
  const threshold = DB.thresholds.find((t) => t.company_id === b.company_id && t.code === "budget_overrun_pct")?.value || 10;
  const codes = [...new Set([...Object.keys(planned), ...Object.keys(actual)])].sort();
  const lines = codes.map((code) => {
    const a = ACCOUNT_BY_CODE.get(code);
    const sign = code.startsWith("7") ? -1 : 1;
    const plan = planned[code] || 0;
    const real = round(sign * (actual[code] || 0));
    const gap = real - plan;
    const rate = plan ? (gap / plan) * 100 : null;
    return { account_id: a.id, code, name: a.name, kind: sign === -1 ? "produit" : "charge", budget: plan, actual: real, gap, gap_pct: rate, alert: rate !== null && (sign === 1 ? rate > threshold : rate < -threshold) };
  });
  return { budget: b.name, through: end, threshold_pct: threshold, lines };
});

/* ─── Tiers ─────────────────────────────────────────────────────────────── */

function partnerBalances(pid, cid) {
  const moves = DB.moves.filter((m) => m.partner_id === pid && m.company_id === cid && m.state === "posted" && m.amount_residual > 0.5);
  return {
    receivable: round(sum(moves.filter(isCustomer), signedResidual)),
    payable: round(sum(moves.filter(isSupplier), signedResidual)),
  };
}
function partnerRow(p, cid, balances = true) {
  const row = {
    id: p.id, name: p.name, is_company: p.is_company, vat: p.vat, phone: p.phone, email: p.email, city: p.city,
    customer: p.customer, supplier: p.supplier, receivable: null, payable: null, credit_limit: null,
  };
  if (balances) Object.assign(row, partnerBalances(p.id, cid), { credit_limit: p.use_credit_limit ? p.credit_limit : null });
  return row;
}
function partnerValues(ctx, p, data, finance) {
  for (const f of ["name", "vat", "phone", "email", "street", "city", "comment"]) if (f in data) p[f] = data[f] ? String(data[f]) : null;
  if ("is_company" in data) p.is_company = Boolean(data.is_company);
  if (data.customer) p.customer = true;
  if (data.supplier) p.supplier = true;
  if ("credit_limit" in data && finance) {
    const limit = data.credit_limit ? numArg(data.credit_limit, "credit_limit") : 0;
    p.use_credit_limit = Boolean(limit);
    p.credit_limit = limit;
  }
}
const partnerOf = (id) => {
  const p = partnerById(id);
  if (!p) throw notFound("Tiers introuvable.");
  return p;
};
route("GET", "/finance/partners", [...FIN_READ, ...PICKERS], (ctx) => {
  const q = ctx.query;
  const s = (q.search || "").toLowerCase();
  const list = PARTNERS.filter((p) => p.active)
    .filter((p) => (q.kind === "customer" ? p.customer : q.kind === "supplier" ? p.supplier : true))
    .filter((p) => !s || p.name.toLowerCase().includes(s) || (p.vat || "").toLowerCase().includes(s) || (p.phone || "").includes(s))
    .sort((a, b) => byFr(a.name, b.name));
  const visible = hasProfile(ctx, FIN_READ);
  const offset = offsetOf(q);
  return { items: list.slice(offset, offset + limitOf(q, 100, 1000)).map((p) => partnerRow(p, ctx.company, visible)), total_count: list.length };
});
route("GET", "/finance/partners/:id", FIN_READ, (ctx) => {
  const p = partnerOf(ctx.params[0]);
  const data = { ...partnerRow(p, ctx.company), street: p.street, comment: p.comment, use_credit_limit: p.use_credit_limit };
  const aging = { non_echu: 0, "1_30": 0, "31_60": 0, "61_90": 0, plus_90: 0 };
  const open = DB.moves
    .filter((m) => m.partner_id === p.id && m.company_id === ctx.company && m.state === "posted" && m.amount_residual > 0.5 && (isCustomer(m) || isSupplier(m)))
    .sort((a, b) => (a.invoice_date_due || "").localeCompare(b.invoice_date_due || ""));
  data.open_items = open.map((m) => {
    const late = m.invoice_date_due ? daysBetween(m.invoice_date_due, TODAY) : 0;
    const bucket = late <= 0 ? "non_echu" : late <= 30 ? "1_30" : late <= 60 ? "31_60" : late <= 90 ? "61_90" : "plus_90";
    const residual = isCustomer(m) ? signedResidual(m) : -signedResidual(m);
    if (isCustomer(m)) aging[bucket] += residual;
    return { move_id: m.id, move: m.name, date: m.date, due: m.invoice_date_due, label: m.ref || m.name, residual, late_days: Math.max(0, late), kind: isCustomer(m) ? "client" : "fournisseur" };
  });
  data.aging = aging;
  data.recent_moves = DB.moves
    .filter((m) => m.partner_id === p.id && m.company_id === ctx.company && m.move_type !== "entry")
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, 20)
    .map(moveSummary);
  if (p.use_credit_limit && p.credit_limit) data.credit_used_pct = (data.receivable / p.credit_limit) * 100;
  return data;
});
route("POST", "/finance/partners", [...FIN_WRITE, ...PICKERS], (ctx) => {
  requireFields(ctx.body, "name");
  const p = { id: newId("partner"), name: "", is_company: true, city: null, customer: false, supplier: false, vat: null, phone: null, email: null, street: null, comment: null, credit_limit: 0, use_credit_limit: false, active: true };
  partnerValues(ctx, p, ctx.body, hasProfile(ctx, FIN_WRITE));
  PARTNERS.push(p);
  return partnerRow(p, ctx.company, hasProfile(ctx, FIN_READ));
});
route("PATCH", "/finance/partners/:id", FIN_WRITE, (ctx) => {
  const p = partnerOf(ctx.params[0]);
  partnerValues(ctx, p, ctx.body, true);
  return partnerRow(p, ctx.company);
});

/* ─── Immobilisations ───────────────────────────────────────────────────── */

function assetRow(a, board = false) {
  const profile = DB.assetProfiles.find((p) => p.id === a.profile_id);
  const values = assetValues(a);
  const row = {
    id: a.id, name: a.name, code: a.code, profile: { id: profile.id, name: profile.name }, purchase_value: a.purchase_value, salvage_value: a.salvage_value,
    depreciated: values.depreciated, residual: values.residual, date_start: a.date_start, method: a.method, method_number: profile.method_number,
    method_period: profile.method_period, state: a.state, partner: partnerName(a.partner_id),
  };
  if (board) row.board = a.board;
  return row;
}
function assetOf(id) {
  const a = DB.assets.find((x) => x.id === id);
  if (!a) throw notFound("Immobilisation introuvable.");
  return a;
}
route("GET", "/finance/assets", FIN_READ, (ctx) => {
  let list = DB.assets.filter((a) => a.company_id === ctx.company);
  if (ctx.query.state) list = list.filter((a) => ctx.query.state.split(",").includes(a.state));
  const rows = list.sort((a, b) => b.date_start.localeCompare(a.date_start) || b.id - a.id).map((a) => assetRow(a));
  return { items: rows, totals: { purchase_value: sum(rows, (r) => r.purchase_value), depreciated: sum(rows, (r) => r.depreciated), residual: sum(rows, (r) => r.residual) } };
});
route("GET", "/finance/assets/profiles", FIN_READ, (ctx) =>
  DB.assetProfiles.filter((p) => p.company_id === ctx.company).map((p) => ({
    id: p.id, name: p.name, method: p.method, method_number: p.method_number, method_period: p.method_period,
    account_asset: p.account_asset, account_depreciation: p.account_depreciation, account_expense: p.account_expense,
  })));
route("POST", "/finance/assets/profiles", ["admin", "finance"], (ctx) => {
  const [name, asset, dep, exp, journal, number] = requireFields(ctx.body, "name", "account_asset_id", "account_depreciation_id", "account_expense_depreciation_id", "journal_id", "method_number");
  const code = (id) => {
    const a = ACCOUNT_BY_ID.get(Number(id));
    if (!a) throw businessRule("Compte introuvable.");
    return a.code;
  };
  const p = { id: newId("profile"), company_id: ctx.company, name: String(name), method: ctx.body.method || "linear", method_number: Number(number) || 5, method_period: ctx.body.method_period || "year", account_asset: code(asset), account_depreciation: code(dep), account_expense: code(exp), journal_id: Number(journal) };
  DB.assetProfiles.push(p);
  return { id: p.id, name: p.name };
});
route("GET", "/finance/assets/:id", FIN_READ, (ctx) => assetRow(assetOf(ctx.params[0]), true));
route("POST", "/finance/assets", FIN_WRITE, (ctx) => {
  const [name, profileId, value] = requireFields(ctx.body, "name", "profile_id", "purchase_value");
  if (!DB.assetProfiles.some((p) => p.id === Number(profileId))) throw businessRule("Catégorie d'immobilisation introuvable.");
  const a = {
    id: newId("asset"), company_id: ctx.company, name: String(name), code: ctx.body.code || null, profile_id: Number(profileId), purchase_value: numArg(value, "purchase_value"),
    salvage_value: ctx.body.salvage_value ? numArg(ctx.body.salvage_value, "salvage_value") : 0, date_start: dateArg(ctx.body, "date_start", TODAY),
    state: ctx.body.confirm ? "open" : "draft", partner_id: ctx.body.partner_id ? Number(ctx.body.partner_id) : null, removal: null, method: "linear",
  };
  a.board = assetBoard(a);
  DB.assets.push(a);
  return assetRow(a, true);
});
route("POST", "/finance/assets/:id/confirm", FIN_WRITE, (ctx) => {
  const a = assetOf(ctx.params[0]);
  a.state = "open";
  a.board = assetBoard(a);
  return assetRow(a, true);
});
route("POST", "/finance/assets/:id/dispose", FIN_WRITE, (ctx) => {
  const a = assetOf(ctx.params[0]);
  if (!["open", "close"].includes(a.state)) throw businessRule("Seule une immobilisation en service ou amortie peut sortir de l'actif.");
  const partner = ctx.body.partner_id ? partnerById(Number(ctx.body.partner_id)) : null;
  if (ctx.body.partner_id && !partner) throw businessRule("Acquéreur inconnu.");
  const date = dateArg(ctx.body, "date", TODAY);
  const sale = ctx.body.sale_value ? numArg(ctx.body.sale_value, "sale_value") : 0;
  a.removal = { date, sale, partner: partner?.id ?? null, note: ctx.body.note || null };
  a.state = "removed";
  a.board = assetBoard(a);
  let saleMove = null;
  if (sale > 0) {
    saleMove = createMove({ company_id: a.company_id, move_type: "out_invoice", partner_id: partner?.id ?? null, journal_id: journalOf(a.company_id, "VTE").id, date, due: addDays(date, 30), state: "posted",
      lines: [{ name: `Cession de l'immobilisation : ${a.name}`, account: "822000", quantity: 1, price_unit: sale, tax_id: defaultTax(a.company_id, "sale").id }] });
  }
  return { ...assetRow(a, true), sale_move: saleMove ? { id: saleMove.id, name: saleMove.name } : null };
});
route("POST", "/finance/assets/depreciate", FIN_WRITE, (ctx) => {
  const end = dateArg(ctx.body, "date", TODAY);
  const count = DB.assets.filter((a) => a.company_id === ctx.company && a.state === "open").length;
  return { status: "ok", entries: count, date: end };
});

/* ─── Fiscalité, exports, passerelle IFRS ───────────────────────────────── */

function vatOf(cids, start, end) {
  const pl = plRange(cids, start, end);
  const baseSales = round(-sumPrefix(pl, ["705", "706", "707"]) * 0.93);
  const goods = round(sumPrefix(pl, ["604", "605", "618", "622", "624", "627", "628", "632", "637"]) * 0.85);
  const capex = sum(cids.flatMap((cid) => BS[cid].capex.filter((c) => c.date >= start && c.date <= minDate(end, TODAY))), (c) => c.amount);
  const cid = cids[0];
  const taxes = [];
  if (baseSales) taxes.push({ tax_id: defaultTax(cid, "sale").id, name: defaultTax(cid, "sale").name, use: "sale", rate: 18, amount: round(baseSales * 0.18) });
  if (goods) taxes.push({ tax_id: defaultTax(cid, "purchase").id, name: defaultTax(cid, "purchase").name, use: "purchase", rate: 18, amount: round(goods * 0.18) });
  if (capex && cid === 1) taxes.push({ tax_id: 4, name: taxById(4).name, use: "purchase", rate: 18, amount: round(capex * 0.18) });
  return { taxes, baseSales, basePurchases: goods + capex };
}
route("GET", "/finance/fiscal/vat", FIN_READ, (ctx) => {
  const year = intArg(ctx.query, "year", +TODAY.slice(0, 4));
  const month = intArg(ctx.query, "month", +TODAY.slice(5, 7), 1, 12);
  const start = `${year}-${pad(month)}-01`;
  const end = monthEnd(start);
  const { taxes, baseSales, basePurchases } = vatOf(scopeCompanies(ctx), start, end);
  const collected = sum(taxes.filter((t) => t.use === "sale"), (t) => t.amount);
  const deductible = sum(taxes.filter((t) => t.use !== "sale"), (t) => t.amount);
  return {
    period: { from: start, to: end }, taxes, base_sales: baseSales, base_purchases: basePurchases, vat_collected: collected, vat_deductible: deductible,
    vat_due: Math.max(collected - deductible, 0), vat_credit: Math.max(deductible - collected, 0),
    note: "Montants préparés à partir des écritures ; le modèle de déclaration est validé avec l'expert-comptable.",
  };
});

/** Lignes d'écritures d'une pièce comptabilisée et de ses règlements (grand livre, exports). */
function ledgerLines(move) {
  const j = journalById(move.journal_id);
  const out = [];
  const push = (account, label, debit, credit, piece = move.name, journal = j, date = move.date) =>
    out.push({ date, piece, journal: journal.code, journalName: journal.name, account, label, debit: round(debit), credit: round(credit), partner_id: move.partner_id, ref: move.ref, move });
  if (move.move_type === "entry") {
    for (const l of move.lines) push(l.account, l.name, l.debit, l.credit);
    return out;
  }
  const sale = isCustomer(move);
  const refund = move.move_type.endsWith("refund");
  const flip = sale !== refund;
  for (const l of move.lines) {
    const sub = round(l.quantity * l.price_unit);
    flip ? push(l.account, l.name, 0, sub) : push(l.account, l.name, sub, 0);
  }
  if (move.amount_tax) {
    const taxAccount = taxById(move.lines.find((l) => l.tax_id)?.tax_id)?.account ?? (sale ? "443100" : "445200");
    flip ? push(taxAccount, "TVA", 0, move.amount_tax) : push(taxAccount, "TVA", move.amount_tax, 0);
  }
  const third = sale ? "411100" : "401100";
  flip ? push(third, move.ref || move.name, move.amount_total, 0) : push(third, move.ref || move.name, 0, move.amount_total);
  for (const [i, p] of move.payments.entries()) {
    const pj = journalById(p.journal_id);
    const piece = `${pj.code}/${p.date.slice(0, 4)}/${pad(3000 + move.id * 3 + i, 5)}`;
    if (sale) {
      push(pj.account, `Règlement ${move.name}`, p.amount, 0, piece, pj, p.date);
      push(third, `Règlement ${move.name}`, 0, p.amount, piece, pj, p.date);
    } else {
      push(third, `Règlement ${move.name}`, p.amount, 0, piece, pj, p.date);
      push(pj.account, `Règlement ${move.name}`, 0, p.amount, piece, pj, p.date);
    }
  }
  return out;
}
function ledger(cids, from, to) {
  return DB.moves
    .filter((m) => cids.includes(m.company_id) && m.state === "posted")
    .flatMap(ledgerLines)
    .filter((l) => (!from || l.date >= from) && (!to || l.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.piece).localeCompare(String(b.piece)));
}
route("GET", "/finance/exports/entries", FIN_READ, (ctx) => {
  const end = dateArg(ctx.query, "date_to", TODAY);
  const start = dateArg(ctx.query, "date_from", `${end.slice(0, 4)}-01-01`);
  if (daysBetween(start, end) > 400) throw businessRule("Période limitée à un exercice.");
  const headers = ["Code journal", "Journal", "Pièce", "Date", "Compte", "Libellé du compte", "Tiers", "Libellé", "Référence", "Débit", "Crédit", "Lettrage", "Montant devise", "Devise", "Saisie le", "Modifiée le"];
  const rows = ledger(scopeCompanies(ctx), start, end).map((l) => [
    l.journal, l.journalName, l.piece, ctx.query.format === "xlsx" ? l.date : frDate(l.date), l.account, accountName(l.account), partnerName(l.partner_id) ?? "", l.label, l.ref ?? "",
    l.debit, l.credit, "", l.debit - l.credit, "GNF", stamp(l.move.date, 10, 12), stamp(l.move.date, 10, 12),
  ]);
  const name = `ecritures_${start.replace(/-/g, "")}_${end.replace(/-/g, "")}`;
  if (ctx.query.format === "xlsx") return fileReply(xlsxBuffer([{ name: "Écritures", rows: [headers, ...rows] }]), XLSX, `${name}.xlsx`);
  return fileReply(csvBuffer(headers, rows), "text/csv; charset=utf-8", `${name}.csv`);
});
const IFRS_MAP = [
  ["Immobilisations incorporelles (IAS 38)", "actif", ["AD"]],
  ["Immobilisations corporelles (IAS 16)", "actif", ["AI", "AP"]],
  ["Actifs financiers non courants (IFRS 9)", "actif", ["AQ"]],
  ["Stocks (IAS 2)", "actif", ["BB"]],
  ["Clients et autres débiteurs", "actif", ["BA", "BH", "BI", "BJ", "BU"]],
  ["Trésorerie et équivalents (IAS 7)", "actif", ["BQ", "BR", "BS"]],
  ["Capitaux propres", "passif", ["CP"]],
  ["Emprunts et dettes financières (IFRS 9)", "passif", ["DA"]],
  ["Dettes locatives (IFRS 16)", "passif", ["DB"]],
  ["Provisions (IAS 37)", "passif", ["DC", "DN"]],
  ["Fournisseurs et autres créditeurs", "passif", ["DH", "DI", "DJ", "DK", "DM", "DV"]],
  ["Concours bancaires courants", "passif", ["DQ", "DR"]],
  ["Produits des activités ordinaires (IFRS 15)", "resultat", ["XB"]],
  ["Autres produits opérationnels", "resultat", ["TE", "TF", "TG", "TH", "TI"]],
  ["Achats et variations de stocks", "resultat_charge", ["RA", "RB", "RC", "RD", "RE", "RF"]],
  ["Charges externes", "resultat_charge", ["RG", "RH", "RJ"]],
  ["Impôts et taxes", "resultat_charge", ["RI"]],
  ["Charges de personnel (IAS 19)", "resultat_charge", ["RK"]],
  ["Dotations nettes aux amortissements et provisions", "resultat_net", ["RL", "TJ"]],
  ["Résultat financier", "resultat", ["XF"]],
  ["Résultat HAO (éléments non courants)", "resultat", ["XH"]],
  ["Impôt sur le résultat (IAS 12)", "resultat_charge", ["RS", "RQ"]],
  ["Résultat net de la période", "resultat", ["XI"]],
];
route("GET", "/finance/ifrs", FIN_READ, (ctx) => {
  const end = dateArg(ctx.query, "date", TODAY);
  const cids = scopeCompanies(ctx);
  const sheet = balanceSheet(cids, end);
  const result = incomeStatement(cids, `${end.slice(0, 4)}-01-01`, end);
  const values = Object.fromEntries([...sheet.actif, ...sheet.passif, ...result.lines].map((l) => [l.code, l.amount]));
  const lines = IFRS_MAP.map(([label, kind, codes]) => ({
    label, section: kind.split("_")[0], amount: kind === "resultat_net" ? (values.RL || 0) - (values.TJ || 0) : sum(codes, (c) => values[c] || 0), syscohada: codes,
  }));
  return { date: end, lines, note: "Correspondance indicative, à valider avec l'expert-comptable." };
});

/* ─── Trésorerie ────────────────────────────────────────────────────────── */

function stLineRow(l) {
  return { id: l.id, date: l.date, label: l.label, partner: partnerRef(l.partner_id), amount: l.amount, reconciled: l.reconciled, statement: l.statement, move_id: l.move_id };
}
function treasuryJournal(ctx, id) {
  const j = journalById(id);
  if (!j || !["bank", "cash"].includes(j.type) || !inCompanies(ctx, j.company_id)) throw notFound("Compte de trésorerie introuvable.");
  return j;
}
function stLineOf(ctx, id) {
  const l = DB.statementLines.find((x) => x.id === id);
  if (!l || !inCompanies(ctx, l.company_id)) throw notFound("Opération introuvable.");
  return l;
}
function addStatementLine(journal, values) {
  const line = { id: newId("st"), company_id: journal.company_id, journal_id: journal.id, statement: null, move_id: 60000 + IDS.st, reconciled: false, partner_id: null, ...values };
  DB.statementLines.push(line);
  return line;
}
route("GET", "/finance/treasury", FIN_READ, (ctx) => {
  const cids = scopeCompanies(ctx);
  const rows = cashByJournal(cids, TODAY).map((r) => ({ ...r, unreconciled: DB.statementLines.filter((l) => l.journal_id === r.journal_id && !l.reconciled).length }));
  // total : comptes des journaux ; cash : trésorerie nette de la classe 5 (total + cash_other) ; cash_min : seuil de sécurité.
  return { accounts: rows, total: sum(rows, (r) => r.balance), as_of: TODAY, cash: cashAt(cids, TODAY), cash_other: cashOther(cids, TODAY), cash_min: seuilsTableau(cids).cash_min };
});
route("GET", "/finance/treasury/:id/lines", FIN_READ, (ctx) => {
  const j = treasuryJournal(ctx, ctx.params[0]);
  const q = ctx.query;
  const start = dateArg(q, "date_from");
  const end = dateArg(q, "date_to");
  const list = DB.statementLines
    .filter((l) => l.journal_id === j.id && (q.state !== "unreconciled" || !l.reconciled) && (!start || l.date >= start) && (!end || l.date <= end))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const offset = offsetOf(q);
  return { journal: { id: j.id, name: j.name, type: j.type }, items: list.slice(offset, offset + limitOf(q, 100, 1000)).map(stLineRow), total_count: list.length };
});
route("POST", "/finance/treasury/:id/lines", FIN_WRITE, (ctx) => {
  const j = treasuryJournal(ctx, ctx.params[0]);
  const [label, amount] = requireFields(ctx.body, "label", "amount");
  if (ctx.body.partner_id && !partnerById(Number(ctx.body.partner_id))) throw businessRule("Tiers introuvable.");
  return stLineRow(addStatementLine(j, {
    date: dateArg(ctx.body, "date", TODAY), label: String(label).slice(0, 250), amount: numArg(amount, "amount"),
    partner_id: ctx.body.partner_id ? Number(ctx.body.partner_id) : null, reconciled: Boolean(ctx.body.counterpart_account_id),
  }));
});
/** Lecture d'un relevé CSV : en-têtes date, libellé, montant (ou débit et crédit). */
function parseStatement(text) {
  const rows = text.replace(/^﻿/, "").split(/\r?\n/).filter((r) => r.trim());
  if (!rows.length) return null;
  const delimiter = [";", "\t", ","].map((d) => [d, rows[0].split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const split = (r) => r.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ""));
  const find = (headers, names) => headers.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  for (let start = 0; start < Math.min(15, rows.length); start++) {
    const headers = split(rows[start]).map((h) => h.toLowerCase());
    const iDate = find(headers, ["date"]);
    const iLabel = find(headers, ["libelle", "libellé", "description", "operation", "opération", "designation", "désignation", "motif"]);
    const iAmount = find(headers, ["montant", "amount"]);
    const iDebit = find(headers, ["debit", "débit", "retrait", "sortie"]);
    const iCredit = find(headers, ["credit", "crédit", "versement", "entree", "entrée"]);
    if (iDate < 0 || iLabel < 0 || (iAmount < 0 && (iDebit < 0 || iCredit < 0))) continue;
    const num = (v) => Number(String(v || "0").replace(/[\s  ]/g, "").replace("GNF", "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")) || 0;
    const lines = [];
    for (const raw of rows.slice(start + 1)) {
      const c = split(raw);
      const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(c[iDate] || "") || /^(\d{4})-(\d{2})-(\d{2})$/.exec(c[iDate] || "");
      if (!m) continue;
      const date = m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(m[2])}-${pad(m[1])}`;
      const amount = iAmount >= 0 ? num(c[iAmount]) : num(c[iCredit]) - num(c[iDebit]);
      if (amount && isDate(date)) lines.push({ date, label: (c[iLabel] || "/").slice(0, 250), amount });
    }
    return lines;
  }
  return null;
}
route("POST", "/finance/treasury/:id/import", FIN_WRITE, (ctx) => {
  const j = treasuryJournal(ctx, ctx.params[0]);
  const file = uploadedFile(ctx, 5 * 1048576);
  let parsed;
  if (/\.xlsx?$/i.test(file.filename)) {
    parsed = [
      { date: addDays(TODAY, -2), label: "VIR RECU CLIENT SELON RELEVE IMPORTE", amount: 48_600_000 },
      { date: addDays(TODAY, -1), label: "FRAIS DE TENUE DE COMPTE", amount: -362_500 },
      { date: TODAY, label: "PRELEVEMENT CARTE CARBURANT", amount: -2_150_000 },
    ];
  } else {
    parsed = parseStatement(file.data.toString("utf8"));
    if (parsed === null) throw businessRule("Colonnes non reconnues : il faut une date, un libellé et un montant (ou un débit et un crédit).");
  }
  if (!parsed.length) throw businessRule("Aucune opération lisible dans le fichier.");
  let created = 0;
  let skipped = 0;
  const dates = [];
  const name = `${j.code} ${frDate(parsed.map((p) => p.date).sort()[0])} - ${frDate(parsed.map((p) => p.date).sort().slice(-1)[0])}`;
  for (const item of parsed) {
    if (DB.statementLines.some((l) => l.journal_id === j.id && l.date === item.date && l.amount === round(item.amount) && l.label === item.label)) {
      skipped += 1;
      continue;
    }
    addStatementLine(j, { date: item.date, label: item.label, amount: round(item.amount), statement: name });
    dates.push(item.date);
    created += 1;
  }
  return { created, skipped_duplicates: skipped, statement: created ? { id: newId("statement"), name } : null };
});
route("GET", "/finance/treasury/lines/:id/candidates", FIN_READ, (ctx) => {
  const line = stLineOf(ctx, ctx.params[0]);
  const incoming = line.amount > 0;
  const amount = Math.abs(line.amount);
  const items = openInvoices([line.company_id], incoming ? "receivable" : "payable").filter((m) => (incoming ? m.move_type === "out_invoice" : m.move_type === "in_invoice"));
  const score = (m) => (line.partner_id && m.partner_id === line.partner_id ? 2 : 0) + (Math.abs(m.amount_residual - amount) < 1 ? 3 : 0) + (m.name && (line.label || "").includes(m.name) ? 4 : 0);
  return items
    .map((m) => ({ m, s: score(m) }))
    .sort((a, b) => b.s - a.s || (a.m.invoice_date_due || a.m.date).localeCompare(b.m.invoice_date_due || b.m.date))
    .slice(0, 30)
    .map(({ m, s }) => ({ id: m.id * 100 + 99, move: m.name, move_id: m.id, partner: partnerName(m.partner_id), date: m.date, due: m.invoice_date_due, residual: m.amount_residual, score: s }));
});
route("POST", "/finance/treasury/lines/:id/reconcile", FIN_WRITE, (ctx) => {
  const line = stLineOf(ctx, ctx.params[0]);
  if (line.reconciled) throw businessRule("Cette opération est déjà rapprochée.");
  if (Array.isArray(ctx.body.move_line_ids) && ctx.body.move_line_ids.length) {
    const moves = ctx.body.move_line_ids.map((id) => moveById(Math.floor(Number(id) / 100)));
    if (moves.some((m) => !m || m.company_id !== line.company_id || m.state !== "posted" || m.amount_residual <= 0.5)) throw businessRule("Écritures à rapprocher invalides.");
    let rest = Math.abs(line.amount);
    for (const m of moves) rest -= pay(m, line.date, Math.min(rest, m.amount_residual), line.journal_id);
    line.partner_id = line.partner_id ?? moves[0].partner_id;
  } else if (!ctx.body.account_id) {
    throw new ApiError(400, "missing_fields", "Indiquez les écritures à rapprocher ou un compte d'imputation.");
  }
  line.reconciled = true;
  return stLineRow(line);
});
route("POST", "/finance/treasury/lines/:id/unreconcile", FIN_WRITE, (ctx) => {
  const line = stLineOf(ctx, ctx.params[0]);
  line.reconciled = false;
  return stLineRow(line);
});
route("POST", "/finance/treasury/journals", ADMIN, (ctx) => {
  const [name, type, code] = requireFields(ctx.body, "name", "type", "code");
  if (!["bank", "cash"].includes(type)) throw badParam("Type de journal invalide.");
  const short = String(code).trim().slice(0, 5).toUpperCase();
  if (JOURNALS.some((j) => j.company_id === ctx.company && j.code === short)) throw new ApiError(409, "conflict", `Le code ${short} est déjà pris par un autre journal de la société.`);
  const prefix = type === "bank" ? "5211" : "5713";
  let n = 50;
  while (ACCOUNT_BY_CODE.has(`${prefix}${n}`)) n += 1;
  const account = { id: ACCOUNTS.length + 1, code: `${prefix}${n}`, name: String(name), type: "asset_cash", reconcile: false };
  ACCOUNTS.push(account);
  ACCOUNT_BY_CODE.set(account.code, account);
  ACCOUNT_BY_ID.set(account.id, account);
  const currency = ctx.body.currency_id ? CURRENCIES.find((c) => c.id === Number(ctx.body.currency_id))?.name : null;
  const j = { id: Math.max(...JOURNALS.map((x) => x.id)) + 1, company_id: ctx.company, name: String(name), code: short, type, currency: currency && currency !== "GNF" ? currency : null, account: account.code, sequence: 20, share: 0 };
  JOURNALS.push(j);
  return { id: j.id, name: j.name, code: j.code, type: j.type, account: account.code };
});

/* ─── Pièces : ventes, achats, opérations diverses ─────────────────────── */

const MOVE_TYPES = { out_invoice: "Facture client", out_refund: "Avoir client", in_invoice: "Pièce d'achat", in_refund: "Avoir fournisseur", entry: "Opération diverse" };
function moveSummary(m) {
  return {
    id: m.id, name: m.name, move_type: m.move_type, state: m.state, partner: partnerRef(m.partner_id), journal: journalRef(m.journal_id),
    date: m.date, invoice_date: m.invoice_date, invoice_date_due: m.invoice_date_due, ref: m.ref, currency: "GNF",
    amount_untaxed: m.amount_untaxed, amount_tax: m.amount_tax, amount_total: m.amount_total, amount_residual: m.amount_residual,
    payment_state: m.payment_state, company: companyRef(m.company_id), approval: approvalInfo(m),
  };
}
function moveDetail(m) {
  const invoice = m.move_type !== "entry";
  const sale = isCustomer(m);
  const refund = m.move_type.endsWith("refund");
  return {
    ...moveSummary(m),
    narration: m.narration,
    lines: m.lines.map((l) => {
      const sub = invoice ? round(l.quantity * l.price_unit) : l.debit - l.credit;
      const tax = l.tax_id ? taxById(l.tax_id) : null;
      const credit = invoice ? (sale !== refund ? sub : 0) : l.credit;
      const debit = invoice ? (sale !== refund ? 0 : sub) : l.debit;
      return {
        id: l.id, name: l.name, account: accountRef(l.account), partner: partnerRef(l.partner_id ?? m.partner_id), quantity: l.quantity,
        price_unit: invoice ? l.price_unit : l.debit || l.credit, taxes: tax ? [{ id: tax.id, name: tax.name, amount: tax.amount }] : [],
        price_subtotal: sub, price_total: tax ? sub + round((sub * tax.amount) / 100) : sub, debit, credit, analytic_distribution: l.analytic || {}, display_type: "product",
      };
    }),
    attachments: m.attachments.map(({ id, name, mimetype, size }) => ({ id, name, mimetype, size })),
    payments: m.payments.length
      ? { title: "Moins les règlements", outstanding: false, content: m.payments.map((p, i) => ({ id: i + 1, name: `Règlement du ${frDate(p.date)}`, journal_name: journalById(p.journal_id)?.name, amount: p.amount, currency: "GNF", date: p.date })) }
      : null,
    can_post: m.state === "draft",
    can_pay: m.state === "posted" && ["not_paid", "partial"].includes(m.payment_state) && invoice,
  };
}
function moveOf(ctx, id) {
  const m = moveById(id);
  if (!m || !inCompanies(ctx, m.company_id)) throw notFound("Pièce introuvable.");
  return m;
}
const signedTotal = (m, field) => (m.move_type === "out_refund" || m.move_type === "in_invoice" ? -1 : 1) * m[field];
route("GET", "/finance/moves", FIN_READ, (ctx) => {
  const q = ctx.query;
  const types = (q.type || "out_invoice,out_refund").split(",").filter((t) => MOVE_TYPES[t]);
  const start = dateArg(q, "date_from");
  const end = dateArg(q, "date_to");
  const s = (q.search || "").toLowerCase();
  const payment = q.payment_state ? q.payment_state.split(",") : null;
  const list = DB.moves
    .filter((m) => types.includes(m.move_type) && m.company_id === ctx.company)
    .filter((m) => !["draft", "posted", "cancel"].includes(q.state) || m.state === q.state)
    .filter((m) => !payment || payment.includes(m.payment_state))
    .filter((m) => !q.partner_id || m.partner_id === intArg(q, "partner_id"))
    .filter((m) => !q.journal_id || m.journal_id === intArg(q, "journal_id"))
    .filter((m) => (!start || m.date >= start) && (!end || m.date <= end))
    .filter((m) => q.overdue !== "1" || (m.invoice_date_due && m.invoice_date_due < TODAY && ["not_paid", "partial"].includes(m.payment_state) && m.state === "posted"))
    .filter((m) => !s || (m.name || "").toLowerCase().includes(s) || (m.ref || "").toLowerCase().includes(s) || (partnerName(m.partner_id) || "").toLowerCase().includes(s))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const limit = limitOf(q, 50, 500);
  const offset = offsetOf(q);
  return {
    items: list.slice(offset, offset + limit).map(moveSummary), total_count: list.length,
    totals: { amount_total: Math.abs(sum(list, (m) => signedTotal(m, "amount_total"))), amount_residual: Math.abs(sum(list, (m) => signedTotal(m, "amount_residual"))) },
    limit, offset,
  };
});
route("GET", "/finance/moves/:id", FIN_READ, (ctx) => moveDetail(moveOf(ctx, ctx.params[0])));
function invoiceLines(ctx, data, moveType, cid) {
  const lines = data.lines;
  if (!Array.isArray(lines) || !lines.length) throw new ApiError(400, "missing_fields", "Au moins une ligne est requise.", { fields: ["lines"] });
  const sale = moveType.startsWith("out_");
  const journal = journalOf(cid, sale ? "VTE" : "ACH");
  return lines.map((line, i) => {
    if (!line || !line.name) throw new ApiError(400, "missing_fields", `Ligne ${i + 1} : libellé requis.`);
    const account = line.account_id ? ACCOUNT_BY_ID.get(Number(line.account_id))?.code : journal.account;
    if (!account) throw businessRule(`Ligne ${i + 1} : compte introuvable.`);
    const taxId = "tax_ids" in line ? Number((line.tax_ids || [])[0]) || null : defaultTax(cid, sale ? "sale" : "purchase").id;
    return { name: String(line.name).slice(0, 500), account, quantity: numArg(line.quantity ?? 1, "quantity"), price_unit: numArg(line.price_unit ?? 0, "price_unit"), tax_id: taxById(taxId) ? taxId : null, analytic: line.analytic_distribution || {} };
  });
}
function entryLines(data) {
  const lines = data.lines || [];
  if (lines.length < 2) throw new ApiError(400, "missing_fields", "Une opération diverse comporte au moins deux lignes.");
  let debit = 0;
  let credit = 0;
  const out = lines.map((line, i) => {
    if (!line.account_id) throw new ApiError(400, "missing_fields", `Ligne ${i + 1} : compte requis.`);
    const d = numArg(line.debit ?? 0, "debit");
    const c = numArg(line.credit ?? 0, "credit");
    if (d < 0 || c < 0 || (d && c) || !(d || c)) throw businessRule(`Ligne ${i + 1} : saisir soit un débit, soit un crédit positif.`);
    debit += d;
    credit += c;
    const account = ACCOUNT_BY_ID.get(Number(line.account_id));
    if (!account) throw businessRule(`Ligne ${i + 1} : compte introuvable.`);
    return { account: account.code, name: line.name || data.ref || "/", debit: d, credit: c, partner_id: line.partner_id ? Number(line.partner_id) : null, analytic: line.analytic_distribution || {} };
  });
  if (Math.round((debit - credit) * 100)) throw businessRule(`Pièce déséquilibrée : débit ${fmtInt(debit)}, crédit ${fmtInt(credit)}.`);
  return out;
}
route("POST", "/finance/moves", FIN_WRITE, (ctx) => {
  const data = ctx.body;
  const moveType = data.move_type;
  if (!MOVE_TYPES[moveType]) throw badParam("Type de pièce inconnu.");
  let move;
  if (moveType === "entry") {
    if (!data.journal_id) throw new ApiError(400, "missing_fields", "Journal requis.", { fields: ["journal_id"] });
    const j = journalById(Number(data.journal_id));
    if (!j || j.company_id !== ctx.company) throw businessRule("Journal introuvable.");
    move = createMove({ company_id: ctx.company, move_type: "entry", journal_id: j.id, date: dateArg(data, "date", TODAY), ref: data.ref ? String(data.ref).slice(0, 200) : null, narration: data.narration || null, lines: entryLines(data), state: "draft" });
  } else {
    const [partnerId] = requireFields(data, "partner_id");
    if (!partnerById(Number(partnerId))) throw businessRule("Tiers introuvable.");
    const date = dateArg(data, "invoice_date", TODAY);
    const sale = moveType.startsWith("out_");
    move = createMove({
      company_id: ctx.company, move_type: moveType, partner_id: Number(partnerId), journal_id: journalOf(ctx.company, sale ? "VTE" : "ACH").id, date,
      due: dateArg(data, "invoice_date_due", addDays(date, 30)), ref: data.ref ? String(data.ref).slice(0, 200) : null, narration: data.narration || null,
      lines: invoiceLines(ctx, data, moveType, ctx.company), state: "draft",
    });
  }
  if (data.post) postOrSubmit(move, ctx.user.id);
  return moveDetail(move);
});
route("PATCH", "/finance/moves/:id", FIN_WRITE, (ctx) => {
  const m = moveOf(ctx, ctx.params[0]);
  if (m.state !== "draft") throw businessRule("Seule une pièce en brouillon peut être modifiée.");
  const data = ctx.body;
  for (const key of ["ref", "narration"]) if (key in data) m[key] = data[key] || null;
  if ("partner_id" in data) m.partner_id = Number(data.partner_id);
  if ("invoice_date" in data) m.invoice_date = dateArg(data, "invoice_date");
  if ("invoice_date_due" in data) m.invoice_date_due = dateArg(data, "invoice_date_due");
  if ("date" in data) m.date = dateArg(data, "date");
  if ("lines" in data) {
    const lines = m.move_type === "entry" ? entryLines(data) : invoiceLines(ctx, data, m.move_type, m.company_id);
    m.lines = lines.map((l, i) => ({ id: m.id * 100 + i + 1, quantity: 1, price_unit: 0, tax_id: null, debit: 0, credit: 0, partner_id: null, analytic: {}, ...l }));
    computeMoveTotals(m);
    m.amount_residual = m.move_type === "entry" ? 0 : m.amount_total;
  }
  return moveDetail(m);
});
route("DELETE", "/finance/moves/:id", FIN_WRITE, (ctx) => {
  const m = moveOf(ctx, ctx.params[0]);
  if (m.state !== "draft" || m.posted_before) throw businessRule("Seul un brouillon jamais validé peut être supprimé ; sinon, annulez-le.");
  DB.moves.splice(DB.moves.indexOf(m), 1);
  return { status: "ok" };
});
route("POST", "/finance/moves/:id/post", FIN_WRITE, (ctx) => {
  const m = moveOf(ctx, ctx.params[0]);
  if (m.state !== "draft") throw businessRule("La pièce n'est pas en brouillon.");
  postOrSubmit(m, ctx.user.id);
  return moveDetail(m);
});
route("POST", "/finance/moves/:id/cancel", FIN_WRITE, (ctx) => {
  const m = moveOf(ctx, ctx.params[0]);
  m.state = "cancel";
  return moveDetail(m);
});
route("POST", "/finance/moves/:id/reset", FIN_WRITE, (ctx) => {
  const m = moveOf(ctx, ctx.params[0]);
  m.state = "draft";
  return moveDetail(m);
});
route("POST", "/finance/moves/:id/reverse", FIN_WRITE, (ctx) => {
  const m = moveOf(ctx, ctx.params[0]);
  if (m.state !== "posted") throw businessRule("Seule une pièce validée peut être extournée.");
  const type = { out_invoice: "out_refund", out_refund: "out_invoice", in_invoice: "in_refund", in_refund: "in_invoice", entry: "entry" }[m.move_type];
  const lines = m.move_type === "entry" ? m.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })) : m.lines.map((l) => ({ ...l }));
  const reversal = createMove({
    company_id: m.company_id, move_type: type, partner_id: m.partner_id, journal_id: m.journal_id, date: dateArg(ctx.body, "date", TODAY),
    ref: ctx.body.reason || `Extourne de ${m.name}`, lines, state: "draft", reversed_id: m.id,
  });
  return moveDetail(reversal);
});
route("POST", "/finance/moves/:id/payments", FIN_WRITE, (ctx) => {
  const m = moveOf(ctx, ctx.params[0]);
  const [journalId] = requireFields(ctx.body, "journal_id");
  if (m.state !== "posted" || !["not_paid", "partial"].includes(m.payment_state)) throw businessRule("Cette pièce n'attend pas de règlement.");
  const j = journalById(Number(journalId));
  if (!j || !["bank", "cash"].includes(j.type)) throw businessRule("Journal de règlement invalide.");
  const amount = ctx.body.amount ? numArg(ctx.body.amount, "amount") : m.amount_residual;
  const date = dateArg(ctx.body, "date", TODAY);
  const paid = pay(m, date, amount, j.id);
  addStatementLine(j, { date, label: `${isCustomer(m) ? "Règlement reçu" : "Règlement émis"} ${m.name}`, amount: isCustomer(m) ? paid : -paid, partner_id: m.partner_id, reconciled: true });
  return moveDetail(m);
});
function invoicePdf(m) {
  const sale = isCustomer(m);
  const c = COMPANIES[m.company_id];
  const lines = [
    `${c.name} · ${c.street ?? ""}, ${c.city ?? ""}`,
    `NIF ${c.vat} · RCCM ${c.company_registry}`,
    "",
    `${sale ? "Client" : "Fournisseur"} : ${partnerName(m.partner_id) ?? ""}`,
    `Date : ${frDate(m.invoice_date || m.date)}    Échéance : ${m.invoice_date_due ? frDate(m.invoice_date_due) : "-"}${m.ref ? `    Réf. ${m.ref}` : ""}`,
    "",
    ...m.lines.flatMap((l) => [`${l.name.slice(0, 95)}`, `    ${l.quantity} x ${fmtInt(l.price_unit)} GNF = ${fmtInt(l.quantity * l.price_unit)} GNF HT`]),
    "",
    `Total HT : ${fmtInt(m.amount_untaxed)} GNF`,
    `TVA : ${fmtInt(m.amount_tax)} GNF`,
    `Total TTC : ${fmtInt(m.amount_total)} GNF`,
    m.state === "posted" ? `Reste dû : ${fmtInt(m.amount_residual)} GNF` : "Pièce en brouillon",
    "",
    "Document de maquette : données fictives, sans valeur comptable.",
  ];
  return pdfBuffer(`${MOVE_TYPES[m.move_type]} ${m.name ?? "(brouillon)"}`, lines);
}
route("GET", "/finance/moves/:id/pdf", FIN_READ, (ctx) => {
  const m = moveOf(ctx, ctx.params[0]);
  if (m.move_type === "entry") throw businessRule("Pas d'impression pour ce type de pièce.");
  return fileReply(invoicePdf(m), "application/pdf", `${(m.name || "brouillon").replace(/\//g, "-")}.pdf`);
});
const ATTACHMENTS = new Map();
route("POST", "/finance/moves/:id/attachments", FIN_WRITE, (ctx) => {
  const m = moveOf(ctx, ctx.params[0]);
  const file = uploadedFile(ctx, 15 * 1048576);
  const mimetype = detectType(file.data);
  if (!mimetype) throw new ApiError(415, "unsupported_type", `Justificatif au format ${ACCEPTED}.`);
  const att = { id: newId("attachment"), name: checkedName(file.filename, mimetype, "piece-jointe"), mimetype, size: file.data.length };
  ATTACHMENTS.set(att.id, file.data);
  m.attachments.push(att);
  return att;
});
route("GET", "/finance/attachments/:id", FIN_READ, (ctx) => {
  const id = ctx.params[0];
  const m = DB.moves.find((x) => x.attachments.some((a) => a.id === id));
  if (!m) throw notFound("Pièce jointe introuvable.");
  moveOf(ctx, m.id);
  const att = m.attachments.find((a) => a.id === id);
  const data = ATTACHMENTS.get(id) ?? pdfBuffer(att.name, [`Justificatif joint à la pièce ${m.name ?? "(brouillon)"}`, `Tiers : ${partnerName(m.partner_id) ?? "-"}`, "", "Fichier de maquette : données fictives."]);
  return fileReply(data, ATTACHMENTS.has(id) ? att.mimetype : "application/pdf", ATTACHMENTS.has(id) ? att.name : att.name.replace(/\.[^.]+$/, ".pdf"));
});
route("POST", "/finance/transfers", FIN_WRITE, (ctx) => {
  const [fromId, toId, amount] = requireFields(ctx.body, "from_journal_id", "to_journal_id", "amount");
  const source = journalById(Number(fromId));
  const target = journalById(Number(toId));
  if (!source || !target || source === target || ![source.type, target.type].every((t) => t === "bank" || t === "cash")) throw businessRule("Choisissez deux journaux de banque ou de caisse différents.");
  const value = numArg(amount, "amount");
  if (value <= 0) throw businessRule("Le montant doit être positif.");
  const day = dateArg(ctx.body, "date", TODAY);
  const label = ctx.body.ref || `Virement ${source.name} vers ${target.name}`;
  const moves = [
    createMove({ company_id: source.company_id, move_type: "entry", journal_id: source.id, date: day, ref: label, state: "posted", lines: [{ name: label, account: "585000", debit: value }, { name: label, account: source.account, credit: value }] }),
    createMove({ company_id: target.company_id, move_type: "entry", journal_id: target.id, date: day, ref: label, state: "posted", lines: [{ name: label, account: target.account, debit: value }, { name: label, account: "585000", credit: value }] }),
  ];
  addStatementLine(source, { date: day, label, amount: -value, reconciled: true });
  addStatementLine(target, { date: day, label, amount: value, reconciled: true });
  return { status: "ok", moves: moves.map(moveSummary) };
});
route("GET", "/finance/accounts", FIN_READ, (ctx) => {
  const q = ctx.query;
  const types = q.type ? q.type.split(",") : null;
  const s = (q.search || "").toLowerCase();
  return ACCOUNTS.filter((a) => (!q.prefix || a.code.startsWith(q.prefix)) && (!types || types.includes(a.type)) && (!s || a.code.startsWith(s) || a.name.toLowerCase().includes(s)))
    .sort((a, b) => a.code.localeCompare(b.code))
    .slice(0, limitOf(q, 100, 2000));
});
route("GET", "/finance/journals", FIN_READ, (ctx) => {
  const types = ctx.query.type ? ctx.query.type.split(",") : null;
  return JOURNALS.filter((j) => j.company_id === ctx.company && (!types || types.includes(j.type)))
    .sort((a, b) => a.sequence - b.sequence || a.id - b.id)
    .map((j) => ({ id: j.id, name: j.name, code: j.code, type: j.type, currency: j.currency || "GNF", default_account: j.account ? { id: ACCOUNT_BY_CODE.get(j.account).id, code: j.account } : null }));
});
route("GET", "/finance/taxes", FIN_READ, (ctx) =>
  TAXES.filter((t) => t.company_id === ctx.company && (!["sale", "purchase"].includes(ctx.query.use) || t.use === ctx.query.use)).map((t) => ({ id: t.id, name: t.name, amount: t.amount, use: t.use, price_include: false })));
route("GET", "/finance/currencies", FIN_READ, () => CURRENCIES);
route("POST", "/finance/currencies/rates", ["admin", "finance"], (ctx) => {
  const [currencyId, value] = requireFields(ctx.body, "currency_id", "gnf_per_unit");
  const rate = numArg(value, "gnf_per_unit");
  if (rate <= 0) throw businessRule("Le taux doit être positif.");
  const c = CURRENCIES.find((x) => x.id === Number(currencyId));
  if (!c) throw notFound("Devise introuvable.");
  const day = dateArg(ctx.body, "date", TODAY);
  Object.assign(c, { inverse_rate: rate, rate: Math.round((1 / rate) * 1e8) / 1e8, date: day });
  return { status: "ok", date: day };
});

/* ─── Dette et financement ──────────────────────────────────────────────── */

function loanRow(l, lines = false) {
  const journal = journalById(l.journal_id);
  const row = {
    id: l.id, name: l.name, kind: l.kind, lender: { id: l.partner_id, name: partnerName(l.partner_id) }, principal: l.principal, annual_rate: l.annual_rate,
    start_date: l.start_date, duration_months: l.duration_months, grace_months: l.grace_months, periodicity: l.periodicity, method: l.method, state: l.state,
    outstanding: round(loanOutstanding(l)), principal_account: l.principal_account, interest_account: l.interest_account, journal: journal?.name ?? null,
  };
  if (lines) row.schedule = l.lines.map((x) => ({ ...x, remaining: round(x.remaining) }));
  return row;
}
function loanOf(id) {
  const l = DB.loans.find((x) => x.id === id);
  if (!l) throw notFound("Financement introuvable.");
  return l;
}
route("GET", "/finance/loans", FIN_READ, (ctx) => {
  const cids = scopeCompanies(ctx);
  return { items: DB.loans.filter((l) => cids.includes(l.company_id)).sort((a, b) => b.start_date.localeCompare(a.start_date) || b.id - a.id).map((l) => loanRow(l)), summary: debtSummary(cids, TODAY) };
});
route("GET", "/finance/loans/:id", FIN_READ, (ctx) => loanRow(loanOf(ctx.params[0]), true));
route("POST", "/finance/loans", FIN_WRITE, (ctx) => {
  const [name, partnerId, principal, , duration] = requireFields(ctx.body, "name", "partner_id", "principal", "start_date", "duration_months");
  const d = ctx.body;
  const code = (id) => (id ? ACCOUNT_BY_ID.get(Number(id))?.code ?? null : null);
  const loan = {
    id: newId("loan"), company_id: ctx.company, name: String(name), kind: d.kind === "lease" ? "lease" : "loan", partner_id: Number(partnerId), principal: numArg(principal, "principal"),
    annual_rate: d.annual_rate ? numArg(d.annual_rate, "annual_rate") : 0, start_date: dateArg(d, "start_date"), first_due_date: dateArg(d, "first_due_date"),
    duration_months: Number.parseInt(duration, 10) || 12, grace_months: Number.parseInt(d.grace_months || 0, 10) || 0,
    periodicity: PERIOD_MONTHS[d.periodicity] ? d.periodicity : "monthly", method: d.method === "linear" ? "linear" : "annuity",
    principal_account: code(d.principal_account_id), interest_account: code(d.interest_account_id), journal_id: d.journal_id ? Number(d.journal_id) : null, state: "draft", lines: [],
  };
  computeSchedule(loan);
  DB.loans.push(loan);
  if (d.activate) activateLoan(loan);
  return loanRow(loan, true);
});
function activateLoan(loan) {
  if (!(loan.principal_account && loan.interest_account && loan.journal_id)) throw businessRule("Renseignez le compte de dette, le compte de charges financières et le journal.");
  loan.state = "active";
}
route("POST", "/finance/loans/:id/activate", FIN_WRITE, (ctx) => {
  const loan = loanOf(ctx.params[0]);
  activateLoan(loan);
  return loanRow(loan, true);
});
route("POST", "/finance/loans/lines/:id/pay", FIN_WRITE, (ctx) => {
  const loan = DB.loans.find((l) => l.lines.some((x) => x.id === ctx.params[0]));
  if (!loan) throw notFound("Échéance introuvable.");
  const line = loan.lines.find((x) => x.id === ctx.params[0]);
  if (line.paid) throw businessRule("Cette échéance est déjà réglée.");
  if (loan.state !== "active") throw businessRule("Le financement n'est pas en cours.");
  line.paid = true;
  line.move_id = newId("move");
  if (loan.lines.every((x) => x.paid)) loan.state = "closed";
  return loanRow(loan, true);
});

/* ─── Relances ──────────────────────────────────────────────────────────── */

const mailServer = (cid) => cid === 1;
function reminderRow(r) {
  const p = partnerById(r.partner_id);
  return {
    id: r.id, partner: partnerRef(r.partner_id), email: p?.email ?? null, date: r.date, level: r.level, level_label: REMINDER_LEVELS[r.level], days_overdue: r.days_overdue,
    amount_due: r.amount_due, invoices: r.invoice_ids.length, state: r.state, channel: r.channel, sent_at: r.sent_at, sent_by: r.sent_by ? userName(r.sent_by) : null,
  };
}
function reminderLetter(r) {
  const c = COMPANIES[r.company_id];
  const intro = {
    1: "Sauf erreur de notre part, les factures ci-dessous restent impayées à ce jour. Nous vous remercions de bien vouloir procéder à leur règlement.",
    2: "Malgré notre précédent rappel, les factures ci-dessous restent impayées. Nous vous demandons de procéder à leur règlement sous huit jours.",
    3: "Malgré nos relances, les factures ci-dessous restent impayées. Nous vous mettons en demeure de régler la somme due sous huit jours à compter de la réception de la présente ; à défaut, nous engagerons les démarches de recouvrement.",
  }[r.level];
  const invoices = r.invoice_ids.map(moveById).filter(Boolean).sort((a, b) => (a.invoice_date_due || "").localeCompare(b.invoice_date_due || ""));
  return {
    subject: `${REMINDER_LEVELS[r.level]} : factures impayées, ${c.name}`, company: c.name, partner: partnerName(r.partner_id), date: r.date, level: r.level,
    level_label: REMINDER_LEVELS[r.level], intro,
    invoices: invoices.map((m) => ({ name: m.name, date: m.invoice_date, due: m.invoice_date_due, total: m.amount_total, residual: m.amount_residual })),
    amount_due: r.amount_due, closing: "Si votre règlement a croisé ce courrier, nous vous prions de ne pas en tenir compte.",
  };
}
function reminderOf(ctx, id) {
  const r = DB.reminders.find((x) => x.id === id);
  if (!r || !inCompanies(ctx, r.company_id)) throw notFound("Relance introuvable.");
  return r;
}
route("GET", "/finance/reminders", FIN_READ, (ctx) => {
  const cids = scopeCompanies(ctx);
  const items = DB.reminders
    .filter((r) => cids.includes(r.company_id) && (!["to_send", "sent", "cancelled"].includes(ctx.query.state) || r.state === ctx.query.state))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, 300);
  return { items: items.map(reminderRow), mail_server: mailServer(ctx.company) };
});
route("POST", "/finance/reminders/generate", FIN_WRITE, (ctx) => {
  const created = [];
  for (const cid of scopeCompanies(ctx)) {
    for (const [partner, invoices] of overdueByPartner(cid, TODAY)) {
      const days = Math.max(...invoices.map((m) => daysBetween(m.invoice_date_due, TODAY)));
      const level = levelFor(days);
      if (!level) continue;
      const oldest = invoices.map((m) => m.invoice_date_due).sort()[0];
      if (DB.reminders.some((r) => r.company_id === cid && r.partner_id === partner && r.state !== "cancelled" && r.level >= level && r.date >= oldest)) continue;
      const r = { id: newId("reminder"), company_id: cid, partner_id: partner, date: TODAY, level, days_overdue: days, amount_due: round(sum(invoices, (m) => m.amount_residual)), invoice_ids: invoices.map((m) => m.id), state: "to_send", channel: null, sent_at: null, sent_by: null };
      DB.reminders.push(r);
      created.push(r);
    }
  }
  return { created: created.length, items: created.map(reminderRow) };
});
route("GET", "/finance/reminders/:id", FIN_READ, (ctx) => {
  const r = reminderOf(ctx, ctx.params[0]);
  return { ...reminderRow(r), letter: reminderLetter(r) };
});
route("POST", "/finance/reminders/:id/send", FIN_WRITE, (ctx) => {
  const channel = ctx.body.channel;
  if (!["email", "letter"].includes(channel)) throw badParam("Mode d'envoi inconnu (email ou letter).");
  const r = reminderOf(ctx, ctx.params[0]);
  if (r.state === "cancelled") throw businessRule("Cette relance est annulée.");
  if (channel === "email") {
    if (!partnerById(r.partner_id)?.email) throw businessRule(`${partnerName(r.partner_id)} n'a pas d'adresse électronique.`);
    if (!mailServer(r.company_id)) throw businessRule("Aucun serveur d'envoi de courriel n'est paramétré : imprimez la lettre.");
  }
  Object.assign(r, { state: "sent", channel, sent_at: nowStamp(), sent_by: ctx.user.id });
  return reminderRow(r);
});
route("POST", "/finance/reminders/:id/cancel", FIN_WRITE, (ctx) => {
  const r = reminderOf(ctx, ctx.params[0]);
  if (r.state === "sent") throw businessRule("Une relance envoyée ne s'annule pas.");
  r.state = "cancelled";
  return reminderRow(r);
});

/* ─── Rapports financiers (eguitra_finance.models.report_registry) ─────── */

const C = (key, label, type = "text", agg = null, align = "left", def = true) => ({ key, label, type, agg, align, default: def });
const PAY_STATE_FILTER = { key: "paiement", label: "État de paiement", type: "select", options: [["not_paid", "Non payée"], ["partial", "Partielle"], ["paid", "Payée"], ["in_payment", "En paiement"], ["reversed", "Extournée"]] };
const JOURNAL_FILTER = { key: "journal", label: "Type de journal", type: "select", options: [["sale", "Ventes"], ["purchase", "Achats"], ["bank", "Banque"], ["cash", "Caisse"], ["general", "Opérations diverses"]] };
const ACCOUNT_FILTER = { key: "compte", label: "Compte commençant par", type: "text", options: [] };
const PARTNER_FILTER = { key: "tiers", label: "Tiers", type: "partner", options: [] };
const REPORTS = [
  { key: "grand_livre", label: "Grand livre", group: "Comptabilité", description: "Toutes les écritures comptabilisées, ligne par ligne.", mode: "list", hasDate: true, order: ["date", "asc"], filters: [JOURNAL_FILTER, ACCOUNT_FILTER, PARTNER_FILTER],
    columns: [C("date", "Date", "date"), C("piece", "Pièce"), C("journal", "Journal"), C("compte", "Compte"), C("libelle_compte", "Libellé du compte", "text", null, "left", false), C("tiers", "Tiers"), C("libelle", "Libellé"), C("debit", "Débit", "money", "sum", "right"), C("credit", "Crédit", "money", "sum", "right"), C("solde", "Solde", "money", "sum", "right", false), C("lettrage", "Lettrage", "text", null, "left", false)] },
  { key: "balance", label: "Balance générale", group: "Comptabilité", description: "Débit, crédit et solde par compte sur la période.", mode: "group", hasDate: true, order: ["compte", "asc"], filters: [ACCOUNT_FILTER],
    columns: [C("compte", "Compte"), C("libelle", "Libellé"), C("debit", "Débit", "money", "sum", "right"), C("credit", "Crédit", "money", "sum", "right"), C("solde", "Solde", "money", "sum", "right")] },
  { key: "balance_tiers", label: "Balance des tiers", group: "Comptabilité", description: "Soldes clients et fournisseurs par tiers.", mode: "group", hasDate: true, order: ["solde", "desc"], filters: [ACCOUNT_FILTER],
    columns: [C("tiers", "Tiers"), C("compte", "Compte"), C("debit", "Débit", "money", "sum", "right"), C("credit", "Crédit", "money", "sum", "right"), C("solde", "Solde", "money", "sum", "right")] },
  { key: "journaux", label: "Totaux par journal", group: "Comptabilité", description: "Débit et crédit par journal sur la période.", mode: "group", hasDate: true, order: ["journal", "asc"], filters: [],
    columns: [C("journal", "Journal"), C("libelle", "Libellé"), C("lignes", "Lignes", "int", "count", "right"), C("debit", "Débit", "money", "sum", "right"), C("credit", "Crédit", "money", "sum", "right")] },
  { key: "ventes", label: "Factures de vente", group: "Ventes", description: "Factures et avoirs clients comptabilisés.", mode: "list", hasDate: true, order: ["date", "desc"], filters: [PAY_STATE_FILTER, PARTNER_FILTER],
    columns: [C("date", "Date", "date"), C("numero", "Numéro"), C("client", "Client"), C("echeance", "Échéance", "date", null, "left", false), C("ht", "Montant HT", "money", "sum", "right"), C("ttc", "Montant TTC", "money", "sum", "right"), C("reste", "Reste dû", "money", "sum", "right"), C("paiement", "Paiement")] },
  { key: "ventes_par_client", label: "Chiffre d'affaires par client", group: "Ventes", description: "Chiffre d'affaires (comptes 70) par client.", mode: "group", hasDate: true, order: ["ca", "desc"], filters: [],
    columns: [C("client", "Client"), C("factures", "Pièces", "int", "count", "right"), C("ca", "Chiffre d'affaires HT", "money", "sum", "right")] },
  { key: "achats", label: "Pièces d'achat", group: "Achats", description: "Factures et avoirs fournisseurs comptabilisés.", mode: "list", hasDate: true, order: ["date", "desc"], filters: [PAY_STATE_FILTER, PARTNER_FILTER],
    columns: [C("date", "Date", "date"), C("numero", "Numéro"), C("reference", "Réf. fournisseur", "text", null, "left", false), C("fournisseur", "Fournisseur"), C("echeance", "Échéance", "date", null, "left", false), C("ht", "Montant HT", "money", "sum", "right"), C("ttc", "Montant TTC", "money", "sum", "right"), C("reste", "Reste à payer", "money", "sum", "right"), C("paiement", "Paiement")] },
  { key: "charges_par_compte", label: "Charges par compte", group: "Achats", description: "Charges (classe 6) par compte sur la période.", mode: "group", hasDate: true, order: ["montant", "desc"], filters: [ACCOUNT_FILTER],
    columns: [C("compte", "Compte"), C("libelle", "Libellé"), C("montant", "Montant", "money", "sum", "right")] },
  { key: "encours_clients", label: "Encours clients", group: "Ventes", description: "Reste dû par client sur les factures non soldées.", mode: "group", hasDate: false, order: ["reste", "desc"], filters: [],
    columns: [C("client", "Client"), C("pieces", "Pièces", "int", "count", "right"), C("reste", "Reste dû", "money", "sum", "right"), C("echu", "Dont échu", "money", "sum", "right"), C("retard_max", "Retard max (j)", "int", "max", "right")] },
  { key: "encours_fournisseurs", label: "Encours fournisseurs", group: "Achats", description: "Reste à payer par fournisseur.", mode: "group", hasDate: false, order: ["reste", "desc"], filters: [],
    columns: [C("fournisseur", "Fournisseur"), C("pieces", "Pièces", "int", "count", "right"), C("reste", "Reste à payer", "money", "sum", "right"), C("echu", "Dont échu", "money", "sum", "right")] },
  { key: "tresorerie", label: "Mouvements de trésorerie", group: "Trésorerie", description: "Écritures des comptes de banque et de caisse.", mode: "list", hasDate: true, order: ["date", "desc"], filters: [PARTNER_FILTER],
    columns: [C("date", "Date", "date"), C("journal", "Journal"), C("piece", "Pièce"), C("tiers", "Tiers"), C("libelle", "Libellé"), C("entree", "Entrée", "money", "sum", "right"), C("sortie", "Sortie", "money", "sum", "right")] },
  { key: "tva", label: "TVA par taxe", group: "Fiscalité", description: "Montants de taxe comptabilisés, par taxe.", mode: "group", hasDate: true, order: ["taxe", "asc"], filters: [{ key: "usage", label: "Type", type: "select", options: [["sale", "Collectée"], ["purchase", "Déductible"]] }],
    columns: [C("taxe", "Taxe"), C("usage", "Type"), C("compte", "Compte"), C("montant", "Montant de taxe", "money", "sum", "right")] },
];
const REPORT_PERIODS = ["today", "month", "last_month", "quarter", "year", "12m", "all"];
function reportCatalog() {
  const groups = [];
  for (const r of REPORTS) {
    let g = groups.find((x) => x.name === r.group);
    if (!g) groups.push((g = { name: r.group, reports: [] }));
    g.reports.push({
      key: r.key, label: r.label, description: r.description, mode: r.mode, has_date: r.hasDate,
      columns: r.columns.map(({ key, label, type, default: d, align, agg }) => ({ key, label, type, default: d, align, agg })),
      filters: r.filters.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options.map(([value, label]) => ({ value, label })) })),
      default_order: r.order[0], default_order_dir: r.order[1],
    });
  }
  return groups;
}
function reportPeriod(token) {
  if (!token || token === "all") return [null, null];
  if (token === "today") return [TODAY, TODAY];
  if (token === "month") return [monthStart(TODAY), TODAY];
  if (token === "last_month") return [addMonths(monthStart(TODAY), -1), addDays(monthStart(TODAY), -1)];
  if (token === "quarter") return [`${TODAY.slice(0, 4)}-${pad(3 * Math.floor((+TODAY.slice(5, 7) - 1) / 3) + 1)}-01`, TODAY];
  if (token === "year") return [`${TODAY.slice(0, 4)}-01-01`, TODAY];
  if (token === "12m") return [addMonths(TODAY, -12), TODAY];
  throw badParam("Période inconnue.");
}
function reportRows(report, cids, from, to, filters) {
  const f = (key) => (filters[key] === undefined || filters[key] === "" || filters[key] === "all" ? null : String(filters[key]));
  const inPeriod = (d) => (!from || d >= from) && (!to || d <= to);
  const prefix = f("compte");
  switch (report.key) {
    case "grand_livre":
      return ledger(cids, from, to)
        .filter((l) => (!prefix || l.account.startsWith(prefix)) && (!f("journal") || journalByCode(cids, l.journal)?.type === f("journal")) && (!f("tiers") || l.partner_id === Number(f("tiers"))))
        .map((l) => ({ date: l.date, piece: l.piece, journal: l.journal, compte: l.account, libelle_compte: accountName(l.account), tiers: partnerName(l.partner_id) ?? "", libelle: l.label, debit: l.debit, credit: l.credit, solde: l.debit - l.credit, lettrage: "" }));
    case "balance": {
      const start = from || "2024-01-01";
      const end = to || TODAY;
      const pl = plRange(cids, start, end);
      const before = sumBalances(cids, addDays(start, -1));
      const after = sumBalances(cids, end);
      const codes = new Set([...Object.keys(after), ...Object.keys(pl)].filter((c) => /^[1-5]/.test(c) || pl[c]));
      return [...codes]
        .filter((code) => !prefix || code.startsWith(prefix))
        .map((code) => {
          const delta = /^[1-5]/.test(code) ? (after[code] || 0) - (before[code] || 0) : pl[code] || 0;
          const turnover = /^(4|5)/.test(code) ? Math.abs(after[code] || 0) * 0.6 : 0;
          const debit = round((delta > 0 ? delta : 0) + turnover);
          const credit = round((delta < 0 ? -delta : 0) + turnover);
          return { compte: code, libelle: accountName(code), debit, credit, solde: debit - credit };
        })
        .filter((r) => r.debit || r.credit);
    }
    case "balance_tiers": {
      const rows = new Map();
      for (const m of DB.moves.filter((x) => cids.includes(x.company_id) && x.state === "posted" && (isCustomer(x) || isSupplier(x)))) {
        const account = isCustomer(m) ? "411100" : "401100";
        if (prefix && !account.startsWith(prefix)) continue;
        const key = `${m.partner_id}|${account}`;
        const row = rows.get(key) || { tiers: partnerName(m.partner_id), compte: account, debit: 0, credit: 0 };
        const sign = m.move_type.endsWith("refund") ? -1 : 1;
        const paid = sum(m.payments.filter((p) => inPeriod(p.date)), (p) => p.amount);
        if (isCustomer(m)) {
          if (inPeriod(m.invoice_date)) row[sign > 0 ? "debit" : "credit"] += m.amount_total;
          row[sign > 0 ? "credit" : "debit"] += paid;
        } else {
          if (inPeriod(m.invoice_date)) row[sign > 0 ? "credit" : "debit"] += m.amount_total;
          row[sign > 0 ? "debit" : "credit"] += paid;
        }
        rows.set(key, row);
      }
      return [...rows.values()].filter((r) => r.debit || r.credit).map((r) => ({ ...r, solde: r.debit - r.credit }));
    }
    case "journaux": {
      const rows = new Map();
      for (const l of ledger(cids, from, to)) {
        const row = rows.get(l.journal) || { journal: l.journal, libelle: l.journalName, lignes: 0, debit: 0, credit: 0 };
        row.lignes += 1;
        row.debit += l.debit;
        row.credit += l.credit;
        rows.set(l.journal, row);
      }
      return [...rows.values()];
    }
    case "ventes":
    case "achats": {
      const sale = report.key === "ventes";
      return DB.moves
        .filter((m) => cids.includes(m.company_id) && m.state === "posted" && (sale ? isCustomer(m) : isSupplier(m)) && inPeriod(m.invoice_date))
        .filter((m) => (!f("paiement") || m.payment_state === f("paiement")) && (!f("tiers") || m.partner_id === Number(f("tiers"))))
        .map((m) => {
          const sign = m.move_type.endsWith("refund") ? -1 : 1;
          return { date: m.invoice_date, numero: m.name, reference: m.ref ?? "", client: partnerName(m.partner_id), fournisseur: partnerName(m.partner_id), echeance: m.invoice_date_due, ht: sign * m.amount_untaxed, ttc: sign * m.amount_total, reste: sign * m.amount_residual, paiement: m.payment_state };
        });
    }
    case "ventes_par_client": {
      const rows = new Map();
      for (const m of DB.moves.filter((x) => cids.includes(x.company_id) && x.state === "posted" && isCustomer(x) && inPeriod(x.date))) {
        const ca = sum(m.lines.filter((l) => l.account.startsWith("70")), (l) => round(l.quantity * l.price_unit)) * (m.move_type === "out_refund" ? -1 : 1);
        const row = rows.get(m.partner_id) || { client: partnerName(m.partner_id), factures: 0, ca: 0 };
        row.factures += 1;
        row.ca += ca;
        rows.set(m.partner_id, row);
      }
      return [...rows.values()];
    }
    case "charges_par_compte":
      return Object.entries(plRange(cids, from || "2024-01-01", to || TODAY))
        .filter(([code]) => code.startsWith("6") && (!prefix || code.startsWith(prefix)))
        .map(([code, v]) => ({ compte: code, libelle: accountName(code), montant: round(v) }));
    case "encours_clients":
    case "encours_fournisseurs": {
      const kind = report.key === "encours_clients" ? "receivable" : "payable";
      return [...groupBy(openInvoices(cids, kind), (m) => m.partner_id)].map(([pid, list]) => ({
        client: partnerName(pid), fournisseur: partnerName(pid), pieces: list.length, reste: round(sum(list, signedResidual)),
        echu: round(sum(list.filter((m) => m.invoice_date_due < TODAY), signedResidual)), retard_max: Math.max(0, ...list.map((m) => daysBetween(m.invoice_date_due, TODAY))),
      }));
    }
    case "tresorerie":
      return DB.statementLines
        .filter((l) => cids.includes(l.company_id) && inPeriod(l.date) && (!f("tiers") || l.partner_id === Number(f("tiers"))))
        .map((l) => ({ date: l.date, journal: journalById(l.journal_id).name, piece: l.statement ?? "/", tiers: partnerName(l.partner_id) ?? "", libelle: l.label, entree: Math.max(0, l.amount), sortie: Math.max(0, -l.amount) }));
    case "tva": {
      const rows = new Map();
      for (const key of monthKeys(from || "2026-01-01", minDate(to || TODAY, TODAY))) {
        for (const t of vatOf(cids, `${key}-01`, monthEnd(`${key}-01`)).taxes) {
          if (f("usage") && t.use !== f("usage")) continue;
          const row = rows.get(t.tax_id) || { taxe: t.name, usage: t.use, compte: taxById(t.tax_id).account, montant: 0 };
          row.montant += t.use === "sale" ? t.amount : -t.amount;
          rows.set(t.tax_id, row);
        }
      }
      return [...rows.values()];
    }
    default:
      return [];
  }
}
const journalByCode = (cids, code) => JOURNALS.find((j) => cids.includes(j.company_id) && j.code === code);
function runReport(ctx, data, limitOverride = null) {
  const report = REPORTS.find((r) => r.key === data.report);
  if (!report) throw notFound("Rapport inconnu.");
  let from;
  let to;
  if (data.date_from || data.date_to) {
    from = dateArg(data, "date_from");
    to = dateArg(data, "date_to");
  } else [from, to] = reportPeriod(data.period ?? "month");
  if (!report.hasDate) [from, to] = [null, null];
  const filters = data.filters && typeof data.filters === "object" ? data.filters : {};
  for (const flt of report.filters) {
    const v = filters[flt.key];
    if (v && v !== "all" && flt.options.length && !flt.options.some(([o]) => o === v)) throw badParam(`Valeur de filtre invalide : ${flt.key}`);
  }
  const columns = report.columns.filter((c) => c.default);
  const all = reportRows(report, scopeCompanies(ctx, data), from, to, filters);
  const [orderKey, orderDir] = report.order;
  const dir = orderDir === "asc" ? 1 : -1;
  all.sort((a, b) => {
    const va = a[orderKey];
    const vb = b[orderKey];
    if (va === vb) return 0;
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    return (typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "fr")) * dir;
  });
  const totals = {};
  for (const c of columns.filter((x) => x.agg === "sum" || x.agg === "count")) totals[c.key] = round(sum(all, (r) => (c.agg === "count" ? 1 : r[c.key])));
  for (const c of columns.filter((x) => x.agg === "count")) totals[c.key] = sum(all, (r) => r[c.key]);
  const limit = Math.max(1, Math.min(Number(limitOverride ?? data.limit ?? 200) || 200, 5000));
  const offset = Math.max(0, Number(data.offset) || 0);
  const rows = all.slice(offset, offset + limit).map((r) => Object.fromEntries(columns.map((c) => [c.key, typeof r[c.key] === "number" && c.type === "money" ? round(r[c.key]) : r[c.key] ?? null])));
  return {
    report: report.key, label: report.label, mode: report.mode, columns: columns.map(({ key, label, type, align, agg }) => ({ key, label, type, align, agg })),
    rows, totals, total_count: all.length, limit, offset, has_next: offset + limit < all.length, period: { from, to },
  };
}
route("GET", "/finance/reports/catalog", FIN_READ, () => ({ groups: reportCatalog(), periods: REPORT_PERIODS }));
route("POST", "/finance/reports/run", FIN_READ, (ctx) => runReport(ctx, ctx.body));
route("POST", "/finance/reports/export", FIN_READ, (ctx) => {
  const result = runReport(ctx, ctx.body, 5000);
  const headers = result.columns.map((c) => c.label);
  const body = result.rows.map((r) => result.columns.map((c) => (c.type === "date" && r[c.key] && ctx.body.format !== "xlsx" ? frDate(r[c.key]) : r[c.key] ?? "")));
  if (Object.keys(result.totals).length) body.push(result.columns.map((c, i) => (c.key in result.totals ? result.totals[c.key] : i === 0 ? "TOTAL" : "")));
  if (ctx.body.format === "xlsx") return fileReply(xlsxBuffer([{ name: result.label, rows: [headers, ...body] }]), XLSX, `${result.report}_${TODAY}.xlsx`);
  return fileReply(csvBuffer(headers, body), "text/csv; charset=utf-8", `${result.report}_${TODAY}.csv`);
});

/* ─── Clôtures et intégrité ─────────────────────────────────────────────── */

function closingRow(c) {
  return {
    id: c.id, period: c.period, state: c.state, closed_by: c.closed_by ? userName(c.closed_by) : null, closed_at: c.closed_at, last_check: c.last_check,
    events: c.events.map((e) => ({ action: e.action, user: userName(e.user), date: e.date, reason: e.reason })),
  };
}
const check = (code, label, ok, blocking, detail = null, count = null) => ({ code, label, status: ok ? "ok" : blocking ? "blocking" : "warning", detail: ok ? null : detail, count });
function runControls(cid, start) {
  const end = monthEnd(start);
  const missing = monthKeys("2025-01-01", addDays(start, -1)).filter((k) => closingRecord(cid, `${k}-01`)?.state !== "closed");
  const drafts = DB.moves.filter((m) => m.company_id === cid && m.state === "draft" && m.date <= end).length;
  const transit = transitAt(cid, end);
  const sheet = balanceSheet([cid], end);
  const unreconciled = DB.statementLines.filter((l) => l.company_id === cid && !l.reconciled && l.date <= end).length;
  const unmapped = Object.keys(sheet.unmapped_accounts);
  const blocking = companyAlerts(cid, addDays(end, 1)).filter((a) => a.severity === "blocking");
  const pending = DB.approvals.filter((a) => a.company_id === cid && a.state === "pending" && a.res_model === "account.move" && (moveById(a.res_id)?.date ?? end) <= end).length;
  return [
    check("previous_closed", "Mois précédents clôturés", !missing.length, true, `À clôturer d'abord : ${missing.slice(0, 6).map((k) => `${k.slice(5, 7)}/${k.slice(0, 4)}`).join(", ")}`, missing.length),
    check("draft_moves", "Aucune pièce en brouillon", !drafts, true, `${drafts} pièce(s) en brouillon jusqu'au ${frDate(end)}.`, drafts),
    check("move_balance", "Équilibre débit et crédit de chaque pièce", true, true, "0 pièce(s) déséquilibrée(s).", 0),
    check("ledger_balance", "Équilibre général débit et crédit", true, true),
    check("transit_account", "Compte de passage 585 soldé", Math.abs(transit) < 0.5, true, `Solde de ${fmtInt(transit)} GNF au ${frDate(end)}.`),
    check("balance_sheet", "Équilibre actif et passif", Math.abs(sheet.difference) < 1, true, `Écart de ${fmtInt(sheet.difference)} GNF.`),
    check("bank_reconciliation", "Relevés bancaires rapprochés", !unreconciled, true, `${unreconciled} ligne(s) de relevé à rapprocher.`, unreconciled),
    check("statement_mapping", "Tous les comptes figurent dans les états", !unmapped.length, false, `Comptes hors états SYSCOHADA : ${unmapped.slice(0, 10).join(", ")}`, unmapped.length),
    check("blocking_alerts", "Aucune alerte bloquante active", !blocking.length, true, blocking.map((a) => a.title).join("; "), blocking.length),
    check("pending_approvals", "Aucune pièce en attente de validation sur la période", !pending, false, `${pending} pièce(s) en attente de validation.`, pending),
  ];
}
function closingPeriod(data) {
  const day = dateArg(data, "period");
  if (!day) throw new ApiError(400, "missing_fields", "Mois requis (AAAA-MM-01).", { fields: ["period"] });
  return monthStart(day);
}
function closingFor(cid, period) {
  let c = closingRecord(cid, period);
  if (!c) {
    c = { id: newId("closing"), company_id: cid, period, state: "open", closed_by: null, closed_at: null, last_check: null, events: [] };
    DB.closings.push(c);
  }
  return c;
}
route("GET", "/finance/closing", FIN_READ, (ctx) => {
  const year = intArg(ctx.query, "year", +TODAY.slice(0, 4));
  const months = Array.from({ length: 12 }, (_, i) => {
    const period = `${year}-${pad(i + 1)}-01`;
    const c = closingRecord(ctx.company, period);
    return c ? closingRow(c) : { id: null, period, state: "open", events: [] };
  });
  return { company: COMPANIES[ctx.company].name, year, lock_date: lockDate(ctx.company), hard_lock_date: "2025-12-31", months };
});
route("POST", "/finance/closing/check", FIN_READ, (ctx) => {
  const period = closingPeriod(ctx.body);
  const c = closingFor(ctx.company, period);
  const checks = runControls(ctx.company, period);
  c.last_check = { date: nowStamp(), checks };
  return { period, checks, can_close: c.state === "open" && !checks.some((x) => x.status === "blocking") };
});
route("POST", "/finance/closing/close", FIN_WRITE, (ctx) => {
  const c = closingFor(ctx.company, closingPeriod(ctx.body));
  if (c.state === "closed") throw businessRule("Ce mois est déjà clôturé.");
  const checks = runControls(ctx.company, c.period);
  c.last_check = { date: nowStamp(), checks };
  const blocking = checks.filter((x) => x.status === "blocking");
  if (blocking.length) throw businessRule(`Clôture refusée : ${blocking.map((x) => `${x.label} (${x.detail})`).join(" ; ")}`);
  Object.assign(c, { state: "closed", closed_by: ctx.user.id, closed_at: nowStamp() });
  c.events.unshift({ id: newId("closeEvent"), action: "close", user: ctx.user.id, date: nowStamp(), reason: null });
  return closingRow(c);
});
route("POST", "/finance/closing/reopen", ["admin", "direction"], (ctx) => {
  const [reason] = requireFields(ctx.body, "reason");
  const c = closingFor(ctx.company, closingPeriod(ctx.body));
  if (c.state !== "closed") throw businessRule("Ce mois n'est pas clôturé.");
  if (DB.closings.some((x) => x.company_id === ctx.company && x.period > c.period && x.state === "closed")) throw businessRule("Rouvrez d'abord les mois suivants, du plus récent au plus ancien.");
  if (c.period <= "2025-12-31") throw businessRule("Ce mois appartient à un exercice définitivement clôturé.");
  c.state = "open";
  c.events.unshift({ id: newId("closeEvent"), action: "reopen", user: ctx.user.id, date: nowStamp(), reason: String(reason) });
  return closingRow(c);
});
route("GET", "/finance/integrity", FIN_READ, (ctx) => {
  const period = addMonths(monthStart(TODAY), -1);
  const lock = lockDate(ctx.company);
  let chains = null;
  if (ctx.user.profiles.includes("finance")) {
    chains = JOURNALS.filter((j) => j.company_id === ctx.company && j.code !== "AN").map((j) => {
      const moves = DB.moves.filter((m) => m.journal_id === j.id && m.state === "posted" && m.name && lock && m.date <= lock).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
      if (!moves.length) return { journal: j.name, status: "no_data", message: null, first: null, last: null, last_date: null };
      const last = moves[moves.length - 1];
      return { journal: j.name, status: "verified", message: null, first: moves[0].name, last: last.name, last_date: frDate(last.date) };
    });
  }
  return { period, checks: runControls(ctx.company, period), hash_chains: chains };
});

/* ─── Validations (eguitra_approval) ────────────────────────────────────── */

const FULL_VIEW = ["admin", "direction", "finance"];
function approvalRow(req, user, detail = false) {
  const data = {
    id: req.id, name: req.name, document: req.document, res_model: req.res_model, res_id: req.res_id, amount: req.amount, partner: partnerName(req.partner_id),
    company: COMPANIES[req.company_id].name, requested_by: userName(req.requested_by), requested_at: req.requested_at, state: req.state,
    pending_with: pendingProfile(req) ? APPROVER_LABELS[pendingProfile(req)] : null, can_decide: canDecide(req, user),
  };
  if (detail) {
    data.steps = req.steps.map((s) => ({ sequence: s.sequence, label: s.label, profile: APPROVER_LABELS[s.profile], state: s.state, decided_by: s.decided_by ? userName(s.decided_by) : null, decided_at: s.decided_at, comment: s.comment }));
    if (req.res_model === "account.move") {
      const m = moveById(req.res_id);
      if (m) data.document_detail = { name: m.name, ref: m.ref, date: m.invoice_date || m.date, state: m.state, lines: m.lines.map((l) => ({ name: l.name, account: l.account, amount: round(l.quantity * l.price_unit) || l.debit })) };
    } else if (req.payment) data.document_detail = { ...req.payment };
  }
  return data;
}
function visibleApprovals(user) {
  const full = user.profiles.some((p) => FULL_VIEW.includes(p));
  return DB.approvals.filter((a) => user.companies.includes(a.company_id) && (full || a.requested_by === user.id || a.steps.some((s) => user.profiles.includes(s.profile))));
}
function approvalOf(ctx, id) {
  const req = visibleApprovals(ctx.user).find((a) => a.id === id);
  if (!req) throw notFound("Demande introuvable.");
  return req;
}
function checkCanDecide(req, user) {
  if (!canDecide(req, user)) {
    throw new ApiError(403, "forbidden", user.id === req.requested_by ? "Vous ne pouvez pas approuver votre propre demande." : "Cette étape relève d'un autre profil.");
  }
}
route("GET", "/approvals/inbox", INTERNAL, (ctx) =>
  DB.approvals
    .filter((a) => a.state === "pending" && ctx.user.companies.includes(a.company_id) && ctx.user.profiles.includes(pendingProfile(a)) && a.requested_by !== ctx.user.id)
    .sort((a, b) => a.requested_at.localeCompare(b.requested_at))
    .map((a) => approvalRow(a, ctx.user)));
route("GET", "/approvals/requests", INTERNAL, (ctx) => {
  let list = visibleApprovals(ctx.user);
  if (ctx.query.state) list = list.filter((a) => ctx.query.state.split(",").includes(a.state));
  if (ctx.query.mine === "1") list = list.filter((a) => a.requested_by === ctx.user.id);
  return list.sort((a, b) => b.id - a.id).slice(0, limitOf(ctx.query, 100, 500)).map((a) => approvalRow(a, ctx.user));
});
route("GET", "/approvals/:id", INTERNAL, (ctx) => approvalRow(approvalOf(ctx, ctx.params[0]), ctx.user, true));
route("POST", "/approvals/:id/approve", INTERNAL, (ctx) => {
  const req = approvalOf(ctx, ctx.params[0]);
  checkCanDecide(req, ctx.user);
  Object.assign(currentStep(req), { state: "approved", decided_by: ctx.user.id, decided_at: nowStamp(), comment: ctx.body.comment || null });
  if (!req.steps.some((s) => s.state === "pending")) {
    req.state = "approved";
    const m = req.res_model === "account.move" ? moveById(req.res_id) : null;
    if (m && m.state === "draft") postMove(m);
    if (req.payment) req.payment.state = "posted";
  }
  return approvalRow(req, ctx.user, true);
});
route("POST", "/approvals/:id/reject", INTERNAL, (ctx) => {
  const [comment] = requireFields(ctx.body, "comment");
  const req = approvalOf(ctx, ctx.params[0]);
  if (!String(comment).trim()) throw businessRule("Le motif du refus est obligatoire.");
  checkCanDecide(req, ctx.user);
  Object.assign(currentStep(req), { state: "rejected", decided_by: ctx.user.id, decided_at: nowStamp(), comment: String(comment) });
  for (const s of req.steps) if (s.state === "pending") s.state = "skipped";
  req.state = "rejected";
  return approvalRow(req, ctx.user, true);
});
route("GET", "/approvals/rules", ["admin", "direction", "finance"], (ctx) =>
  DB.approvalRules
    .filter((r) => r.company_id === ctx.company)
    .sort((a, b) => a.document.localeCompare(b.document) || a.sequence - b.sequence || a.min_amount - b.min_amount)
    .map((r) => ({
      id: r.id, name: r.name, document: r.document, document_label: APPROVAL_DOCS[r.document], sequence: r.sequence, min_amount: r.min_amount, max_amount: r.max_amount || null,
      account_prefix: r.account_prefix || null, approver_profile: r.approver_profile, approver_label: APPROVER_LABELS[r.approver_profile], active: r.active,
    })));
function ruleValues(rule, data) {
  for (const key of ["name", "document", "approver_profile", "account_prefix"]) if (key in data) rule[key] = data[key] || null;
  if ("sequence" in data) rule.sequence = Number.parseInt(data.sequence, 10) || 1;
  for (const key of ["min_amount", "max_amount"]) if (key in data) rule[key] = Number(data[key] || 0);
  if ("active" in data) rule.active = Boolean(data.active);
}
route("POST", "/approvals/rules", ADMIN, (ctx) => {
  requireFields(ctx.body, "name", "document", "approver_profile");
  if (!APPROVAL_DOCS[ctx.body.document] || !APPROVER_LABELS[ctx.body.approver_profile]) throw businessRule("Nature de document ou profil approbateur inconnu.");
  const rule = { id: newId("rule"), company_id: ctx.company, sequence: 1, min_amount: 0, max_amount: 0, account_prefix: null, active: true };
  ruleValues(rule, ctx.body);
  DB.approvalRules.push(rule);
  return { id: rule.id };
});
route("PATCH", "/approvals/rules/:id", ADMIN, (ctx) => {
  const rule = DB.approvalRules.find((r) => r.id === ctx.params[0] && r.company_id === ctx.company);
  if (!rule) throw notFound("Règle introuvable.");
  ruleValues(rule, ctx.body);
  return { status: "ok" };
});

/* ─── Transport ─────────────────────────────────────────────────────────── */

const simpleRef = (list, id) => {
  const x = list.find((y) => y.id === id);
  return x ? { id: x.id, name: x.name } : null;
};
function rotationRow(rot) {
  const invoice = rot.invoice_id ? moveById(rot.invoice_id) : null;
  return {
    id: rot.id, name: rot.name, state: rot.state, source: rot.source, date_loading: rot.date_loading, date_delivery: rot.date_delivery,
    vehicle: simpleRef(DB.vehicles, rot.vehicle_id), driver: simpleRef(DB.drivers, rot.driver_id), client: partnerRef(rot.partner_id), route: simpleRef(DB.routes, rot.route_id),
    product: rot.product, delivery_note: rot.delivery_note, volume_loaded: rot.volume_loaded, volume_delivered: rot.volume_delivered, shortage: rot.shortage,
    rate: rot.rate, revenue: rot.revenue, costs: Object.fromEntries(COSTS.map(([c]) => [c, rot[c] || 0])), total_cost: rot.total_cost, margin: rot.margin, margin_rate: rot.margin_rate,
    note: rot.note, invoice: invoice ? { id: invoice.id, name: invoice.name ?? "/" } : null, client_uuid: rot.client_uuid,
    ...standardOf(rot),
    estimated_margin_rate: marginShown(rot).estimated_margin_rate, margin_estimated: marginShown(rot).margin_estimated,
  };
}

/** Tri de la liste (paramètre sort du noyau, « -clé » pour l'ordre décroissant). */
const ROTATION_SORTS = {
  name: (r) => r.name || "", date_loading: (r) => r.date_loading, vehicle: (r) => simpleRef(DB.vehicles, r.vehicle_id)?.name || "",
  client: (r) => partnerRef(r.partner_id)?.name || "", route: (r) => simpleRef(DB.routes, r.route_id)?.name || "",
  volume: (r) => r.volume_delivered || r.volume_loaded || 0, shortage: (r) => r.shortage || 0, revenue: (r) => r.revenue || 0,
  margin: (r) => marginShown(r).margin, margin_rate: (r) => marginShown(r).margin_rate, state: (r) => r.state,
};
function sortRotations(list, sort) {
  const byDate = (a, b) => b.date_loading.localeCompare(a.date_loading) || b.id - a.id;
  if (!sort) return list.sort(byDate);
  const desc = sort.startsWith("-");
  const key = desc ? sort.slice(1) : sort;
  const value = ROTATION_SORTS[key];
  if (!value) throw badParam("Tri inconnu.");
  const dir = desc ? -1 : 1;
  return list.sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === vb) return key === "date_loading" ? (a.id - b.id) * dir : byDate(a, b);
    return (va > vb ? 1 : -1) * dir;
  });
}
const companyRotations = (ctx) => DB.rotations.filter((r) => r.company_id === ctx.company);
function rotationOf(ctx, id) {
  const rot = companyRotations(ctx).find((r) => r.id === id);
  if (!rot) throw notFound("Rotation introuvable.");
  return rot;
}
function rotationValues(ctx, rot, data) {
  for (const key of ["date_loading", "date_delivery"]) if (key in data) rot[key] = dateArg(data, key);
  for (const key of ["delivery_note", "note"]) if (key in data) rot[key] = data[key] || null;
  if ("product" in data) {
    if (!PRODUCTS.some(([c]) => c === data.product)) throw badParam("Produit inconnu.");
    rot.product = data.product;
  }
  for (const key of ["volume_loaded", "volume_delivered", "rate", ...COSTS.map(([c]) => c)]) if (key in data) rot[key] = numArg(data[key] || 0, key);
  const refs = { vehicle_id: DB.vehicles, driver_id: DB.drivers, route_id: DB.routes, partner_id: PARTNERS };
  for (const [key, list] of Object.entries(refs)) {
    if (!data[key]) continue;
    const id = Number(data[key]);
    if (!list.some((x) => x.id === id && (key === "partner_id" || x.company_id === ctx.company))) throw businessRule(`Référence inconnue : ${key}.`);
    rot[key] = id;
  }
}
function newRotation(ctx, data, extra = {}) {
  const rot = {
    id: newId("rotation"), company_id: ctx.company, name: null, state: "draft", source: "office", client_uuid: null, date_loading: TODAY, date_delivery: null,
    vehicle_id: null, driver_id: null, partner_id: null, route_id: null, product: "gasoil", delivery_note: null, volume_loaded: 0, volume_delivered: 0, rate: 0,
    fuel_cost: 0, toll_cost: 0, driver_fees: 0, maintenance_cost: 0, specific_taxes: 0, other_costs: 0, note: null, invoice_id: null, ...extra,
  };
  rotationValues(ctx, rot, data);
  if (!rot.rate) rot.rate = rateFor(rot.route_id, rot.partner_id, rot.product);
  if (!rot.driver_id) rot.driver_id = DB.vehicles.find((v) => v.id === rot.vehicle_id)?.driver_id ?? null;
  computeRotation(rot);
  DB.rotations.push(rot);
  return rot;
}
function validateRotation(rot) {
  if (rot.state !== "draft") return;
  if (!(rot.volume_loaded || rot.volume_delivered)) throw businessRule(`Rotation ${rot.name || ""} : volume chargé ou livré requis.`);
  if (!rot.rate) throw businessRule(`Rotation ${rot.name || ""} : tarif manquant pour cette route et ce client.`);
  if (!rot.name) rot.name = `ROT/2026/${pad(++IDS.rotationSeq, 5)}`;
  rot.state = "done";
}
route("GET", "/transport/referentials", TR_READ, (ctx) => {
  const vehicles = DB.vehicles.filter((v) => v.company_id === ctx.company && v.state !== "off");
  const since = addMonths(TODAY, -12);
  const clientIds = new Set([...DB.tariffs.filter((t) => DB.routes.some((r) => r.id === t.route_id && r.company_id === ctx.company)).map((t) => t.partner_id), ...companyRotations(ctx).filter((r) => r.date_loading >= since).map((r) => r.partner_id)]);
  return {
    vehicles: vehicles.map((v) => ({ id: v.id, name: v.name, tractor_plate: v.tractor_plate, capacity_liters: v.capacity_liters, driver_id: v.driver_id, state: v.state })),
    drivers: DB.drivers.filter((d) => d.company_id === ctx.company && d.active).map((d) => ({ id: d.id, name: d.name, phone: d.phone })),
    routes: DB.routes.filter((r) => r.company_id === ctx.company && r.active).map((r) => ({
      id: r.id, name: r.name, distance_km: r.distance_km, default_rate: r.default_rate,
      tariffs: DB.tariffs.filter((t) => t.route_id === r.id).map((t) => ({ partner_id: t.partner_id, product: t.product, rate: t.rate })),
      std_fuel_liters: r.std_fuel_liters || 0, std_driver_bonus: r.std_driver_bonus || 0, std_tolls: r.std_tolls || 0, std_other_costs: r.std_other_costs || 0,
    })),
    fuel_price: fuelPriceAt(ctx.company, TODAY),
    clients: [...clientIds].map(partnerRef).filter(Boolean).sort((a, b) => byFr(a.name, b.name)),
    products: PRODUCTS.map(([code, label]) => ({ code, label })),
    costs: COSTS.map(([code, label]) => ({ code, label })),
    // Mesures facultatives du parc (Rotations) ; sans calcul des manquants à 15 °C, ni températures ni masse volumique.
    volume_correction: false,
    measures: [{ code: "fuel_liters", label: "Carburant (litres)" }],
  };
});
route("GET", "/transport/vehicles", TR_READ, (ctx) =>
  DB.vehicles.filter((v) => v.company_id === ctx.company).map((v) => ({
    id: v.id, name: v.name, tractor_plate: v.tractor_plate, trailer_plate: v.trailer_plate, brand: v.brand, capacity_liters: v.capacity_liters,
    driver: simpleRef(DB.drivers, v.driver_id), state: v.state, active: v.active,
    ownership: v.ownership, owner: partnerRef(v.owner_id), charges: v.charges, monthly_charges: v.charges.reduce((s, c) => s + monthlyOf(c), 0),
  })));
function vehicleValues(v, data) {
  for (const key of ["name", "tractor_plate", "trailer_plate", "brand"]) if (key in data) v[key] = data[key] || null;
  if ("capacity_liters" in data) v.capacity_liters = Number.parseInt(data.capacity_liters || 0, 10) || 0;
  if (["service", "maintenance", "off"].includes(data.state)) v.state = data.state;
  if ("driver_id" in data) v.driver_id = data.driver_id ? Number(data.driver_id) : null;
  if ("active" in data) v.active = Boolean(data.active);
  if (data.ownership in OWNERSHIP_LABELS) v.ownership = data.ownership;
  if ("owner_id" in data) v.owner_id = data.owner_id ? Number(data.owner_id) : null;
  if ("charges" in data) v.charges = (data.charges || []).map((c, i) => ({ id: Date.now() + i, name: c.name, amount: Number(c.amount) || 0, periodicity: c.periodicity === "year" ? "year" : "month", date_from: c.date_from || null, date_to: c.date_to || null }));
}
route("POST", "/transport/vehicles", TR_WRITE, (ctx) => {
  requireFields(ctx.body, "name");
  if (DB.vehicles.some((v) => v.company_id === ctx.company && v.name === ctx.body.name)) throw new ApiError(409, "conflict", "Ce code d'ensemble existe déjà.");
  const v = { id: newId("vehicle"), company_id: ctx.company, name: "", tractor_plate: null, trailer_plate: null, brand: null, capacity_liters: 0, driver_id: null, state: "service", active: true, ownership: "own", owner_id: null, charges: [] };
  vehicleValues(v, ctx.body);
  DB.vehicles.push(v);
  DB.analytic.push({ id: newId("analytic"), company_id: ctx.company, plan: "vehicule", name: v.name, code: null, active: true });
  return { id: v.id, name: v.name };
});
route("PATCH", "/transport/vehicles/:id", TR_WRITE, (ctx) => {
  const v = DB.vehicles.find((x) => x.id === ctx.params[0] && x.company_id === ctx.company);
  if (!v) throw notFound("Ensemble routier introuvable.");
  vehicleValues(v, ctx.body);
  return { status: "ok" };
});
route("GET", "/transport/drivers", TR_READ, (ctx) =>
  DB.drivers.filter((d) => d.company_id === ctx.company).map((d) => ({ id: d.id, name: d.name, phone: d.phone, license_number: d.license_number, license_expiry: d.license_expiry, active: d.active })));
function driverValues(d, data) {
  for (const key of ["name", "phone", "license_number"]) if (key in data) d[key] = data[key] || null;
  if ("license_expiry" in data) d.license_expiry = dateArg(data, "license_expiry");
  if ("active" in data) d.active = Boolean(data.active);
}
route("POST", "/transport/drivers", TR_WRITE, (ctx) => {
  requireFields(ctx.body, "name");
  const d = { id: newId("driver"), company_id: ctx.company, name: "", phone: null, license_number: null, license_expiry: null, active: true };
  driverValues(d, ctx.body);
  DB.drivers.push(d);
  return { id: d.id, name: d.name };
});
route("PATCH", "/transport/drivers/:id", TR_WRITE, (ctx) => {
  const d = DB.drivers.find((x) => x.id === ctx.params[0] && x.company_id === ctx.company);
  if (!d) throw notFound("Chauffeur introuvable.");
  driverValues(d, ctx.body);
  return { status: "ok" };
});
route("GET", "/transport/routes", TR_READ, (ctx) =>
  DB.routes.filter((r) => r.company_id === ctx.company).map((r) => ({
    id: r.id, name: r.name, origin: r.origin, destination: r.destination, distance_km: r.distance_km, default_rate: r.default_rate, active: r.active,
    distance_return_km: null, round_trip_km: 2 * (r.distance_km || 0), round_trip_inconsistent: false, duration_days: null,
    tariffs: DB.tariffs.filter((t) => t.route_id === r.id).map((t) => ({ id: t.id, partner: partnerRef(t.partner_id), product: t.product, rate: t.rate })),
    std_fuel_liters: r.std_fuel_liters || 0, std_driver_bonus: r.std_driver_bonus || 0, std_tolls: r.std_tolls || 0, std_other_costs: r.std_other_costs || 0,
    fuel_per_km: r.distance_km && r.std_fuel_liters ? r.std_fuel_liters / (2 * r.distance_km) : null,
  })));
function routeValues(rt, data) {
  for (const key of ["name", "origin", "destination"]) if (key in data) rt[key] = data[key] || null;
  if ("distance_km" in data) rt.distance_km = Number.parseInt(data.distance_km || 0, 10) || 0;
  if ("default_rate" in data) rt.default_rate = numArg(data.default_rate || 0, "default_rate");
  for (const key of ["std_fuel_liters", "std_driver_bonus", "std_tolls", "std_other_costs"]) if (key in data) rt[key] = numArg(data[key] || 0, key);
  if ("active" in data) rt.active = Boolean(data.active);
  if ("tariffs" in data) {
    DB.tariffs = DB.tariffs.filter((t) => t.route_id !== rt.id);
    for (const t of data.tariffs || []) DB.tariffs.push({ id: newId("tariff"), route_id: rt.id, partner_id: Number(t.partner_id), product: t.product || null, rate: numArg(t.rate ?? 0, "rate") });
  }
}
route("POST", "/transport/routes", TR_WRITE, (ctx) => {
  requireFields(ctx.body, "name");
  const rt = { id: newId("route"), company_id: ctx.company, name: "", origin: null, destination: null, distance_km: 0, default_rate: 0, active: true };
  routeValues(rt, ctx.body);
  DB.routes.push(rt);
  DB.analytic.push({ id: newId("analytic"), company_id: ctx.company, plan: "route", name: rt.name, code: null, active: true });
  return { id: rt.id, name: rt.name };
});
route("PATCH", "/transport/routes/:id", TR_WRITE, (ctx) => {
  const rt = DB.routes.find((x) => x.id === ctx.params[0] && x.company_id === ctx.company);
  if (!rt) throw notFound("Route introuvable.");
  routeValues(rt, ctx.body);
  return { status: "ok" };
});
route("GET", "/transport/rotations", TR_READ, (ctx) => {
  const q = ctx.query;
  const states = q.state ? q.state.split(",") : null;
  const start = dateArg(q, "date_from");
  const end = dateArg(q, "date_to");
  const list = companyRotations(ctx)
    .filter((r) => !states || states.includes(r.state))
    .filter((r) => ["vehicle_id", "partner_id", "route_id", "driver_id"].every((k) => !q[k] || r[k] === intArg(q, k)))
    .filter((r) => (!start || r.date_loading >= start) && (!end || r.date_loading <= end));
  sortRotations(list, q.sort);
  const offset = offsetOf(q);
  const limit = limitOf(q, 100, 1000);
  return {
    items: list.slice(offset, offset + limit).map(rotationRow), total_count: list.length, offset, limit,
    totals: { revenue: sum(list, (r) => r.revenue), margin: sum(list, (r) => r.margin), volume: round3(sum(list, (r) => r.volume_delivered)) },
    // Marge minimale de la règle d'alerte (Seuils et taux) ; null : règle éteinte ou seuil à 0.
    margin_min: seuilsTableau([ctx.company]).transport_margin_min,
  };
});
route("GET", "/transport/rotations/:id", TR_READ, (ctx) => {
  const rot = rotationOf(ctx, ctx.params[0]);
  return { ...rotationRow(rot), ...droitDepart(ctx, rot) };
});
/** can_depart et depart_refusal de la fiche, comme le noyau Transport (règle du 26/10 : admin et exploitation, sites du chef de parc). */
function droitDepart(ctx, rot) {
  if (rot.state !== "draft") return { can_depart: false, depart_refusal: "Seule une rotation saisie, pas encore partie, part en route." };
  if (!hsIs(ctx, "admin") && !hsIs(ctx, "exploitation")) return { can_depart: false, depart_refusal: "Le départ est donné par le chef de parc du site ou par l'administration." };
  if (!hsIs(ctx, "admin") && !hsSiteOk(ctx, hsVehicleSite(hsVehicle(rot.vehicle_id)))) return { can_depart: false, depart_refusal: "Ensemble d'un autre site que les vôtres : le départ revient à son chef de parc." };
  return { can_depart: true, depart_refusal: null };
}
route("POST", "/transport/rotations", TR_WRITE, (ctx) => {
  requireFields(ctx.body, "vehicle_id", "partner_id", "route_id");
  const rot = newRotation(ctx, ctx.body);
  if (ctx.body.validate) validateRotation(rot);
  return rotationRow(rot);
});
route("PATCH", "/transport/rotations/:id", TR_WRITE, (ctx) => {
  const rot = rotationOf(ctx, ctx.params[0]);
  if (!["draft", "done"].includes(rot.state)) throw businessRule("Seule une rotation saisie ou validée se modifie.");
  rotationValues(ctx, rot, ctx.body);
  computeRotation(rot);
  return rotationRow(rot);
});
route("POST", "/transport/rotations/validate", TR_WRITE, (ctx) => {
  const rots = (ctx.body.ids || []).map((id) => companyRotations(ctx).find((r) => r.id === Number(id))).filter(Boolean);
  for (const rot of rots) validateRotation(rot);
  return rots.map(rotationRow);
});
/**
 * Départ d'une rotation (contrat HSSEQ, §9, §13) : état « en_route », ouvert aux profils qui écrivent
 * les rotations (WRITE de Transport : admin, finance, exploitation). Verrou en service pour la rotation
 * (lock_active), le noyau HSSEQ le réserve au chef de parc (exploitation, sites de la rotation) et refuse
 * en 422 departure_blocked tant qu'un motif « block » reste ouvert sans dérogation active ; les
 * avertissements (« warn ») sont transmis sans bloquer. Trace : departed_at, departed_by.
 * Déclarée avant /:action, qui prendrait sinon « depart ».
 */
route("POST", "/transport/rotations/:id/depart", TR_WRITE, (ctx) => {
  const rot = hsRotation(ctx.params[0]);
  if (!rot) throw notFound("Rotation introuvable.");
  const v = hsVehicle(rot.vehicle_id);
  // Règle du noyau (26/10), verrou en service ou non : chef de parc (sites de la rotation) ou administration.
  if (!hsIs(ctx, "admin") && !hsIs(ctx, "exploitation")) throw hsForbidden("Le départ en route est donné par le chef de parc du site ou par l'administration.");
  if (!hsIs(ctx, "admin") && !hsSiteOk(ctx, hsVehicleSite(v))) throw hsForbidden(`Rotation ${rot.name ?? rot.id} : ensemble d'un autre site que les vôtres.`);
  if (rot.state !== "draft") throw businessRule(`Rotation ${rot.name ?? rot.id} : seule une rotation saisie part en route.`);
  const blockers = [];
  if (v && ["maintenance", "off", "sold"].includes(v.state)) blockers.push({ code: "T01", label: `${v.name} n'est pas disponible : il ne part pas en rotation.`, source: "transport", since: null, waivable: false, severity: "block" });
  if (hsLockActive(rot)) {
    const { reasons, warnings } = hsReasons(ctx, rot);
    const keys = ({ code, label, source, since, waivable, severity }) => ({ code, label, source, since, waivable, severity });
    blockers.push(...reasons.filter((r) => !r.waiver_id).map(keys), ...warnings.map(keys));
  }
  if (blockers.some((b) => b.severity === "block")) {
    throw hsRule("departure_blocked", `Départ refusé pour la rotation ${rot.name ?? rot.id} : ${blockers.filter((b) => b.severity === "block").map((b) => b.label).join("; ")}`, { blockers });
  }
  Object.assign(rot, { state: "en_route", departed_at: hsNow(), departed_by: ctx.user.id });
  if (DB.rotations.includes(rot)) return { ...rotationRow(rot), departure_blockers: [], departed_at: rot.departed_at, departed_by: hsUser(rot.departed_by) };
  return { id: rot.id, name: rot.name, state: rot.state, date_loading: rot.date_loading, vehicle: hsVehicleRef(v.id), driver: hsDriverRef(rot.driver_id), route_name: hsRouteName(rot), departure_blockers: [], departed_at: rot.departed_at, departed_by: hsUser(rot.departed_by) };
});
route("POST", "/transport/rotations/:id/:action", TR_WRITE, (ctx) => {
  const rot = rotationOf(ctx, ctx.params[0]);
  const action = ctx.params[1];
  if (action === "validate") validateRotation(rot);
  else if (action === "cancel") {
    if (rot.state === "invoiced") throw businessRule("Une rotation facturée ne peut pas être annulée.");
    rot.state = "cancelled";
  } else if (action === "reset") {
    if (["done", "cancelled"].includes(rot.state)) rot.state = "draft";
  } else throw notFound("Action inconnue.");
  return rotationRow(rot);
});
route("POST", "/transport/invoice", ["admin", "finance"], (ctx) => {
  const rots = (ctx.body.rotation_ids || []).map((id) => companyRotations(ctx).find((r) => r.id === Number(id))).filter((r) => r && r.state === "done");
  if (!rots.length) throw businessRule("Sélectionnez des rotations validées et non encore facturées.");
  const invoices = [];
  for (const [partnerId, group] of groupBy(rots, (r) => r.partner_id)) {
    const lines = group.sort((a, b) => a.date_loading.localeCompare(b.date_loading)).map((rot) => {
      const vehicle = DB.vehicles.find((v) => v.id === rot.vehicle_id);
      const rt = DB.routes.find((x) => x.id === rot.route_id);
      const billed = rot.volume_delivered || rot.volume_loaded;
      const product = (PRODUCTS.find(([c]) => c === rot.product)?.[1] ?? rot.product).toLowerCase();
      return { name: `Transport ${product} ${rt.name}, ${billed.toFixed(3)} m³${rot.delivery_note ? `, BL ${rot.delivery_note}` : ""} (${rot.name}, ${vehicle.name}, ${frDate(rot.date_loading)})`, account: "706100", quantity: billed, price_unit: rot.rate, tax_id: defaultTax(ctx.company, "sale").id };
    });
    const move = createMove({ company_id: ctx.company, move_type: "out_invoice", partner_id: partnerId, journal_id: journalOf(ctx.company, "VTE").id, date: TODAY, due: addDays(TODAY, TERMS[partnerId] ?? 30), origin: group.map((r) => r.name).join(", "), lines, state: "draft" });
    for (const rot of group) Object.assign(rot, { state: "invoiced", invoice_id: move.id });
    invoices.push(move);
  }
  return { invoices: invoices.map(moveSummary) };
});
route("GET", "/transport/profitability", TR_READ, (ctx) => {
  const end = dateArg(ctx.query, "date_to", TODAY);
  const start = dateArg(ctx.query, "date_from", `${end.slice(0, 4)}-01-01`);
  const group = ctx.query.group || "vehicle";
  return { group, date_from: start, date_to: end, rows: profitability(scopeCompanies(ctx), start, end, group) };
});
route("GET", "/transport/summary", TR_READ, (ctx) => {
  const end = dateArg(ctx.query, "date_to", TODAY);
  const start = dateArg(ctx.query, "date_from", monthStart(end));
  const all = companyRotations(ctx);
  const done = all.filter((r) => ["done", "invoiced"].includes(r.state) && r.date_loading >= start && r.date_loading <= end);
  const toInvoice = all.filter((r) => r.state === "done");
  const rev = sum(done, (r) => r.revenue);
  const margin = sum(done, (r) => r.margin);
  const vehicles = DB.vehicles.filter((v) => v.company_id === ctx.company);
  return {
    date_from: start, date_to: end, rotations: done.length, volume: round3(sum(done, (r) => r.volume_delivered)), revenue: rev, cost: sum(done, (r) => r.total_cost), margin,
    margin_rate: rev ? (margin / rev) * 100 : null, to_invoice: { count: toInvoice.length, amount: sum(toInvoice, (r) => r.revenue) },
    margin_min: seuilsTableau([ctx.company]).transport_margin_min, shortage_excess: { count: 0, volume: 0, value: 0 },
    drafts: all.filter((r) => r.state === "draft").length,
    fleet: Object.fromEntries(["service", "maintenance", "off"].map((s) => [s, vehicles.filter((v) => v.state === s).length])),
  };
});
route("POST", "/transport/sync", TR_WRITE, (ctx) => {
  const items = ctx.body.rotations || [];
  if (!Array.isArray(items) || items.length > 200) throw badParam("Liste de rotations invalide (200 au plus par envoi).");
  const results = [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      results.push({ client_uuid: null, status: "error", message: "Saisie illisible." });
      continue;
    }
    const uuid = String(item.client_uuid || "").slice(0, 64);
    if (!uuid) {
      results.push({ client_uuid: null, status: "error", message: "Identifiant de saisie manquant." });
      continue;
    }
    const existing = DB.rotations.find((r) => r.client_uuid === uuid);
    if (existing) {
      results.push({ client_uuid: uuid, status: "exists", id: existing.id });
      continue;
    }
    if (!item.vehicle_id || !item.partner_id || !item.route_id) {
      results.push({ client_uuid: uuid, status: "error", message: "Ensemble, client et route sont obligatoires." });
      continue;
    }
    try {
      const rot = newRotation(ctx, item, { client_uuid: uuid, source: "mobile" });
      results.push({ client_uuid: uuid, status: "created", id: rot.id });
    } catch (e) {
      results.push({ client_uuid: uuid, status: "error", message: e instanceof ApiError ? e.userMessage : "Saisie invalide." });
    }
  }
  return { results };
});

/* ─── Chantiers ─────────────────────────────────────────────────────────── */

function chantierRow(ch, detail = false) {
  const totals = chantierTotals(ch);
  const data = {
    id: ch.id, name: ch.name, code: ch.code, client: partnerRef(ch.partner_id), contract_amount: ch.contract_amount, retention_rate: ch.retention_rate, state: ch.state,
    date_start: ch.date_start, date_end: ch.date_end, date_reception: ch.date_reception, location: ch.location, invoiced_amount: totals.invoiced_amount,
    progress_pct: totals.progress_pct, retention_total: totals.retention_total, retention_released: ch.retention_released,
    retention_outstanding: totals.retention_total - ch.retention_released,
  };
  if (detail) {
    data.costs = ch.costs;
    data.margin = totals.invoiced_amount - ch.costs;
    data.situations = situationsOf(ch).map((s) => {
      const invoice = s.invoice_id ? moveById(s.invoice_id) : null;
      return {
        id: s.id, number: s.number, date: s.date, period_label: s.period_label, cumulative_amount: s.cumulative_amount, ...situationAmounts(s), state: s.state,
        invoice: invoice ? { id: invoice.id, name: invoice.name, residual: invoice.amount_residual } : null,
      };
    });
  }
  return data;
}
function chantierOf(ctx, id) {
  const ch = DB.chantiers.find((c) => c.id === id && c.company_id === ctx.company);
  if (!ch) throw notFound("Chantier introuvable.");
  return ch;
}
function chantierValues(ch, data) {
  for (const key of ["name", "code", "location"]) if (key in data) ch[key] = data[key] || null;
  if ("partner_id" in data) ch.partner_id = Number(data.partner_id);
  for (const key of ["contract_amount", "retention_rate"]) if (key in data) ch[key] = numArg(data[key] || 0, key);
  for (const key of ["date_start", "date_end", "date_reception"]) if (key in data) ch[key] = dateArg(data, key);
  if (["preparation", "progress", "received", "closed"].includes(data.state)) ch.state = data.state;
}
const situationOf = (ctx, id) => {
  const s = DB.situations.find((x) => x.id === id);
  if (!s || !DB.chantiers.some((c) => c.id === s.chantier_id && c.company_id === ctx.company)) throw notFound("Situation introuvable.");
  return s;
};
route("GET", "/chantiers", CH_READ, (ctx) => {
  const states = ctx.query.state ? ctx.query.state.split(",") : null;
  const rows = DB.chantiers
    .filter((c) => c.company_id === ctx.company && (!states || states.includes(c.state)))
    .sort((a, b) => (b.date_start || "").localeCompare(a.date_start || "") || b.id - a.id)
    .map((c) => chantierRow(c));
  return { items: rows, totals: { contract_amount: sum(rows, (r) => r.contract_amount), invoiced_amount: sum(rows, (r) => r.invoiced_amount), retention_outstanding: sum(rows, (r) => r.retention_outstanding) } };
});
route("GET", "/chantiers/:id", CH_READ, (ctx) => chantierRow(chantierOf(ctx, ctx.params[0]), true));
route("POST", "/chantiers", CH_WRITE, (ctx) => {
  requireFields(ctx.body, "name", "partner_id");
  const ch = { id: newId("chantier"), company_id: ctx.company, name: "", code: null, partner_id: null, contract_amount: 0, retention_rate: 5, state: "preparation", date_start: null, date_end: null, date_reception: null, location: null, costs: 0, retention_released: 0, releaseDate: null };
  chantierValues(ch, ctx.body);
  DB.chantiers.push(ch);
  DB.analytic.push({ id: newId("analytic"), company_id: ctx.company, plan: "chantier", name: ch.name, code: ch.code, active: true });
  return chantierRow(ch, true);
});
route("PATCH", "/chantiers/:id", CH_WRITE, (ctx) => {
  const ch = chantierOf(ctx, ctx.params[0]);
  chantierValues(ch, ctx.body);
  return chantierRow(ch, true);
});
route("POST", "/chantiers/:id/situations", CH_WRITE, (ctx) => {
  const ch = chantierOf(ctx, ctx.params[0]);
  let cumulative;
  if (ctx.body.progress_pct !== undefined && ctx.body.progress_pct !== null && ctx.body.progress_pct !== "" && !ctx.body.cumulative_amount) {
    if (!ch.contract_amount) throw businessRule("Montant du marché requis pour saisir un pourcentage d'avancement.");
    cumulative = (ch.contract_amount * numArg(ctx.body.progress_pct, "progress_pct")) / 100;
  } else {
    const [value] = requireFields(ctx.body, "cumulative_amount");
    cumulative = numArg(value, "cumulative_amount");
  }
  const numbers = situationsOf(ch).map((s) => s.number);
  DB.situations.push({ id: newId("situation"), chantier_id: ch.id, number: (numbers.length ? Math.max(...numbers) : 0) + 1, date: dateArg(ctx.body, "date", TODAY), period_label: ctx.body.period_label || null, cumulative_amount: round(cumulative), state: "draft", invoice_id: null });
  return chantierRow(ch, true);
});
route("POST", "/chantiers/situations/:id/invoice", ["admin", "finance"], (ctx) => {
  const s = situationOf(ctx, ctx.params[0]);
  const ch = DB.chantiers.find((c) => c.id === s.chantier_id);
  if (s.state !== "draft") throw businessRule("Cette situation est déjà facturée ou annulée.");
  const amounts = situationAmounts(s);
  if (amounts.amount_period <= 0) throw businessRule("Le cumul des travaux doit dépasser celui de la situation précédente.");
  if (ch.contract_amount && s.cumulative_amount > ch.contract_amount * 1.0001) throw businessRule("Le cumul dépasse le montant du marché : établissez d'abord un avenant.");
  const move = createMove({
    company_id: ch.company_id, move_type: "out_invoice", partner_id: ch.partner_id, journal_id: journalOf(ch.company_id, "VTE").id, date: s.date, due: addDays(s.date, 30), state: "posted",
    origin: `${ch.name} - situation ${s.number}`, situation_id: s.id,
    lines: [{ name: `Situation n° ${s.number} - ${ch.name}${s.period_label ? ` - ${s.period_label}` : ""} (avancement cumulé ${amounts.progress_pct.toFixed(1)} %)`, account: "705100", quantity: 1, price_unit: amounts.amount_period, tax_id: defaultTax(ch.company_id, "sale").id }],
  });
  Object.assign(s, { state: "invoiced", invoice_id: move.id });
  if (ch.state === "preparation") ch.state = "progress";
  return chantierRow(ch, true);
});
route("POST", "/chantiers/situations/:id/cancel", CH_WRITE, (ctx) => {
  const s = situationOf(ctx, ctx.params[0]);
  if (s.state === "invoiced") throw businessRule("Une situation facturée s'annule par un avoir.");
  s.state = "cancelled";
  return chantierRow(DB.chantiers.find((c) => c.id === s.chantier_id), true);
});
route("POST", "/chantiers/:id/release-retention", ["admin", "finance"], (ctx) => {
  const ch = chantierOf(ctx, ctx.params[0]);
  const outstanding = chantierTotals(ch).retention_total - ch.retention_released;
  if (outstanding <= 0.5) throw businessRule("Aucune retenue à libérer sur ce chantier.");
  ch.retention_released += outstanding;
  ch.releaseDate = TODAY;
  return chantierRow(ch, true);
});

/* ─── Immobilier ────────────────────────────────────────────────────────── */

function leaseRow(l) {
  const p = DB.properties.find((x) => x.id === l.property_id);
  return {
    id: l.id, name: l.name, property: { id: p.id, name: p.name }, tenant: partnerRef(l.partner_id), date_start: l.date_start, date_end: l.date_end, rent: l.rent, charges: l.charges,
    periodicity: l.periodicity, vat: l.vat, deposit_amount: l.deposit_amount, state: l.state, next_invoice_date: l.next_invoice_date,
  };
}
function propertyRow(p) {
  const active = DB.leases.find((l) => l.property_id === p.id && l.state === "active");
  return {
    id: p.id, name: p.name, kind: p.kind, address: p.address, city: p.city, area_m2: p.area_m2, acquisition_date: p.acquisition_date, acquisition_value: p.acquisition_value,
    current_value: p.current_value, valuation_date: p.valuation_date, occupied: Boolean(active), lease: active ? leaseRow(active) : null, active: p.active,
  };
}
const rentMoves = (cids) => DB.moves.filter((m) => m.lease_id && cids.includes(m.company_id) && m.state !== "cancel");
const unpaidRents = (cids, day) =>
  rentMoves(cids).filter((m) => m.state === "posted" && ["not_paid", "partial"].includes(m.payment_state) && m.invoice_date_due && m.invoice_date_due < day).sort((a, b) => a.invoice_date_due.localeCompare(b.invoice_date_due));
function propertyValues(p, data) {
  for (const key of ["name", "address", "city", "note"]) if (key in data) p[key] = data[key] || null;
  if (PROPERTY_KINDS.some(([k]) => k === data.kind)) p.kind = data.kind;
  for (const key of ["area_m2", "acquisition_value", "current_value"]) if (key in data) p[key] = numArg(data[key] || 0, key);
  for (const key of ["acquisition_date", "valuation_date"]) if (key in data) p[key] = dateArg(data, key);
  if ("active" in data) p.active = Boolean(data.active);
}
function leaseOf(ctx, id) {
  const l = DB.leases.find((x) => x.id === id && x.company_id === ctx.company);
  if (!l) throw notFound("Bail introuvable.");
  return l;
}
function issueRent(lease, date) {
  const prop = DB.properties.find((p) => p.id === lease.property_id);
  const step = lease.periodicity === "quarterly" ? 3 : lease.periodicity === "yearly" ? 12 : 1;
  const label = step === 1 ? monthLabel(date) : `du ${frDate(date)} au ${frDate(addDays(addMonths(date, step), -1))}`;
  const tax = lease.vat ? defaultTax(lease.company_id, "sale").id : exemptTax(lease.company_id, "sale").id;
  const lines = [{ name: `Loyer ${label} : ${prop.name}`, account: "706300", quantity: 1, price_unit: lease.rent, tax_id: tax }];
  if (lease.charges) lines.push({ name: `Charges locatives ${label}`, account: "707100", quantity: 1, price_unit: lease.charges, tax_id: tax });
  lease.next_invoice_date = addMonths(date, step);
  return createMove({ company_id: lease.company_id, move_type: "out_invoice", partner_id: lease.partner_id, journal_id: journalOf(lease.company_id, "VTE").id, date, due: addDays(date, step === 1 ? 5 : 10), origin: lease.name, lease_id: lease.id, state: "posted", lines });
}
route("GET", "/immobilier/summary", IM_READ, (ctx) => {
  const cids = scopeCompanies(ctx);
  const props = DB.properties.filter((p) => cids.includes(p.company_id));
  const active = DB.leases.filter((l) => cids.includes(l.company_id) && l.state === "active");
  const factor = { monthly: 12, quarterly: 4, yearly: 1 };
  const annualRent = sum(active, (l) => (l.rent + (l.charges || 0)) * factor[l.periodicity]);
  const value = sum(props, (p) => p.current_value) || sum(props, (p) => p.acquisition_value);
  const unpaid = unpaidRents(cids, TODAY);
  const occupied = props.filter(propertyOccupied).length;
  return {
    properties: props.length, occupied, occupancy_rate: props.length ? (occupied / props.length) * 100 : null, annual_rent: annualRent, portfolio_value: value,
    gross_yield: value ? (annualRent / value) * 100 : null, unpaid_count: unpaid.length, unpaid_amount: sum(unpaid, (m) => m.amount_residual),
    leases_expiring_3m: active.filter((l) => l.date_end && l.date_end <= addMonths(TODAY, 3)).length, as_of: TODAY,
  };
});
route("GET", "/immobilier/properties", IM_READ, (ctx) => ({
  items: DB.properties.filter((p) => p.company_id === ctx.company).map(propertyRow), kinds: PROPERTY_KINDS.map(([code, label]) => ({ code, label })),
}));
route("POST", "/immobilier/properties", IM_WRITE, (ctx) => {
  requireFields(ctx.body, "name");
  const p = { id: newId("property"), company_id: ctx.company, name: "", kind: "appartement", address: null, city: "Conakry", area_m2: 0, acquisition_date: null, acquisition_value: 0, current_value: 0, valuation_date: null, note: null, active: true };
  propertyValues(p, ctx.body);
  DB.properties.push(p);
  return propertyRow(p);
});
route("PATCH", "/immobilier/properties/:id", IM_WRITE, (ctx) => {
  const p = DB.properties.find((x) => x.id === ctx.params[0] && x.company_id === ctx.company);
  if (!p) throw notFound("Bien introuvable.");
  propertyValues(p, ctx.body);
  return propertyRow(p);
});
route("GET", "/immobilier/leases", IM_READ, (ctx) => {
  const states = ctx.query.state ? ctx.query.state.split(",") : null;
  return DB.leases.filter((l) => l.company_id === ctx.company && (!states || states.includes(l.state))).map(leaseRow);
});
route("POST", "/immobilier/leases", IM_WRITE, (ctx) => {
  const [name, propertyId, partnerId, , rent] = requireFields(ctx.body, "name", "property_id", "partner_id", "date_start", "rent");
  const prop = DB.properties.find((p) => p.id === Number(propertyId) && p.company_id === ctx.company);
  if (!prop) throw businessRule("Bien introuvable.");
  if (ctx.body.activate && propertyOccupied(prop)) throw businessRule("Ce bien est déjà loué : mettez d'abord fin au bail en cours.");
  const lease = {
    id: newId("lease"), company_id: ctx.company, name: String(name), property_id: prop.id, partner_id: Number(partnerId), date_start: dateArg(ctx.body, "date_start"), date_end: dateArg(ctx.body, "date_end"),
    rent: numArg(rent, "rent"), charges: ctx.body.charges ? numArg(ctx.body.charges, "charges") : 0, deposit_amount: ctx.body.deposit_amount ? numArg(ctx.body.deposit_amount, "deposit_amount") : 0,
    vat: Boolean(ctx.body.vat), periodicity: ["monthly", "quarterly", "yearly"].includes(ctx.body.periodicity) ? ctx.body.periodicity : "monthly", state: "draft", next_invoice_date: null, payDelay: 5,
  };
  DB.leases.push(lease);
  if (ctx.body.activate) {
    lease.state = "active";
    lease.next_invoice_date = lease.date_start;
  }
  return leaseRow(lease);
});
route("POST", "/immobilier/leases/:id/activate", IM_WRITE, (ctx) => {
  const lease = leaseOf(ctx, ctx.params[0]);
  lease.state = "active";
  lease.next_invoice_date = lease.next_invoice_date || lease.date_start;
  return leaseRow(lease);
});
route("POST", "/immobilier/leases/:id/terminate", IM_WRITE, (ctx) => {
  const lease = leaseOf(ctx, ctx.params[0]);
  const end = dateArg(ctx.body, "date", TODAY);
  if (end < lease.date_start) throw businessRule("La date de fin précède la prise d'effet du bail.");
  while (lease.next_invoice_date && lease.next_invoice_date <= minDate(end, TODAY)) issueRent(lease, lease.next_invoice_date);
  Object.assign(lease, { state: "terminated", date_end: end, next_invoice_date: null });
  return leaseRow(lease);
});
route("POST", "/immobilier/rents/generate", ["admin", "finance", "immobilier"], (ctx) => {
  const until = dateArg(ctx.body, "until", TODAY);
  const invoices = [];
  for (const lease of DB.leases.filter((l) => scopeCompanies(ctx).includes(l.company_id) && l.state === "active")) {
    while (lease.next_invoice_date && lease.next_invoice_date <= until && (!lease.date_end || lease.next_invoice_date <= lease.date_end)) invoices.push(issueRent(lease, lease.next_invoice_date));
  }
  return { invoices: invoices.map(moveSummary) };
});
route("GET", "/immobilier/rents", IM_READ, (ctx) =>
  rentMoves([ctx.company])
    .sort((a, b) => (b.invoice_date || b.date).localeCompare(a.invoice_date || a.date) || b.id - a.id)
    .slice(0, 500)
    .map(moveSummary));
route("GET", "/immobilier/unpaid", IM_READ, (ctx) => unpaidRents(scopeCompanies(ctx), TODAY).map((m) => ({ ...moveSummary(m), late_days: daysBetween(m.invoice_date_due, TODAY) })));
route("GET", "/immobilier/receipts/:id", IM_READ, (ctx) => {
  const m = moveById(ctx.params[0]);
  if (!m || !inCompanies(ctx, m.company_id)) throw notFound("Facture introuvable.");
  if (!["paid", "in_payment"].includes(m.payment_state)) throw businessRule("La quittance n'est délivrée que pour un loyer entièrement réglé.");
  const lease = DB.leases.find((l) => l.id === m.lease_id);
  const prop = lease ? DB.properties.find((p) => p.id === lease.property_id) : null;
  const c = COMPANIES[m.company_id];
  return {
    number: m.name, date: m.invoice_date, company: c.name, company_address: [c.street, c.city].filter(Boolean).join(", ") || null, tenant: partnerName(m.partner_id),
    property: prop?.name ?? null, property_address: prop?.address ?? null,
    lines: m.lines.map((l) => {
      const sub = round(l.quantity * l.price_unit);
      const tax = l.tax_id ? taxById(l.tax_id) : null;
      return { name: l.name, amount: tax ? sub + round((sub * tax.amount) / 100) : sub };
    }),
    amount_total: m.amount_total, payments: moveDetail(m).payments,
  };
});

/* ─── AxisPro Suite ─────────────────────────────────────────────────────── */

/** Politique d'évaluation (_policy_payload du noyau) : réglages, contrôle de cohérence, gates, compartiments,
 * domaines, critères et pièces. */
function policyPayload(p) {
  const compartments = p.compartments || [];
  const loose = compartments.length ? p.domains.filter((dm) => !dm.compartment_id) : [];
  const koNotCritical = p.criteria.filter((c) => c.knockout && !c.critical);
  return {
    id: p.id, name: p.name, version: p.version, state: p.state, date_active: p.date_active, go_threshold: p.go_threshold, conditional_threshold: p.conditional_threshold, notes: p.notes,
    threshold_bankable: p.threshold_bankable ?? 80, threshold_hold: p.threshold_hold ?? 40, dscr_target: p.dscr_target ?? 1.2, weighting: p.weighting ?? "domain",
    ko_partial_blocks: Boolean(p.ko_partial_blocks), evidence_check: Boolean(p.evidence_check), exclude_na: p.exclude_na !== false, expiry_check: Boolean(p.expiry_check),
    capex_criterion_id: p.capex_criterion_id ?? null,
    weightings: { flat: "À plat sur toute la grille", domain: "Par domaine, selon leur pondération" }, rules: AX_RULES, scopes: AX_SCOPES, requirements: AX_REQUIREMENTS,
    integrity: {
      criteria: p.criteria.length, domains: p.domains.length, gates: p.gates.length, compartments: compartments.length, documents: p.documents.length,
      weight: sum(p.criteria, (c) => c.weight), knockouts: p.criteria.filter((c) => c.knockout).length, critical: p.criteria.filter((c) => c.critical).length,
      bankability: p.criteria.filter((c) => c.bankability).length,
      requirements: Object.fromEntries(Object.keys(AX_REQUIREMENTS).map((k) => [k, p.criteria.filter((c) => (c.requirement_type ?? "apd") === k).length])),
      links: 0, gates_without_criteria: p.gates.filter((g) => !p.criteria.some((c) => c.gate_id === g.id)).map((g) => g.code),
      notes: [
        ...(koNotCritical.length ? [`${pluriel(koNotCritical.length, "critère éliminatoire non marqué critique", "critères éliminatoires non marqués critiques")} : ${koNotCritical.map((c) => c.code).join(", ")}.`] : []),
        ...(loose.length ? [`${pluriel(loose.length, "domaine sans compartiment", "domaines sans compartiment")} : ${loose.map((dm) => dm.name).join(", ")}.`] : []),
      ],
    },
    gates: p.gates.map((g) => ({
      id: g.id, code: g.code, name: g.name, sequence: g.sequence, description: g.description ?? null, rule_code: g.rule_code ?? "generic",
      threshold_hold: g.threshold_hold || null, threshold_go: g.threshold_go || null, score_scope: g.score_scope ?? "global", domain_ids: g.domain_ids ?? [],
      min_completeness: g.min_completeness || null, entry_requirements: g.entry_requirements ?? null, deliverables: g.deliverables ?? null, exit_criteria: g.exit_criteria ?? null,
    })),
    compartments: compartments.map((k) => ({ id: k.id, code: k.code, name: k.name, sequence: k.sequence, domain_ids: p.domains.filter((dm) => dm.compartment_id === k.id).map((dm) => dm.id) })),
    domains: p.domains.map((dm) => ({ id: dm.id, code: dm.code, name: dm.name, weight: dm.weight, deliverable: dm.deliverable ?? null, compartment_id: dm.compartment_id ?? null })),
    criteria: p.criteria.map((c) => ({
      id: c.id, code: c.code, name: c.name, domain_id: c.domain_id, gate_id: c.gate_id, weight: c.weight, critical: c.critical, knockout: c.knockout,
      evidence_required: c.evidence_required, guidance: c.guidance, requirement_type: c.requirement_type ?? "apd", bankability: Boolean(c.bankability),
      deliverable: c.deliverable ?? null, pieces: [], indicator: c.indicator ?? null, indicator_threshold: c.indicator ? (c.indicator_threshold ?? 0) : null, indicator_partial: null,
    })),
    indicators: AX_INDICATORS,
    documents: p.documents.map(({ id, code, name, category, gate_id, required, guidance }) => ({ id, code, name, category, gate_id, required, guidance, criteria: [] })),
  };
}
function dossierSummary(d) {
  const policy = policyById(d.policy_id);
  const score = scoring(d);
  const due = documentsStatus(d).filter((x) => x.due && x.required);
  const gate = policy.gates.find((g) => g.id === d.current_gate_id);
  return {
    id: d.id, reference: d.reference, name: d.name, state: d.state, promoter: partnerRef(d.promoter_id), consultant: d.consultant_id ? userName(d.consultant_id) : null,
    sector: d.sector, location: d.location, investment: d.investment, financing_need: d.financing_need,
    current_gate: gate ? { id: gate.id, code: gate.code, name: gate.name } : null, gates: policy.gates.map(({ id, code, name, sequence }) => ({ id, code, name, sequence })),
    score: score.global_score, readiness: score.readiness, apd: score.apd, bankability: score.bankability, completeness: score.completeness,
    dataroom_completeness: score.dataroom_completeness, classification: score.classification,
    next_gate: score.next_gate ? { code: score.next_gate.code, name: score.next_gate.name, decision: score.next_gate.decision } : null,
    currency: { id: 1, name: "GNF", symbol: "GNF" },
    recommendation: score.recommendation, knockouts: score.knockouts.length, decision: d.decision,
    // Recommandation de la méthode même pendant la saisie et critères des gates atteints à évaluer (score provisoire en liste).
    method_recommendation: score.method_recommendation, pending_in_scope: score.pending_in_scope,
    progress: { assessed: score.assessed, criteria: score.criteria },
    documents: { due: due.length, received: due.filter((x) => ["received", "validated"].includes(x.state)).length, available: due.filter((x) => x.state !== "missing").length, total: due.length },
    policy_version: policy.version, revision: 0, locked: false, financial: null,
    risks: { open: 0, levels: { critical: 0, high: 0, moderate: 0, low: 0 }, top: 0 },
    actions: { open: 0, overdue: 0, submitted: 0, done: 0 },
  };
}
function reviewRow(r) {
  const d = DB.dossiers.find((x) => x.id === r.dossier_id);
  const gate = policyById(d.policy_id).gates.find((g) => g.id === r.gate_id);
  return {
    id: r.id, date: r.date, gate: gate?.code ?? null, members: r.members, recommendation: r.recommendation, decision: r.decision, conditions: r.conditions, minutes: r.minutes,
    state: r.state, locked_by: r.locked_by ? userName(r.locked_by) : null, locked_at: r.locked_at, policy_version: r.policy_version, score: r.snapshot?.global_score ?? null,
  };
}
const dossierReviews = (d) => DB.reviews.filter((r) => r.dossier_id === d.id).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
function dossierDetail(d) {
  return {
    ...dossierSummary(d), capacity: d.capacity, date_start: d.date_start, date_evaluation: null, description: d.description, hypotheses: d.hypotheses,
    decision_inputs: { dscr_manual: null, irr_manual: null, dd_red_flag: null, dataroom_open: null, lenders_agreement: null, cp_lifted: null, financing_signed: null },
    locked_review: null, scoring: scoring(d), gaps: gaps(d, 5),
    portal_users: d.portal_user_ids.map((id) => userById(id)).filter(Boolean).map((u) => ({ id: u.id, name: u.name, login: u.login })),
    reviews: dossierReviews(d).map(reviewRow),
  };
}
function documentRow(doc) {
  return {
    id: doc.id, name: doc.name, version: doc.version, state: doc.state, comment: doc.comment, document_type_id: doc.document_type_id, uploaded_by: userName(doc.uploaded_by),
    uploaded_at: doc.uploaded_at, mimetype: doc.mimetype, size: doc.size, portal_visible: doc.portal_visible,
  };
}
const messageRow = (m) => ({ id: m.id, author: userName(m.author_id), from_promoter: m.from_promoter, body: m.body, date: m.date, internal: m.internal });
function dossierOf(ctx, id) {
  const d = DB.dossiers.find((x) => x.id === id && x.company_id === ctx.company);
  if (!d) throw notFound("Dossier introuvable.");
  return d;
}
const DOC_FILES = new Map();
/** Fichier d'une pièce de data room : le fichier déposé, sinon un document de maquette. */
function documentFile(doc) {
  if (DOC_FILES.has(doc.id)) return fileReply(DOC_FILES.get(doc.id), doc.mimetype, doc.filename);
  const d = DB.dossiers.find((x) => x.id === doc.dossier_id);
  const base = (doc.filename || slug(doc.name)).replace(/\.[^.]+$/, "");
  if (doc.mimetype === XLSX) return fileReply(xlsxBuffer([{ name: "Pièce", rows: [["Pièce", "Dossier", "Version"], [doc.name, d.reference, doc.version], ["Fichier de maquette : données fictives."]] }]), XLSX, `${base}.xlsx`);
  return fileReply(pdfBuffer(doc.name, [`Dossier ${d.reference} : ${d.name}`, `Version ${doc.version}, déposée le ${frDate(doc.uploaded_at.slice(0, 10))} par ${userName(doc.uploaded_by)}`, "", "Fichier de maquette : données fictives."]), "application/pdf", `${base}.pdf`);
}
function storeUpload(ctx, d, typeId, name, portalVisible) {
  const file = uploadedFile(ctx, 20 * 1048576);
  const mimetype = detectType(file.data);
  if (!mimetype) throw new ApiError(415, "unsupported_type", `Formats acceptés : ${ACCEPTED}. Enregistrez le document dans l'un de ces formats.`);
  const policy = policyById(d.policy_id);
  const type = typeId ? policy.documents.find((t) => t.id === Number(typeId)) : null;
  if (typeId && !type) throw businessRule("Pièce standard inconnue pour ce dossier.");
  const previous = type ? DB.documents.filter((x) => x.dossier_id === d.id && x.document_type_id === type.id).map((x) => x.version) : [];
  const filename = checkedName(file.filename, mimetype);
  const doc = {
    id: newId("document"), dossier_id: d.id, document_type_id: type?.id ?? null, name: name || type?.name || filename, version: previous.length ? Math.max(...previous) + 1 : 1,
    state: "received", comment: null, uploaded_by: ctx.user.id, uploaded_at: nowStamp(), mimetype, size: file.data.length, portal_visible: portalVisible, filename,
  };
  DOC_FILES.set(doc.id, file.data);
  DB.documents.push(doc);
  return doc;
}
function copyPolicy(source, overrides) {
  const id = newId("policy");
  const version = Math.max(...DB.policies.filter((p) => p.company_id === source.company_id).map((p) => p.version)) + 1;
  const gateMap = new Map(source.gates.map((g, i) => [g.id, id * 10 + i + 1]));
  const domainMap = new Map(source.domains.map((dm, i) => [dm.id, id * 100 + i + 1]));
  const compartmentMap = new Map((source.compartments || []).map((k, i) => [k.id, id * 100 + 60 + i + 1]));
  const p = {
    ...source, id, version, state: "draft", date_active: null, ...overrides,
    gates: source.gates.map((g) => ({ ...g, id: gateMap.get(g.id), domain_ids: (g.domain_ids || []).map((x) => domainMap.get(x)) })),
    compartments: (source.compartments || []).map((k) => ({ ...k, id: compartmentMap.get(k.id) })),
    domains: source.domains.map((dm) => ({ ...dm, id: domainMap.get(dm.id), compartment_id: dm.compartment_id ? (compartmentMap.get(dm.compartment_id) ?? null) : null })),
    criteria: source.criteria.map((c) => ({ ...c, id: id * 1000 + c.number, domain_id: domainMap.get(c.domain_id), gate_id: gateMap.get(c.gate_id) })),
    documents: source.documents.map((t) => ({ ...t, id: id * 1000 + 500 + t.number, gate_id: t.gate_id ? gateMap.get(t.gate_id) : null })),
  };
  DB.policies.push(p);
  return p;
}
function policyOf(ctx, id) {
  const p = DB.policies.find((x) => x.id === id && x.company_id === ctx.company);
  if (!p) throw notFound("Politique introuvable.");
  return p;
}
route("GET", "/axispro/policies", AX_READ, (ctx) =>
  DB.policies
    .filter((p) => p.company_id === ctx.company)
    .sort((a, b) => b.version - a.version)
    .map((p) => ({ id: p.id, name: p.name, version: p.version, state: p.state, date_active: p.date_active, criteria: p.criteria.length, domains: p.domains.length, gates: p.gates.length, documents: p.documents.length, weighting: p.weighting ?? "domain" })));
route("GET", "/axispro/policies/template", AX_READ, () => {
  const rows = [
    ["type", "code", "libelle", "domaine", "gate", "poids", "critique", "eliminatoire", "preuve", "aide"],
    ["gate", "G0", "Idée et opportunité", "", "", "", "", "", "", "Le projet répond-il à un besoin avéré ?"],
    ["domaine", "D01", "Marché et demande", "", "", 10, "", "", "", ""],
    ["critere", "C001", "Étude de marché documentée", "D01", "G0", 3, "oui", "non", "oui", "Joindre l'étude."],
    ["piece", "P01", "Statuts de la société", "Juridique", "G0", "", "oui", "", "", "Copie certifiée."],
  ];
  return fileReply(xlsxBuffer([{ name: "Grille", rows }]), XLSX, "grille_axispro_modele.xlsx");
});
route("GET", "/axispro/policy", AX_READ, (ctx) => {
  const p = activePolicy(ctx.company);
  return p ? policyPayload(p) : null;
});
route("GET", "/axispro/policies/:id", AX_READ, (ctx) => policyPayload(policyOf(ctx, ctx.params[0])));
route("POST", "/axispro/policies/import", AX_WRITE, (ctx) => {
  const file = uploadedFile(ctx, 10 * 1048576, "Classeur");
  if (!/\.(xlsx|xlsm|csv)$/i.test(file.filename)) throw businessRule("Classeur illisible : envoyer un fichier XLSX ou CSV aux colonnes du modèle.");
  const source = activePolicy(ctx.company) ?? DB.policies.filter((p) => p.company_id === ctx.company).sort((a, b) => b.version - a.version)[0];
  const fields = ctx.multipart().fields;
  const p = copyPolicy(source, {
    name: fields.name || "Politique d'évaluation AxisPro", go_threshold: Number(fields.go_threshold) || 70, conditional_threshold: Number(fields.conditional_threshold) || 50, notes: fields.notes || null,
  });
  return policyPayload(p);
});
route("POST", "/axispro/policies/:id/activate", AX_WRITE, (ctx) => {
  const p = policyOf(ctx, ctx.params[0]);
  if (!p.criteria.length || !p.gates.length) throw businessRule("Une politique sans gates ni critères ne peut pas entrer en vigueur.");
  for (const other of DB.policies.filter((x) => x.company_id === p.company_id && x.state === "active" && x.id !== p.id)) other.state = "archived";
  Object.assign(p, { state: "active", date_active: TODAY });
  return policyPayload(p);
});
route("POST", "/axispro/policies/:id/new-version", AX_WRITE, (ctx) => policyPayload(copyPolicy(policyOf(ctx, ctx.params[0]), {})));
route("PATCH", "/axispro/criteria/:id", AX_WRITE, (ctx) => {
  const policy = DB.policies.find((p) => p.company_id === ctx.company && p.criteria.some((c) => c.id === ctx.params[0]));
  if (!policy) throw notFound("Critère introuvable.");
  if (policy.state !== "draft") throw businessRule("Seule une version en brouillon se modifie : créez une nouvelle version.");
  const c = policy.criteria.find((x) => x.id === ctx.params[0]);
  for (const key of ["name", "guidance"]) if (key in ctx.body) c[key] = ctx.body[key];
  for (const key of ["critical", "knockout", "evidence_required", "bankability"]) if (key in ctx.body) c[key] = Boolean(ctx.body[key]);
  if ("weight" in ctx.body) c.weight = numArg(ctx.body.weight, "weight");
  if (ctx.body.requirement_type in AX_REQUIREMENTS) c.requirement_type = ctx.body.requirement_type;
  return { status: "ok" };
});
/** Version en brouillon de la société contenant l'élément (gate, domaine, compartiment). */
function draftPolicyWith(ctx, key, id, label) {
  const policy = DB.policies.find((p) => p.company_id === ctx.company && (p[key] || []).some((x) => x.id === id));
  if (!policy) throw notFound(`${label} introuvable.`);
  if (policy.state !== "draft") throw businessRule("Seule une version en brouillon se modifie : créez une nouvelle version.");
  return policy;
}
function percentArg(data, key) {
  const v = numArg(data[key] || 0, key);
  if (v < 0 || v > 100) throw badParam(`${key} : valeur de 0 à 100 attendue.`);
  return v;
}
route("PATCH", "/axispro/policies/:id", AX_WRITE, (ctx) => {
  const p = policyOf(ctx, ctx.params[0]);
  if (p.state !== "draft") throw businessRule("Seule une version en brouillon se modifie : créez une nouvelle version.");
  const data = ctx.body;
  for (const key of ["name", "notes"]) if (key in data) p[key] = data[key] || null;
  for (const key of ["threshold_bankable", "go_threshold", "conditional_threshold", "threshold_hold"]) if (key in data) p[key] = percentArg(data, key);
  if ("dscr_target" in data) p.dscr_target = numArg(data.dscr_target || 0, "dscr_target");
  if (["flat", "domain"].includes(data.weighting)) p.weighting = data.weighting;
  for (const key of ["ko_partial_blocks", "evidence_check", "exclude_na", "expiry_check"]) if (key in data) p[key] = Boolean(data[key]);
  if ("capex_criterion_id" in data) p.capex_criterion_id = p.criteria.some((c) => c.id === Number(data.capex_criterion_id)) ? Number(data.capex_criterion_id) : null;
  return policyPayload(p);
});
route("PATCH", "/axispro/gates/:id", AX_WRITE, (ctx) => {
  const policy = draftPolicyWith(ctx, "gates", ctx.params[0], "Gate");
  const g = policy.gates.find((x) => x.id === ctx.params[0]);
  const data = ctx.body;
  for (const key of ["name", "description", "entry_requirements", "deliverables", "exit_criteria"]) if (key in data) g[key] = data[key] || null;
  if ("rule_code" in data) {
    if (!AX_RULES[data.rule_code]) throw badParam("Règle de passage inconnue.");
    g.rule_code = data.rule_code;
  }
  for (const key of ["threshold_hold", "threshold_go", "min_completeness"]) if (key in data) g[key] = percentArg(data, key) || null;
  if (data.score_scope in AX_SCOPES) g.score_scope = data.score_scope;
  if ("domain_ids" in data) g.domain_ids = policy.domains.filter((dm) => (data.domain_ids || []).map(Number).includes(dm.id)).map((dm) => dm.id);
  return policyPayload(policy);
});
route("PATCH", "/axispro/domains/:id", AX_WRITE, (ctx) => {
  const policy = draftPolicyWith(ctx, "domains", ctx.params[0], "Domaine");
  const dm = policy.domains.find((x) => x.id === ctx.params[0]);
  const data = ctx.body;
  for (const key of ["name", "deliverable"]) if (key in data) dm[key] = data[key] || null;
  if ("weight" in data) dm.weight = numArg(data.weight, "weight");
  if ("compartment_id" in data) {
    const wanted = data.compartment_id ? Number(data.compartment_id) : null;
    if (wanted && !(policy.compartments || []).some((k) => k.id === wanted)) throw badParam("Compartiment inconnu dans cette version de la grille.");
    dm.compartment_id = wanted;
  }
  return { status: "ok" };
});
route("PATCH", "/axispro/compartments/:id", AX_WRITE, (ctx) => {
  const policy = draftPolicyWith(ctx, "compartments", ctx.params[0], "Compartiment");
  const k = policy.compartments.find((x) => x.id === ctx.params[0]);
  for (const key of ["code", "name"]) if (ctx.body[key]) k[key] = String(ctx.body[key]).trim().slice(0, 200);
  return policyPayload(policy);
});
/** Consultants du cabinet ouverts à la société de travail, à qui confier un compartiment. */
const axConsultants = (ctx) => USERS.filter((u) => u.active && u.profiles.includes("cabinet") && u.companies.includes(ctx.company)).sort((a, b) => a.name.localeCompare(b.name, "fr"));
route("GET", "/axispro/consultants", AX_READ, (ctx) => axConsultants(ctx).map((u) => ({ id: u.id, name: u.name })));
route("POST", "/axispro/dossiers/:id/assignments", AX_WRITE, (ctx) => {
  const d = dossierOf(ctx, ctx.params[0]);
  const [compartmentId] = requireFields(ctx.body, "compartment_id");
  const k = (policyById(d.policy_id).compartments || []).find((x) => x.id === Number(compartmentId));
  if (!k) throw notFound("Compartiment introuvable dans la grille du dossier.");
  const userId = ctx.body.user_id ? Number(ctx.body.user_id) : null;
  if (userId && !axConsultants(ctx).some((u) => u.id === userId)) throw businessRule("Seul un consultant du cabinet ouvert à cette société peut recevoir un compartiment.");
  DB.assignments = (DB.assignments || []).filter((a) => !(a.dossier_id === d.id && a.compartment_id === k.id));
  if (userId) DB.assignments.push({ dossier_id: d.id, compartment_id: k.id, user_id: userId });
  return { status: "ok", compartments: scoring(d).compartments };
});
route("GET", "/axispro/dossiers", AX_READ, (ctx) => {
  const states = ctx.query.state ? ctx.query.state.split(",") : null;
  const s = (ctx.query.search || "").toLowerCase();
  return DB.dossiers
    .filter((d) => d.company_id === ctx.company && (!states || states.includes(d.state)) && (!s || d.name.toLowerCase().includes(s) || d.reference.toLowerCase().includes(s)))
    .sort((a, b) => b.id - a.id)
    .slice(0, limitOf(ctx.query, 200, 1000))
    .map(dossierSummary);
});
function dossierValues(d, data) {
  for (const key of ["name", "sector", "location", "capacity", "description", "hypotheses"]) if (key in data) d[key] = data[key] || null;
  for (const key of ["investment", "financing_need"]) if (key in data) d[key] = numArg(data[key] || 0, key);
  if ("date_start" in data) d.date_start = dateArg(data, "date_start");
  if (data.promoter_id) d.promoter_id = Number(data.promoter_id);
  if (["open", "on_hold", "closed"].includes(data.state)) d.state = data.state;
}
route("POST", "/axispro/dossiers", AX_WRITE, (ctx) => {
  requireFields(ctx.body, "name", "promoter_id");
  const policy = activePolicy(ctx.company);
  if (!policy) throw businessRule("Aucune politique d'évaluation en vigueur : importez puis activez la grille.");
  const year = TODAY.slice(0, 4);
  const numbers = DB.dossiers.filter((d) => d.reference.startsWith(`AX/${year}/`)).map((d) => +d.reference.slice(-4));
  const d = {
    id: newId("dossier"), reference: `AX/${year}/${pad((numbers.length ? Math.max(...numbers) : 0) + 1, 4)}`, name: "", company_id: ctx.company, policy_id: policy.id, promoter_id: null,
    portal_user_ids: [], consultant_id: ctx.user.id, sector: null, location: null, capacity: null, investment: 0, financing_need: 0, date_start: null, description: null, hypotheses: null,
    current_gate_id: [...policy.gates].sort((a, b) => a.sequence - b.sequence)[0].id, state: "open", decision: null, opened: TODAY,
  };
  dossierValues(d, ctx.body);
  DB.dossiers.push(d);
  for (const c of policy.criteria) DB.evaluations.push({ id: ++IDS.evaluation, dossier_id: d.id, criterion_id: c.id, status: "not_assessed", comment: null, document_ids: [], assessed_by: null, assessed_at: null });
  DB.analytic.push({ id: newId("analytic"), company_id: ctx.company, plan: "dossier", name: `${d.reference} ${d.name}`, code: d.reference, active: true });
  return dossierDetail(d);
});
route("GET", "/axispro/dossiers/:id", AX_READ, (ctx) => dossierDetail(dossierOf(ctx, ctx.params[0])));
route("PATCH", "/axispro/dossiers/:id", AX_WRITE, (ctx) => {
  const d = dossierOf(ctx, ctx.params[0]);
  dossierValues(d, ctx.body);
  return dossierDetail(d);
});
route("POST", "/axispro/dossiers/:id/portal-access", AX_WRITE, (ctx) => {
  const d = dossierOf(ctx, ctx.params[0]);
  const [login, name] = requireFields(ctx.body, "login", "name", "password");
  const clean = String(login).trim().toLowerCase();
  let user = USERS.find((u) => u.login === clean);
  if (user && !user.profiles.includes("porteur")) throw new ApiError(409, "conflict", "Cet identifiant appartient à un utilisateur interne.");
  if (!user) {
    user = { id: newId("user"), login: clean, name: String(name), email: ctx.body.email || null, profiles: ["porteur"], companies: [d.company_id], company_id: d.company_id, mfa: false, active: true, temp: true, last_login: null };
    USERS.push(user);
  }
  if (!d.portal_user_ids.includes(user.id)) d.portal_user_ids.push(user.id);
  return dossierDetail(d);
});
/** Check-list du dossier : filtres gate_id, compartment_id et mine=1 (compartiments confiés à l'utilisateur). */
route("GET", "/axispro/dossiers/:id/criteria", AX_READ, (ctx) => {
  const d = dossierOf(ctx, ctx.params[0]);
  const policy = policyById(d.policy_id);
  const gateId = intArg(ctx.query, "gate_id");
  const compartmentId = intArg(ctx.query, "compartment_id");
  const owners = new Map((DB.assignments || []).filter((a) => a.dossier_id === d.id).map((a) => [a.compartment_id, a.user_id]));
  const mine = ["1", "true"].includes(ctx.query.mine) ? new Set([...owners].filter(([, u]) => u === ctx.user.id).map(([k]) => k)) : null;
  const priorities = new Map(gaps(d, 100000).map((g) => [g.criterion_id, Math.round(g.priority * 100) / 100]));
  return evaluationsOf(d)
    .map((e) => ({ e, c: criterionOf(policy, e.criterion_id) }))
    .filter((x) => x.c && (!gateId || x.c.gate_id === gateId))
    .map(({ e, c }) => {
      const domain = policy.domains.find((dm) => dm.id === c.domain_id);
      const comp = (policy.compartments || []).find((k) => k.id === domain.compartment_id);
      return {
        id: e.id, criterion_id: c.id, code: c.code, name: c.name, domain: domain.name, domain_id: domain.id, domain_code: domain.code,
        compartment_id: comp?.id ?? null, compartment: comp?.code ?? null, compartment_name: comp?.name ?? null,
        owner: comp && owners.has(comp.id) ? userName(owners.get(comp.id)) : null,
        gate_id: c.gate_id, gate: policy.gates.find((g) => g.id === c.gate_id)?.code ?? null, weight: c.weight, critical: c.critical, knockout: c.knockout,
        evidence_required: c.evidence_required, requirement: c.requirement_type ?? "apd", bankability: Boolean(c.bankability), guidance: c.guidance,
        status: e.status, retained: e.status, points: STATUS_VALUES[e.status] ?? 0, alerts: [], priority: priorities.get(c.id) ?? null,
        comment: e.comment, deliverable: e.deliverable ?? null, default_deliverable: c.guidance || `Compléter : ${c.name}`, responsible: e.responsible ?? null, due_date: e.due_date ?? null,
        documents: e.document_ids.map((id) => DB.documents.find((x) => x.id === id)).filter(Boolean).map((doc) => ({ id: doc.id, name: doc.name, version: doc.version, state: doc.state, validity_date: doc.validity_date ?? null })),
        pieces: [], assessed_by: e.assessed_by ? userName(e.assessed_by) : null, assessed_at: e.assessed_at, indicator: null, suggestion: null,
      };
    })
    .filter((row) => (!compartmentId || row.compartment_id === compartmentId) && (!mine || mine.has(row.compartment_id)));
});
route("PATCH", "/axispro/evaluations/:id", AX_WRITE, (ctx) => {
  const e = DB.evaluations.find((x) => x.id === ctx.params[0]);
  const d = e ? DB.dossiers.find((x) => x.id === e.dossier_id && x.company_id === ctx.company) : null;
  if (!e || !d) throw notFound("Évaluation introuvable.");
  const data = ctx.body;
  const c = criterionOf(policyById(d.policy_id), e.criterion_id);
  let docs = e.document_ids;
  if ("document_ids" in data) {
    docs = (data.document_ids || []).map(Number);
    if (docs.some((id) => !DB.documents.some((doc) => doc.id === id && doc.dossier_id === d.id))) throw businessRule("Les preuves doivent provenir de la data room du dossier.");
  }
  if ("status" in data) {
    if (!STATUSES[data.status]) throw badParam("Statut inconnu.");
    if (["met", "partial"].includes(data.status) && c.evidence_required && !docs.length) throw businessRule(`Le critère ${c.code} exige une preuve jointe.`);
    Object.assign(e, { status: data.status, assessed_by: ctx.user.id, assessed_at: nowStamp() });
  }
  if ("comment" in data) e.comment = data.comment || null;
  for (const key of ["deliverable", "responsible", "due_date"]) if (key in data) e[key] = data[key] || null;
  e.document_ids = docs;
  return { status: "ok", scoring: scoring(d) };
});
route("POST", "/axispro/dossiers/:id/advance-gate", AX_WRITE, (ctx) => {
  const d = dossierOf(ctx, ctx.params[0]);
  const policy = policyById(d.policy_id);
  const gate = policy.gates.find((g) => g.id === d.current_gate_id);
  const pending = evaluationsOf(d).filter((e) => criterionOf(policy, e.criterion_id)?.gate_id === gate.id && e.status === "not_assessed");
  if (pending.length) throw businessRule(`${pluriel(pending.length, "critère")} du gate ${gate.code} ${accord(pending.length, "reste", "restent")} à évaluer.`);
  if (scoring(d, gate).knockouts.length) throw businessRule("Un critère éliminatoire n'est pas satisfait : le dossier ne peut pas avancer.");
  const next = policy.gates.filter((g) => g.sequence > gate.sequence).sort((a, b) => a.sequence - b.sequence)[0];
  if (!next) throw businessRule("Le dossier est déjà au dernier gate.");
  d.current_gate_id = next.id;
  return dossierDetail(d);
});
route("GET", "/axispro/dossiers/:id/documents", AX_READ, (ctx) => {
  const d = dossierOf(ctx, ctx.params[0]);
  const files = DB.documents.filter((x) => x.dossier_id === d.id).sort((a, b) => (a.document_type_id ?? 1e9) - (b.document_type_id ?? 1e9) || b.version - a.version);
  return { standard: documentsStatus(d), files: files.map(documentRow) };
});
route("POST", "/axispro/dossiers/:id/documents", AX_WRITE, (ctx) => {
  const d = dossierOf(ctx, ctx.params[0]);
  const fields = ctx.multipart().fields;
  return documentRow(storeUpload(ctx, d, fields.document_type_id, fields.name, fields.portal_visible !== "0"));
});
function axDocumentOf(ctx, id) {
  const doc = DB.documents.find((x) => x.id === id);
  if (!doc || !DB.dossiers.some((d) => d.id === doc.dossier_id && d.company_id === ctx.company)) throw notFound("Pièce introuvable.");
  return doc;
}
route("PATCH", "/axispro/documents/:id", AX_WRITE, (ctx) => {
  const doc = axDocumentOf(ctx, ctx.params[0]);
  if (["received", "validated", "rejected"].includes(ctx.body.state)) doc.state = ctx.body.state;
  if ("comment" in ctx.body) doc.comment = ctx.body.comment || null;
  if ("portal_visible" in ctx.body) doc.portal_visible = Boolean(ctx.body.portal_visible);
  return documentRow(doc);
});
route("GET", "/axispro/documents/:id/download", AX_READ, (ctx) => documentFile(axDocumentOf(ctx, ctx.params[0])));
route("POST", "/axispro/dossiers/:id/reviews", AX_WRITE, (ctx) => {
  const d = dossierOf(ctx, ctx.params[0]);
  const [decision] = requireFields(ctx.body, "decision");
  if (!RECOMMENDATION_LABELS[decision]) throw badParam("Décision inconnue.");
  const snap = scoring(d);
  const review = {
    id: newId("review"), dossier_id: d.id, date: dateArg(ctx.body, "date", TODAY), gate_id: d.current_gate_id, members: ctx.body.members || null, decision,
    conditions: ctx.body.conditions || null, minutes: ctx.body.minutes || null, snapshot: snap, recommendation: snap.recommendation, state: "draft", locked_by: null, locked_at: null,
    policy_version: policyById(d.policy_id).version,
  };
  DB.reviews.push(review);
  if (ctx.body.lock) lockReview(review, ctx.user.id);
  return reviewRow(review);
});
function lockReview(review, userId) {
  if (review.state === "locked") return;
  Object.assign(review, { state: "locked", locked_by: userId, locked_at: nowStamp() });
  const d = DB.dossiers.find((x) => x.id === review.dossier_id);
  if (review.decision !== "postponed") d.decision = review.decision;
}
route("GET", "/axispro/reviews", AX_READ, (ctx) => {
  const ids = new Set(DB.dossiers.filter((d) => d.company_id === ctx.company).map((d) => d.id));
  return DB.reviews
    .filter((r) => ids.has(r.dossier_id) && (!["draft", "locked"].includes(ctx.query.state) || r.state === ctx.query.state))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, limitOf(ctx.query, 200, 1000))
    .map((r) => {
      const d = DB.dossiers.find((x) => x.id === r.dossier_id);
      return { ...reviewRow(r), dossier: { id: d.id, reference: d.reference, name: d.name, promoter: partnerName(d.promoter_id) } };
    });
});
route("POST", "/axispro/reviews/:id/lock", AX_WRITE, (ctx) => {
  const review = DB.reviews.find((r) => r.id === ctx.params[0] && DB.dossiers.some((d) => d.id === r.dossier_id && d.company_id === ctx.company));
  if (!review) throw notFound("Revue introuvable.");
  lockReview(review, ctx.user.id);
  return reviewRow(review);
});
route("GET", "/axispro/reviews/compare", AX_READ, (ctx) => {
  const a = DB.reviews.find((r) => r.id === intArg(ctx.query, "a"));
  const b = DB.reviews.find((r) => r.id === intArg(ctx.query, "b"));
  if (!a || !b || a.dossier_id !== b.dossier_id) throw businessRule("Choisissez deux revues du même dossier.");
  const [older, newer] = a.date < b.date || (a.date === b.date && a.id <= b.id) ? [a, b] : [b, a];
  const before = Object.fromEntries((older.snapshot?.domains || []).map((x) => [x.code, x.score]));
  return {
    from: { id: older.id, date: older.date, decision: older.decision, score: older.snapshot?.global_score ?? null },
    to: { id: newer.id, date: newer.date, decision: newer.decision, score: newer.snapshot?.global_score ?? null },
    domains: (newer.snapshot?.domains || []).map((x) => {
      const prev = before[x.code] ?? null;
      return { code: x.code, name: x.name, before: prev, after: x.score, delta: x.score !== null && prev !== null ? x.score - prev : null };
    }),
    knockouts_before: (older.snapshot?.knockouts || []).map((k) => k.code), knockouts_after: (newer.snapshot?.knockouts || []).map((k) => k.code),
  };
});
route("GET", "/axispro/dossiers/:id/report", AX_READ, (ctx) => {
  const d = dossierOf(ctx, ctx.params[0]);
  const p = policyById(d.policy_id);
  return {
    dossier: dossierDetail(d),
    policy: { name: p.name, version: p.version, date_active: p.date_active, notes: p.notes, go_threshold: p.go_threshold, conditional_threshold: p.conditional_threshold, weighting: p.weighting ?? "domain", thresholds: scoring(d).thresholds },
    documents: documentsStatus(d).map((x) => ({ ...x, available: ["received", "validated"].includes(x.state) })), generated_at: nowStamp(),
    financial: null, risks: [], actions: [], fundings: [], seal: null, gaps: gaps(d, 5),
  };
});
route("GET", "/axispro/dossiers/:id/report.xlsx", AX_READ, (ctx) => {
  const d = dossierOf(ctx, ctx.params[0]);
  const p = policyById(d.policy_id);
  const s = scoring(d);
  const gate = p.gates.find((g) => g.id === d.current_gate_id);
  const sheets = [
    { name: "Synthèse", rows: [["Rubrique", "Valeur"], ["Dossier", `${d.reference} - ${d.name}`], ["Promoteur", partnerName(d.promoter_id)], ["Gate courant", gate?.name ?? ""], ["Score global", s.global_score === null ? "" : Math.round(s.global_score * 10) / 10], ["Recommandation", RECOMMENDATION_LABELS[s.recommendation]], ["Critères éliminatoires actifs", s.knockouts.map((k) => k.code).join(", ") || "Aucun"], ["Politique appliquée", `${p.name}, version ${p.version}`]] },
    { name: "Domaines", rows: [["Code", "Domaine", "Pondération", "Score /100", "Critères évalués"], ...s.domains.map((x) => [x.code, x.name, x.weight, x.score === null ? "" : Math.round(x.score * 10) / 10, `${x.assessed}/${x.criteria}`])] },
    { name: "Critères", rows: [["Code", "Critère", "Domaine", "Gate", "Poids", "Critique", "Éliminatoire", "Statut", "Commentaire"], ...evaluationsOf(d).map((e) => {
      const c = criterionOf(p, e.criterion_id);
      return [c.code, c.name, p.domains.find((x) => x.id === c.domain_id).name, p.gates.find((g) => g.id === c.gate_id)?.code ?? "", c.weight, c.critical ? "oui" : "", c.knockout ? "oui" : "", STATUSES[e.status], e.comment ?? ""];
    })] },
    { name: "Écarts prioritaires", rows: [["Rang", "Critère", "Domaine", "Action attendue du promoteur"], ...gaps(d, 5).map((g, i) => [i + 1, `${g.code} ${g.name}`, g.domain, g.action])] },
  ];
  return fileReply(xlsxBuffer(sheets), XLSX, `${d.reference.replace(/\//g, "-")}_evaluation.xlsx`);
});
route("GET", "/axispro/dossiers/:id/messages", AX_READ, (ctx) => {
  const d = dossierOf(ctx, ctx.params[0]);
  return DB.messages.filter((m) => m.dossier_id === d.id).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).map(messageRow);
});
route("POST", "/axispro/dossiers/:id/messages", AX_WRITE, (ctx) => {
  const d = dossierOf(ctx, ctx.params[0]);
  const [body] = requireFields(ctx.body, "body");
  const m = { id: newId("message"), dossier_id: d.id, author_id: ctx.user.id, from_promoter: false, body: String(body).slice(0, 5000), date: nowStamp(), internal: Boolean(ctx.body.internal) };
  DB.messages.push(m);
  return messageRow(m);
});
route("GET", "/axispro/timesheets", AX_READ, (ctx) => {
  const ids = new Set(DB.dossiers.filter((d) => d.company_id === ctx.company).map((d) => d.id));
  const dossierId = intArg(ctx.query, "dossier_id");
  return DB.timesheets
    .filter((t) => ids.has(t.dossier_id) && (!dossierId || t.dossier_id === dossierId) && (ctx.query.unbilled !== "1" || (t.billable && !t.invoice_id)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, limitOf(ctx.query, 300, 2000))
    .map((t) => {
      const d = DB.dossiers.find((x) => x.id === t.dossier_id);
      const invoice = t.invoice_id ? moveById(t.invoice_id) : null;
      return { id: t.id, dossier: { id: d.id, reference: d.reference, name: d.name }, user: userName(t.user_id), date: t.date, hours: t.hours, description: t.description, billable: t.billable, invoice: invoice ? invoice.name ?? "/" : null };
    });
});
route("POST", "/axispro/timesheets", AX_WRITE, (ctx) => {
  const [dossierId, hours, description] = requireFields(ctx.body, "dossier_id", "hours", "description");
  const d = dossierOf(ctx, Number(dossierId));
  const t = { id: newId("timesheet"), dossier_id: d.id, user_id: ctx.user.id, date: dateArg(ctx.body, "date", TODAY), hours: numArg(hours, "hours"), description: String(description), billable: ctx.body.billable !== false, invoice_id: null };
  DB.timesheets.push(t);
  return { id: t.id };
});
route("POST", "/axispro/dossiers/:id/invoice", ["cabinet", "admin"], (ctx) => {
  const d = dossierOf(ctx, ctx.params[0]);
  const rate = ctx.body.hourly_rate ? numArg(ctx.body.hourly_rate, "hourly_rate") : 0;
  const extra = (ctx.body.lines || []).map((x) => ({ name: String(x.name), amount: numArg(x.amount, "amount") }));
  const sheets = DB.timesheets.filter((t) => t.dossier_id === d.id && t.billable && !t.invoice_id);
  if (!sheets.length && !extra.length) throw businessRule("Aucun temps facturable non encore facturé.");
  const tax = defaultTax(d.company_id, "sale").id;
  const lines = [...groupBy(sheets, (t) => t.user_id)].map(([uid, list]) => {
    const h = sum(list, (t) => t.hours);
    return { name: `Honoraires ${d.reference} - ${d.name} - ${userName(uid)} (${h} h)`, account: "706400", quantity: h, price_unit: rate, tax_id: tax };
  });
  for (const x of extra) lines.push({ name: x.name, account: "706400", quantity: 1, price_unit: x.amount, tax_id: tax });
  const move = createMove({ company_id: d.company_id, move_type: "out_invoice", partner_id: d.promoter_id, journal_id: journalOf(d.company_id, "VTE").id, date: TODAY, due: addDays(TODAY, 30), origin: d.reference, dossier_id: d.id, lines, state: "draft" });
  for (const t of sheets) t.invoice_id = move.id;
  return moveSummary(move);
});

/* ─── Portail des porteurs de projets ───────────────────────────────────── */

function portalView(d) {
  const policy = policyById(d.policy_id);
  const docs = documentsStatus(d);
  const due = docs.filter((x) => x.due && x.required);
  const current = policy.gates.find((g) => g.id === d.current_gate_id);
  return {
    id: d.id, reference: d.reference, name: d.name, state: d.state, consultant: d.consultant_id ? userName(d.consultant_id) : null,
    current_gate: current ? { code: current.code, name: current.name } : null,
    gates: policy.gates.map((g) => ({ code: g.code, name: g.name, reached: g.sequence <= (current?.sequence ?? 0) })),
    documents: docs, documents_progress: { due: due.length, received: due.filter((x) => ["received", "validated"].includes(x.state)).length },
    actions: gaps(d, 5).map((g) => ({ name: g.name, action: g.action })), decision: d.decision,
  };
}
function ownDossier(ctx, id) {
  const d = DB.dossiers.find((x) => x.id === id);
  if (!d || !d.portal_user_ids.includes(ctx.user.id)) throw notFound("Dossier introuvable.");
  return d;
}
route("GET", "/portail/dossiers", ["porteur"], (ctx) => DB.dossiers.filter((d) => d.portal_user_ids.includes(ctx.user.id)).sort((a, b) => b.id - a.id).map(portalView));
route("GET", "/portail/dossiers/:id", ["porteur"], (ctx) => portalView(ownDossier(ctx, ctx.params[0])));
route("GET", "/portail/dossiers/:id/documents", ["porteur"], (ctx) => {
  const d = ownDossier(ctx, ctx.params[0]);
  return DB.documents.filter((x) => x.dossier_id === d.id && x.portal_visible).sort((a, b) => (a.document_type_id ?? 1e9) - (b.document_type_id ?? 1e9) || b.version - a.version).map(documentRow);
});
route("POST", "/portail/dossiers/:id/documents", ["porteur"], (ctx) => {
  const d = ownDossier(ctx, ctx.params[0]);
  if (d.state === "closed") throw businessRule("Ce dossier est clos.");
  const fields = ctx.multipart().fields;
  return documentRow(storeUpload(ctx, d, fields.document_type_id, fields.name, true));
});
route("GET", "/portail/documents/:id/download", ["porteur"], (ctx) => {
  const doc = DB.documents.find((x) => x.id === ctx.params[0]);
  if (!doc || !doc.portal_visible) throw notFound("Pièce introuvable.");
  ownDossier(ctx, doc.dossier_id);
  return documentFile(doc);
});
route("GET", "/portail/dossiers/:id/messages", ["porteur"], (ctx) => {
  const d = ownDossier(ctx, ctx.params[0]);
  return DB.messages.filter((m) => m.dossier_id === d.id && !m.internal).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).map(messageRow);
});
route("POST", "/portail/dossiers/:id/messages", ["porteur"], (ctx) => {
  const d = ownDossier(ctx, ctx.params[0]);
  const [body] = requireFields(ctx.body, "body");
  const since = `${new Date(Date.now() - DAY_MS).toISOString().slice(0, 19)}Z`;
  if (DB.messages.filter((m) => m.dossier_id === d.id && m.author_id === ctx.user.id && m.date >= since).length >= 50) {
    throw new ApiError(429, "too_many_requests", "Trop de messages en 24 heures : appelez votre consultant.");
  }
  const m = { id: newId("message"), dossier_id: d.id, author_id: ctx.user.id, from_promoter: true, body: String(body).slice(0, 5000), date: nowStamp(), internal: false };
  DB.messages.push(m);
  return messageRow(m);
});

/* ════════════════════════════════════════════════════════════════════════════
 * NIMOVA · HSSEQ (lot 1) : cockpit, événements, actions, contrôles, alcootests, verrou, dérogations
 *
 * Contrat : docs/design/hsseq-contrat.md ; types : apps/web/lib/hsseq-types.ts. Les citernes, leurs
 * chauffeurs et leurs rotations sont ceux de Transport (par clé). Transport de la maquette ne connaît
 * pas encore les bennes (vehicle_kind, décision 3 du noyau) : les six bennes de la base de Boffa, leurs
 * conducteurs et leurs postes n'existent que dans cette partie. Les dates suivent la date de référence
 * de la maquette ; une saisie de la séance prend l'heure réelle sur ce jour-là (hsNow).
 *
 * Alignée le 26/10 sur le code du noyau (addons/eguitra_hsseq) : formes des réponses, codes d'erreur
 * (missing_fields et invalid_parameter en 400, conflict en 409, business_rule en 422), verrou avec
 * lock_active, warnings à part et active_waivers, paramètres de la société (GET et PATCH
 * /hsseq/settings), espace du compte (/hsseq/me), notifications, annulation d'un alcootest.
 * ══════════════════════════════════════════════════════════════════════════ */

const HS_READ = ["admin", "direction", "hsseq", "exploitation"];
const HS_APP = [...HS_READ, "conducteur", "rh", "auditeur"];
const HS_EVENT_READ = [...HS_READ, "conducteur", "auditeur"];
/** Lecture de l'auditeur externe (lot 2), en plus du lot 1 : contrôles, grilles, non-conformités, dérogations, motifs. */
const HS_AUDIT_READ = [...HS_READ, "auditeur"];
const HS_FIELD = ["hsseq", "exploitation", "conducteur"];
const HS_SETUP = ["admin", "hsseq"];
/** Profils qui lisent toute fiche HSSEQ de leurs sociétés (READ_ALL du noyau). */
const HS_ALL = ["admin", "direction", "hsseq"];
/**
 * Paramètres par défaut d'une société (eguitra.hsseq.settings). Le verrou est en service pour les
 * rotations chargées à partir de la date de référence de la maquette : celles d'avant partent comme
 * avant (lock_active faux). PATCH /hsseq/settings le déplace pour essayer les deux cas.
 */
const HS_SETTINGS_DEFAUT = {
  lock_start_date: TODAY, qualifications_required_from: null, employee_file_required_from: null, documents_required_from: null,
  level_moderate_min: 4, level_significant_min: 8, level_high_min: 15, investigation_hours_high: 72, investigation_days_significant: 7,
  investigation_days_moderate: 15, client_notice_hours: 24, verification_min_criticality: 8, verification_days: 90, escalation_days: 30,
  night_start_hour: 19, night_end_hour: 6, max_driving_hours: 9, co2_factor: 2.68, complaint_response_days: 15,
  costly_action_threshold: 50_000_000, check_window_hours: 12, breath_test_window_hours: 4, director_id: null, targets: {},
};
const HS_SETTINGS_DATES = ["lock_start_date", "qualifications_required_from", "employee_file_required_from", "documents_required_from"];
const HS_SETTINGS_NOMBRES = ["level_moderate_min", "level_significant_min", "level_high_min", "investigation_hours_high", "investigation_days_significant", "investigation_days_moderate", "client_notice_hours", "verification_min_criticality", "verification_days", "escalation_days", "costly_action_threshold", "check_window_hours", "breath_test_window_hours"];
/** Réglages des plans de trajet (lot 2) : plage de nuit et conduite au plus par jour, en heures décimales. */
const HS_SETTINGS_DECIMAUX = ["night_start_hour", "night_end_hour", "max_driving_hours"];
/** Cibles proposées par le contrat (§4), remplacées indicateur par indicateur par `targets`. */
const HS_TARGETS = { frequency_rate: 5, severity_rate: 0.2, road_accidents_per_mkm: 1.5, reporting_ratio: 10, check_completion: 100, check_compliance: 95, breath_test_completion: 100, breath_test_positives: 0, waivers: 2, actions_on_time: 90, actions_effectiveness: 80, qualifications_valid: 100, fuel_consumption: 44, co2_emissions: 1.18, tanker_shortage: 1.5, tipper_variance: 5, audits_completion: 100, immobilizations: 0,
  spills: 0, dust_exceedances: 0, complaints: 0, complaints_on_time: 100, telematics_violations: 5, drills_completion: 100 };
/** Famille d'un indicateur pour le comité des donneurs d'ordre (FAMILY du noyau). */
const HS_FAMILY = {
  frequency_rate: "reactive", severity_rate: "reactive", road_accidents_per_mkm: "reactive", reporting_ratio: "proactive", check_completion: "proactive",
  check_compliance: "proactive", breath_test_completion: "proactive", breath_test_positives: "reactive", waivers: "reactive", actions_on_time: "proactive",
  actions_effectiveness: "proactive", qualifications_valid: "proactive", fuel_consumption: "reactive", co2_emissions: "reactive", tanker_shortage: "reactive",
  tipper_variance: "reactive", audits_completion: "proactive", immobilizations: "reactive",
  spills: "reactive", dust_exceedances: "reactive", complaints: "reactive", complaints_on_time: "proactive", telematics_violations: "reactive", drills_completion: "proactive",
};
/** Première valeur renseignée parmi des noms de champ possibles (tables des modules du lot 3). */
const hsChamp = (x, ...noms) => noms.map((n) => x?.[n]).find((v) => v !== undefined && v !== null) ?? null;
/**
 * État d'une valeur au regard de sa cible (indicator_status du noyau, marge de surveillance de 85 %) :
 * met, watch, missed ou no_data. Sens « down » : conforme jusqu'à la cible, sous surveillance jusqu'à
 * cible ÷ 0,85 ; une cible nulle n'a pas de marge.
 */
function hsIndicatorStatus(value, target, direction) {
  if (value === null || value === undefined || target === null || target === undefined) return "no_data";
  if (direction === "up") return value >= target ? "met" : value >= target * 0.85 ? "watch" : "missed";
  if (value <= target) return "met";
  return target > 0 && value <= target / 0.85 ? "watch" : "missed";
}
/** Sites de rattachement des comptes d'exploitation (absent : tous les sites). */
const HS_USER_SITES = { 12: [1], 18: [2] };
/** Salariés RH liés à un compte conducteur (employee.user_id, employee.driver_id). */
const HS_EMPLOYEES = [{ id: 501, user_id: 17, driver_id: 1, matricule: "EG-0417" }];
/** Agents du parc sans chauffeur lié (salariés RH de la maquette, en plus des chauffeurs). */
const HS_STAFF = [
  { id: 950, name: "Ibrahima Camara", site_id: 1 },
  { id: 951, name: "Aïcha Diallo", site_id: 1 },
  { id: 952, name: "Mamadou Saliou Barry", site_id: 2 },
];
/** Photo de maquette : image PNG d'un pixel. */
const HS_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
/** Motifs du verrou (§4) : libellé, source, levée, types de véhicule, dérogeable, lot. */
const HS_REASONS = {
  V01: ["Contrôle avant départ non réalisé pour la rotation", "NIMOVA Terrain", "Réaliser le contrôle", ["tanker", "tipper"], false, 1],
  V02: ["Point critique du contrôle avant départ non conforme", "NIMOVA Terrain", "Chef de parc après correction, photo obligatoire", ["tanker", "tipper"], true, 1],
  V03: ["Alcootest non réalisé ou positif", "NIMOVA Terrain", "Responsable HSSEQ ; positif : conducteur retiré de la rotation", ["tanker", "tipper"], false, 1],
  V04: ["Habilitation obligatoire expirée ou aptitude médicale « inapte »", "Habilitations (RH)", "Changer de conducteur", ["tanker", "tipper"], true, 1],
  V05: ["Document du véhicule expiré (assurance, visite technique)", "Transport, fiche véhicule", "Responsable maintenance", ["tanker", "tipper"], true, 1],
  V06: ["Barémage ou certificat d'étanchéité de la citerne expiré", "Transport, fiche véhicule", "Responsable maintenance", ["tanker"], true, 2],
  V07: ["Charge déclarée supérieure à la charge utile autorisée", "Transport, ticket de pesée", "Chef de parc après délestage", ["tipper"], true, 2],
  V08: ["Plan de trajet absent, circulation de nuit sur un axe interdit ou temps de conduite dépassé", "Transport, rotation", "Responsable exploitation", ["tanker", "tipper"], true, 2],
  V09: ["Véhicule immobilisé par un événement en cours d'enquête", "Événements", "Responsable HSSEQ", ["tanker", "tipper"], true, 2],
};
/** Jamais dérogeables (§4.1). */
const HS_NOT_WAIVABLE = ["V01", "V03"];
const HS_TYPES = { work_accident: "safety", road_accident: "safety", near_miss: "safety", hazard: "safety", spill: "environment", fire: "safety", security_breach: "security", product_quality: "quality", property_damage: "safety" };
const HS_TYPE_LABELS = { work_accident: "Accident du travail", road_accident: "Accident de la route", near_miss: "Presque-accident", hazard: "Situation dangereuse", spill: "Déversement", fire: "Incendie", security_breach: "Atteinte à la sûreté", product_quality: "Incident de qualité du produit", property_damage: "Dégât matériel" };
const HS_STATUS_LABELS = { reported: "Déclaré", classified: "Classé", investigation: "Enquête", actions: "Actions", closed: "Clôturé" };
const HS_ACTION_LABELS = { todo: "À faire", in_progress: "En cours", to_verify: "À vérifier", closed: "Close", cancelled: "Annulée" };
const HS_LEVEL_LABELS = { low: "Faible", moderate: "Modérée", significant: "Significative", high: "Élevée" };
const HS_DOMAINS = ["safety", "health", "security", "environment", "quality"];
const HS_DOC_LABELS = { insurance: "Assurance", inspection: "Visite technique", calibration: "Barémage", tightness: "Certificat d'étanchéité" };
const HS_COST_KINDS = ["claim", "deductible", "downtime", "product_loss", "repair", "other"];
const HS_CONTROL_LEVELS = ["elimination", "substitution", "engineering", "administrative", "ppe"];
const HS_ORIGINS = ["event", "audit", "check", "risk", "review", "complaint", "drill"];
const HS_FACTORS = ["environment", "equipment", "method", "manpower", "material"];
const HS_METHODS = ["simple_analysis", "five_whys", "cause_tree"];
const HS_PROOFS = {
  elimination: "Constat de suppression du danger, photos à l'appui",
  substitution: "Bon de livraison du matériel de remplacement",
  engineering: "Procès-verbal de réception des travaux et photos",
  administrative: "Note de service signée et feuille d'émargement",
  ppe: "Bons de remise des équipements signés",
};

let HS = null;
const hsNow = () => `${TODAY}T${new Date().toISOString().slice(11, 19)}Z`;
const hsAddMinutes = (iso, minutes) => `${new Date(Date.parse(iso) + minutes * 60000).toISOString().slice(0, 19)}Z`;

/* ─── Paramètres de la société ──────────────────────────────────────────── */

function hsSettings(company = 1) {
  if (!HS.settings.has(company)) HS.settings.set(company, structuredClone(HS_SETTINGS_DEFAUT));
  return HS.settings.get(company);
}
/** Seuils de criticité servis aux écrans (criticality_thresholds), d'après les paramètres. */
function hsThresholds(s = hsSettings()) {
  return [
    { level: "low", min: 1, max: s.level_moderate_min - 1, investigation_days: null, investigation_hours: null, method: null },
    { level: "moderate", min: s.level_moderate_min, max: s.level_significant_min - 1, investigation_days: s.investigation_days_moderate, investigation_hours: null, method: "simple_analysis" },
    { level: "significant", min: s.level_significant_min, max: s.level_high_min - 1, investigation_days: s.investigation_days_significant, investigation_hours: null, method: "five_whys" },
    { level: "high", min: s.level_high_min, max: 25, investigation_days: Math.round((s.investigation_hours_high / 24) * 10) / 10, investigation_hours: s.investigation_hours_high, method: "cause_tree" },
  ];
}
/** Délai d'enquête d'un niveau, en minutes ; nul pour une criticité faible. */
function hsInvestigationMinutes(level, s = hsSettings()) {
  return { high: s.investigation_hours_high * 60, significant: s.investigation_days_significant * 1440, moderate: s.investigation_days_moderate * 1440 }[level] ?? null;
}
const hsLevel = (c) => (c ? hsThresholds().find((l) => c >= l.min && c <= l.max)?.level ?? null : null);
const hsLevelMethod = (level) => ({ significant: "five_whys", high: "cause_tree" })[level] ?? "simple_analysis";
const hsUser = (id) => (id ? { id, name: userName(id) } : null);
const hsVehicle = (id) => DB.vehicles.find((v) => v.id === id) ?? HS.tippers.find((v) => v.id === id) ?? null;
const hsVehicleByName = (name) => DB.vehicles.find((v) => v.name === name) ?? HS.tippers.find((v) => v.name === name) ?? null;
const hsKind = (v) => HS.kinds.get(v.id) ?? "tanker";
/** Site de l'ensemble : rattachement fait par les sites (vehicle_ids), à défaut celui de son profil. */
const hsVehicleSite = (v) => (HS.vehicleSites.has(v.id) ? HS.vehicleSites.get(v.id) : hsKind(v) === "tipper" ? 2 : 1);
function hsVehicleRef(id) {
  const v = hsVehicle(id);
  return v ? { id: v.id, name: v.name, vehicle_kind: hsKind(v), plate: v.tractor_plate ?? null } : null;
}
const hsDriver = (id) => DB.drivers.find((d) => d.id === id) ?? HS.drivers.find((d) => d.id === id) ?? null;
function hsDriverRef(id) {
  const d = hsDriver(id);
  return d ? { id: d.id, name: d.name } : null;
}
const hsRotation = (id) => (id ? DB.rotations.find((r) => r.id === id && r.company_id === 1) ?? HS.rotations.find((r) => r.id === id) ?? null : null);
const hsRouteName = (r) => r.route_name ?? DB.routes.find((x) => x.id === r.route_id)?.name ?? null;
const hsRotationRef = (r) => (r ? { id: r.id, name: r.name, date_loading: r.date_loading, route_name: hsRouteName(r), state: r.state } : null);
const hsSite = (id) => HS.sites.find((s) => s.id === id) ?? null;
function hsSiteRef(id) {
  const s = hsSite(id);
  return s ? { id: s.id, name: s.name } : null;
}
/** Fin prévue d'une rotation (expiration d'une dérogation) : son retour, sinon son chargement plus la durée de la route, en fin de journée. */
function hsRotationEnd(r) {
  if (r.date_delivery) return `${r.date_delivery}T23:59:59Z`;
  const km = DB.routes.find((x) => x.id === r.route_id)?.distance_km ?? 45;
  return `${addDays(r.date_loading, Math.max(1, Math.ceil(km / 380)))}T23:59:59Z`;
}
function hsRotationAt(vehicleId, date) {
  const list = [...DB.rotations.filter((r) => r.company_id === 1), ...HS.rotations].filter((r) => r.vehicle_id === vehicleId && r.date_loading <= date && r.state !== "cancelled");
  return list.sort((a, b) => b.date_loading.localeCompare(a.date_loading) || b.id - a.id)[0] ?? null;
}
const hsDepartureRotations = (day) => [...DB.rotations.filter((r) => r.company_id === 1 && r.date_loading === day && r.state !== "cancelled"), ...HS.rotations.filter((r) => r.date_loading === day)];
/** Le verrou vaut pour une rotation chargée à partir de sa mise en service (paramètres de la société). */
const hsLockActive = (r) => Boolean(hsSettings(r.company_id ?? 1).lock_start_date && r.date_loading >= hsSettings(r.company_id ?? 1).lock_start_date);

/* ─── Droits et périmètre ───────────────────────────────────────────────── */

const hsIs = (ctx, profile) => ctx.user.profiles.includes(profile);
const hsFull = (ctx) => hasProfile(ctx, HS_ALL);
/** Portée du compte, comme le noyau : « all », « site » (chef de parc), « self » (conducteur et autres). */
const hsScope = (ctx) => (hsFull(ctx) ? "all" : hsIs(ctx, "exploitation") || hsIs(ctx, "auditeur") ? "site" : "self");
/** Sites du chef de parc, sinon ceux de l'auditeur (lot 2) ; vide pour une lecture complète. */
const hsSites = (ctx) => (hsFull(ctx) ? [] : hsIs(ctx, "auditeur") && !hsIs(ctx, "exploitation") ? ctx.user.hsseq_audit_site_ids ?? [] : HS_USER_SITES[ctx.user.id] ?? []);
/** Les noms des personnes (conducteurs, victimes, témoins, déclarants) ne sont pas servis à l'auditeur. */
const hsPersonalHidden = (ctx) => hsIs(ctx, "auditeur") && !hsFull(ctx);

/**
 * Réponse lue par l'auditeur : ni déclarant, ni auteur d'un contrôle, ni nom des personnes d'un événement
 * (personal_data_hidden du noyau). Les autres comptes reçoivent la réponse telle quelle.
 */
function hsMasquer(ctx, row) {
  if (!hsPersonalHidden(ctx) || !row) return row;
  const masque = { ...row };
  if ("reported_by" in masque) masque.reported_by = null;
  if ("author" in masque) masque.author = null;
  if (Array.isArray(masque.people)) masque.people = masque.people.map((p) => ({ ...p, person_id: null, name: null }));
  return masque;
}

/** Auditeur externe : lecture seule, refusé au-delà de sa date de fin d'accès ou sans site (auditor_guard du noyau). */
function hsAuditorGuard(user, method) {
  const until = user.hsseq_audit_until;
  if (!until || TODAY > until) {
    throw hsForbidden(until ? "Accès d'auditeur échu ou sans date de fin : demandez sa prolongation au Responsable HSSEQ." : "Accès d'auditeur sans date de fin : le Responsable HSSEQ la fixe d'abord.");
  }
  if (!user.profiles.some((p) => ["exploitation", ...HS_ALL].includes(p)) && !(user.hsseq_audit_site_ids ?? []).length) {
    throw hsForbidden("Périmètre d'audit sans site : le Responsable HSSEQ le définit d'abord.");
  }
  if (method !== "GET" && method !== "HEAD") throw hsForbidden("Profil auditeur : lecture seule.");
}
/**
 * Site lisible par le compte : tout site en lecture complète ; pour le chef de parc et l'auditeur, leurs
 * sites seulement, fermé par défaut (objet sans site ou compte sans site : non). Le compte « self » est
 * borné objet par objet (auteur, conducteur), ailleurs.
 */
function hsSiteOk(ctx, siteId) {
  const scope = hsScope(ctx);
  if (scope === "all") return true;
  if (scope === "site") return Boolean(siteId) && hsSites(ctx).includes(siteId);
  return true;
}
const hsEmployee = (ctx) => HS_EMPLOYEES.find((e) => e.user_id === ctx.user.id) ?? null;
const hsMyDriver = (ctx) => hsEmployee(ctx)?.driver_id ?? null;
const hsCanSeeEvent = (ctx, e) => hsFull(ctx) || e.reported_by === ctx.user.id || (hsScope(ctx) === "site" && hsSiteOk(ctx, e.site_id));
const hsCanSeeAction = (ctx, a) => hsFull(ctx) || a.owner_id === ctx.user.id || (hsScope(ctx) === "site" && hsSiteOk(ctx, a.site_id));
const hsCanSeeCheck = (ctx, c) => hsFull(ctx) || (hsScope(ctx) === "site" ? hsSiteOk(ctx, c.site_id) : c.performed_by === ctx.user.id || (hsMyDriver(ctx) !== null && c.driver_id === hsMyDriver(ctx)));
/**
 * Levée d'une non-conformité ouverte, et dépôt de sa photo de correction (rights.can_close), comme can_lift
 * du noyau : hsseq et l'administration partout ; un chef de parc, même avec un profil de lecture complète,
 * sur ses seuls sites ; tout autre compte, jamais.
 */
const hsCanLift = (ctx, n) => n.status === "open" && (hsIs(ctx, "hsseq") || hsIs(ctx, "admin")
  || (hsIs(ctx, "exploitation") && Boolean(n.site_id) && (HS_USER_SITES[ctx.user.id] ?? []).includes(n.site_id)));
const hsForbidden = (message = "Opération non autorisée pour votre profil.") => new ApiError(403, "forbidden", message);
/** Règle métier refusée : code précis, 422 par défaut (HsseqError du noyau). */
const hsRule = (code, message, extra = {}, status = 422) => new ApiError(status, code, message, extra);
const hsMissing = (message, fields) => new ApiError(400, "missing_fields", message, { fields });
const hsBad = (message, fields) => new ApiError(400, "invalid_parameter", message, fields ? { fields } : {});
/** Nombre facultatif d'un corps (position GPS) : nul s'il manque. */
const hsNum = (v, name) => (v === undefined || v === null || v === "" ? null : numArg(v, name));
/** Identifiant facultatif d'un corps : nul s'il manque, 400 invalid_parameter s'il n'est pas entier. */
function hsId(data, key) {
  const v = data[key];
  if (v === undefined || v === null || v === "" || v === 0 || v === "0" || v === false) return null;
  if (!/^\d+$/.test(String(v))) throw hsBad(`Identifiant invalide : ${key}.`, [key]);
  return Number(v);
}

/** Filtre commun des listes : société (seul EGUITRA GROUP a du transport), site, type de véhicule. */
function hsFilter(ctx, q, siteId, kind) {
  if (q.company_id && Number(q.company_id) !== 1) return false;
  if (q.site_id && Number(q.site_id) !== siteId) return false;
  if (q.vehicle_kind && kind && q.vehicle_kind !== kind) return false;
  return true;
}

function hsPage(ctx, list, counts, row) {
  const offset = offsetOf(ctx.query);
  const limit = limitOf(ctx.query, 50, 500);
  return { items: list.slice(offset, offset + limit).map(row), total_count: list.length, offset, limit, counts };
}

/* ─── Journal, pièces jointes, notifications ────────────────────────────── */

function hsLog(model, resId, by, action, field = null, oldValue = null, newValue = null, at = hsNow(), note = null) {
  HS.log.push({ id: ++HS.seq.log, model, res_id: resId, at, by, action, field, old_value: oldValue === null ? null : String(oldValue), new_value: newValue === null ? null : String(newValue), note });
}
const hsHistoryRow = (l) => ({ id: l.id, model: l.model, res_id: l.res_id, at: l.at, by: hsUser(l.by), action: l.action, field: l.field, old_value: l.old_value, new_value: l.new_value, note: l.note ?? null });
const hsHistory = (model, id) => HS.log.filter((l) => l.model === model && l.res_id === id).sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id).map(hsHistoryRow);

/** Pièce jointe ; `model` nul : déposée avant sa fiche, citée ensuite par attachment_ids. */
function hsAttach(model, objectId, by, name, mimetype, data, extra = {}) {
  const role = extra.role ?? (model === "action" ? "evidence" : "photo");
  const a = { id: ++HS.seq.attachment, model, object_id: objectId, name, mimetype, size: data.length, is_photo: mimetype.startsWith("image/"), caption: null, created_at: hsNow(), created_by: by, client_uuid: null, ...extra, role };
  HS.attachments.push(a);
  HS.files.set(a.id, data);
  return a;
}
const hsPhoto = (model, id, by, at, caption) => hsAttach(model, id, by, `photo-${model}-${id}-${HS.seq.attachment + 1}.png`, "image/png", HS_PNG, { created_at: at, caption });
const hsAttachmentRow = (a) => ({
  id: a.id, name: a.name, mimetype: a.mimetype, size: a.size, is_photo: a.is_photo, caption: a.caption, role: a.role, model: a.model, res_id: a.object_id,
  created_at: a.created_at, created_by: hsUser(a.created_by), url: `/hsseq/attachments/${a.id}/download`,
});
const hsAttachments = (model, id, keep = () => true) => HS.attachments.filter((a) => a.model === model && a.object_id === id && keep(a)).map(hsAttachmentRow);
/**
 * Pièces citées par une fiche (attachment_ids) : déposées par le compte et pas encore rattachées, ou
 * déjà rattachées à cette fiche. Pièce d'un autre déposant : 403 ; rattachée ailleurs : 409 conflict.
 */
function hsClaim(ctx, ids, model, objectId, role = null) {
  const list = [];
  for (const id of ids) {
    const a = HS.attachments.find((x) => x.id === Number(id));
    if (!a) throw new ApiError(404, "not_found", "Pièce jointe introuvable.", { fields: ["attachment_ids"] });
    if (!(a.model === model && a.object_id === objectId)) {
      if (a.model) throw new ApiError(409, "conflict", `La pièce « ${a.name} » est déjà rattachée à une autre fiche.`, { fields: ["attachment_ids"] });
      if (a.created_by !== ctx.user.id) throw hsForbidden("Une pièce déposée par un autre compte ne se cite pas.");
    }
    list.push(a);
  }
  for (const a of list) Object.assign(a, { model, object_id: objectId, ...(role ? { role } : {}) });
  return list;
}
/** Liste d'identifiants d'un corps (« 1,2 » ou [1, 2]) ; 400 invalid_parameter sinon. */
function hsIds(data, key) {
  const v = data[key] ?? [];
  const list = typeof v === "string" ? v.split(",").filter((x) => x.trim()) : v;
  if (!Array.isArray(list) || list.some((x) => !/^\d+$/.test(String(x).trim()))) throw hsBad(`Liste d'identifiants invalide : ${key}.`, [key]);
  return list.map((x) => Number(x));
}
/** Saisie déjà reçue (idempotence) : rendue à son auteur ; à un autre compte, 409 conflict. */
function hsExisting(ctx, list, uuid, author = (x) => x.performed_by ?? x.reported_by ?? x.created_by) {
  if (!uuid) return null;
  const found = list.find((x) => x.client_uuid === String(uuid));
  if (found && author(found) !== ctx.user.id) throw new ApiError(409, "conflict", "Identifiant de saisie déjà utilisé par un autre compte.", { fields: ["client_uuid"] });
  return found ?? null;
}

/** Notifie chaque destinataire dans l'application, et par courriel s'il a une adresse (pas de SMS au lot 1). */
function hsNotify(userIds, kind, subject, body, model, resId, at = hsNow()) {
  for (const id of [...new Set(userIds)]) {
    const u = userById(id);
    if (!u || !u.active) continue;
    HS.notifications.push({ id: ++HS.seq.notification, user_id: id, channel: "app", kind, subject, body, model, res_id: resId, sent_at: at, read_at: null });
    if (u.email) HS.notifications.push({ id: ++HS.seq.notification, user_id: id, channel: "email", kind, subject, body, model, res_id: resId, sent_at: at, read_at: null });
  }
}
const hsNotificationRow = (n) => ({ id: n.id, kind: n.kind, channel: n.channel, subject: n.subject, body: n.body ?? null, model: n.model, res_id: n.res_id, to: hsUser(n.user_id), sent_at: n.sent_at, read_at: n.read_at });
/** Directeur général paramétré, sinon les comptes Direction générale. */
const hsDirectors = () => (hsSettings().director_id ? [hsSettings().director_id] : USERS.filter((u) => u.active && u.profiles.includes("direction") && !u.profiles.includes("admin")).map((u) => u.id));
const hsHsseqManagers = () => USERS.filter((u) => u.active && u.profiles.includes("hsseq")).map((u) => u.id);

/* ─── Contrôles et non-conformités ──────────────────────────────────────── */

/** Grille au format de l'API ; `all` : points retirés compris (admin et hsseq). */
function hsTemplateRow(t, all = false) {
  const items = [...t.items].filter((it) => all || it.active !== false).sort((a, b) => a.sequence - b.sequence).map((it) => ({ id: it.id, label: it.label, blocking: it.blocking, sequence: it.sequence, linked_to: it.linked_to ?? null, active: it.active !== false }));
  return { id: t.id, name: t.name, kind: t.kind, vehicle_kind: t.vehicle_kind, version: t.version, active: t.active, items, updated_at: t.updated_at, updated_by: hsUser(t.updated_by) };
}

/** Contrôle et ses non-conformités (une par réponse « not_ok »). */
function hsCreateCheck(spec) {
  const t = spec.template;
  const v = hsVehicle(spec.vehicle_id);
  const c = {
    id: ++HS.seq.check, reference: `CTL/2026/${pad(HS.seq.check + 1200, 5)}`, template_id: t.id, template_version: spec.template_version ?? t.version, kind: t.kind, vehicle_kind: t.vehicle_kind,
    vehicle_id: v.id, rotation_id: spec.rotation_id ?? null, driver_id: spec.driver_id ?? null, performed_by: spec.performed_by, site_id: hsVehicleSite(v),
    client_uuid: spec.client_uuid ?? null, reported_at: spec.reported_at, synced_at: spec.synced_at ?? spec.reported_at, offline: Boolean(spec.offline),
    duration_s: spec.duration_s ?? null, latitude: spec.latitude ?? null, longitude: spec.longitude ?? null, gps_accuracy: spec.gps_accuracy ?? null,
    answers: t.items.filter((it) => it.active !== false).map((it, i) => {
      const a = spec.answers.find((x) => Number(x.item_id) === it.id);
      return { item_id: it.id, label: it.label, blocking: it.blocking, sequence: it.sequence ?? (i + 1) * 10, answer: it.linked_to ? "na" : a?.answer ?? "na", comment: it.linked_to ? "Renseigné par l'alcootest" : a?.comment ?? null };
    }),
  };
  c.result = c.answers.some((a) => a.answer === "not_ok" && a.blocking) ? "blocking" : c.answers.some((a) => a.answer === "not_ok") ? "non_compliant" : "compliant";
  HS.checks.push(c);
  for (const a of c.answers.filter((x) => x.answer === "not_ok")) {
    HS.ncs.push({ id: ++HS.seq.nc, check_id: c.id, item_id: a.item_id, label: a.label, blocking: a.blocking, vehicle_id: c.vehicle_id, rotation_id: c.rotation_id, site_id: c.site_id, found_at: c.reported_at, comment: a.comment, status: "open", lifted_at: null, lifted_by: null, lift_comment: null, action_id: null });
  }
  return c;
}
const hsNcPhotosMissing = (n) => n.status === "open" && !HS.attachments.some((a) => a.model === "nonconformity" && a.object_id === n.id);
function hsNcRow(ctx, n) {
  const c = HS.checks.find((x) => x.id === n.check_id);
  const action = n.action_id ? HS.actions.find((a) => a.id === n.action_id) : null;
  return {
    id: n.id, check: { id: c.id, reference: c.reference }, item: { id: n.item_id, label: n.label, blocking: n.blocking }, vehicle: hsVehicleRef(n.vehicle_id),
    rotation: hsRotationRef(hsRotation(n.rotation_id)), site: hsSiteRef(n.site_id), found_at: n.found_at, comment: n.comment,
    photos: hsAttachments("nonconformity", n.id, (a) => a.role === "photo"), photos_missing: hsNcPhotosMissing(n),
    status: n.status, lifted_at: n.lifted_at, lifted_by: hsUser(n.lifted_by), lift_comment: n.lift_comment,
    lift_photos: hsAttachments("nonconformity", n.id, (a) => a.role === "lift"), action: action ? { id: action.id, name: action.reference } : null,
    rights: { can_edit: false, can_close: hsCanLift(ctx, n), can_approve: false },
  };
}
function hsCheckLine(c) {
  const ncs = HS.ncs.filter((n) => n.check_id === c.id);
  const t = HS.templates.find((x) => x.id === c.template_id);
  return {
    id: c.id, reference: c.reference, template: { id: t.id, name: t.name, version: c.template_version ?? t.version }, kind: c.kind, vehicle_kind: c.vehicle_kind,
    vehicle: hsVehicleRef(c.vehicle_id), rotation: hsRotationRef(hsRotation(c.rotation_id)), driver: hsDriverRef(c.driver_id), site: hsSiteRef(c.site_id),
    author: hsUser(c.performed_by), reported_at: c.reported_at, result: c.result, open_nonconformities: ncs.filter((n) => n.status === "open").length,
    open_blocking: ncs.filter((n) => n.status === "open" && n.blocking).length, photos_missing: ncs.some(hsNcPhotosMissing),
    complement_of: c.complement_of_id ? { id: c.complement_of_id, reference: HS.checks.find((x) => x.id === c.complement_of_id)?.reference ?? "" } : null,
  };
}
function hsCheckDetail(ctx, c) {
  const ncs = HS.ncs.filter((n) => n.check_id === c.id);
  const liftable = ncs.some((n) => hsCanLift(ctx, n));
  const signature = HS.attachments.find((a) => a.model === "check" && a.object_id === c.id && a.role === "signature");
  return {
    ...hsCheckLine(c), client_uuid: c.client_uuid, synced_at: c.synced_at, offline: c.offline, duration_s: c.duration_s,
    latitude: c.latitude, longitude: c.longitude, gps_accuracy: c.gps_accuracy,
    answers: c.answers.map((a) => {
      const n = ncs.find((x) => x.item_id === a.item_id);
      return { item_id: a.item_id, label: a.label, blocking: a.blocking, sequence: a.sequence, answer: a.answer, comment: a.comment, nonconformity_id: n?.id ?? null, photos: n ? hsAttachments("nonconformity", n.id) : [] };
    }),
    signature: signature ? hsAttachmentRow(signature) : null,
    nonconformities: ncs.map((n) => hsNcRow(ctx, n)),
    attachments: hsAttachments("check", c.id, (a) => a.role !== "signature"),
    history: hsScope(ctx) === "self" ? [] : hsHistory("check", c.id),
    // Points ajoutés à la grille après la saisie (aucun dans la maquette) et contrôles complémentaires.
    awaiting_items: c.awaiting_items ?? [],
    complements: HS.checks.filter((x) => x.complement_of_id === c.id).sort((a, b) => a.reported_at.localeCompare(b.reported_at)).map(hsCheckLine),
    transitions: liftable ? ["lift"] : [],
    // Pas de correction d'un contrôle saisi (pas de PATCH) : can_edit toujours faux.
    rights: { can_edit: false, can_close: liftable, can_approve: false },
  };
}

/* ─── Alcootests ────────────────────────────────────────────────────────── */

const hsTestStatus = (t) => (!t.performed ? "not_done" : t.result === "positive" ? "non_compliant" : "compliant");
/** Niveau de lecture (§9.4) : détail pour hsseq, statut pour l'administration, la direction et le chef de parc, « fait » sinon. */
const hsTestAccess = (ctx) => (hsIs(ctx, "hsseq") ? "detail" : hsScope(ctx) === "self" ? "done" : "status");
function hsTestRow(ctx, t) {
  const access = hsTestAccess(ctx);
  const base = { id: t.id, rotation: hsRotationRef(hsRotation(t.rotation_id)), driver: hsDriverRef(t.driver_id), access };
  if (access === "done") return { ...base, done: t.performed, done_at: t.reported_at };
  Object.assign(base, { date: t.reported_at.slice(0, 10), status: hsTestStatus(t) });
  if (access === "status") return base;
  return {
    ...base, performed: t.performed, result: t.result, reading_mg_l: t.reading_mg_l || null, device: t.device, not_done_reason: t.not_done_reason,
    performed_by: hsUser(t.performed_by), driver_removed: t.driver_removed, client_uuid: t.client_uuid, reported_at: t.reported_at, synced_at: t.synced_at, offline: t.offline,
    cancelled: t.active === false, cancel_reason: t.cancel_reason ?? null, cancelled_by: hsUser(t.cancelled_by ?? null), cancelled_at: t.cancelled_at ?? null,
  };
}
const hsTestSite = (t) => {
  const r = hsRotation(t.rotation_id);
  const v = r ? hsVehicle(r.vehicle_id) : null;
  return v ? hsVehicleSite(v) : HS.driverSites.get(t.driver_id) ?? null;
};
const hsCanSeeTest = (ctx, t) => {
  if (t.active === false && !hsIs(ctx, "hsseq")) return false;
  const scope = hsScope(ctx);
  if (scope === "all") return true;
  if (scope === "site") return hsSiteOk(ctx, hsTestSite(t));
  return hsMyDriver(ctx) !== null && t.driver_id === hsMyDriver(ctx);
};
const hsLiveTests = () => HS.tests.filter((t) => t.active !== false);

/* ─── Verrou de départ ──────────────────────────────────────────────────── */

const hsReasonSetting = (code) => HS.reasons.find((r) => r.code === code);
/** Expire les dérogations dont la rotation est terminée ou dont la fin prévue est passée. */
function hsExpireWaivers() {
  const now = hsNow();
  for (const w of HS.waivers) {
    const r = hsRotation(w.rotation_id);
    if (["active", "pending_hsseq"].includes(w.status) && ((r && ["done", "invoiced", "cancelled"].includes(r.state)) || (w.expires && w.expires < now))) {
      Object.assign(w, { status: "expired", expired_at: now });
      hsLog("waiver", w.id, null, "expire", "status", "active", "expired", now);
    }
  }
}
/**
 * Rattachement automatique (§9 du contrat) : à l'évaluation d'une rotation pas encore partie, le
 * dernier contrôle avant départ du véhicule et le dernier alcootest du conducteur saisis sans rotation
 * dans leur fenêtre (12 h, 4 h) lui sont rattachés. Une saisie rattachée ne compte jamais pour une autre.
 */
function hsAutoAttach(ctx, rot) {
  if (rot.state !== "draft") return;
  const s = hsSettings();
  const ref = rot.date_loading === TODAY ? hsNow() : `${rot.date_loading}T23:59:59Z`;
  const within = (at, hours) => at <= ref && Date.parse(ref) - Date.parse(at) <= hours * 3600000;
  const latest = (list) => list.sort((a, b) => b.reported_at.localeCompare(a.reported_at))[0];
  if (!HS.checks.some((c) => c.rotation_id === rot.id && c.kind === "pre_departure")) {
    const c = latest(HS.checks.filter((x) => x.rotation_id === null && x.kind === "pre_departure" && x.vehicle_id === rot.vehicle_id && within(x.reported_at, s.check_window_hours)));
    if (c) {
      c.rotation_id = rot.id;
      if (!c.driver_id) c.driver_id = rot.driver_id;
      for (const n of HS.ncs.filter((x) => x.check_id === c.id)) n.rotation_id = rot.id;
      hsLog("check", c.id, ctx.user.id, "attach", "rotation_id", null, rot.id, hsNow(), `Rattaché à la rotation ${rot.name ?? rot.id}`);
    }
  }
  if (rot.driver_id && !hsLiveTests().some((t) => t.rotation_id === rot.id && t.driver_id === rot.driver_id)) {
    const recent = hsLiveTests().filter((x) => x.rotation_id === null && x.driver_id === rot.driver_id && within(x.reported_at, s.breath_test_window_hours));
    const t = recent.find((x) => hsTestStatus(x) === "non_compliant") ?? latest(recent);
    if (t) {
      t.rotation_id = rot.id;
      hsLog("breath_test", t.id, ctx.user.id, "attach", "rotation_id", null, rot.id, hsNow(), `Rattaché à la rotation ${rot.name ?? rot.id}`);
      hsRemoveDriver(t, rot);
    }
  }
}
/** Positif : le conducteur est retiré de la rotation encore saisie (Transport en affecte un autre). */
function hsRemoveDriver(t, rot) {
  if (hsTestStatus(t) !== "non_compliant") return;
  t.driver_removed = true;
  if (rot && rot.state === "draft" && rot.driver_id === t.driver_id) {
    rot.driver_id = null;
    hsLog("breath_test", t.id, t.performed_by, "driver_removed", null, null, null, hsNow(), `Conducteur retiré de la rotation ${rot.name ?? rot.id}`);
  }
}
/** Motif d'une évaluation ; `severity` « warn » : avertissement, jamais bloquant. */
function hsReason(code, since, detail, pending = false, severity = "block") {
  const s = hsReasonSetting(code);
  return { code, label: s.label, source: s.source, since: since ?? null, waivable: s.waivable && !HS_NOT_WAIVABLE.includes(code), detail, resolution: s.resolution, severity, pending, waiver_id: null };
}
/** Motifs de la rotation : { reasons (block), warnings (warn), waived } ; detail de V03 nul hors hsseq. */
function hsReasons(ctx, rot, applyWaivers = true) {
  hsAutoAttach(ctx, rot);
  const v = hsVehicle(rot.vehicle_id);
  const kind = hsKind(v);
  const site = hsVehicleSite(v);
  const s = hsSettings();
  const on = (code) => {
    const r = hsReasonSetting(code);
    return r.active && r.lot <= 2 && r.vehicle_kinds.includes(kind) && !r.disabled_sites.includes(site);
  };
  const created = stamp(rot.date_loading, 5, 0);
  const hs = hsIs(ctx, "hsseq");
  const day = rot.date_loading > TODAY ? rot.date_loading : TODAY;
  const reasons = [];
  const warnings = [];
  const add = (code, since, detail, pending = false, severity = "block") => {
    if (on(code)) (severity === "block" ? reasons : warnings).push(hsReason(code, since, detail, pending, severity));
  };
  if (!HS.checks.some((c) => c.rotation_id === rot.id && c.kind === "pre_departure")) add("V01", created, null, true);
  const open = HS.ncs.filter((n) => n.vehicle_id === v.id && n.blocking && n.status === "open").sort((a, b) => a.found_at.localeCompare(b.found_at));
  if (open.length) add("V02", open[0].found_at, [...new Set(open.map((n) => n.label))].join(", "));
  // V03 : alcootest du conducteur de la rotation (un positif l'en retire).
  if (!rot.driver_id) {
    const removed = hsLiveTests().filter((t) => t.rotation_id === rot.id && hsTestStatus(t) === "non_compliant").sort((a, b) => b.reported_at.localeCompare(a.reported_at))[0];
    if (removed) add("V03", removed.reported_at, hs ? "Alcootest positif : conducteur retiré, à remplacer." : null);
    else add("V03", created, hs ? "Aucun conducteur affecté à la rotation." : null, true);
  } else {
    const tests = hsLiveTests().filter((x) => x.rotation_id === rot.id && x.driver_id === rot.driver_id).sort((a, b) => b.reported_at.localeCompare(a.reported_at));
    const positive = tests.find((t) => hsTestStatus(t) === "non_compliant");
    if (positive) add("V03", positive.reported_at, hs ? "Alcootest positif : conducteur retiré de la rotation." : null);
    else if (!tests.length) add("V03", created, hs ? "Alcootest non réalisé." : null, true);
    else if (!tests[0].performed) add("V03", tests[0].reported_at, hs ? "Alcootest non réalisé." : null, true);
  }
  // V04 : habilitation du conducteur (permis poids lourd dans la maquette).
  const d = hsDriver(rot.driver_id);
  if (d && d.license_expiry && d.license_expiry < day) add("V04", `${addDays(d.license_expiry, 1)}T00:00:00Z`, `Permis de conduire poids lourd : expirée.`);
  else if (d && !d.license_expiry) add("V04", null, `Permis de conduire poids lourd : absente.`, false, s.qualifications_required_from && day >= s.qualifications_required_from ? "block" : "warn");
  // V05 : assurance et visite technique (Transport), expirées ou non renseignées.
  const docs = HS.docs.filter((x) => x.vehicle_id === v.id && ["insurance", "inspection"].includes(x.kind));
  const expired = docs.filter((x) => x.expiry_date < day);
  if (expired.length) add("V05", `${addDays(expired.map((x) => x.expiry_date).sort()[0], 1)}T00:00:00Z`, expired.map((x) => `${HS_DOC_LABELS[x.kind].toLowerCase()} expirée le ${frDate(x.expiry_date)}`).join(", "));
  const missing = ["insurance", "inspection"].filter((k) => !docs.some((x) => x.kind === k));
  if (missing.length) add("V05", null, missing.map((k) => `${HS_DOC_LABELS[k].toLowerCase()} non renseignée`).join(", "), false, s.documents_required_from && day >= s.documents_required_from ? "block" : "warn");
  // V06 (lot 2) : barémage et certificat d'étanchéité de la citerne, expirés ou non renseignés.
  if (kind === "tanker") {
    const v06 = HS.docs.filter((x) => x.vehicle_id === v.id && ["calibration", "tightness"].includes(x.kind));
    const perimes = v06.filter((x) => x.expiry_date < day);
    if (perimes.length) add("V06", `${addDays(perimes.map((x) => x.expiry_date).sort()[0], 1)}T00:00:00Z`, perimes.map((x) => `${HS_DOC_LABELS[x.kind]} expiré le ${frDate(x.expiry_date)}`).join(", "));
    const absents = ["calibration", "tightness"].filter((k) => !v06.some((x) => x.kind === k));
    if (absents.length) add("V06", null, absents.map((k) => `${HS_DOC_LABELS[k]} non renseigné`).join(", "), false, s.documents_required_from && day >= s.documents_required_from ? "block" : "warn");
  }
  // V07 et V08 (lot 2) : surcharge pesée (bennes) et plan de trajet, lus dans les tables du module hsseq-trajets.
  const v07 = motifSurcharge(rot);
  if (v07) add("V07", v07.since, v07.detail);
  const v08 = motifTrajet(rot);
  if (v08) add("V08", v08.since, v08.detail);
  // V09 (lot 2) : véhicule immobilisé par un événement en cours d'enquête (table du module hsseq-trajets).
  const immobilisation = (DB.hsseq.immobilizations ?? []).find((i) => i.vehicle_id === v.id && i.status === "active");
  if (immobilisation) {
    const ev = HS.events.find((e) => e.id === immobilisation.event_id);
    add("V09", immobilisation.since, `${v.name} immobilisé par l'événement ${ev?.reference ?? `#${immobilisation.event_id}`}${ev ? ` (${ev.title})` : ""}.`);
  }
  const waived = [];
  if (applyWaivers) {
    hsExpireWaivers();
    const actives = HS.waivers.filter((w) => w.rotation_id === rot.id && w.status === "active");
    for (const r of reasons) {
      const w = actives.find((x) => x.reason_code === r.code);
      if (w && r.waivable) {
        r.waiver_id = w.id;
        waived.push(r);
      }
    }
  }
  return { reasons, warnings, waived };
}
/** Évaluation au format de POST /hsseq/lock/evaluate (§4.2). */
function hsEvaluate(ctx, rot) {
  const { reasons, warnings } = hsReasons(ctx, rot);
  const active = hsLockActive(rot);
  const open = reasons.filter((r) => !r.waiver_id);
  const actives = HS.waivers.filter((w) => w.rotation_id === rot.id && w.status === "active");
  const first = actives[0];
  return {
    rotation_id: rot.id, allowed: !active || !open.length, lock_active: active, reasons, warnings,
    active_waiver: first ? { id: first.id, reason_code: first.reason_code, approved_by: first.approvals.map((a) => hsUser(a.by)), expires: first.expires } : null,
    active_waivers: actives.map((w) => ({ id: w.id, reason_code: w.reason_code, expires: w.expires })),
    pending_checks_only: open.length > 0 && open.every((r) => r.pending),
    checked_at: hsNow(),
  };
}
function hsDepartures(ctx, day, q, blockedOnly = q.blocked === "1" || q.blocked === "true") {
  // Départs du jour : rotations à charger ce jour-là, pas encore parties (draft).
  const items = hsDepartureRotations(day)
    .filter((r) => r.state === "draft")
    .map((r) => ({ r, v: hsVehicle(r.vehicle_id) }))
    .filter(({ v }) => v && hsFilter(ctx, q, hsVehicleSite(v), hsKind(v)) && hsSiteOk(ctx, hsVehicleSite(v)))
    .sort((a, b) => a.r.date_loading.localeCompare(b.r.date_loading) || a.r.id - b.r.id)
    .map(({ r, v }) => {
      const evaluation = hsEvaluate(ctx, r);
      return { rotation: hsRotationRef(r), vehicle: hsVehicleRef(v.id), driver: hsDriverRef(r.driver_id), site: hsSiteRef(hsVehicleSite(v)), evaluation, pending_checks_only: evaluation.pending_checks_only };
    });
  const allowed = items.filter((i) => i.evaluation.allowed).length;
  return { date: day, total: items.length, allowed, blocked: items.length - allowed, items: blockedOnly ? items.filter((i) => !i.evaluation.allowed) : items };
}

/* ─── Événements ────────────────────────────────────────────────────────── */

const hsCriticality = (e) => (e.potential_severity && e.probability ? e.potential_severity * e.probability : null);
const hsEventActions = (e) => HS.actions.filter((a) => a.event_id === e.id);
const hsActionOpen = (a) => !["closed", "cancelled"].includes(a.status);
const hsEventOverdue = (e) => Boolean(e.deadlines.investigation_due) && ["classified", "investigation"].includes(e.status) && e.deadlines.investigation_due < hsNow();
function hsEventLine(e) {
  const c = hsCriticality(e);
  return {
    id: e.id, reference: e.reference, title: e.title, type: e.type, domain: e.domain, status: e.status, occurred_at: e.occurred_at, site: hsSiteRef(e.site_id),
    vehicle: e.vehicle_id ? hsVehicleRef(e.vehicle_id) : null, rotation: hsRotationRef(hsRotation(e.rotation_id)),
    actual_severity: e.actual_severity, potential_severity: e.potential_severity, probability: e.probability, criticality: c, level: hsLevel(c),
    reported_by: hsUser(e.reported_by), open_actions: hsEventActions(e).filter(hsActionOpen).length, investigation_due: e.deadlines.investigation_due,
    investigation_overdue: hsEventOverdue(e), total_cost: sum(e.costs, (x) => x.amount),
  };
}
/** Transitions du compte (hsseq seul) ; « close » retirée tant qu'une action reste ouverte. */
function hsEventTransitions(ctx, e) {
  if (!hsIs(ctx, "hsseq")) return [];
  const actions = hsEventActions(e);
  const t = {
    reported: ["classify"],
    classified: ["investigate", ...(hsLevel(hsCriticality(e)) === "low" && !actions.length ? ["close"] : [])],
    investigation: ["plan"],
    actions: ["close"],
    closed: ["reopen"],
  }[e.status];
  return [...t.filter((x) => x !== "close" || !actions.some(hsActionOpen)), ...(immobilisationProposee(e) ? ["immobilize"] : [])];
}
/** Personne en cause : `id` est la ligne, `person_id` le chauffeur ou le salarié. */
const hsPersonRow = (p) => ({ id: p.line_id, kind: p.kind, person_id: p.kind === "third_party" ? null : p.id ?? null, name: p.name, role: p.role, days_off: p.days_off ?? 0 });
/** Enquête au format de l'API, toujours servie ; vide tant qu'elle n'est pas ouverte. */
function hsInvestigationRow(e) {
  const inv = e.investigation;
  const texte = (l) => (Array.isArray(l) ? l.filter(Boolean).join("\n") || null : l || null);
  if (!inv) {
    return { method: null, team: [], immediate_causes: null, whys: [], tree: [], factors_5m: Object.fromEntries(HS_FACTORS.map((k) => [k, null])), root_cause: null, conclusion: null, started_at: null, closed_at: null, due: e.deadlines.investigation_due };
  }
  return {
    method: inv.method, team: inv.team_ids.map(hsUser), immediate_causes: texte(inv.immediate_causes), whys: inv.whys,
    tree: inv.tree.map((n) => ({ id: String(n.id), label: n.label, parent_id: n.parent_id === null || n.parent_id === undefined ? null : String(n.parent_id), kind: n.kind })),
    factors_5m: Object.fromEntries(HS_FACTORS.map((k) => [k, texte(inv.factors_5m[k])])), root_cause: inv.root_cause, conclusion: inv.conclusion,
    started_at: inv.opened_at, closed_at: inv.concluded_at, due: e.deadlines.investigation_due,
  };
}
function hsEventDetail(ctx, e) {
  const transitions = hsEventTransitions(ctx, e);
  const hs = hsIs(ctx, "hsseq");
  // Un conducteur lit sa déclaration, sans la suite donnée (actions, coûts, notifications, journal).
  const self = hsScope(ctx) === "self";
  const declarant = e.reported_by === ctx.user.id && e.status === "reported" && hasProfile(ctx, ["exploitation", "conducteur", "hsseq"]);
  return {
    ...hsEventLine(e), description: e.description, location: e.location, latitude: e.latitude, longitude: e.longitude, gps_accuracy: e.gps_accuracy, source: e.source, client_uuid: e.client_uuid, reported_at: e.reported_at,
    synced_at: e.synced_at, offline: e.offline, people: e.people.map(hsPersonRow), lost_time: e.lost_time, days_lost: e.days_lost, leave_id: e.leave_id ?? null,
    declared: {
      actual_severity: e.declared_actual_severity ?? null, potential_severity: e.declared_potential_severity ?? null, probability: e.declared_probability ?? null,
      criticality: e.declared_potential_severity && e.declared_probability ? e.declared_potential_severity * e.declared_probability : null,
    },
    vehicle_immobilized: e.vehicle_immobilized, immobilization: immobilisationDeLEvenement(e.id), immobilization_proposed: immobilisationProposee(e),
    classified_at: e.classified_at, classified_by: hsUser(e.classified_by), closed_at: e.closed_at, closed_by: hsUser(e.closed_by), reopen_reason: e.reopen_reason ?? null,
    investigation: hsInvestigationRow(e),
    actions: self ? [] : hsEventActions(e).map(hsActionLine),
    costs: self ? [] : e.costs.map((c) => ({ id: c.id, kind: c.kind, label: c.label, amount: c.amount, date: c.date, finance_move_id: c.finance_move_id ?? null })),
    attachments: hsAttachments("event", e.id),
    notifications: self ? [] : HS.notifications.filter((n) => n.model === "event" && n.res_id === e.id).sort((a, b) => b.id - a.id).map(hsNotificationRow),
    deadlines: e.deadlines, history: self ? [] : hsHistory("event", e.id), transitions,
    rights: { can_edit: (hs && e.status !== "closed") || declarant, can_close: transitions.includes("close"), can_approve: hs && e.status !== "closed" },
  };
}
/** Notifications du niveau au classement : Directeur général pour « élevée », Responsable HSSEQ et responsable métier pour « significative » et plus. */
function hsNotifyLevel(e, at) {
  const level = hsLevel(hsCriticality(e));
  const titre = `${e.reference} ${e.title}`;
  if (level === "high") hsNotify(hsDirectors(), "high", `Criticité élevée : ${titre}`, `Criticité ${hsCriticality(e)}, enquête sous ${hsSettings().investigation_hours_high} h, donneur d'ordre à informer sous ${hsSettings().client_notice_hours} h.`, "event", e.id, at);
  if (level === "high" || level === "significant") hsNotify([...hsHsseqManagers(), e.site_id === 2 ? 18 : 11], level, `Criticité ${HS_LEVEL_LABELS[level].toLowerCase()} : ${titre}`, "Enquête à ouvrir dans le délai du niveau.", "event", e.id, at);
}
/** Classement (§9.1) : criticité, niveau, échéance d'enquête, information du donneur d'ordre, notifications. */
function hsClassify(e, by, at, values) {
  Object.assign(e, values);
  const level = hsLevel(hsCriticality(e));
  const minutes = hsInvestigationMinutes(level);
  const base = e.reported_at ?? at;
  e.status = "classified";
  e.classified_at = at;
  e.classified_by = by;
  e.deadlines.investigation_due = minutes ? hsAddMinutes(base, minutes) : null;
  e.deadlines.client_notice_due = level === "high" ? hsAddMinutes(base, hsSettings().client_notice_hours * 60) : null;
  hsLog("event", e.id, by, "classify", "criticality", null, hsCriticality(e), at, `Criticité ${hsCriticality(e)}, niveau ${HS_LEVEL_LABELS[level] ?? "-"}`);
  hsNotifyLevel(e, at);
}

/* ─── Actions ───────────────────────────────────────────────────────────── */

function hsActionOriginLabel(a) {
  if (a.event_id) {
    const e = HS.events.find((x) => x.id === a.event_id);
    return e ? `${e.reference} ${e.title}` : null;
  }
  if (a.check_id) return HS.checks.find((x) => x.id === a.check_id)?.reference ?? null;
  // Constat d'audit (lot 2) : référence et description.
  if (a.origin === "audit") {
    const f = (DB.hsseq.findings ?? []).find((x) => x.id === a.origin_id);
    return f ? `${f.reference} ${String(f.description ?? "").slice(0, 120)}` : null;
  }
  // Risque (lot 2) : référence et événement redouté.
  const risque = a.origin === "risk" ? (DB.hsseq.risks ?? []).find((x) => x.id === a.origin_id) : null;
  if (risque) return `${risque.reference} ${String(risque.feared_event ?? "").slice(0, 120)}`;
  // Revue de direction (lot 3) : référence et intitulé.
  // Réclamation et exercice (lot 3) : leur référence, et l'objet ou le plan.
  if (a.origin === "complaint") {
    const c = (DB.hsseq.complaints ?? []).find((x) => x.id === a.origin_id);
    return c ? `${c.reference} ${String(c.subject ?? c.title ?? c.description ?? "").slice(0, 120)}` : null;
  }
  if (a.origin === "drill") {
    const d = (DB.hsseq.drills ?? []).find((x) => x.id === a.origin_id);
    const plan = d ? (DB.hsseq.emergencyPlans ?? []).find((x) => x.id === d.plan_id) : null;
    return d ? `${d.reference}${plan ? ` ${plan.title}` : ""}` : null;
  }
  if (a.origin === "review") {
    const r = (DB.hsseq.reviews ?? []).find((x) => x.id === a.origin_id);
    return r ? `${r.reference} ${r.title}` : null;
  }
  return null;
}
const hsActionCriticality = (a) => (a.event_id ? hsCriticality(HS.events.find((x) => x.id === a.event_id) ?? {}) ?? 0 : 0);
const hsIsCostly = (a) => (a.estimated_cost ?? 0) >= hsSettings().costly_action_threshold;
const hsNeedsApproval = (a) => hsIsCostly(a) && !a.approved_at;
/** Validation de la direction attendue : action coûteuse non validée, ni close ni annulée. */
const hsApprovalPending = (a) => hsNeedsApproval(a) && !["closed", "cancelled"].includes(a.status);
const hsDaysOverdue = (a) => (["todo", "in_progress"].includes(a.status) && a.due_date < TODAY ? daysBetween(a.due_date, TODAY) : 0);
function hsActionLine(a) {
  const e = a.event_id ? HS.events.find((x) => x.id === a.event_id) : null;
  return {
    id: a.id, reference: a.reference, description: a.description, origin: a.origin, origin_id: a.origin_id ?? a.event_id ?? a.check_id ?? null, origin_label: hsActionOriginLabel(a),
    event: e ? { id: e.id, reference: e.reference } : null, control_level: a.control_level ?? null, owner: hsUser(a.owner_id), due_date: a.due_date,
    status: a.status, overdue: hsDaysOverdue(a) > 0, days_overdue: hsDaysOverdue(a),
    verification_required: hsActionCriticality(a) >= hsSettings().verification_min_criticality, verification_date: a.verification_date,
    site: hsSiteRef(a.site_id), estimated_cost: a.estimated_cost ?? 0, approval_required: hsNeedsApproval(a), approval_pending: hsApprovalPending(a),
    // Résultat de la vérification d'efficacité, nul tant qu'elle n'est pas faite.
    effective: a.verified_at ? (a.effective ?? null) : null,
  };
}
/** Relances déjà envoyées au responsable : J-7, J0, chaque semaine de retard, escalade après le délai des paramètres. */
function hsReminders(a) {
  if (!["todo", "in_progress"].includes(a.status)) return [];
  const list = [];
  const pour = (kind, date) => list.push({ kind, date, recipients: kind === "escalation" ? [hsUser(a.owner_id), ...hsDirectors().map(hsUser)] : [hsUser(a.owner_id)] });
  const before = addDays(a.due_date, -7);
  if (before <= TODAY) pour("d_minus_7", before);
  if (a.due_date <= TODAY) pour("d0", a.due_date);
  for (let d = addDays(a.due_date, 7); d <= TODAY; d = addDays(d, 7)) pour("weekly", d);
  if (daysBetween(a.due_date, TODAY) > hsSettings().escalation_days) pour("escalation", addDays(a.due_date, hsSettings().escalation_days + 1));
  return list.sort((x, y) => x.date.localeCompare(y.date));
}
/** Transitions permises depuis le statut, puis bornées au compte (responsable, hsseq, direction). */
function hsActionTransitions(ctx, a) {
  const permises = { todo: ["start", "cancel", ...(hsNeedsApproval(a) ? ["approve"] : [])], in_progress: ["close", "cancel"], to_verify: ["verify", "cancel"], closed: ["reopen"], cancelled: ["reopen"] }[a.status];
  const owner = a.owner_id === ctx.user.id;
  const hs = hsIs(ctx, "hsseq");
  return permises.filter((t) => {
    if (t === "start" || t === "close") return owner || hs;
    if (t === "cancel" || t === "reopen") return hs;
    if (t === "verify") return hs && (!a.verification_date || a.verification_date <= TODAY);
    return hsIs(ctx, "direction");
  });
}
function hsActionDetail(ctx, a) {
  const transitions = hsActionTransitions(ctx, a);
  return {
    ...hsActionLine(a), expected_evidence: a.expected_evidence ?? null, evidence: hsAttachments("action", a.id),
    management_approval: { required: hsIsCostly(a), approved_at: a.approved_at, approved_by: hsUser(a.approved_by), approved_cost: a.approved_cost ?? null },
    created_at: a.created_at, created_by: hsUser(a.created_by), started_at: a.started_at ?? null, done_at: a.done_at, verified_at: a.verified_at, verified_by: hsUser(a.verified_by),
    effective: a.verified_at ? a.effective : null, verification_comment: a.verification_comment, closed_at: a.closed_at, cancel_reason: a.cancel_reason ?? null, reopen_reason: a.reopen_reason ?? null,
    reminders: hsReminders(a), history: hsHistory("action", a.id), transitions,
    rights: { can_edit: (a.owner_id === ctx.user.id || hsIs(ctx, "hsseq")) && hsActionOpen(a), can_close: transitions.includes("close"), can_approve: transitions.includes("verify") || transitions.includes("approve") },
  };
}
function hsNewAction(values) {
  const a = {
    id: ++HS.seq.action, reference: "", description: values.description, origin: values.origin, origin_id: values.origin_id ?? null,
    event_id: values.origin === "event" ? values.origin_id : null, check_id: values.origin === "check" ? values.origin_id : null, control_level: values.control_level ?? null,
    owner_id: values.owner_id, due_date: values.due_date, status: values.status ?? "todo", expected_evidence: values.expected_evidence ?? HS_PROOFS[values.control_level] ?? null,
    estimated_cost: values.estimated_cost ?? 0, approved_at: null, approved_by: null, approved_cost: null, created_at: values.created_at ?? hsNow(), created_by: values.created_by ?? 16,
    started_at: null, done_at: null, verified_at: null, verified_by: null, verification_comment: null, effective: false, verification_date: null, closed_at: null,
    cancel_reason: null, reopen_reason: null, site_id: values.site_id === undefined ? 1 : values.site_id,
  };
  a.reference = `ACT/2026/${pad(a.id, 4)}`;
  HS.actions.push(a);
  return a;
}

/* ─── Dérogations ───────────────────────────────────────────────────────── */

function hsWaiverRow(ctx, w) {
  hsExpireWaivers();
  const hs = hsIs(ctx, "hsseq");
  const mine = w.requested_by === ctx.user.id;
  const t = [];
  if (w.status === "pending_hsseq" && hs && !mine) t.push("approve", "refuse");
  if (["pending_hsseq", "active"].includes(w.status) && (hs || mine)) t.push("cancel");
  return {
    id: w.id, reference: w.reference, rotation: hsRotationRef(hsRotation(w.rotation_id)), vehicle: hsVehicleRef(w.vehicle_id), site: hsSiteRef(w.site_id),
    reason_code: w.reason_code, reason_label: hsReasonSetting(w.reason_code)?.label ?? w.reason_code, justification: w.justification, requested_by: hsUser(w.requested_by),
    requested_at: w.requested_at, approvals: w.approvals.map((a) => ({ level: a.level, role: a.role, by: hsUser(a.by), at: a.at })), status: w.status,
    expires: w.expires, expired_at: w.expired_at ?? null, refusal_reason: w.refusal_reason, decided_by: hsUser(w.decided_by ?? null), management_notified_at: w.management_notified_at,
    attachments: hsAttachments("waiver", w.id), history: hsHistory("waiver", w.id), transitions: t,
    rights: { can_edit: mine && w.status === "pending_hsseq", can_close: t.includes("cancel"), can_approve: t.includes("approve") },
  };
}
const hsCanSeeWaiver = (ctx, w) => hsFull(ctx) || (hsScope(ctx) === "site" && (w.requested_by === ctx.user.id || hsSiteOk(ctx, w.site_id)));

/* ─── Échéances ─────────────────────────────────────────────────────────── */

function hsDeadlines(ctx, q) {
  const horizonTexte = q.horizon ?? "";
  if (horizonTexte !== "" && !/^\d+$/.test(String(horizonTexte))) throw hsBad("Horizon invalide.", ["horizon"]);
  const horizon = Math.min(Math.max(Number(horizonTexte || 30), 0), 366);
  let kind = q.kind || null;
  if (kind && !["qualification", "vehicle_document"].includes(kind)) throw hsBad("Nature d'échéance inconnue.", ["kind"]);
  // Profil RH seul : les personnes, pas les véhicules.
  if (!hasProfile(ctx, HS_READ)) {
    if (kind === "vehicle_document") throw hsForbidden("Les échéances des véhicules ne relèvent pas du profil RH.");
    kind = "qualification";
  }
  const limit = addDays(TODAY, horizon);
  const items = [];
  if (kind !== "vehicle_document") {
    for (const d of [...DB.drivers.filter((x) => x.company_id === 1 && x.active), ...HS.drivers]) {
      if (!d.license_expiry || d.license_expiry > limit) continue;
      const site = HS.driverSites.get(d.id) ?? 1;
      if (!hsFilter(ctx, q, site, null) || !hsSiteOk(ctx, site)) continue;
      items.push({ kind: "qualification", document_kind: "permis_pl", subject: { type: "driver", id: d.id, name: d.name }, label: "Permis de conduire poids lourd", expires_on: d.license_expiry, days_left: daysBetween(TODAY, d.license_expiry), expired: d.license_expiry < TODAY, reason_code: "V04", site: hsSiteRef(site) });
    }
  }
  if (kind !== "qualification") {
    for (const doc of HS.docs) {
      const v = hsVehicle(doc.vehicle_id);
      if (!v || v.state === "off" || doc.expiry_date > limit) continue;
      const site = hsVehicleSite(v);
      if (!hsFilter(ctx, q, site, hsKind(v)) || !hsSiteOk(ctx, site)) continue;
      items.push({ kind: "vehicle_document", document_kind: doc.kind, subject: { type: "vehicle", id: v.id, name: v.name }, label: HS_DOC_LABELS[doc.kind], expires_on: doc.expiry_date, days_left: daysBetween(TODAY, doc.expiry_date), expired: doc.expiry_date < TODAY, reason_code: ["calibration", "tightness"].includes(doc.kind) ? "V06" : "V05", site: hsSiteRef(site) });
    }
  }
  return { horizon_days: horizon, items: items.sort((a, b) => a.expires_on.localeCompare(b.expires_on) || a.subject.name.localeCompare(b.subject.name)) };
}

/* ─── Cockpit (§10) ─────────────────────────────────────────────────────── */

const hsEventKind = (e) => {
  const v = e.vehicle_id ? hsVehicle(e.vehicle_id) : null;
  return v ? hsKind(v) : e.site_id === 2 ? "tipper" : "tanker";
};
/** Comptes d'événements d'un mois et d'un type de véhicule : historique avant 2026, données ensuite. */
function hsEventCounts(month, kind) {
  if (month < "2026-01") return HS.history.get(`${month}|${kind}`) ?? { lt: 0, days: 0, work: 0, road: 0, nm: 0 };
  const list = HS.events.filter((e) => e.occurred_at.slice(0, 7) === month && hsEventKind(e) === kind);
  return {
    lt: list.filter((e) => e.type === "work_accident" && e.lost_time).length + list.filter((e) => e.type === "road_accident" && e.lost_time).length,
    days: sum(list, (e) => e.days_lost),
    work: list.filter((e) => e.type === "work_accident").length,
    road: list.filter((e) => e.type === "road_accident").length,
    nm: list.filter((e) => ["near_miss", "hazard"].includes(e.type)).length,
  };
}
/** Heures travaillées (RH, par société et par mois, sans maille site : décision 5). */
function hsHours(month, company) {
  const r = makeRng(`hsseq-heures-${month}-${company}`);
  return company === 2 ? Math.round(1900 * r.noise(0.05)) : Math.round(22000 * r.noise(0.04));
}
/** Kilomètres d'un mois : rotations de Transport pour les citernes, postes de la mine pour les bennes. */
function hsKm(month, kind) {
  if (kind === "tipper") return Math.round(48600 * makeRng(`hsseq-km-${month}`).noise(0.06) * (month === TODAY.slice(0, 7) ? PARTIAL : 1));
  const rots = DB.rotations.filter((r) => r.company_id === 1 && r.state !== "cancelled" && r.date_loading.slice(0, 7) === month);
  if (!rots.length) return Math.round(HS.avgTankerKm * makeRng(`hsseq-kmc-${month}`).noise(0.07));
  return sum(rots, (r) => 2 * (DB.routes.find((x) => x.id === r.route_id)?.distance_km ?? 0));
}
/** Litres de gazole d'un mois (citernes : coût de carburant des rotations ÷ prix du litre). */
function hsLiters(month, kind) {
  const km = hsKm(month, kind);
  if (kind === "tipper") return (km * 57 * makeRng(`hsseq-l-${month}`).noise(0.03)) / 100;
  const rots = DB.rotations.filter((r) => r.company_id === 1 && r.state !== "cancelled" && r.date_loading.slice(0, 7) === month);
  if (!rots.length) return (km * 44 * makeRng(`hsseq-lc-${month}`).noise(0.03)) / 100;
  return sum(rots, (r) => r.fuel_cost / (r.date_loading >= "2026-06-01" ? 12500 : 12000));
}
function hsSynth(code, month, key, base, spread, min, max, digits = 1) {
  const r = makeRng(`hsseq-${code}-${month}-${key}`);
  const p = 10 ** digits;
  return Math.round(Math.min(max, Math.max(min, base + (r.next() * 2 - 1) * spread)) * p) / p;
}
function hsIndicators(ctx, q, month, period) {
  const months = monthKeys(addMonths(`${month}-01`, -11), `${month}-01`);
  const company = q.company_id ? Number(q.company_id) : null;
  const transport = company === null || company === 1;
  const site = q.site_id ? Number(q.site_id) : null;
  const kindFilter = q.vehicle_kind || (site === 1 ? "tanker" : site === 2 ? "tipper" : null);
  const kinds = kindFilter ? [kindFilter] : ["tanker", "tipper"];
  const key = `${kinds.join("+")}`;
  const current = TODAY.slice(0, 7);
  const window = (m) => monthKeys(addMonths(`${m}-01`, -11), `${m}-01`);
  const counts = (m, k) => kinds.reduce((acc, kind) => {
    const c = hsEventCounts(m, kind);
    for (const f of Object.keys(acc)) acc[f] += c[f];
    return acc;
  }, { lt: 0, days: 0, work: 0, road: 0, nm: 0, ...k });
  // TF et TG : société entière (heures de RH sans maille site), tous types de véhicule.
  const companyCounts = (m) => ["tanker", "tipper"].reduce((acc, kind) => {
    const c = hsEventCounts(m, kind);
    acc.lt += c.lt;
    acc.days += c.days;
    return acc;
  }, { lt: 0, days: 0 });
  const hours12 = (m) => sum(window(m), (x) => (company === null ? hsHours(x, 1) + hsHours(x, 2) : hsHours(x, company)));
  const rolling = (m, f) => sum(window(m), (x) => f(x));
  // Départs, contrôles et alcootests du mois courant, d'après les données de la maquette.
  const departures = [];
  for (let d = `${current}-01`; d <= TODAY; d = addDays(d, 1)) {
    for (const r of hsDepartureRotations(d)) {
      const v = hsVehicle(r.vehicle_id);
      if (v && kinds.includes(hsKind(v))) departures.push(r);
    }
  }
  // Départs du mois : rotations parties, validées ou facturées.
  const parties = departures.filter((r) => ["en_route", "done", "invoiced"].includes(r.state));
  departures.length = 0;
  departures.push(...parties);
  const checked = departures.filter((r) => HS.checks.some((c) => c.rotation_id === r.id && c.kind === "pre_departure"));
  const monthChecks = HS.checks.filter((c) => c.reported_at.slice(0, 7) === current && kinds.includes(c.vehicle_kind));
  const monthTests = hsLiveTests().filter((t) => t.reported_at.slice(0, 7) === current && departures.some((r) => r.id === t.rotation_id));
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const actionsDue = (m) => HS.actions.filter((a) => a.due_date.slice(0, 7) === m && a.due_date < TODAY && a.status !== "cancelled" && kinds.includes(hsSite(a.site_id)?.default_vehicle_kind ?? "tanker"));
  const actionsVerified = (m) => HS.actions.filter((a) => a.verified_at && a.verified_at.slice(0, 7) === m && kinds.includes(hsSite(a.site_id)?.default_vehicle_kind ?? "tanker"));
  // Dérogations activées (actives ou expirées depuis), au mois de leur seconde validation.
  const waiverList = (m) => HS.waivers.filter((w) => ["active", "expired"].includes(w.status) && w.approvals[1]?.at.slice(0, 7) === m && kinds.includes(hsKind(hsVehicle(w.vehicle_id))));
  const driversValid = () => {
    const list = [...DB.drivers.filter((d) => d.company_id === 1 && d.active), ...HS.drivers].filter((d) => kinds.includes((HS.driverSites.get(d.id) ?? 1) === 2 ? "tipper" : "tanker"));
    return pct(list.filter((d) => d.license_expiry && d.license_expiry >= TODAY).length, list.length);
  };
  const fuel = (m) => {
    const km = sum(kinds, (k) => hsKm(m, k));
    return km ? Math.round((sum(kinds, (k) => hsLiters(m, k)) / km) * 1000) / 10 : null;
  };
  const tankerShortage = (m) => {
    const rots = DB.rotations.filter((r) => r.company_id === 1 && r.state !== "cancelled" && r.date_loading.slice(0, 7) === m && r.volume_delivered > 0);
    if (!rots.length) return hsSynth("ecart-citerne", m, key, 1.4, 0.4, 0.5, 3, 2);
    return Math.round((sum(rots, (r) => r.shortage) / sum(rots, (r) => r.volume_delivered)) * 100000) / 100;
  };
  const tipperVariance = (m) => {
    const rots = HS.rotations.filter((r) => r.date_loading.slice(0, 7) === m && r.state === "done");
    if (!rots.length) return hsSynth("ecart-benne", m, key, 6, 2, 2, 11, 2);
    return Math.round((sum(rots, (r) => r.tonnage_loaded - r.tonnage_delivered) / sum(rots, (r) => r.tonnage_loaded)) * 100000) / 100;
  };
  const defs = [
    ["frequency_rate", "Taux de fréquence", "rate", "down", "Événements, RH", "Accidents du travail avec arrêt × 1 000 000 ÷ heures travaillées, 12 mois glissants", false,
      (m) => Math.round(((rolling(m, (x) => (company === 2 ? 0 : companyCounts(x).lt)) * 1e6) / hours12(m)) * 100) / 100, "12 mois glissants ; heures de RH par société, sans filtre de site.", true],
    ["severity_rate", "Taux de gravité", "rate", "down", "Événements, RH", "Jours perdus × 1 000 ÷ heures travaillées, 12 mois glissants", false,
      (m) => Math.round(((rolling(m, (x) => (company === 2 ? 0 : companyCounts(x).days)) * 1000) / hours12(m)) * 100) / 100, "12 mois glissants ; heures de RH par société, sans filtre de site.", true],
    ["road_accidents_per_mkm", "Accidents de la route par million de km", "rate", "down", "Événements, Transport", "Accidents de la route × 1 000 000 ÷ km parcourus, 12 mois glissants", true,
      (m) => Math.round(((rolling(m, (x) => counts(x).road) * 1e6) / rolling(m, (x) => sum(kinds, (k) => hsKm(x, k)))) * 100) / 100],
    ["reporting_ratio", "Taux de déclaration", "ratio", "up", "Événements", "(Presque-accidents + situations dangereuses) ÷ accidents, 12 mois glissants", true,
      (m) => {
        const acc = rolling(m, (x) => counts(x).work + counts(x).road);
        return acc ? Math.round((rolling(m, (x) => counts(x).nm) / acc) * 100) / 100 : null;
      }],
    ["check_completion", "Réalisation des contrôles avant départ", "pct", "up", "NIMOVA Terrain, Transport", "Départs contrôlés ÷ départs", true,
      (m) => (m === current ? pct(checked.length, departures.length) : hsSynth("ctl", m, key, 96, 3, 88, 100))],
    ["check_compliance", "Conformité des contrôles", "pct", "up", "NIMOVA Terrain", "Contrôles sans point critique non conforme ÷ contrôles réalisés", true,
      (m) => (m === current ? pct(monthChecks.filter((c) => c.result !== "blocking").length, monthChecks.length) : hsSynth("conf", m, key, 94, 3.5, 85, 100))],
    ["breath_test_completion", "Alcootests réalisés", "pct", "up", "NIMOVA Terrain", "Départs avec un alcootest réalisé ÷ départs", true,
      (m) => (m === current ? pct(new Set(monthTests.filter((t) => t.performed).map((t) => t.rotation_id)).size, departures.length) : hsSynth("alc", m, key, 97, 3, 89, 100))],
    ["breath_test_positives", "Alcootests positifs", "count", "down", "NIMOVA Terrain", "Nombre d'alcootests positifs, sans nom", true,
      (m) => (m === current ? monthTests.filter((t) => t.result === "positive").length : makeRng(`hsseq-pos-${m}-${key}`).weighted([[0, 78], [1, 18], [2, 4]]))],
    ["waivers", "Dérogations au verrou", "count", "down", "Verrou de départ", "Dérogations activées, par site et par motif", true, (m) => waiverList(m).length],
    ["actions_on_time", "Actions dans les délais", "pct", "up", "Actions", "Actions réalisées à l'échéance ÷ actions échues", true,
      (m) => {
        const due = actionsDue(m);
        return due.length ? pct(due.filter((a) => a.done_at && a.done_at <= a.due_date).length, due.length) : hsSynth("delais", m, key, 86, 8, 60, 100);
      }],
    ["actions_effectiveness", "Efficacité des actions", "pct", "up", "Actions", "Actions efficaces à J+90 ÷ actions vérifiées", true,
      (m) => {
        const done = actionsVerified(m);
        return done.length ? pct(done.filter((a) => a.effective).length, done.length) : hsSynth("eff", m, key, 82, 10, 50, 100);
      }],
    ["qualifications_valid", "Habilitations à jour", "pct", "up", "Habilitations RH", "Conducteurs actifs sans habilitation expirée ni absente ÷ conducteurs actifs", true,
      (m) => (m === current ? driversValid() : hsSynth("hab", m, key, 96, 3, 88, 100)), "Situation du jour ; les mois passés figés gardent la leur."],
    ["fuel_consumption", "Consommation", "l_100km", "down", "Transport", "Litres aux 100 km (rotations dont le carburant est saisi)", true, (m) => fuel(m)],
    ["co2_emissions", "Émissions de CO₂", "kg_co2_km", "down", "Transport", "kg de CO₂ par km (2,68 kg par litre de gazole)", true,
      (m) => {
        const f = fuel(m);
        return f === null ? null : Math.round(((f * 2.68) / 100) * 100) / 100;
      }],
    ["tanker_shortage", "Écarts de livraison des citernes", "per_mille", "down", "Transport", "Volume manquant ÷ volume livré", true, (m) => (kinds.includes("tanker") && kindFilter !== "tipper" ? tankerShortage(m) : null)],
    // Sans objet au lot 1 : le noyau le sert nul, sans série.
    // Calculé au lot 3 : tonnage chargé (poids net du ticket, à défaut quantité chargée) contre tonnage livré.
    ["tipper_variance", "Écarts de tonnage des bennes", "per_mille", "down", "Transport (pesées et livraisons)", "Écart de tonnage ÷ tonnage chargé", true, (m) => (kinds.includes("tipper") && kindFilter !== "tanker" ? tipperVariance(m) : null)],
    // Lot 2 : audits du mois (annulés exclus) et immobilisations posées dans le mois.
    ["audits_completion", "Audits réalisés contre planifiés", "pct", "up", "Audits", "Audits réalisés ÷ audits planifiés du mois (audits annulés exclus)", true,
      (m) => {
        const list = (DB.hsseq.audits ?? []).filter((a) => a.status !== "cancelled" && String(a.planned_date ?? "").slice(0, 7) === m && (!site || a.site_id === site));
        return pct(list.filter((a) => ["done", "closed"].includes(a.status)).length, list.length);
      }],
    ["immobilizations", "Immobilisations de véhicules (V09)", "count", "down", "Événements, verrou de départ", "Immobilisations posées dans le mois par un événement en cours d'enquête", true,
      (m) => (DB.hsseq.immobilizations ?? []).filter((i) => String(i.since ?? "").slice(0, 7) === m && (!site || i.site_id === site) && kinds.includes(hsKind(hsVehicle(i.vehicle_id)) ?? "tanker")).length],
    // Lot 3 : environnement, qualité, télématique et urgences, d'après les tables des modules du lot 3.
    ["spills", "Déversements", "count", "down", "Environnement (déversements)", "Déversements survenus dans le mois", true,
      (m) => (DB.hsseq.spills ?? []).filter((x) => String(hsChamp(x, "occurred_at", "spilled_at", "date") ?? "").slice(0, 7) === m && (!site || x.site_id === site)).length],
    ["dust_exceedances", "Dépassements du seuil de poussières", "count", "down", "Environnement (poussières sur site)", "Mesures de poussières au-dessus de leur seuil", true,
      (m) => (DB.hsseq.dustMeasurements ?? []).filter((x) => x.exceeded && String(hsChamp(x, "measured_on", "measured_at", "date") ?? "").slice(0, 7) === m && (!site || x.site_id === site)).length],
    ["complaints", "Réclamations clients", "count", "down", "Qualité (réclamations clients)", "Réclamations reçues dans le mois", true,
      (m) => (DB.hsseq.complaints ?? []).filter((x) => String(hsChamp(x, "received_on", "received_at", "date") ?? "").slice(0, 7) === m && (!site || x.site_id === site)).length],
    ["complaints_on_time", "Réclamations traitées dans le délai", "pct", "up", "Qualité (réclamations clients)", "Réclamations répondues dans le délai ÷ réclamations dont le délai de réponse est échu", true,
      (m) => {
        const echues = (DB.hsseq.complaints ?? []).filter((x) => String(hsChamp(x, "response_due") ?? "").slice(0, 7) === m && String(x.response_due) < TODAY && (!site || x.site_id === site));
        return pct(echues.filter((x) => { const r = hsChamp(x, "responded_on", "answered_on", "answered_at"); return r && String(r).slice(0, 10) <= String(x.response_due); }).length, echues.length);
      }],
    ["telematics_violations", "Violations de conduite par 100 voyages", "per_100_trips", "down", "Télématique (import des violations), Transport", "Violations importées ÷ voyages du mois × 100", true,
      (m) => {
        // Sites lus : le filtre, sinon ceux du chef de parc ou de l'auditeur ; voyages des citernes et des bennes.
        const bornes = site ? [site] : hsScope(ctx) === "all" ? null : hsSites(ctx);
        const surSites = (siteId) => !bornes || bornes.includes(siteId);
        const voyages = [...DB.rotations.filter((r) => r.company_id === 1), ...HS.rotations].filter((r) => {
          const v = hsVehicle(r.vehicle_id);
          return ["en_route", "done", "invoiced"].includes(r.state) && r.date_loading.slice(0, 7) === m && v && kinds.includes(hsKind(v)) && surSites(hsVehicleSite(v));
        }).length;
        const n = (DB.hsseq.violations ?? DB.hsseq.telematicsViolations ?? []).filter((x) => {
          const v = hsVehicle(x.vehicle_id);
          return String(hsChamp(x, "occurred_at", "date") ?? "").slice(0, 7) === m && (!v || kinds.includes(hsKind(v))) && surSites(x.site_id ?? (v ? hsVehicleSite(v) : null));
        }).length;
        return voyages ? Math.round((n * 10000) / voyages) / 100 : null;
      }],
    ["drills_completion", "Exercices d'urgence réalisés contre planifiés", "pct", "up", "Documents et urgences", "Exercices réalisés ÷ exercices planifiés du mois (exercices annulés exclus)", true,
      (m) => {
        const list = (DB.hsseq.drills ?? []).filter((x) => x.status !== "cancelled" && String(x.planned_date ?? "").slice(0, 7) === m && (!site || x.site_id === site));
        return pct(list.filter((x) => ["done", "performed"].includes(x.status)).length, list.length);
      }],
  ];
  const s = hsSettings();
  return defs.map(([code, label, unit, direction, source, formula, siteScoped, fn, note = null, companyLevel = false]) => {
    const target = code in (s.targets ?? {}) ? s.targets[code] : HS_TARGETS[code];
    const series = months.map((m) => {
      const v = transport || companyLevel ? fn(m) : null;
      return { month: m, value: v, target: target ?? null, status: hsIndicatorStatus(v, target, direction) };
    });
    const values = series.map((p) => p.value).filter((v) => v !== null);
    let value = series[series.length - 1].value;
    if (period === "12m" && !["rate", "ratio"].includes(unit)) {
      value = !values.length ? null : unit === "count" ? sum(values) : Math.round((sum(values) / values.length) * 100) / 100;
    }
    let breakdown = null;
    if (code === "waivers") {
      // Couples site et motif des dérogations activées de la période (composantes du noyau).
      const list = transport ? (period === "12m" ? months : [month]).flatMap(waiverList) : [];
      const couples = groupBy(list, (w) => `${hsSite(w.site_id)?.name ?? "Sans site"}|${w.reason_code}`);
      breakdown = [...couples].sort((a, b) => a[0].localeCompare(b[0])).map(([cle, ws]) => ({ site: cle.split("|")[0], reason_code: cle.split("|")[1], count: ws.length }));
    }
    const met = value === null || target === null || target === undefined ? null : direction === "down" ? value <= target : value >= target;
    let status = hsIndicatorStatus(value, target, direction);
    // Cible tenue sur la période mais manquée le dernier mois de la série : sous surveillance.
    if (status === "met" && period === "12m" && series[series.length - 1].status === "missed") status = "watch";
    return { code, label, value, target: target ?? null, unit, direction, met, status, family: HS_FAMILY[code] ?? "reactive", source, formula, series, breakdown, site_scoped: siteScoped, note };
  });
}

/* ─── Données ───────────────────────────────────────────────────────────── */

function seedHsseq() {
  const r = makeRng("hsseq");
  HS = DB.hsseq = {
    sites: [
      { id: 1, name: "Parc de Matoto", code: "MAT", company_id: 1, default_vehicle_kind: "tanker", yard_manager_ids: [12], active: true },
      { id: 2, name: "Base minière de Boffa", code: "BOF", company_id: 1, default_vehicle_kind: "tipper", yard_manager_ids: [18], active: true },
    ],
    kinds: new Map(), tippers: [], drivers: [], driverSites: new Map(), vehicleSites: new Map(), rotations: [], docs: [], templates: [], checks: [], ncs: [], tests: [],
    events: [], actions: [], waivers: [], attachments: [], files: new Map(), log: [], notifications: [], settings: new Map(), reasons: [], history: new Map(), avgTankerKm: 0,
    seq: { check: 0, nc: 0, test: 0, event: 0, action: 0, waiver: 0, attachment: 0, cost: 0, site: 2, template: 2, item: 40, log: 0, notification: 0, person: 0 },
  };
  hsSettings(1);
  hsSettings(2);
  for (const v of DB.vehicles) HS.kinds.set(v.id, "tanker");
  for (const d of DB.drivers) HS.driverSites.set(d.id, 1);

  // Bennes de la base de Boffa et leurs conducteurs (Aboubacar Keïta vient de Transport).
  const local = [
    ["Sékouba Camara", "PL-2018-00502", "2027-04-30"],
    ["Mamadou Saliou Diallo", "PL-2016-00319", "2026-11-05"],
    ["Alpha Oumar Baldé", "PL-2020-00648", "2028-02-29"],
    ["Moussa Kaba", "PL-2019-00561", "2027-12-31"],
    ["Ibrahima Sory Bah", "PL-2021-00733", "2029-06-30"],
  ];
  for (const [name, license, expiry] of local) {
    const d = { id: newId("driver"), company_id: 1, name, phone: null, license_number: license, license_expiry: expiry, active: true };
    HS.drivers.push(d);
    HS.driverSites.set(d.id, 2);
  }
  HS.driverSites.set(17, 2);
  const tipperDrivers = [17, ...HS.drivers.map((d) => d.id)];
  for (let i = 0; i < 6; i++) {
    const v = { id: newId("vehicle"), company_id: 1, name: `EB-0${i + 1}`, tractor_plate: `RC 81${pad(i + 1)} C`, trailer_plate: null, brand: i < 4 ? "Sinotruk Howo 371, benne de 20 m³" : "Shacman X3000, benne de 20 m³", capacity_liters: 0, payload_tonnes: 30, driver_id: tipperDrivers[i], state: "service", active: true };
    HS.tippers.push(v);
    HS.kinds.set(v.id, "tipper");
  }
  // Postes de la mine : un par benne et par jour, trois tours de la fosse 3 au port de Dapilon.
  let minSeq = 0;
  for (let d = "2026-09-01"; d <= TODAY; d = addDays(d, 1)) {
    for (const v of HS.tippers) {
      const loaded = round3(3 * (28.6 + r.next() * 2.2));
      const rot = { id: newId("rotation"), company_id: 1, name: null, state: d < TODAY ? "done" : "draft", date_loading: d, date_delivery: d, vehicle_id: v.id, driver_id: v.driver_id, route_id: null, route_name: "Fosse 3 de Boffa - Port de Dapilon", tonnage_loaded: loaded, tonnage_delivered: round3(loaded * (1 - 0.002 - r.next() * 0.008)) };
      if (rot.state === "done") rot.name = `MIN/2026/${pad(++minSeq, 4)}`;
      HS.rotations.push(rot);
    }
  }
  const fullMonths = monthKeys("2026-01-01", addMonths(`${TODAY.slice(0, 7)}-01`, -1));
  HS.avgTankerKm = Math.round(sum(fullMonths, (m) => hsKm(m, "tanker")) / fullMonths.length);
  // Historique des comptes d'événements avant 2026 (séries du cockpit).
  for (const m of monthKeys("2024-11-01", "2025-12-01")) {
    for (const kind of ["tanker", "tipper"]) {
      const h = makeRng(`hsseq-hist-${m}-${kind}`);
      const lt = h.chance(kind === "tanker" ? 0.1 : 0.07) ? 1 : 0;
      HS.history.set(`${m}|${kind}`, { lt, days: lt ? h.int(4, 28) : 0, work: lt + (h.chance(0.12) ? 1 : 0), road: h.chance(kind === "tanker" ? 0.22 : 0.1) ? 1 : 0, nm: h.int(0, kind === "tanker" ? 2 : 1) });
    }
  }

  // Documents des véhicules (Transport : eguitra.transport.vehicle.document).
  const docDate = (from, span) => addDays(from, r.int(0, span));
  for (const v of [...DB.vehicles, ...HS.tippers]) {
    const kinds = hsKind(v) === "tanker" ? ["insurance", "inspection", "calibration", "tightness"] : ["insurance", "inspection"];
    for (const kind of kinds) HS.docs.push({ vehicle_id: v.id, kind, expiry_date: docDate("2026-11-20", 300) });
  }
  const setDoc = (name, kind, date) => {
    const doc = HS.docs.find((x) => x.vehicle_id === hsVehicleByName(name).id && x.kind === kind);
    doc.expiry_date = date;
  };
  setDoc("ER-08", "inspection", "2026-10-12");
  setDoc("ER-02", "insurance", "2026-10-31");
  setDoc("ER-11", "inspection", "2026-11-08");
  setDoc("ER-14", "calibration", "2026-10-28");
  setDoc("EB-03", "insurance", "2026-11-10");
  // Visite technique de ER-12 non renseignée : avertissement V05 tant que les documents ne sont pas exigés.
  HS.docs = HS.docs.filter((x) => !(x.vehicle_id === hsVehicleByName("ER-12").id && x.kind === "inspection"));

  // Paramétrage : motifs du verrou et grilles de contrôle avant départ (§5, paramétrage initial).
  HS.reasons = Object.entries(HS_REASONS).map(([code, [label, source, resolution, kinds, waivable, lot]]) => ({ code, label, source, resolution, vehicle_kinds: kinds, waivable, lot, active: lot === 1, disabled_sites: [] }));
  const common = ["Éclairage et feux de détresse", "Rétroviseurs et pare-brise", "Trousse de premiers secours", "Cales et triangles", "EPI du conducteur"];
  const items = (start, blocking) => [...blocking, ...common.map((l) => [l, false])].map(([label, b, linked], i) => ({ id: start + i, label, blocking: b, sequence: (i + 1) * 10, linked_to: linked ?? null, active: true }));
  HS.templates = [
    { id: 1, name: "Contrôle avant départ, citerne", kind: "pre_departure", vehicle_kind: "tanker", version: 1, active: true, updated_at: "2026-09-29T10:00:00Z", updated_by: 16,
      items: items(1, [["Freins et ralentisseur, essai statique", true], ["Pneumatiques : usure, pression, coupures", true], ["Vannes de fond fermées et plombées", true], ["Dômes et trous d'homme fermés, joints en état", true], ["Deux extincteurs plombés et à date", true], ["Kit antidéversement complet", true], ["Plaques et étiquettes de danger en place", true], ["Alcootest du conducteur négatif", true, "breath_test"]]) },
    { id: 2, name: "Contrôle avant départ, benne", kind: "pre_departure", vehicle_kind: "tipper", version: 1, active: true, updated_at: "2026-09-29T10:00:00Z", updated_by: 16,
      items: items(21, [["Freins et ralentisseur, essai statique", true], ["Pneumatiques : usure, pression, coupures", true], ["Benne abaissée et verrouillée, vérin sans fuite", true], ["Bâche en place et arrimée", true], ["Extincteur plombé et à date", true], ["Gyrophare, avertisseur de recul, fanion (accès site minier)", true], ["Ticket de pesée conforme à la charge utile", true], ["Alcootest du conducteur négatif", true, "breath_test"]]) },
  ];

  // Contrôles et alcootests des départs depuis le 1er octobre, puis ceux du jour (cas du verrou).
  const rc = makeRng("hsseq-controles");
  const template = (v) => HS.templates.find((t) => t.vehicle_kind === hsKind(v));
  const performer = (v) => (v.id === 1 ? 17 : hsVehicleSite(v) === 2 ? 18 : 12);
  const device = (v) => (hsVehicleSite(v) === 2 ? "Dräger Alcotest 6820, n° ARHK-0587" : "Dräger Alcotest 6820, n° ARHK-0412");
  const addTest = (rot, v, at, result, reading, extra = {}) => {
    HS.tests.push({ id: ++HS.seq.test, rotation_id: rot.id, driver_id: rot.driver_id, performed: result !== null, result, reading_mg_l: reading, device: result !== null ? device(v) : null, not_done_reason: null, performed_by: performer(v), driver_removed: result === "positive", client_uuid: rc.uuid(), reported_at: at, synced_at: at, offline: false, active: true, ...extra });
  };
  const addCheck = (rot, v, at, notOk = [], offline = false) => {
    const t = template(v);
    const synced = offline ? hsAddMinutes(at, rc.int(55, 150)) : hsAddMinutes(at, rc.int(0, 2));
    const c = hsCreateCheck({
      template: t, vehicle_id: v.id, rotation_id: rot.id, driver_id: rot.driver_id, performed_by: performer(v), reported_at: at, synced_at: synced, offline,
      client_uuid: rc.uuid(), duration_s: rc.int(150, 255), ...(hsVehicleSite(v) === 2 ? { latitude: 10.1781, longitude: -14.0402, gps_accuracy: 9 } : { latitude: 9.5807, longitude: -13.6197, gps_accuracy: 6 }),
      answers: t.items.map((it) => ({ item_id: it.id, answer: notOk.includes(it.label) ? "not_ok" : "ok", comment: notOk.includes(it.label) ? "Défaut constaté au contrôle." : null })),
    });
    for (const n of HS.ncs.filter((x) => x.check_id === c.id)) hsPhoto("nonconformity", n.id, c.performed_by, hsAddMinutes(at, 1), `Constat : ${n.label}`);
    // Signature du conducteur (image PNG), pour les contrôles du jour.
    if (at.slice(0, 10) === TODAY) hsAttach("check", c.id, c.performed_by, `signature-${c.reference.replaceAll("/", "-")}.png`, "image/png", HS_PNG, { created_at: at, role: "signature" });
    return c;
  };
  let pastBlocking = null;
  for (let d = "2026-10-01"; d < TODAY; d = addDays(d, 1)) {
    for (const rot of hsDepartureRotations(d)) {
      const v = hsVehicle(rot.vehicle_id);
      if (rc.chance(0.025)) continue;
      const t = template(v);
      const at = hsVehicleSite(v) === 2 ? stamp(d, 5, rc.int(15, 55)) : stamp(d, rc.int(5, 6), rc.int(0, 59));
      const notOk = [];
      if (rc.chance(0.1)) notOk.push(rc.pick(t.items.filter((it) => !it.blocking)).label);
      if (rc.chance(0.03)) notOk.push(rc.pick(t.items.filter((it) => it.blocking && !it.linked_to)).label);
      const c = addCheck(rot, v, at, notOk, hsVehicleSite(v) === 2 ? rc.chance(0.6) : rc.chance(0.1));
      for (const n of HS.ncs.filter((x) => x.check_id === c.id)) {
        if (!n.blocking && rc.chance(0.3)) continue;
        const liftAt = hsAddMinutes(at, rc.int(40, 120));
        const photo = hsPhoto("nonconformity", n.id, c.performed_by, liftAt, "Après correction");
        photo.role = "lift";
        Object.assign(n, { status: "lifted", lifted_at: liftAt, lifted_by: c.performed_by, lift_comment: n.blocking ? "Pièce remplacée au parc avant le départ." : "Corrigé au parc." });
        if (n.blocking && !pastBlocking) pastBlocking = { n, c, v };
      }
      if (!rc.chance(0.01)) addTest(rot, v, hsAddMinutes(at, -4), d === "2026-10-07" && !HS.tests.some((x) => x.result === "positive") && hsKind(v) === "tanker" && rot.driver_id !== 1 ? "positive" : "negative", 0);
      else HS.tests.push({ id: ++HS.seq.test, rotation_id: rot.id, driver_id: rot.driver_id, performed: false, result: null, reading_mg_l: null, device: null, not_done_reason: "Appareil en panne, test refait au départ suivant", performed_by: performer(v), driver_removed: false, client_uuid: rc.uuid(), reported_at: hsAddMinutes(at, -4), synced_at: hsAddMinutes(at, -4), offline: false, active: true });
    }
  }
  const positive = HS.tests.find((x) => x.result === "positive");
  if (positive) positive.reading_mg_l = 0.18;
  for (const rot of hsDepartureRotations(TODAY)) {
    const v = hsVehicle(rot.vehicle_id);
    const plan = { "ER-06": ["Plaques et étiquettes de danger en place"], "ER-09": null, "EB-03": ["Éclairage et feux de détresse"] };
    const notOk = v.name in plan ? plan[v.name] : [];
    if (notOk === null) continue;
    const at = hsVehicleSite(v) === 2 ? stamp(TODAY, 5, 30 + v.id % 20) : stamp(TODAY, 6, 5 + (v.id % 4) * 5);
    const c = addCheck(rot, v, at, notOk, v.name === "EB-03");
    if (v.name === "EB-03") Object.assign(c, { reported_at: stamp(TODAY, 5, 48), synced_at: stamp(TODAY, 7, 12) });
    addTest(rot, v, hsAddMinutes(at, -3), "negative", 0);
    if (v.name === "EB-02") {
      // Positif du jour : le conducteur est retiré de la rotation, Transport doit en affecter un autre.
      const t = HS.tests[HS.tests.length - 1];
      Object.assign(t, { result: "positive", reading_mg_l: 0.32, reported_at: stamp(TODAY, 5, 41), synced_at: stamp(TODAY, 5, 43) });
      hsRemoveDriver(t, rot);
    }
  }
  // Photo de la non-conformité ouverte de EB-03 pas encore reçue (photos_missing).
  const ebNc = HS.ncs.find((n) => n.status === "open" && hsVehicle(n.vehicle_id).name === "EB-03");
  if (ebNc) HS.attachments = HS.attachments.filter((a) => !(a.model === "nonconformity" && a.object_id === ebNc.id));

  // Événements (§7) : une vingtaine, de tous niveaux et de tous statuts.
  const drv = (id, role, days = null) => ({ line_id: ++HS.seq.person, kind: "driver", id, name: hsDriver(id).name, role, days_off: days ?? 0 });
  const defs = [
    { type: "near_miss", at: "2026-01-28T06:10", veh: "ER-11", title: "Vanne de fond mal plombée découverte au contrôle de départ", desc: "Au contrôle de départ, la vanne de fond n° 2 de la citerne ER-11 n'était pas plombée et présentait du jeu. Fermeture et plombage refaits avant le départ ; aucun écoulement.", loc: "Parc de Matoto", sev: [1, 4, 2], status: "closed", closed: "2026-05-25T15:00",
      inv: { whys: ["La vanne n'était pas plombée.", "Le plomb n'a pas été reposé après le dépotage de la veille.", "Le dépotage s'est terminé de nuit, sans le chef de quai.", "La fiche de dépotage ne prévoit pas de vérification des plombs.", "Le mode opératoire de dépotage n'a pas été revu depuis 2019."], root: "Mode opératoire de dépotage sans étape de vérification des plombs.", team: [16, 12] },
      actions: [{ desc: "Ajouter la vérification et le relevé des plombs à la fiche de dépotage", lvl: "administrative", owner: 11, due: "2026-02-28", done: "2026-02-20", verified: ["2026-05-22", true], status: "closed" }] },
    { type: "road_accident", at: "2026-02-20T15:40", veh: "ER-10", title: "Collision arrière à faible vitesse au péage de Kagbélén", desc: "En file d'attente au péage de Kagbélén, la citerne ER-10 a heurté à faible vitesse l'arrière d'un pick-up. Dégâts matériels légers, aucun blessé.", loc: "Péage de Kagbélén, RN1", sev: [2, 2, 2], status: "closed", closed: "2026-03-12T10:00", people: [[10, "driver"]],
      costs: [["repair", "Pare-chocs et feu arrière du véhicule tiers", 6_400_000, "2026-03-02"]], inv: { root: "Distance de sécurité insuffisante en file d'attente." },
      actions: [{ desc: "Causerie sécurité sur les distances en file d'attente aux péages", lvl: "administrative", owner: 12, due: "2026-03-15", done: "2026-03-10", status: "closed" }] },
    { type: "work_accident", at: "2026-03-14T09:20", veh: "ER-05", title: "Coupure à la main lors du changement d'un joint de dôme", desc: "En remplaçant le joint du dôme n° 3, le conducteur s'est coupé la paume sur l'arête du collet. Soins sur place, reprise immédiate.", loc: "Atelier du parc de Matoto", sev: [2, 2, 3], status: "closed", closed: "2026-04-06T09:00", people: [[5, "victim", 0]],
      inv: { root: "Gants de manutention non adaptés aux arêtes vives." },
      actions: [{ desc: "Doter l'atelier de gants anti-coupure de niveau 5", lvl: "ppe", owner: 19, due: "2026-04-15", done: "2026-04-02", status: "closed" }] },
    { type: "road_accident", at: "2026-05-17T14:35", veh: "ER-03", title: "Renversement de la citerne dans le virage de Tanènè", desc: "Sur la route de Boké, la citerne ER-03 chargée de 33 000 L de gasoil s'est couchée dans le virage de Tanènè après un freinage sur chaussée dégradée. Conducteur blessé à l'épaule, évacué au centre de santé de Boké. Environ 6 000 L répandus sur l'accotement, confinés avec la gendarmerie.", loc: "RN3, virage de Tanènè (préfecture de Boké)", pos: [10.6213, -14.2087, 15], sev: [5, 5, 3], status: "actions", people: [[3, "victim", 21]], lost: 21, immobilized: true, photos: 3, notified: "2026-05-18T08:30",
      costs: [["claim", "Remorquage et remise en état de l'ensemble ER-03", 410_000_000, "2026-06-30"], ["deductible", "Franchise de l'assureur", 50_000_000, "2026-07-15"], ["product_loss", "6 000 L de gasoil perdus", 72_000_000, "2026-05-17"], ["downtime", "Immobilisation de l'ensemble ER-03", 38_000_000, "2026-09-30"]],
      inv: { team: [16, 11, 19], causes: ["Freinage appuyé dans le virage", "Vitesse de 62 km/h à l'entrée du virage"], tree: [["Renversement de la citerne ER-03", null, "unusual_fact"], ["Freinage appuyé dans le virage", 1, "unusual_fact"], ["Vitesse de 62 km/h à l'entrée du virage, limite conseillée à 40", 2, "unusual_fact"], ["Nid-de-poule non signalé à l'entrée du virage", 2, "permanent_fact"], ["Citerne pleine, centre de gravité haut", 1, "permanent_fact"], ["Retard de 3 h au chargement, horaire de livraison maintenu", 3, "unusual_fact"], ["Aucun limiteur de vitesse sur l'ensemble", 3, "permanent_fact"]],
        f5m: { environment: ["Chaussée dégradée, virage non signalé"], equipment: ["Pas de limiteur de vitesse"], method: ["Horaire de livraison maintenu malgré le retard au chargement"], manpower: ["Vitesse inadaptée au virage"], material: ["Citerne pleine, effet de vague"] },
        root: "Vitesse inadaptée dans un virage dégradé, sans limiteur ni consigne de ralentissement sur la ligne de Boké.", conclusion: "Trois actions : limiteur de vitesse, formation à la conduite défensive, signalisation du virage." },
      actions: [
        { desc: "Installer un limiteur de vitesse réglé à 60 km/h sur les citernes de la ligne de Boké", lvl: "engineering", owner: 19, due: "2026-07-31", done: "2026-07-20", status: "to_verify", cost: 96_000_000, approved: "2026-06-02" },
        { desc: "Former les seize conducteurs citerne à la conduite défensive sur route dégradée", lvl: "administrative", owner: 11, due: "2026-09-30", done: "2026-07-10", status: "to_verify" },
        { desc: "Obtenir de la préfecture la signalisation du virage de Tanènè", lvl: "administrative", owner: 16, due: "2026-08-31", status: "in_progress" },
      ] },
    { type: "spill", at: "2026-05-26T08:00", veh: "ER-07", title: "Fuite d'huile moteur sur l'aire de lavage", desc: "Une vingtaine de litres d'huile moteur ont rejoint le caniveau de l'aire de lavage du parc de Matoto, le séparateur d'hydrocarbures étant saturé.", loc: "Aire de lavage du parc de Matoto", sev: [2, 2, 3], status: "closed", closed: "2026-06-22T11:00",
      costs: [["other", "Absorbants et enlèvement des déchets souillés", 1_200_000, "2026-05-27"]], inv: { root: "Séparateur d'hydrocarbures non vidangé depuis 2024." },
      actions: [{ desc: "Faire vidanger le séparateur tous les trois mois (contrat de maintenance)", lvl: "administrative", owner: 19, due: "2026-06-30", done: "2026-06-18", status: "closed" }] },
    { type: "security_breach", at: "2026-06-03T02:15", veh: "ER-08", title: "Tentative de siphonnage de nuit sur l'aire de stationnement de Mamou", desc: "Vers 2 h, deux individus ont tenté de siphonner le réservoir de la citerne ER-08 stationnée sur l'aire non gardée de l'entrée de Mamou. Le conducteur, réveillé, a donné l'alerte ; environ 200 L perdus.", loc: "Aire de stationnement de l'entrée de Mamou", sev: [2, 3, 4], status: "actions", people: [[8, "driver"]],
      costs: [["product_loss", "200 L de gasoil", 2_400_000, "2026-06-03"]], inv: { whys: ["Le réservoir était accessible de nuit.", "L'ensemble stationnait sur une aire non gardée.", "Aucune aire gardée n'est imposée sur la ligne de Labé."], root: "Aucune liste d'aires de stationnement gardées sur les lignes de l'intérieur." },
      actions: [
        { desc: "Imposer le stationnement de nuit sur les aires gardées de la liste validée", lvl: "administrative", owner: 11, due: "2026-06-30", done: "2026-06-25", verified: ["2026-09-25", true], status: "closed" },
        { desc: "Poser des bouchons antisiphon sur les réservoirs des seize citernes", lvl: "engineering", owner: 19, due: "2026-07-15", done: "2026-07-05", verified: ["2026-10-05", false, "Deux tentatives réussies en septembre : les bouchons livrés ne tiennent pas sur les réservoirs MAN."], status: "in_progress", newDue: "2026-11-15" },
      ] },
    { type: "work_accident", at: "2026-07-09T05:50", veh: "ER-12", title: "Chute depuis la passerelle de la citerne à l'ouverture du dôme", desc: "En ouvrant le dôme n° 1 au dépôt de Conakry, le conducteur a glissé sur la passerelle mouillée et chuté d'environ 2,5 m. Fracture du poignet.", loc: "Dépôt de Conakry, poste de chargement n° 4", sev: [4, 4, 3], status: "actions", people: [[12, "victim", 38]], lost: 38, photos: 1,
      inv: { team: [16, 12], whys: ["Le conducteur a glissé sur la passerelle.", "La passerelle était mouillée et sans garde-corps.", "Les citernes n'ont jamais été équipées de garde-corps.", "Le travail en hauteur n'est pas évalué au poste de chargement."], root: "Passerelles sans garde-corps et accès en hauteur sans harnais." },
      actions: [
        { desc: "Équiper les passerelles des citernes de garde-corps rabattables", lvl: "engineering", owner: 19, due: "2026-10-31", status: "in_progress", cost: 64_000_000, approved: "2026-08-05" },
        { desc: "Interdire l'accès aux passerelles sans harnais au dépôt de Conakry", lvl: "administrative", owner: 12, due: "2026-07-31", done: "2026-07-30", status: "to_verify" },
        { desc: "Remplacer les chaussures de sécurité par un modèle à semelle antidérapante", lvl: "ppe", owner: 12, due: "2026-09-15", status: "todo" },
      ] },
    { type: "hazard", at: "2026-08-05T10:00", veh: "ER-02", title: "Rétroviseur droit desserré", desc: "Rétroviseur droit de ER-02 desserré, resserré au parc avant le départ.", loc: "Parc de Matoto", sev: [1, 1, 2], status: "closed", closed: "2026-08-06T10:00" },
    { type: "spill", at: "2026-08-22T07:15", veh: "ER-10", title: "Débordement au chargement : 300 L d'essence sur la dalle", desc: "Au dépôt de Conakry, la citerne ER-10 a débordé par le dôme n° 2 en fin de chargement. Environ 300 L d'essence répandus sur la dalle, absorbés avec le kit antidéversement.", loc: "Dépôt de Conakry, poste de chargement n° 2", sev: [2, 3, 3], status: "actions",
      costs: [["product_loss", "300 L d'essence", 3_750_000, "2026-08-22"]], inv: { whys: ["La citerne a débordé.", "La jauge indiquait un niveau inférieur au niveau réel.", "Les jauges n'ont jamais été étalonnées depuis leur pose."], root: "Jauges de niveau non étalonnées depuis la mise en service.", f5m: { equipment: ["Jauge de niveau faussée"], method: ["Chargement arrêté à la jauge, sans contrôle visuel"] } },
      actions: [{ desc: "Étalonner les jauges de niveau des seize citernes", lvl: "engineering", owner: 19, due: "2026-09-30", done: "2026-09-10", status: "to_verify" }] },
    { type: "road_accident", at: "2026-09-12T11:30", veh: "ER-05", title: "Rétroviseur arraché en croisement à Coyah", desc: "Au croisement d'un camion-benne dans la traversée de Coyah, le rétroviseur gauche de ER-05 a été arraché.", loc: "Traversée de Coyah, RN1", sev: [2, 2, 2], status: "closed", closed: "2026-09-25T09:00",
      costs: [["repair", "Rétroviseur et support", 2_900_000, "2026-09-14"]], inv: { root: "Chaussée rétrécie par des étals en bord de route." },
      actions: [{ desc: "Signaler le rétrécissement à la mairie de Coyah et rappeler la vitesse en traversée", lvl: "administrative", owner: 11, due: "2026-09-30", done: "2026-09-22", status: "closed" }] },
    { type: "fire", at: "2026-09-18T16:20", veh: "ER-06", title: "Départ de feu au frein de la remorque dans la descente de Mamou", desc: "Échauffement des freins de la remorque dans la descente de Kouroula ; flammes à la roue arrière gauche, éteintes par le conducteur avec l'extincteur de 9 kg. Citerne pleine de gasoil, pas de propagation.", loc: "Descente de Kouroula, RN1 (Mamou)", sev: [3, 5, 2], status: "actions", people: [[6, "driver"]], photos: 2,
      costs: [["repair", "Garnitures, tambour et pneumatiques de la remorque", 18_500_000, "2026-09-24"]], inv: { whys: ["Les garnitures ont surchauffé.", "Le ralentisseur de la remorque ne fonctionnait pas.", "La panne n'a pas été relevée au contrôle de départ."], root: "Ralentisseur de la remorque hors service, non signalé au contrôle." },
      actions: [
        { desc: "Contrôler ralentisseurs et garnitures des remorques avant les lignes de Mamou et de Labé", lvl: "engineering", owner: 19, due: "2026-10-10", status: "in_progress" },
        { desc: "Remplacer l'extincteur utilisé et revoir la dotation à deux extincteurs de 9 kg", lvl: "administrative", owner: 12, due: "2026-09-25", done: "2026-09-19", status: "to_verify" },
      ] },
    { type: "hazard", at: "2026-09-24T21:40", veh: "ER-07", title: "Citerne immobilisée de nuit sur la chaussée sans balisage", desc: "Panne de boîte de vitesses à Kouroussa : l'ensemble ER-07 est resté deux heures sur la chaussée, de nuit, sans triangles ni feux de détresse, la batterie étant déchargée.", loc: "RN1, sortie de Kouroussa", sev: [2, 4, 3], status: "investigation",
      inv: { whys: ["Les triangles n'ont pas été posés.", "Ils n'étaient pas à bord de l'ensemble."] } },
    { type: "property_damage", at: "2026-09-30T13:05", veh: "EB-01", title: "Perte de chargement sur la piste de la fosse 3", desc: "Une partie du chargement de bauxite a glissé de la benne EB-01 dans le virage de la piste de la fosse 3. Ticket de pesée : 34 t pour 30 t de charge utile.", loc: "Piste de la fosse 3, mine de Boffa", sev: [2, 4, 3], status: "actions", by: 18, people: [[17, "driver"]],
      inv: { team: [16, 18], whys: ["La benne était surchargée.", "Le chargeur a rempli au godet sans contrôle de masse.", "Le pont-bascule ne bloque pas un départ en surcharge."], root: "Aucun blocage du départ au-delà de la charge utile au pont-bascule." },
      actions: [
        { desc: "Bloquer au pont-bascule le départ des bennes au-delà de 30 t", lvl: "engineering", owner: 18, due: "2026-10-20", status: "in_progress" },
        { desc: "Rappeler la charge utile aux chefs de poste du chargeur", lvl: "administrative", owner: 18, due: "2026-10-05", done: "2026-10-03", status: "to_verify" },
      ] },
    { type: "product_quality", at: "2026-10-02T10:30", veh: "ER-14", title: "Manquant de 410 L à la livraison de Kamsar", desc: "À la livraison chez Bauxite Atlantique Kamsar (démo), le jaugeage du client fait apparaître 410 L de moins que le bon de chargement ; plombs intacts.", loc: "Kamsar, dépôt du client", sev: [2, 2, 3], status: "investigation",
      inv: { causes: ["Écart entre la jauge du dépôt de Conakry et celle du client"] } },
    { type: "near_miss", at: "2026-10-05T07:20", veh: "EB-04", title: "Recul sans avertisseur sonore sur la plateforme de chargement", desc: "Un agent de pointage s'est trouvé à 2 m de la benne EB-04 en marche arrière ; l'avertisseur de recul ne fonctionnait pas.", loc: "Plateforme de chargement, fosse 3", sev: [1, 5, 2], status: "classified", by: 18 },
    { type: "near_miss", at: "2026-10-08T15:45", veh: "EB-03", title: "Benne levée à moins d'un mètre d'une ligne électrique au port de Dapilon", desc: "Au point de déversement n° 2 du port de Dapilon, la benne levée de EB-03 est passée à moins d'un mètre d'une ligne électrique basse ; pas de contact. Point de déversement n° 2 fermé sur-le-champ.", loc: "Port de Dapilon, point de déversement n° 2", pos: [10.2952, -14.4218, 8], sev: [1, 5, 3], status: "investigation", by: 18, photos: 2, classified: "2026-10-08T18:00", notified: "2026-10-09T09:30",
      inv: { team: [16, 18], tree: [["Benne levée à moins d'un mètre de la ligne", null, "unusual_fact"], ["Benne levée avant l'arrêt complet au point n° 2", 1, "unusual_fact"], ["Ligne électrique basse au-dessus du point n° 2", 1, "permanent_fact"]] } },
    { type: "work_accident", domain: "health", at: "2026-10-10T13:00", veh: "ER-16", title: "Malaise du conducteur à l'arrêt de Kouroussa (coup de chaleur)", desc: "Pendant la pause de Kouroussa, le conducteur a fait un malaise attribué à la chaleur ; repos de deux heures, reprise de la route accompagné.", loc: "Kouroussa, aire de repos", sev: [3, 3, 2], status: "investigation", people: [[16, "victim", 0]] },
    { type: "hazard", at: "2026-10-12T09:00", veh: "ER-13", title: "Extincteur périmé relevé lors d'un contrôle routier", desc: "Au contrôle de gendarmerie de Kindia, l'un des deux extincteurs de ER-13 était périmé depuis août.", loc: "Poste de contrôle de Kindia", sev: [1, 2, 2], status: "classified" },
    { type: "near_miss", at: "2026-10-13T16:50", veh: "ER-02", title: "Dérapage sur chaussée glissante après l'averse à Kindia", desc: "Dérapage de la remorque dans la descente de Kindia, juste après une averse ; le conducteur a repris le contrôle sans sortie de route.", loc: "Descente de Kindia, RN1", status: "reported", people: [[2, "driver"]] },
    { type: "hazard", at: "2026-10-14T08:30", veh: "ER-15", title: "Trousse de premiers secours incomplète", desc: "Au contrôle de départ de ER-15, la trousse de premiers secours ne contenait plus de pansements compressifs.", loc: "Parc de Matoto", sev: [1, 1, 3], status: "classified", classified: "2026-10-14T11:00" },
    { type: "near_miss", at: "2026-10-14T17:05", veh: "ER-01", title: "Freinage d'urgence à Kagbélén : moto coupant la route", desc: "Une moto a coupé la route à la sortie de Kagbélén ; freinage d'urgence de la citerne pleine, sans contact ni blessé.", loc: "Sortie de Kagbélén, RN1", pos: [9.6551, -13.4972, 11], status: "reported", by: 17, terrain: ["2026-10-14T17:20:00Z", "2026-10-14T19:05:00Z"], photos: 1, people: [[1, "driver"]] },
    { type: "hazard", at: "2026-10-15T06:30", site: 2, title: "Piste d'accès à la fosse 3 ravinée par les pluies", desc: "Ornières de 40 cm sur la piste d'accès à la fosse 3 après les pluies de la nuit ; deux bennes ont touché le fond.", loc: "Piste d'accès à la fosse 3, mine de Boffa", pos: [10.1866, -14.0311, 7], status: "reported", by: 18, terrain: ["2026-10-15T06:42:00Z", "2026-10-15T07:58:00Z"], photos: 1 },
  ];
  defs.sort((a, b) => a.at.localeCompare(b.at));
  const order = ["reported", "classified", "investigation", "actions", "closed"];
  for (const d of defs) {
    const v = d.veh ? hsVehicleByName(d.veh) : null;
    const rot = v ? hsRotationAt(v.id, d.at.slice(0, 10)) : null;
    const occurred = `${d.at}:00Z`;
    const by = d.by ?? 12;
    const e = {
      id: ++HS.seq.event, reference: `EVT/2026/${pad(HS.seq.event, 4)}`, title: d.title, type: d.type, domain: d.domain ?? HS_TYPES[d.type], status: "reported", occurred_at: occurred,
      site_id: d.site ?? (v ? hsVehicleSite(v) : 1), vehicle_id: v?.id ?? null, rotation_id: rot?.id ?? null, actual_severity: null, potential_severity: null, probability: null,
      reported_by: by, description: d.desc, location: d.loc ?? null, latitude: d.pos?.[0] ?? null, longitude: d.pos?.[1] ?? null, gps_accuracy: d.pos?.[2] ?? null, source: d.terrain ? "terrain" : "web", client_uuid: d.terrain ? r.uuid() : null,
      reported_at: d.terrain ? d.terrain[0] : hsAddMinutes(occurred, 50), synced_at: d.terrain ? d.terrain[1] : hsAddMinutes(occurred, 50), offline: Boolean(d.terrain),
      people: (d.people ?? []).map(([id, role, days]) => drv(id, role, days ?? null)), lost_time: (d.lost ?? 0) > 0, days_lost: d.lost ?? 0, vehicle_immobilized: Boolean(d.immobilized),
      classified_at: null, classified_by: null, closed_at: null, closed_by: null, reopen_reason: null, leave_id: null, investigation: null,
      costs: (d.costs ?? []).map(([kind, label, amount, date]) => ({ id: ++HS.seq.cost, kind, label, amount, date, finance_move_id: null })),
      deadlines: { investigation_due: null, client_notice_due: null, client_notified_at: null },
    };
    HS.events.push(e);
    hsLog("event", e.id, by, "create", null, null, null, e.reported_at);
    hsNotify(hsHsseqManagers(), "reported", `Événement déclaré : ${e.reference} ${e.title}`, e.description, "event", e.id, e.synced_at);
    for (let i = 0; i < (d.photos ?? 0); i++) hsPhoto("event", e.id, by, e.synced_at, i === 0 ? "Vue d'ensemble" : `Détail ${i}`);
    const step = order.indexOf(d.status);
    if (step >= 1) {
      const level = hsLevel(d.sev[1] * d.sev[2]);
      const classifiedAt = d.classified ? `${d.classified}:00Z` : level === "high" ? hsAddMinutes(occurred, 180) : stamp(addDays(d.at.slice(0, 10), 1), 9, 0);
      hsClassify(e, 16, classifiedAt, { actual_severity: d.sev[0], potential_severity: d.sev[1], probability: d.sev[2] });
      if (d.notified) e.deadlines.client_notified_at = `${d.notified}:00Z`;
    }
    if (step >= 2 && !(step === 4 && !d.inv)) {
      const level = hsLevel(hsCriticality(e));
      const inv = d.inv ?? {};
      e.investigation = {
        method: hsLevelMethod(level), team_ids: inv.team ?? [16, e.site_id === 2 ? 18 : 12], opened_at: e.classified_at,
        due_date: (e.deadlines.investigation_due ?? addDays(e.classified_at.slice(0, 10), 15)).slice(0, 10), concluded_at: null, immediate_causes: inv.causes ?? [], whys: inv.whys ?? [],
        tree: (inv.tree ?? []).map(([label, parent, kind], i) => ({ id: String(i + 1), label, parent_id: parent === null ? null : String(parent), kind })), factors_5m: { ...Object.fromEntries(HS_FACTORS.map((k) => [k, []])), ...(inv.f5m ?? {}) },
        root_cause: step >= 3 ? inv.root ?? null : null, conclusion: step >= 3 ? inv.conclusion ?? null : null,
      };
      e.status = "investigation";
      hsLog("event", e.id, 16, "Ouverture de l'enquête", "status", "classified", "investigation", e.classified_at);
      if (step >= 3) {
        e.investigation.concluded_at = stamp(minDate(addDays(e.investigation.due_date, -1), TODAY), 16, 0);
        e.status = "actions";
        hsLog("event", e.id, 16, "Passage aux actions", "status", "investigation", "actions", e.investigation.concluded_at);
      }
    }
    for (const x of d.actions ?? []) {
      const a = hsNewAction({ description: x.desc, origin: "event", origin_id: e.id, control_level: x.lvl, owner_id: x.owner, due_date: x.due, status: x.status, estimated_cost: x.cost ?? null, created_at: e.investigation?.concluded_at ?? e.classified_at, site_id: e.site_id });
      hsLog("action", a.id, 16, "Création", null, null, null, a.created_at);
      if (x.approved) Object.assign(a, { approved_at: stamp(x.approved, 10), approved_by: 8, approved_cost: a.estimated_cost });
      if (x.status !== "todo") a.started_at = a.created_at;
      if (x.done) {
        a.done_at = x.done;
        hsAttach("action", a.id, a.owner_id, `preuve-${a.reference.replaceAll("/", "-")}.pdf`, "application/pdf", pdfBuffer(`Preuve de réalisation ${a.reference}`, [a.description, `Réalisée le ${frDate(x.done)}`, "", "Fichier de maquette : données fictives."]), { created_at: stamp(x.done, 16) });
        if ((hsCriticality(e) ?? 0) >= 8) a.verification_date = addDays(x.done, 90);
        hsLog("action", a.id, a.owner_id, "Clôture avec preuve", "status", "in_progress", a.verification_date ? "to_verify" : "closed", stamp(x.done, 16));
      }
      if (x.verified) {
        Object.assign(a, { verified_at: stamp(x.verified[0], 11), verified_by: 16, effective: x.verified[1], verification_comment: x.verified[2] ?? "Aucune récidive constatée depuis la réalisation." });
        hsLog("action", a.id, 16, "Vérification d'efficacité", "effective", null, x.verified[1] ? "oui" : "non", a.verified_at);
      }
      if (x.status === "closed") a.closed_at = a.verified_at ?? stamp(x.done, 17);
      if (x.newDue) Object.assign(a, { due_date: x.newDue, done_at: null, verification_date: null });
    }
    if (d.status === "closed") {
      e.status = "closed";
      e.closed_at = `${d.closed}:00Z`;
      e.closed_by = 16;
      hsLog("event", e.id, 16, "Clôture", "status", step >= 3 ? "actions" : "classified", "closed", e.closed_at);
    }
  }
  // Actions issues de contrôles : non-conformité bloquante du jour (ER-06) et défaut d'une benne.
  const er06 = HS.ncs.find((n) => n.status === "open" && n.blocking);
  if (er06) {
    const a = hsNewAction({ description: "Poser une étiquette de danger n° 33/1203 neuve sur ER-06", origin: "check", origin_id: er06.check_id, control_level: "administrative", owner_id: 12, due_date: TODAY, status: "in_progress", created_at: hsAddMinutes(er06.found_at, 20), created_by: 12, site_id: 1 });
    er06.action_id = a.id;
  }
  if (ebNc) {
    const a = hsNewAction({ description: "Réparer l'éclairage de gabarit de EB-03", origin: "check", origin_id: ebNc.check_id, control_level: "engineering", owner_id: 19, due_date: "2026-10-20", status: "todo", created_at: stamp(TODAY, 7, 30), created_by: 18, site_id: 2 });
    ebNc.action_id = a.id;
  }
  if (pastBlocking) {
    const { n, c, v } = pastBlocking;
    const day = c.reported_at.slice(0, 10);
    const a = hsNewAction({ description: `Rechercher l'origine du défaut « ${n.label} » sur ${v.name}`, origin: "check", origin_id: c.id, control_level: "engineering", owner_id: 19, due_date: addDays(day, 7), status: "closed", created_at: stamp(day, 9), created_by: 16, site_id: c.site_id });
    Object.assign(a, { done_at: addDays(day, 3), closed_at: stamp(addDays(day, 3), 17) });
    hsAttach("action", a.id, 19, `preuve-${a.reference.replaceAll("/", "-")}.pdf`, "application/pdf", pdfBuffer(`Preuve de réalisation ${a.reference}`, [a.description, "", "Fichier de maquette : données fictives."]), { created_at: a.closed_at });
    n.action_id = a.id;
  }

  // Dérogations (§4.1) : historique de l'année et une demande du jour en attente du Responsable HSSEQ.
  const waiver = (vehicle, date, reason, justification, status, extra = {}) => {
    const v = hsVehicleByName(vehicle);
    const rot = hsRotationAt(v.id, date);
    const yard = hsVehicleSite(v) === 2 ? 18 : 12;
    const at = extra.at ?? stamp(date, 6, 40);
    const w = {
      id: ++HS.seq.waiver, reference: `DER/2026/${pad(HS.seq.waiver, 4)}`, rotation_id: rot.id, vehicle_id: v.id, site_id: hsVehicleSite(v), reason_code: reason, justification,
      requested_by: yard, requested_at: at, approvals: [{ level: 1, role: "yard_manager", by: yard, at }], status, expires: null, refusal_reason: null, management_notified_at: null,
    };
    if (["active", "expired"].includes(status)) {
      const approved = hsAddMinutes(at, 25);
      w.approvals.push({ level: 2, role: "hsseq_manager", by: 16, at: approved });
      Object.assign(w, { expires: hsRotationEnd(rot), management_notified_at: approved });
      if (status === "expired") w.expired_at = w.expires;
    }
    if (status === "refused") Object.assign(w, { refusal_reason: extra.refusal, decided_by: 16 });
    if (status === "cancelled") w.decided_by = yard;
    HS.waivers.push(w);
    hsLog("waiver", w.id, yard, "Demande et première validation", null, null, null, at);
    if (w.approvals[1]) hsLog("waiver", w.id, 16, "Seconde validation", "status", "pending_hsseq", "active", w.approvals[1].at);
    return w;
  };
  waiver("ER-05", "2026-02-11", "V05", "Assurance renouvelée le 10/02, attestation en cours d'édition chez l'assureur ; reçu de paiement à bord.", "expired");
  waiver("ER-09", "2026-04-03", "V02", "Joint du dôme n° 3 suintant ; compartiment n° 3 laissé vide pour ce chargement, joint changé au retour.", "expired");
  waiver("ER-13", "2026-06-19", "V04", "Permis renouvelé, titre provisoire du 18/06 à bord en attendant la carte.", "expired");
  waiver("ER-02", "2026-08-27", "V05", "Visite technique expirée le 26/08, rendez-vous au centre de contrôle le 29/08.", "refused", { refusal: "Pas de départ avec une visite technique expirée : passer d'abord au centre de contrôle." });
  waiver("EB-02", "2026-09-14", "V02", "Bâche déchirée sur un mètre ; trajet de 45 km sur piste privée de la mine, chargement humide.", "expired");
  const cancelled = waiver("ER-15", "2026-10-09", "V05", "Attestation d'assurance attendue dans la matinée.", "cancelled");
  hsLog("waiver", cancelled.id, 12, "Annulation", "status", "pending_hsseq", "cancelled", stamp("2026-10-09", 9, 5));
  waiver("EB-05", "2026-10-12", "V02", "Fanion arraché par une branche, fanion de remplacement posé au port de Dapilon.", "expired");
  const er06rot = hsDepartureRotations(TODAY).find((x) => hsVehicle(x.vehicle_id).name === "ER-06");
  if (er06rot) {
    const at = stamp(TODAY, 6, 40);
    const w = { id: ++HS.seq.waiver, reference: `DER/2026/${pad(HS.seq.waiver, 4)}`, rotation_id: er06rot.id, vehicle_id: er06rot.vehicle_id, site_id: 1, reason_code: "V02",
      justification: "Étiquette de danger n° 33/1203 arrachée côté droit ; plaques orange en place à l'avant et à l'arrière. Étiquette neuve disponible au dépôt de Kindia, pose prévue à l'arrêt de 10 h.",
      requested_by: 12, requested_at: at, approvals: [{ level: 1, role: "yard_manager", by: 12, at }], status: "pending_hsseq", expires: null, refusal_reason: null, management_notified_at: null };
    HS.waivers.push(w);
    hsLog("waiver", w.id, 12, "Demande et première validation", null, null, null, at);
    hsNotify(hsHsseqManagers(), "waiver_requested", `Dérogation à valider : V02, rotation ${er06rot.name ?? er06rot.id}`, w.justification, "waiver", w.id, at);
  }
}

/* ─── Routes ────────────────────────────────────────────────────────────── */

/** Comptes internes seulement (porteurs refusés), comme internal_only() du noyau. */
function hsInternal(ctx) {
  if (ctx.user.profiles.every((p) => p === "porteur")) throw hsForbidden("Accès réservé aux comptes internes.");
}
/** Horodatage ISO 8601 d'un corps ; 400 invalid_parameter sinon. */
function hsDateTime(data, key) {
  const v = data[key];
  if (v === undefined || v === null || v === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(v)) || !Number.isFinite(Date.parse(String(v)))) throw hsBad(`Horodatage invalide : ${key}.`, [key]);
  return `${new Date(Date.parse(String(v))).toISOString().slice(0, 19)}Z`;
}
/** Heure de saisie sur l'appareil : jamais dans le futur, au-delà de cinq minutes de décalage d'horloge. */
function hsReportedAt(data) {
  const v = hsDateTime(data, "reported_at") ?? hsNow();
  if (Date.parse(v) - Date.parse(hsNow()) > 300000) throw hsBad("Heure de saisie dans le futur.", ["reported_at"]);
  return v;
}
const hsText = (data, key, max = 2000) => (data[key] === undefined || data[key] === null || String(data[key]).trim() === "" ? null : String(data[key]).trim().slice(0, max));

/* Sites */
function hsSiteRow(s) {
  const vehicles = [...DB.vehicles.filter((v) => v.company_id === s.company_id), ...HS.tippers].filter((v) => hsVehicleSite(v) === s.id);
  return { id: s.id, name: s.name, code: s.code, company: companyRef(s.company_id), default_vehicle_kind: s.default_vehicle_kind, yard_managers: s.yard_manager_ids.map(hsUser), active: s.active, vehicle_ids: vehicles.map((v) => v.id) };
}
function hsSiteValues(s, data) {
  for (const key of ["name", "code"]) if (key in data) s[key] = hsText(data, key, 120) ?? "";
  if ("company_id" in data) {
    const id = hsId(data, "company_id");
    if (!COMPANY_IDS.includes(id)) throw hsForbidden("Société non autorisée.");
    s.company_id = id;
  }
  if ("default_vehicle_kind" in data) {
    if (!["tanker", "tipper"].includes(data.default_vehicle_kind)) throw hsBad("Type de véhicule inconnu.", ["default_vehicle_kind"]);
    s.default_vehicle_kind = data.default_vehicle_kind;
  }
  if ("active" in data) s.active = Boolean(data.active);
  if ("yard_manager_ids" in data) {
    const ids = hsIds(data, "yard_manager_ids");
    const faux = ids.map(userById).filter((u) => u && (!u.profiles.includes("exploitation") || !u.companies.includes(s.company_id)));
    if (faux.length) throw hsRule("business_rule", `Un chef de parc est un compte Exploitation transport de la société : ${faux.map((u) => u.name).join(", ")}.`, { fields: ["yard_manager_ids"] });
    s.yard_manager_ids = ids.filter((id) => userById(id));
  }
}
/** Rattachement des ensembles au site (vehicle_ids) : la liste remplace la précédente. */
function hsAssignVehicles(s, data) {
  if (!("vehicle_ids" in data)) return;
  const wanted = hsIds(data, "vehicle_ids").map(hsVehicle).filter(Boolean);
  if (wanted.some((v) => v.company_id !== s.company_id)) throw hsRule("business_rule", "Un ensemble d'une autre société ne se rattache pas à ce site.", { fields: ["vehicle_ids"] });
  for (const v of [...DB.vehicles, ...HS.tippers]) if (hsVehicleSite(v) === s.id && !wanted.includes(v)) HS.vehicleSites.set(v.id, null);
  for (const v of wanted) HS.vehicleSites.set(v.id, s.id);
}
route("GET", "/hsseq/sites", HS_APP, (ctx) => HS.sites.filter((s) => !ctx.query.company_id || s.company_id === Number(ctx.query.company_id)).map(hsSiteRow));
route("POST", "/hsseq/sites", HS_SETUP, (ctx) => {
  requireFields(ctx.body, "name", "code");
  const s = { id: ++HS.seq.site, name: "", code: "", company_id: ctx.company ?? 1, default_vehicle_kind: "tanker", yard_manager_ids: [], active: true };
  hsSiteValues(s, ctx.body);
  if (HS.sites.some((x) => x.code === s.code && x.company_id === s.company_id)) throw businessRule("Ce code de site existe déjà dans la société.");
  HS.sites.push(s);
  hsAssignVehicles(s, ctx.body);
  return hsSiteRow(s);
});
route("PATCH", "/hsseq/sites/:id", HS_SETUP, (ctx) => {
  const s = hsSite(ctx.params[0]);
  if (!s) throw notFound("Site introuvable.");
  hsSiteValues(s, ctx.body);
  hsAssignVehicles(s, ctx.body);
  return hsSiteRow(s);
});

/* Référentiels */
/**
 * Salariés en poste (RH) : chaque chauffeur actif, sous l'identifiant de son dossier salarié, et les
 * agents du parc ; site : celui de l'ensemble du chauffeur, quand il est connu.
 */
function hsEmployeeRows() {
  const chauffeurs = [...DB.drivers.filter((d) => d.company_id === 1 && d.active), ...HS.drivers].map((d) => {
    const site = HS.driverSites.get(d.id) ?? null;
    return { id: HS_EMPLOYEES.find((x) => x.driver_id === d.id)?.id ?? 500 + d.id, name: d.name, site_id: site };
  });
  return [...chauffeurs, ...HS_STAFF].map((e) => ({ id: e.id, name: e.name, company: companyRef(1), site_id: e.site_id, site: hsSiteRef(e.site_id) })).sort((a, b) => byFr(a.name, b.name));
}
/**
 * Clients des sociétés (tiers clients actifs) et tiers déjà cités par un audit, une exigence ou un modèle
 * de rapport (client_rows du noyau) : identifiant et nom, pour choisir le client ou donneur d'ordre sans
 * ouvrir /finance/partners.
 */
function hsClientRows() {
  const cites = [...(HS.audits ?? []), ...(HS.requirements ?? []), ...(HS.reportTemplates ?? [])].map((x) => x.partner_id).filter(Boolean);
  const ids = new Set([...PARTNERS.filter((p) => p.customer && p.active !== false).map((p) => p.id), ...cites]);
  return [...ids].map(partnerRef).filter(Boolean).sort((a, b) => byFr(a.name, b.name));
}

route("GET", "/hsseq/referentials", HS_APP, (ctx) => {
  const vehicles = [...DB.vehicles.filter((v) => v.company_id === 1 && v.state !== "off"), ...HS.tippers];
  const self = hsScope(ctx) === "self";
  const mine = hsMyDriver(ctx);
  // Auditeur : pas de liste nominative des conducteurs.
  const drivers = hsPersonalHidden(ctx) ? [] : [...DB.drivers.filter((d) => d.company_id === 1 && d.active), ...HS.drivers].filter((d) => !self || d.id === mine);
  // Responsables possibles d'une action : comptes internes hors conducteurs ; aucun pour le conducteur.
  const owners = self ? [] : USERS.filter((u) => u.active && u.companies.includes(1) && u.profiles.some((p) => !["conducteur", "porteur"].includes(p))).sort((a, b) => byFr(a.name, b.name));
  const s = hsSettings();
  return {
    sites: HS.sites.map(hsSiteRow),
    vehicles: vehicles.map((v) => ({ ...hsVehicleRef(v.id), site_id: hsVehicleSite(v), driver_id: v.driver_id ?? null, payload_tonnes: v.payload_tonnes ?? null, immobilized: Boolean(immobilisationEnCours(v.id)) })),
    drivers: drivers.map((d) => ({ id: d.id, name: d.name, site_id: HS.driverSites.get(d.id) ?? null })).sort((a, b) => byFr(a.name, b.name)),
    owners: owners.map((u) => ({ id: u.id, name: u.name })),
    // Profils qui déclarent ou gèrent les personnes en cause, hors conducteur (EVENT_PEOPLE du noyau).
    employees: hasProfile(ctx, ["admin", "direction", "hsseq", "exploitation"]) ? hsEmployeeRows() : [],
    // Clients : administration, direction et hsseq (CLIENTS du noyau) ; personne d'autre, auditeur compris.
    clients: hasProfile(ctx, ["admin", "direction", "hsseq"]) ? hsClientRows() : [],
    criticality_thresholds: hsThresholds(s),
    costly_action_threshold: s.costly_action_threshold,
    check_window_hours: s.check_window_hours,
    breath_test_window_hours: s.breath_test_window_hours,
    // Délai de revue d'un risque (prochaine revue proposée), comme /hsseq/settings.
    risk_review_months: s.risk_review_months ?? 12,
    vehicle_kinds: [{ code: "tanker", label: "Citerne" }, { code: "tipper", label: "Benne" }],
    me: { profiles: [...ctx.user.profiles].sort(), site_ids: hsSites(ctx), employee_id: hsEmployee(ctx)?.id ?? null, driver_id: mine },
  };
});

/* Auditeurs externes (lot 2) : date de fin d'accès et sites audités (admin, hsseq) */
function hsAuditorRow(u) {
  return {
    id: u.id, name: u.name, login: u.login, access_until: u.hsseq_audit_until ?? null, expired: Boolean(u.hsseq_audit_until) && u.hsseq_audit_until < TODAY,
    sites: (u.hsseq_audit_site_ids ?? []).map(hsSiteRef).filter(Boolean), companies: u.companies.map(companyRef),
  };
}
const hsAuditors = (ctx) => USERS.filter((u) => u.active && u.profiles.includes("auditeur") && u.companies.some((c) => ctx.user.companies.includes(c)));
route("GET", "/hsseq/auditors", HS_SETUP, (ctx) => hsAuditors(ctx).map(hsAuditorRow));
route("PATCH", "/hsseq/auditors/:id", HS_SETUP, (ctx) => {
  const u = hsAuditors(ctx).find((x) => x.id === ctx.params[0]);
  if (!u) throw notFound("Auditeur introuvable.");
  const b = ctx.body;
  if ("access_until" in b) u.hsseq_audit_until = dateArg(b, "access_until");
  if ("site_ids" in b) {
    if (!Array.isArray(b.site_ids)) throw hsBad("Sites invalides.", ["site_ids"]);
    const ids = b.site_ids.map(Number);
    if (ids.some((id) => !u.companies.includes(hsSite(id)?.company_id))) throw hsRule("business_rule", "Un site audité appartient à une société de l'auditeur.", { fields: ["site_ids"] });
    u.hsseq_audit_site_ids = ids;
  }
  hsLog("auditor", u.id, ctx.user.id, "write", "access_until", null, u.hsseq_audit_until ?? "", hsNow(), "Périmètre ou durée de l'auditeur");
  return hsAuditorRow(u);
});

/* Paramètres de la société (admin, hsseq) */
function hsSettingsCompany(ctx, src) {
  if (src.company_id === undefined || src.company_id === null || src.company_id === "") return ctx.company ?? 1;
  if (!/^\d+$/.test(String(src.company_id))) throw hsBad("Société invalide.");
  const id = Number(src.company_id);
  if (!ctx.user.companies.includes(id)) throw hsForbidden("Société non autorisée.");
  return id;
}
function hsSettingsRow(company) {
  const s = hsSettings(company);
  const row = Object.fromEntries([...HS_SETTINGS_DATES, ...HS_SETTINGS_NOMBRES, ...HS_SETTINGS_DECIMAUX].map((k) => [k, s[k] ?? null]));
  return { ...row, company: companyRef(company), director: hsUser(s.director_id), criticality_thresholds: hsThresholds(s), targets: { ...s.targets } };
}
route("GET", "/hsseq/settings", HS_SETUP, (ctx) => hsSettingsRow(hsSettingsCompany(ctx, ctx.query)));
route("PATCH", "/hsseq/settings", HS_SETUP, (ctx) => {
  const b = ctx.body;
  const company = hsSettingsCompany(ctx, b);
  const s = hsSettings(company);
  const values = {};
  for (const key of HS_SETTINGS_DATES) {
    if (!(key in b)) continue;
    if (b[key] !== null && b[key] !== "" && !isDate(String(b[key]).slice(0, 10))) throw hsBad(`Date invalide : ${key}.`, [key]);
    values[key] = b[key] ? String(b[key]).slice(0, 10) : null;
  }
  for (const key of HS_SETTINGS_NOMBRES) {
    if (!(key in b)) continue;
    const n = Number(b[key] || 0);
    if (!Number.isFinite(n)) throw hsBad(`Valeur invalide : ${key}.`, [key]);
    values[key] = key === "costly_action_threshold" ? n : Math.trunc(n);
  }
  for (const key of HS_SETTINGS_DECIMAUX) {
    if (!(key in b)) continue;
    const n = Number(b[key] || 0);
    if (!Number.isFinite(n)) throw hsBad(`Valeur invalide : ${key}.`, [key]);
    values[key] = n;
  }
  if ("director_id" in b) values.director_id = userById(hsId(b, "director_id"))?.id ?? null;
  if ("targets" in b) {
    if (!b.targets || typeof b.targets !== "object" || Array.isArray(b.targets)) throw hsBad("Cibles attendues par code d'indicateur.", ["targets"]);
    const t = {};
    for (const [k, v] of Object.entries(b.targets)) {
      if (v === null || v === "") continue;
      if (!Number.isFinite(Number(v))) throw hsBad("Cible invalide.", ["targets"]);
      t[k] = Number(v);
    }
    values.targets = t;
  }
  const next = { ...s, ...values };
  if (!(1 < next.level_moderate_min && next.level_moderate_min < next.level_significant_min && next.level_significant_min < next.level_high_min && next.level_high_min <= 25)) {
    throw businessRule("Seuils de criticité attendus croissants, entre 2 et 25.");
  }
  if (!(next.night_start_hour >= 0 && next.night_start_hour < 24 && next.night_end_hour >= 0 && next.night_end_hour < 24) || next.max_driving_hours < 0) {
    throw businessRule("Heures de nuit entre 0 et 24, durée de conduite positive.");
  }
  Object.assign(s, values);
  return hsSettingsRow(company);
});

/* Cockpit et échéances */
/**
 * Matrice des événements de la période (le mois, ou les douze mois qui s'y terminent) par gravité
 * potentielle × probabilité, probabilité 5 en tête ; les événements non classés restent hors matrice.
 */
function hsEventMatrix(events, month, period) {
  const debut = period === "12m" ? addMonths(`${month}-01`, -11) : `${month}-01`;
  const fin = `${monthEnd(`${month}-01`)}T23:59:59`;
  const dans = events.filter((e) => e.occurred_at >= debut && e.occurred_at <= fin);
  const counts = new Map();
  for (const e of dans) if (e.potential_severity && e.probability) counts.set(`${e.potential_severity}|${e.probability}`, (counts.get(`${e.potential_severity}|${e.probability}`) ?? 0) + 1);
  const cells = [];
  for (let p = 5; p >= 1; p -= 1) {
    for (let g = 1; g <= 5; g += 1) cells.push({ severity: g, potential_severity: g, probability: p, criticality: g * p, level: hsLevel(g * p), count: counts.get(`${g}|${p}`) ?? 0 });
  }
  return { matrix: cells, matrix_unclassified: dans.length - sum(cells, (c) => c.count) };
}

/**
 * Situation du lot 2 au cockpit (lot2_blocks du noyau), bornée aux sites du compte, d'après les tables
 * des modules du lot 2 : risques en vigueur, audits de l'année, constats ouverts, exigences et maturité
 * (pas pour le chef de parc), immobilisations en cours.
 */
function hsLot2Blocks(ctx, q, month) {
  // Portée fermée par défaut : hors lecture complète, un objet sans site n'est pas compté (lot2_blocks du noyau).
  const bornes = hsScope(ctx) === "all" ? null : hsSites(ctx);
  const surSite = (x) => (!bornes || bornes.includes(x.site_id)) && (!q.site_id || x.site_id === Number(q.site_id));
  const niveaux = (list, f) => Object.fromEntries(["low", "moderate", "significant", "high"].map((n) => [n, list.filter((x) => f(x) === n).length]));
  const risks = (DB.hsseq.risks ?? []).filter((x) => x.status === "active" && surSite(x));
  const niveauDe = (x, prefixe) => x[prefixe]?.level ?? x[`${prefixe}_level`] ?? hsLevel((x[prefixe]?.severity ?? x[`${prefixe}_severity`] ?? 0) * (x[prefixe]?.probability ?? x[`${prefixe}_probability`] ?? 0));
  const year = Number(month.slice(0, 4));
  const audits = (DB.hsseq.audits ?? []).filter((a) => a.status !== "cancelled" && surSite(a) && String(a.planned_date ?? "") >= `${year}-01-01` && String(a.planned_date ?? "") <= monthEnd(`${month}-01`));
  const done = audits.filter((a) => ["done", "closed"].includes(a.status)).length;
  const findings = (DB.hsseq.findings ?? []).filter((f) => f.status === "open" && surSite(f));
  const immobilizations = (DB.hsseq.immobilizations ?? []).filter((i) => i.status === "active" && surSite(i)).sort((a, b) => String(b.since).localeCompare(String(a.since)));
  const blocks = {
    risks: { active: risks.length, by_raw_level: niveaux(risks, (x) => niveauDe(x, "raw")), by_residual_level: niveaux(risks, (x) => niveauDe(x, "residual")), reviews_overdue: risks.filter((x) => x.review_date && x.review_date < TODAY).length },
    audits: { year, planned: audits.length, done, rate: audits.length ? Math.round((done * 1000) / audits.length) / 10 : null },
    findings: { open_by_class: Object.fromEntries(["major", "minor", "observation"].map((k) => [k, findings.filter((f) => f.classification === k).length])) },
    immobilizations: {
      active: immobilizations.length,
      items: immobilizations.slice(0, 8).map((i) => ({ id: i.id, vehicle: hsVehicleRef(i.vehicle_id), site: hsSiteRef(i.site_id), event: { id: i.event_id, reference: HS.events.find((e) => e.id === i.event_id)?.reference ?? `#${i.event_id}` }, since: i.since })),
    },
    requirements: null,
    iso_maturity: null,
  };
  if (hasProfile(ctx, ["admin", "direction", "hsseq", "auditeur"])) {
    const reqs = DB.hsseq.requirements ?? [];
    const statuts = ["compliant", "partial", "non_compliant", "not_evaluated"];
    blocks.requirements = { by_status: Object.fromEntries(statuts.map((s) => [s, reqs.filter((x) => x.status === s).length])), non_compliant: reqs.filter((x) => x.status === "non_compliant").length };
    const normes = [["iso_45001", "ISO 45001"], ["iso_14001", "ISO 14001"], ["iso_9001", "ISO 9001"], ["other", "Autre"]];
    const maturity = normes.flatMap(([code, label]) => {
      const subset = reqs.filter((x) => x.standard === code);
      if (!subset.length) return [];
      const evaluated = subset.filter((x) => x.status !== "not_evaluated");
      const score = sum(evaluated, (x) => (x.status === "compliant" ? 1 : x.status === "partial" ? 0.5 : 0));
      return [{ standard: code, label, requirements: subset.length, evaluated: evaluated.length, score: evaluated.length ? Math.round((score * 1000) / evaluated.length) / 10 : null }];
    });
    blocks.iso_maturity = maturity.length ? maturity : null;
  }
  return blocks;
}

/**
 * Situation du lot 3 au cockpit (lot3_blocks du noyau), bornée aux sites du compte, d'après les tables
 * des modules du lot 3 : environnement et qualité, urgences, documents, télématique du mois.
 */
function hsLot3Blocks(ctx, q, month) {
  const bornes = hsScope(ctx) === "all" ? null : hsSites(ctx);
  const surSite = (x) => (!bornes || bornes.includes(x.site_id)) && (!q.site_id || x.site_id === Number(q.site_id));
  const qualite = hasProfile(ctx, ["admin", "direction", "hsseq", "auditeur"]);
  const depuis30Jours = addDays(TODAY, -30);
  const complaints = (DB.hsseq.complaints ?? []).filter(surSite);
  const drills = (DB.hsseq.drills ?? []).filter((x) => x.status === "planned" && surSite(x));
  const procedures = (DB.hsseq.procedures ?? []).filter((x) => ["published", "active", "in_force"].includes(x.status));
  const accuses = DB.hsseq.acknowledgements ?? [];
  const attendus = sum(procedures, (p) => Number(hsChamp(p, "ack_targets", "targets") ?? 0));
  const lus = sum(procedures, (p) => Number(hsChamp(p, "ack_count", "read") ?? accuses.filter((a) => a.procedure_id === p.id).length));
  const violations = (DB.hsseq.violations ?? DB.hsseq.telematicsViolations ?? []).filter((x) => String(hsChamp(x, "occurred_at", "date") ?? "").slice(0, 7) === month && surSite(x)
    && (!q.vehicle_kind || hsKind(hsVehicle(x.vehicle_id)) === q.vehicle_kind));
  const imports = [...(DB.hsseq.telematicsImports ?? [])].sort((a, b) => String(b.imported_at).localeCompare(String(a.imported_at)));
  return {
    environment: {
      spills_open: (DB.hsseq.spills ?? []).filter((x) => x.status === "open" && surSite(x)).length,
      wastes_stored: (DB.hsseq.wastes ?? []).filter((x) => x.status === "stored" && surSite(x)).length,
      dust_exceedances_30d: (DB.hsseq.dustMeasurements ?? []).filter((x) => x.exceeded && String(hsChamp(x, "measured_on", "date") ?? "") >= depuis30Jours && surSite(x)).length,
      contaminations_open: qualite ? (DB.hsseq.contaminations ?? []).filter((x) => x.status === "open" && surSite(x)).length : null,
      complaints_open: qualite ? complaints.filter((x) => x.status !== "closed").length : null,
      complaints_overdue: qualite ? complaints.filter((x) => x.status === "received" && x.response_due && x.response_due < TODAY).length : null,
    },
    emergency: {
      plans_active: (DB.hsseq.emergencyPlans ?? []).filter((x) => x.active !== false && surSite(x)).length,
      overdue: drills.filter((x) => x.planned_date < TODAY).length,
      upcoming: drills.filter((x) => x.planned_date >= TODAY && x.planned_date <= addDays(TODAY, 30)).length,
    },
    documents: { procedures_published: procedures.length, targets: attendus, read: lus, read_rate: attendus ? Math.round((lus * 1000) / attendus) / 10 : null },
    telematics: {
      violations: violations.length,
      by_type: Object.fromEntries(["speeding", "harsh_braking", "night_driving", "driving_time"].map((k) => [k, violations.filter((x) => hsChamp(x, "violation_type", "type") === k).length])),
      last_import_at: imports[0]?.imported_at ?? null,
    },
  };
}

route("GET", "/hsseq/cockpit", [...HS_READ, "auditeur"], (ctx) => {
  const q = ctx.query;
  const period = q.period || "month";
  if (!["month", "12m"].includes(period)) throw hsBad("Période : month ou 12m.", ["period"]);
  if (q.month && !/^\d{4}-\d{2}$/.test(q.month)) throw hsBad("Mois attendu au format AAAA-MM.", ["month"]);
  const month = q.month && q.month <= TODAY.slice(0, 7) ? q.month : TODAY.slice(0, 7);
  if (q.vehicle_kind && !["tanker", "tipper"].includes(q.vehicle_kind)) throw hsBad("Type de véhicule : tanker ou tipper.", ["vehicle_kind"]);
  if (q.site_id && !hsSiteOk(ctx, Number(q.site_id))) throw hsForbidden("Site non autorisé.");
  const next5 = `${addMonths(`${month}-01`, 1).slice(0, 7)}-05`;
  const frozen = month < TODAY.slice(0, 7) && next5 <= TODAY;
  const overdue = HS.actions.filter((a) => ["todo", "in_progress"].includes(a.status) && a.due_date < TODAY && hsFilter(ctx, q, a.site_id, null) && hsSiteOk(ctx, a.site_id));
  const events = HS.events.filter((e) => hsFilter(ctx, q, e.site_id, null) && hsSiteOk(ctx, e.site_id));
  // Portée fermée par défaut : hors lecture complète, un compte sans site ne lit pas le cockpit.
  if (hsScope(ctx) !== "all" && !hsSites(ctx).length) throw hsForbidden("Aucun site n'est rattaché à votre compte : le cockpit se lit par site.");
  const indicators = hsIndicators(ctx, q, month, period);
  const byReason = Object.fromEntries(["V02", "V04", "V05", "V06", "V07", "V08", "V09"].map((code) => [code, 0]));
  for (const b of indicators.find((i) => i.code === "waivers")?.breakdown ?? []) byReason[b.reason_code] = (byReason[b.reason_code] ?? 0) + b.count;
  const lot2 = hsLot2Blocks(ctx, q, month);
  const lot3 = hsLot3Blocks(ctx, q, month);
  const blocked = hsDepartures(ctx, TODAY, q, true);
  let deadlines = hsDeadlines(ctx, { ...q, kind: "", horizon: "30" });
  if (hsPersonalHidden(ctx)) {
    // Auditeur : ni conducteurs des départs bloqués, ni échéances des personnes.
    blocked.items = [];
    deadlines = { ...deadlines, items: deadlines.items.filter((d) => d.kind === "vehicle_document") };
  }
  const kindOk = (e) => !q.vehicle_kind || hsKind(hsVehicle(e.vehicle_id)) === q.vehicle_kind;
  return {
    period: { type: period, month, date_from: `${month}-01`, date_to: minDate(monthEnd(`${month}-01`), TODAY), label: monthLabel(`${month}-01`), frozen, frozen_on: frozen ? next5 : null },
    filters: { company_id: q.company_id ? Number(q.company_id) : null, site_id: q.site_id ? Number(q.site_id) : null, vehicle_kind: q.vehicle_kind || null },
    referentials: { companies: ctx.user.companies.map(companyRef), sites: HS.sites.map((s) => ({ id: s.id, name: s.name })) },
    hours_basis: "presence",
    indicators,
    blocked_departures: blocked,
    overdue_actions: { total: overdue.length, items: overdue.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id).slice(0, 8).map(hsActionLine) },
    deadlines,
    events: {
      to_classify: events.filter((e) => e.status === "reported").length,
      overdue_investigations: events.filter(hsEventOverdue).length,
      high_open: events.filter((e) => e.status !== "closed" && hsLevel(hsCriticality(e)) === "high").length,
      ...hsEventMatrix(events.filter(kindOk), month, period),
    },
    waivers_by_reason: byReason,
    ...lot2,
    ...lot3,
    computed_at: hsNow(),
  };
});
route("GET", "/hsseq/deadlines", ["admin", "direction", "hsseq", "exploitation", "rh"], (ctx) => hsDeadlines(ctx, ctx.query));

/* Espace du compte, notifications, journal */
route("GET", "/hsseq/me", null, (ctx) => {
  hsInternal(ctx);
  const emp = hsEmployee(ctx);
  const driver = emp ? hsDriver(emp.driver_id) : null;
  const rotations = driver ? [...DB.rotations.filter((r) => r.company_id === 1), ...HS.rotations].filter((r) => r.driver_id === driver.id && (r.state === "en_route" || (r.state === "draft" && r.date_loading === TODAY))) : [];
  return {
    employee: emp ? { id: emp.id, name: ctx.user.name, matricule: emp.matricule ?? null } : null,
    driver: driver ? { id: driver.id, name: driver.name } : null,
    fitness: emp ? "fit" : null,
    qualifications: driver ? [{ code: "permis_pl", name: "Permis de conduire poids lourd", mandatory: true, state: !driver.license_expiry ? "absente" : driver.license_expiry < TODAY ? "expiree" : "valide", expiry: driver.license_expiry ?? null }] : [],
    rotations: rotations.map((r) => ({ ...hsRotationRef(r), vehicle: hsVehicleRef(r.vehicle_id), lock: r.state === "draft" ? hsEvaluate(ctx, r) : null })),
  };
});
route("GET", "/hsseq/notifications", null, (ctx) => {
  hsInternal(ctx);
  if (ctx.query.sort && !["id", "-id"].includes(ctx.query.sort)) throw hsBad("Tri inconnu.", ["sort"]);
  const unreadOnly = ["1", "true"].includes(String(ctx.query.unread ?? "").toLowerCase());
  const mine = HS.notifications.filter((n) => n.user_id === ctx.user.id && n.channel === "app");
  const list = mine.filter((n) => !unreadOnly || !n.read_at).sort((a, b) => (ctx.query.sort === "id" ? a.id - b.id : b.id - a.id));
  return hsPage(ctx, list, { unread: mine.filter((n) => !n.read_at).length }, hsNotificationRow);
});
route("POST", "/hsseq/notifications/:id/read", null, (ctx) => {
  hsInternal(ctx);
  const n = HS.notifications.find((x) => x.id === ctx.params[0] && x.user_id === ctx.user.id);
  if (!n) throw notFound("Notification introuvable.");
  if (!n.read_at) n.read_at = hsNow();
  return hsNotificationRow(n);
});
route("GET", "/hsseq/log", ["direction", "hsseq"], (ctx) => {
  const q = ctx.query;
  const model = q.model || q.object || null;
  const id = q.id || q.object_id || null;
  if (model && !["event", "action", "check", "nonconformity", "waiver", "breath_test"].includes(model)) throw hsBad("Fiche inconnue.", ["model"]);
  if (q.sort && !["at", "-at"].includes(q.sort)) throw hsBad("Tri inconnu.", ["sort"]);
  const from = dateArg(q, "date_from");
  const to = dateArg(q, "date_to");
  const list = HS.log.filter((l) => (!model || l.model === model) && (!model || !id || l.res_id === Number(id)) && (!from || l.at.slice(0, 10) >= from) && (!to || l.at.slice(0, 10) <= to))
    .sort((a, b) => (q.sort === "at" ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at)) || b.id - a.id);
  return hsPage(ctx, list, {}, hsHistoryRow);
});

/* Événements */
function hsEventOf(ctx, id) {
  const e = HS.events.find((x) => x.id === id);
  if (!e || !hsCanSeeEvent(ctx, e)) throw notFound("Événement introuvable.");
  return e;
}
const HS_EVENT_SORTS = { occurred_at: (e) => e.occurred_at, criticality: (e) => hsCriticality(e) ?? 0, reference: (e) => e.reference, status: (e) => e.status };
function hsSort(list, sort, sorts, def) {
  const s = sort || def;
  const desc = s.startsWith("-");
  const value = sorts[desc ? s.slice(1) : s];
  if (!value) throw hsBad("Tri inconnu.", ["sort"]);
  return list.sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    return (va === vb ? b.id - a.id : va > vb ? 1 : -1) * (va === vb ? 1 : desc ? -1 : 1);
  });
}
const hsList = (v) => (v ? String(v).split(",").filter(Boolean) : null);
function hsEventList(ctx) {
  const q = ctx.query;
  const statuses = hsList(q.status);
  const types = hsList(q.type);
  const domains = hsList(q.domain);
  const levels = hsList(q.level);
  const from = dateArg(q, "date_from");
  const to = dateArg(q, "date_to");
  const s = (q.search || "").toLowerCase();
  const kind = (e) => (e.vehicle_id ? hsKind(hsVehicle(e.vehicle_id)) : null);
  return HS.events.filter((e) =>
    hsCanSeeEvent(ctx, e) && hsFilter(ctx, q, e.site_id, null) && (!q.vehicle_kind || kind(e) === q.vehicle_kind) && (!statuses || statuses.includes(e.status)) && (!types || types.includes(e.type)) && (!domains || domains.includes(e.domain))
    && (!levels || levels.includes(hsLevel(hsCriticality(e)) ?? "unclassified")) && (!q.vehicle_id || e.vehicle_id === hsId(q, "vehicle_id")) && (!q.rotation_id || e.rotation_id === hsId(q, "rotation_id"))
    && (!from || e.occurred_at.slice(0, 10) >= from) && (!to || e.occurred_at.slice(0, 10) <= to) && (!["1", "true"].includes(q.overdue_investigation) || hsEventOverdue(e))
    && (!s || [e.reference, e.title, e.location ?? ""].some((x) => x.toLowerCase().includes(s))));
}
route("GET", "/hsseq/events", HS_EVENT_READ, (ctx) => {
  const list = hsSort(hsEventList(ctx), ctx.query.sort, HS_EVENT_SORTS, "-occurred_at");
  const byStatus = { reported: 0, classified: 0, investigation: 0, actions: 0, closed: 0 };
  const byLevel = { low: 0, moderate: 0, significant: 0, high: 0, unclassified: 0 };
  for (const e of list) {
    byStatus[e.status]++;
    byLevel[hsLevel(hsCriticality(e)) ?? "unclassified"]++;
  }
  return hsPage(ctx, list, { by_status: byStatus, by_level: byLevel, overdue_investigations: list.filter(hsEventOverdue).length }, (e) => hsMasquer(ctx, hsEventLine(e)));
});
route("GET", "/hsseq/events/export.xlsx", HS_READ, (ctx) => {
  const list = hsSort(hsEventList(ctx), null, HS_EVENT_SORTS, "-occurred_at");
  const rows = list.map((e) => [e.reference, e.occurred_at.slice(0, 10), e.title, HS_TYPE_LABELS[e.type], e.domain, HS_STATUS_LABELS[e.status], hsSite(e.site_id)?.name ?? "", e.vehicle_id ? hsVehicle(e.vehicle_id).name : "", e.actual_severity ?? "", e.potential_severity ?? "", e.probability ?? "", hsCriticality(e) ?? "", HS_LEVEL_LABELS[hsLevel(hsCriticality(e))] ?? "Non classé", hsEventActions(e).filter(hsActionOpen).length, sum(e.costs, (c) => c.amount), userName(e.reported_by)]);
  return fileReply(xlsxBuffer([{ name: "Registre des événements HSSEQ", rows: [["Référence", "Survenu le", "Titre", "Type", "Domaine", "Statut", "Site", "Ensemble", "Gravité réelle", "Gravité potentielle", "Probabilité", "Criticité", "Niveau", "Actions ouvertes", "Coût total", "Déclaré par"], ...rows] }]), XLSX, `registre_evenements_hsseq_${TODAY.replaceAll("-", "")}.xlsx`);
});
route("GET", "/hsseq/events/:id", HS_EVENT_READ, (ctx) => hsMasquer(ctx, hsEventDetail(ctx, hsEventOf(ctx, ctx.params[0]))));
route("GET", "/hsseq/events/:id/report.pdf", HS_READ, (ctx) => {
  const e = hsEventOf(ctx, ctx.params[0]);
  const inv = hsInvestigationRow(e);
  const lines = [
    `${HS_TYPE_LABELS[e.type]}, survenu le ${frDate(e.occurred_at.slice(0, 10))} à ${e.occurred_at.slice(11, 16)} (UTC)`,
    `Lieu : ${e.location ?? "-"}   Site : ${hsSite(e.site_id)?.name ?? "-"}   Ensemble : ${e.vehicle_id ? hsVehicle(e.vehicle_id).name : "-"}`,
    `Criticité : ${hsCriticality(e) ?? "non classé"} (${HS_LEVEL_LABELS[hsLevel(hsCriticality(e))] ?? "-"})   Statut : ${HS_STATUS_LABELS[e.status]}`,
    "", "Description", e.description, "",
    "Enquête", inv.method ? `Méthode : ${{ simple_analysis: "analyse simple", five_whys: "5 Pourquoi", cause_tree: "arbre des causes" }[inv.method]}` : "Pas d'enquête.",
    ...inv.whys.map((w, i) => `Pourquoi ${i + 1} : ${w}`),
    ...inv.tree.map((n) => `Fait ${n.id}${n.parent_id ? ` (cause de ${n.parent_id})` : ""} : ${n.label}`),
    inv.root_cause ? `Cause racine : ${inv.root_cause}` : "",
    "", "Actions", ...hsEventActions(e).map((a) => `${a.reference} : ${a.description} (${HS_ACTION_LABELS[a.status]}, échéance ${frDate(a.due_date)})`),
    "", `Coûts : ${fmtInt(sum(e.costs, (c) => c.amount))} GNF`, "", "Fichier de maquette : données fictives.",
  ];
  return fileReply(pdfBuffer(`Rapport d'enquête ${e.reference}`, lines.filter((l) => l !== null)), "application/pdf", `rapport_enquete_${e.reference.replaceAll("/", "-")}.pdf`);
});
/** Personnes en cause : la liste remplace la précédente ; le noyau lit `id` puis `person_id` comme identifiant de la personne. */
function hsPeople(data) {
  if (data.people === undefined || data.people === null) return null;
  if (!Array.isArray(data.people)) throw hsBad("Liste des personnes invalide.", ["people"]);
  return data.people.map((p) => {
    if (!p || typeof p !== "object" || !["driver", "employee", "third_party"].includes(p.kind)) throw hsBad("Personne : kind driver, employee ou third_party.", ["people"]);
    const role = p.role || "victim";
    if (!["victim", "driver", "witness", "perpetrator", "third_party"].includes(role)) throw hsBad("Rôle d'une personne inconnu.", ["people"]);
    // person_id (le chauffeur ou le salarié) avant id : une fiche relue renvoie aussi l'id de sa ligne.
    const target = hsId(p, "person_id") ?? hsId(p, "id");
    let name = hsText(p, "name", 200);
    let id = null;
    if (p.kind === "driver" && target) {
      const d = hsDriver(target);
      if (!d) throw notFound("Chauffeur introuvable.");
      [id, name] = [d.id, d.name];
    } else if (p.kind === "employee" && target) {
      const emp = hsEmployeeRows().find((x) => x.id === target);
      if (!emp) throw notFound("Salarié introuvable.");
      [id, name] = [emp.id, emp.name];
    }
    if (!id && !name) throw hsMissing("Personne sans identifiant ni nom.", ["people"]);
    return { line_id: ++HS.seq.person, kind: p.kind, id, name, role, days_off: Math.max(0, Math.trunc(Number(p.days_off) || 0)) };
  });
}
/** Champs de la déclaration (création, correction par le déclarant ou hsseq). */
function hsEventValues(ctx, e, data) {
  for (const key of ["title", "description", "location"]) if (key in data) e[key] = hsText(data, key, key === "description" ? 4000 : 300);
  if ("type" in data) {
    if (!(data.type in HS_TYPES)) throw hsBad("Type d'événement inconnu.", ["type"]);
    e.type = data.type;
  }
  if ("domain" in data && data.domain) {
    if (!HS_DOMAINS.includes(data.domain)) throw hsBad("Domaine inconnu.", ["domain"]);
    e.domain = data.domain;
  }
  if ("occurred_at" in data) {
    const v = hsDateTime(data, "occurred_at");
    if (!v) throw hsMissing("Date et heure de l'événement manquantes.", ["occurred_at"]);
    e.occurred_at = v;
  }
  if ("latitude" in data || "longitude" in data) {
    const lat = hsNum(data.latitude, "latitude");
    const lon = hsNum(data.longitude, "longitude");
    if ((lat !== null || lon !== null) && (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180)) throw hsBad("Position invalide.", ["latitude", "longitude"]);
    Object.assign(e, { latitude: lat, longitude: lon, gps_accuracy: lat === null ? null : Math.max(0, hsNum(data.gps_accuracy, "gps_accuracy") ?? 0) || null });
  }
  if ("rotation_id" in data) {
    const id = hsId(data, "rotation_id");
    const rot = id ? hsRotation(id) : null;
    if (id && !rot) throw notFound("Rotation introuvable.");
    if (rot && hsScope(ctx) === "self" && rot.driver_id !== hsMyDriver(ctx)) throw hsForbidden("Un conducteur ne déclare que sur ses propres rotations.");
    e.rotation_id = rot?.id ?? null;
    if (rot && !("vehicle_id" in data)) e.vehicle_id = rot.vehicle_id;
  }
  if ("vehicle_id" in data) {
    const id = hsId(data, "vehicle_id");
    if (id && !hsVehicle(id)) throw notFound("Ensemble introuvable.");
    e.vehicle_id = id;
  }
  if ("site_id" in data) {
    const id = hsId(data, "site_id");
    if (id && !hsSite(id)) throw notFound("Site introuvable.");
    e.site_id = id;
  } else if (e.vehicle_id && ("vehicle_id" in data || "rotation_id" in data)) e.site_id = hsVehicleSite(hsVehicle(e.vehicle_id));
  const people = hsPeople(data);
  if (people) e.people = people;
}
route("POST", "/hsseq/events", ["admin", "direction", "hsseq", "exploitation", "conducteur"], (ctx) => {
  const b = ctx.body;
  requireFields(b, "client_uuid", "type", "title", "description", "occurred_at");
  const existing = hsExisting(ctx, HS.events, b.client_uuid, (x) => x.reported_by);
  if (existing) return hsEventDetail(ctx, existing);
  const now = hsNow();
  const e = {
    id: 0, reference: "", title: "", type: "hazard", domain: null, status: "reported", occurred_at: now, site_id: null, vehicle_id: null, rotation_id: null,
    actual_severity: null, potential_severity: null, probability: null, reported_by: ctx.user.id, description: "", location: null, latitude: null, longitude: null, gps_accuracy: null,
    source: ctx.app === "terrain" ? "terrain" : "web", client_uuid: String(b.client_uuid).trim().slice(0, 64), reported_at: hsReportedAt(b), synced_at: now, offline: Boolean(b.offline),
    people: [], lost_time: false, days_lost: 0, leave_id: null, vehicle_immobilized: false, classified_at: null, classified_by: null, closed_at: null, closed_by: null, reopen_reason: null,
    investigation: null, costs: [], deadlines: { investigation_due: null, client_notice_due: null, client_notified_at: null },
  };
  hsEventValues(ctx, e, b);
  // Notes estimées par le déclarant : gardées à part du classement, en lecture seule ensuite.
  for (const key of ["actual_severity", "potential_severity", "probability"]) {
    if (b[key] === undefined || b[key] === null || b[key] === "") continue;
    const note = Number(b[key]);
    if (!Number.isInteger(note) || note < 1 || note > 5) throw hsBad("Gravités et probabilité se notent de 1 à 5.", [key]);
    e[`declared_${key}`] = note;
  }
  e.domain = e.domain ?? HS_TYPES[e.type];
  e.id = ++HS.seq.event;
  e.reference = `EVT/2026/${pad(e.id, 4)}`;
  HS.events.push(e);
  hsClaim(ctx, hsIds(b, "attachment_ids"), "event", e.id);
  hsLog("event", e.id, ctx.user.id, "create");
  hsNotify(hsHsseqManagers(), "reported", `Événement déclaré : ${e.reference} ${e.title}`, e.description, "event", e.id, now);
  return hsEventDetail(ctx, e);
});
route("PATCH", "/hsseq/events/:id", HS_FIELD, (ctx) => {
  const e = hsEventOf(ctx, ctx.params[0]);
  const b = ctx.body;
  if (!hsEventDetail(ctx, e).rights.can_edit) throw hsForbidden("Correction réservée au Responsable HSSEQ avant la clôture, ou au déclarant tant que l'événement n'est pas classé.");
  const reserves = ["actual_severity", "potential_severity", "probability", "lost_time", "days_lost", "leave_id", "client_notified_at"];
  if (!hsIs(ctx, "hsseq") && reserves.some((k) => k in b)) throw hsForbidden("Notes, arrêt de travail et information du donneur d'ordre : Responsable HSSEQ.");
  const before = hsCriticality(e);
  hsEventValues(ctx, e, b);
  for (const key of ["actual_severity", "potential_severity", "probability"]) {
    if (!(key in b)) continue;
    const n = b[key] === null || b[key] === "" ? null : Number(b[key]);
    if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= 5)) throw businessRule("Gravités et probabilité se notent de 1 à 5.");
    e[key] = n;
  }
  if ("lost_time" in b) e.lost_time = Boolean(b.lost_time);
  if ("days_lost" in b) e.days_lost = Math.max(0, Math.trunc(Number(b.days_lost) || 0));
  if ("leave_id" in b) e.leave_id = hsId(b, "leave_id");
  if ("client_notified_at" in b) e.deadlines.client_notified_at = hsDateTime(b, "client_notified_at");
  hsLog("event", e.id, ctx.user.id, "write", before !== hsCriticality(e) ? "criticality" : null, before !== hsCriticality(e) ? before : null, before !== hsCriticality(e) ? hsCriticality(e) : null);
  return hsEventDetail(ctx, e);
});
route("PUT", "/hsseq/events/:id/investigation", ["hsseq"], (ctx) => {
  const e = hsEventOf(ctx, ctx.params[0]);
  if (e.status !== "investigation" || !e.investigation) throw hsRule("invalid_transition", "L'enquête se conduit au statut « Enquête ».");
  const b = ctx.body;
  const inv = e.investigation;
  const lignes = (v) => (v ? String(v).split("\n").map((x) => x.trim()).filter(Boolean) : []);
  if ("method" in b) {
    if (b.method && !HS_METHODS.includes(b.method)) throw hsBad("Méthode d'enquête inconnue.", ["method"]);
    inv.method = b.method || null;
  }
  if ("team_ids" in b) inv.team_ids = hsIds(b, "team_ids").filter((id) => userById(id));
  if ("immediate_causes" in b) inv.immediate_causes = Array.isArray(b.immediate_causes) ? b.immediate_causes.map(String) : lignes(b.immediate_causes);
  for (const key of ["root_cause", "conclusion"]) if (key in b) inv[key] = hsText(b, key, 8000);
  if ("whys" in b) {
    if (!Array.isArray(b.whys ?? []) || (b.whys ?? []).length > 5) throw hsBad("Cinq pourquoi au plus.", ["whys"]);
    inv.whys = (b.whys ?? []).map((w) => String(w).trim().slice(0, 1000)).filter(Boolean);
  }
  if ("tree" in b) {
    if (!Array.isArray(b.tree) || b.tree.length > 200) throw hsBad("Arbre des causes invalide.", ["tree"]);
    const faits = b.tree.map((f, i) => {
      if (!f || !String(f.label ?? "").trim()) throw hsBad("Chaque fait de l'arbre a un libellé.", ["tree"]);
      const kind = f.kind || "unusual_fact";
      if (!["unusual_fact", "permanent_fact"].includes(kind)) throw hsBad("Fait : unusual_fact ou permanent_fact.", ["tree"]);
      return { id: String(f.id ?? i + 1).slice(0, 40), label: String(f.label).trim().slice(0, 500), kind, parent_id: f.parent_id === null || f.parent_id === undefined || f.parent_id === "" ? null : String(f.parent_id).slice(0, 40) };
    });
    const ids = new Set(faits.map((f) => f.id));
    if (faits.some((f) => f.parent_id && !ids.has(f.parent_id))) throw hsBad("Fait rattaché à un parent inconnu.", ["tree"]);
    inv.tree = faits;
  }
  if ("factors_5m" in b) {
    const f = b.factors_5m ?? {};
    if (typeof f !== "object" || Array.isArray(f) || Object.keys(f).some((k) => !HS_FACTORS.includes(k))) throw hsBad("Facteurs 5M : environment, equipment, method, manpower, material.", ["factors_5m"]);
    for (const k of HS_FACTORS) if (k in f) inv.factors_5m[k] = Array.isArray(f[k]) ? f[k].map(String) : lignes(f[k]);
  }
  hsLog("event", e.id, ctx.user.id, "write", null, null, null, hsNow(), "Enquête mise à jour");
  return hsEventDetail(ctx, e);
});
route("POST", "/hsseq/events/:id/costs", ["hsseq"], (ctx) => {
  const e = hsEventOf(ctx, ctx.params[0]);
  if (e.status === "closed") throw hsRule("invalid_transition", "Événement clôturé : rouvrez-le avant d'ajouter un coût.");
  const [kind, amount] = requireFields(ctx.body, "kind", "amount");
  if (!HS_COST_KINDS.includes(kind)) throw hsBad("Nature de coût inconnue.", ["kind"]);
  const montant = cleanNumber(amount);
  if (!Number.isFinite(montant)) throw hsBad("Nombre invalide : amount.", ["amount"]);
  const date = ctx.body.date ? String(ctx.body.date).slice(0, 10) : TODAY;
  if (!isDate(date)) throw hsBad("Date invalide : date.", ["date"]);
  e.costs.push({ id: ++HS.seq.cost, kind, label: hsText(ctx.body, "label", 300), amount: montant, date, finance_move_id: hsId(ctx.body, "finance_move_id") });
  hsLog("event", e.id, ctx.user.id, "cost", null, null, null, hsNow(), `${kind} : ${fmtInt(montant)} GNF`);
  return hsEventDetail(ctx, e);
});
route("DELETE", "/hsseq/events/:id/costs/:id", ["hsseq"], (ctx) => {
  const e = hsEventOf(ctx, ctx.params[0]);
  if (e.status === "closed") throw hsRule("invalid_transition", "Événement clôturé : rouvrez-le avant de retirer un coût.");
  const c = e.costs.find((x) => x.id === ctx.params[1]);
  if (!c) throw notFound("Coût introuvable.");
  e.costs = e.costs.filter((x) => x !== c);
  hsLog("event", e.id, ctx.user.id, "cost_removed", null, null, null, hsNow(), `${c.kind} : ${fmtInt(c.amount)} GNF`);
  return hsEventDetail(ctx, e);
});
route("POST", "/hsseq/events/:id/:action", ["hsseq"], (ctx) => {
  const action = ctx.params[1];
  // Immobilisation du véhicule (V09, lot 2) : servie par le module hsseq-trajets.
  if (action === "immobilize") return immobiliser(ctx, ctx.params[0]);
  if (!["classify", "investigate", "plan", "close", "reopen"].includes(action)) throw notFound("Transition inconnue.");
  const e = hsEventOf(ctx, ctx.params[0]);
  const b = ctx.body;
  const now = hsNow();
  const permises = { reported: ["classify"], classified: ["investigate", ...(hsLevel(hsCriticality(e)) === "low" && !hsEventActions(e).length ? ["close"] : [])], investigation: ["plan"], actions: ["close"], closed: ["reopen"] }[e.status];
  if (!permises.includes(action)) throw hsRule("invalid_transition", `Transition « ${action} » impossible depuis le statut « ${HS_STATUS_LABELS[e.status]} ».`);
  if (action === "classify") {
    const values = {};
    for (const key of ["actual_severity", "potential_severity", "probability"]) {
      if (b[key] === undefined || b[key] === null || b[key] === "") continue;
      const n = Number(b[key]);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw hsBad("Gravités et probabilité se notent de 1 à 5.", [key]);
      values[key] = n;
    }
    if (b.type) {
      if (!(b.type in HS_TYPES)) throw hsBad("Type d'événement inconnu.", ["type"]);
      values.type = b.type;
    }
    if (b.domain) {
      if (!HS_DOMAINS.includes(b.domain)) throw hsBad("Domaine inconnu.", ["domain"]);
      values.domain = b.domain;
    }
    if ("lost_time" in b) values.lost_time = Boolean(b.lost_time);
    if ("days_lost" in b) values.days_lost = Math.max(0, Math.trunc(Number(b.days_lost) || 0));
    const manque = ["potential_severity", "probability"].filter((k) => !(values[k] ?? e[k]));
    if (manque.length) throw hsMissing("Gravité potentielle et probabilité sont à noter pour classer.", manque);
    hsClassify(e, ctx.user.id, now, values);
  } else if (action === "investigate") {
    if (b.method && !HS_METHODS.includes(b.method)) throw hsBad("Méthode d'enquête inconnue.", ["method"]);
    const team = "team_ids" in b ? hsIds(b, "team_ids").filter((id) => userById(id)) : null;
    e.investigation = e.investigation ?? { method: null, team_ids: [], opened_at: now, due_date: null, concluded_at: null, immediate_causes: [], whys: [], tree: [], factors_5m: Object.fromEntries(HS_FACTORS.map((k) => [k, []])), root_cause: null, conclusion: null };
    Object.assign(e.investigation, { method: b.method || e.investigation.method || hsLevelMethod(hsLevel(hsCriticality(e))), opened_at: now, ...(team ? { team_ids: team } : {}) });
    e.status = "investigation";
    hsLog("event", e.id, ctx.user.id, "investigate", "status", "classified", "investigation");
  } else if (action === "plan") {
    if (!e.investigation?.root_cause?.trim()) throw hsRule("root_cause_missing", "Renseignez la cause racine avant de passer aux actions.", { fields: ["root_cause"] });
    e.investigation.concluded_at = now;
    e.status = "actions";
    hsLog("event", e.id, ctx.user.id, "plan", "status", "investigation", "actions");
  } else if (action === "close") {
    const ouvertes = hsEventActions(e).filter(hsActionOpen);
    if (ouvertes.length) throw hsRule("actions_open", `Actions ni closes ni annulées : ${ouvertes.map((a) => a.reference).join(", ")}.`);
    const before = e.status;
    Object.assign(e, { status: "closed", closed_at: now, closed_by: ctx.user.id });
    hsLog("event", e.id, ctx.user.id, "close", "status", before, "closed");
  } else {
    if (!String(b.reason ?? "").trim()) throw hsRule("reason_required", "Le motif de la réouverture est obligatoire.", { fields: ["reason"] });
    e.status = hsEventActions(e).length ? "actions" : e.investigation?.opened_at ? "investigation" : "classified";
    Object.assign(e, { closed_at: null, closed_by: null, reopen_reason: String(b.reason).trim() });
    hsLog("event", e.id, ctx.user.id, "reopen", "status", "closed", e.status, now, String(b.reason).trim());
  }
  return hsEventDetail(ctx, e);
});

/* Actions (tout compte interne : ses actions ; lecture intégrale pour admin, direction, hsseq) */
function hsActionOf(ctx, id) {
  const a = HS.actions.find((x) => x.id === id);
  if (!a || !hsCanSeeAction(ctx, a)) throw notFound("Action introuvable.");
  return a;
}
const HS_ACTION_SORTS = { due_date: (a) => a.due_date, reference: (a) => a.reference, status: (a) => a.status, created_at: (a) => a.created_at };
/** Fiches d'origine qui filtrent la liste (list_domain du noyau) : clé de la requête et origine des actions. */
const HS_ACTION_SOURCES = { event_id: "event", risk_id: "risk", finding_id: "audit", complaint_id: "complaint", drill_id: "drill", review_id: "review" };
/** L'action vient-elle des fiches demandées ? Son origine, et son champ propre (event_id, review_id…) ou origin_id. */
const hsActionFrom = (a, q) => Object.entries(HS_ACTION_SOURCES).every(([cle, origine]) => !q[cle] || (a.origin === origine && (a[cle] ?? a.origin_id) === hsId(q, cle)));
function hsActionList(ctx) {
  const q = ctx.query;
  const statuses = hsList(q.status);
  const s = (q.search || "").toLowerCase();
  return HS.actions.filter((a) =>
    hsCanSeeAction(ctx, a) && (!q.company_id || Number(q.company_id) === 1) && (!statuses || statuses.includes(a.status)) && (!q.origin || a.origin === q.origin)
    && (!q.owner_id || a.owner_id === hsId(q, "owner_id")) && (!["1", "true"].includes(q.mine) || a.owner_id === ctx.user.id)
    && (!["1", "true"].includes(q.overdue) || hsDaysOverdue(a) > 0) && (!q.site_id || a.site_id === hsId(q, "site_id"))
    && (!q.due_before || a.due_date <= dateArg(q, "due_before")) && hsActionFrom(a, q)
    && (!["1", "true"].includes(q.approval_pending) || hsApprovalPending(a))
    && (!s || [a.reference, a.description].some((x) => x.toLowerCase().includes(s))));
}
route("GET", "/hsseq/actions", null, (ctx) => {
  hsInternal(ctx);
  const list = hsSort(hsActionList(ctx), ctx.query.sort, HS_ACTION_SORTS, "due_date");
  const byStatus = { todo: 0, in_progress: 0, to_verify: 0, closed: 0, cancelled: 0 };
  for (const a of list) byStatus[a.status]++;
  return hsPage(ctx, list, { by_status: byStatus, overdue: list.filter((a) => hsDaysOverdue(a) > 0).length, verifications_due: list.filter((a) => a.status === "to_verify" && a.verification_date && a.verification_date <= TODAY).length, approval_pending: list.filter(hsApprovalPending).length }, hsActionLine);
});
route("GET", "/hsseq/actions/export.xlsx", HS_READ, (ctx) => {
  const list = hsSort(hsActionList(ctx), null, HS_ACTION_SORTS, "due_date");
  const rows = list.map((a) => [a.reference, a.origin, hsActionOriginLabel(a)?.split(" ")[0] ?? "", a.description, a.control_level ?? "", userName(a.owner_id), a.due_date, HS_ACTION_LABELS[a.status], hsDaysOverdue(a), a.verification_date ?? "", a.verified_at ? (a.effective ? "Oui" : "Non") : "", a.estimated_cost ?? 0, hsSite(a.site_id)?.name ?? ""]);
  return fileReply(xlsxBuffer([{ name: "Plan d'actions HSSEQ", rows: [["Référence", "Origine", "Fiche d'origine", "Action", "Niveau de maîtrise", "Responsable", "Échéance", "Statut", "Jours de retard", "Vérification d'efficacité", "Efficace", "Coût estimé", "Site"], ...rows] }]), XLSX, `plan_actions_hsseq_${TODAY.replaceAll("-", "")}.xlsx`);
});
route("GET", "/hsseq/actions/:id", null, (ctx) => {
  hsInternal(ctx);
  return hsActionDetail(ctx, hsActionOf(ctx, ctx.params[0]));
});
function hsActionValues(a, data) {
  if ("description" in data) {
    a.description = hsText(data, "description", 4000);
    if (!a.description) throw hsMissing("Description de l'action manquante.", ["description"]);
  }
  if ("control_level" in data) {
    if (data.control_level && !HS_CONTROL_LEVELS.includes(data.control_level)) throw hsBad("Niveau de maîtrise inconnu.", ["control_level"]);
    a.control_level = data.control_level || null;
  }
  if ("expected_evidence" in data) a.expected_evidence = hsText(data, "expected_evidence", 2000);
  if ("estimated_cost" in data) {
    const n = data.estimated_cost === null || data.estimated_cost === "" ? 0 : cleanNumber(data.estimated_cost);
    if (!Number.isFinite(n)) throw hsBad("Nombre invalide : estimated_cost.", ["estimated_cost"]);
    if (Math.max(n, 0) !== (a.estimated_cost ?? 0)) {
      // Un nouveau coût estimé annule la validation de la direction ; une action coûteuse démarrée revient « à faire ».
      Object.assign(a, { estimated_cost: Math.max(n, 0), approved_at: null, approved_by: null, approved_cost: null });
      if (a.status === "in_progress" && hsIsCostly(a)) Object.assign(a, { status: "todo", started_at: null });
    }
  }
  if ("owner_id" in data) {
    const u = userById(hsId(data, "owner_id"));
    if (!u || !u.active || u.profiles.every((p) => p === "porteur") || !u.companies.includes(1)) throw hsRule("business_rule", "Responsable : un compte interne de la société.", { fields: ["owner_id"] });
    a.owner_id = u.id;
  }
  if ("due_date" in data) {
    const d = dateArg(data, "due_date");
    if (!d) throw hsMissing("Échéance manquante.", ["due_date"]);
    a.due_date = d;
  }
}
route("POST", "/hsseq/actions", ["hsseq"], (ctx) => {
  const b = ctx.body;
  requireFields(b, "description", "owner_id", "due_date");
  const origin = b.origin || "event";
  if (!HS_ORIGINS.includes(origin)) throw hsBad("Origine inconnue.", ["origin"]);
  const originId = hsId(b, "origin_id");
  let site = 1;
  if (origin === "event" || origin === "check") {
    if (!originId) throw hsMissing("Fiche d'origine manquante.", ["origin_id"]);
    const source = origin === "event" ? HS.events.find((x) => x.id === originId) : HS.checks.find((x) => x.id === originId);
    if (!source) throw notFound("Fiche d'origine introuvable.");
    if (origin === "event" && source.status === "closed") throw hsRule("invalid_transition", "Événement clôturé : rouvrez-le avant d'y ajouter une action.");
    site = source.site_id ?? 1;
  } else if (origin === "audit") {
    // origin_id : le constat ; son audit doit être planifié ou réalisé.
    if (!originId) throw hsMissing("Constat d'origine manquant.", ["origin_id"]);
    const constat = (DB.hsseq.findings ?? []).find((x) => x.id === originId);
    if (!constat) throw notFound("Constat introuvable.");
    const audit = (DB.hsseq.audits ?? []).find((x) => x.id === constat.audit_id);
    if (audit && !["planned", "done"].includes(audit.status)) throw hsRule("invalid_transition", "Audit clos ou annulé : rouvrez-le avant d'ajouter une action à ses constats.");
    site = constat.site_id ?? audit?.site_id ?? null;
  } else if (origin === "review") {
    // origin_id : la revue de direction (lot 3) ; close, elle ne reçoit plus d'action.
    if (!originId) throw hsMissing("Revue de direction d'origine manquante.", ["origin_id"]);
    const revue = (DB.hsseq.reviews ?? []).find((x) => x.id === originId);
    if (!revue) throw notFound("Revue de direction introuvable.");
    if (revue.state === "closed") throw hsRule("invalid_transition", "Revue de direction close : rouvrez-la avant d'y ajouter une action.");
    site = null;
  } else if (origin === "complaint" || origin === "drill") {
    // origin_id : la réclamation ou l'exercice (lot 3) ; une fiche close ou annulée ne reçoit plus d'action.
    if (!originId) throw hsMissing("Fiche d'origine manquante.", ["origin_id"]);
    const source = (origin === "complaint" ? DB.hsseq.complaints : DB.hsseq.drills)?.find((x) => x.id === originId);
    if (!source) throw notFound(origin === "complaint" ? "Réclamation introuvable." : "Exercice introuvable.");
    if (["closed", "cancelled"].includes(source.status)) throw hsRule("invalid_transition", origin === "complaint" ? "Réclamation close : rouvrez-la avant d'y ajouter une action." : "Exercice annulé : il ne reçoit plus d'action.");
    site = source.site_id ?? null;
  }
  const a = hsNewAction({ description: "", origin, origin_id: originId, owner_id: ctx.user.id, due_date: TODAY, created_by: ctx.user.id, site_id: site });
  a.expected_evidence = null;
  hsActionValues(a, b);
  hsLog("action", a.id, ctx.user.id, "create");
  return hsActionDetail(ctx, a);
});
route("PATCH", "/hsseq/actions/:id", null, (ctx) => {
  hsInternal(ctx);
  const a = hsActionOf(ctx, ctx.params[0]);
  if (!hsActionDetail(ctx, a).rights.can_edit) throw hsForbidden("Seuls le responsable de l'action et le Responsable HSSEQ la mettent à jour, tant qu'elle n'est ni close ni annulée.");
  if (["owner_id", "due_date", "estimated_cost"].some((k) => k in ctx.body) && !hsIs(ctx, "hsseq")) throw hsForbidden("Responsable, échéance et coût estimé d'une action : réservés au Responsable HSSEQ.");
  const before = a.due_date;
  hsActionValues(a, ctx.body);
  hsLog("action", a.id, ctx.user.id, "write", before !== a.due_date ? "due_date" : null, before !== a.due_date ? before : null, before !== a.due_date ? a.due_date : null);
  return hsActionDetail(ctx, a);
});
route("POST", "/hsseq/actions/:id/:action", null, (ctx) => {
  hsInternal(ctx);
  const action = ctx.params[1];
  if (!["start", "close", "verify", "approve", "cancel", "reopen"].includes(action)) throw notFound("Transition inconnue.");
  const a = hsActionOf(ctx, ctx.params[0]);
  const b = ctx.body;
  const now = hsNow();
  const owner = a.owner_id === ctx.user.id;
  const hs = hsIs(ctx, "hsseq");
  if (["start", "close"].includes(action) && !(owner || hs)) throw hsForbidden("Le responsable de l'action ou le Responsable HSSEQ la démarre et la clôt.");
  if (["verify", "cancel", "reopen"].includes(action) && !hs) throw hsForbidden("Réservé au Responsable HSSEQ.");
  if (action === "approve" && !hsIs(ctx, "direction")) throw hsForbidden("La validation d'une action coûteuse revient à la direction.");
  if (action === "verify" && !("effective" in b)) throw hsMissing("Efficace ou non ?", ["effective"]);
  const permises = { todo: ["start", "cancel", ...(hsNeedsApproval(a) ? ["approve"] : [])], in_progress: ["close", "cancel"], to_verify: ["verify", "cancel"], closed: ["reopen"], cancelled: ["reopen"] }[a.status];
  if (!permises.includes(action)) throw hsRule("invalid_transition", `Transition « ${action} » impossible depuis le statut « ${HS_ACTION_LABELS[a.status]} ».`);
  const before = a.status;
  if (action === "start") {
    if (hsNeedsApproval(a)) throw hsRule("approval_required", "Action coûteuse : la direction la valide avant son démarrage.");
    Object.assign(a, { status: "in_progress", started_at: now });
  } else if (action === "close") {
    if (!HS.attachments.some((x) => x.model === "action" && x.object_id === a.id)) throw hsRule("proof_required", "Joignez au moins une preuve de réalisation avant de clore l'action.");
    a.done_at = now;
    if (hsActionLine(a).verification_required) Object.assign(a, { status: "to_verify", verification_date: addDays(TODAY, hsSettings().verification_days) });
    else Object.assign(a, { status: "closed", closed_at: now });
  } else if (action === "verify") {
    if (a.verification_date && TODAY < a.verification_date) throw hsRule("verification_too_early", `Vérification d'efficacité à partir du ${frDate(a.verification_date)}.`);
    const values = { verified_at: now, verified_by: ctx.user.id, effective: Boolean(b.effective), verification_comment: hsText(b, "comment") };
    if (b.effective) Object.assign(a, values, { status: "closed", closed_at: now });
    else {
      const d = dateArg(b, "new_due_date");
      if (!d) throw hsMissing("Action inefficace : fixez une nouvelle échéance.", ["new_due_date"]);
      Object.assign(a, values, { status: "in_progress", due_date: d, done_at: null, verification_date: null });
    }
  } else if (action === "approve") Object.assign(a, { approved_at: now, approved_by: ctx.user.id, approved_cost: a.estimated_cost });
  else {
    if (!String(b.reason ?? "").trim()) throw hsRule("reason_required", action === "cancel" ? "Le motif de l'annulation est obligatoire." : "Le motif de la réouverture est obligatoire.", { fields: ["reason"] });
    if (action === "cancel") Object.assign(a, { status: "cancelled", cancel_reason: String(b.reason).trim() });
    else Object.assign(a, { status: "in_progress", closed_at: null, reopen_reason: String(b.reason).trim() });
  }
  hsLog("action", a.id, ctx.user.id, action, "status", before, a.status, now, ["cancel", "reopen"].includes(action) ? String(b.reason).trim() : null);
  return hsActionDetail(ctx, a);
});

/* Contrôles : grilles */
route("GET", "/hsseq/checks/templates", [...HS_AUDIT_READ, "conducteur"], (ctx) => {
  const q = ctx.query;
  const active = String(q.active ?? "1").toLowerCase();
  const config = hasProfile(ctx, HS_SETUP);
  return HS.templates.filter((t) => (!q.vehicle_kind || t.vehicle_kind === q.vehicle_kind) && (!q.kind || t.kind === q.kind)
    && (["all", ""].includes(active) || (["0", "false"].includes(active) ? !t.active : t.active))).map((t) => hsTemplateRow(t, config));
});
function hsTemplateValues(t, data) {
  if ("name" in data) t.name = hsText(data, "name", 200) ?? "";
  if ("kind" in data) {
    if (!["pre_departure", "unloading", "mine_site"].includes(data.kind)) throw hsBad("Nature de grille inconnue.", ["kind"]);
    t.kind = data.kind;
  }
  if ("vehicle_kind" in data) {
    if (!["tanker", "tipper"].includes(data.vehicle_kind)) throw hsBad("Type de véhicule inconnu.", ["vehicle_kind"]);
    t.vehicle_kind = data.vehicle_kind;
  }
  if ("active" in data) t.active = Boolean(data.active);
}
function hsItemValues(it) {
  if (!it || typeof it !== "object" || !String(it.label ?? "").trim()) throw hsBad("Chaque point de la grille a un libellé.", ["items"]);
  if (it.linked_to && it.linked_to !== "breath_test") throw hsBad("Seul le formulaire d'alcootest se relie à un point.", ["items"]);
  return { label: String(it.label).trim().slice(0, 300), blocking: Boolean(it.blocking), sequence: Number(it.sequence) || 10, linked_to: it.linked_to || null, active: it.active === undefined ? true : Boolean(it.active) };
}
route("POST", "/hsseq/checks/templates", HS_SETUP, (ctx) => {
  requireFields(ctx.body, "name", "vehicle_kind");
  const t = { id: ++HS.seq.template, name: "", kind: "pre_departure", vehicle_kind: "tanker", version: 1, active: true, items: [], updated_at: hsNow(), updated_by: ctx.user.id };
  hsTemplateValues(t, ctx.body);
  t.items = (ctx.body.items ?? []).map((it) => ({ id: ++HS.seq.item, ...hsItemValues(it) }));
  HS.templates.push(t);
  return hsTemplateRow(t, true);
});
/** Grille et points en une seule version : cités par id mis à jour, nouveaux créés, absents archivés. */
route("PATCH", "/hsseq/checks/templates/:id", HS_SETUP, (ctx) => {
  const t = HS.templates.find((x) => x.id === ctx.params[0]);
  if (!t) throw notFound("Grille introuvable.");
  hsTemplateValues(t, ctx.body);
  if ("items" in ctx.body) {
    const existants = t.items.map((x) => x.id);
    const gardes = new Set();
    for (const it of ctx.body.items ?? []) {
      const values = hsItemValues(it);
      const id = it && typeof it === "object" ? hsId(it, "id") : null;
      if (id) {
        const courant = t.items.find((x) => x.id === id);
        if (!courant) throw businessRule("Point d'une autre grille.");
        Object.assign(courant, values);
        gardes.add(id);
      } else t.items.push({ id: ++HS.seq.item, ...values });
    }
    // Un point retiré s'archive, jamais supprimé : un appareil hors ligne peut encore le répondre sur sa version.
    for (const it of t.items) if (existants.includes(it.id) && !gardes.has(it.id)) it.active = false;
  }
  Object.assign(t, { version: t.version + 1, updated_at: hsNow(), updated_by: ctx.user.id });
  return hsTemplateRow(t, true);
});

/* Contrôles et non-conformités */
route("GET", "/hsseq/checks/nonconformities", HS_AUDIT_READ, (ctx) => {
  const q = ctx.query;
  const statuses = hsList(q.status);
  if (q.sort && !["found_at", "-found_at"].includes(q.sort)) throw hsBad("Tri inconnu.", ["sort"]);
  const list = HS.ncs.filter((n) => hsSiteOk(ctx, n.site_id) && hsFilter(ctx, q, n.site_id, hsKind(hsVehicle(n.vehicle_id)) ?? "none") && (!statuses || statuses.includes(n.status)) && (!["1", "true"].includes(q.blocking) || n.blocking) && (!q.vehicle_id || n.vehicle_id === hsId(q, "vehicle_id")))
    .sort((a, b) => (q.sort === "found_at" ? a.found_at.localeCompare(b.found_at) : b.found_at.localeCompare(a.found_at)) || b.id - a.id);
  return hsPage(ctx, list, { open: list.filter((n) => n.status === "open").length, blocking_open: list.filter((n) => n.status === "open" && n.blocking).length }, (n) => hsNcRow(ctx, n));
});
const HS_CHECK_SORTS = { reported_at: (c) => c.reported_at, result: (c) => c.result, reference: (c) => c.reference };
route("GET", "/hsseq/checks", [...HS_AUDIT_READ, "conducteur"], (ctx) => {
  const q = ctx.query;
  const from = dateArg(q, "date_from");
  const to = dateArg(q, "date_to");
  const results = hsList(q.result);
  const list = hsSort(HS.checks.filter((c) => hsCanSeeCheck(ctx, c) && hsFilter(ctx, q, c.site_id, c.vehicle_kind) && (!from || c.reported_at.slice(0, 10) >= from) && (!to || c.reported_at.slice(0, 10) <= to)
    && ["vehicle_id", "rotation_id", "driver_id"].every((k) => !q[k] || c[k] === hsId(q, k)) && (!results || results.includes(c.result))), q.sort, HS_CHECK_SORTS, "-reported_at");
  const byResult = { compliant: 0, non_compliant: 0, blocking: 0, incomplete: 0 };
  for (const c of list) byResult[c.result]++;
  const counts = { by_result: byResult };
  if (hsScope(ctx) !== "self") {
    // Départs de la période (rotations parties, validées ou facturées), mois courant par défaut.
    const departures = [];
    for (let d = from ?? `${TODAY.slice(0, 7)}-01`; d <= (to ?? TODAY) && d <= TODAY; d = addDays(d, 1)) {
      for (const r of hsDepartureRotations(d)) {
        const v = hsVehicle(r.vehicle_id);
        if (v && ["en_route", "done", "invoiced"].includes(r.state) && (!q.site_id || hsVehicleSite(v) === Number(q.site_id)) && hsSiteOk(ctx, hsVehicleSite(v))) departures.push(r);
      }
    }
    Object.assign(counts, { departures: departures.length, departures_checked: departures.filter((r) => HS.checks.some((c) => c.rotation_id === r.id && c.kind === "pre_departure")).length });
  }
  return hsPage(ctx, list, counts, (c) => hsMasquer(ctx, hsCheckLine(c)));
});
function hsCheckOf(ctx, id) {
  const c = HS.checks.find((x) => x.id === id);
  if (!c || !hsCanSeeCheck(ctx, c)) throw notFound("Contrôle introuvable.");
  return c;
}
route("GET", "/hsseq/checks/:id", [...HS_AUDIT_READ, "conducteur"], (ctx) => hsMasquer(ctx, hsCheckDetail(ctx, hsCheckOf(ctx, ctx.params[0]))));
route("POST", "/hsseq/checks", HS_FIELD, (ctx) => {
  const b = ctx.body;
  requireFields(b, "template_id", "answers");
  const existing = hsExisting(ctx, HS.checks, b.client_uuid, (x) => x.performed_by);
  if (existing) return hsCheckDetail(ctx, existing);
  const t = HS.templates.find((x) => x.id === hsId(b, "template_id"));
  if (!t || !t.active) throw hsRule("business_rule", "Grille inconnue ou retirée.", { fields: ["template_id"] });
  const rotId = hsId(b, "rotation_id");
  const rot = rotId ? hsRotation(rotId) : null;
  if (rotId && !rot) throw notFound("Rotation introuvable.");
  const vehicleId = hsId(b, "vehicle_id");
  const v = rot ? hsVehicle(rot.vehicle_id) : vehicleId ? hsVehicle(vehicleId) : null;
  if (vehicleId && !rot && !v) throw notFound("Ensemble introuvable.");
  if (!v) throw hsMissing("Rotation ou ensemble à contrôler manquant.", ["vehicle_id"]);
  if (rot && vehicleId && vehicleId !== rot.vehicle_id) throw hsRule("business_rule", "L'ensemble n'est pas celui de la rotation.", { fields: ["vehicle_id"] });
  let driverId = hsId(b, "driver_id") ?? rot?.driver_id ?? v.driver_id ?? null;
  const scope = hsScope(ctx);
  if (scope === "self") {
    const mine = hsMyDriver(ctx);
    const conduit = rot ? rot.driver_id === mine : v.driver_id === mine || [...DB.rotations, ...HS.rotations].some((r) => r.vehicle_id === v.id && r.driver_id === mine && ["draft", "en_route"].includes(r.state));
    if (!mine || !conduit) throw hsForbidden("Un conducteur ne contrôle que l'ensemble de ses propres rotations.");
    driverId = mine;
  } else if (scope === "site" && !hsSiteOk(ctx, hsVehicleSite(v))) throw hsForbidden("Ensemble d'un autre site.");
  if (!Array.isArray(b.answers)) throw hsBad("Réponse sans point.", ["answers"]);
  for (const a of b.answers) {
    if (!a || !a.item_id) throw hsBad("Réponse sans point.", ["answers"]);
    if (!["ok", "not_ok", "na"].includes(a.answer)) throw hsBad("Réponse : ok, not_ok ou na.", ["answers"]);
    if (!t.items.some((it) => it.id === Number(a.item_id))) throw hsBad(`Point ${a.item_id} absent de la grille.`, ["answers"]);
  }
  if (hsKind(v) !== t.vehicle_kind) throw hsRule("vehicle_kind_mismatch", `La grille « ${t.name} » vaut pour un autre type de véhicule que ${v.name}.`, { fields: ["template_id"] });
  const version = hsId(b, "template_version") ?? t.version;
  if (version < 1 || version > t.version) throw hsBad(`Version ${version} inconnue pour la grille « ${t.name} ».`, ["template_version"]);
  const given = new Map(b.answers.map((a) => [Number(a.item_id), a]));
  const missing = t.items.filter((it) => it.active !== false && !it.linked_to && !given.has(it.id)).map((it) => it.id);
  if (missing.length) throw hsRule("incomplete_answers", "Chaque point de la grille attend sa réponse.", { fields: missing });
  const lat = hsNum(b.latitude, "latitude");
  const lon = hsNum(b.longitude, "longitude");
  const c = hsCreateCheck({
    template: t, template_version: version, vehicle_id: v.id, rotation_id: rot?.id ?? null, driver_id: driverId, performed_by: ctx.user.id, reported_at: hsReportedAt(b), synced_at: hsNow(), offline: Boolean(b.offline),
    client_uuid: b.client_uuid ? String(b.client_uuid).slice(0, 64) : null, duration_s: b.duration_s ? Math.trunc(Number(b.duration_s)) : null, latitude: lat, longitude: lon, gps_accuracy: lat === null ? null : hsNum(b.gps_accuracy, "gps_accuracy"),
    answers: b.answers.map((a) => ({ item_id: Number(a.item_id), answer: a.answer, comment: hsText(a, "comment", 1000) })),
  });
  // Photos déposées avant la fiche : rattachées à la non-conformité de leur point (au contrôle sinon).
  for (const a of b.answers) {
    const ids = hsIds(a, "attachment_ids");
    const n = HS.ncs.find((x) => x.check_id === c.id && x.item_id === Number(a.item_id));
    if (ids.length) hsClaim(ctx, ids, n ? "nonconformity" : "check", n ? n.id : c.id, "photo");
  }
  hsClaim(ctx, hsIds(b, "attachment_ids"), "check", c.id);
  if (b.signature) {
    const brut = String(b.signature).startsWith("data:") ? String(b.signature).split(",", 2)[1] ?? "" : String(b.signature);
    if (!/^[A-Za-z0-9+/=\s]+$/.test(brut)) throw hsBad("Signature illisible.", ["signature"]);
    const data = Buffer.from(brut, "base64");
    const type = detectType(data);
    if (data.length > 512 * 1024 || !["image/png", "image/jpeg"].includes(type)) throw new ApiError(415, "unsupported_type", "Signature : image PNG ou JPEG de 512 Ko au plus.", { fields: ["signature"] });
    hsAttach("check", c.id, ctx.user.id, checkedName("signature", type), type, data, { role: "signature" });
  }
  hsLog("check", c.id, ctx.user.id, "create", "result", null, c.result);
  return hsCheckDetail(ctx, c);
});
route("POST", "/hsseq/checks/:id/lift", ["admin", "hsseq", "exploitation"], (ctx) => {
  const c = hsCheckOf(ctx, ctx.params[0]);
  requireFields(ctx.body, "nonconformity_id");
  const n = HS.ncs.find((x) => x.id === hsId(ctx.body, "nonconformity_id") && x.check_id === c.id);
  if (!n) throw notFound("Non-conformité introuvable sur ce contrôle.");
  if (n.status === "open" && !hsCanLift(ctx, n)) throw hsForbidden("Levée réservée au chef de parc du site, au Responsable HSSEQ et à l'administration.");
  if (n.status !== "open") throw hsRule("invalid_transition", "Cette non-conformité est déjà levée.");
  const pieces = hsClaim(ctx, hsIds(ctx.body, "attachment_ids"), "nonconformity", n.id);
  if (!pieces.some((a) => a.is_photo)) throw hsRule("photo_missing", "La levée exige au moins une photo de la correction, déposée sur la non-conformité.", { fields: ["attachment_ids"] });
  for (const a of pieces) a.role = "lift";
  Object.assign(n, { status: "lifted", lifted_at: hsNow(), lifted_by: ctx.user.id, lift_comment: hsText(ctx.body, "comment", 2000) });
  hsLog("nonconformity", n.id, ctx.user.id, "lift", "status", "open", "lifted");
  return hsCheckDetail(ctx, c);
});

/* Alcootests (§9.4) */
function hsTestOf(ctx, id) {
  const t = HS.tests.find((x) => x.id === id);
  if (!t || !hsCanSeeTest(ctx, t)) throw notFound("Alcootest introuvable.");
  return t;
}
route("GET", "/hsseq/breath-tests", [...HS_READ, "conducteur"], (ctx) => {
  const q = ctx.query;
  const date = dateArg(q, "date");
  const from = dateArg(q, "date_from");
  const to = dateArg(q, "date_to");
  const access = hsTestAccess(ctx);
  if (q.status && access === "done") throw hsForbidden("Le statut d'un alcootest n'est pas lisible par le conducteur.");
  const statuses = hsList(q.status);
  const annules = hsIs(ctx, "hsseq") && ["1", "true"].includes(String(q.cancelled ?? "").toLowerCase());
  if (q.sort && !["reported_at", "-reported_at", "date", "-date"].includes(q.sort)) throw hsBad("Tri inconnu.", ["sort"]);
  const list = HS.tests.filter((t) => {
    const day = t.reported_at.slice(0, 10);
    return (annules ? t.active === false : t.active !== false) && hsCanSeeTest(ctx, t) && (!q.company_id || Number(q.company_id) === 1) && (!q.site_id || hsTestSite(t) === Number(q.site_id))
      && (!date || day === date) && (!from || day >= from) && (!to || day <= to) && (!q.rotation_id || t.rotation_id === hsId(q, "rotation_id")) && (!q.driver_id || t.driver_id === hsId(q, "driver_id"))
      && (!statuses || statuses.includes(hsTestStatus(t)))
      // Profil de l'ensemble de la rotation du test : un test pas encore rattaché n'en a pas.
      && (!q.vehicle_kind || hsKind(hsVehicle(hsRotation(t.rotation_id)?.vehicle_id)) === q.vehicle_kind);
  }).sort((a, b) => (["reported_at", "date"].includes(q.sort) ? a.reported_at.localeCompare(b.reported_at) : b.reported_at.localeCompare(a.reported_at)) || b.id - a.id);
  const counts = access === "done" ? {} : { by_status: { compliant: 0, non_compliant: 0, not_done: 0 } };
  if (counts.by_status) for (const t of list) counts.by_status[hsTestStatus(t)]++;
  if (access === "detail") for (const t of list.slice(offsetOf(q), offsetOf(q) + limitOf(q, 50, 500))) hsLog("breath_test", t.id, ctx.user.id, "read_detail");
  return hsPage(ctx, list, counts, (t) => hsTestRow(ctx, t));
});
route("GET", "/hsseq/breath-tests/:id", [...HS_READ, "conducteur"], (ctx) => {
  const t = hsTestOf(ctx, ctx.params[0]);
  if (hsIs(ctx, "hsseq")) hsLog("breath_test", t.id, ctx.user.id, "read_detail");
  return hsTestRow(ctx, t);
});
route("POST", "/hsseq/breath-tests", HS_FIELD, (ctx) => {
  const b = ctx.body;
  const existing = hsExisting(ctx, HS.tests, b.client_uuid, (x) => x.performed_by);
  if (existing) return hsTestRow(ctx, existing);
  const rotId = hsId(b, "rotation_id");
  const rot = rotId ? hsRotation(rotId) : null;
  if (rotId && !rot) throw notFound("Rotation introuvable.");
  let driverId = hsId(b, "driver_id");
  if (hsScope(ctx) === "self") {
    const mine = hsMyDriver(ctx);
    if (!mine || (driverId && driverId !== mine) || (rot && rot.driver_id !== mine)) throw hsForbidden("Un conducteur ne saisit un alcootest que pour lui-même, sur sa rotation.");
    driverId = mine;
  } else {
    if (driverId && !hsDriver(driverId)) throw notFound("Conducteur introuvable.");
    driverId = driverId ?? rot?.driver_id ?? null;
    if (hsScope(ctx) === "site" && rot && !hsSiteOk(ctx, hsVehicleSite(hsVehicle(rot.vehicle_id)))) throw hsForbidden("Rotation d'un autre site.");
  }
  if (!driverId) throw hsMissing("Conducteur du test manquant.", ["driver_id"]);
  if (rot && rot.state !== "draft") throw hsRule("invalid_transition", "L'alcootest se fait avant le départ de la rotation.");
  const performed = Boolean(b.performed);
  if (performed && !["negative", "positive"].includes(b.result)) throw hsMissing("Résultat de l'alcootest réalisé manquant (negative ou positive).", ["result"]);
  if (!performed && !hsText(b, "not_done_reason", 300)) throw hsMissing("Motif de l'alcootest non réalisé manquant.", ["not_done_reason"]);
  const t = {
    id: ++HS.seq.test, rotation_id: rot?.id ?? null, driver_id: driverId, performed, result: performed ? b.result : null, reading_mg_l: performed ? hsNum(b.reading_mg_l, "reading_mg_l") ?? 0 : 0,
    device: hsText(b, "device", 120), not_done_reason: performed ? null : hsText(b, "not_done_reason", 300), performed_by: ctx.user.id, driver_removed: false,
    client_uuid: b.client_uuid ? String(b.client_uuid).slice(0, 64) : null, reported_at: hsReportedAt(b), synced_at: hsNow(), offline: Boolean(b.offline), active: true,
  };
  HS.tests.push(t);
  hsLog("breath_test", t.id, ctx.user.id, "create");
  if (rot) hsRemoveDriver(t, rot);
  // La réponse à une saisie suit la règle de lecture, y compris pour qui a saisi.
  return hsTestRow(ctx, t);
});
route("POST", "/hsseq/breath-tests/:id/cancel", ["hsseq"], (ctx) => {
  const t = HS.tests.find((x) => x.id === ctx.params[0]);
  if (!t) throw notFound("Alcootest introuvable.");
  if (t.active === false) throw hsRule("invalid_transition", "Cet alcootest est déjà annulé.");
  const reason = hsText(ctx.body, "reason", 2000);
  if (!reason) throw hsRule("reason_required", "Le motif de l'annulation est obligatoire.", { fields: ["reason"] });
  const before = hsTestStatus(t);
  Object.assign(t, { active: false, cancel_reason: reason, cancelled_by: ctx.user.id, cancelled_at: hsNow() });
  hsLog("breath_test", t.id, ctx.user.id, "cancel", "status", before, "cancelled", hsNow(), reason);
  // Conducteur retiré par un positif : rétabli sur la rotation encore saisie, si elle n'en a pas reçu un autre.
  const rot = hsRotation(t.rotation_id);
  if (t.driver_removed && rot && rot.state === "draft" && !rot.driver_id) {
    rot.driver_id = t.driver_id;
    hsLog("breath_test", t.id, ctx.user.id, "driver_restored", null, null, null, hsNow(), `Conducteur rétabli sur la rotation ${rot.name ?? rot.id}`);
  }
  return hsTestRow(ctx, t);
});

/* Verrou */
/** Le conducteur n'évalue que ses rotations, le chef de parc celles de ses sites. */
function hsRotationAllowed(ctx, rot) {
  const scope = hsScope(ctx);
  if (scope === "all") return true;
  if (scope === "site") return hsSiteOk(ctx, hsVehicleSite(hsVehicle(rot.vehicle_id)));
  return hsMyDriver(ctx) !== null && rot.driver_id === hsMyDriver(ctx);
}
route("POST", "/hsseq/lock/evaluate", ["admin", "direction", "hsseq", "exploitation", "conducteur"], (ctx) => {
  requireFields(ctx.body, "rotation_id");
  const rot = hsRotation(hsId(ctx.body, "rotation_id"));
  if (!rot || !hsRotationAllowed(ctx, rot)) throw notFound("Rotation introuvable.");
  return hsEvaluate(ctx, rot);
});
/** Rotations du jour (saisies ou en route) : le conducteur les siennes, le chef de parc celles de ses sites, hsseq et l'administration toutes. */
/**
 * Rotations chargées ou en cours à une date (aujourd'hui par défaut), tous états, d'un ensemble
 * (vehicle_id) ou de tous : rattacher un événement à une rotation, même partie ou terminée. Conducteur :
 * ses propres rotations ; hors lecture complète, les ensembles des sites du compte.
 */
route("GET", "/hsseq/rotations", ["admin", "direction", "hsseq", "exploitation", "conducteur"], (ctx) => {
  const q = ctx.query;
  const day = dateArg(q, "date") ?? TODAY;
  const vehicleId = q.vehicle_id ? hsId(q, "vehicle_id") : null;
  if (vehicleId && !hsVehicle(vehicleId)) throw notFound("Ensemble introuvable.");
  const self = hsScope(ctx) === "self";
  const mine = hsMyDriver(ctx);
  const enCours = (r) => r.date_loading === day || (r.date_loading < day && (r.state === "en_route" || (r.date_delivery ?? r.date_loading) >= day));
  const items = [...DB.rotations.filter((r) => r.company_id === 1), ...HS.rotations]
    .filter((r) => r.state !== "cancelled" && enCours(r) && (!vehicleId || r.vehicle_id === vehicleId))
    .filter((r) => (self ? Boolean(mine) && r.driver_id === mine : hsSiteOk(ctx, hsVehicleSite(hsVehicle(r.vehicle_id)))))
    .sort((a, b) => b.date_loading.localeCompare(a.date_loading) || b.id - a.id)
    .slice(0, 200);
  return {
    date: day,
    items: items.map((r) => ({
      ...hsRotationRef(r), vehicle: hsVehicleRef(r.vehicle_id), driver: hsDriverRef(r.driver_id), site: hsSiteRef(hsVehicleSite(hsVehicle(r.vehicle_id))),
      departed_at: r.departed_at ?? null, date_delivery: r.date_delivery ?? null, date_return: r.date_return ?? null,
    })),
  };
});
route("GET", "/hsseq/me/rotations", ["admin", "hsseq", "exploitation", "conducteur"], (ctx) => {
  const day = dateArg(ctx.query, "date", TODAY);
  const items = hsDepartureRotations(day)
    .filter((r) => ["draft", "en_route"].includes(r.state) && hsRotationAllowed(ctx, r))
    .sort((a, b) => a.date_loading.localeCompare(b.date_loading) || a.id - b.id)
    .map((r) => {
      const e = r.state === "draft" ? hsEvaluate(ctx, r) : null;
      return {
        id: r.id, name: r.name, date_loading: r.date_loading, state: r.state, vehicle: hsVehicleRef(r.vehicle_id), site: hsSiteRef(hsVehicleSite(hsVehicle(r.vehicle_id))),
        driver: hsDriverRef(r.driver_id), route_name: hsRouteName(r),
        lock: e ? { allowed: e.allowed, pending_checks_only: e.pending_checks_only, reasons: e.reasons, warnings: e.warnings, lock_active: e.lock_active } : null,
      };
    });
  return { date: day, items };
});
route("GET", "/hsseq/lock/departures", HS_READ, (ctx) => {
  const day = dateArg(ctx.query, "date", TODAY);
  if (ctx.query.site_id && !hsSiteOk(ctx, Number(ctx.query.site_id))) throw hsForbidden("Site non autorisé.");
  return hsDepartures(ctx, day, ctx.query);
});
const hsReasonRow = (r) => ({ ...r, disabled_sites: r.disabled_sites.map(hsSiteRef).filter(Boolean) });
route("GET", "/hsseq/lock/reasons", HS_AUDIT_READ, () => HS.reasons.map(hsReasonRow));
route("PATCH", "/hsseq/lock/reasons", HS_SETUP, (ctx) => {
  const [code] = requireFields(ctx.body, "code");
  const s = hsReasonSetting(code);
  if (!s) throw notFound("Motif inconnu.");
  const b = ctx.body;
  // Lot courant : 2 (CURRENT_LOT du noyau) ; les motifs V06 à V09, livrés désactivés, s'activent.
  if ("active" in b && b.active && s.lot > 2) throw hsRule("not_in_lot_1", `Le motif ${code} relève du lot ${s.lot} : il n'est pas encore évalué.`, { fields: ["active"] });
  if ("vehicle_kinds" in b && (!Array.isArray(b.vehicle_kinds ?? []) || (b.vehicle_kinds ?? []).some((k) => !["tanker", "tipper"].includes(k)))) throw hsBad("Types de véhicule : tanker, tipper.", ["vehicle_kinds"]);
  if ("waivable" in b && Boolean(b.waivable) !== s.waivable) throw hsRule("business_rule", "Le caractère dérogeable d'un motif ne se modifie pas.", { fields: ["waivable"] });
  if ("active" in b) s.active = Boolean(b.active);
  if ("vehicle_kinds" in b) s.vehicle_kinds = [...new Set(b.vehicle_kinds ?? [])];
  if ("disabled_sites" in b) s.disabled_sites = hsIds({ ids: (b.disabled_sites ?? []).map((x) => (x && typeof x === "object" ? x.id : x)) }, "ids").filter((id) => hsSite(id));
  hsLog("lock_reason", HS.reasons.indexOf(s) + 1, ctx.user.id, "write", null, null, null, hsNow(), code);
  return hsReasonRow(s);
});

/* Dérogations (§4.1) : une rotation, un seul motif */
function hsWaiverOf(ctx, id) {
  const w = HS.waivers.find((x) => x.id === id);
  if (!w || !hsCanSeeWaiver(ctx, w)) throw notFound("Dérogation introuvable.");
  return w;
}
const HS_WAIVER_SORTS = { requested_at: (w) => w.requested_at, status: (w) => w.status, reference: (w) => w.reference };
route("GET", "/hsseq/waivers", HS_AUDIT_READ, (ctx) => {
  const q = ctx.query;
  hsExpireWaivers();
  const statuses = hsList(q.status);
  const from = dateArg(q, "date_from");
  const to = dateArg(q, "date_to");
  const base = HS.waivers.filter((w) => hsCanSeeWaiver(ctx, w) && (!q.company_id || Number(q.company_id) === 1) && (!q.site_id || w.site_id === hsId(q, "site_id")) && (!q.reason_code || w.reason_code === q.reason_code)
    && (!q.rotation_id || w.rotation_id === hsId(q, "rotation_id")) && (!from || w.requested_at.slice(0, 10) >= from) && (!to || w.requested_at.slice(0, 10) <= to));
  const list = hsSort(base.filter((w) => !statuses || statuses.includes(w.status)), q.sort, HS_WAIVER_SORTS, "-requested_at");
  const byStatus = { pending_hsseq: 0, active: 0, expired: 0, refused: 0, cancelled: 0 };
  for (const w of list) byStatus[w.status]++;
  return hsPage(ctx, list, { by_status: byStatus }, (w) => hsWaiverRow(ctx, w));
});
route("GET", "/hsseq/waivers/:id", HS_AUDIT_READ, (ctx) => hsWaiverRow(ctx, hsWaiverOf(ctx, ctx.params[0])));
route("POST", "/hsseq/waivers", ["exploitation"], (ctx) => {
  const [rotationId, code] = requireFields(ctx.body, "rotation_id", "reason_code");
  const rot = hsRotation(Number(rotationId));
  if (!rot) throw notFound("Rotation introuvable.");
  const v = hsVehicle(rot.vehicle_id);
  if (!hsSiteOk(ctx, hsVehicleSite(v))) throw hsForbidden("Rotation d'un autre site.");
  const reason = String(code).toUpperCase();
  if (HS_NOT_WAIVABLE.includes(reason)) throw hsRule("not_waivable", `Le motif ${reason} n'est jamais dérogeable.`, { fields: ["reason_code"] });
  const justification = hsText(ctx.body, "justification", 4000);
  if (!justification) throw hsRule("reason_required", "La justification écrite est obligatoire.", { fields: ["justification"] });
  if (rot.state !== "draft") throw hsRule("invalid_transition", "Seule une rotation pas encore partie reçoit une dérogation.");
  if (!hsReasons(ctx, rot, false).reasons.some((r) => r.code === reason)) throw hsRule("reason_not_open", `Le motif ${reason} n'est pas ouvert pour cette rotation.`, { fields: ["reason_code"] });
  const deja = HS.waivers.find((w) => w.rotation_id === rot.id && w.reason_code === reason && ["pending_hsseq", "active"].includes(w.status));
  if (deja) throw new ApiError(409, "conflict", `Dérogation ${deja.reference} déjà en cours pour ce motif.`);
  const at = hsNow();
  const w = { id: ++HS.seq.waiver, reference: "", rotation_id: rot.id, vehicle_id: v.id, site_id: hsVehicleSite(v), reason_code: reason, justification, requested_by: ctx.user.id, requested_at: at, approvals: [{ level: 1, role: "yard_manager", by: ctx.user.id, at }], status: "pending_hsseq", expires: null, expired_at: null, refusal_reason: null, decided_by: null, management_notified_at: null };
  w.reference = `DER/2026/${pad(w.id, 4)}`;
  HS.waivers.push(w);
  hsLog("waiver", w.id, ctx.user.id, "create");
  hsNotify(hsHsseqManagers().filter((id) => id !== ctx.user.id), "waiver_requested", `Dérogation à valider : ${reason}, rotation ${rot.name ?? rot.id}`, `${w.reference} demandée par ${ctx.user.name} :\n${justification}`, "waiver", w.id, at);
  return hsWaiverRow(ctx, w);
});
/** Quatre yeux : ni le demandeur ni un compte qui a déjà validé ne tranche la seconde validation. */
function hsFourEyes(ctx, w) {
  if (w.approvals.some((a) => a.by === ctx.user.id)) throw hsRule("four_eyes", "La seconde validation revient à une autre personne que le demandeur.");
}
function hsWaiverRequire(w, transition) {
  const permises = { pending_hsseq: ["approve", "refuse", "cancel"], active: ["cancel"] }[w.status] ?? [];
  if (!permises.includes(transition)) throw hsRule("invalid_transition", `Transition « ${transition} » impossible depuis le statut de la dérogation.`);
}
route("POST", "/hsseq/waivers/:id/approve", ["hsseq"], (ctx) => {
  const w = hsWaiverOf(ctx, ctx.params[0]);
  hsExpireWaivers();
  hsWaiverRequire(w, "approve");
  hsFourEyes(ctx, w);
  const rot = hsRotation(w.rotation_id);
  if (["done", "invoiced", "cancelled"].includes(rot.state)) throw hsRule("invalid_transition", "La rotation est terminée : la dérogation n'a plus d'objet.");
  const at = hsNow();
  w.approvals.push({ level: 2, role: "hsseq_manager", by: ctx.user.id, at });
  Object.assign(w, { status: "active", expires: hsRotationEnd(rot), management_notified_at: at });
  hsLog("waiver", w.id, ctx.user.id, "approve", "status", "pending_hsseq", "active");
  hsNotify(hsDirectors(), "waiver_active", `Dérogation au verrou : ${w.reason_code}, rotation ${rot.name ?? rot.id}`, `${w.reference}, demandée par ${userName(w.requested_by)}, validée par ${ctx.user.name}.\nJustification : ${w.justification}`, "waiver", w.id, at);
  return hsWaiverRow(ctx, w);
});
route("POST", "/hsseq/waivers/:id/refuse", ["hsseq"], (ctx) => {
  const w = hsWaiverOf(ctx, ctx.params[0]);
  hsWaiverRequire(w, "refuse");
  hsFourEyes(ctx, w);
  const reason = hsText(ctx.body, "reason", 2000);
  if (!reason) throw hsRule("reason_required", "Le motif du refus est obligatoire.", { fields: ["reason"] });
  Object.assign(w, { status: "refused", refusal_reason: reason, decided_by: ctx.user.id });
  hsLog("waiver", w.id, ctx.user.id, "refuse", "status", "pending_hsseq", "refused", hsNow(), reason);
  return hsWaiverRow(ctx, w);
});
route("POST", "/hsseq/waivers/:id/cancel", ["hsseq", "exploitation"], (ctx) => {
  const w = hsWaiverOf(ctx, ctx.params[0]);
  if (!(hsIs(ctx, "hsseq") || w.requested_by === ctx.user.id)) throw hsForbidden("Seuls le demandeur et le Responsable HSSEQ annulent une dérogation.");
  hsExpireWaivers();
  hsWaiverRequire(w, "cancel");
  const before = w.status;
  Object.assign(w, { status: "cancelled", decided_by: ctx.user.id });
  hsLog("waiver", w.id, ctx.user.id, "cancel", "status", before, "cancelled");
  return hsWaiverRow(ctx, w);
});

/* Pièces jointes */
const HS_ATTACH_MODELS = {
  event: (ctx, id) => hsEventOf(ctx, id), action: (ctx, id) => hsActionOf(ctx, id), check: (ctx, id) => hsCheckOf(ctx, id), waiver: (ctx, id) => hsWaiverOf(ctx, id),
  nonconformity: (ctx, id) => {
    const n = HS.ncs.find((x) => x.id === id);
    if (!n) throw notFound("Fiche introuvable.");
    hsCheckOf(ctx, n.check_id);
    return n;
  },
};
/** Fiche close : plus de pièce ajoutée ni retirée. */
const hsClosed = (model, r) => ({ event: r.status === "closed", action: ["closed", "cancelled"].includes(r.status), nonconformity: r.status !== "open", waiver: !["pending_hsseq", "active"].includes(r.status), risk: r.status === "archived",
  audit: ["closed", "cancelled"].includes(r.status), finding: ["closed", "cancelled"].includes((DB.hsseq.audits ?? []).find((x) => x.id === r.audit_id)?.status),
  review: r.state === "closed", procedure_version: r.status !== "draft", drill: r.status === "cancelled",
  spill: r.status === "closed", waste: r.status === "collected", contamination: r.status === "closed", complaint: r.status === "closed" })[model] ?? false;
/**
 * Ajouter une pièce : son auteur ou responsable, le chef de parc du site, ou hsseq. La photo de levée
 * d'une non-conformité suit le droit de la levée ; une revue de direction reçoit aussi les pièces de la
 * direction.
 */
function hsCanAttach(ctx, model, r, role = null) {
  if (hsClosed(model, r)) return false;
  if (model === "nonconformity" && role === "lift") return hsCanLift(ctx, r);
  if (hsIs(ctx, "hsseq")) return true;
  if (model === "review") return hsIs(ctx, "direction");
  const yard = hsScope(ctx) === "site";
  if (model === "event") return r.reported_by === ctx.user.id || (yard && hsSiteOk(ctx, r.site_id));
  if (model === "action") return r.owner_id === ctx.user.id;
  // Risque (lot 2) : son propriétaire, en plus de hsseq.
  if (model === "risk") return r.owner_id === ctx.user.id;
  if (model === "check") return r.performed_by === ctx.user.id || (yard && hsSiteOk(ctx, r.site_id));
  if (model === "nonconformity") return HS.checks.find((c) => c.id === r.check_id)?.performed_by === ctx.user.id || (yard && hsSiteOk(ctx, r.site_id));
  // Déversement et déchet (lot 3) : le chef de parc du site, comme pour leur saisie.
  if (model === "spill" || model === "waste") return hsIs(ctx, "exploitation") && hsSiteOk(ctx, r.site_id);
  return model === "waiver" && r.requested_by === ctx.user.id;
}
route("POST", "/hsseq/attachments", null, (ctx) => {
  hsInternal(ctx);
  const fields = ctx.multipart().fields;
  const existing = hsExisting(ctx, HS.attachments, fields.client_uuid, (x) => x.created_by);
  if (existing) return hsAttachmentRow(existing);
  const model = fields.model || fields.object || null;
  let record = null;
  let id = null;
  if (model) {
    if (!(model in HS_ATTACH_MODELS)) throw hsBad("Fiche inconnue.", ["model"]);
    id = Number.parseInt(fields.id || fields.object_id || "", 10);
    if (!Number.isFinite(id)) throw hsBad("Identifiant invalide.");
    record = HS_ATTACH_MODELS[model](ctx, id);
    if (!hsCanAttach(ctx, model, record, fields.role ?? null)) throw hsForbidden("Pièce jointe non autorisée sur cette fiche.");
    if (HS.attachments.filter((a) => a.model === model && a.object_id === id).length >= 30) throw businessRule("30 pièces au plus par fiche.");
  } else if (!hasProfile(ctx, ["admin", "direction", "hsseq", "exploitation", "conducteur"])) throw hsForbidden("Dépôt sans fiche réservé aux profils de NIMOVA · HSSEQ.");
  const file = uploadedFile(ctx, 8 * 1048576, "Fichier");
  const mimetype = detectType(file.data);
  if (!["image/jpeg", "image/png", "application/pdf"].includes(mimetype)) throw new ApiError(415, "unsupported_type", "Formats acceptés : JPEG, PNG ou PDF.");
  // Preuve (action, risque, audit, constat, exigence, exercice), document (déchet, version de procédure, plan, revue, réclamation), sinon photo.
  const role = ["action", "risk", "audit", "finding", "requirement", "drill"].includes(model) ? "evidence"
    : ["waste", "procedure_version", "emergency_plan", "review", "complaint"].includes(model) ? "document"
    : model === "nonconformity" && record.status === "open" && fields.role === "lift" ? "lift" : "photo";
  const a = hsAttach(model, id, ctx.user.id, checkedName(file.filename, mimetype, "photo"), mimetype, file.data, { caption: fields.caption ? String(fields.caption).slice(0, 300) : null, client_uuid: fields.client_uuid || null, role });
  return hsAttachmentRow(a);
});
function hsAttachmentOf(ctx, id) {
  const a = HS.attachments.find((x) => x.id === id);
  if (!a) throw notFound("Pièce jointe introuvable.");
  if (!a.model) {
    if (a.created_by !== ctx.user.id) throw notFound("Pièce jointe introuvable.");
    return { a, record: null };
  }
  try {
    return { a, record: HS_ATTACH_MODELS[a.model](ctx, a.object_id) };
  } catch {
    throw notFound("Pièce jointe introuvable.");
  }
}
route("GET", "/hsseq/attachments/:id/download", null, (ctx) => {
  hsInternal(ctx);
  const { a } = hsAttachmentOf(ctx, ctx.params[0]);
  return fileReply(HS.files.get(a.id), a.mimetype, a.name);
});
route("DELETE", "/hsseq/attachments/:id", null, (ctx) => {
  hsInternal(ctx);
  const { a, record } = hsAttachmentOf(ctx, ctx.params[0]);
  if (a.created_by !== ctx.user.id && !hsIs(ctx, "hsseq")) throw hsForbidden("Seuls son auteur et le Responsable HSSEQ retirent une pièce.");
  if (record && hsClosed(a.model, record)) throw hsRule("invalid_transition", "Fiche close : la pièce ne se retire plus.");
  if (a.role === "lift" || (a.model === "action" && record?.status === "to_verify")) throw hsRule("invalid_transition", "Pièce probante d'une levée ou d'une réalisation : conservée.");
  if (record) hsLog(a.model, a.object_id, ctx.user.id, "attachment_removed", null, null, null, hsNow(), a.name);
  HS.attachments = HS.attachments.filter((x) => x.id !== a.id);
  HS.files.delete(a.id);
  return { status: "ok" };
});

/* ─── NIMOVA · HSSEQ, lot 2 (routes dans hsseq-*.mjs) ─────────────────────── */

/**
 * Références passées aux modules du lot 2 : outils généraux, puis toutes les constantes et fonctions de
 * la section HSSEQ ci-dessus (portée, droits, pages, historique, pièces jointes, notifications…). Les
 * modules s'enregistrent après seed(), quand DB.hsseq porte déjà les tables du lot 1.
 */
const HS_REFS = {
  route, reply, fileReply, xlsxBuffer, ApiError, DB, USERS, TODAY, COMPANIES, hasProfile, intArg, limitOf, offsetOf,
  TR_READ, HS_READ, HS_APP, HS_EVENT_READ, HS_FIELD, HS_SETUP, HS_ALL, HS_SETTINGS_DEFAUT, HS_SETTINGS_DATES,
  HS_SETTINGS_NOMBRES, HS_TARGETS, HS_USER_SITES, HS_EMPLOYEES, HS_PNG, HS_REASONS, HS_NOT_WAIVABLE, HS_TYPES,
  HS_TYPE_LABELS, HS_STATUS_LABELS, HS_ACTION_LABELS, HS_LEVEL_LABELS, HS_DOMAINS, HS_DOC_LABELS, HS_COST_KINDS,
  HS_CONTROL_LEVELS, HS_ORIGINS, HS_FACTORS, HS_METHODS, HS_PROOFS, hsNow, hsAddMinutes, hsSettings, hsThresholds,
  hsInvestigationMinutes, hsLevel, hsLevelMethod, hsUser, hsVehicle, hsVehicleByName, hsKind, hsVehicleSite,
  hsVehicleRef, hsDriver, hsDriverRef, hsRotation, hsRouteName, hsRotationRef, hsSite, hsSiteRef, hsRotationEnd,
  hsRotationAt, hsDepartureRotations, hsLockActive, hsIs, hsFull, hsScope, hsSites, hsPersonalHidden, hsAuditorGuard,
  hsSiteOk, hsEmployee, hsMyDriver, hsCanSeeEvent, hsCanSeeAction, hsCanSeeCheck, hsCanLift, hsForbidden, hsRule,
  hsMissing, hsBad, hsNum, hsId, hsFilter, hsPage, hsLog, hsHistoryRow, hsHistory, hsAttach, hsPhoto,
  hsAttachmentRow, hsAttachments, hsClaim, hsIds, hsExisting, hsNotify, hsNotificationRow, hsDirectors,
  hsHsseqManagers, hsTemplateRow, hsCreateCheck, hsNcPhotosMissing, hsNcRow, hsCheckLine, hsCheckDetail,
  hsTestStatus, hsTestAccess, hsTestRow, hsTestSite, hsCanSeeTest, hsLiveTests, hsReasonSetting, hsExpireWaivers,
  hsAutoAttach, hsRemoveDriver, hsReason, hsReasons, hsEvaluate, hsDepartures, hsCriticality, hsEventActions,
  hsActionOpen, hsEventOverdue, hsEventLine, hsEventTransitions, hsPersonRow, hsInvestigationRow, hsEventDetail,
  hsNotifyLevel, hsClassify, hsActionOriginLabel, hsActionCriticality, hsIsCostly, hsNeedsApproval, hsDaysOverdue,
  hsActionLine, hsReminders, hsActionTransitions, hsActionDetail, hsNewAction, hsWaiverRow, hsCanSeeWaiver,
  hsDeadlines, hsEventKind, hsEventCounts, hsHours, hsKm, hsLiters, hsSynth, hsIndicators, seedHsseq, hsInternal,
  hsDateTime, hsReportedAt, hsText, hsSiteRow, hsSiteValues, hsAssignVehicles, hsSettingsCompany, hsSettingsRow,
  hsEventOf, HS_EVENT_SORTS, hsSort, hsList, hsEventList, hsPeople, hsEventValues, hsActionOf, HS_ACTION_SORTS,
  hsActionList, hsActionValues, hsTemplateValues, hsItemValues, HS_CHECK_SORTS, hsCheckOf, hsTestOf,
  hsRotationAllowed, hsReasonRow, hsWaiverOf, HS_WAIVER_SORTS, hsFourEyes, hsWaiverRequire, HS_ATTACH_MODELS,
  hsClosed, hsCanAttach, hsAttachmentOf,
};

/* ─── NIMOVA · Analyse (routes dans analyse.mjs) ─────────────────────────── */

enregistrerAnalyse({ route, ApiError, makeRng, TODAY, COMPANIES });
enregistrerProprietaires({ route, DB, ApiError, TR_READ, TODAY, COMPANIES, partnerRef, simpleRef, fileReply, xlsxBuffer });

/* ════════════════════════════════════════════════════════════════════════════
 * Serveur HTTP
 * ══════════════════════════════════════════════════════════════════════════ */

const OPEN_WITH_TEMPORARY_PASSWORD = new Set(["/auth/me", "/auth/password", "/auth/logout"]);

/** Société de travail : en-tête X-Eguitra-Company s'il désigne une société de l'utilisateur, sinon celle de l'application. */
function resolveCompany(user, headers) {
  const wanted = Number.parseInt(headers["x-eguitra-company"] || "", 10);
  if (user.companies.includes(wanted)) return wanted;
  const app = headers["x-eguitra-app"];
  if ((app === "axispro" || app === "portail") && user.companies.includes(2)) return 2;
  return user.companies.includes(1) ? 1 : user.companies[0];
}
function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
function sendFile(res, file) {
  const ascii = file.filename.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  res.writeHead(200, {
    "Content-Type": file.contentType,
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    "Cache-Control": "no-store",
    "Content-Length": file.data.length,
  });
  res.end(file.data);
}
function logLine(text) {
  console.log(`${new Date().toISOString().slice(11, 19)} ${text}`);
}

function handle(req, res, raw, started) {
  const url = new URL(req.url, `http://${HOST}`);
  const method = req.method.toUpperCase();
  const finish = (status, extra = "") => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    logLine(`${method} ${url.pathname}${url.search} -> ${status} ${ms.toFixed(0)} ms${extra}`);
    return ms;
  };
  const path = url.pathname.startsWith("/api/v1/") ? url.pathname.slice(7) : null;
  const candidates = path === null ? [] : ROUTES.filter((r) => r.regex.test(path));
  const match = candidates.find((r) => r.method === method);
  if (!match) {
    logLine(`INCONNU ${method} ${url.pathname}${url.search}`);
    sendJson(res, 404, { error: "not_found" });
    return;
  }
  const params = match.regex.exec(path).slice(1).map((v) => (/^\d+$/.test(v) ? Number(v) : v));
  const headers = req.headers;
  let login = null;
  let user = null;
  let company = null;
  const app = headers["x-eguitra-app"] || null;
  let status = 200;
  try {
    const contentType = headers["content-type"] || "";
    let body = {};
    if (raw.length && !contentType.startsWith("multipart/")) {
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        throw new ApiError(400, "invalid_json", "Le corps de la requête n'est pas un JSON valide.");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "invalid_json", "Le corps de la requête doit être un objet JSON.");
    }
    if (!match.public) {
      const auth = headers.authorization || "";
      login = auth.slice(0, 7).toLowerCase() === "bearer " ? tokenLogin(auth.slice(7).trim(), "a") : null;
      if (!login) throw new ApiError(401, "unauthenticated", "Session expirée.");
      user = sessionUser(login);
      company = resolveCompany(user, headers);
      if (passwordTemporary(user) && !OPEN_WITH_TEMPORARY_PASSWORD.has(match.pattern)) throw new ApiError(403, "password_change_required", "Remplacez d'abord votre mot de passe provisoire.");
      if (match.profiles && !user.profiles.some((p) => match.profiles.includes(p))) throw new ApiError(403, "forbidden", "Accès non autorisé pour votre profil.");
      if (match.pattern.startsWith("/hsseq/") && user.profiles.includes("auditeur")) hsAuditorGuard(user, method);
    } else if (match.pattern === "/auth/login") {
      login = typeof body.login === "string" ? body.login.trim().toLowerCase() : null;
    }
    let parsed = null;
    const ctx = {
      method, path, params, query: Object.fromEntries(url.searchParams), body, raw, headers, login, user, company, app,
      multipart: () => (parsed ??= parseMultipart(raw, contentType)),
    };
    const result = match.handler(ctx);
    if (result && result.__file) {
      sendFile(res, result);
    } else if (result && result.__status) {
      status = result.__status;
      sendJson(res, status, result.__body);
    } else {
      sendJson(res, 200, result === undefined ? null : result);
    }
  } catch (e) {
    if (e instanceof ApiError) {
      status = e.status;
      sendJson(res, status, { error: e.code, ...(e.userMessage ? { message: e.userMessage } : {}), ...e.extra });
    } else {
      status = 500;
      console.error(e);
      sendJson(res, 500, { error: "server_error", message: "Erreur interne. L'incident est journalisé." });
    }
  }
  const who = user ? ` [${login}${app ? `, ${app}` : ""}, société ${company}]` : login ? ` [${login}]` : "";
  const ms = finish(status, who);
  if (user || match.pattern === "/auth/login") {
    DB.accessLog.push({ date: nowStamp(), user: user ? user.name : null, method, path: url.pathname, status, duration_ms: Math.round(ms), ip: headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1", app });
    if (DB.accessLog.length > 600) DB.accessLog.splice(0, DB.accessLog.length - 600);
  }
}

seed();
// Lot 2 HSSEQ : routes et tables des modules hsseq-*.mjs, sur les données du lot 1 déjà semées.
enregistrerRisques(HS_REFS);
enregistrerConformite(HS_REFS);
enregistrerHabilitationsRapports(HS_REFS);
enregistrerTrajets(HS_REFS);
// Lot 3 HSSEQ : après le lot 2, dont la revue de direction lit les tables.
enregistrerEnvironnement(HS_REFS);
enregistrerDocuments(HS_REFS);
enregistrerTelematique(HS_REFS);
enregistrerRevues(HS_REFS);
const server = http.createServer((req, res) => {
  const started = process.hrtime.bigint();
  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size <= 30 * 1048576) chunks.push(chunk);
  });
  req.on("end", () => {
    try {
      handle(req, res, Buffer.concat(chunks), started);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) sendJson(res, 500, { error: "server_error", message: "Erreur interne. L'incident est journalisé." });
    }
  });
});
server.on("error", (e) => {
  console.error(e.code === "EADDRINUSE" ? `Le port ${PORT} est déjà utilisé : arrêtez l'autre serveur ou lancez avec PORT=8171.` : e);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  logLine(`Maquette de l'API NIMOVA prête sur http://${HOST}:${PORT}/api/v1 (données fictives au ${frDate(TODAY)}).`);
  logLine(`${ROUTES.length} routes, ${DB.moves.length} pièces, ${DB.rotations.length} rotations, ${DB.dossiers.length} dossiers AxisPro.`);
  logLine("Identifiants : n'importe lequel (profil complet), porteur, parc, provisoire, cabinet, mfa, activation ; mot de passe « faux » refusé.");
});
