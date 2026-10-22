"use client";

import { useState } from "react";
import { Badge, Card, DataTable, ErrorBox, Kpi, Loading, ProgressBar, Segmented, type Tone } from "@/components/ui";
import { ScopeToggle } from "@/components/finance/ScopeToggle";
import { useApi } from "@/lib/api-client";
import type { Aging } from "@/lib/finance-types";
import { fmtGNF, fmtInt, fmtPct, fmtShort, pluriel } from "@/lib/format";

interface PartnerAging {
  partner_id: number | null;
  name: string;
  ref: string | null;
  documents: number;
  total: number;
  overdue: number;
  max_late_days: number;
  status: "contentieux" | "retard" | "a_jour";
}

interface AgingReport {
  kind: "customer" | "supplier";
  as_of: string;
  total: number;
  overdue: number;
  documents: number;
  aging: Aging;
  aging_count: Record<keyof Aging, number>;
  partners: PartnerAging[];
}

const TRANCHES: Array<[keyof Aging, string, Tone]> = [
  ["non_echu", "Non échu", "ok"],
  ["1_30", "Échu de 1 à 30 jours", "accent"],
  ["31_60", "Échu de 31 à 60 jours", "warn"],
  ["61_90", "Échu de 61 à 90 jours", "warn"],
  ["plus_90", "Échu depuis plus de 90 jours", "danger"],
];

const STATUT: Record<PartnerAging["status"], { label: string; tone: Tone }> = {
  contentieux: { label: "Contentieux", tone: "danger" },
  retard: { label: "Retard", tone: "warn" },
  a_jour: { label: "À jour", tone: "ok" },
};

/** Balance âgée des clients ou des fournisseurs : tranches d'ancienneté et encours par tiers avec son statut. */
export function BalanceAgee() {
  const [kind, setKind] = useState<"customer" | "supplier">("customer");
  const [scope, setScope] = useState<"company" | "group">("company");
  const { data, error } = useApi<AgingReport>(`/finance/partners/aging?kind=${kind}&scope=${scope}`);
  const qui = kind === "customer" ? "Client" : "Fournisseur";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Nature" options={[{ key: "customer", label: "Créances clients" }, { key: "supplier", label: "Dettes fournisseurs" }]} value={kind} onChange={setKind} />
        <ScopeToggle value={scope} onChange={setScope} />
      </div>
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Kpi label={kind === "customer" ? "Créances clients" : "Dettes fournisseurs"} value={fmtShort(data.total)} hint={`${pluriel(data.partners.length, "compte ouvert", "comptes ouverts")}, ${pluriel(data.documents, "pièce")}`} />
            <Kpi label="Dont échu" value={fmtShort(data.overdue)} hint={`${fmtPct(data.total ? (data.overdue / data.total) * 100 : null)} de l'encours`} tone={data.overdue > 0.5 ? (kind === "customer" ? "danger" : "warn") : "ok"} />
            <Kpi label="Plus de 90 jours" value={fmtShort(data.aging.plus_90)} hint={pluriel(data.aging_count.plus_90, "pièce")} tone={data.aging.plus_90 > 0.5 ? "danger" : "ok"} />
            <Kpi label="Tiers en contentieux" value={fmtInt(data.partners.filter((p) => p.status === "contentieux").length)} hint={`${data.partners.filter((p) => p.status === "retard").length} en retard`} tone={data.partners.some((p) => p.status === "contentieux") ? "danger" : "neutral"} />
          </div>
          <Card title={`Balance âgée des ${kind === "customer" ? "créances clients" : "dettes fournisseurs"}`} padded={false}>
            <DataTable
              dense
              rows={TRANCHES.map(([key, label, tone]) => ({ key, label, tone, amount: data.aging[key], count: data.aging_count[key] }))}
              rowKey={(t) => t.key}
              columns={[
                { key: "label", label: "Tranche" },
                { key: "count", label: "Pièces", align: "right", render: (t) => fmtInt(t.count) },
                { key: "amount", label: "Montant", align: "right", render: (t) => fmtInt(t.amount) },
                { key: "part", label: "Part", align: "right", render: (t) => fmtPct(data.total ? (t.amount / data.total) * 100 : null) },
                { key: "bar", label: "", className: "w-40", render: (t) => <ProgressBar value={data.total ? (t.amount / data.total) * 100 : 0} tone={t.tone} epaisseur={7} /> },
              ]}
              footer={
                <tr>
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtInt(data.documents)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtInt(data.total)}</td>
                  <td className="px-3 py-2" colSpan={2} />
                </tr>
              }
            />
          </Card>
          <Card title={`Encours par ${qui.toLowerCase()}`} padded={false}>
            <DataTable
              dense
              rows={data.partners}
              rowKey={(p) => p.partner_id ?? p.name}
              empty="Aucun encours."
              columns={[
                { key: "ref", label: "Code", render: (p) => p.ref ?? "–" },
                { key: "name", label: qui },
                { key: "documents", label: "Pièces", align: "right", render: (p) => fmtInt(p.documents) },
                { key: "total", label: "Encours", align: "right", render: (p) => fmtGNF(p.total) },
                { key: "overdue", label: "Dont échu", align: "right", render: (p) => (p.overdue ? fmtGNF(p.overdue) : "–") },
                { key: "max_late_days", label: "Retard max", align: "right", render: (p) => (p.max_late_days ? `${p.max_late_days} j` : "–") },
                { key: "status", label: "Statut", render: (p) => <Badge tone={STATUT[p.status].tone}>{STATUT[p.status].label}</Badge> },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
