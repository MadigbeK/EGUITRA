"use client";

import { useState } from "react";
import { Pencil, Plus } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader } from "@/components/ui";
import { MoveStatus } from "@/components/finance/MovesPage";
import { CREATION_TIERS, MODIFICATION_TIERS } from "@/components/finance/communPieces";
import { ApiError, apiSend, useApi, useAutorise } from "@/lib/api-client";
import type { MoveSummary, Paged, Partner } from "@/lib/finance-types";
import { fmtDate, fmtGNF } from "@/lib/format";

interface SupplierDetail extends Partner {
  street: string | null;
  rccm?: string | null;
  supplier_payment_term?: { id: number; name: string } | null;
  recent_moves: MoveSummary[];
}

/**
 * Fournisseurs (profil Achats) : fiches d'identité et coordonnées, leurs pièces d'achat. Ni soldes, ni
 * encours, ni limites de crédit, ni conditions de paiement : la finance les tient (écran Tiers).
 */
export default function SuppliersPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<SupplierDetail | "new" | null>(null);
  const params = new URLSearchParams({ kind: "supplier", limit: "300" });
  if (search) params.set("search", search);
  const { data, error, isLoading, mutate } = useApi<Paged<Partner>>(`/finance/partners?${params.toString()}`);
  const creation = useAutorise(CREATION_TIERS);

  return (
    <div>
      <PageHeader
        title="Fournisseurs"
        subtitle="Fiches des fournisseurs : raison sociale, NIF, RCCM, contact, coordonnées. Les soldes, les conditions de paiement et les limites restent tenus par la finance."
        actions={
          creation && (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Nouveau fournisseur
            </Button>
          )
        }
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-end gap-3 px-4 pt-3">
          <Input aria-label="Rechercher un fournisseur" className="max-w-xs" placeholder="Nom, NIF, code ou téléphone…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {error && (
          <div className="p-4">
            <ErrorBox error={error} onRetry={() => mutate()} />
          </div>
        )}
        {isLoading && !data ? (
          <Loading />
        ) : (
          <DataTable
            rows={data?.items ?? []}
            rowKey={(p) => p.id}
            onRowClick={(p) => setSelected(p.id)}
            empty="Aucun fournisseur."
            columns={[
              { key: "name", label: "Raison sociale" },
              { key: "ref", label: "Code", render: (p) => p.ref ?? "–" },
              { key: "vat", label: "NIF", render: (p) => p.vat ?? "–" },
              { key: "contact", label: "Contact", render: (p) => p.contact ?? "–" },
              { key: "phone", label: "Téléphone", render: (p) => p.phone ?? "–" },
              { key: "city", label: "Ville", render: (p) => p.city ?? "–" },
            ]}
          />
        )}
      </Card>
      {selected !== null && (
        <SupplierModal
          id={selected}
          onClose={() => setSelected(null)}
          onEdit={(p) => {
            setSelected(null);
            setEditing(p);
          }}
        />
      )}
      {editing && (
        <SupplierForm
          supplier={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void mutate();
          }}
        />
      )}
    </div>
  );
}

function SupplierModal({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (p: SupplierDetail) => void }) {
  const { data: p, error } = useApi<SupplierDetail>(`/finance/partners/${id}`);
  const modification = useAutorise(MODIFICATION_TIERS);
  return (
    <Modal
      open
      wide
      title={p?.name ?? "Fournisseur"}
      onClose={onClose}
      footer={
        p?.supplier && modification && (
          <Button onClick={() => onEdit(p)}>
            <Pencil className="h-4 w-4" /> Modifier
          </Button>
        )
      }
    >
      {error && <ErrorBox error={error} />}
      {!p && !error && <Loading />}
      {p && (
        <div className="space-y-5">
          {!p.supplier && <Notice tone="accent">Ce tiers n&apos;est pas fournisseur : sa fiche se modifie par la finance.</Notice>}
          <div className="grid grid-cols-2 gap-2 text-sm text-ink-2 md:grid-cols-3">
            <div>Code : {p.ref ?? "–"}</div>
            <div>NIF : {p.vat ?? "–"}</div>
            <div>RCCM : {p.rccm ?? "–"}</div>
            <div>Secteur : {p.sector ?? "–"}</div>
            <div>Contact : {p.contact ?? "–"}</div>
            <div>Tél. : {p.phone ?? "–"}</div>
            <div>Courriel : {p.email ?? "–"}</div>
            <div>{[p.street, p.city].filter(Boolean).join(", ") || "–"}</div>
            <div>Paiement : {p.supplier_payment_term?.name ?? "selon la société"}</div>
          </div>
          <Card title="Pièces d'achat récentes" padded={false}>
            <DataTable
              dense
              rows={p.recent_moves}
              rowKey={(m) => m.id}
              empty="Aucune pièce d'achat."
              columns={[
                { key: "name", label: "Pièce", render: (m) => m.name ?? "Brouillon" },
                { key: "ref", label: "Référence", render: (m) => m.ref ?? "–" },
                { key: "date", label: "Date", render: (m) => fmtDate(m.invoice_date ?? m.date) },
                { key: "amount_total", label: "TTC", align: "right", render: (m) => fmtGNF(m.amount_total) },
                { key: "state", label: "Statut", render: (m) => <MoveStatus m={m} /> },
              ]}
            />
          </Card>
        </div>
      )}
    </Modal>
  );
}

/** Fiche d'un fournisseur : identité et coordonnées (le noyau ignore tout autre champ pour le profil Achats). */
function SupplierForm({ supplier, onClose, onSaved }: { supplier: SupplierDetail | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: supplier?.name ?? "",
    ref: supplier?.ref ?? "",
    vat: supplier?.vat ?? "",
    rccm: supplier?.rccm ?? "",
    sector: supplier?.sector ?? "",
    contact: supplier?.contact ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    street: supplier?.street ?? "",
    city: supplier?.city ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body = { ...form, supplier: true };
      if (supplier) await apiSend("PATCH", `/finance/partners/${supplier.id}`, body);
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
      <Input type={props.type} placeholder={props.placeholder} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </Field>
  );
  return (
    <Modal
      open
      wide
      title={supplier ? `Modifier ${supplier.name}` : "Nouveau fournisseur"}
      onClose={onClose}
      footer={
        <Button variant="primary" loading={busy} onClick={submit} disabled={!form.name.trim()}>
          Enregistrer
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {error && (
          <div className="col-span-2 md:col-span-4">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        {text("name", "Raison sociale", { className: "col-span-2 md:col-span-3" })}
        {text("ref", "Code", { placeholder: "FRS-0001" })}
        {text("vat", "NIF")}
        {text("rccm", "RCCM")}
        {text("sector", "Secteur", { placeholder: "Carburant, pièces, BTP…" })}
        {text("contact", "Contact", { placeholder: "Nom, fonction" })}
        {text("phone", "Téléphone")}
        {text("email", "Courriel", { type: "email" })}
        {text("street", "Adresse", { className: "col-span-2" })}
        {text("city", "Ville")}
        <p className="col-span-2 text-[12px] text-muted md:col-span-4">
          Conditions de paiement, retenues à la source, assujettissement à la TVA et comptes bancaires du fournisseur : à demander à la finance.
        </p>
      </div>
    </Modal>
  );
}
