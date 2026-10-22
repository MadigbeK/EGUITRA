/**
 * Formatage des montants (GNF sans décimale), dates et pourcentages, à la française.
 *
 * Une seule écriture des nombres dans toute l'application (charte, « Les composants ») :
 * - milliers toujours groupés (« 1 365,46 », jamais « 1365,46 ») ;
 * - espace insécable entre le nombre et son unité : « 1,74 Md » ne se coupe pas en fin de ligne ;
 * - milliards en « Md », invariable comme « M », à deux décimales fixes ; millions entiers à partir
 *   de 100 M, à une décimale en dessous ; jamais de « k » ;
 * - délais en jours à une décimale, ratios à deux décimales, volumes en m³ à deux décimales.
 */

/** Espace insécable, entre un nombre et son unité. */
export const INSECABLE = " ";

const intFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0, useGrouping: "always" });
const decFmt = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2, useGrouping: "always" });
const fixes = [0, 1, 2].map((d) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: "always" }));

/**
 * Nombre déjà arrondi, écrit à `d` décimales fixes (0, 1 ou 2), milliers groupés, jamais « -0 ».
 * L'arrondi se fait avant, sur un entier (Math.round(n / 1e7) / 100 pour les milliards) : diviser
 * puis multiplier par 100 ferait écrire « 0,99 Md » pour 999 500 000.
 */
function fixe(r: number, d: 0 | 1 | 2): string {
  return fixes[d]!.format(r === 0 ? 0 : r);
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Arrondi à l'unité sans « -0 » (un montant nul s'affiche 0). */
function round0(n: number): number {
  const r = Math.round(n);
  return r === 0 ? 0 : r;
}

/** 1 234 567 GNF */
export function fmtGNF(value: unknown, currency = "GNF"): string {
  const n = toNumber(value);
  if (n === null) return "–";
  return `${intFmt.format(round0(n))}${INSECABLE}${currency}`;
}

/** 1 234 567 (sans devise, pour les tableaux) */
export function fmtInt(value: unknown): string {
  const n = toNumber(value);
  return n === null ? "–" : intFmt.format(round0(n));
}

/** Pluriel simple : « 0 dossier », « 1 dossier », « 2 dossiers ». */
export function pluriel(n: number, un: string, plusieurs = `${un}s`): string {
  return `${fmtInt(n)} ${n > 1 ? plusieurs : un}`;
}

/** Jusqu'à deux décimales, milliers groupés : « 1 365,46 », « 35,2 ». */
export function fmtDec(value: unknown): string {
  const n = toNumber(value);
  return n === null ? "–" : decFmt.format(n);
}

/** Échelle d'un montant abrégé : milliards, millions, ou unités sous le million. */
function echelle(a: number): "Md" | "M" | "unite" {
  // Un montant qui s'arrondirait à « 1 000 M » s'écrit déjà « 1,00 Md », et « 1 000 000 » « 1,0 M ».
  if (a >= 1e9 || Math.round(a / 1e6) >= 1000) return "Md";
  if (Math.round(a) >= 1e6) return "M";
  return "unite";
}

/**
 * Montant abrégé, pour les chiffres clés et les graphiques (les tableaux écrivent le montant entier
 * avec fmtInt et l'unité dans l'en-tête). Espace insécable avant l'unité, milliers groupés.
 *
 * Valeurs de référence (le contrat entre l'écran et le noyau) :
 *   fmtShort(1_740_000_000)   → « 1,74 Md »
 *   fmtShort(6_000_000_000)   → « 6,00 Md »
 *   fmtShort(41_310_000_000)  → « 41,31 Md »
 *   fmtShort(-11_550_000_000) → « -11,55 Md »
 *   fmtShort(999_600_000)     → « 1,00 Md »   (et non « 1 000 M »)
 *   fmtShort(384_200_000)     → « 384 M »
 *   fmtShort(99_960_000)      → « 100 M »     (et non « 100,0 M »)
 *   fmtShort(7_040_000)       → « 7,0 M »
 *   fmtShort(224_050)         → « 224 050 »   (sous le million : entier groupé, jamais « 224 k »)
 *   fmtShort(0)               → « 0 »
 */
