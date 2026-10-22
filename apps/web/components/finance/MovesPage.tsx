"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Input, Kpi, Loading, PageHeader, Tabs } from "@/components/ui";
import { MoveDetailModal } from "./MoveDetailModal";
import { MoveForm } from "./MoveForm";
import { useAchatsSeul, useApi } from "@/lib/api-client";
import { MOVE_STATES, PAYMENT_STATES, type MoveSummary, type Paged } from "@/lib/finance-types";
import { fmtDate, fmtGNF, fmtShort, pluriel } from "@/lib/format";

type View = "all" | "draft" | "posted" | "open" | "overdue" | "dispute" | "paid";

const VIEWS: Array<{ key: View; label: string }> = [
  { key: "all", label: "Toutes" },
  { key: "draft", label: "Brouillons" },
  { key: "open", label: "À régler" },
  { key: "overdue", label: "Échues" },
  { key: "dispute", label: "Litiges" },
  { key: "paid", label: "Soldées" },
];

/** Profil Achats : ses pièces se suivent par état (brouillon, soumise, comptabilisée), sans encours ni litiges. */
const VIEWS_ACHATS: Array<{ key: View; label: string }> = [
  { key: "all", label: "Toutes" },
  { key: "draft", label: "Brouillons et soumises" },
  { key: "posted", label: "Comptabilisées" },
];

function query(kind: "sales" | "purchases", view: View, search: string) {
  const types = kind === "sales" ? "out_invoice,out_refund" : "in_invoice,in_refund";
  const params = new URLSearchParams({ type: types, limit: "200" });
  if (view === "draft") params.set("state", "draft");
  if (view === "posted") params.set("state", "posted");
  if (view === "open") {
    params.set("state", "posted");
    params.set("payment_state", "not_paid,partial");
  }
  if (view === "overdue") params.set("overdue", "1");
  if (view === "dispute") params.set("dispute", "1");
  if (view === "paid") params.set("payment_state", "paid,in_payment");
  if (search) params.set("search", search);
  return `/finance/moves?${params.toString()}`;
}

/** État d'une pièce : litige, règlement d'une pièce comptabilisée, circuit d'approbation, ou état de saisie. */
export function MoveStatus({ m }: { m: MoveSummary }) {
  if (m.dispute && m.state !== "cancel")
    return (
      <span title={m.dispute_reason ?? undefined}>
        <Badge tone="danger">Litige</Badge>
      </span>
    );
  if (m.state === "posted") return <Badge tone={PAYMENT_STATES[m.payment_state]?.tone}>{PAYMENT_STATES[m.payment_state]?.label ?? m.payment_state}</Badge>;
  if (m.state === "draft" && m.approval?.state === "pending") return <Badge tone="warn">{m.approval.pending_with ? `En validation : ${m.approval.pending_with}` : "En validation"}</Badge>;
  if (m.state === "draft" && m.approval?.state === "rejected") return <Badge tone="danger">Refusée</Badge>;
  return <Badge tone={MOVE_STATES[m.state]?.tone}>{MOVE_STATES[m.state]?.label ?? m.state}</Badge>;
}

/**
 * Liste des factures de vente ou des pièces d'achat, avec saisie et fiche détaillée. Le profil Achats seul
 * n'y voit que ses pièces d'achat et avoirs fournisseurs, sans encours ni litiges : il les saisit par
 * catégorie, les soumet au circuit et suit leur état.
 */
