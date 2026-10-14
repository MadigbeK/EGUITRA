"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { BarChart, Card, DataTable, ErrorBox, Kpi, Loading, PageHeader, ProgressBar, type Tone } from "@/components/ui";
import { ScopeToggle } from "@/components/finance/ScopeToggle";
import { useApi } from "@/lib/api-client";
import type { Dashboard } from "@/lib/finance-types";
import { fmtDate, fmtDec, fmtGNF, fmtMonth, fmtPct, fmtShort } from "@/lib/format";

const SEVERITY: Record<string, { tone: Tone; icon: typeof Info; label: string }> = {
  blocking: { tone: "danger", icon: ShieldAlert, label: "Bloquante" },
  warning: { tone: "warn", icon: AlertTriangle, label: "Attention" },
  info: { tone: "accent", icon: Info, label: "Information" },
};

export default function DirectorDashboard() {
  const [scope, setScope] = useState<"company" | "group">("company");
  const { data: d, error, isLoading, mutate } = useApi<Dashboard>(`/finance/dashboard?scope=${scope}`);

  return (
    <div>
      <PageHeader
        title="Tableau de bord du dirigeant"
        subtitle={d ? `Exercice ${d.fiscal_year.start.slice(0, 4)}, écritures validées au ${fmtDate(d.as_of)}, montants hors taxes en GNF.` : "Indicateurs calculés à chaque saisie."}
        actions={<ScopeToggle value={scope} onChange={setScope} />}
      />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {isLoading && !d && <Loading />}
      {d && <DashboardBody d={d} />}
    </div>
  );
}

function DashboardBody({ d }: { d: Dashboard }) {
  const variation = d.revenue_prev_month ? ((d.revenue_month - d.revenue_prev_month) / Math.abs(d.revenue_prev_month)) * 100 : null;
  const aging = d.receivables.aging;
  const agingTotal = Math.max(1, Object.values(aging).reduce((a, b) => a + Math.max(0, b), 0));

  return (
    <div className="space-y-6">
      {d.alerts.length > 0 && (
        <Card title={`Alertes actives (${d.alerts.length})`}>
          <ul className="space-y-2">
            {d.alerts.map((a, i) => {
              const s = SEVERITY[a.severity] ?? SEVERITY.info!;
              const Icon = s.icon;
              const body = (
                <div className="flex items-start gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2">
                  <Icon className={`mt-0.5 h-4 w-4 flex-none text-${s.tone === "danger" ? "danger" : s.tone === "warn" ? "warn" : "accent"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">
                      {a.title} <span className="text-xs font-normal text-muted">· {a.company}</span>
                    </div>
                    <div className="text-xs text-muted">
                      {a.message}
                      {a.value !== null && ` (${fmtGNF(a.value)})`}
                    </div>
                  </div>
                  <span className="text-[11px] text-muted">{s.label}</span>
                </div>
              );
              return <li key={i}>{a.link ? <Link href={a.link}>{body}</Link> : body}</li>;
            })}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Chiffre d'affaires de l'exercice" value={fmtShort(d.revenue_fy)} hint={fmtGNF(d.revenue_fy)} tone="ok" />
        <Kpi
          label="Chiffre d'affaires du mois"
          value={fmtShort(d.revenue_month)}
          hint={variation === null ? "Pas de mois de comparaison" : `${variation >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(variation))} par rapport au mois précédent`}
          tone={variation !== null && variation < 0 ? "warn" : "ok"}
        />
        <Kpi label="Résultat de l'exercice" value={fmtShort(d.net_result_fy)} hint={`EBE : ${fmtShort(d.ebe_fy)}`} tone={d.net_result_fy >= 0 ? "ok" : "danger"} />
        <Kpi label="Trésorerie nette" value={fmtShort(d.cash)} hint={`${d.cash_by_journal.length} compte(s) de banque et caisse`} tone={d.cash >= 0 ? "neutral" : "danger"} />
        <Kpi label="Encours clients" value={fmtShort(d.receivables.total)} hint={`${d.receivables.documents} pièce(s), dont ${fmtShort(d.receivables.overdue)} échu`} tone={d.receivables.overdue > 0 ? "warn" : "neutral"} />
        <Kpi label="Encours fournisseurs" value={fmtShort(d.payables.total)} hint={`${d.payables.documents} pièce(s), dont ${fmtShort(d.payables.overdue)} échu`} />
        <Kpi label="Dette financière" value={fmtShort(d.debt.outstanding)} hint={d.debt.next_due_date ? `Prochaine échéance ${fmtDate(d.debt.next_due_date)} : ${fmtShort(d.debt.next_due_amount)}` : "Aucune échéance à venir"} />
        <Kpi
          label="DSCR (12 mois)"
          value={d.dscr === null ? "—" : fmtDec(Math.round(d.dscr * 100) / 100)}
          hint="EBE / service de la dette"
          tone={d.dscr === null ? "neutral" : d.dscr >= 1.2 ? "ok" : d.dscr >= 1 ? "warn" : "danger"}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Chiffre d'affaires facturé par mois" className="xl:col-span-2">
          <BarChart data={d.revenue_by_month.map((m) => ({ label: fmtMonth(m.month).split(" ")[0] ?? m.month, value: m.amount }))} format={(v) => fmtGNF(v)} />
        </Card>
        <Card title="Trésorerie par compte">
          {d.cash_by_journal.length === 0 ? (
            <p className="text-sm text-muted">Aucun compte de trésorerie.</p>
          ) : (
            <ul className="space-y-2">
              {d.cash_by_journal.map((c) => (
                <li key={c.journal_id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-ink-2">{c.name}</span>
                  <span className="tabular font-mono">
                    {c.currency !== "GNF" ? `${fmtDec(c.balance_currency)} ${c.currency}` : fmtGNF(c.balance)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Ancienneté des créances clients">
          <div className="space-y-3">
            {(
              [
                ["non_echu", "Non échu", "ok"],
                ["1_30", "1 à 30 jours", "accent"],
                ["31_60", "31 à 60 jours", "warn"],
                ["61_90", "61 à 90 jours", "warn"],
                ["plus_90", "Plus de 90 jours", "danger"],
              ] as const
            ).map(([key, label, tone]) => (
              <div key={key}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-ink-2">{label}</span>
                  <span className="tabular font-mono text-ink">{fmtGNF(aging[key])}</span>
                </div>
                <ProgressBar value={(Math.max(0, aging[key]) / agingTotal) * 100} tone={tone} />
              </div>
            ))}
          </div>
        </Card>
        <Card title="Résultat par activité" padded={false}>
          <DataTable
            rows={d.by_activity}
            rowKey={(r) => r.analytic_account_id}
            empty="Imputez les pièces sur l'axe Activité pour voir ce tableau."
            columns={[
              { key: "name", label: "Activité" },
              { key: "income", label: "Produits", align: "right", render: (r) => fmtShort(r.income) },
              { key: "expense", label: "Charges", align: "right", render: (r) => fmtShort(r.expense) },
              { key: "margin", label: "Marge", align: "right", render: (r) => <span className={r.margin < 0 ? "text-danger" : "text-ok"}>{fmtShort(r.margin)}</span> },
              { key: "margin_rate", label: "Taux", align: "right", render: (r) => fmtPct(r.margin_rate) },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