export function fmtShort(value: unknown): string {
  const n = toNumber(value);
  if (n === null) return "–";
  const a = Math.abs(n);
  switch (echelle(a)) {
    case "Md":
      return `${fixe(Math.round(n / 1e7) / 100, 2)}${INSECABLE}Md`;
    case "M":
      // Entier à partir de 100 M (y compris ce qui s'arrondirait à « 100,0 M »), une décimale en dessous.
      return Math.round(a / 1e5) >= 1000 ? `${fixe(Math.round(n / 1e6), 0)}${INSECABLE}M` : `${fixe(Math.round(n / 1e5) / 10, 1)}${INSECABLE}M`;
    default:
      return intFmt.format(round0(n));
  }
}

/**
 * Graduation d'un axe de graphique : la même échelle et les mêmes unités que fmtShort, sans les zéros
 * qui n'apprennent rien sur une graduation ronde (« 6 Md », « 2,5 Md », « 500 M », « 7,5 M »).
 */
export function fmtAxe(value: unknown): string {
  const n = toNumber(value);
  if (n === null) return "–";
  const a = Math.abs(n);
  switch (echelle(a)) {
    case "Md":
      return `${decFmt.format(Math.round(n / 1e7) / 100)}${INSECABLE}Md`;
    case "M":
      return `${decFmt.format(Math.round(n / 1e5) / 10)}${INSECABLE}M`;
    default:
      return intFmt.format(round0(n));
  }
}

/** « 12,5 % » : une décimale par défaut, espace insécable avant le signe. */
export function fmtPct(value: unknown, digits = 1): string {
  const n = toNumber(value);
  if (n === null) return "–";
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: "always" })}${INSECABLE}%`;
}

/**
 * Délai en jours, toujours à une décimale, pour que le même délai s'écrive partout de la même façon
 * (chiffre clé, jauge, questions du dirigeant, bloc BFR).
 *   fmtJours(56.5) → « 56,5 j »
 *   fmtJours(56)   → « 56,0 j »
 *   fmtJours(null) → « – »
 */
export function fmtJours(value: unknown): string {
  const n = toNumber(value);
  return n === null ? "–" : `${fixe(Math.round(n * 10) / 10, 1)}${INSECABLE}j`;
}

/**
 * Ratio sans unité (couverture de la dette, liquidité), toujours à deux décimales.
 *   fmtRatio(2.9)   → « 2,90 »
 *   fmtRatio(1.234) → « 1,23 »
 *   fmtRatio(null)  → « – »
 */
export function fmtRatio(value: unknown): string {
  const n = toNumber(value);
  return n === null ? "–" : fixe(Math.round(n * 100) / 100, 2);
}

/** Nombre à décimales fixes, milliers groupés, jamais « -0,00 » : fmtFixe(35.2, 2) → « 35,20 ». */
export function fmtFixe(value: unknown, decimales: 0 | 1 | 2): string {
  const n = toNumber(value);
  if (n === null) return "–";
  const p = 10 ** decimales;
  return fixe(Math.round(n * p) / p, decimales);
}

/**
 * Volume en m³, toujours à deux décimales (les litres), au bureau comme au téléphone.
 *   fmtVolume(35.2)    → « 35,20 »
 *   fmtVolume(1365.46) → « 1 365,46 »
 */
export function fmtVolume(value: unknown): string {
  return fmtFixe(value, 2);
}

/** Volume suivi de son unité, pour une phrase ou un chiffre clé : « 1 365,46 m³ ». */
export function fmtM3(value: unknown): string {
  const v = fmtVolume(value);
  return v === "–" ? v : `${v}${INSECABLE}m³`;
}

export function fmtDate(value: unknown): string {
  if (!value || typeof value !== "string") return "–";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("fr-FR");
}

export function fmtDateTime(value: unknown): string {
  if (!value || typeof value !== "string") return "–";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export const MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** "2026-03" -> "mars 2026" */
export function fmtMonth(value: string): string {
  const [y, m] = value.split("-");
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${MONTHS_FR[idx]} ${y}` : value;
}
