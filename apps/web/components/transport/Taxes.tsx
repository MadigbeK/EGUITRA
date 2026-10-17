"use client";

import { useState } from "react";
import { Download } from "@/components/icons";
import { Button, Card, DataTable, Field, Input, Loading, Notice } from "@/components/ui";
import { ApiError, apiDownload, useApi } from "@/lib/api-client";
import { fmtGNF, fmtShort } from "@/lib/format";

interface NatureRow { code: string; label: string; months: Record<string, number>; total: number; rebillable: number; lines: number }
interface Statement {
  months: string[];
  natures: NatureRow[];
  totals: { months: Record<string, number>; total: number; rebillable: number };
  booked: Array<{ account: { id: number; code: string; name: string }; months: Record<string, number>; total: number }>;
}

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });

/** État mensuel des taxes spécifiques par nature, rapproché des montants comptabilisés. */
export function Taxes() {
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const { data, error } = useApi<Statement>(`/transport/taxes/statement?date_from=${from}&date_to=${to}`);
  const [message, setMessage] = useState<string | null>(null);
  async function exporter() {
    setMessage(null);
    try {
      await apiDownload(`/transport/taxes/statement.xlsx?date_from=${from}&date_to=${to}`, "taxes_transport.xlsx");
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Export impossible.");
    }
  }
  const months = data?.months ?? [];
  const bookedTotal = (data?.booked ?? []).reduce((s, b) => s + b.total, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Du"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Au"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <Button onClick={() => void exporter()}><Download className="h-4 w-4" /> Export XLSX</Button>
      </div>
      {message && <Notice tone="danger">{message}</Notice>}
      {error && <Notice tone="danger">{error.message}</Notice>}
      <Card title="Taxes spécifiques par nature (rotations validées et facturées)" padded={false}>
        {!data ? <Loading /> : (
          <DataTable dense rows={data.natures} rowKey={(r) => r.code} empty="Aucune taxe spécifique sur la période : paramétrez le barème dans l'onglet Paramètres." columns={[
            { key: "label", label: "Nature" },
            ...months.map((m) => ({ key: m, label: monthLabel(m), align: "right" as const, render: (r: NatureRow) => fmtShort(r.months[m]) })),
            { key: "total", label: "Total", align: "right", render: (r) => <span className="font-semibold">{fmtGNF(r.total)}</span> },
            { key: "rebillable", label: "dont refacturé", align: "right", render: (r) => fmtShort(r.rebillable) },
          ]} footer={data.natures.length ? (
            <tr>
              <td className="px-3 py-2">Total</td>
              {months.map((m) => <td key={m} className="px-3 py-2 text-right font-mono">{fmtShort(data.totals.months[m])}</td>)}
              <td className="px-3 py-2 text-right font-mono">{fmtGNF(data.totals.total)}</td>
              <td className="px-3 py-2 text-right font-mono">{fmtShort(data.totals.rebillable)}</td>
            </tr>
          ) : undefined} />
        )}
      </Card>
      {data && data.booked.length > 0 && (
        <Card title="Comptabilisé sur les comptes du barème" padded={false}>
          <p className="px-5 pt-4 text-[13px] text-muted">
            Pièces validées sur les comptes de charge des taxes ({fmtGNF(bookedTotal)}), face au barème ({fmtGNF(data.totals.total - data.totals.rebillable)} hors refacturation, {fmtGNF(data.totals.total)} en tout).
          </p>
          <DataTable dense rows={data.booked} rowKey={(b) => b.account.id} columns={[
            { key: "account", label: "Compte", render: (b) => `${b.account.code} ${b.account.name}` },
            ...months.map((m) => ({ key: m, label: monthLabel(m), align: "right" as const, render: (b: Statement["booked"][number]) => fmtShort(b.months[m]) })),
            { key: "total", label: "Total", align: "right", render: (b) => fmtGNF(b.total) },
          ]} />
        </Card>
      )}
    </div>
  );
}