export function MovesPage({ kind }: { kind: "sales" | "purchases" }) {
  const sale = kind === "sales";
  const { achats, pret } = useAchatsSeul(!sale);
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState<null | "out_invoice" | "out_refund" | "in_invoice" | "in_refund">(null);
  const [selected, setSelected] = useState<number | null>(null);
  const { data, error, isLoading, mutate } = useApi<Paged<MoveSummary>>(query(kind, view, search));
  // Encours et retards : finance et direction ; brouillons et pièces comptabilisées : profil Achats.
  const finance = sale || (pret && !achats);
  const { data: openData } = useApi<Paged<MoveSummary>>(finance ? query(kind, "open", "") : null);
  const { data: overdueData } = useApi<Paged<MoveSummary>>(finance ? query(kind, "overdue", "") : null);
  const { data: draftData } = useApi<Paged<MoveSummary>>(achats ? query(kind, "draft", "") : null);
  const { data: postedData } = useApi<Paged<MoveSummary>>(achats ? query(kind, "posted", "") : null);

  return (
    <div>
      <PageHeader
        title={sale ? "Ventes" : "Achats et dépenses"}
        subtitle={
          sale
            ? "Factures et avoirs clients. La TVA et le compte client sont déduits à la saisie."
            : achats
              ? "Pièces d'achat et avoirs fournisseurs : chaque ligne se saisit par catégorie de dépense (elle fixe le compte et la TVA), le justificatif joint, puis la pièce se soumet au circuit d'approbation."
              : "Pièces d'achat et avoirs fournisseurs, soumis au circuit d'approbation selon les seuils."
        }
        actions={
          <>
            <Button onClick={() => setCreating(sale ? "out_refund" : "in_refund")}>Avoir</Button>
            <Button variant="primary" onClick={() => setCreating(sale ? "out_invoice" : "in_invoice")}>
              <Plus className="h-4 w-4" /> {sale ? "Nouvelle facture" : "Nouvelle pièce d'achat"}
            </Button>
          </>
        }
      />
      {achats ? (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Kpi label="Brouillons et soumises" value={String(draftData?.total_count ?? "–")} hint="À compléter, à soumettre ou en validation" tone="accent" />
          <Kpi label="Comptabilisées" value={String(postedData?.total_count ?? "–")} hint="Approuvées et passées en comptabilité" />
          <Kpi label="Pièces affichées" value={String(data?.total_count ?? "–")} hint={`Total TTC ${fmtGNF(data?.totals?.amount_total)}`} />
        </div>
      ) : (
        finance && (
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Kpi label={sale ? "Reste à encaisser" : "Reste à payer"} value={fmtShort(openData?.totals?.amount_residual)} hint={pluriel(openData?.total_count ?? 0, "pièce")} tone="accent" />
            <Kpi label="Dont échu" value={fmtShort(overdueData?.totals?.amount_residual)} hint={`${pluriel(overdueData?.total_count ?? 0, "pièce")} en retard`} tone={overdueData?.total_count ? "warn" : "neutral"} />
            <Kpi label="Pièces affichées" value={String(data?.total_count ?? "–")} hint={`Total TTC ${fmtGNF(data?.totals?.amount_total)}`} />
          </div>
        )
      )}
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
          <Tabs tabs={achats ? VIEWS_ACHATS : VIEWS} value={view} onChange={setView} />
          <Input aria-label="Rechercher une pièce" className="max-w-xs" placeholder="Numéro, référence ou tiers…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
            rowKey={(m) => m.id}
            onRowClick={(m) => setSelected(m.id)}
            empty={sale ? "Aucune facture pour ce filtre." : "Aucune pièce d'achat pour ce filtre."}
            columns={[
              { key: "name", label: "Numéro", render: (m) => <span className="font-mono text-xs">{m.name ?? "Brouillon"}</span> },
              { key: "invoice_date", label: "Date", render: (m) => fmtDate(m.invoice_date ?? m.date) },
              { key: "partner", label: sale ? "Client" : "Fournisseur", render: (m) => m.partner?.name ?? "–", sortValue: (m) => m.partner?.name ?? "" },
              achats
                ? { key: "ref", label: "Référence", render: (m) => m.ref ?? "–" }
                : { key: "invoice_date_due", label: "Échéance", render: (m) => fmtDate(m.invoice_date_due) },
              { key: "amount_untaxed", label: "HT", align: "right", render: (m) => fmtGNF(m.amount_untaxed) },
              { key: "amount_total", label: "TTC", align: "right", render: (m) => fmtGNF(m.amount_total) },
              ...(achats ? [] : [{ key: "amount_residual", label: "Reste dû", align: "right" as const, render: (m: MoveSummary) => (m.state === "posted" ? fmtGNF(m.amount_residual) : "–") }]),
              { key: "state", label: "Statut", render: (m) => <MoveStatus m={m} /> },
            ]}
          />
        )}
      </Card>
      {creating && (
        <MoveForm
          open
          moveType={creating}
          onClose={() => setCreating(null)}
          onCreated={(m) => {
            setCreating(null);
            void mutate();
            setSelected(m.id);
          }}
        />
      )}
      <MoveDetailModal moveId={selected} onClose={() => setSelected(null)} onChanged={() => mutate()} />
    </div>
  );
}
