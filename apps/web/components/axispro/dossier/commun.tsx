"use client";

import { useRef, useState, type ReactNode } from "react";
import { Notice, cx, demanderConfirmation } from "@/components/ui";
import { ETATS } from "@/lib/couleurs";
import { useMoi, type MoiAxispro } from "@/components/axispro/moi";
import { ApiError, DelaiDepasse } from "@/lib/api-client";
import { fmtFixe, fmtShort } from "@/lib/format";
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

/** Nombre arrondi à `digits` décimales (écriture de lib/format.ts). Pour un score comparé à un seuil, voir `scoreEcrit`. */
export function arrondi(v: number | null | undefined, digits: 0 | 1 | 2 = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return fmtFixe(v, digits);
}

/** Score affiché sans franchir un seuil par l'arrondi (64,6 s'écrit 64), « – » s'il n'est pas calculé. */
export function scoreEcrit(v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return fmtFixe(note(v), 0);
}

/**
 * Utilisateur connecté et droit d'écriture sur les dossiers : seul le profil cabinet modifie (la
 * direction et l'administration lisent), comme le noyau.
 */
export function useCabinet(): { moi: MoiAxispro | null; cabinet: boolean } {
  const moi = useMoi();
  return { moi, cabinet: moi?.cabinet ?? false };
}

/**
 * Bandeau d'un écran laissé en lecture seule à la direction et à l'administration : leurs champs
 * restent visibles mais figés, il dit pourquoi. Rien pour le profil cabinet.
 */
export function LectureSeuleCabinet({ children }: { children: ReactNode }) {
  const { cabinet } = useCabinet();
  return cabinet ? null : <Notice tone="neutral">{children}</Notice>;
}

/** Code d'un compartiment d'expertise (C0, C1…), son intitulé en infobulle. */
export function PuceCompartiment({ code, nom, className }: { code: string; nom?: string | null; className?: string }) {
  return (
    <span title={nom ? `${code} ${nom}` : undefined} className={cx("inline-flex flex-none items-center rounded-md border border-accent/25 bg-accent-doux px-1.5 py-px font-mono text-[11.5px] font-bold leading-4 text-accent", className)}>
      {code}
    </span>
  );
}

/** Message d'une erreur pour l'utilisateur : celui du noyau, sinon une phrase en français (réseau coupé). */
export function messageErreur(e: unknown, defaut = "Action impossible."): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof DelaiDepasse) return e.message;
  return e instanceof TypeError ? "Réseau indisponible : vérifiez la connexion, puis réessayez." : defaut;
}

/**
 * Message de retour d'une action, et exécution avec capture de l'erreur de l'API.
 * - `agir` : appel quelconque (lecture, enregistrement d'un champ) ; plusieurs peuvent se suivre (les
 *   critères de la check-list s'enregistrent l'un après l'autre).
 * - `envoyer` : commande d'un bouton qui écrit. Un second clic pendant l'envoi est ignoré (double clic,
 *   réseau lent : jamais deux dossiers, deux revues ni deux passages de gate) ; `enCours` nomme la
 *   commande en cours (son bouton en chargement), `occupe` est vrai tant qu'un appel est en cours
 *   (les autres boutons attendent). L'état revient toujours à faux, même en cas d'échec.
 */
export function useRetour() {
  const [retour, setRetour] = useState<{ tone: "ok" | "danger" | "warn"; text: string } | null>(null);
  const [appels, setAppels] = useState(0);
  const [enCours, setEnCours] = useState<string | null>(null);
  const verrou = useRef(false);
  async function agir<T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
    setRetour(null);
    setAppels((n) => n + 1);
    try {
      const r = await fn();
      if (ok) setRetour({ tone: "ok", text: ok });
      return r;
    } catch (e) {
      setRetour({ tone: "danger", text: messageErreur(e) });
      return undefined;
    } finally {
      setAppels((n) => n - 1);
    }
  }
  async function envoyer<T>(fn: () => Promise<T>, ok?: string, cle = "envoi"): Promise<T | undefined> {
    if (verrou.current) return undefined;
    verrou.current = true;
    setEnCours(cle);
    try {
      return await agir(fn, ok);
    } finally {
      verrou.current = false;
      setEnCours(null);
    }
  }
  const bandeau = retour ? <Notice tone={retour.tone}>{retour.text}</Notice> : null;
  return { agir, envoyer, enCours, occupe: appels > 0 || enCours !== null, bandeau, retour, setRetour };
}

/**
 * Confirmation avant de quitter une saisie modifiée (fenêtre fermée par Échap, la croix ou
 * « Annuler ») : rend vrai si l'on peut fermer. `modifie` : la saisie diffère de son état d'origine.
 */
export async function fermerSiConfirme(modifie: boolean): Promise<boolean> {
  if (!modifie) return true;
  return demanderConfirmation("Abandonner la saisie ? Les modifications non enregistrées seront perdues.", { action: "Abandonner", danger: true });
}
