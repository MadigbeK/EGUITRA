"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Utilisateur connecté, tel que la mise en page d'AxisPro le lit côté serveur (/auth/me) : la passerelle
 * du navigateur ne relaie pas les routes d'authentification, les écrans le reçoivent donc d'ici.
 * cabinet : profil cabinet, seul à modifier un dossier (la direction et l'administration lisent).
 * scelle : associé du cabinet ou direction : scelle la décision du comité, force le passage d'un gate,
 * ouvre une nouvelle révision (décision du gérant du 22 octobre 2026), toujours à deux personnes.
 */
export interface MoiAxispro {
  id: number;
  name: string;
  cabinet: boolean;
  scelle: boolean;
}

const Contexte = createContext<MoiAxispro | null>(null);

export function FournisseurMoi({ moi, children }: { moi: MoiAxispro; children: ReactNode }) {
  return <Contexte.Provider value={moi}>{children}</Contexte.Provider>;
}

/** Utilisateur connecté ; null hors de l'application AxisPro. */
export function useMoi(): MoiAxispro | null {
  return useContext(Contexte);
}
