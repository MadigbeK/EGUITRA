import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "violet" | "orange";

interface KpiCardProps {
  /** Petit label uppercase tracking-wide en haut */
  label: string;
  /** Valeur principale (chiffre / montant) */
  value: ReactNode;
  /** Unité optionnelle (GNF, %, j) en petit après value */
  unit?: string;
  /** Sous-texte sous la valeur */
  meta?: ReactNode;
  /** Delta vs période précédente (↑ vert / ↓ rouge) */
  delta?: { value: string; direction?: "up" | "down" | "neutral" };
  /** Couleur du dot/label (sémantique de la card) */
  tone?: Tone;
  /** Spark mini-chart en haut à droite */
  spark?: ReactNode;
  className?: string;
}

const LABEL_TONE: Record<Tone, string> = {
  neutral: "text-ink-4",
  ok: "text-brand-green-vif",
  warn: "text-warn",
  danger: "text-danger",
  info: "text-info",
  violet: "text-violet",
  orange: "text-brand-orange",
};

const DOT_BG: Record<Tone, string> = {
  neutral: "bg-ink-4 shadow-[0_0_0_3px_oklch(48%_0.014_250_/_.2)]",
  ok: "bg-brand-green-vif shadow-[0_0_0_3px_oklch(60%_0.180_145_/_.2)]",
  warn: "bg-warn shadow-[0_0_0_3px_oklch(76%_0.135_80_/_.2)]",
  danger: "bg-danger shadow-[0_0_0_3px_oklch(64%_0.180_25_/_.2)]",
  info: "bg-info shadow-[0_0_0_3px_oklch(70%_0.110_230_/_.2)]",
  violet: "bg-violet shadow-[0_0_0_3px_oklch(70%_0.130_290_/_.2)]",
  orange: "bg-brand-orange shadow-[0_0_0_3px_oklch(72%_0.180_55_/_.2)]",
};

export function KpiCard({
  label,
  value,
  unit,
  meta,
  delta,
  tone = "neutral",
  spark,
  className,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-line bg-bg-2 px-5 py-4 shadow-soft",
        className,
      )}
    >
      {/* Label avec dot coloré */}
      <div
        className={cn(
          "mb-2.5 flex items-center gap-2 text-2xs font-bold uppercase tracking-widest",
          LABEL_TONE[tone],
        )}
      >
        <span
          className={cn("h-1.5 w-1.5 rounded-full", DOT_BG[tone])}
          aria-hidden="true"
        />
        {label}
      </div>

      {/* Valeur + unité */}
      <div className="font-display text-2xl font-bold leading-none tracking-tight text-ink num">
        {value}
        {unit && (
          <span className="ml-1.5 text-sm font-medium text-ink-3 num">{unit}</span>
        )}
      </div>

      {/* Meta */}
      {meta && <div className="mt-2 text-xs text-ink-3">{meta}</div>}

      {/* Delta vs P-1 */}
      {delta && (
        <div
          className={cn(
            "mt-1.5 inline-flex items-center gap-1 font-mono text-xs",
            delta.direction === "down"
              ? "text-danger"
              : delta.direction === "neutral"
                ? "text-ink-3"
                : "text-brand-green-vif",
          )}
        >
          {delta.direction === "down" ? "↓" : delta.direction === "neutral" ? "→" : "↑"}{" "}
          {delta.value}
        </div>
      )}

      {/* Spark en absolute top-right */}
      {spark && (
        <div className="absolute right-3.5 top-3.5 h-8 w-20 opacity-90">{spark}</div>
      )}
    </div>
  );
}
