"use client";

import { useState } from "react";
import { Building2, FileCheck2, Plus, Printer, RefreshCw } from "lucide-react";
import { Badge, Button, Card, DataTable, Field, Input, Kpi, Loading, Modal, Notice, PageHeader, Select, Tabs } from "@/components/ui";
import { PartnerPicker } from "@/components/finance/PartnerPicker";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import { PAYMENT_STATES, type MoveSummary } from "@/lib/finance-types";
import { fmtDate, fmtGNF, fmtPct, fmtShort } from "@/lib/format";

interface Lease { id: number; name: string; property: { id: number; name: string }; tenant: { id: number; name: string }; date_start: string; date_end: string | null; rent: number; charges: number; periodicity: string; vat: boolean; deposit_amount: number; state: "draft" | "active" | "terminated"; next_invoice_date: string | null }
interface Property { id: number; name: string; kind: string; address: string | null; city: string | null; area_m2: number; acquisition_value: number; current_value: number; occupied: boolean; lease: Lease | null }
interface Summary { properties: number; occupied: number; occupancy_rate: number | null; annual_rent: number; portfolio_value: number; gross_yield: number | null; unpaid_count: number; unpaid_amount: number; leases_expiring_3m: number }
interface Receipt { number: string; date: string; company: string; company_address: string | null; tenant: string; property: string | null; property_address: string | null; lines: Array<{ name: string; amount: number }>; amount_total: number }

export default function RealEstatePage() {
  const [tab, setTab] = useState<"biens" | "loyers" | "impayes">("biens");
  const { data: summary, mutate: refreshSummary } = useApi<Summary>("/immobilier/summary");
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  async function generate() {
    try {
      const res = await apiSend<{ invoices: MoveSummary[] }>("POST", "/immobilier/rents/generate", {});
      setMessage({ tone: "ok", text: res.invoices.length ? `${res.invoices.length} quittance(s) de loyer émise(s).` : "Aucun loyer échu à facturer." });
      void refreshSummary();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof ApiError ? e.message : "Erreur" });
    }
  }
  return (
    <div>
      <PageHeader title="Immobilier" subtitle="Biens, baux, loyers et quittancement automatique, relances, valorisation du patrimoine." actions={<Button variant="primary" onClick={generate}><RefreshCw className="h-4 w-4" /> Émettre les loyers échus</Button>} />
      {message && <div className="mb-4"><Notice tone={message.tone}>{message.text}</Notice></div>}
      {summary && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi label="Biens" value={String(summary.properties)} hint={`${summary.occupied} loué(s), ${fmtPct(summary.occupancy_rate, 0)} d'occupation`} />
          <Kpi label="Loyers annuels" value={fmtShort(summary.annual_rent)} tone="ok" />
          <Kpi label="Valeur du patrimoine" value={fmtShort(summary.portfolio_value)} />
          <Kpi label="Rendement brut" value={fmtPct(summary.gross_yield)} tone="accent" />
          <Kpi label="Loyers impayés" value={fmtShort(summary.unpaid_amount)} hint={`${summary.unpaid_count} échéance(s) · ${summary.leases_expiring_3m} bail(aux) à échéance sous 3 mois`} tone={summary.unpaid_count ? "warn" : "neutral"} />
        </div>
      )}
      <Tabs tabs={[{ key: "biens", label: "Biens et baux" }, { key: "loyers", label: "Loyers émis" }, { key: "impayes", label: "Impayés et relances" }]} value={tab} onChange={setTab} />
      {tab === "biens" && <Properties onChanged={() => refreshSummary()} />}
      {tab === "loyers" && <Rents />}
      {tab === "impayes" && <Unpaid />}
    </div>
  );
}

function Properties({ onChanged }: { onChanged: () => void }) {
  const { data, mutate } = useApi<{ items: Property[]; kinds: Array<{ code: string; label: string }> }>("/immobilier/properties");
  const [creating, setCreating] = useState(false);
  const [leasing, setLeasing] = useState<Property | null>(null);
  const [ending, setEnding] = useState<Property | null>(null);
  return (
    <>
      <div className="mb-3 flex justify-end"><Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouveau bien</Button></div>
      <Card padded={false}>
        {!data ? <Loading /> : (
          <DataTable rows={data.items} rowKey={(p) => p.id} empty="Aucun bien." columns={[
            { key: "name", label: "Bien", render: (p) => <span className="flex items-center gap-2"><Building2 className="h-4 w-4 text-accent" />{p.name}</span> },
            { key: "kind", label: "Nature", render: (p) => data.kinds.find((k) => k.code === p.kind)?.label ?? p.kind },
            { key: "area_m2", label: "Surface", align: "right", render: (p) => (p.area_m2 ? `${p.area_m2} m²` : "—") },
            { key: "current_value", label: "Valeur", align: "right", render: (p) => fmtGNF(p.current_value || p.acquisition_value) },
            { key: "lease", label: "Locataire", render: (p) => p.lease ? `${p.lease.tenant.name}, ${fmtGNF(p.lease.rent)} / ${p.lease.periodicity === "monthly" ? "mois" : p.lease.periodicity === "quarterly" ? "trimestre" : "an"}` : "—" },
            { key: "occupied", label: "", render: (p) => p.occupied ? (
              <span className="flex items-center justify-end gap-2"><Badge tone="ok">Loué</Badge>{p.lease && <Button className="px-2 py-1 text-xs" onClick={() => setEnding(p)}>Fin de bail</Button>}</span>
            ) : <Button className="px-2 py-1 text-xs" onClick={() => setLeasing(p)}>Louer</Button> },
          ]} />
        )}
      </Card>
      {creating && data && <PropertyForm kinds={data.kinds} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void mutate(); onChanged(); }} />}
      {leasing && <LeaseForm property={leasing} onClose={() => setLeasing(null)} onDone={() => { setLeasing(null); void mutate(); onChanged(); }} />}
      {ending?.lease && <TerminateForm property={ending} lease={ending.lease} onClose={() => setEnding(null)} onDone={() => { setEnding(null); void mutate(); onChanged(); }} />}
    </>
  );
}

