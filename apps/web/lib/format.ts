/** Formatage des montants (GNF sans décimale), dates et pourcentages, à la française. */

const intFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

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
  return `${intFmt.format(round0(n))} ${currency}`;
}

/** 1 234 567 (sans devise, pour les tableaux) */
export function fmtInt(value: unknown): string {
  const n = toNumber(value);
  return n === null ? "–" : intFmt.format(round0(n));
}

export function fmtDec(value: unknown): string {
  const n = toNumber(value);
  return n === null ? "–" : decFmt.format(n);
}

/** 20,6 Mds · 384 M · 12 500 */
export function fmtShort(value: unknown): string {
  const n = toNumber(value);
  if (n === null) return "–";
  const a = Math.abs(n);
  if (a >= 1e9) return `${decFmt.format(Math.round(n / 1e7) / 100)} Mds`;
  if (a >= 1e6) return `${intFmt.format(round0(n / 1e6))} M`;
  return intFmt.format(round0(n));
}

export function fmtPct(value: unknown, digits = 1): string {
  const n = toNumber(value);
  if (n === null) return "–";
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
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
