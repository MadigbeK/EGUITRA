"use client";

import { useState } from "react";
import { Card, DataTable, ErrorBox, Field, Input, Loading, PageHeader, Select, Tabs } from "@/components/ui";
import { BudgetLines } from "@/components/finance/BudgetLines";
import { ScopeToggle } from "@/components/finance/ScopeToggle";
import { useApi } from "@/lib/api-client";
import { fmtGNF, fmtPct } from "@/lib/format";

// Axes analytiques ; ceux d'un métier ne se proposent que dans la société qui l'exerce.
const PLANS: Array<{ value: string; label: string; entity?: "groupe" | "cabinet" }> = [
  { value: "activite", label: "Activité" },
  { value: "centre_cout", label: "Centre de coût" },
  { value: "chantier", label: "Chantier", entity: "groupe" },
  { value: "vehicule", label: "Ensemble routier", entity: "groupe" },
  { value: "route", label: "Route", entity: "groupe" },
  { value: "bien", label: "Bien immobilier", entity: "groupe" },
  { value: "dossier", label: "Dossier AxisPro", entity: "cabinet" },
];

export default function PilotagePage() {
  const [tab, setTab] = useState<"axes" | "budget">("axes");
  return (
    <div>
      <PageHeader title="Activités et budget" subtitle="Produits, charges et marge par axe analytique ; budget par ligne budgétaire comparé au réalisé." />
      <Tabs tabs={[{ key: "axes", label: "Pilotage par axe" }, { key: "budget", label: "Budget et écarts" }]} value={tab} onChange={setTab} />
      {tab === "axes" ? <Axes /> : <BudgetLines />}
    </div>
  );
}

function Axes() {
  const [plan, setPlan] = useState("activite");
  const [scope, setScope] = useState<"company" | "group">("company");
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const { data, error } = useApi<{ plan: string; rows: Array<{ analytic_account_id: number; name: string; income: number; expense: number; margin: number; margin_rate: number | null }> }>(
    `/finance/analytics?plan=${plan}&date_from=${from}&date_to=${to}&scope=${scope}`,
  );
  const total = (data?.rows ?? []).reduce((a, r) => ({ income: a.income + r.income, expense: a.expense + r.expense }), { income: 0, expense: 0 });
  const { data: me } = useApi<{ company_id: number; companies: Array<{ id: number; entity: "groupe" | "cabinet" | null }> }>("/auth/me");
  const entite = me?.companies.find((c) => c.id === me.company_id)?.entity;
  const axes = PLANS.filter((p) => !p.entity || scope === "group" || !entite || p.entity === entite);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Axe">
          <Select value={plan} onChange={(e) => setPlan(e.target.value)} options={axes} />
        </Field>
        <Field label="Du">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Au">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <ScopeToggle value={scope} onChange={setScope} />
      </div>
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <Card padded={false}>
          <DataTable
            rows={data.rows}
            rowKey={(r) => r.analytic_account_id}
            empty="Aucune imputation sur cet axe pour la période."
            columns={[
              { key: "name", label: data.plan },
              { key: "income", label: "Produits", align: "right", render: (r) => fmtGNF(r.income) },
              { key: "expense", label: "Charges", align: "right", render: (r) => fmtGNF(r.expense) },
              { key: "margin", label: "Marge", align: "right", render: (r) => <span className={r.margin < 0 ? "text-danger" : "text-ok"}>{fmtGNF(r.margin)}</span> },
              { key: "margin_rate", label: "Taux de marge", align: "right", render: (r) => fmtPct(r.margin_rate) },
            ]}
            footer={
              data.rows.length > 0 ? (
                <tr>
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtGNF(total.income)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtGNF(total.expense)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtGNF(total.income - total.expense)}</td>
                  <td className="px-3 py-2 text-right font-mono">{total.income ? fmtPct(((total.income - total.expense) / total.income) * 100) : "–"}</td>
                </tr>
              ) : undefined
            }
          />
        </Card>
      )}
    </div>
  );
}
