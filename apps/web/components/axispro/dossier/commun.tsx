"use client";

import { useState } from "react";
import { Notice } from "@/components/ui";
import { ApiError } from "@/lib/api-client";
import { fmtShort } from "@/lib/format";
import type { DossierDetail } from "@/lib/axispro-types";

/** Règles de passage des gates (méthode MB AxisPro). */
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
  return v >= 65 ? "var(--g-jade)" : v >= 50 ? "var(--warn-vif)" : v >= 30 ? "#e25f35" : "var(--danger-vif)";
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

export function arrondi(v: number | null | undefined, digits = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return v.toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
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
