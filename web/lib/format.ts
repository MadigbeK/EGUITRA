/** Helpers de formatage côté client. */

/**
 * Formate un montant en GNF — ADR-007 : pas de décimale, séparateur espace fine.
 */
export function fmtGNF(amount: number | string | null | undefined): string {
  if (amount == null) return "— GNF";
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (Number.isNaN(n)) return "— GNF";
  return (
    new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Math.round(n)) + " GNF"
  );
}
