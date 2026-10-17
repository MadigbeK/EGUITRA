"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Loading, Modal, Notice, PageHeader, ProgressBar, Tabs, Tag } from "@/components/ui";
import { ApiError, apiSend, useApi } from "@/lib/api-client";
import type { MoveSummary, Paged, Partner } from "@/lib/finance-types";
import { fmtDate, fmtGNF, fmtPct } from "@/lib/format";

interface PaymentTerm { id: number; name: string; days: number | null; end_of_month: boolean | null }
interface PartnerDetail extends Partner {
  street: string | null;
  comment: string | null;
  rccm?: string | null;
  payment_term?: PaymentTerm | null;
  supplier_payment_term?: PaymentTerm | null;
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
              { key: "role", label: "Rôle", render: (p) => <div className="flex gap-1">{p.customer && <Tag>Client</Tag>}{p.supplier && <Tag>Fournisseur</Tag>}</div> },
              { key: "city", label: "Ville", render: (p) => p.city ?? "–" },
              { key: "receivable", label: "Nous doit", align: "right", render: (p) => fmtGNF(p.receivable) },
              { key: "payable", label: "Nous lui devons", align: "right", render: (p) => fmtGNF(p.payable) },
              { key: "credit_limit", label: "Limite de crédit", align: "right", render: (p) => (p.credit_limit ? fmtGNF(p.credit_limit) : "–") },
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
            <div>Code : {p.ref ?? "–"}</div>
            <div>Secteur : {p.sector ?? "–"}</div>
            <div>Contact : {p.contact ?? "–"}</div>
            <div>RCCM : {p.rccm ?? "–"}</div>
            <div>Paiement client : {p.payment_term?.name ?? "–"}</div>
            <div>Paiement fournisseur : {p.supplier_payment_term?.name ?? "–"}</div>
            <div>TVA : {p.vat_exempt ? "non assujetti (exonéré)" : "assujetti"}</div>
            <div>NIF : {p.vat ?? "–"}</div>
            <div>Tél. : {p.phone ?? "–"}</div>
            <div>Courriel : {p.email ?? "–"}</div>
            <div>{[p.street, p.city].filter(Boolean).join(", ") || "–"}</div>
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
                { key: "late_days", label: "Retard", align: "right", render: (i) => (i.late_days ? <span className="text-warn">{i.late_days} j</span> : "–") },
                { key: "residual", label: "Reste", align: "right", render: (i) => fmtGNF(Math.abs(i.residual)) },
              ]}
            />
          </Card>
        </div>
      )}
    </Modal>
  );
}

const termDays = (t?: PaymentTerm | null) => (t?.days !== null && t?.days !== undefined ? String(t.days) : "");

/**
 * Fiche d'un tiers : identité (code, NIF, RCCM, secteur, contact), rôles, limite de crédit, conditions
 * de paiement (délai, fin de mois) côté client et côté fournisseur, assujettissement à la TVA.
 */
function PartnerForm({ partner, onClose, onSaved }: { partner: (Partner & Partial<PartnerDetail>) | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: partner?.name ?? "",
    ref: partner?.ref ?? "",
    vat: partner?.vat ?? "",
    rccm: partner?.rccm ?? "",
    sector: partner?.sector ?? "",
    contact: partner?.contact ?? "",
    phone: partner?.phone ?? "",
    email: partner?.email ?? "",
    city: partner?.city ?? "",
    customer: partner?.customer ?? true,
    supplier: partner?.supplier ?? false,
    credit_limit: partner?.credit_limit ? String(partner.credit_limit) : "",
    vat_exempt: partner?.vat_exempt ?? false,
    customer_days: termDays(partner?.payment_term),
    customer_eom: partner?.payment_term?.end_of_month ?? false,
    supplier_days: termDays(partner?.supplier_payment_term),
    supplier_eom: partner?.supplier_payment_term?.end_of_month ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const term = (days: string, eom: boolean) => (days.trim() === "" ? null : { days: Number(days), end_of_month: eom });
  async function submit() {
    setBusy(true);
    setError(null);
    const body = {
      name: form.name,
      ref: form.ref,
      vat: form.vat,
      rccm: form.rccm,
      sector: form.sector,
      contact: form.contact,
      phone: form.phone,
      email: form.email,
      city: form.city,
      customer: form.customer,
      supplier: form.supplier,
      vat_exempt: form.vat_exempt,
      credit_limit: form.credit_limit ? Number(form.credit_limit.replace(/\s/g, "")) : 0,
      // Une condition n'est envoyée que modifiée (une condition à plusieurs échéances reste intacte).
      ...(form.customer_days !== termDays(partner?.payment_term) || form.customer_eom !== (partner?.payment_term?.end_of_month ?? false)
        ? { payment_term: term(form.customer_days, form.customer_eom) }
        : {}),
      ...(form.supplier_days !== termDays(partner?.supplier_payment_term) || form.supplier_eom !== (partner?.supplier_payment_term?.end_of_month ?? false)
        ? { supplier_payment_term: term(form.supplier_days, form.supplier_eom) }
        : {}),
    };
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
  const text = (key: keyof typeof form, label: string, props: { className?: string; type?: string; placeholder?: string } = {}) => (
    <Field label={label} className={props.className}>
      <Input type={props.type} placeholder={props.placeholder} value={String(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </Field>
  );
  return (
    <Modal open wide title={partner ? `Modifier ${partner.name}` : "Nouveau tiers"} onClose={onClose} footer={<Button variant="primary" loading={busy} onClick={submit} disabled={!form.name}>Enregistrer</Button>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {error && (
          <div className="col-span-2 md:col-span-4">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        {text("name", "Raison sociale", { className: "col-span-2 md:col-span-3" })}
        {text("ref", "Code", { placeholder: "CLI-0001" })}
        {text("vat", "NIF")}
        {text("rccm", "RCCM")}
        {text("sector", "Secteur", { placeholder: "Mines, distribution…" })}
        {text("contact", "Contact", { placeholder: "Nom, fonction" })}
        {text("phone", "Téléphone")}
        {text("email", "Courriel", { type: "email" })}
        {text("city", "Ville")}
        <div className="flex flex-col justify-end gap-1.5 pb-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.checked })} /> Client
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.checked })} /> Fournisseur
          </label>
        </div>
        <Field label="Délai de paiement client (jours)" hint="Vide : selon la société">
          <Input inputMode="numeric" className="font-mono" value={form.customer_days} onChange={(e) => setForm({ ...form, customer_days: e.target.value })} />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={form.customer_eom} onChange={(e) => setForm({ ...form, customer_eom: e.target.checked })} /> à compter de la fin du mois
        </label>
        <Field label="Délai de paiement fournisseur (jours)" hint="Vide : selon la société">
          <Input inputMode="numeric" className="font-mono" value={form.supplier_days} onChange={(e) => setForm({ ...form, supplier_days: e.target.value })} />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={form.supplier_eom} onChange={(e) => setForm({ ...form, supplier_eom: e.target.checked })} /> à compter de la fin du mois
        </label>
        <Field label="Limite de crédit (GNF)" hint="Vide : pas de limite" className="col-span-2">
          <Input inputMode="numeric" className="font-mono" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} />
        </Field>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.vat_exempt} onChange={(e) => setForm({ ...form, vat_exempt: e.target.checked })} /> Non assujetti à la TVA : ses factures de vente sont émises en exonération
        </label>
      </div>
    </Modal>
  );
}
