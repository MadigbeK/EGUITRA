"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "@/components/icons";
import { Badge, Card, DataTable, Etat, Tabs } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { tonEtat } from "@/lib/couleurs";
import { fmtDate, fmtGNF, fmtInt, fmtPct } from "@/lib/format";
import { TableauEcarts } from "./Operation";
import { ETATS_BUDGET, type Budget, type BudgetDetail, type Ecarts, type SyntheseVoyage } from "./types";

type Vue = "to_approve" | "to_disburse" | "to_justify" | "variances" | "all";

interface VoyageLigne {
  id: number;
  name: string;
  vehicle: { id: number; name: string };
  driver: { id: number; name: string } | null;
  route: { id: number; name: string };
  client: { id: number; name: string };
  summary: SyntheseVoyage;
  variances: Ecarts;
}

interface Reponse { view: Vue; budgets?: Array<Budget | BudgetDetail>; rotations?: VoyageLigne[] }

const ONGLETS: Array<{ key: Vue; label: string }> = [
  { key: "to_approve", label: "À approuver" },
  { key: "to_disburse", label: "À décaisser" },
  { key: "to_justify", label: "À justifier" },
  { key: "variances", label: "Écarts" },
  { key: "all", label: "Tous les budgets" },
];

const lienOperation = (id: number, nom: string) => (
  <Link className="inline-flex items-center gap-1 font-mono text-xs text-accent underline" href={`/transport/operations?id=${id}`}>{nom}<ArrowUpRight className="h-3 w-3" /></Link>
);

/**
 * Budgets de voyage : listes de travail. L'approbation, le décaissement et la justification se font dans la
 * fiche de l'opération (lien), où sont le détail, les bons carburant et les pièces.
 */
export function BudgetsVoyage({ vues, initiale = "to_approve" }: { vues?: Vue[]; initiale?: Vue }) {
  const onglets = ONGLETS.filter((o) => !vues || vues.includes(o.key));
  const [vue, setVue] = useState<Vue>(initiale);
  const { data, error, mutate } = useApi<Reponse>(`/transport/budgets?view=${vue}`, { keepPreviousData: true });
  return (
    <div>
      <Tabs tabs={onglets} value={vue} onChange={setVue} />
      <Card padded={false}>
        {!data || data.view !== vue ? <Etat error={error} onRetry={() => mutate()} /> : data.budgets ? (
          <DataTable
            rows={data.budgets}
            rowKey={(b) => b.id}
            empty={vue === "to_approve" ? "Aucun budget en attente d'approbation." : vue === "to_disburse" ? "Aucune avance à décaisser." : "Aucun budget."}
            columns={[
              { key: "op", label: "Opération", render: (b) => lienOperation(b.rotation.id, b.rotation.name) },
              { key: "name", label: "Budget", render: (b) => `${b.name} · ${b.label}${b.reason ? ` : ${b.reason}` : ""}` },
              { key: "vehicle", label: "Ensemble", render: (b) => b.rotation.vehicle.name },
              { key: "driver", label: "Chauffeur", render: (b) => b.rotation.driver?.name ?? "–" },
              { key: "route", label: "Route", render: (b) => b.rotation.route.name },
              { key: "date", label: "Date", render: (b) => fmtDate(b.date) },
              { key: "nature", label: "En nature", align: "right", render: (b) => fmtInt(b.amount_nature) },
              { key: "cash", label: "En espèces", align: "right", render: (b) => fmtInt(b.amount_cash) },
              { key: "total", label: "Total", align: "right", render: (b) => fmtInt(b.amount_total) },
              { key: "state", label: "Statut", render: (b) => {
                const approval = "approval" in b ? b.approval : null;
                return (
                  <span className="flex flex-wrap items-center gap-1">
                    <Badge tone={tonEtat(ETATS_BUDGET[b.state])}>{ETATS_BUDGET[b.state]}</Badge>
                    {approval?.pending_with && <span className="text-[12px] text-muted">chez {approval.pending_with}</span>}
                    {approval?.can_decide && <Badge tone="warn">À vous</Badge>}
                  </span>
                );
              } },
            ]}
          />
        ) : (
          <DataTable
            rows={data.rotations ?? []}
            rowKey={(r) => r.id}
            empty={vue === "to_justify" ? "Aucune opération à justifier." : "Aucune opération clôturée."}
            columns={[
              { key: "op", label: "Opération", render: (r) => lienOperation(r.id, r.name) },
              { key: "vehicle", label: "Ensemble", render: (r) => r.vehicle.name },
              { key: "driver", label: "Chauffeur", render: (r) => r.driver?.name ?? "–" },
              { key: "route", label: "Route", render: (r) => r.route.name },
              { key: "advance", label: "Avance", align: "right", render: (r) => fmtInt(r.summary.advance) },
              { key: "spent", label: "Dépensé", align: "right", render: (r) => fmtInt(r.summary.cash_spent) },
              { key: "balance", label: "Reliquat (+) ou dépassement (-)", align: "right", render: (r) => <span className={r.summary.balance < 0 ? "text-danger" : ""}>{fmtInt(r.summary.balance)}</span> },
              { key: "budget", label: "Budget total", align: "right", render: (r) => fmtInt(r.variances.budget) },
              { key: "actual", label: "Réel", align: "right", render: (r) => fmtInt(r.variances.actual) },
              { key: "gap", label: "Écart", align: "right", render: (r) => (
                <span className={r.variances.gap > 0 ? "font-semibold text-danger" : ""} title={r.variances.gap_pct !== null ? fmtPct(r.variances.gap_pct) : undefined}>{fmtInt(r.variances.gap)}</span>
              ) },
            ]}
          />
        )}
      </Card>
      {vue === "variances" && data?.rotations && data.rotations.length > 0 && (
        <Card title="Écarts par rubrique (opérations clôturées affichées)" className="mt-4">
          <TableauEcarts ecarts={cumul(data.rotations.map((r) => r.variances))} />
          <p className="mt-2 text-[12.5px] text-muted">Total réel : {fmtGNF(data.rotations.reduce((s, r) => s + r.variances.actual, 0))}.</p>
        </Card>
      )}
    </div>
  );
}

/** Écarts cumulés de plusieurs opérations, par rubrique. */
function cumul(liste: Ecarts[]): Ecarts {
  const parRubrique = new Map<number, Ecarts["rows"][number]>();
  for (const e of liste) {
    for (const r of e.rows) {
      const x = parRubrique.get(r.rubric.id) ?? { rubric: r.rubric, budget: 0, actual: 0, gap: 0, gap_pct: null };
      x.budget += r.budget;
      x.actual += r.actual;
      x.gap = x.actual - x.budget;
      parRubrique.set(r.rubric.id, x);
    }
  }
  const budget = liste.reduce((s, e) => s + e.budget, 0);
  const actual = liste.reduce((s, e) => s + e.actual, 0);
  return { rows: [...parRubrique.values()], budget, actual, gap: actual - budget, gap_pct: budget ? ((actual - budget) / budget) * 100 : null };
}
