"use client";

/**
 * En-tête d'EGUITRA Finance : équilibre des débits et des crédits de l'exercice de la société de
 * travail, et pastilles de la navigation (alertes actives, validations qui attendent l'utilisateur,
 * contrôles du mois écoulé en anomalie). Réservé aux profils de la finance et de la direction ;
 * rafraîchi toutes les cinq minutes.
 */

import { Check, TriangleAlert } from "@/components/icons";
import { cx } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import type { AppCode } from "@/lib/config";
import type { NavBadge } from "@/lib/nav";
import type { Me } from "@/lib/types";
import { fmtGNF } from "@/lib/format";

export interface EnTeteFinance {
  company: string;
  fiscal_year: { start: string; end: string };
  debit: number;
  credit: number;
  difference: number;
  balanced: boolean;
  badges: { alerts: number; alerts_severe: number; approvals: number; controls: number; controls_blocking: number };
}

const PROFILS_FINANCE = ["admin", "direction", "finance"];

export function useEnTeteFinance(app: AppCode, me: Me): EnTeteFinance | undefined {
  const ouvert = app === "finance" && me.profiles.some((p) => PROFILS_FINANCE.includes(p));
  const { data } = useApi<EnTeteFinance>(ouvert ? "/finance/shell" : null, { refreshInterval: 300_000, dedupingInterval: 60_000 });
  return data;
}

/** Pastilles de la navigation : nombre et gravité (rouge si bloquant ou critique). */
export function pastilles(data: EnTeteFinance | undefined): Partial<Record<NavBadge, { count: number; severe: boolean }>> {
  if (!data) return {};
  const b = data.badges;
  return {
    alerts: { count: b.alerts, severe: b.alerts_severe > 0 },
    approvals: { count: b.approvals, severe: false },
    controls: { count: b.controls, severe: b.controls_blocking > 0 },
  };
}

/** Indicateur d'équilibre : « Exercice 2026 · D = C » ou l'écart, totaux au survol. */
export function EquilibreExercice({ data }: { data: EnTeteFinance | undefined }) {
  if (!data) return null;
  const titre = `Exercice ${data.fiscal_year.start.slice(0, 4)}, ${data.company} : débits ${fmtGNF(data.debit)}, crédits ${fmtGNF(data.credit)}`;
  return (
    <span
      title={titre}
      className={cx(
        "hidden items-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] font-medium md:flex",
        data.balanced ? "border-line bg-panel text-ink-2" : "border-danger/30 bg-danger-doux text-danger",
      )}
    >
      {data.balanced ? <Check className="h-4 w-4 text-ok" /> : <TriangleAlert className="h-4 w-4" />}
      <span className="whitespace-nowrap">
        Exercice {data.fiscal_year.start.slice(0, 4)} · {data.balanced ? "débit = crédit" : `écart ${fmtGNF(data.difference)}`}
      </span>
      <span className="sr-only">{titre}</span>
    </span>
  );
}
