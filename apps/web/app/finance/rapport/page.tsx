"use client";

import { useState, type ReactNode } from "react";
import { Printer } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Loading, PageHeader, cx } from "@/components/ui";
import { AlerteLigne, CourbeTresorerie, FluxMensuels } from "@/components/finance/Pilotage";
import { ScopeToggle } from "@/components/finance/ScopeToggle";
import { useApi } from "@/lib/api-client";
import type { Alert, CashAccount, CashForecast, Dashboard, DebtSummary, MonthlyCash, Ref, Thresholds, TransportKpis, WorkingCapital } from "@/lib/finance-types";
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
    payables_overdue: number;
    dscr: number | null;
    dscr_min: number | null;
    dso: number | null;
    dso_target_days: number | null;
    bfr: number;
    receipts_month: number;
    payments_month: number;
    cash_net_month: number;
    debt_service_fy: number;
  };
  income: Array<{ code: string; label: string; month: number; previous_month: number; month_last_year: number; ytd: number; ytd_last_year: number }>;
  by_activity: Dashboard["by_activity"];
  cash_by_journal: CashAccount[];
  cash_flow: Record<"ZA" | "ZB" | "ZC" | "ZF" | "ZG" | "ZH", number>;
  transport: Array<{ key: number | null; label: string; rotations: number; volume: number; revenue: number; cost: number; margin: number; margin_rate: number | null }>;
  transport_summary: TransportKpis | null;
  debt: DebtSummary;
  working_capital: WorkingCapital;
  cash_monthly: MonthlyCash;
  cash_forecast: CashForecast | null;
  thresholds: Thresholds;
  alerts: Alert[];
  reading: string[];
}

const thisMonth = () => new Date().toISOString().slice(0, 7);
const ratio = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
/** Mention d'un seuil laissé à 0 (règle éteinte) : la valeur s'affiche sans être jugée. */
const NON_FIXE = <span className="ml-1.5 font-sans text-[11.5px] font-normal text-muted">seuil non fixé</span>;
const jours = (v: number | null) => (v === null ? "–" : `${fmtDec(Math.round(v * 10) / 10)} jours`);

