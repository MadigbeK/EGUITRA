"use client";

import { useState } from "react";
import { Printer } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Loading, PageHeader, cx } from "@/components/ui";
import { ScopeToggle } from "@/components/finance/ScopeToggle";
import { useApi } from "@/lib/api-client";
import type { Alert, CashAccount, Dashboard, Ref } from "@/lib/finance-types";
import { fmtDate, fmtDec, fmtGNF, fmtInt, fmtMonth, fmtPct, fmtShort } from "@/lib/format";

interface Report {
  month: string;
  period: { start: string; end: string; fiscal_year_start: string };
  companies: Ref[];
  kpis: {
    revenue_month: number;
    revenue_prev_month: number;
    revenue_fy: number;
    net_result_fy: number;
    ebe_fy: number;
    cash: number;
    receivables: number;
    receivables_overdue: number;
    payables: number;
    dscr: number | null;
  };
  income: Array<{ code: string; label: string; month: number; month_last_year: number; ytd: number; ytd_last_year: number }>;
  by_activity: Dashboard["by_activity"];
  cash_by_journal: CashAccount[];
  cash_flow: Record<"ZA" | "ZB" | "ZC" | "ZF" | "ZG" | "ZH", number>;
  transport: Array<{ key: number | null; label: string; rotations: number; volume: number; revenue: number; cost: number; margin: number; margin_rate: number | null }>;
  debt: Dashboard["debt"];
  alerts: Alert[];
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

function delta(current: number, previous: number) {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export default function ManagementReportPage() {
  const [month, setMonth] = useState(thisMonth());
  const [scope, setScope] = useState<"company" | "group">("company");
  const { data: r, error } = useApi<Report>(`/finance/management-report?month=${month}&scope=${scope}`);
  return (
    <div>
      <PageHeader
        title={`Rapport mensuel de gestion${r ? ` : ${fmtMonth(r.month)}` : ""}`}
        subtitle={r ? `${r.companies.map((c) => c.name).join(", ")}, exercice ouvert le ${fmtDate(r.period.fiscal_year_start)}, montants en GNF` : "Synthèse mensuelle pour la direction générale."}
        actions={
          <>
            <Field label="Mois"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value || thisMonth())} /></Field>
            <ScopeToggle value={scope} onChange={setScope} />
            <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimer</Button>
          </>
        }
      />
      {error && <ErrorBox error={error} />}
      {!r && !error && <Loading />}
      {r && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Kpi label="Chiffre d'affaires du mois" value={fmtShort(r.kpis.revenue_month)} hint={(() => { const d = delta(r.kpis.revenue_month, r.kpis.revenue_prev_month); return d === null ? "Mois précédent sans chiffre d'affaires" : `${d >= 0 ? "+" : ""}${fmtPct(d)} sur le mois précédent`; })()} tone="accent" />
            <Kpi label="Chiffre d'affaires cumulé" value={fmtShort(r.kpis.revenue_fy)} />
            <Kpi label="Résultat net cumulé" value={fmtShort(r.kpis.net_result_fy)} hint={`EBE ${fmtShort(r.kpis.ebe_fy)}`} tone={r.kpis.net_result_fy >= 0 ? "ok" : "danger"} />
            <Kpi label="Trésorerie fin de mois" value={fmtShort(r.kpis.cash)} tone="accent" />
            <Kpi label="Encours clients" value={fmtShort(r.kpis.receivables)} hint={`dont échu ${fmtShort(r.kpis.receivables_overdue)}`} tone={r.kpis.receivables_overdue ? "warn" : "neutral"} />
            <Kpi label="Dettes fournisseurs" value={fmtShort(r.kpis.payables)} />
            <Kpi label="Capital restant dû" value={fmtShort(r.debt.outstanding)} hint={r.debt.next_due_date ? `Prochaine échéance ${fmtDate(r.debt.next_due_date)}` : undefined} />
            <Kpi label="DSCR" value={r.kpis.dscr === null ? "–" : fmtDec(r.kpis.dscr)} hint="EBE 12 mois / service de la dette" tone={r.kpis.dscr !== null && r.kpis.dscr < 1.2 ? "danger" : "ok"} />
          </div>

          <Card title="Résultat : le mois et le cumul, comparés à l'an dernier" padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-[12.5px] font-medium text-muted">
                    <th className="px-3 py-2 text-left">Solde</th>
                    <th className="px-3 py-2 text-right">Mois</th>
                    <th className="px-3 py-2 text-right">Même mois N-1</th>
                    <th className="px-3 py-2 text-right">Cumul</th>
                    <th className="px-3 py-2 text-right">Cumul N-1</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {r.income.map((l) => (
                    <tr key={l.code} className={cx("border-b border-line/50", (l.code === "XB" || l.code === "XI") && "font-semibold")}>
                      <td className="px-3 py-1.5">{l.label}</td>
                      {[l.month, l.month_last_year, l.ytd, l.ytd_last_year].map((v, i) => (
                        <td key={i} className={cx("px-3 py-1.5 text-right font-mono", v < 0 && "text-danger", i % 2 === 1 && "text-muted")}>{fmtInt(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card title="Activités (cumul de l'exercice)" padded={false}>
              <DataTable dense rows={r.by_activity} rowKey={(a) => a.analytic_account_id} empty="Aucune imputation par activité." columns={[
                { key: "name", label: "Activité" },
                { key: "income", label: "Produits", align: "right", render: (a) => fmtInt(a.income) },
                { key: "expense", label: "Charges", align: "right", render: (a) => fmtInt(a.expense) },
                { key: "margin", label: "Marge", align: "right", render: (a) => <span className={a.margin < 0 ? "text-danger" : undefined}>{fmtInt(a.margin)}</span> },
                { key: "margin_rate", label: "Taux", align: "right", render: (a) => (a.margin_rate === null ? "–" : fmtPct(a.margin_rate)) },
              ]} />
            </Card>
            <Card title="Flux de trésorerie cumulés" padded={false}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody className="tabular">
                    {([["ZA", "Trésorerie nette à l'ouverture"], ["ZB", "Flux opérationnels"], ["ZC", "Flux d'investissement"], ["ZF", "Flux de financement"], ["ZG", "Variation de la trésorerie"], ["ZH", "Trésorerie nette fin de mois"]] as const).map(([code, label]) => (
                      <tr key={code} className={cx("border-b border-line/50", (code === "ZA" || code === "ZH") && "font-semibold")}>
                        <td className="px-3 py-1.5">{label}</td>
                        <td className={cx("px-3 py-1.5 text-right font-mono", r.cash_flow[code] < 0 && "text-danger")}>{fmtInt(r.cash_flow[code])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card title="Trésorerie par compte" padded={false}>
              <DataTable dense rows={r.cash_by_journal} rowKey={(c) => c.journal_id} empty="Aucun compte de trésorerie." columns={[
                { key: "name", label: "Compte" },
                { key: "company", label: "Société" },
                { key: "balance", label: "Solde", align: "right", render: (c) => fmtGNF(c.balance) },
              ]} />
            </Card>
            <Card title="Transport : le mois par ensemble routier" padded={false}>
              <DataTable dense rows={r.transport} rowKey={(t) => t.key ?? t.label} empty="Aucune rotation validée ce mois." columns={[
                { key: "label", label: "Ensemble" },
                { key: "rotations", label: "Rotations", align: "right" },
                { key: "volume", label: "Volume (m³)", align: "right", render: (t) => fmtDec(t.volume) },
                { key: "revenue", label: "Chiffre d'affaires", align: "right", render: (t) => fmtInt(t.revenue) },
                { key: "margin", label: "Marge", align: "right", render: (t) => <span className={t.margin < 0 ? "text-danger" : undefined}>{fmtInt(t.margin)}</span> },
              ]} />
            </Card>
          </div>

          <Card title="Alertes actives à la fin du mois">
            {r.alerts.length === 0 ? <p className="text-sm text-muted">Aucune alerte.</p> : (
              <ul className="space-y-2 text-sm">
                {r.alerts.map((a, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Badge tone={a.severity === "blocking" ? "danger" : a.severity === "warning" ? "warn" : "accent"}>{a.severity === "blocking" ? "Bloquant" : a.severity === "warning" ? "Attention" : "Information"}</Badge>
                    <span><b>{a.title}</b> : {a.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
