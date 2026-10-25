"use client";

import { INSECABLE, fmtFixe, fmtGNF, fmtInt } from "@/lib/format";

/**
 * Outils communs aux écrans des pièces, de la trésorerie, des tiers, des relances et des états.
 */

/** Champ dont la saisie est refusée (nombre illisible, montant hors bornes) : bordure et halo rouges. */
export const CHAMP_INVALIDE = "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-4 aria-[invalid=true]:ring-danger/15";

/** Nombre d'un montant sans son unité : entier en GNF, deux décimales dans une autre devise. */
export function nombreDevise(valeur: unknown, devise?: string | null): string {
  return !devise || devise === "GNF" ? fmtInt(valeur) : fmtFixe(valeur, 2);
}

/**
 * Montant dans la devise de la pièce : entier en GNF (« 1 500 000 GNF »), deux décimales dans une autre
 * devise (« 1 500,00 USD ») ; sans devise, le GNF.
 */
export function montantDevise(valeur: unknown, devise?: string | null): string {
  if (!devise || devise === "GNF") return fmtGNF(valeur);
  const v = fmtFixe(valeur, 2);
  return v === "–" ? v : `${v}${INSECABLE}${devise}`;
}