function delta(current: number, previous: number) {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Tableau de synthèse à deux colonnes : libellé, valeur. */
function Synthese({ titre, lignes }: { titre: string; lignes: Array<[string, ReactNode, boolean?]> }) {
  return (
    <Card title={titre} padded={false}>
      <table className="w-full text-sm">
        <tbody className="tabular">
          {lignes.map(([label, value, alerte]) => (
            <tr key={label} className="border-b border-line/50 last:border-0">
              <td className="px-5 py-2">{label}</td>
              <td className={cx("px-5 py-2 text-right font-mono", alerte && "font-semibold text-danger")}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export default function ManagementReportPage() {
  const [month, setMonth] = useState(thisMonth());
  const [scope, setScope] = useState<"company" | "group">("company");
  const { data: r, error } = useApi<Report>(`/finance/management-report?month=${month}&scope=${scope}`);
  return (
    <div>
      <PageHeader
        title={`Rapport mensuel de gestion${r ? ` : ${fmtMonth(r.month)}` : ""}`}
        subtitle={r ? `${r.companies.map((c) => c.name).join(", ")}, période arrêtée au ${fmtDate(r.period.end)}, exercice ouvert le ${fmtDate(r.period.fiscal_year_start)}, montants en GNF` : "Synthèse mensuelle pour la direction générale."}
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
      {r && <Corps r={r} groupe={scope === "group"} />}
    </div>
  );
}

function Corps({ r, groupe }: { r: Report; groupe: boolean }) {
  const k = r.kpis;
  const wc = r.working_capital;
  const t = r.transport_summary;
  // Seuils de la règle d'alerte ; null : seuil à 0 (règle éteinte), la valeur n'est pas jugée.
  const dscrMin = k.dscr_min;
  const partMax = r.thresholds.receivable_overdue_share_pct;
  const actives = r.alerts.filter((a) => a.status === "alert");
  const variation = delta(k.revenue_month, k.revenue_prev_month);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi label="Chiffre d'affaires du mois" value={fmtShort(k.revenue_month)} delta={variation} hint={variation === null ? "Mois précédent sans chiffre d'affaires" : "sur le mois précédent"} tone="accent" />
        <Kpi label="Chiffre d'affaires cumulé" value={fmtShort(k.revenue_fy)} />
        <Kpi label="Résultat net cumulé" value={fmtShort(k.net_result_fy)} hint={`EBE ${fmtShort(k.ebe_fy)}`} tone={k.net_result_fy >= 0 ? "ok" : "danger"} />
        <Kpi label="Trésorerie fin de mois" value={fmtShort(k.cash)} hint={`Cash net du mois ${fmtShort(k.cash_net_month)}`} tone={k.cash_net_month < 0 ? "warn" : "accent"} />
        <Kpi label="Encours clients" value={fmtShort(k.receivables)} hint={`dont échu ${fmtShort(k.receivables_overdue)}`} tone={k.receivables_overdue ? "warn" : "neutral"} />
        <Kpi label="Délai de recouvrement" value={jours(k.dso)} hint={k.dso_target_days ? `Cible ${k.dso_target_days} jours` : "Cible non fixée"} tone={k.dso !== null && k.dso_target_days ? (k.dso > k.dso_target_days ? "danger" : "ok") : "neutral"} />
        <Kpi label="Dette financière" value={fmtShort(r.debt.accounting_outstanding ?? r.debt.outstanding)} hint={r.debt.next_due_date ? `Prochaine échéance ${fmtDate(r.debt.next_due_date)}` : undefined} />
        <Kpi label="DSCR" value={ratio(k.dscr)} hint={`EBE 12 mois / service de la dette, ${dscrMin ? `minimum ${ratio(dscrMin)}` : "minimum : seuil non fixé"}`} tone={k.dscr === null || !dscrMin ? "neutral" : k.dscr < dscrMin ? "danger" : "ok"} />
      </div>

      <Card title="Lecture de la période">
        <div className="space-y-2.5 text-[14px] leading-relaxed text-ink-2">
          {r.reading.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </Card>

      <Card title="Résultat : le mois comparé au mois précédent et à l'an dernier, le cumul comparé à l'an dernier" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-[12.5px] font-medium text-muted">
                <th className="px-3 py-2 text-left">Solde</th>
                <th className="px-3 py-2 text-right">Mois</th>
                <th className="px-3 py-2 text-right">Mois précédent</th>
                <th className="px-3 py-2 text-right">Même mois N-1</th>
                <th className="px-3 py-2 text-right">Cumul</th>
                <th className="px-3 py-2 text-right">Cumul N-1</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {r.income.map((l) => (
                <tr key={l.code} className={cx("border-b border-line/50", (l.code === "XB" || l.code === "XI") && "font-semibold")}>
                  <td className="px-3 py-1.5">{l.label}</td>
                  {[l.month, l.previous_month, l.month_last_year, l.ytd, l.ytd_last_year].map((v, i) => (
                    <td key={i} className={cx("px-3 py-1.5 text-right font-mono", v < 0 && "text-danger", (i === 1 || i === 2 || i === 4) && "text-muted")}>{fmtInt(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Synthese
          titre="Trésorerie et financement"
          lignes={[
            ["Trésorerie fin de mois", fmtInt(k.cash), k.cash < 0],
            ["Encaissements du mois", fmtInt(k.receipts_month)],
            ["Décaissements du mois", fmtInt(k.payments_month)],
            ["Cash net du mois", fmtInt(k.cash_net_month), k.cash_net_month < 0],
            ["Dette financière (comptes 16 et 17)", fmtInt(r.debt.accounting_outstanding ?? r.debt.outstanding)],
            ["Service de la dette de l'exercice", fmtInt(k.debt_service_fy)],
            ["Couverture du service de la dette (DSCR)", dscrMin ? ratio(k.dscr) : <>{ratio(k.dscr)}{NON_FIXE}</>, k.dscr !== null && !!dscrMin && k.dscr < dscrMin],
          ]}
        />
        <Synthese
          titre="Clients et fournisseurs"
          lignes={[
            ["Créances clients", fmtInt(wc.receivables)],
            ["Dont échues", <>{`${fmtInt(wc.receivables_overdue)} (${fmtPct(wc.overdue_share_pct)})`}{partMax ? null : NON_FIXE}</>, !!partMax && (wc.overdue_share_pct ?? 0) > partMax],
            ["Délai moyen de recouvrement", jours(wc.dso), wc.dso !== null && !!k.dso_target_days && wc.dso > k.dso_target_days],
            ["Dettes fournisseurs", fmtInt(wc.payables)],
            ["Dont échues", fmtInt(wc.payables_overdue), wc.payables_overdue > 0.5],
            ["Besoin en fonds de roulement", fmtInt(wc.bfr)],
          ]}
        />
        {t && t.rotations > 0 ? (
          <Synthese
            titre="Activité transport du mois"
            lignes={[
              ["Rotations réalisées", fmtInt(t.rotations)],
              ["Volume transporté (m³)", fmtDec(t.volume)],
              ["Kilomètres parcourus", t.km === null ? "Non calculé" : fmtInt(t.km)],
              ["Chiffre d'affaires transport", fmtInt(t.revenue)],
              ["Marge directe", fmtInt(t.margin)],
              ["Taux de marge directe", <>{fmtPct(t.margin_rate)}{r.thresholds.transport_margin_min ? null : NON_FIXE}</>, t.margin_rate !== null && !!r.thresholds.transport_margin_min && t.margin_rate < r.thresholds.transport_margin_min],
              ["Camions déficitaires après structure", t.vehicles.basis === "net" ? `${t.vehicles.deficit.length} sur ${t.vehicles.count}` : "Non calculé", t.vehicles.basis === "net" && t.vehicles.deficit.length > 0],
              ["Rotations non facturées", fmtInt(t.unbilled.count), t.unbilled.count > 0],
            ]}
          />
        ) : (
          <Synthese
            titre="Flux de trésorerie cumulés"
            lignes={([["ZA", "Trésorerie nette à l'ouverture"], ["ZB", "Flux opérationnels"], ["ZC", "Flux d'investissement"], ["ZF", "Flux de financement"], ["ZG", "Variation de la trésorerie"], ["ZH", "Trésorerie nette fin de mois"]] as const).map(([code, label]) => [label, fmtInt(r.cash_flow[code]), r.cash_flow[code] < 0])}
          />
        )}
      </div>

      <Card title="Trésorerie de l'exercice : soldes de fin de mois et flux mensuels" padded={false}>
        <div className="px-5 pb-2 pt-1">
          <CourbeTresorerie data={r.cash_monthly} forecast={r.cash_forecast} />
        </div>
        <FluxMensuels data={r.cash_monthly} forecast={r.cash_forecast} />
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
        {t && t.rotations > 0 ? (
          <Synthese
            titre="Flux de trésorerie cumulés"
            lignes={([["ZA", "Trésorerie nette à l'ouverture"], ["ZB", "Flux opérationnels"], ["ZC", "Flux d'investissement"], ["ZF", "Flux de financement"], ["ZG", "Variation de la trésorerie"], ["ZH", "Trésorerie nette fin de mois"]] as const).map(([code, label]) => [label, fmtInt(r.cash_flow[code]), r.cash_flow[code] < 0])}
          />
        ) : (
          <Card title="Trésorerie par compte" padded={false}>
            <DataTable dense rows={r.cash_by_journal} rowKey={(c) => c.journal_id} empty="Aucun compte de trésorerie." columns={[
              { key: "name", label: "Compte" },
              { key: "company", label: "Société" },
              { key: "balance", label: "Solde", align: "right", render: (c) => fmtGNF(c.balance) },
            ]} />
          </Card>
        )}
      </div>

      {r.transport.length > 0 && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card title="Transport : le mois par ensemble routier" padded={false}>
            <DataTable dense rows={r.transport} rowKey={(x) => x.key ?? x.label} empty="Aucune rotation validée ce mois." columns={[
              { key: "label", label: "Ensemble" },
              { key: "rotations", label: "Rotations", align: "right" },
              { key: "volume", label: "Volume (m³)", align: "right", render: (x) => fmtDec(x.volume) },
              { key: "revenue", label: "Chiffre d'affaires", align: "right", render: (x) => fmtInt(x.revenue) },
              { key: "margin", label: "Marge", align: "right", render: (x) => <span className={x.margin < 0 ? "text-danger" : undefined}>{fmtInt(x.margin)}</span> },
            ]} />
          </Card>
          <Card title="Trésorerie par compte" padded={false}>
            <DataTable dense rows={r.cash_by_journal} rowKey={(c) => c.journal_id} empty="Aucun compte de trésorerie." columns={[
              { key: "name", label: "Compte" },
              { key: "company", label: "Société" },
              { key: "balance", label: "Solde", align: "right", render: (c) => fmtGNF(c.balance) },
            ]} />
          </Card>
        </div>
      )}

      <Card title={`Alertes actives à la fin du mois (${actives.length})`} padded={false}>
        {actives.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">Aucune alerte : tous les seuils fixés sont respectés.</p>
        ) : (
          <ul className="space-y-1 px-3 pb-3">
            {actives.map((a, i) => (
              <li key={`${a.key}-${a.company}-${i}`}>
                <AlerteLigne a={a} groupe={groupe} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
