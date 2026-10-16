"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { AlertTriangle, Baisse, Hausse, Info, ShieldAlert } from "@/components/icons";
import { BarChart, Card, Compteur, DataTable, ErrorBox, Loading, PageHeader, Repartition, cx, type Tone } from "@/components/ui";
import { ScopeToggle } from "@/components/finance/ScopeToggle";
import { useApi } from "@/lib/api-client";
import type { Dashboard } from "@/lib/finance-types";
import { fmtDate, fmtDec, fmtGNF, fmtMonth, fmtPct, fmtShort } from "@/lib/format";

const SEVERITY: Record<string, { tone: Tone; icon: typeof Info; label: string; color: string }> = {
  blocking: { tone: "danger", icon: ShieldAlert, label: "Bloquante", color: "text-danger" },
  warning: { tone: "warn", icon: AlertTriangle, label: "Attention", color: "text-warn" },
  info: { tone: "accent", icon: Info, label: "Information", color: "text-accent" },
};

/** Ancienneté des créances : vert pour le non échu, puis une rampe latérite de plus en plus sombre. */
const AGING: Array<[keyof Dashboard["receivables"]["aging"], string, string]> = [
  ["non_echu", "Non échu", "#22634c"],
  ["1_30", "Échu de 1 à 30 jours", "#ddaa95"],
  ["31_60", "Échu de 31 à 60 jours", "#c47a61"],
  ["61_90", "Échu de 61 à 90 jours", "#a54d37"],
  ["plus_90", "Échu depuis plus de 90 jours", "#7a2919"],
];

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
      {isLoading && !d && <Loading label="Calcul des indicateurs…" />}
      {d && <DashboardBody d={d} />}
    </div>
  );
}

