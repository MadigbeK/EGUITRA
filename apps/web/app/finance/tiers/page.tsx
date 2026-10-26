"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Button, Card, DataTable, ErrorBox, Field, Input, Kpi, Loading, Modal, Notice, PageHeader, ProgressBar, Segmented, Tabs, Tag, cx } from "@/components/ui";
import { BalanceAgee } from "@/components/finance/BalanceAgee";
import { CHAMP_INVALIDE, CREATION_TIERS, MODIFICATION_TIERS, PagesListe } from "@/components/finance/communPieces";
import { ApiError, apiSend, useApi, useAutorise } from "@/lib/api-client";
import type { MoveSummary, Paged, Partner } from "@/lib/finance-types";
import { AIDE_NOMBRE, fmtDate, fmtGNF, fmtJours, fmtPct, lireNombre, nombreIllisible } from "@/lib/format";

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

/** Tiers par page ; le noyau découpe la liste (offset) et en donne le total. */
const PAGE = 100;

export default function PartnersPage() {
  const [kind, setKind] = useState<Kind>("all");
  const [search, setSearch] = useState("");
  // Rang du premier tiers affiché ; revient à 0 quand le filtre ou la recherche change.
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<Partner | "new" | null>(null);
  const [vue, setVue] = useState<"fiches" | "agee">("fiches");
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (kind !== "all") params.set("kind", kind);
  if (search) params.set("search", search);
  const { data, error, isLoading, mutate } = useApi<Paged<Partner>>(`/finance/partners?${params.toString()}`);
  // La direction consulte les fiches et les soldes ; la création et la modification relèvent de la finance.
  const creation = useAutorise(CREATION_TIERS);

  return (
    <div>
      <PageHeader
        title="Tiers"
        subtitle="Clients et fournisseurs : soldes, balance âgée, retards et statut, limites de crédit."
        actions={
          <>
            <Segmented label="Vue" options={[{ key: "fiches", label: "Fiches" }, { key: "agee", label: "Balance âgée" }]} value={vue} onChange={setVue} />
            {creation && (
              <Button variant="primary" onClick={() => setEditing("new")}>
                <Plus className="h-4 w-4" /> Nouveau tiers
              </Button>
            )}
          </>
        }
      />
      {vue === "agee" && <BalanceAgee />}
      <Card padded={false} className={vue === "agee" ? "hidden" : undefined}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
          <Tabs
            tabs={[
              { key: "all", label: "Tous" },
              { key: "customer", label: "Clients" },
              { key: "supplier", label: "Fournisseurs" },
            ]}
            value={kind}
            onChange={(k) => { setKind(k); setOffset(0); }}
          />
          <Input className="max-w-xs" placeholder="Nom, NIF ou téléphone…" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} />
        </div>
        {error && (
          <div className="px-4 pt-3">
            <ErrorBox error={error} onRetry={() => mutate()} />
          </div>
        )}
        {!data ? (
          !error && isLoading && <Loading />
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
        {data && <PagesListe offset={offset} taille={PAGE} total={data.total_count} libelle="Tiers" onPage={setOffset} />}
      </Card>
      {selected !== null && <PartnerModal id={selected} onClose={() => setSelected(null)} onEdit={(p) => { setSelected(null); setEditing(p); }} />}
      {editing && <PartnerForm partner={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void mutate(); }} />}
    </div>
  );
}

