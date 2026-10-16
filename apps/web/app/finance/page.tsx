"use client";

import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, ArrowUpRight, ChevronRight, Coins, HandCoins, Info, Landmark, PieChart, Receipt, ShieldAlert, ShoppingCart, TrendingUp, type Icon } from "@/components/icons";
import { AreaChart, Card, Compteur, DataTable, Donut, ErrorBox, GAMME, Gauge, IconTile, Kpi, PageHeader, RankBars, Squelette, Valeur, cx, type Teinte } from "@/components/ui";
import { ScopeToggle } from "@/components/finance/ScopeToggle";
import { useApi } from "@/lib/api-client";
import type { Dashboard } from "@/lib/finance-types";
import { fmtDate, fmtDec, fmtGNF, fmtMonth, fmtPct, fmtShort } from "@/lib/format";

const SEVERITY: Record<string, { teinte: Teinte; icon: Icon; label: string; texte: string }> = {
  blocking: { teinte: "danger", icon: ShieldAlert, label: "Bloquante", texte: "text-danger" },
  warning: { teinte: "ambre", icon: AlertTriangle, label: "Attention", texte: "text-warn" },
  info: { teinte: "azur", icon: Info, label: "Information", texte: "text-info" },
};

/** Ancienneté des créances : jade pour le non échu, puis une rampe d'alerte de plus en plus sombre. */
const AGING: Array<[keyof Dashboard["receivables"]["aging"], string, string]> = [
  ["non_echu", "Non échu", "#12956a"],
  ["1_30", "Échu de 1 à 30 jours", "#e6b54a"],
  ["31_60", "Échu de 31 à 60 jours", "#e8843a"],
  ["61_90", "Échu de 61 à 90 jours", "#d9503a"],
  ["plus_90", "Échu depuis plus de 90 jours", "#9c2b25"],
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
      {isLoading && !d && <Attente />}
      {d && <DashboardBody key={scope} d={d} />}
    </div>
  );
}

/** Squelette du tableau de bord pendant le calcul des indicateurs. */
function Attente() {
  return (
    <div role="status" className="space-y-5">
      <span className="sr-only">Calcul des indicateurs…</span>
      <div className="grid gap-5 xl:grid-cols-12">
        <Squelette className="h-[244px] xl:col-span-5" />
        <div className="grid gap-4 sm:grid-cols-2 xl:col-span-7">
          {[0, 1, 2, 3].map((i) => (
            <Squelette key={i} className="h-[114px]" />
          ))}
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-12">
        <Squelette className="h-[330px] xl:col-span-8" />
        <Squelette className="h-[330px] xl:col-span-4" />
      </div>
    </div>
  );
}

