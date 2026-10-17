"use client";

import { Select, Tag, cx } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import type { AnalyticAxis, AnalyticShare } from "@/lib/finance-types";

/** Choix d'un compte par axe : clé de l'axe -> identifiant du compte analytique ("" : aucun). */
export type AxisChoice = Record<string, string>;

/** Axes de la société de travail et leurs comptes (activité, centre de coût, axes des métiers). */
export function useAxes(enabled = true) {
  return useApi<AnalyticAxis[]>(enabled ? "/finance/analytic-axes" : null);
}

/** Répartition {id: 100} par axe renseigné : la ligne entière est imputée au compte choisi sur chaque axe. */
export function toDistribution(choice: AxisChoice): Record<string, number> | undefined {
  const ids = Object.values(choice).filter(Boolean);
  if (!ids.length) return undefined;
  return Object.fromEntries(ids.map((id) => [id, 100]));
}

/** Choix par axe relu d'une répartition (le compte de plus forte part sur chaque axe). */
export function fromDistribution(axes: AnalyticAxis[] | undefined, dist: Record<string, number> | null | undefined): AxisChoice {
  const choice: AxisChoice = {};
  if (!axes || !dist) return choice;
  const best: Record<string, number> = {};
  for (const [key, pct] of Object.entries(dist)) {
    for (const part of key.split(",")) {
      const axis = axes.find((a) => a.accounts.some((acc) => String(acc.id) === part));
      if (axis && pct > (best[axis.key] ?? 0)) {
        best[axis.key] = pct;
        choice[axis.key] = part;
      }
    }
  }
  return choice;
}

/** Libellé d'un compte analytique : code et nom. */
export function analyticLabel(account: { name: string; code: string | null }) {
  return account.code ? `${account.code} ${account.name}` : account.name;
}

/**
 * Un sélecteur par axe applicable à la société de travail. Les centres de coût se filtrent sur
 * l'activité choisie ; choisir un centre de coût rattaché à une activité la renseigne d'office.
 */
export function AnalyticFields({
  axes,
  value,
  onChange,
  className,
  compact,
}: {
  axes: AnalyticAxis[] | undefined;
  value: AxisChoice;
  onChange: (next: AxisChoice) => void;
  className?: string;
  /** Sans libellé au-dessus du champ : le nom de l'axe sert d'invite. */
  compact?: boolean;
}) {
  if (!axes?.length) return null;
  const activity = value.activite ?? "";
  const centers = axes.find((a) => a.key === "centre_cout")?.accounts ?? [];

  function change(key: string, id: string) {
    const next: AxisChoice = { ...value, [key]: id };
    if (key === "centre_cout" && id) {
      const center = centers.find((c) => String(c.id) === id);
      if (center?.activity_id && !next.activite) next.activite = String(center.activity_id);
    }
    if (key === "activite" && id && next.centre_cout) {
      const center = centers.find((c) => String(c.id) === next.centre_cout);
      if (center?.activity_id && String(center.activity_id) !== id) next.centre_cout = "";
    }
    onChange(next);
  }

  return (
    <div className={cx("grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6", className)}>
      {axes.map((axis) => {
        let accounts = axis.accounts.filter((a) => a.active || String(a.id) === value[axis.key]);
        if (axis.key === "centre_cout" && activity) {
          accounts = accounts.filter((a) => !a.activity_id || String(a.activity_id) === activity || String(a.id) === value[axis.key]);
        }
        const select = (
          <Select
            aria-label={axis.label}
            value={value[axis.key] ?? ""}
            onChange={(e) => change(axis.key, e.target.value)}
            placeholder={compact ? `${axis.label} : –` : "–"}
            options={accounts.map((a) => ({ value: a.id, label: analyticLabel(a) }))}
            className="min-h-8 py-1 text-[13px]"
          />
        );
        return compact ? (
          <div key={axis.key}>{select}</div>
        ) : (
          <label key={axis.key} className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-muted">{axis.label}</span>
            {select}
          </label>
        );
      })}
    </div>
  );
}

/** Répartition affichée en étiquettes : axe, compte et part si elle n'est pas entière. */
export function AnalyticTags({ shares }: { shares: AnalyticShare[] | undefined }) {
  if (!shares?.length) return <span className="text-muted">–</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {shares.map((s) => (
        <Tag key={`${s.id}-${s.percentage}`}>
          <span className="text-muted">{s.plan} :</span>&nbsp;{s.name}
          {Math.round(s.percentage) !== 100 ? ` (${Math.round(s.percentage)} %)` : ""}
        </Tag>
      ))}
    </div>
  );
}
