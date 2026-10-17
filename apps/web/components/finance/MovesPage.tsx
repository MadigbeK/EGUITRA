"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Badge, Button, Card, DataTable, ErrorBox, Input, Kpi, Loading, PageHeader, Tabs } from "@/components/ui";
import { MoveDetailModal } from "./MoveDetailModal";
import { MoveForm } from "./MoveForm";
import { useApi } from "@/lib/api-client";
import { MOVE_STATES, PAYMENT_STATES, type MoveSummary, type Paged } from "@/lib/finance-types";
import { fmtDate, fmtGNF, fmtShort } from "@/lib/format";

type View = "all" | "draft" | "open" | "overdue" | "dispute" | "paid";

const VIEWS: Array<{ key: View; label: string }> = [
  { key: "all", label: "Toutes" },
  { key: "draft", label: "Brouillons" },
  { key: "open", label: "À régler" },
  { key: "overdue", label: "Échues" },
  { key: "dispute", label: "Litiges" },
  { key: "paid", label: "Soldées" },
];

function query(kind: "sales" | "purchases", view: View, search: string) {
  const types = kind === "sales" ? "out_invoice,out_refund" : "in_invoice,in_refund";
  const params = new URLSearchParams({ type: types, limit: "200" });
  if (view === "draft") params.set("state", "draft");
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

/** Liste des factures de vente ou des pièces d'achat, avec saisie et fiche détaillée. */
export function MovesPage({ kind }: { kind: "sales" | "purchases" }) {
  const sale = kind === "sales";
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState<null | "out_invoice" | "out_refund" | "in_invoice" | "in_refund">(null);
  const [selected, setSelected] = useState<number | null>(null);
  const { data, error, isLoading, mutate } = useApi<Paged<MoveSummary>>(query(kind, view, search));
  const { data: openData } = useApi<Paged<MoveSummary>>(query(kind, "open", ""));
  const { data: overdueData } = useApi<Paged<MoveSummary>>(query(kind, "overdue", ""));

  return (
    <div>
      <PageHeader
        title={sale ? "Ventes" : "Achats et dépenses"}
        subtitle={sale ? "Factures et avoirs clients. La TVA et le compte client sont déduits à la saisie." : "Pièces d'achat et avoirs fournisseurs, soumis au circuit d'approbation selon les seuils."}
        actions={
          <>
            <Button onClick={() => setCreating(sale ? "out_refund" : "in_refund")}>Avoir</Button>
            <Button variant="primary" onClick={() => setCreating(sale ? "out_invoice" : "in_invoice")}>
              <Plus className="h-4 w-4" /> {sale ? "Nouvelle facture" : "Nouvelle pièce d'achat"}
            </Button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi label={sale ? "Reste à encaisser" : "Reste à payer"} value={fmtShort(openData?.totals?.amount_residual)} hint={`${openData?.total_count ?? 0} pièce(s)`} tone="accent" />
        <Kpi label="Dont échu" value={fmtShort(overdueData?.totals?.amount_residual)} hint={`${overdueData?.total_count ?? 0} pièce(s) en retard`} tone={overdueData?.total_count ? "warn" : "neutral"} />
        <Kpi label="Pièces affichées" value={String(data?.total_count ?? "–")} hint={`Total TTC ${fmtGNF(data?.totals?.amount_total)}`} />
      </div>
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
          <Tabs tabs={VIEWS} value={view} onChange={setView} />
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
              { key: "invoice_date_due", label: "Échéance", render: (m) => fmtDate(m.invoice_date_due) },
              { key: "amount_untaxed", label: "HT", align: "right", render: (m) => fmtGNF(m.amount_untaxed) },
              { key: "amount_total", label: "TTC", align: "right", render: (m) => fmtGNF(m.amount_total) },
              { key: "amount_residual", label: "Reste dû", align: "right", render: (m) => (m.state === "posted" ? fmtGNF(m.amount_residual) : "–") },
              {
                key: "state",
                label: "Statut",
                render: (m) =>
                  m.dispute && m.state !== "cancel" ? (
                    <span title={m.dispute_reason ?? undefined}>
                      <Badge tone="danger">Litige</Badge>
                    </span>
                  ) : m.state === "posted" ? (
                    <Badge tone={PAYMENT_STATES[m.payment_state]?.tone}>{PAYMENT_STATES[m.payment_state]?.label ?? m.payment_state}</Badge>
                  ) : (
                    <Badge tone={MOVE_STATES[m.state]?.tone}>{MOVE_STATES[m.state]?.label ?? m.state}</Badge>
                  ),
              },
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
