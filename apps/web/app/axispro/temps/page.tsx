"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card, DataTable, Etat, Field, Input, Kpi, Notice, PageHeader, RankBars, Select, Tabs, Badge } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import type { DossierSummary } from "@/lib/axispro-types";
import { fmtDate, fmtDec } from "@/lib/format";

interface Sheet {
  id: number;
  dossier: { id: number; reference: string; name: string };
  user: string;
  date: string;
  hours: number;
  description: string;
  billable: boolean;
  invoice: string | null;
}

export default function TempsPage() {
  const [filter, setFilter] = useState<"unbilled" | "all">("unbilled");
  const { data, error, mutate } = useApi<Sheet[]>(`/axispro/timesheets${filter === "unbilled" ? "?unbilled=1" : ""}`);
  const { data: dossiers } = useApi<DossierSummary[]>("/axispro/dossiers?state=open,on_hold");
  const [f, setF] = useState({ dossier_id: "", date: new Date().toISOString().slice(0, 10), hours: "", description: "", billable: true });
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const rows = data ?? [];
  const byDossier = Object.values(
    rows.reduce<Record<number, { id: number; reference: string; name: string; hours: number; unbilled: number }>>((acc, t) => {
      const cur = (acc[t.dossier.id] ??= { ...t.dossier, hours: 0, unbilled: 0 });
      cur.hours += t.hours;
      if (t.billable && !t.invoice) cur.unbilled += t.hours;
      return acc;
    }, {}),
  );
  async function submit() {
    setMessage(null);
    try {
      await apiSend("POST", "/axispro/timesheets", { ...f, dossier_id: Number(f.dossier_id), hours: Number(f.hours.replace(",", ".")) });
      setF({ ...f, hours: "", description: "" });
      setMessage({ tone: "ok", text: "Temps enregistré." });
      void mutate();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Enregistrement impossible." });
    }
  }
  return (
    <div>
      <PageHeader title="Temps et facturation" subtitle="Temps passés par dossier ; la facture d'honoraires se crée depuis l'onglet Temps et facturation du dossier." />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi label="Heures affichées" value={fmtDec(rows.reduce((a, t) => a + t.hours, 0))} />
        <Kpi label="Heures à facturer" value={fmtDec(rows.filter((t) => t.billable && !t.invoice).reduce((a, t) => a + t.hours, 0))} tone="warn" hint="Temps facturables sans facture d'honoraires" />
        <Kpi label="Dossiers concernés" value={String(byDossier.length)} />
      </div>
      {message && <div className="mb-4"><Notice tone={message.tone}>{message.text}</Notice></div>}
      <Card title="Saisir du temps" className="mb-6">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
          <Field label="Dossier" className="md:col-span-2"><Select value={f.dossier_id} onChange={(e) => setF({ ...f, dossier_id: e.target.value })} placeholder="Choisir" options={(dossiers ?? []).map((d) => ({ value: d.id, label: `${d.reference}, ${d.name}` }))} /></Field>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Heures"><Input inputMode="decimal" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></Field>
          <Field label="Travaux" className="md:col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} /> Facturable</label>
          <Button variant="primary" disabled={!f.dossier_id || !f.hours || !f.description} onClick={submit}>Enregistrer</Button>
        </div>
      </Card>
      <Tabs tabs={[{ key: "unbilled", label: "À facturer" }, { key: "all", label: "Tous les temps" }]} value={filter} onChange={setFilter} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Heures par dossier">
          {byDossier.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Aucun temps.</p>
          ) : (
            <RankBars
              couleur="var(--g-azur)"
              format={(v) => `${fmtDec(v)} h`}
              items={[...byDossier].sort((a, b) => b.hours - a.hours).map((d) => ({ key: d.id, label: d.name, value: d.hours, detail: `${d.reference}, ${fmtDec(d.unbilled)} h à facturer` }))}
            />
          )}
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
            {byDossier.map((d) => (
              <Link key={d.id} className="rounded-md bg-accent-doux px-2 py-0.5 text-[12px] font-semibold text-accent hover:underline" href={`/axispro/dossiers/${d.id}`}>
                {d.reference}
              </Link>
            ))}
          </div>
        </Card>
        <Card title="Détail" padded={false} className="xl:col-span-2">
          {!data ? <Etat error={error} onRetry={() => mutate()} /> : (
            <DataTable dense rows={rows} rowKey={(t) => t.id} empty="Aucun temps." columns={[
              { key: "date", label: "Date", render: (t) => fmtDate(t.date) },
              { key: "dossier", label: "Dossier", render: (t) => t.dossier.reference },
              { key: "user", label: "Consultant" },
              { key: "description", label: "Travaux" },
              { key: "hours", label: "Heures", align: "right", render: (t) => fmtDec(t.hours) },
              { key: "invoice", label: "Facture", render: (t) => t.invoice ?? (t.billable ? <Badge tone="warn">À facturer</Badge> : "Non facturable") },
            ]} />
          )}
        </Card>
      </div>
    </div>
  );
}
