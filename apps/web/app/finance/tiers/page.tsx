"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Loading, Modal, Notice, PageHeader, ProgressBar, Tabs } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import type { MoveSummary, Paged, Partner } from "@/lib/finance-types";
import { fmtDate, fmtGNF, fmtPct } from "@/lib/format";

interface PartnerDetail extends Partner {
  street: string | null;
  comment: string | null;
  use_credit_limit: boolean;
  credit_used_pct?: number;
  aging: Record<string, number>;
  open_items: Array<{ move_id: number; move: string; date: string; due: string | null; label: string; residual: number; late_days: number; kind: string }>;
  recent_moves: MoveSummary[];
}

type Kind = "all" | "customer" | "supplier";

export default function PartnersPage() {
  const [kind, setKind] = useState<Kind>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<Partner | "new" | null>(null);
  const params = new URLSearchParams({ limit: "300" });
  if (kind !== "all") params.set("kind", kind);
  if (search) params.set("search", search);
  const { data, error, isLoading, mutate } = useApi<Paged<Partner>>(`/finance/partners?${params.toString()}`);

  return (
    <div>
      <PageHeader
        title="Tiers"
        subtitle="Clients et fournisseurs : soldes, ancienneté des créances, limites de crédit."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Nouveau tiers
          </Button>
        }
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
          <Tabs
            tabs={[
              { key: "all", label: "Tous" },
              { key: "customer", label: "Clients" },
              { key: "supplier", label: "Fournisseurs" },
            ]}
            value={kind}
            onChange={setKind}
          />
          <Input className="max-w-xs" placeholder="Nom, NIF ou téléphone…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {error && <ErrorBox error={error} />}
        {isLoading && !data ? (
          <Loading />
        ) : (
          <DataTable
            rows={data?.items ?? []}
            rowKey={(p) => p.id}
            onRowClick={(p) => setSelected(p.id)}
            empty="Aucun tiers."
            columns={[
              { key: "name", label: "Nom" },
              { key: "role", label: "Rôle", render: (p) => <div className="flex gap-1">{p.customer && <Badge tone="ok">Client</Badge>}{p.supplier && <Badge tone="accent">Fournisseur</Badge>}</div> },
              { key: "city", label: "Ville", render: (p) => p.city ?? "—" },
              { key: "receivable", label: "Nous doit", align: "right", render: (p) => fmtGNF(p.receivable) },
              { key: "payable", label: "Nous lui devons", align: "right", render: (p) => fmtGNF(p.payable) },
              { key: "credit_limit", label: "Limite de crédit", align: "right", render: (p) => (p.credit_limit ? fmtGNF(p.credit_limit) : "—") },
            ]}
          />
        )}
      </Card>
      {selected !== null && <PartnerModal id={selected} onClose={() => setSelected(null)} onEdit={(p) => { setSelected(null); setEditing(p); }} />}
      {editing && <PartnerForm partner={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void mutate(); }} />}
    </div>
  );
}

function PartnerModal({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (p: Partner) => void }) {
  const { data: p, error } = useApi<PartnerDetail>(`/finance/partners/${id}`);
  return (
    <Modal open wide title={p?.name ?? "Tiers"} onClose={onClose} footer={p && <Button onClick={() => onEdit(p)}>Modifier</Button>}>
      {error && <ErrorBox error={error} />}
      {!p && !error && <Loading />}
      {p && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Kpi label="Nous doit" value={fmtGNF(p.receivable)} tone="accent" />
            <Kpi label="Nous lui devons" value={fmtGNF(p.payable)} />
            <Kpi label="Limite de crédit" value={p.credit_limit ? fmtGNF(p.credit_limit) : "Aucune"} hint={p.credit_used_pct !== undefined ? `Utilisée à ${fmtPct(p.credit_used_pct)}` : undefined} tone={(p.credit_used_pct ?? 0) > 100 ? "danger" : "neutral"} />
          </div>
          {p.credit_used_pct !== undefined && <ProgressBar value={p.credit_used_pct} tone={p.credit_used_pct > 100 ? "danger" : p.credit_used_pct > 80 ? "warn" : "ok"} />}
          <div className="grid grid-cols-2 gap-2 text-sm text-ink-2 md:grid-cols-4">
            <div>NIF : {p.vat ?? "—"}</div>
            <div>Tél. : {p.phone ?? "—"}</div>
            <div>Courriel : {p.email ?? "—"}</div>
            <div>{[p.street, p.city].filter(Boolean).join(", ") || "—"}</div>
          </div>
          <Card title="Pièces non soldées" padded={false}>
            <DataTable
              dense
              rows={p.open_items}
              rowKey={(i, n) => `${i.move_id}-${n}`}
              empty="Aucune pièce en attente."
              columns={[
                { key: "move", label: "Pièce" },
                { key: "kind", label: "Nature" },
                { key: "date", label: "Date", render: (i) => fmtDate(i.date) },
                { key: "due", label: "Échéance", render: (i) => fmtDate(i.due) },
                { key: "late_days", label: "Retard", align: "right", render: (i) => (i.late_days ? <span className="text-warn">{i.late_days} j</span> : "—") },
                { key: "residual", label: "Reste", align: "right", render: (i) => fmtGNF(Math.abs(i.residual)) },
              ]}
            />
          </Card>
        </div>
      )}
    </Modal>
  );
}

function PartnerForm({ partner, onClose, onSaved }: { partner: Partner | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: partner?.name ?? "",
    vat: partner?.vat ?? "",
    phone: partner?.phone ?? "",
    email: partner?.email ?? "",
    city: partner?.city ?? "",
    customer: partner?.customer ?? true,
    supplier: partner?.supplier ?? false,
    credit_limit: partner?.credit_limit ? String(partner.credit_limit) : "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    const body = { ...form, credit_limit: form.credit_limit ? Number(form.credit_limit.replace(/\s/g, "")) : 0 };
    try {
      if (partner) await apiSend("PATCH", `/finance/partners/${partner.id}`, body);
      else await apiSend("POST", "/finance/partners", body);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={partner ? `Modifier ${partner.name}` : "Nouveau tiers"} onClose={onClose} footer={<Button variant="primary" loading={busy} onClick={submit} disabled={!form.name}>Enregistrer</Button>}>
      <div className="grid grid-cols-2 gap-3">
        {error && (
          <div className="col-span-2">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        <Field label="Raison sociale" className="col-span-2">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="NIF">
          <Input value={form.vat} onChange={(e) => setForm({ ...form, vat: e.target.value })} />
        </Field>
        <Field label="Téléphone">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Courriel">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Ville">
          <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.checked })} /> Client
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.checked })} /> Fournisseur
        </label>
        <Field label="Limite de crédit (GNF)" hint="Vide : pas de limite" className="col-span-2">
          <Input inputMode="numeric" className="font-mono" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
