"use client";

import { useState } from "react";
import { Card, DataTable, ErrorBox, Field, Kpi, Loading, Notice, PageHeader, Select } from "@/components/ui";
import { useApi } from "@/lib/api-client";
import { MONTHS_FR, fmtGNF, fmtShort } from "@/lib/format";

interface Vat {
  period: { from: string; to: string };
  taxes: Array<{ tax_id: number; name: string; use: string; rate: number; amount: number }>;
  base_sales: number;
  base_purchases: number;
  vat_collected: number;
  vat_deductible: number;
  vat_due: number;
  vat_credit: number;
  note: string;
}

export default function TaxPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const { data, error } = useApi<Vat>(`/finance/fiscal/vat?year=${year}&month=${month}`);
  return (
    <div>
      <PageHeader
        title="Fiscalité"
        subtitle="Déclaration mensuelle de TVA préparée à partir des écritures validées."
        actions={
          <>
            <Select value={String(month)} onChange={(e) => setMonth(Number(e.target.value))} options={MONTHS_FR.map((m, i) => ({ value: i + 1, label: m }))} />
            <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={[year - 1, year, year + 1].map((y) => ({ value: y, label: String(y) }))} />
          </>
        }
      />
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="TVA collectée" value={fmtShort(data.vat_collected)} hint={`Base ventes ${fmtGNF(data.base_sales)}`} />
            <Kpi label="TVA déductible" value={fmtShort(data.vat_deductible)} hint={`Base achats ${fmtGNF(data.base_purchases)}`} />
            <Kpi label="TVA à payer" value={fmtShort(data.vat_due)} tone={data.vat_due > 0 ? "warn" : "neutral"} />
            <Kpi label="Crédit de TVA" value={fmtShort(data.vat_credit)} tone={data.vat_credit > 0 ? "ok" : "neutral"} />
          </div>
          <Card title="Détail par taxe" padded={false}>
            <DataTable
              rows={data.taxes}
              rowKey={(t) => t.tax_id}
              empty="Aucune taxe comptabilisée sur la période."
              columns={[
                { key: "name", label: "Taxe" },
                { key: "use", label: "Nature", render: (t) => (t.use === "sale" ? "Collectée" : "Déductible") },
                { key: "rate", label: "Taux", align: "right", render: (t) => `${t.rate} %` },
                { key: "amount", label: "Montant", align: "right", render: (t) => fmtGNF(t.amount) },
              ]}
            />
          </Card>
          <Field label="Note">
            <Notice tone="warn">{data.note}</Notice>
          </Field>
        </div>
      )}
    </div>
  );
}
