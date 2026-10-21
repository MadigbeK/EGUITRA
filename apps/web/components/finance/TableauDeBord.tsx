"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { ArrowUpRight, Calculator, Coins, HandCoins, PieChart, Printer, Receipt, Target, TrendingUp } from "@/components/icons";
import { Ondes, Rosace } from "@/components/guilloche";
import { AreaChart, Button, Card, Compteur, DataTable, Donut, ErrorBox, Field, GAMME, Gauge, Input, Kpi, PageHeader, RankBars, Squelette, cx } from "@/components/ui";
import { CarteBfr, CourbeTresorerie, Decisions, QuestionsDirigeant } from "@/components/finance/Pilotage";
import { ScopeToggle } from "@/components/finance/ScopeToggle";
import { useApi } from "@/lib/api-client";
import type { Dashboard } from "@/lib/finance-types";
import { fmtDate, fmtDec, fmtGNF, fmtMonth, fmtPct, fmtShort } from "@/lib/format";

/** Ancienneté des créances : jade pour le non échu, puis une rampe d'alerte de plus en plus sombre. */
const AGING: Array<[keyof Dashboard["receivables"]["aging"], string, string]> = [
  ["non_echu", "Non échu", "#12956a"],
  ["1_30", "Échu de 1 à 30 jours", "#e6b54a"],
  ["31_60", "Échu de 31 à 60 jours", "#e8843a"],
  ["61_90", "Échu de 61 à 90 jours", "#d9503a"],
  ["plus_90", "Échu depuis plus de 90 jours", "#9c2b25"],
];

/** Barres des comptes sur le billet : menthe, or, ciel, en clair sur le fond forêt. */
const BILLET = ["#7fdcb4", "#e6c47e", "#8fd0f5", "#c9b9ff", "#ffb48f"];

