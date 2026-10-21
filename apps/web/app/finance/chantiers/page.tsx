"use client";

import { useState } from "react";
import { HardHat, Plus, Unlock } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Loading, Modal, Notice, PageHeader, ProgressBar, Select } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { fmtDate, fmtGNF, fmtPct, fmtShort } from "@/lib/format";

interface Situation {
  id: number;
  number: number;
  date: string;
  period_label: string | null;
  cumulative_amount: number;
  previous_amount: number;
  amount_period: number;
  retention_amount: number;
  progress_pct: number;
  state: "draft" | "invoiced" | "cancelled";
  invoice: { id: number; name: string; residual: number } | null;
}
interface Chantier {
  id: number;
  name: string;
  code: string | null;
  client: { id: number; name: string };
  contract_amount: number;
  retention_rate: number;
  state: "preparation" | "progress" | "received" | "closed";
  location: string | null;
  invoiced_amount: number;
  progress_pct: number;
  retention_total: number;
  retention_released: number;
  retention_outstanding: number;
  costs?: number;
  margin?: number;
  situations?: Situation[];
}

const STATE = { preparation: ["En préparation", "neutral"], progress: ["En cours", "accent"], received: ["Réceptionné", "ok"], closed: ["Clos", "neutral"] } as const;

export default function ChantiersPage() {
  const { data, error, mutate } = useApi<{ items: Chantier[]; totals: Record<string, number> }>("/chantiers");
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageHeader
        title="BTP"
        subtitle="Situations d'avancement, facturation à l'avancement, retenues de garantie suivies jusqu'à leur libération."
        actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouveau chantier</Button>}
      />
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Kpi label="Marchés en portefeuille" value={fmtShort(data.totals.contract_amount)} />
            <Kpi label="Travaux facturés" value={fmtShort(data.totals.invoiced_amount)} tone="ok" />
            <Kpi label="Retenues de garantie à recouvrer" value={fmtShort(data.totals.retention_outstanding)} tone="warn" />
          </div>
          <Card padded={false}>
            <DataTable
              rows={data.items}
              rowKey={(c) => c.id}
              onRowClick={(c) => setSelected(c.id)}
              empty="Aucun chantier."
              columns={[
                { key: "name", label: "Chantier", render: (c) => <span className="flex items-center gap-2"><HardHat className="h-4 w-4 text-accent" />{c.name}</span> },
                { key: "client", label: "Maître d'ouvrage", render: (c) => c.client.name },
                { key: "contract_amount", label: "Marché HT", align: "right", render: (c) => fmtGNF(c.contract_amount) },
                { key: "progress_pct", label: "Avancement", render: (c) => <div className="w-32"><ProgressBar value={c.progress_pct} tone="accent" /><span className="text-[11px] text-muted">{fmtPct(c.progress_pct, 0)}</span></div> },
                { key: "invoiced_amount", label: "Facturé HT", align: "right", render: (c) => fmtGNF(c.invoiced_amount) },
                { key: "retention_outstanding", label: "Retenues", align: "right", render: (c) => fmtGNF(c.retention_outstanding) },
                { key: "state", label: "État", render: (c) => <Badge tone={STATE[c.state][1]}>{STATE[c.state][0]}</Badge> },
              ]}
            />
          </Card>
        </>
      )}
      {selected !== null && <ChantierModal id={selected} onClose={() => setSelected(null)} onChanged={() => mutate()} />}
      {creating && <ChantierForm onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); void mutate(); setSelected(id); }} />}
    </div>
  );
}

function ChantierModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { data: c, mutate } = useApi<Chantier>(`/chantiers/${id}`);
  const [mode, setMode] = useState<"amount" | "pct">("pct");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  async function act(fn: () => Promise<unknown>, ok?: string) {
    setMessage(null);
    try {
      await fn();
      await mutate();
      onChanged();
      if (ok) setMessage({ tone: "ok", text: ok });
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Action impossible." });
    }
  }
  return (
    <Modal open wide title={c ? `${c.name}, ${c.client.name}` : "Chantier"} onClose={onClose}>
      {!c ? <Loading /> : (
        <div className="space-y-5">
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Marché HT" value={fmtShort(c.contract_amount)} />
            <Kpi label="Facturé HT" value={fmtShort(c.invoiced_amount)} hint={fmtPct(c.progress_pct)} tone="accent" />
            <Kpi label="Coûts imputés" value={fmtShort(c.costs)} />
            <Kpi label="Marge" value={fmtShort(c.margin)} tone={(c.margin ?? 0) >= 0 ? "ok" : "danger"} />
          </div>
          <DataTable dense rows={c.situations ?? []} rowKey={(s) => s.id} empty="Aucune situation." columns={[
            { key: "number", label: "N°", align: "right", render: (s) => String(s.number) },
            { key: "date", label: "Date", render: (s) => fmtDate(s.date) },
            { key: "period_label", label: "Période", render: (s) => s.period_label ?? "–" },
            { key: "cumulative_amount", label: "Cumul HT", align: "right", render: (s) => fmtGNF(s.cumulative_amount) },
            { key: "amount_period", label: "Période HT", align: "right", render: (s) => fmtGNF(s.amount_period) },
            { key: "retention_amount", label: `Retenue ${c.retention_rate} %`, align: "right", render: (s) => fmtGNF(s.retention_amount) },
            { key: "state", label: "", render: (s) => s.state === "draft" ? <span className="flex justify-end gap-2"><Button className="px-2 py-1 text-xs" onClick={() => act(() => apiSend("POST", `/chantiers/situations/${s.id}/invoice`), "Situation facturée.")}>Facturer</Button><Button variant="danger" className="px-2 py-1 text-xs" onClick={() => { if (window.confirm("Annuler cette situation saisie ? Elle ne sera pas facturée.")) void act(() => apiSend("POST", `/chantiers/situations/${s.id}/cancel`), "Situation annulée."); }}>Annuler</Button></span> : s.invoice ? <Badge tone="ok">{s.invoice.name}</Badge> : <Badge>Annulée</Badge> },
          ]} />
          <Card title="Nouvelle situation">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
              <Field label="Saisie"><Select value={mode} onChange={(e) => setMode(e.target.value as "amount" | "pct")} options={[{ value: "pct", label: "Avancement cumulé (%)" }, { value: "amount", label: "Travaux cumulés HT" }]} /></Field>
              <Field label={mode === "pct" ? "Avancement cumulé (%)" : "Montant cumulé HT"}><Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
              <Field label="Période" className="md:col-span-2"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Travaux d'octobre 2026" /></Field>
              <div className="flex items-end"><Button variant="primary" disabled={!value} onClick={() => act(() => apiSend("POST", `/chantiers/${c.id}/situations`, mode === "pct" ? { progress_pct: Number(value.replace(",", ".")), period_label: label } : { cumulative_amount: Number(value.replace(/\s/g, "")), period_label: label }), "Situation enregistrée en brouillon.").then(() => { setValue(""); setLabel(""); })}>Enregistrer</Button></div>
            </div>
          </Card>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-panel-2 px-4 py-3 text-sm">
            <span>Retenues constituées {fmtGNF(c.retention_total)}, libérées {fmtGNF(c.retention_released)}, à recouvrer <b>{fmtGNF(c.retention_outstanding)}</b>.</span>
            <Button disabled={c.retention_outstanding <= 0} onClick={() => act(() => apiSend("POST", `/chantiers/${c.id}/release-retention`), "Retenues libérées : elles redeviennent exigibles du client.")}><Unlock className="h-4 w-4" /> Libérer les retenues</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ChantierForm({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [client, setClient] = useState<{ id: number; name: string } | null>(null);
  const [f, setF] = useState({ name: "", code: "", contract_amount: "", retention_rate: "5", location: "", date_start: "" });
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    try {
      const c = await apiSend<Chantier>("POST", "/chantiers", { ...f, partner_id: client?.id, contract_amount: Number(f.contract_amount.replace(/\s/g, "")) || 0, retention_rate: Number(f.retention_rate) || 0, date_start: f.date_start || undefined });
      onDone(c.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    }
  }
  return (
    <Modal open title="Nouveau chantier" onClose={onClose} footer={<Button variant="primary" onClick={submit} disabled={!f.name || !client}>Créer</Button>}>
      <div className="grid grid-cols-2 gap-3">
        {error && <div className="col-span-2"><Notice tone="danger">{error}</Notice></div>}
        <Field label="Chantier" className="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Maître d'ouvrage" className="col-span-2"><PartnerPicker value={client} onChange={setClient} kind="customer" /></Field>
        <Field label="Code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Localisation"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label="Montant du marché HT"><Input inputMode="numeric" className="font-mono" value={f.contract_amount} onChange={(e) => setF({ ...f, contract_amount: e.target.value })} /></Field>
        <Field label="Retenue de garantie (%)"><Input inputMode="decimal" value={f.retention_rate} onChange={(e) => setF({ ...f, retention_rate: e.target.value })} /></Field>
        <Field label="Démarrage"><Input type="date" value={f.date_start} onChange={(e) => setF({ ...f, date_start: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
