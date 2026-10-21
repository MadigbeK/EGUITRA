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
  // Mot de passe provisoire : l'API refuse tout appel tant qu'il n'est pas remplacé, l'en-tête attend.
  const ouvert = app === "finance" && !me.password_change_required && me.profiles.some((p) => PROFILS_FINANCE.includes(p));
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
      className={cx("hidden h-10 items-center gap-2 rounded-full p-0.5 text-[13px] font-medium md:flex 2xl:pr-3.5", data.balanced ? "text-ink-2" : "bg-danger-doux text-danger")}
    >
      <span className={cx("grid h-9 w-9 flex-none place-items-center rounded-full", data.balanced ? "bg-ok-doux text-ok shadow-[0_0_0_3px_var(--bg),0_0_0_4px_rgb(12_122_82/0.25)]" : "bg-danger text-white")}>
        {data.balanced ? <Check className="h-4 w-4" strokeWidth={2.4} /> : <TriangleAlert className="h-4 w-4" />}
      </span>
      <span className={cx("whitespace-nowrap", data.balanced ? "hidden 2xl:inline" : "hidden xl:inline")}>
        Exercice {data.fiscal_year.start.slice(0, 4)} : {data.balanced ? "débit = crédit" : `écart ${fmtGNF(data.difference)}`}
      </span>
      <span className="sr-only">{titre}</span>
    </span>
  );
}