const ratio = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Tableau de bord du dirigeant (accueil de Finance pour la finance et la direction). */
export function DirectorDashboard() {
  const [scope, setScope] = useState<"company" | "group">("company");
  // Arrêté au : vide = aujourd'hui (le noyau calcule à la date du jour de Conakry).
  const [asOf, setAsOf] = useState("");
  const { data: d, error, isLoading, mutate } = useApi<Dashboard>(`/finance/dashboard?scope=${scope}${asOf ? `&date=${asOf}` : ""}`);

  return (
    <div>
      <PageHeader
        title="Tableau de bord du dirigeant"
        subtitle={d ? `Exercice ${d.fiscal_year.start.slice(0, 4)}, écritures validées arrêtées au ${fmtDate(d.as_of)}, montants hors taxes en GNF${d.companies.length > 1 ? `, ${d.companies.map((c) => c.name).join(" et ")}` : ""}.` : "Indicateurs calculés à chaque saisie."}
        actions={
          <>
            <Field label="Arrêté au">
              <Input type="date" value={asOf} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setAsOf(e.target.value)} className="w-40" />
            </Field>
            <ScopeToggle value={scope} onChange={setScope} />
            <Button onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Imprimer
            </Button>
          </>
        }
      />
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
      {isLoading && !d && <Attente />}
      {d && <DashboardBody key={`${scope}-${asOf}`} d={d} />}
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
        <Squelette className="h-[330px] xl:col-span-6" />
        <Squelette className="h-[330px] xl:col-span-6" />
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
  const parts = [...d.by_activity].filter((a) => a.income > 0).sort((a, b) => b.income - a.income);
  const th = d.thresholds;
  // Minimum de la règle d'alerte ; null : seuil à 0 (règle éteinte), le DSCR n'est pas jugé.
  const dscrMin = th.dscr_min;
  const maxDscr = Math.max(2, Math.ceil(((d.dscr ?? 0) * 1.25) / 0.5) * 0.5, (dscrMin ?? 1) + 0.5);
  const wc = d.working_capital;
  const ecl = d.expected_credit_loss.total;
  const budget = d.budget;
  const budgetCa = budget && budget.revenue.budget ? budget.revenue : null;
  const fin = d.cash_forecast.month_end;
  const groupe = d.companies.length > 1;
  const transport = d.transport && d.transport.vehicles.count > 0 ? d.transport : null;
  const alertes = d.alerts.filter((a) => a.status === "alert");

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Le billet : la trésorerie nette gravée sur fond forêt, rosace et vagues guillochées. */}
        <section className="billet relative isolate min-w-0 overflow-hidden rounded-[28px] bg-foret p-6 text-white shadow-[0_34px_60px_-32px_rgb(20_47_41/0.7)] sm:p-7 xl:col-span-5">
          <Rosace epaisseur={0.9} className="pointer-events-none absolute -right-40 top-1/2 -z-10 h-[540px] w-[540px] -translate-y-1/2 text-or opacity-[0.42]" />
          <Ondes graine="tresorerie-nette" lignes={9} className="billet-ondes pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-28 w-full text-menthe" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-semibold text-white">Trésorerie nette</h2>
              <p className="mt-1 text-[12.5px] leading-snug text-white/65">
                {d.cash_by_journal.length} compte{d.cash_by_journal.length > 1 ? "s" : ""} de banque et caisse, au {fmtDate(d.as_of)}
                {th.cash_min ? `, seuil de sécurité ${fmtShort(th.cash_min)}` : ""}
              </p>
            </div>
            <span aria-hidden className="billet-serie mt-0.5 whitespace-nowrap font-display text-[12px] font-semibold tabular tracking-[0.18em] text-or">
              Nº {d.as_of.split("-").reverse().join("")}
            </span>
          </div>
          <Compteur value={d.cash} className={cx("relative mt-7 text-[34px] sm:text-[50px] xl:text-[38px] 2xl:text-[52px]", d.cash < 0 || (th.cash_min && d.cash < th.cash_min) ? "text-[#ffb4a8]" : "text-white")} />
          {d.cash_by_journal.length === 0 ? (
            <p className="mt-6 text-sm text-white/65">Aucun compte de trésorerie.</p>
          ) : (
            <ul className="relative mt-7 space-y-3.5">
              {d.cash_by_journal.map((c, i) => (
                <li key={c.journal_id}>
                  <div className="flex items-baseline justify-between gap-4 text-[13px]">
                    <span className="min-w-0 truncate font-medium text-white/90">
                      {c.name}
                      <span className="ml-2 text-[12px] font-normal text-white/55">{c.type === "cash" ? "Caisse" : "Banque"}</span>
                    </span>
                    <span className={cx("whitespace-nowrap font-semibold tabular", c.balance < 0 ? "text-[#ffb4a8]" : "text-white")}>
                      {c.currency !== "GNF" ? `${fmtDec(c.balance_currency)} ${c.currency}` : fmtGNF(c.balance)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-white/10">
                    <div
                      className="n-pousser-x h-full rounded-full"
                      style={{ width: `${Math.max(2, (Math.abs(c.balance) / maxCompte) * 100)}%`, background: c.balance < 0 ? "#ff8a7a" : BILLET[i % BILLET.length], "--i": i } as CSSProperties}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:col-span-7">
          <Kpi label="Chiffre d'affaires du mois" value={fmtShort(d.revenue_month)} icon={TrendingUp} teinte="azur" delta={variation} hint={variation === null ? "Pas de mois de comparaison" : "par rapport au mois précédent"} />
          <Kpi
            label="Chiffre d'affaires de l'exercice"
            value={fmtShort(d.margins.revenue)}
            icon={Target}
            teinte="jade"
            tone={budgetCa && (budgetCa.gap_pct ?? 0) < -(budget?.threshold_pct ?? 10) ? "warn" : "neutral"}
            hint={budgetCa ? `Budget ${fmtShort(budgetCa.budget)} · écart ${fmtPct(budgetCa.gap_pct)}` : "Aucun budget de produits"}
          />
          <Kpi label="Excédent brut d'exploitation" value={fmtShort(d.ebe_fy)} icon={PieChart} teinte="or" tone={d.ebe_fy < 0 ? "danger" : "neutral"} hint={`Marge EBE ${fmtPct(d.margins.ebe_pct)} du chiffre d'affaires`} />
          <Kpi label="Résultat net de l'exercice" value={fmtShort(d.net_result_fy)} icon={Calculator} teinte={d.net_result_fy < 0 ? "danger" : "ambre"} tone={d.net_result_fy < 0 ? "danger" : "accent"} hint={`Marge nette ${fmtPct(d.margins.net_pct)} · après IFRS 9 : ${fmtShort(d.net_result_fy - ecl)}`} />
          <Kpi
            label="Délai de recouvrement (DSO)"
            value={wc.dso === null ? "–" : `${fmtDec(Math.round(wc.dso))} j`}
            icon={Receipt}
            teinte="rose"
            tone={wc.dso !== null && th.dso_target_days ? (wc.dso > th.dso_target_days ? "danger" : "ok") : "neutral"}
            hint={th.dso_target_days ? `Cible ${th.dso_target_days} jours · créances échues ${fmtPct(wc.overdue_share_pct)}` : "Cible de recouvrement non fixée"}
          />
          <Kpi
            label="Couverture de la dette (DSCR)"
            value={ratio(d.dscr)}
            icon={HandCoins}
            teinte="lagon"
            tone={d.dscr === null || !dscrMin ? "neutral" : d.dscr < dscrMin ? "danger" : "ok"}
            hint={dscrMin ? `Minimum fixé : ${ratio(dscrMin)}` : "Minimum : seuil non fixé"}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label={`Trésorerie prévue fin ${fin.label}`}
          value={fmtShort(fin.end)}
          icon={Coins}
          teinte="azur"
          tone={fin.end < 0 || (th.cash_min && fin.end < th.cash_min) ? "danger" : "ok"}
          hint={`+ ${fmtShort(fin.receivables)} clients, - ${fmtShort(fin.payables)} fournisseurs, - ${fmtShort(fin.loans)} emprunts`}
        />
        {budget ? (
          <Kpi
            label="Réalisé contre budget cumulé"
            value={fmtPct(budget.expenses.budget ? (budget.expenses.actual / budget.expenses.budget) * 100 : null)}
            icon={Target}
            teinte="or"
            tone={budget.overruns.length ? "warn" : "ok"}
            hint={`Charges ${fmtShort(budget.expenses.actual)} / ${fmtShort(budget.expenses.budget)} à fin ${fmtMonth(budget.through.slice(0, 7))}, ${budget.overruns.length} ligne(s) hors tolérance`}
          />
        ) : (
          <Kpi label="Réalisé contre budget cumulé" value="–" icon={Target} teinte="or" hint="Aucun budget pour l'exercice (Activités et budget)" />
        )}
        <Kpi label="Besoin en fonds de roulement" value={fmtShort(wc.bfr)} icon={Coins} teinte="lagon" hint={`Cycle ${wc.cycle === null ? "–" : `${fmtDec(Math.round(wc.cycle))} j`} · DPO ${wc.dpo === null ? "–" : `${fmtDec(Math.round(wc.dpo))} j`}`} />
        <Kpi
          label="Dette financière"
          value={fmtShort(d.debt.accounting_outstanding ?? d.debt.outstanding)}
          icon={HandCoins}
          teinte="corail"
          tone={d.debt.overdue > 0 ? "danger" : Math.abs(d.debt.schedule_gap ?? 0) >= 1 ? "warn" : "neutral"}
          hint={`Dette nette ${fmtShort(d.debt.net_debt)} · gearing ${ratio(d.debt.gearing)}${Math.abs(d.debt.schedule_gap ?? 0) >= 1 ? ` · écart échéancier ${fmtShort(d.debt.schedule_gap)}` : ""}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card
          title="Chiffre d'affaires et résultat par mois"
          className="xl:col-span-6"
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
              height={210}
              format={(v) => fmtGNF(v)}
            />
          )}
        </Card>
        <Card
          title="Trésorerie en fin de mois"
          className="xl:col-span-6"
          actions={
            <Link href="/finance/pilotage?onglet=tresorerie" className="no-print inline-flex items-center gap-1 rounded-lg text-[13px] font-semibold text-accent hover:underline">
              Flux mensuels <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          <CourbeTresorerie data={d.cash_monthly} forecast={d.cash_forecast} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card
          title={`Ce qui demande une décision${alertes.length ? ` (${Math.min(6, alertes.length)} sur ${alertes.length})` : ""}`}
          className="xl:col-span-7"
          padded={false}
          actions={
            <Link href="/finance/alertes" className="no-print inline-flex items-center gap-1 rounded-lg text-[13px] font-semibold text-accent hover:underline">
              Toutes les alertes <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          <div className="px-3 pb-3">
            <Decisions alerts={d.decisions} groupe={groupe} />
          </div>
        </Card>
        <Card title="Répartition du chiffre d'affaires par activité" className="xl:col-span-5">
          {parts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Imputez les factures sur l&apos;axe Activité pour voir cette répartition.</p>
          ) : (
            <Donut parts={parts.slice(0, 6).map((a, i) => ({ key: String(a.analytic_account_id), label: a.name, value: a.income, color: GAMME[i % GAMME.length]! }))} format={(v) => fmtShort(v)} centre={{ titre: "Produits", valeur: fmtShort(parts.reduce((s, a) => s + a.income, 0)) }} />
          )}
        </Card>
      </div>

      <Card title="Besoin en fonds de roulement et délais" actions={<span className="text-[12.5px] text-muted">Du {fmtDate(wc.date_from)} au {fmtDate(wc.date_to)} ({wc.days} jours)</span>}>
        <CarteBfr wc={wc} thresholds={th} />
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-12">
        <Card title="Ancienneté des créances clients" className="xl:col-span-5">
          <Donut parts={AGING.map(([key, label, color]) => ({ key, label, value: aging[key], color }))} format={(v) => fmtShort(v)} centre={{ titre: "Encours clients", valeur: fmtShort(d.receivables.total) }} />
          <p className="mt-3 text-[12.5px] leading-snug text-muted">
            {fmtShort(aging.plus_90)} GNF dorment depuis plus de 90 jours ({d.receivables.aging_count?.plus_90 ?? 0} pièce(s)). Perte attendue IFRS 9 : {fmtShort(ecl)} GNF{d.expected_credit_loss.rate_pct !== null ? `, soit ${fmtPct(d.expected_credit_loss.rate_pct)} de l'encours` : ""}.
          </p>
        </Card>
        <Card title="Couverture de la dette" className="xl:col-span-3">
          <Gauge
            value={d.dscr === null ? null : Math.round(d.dscr * 100) / 100}
            max={maxDscr}
            format={(v) => fmtDec(v)}
            zones={
              dscrMin
                ? [
                    { jusqua: 1, couleur: "#ec4f49", label: "Insuffisante" },
                    { jusqua: dscrMin, couleur: "#df8f17", label: "Sous le minimum" },
                    { jusqua: maxDscr, couleur: "#12956a", label: "Confortable" },
                  ]
                : [{ jusqua: maxDscr, couleur: "#9aa3b5", label: "Seuil non fixé" }]
            }
            sousTitre={`DSCR sur 12 mois : EBE divisé par le service de la dette, ${dscrMin ? `${ratio(dscrMin)} au moins (seuil fixé)` : "minimum non fixé (Administration > Seuils et taux)"}`}
            vide="Aucun service de dette sur 12 mois"
          />
        </Card>
        <Card title={transport ? `Résultat par ensemble routier${transport.vehicles.basis === "net" ? " après structure" : ""}` : "Marge par activité"} className="lg:col-span-2 xl:col-span-4">
          {transport ? (
            <>
              <RankBars items={transport.vehicles.items.slice(0, 8).map((v) => ({ key: String(v.key ?? v.label), label: v.label, value: v.result, detail: v.km !== null ? `${fmtShort(v.km)} km` : `CA ${fmtShort(v.revenue)}` }))} />
              <p className="mt-3 text-[12.5px] leading-snug text-muted">
                {transport.vehicles.basis === "net"
                  ? `${transport.vehicles.deficit.length} camion(s) sur ${transport.vehicles.count} déficitaire(s) une fois les charges de structure absorbées.`
                  : "Marge directe des rotations : le résultat après charges de structure s'affichera dès que le module transport le calcule."}
              </p>
            </>
          ) : activites.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Imputez les pièces sur l&apos;axe Activité pour voir ce classement.</p>
          ) : (
            <RankBars items={activites.map((a) => ({ key: a.analytic_account_id, label: a.name, value: a.margin, detail: `Taux de marge ${fmtPct(a.margin_rate)}` }))} />
          )}
        </Card>
      </div>

      <Card title="Les questions du dirigeant" padded={false}>
        <QuestionsDirigeant questions={d.questions} />
      </Card>

      <Card
        title="Résultat par activité"
        padded={false}
        actions={
          <Link href="/finance/pilotage" className="no-print inline-flex items-center gap-1 rounded-lg text-[13px] font-semibold text-accent hover:underline">
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

      <div className="no-print flex flex-wrap gap-2">
        <Link href="/finance/alertes" className="inline-flex min-h-9 items-center rounded-[10px] border border-line bg-panel px-3.5 text-sm font-semibold text-ink hover:bg-panel-2">Toutes les alertes</Link>
        <Link href="/finance/rapport" className="inline-flex min-h-9 items-center rounded-[10px] border border-line bg-panel px-3.5 text-sm font-semibold text-ink hover:bg-panel-2">Rapport mensuel</Link>
        <Button variant="primary" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Imprimer ce tableau de bord
        </Button>
      </div>
    </div>
  );
}
