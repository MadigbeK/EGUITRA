/**
 * Écriture française des nombres et des dates, comme l'application web (apps/web/lib/format.ts).
 * Écrite à la main : le moteur JavaScript des téléphones (Hermes) ne connaît pas toutes les options
 * d'Intl, et un téléphone d'entrée de gamme peut n'avoir que l'anglais.
 */

/** Espace insécable, avant une unité : « 36,50 m³ ». */
export const INSECABLE = " ";

/** Espace fine insécable, entre les milliers : « 1 500 000 ». */
const FINE = " ";

/** Valeur absente. */
const VIDE = "–";

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || value === false) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** `d` décimales fixes, milliers groupés, virgule décimale, jamais « -0 ». */
function fixe(n: number, d: number): string {
  const texte = Math.abs(n).toFixed(d);
  const [entier, decimales] = texte.split(".");
  const signe = n < 0 && Number(texte) !== 0 ? "-" : "";
  return signe + entier!.replace(/\B(?=(\d{3})+(?!\d))/g, FINE) + (decimales ? `,${decimales}` : "");
}

export function fmtInt(value: unknown): string {
  const n = toNumber(value);
  return n === null ? VIDE : fixe(Math.round(n), 0);
}

/** Volume en m³ à deux décimales : « 36,50 ». */
export function fmtVolume(value: unknown): string {
  const n = toNumber(value);
  return n === null ? VIDE : fixe(n, 2);
}

/** Volume suivi de son unité : « 36,50 m³ ». */
export function fmtM3(value: unknown): string {
  const v = fmtVolume(value);
  return v === VIDE ? v : `${v}${INSECABLE}m³`;
}

/** Pluriel simple : « 0 saisie », « 1 saisie », « 2 saisies ». */
export function pluriel(n: number, un: string, plusieurs = `${un}s`): string {
  return `${fmtInt(n)} ${n > 1 ? plusieurs : un}`;
}

const deux = (n: number) => String(n).padStart(2, "0");

/** Date du jour sur l'appareil, au format de l'API : « 2026-10-25 ». */
export function aujourdhui(decalageJours = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + decalageJours);
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** « 2026-10-25 » devient « 25/10/2026 ». */
export function fmtDate(value: unknown): string {
  if (typeof value !== "string" || !value) return VIDE;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

/** « aujourd'hui 14:32 », « hier 18:05 », sinon « le 20/10 à 09:15 ». */
export function quand(d: Date, maintenant = new Date()): string {
  const heure = `${deux(d.getHours())}:${deux(d.getMinutes())}`;
  const veille = new Date(maintenant);
  veille.setDate(veille.getDate() - 1);
  if (d.toDateString() === maintenant.toDateString()) return `aujourd'hui ${heure}`;
  if (d.toDateString() === veille.toDateString()) return `hier ${heure}`;
  return `le ${deux(d.getDate())}/${deux(d.getMonth() + 1)} à ${heure}`;
}
