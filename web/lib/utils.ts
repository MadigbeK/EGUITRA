import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge utility classes Tailwind en résolvant les conflits. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Formate un montant en GNF selon les conventions ADR-007.
 * Pas de décimale, séparateur milliers = espace fine (U+202F).
 *
 * @example
 *   fmtGNF(15750) → "15 750 GNF"
 *   fmtGNF(0)     → "0 GNF"
 */
export function fmtGNF(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return "— GNF";
  const rounded = Math.round(amount);
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
    .format(rounded)
    .replace(/\s/g, " ") + " GNF";
}

/**
 * Formate une date selon ADR-007 : dd/MM/yyyy en timezone Africa/Conakry.
 */
export function fmtDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Conakry",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/**
 * Formate datetime selon ADR-007 : dd/MM/yyyy à HH:mm (24h, Africa/Conakry).
 */
export function fmtDateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Conakry",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(",", " à");
}