function PropertyForm({ kinds, onClose, onDone }: { kinds: Array<{ code: string; label: string }>; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", kind: "appartement", address: "", city: "Conakry", area_m2: "", acquisition_value: "", current_value: "" });
  const [error, setError] = useState<string | null>(null);
  const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", ".")) || 0;
  return (
    <Modal open title="Nouveau bien" onClose={onClose} footer={<Button variant="primary" disabled={!f.name} onClick={() => apiSend("POST", "/immobilier/properties", { ...f, area_m2: num(f.area_m2), acquisition_value: num(f.acquisition_value), current_value: num(f.current_value) }).then(onDone).catch((e) => setError(e instanceof ApiError ? e.message : "Erreur"))}>Enregistrer</Button>}>
      <div className="grid grid-cols-2 gap-3">
        {error && <div className="col-span-2"><Notice tone="danger">{error}</Notice></div>}
        <Field label="Désignation" className="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Nature"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={kinds.map((k) => ({ value: k.code, label: k.label }))} /></Field>
        <Field label="Surface (m²)"><Input inputMode="decimal" value={f.area_m2} onChange={(e) => setF({ ...f, area_m2: e.target.value })} /></Field>
        <Field label="Adresse" className="col-span-2"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Valeur d'acquisition"><Input inputMode="numeric" className="font-mono" value={f.acquisition_value} onChange={(e) => setF({ ...f, acquisition_value: e.target.value })} /></Field>
        <Field label="Valeur actuelle"><Input inputMode="numeric" className="font-mono" value={f.current_value} onChange={(e) => setF({ ...f, current_value: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function LeaseForm({ property, onClose, onDone }: { property: Property; onClose: () => void; onDone: () => void }) {
  const [tenant, setTenant] = useState<{ id: number; name: string } | null>(null);
  const [f, setF] = useState({ name: "", date_start: new Date().toISOString().slice(0, 10), date_end: "", rent: "", charges: "", periodicity: "monthly", deposit_amount: "", vat: false });
  const [error, setError] = useState<string | null>(null);
  const num = (v: string) => Number(v.replace(/\s/g, "")) || 0;
  return (
    <Modal open title={`Bail · ${property.name}`} onClose={onClose} footer={<Button variant="primary" disabled={!f.name || !tenant || !f.rent} onClick={() => apiSend("POST", "/immobilier/leases", { ...f, property_id: property.id, partner_id: tenant?.id, rent: num(f.rent), charges: num(f.charges), deposit_amount: num(f.deposit_amount), date_end: f.date_end || undefined, activate: true }).then(onDone).catch((e) => setError(e instanceof ApiError ? e.message : "Erreur"))}>Signer et activer le bail</Button>}>
      <div className="grid grid-cols-2 gap-3">
        {error && <div className="col-span-2"><Notice tone="danger">{error}</Notice></div>}
        <Field label="Référence du bail"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Périodicité"><Select value={f.periodicity} onChange={(e) => setF({ ...f, periodicity: e.target.value })} options={[{ value: "monthly", label: "Mensuelle" }, { value: "quarterly", label: "Trimestrielle" }, { value: "yearly", label: "Annuelle" }]} /></Field>
        <Field label="Locataire" className="col-span-2"><PartnerPicker value={tenant} onChange={setTenant} kind="customer" /></Field>
        <Field label="Prise d'effet"><Input type="date" value={f.date_start} onChange={(e) => setF({ ...f, date_start: e.target.value })} /></Field>
        <Field label="Échéance"><Input type="date" value={f.date_end} onChange={(e) => setF({ ...f, date_end: e.target.value })} /></Field>
        <Field label="Loyer HT par période"><Input inputMode="numeric" className="font-mono" value={f.rent} onChange={(e) => setF({ ...f, rent: e.target.value })} /></Field>
        <Field label="Charges par période"><Input inputMode="numeric" className="font-mono" value={f.charges} onChange={(e) => setF({ ...f, charges: e.target.value })} /></Field>
        <Field label="Dépôt de garantie"><Input inputMode="numeric" className="font-mono" value={f.deposit_amount} onChange={(e) => setF({ ...f, deposit_amount: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.vat} onChange={(e) => setF({ ...f, vat: e.target.checked })} /> Bail soumis à la TVA</label>
      </div>
    </Modal>
  );
}

function Rents() {
  const { data } = useApi<MoveSummary[]>("/immobilier/rents");
  const [receipt, setReceipt] = useState<number | null>(null);
  return (
    <>
      <Card padded={false}>
        {!data ? <Loading /> : (
          <DataTable rows={data} rowKey={(m) => m.id} empty="Aucun loyer émis." columns={[
            { key: "name", label: "Quittance", render: (m) => <span className="font-mono text-xs">{m.name}</span> },
            { key: "invoice_date", label: "Date", render: (m) => fmtDate(m.invoice_date) },
            { key: "partner", label: "Locataire", render: (m) => m.partner?.name ?? "—" },
            { key: "amount_total", label: "Montant", align: "right", render: (m) => fmtGNF(m.amount_total) },
            { key: "payment_state", label: "Règlement", render: (m) => <Badge tone={PAYMENT_STATES[m.payment_state]?.tone}>{PAYMENT_STATES[m.payment_state]?.label ?? m.payment_state}</Badge> },
            { key: "x", label: "", render: (m) => (m.payment_state === "paid" || m.payment_state === "in_payment") ? <Button className="px-2 py-1 text-xs" onClick={() => setReceipt(m.id)}><FileCheck2 className="h-3.5 w-3.5" /> Quittance</Button> : null },
          ]} />
        )}
      </Card>
      {receipt !== null && <ReceiptModal id={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

/** Fin de bail : les loyers dus jusqu'à la date de fin sont émis, puis le quittancement s'arrête. */
function TerminateForm({ property, lease, onClose, onDone }: { property: Property; lease: Lease; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", `/immobilier/leases/${lease.id}/terminate`, { date });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={`Fin de bail · ${property.name}`} onClose={onClose} footer={<Button variant="danger" loading={busy} disabled={!date} onClick={submit}>Mettre fin au bail</Button>}>
      <div className="space-y-3 text-sm">
        {error && <Notice tone="danger">{error}</Notice>}
        <p>Bail {lease.name} de {lease.tenant.name}. Les loyers dus jusqu&apos;à la date de fin sont émis, puis le bien redevient libre et n&apos;est plus facturé. Un loyer déjà émis pour une période postérieure s&apos;annule par un avoir (finance).</p>
        <Field label="Date de fin"><Input type="date" value={date} min={lease.date_start} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ReceiptModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: r, error } = useApi<Receipt>(`/immobilier/receipts/${id}`);
  return (
    <Modal open title="Quittance de loyer" onClose={onClose} footer={<Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimer</Button>}>
      {error && <Notice tone="danger">{error.message}</Notice>}
      {r && (
        <div className="space-y-3 rounded-lg bg-white p-6 text-sm text-black">
          <div className="flex justify-between"><b>{r.company}</b><span>Quittance n° {r.number}</span></div>
          <p>Reçu de {r.tenant} la somme de <b>{fmtGNF(r.amount_total)}</b> au titre du loyer et des charges du bien {r.property} {r.property_address ? `(${r.property_address})` : ""}, pour la période suivante :</p>
          <ul className="list-disc pl-5">{r.lines.map((l, i) => <li key={i}>{l.name} : {fmtGNF(l.amount)}</li>)}</ul>
          <p>Dont quittance, sous réserve de tous droits. Fait le {fmtDate(r.date)}.</p>
        </div>
      )}
    </Modal>
  );
}

function Unpaid() {
  const { data } = useApi<Array<MoveSummary & { late_days: number }>>("/immobilier/unpaid");
  return (
    <Card padded={false}>
      {!data ? <Loading /> : (
        <DataTable rows={data} rowKey={(m) => m.id} empty="Aucun loyer impayé." columns={[
          { key: "partner", label: "Locataire", render: (m) => m.partner?.name ?? "—" },
          { key: "name", label: "Échéance", render: (m) => `${m.name} du ${fmtDate(m.invoice_date)}` },
          { key: "invoice_date_due", label: "Exigible le", render: (m) => fmtDate(m.invoice_date_due) },
          { key: "late_days", label: "Retard", align: "right", render: (m) => <span className={m.late_days > 30 ? "text-danger" : "text-warn"}>{m.late_days} j</span> },
          { key: "amount_residual", label: "Reste dû", align: "right", render: (m) => fmtGNF(m.amount_residual) },
        ]} />
      )}
    </Card>
  );
}
