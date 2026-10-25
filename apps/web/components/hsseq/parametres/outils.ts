/** Outils des paramètres HSSEQ : message et champs d'une erreur du noyau. */

import { ApiError } from "@/lib/api-client";

/** Message français de l'erreur, à défaut une phrase générique. */
export function messageErreur(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Une erreur est survenue.";
}

/** Champs nommés par le noyau dans une erreur de saisie (`fields`, contrat §1). */
export function champsEnErreur(e: unknown): string[] {
  return e instanceof ApiError ? (e.body.fields ?? []) : [];
}
