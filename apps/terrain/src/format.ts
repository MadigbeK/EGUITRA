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

/** « 25/10/2026 » devient « 2026-10-25 » ; date impossible (30/02) ou à venir : null. */
export function lireDate(texte: string, aujourdhuiIso = aujourdhui()): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texte.trim());
  if (!m) return null;
  const [j, mo, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(a, mo - 1, j);
  if (d.getFullYear() !== a || d.getMonth() !== mo - 1 || d.getDate() !== j) return null;
  const iso = `${a}-${deux(mo)}-${deux(j)}`;
  return iso > aujourdhuiIso ? null : iso;
}

/** « 2026-10-25 » devient « 25/10/2026 ». */
export function fmtDate(value: unknown): string {
  if (typeof value !== "string" || !value) return VIDE;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

/** « 05:44 » : heure locale d'un horodatage ISO. */
export function heure(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? VIDE : `${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

/** Durée écrite en mots courts : « 24 s », « 2 min 58 s ». */
export function duree(secondes: number): string {
  const s = Math.max(0, Math.round(secondes));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
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
