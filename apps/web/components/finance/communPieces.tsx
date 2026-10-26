"use client";

import { INSECABLE, fmtFixe, fmtGNF, fmtInt } from "@/lib/format";
import type { Profile } from "@/lib/types";

/**
 * Outils communs aux écrans des pièces, de la trésorerie, des tiers, des relances et des états.
 */

/*
 * Profils des routes d'écriture du noyau, recopiés pour ne montrer une commande qu'aux profils que la
 * route accepte (useAutorise de lib/api-client.ts) : la direction lit la finance, elle n'y écrit pas.
 */

/** Règlement, avoir, litige, annulation, trésorerie, relances (FIN_WRITE, eguitra_finance/controllers/common.py). */
export const ECRITURE_FINANCE: Profile[] = ["admin", "finance"];
/** Saisie, validation, modification, suppression et justificatifs des pièces (PURCHASE_WRITE, controllers/moves.py) ; le profil Achats y est borné aux pièces d'achat. */
export const SAISIE_PIECES: Profile[] = ["admin", "finance", "achats"];
/** Création d'un tiers (POST /finance/partners, controllers/partners.py) : finance, métiers, cabinet et achats. */
export const CREATION_TIERS: Profile[] = ["admin", "finance", "exploitation", "chantiers", "immobilier", "cabinet", "achats"];
/** Modification d'une fiche de tiers (PATCH /finance/partners/<id>) ; le profil Achats n'y modifie que les fournisseurs. */
export const MODIFICATION_TIERS: Profile[] = ["admin", "finance", "achats"];

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
