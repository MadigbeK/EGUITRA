"use client";

import { useState } from "react";
import { Notice, cx } from "@/components/ui";
import { ETATS } from "@/lib/couleurs";
import { useMoi, type MoiAxispro } from "@/components/axispro/moi";
import { ApiError } from "@/lib/api-client";
import { fmtShort } from "@/lib/format";
import type { DossierDetail } from "@/lib/axispro-types";

/** Règles de passage des gates (méthode MB AxisPro Consulting). */
export const RULE_LABELS: Record<string, string> = {
  intake: "Recevabilité (fiche projet)",
  prequalification: "Préqualification (knock-outs du gate, maturité)",
  feasibility: "Préfaisabilité (knock-outs des domaines clés, maturité)",
  apd: "APD Readiness (zéro knock-out, score APD)",
  bankability: "Bancabilité (score Bankability, DSCR)",
  due_diligence: "Due diligence (red flag, data room)",
  structuring: "Structuration (accord des bailleurs, domaines cibles)",
  closing: "Financial close (conditions levées, documentation signée)",
  generic: "Critères du gate évalués, sans knock-out",
};

/** Couleur d'un score selon les classes de la méthode (65, 50, 30), comme le prototype. */
export function couleurScore(v: number | null | undefined) {
  if (v === null || v === undefined) return "var(--line-strong)";
  return v >= 65 ? ETATS.bon : v >= 50 ? "var(--warn-vif)" : v >= 30 ? ETATS.risque : ETATS.alerte;
}

export const PRIORITE_TON: Record<string, "danger" | "warn" | "neutral" | "ok"> = {
  URGENTE: "danger",
  ÉLEVÉE: "warn",
  MOYENNE: "neutral",
  FAIBLE: "ok",
};

/** Montant dans la devise du dossier. */
export function montant(d: Pick<DossierDetail, "currency">, v: number | null | undefined) {
  return `${fmtShort(v ?? 0)} ${d.currency?.name ?? "GNF"}`;
}

/** Score affiché sans jamais franchir un seuil par l'arrondi : 64,6 s'affiche 64, sous APD READY (65). */
export function note(v: number) {
  return Math.floor(v + 1e-9);
}

export function arrondi(v: number | null | undefined, digits = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return v.toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/**
 * Utilisateur connecté et droit d'écriture sur les dossiers : seul le profil cabinet modifie (la
 * direction et l'administration lisent), comme le noyau.
 */
export function useCabinet(): { moi: MoiAxispro | null; cabinet: boolean } {
  const moi = useMoi();
  return { moi, cabinet: moi?.cabinet ?? false };
}

/** Code d'un compartiment d'expertise (C0, C1…), son intitulé en infobulle. */
export function PuceCompartiment({ code, nom, className }: { code: string; nom?: string | null; className?: string }) {
  return (
    <span title={nom ? `${code} ${nom}` : undefined} className={cx("inline-flex flex-none items-center rounded-md border border-accent/25 bg-accent-doux px-1.5 py-px font-mono text-[11.5px] font-bold leading-4 text-accent", className)}>
      {code}
    </span>
  );
}

/** Message de retour d'une action, et exécution avec capture de l'erreur de l'API. */
export function useRetour() {
  const [retour, setRetour] = useState<{ tone: "ok" | "danger" | "warn"; text: string } | null>(null);
  async function agir<T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
    setRetour(null);
    try {
      const r = await fn();
      if (ok) setRetour({ tone: "ok", text: ok });
      return r;
    } catch (e) {
      setRetour({ tone: "danger", text: e instanceof ApiError ? e.message : "Action impossible." });
      return undefined;
    }
  }
  const bandeau = retour ? <Notice tone={retour.tone}>{retour.text}</Notice> : null;
  return { agir, bandeau, setRetour };
}
