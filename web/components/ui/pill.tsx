import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone =
  | "neutral"
  | "ok"
  | "warn"
  | "danger"
  | "info"
  | "violet"
  | "orange"
  | "demand";

interface PillProps {
  tone?: Tone;
  /** Affiche un bullet dot devant le label */
  bullet?: boolean;
  /** Animation pulse sur le bullet (pour status LIVE / SYNC) */
  pulse?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Pill statut générique — utilisé partout : Dispo Oui/Non, statut commande
 * (EN PRÉPARATION / EXPÉDIÉE / LIVRÉE), ancienneté dette (30/60/90j),
 * classification client (INSTIT / HÔPITAL / PHARMACIE / ONG).
 *
 * Tons :
 *   • ok          — vert vif PREM (disponible, livrée, réglée)
 *   • warn        — amber (stock bas, 30-90j retard)
 *   • danger      — rouge (rupture, 90j+ retard, dette critique)
 *   • info        — bleu (institutionnel, hospitalier)
 *   • violet      — violet (en préparation, RFQ, statut workflow)
 *   • orange      — orange capsule (action requise, admin signal)
 *   • demand      — violet soft (prix sur demande)
 *   • neutral     — gris (default)
 */
const TONE_STYLES: Record<Tone, string> = {
  neutral: "bg-panel text-ink-3 border border-line",
  ok: "bg-success/15 text-success-2",
  warn: "bg-warn/15 text-warn",
  danger: "bg-danger/15 text-danger",
  info: "bg-info/15 text-info",
  violet: "bg-violet/15 text-violet",
  orange: "bg-brand-orange-soft text-brand-orange",
  demand: "bg-violet/15 text-violet",
};

const BULLET_COLORS: Record<Tone, string> = {
  neutral: "bg-ink-4",
  ok: "bg-success-2",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  violet: "bg-violet",
  orange: "bg-brand-orange",
  demand: "bg-violet",
};

export function Pill({ tone = "neutral", bullet, pulse, children, className }: PillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-[11px] font-bold tracking-wider",
        TONE_STYLES[tone],
        className,
      )}
    >
      {bullet && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            BULLET_COLORS[tone],
            pulse && "animate-pulse-soft",
          )}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