function DashboardBody({ d }: { d: Dashboard }) {
  const variation = d.revenue_prev_month ? ((d.revenue_month - d.revenue_prev_month) / Math.abs(d.revenue_prev_month)) * 100 : null;
  const aging = d.receivables.aging;

  return (
    <div className="space-y-5">
      {d.alerts.length > 0 && (
        <Card title={`Alertes actives (${d.alerts.length})`} padded={false}>
          <ul className="divide-y divide-line px-5 pb-2">
            {d.alerts.map((a, i) => {
              const s = SEVERITY[a.severity] ?? SEVERITY.info!;
              const Icon = s.icon;
              const body = (
                <div className={cx("flex items-start gap-3 py-3", a.link && "group")}>
                  <Icon className={cx("mt-0.5 h-4 w-4 flex-none", s.color)} />
                  <div className="min-w-0 flex-1">
                    <div className={cx("text-sm font-semibold text-ink", a.link && "group-hover:underline group-hover:underline-offset-2")}>{a.title}</div>
                    <div className="mt-0.5 text-[13px] leading-snug text-muted">
                      {a.company}, {a.message}
                      {a.value !== null && ` (${fmtGNF(a.value)})`}
                    </div>
                  </div>
                  <span className={cx("whitespace-nowrap text-[12.5px] font-medium", s.color)}>{s.label}</span>
                </div>
              );
              return <li key={i}>{a.link ? <Link href={a.link} className="block rounded-md">{body}</Link> : body}</li>;
            })}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Le chiffre de l'écran : la trésorerie nette, au compteur. */}
        <section className="min-w-0 rounded-xl bg-panel p-6 xl:col-span-7">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="font-display text-[17px] font-semibold text-ink">Trésorerie nette</h2>
            <span className="text-[12.5px] text-muted">
              {d.cash_by_journal.length} compte{d.cash_by_journal.length > 1 ? "s" : ""} de banque et caisse, au {fmtDate(d.as_of)}
            </span>
          </div>
          <Compteur value={d.cash} className={cx("mt-6 text-[34px] sm:text-[46px] xl:text-[54px] 2xl:text-[60px]", d.cash < 0 ? "text-danger" : "text-ink")} />
          {d.cash_by_journal.length === 0 ? (
            <p className="mt-6 text-sm text-muted">Aucun compte de trésorerie.</p>
          ) : (
            <ul className="mt-7 divide-y divide-line border-t border-line">
              {d.cash_by_journal.map((c) => (
                <li key={c.journal_id} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
                  <span className="min-w-0 truncate text-ink-2">
                    {c.name}
                    <span className="ml-2 text-[12px] text-muted">{c.type === "cash" ? "Caisse" : "Banque"}</span>
                  </span>
                  <span className={cx("font-mono", c.balance < 0 ? "text-danger" : "text-ink")}>
                    {c.currency !== "GNF" ? `${fmtDec(c.balance_currency)} ${c.currency}` : fmtGNF(c.balance)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="min-w-0 rounded-xl bg-panel px-6 pb-3 pt-5 xl:col-span-5">
          <h2 className="font-display text-[17px] font-semibold text-ink">Indicateurs de l&apos;exercice</h2>
          <dl className="mt-2 divide-y divide-line">
            <Ligne label="Chiffre d'affaires de l'exercice" value={fmtShort(d.revenue_fy)} hint={fmtGNF(d.revenue_fy)} />
            <Ligne
              label="Chiffre d'affaires du mois"
              value={fmtShort(d.revenue_month)}
              hint={
                variation === null ? (
                  "Pas de mois de comparaison"
                ) : (
                  <span className={cx("inline-flex items-center gap-1", variation < 0 ? "text-danger" : "text-ok")}>
                    {variation < 0 ? <Baisse className="h-3 w-3" /> : <Hausse className="h-3 w-3" />}
                    {fmtPct(Math.abs(variation))} par rapport au mois précédent
                  </span>
                )
              }
            />
            <Ligne label="Résultat de l'exercice" value={fmtShort(d.net_result_fy)} hint={`EBE : ${fmtShort(d.ebe_fy)}`} tone={d.net_result_fy < 0 ? "danger" : "neutral"} />
            <Ligne label="Encours clients" value={fmtShort(d.receivables.total)} hint={`${d.receivables.documents} pièce${d.receivables.documents > 1 ? "s" : ""}, dont ${fmtShort(d.receivables.overdue)} échu`} tone={d.receivables.overdue > 0 ? "warn" : "neutral"} />
            <Ligne label="Encours fournisseurs" value={fmtShort(d.payables.total)} hint={`${d.payables.documents} pièce${d.payables.documents > 1 ? "s" : ""}, dont ${fmtShort(d.payables.overdue)} échu`} />
            <Ligne label="Dette financière" value={fmtShort(d.debt.outstanding)} hint={d.debt.next_due_date ? `Prochaine échéance le ${fmtDate(d.debt.next_due_date)} : ${fmtShort(d.debt.next_due_amount)}` : "Aucune échéance à venir"} />
            <Ligne
              label="Couverture du service de la dette (DSCR, 12 mois)"
              value={d.dscr === null ? "–" : fmtDec(Math.round(d.dscr * 100) / 100)}
              hint="EBE divisé par le service de la dette ; 1,2 au moins attendu"
              tone={d.dscr === null ? "neutral" : d.dscr >= 1.2 ? "neutral" : d.dscr >= 1 ? "warn" : "danger"}
            />
          </dl>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card title="Chiffre d'affaires facturé par mois" className="xl:col-span-7">
          <BarChart data={d.revenue_by_month.map((m) => ({ label: fmtMonth(m.month).split(" ")[0] ?? m.month, value: m.amount }))} format={(v) => fmtGNF(v)} />
        </Card>
        <Card title="Ancienneté des créances clients" className="xl:col-span-5">
          <Repartition parts={AGING.map(([key, label, color]) => ({ key, label, value: aging[key], color }))} format={(v) => fmtGNF(v)} />
        </Card>
      </div>

      <Card title="Résultat par activité" padded={false}>
        <DataTable
          rows={d.by_activity}
          rowKey={(r) => r.analytic_account_id}
          empty="Imputez les pièces sur l'axe Activité pour voir ce tableau."
          columns={[
            { key: "name", label: "Activité" },
            { key: "income", label: "Produits", align: "right", render: (r) => fmtShort(r.income) },
            { key: "expense", label: "Charges", align: "right", render: (r) => fmtShort(r.expense) },
            { key: "margin", label: "Marge", align: "right", render: (r) => <span className={r.margin < 0 ? "text-danger" : "text-ink"}>{fmtShort(r.margin)}</span> },
            { key: "margin_rate", label: "Taux de marge", align: "right", render: (r) => fmtPct(r.margin_rate) },
          ]}
        />
      </Card>
    </div>
  );
}

/** Ligne du registre des indicateurs : libellé et précision à gauche, valeur à droite. */
function Ligne({ label, value, hint, tone = "neutral" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="flex items-start justify-between gap-5 py-3">
      <dt className="min-w-0">
        <div className="flex items-center gap-2 text-[13.5px] font-medium text-ink-2">
          {tone !== "neutral" && <span aria-hidden className={cx("h-2 w-2 flex-none rounded-[2px]", tone === "danger" ? "bg-danger" : "bg-or")} />}
          {label}
        </div>
        {hint && <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{hint}</div>}
      </dt>
      <dd className={cx("whitespace-nowrap font-display text-[21px] font-semibold leading-tight", tone === "danger" ? "text-danger" : "text-ink")}>{value}</dd>
    </div>
  );
}