function PartnerModal({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (p: Partner) => void }) {
  const { data: p, error, mutate } = useApi<PartnerDetail>(`/finance/partners/${id}`);
  const modification = useAutorise(MODIFICATION_TIERS);
  return (
    <Modal open wide title={p?.name ?? "Tiers"} onClose={onClose} footer={p && modification && <Button onClick={() => onEdit(p)}>Modifier</Button>}>
      {error && <ErrorBox error={error} onRetry={() => mutate()} />}
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
                { key: "late_days", label: "Retard", align: "right", render: (i) => (i.late_days ? <span className="text-warn">{fmtJours(i.late_days)}</span> : "–") },
                // Dans le sens de la nature : ce que le client nous doit, ce que nous devons au fournisseur ; un reste
                // négatif (avoir, trop-perçu, avance) reste négatif au lieu de passer pour une dette.
                { key: "residual", label: "Reste", align: "right", render: (i) => { const v = i.kind === "client" ? i.residual : -i.residual; return <span className={v < 0 ? "text-muted" : undefined} title={v < 0 ? "Avoir, trop-perçu ou avance non imputés" : undefined}>{fmtGNF(v)}</span>; } },
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
  const term = (days: string, eom: boolean) => (days.trim() === "" ? null : { days: lireNombre(days), end_of_month: eom });
  // Délais et limite lus à la française et contrôlés : « 30 j » devenait « Comptant », « 1.500.000 »
  // supprimait la limite. Une saisie illisible est signalée sous le champ et bloque l'enregistrement.
  const erreurDelai = (v: string) => {
    if (!v.trim()) return undefined;
    const n = lireNombre(v);
    if (n === null) return AIDE_NOMBRE;
    return Number.isInteger(n) && n >= 0 && n <= 365 ? undefined : "Un nombre entier de jours, de 0 à 365.";
  };
  const limite = lireNombre(form.credit_limit);
  const erreurLimite = nombreIllisible(form.credit_limit) ? AIDE_NOMBRE : limite !== null && limite < 0 ? "La limite de crédit est positive." : undefined;
  const erreurs = { client: erreurDelai(form.customer_days), fournisseur: erreurDelai(form.supplier_days), limite: erreurLimite };
  const invalide = Boolean(erreurs.client || erreurs.fournisseur || erreurs.limite);
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
      credit_limit: limite ?? 0,
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
    <Modal open wide title={partner ? `Modifier ${partner.name}` : "Nouveau tiers"} onClose={onClose} footer={<Button variant="primary" loading={busy} onClick={submit} disabled={!form.name || invalide}>Enregistrer</Button>}>
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
            <input type="checkbox" checked={form.customer} disabled={Boolean(partner?.customer)} title={partner?.customer ? "Un tiers déjà client le reste" : undefined} onChange={(e) => setForm({ ...form, customer: e.target.checked })} /> Client
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.supplier} disabled={Boolean(partner?.supplier)} title={partner?.supplier ? "Un tiers déjà fournisseur le reste" : undefined} onChange={(e) => setForm({ ...form, supplier: e.target.checked })} /> Fournisseur
          </label>
        </div>
        <Field label="Délai de paiement client (jours)" hint="Vide : selon la société" error={erreurs.client}>
          <Input inputMode="numeric" aria-invalid={Boolean(erreurs.client)} className={cx("font-mono", CHAMP_INVALIDE)} value={form.customer_days} onChange={(e) => setForm({ ...form, customer_days: e.target.value })} />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={form.customer_eom} onChange={(e) => setForm({ ...form, customer_eom: e.target.checked })} /> à compter de la fin du mois
        </label>
        <Field label="Délai de paiement fournisseur (jours)" hint="Vide : selon la société" error={erreurs.fournisseur}>
          <Input inputMode="numeric" aria-invalid={Boolean(erreurs.fournisseur)} className={cx("font-mono", CHAMP_INVALIDE)} value={form.supplier_days} onChange={(e) => setForm({ ...form, supplier_days: e.target.value })} />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={form.supplier_eom} onChange={(e) => setForm({ ...form, supplier_eom: e.target.checked })} /> à compter de la fin du mois
        </label>
        <Field label="Limite de crédit (GNF)" hint="Vide : pas de limite" error={erreurs.limite} className="col-span-2">
          <Input inputMode="numeric" aria-invalid={Boolean(erreurs.limite)} className={cx("font-mono", CHAMP_INVALIDE)} value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} />
        </Field>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.vat_exempt} onChange={(e) => setForm({ ...form, vat_exempt: e.target.checked })} /> Non assujetti à la TVA : ses factures de vente sont émises en exonération
        </label>
      </div>
    </Modal>
  );
}