function DashboardBody({ d }: { d: Dashboard }) {
  const variation = d.revenue_prev_month ? ((d.revenue_month - d.revenue_prev_month) / Math.abs(d.revenue_prev_month)) * 100 : null;
  const aging = d.receivables.aging;
  const resultats = new Map(d.result_by_month.map((m) => [m.month, m.amount]));
  const mois = d.revenue_by_month.map((m) => m.month);
  const maxCompte = Math.max(1, ...d.cash_by_journal.map((c) => Math.abs(c.balance)));
  const activites = [...d.by_activity].sort((a, b) => b.margin - a.margin).slice(0, 6);
  const maxDscr = Math.max(2, Math.ceil(((d.dscr ?? 0) * 1.25) / 0.5) * 0.5);

  return (
    <div className="space-y-5">
      {/* Le chiffre de l'écran : la trésorerie nette, au compteur, et sa répartition par compte. */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <section className="relative min-w-0 overflow-hidden rounded-2xl border border-line bg-panel p-6 shadow-[var(--ombre-carte)] xl:col-span-5">
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[16.5px] font-semibold text-ink">Trésorerie nette</h2>
              <p className="mt-0.5 text-[12.5px] text-muted">
                {d.cash_by_journal.length} compte{d.cash_by_journal.length > 1 ? "s" : ""} de banque et caisse, au {fmtDate(d.as_of)}
              </p>
            </div>
            <IconTile icon={Landmark} teinte="jade" />
          </div>
          <Compteur value={d.cash} className={cx("relative mt-5 text-[38px] sm:text-[46px] xl:text-[44px] 2xl:text-[54px]", d.cash < 0 ? "text-danger" : "text-ink")} />
          {d.cash_by_journal.length === 0 ? (
            <p className="mt-6 text-sm text-muted">Aucun compte de trésorerie.</p>
          ) : (
            <ul className="relative mt-6 space-y-3">
              {d.cash_by_journal.map((c, i) => (
                <li key={c.journal_id}>
                  <div className="flex items-baseline justify-between gap-4 text-[13px]">
                    <span className="min-w-0 truncate font-medium text-ink-2">
                      {c.name}
                      <span className="ml-2 text-[12px] font-normal text-muted">{c.type === "cash" ? "Caisse" : "Banque"}</span>
                    </span>
                    <span className={cx("whitespace-nowrap font-semibold tabular", c.balance < 0 ? "text-danger" : "text-ink")}>
                      {c.currency !== "GNF" ? `${fmtDec(c.balance_currency)} ${c.currency}` : fmtGNF(c.balance)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-3">
                    <div
                      className="n-pousser-x h-full rounded-full"
                      style={{ width: `${Math.max(2, (Math.abs(c.balance) / maxCompte) * 100)}%`, background: c.balance < 0 ? "var(--danger-vif)" : GAMME[i % GAMME.length], "--i": i } as CSSProperties}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:col-span-7">
          <Kpi
            label="Chiffre d'affaires du mois"
            value={fmtShort(d.revenue_month)}
            icon={TrendingUp}
            teinte="azur"
            delta={variation}
            hint={variation === null ? "Pas de mois de comparaison" : "par rapport au mois précédent"}
          />
          <Kpi label="Résultat de l'exercice" value={fmtShort(d.net_result_fy)} icon={PieChart} teinte={d.net_result_fy < 0 ? "danger" : "ambre"} tone={d.net_result_fy < 0 ? "danger" : "accent"} hint={`EBE : ${fmtShort(d.ebe_fy)}`} />
          <Kpi
            label="Encours clients"
            value={fmtShort(d.receivables.total)}
            icon={Receipt}
            teinte="rose"
            tone={d.receivables.overdue > 0 ? "warn" : "neutral"}
            hint={`${d.receivables.documents} pièce${d.receivables.documents > 1 ? "s" : ""}, dont ${fmtShort(d.receivables.overdue)} échu`}
          />
          <Kpi
            label="Dette financière"
            value={fmtShort(d.debt.outstanding)}
            icon={HandCoins}
            teinte="lagon"
            tone={d.debt.overdue > 0 ? "danger" : "neutral"}
            hint={d.debt.next_due_date ? `Prochaine échéance le ${fmtDate(d.debt.next_due_date)} : ${fmtShort(d.debt.next_due_amount)}` : "Aucune échéance à venir"}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card
          title="Chiffre d'affaires et résultat par mois"
          className="xl:col-span-8"
          actions={
            <span className="text-[12.5px] text-muted">
              Exercice : <span className="font-semibold tabular text-ink">{fmtShort(d.revenue_fy)}</span> facturés
            </span>
          }
        >
          {mois.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">Aucune facture validée sur l&apos;exercice.</p>
          ) : (
            <AreaChart
              label="Chiffre d'affaires et résultat par mois"
              labels={mois.map((m) => fmtMonth(m).split(" ")[0] ?? m)}
              series={[
                { key: "ca", label: "Chiffre d'affaires", color: "#12956a", values: d.revenue_by_month.map((m) => m.amount) },
                { key: "resultat", label: "Résultat", color: "#2d82dc", values: mois.map((m) => resultats.get(m) ?? 0) },
              ]}
              height={230}
              format={(v) => fmtGNF(v)}
            />
          )}
        </Card>

        <Card title={`Alertes actives (${d.alerts.length})`} className="xl:col-span-4" padded={false}>
          {d.alerts.length === 0 ? (
            <p className="px-5 pb-6 pt-2 text-sm text-muted">Aucune alerte : les seuils fixés sont respectés.</p>
          ) : (
            <ul className="max-h-[330px] space-y-1 overflow-y-auto px-3 pb-3">
              {d.alerts.map((a, i) => {
                const s = SEVERITY[a.severity] ?? SEVERITY.info!;
                const corps = (
                  <div className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition-colors group-hover:bg-panel-2">
                    <IconTile icon={s.icon} teinte={s.teinte} className="h-9 w-9 rounded-[10px]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13.5px] font-semibold text-ink">{a.title}</span>
                        <span className={cx("flex-none text-[11.5px] font-semibold", s.texte)}>{s.label}</span>
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-muted">
                        {a.company}, {a.message}
                        {a.value !== null && ` (${fmtGNF(a.value)})`}
                      </div>
                    </div>
                    {a.link && <ChevronRight className="mt-2 h-4 w-4 flex-none text-line-strong transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />}
                  </div>
                );
                return (
                  <li key={i} className="group">
                    {a.link ? (
                      <Link href={a.link} className="block rounded-xl">
                        {corps}
                      </Link>
                    ) : (
                      corps
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-12">
        <Card title="Ancienneté des créances clients" className="xl:col-span-5">
          <Donut
            parts={AGING.map(([key, label, color]) => ({ key, label, value: aging[key], color }))}
            format={(v) => fmtShort(v)}
            centre={{ titre: "Encours clients", valeur: fmtShort(d.receivables.total) }}
          />
        </Card>
        <Card title="Couverture de la dette" className="xl:col-span-3">
          <Gauge
            value={d.dscr === null ? null : Math.round(d.dscr * 100) / 100}
            max={maxDscr}
            format={(v) => fmtDec(v)}
            zones={[
              { jusqua: 1, couleur: "#ec4f49", label: "Insuffisante" },
              { jusqua: 1.2, couleur: "#df8f17", label: "Limite" },
              { jusqua: maxDscr, couleur: "#12956a", label: "Confortable" },
            ]}
            sousTitre="DSCR sur 12 mois : EBE divisé par le service de la dette, 1,2 au moins attendu"
            vide="Aucun service de dette sur 12 mois"
          />
        </Card>
        <Card title="Indicateurs de l'exercice" className="lg:col-span-2 xl:col-span-4" padded={false}>
          <ul className="px-5 pb-4">
            <Ligne icon={TrendingUp} teinte="jade" label="Chiffre d'affaires" value={fmtShort(d.revenue_fy)} hint={fmtGNF(d.revenue_fy)} />
            <Ligne icon={ShoppingCart} teinte="corail" label="Achats" value={fmtShort(d.purchases_fy)} hint={fmtGNF(d.purchases_fy)} />
            <Ligne icon={Coins} teinte="azur" label="Encours fournisseurs" value={fmtShort(d.payables.total)} hint={`${d.payables.documents} pièce${d.payables.documents > 1 ? "s" : ""}, dont ${fmtShort(d.payables.overdue)} échu`} />
            <Ligne icon={PieChart} teinte="or" label="Excédent brut d'exploitation" value={fmtShort(d.ebe_fy)} hint={`Résultat : ${fmtShort(d.net_result_fy)}`} />
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card title="Marge par activité" className="xl:col-span-5">
          {activites.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Imputez les pièces sur l&apos;axe Activité pour voir ce classement.</p>
          ) : (
            <RankBars items={activites.map((a) => ({ key: a.analytic_account_id, label: a.name, value: a.margin, detail: `Taux de marge ${fmtPct(a.margin_rate)}` }))} />
          )}
        </Card>
        <Card
          title="Résultat par activité"
          className="xl:col-span-7"
          padded={false}
          actions={
            <Link href="/finance/pilotage" className="inline-flex items-center gap-1 rounded-lg text-[13px] font-semibold text-accent hover:underline">
              Activités et budget <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          <DataTable
            rows={d.by_activity}
            rowKey={(r) => r.analytic_account_id}
            empty="Imputez les pièces sur l'axe Activité pour voir ce tableau."
            columns={[
              { key: "name", label: "Activité", render: (r) => <span className="font-medium text-ink">{r.name}</span> },
              { key: "income", label: "Produits", align: "right", render: (r) => fmtShort(r.income) },
              { key: "expense", label: "Charges", align: "right", render: (r) => fmtShort(r.expense) },
              { key: "margin", label: "Marge", align: "right", render: (r) => <span className={cx("font-semibold", r.margin < 0 ? "text-danger" : "text-ink")}>{fmtShort(r.margin)}</span> },
              {
                key: "margin_rate",
                label: "Taux de marge",
                align: "right",
                render: (r) => (
                  <span className={cx("inline-block min-w-14 rounded-full px-2 py-0.5 text-center text-[12px] font-semibold", r.margin_rate === null ? "text-muted" : r.margin_rate < 0 ? "bg-danger-doux text-danger" : r.margin_rate < 15 ? "bg-warn-doux text-warn" : "bg-ok-doux text-ok-texte")}>
                    {fmtPct(r.margin_rate)}
                  </span>
                ),
              },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

/** Ligne d'indicateur : pastille d'icône, libellé et précision, valeur qui défile. */
function Ligne({ icon, teinte, label, value, hint }: { icon: Icon; teinte: Teinte; label: string; value: string; hint?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 border-b border-line py-3 last:border-0">
      <IconTile icon={icon} teinte={teinte} className="h-9 w-9 rounded-[10px]" />
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-ink-2">{label}</div>
        {hint && <div className="truncate text-[12px] text-muted">{hint}</div>}
      </div>
      <div className="whitespace-nowrap font-display text-[20px] font-bold tracking-[-0.01em] text-ink">
        <Valeur value={value} />
      </div>
    </li>
  );
}
