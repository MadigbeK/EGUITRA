/**
 * Outils partagés par les routes de NIMOVA · Analyse (analyse-groupe.mjs, analyse-cabinet.mjs) :
 * dates et mois, arrondis, statistiques élémentaires, période d'analyse (chapitre 3 de la
 * spécification), constats et leur classement (chapitre 4). Les formes produites sont celles du
 * noyau (addons/eguitra_analytics) : mêmes clés, mêmes unités.
 */

export const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const pad = (n) => String(n).padStart(2, "0");
export const frDate = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
export const round = (n) => Math.round(n);
export const r1 = (n) => Math.round(n * 10) / 10;
export const r2 = (n) => Math.round(n * 100) / 100;
export const r3 = (n) => Math.round(n * 1000) / 1000;
export const sum = (arr, fn = (x) => x) => arr.reduce((s, x, i) => s + fn(x, i), 0);
export const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const utc = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const addDays = (d, n) => new Date(utc(d) + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
export const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
/** Lundi de la semaine qui contient `d`. */
export const lundi = (d) => addDays(d, -((new Date(utc(d)).getUTCDay() + 6) % 7));
export const sigmoide = (x) => 1 / (1 + Math.exp(-x));
export const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null;
};
export const quantile = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return null;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (pos - lo);
};
/** Clés AAAA-MM des `n` mois qui finissent au mois de `d`. */
export function moisJusqua(d, n) {
  const y = +d.slice(0, 4);
  const m = +d.slice(5, 7);
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const t = m - 1 - k;
    out.push(`${y + Math.floor(t / 12)}-${pad(((t % 12) + 12) % 12 + 1)}`);
  }
  return out;
}
/** Clés AAAA-MM des mois entre deux dates (incluses). */
export function moisEntre(a, b) {
  const out = [];
  let y = +a.slice(0, 4);
  let m = +a.slice(5, 7);
  while (`${y}-${pad(m)}` <= b.slice(0, 7)) {
    out.push(`${y}-${pad(m)}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
export const moisLabel = (key) => `${MOIS[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`;
export const moisCourt = (key) => MOIS[+key.slice(5, 7) - 1].slice(0, 4).replace(/\.$/, "");
/** Part de chaque mois comprise dans la période (le mois d'arrêté au prorata des jours). */
export function poidsMois(months, p) {
  return months.map((k) => {
    const debut = `${k}-01`;
    const fin = `${k}-${pad(lastDay(+k.slice(0, 4), +k.slice(5, 7)))}`;
    const a = debut > p.date_from ? debut : p.date_from;
    const b = fin < p.date_to ? fin : p.date_to;
    return a > b ? 0 : (daysBetween(a, b) + 1) / (daysBetween(debut, fin) + 1);
  });
}
export const variation = (a, b) => (b ? r1(((a - b) / Math.abs(b)) * 100) : null);
export const taux = (num, den) => (den ? (num / den) * 100 : null);

/* ─── Formats des textes (constats) ──────────────────────────────────────── */

const fr = (v, d) => v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
export const mds = (v) => (Math.abs(v) >= 1e9 ? `${fr(v / 1e9, 2)} Md GNF` : Math.abs(v) >= 1e6 ? `${fr(v / 1e6, 1)} M GNF` : `${fr(v, 0)} GNF`);
export const pctFr = (v, d = 0) => `${fr(v, d)} %`;
export const nFr = (v, d = 0) => fr(v, d);

/* ─── Période (chapitre 3) ────────────────────────────────────────────────── */

export function creerPeriode(TODAY, badParam) {
  return function periode(query) {
    const dateTo = query.date_to ? (isDate(query.date_to) ? query.date_to : null) : TODAY;
    if (!dateTo) throw badParam("date_to : date AAAA-MM-JJ attendue.");
    const code = ["ytd", "12m", "q", "m", "custom"].includes(query.period) ? query.period : "ytd";
    const y = +dateTo.slice(0, 4);
    const m = +dateTo.slice(5, 7);
    let from;
    let label;
    if (code === "ytd") {
      from = `${y}-01-01`;
      label = `Exercice ${y} au ${frDate(dateTo)}`;
    } else if (code === "12m") {
      from = addDays(`${y - 1}-${pad(m)}-${pad(Math.min(+dateTo.slice(8, 10), lastDay(y - 1, m)))}`, 1);
      label = `12 derniers mois au ${frDate(dateTo)}`;
    } else if (code === "q") {
      const q = Math.floor((m - 1) / 3);
      from = `${y}-${pad(q * 3 + 1)}-01`;
      label = `${q + 1}${q === 0 ? "er" : "e"} trimestre ${y} au ${frDate(dateTo)}`;
    } else if (code === "m") {
      from = `${y}-${pad(m)}-01`;
      label = `${MOIS[m - 1][0].toUpperCase()}${MOIS[m - 1].slice(1)} ${y} au ${frDate(dateTo)}`;
    } else {
      if (!isDate(query.date_from)) throw badParam("date_from : date AAAA-MM-JJ attendue avec period=custom.");
      from = query.date_from;
      label = `Du ${frDate(from)} au ${frDate(dateTo)}`;
    }
    if (from > dateTo) throw badParam("La date de début dépasse la date d'arrêté.");
    const decale = (d) => `${+d.slice(0, 4) - 1}${d.slice(4)}`.replace(/-02-29$/, "-02-28");
    return { code, date_from: from, date_to: dateTo, label, previous: { date_from: decale(from), date_to: decale(dateTo) } };
  };
}

/* ─── Constats (chapitre 4) ───────────────────────────────────────────────── */

const POIDS = { critical: 5, high: 3.5, medium: 2, info: 1, positive: 1.5 };

/** Complète un constat (champs facultatifs à null) et calcule son score de tri. */
export function constat(c) {
  const impact = Math.abs(c.impact_gnf || 0);
  const score = POIDS[c.severity] * (1 + Math.log10(1 + impact / 1e6)) * (0.5 + c.confidence / 2);
  return { metric: null, impact_gnf: null, evidence: null, action: null, link: null, ...c, impact_gnf: c.impact_gnf ? round(c.impact_gnf) : null, confidence: r2(c.confidence), score: r3(score) };
}

/** Les `limit` constats les mieux classés, avec au moins un point fort s'il en existe. */
export function classer(items, limit = 6) {
  const ordered = [...items].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  let selected = ordered.slice(0, limit);
  if (limit >= 3 && !selected.some((i) => i.severity === "positive")) {
    const positive = ordered.find((i) => i.severity === "positive");
    if (positive) selected = [...selected.slice(0, limit - 1), positive];
  }
  return selected;
}

/** Indicateur au contrat du noyau. */
export function kpi({ key, label, value, unit, previous = null, target = null, status = "neutral", definition, trend = [], inverse = false }) {
  const arrondi = (v) => (v === null ? null : unit === "gnf" ? round(v) : r2(v));
  return { key, label, value: arrondi(value), unit, previous: arrondi(previous), target, delta_pct: previous === null || value === null ? null : variation(value, previous), trend: trend.map((v) => (v === null ? null : arrondi(v))), status, definition, inverse };
}
